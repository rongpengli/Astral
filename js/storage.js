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
 const BUILD='27.31', BUILD_KEY='astral.web.code-version';
 // Invalidate ALL application-generated caches when code changes, not user data.
 // Settings, manually selected icons, custom CSS and location preferences survive.
 function invalidateCachesOnUpgrade(){
  try{
   const previous=localStorage.getItem(BUILD_KEY);
   if(previous===BUILD)return;
   const dataKey=localStorage.getItem(KEY);
   if(dataKey){
    try{
     const data=JSON.parse(dataKey);
     let changed=false;
     for(const group of (Array.isArray(data.sites)?data.sites:[]))for(const site of (Array.isArray(group.list)?group.list:[])){
      const icon=typeof site.icon==='string'?site.icon:'';
      let oldProvider=false;
      try{const host=new URL(icon).hostname.toLowerCase();oldProvider=['icons.duckduckgo.com','www.google.com','google.com','api.xinac.net'].includes(host)||host==='cravatar.com'||host.endsWith('.cravatar.com')}catch{}
      // Older builds didn't mark auto icons. Recognized provider URLs were generated
      // by the discovery pipeline, but explicit custom icons are left untouched.
      if(site.iconMode==='auto'||(site.iconMode!=='custom'&&oldProvider)){
       delete site.icon;site.iconMode='auto';changed=true;
      }
     }
     if(changed)localStorage.setItem(KEY,JSON.stringify(data));
    }catch(e){console.warn('自动图标缓存更新失败',e)}
   }
   const cacheKeys=['astral.weather.last-success.v1','astral.bing.metadata.v2','astral.wallpaper.current','astral.wallpaper.selection.v1'];
   for(const key of cacheKeys)localStorage.removeItem(key);
   // Reset the wallpaper blob cache as well; its content is regenerated on demand.
   if(typeof indexedDB!=='undefined')try{indexedDB.deleteDatabase('astral-wallpaper-v1')}catch{}
   // Keep geolocation rate limiting: it protects users from repeated permission prompts.
   localStorage.setItem(BUILD_KEY,BUILD);
  }catch(e){console.warn('版本缓存更新失败',e)}
 }
 invalidateCachesOnUpgrade();
 // Retired provider URLs may persist in imported legacy JSON.
 function retiredIconURL(value){
  if(typeof value!=='string'||!value.trim())return false;
  try{
   const host=new URL(value).hostname.toLowerCase();
   return host==='cravatar.com'||host.endsWith('.cravatar.com');
  }catch{return false}
 }
 function favicon(site, fallback){
  if(site && typeof site.icon==='string' && site.icon.trim())return site.icon.trim();
  try {const u=new URL(site.url);if(u.protocol==='https:'||u.protocol==='http:')return u.origin+'/favicon.ico'}catch{}
  return fallback;
 }
 // Resolve public favicons using independent providers concurrently.
 // The first successfully decoded image wins; private hosts never leave the browser.
 const iconLookups=new Map();
 function publicHost(url){
  try{
   const u=new URL(url);
   if(!['http:','https:'].includes(u.protocol)||privateIconURL(url)||isCC98URL(url))return null;
   return u.hostname;
  }catch{return null}
 }
 function probeIcon(url,timeout=4800){
  return new Promise((resolve,reject)=>{
   const image=new Image();let done=false;
   const finish=(ok)=>{if(done)return;done=true;clearTimeout(timer);image.onload=image.onerror=null;ok?resolve(url):reject(Error('图标加载失败'))};
   const timer=setTimeout(()=>finish(false),timeout);
   image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0);
   image.onerror=()=>finish(false);
   image.src=url;
  });
 }
 // HTML icon declarations can be inspected only when the site allows CORS.
 // Parse in an inert document; never execute remote scripts or load resources.
 async function declaredIcon(site){
  const u=new URL(site.url);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2600);
  try{
   const response=await fetch(u.href,{mode:'cors',credentials:'omit',redirect:'follow',signal:controller.signal});
   if(!response.ok)throw Error('页面不可读取');
   const type=response.headers.get('content-type')||'';
   if(!/text\/html|application\/xhtml\+xml/i.test(type))throw Error('非 HTML 页面');
   const html=(await response.text()).slice(0,256*1024);
   const doc=new DOMParser().parseFromString(html,'text/html');
   const base=doc.querySelector('base[href]');
   let baseURL=response.url||u.href;
   if(base){try{baseURL=new URL(base.getAttribute('href'),baseURL).href}catch{}}
   const icons=[...doc.querySelectorAll('link[rel][href]')].filter(link=>{
    const rel=(link.getAttribute('rel')||'').toLowerCase().split(/\s+/);
    return rel.includes('icon')||rel.includes('apple-touch-icon');
   }).sort((a,b)=>{
    const score=link=>{const rel=(link.getAttribute('rel')||'').toLowerCase();const type=(link.getAttribute('type')||'').toLowerCase();return (rel.includes('apple-touch')?0:10)+(type.includes('svg')?3:0)};
    return score(b)-score(a);
   });
   for(const link of icons.slice(0,6)){
    let candidate;try{candidate=new URL(link.getAttribute('href'),baseURL)}catch{continue}
    if(!['http:','https:'].includes(candidate.protocol))continue;
    // Never send an internal hostname to an unrelated public icon host.
    if((privateIconURL(site.url)||isCC98URL(site.url))&&candidate.hostname!==u.hostname&&!privateIconURL(candidate.href)&&!isCC98URL(candidate.href))continue;
    try{return await probeIcon(candidate.href,1800)}catch{}
   }
   return null;
  }catch{return null}finally{clearTimeout(timer)}
 }
 function discoverIcon(site){
  const host=publicHost(site.url);
  if(!host)return Promise.resolve(null);
  if(!iconLookups.has(host)){
   const full=encodeURIComponent(site.url);
   const candidates=[
    'https://www.google.com/s2/favicons?domain='+encodeURIComponent(host)+'&sz=64',
    'https://api.xinac.net/icon/?url='+full
   ];
   const task=Promise.any(candidates.map(url=>{
    // Google's missing-icon response can decode as a generic 16px globe.
    // Reject that fallback rather than caching it as a website icon.
    if(!url.startsWith('https://www.google.com/s2/'))return probeIcon(url);
    return new Promise((resolve,reject)=>{
     const img=new Image();let done=false;
     const finish=ok=>{if(done)return;done=true;clearTimeout(timer);img.onload=img.onerror=null;ok?resolve(url):reject(Error('Google 默认图标或加载失败'))};
     const timer=setTimeout(()=>finish(false),4800);
     img.onload=()=>finish(img.naturalWidth>16&&img.naturalHeight>16);
     img.onerror=()=>finish(false);img.src=url;
    });
   })).catch(()=>null).then(result=>{
    // A failed lookup is not a permanent negative cache. Retry on the next attempt.
    if(!result)iconLookups.delete(host);
    return result;
   });
   iconLookups.set(host,task);
  }
  return iconLookups.get(host);
 }
 function saveDiscoveredIcon(site,icon){
  try{
   const data=read();let changed=false;
   for(const group of data.sites)for(const entry of group.list){
    if(entry.url===site.url && (!entry.icon||entry.iconMode==='auto')){
     entry.icon=icon;entry.iconMode='auto';changed=true;
    }
   }
   if(changed)write({sites:data.sites});
  }catch(e){console.warn('图标地址未能保存',e)}
 }
 function siteFaviconURL(site){
  try{const u=new URL(site.url);return ['http:','https:'].includes(u.protocol)?u.origin+'/favicon.ico':null}catch{return null}
 }
 const iconResolutions=new Map();
 async function resolveIcon(site){
  const key=site.url;
  if(!iconResolutions.has(key)){
   const task=(async()=>{
    // The site-declared icon and conventional favicon race independently.
    const own=siteFaviconURL(site);
    const first=await Promise.any([
     declaredIcon(site).then(v=>v||Promise.reject(Error('无声明图标'))),
     own?probeIcon(own,3000):Promise.reject(Error('无 favicon'))
    ]).catch(()=>null);
    return first||await discoverIcon(site);
   })();
   iconResolutions.set(key,task.then(result=>{
    // Keep successful lookups for this page, but never cache failure across attempts.
    // A subsequent visit will always perform discovery again if no icon was found.
    if(!result)iconResolutions.delete(key);
    return result;
   },error=>{iconResolutions.delete(key);throw error}));
  }
  return iconResolutions.get(key);
 }
 function setFavicon(img,site,fallback){
  const candidate=favicon(site,fallback);
  let generation=0;
  function display(src){
   const token=++generation;
   img.onerror=()=>{if(token!==generation)return;img.onerror=null;img.src=fallback};
   img.src=src;
  }
  img.onerror=()=>{
   img.onerror=null;
   resolveIcon(site).then(found=>{
    if(!img.isConnected)return;
    if(found){display(found);if(!site.icon||site.iconMode==='auto')saveDiscoveredIcon(site,found)}
    else display(fallback);
   }).catch(()=>{if(img.isConnected)display(fallback)});
  };
  // For entries with no icon, still resolve HTML-declared icons; /favicon.ico
  // is displayed immediately while discovery continues in the background.
  img.src=candidate;
  if(!site.icon||site.iconMode==='auto'){
   resolveIcon(site).then(found=>{
    if(!found||!img.isConnected)return;
    display(found);
    if(found!==site.icon)saveDiscoveredIcon(site,found);
   }).catch(()=>{});
  }
  return candidate;
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
    return {...item,title:String(item.title??''),url:String(item.url??''),icon:obsolete?'':icon,iconMode:obsolete?'auto':(item.iconMode==='auto'?'auto':'custom')};
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
 async function restorePreset(){
  const preset=await readPreset();
  safeSet(KEY,JSON.stringify(preset));
  return preset;
 }
 function write(data){const merged=validate({...read(),...data});safeSet(KEY,JSON.stringify(merged));return merged}
 function replace(data){const normalized=validate(data);safeSet(KEY,JSON.stringify(normalized));return normalized}
 function notify(message,title='提示'){let box=document.getElementById('astral-toast');if(!box){box=document.createElement('div');box.id='astral-toast';Object.assign(box.style,{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',padding:'10px 18px',background:'var(--toast-bg,#20252ddd)',color:'var(--toast-text,white)',borderRadius:'8px',zIndex:'99999',maxWidth:'80vw',font:'14px sans-serif'});document.body.append(box)}box.textContent=title+'：'+String(message);box.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>box.hidden=true,4500)}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 return {read,write,replace,validate,safeGet,safeSet,initializeFromFile,restorePreset,notify,download,favicon,setFavicon,discoverIcon,resolveIcon,exportSitesWithIcons,defaults:ASTRAL_DEFAULTS};
})();
