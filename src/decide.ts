export type GhostPost = {
  id: string;
  status: string;
  feature_image: string | null;
  og_image: string | null;
  title: string;
  custom_excerpt: string | null;
  updated_at: string;
  primary_tag?: { name: string } | null;
};

export type Decision = { mode: "create" | "refresh" } | { mode: "skip"; reason: string };

const CONTENT_KEYS = ["title", "custom_excerpt", "tags", "primary_tag"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function isOurImage(url: string | null | undefined, postId: string): boolean {
  if (!url) return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  return basename(path).startsWith(`og-${postId}`);
}

export function decide(payload: unknown): { post?: GhostPost; decision: Decision } {
  const post = isRecord(payload) && isRecord(payload.post) ? payload.post : undefined;
  const current = post?.current;
  if (!post || !isRecord(current) || typeof current.id !== "string") {
    return { decision: { mode: "skip", reason: "no post" } };
  }

  const p = current as unknown as GhostPost;
  const previous = isRecord(post.previous) ? post.previous : {};

  if (p.status !== "published") return { post: p, decision: { mode: "skip", reason: "not published" } };
  if (p.feature_image) return { post: p, decision: { mode: "skip", reason: "has feature image" } };
  if (!p.og_image) return { post: p, decision: { mode: "create" } };

  const changed = CONTENT_KEYS.some((key) => Object.hasOwn(previous, key));
  if (isOurImage(p.og_image, p.id) && changed) return { post: p, decision: { mode: "refresh" } };
  return { post: p, decision: { mode: "skip", reason: "og_image set" } };
}
