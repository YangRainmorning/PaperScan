using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace PaperScan;

/// <summary>Tunables for the rectification and white-balance stage.</summary>
public sealed record WarpOptions
{
    /// <summary>
    /// White border to add around the page, as a fraction of the page size
    /// (0.03 = 3% on every side). Zero produces a tight crop.
    /// </summary>
    public double Margin { get; init; }

    /// <summary>Brightness the paper is normalised to. 250 leaves a little headroom below pure white.</summary>
    public int TargetWhite { get; init; } = 250;

    /// <summary>Percentile of each channel treated as "paper white".</summary>
    public double WhitePercentile { get; init; } = 0.90;

    /// <summary>Expansion applied to the page polygon when framing the canvas, so edges are cleanly cut.</summary>
    public double EdgeOverscan { get; init; } = 1.002;
}

/// <summary>The rectified canvas: pixels are already white-balanced.</summary>
public sealed class WarpResult
{
    public required byte[] Pixels { get; init; }

    public required int CanvasWidth { get; init; }

    public required int CanvasHeight { get; init; }

    public required int PaperWidth { get; init; }

    public required int PaperHeight { get; init; }

    /// <summary>The per-channel percentile values measured on the raw canvas, before balancing.</summary>
    public required double[] Percentiles { get; init; }

    /// <summary>Per-channel gains that were applied.</summary>
    public required double[] Gains { get; init; }

    public required Homography Homography { get; init; }

    public required Quad PaperQuad { get; init; }

    public required double Margin { get; init; }
}

/// <summary>
/// Resamples the page out of the photo with a homography and normalises the paper to white.
/// </summary>
/// <remarks>
/// <para>
/// The canvas is produced at 1:1 source resolution: its size is the average edge length of the
/// page quad, so no detail is invented and none is thrown away. Sampling is bilinear.
/// </para>
/// <para>
/// The white balance is a per-channel percentile stretch: the value at the given percentile of
/// each channel is treated as "paper white" and mapped to <see cref="WarpOptions.TargetWhite"/>.
/// That removes the warm tint of indoor lighting while leaving the hue of stamps and artwork
/// alone, unlike a grey-world or histogram-equalisation approach.
/// </para>
/// <para>
/// Both hot loops are parallelised over rows. The results are bit-identical to a serial run
/// because the per-pixel work is independent and the histogram accumulators are integers.
/// </para>
/// </remarks>
public static class Warper
{
    public static WarpResult Warp(Image<Rgb24> source, Quad paper, WarpOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        options ??= new WarpOptions();

        if (options.Margin is < 0 or > 0.5)
        {
            throw new ArgumentOutOfRangeException(nameof(options), options.Margin, "Margin must be between 0 and 0.5.");
        }

        (double paperWidthF, double paperHeightF) = paper.PaperSize;
        int paperWidth = Math.Max(1, (int)Math.Round(paperWidthF));
        int paperHeight = Math.Max(1, (int)Math.Round(paperHeightF));

        double k = 1 + (2 * options.Margin);
        Quad canvasQuad = paper.ExpandAboutCentroid(k);
        int canvasWidth = Math.Max(1, (int)Math.Round(paperWidth * k));
        int canvasHeight = Math.Max(1, (int)Math.Round(paperHeight * k));

        Homography homography = Homography.FromUnitSquare(canvasQuad);
        double[] h = homography.Coefficients;
        double a11 = h[0], a12 = h[1], a13 = h[2], a21 = h[3], a22 = h[4], a23 = h[5], a31 = h[6], a32 = h[7];

        byte[] src = PixelOps.ToRgbBytes(source);
        int sourceWidth = source.Width;
        int sourceHeight = source.Height;
        int sourceStride = sourceWidth * 3;

        byte[] dst = new byte[canvasWidth * canvasHeight * 3];

        // Histograms are accumulated per thread and merged at the end, so the totals — and
        // therefore the gains — do not depend on how the work was scheduled.
        long[] histogram = new long[768];
        object mergeLock = new();

        Parallel.For(
            0,
            canvasHeight,
            () => new long[768],
            (py, _, local) =>
            {
                double v = (py + 0.5) / canvasHeight;
                int rowBase = py * canvasWidth * 3;
                double maxX = sourceWidth - 1.001;
                double maxY = sourceHeight - 1.001;

                for (int px = 0; px < canvasWidth; px++)
                {
                    double u = (px + 0.5) / canvasWidth;
                    double den = (a31 * u) + (a32 * v) + 1.0;
                    double sx = ((a11 * u) + (a12 * v) + a13) / den;
                    double sy = ((a21 * u) + (a22 * v) + a23) / den;

                    if (sx < 0)
                    {
                        sx = 0;
                    }

                    if (sy < 0)
                    {
                        sy = 0;
                    }

                    if (sx > maxX)
                    {
                        sx = maxX;
                    }

                    if (sy > maxY)
                    {
                        sy = maxY;
                    }

                    int x0 = (int)sx;
                    int y0 = (int)sy;
                    double fx = sx - x0;
                    double fy = sy - y0;

                    int i00 = (y0 * sourceStride) + (x0 * 3);
                    int i10 = i00 + 3;
                    int i01 = i00 + sourceStride;
                    int i11 = i01 + 3;

                    double w00 = (1 - fx) * (1 - fy);
                    double w10 = fx * (1 - fy);
                    double w01 = (1 - fx) * fy;
                    double w11 = fx * fy;

                    int r = Clamp((int)((src[i00] * w00) + (src[i10] * w10) + (src[i01] * w01) + (src[i11] * w11)));
                    int g = Clamp((int)((src[i00 + 1] * w00) + (src[i10 + 1] * w10) + (src[i01 + 1] * w01) + (src[i11 + 1] * w11)));
                    int b = Clamp((int)((src[i00 + 2] * w00) + (src[i10 + 2] * w10) + (src[i01 + 2] * w01) + (src[i11 + 2] * w11)));

                    int q = rowBase + (px * 3);
                    dst[q] = (byte)r;
                    dst[q + 1] = (byte)g;
                    dst[q + 2] = (byte)b;

                    local[r]++;
                    local[256 + g]++;
                    local[512 + b]++;
                }

                return local;
            },
            local =>
            {
                lock (mergeLock)
                {
                    for (int i = 0; i < 768; i++)
                    {
                        histogram[i] += local[i];
                    }
                }
            });

        long total = (long)canvasWidth * canvasHeight;
        double[] percentiles = new double[3];
        double[] gains = new double[3];

        for (int c = 0; c < 3; c++)
        {
            percentiles[c] = Percentile(histogram.AsSpan(c * 256, 256), total, options.WhitePercentile);
            gains[c] = options.TargetWhite / Math.Max(1.0, percentiles[c]);
        }

        double gainR = gains[0], gainG = gains[1], gainB = gains[2];

        Parallel.For(0, canvasHeight, py =>
        {
            int start = py * canvasWidth * 3;
            int end = start + (canvasWidth * 3);

            for (int i = start; i < end; i += 3)
            {
                dst[i] = (byte)Clamp((int)(dst[i] * gainR));
                dst[i + 1] = (byte)Clamp((int)(dst[i + 1] * gainG));
                dst[i + 2] = (byte)Clamp((int)(dst[i + 2] * gainB));
            }
        });

        return new WarpResult
        {
            Pixels = dst,
            CanvasWidth = canvasWidth,
            CanvasHeight = canvasHeight,
            PaperWidth = paperWidth,
            PaperHeight = paperHeight,
            Percentiles = percentiles,
            Gains = gains,
            Homography = homography,
            PaperQuad = paper,
            Margin = options.Margin,
        };
    }

    private static int Clamp(int v) => v < 0 ? 0 : v > 255 ? 255 : v;

    private static double Percentile(ReadOnlySpan<long> histogram, long total, double percentile)
    {
        long target = (long)Math.Ceiling(total * percentile);
        long accumulated = 0;

        for (int value = 0; value < histogram.Length; value++)
        {
            accumulated += histogram[value];
            if (accumulated >= target)
            {
                return value;
            }
        }

        return 255;
    }
}
