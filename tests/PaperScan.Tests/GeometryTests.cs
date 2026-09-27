using Xunit;

namespace PaperScan.Tests;

public class GeometryTests
{
    [Fact]
    public void Parse_ReadsCornersInReadingOrder()
    {
        Quad quad = Quad.Parse("10,20; 30,40; 50,60; 70,80");

        Assert.Equal(new PointD(10, 20), quad.TopLeft);
        Assert.Equal(new PointD(30, 40), quad.TopRight);
        Assert.Equal(new PointD(50, 60), quad.BottomRight);
        Assert.Equal(new PointD(70, 80), quad.BottomLeft);
    }

    [Fact]
    public void Parse_RoundTripsThroughToString()
    {
        Quad original = Quad.Parse("1,2;3,4;5,6;7,8");

        Assert.Equal(original.ToArray(), Quad.Parse(original.ToString()).ToArray());
    }

    [Theory]
    [InlineData("")]
    [InlineData("1,2;3,4")]
    [InlineData("1,2;3,4;5,6;7,8;9,10")]
    [InlineData("1,2;3,4;5,6;7")]
    [InlineData("a,b;3,4;5,6;7,8")]
    public void Parse_RejectsMalformedInput(string text)
    {
        Assert.Throws<FormatException>(() => Quad.Parse(text));
    }

    [Fact]
    public void Rotate_RelabelsCornersForEachReadingEdge()
    {
        Quad quad = new(new PointD(0, 0), new PointD(1, 0), new PointD(1, 1), new PointD(0, 1));

        Assert.Equal(quad.TopLeft, quad.Rotate(ReadingEdge.Top).TopLeft);
        Assert.Equal(quad.TopRight, quad.Rotate(ReadingEdge.Right).TopLeft);
        Assert.Equal(quad.BottomRight, quad.Rotate(ReadingEdge.Bottom).TopLeft);
        Assert.Equal(quad.BottomLeft, quad.Rotate(ReadingEdge.Left).TopLeft);
    }

    [Fact]
    public void Rotate_IsCyclic()
    {
        Quad quad = new(new PointD(0, 0), new PointD(10, 1), new PointD(9, 11), new PointD(-1, 10));

        Quad rotated = quad.Rotate(ReadingEdge.Right).Rotate(ReadingEdge.Right).Rotate(ReadingEdge.Right).Rotate(ReadingEdge.Right);

        Assert.Equal(quad.ToArray(), rotated.ToArray());
    }

    [Fact]
    public void PaperSize_UsesMeanOppositeEdges()
    {
        Quad quad = new(new PointD(0, 0), new PointD(100, 0), new PointD(100, 200), new PointD(0, 200));

        (double width, double height) = quad.PaperSize;

        Assert.Equal(100, width, 6);
        Assert.Equal(200, height, 6);
    }

    [Fact]
    public void ExpandAboutCentroid_KeepsTheCentreAndScalesEdges()
    {
        Quad quad = new(new PointD(0, 0), new PointD(100, 0), new PointD(100, 100), new PointD(0, 100));

        Quad grown = quad.ExpandAboutCentroid(2);

        Assert.Equal(50, grown.Centroid.X, 6);
        Assert.Equal(50, grown.Centroid.Y, 6);
        Assert.Equal(new PointD(-50, -50), grown.TopLeft);
        Assert.Equal(new PointD(150, 150), grown.BottomRight);
    }

    [Fact]
    public void FromArray_RejectsWrongLength()
    {
        Assert.Throws<ArgumentException>(() => Quad.FromArray([1, 2, 3]));
    }

    [Fact]
    public void Indexer_ThrowsOutsideZeroToThree()
    {
        Quad quad = Quad.Parse("0,0;1,0;1,1;0,1");

        Assert.Throws<ArgumentOutOfRangeException>(() => quad[4]);
    }
}
