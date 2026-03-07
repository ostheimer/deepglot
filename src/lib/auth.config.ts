import type { NextAuthConfig } from "next-auth";

const authConfig: NextAuthConfig = {
  providers: [],
  pages: {
    signIn: "/anmelden",
    error: "/fehler",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
};

export default authConfig;
