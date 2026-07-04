import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import type { HonoEnv } from "../../common/types";
import { TradeStatus, type TradeType } from "@prisma/client";

export const tradingRoutes = new Hono<HonoEnv>();

tradingRoutes.post("/open", async (c) => {
  const body = await c.req.json<{
    accountId: string;
    marketId: string;
    symbol: string;
    type: TradeType;
    volume: number;
    price: number;
  }>();
  const prisma = getPrisma(c.env);

  const trade = await prisma.trade.create({
    data: {
      accountId: body.accountId,
      marketId: body.marketId,
      symbol: body.symbol,
      type: body.type,
      status: TradeStatus.OPEN,
      volume: body.volume,
      price: body.price,
      entryPrice: body.price,
    },
  });

  await prisma.priceSnapshot.create({
    data: { symbol: body.symbol, price: body.price, timestamp: new Date() },
  });

  return c.json(trade);
});

tradingRoutes.post("/close", async (c) => {
  const body = await c.req.json<{ tradeId: string; exitPrice: number }>();
  const prisma = getPrisma(c.env);

  const trade = await prisma.trade.update({
    where: { id: body.tradeId },
    data: { status: TradeStatus.CLOSED, exitPrice: body.exitPrice, closedAt: new Date() },
  });

  return c.json(trade);
});
