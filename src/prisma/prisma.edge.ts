import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

export type Env = {
  HYPERDRIVE: { connectionString: string };
  JWT_SECRET: string;
  TWELVEDATA_API_KEY: string;
  TWELVEDATA_API_KEY_2?: string;
  TWELVEDATA_API_KEY_3?: string;
  TWELVEDATA_API_KEY_4?: string;
  TWELVEDATA_API_KEY_5?: string;
  FINNHUB_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  REALTIME_HUB: DurableObjectNamespace;
};

// Workers tears down a request's I/O objects (sockets, etc.) once that
// request's fetch handler returns, so a Pool/PrismaClient built during one
// request cannot be safely reused during a later request even though this
// module's scope survives across requests in a warm isolate. Hyperdrive
// itself maintains the real connection pool to Postgres, so building a
// fresh Pool/PrismaClient per request is the correct, intended pattern.
export function getPrisma(env: Env): PrismaClient {
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}
