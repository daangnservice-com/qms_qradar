import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    access?: {
      /** 성장문화실 평가·observe — 화이트리스트 또는 Google Groups 멤버 */
      callQuality: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    callQualityAccess?: boolean;
    accessCheckedAt?: number;
  }
}
