import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@notionhq/client'
import { createClient } from '@supabase/supabase-js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const ai = new Anthropic()
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const notionImageUrlPropertyName = process.env.NOTION_IMAGE_URL_PROPERTY ?? 'Thumbnail Image URL'

const PROMPT = `
あなたはBtoB向けサービスサイトの事例記事ライターです。
提供された記事テキストを分析し、以下のJSON形式のみで回答してください。
説明文やMarkdownコードブロック（\`\`\`json など）は不要です。JSONのみ出力してください。

{
  "title": "記事タイトル（20字以内）",
  "category": "記事カテゴリ（例: 教育 × AI）（20字以内）",
  "client": "業界名（企業名は出さずぼかして表現。例: 新潟県内 マーケティング企業）",
  "challenge": "導入前の課題の要約（100字程度）",
  "solution": "解決策・成果の要約（数値を含め100字程度）",
  "results": ["具体的な成果1（数値含む）", "具体的な成果2（数値含む）", "具体的な成果3", "具体的な成果4"],
  "quote_text": "担当者の声・コメント（100字程度、自然な話し言葉で）",
  "quote_author": "担当者の役職（例: 営業部長）",
  "quote_role": "企業種類（例: マーケティング企業）",
  "detail_challenge": "詳しい課題説明（300字程度）",
  "detail_solution": "解決策の詳細（300字程度）",
  "detail": "読み物としての全文（1000〜1500字）。課題背景→解決策の詳細→成果→担当者の声の順で自然な文章で。箇条書き不可。"
}
`

// URLからテキストを直接取得する関数
async function fetchPageText(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    })

    if (!response.ok) {
        throw new Error(`URL取得失敗: ${response.status} ${url}`)
    }

    const html = await response.text()

    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()

    return text.slice(0, 6000)
}

// OpenAI Images API で画像を生成し、data URL を返す
async function generateArticleImage(title: string, summary: string): Promise<string | null> {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set')
    }

    const prompt = `BtoB企業の導入事例記事のサムネイル用写真。テーマ：「${title}」。内容：${summary}。スタイル：フォトリアリスティックなビジネス写真でプロフェッショナルな雰囲気。テキスト・ロゴ・イラストは含めない。信頼感があり落ち着いたトーン。`

    const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
            model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1',
            prompt,
            size: process.env.OPENAI_IMAGE_SIZE ?? '1024x1024',
            quality: process.env.OPENAI_IMAGE_QUALITY ?? 'low',
            output_format: process.env.OPENAI_IMAGE_FORMAT ?? 'png',
        }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI image generation failed: ${response.status} ${errorText}`)
    }

    const payload = await response.json() as {
        data?: Array<{ b64_json?: string }>
    }
    const imageBase64 = payload.data?.[0]?.b64_json
    if (imageBase64) {
        const format = process.env.OPENAI_IMAGE_FORMAT ?? 'png'
        return `data:image/${format};base64,${imageBase64}`
    }

    return null
}

function getStorageFileInfo(base64DataUrl: string, articleId: string) {
    const [meta] = base64DataUrl.split(',')
    const mimeType = meta.match(/:(.*?);/)?.[1] ?? 'image/png'
    const ext = mimeType.split('/')[1] ?? 'png'

    return {
        mimeType,
        ext,
        fileName: `${articleId}.${ext}`,
    }
}

// ★追加: base64画像をSupabase Storageにアップロードして永続URLを返す
async function uploadImageToSupabase(base64DataUrl: string, articleId: string): Promise<string | null> {
    // "data:image/png;base64,xxxx" → MIMEタイプとバイナリを分離
    const [, base64Data] = base64DataUrl.split(',')
    const { mimeType, fileName } = getStorageFileInfo(base64DataUrl, articleId)

    // base64 → Uint8Array に変換
    const binaryStr = atob(base64Data)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i)
    }

    const { error } = await supabase.storage
        .from('article-images')        // ← Supabaseで作成するバケット名
        .upload(fileName, bytes, {
            contentType: mimeType,
            upsert: true,
        })

    if (error) {
        throw new Error(`Storage upload失敗: ${error.message}`)
    }

    const { data } = supabase.storage
        .from('article-images')
        .getPublicUrl(fileName)

    return data.publicUrl
}

export async function POST(req: NextRequest) {
    // 不正アクセス防止
    const secret = req.headers.get('x-cron-secret')
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        // Notionから「生成待ち」ページを取得
        const { results } = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID!,
            filter: { property: 'Status', status: { equals: '生成待ち' } }
        })

        const log: string[] = []
        log.push(`Notionヒット件数: ${results.length}`)

        for (const page of results as any[]) {
            const url = page.properties['Source URL']?.url
            if (!url) {
                log.push(`[SKIP] page ${page.id}: Source URL なし`)
                continue
            }

            // すでに処理済みならスキップ
            const { data: existing } = await supabase
                .from('cases_articles')
                .select('id')
                .eq('notion_page_id', page.id)
                .single()
            if (existing) {
                log.push(`[SKIP] page ${page.id}: 処理済み (cases_articles id: ${existing.id})`)
                continue
            }

            // URLから本文を取得
            let text: string
            try {
                text = await fetchPageText(url)
                log.push(`[OK] URL取得成功: ${url} (${text.length}文字)`)
            } catch (e: any) {
                log.push(`[ERROR] URL取得失敗: ${url} - ${e.message}`)
                continue
            }

            // Claude APIで記事生成
            const message = await ai.messages.create({
                model: 'claude-sonnet-4-5',
                max_tokens: 3000,
                messages: [{ role: 'user', content: `${PROMPT}\n\n${text}` }]
            })

            const raw = (message.content[0] as any).text
            const generated = JSON.parse(raw.replace(/```json|```/g, '').trim())

            // OpenAI Images API で画像を生成
            let imagePublicUrl: string | null = null
            let imageFileExt: string | null = null
            try {
                log.push(`[INFO] 画像生成開始: ${generated.title}`)
                const base64Image = await generateArticleImage(generated.title, generated.challenge)
                if (base64Image) {
                    // 一時的なIDでSupabase Storageに保存（後でarticle IDに差し替え）
                    const tempId = `temp_${page.id}`
                    imageFileExt = getStorageFileInfo(base64Image, tempId).ext
                    imagePublicUrl = await uploadImageToSupabase(base64Image, tempId)
                    log.push(`[OK] 画像生成・保存成功`)
                } else {
                    log.push(`[WARN] 画像生成: 画像データなし（スキップ）`)
                }
            } catch (e: any) {
                // 画像生成失敗は記事保存を止めない
                log.push(`[WARN] 画像生成失敗（スキップ）: ${e.message}`)
            }

            // Supabaseに保存（image_urlも一緒に保存）
            const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
            const { data: saved, error } = await supabase
                .from('cases_articles')
                .insert({
                    notion_page_id: page.id,
                    source_url: url,
                    ...generated,
                    image_url: imagePublicUrl,   // ★追加
                    status: 'レビュー中',
                    created_at: jstNow,
                })
                .select('id')
                .single()

            if (error) {
                log.push(`[ERROR] Supabase保存失敗: ${error.message}`)
                continue
            }

            // ★追加: 画像ファイルをarticle IDで正式リネーム
            if (imagePublicUrl && saved && imageFileExt) {
                try {
                    const tempFileName = `temp_${page.id}.${imageFileExt}`
                    const finalFileName = `${saved.id}.${imageFileExt}`
                    await supabase.storage.from('article-images').move(tempFileName, finalFileName)

                    // Supabaseのimage_urlも正式URLに更新
                    const { data: finalUrlData } = supabase.storage
                        .from('article-images')
                        .getPublicUrl(finalFileName)

                    await supabase
                        .from('cases_articles')
                        .update({ image_url: finalUrlData.publicUrl })
                        .eq('id', saved.id)

                    imagePublicUrl = finalUrlData.publicUrl
                    log.push(`[OK] 画像ファイルをarticle IDでリネーム完了`)
                } catch (e: any) {
                    log.push(`[WARN] 画像リネーム失敗（temp名のまま）: ${e.message}`)
                }
            }

            // NotionにSupabase IDとタイトル、Statusを書き戻す
            const notionProperties: Record<string, any> = {
                'Title': { title: [{ text: { content: generated.title } }] },
                'Supabase ID': { rich_text: [{ text: { content: saved!.id } }] },
                'Status': { status: { name: 'レビュー中' } },
            }
            const imageUrlProperty = page.properties?.[notionImageUrlPropertyName]
            if (imageUrlProperty?.type === 'url') {
                notionProperties[notionImageUrlPropertyName] = { url: imagePublicUrl }
            } else if (imagePublicUrl) {
                log.push(`[WARN] Notion URLプロパティ未設定: ${notionImageUrlPropertyName}`)
            }

            await notion.pages.update({
                page_id: page.id,
                properties: notionProperties
            })

            // Notionページ本文に生成コンテンツを書き込む
            const resultBlocks = (generated.results as string[]).map((r) => ({
                type: 'bulleted_list_item' as const,
                bulleted_list_item: { rich_text: [{ type: 'text' as const, text: { content: r } }] }
            }))

            await notion.blocks.children.append({
                block_id: page.id,
                children: [
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'カテゴリ / クライアント' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: `${generated.category}｜${generated.client}` } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'CHALLENGE' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.challenge } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'SOLUTION' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.solution } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'DETAIL CHALLENGE' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail_challenge } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'DETAIL SOLUTION' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail_solution } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'RESULTS' } }] } },
                    ...resultBlocks,
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '担当者の声' } }] } },
                    { type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: `${generated.quote_text}\n— ${generated.quote_author}（${generated.quote_role}）` } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '全文' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail } }] } },
                    // サムネイル画像をNotionにインライン表示
                    ...(imagePublicUrl ? [
                        { type: 'heading_2' as const, heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'サムネイル画像' } }] } },
                        {
                            type: 'image' as const,
                            image: {
                                type: 'external' as const,
                                external: { url: imagePublicUrl },
                            },
                        },
                    ] : []),
                ] as any[]
            })

            log.push(`[DONE] 生成完了: ${generated.title} (${url})`)
        }

        console.log('[generate] log:', log.join('\n'))
        return NextResponse.json({ ok: true, log })

    } catch (e) {
        console.error('generate API エラー:', e)
        return NextResponse.json({ error: String(e) }, { status: 500 })
    }
}
