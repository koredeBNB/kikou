import { collectCitations, siteDomain } from "@/lib/sov/citations";
import { discoverBrands } from "@/lib/sov/discover";
import { findMentions } from "@/lib/sov/mentions";
import { buildRecommendations } from "@/lib/sov/recommendations";
import {
  MODEL_IDS,
  type AnalyzedAnswer,
  type BrandModelStats,
  type BrandStats,
  type Brief,
  type CompetitorGap,
  type DomainStats,
  type ModelAnswer,
  type ModelId,
  type ModelSummary,
  type PromptCell,
  type PromptRow,
  type Question,
  type Report,
} from "@/lib/sov/types";

export interface AnalyzeOptions {
  category?: string;
  /** Brands named in the question were prompted, so they are not credited for that answer. */
  questionText?: string;
}

export function analyzeAnswer(
  answer: ModelAnswer,
  brands: string[],
  { category, questionText }: AnalyzeOptions = {},
): AnalyzedAnswer {
  const prompted = new Set(questionText ? findMentions(questionText, brands, category).map((m) => m.brand) : []);
  return {
    ...answer,
    mentions: findMentions(
      answer.text,
      brands.filter((b) => !prompted.has(b)),
      category,
    ),
    citationList: collectCitations(answer.text, answer.citations),
  };
}

export function trackedBrands(brief: Brief): { product: string; competitors: string[] } {
  const product = brief.product.trim();
  const seen = new Set([product.toLowerCase()]);
  const competitors: string[] = [];
  for (const raw of brief.competitors) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    competitors.push(name);
  }
  return { product, competitors };
}

const ratio = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);
const mean = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length);

function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export interface BuildReportInput {
  brief: Brief;
  questions: Question[];
  answers: ModelAnswer[];
  /** How many answers an untracked brand must appear in to be counted. */
  discoverMinAnswers?: number;
}

export function buildReport({ brief, questions, answers, discoverMinAnswers = 2 }: BuildReportInput): Report {
  const { product, competitors } = trackedBrands(brief);
  const discovered = discoverBrands(
    answers.map((a) => a.text),
    [product, ...competitors],
    { minAnswers: discoverMinAnswers },
  );
  const allBrands = [product, ...competitors, ...discovered];
  const questionText = new Map(questions.map((q) => [q.id, q.text]));
  const analyzed = answers.map((a) =>
    analyzeAnswer(a, allBrands, { category: brief.category, questionText: questionText.get(a.questionId) }),
  );
  const models = MODEL_IDS.filter((m) => analyzed.some((a) => a.model === m));

  const answersPerModel = Object.fromEntries(
    MODEL_IDS.map((m) => [m, analyzed.filter((a) => a.model === m).length]),
  ) as Record<ModelId, number>;
  const mentionsPerModel = Object.fromEntries(
    MODEL_IDS.map((m) => [m, analyzed.filter((a) => a.model === m).reduce((s, a) => s + a.mentions.length, 0)]),
  ) as Record<ModelId, number>;
  const totalMentions = analyzed.reduce((s, a) => s + a.mentions.length, 0);

  const competitorSet = new Set(competitors);
  const brandStats: BrandStats[] = allBrands.map((brand) => {
    const hits = analyzed.flatMap((a) => {
      const mention = a.mentions.find((m) => m.brand === brand);
      return mention ? [{ answer: a, mention }] : [];
    });
    const byModel = Object.fromEntries(
      MODEL_IDS.map((model): [ModelId, BrandModelStats] => {
        const modelHits = hits.filter((h) => h.answer.model === model);
        return [
          model,
          {
            answers: answersPerModel[model],
            mentions: modelHits.length,
            mentionRate: ratio(modelHits.length, answersPerModel[model]),
            avgRank: mean(modelHits.map((h) => h.mention.rank)),
            shareOfVoice: ratio(modelHits.length, mentionsPerModel[model]),
          },
        ];
      }),
    ) as Record<ModelId, BrandModelStats>;

    return {
      brand,
      isProduct: brand === product,
      isTrackedCompetitor: competitorSet.has(brand),
      mentions: hits.length,
      mentionRate: ratio(hits.length, analyzed.length),
      avgRank: mean(hits.map((h) => h.mention.rank)),
      shareOfVoice: ratio(hits.length, totalMentions),
      firstPlace: hits.filter((h) => h.mention.rank === 1).length,
      sentiment: {
        positive: hits.filter((h) => h.mention.sentiment === "positive").length,
        neutral: hits.filter((h) => h.mention.sentiment === "neutral").length,
        negative: hits.filter((h) => h.mention.sentiment === "negative").length,
      },
      byModel,
    };
  });

  const brands = brandStats
    .filter((b) => b.mentions > 0 || b.isProduct || b.isTrackedCompetitor)
    .sort(
      (a, b) =>
        b.shareOfVoice - a.shareOfVoice ||
        (a.avgRank ?? Number.POSITIVE_INFINITY) - (b.avgRank ?? Number.POSITIVE_INFINITY) ||
        a.brand.localeCompare(b.brand),
    );
  const productStats = brands.find((b) => b.isProduct)!;

  const ownDomain = siteDomain(brief.website);
  const competitorKeys = new Set(competitors.map(compact).filter(Boolean));
  const domainMap = new Map<string, { count: number; models: Set<ModelId>; urls: Set<string> }>();
  for (const a of analyzed) {
    for (const c of a.citationList) {
      const entry = domainMap.get(c.domain) ?? { count: 0, models: new Set(), urls: new Set() };
      entry.count += 1;
      entry.models.add(a.model);
      entry.urls.add(c.url);
      domainMap.set(c.domain, entry);
    }
  }
  const totalCitations = [...domainMap.values()].reduce((s, d) => s + d.count, 0);
  const domains: DomainStats[] = [...domainMap.entries()]
    .map(([domain, d]) => {
      const labels = domain.split(".").slice(0, -1);
      return {
        domain,
        count: d.count,
        share: ratio(d.count, totalCitations),
        models: MODEL_IDS.filter((m) => d.models.has(m)),
        urls: [...d.urls],
        isOwn: ownDomain !== null && (domain === ownDomain || domain.endsWith(`.${ownDomain}`)),
        isCompetitor: labels.some((label) => competitorKeys.has(compact(label))),
      };
    })
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

  const modelSummaries: ModelSummary[] = models.map((model) => {
    const modelAnswers = analyzed.filter((a) => a.model === model);
    const sources = new Set(modelAnswers.map((a) => a.source));
    const top = brands
      .filter((b) => b.byModel[model].mentions > 0)
      .sort(
        (a, b) =>
          b.byModel[model].mentions - a.byModel[model].mentions ||
          (a.byModel[model].avgRank ?? 99) - (b.byModel[model].avgRank ?? 99),
      )[0];
    const modelDomains = new Map<string, number>();
    for (const a of modelAnswers) {
      for (const c of a.citationList) modelDomains.set(c.domain, (modelDomains.get(c.domain) ?? 0) + 1);
    }
    return {
      model,
      answers: modelAnswers.length,
      source: sources.size === 1 ? [...sources][0] : "mixed",
      productMentionRate: productStats.byModel[model].mentionRate,
      productAvgRank: productStats.byModel[model].avgRank,
      productShareOfVoice: productStats.byModel[model].shareOfVoice,
      topBrand: top?.brand ?? null,
      citations: [...modelDomains.values()].reduce((s, n) => s + n, 0),
      topDomains: [...modelDomains.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([d]) => d),
    };
  });

  const prompts: PromptRow[] = questions.map((question) => {
    const qAnswers = analyzed.filter((a) => a.questionId === question.id);
    const cells: Partial<Record<ModelId, PromptCell>> = {};
    const rivalCounts = new Map<string, { count: number; first: number }>();
    let order = 0;
    for (const a of qAnswers) {
      const own = a.mentions.find((m) => m.brand === product);
      cells[a.model] = {
        mentioned: Boolean(own),
        rank: own?.rank ?? null,
        sentiment: own?.sentiment ?? null,
        brands: a.mentions.map((m) => m.brand),
      };
      for (const m of a.mentions) {
        if (m.brand === product) continue;
        const entry = rivalCounts.get(m.brand) ?? { count: 0, first: order++ };
        entry.count += 1;
        rivalCounts.set(m.brand, entry);
      }
    }
    return {
      question,
      cells,
      productMentions: Object.values(cells).filter((c) => c?.mentioned).length,
      answers: qAnswers.length,
      competitorsMentioned: [...rivalCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
        .map(([brand]) => brand),
    };
  });

  const missingPrompts = prompts.filter((p) => p.answers > 0 && p.productMentions === 0).map((p) => p.question.id);

  const questionOrder = new Map(questions.map((q, i) => [q.id, i]));
  const gaps: CompetitorGap[] = brands
    .filter((b) => !b.isProduct)
    .map((b) => {
      const gapAnswers = analyzed.filter(
        (a) => a.mentions.some((m) => m.brand === b.brand) && !a.mentions.some((m) => m.brand === product),
      );
      const questionIds = [...new Set(gapAnswers.map((a) => a.questionId))].sort(
        (x, y) => (questionOrder.get(x) ?? 0) - (questionOrder.get(y) ?? 0),
      );
      return { competitor: b.brand, gapAnswers: gapAnswers.length, questionIds };
    })
    .filter((g) => g.gapAnswers > 0)
    .sort((a, b) => b.gapAnswers - a.gapAnswers);

  const partial = {
    brief,
    questions,
    models,
    answers: analyzed,
    totalAnswers: analyzed.length,
    brands,
    product: productStats,
    productPosition: brands.indexOf(productStats) + 1,
    domains,
    totalCitations,
    modelSummaries,
    prompts,
    missingPrompts,
    gaps,
  };

  return { ...partial, recommendations: buildRecommendations(partial) };
}
