import type { Metadata } from "next";

export const SITE_URL = "https://requisly.com";
export const SUPPORT_EMAIL = "support@requisly.com";
export const INSTALL_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Install Requisly")}`;

export function pageMetadata(opts: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = new URL(opts.path, SITE_URL).toString();
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      siteName: "Requisly",
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary",
      title: opts.title,
      description: opts.description,
    },
  };
}
