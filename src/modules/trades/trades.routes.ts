import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import type { HonoEnv } from "../../common/types";

export const tradesRoutes = new Hono<HonoEnv>();

tradesRoutes.get("/", async (c) => {
  const prisma = getPrisma(c.env);
  const trades = await prisma.trade.findMany({ include: { account: true, market: true } });
  return c.json(trades);
});

tradesRoutes.get("/:id", async (c) => {
  const prisma = getPrisma(c.env);
  const trade = await prisma.trade.findUnique({
    where: { id: c.req.param("id") },
    include: { account: true, market: true },
  });
  return c.json(trade);
});
