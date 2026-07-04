import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import type { HonoEnv } from "../../common/types";

export const usersRoutes = new Hono<HonoEnv>();

usersRoutes.get("/:email", async (c) => {
  const prisma = getPrisma(c.env);
  const user = await prisma.user.findUnique({ where: { email: c.req.param("email") } });
  return c.json(user);
});
