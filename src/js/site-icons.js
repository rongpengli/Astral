/* Resolve automatic icons from each website, without a third-party favicon proxy. */
'use strict';
const AstralIcons = (() => {
  function parsed(raw) {
    try { const u = new URL(raw); return ['http:', 'https:'].includes(u.protocol) ? u : null; }
    catch (_) { return null; }
  }
  function mode(site) {
    if (site.iconMode === 'auto' || site.iconMode === 'custom') return site.iconMode;
    return typeof site.icon === 'string' && site.icon.startsWith('data:') ? 'custom' : 'auto';
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
  return {mode,normalize,discover};
})();
if (typeof module !== 'undefined') module.exports = AstralIcons;
