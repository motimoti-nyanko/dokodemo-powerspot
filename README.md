# どこでもパワースポット

**https://motimoti-nyanko.github.io/dokodemo-powerspot/**

地図上の好きな場所を、実在する施設（神社・お寺・コンビニ・駅など）を頂点にした五芒星などの図形で囲むWebサイトです。あなただけのパワースポットを見つけよう。

## 使い方

1. 地図をタップする（または地名・駅名で検索／「現在地」）と、そこが図形の中心になります
2. 図形・大きさ・頂点にする施設のジャンルを選ぶと、すぐに図形が描かれます
3. 「‹ ›」で別の候補に切り替え。頂点のピンをタップすると、近くの別の施設と入れ替えられます
4. 「共有」で、同じ図形を開けるURLを送れます

## できること

- 図形: 五芒星・六芒星・七芒星・八芒星・三角形・四角形・五角形・六角形
- 頂点にする施設: 27ジャンルから複数選択（神社、お寺、城、山、温泉、駅、コンビニ、カフェ、学校 など）
- 大きさ: 半径 300 m〜600 km
- 形のゆるさ: きっちり／ふつう／ゆるめ（図形の大きさのずれをどこまで許すか）
- パワー: 図形のきれいさを 0〜100 で表示
- スマートフォン・パソコンの両方に対応

## しくみ

計算はすべてブラウザの中で行い、入力した場所などの情報をサーバーへ送ることはありません。

1. 中心のまわりにある、選んだジャンルの施設を読み込む
2. 図形の回転と大きさを少しずつ変えながら、各頂点の理想の位置にいちばん近い施設を探す
3. 頂点の組み合わせごとにずれの大きさを計算し、ずれの小さい順に候補を並べる

施設データは OpenStreetMap から作った静的ファイル（`docs/data/`）です。

## 開発

ローカルで動かす（Windows PowerShell）:

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

→ http://localhost:8787/

施設データを作り直す（Overpass API から取得）:

```bash
powershell -ExecutionPolicy Bypass -File tools/build_data.ps1
```

`-Only shrine,temple` で特定のジャンルだけ、`-SkipFetch` で取得済みデータからの作り直しだけを行います。ジャンルを増やすときは `tools/build_data.ps1` の `$genres` と `docs/app.js` の `GENRE_GROUPS` の両方に追加します。

## クレジット・ライセンス

- 地図: [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（国土地理院）
- 住所検索: [国土地理院 地名検索API](https://msearch.gsi.go.jp/)
- 施設データ: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)。`docs/data/` には [ODbL](https://opendatacommons.org/licenses/odbl/) が適用されます
- 地図ライブラリ: [Leaflet](https://leafletjs.com/)（BSD-2-Clause）

結果はおあそびです。表示される施設の情報は OpenStreetMap の登録内容によるもので、正確さは保証されません。
