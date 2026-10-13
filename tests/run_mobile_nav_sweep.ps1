<#
  Sweeps the mobile-navigation suite across the viewport widths where the
  navigation has actually broken.

  The dead band (901-1050px: hamburger visible, panel could never open) only
  appears at one width, so a single-width run cannot catch it. This re-runs
  tests\ui_mobile_nav_e2e.js at each width in turn and aggregates the result.

    powershell -NoProfile -ExecutionPolicy Bypass -File tests\run_mobile_nav_sweep.ps1
#>
param(
  [string]$BaseUrl = "http://127.0.0.1:8931/index.html",
  [int]$NavDelayMs = 4500
)

$ErrorActionPreference = "Continue"
# Re-launch the PowerShell that is running this script: "powershell" on
# Windows, "pwsh" on Linux CI (where a bare "powershell" does not exist).
$ps = (Get-Process -Id $PID).Path
# $PSScriptRoot is reliable under `powershell -File`; $MyInvocation.MyCommand.Path
# is not, and silently yields an empty path (which made the driver report
# "test file not found: " with a blank argument for every width).
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

# Call the .ps1 shim, not cdp_driver_runner.js directly. The shim forwards to
# node with LOWERCASE flags (-test-file, -url, ...) which is what the runner's
# case-sensitive process.argv lookup expects; calling the runner with -TestFile
# matches nothing and it reports "test file not found: " with a blank path.
$driver = Join-Path $here "cdp_driver.ps1"
$test = Join-Path $here "ui_mobile_nav_e2e.js"

if (-not (Test-Path $test)) { Write-Error "missing $test (here='$here')"; exit 1 }
if (-not (Test-Path $driver)) { Write-Error "missing $driver (here='$here')"; exit 1 }

# height 844 for phone/tablet rows; 667 for the short-viewport reachability row
$widths = @(
  @{ w = 320;  h = 667  },
  @{ w = 360;  h = 740  },
  @{ w = 375;  h = 667  },   # iPhone SE - the height that used to truncate the panel
  @{ w = 390;  h = 844  },
  @{ w = 480;  h = 800  },
  @{ w = 768;  h = 1024 },
  @{ w = 820;  h = 1180 },
  @{ w = 900;  h = 900  },
  @{ w = 940;  h = 900  },   # was inside the dead band
  @{ w = 1000; h = 900  },   # was inside the dead band
  @{ w = 1024; h = 900  },   # the collapse breakpoint itself
  @{ w = 1025; h = 900  },   # one pixel wider: must be the desktop nav again
  @{ w = 1200; h = 900  }
)

$results = @()
foreach ($row in $widths) {
  $size = "$($row.w),$($row.h)"
  $out = & $ps -NoProfile -ExecutionPolicy Bypass -File $driver -TestFile $test -Url ($BaseUrl + "#/home") -NavDelayMs $NavDelayMs -WindowSize $size -WaitShellStable 2>&1
  $json = $null
  try { $json = ($out -join "") | ConvertFrom-Json } catch { $json = $null }
  $pass = $json -and $json.ok
  $results += [pscustomobject]@{ Width = $row.w; Height = $row.h; Pass = [bool]$pass; Json = $json }
  $tag = if ($pass) { "PASS" } else { "FAIL" }
  Write-Host ("  {0,-4} {1,5}x{2,-5} {3}" -f $tag, $row.w, $row.h, $size)
  if (-not $pass -and $json -and $json.checks) {
    foreach ($c in @($json.checks | Where-Object { -not $_.ok })) {
      Write-Host ("        - {0}: {1}" -f $c.name, $c.detail)
    }
  }
}

$failed = @($results | Where-Object { -not $_.Pass })
Write-Host ""
if ($failed.Count) {
  Write-Host ("MOBILE NAV SWEEP FAILED: {0}/{1} widths" -f $failed.Count, $results.Count)
  exit 1
}
Write-Host ("MOBILE NAV SWEEP ALL GREEN ({0} widths)" -f $results.Count)
exit 0
