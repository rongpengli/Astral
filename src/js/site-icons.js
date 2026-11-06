/* Resolve automatic icons from each website, without a third-party favicon proxy. */
'use strict';
const AstralIcons = (() => {
  const cache = new Map();
  const fallback = '../image/default.svg';
  function parsed(raw) {
    try { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) ? u : null; }
    catch (_) { return null; }
  }
  function url(raw) {
    const u = parsed(raw);
    return u ? new URL('/favicon.ico', u.origin).href : '';
  }
  function mode(site) {
    if (site.iconMode === 'auto' || site.iconMode === 'custom') return site.iconMode;
    return typeof site.icon === 'string' && site.icon.startsWith('data:') ? 'custom' : 'auto';
  }
  function display(site) {
    if (mode(site) === 'custom' && site.icon) return site.icon;
    return url(site.url) || fallback;
  }
  function normalize(site) {
    const s = {...site, iconMode: mode(site)};
    if (s.iconMode === 'auto') s.icon = '';
    return s;
  }
  async function discover(raw) {
    const target = parsed(raw);
    if (!target) return [];
    const icons = [];
    try {
      // Host permissions allow an extension page to read cross-origin HTML.
      const response = await fetch(target.href, {credentials:'omit', redirect:'follow', signal:AbortSignal.timeout(6000)});
      if (response.ok && /text\/html/i.test(response.headers.get('content-type') || '')) {
        const html = await response.text();
        // Extract only favicon link attributes as text. Parsing untrusted website
        // HTML with DOMParser can trigger MV3 CSP warnings for inline handlers.
        const base = parsed(response.url) || target;
        const attr = (tag, name) => {
          const match = tag.match(new RegExp("(?:\\s|^)" + name + "\\s*=\\s*(?:\"([^\"\\r\\n]*)\"|'([^'\\r\\n]*)'|([^\\s>]+))", 'i'));
          return match ? (match[1] ?? match[2] ?? match[3]) : '';
        };
        const links = Array.from(html.matchAll(/<link\b[^>]*>/gi), m => m[0])
          .filter(tag => /(?:^|\s)(?:icon|shortcut|apple-touch-icon|apple-touch-icon-precomposed)(?:\s|$)/i.test(attr(tag, 'rel')))
          .map(tag => {
            const sizes = attr(tag, 'sizes');
            const size = Math.max(0, ...Array.from(sizes.matchAll(/(\d+)x\d+/g), m => Number(m[1])));
            return {href:attr(tag, 'href'), size};
          }).filter(item => item.href).sort((a,b) => b.size-a.size);
        for (const item of links) {
          try {
            const resolved = new URL(item.href, base);
            if (['http:','https:','data:'].includes(resolved.protocol)) icons.push(resolved.href);
          } catch (_) {}
        }
      }
    } catch (_) { /* Unreachable sites still get a /favicon.ico attempt. */ }
    icons.push(new URL('/favicon.ico', target.origin).href);
    return [...new Set(icons)];
  }
  function candidates(raw) {
    if (!cache.has(raw)) cache.set(raw, discover(raw));
    return cache.get(raw);
  }
  // Automatic favicons are stored only on this device, never in the synced sites list.
  // One key per origin avoids lost updates when several icons load simultaneously.
  const CACHE_PREFIX = 'astral_favicon_v1:';
  const MAX_CACHE_BYTES = 120 * 1024;
  function cacheKey(raw) {
    const u = parsed(raw);
    return u ? CACHE_PREFIX + encodeURIComponent(u.origin) : null;
  }
  async function asDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  async function compactImage(blob) {
    if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') {
      // SVG and unknown content types are not persisted as executable markup.
      return null;
    }
    if (blob.size <= 24 * 1024) return asDataUrl(blob);
    try {
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const compressed = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
      return compressed ? asDataUrl(compressed) : null;
    } catch (_) { return null; }
  }
  async function loadAutomatic(raw) {
    const key = cacheKey(raw);
    if (!key) return fallback;
    try {
      const saved = (await chrome.storage.local.get(key))[key];
      if (saved && typeof saved.data === 'string' && saved.data.startsWith('data:image/')) return saved.data;
    } catch (_) { /* Cache is an optimization, not required for navigation. */ }
    const items = await candidates(raw);
    for (const candidate of items) {
      try {
        const response = await fetch(candidate, {credentials:'omit', signal:AbortSignal.timeout(6000)});
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size > 1024 * 1024) continue;
        const data = await compactImage(blob);
        if (!data || data.length > MAX_CACHE_BYTES * 1.4) continue;
        try { await chrome.storage.local.set({[key]: {data, savedAt: Date.now()}}); }
        catch (_) { /* Still display the fetched icon. */ }
        return data;
      } catch (_) { /* Try the next favicon declared by the site. */ }
    }
    return fallback;
  }
  const pendingIcons = new Map();
  function automatic(raw) {
    const key = cacheKey(raw);
    if (!key) return Promise.resolve(fallback);
    if (!pendingIcons.has(key)) {
      const job = loadAutomatic(raw).finally(() => pendingIcons.delete(key));
      pendingIcons.set(key, job);
    }
    return pendingIcons.get(key);
  }
  function apply(img, site) {
    const token = Symbol('icon');
    img._astralIconToken = token;
    img.onerror = () => {
      if (img._astralIconToken === token) { img.onerror = null; img.src = fallback; }
    };
    if (mode(site) === 'custom' && site.icon) {
      img.src = site.icon;
      return;
    }
    // Do not assign a remote URL to img.src: that would re-request on every tab.
    img.src = fallback;
    automatic(site.url).then(data => {
      if (img._astralIconToken === token) img.src = data;
    }).catch(() => {});
  }
  return {url,mode,display,normalize,apply,discover};
})();
if (typeof module !== 'undefined') module.exports = AstralIcons;
