// 오프라인 보기: 항상 인터넷에서 새로 받고(최신 유지), 실패하면 저장해 둔 사본을 씀
const CACHE = 'wetrip-v2';
const HOSTS = [location.host, 'www.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || !HOSTS.includes(u.host)) return; // 지도 타일·파이어베이스 통신은 건드리지 않음
  if (u.host === 'www.gstatic.com' && !u.pathname.startsWith('/firebasejs/')) return;
  e.respondWith(fetch(e.request).then(r => {
    // opaque = 다른 사이트 CSS(글꼴·지도 스타일)
    if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: u.host === location.host })));
});
