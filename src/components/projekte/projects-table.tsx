"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  ArrowUp,
  ArrowDown,
  Plus,
  MoreVertical,
  Settings,
  Trash2,
  Copy,
  ExternalLink,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLocale } from "@/components/providers/locale-provider";
import { formatNumber } from "@/lib/locale-formatting";
import { withLocalePrefix } from "@/lib/site-locale";

export type ProjectRow = {
  id: string;
  name: string;
  domain: string;
  originalLang: string;
  updatedAt: Date;
  totalWords: number;
  languagesCount: number;
  manualTranslations: number;
  totalTranslations: number;
  members: Array<{ name?: string | null; email?: string | null; image?: string | null }>;
};

type SortKey = "name" | "totalWords" | "languagesCount";
type SortDir = "asc" | "desc";

interface Props {
  projects: ProjectRow[];
}

export function ProjectsTable({ projects }: Props) {
  const locale = useLocale();
  const router = useRouter();
  const [referenceTime] = useState(() => Date.now());
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return projects
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.domain.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        let cmp = 0;
        if (sortKey === "name") cmp = a.name.localeCompare(b.name);
        else if (sortKey === "totalWords") cmp = a.totalWords - b.totalWords;
        else if (sortKey === "languagesCount") cmp = a.languagesCount - b.languagesCount;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [projects, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  async function handleDelete(id: string) {
    if (
      !confirm(
        locale === "de"
          ? "Projekt wirklich löschen? Alle Übersetzungen gehen verloren."
          : "Delete this project? All translations will be lost."
      )
    ) {
      return;
    }
    setDeletingId(id);
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    router.refresh();
    setDeletingId(null);
  }

  // Status dot based on last activity
  function statusDot(updatedAt: Date) {
    const mins = (referenceTime - updatedAt.getTime()) / 60000;
    if (mins < 60 * 24) return "bg-green-500";
    if (mins < 60 * 24 * 60) return "bg-yellow-400";
    return "bg-gray-300";
  }

  function renderSortIcon(key: SortKey) {
    if (sortKey !== key) {
      return null;
    }

    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 text-indigo-600" />
      : <ArrowDown className="h-3 w-3 text-indigo-600" />;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{locale === "de" ? "Projekte" : "Projects"}</h1>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder={locale === "de" ? "Projekt suchen" : "Search project"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 pr-4 h-9 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-52"
            />
          </div>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 h-9 px-3 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors">
                <ArrowUp className="h-3.5 w-3.5 text-gray-500" />
                <span className="text-gray-700">
                  {locale === "de" ? "Sortieren nach" : "Sort by"}{" "}
                  <span className="font-medium">
                    {sortKey === "name"
                      ? locale === "de"
                        ? "Name"
                        : "Name"
                      : sortKey === "totalWords"
                        ? locale === "de"
                          ? "Wörter"
                          : "Words"
                        : locale === "de"
                          ? "Sprachen"
                          : "Languages"}
                  </span>
                </span>
                <ArrowDown className="h-3 w-3 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleSort("name")}>
                Name {renderSortIcon("name")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("totalWords")}>
                {locale === "de" ? "Gesamtwörter" : "Total words"} {renderSortIcon("totalWords")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleSort("languagesCount")}>
                {locale === "de" ? "Sprachen" : "Languages"} {renderSortIcon("languagesCount")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Create */}
          <Link href={withLocalePrefix("/projects/new", locale)}>
            <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2 h-9">
              <Plus className="h-4 w-4" />
              {locale === "de" ? "Projekt erstellen" : "Create project"}
            </Button>
          </Link>
        </div>
      </div>

      {projects.length === 0 ? (
        /* Empty state */
        <div className="border border-dashed border-gray-300 rounded-xl py-20 text-center">
          <Globe className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-gray-700 mb-1">
            {locale === "de" ? "Noch kein Projekt" : "No project yet"}
          </h3>
          <p className="text-sm text-gray-500 mb-5 max-w-xs mx-auto">
            {locale === "de"
              ? "Erstelle dein erstes Projekt und verbinde dein WordPress-Plugin."
              : "Create your first project and connect your WordPress plugin."}
          </p>
          <Link href={withLocalePrefix("/projects/new", locale)}>
            <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
              <Plus className="h-4 w-4" />
              {locale === "de" ? "Erstes Projekt erstellen" : "Create first project"}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Result count */}
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm text-gray-500">
              {filtered.length}{" "}
              {locale === "de"
                ? `Ergebnis${filtered.length !== 1 ? "se" : ""}`
                : `result${filtered.length !== 1 ? "s" : ""}`}
            </p>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[2fr_130px_100px_120px_200px_40px] gap-x-4 px-5 py-2.5 bg-gray-50 border-b border-gray-200">
            <button
              className="flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left hover:text-gray-900 transition-colors"
              onClick={() => toggleSort("name")}
            >
              Name {renderSortIcon("name")}
            </button>
            <button
              className="flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-900 transition-colors"
              onClick={() => toggleSort("totalWords")}
            >
              {locale === "de" ? "Gesamtwörter" : "Total words"} {renderSortIcon("totalWords")}
            </button>
            <button
              className="flex items-center gap-1 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-900 transition-colors"
              onClick={() => toggleSort("languagesCount")}
            >
              {locale === "de" ? "Sprachen" : "Languages"} {renderSortIcon("languagesCount")}
            </button>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {locale === "de" ? "Mitglieder" : "Members"}
            </span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {locale === "de" ? "Manuelle Übersetzungen" : "Manual translations"}
            </span>
            <span />
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-gray-400">
                {locale === "de" ? "Keine Ergebnisse für" : "No results for"} <span>&quot;{query}&quot;</span>
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((project) => {
                const manualPct =
                  project.totalTranslations > 0
                    ? Math.round((project.manualTranslations / project.totalTranslations) * 100)
                    : 0;

                return (
                  <div
                    key={project.id}
                    className="grid grid-cols-[2fr_130px_100px_120px_200px_40px] gap-x-4 px-5 py-4 items-center hover:bg-gray-50 transition-colors"
                  >
                    {/* Name + Domain */}
                    <Link
                      href={withLocalePrefix(`/projects/${project.id}/translations/languages`, locale)}
                      className="flex items-center gap-3 min-w-0 group"
                    >
                      <div
                        className={`flex-shrink-0 h-2 w-2 rounded-full ${statusDot(project.updatedAt)}`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
                          {project.domain}
                        </p>
                        <p className="text-xs text-gray-400 truncate">
                          https://{project.domain}
                        </p>
                      </div>
                    </Link>

                    {/* Total Words */}
                    <span className="text-sm text-gray-700">
                      {formatNumber(project.totalWords, locale)}
                    </span>

                    {/* Languages */}
                    <span className="text-sm text-gray-700">
                      {project.languagesCount}
                    </span>

                    {/* Members */}
                    <div className="flex items-center gap-1">
                      {project.members.slice(0, 4).map((m, i) => (
                        <div
                          key={i}
                          className="h-7 w-7 rounded-full border-2 border-white shadow-sm bg-indigo-100 flex items-center justify-center -ml-1 first:ml-0"
                          style={{ zIndex: 10 - i }}
                          title={m.name ?? m.email ?? ""}
                        >
                          {m.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.image}
                              alt={m.name ?? ""}
                              className="h-7 w-7 rounded-full object-cover"
                            />
                          ) : (
                            <span className="text-xs font-bold text-indigo-700">
                              {(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      ))}
                      {project.members.length > 4 && (
                        <span className="text-xs text-gray-500 ml-1">
                          +{project.members.length - 4}
                        </span>
                      )}
                    </div>

                    {/* Manual Translations */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-700">
                        {formatNumber(project.manualTranslations, locale)} /{" "}
                        {formatNumber(project.totalTranslations, locale)}
                      </span>
                      <span className="text-sm font-medium text-indigo-600">{manualPct}%</span>
                    </div>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-100 transition-colors">
                          <MoreVertical className="h-4 w-4 text-gray-400" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem asChild>
                          <Link href={withLocalePrefix(`/projects/${project.id}/translations/languages`, locale)} className="flex items-center gap-2">
                            <ExternalLink className="h-3.5 w-3.5" />
                            {locale === "de" ? "Öffnen" : "Open"}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={withLocalePrefix(`/projects/${project.id}/settings`, locale)} className="flex items-center gap-2">
                            <Settings className="h-3.5 w-3.5" />
                            {locale === "de" ? "Einstellungen" : "Settings"}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem className="flex items-center gap-2 cursor-pointer">
                          <Copy className="h-3.5 w-3.5" />
                          {locale === "de" ? "Duplizieren" : "Duplicate"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="flex items-center gap-2 text-red-600 focus:text-red-600 cursor-pointer"
                          onClick={() => handleDelete(project.id)}
                          disabled={deletingId === project.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deletingId === project.id
                            ? locale === "de"
                              ? "Löschen…"
                              : "Deleting..."
                            : locale === "de"
                              ? "Löschen"
                              : "Delete"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
