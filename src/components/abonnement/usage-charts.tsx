"use client";

import Link from "next/link";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const PIE_COLORS = ["#8b5cf6", "#fbbf24", "#34d399", "#60a5fa", "#f87171", "#a78bfa"];

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  words: number;
  requests: number;
  languages: number;
  members: number;
}

interface Props {
  totalWords: number;
  wordsLimit: number;
  totalRequests: number;
  requestsLimit: number;
  pieWordData: { name: string; value: number }[];
  pieRequestData: { name: string; value: number }[];
  projectRows: ProjectRow[];
  projectCount: number;
  projectsLimit: number;
  membersCount: number;
  membersLimit: number;
  langLimitPerProject: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { name: string; value: number } }> }) {
  if (!active || !payload?.length) return null;
  const total = payload[0]?.payload?.value ?? 0;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg">
      <p className="font-semibold">{payload[0]?.payload?.name}</p>
      <p>{payload[0]?.payload?.name}: {total.toLocaleString("de-AT")}</p>
    </div>
  );
}

export function UsageCharts({
  totalWords,
  wordsLimit,
  totalRequests,
  requestsLimit,
  pieWordData,
  pieRequestData,
  projectRows,
  projectCount,
  projectsLimit,
  membersCount,
  membersLimit,
  langLimitPerProject,
}: Props) {
  const wordsPercent = wordsLimit > 0 ? Math.min((totalWords / wordsLimit) * 100, 100) : 0;

  return (
    <div className="space-y-5">
      {/* Pie charts side by side */}
      <div className="grid grid-cols-2 gap-5">
        {/* Word Usage */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-semibold text-gray-900">Gesamte Wörter-Nutzung</p>
            <p className="text-sm font-semibold text-indigo-600">
              {totalWords.toLocaleString("de-AT")} / {wordsLimit.toLocaleString("de-AT")}
            </p>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-4">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all"
              style={{ width: `${wordsPercent}%` }}
            />
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Aufschlüsselung über {pieWordData.length} Projekt{pieWordData.length !== 1 ? "e" : ""}
          </p>

          {pieWordData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieWordData}
                  cx="50%"
                  cy="50%"
                  innerRadius={0}
                  outerRadius={90}
                  dataKey="value"
                  strokeWidth={2}
                >
                  {pieWordData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center">
              <p className="text-sm text-gray-400">Noch keine Wörter übersetzt</p>
            </div>
          )}
        </div>

        {/* Translation Requests */}
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm font-semibold text-gray-900">Übersetzungs-Anfragen gesamt</p>
            <p className="text-sm font-semibold text-indigo-600">
              {totalRequests.toLocaleString("de-AT")}
            </p>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Aufschlüsselung über {pieRequestData.length} Projekt{pieRequestData.length !== 1 ? "e" : ""}
          </p>

          {pieRequestData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieRequestData}
                  cx="50%"
                  cy="50%"
                  innerRadius={0}
                  outerRadius={90}
                  dataKey="value"
                  strokeWidth={2}
                >
                  {pieRequestData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center">
              <p className="text-sm text-gray-400">Noch keine Anfragen</p>
            </div>
          )}
        </div>
      </div>

      {/* Projects table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Projekte</h2>
          <span className="text-sm text-indigo-600 font-medium">
            {projectCount} / {projectsLimit}
          </span>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_100px] gap-3 px-6 py-2.5 bg-gray-50 border-b border-gray-200">
          {["Projektname", "Website", "Wörter", "Anfragen", "Sprachen", "Mitglieder", "Aktionen"].map(
            (h) => (
              <span key={h} className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {h}
              </span>
            )
          )}
        </div>

        {projectRows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-400">Noch keine Projekte</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {projectRows.map((p, i) => (
              <div
                key={p.id}
                className="grid grid-cols-[2fr_1.5fr_1fr_1fr_1fr_1fr_100px] gap-3 px-6 py-4 items-center hover:bg-gray-50 transition-colors"
              >
                {/* Project name */}
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="text-sm font-medium text-gray-900 truncate">{p.domain}</span>
                </div>

                {/* Website */}
                <span className="text-sm text-gray-600 truncate">{p.domain}</span>

                {/* Words */}
                <span className="text-sm text-gray-700">{p.words.toLocaleString("de-AT")}</span>

                {/* Requests */}
                <span className="text-sm text-gray-700">{p.requests.toLocaleString("de-AT")}</span>

                {/* Languages */}
                <span className="text-sm text-gray-700">
                  {p.languages} / {langLimitPerProject}
                </span>

                {/* Members */}
                <span className="text-sm text-gray-700">
                  {membersCount} / {membersLimit}
                </span>

                {/* Actions */}
                <Link
                  href={`/projekte/${p.id}/uebersetzungen/sprachen`}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Details anzeigen
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
