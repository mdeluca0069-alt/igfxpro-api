// Ported from igfxpro-apiv2's Finnhub WS integration (market-data/feeds/
// finnhub.feed.ts), rewritten as a REST poll — same reasoning as binance.ts,
// no persistent connection possible outside a Durable Object. Finnhub's free
// tier allows 60 REST calls/min; the /quote endpoint is per-symbol only (no
// batch), so this fires one request per US equity in parallel — well within
// budget at ~35 symbols/tick even on a 1-minute Cron.
const BASE_URL = "https://finnhub.io/api/v1/quote";

export type FinnhubQuote = { symbol: string; price: number; changePct: number };

export async function fetchFinnhubQuotes(apiKey: string, symbols: string[]): Promise<Map<string, FinnhubQuote>> {
  const result = new Map<string, FinnhubQuote>();
  if (!symbols.length) return result;

  const responses = await Promise.allSettled(
    symbols.map(async (symbol) => {
      const res = await fetch(`${BASE_URL}?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
      const q = (await res.json()) as { c?: number; dp?: number };
      return { symbol, q };
    })
  );

  for (const r of responses) {
    if (r.status !== "fulfilled") continue;
    const { symbol, q } = r.value;
    if (!q.c || !isFinite(q.c) || q.c <= 0) continue;
    result.set(symbol, { symbol, price: q.c, changePct: isFinite(q.dp ?? NaN) ? (q.dp as number) : 0 });
  }

  return result;
}
