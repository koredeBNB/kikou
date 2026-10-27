"use client";

import {
  Analytics01Icon,
  ArrowRight01Icon,
  BubbleChatQuestionIcon,
  Link01Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnswerDialog } from "@/components/answer/answer-dialog";
import { Pip, type PipMood } from "@/components/art/pip";
import { SkyScene } from "@/components/art/sky-scene";
import { BrandMark } from "@/components/brand-mark";
import { Composer } from "@/components/check/composer";
import { BriefCard } from "@/components/check/brief-card";
import { PipMessage, QuickReplies, TypingMessage, UserMessage } from "@/components/check/messages";
import { PlanCard, type PlannedQuestion } from "@/components/check/plan-card";
import { RunCard } from "@/components/check/run-card";
import { SummaryCard } from "@/components/check/summary-card";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { useCheckRun, type RunState } from "@/hooks/use-check-run";
import { useThrottled } from "@/hooks/use-throttled";
import { ordinal, pct } from "@/lib/format";
import type { ProviderStatus } from "@/lib/providers/config";
import { MAX_EARLIER, type BriefDraft, type Identified } from "@/lib/intake/brief";
import {
  acceptDraft,
  acceptedLine,
  ambiguousLine,
  applyTurn,
  BRIEF_COPY,
  draftIntake,
  draftLine,
  emptyIntake,
  lookingUpLine,
  questionCount,
  toBrief,
  topicExamples,
  unknownLine,
} from "@/lib/intake/flow";
import { requestIdentify, requestIntake, requestLookup, requestRevision } from "@/lib/intake/request";
import { INTAKE_FIELDS, type IntakeField, type IntakeState } from "@/lib/intake/types";
import { budgetNote } from "@/lib/sov/budget";
import { canSwitchSearch, estimateFor, estimateLine } from "@/lib/sov/estimate";
import { classifyIntent, MAX_QUESTIONS } from "@/lib/sov/generate";
import { isAgreement, isRejection, readPlanReply } from "@/lib/sov/intake";
import { planMessage, writingMessage } from "@/lib/sov/plan-copy";
import { normalizeBrief } from "@/lib/sov/questions";
import { requestQuestions } from "@/lib/sov/request-questions";
import { buildReport } from "@/lib/sov/report";
import { newRunId, saveRun } from "@/lib/sov/storage";
import { MODEL_IDS, MODEL_LABELS, type Brief, type ModelAnswer, type ModelId, type Question } from "@/lib/sov/types";
import type { CheckRequest } from "@/lib/sov/events";

/** "confirm": Pip drafted the brief and waits for the user to confirm or correct it. */
type Step = IntakeField | "confirm" | "review" | "running" | "done";

type PipItem =
  | { kind: "text"; text: string; mood?: PipMood }
  | { kind: "brief"; brief: BriefDraft }
  | { kind: "plan" | "estimate" | "run" | "summary" };
type Message = { id: string; role: "user"; text: string } | ({ id: string; role: "pip" } & PipItem);

/** Working out which brand the user means, before there's a brief to confirm. */
interface BrandSearch {
  name?: string;
  topics: string[];
  count?: number;
  /** The user's earlier replies about the brand, when Pip had to ask. */
  earlier: string[];
  /** What an ambiguous name could mean, offered as quick replies. */
  options: string[];
  lookedUp: boolean;
}

const NEW_SEARCH: BrandSearch = { topics: [], earlier: [], options: [], lookedUp: false };

interface RunContext {
  id: string;
  brief: Brief;
  questions: Question[];
  models: ModelId[];
}

type Budget = { limitUsd: number; remainingUsd: number } | null;
type ProvidersResponse = { providers: ProviderStatus[]; budget?: Budget };

/** The assistants, and what's left of today's budget, which changes as checks run. */
async function fetchProviders(): Promise<ProvidersResponse> {
  try {
    return (await (await fetch("/api/providers", { cache: "no-store" })).json()) as ProvidersResponse;
  } catch {
    return { providers: MODEL_IDS.map((id) => ({ id, label: MODEL_LABELS[id], source: "mock" as const })), budget: null };
  }
}

const EXAMPLES = ["BNB Chain, focusing on RWA, trading and AI", "Notion", "Fernly, a plant care app for new plant parents"];

const HOW_IT_WORKS = [
  { icon: BubbleChatQuestionIcon, title: "Real buyer questions", body: "Unbranded, so every mention is earned" },
  { icon: Analytics01Icon, title: "Rank & share of voice", body: "Overall and for each assistant" },
  { icon: Link01Icon, title: "Sources they trust", body: "See which sites the assistants cite" },
];

const PLACEHOLDERS: Record<Step, string> = {
  product: "Name your brand, e.g. “BNB Chain, focusing on RWA and AI”",
  category: "e.g. CRM, plant care app, running shoes",
  audience: "e.g. small agencies, new plant parents",
  competitors: "e.g. HubSpot, Pipedrive, Close",
  website: "e.g. acme.com",
  topics: "e.g. pricing, security, integrations",
  count: "e.g. 25, or “max”",
  confirm: "e.g. “looks right” or “drop Solana, add Base”",
  review: "Add a buyer question, or change the brief…",
  running: "Pip is listening to the assistants…",
  done: "Check another product…",
};

const EMPTY_BRIEF: Brief = { product: "", category: "", audience: "", competitors: [] };
const LIVE_REPORT_MS = 750;
const ALL_MODELS = Object.fromEntries(MODEL_IDS.map((m) => [m, true])) as Record<ModelId, boolean>;

let counter = 0;
const uid = () => `m${++counter}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Milliseconds since it was started, for typing pauses that already waited on the network. */
const stopwatch = () => {
  const start = Date.now();
  return () => Date.now() - start;
};

function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="font-bold text-meadow-700">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

const typingDelay = (item: PipItem) => (item.kind === "text" ? Math.min(450 + item.text.length * 6, 1100) : item.kind === "estimate" ? 900 : 350);
const isIntakeStep = (step: Step): step is IntakeField => (INTAKE_FIELDS as readonly string[]).includes(step);

const isPlanItem = (m: Message) => m.role === "pip" && (m.kind === "plan" || m.kind === "estimate");
const sameList = (a: string[] = [], b: string[] = []) => a.join("\n").toLowerCase() === b.join("\n").toLowerCase();
/** The questions never name the product, its rivals or its site, so only these fields need new ones. */
const changesQuestions = (a: Brief, b: Brief) =>
  a.category.toLowerCase() !== b.category.toLowerCase() || a.audience.toLowerCase() !== b.audience.toLowerCase() || !sameList(a.topics, b.topics);

function guessDomain(product: string): string | null {
  const slug = product.toLowerCase().replace(/[^a-z0-9]/g, "");
  return slug.length >= 3 && slug.length <= 20 ? `${slug}.com` : null;
}

export function CheckExperience() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState(false);
  const [step, setStep] = useState<Step>("product");
  const [draft, setDraft] = useState<Brief>(EMPTY_BRIEF);
  const [intake, setIntake] = useState<IntakeState>(emptyIntake);
  const [brand, setBrand] = useState<BrandSearch>(NEW_SEARCH);
  const [proposed, setProposed] = useState<BriefDraft | null>(null);
  const [planned, setPlanned] = useState<PlannedQuestion[]>([]);
  const [models, setModels] = useState(ALL_MODELS);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [budget, setBudget] = useState<Budget>(null);
  const [webSearch, setWebSearch] = useState(true);
  const [input, setInput] = useState("");
  const [runCtx, setRunCtx] = useState<RunContext | null>(null);
  const [openAnswer, setOpenAnswer] = useState<ModelAnswer | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const runIdRef = useRef<string | null>(null);

  const loadProviders = useCallback(async (): Promise<ProvidersResponse> => {
    const data = await fetchProviders();
    setProviders(data.providers);
    setBudget(data.budget ?? null);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchProviders().then((data) => {
      if (cancelled) return;
      setProviders(data.providers);
      setBudget(data.budget ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const append = useCallback((...items: Message[]) => setMessages((prev) => [...prev, ...items]), []);

  /** Shows each item after a typing pause. `waited` is time the typing bubble was already up. */
  const speak = useCallback(
    async (items: PipItem[], waited = 0) => {
      for (const [index, item] of items.entries()) {
        setTyping(true);
        await wait(Math.max(0, typingDelay(item) - (index === 0 ? waited : 0)));
        setTyping(false);
        append({ ...item, id: uid(), role: "pip" });
      }
    },
    [append],
  );
  const say = useCallback((...items: PipItem[]) => speak(items), [speak]);

  const enabledQuestions = useMemo(() => planned.filter((p) => p.enabled).map((p) => p.question), [planned]);
  const selectedModels = useMemo(() => MODEL_IDS.filter((m) => models[m]), [models]);
  const estimate = useMemo(
    () => estimateFor({ questions: enabledQuestions.length, models: selectedModels, providers, webSearch }),
    [enabledQuestions.length, selectedModels, providers, webSearch],
  );
  const overBudget = budgetNote(estimate.costUsd, budget);
  const searchSwitch = canSwitchSearch(selectedModels, providers);
  const estimateText = [
    estimateLine({ questions: enabledQuestions.length, assistants: selectedModels.length, estimate, ask: !overBudget }),
    overBudget,
  ]
    .filter(Boolean)
    .join(" ");

  const onFinish = useCallback(
    async (state: RunState, request: CheckRequest) => {
      const id = runIdRef.current;
      if (!id) return;
      void loadProviders();
      const { brief, questions } = request;
      if (state.answers.length === 0) {
        setStep("review");
        if (state.limited && state.failure) {
          setMessages((prev) => {
            const last = prev.findLastIndex((m) => m.role === "pip" && m.kind === "run");
            return last === -1 ? prev : prev.filter((_, i) => i !== last);
          });
          await say({ kind: "text", mood: "idle", text: state.failure });
          return;
        }
        await say({ kind: "text", mood: "idle", text: `Oh dear, the check didn't finish: ${state.failure ?? "no answers came back"}. Want to try again?` });
        return;
      }
      const saved = saveRun({
        id,
        createdAt: new Date().toISOString(),
        brief,
        questions,
        models: state.models,
        answers: state.answers,
        errors: state.errors,
        elapsedMs: state.elapsedMs,
      });
      const report = buildReport({ brief, questions, answers: state.answers });
      const byRate = [...report.modelSummaries].sort((a, b) => b.productMentionRate - a.productMentionRate);
      const best = byRate[0];
      const worst = byRate.at(-1);
      const modelLine =
        best && worst && best.model !== worst.model && best.productMentionRate !== worst.productMentionRate
          ? ` ${MODEL_LABELS[best.model]} recommends you most; ${MODEL_LABELS[worst.model]} could use some love.`
          : "";
      const errorsLine = state.errors.length ? ` (${state.errors.length} answer${state.errors.length === 1 ? "" : "s"} failed, so I left them out.)` : "";
      const savedLine = saved ? "" : " This report is too big to keep in your browser, so it's only here until you close the tab.";
      setStep("done");
      await say(
        {
          kind: "text",
          mood: "happy",
          text: `All ${report.totalAnswers} answers are in! **${brief.product}** came up in ${pct(report.product.mentionRate)} of them and ranks ${ordinal(report.productPosition)} for share of voice.${modelLine}${errorsLine}${savedLine}`,
        },
        { kind: "summary" },
      );
    },
    [say, loadProviders],
  );

  const { state: run, start, reset: resetRun } = useCheckRun(onFinish);

  // Rebuilding the report on every answer gets slow for big checks, so the live view refreshes on a beat.
  const shownAnswers = useThrottled(run.answers, LIVE_REPORT_MS, run.status !== "running");
  const live = useMemo(() => {
    if (!runCtx || run.status === "idle") return null;
    return buildReport({ brief: runCtx.brief, questions: runCtx.questions, answers: shownAnswers });
  }, [runCtx, shownAnswers, run.status]);

  useEffect(() => {
    if (messages.length === 0) return;
    const id = requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    return () => cancelAnimationFrame(id);
  }, [messages.length, typing, run.answers.length]);

  /** Writes the question plan and shows it below the chat. `keep` holds the user's own questions when rewriting. */
  const goReview = useCallback(
    async (brief: Brief, count: number, keep: PlannedQuestion[] = []) => {
      const normalized = normalizeBrief(brief);
      setDraft(normalized);
      const writing = writingMessage({ count, topics: normalized.topics });
      if (writing) await say({ kind: "text", mood: "thinking", text: writing });
      setTyping(true);
      const [{ questions, requested }] = await Promise.all([requestQuestions(normalized, count), loadProviders()]);
      setTyping(false);
      setPlanned([...questions.slice(0, MAX_QUESTIONS - keep.length).map((question) => ({ question, enabled: true })), ...keep]);
      setMessages((prev) => prev.filter((m) => !isPlanItem(m)));
      setStep("review");
      await say(
        { kind: "text", text: planMessage({ product: normalized.product, questions: questions.length, requested, topics: normalized.topics }) },
        { kind: "plan" },
        { kind: "estimate" },
      );
    },
    [say, loadProviders],
  );

  const handleIntake = async (field: IntakeField, text: string, state: IntakeState) => {
    setTyping(true);
    const elapsed = stopwatch();
    const { turn } = await requestIntake({ field, reply: text, state });
    const { state: nextState, next, messages: lines } = applyTurn(state, field, turn);
    setIntake(nextState);
    if (proposed) setProposed({ ...proposed, ...toBrief(nextState) });
    await speak(
      lines.map((line) => ({ kind: "text" as const, ...line })),
      elapsed(),
    );
    setTyping(false);
    if (next === "review") await goReview(toBrief(nextState), questionCount(nextState));
    else setStep(next);
  };

  /** Carries on with the step-by-step questions, reading this reply as what kind of product it is. */
  const resumeRules = async (text: string, search: BrandSearch) => {
    setBrand(NEW_SEARCH);
    if (!search.name) return handleIntake("product", text, emptyIntake());
    await handleIntake("category", text, { ...emptyIntake(), product: search.name, topics: search.topics, count: search.count });
  };

  const showDraft = async (brief: BriefDraft, text: string, count: number | undefined, waited: number) => {
    setBrand(NEW_SEARCH);
    setProposed(brief);
    setIntake(draftIntake(brief, count));
    await speak([{ kind: "text", mood: "happy", text }, { kind: "brief", brief }], waited);
    setStep("confirm");
  };

  const settleBrand = async (
    result: Identified,
    text: string,
    search: BrandSearch,
    { web, canLookUp, waited }: { web: boolean; canLookUp: boolean; waited: number },
  ): Promise<void> => {
    if (result.kind === "draft") {
      return showDraft(result.brief, result.message ?? draftLine(result.brief, { known: result.known, web }), result.count ?? search.count, waited);
    }
    const followUp = search.earlier.length > 0 && !web;
    const next: BrandSearch = {
      ...search,
      name: result.name,
      topics: result.topics.length ? result.topics : search.topics,
      count: (result.kind === "unknown" ? result.count : undefined) ?? search.count,
      earlier: web ? search.earlier : [...search.earlier, text].slice(-MAX_EARLIER),
      options: [],
    };
    if (result.kind === "ambiguous") {
      if (followUp && search.earlier.length >= MAX_EARLIER) return resumeRules(text, next);
      setBrand({ ...next, options: result.options });
      await speak([{ kind: "text", text: result.message ?? ambiguousLine(result.name) }], waited);
      return;
    }
    if (followUp) return resumeRules(text, next);
    if (canLookUp && !search.lookedUp) {
      await speak([{ kind: "text", mood: "thinking", text: lookingUpLine(result.name) }], waited);
      setTyping(true);
      const elapsed = stopwatch();
      const found = await requestLookup({ reply: text, earlier: search.earlier });
      const looked = { ...next, lookedUp: true };
      if (found) return settleBrand(found, text, looked, { web: true, canLookUp: false, waited: elapsed() });
      setBrand(looked);
      await speak([{ kind: "text", text: unknownLine(result.name, true) }], elapsed());
      return;
    }
    setBrand(next);
    await speak([{ kind: "text", text: unknownLine(result.name, next.lookedUp) }], waited);
  };

  /** Works out which brand the user means and drafts its brief; without a model, falls back to step-by-step questions. */
  const handleProduct = async (text: string, search: BrandSearch) => {
    setTyping(true);
    const elapsed = stopwatch();
    const { identified, lookup } = await requestIdentify({ reply: text, earlier: search.earlier });
    if (!identified) {
      setTyping(false);
      return resumeRules(text, search);
    }
    await settleBrand(identified, text, search, { web: false, canLookUp: lookup, waited: elapsed() });
  };

  const acceptBrief = async (brief: BriefDraft, count: number | undefined, waited = 0) => {
    const { state, next } = acceptDraft(draftIntake(brief, count));
    setIntake(state);
    setProposed(brief);
    await speak([{ kind: "text", mood: "happy", text: acceptedLine(state, next) }], waited);
    if (next === "review") await goReview(toBrief(state), questionCount(state));
    else setStep(next);
  };

  const handleConfirm = async (text: string, brief: BriefDraft) => {
    if (isAgreement(text)) return acceptBrief(brief, intake.count);
    if (isRejection(text)) return say({ kind: "text", text: BRIEF_COPY.rejected });
    setTyping(true);
    const elapsed = stopwatch();
    const revision = await requestRevision({ reply: text, brief, stage: "confirm" });
    const waited = elapsed();
    if (!revision) return speak([{ kind: "text", text: BRIEF_COPY.failed }], waited);
    if (revision.kind === "accept") return acceptBrief(brief, revision.count ?? intake.count, waited);
    if (revision.kind !== "change") return speak([{ kind: "text", text: (revision.kind === "unclear" && revision.message) || BRIEF_COPY.unclear }], waited);

    const count = revision.count ?? intake.count;
    setProposed(revision.brief);
    setIntake(draftIntake(revision.brief, count));
    await speak([{ kind: "text", text: revision.message ?? BRIEF_COPY.changed }, { kind: "brief", brief: revision.brief }], waited);
    if (revision.proceed) await acceptBrief(revision.brief, count);
  };

  const addQuestion = async (text: string, waited = 0) => {
    if (planned.length >= MAX_QUESTIONS) {
      await speak([{ kind: "text", text: `That's the most I can ask in one check (${MAX_QUESTIONS} questions). Remove one to make room.` }], waited);
      return;
    }
    setPlanned((prev) => [...prev, { question: { id: `c${prev.length + 1}-${uid()}`, text, intent: "custom" }, enabled: true }]);
    await speak([{ kind: "text", text: "Added to the list! Anything else, or shall we start?" }], waited);
  };

  /** Applies a change made while the plan is up, rewriting the questions only when the change affects them. */
  const replan = async (brief: BriefDraft, count: number, text: string, waited: number) => {
    const before = normalizeBrief(draft);
    const after = normalizeBrief(brief);
    setProposed(brief);
    setIntake(acceptDraft(draftIntake(brief, count)).state);
    await speak([{ kind: "text", text }], waited);
    if (count !== questionCount(intake) || changesQuestions(before, after)) {
      return goReview(after, count, planned.filter((p) => p.question.intent === "custom"));
    }
    setDraft(after);
    setMessages((prev) => prev.filter((m) => !isPlanItem(m)));
    await say({ kind: "plan" }, { kind: "estimate" });
  };

  const handleReview = async (text: string) => {
    const reply = readPlanReply(text);
    if (reply.kind === "start") {
      if (enabledQuestions.length === 0 || selectedModels.length === 0) {
        await say({ kind: "text", text: "Tick at least one question and one assistant on the plan, then we're off." });
        return;
      }
      if (overBudget) {
        await say({ kind: "text", text: overBudget });
        return;
      }
      await startRun({ echo: false });
      return;
    }
    if (reply.kind === "skip") {
      await say({ kind: "text", text: "No worries. Press **Ask** on the plan whenever you're ready." });
      return;
    }
    setTyping(true);
    const elapsed = stopwatch();
    const brief = proposed ?? draft;
    const revision = await requestRevision({ reply: text, brief, stage: "plan" });
    const waited = elapsed();
    if (!revision) {
      if (reply.kind === "ok") return addQuestion(reply.value, waited);
      const example = `Try a full question a buyer might ask, like “Which ${draft.category} is easiest to set up?”, or press **Ask** on the plan to start.`;
      return speak([{ kind: "text", text: example }], waited);
    }
    const count = questionCount(intake);
    switch (revision.kind) {
      case "question":
        return addQuestion(revision.text, waited);
      case "change": {
        const line = revision.message ?? BRIEF_COPY.planChanged;
        return replan(revision.brief, revision.count ?? count, revision.proceed ? `${line} ${BRIEF_COPY.planReady}` : line, waited);
      }
      case "accept":
        if (revision.count !== undefined && revision.count !== count) {
          return replan(brief, revision.count, `Sure, ${revision.count} question${revision.count === 1 ? "" : "s"} it is.`, waited);
        }
        return speak([{ kind: "text", text: BRIEF_COPY.planAccepted }], waited);
      default:
        return speak([{ kind: "text", text: revision.message ?? BRIEF_COPY.planUnclear }], waited);
    }
  };

  const restart = useCallback(() => {
    resetRun();
    runIdRef.current = null;
    setRunCtx(null);
    setMessages([]);
    setDraft(EMPTY_BRIEF);
    setIntake(emptyIntake());
    setBrand(NEW_SEARCH);
    setProposed(null);
    setPlanned([]);
    setModels(ALL_MODELS);
    setWebSearch(true);
    setStep("product");
    setInput("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [resetRun]);

  const submit = async (text: string) => {
    if (typing || step === "running") return;
    setInput("");
    if (step === "done") {
      resetRun();
      runIdRef.current = null;
      setRunCtx(null);
      setPlanned([]);
      setMessages([{ id: uid(), role: "user", text }]);
      setStep("product");
      setIntake(emptyIntake());
      setBrand(NEW_SEARCH);
      setProposed(null);
      await handleProduct(text, NEW_SEARCH);
      return;
    }
    append({ id: uid(), role: "user", text });
    if (step === "product") return handleProduct(text, brand);
    if (isIntakeStep(step)) return handleIntake(step, text, intake);
    if (step === "confirm" && proposed) return handleConfirm(text, proposed);
    if (step === "review") return handleReview(text);
  };

  const startRun = async ({ echo = true }: { echo?: boolean } = {}) => {
    if (enabledQuestions.length === 0 || selectedModels.length === 0 || overBudget) return;
    const id = newRunId();
    const brief = normalizeBrief(draft);
    runIdRef.current = id;
    setRunCtx({ id, brief, questions: enabledQuestions, models: selectedModels });
    setStep("running");
    if (echo) append({ id: uid(), role: "user", text: "Let's go!" });
    await say({ kind: "text", mood: "thinking", text: "Off I go! I'll drop each answer in as it lands." }, { kind: "run" });
    void start({ brief, questions: enabledQuestions, models: selectedModels, webSearch });
  };

  const quickReplies: string[] = (() => {
    if (typing) return [];
    switch (step) {
      case "product":
        return brand.options;
      case "confirm":
        return ["Looks right"];
      case "category":
        return ["CRM", "project management tool", "AI writing assistant", "accounting software"];
      case "audience":
        return ["small businesses", "startups", "enterprise teams", "freelancers", "Skip"];
      case "competitors":
        return ["Skip"];
      case "website": {
        const guess = guessDomain(intake.product);
        return guess ? [guess, "Skip"] : ["Skip"];
      }
      case "topics":
        return [topicExamples(intake.category).join(", "), "Broad check"];
      case "count":
        return ["10", "25", "50", "100"];
      case "review":
        return overBudget ? [] : ["Go ahead"];
      default:
        return [];
    }
  })();

  const hero = messages.length === 0;
  const answerQuestion = openAnswer && runCtx ? runCtx.questions.find((q) => q.id === openAnswer.questionId) : undefined;
  const answerRank = openAnswer && live ? live.prompts.find((p) => p.question.id === openAnswer.questionId)?.cells[openAnswer.model]?.rank ?? null : undefined;

  const renderMessage = (message: Message): ReactNode => {
    if (message.role === "user") return <UserMessage key={message.id}>{message.text}</UserMessage>;
    if (message.kind === "text") {
      return (
        <PipMessage key={message.id} mood={message.mood}>
          <Rich text={message.text} />
        </PipMessage>
      );
    }
    if (message.kind === "brief") {
      return (
        <PipMessage key={message.id} wide>
          <BriefCard brief={message.brief} />
        </PipMessage>
      );
    }
    if (message.kind === "estimate") {
      return (
        <PipMessage key={message.id}>
          <Rich text={estimateText} />
        </PipMessage>
      );
    }
    if (message.kind === "plan") {
      return (
        <PipMessage key={message.id} wide>
          <PlanCard
            brief={normalizeBrief(draft)}
            planned={planned}
            models={models}
            providers={providers}
            locked={step !== "review"}
            webSearch={webSearch}
            canSwitchSearch={searchSwitch}
            estimate={estimate}
            budget={budget}
            budgetNote={overBudget}
            onToggleQuestion={(id) => setPlanned((prev) => prev.map((p) => (p.question.id === id ? { ...p, enabled: !p.enabled } : p)))}
            onRemoveQuestion={(id) => setPlanned((prev) => prev.filter((p) => p.question.id !== id))}
            onEditQuestion={(id, text) =>
              setPlanned((prev) =>
                prev.map((p) =>
                  p.question.id === id && p.question.text !== text
                    ? { ...p, question: { ...p.question, text, intent: p.question.intent === "custom" ? "custom" : classifyIntent(text) } }
                    : p,
                ),
              )
            }
            onToggleModel={(id) => setModels((prev) => ({ ...prev, [id]: !prev[id] }))}
            onToggleWebSearch={setWebSearch}
            onStart={() => startRun()}
          />
        </PipMessage>
      );
    }
    if (message.kind === "run" && runCtx && live) {
      return (
        <PipMessage key={message.id} wide>
          <RunCard
            brief={runCtx.brief}
            questions={runCtx.questions}
            models={runCtx.models}
            run={run}
            live={live}
            onOpenAnswer={setOpenAnswer}
          />
        </PipMessage>
      );
    }
    if (message.kind === "summary" && live && runCtx) {
      return (
        <PipMessage key={message.id} wide mood="happy">
          <SummaryCard report={live} onOpenReport={() => router.push(`/report/${runCtx.id}`)} onRestart={restart} />
        </PipMessage>
      );
    }
    return null;
  };

  return (
    <div className="relative flex min-h-dvh flex-col">
      <SkyScene />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <BrandMark onClick={hero ? undefined : restart} />
        <div className="flex items-center gap-2">
          {!hero && (
            <Button variant="outline" size="sm" onClick={restart}>
              <Icon icon={RepeatIcon} />
              New check
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href="/report/demo">
              Sample report
              <Icon icon={ArrowRight01Icon} strokeWidth={2.4} />
            </Link>
          </Button>
        </div>
      </header>

      <AnimatePresence mode="popLayout" initial={false}>
        {hero ? (
          <motion.main
            key="hero"
            exit={{ opacity: 0, y: -24, transition: { duration: 0.25 } }}
            className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 pt-[2vh] pb-[30vh] text-center sm:pt-[4vh]"
          >
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 16 }}>
              <Pip mood="wave" className="size-22 sm:size-26" />
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="mt-3 rounded-full bg-white/70 px-3.5 py-1 text-sm font-bold text-meadow-700 shadow-[0_4px_14px_-10px_rgb(59_127_63/0.8)]"
            >
              AI search share-of-voice checker
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, type: "spring", stiffness: 200, damping: 20 }}
              className="mt-4 text-[2.6rem] leading-[1.05] font-semibold text-balance text-ink sm:text-6xl"
            >
              Are you in the <span className="text-meadow-600">AI&apos;s memory?</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="mt-4 max-w-xl text-lg text-balance text-ink-soft"
            >
              Tell Pip about your product. Kioku asks ChatGPT, Claude, Gemini and Perplexity what your buyers ask, then shows how often
              you&apos;re recommended, where you rank and which sources they trust.
            </motion.p>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }} className="mt-7 w-full">
              <Composer hero value={input} onChange={setInput} onSubmit={submit} placeholder={PLACEHOLDERS.product} providers={providers} autoFocus />
            </motion.div>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
              className="mt-4 flex w-full flex-wrap items-center justify-center gap-2"
            >
              <span className="text-sm font-semibold text-ink-soft">Try:</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => submit(example)}
                  className="rounded-full bg-white/75 px-3.5 py-1.5 text-sm font-semibold text-ink shadow-[0_4px_12px_-9px_rgb(73_88_120/0.8)] transition hover:-translate-y-0.5 hover:bg-white active:scale-95"
                >
                  {example}
                </button>
              ))}
            </motion.div>
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.55 } } }}
              className="mt-8 grid w-full gap-3 sm:grid-cols-3"
            >
              {HOW_IT_WORKS.map((item) => (
                <motion.li
                  key={item.title}
                  variants={{ hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0 } }}
                  className="glass flex items-center gap-3 rounded-3xl px-4 py-3 text-left shadow-[0_8px_24px_-18px_rgb(73_88_120/0.8)]"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sun-100 text-[#b07a1c]">
                    <Icon icon={item.icon} className="size-5" />
                  </span>
                  <span>
                    <span className="block font-heading font-semibold">{item.title}</span>
                    <span className="block text-sm text-ink-soft">{item.body}</span>
                  </span>
                </motion.li>
              ))}
            </motion.ul>
          </motion.main>
        ) : (
          <motion.main key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col px-3 sm:px-6">
            <div className="flex-1 space-y-4 pt-2 pb-6" aria-live="polite">
              {messages.map(renderMessage)}
              <AnimatePresence>{typing && <TypingMessage key="typing" />}</AnimatePresence>
              <div ref={endRef} className="h-1 scroll-mb-44" />
            </div>
            <div className="sticky bottom-0 space-y-3 pt-6 pb-4">
              <div aria-hidden className="pointer-events-none absolute -inset-x-10 top-2 -bottom-6 -z-10 rounded-[3rem] bg-[#f7f5ea]/80 blur-2xl" />
              <QuickReplies options={quickReplies} onPick={submit} disabled={typing} />
              <Composer
                value={input}
                onChange={setInput}
                onSubmit={submit}
                placeholder={step === "product" && brand.earlier.length ? "Tell Pip in a few words…" : PLACEHOLDERS[step]}
                disabled={typing || step === "running"}
                providers={providers}
                autoFocus
              />
            </div>
          </motion.main>
        )}
      </AnimatePresence>

      <AnswerDialog
        answer={openAnswer}
        questionText={answerQuestion?.text ?? ""}
        product={runCtx?.brief.product ?? draft.product}
        rivals={live?.brands.filter((b) => !b.isProduct).map((b) => b.brand) ?? []}
        rank={answerRank}
        onOpenChange={(open) => !open && setOpenAnswer(null)}
      />
    </div>
  );
}
