import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BillingSidebarNav } from "@/components/abonnement/billing-sidebar-nav";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

export default async function AbonnementLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  const session = await auth();
  if (!session?.user?.id) redirect(withLocalePrefix("/login", locale));

  return (
    <div className="flex gap-8 min-h-full">
      {/* Left sidebar */}
      <aside className="w-52 flex-shrink-0">
        <BillingSidebarNav />
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {children}
      </main>
    </div>
  );
}
