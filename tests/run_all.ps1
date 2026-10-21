param(
    [string]$Test = "",          # run one test by name (without .js), e.g. -Test crm_core_e2e
    [string]$BaseUrl = "http://127.0.0.1:8931/index.html",
    [int]$NavDelayMs = 4500,
    [string]$WindowSize = "1400,900",
    [switch]$Mobile,             # shorthand for -WindowSize "390,844"
    [switch]$ReducedMotion,      # run the browser tests with prefers-reduced-motion: reduce
    [switch]$Touch               # run the browser tests as a touch phone (coarse pointer, no hover)
)

# SEA ESTATES regression runner (Chrome DevTools Protocol, headless Chrome)
# Requires: Chrome installed; local server running on :8931 (start_esrealty.cmd)
# Usage:
#   powershell -File tests\run_all.ps1              # run every *_e2e.js
#   powershell -File tests\run_all.ps1 -Test appraisal_b2_e2e
#   powershell -File tests\run_all.ps1 -Mobile      # mobile viewport pass
#   powershell -File tests\run_all.ps1 -Test services_funnel_e2e -ReducedMotion
#   powershell -File tests\run_all.ps1 -Test services_funnel_e2e -Mobile -Touch

$ErrorActionPreference = "Continue"
# Re-launch the PowerShell that is running this script: "powershell" on
# Windows, "pwsh" on Linux CI (where a bare "powershell" does not exist).
$ps = (Get-Process -Id $PID).Path

# Always use the driver committed in this repo. The previous version preferred
# %TEMP%\opencode\cdp_driver.ps1 when it existed, which let a stray file on a
# developer machine silently replace the harness under test.
$driver = Join-Path $PSScriptRoot "cdp_driver.ps1"
if (-not (Test-Path $driver)) { Write-Error "cdp_driver.ps1 not found"; exit 1 }

if ($Mobile) { $WindowSize = "390,844" }

# Precondition: stores_freshness_e2e asserts the local worker's cache contract
# (cached/refreshed/stale), which the production Vercel adapter intentionally
# omits. Warn once rather than letting that test fail for an unrelated reason.
if (-not $Test -or $Test -like "*store*") {
    try { $ms = Invoke-RestMethod "http://127.0.0.1:8932/api/ping" -TimeoutSec 2
          if ($ms.ok -ne $true) { Write-Host "WARNING: market-scan worker on :8932 is not ready; stores_* e2e will fail." -ForegroundColor Yellow } }
    catch { Write-Host "WARNING: market-scan worker not running on :8932 (start_esrealty.cmd). stores_* e2e will fail." -ForegroundColor Yellow }
}

$browser = @()
$node = @()
if ($Test) {
    if ($Test -match '_node$') {
        $node = @($Test)
        $probe = Join-Path $PSScriptRoot "$Test.js"
        if (-not (Test-Path $probe)) { Write-Error "Test not found: $probe"; exit 1 }
    } else {
        $browser = @($Test)
        $probe = Join-Path $PSScriptRoot "$Test.js"
        if (-not (Test-Path $probe)) { Write-Error "Test not found: $probe"; exit 1 }
    }
} else {
    $browser = Get-ChildItem $PSScriptRoot -Filter "*_e2e.js" | Sort-Object Name | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) }
    $node = Get-ChildItem $PSScriptRoot -Filter "*_node.js" | Sort-Object Name | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) }
}

$results = @()
# Tests that keep LIVE node references across the storefront's two-phase render
# (boot shell, then the featured-listings response) need the driver to wait for
# the shell to settle first. Without it the header node the test captured is
# replaced mid-run and reports a bogus layout failure - a 0x0 header, a hamburger
# that does not rotate, a panel that will not open. Only the mobile-nav test
# measures those nodes, so only it opts in; holding every other test (back-office,
# maps, market-scan) for a storefront re-render only manufactured timeouts.
$shellStableTests = @("ui_mobile_nav_e2e")
foreach ($name in $browser) {
    $t = Join-Path $PSScriptRoot "$name.js"
    Write-Host "== $name ==" -ForegroundColor Cyan
    $waitFlag = if ($shellStableTests -contains $name) { "-WaitShellStable" } else { "" }
    $emulation = @()
    if ($ReducedMotion) { $emulation += "-ReducedMotion" }
    if ($Touch) { $emulation += "-Touch" }
    $out = & $ps -NoProfile -ExecutionPolicy Bypass -File $driver -TestFile $t -Url $BaseUrl -NavDelayMs $NavDelayMs -WindowSize $WindowSize $waitFlag @emulation 2>&1
    try { $json = ($out -join "") | ConvertFrom-Json } catch { $json = $null }
    $pass = $json -and $json.ok
    $results += [pscustomobject]@{ Test = $name; Pass = [bool]$pass }
    if ($json -and $json.checks) {
        foreach ($c in $json.checks) {
            $mark = if ($c.ok) { "PASS" } else { "FAIL" }
            $color = if ($c.ok) { "Green" } else { "Red" }
            Write-Host ("  [{0}] {1} {2}" -f $mark, $c.name, $c.detail) -ForegroundColor $color
            # On CI a failing suite otherwise only says the suite name; the
            # individual check that broke is what identifies the bug, and it is
            # already being printed, so surface it as an annotation too.
            if (-not $c.ok) {
                $msg = "{0} :: {1} ({2})" -f $name, $c.name, $c.detail
                Write-Host "::error::$msg"
                if ($env:GITHUB_STEP_SUMMARY) {
                    Add-Content -Path $env:GITHUB_STEP_SUMMARY -Value ("- [{0}]({1}) **{2}** - {3}" -f $name, "https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID", $c.name, $c.detail)
                }
            }
        }
    } elseif (-not $pass) {
        Write-Host ($out | Select-Object -First 5) -ForegroundColor Yellow
    }
}
foreach ($name in $node) {
    $t = Join-Path $PSScriptRoot "$name.js"
    Write-Host "== $name ==" -ForegroundColor Cyan
    $out = & node $t 2>&1
    $pass = $LASTEXITCODE -eq 0
    $results += [pscustomobject]@{ Test = $name; Pass = [bool]$pass }
    foreach ($line in @($out)) {
        $s = [string]$line
        if ($s -match '^\s*\[(PASS|FAIL)\]') {
            $mark = $Matches[1]
            $color = if ($mark -eq "PASS") { "Green" } else { "Red" }
            Write-Host ("  [{0}] {1}" -f $mark, ($s -replace '^(\s*\[(PASS|FAIL)\]\s*)', '')) -ForegroundColor $color
        }
    }
    $sum = @($out) | Where-Object { $_ -match 'GREEN|FAILED' } | Select-Object -Last 1
    Write-Host $sum
}

Write-Host ""
Write-Host "==== SUMMARY ====" -ForegroundColor White
$failed = $results | Where-Object { -not $_.Pass }
$results | ForEach-Object { $m = if ($_.Pass) { "PASS" } else { "FAIL" }; $col = if ($_.Pass) { "Green" } else { "Red" }; Write-Host ("[{0}] {1}" -f $m, $_.Test) -ForegroundColor $col }
if ($failed.Count -eq 0) { Write-Host "ALL GREEN ($($results.Count) tests)" -ForegroundColor Green; exit 0 }
else { Write-Host "$($failed.Count)/$($results.Count) FAILED" -ForegroundColor Red; exit 1 }
