import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

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
      return isAllowedEmail(user.email, process.env.ALLOWED_EMAIL_DOMAIN ?? "daangnservice.com");
    },
  },
};
