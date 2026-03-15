import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@notionhq/client'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const ai = new Anthropic()
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)
// ★追加: Gemini クライアント（Nano Banana）
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

const PROMPT = `
あなたはBtoB向けサービスサイトの事例記事ライターです。
提供された記事テキストを分析し、以下のJSON形式のみで回答してください。
説明文やMarkdownは不要です。JSONのみ出力してください。

{
  "title": "記事タイトル（20字以内）",
  "card_before": "課題（BEFORE）の要約（80字以内）",
  "card_after": "成果（AFTER）の要約（数値含む80字以内）",
  "detail_challenge": "詳しい課題説明（200字程度）",
  "detail_solution": "解決策の詳細（300字程度）",
  "detail_results": ["成果1", "成果2", "成果3", "成果4"],
  "detail_quote": "担当者コメント（100字程度）",
  "detail_quote_author": "担当者名 / 会社・役職",
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

// ★追加: Nano Banana（Gemini 2.5 Flash Image）で画像を生成し、base64を返す
async function generateArticleImage(title: string, summary: string): Promise<string | null> {
    const prompt = `BtoB企業の導入事例記事のサムネイル画像。テーマ：「${title}」。内容：${summary}。プロフェッショナルで清潔感があるビジネス向けイラスト。テキストや文字は含めない。明るく信頼感のある配色。`

    const response = await gemini.models.generateContent({
        model: 'gemini-2.0-flash-exp',
        contents: prompt,
        config: {
            responseModalities: ['TEXT', 'IMAGE'],
        },
    })

    // レスポンスから画像データ（base64）を取り出す
    const parts = response.candidates?.[0]?.content?.parts ?? []
    for (const part of parts as any[]) {
        if (part.inlineData?.mimeType?.startsWith('image/')) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
        }
    }
    return null
}

// ★追加: base64画像をSupabase Storageにアップロードして永続URLを返す
async function uploadImageToSupabase(base64DataUrl: string, articleId: string): Promise<string | null> {
    // "data:image/png;base64,xxxx" → MIMEタイプとバイナリを分離
    const [meta, base64Data] = base64DataUrl.split(',')
    const mimeType = meta.match(/:(.*?);/)?.[1] ?? 'image/png'
    const ext = mimeType.split('/')[1] ?? 'png'
    const fileName = `${articleId}.${ext}`

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

            // ★追加: Nano Banana で画像を生成
            let imagePublicUrl: string | null = null
            try {
                log.push(`[INFO] 画像生成開始: ${generated.title}`)
                const base64Image = await generateArticleImage(generated.title, generated.card_before)
                if (base64Image) {
                    // 一時的なIDでSupabase Storageに保存（後でarticle IDに差し替え）
                    const tempId = `temp_${page.id}`
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
            if (imagePublicUrl && saved) {
                try {
                    const tempFileName = `temp_${page.id}.png`
                    const finalFileName = `${saved.id}.png`
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
            await notion.pages.update({
                page_id: page.id,
                properties: {
                    'Title': { title: [{ text: { content: generated.title } }] },
                    'Supabase ID': { rich_text: [{ text: { content: saved!.id } }] },
                    'Status': { status: { name: 'レビュー中' } },
                }
            })

            // Notionページ本文に生成コンテンツを書き込む
            const resultBlocks = (generated.detail_results as string[]).map((r) => ({
                type: 'bulleted_list_item' as const,
                bulleted_list_item: { rich_text: [{ type: 'text' as const, text: { content: r } }] }
            }))

            await notion.blocks.children.append({
                block_id: page.id,
                children: [
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '課題（BEFORE）' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.card_before } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '成果（AFTER）' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.card_after } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '詳細な課題' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail_challenge } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '解決策' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail_solution } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '成果' } }] } },
                    ...resultBlocks,
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '担当者コメント' } }] } },
                    { type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: `${generated.detail_quote}\n— ${generated.detail_quote_author}` } }] } },
                    { type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '全文' } }] } },
                    { type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: generated.detail } }] } },
                    // ★追加: 画像URLをNotionに記録（生成できた場合のみ）
                    ...(imagePublicUrl ? [
                        { type: 'heading_2' as const, heading_2: { rich_text: [{ type: 'text' as const, text: { content: 'サムネイル画像URL' } }] } },
                        { type: 'paragraph' as const, paragraph: { rich_text: [{ type: 'text' as const, text: { content: imagePublicUrl } }] } },
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