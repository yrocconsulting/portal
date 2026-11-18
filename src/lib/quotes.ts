import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { claudeConfigured, MODEL } from "@/lib/drafts/claude";

/** Pulls a client report quote out of an AI answer pasted from ProRankTracker. */

/** Links don't belong inside a quote; cited pages are shown separately. */
export const stripUrls = (s: string) => s.replace(/\s*\(?\s*https?:\/\/[^\s)]+\s*\)?/gi, "").replace(/\s+([.,;:!?])/g, "$1").trim();
const norm = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

/** URLs in the text that are on the client's own site. */
export function clientUrls(text: string, domain: string | null): string[] {
  if (!domain) return [];
  const d = domain.replace(/^www\./, "").toLowerCase();
  const found = text.match(/https?:\/\/[^\s)\]<>"']+/gi) ?? [];
  const bare = (text.match(new RegExp(`(?:www\\.)?${d.replace(/\./g, "\\.")}(?:/[^\\s)\\]<>"']*)?`, "gi")) ?? []).map((u) => `https://${u}`);
  const out = new Set<string>();
  for (const raw of [...found, ...bare]) {
    const u = raw.replace(/[.,;:]+$/, "");
    try {
      const h = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      if (h === d || h.endsWith(`.${d}`)) out.add(u.replace(/^http:/, "https:"));
    } catch {
      /* not a URL */
    }
  }
  return [...out];
}

/** Without Claude: the first one or two sentences that name the client. */
export function sentencesNaming(text: string, names: string[]): string | null {
  const sentences = stripUrls(text).replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [];
  const i = sentences.findIndex((s) => names.some((n) => norm(s).includes(norm(n))));
  if (i < 0) return null;
  return sentences
    .slice(i, i + 2)
    .join("")
    .trim()
    .slice(0, 600);
}

const QuoteSchema = z.object({ quote: z.string(), note: z.string() });

export async function extractQuote(answer: string, clientName: string, domain: string | null): Promise<{ quote: string; note: string | null; cited_urls: string[]; by: "claude" | "text" }> {
  const short = clientName.replace(/[\s,]+(llc|inc\.?|co\.?|corp\.?|ltd\.?|pllc)$/i, "").trim();
  const names = [...new Set([clientName, short])];
  if (!names.some((n) => norm(answer).includes(norm(n)))) throw new Error(`This answer doesn't mention ${clientName}.`);
  const cited_urls = clientUrls(answer, domain);

  if (claudeConfigured()) {
    try {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), baseURL: process.env.ANTHROPIC_BASE_URL || undefined });
      const res = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(QuoteSchema) },
        messages: [
          {
            role: "user",
            content: `Below is an answer an AI assistant gave, copied from ProRankTracker. We want to show the client "${clientName}" the most persuasive part on their monthly report.

<answer>
${answer.slice(0, 20000)}
</answer>

Return:
- quote: one to three consecutive sentences copied EXACTLY from the answer (same words, same order; you may drop markdown symbols and list bullets) that name ${clientName} and say the most positive, specific thing about them (recommended, top choice, rating, services, history). Under 60 words. Never change or add words.
- note: one short plain sentence for under the quote, saying what the answer did (for example "Named first out of five roofers" or "Quoted the 5.0 rating and the owner's history"). No em dashes. Empty string if nothing stands out.`,
          },
        ],
      });
      const q = res.parsed_output;
      // Only keep it if it really is the AI's own words.
      if (res.stop_reason !== "refusal" && q && q.quote && norm(answer.replace(/[*_#>`]/g, "")).includes(norm(q.quote.replace(/[*_#>`]/g, "")))) {
        return { quote: stripUrls(q.quote), note: q.note.replace(/\s*\u2014\s*/g, ", ").trim() || null, cited_urls, by: "claude" };
      }
    } catch {
      /* fall back to the plain text match below */
    }
  }
  const quote = sentencesNaming(answer, names);
  if (!quote) throw new Error(`Couldn't find a sentence naming ${clientName}.`);
  return { quote, note: null, cited_urls, by: "text" };
}
