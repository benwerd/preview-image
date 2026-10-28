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
  if (typeof url !== "string" || !url) return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  return basename(path).startsWith(`og-${postId}`);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Any truthy non-string image value is kept as a (non-empty) string so it still counts as "set".
function image(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  return value ? String(value) : null;
}

function normalise(current: Record<string, unknown>, id: string): GhostPost {
  const tag = current.primary_tag;
  return {
    id,
    status: str(current.status),
    feature_image: image(current.feature_image),
    og_image: image(current.og_image),
    title: str(current.title),
    custom_excerpt: typeof current.custom_excerpt === "string" ? current.custom_excerpt : null,
    updated_at: str(current.updated_at),
    primary_tag: isRecord(tag) && typeof tag.name === "string" ? { name: tag.name } : null,
  };
}

export function decide(payload: unknown): { post?: GhostPost; decision: Decision } {
  const post = isRecord(payload) && isRecord(payload.post) ? payload.post : undefined;
  const current = post?.current;
  if (!post || !isRecord(current) || typeof current.id !== "string") {
    return { decision: { mode: "skip", reason: "no post" } };
  }

  const p = normalise(current, current.id);
  const previous = isRecord(post.previous) ? post.previous : {};

  if (p.status !== "published") return { post: p, decision: { mode: "skip", reason: "not published" } };
  if (p.feature_image) return { post: p, decision: { mode: "skip", reason: "has feature image" } };
  if (!p.og_image) return { post: p, decision: { mode: "create" } };

  const changed = CONTENT_KEYS.some((key) => Object.hasOwn(previous, key));
  if (isOurImage(p.og_image, p.id) && changed) return { post: p, decision: { mode: "refresh" } };
  return { post: p, decision: { mode: "skip", reason: "og_image set" } };
}
