import { Hono } from "hono";
import Decimal from "decimal.js";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { BadRequestException, NotFoundException } from "../../common/http-exceptions";
import type { HonoEnv } from "../../common/types";
import { LedgerType } from "@prisma/client";

export const executionRoutes = new Hono<HonoEnv>();

executionRoutes.use("*", jwtAuthMiddleware);

// Order placement needs to know which account to trade on. The original
// (never-registered) controller read `req.user.activeAccountId`, which
// doesn't exist on the JWT payload (sub/email/role only) and would always
// be undefined — taking accountId from the body instead, matching how
// /trading/open already does it.
executionRoutes.post("/order", async (c) => {
  const body = await c.req.json<{
    accountId: string;
    marketId: string;
    volume: number;
    type: "BUY" | "SELL";
    price?: number;
  }>();
  const prisma = getPrisma(c.env);

  const result = await prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id: body.accountId }, include: { wallet: true } });
    if (!account || !account.wallet) throw new BadRequestException("Account o wallet non trovato");

    const market = await tx.market.findUnique({ where: { id: body.marketId } });
    if (!market) throw new BadRequestException("Mercato non trovato");

    const requiredMargin = new Decimal(body.volume).mul(body.price ?? 0).div(account.leverage);

    if (new Decimal(account.wallet.available.toString()).lessThan(requiredMargin)) {
      throw new BadRequestException("Fondi insufficienti");
    }

    const trade = await tx.trade.create({
      data: {
        accountId: body.accountId,
        marketId: body.marketId,
        symbol: "EUR/USD",
        volume: body.volume,
        price: body.price ?? 0,
        pnl: 0,
        type: body.type,
      },
    });

    await tx.wallet.update({
      where: { id: account.wallet.id },
      data: {
        marginUsed: { increment: requiredMargin.toNumber() },
        available: { decrement: requiredMargin.toNumber() },
      },
    });

    await tx.ledgerEntry.create({
      data: {
        walletId: account.wallet.id,
        type: LedgerType.TRADE_PNL,
        amount: 0,
        reference: trade.id,
      },
    });

    return { success: true, trade };
  });

  return c.json(result);
});

// closeTrade existed on ExecutionService but was never wired to a controller
// route in the original app (ExecutionModule itself was never registered at
// all) — exposing it here as part of activating real execution logic.
executionRoutes.post("/close", async (c) => {
  const body = await c.req.json<{ tradeId: string }>();
  const prisma = getPrisma(c.env);

  const result = await prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findUnique({
      where: { id: body.tradeId },
      include: { account: { include: { wallet: true } }, market: true },
    });
    if (!trade) throw new NotFoundException("Trade non trovato");
    const wallet = trade.account.wallet!;

    // marketPrice is a placeholder (same as trade.price) in the original
    // service — a real market price lookup was never implemented, so pnl
    // always resolves to 0. Preserved as-is, not a bug introduced here.
    const marketPrice = trade.price;
    const tradePrice = new Decimal(trade.price.toString());
    const volume = new Decimal(trade.volume.toString());
    const pnl =
      trade.type === "BUY"
        ? new Decimal(marketPrice.toString()).sub(tradePrice).mul(volume)
        : tradePrice.sub(new Decimal(marketPrice.toString())).mul(volume);

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: pnl.toNumber() },
        available: { increment: pnl.toNumber() },
        marginUsed: { decrement: volume.toNumber() },
      },
    });

    await tx.trade.update({
      where: { id: trade.id },
      data: { pnl: pnl.toNumber() },
    });

    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: LedgerType.TRADE_PNL,
        amount: pnl.toNumber(),
        reference: trade.id,
      },
    });

    return { success: true, tradeId: body.tradeId, pnl: pnl.toNumber() };
  });

  return c.json(result);
});
