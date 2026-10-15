$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$agent = 'auto'
$installDir = if ($env:BLACKSITE_INSTALL_DIR) { $env:BLACKSITE_INSTALL_DIR } else { Join-Path $HOME '.blacksite' }
$ref = 'main'
$uninstall = $false
for ($i = 0; $i -lt $args.Count; $i++) {
  switch ($args[$i]) {
    '--agent' { $i++; $agent = $args[$i] }
    '--dir' { $i++; $installDir = $args[$i] }
    '--ref' { $i++; $ref = $args[$i] }
    '--uninstall' { $uninstall = $true }
    '--yes' { }
    default { throw "Unknown option: $($args[$i])" }
  }
}
foreach ($tool in @('node', 'git', 'pnpm')) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool, then rerun Blacksite setup." } }
if ($agent -eq 'auto') {
  $agents = @('claude', 'codex', 'cursor') | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue }
  if ($agents.Count -eq 0) { $agents = @('codex') }
} elseif ($agent -in @('claude', 'codex', 'cursor')) { $agents = @($agent) } else { throw 'Choose --agent claude|codex|cursor|auto' }
$binDir = Join-Path $HOME '.local/bin'
$cliName = if (Test-Path (Join-Path $installDir 'product.json')) { (Get-Content (Join-Path $installDir 'product.json') -Raw | ConvertFrom-Json).cli } else { 'blacksite' }
$launcher = Join-Path $binDir "$cliName.cmd"
if ($uninstall) {
  if (Test-Path (Join-Path $installDir 'cli/index.mjs')) { foreach ($selected in $agents) { & node (Join-Path $installDir 'cli/index.mjs') install --agent $selected --global --uninstall --yes } }
  if (Test-Path $launcher) { Remove-Item $launcher -Force }
  if (Test-Path (Join-Path $installDir '.git/blacksite-installed')) { Remove-Item $installDir -Recurse -Force }
  Write-Host 'Blacksite setup removed.'
  exit 0
}
$source = if ($env:BLACKSITE_SOURCE) { $env:BLACKSITE_SOURCE } else { 'https://github.com/btn0s/blacksite.git' }
if (Test-Path (Join-Path $installDir '.git')) {
  $dirty = & git -C $installDir status --porcelain
  if ($dirty) { throw "Blacksite checkout has local edits: $installDir" }
  & git -C $installDir fetch --depth 1 origin $ref
  & git -C $installDir checkout --detach FETCH_HEAD
  & git -C $installDir submodule update --init --recursive
} elseif (Test-Path $installDir) { throw "Install directory exists and is not a Git checkout: $installDir" } else {
  & git clone --recursive --depth 1 $source $installDir
  New-Item (Join-Path $installDir '.git/blacksite-installed') -ItemType File -Force | Out-Null
  if ($ref -ne 'main') {
    & git -C $installDir fetch --depth 1 origin $ref
    & git -C $installDir checkout --detach FETCH_HEAD
    & git -C $installDir submodule update --init --recursive
  }
}
$cliName = (Get-Content (Join-Path $installDir 'product.json') -Raw | ConvertFrom-Json).cli
$launcher = Join-Path $binDir "$cliName.cmd"
Push-Location $installDir; try { & pnpm install --frozen-lockfile } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'Blacksite dependency installation failed.' }
New-Item $binDir -ItemType Directory -Force | Out-Null
Set-Content -Path $launcher -Value "@echo off`r`nnode `"$installDir\cli\index.mjs`" %*`r`n"
foreach ($selected in $agents) { & node (Join-Path $installDir 'cli/index.mjs') install --agent $selected --global --yes }
if (-not (Get-Command $cliName -ErrorAction SilentlyContinue)) { Write-Host "Add $binDir to your PATH." }
Write-Host 'Blacksite is ready. Ask your agent anything or run /blacksite:start; it will ask "What would you like to do?"'
Write-Host 'Optional asset libraries: blacksite assets login fab, then blacksite assets sync.'
