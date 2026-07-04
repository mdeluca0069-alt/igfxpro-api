import { getPrisma } from "../../prisma/prisma.edge";
import type { Env } from "../../prisma/prisma.edge";
import { ALL_SYMBOLS, BROKER_SPREAD_DEFAULTS } from "../../common/instruments";
import { fetchLiveQuotes } from "../../common/twelvedata";

// Cloudflare Cron Triggers run at most once per minute — REST-polling
// stopgap until the Durable Object real-time feed (deferred phase) exists.
export async function refreshQuotes(env: Env): Promise<void> {
  const quotes = await fetchLiveQuotes(env.TWELVEDATA_API_KEY, ALL_SYMBOLS);
  if (quotes.size === 0) {
    console.error("[quotes-cron] TwelveData returned zero quotes");
    return;
  }

  const prisma = getPrisma(env);
  await prisma.$transaction(
    [...quotes.values()].map((q) => {
      const spread = BROKER_SPREAD_DEFAULTS[q.symbol] ?? q.close * 0.0002;
      const bid = q.close - spread / 2;
      const ask = q.close + spread / 2;
      return prisma.quote.upsert({
        where: { symbol: q.symbol },
        create: { symbol: q.symbol, bid, ask, mid: q.close, spread, changePct: q.changePct },
        update: { bid, ask, mid: q.close, spread, changePct: q.changePct },
      });
    })
  );

  console.log(`[quotes-cron] updated ${quotes.size}/${ALL_SYMBOLS.length} quotes`);
}
