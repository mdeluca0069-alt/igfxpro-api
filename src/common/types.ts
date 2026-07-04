import type { Env } from "../prisma/prisma.edge";
import type { JwtPayload } from "./jwt";

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    user?: JwtPayload;
  };
};
