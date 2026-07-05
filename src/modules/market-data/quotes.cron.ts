import { getPrisma } from "../../prisma/prisma.edge";
import type { Env } from "../../prisma/prisma.edge";
import { ALL_SYMBOLS, SYMBOLS_BY_CLASS, BROKER_SPREAD_DEFAULTS } from "../../common/instruments";
import { fetchLiveQuotes } from "../../common/twelvedata";
import { fetchBinanceQuotes } from "../../common/binance";
import { fetchFinnhubQuotes } from "../../common/finnhub";
import { broadcastAll } from "../../common/realtime";

// Multi-provider quote routing, split by asset class so each provider stays
// within its own free-tier budget instead of one feed (TwelveData) burning
// 800 credits/day on all 130 instruments in a few minutes (confirmed
// exhausted at 162,986/800 credits under the previous single-provider,
// 1-minute-cron design):
//   CRYPTO     → Binance public REST (no key, no meaningful rate limit)
//   EQUITY_US  → Finnhub REST /quote (free tier: 60 calls/min, one call per
//                symbol since there's no batch endpoint — ~35 symbols/tick)
//   everything else (FOREX/METAL/COMMODITY/INDEX/EQUITY_EU, ~80 symbols)
//                → TwelveData REST, on its own slower Cron Trigger to stay
//                  under the 800-credit/day cap (see wrangler.toml).
// Binance/Finnhub run on the fast (1-min) trigger — crypto and US equities
// are effectively live. TwelveData-only symbols only refresh a few times a
// day; this is a real, visible staleness trade-off of the free-tier ceiling,
// not a bug.

type QuoteRow = { symbol: string; bid: number; ask: number; mid: number; spread: number; changePct: number };

async function upsertAndBroadcast(env: Env, rows: QuoteRow[], label: string): Promise<void> {
  if (rows.length === 0) {
    console.error(`[quotes-cron] ${label} returned zero quotes`);
    return;
  }

  const prisma = getPrisma(env);
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
  console.log(`[quotes-cron] ${label} updated ${rows.length} quotes`);
}

// Fast tick (every minute): Binance crypto + Finnhub US equities.
export async function refreshFastQuotes(env: Env): Promise<void> {
  const [binanceQuotes, finnhubQuotes] = await Promise.all([
    fetchBinanceQuotes(SYMBOLS_BY_CLASS.CRYPTO),
    fetchFinnhubQuotes(env.FINNHUB_API_KEY, SYMBOLS_BY_CLASS.EQUITY_US),
  ]);

  const rows: QuoteRow[] = [];

  for (const q of binanceQuotes.values()) {
    rows.push({ symbol: q.symbol, bid: q.bid, ask: q.ask, mid: q.mid, spread: q.ask - q.bid, changePct: q.changePct });
  }

  for (const q of finnhubQuotes.values()) {
    const spread = BROKER_SPREAD_DEFAULTS[q.symbol] ?? q.price * 0.0005;
    rows.push({ symbol: q.symbol, bid: q.price - spread / 2, ask: q.price + spread / 2, mid: q.price, spread, changePct: q.changePct });
  }

  await upsertAndBroadcast(env, rows, "binance+finnhub");
}

// Slow tick (every few hours, see wrangler.toml): TwelveData for every
// instrument not covered by the fast tick's providers.
export async function refreshSlowQuotes(env: Env): Promise<void> {
  const slowSymbols = ALL_SYMBOLS.filter((s) => !SYMBOLS_BY_CLASS.CRYPTO.includes(s) && !SYMBOLS_BY_CLASS.EQUITY_US.includes(s));
  const quotes = await fetchLiveQuotes(env.TWELVEDATA_API_KEY, slowSymbols);

  const rows: QuoteRow[] = [...quotes.values()].map((q) => {
    const spread = BROKER_SPREAD_DEFAULTS[q.symbol] ?? q.close * 0.0002;
    return { symbol: q.symbol, bid: q.close - spread / 2, ask: q.close + spread / 2, mid: q.close, spread, changePct: q.changePct };
  });

  await upsertAndBroadcast(env, rows, "twelvedata");
}
