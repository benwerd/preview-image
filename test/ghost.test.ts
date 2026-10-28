import { describe, it, expect } from "vitest";
import { adminJwt, ghostClient } from "../src/ghost";

const key = "0123456789abcdef01234567:" + "ab".repeat(32);
const envish = { GHOST_ADMIN_API_URL: "https://werd-io.ghost.io", GHOST_ADMIN_API_KEY: key };
const b64url = (s: string) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));

describe("adminJwt", () => {
  it("builds an HS256 token with kid, aud and 5-minute expiry", async () => {
    const t = await adminJwt(key, 1_000_000);
    const [h, p, s] = t.split(".");
    expect(b64url(h)).toEqual({ alg: "HS256", typ: "JWT", kid: "0123456789abcdef01234567" });
    expect(b64url(p)).toEqual({ iat: 1_000_000, exp: 1_000_300, aud: "/admin/" });
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("ghostClient", () => {
  it("GETs a post with tags and the right headers", async () => {
    let seen: Request | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => { seen = new Request(input, init);
      return Response.json({ posts: [{ id: "p1", status: "published", feature_image: null, og_image: null, title: "T", custom_excerpt: "E", updated_at: "u", primary_tag: { name: "Technology" } }] }); }) as typeof fetch;
    const post = await ghostClient(envish, fetchImpl).getPost("p1");
    expect(seen!.url).toBe("https://werd-io.ghost.io/ghost/api/admin/posts/p1/?include=tags");
    expect(seen!.headers.get("accept-version")).toBe("v5.0");
    expect(seen!.headers.get("authorization")).toMatch(/^Ghost [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(post?.primary_tag?.name).toBe("Technology");
  });
  it("returns null on 404", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    expect(await ghostClient(envish, fetchImpl).getPost("p1")).toBeNull();
  });
  it("uploads multipart with file, purpose and ref", async () => {
    let form: FormData | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => { form = await new Request(input, init).formData();
      return Response.json({ images: [{ url: "https://werd.io/content/images/2026/10/og-p1.png", ref: "og-p1.png" }] }); }) as typeof fetch;
    const url = await ghostClient(envish, fetchImpl).uploadImage(new Uint8Array([0x89, 0x50]), "og-p1.png");
    expect(url).toBe("https://werd.io/content/images/2026/10/og-p1.png");
    expect((form!.get("file") as File).name).toBe("og-p1.png");
    expect((form!.get("file") as File).type).toBe("image/png");
    expect(form!.get("purpose")).toBe("image"); expect(form!.get("ref")).toBe("og-p1.png");
  });
  it("PUTs both image fields with updated_at and maps 409 to conflict", async () => {
    let body: any; let status = 200;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => { body = JSON.parse(await new Request(input, init).text()); return new Response("{}", { status }); }) as typeof fetch;
    const c = ghostClient(envish, fetchImpl);
    expect(await c.setSocialImages("p1", "https://i/og-p1.png", "u")).toBe("ok");
    expect(body).toEqual({ posts: [{ og_image: "https://i/og-p1.png", twitter_image: "https://i/og-p1.png", updated_at: "u" }] });
    status = 409;
    expect(await c.setSocialImages("p1", "https://i/og-p1.png", "u")).toBe("conflict");
  });
  it("throws GhostError with status and body on other failures", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await expect(ghostClient(envish, fetchImpl).getPost("p1")).rejects.toMatchObject({ status: 500, body: "boom" });
  });
});
