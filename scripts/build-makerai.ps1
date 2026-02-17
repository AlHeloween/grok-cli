$ErrorActionPreference = "Stop"

function Join-PathSafe {
  param([string[]]$Parts)
  $p = $Parts[0]
  for ($i = 1; $i -lt $Parts.Length; $i++) { $p = Join-Path $p $Parts[$i] }
  return $p
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$makerAiRoot = Join-Path $repoRoot "MakerAI"
if (!(Test-Path $makerAiRoot)) {
  throw "MakerAI folder not found at: $makerAiRoot"
}

if (!(Get-Command dcc64 -ErrorAction SilentlyContinue)) {
  throw "dcc64 not found in PATH."
}

$outRoot = Join-PathSafe @($makerAiRoot, "_build", "win64")
$binDir = Join-Path $outRoot "bin"
$dcuDir = Join-Path $outRoot "dcu"
$bplDir = Join-Path $outRoot "bpl"
$dcpDir = Join-Path $outRoot "dcp"

New-Item -ItemType Directory -Force -Path $binDir, $dcuDir, $bplDir, $dcpDir | Out-Null

$srcDirs = @(
  "Agents",
  "Chat",
  "ChatUI",
  "Core",
  "Design",
  "MCPClient",
  "MCPServer",
  "Packages",
  "RAG",
  "Resources",
  "Tools",
  "Utils"
) | ForEach-Object { Join-PathSafe @($makerAiRoot, "Source", $_) }

$unitPath = ($srcDirs -join ";")

Write-Host "Building MakerAI runtime packages..." -ForegroundColor Cyan

$packages = @(
  (Join-PathSafe @($makerAiRoot, "Source", "Packages", "MakerAI.dpk")),
  (Join-PathSafe @($makerAiRoot, "Source", "Packages", "MakerAi.RAG.Drivers.dpk")),
  (Join-PathSafe @($makerAiRoot, "Source", "Packages", "MakerAi.UI.dpk"))
)

foreach ($pkg in $packages) {
  if (!(Test-Path $pkg)) { throw "Missing package: $pkg" }
  Write-Host "dcc64 $pkg" -ForegroundColor Gray
  & dcc64 -B -Q "-E$binDir" "-NU$dcuDir" "-LE$bplDir" "-LN$dcpDir" "-U$unitPath" "-I$unitPath" $pkg
  if ($LASTEXITCODE -ne 0) { throw "dcc64 failed building package: $pkg (exit=$LASTEXITCODE)" }
}

Write-Host "Building a demo (AgentConsoleDemo)..." -ForegroundColor Cyan
$demo = Join-PathSafe @($makerAiRoot, "Demos", "052-AgentConsole", "AgentConsoleDemo.dpr")
if (!(Test-Path $demo)) { throw "Missing demo: $demo" }
& dcc64 -B -Q -CC "-E$binDir" "-NU$dcuDir" "-U$unitPath" "-I$unitPath" $demo
if ($LASTEXITCODE -ne 0) { throw "dcc64 failed building demo: $demo (exit=$LASTEXITCODE)" }

Write-Host "Building RagManager GUI..." -ForegroundColor Cyan
$ragManager = Join-PathSafe @($makerAiRoot, "Integration", "RagManager", "RagManager.dpr")
if (!(Test-Path $ragManager)) { throw "Missing RagManager: $ragManager" }
& dcc64 -B -Q -CG "-E$binDir" "-NU$dcuDir" "-U$unitPath" "-I$unitPath" $ragManager
if ($LASTEXITCODE -ne 0) { throw "dcc64 failed building RagManager: $ragManager (exit=$LASTEXITCODE)" }

Write-Host "Building RagManagerTests (DUnitX)..." -ForegroundColor Cyan
$ragTests = Join-PathSafe @($makerAiRoot, "Integration", "Tests", "RagManagerTests.dpr")
if (!(Test-Path $ragTests)) { throw "Missing RagManagerTests: $ragTests" }
& dcc64 -B -Q -CC "-E$binDir" "-NU$dcuDir" "-U$unitPath" "-I$unitPath" $ragTests
if ($LASTEXITCODE -ne 0) { throw "dcc64 failed building RagManagerTests: $ragTests (exit=$LASTEXITCODE)" }

Write-Host "Running RagManagerTests..." -ForegroundColor Cyan
& (Join-Path $binDir "RagManagerTests.exe")
if ($LASTEXITCODE -ne 0) { throw "RagManagerTests failed (exit=$LASTEXITCODE)" }

Write-Host "OK: outputs in $outRoot" -ForegroundColor Green
