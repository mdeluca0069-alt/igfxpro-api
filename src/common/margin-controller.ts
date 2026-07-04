// Ported from igfxpro-apiv2/risk-service/margin.controller.ts — the atomic
// FOR-UPDATE-row-lock margin check/lock/release logic is pure Prisma (no
// Redis/framework dependency) and portable as-is. Uses plain numbers instead
// of @prisma/client/runtime/library's Decimal (that import crashes workerd —
// see the Cloudflare Workers migration notes).
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

export type MarginState = {
  userId: string;
  balance: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
  marginLevelPct: number;
  unrealizedPnl: number;
};

export async function getMarginState(prisma: PrismaClient, userId: string): Promise<MarginState> {
  const [wallet, openPositions] = await Promise.all([
    prisma.walletAccount.findUnique({ where: { userId } }),
    prisma.position.findMany({ where: { userId, status: "OPEN" }, select: { marginUsed: true, pnl: true } }),
  ]);

  if (!wallet) throw new Error(`WALLET_NOT_FOUND:${userId}`);

  const balance = wallet.balance.toNumber();
  const marginUsed = openPositions.reduce((s, p) => s + p.marginUsed.toNumber(), 0);
  const unrealizedPnl = openPositions.reduce((s, p) => s + p.pnl.toNumber(), 0);
  const equity = balance + unrealizedPnl;
  const freeMargin = equity - marginUsed;
  const marginLevelPct = marginUsed > 0 ? (equity / marginUsed) * 100 : Number.POSITIVE_INFINITY;

  return { userId, balance, equity, marginUsed, freeMargin, marginLevelPct, unrealizedPnl };
}

export function canAcceptOrder(state: MarginState, additionalMargin: number): boolean {
  return state.freeMargin >= additionalMargin && state.equity > 0;
}

export async function checkAndLockMargin(
  prisma: PrismaClient,
  userId: string,
  orderId: string,
  required: number
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ balance: string; locked: string }>>`
          SELECT balance, locked FROM "WalletAccount" WHERE "userId" = ${userId} FOR UPDATE
        `;
        if (rows.length === 0) return { ok: false as const, reason: `WALLET_NOT_FOUND:${userId}` };

        const balance = parseFloat(rows[0].balance);
        const locked = parseFloat(rows[0].locked);
        const available = balance - locked;

        if (available < required || balance <= 0) {
          return {
            ok: false as const,
            reason: `INSUFFICIENT_MARGIN: need ${required.toFixed(2)}, available=${available.toFixed(2)}`,
          };
        }

        await tx.walletAccount.update({ where: { userId }, data: { locked: { increment: required } } });
        await tx.ledgerEntry.create({
          data: {
            id: randomUUID(),
            userId,
            currency: "USD",
            amount: -required,
            type: "MARGIN_LOCK",
            reference: orderId,
            status: "COMPLETED",
            note: `Margin locked for order ${orderId}`,
            debitAccount: `CLIENT_FREE:${userId}`,
            creditAccount: `CLIENT_MARGIN:${userId}`,
          },
        });

        return { ok: true as const };
      },
      { timeout: 8000 }
    );
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function releaseMargin(
  prisma: PrismaClient,
  userId: string,
  positionId: string,
  amount: number
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: string }>>`
        SELECT locked FROM "WalletAccount" WHERE "userId" = ${userId} FOR UPDATE
      `;
      const currentLocked = rows[0] ? parseFloat(rows[0].locked) : 0;
      const safeRelease = Math.max(0, Math.min(currentLocked, amount));
      if (safeRelease === 0) return;

      await tx.walletAccount.update({ where: { userId }, data: { locked: { decrement: safeRelease } } });
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
    },
    { timeout: 8000 }
  );
}
