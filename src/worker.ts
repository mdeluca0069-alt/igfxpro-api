import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./common/types";
import { healthRoutes } from "./modules/health/health.routes";

const app = new Hono<HonoEnv>();

app.use(
  "*",
  cors({
    origin: ["https://igfxpro.com", "https://www.igfxpro.com", "https://admin.igfxpro.com"],
    credentials: true,
  })
);

app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500;
  const message = err instanceof HTTPException ? err.message : "Internal server error";
  if (status === 500) console.error(err);

  return c.json(
    {
      success: false,
      statusCode: status,
      path: c.req.path,
      timestamp: new Date().toISOString(),
      message,
    },
    status
  );
});

app.get("/__ping", (c) => c.json({ ok: true }));

app.route("/health", healthRoutes);

export default app;
