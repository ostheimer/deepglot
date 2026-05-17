"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Languages,
  Globe,
  Paintbrush,
  BookOpen,
  Download,
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
import {
  canAccessProjectArea,
  canManageProject,
  type ProjectAccessContext,
} from "@/lib/project-access-policy";
import { withLocalePrefix } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

interface ProjectSidebarProps {
  project: {
    id: string;
    name: string;
    domain: string;
    originalLang: string;
    languages: { id: string; langCode: string; isActive: boolean }[];
    _count: { translations: number };
  };
  access: ProjectAccessContext;
}

export function ProjectSidebar({ project, access }: ProjectSidebarProps) {
  const locale = useLocale();
  const pathname = usePathname();
  const projectPath = (suffix = "") => withLocalePrefix(`/projects/${project.id}${suffix}`, locale);
  const canManage = canManageProject(access);
  const canViewAnalytics = canAccessProjectArea(access, "analytics");

  const nav = [
    {
      label: uiText(locale, "Translations", "Übersetzungen"),
      items: [
        { href: projectPath("/translations/languages"), label: uiText(locale, "Languages", "Sprachen"), icon: Languages },
        { href: projectPath("/translations/urls"), label: "URLs", icon: Globe },
        { href: projectPath("/translations/visual"), label: uiText(locale, "Visual Editor", "Visueller Editor"), icon: Paintbrush },
        { href: projectPath("/translations/glossary"), label: uiText(locale, "Glossary", "Glossar"), icon: BookOpen },
        { href: projectPath("/translations/import-export"), label: "Import & Export", icon: Download },
        { href: projectPath("/translations/slugs"), label: "URL Slugs", icon: Link2 },
      ],
    },
    {
      label: uiText(locale, "Analytics", "Statistiken"),
      hidden: !canViewAnalytics,
      items: [
        { href: projectPath("/stats/requests"), label: uiText(locale, "Translation Requests", "Übersetzungsanfragen"), icon: BarChart2 },
        { href: projectPath("/stats/page-views"), label: uiText(locale, "Page Views", "Seitenaufrufe"), icon: Eye },
      ],
    },
    {
      label: uiText(locale, "Settings", "Einstellungen"),
      hidden: !canManage,
      items: [
        { href: projectPath("/settings"), label: uiText(locale, "General", "Allgemein"), icon: Settings },
        { href: projectPath("/settings/language-model"), label: uiText(locale, "Language Model", "Sprachmodell"), icon: Cpu, badge: uiText(locale, "New", "Neu") },
        { href: projectPath("/settings/switcher"), label: uiText(locale, "Language Switcher", "Sprachauswahl"), icon: Globe },
        { href: projectPath("/settings/exclusions"), label: uiText(locale, "Exclusions", "Ausnahmen"), icon: ShieldOff },
        { href: projectPath("/settings/setup"), label: "Setup", icon: Wrench },
        { href: projectPath("/settings/wordpress"), label: "WordPress", icon: Plug },
        { href: projectPath("/settings/webhooks"), label: "Webhooks", icon: Plug },
        { href: projectPath("/settings/members"), label: uiText(locale, "Project Members", "Projektmitglieder"), icon: Users },
        { href: projectPath("/api-keys"), label: "API Keys", icon: Key },
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
          {uiText(locale, "All Projects", "Alle Projekte")}
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
        {nav.filter((section) => !("hidden" in section && section.hidden)).map((section) => (
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
