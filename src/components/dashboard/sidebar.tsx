"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderOpen,
  Settings,
  CreditCard,
  LogOut,
  Menu,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { DeepglotLogo } from "@/components/brand/deepglot-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
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
    openNavigation: "Open navigation",
    navigationTitle: "Dashboard navigation",
  },
  de: {
    fallbackUser: "Benutzer",
    signOut: "Abmelden",
    openNavigation: "Navigation öffnen",
    navigationTitle: "Dashboard-Navigation",
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

  const logoLink = (mobile: boolean) => {
    const link = (
      <Link
        href={withLocalePrefix("/dashboard", locale)}
        className="flex h-16 items-center gap-2 border-b border-[#d8d6ce] px-6 transition-colors hover:bg-[#fff0ec]"
        aria-label="Deepglot dashboard"
      >
        <DeepglotLogo markClassName="h-8 w-8" wordmarkClassName="text-lg" />
      </Link>
    );

    return mobile ? <SheetClose asChild>{link}</SheetClose> : link;
  };

  const sidebarContent = (mobile: boolean) => (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f3ed]">
      {logoLink(mobile)}

      <nav className="flex-1 space-y-1 overflow-y-auto p-4">
        {navItems.map((item) => {
          const localizedHref = withLocalePrefix(item.href, locale);
          const isActive = pathname === localizedHref || pathname.startsWith(`${localizedHref}/`);
          const link = (
            <Link
              key={mobile ? undefined : item.href}
              href={localizedHref}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-50 text-brand-700"
                  : "text-[#58636d] hover:bg-white hover:text-[#071521]"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );

          return mobile ? (
            <SheetClose asChild key={item.href}>
              {link}
            </SheetClose>
          ) : link;
        })}
      </nav>

      <div className="border-t border-[#d8d6ce] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <LanguageSwitcher compact />
        </div>
        <div className="mb-3 flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="bg-brand-100 text-xs font-semibold text-brand-700">
              {user.name?.charAt(0).toUpperCase() ?? user.email?.charAt(0).toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">
              {user.name ?? copy.fallbackUser}
            </p>
            <p className="truncate text-xs text-gray-500">{user.email}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-gray-600 hover:bg-red-50 hover:text-red-600"
          onClick={() => signOut({ callbackUrl: getMarketingPath(locale, "home") })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          {copy.signOut}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-[#d8d6ce] bg-[#f5f3ed] px-4 lg:hidden">
        <Link
          href={withLocalePrefix("/dashboard", locale)}
          aria-label="Deepglot dashboard"
        >
          <DeepglotLogo markClassName="h-8 w-8" wordmarkClassName="text-lg" />
        </Link>
        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="border-[#d8d6ce] bg-white text-[#071521] hover:bg-[#fff0ec]"
              aria-label={copy.openNavigation}
              data-testid="dashboard-mobile-nav-trigger"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[min(20rem,calc(100vw-2rem))] gap-0 border-[#d8d6ce] bg-[#f5f3ed] p-0"
          >
            <SheetTitle className="sr-only">{copy.navigationTitle}</SheetTitle>
            {sidebarContent(true)}
          </SheetContent>
        </Sheet>
      </header>

      <aside
        className="hidden min-h-screen w-64 flex-shrink-0 flex-col border-r border-[#d8d6ce] bg-[#f5f3ed] lg:flex"
        data-testid="dashboard-desktop-sidebar"
      >
        {sidebarContent(false)}
      </aside>
    </>
  );
}
