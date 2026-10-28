# Social Preview Image Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker that, when Ghost publishes or edits a post with no feature image, renders a branded 1200×630 PNG card from the title, excerpt and primary tag, uploads it to Ghost, and sets it as the post's `og_image` and `twitter_image`.

**Architecture:** One Worker with two routes. `POST /hook` verifies Ghost's HMAC signature over the raw body, decides from the webhook payload alone (create / refresh / skip), answers within milliseconds, and does the real work in `ctx.waitUntil()`. The background job re-fetches the post from the Ghost Admin API, lays the card out with satori (standalone WASM build), rasterises with resvg-wasm, uploads the PNG, and PUTs the two image fields. `GET /preview` renders a card from query parameters for design checks.

**Tech Stack:** Cloudflare Workers (Paid), Wrangler 4, TypeScript, `satori@0.12.2` pinned (`satori/wasm` + `yoga-wasm-web@0.3.3`; newer satori releases embed HarfBuzz WASM as base64 and compile it at runtime, which Workers forbid), `@resvg/resvg-wasm@2.6`, fonts from `@fontsource/inter` and `@fontsource/merriweather` (Latin WOFF subsets, committed into `src/fonts`), Vitest 4.1+ with `@cloudflare/vitest-plugin` (tests run inside workerd).

**Spec:** `docs/superpowers/specs/2026-10-27-og-image-design.md`

## Global Constraints

- Platform: Cloudflare Workers Paid plan; ES module Worker; `compatibility_date` ≥ `2026-10-01`.
- Ghost gives the webhook receiver 2 seconds and delivers each event once. Nothing on the `POST /hook` path may instantiate WASM, load fonts, or call Ghost before the response is returned. WASM instantiation never happens at module top level (Workers cap startup at 400 ms CPU).
- WebAssembly on Workers: `.wasm` files are imported as modules (`WebAssembly.Module`); `WebAssembly.instantiate` from bytes and `instantiateStreaming` are unavailable. Hence `satori/wasm` + `init(await initYoga(yogaWasm))` with `import yogaWasm from "yoga-wasm-web/dist/yoga.wasm"`, and `import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm"`. (Controller ruling during Task 2; see the SDD ledger.)
- Secrets (`GHOST_ADMIN_API_KEY`, `GHOST_WEBHOOK_SECRET`, `PREVIEW_TOKEN`) exist only in `wrangler secret` and the git-ignored `.dev.vars`. Nothing secret in any committed file.
- `GHOST_ADMIN_API_URL` = `https://werd-io.ghost.io` (a `[vars]` entry). Admin API base = `${GHOST_ADMIN_API_URL}/ghost/api/admin/`, header `Accept-Version: v5.0`, `Authorization: Ghost <jwt>`.
- Card: 1200×630, white background, masthead 110 px `#286c93`, horizontal padding 90 px, body padding 64 px top / 56 px bottom, text `#15171a`, excerpt `#4a4f57`. Exact type sizes in Task 5.
- Satori: inline styles only, flexbox subset. Text nodes that use `lineClamp` must contain no inline elements.
- `crypto.subtle.timingSafeEqual` throws on unequal lengths and does not exist in Node: compare lengths first, and run every test under the Cloudflare Vitest plugin.
- Never respond 410 to Ghost (it deletes the webhook).
- Every upload is named `og-<post id>.png`; "ours" means the basename of the `og_image` URL starts with `og-<post id>`.
- Commit after every task with a conventional-commit message. Do not commit `.dev.vars`, `node_modules`, `.wrangler/`, `.superpowers/`.

## Review Focus

Inputs the spec implies but no feature test covers by default; each has a pinned test in the task named.

1. A title that is one very long word (a URL pasted as a title) must still wrap or truncate, never overflow the 1020 px column. Task 5 (`fits a single 200-character word`).
2. A title or excerpt containing `&amp;`, `&#8217;`, `<em>` from Ghost must render as `&`, `’`, plain text. Task 4.
3. Ghost's own edit (our PUT) fires `post.published.edited` with `previous = { og_image, twitter_image, updated_at }`; this must be a skip, or the Worker loops. Task 7 (`skips the edit the Worker itself makes`).
4. A webhook body whose JSON has no `post.current` (Ghost's `site.changed` sent to the wrong URL by mistake) must 200-skip, not 500. Task 7 (`skips a payload without post.current`).
5. Ghost returns 409 on the PUT because the post was edited between our GET and PUT; the job must re-fetch once, and stop if `og_image` is now set. Task 8 (`retries the PUT once on 409`).

---

### Task 1: Project scaffold, Wrangler config, test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`, `.dev.vars.example`, `src/index.ts`, `src/env.d.ts`, `test/smoke.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Env` type in `src/env.d.ts`:
  ```ts
  interface Env {
    GHOST_ADMIN_API_URL: string;
    GHOST_ADMIN_API_KEY?: string;
    GHOST_WEBHOOK_SECRET?: string;
    PREVIEW_TOKEN?: string;
  }
  ```
  plus the ambient `declare module "cloudflare:workers" { interface ProvidedEnv extends Env {} }`.
- Produces: `export default { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }` in `src/index.ts`, returning 404 `{ "error": "not found" }` for every route until later tasks fill them in.

- [ ] **Step 1: Initialise the npm project and install dependencies**

```bash
npm init -y
npm i satori@^0.63.2 @resvg/resvg-wasm@^2.6.2
npm i -D wrangler@^4 typescript @cloudflare/workers-types vitest@^4.1 @cloudflare/vitest-plugin
```

Set `"type": "module"`, `"private": true`, and scripts: `"dev": "wrangler dev"`, `"deploy": "wrangler deploy"`, `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "tsc --noEmit"`.

- [ ] **Step 2: Write `.gitignore`**

Replace the file's contents with:

```
.idea
node_modules
.wrangler
.dev.vars
.superpowers
dist
```

- [ ] **Step 3: Write `wrangler.toml`**

```toml
name = "werd-og-image"
main = "src/index.ts"
compatibility_date = "2026-10-01"

[vars]
GHOST_ADMIN_API_URL = "https://werd-io.ghost.io"

[observability]
enabled = true

[[rules]]
type = "Data"
globs = ["**/*.woff"]
fallthrough = true
```

- [ ] **Step 4: Write `tsconfig.json`**

`target`/`module` `ES2022`, `moduleResolution` `Bundler`, `strict` true, `noEmit` true, `types: ["@cloudflare/workers-types/2023-07-01"]`, `include: ["src", "test", "vitest.config.ts"]`. Add `src/env.d.ts` with the `Env` interface and the `cloudflare:workers` augmentation from Interfaces above, and declarations so TypeScript accepts the binary imports:

```ts
declare module "*.woff" { const data: ArrayBuffer; export default data; }
declare module "*.wasm" { const mod: WebAssembly.Module; export default mod; }
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
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
```

These are test-only values; they never touch Ghost.

- [ ] **Step 6: Write `.dev.vars.example`**

```
GHOST_ADMIN_API_KEY=<id>:<secret from Ghost admin → Integrations>
GHOST_WEBHOOK_SECRET=<long random string; paste the same into both Ghost webhooks>
PREVIEW_TOKEN=<long random string>
```

- [ ] **Step 7: Write the failing smoke test `test/smoke.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("worker", () => {
  it("returns 404 JSON for unknown routes", async () => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request("https://og.test/nope"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("exposes the Ghost URL var and test secrets", () => {
    expect(env.GHOST_ADMIN_API_URL).toBe("https://werd-io.ghost.io");
    expect(env.GHOST_WEBHOOK_SECRET).toBe("test-webhook-secret");
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run`
Expected: FAIL (cannot resolve `../src/index`).

- [ ] **Step 9: Implement `src/index.ts`**

`export default { async fetch(request, env, ctx) { return json({ error: "not found" }, 404); } }` with a small `json(body: unknown, status = 200): Response` helper (`Content-Type: application/json`). Keep `json` exported; later tasks reuse it.

- [ ] **Step 10: Run tests and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 2 tests PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml vitest.config.ts .dev.vars.example .gitignore src test
git commit -m "chore: scaffold Cloudflare Worker with Vitest in workerd"
```

---

### Task 2: Fonts and WASM load inside the Worker

**Files:**
- Create: `src/fonts/inter-latin-700-normal.woff`, `src/fonts/inter-latin-800-normal.woff`, `src/fonts/merriweather-latin-400-normal.woff`, `src/fonts/LICENSE-Inter.txt`, `src/fonts/LICENSE-Merriweather.txt`, `src/render.ts`, `test/render.test.ts`

**Interfaces:**
- Produces: in `src/render.ts`:
  ```ts
  export type SatoriElement = { type: string; key?: string; props: Record<string, unknown> }; // key is on the element, as in React, not in props
  export const FONTS: { name: string; weight: 400 | 700 | 800; data: ArrayBuffer }[]; // Inter 700, Inter 800, Merriweather 400
  export async function ensureEngines(): Promise<void>;         // idempotent; instantiates satori layout + resvg once, cached in module scope
  export async function layoutToSvg(el: SatoriElement, onNode?: (n: { key?: string | number; height: number; width: number }) => void): Promise<string>;
  export async function svgToPng(svg: string): Promise<Uint8Array>;
  ```

- [ ] **Step 1: Vendor the fonts**

```bash
cd "$(mktemp -d)" && npm pack @fontsource/inter@5 @fontsource/merriweather@5 --silent
for t in *.tgz; do mkdir -p "${t%.tgz}" && tar -xzf "$t" -C "${t%.tgz}"; done
cp fontsource-inter-*/package/files/inter-latin-700-normal.woff fontsource-inter-*/package/files/inter-latin-800-normal.woff fontsource-merriweather-*/package/files/merriweather-latin-400-normal.woff /Users/ben/code/preview-image/src/fonts/
cp fontsource-inter-*/package/LICENSE /Users/ben/code/preview-image/src/fonts/LICENSE-Inter.txt
cp fontsource-merriweather-*/package/LICENSE /Users/ben/code/preview-image/src/fonts/LICENSE-Merriweather.txt
```

Both are OFL-1.1. The Google "latin" subset includes U+2000–206F (curly quotes, dashes, ellipsis).

- [ ] **Step 2: Write the failing test `test/render.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ensureEngines, layoutToSvg, svgToPng, FONTS } from "../src/render";

describe("render engines", () => {
  it("loads three fonts as ArrayBuffers", () => {
    expect(FONTS.map((f) => `${f.name}-${f.weight}`)).toEqual(["Inter-700", "Inter-800", "Merriweather-400"]);
    for (const f of FONTS) expect(f.data.byteLength).toBeGreaterThan(10_000);
  });

  it("lays out text and reports node sizes", async () => {
    await ensureEngines();
    const seen: Record<string, number> = {};
    const svg = await layoutToSvg(
      { type: "div", props: { style: { display: "flex", width: 1200, height: 630 },
        children: { type: "div", key: "t", props: { style: { fontFamily: "Inter", fontWeight: 800, fontSize: 64 }, children: "Hello" } } } },
      (n) => { if (n.key) seen[String(n.key)] = n.height; },
    );
    expect(svg).toMatch(/^<svg/);
    expect(seen.t).toBeGreaterThan(60);
  });

  it("rasterises an SVG to a 1200×630 PNG", async () => {
    await ensureEngines();
    const png = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#fff"/></svg>');
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(1200); // IHDR width
    expect(view.getUint32(20)).toBe(630);  // IHDR height
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/render.test.ts`
Expected: FAIL (module `../src/render` not found).

- [ ] **Step 4: Implement `src/render.ts`**

Static imports: the three `.woff` files, `layoutWasm from "satori/layout.wasm"`, `resvgWasm from "@resvg/resvg-wasm/index_bg.wasm"`, `satori, { init as initSatori } from "satori/standalone"`, `{ initWasm, Resvg } from "@resvg/resvg-wasm"`. `ensureEngines()` stores a single `Promise<void>` in module scope that runs `initSatori(layoutWasm)` and `initWasm(resvgWasm)`; a second call returns the same promise. `layoutToSvg` calls `satori(el, { width: 1200, height: 630, fonts: FONTS, onNodeDetected })` after `ensureEngines()`. `svgToPng` does `new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng()`.

If Wrangler refuses the `.wasm` import from `node_modules`, add a `[[rules]]` entry `type = "CompiledWasm"`, `globs = ["**/*.wasm"]`, `fallthrough = true` to `wrangler.toml`; if it still fails, copy the two `.wasm` files into `src/wasm/` with a `postinstall` script and import from there.

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/render.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/fonts src/render.ts test/render.test.ts wrangler.toml package.json
git commit -m "feat: load fonts and satori/resvg WASM engines inside the Worker"
```

---

### Task 3: Ghost webhook signature verification

**Files:**
- Create: `src/signature.ts`, `test/signature.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function signGhostWebhook(rawBody: string, secret: string, timestampMs: number): Promise<string>; // "sha256=<hex>, t=<ts>" exactly as Ghost builds it
  export async function verifyGhostSignature(rawBody: string, header: string | null, secret: string, nowMs?: number): Promise<boolean>;
  ```
  Ghost computes `hex(HMAC-SHA256(secret, rawBody + String(ts)))`.

- [ ] **Step 1: Write the failing tests `test/signature.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { signGhostWebhook, verifyGhostSignature } from "../src/signature";

const body = JSON.stringify({ post: { current: { id: "abc" } } });
const secret = "s3cret";
const now = 1_761_600_000_000;

describe("Ghost webhook signature", () => {
  it("accepts a signature Ghost would produce", async () => {
    const header = await signGhostWebhook(body, secret, now - 1000);
    expect(header).toMatch(/^sha256=[0-9a-f]{64}, t=\d+$/);
    expect(await verifyGhostSignature(body, header, secret, now)).toBe(true);
  });
  it("rejects a wrong secret", async () => {
    const header = await signGhostWebhook(body, "other", now);
    expect(await verifyGhostSignature(body, header, secret, now)).toBe(false);
  });
  it("rejects a tampered body", async () => {
    const header = await signGhostWebhook(body, secret, now);
    expect(await verifyGhostSignature(body + " ", header, secret, now)).toBe(false);
  });
  it("rejects a timestamp older than 5 minutes", async () => {
    const header = await signGhostWebhook(body, secret, now - 6 * 60_000);
    expect(await verifyGhostSignature(body, header, secret, now)).toBe(false);
  });
  it("rejects missing or malformed headers without throwing", async () => {
    expect(await verifyGhostSignature(body, null, secret, now)).toBe(false);
    expect(await verifyGhostSignature(body, "sha256=abc", secret, now)).toBe(false);
    expect(await verifyGhostSignature(body, "sha256=zz, t=1", secret, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/signature.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/signature.ts`**

Parse the header with `/^sha256=([0-9a-f]{64}),\s*t=(\d+)$/`. HMAC via `crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])` and `crypto.subtle.sign`. Compare the two hex digests as `Uint8Array`s with `crypto.subtle.timingSafeEqual` only when lengths match. Window: `Math.abs(nowMs - ts) <= 5 * 60_000`. `nowMs` defaults to `Date.now()`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/signature.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/signature.ts test/signature.test.ts
git commit -m "feat: verify Ghost webhook signatures with WebCrypto"
```

---

### Task 4: Text sanitising

**Files:**
- Create: `src/text.ts`, `test/text.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function cleanText(input: string | null | undefined): string; // "" when nothing usable
  export function stripUnsupported(input: string): { text: string; stripped: string[] };
  ```
  `cleanText` = strip tags → decode entities → collapse whitespace → trim → `stripUnsupported().text`.

- [ ] **Step 1: Write the failing tests `test/text.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { cleanText, stripUnsupported } from "../src/text";

describe("cleanText", () => {
  it("decodes entities Ghost emits", () => {
    expect(cleanText("Tom &amp; Jerry&#8217;s &quot;day&quot; &ndash; now")).toBe('Tom & Jerry’s "day" – now');
  });
  it("strips tags and collapses whitespace", () => {
    expect(cleanText("  <em>Solar</em> is\n\n  cheap ")).toBe("Solar is cheap");
  });
  it("returns empty string for null, undefined and whitespace", () => {
    expect(cleanText(null)).toBe(""); expect(cleanText(undefined)).toBe(""); expect(cleanText("  \n ")).toBe("");
  });
  it("keeps curly quotes, dashes and ellipsis", () => {
    expect(cleanText("“Quoted” — yes… – no")).toBe("“Quoted” — yes… – no");
  });
});

describe("stripUnsupported", () => {
  it("removes emoji and CJK and reports them", () => {
    const r = stripUnsupported("Hello 🌍 world 日本");
    expect(r.text).toBe("Hello world");
    expect(r.stripped).toEqual(["🌍", "日", "本"]);
  });
  it("keeps Latin-1 letters", () => {
    expect(stripUnsupported("café naïve Ærø").stripped).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/text.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/text.ts`**

Entity decoding: a small table for the named entities Ghost actually emits (`amp lt gt quot apos nbsp ndash mdash hellip lsquo rsquo ldquo rdquo`) plus numeric `&#NNN;` and `&#xHH;`. Supported characters: code points in U+0020–U+00FF, U+0152–U+0153, U+2010–U+2027, U+2030–U+203A, U+20AC, U+2122; everything else is stripped (collect each stripped grapheme via `Intl.Segmenter("en", { granularity: "grapheme" })`), then collapse the whitespace left behind.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/text.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/text.ts test/text.test.ts
git commit -m "feat: sanitise Ghost titles and excerpts for rendering"
```

---

### Task 5: Card layout and fitting

**Files:**
- Create: `src/card.ts`, `test/card.test.ts`

**Interfaces:**
- Consumes: `layoutToSvg`, `svgToPng`, `SatoriElement` from Task 2.
- Produces:
  ```ts
  export type CardInput = { title: string; subtitle?: string; label?: string }; // already cleaned
  export type Fit = { titleSize: number; subtitleSize: number; titleLines: number; titleClamp: number };
  export const LAYOUT = { W: 1200, H: 630, MASTHEAD_H: 110, PAD_X: 90, BODY_PAD_TOP: 64, BODY_PAD_BOTTOM: 56, AVAIL_H: 400, GAP: 28,
    TITLE_LH: 1.12, SUB_LH: 1.45, TITLE_SIZES: [64, 60, 56, 52, 48, 44], TITLE_BIG: 76, SUB_DEFAULT: 30, SUB_MIN: 24, SUB_LINES: 2 } as const;
  export function cardElement(input: CardInput, fit: Fit, clamp: boolean): SatoriElement;
  export async function fitCard(input: CardInput): Promise<Fit>;
  export async function renderCard(input: CardInput): Promise<Uint8Array>; // PNG
  ```

Fitting algorithm (the one piece the signature does not determine):

1. Candidate sizes in order: `TITLE_BIG` (76), then `TITLE_SIZES`.
2. For each candidate: `subtitleSize = clamp(round(titleSize * 30 / 64), SUB_MIN, SUB_DEFAULT)`. Lay out `cardElement(input, fit, clamp=false)` with `onNode` capturing the heights of nodes keyed `"title"` and `"subtitle"`. `titleLines = round(titleHeight / (titleSize * TITLE_LH))`.
3. Accept 76 only when `titleLines <= 2`. Accept any other size when `titleHeight + (subtitle ? GAP + min(subtitleHeight, 2 * subtitleSize * SUB_LH) : 0) <= AVAIL_H`.
4. If none fits, use 44 with `titleClamp = floor((AVAIL_H - (subtitle ? GAP + 2 * subtitleSize * SUB_LH : 0)) / (44 * TITLE_LH))`. Otherwise `titleClamp = titleLines`.
5. `renderCard` = `fitCard` then `layoutToSvg(cardElement(input, fit, clamp=true))` then `svgToPng`. With `clamp=true` the title node gets `lineClamp: fit.titleClamp` and the subtitle node `lineClamp: 2` (satori adds the ellipsis).

`cardElement` tree: root `div` flex column 1200×630 white; masthead `div` flex row, `height: 110`, `backgroundColor: "#286c93"`, `padding: "0 90px"`, `alignItems: "center"`, `justifyContent: "space-between"`, children: `div` "Ben Werdmuller" (Inter 700, 34 px, white) and, only when `label` is non-empty, `div` label (Merriweather 400, 24 px, `rgba(255,255,255,0.85)`); body `div` flex column, `flexGrow: 1`, `padding: "64px 90px 56px"`, `justifyContent: "center"`, children: title `div` (element `key: "title"`, Inter 800, `fontSize: fit.titleSize`, `lineHeight: 1.12`, `letterSpacing: "-0.02em"`, `color: "#15171a"`) and, when subtitle is non-empty, subtitle `div` (element `key: "subtitle"`, Merriweather 400, `fontSize: fit.subtitleSize`, `lineHeight: 1.45`, `color: "#4a4f57"`, `marginTop: 28`). Every `div` carries `display: "flex"` (satori requires it on multi-child containers; text leaves are single-child).

- [ ] **Step 1: Write the failing tests `test/card.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fitCard, renderCard, LAYOUT } from "../src/card";

const typical = { title: 'Solar is "offensively cheap". To live up to its promise, it also needs to be equitable.',
  subtitle: "This year, solar will represent 10% of power generation. Abundant, clean energy is great news – but there's more work to do to make sure every community benefits.", label: "Technology" };

describe("fitCard", () => {
  it("uses the large size for a short title", async () => {
    const f = await fitCard({ title: "Current Affairs says it's banning AI", subtitle: "Current Affairs has enshrined tough restrictions on publishing using generative AI into its union contract." });
    expect(f.titleSize).toBe(76); expect(f.titleLines).toBeLessThanOrEqual(2); expect(f.subtitleSize).toBe(30);
  });
  it("uses the default size for a typical title", async () => {
    const f = await fitCard(typical);
    expect(f.titleSize).toBe(64); expect(f.titleLines).toBe(3);
  });
  it("steps down for a very long title and still fits", async () => {
    const f = await fitCard({ title: "Foursquare died at the hands of private equity, and the story of how it got there says something about what happens to every community platform that takes the money. What happens next?", subtitle: typical.subtitle });
    expect(f.titleSize).toBeLessThan(64); expect(f.titleSize).toBeGreaterThanOrEqual(44);
    expect(f.titleLines * f.titleSize * LAYOUT.TITLE_LH + LAYOUT.GAP + 2 * f.subtitleSize * LAYOUT.SUB_LH).toBeLessThanOrEqual(LAYOUT.AVAIL_H + 1);
  });
  it("centres a title with no subtitle at the large size", async () => {
    const f = await fitCard({ title: "Young people trust AI more than the people in their lives." });
    expect(f.titleSize).toBe(76); expect(f.subtitleSize).toBe(30);
  });
  it("fits a single 200-character word by clamping at the floor", async () => {
    const f = await fitCard({ title: "x".repeat(200), subtitle: "s" });
    expect(f.titleSize).toBe(44); expect(f.titleClamp).toBeGreaterThanOrEqual(1);
  });
});

describe("renderCard", () => {
  it("produces a 1200×630 PNG for every approved case", async () => {
    for (const input of [typical, { title: "Short", subtitle: "" }, { title: "No label here", label: "" }]) {
      const png = await renderCard(input);
      const v = new DataView(png.buffer, png.byteOffset);
      expect(v.getUint32(16)).toBe(1200); expect(v.getUint32(20)).toBe(630);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/card.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/card.ts`** per the Interfaces block and the algorithm above.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/card.test.ts`
Expected: 6 tests PASS. If the "typical" case lands on 60 rather than 64 because satori's line-breaking differs from the browser mockup, adjust the assertion to `toBeGreaterThanOrEqual(60)` and note it in the commit message; do not change the layout constants.

- [ ] **Step 5: Commit**

```bash
git add src/card.ts test/card.test.ts
git commit -m "feat: masthead card layout with size fitting and line clamping"
```

---

### Task 6: `GET /preview` route and visual check

**Files:**
- Modify: `src/index.ts`
- Create: `src/routes/preview.ts`, `test/preview.test.ts`

**Interfaces:**
- Consumes: `renderCard` (Task 5), `cleanText` (Task 4), `json` (Task 1).
- Produces: `export async function handlePreview(request: Request, env: Env): Promise<Response>` in `src/routes/preview.ts`; `src/index.ts` dispatches `GET /preview` to it.

- [ ] **Step 1: Write the failing tests `test/preview.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const call = async (qs: string, e = env) => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://og.test/preview?${qs}`), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

describe("GET /preview", () => {
  it("returns a PNG when the token is right", async () => {
    const res = await call("token=test-preview-token&title=Hello&subtitle=World&label=Technology");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new Uint8Array(await res.arrayBuffer())[0]).toBe(0x89);
  });
  it("401s on a wrong or missing token", async () => {
    expect((await call("token=nope&title=Hello")).status).toBe(401);
    expect((await call("title=Hello")).status).toBe(401);
  });
  it("400s without a title", async () => {
    expect((await call("token=test-preview-token")).status).toBe(400);
  });
  it("404s when PREVIEW_TOKEN is not configured", async () => {
    expect((await call("token=x&title=Hello", { ...env, PREVIEW_TOKEN: undefined })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/preview.test.ts`
Expected: FAIL (401/404 tests fail because everything is 404; PNG test fails).

- [ ] **Step 3: Implement `src/routes/preview.ts` and the dispatch in `src/index.ts`**

Token comparison: encode both as UTF-8, length-check, then `crypto.subtle.timingSafeEqual`. `title` through `cleanText`; empty → 400 `{ "error": "title required" }`. `subtitle` and `label` optional, also cleaned. Response headers `Content-Type: image/png`, `Cache-Control: no-store`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: all tests PASS.

- [ ] **Step 5: Visual check against the mockups**

Create `.dev.vars` from the example with any throwaway values (it is git-ignored), then in one terminal `npx wrangler dev --port 8787`, and in another:

```bash
D=/private/tmp/claude-501/-Users-ben-code-preview-image/eac57ba6-14cf-4284-98c6-98dfba10bfc2/scratchpad/cards; mkdir -p "$D"; T=$(grep PREVIEW_TOKEN .dev.vars | cut -d= -f2)
curl -sG "http://localhost:8787/preview" --data-urlencode "token=$T" --data-urlencode "label=Technology" --data-urlencode "title=Current Affairs says it's banning AI" --data-urlencode "subtitle=Current Affairs has enshrined tough restrictions on publishing using generative AI into its union contract." -o "$D/short.png"
curl -sG "http://localhost:8787/preview" --data-urlencode "token=$T" --data-urlencode "label=Technology" --data-urlencode "title=Solar is \"offensively cheap\". To live up to its promise, it also needs to be equitable." --data-urlencode "subtitle=This year, solar will represent 10% of power generation. Abundant, clean energy is great news – but there's more work to do to make sure every community benefits." -o "$D/typical.png"
curl -sG "http://localhost:8787/preview" --data-urlencode "token=$T" --data-urlencode "label=Business" --data-urlencode "title=Foursquare died at the hands of private equity, and the story of how it got there says something about what happens to every community platform that takes the money. What happens next?" --data-urlencode "subtitle=Foursquare has come to an end at the hands of private equity. There's a pattern here that's worth paying attention to, and it isn't a happy one for anyone who cares about the open web." -o "$D/long.png"
curl -sG "http://localhost:8787/preview" --data-urlencode "token=$T" --data-urlencode "label=AI" --data-urlencode "title=Young people trust AI more than the people in their lives." -o "$D/nosub.png"
```

Open the four PNGs and compare with `.superpowers/brainstorm/92405-1793116814/content/masthead-lengths.html`. Expected: masthead bar with name left and label right, title and subtitle centred in the white body, no clipped text, ellipsis on the long case. Adjust only `src/card.ts` styling if something is visibly off, re-run tests.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/routes/preview.ts test/preview.test.ts
git commit -m "feat: GET /preview renders a card without touching Ghost"
```

---

### Task 7: `POST /hook` decision and response

**Files:**
- Create: `src/decide.ts`, `src/routes/hook.ts`, `test/decide.test.ts`, `test/hook.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `verifyGhostSignature`, `signGhostWebhook` (Task 3, the latter in tests), `json` (Task 1).
- Produces:
  ```ts
  // src/decide.ts
  export type GhostPost = { id: string; status: string; feature_image: string | null; og_image: string | null; title: string; custom_excerpt: string | null; updated_at: string; primary_tag?: { name: string } | null };
  export type Decision = { mode: "create" | "refresh" } | { mode: "skip"; reason: string };
  export function isOurImage(url: string | null | undefined, postId: string): boolean;
  export function decide(payload: unknown): { post?: GhostPost; decision: Decision };
  // src/routes/hook.ts
  export type HookDeps = { processPost: (id: string, env: Env) => Promise<void> };
  export async function handleHook(request: Request, env: Env, ctx: ExecutionContext, deps: HookDeps): Promise<Response>;
  ```
  `src/index.ts` dispatches `POST /hook` to `handleHook` with the real `processPost` (Task 8) and exports `createWorker(deps: HookDeps)` so tests can inject a stub.

Decision table, in order: no `post.current` → skip `"no post"`; `status !== "published"` → skip `"not published"`; `feature_image` → skip `"has feature image"`; no `og_image` → create; `isOurImage(og_image, id)` and `previous` has own property `title` or `custom_excerpt` or `tags` or `primary_tag` → refresh; else skip `"og_image set"`. `isOurImage`: basename of the URL path (after the last `/`) starts with `og-${postId}`.

- [ ] **Step 1: Write the failing tests `test/decide.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { decide, isOurImage } from "../src/decide";

const base = { id: "p1", status: "published", feature_image: null, og_image: null, title: "T", custom_excerpt: "E", updated_at: "2026-10-27T00:00:00.000Z" };
const wrap = (current: object, previous: object = {}) => ({ post: { current, previous } });

describe("decide", () => {
  it("skips a payload without post.current", () => expect(decide({ site: {} }).decision).toEqual({ mode: "skip", reason: "no post" }));
  it("skips drafts", () => expect(decide(wrap({ ...base, status: "draft" })).decision.mode).toBe("skip"));
  it("skips posts with a feature image", () => expect(decide(wrap({ ...base, feature_image: "https://x/y.jpg" })).decision.mode).toBe("skip"));
  it("creates when og_image is empty", () => expect(decide(wrap(base)).decision).toEqual({ mode: "create" }));
  it("refreshes our image when the title changed", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/og-p1.png" }, { title: "Old" })).decision).toEqual({ mode: "refresh" }));
  it("refreshes our image (with Ghost's numeric suffix) when the excerpt changed", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/og-p1-1.png" }, { custom_excerpt: "Old" })).decision).toEqual({ mode: "refresh" }));
  it("skips the edit the Worker itself makes", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/og-p1.png" }, { og_image: null, twitter_image: null, updated_at: "x" })).decision.mode).toBe("skip"));
  it("never touches a hand-set image", () =>
    expect(decide(wrap({ ...base, og_image: "https://werd.io/content/images/2026/10/photo.png" }, { title: "Old" })).decision.mode).toBe("skip"));
});

describe("isOurImage", () => {
  it("matches by basename prefix only", () => {
    expect(isOurImage("https://a/b/og-p1.png", "p1")).toBe(true);
    expect(isOurImage("https://a/og-p1/photo.png", "p1")).toBe(false);
    expect(isOurImage(null, "p1")).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing tests `test/hook.test.ts`**

```ts
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { createWorker } from "../src/index";
import { signGhostWebhook } from "../src/signature";

const post = { id: "p1", status: "published", feature_image: null, og_image: null, title: "T", custom_excerpt: "E", updated_at: "2026-10-27T00:00:00.000Z" };

async function post_(body: string, sign = true, e = env) {
  const processPost = vi.fn(async () => {});
  const worker = createWorker({ processPost });
  const headers = new Headers({ "content-type": "application/json" });
  if (sign) headers.set("x-ghost-signature", await signGhostWebhook(body, e.GHOST_WEBHOOK_SECRET!, Date.now()));
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request("https://og.test/hook", { method: "POST", body, headers }), e, ctx);
  await waitOnExecutionContext(ctx);
  return { res, processPost };
}

describe("POST /hook", () => {
  it("401s an unsigned request", async () => {
    const { res, processPost } = await post_(JSON.stringify({ post: { current: post, previous: {} } }), false);
    expect(res.status).toBe(401); expect(processPost).not.toHaveBeenCalled();
  });
  it("queues exactly one job for an eligible post and answers 202", async () => {
    const { res, processPost } = await post_(JSON.stringify({ post: { current: post, previous: {} } }));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true, id: "p1", mode: "create" });
    expect(processPost).toHaveBeenCalledTimes(1);
    expect(processPost).toHaveBeenCalledWith("p1", expect.anything());
  });
  it("200-skips a post with a feature image", async () => {
    const { res, processPost } = await post_(JSON.stringify({ post: { current: { ...post, feature_image: "https://x/y.jpg" }, previous: {} } }));
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ skipped: "has feature image" }); expect(processPost).not.toHaveBeenCalled();
  });
  it("refuses everything when no secret is configured", async () => {
    const { res } = await post_(JSON.stringify({ post: { current: post, previous: {} } }), true, { ...env, GHOST_WEBHOOK_SECRET: undefined });
    expect(res.status).toBe(401);
  });
  it("400s on a non-JSON body that is correctly signed", async () => {
    const { res } = await post_("not json");
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/decide.test.ts test/hook.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/decide.ts`, `src/routes/hook.ts`, and `createWorker` in `src/index.ts`**

`handleHook`: `const raw = await request.text()`; if `!env.GHOST_WEBHOOK_SECRET` → `console.error("GHOST_WEBHOOK_SECRET not set")` and 401; verify; `JSON.parse` in try/catch → 400; `decide`; skip → 200 `{ skipped }`; else `ctx.waitUntil(deps.processPost(post.id, env).catch(e => console.error("processPost failed", post.id, e)))` and 202 `{ queued: true, id, mode }`. The default export is `createWorker({ processPost })` where `processPost` is imported from `src/job.ts` (Task 8); until Task 8 exists, import a placeholder from `src/job.ts` that throws `"not implemented"`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/decide.ts src/routes/hook.ts src/index.ts src/job.ts test/decide.test.ts test/hook.test.ts
git commit -m "feat: POST /hook verifies, decides and queues background work"
```

---

### Task 8: Ghost Admin API client and the background job

**Files:**
- Create: `src/ghost.ts`, `src/job.ts` (replace placeholder), `test/ghost.test.ts`, `test/job.test.ts`

**Interfaces:**
- Consumes: `renderCard` (Task 5), `cleanText` (Task 4), `GhostPost`, `isOurImage` (Task 7).
- Produces:
  ```ts
  // src/ghost.ts
  export type FetchLike = typeof fetch;
  export async function adminJwt(key: string, nowSeconds?: number): Promise<string>;
  export function ghostClient(env: Pick<Env, "GHOST_ADMIN_API_URL" | "GHOST_ADMIN_API_KEY">, fetchImpl?: FetchLike): {
    getPost(id: string): Promise<GhostPost | null>;                       // GET posts/{id}/?include=tags ; null on 404
    uploadImage(png: Uint8Array, filename: string): Promise<string>;      // POST images/upload/ ; returns images[0].url
    setSocialImages(id: string, url: string, updatedAt: string): Promise<"ok" | "conflict">; // PUT posts/{id}/ ; 409 → "conflict"
  };
  export class GhostError extends Error { status: number; body: string; }
  // src/job.ts
  export async function processPost(id: string, env: Env, fetchImpl?: FetchLike): Promise<void>;
  ```
  JWT: header `{ alg: "HS256", typ: "JWT", kid: <key id> }`, payload `{ iat, exp: iat + 300, aud: "/admin/" }`, secret = hex-decoded second half of the key, base64url without padding. Every request carries `Accept-Version: v5.0` and `Authorization: Ghost <jwt>`. Upload body: `FormData` with `file` = `new Blob([png], { type: "image/png" })` under `filename`, `purpose` = `"image"`, `ref` = `filename`. PUT body `{ posts: [{ og_image: url, twitter_image: url, updated_at: updatedAt }] }`.

  `processPost(id)`: `getPost` → null: log, return. Re-check: `status === "published"`, no `feature_image`, and (`!og_image` or `isOurImage`) else log skip, return. `renderCard({ title: cleanText(title), subtitle: cleanText(custom_excerpt), label: cleanText(primary_tag?.name) })`; before that, run `stripUnsupported` on the raw title and excerpt and `console.warn({ id, stripped })` when the list is non-empty. `uploadImage(png, \`og-${id}.png\`)`. `setSocialImages` → `"conflict"`: `getPost` again; if its `og_image` is set and not ours, stop; otherwise retry `setSocialImages` once with the new `updated_at`. Log `{ id, image }` on success. Any `GhostError` → `console.error` with status and body, return.

- [ ] **Step 1: Write the failing tests `test/ghost.test.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing tests `test/job.test.ts`**

Build a scripted `fetchImpl` that routes by method and path and records calls:

```ts
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { processPost } from "../src/job";

const post = (over: object = {}) => ({ id: "p1", status: "published", feature_image: null, og_image: null, title: "Tom &amp; Jerry", custom_excerpt: "E", updated_at: "u1", primary_tag: { name: "Technology" }, ...over });

function ghostStub(script: { gets: object[]; putStatuses: number[] }) {
  const calls: { method: string; path: string; body?: any }[] = [];
  let g = 0, p = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init); const path = new URL(req.url).pathname;
    if (req.method === "GET") { calls.push({ method: "GET", path }); return Response.json({ posts: [script.gets[g++]] }); }
    if (path.endsWith("/images/upload/")) { calls.push({ method: "POST", path }); return Response.json({ images: [{ url: "https://werd.io/content/images/2026/10/og-p1.png" }] }); }
    calls.push({ method: "PUT", path, body: JSON.parse(await req.text()) }); return new Response("{}", { status: script.putStatuses[p++] ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("processPost", () => {
  it("renders, uploads and sets both images once", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post()], putStatuses: [200] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PUT"]);
    expect(calls[2].body.posts[0]).toEqual({ og_image: "https://werd.io/content/images/2026/10/og-p1.png", twitter_image: "https://werd.io/content/images/2026/10/og-p1.png", updated_at: "u1" });
  });
  it("skips when the fresh copy has a hand-set og_image", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post({ og_image: "https://werd.io/content/images/photo.png" })], putStatuses: [] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });
  it("retries the PUT once on 409 with the fresh updated_at", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post(), post({ updated_at: "u2" })], putStatuses: [409, 200] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PUT", "GET", "PUT"]);
    expect(calls[4].body.posts[0].updated_at).toBe("u2");
  });
  it("gives up after 409 if someone set a foreign og_image meanwhile", async () => {
    const { fetchImpl, calls } = ghostStub({ gets: [post(), post({ og_image: "https://werd.io/content/images/photo.png", updated_at: "u2" })], putStatuses: [409] });
    await processPost("p1", env, fetchImpl);
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "PUT", "GET"]);
  });
  it("does not throw on a Ghost 500", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    await expect(processPost("p1", env, fetchImpl)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/ghost.test.ts test/job.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement `src/ghost.ts` and `src/job.ts`** per the Interfaces block. Replace the Task 7 placeholder; `src/index.ts`'s default export now uses the real `processPost`.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/ghost.ts src/job.ts src/index.ts test/ghost.test.ts test/job.test.ts
git commit -m "feat: Ghost Admin API client and background render/upload/update job"
```

---

### Task 9: README, deploy, end-to-end check

**Files:**
- Create: `README.md`
- Modify: `wrangler.toml` (only if the deploy reveals a needed rule or limit)

**Interfaces:**
- Consumes: everything above. Produces the running Worker and the operator documentation.

- [ ] **Step 1: Write `README.md`**

Sections, in this order, each short and concrete:

1. What it does (three sentences) and the spec link.
2. Prerequisites: Node 20+, `npm i`, `npx wrangler login`, Workers Paid plan.
3. Ghost setup: Settings → Integrations → Add custom integration (name it "Social preview images"); copy the Admin API key; Add webhook twice with the same Secret: event `Post published` → `https://<worker-host>/hook`, and event `Published post updated` → same URL. (Ghost's UI labels for `post.published` and `post.published.edited`.) Note the API URL field shows `https://werd-io.ghost.io`.
4. Secrets: `npx wrangler secret put GHOST_ADMIN_API_KEY`, `… GHOST_WEBHOOK_SECRET`, `… PREVIEW_TOKEN`; generate the two random ones with `openssl rand -hex 32`. Local: copy `.dev.vars.example` to `.dev.vars`.
5. Deploy: `npm run deploy`; the printed `*.workers.dev` URL is `<worker-host>`; optional custom domain via `routes` in `wrangler.toml`.
6. Zapier: add a Delay by Zapier step of 1–2 minutes between the Ghost publish step and the share steps, and why.
7. Preview: the `curl -G … /preview` form with `--data-urlencode` for `token`, `title`, `subtitle`, `label`.
8. End-to-end check: publish a test post with no feature image, or open an existing one, clear Settings → Meta data → Facebook/Twitter image if set, and save; within seconds the post's Facebook and Twitter card previews show the card; the media library has `og-<id>.png` once.
9. Forcing a refresh: edit the title or excerpt and save; a tag-only change may not trigger it; for a hand-set image, clear it and save.
10. Logs: `npx wrangler tail` live; Workers Logs in the dashboard for the retained window.
11. Tweaking the design: constants in `src/card.ts` (`LAYOUT`) and colours/fonts in `cardElement`; run `npm test`, check `/preview`, `npm run deploy`.
12. Run tests: `npm test` (runs inside the Workers runtime).

- [ ] **Step 2: Deploy**

Run: `npx wrangler deploy`
Expected: success, with the uploaded size printed. If Wrangler rejects the size, re-check that only the three `.woff` files and the two `.wasm` modules are bundled (`npx wrangler deploy --dry-run --outdir dist` and inspect).

- [ ] **Step 3: Set the three secrets**

Run `npx wrangler secret put` for each name; paste values when prompted (never into the shell history or a file in the repo).

- [ ] **Step 4: Smoke the deployed preview**

```bash
curl -sG "https://<worker-host>/preview" --data-urlencode "token=<PREVIEW_TOKEN>" --data-urlencode "title=Deployed" --data-urlencode "label=Technology" -o /private/tmp/claude-501/-Users-ben-code-preview-image/eac57ba6-14cf-4284-98c6-98dfba10bfc2/scratchpad/deployed.png -w "%{http_code} %{content_type}\n"
```

Expected: `200 image/png` and a correct card when opened.

- [ ] **Step 5: End-to-end with Ghost**

With the two webhooks created in Ghost (README section 3), run `npx wrangler tail` in one terminal, then re-save a published post that has no feature image and no og_image. Expected in the tail: one `/hook` request → 202 with `mode: "create"`, then a log line `{ id, image }`. In Ghost: the post's Meta data → Facebook card and Twitter card show the rendered image; media library contains `og-<id>.png`. Then edit the title and save: one `/hook` → 202 `mode: "refresh"` and a new image URL. Save again without changes to anything but the body: `/hook` → 200 `{ skipped: "og_image set" }`.

- [ ] **Step 6: Commit**

```bash
git add README.md wrangler.toml
git commit -m "docs: README with Ghost, secrets, deploy, Zapier delay and troubleshooting"
```
