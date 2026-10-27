import type { IntakeField, IntakeTurn } from "@/lib/intake/types";
import { siteFields } from "@/lib/sov/citations";
import {
  readAudience,
  readCategory,
  readCompetitors,
  readCount,
  readProduct,
  readTopics,
  readWebsites,
  takeCompetitorSkip,
  takeTopics,
  takeWebsite,
  type Reply,
} from "@/lib/sov/intake";

const SKIP: IntakeTurn = { intent: "skip", values: {} };
const UNCLEAR: IntakeTurn = { intent: "unclear", values: {} };

function fromReply<T>(reply: Reply<T>, values: (value: T) => IntakeTurn["values"]): IntakeTurn {
  if (reply.kind === "skip") return { ...SKIP, values: {} };
  if (reply.kind === "unclear") return { ...UNCLEAR, values: {} };
  return { intent: "answer", values: values(reply.value) };
}

/** The rule-based reading of a reply: used without a model, and whenever the model fails. */
export function rulesTurn(field: IntakeField, reply: string): IntakeTurn {
  if (field === "website") return fromReply(readWebsites(reply), siteFields);
  if (field === "topics") return fromReply(readTopics(reply), (topics) => ({ topics }));
  if (field === "count") {
    const read = readCount(reply);
    const turn = fromReply(read, ({ count }) => ({ count }));
    if (read.kind === "ok" && read.value.capped) turn.capped = true;
    return turn;
  }
  const focused = takeTopics(reply);
  const declined = field === "competitors" ? { text: focused.text, skipped: false } : takeCompetitorSkip(focused.text);
  const { text, website } = takeWebsite(declined.text);
  const turn = readField(field, text);
  if (website && turn.intent === "answer") turn.values.website = website;
  if (focused.topics && turn.intent === "answer") turn.values.topics = focused.topics;
  if (declined.skipped) turn.skips = ["competitors"];
  return turn;
}

function readField(field: Exclude<IntakeField, "website" | "topics" | "count">, reply: string): IntakeTurn {
  switch (field) {
    case "product":
      return fromReply(readProduct(reply), (fields) => fields);
    case "category":
      return fromReply(readCategory(reply), (value) => value);
    case "audience":
      return fromReply(readAudience(reply), (audience) => ({ audience }));
    case "competitors": {
      const read = readCompetitors(reply);
      if (read.kind !== "ok") return fromReply(read, () => ({}));
      return read.ignored.length
        ? { intent: "answer", values: { competitors: read.value }, partial: true }
        : { intent: "answer", values: { competitors: read.value } };
    }
  }
}
