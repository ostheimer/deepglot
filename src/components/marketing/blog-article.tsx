import Link from "next/link";
import {
  ArrowLeft,
  Buildings,
  Clock,
} from "@phosphor-icons/react/dist/ssr";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import {
  formatBlogDate,
  getBlogArticlePath,
  type BlogPost,
} from "@/lib/blog";
import { getAustriaBrandLabel } from "@/lib/marketing-hero-locale";
import { getMarketingPath, type SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export function BlogArticle({
  locale,
  post,
  nextPost,
}: {
  locale: SiteLocale;
  post: BlogPost;
  nextPost: BlogPost;
}) {
  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#071521]">
      <MarketingNav locale={locale} active="blog" />

      <main>
        <header className="border-b border-[#d8d6ce] bg-[#f2f0ea]">
          <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 lg:py-20">
            <Link
              href={getMarketingPath(locale, "blog")}
              className="inline-flex items-center gap-2 text-sm font-bold text-[#58636d] transition-colors hover:text-[#c62812]"
            >
              <ArrowLeft className="h-4 w-4" weight="bold" />
              {uiText(locale, "All articles", "Alle Artikel")}
            </Link>
            <p className="mt-12 text-sm font-bold uppercase tracking-[0.18em] text-[#c62812]">{post.copy.category}</p>
            <h1 className="mt-5 max-w-4xl text-5xl font-extrabold leading-[1] tracking-[-0.055em] sm:text-7xl">{post.copy.title}</h1>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold text-[#69737b]">
              <span>{formatBlogDate(locale, post.publishedAt)}</span>
              <span className="flex items-center gap-2"><Clock className="h-4 w-4" />{post.readingMinutes} {uiText(locale, "min read", "Min. Lesezeit")}</span>
              <span>Deepglot Team · Austria</span>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-5xl gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_240px] lg:py-24">
          <article className="max-w-3xl">
            <p className="border-l-4 border-[#f03b22] pl-6 text-xl font-semibold leading-8 text-[#36434d]">{post.copy.excerpt}</p>
            <div className="mt-14 space-y-14">
              {post.copy.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="text-3xl font-extrabold tracking-[-0.035em]">{section.heading}</h2>
                  <div className="mt-6 space-y-5 text-lg leading-8 text-[#4d5963]">
                    {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                  </div>
                </section>
              ))}
            </div>
          </article>

          <aside className="lg:border-l lg:border-[#d8d6ce] lg:pl-8">
            <div className="sticky top-32 border-t-4 border-[#f03b22] bg-white p-6">
              <Buildings className="h-8 w-8 text-[#c62812]" weight="regular" />
              <p className="mt-5 text-sm font-bold uppercase tracking-[0.14em]">{getAustriaBrandLabel(locale)}</p>
              <p className="mt-3 text-sm leading-6 text-[#69737b]">{uiText(locale, "Open source, direct contact, and full control over your content.", "Open Source, direkter Kontakt und volle Kontrolle über deine Inhalte.")}</p>
              <a href="https://github.com/ostheimer/deepglot" target="_blank" rel="noreferrer" className="mt-5 inline-block text-sm font-bold text-[#c62812] hover:underline">GitHub →</a>
            </div>
          </aside>
        </div>

        <section className="border-t border-white/10 bg-[#071521] text-white">
          <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#f77a65]">{uiText(locale, "Read next", "Als Nächstes")}</p>
            <Link href={getBlogArticlePath(locale, nextPost.slug)} className="mt-5 block max-w-3xl text-3xl font-extrabold leading-tight tracking-[-0.04em] transition-colors hover:text-[#f77a65] sm:text-4xl">
              {nextPost.copy.title} →
            </Link>
          </div>
        </section>
      </main>

      <MarketingFooter locale={locale} />
    </div>
  );
}
