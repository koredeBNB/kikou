import type { ModelId } from "@/lib/sov/types";

export type BotRole = "search" | "user" | "training";

export interface AiBot {
  /** The product token sites name in robots.txt. */
  token: string;
  model: ModelId;
  role: BotRole;
  roleLabel: string;
  /** Points out of `CRAWLER_POINTS` this bot is worth when it gets in. */
  weight: number;
  /** What it sends when it fetches a page. Robots.txt-only tokens, such as Google-Extended, have none. */
  userAgent?: string;
  /** Said when this bot is blocked, because what blocking it means differs a lot by role. */
  note: string;
}

export const CRAWLER_POINTS = 35;

const AGENT = (product: string, url: string) => `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ${product}; +${url})`;

/**
 * Search crawlers decide whether an assistant can cite you in live answers, so they carry the weight. Training
 * crawlers barely count: blocking them is a fair choice. User fetchers sit in between, and two of their makers
 * say robots.txt may not apply to fetches a user asks for.
 */
export const AI_BOTS: AiBot[] = [
  {
    token: "OAI-SearchBot",
    model: "chatgpt",
    role: "search",
    roleLabel: "Search",
    weight: 7,
    userAgent: AGENT("OAI-SearchBot/1.0", "https://openai.com/searchbot"),
    note: "ChatGPT search can't show or cite pages it isn't allowed to crawl.",
  },
  {
    token: "ChatGPT-User",
    model: "chatgpt",
    role: "user",
    roleLabel: "When a user asks",
    weight: 1.5,
    userAgent: AGENT("ChatGPT-User/1.0", "https://openai.com/bot"),
    note: "Fetches a page when someone asks ChatGPT about it. OpenAI says robots.txt may not apply to these.",
  },
  {
    token: "GPTBot",
    model: "chatgpt",
    role: "training",
    roleLabel: "Training",
    weight: 0.5,
    userAgent: AGENT("GPTBot/1.2", "https://openai.com/gptbot"),
    note: "Collects training data. Blocking it is a fair choice: it doesn't stop ChatGPT search citing you.",
  },
  {
    token: "Claude-SearchBot",
    model: "claude",
    role: "search",
    roleLabel: "Search",
    weight: 7,
    userAgent: AGENT("Claude-SearchBot/1.0", "https://www.anthropic.com"),
    note: "Claude's web search can't cite pages it isn't allowed to crawl.",
  },
  {
    token: "Claude-User",
    model: "claude",
    role: "user",
    roleLabel: "When a user asks",
    weight: 1.5,
    userAgent: AGENT("Claude-User/1.0", "https://www.anthropic.com"),
    note: "Fetches a page when someone asks Claude about it.",
  },
  {
    token: "ClaudeBot",
    model: "claude",
    role: "training",
    roleLabel: "Training",
    weight: 0.5,
    userAgent: AGENT("ClaudeBot/1.0", "https://www.anthropic.com"),
    note: "Collects training data. Blocking it is a fair choice: it doesn't stop Claude's search citing you.",
  },
  {
    token: "Googlebot",
    model: "gemini",
    role: "search",
    roleLabel: "Search",
    weight: 7,
    userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    note: "Gemini and AI Overviews answer from Google's index, which Googlebot builds.",
  },
  {
    token: "Google-Extended",
    model: "gemini",
    role: "training",
    roleLabel: "Training and grounding",
    weight: 1.5,
    note: "A robots.txt switch, not a crawler. Blocking it keeps your pages out of Gemini's training and its grounding in Gemini apps.",
  },
  {
    token: "PerplexityBot",
    model: "perplexity",
    role: "search",
    roleLabel: "Search",
    weight: 7,
    userAgent: AGENT("PerplexityBot/1.0", "https://perplexity.ai/perplexitybot"),
    note: "Perplexity can't list or cite pages its crawler isn't allowed to read.",
  },
  {
    token: "Perplexity-User",
    model: "perplexity",
    role: "user",
    roleLabel: "When a user asks",
    weight: 1.5,
    userAgent: AGENT("Perplexity-User/1.0", "https://perplexity.ai/perplexity-user"),
    note: "Fetches a page when someone asks Perplexity about it. Perplexity says it generally ignores robots.txt.",
  },
];

export const botsFor = (model: ModelId) => AI_BOTS.filter((bot) => bot.model === model);

/** Kioku's own crawler. It obeys robots.txt for every page it reads. */
export const KIOKU_BOT_TOKEN = "KiokuBot";
export const KIOKU_USER_AGENT = "Mozilla/5.0 (compatible; KiokuBot/1.0; AI readability audit; +https://kioku.vercel.app)";

/** The control request: if a normal browser is refused too, the site is refusing Kioku's server, not the bots. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
