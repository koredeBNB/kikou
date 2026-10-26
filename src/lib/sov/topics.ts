import { buildReport, type BuildReportInput } from "@/lib/sov/report";
import type { Recommendation, Report } from "@/lib/sov/types";

export interface TopicStats {
  topic: string;
  questions: number;
  answers: number;
  mentions: number;
  mentionRate: number;
  shareOfVoice: number;
  avgRank: number | null;
  /** Your place on this topic's leaderboard, or null when no answer named you. */
  position: number | null;
  /** Brands named at least once in this topic's answers. */
  brandsRanked: number;
  leaders: { brand: string; shareOfVoice: number; isProduct: boolean }[];
  topDomains: { domain: string; count: number; isOwn: boolean }[];
  improvements: Recommendation[];
}

const MAX_LEADERS = 3;
const MAX_DOMAINS = 3;
const MAX_IMPROVEMENTS = 2;
const GENERIC_TIPS = new Set(["monitor"]);

/**
 * One report per research topic, built from that topic's questions only. Rivals come from the
 * whole check, so a brand discovered in one topic is still counted wherever else it shows up.
 */
export function buildTopicBreakdown(input: Omit<BuildReportInput, "discoverMinAnswers">, overall?: Report): TopicStats[] {
  const { brief, questions, answers } = input;
  const tagged = questions.filter((q) => q.topic);
  if (tagged.length === 0) return [];
  const topics = [...new Set([...(brief.topics ?? []), ...tagged.map((q) => q.topic!)])];
  const whole = overall ?? buildReport(input);
  const rivals = whole.brands.filter((b) => !b.isProduct).map((b) => b.brand);

  return topics.flatMap((topic): TopicStats[] => {
    const topicQuestions = tagged.filter((q) => q.topic === topic);
    if (topicQuestions.length === 0) return [];
    const ids = new Set(topicQuestions.map((q) => q.id));
    const report = buildReport({
      brief: { ...brief, competitors: rivals },
      questions: topicQuestions,
      answers: answers.filter((a) => ids.has(a.questionId)),
      discoverMinAnswers: Number.POSITIVE_INFINITY,
    });
    const named = report.brands.filter((b) => b.mentions > 0);
    return [
      {
        topic,
        questions: topicQuestions.length,
        answers: report.totalAnswers,
        mentions: report.product.mentions,
        mentionRate: report.product.mentionRate,
        shareOfVoice: report.product.shareOfVoice,
        avgRank: report.product.avgRank,
        position: report.product.mentions > 0 ? report.productPosition : null,
        brandsRanked: named.length,
        leaders: named.slice(0, MAX_LEADERS).map((b) => ({ brand: b.brand, shareOfVoice: b.shareOfVoice, isProduct: b.isProduct })),
        topDomains: report.domains.slice(0, MAX_DOMAINS).map((d) => ({ domain: d.domain, count: d.count, isOwn: d.isOwn })),
        improvements: report.recommendations.filter((r) => !GENERIC_TIPS.has(r.id)).slice(0, MAX_IMPROVEMENTS),
      },
    ];
  });
}
