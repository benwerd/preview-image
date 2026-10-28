import { describe, it, expect } from "vitest";
import { decide, isOurImage } from "../src/decide";

const base = { id: "p1", status: "published", feature_image: null, og_image: null, title: "T", custom_excerpt: "E", updated_at: "2026-10-27T00:00:00.000Z" };
const wrap = (current: object, previous: object = {}) => ({ post: { current, previous } });

describe("decide", () => {
  it("skips a payload without post.current", () => expect(decide({ site: {} }).decision).toEqual({ mode: "skip", reason: "no post" }));
  it("skips drafts", () => expect(decide(wrap({ ...base, status: "draft" })).decision.mode).toBe("skip"));
  it("skips posts with a feature image", () => expect(decide(wrap({ ...base, feature_image: "https://x/y.jpg" })).decision.mode).toBe("skip"));
  it("creates when og_image is empty", () => expect(decide(wrap(base)).decision).toEqual({ mode: "create" }));
  it("refreshes our image when the title changed", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/og-p1.png" }, { title: "Old" })).decision).toEqual({ mode: "refresh" }));
  it("refreshes our image (with Ghost's numeric suffix) when the excerpt changed", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/og-p1-1.png" }, { custom_excerpt: "Old" })).decision).toEqual({ mode: "refresh" }));
  it("skips the edit the Worker itself makes", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/og-p1.png" }, { og_image: null, twitter_image: null, updated_at: "x" })).decision.mode).toBe("skip"));
  it("never touches a hand-set image", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/photo.png" }, { title: "Old" })).decision.mode).toBe("skip"));
});

describe("isOurImage", () => {
  it("matches by basename prefix only", () => {
    expect(isOurImage("https://a/b/og-p1.png", "p1")).toBe(true);
    expect(isOurImage("https://a/og-p1/photo.png", "p1")).toBe(false);
    expect(isOurImage(null, "p1")).toBe(false);
  });
});
