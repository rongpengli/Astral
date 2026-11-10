/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
**************************************************/
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
  function discover(raw) {
    const target = parsed(raw);
    return target ? [new URL('/favicon.ico', target.origin).href] : [];
  }
  return {mode,normalize,discover};
})();
if (typeof module !== 'undefined') module.exports = AstralIcons;
