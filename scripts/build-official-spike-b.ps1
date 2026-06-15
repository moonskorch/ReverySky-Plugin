param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Push-Location $repoRoot
try {
  node scripts/build-official-spike-b.mjs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }

  node scripts/check-official-spike-b-release.mjs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
finally {
  Pop-Location
}
