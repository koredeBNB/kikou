export const MODEL_IDS = ["chatgpt", "claude", "gemini", "perplexity"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

export const MODEL_LABELS: Record<ModelId, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

export interface Brief {
  product: string;
  category: string;
  audience: string;
  competitors: string[];
  website?: string;
  /** Focus areas to split the questions across. None means a broad check. */
  topics?: string[];
}

export type QuestionIntent =
  | "best-for"
  | "top-list"
  | "alternatives"
  | "budget"
  | "switching"
  | "features"
  | "custom";

export interface Question {
  id: string;
  text: string;
  intent: QuestionIntent;
}

export type AnswerSource = "live" | "mock";

export interface ModelAnswer {
  questionId: string;
  model: ModelId;
  text: string;
  /** URLs returned by the provider alongside the answer (e.g. Perplexity citations). */
  citations: string[];
  source: AnswerSource;
  latencyMs: number;
  /** What the provider charged for this answer, when it says. */
  costUsd?: number;
}

export type Sentiment = "positive" | "neutral" | "negative";

export interface Mention {
  brand: string;
  /** 1-based position among the brands in this answer, by first appearance. */
  rank: number;
  offset: number;
  sentiment: Sentiment;
  snippet: string;
}

export interface Citation {
  url: string;
  domain: string;
}

export interface AnalyzedAnswer extends ModelAnswer {
  mentions: Mention[];
  citationList: Citation[];
}

export interface SentimentCounts {
  positive: number;
  neutral: number;
  negative: number;
}

export interface BrandModelStats {
  answers: number;
  mentions: number;
  mentionRate: number;
  avgRank: number | null;
  shareOfVoice: number;
}

export interface BrandStats {
  brand: string;
  isProduct: boolean;
  isTrackedCompetitor: boolean;
  mentions: number;
  mentionRate: number;
  avgRank: number | null;
  shareOfVoice: number;
  firstPlace: number;
  sentiment: SentimentCounts;
  byModel: Record<ModelId, BrandModelStats>;
}

export interface DomainStats {
  domain: string;
  count: number;
  share: number;
  models: ModelId[];
  urls: string[];
  isOwn: boolean;
  isCompetitor: boolean;
}

export interface ModelSummary {
  model: ModelId;
  answers: number;
  source: AnswerSource | "mixed";
  productMentionRate: number;
  productAvgRank: number | null;
  productShareOfVoice: number;
  topBrand: string | null;
  citations: number;
  topDomains: string[];
}

export interface PromptCell {
  mentioned: boolean;
  rank: number | null;
  sentiment: Sentiment | null;
  brands: string[];
}

export interface PromptRow {
  question: Question;
  cells: Partial<Record<ModelId, PromptCell>>;
  productMentions: number;
  answers: number;
  competitorsMentioned: string[];
}

export interface CompetitorGap {
  competitor: string;
  /** Answers where the competitor appears and the product does not. */
  gapAnswers: number;
  questionIds: string[];
}

export type RecommendationPriority = "high" | "medium" | "low";

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  priority: RecommendationPriority;
  area: "visibility" | "citations" | "models" | "positioning" | "sentiment";
}

export interface Report {
  brief: Brief;
  questions: Question[];
  models: ModelId[];
  answers: AnalyzedAnswer[];
  totalAnswers: number;
  brands: BrandStats[];
  product: BrandStats;
  productPosition: number;
  domains: DomainStats[];
  totalCitations: number;
  modelSummaries: ModelSummary[];
  prompts: PromptRow[];
  missingPrompts: string[];
  gaps: CompetitorGap[];
  recommendations: Recommendation[];
}
