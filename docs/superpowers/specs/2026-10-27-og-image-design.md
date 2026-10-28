# Social preview images for werd.io posts

Date: 2026-10-27
Status: final; all questions answered by Ben; next step is the implementation plan

## Intent

Ben's link blog posts (https://werd.io/tag/links) are published to Ghost (Pro) by a
Zapier pipeline (iA Writer → Notion → Zapier → Ghost → social networks + Raindrop).
Those posts have no feature image, so every one of them falls back to the site's
generic social image and they all look identical when shared.

This tool is a Cloudflare Worker that listens to Ghost's own webhooks. When a post
is published without a feature image, it renders a branded 1200×630 PNG card
showing the post's title and subtitle, uploads it to Ghost, and sets it as the
post's social image. Ghost's integrations and webhooks drive it; Zapier is not
involved in the trigger.

## Goals

- Publishing a post with no feature image automatically gives it a distinctive,
  on-brand social card, with no manual steps.
- The card looks like werd.io: same fonts, colours, and masthead.
- Type is laid out well: real font metrics, proper wrapping, no clipped text.
- Every eligible publish gets a card, even though Ghost gives the receiver only
  2 seconds and delivers each event once.

## Non-goals

- Setting the Ghost feature image. The card goes **only** into `og_image` and
  `twitter_image`. Posts keep their lack of feature image so the site's post list
  stays clean.
- Changing the Ghost theme or any site templates.
- Touching posts that already have a feature image. Ghost already uses that for
  social previews.
- Backfilling existing posts. (Re-saving a post triggers the tool, so a manual
  backfill is possible post by post; a script is not in scope.)
- Any UI. This is a headless endpoint.

## Anti-goals (would make it a failure even if it "works")

- Text overflowing or clipped on long titles.
- The Ghost Admin API key or webhook secret appearing anywhere in the repository.
- Anyone on the internet being able to trigger the endpoint and push images into
  Ghost.
- Publishes that never get a card because the Worker took too long to answer
  Ghost.
- A card that looks like a generic template rather than werd.io.

## Decisions made by Ben

- **Trigger:** Ghost webhooks on a custom integration, not a Zapier step. When a
  post is published, the endpoint checks whether it has a feature image; if it does
  not, it generates the card and sets it on the post.
- **Save trigger as the safety net:** a second webhook on `post.published.edited`,
  no scheduled sweeper. A missed card is fixed by re-saving the post.
- **Webhook auth:** Ghost(Pro)'s "Add webhook" dialog offers a Secret field
  (confirmed by screenshot), so the Worker verifies Ghost's signature.
- **Image slot:** `og_image` and `twitter_image` only, never `feature_image`.
- **Ghost access:** the Worker talks to Ghost directly using an Admin API key held
  as a Worker secret, never in code.
- **Platform:** a Cloudflare Worker on the Workers Paid plan, a separate Worker
  from Ben's existing standard.site webhooks (same Cloudflare account).
- **Regenerate on edit:** when a published post's title, excerpt or primary tag
  changes and the current `og_image` is one this tool made, regenerate the card.
  Hand-set images are never overwritten.
- **Design direction:** "Masthead" (option B of the mockups). Blue header bar
  reproducing the site header, then title and subtitle on white below.
- **Masthead label:** always the post's primary tag name, if one is set (e.g.
  "Technology", "AI", "Media"). No primary tag → the right side of the masthead
  is empty. The mockups' "Notable links" was a placeholder for this. Verified on
  the live site that link posts' primary tag is the topic tag ("Technology" on
  the solar post), not the `links` tag the listing page is built from, so
  `primary_tag.name` is the right field with no special-casing.
- **Length handling:** title scales down for long titles; excerpt shrinks and clamps
  to two lines with an ellipsis; a post with no excerpt shows the title alone,
  vertically centred. Ben approved mockups of short, typical, very long, and
  no-subtitle cases.

## Decisions made by Claude (Ben can overrule any of these)

- **One Worker, its own project.** A new Worker in this repository, deployed with
  Wrangler, with its own hostname (`*.workers.dev` by default; a custom
  hostname such as `og.werd.io` is optional and documented in the README).
- **Respond first, work after.** Ghost gives a webhook receiver 2 seconds and
  delivers each event once (Ghost's `webhook-trigger.js` passes a retry limit to
  the `got` HTTP client, but `got` never retries POST unless told to, and Ghost
  does not tell it to). The Worker verifies the request, decides from the payload
  whether work is needed, returns 202 immediately, and does the render/upload/
  update in `ctx.waitUntil()`, which Cloudflare allows to run for up to 30 s after
  the response. No queue, no second Worker.
- **Ownership marker.** The Worker uploads every card with the filename
  `og-<post id>.png`. Ghost keeps the sanitised filename in the stored URL (it may
  add a numeric suffix on collision), so "the basename of the `og_image` URL
  starts with `og-<post id>`" identifies a card this tool made. That is what lets
  the refresh rule distinguish its own images from one Ben set by hand.
- **Idempotence.** A post whose `og_image` is set is skipped unless the refresh
  rule applies. Unpublish/republish, the save trigger, and the edit this tool
  itself makes (which changes only `og_image`, `twitter_image` and `updated_at`)
  are all no-ops. The background job re-checks eligibility against a fresh copy
  of the post before uploading. Two invocations that overlap closely could both
  upload, but the `updated_at` collision check means only one PUT succeeds; the
  other image is an orphan in the media library, which is harmless. Ghost has no
  image-delete API, so a refreshed card's predecessor also stays in the library.
- **Events:** `post.published` and `post.published.edited`. Both hit the same URL
  and are treated identically. Scheduled posts fire `post.published` when they go
  live, so they are covered.
- **Subtitle is `custom_excerpt`, and the pipeline does set it.** Verified on a
  live link post: the excerpt shown under the headline differs from the body's
  opening sentence, which is only possible when `custom_excerpt` is set. Ghost's
  auto-derived `excerpt` is never used; if `custom_excerpt` is empty the card is
  title-only.
- **Rendering stack:** `satori` (layout → SVG, via its WASM build with
  `yoga-wasm-web`) plus `@resvg/resvg-wasm` (SVG → PNG). No headless browser, no
  Cloudflare Browser Rendering. Both WASM modules are imported as modules the
  way Wrangler expects (`import wasm from "…/file.wasm"` yields a
  `WebAssembly.Module`; `instantiateStreaming` is not available on Workers).
  The `workers-og` npm package wraps exactly this stack for Workers and accepts
  an HTML string; the builder may use it or wire satori and resvg directly,
  whichever is less fragile in practice.
- **Fonts bundled** as binary modules via a Wrangler `rules` entry of type
  `Data` for `*.ttf`, so they import as `ArrayBuffer`. Inter (Bold and ExtraBold)
  and Merriweather Regular, subset to Latin-1 plus typographic punctuation
  (curly quotes, en/em dashes, ellipsis) to keep the bundle small. Both fonts
  are under the SIL Open Font License.
- **Characters the bundled fonts cannot draw** (emoji, CJK, other scripts) are
  stripped before rendering and the stripped characters are logged. Recent
  werd.io titles are all plain Latin, so stripping is the pragmatic default. Ben
  can overrule if he links to non-Latin sources.
- **Preview mode:** `GET /preview` returns the PNG for a given title, subtitle
  and label without touching Ghost, guarded by its own token.
- **Crypto via WebCrypto.** HMAC-SHA256 for both the Ghost webhook signature
  check and the Admin API JWT, using `crypto.subtle`; the comparison uses
  `crypto.subtle.timingSafeEqual` (Workers-only; it throws on unequal lengths, so
  check lengths first, and signature tests must run under the Workers test
  pool). No Node compatibility flag needed.
- **Failure visibility.** Because the Worker answers 2xx before doing the work,
  Ghost's webhook status never shows a render failure. Failures go to Workers
  Logs (retained about a week on Paid). No notification path (email, Slack,
  Zapier catch hook) is built: Ben chose re-saving as the recovery, and a
  missing card is visible on the shared post itself. Can be added later as one
  more secret and one `fetch`.
- **Secrets handling:** `wrangler secret put` for the three secrets; the Ghost
  URL is a plain `vars` entry in `wrangler.toml`. Local development uses a
  git-ignored `.dev.vars`; a committed `.dev.vars.example` lists the names.

## Formerly open questions (all resolved by Ben)

0. **Regenerate on edit:** yes.
1. **Separate Worker:** yes, its own Worker in this repository.
2. **Workers plan:** the account is on Workers Paid.

## Brand reference (measured from werd.io on 2026-10-27)

| Element           | Value                                                        |
|-------------------|--------------------------------------------------------------|
| Accent / header   | `#286c93` (Ghost accent colour; site header background)      |
| Text              | `#15171a`                                                    |
| Secondary text    | `#4a4f57` (Claude's pick for the excerpt; not from the site) |
| Background        | `#ffffff`                                                    |
| Heading font      | Inter, weight 700–800, tight letter-spacing (-0.02em)        |
| Body font         | Merriweather, weight 400                                     |
| Site name         | "Ben Werdmuller"                                             |
| Section label     | primary tag name, e.g. "Technology"; empty if none          |

## The card

Canvas: 1200×630 PNG, white background, no rounded corners (the social networks
crop and round as they like).

Layout, top to bottom:

1. **Masthead bar.** Full-width, 110px tall, background `#286c93`. Left: "Ben
   Werdmuller" in Inter 700, 34px, white. Right: the primary tag's name in
   Merriweather 400, 24px, white at 85% opacity; omitted when the post has no
   primary tag. Horizontal padding 90px, contents vertically centred.
2. **Body.** Horizontal padding 90px. Top padding 64px, bottom 56px. The title and
   subtitle block is vertically centred within the remaining 520px.
   - **Title.** Inter 800, colour `#15171a`, letter-spacing -0.02em, line-height 1.12.
     Default 64px. If the title is short enough to fit on two lines at 76px, use up
     to 76px. If it does not fit in the available height at 64px, step the size
     down (e.g. 60, 56, 52, 50) until the whole block fits. Floor: 44px. If it still
     does not fit at the floor, truncate the title with an ellipsis at the last line
     that fits. The title must never be clipped mid-glyph.
   - **Subtitle.** Merriweather 400, colour `#4a4f57`, line-height 1.45, 28px gap
     below the title. Default 30px; when the title steps down the subtitle steps
     down proportionally, floor 24px. Always clamped to at most two lines with an
     ellipsis.
   - **No subtitle.** Omit the element; the title alone is centred and may use the
     larger size.
3. Nothing else: no date, no avatar, no URL in the body. The masthead carries the
   identity.

The mockups Ben approved are in `.superpowers/brainstorm/*/content/card-direction.html`
(option B) and `masthead-lengths.html`. The builder should treat the measurements
above as the spec and the mockups as the visual reference.

Fitting approach left to the builder: satori does not auto-shrink text, so the
Worker will need to measure (e.g. render at a size, inspect the resulting layout
height, retry smaller) or estimate line counts from character widths. Satori does
support `lineClamp` with a native ellipsis, which covers the subtitle's two-line
clamp and the title's last-line truncation without hand-rolling. Either approach
is acceptable as long as the four approved cases render correctly, no text is
ever clipped, and total CPU per card stays comfortably inside the Paid plan's
default 30 s (it should be well under 1 s).

Text sanitising: the title and subtitle come from Ghost as plain strings. Collapse
whitespace, strip any HTML tags, and decode HTML entities (Ghost titles can contain
`&amp;` etc.). Curly quotes and en/em dashes must render; both fonts cover them and
the subset must keep them.

## The Worker

One Cloudflare Worker (ES module syntax, `export default { fetch }`), deployed
with Wrangler. Routes:

| Method | Path       | Purpose                                   |
|--------|------------|-------------------------------------------|
| POST   | `/hook`    | Ghost webhook receiver                    |
| GET    | `/preview` | Render a card without touching Ghost      |
| any    | other      | 404                                       |

### `POST /hook`

1. **Read the raw body** with `request.text()` and verify the signature (below).
   Failure → 401.
2. Parse the JSON. Ghost sends `{ event, post: { current: {...}, previous: {...} } }`
   where `current` is the full post as the Admin API would return it. Take
   `post.current`.
3. **Decide.** In order:
   - `current.status` is not `published` → skip.
   - `current.feature_image` is set → skip.
   - `current.og_image` is empty → **create**.
   - `current.og_image` is ours (basename starts with `og-<current.id>`) **and**
     `post.previous` contains `title` or `custom_excerpt` (Ghost puts only the
     changed attributes in `previous`) → **refresh**. If `previous` carries tag
     information (`tags` or `primary_tag`) treat that as a change too; tag
     changes are relations and may not appear in `previous`, so this is
     best-effort and a tag-only change may need a re-save of the title to
     refresh. Documented in the README.
   - Otherwise → skip (this covers hand-set images and the edit this tool makes).
   A skip responds 200 with `{ "skipped": "<reason>" }`.
4. For create or refresh, `ctx.waitUntil(processPost(current.id, env))` and
   respond 202 with `{ "queued": true, "id": current.id, "mode": "create"|"refresh" }`.

Ghost ignores the response body; only the 2xx matters. Never return 410, which
makes Ghost delete the webhook.

### Verifying the request

Ghost sends `X-Ghost-Signature: sha256=<hex>, t=<ms-timestamp>` where
`<hex> = HMAC-SHA256(secret, rawBody + timestamp)` (string concatenation, no
separator; verified in Ghost's `webhook-trigger.js`). The Worker recomputes it over
the raw request text with `GHOST_WEBHOOK_SECRET`, compares with
`crypto.subtle.timingSafeEqual`, and rejects if `|now − t| > 5 minutes`. A missing
or malformed header is a 401. If `GHOST_WEBHOOK_SECRET` is unset the Worker refuses
every POST (fail closed) and logs a configuration error.

### `processPost(id)` (runs in `waitUntil`)

1. `GET /ghost/api/admin/posts/{id}/?include=tags` with an Admin API JWT. 404 →
   log and stop.
2. Re-check against the fresh copy: status published, no `feature_image`, and
   `og_image` either empty or ours. If any fails, log `skipped` and stop. (This
   is the guard against overlapping invocations and against a hand-set image
   that arrived between the hook and the job.)
3. Title = `title`; subtitle = `custom_excerpt` or none; label =
   `primary_tag.name` or none.
4. Render the PNG.
5. `POST /ghost/api/admin/images/upload/` as multipart with the PNG (field `file`,
   `purpose=image`, filename and `ref` `og-<id>.png`). Ghost keeps the sanitised
   filename in the stored URL, so the `og-<id>` prefix identifies this tool's
   images later. Take `images[0].url`.
6. `PUT /ghost/api/admin/posts/{id}/` with
   `{ posts: [{ og_image, twitter_image, updated_at }] }` where `updated_at` is the
   value read in step 1 (Ghost requires it for collision detection). A 409 means the
   post changed underneath us: re-fetch once and retry the PUT; if `og_image` is
   now set, stop.
7. Log `{ id, image }` at info level.

Any Ghost error → log at error level with the Ghost status and message, then
return (never throw out of `waitUntil`, which would only lose the log). Logs are
visible with `wrangler tail` and in the Cloudflare dashboard; Workers Logs should
be enabled in `wrangler.toml` (`[observability] enabled = true`) so failures are
retained for their default window.

### `GET /preview`

Query string: `title` (required), `subtitle` (optional), `label` (optional; the
masthead's right side, empty if omitted), `token` (must equal `PREVIEW_TOKEN`).
Returns the PNG with `Content-Type: image/png`, `Cache-Control: no-store`. Wrong or
missing token → 401. If `PREVIEW_TOKEN` is unset, 404.

### Ghost Admin API details

- Base URL from `GHOST_ADMIN_API_URL`: `https://werd-io.ghost.io` (the API URL
  Ghost shows on the integration page). The Worker appends `/ghost/api/admin/`.
- `GHOST_ADMIN_API_KEY` is `id:secret`. JWT: HS256, header `kid` = id, payload
  `aud: "/admin/"`, `iat` now, `exp` now + 5 min, secret hex-decoded. Header
  `Authorization: Ghost <jwt>`, plus `Accept-Version: v5.0`. Signed with
  `crypto.subtle` (HMAC, SHA-256) and base64url-encoded by hand.
- Workers' built-in `fetch`, `FormData` and `Blob` for the multipart upload. No
  Ghost SDK dependency.

### Configuration

`wrangler.toml` (names indicative):

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
globs = ["**/*.ttf"]
fallthrough = true
```

(The builder verifies the exact `rules` syntax against the current Wrangler
docs; the intent is "fonts import as ArrayBuffer, WASM imports as Module".)

Secrets, set with `wrangler secret put`:

| Name                   | Purpose                                      |
|------------------------|----------------------------------------------|
| `GHOST_ADMIN_API_KEY`  | Admin API key, `id:secret`                   |
| `GHOST_WEBHOOK_SECRET` | Secret set on both Ghost webhooks            |
| `PREVIEW_TOKEN`        | Token required by `GET /preview`             |

Local development: `.dev.vars` (git-ignored) with the same three names;
`.dev.vars.example` committed with placeholders. `wrangler dev` serves the Worker
locally for the preview route and for unit tests that hit it.

### The Zapier race (not part of this tool, but Ben must know)

Ben's Zap publishes to Ghost and then shares to social networks. The card appears
a few seconds after publish, so a share step that runs immediately may still see
the old generic image, and some networks cache the first preview they fetch.
Recommendation: add a **Delay by Zapier** step of 1–2 minutes between the Ghost
publish step and the share steps. The README says this.

## Repository layout (builder's call within reason)

```
preview-image/
  wrangler.toml
  package.json                # wrangler, satori, yoga-wasm-web, @resvg/resvg-wasm, vitest
  tsconfig.json
  src/
    index.ts                  # routing, signature check, decision, waitUntil
    ghost.ts                  # JWT, GET post, upload image, PUT post
    card.ts                   # layout + fitting (satori element tree)
    render.ts                 # satori + resvg initialisation and PNG output
    text.ts                   # sanitising, entity decoding, glyph stripping
    fonts/                    # Inter-Bold.ttf, Inter-ExtraBold.ttf, Merriweather-Regular.ttf (subset)
  test/                       # vitest; see Testing
  .dev.vars.example
  .gitignore                  # .dev.vars, node_modules, .superpowers/, .wrangler/
  README.md
  docs/superpowers/specs/     # this document
```

TypeScript is the builder's call; plain JavaScript modules are fine too. The
directory is already a git repository (one commit, `.gitignore` holds only
`.idea`). The builder extends `.gitignore` rather than re-initialising.

## Testing

- Unit tests for the fitting logic (short / typical / very long / no subtitle) that
  assert the chosen font size and line count, and that nothing is truncated except
  in the pathological case.
- A test that renders each of the four approved cases to PNG and writes them to a
  scratch directory, so the images can be eyeballed against the mockups. This
  needs the WASM modules loadable under the test runner; `@cloudflare/vitest-pool-
  workers` runs tests inside the Workers runtime and is the first thing to try.
- Unit tests for signature verification using a payload and signature produced the
  way Ghost's source does it, plus timestamp-window, wrong-secret, and missing-
  header cases, and for the preview token.
- Unit tests for the hook's decision table: draft; has feature image; no
  og_image (create); our og_image with title changed (refresh); our og_image
  with excerpt changed (refresh); our og_image with only og_image/updated_at in
  `previous` (skip, the self-edit case); foreign og_image with title changed
  (skip); and that create/refresh result in exactly one background job.
- Ghost interactions mocked at the `fetch` level: assert the JWT shape, the upload
  multipart, the PUT carries `updated_at` and both image fields, the re-check
  short-circuits, and the 409 retry path.
- A manual end-to-end check: publish a test post (or re-save an existing one after
  clearing its `og_image`) and confirm one image appears, once, in the Ghost media
  library and on the post's social settings. The README documents this and the
  `curl` for preview.

## README must cover

1. Prerequisites: Node, `wrangler` logged in to Ben's Cloudflare account, Workers
   Paid plan.
2. Creating the Ghost custom integration: the Admin API key, and two webhooks
   (events `post.published` and `post.published.edited`), both with target URL =
   `https://<worker-host>/hook` and the same Secret, which is `GHOST_WEBHOOK_SECRET`.
3. Setting the three secrets with `wrangler secret put`, and `.dev.vars` for local.
4. `wrangler deploy`, and attaching a custom hostname if Ben wants one.
5. The Zapier delay recommendation.
6. The `curl` for preview, and how to run the end-to-end check.
7. How to tweak the design (where the constants live) and re-deploy, and how
   to force a refresh of one post (edit its title or excerpt and save; a tag-only
   change may not trigger it) or of a post with a hand-set image (clear
   `og_image` in Ghost's post settings and save).
8. How to read logs (`wrangler tail`, Workers Logs in the dashboard) when something
   goes wrong, since Ghost shows only the HTTP status.

## Constraints

- Cloudflare Workers (limits page read 2026-10-27): 10 ms CPU per request on
  Free, 30 s default on Paid; 128 MB memory per isolate including WASM;
  `waitUntil` runs up to 30 s after the response; 50 subrequests per invocation
  on Free (this tool makes 3); script startup capped at 400 ms CPU. Script size:
  the current limits page says 64 MiB uncompressed with no compressed limit;
  older documentation said 3 MB (Free) / 10 MB (Paid) compressed. The bundle
  here (resvg WASM ~2 MB, yoga WASM, satori, three subset fonts) is a few MB
  and fits either way, but the builder should check `wrangler deploy`'s
  reported size on the first deploy.
- Ghost webhook: 2 s response window, delivered once, no retries. Static
  `import`s of the WASM and font modules are part of the module graph and load
  at isolate start (cheap: WASM is precompiled at deploy). What must **not**
  happen before the `/hook` response, or at module top level, is instantiation:
  `WebAssembly.instantiate`, satori's `init`, resvg's `initWasm`. Do those lazily
  inside the background job (and the preview route) and cache the result in a
  module-level variable. No Ghost call before responding either.
- Secrets only via `wrangler secret` / `.dev.vars`. Nothing secret in
  `wrangler.toml` or any committed file.
- Satori supports a flexbox subset of CSS with inline styles only; the layout must
  be expressed that way.

## Open to the builder

- Exact font-fitting algorithm (see "Fitting approach").
- Direct satori/resvg wiring versus `workers-og`.
- TypeScript versus JavaScript.
- Whether to add a tiny `scripts/preview.mjs` for rendering locally without
  `wrangler dev`. Nice to have.
