<!--
SPDX-License-Identifier: Apache-2.0
Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
-->
# 한국전자계약 · e-Contract (Demo)

A no-build, browser-only **e-contract / e-signature demo app**. Pick a
template, fill in a wizard, preview the contract, **draw a signature on
canvas**, and see a **real SHA-256 document hash** computed with the Web
Crypto API for tamper-evidence. Everything is stored locally in your browser.

**한국어 문서: [README.ko.md](README.ko.md)**

## 🔗 LIVE DEMO
**https://clsoftlab-lang.github.io/e-contract-app/**

## Features
- **Template gallery** — 5 contract types: employment (근로), lease (부동산 임대차), loan (금전 차용), service/freelance (용역/프리랜서), NDA (비밀유지).
- **Authoring wizard** — grouped fields (parties / terms / amounts) with required-field validation and a per-template checklist.
- **Live preview** — clauses filled from your inputs; missing values shown as visible blanks.
- **Canvas signature** — draw with mouse or touch (pointer events, high-DPI), clear and re-sign; each signature is stamped with a timestamp and signer name.
- **Document integrity (SHA-256)** — a real `crypto.subtle.digest` hash of the canonical contract content; change one character and the hash changes completely.
- **Status tracking** — 작성중 (draft) / 서명대기 (awaiting) / 완료 (completed), derived from signature count.
- **My contract box** — search + status filter over saved contracts.
- **Audit log** — who did what and when (created / signed / saved / shared).
- **Mock share link + Print/PDF** — `window.print()` output; a demonstration share URL (nothing is transmitted).
- **Extras** — contract checklist, **expiry alerts** (D-30 / overdue tags), SHA-256 hash shown on cards.
- Responsive, mobile-first, light + dark (`prefers-color-scheme`), reset button.

## 🤖 AI 기능 (API 연동)

Three AI features are built in. They work **immediately in the live demo via a
built-in, offline mock provider** (no key, no network, no cost) and switch to
real Claude the moment an operator deploys the reference proxy.

1. **조항 쉬운 설명 + 리스크 플래그** — explains a contract clause in plain Korean and flags risky/unfair wording (지연손해금, 해지, 연체 …). *(preview view)*
2. **조건 입력 → 계약 초안 생성** — from a short brief (당사자·금액·기간 등), drafts field values to **prefill the wizard**. *(wizard view)*
3. **계약 Q&A 챗봇** — answers questions about the current contract using its own fields and clauses. *(preview view)*

> ⚠️ **NOT legal advice.** AI output is general information to aid understanding
> only, is not legal advice, and can be wrong — have important decisions
> reviewed by a qualified professional.

**How it plugs in (secure by design):**
- `ai/config.js` — `AI_ENDPOINT` is `""` by default ⇒ the offline **MockProvider** runs. This is what powers the GitHub Pages demo.
- `ai/ai.js` — `askAI(task, payload, {onToken})`: empty endpoint ⇒ local mock; otherwise streams from your proxy.
- Enable **real AI**: deploy `server/` (reference proxy) with your `ANTHROPIC_API_KEY` (model `claude-opus-5`, adaptive thinking, streaming), then set `AI_ENDPOINT` to its `/api/ai` URL. See [`server/README.md`](server/README.md).

> 🔐 **Keys live server-side only — NEVER in the browser or in this repo.** The
> browser only ever talks to your proxy origin; the proxy is the only place the
> Anthropic key exists. `check.mjs` asserts no key token is ever committed.

## Run locally
No build step and no dependencies. Serve the folder statically:

```bash
python -m http.server 8981
# then open http://localhost:8981
```

(A static server is needed because the app uses ES modules + `fetch()` for `data/templates.json`.)

## ⚠️ DEMO-MODE BOUNDARIES (read this)
- **This is NOT a legally binding e-signature service.** Templates and clause text are generic demo samples, not legal advice.
- **Signing and hashing are client-side only.** A drawn signature + SHA-256 hash demonstrates integrity, but is **not** a certified electronic signature.
- **localStorage is NOT a real database.** Data lives only in this one browser, is not backed up, and can be cleared at any time.
- **No real accounts, no PII, no identity verification.** Use fictional demo data only — do not enter real personal information.
- **A production build would require** a backend/server, a certified e-signature / PKI provider, identity verification (본인인증), secure storage, and legal review.

## Tech
Vanilla HTML + CSS + ES-module JavaScript. `<canvas>` for signatures,
`crypto.subtle` (Web Crypto) for SHA-256, `localStorage` for persistence,
`window.print()` for output. Relative paths only, so it deploys to GitHub
Pages with no build.

```
index.html          app shell + required containers
styles.css          responsive light/dark styling
app.js              SPA controller (views, wizard, signing)
modules/hash.js     SHA-256 + canonical text + formatting (pure helpers)
modules/storage.js  localStorage persistence (try/catch)
modules/contract.js domain logic: validation, status, audit (pure helpers)
modules/signature.js canvas signature pad (pointer/touch)
data/templates.json 5 templates with field schemas + Korean clause text
ai/config.js        AI_ENDPOINT switch ("" ⇒ built-in mock)
ai/ai.js            askAI() + deterministic offline MockProvider
ai/ui.js            wires the 3 AI features into the wizard/preview views
server/index.mjs    REFERENCE proxy (holds ANTHROPIC_API_KEY server-side)
check.mjs           JSON/HTML validation + unit tests + AI-KIT checks (CI)
```

## Contributors
- Dr. Lee Il-guk (이일국)
- LWJ
- LMJ
- Claude

## License
- **Code:** Apache-2.0 — see [LICENSE](LICENSE).
- **Docs & templates text:** CC BY 4.0.

SPDX headers: `Apache-2.0`, `Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)`.

---
*Not an official Anthropic product.*

## 🎓 Idea origin

The seed idea for this project came from the **entrepreneurship class taught by Dr. Lee Il-guk (이일국) at Yongin University (용인대학교)**. The students in that class produced startup ideas of remarkable, standout creativity — this project is one of those exceptional ideas, finally brought to life as a working service. Built with deep admiration and gratitude for those students' imagination. *(No student personal information is included; only the idea itself was used, implemented clean-room.)*
