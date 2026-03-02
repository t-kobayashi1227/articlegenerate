

type Post = {
    id: number;
    title: string;
}

export async function getPosts(): Promise<Post[]> {

    const res = await fetch("https://jsonplaceholder.typicode.com/posts")

    if (!res.ok) {
        throw new Error("Failed to fetch");
    }

    const data = await res.json();
    const posts: Post[] = data.slice(0, 5).map((item: any) => ({
        id: item.id,
        title: item.title,
    }))
    return posts;
}