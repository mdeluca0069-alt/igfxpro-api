import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { validateBody } from "../../common/validate";
import type { HonoEnv } from "../../common/types";
import { AutopilotConfigDto } from "./autopilot.dto";

export const autopilotRoutes = new Hono<HonoEnv>();
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
};

// Ported from apiv2's autopilot-service/autopilot.service.ts config
// CRUD -- pure Prisma. Note: this only stores the client's automation
// preferences; nothing currently *reads* this config to actually place
// autopilot trades (that pipeline depends on the signal generator + a
// continuous evaluation loop, deferred along with real signal generation --
// see the Phase 6 commit notes). Config saved here has no live effect yet.
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
    positions: rows.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      quantity: p.quantity.toNumber(),
      entryPrice: p.entryPrice.toNumber(),
      stopLoss: p.stopLoss?.toNumber() ?? null,
      takeProfit: p.takeProfit?.toNumber() ?? null,
      pnl: p.pnl.toNumber(),
      pnlPercent: p.pnlPercent.toNumber(),
      breakEvenApplied: p.breakEvenApplied,
      trailingActive: p.trailingActive,
      openedAt: p.openedAt.toISOString(),
    })),
  });
});

// No real trades have been opened by autopilot yet (the evaluation pipeline
// that would set openedByAutopilot=true doesn't exist), so this is honestly
// a zeroed report shape rather than a faithful port of a scoring service.
autopilotRoutes.get("/performance", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const closed = await prisma.position.findMany({
    where: { userId: user.sub, status: "CLOSED", openedByAutopilot: true },
  });

  const wins = closed.filter((p) => p.pnl.toNumber() > 0).length;
  const totalPnl = closed.reduce((s, p) => s + p.pnl.toNumber(), 0);

  return c.json({
    totalTrades: closed.length,
    winRate: closed.length ? Math.round((wins / closed.length) * 1000) / 10 : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    generatedAt: new Date().toISOString(),
  });
});
