import { describe, it, expect } from "vitest";
import { signGhostWebhook, verifyGhostSignature } from "../src/signature";

const body = JSON.stringify({ post: { current: { id: "abc" } } });
const secret = "s3cret";
const now = 1_761_600_000_000;

describe("Ghost webhook signature", () => {
  it("accepts a signature Ghost would produce", async () => {
    const header = await signGhostWebhook(body, secret, now - 1000);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}, t=\d+$/);
    expect(await verifyGhostSignature(body, header, secret, now)).toBe(true);
  });
  it("rejects a wrong secret", async () => {
    const header = await signGhostWebhook(body, "other", now);
    expect(await verifyGhostSignature(body, header, secret, now)).toBe(false);
  });
  it("rejects a tampered body", async () => {
    const header = await signGhostWebhook(body, secret, now);
    expect(await verifyGhostSignature(body + " ", header, secret, now)).toBe(false);
  });
  it("rejects a timestamp older than 5 minutes", async () => {
    const header = await signGhostWebhook(body, secret, now - 6 * 60_000);
    expect(await verifyGhostSignature(body, header, secret, now)).toBe(false);
  });
  it("rejects missing or malformed headers without throwing", async () => {
    expect(await verifyGhostSignature(body, null, secret, now)).toBe(false);
    expect(await verifyGhostSignature(body, "sha256=abc", secret, now)).toBe(false);
    expect(await verifyGhostSignature(body, "sha256=zz, t=1", secret, now)).toBe(false);
  });
});
