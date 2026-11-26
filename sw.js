// Service worker : app utilisable hors ligne + mises à jour rapides.
// Stratégie « réseau d'abord » pour les fichiers de l'app : dès qu'il y a du réseau,
// on récupère la dernière version publiée (sans passer par le cache HTTP du navigateur),
// et le cache ne sert que hors ligne. Plus besoin de changer VERSION à chaque mise à jour :
// ne l'incrémenter que si la liste CORE ou la logique de ce fichier change.
var VERSION = "revise-v2";
var CORE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(CORE.map(function (u) { return new Request(u, { cache: "no-cache" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, key) {
  return fetch(req, { cache: "no-cache" }).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(key || req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(key || req);
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // Vérifications de mise à jour faites par la page : jamais de cache.
  if (url.searchParams.has("check")) return;

  // Page : toujours la dernière version si en ligne.
  if (req.mode === "navigate") { e.respondWith(networkFirst(req, "./index.html")); return; }

  // Fichiers de l'app : réseau d'abord, cache hors ligne.
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }

  // Polices Google : cache d'abord (elles ne changent pas).
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { c.put(req, res.clone()); return res; });
      });
    }));
  }
});
