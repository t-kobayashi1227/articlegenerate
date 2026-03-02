import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/app/lib/supabase/server";

export const runtime = "node.js";

export async function GET() {
    const supabase = createSupabaseAdmin();

    const { data, error } = await supabase
        .from("posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

    if (error) {
        return NextResponse.json(
            { message: "Failed to fetch posts", details: error.message },
            { status: 500 }
        );
    }
    return NextResponse.json({ items: data });
}