import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Trash2 } from "lucide-react";
import { getRequestLocale } from "@/lib/request-locale";

interface PageProps {
  params: Promise<{ projektId: string }>;
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  TRANSLATOR: "Translator",
};

export default async function MitgliederPage({ params }: PageProps) {
  const { projektId } = await params;
  const locale = await getRequestLocale();
  const session = await auth();

  const project = await db.project.findUnique({
    where: { id: projektId },
    include: {
      members: { orderBy: { createdAt: "asc" } },
      organization: {
        include: {
          members: {
            include: { user: true },
            where: { role: "OWNER" },
            take: 1,
          },
        },
      },
    },
  });
  if (!project) notFound();

  const owner = project.organization.members[0]?.user;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {locale === "de" ? "Projektmitglieder" : "Project members"}
        </h2>
        <Button className="bg-indigo-600 hover:bg-indigo-700 gap-2">
          <UserPlus className="h-4 w-4" />
          {locale === "de" ? "Mitglied einladen" : "Invite member"}
        </Button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[2fr_1fr_1.5fr_auto] gap-4 px-6 py-3 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">BENUTZER</span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "ROLLE" : "ROLE"}
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "SPRACHE" : "LANGUAGE"}
          </span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {locale === "de" ? "AKTIONEN" : "ACTIONS"}
          </span>
        </div>

        {/* Owner row */}
        {owner && (
          <div className="grid grid-cols-[2fr_1fr_1.5fr_auto] gap-4 px-6 py-4 border-b border-gray-100 items-center">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-indigo-100 text-indigo-700 text-xs font-semibold">
                  {(owner.name ?? owner.email ?? "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {owner.email}
                  {owner.email === session?.user?.email && (
                    <span className="ml-2 text-xs text-gray-400">
                      {locale === "de" ? "(Du)" : "(You)"}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Badge className="w-fit bg-indigo-100 text-indigo-700 border-0 text-xs">Admin</Badge>
            <span className="text-sm text-gray-400">—</span>
            <span className="text-sm text-gray-400">—</span>
          </div>
        )}

        {/* Project members */}
        {project.members.map((member) => (
          <div
            key={member.id}
            className="grid grid-cols-[2fr_1fr_1.5fr_auto] gap-4 px-6 py-4 border-b border-gray-100 last:border-0 items-center hover:bg-gray-50 group"
          >
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-gray-100 text-gray-600 text-xs font-semibold">
                  {member.email.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <p className="text-sm text-gray-700">{member.email}</p>
            </div>
            <Badge variant="outline" className="w-fit text-xs">
              {member.role === "TRANSLATOR"
                ? locale === "de"
                  ? "Übersetzer"
                  : "Translator"
                : ROLE_LABELS[member.role] ?? member.role}
            </Badge>
            <span className="text-sm text-gray-500">
              {member.langCode ? member.langCode.toUpperCase() : "—"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
            </Button>
          </div>
        ))}

        {project.members.length === 0 && !owner && (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-gray-400">
              {locale === "de" ? "Noch keine Mitglieder eingeladen." : "No members invited yet."}
            </p>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        {locale === "de"
          ? "Eingeladene Mitglieder können Übersetzungen bearbeiten und verwalten. Admins haben vollen Zugriff auf alle Projekteinstellungen."
          : "Invited members can edit and manage translations. Admins have full access to all project settings."}
      </p>
    </div>
  );
}
