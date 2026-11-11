/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
**************************************************/

'use strict';
const AstralIcons = (() => {
  function mode(site) {
    if (site.iconMode === 'auto' || site.iconMode === 'custom') return site.iconMode;
    return typeof site.icon === 'string' && site.icon.startsWith('data:') ? 'custom' : 'auto';
  }
  function normalize(site) {
    const s = {...site, iconMode: mode(site)};
    if (s.iconMode === 'auto') s.icon = '';
    return s;
  }
  return {mode,normalize};
})();
if (typeof module !== 'undefined') module.exports = AstralIcons;
