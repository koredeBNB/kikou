# Kioku: AI search share-of-voice checker

**Are you in the AI's memory?** Kioku (Japanese for "memory") shows whether AI assistants recommend your product. Tell Pip (the bird who runs the checks) your product, category, audience, rivals and, if you like, the topics to research ("research BNB's standing within trading, RWA, AI"). Pick how many questions to ask, from 1 to 100. Pip shows what the check will cost and how long it will take, and once you say go, asks ChatGPT, Claude, Gemini and Perplexity the questions your buyers ask, streams each answer into the chat as it lands, and builds a report:

- **Share of voice**, overall and for each assistant
- **By topic**: share of voice, rank, rivals, cited sources and next steps for each research topic
- **Ranking**: average position, mention rate and first-place answers
- **Cited sources**: which domains the assistants trust, including your site and rivals' sites
- **Assistant by assistant**: how each one treats you and who it favours
- **Prompt by prompt**: every question and answer, filterable by topic and by where you're missing, with the full text one click away
- **Next steps**: rule-based recommendations, plus sentiment, competitor gaps and the prompts you're missing from

It works with no API keys. Any assistant without a key answers with realistic demo text and fictional rivals, so you can try the whole flow straight away. Add keys to ask the real assistants.

## Run it locally

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Open [http://localhost:47321](http://localhost:47321). The sample report lives at [/report/demo](http://localhost:47321/report/demo).

Locally you don't need Redis: run state, the daily budget and rate limits are kept in the server process and reset when it restarts. To use a real Redis locally (for example the one your Vercel project uses), put its REST URL and token in `.env.local` as `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or pull them with `vercel env pull .env.local`.

## Connect real assistants

Copy `.env.example` to `.env.local` and add any keys you have, then restart `pnpm dev`. Each assistant switches to live answers on its own. The rest stay in demo mode, and the report labels which is which.

| Assistant  | Key                                    | Optional settings                                         |
| ---------- | -------------------------------------- | --------------------------------------------------------- |
| ChatGPT    | `OPENAI_API_KEY`                       | `OPENAI_MODEL` (default `gpt-4.1-mini`), `OPENAI_WEB_SEARCH` |
| Claude     | `ANTHROPIC_API_KEY`                    | `ANTHROPIC_MODEL` (default `claude-haiku-4-5`), `ANTHROPIC_WEB_SEARCH` |
| Gemini     | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `GEMINI_MODEL` (default `gemini-2.5-flash`), `GEMINI_WEB_SEARCH` |
| Perplexity | `PERPLEXITY_API_KEY`                   | `PERPLEXITY_MODEL` (default `sonar`)                      |

With direct keys, web search is off by default for ChatGPT, Claude and Gemini, and Perplexity always searches. Set `OPENAI_WEB_SEARCH`, `ANTHROPIC_WEB_SEARCH` or `GEMINI_WEB_SEARCH` to `true` to get cited sources, at a higher cost per check. OpenAI web search needs a search model such as `gpt-4o-mini-search-preview`, and Anthropic web search must be enabled for your organisation. Set `SOV_FORCE_MOCK=true` to ignore all keys.

### One key for everything: OpenRouter

Set `OPENROUTER_API_KEY` and every assistant without its own key runs through [OpenRouter](https://openrouter.ai). A direct key always wins for that assistant.

| Assistant  | OpenRouter model (default)     | Override                      |
| ---------- | ------------------------------ | ----------------------------- |
| ChatGPT    | `openai/gpt-6-luna`            | `OPENROUTER_CHATGPT_MODEL`    |
| Claude     | `anthropic/claude-haiku-5.5`   | `OPENROUTER_CLAUDE_MODEL`     |
| Gemini     | `google/gemini-3.1-flash-lite` | `OPENROUTER_GEMINI_MODEL`     |
| Perplexity | `perplexity/sonar`             | `OPENROUTER_PERPLEXITY_MODEL` |

Through OpenRouter, ChatGPT, Claude and Gemini search the web by default, like the real assistants. OpenRouter's web plugin uses each provider's own search, and the report reads the sources from the answer's URL citations. Set `OPENAI_WEB_SEARCH`, `ANTHROPIC_WEB_SEARCH` or `GEMINI_WEB_SEARCH` to `false` to turn it off for that assistant. Search costs extra: Gemini's native search is the priciest of the three. Perplexity always searches on its own. `OPENROUTER_BASE_URL` points everything at another OpenAI-compatible gateway.

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

## Questions, topics and the estimate

After the website, Pip asks what to focus on (skip for a broad check) and how many questions to ask each assistant: 10, 25, 50, 100 or any number up to 100. Casual answers like "about 50" or "max" work.

Broad checks of up to 6 questions use the built-in set. Anything bigger goes to `POST /api/questions`, where the intake model writes the rest in parallel batches of up to 25, each with a different angle: best picks, alternatives, comparisons, beginners, budget and use cases. Every question is cleaned, near-duplicates are dropped, and any question naming your product, its site or a squashed spelling of it ("TrustWallet") is thrown out. With topics, the count is split evenly across them and each topic is written separately. If the writer is slow (`SOV_QUESTIONS_TIMEOUT_MS`, 40 seconds by default), fails or comes back short, templates fill the gap and Pip says if there are fewer distinct questions than you asked for. Every question stays editable on the plan card.

The estimate comes from the average cost and time of real answers from each assistant, with web search on or off (`ANSWER_RATES` in `src/lib/sov/estimate.ts`). It depends only on the number of questions, the assistants you tick and the web search switch, and updates as you change them. Nothing runs until you press **Ask** or say "go ahead".

Big checks run each assistant's questions a few at a time (5 by default). Rate limits and server errors are retried up to three times, honouring `Retry-After`, and a timed-out answer gets one more try. Answers that still fail are listed in the chat and the report and left out of every number.

## How a check runs

No request runs for the whole check, so a 100-question check works on serverless hosts:

1. `POST /api/check` checks the plan, the visitor's rate limit and today's budget, saves the run, holds its estimated cost and returns a run id.
2. The browser then asks `POST /api/check/[id]/batch` for up to 5 answers at a time for one assistant, keeping 5 in flight per assistant. Each batch streams its answers back as they land, with a heartbeat every 15 seconds, and stops answering after 100 seconds (`maxDuration` is 120). Most batches take 5 to 30 seconds.
3. `POST /api/check/[id]/finish` gives back whatever is left of the hold. If the tab closes, the hold lapses on its own 10 minutes after the last batch.

Every answer is claimed before it's asked and saved once, so a batch that's sent twice (after a dropped connection, say) gets the saved answers back and isn't charged again. A dropped batch is retried once; anything still missing is listed as a failed answer. The finished report is built and saved in the browser, as before; the server keeps run state for 6 hours.

Run state, the daily spend ledger and rate-limit counters live in Redis (Upstash, over its REST API) when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or the `KV_REST_API_URL` and `KV_REST_API_TOKEN` that the Vercel Marketplace sets, are present. Each change is one atomic Lua script, so many function instances can work on one check at once. Without them, the app uses an in-process store, which is fine for one local server. On Vercel without Redis, checks are refused with a clear message, because each request can land on a different instance. The store lives in `src/lib/store/`.

## Sharing it with a password

Set `SOV_BASIC_AUTH_USER` and `SOV_BASIC_AUTH_PASSWORD` to put the whole app behind HTTP basic auth: every page, API route and asset (`src/proxy.ts`). With either one unset, there's no password. Use a long random password, for example `openssl rand -base64 32`, because anyone with it can run checks on your keys.

Spending is capped per UTC day across everyone using the app: $20 by default, or `SOV_MAX_SPEND_PER_DAY` in dollars (`off` removes the cap). Each check holds its estimated cost when it starts, and every answer books what OpenRouter actually charged (`usage.cost`) and draws the hold down by the same amount. A check whose estimate is more than what's left, counting the holds of checks still running, gets a 429, and Pip says how much is left and when it resets. Demo answers are free and never blocked.

Each visitor (by IP address) can start 12 checks an hour, or `SOV_CHECKS_PER_HOUR`. Question plans (30 an hour) and intake replies (150 an hour) have their own limits; over those, Pip quietly falls back to templates and the built-in parser. `SOV_CHECKS_PER_HOUR=off` removes all three limits.

## Deploy to Vercel

1. Import the repository in Vercel (framework: Next.js; the defaults work). Pushes to `main` deploy to production, and other branches get preview deployments.
2. Add Redis: in the project, open **Storage**, choose **Upstash for Redis** from the Marketplace and connect it to Production and Preview. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`. From the CLI: `vercel integration add upstash`.
3. Add environment variables for Production and Preview, as sensitive values where offered:

   | Variable | Value |
   | --- | --- |
   | `OPENROUTER_API_KEY` | Your OpenRouter key |
   | `SOV_BASIC_AUTH_USER`, `SOV_BASIC_AUTH_PASSWORD` | The shared login, e.g. a password from `openssl rand -base64 24` |
   | `SOV_MAX_SPEND_PER_DAY` | Daily cap in dollars (20 if unset) |
   | `SOV_CHECKS_PER_HOUR` | Optional, checks per visitor per hour (12 if unset) |

4. Redeploy so the new variables apply (`vercel deploy --prod`, or **Redeploy** in the dashboard).

The longest route is a batch at 120 seconds, inside the 300-second default on every plan, so it runs on Hobby as well as Pro. Vercel's own Deployment Protection still guards preview URLs; the basic auth password guards the production domain. Changing an environment variable only takes effect on the next deployment.

## How the scoring works

The scoring is deliberately simple so you can explain it to your team. It lives in `src/lib/sov/` and is covered by unit tests.

- **Questions** are unbranded ("What's the best CRM for small agencies?"), so every mention is earned. A brand named in a question isn't credited for that answer.
- **Mentions** are matched on word boundaries, with sensible aliases ("Acme CRM" also matches "Acme").
- **Rank** is the order in which brands are first named in an answer. Average position only counts answers that mention the brand.
- **Mention rate** is answers mentioning the brand divided by all answers.
- **Share of voice** is a brand's mentions divided by all brand mentions, overall or within one assistant's answers.
- **Rivals** are the competitors you list, plus any brand that appears as a list item in at least two answers.
- **Sources** are the provider's citations plus links written into the answer, with tracking parameters such as `utm_source` removed, deduplicated per answer and grouped by domain.
- **Sentiment** is a light word list around each mention with negation handling. It's a direction, not a verdict.

## Project layout

```
src/
  proxy.ts                   Optional basic auth in front of everything
  app/
    page.tsx                 Chat intake (the landing page)
    report/[id]/page.tsx     Dashboard (/report/demo is the sample)
    api/check/route.ts       Starts a check: validates, rate-limits, holds the budget, saves the run
    api/check/[id]/batch/    Answers up to 5 questions of a check and streams them as NDJSON
    api/check/[id]/finish/   Releases a check's budget hold
    api/intake/route.ts      Reads one intake reply with the intake model or the rules
    api/questions/route.ts   Writes the buyer questions for a check (AI writer, then templates)
    api/providers/route.ts   Which assistants are live or demo, and today's budget
  components/
    check/                   Chat: composer, messages, plan, live run and summary cards
    report/                  Dashboard cards and layout
    answer/                  Full-answer dialog with highlighted mentions
    art/                     Original artwork: Pip, clouds, sky scene, assistant glyphs
    ui/                      shadcn/ui primitives, restyled
  lib/
    sov/                     Scoring, question generation, mock answers, answering and batching, budget, rate limits
    store/                   Run state, spend ledger and counters: Upstash Redis, or in-process for local use
    intake/                  AI intake: prompt, output schema, model clients, merging into intake state
    providers/               Provider config and live API adapters, direct or via OpenRouter (plain fetch)
```

Runs are saved in the browser's `localStorage` (the 12 most recent). Older reports are removed to make room for a big one, and a report too big to save at all stays open until you close the tab. There are no accounts; Redis only holds what a check needs while it runs.

## Scripts

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `pnpm dev`       | Dev server on port 47321           |
| `pnpm build`     | Production build                   |
| `pnpm start`     | Serve the production build on 47321 |
| `pnpm test`      | Unit tests (Vitest). Set `KIOKU_TEST_REDIS_URL` and `KIOKU_TEST_REDIS_TOKEN` to also run the store tests against a real Redis REST endpoint |
| `pnpm lint`      | ESLint                             |
| `pnpm typecheck` | TypeScript, no emit                |

## Notes

- Built with Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS v4, shadcn/ui, Motion and Recharts.
- All artwork is original. The assistant glyphs are simple shapes, not the vendors' logos.
- AI answers vary from run to run. Treat one check as a snapshot, and re-run it to spot trends.
