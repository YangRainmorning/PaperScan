# Contributing to PaperScan

Thanks for taking a look. This is a small, focused tool; the most useful contributions
are usually a failing photo that the detector gets wrong, or a tuning parameter that
turns out to be badly chosen.

## Getting set up

You need the .NET 8 SDK or newer.

```bash
git clone https://github.com/YangRainmorning/PaperScan.git
cd PaperScan
dotnet test
```

`dotnet test` runs the full suite (about 4 seconds). For a full restore/build/test
cycle plus an optional publish, use `scripts/build.ps1`:

```bash
./scripts/build.ps1                                  # restore, build, test
./scripts/build.ps1 -Publish -SelfContained          # single-file binary in ./dist
./scripts/build.ps1 -Publish -Runtime linux-x64 -OutputDirectory dist/linux
```

The browser app is a separate Node project:

```bash
cd web
npm ci
npm test                 # 45 vitest tests
npm run build            # -> web/dist, about 34 KB
npm run dev              # http://localhost:5173
```

## Layout

| Path | What lives there |
|---|---|
| `src/PaperScan.Core/` | The engine. No console, no CLI concerns, no file paths. |
| `src/PaperScan.Cli/` | Argument parsing, console output, exit codes. Thin on purpose. |
| `tests/PaperScan.Tests/` | xunit. Synthetic images only — no binary fixtures. |
| `web/src/core/` | The TypeScript port of the engine. No DOM, no canvas, no Node. |
| `web/src/worker.ts` | Runs `web/src/core/` off the main thread. |
| `web/src/imageio.ts` | The only file that touches canvas. |
| `scripts/` | Build and launcher helpers. |
| `legacy/` | Frozen v0 PowerShell implementation. Do not change it. |
| `docs/` | Algorithm notes and README images. |


## Guidelines

- **Keep the algorithm in `Core` and the I/O in `Cli`.** If you find yourself writing
  `Console.WriteLine` in `PaperScan.Core`, something has gone wrong. The same rule applies
  to `web/src/core/`: no `document`, no `canvas`, no `window`, so it stays testable in plain
  Node and portable.
- **A behaviour change belongs in both engines.** If you tune a threshold in `PaperScan.Core`,
  make the same change in `web/src/core/` and update both test suites. They are pinned to the
  same regression target on purpose.
- **No binary test fixtures.** Build the image you need in the test, using
  `TestImages`. It keeps the repository small and makes the intent readable.
- **Test the property, not the pixel.** A corner-detection test should assert that the
  detected quad is within a few percent of the true quad, not that it equals some
  recorded number. The `--margin` bug that shipped in an early draft was caught by
  asserting "the centre of the canvas is still paper", not by a golden image.
- **Document why a constant has its value.** Several of them look arbitrary and are
  not; `docs/algorithm.md` explains the ones that matter, and new ones should follow
  the same pattern.
- **Warnings are errors.** `TreatWarningsAsErrors` is on for `src/`. Keep it that way.
- **Prefer bit-identical parallelisation.** The row loops are parallelised. If you add
  one, make sure the result does not depend on the scheduling, and say so in a comment.

## Reporting a bad detection

The single most useful thing you can send is a photo the detector gets wrong:

1. Run `paperscan yourphoto.jpg` and keep `yourphoto-verify.png`.
2. Attach the verify image (or a downscaled copy — a 50 MP original is not needed) and
   say what the green quad should have hugged.
3. If you can work out the right corners manually, include them; they make a good
   regression case.

Please do not attach documents with personal information you would rather not publish.

## Pull requests

- One change per pull request. Bug fixes and behaviour changes are much easier to
  review on their own.
- Run `dotnet test` before pushing. CI runs it on Windows, Linux and macOS.
- Add a `CHANGELOG.md` entry under `## [Unreleased]`.
- If you change behaviour, update the relevant part of `README.md`,
  `README.zh-CN.md` and `docs/algorithm.md`. The two READMEs are meant to stay in sync.

## Code style

`.editorconfig` and `.gitattributes` are checked in; most editors pick them up
automatically. The short version:

- 4 spaces, no tabs.
- File-scoped namespaces, `var` only when the type is obvious from the right-hand side.
- Collection expressions (`[]`) over `new List<T>()` where they read better.
- Comments explain *why*. The code already says what.
