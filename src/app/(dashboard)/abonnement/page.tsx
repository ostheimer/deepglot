import { redirect } from "next/navigation";
import { getRequestLocale } from "@/lib/request-locale";
import { withLocalePrefix } from "@/lib/site-locale";

export default async function AbonnementPage() {
  const locale = await getRequestLocale();
  redirect(withLocalePrefix("/subscription/overview", locale));
}
