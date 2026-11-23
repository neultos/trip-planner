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
      return new Response('wetrip auth', { status: 200 });
    } catch (e) {
      console.log('auth error', e && e.stack || e);
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

// 항공권 참고 최저가 (Aviasales 데이터: 최근 이틀쯤 검색된 가격이라 실시간 아님)
// /flights?from=ICN&to=KIX&a=2026-12-01&b=2026-12-04  (b 없으면 편도)
const ALLOW = ['https://neultos.github.io', 'http://localhost:5178'];
async function flights(url, req, env) {
  const o = req.headers.get('Origin') || '';
  const h = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': ALLOW.includes(o) ? o : ALLOW[0], 'Cache-Control': 'public, max-age=3600', Vary: 'Origin' };
  const q = url.searchParams, from = q.get('from') || '', to = q.get('to') || '', a = q.get('a') || '', b = q.get('b') || '';
  const iata = /^[A-Z]{3}$/, day = /^\d{4}-\d{2}-\d{2}$/;
  if (!iata.test(from) || !iata.test(to) || !day.test(a) || (b && !day.test(b))) return new Response('{"error":"bad"}', { status: 400, headers: h });
  const ask = async (d1, d2) => {
    const p = new URLSearchParams({ origin: from, destination: to, departure_at: d1, currency: 'krw', sorting: 'price', limit: '5', one_way: String(!d2) });
    if (d2) p.set('return_at', d2);
    const r = await fetch('https://api.travelpayouts.com/aviasales/v3/prices_for_dates?' + p, { headers: { 'X-Access-Token': env.TP_TOKEN }, cf: { cacheTtl: 3600, cacheEverything: true } });
    return (await r.json()).data || [];
  };
  let list = await ask(a, b);
  const exact = !!list.length;
  if (!exact) list = await ask(a.slice(0, 7), b.slice(0, 7)); // 그 날짜 가격이 없으면 같은 달 최저
  const items = list.map(x => ({ price: x.price, airline: x.airline, no: x.flight_number || '', transfers: x.transfers, back: x.return_transfers ?? null, duration: x.duration_to || x.duration || 0,
    depart: x.departure_at, ret: x.return_at || '', link: 'https://www.aviasales.com' + x.link + (x.link.includes('?') ? '&' : '?') + 'marker=605632' }));
  const out = { exact, list: items, ...(items[0] || { price: null }) }; // price 등은 옛 화면용
  return new Response(JSON.stringify(out), { headers: h });
}
