import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import { signJwt, verifyJwt } from "../../common/jwt";
import { validateBody } from "../../common/validate";
import { getPermissionsForRoles } from "../../common/access-policy";
import { formatAccountNumber } from "../../common/account-number";
import { createOpaqueToken } from "../../common/opaque-token";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";
import { LoginDto, RegisterDto } from "./dto";

export const authRoutes = new Hono<HonoEnv>();

const SESSION_TTL_DAYS = 7;
const ACCESS_TOKEN_TTL = "1h";
const COOKIE_NAME = "igfxpro_rt";

function parseRoles(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return [];
    }
  }
  return [];
}

function buildPrincipal(user: {
  id: string;
  email: string;
  fullName: string;
  tenantId: string;
  tier: string;
  kycStatus: string;
}, roles: string[], permissions: string[]) {
  return {
    sub: user.id,
    email: user.email,
    fullName: user.fullName,
    tenantId: user.tenantId,
    tier: user.tier,
    roles,
    permissions,
    kycStatus: user.kycStatus,
    mfaRequired: false,
    accountNumber: formatAccountNumber(user.id),
  };
}

async function createSession(prisma: ReturnType<typeof getPrisma>, userId: string) {
  const refreshToken = createOpaqueToken("rt");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await prisma.session.create({ data: { refreshToken, userId, expiresAt } });
  return refreshToken;
}

function setRefreshCookie(c: import("hono").Context, token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
    secure: true,
  });
}

function clearRefreshCookie(c: import("hono").Context) {
  setCookie(c, COOKIE_NAME, "", { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 0, secure: true });
}

async function loginOrRegisterResponse(
  c: import("hono").Context,
  prisma: ReturnType<typeof getPrisma>,
  user: { id: string; email: string; fullName: string; tenantId: string; tier: string; kycStatus: string },
  roles: string[],
  permissions: string[],
  jwtSecret: string
) {
  const principal = buildPrincipal(user, roles, permissions);
  const accessToken = await signJwt(
    { sub: user.id, email: user.email, tenantId: user.tenantId, roles, permissions },
    jwtSecret,
    ACCESS_TOKEN_TTL
  );
  const refreshToken = await createSession(prisma, user.id);
  setRefreshCookie(c, refreshToken);

  return c.json({
    ok: true,
    accessToken,
    expiresIn: 3600,
    tokenType: "Bearer",
    principal,
    tenantId: user.tenantId,
  });
}

async function handleLogin(c: import("hono").Context<HonoEnv>) {
  const dto = await validateBody(LoginDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const user = await prisma.user.findUnique({ where: { email: dto.email.toLowerCase().trim() } });
  if (!user) return c.json({ ok: false, reason: "INVALID_CREDENTIALS" });

  const valid = bcrypt.compareSync(dto.password, user.password);
  if (!valid) return c.json({ ok: false, reason: "INVALID_CREDENTIALS" });

  const roles = parseRoles(user.roles);
  const permissions = parseRoles(user.permissions);
  return loginOrRegisterResponse(c, prisma, user, roles, permissions, c.env.JWT_SECRET);
}

async function handleRegister(c: import("hono").Context<HonoEnv>) {
  const dto = await validateBody(RegisterDto, await c.req.json());
  const prisma = getPrisma(c.env);
  const email = dto.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return c.json({ ok: false, reason: "EMAIL_TAKEN" });

  let tenant = await prisma.tenant.findFirst();
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { id: randomUUID(), name: "IGFXPRO Default", region: "EU" } });
  }

  const userId = randomUUID();
  const hashedPassword = bcrypt.hashSync(dto.password, 10);
  const roles = ["trader"];
  const permissions = getPermissionsForRoles(roles);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        id: userId,
        email,
        password: hashedPassword,
        fullName: dto.fullName,
        role: "trader",
        roles: JSON.stringify(roles),
        permissions: JSON.stringify(permissions),
        tier: dto.tier ?? "STANDARD",
        kycStatus: "not_started",
        tenantId: tenant!.id,
      },
    });
    await tx.walletAccount.create({
      data: { userId, currency: "USD", balance: 0, equity: 0, locked: 0 },
    });
    return created;
  });

  return loginOrRegisterResponse(c, prisma, user, roles, permissions, c.env.JWT_SECRET);
}

async function handleRefresh(c: import("hono").Context<HonoEnv>) {
  const cookieToken = getCookie(c, COOKIE_NAME);
  let bodyToken = "";
  try {
    const body = await c.req.json<{ refreshToken?: string }>();
    bodyToken = body?.refreshToken ?? "";
  } catch {
    // no body sent — fine, cookie is the primary path
  }
  const token = cookieToken || bodyToken;
  if (!token) return c.json({ ok: false, reason: "no_refresh_token" });

  const prisma = getPrisma(c.env);
  const session = await prisma.session.findUnique({ where: { refreshToken: token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { refreshToken: token } }).catch(() => {});
    clearRefreshCookie(c);
    return c.json({ ok: false, reason: "invalid_refresh_token" });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    clearRefreshCookie(c);
    return c.json({ ok: false, reason: "invalid_refresh_token" });
  }

  const roles = parseRoles(user.roles);
  const permissions = parseRoles(user.permissions);

  const newRefreshToken = createOpaqueToken("rt");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await prisma.$transaction([
    prisma.session.delete({ where: { refreshToken: token } }),
    prisma.session.create({ data: { refreshToken: newRefreshToken, userId: user.id, expiresAt } }),
  ]);
  setRefreshCookie(c, newRefreshToken);

  const accessToken = await signJwt(
    { sub: user.id, email: user.email, tenantId: user.tenantId, roles, permissions },
    c.env.JWT_SECRET,
    ACCESS_TOKEN_TTL
  );
  const principal = buildPrincipal(user, roles, permissions);

  return c.json({
    ok: true,
    accessToken,
    expiresIn: 3600,
    tokenType: "Bearer",
    principal,
    tenantId: user.tenantId,
  });
}

async function handleLogout(c: import("hono").Context<HonoEnv>) {
  const token = getCookie(c, COOKIE_NAME);
  if (token) {
    const prisma = getPrisma(c.env);
    await prisma.session.delete({ where: { refreshToken: token } }).catch(() => {});
  }
  clearRefreshCookie(c);
  return c.json({ ok: true });
}

authRoutes.post("/login/db", handleLogin);
authRoutes.post("/login", handleLogin);
authRoutes.post("/session", handleLogin);
authRoutes.post("/register/db", handleRegister);
authRoutes.post("/refresh/db", handleRefresh);
authRoutes.post("/refresh", handleRefresh);
authRoutes.post("/logout", handleLogout);

authRoutes.get("/session", jwtAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const dbUser = await prisma.user.findUnique({ where: { id: user.sub } });
  if (!dbUser) return c.json({ principal: null });
  const roles = parseRoles(dbUser.roles);
  const permissions = parseRoles(dbUser.permissions);
  return c.json({ principal: buildPrincipal(dbUser, roles, permissions) });
});

authRoutes.get("/sessions", jwtAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const sessions = await prisma.session.findMany({
    where: { userId: user.sub, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return c.json({
    ok: true,
    sessions: sessions.map((s) => ({
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      tokenHint: s.refreshToken.slice(0, 8) + "...",
    })),
  });
});

authRoutes.delete("/sessions/all", jwtAuthMiddleware, async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  clearRefreshCookie(c);
  const { count } = await prisma.session.deleteMany({ where: { userId: user.sub } });
  return c.json({ ok: true, revokedCount: count });
});
