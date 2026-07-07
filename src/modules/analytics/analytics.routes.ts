import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";

export const analyticsRoutes = new Hono<HonoEnv>();
analyticsRoutes.use("*", jwtAuthMiddleware);

// MyFxBook-style trading analytics report — built entirely from real,
// already-persisted TradeAudit rows (the same append-only audit trail
// trading.routes.ts writes on every open/close). Previously
// /api/v1/analytics/trading/report didn't exist at all, so
// TradingAnalyticsPage.tsx always showed its isError state.
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PNL_BUCKETS = [
  { max: -500, label: "< -$500" },
  { max: -100, label: "-$500 to -$100" },
  { max: -10, label: "-$100 to -$10" },
  { max: 0, label: "-$10 to $0" },
  { max: 10, label: "$0 to $10" },
  { max: 100, label: "$10 to $100" },
  { max: 500, label: "$100 to $500" },
  { max: Infinity, label: "> $500" },
];

type ClosedTrade = {
  id: string;
  symbol: string;
  side: string;
  pnl: number;
  fees: number;
  entryPrice: number;
  exitPrice: number;
  openedAt: Date;
  closedAt: Date;
};

function computeMaxDrawdown(equity: number[]): { pct: number; usd: number } {
  if (equity.length === 0) return { pct: 0, usd: 0 };
  let peak = equity[0]!;
  let maxPct = 0;
  let maxUsd = 0;
  for (const eq of equity) {
    if (eq > peak) peak = eq;
    const ddUsd = peak - eq;
    const ddPct = peak > 0 ? (ddUsd / peak) * 100 : 0;
    if (ddUsd > maxUsd) maxUsd = ddUsd;
    if (ddPct > maxPct) maxPct = ddPct;
  }
  return { pct: maxPct, usd: maxUsd };
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeSharpe(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const sd = stdDev(dailyReturns);
  return sd === 0 ? 0 : (mean / sd) * Math.sqrt(252);
}

function computeSortino(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const downside = dailyReturns.filter((r) => r < 0);
  if (downside.length === 0) return mean > 0 ? 999 : 0;
  const downsideDev = Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length);
  return downsideDev === 0 ? 0 : (mean / downsideDev) * Math.sqrt(252);
}

analyticsRoutes.get("/trading/report", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const daysParam = c.req.query("days");
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");

  const to = toParam ? new Date(`${toParam}T23:59:59.999Z`) : new Date();
  const from = fromParam ? new Date(`${fromParam}T00:00:00.000Z`) : new Date(to.getTime() - (Number(daysParam) || 90) * 86_400_000);
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));

  const audits = await prisma.tradeAudit.findMany({
    where: { userId: user.sub, tradeStatus: "CLOSED", closedAt: { gte: from, lte: to } },
    orderBy: { closedAt: "asc" },
  });

  const trades: ClosedTrade[] = audits.map((a) => ({
    id: a.id,
    symbol: a.symbol,
    side: a.side,
    pnl: (a.pnlRealized?.toNumber() ?? 0) - a.fees.toNumber(),
    fees: a.fees.toNumber(),
    entryPrice: a.entryPrice?.toNumber() ?? 0,
    exitPrice: a.exitPrice?.toNumber() ?? 0,
    openedAt: a.createdAt,
    closedAt: a.closedAt!,
  }));

  if (trades.length === 0) {
    return c.json(emptyReport(from, to, days));
  }

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);
  const sumWin = wins.reduce((s, t) => s + t.pnl, 0);
  const sumLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const winRate = (wins.length / trades.length) * 100;
  const lossRate = 100 - winRate;
  const avgWin = wins.length > 0 ? sumWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? sumLoss / losses.length : 0;
  const profitFactor = sumLoss > 0 ? sumWin / sumLoss : sumWin > 0 ? 999 : 0;
  const expectancy = (winRate / 100) * avgWin - (lossRate / 100) * avgLoss;
  const bestTrade = Math.max(...trades.map((t) => t.pnl));
  const worstTrade = Math.min(...trades.map((t) => t.pnl));

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monAgo = new Date(now.getFullYear(), now.getMonth(), 1);
  const dailyPnl = trades.filter((t) => t.closedAt >= dayAgo).reduce((s, t) => s + t.pnl, 0);
  const weeklyPnl = trades.filter((t) => t.closedAt >= weekAgo).reduce((s, t) => s + t.pnl, 0);
  const monthlyPnl = trades.filter((t) => t.closedAt >= monAgo).reduce((s, t) => s + t.pnl, 0);

  const holdTimes = trades.map((t) => t.closedAt.getTime() - t.openedAt.getTime());
  const avgHoldTimeMs = holdTimes.reduce((s, h) => s + h, 0) / holdTimes.length;
  const winHoldTimes = wins.map((t) => t.closedAt.getTime() - t.openedAt.getTime());
  const lossHoldTimes = losses.map((t) => t.closedAt.getTime() - t.openedAt.getTime());
  const avgHoldTimeWinMs = winHoldTimes.length ? winHoldTimes.reduce((s, h) => s + h, 0) / winHoldTimes.length : 0;
  const avgHoldTimeLossMs = lossHoldTimes.length ? lossHoldTimes.reduce((s, h) => s + h, 0) / lossHoldTimes.length : 0;

  // Daily-bucketed equity curve — starting capital approximated as current
  // wallet balance minus this period's net trading P&L (deposits/withdrawals
  // during the period are not separately ledgered here, so this is a
  // reasonable proxy, not an exact AUM reconstruction).
  const wallet = await prisma.walletAccount.findUnique({ where: { userId: user.sub } });
  const currentBalance = wallet?.balance.toNumber() ?? 0;
  const startingCapital = Math.max(currentBalance - totalPnl, 1);

  const byDay = new Map<string, number>();
  for (const t of trades) {
    const key = t.closedAt.toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + t.pnl);
  }
  const sortedDays = [...byDay.keys()].sort();
  let cum = 0;
  const equityValues: number[] = [startingCapital];
  const equityCurve = sortedDays.map((date) => {
    const dailyPnlForDay = byDay.get(date)!;
    cum += dailyPnlForDay;
    const equity = startingCapital + cum;
    equityValues.push(equity);
    return { date, dailyPnl: Math.round(dailyPnlForDay * 100) / 100, cumPnl: Math.round(cum * 100) / 100 };
  });
  const { pct: maxDrawdown, usd: maxDrawdownUsd } = computeMaxDrawdown(equityValues);

  let peak = equityValues[0]!;
  let running = startingCapital;
  const equityCurveWithDD = equityCurve.map((p) => {
    running = startingCapital + p.cumPnl;
    if (running > peak) peak = running;
    const drawdown = peak > 0 ? ((running - peak) / peak) * 100 : 0;
    return { ...p, drawdown: Math.round(drawdown * 100) / 100 };
  });

  const dailyReturns = [...byDay.values()];
  const sharpeRatio = computeSharpe(dailyReturns);
  const sortinoRatio = computeSortino(dailyReturns);
  const avgDailyPnl = dailyReturns.reduce((s, v) => s + v, 0) / dailyReturns.length;
  const annualizedReturn = avgDailyPnl * 252;
  const annualizedVol = stdDev(dailyReturns) * Math.sqrt(252);
  // Below $100 the "starting capital" proxy is too noisy to extrapolate a
  // meaningful annual rate from (e.g. a near-empty test/demo wallet would
  // otherwise produce absurd four-digit CAGR%) — 0 reads honestly as "N/A"
  // on the frontend rather than a nonsensical number.
  const cagr = startingCapital > 100 ? (totalPnl / startingCapital) * (365 / days) * 100 : 0;
  const calmarRatio = maxDrawdown > 0 ? cagr / maxDrawdown : cagr > 0 ? 999 : 0;
  const recoveryFactor = maxDrawdownUsd > 0 ? totalPnl / maxDrawdownUsd : totalPnl > 0 ? 999 : 0;

  // ── Symbol breakdown ──────────────────────────────────────────────────────
  const bySymbol = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }
  const symbolBreakdown = [...bySymbol.entries()]
    .map(([symbol, ts]) => {
      const sw = ts.filter((t) => t.pnl > 0);
      const sl = ts.filter((t) => t.pnl <= 0);
      const sPnl = ts.reduce((s, t) => s + t.pnl, 0);
      const sSumWin = sw.reduce((s, t) => s + t.pnl, 0);
      const sSumLoss = Math.abs(sl.reduce((s, t) => s + t.pnl, 0));
      return {
        symbol,
        trades: ts.length,
        wins: sw.length,
        losses: sl.length,
        pnl: Math.round(sPnl * 100) / 100,
        winRate: Math.round((sw.length / ts.length) * 1000) / 10,
        profitFactor: sSumLoss > 0 ? Math.round((sSumWin / sSumLoss) * 100) / 100 : sSumWin > 0 ? 999 : 0,
        avgPnl: Math.round((sPnl / ts.length) * 100) / 100,
        avgWin: sw.length ? Math.round((sSumWin / sw.length) * 100) / 100 : 0,
        avgLoss: sl.length ? Math.round((sSumLoss / sl.length) * 100) / 100 : 0,
      };
    })
    .sort((a, b) => b.pnl - a.pnl);

  // ── Hourly / day-of-week / monthly breakdowns ─────────────────────────────
  const hourlyBreakdown = Array.from({ length: 24 }, (_, hour) => {
    const ts = trades.filter((t) => t.closedAt.getUTCHours() === hour);
    const wr = ts.length ? (ts.filter((t) => t.pnl > 0).length / ts.length) * 100 : 0;
    return { hour, trades: ts.length, pnl: Math.round(ts.reduce((s, t) => s + t.pnl, 0) * 100) / 100, winRate: Math.round(wr * 10) / 10 };
  });

  const dowBreakdown = Array.from({ length: 7 }, (_, dow) => {
    const ts = trades.filter((t) => t.closedAt.getUTCDay() === dow);
    const wr = ts.length ? (ts.filter((t) => t.pnl > 0).length / ts.length) * 100 : 0;
    return { dow, day: DOW_NAMES[dow]!, trades: ts.length, pnl: Math.round(ts.reduce((s, t) => s + t.pnl, 0) * 100) / 100, winRate: Math.round(wr * 10) / 10 };
  });

  const byMonth = new Map<string, ClosedTrade[]>();
  for (const t of trades) {
    const key = `${t.closedAt.getUTCFullYear()}-${String(t.closedAt.getUTCMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(t);
  }
  const monthlyBreakdown = [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, ts]) => {
      const [year, mon] = month.split("-");
      const wr = ts.length ? (ts.filter((t) => t.pnl > 0).length / ts.length) * 100 : 0;
      return {
        month,
        label: `${MONTH_NAMES[Number(mon) - 1]} ${year}`,
        pnl: Math.round(ts.reduce((s, t) => s + t.pnl, 0) * 100) / 100,
        trades: ts.length,
        winRate: Math.round(wr * 10) / 10,
      };
    });

  // ── Streaks ────────────────────────────────────────────────────────────────
  let maxWinStreak = 0,
    maxLossStreak = 0,
    curWin = 0,
    curLoss = 0;
  for (const t of trades) {
    if (t.pnl > 0) {
      curWin++;
      curLoss = 0;
      if (curWin > maxWinStreak) maxWinStreak = curWin;
    } else {
      curLoss++;
      curWin = 0;
      if (curLoss > maxLossStreak) maxLossStreak = curLoss;
    }
  }
  const currentStreakType = curWin > 0 ? "WIN" : curLoss > 0 ? "LOSS" : "NONE";
  const currentStreak = curWin > 0 ? curWin : curLoss;

  // ── P&L distribution ──────────────────────────────────────────────────────
  const pnlDistribution = PNL_BUCKETS.map((bucket, i) => {
    const min = i === 0 ? -Infinity : PNL_BUCKETS[i - 1]!.max;
    const inBucket = trades.filter((t) => t.pnl > min && t.pnl <= bucket.max);
    return {
      label: bucket.label,
      count: inBucket.length,
      pnl: Math.round(inBucket.reduce((s, t) => s + t.pnl, 0) * 100) / 100,
      isPositive: bucket.max > 0,
    };
  }).filter((b) => b.count > 0);

  return c.json({
    period: { days, from: from.toISOString(), to: to.toISOString() },
    summary: {
      totalTrades: trades.length,
      winRate: Math.round(winRate * 100) / 100,
      lossRate: Math.round(lossRate * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      expectancy: Math.round(expectancy * 100) / 100,
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 100) / 100,
      maxDrawdownUsd: Math.round(maxDrawdownUsd * 100) / 100,
      sharpeRatio: Math.round(sharpeRatio * 1000) / 1000,
      sortinoRatio: Math.round(sortinoRatio * 1000) / 1000,
      calmarRatio: Math.round(calmarRatio * 100) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      bestTrade: Math.round(bestTrade * 100) / 100,
      worstTrade: Math.round(worstTrade * 100) / 100,
      avgHoldTimeMs: Math.round(avgHoldTimeMs),
      avgHoldTimeWinMs: Math.round(avgHoldTimeWinMs),
      avgHoldTimeLossMs: Math.round(avgHoldTimeLossMs),
      dailyPnl: Math.round(dailyPnl * 100) / 100,
      weeklyPnl: Math.round(weeklyPnl * 100) / 100,
      monthlyPnl: Math.round(monthlyPnl * 100) / 100,
      annualizedReturn: Math.round(annualizedReturn * 100) / 100,
      annualizedVol: Math.round(annualizedVol * 100) / 100,
      recoveryFactor: Math.round(recoveryFactor * 100) / 100,
      cagr: Math.round(cagr * 100) / 100,
    },
    equityCurve: equityCurveWithDD,
    trades: trades
      .slice()
      .reverse()
      .slice(0, 500)
      .map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        pnl: Math.round(t.pnl * 100) / 100,
        fees: Math.round(t.fees * 100) / 100,
        durationMs: t.closedAt.getTime() - t.openedAt.getTime(),
        openedAt: t.openedAt.toISOString(),
        closedAt: t.closedAt.toISOString(),
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
      })),
    symbolBreakdown,
    hourlyBreakdown,
    dowBreakdown,
    monthlyBreakdown,
    streaks: { maxWinStreak, maxLossStreak, currentStreak, currentStreakType },
    pnlDistribution,
  });
});

function emptyReport(from: Date, to: Date, days: number) {
  return {
    period: { days, from: from.toISOString(), to: to.toISOString() },
    summary: {
      totalTrades: 0, winRate: 0, lossRate: 0, profitFactor: 0, expectancy: 0,
      totalPnl: 0, totalFees: 0, maxDrawdown: 0, maxDrawdownUsd: 0,
      sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0, avgWin: 0, avgLoss: 0,
      bestTrade: 0, worstTrade: 0, avgHoldTimeMs: 0, avgHoldTimeWinMs: 0, avgHoldTimeLossMs: 0,
      dailyPnl: 0, weeklyPnl: 0, monthlyPnl: 0, annualizedReturn: 0, annualizedVol: 0,
      recoveryFactor: 0, cagr: 0,
    },
    equityCurve: [],
    trades: [],
    symbolBreakdown: [],
    hourlyBreakdown: Array.from({ length: 24 }, (_, hour) => ({ hour, trades: 0, pnl: 0, winRate: 0 })),
    dowBreakdown: DOW_NAMES.map((day, dow) => ({ dow, day, trades: 0, pnl: 0, winRate: 0 })),
    monthlyBreakdown: [],
    streaks: { maxWinStreak: 0, maxLossStreak: 0, currentStreak: 0, currentStreakType: "NONE" },
    pnlDistribution: [],
  };
}
