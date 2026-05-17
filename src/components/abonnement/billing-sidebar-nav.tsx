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
    <nav className="space-y-0.5">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link key={item.href} href={item.href}>
            <div
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-indigo-50 text-indigo-700 font-medium"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
