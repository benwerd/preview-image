import { describe, it, expect } from "vitest";
import { cleanText, stripUnsupported } from "../src/text";

describe("cleanText", () => {
  it("decodes entities Ghost emits", () => {
    expect(cleanText("Tom &amp; Jerry&#8217;s &quot;day&quot; &ndash; now")).toBe('Tom & Jerry’s "day" – now');
  });
  it("decodes hex numeric entities with either case of x", () => {
    expect(cleanText("&#x41;&#X41;")).toBe("AA");
  });
  it("strips tags and collapses whitespace", () => {
    expect(cleanText("  <em>Solar</em> is\n\n  cheap ")).toBe("Solar is cheap");
  });
  it("returns empty string for null, undefined and whitespace", () => {
    expect(cleanText(null)).toBe(""); expect(cleanText(undefined)).toBe(""); expect(cleanText("  \n ")).toBe("");
  });
  it("keeps curly quotes, dashes and ellipsis", () => {
    expect(cleanText("“Quoted” — yes… – no")).toBe("“Quoted” — yes… – no");
  });
});

describe("stripUnsupported", () => {
  it("removes emoji and CJK and reports them", () => {
    const r = stripUnsupported("Hello 🌍 world 日本");
    expect(r.text).toBe("Hello world");
    expect(r.stripped).toEqual(["🌍", "日", "本"]);
  });
  it("keeps Latin-1 letters", () => {
    expect(stripUnsupported("café naïve Ærø").stripped).toEqual([]);
  });
});
