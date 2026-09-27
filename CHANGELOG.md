# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **A browser app** in `web/`: drop a photo on the page and get a scan back, with nothing to
  install. The whole pipeline runs on the device — the photo is never uploaded, and there is
  no server to pay for. `web/src/core/` is a dependency-free TypeScript port of the C#
  engine, verified against the same reference certificate (7487x5355, paper white
  R212 G203 B191, cropped 8/19/31/46 px). It builds to about 34 KB, so it opens instantly on
  a phone; a Blazor WebAssembly build would have reused the C# directly but cost roughly
  2 MB of runtime before looking at a single pixel.
- `web/tools/browser-check.mjs`: a dependency-free end-to-end smoke test that drives real
  Chrome over the DevTools Protocol, hands the file input a photo, and verifies the result
  card, the displayed stats and the download link.


## [1.0.0] - 2026-09-27

First release of PaperScan, a cross-platform rewrite of the v0 PowerShell tool.

### Added

- `PaperScan.Core`: image-independent engine — corner detection, homography
  rectification, percentile white balance, polygon framing and background trimming.
- `paperscan` command-line tool with English and Simplified Chinese output, batch
  input, and `--help` / `--version`.
- Windows drag-and-drop launcher (`scripts/paperscan.cmd`) and a cross-platform
  build/publish script (`scripts/build.ps1`).
- 44 xunit tests, including end-to-end tests over synthetic perspective photos.
- `--png fast|balanced|small`, selecting the PNG encoder effort.

### Changed relative to the v0 PowerShell implementation

- **Cross-platform.** The v0 tool needed Windows, PowerShell 5.1 and GDI+. The port
  targets .NET 8 and uses ImageSharp, so it runs on Windows, Linux and macOS.
- **~4x faster end to end.** Measured on a 6144×8192 (50 MP) photo of a certificate:
  ~10 s versus ~16 s for GDI+ alone, and the rectification stage is now 0.3 s
  instead of dominating the run. The sampling and white-balance loops are
  parallelised over rows; results stay bit-identical to a serial run.
- **PNG encoding is no longer the bottleneck.** The default is zlib level 1 with a
  Paeth filter: 6.8 s / 54.2 MB where the encoder default took 31.0 s / 49.4 MB.

### Fixed relative to the v0 PowerShell implementation

- **Closed printed borders no longer break corner detection.** v0 selected the
  largest connected bright blob, which on a bordered certificate is the area *inside*
  the frame. Detection now seeds on the blob with the largest bounding box and merges
  in every overlapping blob, including the small offcuts that hold the sheet's real
  corners.
- **The background trimmer matches the reference exactly.** v0 compared a
  floating-point luma; the first port of it compared a truncated integer luma, which
  raised the effective threshold and shifted the right-hand trim by two pixels.
- **Anti-aliased framing actually works.** The polygon interior test did not account
  for winding, so any non-zero `--margin` painted the entire canvas white. Caught by
  the test suite.

### Verification

The port was validated against the same certificate photo the v0 tool was built for:

```
paperscan 荣誉证书-原图.jpg -r right -c "5834,456;5789,7975;489,7975;424,520"
```

| Measurement | v0 (PowerShell + GDI+) | PaperScan |
|---|---|---|
| Rectified size | 7487 × 5355 | 7487 × 5355 |
| Paper white (p90) | R212 G203 B191 | R212 G203 B191 |
| Gains | R1.179 G1.232 B1.309 | R1.179 G1.232 B1.309 |
| Trim (left/top/bottom) | 8 / 19 / 46 px | 8 / 19 / 46 px |
| Trim (right) | 29 px | 31 px |
| Final size | 7450 × 5290 | 7448 × 5290 |
| Outermost row min luma (top/bottom/left/right) | 147 / 143 / 158 / 133 | 146 / 128 / 153 / 130 |

The two-pixel difference on the right edge comes from the JPEG decoders: GDI+ and
ImageSharp round differently, about a quarter of source pixels differ by ±1–3 per
channel, and that flips one of the 120 trim probes by two pixels. The property the
trimmer exists to guarantee — every border pixel is paper, not background — holds in
both: the dark surround sits at luma ~25–100, and every one of the eight outermost
row and column measurements is above 125.

[Unreleased]: https://github.com/YangRainmorning/PaperScan/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/YangRainmorning/PaperScan/releases/tag/v1.0.0
