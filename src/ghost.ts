import type { GhostPost } from "./decide";

export type FetchLike = typeof fetch;

export class GhostError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "GhostError";
    this.status = status;
    this.body = body;
  }
}

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function splitKey(key: string | undefined): { id: string; secret: string } {
  const idx = key ? key.indexOf(":") : -1;
  if (!key || idx < 1 || idx === key.length - 1) throw new Error("GHOST_ADMIN_API_KEY not set");
  return { id: key.slice(0, idx), secret: key.slice(idx + 1) };
}

export async function adminJwt(key: string, nowSeconds: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const { id, secret } = splitKey(key);
  const header = { alg: "HS256", typ: "JWT", kid: id };
  const payload = { iat: nowSeconds, exp: nowSeconds + 300, aud: "/admin/" };
  const signingInput = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;
  const cryptoKey = await crypto.subtle.importKey("raw", hexToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(signingInput)));
  return `${signingInput}.${base64url(signature)}`;
}

export function ghostClient(
  env: Pick<Env, "GHOST_ADMIN_API_URL" | "GHOST_ADMIN_API_KEY">,
  fetchImpl: FetchLike = fetch,
) {
  const key = env.GHOST_ADMIN_API_KEY;
  splitKey(key); // fail at construction when the key is missing or malformed
  const base = `${env.GHOST_ADMIN_API_URL.replace(/\/+$/, "")}/ghost/api/admin/`;

  async function call(method: string, path: string, body?: BodyInit, contentType?: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Accept-Version": "v5.0",
      Authorization: `Ghost ${await adminJwt(key!)}`,
    };
    if (contentType) headers["Content-Type"] = contentType;
    return fetchImpl(`${base}${path}`, { method, headers, body });
  }

  async function fail(method: string, path: string, res: Response): Promise<never> {
    throw new GhostError(`Ghost ${method} ${path} failed: ${res.status}`, res.status, await res.text());
  }

  return {
    async getPost(id: string): Promise<GhostPost | null> {
      const path = `posts/${id}/?include=tags`;
      const res = await call("GET", path);
      if (res.status === 404) return null;
      if (!res.ok) return fail("GET", path, res);
      const data = (await res.json()) as { posts?: GhostPost[] };
      return data.posts?.[0] ?? null;
    },

    async uploadImage(png: Uint8Array, filename: string): Promise<string> {
      const path = "images/upload/";
      const form = new FormData();
      form.append("file", new Blob([png], { type: "image/png" }), filename);
      form.append("purpose", "image");
      form.append("ref", filename);
      const res = await call("POST", path, form);
      if (!res.ok) return fail("POST", path, res);
      const data = (await res.json()) as { images?: { url: string }[] };
      const url = data.images?.[0]?.url;
      if (!url) throw new GhostError(`Ghost POST ${path} returned no image url`, res.status, JSON.stringify(data));
      return url;
    },

    async setSocialImages(id: string, url: string, updatedAt: string): Promise<"ok" | "conflict"> {
      const path = `posts/${id}/`;
      const body = JSON.stringify({ posts: [{ og_image: url, twitter_image: url, updated_at: updatedAt }] });
      const res = await call("PUT", path, body, "application/json");
      if (res.status === 409) return "conflict";
      if (!res.ok) return fail("PUT", path, res);
      return "ok";
    },
  };
}
