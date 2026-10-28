import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const call = async (qs: string, e = env) => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://og.test/preview?${qs}`), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

describe("GET /preview", () => {
  it("returns a PNG when the token is right", async () => {
    const res = await call("token=test-preview-token&title=Hello&subtitle=World&label=Technology");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89);
  });
  it("401s on a wrong or missing token", async () => {
    expect((await call("token=nope&title=Hello")).status).toBe(401);
    expect((await call("title=Hello")).status).toBe(401);
  });
  it("400s without a title", async () => {
    expect((await call("token=test-preview-token")).status).toBe(400);
  });
  it("404s when PREVIEW_TOKEN is not configured", async () => {
    expect((await call("token=x&title=Hello", { ...env, PREVIEW_TOKEN: undefined })).status).toBe(404);
  });
});
