/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
*   Fork from sakuyaa's Firefox Extension myNewTabWE.
*	https://github.com/sakuyaa/
**************************************************/
'use strict';

//简化函数
const $id = id => document.getElementById(id);
const DEFAULT_CONFIG = {
	config: {
		autoChange: true,   //自动切换壁纸
		autoDownload: false,   //自动下载壁纸
		bingMaxHistory: 8,   //最大历史天数，可设置[2, 8]
		downloadDir: 'bingImg',   //相对于浏览器下载文件夹的目录
		newTabOpen: true,   //是否新标签页打开导航链接
		title: '我的主页',   //网页标题
		useBigImage: 2,   //bing图片的尺寸，0为1366x768，1为1920x1080，2为UHD
		userImage: false,   //使用自定义壁纸
		userImageSrc: '',   //自定义壁纸的URL
		weatherSrc: 'https://i.tianqi.com/index.php?c=code&id=8&num=3'   //天气代码的URL
	},
	sites: []
};
let upload = $id('upload');

let myNewTabWE = {
	config: {},
	sites: [],

	notify: (message, title) => {
		chrome.notifications.create({
			type: 'basic',
			message: message + '',
			title: title,
			iconUrl: chrome.runtime.getURL('image/home.svg')
		});
	},

	//获取参数
	getStorage: () => {
		return new Promise((resolve, reject) => {
			chrome.storage.local.get(DEFAULT_CONFIG).then(storage => {
				myNewTabWE.config = storage.config;
				myNewTabWE.sites = storage.sites;
				resolve();
			}, e => {
				myNewTabWE.notify(e, '获取配置失败');
				resolve(false);
			});
		});
	},
	setStorage: isConfig => {
		if (isConfig) {   //保存配置
			chrome.storage.local.set({ config: myNewTabWE.config }).then(null, e => {
				myNewTabWE.notify(e, '设置配置失败');
			});
		} else {   //保存网址列表
			chrome.storage.local.set({ sites: myNewTabWE.sites }).then(null, e => {
				myNewTabWE.notify(e, '设置配置失败');
			});
		}
	},

	// 导入旧版与新版统一格式；原始旧图标另存本机备份。
	initImportExport: () => {
		$id('import').addEventListener('click', () => {
			upload.setAttribute('accept', 'application/json,.json');
			upload.value = '';
			upload.onchange = async () => {
				if (!upload.files?.[0]) return;
				try {
					const parsed = JSON.parse(await upload.files[0].text());
                    // Commit first. Online icon comparison must never gate configuration import.
                    const {data,originalIcons} = AstralBackup.migrate(parsed);
                    const current = await chrome.storage.local.get(['config','sites','css','__astralSync']);
                    const result = await AstralSync.importConfig(data,originalIcons);
                    if (result.uploaded) alert('配置已导入本机，并已上传云端。');
                    else if (result.uploadError) alert('配置已导入本机，但云端上传失败。请检查同步状态后重试：'+result.uploadError);
                    else if (result.remoteDisabled) alert('配置已导入本机。云端已全局关闭同步，因此未上传。');
                    else alert('配置已导入本机。自动同步当前关闭，未上传云端。');
					location.reload();
				} catch(e) { alert('导入配置失败：'+(e.message||e)); }
			};
			upload.click();
		});
		$id('export').addEventListener('click', async () => {
			try {
				const stored = await chrome.storage.local.get(['config','sites','css']);
				const data = AstralBackup.exportData({
					config:stored.config || myNewTabWE.config,
					sites:stored.sites || myNewTabWE.sites,
					css:stored.css || {version:0,index:'',weather:''}
				});
				const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
				await chrome.downloads.download({filename:'AstralNewTab.json',url,saveAs:true});
				setTimeout(()=>URL.revokeObjectURL(url),60000);
			} catch(e) { alert('导出配置失败：'+(e.message||e)); }
		});
	},

	//初始化选项
	initConf: () => {
		$id('newtab-open').checked = myNewTabWE.config.newTabOpen;
		if (myNewTabWE.config.bingMaxHistory > 8 || myNewTabWE.config.bingMaxHistory < 2) {
			myNewTabWE.config.bingMaxHistory = 8;
			myNewTabWE.setStorage(true);
		}
		$id('bing-max-history').value = myNewTabWE.config.bingMaxHistory;
		if (myNewTabWE.config.useBigImage == 2) {
			$id('UHD').checked = true;
		} else if (myNewTabWE.config.useBigImage == 1) {
			$id('1920').checked = true;
		} else if (myNewTabWE.config.useBigImage == 0) {
			$id('1366').checked = true;
		}
		$id('auto-change').checked = myNewTabWE.config.autoChange;
		$id('auto-download').checked = myNewTabWE.config.autoDownload;
		$id('download-dir').value = myNewTabWE.config.downloadDir;
		$id('user-image').checked = myNewTabWE.config.userImage;
		$id('user-image-src').value = myNewTabWE.config.userImageSrc;
		$id('title').value = myNewTabWE.config.title;
		$id('weather-src').value = myNewTabWE.config.weatherSrc;
	},
	//初始化导航网址
	initSites: () => {
		for (let group of myNewTabWE.sites) {
			$id('sites').appendChild(myNewTabWE.buildGroup(group));
		}
		$id('new-group').addEventListener('click', () => {
			let name = prompt('请输入分组名');
			if (name != null) {
				let group = {
					name: name,
					list: []
				};
				myNewTabWE.sites.push(group);
				myNewTabWE.setStorage();
				let node = myNewTabWE.buildGroup(group);
				$id('sites').appendChild(node);
				node.scrollIntoView({ behavior: 'smooth', block: 'end' });   //与滚动区的可视区域的底端对齐
			}
		});
	},
	//初始化编辑界面
	initEdit: () => {
		$id('edit-upload').addEventListener('click', () => {
			upload.setAttribute('accept', 'image/*');
			upload.onchange = () => {
				let reader = new FileReader();
				reader.onload = async () => {
                    try { $id('edit-icon').value = await AstralImages.compactDataUrl(reader.result);
                    $id('edit-icon').dataset.iconMode = 'custom'; }
                    catch (e) { console.warn('图标压缩失败，保留原图', e); $id('edit-icon').value = reader.result; $id('edit-icon').dataset.iconMode = 'custom'; }
                };
				reader.readAsDataURL(upload.files[0]);
			};
			upload.click();
		});
        $id('edit-geticon').addEventListener('click', () => {
            const icon = AstralIcons.url($id('edit-url').value);
            if (!icon) {
                myNewTabWE.notify($id('edit-url').value, '不是标准http网址');
                return;
            }
            $id('edit-icon').value = icon;
            $id('edit-icon').dataset.iconMode = 'auto';
        });

	},

	init: () => {
		myNewTabWE.initImportExport();
		myNewTabWE.initConf();
		myNewTabWE.confListener();
		myNewTabWE.initSites();
		myNewTabWE.initEdit();
	},

	//初始化选项事件
	confListener: () => {
		$id('config-default').addEventListener('click', e => {
			if (confirm('是否恢复默认选项？')) {
				myNewTabWE.config = DEFAULT_CONFIG.config;
				myNewTabWE.setStorage(true);
				myNewTabWE.initConf();   //重新初始化选项
			}
		});
		$id('newtab-open').addEventListener('click', e => {
			myNewTabWE.config.newTabOpen = e.target.checked;
			myNewTabWE.setStorage(true);
		});
		$id('bing-max-history').addEventListener('change', e => {
			myNewTabWE.config.bingMaxHistory = e.target.value;
			myNewTabWE.setStorage(true);
		});
		$id('UHD').addEventListener('click', () => {
			myNewTabWE.config.useBigImage = 2;
			myNewTabWE.setStorage(true);
		});
		$id('1920').addEventListener('click', () => {
			myNewTabWE.config.useBigImage = 1;
			myNewTabWE.setStorage(true);
		});
		$id('1366').addEventListener('click', () => {
			myNewTabWE.config.useBigImage = 0;
			myNewTabWE.setStorage(true);
		});
		$id('auto-change').addEventListener('click', e => {
			myNewTabWE.config.autoChange = e.target.checked;
			myNewTabWE.setStorage(true);
		});
		$id('auto-download').addEventListener('click', e => {
			myNewTabWE.config.autoDownload = e.target.checked;
			myNewTabWE.setStorage(true);
		});
		$id('download-dir').addEventListener('change', e => {
			myNewTabWE.config.downloadDir = e.target.value;
			myNewTabWE.setStorage(true);
		});
		$id('user-image').addEventListener('click', e => {
			myNewTabWE.config.userImage = e.target.checked;
			myNewTabWE.setStorage(true);
		});
		$id('image-upload').addEventListener('click', e => {
			upload.setAttribute('accept', 'image/*');
			upload.onchange = () => {
				let reader = new FileReader();
				reader.onload = () => {
					$id('user-image-src').value = myNewTabWE.config.userImageSrc = reader.result;
					myNewTabWE.setStorage(true);
				};
				reader.readAsDataURL(upload.files[0]);
			};
			upload.click();
		});
		$id('user-image-src').addEventListener('change', e => {
			myNewTabWE.config.userImageSrc = e.target.value;
			myNewTabWE.setStorage(true);
		});
		$id('title').addEventListener('change', e => {
			myNewTabWE.config.title = e.target.value;
			myNewTabWE.setStorage(true);
		});
		$id('weather-src').addEventListener('change', e => {
			myNewTabWE.config.weatherSrc = e.target.value;
			myNewTabWE.setStorage(true);
		});
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
				myNewTabWE.setStorage();
				node.parentNode.insertBefore(node, node.previousElementSibling);
				node.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		});
		node.querySelector('.group-down').addEventListener('click', () => {
			let index = myNewTabWE.sites.indexOf(group);
			if (index + 1 < myNewTabWE.sites.length) {   //不是最后一个
				myNewTabWE.sites[index + 1] = myNewTabWE.sites.splice(index, 1, myNewTabWE.sites[index + 1])[0];
				myNewTabWE.setStorage();
				node.parentNode.insertBefore(node.nextElementSibling, node);
				node.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		});
		node.querySelector('.group-add').addEventListener('click', () => {
			let site = {
				title: '',
				url: '',
				icon: ''
			};
			myNewTabWE.editSite(site).then(confirmed => {
                if (!confirmed) return;
				group.list.push(site);
				myNewTabWE.setStorage();
				let node = myNewTabWE.buildTr(site, group.list, row.cloneNode(true));
				table.appendChild(node);
				node.scrollIntoView({ behavior: 'smooth', block: 'end' });   //与滚动区的可视区域的底端对齐
			});
		});
		node.querySelector('.group-rename').addEventListener('click', () => {
			let name = prompt('请输入分组名', group.name);
			if (name != null) {
				group.name = name;
				myNewTabWE.setStorage();
				node.querySelector('.group-name').textContent = group.name;
			}
		});
		node.querySelector('.group-delete').addEventListener('click', () => {
			myNewTabWE.sites.splice(myNewTabWE.sites.indexOf(group), 1);
			myNewTabWE.setStorage();
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
		AstralIcons.apply(img, site);
        img.title = site.url;
		url.textContent = url.title = site.url;
		node.querySelector('.row-up').addEventListener('click', () => {
			let index = list.indexOf(site);
			if (index) {   //不是第一个
				list[index - 1] = list.splice(index, 1, list[index - 1])[0];
				myNewTabWE.setStorage();
				node.parentNode.insertBefore(node, node.previousElementSibling);
			}
		});
		node.querySelector('.row-down').addEventListener('click', () => {
			let index = list.indexOf(site);
			if (index + 1 < list.length) {   //不是最后一个
				list[index + 1] = list.splice(index, 1, list[index + 1])[0];
				myNewTabWE.setStorage();
				node.parentNode.insertBefore(node.nextElementSibling, node);
			}
		});
		node.querySelector('.row-edit').addEventListener('click', () => {
			myNewTabWE.editSite(site).then(confirmed => {
                if (!confirmed) return;
				title.textContent = title.title = site.title;
				AstralIcons.apply(img, site);
                img.title = site.url;
				url.textContent = url.title = site.url;
				myNewTabWE.setStorage();
			});
		});
		node.querySelector('.row-delete').addEventListener('click', () => {
			list.splice(list.indexOf(site), 1);
			myNewTabWE.setStorage();
			node.parentNode.removeChild(node);
		});
		return node;
	},
	editSite: site => {
		return new Promise((resolve, reject) => {
			$id('edit-title').value = site.title;
			$id('edit-url').value = site.url;
			$id('edit-icon').value = AstralIcons.mode(site) === 'auto' ? AstralIcons.url(site.url) : (site.icon || '');
            $id('edit-icon').dataset.iconMode = AstralIcons.mode(site);
			$id('edit-geticon').textContent = '自动获取';
			$id('edit-icon').oninput = () => { $id('edit-icon').dataset.iconMode = 'custom'; };
            $id('edit-confirm').onclick = () => {
				site.title = $id('edit-title').value;
				site.url = $id('edit-url').value;
				site.iconMode = $id('edit-icon').dataset.iconMode === 'auto' ? 'auto' : 'custom';
                site.icon = site.iconMode === 'auto' ? '' : $id('edit-icon').value;
				$id('edit-modal').style.display = 'none';
				$id('edit-modal').setAttribute('count', parseInt($id('edit-modal').getAttribute('count')) + 1);
				resolve(true);
			};
			$id('edit-cancel').onclick = () => {
				$id('edit-modal').style.display = 'none';
				$id('edit-modal').setAttribute('count', parseInt($id('edit-modal').getAttribute('count')) + 1);
				resolve(false);
			};
			$id('edit-modal').style.display = 'flex';
			$id('edit-title').focus();
		});
	}
};

myNewTabWE.getStorage().then(myNewTabWE.init).catch(e => console.error('Astral options initialization failed:',e));
