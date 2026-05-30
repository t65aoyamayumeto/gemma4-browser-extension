# 検証レポート: gemma4-browser-extension

**対象:** https://github.com/nico-martin/gemma4-browser-extension @ main (v0.2.1)
**検証日:** 2026-05-31
**検証環境:** macOS / Node + pnpm@10.28.1（corepack 経由）
**実施範囲:** Phase 1（静的解析）, Phase 2（ビルド）, Phase 5（セキュリティ/コードレビュー）
**未実施:** Phase 3/4（WebGPU + Chrome 実機が必要 → 手順は末尾チェックリスト参照）

---

## サマリ

| フェーズ | 結果 | 備考 |
|---|---|---|
| 型チェック (`tsc --noEmit`) | ✅ PASS | エラー 0 |
| Lint (`eslint src/`) | ❌ FAIL | 設定不備で実走不可（下記 H-1, H-2） |
| ビルド (`pnpm build`) | ✅ PASS | `dist/` 生成成功、Manifest V3 準拠 |
| セキュリティレビュー | ⚠️ 要対応 | XSS 1件(M)、過大パーミッション等 |

総合判定: **条件付き合格**。ビルド・型は健全だが、Lint 設定が壊れており CI 不能。XSS とパーミッション周りに改善余地。

---

## Phase 1: 静的解析

### 型チェック — PASS
```
pnpm exec tsc --noEmit → exit 0
```
型エラーなし。`@types/chrome` を用いた Chrome API 型付けも問題なし。

### Lint — FAIL（実走不可）

| ID | 重大度 | 内容 |
|---|---|---|
| **H-1** | HIGH | `eslint.config.js` が `globals` を import しているが `package.json` に依存宣言なし。clean install 後 `ERR_MODULE_NOT_FOUND` で Lint が起動しない。CI/開発者環境で即破綻。 |
| **H-2** | HIGH | `globals` を手動追加後も、flat config で `plugins` が文字列配列として扱われ `A config object has a "plugins" key defined as an array of strings` エラー。extends 内の plugin config（`eslint-plugin-react-refresh` 等）のバージョンドリフトと flat-config 非互換。Lint が一切通らない。 |

> いずれも「lockfile 通りに install しても Lint が動かない」状態。`globals` を devDependencies に追加し、ESLint 設定を導入バージョンに合わせて修正する必要がある。

---

## Phase 2: ビルド検証 — PASS

```
pnpm build  (tsc && vite build) → 成功
```

### 生成物 (`dist/`)

| ファイル | サイズ | gzip | 評価 |
|---|---|---|---|
| `background.js` | 556.51 kB | 164.06 kB | ⚠️ 500kB 警告超過 |
| `assets/sidebar-*.js` | 324.63 kB | 104.58 kB | 妥当 |
| `assets/ort-wasm-simd-threaded.asyncify-*.wasm` | 23,567 kB | 5,757 kB | ONNX Runtime WASM（想定内） |
| `content.js` | 1.20 kB | 0.75 kB | 良好（inline 済み） |
| `sidebar.html` / icons / css | — | — | 正常配置 |

- Manifest V3 準拠（`manifest_version: 3`、service_worker type:module）。
- マルチエントリ（background / sidebar / content）が個別バンドル。
- **M-3（MEDIUM）**: `background.js` が 556kB で Vite の 500kB 警告。Transformers.js を同梱しているため。動的 import / manualChunks で分割余地あり（機能影響はなし）。

---

## Phase 5: セキュリティ & コードレビュー

### パーミッション監査

実ビルド `dist/manifest.json`:
```json
"permissions": ["sidePanel", "storage", "scripting", "tabs"],
"host_permissions": ["http://*/*", "https://*/*"]
```

| ID | 重大度 | 内容 |
|---|---|---|
| **M-1** | MEDIUM | `host_permissions` が全 HTTP/HTTPS サイト。全ページに content script を `document_idle` で注入し、`chrome.scripting.executeScript` で meta description を抽出。設計上必要だが攻撃面は最大。README は `activeTab` を挙げるが実際の manifest には無く、**README と実装が乖離**（`activeTab` なし／`host_permissions` でフルアクセス）。 |
| 情報 | INFO | `tabs` + `scripting` + 全 host で、全タブの URL・タイトル・本文にアクセス可能。オンデバイス処理で外部送信はないが、権限粒度は粗い。 |

### CSP

```
"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
```
- `script-src` に `unsafe-inline` なし → インライン script / イベントハンドラ実行はブロック（XSS 緩和として有効）。
- **L-1（LOW）**: `default-src` 未指定のため `img-src`/`connect-src` 等が無制限。後述 XSS と組み合わせると `<img src>` 経由のデータ送出余地。`default-src 'self'` の明示を推奨。

### XSS

| ID | 重大度 | 内容 |
|---|---|---|
| **M-2** | MEDIUM | `src/sidebar/chat/MessageContent.tsx:27` で `showdown.makeHtml(content)` の結果を `dangerouslySetInnerHTML` で描画。showdown はデフォルトで生 HTML をサニタイズしない。`content` は LLM 出力で、`ask_website` 経由で**任意 Web ページの本文が文脈に混入**しうる。CSP により script 実行は阻止されるが、`default-src` 未設定のため img beacon 等は通る。`DOMPurify` 等でのサニタイズ、または showdown の `setOption('simplifiedAutoLink' 等)` ＋ サニタイズ層を推奨。 |

### メッセージング検証

- `background.ts` / `content.ts` の `chrome.runtime.onMessage` リスナは `message.type` で分岐するのみで、**ペイロードのスキーマ検証なし**（`message.tools`, `message.prompt`, `message.payload.id` 等を未検証で使用）。拡張内通信に限られるため実害は低いが、グローバル指針の「境界での入力検証（Zod 等）」には未準拠。
- **M-1 と同根**: content script は全オリジンで動くため、ページ側スクリプトからの `chrome.runtime.sendMessage` は届かない（拡張 ID 必要）が、`externally_connectable` 未設定で外部接続は既定拒否。良好。

### コード品質メモ

| ID | 重大度 | 内容 |
|---|---|---|
| **L-2** | LOW | `src/content/utils/highlightParagraph.ts:12` に `console.log(element)` がデバッグ残存。グローバル規約「本番に console.log を残さない」に違反。 |
| INFO | — | `Agent.ts` は 428 行で規約上限 800 以内。`runAgent` 内の messages 配列の逆順走査・in-place 代入（`this.messages[i] = {...}`）は局所的だが、グローバル規約の不変性原則からは spread での再構築が望ましい。 |
| 良 | — | ツール実行は try/catch でエラー文字列を返し、エージェントループがクラッシュしない設計。`extractToolCalls` は複数のツール呼び出しフォーマット（標準 `<tool_call>`、Gemma 独自、bare フォールバック）に対応し堅牢。 |
| 良 | — | `cosineSimilarity` は次元不一致で 0 を返すガードあり。RAG の topK スコアリングは妥当。 |

---

## 指摘一覧（重大度順）

| ID | 重大度 | 区分 | 概要 | 推奨対応 |
|---|---|---|---|---|
| H-1 | HIGH | ビルド | `globals` 依存未宣言で Lint 起動不可 | devDependencies に `globals` 追加 |
| H-2 | HIGH | ビルド | flat config の plugin 非互換で Lint 全滅 | ESLint 設定を導入版に合わせ修正 |
| M-1 | MEDIUM | セキュリティ | 全 host パーミッション・README 乖離 | 権限の必要性再評価／README 整合 |
| M-2 | MEDIUM | セキュリティ | showdown 出力の未サニタイズ描画 | DOMPurify 等でサニタイズ |
| M-3 | MEDIUM | パフォーマンス | background.js 556kB | 動的 import で分割 |
| L-1 | LOW | セキュリティ | CSP `default-src` 未指定 | `default-src 'self'` 明示 |
| L-2 | LOW | 品質 | console.log 残存 | 削除 |

---

## 未実施フェーズの手動チェックリスト（Chrome + WebGPU 環境で実施）

前提: Chrome 113+ / WebGPU 有効 / `~/work/gemma4-browser-extension/dist` を「パッケージ化されていない拡張機能を読み込む」で追加。

### 初回セットアップ
- [ ] 拡張アイコンクリックでサイドパネルが開く
- [ ] `onnx-community/gemma-4-E2B-it-ONNX` の自動 DL と進捗表示（`DOWNLOAD_PROGRESS`）が更新される
- [ ] ロード完了後にチャット入力が有効化

### タブ管理ツール
- [ ] 「開いているタブを教えて」→ 全タブの title/url/description 列挙（`get_open_tabs`）
- [ ] 「タブ N に移動」→ `go_to_tab` で切替・ウィンドウ focus
- [ ] 「example.com を開いて」→ `open_url` で新規タブ
- [ ] 「そのタブを閉じて」→ `close_tab`

### RAG / ハイライト
- [ ] 任意記事ページで「概要は?」→ `ask_website` が関連段落を引用（cosine 類似度 topK）
- [ ] 「その最初の項目をハイライト」→ `highlight_website_element` で対象に黄色背景＋スクロール
- [ ] M-2 検証: 悪意ある HTML/markdown を含むページで XSS が発火しないこと（CSP でブロックされるか）

### 履歴ベクトル検索
- [ ] 数ページ閲覧後「先週見た〇〇の記事」→ `find_history` が意味的にヒット（IndexedDB）
- [ ] 時間フィルタ系クエリが機能

### エラー耐性 / ライフサイクル
- [ ] WebGPU 無効環境でロード → エラーが UI に表示（クラッシュしない）
- [ ] Service Worker 休止後の再送信 → Worker 再起動し応答（`getAgent()` の再生成挙動確認）

### パフォーマンス計測
- [ ] モデルロード時間（初回 / キャッシュ後）
- [ ] 推論レイテンシ（`tok/s` メトリクスがUIに表示される）
- [ ] `chrome://task-manager` でメモリ（モデル込み < 2GB 目安）

---

## 再現コマンド

```bash
cd ~/work/gemma4-browser-extension
corepack pnpm@10.28.1 install
corepack pnpm@10.28.1 exec tsc --noEmit     # ✅ PASS
corepack pnpm@10.28.1 exec eslint src/      # ❌ FAIL (H-1/H-2)
corepack pnpm@10.28.1 run build             # ✅ PASS → dist/
```
