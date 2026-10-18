# Build static POI tiles for "Dokodemo Power Spot" from OpenStreetMap (Overpass API).
# Usage:  powershell -ExecutionPolicy Bypass -File tools\build_data.ps1 [-Only shrine,temple] [-SkipFetch]
# Output: docs\data\<genre>\<lat>_<lon>.tsv  (1 degree tiles, "lat<TAB>lon<TAB>name")
#         docs\data\index.json
# Data (c) OpenStreetMap contributors, ODbL.
param(
  [string[]]$Only = @(),
  [switch]$SkipFetch
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rawDir = Join-Path $PSScriptRoot 'raw'
$outDir = Join-Path $root 'docs\data'
New-Item -ItemType Directory -Force $rawDir, $outDir | Out-Null

# genre id -> Overpass statements (run inside area .jp)
$genres = [ordered]@{
  shrine     = 'nwr["amenity"="place_of_worship"]["religion"="shinto"]["name"](area.jp);'
  temple     = 'nwr["amenity"="place_of_worship"]["religion"="buddhist"]["name"](area.jp);'
  church     = 'nwr["amenity"="place_of_worship"]["religion"="christian"]["name"](area.jp);'
  castle     = 'nwr["historic"="castle"]["name"](area.jp);'
  kofun      = 'nwr["historic"="tomb"]["tomb"="tumulus"]["name"](area.jp);nwr["historic"="archaeological_site"]["site_type"="tumulus"]["name"](area.jp);'
  historic   = 'nwr["historic"~"^(archaeological_site|ruins|monument)$"]["name"](area.jp);'
  peak       = 'node["natural"~"^(peak|volcano)$"]["name"](area.jp);'
  waterfall  = 'nwr["waterway"="waterfall"]["name"](area.jp);'
  onsen      = 'nwr["amenity"="public_bath"]["name"](area.jp);nwr["natural"="hot_spring"]["name"](area.jp);'
  lighthouse = 'nwr["man_made"="lighthouse"]["name"](area.jp);'
  viewpoint  = 'nwr["tourism"="viewpoint"]["name"](area.jp);'
  park       = 'nwr["leisure"="park"]["name"](area.jp);'
  museum     = 'nwr["tourism"~"^(museum|gallery)$"]["name"](area.jp);'
  zoo        = 'nwr["tourism"~"^(zoo|aquarium)$"]["name"](area.jp);'
  themepark  = 'nwr["tourism"="theme_park"]["name"](area.jp);'
  michinoeki = 'nwr["highway"~"^(services|rest_area)$"]["name"~"道の駅"](area.jp);'
  station    = 'nwr["railway"="station"]["name"](area.jp);'
  conveni    = 'nwr["shop"="convenience"]["name"](area.jp);'
  cafe       = 'nwr["amenity"="cafe"]["name"](area.jp);'
  ramen      = 'nwr["amenity"="restaurant"]["cuisine"~"ramen"]["name"](area.jp);'
  fastfood   = 'nwr["amenity"="fast_food"]["name"](area.jp);'
  school     = 'nwr["amenity"="school"]["name"](area.jp);'
  university = 'nwr["amenity"~"^(university|college)$"]["name"](area.jp);'
  hospital   = 'nwr["amenity"="hospital"]["name"](area.jp);'
  postoffice = 'nwr["amenity"="post_office"]["name"](area.jp);'
  library    = 'nwr["amenity"="library"]["name"](area.jp);'
  townhall   = 'nwr["amenity"="townhall"]["name"](area.jp);'
}

$endpoints = @('https://overpass-api.de/api/interpreter')
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Fetch-Genre($id, $stmts) {
  $raw = Join-Path $rawDir "$id.tsv"
  $q = '[out:csv(::lat,::lon,name,"name:ja";false;"\t")][timeout:900];area["ISO3166-1"="JP"][admin_level=2]->.jp;(' + $stmts + ');out center;'
  $qFile = Join-Path $rawDir "$id.query"
  [System.IO.File]::WriteAllText($qFile, $q, $utf8)
  for ($try = 0; $try -lt 6; $try++) {
    $ep = $endpoints[$try % $endpoints.Count]
    Write-Host "[$id] fetch ($ep) try $($try + 1)"
    $code = & $curl -s -m 960 -A 'dokodemo-powerspot-databuild/1.0' --data-urlencode "data@$qFile" -o "$raw.part" -w '%{http_code}' $ep
    if ($code -eq '200') {
      $first = Get-Content "$raw.part" -TotalCount 1 -Encoding UTF8
      if ($first -notmatch '^<') { Move-Item -Force "$raw.part" $raw; return $true }
    }
    Write-Host "[$id] failed (HTTP $code), waiting..."
    Start-Sleep -Seconds (30 * ($try + 1))
  }
  Write-Host "[$id] could not fetch, skipped"; return $false
}

$index = [ordered]@{ built = (Get-Date -Format 'yyyy-MM-dd'); genres = [ordered]@{} }
$indexPath = Join-Path $outDir 'index.json'
if (Test-Path $indexPath) {
  $old = Get-Content $indexPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($p in $old.genres.PSObject.Properties) { $index.genres[$p.Name] = $p.Value }
}

$inv = [System.Globalization.CultureInfo]::InvariantCulture
foreach ($id in $genres.Keys) {
  if ($Only.Count -gt 0 -and $Only -notcontains $id) { continue }
  if (-not $SkipFetch -or -not (Test-Path (Join-Path $rawDir "$id.tsv"))) {
    if (-not (Fetch-Genre $id $genres[$id])) { continue }
  }

  # bucket into 1-degree tiles, dedupe by name + ~10m position
  $tiles = @{}
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $count = 0
  foreach ($line in [System.IO.File]::ReadLines((Join-Path $rawDir "$id.tsv"), $utf8)) {
    $f = $line.Split("`t")
    if ($f.Count -lt 3 -or $f[0] -eq '') { continue }
    $name = $f[2].Trim()
    if ($f.Count -ge 4 -and $f[3].Trim() -ne '') { $name = $f[3].Trim() }
    if ($name -eq '') { continue }
    $lat = [double]::Parse($f[0], $inv); $lon = [double]::Parse($f[1], $inv)
    $key = $name + '|' + [math]::Round($lat, 4) + '|' + [math]::Round($lon, 4)
    if (-not $seen.Add($key)) { continue }
    $tk = [string][math]::Floor($lat) + '_' + [string][math]::Floor($lon)
    if (-not $tiles.ContainsKey($tk)) { $tiles[$tk] = New-Object System.Text.StringBuilder }
    [void]$tiles[$tk].Append($lat.ToString('0.#####', $inv)).Append("`t").Append($lon.ToString('0.#####', $inv)).Append("`t").Append($name).Append("`n")
    $count++
  }
  $gDir = Join-Path $outDir $id
  if (Test-Path $gDir) { Remove-Item -Recurse -Force $gDir }
  New-Item -ItemType Directory -Force $gDir | Out-Null
  foreach ($tk in $tiles.Keys) { [System.IO.File]::WriteAllText((Join-Path $gDir "$tk.tsv"), $tiles[$tk].ToString(), $utf8) }
  $index.genres[$id] = [ordered]@{ count = $count; tiles = @($tiles.Keys | Sort-Object) }
  Write-Host "[$id] $count points in $($tiles.Count) tiles"
  [System.IO.File]::WriteAllText($indexPath, ($index | ConvertTo-Json -Depth 5 -Compress), $utf8)
  Start-Sleep -Seconds 5
}
& (Join-Path $PSScriptRoot 'build_search.ps1')
Write-Host 'done'
