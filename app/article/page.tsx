import { notion, getPropText, getPropFiles } from '@/lib/notion'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import Image from 'next/image'
import Link from 'next/link'

export const revalidate = 0

// ── Notionデータベースのプロパティ名をここで管理 ──────────────────────────
const PROP = {
    title: 'title',           // タイトル（title型）
    status: 'status',         // 公開ステータス（select型）
    card_before: 'card_before', // Beforeサマリー（rich_text型）
    card_after: 'card_after',   // Afterサマリー（rich_text型）
    image_url: 'image_url',     // 画像URL（url型）または（files型）
} as const

type ArticleItem = {
    id: string
    title: string
    card_before: string
    card_after: string
    image_url: string | null
}

function toArticleItem(page: PageObjectResponse): ArticleItem {
    return {
        id: page.id,
        title: getPropText(page, PROP.title),
        card_before: getPropText(page, PROP.card_before),
        card_after: getPropText(page, PROP.card_after),
        image_url: getPropText(page, PROP.image_url) || getPropFiles(page, PROP.image_url),
    }
}

export default async function ArticlePage() {
    const response = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID!,
        filter: {
            property: PROP.status,
            select: { equals: '公開' },
        },
    })

    const articles = (response.results as PageObjectResponse[]).map(toArticleItem)
    const leadArticle = articles[0]

    return (
        <main className="min-h-screen bg-[#f6f1e8] text-[#18352b]">
            <section className="relative overflow-hidden border-b border-[#18352b]/10 bg-[linear-gradient(180deg,#f6f1e8_0%,#efe6d8_100%)]">
                <div className="absolute inset-0">
                    <div className="absolute left-[-6rem] top-10 h-72 w-72 rounded-full bg-[#315745]/10 blur-3xl" />
                    <div className="absolute right-[-5rem] top-20 h-80 w-80 rounded-full bg-[#d7853c]/14 blur-3xl" />
                    <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#18352b]/15 to-transparent" />
                </div>

                <div className="relative mx-auto max-w-6xl px-6 py-16 md:px-8 lg:py-24">
                    <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
                        <div className="max-w-3xl">
                            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-[#a35f24]">
                                Articles
                            </p>
                            <h1 className="mt-5 text-4xl font-semibold leading-tight md:text-6xl">
                                課題から成果まで、
                                <span className="block text-[#a35f24]">現場の変化が伝わる導入事例。</span>
                            </h1>
                            <p className="mt-6 max-w-2xl text-sm leading-8 text-[#18352b]/72 md:text-base">
                                クラウド導入、運用改善、内製化支援まで。CloudNature の実案件を、背景と打ち手と結果の流れで読みやすく整理しました。
                            </p>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-1">
                            <div className="rounded-[30px] border border-[#18352b]/10 bg-white/80 p-6 shadow-[0_24px_60px_rgba(24,53,43,0.08)] backdrop-blur">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#18352b]/45">
                                    Total Articles
                                </p>
                                <p className="mt-4 text-5xl font-semibold">{articles.length}</p>
                                <p className="mt-3 text-sm leading-7 text-[#18352b]/62">
                                    成果だけでなく、検討背景や実装内容まで追える事例を掲載しています。
                                </p>
                            </div>

                            <div className="rounded-[30px] border border-[#18352b]/10 bg-[#18352b] p-6 text-white shadow-[0_28px_70px_rgba(24,53,43,0.18)]">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">
                                    Latest Focus
                                </p>
                                <p className="mt-4 text-lg font-medium leading-8">
                                    {leadArticle?.title ?? '最新の導入事例を掲載中'}
                                </p>
                                <p className="mt-3 text-sm leading-7 text-white/68">
                                    一覧では成果の要点を、詳細では課題解決の流れを深掘りできる構成です。
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="mx-auto max-w-6xl px-6 py-12 md:px-8 md:py-16">
                {articles.length > 0 ? (
                    <div className="space-y-8">
                        {articles.map((item, index) => (
                            <Link key={item.id} href={`/article/${item.id}`} className="group block">
                                <article className="overflow-hidden rounded-[34px] border border-[#18352b]/10 bg-white shadow-[0_22px_60px_rgba(24,53,43,0.08)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_28px_80px_rgba(24,53,43,0.13)]">
                                    <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
                                        <div className="relative min-h-[260px] overflow-hidden bg-[#dce6de]">
                                            {item.image_url ? (
                                                <Image
                                                    src={item.image_url}
                                                    alt={item.title ?? '導入事例'}
                                                    fill
                                                    className="object-cover transition duration-700 group-hover:scale-[1.04]"
                                                />
                                            ) : (
                                                <div className="flex h-full min-h-[260px] items-center justify-center bg-[radial-gradient(circle_at_top,#d6e1d8_0%,#c2d0c4_52%,#a6b8a8_100%)]">
                                                    <span className="text-7xl font-semibold tracking-[0.12em] text-white/72">
                                                        {(item.title ?? 'A').slice(0, 1)}
                                                    </span>
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-gradient-to-t from-[#18352b]/28 to-transparent" />
                                            <div className="absolute left-5 top-5 rounded-full border border-white/35 bg-white/18 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.28em] text-white backdrop-blur">
                                                Article {String(index + 1).padStart(2, '0')}
                                            </div>
                                        </div>

                                        <div className="flex flex-col justify-between p-7 md:p-9">
                                            <div>
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <span className="rounded-full bg-[#efe4d3] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#18352b]">
                                                        導入事例
                                                    </span>
                                                    <span className="text-sm text-[#18352b]/45">課題整理 / 実施施策 / 成果</span>
                                                </div>

                                                <h2 className="mt-5 text-2xl font-semibold leading-tight transition-colors group-hover:text-[#a35f24] md:text-[2rem]">
                                                    {item.title}
                                                </h2>

                                                <div className="mt-7 grid gap-4 md:grid-cols-2">
                                                    <section className="rounded-[24px] bg-[#f7f2ea] p-5">
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#18352b]/45">
                                                            Before
                                                        </p>
                                                        <p className="mt-3 text-sm leading-7 text-[#18352b]/74">
                                                            {item.card_before || '課題の要約は準備中です。'}
                                                        </p>
                                                    </section>

                                                    <section className="rounded-[24px] bg-[#18352b] p-5 text-white">
                                                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#d8b18d]">
                                                            After
                                                        </p>
                                                        <p className="mt-3 text-sm leading-7 text-white/82">
                                                            {item.card_after || '成果の要約は準備中です。'}
                                                        </p>
                                                    </section>
                                                </div>
                                            </div>

                                            <div className="mt-8 flex items-center justify-between border-t border-[#18352b]/10 pt-5">
                                                <p className="text-sm text-[#18352b]/52">プロジェクトの全体像を見る</p>
                                                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#a35f24]">
                                                    詳細を見る
                                                    <span className="transition duration-200 group-hover:translate-x-1">→</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </article>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-[32px] border border-dashed border-[#18352b]/15 bg-white/70 px-6 py-24 text-center shadow-[0_20px_44px_rgba(24,53,43,0.05)]">
                        <p className="text-lg font-medium">事例がまだありません</p>
                        <p className="mt-3 text-sm leading-7 text-[#18352b]/60">
                            公開済みの事例が追加されると、この一覧に表示されます。
                        </p>
                    </div>
                )}
            </section>

            <section className="border-t border-[#18352b]/10 bg-[#18352b] px-6 py-16 text-white md:px-8">
                <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#d8b18d]">Contact</p>
                        <h2 className="mt-4 text-3xl font-semibold leading-tight md:text-4xl">
                            次の事例になるプロジェクトを、相談ベースで整理します。
                        </h2>
                        <p className="mt-4 max-w-2xl text-sm leading-8 text-white/68 md:text-base">
                            課題が曖昧な段階でも構いません。要件整理から導入設計、運用改善まで一緒に進められます。
                        </p>
                    </div>

                    <Link
                        href="/about"
                        className="inline-flex items-center justify-center rounded-full bg-[#d7853c] px-8 py-4 text-sm font-semibold text-white transition hover:bg-[#bf6f2f]"
                    >
                        ご相談はこちら
                    </Link>
                </div>
            </section>
        </main>
    )
}
