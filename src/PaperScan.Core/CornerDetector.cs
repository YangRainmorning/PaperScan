using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace PaperScan;

/// <summary>Tunables for automatic corner detection.</summary>
public sealed record CornerDetectionOptions
{
    /// <summary>Long edge, in pixels, of the thumbnail the detector actually works on.</summary>
    public int ThumbnailLongEdge { get; init; } = 1024;

    /// <summary>A pixel is "paper" only if its red channel is at least this bright.</summary>
    public int MinRed { get; init; } = 165;

    /// <summary>Minimum red-minus-blue difference (paper reads warm under typical indoor light).</summary>
    public int MinWarmth { get; init; } = 6;

    /// <summary>Maximum red-minus-blue difference; above this the pixel is considered coloured.</summary>
    public int MaxWarmth { get; init; } = 75;

    /// <summary>
    /// A connected blob is only considered a candidate page if it covers at least this
    /// fraction of the thumbnail. Keeps isolated highlights from being mistaken for paper.
    /// </summary>
    public double MinComponentFraction { get; init; } = 0.01;

    /// <summary>
    /// Bounding boxes are grown by this fraction of the thumbnail's long edge before the
    /// overlap test, so blobs that were torn apart by downscaling are still recognised as
    /// belonging to the same sheet.
    /// </summary>
    public double MergeMarginFraction { get; init; } = 0.012;
}

/// <summary>Result of an automatic corner search.</summary>
public sealed record CornerDetectionResult(
    Quad PhotoOrder,
    double PaperFraction,
    int ThumbnailWidth,
    int ThumbnailHeight);

/// <summary>
/// Finds the page in a photo without any machine learning: threshold the image down to
/// "bright, slightly warm" pixels, group them into connected blobs, and read the extreme
/// points of the page off the diagonals.
/// </summary>
/// <remarks>
/// <para>
/// Picking the <em>biggest</em> blob is not enough. Certificates and diplomas usually carry a
/// printed border, and that border — being neither bright nor warm — splits the paper into an
/// outer ring and a much larger inner rectangle. The inner rectangle wins on pixel count, so
/// naive detection crops the page to the inside of its own frame.
/// </para>
/// <para>
/// Instead the detector seeds on the blob with the largest <em>bounding box</em> and then
/// merges in every other candidate whose bounding box overlaps the seed's. The printed border
/// becomes irrelevant: the ring and the region it encloses are treated as one page, and the
/// ring is what actually reaches the corners.
/// </para>
/// </remarks>
public static class CornerDetector
{
    public static CornerDetectionResult Detect(
        Image<Rgb24> source,
        CornerDetectionOptions? options = null,
        string? verifyImagePath = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        options ??= new CornerDetectionOptions();

        (int tw, int th) = ThumbnailSize(source.Width, source.Height, options.ThumbnailLongEdge);

        using Image<Rgb24> thumb = source.Clone(ctx => ctx.Resize(new ResizeOptions
        {
            Size = new Size(tw, th),
            Sampler = KnownResamplers.Bicubic,
            Mode = ResizeMode.Stretch,
        }));

        byte[] rgb = PixelOps.ToRgbBytes(thumb);
        bool[] mask = new bool[tw * th];
        for (int y = 0; y < th; y++)
        {
            for (int x = 0; x < tw; x++)
            {
                mask[(y * tw) + x] = IsPaper(rgb, (y * tw) + x, options);
            }
        }

        (int[] labels, List<Component> components) = Label(mask, tw, th);

        if (components.Count == 0)
        {
            throw new NoPageFoundException(verifyImagePath);
        }

        int minimumSize = Math.Max(64, (int)(tw * th * options.MinComponentFraction));
        List<Component> candidates = components.Where(c => c.Size >= minimumSize).ToList();

        if (candidates.Count == 0)
        {
            throw new NoPageFoundException(verifyImagePath);
        }

        Component seed = candidates
            .OrderByDescending(c => (long)c.Width * c.Height)
            .ThenByDescending(c => c.Size)
            .First();

        // Merge everything that touches the seed's neighbourhood, including blobs far too
        // small to seed a detection themselves. Downscaling a thin printed border splits it
        // into separate bands, and the sheet's actual corners live in the little offcuts —
        // dropping them would leave the detection a few dozen pixels inside the paper.
        int margin = Math.Max(3, (int)Math.Round(Math.Max(tw, th) * options.MergeMarginFraction));
        Component searchArea = seed.Expand(margin);
        HashSet<int> keptLabels = components.Where(c => c.Expand(margin).Overlaps(searchArea)).Select(c => c.Label).ToHashSet();

        int tl = -1, tr = -1, br = -1, bl = -1;
        int minSum = int.MaxValue, maxDiff = int.MinValue, maxSum = int.MinValue, minDiff = int.MaxValue;
        int keptPixels = 0;

        for (int i = 0; i < labels.Length; i++)
        {
            if (!keptLabels.Contains(labels[i]))
            {
                continue;
            }

            keptPixels++;
            int x = i % tw;
            int y = i / tw;
            int sum = x + y;
            int diff = x - y;

            if (sum < minSum)
            {
                minSum = sum;
                tl = i;
            }

            if (diff > maxDiff)
            {
                maxDiff = diff;
                tr = i;
            }

            if (sum > maxSum)
            {
                maxSum = sum;
                br = i;
            }

            if (diff < minDiff)
            {
                minDiff = diff;
                bl = i;
            }
        }

        Quad thumbnailQuad = new(
            new PointD(tl % tw, tl / tw),
            new PointD(tr % tw, tr / tw),
            new PointD(br % tw, br / tw),
            new PointD(bl % tw, bl / tw));

        if (verifyImagePath is not null)
        {
            WriteVerifyImage(rgb, tw, th, thumbnailQuad, verifyImagePath);
        }

        double kx = (double)source.Width / tw;
        double ky = (double)source.Height / th;

        Quad sourceQuad = new(
            new PointD(thumbnailQuad.TopLeft.X * kx, thumbnailQuad.TopLeft.Y * ky),
            new PointD(thumbnailQuad.TopRight.X * kx, thumbnailQuad.TopRight.Y * ky),
            new PointD(thumbnailQuad.BottomRight.X * kx, thumbnailQuad.BottomRight.Y * ky),
            new PointD(thumbnailQuad.BottomLeft.X * kx, thumbnailQuad.BottomLeft.Y * ky));

        return new CornerDetectionResult(sourceQuad, (double)keptPixels / (tw * th), tw, th);
    }

    internal static (int Width, int Height) ThumbnailSize(int width, int height, int longEdge)
    {
        double scale = (double)longEdge / Math.Max(width, height);
        int tw = Math.Max(1, (int)Math.Round(width * scale));
        int th = Math.Max(1, (int)Math.Round(height * scale));
        return (tw, th);
    }

    private static bool IsPaper(byte[] rgb, int pixelIndex, CornerDetectionOptions o)
    {
        int i = pixelIndex * 3;
        int r = rgb[i];
        int g = rgb[i + 1];
        int b = rgb[i + 2];

        if (r < o.MinRed)
        {
            return false;
        }

        int warmth = r - b;
        if (warmth < o.MinWarmth || warmth > o.MaxWarmth)
        {
            return false;
        }

        return g >= b;
    }

    private static (int[] Labels, List<Component> Components) Label(bool[] mask, int width, int height)
    {
        int[] labels = new int[mask.Length];
        int[] stack = new int[mask.Length];
        List<Component> components = [];

        for (int start = 0; start < mask.Length; start++)
        {
            if (!mask[start] || labels[start] != 0)
            {
                continue;
            }

            int label = components.Count + 1;
            int sp = 0;
            stack[sp++] = start;
            labels[start] = label;

            int size = 0;
            int minX = width, minY = height, maxX = -1, maxY = -1;

            while (sp > 0)
            {
                int p = stack[--sp];
                size++;

                int px = p % width;
                int py = p / width;

                if (px < minX)
                {
                    minX = px;
                }

                if (px > maxX)
                {
                    maxX = px;
                }

                if (py < minY)
                {
                    minY = py;
                }

                if (py > maxY)
                {
                    maxY = py;
                }

                if (px > 0)
                {
                    Push(p - 1, px - 1, py);
                }

                if (px < width - 1)
                {
                    Push(p + 1, px + 1, py);
                }

                if (py > 0)
                {
                    Push(p - width, px, py - 1);
                }

                if (py < height - 1)
                {
                    Push(p + width, px, py + 1);
                }

                void Push(int q, int qx, int qy)
                {
                    if (mask[q] && labels[q] == 0)
                    {
                        labels[q] = label;
                        stack[sp++] = q;
                    }
                }
            }

            components.Add(new Component(label, size, minX, minY, maxX, maxY));
        }

        return (labels, components);
    }

    private static void WriteVerifyImage(byte[] rgb, int width, int height, Quad quad, string path)
    {
        byte[] overlay = (byte[])rgb.Clone();
        Rgb24 green = new(0, 255, 0);
        Rgb24 red = new(255, 0, 0);

        for (int i = 0; i < 4; i++)
        {
            Raster.DrawLine(overlay, width, height, quad[i], quad[(i + 1) % 4], green);
        }

        for (int i = 0; i < 4; i++)
        {
            Raster.DrawDisc(overlay, width, height, quad[i], 5, red);
        }

        using Image<Rgb24> image = PixelOps.FromRgbBytes(overlay, width, height);
        ImageIO.SavePng(image, path);
    }

    private readonly record struct Component(int Label, int Size, int MinX, int MinY, int MaxX, int MaxY)
    {
        public int Width => MaxX - MinX + 1;

        public int Height => MaxY - MinY + 1;

        /// <summary>Grows the bounding box on all sides, to bridge gaps left by downscaling.</summary>
        public Component Expand(int margin) =>
            new(Label, Size, MinX - margin, MinY - margin, MaxX + margin, MaxY + margin);

        public bool Overlaps(Component other) =>
            MinX <= other.MaxX && other.MinX <= MaxX && MinY <= other.MaxY && other.MinY <= MaxY;
    }
}

/// <summary>Thrown when a photo contains nothing that looks like a page.</summary>
public sealed class NoPageFoundException : InvalidOperationException
{
    public NoPageFoundException(string? verifyImagePath)
        : base("No page was found in this photo. Try photographing it against a contrasting background with even lighting, "
             + "or pass the corners manually with --corners.")
    {
        VerifyImagePath = verifyImagePath;
    }

    public string? VerifyImagePath { get; }
}
