$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$usage = @'
Usage: install.ps1 [--agent claude|codex|cursor|auto] [--skip-agents] [--dir <dir>] [--ref <ref>] [--uninstall]
  --agent        register the Blacksite skill with one agent (default: every agent found)
  --skip-agents  set up only the CLI, packages and templates; register the skill with no agent
                 (use this when the skill came from skills.sh)
'@
$agent = 'auto'
$agentSet = $false
$skipAgents = $false
$installDir = if ($env:BLACKSITE_INSTALL_DIR) { $env:BLACKSITE_INSTALL_DIR } else { Join-Path $HOME '.blacksite' }
$ref = 'main'
$uninstall = $false
for ($i = 0; $i -lt $args.Count; $i++) {
  switch ($args[$i]) {
    '--agent' { $i++; $agent = $args[$i]; $agentSet = $true }
    '--skip-agents' { $skipAgents = $true }
    { $_ -in @('-h', '--help') } { Write-Host $usage; return }
    '--dir' { $i++; $installDir = $args[$i] }
    '--ref' { $i++; $ref = $args[$i] }
    '--uninstall' { $uninstall = $true }
    '--yes' { }
    default { Write-Host $usage; throw "Unknown option: $($args[$i])" }
  }
}
foreach ($tool in @('node', 'git', 'pnpm')) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool, then rerun Blacksite setup." } }
if ($skipAgents -and $agentSet) { throw 'Choose --agent or --skip-agents, not both.' }
if (-not $agentSet -and (Test-Path (Join-Path $installDir '.git/blacksite-skip-agents'))) { $skipAgents = $true }
if ($skipAgents) { $agents = @() } elseif ($agent -eq 'auto') {
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
$skipMarker = Join-Path $installDir '.git/blacksite-skip-agents'
if ($skipAgents) { New-Item $skipMarker -ItemType File -Force | Out-Null } elseif (Test-Path $skipMarker) { Remove-Item $skipMarker -Force }
foreach ($selected in $agents) { & node (Join-Path $installDir 'cli/index.mjs') install --agent $selected --global --yes }
if (-not (Get-Command $cliName -ErrorAction SilentlyContinue)) { Write-Host "Add $binDir to your PATH." }
Write-Host 'Blacksite is ready.'
if ($skipAgents) { Write-Host 'No agent was changed: the skill is already installed through skills.sh. Ask your agent for a game.' }
foreach ($selected in $agents) {
  switch ($selected) {
    'claude' { Write-Host 'Claude Code: ask for a game, or run /blacksite:blacksite <your idea>.' }
    'codex' { Write-Host 'Codex: ask for a game; the skill is in ~/.agents/skills/blacksite.' }
    'cursor' { Write-Host 'Cursor: ask for a game; the skill is in ~/.cursor/skills/blacksite.' }
  }
}
Write-Host 'Optional asset libraries: blacksite assets login fab, then blacksite assets sync.'
