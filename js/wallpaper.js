/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
**************************************************/
'use strict';
const AstralWallpaper=(()=>{
 const DB='astral-wallpaper', STORE='images', META='astral.bing.metadata', CURRENT='astral.wallpaper.current';
 const TTL=60*60*1000;
 let activeUrl=null,hasWallpaper=false;
 const MAX_CACHE_BYTES=80*1024*1024,MAX_IMAGE_BYTES=15*1024*1024;
 function db(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window))return reject(Error('IndexedDB unavailable'));const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
 async function get(key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result?.blob||r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>d.close()})}
 const POLICY='astral.wallpaper.cache-policy';
 function cachePolicy(config){
  return JSON.stringify([Math.min(8,Math.max(1,Math.trunc(Number(config.bingMaxHistory))||1)),config.useBigImage]);
 }
 async function configure(config,reset=false){
  const policy=cachePolicy(config);
  if(!reset&&localStorage.getItem(POLICY)===policy)return;
  localStorage.setItem(POLICY,policy);
  if(reset){
   localStorage.removeItem('astral.wallpaper.selection');
   const cached=cacheRead();
   if(cached)localStorage.setItem(META,JSON.stringify({...cached,updated:0}));
  }
  try{await updateCache()}catch(error){
   if(localStorage.getItem(POLICY)===policy)localStorage.removeItem(POLICY);
   throw error;
  }
 }
 async function updateCache(key,value,started=AstralStore.cacheGeneration()){
  if(started!==AstralStore.cacheGeneration())return;
  if(key&&(!(value instanceof Blob)||!value.type.startsWith('image/')||!value.size||value.size>MAX_IMAGE_BYTES))return;
  const database=await db();
  if(started!==AstralStore.cacheGeneration()){database.close();return}
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
     if(started!==AstralStore.cacheGeneration())return;
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
 async function request(url,timeout=6500){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const r=await fetch(url,{signal:controller.signal,cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timer)}}
 function valid(e){return !!(e&&typeof e.urlbase==='string'&&/^\/th\?id=OHR\.[A-Za-z0-9_-]+(?:\.jpg)?$/i.test(e.urlbase))}
 function normalize(data){if(!data||!Array.isArray(data.images))throw Error('Bing metadata missing images');return data.images.filter(valid).map(e=>({urlbase:e.urlbase,enddate:String(e.enddate||''),copyright:String(e.copyright||'')}))}
 function normalizeAlternate(data){if(data&&Array.isArray(data.images))return normalize(data);const raw=data&&(data.url||data.image||data.imgurl);if(typeof raw!=='string')throw Error('Invalid alternate response');const u=new URL(raw);if(u.protocol!=='https:'||!/(^|\.)bing\.com$/.test(u.hostname))throw Error('Invalid image host');const id=u.searchParams.get('id');const match=(id||'').match(/^(OHR\.[A-Za-z0-9_-]+?)(?:_(?:UHD|1920x1080|1366x768))?\.jpg$/i);if(!match)throw Error('Invalid image id');return [{urlbase:'/th?id='+match[1],enddate:String(data.enddate||data.date||''),copyright:String(data.copyright||'')}];}
 function cacheRead(){try{const c=JSON.parse(localStorage.getItem(META)||'null');if(c&&Array.isArray(c.images)){const images=c.images.filter(valid);if(images.length)return {updated:Number(c.updated)||0,images}}}catch{}return null}
 function cacheWrite(images){try{localStorage.setItem(META,JSON.stringify({updated:Date.now(),images}))}catch{}}
 async function metadata(count=8,force=false){const started=AstralStore.cacheGeneration();const n=Math.max(1,Math.min(8,Number(count)||8)),cached=cacheRead();if(!force&&cached&&Date.now()-cached.updated<TTL&&cached.images.length>=n)return cached.images.slice(0,n);
  const bing='https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n='+n+'&mkt=zh-CN';
  // The Bing JSON endpoint does not expose CORS. A public CORS proxy is attempted first;
  // direct Bing is a best-effort fallback for environments where it is allowed.
  const sources=[
   ()=>request('https://api.allorigins.win/raw?url='+encodeURIComponent(bing),5500),
   ()=>request('https://proxy.cors.dev/'+bing,5500),
   ()=>request(bing,4000),
   ()=>request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n='+n+'&mkt=zh-CN',4000),
   ()=>request('https://bing.lkin.cn/?region=cn',5500)
  ];
  try{const images=await Promise.any(sources.map(async (source,i)=>{const data=await source();const found=i===4?normalizeAlternate(data):normalize(data);if(found.length<n)throw Error('Bing 返回的历史壁纸数量不足');return found}));if(started===AstralStore.cacheGeneration())cacheWrite(images);return images.slice(0,n)}catch{}
  // Last known metadata is usable even if stale; never erase it after network failure.
  if(cached)return cached.images.slice(0,n);
  throw Error('无法获取最新 Bing 壁纸：跨域代理或网络不可用');
 }
 function urlFor(entry,size){if(!valid(entry))throw Error('Invalid wallpaper');return 'https://www.bing.com'+entry.urlbase.replace(/\.jpg$/i,'')+(['_1366x768.jpg','_1920x1080.jpg','_UHD.jpg'][size]||'_UHD.jpg')}
 function nameFor(entry){return (entry.enddate||"bing")+".jpg"}
 function preload(src){return new Promise((resolve,reject)=>{const img=new Image();const timer=setTimeout(()=>{img.onload=img.onerror=null;reject(Error('壁纸图片加载超时'))},12000);img.onload=()=>{clearTimeout(timer);resolve()};img.onerror=()=>{clearTimeout(timer);reject(Error('壁纸图片加载失败'))};img.src=src})}
 function backgroundLayer(){
  let el=document.getElementById('astral-wallpaper-layer');
  if(!el){el=document.createElement('div');el.id='astral-wallpaper-layer';
   Object.assign(el.style,{position:'fixed',inset:'0',zIndex:'0',pointerEvents:'none',backgroundPosition:'center',backgroundSize:'cover',backgroundRepeat:'no-repeat',backgroundColor:'#e5e5e5'});
   document.body.prepend(el);
  }
  return el;
 }
 function apply(url,blob){
  const next=blob?URL.createObjectURL(blob):url;
  const previous=activeUrl;
  const layer=backgroundLayer();
  const oldImage=layer.style.backgroundImage;
  // The new image has already been preloaded. Fade a temporary overlay over the old one.
  if(hasWallpaper && oldImage && !matchMedia('(prefers-reduced-motion: reduce)').matches){
   const overlay=document.createElement('div');
   overlay.className='astral-wallpaper-fade';
   Object.assign(overlay.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'0',backgroundImage:`url("${next}")`,backgroundPosition:'center',backgroundSize:'cover',backgroundRepeat:'no-repeat',opacity:'0',transition:'opacity 250ms ease'});
   layer.after(overlay);
   requestAnimationFrame(()=>requestAnimationFrame(()=>{overlay.style.opacity='1'}));
   setTimeout(()=>{layer.style.backgroundImage=`url("${next}")`;overlay.remove()},330);
  }else{layer.style.backgroundImage=`url("${next}")`}
  activeUrl=blob?next:null;hasWallpaper=true;
  if(previous&&previous!==next)setTimeout(()=>URL.revokeObjectURL(previous),15000);
 }
 async function show(entry,size){const url=urlFor(entry,size),name=nameFor(entry);let blob=null;try{blob=await get(url)}catch{}if(blob){const objectUrl=URL.createObjectURL(blob);try{await preload(objectUrl)}catch{blob=null;await preload(url)}finally{URL.revokeObjectURL(objectUrl)}}else{await preload(url)}
  apply(url,blob);try{localStorage.setItem(CURRENT,JSON.stringify({url,name,enddate:entry.enddate||'',size}))}catch{}
  // Fetch for offline caching only after successful display; failures do not hide the wallpaper.
  const started=AstralStore.cacheGeneration();
  if(!blob)fetch(url,{credentials:'omit'}).then(r=>{if(!r.ok)throw Error('image HTTP '+r.status);return r.blob()}).then(b=>{if(b.type.startsWith('image/'))return updateCache(url,b,started)}).catch(()=>{});
  return {url,name,blob};
 }
 async function restore(){let saved;try{saved=JSON.parse(localStorage.getItem(CURRENT)||'null')}catch{}if(!saved||typeof saved.url!=='string'||!(/^https:\/\/(?:cn\.|www\.)?bing\.com\/th\?id=OHR\.[A-Za-z0-9_-]+_(?:UHD|1920x1080|1366x768)\.jpg$/.test(saved.url)||(/^https:\/\/(?:bing\.img\.run|api\.dujin\.org)\/bing\/(?:1366x768|1920x1080)\.php$/.test(saved.url))||(/^https:\/\/bing\.img\.run\/(?:1366x768|1920x1080)\.php$/.test(saved.url))))return false;let blob=null;try{blob=await get(saved.url)}catch{}const test=blob?URL.createObjectURL(blob):saved.url;try{await preload(test)}catch{return false}finally{if(blob)URL.revokeObjectURL(test)}apply(saved.url,blob);return true}
 // Static-host fallback: public daily-image services return an image rather than JSON.
 // This is used only when all Bing metadata providers fail (not a history API).
 async function showDailyFallback(size){
  const sizeName=(["1366x768","1920x1080","1920x1080"][Number(size)]||"1920x1080");
  const urls=[
   'https://bing.img.run/'+sizeName+'.php',
   'https://api.dujin.org/bing/'+sizeName+'.php'
  ];
  for(const url of urls){
   try{
    await preload(url);
    apply(url,null);
    try{localStorage.setItem(CURRENT,JSON.stringify({url,name:'bing-daily-fallback',size,source:'daily-fallback'}))}catch{}
    return true;
   }catch{}
  }
  return false;
 }
 async function showIfNew(entry,size){
  const url=urlFor(entry,size);
  let saved;try{saved=JSON.parse(localStorage.getItem(CURRENT)||'null')}catch{}
  if(saved&&saved.url===url&&backgroundLayer().style.backgroundImage)return false;
  await show(entry,size);
  return true;
 }
 return {configure,metadata,show,restore,showIfNew,showDailyFallback,hasWallpaper:()=>hasWallpaper};
})();
