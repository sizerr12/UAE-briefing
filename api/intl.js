// api/intl.js — 해외 UAE 영문 뉴스 RSS 수집
const https = require('https');
const http  = require('http');

// RSS 피드 목록
const RSS_FEEDS = [
  { source: 'Gulf News',       domain: 'gulfnews.com',      url: 'https://gulfnews.com/rss' },
  { source: 'The National',    domain: 'thenationalnews.com', url: 'https://www.thenationalnews.com/rss.xml' },
  { source: 'Khaleej Times',   domain: 'khaleejtimes.com',  url: 'https://www.khaleejtimes.com/rss' },
  { source: 'Arabian Business',domain: 'arabianbusiness.com',url: 'https://www.arabianbusiness.com/rss' },
  { source: 'WAM',             domain: 'wam.ae',            url: 'https://www.wam.ae/en/rss.xml' },
];

// UAE 관련 키워드 (영문)
const UAE_KEYWORDS = ['UAE','Dubai','Abu Dhabi','Emirates','ADNOC','Etihad','Emirates airline','EXPO','Vision 2031'];

function fetchUrl(url, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 3) return resolve({ status: 0, body: '' });
    try {
      const lib = url.startsWith('https') ? https : http;
      const req = lib.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; UAEBriefingBot/1.0)', 'Accept': 'application/rss+xml, application/xml, text/xml' },
        timeout: 6000
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http') ? res.headers.location
            : new URL(res.headers.location, url).href;
          return resolve(fetchUrl(next, redirects + 1));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { if (body.length < 200000) body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', () => resolve({ status: 0, body: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    } catch(e) { resolve({ status: 0, body: '' }); }
  });
}

function stripTags(str) { return (str||'').replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim(); }

function extractVal(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))
    || xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? stripTags(m[1]) : '';
}

function parseRSS(xml, feed) {
  const items = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  itemBlocks.forEach(block => {
    const title = extractVal(block, 'title');
    const link  = extractVal(block, 'link') || (block.match(/<link>([^<]+)<\/link>/)||[])[1] || '';
    const desc  = extractVal(block, 'description');
    const pubDate = extractVal(block, 'pubDate');
    const img   = (block.match(/url=["']([^"']+\.(jpg|jpeg|png|webp))[^"']*/i)||[])[1]
                || (block.match(/<media:content[^>]*url=["']([^"']+)["']/i)||[])[1]
                || (block.match(/<enclosure[^>]*url=["']([^"']+)["']/i)||[])[1]
                || null;
    if (!title || !link) return;
    // UAE 관련성 필터
    const text = (title + ' ' + desc).toLowerCase();
    const relevant = UAE_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
    if (!relevant) return;
    items.push({ title, link: link.trim(), description: desc, pubDate, thumbnail: img, source: feed.source, domain: feed.domain });
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

function normalize(str) { return str.replace(/[^\w]/g,'').toLowerCase(); }
function similarity(a, b) {
  const na=normalize(a), nb=normalize(b);
  const words_a=new Set((na.match(/.{3,}/g)||[]));
  const words_b=(nb.match(/.{3,}/g)||[]);
  const common=words_b.filter(w=>words_a.has(w)).length;
  return common/Math.max(words_a.size,words_b.length,1);
}
function groupByTitle(items) {
  const groups=[], used=new Set();
  items.forEach((item,i)=>{
    if(used.has(i)) return;
    const group=[item]; used.add(i);
    items.forEach((other,j)=>{
      if(used.has(j)) return;
      if(similarity(item.title,other.title)>0.4){ group.push(other); used.add(j); }
    });
    groups.push(group);
  });
  return groups;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5분 캐시
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { filters = '' } = req.query;
  const filterList = filters.split(',').map(s=>s.trim()).filter(Boolean);

  // RSS 병렬 fetch
  const results = await Promise.allSettled(RSS_FEEDS.map(async feed => {
    const { body } = await fetchUrl(feed.url);
    if (!body) return [];
    return parseRSS(body, feed);
  }));

  let allItems = [];
  results.forEach(r => { if(r.status==='fulfilled') allItems.push(...r.value); });

  // 필터링
  const filtered=[], visible=[];
  allItems.forEach(item => {
    const text = item.title+' '+item.description;
    const hit = filterList.find(f=>text.toLowerCase().includes(f.toLowerCase()));
    if(hit) filtered.push(item);
    else visible.push(item);
  });

  // 중복 그룹핑
  const groups = groupByTitle(visible);

  // 결과 조립
  const grouped = groups.map((group, i) => {
    const lead = group[0];
    return {
      id: 'intl_'+i,
      lead: {
        title: lead.title,
        description: lead.description,
        source: lead.domain,
        sourceDisplay: lead.source,
        link: lead.link,
        originallink: lead.link,
        naverLink: null,
        pubDate: lead.pubDate,
        time: timeAgo(lead.pubDate),
        keyword: 'Global',
        originality: group.length===1 ? 'original' : 'pr',
        thumbnail: lead.thumbnail || null,
        lang: 'en',
      },
      others: group.slice(1).map(n=>({
        title: n.title, source: n.domain, sourceDisplay: n.source,
        link: n.link, originallink: n.link, naverLink: null, pubDate: n.pubDate,
        time: timeAgo(n.pubDate),
      }))
    };
  });

  // 최신순 정렬
  grouped.sort((a,b)=>{
    const da=new Date(a.lead.pubDate||0), db=new Date(b.lead.pubDate||0);
    return db-da;
  });

  res.status(200).json({
    groups: grouped.slice(0,60),
    filteredCount: filtered.length,
    filteredReasons: [...new Set(filtered.map(f=>f.title.slice(0,20)))].slice(0,3),
    total: allItems.length,
    fetchedAt: new Date().toISOString()
  });
};
