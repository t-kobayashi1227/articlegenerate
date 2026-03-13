import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export const revalidate = 0

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const { data: a } = await supabase
        .from('cases_articles')
        .select('id,title,card_before,card_after,detail_challenge,detail_solution,detail_results,detail,detail_quote,detail_quote_author')
        .eq('id', id)
        .single()

    if (!a) return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <p className="text-slate-400">記事が見つかりません</p>
        </div>
    )

    return (
        <div className="min-h-screen bg-slate-50">

            {/* Hero — ガラス素材を背景グラデーションの上に使用 */}
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
                <div
                    className="absolute inset-0 opacity-10"
                    style={{
                        backgroundImage: `linear-gradient(rgba(99,102,241,0.4) 1px, transparent 1px),
                                         linear-gradient(90deg, rgba(99,102,241,0.4) 1px, transparent 1px)`,
                        backgroundSize: '48px 48px',
                    }}
                />
                <div className="absolute bottom-0 right-0 w-96 h-96 bg-violet-500/10 rounded-full blur-3xl" />

                <div className="relative max-w-3xl mx-auto px-6 pt-10 pb-32">
                    {/* 戻るリンク */}
                    <Link
                        href="/cases"
                        className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors duration-200 mb-8"
                    >
                        <span>←</span>
                        <span>事例一覧へ</span>
                    </Link>

                    <p className="text-indigo-400 text-xs font-bold tracking-widest uppercase mb-3">Case Study</p>
                    <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight">
                        {a.title}
                    </h1>
                </div>
            </div>

            {/* Before / After — ヒーローと本文に跨る浮遊カード (iOS glass material) */}
            <div className="max-w-3xl mx-auto px-6 -mt-16 mb-10 relative z-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Before glass card */}
                    <div className="rounded-2xl bg-white/80 backdrop-blur-md border border-white/60 shadow-xl shadow-slate-900/10 p-6">
                        <span className="inline-block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                            Before
                        </span>
                        <p className="text-slate-700 text-sm leading-relaxed">{a.card_before}</p>
                    </div>

                    {/* After glass card */}
                    <div className="rounded-2xl bg-indigo-600/90 backdrop-blur-md border border-indigo-400/30 shadow-xl shadow-indigo-900/20 p-6">
                        <span className="inline-block text-[10px] font-bold text-indigo-200 uppercase tracking-widest mb-3">
                            After
                        </span>
                        <p className="text-white text-sm leading-relaxed font-medium">{a.card_after}</p>
                    </div>
                </div>
            </div>

            {/* Body Content */}
            <div className="max-w-3xl mx-auto px-6 pb-20 space-y-5">

                {/* Challenge */}
                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-bold">01</div>
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Challenge</h2>
                    </div>
                    <p className="text-slate-700 leading-[1.9] text-[15px]">{a.detail_challenge}</p>
                </section>

                {/* Solution */}
                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-500 text-xs font-bold">02</div>
                        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Solution</h2>
                    </div>
                    <p className="text-slate-700 leading-[1.9] text-[15px]">{a.detail_solution}</p>
                </section>

                {/* Results */}
                {a.detail_results?.length > 0 && (
                    <section className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl border border-indigo-100/80 shadow-sm p-8">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold">03</div>
                            <h2 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">Results</h2>
                        </div>
                        <ul className="space-y-3">
                            {a.detail_results.map((r: string, i: number) => (
                                <li key={i} className="flex items-start gap-4">
                                    <span className="
                                        flex-shrink-0 mt-0.5 w-5 h-5 rounded-full
                                        bg-indigo-600 text-white
                                        flex items-center justify-center
                                        text-[10px] font-bold
                                    ">
                                        ✓
                                    </span>
                                    <span className="text-slate-700 text-sm leading-relaxed">{r}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* 本文 */}
                <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8">
                    <p className="text-slate-600 leading-[2] text-[15px] whitespace-pre-line">{a.detail}</p>
                </section>

                {/* Quote — 厚いglass material風ブロック */}
                {a.detail_quote && (
                    <blockquote className="relative bg-white rounded-2xl border border-slate-100 shadow-sm p-8 overflow-hidden">
                        {/* 装飾クォーテーション */}
                        <span className="absolute top-4 left-6 text-7xl text-indigo-100 font-serif leading-none select-none" aria-hidden>
                            &ldquo;
                        </span>
                        <div className="relative">
                            <p className="text-slate-700 text-base leading-[1.9] mb-5 pt-4">{a.detail_quote}</p>
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-[2px] bg-indigo-400 rounded-full" />
                                <cite className="text-sm text-slate-500 not-italic font-medium">{a.detail_quote_author}</cite>
                            </div>
                        </div>
                    </blockquote>
                )}

                {/* 戻るボタン */}
                <div className="pt-4">
                    <Link
                        href="/cases"
                        className="
                            inline-flex items-center gap-2 px-5 py-3
                            rounded-xl bg-white border border-slate-200
                            text-slate-600 text-sm font-medium
                            shadow-sm
                            transition-all duration-200
                            hover:-translate-x-1 hover:border-indigo-300 hover:text-indigo-600
                            active:scale-95
                        "
                    >
                        ← 事例一覧へ戻る
                    </Link>
                </div>
            </div>
        </div>
    )
}
