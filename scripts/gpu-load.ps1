param([int]$Root = 0, [int]$Seconds = 5)

$own = @{}
if ($Root) {
  $own[$Root] = $true
  $processes = Get-CimInstance Win32_Process
  do {
    $added = $false
    foreach ($process in $processes) {
      if ($own.ContainsKey([int]$process.ParentProcessId) -and -not $own.ContainsKey([int]$process.ProcessId)) {
        $own[[int]$process.ProcessId] = $true
        $added = $true
      }
    }
  } while ($added)
}

$byProcess = @{}
$totals = @()
foreach ($set in Get-Counter '\GPU Engine(*)\Utilization Percentage' -SampleInterval 1 -MaxSamples $Seconds) {
  $total = 0.0
  foreach ($sample in $set.CounterSamples) {
    if ($sample.Path -notmatch 'pid_(\d+)_.*engtype_(3D|Compute|Graphics)') { continue }
    $id = [int]$Matches[1]
    if ($own.ContainsKey($id)) { continue }
    $total += $sample.CookedValue
    $byProcess[$id] += $sample.CookedValue
  }
  $totals += $total
}

$top = @($byProcess.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 3 | ForEach-Object {
  [pscustomobject]@{ pid = $_.Key; name = (Get-Process -Id $_.Key -ErrorAction SilentlyContinue).ProcessName; mean = [math]::Round($_.Value / $totals.Count, 2) }
})
$measure = $totals | Measure-Object -Average -Maximum
[pscustomobject]@{ seconds = $totals.Count; mean = [math]::Round($measure.Average, 2); max = [math]::Round($measure.Maximum, 2); top = $top } | ConvertTo-Json -Compress -Depth 4
