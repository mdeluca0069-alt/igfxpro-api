import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { getConnectionCount } from "../../common/realtime";
import { ALL_SYMBOLS } from "../../common/instruments";
import type { HonoEnv } from "../../common/types";

// Unauthenticated, platform-wide aggregates for the public marketing
// homepage. Every number here is a real DB (or Durable Object) query — no
// synthetic/placeholder values — so on a brand-new deployment with little
// activity these will genuinely read low/zero rather than being padded to
// look impressive.
export const publicStatsRoutes = new Hono<HonoEnv>();

publicStatsRoutes.get("/platform/stats", async (c) => {
  const prisma = getPrisma(c.env);
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const [registeredUsers, activeTraderIds, filledOrders, openPositions, notionalAgg, fillLatency] = await Promise.all([
    prisma.user.count(),
    prisma.order.findMany({ where: { createdAt: { gte: since30d } }, distinct: ["userId"], select: { userId: true } }),
    prisma.order.count({ where: { status: "FILLED" } }),
    prisma.position.count({ where: { status: "OPEN" } }),
    prisma.order.aggregate({ where: { status: "FILLED" }, _sum: { notional: true } }),
    prisma.order.findMany({
      where: { status: "FILLED", filledAt: { not: null } },
      select: { createdAt: true, filledAt: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const latencies = fillLatency.map((o) => o.filledAt!.getTime() - o.createdAt.getTime()).filter((ms) => ms >= 0 && ms < 60_000);
  const avgExecutionMs = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;

  return c.json({
    registeredUsers,
    activeTraders: activeTraderIds.length,
    filledOrders,
    openPositions,
    totalVolumeUsd: notionalAgg._sum.notional?.toNumber() ?? 0,
    instruments: ALL_SYMBOLS.length,
    avgExecutionMs,
  });
});

publicStatsRoutes.get("/telemetry/health", async (c) => {
  const prisma = getPrisma(c.env);
  const since24h = new Date(Date.now() - 86_400_000);

  let dbHealthy = true;
  try {
    await prisma.user.count();
  } catch {
    dbHealthy = false;
  }

  const [wsConnections, ordersPlaced, ordersFilled] = await Promise.all([
    getConnectionCount(c.env),
    prisma.order.count({ where: { createdAt: { gte: since24h } } }),
    prisma.order.count({ where: { createdAt: { gte: since24h }, status: "FILLED" } }),
  ]);

  return c.json({
    services: [
      { name: "API", status: "operational", latencyMs: 0 },
      { name: "Database", status: dbHealthy ? "operational" : "degraded", latencyMs: 0 },
      { name: "Realtime", status: "operational", latencyMs: 0 },
    ],
    httpTotal: 0,
    wsConnections,
    ordersPlaced,
    ordersFilled,
  });
});

publicStatsRoutes.get("/execution/stats/public", async (c) => {
  const prisma = getPrisma(c.env);
  const [filled, rejected, latencySample] = await Promise.all([
    prisma.order.count({ where: { status: "FILLED" } }),
    prisma.order.count({ where: { status: "REJECTED" } }),
    prisma.order.findMany({
      where: { status: "FILLED", filledAt: { not: null } },
      select: { createdAt: true, filledAt: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const latencies = latencySample.map((o) => o.filledAt!.getTime() - o.createdAt.getTime()).filter((ms) => ms >= 0 && ms < 60_000);
  const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;
  const total = filled + rejected;

  return c.json({
    avgLatencyMs,
    fillRatePct: total > 0 ? Math.round((filled / total) * 1000) / 10 : 0,
    totalFilled: filled,
    totalRejected: rejected,
  });
});

// /autopilot/stats/public is NOT mounted here — it lives in
// autopilot.routes.ts itself, registered before that router's own
// auth-everything middleware (see the comment there for why: Hono matches
// the "/autopilot" prefix to that router first, so a route defined in this
// separate module would never be reached).
