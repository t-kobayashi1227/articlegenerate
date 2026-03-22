import { notion, getPropText, getPropMultiSelect, getPropFiles } from '@/lib/notion'
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints'
import Image from 'next/image'
import Link from 'next/link'

export const revalidate = 0

// ── Notionデータベースのプロパティ名をここで管理 ──────────────────────────
const PROP = {
    title: 'title',                         // タイトル（title型）
    card_before: 'card_before',             // Beforeサマリー（rich_text型）
    card_after: 'card_after',               // Afterサマリー（rich_text型）
    image_url: 'image_url',                 // 画像URL（url型）または（files型）
    detail_challenge: 'detail_challenge',   // 導入前の課題（rich_text型）
    detail_solution: 'detail_solution',     // 実施した施策（rich_text型）
    detail_results: 'detail_results',       // 得られた成果（multi_select型）
    detail: 'detail',                       // プロジェクト詳細（rich_text型）
    detail_quote: 'detail_quote',           // 引用文（rich_text型）
    detail_quote_author: 'detail_quote_author', // 引用著者（rich_text型）
} as const

function splitParagraphs(value: string | null | undefined) {
    return (value ?? '')
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
}

function ContentSection({
    index,
    label,
    title,
    body,
    dark = false,
}: {
    index: string
    label: string
    title: string
    body: string | null
    dark?: boolean
}) {
    const paragraphs = splitParagraphs(body)

    return (
        <section
            className={
                dark
                    ? 'rounded-[30px] border border-white/10 bg-[#18352b] p-7 text-white shadow-[0_24px_60px_rgba(24,53,43,0.18)] md:p-9'
                    : 'rounded-[30px] border border-[#18352b]/10 bg-white p-7 shadow-[0_20px_50px_rgba(24,53,43,0.07)] md:p-9'
            }
        >
            <div className="flex items-start gap-4">
                <div
                    className={
                        dark
                            ? 'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-sm font-semibold text-white'
                            : 'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe4d3] text-sm font-semibold text-[#18352b]'
                    }
                >
                    {index}
                </div>
                <div>
                    <p className={dark ? 'text-[11px] font-semibold uppercase tracking-[0.28em] text-[#d8b18d]' : 'text-[11px] font-semibold uppercase tracking-[0.28em] text-[#18352b]/45'}>
                        {label}
                    </p>
                    <h2 className={dark ? 'mt-3 text-2xl font-semibold text-white' : 'mt-3 text-2xl font-semibold text-[#18352b]'}>
                        {title}
                    </h2>
                </div>
            </div>

            <div className={dark ? 'mt-6 space-y-5 text-sm leading-8 text-white/78 md:text-[15px]' : 'mt-6 space-y-5 text-sm leading-8 text-[#18352b]/76 md:text-[15px]'}>
                {paragraphs.length > 0 ? (
                    paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)
                ) : (
                    <p>情報は準備中です。</p>
                )}
            </div>
        </section>
    )
}

export default async function ArticleDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params

    let page: PageObjectResponse | null = null
    try {
        const result = await notion.pages.retrieve({ page_id: id })
        if (result.object === 'page') {
            page = result as PageObjectResponse
        }
    } catch {
        page = null
    }

    if (!page) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-[#f6f1e8] px-6">
                <div className="rounded-[28px] border border-[#18352b]/10 bg-white px-8 py-10 text-center shadow-[0_20px_44px_rgba(24,53,43,0.08)]">
                    <p className="text-lg font-medium text-[#18352b]">記事が見つかりません</p>
                    <Link href="/article" className="mt-4 inline-flex text-sm font-semibold text-[#a35f24]">
                        記事一覧へ戻る
                    </Link>
                </div>
            </main>
        )
    }

    const title = getPropText(page, PROP.title)
    const card_before = getPropText(page, PROP.card_before)
    const card_after = getPropText(page, PROP.card_after)
    const image_url = getPropText(page, PROP.image_url) || getPropFiles(page, PROP.image_url)
    const detail_challenge = getPropText(page, PROP.detail_challenge)
    const detail_solution = getPropText(page, PROP.detail_solution)
    const detail_results = getPropMultiSelect(page, PROP.detail_results)
    const detail = getPropText(page, PROP.detail)
    const detail_quote = getPropText(page, PROP.detail_quote)
    const detail_quote_author = getPropText(page, PROP.detail_quote_author)

    return (
        <main className="min-h-screen bg-[#f6f1e8] text-[#18352b]">
            <section className="relative overflow-hidden border-b border-[#18352b]/10 bg-[linear-gradient(180deg,#f6f1e8_0%,#efe6d8_100%)]">
                <div className="absolute inset-0">
                    <div className="absolute left-[-6rem] top-10 h-72 w-72 rounded-full bg-[#315745]/10 blur-3xl" />
                    <div className="absolute right-[-4rem] top-16 h-72 w-72 rounded-full bg-[#d7853c]/12 blur-3xl" />
                </div>

                <div className="relative mx-auto max-w-6xl px-6 py-10 md:px-8 md:py-14">
                    <Link
                        href="/article"
                        className="inline-flex items-center gap-2 text-sm font-medium text-[#18352b]/55 transition hover:text-[#18352b]"
                    >
                        <span>←</span>
                        <span>記事一覧へ戻る</span>
                    </Link>

                    <div className="mt-8 grid gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-end">
                        <div>
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="rounded-full bg-[#18352b] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-white">
                                    Article
                                </span>
                                <span className="text-sm text-[#18352b]/45">課題整理 / 実施施策 / 成果</span>
                            </div>

                            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
                                {title}
                            </h1>

                            <div className="mt-8 grid gap-4 md:grid-cols-2">
                                <div className="rounded-[26px] bg-white/80 p-5 shadow-[0_16px_40px_rgba(24,53,43,0.06)] backdrop-blur">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#18352b]/45">Before</p>
                                    <p className="mt-3 text-sm leading-7 text-[#18352b]/76">
                                        {card_before || '課題サマリーは準備中です。'}
                                    </p>
                                </div>
                                <div className="rounded-[26px] bg-[#18352b] p-5 text-white shadow-[0_20px_44px_rgba(24,53,43,0.16)]">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#d8b18d]">After</p>
                                    <p className="mt-3 text-sm leading-7 text-white/82">
                                        {card_after || '成果サマリーは準備中です。'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-[34px] border border-white/40 bg-[#dce6de] shadow-[0_24px_70px_rgba(24,53,43,0.1)]">
                            {image_url ? (
                                <div className="relative aspect-[4/3]">
                                    <Image
                                        src={image_url}
                                        alt={title ?? '導入事例'}
                                        fill
                                        priority
                                        className="object-cover"
                                    />
                                </div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-[radial-gradient(circle_at_top,#d6e1d8_0%,#c2d0c4_52%,#a6b8a8_100%)]">
                                    <span className="text-7xl font-semibold tracking-[0.12em] text-white/72">
                                        {(title ?? 'A').slice(0, 1)}
                                    </span>
                                </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#18352b]/30 to-transparent" />
                        </div>
                    </div>
                </div>
            </section>

            <section className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:py-16">
                <aside className="lg:sticky lg:top-8 lg:self-start">
                    <div className="space-y-5 rounded-[30px] border border-[#18352b]/10 bg-white p-6 shadow-[0_20px_50px_rgba(24,53,43,0.07)]">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#18352b]/45">
                                Overview
                            </p>
                            <h2 className="mt-3 text-2xl font-semibold">案件サマリー</h2>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-[24px] bg-[#f7f2ea] p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#18352b]/45">課題</p>
                                <p className="mt-2 text-sm leading-7 text-[#18352b]/76">
                                    {card_before || '課題サマリーは準備中です。'}
                                </p>
                            </div>

                            <div className="rounded-[24px] bg-[#18352b] p-4 text-white">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#d8b18d]">成果</p>
                                <p className="mt-2 text-sm leading-7 text-white/82">
                                    {card_after || '成果サマリーは準備中です。'}
                                </p>
                            </div>
                        </div>

                        {detail_results.length > 0 && (
                            <div className="rounded-[24px] border border-[#18352b]/10 p-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#18352b]/45">
                                    Results
                                </p>
                                <ul className="mt-4 space-y-3">
                                    {detail_results.map((result, index) => (
                                        <li key={index} className="flex items-start gap-3 text-sm leading-7 text-[#18352b]/76">
                                            <span className="mt-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#d7853c] text-[11px] font-semibold text-white">
                                                {index + 1}
                                            </span>
                                            <span>{result}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        <Link
                            href="/article"
                            className="inline-flex w-full items-center justify-center rounded-full bg-[#18352b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#22493b]"
                        >
                            一覧へ戻る
                        </Link>
                    </div>
                </aside>

                <div className="space-y-6">
                    <ContentSection index="01" label="Challenge" title="導入前の課題" body={detail_challenge} />
                    <ContentSection index="02" label="Solution" title="実施した施策" body={detail_solution} dark />

                    {detail_results.length > 0 && (
                        <section className="rounded-[30px] border border-[#18352b]/10 bg-white p-7 shadow-[0_20px_50px_rgba(24,53,43,0.07)] md:p-9">
                            <div className="flex items-start gap-4">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#efe4d3] text-sm font-semibold text-[#18352b]">
                                    03
                                </div>
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#18352b]/45">
                                        Results
                                    </p>
                                    <h2 className="mt-3 text-2xl font-semibold">得られた成果</h2>
                                </div>
                            </div>

                            <div className="mt-7 grid gap-4 md:grid-cols-2">
                                {detail_results.map((result, index) => (
                                    <div key={index} className="rounded-[24px] bg-[#f7f2ea] p-5">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#a35f24]">
                                            Point {String(index + 1).padStart(2, '0')}
                                        </p>
                                        <p className="mt-3 text-sm leading-7 text-[#18352b]/76">{result}</p>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}

                    <ContentSection index="04" label="Detail" title="プロジェクト詳細" body={detail} />

                    {detail_quote && (
                        <blockquote className="relative overflow-hidden rounded-[30px] border border-[#18352b]/10 bg-[linear-gradient(180deg,#fffdfa_0%,#f4ede1_100%)] p-7 shadow-[0_20px_50px_rgba(24,53,43,0.07)] md:p-9">
                            <span className="absolute left-6 top-2 text-[120px] leading-none text-[#d7853c]/12">
                                "
                            </span>
                            <div className="relative">
                                <p className="text-lg leading-9 text-[#18352b]/82 md:text-[22px]">
                                    {detail_quote}
                                </p>
                                {detail_quote_author && (
                                    <footer className="mt-6 flex items-center gap-3">
                                        <span className="h-px w-10 bg-[#d7853c]" />
                                        <cite className="text-sm not-italic text-[#18352b]/58">
                                            {detail_quote_author}
                                        </cite>
                                    </footer>
                                )}
                            </div>
                        </blockquote>
                    )}
                </div>
            </section>
        </main>
    )
}
