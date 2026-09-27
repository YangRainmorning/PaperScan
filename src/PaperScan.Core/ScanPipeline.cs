using System.Diagnostics;
using System.Globalization;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace PaperScan;

/// <summary>
/// The five-stage pipeline that turns a photo of a page into a scan:
/// find the corners, rectify, white-balance, trim the background, write PNG.
/// </summary>
public static class ScanPipeline
{
    public static ScanResult Run(string inputPath, ScanOptions? options = null, Action<string>? log = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(inputPath);
        options ??= new ScanOptions();

        Stopwatch stopwatch = Stopwatch.StartNew();

        string input = Path.GetFullPath(inputPath);
        string directory = Path.GetDirectoryName(input) ?? ".";
        string baseName = Path.GetFileNameWithoutExtension(input);

        string outputPath = string.IsNullOrWhiteSpace(options.OutputPath)
            ? Path.Combine(directory, baseName + options.ScanSuffix + ".png")
            : Path.GetFullPath(options.OutputPath);
        string verifyPath = Path.Combine(directory, baseName + options.VerifySuffix + ".png");
        string previewPath = Path.Combine(directory, baseName + options.PreviewSuffix + ".png");

        using Image<Rgb24> source = ImageIO.Load(input);
        log?.Invoke(string.Create(CultureInfo.InvariantCulture, $"Source: {source.Width} x {source.Height} px"));

        Quad paper;
        double paperFraction = 0;
        bool manualCorners = options.Corners is not null;

        if (options.Corners is { } manual)
        {
            paper = manual;
            log?.Invoke("Corners: supplied manually, detection skipped.");
        }
        else
        {
            CornerDetectionResult detection = CornerDetector.Detect(
                source,
                options.Detection,
                options.WriteVerifyImage ? verifyPath : null);

            paperFraction = detection.PaperFraction;
            paper = detection.PhotoOrder.Rotate(options.ReadingEdge);

            log?.Invoke(string.Create(
                CultureInfo.InvariantCulture,
                $"Detection: {detection.ThumbnailWidth} x {detection.ThumbnailHeight} thumbnail, page covers {detection.PaperFraction * 100:0.0}%"));
            log?.Invoke(string.Create(
                CultureInfo.InvariantCulture,
                $"Corners (photo order): {detection.PhotoOrder}"));
            log?.Invoke($"Reading edge: {options.ReadingEdge}");
        }

        WarpResult warped = Warper.Warp(source, paper, options.Warp);
        log?.Invoke(string.Create(
            CultureInfo.InvariantCulture,
            $"Rectified: page {warped.PaperWidth} x {warped.PaperHeight}, canvas {warped.CanvasWidth} x {warped.CanvasHeight}"));
        log?.Invoke(string.Create(
            CultureInfo.InvariantCulture,
            $"Paper white (p90): R{warped.Percentiles[0]:0} G{warped.Percentiles[1]:0} B{warped.Percentiles[2]:0}  ->  gain R{warped.Gains[0]:0.000} G{warped.Gains[1]:0.000} B{warped.Gains[2]:0.000}"));

        using Image<Rgb24> canvas = CanvasFramer.Frame(warped, options.Warp.EdgeOverscan);

        Image<Rgb24>? cropped = null;
        try
        {
            Image<Rgb24> final = canvas;
            PixelRect? crop = null;

            if (options.AutoTrim)
            {
                byte[] canvasBytes = PixelOps.ToRgbBytes(canvas);
                crop = EdgeTrimmer.FindCrop(canvasBytes, canvas.Width, canvas.Height, options.Trimming);

                if (crop is { } rect)
                {
                    cropped = EdgeTrimmer.Crop(canvasBytes, canvas.Width, canvas.Height, rect);
                    final = cropped;
                    log?.Invoke(string.Create(
                        CultureInfo.InvariantCulture,
                        $"Trim: left {rect.X}, top {rect.Y}, right {canvas.Width - rect.Right}, bottom {canvas.Height - rect.Bottom} px"));
                }
                else
                {
                    log?.Invoke("Trim: nothing to remove.");
                }
            }

            ImageIO.SavePng(final, outputPath, options.PngEffort);

            string? previewWritten = null;
            if (options.WritePreviewImage && options.PreviewWidth > 0)
            {
                int previewWidth = Math.Min(options.PreviewWidth, final.Width);
                int previewHeight = Math.Max(1, (int)Math.Round((double)previewWidth * final.Height / final.Width));

                using Image<Rgb24> preview = final.Clone(ctx => ctx.Resize(new ResizeOptions
                {
                    Size = new Size(previewWidth, previewHeight),
                    Sampler = KnownResamplers.Bicubic,
                    Mode = ResizeMode.Stretch,
                }));

                ImageIO.SavePng(preview, previewPath, options.PngEffort);
                previewWritten = previewPath;
            }

            stopwatch.Stop();

            return new ScanResult
            {
                InputPath = input,
                OutputPath = outputPath,
                VerifyPath = !manualCorners && options.WriteVerifyImage ? verifyPath : null,
                PreviewPath = previewWritten,
                PaperQuad = paper,
                ManualCorners = manualCorners,
                PaperFraction = paperFraction,
                PaperWidth = warped.PaperWidth,
                PaperHeight = warped.PaperHeight,
                CanvasWidth = canvas.Width,
                CanvasHeight = canvas.Height,
                FinalWidth = final.Width,
                FinalHeight = final.Height,
                Crop = crop,
                Percentiles = warped.Percentiles,
                WhiteGains = warped.Gains,
                OutputBytes = new FileInfo(outputPath).Length,
                Elapsed = stopwatch.Elapsed,
            };
        }
        finally
        {
            cropped?.Dispose();
        }
    }
}
