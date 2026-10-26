import type { Brief, ModelAnswer, ModelId, Question } from "@/lib/sov/types";

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

const FILLER_NAMES = [
  "Brightwave",
  "Northstar",
  "Kettle",
  "Lumen",
  "Orbit",
  "Pebble",
  "Harbor",
  "Juniper",
  "Clover",
  "Beacon",
  "Willow",
  "Sprout",
  "Cobalt",
  "Fable",
  "Tandem",
  "Quill",
  "Maple",
  "Comet",
];

const POOL_SIZE = 8;

/** Fictional rivals so the demo has a believable field even without known competitors. */
export function mockRivals(brief: Brief): string[] {
  const random = rng(`rivals:${brief.category}:${brief.product}`);
  const taken = new Set([brief.product, ...brief.competitors].map((n) => n.toLowerCase()));
  const shortCategory = brief.category.trim().split(/\s+/).length === 1 && brief.category.length <= 4;
  const names = [...FILLER_NAMES].sort(() => random() - 0.5);
  const needed = Math.max(3, POOL_SIZE - 1 - brief.competitors.length);
  const rivals: string[] = [];
  for (const base of names) {
    const name = shortCategory && rivals.length % 2 === 0 ? `${base} ${brief.category.trim()}` : base;
    if (taken.has(name.toLowerCase())) continue;
    rivals.push(name);
    if (rivals.length === needed) break;
  }
  return rivals;
}

const PRODUCT_AFFINITY: Record<ModelId, number> = { chatgpt: 1, claude: 0.88, gemini: 0.76, perplexity: 1.1 };
const LIST_LENGTH: Record<ModelId, number> = { chatgpt: 5, claude: 4, gemini: 5, perplexity: 4 };
const LATENCY: Record<ModelId, [number, number]> = {
  chatgpt: [900, 2200],
  claude: [1200, 2700],
  gemini: [700, 1800],
  perplexity: [1000, 2400],
};

const POSITIVE_BLURBS = [
  "intuitive and quick to set up, so {audience} are productive on day one",
  "loved by {audience} for its clean, friendly interface",
  "powerful automation without the bloat",
  "great value, with a generous free plan",
  "excellent reporting that's easy to share with clients",
  "a reliable all-rounder with strong integrations",
  "flexible enough to grow with you",
];
const NEUTRAL_BLURBS = [
  "covers the essentials with a straightforward setup",
  "a common choice that handles the basics",
  "offers templates and integrations for most workflows",
  "a familiar option many teams already know",
];
const CAVEAT_BLURBS = [
  "feature-rich, but pricey as you scale",
  "capable, though there's a steep learning curve",
  "dependable, if a little dated in design",
  "can feel complex for smaller teams",
  "limited on customisation compared with rivals",
];

const INTROS: Record<ModelId, string[]> = {
  chatgpt: [
    "Here are some of the strongest options right now:",
    "Great question! These are the picks that come up most:",
    "It depends on your priorities, but these stand out:",
  ],
  claude: [
    "There isn't one perfect answer, but a few options consistently fit well. Here's how I'd think about it:",
    "The right choice depends on how your team works. These are worth a close look:",
  ],
  gemini: ["### Top picks", "### Recommended options"],
  perplexity: ["Based on recent reviews and comparisons, the most recommended options are:", "The options reviewers recommend most often:"],
};

const OUTROS: Record<ModelId, string[]> = {
  chatgpt: [
    "If you share your budget and team size, I can narrow this down further.",
    "Most offer free trials, so it's worth testing two or three side by side.",
  ],
  claude: [
    "I'd shortlist two of these and run a short trial with real work before committing.",
    "Whichever you choose, check how well it fits the tools you already use.",
  ],
  gemini: ["**Tip:** compare pricing tiers carefully, as costs change with team size."],
  perplexity: ["Pricing and features change often, so check each vendor's current plans."],
};

function citationPool(brief: Brief, random: () => number): string[] {
  const cat = slug(brief.category);
  const aud = slug(brief.audience).replace(/-/g, "_");
  const thread = Math.floor(random() * 900000 + 100000).toString(36);
  return [
    `https://www.g2.com/categories/${cat}`,
    `https://www.capterra.com/${cat}-software/`,
    `https://www.reddit.com/r/${cat.replace(/-/g, "")}/comments/${thread}/best_${cat.replace(/-/g, "_")}${aud ? `_for_${aud}` : ""}/`,
    `https://www.forbes.com/advisor/business/software/best-${cat}/`,
    `https://www.techradar.com/best/best-${cat}`,
    `https://zapier.com/blog/best-${cat}/`,
    `https://www.pcmag.com/picks/the-best-${cat}`,
    `https://www.trustradius.com/${cat}`,
    `https://www.youtube.com/watch?v=${thread}${cat.length}`,
    `https://www.getapp.com/${cat}/`,
  ];
}

function domainFor(name: string): string {
  return `${slug(name).replace(/-/g, "")}.com`;
}

function blurb(random: () => number, isProduct: boolean, audience: string): string {
  const roll = random();
  const set = isProduct
    ? roll < 0.7
      ? POSITIVE_BLURBS
      : roll < 0.88
        ? NEUTRAL_BLURBS
        : CAVEAT_BLURBS
    : roll < 0.5
      ? POSITIVE_BLURBS
      : roll < 0.75
        ? NEUTRAL_BLURBS
        : CAVEAT_BLURBS;
  const text = pick(random, set).replace("{audience}", audience || "users");
  return text[0].toUpperCase() + text.slice(1);
}

/** A deterministic, realistic-looking answer for demo mode. */
export function mockAnswer(brief: Brief, question: Question, model: ModelId): ModelAnswer {
  const random = rng(`${model}:${question.id}:${question.text}:${brief.product}:${brief.category}`);
  const popularity = rng(`popularity:${brief.category}:${brief.product}`);
  const rivals = [...brief.competitors, ...mockRivals(brief)];
  const base = new Map<string, number>();
  rivals.forEach((name, i) => base.set(name, i < brief.competitors.length ? 1 - i * 0.07 : 0.45 + popularity() * 0.4));
  base.set(brief.product, 0.92 * PRODUCT_AFFINITY[model]);

  const named = new Set(
    [brief.product, ...rivals].filter((n) => question.text.toLowerCase().includes(n.toLowerCase())),
  );
  const picks = [...base.entries()]
    .filter(([name]) => !named.has(name))
    .map(([name, weight]) => ({ name, score: weight * (0.55 + random() * 0.9) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, LIST_LENGTH[model])
    .map((p) => p.name);

  const pool = citationPool(brief, random);
  const citations: string[] = [];
  const cite = (count: number) => {
    const chosen: number[] = [];
    for (let i = 0; i < count; i++) {
      let url = pick(random, pool);
      if (random() < 0.18 && picks.length) {
        const name = pick(random, picks);
        url =
          name === brief.product && brief.website
            ? `https://${brief.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}/blog/${slug(question.intent)}`
            : `https://www.${domainFor(name)}/compare`;
      }
      let index = citations.indexOf(url);
      if (index === -1) index = citations.push(url) - 1;
      if (!chosen.includes(index)) chosen.push(index);
    }
    return chosen.map((i) => `[${i + 1}]`).join("");
  };

  const lead = named.size ? `If ${[...named][0]} isn't the right fit, there are good options.` : "";
  const lines: string[] = [];
  const opener = pick(random, INTROS[model]);
  const intro = !lead ? opener : opener.startsWith("#") ? `${lead}\n\n${opener}` : `${lead} ${opener}`;
  const audience = brief.audience;

  picks.forEach((name, i) => {
    const text = blurb(random, name === brief.product, audience);
    switch (model) {
      case "chatgpt": {
        const link = random() < 0.25 ? ` ([review](${pick(random, pool)}))` : "";
        lines.push(`${i + 1}. **${name}** – ${text}.${link}`);
        break;
      }
      case "claude":
        lines.push(`- **${name}**: ${text}.`);
        break;
      case "gemini":
        lines.push(`* **${name}:** ${text}.${random() < 0.5 ? ` ${cite(1)}` : ""}`);
        break;
      case "perplexity":
        lines.push(`${i + 1}. **${name}** — ${text} ${cite(1 + Math.floor(random() * 2))}`);
        break;
    }
  });

  if (model === "perplexity") while (citations.length < 3) cite(1);
  if (model === "gemini" && citations.length === 0) cite(2);

  const text = [intro, "", ...lines, "", pick(random, OUTROS[model])].join("\n");
  const [min, max] = LATENCY[model];
  return {
    questionId: question.id,
    model,
    text,
    citations: model === "chatgpt" || model === "claude" ? [] : citations,
    source: "mock",
    latencyMs: Math.round(min + random() * (max - min)),
  };
}
