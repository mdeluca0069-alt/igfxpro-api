import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { validateBody } from "../../common/validate";
import type { HonoEnv } from "../../common/types";
import { AutopilotConfigDto } from "./autopilot.dto";
import { INSTRUMENT_META } from "../../common/instruments";

export const autopilotRoutes = new Hono<HonoEnv>();

// Public (unauthenticated) — must be registered before the "*" auth
// middleware below, since Hono's onion-model middleware chain only applies
// to routes matched after a .use() call's registration point. This is the
// exact path the public homepage calls (/api/v1/autopilot/stats/public),
// which would otherwise 401 by falling inside this router's own "/autopilot"
// prefix before ever reaching the separate public-stats.routes.ts module.
// Shape must match ProfessionalHomepage.tsx's AutopilotStats type exactly
// (status/activeBots/tradesLast24h/sessionPnl/winRate/recentActivity) — a
// previous version used different field names (pnl24h/trades24h/winRatePct,
// no status/recentActivity at all), which crashed the page with "Cannot
// read properties of undefined (reading 'toFixed')" the moment any UI path
// tried to read the (nonexistent) field. The frontend only actually reads
// sessionPnl/tradesLast24h/winRate/recentActivity when status === "REAL",
// so status must accurately reflect whether there's real data to show.
autopilotRoutes.get("/stats/public", async (c) => {
  const prisma = getPrisma(c.env);
  const since24h = new Date(Date.now() - 86_400_000);

  const [activeBots, closedTrades24h, recentPositions] = await Promise.all([
    prisma.autopilotConfig.count({ where: { enabled: true } }),
    prisma.position.findMany({
      where: { openedByAutopilot: true, status: "CLOSED", closedAt: { gte: since24h } },
      select: { pnl: true },
    }),
    prisma.position.findMany({
      where: { openedByAutopilot: true },
      orderBy: { openedAt: "desc" },
      take: 5,
      select: { symbol: true, side: true, status: true, pnl: true, openedAt: true, closedAt: true },
    }),
  ]);

  const sessionPnl = closedTrades24h.reduce((s, p) => s + p.pnl.toNumber(), 0);
  const wins = closedTrades24h.filter((p) => p.pnl.toNumber() > 0).length;
  const winRate = closedTrades24h.length > 0 ? Math.round((wins / closedTrades24h.length) * 1000) / 10 : 0;

  const recentActivity = recentPositions.map((p) => {
    const pnl = p.pnl.toNumber();
    const text = p.status === "CLOSED" ? `${p.side} ${p.symbol} closed ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : `${p.side} ${p.symbol} opened`;
    return { symbol: p.symbol, text, at: (p.closedAt ?? p.openedAt).toISOString() };
  });

  return c.json({
    status: activeBots > 0 ? "REAL" : "NO_DATA",
    activeBots,
    tradesLast24h: closedTrades24h.length,
    sessionPnl,
    winRate,
    recentActivity,
  });
});

autopilotRoutes.use("*", jwtAuthMiddleware);

const CURRENT_CONSENT_VERSION = "2026-06-30-v1";
const CONSENT_TEXT =
  "Automated trading amplifies both profits and losses. Autopilot does not guarantee profitability. " +
  "CFDs involve significant risk of loss. Capital at risk: only use funds you can afford to lose. " +
  "By activating Autopilot you confirm you understand and accept these risks, and that trades will be " +
  "opened and managed automatically on your behalf within the limits you configure.";

const DEFAULTS = {
  enabled: false,
  mode: "BALANCED",
  minConfidence: 0.7,
  maxRiskPerTrade: 0.05,
  maxOpenTrades: 3,
  maxExposurePct: 20,
  allowedSymbols: [] as string[],
  blockedSymbols: [] as string[],
  stopDrawdownPct: 10,
  capitalPct: 100,
  eventLockMinutes: 30,
  maxDailyTrades: 10,
  breakEvenTriggerR: 1.0,
  trailingStopEnabled: true,
  trailingActivationR: 1.5,
  atrTrailMultiple: 2.0,
  regimeExitEnabled: true,
  maxHoursOpen: 48,
  maxDailyLossPct: 5.0,
  maxSpreadBps: 15,
};

// Ported from apiv2's autopilot-service/autopilot.service.ts config CRUD —
// pure Prisma. autopilot-engine.ts (Fase 9 follow-up) reads this every 15
// minutes and actually places trades; this is no longer inert configuration.
// The trade-management/safety fields below (eventLockMinutes..maxSpreadBps)
// already existed on the Prisma model and are read by autopilot-engine.ts,
// but this GET/POST pair never exposed them — every save silently only
// persisted the first 8 fields and the frontend's "Trade management"/
// "Safety limits" panels always showed their local hardcoded defaults.
autopilotRoutes.get("/config", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const cfg = await prisma.autopilotConfig.findUnique({ where: { userId: user.sub } });
  if (!cfg) return c.json({ userId: user.sub, ...DEFAULTS, tier: "STANDARD", activeRules: [] });

  return c.json({
    userId: cfg.userId,
    enabled: cfg.enabled,
    mode: cfg.mode,
    minConfidence: cfg.minConfidence,
    maxRiskPerTrade: cfg.maxRiskPerTrade,
    maxOpenTrades: cfg.maxOpenTrades,
    maxExposurePct: cfg.maxExposurePct,
    allowedSymbols: cfg.allowedSymbols,
    blockedSymbols: cfg.blockedSymbols,
    stopDrawdownPct: cfg.stopDrawdownPct,
    capitalPct: cfg.capitalPct,
    eventLockMinutes: cfg.eventLockMinutes,
    maxDailyTrades: cfg.maxDailyTrades,
    breakEvenTriggerR: cfg.breakEvenTriggerR,
    trailingStopEnabled: cfg.trailingStopEnabled,
    trailingActivationR: cfg.trailingActivationR,
    atrTrailMultiple: cfg.atrTrailMultiple,
    regimeExitEnabled: cfg.regimeExitEnabled,
    maxHoursOpen: cfg.maxHoursOpen,
    maxDailyLossPct: cfg.maxDailyLossPct,
    maxSpreadBps: cfg.maxSpreadBps,
    consentAcceptedAt: cfg.consentAcceptedAt?.toISOString(),
    dailyLossLockedUntil: cfg.dailyLossLockedUntil?.toISOString(),
    pausedByAdmin: cfg.pausedByAdmin,
    pausedReason: cfg.pausedReason ?? undefined,
    lastDecision: cfg.lastDecision ?? undefined,
    updatedAt: cfg.updatedAt.toISOString(),
    tier: "STANDARD",
    activeRules: [],
  });
});

autopilotRoutes.post("/config", async (c) => {
  const user = c.get("user")!;
  const dto = await validateBody(AutopilotConfigDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const existing = await prisma.autopilotConfig.findUnique({ where: { userId: user.sub } });
  if (dto.enabled && !existing?.consentAcceptedAt) {
    return c.json({ ok: false, reason: "CONSENT_REQUIRED" });
  }

  const cfg = await prisma.autopilotConfig.upsert({
    where: { userId: user.sub },
    create: { userId: user.sub, ...DEFAULTS, ...dto },
    update: { ...dto },
  });

  return c.json({ ok: true, config: cfg });
});

autopilotRoutes.get("/consent", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const cfg = await prisma.autopilotConfig.findUnique({
    where: { userId: user.sub },
    select: { consentVersion: true, consentAcceptedAt: true },
  });
  const accepted = cfg?.consentVersion === CURRENT_CONSENT_VERSION && !!cfg.consentAcceptedAt;
  return c.json({ ok: true, version: CURRENT_CONSENT_VERSION, text: CONSENT_TEXT, accepted });
});

autopilotRoutes.post("/consent", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const acceptedAt = new Date();

  await prisma.autopilotConsent.create({
    data: { id: randomUUID(), userId: user.sub, version: CURRENT_CONSENT_VERSION, acceptedAt },
  });
  await prisma.autopilotConfig.upsert({
    where: { userId: user.sub },
    create: { userId: user.sub, ...DEFAULTS, consentVersion: CURRENT_CONSENT_VERSION, consentAcceptedAt: acceptedAt },
    update: { consentVersion: CURRENT_CONSENT_VERSION, consentAcceptedAt: acceptedAt },
  });

  return c.json({ ok: true });
});

autopilotRoutes.get("/positions", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const rows = await prisma.position.findMany({
    where: { userId: user.sub, status: "OPEN", openedByAutopilot: true },
    orderBy: { openedAt: "desc" },
  });

  return c.json({
    ok: true,
    positions: rows.map((p) => {
      const entry = p.entryPrice.toNumber();
      const sl = p.stopLoss?.toNumber() ?? null;
      const contractSize = INSTRUMENT_META[p.symbol]?.contractSize ?? 1;
      const riskAmount = sl !== null ? Math.abs(entry - sl) * p.quantity.toNumber() * contractSize : 0;
      const rMultiple = riskAmount > 0 ? Math.round((p.pnl.toNumber() / riskAmount) * 100) / 100 : null;

      return {
        id: p.id,
        symbol: p.symbol,
        side: p.side,
        quantity: p.quantity.toNumber(),
        entryPrice: entry,
        stopLoss: sl,
        takeProfit: p.takeProfit?.toNumber() ?? null,
        pnl: p.pnl.toNumber(),
        pnlPercent: p.pnlPercent.toNumber(),
        rMultiple,
        breakEvenApplied: p.breakEvenApplied,
        trailingActive: p.trailingActive,
        openedAt: p.openedAt.toISOString(),
      };
    }),
  });
});

// Real report built from actual Position rows tagged openedByAutopilot —
// previously returned only {totalTrades, winRate, totalPnl, generatedAt},
// which crashed AutopilotDashboard.tsx at "performance.recentTrades.length"
// since recentTrades didn't exist. Now matches the frontend's
// AutopilotPerformance type exactly.
autopilotRoutes.get("/performance", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const [open, closed] = await Promise.all([
    prisma.position.findMany({ where: { userId: user.sub, status: "OPEN", openedByAutopilot: true } }),
    prisma.position.findMany({
      where: { userId: user.sub, status: "CLOSED", openedByAutopilot: true },
      orderBy: { closedAt: "desc" },
    }),
  ]);

  const wins = closed.filter((p) => p.pnl.toNumber() > 0).length;
  const totalPnl = closed.reduce((s, p) => s + p.pnl.toNumber(), 0);
  const totalPnlOpen = open.reduce((s, p) => s + p.pnl.toNumber(), 0);

  const holdHours = closed
    .filter((p) => p.closedAt)
    .map((p) => (p.closedAt!.getTime() - p.openedAt.getTime()) / 3_600_000);
  const avgHoldHours = holdHours.length ? Math.round((holdHours.reduce((s, h) => s + h, 0) / holdHours.length) * 10) / 10 : null;

  const recentTrades = [...open, ...closed]
    .sort((a, b) => (b.closedAt ?? b.openedAt).getTime() - (a.closedAt ?? a.openedAt).getTime())
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      pnl: p.pnl.toNumber(),
      status: p.status,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString() ?? null,
    }));

  return c.json({
    status: open.length + closed.length > 0 ? "REAL" : "NO_DATA",
    openCount: open.length,
    closedCount: closed.length,
    winCount: wins,
    winRate: closed.length ? Math.round((wins / closed.length) * 1000) / 10 : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlOpen: Math.round(totalPnlOpen * 100) / 100,
    avgHoldHours,
    recentTrades,
    generatedAt: new Date().toISOString(),
  });
});
