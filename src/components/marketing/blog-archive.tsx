import Link from "next/link";
import {
  ArrowRight,
  Buildings,
  Clock,
  Notebook,
} from "@phosphor-icons/react/dist/ssr";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import {
  formatBlogDate,
  getBlogArticlePath,
  getBlogPosts,
} from "@/lib/blog";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

export function BlogArchive({ locale }: { locale: SiteLocale }) {
  const posts = getBlogPosts(locale);
  const [featured, ...rest] = posts;

  return (
    <div className="min-h-screen bg-[#fbfaf7] text-[#071521]">
      <MarketingNav locale={locale} active="blog" />

      <main>
        <header className="overflow-hidden border-b border-white/10 bg-[#071521] text-white">
          <div className="mx-auto grid max-w-[1488px] gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1fr_340px] lg:px-10 lg:py-24 xl:px-14">
            <div className="max-w-4xl">
              <p className="flex items-center gap-3 text-sm font-bold uppercase tracking-[0.18em] text-[#f77a65]">
                <Notebook className="h-6 w-6" weight="regular" />
                Deepglot Journal
              </p>
              <h1 className="mt-6 text-5xl font-extrabold leading-[0.98] tracking-[-0.055em] sm:text-7xl">
                {uiText(locale, "Ideas for an open, multilingual web.", "Ideen für ein offenes, mehrsprachiges Web.")}
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-white/65">
                {uiText(
                  locale,
                  "Product decisions, WordPress engineering, and lessons from building a translation platform in Austria.",
                  "Produktentscheidungen, WordPress Engineering und Erfahrungen aus dem Aufbau einer Übersetzungsplattform in Österreich."
                )}
              </p>
            </div>
            <div className="flex flex-col justify-end border-l border-white/20 pl-8">
              <Buildings className="h-10 w-10 text-[#f03b22]" weight="regular" />
              <p className="mt-5 text-sm font-bold uppercase tracking-[0.16em]">
                {uiText(locale, "Notes from Austria", "Notizen aus Österreich")}
              </p>
              <p className="mt-3 text-sm leading-6 text-white/55">
                {uiText(
                  locale,
                  "Specific, practical, and written by the people building Deepglot.",
                  "Konkret, praxisnah und von den Menschen geschrieben, die Deepglot entwickeln."
                )}
              </p>
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-[1488px] px-5 py-16 sm:px-8 lg:px-10 lg:py-24 xl:px-14">
          <p className="mb-8 text-sm font-bold uppercase tracking-[0.18em] text-[#f03b22]">
            {uiText(locale, "Latest articles", "Neueste Artikel")}
          </p>

          <article className="grid overflow-hidden border border-[#d8d6ce] bg-white lg:grid-cols-[0.82fr_1.18fr]">
            <div className="flex min-h-72 flex-col justify-between bg-[#f03b22] p-8 text-white sm:p-10">
              <span className="text-7xl font-extrabold tracking-[-0.07em] text-white/30">01</span>
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.16em]">{featured.copy.category}</p>
                <p className="mt-4 flex items-center gap-2 text-sm text-white/75">
                  <Clock className="h-4 w-4" />
                  {featured.readingMinutes} {uiText(locale, "min read", "Min. Lesezeit")}
                </p>
              </div>
            </div>
            <div className="flex flex-col justify-center p-8 sm:p-12 lg:p-16">
              <p className="text-sm font-semibold text-[#69737b]">{formatBlogDate(locale, featured.publishedAt)}</p>
              <h2 className="mt-5 text-4xl font-extrabold leading-[1.04] tracking-[-0.045em] sm:text-5xl">
                {featured.copy.title}
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-[#58636d]">{featured.copy.excerpt}</p>
              <Link
                href={getBlogArticlePath(locale, featured.slug)}
                className="mt-8 inline-flex w-fit items-center gap-3 font-bold text-[#f03b22] transition-colors hover:text-[#c62812]"
              >
                {uiText(locale, "Read article", "Artikel lesen")}
                <ArrowRight className="h-5 w-5" weight="bold" />
              </Link>
            </div>
          </article>

          <div className="mt-8 grid gap-8 md:grid-cols-2">
            {rest.map((post, index) => (
              <article key={post.id} className="flex min-h-[420px] flex-col border-t-4 border-[#f03b22] bg-[#f2f0ea] p-8 sm:p-10">
                <div className="flex items-start justify-between gap-6">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f03b22]">{post.copy.category}</p>
                  <span className="text-5xl font-extrabold tracking-[-0.06em] text-[#071521]/12">0{index + 2}</span>
                </div>
                <h2 className="mt-10 text-3xl font-extrabold leading-[1.08] tracking-[-0.04em]">{post.copy.title}</h2>
                <p className="mt-5 leading-7 text-[#58636d]">{post.copy.excerpt}</p>
                <div className="mt-auto flex items-end justify-between gap-4 pt-10">
                  <p className="text-sm text-[#69737b]">
                    {formatBlogDate(locale, post.publishedAt)} · {post.readingMinutes} {uiText(locale, "min", "Min.")}
                  </p>
                  <Link
                    href={getBlogArticlePath(locale, post.slug)}
                    aria-label={`${uiText(locale, "Read article", "Artikel lesen")}: ${post.copy.title}`}
                    className="grid h-11 w-11 shrink-0 place-items-center bg-[#071521] text-white transition-colors hover:bg-[#f03b22]"
                  >
                    <ArrowRight className="h-5 w-5" weight="bold" />
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter locale={locale} />
    </div>
  );
}
