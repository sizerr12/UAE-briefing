// api/summarize.js — Claude Haiku 한국어 3줄 요약
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
          if (!text) return reject(new Error(`Claude empty. Raw: ${data.slice(0,200)}`));
          resolve(text);
        } catch(e) {
          reject(new Error(`Parse error: ${data.slice(0,200)}`));
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

  const { title = '', description = '' } = payload;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

  const prompt = `다음 UAE 영문 뉴스 기사를 한국어로 3줄 요약해주세요.
핵심 사실만 간결하게, 숫자/금액/고유명사는 영문 그대로 쓰세요.
반드시 아래 형식으로만 답하세요 (다른 말 없이):
1. 첫번째 핵심
2. 두번째 핵심
3. 세번째 핵심

제목: ${title}
내용: ${description}`;

  try {
    const raw = await callClaude(prompt, apiKey);

    const lines = raw.split('\n')
      .map(l => l.trim())
      .filter(l => /^[1-3][\.\)]/.test(l))
      .map(l => l.replace(/^[1-3][\.\)]\s*/, ''));

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

function callOpenAI(prompt, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 400,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }]
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 20000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j.error) return reject(new Error(`OpenAI: ${j.error.message}`));
          const text = j.choices?.[0]?.message?.content || '';
          if (!text) return reject(new Error(`OpenAI empty. Raw: ${data.slice(0,200)}`));
          resolve(text);
        } catch(e) {
          reject(new Error(`Parse error: ${data.slice(0,200)}`));
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

  const { title = '', description = '' } = payload;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

  const prompt = `다음 UAE 영문 뉴스 기사를 한국어로 3줄 요약해주세요.
핵심 사실만 간결하게, 숫자/금액/고유명사는 영문 그대로 쓰세요.
반드시 아래 형식으로만 답하세요 (다른 말 없이):
1. 첫번째 핵심
2. 두번째 핵심
3. 세번째 핵심

제목: ${title}
내용: ${description}`;

  try {
    const raw = await callOpenAI(prompt, apiKey);

    const lines = raw.split('\n')
      .map(l => l.trim())
      .filter(l => /^[1-3][\.\)]/.test(l))
      .map(l => l.replace(/^[1-3][\.\)]\s*/, ''));

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
