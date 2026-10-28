import { renderCard } from "../card";
import { json } from "../index";
import { cleanText } from "../text";

function tokenMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export async function handlePreview(request: Request, env: Env): Promise<Response> {
  if (!env.PREVIEW_TOKEN) return json({ error: "not found" }, 404);

  const params = new URL(request.url).searchParams;
  if (!tokenMatches(params.get("token"), env.PREVIEW_TOKEN)) {
    return json({ error: "unauthorized" }, 401);
  }

  const title = cleanText(params.get("title"));
  if (!title) return json({ error: "title required" }, 400);

  const png = await renderCard({
    title,
    subtitle: cleanText(params.get("subtitle")) || undefined,
    label: cleanText(params.get("label")) || undefined,
  });

  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
