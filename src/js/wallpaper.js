/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
**************************************************/
'use strict';
const AstralWallpaper=(()=>{
 const DB='astral-wallpaper-v1', STORE='images', META='astral.bing.metadata.v2', CURRENT='astral.wallpaper.current';
 const TTL=60*60*1000, GENERATION='astral.cache.generation';
 const generation=()=>localStorage.getItem(GENERATION)||'0';
 let bingController=new AbortController();
 function setBingEnabled(enabled){
  if(!enabled)bingController.abort();
  else if(bingController.signal.aborted)bingController=new AbortController();
 }
 let activeUrl=null,hasWallpaper=false,displaySerial=0,fadeTimer=null,fadeOverlay=null;
 function begin(){++displaySerial;clearTimeout(fadeTimer);fadeOverlay?.remove();fadeOverlay=null;return displaySerial}
 function current(token){return token===displaySerial}
 const MAX_CACHE_BYTES=80*1024*1024,MAX_IMAGE_BYTES=15*1024*1024;
 function db(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window))return reject(Error('IndexedDB unavailable'));const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
 async function get(key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result?.blob||r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>d.close()})}
 const POLICY='astral.wallpaper.cache-policy.v1';
 function cachePolicy(config){
  return JSON.stringify([Math.min(8,Math.max(1,Math.trunc(Number(config.bingMaxHistory))||1)),config.useBigImage]);
 }
 async function configure(config,reset=false){
  const policy=cachePolicy(config);
  if(!reset&&localStorage.getItem(POLICY)===policy)return;
  localStorage.setItem(POLICY,policy);
  if(reset){
   localStorage.removeItem('astral.wallpaper.selection.v1');
   const cached=cacheRead();
   if(cached)localStorage.setItem(META,JSON.stringify({...cached,updated:0}));
  }
  try{await updateCache()}catch(error){
   if(localStorage.getItem(POLICY)===policy)localStorage.removeItem(POLICY);
   throw error;
  }
 }
 async function updateCache(key,value,started=generation()){
  if(started!==generation())return;
  if(key&&(!(value instanceof Blob)||!value.type.startsWith('image/')||!value.size||value.size>MAX_IMAGE_BYTES))return;
  const database=await db();
  if(started!==generation()){database.close();return}
  try{
   await new Promise((resolve,reject)=>{
    const transaction=database.transaction(STORE,'readwrite');
    const images=transaction.objectStore(STORE),records=[];
    transaction.oncomplete=resolve;
    transaction.onabort=()=>reject(transaction.error||Error('壁纸缓存写入失败'));
    const request=images.openCursor();
    request.onsuccess=()=>{
     const cursor=request.result;
     if(cursor){
      if(cursor.key!==key){
       const record=cursor.value;
       records.push({key:cursor.key,size:(record.blob||record).size,at:record.at||0});
      }
      cursor.continue();return;
     }
     if(started!==generation()){transaction.abort();return}
     const [limit,size]=JSON.parse(localStorage.getItem(POLICY)||cachePolicy(AstralStore.read().config));
     const recent=(cacheRead()?.images||[]).slice(0,limit).map(entry=>urlFor(entry,size));
     const rank=url=>{const index=recent.indexOf(url);return index<0?limit:index};
     if(key)records.push({key,size:value.size,at:Date.now()});
     records.sort((a,b)=>rank(a.key)-rank(b.key)||b.at-a.at);
     let count=0,bytes=0;
     for(const record of records){
      if(count>=limit||bytes+record.size>MAX_CACHE_BYTES){images.delete(record.key);continue}
      count++;bytes+=record.size;
      if(record.key===key)images.put({blob:value,at:record.at},key);
     }
    };
   });
  }finally{database.close()}
 }
 async function request(url,timeout=6500){const signal=AbortSignal.any([bingController.signal,AbortSignal.timeout(timeout)]);const r=await fetch(url,{signal,cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
 function valid(e){return !!(e&&typeof e.urlbase==='string'&&/^\/th\?id=OHR\.[A-Za-z0-9_-]+(?:\.jpg)?$/i.test(e.urlbase))}
 function normalize(data){if(!data||!Array.isArray(data.images))throw Error('Bing metadata missing images');return data.images.filter(valid).map(e=>({urlbase:e.urlbase,enddate:String(e.enddate||''),copyright:String(e.copyright||'')}))}
 function normalizeAlternate(data){if(data&&Array.isArray(data.images))return normalize(data);const raw=data&&(data.url||data.image||data.imgurl);if(typeof raw!=='string')throw Error('Invalid alternate response');const u=new URL(raw);if(u.protocol!=='https:'||!/(^|\.)bing\.com$/.test(u.hostname))throw Error('Invalid image host');const id=u.searchParams.get('id');const match=(id||'').match(/^(OHR\.[A-Za-z0-9_-]+?)(?:_(?:UHD|1920x1080|1366x768))?\.jpg$/i);if(!match)throw Error('Invalid image id');return [{urlbase:'/th?id='+match[1],enddate:String(data.enddate||data.date||''),copyright:String(data.copyright||'')}];}
 function cacheRead(){try{const c=JSON.parse(localStorage.getItem(META)||'null');if(c&&Array.isArray(c.images)){const images=c.images.filter(valid);if(images.length)return {updated:Number(c.updated)||0,images}}}catch{}return null}
 function cacheWrite(images){try{localStorage.setItem(META,JSON.stringify({updated:Date.now(),images}))}catch{}}
 async function metadata(count=8,force=false){const started=generation();const signal=bingController.signal;signal.throwIfAborted();const n=Math.max(1,Math.min(8,Number(count)||8)),cached=cacheRead();if(!force&&cached&&Date.now()-cached.updated<TTL&&cached.images.length>=n)return cached.images.slice(0,n);
  const bing='https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n='+n+'&mkt=zh-CN';
  // The Bing JSON endpoint does not expose CORS. A public CORS proxy is attempted first;
  // direct Bing is a best-effort fallback for environments where it is allowed.
  try{const direct=normalize(await request(bing,4500));if(direct.length>=n){if(started===generation())cacheWrite(direct);return direct.slice(0,n)}}catch{}
  signal.throwIfAborted();
  const sources=[
   ()=>request('https://api.allorigins.win/raw?url='+encodeURIComponent(bing),5500),
   ()=>request('https://proxy.cors.dev/'+bing,5500),
   ()=>request(bing,4000),
   ()=>request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n='+n+'&mkt=zh-CN',4000),
   ()=>request('https://bing.lkin.cn/?region=cn',5500)
  ];
  try{const images=await Promise.any(sources.map(async (source,i)=>{const data=await source();const found=i===4?normalizeAlternate(data):normalize(data);if(found.length<n)throw Error('Bing 返回的历史壁纸数量不足');return found}));if(started===generation())cacheWrite(images);return images.slice(0,n)}catch{}
  // Last known metadata is usable even if stale; never erase it after network failure.
  signal.throwIfAborted();
  if(cached)return cached.images.slice(0,n);
  throw Error('无法获取最新 Bing 壁纸：跨域代理或网络不可用');
 }
 function urlFor(entry,size){if(!valid(entry))throw Error('Invalid wallpaper');return 'https://www.bing.com'+entry.urlbase.replace(/\.jpg$/i,'')+(['_1366x768.jpg','_1920x1080.jpg','_UHD.jpg'][size]||'_UHD.jpg')}
 function nameFor(entry){const title=String(entry.copyright||'').replace(/\(.*?\)/g,'').trim().replace(/[\\/\*|]/g,'').replace(/:/g,'：').replace(/\?/g,'？').replace(/["<>]/g,"'").replace(/[\x00-\x1f]/g,'').slice(0,140);return (entry.enddate||'bing')+(title?'-'+title:'')+'.jpg'}
 function preload(src,signal=bingController.signal){
  return new Promise((resolve,reject)=>{
   if(signal?.aborted){reject(signal.reason);return}
   const img=new Image();
   const finish=error=>{
    clearTimeout(timer);
    signal?.removeEventListener('abort',abort);
    img.onload=img.onerror=null;
    if(error){img.removeAttribute('src');reject(error)}else resolve();
   };
   const abort=()=>finish(signal.reason);
   const timer=setTimeout(()=>finish(Error('壁纸图片加载超时')),12000);
   signal?.addEventListener('abort',abort,{once:true});
   img.onload=()=>finish();img.onerror=()=>finish(Error('壁纸图片加载失败'));img.src=src;
  });
 }
 function backgroundLayer(){
  let el=document.getElementById('astral-wallpaper-layer');
  if(!el){el=document.createElement('div');el.id='astral-wallpaper-layer';
   Object.assign(el.style,{position:'fixed',inset:'0',zIndex:'0',pointerEvents:'none',backgroundPosition:'center',backgroundSize:'cover',backgroundRepeat:'no-repeat',backgroundColor:'#e5e5e5'});
   document.body.prepend(el);
  }
  return el;
 }
 function showGradient(token){
  if(!current(token))return;
  const layer=backgroundLayer();
  layer.dataset.gradient='';
  layer.style.removeProperty('background-image');
  if(activeUrl)URL.revokeObjectURL(activeUrl);
  activeUrl=null;
  hasWallpaper=false;
 }
 function apply(url,blob,token){
  if(!current(token))return false;
  const next=blob?URL.createObjectURL(blob):url,previous=activeUrl,layer=backgroundLayer(),oldImage=layer.style.backgroundImage;
  clearTimeout(fadeTimer);fadeOverlay?.remove();fadeOverlay=null;
  delete layer.dataset.gradient;
  layer.style.backgroundImage=`url("${next}")`;
  if(hasWallpaper&&oldImage&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   const overlay=document.createElement('div');overlay.className='astral-wallpaper-fade';
   Object.assign(overlay.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'0',backgroundImage:oldImage,backgroundPosition:'center',backgroundSize:'cover',backgroundRepeat:'no-repeat',opacity:'1',transition:'opacity 250ms ease'});
   layer.after(overlay);fadeOverlay=overlay;
   requestAnimationFrame(()=>requestAnimationFrame(()=>{if(current(token))overlay.style.opacity='0'}));
   fadeTimer=setTimeout(()=>{overlay.remove();if(fadeOverlay===overlay)fadeOverlay=null},330);
  }
  activeUrl=blob?next:null;hasWallpaper=true;
  if(previous&&previous!==next)setTimeout(()=>URL.revokeObjectURL(previous),15000);
  return true;
 }
 async function show(entry,size,token=begin()){
  const url=urlFor(entry,size),name=nameFor(entry);let blob=null;try{blob=await get(url)}catch{}
  if(!current(token))return false;
  if(blob){const objectUrl=URL.createObjectURL(blob);try{await preload(objectUrl)}catch{if(!current(token))return false;blob=null;await preload(url)}finally{URL.revokeObjectURL(objectUrl)}}else await preload(url);
  if(!apply(url,blob,token))return false;
  try{localStorage.setItem(CURRENT,JSON.stringify({url,name,enddate:entry.enddate||'',copyright:entry.copyright||'',size}))}catch{}
  if(!blob){const started=generation();fetch(url,{credentials:'omit',signal:bingController.signal}).then(r=>{if(!r.ok)throw Error('image HTTP '+r.status);return r.blob()}).then(b=>{if(b.type.startsWith('image/'))return updateCache(url,b,started)}).catch(()=>{});}
  chrome.runtime.sendMessage({type:'ASTRAL_WALLPAPER_SHOWN',url,name}).catch(()=>{});
  return {url,name,blob};
 }
 // Fill the selected history in the background, one image at a time.
 const pendingCache=new Map();
 async function cacheHistory(entries,size,token){
  for(const entry of entries){
   if(!current(token))return;
   const url=urlFor(entry,size);
   try{
    if(await get(url))continue;
    if(!current(token))return;
    if(!pendingCache.has(url)){
     const started=generation();
     const task=fetch(url,{credentials:'omit',signal:bingController.signal}).then(async response=>{
      if(response.ok)await updateCache(url,await response.blob(),started);
     }).finally(()=>pendingCache.delete(url));
     pendingCache.set(url,task);
    }
    await pendingCache.get(url);
   }catch{/* Keep the remaining cached days usable if one request fails. */}
  }
 }
 async function fromHistory(count,size,advance,token){
  const entries=(cacheRead()?.images||[]).slice(0,count);
  const saved=JSON.parse(localStorage.getItem(CURRENT)||'null');
  const selected=entries.findIndex(entry=>urlFor(entry,size)===saved?.url);
  const start=selected<0?0:selected+Number(advance);
  for(let i=0;i<entries.length;i++){
   const entry=entries[(start+i)%entries.length],url=urlFor(entry,size);
   const blob=await get(url).catch(()=>null);
   if(!current(token))return false;
   if(!blob)continue;
   if(!apply(url,blob,token))return false;
   localStorage.setItem(CURRENT,JSON.stringify({url,name:nameFor(entry),size,enddate:entry.enddate}));
   return true;
  }
  return false;
 }
 async function restore(token=begin(),cacheOnly=false){
  let saved;try{saved=JSON.parse(localStorage.getItem(CURRENT)||'null')}catch{}
  if(!saved||saved.custom||typeof saved.url!=='string'||!(/^https:\/\/(?:cn\.|www\.)?bing\.com\/th\?id=OHR\.[A-Za-z0-9_-]+_(?:UHD|1920x1080|1366x768)\.jpg$/.test(saved.url)||(/^https:\/\/(?:bing\.img\.run|api\.dujin\.org)\/bing\/(?:1366x768|1920x1080)\.php$/.test(saved.url))||(/^https:\/\/bing\.img\.run\/(?:1366x768|1920x1080)\.php$/.test(saved.url))))return false;
  let blob=null;try{blob=await get(saved.url)}catch{}
  if(!current(token))return false;
  if(cacheOnly&&!blob)return false;
  const test=blob?URL.createObjectURL(blob):saved.url;
  try{await preload(test)}catch{return false}finally{if(blob)URL.revokeObjectURL(test)}
  return apply(saved.url,blob,token);
 }
 async function resizeCurrent(size,token=begin()){
  let saved;try{saved=JSON.parse(localStorage.getItem(CURRENT)||'null')}catch{}
  if(!saved||saved.custom)return false;
  const match=saved.url?.match(/^https:\/\/(?:cn\.|www\.)?bing\.com\/th\?id=(OHR\.[A-Za-z0-9_-]+)_(?:UHD|1920x1080|1366x768)\.jpg$/);
  if(!match)return false;
  const entry={urlbase:'/th?id='+match[1],enddate:saved.enddate||'',copyright:saved.copyright||''};
  if(saved.url===urlFor(entry,size)&&backgroundLayer().style.backgroundImage)return true;
  return !!await show(entry,size,token);
 }
 // Static-host fallback: public daily-image services return an image rather than JSON.
 // This is used only when all Bing metadata providers fail (not a history API).
 async function showDailyFallback(size,token=begin()){
  const sizeName=(["1366x768","1920x1080","1920x1080"][Number(size)]||"1920x1080");
  const urls=[
   'https://bing.img.run/'+sizeName+'.php',
   'https://api.dujin.org/bing/'+sizeName+'.php'
  ];
  for(const url of urls){
   if(!current(token))return false;
   try{
    await preload(url);
    if(!apply(url,null,token))return false;
    try{localStorage.setItem(CURRENT,JSON.stringify({url,name:'bing-daily-fallback',size,source:'daily-fallback'}))}catch{}
    return true;
   }catch{}
  }
  return false;
 }
 async function showIfNew(entry,size,token=begin()){
  if(!current(token))return false;
  const url=urlFor(entry,size);
  let saved;try{saved=JSON.parse(localStorage.getItem(CURRENT)||'null')}catch{}
  if(saved&&saved.url===url&&backgroundLayer().style.backgroundImage)return false;
  return !!await show(entry,size,token);
 }
 async function showCustom(url,name=null,token=begin()){
  if(!/^https?:\/\//i.test(url)&&!/^data:image\//i.test(url))throw Error('自定义壁纸需要 HTTP(S) 图片地址或图片 Data URL');
  await preload(url,null);
  if(!apply(url,null,token))return false;
  // The custom image is already in chrome.storage.local. Keep only the legacy pin here.
  if(name)localStorage.setItem(CURRENT,JSON.stringify({url,name,custom:true}));
  return true;
 }
 return {configure,begin,current,showGradient,setBingEnabled,cacheHistory,fromHistory,resizeCurrent,showCustom,metadata,show,restore,showIfNew,showDailyFallback,hasWallpaper:()=>hasWallpaper};
})();
