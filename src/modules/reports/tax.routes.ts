import { Hono } from "hono";
import { getPrisma } from "../../prisma/prisma.edge";
import { jwtAuthMiddleware } from "../../common/middleware/jwt-auth.middleware";
import type { HonoEnv } from "../../common/types";

export const taxRoutes = new Hono<HonoEnv>();
taxRoutes.use("*", jwtAuthMiddleware);

// Ported from apiv2's tax-reporting/tax.calculator.ts — country-specific
// realized-P&L tax reports, CSV/JSON export. FX conversion / PDF rendering
// (handled client-side in apiv2) are out of scope here.

type TaxCountry = "IT" | "DE" | "UK" | "US" | "FR" | "ES" | "NL" | "CH" | "OTHER";

type TaxableTrade = {
  tradeId: string;
  symbol: string;
  assetClass: string;
  direction: "BUY" | "SELL";
  quantity: number;
  openDate: string;
  closeDate: string;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  commission: number;
  swap: number;
  netPnl: number;
  holdingDays: number;
  isLongTerm: boolean;
  washSale: boolean;
};

type TaxSummary = {
  userId: string;
  year: number;
  country: TaxCountry;
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
  totalGross: number;
  totalCommission: number;
  totalSwap: number;
  netRealizedPnl: number;
  shortTermGains: number;
  longTermGains: number;
  taxableAmount: number;
  estimatedTax: number;
  currency: string;
  generatedAt: string;
  trades: TaxableTrade[];
};

const TAX_RATES: Record<TaxCountry, { rate: number; threshold: number }> = {
  IT: { rate: 0.26, threshold: 0 },
  DE: { rate: 0.25, threshold: 0 },
  UK: { rate: 0.2, threshold: 12_300 },
  US: { rate: 0.2, threshold: 44_625 },
  FR: { rate: 0.3, threshold: 0 },
  ES: { rate: 0.23, threshold: 6_000 },
  NL: { rate: 0.31, threshold: 57_000 },
  CH: { rate: 0, threshold: 0 },
  OTHER: { rate: 0.2, threshold: 0 },
};

function isTaxCountry(v: string): v is TaxCountry {
  return v in TAX_RATES;
}

function fiscalYearBounds(year: number, country: TaxCountry): { from: Date; to: Date } {
  if (country === "UK") return { from: new Date(`${year}-04-06`), to: new Date(`${year + 1}-04-05`) };
  return { from: new Date(`${year}-01-01`), to: new Date(`${year}-12-31T23:59:59.999Z`) };
}

function applyWashSaleRules(trades: TaxableTrade[]): void {
  const losingTrades = trades.filter((t) => t.netPnl < 0);
  for (const loss of losingTrades) {
    const lossDate = new Date(loss.closeDate).getTime();
    const washWindow = 30 * 86_400_000;
    const hasSimilar = trades.some(
      (t) => t !== loss && t.symbol === loss.symbol && Math.abs(new Date(t.openDate).getTime() - lossDate) <= washWindow
    );
    if (hasSimilar) loss.washSale = true;
  }
}

function buildSummary(userId: string, year: number, country: TaxCountry, trades: TaxableTrade[]): TaxSummary {
  const totalGross = trades.reduce((s, t) => s + t.realizedPnl, 0);
  const totalCommission = trades.reduce((s, t) => s + t.commission, 0);
  const totalSwap = trades.reduce((s, t) => s + t.swap, 0);
  const netRealizedPnl = trades.reduce((s, t) => s + t.netPnl, 0);
  const shortTermGains = trades.filter((t) => !t.isLongTerm).reduce((s, t) => s + t.netPnl, 0);
  const longTermGains = trades.filter((t) => t.isLongTerm).reduce((s, t) => s + t.netPnl, 0);

  const taxConfig = TAX_RATES[country];
  const taxableAmount = Math.max(0, netRealizedPnl - taxConfig.threshold);
  const estimatedTax = taxableAmount * taxConfig.rate;

  return {
    userId,
    year,
    country,
    totalTrades: trades.length,
    profitableTrades: trades.filter((t) => t.netPnl > 0).length,
    losingTrades: trades.filter((t) => t.netPnl < 0).length,
    totalGross,
    totalCommission,
    totalSwap,
    netRealizedPnl,
    shortTermGains,
    longTermGains,
    taxableAmount,
    estimatedTax,
    currency: "USD",
    generatedAt: new Date().toISOString(),
    trades,
  };
}

async function computeAnnualReport(
  prisma: ReturnType<typeof getPrisma>,
  userId: string,
  year: number,
  country: TaxCountry
): Promise<TaxSummary> {
  const { from, to } = fiscalYearBounds(year, country);

  const rawTrades = await prisma.tradeAudit.findMany({
    where: { userId, tradeStatus: "CLOSED", closedAt: { gte: from, lte: to, not: null } },
    orderBy: { closedAt: "asc" },
  });

  const symbols = [...new Set(rawTrades.map((t) => t.symbol))];
  const instruments = symbols.length
    ? await prisma.instrument.findMany({ where: { symbol: { in: symbols } }, select: { symbol: true, assetClass: true } })
    : [];
  const assetClassBySymbol = new Map(instruments.map((i) => [i.symbol, i.assetClass]));

  const positionIds = [...new Set(rawTrades.map((t) => t.positionId).filter((id): id is string => !!id))];
  const swapSums = positionIds.length
    ? await prisma.swapAccrual.groupBy({ by: ["positionId"], where: { positionId: { in: positionIds } }, _sum: { swapAmount: true } })
    : [];
  const swapByPosition = new Map(swapSums.map((s) => [s.positionId, s._sum.swapAmount?.toNumber() ?? 0]));

  const trades: TaxableTrade[] = rawTrades.map((t) => {
    const openDate = t.createdAt.toISOString();
    const closeDate = t.closedAt!.toISOString();
    const holdingDays = Math.floor((t.closedAt!.getTime() - t.createdAt.getTime()) / 86_400_000);
    const realizedPnl = t.pnlRealized?.toNumber() ?? 0;
    const commission = t.fees.toNumber();
    const swap = t.positionId ? swapByPosition.get(t.positionId) ?? 0 : 0;
    const netPnl = realizedPnl - commission + swap;

    return {
      tradeId: t.id,
      symbol: t.symbol,
      assetClass: assetClassBySymbol.get(t.symbol) ?? "FOREX",
      direction: t.side as "BUY" | "SELL",
      quantity: t.quantity.toNumber(),
      openDate,
      closeDate,
      entryPrice: t.entryPrice?.toNumber() ?? 0,
      exitPrice: t.exitPrice?.toNumber() ?? t.entryPrice?.toNumber() ?? 0,
      realizedPnl,
      commission,
      swap,
      netPnl,
      holdingDays,
      isLongTerm: holdingDays > 365,
      washSale: false,
    };
  });

  if (country === "US") applyWashSaleRules(trades);

  return buildSummary(userId, year, country, trades);
}

function exportCsv(summary: TaxSummary): string {
  const header = [
    "TradeID",
    "Symbol",
    "AssetClass",
    "Direction",
    "Quantity",
    "OpenDate",
    "CloseDate",
    "EntryPrice",
    "ExitPrice",
    "RealizedPnL",
    "Commission",
    "Swap",
    "NetPnL",
    "HoldingDays",
    "LongTerm",
    "WashSale",
  ].join(",");

  const rows = summary.trades.map((t) =>
    [
      t.tradeId,
      t.symbol,
      t.assetClass,
      t.direction,
      t.quantity.toFixed(4),
      t.openDate.slice(0, 10),
      t.closeDate.slice(0, 10),
      t.entryPrice.toFixed(5),
      t.exitPrice.toFixed(5),
      t.realizedPnl.toFixed(2),
      t.commission.toFixed(2),
      t.swap.toFixed(2),
      t.netPnl.toFixed(2),
      t.holdingDays,
      t.isLongTerm ? "YES" : "NO",
      t.washSale ? "YES" : "NO",
    ].join(",")
  );

  const meta = [
    `# IGFX OLOS — Tax Report ${summary.year}`,
    `# Country: ${summary.country} | Generated: ${summary.generatedAt}`,
    `# Net Realized P&L: ${summary.netRealizedPnl.toFixed(2)} USD`,
    `# Estimated Tax (${(TAX_RATES[summary.country].rate * 100).toFixed(0)}%): ${summary.estimatedTax.toFixed(2)} USD`,
    "",
  ];

  return [...meta, header, ...rows].join("\n");
}

taxRoutes.get("/years", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);

  const min = await prisma.tradeAudit.findFirst({
    where: { userId: user.sub, tradeStatus: "CLOSED" },
    orderBy: { closedAt: "asc" },
    select: { closedAt: true },
  });
  if (!min?.closedAt) return c.json({ years: [] });

  const startYear = min.closedAt.getFullYear();
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = startYear; y <= currentYear; y++) years.push(y);
  return c.json({ years });
});

taxRoutes.get("/report", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear() - 1), 10);
  const countryParam = c.req.query("country") ?? "OTHER";
  const country = isTaxCountry(countryParam) ? countryParam : "OTHER";

  const report = await computeAnnualReport(prisma, user.sub, year, country);
  return c.json({ report });
});

taxRoutes.get("/export", async (c) => {
  const user = c.get("user")!;
  const prisma = getPrisma(c.env);
  const year = parseInt(c.req.query("year") ?? String(new Date().getFullYear() - 1), 10);
  const countryParam = c.req.query("country") ?? "OTHER";
  const country = isTaxCountry(countryParam) ? countryParam : "OTHER";
  const format = c.req.query("format") ?? "json";

  const report = await computeAnnualReport(prisma, user.sub, year, country);

  if (format === "csv") {
    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="igfx_tax_${year}_${country}.csv"`);
    return c.body(exportCsv(report));
  }

  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="igfx_tax_${year}_${country}.json"`);
  return c.body(JSON.stringify({ meta: { ...report, trades: undefined }, trades: report.trades }, null, 2));
});
