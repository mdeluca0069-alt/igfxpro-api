import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getMarginState, canAcceptOrder } from "./margin-controller";

// Fills a resting (ACCEPTED) LIMIT/STOP/STOP_LIMIT/TRAILING_STOP order once
// the position-monitor cron determines its trigger price has been crossed.
// Mirrors the MARKET-order-fill transaction in trading.routes.ts's POST
// /trading/order (margin lock + order + position + fill + ledger + audit),
// except margin wasn't reserved at placement time for resting orders (Fase 3
// behavior, kept as-is) so it's checked fresh here — an order can still be
// rejected for insufficient margin at trigger time even though it was
// accepted when placed.
export type FillResult =
  | { ok: false; reason: string }
  | { ok: true; userId: string; symbol: string; side: string; quantity: number; positionId: string; execPrice: number; marginRequired: number };

export async function fillPendingOrder(prisma: PrismaClient, orderId: string, execPrice: number): Promise<FillResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "ACCEPTED") return { ok: false, reason: "ORDER_NOT_PENDING" };

  const quantity = order.quantity.toNumber();
  const notional = quantity * execPrice;
  const marginRequired = notional / order.leverage;

  const marginState = await getMarginState(prisma, order.userId);
  if (!canAcceptOrder(marginState, marginRequired)) {
    await prisma.order.update({ where: { id: orderId }, data: { status: "REJECTED", rejectionReason: "INSUFFICIENT_MARGIN_AT_TRIGGER" } });
    return { ok: false, reason: "INSUFFICIENT_MARGIN_AT_TRIGGER" };
  }

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ balance: string; locked: string }>>`
      SELECT balance, locked FROM "WalletAccount" WHERE "userId" = ${order.userId} FOR UPDATE
    `;
    if (rows.length === 0) return { ok: false as const, reason: `WALLET_NOT_FOUND:${order.userId}` };
    const available = parseFloat(rows[0].balance) - parseFloat(rows[0].locked);
    if (available < marginRequired) return { ok: false as const, reason: "INSUFFICIENT_MARGIN_AT_TRIGGER" };

    const filled = await tx.order.updateMany({
      where: { id: orderId, status: "ACCEPTED" },
      data: { status: "FILLED", filledQuantity: quantity, averageFillPrice: execPrice, filledAt: new Date() },
    });
    if (filled.count === 0) return { ok: false as const, reason: "ORDER_ALREADY_HANDLED" };

    const position = await tx.position.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        symbol: order.symbol,
        side: order.side,
        quantity,
        entryPrice: execPrice,
        markPrice: execPrice,
        marginUsed: marginRequired,
        leverage: order.leverage,
        stopLoss: order.stopLoss ?? undefined,
        takeProfit: order.takeProfit ?? undefined,
      },
    });

    await tx.fill.create({
      data: { orderId: order.id, positionId: position.id, quantity, price: execPrice, liquidityProvider: "IGFX_INTERNAL" },
    });

    await tx.walletAccount.update({ where: { userId: order.userId }, data: { locked: { increment: marginRequired } } });
    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        userId: order.userId,
        currency: "USD",
        amount: -marginRequired,
        type: "MARGIN_LOCK",
        reference: order.id,
        status: "COMPLETED",
        note: `Margin locked for triggered order ${order.id}`,
        debitAccount: `CLIENT_FREE:${order.userId}`,
        creditAccount: `CLIENT_MARGIN:${order.userId}`,
      },
    });

    await tx.tradeAudit.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        positionId: position.id,
        symbol: order.symbol,
        side: order.side,
        quantity,
        entryPrice: execPrice,
        marginUsed: marginRequired,
        leverage: order.leverage,
        stopLoss: order.stopLoss ?? undefined,
        takeProfit: order.takeProfit ?? undefined,
        tradeStatus: "OPEN",
        lifecycle: [{ status: "OPEN", timestamp: new Date().toISOString(), detail: `Triggered @ ${execPrice}` }],
        riskMetrics: { marginRequired, notional, leverage: order.leverage },
      },
    });

    return { ok: true as const, position };
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    userId: order.userId,
    symbol: order.symbol,
    side: order.side,
    quantity,
    positionId: result.position.id,
    execPrice,
    marginRequired,
  };
}
