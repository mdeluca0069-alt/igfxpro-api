import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { BadRequestException, NotFoundException } from "../../common/http-exceptions";
import { INSTRUMENT_META, BROKER_SPREAD_DEFAULTS } from "../../common/instruments";
import type { HonoEnv } from "../../common/types";

export const paperRoutes = new Hono<HonoEnv>();
paperRoutes.use("*", jwtAuthMiddleware);

// Ported from apiv2's paper-trading/paper.trading.service.ts — a fully
// isolated virtual wallet using the same PnL/margin math as real trading,
// persisted as key/value rows in BrokerSetting (apiv2's own storage choice
// for this feature, kept as-is here). One deliberate change: apiv2's REST
// gateway had no server-side price feed and required the client to submit
// `currentPrice` with every order/close call; we have a real polled Quote
// table (Fase 2), so price is looked up server-side instead of trusted from
// the client — this removes a client-side price-manipulation vector on
// otherwise-real financial math.

const PAPER_START_BALANCE = 100_000;
const MAX_LEVERAGE = 30;

type PaperWallet = {
  id: string;
  userId: string;
  name: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  totalPnl: number;
  currency: string;
  createdAt: string;
  resetAt: string | null;
};

type PaperPosition = {
  id: string;
  walletId: string;
  userId: string;
  symbol: string;
  direction: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  margin: number;
  sl: number | null;
  tp: number | null;
  openedAt: string;
};

type PaperOrder = {
  id: string;
  walletId: string;
  userId: string;
  symbol: string;
  direction: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP";
  quantity: number;
  limitPrice: number | null;
  fillPrice: number | null;
  status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
  sl: number | null;
  tp: number | null;
  createdAt: string;
  filledAt: string | null;
};

function calcPnl(pos: Pick<PaperPosition, "direction" | "entryPrice" | "quantity">, currentPrice: number): number {
  const multiplier = pos.direction === "BUY" ? 1 : -1;
  return multiplier * (currentPrice - pos.entryPrice) * pos.quantity;
}

async function getPositions(prisma: ReturnType<typeof getPrisma>, userId: string, walletId: string): Promise<PaperPosition[]> {
  const rows = await prisma.brokerSetting.findMany({ where: { key: { startsWith: `paper_pos:${walletId}:` } } });
  return rows.map((r) => r.value as PaperPosition).filter((p) => p.userId === userId);
}

function recomputeEquity(wallet: PaperWallet, positions: PaperPosition[]): PaperWallet {
  const unrealized = positions.reduce((sum, p) => sum + p.pnl, 0);
  const equity = wallet.balance + unrealized;
  const freeMargin = equity - wallet.margin;
  const marginLevel = wallet.margin > 0 ? (equity / wallet.margin) * 100 : 9999;
  return { ...wallet, equity, freeMargin: Math.max(0, freeMargin), marginLevel };
}

async function getWallet(prisma: ReturnType<typeof getPrisma>, userId: string, walletId: string): Promise<PaperWallet | null> {
  const row = await prisma.brokerSetting.findUnique({ where: { key: `paper_wallet:${walletId}` } });
  const w = row?.value as PaperWallet | undefined;
  if (!w || w.userId !== userId) return null;
  return recomputeEquity(w, await getPositions(prisma, userId, walletId));
}

async function saveWallet(prisma: ReturnType<typeof getPrisma>, w: PaperWallet): Promise<void> {
  await prisma.brokerSetting.upsert({
    where: { key: `paper_wallet:${w.id}` },
    create: { key: `paper_wallet:${w.id}`, value: w },
    update: { value: w },
  });
}

async function savePosition(prisma: ReturnType<typeof getPrisma>, p: PaperPosition): Promise<void> {
  await prisma.brokerSetting.upsert({
    where: { key: `paper_pos:${p.walletId}:${p.id}` },
    create: { key: `paper_pos:${p.walletId}:${p.id}`, value: p },
    update: { value: p },
  });
}

async function saveOrder(prisma: ReturnType<typeof getPrisma>, o: PaperOrder): Promise<void> {
  await prisma.brokerSetting.upsert({
    where: { key: `paper_order:${o.walletId}:${o.id}` },
    create: { key: `paper_order:${o.walletId}:${o.id}`, value: o },
    update: { value: o },
  });
}

paperRoutes.get("/wallets", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const rows = await prisma.brokerSetting.findMany({ where: { key: { startsWith: "paper_wallet:" } } });
  const wallets = (rows.map((r) => r.value as PaperWallet)).filter((w) => w.userId === user.sub);
  const withEquity = await Promise.all(wallets.map(async (w) => recomputeEquity(w, await getPositions(prisma, user.sub, w.id))));
  return c.json({ wallets: withEquity });
});

paperRoutes.post("/wallets", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const body = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
  const id = `pw_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const wallet: PaperWallet = {
    id,
    userId: user.sub,
    name: body.name ?? "Main Paper Account",
    balance: PAPER_START_BALANCE,
    equity: PAPER_START_BALANCE,
    margin: 0,
    freeMargin: PAPER_START_BALANCE,
    marginLevel: 9999,
    totalPnl: 0,
    currency: "USD",
    createdAt: now,
    resetAt: null,
  };
  await saveWallet(prisma, wallet);
  return c.json({ wallet });
});

paperRoutes.get("/wallets/:walletId", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const wallet = await getWallet(prisma, user.sub, c.req.param("walletId"));
  if (!wallet) throw new NotFoundException("Paper wallet not found");
  return c.json({ wallet });
});

paperRoutes.post("/wallets/:walletId/reset", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const walletId = c.req.param("walletId");
  const wallet = await getWallet(prisma, user.sub, walletId);
  if (!wallet) throw new NotFoundException("Paper wallet not found");

  const positions = await getPositions(prisma, user.sub, walletId);
  await Promise.all(positions.map((p) => prisma.brokerSetting.delete({ where: { key: `paper_pos:${walletId}:${p.id}` } })));

  const reset: PaperWallet = {
    ...wallet,
    balance: PAPER_START_BALANCE,
    equity: PAPER_START_BALANCE,
    margin: 0,
    freeMargin: PAPER_START_BALANCE,
    marginLevel: 9999,
    totalPnl: 0,
    resetAt: new Date().toISOString(),
  };
  await saveWallet(prisma, reset);
  return c.json({ wallet: reset });
});

paperRoutes.get("/wallets/:walletId/positions", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const walletId = c.req.param("walletId");
  const wallet = await getWallet(prisma, user.sub, walletId);
  if (!wallet) throw new NotFoundException("Paper wallet not found");

  const quotes = await prisma.quote.findMany({ where: { symbol: { in: [...new Set((await getPositions(prisma, user.sub, walletId)).map((p) => p.symbol))] } } });
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));

  const positions = await getPositions(prisma, user.sub, walletId);
  const withLivePnl = positions.map((p) => {
    const q = quoteBySymbol.get(p.symbol);
    const currentPrice = q ? (p.direction === "BUY" ? q.bid.toNumber() : q.ask.toNumber()) : p.currentPrice;
    const pnl = calcPnl(p, currentPrice);
    return { ...p, currentPrice, pnl, pnlPct: p.margin > 0 ? (pnl / p.margin) * 100 : 0 };
  });
  return c.json({ positions: withLivePnl });
});

paperRoutes.post("/wallets/:walletId/orders", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const walletId = c.req.param("walletId");
  const body = await c.req.json<{
    symbol: string;
    direction: "BUY" | "SELL";
    orderType?: "MARKET" | "LIMIT" | "STOP";
    quantity: number;
    limitPrice?: number;
    sl?: number;
    tp?: number;
  }>();

  const wallet = await getWallet(prisma, user.sub, walletId);
  if (!wallet) throw new NotFoundException("Paper wallet not found");

  const meta = INSTRUMENT_META[body.symbol];
  if (!meta) throw new BadRequestException(`${body.symbol} is not available for trading`);

  const quote = await prisma.quote.findUnique({ where: { symbol: body.symbol } });
  if (!quote) throw new BadRequestException("NO_PRICE_AVAILABLE");
  const currentPrice = quote.mid.toNumber();

  const orderType = body.orderType ?? "MARKET";
  const leverage = Math.min(meta.leverage, MAX_LEVERAGE);
  const contractSize = meta.contractSize;
  const notional = body.quantity * contractSize * currentPrice;
  const marginReq = notional / leverage;

  if (marginReq > wallet.freeMargin) {
    throw new BadRequestException(`Insufficient margin. Required: $${marginReq.toFixed(2)}, Available: $${wallet.freeMargin.toFixed(2)}`);
  }

  const spread = BROKER_SPREAD_DEFAULTS[body.symbol] ?? 0;
  const fillPrice =
    orderType === "MARKET"
      ? body.direction === "BUY"
        ? currentPrice + spread / 2
        : currentPrice - spread / 2
      : body.limitPrice ?? currentPrice;

  const orderId = `po_${crypto.randomUUID()}`;
  const positionId = `pp_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const order: PaperOrder = {
    id: orderId,
    walletId,
    userId: user.sub,
    symbol: body.symbol,
    direction: body.direction,
    orderType,
    quantity: body.quantity,
    limitPrice: body.limitPrice ?? null,
    fillPrice,
    sl: body.sl ?? null,
    tp: body.tp ?? null,
    status: "FILLED",
    createdAt: now,
    filledAt: now,
  };

  const position: PaperPosition = {
    id: positionId,
    walletId,
    userId: user.sub,
    symbol: body.symbol,
    direction: body.direction,
    quantity: body.quantity,
    entryPrice: fillPrice,
    currentPrice: fillPrice,
    pnl: 0,
    pnlPct: 0,
    margin: marginReq,
    sl: body.sl ?? null,
    tp: body.tp ?? null,
    openedAt: now,
  };

  const updatedWallet: PaperWallet = { ...wallet, margin: wallet.margin + marginReq, freeMargin: wallet.freeMargin - marginReq };

  await saveWallet(prisma, updatedWallet);
  await saveOrder(prisma, order);
  await savePosition(prisma, position);

  return c.json({ ok: true, orderId, position });
});

paperRoutes.post("/wallets/:walletId/positions/:positionId/close", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const walletId = c.req.param("walletId");
  const positionId = c.req.param("positionId");

  const wallet = await getWallet(prisma, user.sub, walletId);
  const posRow = await prisma.brokerSetting.findUnique({ where: { key: `paper_pos:${walletId}:${positionId}` } });
  const position = posRow?.value as PaperPosition | undefined;

  if (!wallet || !position || position.walletId !== walletId || position.userId !== user.sub) {
    return c.json({ ok: false, reason: "POSITION_NOT_FOUND" });
  }

  const quote = await prisma.quote.findUnique({ where: { symbol: position.symbol } });
  if (!quote) return c.json({ ok: false, reason: "NO_PRICE_AVAILABLE" });
  const currentPrice = quote.mid.toNumber();

  const spread = BROKER_SPREAD_DEFAULTS[position.symbol] ?? 0;
  const exitPrice = position.direction === "BUY" ? currentPrice - spread / 2 : currentPrice + spread / 2;
  const pnl = calcPnl(position, exitPrice);

  const updatedWallet: PaperWallet = {
    ...wallet,
    balance: wallet.balance + position.margin + pnl,
    margin: Math.max(0, wallet.margin - position.margin),
    freeMargin: wallet.freeMargin + position.margin + pnl,
    totalPnl: wallet.totalPnl + pnl,
  };

  await saveWallet(prisma, updatedWallet);
  await prisma.brokerSetting.delete({ where: { key: `paper_pos:${walletId}:${positionId}` } });

  return c.json({ ok: true, pnl });
});

paperRoutes.get("/wallets/:walletId/history", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const walletId = c.req.param("walletId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 500);

  const rows = await prisma.brokerSetting.findMany({ where: { key: { startsWith: `paper_order:${walletId}:` } }, take: limit });
  const orders = rows.map((r) => r.value as PaperOrder).filter((o) => o.userId === user.sub);

  const wallet = await getWallet(prisma, user.sub, walletId);
  const balance = wallet?.balance ?? PAPER_START_BALANCE;
  const totalReturn = balance - PAPER_START_BALANCE;

  // apiv2's getPerformanceStats also hardcodes winRate/profitFactor/avgWin/
  // avgLoss/maxDrawdown/sharpeRatio to 0 (per-trade P&L isn't stored on the
  // PaperOrder record) — kept identical here for frontend shape parity.
  return c.json({
    orders,
    stats: {
      totalTrades: orders.filter((o) => o.status === "FILLED").length,
      winRate: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      currentBalance: balance,
      totalReturn,
      totalReturnPct: (totalReturn / PAPER_START_BALANCE) * 100,
    },
  });
});
