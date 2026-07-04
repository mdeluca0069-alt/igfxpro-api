// Ported as-is from igfxpro-apiv2/liquidity-engine/virtual.orderbook.ts —
// pure computation (synthetic L2 depth around a mid price), no DB/framework
// dependency.
export type DepthLevel = { price: number; volume: number; cumulativeVolume: number };

export type OrderBook = {
  symbol: string;
  provider: "IGFX_INTERNAL_LP";
  bid: number;
  ask: number;
  spread: number;
  spreadBps: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  snapshotAt: string;
};

type BookInput = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  changePct: number;
  bookClass: "FX_MAJOR" | "FX_MINOR" | "INDEX" | "COMMODITY" | "EQUITY" | "CRYPTO";
};

const VOLUME_SCALE: Record<string, number> = {
  FX_MAJOR: 750_000,
  FX_MINOR: 400_000,
  INDEX: 50,
  COMMODITY: 300,
  EQUITY: 500,
  CRYPTO: 2.5,
};

const TICK_STEP: Record<string, (mid: number) => number> = {
  FX_MAJOR: () => 0.00005,
  FX_MINOR: () => 0.0001,
  INDEX: (mid) => mid * 0.00005,
  COMMODITY: (mid) => mid * 0.0002,
  EQUITY: (mid) => mid * 0.00025,
  CRYPTO: (mid) => mid * 0.0001,
};

function roundTo(value: number, precision: number): number {
  return Number(value.toFixed(precision));
}

function precisionFor(symbol: string, bookClass: string): number {
  if (symbol.includes("JPY")) return 3;
  if (bookClass === "FX_MAJOR" || bookClass === "FX_MINOR") return 5;
  return 2;
}

export function buildOrderBook(input: BookInput, levels = 10): OrderBook {
  const prec = precisionFor(input.symbol, input.bookClass);
  const volScale = VOLUME_SCALE[input.bookClass] ?? VOLUME_SCALE.FX_MAJOR;
  const tickStep = (TICK_STEP[input.bookClass] ?? TICK_STEP.FX_MAJOR)(input.mid);
  const volBoost = 1 + Math.min(Math.abs(input.changePct) * 0.5, 1.5);

  const bids: DepthLevel[] = [];
  const asks: DepthLevel[] = [];
  let cumBid = 0;
  let cumAsk = 0;

  for (let i = 0; i < levels; i++) {
    const bidVol = roundTo((levels - i) * volBoost * volScale, 0);
    const askVol = roundTo((levels - i) * volBoost * volScale * 0.97, 0);
    cumBid += bidVol;
    cumAsk += askVol;
    bids.push({ price: roundTo(input.bid - tickStep * i, prec), volume: bidVol, cumulativeVolume: roundTo(cumBid, 0) });
    asks.push({ price: roundTo(input.ask + tickStep * i, prec), volume: askVol, cumulativeVolume: roundTo(cumAsk, 0) });
  }

  const spread = roundTo(input.ask - input.bid, prec);
  const spreadBps = roundTo((spread / input.mid) * 10_000, 2);

  return {
    symbol: input.symbol,
    provider: "IGFX_INTERNAL_LP",
    bid: input.bid,
    ask: input.ask,
    spread,
    spreadBps,
    bids,
    asks,
    snapshotAt: new Date().toISOString(),
  };
}

export function bookClassFor(assetClass: string): BookInput["bookClass"] {
  switch (assetClass) {
    case "FOREX":
      return "FX_MAJOR";
    case "CRYPTO":
      return "CRYPTO";
    case "INDEX":
      return "INDEX";
    case "COMMODITY":
    case "METAL":
      return "COMMODITY";
    default:
      return "EQUITY";
  }
}
