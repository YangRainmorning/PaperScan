using Xunit;

namespace PaperScan.Tests;

public class EdgeTrimmerTests
{
    private const byte PaperLevel = 240;
    private const byte DarkLevel = 30;

    [Fact]
    public void FindCrop_RemovesADarkBorderOnEverySide()
    {
        const int Width = 400;
        const int Height = 300;
        byte[] canvas = Canvas(Width, Height, darkTop: 20, darkLeft: 15, darkRight: 25, darkBottom: 30);

        PixelRect? crop = EdgeTrimmer.FindCrop(canvas, Width, Height);

        Assert.NotNull(crop);
        PixelRect rect = crop.Value;

        // Each edge is trimmed to just past the last dark pixel, plus the 2px pad.
        Assert.InRange(rect.X, 15, 20);
        Assert.InRange(rect.Y, 20, 25);
        Assert.InRange(rect.Width, 348, 362);
        Assert.InRange(rect.Height, 238, 252);
    }

    [Fact]
    public void FindCrop_LeavesNothingDarkInsideTheResult()
    {
        const int Width = 320;
        const int Height = 240;
        byte[] canvas = Canvas(Width, Height, darkTop: 18, darkLeft: 12, darkRight: 22, darkBottom: 14);

        PixelRect rect = EdgeTrimmer.FindCrop(canvas, Width, Height)!.Value;

        for (int y = rect.Y; y < rect.Bottom; y++)
        {
            for (int x = rect.X; x < rect.Right; x++)
            {
                int i = ((y * Width) + x) * 3;
                Assert.True(canvas[i] >= PaperLevel, $"pixel ({x},{y}) is not paper");
            }
        }
    }

    [Fact]
    public void FindCrop_ReturnsTheWholeCanvasWhenNothingIsBright()
    {
        const int Width = 200;
        const int Height = 150;
        byte[] canvas = new byte[Width * Height * 3];
        Array.Fill(canvas, DarkLevel);

        PixelRect? crop = EdgeTrimmer.FindCrop(canvas, Width, Height);

        Assert.Equal(new PixelRect(0, 0, Width, Height), crop);
    }

    [Fact]
    public void FindCrop_ReturnsNullWhenTheCropWouldBeDegenerate()
    {
        const int Width = 200;
        const int Height = 150;
        byte[] canvas = Canvas(Width, Height, 20, 20, 20, 20);

        PixelRect? crop = EdgeTrimmer.FindCrop(canvas, Width, Height, new TrimOptions { MinKeptSize = 5000 });

        Assert.Null(crop);
    }

    [Fact]
    public void Crop_CopiesExactlyTheRequestedRectangle()
    {
        const int Width = 10;
        const int Height = 8;
        byte[] canvas = new byte[Width * Height * 3];
        for (int i = 0; i < canvas.Length; i++)
        {
            canvas[i] = (byte)(i % 251);
        }

        PixelRect rect = new(2, 3, 4, 2);
        using SixLabors.ImageSharp.Image<SixLabors.ImageSharp.PixelFormats.Rgb24> cropped =
            EdgeTrimmer.Crop(canvas, Width, Height, rect);

        Assert.Equal(4, cropped.Width);
        Assert.Equal(2, cropped.Height);

        cropped.ProcessPixelRows(accessor =>
        {
            for (int y = 0; y < rect.Height; y++)
            {
                for (int x = 0; x < rect.Width; x++)
                {
                    int expected = (((rect.Y + y) * Width) + rect.X + x) * 3;
                    var pixel = accessor.GetRowSpan(y)[x];
                    Assert.Equal(canvas[expected], pixel.R);
                    Assert.Equal(canvas[expected + 1], pixel.G);
                    Assert.Equal(canvas[expected + 2], pixel.B);
                }
            }
        });
    }

    [Fact]
    public void Crop_RejectsARectangleOutsideTheCanvas()
    {
        byte[] canvas = new byte[10 * 10 * 3];

        Assert.Throws<ArgumentOutOfRangeException>(() => EdgeTrimmer.Crop(canvas, 10, 10, new PixelRect(5, 5, 20, 20)));
    }

    private static byte[] Canvas(int width, int height, int darkTop, int darkLeft, int darkRight, int darkBottom)
    {
        byte[] canvas = new byte[width * height * 3];
        Array.Fill(canvas, PaperLevel);

        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                bool dark = y < darkTop || y >= height - darkBottom || x < darkLeft || x >= width - darkRight;
                if (!dark)
                {
                    continue;
                }

                int i = ((y * width) + x) * 3;
                canvas[i] = DarkLevel;
                canvas[i + 1] = DarkLevel;
                canvas[i + 2] = DarkLevel;
            }
        }

        return canvas;
    }
}
