import { describe, it, expect } from "vitest";
import { computeStatus, effectiveStatus } from "./competition.helpers";

describe("computeStatus", () => {
  it("returns 'upcoming' when today is before startDate", () => {
    expect(computeStatus("2026-06-01", "2026-06-30", "2026-05-15")).toBe("upcoming");
  });

  it("returns 'active' when today equals startDate", () => {
    expect(computeStatus("2026-06-01", "2026-06-30", "2026-06-01")).toBe("active");
  });

  it("returns 'active' when today equals endDate", () => {
    expect(computeStatus("2026-06-01", "2026-06-30", "2026-06-30")).toBe("active");
  });

  it("returns 'active' when today is between start and end", () => {
    expect(computeStatus("2026-06-01", "2026-06-30", "2026-06-15")).toBe("active");
  });

  it("returns 'finished' when today is strictly after endDate", () => {
    expect(computeStatus("2026-06-01", "2026-06-30", "2026-07-01")).toBe("finished");
  });

  it("handles single-day competitions where start == end == today", () => {
    expect(computeStatus("2026-06-15", "2026-06-15", "2026-06-15")).toBe("active");
  });
});

describe("effectiveStatus", () => {
  it("trusts stored 'finished' even if dates say active", () => {
    // This is the exact case force-end produces: endDate set to today.
    const comp = { startDate: "2026-06-01", endDate: "2026-06-15", status: "finished" };
    expect(effectiveStatus(comp, "2026-06-15")).toBe("finished");
  });

  it("falls back to date compute when stored status is not 'finished'", () => {
    const comp = { startDate: "2026-06-01", endDate: "2026-06-30", status: "active" };
    expect(effectiveStatus(comp, "2026-07-01")).toBe("finished");
    expect(effectiveStatus(comp, "2026-06-15")).toBe("active");
    expect(effectiveStatus(comp, "2026-05-15")).toBe("upcoming");
  });

  it("handles missing status field via date compute", () => {
    const comp = { startDate: "2026-06-01", endDate: "2026-06-30" };
    expect(effectiveStatus(comp, "2026-06-15")).toBe("active");
  });

  it("does NOT trust stored 'upcoming' — date compute always wins for non-finished", () => {
    // If admin manually wrote status:"upcoming" but dates say active, we believe dates.
    const comp = { startDate: "2026-06-01", endDate: "2026-06-30", status: "upcoming" };
    expect(effectiveStatus(comp, "2026-06-15")).toBe("active");
  });
});
