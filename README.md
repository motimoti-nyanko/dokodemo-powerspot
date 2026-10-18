# どこでもパワースポット

**公開中: https://motimoti-nyanko.github.io/dokodemo-powerspot/**

地図上の好きな場所（中心）を、実在の施設（神社・お寺・コンビニ・駅など）を頂点にした五芒星などの図形で囲むWebサイトです。

- 図形: 五芒星・六芒星・七芒星・八芒星・三角形・四角形・五角形・六角形
- 頂点にする施設: 27ジャンルから複数選択
- 大きさ: 半径 300 m〜600 km（スライダー／プリセット）
- 形のゆるさ: きっちり（±8%）／ふつう（±20%）／ゆるめ（±35%）でサイズのずれを許容
- 結果: パワー（一致度）、別の候補（最大10案）、頂点ごとの入れ替え、理想図形の重ね表示、URLで共有

## しくみ

| 部分 | 中身 | 費用 |
|---|---|---|
| 画面・計算 | `docs/` の HTML / CSS / JS だけ。図形あてはめは端末内で計算（AI・サーバー処理なし） | 0円 |
| 施設データ | OpenStreetMap から事前に作った静的ファイル `docs/data/<ジャンル>/<緯度>_<経度>.tsv`（1度四方のタイル） | 0円 |
| 地図 | 国土地理院の地理院タイル（APIキー不要） | 0円 |
| 住所検索 | 国土地理院 地名検索API（APIキー不要）＋ 駅・役所などは端末内の索引 `data/search.tsv` | 0円 |
| 公開 | GitHub Pages（静的ホスティング） | 0円 |

有料APIやサーバーは使っていないので、アクセスが増えても請求は発生しません（クレジットカードの登録も不要）。

### あてはめの計算
1. 中心から半径の 0.4〜1.6 倍の円環にある候補施設を読み込み、平面座標（km）に変換
2. 図形の回転（0.5°刻み）× 大きさ（許容範囲内）を総当たりし、各頂点の理想位置に最も近い施設をグリッド索引で探す
3. 頂点の組み合わせごとに、回転・拡大を最小二乗で最適化して誤差を計算（パワー = 100 − 平均誤差率 × 300）
4. 頂点が2つ以上違う上位10案を「別の候補」として表示

数万件の候補でも数十〜数百ミリ秒で終わります。

## 公開手順（GitHub Pages・無料）

1. GitHub のアカウントを作る（無料、カード登録不要）
2. 新しいリポジトリを **Public** で作る（例: `powerspot`）
3. このフォルダ（`DokodemoPowerSpot`）の中身をリポジトリに入れる
   ```bash
   cd DokodemoPowerSpot
   git init
   git add .
   git commit -m "first commit"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/powerspot.git
   git push -u origin main
   ```
4. リポジトリの **Settings → Pages** で、Source を「Deploy from a branch」、Branch を `main` / `/docs` にして Save
5. 1〜2分で `https://<ユーザー名>.github.io/powerspot/` に公開されます

※ `tools/raw/`（取得した生データ）は `.gitignore` で除外しています。

## 施設データの更新

PowerShell で（Overpass API から日本全国を取得、30分〜1時間ほど）:

```bash
powershell -ExecutionPolicy Bypass -File tools/build_data.ps1
```

特定ジャンルだけ: `-Only shrine,temple`。取得済みの生データから作り直すだけなら `-SkipFetch`。
ジャンルを増やすときは `tools/build_data.ps1` の `$genres` と `docs/app.js` の `GENRE_GROUPS` の両方に追加します。

## ローカルで動かす

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

→ http://localhost:8787/

## クレジット・ライセンス

- 地図: [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（国土地理院）
- 施設データ: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)。`docs/data/` は OpenStreetMap から作ったデータなので、[ODbL](https://opendatacommons.org/licenses/odbl/) が適用されます
- 地図ライブラリ: [Leaflet](https://leafletjs.com/)（BSD-2-Clause）
