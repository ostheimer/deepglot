import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getRequestLocale();
  const session = await auth();

  if (!session?.user) {
    redirect(withLocalePrefix("/login", locale));
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#fbfaf7] lg:flex-row">
      <DashboardSidebar user={session.user} />
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl p-6 sm:p-8">{children}</div>
      </main>
    </div>
  );
}
