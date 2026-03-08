"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { getLanguageName } from "@/lib/language-names";
import { Trash2, Edit2 } from "lucide-react";

interface GlossaryRule {
  id: string;
  originalTerm: string;
  translatedTerm: string;
  langFrom: string;
  langTo: string;
  caseSensitive: boolean;
}

interface GlossaryTableProps {
  rules: GlossaryRule[];
  projectId: string;
  languages: { id: string; langCode: string }[];
  originalLang: string;
}

export function GlossaryTable({ rules }: GlossaryTableProps) {
  const locale = useLocale();

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="grid grid-cols-[2fr_2fr_1fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          ORIGINAL
        </span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {locale === "de" ? "ÜBERSETZUNG" : "TRANSLATION"}
        </span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {locale === "de" ? "SPRACHE" : "LANGUAGE"}
        </span>
        <span></span>
      </div>

      {rules.map((rule) => (
        <div
          key={rule.id}
          className="grid grid-cols-[2fr_2fr_1fr_auto] gap-4 px-6 py-3.5 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 group"
        >
          <div>
            <p className="text-sm font-medium text-gray-900">{rule.originalTerm}</p>
            {rule.caseSensitive && (
              <Badge variant="outline" className="text-xs mt-1">
                {locale === "de" ? "Groß-/Kleinschreibung" : "Case-sensitive"}
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-700">{rule.translatedTerm}</p>
          <Badge variant="secondary" className="w-fit text-xs">
            {getLanguageName(rule.langFrom, locale)} → {getLanguageName(rule.langTo, locale)}
          </Badge>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <Edit2 className="h-3.5 w-3.5 text-gray-400" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
