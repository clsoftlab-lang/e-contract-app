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
- Builds a per-task prompt server-side and calls:
  ```js
  client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    system, messages
  })
  ```
- Streams the text back to the browser as it is generated.
- Tasks: `explain_clause`, `draft_contract`, `contract_qa`.
- Reads `ANTHROPIC_API_KEY` from the environment (**never hardcoded**) and
  refuses to start without it.
- Sends CORS headers for your Pages origin (`ALLOWED_ORIGIN`).

## Run it

```bash
cd server
npm install                       # installs @anthropic-ai/sdk
cp .env.example .env              # then edit .env, or export the vars instead
export ANTHROPIC_API_KEY=sk-...   # server-side only
export ALLOWED_ORIGIN=https://clsoftlab-lang.github.io
npm start                         # -> listening on :8787
```

## Point the app at it

In `../ai/config.js` set:

```js
export const AI_ENDPOINT = "https://your-proxy.example.com/api/ai";
```

Leave it as `""` to keep using the offline mock (the default demo behavior).

## Security notes

- **Keys stay server-side, never in the browser or the repo.** Store the key in
  your host's secret manager, not in source control.
- Deploy behind HTTPS.
- Restrict `ALLOWED_ORIGIN` to your own front-end origin.
- Consider adding rate limiting / auth for production traffic.

## Model

Uses `claude-opus-5` with adaptive thinking. To change the model, edit the
`MODEL` constant in `index.mjs`.
