import NextAuth from "next-auth";
import authConfig from "@/lib/auth.config";
import { getAuthRedirect } from "@/lib/route-access";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const redirectPath = getAuthRedirect(nextUrl.pathname, !!session?.user);

  if (redirectPath) {
    return NextResponse.redirect(new URL(redirectPath, nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|api/translate|_next/static|_next/image|favicon.ico).*)",
  ],
};
