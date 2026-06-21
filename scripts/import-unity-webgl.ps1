<#
.SYNOPSIS
Imports Unity WebGL build artifacts into plugin runtime folder `unity-webgl/`.

.DESCRIPTION
Copies files from a Unity WebGL export directory into repository `unity-webgl/` and
regenerates:
- `unity-webgl/Build/build-config.json`
- `unity-webgl/Build/build-config.js`
- `unity-webgl/index.html` from `unity-webgl/index.template.html`
based on detected build filenames.

Input folder is expected to contain at least:
- Build/*.loader.js
- Build/*.framework.js
- Build/*.data
- Build/*.wasm

TemplateData is optional and will be copied when present.

.PARAMETER ExportRoot
Path to Unity WebGL build output root (the folder that contains `Build/`).

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts/import-unity-webgl.ps1 -ExportRoot "C:\Temp\ReverySkyWebGLExport"
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$ExportRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Require-File([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Missing $Name at '$Path'."
  }
}

function Require-Dir([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Missing $Name at '$Path'."
  }
}

function Find-RequiredBuildFile([string]$Dir, [string[]]$Patterns) {
  foreach ($pattern in $Patterns) {
    $found = Get-ChildItem -LiteralPath $Dir -File -Filter $pattern | Select-Object -First 1
    if ($found) {
      return $found
    }
  }
  return $null
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$unityWebglRoot = Join-Path $repoRoot "unity-webgl"
$targetBuild = Join-Path $unityWebglRoot "Build"
$targetTemplateData = Join-Path $unityWebglRoot "TemplateData"
$indexTemplatePath = Join-Path $unityWebglRoot "index.template.html"
$indexOutputPath = Join-Path $unityWebglRoot "index.html"

$exportRootResolved = Resolve-Path $ExportRoot
$sourceBuild = Join-Path $exportRootResolved "Build"
$sourceTemplateData = Join-Path $exportRootResolved "TemplateData"

Require-Dir $unityWebglRoot "unity-webgl target directory"
Require-Dir $sourceBuild "Unity Build output directory"
Require-File $indexTemplatePath "unity-webgl/index.template.html"

Write-Host "Importing Unity WebGL artifacts..."
Write-Host "  Source: $exportRootResolved"
Write-Host "  Target: $unityWebglRoot"

if (Test-Path -LiteralPath $targetBuild) {
  Remove-Item -LiteralPath $targetBuild -Recurse -Force
}
New-Item -ItemType Directory -Path $targetBuild | Out-Null
Copy-Item -Path (Join-Path $sourceBuild "*") -Destination $targetBuild -Recurse -Force

if (Test-Path -LiteralPath $sourceTemplateData) {
  if (Test-Path -LiteralPath $targetTemplateData) {
    Remove-Item -LiteralPath $targetTemplateData -Recurse -Force
  }
  New-Item -ItemType Directory -Path $targetTemplateData | Out-Null
  Copy-Item -Path (Join-Path $sourceTemplateData "*") -Destination $targetTemplateData -Recurse -Force
}

$loaderFile = Find-RequiredBuildFile $targetBuild @("*.loader.js")
$frameworkFile = Find-RequiredBuildFile $targetBuild @("*.framework.js", "*.framework.js.gz", "*.framework.js.br", "*.framework.js.unityweb")
$dataFile = Find-RequiredBuildFile $targetBuild @("*.data", "*.data.gz", "*.data.br", "*.data.unityweb")
$codeFile = Find-RequiredBuildFile $targetBuild @("*.wasm", "*.wasm.gz", "*.wasm.br", "*.wasm.unityweb")

if (-not $loaderFile -or -not $frameworkFile -or -not $dataFile -or -not $codeFile) {
  throw "Could not auto-detect one or more required Unity files (*.loader.js, framework/data/wasm incl. .gz/.br/.unityweb) in '$targetBuild'."
}

$compressedExtPattern = "\.(gz|br|unityweb)$"
if ($frameworkFile.Name -match $compressedExtPattern -or $dataFile.Name -match $compressedExtPattern -or $codeFile.Name -match $compressedExtPattern) {
  Write-Warning "Compressed WebGL artifacts detected (.gz/.br/.unityweb). In Obsidian local iframe runtime this often falls back instead of Unity. Recommended: rebuild Unity with Compression Format = Disabled."
}

# Create neutral alias filenames to reduce false positives from client-side blockers.
# These runtime-* files are the compact runtime input used by embedded-archive packaging.
# The original Unity export files may remain in Build/ for local staging, but embedded-archive
# only needs build-config.json plus runtime-entry/core/data/code.
$loaderAliasName = "runtime-entry.js"
$frameworkAliasName = "runtime-core.js"
$dataAliasName = "runtime-data" + [System.IO.Path]::GetExtension($dataFile.Name)
$codeAliasName = "runtime-code" + [System.IO.Path]::GetExtension($codeFile.Name)

Copy-Item -LiteralPath $loaderFile.FullName -Destination (Join-Path $targetBuild $loaderAliasName) -Force
Copy-Item -LiteralPath $frameworkFile.FullName -Destination (Join-Path $targetBuild $frameworkAliasName) -Force
Copy-Item -LiteralPath $dataFile.FullName -Destination (Join-Path $targetBuild $dataAliasName) -Force
Copy-Item -LiteralPath $codeFile.FullName -Destination (Join-Path $targetBuild $codeAliasName) -Force

$config = [ordered]@{
  loaderFile = $loaderAliasName
  dataFile = $dataAliasName
  frameworkFile = $frameworkAliasName
  codeFile = $codeAliasName
  streamingAssetsUrl = "StreamingAssets"
  companyName = "MoonSkorch Studio"
  productName = "ReverySky Map"
  productVersion = "0.0.1"
}

$configPath = Join-Path $targetBuild "build-config.json"
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$configJsPath = Join-Path $targetBuild "build-config.js"
$configJsContent = "window.__UNITY_BUILD_CONFIG__ = " + ($config | ConvertTo-Json -Compress) + ";"
Set-Content -LiteralPath $configJsPath -Value $configJsContent -Encoding UTF8

$indexContent = Get-Content -LiteralPath $indexTemplatePath -Raw
$embeddedJson = $config | ConvertTo-Json -Compress
$markerPattern = '(?s)(<script id="unity-build-config" type="application/json">\s*)(.*?)(\s*</script>)'
if ($indexContent -match $markerPattern) {
  $updatedIndex = [regex]::Replace($indexContent, $markerPattern, ('$1' + $embeddedJson + '$3'))

  $loaderBytes = [System.IO.File]::ReadAllBytes((Join-Path $targetBuild $loaderAliasName))
  $frameworkBytes = [System.IO.File]::ReadAllBytes((Join-Path $targetBuild $frameworkAliasName))
  $dataBytes = [System.IO.File]::ReadAllBytes((Join-Path $targetBuild $dataAliasName))
  $codeBytes = [System.IO.File]::ReadAllBytes((Join-Path $targetBuild $codeAliasName))
  $loaderBase64 = [System.Convert]::ToBase64String($loaderBytes)
  $frameworkBase64 = [System.Convert]::ToBase64String($frameworkBytes)
  $dataBase64 = [System.Convert]::ToBase64String($dataBytes)
  $codeBase64 = [System.Convert]::ToBase64String($codeBytes)

  $loaderMarkerPattern = '(?s)(<script id="unity-loader-source" type="application/octet-stream">\s*)(.*?)(\s*</script>)'
  $frameworkMarkerPattern = '(?s)(<script id="unity-framework-source" type="application/octet-stream">\s*)(.*?)(\s*</script>)'
  $dataMarkerPattern = '(?s)(<script id="unity-data-source" type="application/octet-stream">\s*)(.*?)(\s*</script>)'
  $codeMarkerPattern = '(?s)(<script id="unity-code-source" type="application/octet-stream">\s*)(.*?)(\s*</script>)'
  $updatedIndex = [regex]::Replace($updatedIndex, $loaderMarkerPattern, ('$1' + $loaderBase64 + '$3'))
  $updatedIndex = [regex]::Replace($updatedIndex, $frameworkMarkerPattern, ('$1' + $frameworkBase64 + '$3'))
  $updatedIndex = [regex]::Replace($updatedIndex, $dataMarkerPattern, ('$1' + $dataBase64 + '$3'))
  $updatedIndex = [regex]::Replace($updatedIndex, $codeMarkerPattern, ('$1' + $codeBase64 + '$3'))

  Set-Content -LiteralPath $indexOutputPath -Value $updatedIndex -Encoding UTF8
} else {
  Write-Warning "Could not find embedded config marker in unity-webgl/index.template.html. Embedded config was not updated."
}

Write-Host "Done."
Write-Host "  build-config.json: $configPath"
Write-Host "  build-config.js: $configJsPath"
Write-Host "  generated index: $indexOutputPath"
Write-Host "  loader: $($loaderFile.Name) -> $loaderAliasName"
Write-Host "  data: $($dataFile.Name) -> $dataAliasName"
Write-Host "  framework: $($frameworkFile.Name) -> $frameworkAliasName"
Write-Host "  wasm: $($codeFile.Name) -> $codeAliasName"
