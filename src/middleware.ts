import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session?.user;

  const isDashboard = nextUrl.pathname.startsWith("/dashboard") ||
    nextUrl.pathname.startsWith("/projekte") ||
    nextUrl.pathname.startsWith("/uebersetzungen") ||
    nextUrl.pathname.startsWith("/api-keys") ||
    nextUrl.pathname.startsWith("/abonnement") ||
    nextUrl.pathname.startsWith("/einstellungen");

  const isAuthPage = nextUrl.pathname.startsWith("/anmelden") ||
    nextUrl.pathname.startsWith("/registrieren");

  // Redirect unauthenticated users away from protected routes
  if (isDashboard && !isLoggedIn) {
    return NextResponse.redirect(new URL("/anmelden", nextUrl));
  }

  // Redirect authenticated users away from auth pages
  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|api/translate|_next/static|_next/image|favicon.ico).*)",
  ],
};
