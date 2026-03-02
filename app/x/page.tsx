import { createSupabaseAdmin } from "../lib/supabase/admin";

export const revalidate = 60; // 60秒キャッシュ（表示が安定）

type XPostRow = {
    id: number;
    text: string;
    author_username: string | null;
    like_count: number;
    repost_count: number;
    reply_count: number;
    quote_count: number;
    posted_at: string | null;
    url: string | null;
};

export default async function XPostsPage() {
    const supabase = createSupabaseAdmin();

    const { data, error } = await supabase
        .from("x_posts")
        .select("id,text,author_username,like_count,repost_count,reply_count,quote_count,posted_at,url")
        .order("posted_at", { ascending: false })
        .limit(50);

    if (error) {
        return (
            <main style={{ padding: 24 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700 }}>X Posts</h1>
                <p>DB取得でエラー: {error.message}</p>
            </main>
        );
    }

    const posts = (data ?? []) as XPostRow[];

    return (
        <main style={{ padding: 24 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>X Posts（DB表示）</h1>
            <p style={{ marginTop: 8, color: "#555" }}>
                Supabaseの <code>x_posts</code> から取得して表示しています。
            </p>

            <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                {posts.map((p) => (
                    <article
                        key={p.id}
                        style={{
                            border: "1px solid #ddd",
                            borderRadius: 12,
                            padding: 12,
                            background: "white",
                        }}
                    >
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                            <strong>@{p.author_username ?? "unknown"}</strong>
                            <span style={{ color: "#777", fontSize: 12 }}>{p.posted_at ?? ""}</span>
                        </div>

                        <p style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{p.text}</p>

                        <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
                            ❤️ {p.like_count} / 🔁 {p.repost_count} / 💬 {p.reply_count} / ✨ {p.quote_count}
                        </div>

                        {p.url && (
                            <div style={{ marginTop: 8 }}>
                                <a href={p.url} target="_blank" rel="noreferrer">
                                    Xで開く
                                </a>
                            </div>
                        )}
                    </article>
                ))}
            </div>
        </main>
    );
}
