import { describe, it, expect } from "vitest";
import { ensureEngines, layoutToSvg, svgToPng, FONTS } from "../src/render";

describe("render engines", () => {
  it("loads three fonts as ArrayBuffers", () => {
    expect(FONTS.map((f) => `${f.name}-${f.weight}`)).toEqual(["Inter-700", "Inter-800", "Merriweather-400"]);
    for (const f of FONTS) expect(f.data.byteLength).toBeGreaterThan(10_000);
  });

  it("lays out text and reports node sizes", async () => {
    await ensureEngines();
    const seen: Record<string, number> = {};
    const svg = await layoutToSvg(
      { type: "div", props: { style: { display: "flex", width: 1200, height: 630 },
        children: { type: "div", key: "t", props: { style: { fontFamily: "Inter", fontWeight: 800, fontSize: 64 }, children: "Hello" } } } },
      (n) => { if (n.key) seen[String(n.key)] = n.height; },
    );
    expect(svg).toMatch(/^<svg/);
    expect(seen.t).toBeGreaterThan(60);
  });

  it("rasterises an SVG to a 1200×630 PNG", async () => {
    await ensureEngines();
    const png = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#fff"/></svg>');
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(1200); // IHDR width
    expect(view.getUint32(20)).toBe(630);  // IHDR height
  });
});
