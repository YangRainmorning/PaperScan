# Legacy: the v0 PowerShell implementation

This directory holds the original single-file PowerShell tool that PaperScan was
ported from. It is **frozen**: no bug fixes, no new features. It exists because

1. it is the reference implementation the C# port was validated against, and
2. it still works on a bare Windows box with no .NET SDK and no downloads.

Everything it can do, the `paperscan` CLI now does — cross-platform, roughly four
times faster on a 50 MP photo, and covered by tests. Use it only if you cannot run
the CLI at all.

## Files

| File | Purpose |
|---|---|
| `Cert.cs` | Core engine. Compiled at runtime by `Add-Type`, so it must sit next to the script. |
| `paperscan.ps1` | Command-line entry point. |
| `paperscan.cmd` | Launcher that bypasses the execution policy, for drag-and-drop. |

## Usage

Drag a photo onto `paperscan.cmd`, or:

```powershell
.\paperscan.ps1 -Image "C:\photos\cert.jpg" -ReadingEdge right -Corners "5834,456;5789,7975;489,7975;424,520"
```

It writes `<name>-扫描件.png`, `<name>-校验图.png` and `<name>-预览.png` next to
the photo, i.e. the same three artefacts the CLI writes as `-scan`, `-verify`
and `-preview`.

## Why it was replaced

- Windows only, and the parameter handling only works through `-Command`, not `-File`.
- The background trimmer compared a floating-point luma while the C# port first
  compared a truncated integer, which shifted the right-hand trim by two pixels on
  the reference certificate. The port matches the reference behaviour exactly.
- It re-decodes the full-resolution PNG from disk in order to trim it.
- On a 50 MP photo it spends about 16 s in GDI+ and the CLI spends about 10 s
  end-to-end, including decoding and a faster PNG encoder.

See `CHANGELOG.md` for the measured comparison against the reference certificate.
