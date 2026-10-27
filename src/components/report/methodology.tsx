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
    q: "Where do the questions come from?",
    a: "You choose how many, up to 100. Small checks use a built-in set. For bigger ones an AI writer (Gemini 3.5 Flash Lite) drafts a mix of buyer questions: best picks, alternatives, comparisons, beginners, budget and specific use cases. Near-duplicates and anything naming your product or site are thrown out, and you can edit the list before it runs.",
  },
  {
    q: "How do research topics work?",
    a: "If you name topics, the questions are split evenly across them and written for each one. The “By topic” section scores each topic on its own questions, using the same rivals as the whole check, so you can see where you lead and where you're missing.",
  },
  {
    q: "What happens when an answer fails?",
    a: "Each assistant gets a few requests at a time. Rate limits and server errors are retried up to three times with a growing wait, and slow answers get one more try. Answers that still fail are listed in the report and left out of every number.",
  },
  {
    q: "How is the cost estimated?",
    a: "From the average cost and time of real answers from each assistant, with web search on or off. The estimate is held against the day's budget when a check starts, and the actual cost is booked when it finishes.",
  },
  {
    q: "Where do the rivals come from?",
    a: "Competitors you listed are always tracked. Any other brand that leads a list item in at least two answers is added automatically, so you can spot rivals you didn't know about. A small AI model then drops names that aren't rivals in your category (like a blockchain in a wallet check) and counts product lines as their brand, so “Ledger Nano X” counts as Ledger.",
  },
  {
    q: "Which sources are counted?",
    a: "Links returned by the assistant (Perplexity citations, Gemini search grounding, ChatGPT and Claude web search) plus links written into the answer. Each URL counts once per answer, grouped by domain.",
  },
  {
    q: "How is AI readability graded?",
    a: "Pip reads your site the way AI crawlers do, without running JavaScript, and scores it out of 100: crawler access (35), text that's in the HTML rather than loaded by JavaScript (30), structured data such as Organization and Article markup (20), and discovery files: a sitemap, canonical tags and llms.txt (15). Blocking a search crawler costs a lot, because it stops live answers citing you. Blocking a training crawler barely counts. Pip reads up to 12 pages: your homepage, the pages the answers cited, then pricing, comparison, docs and similar pages.",
  },
  {
    q: "How does Kioku's crawler treat my site?",
    a: "It calls itself KiokuBot, obeys robots.txt for every page it reads, and reads at most 12 pages, a few at a time. The exceptions are robots.txt itself, one homepage request as a normal browser, and one homepage request carrying each AI crawler's name to see whether your firewall lets it in. Those come from Kioku's servers, not the crawlers' real addresses, so confirm a refusal in your firewall's logs.",
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
