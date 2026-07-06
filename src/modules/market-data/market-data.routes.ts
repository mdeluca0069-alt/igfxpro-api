import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";
import { ALL_SYMBOLS, INSTRUMENT_META, SYMBOLS_BY_CLASS, toInstrumentRow } from "../../common/instruments";
import { fetchHistoricalCandles } from "../../common/twelvedata";
import { fetchBinanceCandles } from "../../common/binance";
import { getActiveTwelveDataKey } from "../../common/twelvedata-rotation";
import { buildOrderBook, bookClassFor } from "../../common/virtual-orderbook";

// Mounted at /trading (and /api/v1/trading) in worker.ts
export const tradingDataRoutes = new Hono<HonoEnv>();

tradingDataRoutes.get("/instruments", async (c) => {
  return c.json(ALL_SYMBOLS.map(toInstrumentRow));
});

tradingDataRoutes.get("/instruments/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  if (!INSTRUMENT_META[symbol]) return c.json(null, 404);
  return c.json(toInstrumentRow(symbol));
});

tradingDataRoutes.get("/quotes", async (c) => {
  const prisma = getPrisma(c.env);
  const quotes = await prisma.quote.findMany();
  return c.json(
    quotes.map((q) => ({
      symbol: q.symbol,
      bid: q.bid.toNumber(),
      ask: q.ask.toNumber(),
      mid: q.mid.toNumber(),
      spread: q.spread.toNumber(),
      changePct: q.changePct.toNumber(),
      ts: q.updatedAt.toISOString(),
    }))
  );
});

// CANDLE_LIMIT table lived oddly in apiv2's calendar.ts — kept here instead,
// next to the route that actually uses it.
const TIMEFRAME_TO_TD_INTERVAL: Record<string, string> = {
  "1M": "1min",
  "5M": "5min",
  "15M": "15min",
  "30M": "30min",
  "1H": "1h",
  "4H": "4h",
  "1D": "1day",
  "1W": "1week",
};

const TIMEFRAME_TO_BINANCE_INTERVAL: Record<string, string> = {
  "1M": "1m",
  "5M": "5m",
  "15M": "15m",
  "30M": "30m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
  "1W": "1w",
};

// Mounted at "/" (root) in worker.ts — each of these already has its own
// distinct first path segment (candles / liquidity / dom / indicators), so
// there's no prefix collision with tradingDataRoutes above.
export const topLevelMarketRoutes = new Hono<HonoEnv>();

// Was hardcoded to a single TWELVEDATA_API_KEY (the original key, daily-
// exhausted since before the 5-key rotation system existed) — every chart
// request silently returned an empty candle array (fetchHistoricalCandles
// swallows quota-exceeded/network errors into []), which the frontend
// renders as "Generazione candele in corso…" forever since an empty array
// isn't treated as an error. Now routes CRYPTO through Binance (free,
// unlimited, matches quotes.cron.ts's own routing) and everything else
// through the same rotating TwelveData key pool the quote/signal crons use.
topLevelMarketRoutes.get("/candles/:symbol/:timeframe", jwtAuthMiddleware, async (c) => {
  const symbol = c.req.param("symbol").replace("-", "").toUpperCase();
  const timeframe = c.req.param("timeframe").toUpperCase();
  const limit = Math.min(parseInt(c.req.query("limit") ?? "200"), 5000);

  if (SYMBOLS_BY_CLASS.CRYPTO.includes(symbol)) {
    const interval = TIMEFRAME_TO_BINANCE_INTERVAL[timeframe] ?? "15m";
    const candles = await fetchBinanceCandles(symbol, interval, limit);
    return c.json(candles);
  }

  const prisma = getPrisma(c.env);
  const key = await getActiveTwelveDataKey(prisma, [
    c.env.TWELVEDATA_API_KEY,
    c.env.TWELVEDATA_API_KEY_2,
    c.env.TWELVEDATA_API_KEY_3,
    c.env.TWELVEDATA_API_KEY_4,
    c.env.TWELVEDATA_API_KEY_5,
  ]);
  if (!key) return c.json([]);

  const interval = TIMEFRAME_TO_TD_INTERVAL[timeframe] ?? "15min";
  const candles = await fetchHistoricalCandles(key, symbol, interval, limit);
  return c.json(candles);
});

topLevelMarketRoutes.get("/liquidity/book/:symbol", jwtAuthMiddleware, async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  const meta = INSTRUMENT_META[symbol];
  if (!meta) return c.json({ ok: false, reason: "UNKNOWN_INSTRUMENT" });

  const prisma = getPrisma(c.env);
  const quote = await prisma.quote.findUnique({ where: { symbol } });
  if (!quote) return c.json({ ok: false, reason: "NO_MARKET_DATA" });

  return c.json(
    buildOrderBook({
      symbol,
      bid: quote.bid.toNumber(),
      ask: quote.ask.toNumber(),
      mid: quote.mid.toNumber(),
      spread: quote.spread.toNumber(),
      changePct: quote.changePct.toNumber(),
      bookClass: bookClassFor(meta.assetClass),
    })
  );
});

topLevelMarketRoutes.get("/dom/:symbol", jwtAuthMiddleware, async (c) => {
  const symbol = c.req.param("symbol").toUpperCase().replace("-", "");
  const meta = INSTRUMENT_META[symbol];
  if (!meta) return c.json({ ok: false, reason: "UNKNOWN_INSTRUMENT" });

  const prisma = getPrisma(c.env);
  const quote = await prisma.quote.findUnique({ where: { symbol } });
  if (!quote) return c.json({ ok: false, reason: "NO_MARKET_DATA" });

  const book = buildOrderBook({
    symbol,
    bid: quote.bid.toNumber(),
    ask: quote.ask.toNumber(),
    mid: quote.mid.toNumber(),
    spread: quote.spread.toNumber(),
    changePct: quote.changePct.toNumber(),
    bookClass: bookClassFor(meta.assetClass),
  });

  return c.json({
    symbol: book.symbol,
    provider: book.provider,
    bid: book.bid,
    ask: book.ask,
    spread: book.spread,
    spreadBps: book.spreadBps,
    changePct: quote.changePct.toNumber(),
    bids: book.bids,
    asks: book.asks,
    generatedAt: new Date().toISOString(),
  });
});

// Ported from apiv2's shared/state.ts getIndicatorSnapshot — apiv2 itself
// generates this from a synthetic (sine-wave) price history seeded off the
// live quote, not from real historical candles, even in persistent/DB mode.
// Faithfully reproduced rather than "upgraded" to real candle math.
topLevelMarketRoutes.get("/indicators/:symbol", jwtAuthMiddleware, async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  const timeframe = c.req.query("timeframe") ?? "15M";
  const meta = INSTRUMENT_META[symbol];
  if (!meta) return c.json({ ok: false, reason: "UNKNOWN_INSTRUMENT" });

  const prisma = getPrisma(c.env);
  const quote = await prisma.quote.findUnique({ where: { symbol } });
  if (!quote) return c.json({ ok: false, reason: "NO_MARKET_DATA" });

  const mid = quote.mid.toNumber();
  const changePct = quote.changePct.toNumber();
  const precision = precisionFromPipSize(meta.pipSize);
  const tick = Math.floor(Date.now() / 60_000);

  const history = Array.from({ length: 64 }, (_, i) => {
    const wave = Math.sin((tick + i + symbol.length) / 5) * 0.004;
    const drift = Math.cos((tick + i) / 11) * 0.002;
    return mid * (1 + wave + drift);
  });
  const avg = (items: number[]) => items.reduce((s, v) => s + v, 0) / Math.max(items.length, 1);
  const last = history.at(-1) ?? mid;
  const gains = history.slice(1).map((v, i) => Math.max(0, v - history[i]));
  const losses = history.slice(1).map((v, i) => Math.max(0, history[i] - v));
  const rs = avg(gains.slice(-14)) / Math.max(avg(losses.slice(-14)), 0.000001);
  const rsi = 100 - 100 / (1 + rs);
  const ema = (period: number) => {
    const k = 2 / (period + 1);
    return history.reduce((prev, v) => v * k + prev * (1 - k), history[0] ?? mid);
  };
  const ema12 = ema(12);
  const ema26 = ema(26);
  const macdValue = ema12 - ema26;
  const macdSignal = macdValue * 0.82;
  const ema20 = ema(20);
  const ema50 = ema(50);
  const variance = avg(history.map((v) => (v - avg(history)) ** 2));
  const stdev = Math.sqrt(variance);
  const high = Math.max(...history);
  const low = Math.min(...history);
  const fibLevels: Array<[string, number]> = [
    ["0.236", high - (high - low) * 0.236],
    ["0.382", high - (high - low) * 0.382],
    ["0.500", high - (high - low) * 0.5],
    ["0.618", high - (high - low) * 0.618],
    ["0.786", high - (high - low) * 0.786],
  ];

  return c.json({
    symbol,
    timeframe,
    price: Number(last.toFixed(precision)),
    generatedAt: new Date().toISOString(),
    rsi: Number(rsi.toFixed(2)),
    macd: {
      value: Number(macdValue.toFixed(precision)),
      signal: Number(macdSignal.toFixed(precision)),
      histogram: Number((macdValue - macdSignal).toFixed(precision)),
      bias: macdValue > macdSignal ? "bullish" : macdValue < macdSignal ? "bearish" : "neutral",
    },
    ema: {
      ema20: Number(ema20.toFixed(precision)),
      ema50: Number(ema50.toFixed(precision)),
      trend: ema20 > ema50 * 1.0005 ? "uptrend" : ema20 < ema50 * 0.9995 ? "downtrend" : "range",
    },
    vwap: Number((avg(history.slice(-24)) * 0.998 + last * 0.002).toFixed(precision)),
    bollinger: {
      upper: Number((avg(history) + stdev * 2).toFixed(precision)),
      middle: Number(avg(history).toFixed(precision)),
      lower: Number((avg(history) - stdev * 2).toFixed(precision)),
      bandwidthPct: Number((((stdev * 4) / last) * 100).toFixed(2)),
    },
    fibonacci: fibLevels.map(([level, price]) => ({ level, price: Number(price.toFixed(precision)) })),
    smartMoney: {
      bias: changePct > 0.08 ? "accumulation" : changePct < -0.08 ? "distribution" : "neutral",
      orderBlock: `${Number((last * 0.997).toFixed(precision))} - ${Number((last * 1.001).toFixed(precision))}`,
      liquiditySweep: changePct >= 0 ? "Buy-side liquidity sweep watch" : "Sell-side liquidity sweep watch",
      volumeProfile: `POC ${Number(avg(history.slice(-32)).toFixed(precision))}, value area ${Number(
        (last * 0.994).toFixed(precision)
      )}/${Number((last * 1.006).toFixed(precision))}`,
    },
  });
});

function precisionFromPipSize(pipSize: number): number {
  const s = pipSize.toString();
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

export const calendarRoutes = new Hono<HonoEnv>();

// Populated by calendar.cron.ts (hourly, alongside the TwelveData slow tick)
// from real FRED release-date data + one computed forward date (next NFP).
// ?hours=48 (as the homepage requests) means "48h back and 48h forward" —
// recent-past events are still genuinely useful market context even though
// most of this data isn't forward-looking (see fred.ts for why).
calendarRoutes.get("/economic", async (c) => {
  const prisma = getPrisma(c.env);
  const hours = Math.min(parseInt(c.req.query("hours") ?? "48"), 24 * 30);
  const now = Date.now();
  const from = new Date(now - hours * 3_600_000);
  const to = new Date(now + hours * 3_600_000);

  const events = await prisma.economicEvent.findMany({
    where: { eventTime: { gte: from, lte: to } },
    orderBy: { eventTime: "asc" },
  });

  return c.json(
    events.map((e) => ({
      eventTime: e.eventTime.toISOString(),
      currency: e.currency,
      title: e.title,
      impact: e.impact,
    }))
  );
});
