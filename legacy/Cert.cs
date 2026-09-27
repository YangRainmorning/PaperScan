using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

/// <summary>
/// 文档拍照 -> 扫描件。两步：DetectCorners 找四角（并输出校验图），MakeScan 做透视矫正+白平衡+白边。
/// </summary>
public static class Cert
{
    // ================= 1. 自动找四角 =================
    public static int DW = 768, DH = 1024;      // 缩略图尺寸，长边设为 1024
    static byte[] db; static int dStride;

    public static void LoadSmall(string path)
    {
        using (var bmp = new Bitmap(path))
        using (var s = new Bitmap(DW, DH, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(s))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.DrawImage(bmp, 0, 0, DW, DH);
            }
            var d = s.LockBits(new Rectangle(0, 0, DW, DH), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            dStride = d.Stride; db = new byte[dStride * DH];
            Marshal.Copy(d.Scan0, db, 0, db.Length);
            s.UnlockBits(d);
        }
    }

    // 证书纸面：够亮 + 偏暖(红>蓝) + 绿>=蓝
    static bool Paper(int x, int y)
    {
        int i = y * dStride + x * 4;
        int b = db[i], g = db[i + 1], r = db[i + 2];
        if (r < 165) return false;
        int rb = r - b;
        if (rb < 6 || rb > 75) return false;
        if (g < b) return false;
        return true;
    }

    /// <summary>返回图像坐标下的四角 [TL,TR,BR,BL]（原图像素），并写出校验图。</summary>
    public static double[] DetectCorners(string srcPath, string verifyPath, out int bestSize)
    {
        byte[] mask = new byte[DW * DH];
        for (int y = 0; y < DH; y++)
            for (int x = 0; x < DW; x++)
                if (Paper(x, y)) mask[y * DW + x] = 1;

        int[] lab = new int[DW * DH]; int[] st = new int[DW * DH];
        int cur = 0, bestLab = 0; bestSize = 0;
        for (int i = 0; i < DW * DH; i++)
        {
            if (mask[i] == 0 || lab[i] != 0) continue;
            cur++; int sp = 0; st[sp++] = i; lab[i] = cur; int sz = 0;
            while (sp > 0)
            {
                int p = st[--sp]; sz++;
                int px = p % DW, py = p / DW;
                if (px > 0) { int q = p - 1; if (mask[q] == 1 && lab[q] == 0) { lab[q] = cur; st[sp++] = q; } }
                if (px < DW - 1) { int q = p + 1; if (mask[q] == 1 && lab[q] == 0) { lab[q] = cur; st[sp++] = q; } }
                if (py > 0) { int q = p - DW; if (mask[q] == 1 && lab[q] == 0) { lab[q] = cur; st[sp++] = q; } }
                if (py < DH - 1) { int q = p + DW; if (mask[q] == 1 && lab[q] == 0) { lab[q] = cur; st[sp++] = q; } }
            }
            if (sz > bestSize) { bestSize = sz; bestLab = cur; }
        }

        int tl = -1, tr = -1, br = -1, bl = -1;
        int a1 = int.MaxValue, a2 = int.MinValue, a3 = int.MinValue, a4 = int.MaxValue;
        for (int i = 0; i < DW * DH; i++)
        {
            if (lab[i] != bestLab) continue;
            int x = i % DW, y = i / DW;
            int s1 = x + y, s2 = x - y;
            if (s1 < a1) { a1 = s1; tl = i; }
            if (s2 > a2) { a2 = s2; tr = i; }
            if (s1 > a3) { a3 = s1; br = i; }
            if (s2 < a4) { a4 = s2; bl = i; }
        }

        if (verifyPath != null)
        {
            using (var bmp = new Bitmap(srcPath))
            using (var v = new Bitmap(DW, DH, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(v))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.DrawImage(bmp, 0, 0, DW, DH);
                    var pts = new PointF[] { new PointF(tl % DW, tl / DW), new PointF(tr % DW, tr / DW), new PointF(br % DW, br / DW), new PointF(bl % DW, bl / DW) };
                    g.DrawPolygon(new Pen(Color.FromArgb(255, 0, 255, 0), 2), pts);
                    var rb = new SolidBrush(Color.FromArgb(255, 255, 0, 0));
                    foreach (var p in pts) g.FillEllipse(rb, p.X - 5, p.Y - 5, 10, 10);
                }
                v.Save(verifyPath, ImageFormat.Png);
            }
        }

        double kx = 1.0 * srcW(srcPath) / DW, ky = 1.0 * srcH(srcPath) / DH;
        return new double[] { (tl % DW) * kx, (tl / DW) * ky, (tr % DW) * kx, (tr / DW) * ky,
                              (br % DW) * kx, (br / DW) * ky, (bl % DW) * kx, (bl / DW) * ky };
    }

    static int _sw, _sh;
    static int srcW(string p) { Probe(p); return _sw; }
    static int srcH(string p) { Probe(p); return _sh; }
    static void Probe(string p) { using (var b = new Bitmap(p)) { _sw = b.Width; _sh = b.Height; } }

    // ================= 2. 透视矫正成扫描件 =================
    static byte[] src; static int sStride; static int SW, SH;

    public static void LoadSrc(string path)
    {
        using (var bmp = new Bitmap(path))
        {
            SW = bmp.Width; SH = bmp.Height;
            using (var t = new Bitmap(SW, SH, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(t)) g.DrawImage(bmp, 0, 0, SW, SH);
                var d = t.LockBits(new Rectangle(0, 0, SW, SH), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                sStride = d.Stride; src = new byte[sStride * SH];
                Marshal.Copy(d.Scan0, src, 0, src.Length);
                t.UnlockBits(d);
            }
        }
    }

    static double[] Solve(double[,] A, double[] b, int n)
    {
        for (int i = 0; i < n; i++)
        {
            int pv = i;
            for (int r = i + 1; r < n; r++) if (Math.Abs(A[r, i]) > Math.Abs(A[pv, i])) pv = r;
            for (int c = i; c < n; c++) { double t = A[i, c]; A[i, c] = A[pv, c]; A[pv, c] = t; }
            double tb = b[i]; b[i] = b[pv]; b[pv] = tb;
            double p = A[i, i];
            for (int c = i; c < n; c++) A[i, c] /= p;
            b[i] /= p;
            for (int r = 0; r < n; r++)
            {
                if (r == i) continue;
                double f = A[r, i]; if (f == 0) continue;
                for (int c = i; c < n; c++) A[r, c] -= f * A[i, c];
                b[r] -= f * b[i];
            }
        }
        return b;
    }

    /// <summary>单位正方形 -> 四边形 的单应系数 [h11 h12 h13 h21 h22 h23 h31 h32]</summary>
    public static double[] Homography(double[] quad)
    {
        double[] u = { 0, 1, 1, 0 }, v = { 0, 0, 1, 1 };
        double[,] A = new double[8, 8]; double[] b = new double[8];
        for (int i = 0; i < 4; i++)
        {
            double X = quad[i * 2], Y = quad[i * 2 + 1];
            A[i * 2, 0] = u[i]; A[i * 2, 1] = v[i]; A[i * 2, 2] = 1;
            A[i * 2, 6] = -u[i] * X; A[i * 2, 7] = -v[i] * X; b[i * 2] = X;
            A[i * 2 + 1, 3] = u[i]; A[i * 2 + 1, 4] = v[i]; A[i * 2 + 1, 5] = 1;
            A[i * 2 + 1, 6] = -u[i] * Y; A[i * 2 + 1, 7] = -v[i] * Y; b[i * 2 + 1] = Y;
        }
        return Solve(A, b, 8);
    }

    /// <summary>求 (u,v) 使 H(u,v)=源坐标(X,Y)，用于把证书四角映射到输出画布。</summary>
    static double[] InvMapUV(double[] h, double X, double Y)
    {
        double A11 = h[0] - X * h[6], A12 = h[1] - X * h[7], B1 = X - h[2];
        double A21 = h[3] - Y * h[6], A22 = h[4] - Y * h[7], B2 = Y - h[5];
        double det = A11 * A22 - A12 * A21;
        if (Math.Abs(det) < 1e-12) return new double[] { 0.5, 0.5 };
        return new double[] { (B1 * A22 - A12 * B2) / det, (A11 * B2 - B1 * A21) / det };
    }

    /// <summary>
    /// 生成扫描件。quad = 证书四角（按可读方向的 TL,TR,BR,BL）；
    /// margin = 白边占证书尺寸的比例（0.025 = 每边 2.5%）。
    /// </summary>
    public static string MakeScan(string dstPath, double[] quad, double margin, out int ow, out int oh, out double[] pct)
    {
        double wT = Dist(quad, 0, 1), wB = Dist(quad, 3, 2), hL = Dist(quad, 0, 3), hR = Dist(quad, 1, 2);
        ow = (int)Math.Round((wT + wB) / 2);
        oh = (int)Math.Round((hL + hR) / 2);

        // 以质心为中心外扩
        double cx = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
        double cy = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
        double k = 1 + 2 * margin;
        double[] q2 = new double[8];
        for (int i = 0; i < 4; i++)
        {
            q2[i * 2] = cx + (quad[i * 2] - cx) * k;
            q2[i * 2 + 1] = cy + (quad[i * 2 + 1] - cy) * k;
        }
        int OW = (int)Math.Round(ow * k), OH = (int)Math.Round(oh * k);

        double[] h = Homography(q2);
        double h11 = h[0], h12 = h[1], h13 = h[2], h21 = h[3], h22 = h[4], h23 = h[5], h31 = h[6], h32 = h[7];

        byte[] o = new byte[OW * OH * 3];
        long[] hiR = new long[256], hiG = new long[256], hiB = new long[256];
        for (int py = 0; py < OH; py++)
        {
            double vv = (py + 0.5) / OH;
            for (int px = 0; px < OW; px++)
            {
                double uu = (px + 0.5) / OW;
                double den = h31 * uu + h32 * vv + 1.0;
                double sx = (h11 * uu + h12 * vv + h13) / den;
                double sy = (h21 * uu + h22 * vv + h23) / den;
                if (sx < 0) sx = 0; if (sy < 0) sy = 0;
                if (sx > SW - 1.001) sx = SW - 1.001;
                if (sy > SH - 1.001) sy = SH - 1.001;
                int x0 = (int)sx, y0 = (int)sy;
                double fx = sx - x0, fy = sy - y0;
                int i00 = y0 * sStride + x0 * 4, i10 = i00 + 4, i01 = i00 + sStride, i11 = i01 + 4;
                double w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
                int R = (int)(src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11);
                int G = (int)(src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11);
                int B = (int)(src[i00 + 0] * w00 + src[i10 + 0] * w10 + src[i01 + 0] * w01 + src[i11 + 0] * w11);
                if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
                int q = (py * OW + px) * 3;
                o[q] = (byte)R; o[q + 1] = (byte)G; o[q + 2] = (byte)B;
                hiR[R]++; hiG[G]++; hiB[B]++;
            }
        }

        long tot = (long)OW * OH;
        pct = new double[3]; double[] gains = new double[3];
        for (int c = 0; c < 3; c++)
        {
            long[] hh = c == 0 ? hiR : c == 1 ? hiG : hiB;
            long acc = 0; int val = 255;
            for (int t = 0; t < 256; t++) { acc += hh[t]; if (acc >= tot * 0.90) { val = t; break; } }
            pct[c] = val; gains[c] = 250.0 / Math.Max(1.0, val);
        }
        for (int i = 0; i < o.Length; i += 3)
        {
            int R = (int)(o[i] * gains[0]), G = (int)(o[i + 1] * gains[1]), B = (int)(o[i + 2] * gains[2]);
            if (R > 255) R = 255; if (G > 255) G = 255; if (B > 255) B = 255;
            o[i] = (byte)R; o[i + 1] = (byte)G; o[i + 2] = (byte)B;
        }

        using (var raw = new Bitmap(OW, OH, PixelFormat.Format24bppRgb))
        {
            var d = raw.LockBits(new Rectangle(0, 0, OW, OH), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
            int st = d.Stride; byte[] row = new byte[st];
            for (int y = 0; y < OH; y++)
            {
                for (int x = 0; x < OW; x++)
                {
                    int q = (y * OW + x) * 3;
                    row[x * 3] = o[q + 2]; row[x * 3 + 1] = o[q + 1]; row[x * 3 + 2] = o[q];
                }
                Marshal.Copy(row, 0, d.Scan0 + y * st, st);
            }
            raw.UnlockBits(d);

            // 证书四角映射到画布，用它裁出白边
            double e = 1.002;
            var pts = new PointF[4];
            for (int i = 0; i < 4; i++)
            {
                double X = cx + (quad[i * 2] - cx) * e, Y = cy + (quad[i * 2 + 1] - cy) * e;
                double[] uv = InvMapUV(h, X, Y);
                pts[i] = new PointF((float)(uv[0] * OW), (float)(uv[1] * OH));
            }

            using (var outp = new Bitmap(OW, OH, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(outp))
                {
                    g.Clear(Color.White);
                    var path = new GraphicsPath();
                    path.AddPolygon(pts);
                    g.SetClip(path);
                    g.DrawImage(raw, 0, 0, OW, OH);
                }
                outp.Save(dstPath, ImageFormat.Png);
            }
        }
        o = null; src = null;
        return string.Format("net={0}x{1} canvas={2}x{3} paper90=R{4} G{5} B{6} gain=R{7:F3} G{8:F3} B{9:F3}",
            ow, oh, OW, OH, pct[0], pct[1], pct[2], gains[0], gains[1], gains[2]);
    }

    static double Dist(double[] q, int a, int b)
    {
        double dx = q[a * 2] - q[b * 2], dy = q[a * 2 + 1] - q[b * 2 + 1];
        return Math.Sqrt(dx * dx + dy * dy);
    }
}
