/* Shared import/export schema. Legacy embedded icons are preserved in a local backup. */
'use strict';
const AstralBackup = (() => {
 const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
 const clone = v => JSON.parse(JSON.stringify(v));
 function validate(input) {
   if (!isObject(input) || !isObject(input.config) || !Array.isArray(input.sites) || !isObject(input.css)) throw Error('配置文件需要包含 config、sites、css');
   for (const g of input.sites) {
     if (!isObject(g) || typeof g.name !== 'string' || !Array.isArray(g.list)) throw Error('导航分组格式错误');
     for (const s of g.list) if (!isObject(s) || typeof s.title !== 'string' || typeof s.url !== 'string') throw Error('网站数据格式错误');
   }
 }
 function migrate(input) {
   validate(input);
   const result = {config:clone(input.config),sites:clone(input.sites),css:clone(input.css)};
   const originalIcons = [];
   for (const [gi,g] of result.sites.entries()) {
     if (!g._syncId) g._syncId=crypto.randomUUID();
     for (const [si,s] of g.list.entries()) {
       if (!s._syncId) s._syncId=crypto.randomUUID();
       if (s.iconMode === 'custom') continue;
       if (s.iconMode === 'auto') {s.icon='';continue;}
       // Legacy format has no explicit intent: default to online favicon.
       // Preserve the old artwork locally for manual restoration.
       if (typeof s.icon === 'string' && s.icon.startsWith('data:image/')) originalIcons.push({group:g.name,title:s.title,url:s.url,icon:s.icon,groupIndex:gi,siteIndex:si});
       s.iconMode='auto';s.icon='';
     }
   }
   return {data:result,originalIcons};
 }
 function exportData(input) {
   validate(input);
   const data=clone(input);
   for(const g of data.sites) for(const s of g.list) {
     if(s.iconMode === 'auto') s.icon='';
     else if(s.iconMode !== 'custom') {
       // Old local entries are exported in portable format without large legacy blobs.
       s.iconMode='auto';s.icon='';
     }
   }
   return data;
 }
 return {migrate,exportData,validate};
})();
if(typeof module !== 'undefined') module.exports=AstralBackup;
