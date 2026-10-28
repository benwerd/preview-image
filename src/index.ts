import { json } from "./http";
import { processPost } from "./job";
import { handleHook, type HookDeps } from "./routes/hook";
import { handlePreview } from "./routes/preview";

type Handler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;

export function createWorker(deps: HookDeps) {
  const routes: Record<string, Handler> = {
    "GET /preview": (request, env) => handlePreview(request, env),
    "POST /hook": (request, env, ctx) => handleHook(request, env, ctx, deps),
  };

  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const { pathname } = new URL(request.url);
      const handler = routes[`${request.method} ${pathname}`];
      if (handler) return handler(request, env, ctx);
      return json({ error: "not found" }, 404);
    },
  };
}

export default createWorker({ processPost });
