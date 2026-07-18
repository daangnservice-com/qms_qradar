import { withAuth } from "next-auth/middleware";

// 미로그인 시 /login 으로 리다이렉트. 로그인·인증 API·정적 리소스·robots는 예외.
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: ["/((?!api/auth|login|_next/static|_next/image|favicon.ico|icon.png|robots.txt).*)"],
};
