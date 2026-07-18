/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static는 바이너리라 번들 대상에서 제외(서버에서 파일 경로로 실행)
  serverExternalPackages: ["ffmpeg-static"],

  // ffmpeg-static은 바이너리 경로를 문자열로만 넘겨서 Next 파일 추적기가
  // 바이너리를 의존성으로 인식하지 못함 → Vercel 서버리스 번들에 누락되어 ENOENT.
  // 콜 평가 API 함수 번들에 바이너리를 강제 포함시킨다.
  outputFileTracingIncludes: {
    "/api/evaluate": ["./node_modules/ffmpeg-static/**"],
  },
};

export default nextConfig;
