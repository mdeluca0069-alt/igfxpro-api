/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./common/types";
import type { Env } from "./prisma/prisma.edge";
import { healthRoutes } from "./modules/health/health.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { configRoutes, tenantRoutes } from "./modules/config/config.routes";
import { tradingDataRoutes, topLevelMarketRoutes, calendarRoutes } from "./modules/market-data/market-data.routes";
import { refreshQuotes } from "./modules/market-data/quotes.cron";
import { monitorPositions } from "./modules/trading/position-monitor";
import { tradingRoutes } from "./modules/trading/trading.routes";
import { walletRoutes, clientRoutes } from "./modules/wallet/wallet.routes";
import { riskRoutes } from "./modules/risk/risk.routes";
import { aiRoutes, signalsRoutes } from "./modules/ai/ai.routes";
import { autopilotRoutes } from "./modules/autopilot/autopilot.routes";
import { adminRoutes } from "./modules/admin/admin.routes";
import { watchlistRoutes } from "./modules/watchlist/watchlist.routes";
import { complianceRoutes, onboardingRoutes } from "./modules/compliance/compliance.routes";
import { reportsRoutes } from "./modules/reports/reports.routes";
import { taxRoutes } from "./modules/reports/tax.routes";
import { paperRoutes } from "./modules/paper/paper.routes";
import { supportRoutes, supportAdminRoutes } from "./modules/support/support.routes";
import { academyRoutes } from "./modules/academy/academy.routes";
import { apiKeyRoutes } from "./modules/public-api/api-key.routes";
import { RealtimeHub } from "./durable-objects/realtime-hub";

export { RealtimeHub };

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

app.route("/trading", tradingDataRoutes);
app.route("/api/v1/trading", tradingDataRoutes);
app.route("/trading", tradingRoutes);
app.route("/api/v1/trading", tradingRoutes);
app.route("/", topLevelMarketRoutes);
app.route("/api/v1", topLevelMarketRoutes);
app.route("/calendar", calendarRoutes);
app.route("/api/v1/calendar", calendarRoutes);

app.route("/wallet", walletRoutes);
app.route("/api/v1/wallet", walletRoutes);
app.route("/client", clientRoutes);
app.route("/api/v1/client", clientRoutes);

app.route("/risk", riskRoutes);
app.route("/api/v1/risk", riskRoutes);

app.route("/ai", aiRoutes);
app.route("/api/v1/ai", aiRoutes);
app.route("/signals", signalsRoutes);
app.route("/api/v1/signals", signalsRoutes);
app.route("/autopilot", autopilotRoutes);
app.route("/api/v1/autopilot", autopilotRoutes);

app.route("/admin", adminRoutes);
app.route("/api/v1/admin", adminRoutes);

app.route("/watchlist", watchlistRoutes);
app.route("/api/v1/watchlist", watchlistRoutes);
app.route("/compliance", complianceRoutes);
app.route("/api/v1/compliance", complianceRoutes);
app.route("/onboarding", onboardingRoutes);
app.route("/api/v1/onboarding", onboardingRoutes);

app.route("/reports", reportsRoutes);
app.route("/api/v1/reports", reportsRoutes);
app.route("/tax", taxRoutes);
app.route("/api/v1/tax", taxRoutes);

app.route("/paper", paperRoutes);
app.route("/api/v1/paper", paperRoutes);

app.route("/support", supportRoutes);
app.route("/api/v1/support", supportRoutes);
app.route("/admin/support", supportAdminRoutes);
app.route("/api/v1/admin/support", supportAdminRoutes);

app.route("/academy", academyRoutes);
app.route("/api/v1/academy", academyRoutes);

app.route("/api-keys", apiKeyRoutes);
app.route("/api/v1/api-keys", apiKeyRoutes);

export default {
  // Fase 9 — real-time WebSocket gateway. This bypasses Hono entirely: Hono's
  // Context wraps handler return values in a way that rejects status-101
  // (Switching Protocols) Responses ("Responses may only be constructed with
  // status codes in the range 200 to 599" — 101 is outside that range as far
  // as the *reconstructed* Response goes), so the DO's upgrade Response has
  // to be returned directly from the raw fetch handler, before app.fetch
  // ever sees the request. The JWT itself is verified inside the Durable
  // Object; auth failure there closes the socket with code 4001, which
  // igfxpro-frontend/api/websocket.ts already knows how to react to.
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const id = env.REALTIME_HUB.idFromName("global");
      return env.REALTIME_HUB.get(id).fetch(request);
    }
    return app.fetch(request, env, ctx);
  },
  scheduled: async (_event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      refreshQuotes(env).then(() => monitorPositions(env))
    );
  },
};
