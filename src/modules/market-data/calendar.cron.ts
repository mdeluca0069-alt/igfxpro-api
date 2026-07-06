import { randomUUID } from "node:crypto";
import { getPrisma } from "../../prisma/prisma.edge";
import type { Env } from "../../prisma/prisma.edge";
import { fetchRecentReleaseDates, nextNfpDate } from "../../common/fred";

// Runs on the same hourly slow-tick as the TwelveData quote rotation (see
// worker.ts). Populates the real EconomicEvent table instead of the old
// stub that always returned []. See fred.ts for why this is USD-only and a
// mix of real historical release dates + one computed forward date (NFP) —
// both Finnhub's and FRED's genuinely forward-looking calendar data are
// unavailable on this account's plan / this API's design.
export async function refreshEconomicCalendar(env: Env): Promise<void> {
  const prisma = getPrisma(env);

  const [historical] = await Promise.all([fetchRecentReleaseDates(env.FRED_API_KEY, 21)]);

  const rows = historical.map((e) => ({
    country: "US",
    currency: "USD",
    title: e.title,
    impact: e.impact,
    source: "FRED",
    eventTime: new Date(`${e.date}T13:30:00.000Z`), // BLS/BEA releases are conventionally 8:30am ET
  }));

  const nextNfp = nextNfpDate();
  rows.push({
    country: "US",
    currency: "USD",
    title: "Employment Situation (Non-Farm Payrolls)",
    impact: "high",
    source: "COMPUTED",
    eventTime: new Date(`${nextNfp}T13:30:00.000Z`),
  });

  if (rows.length === 0) {
    console.error("[calendar-cron] no economic events fetched");
    return;
  }

  await Promise.all(
    rows.map((r) =>
      prisma.economicEvent
        .upsert({
          where: { currency_eventTime_title_source: { currency: r.currency, eventTime: r.eventTime, title: r.title, source: r.source } },
          create: { id: randomUUID(), ...r },
          update: {},
        })
        .catch(() => {
          // Non-fatal — a duplicate race or transient DB error shouldn't fail the whole tick.
        })
    )
  );

  console.log(`[calendar-cron] upserted ${rows.length} economic events`);
}
