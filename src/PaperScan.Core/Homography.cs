namespace PaperScan;

/// <summary>
/// A planar homography that maps the unit square (0,0)-(1,1) onto an arbitrary
/// quadrilateral, together with the inverse mapping used to locate source pixels
/// inside the warped canvas.
/// </summary>
public sealed class Homography
{
    // Coefficients are h11 h12 h13 h21 h22 h23 h31 h32 with h33 fixed at 1.
    private readonly double[] h;

    private Homography(double[] coefficients) => h = coefficients;

    /// <summary>Raw coefficients <c>h11 h12 h13 h21 h22 h23 h31 h32</c>, for tight pixel loops.</summary>
    internal double[] Coefficients => h;

    /// <summary>Builds the homography sending (0,0),(1,0),(1,1),(0,1) to the quad's four corners.</summary>
    public static Homography FromUnitSquare(Quad quad)
    {
        double[] u = [0, 1, 1, 0];
        double[] v = [0, 0, 1, 1];

        double[,] a = new double[8, 8];
        double[] b = new double[8];

        for (int i = 0; i < 4; i++)
        {
            double x = quad[i].X;
            double y = quad[i].Y;

            a[i * 2, 0] = u[i];
            a[i * 2, 1] = v[i];
            a[i * 2, 2] = 1;
            a[i * 2, 6] = -u[i] * x;
            a[i * 2, 7] = -v[i] * x;
            b[i * 2] = x;

            a[(i * 2) + 1, 3] = u[i];
            a[(i * 2) + 1, 4] = v[i];
            a[(i * 2) + 1, 5] = 1;
            a[(i * 2) + 1, 6] = -u[i] * y;
            a[(i * 2) + 1, 7] = -v[i] * y;
            b[(i * 2) + 1] = y;
        }

        return new Homography(GaussianElimination.Solve(a, b, 8));
    }

    /// <summary>Forward map: unit-square coordinates to source pixel coordinates.</summary>
    public PointD Map(double u, double v)
    {
        double den = (h[6] * u) + (h[7] * v) + 1.0;
        return new PointD(
            ((h[0] * u) + (h[1] * v) + h[2]) / den,
            ((h[3] * u) + (h[4] * v) + h[5]) / den);
    }

    /// <summary>
    /// Inverse map: solves <c>Map(u,v) == (x,y)</c>. Used to find where a source point
    /// lands on the warped canvas.
    /// </summary>
    public PointD MapInverse(double x, double y)
    {
        double a11 = h[0] - (x * h[6]);
        double a12 = h[1] - (x * h[7]);
        double b1 = x - h[2];
        double a21 = h[3] - (y * h[6]);
        double a22 = h[4] - (y * h[7]);
        double b2 = y - h[5];

        double det = (a11 * a22) - (a12 * a21);
        if (Math.Abs(det) < 1e-12)
        {
            return new PointD(0.5, 0.5);
        }

        return new PointD(
            ((b1 * a22) - (a12 * b2)) / det,
            ((a11 * b2) - (b1 * a21)) / det);
    }
}
