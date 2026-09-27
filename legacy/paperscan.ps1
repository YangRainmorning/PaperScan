<#
  文档拍照 -> 扫描件
  ------------------------------------------------------------------
  用法示例:
    自动:        .\扫描.ps1 -Image "IMG.jpg"
    证书横躺在照片里（可读的"上"对应照片的右边）:
                 .\扫描.ps1 -Image "IMG.jpg" -ReadingEdge right
    自动检测不准时手填四角（图像坐标，按"可读方向"的 左上;右上;右下;左下）:
                 .\扫描.ps1 -Image "IMG.jpg" -Corners "5834,456;5789,7975;489,7975;424,520"
    要白边:      .\扫描.ps1 -Image "IMG.jpg" -Margin 0.03
    不要自动裁边: .\扫描.ps1 -Image "IMG.jpg" -Trim:$false

  输出:
    <同名>-扫描件.png      成品（透视矫正 + 白平衡 + 自动裁边），PNG 无损
    <同名>-校验图.png      自动检测的四角画在原图缩略图上的校验图
    <同名>-预览.png        成品的缩略预览
#>
param(
    [Parameter(Mandatory = $true)][string]$Image,
    [string]$Out = "",
    [double]$Margin = 0,
    [string]$Corners = "",
    [ValidateSet('top', 'right', 'bottom', 'left')][string]$ReadingEdge = 'top',
    [bool]$Trim = $true,
    [int]$PreviewWidth = 1600
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -Path (Join-Path $here 'Cert.cs') -ReferencedAssemblies System.Drawing

$Image = (Resolve-Path -LiteralPath $Image).Path
$dir = Split-Path -Parent $Image
$base = [System.IO.Path]::GetFileNameWithoutExtension($Image)
if ([string]::IsNullOrWhiteSpace($Out)) { $Out = Join-Path $dir "$base-扫描件.png" }
$Out = [System.IO.Path]::GetFullPath($Out)

# ---- 缩略图尺寸：长边 1024 ----
$im0 = [System.Drawing.Image]::FromFile($Image)
$W = $im0.Width; $H = $im0.Height; $im0.Dispose()
if ($W -ge $H) { [Cert]::DW = 1024; [Cert]::DH = [Math]::Round(1024.0 * $H / $W) }
else { [Cert]::DH = 1024; [Cert]::DW = [Math]::Round(1024.0 * $W / $H) }
Write-Host ("原图 {0} x {1}，检测用缩略图 {2} x {3}" -f $W, $H, [Cert]::DW, [Cert]::DH)

# ---- 自动找四角 ----
[Cert]::LoadSmall($Image)
$verify = [System.IO.Path]::Combine($dir, "$base-校验图.png")
$sz = 0
$auto = [Cert]::DetectCorners($Image, $verify, [ref]$sz)
Write-Host ("自动检测四角（图像坐标 TL/TR/BR/BL）: ({0},{1}) ({2},{3}) ({4},{5}) ({6},{7})  纸面占比 {8}%" -f `
        [int]$auto[0], [int]$auto[1], [int]$auto[2], [int]$auto[3], `
        [int]$auto[4], [int]$auto[5], [int]$auto[6], [int]$auto[7], `
    [Math]::Round(100.0 * $sz / ([Cert]::DW * [Cert]::DH), 1))
Write-Host "  校验图: $verify"

# ---- 决定最终四角（按可读方向的 左上,右上,右下,左下）----
if (-not [string]::IsNullOrWhiteSpace($Corners)) {
    $parts = $Corners -split ';'
    if ($parts.Count -ne 4) { throw '-Corners 需要 4 组，格式 x,y;x,y;x,y;x,y' }
    $q = @()
    foreach ($p in $parts) { $xy = $p -split ','; $q += [double]$xy[0].Trim(); $q += [double]$xy[1].Trim() }
    Write-Host "使用手动指定的四角。"
}
else {
    $iTL = @($auto[0], $auto[1]); $iTR = @($auto[2], $auto[3])
    $iBR = @($auto[4], $auto[5]); $iBL = @($auto[6], $auto[7])
    switch ($ReadingEdge) {
        'top' { $o = @($iTL, $iTR, $iBR, $iBL) }
        'right' { $o = @($iTR, $iBR, $iBL, $iTL) }
        'bottom' { $o = @($iBR, $iBL, $iTL, $iTR) }
        'left' { $o = @($iBL, $iTL, $iTR, $iBR) }
    }
    $q = @()
    foreach ($p in $o) { $q += $p[0]; $q += $p[1] }
    Write-Host "ReadingEdge = $ReadingEdge"
}

# ---- 生成扫描件 ----
[Cert]::LoadSrc($Image)
$ow = 0; $oh = 0; $pc = [double[]]::new(3)
$info = [Cert]::MakeScan($Out, $q, $Margin, [ref]$ow, [ref]$oh, [ref]$pc)
Write-Host $info

# ---- 自动裁掉边缘残留的背景（避免出现黑边/杂边）----
if ($Trim) {
    $bmp = [System.Drawing.Bitmap]::new($Out)
    $BW = $bmp.Width; $BH = $bmp.Height
    $TH = 140
    $tops = New-Object System.Collections.ArrayList
    $bots = New-Object System.Collections.ArrayList
    $lfts = New-Object System.Collections.ArrayList
    $rgts = New-Object System.Collections.ArrayList

    for ($i = 0; $i -lt 120; $i++) {
        $x = [int]($BW * (0.03 + 0.94 * $i / 119))
        for ($y = 0; $y -lt 600; $y++) {
            $c = $bmp.GetPixel($x, $y); $c2 = $bmp.GetPixel($x, $y + 4)
            if (($c.R * 299 + $c.G * 587 + $c.B * 114) / 1000 -gt $TH -and ($c2.R * 299 + $c2.G * 587 + $c2.B * 114) / 1000 -gt $TH) { [void]$tops.Add($y); break }
        }
        for ($y = $BH - 1; $y -gt $BH - 600; $y--) {
            $c = $bmp.GetPixel($x, $y); $c2 = $bmp.GetPixel($x, $y - 4)
            if (($c.R * 299 + $c.G * 587 + $c.B * 114) / 1000 -gt $TH -and ($c2.R * 299 + $c2.G * 587 + $c2.B * 114) / 1000 -gt $TH) { [void]$bots.Add($y); break }
        }
    }
    for ($i = 0; $i -lt 120; $i++) {
        $y = [int]($BH * (0.03 + 0.94 * $i / 119))
        for ($x = 0; $x -lt 600; $x++) {
            $c = $bmp.GetPixel($x, $y); $c2 = $bmp.GetPixel($x + 4, $y)
            if (($c.R * 299 + $c.G * 587 + $c.B * 114) / 1000 -gt $TH -and ($c2.R * 299 + $c2.G * 587 + $c2.B * 114) / 1000 -gt $TH) { [void]$lfts.Add($x); break }
        }
        for ($x = $BW - 1; $x -gt $BW - 600; $x--) {
            $c = $bmp.GetPixel($x, $y); $c2 = $bmp.GetPixel($x - 4, $y)
            if (($c.R * 299 + $c.G * 587 + $c.B * 114) / 1000 -gt $TH -and ($c2.R * 299 + $c2.G * 587 + $c2.B * 114) / 1000 -gt $TH) { [void]$rgts.Add($x); break }
        }
    }

    $yT = 0; $yB = $BH - 1; $xL = 0; $xR = $BW - 1
    if ($tops.Count -gt 10) { $yT = (($tops | Measure-Object -Maximum).Maximum) + 2 }
    if ($bots.Count -gt 10) { $yB = (($bots | Measure-Object -Minimum).Minimum) - 2 }
    if ($lfts.Count -gt 10) { $xL = (($lfts | Measure-Object -Maximum).Maximum) + 2 }
    if ($rgts.Count -gt 10) { $xR = (($rgts | Measure-Object -Minimum).Minimum) - 2 }

    if ($yB -gt $yT + 10 -and $xR -gt $xL + 10) {
        $rect = [System.Drawing.Rectangle]::new($xL, $yT, $xR - $xL + 1, $yB - $yT + 1)
        $crp = $bmp.Clone($rect, $bmp.PixelFormat)
        $bmp.Dispose()
        $crp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
        $crp.Dispose()
        Write-Host ("自动裁边: 上{0} 下{1} 左{2} 右{3} px  ->  净尺寸 {4} x {5}" -f $yT, ($BH - 1 - $yB), $xL, ($BW - 1 - $xR), ($xR - $xL + 1), ($yB - $yT + 1))
    }
    else {
        $bmp.Dispose()
        Write-Host "自动裁边: 无需裁切"
    }
}

Write-Host ("成品: {0}  ({1} MB)" -f $Out, [Math]::Round((Get-Item -LiteralPath $Out).Length / 1MB, 1))

# ---- 预览 ----
$prev = [System.IO.Path]::Combine($dir, "$base-预览.png")
$src = [System.Drawing.Image]::FromFile($Out)
$ph = [int][Math]::Round($PreviewWidth * $src.Height / $src.Width)
$p = [System.Drawing.Bitmap]::new($PreviewWidth, $ph)
$g = [System.Drawing.Graphics]::FromImage($p)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage($src, 0, 0, $PreviewWidth, $ph)
$g.Dispose()
$p.Save($prev, [System.Drawing.Imaging.ImageFormat]::Png)
$p.Dispose(); $src.Dispose()
Write-Host "预览: $prev"
