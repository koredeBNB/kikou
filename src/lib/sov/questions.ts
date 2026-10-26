import type { Brief, Question } from "@/lib/sov/types";

function stripLead(value: string, pattern: RegExp): string {
  return value.trim().replace(pattern, "").trim();
}

export function normalizeBrief(brief: Brief): Brief {
  const product = brief.product.trim();
  const seen = new Set([product.toLowerCase()]);
  const competitors: string[] = [];
  for (const raw of brief.competitors) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    competitors.push(name);
  }
  return {
    product,
    category: stripLead(brief.category, /^(?:a|an|the)\s+/i).replace(/[.!]+$/, ""),
    audience: stripLead(brief.audience, /^(?:for\s+)?(?:the\s+)?/i).replace(/[.!]+$/, ""),
    competitors,
    website: brief.website?.trim() || undefined,
  };
}

export interface QuestionOptions {
  year?: number;
}

/** Unbranded, buyer-style questions: the product is never named so answers are unprompted. */
export function generateQuestions(brief: Brief, { year = new Date().getFullYear() }: QuestionOptions = {}): Question[] {
  const { category, audience, competitors } = brief;
  const [first, second] = competitors;
  const forAudience = audience ? ` for ${audience}` : "";
  const buyers = audience || "we";

  return [
    { id: "q1", intent: "best-for", text: `What's the best ${category}${forAudience}?` },
    { id: "q2", intent: "top-list", text: `Which ${category} options are the most recommended in ${year}?` },
    {
      id: "q3",
      intent: "alternatives",
      text: first
        ? `What are the best alternatives to ${first}?`
        : `What are good alternatives to the most popular ${category}?`,
    },
    { id: "q4", intent: "budget", text: `What's the most affordable ${category} that still works well${forAudience}?` },
    {
      id: "q5",
      intent: "switching",
      text: second
        ? `We're thinking of leaving ${second}. Which ${category} should ${buyers} switch to?`
        : `We're outgrowing our current ${category}. What should ${buyers} switch to?`,
    },
    { id: "q6", intent: "features", text: `Which ${category} stands out${forAudience} on features and ease of use?` },
  ];
}
