import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// 管理者権限（service_role）でSupabaseへ書き込むクライアント
function createSupabaseAdmin() {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
    try {
        // 第三者に叩かれないように簡易認証
        const secret = req.headers.get("x-cron-secret");
        if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // リクエストBody（任意）
        const body = await req.json().catch(() => ({}));
        const query = typeof body.query === "string" ? body.query : "dummy";
        const n = typeof body.n === "number" ? Math.min(Math.max(body.n, 1), 20) : 5;

        const now = new Date();

        // ✅ ここでダミーデータ生成（Xっぽい形に）
        const rows = Array.from({ length: n }).map((_, i) => {
            const xId = `dummy_${now.getTime()}_${i}`; // x_post_id は uniqueなので被らないようにする

            return {
                x_post_id: xId,
                text: `【ダミー投稿】${query}\nNext.js + Supabaseの取り込み練習（#${i + 1}）`,
                author_id: null,
                author_username: "dummy_user",
                lang: "ja",
                posted_at: new Date(now.getTime() - i * 60_000).toISOString(), // 1分ずつ過去にする
                like_count: 200 + i * 10,
                repost_count: 10 + i,
                reply_count: 2,
                quote_count: 1,
                url: null,
                query,
            };
        });

        // ✅ 保存先：public.x_posts テーブル
        const supabase = createSupabaseAdmin();

        // upsert：同じx_post_idがあれば更新、なければ追加
        const { error } = await supabase.from("x_posts").upsert(rows, { onConflict: "x_post_id" });

        if (error) {
            return NextResponse.json({ error: "Supabase error", detail: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, saved: rows.length, table: "public.x_posts" });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}
