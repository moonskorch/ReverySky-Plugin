<#
.SYNOPSIS
Builds and validates the embedded-archive package wrapper from an existing root main.js.
#>
param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  node scripts/package-embedded-archive.mjs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  node scripts/check-embedded-archive-package.mjs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location
}
