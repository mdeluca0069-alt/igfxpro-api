// Ported as-is from igfxpro-apiv2/trading-service/pnl.calculator.ts — pure
// arithmetic, no DB/framework dependency.
export function realizedPnl(side: "BUY" | "SELL", quantity: number, entryPrice: number, exitPrice: number): number {
  const direction = side === "BUY" ? 1 : -1;
  return (exitPrice - entryPrice) * quantity * direction;
}

export function pnlPercent(side: "BUY" | "SELL", entryPrice: number, exitPrice: number): number {
  if (entryPrice === 0) return 0;
  const direction = side === "BUY" ? 1 : -1;
  return ((exitPrice - entryPrice) / entryPrice) * 100 * direction;
}

export function unrealizedPnl(side: "BUY" | "SELL", quantity: number, entryPrice: number, bid: number, ask: number) {
  const markPrice = side === "BUY" ? bid : ask;
  const direction = side === "BUY" ? 1 : -1;
  const rawPnl = (markPrice - entryPrice) * quantity * direction;
  return { rawPnl, markPrice, pnlPercent: pnlPercent(side, entryPrice, markPrice) };
}

// ESMA negative balance protection — a client's loss can never exceed the
// margin they deposited for that position.
export function applyNBP(rawPnl: number, marginUsed: number): number {
  return Math.max(rawPnl, -Math.abs(marginUsed));
}
