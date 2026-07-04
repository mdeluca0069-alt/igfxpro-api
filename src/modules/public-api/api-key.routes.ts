import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import { BadRequestException, NotFoundException } from "../../common/http-exceptions";
import type { HonoEnv } from "../../common/types";

// Ported from apiv2's public-api/api.key.service.ts — programmatic API key
// management (create/list/revoke), stored hashed in BrokerSetting (apiv2's
// own storage choice, kept as-is). The runtime validate()/rate-limit/HMAC
// verification path is for authenticating *incoming* Public API requests —
// out of scope here since there is no separate Public API gateway yet, only
// this management CRUD (what the frontend's API-keys settings page calls).

export const apiKeyRoutes = new Hono<HonoEnv>();
apiKeyRoutes.use("*", jwtAuthMiddleware);

type ApiKeyScope = "read" | "trade" | "admin";

type ApiKeyRecord = {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiKeyScope[];
  rateLimit: number;
  environment: "live" | "paper";
  enabled: boolean;
  lastUsedAt: string | null;
  requestCount: number;
  createdAt: string;
  expiresAt: string | null;
};

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

apiKeyRoutes.get("/", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const rows = await prisma.brokerSetting.findMany({ where: { key: { startsWith: "api_key:" } } });
  const keys = rows
    .map((r) => r.value as ApiKeyRecord)
    .filter((k) => k.userId === user.sub)
    .map((k) => ({ ...k, keyHash: "***" }));
  return c.json({ keys });
});

apiKeyRoutes.post("/", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const body = await c.req.json<{ name?: string; scopes?: ApiKeyScope[]; environment?: "live" | "paper"; rateLimit?: number; expiresAt?: string }>();

  if (!body.name || !body.scopes?.length || !body.environment) {
    throw new BadRequestException("name, scopes and environment are required");
  }

  const raw = randomHex(32);
  const prefix = `igfx_${body.environment}_`;
  const plaintext = `${prefix}${raw}`;
  const keyHash = await sha256Hex(plaintext);
  const keyPrefix = plaintext.slice(0, 16);
  const id = `ak_${randomHex(8)}`;
  const now = new Date().toISOString();

  const key: ApiKeyRecord = {
    id,
    userId: user.sub,
    name: body.name,
    keyPrefix,
    keyHash,
    scopes: body.scopes,
    rateLimit: body.rateLimit ?? 600,
    environment: body.environment,
    enabled: true,
    lastUsedAt: null,
    requestCount: 0,
    createdAt: now,
    expiresAt: body.expiresAt ?? null,
  };

  await prisma.brokerSetting.create({ data: { key: `api_key:${id}`, value: key } });

  return c.json({ key: { ...key, keyHash: "***" }, plaintext, warning: "Store this key securely — it will not be shown again" });
});

apiKeyRoutes.delete("/:keyId", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const keyId = c.req.param("keyId");
  const row = await prisma.brokerSetting.findUnique({ where: { key: `api_key:${keyId}` } });
  const existing = row?.value as ApiKeyRecord | undefined;
  if (!existing || existing.userId !== user.sub) throw new NotFoundException("API key not found");

  await prisma.brokerSetting.update({ where: { key: `api_key:${keyId}` }, data: { value: { ...existing, enabled: false } } });
  return c.json({ ok: true });
});

apiKeyRoutes.delete("/", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const rows = await prisma.brokerSetting.findMany({ where: { key: { startsWith: "api_key:" } } });
  const own = rows.filter((r) => (r.value as ApiKeyRecord).userId === user.sub);

  await Promise.all(
    own.map((r) => prisma.brokerSetting.update({ where: { key: r.key }, data: { value: { ...(r.value as ApiKeyRecord), enabled: false } } }))
  );

  return c.json({ ok: true, revokedCount: own.length });
});
