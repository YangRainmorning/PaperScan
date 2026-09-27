# How PaperScan works

Five stages, in this order. Each one is a separate type in `src/PaperScan.Core` so
they can be tested and replaced independently.

```
photo.jpg
    │
    ├─ 1. CornerDetector   → Quad (page corners, in source pixels)
    │
    ├─ 2. Warper           → WarpResult (rectified canvas + white-balance gains)
    │
    ├─ 3. CanvasFramer     → Image<Rgb24> (page polygon clipped onto white)
    │
    ├─ 4. EdgeTrimmer      → PixelRect (the crop that removes the background)
    │
    └─ 5. ImageIO          → scan.png
```

---

## 1. Corner detection

`CornerDetector.Detect`

The photo is first downscaled so its long edge is `ThumbnailLongEdge` (default 1024)
using a bicubic resample. Everything after this works on the thumbnail, which is why
detection costs a fraction of a second on a 50 MP photo. Corners are scaled back to
source coordinates at the end.

A pixel counts as **paper** when all three hold:

| Test | Default | Why |
|---|---|---|
| `r >= MinRed` | 165 | Paper is bright. |
| `MinWarmth <= r - b <= MaxWarmth` | 6 … 75 | Paper under indoor light is warm, but not orange. A negative or tiny `r - b` means a white wall or a grey surface; a large one means wood, skin or a coloured object. |
| `g >= b` | — | Rejects bluish surfaces such as a monitor or a window reflection. |

The mask is then labelled into 4-connected components.

**Picking the page is the interesting part.** The obvious approach — take the largest
component — has a failure mode that matters, because certificates and diplomas usually
carry a printed border:

```
┌─────────────────────────┐   The border is neither bright nor warm, so it
│ ░░░░░░░░░░░░░░░░░░░░░░░ │   splits the paper into two components:
│ ░ ┌─────────────────┐ ░ │
│ ░ │                 │ ░ │     outer ring   ~47 000 px
│ ░ │   inner region  │ ░ │     inner region ~182 000 px
│ ░ │                 │ ░ │
│ ░ └─────────────────┘ ░ │   The inner region wins on pixel count, so a
│ ░░░░░░░░░░░░░░░░░░░░░░░ │   naive detector crops the page inside its
└─────────────────────────┘   own frame — off by the width of the border.
```

PaperScan instead:

1. Discards components smaller than `MinComponentFraction` (default 1%) of the
   thumbnail, so an isolated highlight cannot seed a detection.
2. Seeds on the surviving component with the largest **bounding box** (not the
   largest pixel count). For a bordered document that is the outer ring, whose
   bounding box really is the sheet.
3. Merges in every component whose bounding box, grown by `MergeMarginFraction`
   (default 1.2% of the long edge), overlaps the seed's grown bounding box. The size
   filter deliberately does **not** apply here.

Step 3 matters more than it looks. Downscaling a thin border tears it into separate
bands, and — because the page is usually slightly rotated — the sheet's actual corners
end up in small offcuts of a few hundred pixels that are far too small to be
candidates. Skipping them leaves the detected quad twenty to forty pixels inside the
real page. The margin in the overlap test bridges the gaps that downscaling opens up.

Finally the corners are read off the merged pixel set:

```
top-left     = argmin(x + y)
top-right    = argmax(x − y)
bottom-right = argmax(x + y)
bottom-left  = argmin(x − y)
```

This is exact for a convex quad, and costs one pass. The result is in **photo order**;
`Quad.Rotate(ReadingEdge)` relabels it into reading order.

### Why not Hough / contours / ML

A Hough transform or an edge-contour detector would handle harder backgrounds, at the
cost of a larger parameter surface and much more code. The threshold-and-blob approach
covers the case this tool is for — a sheet of paper on a desk — in about 120 lines, and
`--corners` covers the rest. A segmentation model would add a 5–50 MB download and turn
an offline tool into one that is worse offline.

---

## 2. Rectification and white balance

`Warper.Warp`

**Output size.** The canvas is sized from the page quad's own edges:

```
paperWidth  = round((|TL−TR| + |BL−BR|) / 2)
paperHeight = round((|TL−BL| + |TR−BR|) / 2)
```

Averaging opposite edges compensates for the perspective foreshortening that makes one
edge of the photo shorter than the other. Because the size comes from the *source*
distances, the output is a 1:1 resample: a 40 MP page produces a ~40 MP canvas.

**Homography.** `Homography.FromUnitSquare` solves

```
x = (h11·u + h12·v + h13) / (h31·u + h32·v + 1)
y = (h21·u + h22·v + h23) / (h31·u + h32·v + 1)
```

for the eight unknowns, given the four correspondences (0,0)→TL, (1,0)→TR, (1,1)→BR,
(0,1)→BL. That is an 8×8 linear system, solved by Gauss-Jordan elimination with
partial pivoting. Degenerate quads (all four corners identical) are detected by a
near-zero pivot and reported rather than producing a garbage image.

**Sampling.** For each output pixel the homography is evaluated forwards — output
canvas coordinates to source coordinates — and the source is sampled bilinearly. The
forward direction matters: inverse mapping output→source means every output pixel gets
exactly one sample, so there are no holes and no duplicated rows, which a
source→destination loop would produce wherever the mapping stretches.

**White balance.** Per-channel histograms are accumulated over the whole canvas,
including any margin. The 90th percentile of each channel is the "paper white" for
that channel, and the gain is `250 / max(1, percentile)`. The percentile is used
rather than the mean or the maximum because:

- the mean is dragged around by how much ink is on the page,
- the maximum is a single hot pixel,
- the 90th percentile is paper by construction on any normal document, and is stable
  as long as at least 10% of the canvas is blank paper.

The gain is applied uniformly, so hue relationships inside artwork and stamps are
preserved. This is deliberately *not* grey-world or histogram equalisation, both of
which would neutralise the red of a seal.

Both the sampling loop and the gain loop are parallelised over rows. The pixel work is
independent and the histogram accumulators are `long`, merged under a lock at the end,
so the result is bit-identical to a serial run — the test suite asserts this.

---

## 3. Framing

`CanvasFramer.Frame`

With `--margin 0` the canvas *is* the page, and framing is a no-op.

With a margin, the canvas is the page quad expanded about its centroid by
`1 + 2·margin`, and the page polygon (expanded by `EdgeOverscan`, 1.002) is drawn on a
white background. Pixels outside the polygon become white; pixels on the boundary are
blended using 4×4 supersampled coverage, so the edge is anti-aliased rather than
stair-stepped.

The interior/outside test uses signed distances to the four edges, which is exact and
cheap for a convex polygon. The sign convention has to come from the polygon's winding
(its signed area), because the same polygon traversed the other way has all distances
negated — a bug that paints the entire canvas white, and that the test suite caught.

---

## 4. Background trimming

`EdgeTrimmer.FindCrop`

Even with perfect corner detection, the homography pulls in a sliver of the surface the
page was lying on, because the detected quad is a few pixels out. Framing leaves that
sliver; trimming removes it.

For each of the four edges, 120 probes are fired inwards, evenly spaced across the
middle 94% of the edge. A probe stops at the first pixel whose luma exceeds
`Threshold` (140) **and** whose neighbour 4 px further in also does. The double sample
is what stops a single specular highlight or a bright speck of dust from ending a
probe early.

The edge is then cropped to the deepest result across all probes, plus a 2 px pad, and
only if at least 10 probes succeeded and the resulting rectangle is still at least
`MinKeptSize` in both axes. Cropping to the *deepest* result — rather than, say, the
median — is what guarantees the output is paper right up to all four borders.

Luma is computed as `(299r + 587g + 114b)` and compared against `threshold * 1000`,
without ever dividing. The portable reference implementation divided by 1000 in
floating point; an earlier version of the port truncated to an integer first, which
raised the effective threshold and shifted the right-hand trim by two pixels on the
reference certificate.

---

## 5. Output

`ImageIO.SavePng`

24-bit RGB PNG, no alpha channel, no colour profile, no metadata. The encoder's filter
is fixed to Paeth.

Measured on a representative 40 MP scan:

| Setting | Time | Size |
|---|---|---|
| `PngCompressionLevel.BestSpeed` + no filter | 8.1 s | 70.9 MB |
| **`Level1` + Paeth (`--png fast`, default)** | **6.8 s** | **54.2 MB** |
| `DefaultCompression` + Paeth (`--png balanced`) | 32.5 s | 49.4 MB |
| `DefaultCompression` + adaptive filter | 31.0 s | 49.4 MB |

Paeth at the same compression level produces identical files to the adaptive filter
chooser on real scans, while skipping the evaluation of all five predictors per row.
Level 1 gives up 10% of size for a 4.6× speedup, which is the right default for a
command-line tool; `--png balanced` is there for archiving.

---

## Parameters worth knowing

| Parameter | Default | Effect of raising it |
|---|---|---|
| `ThumbnailLongEdge` | 1024 | More accurate corners on heavily skewed pages, slower detection. |
| `MinRed` | 165 | Stricter about what counts as paper; helps on grey backgrounds, hurts in dim light. |
| `MinComponentFraction` | 0.01 | Harder for an incidental bright object to seed a detection. |
| `MergeMarginFraction` | 0.012 | Merges blobs further apart; too high and an unrelated bright object joins the page. |
| `WhitePercentile` | 0.90 | Lower is more aggressive at removing colour casts, but starts to clip the lightest paper texture. |
| `TargetWhite` | 250 | Lower gives a slightly greyer, less blown-out page. |
| `TrimOptions.Threshold` | 140 | Higher trims more aggressively and risks biting into a dark printed border. |
| `TrimOptions.MaxProbeDepth` | 600 | How far inwards a probe may travel before giving up. |

All of these are properties on `CornerDetectionOptions`, `WarpOptions` and
`TrimOptions`, settable from `ScanOptions` — the CLI exposes the common ones.
