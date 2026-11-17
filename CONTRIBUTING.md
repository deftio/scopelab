# Contributing to ScopeLab

Thanks for helping. ScopeLab is small on purpose: one page, two scripts, no
build step. Most useful contributions are a new filter, a fix for a specific
camera, or a clearer explanation in the README.

## Setup

Requires Node.js 20 or newer. Node is only used for the local server, tests and
the Pages build; the app itself is plain browser JavaScript.

```bash
git clone https://github.com/deftio/scopelab.git
cd scopelab
npm install
npm start          # http://localhost:8642
```

Open the page in Chrome or Edge. Any webcam works for development if you do not
have an endoscope; so does Chrome's fake camera:

```bash
open -a "Google Chrome" --args --use-fake-device-for-media-stream
```

## Where things live

| Path | What it is |
|---|---|
| `public/app.js` | The UI and the frame loop |
| `public/filters.js` | Filters, histograms and stats as pure functions (browser + Node) |
| `public/index.html` | The page shell |
| `server.js` | Local server for `npm start`; saves captures to `captures/` |
| `scripts/` | `npm run dev` launcher and the GitHub Pages build |
| `test/filters.test.js` | Unit tests (`node --test`) |
| `docs/images/` | README screenshots |

## Code rules

- **The UI is bitwrench only.** Build elements as TACO objects
  (`{ t, a, c, o }`) and BCCL components (`bw.makeButton`, `bw.makeTabs`, …).
  Change what is on screen with bitwrench verbs (`bw.patch`, `bw.toggleClass`,
  `bw.syncChildren`, `bw.mount`), not `innerHTML`, `querySelector` or
  `addEventListener` on elements. Handlers go in `a: { onclick }`. Drawing
  pixels on a `<canvas>` is fine; that is not UI structure.
- **Style through the palette.** Custom CSS goes through `bw.css()` with colours
  taken from the generated palette, so light and dark themes both work.
- **Filters are pure.** A filter in `filters.js` takes `{ w, h, data }` (RGBA)
  plus its params and returns a **new** image. It never mutates its input
  (the raw frame is reused for split view, histograms and raw captures) and
  never touches the DOM.
- **No build step and no new runtime dependencies.** bitwrench is the only one.

## Adding a filter

1. Add an entry to `FILTERS` in `public/filters.js`: `id`, `name`, `group`,
   `params` (each `range`, `select` or `bool`) and `apply(img, params)`.
2. The Filters tab picks it up automatically, including its controls.
3. Add a test in `test/filters.test.js`. The generic test already checks that
   every filter keeps the image size and does not mutate its input; add one
   that checks what your filter is supposed to *do* (a step edge and a flat
   field are usually enough).
4. Check the frame time it shows in the chain at 1280×720. If it is over about
   50 ms, say so in the filter's name (as "bilateral" and "median" do) or make
   it faster.

## Before opening a pull request

```bash
npm test               # filter unit tests
npm run build:pages    # the GitHub Pages build still works
```

Then load the page, start a camera and try your change. CI runs the same
checks on every pull request.

1. Branch from `main`: `git checkout -b my-change`.
2. Commit with a message that says **what** changed and **why**.
3. Open a pull request against `main`. The template asks for the essentials.

Screenshots or a short screen recording help a lot for anything visual.

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). Security issues
go through [SECURITY.md](SECURITY.md), not the public issue tracker.
