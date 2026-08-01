"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Settings,
  CreditCard,
  LogOut,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { DeepglotLogo } from "@/components/brand/deepglot-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-provider";
import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getMarketingPath, withLocalePrefix } from "@/lib/site-locale";
import { localizeCopy } from "@/lib/static-copy";
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
  const copy = localizeCopy(locale, COPY);
  const navItems = localizeCopy(locale, NAV_ITEMS);
  const pathname = usePathname();

  return (
    <aside className="flex min-h-screen w-64 flex-col border-r border-[#d8d6ce] bg-[#f5f3ed]">
      {/* Logo */}
      <Link
        href={withLocalePrefix("/dashboard", locale)}
        className="flex h-16 items-center gap-2 border-b border-[#d8d6ce] px-6 transition-colors hover:bg-[#fff0ec]"
        aria-label="Deepglot dashboard"
      >
        <DeepglotLogo markClassName="h-8 w-8" wordmarkClassName="text-lg" />
      </Link>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const localizedHref = withLocalePrefix(item.href, locale);
          const isActive = pathname === localizedHref || pathname.startsWith(`${localizedHref}/`);
          return (
            <Link key={item.href} href={localizedHref}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-[#58636d] hover:bg-white hover:text-[#071521]"
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
      <div className="border-t border-[#d8d6ce] p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <LanguageSwitcher compact />
          </div>
          <div className="flex items-center gap-3 mb-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="bg-brand-100 text-brand-700 text-xs font-semibold">
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
