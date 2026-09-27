namespace PaperScan.Cli;

/// <summary>Parsed command line. Parsing is language independent; messages come later.</summary>
internal sealed class CommandLineOptions
{
    public List<string> Inputs { get; } = [];

    public string? Output { get; set; }

    public string? Corners { get; set; }

    public ReadingEdge ReadingEdge { get; set; } = ReadingEdge.Top;

    public double Margin { get; set; }

    public bool Trim { get; set; } = true;

    public bool WritePreview { get; set; } = true;

    public bool WriteVerify { get; set; } = true;

    public int PreviewWidth { get; set; } = 1600;

    public int DetectionLongEdge { get; set; } = 1024;

    public PngEffort Png { get; set; } = PngEffort.Fast;

    public string Language { get; set; } = "auto";

    public bool Quiet { get; set; }

    public bool ShowHelp { get; set; }

    public bool ShowVersion { get; set; }

    /// <summary>Set when parsing failed. The value is an untranslated key plus arguments.</summary>
    public ParseError? Error { get; set; }
}

internal sealed record ParseError(string Key, params string[] Arguments);

internal static class CommandLineParser
{
    public static CommandLineOptions Parse(string[] args)
    {
        CommandLineOptions options = new();

        for (int i = 0; i < args.Length; i++)
        {
            string arg = args[i];

            if (!arg.StartsWith('-') || arg == "-")
            {
                options.Inputs.Add(arg);
                continue;
            }

            string name = arg;
            string? inlineValue = null;

            int equals = arg.IndexOf('=', StringComparison.Ordinal);
            if (equals > 0)
            {
                name = arg[..equals];
                inlineValue = arg[(equals + 1)..];
            }

            switch (name)
            {
                case "-h":
                case "--help":
                    options.ShowHelp = true;
                    break;

                case "-V":
                case "--version":
                    options.ShowVersion = true;
                    break;

                case "-q":
                case "--quiet":
                    options.Quiet = true;
                    break;

                case "--no-trim":
                    options.Trim = false;
                    break;

                case "--no-preview":
                    options.WritePreview = false;
                    break;

                case "--no-verify":
                    options.WriteVerify = false;
                    break;

                case "-o":
                case "--out":
                    if (!TakeValue(args, ref i, inlineValue, out string? outValue, options))
                    {
                        return options;
                    }

                    options.Output = outValue;
                    break;

                case "-c":
                case "--corners":
                    if (!TakeValue(args, ref i, inlineValue, out string? corners, options))
                    {
                        return options;
                    }

                    options.Corners = corners;
                    break;

                case "-r":
                case "--reading-edge":
                    if (!TakeValue(args, ref i, inlineValue, out string? edge, options))
                    {
                        return options;
                    }

                    if (!Enum.TryParse(edge, ignoreCase: true, out ReadingEdge parsedEdge))
                    {
                        options.Error = new ParseError("err.invalidReadingEdge", edge!);
                        return options;
                    }

                    options.ReadingEdge = parsedEdge;
                    break;

                case "-m":
                case "--margin":
                    if (!TakeValue(args, ref i, inlineValue, out string? margin, options))
                    {
                        return options;
                    }

                    if (!double.TryParse(margin, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out double marginValue)
                        || marginValue < 0
                        || marginValue > 0.5)
                    {
                        options.Error = new ParseError("err.invalidMargin", margin!);
                        return options;
                    }

                    options.Margin = marginValue;
                    break;

                case "--preview-width":
                    if (!TakePositiveInt(args, ref i, inlineValue, name, options, out int previewWidth))
                    {
                        return options;
                    }

                    options.PreviewWidth = previewWidth;
                    break;

                case "--detect-long-edge":
                    if (!TakePositiveInt(args, ref i, inlineValue, name, options, out int detectEdge))
                    {
                        return options;
                    }

                    options.DetectionLongEdge = detectEdge;
                    break;

                case "-l":
                case "--lang":
                    if (!TakeValue(args, ref i, inlineValue, out string? lang, options))
                    {
                        return options;
                    }

                    options.Language = lang!;
                    break;

                case "--png":
                    if (!TakeValue(args, ref i, inlineValue, out string? png, options))
                    {
                        return options;
                    }

                    if (!Enum.TryParse(png, ignoreCase: true, out PngEffort pngEffort))
                    {
                        options.Error = new ParseError("err.invalidPngEffort", png!);
                        return options;
                    }

                    options.Png = pngEffort;
                    break;

                default:
                    options.Error = new ParseError("err.unknownOption", name);
                    return options;
            }
        }

        if (!options.ShowHelp && !options.ShowVersion && options.Inputs.Count == 0)
        {
            options.Error = new ParseError("err.noInput");
        }
        else if (options.Output is not null && options.Inputs.Count > 1)
        {
            options.Error = new ParseError("err.outWithMultipleInputs");
        }

        return options;
    }

    private static bool TakeValue(string[] args, ref int index, string? inline, out string? value, CommandLineOptions options)
    {
        if (inline is not null)
        {
            value = inline;
            return true;
        }

        if (index + 1 >= args.Length)
        {
            value = null;
            options.Error = new ParseError("err.missingValue", args[index]);
            return false;
        }

        value = args[++index];
        return true;
    }

    private static bool TakePositiveInt(string[] args, ref int index, string? inline, string name, CommandLineOptions options, out int value)
    {
        if (!TakeValue(args, ref index, inline, out string? text, options))
        {
            value = 0;
            return false;
        }

        if (!int.TryParse(text, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out value) || value <= 0)
        {
            options.Error = new ParseError("err.invalidPositiveInt", name, text!);
            return false;
        }

        return true;
    }
}
