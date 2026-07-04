import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import type { HonoEnv } from "../../common/types";
import type { RiskEventType } from "@prisma/client";

export const riskRoutes = new Hono<HonoEnv>();

async function createRiskEvent(
  prisma: ReturnType<typeof getPrisma>,
  accountId: string,
  type: RiskEventType,
  level: number
) {
  return prisma.riskEvent.create({
    data: {
      accountId,
      type,
      severity: level > 50 ? "HIGH" : "MEDIUM",
      message: `Risk event of type ${type}`,
    },
  });
}

riskRoutes.post("/create", async (c) => {
  const body = await c.req.json<{ accountId: string; type: RiskEventType; level: number }>();
  const prisma = getPrisma(c.env);
  const event = await createRiskEvent(prisma, body.accountId, body.type, body.level);
  return c.json(event);
});

riskRoutes.post("/check", async (c) => {
  const body = await c.req.json<{ accountId: string }>();
  const prisma = getPrisma(c.env);

  const account = await prisma.account.findUnique({
    where: { id: body.accountId },
    include: { wallet: true, trades: true },
  });

  if (!account) {
    throw new Error("Account non trovato");
  }

  if (account.wallet && account.wallet.equity.lt(account.wallet.marginUsed.mul(0.5))) {
    const event = await createRiskEvent(prisma, body.accountId, "MARGIN_CALL", 50);
    return c.json(event);
  }

  return c.json(null);
});
