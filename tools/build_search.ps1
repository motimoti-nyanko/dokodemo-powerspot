# Build docs\data\search.tsv ("lat<TAB>lon<TAB>genre<TAB>name") from the genre tiles, for local place-name search.
$ErrorActionPreference = 'Stop'
$dataDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'docs\data'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$genres = 'station', 'townhall', 'castle', 'themepark', 'zoo', 'university', 'museum', 'michinoeki', 'lighthouse', 'waterfall', 'onsen'
$sb = New-Object System.Text.StringBuilder
$seen = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($g in $genres) {
  $dir = Join-Path $dataDir $g
  if (-not (Test-Path $dir)) { continue }
  foreach ($f in Get-ChildItem $dir -Filter *.tsv) {
    foreach ($line in [IO.File]::ReadLines($f.FullName, $utf8)) {
      $p = $line.Split("`t")
      if ($p.Count -ne 3) { continue }
      # same-name stations of different lines sit within a few hundred meters: keep one
      $key = $p[2] + '|' + [math]::Round([double]$p[0], 2) + '|' + [math]::Round([double]$p[1], 2)
      if (-not $seen.Add($key)) { continue }
      [void]$sb.Append($p[0]).Append("`t").Append($p[1]).Append("`t").Append($g).Append("`t").Append($p[2]).Append("`n")
    }
  }
}
[IO.File]::WriteAllText((Join-Path $dataDir 'search.tsv'), $sb.ToString(), $utf8)
Write-Host "search.tsv: $($seen.Count) entries"
