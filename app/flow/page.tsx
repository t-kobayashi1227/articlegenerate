export default function FlowPage() {
    return (
        <main className="min-h-screen bg-[#f6f1e8] text-[#18352b]">

            {/* Hero */}
            <section className="relative overflow-hidden border-b border-[#18352b]/10 bg-[linear-gradient(180deg,#f6f1e8_0%,#efe6d8_100%)]">
                <div className="pointer-events-none absolute inset-0">
                    <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-[#315745]/10 blur-3xl" />
                    <div className="absolute -right-20 top-20 h-80 w-80 rounded-full bg-[#d7853c]/12 blur-3xl" />
                </div>
                <div className="relative mx-auto max-w-4xl px-6 py-16 md:px-8 md:py-20 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#a35f24]">
                        System Overview
                    </p>
                    <h1 className="mt-4 text-4xl font-semibold leading-tight md:text-5xl">
                        記事作成フロー
                    </h1>
                    <p className="mt-5 text-sm leading-8 text-[#18352b]/65 md:text-base">
                        Notion への URL 登録から、サイトへの公開までの自動化された流れ
                    </p>
                </div>
            </section>

            {/* Flow */}
            <section className="mx-auto max-w-3xl px-6 py-16 md:px-8 md:py-20">
                <div className="flex flex-col items-center gap-0">

                    {/* Step 1 */}
                    <FlowStep
                        number="01"
                        phase="事前準備"
                        color="green"
                        icon="📝"
                        title="Notion にURLを登録"
                        items={[
                            'Source URL に元記事URLを入力',
                            'Status を「生成待ち」に設定',
                        ]}
                    />

                    <Arrow label="POST /api/generate を実行" />

                    {/* Step 2 */}
                    <FlowStep
                        number="02"
                        phase="自動処理"
                        color="orange"
                        icon="🔍"
                        title="元記事の本文を取得"
                        items={[
                            '「生成待ち」ページを Notion から取得',
                            'Source URL からHTMLを取得・クレンジング',
                            '最大 6,000 文字に切り出し',
                        ]}
                    />

                    <Arrow />

                    {/* Step 3 */}
                    <FlowStep
                        number="03"
                        phase="AI 生成"
                        color="purple"
                        icon="🤖"
                        title="Claude が記事を生成"
                        badge="claude-sonnet-4-5"
                        items={[
                            'タイトル / card_before / card_after',
                            'Challenge / Solution / Results',
                            'Quote / プロジェクト詳細（全文）',
                        ]}
                    />

                    <Arrow />

                    {/* Step 4 */}
                    <FlowStep
                        number="04"
                        phase="AI 生成"
                        color="purple"
                        icon="🎨"
                        title="OpenAI がサムネイル画像を生成"
                        badge="gpt-image-1"
                        items={[
                            'タイトル・課題文をプロンプトに使用',
                            'base64 形式で画像データを取得',
                        ]}
                    />

                    <Arrow />

                    {/* Step 5 */}
                    <FlowStep
                        number="05"
                        phase="保存"
                        color="blue"
                        icon="🗄️"
                        title="Supabase に保存"
                        items={[
                            'Storage › article-images に画像をアップロード',
                            'temp_{page_id}.png → {article_id}.png にリネーム',
                            'cases_articles テーブルに記事データを INSERT',
                            'image_url カラムに公開 URL を保存',
                        ]}
                    />

                    <Arrow />

                    {/* Step 6 */}
                    <FlowStep
                        number="06"
                        phase="通知"
                        color="green"
                        icon="📓"
                        title="Notion ページを更新"
                        items={[
                            'Title / Supabase ID を書き込み',
                            'Status → 「レビュー中」に変更',
                            '生成コンテンツをページ本文に追記',
                        ]}
                    />

                    <Arrow label="担当者がレビュー" dashed />

                    {/* Step 7 */}
                    <FlowStep
                        number="07"
                        phase="公開"
                        color="orange"
                        icon="✅"
                        title="レビュー後に公開"
                        items={[
                            'Supabase の status を「公開」に変更',
                            '/cases に一覧表示される',
                            '/cases/[id] で詳細を閲覧できる',
                        ]}
                    />

                </div>
            </section>

            {/* Data Store Summary */}
            <section className="border-t border-[#18352b]/10 bg-white px-6 py-14 md:px-8">
                <div className="mx-auto max-w-3xl">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#18352b]/45 text-center mb-8">
                        Data Stores
                    </p>
                    <div className="grid gap-4 sm:grid-cols-3">
                        <DataStore
                            icon="📓"
                            name="Notion"
                            desc="URL登録・レビュー管理ステータス管理の起点"
                            color="green"
                        />
                        <DataStore
                            icon="🖼️"
                            name="Supabase Storage"
                            desc="article-images バケットにサムネイル画像を保存"
                            color="blue"
                        />
                        <DataStore
                            icon="📊"
                            name="Supabase DB"
                            desc="cases_articles テーブルに記事データを永続化"
                            color="orange"
                        />
                    </div>
                </div>
            </section>
        </main>
    )
}

/* ── Components ── */

type StepColor = 'green' | 'orange' | 'purple' | 'blue'

const colorMap: Record<StepColor, {
    badge: string
    number: string
    border: string
    bg: string
}> = {
    green:  { badge: 'bg-[#18352b] text-white',        number: 'bg-[#efe4d3] text-[#18352b]', border: 'border-[#18352b]/15', bg: 'bg-white' },
    orange: { badge: 'bg-[#a35f24] text-white',         number: 'bg-[#f7ede0] text-[#a35f24]', border: 'border-[#d7853c]/20', bg: 'bg-white' },
    purple: { badge: 'bg-[#4a3270] text-white',         number: 'bg-[#ede8f5] text-[#4a3270]', border: 'border-[#4a3270]/15', bg: 'bg-white' },
    blue:   { badge: 'bg-[#1e4d7b] text-white',         number: 'bg-[#e4edf7] text-[#1e4d7b]', border: 'border-[#1e4d7b]/15', bg: 'bg-white' },
}

function FlowStep({
    number, phase, color, icon, title, badge, items,
}: {
    number: string
    phase: string
    color: StepColor
    icon: string
    title: string
    badge?: string
    items: string[]
}) {
    const c = colorMap[color]
    return (
        <div className={`w-full rounded-[28px] border ${c.border} ${c.bg} p-6 shadow-[0_16px_40px_rgba(24,53,43,0.07)] md:p-7`}>
            <div className="flex items-start gap-4">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold ${c.number}`}>
                    {number}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className={`rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] ${c.badge}`}>
                            {phase}
                        </span>
                        {badge && (
                            <span className="rounded-full border border-[#18352b]/15 px-3 py-0.5 text-[10px] font-medium text-[#18352b]/55">
                                {badge}
                            </span>
                        )}
                    </div>
                    <h2 className="text-lg font-semibold leading-snug text-[#18352b]">
                        <span className="mr-2">{icon}</span>{title}
                    </h2>
                    <ul className="mt-3 space-y-1.5">
                        {items.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm leading-7 text-[#18352b]/68">
                                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d7853c]" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    )
}

function Arrow({ label, dashed }: { label?: string; dashed?: boolean }) {
    return (
        <div className="flex flex-col items-center py-1">
            {label && (
                <span className="mb-1 rounded-full border border-[#18352b]/15 bg-white px-3 py-1 text-[11px] font-medium text-[#18352b]/55">
                    {label}
                </span>
            )}
            <div className={`flex flex-col items-center gap-0.5 ${dashed ? 'opacity-40' : ''}`}>
                <div className="h-4 w-px bg-[#18352b]/25" />
                <div className="h-0 w-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-[#18352b]/35" />
            </div>
        </div>
    )
}

function DataStore({ icon, name, desc, color }: { icon: string; name: string; desc: string; color: StepColor }) {
    const c = colorMap[color]
    return (
        <div className={`rounded-[24px] border ${c.border} p-5`}>
            <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-2xl text-xl ${c.number}`}>
                {icon}
            </div>
            <p className="font-semibold text-[#18352b]">{name}</p>
            <p className="mt-1.5 text-sm leading-6 text-[#18352b]/60">{desc}</p>
        </div>
    )
}
