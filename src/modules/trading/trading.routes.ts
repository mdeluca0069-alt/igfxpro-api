import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { BadRequestException, NotFoundException } from "../../common/http-exceptions";
import { validateBody } from "../../common/validate";
import type { HonoEnv } from "../../common/types";
import { INSTRUMENT_META } from "../../common/instruments";
import { effectiveLeverage } from "../../common/leverage-guard";
import { getMarginState, canAcceptOrder } from "../../common/margin-controller";
import { realizedPnl, pnlPercent, unrealizedPnl, applyNBP } from "../../common/pnl-calculator";
import { NewOrderDto, ModifyOrderDto, ClosePositionDto } from "./order.dto";

export const tradingRoutes = new Hono<HonoEnv>();
tradingRoutes.use("*", jwtAuthMiddleware);

// ── Place order ────────────────────────────────────────────────────────────
// Ported from apiv2's order.controller.ts + execution.engine.ts +
// risk-service/{risk.engine,margin.controller,leverage.guard}.ts, simplified
// for this pass: MARKET orders execute immediately (real quote, no simulated
// slippage/partial-fill/external-LP routing — always 100% B-book fill).
// LIMIT/STOP/STOP_LIMIT/TRAILING_STOP are accepted and stored as resting
// orders but are NOT actively trigger-monitored yet — that needs the
// continuous price-watching infra that's deferred to the real-time Durable
// Object phase, same as SL/TP auto-triggering on open positions. Kill-switch,
// per-instrument exposure limits, trading suspension, commission, and swap
// are deferred to the risk/admin phases.
tradingRoutes.post("/order", async (c) => {
  const dto = await validateBody(NewOrderDto, await c.req.json());
  const user = c.get("user")!;
  const symbol = dto.symbol.toUpperCase();
  const type = dto.type ?? "MARKET";
  const prisma = getPrisma(c.env);

  const meta = INSTRUMENT_META[symbol];
  if (!meta) throw new BadRequestException("INSTRUMENT_NOT_FOUND");

  const dbUser = await prisma.user.findUnique({ where: { id: user.sub }, select: { kycStatus: true } });
  if (!dbUser || dbUser.kycStatus !== "approved") {
    throw new BadRequestException("KYC_NOT_APPROVED: trading requires approved KYC");
  }

  if (dto.clientOrderId) {
    const dup = await prisma.order.findUnique({
      where: { userId_clientOrderId: { userId: user.sub, clientOrderId: dto.clientOrderId } },
    });
    if (dup) throw new BadRequestException(`DUPLICATE_CLIENT_ORDER_ID: '${dto.clientOrderId}' already exists`);
  }

  if (dto.quantity < meta.minLot) {
    throw new BadRequestException(`POSITION_SIZE_EXCEEDS_LIMIT: minimum trade size for ${symbol} is ${meta.minLot}`);
  }

  const quote = await prisma.quote.findUnique({ where: { symbol } });
  if (!quote) throw new BadRequestException("NO_LIVE_MARKET_DATA: instrument not in live feed");

  const lev = effectiveLeverage(meta.assetClass, dto.leverage ?? 1);
  const execPrice = dto.price ?? (dto.side === "BUY" ? quote.ask.toNumber() : quote.bid.toNumber());
  const notional = dto.quantity * execPrice;
  const marginRequired = notional / lev;

  const marginState = await getMarginState(prisma, user.sub);
  if (!canAcceptOrder(marginState, marginRequired)) {
    throw new BadRequestException(
      `INSUFFICIENT_MARGIN: need ${marginRequired.toFixed(2)} USD; only ${marginState.freeMargin.toFixed(2)} USD free`
    );
  }
  if ((marginRequired / marginState.equity) * 100 > 50) {
    throw new BadRequestException("POSITION_SIZE_EXCEEDS_LIMIT: order requires more than 50% of account equity");
  }

  const orderId = randomUUID();

  if (type !== "MARKET") {
    // Resting order — parked, not actively monitored yet in this phase.
    const order = await prisma.order.create({
      data: {
        id: orderId,
        userId: user.sub,
        symbol,
        side: dto.side,
        type,
        status: "ACCEPTED",
        quantity: dto.quantity,
        requestedPrice: execPrice,
        notional,
        marginRequired,
        leverage: lev,
        stopLoss: dto.stopLoss,
        takeProfit: dto.takeProfit,
        clientOrderId: dto.clientOrderId,
      },
    });
    return c.json({
      id: order.id,
      clientOrderId: order.clientOrderId ?? undefined,
      symbol,
      side: dto.side,
      type,
      quantity: dto.quantity,
      requestedPrice: execPrice,
      status: "ACCEPTED",
      marginRequired,
      notional,
      createdAt: order.createdAt.toISOString(),
    });
  }

  // MARKET order — single atomic transaction covers margin lock + order +
  // position + fill + ledger, avoiding the orphan-margin window apiv2 guards
  // against with retry-release logic (unnecessary here since it's all one tx).
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ balance: string; locked: string }>>`
      SELECT balance, locked FROM "WalletAccount" WHERE "userId" = ${user.sub} FOR UPDATE
    `;
    if (rows.length === 0) return { ok: false as const, reason: `WALLET_NOT_FOUND:${user.sub}` };
    const available = parseFloat(rows[0].balance) - parseFloat(rows[0].locked);
    if (available < marginRequired) {
      return { ok: false as const, reason: `INSUFFICIENT_MARGIN: available=${available.toFixed(2)}` };
    }

    const order = await tx.order.create({
      data: {
        id: orderId,
        userId: user.sub,
        symbol,
        side: dto.side,
        type: "MARKET",
        status: "FILLED",
        quantity: dto.quantity,
        filledQuantity: dto.quantity,
        requestedPrice: execPrice,
        averageFillPrice: execPrice,
        notional,
        marginRequired,
        leverage: lev,
        stopLoss: dto.stopLoss,
        takeProfit: dto.takeProfit,
        clientOrderId: dto.clientOrderId,
        filledAt: new Date(),
      },
    });

    const position = await tx.position.create({
      data: {
        userId: user.sub,
        orderId: order.id,
        symbol,
        side: dto.side,
        quantity: dto.quantity,
        entryPrice: execPrice,
        markPrice: execPrice,
        marginUsed: marginRequired,
        leverage: lev,
        stopLoss: dto.stopLoss,
        takeProfit: dto.takeProfit,
      },
    });

    await tx.fill.create({
      data: {
        orderId: order.id,
        positionId: position.id,
        quantity: dto.quantity,
        price: execPrice,
        liquidityProvider: "IGFX_INTERNAL",
      },
    });

    await tx.walletAccount.update({ where: { userId: user.sub }, data: { locked: { increment: marginRequired } } });
    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        userId: user.sub,
        currency: "USD",
        amount: -marginRequired,
        type: "MARGIN_LOCK",
        reference: order.id,
        status: "COMPLETED",
        note: `Margin locked for order ${order.id}`,
        debitAccount: `CLIENT_FREE:${user.sub}`,
        creditAccount: `CLIENT_MARGIN:${user.sub}`,
      },
    });

    await tx.tradeAudit.create({
      data: {
        userId: user.sub,
        orderId: order.id,
        positionId: position.id,
        symbol,
        side: dto.side,
        quantity: dto.quantity,
        entryPrice: execPrice,
        marginUsed: marginRequired,
        leverage: lev,
        stopLoss: dto.stopLoss,
        takeProfit: dto.takeProfit,
        tradeStatus: "OPEN",
        lifecycle: [{ status: "OPEN", timestamp: new Date().toISOString(), detail: `Opened @ ${execPrice}` }],
        riskMetrics: { marginRequired, notional, leverage: lev },
      },
    });

    return { ok: true as const, order, position };
  });

  if (!result.ok) throw new BadRequestException(result.reason);

  return c.json({
    id: result.order.id,
    clientOrderId: result.order.clientOrderId ?? undefined,
    symbol,
    side: dto.side,
    type: "MARKET",
    quantity: dto.quantity,
    requestedPrice: execPrice,
    averageFillPrice: execPrice,
    status: "FILLED",
    marginRequired,
    notional,
    createdAt: result.order.createdAt.toISOString(),
  });
});

// ── Positions ──────────────────────────────────────────────────────────────

tradingRoutes.get("/positions", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "200"), 500);

  const rows = await prisma.position.findMany({
    where: { userId: user.sub, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    take: limit,
  });

  return c.json(
    rows.map((p) => ({
      id: p.id,
      symbol: p.symbol,
      side: p.side,
      status: p.status,
      quantity: p.quantity.toNumber(),
      entryPrice: p.entryPrice.toNumber(),
      markPrice: p.markPrice.toNumber(),
      pnl: p.pnl.toNumber(),
      pnlPercent: p.pnlPercent.toNumber(),
      marginUsed: p.marginUsed.toNumber(),
      stopLoss: p.stopLoss?.toNumber() ?? null,
      takeProfit: p.takeProfit?.toNumber() ?? null,
      exitPrice: p.exitPrice?.toNumber() ?? null,
      openedAt: p.openedAt.toISOString(),
      closedAt: p.closedAt?.toISOString() ?? null,
      leverage: p.leverage,
      openedByAutopilot: p.openedByAutopilot,
    }))
  );
});

tradingRoutes.get("/position/:id", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const position = await prisma.position.findUnique({ where: { id: c.req.param("id") } });
  if (!position || position.userId !== user.sub) return c.json({ ok: false, reason: "POSITION_NOT_FOUND" });
  return c.json({ ok: true, position });
});

// ── Position close (full or partial) ────────────────────────────────────────
// Ported from apiv2's position.close.ts + settlement.engine.ts, simplified:
// no commission/swap charge (deferred), no exposure registry, no outbox
// event (deferred to real-time phase). Core financial correctness (PnL
// formula, negative balance protection, atomic wallet/position update) is
// faithful to the original.
tradingRoutes.post("/position/:id/close", async (c) => {
  const user = c.get("user")!;
  const positionId = c.req.param("id");
  const dto = await validateBody(ClosePositionDto, await c.req.json().catch(() => ({})));
  const prisma = getPrisma(c.env);

  const pos = await prisma.position.findUnique({ where: { id: positionId } });
  if (!pos) return c.json({ ok: false, reason: "POSITION_NOT_FOUND" });
  if (pos.userId !== user.sub) return c.json({ ok: false, reason: "UNAUTHORIZED" });
  if (pos.status !== "OPEN") return c.json({ ok: false, reason: `POSITION_ALREADY_${pos.status}` });

  const quote = await prisma.quote.findUnique({ where: { symbol: pos.symbol } });
  if (!quote) return c.json({ ok: false, reason: "NO_PRICE_AVAILABLE" });

  const closeQty = dto.quantity && dto.quantity < pos.quantity.toNumber() ? dto.quantity : pos.quantity.toNumber();
  const isPartial = closeQty < pos.quantity.toNumber();
  const exitPrice = pos.side === "BUY" ? quote.bid.toNumber() : quote.ask.toNumber();

  const entryPrice = pos.entryPrice.toNumber();
  const rawPnl = realizedPnl(pos.side as "BUY" | "SELL", closeQty, entryPrice, exitPrice);
  const marginPortion = (closeQty / pos.quantity.toNumber()) * pos.marginUsed.toNumber();
  const cappedPnl = applyNBP(rawPnl, marginPortion);
  const netCredit = cappedPnl;

  const result = await prisma.$transaction(async (tx) => {
    const posRows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM "Position" WHERE id = ${positionId} FOR UPDATE
    `;
    if (posRows.length === 0 || posRows[0].status !== "OPEN") {
      return { ok: false as const, reason: "POSITION_ALREADY_CLOSED" };
    }

    const walletRows = await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT locked FROM "WalletAccount" WHERE "userId" = ${user.sub} FOR UPDATE
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
          userId: user.sub,
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
      where: { userId: user.sub },
      data: { balance: { increment: netCredit }, locked: { decrement: safeRelease } },
      select: { balance: true },
    });

    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        userId: user.sub,
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
        userId: user.sub,
        currency: "USD",
        amount: safeRelease,
        type: "MARGIN_RELEASE",
        reference: positionId,
        status: "COMPLETED",
        note: `Margin released for closed position ${positionId}`,
        debitAccount: `CLIENT_MARGIN:${user.sub}`,
        creditAccount: `CLIENT_FREE:${user.sub}`,
      },
    });

    return { ok: true as const, pnl: cappedPnl, netCredit };
  });

  if (!result.ok) return c.json({ ok: false, reason: result.reason });

  return c.json({ ok: true, positionId, symbol: pos.symbol, pnl: result.pnl, exitPrice, netCredit: result.netCredit });
});

tradingRoutes.put("/position/:id", async (c) => {
  const user = c.get("user")!;
  const dto = await validateBody(ModifyOrderDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const pos = await prisma.position.findUnique({ where: { id: c.req.param("id") } });
  if (!pos || pos.userId !== user.sub) return c.json({ ok: false, reason: "POSITION_NOT_FOUND" });
  if (pos.status !== "OPEN") return c.json({ ok: false, reason: "POSITION_NOT_OPEN" });

  const updated = await prisma.position.update({
    where: { id: pos.id },
    data: {
      stopLoss: dto.stopLoss !== undefined ? dto.stopLoss : undefined,
      takeProfit: dto.takeProfit !== undefined ? dto.takeProfit : undefined,
    },
  });

  return c.json({ ok: true, position: updated });
});

// ── Order history / pending ─────────────────────────────────────────────────

tradingRoutes.get("/history", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const status = c.req.query("status");

  const orders = await prisma.order.findMany({
    where: { userId: user.sub, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  return c.json(orders);
});

tradingRoutes.get("/orders", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50"), 200);
  const offset = parseInt(c.req.query("offset") ?? "0");
  const status = c.req.query("status");

  const orders = await prisma.order.findMany({
    where: { userId: user.sub, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  return c.json(orders);
});

tradingRoutes.get("/orders/pending", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const orders = await prisma.order.findMany({
    where: { userId: user.sub, status: "ACCEPTED" },
    orderBy: { createdAt: "desc" },
  });
  return c.json({ ok: true, orders });
});

tradingRoutes.delete("/orders/pending/:pendingId", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const order = await prisma.order.findUnique({ where: { id: c.req.param("pendingId") } });
  if (!order || order.userId !== user.sub) return c.json({ ok: false, reason: "NOT_FOUND" });
  if (order.status !== "ACCEPTED") return c.json({ ok: false, reason: "ORDER_NOT_PENDING" });

  await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
  return c.json({ ok: true });
});

tradingRoutes.delete("/order/:orderId", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const order = await prisma.order.findUnique({ where: { id: c.req.param("orderId") } });
  if (!order || order.userId !== user.sub) throw new NotFoundException("Order not found");
  if (order.status !== "ACCEPTED") throw new BadRequestException("ORDER_NOT_CANCELLABLE");

  const marginToRelease = order.marginRequired.toNumber();

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

    if (marginToRelease > 0) {
      const rows = await tx.$queryRaw<Array<{ locked: string }>>`
        SELECT locked FROM "WalletAccount" WHERE "userId" = ${user.sub} FOR UPDATE
      `;
      const currentLocked = rows[0] ? parseFloat(rows[0].locked) : 0;
      const safeRelease = Math.max(0, Math.min(currentLocked, marginToRelease));
      if (safeRelease > 0) {
        await tx.walletAccount.update({ where: { userId: user.sub }, data: { locked: { decrement: safeRelease } } });
        await tx.ledgerEntry.create({
          data: {
            id: randomUUID(),
            userId: user.sub,
            currency: "USD",
            amount: safeRelease,
            type: "MARGIN_RELEASE",
            reference: order.id,
            status: "COMPLETED",
            note: `Margin released for cancelled order ${order.id}`,
            debitAccount: `CLIENT_MARGIN:${user.sub}`,
            creditAccount: `CLIENT_FREE:${user.sub}`,
          },
        });
      }
    }
  });

  return c.json({ ok: true });
});

tradingRoutes.put("/order/:orderId", async (c) => {
  const user = c.get("user")!;
  const dto = await validateBody(ModifyOrderDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const order = await prisma.order.findUnique({ where: { id: c.req.param("orderId") } });
  if (!order || order.userId !== user.sub) throw new NotFoundException("Order not found");

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      stopLoss: dto.stopLoss !== undefined ? dto.stopLoss : undefined,
      takeProfit: dto.takeProfit !== undefined ? dto.takeProfit : undefined,
    },
  });

  return c.json(updated);
});
