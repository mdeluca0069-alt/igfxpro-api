import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { HonoEnv } from "./common/types";
import { healthRoutes } from "./modules/health/health.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { usersRoutes } from "./modules/users/users.routes";
import { accountsRoutes } from "./modules/accounts/accounts.routes";
import { marketsRoutes } from "./modules/markets/markets.routes";
import { riskRoutes } from "./modules/risk/risk.routes";
import { tradingRoutes } from "./modules/trading/trading.routes";
import { tradesRoutes } from "./modules/trades/trades.routes";
import { executionRoutes } from "./modules/execution/execution.routes";

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
app.route("/auth", authRoutes);
app.route("/users", usersRoutes);
app.route("/accounts", accountsRoutes);
app.route("/markets", marketsRoutes);
app.route("/risk", riskRoutes);
app.route("/trading", tradingRoutes);
app.route("/trades", tradesRoutes);
app.route("/execution", executionRoutes);

export default app;
