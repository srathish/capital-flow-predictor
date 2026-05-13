import { describe, expect, it } from "vitest";

// We can't directly import from the page file (it's a client component with
// React); re-implement the same logic for testing. Keep this in sync with
// apps/web/app/gex/page.tsx if the grouping rule changes.
const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function etTradingDay(iso: string): string {
  const parts = ET_FORMATTER.formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

describe("etTradingDay", () => {
  it("returns the ET calendar date for a UTC timestamp during ET business hours", () => {
    // 2026-05-13 14:31 UTC = 10:31 ET
    expect(etTradingDay("2026-05-13T14:31:00Z")).toBe("2026-05-13");
  });

  it("handles late-night UTC that's still the same ET day", () => {
    // 2026-05-13 23:00 UTC = 19:00 ET → still May 13 ET
    expect(etTradingDay("2026-05-13T23:00:00Z")).toBe("2026-05-13");
  });

  it("rolls over to the next ET day when UTC crosses midnight ET", () => {
    // 2026-05-14 04:00 UTC = 00:00 ET (midnight ET = next day starts)
    expect(etTradingDay("2026-05-14T04:00:00Z")).toBe("2026-05-14");
  });

  it("respects EDT vs EST DST", () => {
    // 2026-01-15 14:31 UTC = 09:31 EST → Jan 15
    expect(etTradingDay("2026-01-15T14:31:00Z")).toBe("2026-01-15");
    // 2026-07-15 13:31 UTC = 09:31 EDT → Jul 15
    expect(etTradingDay("2026-07-15T13:31:00Z")).toBe("2026-07-15");
  });
});
