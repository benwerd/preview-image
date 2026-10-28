const TOLERANCE_MS = 5 * 60_000;
const HEADER = /^sha256=([0-9a-f]{64}),\s*t=(\d+)$/;
const encoder = new TextEncoder();

export async function signGhostWebhook(rawBody: string, secret: string, timestampMs: number): Promise<string> {
  const digest = await hmacSha256(secret, rawBody + String(timestampMs));
  return `sha256=${toHex(digest)}, t=${timestampMs}`;
}

export type SignatureResult = { ok: true } | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

export async function explainGhostSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SignatureResult> {
  if (header === null) return { ok: false, reason: "missing" };
  const match = HEADER.exec(header);
  if (!match) return { ok: false, reason: "malformed" };

  const [, digestHex, ts] = match;
  if (Math.abs(nowMs - Number(ts)) > TOLERANCE_MS) return { ok: false, reason: "stale" };

  const expected = new Uint8Array(await hmacSha256(secret, rawBody + ts));
  const actual = fromHex(digestHex);
  if (actual.byteLength !== expected.byteLength) return { ok: false, reason: "mismatch" };
  return crypto.subtle.timingSafeEqual(actual, expected) ? { ok: true } : { ok: false, reason: "mismatch" };
}

export async function verifyGhostSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  return (await explainGhostSignature(rawBody, header, secret, nowMs)).ok;
}

async function hmacSha256(secret: string, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, encoder.encode(message));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
