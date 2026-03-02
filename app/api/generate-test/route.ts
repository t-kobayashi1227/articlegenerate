import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@notionhq/client";
import { createClient } from "@supabase/supabase-js";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const ai = new Anthropic();
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

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

async function fetchPageText(url: string): Promise<string> {
    const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" }
    })
    if (!response.ok) {
        throw new Error(`URL取得失敗:${response.status}${url}`);
    }

    const html = await response.text();

    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, '')
        .trim()

    return text.slice(0, 6000)
}

export async function POST(req: NextRequest) {
    const secret = req.headers.get("x-cron-secret")
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: "UNauthorized" }, { status: 401 })
    }

    try {
        const { results } = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID!,
            filter: { property: "Status", status: { equals: "承認前" } }
        })

        const log: string[] = []
        log.push(`Notionヒット件数:${results.length}`)

        for (const page of results as any[]) {
            const url = page.properties["Source URL"]?.url
            if (!url) {
                log.push(`[SKIP] page ${page.id}:Source URLなし`)
                continue
            }

            const { data: existing } = await supabase
                .from("cases_articles")
                .select("id")
                .eq("notion_page_id", page.id)
                .single()
            if (existing) {
                log.push(`[SKIP] page ${page.id}:処理済み(cases_articles id:${existing.id})`)
                continue
            }

            let text: string
            try {
                text = await fetchPageText(url)
                log.push(`[OK] URL取得成功:${url}(${text.length}文字)`)
            } catch (e: any) {
                log.push(`[ERROR] URL主t区失敗:${url}-${e.message}`)
                continue
            }

            const message = await ai.messages.create({
                model: "Claude Haiku 3",
                // model:"claude-sonnet-4-5",
                max_tokens: 3000,
                messages: [{ role: "user", content: `${PROMPT}\n\n${text}` }]
            })

            const raw = (message.content[0] as any).text;
            const generated = JSON.parse(raw.replace(/```json|```/g, '').trim())

            const { data: saved, error } = await supabase
                .from("cases_articles")
                .insert({
                    notion_page_id: page.id,
                    sorce_url: url,
                    ...generated,
                    status: "承認前"
                })
                .select("id")
                .single()

            if (error) {
                log.push(`[ERROR] Supabase保存失敗:${error.message}`)
                continue
            }

            await notion.pages.update({
                page_id: page.id,
                properties: {
                    'Supabase ID': { rich_text: [{ text: { content: saved!.id } }] }
                }
            })

            log.push(`[DONE]生成完了:${generated.title}(${url})`)
        }

        return NextResponse.json({ ok: true, log });
    } catch (e) {
        console.error("generate API エラー:", e);
        return NextResponse.json({ error: String(e) }, { status: 500 });
    }
}