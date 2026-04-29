import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import authConfig from "@/lib/auth.config";
import { getCanonicalHostRedirectUrl } from "@/lib/canonical-host";
import { getAuthRedirect } from "@/lib/route-access";
import {
  getDocumentLocale,
  getLegacyPublicRedirect,
  SITE_LOCALE_COOKIE,
  toInternalPath,
} from "@/lib/site-locale";

const { auth } = NextAuth(authConfig);

type ProxyRequest = {
  headers: Headers;
  nextUrl: URL;
};

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

function getRequestOrigin(req: ProxyRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) {
    return req.nextUrl.origin;
  }

  const protocol =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");

  return `${protocol}://${host}`;
}

function createSameOriginUrl(pathname: string, req: ProxyRequest) {
  return new URL(pathname, getRequestOrigin(req));
}

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const canonicalRedirectUrl = getCanonicalHostRedirectUrl(
    nextUrl,
    req.headers.get("host")
  );

  if (canonicalRedirectUrl) {
    return NextResponse.redirect(canonicalRedirectUrl, 308);
  }

  const localeParam = nextUrl.searchParams.get("__locale");
  const locale =
    localeParam === "de" || localeParam === "en"
      ? localeParam
      : getDocumentLocale(nextUrl.pathname);
  const legacyRedirect = getLegacyPublicRedirect(nextUrl.pathname);

  if (legacyRedirect) {
    const redirectUrl = createSameOriginUrl(legacyRedirect, req);
    redirectUrl.search = nextUrl.search;
    return withLocaleCookie(NextResponse.redirect(redirectUrl), locale);
  }

  const redirectPath = getAuthRedirect(nextUrl.pathname, !!session?.user);

  if (redirectPath) {
    const redirectUrl = createSameOriginUrl(redirectPath, req);
    redirectUrl.search = nextUrl.search;
    return withLocaleCookie(NextResponse.redirect(redirectUrl), locale);
  }

  const internalPath = toInternalPath(nextUrl.pathname);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-deepglot-locale", locale);
  requestHeaders.set("cookie", upsertCookieHeader(req.headers.get("cookie"), locale));

  if (internalPath !== nextUrl.pathname) {
    const rewriteUrl = createSameOriginUrl(internalPath, req);
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
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
