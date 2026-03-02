import { supabase } from "../lib/supabase/client";

export default async function Page() {
    const { data, error } = await supabase()
        .from("spots")
        .select("id,title,created_at")
        .order("created_at", { ascending: false });

    if (error) {
        return <pre>ERROR:{JSON.stringify(error, null, 2)}</pre>;
    }

    return (
        <main style={{ padding: 24 }}>
            <h1>Spots</h1>
            <ul>
                {data?.map((spot) => (
                    <li key={spot.id}>
                        {spot.title}({new Date(spot.created_at).toLocaleString()})
                    </li>
                ))}
            </ul>
        </main>
    )
}