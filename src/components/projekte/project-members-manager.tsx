"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, RotateCcw, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/providers/locale-provider";

type ProjectRole = "ADMIN" | "TRANSLATOR";

type ProjectLanguage = {
  id: string;
  langCode: string;
};

type ProjectMember = {
  id: string;
  email: string;
  role: ProjectRole;
  langCode: string | null;
  createdAt: string | Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  } | null;
};

type ProjectInvitation = {
  id: string;
  email: string;
  role: ProjectRole;
  langCode: string | null;
  expiresAt: string | Date;
  createdAt: string | Date;
  inviter: {
    id: string;
    name: string | null;
    email: string;
  };
};

type OrganizationAdmin = {
  id: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
};

type ProjectMembersManagerProps = {
  projectId: string;
  languages: ProjectLanguage[];
  members: ProjectMember[];
  invitations: ProjectInvitation[];
  organizationAdmins: OrganizationAdmin[];
};

type MemberDraft = {
  role: ProjectRole;
  langCode: string;
};

const COPY = {
  en: {
    title: "Project members",
    description:
      "Invite teammates to manage translations. Project admins can edit settings and members.",
    invite: "Invite member",
    activeMembers: "Active members",
    pendingInvites: "Pending invitations",
    organizationAccess: "Organization access",
    noMembers: "No project members yet.",
    noInvites: "No pending invitations.",
    email: "Email",
    role: "Role",
    language: "Language",
    actions: "Actions",
    admin: "Admin",
    translator: "Translator",
    owner: "Owner",
    allLanguages: "All languages",
    save: "Save",
    saving: "Saving...",
    remove: "Remove",
    cancelInvite: "Cancel",
    resend: "Resend",
    inviteTitle: "Invite project member",
    inviteDescription:
      "The invitee receives an email and can accept with an existing account or create a password.",
    emailPlaceholder: "translator@example.com",
    sendInvite: "Send invitation",
    sendingInvite: "Sending...",
    close: "Cancel",
    invited: "Invitation created.",
    invitedNoEmail:
      "Invitation created, but the email was not sent. Use resend after email delivery is configured.",
    updated: "Member updated.",
    removed: "Member removed.",
    resent: "Invitation resent.",
    canceled: "Invitation canceled.",
    failed: "Action failed.",
    expires: "Expires",
  },
  de: {
    title: "Projektmitglieder",
    description:
      "Lade Teammitglieder ein, um Übersetzungen zu verwalten. Projekt-Admins können Einstellungen und Mitglieder bearbeiten.",
    invite: "Mitglied einladen",
    activeMembers: "Aktive Mitglieder",
    pendingInvites: "Offene Einladungen",
    organizationAccess: "Organisationszugriff",
    noMembers: "Noch keine Projektmitglieder.",
    noInvites: "Keine offenen Einladungen.",
    email: "E-Mail",
    role: "Rolle",
    language: "Sprache",
    actions: "Aktionen",
    admin: "Admin",
    translator: "Übersetzer",
    owner: "Inhaber",
    allLanguages: "Alle Sprachen",
    save: "Speichern",
    saving: "Speichern...",
    remove: "Entfernen",
    cancelInvite: "Abbrechen",
    resend: "Erneut senden",
    inviteTitle: "Projektmitglied einladen",
    inviteDescription:
      "Die eingeladene Person erhält eine E-Mail und kann mit einem bestehenden Konto annehmen oder ein Passwort erstellen.",
    emailPlaceholder: "team@example.com",
    sendInvite: "Einladung senden",
    sendingInvite: "Senden...",
    close: "Abbrechen",
    invited: "Einladung erstellt.",
    invitedNoEmail:
      "Einladung erstellt, aber die E-Mail wurde nicht versendet. Nutze „Erneut senden“, sobald der E-Mail-Versand konfiguriert ist.",
    updated: "Mitglied aktualisiert.",
    removed: "Mitglied entfernt.",
    resent: "Einladung erneut gesendet.",
    canceled: "Einladung abgebrochen.",
    failed: "Aktion fehlgeschlagen.",
    expires: "Läuft ab",
  },
} as const;

function getInitial(email: string) {
  return email.charAt(0).toUpperCase();
}

function formatDate(value: string | Date, locale: "en" | "de") {
  return new Date(value).toLocaleDateString(locale === "de" ? "de-AT" : "en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function roleLabel(role: ProjectRole, locale: "en" | "de") {
  if (role === "ADMIN") return "Admin";
  return locale === "de" ? "Übersetzer" : "Translator";
}

export function ProjectMembersManager({
  projectId,
  languages,
  members: initialMembers,
  invitations: initialInvitations,
  organizationAdmins,
}: ProjectMembersManagerProps) {
  const locale = useLocale();
  const copy = COPY[locale];
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [members, setMembers] = useState(initialMembers);
  const [invitations, setInvitations] = useState(initialInvitations);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("TRANSLATOR");
  const [inviteLangCode, setInviteLangCode] = useState("");
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>(() =>
    Object.fromEntries(
      initialMembers.map((member) => [
        member.id,
        { role: member.role, langCode: member.langCode ?? "" },
      ])
    )
  );

  const projectMemberEmails = new Set(members.map((member) => member.email.toLowerCase()));
  const visibleOrganizationAdmins = organizationAdmins.filter(
    (member) => !projectMemberEmails.has(member.user.email.toLowerCase())
  );

  function updateDraft(memberId: string, draft: Partial<MemberDraft>) {
    setDrafts((current) => ({
      ...current,
      [memberId]: {
        ...current[memberId],
        ...draft,
      },
    }));
  }

  function resetInviteDialog(nextOpen: boolean) {
    if (!nextOpen) {
      setInviteEmail("");
      setInviteRole("TRANSLATOR");
      setInviteLangCode("");
    }
    setInviteOpen(nextOpen);
  }

  function refresh() {
    router.refresh();
  }

  async function submitInvite(event: React.FormEvent) {
    event.preventDefault();

    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          role: inviteRole,
          langCode: inviteLangCode || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        invitation?: ProjectInvitation;
        emailDelivery?: { sent: boolean };
      };

      if (!response.ok || !data.invitation) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      setInvitations((current) => [data.invitation!, ...current]);
      resetInviteDialog(false);
      refresh();
      toast.success(data.emailDelivery?.sent ? copy.invited : copy.invitedNoEmail);
    });
  }

  async function updateMember(member: ProjectMember) {
    const draft = drafts[member.id] ?? {
      role: member.role,
      langCode: member.langCode ?? "",
    };

    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/members/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: draft.role,
          langCode: draft.langCode || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        member?: ProjectMember;
      };

      if (!response.ok || !data.member) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      setMembers((current) =>
        current.map((item) => (item.id === data.member?.id ? data.member! : item))
      );
      refresh();
      toast.success(copy.updated);
    });
  }

  async function removeMember(member: ProjectMember) {
    if (!window.confirm(`${copy.remove}: ${member.email}?`)) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/projects/${projectId}/members/${member.id}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      setMembers((current) => current.filter((item) => item.id !== member.id));
      refresh();
      toast.success(copy.removed);
    });
  }

  async function resendInvitation(invitation: ProjectInvitation) {
    startTransition(async () => {
      const response = await fetch(
        `/api/projects/${projectId}/members/invitations/${invitation.id}/resend`,
        { method: "POST" }
      );
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        invitation?: ProjectInvitation;
      };

      if (!response.ok || !data.invitation) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      setInvitations((current) =>
        current.map((item) =>
          item.id === data.invitation?.id ? data.invitation! : item
        )
      );
      refresh();
      toast.success(copy.resent);
    });
  }

  async function cancelInvitation(invitation: ProjectInvitation) {
    if (!window.confirm(`${copy.cancelInvite}: ${invitation.email}?`)) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(
        `/api/projects/${projectId}/members/invitations/${invitation.id}`,
        { method: "DELETE" }
      );
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        toast.error(data.error ?? copy.failed);
        return;
      }

      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      refresh();
      toast.success(copy.canceled);
    });
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{copy.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{copy.description}</p>
        </div>
        <Button
          className="bg-indigo-600 hover:bg-indigo-700"
          onClick={() => setInviteOpen(true)}
        >
          <UserPlus className="h-4 w-4" />
          {copy.invite}
        </Button>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="font-semibold text-gray-900">{copy.activeMembers}</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {members.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">
              {copy.noMembers}
            </div>
          ) : (
            members.map((member) => {
              const draft = drafts[member.id] ?? {
                role: member.role,
                langCode: member.langCode ?? "",
              };

              return (
                <div
                  key={member.id}
                  className="grid gap-4 px-6 py-4 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-indigo-100 text-xs font-semibold text-indigo-700">
                        {getInitial(member.user?.name ?? member.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {member.user?.name ?? member.email}
                      </p>
                      <p className="truncate text-xs text-gray-500">{member.email}</p>
                    </div>
                  </div>
                  <Label className="sr-only" htmlFor={`role-${member.id}`}>
                    {copy.role}
                  </Label>
                  <select
                    id={`role-${member.id}`}
                    value={draft.role}
                    onChange={(event) =>
                      updateDraft(member.id, { role: event.target.value as ProjectRole })
                    }
                    className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm"
                  >
                    <option value="ADMIN">{copy.admin}</option>
                    <option value="TRANSLATOR">{copy.translator}</option>
                  </select>
                  <Label className="sr-only" htmlFor={`language-${member.id}`}>
                    {copy.language}
                  </Label>
                  <select
                    id={`language-${member.id}`}
                    value={draft.langCode}
                    onChange={(event) =>
                      updateDraft(member.id, { langCode: event.target.value })
                    }
                    className="h-9 rounded-md border border-gray-200 bg-white px-3 text-sm"
                  >
                    <option value="">{copy.allLanguages}</option>
                    {languages.map((language) => (
                      <option key={language.id} value={language.langCode}>
                        {language.langCode.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => updateMember(member)}
                    >
                      {isPending ? copy.saving : copy.save}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => removeMember(member)}
                      title={copy.remove}
                    >
                      <Trash2 className="h-4 w-4 text-gray-400 hover:text-red-500" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h3 className="font-semibold text-gray-900">{copy.pendingInvites}</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {invitations.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-gray-500">
              {copy.noInvites}
            </div>
          ) : (
            invitations.map((invitation) => (
              <div
                key={invitation.id}
                className="grid gap-4 px-6 py-4 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {invitation.email}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {copy.expires}: {formatDate(invitation.expiresAt, locale)}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="w-fit">
                  {roleLabel(invitation.role, locale)}
                </Badge>
                <span className="text-sm text-gray-600">
                  {invitation.langCode
                    ? invitation.langCode.toUpperCase()
                    : copy.allLanguages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => resendInvitation(invitation)}
                  >
                    <RotateCcw className="h-4 w-4" />
                    {copy.resend}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => cancelInvitation(invitation)}
                  >
                    {copy.cancelInvite}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {visibleOrganizationAdmins.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="font-semibold text-gray-900">{copy.organizationAccess}</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleOrganizationAdmins.map((admin) => (
              <div
                key={admin.id}
                className="flex items-center justify-between gap-4 px-6 py-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-gray-100 text-xs font-semibold text-gray-700">
                      {getInitial(admin.user.name ?? admin.user.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {admin.user.name ?? admin.user.email}
                    </p>
                    <p className="truncate text-xs text-gray-500">{admin.user.email}</p>
                  </div>
                </div>
                <Badge className="border-0 bg-indigo-100 text-indigo-700">
                  {admin.role === "OWNER" ? copy.owner : copy.admin}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      <Dialog open={inviteOpen} onOpenChange={resetInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.inviteTitle}</DialogTitle>
            <DialogDescription>{copy.inviteDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{copy.email}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder={copy.emailPlaceholder}
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invite-role">{copy.role}</Label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value as ProjectRole)}
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                >
                  <option value="TRANSLATOR">{copy.translator}</option>
                  <option value="ADMIN">{copy.admin}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-language">{copy.language}</Label>
                <select
                  id="invite-language"
                  value={inviteLangCode}
                  onChange={(event) => setInviteLangCode(event.target.value)}
                  className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm"
                >
                  <option value="">{copy.allLanguages}</option>
                  {languages.map((language) => (
                    <option key={language.id} value={language.langCode}>
                      {language.langCode.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => resetInviteDialog(false)}
              >
                {copy.close}
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700"
                disabled={isPending}
              >
                {isPending ? copy.sendingInvite : copy.sendInvite}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
