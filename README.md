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
| `ANTHROPIC_WORKSPACE_ID` | Optional. Only for an API key that is not tied to a workspace: the workspace ID from the Console (Settings, Workspaces). |
| `ADMIN_PASSCODE` | A long passcode you make up. It opens the owner queue (footer, "Owner sign-in"). |

Settings in `wrangler.jsonc`:

| Variable | Default | Meaning |
|---|---|---|
| `MODEL` | `claude-opus-5-5` | Model that reads the plans. |

Order alerts. Each new order is held for 24 hours; if it is not accepted in that time the hold lapses and nothing is charged. When an order comes in the owner is told by any of these that are set up (as secrets on the Worker, Settings, Variables and Secrets). The order never waits on them, and the owner queue shows whether each was sent.

| Secret | Meaning |
|---|---|
| `RESEND_API_KEY` | Email through Resend. With the default sender, the Resend account must be signed up with the address the email goes to. |
| `NOTIFY_EMAIL` | Optional. Where order emails go. Default `jonathan@binbypass.com`. |
| `EMAIL_FROM` | Optional. Sender, once a domain is verified in Resend. Default `House Models <onboarding@resend.dev>`. |
| `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`, `NOTIFY_PHONE` | SMS through Twilio. `NOTIFY_PHONE` in +61 form. `TWILIO_FROM` a Twilio number or an alphanumeric sender name. |
| `NTFY_TOPIC` | Phone push through the free ntfy app. Use a long random topic name and keep it secret: anyone who knows it can read and send to it. |

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
- Window frames, glazing bars, gutters and wall textures. Windows, doors and garage doors are cut 1 mm into the walls with 45 degree heads.

## Third-party code

`public/vendor/three.min.js` (three.js r128, MIT licence) and `public/vendor/pdf.min.js`, `public/vendor/pdf.worker.min.js` (PDF.js 3.11.174, Apache 2.0 licence).

## Model builder

`public/kit.js` builds every model in the browser, following the rules of
[arch-model-print-kit](https://github.com/jonogibson1/arch-model-print-kit): one white piece, solids minus voids plus
extras, 45 degree soffits on recesses and eaves, fences at least 1.6 mm, no trees, an embossed plinth band with the
address, scale and north point. Booleans run in [manifold-3d](https://github.com/elalish/manifold) (Apache 2.0,
`public/vendor/manifold.js`, `public/vendor/manifold.wasm`). `public/gen.js` remains for the server's price estimate
and for writing STL and zip files.
