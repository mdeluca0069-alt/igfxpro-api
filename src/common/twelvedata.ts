// Rewritten from igfxpro-apiv2/market-data/feeds/twelvedata.rest.ts to use
// fetch() instead of node:https (portable on Workers), same response shapes.
import { INSTRUMENT_META, type AssetClass } from "./instruments";

const BASE_URL = "https://api.twelvedata.com";

export type LiveQuote = {
  symbol: string;
  close: number;
  open: number;
  high: number;
  low: number;
  changePct: number;
  prevClose: number;
  timestamp: string;
};

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

// TwelveData expects "EUR/USD" for forex/crypto/metals, bare symbols for
// everything else (indices, commodities, equities).
const SLASH_CLASSES: AssetClass[] = ["FOREX", "CRYPTO", "METAL"];

export function toTwelveDataSymbol(symbol: string): string {
  const meta = INSTRUMENT_META[symbol];
  if (!meta || !SLASH_CLASSES.includes(meta.assetClass)) return symbol;
  if (meta.assetClass === "FOREX" && symbol.length === 6) return `${symbol.slice(0, 3)}/${symbol.slice(3)}`;
  if (symbol.endsWith("USD")) return `${symbol.slice(0, -3)}/USD`;
  return symbol;
}

function parseDatetime(dt: string): number {
  const iso = dt.includes("T") ? dt : dt.replace(" ", "T") + (dt.length === 10 ? "T00:00:00Z" : "Z");
  const ms = Date.parse(iso);
  return isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

export type LiveQuotesResult = { quotes: Map<string, LiveQuote>; quotaExceeded: boolean };

// A TwelveData "quota exceeded" reply is {code:429,...} — either at the top
// level (checked before the batch is processed at all) or, if the quota runs
// out mid-batch, embedded per-symbol inside an otherwise-normal-looking
// object. Both shapes are checked so key rotation (twelvedata-rotation.ts)
// can tell "this key is done for the day" apart from "network/parse error".
function isQuotaExceeded(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  if ((parsed as { code?: number }).code === 429) return true;
  return Object.values(parsed as Record<string, unknown>).some(
    (entry) => entry && typeof entry === "object" && (entry as { code?: number }).code === 429
  );
}

export async function fetchLiveQuotesRaw(apiKey: string, symbols: string[]): Promise<LiveQuotesResult> {
  const result = new Map<string, LiveQuote>();
  if (!symbols.length) return { quotes: result, quotaExceeded: false };

  const tdSymbols = symbols.map(toTwelveDataSymbol);
  const params = new URLSearchParams({ apikey: apiKey, symbol: tdSymbols.join(","), format: "JSON" });

  let parsed: unknown;
  try {
    const res = await fetch(`${BASE_URL}/quote?${params.toString()}`);
    parsed = await res.json();
  } catch (err) {
    console.error("[twelvedata] fetchLiveQuotes network error:", (err as Error).message);
    return { quotes: result, quotaExceeded: false };
  }

  if (isQuotaExceeded(parsed)) {
    return { quotes: result, quotaExceeded: true };
  }

  const entries =
    tdSymbols.length === 1
      ? { [tdSymbols[0]]: parsed as Record<string, unknown> }
      : (parsed as Record<string, Record<string, unknown>>);

  for (const [rawSymbol, entry] of Object.entries(entries)) {
    const q = entry as Record<string, string>;
    if (!q?.close) continue;

    const close = parseFloat(q.close ?? "0");
    if (!isFinite(close) || close <= 0) continue;

    const open = parseFloat(q.open ?? String(close));
    const high = parseFloat(q.high ?? String(close));
    const low = parseFloat(q.low ?? String(close));
    const prevClose = parseFloat(q.previous_close ?? String(close));
    const pctChange = parseFloat(q.percent_change ?? "0");
    const igfxSymbol = rawSymbol.toUpperCase().replace("/", "");

    result.set(igfxSymbol, {
      symbol: igfxSymbol,
      close,
      open: isFinite(open) ? open : close,
      high: isFinite(high) ? high : close,
      low: isFinite(low) ? low : close,
      prevClose: isFinite(prevClose) ? prevClose : close,
      changePct: isFinite(pctChange) ? pctChange : 0,
      timestamp: q.datetime ?? new Date().toISOString(),
    });
  }

  return { quotes: result, quotaExceeded: false };
}

export async function fetchLiveQuotes(apiKey: string, symbols: string[]): Promise<Map<string, LiveQuote>> {
  return (await fetchLiveQuotesRaw(apiKey, symbols)).quotes;
}

export async function fetchHistoricalCandles(
  apiKey: string,
  symbol: string,
  interval: string,
  outputSize: number
): Promise<Candle[]> {
  const params = new URLSearchParams({
    apikey: apiKey,
    symbol: toTwelveDataSymbol(symbol),
    interval,
    outputsize: String(outputSize),
    format: "JSON",
  });

  let parsed: { status?: string; values?: Array<Record<string, string>> };
  try {
    const res = await fetch(`${BASE_URL}/time_series?${params.toString()}`);
    parsed = await res.json();
  } catch (err) {
    console.error(`[twelvedata] fetchHistoricalCandles network error for ${symbol}:`, (err as Error).message);
    return [];
  }

  if (parsed.status !== "ok" || !Array.isArray(parsed.values)) return [];

  return parsed.values
    .map((v): Candle | null => {
      const time = parseDatetime(v.datetime);
      const open = parseFloat(v.open);
      const high = parseFloat(v.high);
      const low = parseFloat(v.low);
      const close = parseFloat(v.close);
      const volume = parseFloat(v.volume ?? "0");
      if (!time || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) return null;
      return { time, open, high, low, close, volume: isNaN(volume) ? 0 : volume };
    })
    .filter((c): c is Candle => c !== null)
    .reverse();
}
