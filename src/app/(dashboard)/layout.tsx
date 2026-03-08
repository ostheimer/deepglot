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
    <div className="flex min-h-screen bg-gray-50">
      <DashboardSidebar user={session.user} />
      <main className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
