import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

const notionImageUrlPropertyName = process.env.NOTION_IMAGE_URL_PROPERTY ?? "Thumbnail Image URL";

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
    thumbnail_image_url?: string; // Notionブロックから取得した画像URL
};

const HEADING_TO_KEY: Record<string, keyof Sections> = {
    "カテゴリ / クライアント": "category", // category と client を同時に解析
    "CHALLENGE": "challenge",
    "SOLUTION": "solution",
    "DETAIL CHALLENGE": "detail_challenge",
    "DETAIL SOLUTION": "detail_solution",
    "RESULTS": "results",
    "担当者の声": "quote_text",
    "全文": "detail",
    "サムネイル画像": "thumbnail_image_url",
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

        // サムネイル画像：imageブロックからURLを取得
        if (currentKey === "thumbnail_image_url") {
            if (b.type === "image") {
                const imgUrl = b.image?.file?.url ?? b.image?.external?.url ?? null;
                if (imgUrl) out.thumbnail_image_url = imgUrl;
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

// Notion画像URL（一時URLも可）をfetchしてSupabase Storageにアップロード
async function uploadImageUrlToSupabase(imageUrl: string, articleId: string): Promise<string | null> {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`画像fetch失敗: ${res.status} ${imageUrl}`);

    const contentType = res.headers.get("content-type") ?? "image/png";
    const ext = contentType.split("/")[1]?.split(";")[0] ?? "png";
    const fileName = `${articleId}.${ext}`;

    const bytes = new Uint8Array(await res.arrayBuffer());

    const { error } = await supabase.storage
        .from("article-images")
        .upload(fileName, bytes, { contentType, upsert: true });

    if (error) throw new Error(`Storage upload失敗: ${error.message}`);

    const { data } = supabase.storage.from("article-images").getPublicUrl(fileName);
    return data.publicUrl;
}

// type === "title" のプロパティを名前に依存せず取得
function getNotionTitle(page: any): string {
    const props = page.properties ?? {};
    for (const prop of Object.values(props) as any[]) {
        if (prop.type === "title") {
            return (prop.title ?? []).map((t: any) => t.plain_text).join("").trim();
        }
    }
    return "";
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
            .select("id, notion_page_id, title, status, image_url")
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
            const notionTitle = getNotionTitle(notionPage);
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

            // ③ タイトル・画像URL更新：両方「公開」で値が変わっていたら更新
            if (isPublishedInSupabase && isPublishedInNotion) {
                const notionImageUrl =
                    notionPage.properties?.[notionImageUrlPropertyName]?.url ?? null;

                const titleChanged = notionTitle && notionTitle !== record.title;
                const imageChanged = notionImageUrl !== null && notionImageUrl !== record.image_url;

                if (titleChanged || imageChanged) {
                    const patch: Record<string, string> = {};
                    if (titleChanged) patch.title = notionTitle;
                    if (imageChanged) patch.image_url = notionImageUrl;

                    const { error: updateErr } = await supabase
                        .from("cases_articles")
                        .update(patch)
                        .eq("id", record.id);
                    if (updateErr) {
                        log.push(`[ERROR] Supabase更新失敗: ${record.id} - ${updateErr.message}`);
                    } else {
                        if (titleChanged) log.push(`[TITLE] supabase ${record.id}: "${record.title}" → "${notionTitle}"`);
                        if (imageChanged) log.push(`[IMAGE] supabase ${record.id}: image_url 更新`);
                    }
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
            const title = getNotionTitle(page);

            // 本文ブロックを取得して解析
            const blocks = await fetchBlocks(pageId);
            const sections = parseSectionsFromBlocks(blocks);

            // サムネイル画像：ブロック画像 > URLプロパティ の優先順位で取得
            let resolvedImageUrl: string | null =
                page.properties?.[notionImageUrlPropertyName]?.url ?? null;

            if (sections.thumbnail_image_url) {
                const supabaseStorageBase = supabase.storage.from("article-images").getPublicUrl("").data.publicUrl.replace(/\/[^/]*$/, "/");
                const alreadyInStorage = sections.thumbnail_image_url.startsWith(supabaseStorageBase);

                if (alreadyInStorage) {
                    // すでにSupabase StorageのURLならアップロードスキップ
                    resolvedImageUrl = sections.thumbnail_image_url;
                    log.push(`[SKIP] サムネイル画像は既にStorageにあるためスキップ: ${supabaseId}`);
                } else {
                    try {
                        resolvedImageUrl = await uploadImageUrlToSupabase(
                            sections.thumbnail_image_url,
                            supabaseId
                        );
                        log.push(`[OK] サムネイル画像をSupabase Storageにアップロード: ${supabaseId}`);
                    } catch (e: any) {
                        log.push(`[WARN] サムネイル画像アップロード失敗（スキップ）: ${e.message}`);
                    }
                }
            }

            // Supabaseへ反映（Notionが編集元）
            const { data: updated, error: upErr } = await supabase
                .from("cases_articles")
                .update({
                    title: title || undefined,
                    image_url: resolvedImageUrl,
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
                    ...(resolvedImageUrl
                        ? { [notionImageUrlPropertyName]: { url: resolvedImageUrl } }
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