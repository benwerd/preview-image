// workers-types types `env` from "cloudflare:workers" as Cloudflare.Env, so the
// bindings are declared there and the global Env mirrors them for handler signatures.
declare namespace Cloudflare {
  interface Env {
    GHOST_ADMIN_API_URL: string;
    GHOST_ADMIN_API_KEY?: string;
    GHOST_WEBHOOK_SECRET?: string;
    PREVIEW_TOKEN?: string;
  }
}

interface Env extends Cloudflare.Env {}

declare module "*.woff" {
  const data: ArrayBuffer;
  export default data;
}

declare module "*.wasm" {
  const mod: WebAssembly.Module;
  export default mod;
}
