// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 CLSOFTLAB (씨엘소프트랩), Dr. Lee Il-guk (이일국)
//
// AI-KIT configuration.
//
// AI_ENDPOINT controls where AI requests go:
//   - "" (empty, the default)  -> the built-in local MockProvider runs entirely
//                                 in the browser. No network, no key, no cost.
//                                 This is what powers the live GitHub Pages demo.
//   - "https://.../api/ai"     -> real AI. Deploy the reference proxy in server/
//                                 (which holds ANTHROPIC_API_KEY server-side) and
//                                 point this at its /api/ai route.
//
// SECURITY: There is NEVER an API key in this file, in the browser, or in the
// repository. The browser only ever talks to YOUR proxy origin; the proxy is
// the only place the Anthropic key lives. Keep this value a plain URL.
export const AI_ENDPOINT = "";
