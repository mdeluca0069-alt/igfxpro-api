import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { getPrisma } from "../../prisma/prisma.edge";
import { signJwt } from "../../common/jwt";
import { validateBody } from "../../common/validate";
import { UnauthorizedException } from "../../common/http-exceptions";
import { LoginDto } from "./dto/login.dto";
import type { HonoEnv } from "../../common/types";

export const authRoutes = new Hono<HonoEnv>();

authRoutes.post("/login", async (c) => {
  const dto = await validateBody(LoginDto, await c.req.json());
  const prisma = getPrisma(c.env);

  const user = await prisma.user.findUnique({ where: { email: dto.email } });
  if (!user) throw new UnauthorizedException("Credenziali non valide");

  // bcrypt.compare() (async) relies on setImmediate for chunking, which hangs
  // under workerd's nodejs_compat polyfill — compareSync avoids that path.
  const passwordValid = bcrypt.compareSync(dto.password, user.password);
  if (!passwordValid) throw new UnauthorizedException("Credenziali non valide");

  const role = user.role;
  const payload = { sub: user.id, email: user.email, role };

  return c.json({
    accessToken: await signJwt(payload, c.env.JWT_SECRET),
    user: {
      id: user.id,
      email: user.email,
      role,
      permissions: [],
    },
  });
});
