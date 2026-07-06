import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";
import { fetchHistoricalCandles } from "../../common/twelvedata";
import { fetchBinanceCandles } from "../../common/binance";
import { getActiveTwelveDataKey } from "../../common/twelvedata-rotation";
import { calcEMA, calcRSI, calcMACD, calcATR, pearsonCorr } from "../../common/ta-indicators";
import { runBacktest, type StrategyId } from "./backtest";

export const aiRoutes = new Hono<HonoEnv>();

// These endpoints used to call fetchHistoricalCandles with a single
// hardcoded env.TWELVEDATA_API_KEY (the original key, daily-exhausted since
// before the 5-key rotation system existed) — every call silently returned
// [] (fetchHistoricalCandles swallows quota-exceeded responses), which for
// /ai/strategy surfaced as "Insufficient data" and for backtest/hedge as
// silently-empty results. Route through the same rotating key pool the
// quote/signal crons use instead of a permanently-dead key.
async function activeTwelveDataKey(c: { env: HonoEnv["Bindings"] }): Promise<string | null> {
  const prisma = getPrisma(c.env);
  return getActiveTwelveDataKey(prisma, [
    c.env.TWELVEDATA_API_KEY,
    c.env.TWELVEDATA_API_KEY_2,
    c.env.TWELVEDATA_API_KEY_3,
    c.env.TWELVEDATA_API_KEY_4,
    c.env.TWELVEDATA_API_KEY_5,
  ]);
}

// ── Signals/confidence/decision-log — public, platform-wide, unauthenticated
// (registered before the "*" auth middleware below, since Hono's middleware
// chain only applies to routes matched after a .use() call's registration
// point — same fix as autopilot.routes.ts's /stats/public). The public
// marketing homepage calls these directly; they were 401-ing even after
// fixing the frontend's relative-fetch bug because this whole router used
// to require auth unconditionally. /api/v1/signals/active (a different,
// separate router) remains the per-user authenticated feed.
aiRoutes.get("/signals", async (c) => {
  const prisma = getPrisma(c.env);
  const symbol = c.req.query("symbol");
  const signals = await prisma.olosSignal.findMany({
    where: { status: "ACTIVE", ...(symbol ? { symbol } : {}) },
    orderBy: { confidence: "desc" },
  });
  return c.json(signals);
});

aiRoutes.get("/confidence", async (c) => {
  const prisma = getPrisma(c.env);
  const signals = await prisma.olosSignal.findMany({ where: { status: "ACTIVE" } });

  if (!signals.length) {
    return c.json({ score: null, breakdown: null, status: "SCANNING", message: "Nessun segnale ad alta confidenza al momento.", nextScanInSec: 60, asOf: new Date().toISOString() });
  }

  const avg = signals.reduce((s, sig) => s + sig.confidence.toNumber(), 0) / signals.length / 100;

  const breakdowns = signals.map((s) => s.confidenceBreakdown as { trend?: number; momentum?: number; volume?: number; macro?: number });
  const avgFactor = (key: "trend" | "momentum" | "volume" | "macro") => {
    const vals = breakdowns.map((b) => b[key]).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  };

  return c.json({
    score: avg,
    breakdown: { trend: avgFactor("trend"), momentum: avgFactor("momentum"), volume: avgFactor("volume"), macro: avgFactor("macro") },
    status: "ACTIVE",
    signalCount: signals.length,
    asOf: signals[0]!.createdAt.toISOString(),
  });
});

aiRoutes.get("/decision-log", async (c) => {
  const prisma = getPrisma(c.env);
  const signal = await prisma.olosSignal.findFirst({ orderBy: { createdAt: "desc" } });
  if (!signal) return c.json({ status: "NO_DATA", trace: [] });

  const breakdown = signal.confidenceBreakdown as { trend?: number; momentum?: number; volume?: number; macro?: number };
  const trace = [
    { stage: "01 / INGEST", text: `${signal.symbol} 1H candles ingested, live quote confirmed` },
    { stage: "02 / CLASSIFY", text: `Regime: ${signal.marketRegime} · Volatility: ${signal.volatilityLevel}` },
    { stage: "03 / SCORE", text: `Trend ${Math.round((breakdown.trend ?? 0) * 100)}% · Momentum ${Math.round((breakdown.momentum ?? 0) * 100)}% · Volume ${Math.round((breakdown.volume ?? 0) * 100)}% · Macro ${Math.round((breakdown.macro ?? 0) * 100)}%` },
    { stage: "04 / VALIDATE", text: signal.entryRationale },
    { stage: "05 / SIGNAL", text: `${signal.signalType} @ ${signal.entryPrice.toNumber()} · SL ${signal.stopLoss.toNumber()} · confidence ${signal.confidence.toNumber()}%` },
  ];

  return c.json({
    status: "REAL",
    symbol: signal.symbol,
    signalType: signal.signalType,
    confidence: signal.confidence.toNumber(),
    createdAt: signal.createdAt.toISOString(),
    trace,
  });
});

aiRoutes.use("*", jwtAuthMiddleware);

// ── Chat — ported from apiv2's ai-core/ai.router.ts handleAiChat. Uses raw
// fetch to Anthropic's Messages API (streaming) instead of the SDK, since
// that's untested under workerd and a raw fetch call is a couple of lines
// more and guaranteed to work. Context (signals/positions/quotes) comes from
// the request body — the frontend sends its own already-loaded state, no
// extra server-side fetch needed.
aiRoutes.post("/chat", async (c) => {
  const body = await c.req.json<{ message?: string; context?: Record<string, unknown> }>();
  const userMessage = body?.message ?? "";
  const context = body?.context ?? {};
  const apiKey = c.env.ANTHROPIC_API_KEY;

  const signals = (context.signals as Array<{ symbol: string; signalType: string; confidence: number }>) ?? [];
  const positions = (context.positions as Array<{ symbol: string; side: string; pnl: number }>) ?? [];
  const quotes = (context.quotes as Record<string, { mid: number; changePct: number }>) ?? {};
  const confScore = (context.confidenceScore as number) ?? 0;

  if (apiKey && userMessage) {
    const systemPrompt = `You are OLOS, IGFXPRO's institutional-grade AI trading assistant. You have deep expertise in:
- Technical analysis (RSI, MACD, EMA, Bollinger Bands, Smart Money Concepts)
- Forex, indices, commodities, crypto, and equity CFD trading
- Risk management (ESMA regulations, leverage limits, margin management)
- IGFXPRO's platform features (iTrader terminal, autopilot, backtesting)

CURRENT MARKET DATA (live, use this in responses):
- Active OLOS signals (${signals.length} total): ${signals.slice(0, 5).map((s) => `${s.symbol} ${s.signalType} ${s.confidence.toFixed(0)}%`).join(", ") || "scanning..."}
- Overall confidence score: ${(confScore * 100).toFixed(1)}%
- Open positions (${positions.length}): ${positions.map((p) => `${p.symbol} ${p.side} P&L:${p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}`).join(", ") || "none"}
- Live quotes: ${Object.entries(quotes).slice(0, 6).map(([s, q]) => `${s}:${q.mid.toFixed(5)} (${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%)`).join(", ") || "loading"}

RULES:
- Be specific and data-driven. Reference actual signals, prices, and conditions above.
- Always include risk warnings for trading recommendations.
- Respond concisely but with professional depth. Max 3 paragraphs.
- Language: respond in the same language as the user's message.
- Never guarantee profits. Always emphasize risk management.`;

    return streamSSE(c, async (stream) => {
      try {
        const upstream = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-opus-4-8",
            max_tokens: 600,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            stream: true,
          }),
        });

        if (!upstream.body) throw new Error("No response body from Anthropic");

        if (!upstream.ok) {
          const errBody = await upstream.text();
          let message = `HTTP ${upstream.status}`;
          try {
            message = JSON.parse(errBody)?.error?.message ?? message;
          } catch {
            // non-JSON error body, use the raw text if short enough
            if (errBody) message = errBody.slice(0, 200);
          }
          throw new Error(message);
        }

        const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload);
              if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
                await stream.writeSSE({ data: JSON.stringify({ token: evt.delta.text }) });
              }
            } catch {
              // ignore malformed SSE chunks
            }
          }
        }
      } catch (err) {
        await stream.writeSSE({ data: JSON.stringify({ token: `[OLOS AI error: ${(err as Error).message}]` }) });
      }
      await stream.writeSSE({ data: "[DONE]" });
    });
  }

  // Rule-based fallback (no API key configured) — ported from apiv2 as-is.
  const activeSignals = signals;
  const buys = activeSignals.filter((s) => s.signalType === "BUY").sort((a, b) => b.confidence - a.confidence);
  const sells = activeSignals.filter((s) => s.signalType === "SELL").sort((a, b) => b.confidence - a.confidence);
  const lower = userMessage.toLowerCase();

  let reply: string;
  if (lower.includes("ciao") || lower.includes("hello") || lower.includes("hey")) {
    reply = `Benvenuto! Sono OLOS. Monitoro ${activeSignals.length} segnali attivi. Come posso aiutarti?`;
  } else if (lower.includes("buy") || lower.includes("comprar") || lower.includes("long")) {
    reply = buys.length
      ? `Miglior segnale BUY: ${buys[0]!.symbol} — confidence ${buys[0]!.confidence.toFixed(0)}%.`
      : "Nessun segnale BUY attivo al momento.";
  } else if (lower.includes("sell") || lower.includes("vend") || lower.includes("short")) {
    reply = sells.length
      ? `Miglior segnale SELL: ${sells[0]!.symbol} — confidence ${sells[0]!.confidence.toFixed(0)}%.`
      : "Nessun segnale SELL attivo al momento.";
  } else {
    reply = `OLOS monitora ${activeSignals.length} segnali attivi. Confidence media: ${(confScore * 100).toFixed(0)}%. Configura ANTHROPIC_API_KEY per risposte AI complete.`;
  }

  return streamSSE(c, async (stream) => {
    for (const word of reply.split(" ")) {
      await stream.writeSSE({ data: JSON.stringify({ token: word + " " }) });
    }
    await stream.writeSSE({ data: "[DONE]" });
  });
});

// ── Backtest — ported from apiv2's handleBacktest, adapted to fetch candles
// live from TwelveData per-request instead of an in-memory feed cache.
aiRoutes.post("/backtest", async (c) => {
  const b = await c.req.json<{
    symbol?: string;
    timeframe?: string;
    strategy?: string;
    dateFrom?: string;
    dateTo?: string;
    initialCapital?: number;
  }>();

  const symbol = (b?.symbol ?? "EURUSD").toUpperCase();
  const timeframe = b?.timeframe ?? "1H";
  const strategy = (b?.strategy ?? "OLOS Momentum") as StrategyId;
  const capital = b?.initialCapital ?? 10000;
  const tdInterval: Record<string, string> = { "1M": "1min", "5M": "5min", "15M": "15min", "30M": "30min", "1H": "1h", "4H": "4h", "1D": "1day" };

  const tdKey = await activeTwelveDataKey(c);
  let candles = tdKey ? await fetchHistoricalCandles(tdKey, symbol, tdInterval[timeframe] ?? "1h", 500) : [];

  if (b?.dateFrom) {
    const from = new Date(b.dateFrom).getTime() / 1000;
    candles = candles.filter((cd) => cd.time >= from);
  }
  if (b?.dateTo) {
    const to = new Date(b.dateTo).getTime() / 1000;
    candles = candles.filter((cd) => cd.time <= to);
  }

  const result = runBacktest(candles, strategy, symbol, capital);
  const period =
    candles.length > 0
      ? { from: new Date(candles[0]!.time * 1000).toISOString(), to: new Date(candles[candles.length - 1]!.time * 1000).toISOString() }
      : { from: "-", to: "-" };

  return c.json({ symbol, timeframe, strategy, candlesAnalyzed: candles.length, period, ...result });
});

// ── Strategy Builder — ported from apiv2's handleStrategyGen.
aiRoutes.post("/strategy", async (c) => {
  const b = await c.req.json<{ symbol?: string; timeframe?: string; riskLevel?: string }>();
  const symbol = (b?.symbol ?? "EURUSD").toUpperCase();
  const timeframe = b?.timeframe ?? "1H";
  const riskLevel = (b?.riskLevel ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH";
  const tdInterval: Record<string, string> = { "1M": "1min", "5M": "5min", "15M": "15min", "1H": "1h", "4H": "4h", "1D": "1day" };

  const tdKey = await activeTwelveDataKey(c);
  const candles = tdKey ? await fetchHistoricalCandles(tdKey, symbol, tdInterval[timeframe] ?? "1h", 200) : [];
  const closes = candles.map((cd) => cd.close);

  if (closes.length < 30) {
    return c.json({ error: "Insufficient data", note: "Wait for more candle data to accumulate (need 30+ candles)." });
  }

  const rsiArr = calcRSI(closes);
  const { hist } = calcMACD(closes);
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);
  const atr = calcATR(candles);

  const rsi = rsiArr.slice(-1)[0] ?? 50;
  const macdH = hist.slice(-1)[0] ?? 0;
  const macdPrev = hist.slice(-2)[0] ?? 0;
  const ema20 = ema20Arr.slice(-1)[0] ?? closes.slice(-1)[0]!;
  const ema50 = ema50Arr.slice(-1)[0] ?? closes.slice(-1)[0]!;
  const price = closes.slice(-1)[0]!;

  const pipSize = symbol.includes("JPY") ? 0.01 : symbol.includes("BTC") || symbol.includes("US5") || symbol.includes("US1") ? 1 : 0.0001;
  const atrPips = atr / pipSize;

  const bullPoints = (rsi < 50 ? 1 : 0) + (macdH > 0 ? 1 : 0) + (price > ema20 ? 1 : 0) + (price > ema50 ? 1 : 0) + (ema20 > ema50 ? 1 : 0);
  const bias: "BUY" | "SELL" | "NEUTRAL" = bullPoints >= 3 ? "BUY" : bullPoints <= 2 ? "SELL" : "NEUTRAL";

  const slMult = riskLevel === "LOW" ? 1.0 : riskLevel === "MEDIUM" ? 1.5 : 2.5;
  const tpMult = riskLevel === "LOW" ? 1.5 : riskLevel === "MEDIUM" ? 2.5 : 4.0;
  const slPips = Math.round(atrPips * slMult * 10) / 10;
  const tpPips = Math.round(atrPips * tpMult * 10) / 10;
  const slPrice = bias === "BUY" ? price - slPips * pipSize : price + slPips * pipSize;
  const tpPrice = bias === "BUY" ? price + tpPips * pipSize : price - tpPips * pipSize;
  const rrRatio = tpPips / slPips;

  const confidence = Math.min(90, 40 + bullPoints * 10 + (Math.abs(rsi - 50) > 15 ? 10 : 0) + (Math.abs(macdH) > 0 ? 5 : 0));
  const macdBias = macdH > macdPrev ? "BULLISH cross" : "BEARISH cross";
  const rsiStatus = rsi < 30 ? "Oversold" : rsi > 70 ? "Overbought" : rsi < 45 ? "Weak bearish" : rsi > 55 ? "Weak bullish" : "Neutral";
  const trendStatus = price > ema50 ? "Bullish (above EMA50)" : "Bearish (below EMA50)";

  const strategyNames = {
    BUY: ["OLOS Momentum Long", "OLOS Breakout Bull", "OLOS Trend Rider", "OLOS Accumulation Entry"],
    SELL: ["OLOS Momentum Short", "OLOS Breakdown Bear", "OLOS Counter-Trend", "OLOS Distribution Exit"],
    NEUTRAL: ["OLOS Range Scalp", "OLOS Wait-and-See"],
  };
  const nameIdx = (symbol.charCodeAt(0) + timeframe.charCodeAt(0)) % strategyNames[bias].length;
  const name = strategyNames[bias][nameIdx]!;

  const entryConditions =
    bias === "BUY"
      ? [
          `RSI(14) = ${rsi.toFixed(1)} — ${rsiStatus}`,
          `MACD Histogram: ${macdH.toFixed(6)} — ${macdBias}`,
          `Price ${price.toFixed(5)} ${price > ema20 ? "above" : "below"} EMA20 (${ema20.toFixed(5)})`,
          `Price ${price > ema50 ? "above" : "below"} EMA50 — ${trendStatus}`,
          `ATR(14) = ${atrPips.toFixed(1)} pip`,
        ]
      : [
          `RSI(14) = ${rsi.toFixed(1)} — ${rsiStatus}`,
          `MACD Histogram: ${macdH.toFixed(6)} — ${macdBias}`,
          `Price ${price.toFixed(5)} ${price < ema20 ? "below" : "above"} EMA20 (${ema20.toFixed(5)})`,
          `Price ${price < ema50 ? "below" : "above"} EMA50 — ${trendStatus}`,
          `ATR(14) = ${atrPips.toFixed(1)} pip`,
        ];

  const exitConditions = [
    `Take profit at ${tpPrice.toFixed(pipSize === 1 ? 2 : 5)} (+${tpPips.toFixed(1)} pip)`,
    `Stop loss at ${slPrice.toFixed(pipSize === 1 ? 2 : 5)} (-${slPips.toFixed(1)} pip)`,
    `RSI ${bias === "BUY" ? "crosses above 70" : "crosses below 30"}`,
    `MACD histogram ${bias === "BUY" ? "turns negative" : "turns positive"}`,
  ];

  return c.json({
    name,
    symbol,
    timeframe,
    riskLevel,
    bias,
    confidence,
    currentPrice: price,
    entryPrice: price,
    stopLoss: Math.round(slPrice * 100000) / 100000,
    takeProfit: Math.round(tpPrice * 100000) / 100000,
    stopLossPips: slPips,
    takeProfitPips: tpPips,
    riskRewardRatio: Math.round(rrRatio * 100) / 100,
    winRateEstimate: Math.round(45 + confidence * 0.2 + (rrRatio > 2 ? 5 : 0)),
    indicators: { rsi: Math.round(rsi * 10) / 10, macd: macdBias, ema20, ema50, atrPips: Math.round(atrPips * 10) / 10, trend: trendStatus },
    entryConditions,
    exitConditions,
    candlesUsed: closes.length,
    generatedAt: new Date().toISOString(),
  });
});

// ── Hedge Manager — ported from apiv2's handleHedge.
// US500/US100 dropped (no free-tier TwelveData index data, same finding as
// the homepage fix); BTCUSD/ETHUSD moved to Binance (free, matches the
// rest of the architecture) instead of TwelveData.
aiRoutes.post("/hedge", async (c) => {
  const b = await c.req.json<{ positions?: Array<{ id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; pnl?: number }> }>();
  const positions = b?.positions ?? [];
  const TD_SYMBOLS = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD", "WTI", "GBPJPY", "EURGBP", "AUDUSD", "USDCHF"];
  const BINANCE_SYMBOLS = ["BTCUSD", "ETHUSD"];
  const ALL_SYMBOLS = [...TD_SYMBOLS, ...BINANCE_SYMBOLS];
  const N_CORR = 60;

  const tdKey = await activeTwelveDataKey(c);
  const closesCache: Record<string, number[]> = {};
  await Promise.all([
    ...TD_SYMBOLS.map(async (sym) => {
      if (!tdKey) return;
      const candles = await fetchHistoricalCandles(tdKey, sym, "1h", N_CORR);
      if (candles.length >= 10) closesCache[sym] = candles.map((x) => x.close);
    }),
    ...BINANCE_SYMBOLS.map(async (sym) => {
      const candles = await fetchBinanceCandles(sym, "1h", N_CORR);
      if (candles.length >= 10) closesCache[sym] = candles.map((x) => x.close);
    }),
  ]);

  const suggestions = positions.map((pos) => {
    const posCloses = closesCache[pos.symbol];
    if (!posCloses || posCloses.length < 10) {
      return { positionId: pos.id, symbol: pos.symbol, side: pos.side, quantity: pos.quantity, pnl: pos.pnl ?? 0, correlations: [], topHedge: null, note: "Insufficient data for correlation" };
    }

    const correlations = ALL_SYMBOLS.filter((s) => s !== pos.symbol && closesCache[s] && closesCache[s]!.length >= 10)
      .map((hedgeSym) => ({ symbol: hedgeSym, correlation: Math.round(pearsonCorr(posCloses, closesCache[hedgeSym]!, N_CORR) * 1000) / 1000 }))
      .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

    const naturalHedge = correlations.find((cr) => cr.correlation < -0.3);
    const strongHedge = naturalHedge ?? correlations[0];

    let topHedge = null;
    if (strongHedge) {
      const hedgeSide: "BUY" | "SELL" = strongHedge.correlation > 0 ? (pos.side === "BUY" ? "SELL" : "BUY") : pos.side;
      const hedgeRatio = Math.abs(strongHedge.correlation);
      topHedge = {
        symbol: strongHedge.symbol,
        correlation: strongHedge.correlation,
        correlationType: strongHedge.correlation < 0 ? "Negative (natural hedge)" : "Positive (directional hedge)",
        hedgeSide,
        hedgeSize: Math.round(pos.quantity * hedgeRatio * 100) / 100,
        riskReduction: Math.round(hedgeRatio * 60 + 5),
      };
    }

    return { positionId: pos.id, symbol: pos.symbol, side: pos.side, quantity: pos.quantity, pnl: pos.pnl ?? 0, correlations: correlations.slice(0, 6), topHedge };
  });

  const matrixSymbols = Object.keys(closesCache).slice(0, 8);
  const correlationMatrix: Record<string, Record<string, number>> = {};
  for (const s1 of matrixSymbols) {
    correlationMatrix[s1] = {};
    for (const s2 of matrixSymbols) {
      correlationMatrix[s1]![s2] = s1 === s2 ? 1 : Math.round(pearsonCorr(closesCache[s1]!, closesCache[s2]!, N_CORR) * 1000) / 1000;
    }
  }

  return c.json({
    suggestions,
    correlationMatrix,
    dataQuality: { symbolsWithData: Object.keys(closesCache).length, candlesPerSymbol: N_CORR, computedAt: new Date().toISOString() },
  });
});

export const signalsRoutes = new Hono<HonoEnv>();
signalsRoutes.use("*", jwtAuthMiddleware);

signalsRoutes.get("/active", async (c) => {
  const prisma = getPrisma(c.env);
  const symbol = c.req.query("symbol");
  const signals = await prisma.olosSignal.findMany({
    where: { status: "ACTIVE", ...(symbol ? { symbol } : {}) },
    orderBy: { confidence: "desc" },
  });
  return c.json(signals);
});

signalsRoutes.get("/history", async (c) => {
  const prisma = getPrisma(c.env);
  const symbol = c.req.query("symbol");
  const status = c.req.query("status");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = parseInt(c.req.query("offset") ?? "0");

  const where = { ...(symbol ? { symbol } : {}), ...(status ? { status } : {}) };
  const [signals, total] = await Promise.all([
    prisma.olosSignal.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.olosSignal.count({ where }),
  ]);
  return c.json({ signals, total, limit, offset });
});

signalsRoutes.get("/stats", async (c) => {
  const prisma = getPrisma(c.env);
  const signals = await prisma.olosSignal.findMany();
  return c.json({
    totalSignals: signals.length,
    activeSignals: signals.filter((s) => s.status === "ACTIVE").length,
    triggeredSignals: signals.filter((s) => s.status === "TRIGGERED").length,
    closedSignals: signals.filter((s) => s.status === "CLOSED").length,
  });
});
