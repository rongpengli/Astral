/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
*   Fork from sakuyaa's Firefox Extension myNewTabWE.
*   https://github.com/sakuyaa/
**************************************************/
'use strict';
const $id=id=>document.getElementById(id);
const myNewTabWE={config:{},sites:[],css:{},busy:false,
 initCss(){let style=$id('astral-index-custom');if(!style){style=document.createElement('style');style.id='astral-index-custom';document.head.append(style)}style.textContent=this.css.index||'';if(this.renderedSites)requestAnimationFrame(()=>this.updateNavItemWidth())},
 initDate(){let d=Solar.getSolar(new Date());$id('solar-date').textContent=d.date;$id('solar-festival').textContent=d.festival;$id('solar-holiday').textContent=d.holiday;d=Lunar.getLunar(new Date());$id('lunar-date').textContent=d.date;$id('lunar-festival').textContent=d.festival;$id('lunar-holiday').textContent=d.holiday},
 buildTr(group){const tr=document.createElement('tr'),th=document.createElement('th');th.textContent=group.name;tr.append(th);for(const site of group.list){const td=document.createElement('td'),a=document.createElement('a'),img=document.createElement('img');if(!/^https?:\/\//i.test(site.url)&&!/^mailto:/i.test(site.url))continue;a.href=site.url;if(this.config.newTabOpen){a.target='_blank';a.rel='noopener noreferrer'}AstralStore.setFavicon(img,site,'../image/default.svg');a.append(img,document.createTextNode(site.title));td.append(a);tr.append(td)}return tr},
 // Aim for six items per row on desktop. Preserve the original 1080px
 // baseline, and expand only when six measured cells need more room.
 updateNavItemWidth(){
  const table=$id('navtable'),panel=$id('navs');if(!table||!panel)return;
  const stacked=matchMedia('(max-width: 900px)').matches;
  const cells=[...table.querySelectorAll('td')];if(!cells.length)return;
  // Measure text alone. Never measure the allocated grid cell or a constrained link:
  // their bounding boxes can be hundreds of pixels wider than the content.
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  let required=0;
  for(const cell of cells){
   const link=cell.querySelector('a');if(!link)continue;
   const style=getComputedStyle(link),cellStyle=getComputedStyle(cell);
   ctx.font=style.font;
   const text=[...link.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('');
   const icon=link.querySelector('img'),iconStyle=icon?getComputedStyle(icon):null;
   const iconWidth=icon?(parseFloat(iconStyle.width)||parseFloat(style.fontSize)||16)+(parseFloat(iconStyle.marginRight)||0)+(parseFloat(style.columnGap)||0):0;
   const padding=(parseFloat(cellStyle.paddingLeft)||0)+(parseFloat(cellStyle.paddingRight)||0);
   required=Math.max(required,Math.ceil(ctx.measureText(text).width+iconWidth+padding+8));
  }
  const headingCell=table.querySelector('th');
  const heading=stacked?0:Math.max(115,Math.ceil(headingCell?headingCell.scrollWidth:0));
  const tableStyle=getComputedStyle(table);
  const tablePadding=(parseFloat(tableStyle.paddingLeft)||0)+(parseFloat(tableStyle.paddingRight)||0);
  const cap=Math.max(1,Math.min(innerWidth-20,Math.floor(innerWidth*.94)));
  const overhead=heading+tablePadding+4;
  // First decide how many columns fit in the viewport. Then size the panel
  // for those columns, instead of stretching four columns across a six-column panel.
  // Keep the original 1080px visual baseline only when all six columns fit.
  const columns=Math.max(1,Math.min(6,Math.floor((cap-overhead+1)/Math.max(required,1))));
  const needed=Math.ceil(overhead+columns*required);
  const panelWidth=columns===6&&!stacked
   ?Math.min(cap,Math.max(1080,needed))
   :Math.min(cap,needed);
  panel.style.width=panelWidth+'px';
  table.style.setProperty('--astral-nav-columns',String(columns));
  table.style.setProperty('--astral-nav-heading-width',heading+'px');
 },
 initSites(){this.renderedSites=structuredClone(this.sites);const table=$id('navtable');table.replaceChildren();for(const group of this.sites){const row=this.buildTr(group);if(group.name.toLowerCase()==='yooo'){row.hidden=true;row.setAttribute('name','yooo')}table.append(row)}this.updateNavItemWidth()},
 finishWallpaper(){this.busy=false;if(this.refreshQueued){const force=this.refreshQueued===2;this.refreshQueued=0;queueMicrotask(()=>this.refreshWallpaper(force))}},
 async initImage(){
  const token=AstralWallpaper.begin(),extras=this.config.extensionFeatures;
  AstralWallpaper.setBingEnabled(!extras.userImage);
  for(const id of ['change-wallpaper','download-wallpaper'])$id(id).hidden=extras.userImage;
  if(extras.userImage)this.refreshQueued=0;
  if(extras.autoChange)AstralStore.safeSet('astral.wallpaper.legacy-pin','0');
  if(extras.userImage){
   if(!extras.userImageSrc.trim()){
    AstralWallpaper.showGradient(token);
    return;
   }
   try{await AstralWallpaper.showCustom(extras.userImageSrc,null,token)}
   catch(error){
    if(AstralWallpaper.current(token)){
     AstralWallpaper.showGradient(token);
     AstralStore.notify(error.message,'自定义壁纸加载失败');
    }
   }
   return;
  }
  if(!extras.autoChange&&AstralStore.safeGet('astral.wallpaper.legacy-pin')==='1'&&AstralStore.safeGet('imageSrc')){try{await AstralWallpaper.showCustom(AstralStore.safeGet('imageSrc'),AstralStore.safeGet('imageName')||'bing-pinned.jpg',token)}catch(e){if(AstralWallpaper.current(token))AstralStore.notify(e.message,'旧壁纸加载失败')}return}
  const restored=await AstralWallpaper.restore(token,!extras.autoChange).catch(()=>false);
  if(!AstralWallpaper.current(token))return;
  if(extras.autoChange||!restored)await this.refreshWallpaper(!restored);
 },
 async refreshWallpaper(force=false){
  if(this.config.extensionFeatures.userImage)return;
  if(!this.config.extensionFeatures.autoChange){
   if(!AstralWallpaper.hasWallpaper()||force)await AstralWallpaper.fromHistory(this.config.bingMaxHistory,this.config.useBigImage,false,AstralWallpaper.begin());
   return;
  }
  if(this.busy){this.refreshQueued=Math.max(this.refreshQueued||0,force?2:1);return}
  this.busy=true;const token=AstralWallpaper.begin();
  try{

   if(!AstralWallpaper.current(token))return;
   const count=Math.max(1,Math.min(8,Number(this.config.bingMaxHistory)||8)),today=new Date().toLocaleDateString('en-CA'),key='astral.wallpaper.selection.v1';
   let state=null;try{state=JSON.parse(AstralStore.safeGet(key)||'null')}catch{}
   if(!state||state.date!==today||state.count!==count)state={date:today,count,index:0};
   const images=await AstralWallpaper.metadata(count);
   if(!AstralWallpaper.current(token))return;
   if(!images.length)throw Error('没有可用的 Bing 壁纸');
   await AstralWallpaper.showIfNew(images[state.index%Math.min(count,images.length)],this.config.useBigImage,token);
   if(AstralWallpaper.current(token))void AstralWallpaper.cacheHistory(images.slice(0,count),this.config.useBigImage,token);
   if(AstralWallpaper.current(token))try{AstralStore.safeSet(key,JSON.stringify(state))}catch{}
  }catch(e){
   if(!AstralWallpaper.current(token))return;
   const fallback=AstralWallpaper.hasWallpaper()?true:await AstralWallpaper.showDailyFallback(this.config.useBigImage,token).catch(()=>false);
   if(!fallback&&AstralWallpaper.current(token))AstralStore.notify(e.message+'；每日壁纸备用源也不可用','Bing 壁纸暂时不可用');
  }finally{this.finishWallpaper()}
 },
 async changeWallpaper(){
  if(this.config.extensionFeatures.userImage){AstralStore.notify('请先在选项中选择 Bing 壁纸');return}
  if(this.busy)return;
  this.busy=true;const token=AstralWallpaper.begin();
  try{
   if(!this.config.autoChange){
    const found=await AstralWallpaper.fromHistory(this.config.bingMaxHistory,this.config.useBigImage,true,token);
    if(!found&&AstralWallpaper.current(token))AstralStore.notify('暂无已缓存的 Bing 壁纸');
    return;
   }
   const count=Math.max(1,Math.min(8,Number(this.config.bingMaxHistory)||8)),today=new Date().toLocaleDateString('en-CA'),key='astral.wallpaper.selection.v1';
   let state=null;try{state=JSON.parse(AstralStore.safeGet(key)||'null')}catch{}
   if(!state||state.date!==today||state.count!==count)state={date:today,count,index:0};
   const images=await AstralWallpaper.metadata(count);
   if(!AstralWallpaper.current(token))return;
   if(!images.length)throw Error('没有可用的 Bing 壁纸');
   const next=(state.index+1)%Math.min(count,images.length);
   await AstralWallpaper.showIfNew(images[next],this.config.useBigImage,token);
   if(!AstralWallpaper.current(token))return;
   AstralStore.safeSet('astral.wallpaper.legacy-pin','0');state.index=next;
   try{AstralStore.safeSet(key,JSON.stringify(state))}catch{}
  }catch(e){if(AstralWallpaper.current(token))AstralStore.notify(e.message+'；历史壁纸切换需要获取 Bing 元数据','切换 Bing 壁纸失败')}
  finally{this.finishWallpaper()}
 },
 initListeners(){
  $id('download-wallpaper').addEventListener('click',async e=>{e.preventDefault();if(this.config.userImage)return;try{const saved=JSON.parse(AstralStore.safeGet('astral.wallpaper.current')||'null');if(!saved?.url)throw Error('壁纸尚未加载');await chrome.downloads.download({url:saved.url,filename:AstralCompat.downloadFilename(this.config.extensionFeatures.downloadDir,saved.name||'bing-'+new Date().toISOString().slice(0,10)+'.jpg'),saveAs:false})}catch(e){AstralStore.notify(e.message,'壁纸下载失败')}});
  $id('change-wallpaper').addEventListener('click',e=>{e.preventDefault();this.changeWallpaper()});
  addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='q')document.querySelectorAll('[name="yooo"]').forEach(n=>n.hidden=false)});
  addEventListener('keyup',()=>document.querySelectorAll('[name="yooo"]').forEach(n=>n.hidden=true));
  addEventListener('storage',e=>{if(e.key!=='astral.web.settings.v1'&&e.key!==null)return;const data=AstralStore.read();const old=this.config;const oldCss=this.css;this.config=data.config;this.sites=data.sites;this.css=data.css;document.title=this.config.title;if(JSON.stringify(data.sites)!==JSON.stringify(this.renderedSites)||old.newTabOpen!==this.config.newTabOpen)this.initSites();if(oldCss.index!==this.css.index)this.initCss();if(old.weatherLatitude!==this.config.weatherLatitude||old.weatherLongitude!==this.config.weatherLongitude||old.weatherCity!==this.config.weatherCity||old.weatherMode!==this.config.weatherMode||old.weatherLocationMode!==this.config.weatherLocationMode)AstralWeather.refresh(this.config);if(old.extensionFeatures.userImage!==this.config.extensionFeatures.userImage||old.extensionFeatures.userImageSrc!==this.config.extensionFeatures.userImageSrc||old.extensionFeatures.autoChange!==this.config.extensionFeatures.autoChange)this.initImage();if(old.useBigImage!==this.config.useBigImage||(old.bingMaxHistory!==this.config.bingMaxHistory&&this.config.extensionFeatures.autoChange))this.refreshWallpaper(true)});
  // Passive location refresh only for an explicitly enabled auto-location mode.
  // Permission must already be granted; never prompt simply because the tab regained focus.
  const LOCATION_INTERVAL=6*60*60*1000;
  const LOCATION_ATTEMPT_KEY='astral.weather.auto-location-attempt.v1';
  let locating=false;
  const updateLocationOnReturn=async()=>{
   if(locating||this.config.weatherMode!=='native'||this.config.weatherLocationMode!=='auto'||document.visibilityState!=='visible'||!isSecureContext||!navigator.geolocation||!navigator.permissions?.query)return;
   const now=Date.now();let previous=Number(AstralStore.safeGet(LOCATION_ATTEMPT_KEY))||0;
   if(previous>now)previous=0;
   if(now-previous<LOCATION_INTERVAL)return;
   // Query permission before recording an attempt, so unsupported/denied states never prompt.
   let permission;try{permission=await navigator.permissions.query({name:'geolocation'})}catch{return}
   if(permission.state!=='granted'||locating||this.config.weatherMode!=='native'||this.config.weatherLocationMode!=='auto')return;
   const expected=JSON.stringify([this.config.weatherMode,this.config.weatherLocationMode,this.config.weatherLatitude,this.config.weatherLongitude,this.config.weatherCity]);
   const stillCurrent=()=>{const c=AstralStore.read().config;return c.weatherMode==='native'&&c.weatherLocationMode==='auto'&&JSON.stringify([c.weatherMode,c.weatherLocationMode,c.weatherLatitude,c.weatherLongitude,c.weatherCity])===expected};
   locating=true;
   try{AstralStore.safeSet(LOCATION_ATTEMPT_KEY,String(now))}catch{}
   try{
    const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10000,maximumAge:1800000}));
    if(!stillCurrent())return;
    const latitude=position.coords.latitude,longitude=position.coords.longitude;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
    const moved=Math.abs(latitude-Number(this.config.weatherLatitude))>0.001||Math.abs(longitude-Number(this.config.weatherLongitude))>0.001;
    // Even when coordinates match the stored defaults, a first successful
    // geolocation must resolve the city label (e.g. a fresh auto-mode setup).
    // Weather always uses precise coordinates; city is a display label only.
    // Keep the existing label while resolving the new location in the background.
    const city=await AstralWeather.resolveCity(latitude,longitude)||AstralWeather.coordinateLabel(latitude,longitude);
    if(!stillCurrent())return;
    if(!moved&&city===this.config.weatherCity)return;
    const config={...this.config,weatherLatitude:latitude,weatherLongitude:longitude,weatherCity:city};
    const updated=AstralStore.write({config});this.config=updated.config;
    AstralWeather.refresh(this.config);
   }catch(e){console.info('自动位置后台更新未成功，继续使用保存的坐标',e)}
   finally{locating=false}
  };
  let lastWeather=Date.now(),lastWallpaper=Date.now(),lastDate=new Date().toDateString();
  const refreshOnReturn=()=>{if(document.visibilityState!=='visible')return;const now=Date.now(),day=new Date().toDateString();if(day!==lastDate){lastDate=day;this.initDate();if(this.config.autoChange&&!this.config.userImage)this.refreshWallpaper()}if(now-lastWeather>=3600000){lastWeather=now;AstralWeather.refresh(this.config)}updateLocationOnReturn()};
  // Run once on initial page load as well as on later returns.
  // Otherwise the first auto-location session never resolves its city name.
  queueMicrotask(updateLocationOnReturn);
  document.addEventListener('visibilitychange',refreshOnReturn);
  addEventListener('focus',refreshOnReturn);
  setInterval(()=>{
   const now=Date.now(),day=new Date().toDateString();
   if(day!==lastDate){lastDate=day;this.initDate();if(this.config.autoChange&&!this.config.userImage)this.refreshWallpaper()}
   if(now-lastWeather>=3600000){lastWeather=now;this.initDate();AstralWeather.refresh(this.config)}
   if(this.config.autoChange&&!this.config.userImage&&now-lastWallpaper>=3600000){lastWallpaper=now;this.refreshWallpaper()}
   if(document.visibilityState==='visible')updateLocationOnReturn();
  },60000);
 },
 async init(){
  await AstralStore.ready;
  const data=AstralStore.read();this.config=data.config;this.sites=data.sites;this.css=data.css;
  document.title=this.config.title;this.initCss();this.initDate();this.initSites();
  requestAnimationFrame(()=>{
   document.documentElement.removeAttribute('data-astral-loading');
  });
  const scheduleNavLayout=()=>{cancelAnimationFrame(this.navResizeFrame);this.navResizeFrame=requestAnimationFrame(()=>this.updateNavItemWidth())};
  addEventListener('resize',scheduleNavLayout);
  if(document.fonts){document.fonts.ready.then(scheduleNavLayout).catch(()=>{});document.fonts.addEventListener?.('loadingdone',scheduleNavLayout)}
  addEventListener('load',scheduleNavLayout,{once:true});
  this.initListeners();this.initImage();AstralWeather.refresh(this.config);
  if(this.config.weatherMode==='native'&&this.config.weatherLocationMode==='auto'&&(this.config.weatherCity==='当前位置'||this.config.weatherCity.includes('°'))){
   const {weatherLatitude:latitude,weatherLongitude:longitude}=this.config;
   AstralWeather.resolveCity(latitude,longitude).then(city=>{
    const latest=AstralStore.read().config;
    if(!city||latest.weatherMode!=='native'||latest.weatherLocationMode!=='auto'||latest.weatherLatitude!==latitude||latest.weatherLongitude!==longitude)return;
    this.config=AstralStore.write({config:{...latest,weatherCity:city}}).config;AstralWeather.refresh(this.config);
   }).catch(()=>{});
  }
 }
};
myNewTabWE.init().catch(e=>{document.documentElement.removeAttribute('data-astral-loading');console.error('Astral 首页初始化失败',e);AstralStore.notify(e.message+'（请查看控制台中的错误位置）','初始化失败')});
