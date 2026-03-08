import { stripLocalePrefix, withLocalePrefix } from "@/lib/site-locale";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/projects",
  "/subscription",
  "/settings",
] as const;

const AUTH_PREFIXES = [
  "/login",
  "/signup",
] as const;

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getAuthRedirect(pathname: string, isLoggedIn: boolean) {
  const { locale, pathname: normalizedPathname } = stripLocalePrefix(pathname);
  const isProtectedRoute = PROTECTED_PREFIXES.some((prefix) =>
    matchesPrefix(normalizedPathname, prefix)
  );

  if (isProtectedRoute && !isLoggedIn) {
    return withLocalePrefix("/login", locale);
  }

  const isAuthRoute = AUTH_PREFIXES.some((prefix) => matchesPrefix(normalizedPathname, prefix));

  if (isAuthRoute && isLoggedIn) {
    return withLocalePrefix("/dashboard", locale);
  }

  return null;
}
