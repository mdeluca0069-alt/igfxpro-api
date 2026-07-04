import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { rolesMiddleware } from "../../common/middleware/roles.middleware";
import type { HonoEnv } from "../../common/types";
import { AccountStatus, RoleName, type AccountType } from "@prisma/client";

export const accountsRoutes = new Hono<HonoEnv>();

accountsRoutes.post("/", jwtAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const body = await c.req.json<{ type: AccountType; currency: string; leverage: number }>();
  const prisma = getPrisma(c.env);

  const account = await prisma.account.create({
    data: {
      userId: user.sub,
      type: body.type,
      currency: body.currency,
      leverage: body.leverage,
      status: AccountStatus.INACTIVE,
      wallet: {
        create: {
          balance: 0,
          available: 0,
          marginUsed: 0,
          equity: 0,
          freeMargin: 0,
        },
      },
    },
    include: { wallet: true },
  });

  return c.json({ success: true, account });
});

accountsRoutes.get("/me", jwtAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const accounts = await prisma.account.findMany({
    where: { userId: user.sub },
    include: { wallet: true },
    orderBy: { createdAt: "desc" },
  });
  return c.json(accounts);
});

accountsRoutes.get("/admin/all", jwtAuthMiddleware, rolesMiddleware(RoleName.ADMIN), async (c) => {
  const prisma = getPrisma(c.env);
  const accounts = await prisma.account.findMany({ include: { user: true, wallet: true } });
  return c.json(accounts);
});
