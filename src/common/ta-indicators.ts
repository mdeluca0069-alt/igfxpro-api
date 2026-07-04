// Ported as-is from igfxpro-apiv2/ai-core/ai.router.ts — pure indicator
// math, no framework dependency.
import type { Candle } from "./twelvedata";

export function calcEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i]! * k + out[i - 1]! * (1 - k));
  }
  return out;
}

export function calcRSI(values: number[], period = 14): number[] {
  if (values.length < period + 1) return Array(values.length).fill(50);
  const rsi: number[] = Array(period).fill(50);
  const gains = values.slice(1).map((v, i) => Math.max(0, v - values[i]!));
  const losses = values.slice(1).map((v, i) => Math.max(0, values[i]! - v));
  let ag = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let al = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < gains.length; i++) {
    ag = (ag * (period - 1) + gains[i]!) / period;
    al = (al * (period - 1) + losses[i]!) / period;
    rsi.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return rsi;
}

export function calcMACD(values: number[]) {
  const ema12 = calcEMA(values, 12);
  const ema26 = calcEMA(values, 26);
  const macd = ema12.map((v, i) => v - ema26[i]!);
  const sig = calcEMA(macd, 9);
  const hist = macd.map((v, i) => v - sig[i]!);
  return { macd, sig, hist };
}

export function calcBollinger(values: number[], period = 20, mult = 2) {
  const upper: number[] = [],
    mid: number[] = [],
    lower: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
    mid.push(mean);
    upper.push(mean + mult * std);
    lower.push(mean - mult * std);
  }
  return { upper, mid, lower };
}

export function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs = candles
    .slice(1)
    .map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i]!.close), Math.abs(c.low - candles[i]!.close)));
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function pearsonCorr(x: number[], y: number[], n = 60): number {
  const len = Math.min(x.length, y.length, n);
  if (len < 5) return 0;
  const xs = x.slice(-len),
    ys = y.slice(-len);
  const mx = xs.reduce((a, b) => a + b, 0) / len;
  const my = ys.reduce((a, b) => a + b, 0) / len;
  let xy = 0,
    xx = 0,
    yy = 0;
  for (let i = 0; i < len; i++) {
    const dx = xs[i]! - mx,
      dy = ys[i]! - my;
    xy += dx * dy;
    xx += dx * dx;
    yy += dy * dy;
  }
  const d = Math.sqrt(xx * yy);
  return d === 0 ? 0 : Math.max(-1, Math.min(1, xy / d));
}

export function calcSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const std = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);
  return std === 0 ? 0 : (mean / std) * Math.sqrt(252);
}
