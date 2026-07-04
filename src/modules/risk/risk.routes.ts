import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";
import { computeVaR } from "../../common/var-engine";

export const riskRoutes = new Hono<HonoEnv>();
riskRoutes.use("*", jwtAuthMiddleware);

// Ported from apiv2's risk-service/risk.snapshot.service.ts — pure Prisma +
// arithmetic. One simplification: maxDrawdown always reads 0 here since it
// depends on apiv2's TradingAnalyticsService (peak-to-trough equity curve
// analysis), which isn't built yet -- deferred to the analytics/reports
// work. Every other metric (margin level, leverage, concentration,
// parametric VaR, stop-out distance, composite risk score) is faithful.
riskRoutes.get("/snapshot", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const [wallet, positions] = await Promise.all([
    prisma.walletAccount.findUnique({ where: { userId: user.sub } }),
    prisma.position.findMany({
      where: { userId: user.sub, status: "OPEN" },
      select: { marginUsed: true, quantity: true, entryPrice: true, pnl: true, symbol: true },
    }),
  ]);

  if (!wallet) {
    return c.json({
      riskScore: 0,
      marginLevelPct: 9999,
      leverage: 0,
      marginUtilization: 0,
      concentrationRisk: 0,
      varEstimate: 0,
      maxDrawdown: 0,
      stopOutDistance: 100,
    });
  }

  const balance = wallet.balance.toNumber();
  const locked = wallet.locked.toNumber();
  const equity = balance + positions.reduce((s, p) => s + p.pnl.toNumber(), 0);

  const marginUsed = positions.reduce((s, p) => s + p.marginUsed.toNumber(), 0);
  const totalNotional = positions.reduce((s, p) => s + p.quantity.toNumber() * p.entryPrice.toNumber(), 0);

  const marginLevelPct = marginUsed > 0 ? (equity / marginUsed) * 100 : Infinity;
  const leverage = equity > 0 ? totalNotional / equity : 0;
  const marginUtilization = balance > 0 ? (locked / balance) * 100 : 0;
  const largestMargin = positions.reduce((max, p) => Math.max(max, p.marginUsed.toNumber()), 0);
  const concentrationRisk = equity > 0 ? (largestMargin / equity) * 100 : 0;

  const avgDailyVol = 0.012;
  const varEstimate = equity * avgDailyVol * 1.645;
  const maxDrawdown = 0; // see note above — analytics service not built yet

  const stopOutDistance = Number.isFinite(marginLevelPct) ? Math.max(0, ((marginLevelPct - 50) / marginLevelPct) * 100) : 100;

  const marginScore = Number.isFinite(marginLevelPct) ? Math.max(0, 100 - (marginLevelPct - 50) / 10) : 0;
  const ddScore = Math.min(100, maxDrawdown * 3);
  const concScore = Math.min(100, concentrationRisk * 1.5);
  const utilScore = marginUtilization;
  const riskScore = Math.round(0.35 * marginScore + 0.25 * ddScore + 0.2 * concScore + 0.2 * utilScore);

  return c.json({
    riskScore: Math.min(100, Math.max(0, riskScore)),
    marginLevelPct: Number.isFinite(marginLevelPct) ? Math.round(marginLevelPct * 10) / 10 : 9999,
    leverage: Math.round(leverage * 100) / 100,
    marginUtilization: Math.round(marginUtilization * 10) / 10,
    concentrationRisk: Math.round(concentrationRisk * 10) / 10,
    varEstimate: Math.round(varEstimate * 100) / 100,
    maxDrawdown,
    stopOutDistance: Math.round(stopOutDistance * 10) / 10,
    freeMargin: Math.max(0, equity - marginUsed),
    equity,
    balance,
    marginUsed,
  });
});

riskRoutes.get("/var", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const report = await computeVaR(prisma, user.sub);
  return c.json(report);
});

riskRoutes.get("/stress-test", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const report = await computeVaR(prisma, user.sub);
  return c.json({ stressScenarios: report.stressScenarios, equity: report.equity, generatedAt: report.generatedAt });
});

// Risk warnings — apiv2 itself never wires this route to its own RiskWarning
// Prisma model (the route handler reads the in-memory sandbox `state`
// unconditionally, a gap like /client/account). Using the real model here
// instead. No live process generates warnings yet (would need continuous
// margin-level monitoring — deferred to the real-time/Durable Object phase
// or a Cron Trigger sweep in the admin/risk follow-up), so this reads
// whatever exists and returns a clean "no active warning" default otherwise.
riskRoutes.get("/warning/current", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const warning = await prisma.riskWarning.findFirst({
    where: { userId: user.sub, acknowledged: false },
    orderBy: { createdAt: "desc" },
  });
  return c.json(warning ?? null);
});

riskRoutes.get("/warning/dashboard", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const warnings = await prisma.riskWarning.findMany({
    where: { userId: user.sub },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return c.json({ warnings, activeCount: warnings.filter((w) => !w.acknowledged).length });
});

riskRoutes.post("/warning/:id/acknowledge", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const warning = await prisma.riskWarning.findUnique({ where: { id: c.req.param("id") } });
  if (!warning || warning.userId !== user.sub) return c.json({ ok: false, reason: "NOT_FOUND" });

  await prisma.riskWarning.update({
    where: { id: warning.id },
    data: { acknowledged: true, acknowledgedAt: new Date() },
  });
  return c.json({ ok: true });
});
