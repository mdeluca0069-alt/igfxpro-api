import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { realizedPnl, pnlPercent, applyNBP } from "./pnl-calculator";

// Shared by the interactive POST /trading/position/:id/close route and the
// Fase 9 position-monitor cron tick (SL/TP auto-close, ESMA 50% stop-out) —
// extracted so both paths run the exact same financial logic instead of two
// copies drifting apart. Ported from apiv2's position.close.ts +
// settlement.engine.ts (see trading.routes.ts's original comment for the
// list of deliberate simplifications: no commission/swap, no exposure
// registry).
export type ClosePositionResult =
  | { ok: false; reason: string }
  | { ok: true; userId: string; symbol: string; positionId: string; pnl: number; netCredit: number; exitPrice: number; isPartial: boolean };

export async function closePosition(
  prisma: PrismaClient,
  positionId: string,
  opts: { expectedUserId?: string; quantity?: number } = {}
): Promise<ClosePositionResult> {
  const pos = await prisma.position.findUnique({ where: { id: positionId } });
  if (!pos) return { ok: false, reason: "POSITION_NOT_FOUND" };
  if (opts.expectedUserId && pos.userId !== opts.expectedUserId) return { ok: false, reason: "UNAUTHORIZED" };
  if (pos.status !== "OPEN") return { ok: false, reason: `POSITION_ALREADY_${pos.status}` };

  const quote = await prisma.quote.findUnique({ where: { symbol: pos.symbol } });
  if (!quote) return { ok: false, reason: "NO_PRICE_AVAILABLE" };

  const totalQty = pos.quantity.toNumber();
  const closeQty = opts.quantity && opts.quantity < totalQty ? opts.quantity : totalQty;
  const isPartial = closeQty < totalQty;
  const exitPrice = pos.side === "BUY" ? quote.bid.toNumber() : quote.ask.toNumber();

  const entryPrice = pos.entryPrice.toNumber();
  const rawPnl = realizedPnl(pos.side as "BUY" | "SELL", closeQty, entryPrice, exitPrice);
  const marginPortion = (closeQty / totalQty) * pos.marginUsed.toNumber();
  const cappedPnl = applyNBP(rawPnl, marginPortion);
  const netCredit = cappedPnl;
  const userId = pos.userId;

  const result = await prisma.$transaction(async (tx) => {
    const posRows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM "Position" WHERE id = ${positionId} FOR UPDATE
    `;
    if (posRows.length === 0 || posRows[0].status !== "OPEN") {
      return { ok: false as const, reason: "POSITION_ALREADY_CLOSED" };
    }

    const walletRows = await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT locked FROM "WalletAccount" WHERE "userId" = ${userId} FOR UPDATE
    `;
    const currentLocked = walletRows[0] ? parseFloat(walletRows[0].locked) : 0;
    const safeRelease = Math.max(0, Math.min(currentLocked, marginPortion));

    if (isPartial) {
      await tx.position.update({
        where: { id: positionId },
        data: { quantity: { decrement: closeQty }, marginUsed: { decrement: marginPortion } },
      });
      await tx.position.create({
        data: {
          userId,
          orderId: pos.orderId,
          symbol: pos.symbol,
          side: pos.side,
          quantity: closeQty,
          entryPrice,
          markPrice: exitPrice,
          exitPrice,
          marginUsed: marginPortion,
          leverage: pos.leverage,
          status: "CLOSED",
          closedAt: new Date(),
          pnl: cappedPnl,
          pnlPercent: pnlPercent(pos.side as "BUY" | "SELL", entryPrice, exitPrice),
        },
      });
    } else {
      await tx.position.update({
        where: { id: positionId },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          exitPrice,
          markPrice: exitPrice,
          pnl: cappedPnl,
          pnlPercent: pnlPercent(pos.side as "BUY" | "SELL", entryPrice, exitPrice),
        },
      });
    }

    const updatedWallet = await tx.walletAccount.update({
      where: { userId },
      data: { balance: { increment: netCredit }, locked: { decrement: safeRelease } },
      select: { balance: true },
    });

    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        userId,
        currency: "USD",
        amount: netCredit,
        type: "TRADE_PNL",
        reference: positionId,
        status: "COMPLETED",
        note: `P&L settlement for position ${positionId}`,
        runningBalance: updatedWallet.balance,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        userId,
        currency: "USD",
        amount: safeRelease,
        type: "MARGIN_RELEASE",
        reference: positionId,
        status: "COMPLETED",
        note: `Margin released for closed position ${positionId}`,
        debitAccount: `CLIENT_MARGIN:${userId}`,
        creditAccount: `CLIENT_FREE:${userId}`,
      },
    });

    if (!isPartial) {
      const closedAt = new Date();
      const duration = Math.floor((closedAt.getTime() - pos.openedAt.getTime()) / 60_000);
      const auditUpdate = await tx.tradeAudit.updateMany({
        where: { positionId },
        data: {
          exitPrice,
          pnlRealized: cappedPnl,
          pnlPercent: pnlPercent(pos.side as "BUY" | "SELL", entryPrice, exitPrice),
          tradeStatus: "CLOSED",
          closedAt,
          duration,
        },
      });
      if (auditUpdate.count === 0) {
        await tx.tradeAudit.create({
          data: {
            userId,
            orderId: pos.orderId,
            positionId,
            symbol: pos.symbol,
            side: pos.side,
            quantity: closeQty,
            entryPrice,
            exitPrice,
            pnlRealized: cappedPnl,
            pnlPercent: pnlPercent(pos.side as "BUY" | "SELL", entryPrice, exitPrice),
            marginUsed: pos.marginUsed,
            leverage: pos.leverage,
            tradeStatus: "CLOSED",
            closedAt,
            duration,
            lifecycle: {},
            riskMetrics: {},
          },
        });
      }
    }

    return { ok: true as const, pnl: cappedPnl, netCredit };
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, userId, symbol: pos.symbol, positionId, pnl: result.pnl, netCredit: result.netCredit, exitPrice, isPartial };
}
