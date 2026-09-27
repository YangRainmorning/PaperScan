using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace PaperScan;

/// <summary>
/// Turns the rectified canvas into the final image: the page polygon is drawn on a white
/// background, so anything outside the page quad becomes a clean white border instead of
/// the stray pixels the homography pulled in from the background.
/// </summary>
public static class CanvasFramer
{
    public static Image<Rgb24> Frame(WarpResult warp, double edgeOverscan = 1.002)
    {
        ArgumentNullException.ThrowIfNull(warp);
        return Frame(warp, edgeOverscan, out _);
    }

    public static Image<Rgb24> Frame(WarpResult warp, double edgeOverscan, out PointD[]? clipPolygon)
    {
        ArgumentNullException.ThrowIfNull(warp);

        int width = warp.CanvasWidth;
        int height = warp.CanvasHeight;

        // A zero margin means the canvas *is* the page, and the overscanned polygon is
        // strictly larger than the canvas, so there is nothing to clip.
        if (warp.Margin <= 0)
        {
            clipPolygon = null;
            return PixelOps.FromRgbBytes(warp.Pixels, width, height);
        }

        Quad paper = warp.PaperQuad;
        PointD c = paper.Centroid;
        PointD[] polygon = new PointD[4];
        for (int i = 0; i < 4; i++)
        {
            PointD source = new(
                c.X + ((paper[i].X - c.X) * edgeOverscan),
                c.Y + ((paper[i].Y - c.Y) * edgeOverscan));
            PointD uv = warp.Homography.MapInverse(source.X, source.Y);
            polygon[i] = new PointD(uv.X * width, uv.Y * height);
        }

        clipPolygon = polygon;

        byte[] output = (byte[])warp.Pixels.Clone();
        Parallel.For(0, height, y =>
        {
            int rowBase = y * width * 3;
            for (int x = 0; x < width; x++)
            {
                double coverage = Coverage(polygon, x + 0.5, y + 0.5);
                if (coverage >= 1.0)
                {
                    continue;
                }

                int i = rowBase + (x * 3);
                if (coverage <= 0.0)
                {
                    output[i] = 255;
                    output[i + 1] = 255;
                    output[i + 2] = 255;
                    continue;
                }

                double inverse = 1.0 - coverage;
                output[i] = Blend(output[i], coverage, inverse);
                output[i + 1] = Blend(output[i + 1], coverage, inverse);
                output[i + 2] = Blend(output[i + 2], coverage, inverse);
            }
        });

        return PixelOps.FromRgbBytes(output, width, height);
    }

    private static byte Blend(byte value, double coverage, double inverse)
    {
        double blended = (value * coverage) + (255.0 * inverse);
        return (byte)(blended < 0 ? 0 : blended > 255 ? 255 : (int)Math.Round(blended));
    }

    /// <summary>Anti-aliased coverage of a convex polygon at a point, in the range 0..1.</summary>
    private static double Coverage(PointD[] polygon, double x, double y)
    {
        // Signed area tells us the winding. With the shoelace sign convention below,
        // "inside" is "every edge cross product positive".
        double doubleArea = 0;
        for (int i = 0; i < 4; i++)
        {
            PointD a = polygon[i];
            PointD b = polygon[(i + 1) % 4];
            doubleArea += (a.X * b.Y) - (b.X * a.Y);
        }

        double orientation = doubleArea >= 0 ? 1.0 : -1.0;

        double minDistance = double.MaxValue;
        double maxDistance = double.MinValue;

        for (int i = 0; i < 4; i++)
        {
            PointD a = polygon[i];
            PointD b = polygon[(i + 1) % 4];
            double ex = b.X - a.X;
            double ey = b.Y - a.Y;
            double length = Math.Sqrt((ex * ex) + (ey * ey));
            if (length < 1e-9)
            {
                return 1.0;
            }

            double distance = orientation * (((y - a.Y) * ex) - ((x - a.X) * ey)) / length;
            if (distance < minDistance)
            {
                minDistance = distance;
            }

            if (distance > maxDistance)
            {
                maxDistance = distance;
            }
        }

        // More than a pixel clear of every edge, so no supersampling is needed.
        if (minDistance > 1.0)
        {
            return 1.0;
        }

        if (maxDistance < -1.0)
        {
            return 0.0;
        }

        const int Samples = 4;
        int hits = 0;
        for (int sy = 0; sy < Samples; sy++)
        {
            double py = y - 0.5 + ((sy + 0.5) / Samples);
            for (int sx = 0; sx < Samples; sx++)
            {
                double px = x - 0.5 + ((sx + 0.5) / Samples);
                if (Inside(polygon, px, py))
                {
                    hits++;
                }
            }
        }

        return (double)hits / (Samples * Samples);
    }

    private static bool Inside(PointD[] polygon, double x, double y)
    {
        bool inside = false;
        for (int i = 0, j = 3; i < 4; j = i++)
        {
            PointD pi = polygon[i];
            PointD pj = polygon[j];
            if ((pi.Y > y) != (pj.Y > y) &&
                x < (((pj.X - pi.X) * (y - pi.Y) / (pj.Y - pi.Y)) + pi.X))
            {
                inside = !inside;
            }
        }

        return inside;
    }
}
