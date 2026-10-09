"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uiText } from "@/lib/static-copy";
import type { SiteLocale } from "@/lib/site-locale";

type Workspace = { id: string; name: string; plan: string; role: string; projectCount: number; memberCount: number };
type Member = { userId: string; name: string | null; email: string; role: "OWNER" | "ADMIN" | "MEMBER" };
type Candidate = { id: string; name: string | null; email: string };

export function WorkspaceManager({ locale, workspaces }: { locale: SiteLocale; workspaces: Workspace[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [membersFor, setMembersFor] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [candidateRole, setCandidateRole] = useState<"MEMBER" | "ADMIN">("MEMBER");

  async function loadMembers(workspaceId: string) {
    const response = await fetch(`/api/workspaces/${workspaceId}/members`);
    if (!response.ok) return;
    const data = await response.json();
    setMembersFor(workspaceId); setMembers(data.members); setCandidates(data.candidates);
    setCandidateId(""); setCandidateRole("MEMBER");
  }

  async function showMembers(workspaceId: string) {
    if (membersFor === workspaceId) { setMembersFor(null); return; }
    await loadMembers(workspaceId);
  }

  async function changeMember(workspaceId: string, userId: string, method: "POST" | "PATCH" | "DELETE", role?: string) {
    setBusy(true);
    try {
      const url = method === "POST" ? `/api/workspaces/${workspaceId}/members`
        : `/api/workspaces/${workspaceId}/members/${userId}`;
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" },
        body: method === "DELETE" ? undefined : JSON.stringify(method === "POST" ? { userId, role } : { role }) });
      if (!response.ok) { toast.error(uiText(locale, "Member change was rejected. Check role and seat limit.", "Mitgliedsänderung abgelehnt. Prüfe Rolle und Mitgliederlimit.")); return; }
      await loadMembers(workspaceId); router.refresh();
    } finally { setBusy(false); }
  }

  async function save(url: string, method: string, value: string) {
    setBusy(true);
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }) });
      if (!response.ok) {
        toast.error(uiText(locale, "Workspace could not be saved. Check your plan limit and role.", "Workspace konnte nicht gespeichert werden. Prüfe Planlimit und Rolle."));
        return;
      }
      setName(""); setEditing(null); router.refresh();
      toast.success(uiText(locale, "Workspace saved", "Workspace gespeichert"));
    } finally { setBusy(false); }
  }

  return <section className="space-y-4">
    <div>
      <h2 className="text-xl font-bold text-gray-900">Workspaces</h2>
      <p className="text-sm text-gray-600">{uiText(locale,
        "Each workspace has its own plan, projects, members and billing. New workspaces start on Free.",
        "Jeder Workspace hat einen eigenen Plan, Projekte, Mitglieder und eine eigene Abrechnung. Neue Workspaces starten mit Free.")}</p>
    </div>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void save("/api/workspaces", "POST", name); }}>
      <Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100}
        required aria-label={uiText(locale, "New workspace name", "Name des neuen Workspace")}
        placeholder={uiText(locale, "Workspace name", "Workspace-Name")} />
      <Button type="submit" disabled={busy}>{uiText(locale, "Create", "Erstellen")}</Button>
    </form>
    <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
      {workspaces.map((workspace) => <div key={workspace.id} className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div><strong>{workspace.name}</strong><p className="text-sm text-gray-600">
            {workspace.plan} · {workspace.role} · {workspace.projectCount} {uiText(locale, "projects", "Projekte")} · {workspace.memberCount} {uiText(locale, "members", "Mitglieder")}
          </p></div>
          {(workspace.role === "OWNER" || workspace.role === "ADMIN") &&
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void showMembers(workspace.id)}>
              {uiText(locale, "Members", "Mitglieder")}
            </Button><Button variant="outline" size="sm" onClick={() => { setEditing(workspace.id); setEditName(workspace.name); }}>
              {uiText(locale, "Rename", "Umbenennen")}
            </Button></div>}
        </div>
        {editing === workspace.id && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void save(`/api/workspaces/${workspace.id}`, "PATCH", editName); }}>
          <Input value={editName} onChange={(event) => setEditName(event.target.value)} minLength={2} maxLength={100} required />
          <Button type="submit" disabled={busy}>{uiText(locale, "Save", "Speichern")}</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{uiText(locale, "Cancel", "Abbrechen")}</Button>
        </form>}
        {membersFor === workspace.id && <div className="space-y-3 border-t pt-3 text-sm">
          {members.map((member) => <div key={member.userId} className="flex flex-wrap items-center gap-2">
            <span className="min-w-48">{member.name || member.email} · {member.email}</span>
            {workspace.role === "OWNER" ? <select className="rounded border p-1" value={member.role}
              disabled={busy} onChange={(event) => void changeMember(workspace.id, member.userId, "PATCH", event.target.value)}
              aria-label={uiText(locale, "Member role", "Mitgliedsrolle")}>
              <option value="OWNER">Owner</option><option value="ADMIN">Admin</option><option value="MEMBER">Member</option>
            </select> : <span>{member.role}</span>}
            {(workspace.role === "OWNER" || member.role === "MEMBER") && <Button type="button" variant="outline" size="sm"
              disabled={busy} onClick={() => void changeMember(workspace.id, member.userId, "DELETE")}>
              {uiText(locale, "Remove", "Entfernen")}
            </Button>}
          </div>)}
          {candidates.length > 0 && <div className="flex flex-wrap gap-2">
            <select className="rounded border p-2" value={candidateId} onChange={(event) => setCandidateId(event.target.value)}
              aria-label={uiText(locale, "Known user", "Bekannte Person")}>
              <option value="">{uiText(locale, "Choose known user", "Bekannte Person wählen")}</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.email} · {candidate.email}</option>)}
            </select>
            {workspace.role === "OWNER" && <select className="rounded border p-2" value={candidateRole}
              onChange={(event) => setCandidateRole(event.target.value as "MEMBER" | "ADMIN")}
              aria-label={uiText(locale, "New member role", "Rolle des neuen Mitglieds")}>
              <option value="MEMBER">Member</option><option value="ADMIN">Admin</option>
            </select>}
            <Button type="button" disabled={!candidateId || busy} onClick={() => void changeMember(workspace.id, candidateId, "POST", workspace.role === "OWNER" ? candidateRole : "MEMBER")}>
              {uiText(locale, "Add known user", "Bekannte Person hinzufügen")}
            </Button>
          </div>}
          <p className="text-xs text-gray-500">{uiText(locale,
            "Only people from workspaces you already manage appear here. Invitations and email delivery are not available.",
            "Hier erscheinen nur Personen aus Workspaces, die du bereits verwaltest. Einladungen und E-Mail-Versand sind nicht verfügbar.")}</p>
        </div>}
      </div>)}
    </div>
  </section>;
}
