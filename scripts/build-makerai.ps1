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
}

Write-Host "Building a demo (AgentConsoleDemo)..." -ForegroundColor Cyan
$demo = Join-PathSafe @($makerAiRoot, "Demos", "052-AgentConsole", "AgentConsoleDemo.dpr")
if (!(Test-Path $demo)) { throw "Missing demo: $demo" }
& dcc64 -B -Q -CC "-E$binDir" "-NU$dcuDir" "-U$unitPath" "-I$unitPath" $demo

Write-Host "OK: outputs in $outRoot" -ForegroundColor Green

