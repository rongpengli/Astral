/* Shared, versioned local configuration; obsolete weather fields are discarded. */
'use strict';
const AstralStore=(()=>{
 const KEY='astral.web.settings.v1';
 const BUILD='1.12.5-import2';
 const {validate}=AstralSchema;
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
 // All extension pages load the same inert HTML icon extractor.
 async function declaredIcon(site){
  const candidates=await AstralIcons.discover(site.url);
  for(const url of candidates){try{return await probeIcon(url,1800)}catch{}}
  return null;
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
 // Discovered icons are generated cache, never user settings or sync edits.
 const ICON_CACHE='astral.extension.icons.v2';
 let iconCache={};try{iconCache=JSON.parse(localStorage.getItem(ICON_CACHE)||'{}')}catch{}
 function saveDiscoveredIcon(site,icon){
  if(iconCache[site.url]===icon)return;
  iconCache[site.url]=icon;
  const keys=Object.keys(iconCache);for(const key of keys.slice(0,Math.max(0,keys.length-512)))delete iconCache[key];
  try{localStorage.setItem(ICON_CACHE,JSON.stringify(iconCache))}catch{}
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
  const custom=site.iconMode==='custom'&&!!site.icon;
  const candidate=custom?site.icon:(iconCache[site.url]||site.icon||siteFaviconURL(site)||fallback);
  let recovering=false;
  img.onload=()=>{if(!custom&&img.src!==fallback&&!recovering)saveDiscoveredIcon(site,candidate)};
  img.onerror=async()=>{
   if(recovering||custom){img.onload=img.onerror=null;if(img.getAttribute('src')!==fallback)img.src=fallback;return}
   recovering=true;delete iconCache[site.url];
   const found=await resolveIcon(site).catch(()=>null);
   if(!img.isConnected)return;
   img.onload=img.onerror=null;
   if(found){saveDiscoveredIcon(site,found);img.onerror=()=>{img.onerror=null;img.src=fallback};img.src=found}
   else img.src=fallback;
  };
  img.src=candidate;
  return candidate;
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
 function safeGet(key){try{return localStorage.getItem(key)}catch(e){console.warn('存储不可读取',e);return null}}
 function safeSet(key,value){try{localStorage.setItem(key,value)}catch(e){throw Error('浏览器无法保存设置：'+(e.message||e))}}
 let snapshot=validate({}), pending=Promise.resolve(), initialized=false, writes=0;
 const KEYS=['config','sites','css'];
 const ready=(async()=>{
  let raw=await chrome.storage.local.get([...KEYS,'__astralExtensionBuild','__astralBefore1125']);
  const complete=raw.config&&Array.isArray(raw.sites)&&raw.css&&
   Object.keys(ASTRAL_DEFAULTS.config).every(key=>Object.hasOwn(raw.config,key));
  if(!complete)await AstralSchema.loadDefaults();
  if(raw.__astralExtensionBuild!==BUILD){
   // Retain an exact, local pre-upgrade snapshot, including obsolete wallpaper fields.
   await chrome.storage.local.set({__astralBefore1125:raw.__astralBefore1125||{at:Date.now(),config:raw.config||{},sites:raw.sites||[],css:raw.css||{}},__astralExtensionBuild:BUILD});
   for(const key of ['astral.weather.last-success.v1','astral.bing.metadata.v2','astral.wallpaper.current','astral.wallpaper.selection.v1','astral.extension.icons.v2'])localStorage.removeItem(key);
   try{indexedDB.deleteDatabase('astral-wallpaper-v1')}catch{}
   iconCache={};
   if(localStorage.getItem('astral.wallpaper.legacy-pin')===null)localStorage.setItem('astral.wallpaper.legacy-pin',AstralCompat.config(raw.config||{}).autoChange===false&&localStorage.getItem('imageSrc')?'1':'0');
  }
  if(!raw.config||!Array.isArray(raw.sites)||!raw.css){
   const result=await chrome.runtime.sendMessage({type:'ASTRAL_LOCAL_READY'});
   if(!result?.ok)throw Error(result?.error||'配置初始化失败');
  }
  raw=await chrome.storage.local.get(KEYS);
  const canonical=AstralCompat.storage(validate(raw).config);delete canonical.syncEnabled;if(!AstralCompat.equal(canonical,raw.config||{})){await chrome.storage.local.set({config:canonical});raw.config=canonical}
  snapshot=validate(raw);initialized=true;
  // Render the local snapshot now. Later cloud changes arrive through onChanged.
  void chrome.runtime.sendMessage({type:'ASTRAL_SYNC_READY'}).catch(error=>console.info('后台同步初始化未成功',error));
  // Do not rewrite settings on every new tab or invalidate a sync merge base.
  return snapshot;
 })();
 function read(){if(!initialized)throw Error('配置尚未加载');return structuredClone(snapshot)}
 function persist(data){
  const before=read();const normalized=validate({...before,...data});
  const patch={};for(const key of KEYS)if(Object.hasOwn(data,key))patch[key]=key==='config'?AstralCompat.storage(normalized.config):normalized[key];
  for(const key of Object.keys(patch))if(AstralCompat.equal(key==='config'?AstralCompat.storage(before.config):before[key],patch[key]))delete patch[key];
  if(!Object.keys(patch).length)return read();
  snapshot=normalized;writes++;
  const operation=pending.catch(()=>{}).then(()=>chrome.storage.local.set(patch));
  pending=operation;
  operation.finally(async()=>{
   writes--;if(writes)return;
   const current=await chrome.storage.local.get(KEYS);if(writes)return;
   const normalized=validate(current);
   if(!AstralCompat.equal(snapshot,normalized)){snapshot=normalized;dispatchEvent(new StorageEvent('storage',{key:KEY}))}
  }).catch(()=>{});
  operation.then(()=>{const el=document.getElementById('save-status');if(el)el.textContent='已保存'},error=>{const el=document.getElementById('save-status');if(el)el.textContent='保存失败';notify(error.message||String(error),'配置保存失败');});
  return read();
 }
 function write(data){return persist(data)}
 async function importData(data){
  await flush();const normalized=validate(data);
  const result=await chrome.runtime.sendMessage({type:'ASTRAL_IMPORT_CONFIG',data:{...normalized,config:AstralCompat.storage(normalized.config)}});
  if(!result?.ok)throw Error(result?.error||'导入失败');
  try{if(result.uploadError)await chrome.storage.local.set({__astralImportFailure:{kind:'cloud',message:result.uploadError,at:Date.now()}});else await chrome.storage.local.remove(['__astralImportFailure'])}catch{}
  snapshot=validate(await chrome.storage.local.get(KEYS));return {...read(),importOutcome:{uploaded:!!result.uploaded,uploadError:result.uploadError||null}};
 }
 async function restorePreset(){
  await flush();
  const result=await chrome.runtime.sendMessage({type:'ASTRAL_SYNC_COMMAND',action:'defaults'});
  if(!result?.ok)throw Error(result?.error||'恢复默认失败');
  localStorage.removeItem('astral.wallpaper.legacy-pin');
  snapshot=validate(await chrome.storage.local.get(KEYS));
  return {...read(),uploadError:result.uploadError};
 }
 async function flush(){await pending}
 chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local'||!initialized||writes)return;
  const next=structuredClone(snapshot);let changed=false;
  for(const key of KEYS)if(key in changes){const value=changes[key].newValue;if(!AstralCompat.equal(snapshot[key],value)){next[key]=value;changed=true}}
  if(!changed)return;
  try{snapshot=validate(next);dispatchEvent(new StorageEvent('storage',{key:KEY}));}catch(e){notify(e.message,'配置更新失败')}
 });
 function notify(message,title='提示'){let box=document.getElementById('astral-toast');if(!box){box=document.createElement('div');box.id='astral-toast';Object.assign(box.style,{position:'fixed',bottom:'24px',left:'50%',transform:'translateX(-50%)',padding:'10px 18px',background:'var(--toast-bg,#20252ddd)',color:'var(--toast-text,white)',borderRadius:'8px',zIndex:'99999',maxWidth:'80vw',font:'14px sans-serif'});document.body.append(box)}box.textContent=title+'：'+String(message);box.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>box.hidden=true,4500)}
 function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 return {ready,flush,restorePreset,importData,read,write,validate,safeGet,safeSet,notify,download,setFavicon,resolveIcon,exportSitesWithIcons,defaults:ASTRAL_DEFAULTS};
})();
