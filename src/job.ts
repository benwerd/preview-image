import { renderCard } from "./card";
import { isOurImage, type GhostPost } from "./decide";
import { ghostClient, GhostError, type FetchLike } from "./ghost";
import { cleanText, stripUnsupported } from "./text";

const log = (id: string, fields: Record<string, unknown>) =>
  console.log(JSON.stringify({ job: "processPost", id, ...fields }));

// A post is ours to touch when it is published, has no feature image, and its
// og_image is either unset or one we generated earlier.
function eligible(post: GhostPost): boolean {
  return post.status === "published" && !post.feature_image && (!post.og_image || isOurImage(post.og_image, post.id));
}

export async function processPost(id: string, env: Env, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    const ghost = ghostClient(env, fetchImpl);

    const post = await ghost.getPost(id);
    if (!post) return log(id, { skipped: "not found" });
    if (!eligible(post)) return log(id, { skipped: "not eligible" });

    const stripped = [
      ...stripUnsupported(post.title ?? "").stripped,
      ...stripUnsupported(post.custom_excerpt ?? "").stripped,
    ];
    if (stripped.length > 0) console.warn(JSON.stringify({ job: "processPost", id, stripped }));

    const png = await renderCard({
      title: cleanText(post.title),
      subtitle: cleanText(post.custom_excerpt),
      label: cleanText(post.primary_tag?.name),
    });
    const image = await ghost.uploadImage(png, `og-${id}.png`);

    let result = await ghost.setSocialImages(id, image, post.updated_at);
    if (result === "conflict") {
      const fresh = await ghost.getPost(id);
      if (!fresh || (fresh.og_image && !isOurImage(fresh.og_image, id))) {
        return log(id, { skipped: "changed during update" });
      }
      result = await ghost.setSocialImages(id, image, fresh.updated_at);
      if (result === "conflict") return log(id, { skipped: "conflict persisted" });
    }
    log(id, { image });
  } catch (err) {
    if (err instanceof GhostError) {
      console.error(JSON.stringify({ job: "processPost", id, error: err.message, status: err.status, body: err.body.slice(0, 2000) }));
    } else {
      console.error(JSON.stringify({ job: "processPost", id, error: err instanceof Error ? err.message : String(err) }));
    }
  }
}
