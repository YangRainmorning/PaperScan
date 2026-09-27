using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace PaperScan.Tests;

public class ScanPipelineTests
{
    private static readonly Quad AxisAlignedQuad = new(
        new PointD(100, 40),
        new PointD(500, 40),
        new PointD(500, 600),
        new PointD(100, 600));

    private static string WritePhoto(TempWorkspace workspace, Quad quad, int documentWidth, int documentHeight, string name = "photo.png")
    {
        using Image<Rgb24> document = TestImages.Document(documentWidth, documentHeight);
        using Image<Rgb24> photo = TestImages.PhotoOfDocument(document, quad, 640, 700);
        string path = workspace.PathOf(name);
        photo.SaveAsPng(path);
        return path;
    }

    [Fact]
    public void Run_WithManualCornersRectifiesToTheDocumentSize()
    {
        using TempWorkspace workspace = new();
        string photo = WritePhoto(workspace, AxisAlignedQuad, 400, 560);

        ScanResult result = ScanPipeline.Run(photo, new ScanOptions
        {
            Corners = AxisAlignedQuad,
            WriteVerifyImage = false,
        });

        Assert.True(result.ManualCorners);
        Assert.Equal(400, result.PaperWidth);
        Assert.Equal(560, result.PaperHeight);

        // The trimmer shaves the 2px pad off each edge.
        Assert.InRange(result.FinalWidth, 390, 400);
        Assert.InRange(result.FinalHeight, 545, 560);

        Assert.True(File.Exists(result.OutputPath));
        Assert.NotNull(result.PreviewPath);
        Assert.True(File.Exists(result.PreviewPath));
    }

    [Fact]
    public void Run_WritesAnOpaqueTwentyFourBitPng()
    {
        using TempWorkspace workspace = new();
        string photo = WritePhoto(workspace, AxisAlignedQuad, 200, 280);

        ScanResult result = ScanPipeline.Run(photo, new ScanOptions
        {
            Corners = AxisAlignedQuad,
            WriteVerifyImage = false,
            WritePreviewImage = false,
        });

        byte[] header = new byte[26];
        using (FileStream stream = File.OpenRead(result.OutputPath))
        {
            stream.ReadExactly(header);
        }

        // PNG signature, then IHDR: colour type 2 == truecolour (no alpha).
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, header[..4]);
        Assert.Equal(2, header[25]);
    }

    [Fact]
    public void Run_LeavesNoDarkBorderOnTheOutput()
    {
        using TempWorkspace workspace = new();
        string photo = WritePhoto(workspace, AxisAlignedQuad, 400, 560);

        ScanResult result = ScanPipeline.Run(photo, new ScanOptions
        {
            Corners = AxisAlignedQuad,
            WriteVerifyImage = false,
            WritePreviewImage = false,
        });

        using Image<Rgb24> output = ImageIO.Load(result.OutputPath);
        int minLuma = int.MaxValue;

        output.ProcessPixelRows(accessor =>
        {
            for (int x = 0; x < output.Width; x++)
            {
                minLuma = Math.Min(minLuma, Luma(accessor.GetRowSpan(0)[x]));
                minLuma = Math.Min(minLuma, Luma(accessor.GetRowSpan(output.Height - 1)[x]));
            }

            for (int y = 0; y < output.Height; y++)
            {
                minLuma = Math.Min(minLuma, Luma(accessor.GetRowSpan(y)[0]));
                minLuma = Math.Min(minLuma, Luma(accessor.GetRowSpan(y)[output.Width - 1]));
            }
        });

        Assert.True(minLuma > 180, $"outermost row/column contains a dark pixel (min luma {minLuma})");
    }

    [Fact]
    public void Run_DetectsCornersAutomaticallyWhenNoneAreGiven()
    {
        using TempWorkspace workspace = new();
        Quad quad = TestImages.PortraitQuad(640, 700);
        string photo = WritePhoto(workspace, quad, 400, 560);

        ScanResult result = ScanPipeline.Run(photo, new ScanOptions
        {
            ReadingEdge = ReadingEdge.Top,
        });

        Assert.False(result.ManualCorners);
        Assert.InRange(result.PaperFraction, 0.2, 0.6);
        Assert.True(result.VerifyPath is not null && File.Exists(result.VerifyPath));

        // The portrait quad on a 640x700 photo measures roughly 270 x 596.
        Assert.InRange(result.PaperWidth, 240, 300);
        Assert.InRange(result.PaperHeight, 540, 650);
    }

    [Fact]
    public void Run_HonoursAnExplicitOutputPath()
    {
        using TempWorkspace workspace = new();
        string photo = WritePhoto(workspace, AxisAlignedQuad, 200, 280);
        string target = workspace.PathOf(Path.Combine("nested", "custom-name.png"));

        ScanResult result = ScanPipeline.Run(photo, new ScanOptions
        {
            Corners = AxisAlignedQuad,
            OutputPath = target,
            WriteVerifyImage = false,
            WritePreviewImage = false,
        });

        Assert.Equal(Path.GetFullPath(target), result.OutputPath);
        Assert.True(File.Exists(target));
    }

    [Fact]
    public void Run_ThrowsForAMissingInput()
    {
        using TempWorkspace workspace = new();

        FileNotFoundException error = Assert.Throws<FileNotFoundException>(() =>
            ScanPipeline.Run(workspace.PathOf("nope.png"), new ScanOptions { Corners = AxisAlignedQuad }));

        Assert.Contains("nope.png", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Run_ReportsTimingAndSizes()
    {
        using TempWorkspace workspace = new();
        string photo = WritePhoto(workspace, AxisAlignedQuad, 200, 280);

        ScanResult result = ScanPipeline.Run(photo, new ScanOptions
        {
            Corners = AxisAlignedQuad,
            WriteVerifyImage = false,
            WritePreviewImage = false,
        });

        Assert.True(result.OutputBytes > 0);
        Assert.True(result.Elapsed > TimeSpan.Zero);
        Assert.Equal(400.0 / 560.0, result.AspectRatio, 1);
    }

    private static int Luma(Rgb24 pixel) => PixelOps.LumaTimesThousand(pixel.R, pixel.G, pixel.B) / 1000;
}
