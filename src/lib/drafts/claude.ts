import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { contextText, KINDS, type DraftContext, type DraftKind } from "./context";

export const MODEL = "claude-opus-5-5";
const BETAS = ["server-side-fallback-2026-07-01"];

export function claudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

function client() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), baseURL: process.env.ANTHROPIC_BASE_URL || undefined });
}

export const AngleSchema = z.object({
  title: z.string(),
  hook: z.string(),
  why: z.string(),
  target_prompts: z.array(z.string()),
  headline: z.string(),
  needs: z.array(z.string()),
});
export type Angle = z.infer<typeof AngleSchema>;
const AnglesSchema = z.object({ angles: z.array(AngleSchema) });

export type Usage = { input: number; output: number; cache_read: number; cache_write: number; cost_usd: number };

/** Claude Opus 5.5 list prices per million tokens. An estimate for the team, not a bill. */
function usageOf(u: Anthropic.Beta.BetaUsage | undefined): Usage {
  const input = u?.input_tokens ?? 0;
  const output = u?.output_tokens ?? 0;
  const cache_read = u?.cache_read_input_tokens ?? 0;
  const cache_write = u?.cache_creation_input_tokens ?? 0;
  const cost_usd = (input * 4 + cache_write * 5 + cache_read * 0.2 + output * 20) / 1_000_000;
  return { input, output, cache_read, cache_write, cost_usd: Math.round(cost_usd * 10000) / 10000 };
}
const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cache_read: a.cache_read + b.cache_read,
  cache_write: a.cache_write + b.cache_write,
  cost_usd: Math.round((a.cost_usd + b.cost_usd) * 10000) / 10000,
});

const FORMATS: Record<DraftKind, string> = {
  press_release: `A press release, 400 to 600 words:
- "# " headline (specific, newsworthy, includes the business name), then one plain subheadline line.
- Dateline: "CITY, ST (Month D, YYYY)" using the client's city and [[CONFIRM: release date]].
- Lead paragraph that answers who, what, where, when and why in two or three sentences, as a standalone answer.
- Two to four short body paragraphs with concrete, verifiable details.
- One quote from the owner or a named leader. Write a natural suggested quote, then attribute it as [[CONFIRM: name, title, and that the quote is approved]].
- "## About {client}" boilerplate: what they do, where, for whom, and their website.
- "Media contact:" with [[CONFIRM: contact name, email, phone]].
- A real news hook is required. Never write a generic company-profile release.`,
  article: `An authority article / blog post, 900 to 1,400 words:
- "# " title phrased the way people ask (often a question or "how to" / "best" / "cost of").
- Opening paragraph that directly answers the main question in two or three sentences, naming the business and location where natural.
- "## " subheads phrased as the questions people ask AI assistants, each followed by a direct one or two sentence answer, then detail.
- Specific facts, ranges, steps, comparisons or local details. No filler, no generic advice anyone could write.
- "## Frequently asked questions" with 4 to 6 short Q&As.
- A short closing with a clear next step (call, quote, visit).`,
  service_page: `A service page, 600 to 1,000 words:
- "# " heading with the service and the city or area.
- Opening paragraph: what the service is, who it is for, where, and why this business, as a direct answer.
- "## " sections: what's included, how it works (steps), pricing factors or what affects cost (no invented prices), service area, why choose them (only verifiable reasons).
- "## Frequently asked questions" with 4 to 6 Q&As.
- A call to action.`,
  faq: `FAQ content, 8 to 12 questions:
- "# " heading.
- Questions phrased exactly how customers ask AI assistants and Google, grouped under "## " topic headings.
- Each answer starts with a direct one sentence answer, then one to three sentences of specifics. Name the business and location where natural.`,
};

/** Stable instructions (cached). House style from the portal is appended. */
function systemPrompt(style: string | null): string {
  return `You write content for clients of Yroc Consulting, an agency that helps local and service businesses get recommended by AI assistants (ChatGPT, Gemini, Perplexity, Copilot, Google AI Overviews and AI Mode) and Google. The content is published under the client's name, in the client's voice. A person on the team reviews and edits everything before it is used.

How to write for AI search:
- Lead with the answer. The first paragraph of the piece and of each section should make sense on its own if quoted.
- Make the entity unmistakable: the full business name, what they do, where they are and who they serve, stated plainly and consistently.
- Prefer specific, verifiable facts (years in business, service areas, certifications, process steps, numbers) over adjectives. No hype, no superlatives you can't support.
- Use subheads and FAQ questions in the words people actually type or say to assistants. The tracked prompts show you that wording.
- Short paragraphs, plain sentences, natural mentions of the location. No keyword stuffing.

Facts and honesty:
- Use only facts from the information provided and from pages of the client's website that you read. Never invent facts, numbers, prices, awards, reviews, customers, people's names, dates or quotes.
- When the piece needs something you don't know, put a placeholder in the text: [[CONFIRM: what is needed]]. It is better to leave a placeholder than to guess.
- Never mention Yroc Consulting, an agency, AI tools, prompt tracking or "AI search optimization" inside the client's content.

Style:
- Never use em dashes. Use commas, colons, periods or parentheses instead.
- American English. Warm, confident, professional. No emojis.
${style?.trim() ? `\nHouse style from the team (follow it):\n${style.trim()}\n` : ""}`;
}

export class DraftError extends Error {}

function describe(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.";
  if (e instanceof Anthropic.PermissionDeniedError) return "The Anthropic key doesn't have access to this model or feature.";
  if (e instanceof Anthropic.RateLimitError) return "Anthropic is rate limiting right now. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `Anthropic rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Anthropic error ${e.status ?? ""}: ${e.message}`;
  return (e as Error).message;
}

/** Step 1: three angles, each tied to tracked prompts or search data. */
export async function suggestAngles(ctx: DraftContext, kind: DraftKind, brief: string | null, style: string | null): Promise<{ angles: Angle[]; usage: Usage }> {
  try {
    const res = await client().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(AnglesSchema) },
      system: [{ type: "text", text: systemPrompt(style), cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `${contextText(ctx)}

We want to write: ${KINDS[kind]}.
${brief?.trim() ? `Direction from the team: ${brief.trim()}\n` : ""}
Suggest exactly 3 distinct angles for this piece.
- Each angle targets specific tracked prompts. Copy the prompt text exactly into target_prompts (1 to 4 per angle). Favor prompts where the client's visibility is low but a strong piece could earn a mention, and prompts that match real Google queries.
- "why" explains the choice with the data (visibility numbers, platforms, query impressions) in one or two sentences.
- "hook" is the core idea in one sentence. For a press release it must be a genuine news hook: something the business did, launched, achieved, or a timely local or industry tie-in.
- "headline" is a working headline.
- "needs" lists facts the team must supply or confirm before this angle can be written truthfully (empty if none).
- Don't repeat anything in already_written. Keep the three angles clearly different from each other.
- If there are no tracked prompts, base the angles on the search queries and the business itself, and say so in "why".`,
        },
      ],
    });
    if (res.stop_reason === "refusal") throw new DraftError("Claude declined to suggest angles for this one.");
    const angles = res.parsed_output?.angles ?? [];
    if (!angles.length) throw new DraftError("Claude didn't return any angles. Try again.");
    return { angles: angles.slice(0, 3), usage: usageOf(res.usage) };
  } catch (e) {
    throw e instanceof DraftError ? e : new DraftError(describe(e));
  }
}

/** Step 2: the full piece, reading the client's website as needed. */
export async function writeDraft(
  ctx: DraftContext,
  kind: DraftKind,
  angle: Angle,
  brief: string | null,
  style: string | null,
): Promise<{ title: string; body: string; notes: string; sources: string[]; usage: Usage }> {
  const domain = ctx.client.domain;
  const tools: Anthropic.Beta.BetaToolUnion[] = domain ? [{ type: "web_fetch_20260209", name: "web_fetch", allowed_domains: [domain], max_uses: 6 }] : [];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${contextText(ctx)}

Write this piece: ${KINDS[kind]}.

<angle>
Title: ${angle.title}
Hook: ${angle.hook}
Working headline: ${angle.headline}
Target prompts:
${angle.target_prompts.map((p) => `- ${p}`).join("\n")}
Why: ${angle.why}
${angle.needs.length ? `Facts still to confirm: ${angle.needs.join("; ")}` : ""}
</angle>
${brief?.trim() ? `\nDirection from the team: ${brief.trim()}\n` : ""}
${
  domain
    ? `First read the client's website (${ctx.client.website}) to get their real services, locations, history and wording: the home page, then the most relevant service or about pages. Only pages on ${domain}.`
    : "There is no website on file, so rely only on the information above and use placeholders for anything else."
}

Format:
${FORMATS[kind]}

Reply with only the finished piece in Markdown, starting with the "# " line. After the piece, add a line "## Notes for the team" followed by:
- Target prompts: which tracked prompts this targets and how the piece answers them.
- To confirm: every [[CONFIRM]] placeholder, as a checklist.
- Schema: the schema.org type(s) to add when publishing and the key fields.
- Ideas: one or two internal links or distribution ideas.`,
    },
  ];

  let usage: Usage = { input: 0, output: 0, cache_read: 0, cache_write: 0, cost_usd: 0 };
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  try {
    for (let turn = 0; turn < 5; turn++) {
      const res = await client().beta.messages.create({
        model: MODEL,
        max_tokens: 20000,
        betas: BETAS,
        fallbacks: "default",
        output_config: { effort: "high" },
        system: [{ type: "text", text: systemPrompt(style), cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });
      usage = addUsage(usage, usageOf(res.usage));
      content.push(...res.content);
      if (res.stop_reason === "refusal") throw new DraftError("Claude declined to write this piece.");
      if (res.stop_reason === "pause_turn") {
        // Server tools paused mid-turn: send the turn back and the API resumes it.
        messages.push({ role: "assistant", content: res.content });
        continue;
      }
      if (res.stop_reason === "max_tokens") throw new DraftError("The draft ran too long and was cut off. Try again, or narrow the direction.");
      break;
    }
  } catch (e) {
    throw e instanceof DraftError ? e : new DraftError(describe(e));
  }

  const text = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");
  const start = text.search(/^# /m);
  if (start < 0) throw new DraftError("Claude didn't return a draft. Try again.");
  const piece = text.slice(start).replace(/\s*\u2014\s*/g, ", ");
  const [body, notes = ""] = piece.split(/^## Notes for the team\s*$/m);
  const title = body.match(/^# (.+)$/m)?.[1]?.trim() ?? angle.headline;
  const sources = content
    .filter((b): b is Anthropic.Beta.BetaWebFetchToolResultBlock => b.type === "web_fetch_tool_result")
    .map((b) => (b.content.type === "web_fetch_result" ? b.content.url : null))
    .filter((u): u is string => !!u);
  return { title, body: body.trim(), notes: notes.trim(), sources: [...new Set(sources)], usage };
}
