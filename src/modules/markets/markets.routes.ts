import { Hono } from "hono";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";

export const marketsRoutes = new Hono<HonoEnv>();

marketsRoutes.use("*", jwtAuthMiddleware);

marketsRoutes.post("/submit", async (c) => {
  const body = await c.req.json<{ userId: string; [key: string]: unknown }>();
  return c.json({ success: true, message: "MIFID submitted", userId: body.userId, data: body });
});

marketsRoutes.get("/eligibility/:userId", async (c) => {
  return c.json({ eligible: true, userId: c.req.param("userId") });
});
