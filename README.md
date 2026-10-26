# Meadowlark: AI search share-of-voice checker

Meadowlark shows whether AI assistants recommend your product. Tell Pip (the meadowlark who runs the checks) your product, category, audience and rivals. Pip asks ChatGPT, Claude, Gemini and Perplexity the questions your buyers ask, streams each answer into the chat as it lands, and then builds a report:

- **Share of voice**, overall and for each assistant
- **Ranking**: average position, mention rate and first-place answers
- **Cited sources**: which domains the assistants trust, including your site and rivals' sites
- **Assistant by assistant**: how each one treats you and who it favours
- **Prompt by prompt**: every question and answer, with the full text one click away
- **Next steps**: rule-based recommendations, plus sentiment, competitor gaps and the prompts you're missing from

It works with no API keys. Any assistant without a key answers with realistic demo text and fictional rivals, so you can try the whole flow straight away. Add keys to ask the real assistants.

## Run it locally

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Open [http://localhost:47321](http://localhost:47321). The sample report lives at [/report/demo](http://localhost:47321/report/demo).

## Connect real assistants

Copy `.env.example` to `.env.local` and add any keys you have, then restart `pnpm dev`. Each assistant switches to live answers on its own. The rest stay in demo mode, and the report labels which is which.

| Assistant  | Key                                    | Optional settings                                         |
| ---------- | -------------------------------------- | --------------------------------------------------------- |
| ChatGPT    | `OPENAI_API_KEY`                       | `OPENAI_MODEL` (default `gpt-4.1-mini`), `OPENAI_WEB_SEARCH` |
| Claude     | `ANTHROPIC_API_KEY`                    | `ANTHROPIC_MODEL` (default `claude-haiku-4-5`), `ANTHROPIC_WEB_SEARCH` |
| Gemini     | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_WEB_SEARCH` |
| Perplexity | `PERPLEXITY_API_KEY`                   | `PERPLEXITY_MODEL` (default `sonar`)                      |

Web search is off by default for ChatGPT, Claude and Gemini, and Perplexity always searches. Turning it on gets you cited sources, but costs more per check. OpenAI web search needs a search model such as `gpt-4o-mini-search-preview`. Set `SOV_FORCE_MOCK=true` to ignore all keys.

### One key for everything: OpenRouter

Set `OPENROUTER_API_KEY` and every assistant without its own key runs through [OpenRouter](https://openrouter.ai). A direct key always wins for that assistant.

| Assistant  | OpenRouter model (default)     | Override                      |
| ---------- | ------------------------------ | ----------------------------- |
| ChatGPT    | `openai/gpt-6-luna`            | `OPENROUTER_CHATGPT_MODEL`    |
| Claude     | `anthropic/claude-haiku-5.5`   | `OPENROUTER_CLAUDE_MODEL`     |
| Gemini     | `google/gemini-3.1-flash-lite` | `OPENROUTER_GEMINI_MODEL`     |
| Perplexity | `perplexity/sonar`             | `OPENROUTER_PERPLEXITY_MODEL` |

The `*_WEB_SEARCH` flags above also apply through OpenRouter, using its web plugin. Perplexity still searches on its own. `OPENROUTER_BASE_URL` points everything at another OpenAI-compatible gateway.

Keys stay on the server. The browser only learns whether each assistant is live, and which model it uses.

## How Pip reads your replies

With a key, each intake reply goes to a small, fast model through `POST /api/intake`. The model gets Pip's question, the answers so far and the reply, and returns structured JSON: whether you answered, skipped or were unclear, the cleaned values, and Pip's next message. One reply can fill several steps ("It's Fernly, a plant care app for new plant parents, site's fernly.app"), and Pip skips the steps already answered.

The model only reads and phrases. It never touches the questions or the scoring:

- The output is checked against a schema, and values are cleaned with the same rules as the built-in parser. Product, competitor and website values must appear in your reply, so the model can't invent them.
- The flow is fixed. Pip only uses the model's message when it asks for the step the app picks next. Messages with links or markup are dropped.
- Replies are capped at 500 characters and passed as quoted data, with instructions to ignore any requests inside them.

With no key, after a 6 second timeout (`SOV_INTAKE_TIMEOUT_MS`, up to 8000), on an error, or when the output doesn't validate, Pip falls back to the rule-based parser in `src/lib/sov/intake.ts`, so demo mode works the same.

| Setting                   | Default                                                         |
| ------------------------- | --------------------------------------------------------------- |
| Model, first key found    | OpenRouter `deepseek/deepseek-v4-flash`, then OpenAI `gpt-4.1-nano`, Anthropic `claude-haiku-4-5`, Gemini `gemini-2.5-flash-lite` |
| Overrides                 | `OPENROUTER_INTAKE_MODEL`, `OPENAI_INTAKE_MODEL`, `ANTHROPIC_INTAKE_MODEL`, `GEMINI_INTAKE_MODEL` |
| `SOV_INTAKE_RULES=true`   | Always use the rule-based parser, even with keys               |

Through OpenRouter, the intake asks for strict structured output from hosts that support it (`require_parameters`) and turns reasoning off (`reasoning.effort: "none"`). DeepSeek V4 Flash reasons by default, and the reasoning would use up the whole output budget before any JSON appears. If you override the model with one that has no reasoning switch, OpenRouter finds no host for that setting, so the request is retried once without it.

## How the scoring works

The scoring is deliberately simple so you can explain it to your team. It lives in `src/lib/sov/` and is covered by unit tests.

- **Questions** are unbranded ("What's the best CRM for small agencies?"), so every mention is earned. A brand named in a question isn't credited for that answer.
- **Mentions** are matched on word boundaries, with sensible aliases ("Acme CRM" also matches "Acme").
- **Rank** is the order in which brands are first named in an answer. Average position only counts answers that mention the brand.
- **Mention rate** is answers mentioning the brand divided by all answers.
- **Share of voice** is a brand's mentions divided by all brand mentions, overall or within one assistant's answers.
- **Rivals** are the competitors you list, plus any brand that appears as a list item in at least two answers.
- **Sources** are the provider's citations plus links written into the answer, deduplicated per answer and grouped by domain.
- **Sentiment** is a light word list around each mention with negation handling. It's a direction, not a verdict.

## Project layout

```
src/
  app/
    page.tsx                 Chat intake (the landing page)
    report/[id]/page.tsx     Dashboard (/report/demo is the sample)
    api/check/route.ts       Runs a check and streams NDJSON events
    api/intake/route.ts      Reads one intake reply with the intake model or the rules
    api/providers/route.ts   Which assistants are live or demo
  components/
    check/                   Chat: composer, messages, plan, live run and summary cards
    report/                  Dashboard cards and layout
    answer/                  Full-answer dialog with highlighted mentions
    art/                     Original artwork: Pip, clouds, sky scene, assistant glyphs
    ui/                      shadcn/ui primitives, restyled
  lib/
    sov/                     Scoring, question generation, mock answers, run engine, rule-based intake parser
    intake/                  AI intake: prompt, output schema, model clients, merging into intake state
    providers/               Provider config and live API adapters, direct or via OpenRouter (plain fetch)
```

Runs are saved in the browser's `localStorage` (the 12 most recent). There's no database or account.

## Scripts

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `pnpm dev`       | Dev server on port 47321           |
| `pnpm build`     | Production build                   |
| `pnpm start`     | Serve the production build on 47321 |
| `pnpm test`      | Unit tests (Vitest)                |
| `pnpm lint`      | ESLint                             |
| `pnpm typecheck` | TypeScript, no emit                |

## Notes

- Built with Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS v4, shadcn/ui, Motion and Recharts.
- All artwork is original. The assistant glyphs are simple shapes, not the vendors' logos.
- AI answers vary from run to run. Treat one check as a snapshot, and re-run it to spot trends.
