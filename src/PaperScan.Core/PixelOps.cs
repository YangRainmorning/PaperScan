using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace PaperScan;

/// <summary>Small helpers shared by the pixel loops.</summary>
internal static class PixelOps
{
    /// <summary>
    /// Rec.601 luma multiplied by 1000, so callers can compare against <c>threshold * 1000</c>
    /// without the rounding a division would introduce.
    /// </summary>
    public static int LumaTimesThousand(byte r, byte g, byte b) => (r * 299) + (g * 587) + (b * 114);

    /// <summary>Copies an image into a tightly packed, top-down RGB byte buffer (<c>w * h * 3</c>).</summary>
    public static byte[] ToRgbBytes(Image<Rgb24> image)
    {
        byte[] bytes = new byte[image.Width * image.Height * 3];
        image.CopyPixelDataTo(bytes);
        return bytes;
    }

    /// <summary>Creates an image from a tightly packed, top-down RGB byte buffer.</summary>
    public static Image<Rgb24> FromRgbBytes(byte[] bytes, int width, int height) =>
        Image.LoadPixelData<Rgb24>(bytes, width, height);
}

/// <summary>Minimal software rasteriser: enough to draw the corner-detection overlay.</summary>
internal static class Raster
{
    public static void DrawLine(byte[] rgb, int width, int height, PointD a, PointD b, Rgb24 color)
    {
        int x0 = (int)Math.Round(a.X);
        int y0 = (int)Math.Round(a.Y);
        int x1 = (int)Math.Round(b.X);
        int y1 = (int)Math.Round(b.Y);

        int dx = Math.Abs(x1 - x0);
        int dy = -Math.Abs(y1 - y0);
        int sx = x0 < x1 ? 1 : -1;
        int sy = y0 < y1 ? 1 : -1;
        int err = dx + dy;

        while (true)
        {
            Set(rgb, width, height, x0, y0, color);

            if (x0 == x1 && y0 == y1)
            {
                break;
            }

            int e2 = 2 * err;
            if (e2 >= dy)
            {
                err += dy;
                x0 += sx;
            }

            if (e2 <= dx)
            {
                err += dx;
                y0 += sy;
            }
        }
    }

    public static void DrawDisc(byte[] rgb, int width, int height, PointD center, int radius, Rgb24 color)
    {
        int cx = (int)Math.Round(center.X);
        int cy = (int)Math.Round(center.Y);
        int r2 = radius * radius;

        for (int y = cy - radius; y <= cy + radius; y++)
        {
            for (int x = cx - radius; x <= cx + radius; x++)
            {
                int ddx = x - cx;
                int ddy = y - cy;
                if ((ddx * ddx) + (ddy * ddy) <= r2)
                {
                    Set(rgb, width, height, x, y, color);
                }
            }
        }
    }

    private static void Set(byte[] rgb, int width, int height, int x, int y, Rgb24 color)
    {
        if ((uint)x >= (uint)width || (uint)y >= (uint)height)
        {
            return;
        }

        int i = ((y * width) + x) * 3;
        rgb[i] = color.R;
        rgb[i + 1] = color.G;
        rgb[i + 2] = color.B;
    }
}
