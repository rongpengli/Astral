/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
**************************************************/
'use strict';
const ASTRAL_DEFAULTS = {
 config:{newTabOpen:true,title:'Astral 新标签页',useBigImage:2,bingMaxHistory:8,weatherLatitude:39.9042,weatherLongitude:116.4074,weatherCity:'北京',weatherMode:'native',weatherLocationMode:'manual'},
 sites:[],css:{version:0,index:''}
};
const AstralSchema=(()=>{
 // Retired provider URLs may persist in imported legacy JSON.
 function retiredIconURL(value){
  if(typeof value!=='string'||!value.trim())return false;
  try{
   const host=new URL(value).hostname.toLowerCase();
   return host==='cravatar.com'||host.endsWith('.cravatar.com');
  }catch{return false}
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
    return {...item,title:String(item.title??''),url:String(item.url??''),icon:obsolete||item.iconMode==='auto'?'':icon,iconMode:obsolete||!icon?'auto':(item.iconMode==='auto'?'auto':'custom')};
   })};
  });
  const config={...ASTRAL_DEFAULTS.config,...AstralCompat.config({...ASTRAL_DEFAULTS.config,...(input.config||{})})};
  if(Object.hasOwn(config,'syncEnabled') && typeof config.syncEnabled!=='boolean')throw Error('syncEnabled 必须为 true 或 false');
  for(const k of ['title','weatherCity'])if(typeof config[k]!=='string')throw Error(k+' 类型错误');
  for(const k of ['newTabOpen'])if(typeof config[k]!=='boolean')throw Error(k+' 类型错误');
  config.useBigImage=[0,1,2].includes(Number(config.useBigImage))?Number(config.useBigImage):2;
  // Original extension: maximum recent Bing images available to the manual switch button.

  config.bingMaxHistory=Number.isInteger(Number(config.bingMaxHistory))&&Number(config.bingMaxHistory)>=1&&Number(config.bingMaxHistory)<=8?Number(config.bingMaxHistory):8;
  if(config.autoChange){
   delete config.bingCacheLimit;
  }else{
   const limit=Number(config.bingCacheLimit);
   config.bingCacheLimit=Number.isInteger(limit)&&limit>=1&&limit<=8?limit:config.bingMaxHistory;
   config.bingMaxHistory=Math.min(config.bingMaxHistory,config.bingCacheLimit);
  }
  delete config.wallpaperIntervalDays;
  config.weatherLatitude=Number(config.weatherLatitude);config.weatherLongitude=Number(config.weatherLongitude);
  if(!Number.isFinite(config.weatherLatitude)||Math.abs(config.weatherLatitude)>90||!Number.isFinite(config.weatherLongitude)||Math.abs(config.weatherLongitude)>180)throw Error('天气经纬度无效');
  config.weatherLocationMode=config.weatherLocationMode==='auto'?'auto':'manual';
  const css={...ASTRAL_DEFAULTS.css,...(input.css||{})};
  if(typeof css.index!=='string')css.index='';delete css.weather;
  return {config,sites,css};
 }

 async function loadDefaults(){
  const response=await fetch(chrome.runtime.getURL('AstralNewTab.json'),{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('无法读取扩展预设 AstralNewTab.json');
  const raw=await response.json();
  if(!plain(raw.config)||!Array.isArray(raw.sites))throw Error('默认配置不完整，请检查选项和导航设置。');
  const preset=validate(raw);
  Object.assign(ASTRAL_DEFAULTS,preset);
  return preset;
 }
 return {validate,loadDefaults};
})();
