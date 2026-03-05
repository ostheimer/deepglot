import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

export default async function ProjectRootPage({ params }: PageProps) {
  const { projektId } = await params;
  redirect(`/projekte/${projektId}/uebersetzungen/sprachen`);
}
