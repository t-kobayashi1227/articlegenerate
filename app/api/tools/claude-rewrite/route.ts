import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "../../../lib/supabase/admin";
import Anthropic from "@anthropic-ai/sdk";
import { toJstIsoString } from "../../../../lib/datetime";

export const runtime = "nodejs";

type Body = {
    x_post_id: string; // x_posts.x_post_id
};

function pickTextForRewrite(row: any) {
    // すでに編集済みなら原則スキップしたいが、必要なら上書きできるようにする
    return row.text as string;
}

function buildPrompt(input: {
    originalText: string;
    author?: string | null;
    url?: string | null;
}) {
    // “捏造しない”が最重要。元投稿を核に、一般的補足は「推測・一般論」と明記させる
    return `
あなたはWeb開発・AI領域の編集者です。以下のX投稿をもとに、日本語で「約1000文字（900〜1100文字）」の記事にリライトしてください。

【必須ルール】
- 事実の捏造は禁止。元投稿に無い具体情報（数値、固有名詞、出来事）は勝手に追加しない。
- 補足説明を入れる場合は「一般的には〜」のように一般論として書く（断定しない）。
- 誹謗中傷・過激表現・個人情報の推測は禁止。
- 出力は必ずJSONのみ（コードブロック禁止）。

【出力JSON形式】
{
  "title": "記事タイトル（1つ）",
  "body": "本文（900〜1100文字、日本語、改行あり）"
}

【元投稿】
- author: ${input.author ?? ""}
- url: ${input.url ?? ""}
- text: ${input.originalText}
`.trim();
}

export async function POST(req: Request) {
    try {
        if (!process.env.ANTHROPIC_API_KEY) {
            return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
        }

        let body: Body;
        try {
            body = (await req.json()) as Body;
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        if (!body?.x_post_id) {
            return NextResponse.json({ error: "x_post_id is required" }, { status: 400 });
        }

        const supabase = createSupabaseAdmin();

        // 1) 対象投稿を取得
        const { data: post, error: fetchErr } = await supabase
            .from("x_posts")
            .select("x_post_id, text, text_edited, status, author_username, url")
            .eq("x_post_id", body.x_post_id)
            .maybeSingle();

        if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
        if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

        // すでに edited なら弾きたい場合はここで return（運用次第）
        // if (post.status === "edited") { ... }

        const originalText = pickTextForRewrite(post);

        // 2) Claudeへ生成依頼（Messages API）
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        // モデルはコスト/品質のバランスで選んでください（pricingは公式参照）
        // まずは安価モデル→品質不足なら上位モデルが運用的におすすめ :contentReference[oaicite:2]{index=2}
        const MODEL = "claude-sonnet-4-6";

        const prompt = buildPrompt({
            originalText,
            author: post.author_username,
            url: post.url,
        });

        const msg = await client.messages.create({
            model: MODEL,
            max_tokens: 1400, // 1000文字程度ならこれで概ね足ります（足りなければ増やす）
            temperature: 0.4,
            messages: [{ role: "user", content: prompt }],
        });

        // 3) Claudeの返答テキストを取り出す
        const textOut =
            msg.content
                ?.filter((c: any) => c.type === "text")
                ?.map((c: any) => c.text)
                ?.join("") ?? "";

        // 4) JSONとしてパース
        let parsed: { title: string; body: string };
        try {
            parsed = JSON.parse(textOut);
        } catch (e) {
            // JSON以外が返ってきたらエラー保存
            await supabase.from("x_posts").update({
                ai_error: `Invalid JSON from Claude: ${textOut.slice(0, 500)}`,
                ai_model: MODEL,
                ai_generated_at: toJstIsoString(),
            }).eq("x_post_id", body.x_post_id);

            return NextResponse.json(
                { error: "Claude output is not valid JSON", preview: textOut.slice(0, 500) },
                { status: 500 }
            );
        }

        // 5) DBへ保存（編集済みにする）
        const { error: updateErr } = await supabase
            .from("x_posts")
            .update({
                ai_title: parsed.title,
                text_edited: parsed.body,
                status: "edited",
                ai_model: MODEL,
                ai_generated_at: toJstIsoString(),
                ai_error: null,
            })
            .eq("x_post_id", body.x_post_id);

        if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

        return NextResponse.json({
            ok: true,
            x_post_id: body.x_post_id,
            title: parsed.title,
            length: parsed.body.length,
            model: MODEL,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
    }
}
