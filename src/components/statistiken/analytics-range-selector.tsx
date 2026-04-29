"use client";

type AnalyticsRangeSelectorProps = {
  ansicht: string;
  zeitraum: string;
  options: Array<{ value: string; label: string }>;
};

export function AnalyticsRangeSelector({
  ansicht,
  zeitraum,
  options,
}: AnalyticsRangeSelectorProps) {
  return (
    <form method="get">
      <input type="hidden" name="ansicht" value={ansicht} />
      <select
        name="zeitraum"
        defaultValue={zeitraum}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </form>
  );
}

