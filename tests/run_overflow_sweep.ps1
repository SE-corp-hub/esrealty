<#
  Sweeps tests\ui_no_overflow_e2e.js across the viewport widths where the public
  storefront has actually overflowed horizontally.

  Both defects this catches were 320px-only: the contact form's
  .sf-reveal-right resting offset pushed it to x=75 in a 320px viewport, and the
  results bar's inner flex group ran to x=359. Because .sf-site clips
  overflow-x, neither produced a scrollbar - the content was just cut off, and a
  single-width run at 1280px sees a perfectly healthy page.

    powershell -NoProfile -ExecutionPolicy Bypass -File tests\run_overflow_sweep.ps1
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
# is not, and silently yields an empty path.
$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

# Call the .ps1 shim, not cdp_driver_runner.js directly: the shim forwards to
# node with LOWERCASE flags, which is what the runner's case-sensitive argv
# lookup expects.
$driver = Join-Path $here "cdp_driver.ps1"
$test = Join-Path $here "ui_no_overflow_e2e.js"

if (-not (Test-Path $test)) { Write-Error "missing $test (here='$here')"; exit 1 }
if (-not (Test-Path $driver)) { Write-Error "missing $driver (here='$here')"; exit 1 }

# 320 is where both overflow defects reproduced. 360/390 are common phones.
# 600/601 and 900/901 straddle the Search filter's one/two/five-column
# breakpoints, 768 samples tablet layout, 1024 the nav collapse breakpoint,
# and 1280 the desktop baseline.
$widths = @(
  @{ w = 320;  h = 667  },
  @{ w = 360;  h = 740  },
  @{ w = 390;  h = 844  },
  @{ w = 600;  h = 900  },
  @{ w = 601;  h = 900  },
  @{ w = 768;  h = 1024 },
  @{ w = 900;  h = 900  },
  @{ w = 901;  h = 900  },
  @{ w = 1024; h = 800  },
  @{ w = 1280; h = 900  }
)

$results = @()
foreach ($row in $widths) {
  $size = "$($row.w),$($row.h)"
  $out = & $ps -NoProfile -ExecutionPolicy Bypass -File $driver -TestFile $test -Url ($BaseUrl + "#/home") -NavDelayMs $NavDelayMs -WindowSize $size 2>&1
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

$bad = @($results | Where-Object { -not $_.Pass })
if ($bad.Count) {
  Write-Host ""
  Write-Host ("OVERFLOW SWEEP FAILED: {0}/{1} widths" -f $bad.Count, $results.Count)
  exit 1
}
Write-Host ""
Write-Host ("OVERFLOW SWEEP ALL GREEN ({0} widths)" -f $results.Count)
exit 0
