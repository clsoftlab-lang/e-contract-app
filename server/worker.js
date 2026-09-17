// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// CLOUDFLARE WORKERS AI PROXY (무인 variant) — free tier, no server to babysit.
//
// Same contract as server/index.mjs: the browser POSTs { task, payload } to
// /api/ai and gets back the assistant text. The Anthropic key lives ONLY in the
// Worker secret ANTHROPIC_API_KEY (set with `wrangler secret put`), never in the
// browser or the repo. See server/README.md for one-command deploy steps.
//
// Cost rules mirror the Node proxy:
//   * MODEL defaults to cost-first claude-haiku-4-5 (raise env AI_MODEL to
//     claude-sonnet-5 / claude-opus-5 for higher quality).
//   * Stable per-task system prompt sent as a cache_control:ephemeral block.
//   * Modest per-task max_tokens.
//   * Haiku 4.5 gets NO thinking / effort (it 400s otherwise).
//   * Best-effort per-IP rate limit; over limit -> 429 {fallback:true} so the
//     browser mock takes over and the app never breaks.

const MODEL_DEFAULT = 'claude-haiku-4-5';
const RATE_LIMIT_PER_MIN = 20;

const MAX_TOKENS = {
  explain_clause: 700,
  draft_contract: 1000,
  contract_qa: 700,
  risk_summary: 700
};

// Best-effort in-memory rate limit (per warm isolate).
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

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json' }
  });
}

export default {
  async fetch(request, env) {
    const origin = (env && env.ALLOWED_ORIGIN) || 'https://clsoftlab-lang.github.io';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/api/ai') {
      return json({ error: 'not found' }, 404, origin);
    }

    // Best-effort rate limit -> mock fallback signal.
    const ip = request.headers.get('cf-connecting-ip') ||
      (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    if (rateLimited(ip)) return json({ fallback: true }, 429, origin);

    let body;
    try { body = await request.json(); } catch { body = {}; }
    const prompt = buildPrompt(body.task, body.payload);
    if (!prompt) return json({ error: 'unknown task' }, 400, origin);

    const apiKey = env && env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ fallback: true }, 429, origin); // no key -> app falls back to mock

    const MODEL = (env && env.AI_MODEL) || MODEL_DEFAULT;
    const isHaiku = MODEL.startsWith('claude-haiku');

    const payload = {
      model: MODEL,
      max_tokens: MAX_TOKENS[body.task] || 700,
      system: [{ type: 'text', text: prompt.system, cache_control: { type: 'ephemeral' } }],
      messages: prompt.messages
    };
    if (!isHaiku) {
      payload.thinking = { type: 'adaptive' };
      payload.output_config = { effort: (env && env.AI_EFFORT) || 'low' };
    }

    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch {
      return json({ fallback: true }, 429, origin);
    }
    if (!r.ok) return json({ fallback: true }, 429, origin);

    const data = await r.json();
    const text = Array.isArray(data.content)
      ? data.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      : '';

    return new Response(text, {
      status: 200,
      headers: { ...corsHeaders(origin), 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
};
