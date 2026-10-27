export const INTAKE_FIELDS = ["product", "category", "audience", "competitors", "website", "topics", "count"] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];
/** What Pip asks for next; "review" means every field is answered or skipped and the question plan comes next. */
export type IntakeNext = IntakeField | "review";

export const REQUIRED_FIELDS: readonly IntakeField[] = ["product", "category"];
export const OPTIONAL_FIELDS = ["audience", "competitors", "website", "topics", "count"] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];

export type IntakeIntent = "answer" | "skip" | "unclear";

export interface IntakeValues {
  product?: string;
  category?: string;
  audience?: string;
  competitors?: string[];
  website?: string;
  /** More of the product's own domains, when the reply gives several. */
  otherSites?: string[];
  /** Focus areas to research within the category, e.g. "trading", "RWA". */
  topics?: string[];
  /** How many questions to ask each assistant. */
  count?: number;
}

/** One understood reply. `intent` is about the field Pip asked for; `values` may fill several fields. */
export interface IntakeTurn {
  intent: IntakeIntent;
  values: IntakeValues;
  /** Other optional fields the reply declines, e.g. "competitors? honestly not sure" in an all-in-one reply. */
  skips?: OptionalField[];
  /** The field the model's message asks for. Only set with a model message. */
  asks?: IntakeNext;
  /** Pip's next message, written by the model. Rule-based turns leave it empty. */
  message?: string;
  /** Some of the reply wasn't usable (e.g. "Planta, not sure about the rest"). */
  partial?: boolean;
  /** The reply asked for more questions than one check allows, so the count was capped. */
  capped?: boolean;
}

export interface IntakeState {
  product: string;
  category: string;
  audience: string;
  competitors: string[];
  website?: string;
  otherSites?: string[];
  topics: string[];
  count?: number;
  skipped: IntakeField[];
  /** Fields where Pip already asked once for a clearer answer. */
  nudged: IntakeField[];
}

export type IntakeSource = "ai" | "rules";
export type FallbackReason = "no-model" | "forced" | "timeout" | "error" | "invalid";

export interface IntakeResult {
  turn: IntakeTurn;
  source: IntakeSource;
  reason?: FallbackReason;
}

export interface PipLine {
  text: string;
  mood?: "idle" | "wave" | "happy" | "thinking";
}
