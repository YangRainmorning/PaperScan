namespace PaperScan;

/// <summary>Dense Gauss-Jordan elimination with partial pivoting. Small systems only.</summary>
internal static class GaussianElimination
{
    /// <summary>
    /// Solves <c>A x = b</c> for a square <paramref name="n"/>x<paramref name="n"/> system.
    /// The supplied arrays are not modified.
    /// </summary>
    public static double[] Solve(double[,] a, double[] b, int n)
    {
        double[,] m = (double[,])a.Clone();
        double[] rhs = (double[])b.Clone();

        for (int i = 0; i < n; i++)
        {
            int pivot = i;
            for (int r = i + 1; r < n; r++)
            {
                if (Math.Abs(m[r, i]) > Math.Abs(m[pivot, i]))
                {
                    pivot = r;
                }
            }

            if (pivot != i)
            {
                for (int c = i; c < n; c++)
                {
                    (m[i, c], m[pivot, c]) = (m[pivot, c], m[i, c]);
                }

                (rhs[i], rhs[pivot]) = (rhs[pivot], rhs[i]);
            }

            double p = m[i, i];
            if (Math.Abs(p) < 1e-15)
            {
                throw new InvalidOperationException("The corner set is degenerate: the system has no unique solution.");
            }

            for (int c = i; c < n; c++)
            {
                m[i, c] /= p;
            }

            rhs[i] /= p;

            for (int r = 0; r < n; r++)
            {
                if (r == i)
                {
                    continue;
                }

                double f = m[r, i];
                if (f == 0)
                {
                    continue;
                }

                for (int c = i; c < n; c++)
                {
                    m[r, c] -= f * m[i, c];
                }

                rhs[r] -= f * rhs[i];
            }
        }

        return rhs;
    }
}
