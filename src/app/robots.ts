import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fitwise.vercel.app";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // API routes take uploads and AI requests; there is nothing to index.
      disallow: "/api/",
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
