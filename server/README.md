<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# e-Contract — Reference AI Proxy

A tiny, self-contained backend that turns the demo's **built-in mock AI** into
**real AI** powered by Claude. You (the operator) deploy this with your own key;
the project itself never runs it and never ships a key.

## Why a proxy?

The browser must **never** hold an API key. This proxy is the only place the
key lives. The browser calls `POST /api/ai` on your proxy; the proxy calls
Anthropic and streams the answer back.

```
browser (ai/ai.js)  ──POST {task,payload}──▶  this proxy  ──▶  Anthropic (Claude)
        ▲                                          │
        └──────────── streamed text ◀──────────────┘
   no key anywhere here            ANTHROPIC_API_KEY only here (env)
```

## What it does

- Exposes one route: `POST /api/ai` with body `{ "task", "payload" }`.
- Builds a per-task prompt server-side and calls the Messages API with a
  **cost-first** default model and **prompt caching**:
  ```js
  client.messages.stream({
    model: MODEL,                 // default 'claude-haiku-4-5'
    max_tokens: 700,              // modest per-task cap
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages
    // Haiku 4.5: NO thinking / effort (it 400s). Other models add
    // thinking:{type:'adaptive'} + output_config:{effort:'low'}.
  })
  ```
- Streams the text back to the browser as it is generated.
- Tasks: `explain_clause`, `draft_contract`, `contract_qa`, `risk_summary`.
- Reads `ANTHROPIC_API_KEY` from the environment (**never hardcoded**) and
  refuses to start without it.
- Sends CORS headers for your Pages origin (`ALLOWED_ORIGIN`).
- **Cost guardrails**: a per-IP rate limit (default 20/min) and a monthly token
  budget (`AI_MONTHLY_TOKEN_CAP`, default 2,000,000). Over either limit it
  returns `429 {"fallback":true}` and the browser transparently uses the offline
  mock — so the app never breaks and spend stays capped.

## Model & cost

Defaults to the cost-first **`claude-haiku-4-5`** ($1 / $5 per MTok in/out).
Prompt caching makes the repeated system prompt cheap, and the modest
`max_tokens` keeps each answer small. Raise quality by setting `AI_MODEL`:

```bash
export AI_MODEL=claude-sonnet-5   # or claude-opus-5 (higher quality, higher cost)
export AI_EFFORT=low              # only used by non-Haiku models
```

## Run it

```bash
cd server
npm install                       # installs @anthropic-ai/sdk
cp .env.example .env              # then edit .env, or export the vars instead
export ANTHROPIC_API_KEY=sk-...   # server-side only
export ALLOWED_ORIGIN=https://clsoftlab-lang.github.io
npm start                         # -> listening on :8787
```

## Free (무인) deploy — Cloudflare Workers

`worker.js` + `wrangler.toml` are a drop-in Workers variant with the **same
routing, model, caching and guardrail rules**. The free tier means **no server
to babysit** — nothing to keep running, patch, or pay for at idle.

```bash
cd server
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY   # server-side secret; never committed
npx wrangler deploy                          # -> https://e-contract-ai.<subdomain>.workers.dev
```

Edit non-secret settings (origin, model) in `wrangler.toml` `[vars]`. Then point
the app at `https://…workers.dev/api/ai` (see below).

## Point the app at it

In `../ai/config.js` set:

```js
export const AI_ENDPOINT = "https://your-proxy.example.com/api/ai";
```

Leave it as `""` to keep using the offline mock (the default demo behavior).
Whenever the endpoint is unreachable, rate-limited, or over budget, the app
**auto-falls back to the offline mock**, so it keeps working unmanned.

## Security notes

- **Keys stay server-side, never in the browser or the repo.** Store the key in
  your host's secret manager, not in source control.
- Deploy behind HTTPS.
- Restrict `ALLOWED_ORIGIN` to your own front-end origin.
- A basic per-IP rate limit + monthly token budget are built in; add auth /
  a stronger limiter for heavy production traffic.
