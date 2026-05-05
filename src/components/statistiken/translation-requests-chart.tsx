"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { useLocale } from "@/components/providers/locale-provider";
import { formatNumber, getDateFnsLocale } from "@/lib/locale-formatting";

interface ChartDataPoint {
  date: string; // ISO date string
  requests: number;
  langPair: string;
}

interface TranslationRequestsChartProps {
  data: ChartDataPoint[];
  granularity: "day" | "week" | "month";
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: ChartDataPoint }>;
  label?: string;
}) {
  const locale = useLocale();
  if (!active || !payload?.length || !label) return null;

  const item = payload[0];
  const date = parseISO(label);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm">
      <p className="font-semibold text-gray-900 mb-1">
        {format(date, locale === "de" ? "dd. MMM yyyy" : "MMM dd, yyyy", {
          locale: getDateFnsLocale(locale),
        })}
      </p>
      <div className="flex items-center justify-between gap-6">
        <span className="text-gray-500">{item.payload.langPair}</span>
        <span className="font-bold text-indigo-600 text-base">
          {formatNumber(item.value, locale)}
        </span>
      </div>
    </div>
  );
}

export function TranslationRequestsChart({
  data,
  granularity,
}: TranslationRequestsChartProps) {
  const locale = useLocale();
  const chartLabel =
    locale === "de"
      ? "Übersetzungsanfragen im Zeitverlauf"
      : "Translation requests over time";

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        {locale === "de"
          ? "Keine Daten für den gewählten Zeitraum vorhanden."
          : "No data available for the selected period."}
      </div>
    );
  }

  function formatXAxis(value: string) {
    try {
      const date = parseISO(value);
      if (granularity === "day") {
        return format(date, locale === "de" ? "dd. MMM" : "MMM dd", {
          locale: getDateFnsLocale(locale),
        });
      }
      if (granularity === "week") {
        return format(date, locale === "de" ? "'KW' w" : "'Wk' w", {
          locale: getDateFnsLocale(locale),
        });
      }
      return format(date, "MMM yy", { locale: getDateFnsLocale(locale) });
    } catch {
      return value;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart
        data={data}
        margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        role="img"
        aria-label={chartLabel}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tickFormatter={formatXAxis}
          tick={{ fontSize: 12, fill: "#9ca3af" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#9ca3af" }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => formatNumber(v, locale)}
          width={50}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="requests"
          stroke="#4f46e5"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 5, fill: "#4f46e5", stroke: "#fff", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
