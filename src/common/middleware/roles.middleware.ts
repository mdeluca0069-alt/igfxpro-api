import type { MiddlewareHandler } from "hono";
import { ForbiddenException } from "../http-exceptions";
import type { HonoEnv } from "../types";

export const rolesMiddleware = (...requiredRoles: string[]): MiddlewareHandler<HonoEnv> => {
  return async (c, next) => {
    const user = c.get("user");
    if (!user || !requiredRoles.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException("Ruolo non autorizzato");
    }
    await next();
  };
};
