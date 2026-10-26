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
import { PipMessage, QuickReplies, TypingMessage, UserMessage } from "@/components/check/messages";
import { PlanCard, type PlannedQuestion } from "@/components/check/plan-card";
import { RunCard } from "@/components/check/run-card";
import { SummaryCard } from "@/components/check/summary-card";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { useCheckRun, type RunState } from "@/hooks/use-check-run";
import { listJoin, ordinal, pct } from "@/lib/format";
import type { ProviderStatus } from "@/lib/providers/config";
import { siteDomain } from "@/lib/sov/citations";
import { parseCompetitors, parseIntro } from "@/lib/sov/intake";
import { generateQuestions, normalizeBrief } from "@/lib/sov/questions";
import { buildReport } from "@/lib/sov/report";
import { newRunId, saveRun } from "@/lib/sov/storage";
import { MODEL_IDS, MODEL_LABELS, type Brief, type ModelAnswer, type ModelId, type Question } from "@/lib/sov/types";
import type { CheckRequest } from "@/lib/sov/events";

type Step = "product" | "category" | "audience" | "competitors" | "website" | "review" | "running" | "done";

type PipItem = { kind: "text"; text: string; mood?: PipMood } | { kind: "plan" | "run" | "summary" };
type Message = { id: string; role: "user"; text: string } | ({ id: string; role: "pip" } & PipItem);

interface RunContext {
  id: string;
  brief: Brief;
  questions: Question[];
  models: ModelId[];
}

const EXAMPLES = [
  "Fernly, a plant care app for new plant parents",
  "Thimble — project tracker for small design studios",
  "Acme, a CRM for small agencies",
];

const HOW_IT_WORKS = [
  { icon: BubbleChatQuestionIcon, title: "Real buyer questions", body: "Unbranded, so every mention is earned" },
  { icon: Analytics01Icon, title: "Rank & share of voice", body: "Overall and for each assistant" },
  { icon: Link01Icon, title: "Sources they trust", body: "See which sites the assistants cite" },
];

const PLACEHOLDERS: Record<Step, string> = {
  product: "Tell Pip about your product, e.g. “Acme, a CRM for small agencies”",
  category: "e.g. CRM, plant care app, running shoes",
  audience: "e.g. small agencies, new plant parents",
  competitors: "e.g. HubSpot, Pipedrive, Close",
  website: "e.g. acme.com",
  review: "Add your own buyer question…",
  running: "Pip is listening to the assistants…",
  done: "Check another product…",
};

const SKIP = /^(skip|no|none|nope|n\/a|-)$/i;
const EMPTY_BRIEF: Brief = { product: "", category: "", audience: "", competitors: [] };
const ALL_MODELS = Object.fromEntries(MODEL_IDS.map((m) => [m, true])) as Record<ModelId, boolean>;

let counter = 0;
const uid = () => `m${++counter}`;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function nextMissing(draft: Brief): Step {
  if (!draft.category) return "category";
  if (!draft.audience) return "audience";
  return "competitors";
}

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
  const [planned, setPlanned] = useState<PlannedQuestion[]>([]);
  const [models, setModels] = useState(ALL_MODELS);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [input, setInput] = useState("");
  const [runCtx, setRunCtx] = useState<RunContext | null>(null);
  const [openAnswer, setOpenAnswer] = useState<ModelAnswer | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const runIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/providers")
      .then((r) => r.json())
      .then((data: { providers: ProviderStatus[] }) => !cancelled && setProviders(data.providers))
      .catch(() =>
        !cancelled && setProviders(MODEL_IDS.map((id) => ({ id, label: MODEL_LABELS[id], source: "mock" as const }))),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const append = useCallback((...items: Message[]) => setMessages((prev) => [...prev, ...items]), []);

  const say = useCallback(
    async (...items: PipItem[]) => {
      for (const item of items) {
        setTyping(true);
        await wait(item.kind === "text" ? Math.min(450 + item.text.length * 6, 1100) : 350);
        setTyping(false);
        append({ ...item, id: uid(), role: "pip" });
      }
    },
    [append],
  );

  const enabledQuestions = useMemo(() => planned.filter((p) => p.enabled).map((p) => p.question), [planned]);
  const selectedModels = useMemo(() => MODEL_IDS.filter((m) => models[m]), [models]);

  const onFinish = useCallback(
    async (state: RunState, request: CheckRequest) => {
      const id = runIdRef.current;
      if (!id) return;
      const { brief, questions } = request;
      if (state.answers.length === 0) {
        setStep("review");
        await say({ kind: "text", mood: "idle", text: `Oh dear, the check didn't finish: ${state.failure ?? "no answers came back"}. Want to try again?` });
        return;
      }
      saveRun({
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
      setStep("done");
      await say(
        {
          kind: "text",
          mood: "happy",
          text: `All ${report.totalAnswers} answers are in! **${brief.product}** came up in ${pct(report.product.mentionRate)} of them and ranks ${ordinal(report.productPosition)} for share of voice.${modelLine}${errorsLine}`,
        },
        { kind: "summary" },
      );
    },
    [say],
  );

  const { state: run, start, reset: resetRun } = useCheckRun(onFinish);

  const live = useMemo(() => {
    if (!runCtx || run.status === "idle") return null;
    return buildReport({ brief: runCtx.brief, questions: runCtx.questions, answers: run.answers });
  }, [runCtx, run.answers, run.status]);

  useEffect(() => {
    if (messages.length === 0) return;
    const id = requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    return () => cancelAnimationFrame(id);
  }, [messages.length, typing, run.answers.length]);

  const goReview = useCallback(
    async (brief: Brief) => {
      const normalized = normalizeBrief(brief);
      setDraft(normalized);
      const questions = generateQuestions(normalized);
      setPlanned(questions.map((question) => ({ question, enabled: true })));
      setStep("review");
      await say(
        {
          kind: "text",
          text: `Here's my plan. I'll ask each assistant these ${questions.length} questions, the way a real buyer would. None of them name **${normalized.product}**, so every recommendation is unprompted.`,
        },
        { kind: "plan" },
      );
    },
    [say],
  );

  const askCompetitors = () =>
    say({
      kind: "text",
      text: `Which competitors should I keep an eye on? List a few, separated by commas, or skip and I'll spot them in the answers.`,
    }).then(() => setStep("competitors"));

  const handleProduct = async (text: string) => {
    const fields = parseIntro(text);
    if (!fields.product) {
      await say({ kind: "text", text: "What's your product called?" });
      return;
    }
    const next = { ...EMPTY_BRIEF, ...fields };
    setDraft(next);
    const missing = nextMissing(next);
    if (missing === "category") {
      setStep("category");
      await say({
        kind: "text",
        mood: "wave",
        text: `Lovely to meet **${next.product}**! What kind of product is it? A short category works best, like “CRM” or “plant care app”.`,
      });
    } else if (missing === "audience") {
      setStep("audience");
      await say({
        kind: "text",
        mood: "wave",
        text: `**${next.product}**, a ${next.category}. Lovely! Who is it for? Describe your typical buyer or use case.`,
      });
    } else {
      await say({ kind: "text", mood: "happy", text: `Lovely: **${next.product}**, a ${next.category} for ${next.audience}.` });
      await askCompetitors();
    }
  };

  const handleCategory = async (text: string) => {
    const [category, audience] = text.split(/\s+for\s+/i);
    const next = {
      ...draft,
      category: category.replace(/^(?:it'?s|it is)?\s*(?:a|an|the)\s+/i, "").replace(/[.!]+$/, "").trim(),
      audience: audience?.replace(/[.!]+$/, "").trim() || draft.audience,
    };
    setDraft(next);
    if (!next.audience) {
      setStep("audience");
      await say({ kind: "text", text: `A ${next.category}, got it. Who is it for? Describe your typical buyer or use case.` });
    } else {
      await askCompetitors();
    }
  };

  const handleAudience = async (text: string) => {
    const next = { ...draft, audience: text.replace(/^(?:it'?s\s+)?for\s+/i, "").replace(/[.!]+$/, "").trim() };
    setDraft(next);
    await askCompetitors();
  };

  const handleCompetitors = async (text: string) => {
    const competitors = parseCompetitors(text);
    const next = { ...draft, competitors };
    setDraft(next);
    await say({
      kind: "text",
      text: competitors.length ? `Noted. I'll watch ${listJoin(competitors)}.` : "No problem, I'll spot rivals in the answers.",
    });
    if (next.website) {
      await goReview(next);
      return;
    }
    setStep("website");
    await say({ kind: "text", text: "Last one: what's your website? It helps me notice when assistants cite you." });
  };

  const handleWebsite = async (text: string) => {
    if (SKIP.test(text.trim())) {
      await goReview(draft);
      return;
    }
    const domain = siteDomain(text);
    if (!domain) {
      await say({ kind: "text", text: "That doesn't look like a web address. Try something like acme.com, or skip." });
      return;
    }
    await goReview({ ...draft, website: domain });
  };

  const handleReview = async (text: string) => {
    if (planned.length >= 10) {
      await say({ kind: "text", text: "That's the most I can ask in one check (10 questions). Untick one to make room." });
      return;
    }
    setPlanned((prev) => [...prev, { question: { id: `c${prev.length + 1}-${uid()}`, text, intent: "custom" }, enabled: true }]);
    await say({ kind: "text", text: "Added to the list! Anything else, or shall we start?" });
  };

  const restart = useCallback(() => {
    resetRun();
    runIdRef.current = null;
    setRunCtx(null);
    setMessages([]);
    setDraft(EMPTY_BRIEF);
    setPlanned([]);
    setModels(ALL_MODELS);
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
      await handleProduct(text);
      return;
    }
    append({ id: uid(), role: "user", text });
    switch (step) {
      case "product":
        return handleProduct(text);
      case "category":
        return handleCategory(text);
      case "audience":
        return handleAudience(text);
      case "competitors":
        return handleCompetitors(text);
      case "website":
        return handleWebsite(text);
      case "review":
        return handleReview(text);
    }
  };

  const startRun = async () => {
    if (enabledQuestions.length === 0 || selectedModels.length === 0) return;
    const id = newRunId();
    const brief = normalizeBrief(draft);
    runIdRef.current = id;
    setRunCtx({ id, brief, questions: enabledQuestions, models: selectedModels });
    setStep("running");
    append({ id: uid(), role: "user", text: "Let's go!" });
    await say({ kind: "text", mood: "thinking", text: "Off I go! I'll drop each answer in as it lands." }, { kind: "run" });
    void start({ brief, questions: enabledQuestions, models: selectedModels });
  };

  const quickReplies: string[] = (() => {
    if (typing) return [];
    switch (step) {
      case "category":
        return ["CRM", "project management tool", "AI writing assistant", "accounting software"];
      case "audience":
        return ["small businesses", "startups", "enterprise teams", "freelancers"];
      case "competitors":
        return ["Skip"];
      case "website": {
        const guess = guessDomain(draft.product);
        return guess ? [guess, "Skip"] : ["Skip"];
      }
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
    if (message.kind === "plan") {
      return (
        <PipMessage key={message.id} wide>
          <PlanCard
            brief={normalizeBrief(draft)}
            planned={planned}
            models={models}
            providers={providers}
            locked={step !== "review"}
            onToggleQuestion={(id) => setPlanned((prev) => prev.map((p) => (p.question.id === id ? { ...p, enabled: !p.enabled } : p)))}
            onRemoveQuestion={(id) => setPlanned((prev) => prev.filter((p) => p.question.id !== id))}
            onToggleModel={(id) => setModels((prev) => ({ ...prev, [id]: !prev[id] }))}
            onStart={startRun}
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
              Do AI assistants <span className="text-meadow-600">recommend you?</span>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="mt-4 max-w-xl text-lg text-balance text-ink-soft"
            >
              Tell Pip about your product. We&apos;ll ask ChatGPT, Claude, Gemini and Perplexity what your buyers ask, then show how often
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
                placeholder={PLACEHOLDERS[step]}
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
