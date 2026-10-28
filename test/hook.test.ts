import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { createWorker } from "../src/index";
import { signGhostWebhook } from "../src/signature";

const post = { id: "p1", status: "published", feature_image: null, og_image: null, title: "T", custom_excerpt: "E", updated_at: "2026-10-27T00:00:00.000Z" };

async function post_(body: string, sign = true, e = env) {
  const processPost = vi.fn(async () => {});
  const worker = createWorker({ processPost });
  const headers = new Headers({ "content-type": "application/json" });
  if (sign) headers.set("x-ghost-signature", await signGhostWebhook(body, env.GHOST_WEBHOOK_SECRET!, Date.now()));
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://og.test/hook", { method: "POST", body, headers }), e, ctx);
  await waitOnExecutionContext(ctx);
  return { res, processPost };
}

describe("POST /hook", () => {
  it("401s an unsigned request", async () => {
    const { res, processPost } = await post_(JSON.stringify({ post: { current: post, previous: {} } }), false);
    expect(res.status).toBe(401); expect(processPost).not.toHaveBeenCalled();
  });
  it("queues exactly one job for an eligible post and answers 202", async () => {
    const { res, processPost } = await post_(JSON.stringify({ post: { current: post, previous: {} } }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true, id: "p1", mode: "create" });
    expect(processPost).toHaveBeenCalledTimes(1);
    expect(processPost).toHaveBeenCalledWith("p1", expect.anything());
  });
  it("200-skips a post with a feature image", async () => {
    const { res, processPost } = await post_(JSON.stringify({ post: { current: { ...post, feature_image: "https://x/y.jpg" }, previous: {} } }));
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ skipped: "has feature image" }); expect(processPost).not.toHaveBeenCalled();
  });
  it("refuses everything when no secret is configured", async () => {
    const { res } = await post_(JSON.stringify({ post: { current: post, previous: {} } }), true, { ...env, GHOST_WEBHOOK_SECRET: undefined });
    expect(res.status).toBe(401);
  });
  it("400s on a non-JSON body that is correctly signed", async () => {
    const { res } = await post_("not json");
    expect(res.status).toBe(400);
  });
});
