export const PLATFORMS = [
  ["chatgpt", "ChatGPT"],
  ["gemini", "Gemini"],
  ["aio", "AI Overviews"],
  ["ai_mode", "AI Mode"],
  ["perplexity", "Perplexity"],
  ["copilot", "Copilot"],
] as const;

export type SiteResult = {
  report_date: string;
  domain: string;
  appearances: number;
  mentions: number;
  links: number;
  visibility: number;
  prompts: number;
  platforms: Record<string, number>;
};

export type PromptResult = {
  report_date: string;
  domain: string;
  prompt: string;
  platforms: string[];
  appearances: number;
  visibility: number;
};

/** The domain ProRankTracker tracks for a client. */
export function trackedDomain(c: { tracking_domain?: string | null; domain: string | null }): string | null {
  return c.tracking_domain || c.domain || null;
}
