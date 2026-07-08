// Ported from igfxpro-apiv2/market-data/feeds/binance.feed.ts's symbol
// mapping, rewritten as a REST poll (Binance's public WS trade stream needs
// a persistent connection, which Workers can't hold outside a Durable
// Object) instead of a live WS tick. Binance's public REST ticker needs no
// API key and has no meaningful rate limit at this scale (1200 weight/min;
// this call costs ~4), so crypto can refresh every Cron tick independently
// of TwelveData's 800-credit/day budget.
// api.binance.com is Binance's trading API domain, which geo-blocks a chunk
// of cloud/datacenter IP ranges (including, empirically, Cloudflare Workers'
// egress here — confirmed via direct comparison: identical requests succeed
// from an ordinary sandbox but return non-array error bodies from within the
// deployed Worker). data-api.binance.vision is Binance's dedicated read-only
// market-data mirror, purpose-built for exactly this kind of public,
// unauthenticated polling without the trading-API's regional restrictions.
const MARKET_DATA_HOST = "https://data-api.binance.vision";
const BASE_URL = `${MARKET_DATA_HOST}/api/v3/ticker/bookTicker`;

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

export type BinanceCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const MARKET_DATA_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; IGFXPRO-MarketData/1.0)", Accept: "application/json" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// data-api.binance.vision intermittently answers with an HTML block/challenge
// page (observed status 403) instead of JSON — looks like bot-detection
// sampling requests from Cloudflare's own network rather than a hard geo-ban
// (the very same endpoint succeeds on a different attempt seconds later).
// Retrying a couple of times clears it in practice; this is shared by every
// Binance call in this file instead of duplicating the retry loop per call.
async function fetchJsonRetrying(url: string, attempts = 3): Promise<unknown> {
  let lastError: string = "unknown";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(250 * i);
    const res = await fetch(url, { headers: MARKET_DATA_HEADERS });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      lastError = `status=${res.status} body=${text.slice(0, 150)}`;
    }
  }
  console.error(`[binance] non-JSON response after ${attempts} attempts for ${url}: ${lastError}`);
  return null;
}

// Historical candles come from Coinbase Exchange's public API, NOT Binance —
// unlike bookTicker/24hr (which mostly succeed), data-api.binance.vision's
// klines endpoint consistently returned an HTML 403 block page from within
// this Worker even with retries + a browser User-Agent (verified via
// wrangler tail: 3/3 attempts blocked, every time, on multiple separate
// deploys) — a persistent WAF rule on that specific endpoint, not the
// transient/intermittent block bookTicker sees. Coinbase's read-only
// exchange API needs no key and has been reliable from Workers in testing.
const COINBASE_HOST = "https://api.exchange.coinbase.com";

const TO_COINBASE_PRODUCT: Record<string, string> = {
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
  XRPUSD: "XRP-USD",
  LTCUSD: "LTC-USD",
  SOLUSD: "SOL-USD",
  ADAUSD: "ADA-USD",
  DOTUSD: "DOT-USD",
  DOGEUSD: "DOGE-USD",
  AVAXUSD: "AVAX-USD",
  LINKUSD: "LINK-USD",
  UNIUSD: "UNI-USD",
  ATOMUSD: "ATOM-USD",
  MATICUSD: "MATIC-USD",
  NEARUSD: "NEAR-USD",
  // BNBUSD intentionally absent — Binance Coin isn't listed on Coinbase.
};

// Coinbase only offers a fixed set of granularities (seconds); anything not
// listed here falls back to the nearest supported bucket.
const INTERVAL_TO_GRANULARITY_SEC: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 900,
  "1h": 3600,
  "4h": 3600,
  "6h": 21600,
  "1d": 86400,
  "1w": 86400,
};

// Used by the signal generator for real technical-analysis history, and by
// the candles chart endpoint for crypto symbols.
export async function fetchBinanceCandles(igSymbol: string, interval: string, limit: number): Promise<BinanceCandle[]> {
  const product = TO_COINBASE_PRODUCT[igSymbol];
  if (!product) return [];

  const granularity = INTERVAL_TO_GRANULARITY_SEC[interval] ?? 3600;

  try {
    const raw = await fetchJsonRetrying(`${COINBASE_HOST}/products/${product}/candles?granularity=${granularity}`);
    if (!Array.isArray(raw)) return [];

    return raw
      .map((k): BinanceCandle | null => {
        // Coinbase candle shape: [time, low, high, open, close, volume] —
        // a different column order than Binance's klines.
        const arr = k as unknown[];
        const time = Number(arr[0]);
        const low = Number(arr[1]);
        const high = Number(arr[2]);
        const open = Number(arr[3]);
        const close = Number(arr[4]);
        const volume = Number(arr[5]);
        if (!isFinite(open) || !isFinite(close)) return null;
        return { time, open, high, low, close, volume: isFinite(volume) ? volume : 0 };
      })
      .filter((c): c is BinanceCandle => c !== null)
      // Coinbase returns newest-first; every consumer here expects ascending.
      .sort((a, b) => a.time - b.time)
      .slice(-Math.min(limit, 300));
  } catch (err) {
    console.error(`[coinbase] fetchBinanceCandles ${igSymbol} failed:`, (err as Error).message);
    return [];
  }
}

export async function fetchBinanceQuotes(symbols: string[]): Promise<Map<string, BinanceQuote>> {
  const result = new Map<string, BinanceQuote>();
  const bnSymbols = symbols.map((s) => TO_BINANCE[s]).filter((s): s is string => !!s);
  if (bnSymbols.length === 0) return result;

  const params = new URLSearchParams({ symbols: JSON.stringify(bnSymbols) });

  let bookTicker: unknown;
  try {
    bookTicker = await fetchJsonRetrying(`${BASE_URL}?${params.toString()}`);
  } catch (err) {
    console.error("[binance] bookTicker fetch failed:", (err as Error).message);
    return result;
  }
  if (!Array.isArray(bookTicker)) return result;

  // bookTicker gives real bid/ask but no 24h change — fetch that separately,
  // best-effort (a missing changePct just reads as 0, not a hard failure).
  let changeBySymbol = new Map<string, number>();
  try {
    const changeJson = await fetchJsonRetrying(`${MARKET_DATA_HOST}/api/v3/ticker/24hr?${params.toString()}`);
    if (Array.isArray(changeJson)) {
      changeBySymbol = new Map((changeJson as Array<{ symbol: string; priceChangePercent: string }>).map((c) => [c.symbol, parseFloat(c.priceChangePercent)]));
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
