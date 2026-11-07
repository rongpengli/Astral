/* Bing recent wallpapers for static hosting: CORS-aware metadata, validated fallback and IndexedDB cache. */
'use strict';
const AstralWallpaper=(()=>{
 const DB='astral-wallpaper-v1', STORE='images', META='astral.bing.metadata.v2', CURRENT='astral.wallpaper.current';
 const TTL=60*60*1000;
 let activeUrl=null,hasWallpaper=false,displaySerial=0,fadeTimer=null,fadeOverlay=null;
 function begin(){++displaySerial;clearTimeout(fadeTimer);fadeOverlay?.remove();fadeOverlay=null;return displaySerial}
 function current(token){return token===displaySerial}
 const MAX_CACHE_ITEMS=16,MAX_CACHE_BYTES=80*1024*1024,MAX_IMAGE_BYTES=15*1024*1024;
 function db(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window))return reject(Error('IndexedDB unavailable'));const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
 async function get(key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(STORE,'readonly'),r=t.objectStore(STORE).get(key);r.onsuccess=()=>resolve(r.result?.blob||r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>d.close()})}
 async function put(key,value){
  if(!(value instanceof Blob)||!value.type.startsWith('image/')||value.size>MAX_IMAGE_BYTES||!value.size)return;
  const d=await db();
  try{
   const records=await new Promise((resolve,reject)=>{const t=d.transaction(STORE,'readonly'),r=t.objectStore(STORE).openCursor(),items=[];r.onsuccess=()=>{const c=r.result;if(c){const v=c.value;items.push({key:c.key,size:v?.blob?.size||v?.size||0,at:v?.at||0});c.continue()}else resolve(items)};r.onerror=()=>reject(r.error)});
   const remaining=records.filter(x=>x.key!==key).sort((a,b)=>a.at-b.at);let total=remaining.reduce((n,x)=>n+x.size,0)+value.size;
   const deletions=[];while(remaining.length&&(remaining.length+1>MAX_CACHE_ITEMS||total>MAX_CACHE_BYTES)){const old=remaining.shift();deletions.push(old.key);total-=old.size}
   await new Promise((resolve,reject)=>{const t=d.transaction(STORE,'readwrite'),o=t.objectStore(STORE);for(const k of deletions)o.delete(k);o.put({blob:value,at:Date.now()},key);t.oncomplete=resolve;t.onerror=()=>reject(t.error)});
  }finally{d.close()}
 }
 async function request(url,timeout=6500){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const r=await fetch(url,{signal:controller.signal,cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timer)}}
 function valid(e){return !!(e&&typeof e.urlbase==='string'&&/^\/th\?id=OHR\.[A-Za-z0-9_-]+(?:\.jpg)?$/i.test(e.urlbase))}
 function normalize(data){if(!data||!Array.isArray(data.images))throw Error('Bing metadata missing images');return data.images.filter(valid).map(e=>({urlbase:e.urlbase,enddate:String(e.enddate||''),copyright:String(e.copyright||'')}))}
 function normalizeAlternate(data){if(data&&Array.isArray(data.images))return normalize(data);const raw=data&&(data.url||data.image||data.imgurl);if(typeof raw!=='string')throw Error('Invalid alternate response');const u=new URL(raw);if(u.protocol!=='https:'||!/(^|\.)bing\.com$/.test(u.hostname))throw Error('Invalid image host');const id=u.searchParams.get('id');const match=(id||'').match(/^(OHR\.[A-Za-z0-9_-]+?)(?:_(?:UHD|1920x1080|1366x768))?\.jpg$/i);if(!match)throw Error('Invalid image id');return [{urlbase:'/th?id='+match[1],enddate:String(data.enddate||data.date||''),copyright:String(data.copyright||'')}];}
 function cacheRead(){try{const c=JSON.parse(localStorage.getItem(META)||'null');if(c&&Array.isArray(c.images)){const images=c.images.filter(valid);if(images.length)return {updated:Number(c.updated)||0,images}}}catch{}return null}
 function cacheWrite(images){try{localStorage.setItem(META,JSON.stringify({updated:Date.now(),images}))}catch{}}
 async function metadata(count=8,force=false){const n=Math.max(1,Math.min(8,Number(count)||8)),cached=cacheRead();if(!force&&cached&&Date.now()-cached.updated<TTL&&cached.images.length>=n)return cached.images.slice(0,n);
  const bing='https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n='+n+'&mkt=zh-CN';
  // The Bing JSON endpoint does not expose CORS. A public CORS proxy is attempted first;
  // direct Bing is a best-effort fallback for environments where it is allowed.
  try{const direct=normalize(await request(bing,4500));if(direct.length>=n){cacheWrite(direct);return direct.slice(0,n)}}catch{}
  const sources=[
   ()=>request('https://api.allorigins.win/raw?url='+encodeURIComponent(bing),5500),
   ()=>request('https://proxy.cors.dev/'+bing,5500),
   ()=>request(bing,4000),
   ()=>request('https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n='+n+'&mkt=zh-CN',4000),
   ()=>request('https://bing.lkin.cn/?region=cn',5500)
  ];
  try{const images=await Promise.any(sources.map(async (source,i)=>{const data=await source();const found=i===4?normalizeAlternate(data):normalize(data);if(found.length<n)throw Error('Bing 返回的历史壁纸数量不足');return found}));cacheWrite(images);return images.slice(0,n)}catch{}
  // Last known metadata is usable even if stale; never erase it after network failure.
  if(cached)return cached.images.slice(0,n);
  throw Error('无法获取最新 Bing 壁纸：跨域代理或网络不可用');
 }
 function urlFor(entry,size){if(!valid(entry))throw Error('Invalid wallpaper');return 'https://www.bing.com'+entry.urlbase.replace(/\.jpg$/i,'')+(['_1366x768.jpg','_1920x1080.jpg','_UHD.jpg'][size]||'_UHD.jpg')}
 function nameFor(entry){const title=String(entry.copyright||'').replace(/\(.*?\)/g,'').trim().replace(/[\\/\*|]/g,'').replace(/:/g,'：').replace(/\?/g,'？').replace(/["<>]/g,"'").replace(/[\x00-\x1f]/g,'').slice(0,140);return (entry.enddate||'bing')+(title?'-'+title:'')+'.jpg'}
 function preload(src){return new Promise((resolve,reject)=>{const img=new Image();const timer=setTimeout(()=>{img.onload=img.onerror=null;reject(Error('壁纸图片加载超时'))},12000);img.onload=()=>{clearTimeout(timer);resolve()};img.onerror=()=>{clearTimeout(timer);reject(Error('壁纸图片加载失败'))};img.src=src})}
 function backgroundLayer(){
  let el=document.getElementById('astral-wallpaper-layer');
  if(!el){el=document.createElement('div');el.id='astral-wallpaper-layer';
   Object.assign(el.style,{position:'fixed',inset:'0',zIndex:'0',pointerEvents:'none',backgroundPosition:'center',backgroundSize:'cover',backgroundRepeat:'no-repeat',backgroundColor:'#e5e5e5'});
   document.body.prepend(el);
  }
  return el;
 }
 function apply(url,blob,token){
  if(!current(token))return false;
  const next=blob?URL.createObjectURL(blob):url,previous=activeUrl,layer=backgroundLayer(),oldImage=layer.style.backgroundImage;
  clearTimeout(fadeTimer);fadeOverlay?.remove();fadeOverlay=null;
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
  if(blob){const objectUrl=URL.createObjectURL(blob);try{await preload(objectUrl)}catch{blob=null;await preload(url)}finally{URL.revokeObjectURL(objectUrl)}}else await preload(url);
  if(!apply(url,blob,token))return false;
  try{localStorage.setItem(CURRENT,JSON.stringify({url,name,enddate:entry.enddate||'',copyright:entry.copyright||'',size}))}catch{}
  if(!blob)fetch(url,{credentials:'omit'}).then(r=>{if(!r.ok)throw Error('image HTTP '+r.status);return r.blob()}).then(b=>{if(b.type.startsWith('image/'))return put(url,b)}).catch(()=>{});
  chrome.runtime.sendMessage({type:'ASTRAL_WALLPAPER_SHOWN',url,name}).catch(()=>{});
  return {url,name,blob};
 }
 async function restore(token=begin()){
  let saved;try{saved=JSON.parse(localStorage.getItem(CURRENT)||'null')}catch{}
  if(!saved||saved.custom||typeof saved.url!=='string'||!(/^https:\/\/(?:cn\.|www\.)?bing\.com\/th\?id=OHR\.[A-Za-z0-9_-]+_(?:UHD|1920x1080|1366x768)\.jpg$/.test(saved.url)||(/^https:\/\/(?:bing\.img\.run|api\.dujin\.org)\/bing\/(?:1366x768|1920x1080)\.php$/.test(saved.url))||(/^https:\/\/bing\.img\.run\/(?:1366x768|1920x1080)\.php$/.test(saved.url))))return false;
  let blob=null;try{blob=await get(saved.url)}catch{}
  if(!current(token))return false;
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
  if(!name){
   let extension=url.match(/^data:image\/(png|webp|gif|avif|jpe?g)/i)?.[1];
   if(!extension)try{extension=new URL(url).pathname.match(/\.(png|webp|gif|avif|jpe?g)$/i)?.[1]}catch{}
   name='custom-wallpaper.'+(extension?.toLowerCase().replace('jpeg','jpg')||'jpg');
  }
  if(!/^https?:\/\//i.test(url)&&!/^data:image\//i.test(url))throw Error('自定义壁纸需要 HTTP(S) 图片地址或图片 Data URL');
  await preload(url);if(!apply(url,null,token))return false;localStorage.setItem(CURRENT,JSON.stringify({url,name,custom:true}));return true;
 }
 return {begin,current,resizeCurrent,showCustom,metadata,show,restore,showIfNew,showDailyFallback,hasWallpaper:()=>hasWallpaper};
})();
