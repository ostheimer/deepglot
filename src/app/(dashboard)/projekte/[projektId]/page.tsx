import { redirect } from "next/navigation";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ProjectRootPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  redirect(withLocalePrefix(`/projects/${projektId}/translations/languages`, locale));
}
