import { createSupabaseAdmin } from "@/app/lib/supabase/admin";

type Post = {
    id: string;
    title?: string;
    created_at?: string;
};

export default async function PostsPage() {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
        .from("posts")
        .select("id,title,created_at")
        .order("created_at", { ascending: false })
        .limit(20);

    if (error) {
        return <div>読み込みに失敗しました</div>;
    }

    const posts = (data ?? []) as Post[];

    return (
        <main>
            <h1>Posts</h1>
            <ul>
                {posts.map((p) => (
                    <li key={p.id}>
                        {p.title ?? "(no title)"}{""}
                        <small>{p.created_at ?? ""}</small>
                    </li>
                ))}
            </ul>
        </main>
    )
}

