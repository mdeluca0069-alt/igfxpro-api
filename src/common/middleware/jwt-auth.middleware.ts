import type { MiddlewareHandler } from "hono";
import { verifyJwt } from "../jwt";
import { UnauthorizedException } from "../http-exceptions";
import type { HonoEnv } from "../types";

export const jwtAuthMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader) throw new UnauthorizedException("Header mancante");

  const token = authHeader.split(" ")[1];
  try {
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    c.set("user", payload);
  } catch {
    throw new UnauthorizedException("Token non valido");
  }

  await next();
};
