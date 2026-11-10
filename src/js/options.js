/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
*   Fork from sakuyaa's Firefox Extension myNewTabWE.
*	https://github.com/sakuyaa/
**************************************************/
'use strict';

const $id = id => { const element=document.getElementById(id); if(!element) throw new Error('缺少页面元素 #'+id+'，请强制刷新以更新 HTML 和 JS'); return element; };

let upload = $id('upload');

let myNewTabWE = {
	config: {},
	sites: [],

	notify: (message,title) => AstralStore.notify(message,title),

 getStorage: async () => {await AstralStore.ready;const data=AstralStore.read();myNewTabWE.config=data.config;myNewTabWE.sites=data.sites},
 setStorage: isConfig => {try{const saved=AstralStore.write(isConfig?{config:myNewTabWE.config}:{sites:myNewTabWE.sites});if(isConfig)myNewTabWE.config=saved.config;const el=document.getElementById('save-status');if(el){el.textContent='保存中…';clearTimeout(myNewTabWE.saveStatusTimer);myNewTabWE.saveStatusTimer=setTimeout(()=>el.textContent='',1800)}return true}catch(e){const el=document.getElementById('save-status');if(el)el.textContent='保存失败';const previous=AstralStore.read();myNewTabWE.config=previous.config;myNewTabWE.sites=previous.sites;AstralStore.notify(e.message,'保存失败');queueMicrotask(()=>{myNewTabWE.initConf();myNewTabWE.renderSites()});return false}},

 initImportExport: () => {
  $id('import').addEventListener('click',()=>{if($id('import').disabled)return;upload.value='';upload.accept='.json,application/json';upload.onchange=async()=>{if(!upload.files?.[0])return;$id('import').disabled=true;try{
    const json=JSON.parse(await upload.files[0].text());
    // Validate before asking for geolocation, then resolve coordinates on the importing device.
    const data=AstralStore.validate(json);
    myNewTabWE.cancelLocation?.();
    let locationWarning='';
    if(data.config.weatherMode==='native'&&data.config.weatherLocationMode==='auto'){
      try{
        if(!window.isSecureContext||!navigator.geolocation)throw Error('当前环境不支持浏览器定位（需要 HTTPS 或 localhost）');
        const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:10000,maximumAge:300000}));
        data.config.weatherLatitude=pos.coords.latitude;data.config.weatherLongitude=pos.coords.longitude;
        data.config.weatherCity=await AstralWeather.resolveCity(pos.coords.latitude,pos.coords.longitude)||AstralWeather.coordinateLabel(pos.coords.latitude,pos.coords.longitude);
      }catch(e){
        // Do not retain possibly stale coordinates from another device when permission is denied.
        data.config.weatherLatitude=30.2741;
        data.config.weatherLongitude=120.1551;
        data.config.weatherCity='杭州';
        locationWarning='；自动定位未成功，已使用杭州作为默认位置，可在天气设置中重新定位';
      }
    }
    const imported=await AstralStore.importData(data);for(const id of ['weather-city','weather-lat','weather-lon'])delete $id(id).dataset.dirty;myNewTabWE.config=imported.config;myNewTabWE.sites=imported.sites;myNewTabWE.initConf();myNewTabWE.renderSites();dispatchEvent(new StorageEvent('storage',{key:'astral.web.settings'}));
    const syncNotice=imported.importOutcome?.uploadError?'；已保存本机，但云端上传失败：'+imported.importOutcome.uploadError:imported.importOutcome?.uploaded?'；已同步到云端':'；已保存本机（同步未开启）';
    AstralStore.notify('已导入 '+imported.sites.length+' 个分组，'+imported.sites.reduce((n,g)=>n+g.list.length,0)+' 个网址'+locationWarning+syncNotice,'导入成功');
   }catch(e){try{await chrome.storage.local.set({__astralImportFailure:{kind:'local',message:e.message||String(e),at:Date.now()}})}catch{}const meta=(await chrome.storage.local.get('__astralSync')).__astralSync;myNewTabWE.notify(e.message+(meta?.importBlocked?'；同步已暂停，请重试导入或手动开启同步':''),'导入配置失败')}finally{$id('import').disabled=false}};upload.click()});
  $id('export').addEventListener('click',async()=>{
   const button=$id('export');
   if(button.disabled)return;
   button.disabled=true;
   try{
    await AstralStore.flush();const data=AstralStore.read();
    // Export the stored location mode and coordinates as-is; never request permission on export.
    // Resolve missing icons only for the exported snapshot. Import and stored
    // configurations retain the existing lazy /favicon.ico fallback behavior.
    const {sites}=await AstralStore.exportSitesWithIcons(data.sites);
    const meta=(await chrome.storage.local.get('__astralSync')).__astralSync;
    const syncEnabled=meta ? !!meta.enabled && !meta.userDisabled && !meta.importBlocked : true;
    const config={...AstralCompat.portable(data.config),syncEnabled};
    AstralStore.download(new Blob([JSON.stringify({config,sites,css:data.css},null,2)+'\n'],{type:'application/json'}),'AstralNewTab.json');
    AstralStore.notify('已导出配置：自动发现的图标不嵌入，自定义图标按需压缩备份','导出成功');
   }catch(e){myNewTabWE.notify(e.message||String(e),'导出配置失败')}
   finally{button.disabled=false}
  });
 },

	initConf: () => {
        AstralWallpaper.configure(myNewTabWE.config).catch(console.warn);
		$id('newtab-open').checked = myNewTabWE.config.newTabOpen;
		$id('wallpaper-resolution').value = String(myNewTabWE.config.useBigImage);
		$id('bing-max-history').value = String(myNewTabWE.config.bingMaxHistory);
		$id('title').value = myNewTabWE.config.title;
  if(!$id('weather-city').dataset.dirty)$id('weather-city').value=myNewTabWE.config.weatherCity;
  if(!$id('weather-lat').dataset.dirty)$id('weather-lat').value=myNewTabWE.config.weatherLatitude;
  if(!$id('weather-lon').dataset.dirty)$id('weather-lon').value=myNewTabWE.config.weatherLongitude;
  const weatherMode=myNewTabWE.config.weatherMode;
  $id('weather-mode').value=weatherMode;
  $id('native-location-controls').hidden=weatherMode!=='native';
  const auto=myNewTabWE.config.weatherLocationMode==='auto';$id('location-auto').checked=auto;$id('location-manual').checked=!auto;$id('weather-manual-fields').hidden=auto;$id('location-refresh').hidden=!auto;$id('location-status').textContent=auto?'使用已保存的位置坐标':'';
	},

	renderSites: () => {
        const container=$id('sites');
        // The template must not be deleted when rebuilding after an import.
        container.querySelectorAll('[data-astral-group]').forEach(el=>el.remove());
        for (const group of myNewTabWE.sites) {
            const node=myNewTabWE.buildGroup(group);
            node.dataset.astralGroup='1';
            container.appendChild(node);
        }
    },
	initSites: () => {
        myNewTabWE.renderSites();
        $id('new-group').addEventListener('click',async()=>{
            const name=await myNewTabWE.editGroup('',true);if(name===null)return;
            myNewTabWE.sites=AstralStore.read().sites;
            myNewTabWE.sites.push({_syncId:crypto.randomUUID(),name,list:[]});
            if(!myNewTabWE.setStorage())return;myNewTabWE.renderSites();
            $id('sites').lastElementChild?.scrollIntoView({behavior:'smooth',block:'end'});
        });
	},

	initEdit: () => {
        $id('edit-upload').addEventListener('click',()=>{
            upload.value='';upload.accept='image/png,image/jpeg,image/webp,image/gif';
            upload.onchange=async()=>{
                const file=upload.files?.[0];if(!file)return;
                if(!file.type.startsWith('image/')||file.size>5*1024*1024){myNewTabWE.notify('仅支持 5 MB 以下的图片','图标上传');return}
                try{
                    const source=URL.createObjectURL(file);
                    try{
                        const img=new Image();img.src=source;await img.decode();
                        const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
                        const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法创建图片画布');
                        ctx.clearRect(0,0,64,64);const scale=Math.min(64/img.naturalWidth,64/img.naturalHeight);
                        const w=img.naturalWidth*scale,h=img.naturalHeight*scale;ctx.drawImage(img,(64-w)/2,(64-h)/2,w,h);
                        const result=canvas.toDataURL('image/png');if(result.length>120*1024)throw Error('压缩后的图标仍然过大');
                        $id('edit-icon').value=result;
                    }finally{URL.revokeObjectURL(source)}
                }catch(e){myNewTabWE.notify(e.message,'图标处理失败')}
            };upload.click();
        });
        $id('edit-modal').setAttribute('count','0');
		$id('edit-geticon').addEventListener('click', async () => {
   try {
    const url=new URL($id('edit-url').value);
    if(!['http:','https:'].includes(url.protocol))throw Error('仅支持 HTTP(S)');
    const original=$id('edit-url').value,modalCount=$id('edit-modal').getAttribute('count');
    const found=await AstralStore.resolveIcon({url:original});
    if($id('edit-url').value!==original||$id('edit-modal').getAttribute('count')!==modalCount)return;
    if(found){$id('edit-icon').value=found;$id('edit-icon').dataset.autoFound=found;myNewTabWE.notify('已获取并填写图标地址','网站图标')}
    else myNewTabWE.notify('图标服务未返回可用图片，可手动上传','网站图标');
   }
   catch(e){myNewTabWE.notify(e.message,'网址无效')}
  });
	},

	init: () => {
		myNewTabWE.initImportExport();
        $id('open-customize').addEventListener('click',()=>window.open('./customize.html','_blank','noopener'));
		myNewTabWE.initConf();
		myNewTabWE.confListener();
        $id('settings-fields').disabled=false;
		myNewTabWE.initSites();
		myNewTabWE.initEdit();
	},

	confListener: () => {
        $id('config-default').addEventListener('click',async()=>{
            if(myNewTabWE.editing||!await myNewTabWE.confirmDefaults())return;
            try{
                myNewTabWE.cancelLocation?.();for(const id of ['weather-city','weather-lat','weather-lon'])delete $id(id).dataset.dirty;
                const saved=await AstralStore.restorePreset();
                await AstralWallpaper.configure(saved.config,true);
                myNewTabWE.config=saved.config;
                myNewTabWE.sites=saved.sites;
                myNewTabWE.initConf();
                myNewTabWE.renderSites();
                dispatchEvent(new Event('astral-defaults-restored'));
                if(saved.uploadError)myNewTabWE.notify(saved.uploadError,'预设已恢复，云端同步失败');
            }catch(error){myNewTabWE.notify(error.message,'恢复默认未完全完成')}
        });
		$id('newtab-open').addEventListener('click', e => {
			myNewTabWE.config.newTabOpen = e.target.checked;
			if(!myNewTabWE.setStorage(true))return;
		});
		$id('wallpaper-resolution').addEventListener('change', e => {
			myNewTabWE.config.useBigImage = Number(e.target.value);
			if(!myNewTabWE.setStorage(true))return;
		});
		$id('bing-max-history').addEventListener('change', e => {
			myNewTabWE.config.bingMaxHistory = Number(e.target.value);
			if(!myNewTabWE.setStorage(true))return;
            AstralWallpaper.configure(myNewTabWE.config).catch(console.warn);
            dispatchEvent(new Event('astral-history-changed'));
		});
		$id('title').addEventListener('change', e => {
			myNewTabWE.config.title = e.target.value;
			if(!myNewTabWE.setStorage(true))return;
		});
  // Location is explicitly opt-in. Keep manual coordinates as a fallback.
  const city=$id('weather-city'),lat=$id('weather-lat'),lon=$id('weather-lon');
  const choices=$id('weather-candidates'),status=$id('location-status');
  const clearDraft=()=>{for(const el of [city,lat,lon])delete el.dataset.dirty};
  const commit=patch=>{try{clearDraft();myNewTabWE.config=AstralStore.write({config:{...AstralStore.read().config,...patch}}).config;myNewTabWE.initConf();return true}catch(e){myNewTabWE.notify(e.message,'天气设置保存失败');myNewTabWE.initConf();return false}};
  let locationRequest=0;
  for(const el of [city,lat,lon])el.addEventListener('input',()=>{el.dataset.dirty='1'});
  $id('weather-mode').addEventListener('change',e=>{++locationRequest;commit({weatherMode:e.target.value})});
  const locate=()=>{
    const request=++locationRequest;
    if(!navigator.geolocation){status.textContent='当前浏览器不支持定位';return}
    status.textContent='正在请求浏览器位置…';$id('location-refresh').disabled=true;
    navigator.geolocation.getCurrentPosition(async position=>{
      if(request!==locationRequest)return;
      const {latitude,longitude}=position.coords;
      status.textContent='定位成功，正在查询城市名称…';
      const resolved=await AstralWeather.resolveCity(latitude,longitude,true);
      if(request!==locationRequest)return;
      const cityName=resolved||AstralWeather.coordinateLabel(latitude,longitude);
      if(commit({weatherMode:'native',weatherLocationMode:'auto',weatherLatitude:latitude,weatherLongitude:longitude,weatherCity:cityName}))status.textContent=resolved?'定位成功：'+cityName:'已定位到 '+cityName+'，城市名称查询暂不可用，可重新定位重试';
      $id('location-refresh').disabled=false;
    },error=>{if(request!==locationRequest)return;status.textContent='定位失败：'+error.message+'；仍使用已保存坐标';$id('location-refresh').disabled=false;if(myNewTabWE.config.weatherLocationMode!=='auto')myNewTabWE.initConf()},
    {enableHighAccuracy:false,timeout:10000,maximumAge:1800000});
  };
  $id('location-auto').addEventListener('change',e=>{if(e.target.checked){$id('weather-manual-fields').hidden=true;$id('location-refresh').hidden=false;locate()}});
  $id('location-manual').addEventListener('change',e=>{if(e.target.checked){++locationRequest;$id('location-refresh').disabled=false;commit({weatherMode:'native',weatherLocationMode:'manual'});status.textContent='';++cityRequest;clearTimeout(cityTimer);cityController?.abort();hideChoices()}});
  $id('location-refresh').addEventListener('click',locate);
  const saveCoords=()=>{
    ++locationRequest;++cityRequest;clearTimeout(cityTimer);cityController?.abort();
    const latitude=Number(lat.value),longitude=Number(lon.value);
    if(!lat.value.trim()||!lon.value.trim()||!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180){myNewTabWE.notify('请输入有效的经纬度','天气设置');return}
    if(commit({weatherMode:'native',weatherLocationMode:'manual',weatherCity:city.value.trim()||'自定义坐标',weatherLatitude:latitude,weatherLongitude:longitude}))AstralStore.notify('经纬度已保存','天气设置');
  };
  lat.addEventListener('change',saveCoords);lon.addEventListener('change',saveCoords);
  let cityRequest=0,cityTimer=null,cityController=null;
  const hideChoices=()=>{choices.hidden=true;choices.replaceChildren();city.setAttribute('aria-expanded','false')};
  const chooseCity=r=>{
    ++locationRequest;
    ++cityRequest;clearTimeout(cityTimer);cityController?.abort();
    const shortName=String(r.name||'').trim();
    if(commit({weatherMode:'native',weatherLocationMode:'manual',weatherCity:shortName,weatherLatitude:r.latitude,weatherLongitude:r.longitude})){
      city.value=shortName;hideChoices();status.textContent='已选择：'+[r.name,r.admin1,r.country].filter(Boolean).join(' · ');
    }
  };
  const searchCity=async(name)=>{
    const requestId=++cityRequest;cityController?.abort();hideChoices();
    if(!name){status.textContent='';return}
    status.textContent='正在搜索城市…';
    const controller=new AbortController();cityController=controller;
    const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const candidates=await AstralWeather.searchCities(name,controller.signal);if(requestId!==cityRequest)return;
      if(!candidates.length){status.textContent='未找到匹配地点，可手动输入经纬度';return}
      for(const r of candidates){
        const option=document.createElement('button');option.type='button';option.className='city-suggestion';option.setAttribute('role','option');
        option.textContent=[r.name,r.admin1,r.country].filter(Boolean).join(' · ');
        option.addEventListener('click',()=>chooseCity(r));choices.append(option);
      }
      choices.hidden=false;city.setAttribute('aria-expanded','true');status.textContent='请选择下方匹配地点';
    }catch(e){if(requestId===cityRequest&&e.name!=='AbortError')status.textContent='城市搜索失败：'+e.message+'；可输入经纬度'}
    finally{clearTimeout(timer)}
  };
  city.addEventListener('input',()=>{++cityRequest;clearTimeout(cityTimer);cityController?.abort();hideChoices();const name=city.value.trim();if(!name){status.textContent='';return}cityTimer=setTimeout(()=>searchCity(name),350)});
  myNewTabWE.cancelLocation=()=>{++locationRequest;++cityRequest;clearTimeout(cityTimer);cityController?.abort();$id('location-refresh').disabled=false;$id('weather-location-save').disabled=false;hideChoices()};
  const saveManual=async()=>{
    ++locationRequest;clearTimeout(cityTimer);cityController?.abort();const request=++cityRequest;
    const name=city.value.trim(),button=$id('weather-location-save');
    const latitude=Number(lat.value),longitude=Number(lon.value);
    if(lat.dataset.dirty||lon.dataset.dirty||name===myNewTabWE.config.weatherCity){saveCoords();return}
    if(!name){status.textContent='请输入城市名称或经纬度';return}
    button.disabled=true;status.textContent='正在查找并保存城市…';
    const controller=new AbortController();cityController=controller;const timer=setTimeout(()=>controller.abort(),10000);
    try{
      const results=await AstralWeather.searchCities(name,controller.signal);if(request!==cityRequest)return;
      const result=results.find(r=>r.name===name)||results[0];
      if(!result||!Number.isFinite(result.latitude)||!Number.isFinite(result.longitude))throw Error('未找到城市，请选择搜索结果或输入经纬度');
      chooseCity(result);
    }catch(e){if(request===cityRequest)status.textContent='城市未保存：'+(e.name==='AbortError'?'查询超时，请重试':e.message)}
    finally{clearTimeout(timer);button.disabled=false}
  };
  $id('weather-location-save').addEventListener('click',saveManual);
  city.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();return saveManual()}});
  choices.addEventListener('pointerdown',e=>e.preventDefault());
  city.addEventListener('focus',()=>{if(city.value.trim()!==myNewTabWE.config.weatherCity)searchCity(city.value.trim())});
  city.addEventListener('keydown',e=>{if(e.key==='Escape')hideChoices();if(e.key==='ArrowDown'&&!choices.hidden){e.preventDefault();choices.querySelector('button')?.focus()}});
  choices.addEventListener('keydown',e=>{const items=[...choices.querySelectorAll('button')];const i=items.indexOf(document.activeElement);if(e.key==='ArrowDown'){e.preventDefault();items[Math.min(i+1,items.length-1)]?.focus()}else if(e.key==='ArrowUp'){e.preventDefault();if(i<=0)city.focus();else items[i-1].focus()}else if(e.key==='Escape'){hideChoices();city.focus()}});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.city-search-wrap'))hideChoices()});

	},
	buildGroup: group => {
		let node = $id('template-group').cloneNode(true);
		node.removeAttribute('id');
		node.removeAttribute('hidden');
		let table = node.querySelector('.group-table'),
			row = node.querySelector('.template-row');

		node.querySelector('.group-name').textContent = group.name;
		node.querySelector('.group-up').addEventListener('click', () => {
			let index = myNewTabWE.sites.indexOf(group);
			if (index) {   //不是第一个
				myNewTabWE.sites[index - 1] = myNewTabWE.sites.splice(index, 1, myNewTabWE.sites[index - 1])[0];
				if(!myNewTabWE.setStorage())return;
				node.parentNode.insertBefore(node, node.previousElementSibling);
				node.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		});
		node.querySelector('.group-down').addEventListener('click', () => {
			let index = myNewTabWE.sites.indexOf(group);
			if (index + 1 < myNewTabWE.sites.length) {   //不是最后一个
				myNewTabWE.sites[index + 1] = myNewTabWE.sites.splice(index, 1, myNewTabWE.sites[index + 1])[0];
				if(!myNewTabWE.setStorage())return;
				node.parentNode.insertBefore(node.nextElementSibling, node);
				node.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		});
		node.querySelector('.group-add').addEventListener('click', () => {
			let site = {
				_syncId:crypto.randomUUID(),
				title: '',
				url: '',
				icon: ''
			};
            myNewTabWE.editSite(site).then(ok=>{
                if(!ok)return;
                const latest=AstralStore.read().sites;
                const target=latest.find(g=>group._syncId?g._syncId===group._syncId:g.name===group.name);
                if(!target){myNewTabWE.notify('分组已被其他页面删除，请重新添加');return}
                target.list.push(site);myNewTabWE.sites=latest;if(myNewTabWE.setStorage())myNewTabWE.renderSites();
            });
		});
        node.querySelector('.group-rename').addEventListener('click',async()=>{
            const identity={id:group._syncId,name:group.name};
            const name=await myNewTabWE.editGroup(group.name);if(name===null)return;
            const latest=AstralStore.read().sites;
            const target=latest.find(g=>identity.id?g._syncId===identity.id:g.name===identity.name);
            if(!target){myNewTabWE.sites=latest;myNewTabWE.renderSites();myNewTabWE.notify('该分组已被其他页面删除','编辑未保存');return}
            target.name=name;myNewTabWE.sites=latest;if(myNewTabWE.setStorage())myNewTabWE.renderSites();
        });
		node.querySelector('.group-delete').addEventListener('click', () => {
			myNewTabWE.sites.splice(myNewTabWE.sites.indexOf(group), 1);
			if(!myNewTabWE.setStorage())return;
			$id('sites').removeChild(node);
		});
		for (let site of group.list) {
			table.appendChild(myNewTabWE.buildTr(site, group.list, row.cloneNode(true)));
		}
		return node;
	},
	buildTr: (site, list, node) => {
		node.removeAttribute('class');
		node.removeAttribute('hidden');
		let title = node.querySelector('.row-title'),
			img = node.querySelector('.row-icon img'),
			url = node.querySelector('.row-url');
		title.textContent = title.title = site.title;
		img.title = AstralStore.setFavicon(img,site,'../image/default.svg');
		url.textContent = url.title = site.url;
		node.querySelector('.row-up').addEventListener('click', () => {
			let index = list.indexOf(site);
			if (index) {   //不是第一个
				list[index - 1] = list.splice(index, 1, list[index - 1])[0];
				if(!myNewTabWE.setStorage())return;
				node.parentNode.insertBefore(node, node.previousElementSibling);
			}
		});
		node.querySelector('.row-down').addEventListener('click', () => {
			let index = list.indexOf(site);
			if (index + 1 < list.length) {   //不是最后一个
				list[index + 1] = list.splice(index, 1, list[index + 1])[0];
				if(!myNewTabWE.setStorage())return;
				node.parentNode.insertBefore(node.nextElementSibling, node);
			}
		});
        node.querySelector('.row-edit').addEventListener('click',()=>{
            const identity={id:site._syncId,url:site.url,title:site.title};
            myNewTabWE.editSite(site).then(ok=>{
                if(!ok)return;
                const latest=AstralStore.read().sites;
                const target=latest.flatMap(g=>g.list).find(s=>identity.id?s._syncId===identity.id:s.url===identity.url&&s.title===identity.title);
                if(!target){myNewTabWE.sites=latest;myNewTabWE.renderSites();myNewTabWE.notify('该网址已被其他页面删除，请重新添加','编辑未保存');return}
                Object.assign(target,{title:site.title,url:site.url,icon:site.icon,iconMode:site.iconMode});
                myNewTabWE.sites=latest;if(!myNewTabWE.setStorage())return;myNewTabWE.renderSites();
            });
        });
		node.querySelector('.row-delete').addEventListener('click', () => {
			list.splice(list.indexOf(site), 1);
			if(!myNewTabWE.setStorage())return;
			node.parentNode.removeChild(node);
		});
		return node;
	},
    confirmDefaults:()=>new Promise(resolve=>{
        const modal=$id('defaults-modal');myNewTabWE.editing=true;
        const finish=confirmed=>{modal.style.display='none';modal.onkeydown=null;$id('defaults-confirm').onclick=null;$id('defaults-cancel').onclick=null;myNewTabWE.editing=false;$id('config-default').focus();resolve(confirmed)};
        $id('defaults-confirm').onclick=()=>finish(true);$id('defaults-cancel').onclick=()=>finish(false);
        modal.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();finish(false)}else if(event.key==='Tab'){event.preventDefault();(event.target===$id('defaults-cancel')?$id('defaults-confirm'):$id('defaults-cancel')).focus()}};
        modal.style.display='flex';$id('defaults-cancel').focus();
    }),
    editGroup:(name='',creating=false)=>new Promise(resolve=>{
        const modal=$id('group-modal'),input=$id('group-name');myNewTabWE.editing=true;
        $id('group-modal-heading').textContent=creating?'新增分组':'编辑分组';input.value=name;
        const finish=value=>{modal.style.display='none';myNewTabWE.editing=false;modal.onkeydown=null;resolve(value);if(value===null)queueMicrotask(()=>dispatchEvent(new StorageEvent('storage',{key:'astral.web.settings'})))};
        $id('group-confirm').onclick=()=>finish(input.value.trim());$id('group-cancel').onclick=()=>finish(null);
        modal.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();finish(null)}else if(event.key==='Enter'){event.preventDefault();finish(input.value.trim())}};
        modal.style.display='flex';input.focus();input.select?.();
    }),
	editSite: site => {
        myNewTabWE.editing=true;
		return new Promise((resolve, reject) => {
			$id('edit-title').value = site.title;
			$id('edit-url').value = site.url;
			$id('edit-icon').value = site.icon || '';
            $id('edit-icon').dataset.autoFound = site.iconMode==='auto' ? (site.icon||'') : '';  
			$id('edit-geticon').textContent = '自动获取';
			$id('edit-confirm').onclick = async () => {
                const button=$id('edit-confirm');
                if(button.disabled)return;
                const icon=$id('edit-icon').value.trim();
                const automatic=!!icon && icon===$id('edit-icon').dataset.autoFound;
                if(icon && !automatic){
                    const validURL=(()=>{
                        if(/^data:image\/(?:png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)(?:;[^,]*)?,/i.test(icon))return true;
                        try{return ['http:','https:'].includes(new URL(icon).protocol)}catch(_){return false}
                    })();
                    if(!validURL){myNewTabWE.notify('请输入有效的 HTTP(S) 图片地址或图片 Data URL','图标地址无效');return}
                    button.disabled=true;
                    try{
                        const img=new Image();
                        img.src=icon;
                        await Promise.race([img.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('图片加载超时')),8000))]);
                        if(!img.naturalWidth)throw Error('无法解码图片');
                    }catch(e){myNewTabWE.notify('图标无法加载：'+e.message,'图标验证失败');return}
                    finally{button.disabled=false}
                }
				myNewTabWE.editing=false;
                site.title = $id('edit-title').value;
				site.url = $id('edit-url').value;
				site.icon = icon;
                site.iconMode = site.icon && site.icon === $id('edit-icon').dataset.autoFound ? 'auto' : 'custom';
				$id('edit-modal').style.display = 'none';
				$id('edit-modal').setAttribute('count', parseInt($id('edit-modal').getAttribute('count')) + 1);
				resolve(true);
			};
			$id('edit-cancel').onclick = () => {
                myNewTabWE.editing=false;
                queueMicrotask(()=>dispatchEvent(new StorageEvent('storage',{key:'astral.web.settings'})));
				$id('edit-modal').style.display = 'none';
				$id('edit-modal').setAttribute('count', parseInt($id('edit-modal').getAttribute('count')) + 1);
				resolve(false);
			};
			$id('edit-modal').style.display = 'flex';
			$id('edit-title').focus();
		});
	}
};

myNewTabWE.getStorage().then(myNewTabWE.init).catch(e=>{console.error('Astral 选项初始化失败',e);AstralStore.notify(e.message,'选项初始化失败')});

addEventListener('storage',()=>{
 const data=AstralStore.read();
 if(!AstralCompat.equal(myNewTabWE.config,data.config)){myNewTabWE.config=data.config;myNewTabWE.initConf()}
 if(!myNewTabWE.editing&&!AstralCompat.equal(myNewTabWE.sites,data.sites)){myNewTabWE.sites=data.sites;myNewTabWE.renderSites()}
});
