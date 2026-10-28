import { decide } from "../decide";
import { json } from "../http";
import { verifyGhostSignature } from "../signature";

export type HookDeps = { processPost: (id: string, env: Env) => Promise<void> };

export async function handleHook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  deps: HookDeps,
): Promise<Response> {
  const raw = await request.text();

  if (!env.GHOST_WEBHOOK_SECRET) {
    console.error("GHOST_WEBHOOK_SECRET not set");
    return json({ error: "unauthorized" }, 401);
  }
  const valid = await verifyGhostSignature(raw, request.headers.get("x-ghost-signature"), env.GHOST_WEBHOOK_SECRET);
  if (!valid) return json({ error: "unauthorized" }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { post, decision } = decide(payload);
  console.log(JSON.stringify({ route: "hook", id: post?.id, decision }));

  if (!post || decision.mode === "skip") {
    return json({ skipped: decision.mode === "skip" ? decision.reason : "no post" }, 200);
  }

  ctx.waitUntil(
    deps.processPost(post.id, env).catch((e) => console.error("processPost failed", post.id, e)),
  );
  return json({ queued: true, id: post.id, mode: decision.mode }, 202);
}
