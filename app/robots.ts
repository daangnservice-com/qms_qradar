import type { MetadataRoute } from "next";

// 외부 검색 완전 차단 (전체 Disallow)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
