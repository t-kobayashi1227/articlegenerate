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
    category?: string;
    client?: string;
    challenge?: string;
    solution?: string;
    results?: string[]; // 箇条書き
    quote_text?: string;
    quote_author?: string;
    quote_role?: string;
    detail_challenge?: string;
    detail_solution?: string;
    detail?: string;
};

const HEADING_TO_KEY: Record<string, keyof Sections> = {
    "カテゴリ / クライアント": "category", // category と client を同時に解析
    "課題の要約": "challenge",
    "解決策・成果の要約": "solution",
    "詳細な課題": "detail_challenge",
    "解決策の詳細": "detail_solution",
    "成果": "results",
    "担当者の声": "quote_text",
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

    // 文字列系セクションのバッファ
    const buffers: Record<string, string[]> = {
        category: [],
        challenge: [],
        solution: [],
        detail_challenge: [],
        detail_solution: [],
        quote_text: [],
        detail: [],
    };

    // 成果は配列で保持
    const results: string[] = [];

    for (const b of blocks) {
        // 見出しが来たらセクション切り替え
        if (isHeading(b)) {
            const heading = normalizeHeading(getRichText(b));
            const mapped = HEADING_TO_KEY[heading];
            currentKey = mapped ?? null;
            continue;
        }

        // セクション未選択ならスキップ
        if (!currentKey) continue;

        // 成果セクション：箇条書き・段落どちらも1行=1成果
        if (currentKey === "results") {
            const t = getRichText(b);
            if (t) results.push(t);
            continue;
        }

        // 担当者の声：quote ブロック内に `quote_text\n— quote_author（quote_role）` 形式で入る
        if (currentKey === "quote_text") {
            const t = getRichText(b);
            if (!t) continue;

            // quote_text と author/role が改行区切りで入っている場合を考慮
            const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
                // "— 役職（企業種類）" の行を author / role に分解
                if (line.startsWith("—") || line.startsWith("ー") || line.startsWith("-")) {
                    const authorPart = line.replace(/^[-ー—]\s*/, "").trim();
                    // 「役職（企業種類）」形式をパース
                    const roleMatch = authorPart.match(/^(.+?)（(.+?)）\s*$/);
                    if (roleMatch) {
                        out.quote_author = roleMatch[1].trim() || undefined;
                        out.quote_role = roleMatch[2].trim() || undefined;
                    } else {
                        out.quote_author = authorPart || undefined;
                    }
                } else {
                    buffers.quote_text.push(line);
                }
            }
            continue;
        }

        // カテゴリ / クライアント：「category｜client」形式の段落を分解
        if (currentKey === "category") {
            const t = getRichText(b);
            if (!t) continue;
            const parts = t.split("｜").map((p) => p.trim());
            if (parts.length >= 2) {
                buffers.category.push(parts[0]);
                out.client = parts.slice(1).join("｜").trim() || undefined;
            } else {
                buffers.category.push(t);
            }
            continue;
        }

        // その他の文字列系セクション
        const t = getRichText(b);
        if (!t) continue;
        if (currentKey in buffers) {
            (buffers[currentKey as string] as string[]).push(t);
        }
    }

    // バッファを結合して out へ
    out.category = buffers.category.join("\n\n").trim() || undefined;
    out.challenge = buffers.challenge.join("\n\n").trim() || undefined;
    out.solution = buffers.solution.join("\n\n").trim() || undefined;
    out.detail_challenge = buffers.detail_challenge.join("\n\n").trim() || undefined;
    out.detail_solution = buffers.detail_solution.join("\n\n").trim() || undefined;
    out.quote_text = buffers.quote_text.join("\n\n").trim() || undefined;
    out.detail = buffers.detail.join("\n\n").trim() || undefined;
    out.results = results.length ? results : undefined;

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
        // ── Step 0: 全レコードをNotionと照合 ──────────────────────────────────
        // ① Supabase「公開」かつNotion「公開以外」→ 非公開化
        // ② Supabase「公開以外」かつNotion「公開」→ 再公開（SyncedをfalseにしてStep 1に委譲）
        // ③ Notion「公開」でタイトルが変わっていたら更新
        const { data: allRecords } = await supabase
            .from("cases_articles")
            .select("id, notion_page_id, title, status")
            .not("notion_page_id", "is", null);

        for (const record of allRecords ?? []) {
            const pageId = record.notion_page_id as string;

            let notionPage: any;
            try {
                notionPage = await notion.pages.retrieve({ page_id: pageId });
            } catch {
                log.push(`[WARN] Notion page取得失敗: ${pageId}`);
                continue;
            }

            const notionStatus: string =
                notionPage.properties?.["Status"]?.status?.name ?? "";
            const notionTitle = getNotionTitle(notionPage, "title");
            const isPublishedInSupabase = record.status === "公開";
            const isPublishedInNotion = notionStatus === "公開";

            // ② 再公開：Supabaseが「公開以外」→ Notionが「公開」
            if (!isPublishedInSupabase && isPublishedInNotion) {
                // NotionのSyncedをfalseに戻す → Step 1が内容ごと再同期する
                await notion.pages.update({
                    page_id: pageId,
                    properties: { Synced: { checkbox: false } },
                });
                log.push(`[REPUBLISH] supabase ${record.id}: "${record.status}" → 再公開待ち（Step 1へ委譲）`);
                continue;
            }

            // ① 非公開化：Supabaseが「公開」→ Notionが「公開以外」
            if (isPublishedInSupabase && !isPublishedInNotion) {
                const { error: updateErr } = await supabase
                    .from("cases_articles")
                    .update({ status: notionStatus || "非公開" })
                    .eq("id", record.id);
                if (updateErr) {
                    log.push(`[ERROR] Supabase更新失敗: ${record.id} - ${updateErr.message}`);
                } else {
                    log.push(`[UNPUBLISH] supabase ${record.id}: "公開" → "${notionStatus || "非公開"}"`);
                }
                continue;
            }

            // ③ タイトル更新：両方「公開」でタイトルが変わっていたら更新
            if (isPublishedInSupabase && isPublishedInNotion && notionTitle && notionTitle !== record.title) {
                const { error: updateErr } = await supabase
                    .from("cases_articles")
                    .update({ title: notionTitle })
                    .eq("id", record.id);
                if (updateErr) {
                    log.push(`[ERROR] Supabase更新失敗: ${record.id} - ${updateErr.message}`);
                } else {
                    log.push(`[TITLE] supabase ${record.id}: "${record.title}" → "${notionTitle}"`);
                }
            }
        }

        // ── Step 1: Notionの「公開」かつ「Synced=false」を全フィールド同期 ──
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
                    category: sections.category ?? null,
                    client: sections.client ?? null,
                    challenge: sections.challenge ?? null,
                    solution: sections.solution ?? null,
                    results: sections.results ?? null,
                    quote_text: sections.quote_text ?? null,
                    quote_author: sections.quote_author ?? null,
                    quote_role: sections.quote_role ?? null,
                    detail_challenge: sections.detail_challenge ?? null,
                    detail_solution: sections.detail_solution ?? null,
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