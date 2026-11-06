import type { MetadataRoute } from "next";

import { OPERATOR_PREFIXES } from "@/lib/auth/routes";
import { siteUrl } from "@/lib/marketing/site";

/**
 * Crawl policy for the public site.
 *
 * This is a request to well-behaved crawlers, not an access control mechanism.
 * The console is protected by the operator gate in `middleware.ts`; a crawler
 * that ignores this file still gets a redirect to `/login`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...OPERATOR_PREFIXES,
          "/login",
          // Every API route, including the ones that are public: none of them
          // is a page worth indexing.
          "/api/",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
