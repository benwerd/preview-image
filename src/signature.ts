const TOLERANCE_MS = 5 * 60_000;
const HEADER = /^sha256=([0-9a-f]{64}),\s*t=(\d+)$/;
const encoder = new TextEncoder();

export async function signGhostWebhook(rawBody: string, secret: string, timestampMs: number): Promise<string> {
  const digest = await hmacSha256(secret, rawBody + String(timestampMs));
  return `sha256=${toHex(digest)}, t=${timestampMs}`;
}

export async function verifyGhostSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (header === null) return false;
  const match = HEADER.exec(header);
  if (!match) return false;

  const [, digestHex, ts] = match;
  if (Math.abs(nowMs - Number(ts)) > TOLERANCE_MS) return false;

  const expected = new Uint8Array(await hmacSha256(secret, rawBody + ts));
  const actual = fromHex(digestHex);
  if (actual.byteLength !== expected.byteLength) return false;
  return crypto.subtle.timingSafeEqual(actual, expected);
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
