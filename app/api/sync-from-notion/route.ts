import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// -----------------------
// Notionブロック → プレーン文字列
// -----------------------
function getRichText(block: any): string {
    const type = block.type;
    const rt = block?.[type]?.rich_text ?? [];
    return rt.map((t: any) => t.plain_text).join("").trim();
}

function isHeading(block: any) {
    return ["heading_1", "heading_2", "heading_3"].includes(block.type);
}

// -----------------------
// セクション名（見出し）→ 内部キー
// ※Notion本文の見出し文言はこれに合わせる
// -----------------------
function normalizeHeading(text: string): string {
    // 余分な空白を吸収（全角も想定）
    return text.replace(/\s+/g, " ").trim();
}

type Sections = {
    card_before?: string;
    card_after?: string;
    detail_challenge?: string;
    detail_solution?: string;
    detail_results?: string[]; // 箇条書き
    detail_quote?: string;
    detail_quote_author?: string;
    detail?: string;
};

const HEADING_TO_KEY: Record<string, keyof Sections> = {
    "課題（BEFORE）": "card_before",
    "成果（AFTER）": "card_after",
    "詳細な課題": "detail_challenge",
    "解決策": "detail_solution",
    "成果": "detail_results",
    "担当者コメント": "detail_quote",
    "全文": "detail",
};

// -----------------------
// Notion本文（blocks）を取得（ページネーション対応）
// -----------------------
async function fetchBlocks(pageId: string): Promise<any[]> {
    const all: any[] = [];
    let cursor: string | undefined = undefined;

    while (true) {
        const res = await notion.blocks.children.list({
            block_id: pageId,
            start_cursor: cursor,
            page_size: 100,
        });

        all.push(...(res.results as any[]));

        if (!res.has_more) break;
        cursor = res.next_cursor ?? undefined;
    }

    return all;
}

// -----------------------
// Notionブロック列を解析して、Sectionsに詰める
// -----------------------
function parseSectionsFromBlocks(blocks: any[]): Sections {
    const out: Sections = {};
    let currentKey: keyof Sections | null = null;

    // 文章を溜めるバッファ（文字列系のセクション用）
    const buffers: Record<string, string[]> = {
        card_before: [],
        card_after: [],
        detail_challenge: [],
        detail_solution: [],
        detail_quote: [],
        detail: [],
    };

    // results は配列で保持
    const results: string[] = [];

    // コメントauthor用（担当者コメントセクション内に “— 〜” が来たら拾う）
    let quoteAuthor: string | undefined;

    for (const b of blocks) {
        // 見出しが来たらセクション切り替え
        if (isHeading(b)) {
            const heading = normalizeHeading(getRichText(b));
            const mapped = HEADING_TO_KEY[heading];
            currentKey = mapped ?? null;
            continue;
        }

        // セクション未選択ならスキップ（テンプレ外の文章は無視する運用）
        if (!currentKey) continue;

        // 箇条書きはResultsとして扱う（成果セクション中のみ）
        if (currentKey === "detail_results") {
            if (b.type === "bulleted_list_item" || b.type === "numbered_list_item") {
                const t = getRichText(b);
                if (t) results.push(t);
            } else {
                // 成果セクション内に段落で書いた場合も拾う（1行=1成果として扱う）
                const t = getRichText(b);
                if (t) results.push(t);
            }
            continue;
        }

        // 担当者コメント：quote と author を拾う
        if (currentKey === "detail_quote") {
            const t = getRichText(b);
            if (!t) continue;

            // 例： "— 山田太郎 / 株式会社〇〇 役職" を author とみなす
            if (t.startsWith("—") || t.startsWith("ー") || t.startsWith("-")) {
                quoteAuthor = t.replace(/^[-ー—]\s*/, "").trim();
                continue;
            }

            buffers.detail_quote.push(t);
            continue;
        }

        // その他（文字列系）は段落/引用などのテキストを連結
        const t = getRichText(b);
        if (!t) continue;

        if (currentKey in buffers) {
            buffers[currentKey].push(t);
        }
    }

    // バッファを結合してoutへ
    out.card_before = buffers.card_before.join("\n\n").trim() || undefined;
    out.card_after = buffers.card_after.join("\n\n").trim() || undefined;
    out.detail_challenge = buffers.detail_challenge.join("\n\n").trim() || undefined;
    out.detail_solution = buffers.detail_solution.join("\n\n").trim() || undefined;
    out.detail_quote = buffers.detail_quote.join("\n\n").trim() || undefined;
    out.detail_quote_author = quoteAuthor || undefined;
    out.detail = buffers.detail.join("\n\n").trim() || undefined;

    out.detail_results = results.length ? results : undefined;

    return out;
}

// NotionのTitle列名は環境で違うので必要なら変更
function getNotionTitle(page: any, titlePropName = "title"): string {
    const prop = page.properties?.[titlePropName];
    return (prop?.title ?? []).map((t: any) => t.plain_text).join("").trim();
}

export async function POST(req: NextRequest) {
    const secret = req.headers.get("x-cron-secret");
    if (secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const log: string[] = [];

    try {
        const { results } = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID!,
            filter: {
                and: [
                    { property: "Status", status: { equals: "公開" } },
                    { property: "Synced", checkbox: { equals: false } },
                ],
            },
        });

        log.push(`Notionヒット件数: ${results.length}`);

        for (const page of results as any[]) {
            const pageId = page.id;

            const supabaseId =
                page.properties?.["Supabase ID"]?.rich_text?.[0]?.plain_text?.trim();

            if (!supabaseId) {
                log.push(`[SKIP] page ${pageId}: Supabase ID なし`);
                continue;
            }

            // タイトル（Notionのタイトル列名に合わせる）
            const title = getNotionTitle(page, "title"); // ←必要なら "タイトル" などに変更

            // 本文ブロックを取得して解析
            const blocks = await fetchBlocks(pageId);
            const sections = parseSectionsFromBlocks(blocks);

            // 最低限 detail が無いと公開データとして弱いのでガード（任意）
            if (!sections.detail) {
                log.push(`[SKIP] page ${pageId}: 本文（全文）が空`);
                continue;
            }

            // Supabaseへ反映（Notionが編集元）
            const { data: updated, error: upErr } = await supabase
                .from("cases_articles")
                .update({
                    title: title || undefined,
                    card_before: sections.card_before ?? null,
                    card_after: sections.card_after ?? null,
                    detail_challenge: sections.detail_challenge ?? null,
                    detail_solution: sections.detail_solution ?? null,
                    detail_results: sections.detail_results ?? null,
                    detail_quote: sections.detail_quote ?? null,
                    detail_quote_author: sections.detail_quote_author ?? null,
                    detail: sections.detail ?? null,
                    status: "公開",
                })
                .eq("id", supabaseId)
                .select("published_at")
                .single();

            if (upErr) {
                log.push(`[ERROR] Supabase更新失敗: ${supabaseId} - ${upErr.message}`);
                continue;
            }

            // 同期済みにする（published_at があれば JST変換してSynced Atにも反映）
            const toJST = (iso: string) =>
                new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
                    .toISOString()
                    .replace('Z', '+09:00')

            await notion.pages.update({
                page_id: pageId,
                properties: {
                    Synced: { checkbox: true },
                    ...(updated?.published_at
                        ? { 'Synced At': { date: { start: toJST(updated.published_at) } } }
                        : {}),
                },
            });

            log.push(`[DONE] 同期完了: page ${pageId} -> supabase ${supabaseId}`);
        }

        return NextResponse.json({ ok: true, log });
    } catch (e: any) {
        console.error("sync-from-notion error:", e);
        return NextResponse.json({ error: String(e) }, { status: 500 });
    }
}