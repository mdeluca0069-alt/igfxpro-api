import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { NotFoundException } from "../../common/http-exceptions";
import type { HonoEnv } from "../../common/types";

export const reportsRoutes = new Hono<HonoEnv>();
reportsRoutes.use("*", jwtAuthMiddleware);

// ── Trade confirmation (per order) ──────────────────────────────────────────
// Ported from apiv2's gateway/routes.ts GET /reports/confirmation/:orderId.
reportsRoutes.get("/confirmation/:orderId", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const order = await prisma.order.findFirst({ where: { id: c.req.param("orderId"), userId: user.sub } });
  if (!order) throw new NotFoundException("Order not found");

  return c.json({
    confirmation: {
      orderId: order.id,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      status: order.status,
      quantity: order.quantity.toNumber(),
      filledQuantity: order.filledQuantity.toNumber(),
      averageFillPrice: order.averageFillPrice?.toNumber() ?? null,
      notional: order.notional.toNumber(),
      leverage: order.leverage,
      fees: order.fees.toNumber(),
      rejectionReason: order.rejectionReason ?? null,
      placedAt: order.createdAt.toISOString(),
      filledAt: order.filledAt?.toISOString() ?? null,
      broker: "IGFXPRO",
      currency: "USD",
      regulatoryNote: "This confirmation is provided in accordance with MiFID II Article 25.",
    },
  });
});

// ── Trade history report (from TradeAudit) ──────────────────────────────────
// Ported from apiv2's gateway/routes.ts GET /reports/trades.
reportsRoutes.get("/trades", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 500);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const symbol = c.req.query("symbol");
  const status = c.req.query("status");
  const from = c.req.query("from") ? new Date(c.req.query("from")!) : undefined;
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : undefined;

  const where: Record<string, unknown> = { userId: user.sub };
  if (symbol) where.symbol = symbol;
  if (status) where.tradeStatus = status;
  if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

  const [trades, total] = await Promise.all([
    prisma.tradeAudit.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip: offset }),
    prisma.tradeAudit.count({ where }),
  ]);

  return c.json({ trades, total });
});

// ── P&L summary report ──────────────────────────────────────────────────────
// Ported from apiv2's analytics/trading.analytics.service.ts getStats, with
// the LedgerEntry fallback path collapsed into the same query shape.
reportsRoutes.get("/pnl-summary", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const monAgo = new Date(now.getFullYear(), now.getMonth(), 1);

  const audits = await prisma.tradeAudit.findMany({
    where: { userId: user.sub, tradeStatus: { in: ["CLOSED", "PARTIAL"] }, closedAt: { not: null } },
    orderBy: { closedAt: "asc" },
    select: { pnlRealized: true, fees: true, createdAt: true, closedAt: true },
  });

  if (audits.length === 0) return c.json(emptyStats());

  let totalPnl = 0,
    dailyPnl = 0,
    weeklyPnl = 0,
    monthlyPnl = 0;
  let totalWins = 0,
    totalLosses = 0;
  let sumWin = 0,
    sumLoss = 0;
  let best = -Infinity,
    worst = Infinity;
  let totalFees = 0;
  let totalDurationMs = 0;
  const equityCurve: number[] = [];
  let runningEquity = 0;
  const dailyReturnMap = new Map<string, number>();

  for (const a of audits) {
    const pnl = a.pnlRealized?.toNumber() ?? 0;
    const fee = a.fees.toNumber();
    const net = pnl - fee;
    const closed = a.closedAt!;

    totalPnl += net;
    totalFees += fee;
    totalDurationMs += closed.getTime() - a.createdAt.getTime();

    if (net > 0) {
      totalWins++;
      sumWin += net;
    } else {
      totalLosses++;
      sumLoss += Math.abs(net);
    }
    if (net > best) best = net;
    if (net < worst) worst = net;
    if (closed >= dayAgo) dailyPnl += net;
    if (closed >= weekAgo) weeklyPnl += net;
    if (closed >= monAgo) monthlyPnl += net;

    runningEquity += net;
    equityCurve.push(runningEquity);
    const dayKey = closed.toISOString().slice(0, 10);
    dailyReturnMap.set(dayKey, (dailyReturnMap.get(dayKey) ?? 0) + net);
  }

  const totalTrades = audits.length;
  const winRate = (totalWins / totalTrades) * 100;
  const avgWin = totalWins > 0 ? sumWin / totalWins : 0;
  const avgLoss = totalLosses > 0 ? sumLoss / totalLosses : 0;
  const profitFactor = avgLoss > 0 ? sumWin / sumLoss : sumWin > 0 ? 999 : 0;
  const lossRate = 100 - winRate;
  const expectancy = (winRate / 100) * avgWin - (lossRate / 100) * avgLoss;
  const maxDrawdown = computeMaxDrawdown(equityCurve);
  const sharpeRatio = computeSharpe(Array.from(dailyReturnMap.values()));
  const avgTradeDurationMs = totalDurationMs / totalTrades;

  return c.json({
    dailyPnl,
    weeklyPnl,
    monthlyPnl,
    totalPnl,
    winRate: Math.round(winRate * 100) / 100,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 1000) / 1000,
    avgTradeDurationMs,
    totalTrades,
    bestTrade: best === -Infinity ? 0 : best,
    worstTrade: worst === Infinity ? 0 : worst,
    totalFees,
  });
});

function emptyStats() {
  return {
    dailyPnl: 0,
    weeklyPnl: 0,
    monthlyPnl: 0,
    totalPnl: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    expectancy: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    avgTradeDurationMs: 0,
    totalTrades: 0,
    bestTrade: 0,
    worstTrade: 0,
    totalFees: 0,
  };
}

function computeMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  let peak = equityCurve[0]!;
  let maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

function computeSharpe(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean / stdDev) * Math.sqrt(252);
}
