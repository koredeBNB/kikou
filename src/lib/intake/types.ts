export const INTAKE_FIELDS = ["product", "category", "audience", "competitors", "website"] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];
/** What Pip asks for next; "review" means every field is answered or skipped and the question plan comes next. */
export type IntakeNext = IntakeField | "review";

export const REQUIRED_FIELDS: readonly IntakeField[] = ["product", "category"];

export type IntakeIntent = "answer" | "skip" | "unclear";

export interface IntakeValues {
  product?: string;
  category?: string;
  audience?: string;
  competitors?: string[];
  website?: string;
}

/** One understood reply. `intent` is about the field Pip asked for; `values` may fill several fields. */
export interface IntakeTurn {
  intent: IntakeIntent;
  values: IntakeValues;
  /** The field the model's message asks for. Only set with a model message. */
  asks?: IntakeNext;
  /** Pip's next message, written by the model. Rule-based turns leave it empty. */
  message?: string;
  /** Some of the reply wasn't usable (e.g. "Planta, not sure about the rest"). */
  partial?: boolean;
}

export interface IntakeState {
  product: string;
  category: string;
  audience: string;
  competitors: string[];
  website?: string;
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
