import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import authConfig from "@/lib/auth.config";
import { getAuthRedirect } from "@/lib/route-access";
import {
  getDocumentLocale,
  getLegacyPublicRedirect,
  SITE_LOCALE_COOKIE,
  toInternalPath,
} from "@/lib/site-locale";

const { auth } = NextAuth(authConfig);

function upsertCookieHeader(headerValue: string | null, locale: "en" | "de") {
  const parts = (headerValue ?? "")
    .split(/;\s*/)
    .filter(Boolean)
    .filter((part) => !part.startsWith(`${SITE_LOCALE_COOKIE}=`));

  parts.push(`${SITE_LOCALE_COOKIE}=${locale}`);
  return parts.join("; ");
}

function withLocaleCookie(response: NextResponse, locale: "en" | "de") {
  response.cookies.set(SITE_LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  return response;
}

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const localeParam = nextUrl.searchParams.get("__locale");
  const locale =
    localeParam === "de" || localeParam === "en"
      ? localeParam
      : getDocumentLocale(nextUrl.pathname);
  const legacyRedirect = getLegacyPublicRedirect(nextUrl.pathname);

  if (legacyRedirect) {
    const redirectUrl = new URL(legacyRedirect, nextUrl);
    redirectUrl.search = nextUrl.search;
    return withLocaleCookie(NextResponse.redirect(redirectUrl), locale);
  }

  const redirectPath = getAuthRedirect(nextUrl.pathname, !!session?.user);

  if (redirectPath) {
    const redirectUrl = new URL(redirectPath, nextUrl);
    redirectUrl.search = nextUrl.search;
    return withLocaleCookie(NextResponse.redirect(redirectUrl), locale);
  }

  const internalPath = toInternalPath(nextUrl.pathname);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-deepglot-locale", locale);
  requestHeaders.set("cookie", upsertCookieHeader(req.headers.get("cookie"), locale));

  if (internalPath !== nextUrl.pathname) {
    const rewriteUrl = new URL(internalPath, nextUrl);
    rewriteUrl.search = nextUrl.search;
    rewriteUrl.searchParams.set("__locale", locale);

    return withLocaleCookie(
      NextResponse.rewrite(rewriteUrl, {
        request: {
          headers: requestHeaders,
        },
      }),
      locale
    );
  }

  return withLocaleCookie(
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
    locale
  );
});

export const config = {
  matcher: [
    "/((?!api/auth|api/translate|_next/static|_next/image|favicon.ico).*)",
  ],
};
