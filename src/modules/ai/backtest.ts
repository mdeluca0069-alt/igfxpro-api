// Ported as-is from igfxpro-apiv2/ai-core/ai.router.ts runBacktest — pure
// computation over a candle array, no framework dependency.
import type { Candle } from "../../common/twelvedata";
import { calcEMA, calcRSI, calcMACD, calcBollinger, calcATR, calcSharpe } from "../../common/ta-indicators";

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: "BUY" | "SELL";
  pnlPips: number;
  pnlUsd: number;
  exitReason: "TP" | "SL" | "SIGNAL";
  durationMin: number;
};

export type StrategyId = "OLOS Momentum" | "OLOS Mean Reversion" | "OLOS Breakout" | "OLOS Trend Follow" | "OLOS Scalp";

export function runBacktest(candles: Candle[], strategy: StrategyId, symbol: string, initialCapital: number) {
  if (candles.length < 60) {
    return {
      trades: [],
      equityCurve: [{ time: Date.now(), equity: initialCapital }],
      metrics: {
        totalTrades: 0,
        winRate: 0,
        totalPnlUsd: 0,
        sharpeRatio: 0,
        maxDrawdown: 0,
        profitFactor: 0,
        avgWin: 0,
        avgLoss: 0,
        winTrades: 0,
        lossTrades: 0,
        grossProfit: 0,
        grossLoss: 0,
        maxDrawdownPct: 0,
      },
      note: "Insufficient candle data. Try a longer timeframe or a more liquid symbol.",
    };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const rsi = calcRSI(closes);
  const { hist } = calcMACD(closes);
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const { upper: bbUpper, lower: bbLower } = calcBollinger(closes);
  const atr = calcATR(candles) || closes[closes.length - 1]! * 0.001;

  const pipSize = symbol.includes("JPY") ? 0.01 : symbol.includes("US5") || symbol.includes("US1") || symbol.includes("BTC") ? 1 : 0.0001;
  const slAtr = 1.5 * atr;
  const tpAtr = 3.0 * atr;

  const trades: BacktestTrade[] = [];
  let inTrade: { side: "BUY" | "SELL"; idx: number; ep: number; sl: number; tp: number } | null = null;

  const START = 55;
  const bbOffset = 19;

  for (let i = START; i < candles.length; i++) {
    const c = candles[i]!;
    const r = rsi[i] ?? 50;
    const h = hist[i] ?? 0;
    const hPrev = hist[i - 1] ?? 0;
    const e20 = ema20[i] ?? c.close;
    const e50 = ema50[i] ?? c.close;
    const bbu = bbUpper[i - bbOffset] ?? Infinity;
    const bbl = bbLower[i - bbOffset] ?? -Infinity;

    if (inTrade) {
      const hitSl = inTrade.side === "BUY" ? c.low <= inTrade.sl : c.high >= inTrade.sl;
      const hitTp = inTrade.side === "BUY" ? c.high >= inTrade.tp : c.low <= inTrade.tp;

      let exitPrice: number | null = null;
      let exitReason: "TP" | "SL" | "SIGNAL" = "SIGNAL";

      if (hitSl) {
        exitPrice = inTrade.sl;
        exitReason = "SL";
      } else if (hitTp) {
        exitPrice = inTrade.tp;
        exitReason = "TP";
      } else if (strategy === "OLOS Scalp") {
        if ((inTrade.side === "BUY" && r > 65) || (inTrade.side === "SELL" && r < 35)) {
          exitPrice = c.close;
          exitReason = "SIGNAL";
        }
      } else if (strategy === "OLOS Mean Reversion") {
        const bbMid = (bbu + bbl) / 2;
        if (inTrade.side === "BUY" && c.close >= bbMid) {
          exitPrice = c.close;
          exitReason = "SIGNAL";
        }
        if (inTrade.side === "SELL" && c.close <= bbMid) {
          exitPrice = c.close;
          exitReason = "SIGNAL";
        }
      }

      if (exitPrice !== null) {
        const pnlRaw = inTrade.side === "BUY" ? exitPrice - inTrade.ep : inTrade.ep - exitPrice;
        const pnlPips = pnlRaw / pipSize;
        const pnlUsd = pnlRaw * (symbol.includes("JPY") ? 900 : symbol.includes("BTC") ? 0.01 : 10000);
        trades.push({
          entryTime: candles[inTrade.idx]!.time * 1000,
          exitTime: c.time * 1000,
          entryPrice: inTrade.ep,
          exitPrice,
          side: inTrade.side,
          pnlPips: Math.round(pnlPips * 10) / 10,
          pnlUsd: Math.round(pnlUsd * 100) / 100,
          exitReason,
          durationMin: Math.round((c.time - candles[inTrade.idx]!.time) / 60),
        });
        inTrade = null;
      }
    } else {
      let signal: "BUY" | "SELL" | null = null;

      if (strategy === "OLOS Momentum") {
        const macdBull = h > 0 && hPrev <= 0;
        const macdBear = h < 0 && hPrev >= 0;
        if (r < 48 && macdBull && c.close > e50) signal = "BUY";
        else if (r > 52 && macdBear && c.close < e50) signal = "SELL";
      } else if (strategy === "OLOS Mean Reversion") {
        if (c.close < bbl && r < 35) signal = "BUY";
        else if (c.close > bbu && r > 65) signal = "SELL";
      } else if (strategy === "OLOS Breakout") {
        const lb = Math.min(20, i - START);
        const recentHigh = Math.max(...highs.slice(i - lb, i));
        const recentLow = Math.min(...lows.slice(i - lb, i));
        if (c.close > recentHigh * 1.0001 && e20 > e50 && r > 50) signal = "BUY";
        else if (c.close < recentLow * 0.9999 && e20 < e50 && r < 50) signal = "SELL";
      } else if (strategy === "OLOS Trend Follow") {
        const cross = ema20[i - 1] !== undefined && ema50[i - 1] !== undefined;
        if (cross && e20 > e50 && ema20[i - 1]! <= ema50[i - 1]!) signal = "BUY";
        else if (cross && e20 < e50 && ema20[i - 1]! >= ema50[i - 1]!) signal = "SELL";
      } else if (strategy === "OLOS Scalp") {
        if (r < 28 && h > 0) signal = "BUY";
        else if (r > 72 && h < 0) signal = "SELL";
      }

      if (signal) {
        const ep = c.close;
        const sl = signal === "BUY" ? ep - slAtr : ep + slAtr;
        const tp = signal === "BUY" ? ep + tpAtr : ep - tpAtr;
        inTrade = { side: signal, idx: i, ep, sl, tp };
      }
    }
  }

  const w = trades.filter((t) => t.pnlUsd > 0),
    l = trades.filter((t) => t.pnlUsd <= 0);
  const gp = w.reduce((s, t) => s + t.pnlUsd, 0);
  const gl = Math.abs(l.reduce((s, t) => s + t.pnlUsd, 0));
  const totalPnl = gp - gl;
  const returns = trades.map((t) => t.pnlUsd / initialCapital);
  const sharpe = calcSharpe(returns);

  let peak = 0,
    equity = 0,
    maxDD = 0;
  const curve: { time: number; equity: number }[] = [{ time: candles[START]!.time * 1000, equity: initialCapital }];
  for (const t of trades) {
    equity += t.pnlUsd;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
    curve.push({ time: t.exitTime, equity: initialCapital + equity });
  }

  return {
    trades: trades.slice(-20),
    equityCurve: curve,
    metrics: {
      totalTrades: trades.length,
      winTrades: w.length,
      lossTrades: l.length,
      winRate: trades.length ? Math.round((w.length / trades.length) * 1000) / 10 : 0,
      totalPnlUsd: Math.round(totalPnl * 100) / 100,
      grossProfit: Math.round(gp * 100) / 100,
      grossLoss: Math.round(gl * 100) / 100,
      profitFactor: gl === 0 ? (gp > 0 ? 99 : 0) : Math.round((gp / gl) * 100) / 100,
      avgWin: w.length ? Math.round((gp / w.length) * 100) / 100 : 0,
      avgLoss: l.length ? Math.round((gl / l.length) * 100) / 100 : 0,
      sharpeRatio: Math.round(sharpe * 100) / 100,
      maxDrawdown: Math.round(maxDD * 100) / 100,
      maxDrawdownPct: peak > 0 ? Math.round((maxDD / peak) * 1000) / 10 : 0,
    },
  };
}
