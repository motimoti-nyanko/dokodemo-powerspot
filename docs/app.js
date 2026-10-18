'use strict';
/* どこでもパワースポット — すべての計算はブラウザ内で完結する */

// ---------------- 定義 ----------------
const GENRE_GROUPS = [
  ['祈りの場', [['shrine', '神社', '⛩️'], ['temple', 'お寺', '🪷'], ['church', '教会', '⛪']]],
  ['歴史', [['castle', '城・城跡', '🏯'], ['kofun', '古墳', '🏺'], ['historic', '史跡', '🏛️']]],
  ['自然・景色', [['peak', '山', '⛰️'], ['waterfall', '滝', '💧'], ['onsen', '温泉・銭湯', '♨️'],
    ['viewpoint', '展望スポット', '🔭'], ['lighthouse', '灯台', '🔦'], ['park', '公園', '🌳']]],
  ['おでかけ', [['museum', '博物館・美術館', '🖼️'], ['zoo', '動物園・水族館', '🐧'], ['themepark', 'テーマパーク', '🎢'],
    ['michinoeki', '道の駅', '🚗'], ['station', '駅', '🚉']]],
  ['まちなか', [['conveni', 'コンビニ', '🏪'], ['cafe', 'カフェ', '☕'], ['ramen', 'ラーメン', '🍜'], ['fastfood', 'ファストフード', '🍔']]],
  ['公共施設', [['school', '学校', '🏫'], ['university', '大学', '🎓'], ['hospital', '病院', '🏥'],
    ['postoffice', '郵便局', '📮'], ['library', '図書館', '📚'], ['townhall', '役所', '🏢']]],
];
const GENRE = {};
GENRE_GROUPS.forEach(([, items]) => items.forEach(([id, label, em]) => { GENRE[id] = { id, label, em }; }));

// n 個の頂点を step 飛ばしで結ぶ（{n/step} 星形多角形）
const SHAPES = [
  { id: 'star5', name: '五芒星', n: 5, step: 2 },
  { id: 'star6', name: '六芒星', n: 6, step: 2 },
  { id: 'star7', name: '七芒星', n: 7, step: 3 },
  { id: 'star8', name: '八芒星', n: 8, step: 3 },
  { id: 'tri', name: '三角形', n: 3, step: 1 },
  { id: 'sq', name: '四角形', n: 4, step: 1 },
  { id: 'pent', name: '五角形', n: 5, step: 1 },
  { id: 'hex', name: '六角形', n: 6, step: 1 },
];
const SHAPE = Object.fromEntries(SHAPES.map(s => [s.id, s]));

const KM_MIN = 0.3, KM_MAX = 600;
// URL に中心の指定がないときに最初に囲む場所
const DEFAULT_CENTER = { lat: 35.6852, lng: 139.7528, label: '皇居' };
const KM_PER_DEG_LAT = 111.13;

// ---------------- 状態 ----------------
const state = {
  center: null,          // {lat, lng, label}
  shape: 'star5',
  km: 10,
  tol: 0.2,
  genres: new Set(['shrine', 'temple']),
  P: null,               // 今回の候補点
  results: [],
  alt: 0,
  showIdeal: false,
};

// ---------------- ユーティリティ ----------------
const $ = id => document.getElementById(id);
const isDesktop = () => window.matchMedia('(min-width: 860px)').matches;
function toast(msg, ms = 2400) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function fmtKm(km) {
  if (km < 1) return Math.round(km * 1000 / 10) * 10 + ' m';
  if (km < 10) return km.toFixed(1) + ' km';
  return Math.round(km) + ' km';
}
const kmToSlider = km => Math.round(1000 * Math.log(km / KM_MIN) / Math.log(KM_MAX / KM_MIN));
function sliderToKm(v) {
  const km = KM_MIN * Math.pow(KM_MAX / KM_MIN, v / 1000);
  return km < 1 ? Math.round(km * 20) / 20 : km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cycles(n, step) {
  const out = [], seen = new Set();
  for (let s = 0; s < n; s++) {
    if (seen.has(s)) continue;
    const c = []; let k = s;
    do { c.push(k); seen.add(k); k = (k + step) % n; } while (k !== s);
    out.push(c);
  }
  return out;
}
function shapeIconSvg(shape) {
  const pts = [];
  for (let k = 0; k < shape.n; k++) {
    const a = 2 * Math.PI * k / shape.n;
    pts.push([20 + 16 * Math.sin(a), 21 - 16 * Math.cos(a)]);
  }
  const paths = cycles(shape.n, shape.step).map(c => 'M' + c.map(k => pts[k].map(v => v.toFixed(1)).join(',')).join('L') + 'Z');
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="${paths.join('')}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
}

// ---------------- データ読み込み ----------------
const DATA = { index: null, tiles: new Map() };

async function loadIndex() {
  const res = await fetch('data/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('index');
  DATA.index = await res.json();
  if (DATA.index.built) $('dataDate').textContent = `（${DATA.index.built} 取得）`;
}

function loadTile(genre, key) {
  const id = genre + '/' + key;
  let p = DATA.tiles.get(id);
  if (!p) {
    p = fetch(`data/${genre}/${key}.tsv`).then(r => r.ok ? r.text() : '').then(parseTile)
      .catch(() => { DATA.tiles.delete(id); return parseTile(''); });
    DATA.tiles.set(id, p);
  }
  return p;
}

function parseTile(text) {
  const lines = text.split('\n');
  const lat = new Float64Array(lines.length), lon = new Float64Array(lines.length), name = [];
  let n = 0;
  for (const line of lines) {
    const a = line.indexOf('\t'); if (a < 0) continue;
    const b = line.indexOf('\t', a + 1); if (b < 0) continue;
    lat[n] = +line.slice(0, a); lon[n] = +line.slice(a + 1, b); name.push(line.slice(b + 1)); n++;
  }
  return { n, lat, lon, name };
}

// 中心から rMin〜rMax km の円環に入る候補点を集めて平面座標(km)に
async function gatherPoints(center, rMin, rMax, genres) {
  const kx = KM_PER_DEG_LAT * Math.cos(center.lat * Math.PI / 180), ky = KM_PER_DEG_LAT;
  const dLat = rMax / ky, dLon = rMax / kx;
  const jobs = [];
  for (const g of genres) {
    const info = DATA.index.genres[g]; if (!info) continue;
    const have = new Set(info.tiles);
    for (let la = Math.floor(center.lat - dLat); la <= Math.floor(center.lat + dLat); la++) {
      for (let lo = Math.floor(center.lng - dLon); lo <= Math.floor(center.lng + dLon); lo++) {
        const key = la + '_' + lo;
        if (have.has(key)) jobs.push(loadTile(g, key).then(t => ({ g, t })));
      }
    }
  }
  const loaded = await Promise.all(jobs);
  const P = { x: [], y: [], lat: [], lng: [], name: [], genre: [], kx, ky, center };
  const seen = new Set();
  const rMin2 = rMin * rMin, rMax2 = rMax * rMax;
  for (const { g, t } of loaded) {
    for (let i = 0; i < t.n; i++) {
      const x = (t.lon[i] - center.lng) * kx, y = (t.lat[i] - center.lat) * ky;
      const d2 = x * x + y * y;
      if (d2 < rMin2 || d2 > rMax2) continue;
      const key = t.name[i] + '|' + Math.round(t.lat[i] * 2000) + '|' + Math.round(t.lon[i] * 2000);
      if (seen.has(key)) continue;
      seen.add(key);
      P.x.push(x); P.y.push(y); P.lat.push(t.lat[i]); P.lng.push(t.lon[i]); P.name.push(t.name[i]); P.genre.push(g);
    }
  }
  P.len = P.x.length;
  P.x = Float64Array.from(P.x); P.y = Float64Array.from(P.y);
  return P;
}

// 場所名の索引（初回検索時にだけ読み込む）
let searchIndex = null;
const norm = s => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
function loadSearchIndex() {
  if (!searchIndex) {
    searchIndex = fetch('data/search.tsv').then(r => r.ok ? r.text() : '').then(text => {
      const out = [];
      for (const line of text.split('\n')) {
        const f = line.split('\t'); if (f.length !== 4) continue;
        const title = f[2] === 'station' && !f[3].endsWith('駅') ? f[3] + '駅' : f[3];
        out.push({ lat: +f[0], lng: +f[1], genre: f[2], title, key: norm(title) });
      }
      return out;
    }).catch(() => { searchIndex = null; return []; });
  }
  return searchIndex;
}
async function localSearch(q, limit) {
  const items = await loadSearchIndex(), k = norm(q), hits = [];
  for (const it of items) {
    const pos = it.key.indexOf(k);
    if (pos < 0) continue;
    hits.push([it.key === k ? 0 : pos === 0 ? 1 : 2, it.key.length, it]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // 路線ごとに別の点になっている同名の駅などは1つにまとめる
  const out = [];
  for (const [, , it] of hits) {
    if (out.some(o => o.title === it.title && Math.abs(o.lat - it.lat) < 0.03 && Math.abs(o.lng - it.lng) < 0.03)) continue;
    out.push({ ...it, sub: `${GENRE[it.genre].em} ${GENRE[it.genre].label}` });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------- 図形あてはめ ----------------
function buildGrid(P, ext, cell) {
  const cols = Math.max(1, Math.ceil(2 * ext / cell));
  const cellOf = (x, y) => {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((x + ext) / cell)));
    const cy = Math.min(cols - 1, Math.max(0, Math.floor((y + ext) / cell)));
    return cy * cols + cx;
  };
  const start = new Int32Array(cols * cols + 1);
  const cellIdx = new Int32Array(P.len);
  for (let i = 0; i < P.len; i++) { cellIdx[i] = cellOf(P.x[i], P.y[i]); start[cellIdx[i] + 1]++; }
  for (let c = 0; c < cols * cols; c++) start[c + 1] += start[c];
  const fill = start.slice(0, cols * cols), items = new Int32Array(P.len);
  for (let i = 0; i < P.len; i++) items[fill[cellIdx[i]]++] = i;
  return { cols, cell, ext, start, items };
}

// 最近傍探索（exclude にある点は除く、maxD km より遠ければ -1）
function nearest(G, P, qx, qy, exclude, nEx, maxD) {
  const { cols, cell, ext, start, items } = G;
  const cx = Math.min(cols - 1, Math.max(0, Math.floor((qx + ext) / cell)));
  const cy = Math.min(cols - 1, Math.max(0, Math.floor((qy + ext) / cell)));
  let best = maxD * maxD, bi = -1;
  const rLimit = Math.ceil(maxD / cell) + 1;
  for (let r = 0; r <= rLimit; r++) {
    for (let yy = cy - r; yy <= cy + r; yy++) {
      if (yy < 0 || yy >= cols) continue;
      const edge = yy === cy - r || yy === cy + r;
      for (let xx = cx - r; xx <= cx + r; xx += (edge || r === 0) ? 1 : 2 * r) {
        if (xx < 0 || xx >= cols) continue;
        const c = yy * cols + xx;
        for (let p = start[c], e = start[c + 1]; p < e; p++) {
          const i = items[p];
          const dx = P.x[i] - qx, dy = P.y[i] - qy, d2 = dx * dx + dy * dy;
          if (d2 >= best) continue;
          let used = false;
          for (let u = 0; u < nEx; u++) if (exclude[u] === i) { used = true; break; }
          if (!used) { best = d2; bi = i; }
        }
      }
    }
    if (bi >= 0 && best <= (r * cell) * (r * cell)) break;
  }
  return bi;
}

// 頂点の割り当てが決まったときの最適な回転・拡大（複素数の最小二乗）
function evaluate(P, idx, n, R, tol) {
  let re = 0, im = 0;
  for (let k = 0; k < n; k++) {
    const t = -2 * Math.PI * k / n, wr = Math.cos(t), wi = Math.sin(t);
    const zr = P.x[idx[k]], zi = P.y[idx[k]];
    re += zr * wr + zi * wi; im += zi * wr - zr * wi; // z * conj(w)
  }
  re /= n; im /= n;
  let mag = Math.hypot(re, im) || 1e-9;
  const s = Math.min(1 + tol, Math.max(1 - tol, mag / R));
  re *= s * R / mag; im *= s * R / mag; mag = s * R;
  let sse = 0;
  const ideal = [], gaps = [];
  for (let k = 0; k < n; k++) {
    const t = -2 * Math.PI * k / n, wr = Math.cos(t), wi = Math.sin(t);
    const ix = re * wr - im * wi, iy = re * wi + im * wr;
    const g = Math.hypot(P.x[idx[k]] - ix, P.y[idx[k]] - iy);
    sse += g * g; ideal.push([ix, iy]); gaps.push(g);
  }
  const err = Math.sqrt(sse / n) / mag + 0.08 * Math.abs(s - 1);
  return { idx: idx.slice(), err, s, ideal, gaps, power: Math.max(0, Math.round(100 - err * 300)) };
}

function fitShape(P, shape, R, tol) {
  const n = shape.n;
  if (P.len < n) return [];
  const rMax = R * (1 + tol) * 1.6;
  const area = Math.PI * rMax * rMax;
  const cell = Math.min(R * 0.3, Math.max(R * 0.02, Math.sqrt(area * 4 / P.len)));
  const G = buildGrid(P, rMax, cell);
  const period = 2 * Math.PI / n;
  const rotSteps = Math.ceil(period / (0.5 * Math.PI / 180));
  const sStep = tol <= 0.1 ? 0.02 : tol <= 0.2 ? 0.025 : 0.035;
  const scales = [];
  for (let s = 1 - tol; s <= 1 + tol + 1e-9; s += sStep) scales.push(s);
  const seen = new Map();
  const idx = new Int32Array(n);
  for (const s of scales) {
    const sr = s * R, maxD = sr * 0.6;
    for (let r = 0; r < rotSteps; r++) {
      const th = r * period / rotSteps;
      let ok = true;
      for (let k = 0; k < n; k++) {
        const a = th + k * period;
        const j = nearest(G, P, sr * Math.sin(a), sr * Math.cos(a), idx, k, maxD);
        if (j < 0) { ok = false; break; }
        idx[k] = j;
      }
      if (!ok) continue;
      const key = Array.from(idx).sort((p, q) => p - q).join(',');
      if (seen.has(key)) continue;
      seen.set(key, evaluate(P, Array.from(idx), n, R, tol));
    }
  }
  const all = [...seen.values()].sort((p, q) => p.err - q.err);
  // 似たような候補ばかりにならないよう、2つ以上頂点が違うものだけ残す
  const minDiff = n >= 5 ? 2 : 1, out = [];
  for (const c of all) {
    const set = new Set(c.idx);
    if (out.some(o => n - o.idx.filter(i => set.has(i)).length < minDiff)) continue;
    out.push(c);
    if (out.length >= 10) break;
  }
  return out;
}

// ---------------- 地図 ----------------
const map = L.map('map', { zoomControl: false, zoomSnap: 0.5, minZoom: 4, maxZoom: 18, worldCopyJump: false })
  .setView([36.2, 137.8], 5);
const gsiAttr = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a> | 施設 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const baseLayers = {
  '淡色地図': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { attribution: gsiAttr, maxZoom: 18 }),
  '標準地図': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { attribution: gsiAttr, maxZoom: 18 }),
  '航空写真': L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', { attribution: gsiAttr, maxZoom: 18 }),
};
baseLayers['淡色地図'].addTo(map);
let currentBase = '淡色地図';
map.on('baselayerchange', e => { currentBase = e.name; });
L.control.layers(baseLayers, null, { position: 'bottomright' }).addTo(map);
L.control.zoom({ position: 'bottomright', zoomInTitle: '拡大', zoomOutTitle: '縮小' }).addTo(map);
map.attributionControl.setPrefix(false);

const shapeLayer = L.layerGroup().addTo(map);
let centerMarker = null;

const PIN_PATH = 'M15 37C15 37 2 22.5 2 14a13 13 0 0 1 26 0c0 8.5-13 23-13 23z';
const HEART_PATH = 'M15 21.5s-6.2-3.9-6.2-8a3.4 3.4 0 0 1 6.2-1.9 3.4 3.4 0 0 1 6.2 1.9c0 4.1-6.2 8-6.2 8z';
const PIN_SVG = `<svg viewBox="0 0 30 38"><path d="${PIN_PATH}" fill="#fff" stroke="#c8341c" stroke-width="2"/><path d="${HEART_PATH}" fill="#e8455f"/></svg>`;
const pinIcon = L.divIcon({ className: 'v-pin', html: PIN_SVG, iconSize: [30, 38], iconAnchor: [15, 37], popupAnchor: [0, -34], tooltipAnchor: [0, -36] });
const centerIcon = L.divIcon({ className: 'c-pin', html: '<div></div>', iconSize: [22, 22], iconAnchor: [11, 11] });

function sheetHeight() { return isDesktop() ? 0 : $('panel').getBoundingClientRect().height; }
function syncSheetVar() { document.documentElement.style.setProperty('--sheet-h', sheetHeight() + 'px'); }

function setCenter(lat, lng, label, fly) {
  state.center = { lat, lng, label: label || null };
  if (!centerMarker) {
    centerMarker = L.marker([lat, lng], { icon: centerIcon, draggable: true, zIndexOffset: 1000, title: '中心（ドラッグで移動）' }).addTo(map);
    centerMarker.on('dragend', () => { const p = centerMarker.getLatLng(); setCenter(p.lat, p.lng, null, false); });
  } else centerMarker.setLatLng([lat, lng]);
  const lb = $('centerLabel');
  lb.textContent = label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  lb.classList.remove('unset');
  $('hint').classList.add('hide');
  if (fly) map.setView([lat, lng], Math.max(map.getZoom(), zoomForKm(state.km)));
  schedule(true);
}
function zoomForKm(km) {
  const px = Math.min(window.innerWidth, window.innerHeight) * 0.35;
  const mPerPx = km * 1000 / px;
  return Math.max(5, Math.min(17, Math.floor(Math.log2(156543 * Math.cos((state.center ? state.center.lat : 35) * Math.PI / 180) / mPerPx))));
}

let popupClosedAt = 0;
map.on('popupclose', () => { popupClosedAt = Date.now(); });
map.on('click', e => {
  // ポップアップや検索候補を閉じるためのタップでは中心を動かさない
  if (Date.now() - popupClosedAt < 400 || !$('searchResults').hidden) { $('searchResults').hidden = true; return; }
  // スマホでは地図をタップしたらシートを縮めて地図を広く
  if (!isDesktop() && !$('result').hidden) setCollapsed(true);
  setCenter(e.latlng.lat, e.latlng.lng, null, false);
});

// ---------------- 計算の実行 ----------------
let runId = 0, timer = 0;
function schedule(refit, delay = 120) {
  if (!state.center) return;
  clearTimeout(timer);
  timer = setTimeout(() => run(refit), delay);
}

async function run(refit) {
  if (!state.center || !DATA.index) return;
  const my = ++runId;
  const shape = SHAPE[state.shape], R = state.km, tol = state.tol;
  if (state.genres.size === 0) { shapeLayer.clearLayers(); showMessage('頂点にする施設のジャンルを1つ以上選んでください'); return; }
  $('powerValue').classList.add('loading');
  const t0 = performance.now();
  const P = await gatherPoints(state.center, R * (1 - tol) * 0.4, R * (1 + tol) * 1.6, state.genres);
  if (my !== runId) return;
  const results = fitShape(P, shape, R, tol);
  if (my !== runId) return;
  state.P = P; state.results = results;
  state.alt = state.alt0 && state.alt0 < results.length ? state.alt0 : 0; state.alt0 = 0;
  $('powerValue').classList.remove('loading');
  if (!results.length) {
    shapeLayer.clearLayers();
    showMessage(P.len < shape.n
      ? 'この範囲に選んだジャンルの施設が足りません。大きさを変えるか、ジャンルを増やしてみてください。'
      : 'うまく図形が作れませんでした。形のゆるさを上げるか、ジャンルを増やしてみてください。');
    return;
  }
  state.ms = Math.round(performance.now() - t0);
  const firstResult = $('result').hidden;
  showResult();
  const collapsing = firstResult && !isDesktop();
  if (collapsing) setCollapsed(true);
  // シートが縮み終わってから地図を合わせる
  if (refit) setTimeout(fitToShape, Math.max(0, sheetAnimUntil - Date.now()));
  updateUrl();
}

function showMessage(msg) {
  if (sheetLevel() === 0) setSheet(1);
  $('result').hidden = false;
  $('panel').classList.remove('no-result');
  $('powerValue').textContent = '-';
  $('result').classList.remove('max');
  $('powerValue').classList.remove('loading');
  $('altLabel').textContent = '0 / 0';
  $('prevBtn').disabled = $('nextBtn').disabled = true;
  const note = $('resultNote'); note.textContent = msg; note.className = 'result-note warn';
  $('vertexList').innerHTML = '';
  syncSheetVar();
}

function toLatLng(P, x, y) { return [P.center.lat + y / P.ky, P.center.lng + x / P.kx]; }

function showResult() {
  const P = state.P, res = state.results[state.alt], shape = SHAPE[state.shape];
  $('result').hidden = false;
  $('panel').classList.remove('no-result');
  $('powerValue').textContent = res.power;
  $('result').classList.toggle('max', res.power >= 90);
  $('altLabel').textContent = `${state.alt + 1} / ${state.results.length}`;
  $('prevBtn').disabled = state.alt === 0;
  $('nextBtn').disabled = state.alt >= state.results.length - 1;
  const meanGap = res.gaps.reduce((a, b) => a + b, 0) / res.gaps.length;
  const note = $('resultNote');
  const sizeTxt = `半径 ${fmtKm(res.s * state.km)}`;
  if (res.power >= 50) {
    note.textContent = `${shape.name}・${sizeTxt}　頂点のずれ 平均 ${fmtKm(meanGap)}（${P.len.toLocaleString()} 件から ${state.ms} ms で計算）`;
    note.className = 'result-note';
  } else {
    note.textContent = `少しゆがんでいます（ずれ 平均 ${fmtKm(meanGap)}）。ジャンルを増やすか、形のゆるさを上げると整いやすくなります。`;
    note.className = 'result-note warn';
  }
  const ol = $('vertexList'); ol.innerHTML = '';
  res.idx.forEach((i, k) => {
    const li = document.createElement('li');
    const g = GENRE[P.genre[i]];
    li.innerHTML = `<span class="num">${k + 1}</span><span class="nm">${escapeHtml(P.name[i])}<small>${g.em} ${g.label}</small></span><span class="gap">ずれ ${fmtKm(res.gaps[k])}</span>`;
    li.addEventListener('click', () => { map.setView([P.lat[i], P.lng[i]], Math.max(map.getZoom(), 15)); markers[k] && markers[k].openPopup(); });
    ol.appendChild(li);
  });
  draw();
  syncSheetVar();
}

let markers = [];
function draw() {
  shapeLayer.clearLayers(); markers = [];
  const P = state.P, res = state.results[state.alt], shape = SHAPE[state.shape];
  if (!res) return;
  const pts = res.idx.map(i => [P.lat[i], P.lng[i]]);
  const cyc = cycles(shape.n, shape.step);
  if (state.showIdeal) {
    const ip = res.ideal.map(([x, y]) => toLatLng(P, x, y));
    cyc.forEach(c => L.polygon(c.map(k => ip[k]), { color: '#2d5fb8', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(shapeLayer));
    ip.forEach(p => L.circleMarker(p, { radius: 3.5, color: '#2d5fb8', weight: 1, fillOpacity: 1, fillColor: '#fff', interactive: false }).addTo(shapeLayer));
  }
  // 辺ごとに色を変えて虹色に
  cyc.forEach(c => L.polygon(c.map(k => pts[k]), { color: '#fff', weight: 9, opacity: 0.85, fill: false, interactive: false }).addTo(shapeLayer));
  let seg = 0;
  cyc.forEach(c => c.forEach((k, j) => {
    const hue = Math.round(seg++ * 360 / shape.n);
    L.polyline([pts[k], pts[c[(j + 1) % c.length]]], { color: `hsl(${hue}, 100%, 48%)`, weight: 5, opacity: 1, interactive: false, lineCap: 'round' }).addTo(shapeLayer);
  }));
  res.idx.forEach((i, k) => {
    const m = L.marker(pts[k], { icon: pinIcon, riseOnHover: true }).addTo(shapeLayer);
    m.bindTooltip(escapeHtml(P.name[i]), { permanent: true, interactive: true, direction: 'top', className: 'v-label', offset: [0, -2] });
    m.bindPopup(() => popupFor(k), { maxWidth: 260, autoPanPaddingTopLeft: [10, 80], autoPanPaddingBottomRight: [10, sheetHeight() + 10] });
    markers.push(m);
  });
}

function popupFor(k) {
  const P = state.P, res = state.results[state.alt], i = res.idx[k], g = GENRE[P.genre[i]];
  const el = document.createElement('div');
  const q = encodeURIComponent(P.name[i]);
  el.innerHTML = `<div class="pop-name">${escapeHtml(P.name[i])}</div>
    <div class="pop-meta">${g.em} ${g.label}・頂点 ${k + 1}・ずれ ${fmtKm(res.gaps[k])}</div>
    <div class="pop-links"><a href="https://www.google.com/maps/search/?api=1&query=${P.lat[i]},${P.lng[i]}" target="_blank" rel="noopener">Googleマップ</a><a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">検索</a></div>`;
  // 理想の頂点に近い別の候補
  const [ix, iy] = res.ideal[k], used = new Set(res.idx), cand = [];
  for (let j = 0; j < P.len; j++) {
    if (used.has(j)) continue;
    const d = Math.hypot(P.x[j] - ix, P.y[j] - iy);
    if (cand.length < 4 || d < cand[cand.length - 1][1]) {
      cand.push([j, d]); cand.sort((a, b) => a[1] - b[1]); if (cand.length > 4) cand.pop();
    }
  }
  if (cand.length) {
    const box = document.createElement('div'); box.className = 'pop-alts';
    box.innerHTML = '<b>この頂点を入れ替える</b>';
    cand.forEach(([j, d]) => {
      const b = document.createElement('button'); b.type = 'button';
      b.innerHTML = `${GENRE[P.genre[j]].em} ${escapeHtml(P.name[j])} <small>ずれ ${fmtKm(d)}</small>`;
      b.addEventListener('click', () => {
        const idx = res.idx.slice(); idx[k] = j;
        state.results[state.alt] = evaluate(P, idx, SHAPE[state.shape].n, state.km, state.tol);
        map.closePopup(); showResult();
      });
      box.appendChild(b);
    });
    el.appendChild(box);
  }
  return el;
}

function fitToShape() {
  const P = state.P, res = state.results[state.alt]; if (!res) return;
  const b = L.latLngBounds(res.idx.map(i => [P.lat[i], P.lng[i]])).extend([state.center.lat, state.center.lng]);
  if (isDesktop()) map.fitBounds(b, { paddingTopLeft: [80, 110], paddingBottomRight: [80, 40] });
  else map.fitBounds(b, { paddingTopLeft: [50, 110], paddingBottomRight: [50, sheetHeight() + 20] });
}

// ---------------- URL 共有 ----------------
function updateUrl() {
  if (!state.center) return;
  const p = new URLSearchParams();
  p.set('c', state.center.lat.toFixed(5) + ',' + state.center.lng.toFixed(5));
  p.set('s', state.shape); p.set('r', state.km); p.set('t', state.tol);
  p.set('g', [...state.genres].join(','));
  if (state.alt) p.set('a', state.alt);
  history.replaceState(null, '', '?' + p.toString());
}
function readUrl() {
  const p = new URLSearchParams(location.search);
  if (SHAPE[p.get('s')]) state.shape = p.get('s');
  const r = parseFloat(p.get('r')); if (r >= KM_MIN && r <= KM_MAX) state.km = r;
  const t = parseFloat(p.get('t')); if ([0.08, 0.2, 0.35].includes(t)) state.tol = t;
  if (p.get('g')) { const g = p.get('g').split(',').filter(x => GENRE[x]); if (g.length) state.genres = new Set(g); }
  const c = (p.get('c') || '').split(',').map(parseFloat);
  return c.length === 2 && isFinite(c[0]) && isFinite(c[1]) ? c : null;
}

// ---------------- UI ----------------
// スマホのシートは 3 段階: 0 = 地図を最大に（パワーだけ）, 1 = 結果, 2 = 条件の設定
let sheetAnimUntil = 0;
function sheetLevel() {
  const p = $('panel');
  return p.classList.contains('mini') ? 0 : p.classList.contains('collapsed') ? 1 : 2;
}
function setSheet(level) {
  const p = $('panel');
  const changed = sheetLevel() !== level;
  if (changed) sheetAnimUntil = Date.now() + 280;
  p.classList.toggle('collapsed', level < 2);
  p.classList.toggle('mini', level === 0);
  setTimeout(syncSheetVar, 260); syncSheetVar();
  // 地図が広くなったら図形が画面に収まるよう合わせ直す
  if (changed && level < 2 && !isDesktop() && state.results[state.alt]) setTimeout(fitToShape, 290);
}
// true: 設定を閉じる（地図を最大にしている状態はそのまま）、false: 設定を開く
function setCollapsed(v) { setSheet(v ? Math.min(sheetLevel(), 1) : 2); }

function buildUi() {
  const sl = $('shapeList');
  SHAPES.forEach(s => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'shape-btn'; b.setAttribute('role', 'radio'); b.dataset.id = s.id;
    b.innerHTML = shapeIconSvg(s) + s.name;
    b.addEventListener('click', () => { state.shape = s.id; syncUi(); schedule(false, 0); });
    sl.appendChild(b);
  });
  const gl = $('genreList');
  GENRE_GROUPS.forEach(([group, items]) => {
    const wrap = document.createElement('div'); wrap.className = 'genre-group';
    wrap.innerHTML = `<h3>${group}</h3>`;
    const chips = document.createElement('div'); chips.className = 'genre-chips';
    items.forEach(([id, label, em]) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.dataset.id = id;
      b.innerHTML = `<span class="em">${em}</span>${label}`;
      b.addEventListener('click', () => {
        state.genres.has(id) ? state.genres.delete(id) : state.genres.add(id);
        syncUi(); schedule(false, 200);
      });
      chips.appendChild(b);
    });
    wrap.appendChild(chips); gl.appendChild(wrap);
  });
  $('clearGenres').addEventListener('click', () => { state.genres.clear(); syncUi(); schedule(false); });

  const range = $('sizeRange');
  range.addEventListener('input', () => { state.km = sliderToKm(+range.value); syncUi(true); schedule(true, 220); });
  $('sizePresets').addEventListener('click', e => {
    const km = +e.target.dataset.km; if (!km) return;
    state.km = km; syncUi(); schedule(true, 0);
  });
  $('tolList').addEventListener('click', e => {
    const t = +e.target.dataset.tol; if (!t) return;
    state.tol = t; syncUi(); schedule(false, 0);
  });

  $('prevBtn').addEventListener('click', () => { if (state.alt > 0) { state.alt--; showResult(); updateUrl(); } });
  $('nextBtn').addEventListener('click', () => { if (state.alt < state.results.length - 1) { state.alt++; showResult(); updateUrl(); } });
  $('idealToggle').addEventListener('change', e => { state.showIdeal = e.target.checked; draw(); });
  $('shareBtn').addEventListener('click', share);
  $('saveBtn').addEventListener('click', saveImage);
  $('editBtn').addEventListener('click', () => { setCollapsed(false); document.querySelector('.panel-body').scrollTop = 0; });

  // バーは上下にドラッグで段階を切り替え、タップで 地図最大→結果→設定→結果 の順に
  let dragY = null;
  const handle = $('handle');
  handle.addEventListener('pointerdown', e => { dragY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointerup', e => {
    if (dragY === null) return;
    const dy = e.clientY - dragY; dragY = null;
    const lv = sheetLevel();
    if (dy > 30) setSheet(Math.max(0, lv - 1));
    else if (dy < -30) setSheet(Math.min(2, lv + 1));
    else setSheet(lv === 2 ? 1 : lv + 1);
  });
  handle.addEventListener('pointercancel', () => { dragY = null; });
  handle.addEventListener('click', e => { if (e.detail === 0) { const lv = sheetLevel(); setSheet(lv === 2 ? 1 : lv + 1); } }); // キーボード操作
  $('miniBtn').addEventListener('click', () => setSheet(sheetLevel() === 0 ? 1 : 0));
  document.querySelector('.brand').addEventListener('click', () => { if (!isDesktop()) setSheet(sheetLevel() === 2 ? 1 : 2); });

  $('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) { toast('この端末では現在地を取得できません'); return; }
    toast('現在地を取得しています…');
    navigator.geolocation.getCurrentPosition(
      pos => setCenter(pos.coords.latitude, pos.coords.longitude, '現在地', true),
      () => toast('現在地を取得できませんでした'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
  $('mapCenterBtn').addEventListener('click', () => { const c = map.getCenter(); setCenter(c.lat, c.lng, null, false); });

  // 場所検索: 駅・役所などは端末内の索引から即時に、住所は国土地理院 地名検索APIで
  const form = $('search'), input = $('searchInput'), list = $('searchResults');
  const renderItems = items => {
    list.innerHTML = '';
    items.forEach(it => {
      const li = document.createElement('li'); li.tabIndex = 0;
      li.innerHTML = escapeHtml(it.title) + (it.sub ? `<small>${escapeHtml(it.sub)}</small>` : '');
      const pick = () => { list.hidden = true; input.value = it.title; input.blur(); setCenter(it.lat, it.lng, it.title, true); };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', ev => { if (ev.key === 'Enter') pick(); });
      list.appendChild(li);
    });
    list.hidden = !items.length;
  };
  let suggestTimer = 0;
  input.addEventListener('input', () => {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(async () => {
      const q = input.value.trim();
      renderItems(q ? await localSearch(q, 8) : []);
    }, 120);
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    input.blur();
    const local = await localSearch(q, 6);
    let remote = [];
    try {
      const res = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
      remote = (await res.json()).slice(0, 6).map(it => ({
        title: it.properties.title, sub: '住所・地名', lat: it.geometry.coordinates[1], lng: it.geometry.coordinates[0],
      }));
    } catch { /* オフライン時は端末内の結果だけ */ }
    const items = local.concat(remote);
    if (!items.length) toast('見つかりませんでした');
    renderItems(items);
  });
  document.addEventListener('click', e => { if (!form.contains(e.target)) list.hidden = true; });

  window.addEventListener('resize', syncSheetVar);
}

function syncUi(fromSlider) {
  document.querySelectorAll('.shape-btn').forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === state.shape)));
  document.querySelectorAll('.chip').forEach(b => {
    b.setAttribute('aria-pressed', String(state.genres.has(b.dataset.id)));
    const info = DATA.index && DATA.index.genres[b.dataset.id];
    if (DATA.index) { b.disabled = !info; b.title = info ? `${info.count.toLocaleString()} 件` : 'データ準備中'; }
  });
  document.querySelectorAll('#tolList button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.tol === state.tol)));
  if (!fromSlider) $('sizeRange').value = kmToSlider(state.km);
  $('sizeValue').textContent = '半径 ' + fmtKm(state.km);
}

// ---------------- 画像の保存 ----------------
// 地図タイル・図形・タイトルを 1 枚の canvas に描く（1080×1480）
const TILE_URLS = {
  '淡色地図': 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
  '標準地図': 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  '航空写真': 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
};
const RAINBOW = ['#ff0040', '#ff9900', '#ffee00', '#33dd00', '#00ccff', '#3355ff', '#cc00ff'];
const POP_FONT = '"HGP創英角ﾎﾟｯﾌﾟ体", "Mochiy Pop One", sans-serif';

function mercator(lat, lng, z) {
  const size = 256 * Math.pow(2, z), s = Math.sin(lat * Math.PI / 180);
  return [(lng + 180) / 360 * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}
function loadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
function rainbowGradient(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  RAINBOW.forEach((c, i) => g.addColorStop(i / (RAINBOW.length - 1), c));
  return g;
}
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}

async function renderImage() {
  const P = state.P, res = state.results[state.alt], shape = SHAPE[state.shape];
  const W = 1080, HEAD = 190, MAPH = 1060, FOOT = 230, H = HEAD + MAPH + FOOT, B = 14;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  try { await document.fonts.load(`40px ${POP_FONT}`, 'どこでもパワースポット0123456789'); } catch { /* 代替フォントで描く */ }

  // 図形が収まるズームを決める
  const pts = res.idx.map(i => [P.lat[i], P.lng[i]]);
  const all = pts.concat([[state.center.lat, state.center.lng]]);
  const m0 = all.map(([la, lo]) => mercator(la, lo, 0));
  const xs = m0.map(p => p[0]), ys = m0.map(p => p[1]);
  const spanX = Math.max(1e-9, Math.max(...xs) - Math.min(...xs)), spanY = Math.max(1e-9, Math.max(...ys) - Math.min(...ys));
  const z = Math.max(4, Math.min(17.5, Math.log2(Math.min((W - 300) / spanX, (MAPH - 300) / spanY))));
  const tz = Math.max(2, Math.min(18, Math.round(z))), scale = Math.pow(2, z - tz), k = Math.pow(2, z);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2 * k, cy = (Math.max(...ys) + Math.min(...ys)) / 2 * k + 25;
  const toImg = (la, lo) => { const [x, y] = mercator(la, lo, z); return [x - cx + W / 2, y - cy + MAPH / 2 + HEAD]; };

  // 地図タイル
  ctx.fillStyle = '#e8f0ff'; ctx.fillRect(0, HEAD, W, MAPH);
  const tsz = 256 * scale, left = cx - W / 2, top = cy - MAPH / 2, n = Math.pow(2, tz);
  const jobs = [];
  for (let ty = Math.floor(top / tsz); ty <= Math.floor((top + MAPH) / tsz); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / tsz); tx <= Math.floor((left + W) / tsz); tx++) {
      const url = TILE_URLS[currentBase].replace('{z}', tz).replace('{x}', ((tx % n) + n) % n).replace('{y}', ty);
      jobs.push(loadImage(url).then(img => ({ img, tx, ty })));
    }
  }
  ctx.save(); ctx.beginPath(); ctx.rect(0, HEAD, W, MAPH); ctx.clip();
  for (const { img, tx, ty } of await Promise.all(jobs)) {
    if (img) ctx.drawImage(img, tx * tsz - left, ty * tsz - top + HEAD, tsz + 0.5, tsz + 0.5);
  }

  // 虹色の図形
  const ip = pts.map(([la, lo]) => toImg(la, lo));
  const cyc = cycles(shape.n, shape.step);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 16;
  cyc.forEach(c => { ctx.beginPath(); c.forEach((kk, j) => j ? ctx.lineTo(...ip[kk]) : ctx.moveTo(...ip[kk])); ctx.closePath(); ctx.stroke(); });
  let seg = 0;
  ctx.lineWidth = 9;
  cyc.forEach(c => c.forEach((kk, j) => {
    ctx.strokeStyle = `hsl(${Math.round(seg++ * 360 / shape.n)}, 100%, 48%)`;
    ctx.beginPath(); ctx.moveTo(...ip[kk]); ctx.lineTo(...ip[c[(j + 1) % c.length]]); ctx.stroke();
  }));

  // 中心の印
  const [ccx, ccy] = toImg(state.center.lat, state.center.lng);
  if (ctx.createConicGradient) {
    const g = ctx.createConicGradient(0, ccx, ccy);
    RAINBOW.concat(RAINBOW[0]).forEach((c, i) => g.addColorStop(i / RAINBOW.length, c));
    ctx.fillStyle = g;
  } else ctx.fillStyle = '#ff3399';
  ctx.beginPath(); ctx.arc(ccx, ccy, 22, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ccx, ccy, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ff3399'; ctx.font = `20px ${POP_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', ccx, ccy + 1);

  // ハートのピンと名前
  const pin = new Path2D(PIN_PATH), heart = new Path2D(HEART_PATH), ps = 1.7;
  ip.forEach(([x, y], k) => {
    ctx.save(); ctx.translate(x - 15 * ps, y - 37 * ps); ctx.scale(ps, ps);
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff'; ctx.fill(pin); ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2; ctx.strokeStyle = '#c8341c'; ctx.stroke(pin);
    ctx.fillStyle = '#e8455f'; ctx.fill(heart);
    ctx.restore();
    ctx.font = `26px ${POP_FONT}`;
    const label = fitText(ctx, P.name[res.idx[k]], 360);
    const tw = ctx.measureText(label).width + 20, th = 40;
    const lx = Math.min(W - B - tw - 4, Math.max(B + 4, x - tw / 2)), ly = Math.max(HEAD + 6, y - 37 * ps - th - 6);
    ctx.fillStyle = '#ffffcc'; ctx.fillRect(lx, ly, tw, th);
    ctx.lineWidth = 3; ctx.strokeStyle = '#ff3399'; ctx.strokeRect(lx, ly, tw, th);
    ctx.fillStyle = '#cc0066'; ctx.textAlign = 'left'; ctx.fillText(label, lx + 10, ly + th / 2 + 1);
  });
  ctx.restore();

  // ヘッダー（星柄にタイトル）
  ctx.fillStyle = '#fff6fd'; ctx.fillRect(0, 0, W, HEAD);
  ctx.font = `26px ${POP_FONT}`; ctx.textAlign = 'center';
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = ['#ffcc00', '#ff99cc', '#99ccff', '#cc99ff'][i % 4];
    ctx.fillText(i % 2 ? '☆' : '★', (i * 83 + 30) % W, 30 + ((i * 53) % (HEAD - 50)));
  }
  ctx.font = `76px ${POP_FONT}`; ctx.textBaseline = 'middle';
  ctx.lineWidth = 14; ctx.strokeStyle = '#660066'; ctx.strokeText('どこでもパワースポット', W / 2 + 4, 92 + 4);
  ctx.lineWidth = 10; ctx.strokeStyle = '#fff'; ctx.strokeText('どこでもパワースポット', W / 2, 92);
  ctx.fillStyle = rainbowGradient(ctx, 80, 0, W - 80, 0); ctx.fillText('どこでもパワースポット', W / 2, 92);
  ctx.font = `bold 26px ${POP_FONT}`; ctx.fillStyle = '#cc0066';
  ctx.fillText('★☆ キミだけのパワースポット ☆★', W / 2, 160);

  // フッター（パワーと情報）
  const fy = HEAD + MAPH;
  ctx.fillStyle = '#fff6fd'; ctx.fillRect(0, fy, W, FOOT);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = `34px ${POP_FONT}`; ctx.fillStyle = '#cc0066'; ctx.fillText('★パワー★', B + 30, fy + 70);
  ctx.font = `112px ${POP_FONT}`;
  ctx.lineWidth = 10; ctx.strokeStyle = '#660066'; ctx.strokeText(String(res.power), B + 30, fy + 182);
  ctx.fillStyle = rainbowGradient(ctx, B + 30, 0, B + 230, 0); ctx.fillText(String(res.power), B + 30, fy + 178);
  const tx0 = B + 270;
  ctx.font = `bold 30px ${POP_FONT}`; ctx.fillStyle = '#330033';
  ctx.fillText(fitText(ctx, `${shape.name}・半径 ${fmtKm(res.s * state.km)}`, W - tx0 - 40), tx0, fy + 62);
  ctx.fillText(fitText(ctx, `中心: ${state.center.label || `${state.center.lat.toFixed(4)}, ${state.center.lng.toFixed(4)}`}`, W - tx0 - 40), tx0, fy + 104);
  if (res.power >= 90) { ctx.fillStyle = '#ff0000'; ctx.fillText('ｷﾀ━━━(ﾟ∀ﾟ)━━━!!', tx0, fy + 146); }
  ctx.font = '20px sans-serif'; ctx.fillStyle = '#663366';
  ctx.fillText(fitText(ctx, '地図: 国土地理院（地理院タイル） / 施設: © OpenStreetMap contributors', W - tx0 - 30), tx0, fy + 178);
  ctx.fillText(fitText(ctx, (location.host + location.pathname).replace(/\/$/, ''), W - tx0 - 30), tx0, fy + 204);

  // 区切りと外枠の虹
  ctx.fillStyle = rainbowGradient(ctx, 0, 0, W, 0);
  ctx.fillRect(0, HEAD - 6, W, 6); ctx.fillRect(0, fy, W, 6);
  ctx.lineWidth = B; ctx.strokeStyle = rainbowGradient(ctx, 0, 0, W, H); ctx.strokeRect(B / 2, B / 2, W - B, H - B);
  return cv;
}

async function saveImage() {
  if (!state.results[state.alt]) { toast('先に図形を作ってね'); return; }
  toast('画像を作っています…', 10000);
  let blob;
  try {
    const cv = await renderImage();
    blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    if (!blob) throw new Error('blob');
  } catch (e) { console.error(e); toast('画像を作れませんでした'); return; }
  $('toast').classList.remove('show');
  const d = new Date(), pad = v => String(v).padStart(2, '0');
  const name = `powerspot_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
  showImageModal(blob, name);
}

// できた画像を見せて、そこから保存してもらう（iPhone は共有シート、ほかはダウンロード）
function showImageModal(blob, name) {
  const url = URL.createObjectURL(blob);
  const wrap = document.createElement('div');
  wrap.className = 'img-modal';
  wrap.innerHTML = `<div class="img-box" role="dialog" aria-label="画像の保存">
      <p class="img-title">★☆ 画像ができたよ！ ☆★</p>
      <img src="${url}" alt="パワースポットの画像">
      <p class="img-hint">うまく保存できないときは、画像を長押しして保存してね</p>
      <div class="img-actions"><button type="button" class="ghost-btn img-save">画像を保存</button><button type="button" class="ghost-btn img-close">閉じる</button></div>
    </div>`;
  const close = () => { wrap.remove(); URL.revokeObjectURL(url); };
  wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
  wrap.querySelector('.img-close').addEventListener('click', close);
  wrap.querySelector('.img-save').addEventListener('click', async () => {
    const file = new File([blob], name, { type: 'image/png' });
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    toast('画像を保存しました');
  });
  document.body.appendChild(wrap);
}

async function share() {
  updateUrl();
  const res = state.results[state.alt];
  const text = res ? `${SHAPE[state.shape].name}のパワースポット（パワー ${res.power}）を見つけました` : 'どこでもパワースポット';
  if (navigator.share) {
    try { await navigator.share({ title: 'どこでもパワースポット', text, url: location.href }); } catch { /* キャンセル */ }
  } else {
    try { await navigator.clipboard.writeText(location.href); toast('リンクをコピーしました'); }
    catch { prompt('このリンクをコピーしてください', location.href); }
  }
}

// ---------------- 起動 ----------------
// あなたの訪問回数（この端末のブラウザだけで数える）
function countVisit() {
  let n = 1;
  try { n = (parseInt(localStorage.getItem('visits'), 10) || 0) + 1; localStorage.setItem('visits', n); } catch { /* 保存できない環境 */ }
  $('visitCount').textContent = String(n).padStart(6, '0');
}

// マウスのキラキラ（マウスのあるPCで、動きを減らす設定でないときだけ）
function sparkleTrail() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const chars = ['★', '☆', '✦', '♥', '✧'], colors = ['#ff0040', '#ff9900', '#ffcc00', '#33dd00', '#00ccff', '#3355ff', '#cc00ff'];
  let last = 0, live = 0;
  document.addEventListener('pointermove', e => {
    const now = performance.now();
    if (now - last < 45 || live > 24) return;
    last = now; live++;
    const s = document.createElement('span');
    s.className = 'sparkle';
    s.textContent = chars[Math.floor(Math.random() * chars.length)];
    s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px';
    s.style.color = colors[Math.floor(Math.random() * colors.length)];
    document.body.appendChild(s);
    s.addEventListener('animationend', () => { s.remove(); live--; });
  }, { passive: true });
}

(async function init() {
  const c = readUrl();
  buildUi();
  countVisit();
  sparkleTrail();
  $('panel').classList.add('no-result');
  syncUi();
  syncSheetVar();
  try { await loadIndex(); } catch { toast('施設データを読み込めませんでした', 5000); return; }
  syncUi();
  if (c) { state.alt0 = +new URLSearchParams(location.search).get('a') || 0; setCenter(c[0], c[1], null, true); }
  else {
    setCenter(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng, DEFAULT_CENTER.label, true);
    const hint = $('hint');
    hint.textContent = '地図をタップすると、囲む場所（中心）を変えられます';
    hint.classList.remove('hide');
    setTimeout(() => hint.classList.add('hide'), 5000);
  }
})();
