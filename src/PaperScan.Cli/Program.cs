using System.Globalization;
using System.Reflection;
using System.Text;
using PaperScan;

namespace PaperScan.Cli;

internal static class Program
{
    private const string ExecutableName = "paperscan";

    private static int Main(string[] args)
    {
        TryUseUtf8Console();

        CommandLineOptions options = CommandLineParser.Parse(args);

        Messages.TryResolve(options.Language, out Messages messages, out bool recognisedLanguage);
        if (!recognisedLanguage)
        {
            Console.Error.WriteLine(string.Format(CultureInfo.CurrentCulture, messages.NoLanguages, options.Language));
            return 2;
        }

        if (options.Error is { } error)
        {
            Console.Error.WriteLine(messages.Format(error));
            Console.Error.WriteLine();
            Console.Error.WriteLine(messages.Help(ExecutableName));
            return 2;
        }

        if (options.ShowHelp)
        {
            Console.WriteLine(messages.Help(ExecutableName));
            return 0;
        }

        if (options.ShowVersion)
        {
            Console.WriteLine(VersionString());
            return 0;
        }

        ScanOptions scanOptions;
        try
        {
            scanOptions = BuildScanOptions(options);
        }
        catch (Exception ex) when (ex is FormatException or ArgumentException)
        {
            Console.Error.WriteLine(string.Format(CultureInfo.CurrentCulture, messages.Failed, ex.Message));
            return 2;
        }

        Action<string>? log = options.Quiet ? null : line => Console.WriteLine("  " + line);

        int succeeded = 0;
        int failed = 0;

        foreach (string input in options.Inputs)
        {
            if (!options.Quiet)
            {
                Console.WriteLine(string.Format(CultureInfo.CurrentCulture, messages.Scan, input));
            }

            try
            {
                ScanResult result = ScanPipeline.Run(input, scanOptions, log);

                if (!options.Quiet)
                {
                    Console.WriteLine("  " + string.Format(
                        CultureInfo.CurrentCulture,
                        messages.Wrote,
                        result.OutputPath,
                        result.FinalWidth,
                        result.FinalHeight,
                        result.Megabytes,
                        result.Elapsed.TotalSeconds));

                    if (result.VerifyPath is not null)
                    {
                        Console.WriteLine("  " + string.Format(CultureInfo.CurrentCulture, messages.Verify, result.VerifyPath));
                    }

                    if (result.PreviewPath is not null)
                    {
                        Console.WriteLine("  " + string.Format(CultureInfo.CurrentCulture, messages.Preview, result.PreviewPath));
                    }
                }

                succeeded++;
            }
            catch (Exception ex)
            {
                failed++;
                Console.Error.WriteLine(string.Format(CultureInfo.CurrentCulture, messages.Failed, $"{input}: {ex.Message}"));
            }
        }

        if (!options.Quiet && options.Inputs.Count > 1)
        {
            Console.WriteLine(string.Format(CultureInfo.CurrentCulture, messages.Summary, succeeded, options.Inputs.Count));
        }

        return failed == 0 ? 0 : 1;
    }

    private static ScanOptions BuildScanOptions(CommandLineOptions o) => new()
    {
        Corners = string.IsNullOrWhiteSpace(o.Corners) ? null : Quad.Parse(o.Corners),
        ReadingEdge = o.ReadingEdge,
        Warp = new WarpOptions { Margin = o.Margin },
        Detection = new CornerDetectionOptions { ThumbnailLongEdge = o.DetectionLongEdge },
        AutoTrim = o.Trim,
        OutputPath = o.Output,
        WriteVerifyImage = o.WriteVerify,
        WritePreviewImage = o.WritePreview,
        PreviewWidth = o.PreviewWidth,
        PngEffort = o.Png,
    };

    private static string VersionString()
    {
        Assembly assembly = typeof(Program).Assembly;
        string version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? assembly.GetName().Version?.ToString()
            ?? "0.0.0";

        int plus = version.IndexOf('+', StringComparison.Ordinal);
        if (plus >= 0)
        {
            version = version[..plus];
        }

        return $"{ExecutableName} {version} (.NET {Environment.Version.ToString(2)})";
    }

    private static void TryUseUtf8Console()
    {
        try
        {
            Console.OutputEncoding = Encoding.UTF8;
        }
        catch (IOException)
        {
            // Redirected or detached console: the encoding is already fine.
        }
    }
}
