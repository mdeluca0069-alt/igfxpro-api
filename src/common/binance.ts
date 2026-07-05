// Ported from igfxpro-apiv2/market-data/feeds/binance.feed.ts's symbol
// mapping, rewritten as a REST poll (Binance's public WS trade stream needs
// a persistent connection, which Workers can't hold outside a Durable
// Object) instead of a live WS tick. Binance's public REST ticker needs no
// API key and has no meaningful rate limit at this scale (1200 weight/min;
// this call costs ~4), so crypto can refresh every Cron tick independently
// of TwelveData's 800-credit/day budget.
const BASE_URL = "https://api.binance.com/api/v3/ticker/bookTicker";

export type BinanceQuote = { symbol: string; bid: number; ask: number; mid: number; changePct: number };

const TO_BINANCE: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  XRPUSD: "XRPUSDT",
  LTCUSD: "LTCUSDT",
  SOLUSD: "SOLUSDT",
  BNBUSD: "BNBUSDT",
  ADAUSD: "ADAUSDT",
  DOTUSD: "DOTUSDT",
  DOGEUSD: "DOGEUSDT",
  AVAXUSD: "AVAXUSDT",
  LINKUSD: "LINKUSDT",
  UNIUSD: "UNIUSDT",
  ATOMUSD: "ATOMUSDT",
  MATICUSD: "MATICUSDT",
  NEARUSD: "NEARUSDT",
};

const FROM_BINANCE: Record<string, string> = Object.fromEntries(Object.entries(TO_BINANCE).map(([ig, bn]) => [bn, ig]));

export async function fetchBinanceQuotes(symbols: string[]): Promise<Map<string, BinanceQuote>> {
  const result = new Map<string, BinanceQuote>();
  const bnSymbols = symbols.map((s) => TO_BINANCE[s]).filter((s): s is string => !!s);
  if (bnSymbols.length === 0) return result;

  const params = new URLSearchParams({ symbols: JSON.stringify(bnSymbols) });

  let bookTicker: unknown;
  try {
    const res = await fetch(`${BASE_URL}?${params.toString()}`);
    bookTicker = await res.json();
  } catch (err) {
    console.error("[binance] bookTicker fetch failed:", (err as Error).message);
    return result;
  }
  if (!Array.isArray(bookTicker)) return result;

  // bookTicker gives real bid/ask but no 24h change — fetch that separately,
  // best-effort (a missing changePct just reads as 0, not a hard failure).
  let changeBySymbol = new Map<string, number>();
  try {
    const changeRes = await fetch(`https://api.binance.com/api/v3/ticker/24hr?${params.toString()}`);
    const changeJson = (await changeRes.json()) as Array<{ symbol: string; priceChangePercent: string }>;
    if (Array.isArray(changeJson)) {
      changeBySymbol = new Map(changeJson.map((c) => [c.symbol, parseFloat(c.priceChangePercent)]));
    }
  } catch {
    // non-fatal — changePct defaults to 0 below
  }

  for (const entry of bookTicker as Array<{ symbol: string; bidPrice: string; askPrice: string }>) {
    const igSymbol = FROM_BINANCE[entry.symbol];
    if (!igSymbol) continue;
    const bid = parseFloat(entry.bidPrice);
    const ask = parseFloat(entry.askPrice);
    if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) continue;

    const changePct = changeBySymbol.get(entry.symbol);

    result.set(igSymbol, {
      symbol: igSymbol,
      bid,
      ask,
      mid: (bid + ask) / 2,
      changePct: changePct !== undefined && isFinite(changePct) ? changePct : 0,
    });
  }

  return result;
}
