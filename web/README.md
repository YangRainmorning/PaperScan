# Web app

The browser build of PaperScan: same algorithm, no install, no upload. Drop a photo on the
page and get a scan back.

```
npm ci
npm run dev        # http://localhost:5173
npm test           # 45 unit tests
npm run build      # -> dist/  (~34 KB total, ~9 KB gzipped)
npm run preview    # serve the built output on :4173
```

## Why this exists as well as the CLI

Telling someone to install the .NET SDK and run a command is a non-starter for most people
who just want their certificate photographed properly. A page they can open on a phone
removes every step except "pick a photo". Processing happens entirely in the browser, so it
also costs nothing to host and never uploads anybody's documents.

## How it is put together

```
src/core/        the algorithm — no DOM, no canvas, no Node
src/worker.ts    runs core/ off the main thread
src/imageio.ts   the only place that touches canvas: decode a file, encode a result
src/main.ts      UI wiring
src/i18n.ts      English and Simplified Chinese strings
```

`src/core/` is a direct port of `../src/PaperScan.Core`, and the two are pinned together by
the same regression target: the reference certificate photo must come out at 7487x5355 with
a 90th-percentile paper white of R212 G203 B191, cropped 8/19/31/46 px. The C# engine's
baseline is in `../CHANGELOG.md`; the web baseline is asserted in
`tests/regression.local.test.ts`.

Yes, that means the algorithm exists twice. That was a deliberate trade: a Blazor WebAssembly
build could reuse the C# directly, but it costs about 2 MB of runtime before any of your
photo is looked at, which is the wrong trade for a page whose whole point is opening
instantly on a phone. Keeping `core/` free of DOM and canvas types is what makes it testable
in plain Node and portable if the two ever need to converge.

### Why a worker

Rectifying a 50 MP photo runs a per-pixel loop over ~40 million output pixels. On the main
thread the spinner would freeze and the page would look hung. `src/worker.ts` takes ownership
of the pixel buffer (transferred, not copied) and posts progress back per stage.

### Deviations from the C# engine

- **Thumbnail downscaling.** ImageSharp uses bicubic; this uses exact area averaging. It is
  the better filter at the ~40x reduction involved, and — unlike a separable kernel — it is
  exactly reproducible, so tests can assert on it. Corner detection tolerates the difference
  comfortably.
- **Default output format.** The CLI writes lossless PNG because that is what an archivist
  wants; a 40 MP PNG is 50 MB, which is not what somebody on a phone wants. The web app
  defaults to JPEG at quality 92 (about 8 MB for the same scan) and offers PNG in the
  advanced panel.

## Browser support

Chrome/Edge 111+, Firefox 111+, Safari 16.4+. The floor is `createImageBitmap` with
`imageOrientation: 'from-image'` (without it, phone photos arrive on their side) plus module
workers. Nothing else in the app is new.

## Deployment

The build is a static folder, so anything that serves files works. On Cloudflare Pages:

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick the `PaperScan` repository.
3. Set **Root directory** to `web`, **Build command** to `npm ci && npm run build`, and
   **Build output directory** to `dist`.
4. Under **Settings → Environment variables**, set `NODE_VERSION` to `24`.
5. Save and deploy. Pushes to `main` redeploy automatically.

`public/_headers` is picked up by Pages as-is and sets a strict CSP, `nosniff`, and a
one-year immutable cache on the hashed `assets/`.

For GitHub Pages instead, change `base` in `vite.config.ts` to `'/PaperScan/'` and publish
`web/dist`. Note that `github.io` is frequently slow or unreachable from mainland China,
which is why Cloudflare Pages is the documented default.

## Verifying it actually works in a browser

Unit tests cover the algorithm but not the wiring. `tools/browser-check.mjs` drives a real
Chrome over the DevTools Protocol — it sets the file input directly, waits for the result
card, captures console errors, and writes a screenshot:

```bash
npm run build && npm run preview &
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/ps about:blank &
node tools/browser-check.mjs http://localhost:4173/ ./sample.jpg /tmp/out
```

It exits non-zero if the page ends up in the error state, and prints the output size, the
timings and the stats the UI is showing. See `tools/README.md`.
