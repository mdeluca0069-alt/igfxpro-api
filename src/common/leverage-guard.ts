import { bookClassFor } from "./virtual-orderbook";

// Ported from igfxpro-apiv2/shared/contracts.ts ESMA_LEVERAGE_CAPS +
// risk-service/leverage.guard.ts — silently caps leverage, never rejects.
const ESMA_LEVERAGE_CAPS: Record<string, number> = {
  FX_MAJOR: 30,
  FX_MINOR: 20,
  INDEX: 20,
  COMMODITY: 10,
  EQUITY: 5,
  CRYPTO: 2,
};

export function effectiveLeverage(assetClass: string, requestedLeverage: number): number {
  const bookClass = bookClassFor(assetClass);
  const cap = ESMA_LEVERAGE_CAPS[bookClass] ?? 2;
  return Math.min(requestedLeverage, cap);
}
