// api/summarize.js — Claude Haiku 한국어 3줄 요약 (크롤링 + 제목 폴백)
const https = require('https');
const http = require('http');

function fetchArticleText(url) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
          'Accept': 'text/html'
        },
        timeout: 8000
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchArticleText(res.headers.location).then(resolve).catch(() => resolve(''));
        }
        let html = '';
        res.on('data', c => { if (html.length < 200000) html += c; });
        res.on('end', () => {
          html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
          html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
          const articleMatch = html.match(/<article[\s\S]*?<\/article>/i) ||
                               html.match(/<main[\s\S]*?<\/main>/i);
          const target = articleMatch ? articleMatch[0] : html;
          const text = target.replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/[\uFFFD]/g, '')  // 깨진 문자 제거
            .replace(/\s+/g, ' ')
            .trim().slice(0, 3000);
          resolve(text);
        });
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

function callClaude(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(`Claude: ${j.error.message}`));
          const text = j.content?.[0]?.text || '';
          if (!text) return reject(new Error(`Claude empty. Raw: ${data.slice(0,200)}`));
          resolve(text);
        } catch(e) { reject(new Error(`Parse error: ${data.slice(0,200)}`)); }
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

  let body = '';
  await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });

  let payload;
  try { payload = JSON.parse(body); }
  catch(e) { return res.status(400).json({ error: 'invalid json' }); }

  const { title = '', description = '', url = '' } = payload;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // description 짧으면 크롤링 시도
  let content = description;
  if (content.length < 200 && url) {
    const crawled = await fetchArticleText(url);
    if (crawled.length > 200) content = crawled;
  }

  // 깨진 문자 제거
  content = content.replace(/[\uFFFD\uFFFE\uFFFF]/g, '').replace(/\s+/g, ' ').trim();
  title = title.replace(/[\uFFFD\uFFFE\uFFFF]/g, '').trim();

  // 본문 유무에 따라 프롬프트 분기
  const hasContent = content.length > 100;
  const prompt = hasContent
    ? `다음 UAE 영문 뉴스 기사를 한국어로 요약해주세요.
핵심 내용을 자연스럽게 2~4문장으로 설명해주세요. 숫자/금액/고유명사는 영문 그대로 쓰세요.
다른 말 없이 요약문만 바로 써주세요.

제목: ${title}
내용: ${content}`
    : `다음 UAE 뉴스 기사 제목을 한국어로 한 문장으로 설명해주세요.
제목에서 알 수 있는 핵심만, 숫자/금액/고유명사는 영문 그대로 쓰세요.
다른 말 없이 설명문만 바로 써주세요.

제목: ${title}`;

  try {
    const raw = await callClaude(prompt, apiKey);
    // 본문 있으면 문단, 없으면 한 문장 — 그대로 표시
    const lines = raw.trim().split('\n')
      .map(l => l.trim().replace(/^\d+\.\s*/, ''))  // "1. " 제거
      .filter(l => l.length > 5);

    if (!lines.length) {
      const fallback = raw.split('\n').map(l=>l.trim()).filter(l=>l.length>10).slice(0,3);
      if (fallback.length) return res.status(200).json({ summary: fallback, raw });
      return res.status(500).json({ error: `파싱 실패: ${raw.slice(0,100)}` });
    }
    return res.status(200).json({ summary: lines, raw });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
