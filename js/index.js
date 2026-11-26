/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
*   Fork from sakuyaa's Firefox Extension myNewTabWE.
*   https://github.com/sakuyaa/
**************************************************/
'use strict';
const $id=id=>document.getElementById(id);
const myNewTabWE={config:{},sites:[],css:{},bingIndex:0,images:[],busy:false,
 initCss(){let style=$id('astral-index-custom');if(!style){style=document.createElement('style');style.id='astral-index-custom';document.head.append(style)}style.textContent=this.css.index||''},
 initDate(){let d=Solar.getSolar(new Date());$id('solar-date').textContent=d.date;$id('solar-festival').textContent=d.festival;$id('solar-holiday').textContent=d.holiday;d=Lunar.getLunar(new Date());$id('lunar-date').textContent=d.date;$id('lunar-festival').textContent=d.festival;$id('lunar-holiday').textContent=d.holiday},
 buildTr(group){const tr=document.createElement('tr'),th=document.createElement('th'),heading=document.createElement('span');heading.className='astral-group-title';heading.textContent=group.name;heading.title=group.name;th.title=group.name;th.append(heading);tr.append(th);for(const site of group.list){const td=document.createElement('td'),a=document.createElement('a'),img=document.createElement('img');if(!/^https?:\/\//i.test(site.url)&&!/^mailto:/i.test(site.url))continue;a.href=site.url;if(this.config.newTabOpen){a.target='_blank';a.rel='noopener noreferrer'}AstralStore.setFavicon(img,site,'./image/default.svg');const label=document.createElement('span');label.className='astral-site-title';label.textContent=site.title;a.title=site.title;a.append(img,label);td.append(a);tr.append(td)}return tr},


 updateNavItemWidth(){
  const table=$id('navtable'),panel=$id('navs');if(!table||!panel)return;
  const stacked=matchMedia('(max-width: 900px)').matches;
  const cells=[...table.querySelectorAll('td')];if(!cells.length)return;


  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  let required=0;
  for(const cell of cells){
   const link=cell.querySelector('a');if(!link)continue;
   const style=getComputedStyle(link),cellStyle=getComputedStyle(cell);
   ctx.font=style.font;
   const title=link.querySelector('.astral-site-title');const text=title?.textContent||'';
   const maxTextWidth=Math.ceil(ctx.measureText('OpenReview').width);
   if(title){


    for(const [property,value] of [
     ['display','block'],['min-width','0'],['max-width',maxTextWidth+'px'],
     ['overflow','hidden'],['white-space','nowrap'],['text-overflow','ellipsis']
    ])title.style.setProperty(property,value,'important');
   }
   const icon=link.querySelector('img'),iconStyle=icon?getComputedStyle(icon):null;
   const iconWidth=icon?(parseFloat(iconStyle.width)||parseFloat(style.fontSize)||16)+(parseFloat(iconStyle.marginRight)||0):0;
   const padding=(parseFloat(cellStyle.paddingLeft)||0)+(parseFloat(cellStyle.paddingRight)||0);
   required=Math.max(required,Math.ceil(Math.min(ctx.measureText(text).width,maxTextWidth)+iconWidth+(parseFloat(style.columnGap)||0)+padding+8));
  }


  for(const title of table.querySelectorAll('th .astral-group-title')){
   const cell=title.closest('th');const headingStyle=getComputedStyle(cell);
   ctx.font=headingStyle.font;
   const width=Math.ceil(ctx.measureText('中'.repeat(5)).width);
   for(const [property,value] of [
    ['display','inline-block'],['max-width',width+'px'],['overflow','hidden'],
    ['white-space','nowrap'],['text-overflow','ellipsis']
   ])title.style.setProperty(property,value,'important');
  }
  const headingCell=table.querySelector('th');
  const heading=stacked?0:Math.max(115,Math.ceil(headingCell?headingCell.scrollWidth:0));
  const tableStyle=getComputedStyle(table);
  const tablePadding=(parseFloat(tableStyle.paddingLeft)||0)+(parseFloat(tableStyle.paddingRight)||0);
  const cap=Math.max(1,Math.min(innerWidth-20,Math.floor(innerWidth*.94)));
  const overhead=heading+tablePadding+4;

  const columns=Math.max(1,Math.min(6,Math.floor((cap-overhead+1)/Math.max(required,1))));
  const needed=Math.ceil(overhead+columns*required);
  const panelWidth=columns===6&&!stacked
   ?Math.min(cap,Math.max(1080,needed))
   :Math.min(cap,needed);
  panel.style.width=panelWidth+'px';
  table.style.setProperty('--astral-nav-columns',String(columns));
  table.style.setProperty('--astral-nav-heading-width',heading+'px');
 },
 initSites(){const table=$id('navtable');table.replaceChildren();for(const group of this.sites){const row=this.buildTr(group);if(group.name.toLowerCase()==='yooo'){row.hidden=true;row.setAttribute('name','yooo')}table.append(row)}this.updateNavItemWidth()},
 async initImage(){
  AstralWallpaper.configure(this.config).catch(console.warn);


  AstralWallpaper.restore().catch(()=>false).finally(()=>this.refreshWallpaper());
 },
 async refreshWallpaper(){
  if(this.busy)return;
  this.busy=true;
  try{
   const count=Math.max(1,Math.min(8,Number(this.config.bingMaxHistory)||1));
   const today=new Date().toLocaleDateString('en-CA');
   const stateKey='astral.wallpaper.selection';
   let state=null;
   try{state=JSON.parse(AstralStore.safeGet(stateKey)||'null')}catch{}

   if(!state||state.date!==today||state.count!==count){state={date:today,count,index:0};try{AstralStore.safeSet(stateKey,JSON.stringify(state))}catch{}}
   const images=await AstralWallpaper.metadata(count);
   if(!images.length)throw Error('没有可用的 Bing 壁纸');
   const entry=images[state.index%Math.min(count,images.length)];
   await AstralWallpaper.showIfNew(entry,this.config.useBigImage);
  }catch(e){
   const fallback=AstralWallpaper.hasWallpaper()?true:await AstralWallpaper.showDailyFallback(this.config.useBigImage).catch(()=>false);
   if(!fallback)AstralStore.notify('', '获取 Bing 壁纸失败');
  }
  finally{this.busy=false}
 },
 async changeWallpaper(){
  if(this.busy)return;
  this.busy=true;
  try{
   const count=Math.max(1,Math.min(8,Number(this.config.bingMaxHistory)||1));
   const today=new Date().toLocaleDateString('en-CA');
   const key='astral.wallpaper.selection';
   let state=null;
   try{state=JSON.parse(AstralStore.safeGet(key)||'null')}catch{}
   if(!state||state.date!==today||state.count!==count)state={date:today,count,index:0};
   const images=await AstralWallpaper.metadata(count);
   if(!images.length)throw Error('没有可用的 Bing 壁纸');
   const next=(state.index+1)%Math.min(count,images.length);
   await AstralWallpaper.showIfNew(images[next],this.config.useBigImage);
   state.index=next;
   try{AstralStore.safeSet(key,JSON.stringify(state))}catch{};
  }catch(e){AstralStore.notify('', '获取 Bing 壁纸失败')}
  finally{this.busy=false}
 },
 initListeners(){
  $id('change-wallpaper').addEventListener('click',e=>{e.preventDefault();this.changeWallpaper()});
  addEventListener('keydown',e=>{if(e.ctrlKey&&e.key.toLowerCase()==='q')document.querySelectorAll('[name="yooo"]').forEach(n=>n.hidden=false)});
  addEventListener('keyup',()=>document.querySelectorAll('[name="yooo"]').forEach(n=>n.hidden=true));
  addEventListener('storage',e=>{if(e.key==='astral.wallpaper.selection'&&e.newValue===null){this.refreshWallpaper(true);return}if(e.key!=='astral.web.settings'&&e.key!==null)return;const data=AstralStore.read();const old=this.config;const oldCss=this.css;this.config=data.config;AstralWallpaper.configure(this.config).catch(console.warn);this.sites=data.sites;this.css=data.css;document.title=this.config.title;this.initSites();if(oldCss.index!==this.css.index)this.initCss();if(old.weatherLatitude!==this.config.weatherLatitude||old.weatherLongitude!==this.config.weatherLongitude||old.weatherCity!==this.config.weatherCity||old.weatherMode!==this.config.weatherMode||old.weatherLocationMode!==this.config.weatherLocationMode)AstralWeather.refresh(this.config);if(old.useBigImage!==this.config.useBigImage||old.bingMaxHistory!==this.config.bingMaxHistory)this.refreshWallpaper()});


  // Runtime-only location scheduling; never exported or synchronized.
  const LOCATION_INTERVAL=6*60*60*1000, RETRY=5*60*1000, GAP=5*60*1000;
  const prefix='astral.weather.location.';
  const stamp=key=>{const n=Number(AstralStore.safeGet(prefix+key));return Number.isFinite(n)&&n>0&&n<=Date.now()?n:0};
  const save=(key,value)=>{try{AstralStore.safeSet(prefix+key,String(value))}catch{}};
  const enabled=c=>c.weatherMode==='native'&&c.weatherLocationMode==='auto';
  let locating=false,permission=null,lastTick=Date.now();
  const markPending=()=>save('pending',Date.now());
  const activity=()=>{
   const now=Date.now(),previous=stamp('active');
   if((previous&&now-previous>=GAP)||now-lastTick>=GAP)markPending();
   lastTick=now;save('active',now);
   if(!navigator.onLine){if(!stamp('offline'))save('offline',now);return}
   const offline=stamp('offline');
   if(offline&&now-offline>=GAP)markPending();
   if(offline)save('offline',0);
  };
  const updateLocationOnReturn=async()=>{
   activity();
   if(locating||!enabled(this.config)||document.visibilityState!=='visible'||!isSecureContext||!navigator.geolocation||!navigator.onLine)return;
   locating=true;
   const run=async()=>{
    if(!enabled(AstralStore.read().config)||document.visibilityState!=='visible'||!navigator.onLine)return;
    const now=Date.now(),pending=stamp('pending'),success=stamp('success'),attempt=stamp('attempt');
    const force=pending>0;
    if(attempt&&now-attempt<RETRY)return;
    if(!force&&success&&now-success<LOCATION_INTERVAL)return;
    try{permission=permission||await navigator.permissions?.query({name:'geolocation'})}catch{return}
    if(permission?.state!=='granted')return;
    const current=AstralStore.read().config;
    if(!enabled(current)||document.visibilityState!=='visible'||!navigator.onLine)return;
    const signature=c=>JSON.stringify([c.weatherMode,c.weatherLocationMode,c.weatherLatitude,c.weatherLongitude,c.weatherCity]);
    const expected=signature(current);
    const stillCurrent=()=>signature(AstralStore.read().config)===expected;
    save('attempt',Date.now());
    try{
     const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10000,maximumAge:force||!success?0:1800000}));
     if(!stillCurrent())return;
     const {latitude,longitude}=position.coords;
     if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
     const city=await AstralWeather.resolveCity(latitude,longitude)||AstralWeather.coordinateLabel(latitude,longitude);
     if(!stillCurrent())return;
     const latest=AstralStore.read().config;
     const moved=Math.abs(latitude-Number(latest.weatherLatitude))>0.001||Math.abs(longitude-Number(latest.weatherLongitude))>0.001;
     if(moved||city!==latest.weatherCity)this.config=AstralStore.write({config:{...latest,weatherLatitude:latitude,weatherLongitude:longitude,weatherCity:city}}).config;
     else this.config=latest;
     save('success',Date.now());
     if(stamp('pending')===pending)save('pending',0);
     AstralWeather.refresh(this.config);
    }catch(e){console.info('自动定位未成功，继续使用保存的坐标',e)}
   };
   try{
    if(navigator.locks?.request)await navigator.locks.request(prefix+'lock',{ifAvailable:true},lock=>lock?run():undefined);
    else await run(); // Shared attempt timestamp provides best-effort deduplication.
   }catch(e){console.info('自动定位调度未成功',e)}finally{locating=false}
  };
  addEventListener('offline',()=>{if(!stamp('offline'))save('offline',Date.now())});
  addEventListener('online',updateLocationOnReturn);
  addEventListener('storage',e=>{
   if(e.key!=='astral.web.settings'&&e.key!==null)return;
   const c=AstralStore.read().config;
   if(enabled(c)&&!wasEnabled){markPending();updateLocationOnReturn()}
   wasEnabled=enabled(c);
  });
  let wasEnabled=enabled(this.config);
  if(navigator.permissions?.query)navigator.permissions.query({name:'geolocation'}).then(p=>{
   permission=p;
   p.addEventListener?.('change',()=>{if(p.state==='granted'){markPending();save('attempt',0);updateLocationOnReturn()}});
  }).catch(()=>{});
  let lastWeather=Date.now(),lastWallpaper=Date.now(),lastDate=new Date().toDateString();
  const refreshOnReturn=()=>{if(document.visibilityState!=='visible')return;const now=Date.now(),day=new Date().toDateString();if(day!==lastDate){lastDate=day;this.initDate();this.refreshWallpaper()}if(now-lastWeather>=3600000){lastWeather=now;AstralWeather.refresh(this.config)}updateLocationOnReturn()};


  queueMicrotask(updateLocationOnReturn);
  document.addEventListener('visibilitychange',refreshOnReturn);
  addEventListener('focus',refreshOnReturn);
  setInterval(()=>{
   const now=Date.now(),day=new Date().toDateString();
   if(day!==lastDate){lastDate=day;this.initDate();this.refreshWallpaper()}
   if(now-lastWeather>=3600000){lastWeather=now;this.initDate();AstralWeather.refresh(this.config)}
   if(now-lastWallpaper>=3600000){lastWallpaper=now;this.refreshWallpaper()}
   updateLocationOnReturn();
  },60000);
 },
 async init(){
  await AstralStore.initializeFromFile();
  const data=AstralStore.read();this.config=data.config;this.sites=data.sites;this.css=data.css;
  document.title=this.config.title;this.initCss();this.initDate();this.initSites();
  requestAnimationFrame(()=>{
   document.documentElement.removeAttribute('data-astral-loading');
  });
  const scheduleNavLayout=()=>{cancelAnimationFrame(this.navResizeFrame);this.navResizeFrame=requestAnimationFrame(()=>this.updateNavItemWidth())};
  addEventListener('resize',scheduleNavLayout);
  if(document.fonts){document.fonts.ready.then(scheduleNavLayout).catch(()=>{});document.fonts.addEventListener?.('loadingdone',scheduleNavLayout)}
  addEventListener('load',scheduleNavLayout,{once:true});
  this.initListeners();this.initImage();AstralWeather.refresh(this.config)
 }
};
myNewTabWE.init().catch(e=>{document.documentElement.removeAttribute('data-astral-loading');console.error('Astral 首页初始化失败',e);AstralStore.notify(e.message,'主页加载失败')});
