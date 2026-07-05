import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { rolesMiddleware } from "../../common/middleware/roles.middleware";
import { validateBody } from "../../common/validate";
import { BadRequestException, NotFoundException } from "../../common/http-exceptions";
import { pushToUser } from "../../common/realtime";
import type { HonoEnv } from "../../common/types";
import {
  CapitalOpDto,
  DocumentReviewDto,
  LedgerReviewDto,
  TierUpdateDto,
  KycUpdateDto,
  KillSwitchDto,
  LiquidityUpdateDto,
} from "./admin.dto";

export const adminRoutes = new Hono<HonoEnv>();
adminRoutes.use("*", jwtAuthMiddleware);
adminRoutes.use("*", rolesMiddleware("admin", "super_admin"));

// ── Overview / client accounts ──────────────────────────────────────────────

adminRoutes.get("/overview", async (c) => {
  const prisma = getPrisma(c.env);
  const [users, orders, positions, pendingDeposits, pendingWithdrawals, pendingKyc] = await Promise.all([
    prisma.user.count(),
    prisma.order.count(),
    prisma.position.count({ where: { status: "OPEN" } }),
    prisma.ledgerEntry.count({ where: { type: "DEPOSIT_REQUEST", status: "PENDING_ADMIN" } }),
    prisma.ledgerEntry.count({ where: { type: "WITHDRAW_REQUEST", status: "PENDING_ADMIN" } }),
    prisma.kycCase.count({ where: { status: "SUBMITTED" } }),
  ]);

  return c.json({
    overview: {
      realRegisteredUsers: users,
      kycQueue: pendingKyc,
      orders,
      openPositions: positions,
      pendingDeposits,
      pendingWithdrawals,
    },
  });
});

adminRoutes.get("/client-accounts", async (c) => {
  const prisma = getPrisma(c.env);
  const users = await prisma.user.findMany({
    include: { WalletAccount: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return c.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      tier: u.tier,
      kycStatus: u.kycStatus,
      role: u.role,
      balance: u.WalletAccount?.balance.toNumber() ?? 0,
      createdAt: u.createdAt.toISOString(),
    }))
  );
});

adminRoutes.get("/client/:email", async (c) => {
  const prisma = getPrisma(c.env);
  const user = await prisma.user.findUnique({
    where: { email: c.req.param("email") },
    include: { WalletAccount: true, KycCase: true, ClientDocument: true },
  });
  if (!user) return c.json({ ok: false, reason: "NOT_FOUND" });

  const [positions, orders] = await Promise.all([
    prisma.position.findMany({ where: { userId: user.id, status: "OPEN" } }),
    prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  return c.json({
    profile: { id: user.id, email: user.email, fullName: user.fullName, tier: user.tier, kycStatus: user.kycStatus, role: user.role },
    wallet: user.WalletAccount,
    kycCase: user.KycCase,
    documents: user.ClientDocument,
    openPositions: positions,
    recentOrders: orders,
  });
});

// ── Capital operations (direct admin credit/debit, no pending request) ─────
// Ported from apiv2's admin capital allocate/withdraw semantics: unlike
// /admin/ledger/review below (which resolves a *client-submitted* pending
// request), these let an admin adjust a client's capital directly (e.g.
// compensation, manual correction).

adminRoutes.post("/capital/allocate", async (c) => {
  const dto = await validateBody(CapitalOpDto, await c.req.json());
  const prisma = getPrisma(c.env);

  await prisma.walletAccount.upsert({
    where: { userId: dto.userId },
    create: { userId: dto.userId, currency: "USD", balance: dto.amount, equity: dto.amount, locked: 0 },
    update: { balance: { increment: dto.amount } },
  });

  await prisma.ledgerEntry.create({
    data: {
      id: randomUUID(),
      userId: dto.userId,
      currency: "USD",
      amount: dto.amount,
      type: "ADMIN_CAPITAL_ALLOCATION",
      reference: `ADMIN:${c.get("user")!.sub}`,
      status: "COMPLETED",
      note: dto.note ?? "Admin capital allocation",
      debitAccount: "BROKER_FLOAT",
      creditAccount: `CLIENT:${dto.userId}`,
    },
  });

  return c.json({ ok: true });
});

adminRoutes.post("/capital/withdraw", async (c) => {
  const dto = await validateBody(CapitalOpDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const wallet = await prisma.walletAccount.findUnique({ where: { userId: dto.userId } });
  if (!wallet || wallet.balance.toNumber() < dto.amount) {
    throw new BadRequestException("INSUFFICIENT_BALANCE");
  }

  await prisma.walletAccount.update({ where: { userId: dto.userId }, data: { balance: { decrement: dto.amount } } });
  await prisma.ledgerEntry.create({
    data: {
      id: randomUUID(),
      userId: dto.userId,
      currency: "USD",
      amount: -dto.amount,
      type: "ADJUSTMENT",
      reference: `ADMIN:${c.get("user")!.sub}`,
      status: "COMPLETED",
      note: dto.note ?? "Admin capital withdrawal",
      debitAccount: `CLIENT:${dto.userId}`,
      creditAccount: "BROKER_FLOAT",
    },
  });

  return c.json({ ok: true });
});

// ── Ledger review — approve/reject a client-submitted DEPOSIT_REQUEST or
// WITHDRAW_REQUEST (the PENDING_ADMIN entries created in Phase 4's
// /client/deposit and /client/withdraw). This is the real completion of
// that flow.
adminRoutes.post("/ledger/review", async (c) => {
  const dto = await validateBody(LedgerReviewDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const entry = await prisma.ledgerEntry.findUnique({ where: { id: dto.ledgerId } });
  if (!entry || entry.userId !== dto.userId) throw new NotFoundException("Ledger entry not found");
  if (entry.status !== "PENDING_ADMIN") throw new BadRequestException("ENTRY_NOT_PENDING");

  if (dto.status === "REJECTED") {
    await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { status: "REJECTED" } });
    await prisma.auditLog.create({
      data: { id: randomUUID(), actor: c.get("user")!.sub, action: "ledger.rejected", entity: entry.id, payload: { userId: dto.userId, note: dto.note ?? "" } },
    });
    return c.json({ ok: true });
  }

  // APPROVED
  await prisma.$transaction(async (tx) => {
    if (entry.type === "DEPOSIT_REQUEST") {
      const amount = entry.amount.toNumber();
      const wallet = await tx.walletAccount.upsert({
        where: { userId: dto.userId },
        create: { userId: dto.userId, currency: "USD", balance: amount, equity: amount, locked: 0 },
        update: { balance: { increment: amount } },
      });
      await tx.ledgerEntry.create({
        data: {
          id: randomUUID(),
          userId: dto.userId,
          currency: "USD",
          amount,
          type: "ADMIN_CAPITAL_ALLOCATION",
          reference: `APPROVED:${entry.reference}`,
          status: "COMPLETED",
          note: `Capital credited from approved deposit ${entry.reference}`,
          runningBalance: wallet.balance,
          debitAccount: "BROKER_FLOAT",
          creditAccount: `CLIENT:${dto.userId}`,
        },
      });
    } else if (entry.type === "WITHDRAW_REQUEST") {
      const amount = Math.abs(entry.amount.toNumber());
      const wallet = await tx.walletAccount.findUnique({ where: { userId: dto.userId } });
      if (!wallet || wallet.balance.toNumber() < amount) throw new Error("INSUFFICIENT_BALANCE");
      const updated = await tx.walletAccount.update({ where: { userId: dto.userId }, data: { balance: { decrement: amount } } });
      await tx.ledgerEntry.create({
        data: {
          id: randomUUID(),
          userId: dto.userId,
          currency: "USD",
          amount: -amount,
          type: "WITHDRAW_REQUEST",
          reference: `APPROVED:${entry.reference}`,
          status: "COMPLETED",
          note: `Capital debited from approved withdrawal ${entry.reference}`,
          runningBalance: updated.balance,
          debitAccount: `CLIENT:${dto.userId}`,
          creditAccount: "BROKER_FLOAT",
        },
      });
    }

    await tx.ledgerEntry.update({ where: { id: entry.id }, data: { status: "APPROVED" } });
  });

  await pushToUser(c.env, dto.userId, "wallet.updated", {});

  return c.json({ ok: true });
});

// ── Documents review (KYC/ClientDocument, from Phase 4 upload) ─────────────
adminRoutes.post("/documents/review", async (c) => {
  const dto = await validateBody(DocumentReviewDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const doc = await prisma.clientDocument.findUnique({ where: { id: dto.documentId } });
  if (!doc || doc.userId !== dto.userId) throw new NotFoundException("Document not found");

  const updated = await prisma.clientDocument.update({
    where: { id: doc.id },
    data: { status: dto.status, rejectionReason: dto.status === "REJECTED" ? dto.rejectionReason : null },
  });

  return c.json({ ok: true, document: updated });
});

// ── Tier / KYC status updates ───────────────────────────────────────────────
adminRoutes.post("/client/tier", async (c) => {
  const dto = await validateBody(TierUpdateDto, await c.req.json());
  const prisma = getPrisma(c.env);
  const user = await prisma.user.update({ where: { id: dto.userId }, data: { tier: dto.tier } });
  return c.json({ ok: true, user: { id: user.id, tier: user.tier } });
});

adminRoutes.post("/client/kyc", async (c) => {
  const dto = await validateBody(KycUpdateDto, await c.req.json());
  const prisma = getPrisma(c.env);
  const user = await prisma.user.update({ where: { id: dto.userId }, data: { kycStatus: dto.kycStatus } });
  await pushToUser(c.env, dto.userId, "kyc.updated", { kycStatus: user.kycStatus });
  return c.json({ ok: true, user: { id: user.id, kycStatus: user.kycStatus } });
});

// ── KYC case queue ───────────────────────────────────────────────────────────
adminRoutes.get("/kyc/cases", async (c) => {
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const cases = await prisma.kycCase.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return c.json(cases);
});

adminRoutes.post("/kyc/cases/:id/approve", async (c) => {
  const prisma = getPrisma(c.env);
  const kycCase = await prisma.kycCase.findUnique({ where: { id: c.req.param("id") } });
  if (!kycCase) throw new NotFoundException("KYC case not found");

  await prisma.$transaction([
    prisma.kycCase.update({ where: { id: kycCase.id }, data: { status: "APPROVED", reviewedBy: c.get("user")!.sub, reviewedAt: new Date(), completedAt: new Date() } }),
    prisma.user.update({ where: { id: kycCase.userId }, data: { kycStatus: "approved" } }),
  ]);
  await pushToUser(c.env, kycCase.userId, "kyc.updated", { kycStatus: "approved" });
  return c.json({ ok: true });
});

adminRoutes.post("/kyc/cases/:id/reject", async (c) => {
  const body = await c.req.json<{ reason?: string }>();
  const prisma = getPrisma(c.env);
  const kycCase = await prisma.kycCase.findUnique({ where: { id: c.req.param("id") } });
  if (!kycCase) throw new NotFoundException("KYC case not found");

  await prisma.$transaction([
    prisma.kycCase.update({ where: { id: kycCase.id }, data: { status: "REJECTED", reviewNotes: body.reason, reviewedBy: c.get("user")!.sub, reviewedAt: new Date() } }),
    prisma.user.update({ where: { id: kycCase.userId }, data: { kycStatus: "rejected" } }),
  ]);
  await pushToUser(c.env, kycCase.userId, "kyc.updated", { kycStatus: "rejected" });
  return c.json({ ok: true });
});

// ── Kill-switch — stored in BrokerSetting, checked by /trading/order ────────
adminRoutes.get("/trading/kill-switch", async (c) => {
  const prisma = getPrisma(c.env);
  const setting = await prisma.brokerSetting.findUnique({ where: { key: "kill_switch" } });
  return c.json(setting?.value ?? { enabled: false });
});

adminRoutes.post("/trading/kill-switch", async (c) => {
  const dto = await validateBody(KillSwitchDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const value = { enabled: dto.enabled, reason: dto.reason ?? null, updatedAt: new Date().toISOString(), updatedBy: c.get("user")!.sub };
  await prisma.brokerSetting.upsert({
    where: { key: "kill_switch" },
    create: { key: "kill_switch", value },
    update: { value },
  });

  return c.json({ ok: true, killSwitch: value });
});

// ── Feature flags admin override (completes Phase 1's /config/feature-flags) ─
adminRoutes.get("/feature-flags", async (c) => {
  const prisma = getPrisma(c.env);
  const setting = await prisma.brokerSetting.findUnique({ where: { key: "feature_flags" } });
  return c.json(setting?.value ?? {});
});

adminRoutes.post("/feature-flags", async (c) => {
  const flags = await c.req.json<Record<string, boolean>>();
  const prisma = getPrisma(c.env);
  await prisma.brokerSetting.upsert({
    where: { key: "feature_flags" },
    create: { key: "feature_flags", value: flags },
    update: { value: flags },
  });
  return c.json({ ok: true, flags });
});

// ── Broker spread override (completes Phase 2's static defaults) ───────────
adminRoutes.get("/broker/spread", async (c) => {
  const prisma = getPrisma(c.env);
  const rows = await prisma.brokerSetting.findMany({ where: { key: { startsWith: "broker_spread:" } } });
  return c.json(rows.map((r) => r.value));
});

adminRoutes.post("/broker/spread", async (c) => {
  const dto = await validateBody(LiquidityUpdateDto, await c.req.json());
  const prisma = getPrisma(c.env);
  const symbol = dto.symbol.toUpperCase();
  const value = { symbol, spread: dto.spread ?? 0, enabled: dto.enabled ?? true, updatedAt: new Date().toISOString(), updatedBy: c.get("user")!.sub };

  await prisma.brokerSetting.upsert({
    where: { key: `broker_spread:${symbol}` },
    create: { key: `broker_spread:${symbol}`, value },
    update: { value },
  });

  return c.json({ ok: true, entry: value });
});

// ── System logs (AuditLog) ──────────────────────────────────────────────────
adminRoutes.get("/system-logs", async (c) => {
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 500);
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return c.json(logs);
});

adminRoutes.get("/compliance/audit", async (c) => {
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 500);
  const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return c.json({ entries });
});

// ── Service health (simple aggregate — no real per-service telemetry yet) ──
adminRoutes.get("/service-health", async (c) => {
  const prisma = getPrisma(c.env);
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json([{ name: "database", status: "online" }, { name: "api", status: "online" }]);
  } catch {
    return c.json([{ name: "database", status: "offline" }, { name: "api", status: "online" }]);
  }
});
