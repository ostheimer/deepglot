"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Download,
  Loader2,
  Paintbrush,
  RotateCcw,
  Search,
  Send,
  UserCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SiteLocale } from "@/lib/site-locale";
import { withLocalePrefix } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type WorkflowStatus = "machine" | "assigned" | "in_review" | "approved";

type WorkflowMember = {
  id: string;
  email: string;
  role: "ADMIN" | "TRANSLATOR";
  langCode: string | null;
  user: { name: string | null; email: string; image: string | null } | null;
};

type WorkflowTranslation = {
  id: string;
  originalText: string;
  translatedText: string;
  langFrom: string;
  langTo: string;
  source: string;
  isManual: boolean;
  wordCount: number;
  status: WorkflowStatus;
  assignedToId: string | null;
  assignedTo: WorkflowMember | null;
  updatedAt: string;
};

type WorkflowResponse = {
  items: WorkflowTranslation[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const statusStyles: Record<WorkflowStatus, string> = {
  machine: "bg-slate-100 text-slate-700",
  assigned: "bg-blue-100 text-blue-700",
  in_review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-700",
};

function statusLabel(locale: SiteLocale, status: WorkflowStatus) {
  const labels: Record<WorkflowStatus, [string, string]> = {
    machine: ["Machine", "Maschinell"],
    assigned: ["Assigned", "Zugewiesen"],
    in_review: ["In review", "In Prüfung"],
    approved: ["Approved", "Freigegeben"],
  };
  return uiText(locale, labels[status][0], labels[status][1]);
}

function memberLabel(member: WorkflowMember) {
  return member.user?.name || member.user?.email || member.email;
}

export function TranslationWorkflowPanel({
  projectId,
  languages,
  members,
  canManage,
  currentMemberId,
  locale,
}: {
  projectId: string;
  languages: Array<{ id: string; langCode: string }>;
  members: WorkflowMember[];
  canManage: boolean;
  currentMemberId: string | null;
  locale: SiteLocale;
}) {
  const [data, setData] = useState<WorkflowResponse | null>(null);
  const [status, setStatus] = useState<WorkflowStatus | "">("");
  const [langTo, setLangTo] = useState("");
  const [assignee, setAssignee] = useState("");
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const search = new URLSearchParams();
    if (status) search.set("status", status);
    if (langTo) search.set("langTo", langTo);
    if (assignee) search.set("assignee", assignee);
    if (submittedQuery) search.set("q", submittedQuery);
    search.set("page", String(page));

    try {
      const response = await fetch(
        `/api/projects/${projectId}/translations?${search.toString()}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as WorkflowResponse & { error?: string };
      if (!response.ok) throw new Error(body.error || "Request failed");
      setData(body);
    } catch {
      setError(
        uiText(
          locale,
          "The translation workflow could not be loaded.",
          "Der Übersetzungsworkflow konnte nicht geladen werden.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [assignee, langTo, locale, page, projectId, status, submittedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateTranslation(
    translationId: string,
    patch: { status?: WorkflowStatus; assignedToId?: string | null },
  ) {
    setSavingId(translationId);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/translations/${translationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const body = (await response.json()) as {
        translation?: WorkflowTranslation;
        error?: string;
      };
      if (!response.ok || !body.translation) {
        throw new Error(body.error || "Request failed");
      }
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === translationId ? body.translation! : item,
              ),
            }
          : current,
      );
    } catch {
      setError(
        uiText(
          locale,
          "The workflow change could not be saved. Reload and try again.",
          "Die Workflow-Änderung konnte nicht gespeichert werden. Lade neu und versuche es erneut.",
        ),
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-indigo-600" />
            <h2 className="text-xl font-bold text-gray-900">
              {uiText(locale, "Human review", "Menschliche Prüfung")}
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-gray-600">
            {uiText(
              locale,
              "Assign machine-translated segments, submit them for review, and explicitly approve authoritative translations.",
              "Weise maschinell übersetzte Segmente zu, reiche sie zur Prüfung ein und gib verbindliche Übersetzungen ausdrücklich frei.",
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link
              href={withLocalePrefix(
                `/projects/${projectId}/translations/visual`,
                locale,
              )}
            >
              <Paintbrush />
              {uiText(locale, "Visual editor", "Visueller Editor")}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link
              href={withLocalePrefix(
                `/projects/${projectId}/translations/import-export`,
                locale,
              )}
            >
              <Download />
              Import & Export
            </Link>
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
        {uiText(
          locale,
          "Marketplace and payment are deliberately deferred. For external professionals, use the existing export → vendor → import handoff and approve the result here.",
          "Marktplatz und Bezahlung sind bewusst vertagt. Nutze für externe Profis den bestehenden Ablauf Export → Dienstleister → Import und gib das Ergebnis anschließend hier frei.",
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <form
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_170px_180px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSubmittedQuery(query.trim());
          }}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={uiText(locale, "Search text...", "Text suchen...")}
              className="pl-9"
            />
          </div>
          <select
            value={langTo}
            onChange={(event) => {
              setPage(1);
              setLangTo(event.target.value);
            }}
            className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm"
            aria-label={uiText(locale, "Target language", "Zielsprache")}
          >
            <option value="">{uiText(locale, "All languages", "Alle Sprachen")}</option>
            {languages.map((language) => (
              <option key={language.id} value={language.langCode}>
                {language.langCode.toUpperCase()}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value as WorkflowStatus | "");
            }}
            className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm"
            aria-label="Status"
          >
            <option value="">{uiText(locale, "All statuses", "Alle Status")}</option>
            {(["machine", "assigned", "in_review", "approved"] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {statusLabel(locale, value)}
                </option>
              ),
            )}
          </select>
          {canManage ? (
            <select
              value={assignee}
              onChange={(event) => {
                setPage(1);
                setAssignee(event.target.value);
              }}
              className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm"
              aria-label={uiText(locale, "Assignee", "Zuweisung")}
            >
              <option value="">{uiText(locale, "All assignees", "Alle Zuweisungen")}</option>
              <option value="unassigned">{uiText(locale, "Unassigned", "Nicht zugewiesen")}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {memberLabel(member)}
                </option>
              ))}
            </select>
          ) : (
            <select
              value={assignee}
              onChange={(event) => {
                setPage(1);
                setAssignee(event.target.value);
              }}
              className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm"
              aria-label={uiText(locale, "Assignment filter", "Zuweisungsfilter")}
            >
              <option value="">{uiText(locale, "All segments", "Alle Segmente")}</option>
              <option value="me">{uiText(locale, "Assigned to me", "Mir zugewiesen")}</option>
            </select>
          )}
          <Button type="submit" variant="secondary">
            {uiText(locale, "Search", "Suchen")}
          </Button>
        </form>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-3">
          <span className="text-sm font-medium text-gray-700">
            {data?.total ?? 0} {uiText(locale, "segments", "Segmente")}
          </span>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
        </div>

        {!loading && data?.items.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-gray-500">
            {uiText(
              locale,
              "No translation segments match these filters.",
              "Keine Übersetzungssegmente entsprechen diesen Filtern.",
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data?.items.map((translation) => {
              const saving = savingId === translation.id;
              const eligibleMembers = members.filter(
                (member) =>
                  member.langCode === null ||
                  member.langCode.toLowerCase() === translation.langTo.toLowerCase(),
              );
              const canSubmit =
                translation.status === "assigned" &&
                translation.assignedToId === currentMemberId;

              return (
                <article key={translation.id} className="space-y-4 px-5 py-5">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {translation.langFrom.toUpperCase()} · {uiText(locale, "Original", "Original")}
                      </p>
                      <p className="text-sm text-gray-800">{translation.originalText}</p>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        {translation.langTo.toUpperCase()} · {uiText(locale, "Translation", "Übersetzung")}
                      </p>
                      <p className="text-sm text-gray-800">{translation.translatedText}</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={statusStyles[translation.status]}>
                        {statusLabel(locale, translation.status)}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {translation.assignedTo
                          ? memberLabel(translation.assignedTo)
                          : uiText(locale, "Unassigned", "Nicht zugewiesen")}
                      </span>
                      <span className="text-xs text-gray-400">
                        {translation.wordCount} {uiText(locale, "words", "Wörter")}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {canManage && (
                        <select
                          value={translation.assignedToId ?? ""}
                          disabled={saving}
                          onChange={(event) =>
                            void updateTranslation(translation.id, {
                              assignedToId: event.target.value || null,
                            })
                          }
                          className="h-8 max-w-52 rounded-md border border-gray-200 bg-white px-2 text-xs"
                          aria-label={uiText(locale, "Assign segment", "Segment zuweisen")}
                        >
                          <option value="">{uiText(locale, "Unassigned", "Nicht zugewiesen")}</option>
                          {eligibleMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {memberLabel(member)}
                            </option>
                          ))}
                        </select>
                      )}

                      {(canManage || canSubmit) && translation.status === "assigned" && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={saving}
                          onClick={() =>
                            void updateTranslation(translation.id, {
                              status: "in_review",
                            })
                          }
                        >
                          <Send />
                          {uiText(locale, "Submit for review", "Zur Prüfung einreichen")}
                        </Button>
                      )}
                      {canManage && translation.status === "in_review" && (
                        <>
                          <Button
                            size="xs"
                            disabled={saving}
                            onClick={() =>
                              void updateTranslation(translation.id, {
                                status: "approved",
                              })
                            }
                          >
                            <CheckCircle2 />
                            {uiText(locale, "Approve", "Freigeben")}
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={saving}
                            onClick={() =>
                              void updateTranslation(translation.id, {
                                status: "assigned",
                              })
                            }
                          >
                            <RotateCcw />
                            {uiText(locale, "Return", "Zurückgeben")}
                          </Button>
                        </>
                      )}
                      {canManage && translation.status === "approved" && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={saving}
                          onClick={() =>
                            void updateTranslation(translation.id, {
                              status: "assigned",
                            })
                          }
                        >
                          <RotateCcw />
                          {uiText(locale, "Reopen", "Erneut bearbeiten")}
                        </Button>
                      )}
                      {saving && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {uiText(locale, "Page", "Seite")} {data.page} {locale === "de" ? "von" : "of"}{" "}
            {data.totalPages}
          </p>
          <div className="flex gap-2">
            {data.page > 1 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                {uiText(locale, "Previous", "Zurück")}
              </Button>
            )}
            {data.page < data.totalPages && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => setPage((current) => current + 1)}
              >
                {uiText(locale, "Next", "Weiter")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
