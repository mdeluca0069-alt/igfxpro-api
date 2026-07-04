import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./common/types";
import { healthRoutes } from "./modules/health/health.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { configRoutes, tenantRoutes } from "./modules/config/config.routes";

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
app.route("/api/v1/health", healthRoutes);

// The frontend calls auth endpoints under both /auth/* and /api/v1/auth/*
// depending on the code path — mount the same routes at both prefixes.
app.route("/auth", authRoutes);
app.route("/api/v1/auth", authRoutes);

app.route("/config", configRoutes);
app.route("/tenant", tenantRoutes);

export default app;
