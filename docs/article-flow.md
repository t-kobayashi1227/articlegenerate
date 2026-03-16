# 記事作成フロー

Notion への URL 登録から、サイトへの公開までの自動化された流れ。

---

## フロー概要

```
[Notion] URL登録・Status「生成待ち」
    ↓
POST /api/generate（x-cron-secret ヘッダー必須）
    ↓
[自動] 元記事の本文取得（最大6,000文字）
    ↓
[Claude API] 記事テキスト生成
    ↓
[OpenAI API] サムネイル画像生成
    ↓
[Supabase Storage] 画像保存（article-images バケット）
    ↓
[Supabase DB] cases_articles テーブルに保存
    ↓
[Notion] ページ更新・Status「レビュー中」
    ↓
（担当者レビュー）
    ↓
[Supabase DB] status を「公開」に変更
    ↓
[サイト] /cases に表示
```

---

## 各ステップ詳細

### 01. 事前準備（手動）

- Notion データベースに新規ページを作成
- `Source URL` プロパティに元記事の URL を入力
- `Status` を **「生成待ち」** に設定

---

### 02. 元記事の本文取得（自動）

**API:** `POST /api/generate`
**認証:** リクエストヘッダー `x-cron-secret` が必須

1. Notion から `status = 生成待ち` のページを取得
2. `Source URL` の HTML を fetch
3. `<script>` / `<style>` / タグを除去してテキスト化
4. 先頭 **6,000 文字** に切り出し

---

### 03. Claude が記事を生成（AI）

**モデル:** `claude-sonnet-4-5`
**出力 JSON:**

| フィールド | 内容 |
|-----------|------|
| `title` | 記事タイトル（20字以内） |
| `card_before` | 課題サマリー（80字以内） |
| `card_after` | 成果サマリー（数値含む80字以内） |
| `detail_challenge` | 詳しい課題説明（200字程度） |
| `detail_solution` | 解決策の詳細（300字程度） |
| `detail_results` | 成果リスト（配列） |
| `detail_quote` | 担当者コメント（100字程度） |
| `detail_quote_author` | 担当者名 / 会社・役職 |
| `detail` | 全文（1,000〜1,500字） |

---

### 04. OpenAI がサムネイル画像を生成（AI）

**モデル:** `gpt-image-1`（環境変数 `OPENAI_IMAGE_MODEL` で変更可）
**入力:** タイトル + `card_before`（課題文）をプロンプトに使用
**出力:** base64 形式の画像データ

環境変数による設定:

| 変数名 | デフォルト | 説明 |
|--------|-----------|------|
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | 使用モデル |
| `OPENAI_IMAGE_SIZE` | `1024x1024` | 画像サイズ |
| `OPENAI_IMAGE_QUALITY` | `low` | 画質 |
| `OPENAI_IMAGE_FORMAT` | `png` | 出力形式 |

---

### 05. Supabase に保存（自動）

**Storage:**
1. `article-images` バケットに `temp_{page_id}.png` でアップロード
2. `cases_articles` INSERT 後、取得した `article_id` でリネーム
3. 公開 URL を取得（`getPublicUrl`）

**DB（cases_articles テーブル）:**

| カラム | 値 |
|--------|-----|
| `notion_page_id` | Notion のページ ID |
| `source_url` | 元記事 URL |
| `title` / `card_before` / ... | Claude 生成コンテンツ |
| `image_url` | Supabase Storage の公開 URL |
| `status` | `レビュー中` |

---

### 06. Notion ページを更新（自動）

- `Title` プロパティに生成タイトルを書き込み
- `Supabase ID` プロパティに `article_id` を書き込み
- `Status` を **「レビュー中」** に変更
- ページ本文に生成コンテンツ（見出し + 本文）を追記
- `image_url` が取得できた場合は URL も本文に追記

---

### 07. レビューと公開（手動）

1. Notion または Supabase で内容を確認・修正
2. 問題なければ Supabase の `status` を **「公開」** に変更
3. `/cases` ページに自動で表示される

---

## データ保存先まとめ

| データ | 保存先 |
|--------|--------|
| URL・ステータス管理 | Notion データベース |
| サムネイル画像 | Supabase Storage（`article-images` バケット） |
| 記事データ全体 | Supabase DB（`cases_articles` テーブル） |

---

## 必要な環境変数

```env
NOTION_TOKEN=
NOTION_DATABASE_ID=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=

# 任意
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_IMAGE_SIZE=1024x1024
OPENAI_IMAGE_QUALITY=low
OPENAI_IMAGE_FORMAT=png
```
