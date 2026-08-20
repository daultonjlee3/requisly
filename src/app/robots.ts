import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const AI_CRAWLERS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "Claude-SearchBot",
  "PerplexityBot",
  "Google-Extended",
];

const PUBLIC_PAGES = ["/", "/privacy", "/terms", "/llms.txt"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: PUBLIC_PAGES,
        disallow: [
          "/api/",
          "/s/",
          "/a/",
          "/q/",
          "/login",
          "/signup",
          "/invite/",
          "/auth/",
        ],
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: PUBLIC_PAGES,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
