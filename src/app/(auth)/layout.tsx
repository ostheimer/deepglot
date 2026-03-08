import Link from "next/link";
import { Globe } from "lucide-react";

import { LanguageSwitcher } from "@/components/site/language-switcher";
import { getRequestLocale } from "@/lib/request-locale";
import { getMarketingPath } from "@/lib/site-locale";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="flex items-center justify-between py-4 px-6">
        <Link href={getMarketingPath(locale, "home")} className="flex items-center gap-2 w-fit">
          <Globe className="h-5 w-5 text-indigo-600" />
          <span className="font-bold text-gray-900">Deepglot</span>
        </Link>
        <LanguageSwitcher compact />
      </header>
      <div className="flex-1 flex items-center justify-center p-4">
        {children}
      </div>
    </div>
  );
}
