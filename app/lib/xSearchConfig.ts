export const X_SEARCH = {
    maxResultsPerQuery: 10,

    users: [
        "HayattiQ",
        "vercel",
        "supabase",
        "shadcn",
        "nextjs",
        "reactjs",
        "nodejs",
        "github",
        "claudeai",
        "OpenAI",
        "OpenAIDevs",
    ],

    keywords: [
        '"Next.js"',
        "React",
        "TypeScript",
        "Supabase",
        "Vercel",
        "Docker",
        '"CI/CD"',
        "LLM",
        "RAG",
        "ChatGPT",
        "Claude",
        "OpenAI",
    ],

    exclude: ["-is:retweet", "-is:reply"],

    // ★切り分けスイッチ：trueならキーワードも必須、falseならユーザー投稿だけ
    requireKeywords: false,
};
