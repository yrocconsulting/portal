/**
 * "Send to portal" button for ProRankTracker. A person opens a result pop-up in ProRankTracker
 * ("AIO Appearances: <prompt>", with a Mentions table) and clicks the bookmark; it reads only that
 * open pop-up and opens the portal's /capture page with the text in the URL fragment (never sent to
 * a server by the browser). Nothing runs on its own and no ProRankTracker password is stored.
 */

export type Captured = {
  v: 1;
  platform: string; // as shown, e.g. "AIO", "ChatGPT"
  prompt: string;
  mentions: { brand: string; content: string }[];
  links: string[];
  text: string; // the pop-up's text, as a fallback
};

/** ProRankTracker's label to our platform key. */
export function platformKey(label: string): string | null {
  const l = label.toLowerCase().replace(/[^a-z]/g, "");
  if (l.startsWith("aio") || l.startsWith("aioverview")) return "aio";
  if (l === "aim" || l.startsWith("aimode")) return "ai_mode";
  if (l.includes("chatgpt") || l.includes("openai")) return "chatgpt";
  if (l.includes("copilot")) return "copilot";
  if (l.includes("gemini")) return "gemini";
  if (l.includes("perplexity")) return "perplexity";
  return null;
}

export function decodeCapture(hash: string): Captured | null {
  try {
    const b64 = hash.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
    const d = JSON.parse(json) as Partial<Captured>;
    if (d.v !== 1 || typeof d.prompt !== "string" || typeof d.platform !== "string") return null;
    return {
      v: 1,
      platform: d.platform.slice(0, 60),
      prompt: d.prompt.slice(0, 500),
      mentions: (Array.isArray(d.mentions) ? d.mentions : [])
        .filter((m) => m && typeof m.content === "string")
        .map((m) => ({ brand: String(m.brand ?? "").slice(0, 200), content: String(m.content).slice(0, 2000) }))
        .slice(0, 50),
      links: (Array.isArray(d.links) ? d.links : []).filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 50),
      text: typeof d.text === "string" ? d.text.slice(0, 20000) : "",
    };
  } catch {
    return null;
  }
}

/** Mentions from the table; if the page didn't use a table, from its tab-separated text. */
export function mentionsOf(c: Captured): string[] {
  let rows = c.mentions.map((m) => m.content);
  if (!rows.length) {
    rows = c.text
      .split("\n")
      .map((l) => l.split("\t"))
      .filter((cols) => cols.length >= 2 && !/^content$/i.test(cols[cols.length - 1].trim()))
      .map((cols) => cols[cols.length - 1]);
  }
  if (!rows.length) {
    // Not a table at all: the longer lines after the "Content" header.
    const lines = c.text.split("\n").map((l) => l.trim());
    const start = lines.findIndex((l) => /^content$/i.test(l));
    rows = lines.slice(start + 1).filter((l) => l.length > 40);
  }
  return [...new Set(rows.map((r) => cleanMention(r, c.prompt)).filter((r) => r.length > 15))];
}

/** Drops ProRankTracker's "AI Overview AI Mode reply for <prompt>" lead-in. */
export function cleanMention(text: string, prompt: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  const lead = t.match(/^.{0,60}?\breply for\s+/i);
  if (lead) {
    t = t.slice(lead[0].length);
    if (t.toLowerCase().startsWith(prompt.toLowerCase())) t = t.slice(prompt.length).trim();
  }
  return t.replace(/^[,.:;\-\s]+/, "").trim();
}

/** The bookmark itself. Kept small and dependency-free; reads only the open "Appearances" pop-up. */
export function bookmarklet(origin: string): string {
  const src = `(()=>{const O=${JSON.stringify(origin)};
let h=null;for(const e of document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,p")){if(!e.offsetParent)continue;const t=(e.innerText||"").trim();if(t.length<400&&e.children.length<4&&/^\\S.{0,40}? Appearances:\\s*\\S/.test(t))h=e;}
if(!h){alert("Open a result first: click a check mark in ProRankTracker, then click this button.");return;}
const m=h.innerText.trim().match(/^(.*?) Appearances:\\s*([\\s\\S]+)$/);
let c=h;for(let i=0;i<10&&c.parentElement;i++){c=c.parentElement;if(/Brand Name|Content/.test(c.innerText)&&c.innerText.length>h.innerText.length+20)break;}
const rows=[...c.querySelectorAll("tr")].map(r=>[...r.children].map(x=>x.innerText.trim())).filter(r=>r.length>=2&&r[r.length-1]&&!/^content$/i.test(r[r.length-1]));
const d={v:1,platform:m[1].trim(),prompt:m[2].trim(),mentions:rows.map(r=>({brand:r[0],content:r[r.length-1]})),links:[...new Set([...c.querySelectorAll("a[href^='http']")].map(a=>a.href))],text:c.innerText.slice(0,20000)};
const s=btoa(unescape(encodeURIComponent(JSON.stringify(d)))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
window.open(O+"/capture#"+s,"_blank");})();`;
  return "javascript:" + encodeURIComponent(src.replace(/\n/g, ""));
}
