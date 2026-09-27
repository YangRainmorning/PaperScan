using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace PaperScan.Tests;

public class CornerDetectorTests
{
    [Fact]
    public void Detect_FindsThePageInASyntheticPhoto()
    {
        using Image<Rgb24> document = TestImages.Document(900, 1200);
        Quad expected = TestImages.CenteredQuad(1600, 1200);
        using Image<Rgb24> photo = TestImages.PhotoOfDocument(document, expected, 1600, 1200);

        CornerDetectionResult result = CornerDetector.Detect(photo);

        double tolerance = 1600 * 0.02;
        for (int i = 0; i < 4; i++)
        {
            Assert.Equal(expected[i].X, result.PhotoOrder[i].X, tolerance);
            Assert.Equal(expected[i].Y, result.PhotoOrder[i].Y, tolerance);
        }

        Assert.InRange(result.PaperFraction, 0.3, 0.7);
    }

    [Fact]
    public void Detect_ProducesAThumbnailOfTheRequestedLongEdge()
    {
        using Image<Rgb24> document = TestImages.Document(400, 700);
        using Image<Rgb24> photo = TestImages.PhotoOfDocument(document, TestImages.CenteredQuad(2000, 1200), 2000, 1200);

        CornerDetectionResult result = CornerDetector.Detect(photo, new CornerDetectionOptions { ThumbnailLongEdge = 512 });

        Assert.Equal(512, Math.Max(result.ThumbnailWidth, result.ThumbnailHeight));
    }

    [Fact]
    public void Detect_WritesAVerifyImageWhenAsked()
    {
        using TempWorkspace workspace = new();
        using Image<Rgb24> document = TestImages.Document(300, 400);
        using Image<Rgb24> photo = TestImages.PhotoOfDocument(document, TestImages.CenteredQuad(800, 600), 800, 600);

        string path = workspace.PathOf("verify.png");
        CornerDetector.Detect(photo, null, path);

        Assert.True(File.Exists(path));
        using Image<Rgb24> verify = ImageIO.Load(path);

        // The overlay is drawn on the detection thumbnail — the image the corners were
        // actually measured on — not on the full-resolution photo.
        Assert.Equal(1024, Math.Max(verify.Width, verify.Height));
        Assert.Equal(photo.Width / (double)photo.Height, verify.Width / (double)verify.Height, 3);
    }

    [Fact]
    public void Detect_ThrowsWhenThereIsNoPage()
    {
        using Image<Rgb24> flat = new(400, 300, new Rgb24(30, 30, 30));

        InvalidOperationException error = Assert.ThrowsAny<InvalidOperationException>(() => CornerDetector.Detect(flat));

        Assert.Contains("No page", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Detect_FindsTheOuterEdgeOfABorderedDocument()
    {
        using Image<Rgb24> document = TestImages.BorderedDocument(900, 1200);
        Quad expected = TestImages.PortraitQuad(1600, 1200);
        using Image<Rgb24> photo = TestImages.PhotoOfDocument(document, expected, 1600, 1200);

        CornerDetectionResult result = CornerDetector.Detect(photo);

        // The printed border splits the paper in two; the detector must still report the
        // sheet, not the area framed by the border.
        AssertQuadClose(expected, result.PhotoOrder, 1600 * 0.02, result);
    }

    private static void AssertQuadClose(Quad expected, Quad actual, double tolerance, CornerDetectionResult result)
    {
        for (int i = 0; i < 4; i++)
        {
            Assert.True(
                Math.Abs(expected[i].X - actual[i].X) <= tolerance && Math.Abs(expected[i].Y - actual[i].Y) <= tolerance,
                $"corner {i}: expected {expected[i]}, got {actual[i]}. full quad {actual}, page fraction {result.PaperFraction:0.000}");
        }
    }
}
