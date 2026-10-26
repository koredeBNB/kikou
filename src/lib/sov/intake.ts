import type { Brief } from "@/lib/sov/types";

export type IntroFields = Partial<Pick<Brief, "product" | "category" | "audience" | "website">>;

const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)\.[a-z]{2,}(?:\.[a-z]{2,})?\/?$/i;
const SEPARATOR = /^(.+?)(?:\s*,\s*|\s+[-–—]\s+|\s+is\s+|\s*:\s*)(.+)$/i;

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function clean(value: string): string {
  return value.trim().replace(/[.!?]+$/, "").trim();
}

/** Reads "Acme, a CRM for small agencies" style intros into brief fields. */
export function parseIntro(input: string): IntroFields {
  const text = clean(input);
  if (!text) return {};

  const domain = text.match(DOMAIN);
  if (domain) {
    return { product: titleCase(domain[1]), website: text.replace(/^https?:\/\//i, "").replace(/\/$/, "") };
  }

  const split = text.match(SEPARATOR);
  if (!split) return { product: text };

  const product = clean(split[1]);
  const rest = clean(split[2]).replace(/^(?:a|an|the)\s+/i, "");
  const forIndex = rest.search(/\s+for\s+/i);
  if (forIndex === -1) return { product, category: rest };

  const category = clean(rest.slice(0, forIndex));
  const audience = clean(rest.slice(forIndex).replace(/^\s+for\s+/i, ""));
  return { product, category, ...(audience ? { audience } : {}) };
}

const SKIP = /^(?:skip|none|no|nope|n\/a|not sure|no idea|nothing|-)$/i;

export function parseCompetitors(input: string): string[] {
  const text = input.trim();
  if (!text || SKIP.test(text)) return [];
  return text
    .split(/\s*(?:,|;|\n|\band\b|&)\s*/i)
    .map((name) => clean(name))
    .filter(Boolean);
}
