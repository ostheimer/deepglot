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
  const pathname = usePathname();
  const base = `/projekte/${project.id}`;

  const nav = [
    {
      label: "Übersetzungen",
      items: [
        { href: `${base}/uebersetzungen/sprachen`, label: "Sprachen", icon: Languages },
        { href: `${base}/uebersetzungen/urls`, label: "URLs", icon: Globe },
        { href: `${base}/uebersetzungen/visuell`, label: "Visueller Editor", icon: Paintbrush },
        { href: `${base}/uebersetzungen/glossar`, label: "Glossar", icon: BookOpen },
        { href: `${base}/uebersetzungen/profis`, label: "Profi-Übersetzungen", icon: UserCog },
        { href: `${base}/uebersetzungen/slugs`, label: "URL Slugs", icon: Link2 },
      ],
    },
    {
      label: "Statistiken",
      items: [
        { href: `${base}/statistiken/anfragen`, label: "Übersetzungsanfragen", icon: BarChart2 },
        { href: `${base}/statistiken/seitenaufrufe`, label: "Seitenaufrufe", icon: Eye },
      ],
    },
    {
      label: "Einstellungen",
      items: [
        { href: `${base}/einstellungen`, label: "Allgemein", icon: Settings },
        { href: `${base}/einstellungen/sprachmodell`, label: "Sprachmodell", icon: Cpu, badge: "Neu" },
        { href: `${base}/einstellungen/switcher`, label: "Sprachauswahl", icon: Globe },
        { href: `${base}/einstellungen/ausnahmen`, label: "Ausnahmen", icon: ShieldOff },
        { href: `${base}/einstellungen/setup`, label: "Setup", icon: Wrench },
        { href: `${base}/einstellungen/wordpress`, label: "WordPress", icon: Plug },
        { href: `${base}/einstellungen/mitglieder`, label: "Projektmitglieder", icon: Users },
        { href: `${base}/api-keys`, label: "API-Keys", icon: Key },
      ],
    },
  ];

  return (
    <aside className="w-56 bg-white border-r border-gray-200 min-h-screen flex-shrink-0 py-6 flex flex-col">
      {/* Back + Project info */}
      <div className="px-4 mb-6">
        <Link
          href="/projekte"
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 mb-4 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Alle Projekte
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
