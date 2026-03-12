import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import authConfig from "@/lib/auth.config";
import { toAuthUser } from "@/lib/auth-user";
import { getEnabledOAuthProviders } from "@/lib/oauth-provider-config";
import { ensureTestLoginUser } from "@/lib/test-login";
import { isTestLoginEnabled } from "@/lib/test-login-config";

const enabledOAuthProviders = getEnabledOAuthProviders();

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers: [
    ...(enabledOAuthProviders.github
      ? [
          GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
          }),
        ]
      : []),
    ...(enabledOAuthProviders.google
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValid) return null;

        return toAuthUser(user);
      },
    }),
    Credentials({
      id: "test-login",
      name: "test-login",
      credentials: {},
      async authorize() {
        if (!isTestLoginEnabled()) {
          return null;
        }

        const user = await ensureTestLoginUser();
        return toAuthUser(user);
      },
    }),
  ],
});
