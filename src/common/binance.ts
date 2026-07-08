// Despite the filename (kept to avoid touching every import across the
// codebase), this module no longer talks to Binance at all. Both
// api.binance.com (geo-blocks Cloudflare Workers' egress) and its supposedly
// unrestricted mirror data-api.binance.vision (intermittent 403s on quotes,
// then escalated to a *persistent* 403 on every endpoint after sustained
// per-minute polling — verified via wrangler tail across many separate
// production deploys) turned out to be actively hostile to being called from
// Cloudflare Workers. Coinbase Exchange's public, read-only, no-key-required
// API has been reliable in the same conditions, so crypto quotes AND candles
// both come from there now.
const COINBASE_HOST = "https://api.exchange.coinbase.com";

export type BinanceQuote = { symbol: string; bid: number; ask: number; mid: number; changePct: number };
export type BinanceCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };

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

// Coinbase only offers a fixed set of candle granularities (seconds);
// anything not listed here falls back to the nearest supported bucket.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonRetrying(url: string, attempts = 2): Promise<unknown> {
  let lastError = "unknown";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(200 * i);
    const res = await fetch(url);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      lastError = `status=${res.status} body=${text.slice(0, 150)}`;
    }
  }
  console.error(`[coinbase] non-JSON response after ${attempts} attempts for ${url}: ${lastError}`);
  return null;
}

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
        // a different column order than Binance's klines had.
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

// Coinbase has no batch ticker endpoint (unlike Binance's bookTicker), so
// this fires one ticker + one stats call per symbol in parallel — the same
// per-symbol-fan-out pattern fetchFinnhubQuotes already uses for ~35 US
// equities on this same Cron tick, which has proven fine for the CPU budget.
export async function fetchBinanceQuotes(symbols: string[]): Promise<Map<string, BinanceQuote>> {
  const result = new Map<string, BinanceQuote>();
  const pairs = symbols.map((s) => [s, TO_COINBASE_PRODUCT[s]] as const).filter((p): p is [string, string] => !!p[1]);
  if (pairs.length === 0) return result;

  await Promise.all(
    pairs.map(async ([igSymbol, product]) => {
      try {
        const [ticker, stats] = await Promise.all([
          fetchJsonRetrying(`${COINBASE_HOST}/products/${product}/ticker`),
          fetchJsonRetrying(`${COINBASE_HOST}/products/${product}/stats`),
        ]);
        const t = ticker as { bid?: string; ask?: string } | null;
        if (!t?.bid || !t?.ask) return;

        const bid = parseFloat(t.bid);
        const ask = parseFloat(t.ask);
        if (!isFinite(bid) || !isFinite(ask) || bid <= 0 || ask <= 0) return;

        const s = stats as { open?: string; last?: string } | null;
        const open = s?.open ? parseFloat(s.open) : NaN;
        const last = s?.last ? parseFloat(s.last) : (bid + ask) / 2;
        const changePct = isFinite(open) && open > 0 ? ((last - open) / open) * 100 : 0;

        result.set(igSymbol, { symbol: igSymbol, bid, ask, mid: (bid + ask) / 2, changePct });
      } catch (err) {
        console.error(`[coinbase] fetchBinanceQuotes ${igSymbol} failed:`, (err as Error).message);
      }
    })
  );

  return result;
}
