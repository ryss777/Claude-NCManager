// Pure helpers for competition status computation.
// Kept here (not in competition.functions.ts) so they can be unit-tested
// without pulling in the firebase-admin SDK.

export type CompStatus = "upcoming" | "active" | "finished";

/**
 * Date-only status — does NOT consider any stored status field.
 * Returns "active" when today is in [startDate, endDate] inclusive.
 *
 * @param startDate ISO date YYYY-MM-DD
 * @param endDate   ISO date YYYY-MM-DD
 * @param today     optional override for testability; defaults to today (UTC slice)
 */
export function computeStatus(startDate: string, endDate: string, today?: string): CompStatus {
  const t = today ?? new Date().toISOString().slice(0, 10);
  if (t < startDate) return "upcoming";
  if (t > endDate) return "finished";
  return "active";
}

/**
 * Status that prefers a stored "finished" value over date-based computation.
 * This matters after force-end: endDate is set to today, so the date-only
 * compute would return "active" and let a forceEnd run again.
 */
export function effectiveStatus(
  comp: Record<string, unknown>,
  today?: string
): CompStatus {
  if (comp["status"] === "finished") return "finished";
  return computeStatus(comp["startDate"] as string, comp["endDate"] as string, today);
}
