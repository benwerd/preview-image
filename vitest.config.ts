import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          GHOST_ADMIN_API_KEY: "0123456789abcdef01234567:" + "ab".repeat(32),
          GHOST_WEBHOOK_SECRET: "test-webhook-secret",
          PREVIEW_TOKEN: "test-preview-token",
        },
      },
    }),
  ],
});
