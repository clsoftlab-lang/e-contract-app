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
// Run: ANTHROPIC_API_KEY=sk-... node index.mjs   (see README.md / .env.example)

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';

const PORT = Number(process.env.PORT || 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://clsoftlab-lang.github.io';
const MODEL = 'claude-opus-5';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('[proxy] ANTHROPIC_API_KEY is not set. Refusing to start.');
  process.exit(1);
}
const client = new Anthropic({ apiKey });

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

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system: prompt.system,
      messages: prompt.messages
    });

    stream.on('text', (delta) => res.write(delta));
    await stream.finalMessage();
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
  console.log(`[proxy] listening on :${PORT}  (allowed origin: ${ALLOWED_ORIGIN}, model: ${MODEL})`);
});
