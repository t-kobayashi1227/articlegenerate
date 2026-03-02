import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { createClient } from '@supabase/supabase-js'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
)

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret')
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 承認完了かつNotion未反映のレコードを取得
    const { data: articles } = await supabase
        .from('articles')
        .select('notion_page_id')
        .eq('status', '承認完了')

    for (const article of articles ?? []) {
        await notion.pages.update({
            page_id: article.notion_page_id,
            properties: {
                'Status': { status: { name: '完了' } }
            }
        })
    }

    return NextResponse.json({ ok: true })
}