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


  const LOCATION_INTERVAL=6*60*60*1000;
  const LOCATION_ATTEMPT_KEY='astral.weather.auto-location-attempt';
  let locating=false;
  const updateLocationOnReturn=async()=>{
   if(locating||this.config.weatherMode==='off'||this.config.weatherLocationMode!=='auto'||document.visibilityState!=='visible'||!isSecureContext||!navigator.geolocation||!navigator.permissions?.query)return;
   const now=Date.now();let previous=Number(AstralStore.safeGet(LOCATION_ATTEMPT_KEY))||0;
   if(previous>now)previous=0;
   if(now-previous<LOCATION_INTERVAL)return;

   let permission;try{permission=await navigator.permissions.query({name:'geolocation'})}catch{return}
   if(permission.state!=='granted'||locating||this.config.weatherMode==='off'||this.config.weatherLocationMode!=='auto')return;
   const expected=JSON.stringify([this.config.weatherMode,this.config.weatherLocationMode,this.config.weatherLatitude,this.config.weatherLongitude,this.config.weatherCity]);
   const stillCurrent=()=>{const c=AstralStore.read().config;return c.weatherMode!=='off'&&c.weatherLocationMode==='auto'&&JSON.stringify([c.weatherMode,c.weatherLocationMode,c.weatherLatitude,c.weatherLongitude,c.weatherCity])===expected};
   locating=true;
   try{AstralStore.safeSet(LOCATION_ATTEMPT_KEY,String(now))}catch{}
   try{
    const position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10000,maximumAge:1800000}));
    if(!stillCurrent())return;
    const latitude=position.coords.latitude,longitude=position.coords.longitude;
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return;
    const moved=Math.abs(latitude-Number(this.config.weatherLatitude))>0.001||Math.abs(longitude-Number(this.config.weatherLongitude))>0.001;

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
  const refreshOnReturn=()=>{if(document.visibilityState!=='visible')return;const now=Date.now(),day=new Date().toDateString();if(day!==lastDate){lastDate=day;this.initDate();this.refreshWallpaper()}if(now-lastWeather>=3600000){lastWeather=now;AstralWeather.refresh(this.config)}updateLocationOnReturn()};


  queueMicrotask(updateLocationOnReturn);
  document.addEventListener('visibilitychange',refreshOnReturn);
  addEventListener('focus',refreshOnReturn);
  setInterval(()=>{
   const now=Date.now(),day=new Date().toDateString();
   if(day!==lastDate){lastDate=day;this.initDate();this.refreshWallpaper()}
   if(now-lastWeather>=3600000){lastWeather=now;this.initDate();AstralWeather.refresh(this.config)}
   if(now-lastWallpaper>=3600000){lastWallpaper=now;this.refreshWallpaper()}
   if(document.visibilityState==='visible')updateLocationOnReturn();
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
