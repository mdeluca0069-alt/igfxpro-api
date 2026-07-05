import { getPrisma } from "../../prisma/prisma.edge";
import type { Env } from "../../prisma/prisma.edge";
import { ALL_SYMBOLS, BROKER_SPREAD_DEFAULTS } from "../../common/instruments";
import { fetchLiveQuotes } from "../../common/twelvedata";
import { broadcastAll } from "../../common/realtime";

// Cloudflare Cron Triggers run at most once per minute. This remains the
// price *source* even after Fase 9 (TwelveData is still REST, not a
// streaming feed) — what changed is delivery: quotes are now pushed to
// every open WebSocket via the RealtimeHub Durable Object instead of only
// waiting to be polled by GET /trading/quotes.
export async function refreshQuotes(env: Env): Promise<void> {
  const quotes = await fetchLiveQuotes(env.TWELVEDATA_API_KEY, ALL_SYMBOLS);
  if (quotes.size === 0) {
    console.error("[quotes-cron] TwelveData returned zero quotes");
    return;
  }

  const prisma = getPrisma(env);
  const rows = [...quotes.values()].map((q) => {
    const spread = BROKER_SPREAD_DEFAULTS[q.symbol] ?? q.close * 0.0002;
    const bid = q.close - spread / 2;
    const ask = q.close + spread / 2;
    return { symbol: q.symbol, bid, ask, mid: q.close, spread, changePct: q.changePct };
  });

  await prisma.$transaction(
    rows.map((r) =>
      prisma.quote.upsert({
        where: { symbol: r.symbol },
        create: r,
        update: { bid: r.bid, ask: r.ask, mid: r.mid, spread: r.spread, changePct: r.changePct },
      })
    )
  );

  await broadcastAll(env, "market.quotes", rows);

  console.log(`[quotes-cron] updated ${quotes.size}/${ALL_SYMBOLS.length} quotes`);
}
