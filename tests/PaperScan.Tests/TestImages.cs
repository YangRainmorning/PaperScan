using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace PaperScan.Tests;

/// <summary>Builds synthetic photos so the tests do not need any binary fixtures.</summary>
internal static class TestImages
{
    /// <summary>A slightly warm off-white page, like a photographed sheet of paper.</summary>
    public static readonly Rgb24 Paper = new(235, 227, 212);

    public static readonly Rgb24 Ink = new(40, 38, 36);

    public static readonly Rgb24 Background = new(45, 52, 58);

    /// <summary>
    /// An upright document: warm paper, a couple of printed rules and some text-like bars.
    /// </summary>
    /// <remarks>
    /// The decoration deliberately never encloses the paper. The corner detector picks the
    /// largest connected run of "bright and warm" pixels, so a closed printed border — like
    /// the one on many certificates — would make it lock onto the framed area instead of the
    /// sheet. That is a documented limitation, and the fixtures must not trip over it by
    /// accident.
    /// </remarks>
    public static Image<Rgb24> Document(int width = 900, int height = 1200)
    {
        const int Margin = 40;

        Image<Rgb24> image = new(width, height, Paper);

        image.ProcessPixelRows(accessor =>
        {
            DrawBar(accessor, Margin + 20, 60, width - (2 * Margin) - 40, 8);
            DrawBar(accessor, Margin + 20, height - 68, width - (2 * Margin) - 40, 8);

            for (int line = 0; line < 22; line++)
            {
                int y = 120 + (line * 44);
                if (y + 14 >= height - 120)
                {
                    break;
                }

                int length = 120 + (((line * 37) % 11) * 50);
                DrawBar(accessor, 110, y, Math.Min(length, width - 220), 14);
            }
        });

        return image;

        static void DrawBar(PixelAccessor<Rgb24> accessor, int x, int y, int barWidth, int barHeight)
        {
            for (int dy = 0; dy < barHeight; dy++)
            {
                int row = y + dy;
                if (row < 0 || row >= accessor.Height)
                {
                    continue;
                }

                Span<Rgb24> span = accessor.GetRowSpan(row);
                for (int dx = 0; dx < barWidth; dx++)
                {
                    int column = x + dx;
                    if (column >= 0 && column < span.Length)
                    {
                        span[column] = Ink;
                    }
                }
            }
        }
    }

    /// <summary>
    /// A document with a closed printed border — the shape that breaks naive
    /// "largest bright blob" corner detection, because the border separates the paper into
    /// an outer ring and a much bigger inner region.
    /// </summary>
    public static Image<Rgb24> BorderedDocument(int width = 900, int height = 1200)
    {
        const int OuterMargin = 45;
        const int BorderThickness = 10;

        Image<Rgb24> image = new(width, height, Paper);

        image.ProcessPixelRows(accessor =>
        {
            for (int y = 0; y < accessor.Height; y++)
            {
                Span<Rgb24> row = accessor.GetRowSpan(y);

                for (int x = 0; x < accessor.Width; x++)
                {
                    bool onBorder =
                        (x >= OuterMargin && x < OuterMargin + BorderThickness) ||
                        (x >= width - OuterMargin - BorderThickness && x < width - OuterMargin) ||
                        (y >= OuterMargin && y < OuterMargin + BorderThickness) ||
                        (y >= height - OuterMargin - BorderThickness && y < height - OuterMargin);

                    if (onBorder)
                    {
                        row[x] = Ink;
                    }
                }
            }
        });

        return image;
    }

    /// <summary>
    /// Perspective-blits <paramref name="document"/> into <paramref name="quad"/> on a dark
    /// background, producing something that looks like a phone photo of a page.
    /// </summary>
    public static Image<Rgb24> PhotoOfDocument(Image<Rgb24> document, Quad quad, int width, int height)
    {
        byte[] source = PixelOps.ToRgbBytes(document);
        int dw = document.Width;
        int dh = document.Height;

        Homography inverse = Homography.FromUnitSquare(quad);
        Image<Rgb24> photo = new(width, height, Background);

        photo.ProcessPixelRows(accessor =>
        {
            for (int y = 0; y < accessor.Height; y++)
            {
                Span<Rgb24> row = accessor.GetRowSpan(y);

                for (int x = 0; x < accessor.Width; x++)
                {
                    PointD uv = inverse.MapInverse(x + 0.5, y + 0.5);
                    if (uv.X < 0 || uv.X >= 1 || uv.Y < 0 || uv.Y >= 1)
                    {
                        continue;
                    }

                    int sx = Math.Clamp((int)(uv.X * dw), 0, dw - 1);
                    int sy = Math.Clamp((int)(uv.Y * dh), 0, dh - 1);
                    int i = ((sy * dw) + sx) * 3;
                    row[x] = new Rgb24(source[i], source[i + 1], source[i + 2]);
                }
            }
        });

        return photo;
    }

    /// <summary>A page quad that is roughly centred in a photo of the given size.</summary>
    public static Quad CenteredQuad(int width, int height) => new(
        new PointD(width * 0.18, height * 0.12),
        new PointD(width * 0.82, height * 0.17),
        new PointD(width * 0.80, height * 0.88),
        new PointD(width * 0.20, height * 0.84));

    /// <summary>A tall, only mildly skewed page quad — what a phone held upright produces.</summary>
    public static Quad PortraitQuad(int width, int height) => new(
        new PointD(width * 0.30, height * 0.06),
        new PointD(width * 0.72, height * 0.09),
        new PointD(width * 0.68, height * 0.94),
        new PointD(width * 0.26, height * 0.91));
}

/// <summary>A scratch directory that deletes itself.</summary>
internal sealed class TempWorkspace : IDisposable
{
    public TempWorkspace()
    {
        Root = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "paperscan-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Root);
    }

    public string Root { get; }

    /// <summary>Resolves a file name inside the workspace.</summary>
    public string PathOf(string name) => System.IO.Path.Combine(Root, name);

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
        catch (IOException)
        {
            // A leftover temp directory is not worth failing a test over.
        }
    }
}
