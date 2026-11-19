// 도시별 추천 관광지 미리 만들기 → spots.json (앱이 장소 추가 화면에서 씀)
// 출처: 위키데이터(CC0, 무료). 도시 중심 반경 안의 관광지를 위키백과 언어 수(인기도) 순으로.
// 실행: node tools/build-spots.mjs   (도시 목록은 index.html의 COUNTRIES에서 읽음)
import { readFileSync, writeFileSync } from 'node:fs';

const UA = { 'User-Agent': 'wetrip-spots-builder/1.0 (travel itinerary app)' };
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rows = html.match(/const COUNTRIES = `([\s\S]*?)`/)[1].split('\n').map(l => l.split(','));
const SKIP = new Set(['한국', '국내', 'USA', '미국', 'LA', 'UK', '북마리아나', '터키', '남아공', 'UAE', '베니스', '비엔나', '홋카이도']);
// 위키백과 제목이 다른 곳
const TITLE = { 제주: '제주시', 후쿠오카: '후쿠오카시', 호치민: '호찌민시', 시즈오카: '시즈오카시', 남해: '남해군', 양양: '양양군', 통영: '통영시', 무이네: '판티엣', 강릉: '강릉시', 여수: '여수시', 속초: '속초시', 전주: '전주시', 나라: '나라시', 오키나와: '오키나와섬', 하와이: '오아후섬', 하롱베이: '하롱만', 발리: '발리섬', 괌: '괌', 사이판: '사이판섬',
  워싱턴: '워싱턴 D.C.', 백두산: '백두산', 융프라우: '융프라우', 돌로미티: '돌로미티', 아말피: '아말피', 몽생미셸: '몽생미셸', 팔라완: '팔라완섬',
  보홀: '보홀섬', 세부: '세부시', 지우펀: '주펀', 연길: '옌지시', 장가계: '장자제시', 피지: '비티레부섬', 몰디브: '말레', 홍콩: '홍콩', 싱가포르: '싱가포르', 마카오: '마카오',
  알래스카: '앵커리지', 카파도키아: '괴레메', 밴프: '밴프 (앨버타주)', 퀘벡: '퀘벡시', 코사무이: '사무이섬', 끄라비: '끄라비주', 푸꾸옥: '푸꾸옥섬', 롬복: '롬복섬', 랑카위: '랑카위' };
const WIDE = new Set(['제주', '오키나와', '하와이', '하롱베이', '발리', '괌', '사이판', '보라카이', '팔라완', '푸꾸옥', '코사무이', '푸켓', '끄라비', '아말피', '돌로미티',
  '융프라우', '산토리니', '롬복', '랑카위', '보홀', '장가계', '케언스', '퀸스타운', '골드코스트', '카파도키아', '밴프', '피지', '몰디브', '인터라켄', '백두산', '알래스카', '할슈타트', '세부', '코타키나발루']);

const cities = [...new Set(rows.flatMap(([, , , city, alias = '']) => [city, ...alias.split(' ')]).filter(c => c && /[가-힣]/.test(c) && !SKIP.has(c)))];

// 관광객이 가는 종류만 (P31 직접 값)
const TYPES = 'Q570116 Q33506 Q207694 Q44539 Q5393308 Q845945 Q16970 Q2977 Q32815 Q22698 Q1107656 Q23413 Q16560 Q12518 Q1440300 Q4989906 Q174782 Q12280 Q330284 Q43501 Q2281788 Q194195 Q40080 Q8502 Q23397 Q34038 Q839954 Q11315 Q57821 Q15243209 Q35509 Q46169 Q153562 Q179700 Q1081138 Q177380 Q2065736 Q15661340 Q1030034 Q842402 Q697295 Q160742 Q1370598 Q2319498'.split(' ');

async function qid(titles) {
  const u = 'https://ko.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=' + encodeURIComponent(titles.join('|'));
  let j;
  for (let i = 0; ; i++) { // 너무 자주 요청하면 위키백과가 거절함 → 기다렸다 다시
    const t = await (await fetch(u, { headers: UA })).text();
    try { j = JSON.parse(t); break; } catch { if (i > 4) throw new Error('wikipedia: ' + t.slice(0, 80)); await new Promise(r => setTimeout(r, 5000 * (i + 1))); }
  }
  const map = {};
  const back = t => { for (const r of [...(j.query.normalized || []), ...(j.query.redirects || [])]) if (r.to === t) t = back(r.from); return t; };
  for (const p of Object.values(j.query.pages)) if (p.pageprops?.wikibase_item) map[back(p.title)] = p.pageprops.wikibase_item;
  return map;
}
async function sparql(q) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q), { headers: UA });
    if (r.ok) return (await r.json()).results.bindings;
    await new Promise(s => setTimeout(s, 3000 * (i + 1)));
  }
  throw new Error('sparql failed');
}

// 제목이 다른 뜻(예: 파리=곤충)이거나 좌표가 없으면 '시·섬·(도시)…'를 붙여 다시 찾음
const ALT = c => [TITLE[c] || c, c + '시', c + '섬', c + ' (도시)', c + '주', c + '군', c + '구'];
// ONLY=파리,푸켓 처럼 주면 그 도시만 다시 받아 기존 spots.json에 합침
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const todo = only || cities;
const titles = [...new Set(todo.flatMap(ALT))], ids = {};
for (let i = 0; i < titles.length; i += 40) { Object.assign(ids, await qid(titles.slice(i, i + 40))); await new Promise(r => setTimeout(r, 1000)); }
const out = only ? JSON.parse(readFileSync(new URL('../spots.json', import.meta.url), 'utf8')) : {};
for (const c of todo) {
 for (const t of ALT(c)) {
  const id = ids[t];
  if (!id) continue;
  await new Promise(r => setTimeout(r, 500)); // 위키데이터 요청 간격
  // 큰 도시는 시간 초과가 날 수 있어서 반경을 줄여 다시, 그래도 안 되면 건너뜀
  let res = null;
  for (const rad of WIDE.has(c) ? [35, 15] : [12, 5, 2]) { try { res = await query(id, rad); break; } catch { console.log('retry', c, rad); } }
  if (!res?.length) { console.log('none', c, t); continue; }
  const seen = new Set(), list = [];
  for (const b of res) {
    if (seen.has(b.item.value) || list.length >= 20) continue;
    seen.add(b.item.value);
    const img = b.img ? decodeURIComponent(b.img.value.split('/').pop()) : '';
    // [이름, 위도, 경도, 종류, 사진 파일명]
    list.push([b.ko.value, +(+b.lat.value).toFixed(5), +(+b.lng.value).toFixed(5), b.typeKo?.value || '', /\.(svg|tif)$/i.test(img) ? '' : img]);
  }
  out[c] = list;
  console.log(c, t, list.length, list.slice(0, 4).map(x => x[0]).join(', '));
  break;
 }
}
writeFileSync(new URL('../spots.json', import.meta.url), JSON.stringify(out));
console.log('cities', Object.keys(out).length, 'bytes', JSON.stringify(out).length);

function query(id, rad) {
  return sparql(`SELECT ?item ?ko ?hasKo ?typeKo ?lat ?lng ?img ?links WHERE {
    hint:Query hint:optimizer "None" .
    wd:${id} wdt:P625 ?center .
    SERVICE wikibase:around { ?item wdt:P625 ?loc . bd:serviceParam wikibase:center ?center ; wikibase:radius "${rad}" . }
    ?item wikibase:sitelinks ?links . FILTER(?links >= 2)
    ?item wdt:P31 ?type . VALUES ?type { ${TYPES.map(t => 'wd:' + t).join(' ')} }
    OPTIONAL { ?item rdfs:label ?k0 . FILTER(LANG(?k0) = "ko") }
    OPTIONAL { ?item rdfs:label ?en . FILTER(LANG(?en) = "en") }
    FILTER(BOUND(?k0) || BOUND(?en)) BIND(COALESCE(?k0, ?en) AS ?ko) BIND(BOUND(?k0) AS ?hasKo)
    OPTIONAL { ?type rdfs:label ?typeKo . FILTER(LANG(?typeKo) = "ko") }
    OPTIONAL { ?item wdt:P18 ?img }
    BIND(geof:latitude(?loc) AS ?lat) BIND(geof:longitude(?loc) AS ?lng)
  } ORDER BY DESC(?hasKo) DESC(?links) LIMIT 80`);
}
