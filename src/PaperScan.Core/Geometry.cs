using System.Globalization;

namespace PaperScan;

/// <summary>A point in image space: pixels, origin at the top-left corner.</summary>
public readonly record struct PointD(double X, double Y)
{
    public double DistanceTo(PointD other)
    {
        double dx = X - other.X;
        double dy = Y - other.Y;
        return Math.Sqrt(dx * dx + dy * dy);
    }

    public override string ToString() =>
        string.Create(CultureInfo.InvariantCulture, $"{X:0.##},{Y:0.##}");
}

/// <summary>
/// The four corners of the photographed page, always in <em>reading order</em>:
/// top-left, top-right, bottom-right, bottom-left.
/// </summary>
/// <remarks>
/// "Reading order" means the order you would name the corners while looking at the page
/// the right way up, which is not necessarily the order they appear in the photo. Use
/// <see cref="Rotate"/> to reinterpret a quad that was detected in photo order.
/// </remarks>
public readonly struct Quad
{
    public Quad(PointD topLeft, PointD topRight, PointD bottomRight, PointD bottomLeft)
    {
        TopLeft = topLeft;
        TopRight = topRight;
        BottomRight = bottomRight;
        BottomLeft = bottomLeft;
    }

    public PointD TopLeft { get; }

    public PointD TopRight { get; }

    public PointD BottomRight { get; }

    public PointD BottomLeft { get; }

    /// <summary>Corners in reading order. Index 0..3 = TL, TR, BR, BL.</summary>
    public PointD this[int index] => index switch
    {
        0 => TopLeft,
        1 => TopRight,
        2 => BottomRight,
        3 => BottomLeft,
        _ => throw new ArgumentOutOfRangeException(nameof(index), index, "A quad has exactly four corners (0..3)."),
    };

    public PointD Centroid => new(
        (TopLeft.X + TopRight.X + BottomRight.X + BottomLeft.X) / 4.0,
        (TopLeft.Y + TopRight.Y + BottomRight.Y + BottomLeft.Y) / 4.0);

    public double TopWidth => TopLeft.DistanceTo(TopRight);

    public double BottomWidth => BottomLeft.DistanceTo(BottomRight);

    public double LeftHeight => TopLeft.DistanceTo(BottomLeft);

    public double RightHeight => TopRight.DistanceTo(BottomRight);

    /// <summary>Average width and height of the page in source pixels.</summary>
    public (double Width, double Height) PaperSize =>
        ((TopWidth + BottomWidth) / 2.0, (LeftHeight + RightHeight) / 2.0);

    /// <summary>Scales the quad about its centroid. <paramref name="factor"/> &gt; 1 grows it.</summary>
    public Quad ExpandAboutCentroid(double factor)
    {
        PointD c = Centroid;

        PointD Expand(PointD p) => new(c.X + ((p.X - c.X) * factor), c.Y + ((p.Y - c.Y) * factor));

        return new Quad(Expand(TopLeft), Expand(TopRight), Expand(BottomRight), Expand(BottomLeft));
    }

    /// <summary>
    /// Re-labels a quad that was detected in photo orientation so that its corners are in
    /// reading order for a page whose readable "up" points towards <paramref name="edge"/>.
    /// </summary>
    public Quad Rotate(ReadingEdge edge) => edge switch
    {
        ReadingEdge.Top => this,
        ReadingEdge.Right => new Quad(TopRight, BottomRight, BottomLeft, TopLeft),
        ReadingEdge.Bottom => new Quad(BottomRight, BottomLeft, TopLeft, TopRight),
        ReadingEdge.Left => new Quad(BottomLeft, TopLeft, TopRight, BottomRight),
        _ => throw new ArgumentOutOfRangeException(nameof(edge), edge, "Unknown reading edge."),
    };

    /// <summary>Flat form: <c>x0,y0,x1,y1,x2,y2,x3,y3</c>.</summary>
    public double[] ToArray() =>
    [
        TopLeft.X, TopLeft.Y,
        TopRight.X, TopRight.Y,
        BottomRight.X, BottomRight.Y,
        BottomLeft.X, BottomLeft.Y,
    ];

    public static Quad FromArray(ReadOnlySpan<double> values)
    {
        if (values.Length != 8)
        {
            throw new ArgumentException($"A quad needs 8 numbers, got {values.Length}.", nameof(values));
        }

        return new Quad(
            new PointD(values[0], values[1]),
            new PointD(values[2], values[3]),
            new PointD(values[4], values[5]),
            new PointD(values[6], values[7]));
    }

    /// <summary>
    /// Parses <c>"x,y;x,y;x,y;x,y"</c> as produced by the verify image workflow
    /// (read the pixel coordinates of the four corners off the source image).
    /// </summary>
    public static Quad Parse(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        string[] groups = text.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (groups.Length != 4)
        {
            throw new FormatException(
                $"Expected 4 corner groups separated by ';', got {groups.Length}. Example: \"100,120;1900,140;1880,2600;120,2580\".");
        }

        double[] values = new double[8];
        for (int i = 0; i < 4; i++)
        {
            string[] parts = groups[i].Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 2 ||
                !double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i * 2]) ||
                !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out values[i * 2 + 1]))
            {
                throw new FormatException($"Corner {i + 1} ('{groups[i]}') is not a valid \"x,y\" pair.");
            }
        }

        return FromArray(values);
    }

    public override string ToString() => string.Join(';', this[0], this[1], this[2], this[3]);
}

/// <summary>Which edge of the photo the readable "up" direction of the page points at.</summary>
public enum ReadingEdge
{
    Top,
    Right,
    Bottom,
    Left,
}

/// <summary>A rectangle in pixel coordinates.</summary>
public readonly record struct PixelRect(int X, int Y, int Width, int Height)
{
    public int Right => X + Width;

    public int Bottom => Y + Height;

    public override string ToString() => $"{Width}x{Height}+{X}+{Y}";
}
