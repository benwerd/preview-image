import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { processPost } from "../src/job";

const post = (over: object = {}) => ({ id: "p1", status: "published", feature_image: null, og_image: null, title: "Tom &amp; Jerry", custom_excerpt: "E", updated_at: "u1", primary_tag: { name: "Technology" }, ...over });

function ghostStub(script: { gets: object[]; putStatuses: number[] }) {
  const calls: { method: string; path: string; body?: any }[] = [];
  let g = 0, p = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init); const path = new URL(req.url).pathname;
    if (req.method === "GET") { calls.push({ method: "GET", path }); return Response.json({ posts: [script.gets[g++]] }); }
    if (path.endsWith("/images/upload/")) { calls.push({ method: "POST", path }); return Response.json({ images: [{ url: "https://werd.io/content/images/2026/10/og-p1.png" }] }); }
    calls.push({ method: "PUT", path, body: JSON.parse(await req.text()) }); return new Response("{}", { status: script.putStatuses[p++] ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("processPost", () => {
  it("renders, uploads and sets both images once", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post()], putStatuses: [200] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PUT"]);
    expect(calls[2].body.posts[0]).toEqual({ og_image: "https://werd.io/content/images/2026/10/og-p1.png", twitter_image: "https://werd.io/content/images/2026/10/og-p1.png", updated_at: "u1" });
  });
  it("skips when the fresh copy has a hand-set og_image", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post({ og_image: "https://werd.io/content/images/photo.png" })], putStatuses: [] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
  it("retries the PUT once on 409 with the fresh updated_at", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post(), post({ updated_at: "u2" })], putStatuses: [409, 200] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PUT", "GET", "PUT"]);
    expect(calls[4].body.posts[0].updated_at).toBe("u2");
  });
  it("gives up after 409 if someone set a foreign og_image meanwhile", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post(), post({ og_image: "https://werd.io/content/images/photo.png", updated_at: "u2" })], putStatuses: [409] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PUT", "GET"]);
  });
  it("does not throw on a Ghost 500", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await expect(processPost("p1", env, fetchImpl)).resolves.toBeUndefined();
  });
});
