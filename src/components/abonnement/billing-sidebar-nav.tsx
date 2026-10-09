"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, CreditCard, Activity } from "lucide-react";
import { useLocale } from "@/components/providers/locale-provider";
import { withLocalePrefix } from "@/lib/site-locale";
import { cn } from "@/lib/utils";
import { uiText } from "@/lib/static-copy";

export function BillingSidebarNav() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const workspaceId = params.get("workspaceId");
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; role: string }>>([]);
  useEffect(() => {
    fetch("/api/workspaces").then((response) => response.json()).then((data) =>
      setWorkspaces(data.workspaces ?? [])).catch(() => {});
  }, []);
  const selectedWorkspaceId = workspaceId || (workspaces.length === 1 ? workspaces[0].id : "");
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
      <label className="mb-3 block text-sm font-medium">
        {uiText(locale, "Workspace", "Workspace")}
        <select className="mt-1 w-full rounded-md border border-gray-300 bg-white p-2"
          value={selectedWorkspaceId} aria-label={uiText(locale, "Billing workspace", "Abrechnungs-Workspace")}
          onChange={(event) => router.push(`${pathname}?workspaceId=${encodeURIComponent(event.target.value)}`)}>
          <option value="">{uiText(locale, "Choose workspace", "Workspace wählen")}</option>
          {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>
            {workspace.name} · {workspace.role}
          </option>)}
        </select>
      </label>
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={selectedWorkspaceId ? `${item.href}?workspaceId=${encodeURIComponent(selectedWorkspaceId)}` : item.href}
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
