import { createHash } from "node:crypto";

// Ported as-is from igfxpro-apiv2/shared/account-number.ts — deterministic,
// no schema column needed, stable forever for a given user id.
export function formatAccountNumber(userId: string): string {
  const hash = createHash("sha256").update(userId).digest("hex");
  const num = parseInt(hash.slice(0, 9), 16) % 10_000_000;
  return `100${num.toString().padStart(7, "0")}`;
}
