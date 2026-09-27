using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace PaperScan.Tests;

public class CanvasFramerTests
{
    [Fact]
    public void Frame_WithNoMarginKeepsEveryPixel()
    {
        using Image<Rgb24> document = TestImages.Document(120, 160);
        using Image<Rgb24> photo = TestImages.PhotoOfDocument(document, TestImages.CenteredQuad(200, 160), 200, 160);
        Quad quad = TestImages.CenteredQuad(200, 160);

        WarpResult warped = Warper.Warp(photo, quad);
        using Image<Rgb24> framed = CanvasFramer.Frame(warped);

        Assert.Equal(warped.CanvasWidth, framed.Width);
        Assert.Equal(warped.CanvasHeight, framed.Height);
        Assert.Equal(warped.Pixels, PixelOps.ToRgbBytes(framed));
    }

    [Fact]
    public void Frame_WithMarginPaintsTheBorderWhite()
    {
        using Image<Rgb24> source = new(80, 120, new Rgb24(200, 190, 180));
        Quad full = new(new PointD(0, 0), new PointD(80, 0), new PointD(80, 120), new PointD(0, 120));

        WarpResult warped = Warper.Warp(source, full, new WarpOptions { Margin = 0.1 });
        using Image<Rgb24> framed = CanvasFramer.Frame(warped);

        Assert.Equal(96, framed.Width);
        Assert.Equal(144, framed.Height);

        framed.ProcessPixelRows(accessor =>
        {
            Assert.Equal(new Rgb24(255, 255, 255), accessor.GetRowSpan(0)[0]);
            Assert.Equal(new Rgb24(255, 255, 255), accessor.GetRowSpan(0)[framed.Width - 1]);
            Assert.Equal(new Rgb24(255, 255, 255), accessor.GetRowSpan(framed.Height - 1)[0]);
            Assert.Equal(new Rgb24(255, 255, 255), accessor.GetRowSpan(framed.Height - 1)[framed.Width - 1]);

            // The middle of the canvas is still the (white-balanced) page.
            Rgb24 centre = accessor.GetRowSpan(framed.Height / 2)[framed.Width / 2];
            Assert.InRange(centre.R, 249, 251);
        });
    }
}
