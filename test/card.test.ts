import { describe, it, expect } from "vitest";
import { fitCard, renderCard, LAYOUT } from "../src/card";

const typical = { title: 'Solar is "offensively cheap". To live up to its promise, it also needs to be equitable.',
  subtitle: "This year, solar will represent 10% of power generation. Abundant, clean energy is great news – but there's more work to do to make sure every community benefits.", label: "Technology" };

describe("fitCard", () => {
  it("uses the large size for a short title", async () => {
    const f = await fitCard({ title: "Current Affairs says it's banning AI", subtitle: "Current Affairs has enshrined tough restrictions on publishing using generative AI into its union contract." });
    expect(f.titleSize).toBe(76); expect(f.titleLines).toBeLessThanOrEqual(2); expect(f.subtitleSize).toBe(30);
  });
  it("uses the default size for a typical title", async () => {
    const f = await fitCard(typical);
    expect(f.titleSize).toBe(64); expect(f.titleLines).toBe(3);
  });
  it("steps down for a very long title and still fits", async () => {
    const f = await fitCard({ title: "Foursquare died at the hands of private equity, and the story of how it got there says something about what happens to every community platform that takes the money. What happens next?", subtitle: typical.subtitle });
    expect(f.titleSize).toBeLessThan(64); expect(f.titleSize).toBeGreaterThanOrEqual(44);
    expect(f.titleLines * f.titleSize * LAYOUT.TITLE_LH + LAYOUT.GAP + 2 * f.subtitleSize * LAYOUT.SUB_LH).toBeLessThanOrEqual(LAYOUT.AVAIL_H + 1);
  });
  it("centres a title with no subtitle at the large size", async () => {
    const f = await fitCard({ title: "Young people trust AI more than the people in their lives." });
    expect(f.titleSize).toBe(76); expect(f.subtitleSize).toBe(30);
  });
  it("fits a single 600-character word by clamping at the floor", async () => {
    const f = await fitCard({ title: "x".repeat(600), subtitle: "s" });
    expect(f.titleSize).toBe(44); expect(f.titleClamp).toBeGreaterThanOrEqual(1);
  });
});

describe("renderCard", () => {
  it("produces a 1200×630 PNG for every approved case", async () => {
    for (const input of [typical, { title: "Short", subtitle: "" }, { title: "No label here", label: "" }]) {
      const png = await renderCard(input);
      const v = new DataView(png.buffer, png.byteOffset);
      expect(v.getUint32(16)).toBe(1200); expect(v.getUint32(20)).toBe(630);
    }
  });
});
