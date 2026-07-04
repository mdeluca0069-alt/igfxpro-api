// Ported as-is from igfxpro-apiv2/risk-service/var.engine.ts — pure Prisma
// queries + arithmetic (historical/parametric VaR, expected shortfall,
// stress scenarios, margin forecast), no framework dependency.
import type { PrismaClient } from "@prisma/client";

const Z_SCORES: Record<number, number> = { 90: 1.282, 95: 1.645, 99: 2.326 };

export type VarEstimate = { confidence: number; horizonDays: number; varUsd: number; varPct: number; method: "historical" | "parametric" };
export type StressScenario = {
  name: string;
  description: string;
  shockPct: number;
  estimatedLoss: number;
  marginImpact: number;
  severity: "mild" | "moderate" | "severe" | "extreme";
};
export type MarginForecastPoint = { daysAhead: number; marginLevel: number; riskZone: "safe" | "caution" | "danger" | "stop_out" };

const STRESS_SCENARIOS: Omit<StressScenario, "estimatedLoss" | "marginImpact">[] = [
  { name: "FX Flash Crash", description: "Sudden 3% FX move (similar to Jan 2015 CHF event)", shockPct: -3.0, severity: "moderate" },
  { name: "Equity Black Monday", description: "10% equity index drop (similar to Oct 1987 or Mar 2020)", shockPct: -10.0, severity: "severe" },
  { name: "Crypto Crash", description: "30% crypto drop (similar to May 2022 or Nov 2022)", shockPct: -30.0, severity: "extreme" },
  { name: "Gold Spike", description: "5% gold appreciation (flight-to-safety scenario)", shockPct: 5.0, severity: "mild" },
  { name: "Oil Supply Shock", description: "15% oil price surge (geopolitical disruption)", shockPct: 15.0, severity: "moderate" },
  { name: "Sovereign Bond Crisis", description: "2% yield spike -> 8% index drop (2011 Eurozone scenario)", shockPct: -8.0, severity: "severe" },
];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil(sorted.length * (1 - p / 100)) - 1);
  return Math.abs(sorted[idx]!);
}

function expectedShortfall(sorted: number[], p: number): number {
  const cutIdx = Math.ceil(sorted.length * (1 - p / 100));
  const tail = sorted.slice(0, cutIdx);
  if (tail.length === 0) return 0;
  return Math.abs(tail.reduce((s, v) => s + v, 0) / tail.length);
}

export async function computeVaR(prisma: PrismaClient, userId: string, horizonDays = 1) {
  const windowDays = Math.max(252, horizonDays * 252);
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [wallet, openPositions, tradeHistory] = await Promise.all([
    prisma.walletAccount.findUnique({ where: { userId }, select: { balance: true, locked: true } }),
    prisma.position.findMany({
      where: { userId, status: "OPEN" },
      select: { pnl: true, marginUsed: true, quantity: true, entryPrice: true, markPrice: true, symbol: true },
    }),
    prisma.tradeAudit.findMany({
      where: { userId, tradeStatus: "CLOSED", closedAt: { gte: since, not: null } },
      select: { pnlRealized: true, closedAt: true },
      orderBy: { closedAt: "asc" },
    }),
  ]);

  const balance = wallet?.balance.toNumber() ?? 0;
  const locked = wallet?.locked.toNumber() ?? 0;
  const unrealized = openPositions.reduce((s, p) => s + p.pnl.toNumber(), 0);
  const equity = balance + unrealized;
  const marginUsed = locked;

  const dayMap = new Map<string, number>();
  for (const t of tradeHistory) {
    const key = t.closedAt!.toISOString().slice(0, 10);
    dayMap.set(key, (dayMap.get(key) ?? 0) + (t.pnlRealized?.toNumber() ?? 0));
  }

  const dailyPnls = Array.from(dayMap.values());
  const sortedAsc = [...dailyPnls].sort((a, b) => a - b);
  const dataPoints = dailyPnls.length;

  const hVar95 = percentile(sortedAsc, 95);
  const hVar99 = percentile(sortedAsc, 99);
  const hES95 = expectedShortfall(sortedAsc, 95);
  const scale = Math.sqrt(horizonDays);

  const mean = dailyPnls.reduce((s, v) => s + v, 0) / (dailyPnls.length || 1);
  const variance = dailyPnls.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (dailyPnls.length || 1);
  const sigma = Math.sqrt(variance);

  const pVar95 = Z_SCORES[95]! * sigma * scale || equity * 0.016 * scale;
  const pVar99 = Z_SCORES[99]! * sigma * scale || equity * 0.023 * scale;

  const grossNotional = openPositions.reduce(
    (s, p) => s + p.quantity.toNumber() * (p.markPrice?.toNumber() ?? p.entryPrice.toNumber()),
    0
  );

  const stressScenarios: StressScenario[] = STRESS_SCENARIOS.map((sc) => {
    const lossEstimate = Math.abs(grossNotional * (sc.shockPct / 100));
    return {
      ...sc,
      estimatedLoss: Math.round(lossEstimate * 100) / 100,
      marginImpact: Math.round((equity > 0 ? (lossEstimate / equity) * 100 : 0) * 10) / 10,
    };
  });

  const marginForecast: MarginForecastPoint[] = [];
  for (let d = 0; d <= 5; d++) {
    const projectedLoss = hVar95 * d;
    const projEquity = Math.max(0, equity - projectedLoss);
    const marginLevel = marginUsed > 0 ? (projEquity / marginUsed) * 100 : 9999;
    marginForecast.push({
      daysAhead: d,
      marginLevel: Math.round(marginLevel * 10) / 10,
      riskZone: marginLevel > 200 ? "safe" : marginLevel > 100 ? "caution" : marginLevel > 50 ? "danger" : "stop_out",
    });
  }

  const mkVar = (method: "historical" | "parametric", v95: number, v99: number): [VarEstimate, VarEstimate] => [
    {
      confidence: 95,
      horizonDays,
      varUsd: Math.round(v95 * scale * 100) / 100,
      varPct: equity > 0 ? Math.round(((v95 * scale) / equity) * 10000) / 100 : 0,
      method,
    },
    {
      confidence: 99,
      horizonDays,
      varUsd: Math.round(v99 * scale * 100) / 100,
      varPct: equity > 0 ? Math.round(((v99 * scale) / equity) * 10000) / 100 : 0,
      method,
    },
  ];

  const [hv95, hv99] = mkVar("historical", hVar95, hVar99);
  const [pv95, pv99] = mkVar("parametric", pVar95, pVar99);

  return {
    equity: Math.round(equity * 100) / 100,
    historicalVar95: hv95,
    historicalVar99: hv99,
    parametricVar95: pv95,
    parametricVar99: pv99,
    expectedShortfall95: Math.round(hES95 * scale * 100) / 100,
    stressScenarios,
    marginForecast,
    dataPoints,
    generatedAt: new Date().toISOString(),
  };
}
