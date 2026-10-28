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
  it("refreshes when previous.title differs from current.title", () =>
    expect(decide(wrap({ ...base, title: "New", og_image: "https://werd.io/content/images/2026/10/og-p1.png" }, { title: "Old" })).decision).toEqual({ mode: "refresh" }));
  it("skips when previous.tags equals current.tags", () => {
    const tags = [{ id: "t1", name: "Tech", slug: "tech" }];
    expect(decide(wrap({ ...base, tags, og_image: "https://werd.io/content/images/2026/10/og-p1.png" }, { tags: [{ id: "t1", name: "Tech", slug: "tech" }] })).decision)
      .toEqual({ mode: "skip", reason: "og_image set" });
  });
  it("skips the edit the Worker itself makes", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/og-p1.png" }, { og_image: null, twitter_image: null, updated_at: "x" })).decision.mode).toBe("skip"));
  it("never touches a hand-set image", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/photo.png" }, { title: "Old" })).decision.mode).toBe("skip"));
});

describe("decide with malformed payloads", () => {
  it("treats a non-string og_image as set but not ours", () =>
    expect(decide(wrap({ ...base, og_image: 123 })).decision).toEqual({ mode: "skip", reason: "og_image set" }));
  it("does not throw for other non-string og_image values", () => {
    for (const og of [true, {}, []]) expect(() => decide(wrap({ ...base, og_image: og }, { title: "Old" }))).not.toThrow();
  });
  it("skips when post.current.id is an empty string", () =>
    expect(decide(wrap({ ...base, id: "" })).decision).toEqual({ mode: "skip", reason: "no post" }));
  it("skips when post.current is a string", () =>
    expect(decide({ post: { current: "nope" } }).decision).toEqual({ mode: "skip", reason: "no post" }));
  it("skips for non-object payloads", () => {
    for (const p of [null, undefined, 5, "x", [], { post: null }]) expect(decide(p).decision).toEqual({ mode: "skip", reason: "no post" });
  });
  it("creates for a fresh post when previous is null", () =>
    expect(decide({ post: { current: base, previous: null } }).decision).toEqual({ mode: "create" }));
});

describe("isOurImage", () => {
  it("matches by basename prefix only", () => {
    expect(isOurImage("https://a/b/og-p1.png", "p1")).toBe(true);
    expect(isOurImage("https://a/og-p1/photo.png", "p1")).toBe(false);
    expect(isOurImage(null, "p1")).toBe(false);
    expect(isOurImage(123 as unknown as string, "p1")).toBe(false);
  });
});
