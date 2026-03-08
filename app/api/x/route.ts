// app/api/ingest/x/route.ts
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "../../lib/supabase/admin";

export const runtime = "nodejs"; // 念のため（nodeで安定運用）

type XRecentSearchResponse = {
    data?: Array<{
        id: string;
        text: string;
        author_id?: string;
        created_at?: string;
        lang?: string;
        public_metrics?: {
            like_count?: number;
            repost_count?: number;
            reply_count?: number;
            quote_count?: number;
        };
    }>;
    includes?: {
        users?: Array<{
            id: string;
            username?: string;
        }>;
    };
};

function buildXUrl(query: string, maxResults = 10) {
    const base = "https://api.x.com/2/tweets/search/recent";
    const params = new URLSearchParams({
        query,
        max_results: String(maxResults),
        "tweet.fields": "created_at,public_metrics,author_id,lang",
        expansions: "author_id",
        "user.fields": "username",
    });
    return `${base}?${params.toString()}`;
}

export async function POST(req: Request) {
    try {
        // 1) 認可（超重要）：勝手に叩かれないようにする
        const secret = req.headers.get("x-cron-secret");
        if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { query, minLikes = 10, maxResults = 10 } = await req.json();

        if (!query || typeof query !== "string") {
            return NextResponse.json({ error: "query is required" }, { status: 400 });
        }

        const bearer = process.env.X_BEARER_TOKEN!;
        if (!bearer) {
            return NextResponse.json({ error: "Missing X_BEARER_TOKEN" }, { status: 500 });
        }

        // 2) X API呼び出し（Recent Search）
        // 例: "nextjs OR react OR typescript -is:retweet lang:ja"
        const url = buildXUrl(query, maxResults);

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${bearer}`,
            },
        });

        if (!res.ok) {
            const text = await res.text();
            return NextResponse.json(
                { error: "X API error", status: res.status, detail: text },
                { status: 500 }
            );
        }

        const json = (await res.json()) as XRecentSearchResponse;

        const usersById = new Map<string, string>();
        for (const u of json.includes?.users ?? []) {
            if (u.id && u.username) usersById.set(u.id, u.username);
        }

        // 3) “バズ判定”でフィルタ（まずはlike数）
        const rows =
            (json.data ?? [])
                .map((t) => {
                    const m = t.public_metrics ?? {};
                    const like = m.like_count ?? 0;
                    const repost = m.repost_count ?? 0;
                    const reply = m.reply_count ?? 0;
                    const quote = m.quote_count ?? 0;

                    return {
                        x_post_id: t.id,
                        text: t.text,
                        author_id: t.author_id ?? null,
                        author_username: t.author_id ? usersById.get(t.author_id) ?? null : null,
                        lang: t.lang ?? null,
                        posted_at: t.created_at ?? null,
                        like_count: like,
                        repost_count: repost,
                        reply_count: reply,
                        quote_count: quote,
                        url: `https://x.com/i/web/status/${t.id}`,
                        query,
                    };
                })
                .filter((r) => r.like_count >= minLikes);

        // 4) Supabaseへ保存（重複はupsertで吸収）
        // x_posts.x_post_id に unique があるので onConflict に指定する
        const supabase = createSupabaseAdmin();
        const { error } = await supabase
            .from("x_posts")
            .upsert(rows, { onConflict: "x_post_id" }); // 既存なら更新、なければ追加 :contentReference[oaicite:2]{index=2}

        if (error) {
            return NextResponse.json({ error: "Supabase error", detail: error.message }, { status: 500 });
        }

        return NextResponse.json({
            ok: true,
            fetched: json.data?.length ?? 0,
            saved: rows.length,
            minLikes,
            query,
        });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}
