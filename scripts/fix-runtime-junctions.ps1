$ErrorActionPreference = 'Stop'
$rt = 'C:\Users\25294\AppData\Local\DeepSeek Harness\runtime\node_modules'
$src = 'C:\Users\25294\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules'
$fixed = @()
$missing = @()
$skipScopes = @('@deepseek-ai')
$skipPaths = @(
  "$rt\@liustack",
  "$rt\@linxin666",
  "$rt\dsh-task-done-notify"
)

function Is-Broken($pkgDir) {
  return -not (Test-Path (Join-Path $pkgDir 'package.json'))
}

function Fix-One($pkgDir, $srcTarget) {
  if ($skipPaths -contains $pkgDir) { return }
  if (Is-Broken $pkgDir) {
    if (Test-Path (Join-Path $srcTarget 'package.json')) {
      Remove-Item $pkgDir -Recurse -Force
      New-Item -ItemType Junction -Path $pkgDir -Target $srcTarget -Force | Out-Null
      $fixed += $pkgDir.Substring($rt.Length + 1)
    } else {
      $missing += $pkgDir.Substring($rt.Length + 1)
    }
  }
}

$topDirs = @(Get-ChildItem $rt -Directory | Where-Object { $_.Name -ne '.bin' })
foreach ($d in $topDirs) {
  if ($d.Name.StartsWith('@')) {
    if ($skipScopes -contains $d.Name) { continue }
    $subDirs = @(Get-ChildItem $d.FullName -Directory -ErrorAction SilentlyContinue)
    foreach ($sub in $subDirs) {
      Fix-One $sub.FullName (Join-Path $src (Join-Path $d.Name $sub.Name))
    }
  } else {
    Fix-One $d.FullName (Join-Path $src $d.Name)
  }
}

Write-Output ("FIXED=" + $fixed.Count)
$fixed | Sort-Object | Out-String -Width 200
Write-Output ("STILL_MISSING=" + $missing.Count)
$missing | Sort-Object | Out-String -Width 200
