import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import type { HonoEnv } from "../../common/types";

export const healthRoutes = new Hono<HonoEnv>();

healthRoutes.get("/", async (c) => {
  const prisma = getPrisma(c.env);
  await prisma.$queryRaw`SELECT 1`;
  return c.json({ status: "ok", timestamp: new Date() });
});
