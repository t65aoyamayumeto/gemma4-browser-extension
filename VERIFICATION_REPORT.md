# 検証レポート: gemma4-browser-extension フォーク

**対象:** [nico-martin/gemma4-browser-extension](https://github.com/nico-martin/gemma4-browser-extension) @ main (v0.2.1)  
**検証日:** 2026-05-31  
**検証環境:** macOS / Node + pnpm@10.28.1  
**このフォークの変更コミット:** `fb6f3fc`, `1c021b9`, `42109e2`

---

## サマリ

| チェック項目 | 元リポジトリ | このフォーク |
|---|---|---|
| 型チェック (`tsc --noEmit`) | ✅ PASS | ✅ PASS |
| Lint (`eslint src/`) | ❌ FAIL | ✅ PASS（設定修正済み） |
| ビルド (`npm run build`) | ✅ PASS | ✅ PASS |
| XSS 対策 | ❌ 未サニタイズ | ✅ DOMPurify 適用済み |
| URLスキーム検証 | ❌ なし | ✅ http/https のみ許可 |
| デバッグコード残存 | ❌ あり | ✅ 削除済み |

---

## 元リポジトリで確認した問題と対応

### 1. XSS（クロスサイトスクリプティング）— 対応済み

**問題:** `src/sidebar/chat/MessageContent.tsx` で `showdown.makeHtml()` の出力を `dangerouslySetInnerHTML` に渡していたが、HTML のサニタイズが行われていなかった。LLM の出力や `ask_website` で取得したページ内容に悪意ある HTML が含まれていた場合に XSS が成立しうる状態だった。

**対応:** `DOMPurify.sanitize()` を適用してから描画するよう修正。

---

### 2. `open_url` ツールの URL スキーム未検証 — 対応済み

**問題:** `src/background/tools/tabActions.ts` の `openUrlTool` が受け取った URL を検証せずに `chrome.tabs.create()` へ渡していた。`javascript:` や `data:` スキームの URL が渡された場合の挙動が未定義だった。

**対応:** `new URL()` でパース後、`http:` / `https:` 以外のスキームはエラーメッセージを返して処理を中断するよう修正。

---

### 3. ESLint 設定不備 — 対応済み

**問題:** `eslint.config.js` が `globals` パッケージを `import` しているにもかかわらず `package.json` の `devDependencies` に宣言がなく、クリーンインストール後に Lint が起動しない状態だった。また ESLint 9.x の flat config フォーマットとの非互換もあり、13 件の lint エラーが存在していた。

**対応:** `globals` を `devDependencies` に追加し、flat config フォーマットを ESLint 9.x に合わせて修正。13 件の lint エラーをすべて解消。

---

### 4. デバッグコード残存 — 対応済み

**問題:** `src/content/utils/highlightParagraph.ts` に `console.log(element)` が本番コードに残存していた。

**対応:** 該当行を削除。

---

### 5. パーミッションの説明不足 — 対応済み

**問題:** `manifest.json` の `host_permissions: ["http://*/*", "https://*/*"]` について README に説明がなく、なぜ全サイトへのアクセスが必要なのかが不明だった。

**対応:** README の `## Permissions` セクションに各パーミッションの必要理由を記載。

---

## エージェント動作の修正

元リポジトリのエージェント実装では以下のケースで正しく動作しない問題があった。

| 問題 | 対応 |
|------|------|
| タブIDを数値ではなく文字列で渡したとき `go_to_tab`/`close_tab` が失敗する | 文字列→数値変換を追加 |
| 複数ツールを連続して呼び出す必要があるタスク（例: タブ番号からIDを特定して移動）が途中で止まる | 継続プロンプトを修正してチェーン呼び出しを許可 |
| `ask_website` が明示的な「このページ」指示がない場合に呼ばれない | システムプロンプトに明示的なガイダンスを追加 |
| `tok/s` メトリクスが常に 0 と表示される | `Tensor.dims` からトークン数を正しく読み取るよう修正 |

---

## 未検証項目（実機環境が必要）

- WebGPU 無効環境でのエラー表示
- Service Worker 休止後の再起動挙動
- モデルロード時間・メモリ使用量の計測
