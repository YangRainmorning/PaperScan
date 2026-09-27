namespace PaperScan;

/// <summary>Everything the pipeline can be told to do differently.</summary>
public sealed record ScanOptions
{
    /// <summary>
    /// Manually supplied page corners in source pixels, in reading order
    /// (<c>top-left;top-right;bottom-right;bottom-left</c>). When set, detection is skipped.
    /// </summary>
    public Quad? Corners { get; init; }

    /// <summary>
    /// Which edge of the photo the page's readable "up" direction points at.
    /// Only used when the corners came from automatic detection.
    /// </summary>
    public ReadingEdge ReadingEdge { get; init; } = ReadingEdge.Top;

    /// <summary>Rectification and white-balance settings.</summary>
    public WarpOptions Warp { get; init; } = new();

    /// <summary>Automatic corner detection settings.</summary>
    public CornerDetectionOptions Detection { get; init; } = new();

    /// <summary>Background trimming settings.</summary>
    public TrimOptions Trimming { get; init; } = new();

    /// <summary>Trim the background off the canvas. Turn off to keep the raw rectified output.</summary>
    public bool AutoTrim { get; init; } = true;

    /// <summary>Explicit output path. Defaults to <c>&lt;photo&gt;-scan.png</c> next to the photo.</summary>
    public string? OutputPath { get; init; }

    /// <summary>Write the corner-detection overlay image next to the photo.</summary>
    public bool WriteVerifyImage { get; init; } = true;

    /// <summary>Write a downscaled preview next to the photo.</summary>
    public bool WritePreviewImage { get; init; } = true;

    /// <summary>Width of the preview image in pixels.</summary>
    public int PreviewWidth { get; init; } = 1600;

    /// <summary>How hard the PNG encoder should work. Affects size and speed, never pixels.</summary>
    public PngEffort PngEffort { get; init; } = PngEffort.Fast;

    /// <summary>Suffix appended to the photo's base name for the final scan.</summary>
    public string ScanSuffix { get; init; } = "-scan";

    /// <summary>Suffix for the corner-detection overlay.</summary>
    public string VerifySuffix { get; init; } = "-verify";

    /// <summary>Suffix for the preview.</summary>
    public string PreviewSuffix { get; init; } = "-preview";
}

/// <summary>What the pipeline produced, and the numbers behind it.</summary>
public sealed record ScanResult
{
    public required string InputPath { get; init; }

    public required string OutputPath { get; init; }

    public string? VerifyPath { get; init; }

    public string? PreviewPath { get; init; }

    /// <summary>The page quad in reading order, in source pixel coordinates.</summary>
    public required Quad PaperQuad { get; init; }

    /// <summary>True when the corners were supplied by the caller instead of detected.</summary>
    public required bool ManualCorners { get; init; }

    /// <summary>Fraction of the photo covered by the detected page (0 when corners were manual).</summary>
    public double PaperFraction { get; init; }

    public required int PaperWidth { get; init; }

    public required int PaperHeight { get; init; }

    public required int CanvasWidth { get; init; }

    public required int CanvasHeight { get; init; }

    public required int FinalWidth { get; init; }

    public required int FinalHeight { get; init; }

    /// <summary>The crop applied by the trimmer, or <c>null</c> when nothing was removed.</summary>
    public PixelRect? Crop { get; init; }

    /// <summary>90th-percentile channel values of the raw canvas, before white balancing.</summary>
    public required double[] Percentiles { get; init; }

    /// <summary>Per-channel white-balance gains.</summary>
    public required double[] WhiteGains { get; init; }

    public required long OutputBytes { get; init; }

    public required TimeSpan Elapsed { get; init; }

    public double AspectRatio => FinalHeight == 0 ? 0 : (double)FinalWidth / FinalHeight;

    public double Megabytes => OutputBytes / 1024.0 / 1024.0;
}
