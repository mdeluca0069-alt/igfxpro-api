import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { validateBody } from "../../common/validate";
import type { HonoEnv } from "../../common/types";
import { DepositDto, WithdrawDto } from "./deposit.dto";

export const walletRoutes = new Hono<HonoEnv>();
walletRoutes.use("*", jwtAuthMiddleware);

// Ported from apiv2's routes.ts /api/v1/wallet/balance handler — computed
// from WalletAccount + open positions' unrealized PnL/margin, not stored
// directly (equity/marginUsed on WalletAccount are legacy/unused columns).
walletRoutes.get("/balance", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const [wallet, positions] = await Promise.all([
    prisma.walletAccount.findUnique({ where: { userId: user.sub } }),
    prisma.position.findMany({ where: { userId: user.sub, status: "OPEN" }, select: { pnl: true, marginUsed: true } }),
  ]);

  const unrealizedPnL = positions.reduce((s, p) => s + p.pnl.toNumber(), 0);
  const marginUsed = positions.reduce((s, p) => s + p.marginUsed.toNumber(), 0);

  if (!wallet) {
    return c.json({ currency: "USD", available: 0, equity: 0, locked: 0, freeMargin: 0, marginUsed: 0, unrealizedPnL: 0 });
  }

  const balance = wallet.balance.toNumber();
  const locked = wallet.locked.toNumber();
  const equity = balance + unrealizedPnL;

  return c.json({
    currency: wallet.currency,
    available: balance - locked,
    equity,
    locked,
    freeMargin: Math.max(0, equity - marginUsed),
    marginUsed,
    unrealizedPnL,
  });
});

// Ported from apiv2's wallet-service/ledger.service.ts getLedger — pure
// Prisma query, portable as-is.
walletRoutes.get("/ledger", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 500);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const orderBy = (c.req.query("orderBy") ?? "desc") as "asc" | "desc";
  const typeParam = c.req.query("type");
  const status = c.req.query("status");
  const from = c.req.query("from");
  const to = c.req.query("to");

  const where = {
    userId: user.sub,
    ...(typeParam ? { type: { in: typeParam.split(",").map((t) => t.trim()) } } : {}),
    ...(status ? { status } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
      : {}),
  };

  const [totalCount, rows] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({ where, orderBy: { createdAt: orderBy }, take: limit, skip: offset }),
  ]);

  let totalCredits = 0;
  let totalDebits = 0;
  for (const r of rows) {
    const amt = r.amount.toNumber();
    if (amt >= 0) totalCredits += amt;
    else totalDebits += Math.abs(amt);
  }

  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      type: r.type,
      amount: r.amount.toNumber(),
      currency: r.currency,
      reference: r.reference,
      status: r.status,
      note: r.note,
      runningBalance: r.runningBalance?.toNumber() ?? null,
      debitAccount: r.debitAccount,
      creditAccount: r.creditAccount,
      createdAt: r.createdAt.toISOString(),
    })),
    totalCount,
    totalCredits,
    totalDebits,
    pageSize: limit,
    offset,
  });
});

// Ported from apiv2's wallet-service/ledger.service.ts getStatement.
walletRoutes.get("/statements", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const period = (c.req.query("period") ?? "monthly") as "daily" | "weekly" | "monthly" | "custom";
  const now = new Date();
  const to = c.req.query("to") ? new Date(c.req.query("to")!) : now;
  let from: Date;
  if (c.req.query("from")) {
    from = new Date(c.req.query("from")!);
  } else if (period === "daily") {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === "weekly") {
    from = new Date(now.getTime() - 7 * 86_400_000);
  } else if (period === "monthly") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else {
    from = new Date(now.getTime() - 30 * 86_400_000);
  }

  const entries = await prisma.ledgerEntry.findMany({
    where: { userId: user.sub, status: "COMPLETED", createdAt: { gte: from, lte: to } },
    orderBy: { createdAt: "asc" },
    select: { type: true, amount: true },
  });
  const openingEntry = await prisma.ledgerEntry.findFirst({
    where: { userId: user.sub, status: "COMPLETED", createdAt: { lt: from } },
    orderBy: { createdAt: "desc" },
    select: { runningBalance: true },
  });
  const wallet = await prisma.walletAccount.findUnique({ where: { userId: user.sub }, select: { balance: true } });

  const openingBalance = openingEntry?.runningBalance?.toNumber() ?? 0;
  const closingBalance = wallet?.balance.toNumber() ?? 0;

  let realizedPnl = 0,
    commissions = 0,
    swaps = 0,
    deposits = 0,
    withdrawals = 0,
    adjustments = 0;

  for (const e of entries) {
    const amt = e.amount.toNumber();
    switch (e.type) {
      case "PNL_CREDIT":
      case "PNL_DEBIT":
      case "PNL_SETTLEMENT":
      case "TRADE_PNL":
        realizedPnl += amt;
        break;
      case "COMMISSION":
      case "FEE":
        commissions += Math.abs(amt);
        break;
      case "SWAP":
        swaps += amt;
        break;
      case "ADMIN_CAPITAL_ALLOCATION":
      case "DEPOSIT_REQUEST":
        if (amt > 0) deposits += amt;
        break;
      case "WITHDRAW_REQUEST":
        if (amt < 0) withdrawals += Math.abs(amt);
        break;
      case "ADJUSTMENT":
        adjustments += amt;
        break;
    }
  }

  return c.json({
    userId: user.sub,
    period,
    from: from.toISOString(),
    to: to.toISOString(),
    openingBalance,
    closingBalance,
    realizedPnl,
    commissions,
    swaps,
    deposits,
    withdrawals,
    adjustments,
    netChange: realizedPnl + deposits - withdrawals - commissions + swaps + adjustments,
    entryCount: entries.length,
    generatedAt: now.toISOString(),
  });
});

export const clientRoutes = new Hono<HonoEnv>();
clientRoutes.use("*", jwtAuthMiddleware);

// apiv2's own /client/account handler is actually a legacy in-memory-sandbox
// path (never updated to read the DB, unlike its sibling endpoints) — this
// is a from-scratch DB-backed composite covering the same shape the frontend
// (AppShell.tsx, called on every authenticated navigation) actually reads.
clientRoutes.get("/account", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const [dbUser, wallet, positions, ledger, documents] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.sub } }),
    prisma.walletAccount.findUnique({ where: { userId: user.sub } }),
    prisma.position.findMany({ where: { userId: user.sub, status: "OPEN" }, select: { pnl: true, marginUsed: true } }),
    prisma.ledgerEntry.findMany({ where: { userId: user.sub }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.clientDocument.findMany({ where: { userId: user.sub } }),
  ]);

  if (!dbUser) return c.json({ ok: false, reason: "NOT_FOUND" });

  const unrealizedPnl = positions.reduce((s, p) => s + p.pnl.toNumber(), 0);
  const marginUsed = positions.reduce((s, p) => s + p.marginUsed.toNumber(), 0);
  const balance = wallet?.balance.toNumber() ?? 0;
  const equity = balance + unrealizedPnl;

  return c.json({
    profile: {
      fullName: dbUser.fullName,
      email: dbUser.email,
      tier: dbUser.tier,
      kycStatus: dbUser.kycStatus,
    },
    capital: {
      allocated: balance,
      equity,
      marginUsed,
      freeMargin: Math.max(0, equity - marginUsed),
      unrealizedPnl,
      riskScore: 0,
    },
    ledger: ledger.map((l) => ({
      id: l.id,
      type: l.type,
      amount: l.amount.toNumber(),
      status: l.status,
      reference: l.reference,
      note: l.note,
      createdAt: l.createdAt.toISOString(),
    })),
    documents: documents.map((d) => ({
      id: d.id,
      documentKey: d.documentKey,
      label: d.label,
      status: d.status,
      fileName: d.fileName,
      updatedAt: d.updatedAt.toISOString(),
    })),
  });
});

// Ported from apiv2's wallet-service/ledger.engine.ts requestDeposit — client
// deposits always land PENDING_ADMIN, no wallet credit until an admin
// approves (Phase 7). AML transaction-monitoring screening is deferred.
clientRoutes.post("/deposit", async (c) => {
  const user = c.get("user")!;
  const dto = await validateBody(DepositDto, await c.req.json());
  const prisma = getPrisma(c.env);

  await prisma.walletAccount.upsert({
    where: { userId: user.sub },
    create: { userId: user.sub, currency: "USD", balance: 0, equity: 0, locked: 0 },
    update: {},
  });

  const reference = dto.details?.trim() || `DEP-${Date.now()}`;
  const entry = await prisma.ledgerEntry.create({
    data: {
      id: randomUUID(),
      userId: user.sub,
      currency: "USD",
      amount: dto.amount,
      type: "DEPOSIT_REQUEST",
      reference,
      status: "PENDING_ADMIN",
      note: `Deposit request via ${dto.method}. Pending admin/KYC/AML review.`,
    },
  });

  return c.json({ ok: true, status: "PENDING_ADMIN", entryId: entry.id, reference });
});

// Ported from apiv2's wallet-service/ledger.engine.ts requestWithdrawal.
clientRoutes.post("/withdraw", async (c) => {
  const user = c.get("user")!;
  const dto = await validateBody(WithdrawDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const wallet = await prisma.walletAccount.findUnique({ where: { userId: user.sub } });
  if (!wallet) return c.json({ ok: false, status: "REJECTED", message: "No wallet found for user." });

  const freeMargin = wallet.balance.toNumber() - wallet.locked.toNumber();
  if (dto.amount > freeMargin) {
    await prisma.ledgerEntry.create({
      data: {
        id: randomUUID(),
        userId: user.sub,
        currency: "USD",
        amount: -dto.amount,
        type: "WITHDRAW_REQUEST",
        reference: dto.destination,
        status: "REJECTED",
        note: "Withdrawal rejected: insufficient free margin.",
      },
    });
    return c.json({ ok: false, status: "REJECTED", message: "Insufficient free margin." });
  }

  await prisma.ledgerEntry.create({
    data: {
      id: randomUUID(),
      userId: user.sub,
      currency: "USD",
      amount: -dto.amount,
      type: "WITHDRAW_REQUEST",
      reference: dto.destination,
      status: "PENDING_ADMIN",
      note: `Withdrawal request via ${dto.method} to ${dto.destination}. Pending KYC/AML/admin review.`,
    },
  });

  return c.json({ ok: true, status: "PENDING_ADMIN", message: "Withdrawal request submitted for review." });
});

// Document upload — metadata-only record for this pass (no S3/R2 storage
// wiring yet, that's the document-storage service, deferred to Phase 8).
clientRoutes.post("/documents/upload", async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{
    documentKey?: string;
    documentId?: string;
    label?: string;
    fileName: string;
    mimeType?: string;
  }>();
  const prisma = getPrisma(c.env);
  const documentKey = (body.documentKey ?? body.documentId ?? "PASSPORT").toUpperCase();

  const doc = await prisma.clientDocument.upsert({
    where: { userId_documentKey: { userId: user.sub, documentKey } },
    create: {
      userId: user.sub,
      documentKey,
      label: body.label ?? body.documentKey ?? "Document",
      status: "PENDING_REVIEW",
      fileName: body.fileName,
    },
    update: { status: "PENDING_REVIEW", fileName: body.fileName, label: body.label ?? body.documentKey },
  });

  // First document upload opens a real KycCase so it lands in the admin
  // console's KYC queue (adminRoutes.get("/kyc/cases")) — previously nothing
  // ever created this row, so approve/reject had no cases to act on and
  // onboarding status could never leave "pending" for any client.
  await prisma.kycCase.upsert({
    where: { userId: user.sub },
    create: { userId: user.sub, status: "SUBMITTED" },
    update: {},
  });

  return c.json({ ok: true, document: doc });
});
