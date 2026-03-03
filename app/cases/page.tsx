import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export const revalidate = 0

export default async function CasesPage() {
    const { data } = await supabase
        .from('cases_articles')
        .select('id, title, card_before, card_after')
        .eq('status', '公開')
        .order('published_at', { ascending: false })

    return (
        <div className="min-h-screen bg-slate-50">

            {/* Hero Header */}
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
                {/* 背景グリッドパターン */}
                <div
                    className="absolute inset-0 opacity-20"
                    style={{
                        backgroundImage: `linear-gradient(rgba(99,102,241,0.3) 1px, transparent 1px),
                                         linear-gradient(90deg, rgba(99,102,241,0.3) 1px, transparent 1px)`,
                        backgroundSize: '48px 48px',
                    }}
                />
                {/* グロー */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-indigo-500/20 rounded-full blur-3xl" />

                <div className="relative max-w-6xl mx-auto px-6 py-20">
                    <p className="text-indigo-400 text-sm font-semibold tracking-widest uppercase mb-3">Case Studies</p>
                    <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
                        導入事例
                    </h1>
                    <p className="text-slate-400 text-lg max-w-xl">
                        お客様の課題をどのように解決してきたか、実際の成果をご紹介します。
                    </p>
                </div>
            </div>

            {/* Cards Grid */}
            <div className="max-w-6xl mx-auto px-6 py-16">
                {data && data.length > 0 ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-6">
                        {data.map((a, i) => (
                            <Link
                                href={`/cases/${a.id}`}
                                key={a.id}
                                className="group"
                                style={{ animationDelay: `${i * 60}ms` }}
                            >
                                <article className="
                                    relative bg-white rounded-2xl overflow-hidden h-full flex flex-col
                                    shadow-sm border border-slate-200/80
                                    transition-all duration-300 ease-out
                                    hover:-translate-y-2 hover:shadow-xl hover:shadow-indigo-100/60
                                    hover:border-indigo-200
                                ">
                                    {/* カード上部アクセントライン */}
                                    <div className="h-1 bg-gradient-to-r from-indigo-500 to-violet-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                                    <div className="p-6 flex flex-col flex-1">
                                        {/* タイトル */}
                                        <h2 className="font-bold text-slate-900 text-base leading-snug mb-6 group-hover:text-indigo-700 transition-colors duration-200">
                                            {a.title}
                                        </h2>

                                        {/* Before / After */}
                                        <div className="mt-auto space-y-2">
                                            <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                                                <span className="inline-block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                                                    Before
                                                </span>
                                                <p className="text-sm text-slate-600 leading-relaxed">{a.card_before}</p>
                                            </div>

                                            <div className="flex justify-center">
                                                <span className="text-slate-300 text-sm">↓</span>
                                            </div>

                                            <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4">
                                                <span className="inline-block text-[10px] font-bold text-indigo-500 uppercase tracking-widest mb-2">
                                                    After
                                                </span>
                                                <p className="text-sm text-indigo-900 leading-relaxed font-medium">{a.card_after}</p>
                                            </div>
                                        </div>

                                        {/* 詳細リンク */}
                                        <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                                            <span className="text-xs text-slate-400">詳細を見る</span>
                                            <span className="text-indigo-500 text-sm transition-transform duration-200 group-hover:translate-x-1">→</span>
                                        </div>
                                    </div>
                                </article>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-32">
                        <p className="text-slate-400 text-lg">事例がまだありません</p>
                    </div>
                )}
            </div>
        </div>
    )
}
