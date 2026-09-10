import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { isAdmin } from "./adminEmails";
import { resolveCanAccessCallQuality } from "./resolveAccess";

const ACCESS_REFRESH_MS = 10 * 60 * 1000;

/** 이메일이 허용 도메인(@domain)에 속하는지 (대소문자 무시) */
export function isAllowedEmail(email: string | null | undefined, domain: string): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user }) {
      // 관리자(adminEmails.ts)는 허용 도메인과 무관하게 로그인 허용.
      // 그 외에는 허용 도메인(@daangnservice.com)에 속한 계정만 로그인.
      if (isAdmin(user.email)) return true;
      return isAllowedEmail(user.email, process.env.ALLOWED_EMAIL_DOMAIN ?? "daangnservice.com");
    },
    async jwt({ token, user }) {
      const email = (user?.email ?? token.email) as string | undefined;
      if (!email) return token;

      const due =
        user != null ||
        token.callQualityAccess === undefined ||
        !token.accessCheckedAt ||
        Date.now() - token.accessCheckedAt > ACCESS_REFRESH_MS;

      if (due) {
        token.callQualityAccess = await resolveCanAccessCallQuality(email);
        token.accessCheckedAt = Date.now();
      }
      return token;
    },
    async session({ session, token }) {
      session.access = {
        callQuality: token.callQualityAccess === true,
      };
      return session;
    },
  },
};
