# House Models

Scale models of real homes, made from PDF building plans. Test site.

A customer uploads their plans, the site reads them and shows a 3D preview, the customer places a (pretend) card hold, and the owner accepts or declines in a passcode-protected queue.

## How it works

| Piece | Where | What it does |
|---|---|---|
| Site | `public/` | Static pages. Opens the PDF in the browser, turns pages into images, shows the 3D preview, builds STL files. |
| Generator | `public/gen.js` | Turns a few rectangles with roofs into watertight, support-free printable parts. Used by the browser and the server. |
| Server | `src/worker.js` | One Cloudflare Worker. Stores orders in a Durable Object, sends page images to the Anthropic API, prices the model, guards the owner queue. |

Nothing from the plans is stored on the server apart from file names. Page images pass straight through to the Anthropic API.

## Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jonogibson1/house-models)

You are asked for two secrets:

| Secret | What to enter |
|---|---|
| `ANTHROPIC_API_KEY` | An API key from the Anthropic Console. Plan reads are billed to it. Set a monthly spend limit in the Console. |
| `ADMIN_PASSCODE` | A long passcode you make up. It opens the owner queue (footer, "Owner sign-in"). |

Settings in `wrangler.jsonc`:

| Variable | Default | Meaning |
|---|---|---|
| `MODEL` | `claude-opus-5-5` | Model that reads the plans. |

There are no spend caps. Every plan read and change request is billed to the API key, so the monthly spend limit on the key in the Anthropic Console is the only brake. To add one later, set either of these as a variable on the Worker:

| Variable | Meaning |
|---|---|
| `DAILY_READ_CAP` | Most plan reads and change requests per day, across all visitors. |
| `DAILY_ORDER_CAP` | Most new orders per day, across all visitors. |

Limits that remain: 40 wrong passcode tries per visitor network per day, one change request per order, 24 images and 26 MB per read.

The preview carries a PREVIEW watermark across the 3D view until the owner accepts the order.

Known gap: the 3D preview is built in the browser from the same numbers as the print files, so someone technical could produce the STL from the preview without paying. Fine for a test; a paid launch needs the preview served as a picture or a coarse mesh.

## Run locally

```
npm install
cp .dev.vars.example .dev.vars   # fill in both values
npm run dev
```

## Not built yet

- Real payments. The card page is a mock and collects nothing.
- Emails. Customers come back through the order link shown on their order page.
- Windows, doors and other facade detail. The model is the outside shape and roof only.

## Third-party code

`public/vendor/three.min.js` (three.js r128, MIT licence) and `public/vendor/pdf.min.js`, `public/vendor/pdf.worker.min.js` (PDF.js 3.11.174, Apache 2.0 licence).
