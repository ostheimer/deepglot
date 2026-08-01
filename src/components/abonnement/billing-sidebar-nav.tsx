"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, CreditCard, Activity } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { withLocalePrefix } from "@/lib/site-locale";
import { cn } from "@/lib/utils";
import { uiText } from "@/lib/static-copy";

export function BillingSidebarNav() {
  const locale = useLocale();
  const pathname = usePathname();
  const items = [
    {
      href: withLocalePrefix("/subscription/overview", locale),
      label: uiText(locale, "Plan Overview", "Plan-Übersicht"),
      icon: FileText,
    },
    {
      href: withLocalePrefix("/subscription/billing", locale),
      label: uiText(locale, "Billing & Invoices", "Karte & Rechnungen"),
      icon: CreditCard,
    },
    {
      href: withLocalePrefix("/subscription/usage", locale),
      label: uiText(locale, "Usage", "Nutzung"),
      icon: Activity,
    },
  ];

  return (
    <nav
      className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-0.5 lg:overflow-visible lg:pb-0"
      data-testid="billing-section-nav"
      aria-label={uiText(locale, "Billing sections", "Abonnement-Bereiche")}
    >
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors lg:flex",
              isActive
                ? "bg-brand-50 font-medium text-brand-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
