using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace PaperScan;

/// <summary>Tunables for the background-trimming stage.</summary>
public sealed record TrimOptions
{
    /// <summary>Luma above which a pixel counts as paper.</summary>
    public int Threshold { get; init; } = 140;

    /// <summary>How many scan lines to probe per edge.</summary>
    public int SampleLines { get; init; } = 120;

    /// <summary>How far inwards each probe may travel before it gives up.</summary>
    public int MaxProbeDepth { get; init; } = 600;

    /// <summary>Probes start this far along each edge, as a fraction of its length.</summary>
    public double LineStart { get; init; } = 0.03;

    /// <summary>Fraction of each edge that is probed.</summary>
    public double LineSpan { get; init; } = 0.94;

    /// <summary>Minimum successful probes before an edge is trimmed at all.</summary>
    public int MinSamples { get; init; } = 10;

    /// <summary>Pixels shaved off beyond the detected paper edge, to remove the dark seam.</summary>
    public int Pad { get; init; } = 2;

    /// <summary>The crop is only applied if it keeps at least this many pixels in both axes.</summary>
    public int MinKeptSize { get; init; } = 10;
}

/// <summary>
/// Removes the sliver of background the homography drags in along the canvas edges.
/// </summary>
/// <remarks>
/// For each of the four edges the trimmer fires evenly spaced probes inwards and records the
/// first pixel that is paper-bright, confirmed by a second sample a few pixels further in so a
/// stray highlight cannot fool it. Each edge is then trimmed to the deepest result across all
/// probes, which guarantees the final image is paper right up to every border.
/// </remarks>
public static class EdgeTrimmer
{
    public static PixelRect? FindCrop(byte[] rgb, int width, int height, TrimOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(rgb);
        options ??= new TrimOptions();

        int depth = Math.Min(options.MaxProbeDepth, Math.Max(0, Math.Min(width, height) - 5));
        if (depth <= 4 || options.SampleLines <= 1)
        {
            return null;
        }

        List<int> tops = [];
        List<int> bottoms = [];
        List<int> lefts = [];
        List<int> rights = [];

        int lastLine = options.SampleLines - 1;

        for (int i = 0; i < options.SampleLines; i++)
        {
            int x = (int)(width * (options.LineStart + (options.LineSpan * i / lastLine)));
            if ((uint)x >= (uint)width)
            {
                continue;
            }

            for (int d = 0; d < depth; d++)
            {
                if (IsPaper(rgb, width, x, d, options.Threshold) &&
                    IsPaper(rgb, width, x, d + 4, options.Threshold))
                {
                    tops.Add(d);
                    break;
                }
            }

            for (int d = 0; d < depth; d++)
            {
                int y = height - 1 - d;
                if (IsPaper(rgb, width, x, y, options.Threshold) &&
                    IsPaper(rgb, width, x, y - 4, options.Threshold))
                {
                    bottoms.Add(y);
                    break;
                }
            }
        }

        for (int i = 0; i < options.SampleLines; i++)
        {
            int y = (int)(height * (options.LineStart + (options.LineSpan * i / lastLine)));
            if ((uint)y >= (uint)height)
            {
                continue;
            }

            for (int d = 0; d < depth; d++)
            {
                if (IsPaper(rgb, width, d, y, options.Threshold) &&
                    IsPaper(rgb, width, d + 4, y, options.Threshold))
                {
                    lefts.Add(d);
                    break;
                }
            }

            for (int d = 0; d < depth; d++)
            {
                int x = width - 1 - d;
                if (IsPaper(rgb, width, x, y, options.Threshold) &&
                    IsPaper(rgb, width, x - 4, y, options.Threshold))
                {
                    rights.Add(x);
                    break;
                }
            }
        }

        int top = 0;
        int bottom = height - 1;
        int left = 0;
        int right = width - 1;

        if (tops.Count > options.MinSamples)
        {
            top = tops.Max() + options.Pad;
        }

        if (bottoms.Count > options.MinSamples)
        {
            bottom = bottoms.Min() - options.Pad;
        }

        if (lefts.Count > options.MinSamples)
        {
            left = lefts.Max() + options.Pad;
        }

        if (rights.Count > options.MinSamples)
        {
            right = rights.Min() - options.Pad;
        }

        if (bottom <= top + options.MinKeptSize || right <= left + options.MinKeptSize)
        {
            return null;
        }

        return new PixelRect(left, top, right - left + 1, bottom - top + 1);
    }

    public static Image<Rgb24> Crop(byte[] rgb, int width, int height, PixelRect rect)
    {
        ArgumentNullException.ThrowIfNull(rgb);

        if (rect.X < 0 || rect.Y < 0 || rect.Right > width || rect.Bottom > height || rect.Width <= 0 || rect.Height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(rect), rect, "Crop rectangle falls outside the canvas.");
        }

        byte[] output = new byte[rect.Width * rect.Height * 3];
        int rowBytes = rect.Width * 3;

        for (int y = 0; y < rect.Height; y++)
        {
            int sourceOffset = (((rect.Y + y) * width) + rect.X) * 3;
            Array.Copy(rgb, sourceOffset, output, y * rowBytes, rowBytes);
        }

        return PixelOps.FromRgbBytes(output, rect.Width, rect.Height);
    }

    private static bool IsPaper(byte[] rgb, int width, int x, int y, int threshold)
    {
        int i = ((y * width) + x) * 3;
        return PixelOps.LumaTimesThousand(rgb[i], rgb[i + 1], rgb[i + 2]) > threshold * 1000;
    }
}
