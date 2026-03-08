"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Languages,
  Globe,
  Paintbrush,
  BookOpen,
  UserCog,
  Link2,
  BarChart2,
  Eye,
  Settings,
  Key,
  ArrowLeft,
  Cpu,
  ShieldOff,
  Wrench,
  Plug,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/components/providers/locale-provider";
import { withLocalePrefix } from "@/lib/site-locale";

interface ProjectSidebarProps {
  project: {
    id: string;
    name: string;
    domain: string;
    originalLang: string;
    languages: { id: string; langCode: string; isActive: boolean }[];
    _count: { translations: number };
  };
}

export function ProjectSidebar({ project }: ProjectSidebarProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const base = withLocalePrefix(`/projects/${project.id}`, locale);

  const nav = [
    {
      label: locale === "de" ? "Übersetzungen" : "Translations",
      items: [
        { href: `${base}/translations/languages`, label: locale === "de" ? "Sprachen" : "Languages", icon: Languages },
        { href: `${base}/translations/urls`, label: "URLs", icon: Globe },
        { href: `${base}/translations/visual`, label: locale === "de" ? "Visueller Editor" : "Visual Editor", icon: Paintbrush },
        { href: `${base}/translations/glossary`, label: locale === "de" ? "Glossar" : "Glossary", icon: BookOpen },
        { href: `${base}/translations/pros`, label: locale === "de" ? "Profi-Übersetzungen" : "Professional Translation", icon: UserCog },
        { href: `${base}/translations/slugs`, label: "URL Slugs", icon: Link2 },
      ],
    },
    {
      label: locale === "de" ? "Statistiken" : "Analytics",
      items: [
        { href: `${base}/stats/requests`, label: locale === "de" ? "Übersetzungsanfragen" : "Translation Requests", icon: BarChart2 },
        { href: `${base}/stats/page-views`, label: locale === "de" ? "Seitenaufrufe" : "Page Views", icon: Eye },
      ],
    },
    {
      label: locale === "de" ? "Einstellungen" : "Settings",
      items: [
        { href: `${base}/settings`, label: locale === "de" ? "Allgemein" : "General", icon: Settings },
        { href: `${base}/settings/language-model`, label: locale === "de" ? "Sprachmodell" : "Language Model", icon: Cpu, badge: locale === "de" ? "Neu" : "New" },
        { href: `${base}/settings/switcher`, label: locale === "de" ? "Sprachauswahl" : "Language Switcher", icon: Globe },
        { href: `${base}/settings/exclusions`, label: locale === "de" ? "Ausnahmen" : "Exclusions", icon: ShieldOff },
        { href: `${base}/settings/setup`, label: "Setup", icon: Wrench },
        { href: `${base}/settings/wordpress`, label: "WordPress", icon: Plug },
        { href: `${base}/settings/members`, label: locale === "de" ? "Projektmitglieder" : "Project Members", icon: Users },
        { href: `${base}/api-keys`, label: "API Keys", icon: Key },
      ],
    },
  ];

  return (
    <aside className="w-56 bg-white border-r border-gray-200 min-h-screen flex-shrink-0 py-6 flex flex-col">
      {/* Back + Project info */}
      <div className="px-4 mb-6">
        <Link
          href={withLocalePrefix("/projects", locale)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 mb-4 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          {locale === "de" ? "Alle Projekte" : "All Projects"}
        </Link>
        <div>
          <p className="font-semibold text-gray-900 text-sm truncate">{project.name}</p>
          <p className="text-xs text-gray-500 truncate">{project.domain}</p>
        </div>
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <Badge className="text-xs bg-gray-100 text-gray-600 border-0 px-1.5 py-0">
            {project.originalLang.toUpperCase()}
          </Badge>
          {project.languages.slice(0, 3).map((l) => (
            <Badge
              key={l.id}
              className="text-xs bg-indigo-50 text-indigo-600 border-0 px-1.5 py-0"
            >
              {l.langCode.toUpperCase()}
            </Badge>
          ))}
          {project.languages.length > 3 && (
            <span className="text-xs text-gray-400">+{project.languages.length - 3}</span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-5">
        {nav.map((section) => (
          <div key={section.label}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2 mb-1.5">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link href={item.href}>
                      <div
                        className={cn(
                          "flex items-center justify-between px-2 py-1.5 rounded-md text-sm transition-colors",
                          isActive
                            ? "bg-indigo-50 text-indigo-700 font-medium"
                            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <item.icon className="h-3.5 w-3.5" />
                          {item.label}
                        </span>
                        {"badge" in item && item.badge && (
                          <Badge className="text-xs py-0 px-1.5 bg-indigo-600 text-white border-0">
                            {item.badge}
                          </Badge>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
