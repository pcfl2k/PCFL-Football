<#
.SYNOPSIS
  PCFL one-click weekly publisher.
  Validates an FBPro98 export folder, drops it into the repo, rebuilds the
  data layer locally, commits and pushes. GitHub Actions then redeploys the
  site automatically.

.EXAMPLE
  .\Publish-PCFLWeek.ps1 -Folder "C:\FBPro98\exports\reports-wk3" -Season 2028 -Week 3
  .\Publish-PCFLWeek.ps1            # interactive: prompts with a folder picker
  .\Publish-PCFLWeek.ps1 -RosterFile "C:\FBPro98\exports\rosters.html"   # roster-only refresh
                                     # -> drops/<season>/rosters/rosters.html (season read from the report)
#>
[CmdletBinding()]
param(
  [string]$Folder,
  [int]$Season,
  [int]$Week,
  [string]$RosterFile,
  [string]$RepoPath = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'
function Step($msg){ Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg){ Write-Host "    $msg" -ForegroundColor Green }
function Fail($msg){ Write-Host "!!  $msg" -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- roster-only refresh
# Same as the PCFL Updater's ROSTER ONLY mode: the parser always uses the newest roster
# report for a season (by the report's own date line), so this updates every roster view.
if ($RosterFile) {
  if (-not (Test-Path $RosterFile)) { Fail "Roster file not found: $RosterFile" }
  $raw = Get-Content $RosterFile -Raw
  if ($raw -notmatch 'Team Roster:') { Fail 'Not an FBPro98 roster report (no "Team Roster:" sections).' }
  $head = ((Get-Content $RosterFile -TotalCount 14) -join "`n") -replace '<[^>]*>', ''
  if (-not $Season) {
    if ($head -match '(\d{4})\s+season') { $Season = [int]$Matches[1] } else { Fail 'Could not infer season - pass -Season explicitly.' }
  }
  $asOf = if ($head -match '([A-Z][a-z]+ \d{1,2}, \d{4})') { $Matches[1] } else { 'undated' }
  $dest = Join-Path $RepoPath "drops\$Season\rosters"
  Step "Copying roster report ($asOf) to $dest\rosters.html"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Copy-Item $RosterFile (Join-Path $dest 'rosters.html') -Force
  Push-Location $RepoPath
  try {
    if (Get-Command node -ErrorAction SilentlyContinue) {
      node scripts/parse-fbpro.mjs
      if ($LASTEXITCODE -ne 0) { Fail 'Parser failed - fix the export and retry.' }
    }
    git add drops data
    git diff --cached --quiet
    if ($LASTEXITCODE -eq 0) { Write-Host '    Nothing new to commit.' -ForegroundColor Yellow }
    else {
      git commit -m "rosters: $Season season - FBPro98 roster report as of $asOf"
      if ($env:PCFL_PAT) {
        $remote = (git remote get-url origin) -replace '^https://(.+@)?', "https://$env:PCFL_PAT@"
        git push $remote HEAD:main
      } else { git push origin main }
      if ($LASTEXITCODE -ne 0) { Fail 'git push failed - check credentials (set $env:PCFL_PAT or configure git).' }
      Ok 'Pushed. GitHub Actions is rebuilding the rosters now.'
    }
  } finally { Pop-Location }
  exit 0
}

# ---------------------------------------------------------------- folder
if (-not $Folder) {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  $dlg.Description = 'Select the FBPro98 weekly export folder (gamestats.html, standings.html, ...)'
  if ($dlg.ShowDialog() -ne 'OK') { Fail 'No folder selected.' }
  $Folder = $dlg.SelectedPath
}
if (-not (Test-Path $Folder)) { Fail "Folder not found: $Folder" }

# ---------------------------------------------------------------- validate
Step "Validating export files in $Folder"
$required = 'gamestats.html','standings.html','schedule.html','season.html'
$optional = 'rosters.html','teamstats.html'
foreach ($f in $required) {
  if (-not (Test-Path (Join-Path $Folder $f))) { Fail "Missing required file: $f" }
}
Ok "All required files present."
foreach ($f in $optional) {
  if (-not (Test-Path (Join-Path $Folder $f))) { Write-Host "    (optional $f not found - skipping)" -ForegroundColor Yellow }
}

# ---------------------------------------------------------------- infer season/week
$title = (Get-Content (Join-Path $Folder 'gamestats.html') -TotalCount 5) -join ' '
if (-not $Season) {
  if ($title -match '(\d{4}) season') { $Season = [int]$Matches[1] }
  else { Fail 'Could not infer season - pass -Season explicitly.' }
}
if (-not $Week) {
  if ($title -match 'Week (\d+)') { $Week = [int]$Matches[1] }
  else { Fail 'Could not infer week - pass -Week explicitly.' }
}
Ok "Season $Season, Week $Week"

# ---------------------------------------------------------------- copy into drops
$dest = Join-Path $RepoPath "drops\$Season\week$Week"
Step "Copying export to $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item (Join-Path $Folder '*.html') $dest -Force
Ok 'Copied.'

# ---------------------------------------------------------------- rebuild data locally (validation)
Step 'Rebuilding data layer (node scripts/parse-fbpro.mjs)'
Push-Location $RepoPath
try {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    node scripts/parse-fbpro.mjs
    if ($LASTEXITCODE -ne 0) { Fail 'Parser failed - fix the export and retry.' }
    Ok 'Data layer rebuilt and validated.'
  } else {
    Write-Host '    node not found locally - GitHub Actions will parse on push.' -ForegroundColor Yellow
  }

  # -------------------------------------------------------------- commit & push
  Step 'Committing and pushing'
  git add drops data
  git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { Write-Host '    Nothing new to commit.' -ForegroundColor Yellow }
  else {
    git commit -m "week $Week, $Season season: weekly FBPro98 drop"
    if ($env:PCFL_PAT) {
      $remote = (git remote get-url origin) -replace '^https://(.+@)?', "https://$env:PCFL_PAT@"
      git push $remote HEAD:main
    } else {
      git push origin main
    }
    if ($LASTEXITCODE -ne 0) { Fail 'git push failed - check credentials (set $env:PCFL_PAT or configure git).' }
    Ok 'Pushed. GitHub Actions is rebuilding and deploying the site now.'
    Ok 'Live in ~60s: https://pcfl2k.github.io/PCFL-Football/'
  }
}
finally { Pop-Location }
