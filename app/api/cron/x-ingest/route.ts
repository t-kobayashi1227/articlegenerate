import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "../../../lib/supabase/admin";
import { X_SEARCH } from "../../../lib/xSearchConfig";
import { toJstIsoString } from "../../../../lib/datetime";

export const runtime = "nodejs";

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
    meta?: {
        newest_id?: string;
        oldest_id?: string;
        result_count?: number;
        next_token?: string;
    };
};

function buildXUrl(query: string, maxResults: number, sinceId?: string) {
    const base = "https://api.x.com/2/tweets/search/recent";
    const params = new URLSearchParams({
        query,
        max_results: String(maxResults),
        sort_order: "relevancy",
        "tweet.fields": "created_at,public_metrics,author_id,lang",
        expansions: "author_id",
        "user.fields": "username",
    });

    if (sinceId && sinceId !== "0") params.set("since_id", sinceId);
    return `${base}?${params.toString()}`;
}

function requireCronSecret(req: Request) {
    const secret = process.env.CRON_SECRET;
    const got = req.headers.get("x-cron-secret");
    return secret && got === secret;
}

export async function GET(req: Request) {
    if (!requireCronSecret(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.X_BEARER_TOKEN) {
        return NextResponse.json({ error: "Missing X_BEARER_TOKEN" }, { status: 500 });
    }

    const supabase = createSupabaseAdmin();

    // 1) fetch_state から since_id を取得
    const { data: stateRow, error: stateErr } = await supabase
        .from("fetch_state")
        .select("value")
        .eq("key", "x_since_id")
        .maybeSingle();

    if (stateErr) {
        return NextResponse.json({ error: stateErr.message }, { status: 500 });
    }

    const sinceId = stateRow?.value ?? "0";

    // 2) クエリを組み立てる（ユーザー固定）
    const fromPart = `(${X_SEARCH.users.map((u) => `from:${u}`).join(" OR ")})`;
    const excludePart = X_SEARCH.exclude.join(" ");

    // requireKeywords=false のときは「ユーザー投稿だけ」検索
    const kwPart = `(${X_SEARCH.keywords.join(" OR ")})`;
    const q = X_SEARCH.requireKeywords
        ? `${fromPart} ${kwPart} ${excludePart}`.trim()
        : `${fromPart} ${excludePart}`.trim();

    const url = buildXUrl(q, X_SEARCH.maxResultsPerQuery, sinceId);

    // 3) X API を叩く
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
        cache: "no-store",
    });

    if (!res.ok) {
        const body = await res.text();
        return NextResponse.json(
            { error: "X API error", status: res.status, body, q },
            { status: 500 }
        );
    }

    const json = (await res.json()) as XRecentSearchResponse;
    const tweets = json.data ?? [];

    // デバッグに役立つ情報も返す（運用時は消してOK）
    const resultCount = json.meta?.result_count ?? tweets.length;

    if (tweets.length === 0) {
        // 0件でも、クエリが原因なのか since_id なのか判断できるよう返す
        return NextResponse.json({
            ok: true,
            sinceId,
            q,
            resultCount,
            insertedOrUpdated: 0,
        });
    }

    // users map
    const users = new Map(
        (json.includes?.users ?? []).map((u) => [u.id, u.username ?? ""])
    );

    // 4) 10件の中で like 最大の投稿を選ぶ（同点なら新しい方）
    let bestTweet = tweets[0];

    for (const t of tweets) {
        const curLike = t.public_metrics?.like_count ?? 0;
        const bestLike = bestTweet.public_metrics?.like_count ?? 0;

        if (curLike > bestLike) {
            bestTweet = t;
            continue;
        }

        if (curLike === bestLike) {
            // created_at がある場合は新しい方を採用
            const curTime = t.created_at ? Date.parse(t.created_at) : 0;
            const bestTime = bestTweet.created_at ? Date.parse(bestTweet.created_at) : 0;
            if (curTime > bestTime) bestTweet = t;
        }
    }

    // 5) 保存用データ作成
    const m = bestTweet.public_metrics ?? {};
    const username =
        (bestTweet.author_id && users.get(bestTweet.author_id)) || null;

    const postUrl =
        username && bestTweet.id
            ? `https://x.com/${username}/status/${bestTweet.id}`
            : null;

    const row = {
        x_post_id: bestTweet.id,
        text: bestTweet.text,
        author_id: bestTweet.author_id ?? null,
        author_username: username,
        lang: bestTweet.lang ?? null,
        posted_at: bestTweet.created_at ?? null,
        like_count: m.like_count ?? 0,
        repost_count: m.repost_count ?? 0,
        reply_count: m.reply_count ?? 0,
        quote_count: m.quote_count ?? 0,
        url: postUrl,
        query: q,
        fetched_at: toJstIsoString(),
    };

    // 6) upsert（1件だけ）
    const { error: upsertErr } = await supabase
        .from("x_posts")
        .upsert(row, { onConflict: "x_post_id" });

    if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    // 7) since_id 更新（★重要：0件のときに止まるのが嫌なら、ここは「取得全体のnewest」にする）
    // まずは簡単に「今回保存したbestTweetのid」で進める
    const newestIdSeen = bestTweet.id;

    const { error: updErr } = await supabase
        .from("fetch_state")
        .upsert(
            { key: "x_since_id", value: newestIdSeen, updated_at: toJstIsoString() },
            { onConflict: "key" }
        );

    if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        sinceId,
        q,
        resultCount,
        saved: {
            x_post_id: row.x_post_id,
            author_username: row.author_username,
            like_count: row.like_count,
            posted_at: row.posted_at,
        },
        insertedOrUpdated: 1,
        newestIdSeen,
    });
}
