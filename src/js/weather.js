/* Open-Meteo weather: browser-side CORS API, no API key. */
'use strict';
const AstralWeather=(()=>{
 let requestSerial=0,activeController=null;
 const descriptions={0:'晴',1:'大致晴朗',2:'局部多云',3:'阴',45:'雾',48:'雾凇',51:'小毛毛雨',53:'毛毛雨',55:'强毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'阵雨',82:'强阵雨',95:'雷雨',96:'雷雨伴冰雹',99:'强雷雨'};
 const cityRequests=new Map();
 function coordinateLabel(latitude,longitude){return Number(latitude).toFixed(3)+'°, '+Number(longitude).toFixed(3)+'°'}
 async function resolveCity(latitude,longitude,force=false){
  if(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude)))return null;
  const key='astral.weather.city.v2:'+Number(latitude).toFixed(3)+','+Number(longitude).toFixed(3);
  try{const cached=JSON.parse(AstralStore.safeGet(key)||'null');if(!force&&cached&&Date.now()-cached.at<(cached.name?86400000:300000))return cached.name}catch{}
  if(cityRequests.has(key))return cityRequests.get(key);
  const task=(async()=>{
   const reverse=new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
   reverse.search=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),localityLanguage:'zh'});
   const photon=new URL('https://photon.komoot.io/reverse');
   photon.search=new URLSearchParams({lat:String(latitude),lon:String(longitude),limit:'1'});
   let name=null;
   for(const [source,url] of [['bdc',reverse],['photon',photon]]){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{
     const response=await fetch(url,{signal:controller.signal,credentials:'omit'});if(!response.ok)throw Error('HTTP '+response.status);
     const data=await response.json();
     const props=data.features?.[0]?.properties||{};
     const names=source==='bdc'?[data.city,data.locality,...(data.localityInfo?.administrative||[]).slice().reverse().map(v=>v.name),data.principalSubdivision]:[props.city,props.district,props.county,props.state];
     name=names.find(v=>typeof v==='string'&&v.trim())?.trim()||null;
     if(name)break;
    }catch{}finally{clearTimeout(timer)}
   }
   try{AstralStore.safeSet(key,JSON.stringify({name,at:Date.now()}))}catch{}
   return name;
  })();
  cityRequests.set(key,task);try{return await task}finally{cityRequests.delete(key)}
 }
 async function searchCities(name,signal){
  const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name,count:'10',language:'zh',format:'json'});
  const response=await fetch(url,{signal});if(!response.ok)throw Error('HTTP '+response.status);
  const data=await response.json();return (data.results||[]).filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude));
 }
 const CACHE_KEY='astral.weather.last-success.v1';
 const STALE_AFTER=3*60*60*1000; // Three hours: visibly label older observations.
 function coords(config){return [Number(config.weatherLatitude),Number(config.weatherLongitude)]}
 function matching(entry,config){const [lat,lon]=coords(config);return entry&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(entry.latitude-lat)<0.000001&&Math.abs(entry.longitude-lon)<0.000001}
 function readCache(config){try{const item=JSON.parse(AstralStore.safeGet(CACHE_KEY)||'null');if(matching(item,config)&&Number.isFinite(item.savedAt)&&item.weather&&Number.isFinite(item.weather.temperature_2m))return item}catch{}return null}
 function render(root,entry,config,failed=false){
  root.replaceChildren();root.style.display='block';
  const age=Math.max(0,Date.now()-entry.savedAt),stale=age>=STALE_AFTER;
  const title=document.createElement('strong');title.textContent=config.weatherCity==='当前位置'||!config.weatherCity?coordinateLabel(config.weatherLatitude,config.weatherLongitude):config.weatherCity;
  const line=document.createElement('span');const w=entry.weather;
  const range=Number.isFinite(entry.high)&&Number.isFinite(entry.low)?` · 最高 ${Math.round(entry.high)}°C / 最低 ${Math.round(entry.low)}°C`:'';
  const pieces=[['weather-temperature',` ${Math.round(w.temperature_2m)}°C`],['weather-range',range],['weather-condition',` · ${descriptions[w.weather_code]||'天气代码 '+w.weather_code}`],['weather-humidity',Number.isFinite(w.relative_humidity_2m)?` · 湿度 ${w.relative_humidity_2m}%`:''],['weather-wind',Number.isFinite(w.wind_speed_10m)?` · 风速 ${w.wind_speed_10m} km/h`:'']];
  for(const [cls,value] of pieces){if(!value)continue;const span=document.createElement('span');span.className=cls;span.textContent=value;line.append(span)}
  root.append(title,line);
  if(stale||failed){const note=document.createElement('span');note.className='weather-cache-status';note.textContent=` · ${new Date(entry.savedAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}更新的历史数据`;root.append(note)}
  root.title=root.textContent+'；数据来源：Open-Meteo；最近成功获取：'+new Date(entry.savedAt).toLocaleString('zh-CN')+(failed?'；本次更新失败':'')+'；位置名称：BigDataCloud / Photon（© OpenStreetMap contributors）';
 }
 // Weather uses fixed component styles isolated from homepage custom CSS.
 function surface(host){
  const shadow=host.shadowRoot||host.attachShadow({mode:'open'});
  let root=shadow.getElementById('weather-content');
  if(!root){
   const base=document.createElement('style');base.textContent=`:host{font:inherit;color:inherit}#weather-content{font:inherit;color:inherit;line-height:1.5}strong{font-weight:600}.weather-temperature{white-space:nowrap}.weather-cache-status{font-size:.88em;opacity:.82}@media(max-width:760px){.weather-wind{display:none}}@media(max-width:600px){.weather-humidity{display:none}}@media(max-width:440px){.weather-condition{display:none}}@media(max-width:350px){.weather-range{display:none}}`;
   root=document.createElement('div');root.id='weather-content';shadow.append(base,root);
  }
  return root;
 }
 async function refresh(config){
  const serial=++requestSerial;activeController?.abort();
  const host=document.getElementById('weather-container');if(!host)return;
  const root=surface(host);
  if(config.weatherMode==='off'){root.replaceChildren();root.style.display='none';return}
  const [latitude,longitude]=coords(config);
  const cached=readCache(config);
  if(cached)render(root,cached,config);
  else{root.style.display='block';root.textContent='天气加载中…';root.title=''}
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180){if(!cached)root.textContent='天气坐标无效';return}
  const controller=new AbortController();activeController=controller;
  const timer=setTimeout(()=>controller.abort(),12000);
  try{
   const u=new URL('https://api.open-meteo.com/v1/forecast');
   u.search=new URLSearchParams({latitude:String(latitude),longitude:String(longitude),current:'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',daily:'temperature_2m_max,temperature_2m_min',forecast_days:'1',timezone:'auto'});
   const response=await fetch(u,{signal:controller.signal});if(!response.ok)throw Error('HTTP '+response.status);
   const data=await response.json();if(serial!==requestSerial)return;
   const weather=data.current;if(!weather||!Number.isFinite(weather.temperature_2m))throw Error('天气数据无效');
   const entry={latitude,longitude,savedAt:Date.now(),weather:{temperature_2m:weather.temperature_2m,relative_humidity_2m:weather.relative_humidity_2m,weather_code:weather.weather_code,wind_speed_10m:weather.wind_speed_10m,time:weather.time},high:data.daily?.temperature_2m_max?.[0],low:data.daily?.temperature_2m_min?.[0]};
   try{AstralStore.safeSet(CACHE_KEY,JSON.stringify(entry))}catch(e){console.warn('天气缓存保存失败',e)}
   render(root,entry,config);
  }catch(e){if(serial!==requestSerial)return;if(cached)render(root,cached,config,true);else{root.textContent='天气暂不可用';root.title=String(e)}}
  finally{clearTimeout(timer);if(activeController===controller)activeController=null}
 }

 return {refresh,resolveCity,coordinateLabel,searchCities};
})();
