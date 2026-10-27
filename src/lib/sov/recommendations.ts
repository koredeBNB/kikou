import { listJoin } from "@/lib/format";
import { ownDomains } from "@/lib/sov/citations";
import { negativeTermsIn } from "@/lib/sov/mentions";
import {
  MODEL_LABELS,
  type QuestionIntent,
  type Recommendation,
  type RecommendationPriority,
  type Report,
} from "@/lib/sov/types";

type ReportWithoutRecommendations = Omit<Report, "recommendations">;

const pct = (value: number) => `${Math.round(value * 100)}%`;
const quote = (text: string) => `“${text}”`;
const PRIORITY_ORDER: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };
const RETRIEVAL_MODELS = new Set(["perplexity", "gemini"]);
const MAX_RECOMMENDATIONS = 6;
const MAX_INTENT_TIPS = 2;

function intentAdvice(
  intent: Exclude<QuestionIntent, "custom">,
  report: ReportWithoutRecommendations,
): Omit<Recommendation, "id"> {
  const { product, category, audience } = report.brief;
  const forAudience = audience ? ` for ${audience}` : "";
  const rival = report.gaps[0]?.competitor ?? report.brief.competitors[0] ?? "your biggest rival";
  const topDomains = report.domains
    .filter((d) => !d.isOwn)
    .slice(0, 2)
    .map((d) => d.domain);
  const roundups = topDomains.length ? topDomains.join(" and ") : "the review sites and roundups in your space";

  switch (intent) {
    case "best-for":
      return {
        title: `Win the “best ${category}${forAudience}” answer`,
        detail: `No model picked ${product} when asked for the best ${category}${forAudience}. Publish a page aimed squarely at that use case, with customer proof, concrete numbers and a plain “who it's for” line that models can quote.`,
        priority: "high",
        area: "positioning",
      };
    case "top-list":
      return {
        title: `Get onto “top ${category}” roundups`,
        detail: `${product} is missing from general top-list answers. Pitch inclusion in the listicles these models lean on (${roundups}) and keep your review profiles fresh.`,
        priority: "medium",
        area: "visibility",
      };
    case "alternatives":
      return {
        title: "Own the “alternatives” conversation",
        detail: `When buyers ask for alternatives, ${product} doesn't come up. Publish honest “${rival} alternatives” and “${product} vs ${rival}” pages; models reach for these when someone is ready to switch.`,
        priority: "medium",
        area: "positioning",
      };
    case "budget":
      return {
        title: "Be the obvious pick on price",
        detail: `${product} is absent from budget-minded answers. State pricing and any free tier plainly on a crawlable pricing page; models skip brands whose pricing is vague.`,
        priority: "medium",
        area: "positioning",
      };
    case "switching":
      return {
        title: "Make switching to you feel easy",
        detail: `Nobody suggested ${product} for teams moving off another tool. Document migration paths and importers from ${rival}, and mention them on your site and docs.`,
        priority: "medium",
        area: "positioning",
      };
    case "features":
      return {
        title: "Make your standout features quotable",
        detail: `${product} isn't mentioned in feature-led questions. Publish a features and integrations page with specific, comparable facts rather than slogans.`,
        priority: "medium",
        area: "positioning",
      };
    case "comparison":
      return {
        title: "Get into the head-to-head comparisons",
        detail: `When buyers compare ${category} options, ${product} isn't part of the answer. Publish fair comparison pages and a plain spec sheet so models can place you next to ${rival}.`,
        priority: "medium",
        area: "positioning",
      };
    case "beginner":
      return {
        title: "Be the friendly pick for newcomers",
        detail: `${product} doesn't come up when beginners ask where to start. A plain-English getting-started guide and simple setup docs give models a reason to suggest you to first-timers.`,
        priority: "medium",
        area: "positioning",
      };
    case "use-case":
      return {
        title: "Show up for specific jobs",
        detail: `Questions about specific situations${forAudience} don't mention ${product}. Write short use-case pages with real examples so models can match you to the job.`,
        priority: "low",
        area: "visibility",
      };
  }
}

export function buildRecommendations(report: ReportWithoutRecommendations): Recommendation[] {
  const recs: Recommendation[] = [];
  const { product: stats, brief, totalAnswers } = report;
  const product = brief.product;

  if (stats.mentionRate < 0.6) {
    const missing = report.missingPrompts
      .map((id) => report.questions.find((q) => q.id === id)?.text)
      .filter((t): t is string => Boolean(t));
    const example = missing[0] ? ` Questions that never mention you include ${quote(missing[0])}.` : "";
    recs.push({
      id: "visibility",
      title: "Show up in more buyer answers",
      detail: `${product} appears in ${stats.mentions} of ${totalAnswers} answers (${pct(stats.mentionRate)}).${example}`,
      priority: stats.mentionRate < 0.35 ? "high" : "medium",
      area: "visibility",
    });
  }

  for (const gap of report.gaps.slice(0, 2)) {
    const share = gap.gapAnswers / Math.max(totalAnswers, 1);
    if (gap !== report.gaps[0] && share < 0.25) continue;
    const exampleQuestion = report.questions.find((q) => q.id === gap.questionIds[0])?.text;
    recs.push({
      id: `gap-${gap.competitor.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`,
      title: `Close the gap with ${gap.competitor}`,
      detail: `${gap.competitor} shows up in ${gap.gapAnswers} answer${gap.gapAnswers === 1 ? "" : "s"} where ${product} doesn't${exampleQuestion ? `, including ${quote(exampleQuestion)}` : ""}. A fair “${product} vs ${gap.competitor}” comparison gives models something concrete to cite.`,
      priority: share >= 0.25 ? "high" : "medium",
      area: "positioning",
    });
  }

  const intents = [...new Set(report.questions.map((q) => q.intent))];
  const missedIntents = intents.filter((intent): intent is Exclude<QuestionIntent, "custom"> => {
    if (intent === "custom") return false;
    const rows = report.prompts.filter((p) => p.question.intent === intent && p.answers > 0);
    return rows.length > 0 && rows.every((p) => p.productMentions === 0);
  });
  for (const intent of missedIntents.slice(0, MAX_INTENT_TIPS)) {
    recs.push({ id: `intent-${intent}`, ...intentAdvice(intent, report) });
  }

  for (const summary of report.modelSummaries) {
    const lagging =
      summary.productMentionRate === 0 || summary.productMentionRate <= stats.mentionRate - 0.25;
    if (!lagging || summary.answers === 0) continue;
    const label = MODEL_LABELS[summary.model];
    const detail = RETRIEVAL_MODELS.has(summary.model)
      ? `${label} answers from live web results${summary.topDomains.length ? `, and its favourite sources were ${summary.topDomains.join(", ")}` : ""}. Getting listed and reviewed on those pages is the fastest lever.`
      : `${label} leans on what it learned in training. Broad, consistent mentions across reviews, docs, community threads and reference sites build this up over time.`;
    recs.push({
      id: `model-${summary.model}`,
      title: `${label} ${summary.productMentionRate === 0 ? "never recommends" : "rarely recommends"} you`,
      detail: `${product} came up in ${pct(summary.productMentionRate)} of ${label}'s answers. ${detail}`,
      priority: summary.productMentionRate === 0 ? "high" : "medium",
      area: "models",
    });
  }

  const thirdParty = report.domains.filter((d) => !d.isOwn).slice(0, 3);
  if (thirdParty.length > 0) {
    const share = thirdParty.reduce((s, d) => s + d.share, 0);
    recs.push({
      id: "earn-citations",
      title: "Earn a spot on the sources AI cites",
      detail: `${thirdParty.map((d) => d.domain).join(", ")} account for ${pct(share)} of all citations. Make sure ${product} is listed, reviewed and described accurately there.`,
      priority: "medium",
      area: "citations",
    });
  }

  const own = ownDomains(brief);
  if (own.length > 0 && !report.domains.some((d) => d.isOwn)) {
    recs.push({
      id: "own-site",
      title: "Get your own site cited",
      detail: `No model cited ${listJoin(own, "or")}. Publish answer-shaped pages (FAQs, comparisons, pricing) with clear headings and facts that are easy to quote.`,
      priority: "medium",
      area: "citations",
    });
  }

  if (stats.avgRank !== null && stats.avgRank > 2.5) {
    recs.push({
      id: "rank",
      title: "Move up the shortlist",
      detail: `When ${product} is mentioned it sits at #${stats.avgRank.toFixed(1)} on average. Lead every page with one memorable differentiator${brief.audience ? ` for ${brief.audience}` : ""} so models put you first, not as an afterthought.`,
      priority: "medium",
      area: "positioning",
    });
  }

  if (stats.mentions > 0 && stats.sentiment.negative / stats.mentions >= 0.25) {
    const terms = [
      ...new Set(
        report.answers
          .flatMap((a) => a.mentions.filter((m) => m.brand === product && m.sentiment === "negative"))
          .flatMap((m) => negativeTermsIn(m.snippet)),
      ),
    ].slice(0, 3);
    recs.push({
      id: "sentiment",
      title: "Change the story models tell about you",
      detail: `${pct(stats.sentiment.negative / stats.mentions)} of ${product}'s mentions carry a caveat${terms.length ? ` (${terms.join(", ")})` : ""}. Address it head-on in docs, pricing and review responses so newer sources outweigh the old ones.`,
      priority: "high",
      area: "sentiment",
    });
  }

  if (report.productPosition === 1 && stats.mentions > 0) {
    recs.push({
      id: "defend-lead",
      title: "Defend your lead",
      detail: `${product} has the biggest share of voice here (${pct(stats.shareOfVoice)}). Keep comparison pages current and watch for rivals gaining on the questions you win.`,
      priority: "low",
      area: "visibility",
    });
  }

  recs.push({
    id: "monitor",
    title: "Re-run this check after every launch",
    detail: "AI answers shift as models retrain and the web changes. Track the same questions monthly to see whether your content is landing.",
    priority: "low",
    area: "visibility",
  });

  return recs
    .map((rec, index) => ({ rec, index }))
    .sort((a, b) => PRIORITY_ORDER[a.rec.priority] - PRIORITY_ORDER[b.rec.priority] || a.index - b.index)
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ rec }) => rec);
}
