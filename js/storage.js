/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
**************************************************/
'use strict';
const ASTRAL_DEFAULTS = {
 config:{newTabOpen:true,title:'Astral New Tab',useBigImage:2,bingMaxHistory:8,weatherLatitude:39.9042,weatherLongitude:116.4074,weatherCity:'北京',weatherMode:'native',weatherLocationMode:'manual'},
 sites:[],css:{version:0,index:''}
};
const AstralStore=(()=>{
 const KEY='astral.web.settings.v1';
 const CACHE_GENERATION='astral.cache.generation.v1';
 const ICON_CACHE='astral.web.icons.v2',ICON_TTL=7*86400000;
 const ICON_FAILURES='astral.web.icon-failures.v1',FAILURE_TTL=24*3600000;
 // Shared per-page lookup de-duplication for automatic icon discovery.
 const iconLookups=new Map();
 // Normalize retired provider URLs left by older configuration exports.
 function retiredIconURL(value){
  if(typeof value!=='string'||!value.trim())return false;
  try{const host=new URL(value).hostname.toLowerCase();return host==='cravatar.com'||host.endsWith('.cravatar.com')}catch{return false}
 }
 // Public hostnames are eligible for third-party providers; private/local hosts
 // must only use their own declared or root favicon to avoid leaking them.
 function publicHost(source){
  try{const u=new URL(source);if(!['http:','https:'].includes(u.protocol)||privateIconURL(source)||isCC98URL(source))return null;return u.hostname}catch{return null}
 }
 function favicon(site,fallback){
  if(site&&site.iconMode==='custom'&&typeof site.icon==='string'&&site.icon.trim())return site.icon.trim();
  return siteFaviconURL(site)||fallback;
 }
 const cacheGeneration=()=>localStorage.getItem(CACHE_GENERATION)||'0';
 const iconRecords=()=>{try{return JSON.parse(localStorage.getItem(ICON_CACHE)||'{}')||{}}catch{return {}}};
 function saveIconRecord(url,icon){
  const records=iconRecords();delete records[url];records[url]={url:icon,updated:Date.now()};
  const entries=Object.entries(records).sort((a,b)=>(b[1].updated||0)-(a[1].updated||0)).slice(0,512);
  try{localStorage.setItem(ICON_CACHE,JSON.stringify(Object.fromEntries(entries)))}catch{}
 }
 function dropIconRecord(url){const records=iconRecords();if(url in records){delete records[url];try{localStorage.setItem(ICON_CACHE,JSON.stringify(records))}catch{}}}

 // Persist failed image URLs so a broken URL is not retried on every page load.
 // Shared failure state for manual icons, site favicons and provider URLs.
 const iconFailures=()=>{try{return JSON.parse(localStorage.getItem(ICON_FAILURES)||'{}')||{}}catch{return {}}};
 function failureState(url){
  const entry=iconFailures()[url];
  if(typeof entry==='number')return {count:1,until:entry,updated:entry-FAILURE_TTL};
  return entry&&typeof entry==='object'?entry:{count:0,until:0,updated:0};
 }
 function failedRecently(url){return failureState(url).until>Date.now()}
 function markIconFailure(url,threshold=1){
  if(!url)return 0;
  const now=Date.now(),records=iconFailures(),prior=failureState(url);
  const count=Math.min(threshold,(now-prior.updated>ICON_TTL?0:prior.count)+1);
  records[url]={count,updated:now,until:count>=threshold?now+FAILURE_TTL:0};
  const entries=Object.entries(records).filter(([,v])=>v&&now-(typeof v==='number'?v-FAILURE_TTL:v.updated||0)<ICON_TTL).sort((a,b)=>(b[1].updated||b[1])-(a[1].updated||a[1])).slice(0,512);
  try{localStorage.setItem(ICON_FAILURES,JSON.stringify(Object.fromEntries(entries)))}catch{}
  return count;
 }
 function clearIconFailure(url){const records=iconFailures();if(url in records){delete records[url];try{localStorage.setItem(ICON_FAILURES,JSON.stringify(records))}catch{}}}
 function probeIcon(url,timeout=4800,generation=cacheGeneration()){
  return new Promise((resolve,reject)=>{
   if(failedRecently(url)){reject(Error('图标地址处于失败冷却期'));return}
   const image=new Image();let done=false;
   const finish=(ok)=>{if(done)return;done=true;clearTimeout(timer);image.onload=image.onerror=null;if(cacheGeneration()===generation){if(ok)clearIconFailure(url);else markIconFailure(url)}ok?resolve(url):reject(Error('图标加载失败'));};
   const timer=setTimeout(()=>finish(false),timeout);
   image.onload=()=>finish(image.naturalWidth>=16&&image.naturalHeight>=16);
   image.onerror=()=>finish(false);
   image.src=url;
  });
 }
 function siteFaviconURL(site){
  try{const u=new URL(site.url);return ['http:','https:'].includes(u.protocol)?u.origin+'/favicon.ico':null}catch{return null}
 }
 // No cross-origin HTML fetch: test the site's root favicon and both providers concurrently.
 function discoverIcon(site,generation=cacheGeneration()){
  const key=site.url;
  if(!iconLookups.has(key)){
   const own=siteFaviconURL(site),host=publicHost(site.url),full=encodeURIComponent(site.url);
   const candidates=[];
   if(own)candidates.push({url:own,timeout:3000});
   if(host){
    candidates.push({url:'https://api.xinac.net/icon/?url='+full,timeout:4800});
    candidates.push({url:'https://a.favicon.im/'+encodeURIComponent(host)+'?throw-error-on-404=true',timeout:4800});
   }
   const available=candidates.filter(item=>!failedRecently(item.url));
   let task;
   task=(available.length?Promise.any(available.map(item=>probeIcon(item.url,item.timeout,generation))):Promise.resolve(null))
    .catch(()=>null)
    .finally(()=>{if(iconLookups.get(key)===task)iconLookups.delete(key)});
   iconLookups.set(key,task);
  }
  return iconLookups.get(key);
 }
 const iconResolutions=new Map();
 function resolveIcon(site,generation=cacheGeneration()){
  const key=site.url;
  if(!iconResolutions.has(key)){
   let task;
   task=discoverIcon(site,generation).finally(()=>{if(iconResolutions.get(key)===task)iconResolutions.delete(key)});
   iconResolutions.set(key,task);
  }
  return iconResolutions.get(key);
 }
 function setFavicon(img,site,fallback){
  const custom=site.iconMode==='custom'&&typeof site.icon==='string'&&!!site.icon.trim();
  const manual=custom?site.icon.trim():null;
  const previous=custom?null:iconRecords()[site.url];
  // Discard invalid image URLs cached by v1.12.8's old favicon.im endpoint.
  const saved=previous&&/^https:\/\/favicon\.im\//i.test(previous.url||'')?null:previous;
  if(previous&&!saved)dropIconRecord(site.url);
  const started=cacheGeneration();let serial=0,refreshing=false;
  function display(src,fromDiscovery=false){
   const token=++serial;
   img.onerror=()=>{
    if(token!==serial||cacheGeneration()!==started)return;
    if(src===manual){
     const failures=markIconFailure(manual,3);
     display(fallback);
     if(failures>=3)refreshFallback();
     return;
    }
    if(src!==fallback){
     markIconFailure(src);
     if(saved?.url===src)dropIconRecord(site.url);
    }
    display(fallback);
    if(src!==fallback)refreshFallback();
   };
   img.onload=()=>{
    if(token!==serial||cacheGeneration()!==started)return;
    if(src===manual){clearIconFailure(manual);saveIconRecord('custom:'+manual,manual)}
    else {
     clearIconFailure(src);
     // Store only an image that the visible navigation element actually loaded.
     if(fromDiscovery&&!custom&&src!==fallback)saveIconRecord(site.url,src);
    }
   };
   img.src=src;
  }
  function refreshFallback(){
   if(refreshing||cacheGeneration()!==started)return;
   refreshing=true;
   resolveIcon(site,started).then(found=>{
    if(cacheGeneration()!==started)return;
    if(!found||failedRecently(found))return;
    // Source-level failure records are the only cooldown gate.
    if(!custom){
     // Never overwrite a manual edit made while discovery was running.
     const latest=(read().sites||[]).some(group=>(group.list||[]).some(entry=>entry.url===site.url&&entry.title===site.title&&entry.iconMode==='custom'&&typeof entry.icon==='string'&&!!entry.icon.trim()));
     if(latest||cacheGeneration()!==started)return;
    }
    // A detached Image probe may succeed while the actual navigation image fails.
    // Commit cache only after the latter's onload, including refresh of an old URL.
    if(img.src===found&&img.complete&&img.naturalWidth>=16&&img.naturalHeight>=16){
     if(!custom)saveIconRecord(site.url,found);
    }else display(found,true);
   }).catch(()=>{}).finally(()=>{refreshing=false});
  }
  if(custom){
   // A manual URL is retried after its 24-hour cooldown; restart its 3-failure count.
   const state=failureState(manual);
   if(state.count>=3&&state.until<=Date.now())clearIconFailure(manual);
   if(failedRecently(manual)){display(fallback);refreshFallback()}
   else display(manual);
  }else{
   const cached=saved?.url;
   if(cached&&!failedRecently(cached)){
    display(cached);
    if(Date.now()-(saved.updated||0)>=ICON_TTL)refreshFallback();
   }else{
    if(cached)dropIconRecord(site.url);
    display(fallback);
    refreshFallback();
   }
  }
  return manual||(saved?.url||fallback);
 }
 // Embed actual image bytes in exported JSON. Cross-origin image display alone
 // does not grant permission to read its bytes; a CORS-enabled response is required.
 async function iconDataURL(url, timeout=4500){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetch(url,{mode:'cors',credentials:'omit',signal:controller.signal});
   if(!response.ok)throw Error('HTTP '+response.status);
   const blob=await response.blob();
   if(!blob.type.startsWith('image/') || !blob.size || blob.size>1024*1024)throw Error('不是有效的图标文件');
   return await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error||Error('读取图标失败'));
    reader.readAsDataURL(blob);
   });
  }finally{clearTimeout(timer)}
 }
 // Navigation icons render at 1em (~16 CSS px). Export at 32px for HiDPI.
 // Only the exported snapshot is changed; local settings keep original icons.
 async function compactIcon(source){
  const img=new Image();let objectURL=null;
  try{
   if(/^data:image\//i.test(source))img.src=source;
   else{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),4500);
    let blob;
    try{
     const res=await fetch(source,{mode:'cors',credentials:'omit',signal:controller.signal});
     if(!res.ok)throw Error('HTTP '+res.status);
     blob=await res.blob();
     if(!blob.type.startsWith('image/')||!blob.size||blob.size>1024*1024)throw Error('无效图标');
    }finally{clearTimeout(timer)}
    objectURL=URL.createObjectURL(blob);img.src=objectURL;
   }
   await img.decode();
   if(!img.naturalWidth||!img.naturalHeight)throw Error('无法解码图标');
   // Original extension renders the entire image in a 1em x 1em box with no
   // clipping. Preserve the image's aspect ratio and optical margins; trim
   // only demonstrably excessive transparent canvas around its artwork.
   const sw=img.naturalWidth,sh=img.naturalHeight;
   const sampleScale=Math.min(1,256/Math.max(sw,sh));
   const scan=document.createElement('canvas');
   scan.width=Math.max(1,Math.round(sw*sampleScale));
   scan.height=Math.max(1,Math.round(sh*sampleScale));
   const sc=scan.getContext('2d',{willReadFrequently:true});
   if(!sc)throw Error('无法创建画布');
   sc.drawImage(img,0,0,scan.width,scan.height);
   const pixels=sc.getImageData(0,0,scan.width,scan.height).data;
   let l=scan.width,t=scan.height,r=-1,b=-1;
   for(let y=0;y<scan.height;y++)for(let x=0;x<scan.width;x++){
    if(pixels[(y*scan.width+x)*4+3]>16){
     l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);
    }
   }
   if(r<l||b<t)throw Error('空白图标');
   let left=0,top=0,cropW=sw,cropH=sh;
   const visibleW=(r-l+1)/scan.width,visibleH=(b-t+1)/scan.height;
   // A few transparent pixels are often intentional. Do not crop them.
   if(visibleW<0.82||visibleH<0.82){
    const padX=Math.max(1,Math.round((r-l+1)*0.06));
    const padY=Math.max(1,Math.round((b-t+1)*0.06));
    const x0=Math.max(0,l-padX),y0=Math.max(0,t-padY);
    const x1=Math.min(scan.width,r+1+padX),y1=Math.min(scan.height,b+1+padY);
    left=x0*sw/scan.width;top=y0*sh/scan.height;
    cropW=(x1-x0)*sw/scan.width;cropH=(y1-y0)*sh/scan.height;
   }
   // 1em is typically 16 CSS pixels; 32 physical pixels support 2x screens.
   // Keep a square transparent canvas, matching the extension's icon box.
   const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建画布');
   const scale=Math.min(32/cropW,32/cropH);
   const w=cropW*scale,h=cropH*scale;
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
   ctx.drawImage(img,left,top,cropW,cropH,(32-w)/2,(32-h)/2,w,h);
   // Select the smaller lossless PNG or compressed WebP. Keep PNG when
   // WebP's savings are marginal, to preserve crisp text and line icons.
   const png=canvas.toDataURL('image/png');
   const webp=canvas.toDataURL('image/webp',0.82);
   const result=webp.startsWith('data:image/webp;')&&webp.length<png.length*0.9?webp:png;
   if(result.length>120*1024)throw Error('图标压缩后仍然过大');
   return result;
  }finally{if(objectURL)URL.revokeObjectURL(objectURL)}
 }
 // Internal/private hosts are fragile across networks and devices. Try to
 // embed their icon bytes, but never treat a CORS failure as proof of outage.
 function privateIconURL(source){
  try{
   const u=new URL(source),h=u.hostname.toLowerCase().replace(/\.$/,'');
   if(!['http:','https:'].includes(u.protocol))return false;
   if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.lan')||h.endsWith('.home')||h.endsWith('.test')||h.endsWith('.intranet'))return true;
   if(h.startsWith('['))return h==='[::1]'||h.startsWith('[fc')||h.startsWith('[fd')||h.startsWith('[fe8')||h.startsWith('[fe9')||h.startsWith('[fea')||h.startsWith('[feb');
   const octets=h.split('.');
   if(octets.length===4&&octets.every(v=>/^\d{1,3}$/.test(v)&&Number(v)<=255)){
    const x=octets.map(Number);
    return x[0]===10||x[0]===127||x[0]===0||x[0]===169&&x[1]===254||x[0]===172&&x[1]>=16&&x[1]<=31||x[0]===192&&x[1]===168||x[0]===100&&x[1]>=64&&x[1]<=127;
   }
   // Unqualified hostnames are commonly local DNS names.
   return !h.includes('.');
  }catch{return false}
 }
 function isCC98URL(source){
  try{const host=new URL(source).hostname.toLowerCase().replace(/\.$/,'');return host==='cc98.org'||host.endsWith('.cc98.org')}catch{return false}
 }
 function imageReachable(source,timeout=2800){
  return new Promise(resolve=>{
   const img=new Image();let finished=false;
   const finish=ok=>{if(finished)return;finished=true;clearTimeout(timer);img.onload=img.onerror=null;resolve(ok)};
   const timer=setTimeout(()=>finish(false),timeout);
   img.onload=()=>finish(true);img.onerror=()=>finish(false);img.src=source;
  });
 }
 async function exportSitesWithIcons(sites){
  const snapshot=structuredClone(sites),pending=new Map(),unresolved=[],jobs=[];
  for(const group of snapshot)for(const site of group.list){
   if(site.iconMode==='auto'){delete site.icon;delete site.iconMode;continue;}
   delete site.iconMode;
   const source=typeof site.icon==='string'?site.icon.trim():'';
   // Empty icon fields use the original lazy /favicon.ico behavior on import.
   if(!source)continue;
   const label=site.title||site.url||source;
   if(/^data:image\//i.test(source)){
    if(!pending.has(source))pending.set(source,compactIcon(source).then(value=>({value})).catch(()=>({value:null})));
    jobs.push({site,source,label,kind:'embedded'});
   }else if(/^https?:\/\//i.test(source)){
    const local=privateIconURL(source)||isCC98URL(source)||isCC98URL(site.url);
    if(!pending.has(source))pending.set(source,(async()=>{
     if(local){
      try{return {value:await compactIcon(source)}}catch{return {value:null}}
     }
     const reachable=await imageReachable(source);
     return {value:null,warning:reachable?null:'远程图标当前无法加载'};
    })());
    jobs.push({site,source,label,kind:local?'private':'remote'});
   }else unresolved.push(label+'：不支持的图标来源');
  }
  await Promise.all(pending.values());
  for(const {site,source,label,kind} of jobs){
   const result=await pending.get(source);
   if(result.value)site.icon=result.value;
   else if(result.warning)unresolved.push(label+'：'+result.warning);
   else if(kind==='embedded')unresolved.push(label+'：原始内嵌图标压缩失败，已保留原值');
  }
  return {sites:snapshot,unresolved};
 }
 function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x)}
 function validate(input){
  if(!plain(input))throw Error('配置必须是 JSON 对象');
  if(input.config!==undefined&&!plain(input.config))throw Error('选项区格式错误');
  if(input.css!==undefined&&!plain(input.css))throw Error('css 格式错误');
  if(input.sites!==undefined&&!Array.isArray(input.sites))throw Error('导航区格式错误');
  // Older extension exports can omit icon or use null; normalize instead of rejecting the whole import.
  const sites=(input.sites||[]).map((g,i)=>{
   if(!plain(g))throw Error('第 '+(i+1)+' 个导航分组格式错误');
   const entries=Array.isArray(g.list)?g.list:(Array.isArray(g.sites)?g.sites:null);
   if(!entries)throw Error('第 '+(i+1)+' 个导航分组缺少 list 数组');
   return {...g,name:String(g.name??''),list:entries.map((item,j)=>{
    if(!plain(item))throw Error('导航条目格式错误：'+(i+1)+' / '+(j+1));
    const icon=typeof item.icon==='string'?item.icon:'';
    const obsolete=retiredIconURL(icon)&&item.iconMode!=='custom';
    return {...item,title:String(item.title??''),url:String(item.url??''),icon:obsolete||item.iconMode==='auto'||!icon.trim()?'':icon,iconMode:obsolete||item.iconMode==='auto'||!icon.trim()?'auto':'custom'};
   })};
  });
  const config={...ASTRAL_DEFAULTS.config,...(input.config||{})};
  if(Object.hasOwn(config,'syncEnabled') && typeof config.syncEnabled!=='boolean')throw Error('syncEnabled 必须为 true 或 false');
  for(const k of ['title','weatherCity'])if(typeof config[k]!=='string')throw Error(k+' 类型错误');
  for(const k of ['newTabOpen'])if(typeof config[k]!=='boolean')throw Error(k+' 类型错误');
  config.useBigImage=[0,1,2].includes(Number(config.useBigImage))?Number(config.useBigImage):2;
  // Original extension: maximum recent Bing images available to the manual switch button.

  config.bingMaxHistory=Number.isInteger(Number(config.bingMaxHistory))&&Number(config.bingMaxHistory)>=1&&Number(config.bingMaxHistory)<=8?Number(config.bingMaxHistory):8;
  delete config.wallpaperIntervalDays;
  config.weatherLatitude=Number(config.weatherLatitude);config.weatherLongitude=Number(config.weatherLongitude);
  if(!Number.isFinite(config.weatherLatitude)||Math.abs(config.weatherLatitude)>90||!Number.isFinite(config.weatherLongitude)||Math.abs(config.weatherLongitude)>180)throw Error('天气经纬度无效');
  config.weatherMode=config.weatherMode==='off'?'off':'native';
  config.weatherLocationMode=config.weatherLocationMode==='auto'?'auto':'manual';
  // Preserve extension-only preferences as opaque data for round-trip compatibility.
  const nested=config.extensionFeatures;
  if(nested&&typeof nested==='object'&&!Array.isArray(nested))for(const key of ['autoChange','autoDownload','downloadDir','userImage','userImageSrc'])if(!Object.prototype.hasOwnProperty.call(config,key)&&Object.prototype.hasOwnProperty.call(nested,key))config[key]=nested[key];
  for(const key of ['weatherSrc','weatherLegacySrc','_astralWeatherBridge','downloadDirEdited','wallpaperIndex','extensionFeatures'])delete config[key];
  const css={...ASTRAL_DEFAULTS.css,...(input.css||{})};
  if(typeof css.index!=='string')css.index='';delete css.weather;
  return {config,sites,css};
 }
 function safeGet(key){try{return localStorage.getItem(key)}catch(e){console.warn('存储不可读取',e);return null}}
 function safeSet(key,value){try{localStorage.setItem(key,value)}catch(e){throw Error('浏览器无法保存设置：'+(e.message||e))}}
 function read(){let data={};try{const s=safeGet(KEY);if(s)data=JSON.parse(s);else{for(const k of ['config','sites','css']){const v=safeGet(k);if(v!==null)data[k]=JSON.parse(v)}}}catch(e){console.warn('读取配置失败',e)}try{
  const normalized=validate(data);
  const hadRetired=Array.isArray(data.sites)&&data.sites.some(group=>Array.isArray(group.list)&&group.list.some(site=>retiredIconURL(site.icon)&&site.iconMode!=='custom'));
  if(hadRetired){try{safeSet(KEY,JSON.stringify(normalized))}catch(e){console.warn('旧图标配置迁移未能保存',e)}}
  return normalized;
 }catch(e){console.warn('配置校验失败',e);return validate({})}}
 // Resolve from this script so a nested deployment and every settings page use the same preset.
 const presetURL=new URL('../AstralNewTab.json',document.currentScript.src);
 const hasSettings=()=>[KEY,'config','sites','css'].some(key=>safeGet(key)!==null);
 async function readPreset(){
  const response=await fetch(presetURL,{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('无法读取预设 AstralNewTab.json');
  const raw=await response.json();
  if(!raw?.config||!Array.isArray(raw.sites))throw Error('默认配置不完整，请检查选项和导航设置。');
  const preset=validate(raw);
  Object.assign(ASTRAL_DEFAULTS,preset);
  return preset;
 }
 let initializing=null;
 function initializeFromFile(){
  if(initializing)return initializing;
  const task=initializeLocal();
  initializing=task.finally(()=>{initializing=null});
  return initializing;
 }
 async function initializeLocal(){
  const saved=safeGet(KEY);
  if(saved){
   try{
    const data=JSON.parse(saved);
    if(data.config&&Array.isArray(data.sites)&&data.css&&
       Object.keys(ASTRAL_DEFAULTS.config).every(key=>Object.hasOwn(data.config,key))){
     validate(data);
     return false;
    }
   }catch{/* Validate older settings after loading their missing defaults. */}
  }
  const preset=await readPreset();
  if(hasSettings()){
   // Re-read after awaiting the file so edits made during loading take priority.
   // Persist normalized legacy data once, retaining explicit false and empty lists.
   const current=safeGet(KEY);
   let data;
   try{
    if(current!==null)data=JSON.parse(current);
    else{
     data={};
     for(const key of ['config','sites','css']){
      const value=safeGet(key);
      if(value!==null)data[key]=JSON.parse(value);
     }
    }
    const normalized=validate(data);
    safeSet(KEY,JSON.stringify(normalized));
   }catch(error){
    // Invalid saved data must never silently turn into a new empty collection.
    throw Error('本机配置无法读取，请检查或重新导入。'+String(error.message||error));
   }
   return false;
  }
  safeSet(KEY,JSON.stringify(preset));
  return true;
 }
 async function clearRuntimeCaches(){
  // Invalidate pending asynchronous requests before clearing storage.
  localStorage.setItem(CACHE_GENERATION,String(Date.now())+'-'+Math.random());
  iconLookups.clear();iconResolutions.clear();
  const errors=[];
  try{
   for(const key of Object.keys(localStorage)){
    if(key.startsWith('astral.weather.city.v2:')||[
     ICON_CACHE,ICON_FAILURES,'astral.web.custom-icon-failures.v1','astral.weather.last-success.v1','astral.bing.metadata.v2',
     'astral.wallpaper.current','astral.wallpaper.selection.v1',
     'astral.wallpaper.cache-policy.v1'
    ].includes(key))localStorage.removeItem(key);
   }
  }catch(e){errors.push('本地缓存：'+e.message)}
  try{
   const database=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('astral-wallpaper-v1',1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('images'))req.result.createObjectStore('images')};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
   });
   try{if(database.objectStoreNames.contains('images'))await new Promise((resolve,reject)=>{
    const tx=database.transaction('images','readwrite');tx.objectStore('images').clear();
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('清理失败'));
   })}finally{database.close()}
  }catch(e){errors.push('壁纸图片：'+e.message)}
  if('caches' in window)try{
   const names=await caches.keys();
   for(const name of names)if(name.startsWith('astral-'))await caches.delete(name);
  }catch(e){errors.push('Cache Storage：'+e.message)}
  return errors;
 }
 async function restorePreset(){
  const preset=await readPreset();
  const errors=await clearRuntimeCaches();
  safeSet(KEY,JSON.stringify(preset));
  if(errors.length)console.warn('部分缓存清理失败',errors);
  return preset;
 }
 function write(data){const merged=validate({...read(),...data});safeSet(KEY,JSON.stringify(merged));return merged}
 function replace(data){const normalized=validate(data);safeSet(KEY,JSON.stringify(normalized));return normalized}
 function notify(message,title='提示'){let box=document.getElementById('astral-toast');if(!box){box=document.createElement('div');box.id='astral-toast';Object.assign(box.style,{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',padding:'10px 18px',background:'var(--toast-bg,#20252ddd)',color:'var(--toast-text,white)',borderRadius:'8px',zIndex:'99999',maxWidth:'80vw',font:'14px sans-serif'});document.body.append(box)}box.textContent=title+'：'+String(message);box.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>box.hidden=true,4500)}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 return {read,write,replace,validate,safeGet,safeSet,initializeFromFile,restorePreset,clearRuntimeCaches,cacheGeneration,notify,download,favicon,setFavicon,discoverIcon,resolveIcon,exportSitesWithIcons,defaults:ASTRAL_DEFAULTS};
})();
