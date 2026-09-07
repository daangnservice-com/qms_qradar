/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // ← 추가

  // Node 전용 패키지. 서버 번들이 node builtin(crypto/stream)을 빠뜨리지 않게 한다.
  serverExternalPackages: [
    "ffmpeg-static",
    "@google-cloud/bigquery",
    "@google-cloud/storage",
    "@google-cloud/speech",
    "google-auth-library",
  ],

  // ffmpeg-static은 바이너리 경로를 문자열로만 넘겨서 Next 파일 추적기가
  // 바이너리를 의존성으로 인식하지 못함 → Vercel 서버리스 번들에 누락되어 ENOENT.
  // 콜 평가 API 함수 번들에 바이너리를 강제 포함시킨다.
  outputFileTracingIncludes: {
    "/api/evaluate": ["./node_modules/ffmpeg-static/**"],
  },

  experimental: {
    // /api/evaluate 업로드는 auth 미들웨어를 거치는데, 미들웨어를 통과하는
    // 요청 바디는 기본 10MB로 잘린다(초과 시 multipart 깨져 클라이언트에 "Failed to fetch").
    // 콜 평가 오디오 업로드 여유분으로 상향.
    middlewareClientMaxBodySize: 110 * 1024 * 1024,
  },

  // SEED CSS는 Manual 설치(@seed-design/css)로 globals에서 로드.
  // Next에는 HtmlWebpackPlugin이 없어 @seed-design/webpack-plugin HTML 주입을 쓰지 않음.
};

export default nextConfig;
