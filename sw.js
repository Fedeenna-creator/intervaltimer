'use strict';
const CACHE='intervaltimer-v15';
const SHELL=['./','./index.html','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
  ]));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached=>{
      const fresh=fetch(event.request).then(response=>{
        if(response&&response.ok){ const copy=response.clone(); caches.open(CACHE).then(cache=>cache.put(event.request,copy)); }
        return response;
      }).catch(()=>cached);
      return cached||fresh;
    })
  );
});
