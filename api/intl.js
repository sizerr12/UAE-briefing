// api/intl.js — Google News RSS로 UAE 영문 뉴스 수집
const https = require('https');
const http  = require('http');

// Google News RSS 쿼리 목록 (UAE 관련 영문 검색어)
const GN_QUERIES = [
  'UAE news',
  'Dubai news',
  'Abu Dhabi news',
  'ADNOC',
  'Emirates airline',
];

// Google News RSS URL 생성
function gnUrl(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 4) return resolve({ status: 0, body: '' });
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
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
        res.on('data', chunk => { if (body.length < 400000) body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    } catch(e) { resolve({ status: 0, body: '' }); }
  });
}

function stripTags(str) {
  return (str||'')
    .replace(/<[^>]+>/g,'')
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
    .trim();
}

function extractVal(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i'));
  return m ? stripTags(m[1]) : '';
}

// Google News RSS 파싱
function parseGoogleNewsRSS(xml, keyword) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];

  itemBlocks.forEach(block => {
    const title   = extractVal(block, 'title');
    // Google News link는 <link> 태그가 아닌 CDATA 방식
    const linkM   = block.match(/<link>([^<]+)<\/link>/) || block.match(/<link><!\[CDATA\[([^\]]+)\]\]><\/link>/);
    const link    = linkM ? linkM[1].trim() : '';
    const desc    = extractVal(block, 'description');
    const pubDate = extractVal(block, 'pubDate');
    // 출처 파싱
    const srcM    = block.match(/<source[^>]*>([^<]+)<\/source>/i) || block.match(/<source[^>]*url="([^"]+)"/i);
    const sourceDisplay = srcM ? srcM[1] : '';
    const domainM = block.match(/<source[^>]*url="([^"]+)"/i);
    const domain  = domainM ? (new URL(domainM[1]).hostname.replace(/^www\./,'')) : 'news.google.com';

    if (!title || !link) return;

    items.push({
      title, link, description: desc, pubDate,
      source: domain, sourceDisplay: sourceDisplay || domain,
      keyword,
    });
  });
  return items;
}

function timeAgo(pubDate) {
  if (!pubDate) return '';
  const d = new Date(pubDate);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

function normalize(str) { return str.replace(/[^\w]/g,'').toLowerCase(); }
function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  const wa = new Set((na.match(/\w{3,}/g)||[]));
  const wb = (nb.match(/\w{3,}/g)||[]);
  if (!wa.size) return 0;
  const common = wb.filter(w => wa.has(w)).length;
  return common / Math.max(wa.size, wb.length, 1);
}

function groupByTitle(items) {
  const groups = [], used = new Set();
  items.forEach((item, i) => {
    if (used.has(i)) return;
    const group = [item]; used.add(i);
    items.forEach((other, j) => {
      if (used.has(j)) return;
      if (similarity(item.title, other.title) > 0.45) { group.push(other); used.add(j); }
    });
    groups.push(group);
  });
  return groups;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 병렬 fetch
  const results = await Promise.allSettled(
    GN_QUERIES.map(async q => {
      const url = gnUrl(q);
      const { body } = await fetchUrl(url);
      if (!body || body.length < 100) return [];
      return parseGoogleNewsRSS(body, q);
    })
  );

  // 전체 합치기
  const allItems = [];
  const seen = new Set();
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    r.value.forEach(item => {
      const key = normalize(item.title).slice(0, 40);
      if (seen.has(key)) return;
      seen.add(key);
      allItems.push(item);
    });
  });

  // 최신순 정렬
  allItems.sort((a, b) => new Date(b.pubDate||0) - new Date(a.pubDate||0));

  // 중복 그룹핑
  const groups = groupByTitle(allItems);

  const result = groups.slice(0, 60).map((group, i) => {
    const lead = group[0];
    return {
      id: 'intl_' + i,
      lead: {
        title:        lead.title,
        description:  lead.description || '',
        source:       lead.source,
        sourceDisplay: lead.sourceDisplay,
        link:         lead.link,
        originallink: lead.link,
        naverLink:    null,
        pubDate:      lead.pubDate,
        time:         timeAgo(lead.pubDate),
        keyword:      'Global',
        originality:  group.length > 1 ? 'original' : 'pr',
        thumbnail:    null,
        lang:         'en',
      },
      others: group.slice(1).map(n => ({
        title:        n.title,
        source:       n.source,
        sourceDisplay: n.sourceDisplay,
        link:         n.link,
        originallink: n.link,
        naverLink:    null,
        pubDate:      n.pubDate,
        time:         timeAgo(n.pubDate),
      }))
    };
  });

  res.status(200).json({
    groups:         result,
    filteredCount:  0,
    filteredReasons:[],
    total:          allItems.length,
    fetchedAt:      new Date().toISOString()
  });
};
