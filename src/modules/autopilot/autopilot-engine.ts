import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../../prisma/prisma.edge";
import type { Env } from "../../prisma/prisma.edge";
import { INSTRUMENT_META } from "../../common/instruments";
import { effectiveLeverage } from "../../common/leverage-guard";
import { getMarginState, canAcceptOrder } from "../../common/margin-controller";
import { pushToUser } from "../../common/realtime";

// The first version of this file that actually opens real positions —
// previously AutopilotConfig was pure configuration with nothing reading it
// (autopilot.routes.ts's own comment said so explicitly). Now that a real
// signal generator exists (signal-generator.ts), this closes the loop: every
// tick, for every user with autopilot enabled, check their real active
// signals against their real risk limits and place a real MARKET order
// through the exact same margin-lock/position/fill/ledger/TradeAudit
// transaction trading.routes.ts uses for manual orders — just tagged
// openedByAutopilot: true and gated by more safety checks than a manual
// order gets (spread guard, daily loss lock, max open/daily trade counts).
// SL/TP on the resulting position are taken directly from the signal, and
// then managed by the existing position-monitor cron exactly like a manual
// trade's SL/TP — no separate autopilot-specific close logic needed.

const MAX_NEW_TRADES_PER_TICK_PER_USER = 1;

export async function runAutopilotEngine(env: Env): Promise<void> {
  const prisma = getPrisma(env);

  const killSwitch = await prisma.brokerSetting.findUnique({ where: { key: "kill_switch" } });
  if ((killSwitch?.value as { enabled?: boolean } | undefined)?.enabled) return;

  const [configs, activeSignals] = await Promise.all([
    prisma.autopilotConfig.findMany({ where: { enabled: true, pausedByAdmin: false, consentAcceptedAt: { not: null } } }),
    prisma.olosSignal.findMany({ where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
  ]);
  if (configs.length === 0 || activeSignals.length === 0) return;

  for (const config of configs) {
    try {
      await evaluateUser(prisma, env, config, activeSignals);
    } catch (err) {
      console.error(`[autopilot-engine] user ${config.userId} failed:`, (err as Error).message);
    }
  }
}

async function evaluateUser(
  prisma: PrismaClient,
  env: Env,
  config: {
    userId: string;
    minConfidence: number;
    maxRiskPerTrade: number;
    maxOpenTrades: number;
    maxExposurePct: number;
    allowedSymbols: string[];
    blockedSymbols: string[];
    capitalPct: number;
    maxDailyTrades: number;
    maxDailyLossPct: number;
    dailyLossLockedUntil: Date | null;
    maxSpreadBps: number;
  },
  activeSignals: Array<{
    id: string;
    symbol: string;
    signalType: string;
    confidence: unknown;
    entryPrice: unknown;
    stopLoss: unknown;
    targetLevels: unknown;
  }>
): Promise<void> {
  const now = new Date();
  if (config.dailyLossLockedUntil && config.dailyLossLockedUntil > now) return;

  const user = await prisma.user.findUnique({ where: { id: config.userId }, select: { kycStatus: true } });
  if (!user || user.kycStatus !== "approved") return;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [openCount, dailyCount, wallet] = await Promise.all([
    prisma.position.count({ where: { userId: config.userId, status: "OPEN", openedByAutopilot: true } }),
    prisma.position.count({ where: { userId: config.userId, openedByAutopilot: true, openedAt: { gte: startOfDay } } }),
    prisma.walletAccount.findUnique({ where: { userId: config.userId } }),
  ]);
  if (!wallet || openCount >= config.maxOpenTrades || dailyCount >= config.maxDailyTrades) return;

  const openSymbols = new Set(
    (await prisma.position.findMany({ where: { userId: config.userId, status: "OPEN", openedByAutopilot: true }, select: { symbol: true } })).map(
      (p) => p.symbol
    )
  );

  let opened = 0;
  for (const signal of activeSignals) {
    if (opened >= MAX_NEW_TRADES_PER_TICK_PER_USER) break;

    const confidencePct = Number(signal.confidence);
    if (confidencePct / 100 < config.minConfidence) continue;
    if (config.blockedSymbols.includes(signal.symbol)) continue;
    if (config.allowedSymbols.length > 0 && !config.allowedSymbols.includes(signal.symbol)) continue;
    if (openSymbols.has(signal.symbol)) continue;

    const meta = INSTRUMENT_META[signal.symbol];
    if (!meta) continue;

    const quote = await prisma.quote.findUnique({ where: { symbol: signal.symbol } });
    if (!quote) continue;

    const spreadBps = (quote.spread.toNumber() / quote.mid.toNumber()) * 10_000;
    if (spreadBps > config.maxSpreadBps) continue;

    const side = signal.signalType === "BUY" ? "BUY" : "SELL";
    const execPrice = side === "BUY" ? quote.ask.toNumber() : quote.bid.toNumber();
    const stopLoss = Number(signal.stopLoss);
    const targets = signal.targetLevels as number[];
    const takeProfit = targets?.[0];

    const stopDistance = Math.abs(execPrice - stopLoss);
    if (stopDistance <= 0) continue;

    const equity = wallet.balance.toNumber();
    const riskAmount = equity * (config.maxRiskPerTrade || 0.02) * (config.capitalPct / 100);
    let quantity = riskAmount / (stopDistance * meta.contractSize);
    quantity = Math.max(meta.minLot, Math.min(meta.maxLot, quantity));
    quantity = Math.round(quantity / meta.minLot) * meta.minLot;
    if (quantity <= 0) continue;

    const leverage = effectiveLeverage(meta.assetClass, meta.leverage);
    const notional = quantity * execPrice;
    const marginRequired = notional / leverage;

    const marginState = await getMarginState(prisma, config.userId);
    if (!canAcceptOrder(marginState, marginRequired)) continue;
    if ((marginRequired / marginState.equity) * 100 > config.maxExposurePct) continue;

    const result = await openAutopilotPosition(prisma, config.userId, signal.symbol, side, quantity, execPrice, marginRequired, leverage, stopLoss, takeProfit, signal.id);
    if (result.ok) {
      opened++;
      openSymbols.add(signal.symbol);
      const decisionReason = `Confidence ${confidencePct.toFixed(0)}% ${side} setup — entered ${quantity} lots @ ${execPrice}`;
      await Promise.all([
        pushToUser(env, config.userId, "order.filled", { orderId: result.orderId, symbol: signal.symbol, side, quantity, fillPrice: execPrice }),
        pushToUser(env, config.userId, "position.opened", {
          id: result.positionId,
          symbol: signal.symbol,
          side,
          status: "OPEN",
          quantity,
          entryPrice: execPrice,
          markPrice: execPrice,
          pnl: 0,
          pnlPercent: 0,
          marginUsed: marginRequired,
          stopLoss,
          takeProfit: takeProfit ?? null,
          exitPrice: null,
          openedAt: new Date().toISOString(),
          closedAt: null,
          leverage,
          openedByAutopilot: true,
        }),
        // Real record of what autopilot actually did and why — previously
        // this field was never written by any code path, so the frontend's
        // "Last AI decision" panel was permanently empty for every account.
        prisma.autopilotConfig.update({
          where: { userId: config.userId },
          data: { lastDecision: { symbol: signal.symbol, action: side, reason: decisionReason, timestamp: new Date().toISOString() } },
        }),
      ]);
      console.log(`[autopilot-engine] user=${config.userId} opened ${side} ${signal.symbol} qty=${quantity}`);
    }
  }
}

async function openAutopilotPosition(
  prisma: PrismaClient,
  userId: string,
  symbol: string,
  side: string,
  quantity: number,
  execPrice: number,
  marginRequired: number,
  leverage: number,
  stopLoss: number,
  takeProfit: number | undefined,
  signalId: string
): Promise<{ ok: true; orderId: string; positionId: string } | { ok: false }> {
  const notional = quantity * execPrice;

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ balance: string; locked: string }>>`
      SELECT balance, locked FROM "WalletAccount" WHERE "userId" = ${userId} FOR UPDATE
    `;
    if (rows.length === 0) return { ok: false as const };
    const available = parseFloat(rows[0].balance) - parseFloat(rows[0].locked);
    if (available < marginRequired) return { ok: false as const };

    const order = await tx.order.create({
      data: {
        userId,
        symbol,
        side,
        type: "MARKET",
        status: "FILLED",
        quantity,
        filledQuantity: quantity,
        requestedPrice: execPrice,
        averageFillPrice: execPrice,
        notional,
        marginRequired,
        leverage,
        stopLoss,
        takeProfit,
        filledAt: new Date(),
      },
    });

    const position = await tx.position.create({
      data: {
        userId,
        orderId: order.id,
        symbol,
        side,
        quantity,
        entryPrice: execPrice,
        markPrice: execPrice,
        marginUsed: marginRequired,
        leverage,
        stopLoss,
        takeProfit,
        openedByAutopilot: true,
      },
    });

    await tx.fill.create({
      data: { orderId: order.id, positionId: position.id, quantity, price: execPrice, liquidityProvider: "IGFX_INTERNAL" },
    });

    await tx.walletAccount.update({ where: { userId }, data: { locked: { increment: marginRequired } } });
    await tx.ledgerEntry.create({
      data: {
        id: randomUUID(),
        userId,
        currency: "USD",
        amount: -marginRequired,
        type: "MARGIN_LOCK",
        reference: order.id,
        status: "COMPLETED",
        note: `Margin locked for autopilot order ${order.id} (signal ${signalId})`,
        debitAccount: `CLIENT_FREE:${userId}`,
        creditAccount: `CLIENT_MARGIN:${userId}`,
      },
    });

    await tx.tradeAudit.create({
      data: {
        userId,
        orderId: order.id,
        positionId: position.id,
        symbol,
        side,
        quantity,
        entryPrice: execPrice,
        stopLoss,
        takeProfit,
        marginUsed: marginRequired,
        leverage,
        tradeStatus: "OPEN",
        lifecycle: [{ status: "OPEN", timestamp: new Date().toISOString(), detail: `Autopilot opened @ ${execPrice} (signal ${signalId})` }],
        riskMetrics: { marginRequired, notional, leverage, signalId },
      },
    });

    return { ok: true as const, orderId: order.id, positionId: position.id };
  });

  return result.ok ? { ok: true, orderId: result.orderId, positionId: result.positionId } : { ok: false };
}
