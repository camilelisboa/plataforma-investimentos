const CACHE='private-portfolio-os-v2-4-r36-live-hotfix-1';
const CORE=['./','./index.html','./styles.css','./app.js','./app-icon.svg','./camile-pastel.svg','./lucas-old-money.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==location.origin)return;
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/.netlify/functions/'))return;
  const isNavigation=request.mode==='navigate';
  const isCore=CORE.some(item=>{const path=new URL(item,self.registration.scope).pathname;return url.pathname===path;});
  if(!isNavigation&&!isCore)return;
  if(isNavigation){
    event.respondWith(fetch(request).then(response=>response).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}
    return response;
  })));
});
