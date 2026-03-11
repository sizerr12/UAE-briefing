// api/summarize.js — Claude Haiku 한국어 요약
const https = require('https');

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
          if (!text) return reject(new Error('Claude empty response'));
          resolve(text);
        } catch(e) {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  // 깨진 문자 제거
  const title = (payload.title || '').replace(/\uFFFD/g, '').trim();
  const description = (payload.description || '').replace(/\uFFFD/g, '').trim();

  // 본문 있으면 본문 기반, 없으면 제목 기반
  const hasContent = description.length > 80;
  const prompt = hasContent
    ? `다음 UAE 영문 뉴스를 한국어로 자연스럽게 요약해주세요. 2~3문장으로, 핵심만 간결하게. 숫자/금액/고유명사는 영문 그대로. 요약문만 바로 쓰세요.

제목: ${title}
내용: ${description.slice(0, 2000)}`
    : `다음 UAE 뉴스 제목을 한국어 한 문장으로 설명해주세요. 숫자/금액/고유명사는 영문 그대로. 설명문만 바로 쓰세요.

제목: ${title}`;

  try {
    const raw = await callClaude(prompt, apiKey);
    const lines = raw.trim()
      .split('\n')
      .map(l => l.trim().replace(/^\d+\.\s*/, ''))
      .filter(l => l.length > 5);

    if (!lines.length) return res.status(500).json({ error: '요약 실패' });
    return res.status(200).json({ summary: lines });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
