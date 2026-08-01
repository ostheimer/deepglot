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
  FileText,
  UserCheck,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
        { href: projectPath("/translations/pros"), label: uiText(locale, "Human Review", "Menschliche Prüfung"), icon: UserCheck },
        { href: projectPath("/translations/glossary"), label: uiText(locale, "Glossary", "Glossar"), icon: BookOpen },
        { href: projectPath("/translations/import-export"), label: "Import & Export", icon: Download },
        { href: projectPath("/translations/pdf"), label: locale === "de" ? "PDF-Übersetzung" : "PDF translation", icon: FileText },
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

  const sidebarContent = (mobile: boolean) => {
    const backLink = (
      <Link
        href={withLocalePrefix("/projects", locale)}
        className="mb-4 flex items-center gap-1.5 text-xs text-gray-500 transition-colors hover:text-gray-700"
      >
        <ArrowLeft className="h-3 w-3" />
        {uiText(locale, "All Projects", "Alle Projekte")}
      </Link>
    );

    return (
      <div className="flex h-full min-h-0 flex-col bg-[#f5f3ed] py-6">
        <div className="mb-6 px-4">
          {mobile ? <SheetClose asChild>{backLink}</SheetClose> : backLink}
          <div>
            <p className="truncate text-sm font-semibold text-gray-900">{project.name}</p>
            <p className="truncate text-xs text-gray-500">{project.domain}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge className="border-0 bg-gray-100 px-1.5 py-0 text-xs text-gray-600">
              {project.originalLang.toUpperCase()}
            </Badge>
            {project.languages.slice(0, 3).map((l) => (
              <Badge
                key={l.id}
                className="border-0 bg-brand-50 px-1.5 py-0 text-xs text-brand-700"
              >
                {l.langCode.toUpperCase()}
              </Badge>
            ))}
            {project.languages.length > 3 && (
              <span className="text-xs text-gray-400">+{project.languages.length - 3}</span>
            )}
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3">
          {nav.filter((section) => !("hidden" in section && section.hidden)).map((section) => (
            <div key={section.label}>
              <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  const link = (
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-brand-50 font-medium text-brand-700"
                          : "text-[#58636d] hover:bg-white hover:text-[#071521]"
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span className="flex items-center gap-2">
                        <item.icon className="h-3.5 w-3.5" />
                        {item.label}
                      </span>
                      {"badge" in item && item.badge && (
                        <Badge className="border-0 bg-brand-600 px-1.5 py-0 text-xs text-white">
                          {item.badge}
                        </Badge>
                      )}
                    </Link>
                  );

                  return (
                    <li key={item.href}>
                      {mobile ? <SheetClose asChild>{link}</SheetClose> : link}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    );
  };

  return (
    <>
      <header className="flex items-center justify-between border-b border-[#d8d6ce] bg-[#f5f3ed] px-4 py-3 lg:hidden">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{project.name}</p>
          <p className="truncate text-xs text-gray-500">{project.domain}</p>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="ml-4 flex-shrink-0 border-[#d8d6ce] bg-white text-[#071521] hover:bg-[#fff0ec]"
              aria-label={uiText(locale, "Open project navigation", "Projektnavigation öffnen")}
              data-testid="project-mobile-nav-trigger"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[min(20rem,calc(100vw-2rem))] gap-0 border-[#d8d6ce] bg-[#f5f3ed] p-0"
          >
            <SheetTitle className="sr-only">
              {uiText(locale, "Project navigation", "Projektnavigation")}
            </SheetTitle>
            {sidebarContent(true)}
          </SheetContent>
        </Sheet>
      </header>

      <aside
        className="hidden min-h-screen w-56 flex-shrink-0 flex-col border-r border-[#d8d6ce] bg-[#f5f3ed] lg:flex"
        data-testid="project-desktop-sidebar"
      >
        {sidebarContent(false)}
      </aside>
    </>
  );
}
