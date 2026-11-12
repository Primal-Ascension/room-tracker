/*
 * Room Tracker service worker.
 *
 * A service worker is a small script the browser keeps beside the app. This one has one
 * job: keep a copy of the app's own files on the device so the app opens with no signal.
 *
 * Rules it follows (spec section 11, contract section 4):
 *  - The cache has a version in its name. tools/build.py replaces the version text below
 *    with a hash of index.html, so every new build gets a new cache.
 *  - Cache first: the app's files are answered from the device copy.
 *  - It never takes over by itself. A new version downloads, then WAITS. The page shows
 *    "Update ready, tap to reload", and only after the tap does the page send the message
 *    RT_SKIP_WAITING. That way nothing reloads in the middle of work.
 *  - It never sends anything anywhere. It only fetches this app's own files, from the same
 *    address the app was loaded from. Project data never passes through here: projects live
 *    in the browser's database (IndexedDB), which this script does not touch.
 */

// Filled in by the build. Do not edit by hand.
const CACHE_VERSION = 'b21d643751f1469f';
const CACHE_PREFIX = 'room-tracker-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;

// The app shell: everything dist/app/ contains (besides this file). Relative paths,
// because GitHub Pages serves the app under /<repository name>/.
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

// INSTALL: download the shell into the new cache. If any file fails, the install fails
// and the old version keeps running untouched. Note: no skipWaiting() here, on purpose.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // cache: 'reload' skips the browser's ordinary HTTP cache, so we store fresh files.
      return cache.addAll(SHELL.map(function (url) {
        return new Request(url, { cache: 'reload' });
      }));
    })
  );
});

// ACTIVATE: runs when this version takes over (first install, or after the user tapped
// "Update ready"). Remove caches left by older versions, then start serving open pages.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME) {
          return caches.delete(name);
        }
        return undefined;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// FETCH: answer the app's own files from the cache.
self.addEventListener('fetch', function (event) {
  var request = event.request;
  // Only plain downloads of our own files. Anything else is left alone (and the page's
  // Content-Security-Policy blocks requests to other addresses anyway).
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      // ignoreSearch: "index.html?x=1" still finds the stored "index.html".
      return cache.match(request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        // Not in the cache (for example the browser cleared it): try the network, and for
        // a page load with no signal fall back to the stored start page.
        return fetch(request).catch(function () {
          if (request.mode === 'navigate') {
            return cache.match('index.html').then(function (page) {
              return page || cache.match('./');
            }).then(function (page) {
              return page || Response.error();
            });
          }
          return Response.error();
        });
      });
    })
  );
});

// MESSAGES from the page.
//   { type: 'RT_SKIP_WAITING' }  the user tapped "Update ready, tap to reload": take over now.
//   { type: 'RT_GET_VERSION' }   reply with this worker's cache version.
// ('SKIP_WAITING' is accepted as a second spelling of the first message.)
self.addEventListener('message', function (event) {
  var data = event.data || {};
  var type = typeof data === 'string' ? data : data.type;
  if (type === 'RT_SKIP_WAITING' || type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'RT_GET_VERSION') {
    var reply = { type: 'RT_VERSION', version: CACHE_VERSION };
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage(reply);
    } else if (event.source) {
      event.source.postMessage(reply);
    }
  }
});
