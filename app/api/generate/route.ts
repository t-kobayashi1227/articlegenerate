import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { Client } from '@notionhq/client'
import { createClient } from '@supabase/supabase-js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const ai = new Anthropic()
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

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

    // HTMLタグを除去してテキストだけ抽出
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')   // scriptタグ除去
        .replace(/<style[\s\S]*?<\/style>/gi, '')      // styleタグ除去
        .replace(/<[^>]+>/g, ' ')                      // その他のHTMLタグ除去
        .replace(/&nbsp;/g, ' ')                       // HTMLエンティティ変換
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')                          // 連続スペース・改行を整理
        .trim()

    return text.slice(0, 6000) // Claude APIに渡す文字数を制限
}

export async function POST(req: NextRequest) {
    // 不正アクセス防止
    const secret = req.headers.get('x-cron-secret')
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        // Notionから「承認前」ページを取得
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

            // URLから本文を直接取得
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

            // JSONをパース（```json ``` で囲まれていても対応）
            const raw = (message.content[0] as any).text
            const generated = JSON.parse(raw.replace(/```json|```/g, '').trim())

            // Supabaseに保存
            const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
            const { data: saved, error } = await supabase
                .from('cases_articles')
                .insert({
                    notion_page_id: page.id,
                    source_url: url,
                    ...generated,
                    status: 'レビュー中',
                    created_at: jstNow,
                })
                .select('id')
                .single()

            if (error) {
                log.push(`[ERROR] Supabase保存失敗: ${error.message}`)
                continue
            }

            const today = new Date().toISOString().split('T')[0];
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
                ] as any[]
            })

            log.push(`[DONE] 生成完了: ${generated.title} (${url})`)
        }

        return NextResponse.json({ ok: true, log })

    } catch (e) {
        console.error('generate API エラー:', e)
        return NextResponse.json({ error: String(e) }, { status: 500 })
    }
}