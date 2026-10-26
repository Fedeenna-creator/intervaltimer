'use strict';
const CACHE='intervaltimer-v15-2-audio-player-2';
const SHELL=[
  './',
  './index.html',
  './app.js?v=15.2',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './sound-gym.wav',
  './sound-electronic.wav',
  './sound-horn.wav',
  './sound-military.wav',
  './sound-industrial.wav'
];

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
  const url=new URL(event.request.url);
  const isAppShell=url.pathname.endsWith('/')||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/app.js');
  if(isAppShell){
    // Network-first per distribuire subito le correzioni, cache come fallback offline.
    event.respondWith(fetch(event.request).then(response=>{
      if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
      return response;
    }).catch(()=>caches.match(event.request)));
    return;
  }
  // Cache-first per WAV, icone e manifest: transizioni senza ritardi anche offline.
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response&&response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
    return response;
  })));
});
