// Real economic-calendar data source. Finnhub's /calendar/economic isn't
// included on this account's plan (confirmed via direct test — "You don't
// have access to this resource"), and FRED (St. Louis Fed) has no true
// forward-looking release schedule endpoint (its /release/dates only lists
// dates that have already happened — confirmed empirically, e.g. release_id
// 101 "FOMC Press Release" returns a release for literally every calendar
// day, which isn't a real meeting schedule at all and is excluded below).
// So this covers what's actually available for free, honestly:
//   - Real historical release dates for major USD indicators (FRED, exact).
//   - One genuinely forward-looking entry: the next Employment Situation
//     (NFP) release, computed from the permanent BLS rule "first Friday of
//     the month" — a publication rule, not a guessed date.
const FRED_BASE = "https://api.stlouisfed.org/fred";

export type CalendarImpact = "low" | "medium" | "high";

export const FRED_RELEASES: Array<{ id: number; name: string; impact: CalendarImpact }> = [
  { id: 50, name: "Employment Situation (Non-Farm Payrolls)", impact: "high" },
  { id: 10, name: "Consumer Price Index (CPI)", impact: "high" },
  { id: 54, name: "Personal Income and Outlays (incl. PCE)", impact: "high" },
  { id: 53, name: "Gross Domestic Product (GDP)", impact: "high" },
  { id: 46, name: "Producer Price Index (PPI)", impact: "medium" },
  { id: 9, name: "Advance Retail Sales", impact: "medium" },
  { id: 13, name: "Industrial Production & Capacity Utilization", impact: "medium" },
  { id: 194, name: "ADP National Employment Report", impact: "medium" },
];

export type FredEvent = { releaseId: number; title: string; impact: CalendarImpact; date: string };

export async function fetchRecentReleaseDates(apiKey: string, lookbackDays: number): Promise<FredEvent[]> {
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 86_400_000);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const results = await Promise.allSettled(
    FRED_RELEASES.map(async (r) => {
      const params = new URLSearchParams({
        release_id: String(r.id),
        api_key: apiKey,
        file_type: "json",
        realtime_start: fromStr,
        realtime_end: toStr,
        sort_order: "asc",
      });
      const res = await fetch(`${FRED_BASE}/release/dates?${params.toString()}`);
      const json = (await res.json()) as { release_dates?: Array<{ date: string }> };
      return (json.release_dates ?? []).map((d) => ({ releaseId: r.id, title: r.name, impact: r.impact, date: d.date }));
    })
  );

  const events: FredEvent[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") events.push(...r.value);
  }
  return events;
}

// First Friday of the given month (BLS's permanent Employment Situation
// publication rule) — a computed fact, not a fabricated date.
function firstFridayOfMonth(year: number, monthIndex0: number): Date {
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  const dayOfWeek = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = (5 - dayOfWeek + 7) % 7; // days until first Friday (5)
  d.setUTCDate(1 + offset);
  return d;
}

export function nextNfpDate(now: Date = new Date()): string {
  const thisMonth = firstFridayOfMonth(now.getUTCFullYear(), now.getUTCMonth());
  if (thisMonth.getTime() > now.getTime()) return thisMonth.toISOString().slice(0, 10);
  const next = now.getUTCMonth() === 11 ? firstFridayOfMonth(now.getUTCFullYear() + 1, 0) : firstFridayOfMonth(now.getUTCFullYear(), now.getUTCMonth() + 1);
  return next.toISOString().slice(0, 10);
}
