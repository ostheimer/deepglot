"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Globe,
  LayoutDashboard,
  FolderOpen,
  Settings,
  CreditCard,
  LogOut,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getMarketingPath } from "@/lib/site-locale";
import { cn } from "@/lib/utils";

const NAV_ITEMS = {
  en: [
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/projects", label: "Projects", icon: FolderOpen },
    { href: "/subscription", label: "Subscription", icon: CreditCard },
    { href: "/settings", label: "Settings", icon: Settings },
  ],
  de: [
    { href: "/dashboard", label: "Übersicht", icon: LayoutDashboard },
    { href: "/projects", label: "Projekte", icon: FolderOpen },
    { href: "/subscription", label: "Abonnement", icon: CreditCard },
    { href: "/settings", label: "Einstellungen", icon: Settings },
  ],
} as const;

const COPY = {
  en: {
    fallbackUser: "User",
    signOut: "Sign out",
  },
  de: {
    fallbackUser: "Benutzer",
    signOut: "Abmelden",
  },
} as const;

interface DashboardSidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function DashboardSidebar({ user }: DashboardSidebarProps) {
  const locale = useLocale();
  const copy = COPY[locale];
  const navItems = NAV_ITEMS[locale];
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="h-16 flex items-center gap-2 px-6 border-b border-gray-100">
        <Globe className="h-6 w-6 text-indigo-600" />
        <span className="text-lg font-bold text-gray-900">Deepglot</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const localizedHref = locale === "de" ? `/de${item.href}` : item.href;
          const isActive = pathname === localizedHref || pathname.startsWith(`${localizedHref}/`);
          return (
            <Link key={item.href} href={localizedHref}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      {/* User Footer */}
      <div className="p-4 border-t border-gray-100">
          <div className="flex items-center justify-between gap-3 mb-3">
            <LanguageSwitcher compact />
          </div>
          <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs font-semibold">
              {user.name?.charAt(0).toUpperCase() ?? user.email?.charAt(0).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user.name ?? copy.fallbackUser}
            </p>
            <p className="text-xs text-gray-500 truncate">{user.email}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-gray-600 hover:text-red-600 hover:bg-red-50"
          onClick={() => signOut({ callbackUrl: getMarketingPath(locale, "home") })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {copy.signOut}
        </Button>
      </div>
    </aside>
  );
}
