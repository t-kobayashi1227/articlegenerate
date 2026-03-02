type Post = {
    id: string;
    title?: string;
    created_at?: string;
};

export default async function PostsPage() {
    const res = await fetch("http://localhost:3000/api/posts", {
        cache: "no-store",
    });

    if (!res.ok) {
        return <div>読み込みに失敗しました</div>;
    }

    const json: { items: Post[] } = await res.json();

    return (
        <main>
            <h1>Posts</h1>
            <ul>
                {json.items.map((p) => (
                    <li key={p.id}>
                        {p.title ?? "(no title)"}{""}
                        <small>{p.created_at ?? ""}</small>
                    </li>
                ))}
            </ul>
        </main>
    )
}

