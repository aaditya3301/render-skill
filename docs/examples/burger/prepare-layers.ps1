# Prepare the six source PNG cutouts for the engine's shared-canvas input format.
# Artwork source: https://github.com/smford/hamburger-decomp (AGPL-3.0).
# Changes: resample uniformly and register each cutout at its assembled position.
param([string]$Destination = (Join-Path $PSScriptRoot '..\..\..\output\burger-layers'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$target = [IO.Path]::GetFullPath($Destination)
$source = Join-Path $PSScriptRoot 'source'
New-Item -ItemType Directory -Force -Path $target | Out-Null
$baseUrl = 'https://raw.githubusercontent.com/smford/hamburger-decomp/76d55ba72525ee2c50a47bcac53f4e172651be7c/'
$parts = @(
    @{ Source = 'bun_top'; Name = '01-top-bun'; Y = -100 },
    @{ Source = 'sauce'; Name = '02-sauce'; Y = -50 },
    @{ Source = 'tomato'; Name = '03-tomato'; Y = -15 },
    @{ Source = 'lettuce'; Name = '04-lettuce'; Y = 22 },
    @{ Source = 'burger'; Name = '05-patty'; Y = 65 },
    @{ Source = 'bun_bottom'; Name = '06-bottom-bun'; Y = 115 }
)
foreach ($part in $parts) {
    $inputPath = Join-Path $source ($part.Source + '.png')
    if (!(Test-Path -LiteralPath $inputPath)) {
        Invoke-WebRequest -Uri ($baseUrl + 'assets/' + $part.Source + '.png') -OutFile $inputPath
    }
    $original = [Drawing.Image]::FromFile($inputPath)
    $canvas = [Drawing.Bitmap]::new(1800, 1500, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($canvas)
    try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $width = [int][Math]::Round($original.Width * 3.2)
        $height = [int][Math]::Round($original.Height * 3.2)
        $left = [int][Math]::Round((1800 - $width) / 2)
        $top = [int][Math]::Round(750 + $part.Y * 3.2 - $height / 2)
        $rect = [Drawing.Rectangle]::new($left, $top, $width, $height)
        $graphics.DrawImage($original, $rect)
        $outputPath = Join-Path $target ($part.Name + '.png')
        $canvas.Save($outputPath, [Drawing.Imaging.ImageFormat]::Png)
        Write-Output ($part.Name + '.png: 1800 x 1500, transparent RGBA')
    } finally {
        $graphics.Dispose(); $canvas.Dispose(); $original.Dispose()
    }
}
if (!(Test-Path -LiteralPath (Join-Path $target 'LICENSE'))) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ARTWORK-LICENSE') -Destination (Join-Path $target 'LICENSE')
}
