import type { PrismaClient } from "@prisma/client";
import { fetchLiveQuotesRaw, type LiveQuote } from "./twelvedata";

// Automatic key rotation for TwelveData only — Binance and Finnhub (Fase 9
// follow-up) are untouched by this. The user provisioned 5 TwelveData API
// keys, each on the free tier with TWO separate caps that both matter here:
//   - 8 credits/minute per key   (1 credit per symbol per /quote call)
//   - 800 credits/day per key
// Confirmed empirically: a single 80-symbol batch call instantly blows the
// per-minute cap on ANY key (independent of the daily cap, and independent
// per key — testing key #5 alone with 1 symbol succeeded right after keys
// #1-4 had just "failed" on an 80-symbol batch, proving the per-minute
// bucket is per-key, not account-wide). So the fix isn't just "try the next
// key when one is exhausted" — every call must also be chunked to ≤8
// symbols, with enough spacing between reuses of the *same* key to clear
// its per-minute window.
//
// Strategy: split the requested symbols into chunks of MAX_PER_MINUTE,
// assign chunks round-robin across every key that isn't known daily-
// exhausted, and run one lane per key. Within a lane, chunks are fetched
// sequentially with WAVE_DELAY_MS between them (clearing that key's own
// per-minute window); different lanes (different keys) run in parallel
// since their rate-limit buckets are independent. A lane stops early if its
// key comes back with a quota-exceeded response after the wave delay has
// already been respected — that can only be the daily cap at that point,
// so the key is marked exhausted-until-next-UTC-midnight and its remaining
// chunks are simply left for a later Cron tick (no data loss, just delayed
// freshness for those specific symbols this cycle).
const MAX_PER_MINUTE = 8;
const WAVE_DELAY_MS = 62_000;
const MAX_WAVES = 3; // bounds worst-case invocation length; extra symbols beyond this roll to the next tick

const ROTATION_STATE_KEY = "twelvedata_key_rotation";

type RotationState = { dailyExhaustedUntil: Record<number, string> };

function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)).toISOString();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadState(prisma: PrismaClient): Promise<RotationState> {
  const row = await prisma.brokerSetting.findUnique({ where: { key: ROTATION_STATE_KEY } });
  const value = row?.value as Partial<RotationState> | undefined;
  return { dailyExhaustedUntil: value?.dailyExhaustedUntil ?? {} };
}

async function saveState(prisma: PrismaClient, state: RotationState): Promise<void> {
  await prisma.brokerSetting.upsert({
    where: { key: ROTATION_STATE_KEY },
    create: { key: ROTATION_STATE_KEY, value: state },
    update: { value: state },
  });
}

export async function fetchLiveQuotesRotating(prisma: PrismaClient, apiKeys: (string | undefined)[], symbols: string[]): Promise<Map<string, LiveQuote>> {
  const keys = apiKeys.filter((k): k is string => !!k);
  if (keys.length === 0) {
    console.error("[twelvedata-rotation] no API keys configured");
    return new Map();
  }

  const state = await loadState(prisma);
  const now = Date.now();
  const availableKeyIdx = keys.map((_, i) => i).filter((i) => {
    const until = state.dailyExhaustedUntil[i];
    return !until || new Date(until).getTime() <= now;
  });

  if (availableKeyIdx.length === 0) {
    console.error(`[twelvedata-rotation] all ${keys.length} keys are daily-exhausted`);
    return new Map();
  }

  const chunks = chunk(symbols, MAX_PER_MINUTE).slice(0, availableKeyIdx.length * MAX_WAVES);
  const lanes: string[][][] = availableKeyIdx.map(() => []);
  chunks.forEach((c, i) => lanes[i % availableKeyIdx.length].push(c));

  const results = new Map<string, LiveQuote>();
  const newlyExhausted = new Set<number>();

  await Promise.all(
    availableKeyIdx.map(async (keyIdx, laneIdx) => {
      const laneChunks = lanes[laneIdx];
      for (let w = 0; w < laneChunks.length; w++) {
        if (w > 0) await sleep(WAVE_DELAY_MS);

        const { quotes, quotaExceeded } = await fetchLiveQuotesRaw(keys[keyIdx], laneChunks[w]);
        if (quotaExceeded) {
          console.warn(`[twelvedata-rotation] key #${keyIdx + 1}/${keys.length} daily-exhausted — stopping its lane`);
          newlyExhausted.add(keyIdx);
          break;
        }
        for (const [sym, q] of quotes) results.set(sym, q);
      }
    })
  );

  if (newlyExhausted.size > 0) {
    for (const idx of newlyExhausted) state.dailyExhaustedUntil[idx] = nextUtcMidnight();
    await saveState(prisma, state);
  }

  const skipped = symbols.length - chunks.flat().length;
  if (skipped > 0) {
    console.warn(`[twelvedata-rotation] ${skipped}/${symbols.length} symbols rolled to a later tick (wave/key budget)`);
  }

  return results;
}

// Used by the signal generator, which needs single-symbol time_series
// (candle) calls rather than a batch /quote call — reuses the same
// daily-exhaustion state instead of a separate tracking mechanism, so a key
// marked exhausted by the quote rotation is also skipped here.
export async function getActiveTwelveDataKey(prisma: PrismaClient, apiKeys: (string | undefined)[]): Promise<string | null> {
  const keys = apiKeys.filter((k): k is string => !!k);
  if (keys.length === 0) return null;

  const state = await loadState(prisma);
  const now = Date.now();
  const idx = keys.findIndex((_, i) => {
    const until = state.dailyExhaustedUntil[i];
    return !until || new Date(until).getTime() <= now;
  });

  return idx === -1 ? null : keys[idx];
}
