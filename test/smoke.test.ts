import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("worker", () => {
  it("returns 404 JSON for unknown routes", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://og.test/nope"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("exposes the Ghost URL var and test secrets", () => {
    expect(env.GHOST_ADMIN_API_URL).toBe("https://werd-io.ghost.io");
    expect(env.GHOST_WEBHOOK_SECRET).toBe("test-webhook-secret");
  });
});
