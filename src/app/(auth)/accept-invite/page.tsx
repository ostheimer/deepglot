import { AcceptInviteCard } from "@/components/auth/accept-invite-card";

interface AcceptInvitePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitePage({
  searchParams,
}: AcceptInvitePageProps) {
  const { token = "" } = await searchParams;

  return <AcceptInviteCard token={token} />;
}
