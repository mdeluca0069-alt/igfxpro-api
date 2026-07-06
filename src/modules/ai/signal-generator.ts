import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../prisma/prisma.edge";
import type { Env } from "../../prisma/prisma.edge";
import { fetchHistoricalCandles, type Candle } from "../../common/twelvedata";
import { fetchBinanceCandles } from "../../common/binance";
import { getActiveTwelveDataKey } from "../../common/twelvedata-rotation";
import { calcEMA, calcRSI, calcMACD, calcATR } from "../../common/ta-indicators";
import { INSTRUMENT_META } from "../../common/instruments";
import { broadcastAll } from "../../common/realtime";

// Real OLOS signal generation — ported from apiv2's signals-engine/
// signal.generator.ts + ai-core/confidence.engine.ts (439 + 252 lines).
// apiv2's own version never made it into the Workers migration (Fase 6's
// comment flagged this explicitly), which is why OLOS Decision Log, Signal
// Anatomy, and OLOS Institutional Signals were always empty on the
// homepage — there was nothing writing to the OlosSignal table at all.
//
// Deliberate simplifications vs apiv2 (documented, not hidden):
//   - 4 confidence factors (trend/momentum/volume/macro), matching exactly
//     what the frontend's Signal Anatomy widget renders, instead of apiv2's
//     internal 9-factor model (session timing / structure / multi-timeframe
//     / correlation are folded out — the frontend never displays them).
//   - Single timeframe (1H) per evaluation, not apiv2's full multi-timeframe
//     alignment gate — Workers' cron-tick model plus tight TwelveData/
//     Binance candle-fetch budgets make repeated multi-timeframe pulls per
//     tick expensive; the RSI+MACD+EMA200 gate below is still 100% real
//     computed technical analysis, just on one timeframe.
//   - Fixed candidate list (5 symbols with reliable live data), not a
//     continuous scan of the full 130-instrument catalog.
// The gate logic, ATR-based stop/target construction, and 4-hour per-symbol
// cooldown are faithful to apiv2's originals.

const CANDIDATES: Array<{ symbol: string; source: "twelvedata" | "binance" }> = [
  { symbol: "EURUSD", source: "twelvedata" },
  { symbol: "GBPUSD", source: "twelvedata" },
  { symbol: "XAUUSD", source: "twelvedata" },
  { symbol: "BTCUSD", source: "binance" },
  { symbol: "ETHUSD", source: "binance" },
];

const COOLDOWN_MS = 4 * 60 * 60 * 1000;
const MIN_CONFIDENCE = 60;
const SYSTEM_USER_ID = "sys_olos_engine";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

async function ensureSystemUser(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id: SYSTEM_USER_ID } });
  if (existing) return;

  const tenant = await prisma.tenant.findFirst();
  if (!tenant) return;

  await prisma.user
    .create({
      data: {
        id: SYSTEM_USER_ID,
        email: "olos-engine@system.igfxpro.internal",
        password: bcrypt.hashSync(randomUUID(), 10),
        fullName: "OLOS Signal Engine",
        role: "system",
        roles: ["system"],
        permissions: [],
        tier: "ENTERPRISE",
        kycStatus: "approved",
        tenantId: tenant.id,
      },
    })
    .catch(() => {
      // Race-safe: another concurrent tick may have created it first.
    });
}

export async function generateSignals(env: Env): Promise<void> {
  const prisma = getPrisma(env);
  await ensureSystemUser(prisma);

  const twelveDataKey = await getActiveTwelveDataKey(prisma, [
    env.TWELVEDATA_API_KEY,
    env.TWELVEDATA_API_KEY_2,
    env.TWELVEDATA_API_KEY_3,
    env.TWELVEDATA_API_KEY_4,
    env.TWELVEDATA_API_KEY_5,
  ]);

  for (const candidate of CANDIDATES) {
    try {
      await evaluateSymbol(prisma, candidate.symbol, candidate.source, twelveDataKey, env);
    } catch (err) {
      console.error(`[signal-generator] ${candidate.symbol} failed:`, (err as Error).message);
    }
  }
}

async function evaluateSymbol(prisma: PrismaClient, symbol: string, source: "twelvedata" | "binance", twelveDataKey: string | null, env: Env): Promise<void> {
  const recent = await prisma.olosSignal.findFirst({ where: { symbol }, orderBy: { createdAt: "desc" } });
  if (recent && Date.now() - recent.createdAt.getTime() < COOLDOWN_MS) return;

  if (source === "twelvedata" && !twelveDataKey) return; // all keys daily-exhausted this cycle

  const candles: Candle[] =
    source === "binance" ? await fetchBinanceCandles(symbol, "1h", 220) : await fetchHistoricalCandles(twelveDataKey!, symbol, "1h", 220);

  if (candles.length < 210) return;

  const closes = candles.map((c) => c.close);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcEMA(closes, 200);
  const rsi = calcRSI(closes, 14);
  const { macd, sig, hist } = calcMACD(closes);
  const atr = calcATR(candles, 14);

  const i = closes.length - 1;
  const price = closes[i]!;
  const rsiNow = rsi[i]!;
  const ema200Now = ema200[i]!;
  const ema50Now = ema50[i]!;
  const bullishCross = macd[i - 1]! <= sig[i - 1]! && macd[i]! > sig[i]!;
  const bearishCross = macd[i - 1]! >= sig[i - 1]! && macd[i]! < sig[i]!;
  const oversold = rsiNow < 35;
  const overbought = rsiNow > 65;

  let signalType: "BUY" | "SELL" | null = null;
  const confluenceFactors: string[] = [];
  if (oversold && bullishCross && price > ema200Now) {
    signalType = "BUY";
    confluenceFactors.push("RSI_OVERSOLD", "MACD_BULLISH_CROSS", "ABOVE_EMA200");
  } else if (overbought && bearishCross && price < ema200Now) {
    signalType = "SELL";
    confluenceFactors.push("RSI_OVERBOUGHT", "MACD_BEARISH_CROSS", "BELOW_EMA200");
  }
  if (!signalType) return;

  // ── Macro factor: real proximity to the next high-impact event ─────────
  const now = new Date();
  const in4h = new Date(now.getTime() + 4 * 3_600_000);
  const upcomingHighImpact = await prisma.economicEvent.findMany({
    where: { impact: "high", eventTime: { gte: now, lte: new Date(now.getTime() + 48 * 3_600_000) } },
    orderBy: { eventTime: "asc" },
    take: 5,
  });
  const eventWithin4h = upcomingHighImpact.some((e) => e.eventTime <= in4h);
  if (eventWithin4h) return; // apiv2's hard suppression rule: no signal within 4h of a high-impact release

  const hoursToNextEvent = upcomingHighImpact[0] ? (upcomingHighImpact[0].eventTime.getTime() - now.getTime()) / 3_600_000 : 48;
  const macroScore = clamp(hoursToNextEvent / 48, 0.3, 1);

  // ── Trend factor: real EMA50/EMA200 separation, direction-aware ─────────
  const emaSeparationBps = ((ema50Now - ema200Now) / ema200Now) * 10_000;
  const trendScore = clamp(0.5 + (signalType === "BUY" ? emaSeparationBps : -emaSeparationBps) / 40, 0, 1);

  // ── Momentum factor: real RSI extremity + MACD histogram vs ATR ─────────
  const rsiExtremity = signalType === "BUY" ? (50 - rsiNow) / 50 : (rsiNow - 50) / 50;
  const histStrength = atr > 0 ? clamp(Math.abs(hist[i]!) / atr, 0, 1) : 0;
  const momentumScore = clamp(rsiExtremity * 0.6 + histStrength * 0.4, 0, 1);

  // ── Volume factor: real last-candle volume vs its own 20-period average ─
  const recentVolumes = candles.slice(-20).map((c) => c.volume);
  const avgVolume = recentVolumes.reduce((s, v) => s + v, 0) / recentVolumes.length;
  const lastVolume = candles[candles.length - 1]!.volume;
  const volumeScore = avgVolume > 0 ? clamp(lastVolume / avgVolume / 2, 0, 1) : 0.5;

  const confidence = Math.round((trendScore * 0.25 + momentumScore * 0.25 + volumeScore * 0.25 + macroScore * 0.25) * 100);
  if (confidence < MIN_CONFIDENCE) return;

  const meta = INSTRUMENT_META[symbol];
  const pipSize = meta?.pipSize ?? 0.0001;
  const stopDistance = atr * 1.5;
  const stopLoss = signalType === "BUY" ? price - stopDistance : price + stopDistance;
  const target1 = signalType === "BUY" ? price + stopDistance * 1.5 : price - stopDistance * 1.5;
  const target2 = signalType === "BUY" ? price + stopDistance * 3 : price - stopDistance * 3;
  const riskRewardRatio = stopDistance > 0 ? 1.5 : 0;
  const expectedRiskPips = stopDistance / pipSize;

  const marketRegime = ema50Now > ema200Now * 1.001 ? "TRENDING_UP" : ema50Now < ema200Now * 0.999 ? "TRENDING_DOWN" : "RANGE";
  const volatilityLevel = atr / price > 0.01 ? "HIGH" : atr / price > 0.004 ? "MEDIUM" : "LOW";

  const confidenceBreakdown = {
    trend: Number(trendScore.toFixed(2)),
    momentum: Number(momentumScore.toFixed(2)),
    volume: Number(volumeScore.toFixed(2)),
    macro: Number(macroScore.toFixed(2)),
  };

  const signal = await prisma.olosSignal.create({
    data: {
      userId: SYSTEM_USER_ID,
      symbol,
      timeframe: "1H",
      signalType,
      confidence,
      setupPattern: `${signalType === "BUY" ? "Bullish" : "Bearish"} RSI/MACD reversal`,
      setupDescription: `RSI ${signalType === "BUY" ? "oversold" : "overbought"} (${rsiNow.toFixed(1)}) with MACD ${signalType === "BUY" ? "bullish" : "bearish"} cross, price ${signalType === "BUY" ? "above" : "below"} EMA200`,
      confluenceFactors,
      confidenceBreakdown,
      entryPrice: price,
      entryRationale: `${signalType} setup confirmed on 1H: RSI ${rsiNow.toFixed(1)}, MACD cross, EMA200 ${ema200Now.toFixed(5)}`,
      targetLevels: [target1, target2],
      stopLoss,
      slRationale: `1.5x ATR (${atr.toFixed(5)}) beyond entry`,
      riskRewardRatio,
      macroEvents: upcomingHighImpact.map((e) => ({ title: e.title, eventTime: e.eventTime.toISOString(), currency: e.currency, impact: e.impact })),
      marketRegime,
      volatilityLevel,
      expectedRiskPips,
      marginRequirement: 0,
      liquidityProfile: "balanced",
      status: "ACTIVE",
    },
  });

  console.log(`[signal-generator] ${symbol} ${signalType} confidence=${confidence}`);

  await broadcastAll(env, "signal.generated", {
    id: signal.id,
    symbol,
    signalType,
    confidence,
    timeframe: "1H",
  }).catch(() => {});
}
