using Xunit;

namespace PaperScan.Tests;

public class HomographyTests
{
    private static readonly Quad Skewed = new(
        new PointD(120, 80),
        new PointD(980, 140),
        new PointD(1010, 1260),
        new PointD(90, 1180));

    [Fact]
    public void FromUnitSquare_MapsTheUnitSquareOntoTheQuad()
    {
        Homography h = Homography.FromUnitSquare(Skewed);

        AssertPoint(Skewed.TopLeft, h.Map(0, 0));
        AssertPoint(Skewed.TopRight, h.Map(1, 0));
        AssertPoint(Skewed.BottomRight, h.Map(1, 1));
        AssertPoint(Skewed.BottomLeft, h.Map(0, 1));
    }

    [Theory]
    [InlineData(0.25, 0.25)]
    [InlineData(0.5, 0.5)]
    [InlineData(0.1, 0.9)]
    [InlineData(0.9, 0.1)]
    public void MapInverse_InvertsTheForwardMap(double u, double v)
    {
        Homography h = Homography.FromUnitSquare(Skewed);

        PointD source = h.Map(u, v);
        PointD back = h.MapInverse(source.X, source.Y);

        Assert.Equal(u, back.X, 9);
        Assert.Equal(v, back.Y, 9);
    }

    [Fact]
    public void FromUnitSquare_ThrowsOnDegenerateQuad()
    {
        Quad collapsed = new(new PointD(0, 0), new PointD(0, 0), new PointD(0, 0), new PointD(0, 0));

        Assert.Throws<InvalidOperationException>(() => Homography.FromUnitSquare(collapsed));
    }

    private static void AssertPoint(PointD expected, PointD actual)
    {
        Assert.Equal(expected.X, actual.X, 6);
        Assert.Equal(expected.Y, actual.Y, 6);
    }
}
