const PROTECTED_PREFIXES = [
  "/dashboard",
  "/projekte",
  "/uebersetzungen",
  "/api-keys",
  "/abonnement",
  "/einstellungen",
] as const;

const AUTH_PREFIXES = ["/anmelden", "/registrieren"] as const;

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getAuthRedirect(pathname: string, isLoggedIn: boolean) {
  const isProtectedRoute = PROTECTED_PREFIXES.some((prefix) =>
    matchesPrefix(pathname, prefix)
  );

  if (isProtectedRoute && !isLoggedIn) {
    return "/anmelden";
  }

  const isAuthRoute = AUTH_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));

  if (isAuthRoute && isLoggedIn) {
    return "/dashboard";
  }

  return null;
}
