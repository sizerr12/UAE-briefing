// api/intl.js — 공신력 있는 UAE 영문 매체만 Google News RSS로 수집
const https = require('https');

// 공신력 있는 UAE/중동 영문 매체만 site: 검색
const SOURCES = [
  { query: 'site:thenationalnews.com UAE OR Dubai OR "Abu Dhabi"', label: 'The National' },
  { query: 'site:gulfnews.com UAE OR Dubai OR "Abu Dhabi"',        label: 'Gulf News' },
  { query: 'site:khaleejtimes.com',                                label: 'Khaleej Times' },
  { query: 'site:arabianbusiness.com UAE OR Dubai',               label: 'Arabian Business' },
  { query: 'site:wam.ae',                                         label: 'WAM' },
  { query: 'site:reuters.com UAE OR Dubai OR "Abu Dhabi"',        label: 'Reuters' },
  { query: 'site:bloomberg.com UAE OR Dubai OR ADNOC',            label: 'Bloomberg' },
];

function gnUrl(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=AE&ceid=AE:en`;
}

function fetchUrl(url, redirects = 0) {
  return new Promise(resolve => {
    if (redirects > 3) return resolve('');
    try {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'application/rss+xml,application/xml,text/xml,*/*',
        },
        timeout: 9000
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          return resolve(fetchUrl(next, redirects + 1));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', c => { if (body.length < 500000) body += c; });
        res.on('end', () => resolve(body));
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
    } catch(e) { resolve(''); }
  });
}

function strip(s) {
  return (s||'').replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim();
}

function parseRSS(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  blocks.forEach(b => {
    const title   = strip(b.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || '');
    const linkM   = b.match(/<link>([^<]+)<\/link>/i) || b.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/i);
    const link    = (linkM?.[1] || '').trim();
    const desc    = strip(b.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] || '');
    const pubDate = strip(b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '');
    const srcName = strip(b.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || '');
    const srcUrl  = b.match(/<source[^>]*url="([^"]+)"/i)?.[1] || '';
    let domain = 'news.google.com';
    try { domain = new URL(srcUrl).hostname.replace(/^www\./,''); } catch(e) {}

    if (!title || !link) return;
    // 제목에 매체명 suffix 제거 (- Gulf News, - Reuters 등)
    const cleanTitle = title.replace(/\s*[-–|]\s*(The National|Gulf News|Khaleej Times|Arabian Business|WAM|Reuters|Bloomberg)\s*$/i, '').trim();
    items.push({ title: cleanTitle, link, description: desc, pubDate, source: domain, sourceDisplay: srcName || domain });
  });
  return items;
}

function timeAgo(pubDate) {
  if (!pubDate) return '';
  const d = new Date(pubDate);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff/60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function norm(s) { return s.replace(/\W/g,'').toLowerCase(); }
function sim(a, b) {
  const wa = new Set((norm(a).match(/\w{3,}/g)||[]));
  const wb = norm(b).match(/\w{3,}/g)||[];
  if (!wa.size) return 0;
  return wb.filter(w=>wa.has(w)).length / Math.max(wa.size, wb.length, 1);
}
function groupDupes(items) {
  const groups=[], used=new Set();
  items.forEach((item,i)=>{
    if(used.has(i)) return;
    const g=[item]; used.add(i);
    items.forEach((o,j)=>{ if(!used.has(j)&&sim(item.title,o.title)>0.45){g.push(o);used.add(j);} });
    groups.push(g);
  });
  return groups;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','s-maxage=300');
  if(req.method==='OPTIONS') return res.status(200).end();

  const results = await Promise.allSettled(SOURCES.map(s => fetchUrl(gnUrl(s.query))));

  const seen = new Set();
  const allItems = [];
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled' || !r.value) return;
    parseRSS(r.value).forEach(item => {
      const key = norm(item.title).slice(0,50);
      if (seen.has(key)) return;
      seen.add(key);
      allItems.push(item);
    });
  });

  // 최신순 정렬
  allItems.sort((a,b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));

  // 단독/심층 판단
  // - exclusive: Reuters/Bloomberg 단독 (다른 매체 중복 없음)
  // - original: The National / Gulf News / WAM 자체 기사, 또는 여러 매체가 보도
  // - pr: 단일 언론사만 보도한 경미한 소식
  const TIER1 = new Set(['reuters.com','bloomberg.com','wam.ae']);
  const TIER2 = new Set(['thenationalnews.com','gulfnews.com','khaleejtimes.com','arabianbusiness.com']);
  function intlOriginality(group) {
    const lead = group[0];
    if (group.length >= 3) return 'exclusive';                     // 3개 이상 보도 = 중요 단독급
    if (TIER1.has(lead.source)) return group.length === 1 ? 'exclusive' : 'original';
    if (TIER2.has(lead.source) && group.length >= 2) return 'original';
    if (group.length >= 2) return 'original';
    return 'pr';
  }

  const groups = groupDupes(allItems).slice(0,60).map((g,i) => {
    const lead = g[0];
    const orig = intlOriginality(g);
    return {
      id: 'intl_' + i,
      lead: {
        title:        lead.title,
        description:  lead.description,
        source:       lead.source,
        sourceDisplay:lead.sourceDisplay,
        link:         lead.link,
        originallink: lead.link,
        naverLink:    null,
        pubDate:      lead.pubDate,
        time:         timeAgo(lead.pubDate),
        keyword:      'Global',
        originality:  orig,
        thumbnail:    null,
        lang:         'en',
      },
      others: g.slice(1).map(n=>({
        title:n.title, source:n.source, sourceDisplay:n.sourceDisplay,
        link:n.link, originallink:n.link, naverLink:null,
        pubDate:n.pubDate, time:timeAgo(n.pubDate)
      }))
    };
  });

  res.status(200).json({
    groups,
    filteredCount: 0,
    filteredReasons: [],
    total: allItems.length,
    fetchedAt: new Date().toISOString()
  });
};
