"use client";

import { useEffect, useState } from "react";

type Post = {
    id: string;
    title?: string;
    created_at?: string;
};

export default function PostsClientPage() {
    const [items, setItems] = useState<Post[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            const res = await fetch("api/posts");
            if (!res.ok) {
                setError("読み込みに失敗しました");
                return;
            }
            const json: { items: Post[] } = await res.json();
            setItems(json.items);
        })();
    }, []);

    return (
        <main>
            <h1>Posts (Client)</h1>
            {error ? <p>{error}</p> : null}
            <ul>
                {items.map((p) => (
                    <li key={p.id}>
                        {p.title ?? "(no title)"}{""}
                        <small>{p.created_at ?? ""}</small>
                    </li>
                ))}
            </ul>
        </main>
    )
}