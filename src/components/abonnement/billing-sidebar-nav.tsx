"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, CreditCard, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/abonnement/uebersicht", label: "Plan-Übersicht", icon: FileText },
  { href: "/abonnement/karte-rechnungen", label: "Karte & Rechnungen", icon: CreditCard },
  { href: "/abonnement/nutzung", label: "Nutzung", icon: Activity },
];

export function BillingSidebarNav() {
  const pathname = usePathname();

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
