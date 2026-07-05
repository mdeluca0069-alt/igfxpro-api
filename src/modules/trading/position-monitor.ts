import { getPrisma } from "../../prisma/prisma.edge";
import type { Env } from "../../prisma/prisma.edge";
import { closePosition } from "../../common/position-closer";
import { fillPendingOrder } from "../../common/order-filler";
import { pushToUser } from "../../common/realtime";

// Fase 9 — Workers-native replacement for apiv2's always-on
// PositionPriceMonitor + OrderTriggerWatcher + StopOutEngine (which subscribe
// to a continuous in-memory WS tick stream — impossible on Workers, which
// have no persistent process). Runs once per Cron Trigger tick (same 1-min
// cadence as the quote refresh, right after it) instead of on every tick:
//   1. SL/TP check on every OPEN position, using apiv2's own crossing rules.
//   2. Trigger check on every ACCEPTED resting order (LIMIT/STOP/STOP_LIMIT/
//      TRAILING_STOP), same crossing rules apiv2's order.trigger.watcher.ts
//      uses. Simplification: STOP_LIMIT and TRAILING_STOP fill immediately
//      at the stored trigger price rather than apiv2's two-stage
//      arm-a-limit-leg / trail-the-stop-level behavior — our Order schema
//      only stores one trigger price per resting order (Fase 3 decision),
//      so there's no separate limitPrice/trailAmount to honor here.
//   3. Mark-to-market P&L push + DB update for every remaining OPEN position.
//   4. Per-user margin level check with apiv2's stopout.engine.ts thresholds
//      (150% warning / 100% margin call / 50% ESMA mandatory stop-out),
//      writing real RiskWarning rows (closing the gap flagged in Fase 5)
//      and liquidating positions largest-loss-first on stop-out.
export async function monitorPositions(env: Env): Promise<void> {
  const prisma = getPrisma(env);

  const [positions, quotes] = await Promise.all([prisma.position.findMany({ where: { status: "OPEN" } }), prisma.quote.findMany()]);
  const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, { bid: q.bid.toNumber(), ask: q.ask.toNumber() }]));

  const closedIds = new Set<string>();

  // ── 1. SL/TP check ─────────────────────────────────────────────────────────
  for (const pos of positions) {
    const q = quoteBySymbol.get(pos.symbol);
    if (!q) continue;
    const side = pos.side as "BUY" | "SELL";
    const sl = pos.stopLoss?.toNumber() ?? null;
    const tp = pos.takeProfit?.toNumber() ?? null;

    const slHit = sl !== null && (side === "BUY" ? q.bid <= sl : q.ask >= sl);
    const tpHit = !slHit && tp !== null && (side === "BUY" ? q.bid >= tp : q.ask <= tp);
    if (!slHit && !tpHit) continue;

    const reason = slHit ? "STOP_LOSS" : "TAKE_PROFIT";
    const result = await closePosition(prisma, pos.id);
    if (!result.ok) continue;

    closedIds.add(pos.id);
    await Promise.all([
      pushToUser(env, pos.userId, "position.closed", { positionId: pos.id, symbol: pos.symbol, pnl: result.pnl, closeReason: reason }),
      pushToUser(env, pos.userId, "position.pnl_updated", {
        positionId: pos.id,
        symbol: pos.symbol,
        markPrice: result.exitPrice,
        pnl: result.pnl,
        pnlPercent: 0,
        closedBy: reason,
      }),
      pushToUser(env, pos.userId, "wallet.updated", {}),
    ]);
  }

  // ── 2. Mark-to-market for everything still open ────────────────────────────
  const stillOpen = positions.filter((p) => !closedIds.has(p.id));
  const pnlUpdates: Array<{ id: string; userId: string; symbol: string; markPrice: number; pnl: number; pnlPercent: number }> = [];

  for (const pos of stillOpen) {
    const q = quoteBySymbol.get(pos.symbol);
    if (!q) continue;
    const side = pos.side as "BUY" | "SELL";
    const markPrice = side === "BUY" ? q.bid : q.ask;
    const direction = side === "BUY" ? 1 : -1;
    const entryPrice = pos.entryPrice.toNumber();
    const pnl = (markPrice - entryPrice) * pos.quantity.toNumber() * direction;
    const pnlPct = entryPrice !== 0 ? ((markPrice - entryPrice) / entryPrice) * 100 * direction : 0;
    pnlUpdates.push({ id: pos.id, userId: pos.userId, symbol: pos.symbol, markPrice, pnl, pnlPercent: pnlPct });
  }

  await Promise.all(
    pnlUpdates.map((u) =>
      prisma.position.updateMany({ where: { id: u.id, status: "OPEN" }, data: { markPrice: u.markPrice, pnl: u.pnl, pnlPercent: u.pnlPercent } })
    )
  );
  await Promise.all(
    pnlUpdates.map((u) =>
      pushToUser(env, u.userId, "position.pnl_updated", { positionId: u.id, symbol: u.symbol, markPrice: u.markPrice, pnl: u.pnl, pnlPercent: u.pnlPercent })
    )
  );

  // ── 3. Pending order triggers ────────────────────────────────────────────
  const pendingOrders = await prisma.order.findMany({ where: { status: "ACCEPTED", type: { not: "MARKET" } } });
  for (const order of pendingOrders) {
    const q = quoteBySymbol.get(order.symbol);
    if (!q || order.requestedPrice === null) continue;
    const trigger = order.requestedPrice.toNumber();
    const side = order.side as "BUY" | "SELL";

    const triggered =
      order.type === "LIMIT"
        ? side === "BUY"
          ? q.ask <= trigger
          : q.bid >= trigger
        : side === "BUY"
          ? q.ask >= trigger
          : q.bid <= trigger;
    if (!triggered) continue;

    const execPrice = side === "BUY" ? q.ask : q.bid;
    const result = await fillPendingOrder(prisma, order.id, execPrice);
    if (result.ok === false) {
      await pushToUser(env, order.userId, "order.rejected", { orderId: order.id, reason: result.reason });
      continue;
    }

    await Promise.all([
      pushToUser(env, result.userId, "order.triggered", { orderId: order.id, symbol: result.symbol, execPrice }),
      pushToUser(env, result.userId, "order.filled", { orderId: order.id, symbol: result.symbol, side: result.side, quantity: result.quantity, fillPrice: execPrice }),
      pushToUser(env, result.userId, "position.opened", {
        id: result.positionId,
        symbol: result.symbol,
        side: result.side,
        status: "OPEN",
        quantity: result.quantity,
        entryPrice: execPrice,
        markPrice: execPrice,
        pnl: 0,
        pnlPercent: 0,
        marginUsed: result.marginRequired,
        stopLoss: order.stopLoss?.toNumber() ?? null,
        takeProfit: order.takeProfit?.toNumber() ?? null,
        exitPrice: null,
        openedAt: new Date().toISOString(),
        closedAt: null,
        leverage: order.leverage,
        openedByAutopilot: false,
      }),
    ]);
  }

  // ── 4. Per-user margin level / ESMA stop-out ────────────────────────────
  const userIds = [...new Set(stillOpen.map((p) => p.userId))];
  for (const userId of userIds) {
    await checkMarginLevel(env, prisma, userId);
  }
}

const WARNING_PCT = 150;
const MARGIN_CALL_PCT = 100;
const STOP_OUT_PCT = 50;

async function checkMarginLevel(env: Env, prisma: ReturnType<typeof getPrisma>, userId: string): Promise<void> {
  const [wallet, openPositions] = await Promise.all([
    prisma.walletAccount.findUnique({ where: { userId } }),
    prisma.position.findMany({ where: { userId, status: "OPEN" } }),
  ]);
  if (!wallet || openPositions.length === 0) return;

  const balance = wallet.balance.toNumber();
  const marginUsed = openPositions.reduce((s, p) => s + p.marginUsed.toNumber(), 0);
  const unrealizedPnl = openPositions.reduce((s, p) => s + p.pnl.toNumber(), 0);
  const equity = balance + unrealizedPnl;
  const marginLevel = marginUsed > 0 ? (equity / marginUsed) * 100 : Infinity;

  if (!Number.isFinite(marginLevel) || marginLevel >= WARNING_PCT) return;

  const riskScore = Math.round(Math.max(0, Math.min(100, 100 - (marginLevel - STOP_OUT_PCT) / 2)));

  if (marginLevel >= MARGIN_CALL_PCT) {
    await writeRiskWarning(prisma, userId, marginLevel, riskScore, "WARNING", "INFO");
    await pushToUser(env, userId, "risk.warning", { warning: { severity: "WARNING", marginLevel, riskScore, message: `Margin level at ${marginLevel.toFixed(0)}% — consider adding funds` } });
    return;
  }

  if (marginLevel >= STOP_OUT_PCT) {
    await writeRiskWarning(prisma, userId, marginLevel, riskScore, "MARGIN_CALL", "WARNING");
    await Promise.all([
      pushToUser(env, userId, "margin.warning", { marginLevel, message: `Margin call: level at ${marginLevel.toFixed(0)}% — new positions restricted` }),
      pushToUser(env, userId, "risk.margin_call", { marginLevel }),
    ]);
    return;
  }

  // ── ESMA mandatory stop-out: liquidate positions largest-loss-first ──────
  await writeRiskWarning(prisma, userId, marginLevel, 100, "STOP_OUT", "CRITICAL");
  const sorted = [...openPositions].sort((a, b) => a.pnl.toNumber() - b.pnl.toNumber());
  let liquidated = 0;
  let totalPnl = 0;

  for (const pos of sorted) {
    const result = await closePosition(prisma, pos.id);
    if (result.ok) {
      liquidated++;
      totalPnl += result.pnl;
      await Promise.all([
        pushToUser(env, userId, "position.closed", { positionId: pos.id, symbol: pos.symbol, pnl: result.pnl, closeReason: "STOP_OUT" }),
        pushToUser(env, userId, "wallet.updated", {}),
      ]);
    }

    const refreshed = await prisma.walletAccount.findUnique({ where: { userId } });
    const remainingOpen = await prisma.position.count({ where: { userId, status: "OPEN" } });
    if (remainingOpen === 0 || !refreshed) break;
    const remainingMarginUsed = (await prisma.position.aggregate({ where: { userId, status: "OPEN" }, _sum: { marginUsed: true, pnl: true } }))._sum;
    const stillLocked = remainingMarginUsed.marginUsed?.toNumber() ?? 0;
    if (stillLocked <= 0) break;
    const newEquity = refreshed.balance.toNumber() + (remainingMarginUsed.pnl?.toNumber() ?? 0);
    if ((newEquity / stillLocked) * 100 > STOP_OUT_PCT) break;
  }

  await pushToUser(env, userId, "risk.stop_out", { marginLevel, positionsClosed: liquidated, totalPnl });
}

async function writeRiskWarning(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
  marginLevel: number,
  riskScore: number,
  regulatoryLevel: string,
  severity: string
): Promise<void> {
  await prisma.riskWarning.create({
    data: {
      userId,
      riskScore,
      marginLevel,
      portfolioAggregate: {},
      scenarios: [],
      upcomingEvents: [],
      marginForecast: {},
      exposureHeatmap: {},
      killSwitchTriggers: [],
      eventCalendarItems: [],
      regulatoryLevel,
      regulatoryText: `Margin level ${marginLevel.toFixed(1)}% — ESMA mandatory stop-out floor is ${STOP_OUT_PCT}%`,
      severity,
    },
  });
}
