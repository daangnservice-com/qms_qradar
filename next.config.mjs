/** @type {import('next').NextConfig} */
const nextConfig = {
  // ffmpeg-static는 바이너리라 번들 대상에서 제외(서버에서 파일 경로로 실행)
  serverExternalPackages: ["ffmpeg-static"],
};

export default nextConfig;
