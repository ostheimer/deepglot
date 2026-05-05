export type ProjectArea =
  | "overview"
  | "translations"
  | "visual-editor"
  | "analytics"
  | "settings"
  | "members"
  | "api-keys";

export type ProjectAccessContext = {
  organizationRole: "OWNER" | "ADMIN" | "MEMBER" | null;
  projectRole: "ADMIN" | "TRANSLATOR" | null;
  langCode?: string | null;
};

export function canAccessProject(access: ProjectAccessContext | null) {
  if (!access) return false;

  return (
    access.organizationRole === "OWNER" ||
    access.organizationRole === "ADMIN" ||
    access.projectRole === "ADMIN" ||
    access.projectRole === "TRANSLATOR"
  );
}

export function canManageProject(access: ProjectAccessContext | null) {
  if (!access) return false;

  return (
    access.organizationRole === "OWNER" ||
    access.organizationRole === "ADMIN" ||
    access.projectRole === "ADMIN"
  );
}

export function canAccessProjectLanguage(
  access: ProjectAccessContext | null,
  langCode?: string | null
) {
  if (!access) return false;

  if (canManageProject(access)) return true;
  if (access.projectRole !== "TRANSLATOR") return false;
  if (!access.langCode) return true;

  return access.langCode.toLowerCase() === langCode?.toLowerCase();
}

export function canAccessProjectArea(
  access: ProjectAccessContext | null,
  area: ProjectArea,
  langCode?: string | null
) {
  if (!access) return false;
  if (canManageProject(access)) return true;

  if (access.projectRole !== "TRANSLATOR") {
    return false;
  }

  if (area !== "translations" && area !== "visual-editor") {
    return false;
  }

  return canAccessProjectLanguage(access, langCode);
}
