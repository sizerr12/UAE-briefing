// api/summarize.js — 영문 기사 본문 fetch + Claude AI 한국어 3줄 요약
const https = require('https');
const http  = require('http');

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 4) return resolve({ status: 0, body: '' });
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 8000
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return resolve(fetchUrl(next, redirects + 1));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { if (body.length < 300000) body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    } catch(e) { resolve({ status: 0, body: '' }); }
  });
}

// HTML에서 본문 텍스트 추출 (간단한 heuristic)
function extractText(html) {
  // script/style 제거
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{3,}/g, '\n')
    .trim();

  // 본문 단락만 추출 (50자 이상 줄만)
  const lines = text.split('\n').filter(l => l.trim().length > 50);
  return lines.slice(0, 60).join('\n').slice(0, 4000);
}

async function callClaude(articleText, title, apiKey) {
  return new Promise((resolve, reject) => {
    const prompt = `다음 UAE 영문 뉴스 기사를 한국어로 3줄 요약해주세요.
각 줄은 핵심 사실만 간결하게 작성하세요. 숫자, 금액, 고유명사(회사명·인명)는 그대로 사용하세요.
반드시 아래 형식으로만 답하세요 (다른 말 없이):
1. (첫번째 핵심)
2. (두번째 핵심)
3. (세번째 핵심)

기사 제목: ${title}

기사 본문:
${articleText}`;

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 20000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // body 파싱
  let body = '';
  await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
  let payload;
  try { payload = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'invalid json' }); }

  const { url, title = '', description = '' } = payload;
  if (!url) return res.status(400).json({ error: 'url required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // 1) 기사 본문 fetch
  let articleText = '';
  try {
    const { body: html } = await fetchUrl(url);
    if (html) articleText = extractText(html);
  } catch(e) { /* 본문 fetch 실패 → fallback */ }

  // fallback: 본문 없으면 제목+설명
  const content = articleText.length > 100
    ? articleText
    : `Title: ${title}\n\n${description}`;

  // 2) Claude 요약
  try {
    const data = await callClaude(content.slice(0, 4000), title, apiKey);
    const text = data.content?.[0]?.text || '';
    if (!text) throw new Error('empty response');

    // 파싱
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => /^[1-3]\./.test(l))
      .map(l => l.replace(/^[1-3]\.\s*/, ''));

    return res.status(200).json({ summary: lines, raw: text });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
