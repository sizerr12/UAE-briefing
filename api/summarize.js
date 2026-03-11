// api/summarize.js — Gemini Flash로 영문 기사 한국어 3줄 요약 (무료)
const https = require('https');

function callGemini(text, title, apiKey) {
  return new Promise((resolve, reject) => {
    const prompt = `다음 UAE 영문 뉴스 기사를 한국어로 3줄 요약해주세요.
핵심 사실만 간결하게, 숫자/금액/고유명사는 그대로 쓰세요.
반드시 아래 형식으로만 답하세요 (설명 없이):
1. (첫번째 핵심)
2. (두번째 핵심)
3. (세번째 핵심)

제목: ${title}
본문: ${text.slice(0, 3000)}`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.2 }
    });

    const path = `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve(text);
        } catch(e) { reject(e); }
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
  try { payload = JSON.parse(body); } catch(e) { return res.status(400).json({ error: 'invalid json' }); }

  const { title = '', description = '' } = payload;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  try {
    const content = `${title}\n\n${description}`;
    const raw = await callGemini(content, title, apiKey);
    if (!raw) throw new Error('empty');

    const lines = raw.split('\n')
      .map(l => l.trim())
      .filter(l => /^[1-3]\./.test(l))
      .map(l => l.replace(/^[1-3]\.\s*/, ''));

    return res.status(200).json({ summary: lines, raw });
  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
};
