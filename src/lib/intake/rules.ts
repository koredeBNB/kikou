import type { IntakeField, IntakeTurn } from "@/lib/intake/types";
import {
  readAudience,
  readCategory,
  readCompetitors,
  readProduct,
  readWebsite,
  takeCompetitorSkip,
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
  if (field === "website") return fromReply(readWebsite(reply), (website) => ({ website }));
  const declined = field === "competitors" ? { text: reply, skipped: false } : takeCompetitorSkip(reply);
  const { text, website } = takeWebsite(declined.text);
  const turn = readField(field, text);
  if (website && turn.intent === "answer") turn.values.website = website;
  if (declined.skipped) turn.skips = ["competitors"];
  return turn;
}

function readField(field: Exclude<IntakeField, "website">, reply: string): IntakeTurn {
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
