import { InformationCircleIcon } from "@hugeicons/core-free-icons";
import { SectionCard } from "@/components/report/shared";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const ITEMS = [
  {
    q: "How is share of voice calculated?",
    a: "Each brand counts once per answer it appears in. Your share of voice is your mentions divided by all brand mentions. The per-assistant view uses only that assistant's answers.",
  },
  {
    q: "What do mention rate and average position mean?",
    a: "Mention rate is the share of answers that name you at least once. Position is the order in which brands are first named in an answer, so #1 means you were named first. Average position only counts answers that mention you.",
  },
  {
    q: "Why don't the questions mention my product?",
    a: "Buyers ask open questions, so these do too. That way every mention is earned. If a question names a brand (like “alternatives to X”), that brand isn't credited for that answer.",
  },
  {
    q: "Where do the rivals come from?",
    a: "Competitors you listed are always tracked. Any other brand that appears as a list item in at least two answers is added automatically, so you can spot rivals you didn't know about.",
  },
  {
    q: "Which sources are counted?",
    a: "Links returned by the assistant (Perplexity citations, Gemini search grounding, ChatGPT and Claude web search) plus links written into the answer. Each URL counts once per answer, grouped by domain.",
  },
  {
    q: "How is sentiment judged?",
    a: "A light word list looks at the sentence around each mention, with simple negation handling. Treat it as a direction, not a verdict, and read the answers for nuance.",
  },
  {
    q: "What are demo answers?",
    a: "When an assistant has no API key configured, it answers with realistic sample text and fictional rivals so you can explore the whole flow. Add keys (see the README) to ask the real assistants.",
  },
];

export function Methodology() {
  return (
    <SectionCard
      id="method"
      icon={InformationCircleIcon}
      tint="bg-sky-100 text-sky-700"
      title="How this report works"
      description="The scoring is simple on purpose, so you can explain it to your team."
    >
      <Accordion type="single" collapsible className="grid gap-x-6 md:grid-cols-2">
        {ITEMS.map((item) => (
          <AccordionItem key={item.q} value={item.q} className="border-border/60">
            <AccordionTrigger className="px-1 font-heading text-base font-semibold hover:no-underline">{item.q}</AccordionTrigger>
            <AccordionContent className="px-1 text-ink-soft">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </SectionCard>
  );
}
