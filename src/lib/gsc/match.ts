/** Picks the Search Console property for a client: an explicit choice, else a domain match (domain properties first). */
export function siteForClient(
  c: { gsc_site_url?: string | null; domain: string | null },
  sites: { site_url: string; domain: string }[],
): string | null {
  if (c.gsc_site_url) return c.gsc_site_url;
  if (!c.domain) return null;
  const hits = sites.filter((s) => s.domain === c.domain);
  return (hits.find((s) => s.site_url.startsWith("sc-domain:")) ?? hits[0])?.site_url ?? null;
}
