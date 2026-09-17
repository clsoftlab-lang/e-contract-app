// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// REFERENCE AI PROXY — deploy this yourself to enable real AI.
//
// This file is NOT run as part of the demo, CI, or this repo. It exists so an
// operator can stand up a tiny backend that holds the Anthropic API key and
// exposes ONE route the browser calls:
//
//     POST /api/ai   body: { task, payload }   ->  streamed text/plain response
//
// SECURITY MODEL (read this):
//   * The API key lives ONLY here, read from process.env.ANTHROPIC_API_KEY.
//     It is never sent to, or reachable from, the browser or the repo.
//   * The browser only ever talks to THIS origin; this server is the only
//     thing that talks to Anthropic.
//   * Deploy over HTTPS, keep the key in your host's secret store, and set
//     ALLOWED_ORIGIN to your Pages origin.
//
// COST MODEL (무인·저비용):
//   * MODEL defaults to the cost-first claude-haiku-4-5. Raise AI_MODEL to
//     claude-sonnet-5 or claude-opus-5 for higher quality (higher price).
//   * The stable per-task system prompt is sent as a cache_control:ephemeral
//     block so repeated calls read cache and cost less.
//   * Per-task max_tokens are modest (~700) so answers stay cheap.
//   * A per-IP rate limit + a monthly token budget (AI_MONTHLY_TOKEN_CAP) cap
//     spend; over budget => HTTP 429 {fallback:true} and the browser mock
//     transparently takes over (the app never breaks).
//
// Run: ANTHROPIC_API_KEY=sk-... node index.mjs   (see README.md / .env.example)

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://clsoftlab-lang.github.io';

// Cost-first default. AI_MODEL may be raised to 'claude-sonnet-5' or
// 'claude-opus-5' for higher quality at higher cost.
const MODEL = process.env.AI_MODEL || 'claude-haiku-4-5';
const AI_EFFORT = process.env.AI_EFFORT || 'low';

// Haiku 4.5 does NOT accept adaptive thinking / effort — sending them 400s.
const IS_HAIKU = MODEL.startsWith('claude-haiku');

// Cost guardrails.
const RATE_LIMIT_PER_MIN = Number(process.env.AI_RATE_LIMIT_PER_MIN || 20);
const MONTHLY_TOKEN_CAP = Number(process.env.AI_MONTHLY_TOKEN_CAP || 2_000_000);

// Modest per-task output caps (only raised where a task truly needs it).
const MAX_TOKENS = {
  explain_clause: 700,
  draft_contract: 1000, // JSON with many fields needs a little more room
  contract_qa: 700,
  risk_summary: 700
};

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('[proxy] ANTHROPIC_API_KEY is not set. Refusing to start.');
  process.exit(1);
}
const client = new Anthropic({ apiKey });

// ---- Cost-guardrail state (in-memory; resets on restart) ----
let monthlyTokens = 0;
const rateBuckets = new Map(); // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now >= b.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  b.count += 1;
  return b.count > RATE_LIMIT_PER_MIN;
}

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

// ---- Per-task prompt construction (kept server-side, not exposed) ----
function buildPrompt(task, payload = {}) {
  const p = payload || {};
  const guard =
    '당신은 대한민국 전자계약 앱의 도우미입니다. 반드시 한국어로 답하세요. ' +
    '당신은 변호사가 아니며 답변은 법률 자문이 아닙니다. ' +
    '답변 끝에 "※ 법률 자문이 아닙니다."를 덧붙이세요.';

  switch (task) {
    case 'explain_clause':
      return {
        system: guard + ' 계약 조항을 일반인이 이해할 수 있게 쉽게 풀어 설명하고, ' +
          '불리하거나 위험할 수 있는 문구를 "⚠"로 표시해 그 이유를 짚어 주세요.',
        messages: [{
          role: 'user',
          content: `[${p.templateName || '계약서'}]의 다음 조항을 쉽게 설명하고 리스크를 표시해 주세요:\n\n${p.clause || ''}`
        }]
      };
    case 'draft_contract':
      return {
        system: guard + ' 사용자의 조건 설명을 바탕으로 계약서 항목 값을 채웁니다. ' +
          '반드시 아래 JSON 스키마만 출력하세요(설명 문장 없이): ' +
          '{"values": {필드key: 값}, "note": "간단 안내", "disclaimer": "※ 법률 자문이 아닙니다."}. ' +
          '정보가 부족한 항목은 빈 문자열로 두세요. 날짜는 YYYY-MM-DD 형식으로 하세요.',
        messages: [{
          role: 'user',
          content:
            '필드 스키마: ' + JSON.stringify(p.fields || []) +
            '\n\n조건 설명: ' + (p.brief || '') +
            '\n\n위 스키마의 key만 사용해 values를 채워 JSON으로만 답하세요.'
        }]
      };
    case 'contract_qa':
      return {
        system: guard + ' 제공된 계약 정보 범위 안에서만 사실에 근거해 답하세요. ' +
          '정보가 없으면 없다고 말하세요. 추측하지 마세요.',
        messages: [{
          role: 'user',
          content:
            '계약 정보: ' + JSON.stringify({ contract: p.contract || {}, fields: p.fields || [] }) +
            '\n\n질문: ' + (p.question || '')
        }]
      };
    case 'risk_summary':
      return {
        system: guard + ' 계약서 조항 전체를 훑어 일반인이 특히 주의해야 할 지점을 ' +
          '3~5개의 짧은 항목으로 요약하세요. 각 항목은 한 줄로, 어떤 조항이 왜 주의가 ' +
          '필요한지 쉬운 말로 짚어 주세요. 겁주지 말고 담백하게 쓰고, 단정적 법률 판단은 ' +
          '피하세요. 이것은 이해를 돕는 요약일 뿐 법률 자문이 아닙니다.',
        messages: [{
          role: 'user',
          content:
            `[${p.templateName || '계약서'}] 조항 목록:\n\n` +
            (Array.isArray(p.clauses) ? p.clauses : []).map((c, i) => `(${i + 1}) ${c}`).join('\n\n') +
            '\n\n위 계약의 "계약 리스크 점검 요약"을 작성해 주세요.'
        }]
      };
    default:
      return null;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/api/ai') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  // Cost guardrails: per-IP rate limit + monthly token budget.
  // Over either limit -> 429 {fallback:true}; the browser mock takes over.
  if (rateLimited(clientIp(req)) || monthlyTokens >= MONTHLY_TOKEN_CAP) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ fallback: true }));
    return;
  }

  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    const prompt = buildPrompt(body.task, body.payload);
    if (!prompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown task' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Transfer-Encoding': 'chunked'
    });

    // Stable system prompt sent as a cache_control:ephemeral block so repeated
    // calls read from cache and cost less.
    const params = {
      model: MODEL,
      max_tokens: MAX_TOKENS[body.task] || 700,
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: prompt.messages
    };
    // Haiku 4.5 rejects thinking/effort; only send them for other models.
    if (!IS_HAIKU) {
      params.thinking = { type: 'adaptive' };
      params.output_config = { effort: AI_EFFORT };
    }

    const stream = client.messages.stream(params);
    stream.on('text', (delta) => res.write(delta));
    const finalMsg = await stream.finalMessage();

    // Accumulate token usage from the stream's final message for the budget.
    const u = finalMsg && finalMsg.usage;
    if (u) {
      monthlyTokens +=
        (u.input_tokens || 0) + (u.output_tokens || 0) +
        (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    res.end();
  } catch (err) {
    console.error('[proxy] error', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ai_proxy_error' }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`[proxy] listening on :${PORT}  (allowed origin: ${ALLOWED_ORIGIN}, model: ${MODEL}, ` +
    `haiku=${IS_HAIKU}, cap=${MONTHLY_TOKEN_CAP} tok, rate=${RATE_LIMIT_PER_MIN}/min)`);
});
