using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace PaperScan.Tests;

public class WarperTests
{
    [Fact]
    public void Warp_IsAnIdentityWhenThePageIsAlreadyAxisAlignedAndNeutral()
    {
        using Image<Rgb24> source = new(64, 48, new Rgb24(250, 250, 250));
        Quad full = new(new PointD(0, 0), new PointD(64, 0), new PointD(64, 48), new PointD(0, 48));

        WarpResult result = Warper.Warp(source, full);

        Assert.Equal(64, result.PaperWidth);
        Assert.Equal(48, result.PaperHeight);
        Assert.Equal(64, result.CanvasWidth);
        Assert.Equal(48, result.CanvasHeight);
        Assert.Equal(1.0, result.Gains[0], 9);

        for (int i = 0; i < result.Pixels.Length; i++)
        {
            Assert.Equal(250, result.Pixels[i]);
        }
    }

    [Fact]
    public void Warp_NormalisesThePaperToTheTargetWhite()
    {
        using Image<Rgb24> source = new(32, 32, new Rgb24(200, 190, 180));
        Quad full = new(new PointD(0, 0), new PointD(32, 0), new PointD(32, 32), new PointD(0, 32));

        WarpResult result = Warper.Warp(source, full);

        Assert.Equal(200, result.Percentiles[0], 6);
        Assert.Equal(190, result.Percentiles[1], 6);
        Assert.Equal(180, result.Percentiles[2], 6);

        for (int i = 0; i < result.Pixels.Length; i += 3)
        {
            Assert.InRange(result.Pixels[i], 249, 251);
            Assert.InRange(result.Pixels[i + 1], 249, 251);
            Assert.InRange(result.Pixels[i + 2], 249, 251);
        }
    }

    [Fact]
    public void Warp_GrowsTheCanvasByTwiceTheMargin()
    {
        using Image<Rgb24> source = new(100, 200, new Rgb24(250, 250, 250));
        Quad full = new(new PointD(0, 0), new PointD(100, 0), new PointD(100, 200), new PointD(0, 200));

        WarpResult result = Warper.Warp(source, full, new WarpOptions { Margin = 0.05 });

        Assert.Equal(100, result.PaperWidth);
        Assert.Equal(200, result.PaperHeight);
        Assert.Equal(110, result.CanvasWidth);
        Assert.Equal(220, result.CanvasHeight);
    }

    [Fact]
    public void Warp_RejectsAnOutOfRangeMargin()
    {
        using Image<Rgb24> source = new(8, 8, new Rgb24(250, 250, 250));
        Quad full = new(new PointD(0, 0), new PointD(8, 0), new PointD(8, 8), new PointD(0, 8));

        Assert.Throws<ArgumentOutOfRangeException>(() => Warper.Warp(source, full, new WarpOptions { Margin = 0.9 }));
    }

    [Fact]
    public void Warp_IsDeterministic()
    {
        using Image<Rgb24> document = TestImages.Document(200, 260);
        using Image<Rgb24> photo = TestImages.PhotoOfDocument(document, TestImages.CenteredQuad(320, 240), 320, 240);
        Quad quad = TestImages.CenteredQuad(320, 240);

        WarpResult first = Warper.Warp(photo, quad);
        WarpResult second = Warper.Warp(photo, quad);

        Assert.Equal(first.Pixels, second.Pixels);
    }
}
