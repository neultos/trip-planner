// 위트립 카카오 로그인 서버 (Cloudflare Workers 무료)
// 카카오 로그인 → 카카오에 사용자 확인 → 파이어베이스 로그인 표(custom token)를 만들어 앱으로 돌려보냄.
//
// Cloudflare 설정 > 변수 및 비밀(Secret)에 넣을 값 (코드나 대화창에 적지 말 것):
//   KAKAO_REST_KEY       카카오 REST API 키
//   KAKAO_CLIENT_SECRET  카카오 Client Secret (사용 안 하면 비워 둠)
//   FIREBASE_SA          파이어베이스 서비스 계정 키 JSON 파일 내용 전체
//   TP_TOKEN             Travelpayouts API 토큰 (항공권 참고 가격)

const BACK = ['https://neultos.github.io/trip-planner/', 'http://localhost:5178/']; // 로그인 뒤 돌아갈 수 있는 주소만

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/kakao/start') return start(url, env);
      if (url.pathname === '/kakao/callback') return await callback(url, env);
      if (url.pathname === '/flights') return await flights(url, req, env);
      if (url.pathname === '/files') return await files(url, req, env);
      return new Response('wetrip auth', { status: 200 });
    } catch (e) {
      console.log('auth error', e && e.stack || e);
      if (url.pathname === '/files') return new Response('error', { status: 500, headers: { 'Access-Control-Allow-Origin': ALLOW.includes(req.headers.get('Origin')) ? req.headers.get('Origin') : ALLOW[0] } });
      const back = backOf(url.searchParams.get('state')) || BACK[0];
      return Response.redirect(back + '#kakaoerr=' + encodeURIComponent('server'), 302);
    }
  }
};

// state = 앱이 만든 무작위값 | 돌아갈 주소
function backOf(state) {
  const back = (state || '').split('|')[1] || '';
  return BACK.includes(back) ? back : '';
}

function start(url, env) {
  const state = url.searchParams.get('state') || '', back = url.searchParams.get('back') || '';
  if (!/^[a-z0-9]{16,64}$/.test(state) || !BACK.includes(back)) return new Response('bad request', { status: 400 });
  const q = new URLSearchParams({ client_id: env.KAKAO_REST_KEY, redirect_uri: url.origin + '/kakao/callback', response_type: 'code', state: state + '|' + back });
  return Response.redirect('https://kauth.kakao.com/oauth/authorize?' + q, 302);
}

async function callback(url, env) {
  const state = url.searchParams.get('state') || '', back = backOf(state), code = url.searchParams.get('code');
  if (!back) return new Response('bad request', { status: 400 });
  const nonce = state.split('|')[0];
  if (!code) return Response.redirect(back + '#kakaoerr=' + encodeURIComponent(url.searchParams.get('error') || 'cancel') + '&s=' + nonce, 302);

  // 1) 받은 코드로 카카오 접근 토큰 받기
  const form = { grant_type: 'authorization_code', client_id: env.KAKAO_REST_KEY, redirect_uri: url.origin + '/kakao/callback', code };
  if (env.KAKAO_CLIENT_SECRET) form.client_secret = env.KAKAO_CLIENT_SECRET;
  const tr = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: new URLSearchParams(form)
  });
  const tk = await tr.json();
  if (!tk.access_token) throw new Error('kakao token: ' + JSON.stringify(tk));

  // 2) 카카오에 사용자 확인 (회원번호·닉네임)
  const me = await (await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + tk.access_token } })).json();
  if (!me.id) throw new Error('kakao me: ' + JSON.stringify(me));
  const name = (me.kakao_account?.profile?.nickname || me.properties?.nickname || '').slice(0, 12);

  // 3) 파이어베이스 로그인 표 만들기 (1시간 유효, 앱이 바로 씀)
  const token = await customToken(JSON.parse(env.FIREBASE_SA), 'kakao:' + me.id);
  // # 뒤에 붙여서 돌려보냄: # 뒤는 서버로 전송되지 않음
  return Response.redirect(back + '#kakao=' + token + '&s=' + nonce + '&n=' + encodeURIComponent(name), 302);
}

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uJson = o => b64u(new TextEncoder().encode(JSON.stringify(o)));

async function customToken(sa, uid) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64uJson({ alg: 'RS256', typ: 'JWT' });
  const body = b64uJson({
    iss: sa.client_email, sub: sa.client_email, uid, iat: now, exp: now + 3600,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
  });
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}

// 항공권 참고 최저가 (Aviasales 데이터 API: 최근 검색된 가격을 모아 둔 것이라 실시간 아님)
// /flights?from=ICN&to=KIX&a=2026-12-01&b=2026-12-04  (b 없으면 편도)
const ALLOW = ['https://neultos.github.io', 'http://localhost:5178'];
async function flights(url, req, env) {
  const o = req.headers.get('Origin') || '';
  const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOW.includes(o) ? o : ALLOW[0], 'Cache-Control': 'public, max-age=3600', Vary: 'Origin' };
  const q = url.searchParams, from = q.get('from') || '', to = q.get('to') || '', a = q.get('a') || '', b = q.get('b') || '';
  const iata = /^[A-Z]{3}$/, day = /^\d{4}-\d{2}-\d{2}$/;
  if (!iata.test(from) || !iata.test(to) || !day.test(a) || (b && !day.test(b))) return new Response('{"error":"bad"}', { status: 400, headers: h });
  const ask = async (d1, d2, limit) => {
    const p = new URLSearchParams({ origin: from, destination: to, departure_at: d1, currency: 'krw', sorting: 'price', limit: String(limit), one_way: String(!d2) });
    if (d2) p.set('return_at', d2);
    const r = await fetch('https://api.travelpayouts.com/aviasales/v3/prices_for_dates?' + p, { headers: { 'X-Access-Token': env.TP_TOKEN }, cf: { cacheTtl: 3600, cacheEverything: true } });
    return (await r.json()).data || [];
  };
  const shift = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
  const nights = b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : 0;
  // 출발 앞뒤 3일이 걸친 달(최대 2개)을 한 번씩 받아서 날짜별·항공사별로 묶음
  const months = [...new Set([shift(a, -3), a, shift(a, 3)].map(d => d.slice(0, 7)))];
  const [exactList, ...monthLists] = await Promise.all([ask(a, b, 5), ...months.map(m => ask(m, b ? shift(m + '-15', nights).slice(0, 7) : '', 1000))]);
  const all = monthLists.flat();
  const item = x => ({ price: x.price, airline: x.airline, no: x.flight_number || '', transfers: x.transfers, back: x.return_transfers ?? null, duration: x.duration_to || x.duration || 0,
    depart: x.departure_at, ret: x.return_at || '', link: 'https://www.aviasales.com' + x.link + (x.link.includes('?') ? '&' : '?') + 'marker=605632' });
  const exact = !!exactList.length;
  const gap = x => Math.abs(Date.parse(x.departure_at.slice(0, 10)) - Date.parse(a)); // 고른 출발일에 가까운 편부터
  const list = (exact ? exactList : all.slice().sort((x, y) => gap(x) - gap(y) || x.price - y.price).slice(0, 5)).map(item);
  // 날짜별: 출발일마다 최저가 (왕복이면 같은 박수 우선, 없으면 귀국일 상관없이)
  const days = [-3, -2, -1, 0, 1, 2, 3].map(k => {
    const d = shift(a, k), on = all.filter(x => x.departure_at.slice(0, 10) === d);
    const same = b ? on.filter(x => x.return_at && x.return_at.slice(0, 10) === shift(d, nights)) : on;
    const best = (same.length ? same : on).sort((x, y) => x.price - y.price)[0];
    return { d, price: best ? best.price : null, same: !!same.length };
  });
  // 항공사별: 여행 날짜에 맞는 편이 있으면 그것, 없으면 그 달에서 항공사마다 최저가
  const pool = exact ? exactList.concat(all.filter(x => x.departure_at.slice(0, 10) === a)) : all, seen = new Map();
  for (const x of pool.slice().sort((x, y) => x.price - y.price)) if (!seen.has(x.airline)) seen.set(x.airline, x);
  const airlines = [...seen.values()].slice(0, 6).map(item);
  const out = { exact, list, days, airlines, ...(list[0] || { price: null }) }; // price 등은 옛 화면용
  return new Response(JSON.stringify(out), { headers: h });
}

// 일정 첨부 파일 (같은 여행 링크를 가진 사람끼리 공유)
// 앱이 파일을 700KB 조각(base64)으로 나눠 보내면 파이어베이스 tripfiles/{여행}_{파일}_{조각} 에 저장.
// tripfiles 는 앱(브라우저)에서 직접 못 읽게 규칙에 없음 → 이 서버(관리자 권한)만 읽고 씀.
// 여행 ID(32자, 추측 불가)를 아는 사람 = 그 여행을 열 수 있는 사람 = 첨부도 볼 수 있음.
let gTok = null;
async function gToken(sa) {
  if (gTok && gTok.exp > Date.now() + 60e3) return gTok.v;
  const now = Math.floor(Date.now() / 1000);
  const head = b64uJson({ alg: 'RS256', typ: 'JWT' });
  const body = b64uJson({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
  const r = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + body + '.' + b64u(sig) }) })).json();
  if (!r.access_token) throw new Error('google token: ' + JSON.stringify(r));
  gTok = { v: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
  return gTok.v;
}
const tripOk = new Set(); // 이번 실행에서 있는 것으로 확인한 여행
async function files(url, req, env) {
  const o = req.headers.get('Origin') || '';
  const h = { 'Access-Control-Allow-Origin': ALLOW.includes(o) ? o : ALLOW[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const q = url.searchParams, trip = q.get('trip') || '', id = q.get('id') || '', i = +q.get('i'), act = q.get('a') || 'get';
  if (!/^[0-9a-f]{32}$/.test(trip) || !/^[0-9a-f]{16}$/.test(id) || !Number.isInteger(i) || i < 0 || i >= 20) return new Response('bad', { status: 400, headers: h });
  const sa = JSON.parse(env.FIREBASE_SA), tok = await gToken(sa);
  const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/default/documents/`;
  const doc = `${base}tripfiles/${trip}_${id}_${i}`, auth = { Authorization: 'Bearer ' + tok };
  if (act === 'get' && req.method === 'GET') {
    const r = await fetch(doc + '?mask.fieldPaths=data', { headers: auth });
    if (!r.ok) return new Response('not found', { status: 404, headers: h });
    // 파이어베이스 응답(JSON) 그대로 넘김: 큰 파일을 여기서 풀면 무료 CPU 한도를 넘을 수 있음
    return new Response(r.body, { headers: { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=86400' } });
  }
  if (req.method !== 'POST') return new Response('bad', { status: 405, headers: h });
  if (!tripOk.has(trip)) {
    const r = await fetch(`${base}trips/${trip}?mask.fieldPaths=updated`, { headers: auth });
    if (!r.ok) return new Response('no trip ' + r.status, { status: 404, headers: h });
    tripOk.add(trip);
  }
  if (act === 'put') {
    const b64 = await req.text();
    if (!b64 || b64.length > 960000 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) return new Response('bad body', { status: 400, headers: h });
    const r = await fetch(doc, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { trip: { stringValue: trip }, data: { bytesValue: b64 } } }) });
    return new Response(r.ok ? 'ok' : 'fail', { status: r.ok ? 200 : 502, headers: h });
  }
  if (act === 'del') { // i = 조각 수
    await Promise.all(Array.from({ length: i }, (_, k) => fetch(`${base}tripfiles/${trip}_${id}_${k}`, { method: 'DELETE', headers: auth })));
    return new Response('ok', { headers: h });
  }
  return new Response('bad', { status: 400, headers: h });
}
