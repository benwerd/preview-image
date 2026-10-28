import { describe, it, expect } from "vitest";
import { explainGhostSignature, signGhostWebhook, verifyGhostSignature } from "../src/signature";

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
  it("explains why a signature was rejected", async () => {
    expect(await explainGhostSignature(body, null, secret, now)).toEqual({ ok: false, reason: "missing" });
    expect(await explainGhostSignature(body, "sha256=abc", secret, now)).toEqual({ ok: false, reason: "malformed" });
    const stale = await signGhostWebhook(body, secret, now - 6 * 60_000);
    expect(await explainGhostSignature(body, stale, secret, now)).toEqual({ ok: false, reason: "stale" });
    const wrong = await signGhostWebhook(body, "other", now);
    expect(await explainGhostSignature(body, wrong, secret, now)).toEqual({ ok: false, reason: "mismatch" });
    const good = await signGhostWebhook(body, secret, now);
    expect(await explainGhostSignature(body, good, secret, now)).toEqual({ ok: true });
  });
  it("matches an independently computed openssl vector", async () => {
    // printf '%s' '{"a":1}1761600000000' | openssl dgst -sha256 -hmac 's3cret'
    const ts = 1_761_600_000_000;
    const hex = "bf213bd89fc6faf1273b798e5c2be9b7bcb633e31840cf61c2a882e3fecc2af0";
    const header = await signGhostWebhook('{"a":1}', "s3cret", ts);
    expect(header).toBe(`sha256=${hex}, t=${ts}`);
    expect(await verifyGhostSignature('{"a":1}', header, "s3cret", ts)).toBe(true);
  });
});
