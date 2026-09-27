using System.Globalization;

namespace PaperScan.Cli;

/// <summary>Console text, in English and Simplified Chinese.</summary>
internal sealed class Messages
{
    public static readonly Messages English = new()
    {
        Code = "en",
        Scan = "Scanning {0}",
        Wrote = "Wrote {0} ({1} x {2}, {3:0.0} MB) in {4:0.0}s",
        Verify = "Corner overlay: {0}",
        Preview = "Preview: {0}",
        Failed = "Failed: {0}",
        NoLanguages = "No such language '{0}'. Available: auto, en, zh.",
        Summary = "{0} of {1} image(s) processed.",
        ErrUnknownOption = "Unknown option '{0}'.",
        ErrMissingValue = "Option '{0}' needs a value.",
        ErrNoInput = "No input images given.",
        ErrOutWithMultiple = "--out can only be used with a single input image.",
        ErrInvalidMargin = "Invalid --margin '{0}'. Expected a number between 0 and 0.5.",
        ErrInvalidReadingEdge = "Invalid --reading-edge '{0}'. Expected top, right, bottom or left.",
        ErrInvalidPositiveInt = "Invalid value '{1}' for {0}. Expected a positive integer.",
        ErrInvalidPngEffort = "Invalid --png '{0}'. Expected fast, balanced or small.",
    };

    public static readonly Messages Chinese = new()
    {
        Code = "zh",
        Scan = "正在处理 {0}",
        Wrote = "已输出 {0}（{1} x {2}，{3:0.0} MB，耗时 {4:0.0} 秒）",
        Verify = "四角校验图：{0}",
        Preview = "预览图：{0}",
        Failed = "失败：{0}",
        NoLanguages = "不支持的语言 '{0}'。可选：auto、en、zh。",
        Summary = "共 {1} 张，成功 {0} 张。",
        ErrUnknownOption = "未知选项 '{0}'。",
        ErrMissingValue = "选项 '{0}' 缺少参数值。",
        ErrNoInput = "没有指定输入图片。",
        ErrOutWithMultiple = "--out 只能在只有一张输入图片时使用。",
        ErrInvalidMargin = "--margin 取值无效：'{0}'，应为 0 到 0.5 之间的数字。",
        ErrInvalidReadingEdge = "--reading-edge 取值无效：'{0}'，应为 top、right、bottom 或 left。",
        ErrInvalidPositiveInt = "{0} 的取值 '{1}' 无效，应为正整数。",
        ErrInvalidPngEffort = "--png 取值无效：'{0}'，应为 fast、balanced 或 small。",
    };

    public required string Code { get; init; }

    public required string Scan { get; init; }

    public required string Wrote { get; init; }

    public required string Verify { get; init; }

    public required string Preview { get; init; }

    public required string Failed { get; init; }

    public required string NoLanguages { get; init; }

    public required string Summary { get; init; }

    public required string ErrUnknownOption { get; init; }

    public required string ErrMissingValue { get; init; }

    public required string ErrNoInput { get; init; }

    public required string ErrOutWithMultiple { get; init; }

    public required string ErrInvalidMargin { get; init; }

    public required string ErrInvalidReadingEdge { get; init; }

    public required string ErrInvalidPositiveInt { get; init; }

    public required string ErrInvalidPngEffort { get; init; }

    /// <summary>Resolves <c>auto</c>, <c>en</c> or <c>zh</c>, falling back to the OS UI language.</summary>
    public static bool TryResolve(string requested, out Messages messages, out bool recognised)
    {
        switch (requested.ToLowerInvariant())
        {
            case "en":
            case "en-us":
            case "en-gb":
                messages = English;
                recognised = true;
                return true;

            case "zh":
            case "zh-cn":
            case "zh-hans":
            case "zh-hant":
            case "zh-tw":
                messages = Chinese;
                recognised = true;
                return true;

            case "auto":
            case "":
                string ui = Environment.GetEnvironmentVariable("PAPERSCAN_LANG") ?? CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
                messages = ui.StartsWith("zh", StringComparison.OrdinalIgnoreCase) ? Chinese : English;
                recognised = true;
                return true;

            default:
                recognised = false;
                messages = English;
                return false;
        }
    }

    public string Format(ParseError error) => error.Key switch
    {
        "err.unknownOption" => string.Format(CultureInfo.CurrentCulture, ErrUnknownOption, error.Arguments),
        "err.missingValue" => string.Format(CultureInfo.CurrentCulture, ErrMissingValue, error.Arguments),
        "err.noInput" => ErrNoInput,
        "err.outWithMultipleInputs" => ErrOutWithMultiple,
        "err.invalidMargin" => string.Format(CultureInfo.CurrentCulture, ErrInvalidMargin, error.Arguments),
        "err.invalidReadingEdge" => string.Format(CultureInfo.CurrentCulture, ErrInvalidReadingEdge, error.Arguments),
        "err.invalidPositiveInt" => string.Format(CultureInfo.CurrentCulture, ErrInvalidPositiveInt, error.Arguments),
        "err.invalidPngEffort" => string.Format(CultureInfo.CurrentCulture, ErrInvalidPngEffort, error.Arguments),
        _ => error.Key,
    };

    public string Help(string executable) => Code == "zh"
        ? string.Format(
            CultureInfo.InvariantCulture,
            """
            用法: {0} <照片...> [选项]

            把手机拍的文档照片转成扫描件：自动找四角 + 透视矫正 + 白平衡 + 裁掉背景，
            输出无损 PNG。不联网、不上传，全部在本机完成。

            参数:
              -o, --out <文件>            输出路径（仅在只有一张输入时可用）
              -c, --corners <四角>        手动指定四角 "x,y;x,y;x,y;x,y"
                                          顺序为可读方向的 左上;右上;右下;左下
              -r, --reading-edge <边>     页面可读的"上"朝向照片哪条边:
                                          top | right | bottom | left（默认 top）
              -m, --margin <比例>         四周留白，占页面尺寸的比例（默认 0）
                  --no-trim               不裁掉边缘残留的背景
                  --no-verify             不输出四角校验图
                  --no-preview            不输出预览图
                  --preview-width <像素>  预览图宽度（默认 1600）
                  --detect-long-edge <px> 检测用缩略图长边（默认 1024）
                  --png <档位>             PNG 压缩档位: fast | balanced | small（默认 fast）
              -l, --lang <语言>           界面语言: auto | en | zh（默认 auto）
              -q, --quiet                 只输出错误
              -h, --help                  显示本帮助
              -V, --version               显示版本

            输出（与输入照片同目录）:
              <名称>-scan.png     成品
              <名称>-verify.png   自动检测的四角叠加图
              <名称>-preview.png  成品缩略图
            """,
            executable)
        : string.Format(
            CultureInfo.InvariantCulture,
            """
            Usage: {0} <photo...> [options]

            Turn phone photos of documents into scans: automatic corner detection,
            perspective rectification, white balance and background trimming, written
            out as lossless PNG. Everything runs locally; nothing is uploaded.

            Options:
              -o, --out <file>           Output path (single input only)
              -c, --corners <quad>       Manual corners "x,y;x,y;x,y;x,y" in reading
                                         order: top-left;top-right;bottom-right;bottom-left
              -r, --reading-edge <edge>  Which photo edge the page's readable "up"
                                         points at: top | right | bottom | left (default top)
              -m, --margin <ratio>       White border, as a fraction of the page (default 0)
                  --no-trim              Keep the raw rectified canvas
                  --no-verify            Do not write the corner overlay image
                  --no-preview           Do not write the preview image
                  --preview-width <px>   Preview width in pixels (default 1600)
                  --detect-long-edge <px> Detection thumbnail long edge (default 1024)
                  --png <effort>         PNG encoder effort: fast | balanced | small
                                         (default fast)
              -l, --lang <lang>          UI language: auto | en | zh (default auto)
              -q, --quiet                Only report errors
              -h, --help                 Show this help
              -V, --version              Show version

            Output (written next to the input photo):
              <name>-scan.png     the scan
              <name>-verify.png   detected corners drawn on the photo
              <name>-preview.png  downscaled preview
            """,
            executable);
}
