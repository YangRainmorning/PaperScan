#Requires -Version 5.1
<#
.SYNOPSIS
    Builds, tests and optionally publishes PaperScan.

.EXAMPLE
    ./scripts/build.ps1
    Builds and runs the test suite.

.EXAMPLE
    ./scripts/build.ps1 -Publish -SelfContained
    Produces a single self-contained paperscan.exe in ./dist that runs without .NET installed.

.EXAMPLE
    ./scripts/build.ps1 -Publish -Runtime linux-x64 -OutputDirectory dist/linux
    Cross-publishes a Linux build from any host.
#>
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string] $Configuration = 'Release',

    [switch] $Publish,

    [switch] $SelfContained,

    [switch] $SkipTests,

    [ValidateSet('win-x64', 'win-arm64', 'linux-x64', 'linux-arm64', 'osx-x64', 'osx-arm64')]
    [string] $Runtime = 'win-x64',

    [string] $OutputDirectory = 'dist'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'src/PaperScan.Cli/PaperScan.Cli.csproj'

function Invoke-Step {
    param([string] $Name, [string[]] $Arguments)

    Write-Host "==> $Name" -ForegroundColor Cyan
    & dotnet @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

Push-Location $root
try {
    Invoke-Step 'Restore' @('restore', '--nologo')
    Invoke-Step 'Build' @('build', '-c', $Configuration, '--no-restore', '--nologo')

    if (-not $SkipTests) {
        Invoke-Step 'Test' @('test', '-c', $Configuration, '--no-build', '--nologo')
    }

    if ($Publish) {
        $output = if ([System.IO.Path]::IsPathRooted($OutputDirectory)) {
            $OutputDirectory
        } else {
            Join-Path $root $OutputDirectory
        }

        $publishArgs = @(
            'publish', $project,
            '-c', $Configuration,
            '-r', $Runtime,
            "--self-contained", $SelfContained.IsPresent.ToString().ToLowerInvariant(),
            '-p:PublishSingleFile=true',
            '-p:IncludeNativeLibrariesForSelfExtract=true',
            '-p:PublishTrimmed=false',
            '-p:DebugType=none',
            '-o', $output,
            '--nologo'
        )

        Invoke-Step "Publish ($Runtime)" $publishArgs

        $executable = if ($Runtime.StartsWith('win')) { 'paperscan.exe' } else { 'paperscan' }
        Write-Host ''
        Write-Host "Done: $(Join-Path $output $executable)" -ForegroundColor Green
    }
}
finally {
    Pop-Location
}
