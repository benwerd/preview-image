# Social preview images for Ghost

A Cloudflare Worker that renders a 1200×630 card (title, optional excerpt and primary tag, on a branded masthead) for every published Ghost post that has no feature image. It uploads the card to Ghost's media library as `og-<post id>.png` and sets it as the post's `og_image` and `twitter_image`. Ghost calls the Worker through two webhooks; the Worker answers at once and does the rendering in the background.

Design spec: [docs/superpowers/specs/2026-10-27-og-image-design.md](docs/superpowers/specs/2026-10-27-og-image-design.md)

## Prerequisites

- Node 20 or newer
- A Cloudflare account on the Workers Paid plan (rendering needs more CPU time than the Free plan allows)

```bash
npm i
```

```bash
npx wrangler login
```

## Ghost setup

In Ghost admin, go to Settings → Advanced → Integrations and choose "Add custom integration". Name it "Social preview images".

The integration page shows two values. The Admin API key (`id:secret`) becomes the `GHOST_ADMIN_API_KEY` secret. The API URL (`https://werd-io.ghost.io`) is already set as `GHOST_ADMIN_API_URL` in `wrangler.toml`.

Choose "Add webhook" twice. Each webhook has a Name, an Event, a Target URL and a Secret. Use the same Target URL and the same Secret for both:

| Event in Ghost's dropdown | Ghost event name | Target URL |
| --- | --- | --- |
| Post published | `post.published` | `https://<worker-host>/hook` |
| Published post updated | `post.published.edited` | `https://<worker-host>/hook` |

The Secret is any long random string. It becomes `GHOST_WEBHOOK_SECRET`. `<worker-host>` is the hostname you get after deploying (next two sections), so you can create the webhooks now and fill in the URL later.

## Secrets

Generate the two random values:

```bash
openssl rand -hex 32
```

Run that twice: one value for the webhook Secret, one for the preview token. Then set the three secrets, pasting each value when Wrangler prompts:

```bash
npx wrangler secret put GHOST_ADMIN_API_KEY
```

```bash
npx wrangler secret put GHOST_WEBHOOK_SECRET
```

```bash
npx wrangler secret put PREVIEW_TOKEN
```

For local development, copy the example file and fill it in. `.dev.vars` is git-ignored.

```bash
cp .dev.vars.example .dev.vars
```

## Deploy

```bash
npm run deploy
```

Wrangler prints the Worker's `*.workers.dev` URL. That hostname is `<worker-host>`. To serve it from your own domain instead, add a `routes` entry to `wrangler.toml` (a custom domain on a zone in your Cloudflare account) and deploy again.

## Zapier

If a Zap publishes to Ghost and then shares to social networks, add a "Delay by Zapier" step of 1–2 minutes between the Ghost publish step and the share steps.

The card is rendered after the webhook fires, so it appears a few seconds after publishing. A share step that runs immediately can see the old generic image, and some networks cache the first preview they fetch. The delay gives the card time to land first.

## Preview

`GET /preview` renders a card without touching Ghost. It needs the `PREVIEW_TOKEN` and a `title`; `subtitle` and `label` (the tag shown in the masthead) are optional.

```bash
curl -G "https://<worker-host>/preview" --data-urlencode "token=<PREVIEW_TOKEN>" --data-urlencode "title=A test title" --data-urlencode "subtitle=A short excerpt" --data-urlencode "label=Technology" -o card.png
```

Without the right token the Worker answers 401; without a title, 400.

## End-to-end check

With both webhooks created and the secrets set, start the log stream in one terminal:

```bash
npx wrangler tail
```

In Ghost, open a published post that has no feature image, clear its Facebook and Twitter images under the post's Meta data and social settings if they are set, and save. Within seconds the log shows one `/hook` request answered 202 with `mode: "create"`, followed by a line containing the new image URL. The post's Facebook and Twitter card previews then show the card, and the media library contains `og-<id>.png` once.

## Forcing a refresh

The Worker redraws a card it made earlier only when the post's title, excerpt or tags change in the webhook. To force one, edit the title or the excerpt and save. A tag-only change may not trigger it.

A post with a hand-set `og_image` (one the Worker did not create) is left alone. To have the Worker take over, clear the image under the post's Meta data / social settings and save.

Posts with a feature image are always skipped.

## Logs

Ghost delivers each webhook once and gives it 2 seconds. The Worker replies immediately and renders in the background, so Ghost's webhook status never shows a render or upload failure. It only shows the HTTP status: 202 queued, 200 skipped, 401 bad signature, 400 unparseable body.

Look in the logs instead. Live:

```bash
npx wrangler tail
```

Workers Logs in the Cloudflare dashboard (open the `werd-og-image` Worker and look for its Logs tab) keeps a retained window. Each request and each background job writes one JSON line, for example `{"route":"hook","id":"...","decision":{...}}` and `{"job":"processPost","id":"...","image":"..."}`. Failures log `error`, `status` and `body` from Ghost; skips log a `skipped` reason.

## Tweaking the design

The layout numbers (sizes, padding, line heights) are the `LAYOUT` constants at the top of `src/card.ts`. Colours and fonts are in `cardElement` in the same file. The fonts are in `src/fonts/`.

After a change, run the tests, check the result with the `/preview` request above (or with `npm run dev` locally), and deploy:

```bash
npm test
```

```bash
npm run deploy
```

Existing cards are not redrawn by a deploy; see "Forcing a refresh".

## Run tests

```bash
npm test
```

The tests run inside the Workers runtime, so rendering is exercised the same way as in production.
