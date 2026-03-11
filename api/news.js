// api/news.js — Vercel Serverless Function
// 역할: 1) 네이버 검색 API로 뉴스 fetch  2) 각 기사 URL에서 OG 이미지 scrape
// 환경변수: NAVER_CLIENT_ID, NAVER_CLIENT_SECRET  (Vercel 대시보드에서 설정)

const https = require('https');
const http  = require('http');

// ── 유틸: URL fetch (redirect 최대 3회 follow) ──────────────────────────────
function fetchUrl(url, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return resolve({ status: 0, body: '' });
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; UAEBriefingBot/1.0)',
        ...options.headers
      },
      timeout: 4000
    }, res => {
      // follow redirects
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(fetchUrl(next, options, redirects + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { if (body.length < 80000) body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
  });
}

// ── OG 이미지 추출 ──────────────────────────────────────────────────────────
function extractOgImage(html) {
  const patterns = [
    /og:image[^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*og:image/i,
    /twitter:image[^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*twitter:image/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1] && m[1].startsWith('http')) return m[1];
  }
  return null;
}

// ── 중복 제거: 제목 유사도 ───────────────────────────────────────────────────
function normalize(str) {
  return str.replace(/<[^>]+>/g, '').replace(/[^\w가-힣]/g, '').toLowerCase();
}
function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  const shorter = na.length < nb.length ? na : nb;
  const longer  = na.length < nb.length ? nb : na;
  if (longer.length === 0) return 1;
  let matches = 0;
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    if (longer.slice(i, i + shorter.length) === shorter) { matches = shorter.length; break; }
  }
  // 간단한 공통 부분 문자열 비율
  const words_a = new Set(na.match(/.{2,}/g) || []);
  const words_b = nb.match(/.{2,}/g) || [];
  const common  = words_b.filter(w => words_a.has(w)).length;
  return common / Math.max(words_a.size, words_b.length, 1);
}

function groupByTitle(items) {
  const groups = [];
  const used   = new Set();
  items.forEach((item, i) => {
    if (used.has(i)) return;
    const group = [item];
    used.add(i);
    items.forEach((other, j) => {
      if (used.has(j)) return;
      if (similarity(item.title, other.title) > 0.45) {
        group.push(other);
        used.add(j);
      }
    });
    groups.push(group);
  });
  return groups;
}

// ── 대표 기사 선정 ──────────────────────────────────────────────────────────
const TIER1 = ['조선일보','중앙일보','동아일보','한겨레','경향신문','매일경제','한국경제'];
function pickLead(group) {
  const exclusive = group.find(n => n.title.includes('[단독]') || n.title.includes('[특종]'));
  if (exclusive) return exclusive;
  const t1 = group.find(n => TIER1.includes(n.originallink?.match(/([a-z]+)\./)?.[1]));
  return t1 || group[0];
}

// ── 독창성 판단 ─────────────────────────────────────────────────────────────
function originality(group, lead) {
  if (lead.title.includes('[단독]') || lead.title.includes('[특종]')) return 'exclusive';
  if (group.length === 1) return 'original';
  if (group.length >= 4) return 'pr';
  return 'pr';
}

// ── 메인 핸들러 ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { keywords = '두바이,아부다비,UAE', filters = '' } = req.query;
  const kwList     = keywords.split(',').map(s => s.trim()).filter(Boolean);
  const filterList = filters.split(',').map(s => s.trim()).filter(Boolean);

  const clientId     = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'NAVER API keys not configured' });
  }

  // 1) 네이버 뉴스 검색
  const allItems = [];
  const seenLinks = new Set();

  await Promise.all(kwList.map(async kw => {
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(kw)}&display=30&sort=date`;
    const { body } = await fetchUrl(url, {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret
      }
    });
    try {
      const data = JSON.parse(body);
      (data.items || []).forEach(item => {
        if (seenLinks.has(item.link)) return;
        seenLinks.add(item.link);
        allItems.push({ ...item, _keyword: kw });
      });
    } catch(e) { /* ignore parse errors */ }
  }));

  // 2) 필터링
  const filtered = [], visible = [];
  allItems.forEach(item => {
    const text = item.title + item.description;
    const matchFilter = filterList.some(f => text.includes(f));
    if (matchFilter) filtered.push({ ...item, _filterReason: filterList.find(f=>text.includes(f)) });
    else visible.push(item);
  });

  // 3) 중복 그룹핑
  const groups = groupByTitle(visible);

  // 4) OG 이미지 병렬 fetch (최대 20개 그룹 × 대표 기사만)
  const leadUrls = groups.map(g => pickLead(g).originallink || pickLead(g).link).slice(0, 20);
  const ogResults = await Promise.all(
    leadUrls.map(async url => {
      try {
        const { body } = await fetchUrl(url);
        return extractOgImage(body);
      } catch { return null; }
    })
  );

  // 5) 결과 조립
  const result = groups.map((group, i) => {
    const lead = pickLead(group);
    const orig = originality(group, lead);
    const isNaverInNews = (url) => url && (url.includes('n.news.naver.com') || url.includes('news.naver.com/'));
    const naverLink = isNaverInNews(lead.link) ? lead.link : null;

    // 안정적인 ID: 제목 앞 40자 기반 해시 (새로고침해도 같은 기사 = 같은 id)
    const rawId = (lead.title || '').replace(/[^a-zA-Z0-9가-힣]/g, '').slice(0, 40);
    const stableId = 'g_' + rawId.split('').reduce((h,c)=>(((h<<5)-h)+c.charCodeAt(0))|0, 0).toString(36).replace('-','n');

    return {
      id: stableId,
      lead: {
        title: lead.title.replace(/<[^>]+>/g, ''),
        description: lead.description.replace(/<[^>]+>/g, ''),
        source: lead.originallink ? new URL(lead.originallink).hostname.replace('www.','') : '',
        link: lead.link || '',               // 네이버 인뉴스 (있을 수도 없을 수도)
        originallink: lead.originallink || '',  // 언론사 직접 링크
        naverLink: naverLink,
        pubDate: lead.pubDate,
        keyword: lead._keyword,
        originality: orig,
        thumbnail: ogResults[i] || null,
      },
      others: group.filter(n => n !== lead).map(n => ({
        title: n.title.replace(/<[^>]+>/g, ''),
        source: n.originallink ? new URL(n.originallink).hostname.replace('www.','') : '',
        link: n.link || '',
        originallink: n.originallink || '',
        naverLink: isNaverInNews(n.link) ? n.link : null,
        pubDate: n.pubDate,
      }))
    };
  });

  return res.status(200).json({
    groups: result,
    filteredCount: filtered.length,
    filteredReasons: [...new Set(filtered.map(f=>f._filterReason))],
    total: allItems.length,
    fetchedAt: new Date().toISOString()
  });
};
