/**************************************************
* 	myNewTabWE by sakuyaa.
*	
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
		useBigImage: 2,   //bing图片的尺寸，0为默认的1366x768，1为1920x1080，2为UHD
		userImage: false,   //使用自定义壁纸
		userImageSrc: '',   //自定义壁纸的URL
		weatherSrc: 'https://i.tianqi.com/index.php?c=code&id=8&num=3'   //天气代码的URL
	},
	sites: [],
	css: {
		index: '',
		weather: ''
	}
};

let myNewTabWE = {
	bingIndex: 0,   //Bing图片历史天数
	config: {},
	sites: [],
	css: {
		index: '',
		weather: ''
	},

	//显示桌面通知
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
			chrome.storage.local.get(DEFAULT_CONFIG, (storage) => {
				if (chrome.runtime.lastError) {
					myNewTabWE.notify(chrome.runtime.lastError.message, '获取myNewTabWE配置失败');
					reject(chrome.runtime.lastError);
					return;
				}
				myNewTabWE.config = storage.config || DEFAULT_CONFIG.config;
				myNewTabWE.sites = storage.sites || DEFAULT_CONFIG.sites;
				myNewTabWE.css = storage.css || DEFAULT_CONFIG.css;
				resolve();
			});
		});
	},


	//初始化css
	initCss: () => {
		if (myNewTabWE.css.index) {
			let style = document.createElement('style');
			style.appendChild(document.createTextNode(myNewTabWE.css.index));
			document.head.appendChild(style);
		} else {
			let link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = '../css/index.css';
			document.head.appendChild(link);
		}
	},
	//初始化日期
	initDate: () => {
		let date = Solar.getSolar(new Date());
		$id('solar-date').textContent = date.date;
		$id('solar-festival').textContent = date.festival;
		$id('solar-holiday').textContent = date.holiday;
		date = Lunar.getLunar(new Date());
		$id('lunar-date').textContent = date.date;
		$id('lunar-festival').textContent = date.festival;
		$id('lunar-holiday').textContent = date.holiday;
	},
	//初始化导航网址
	initSite: () => {
		let table = $id('navtable');
		for (let list of myNewTabWE.sites) {
			if (list.name.toLowerCase() == 'yooo') {   //神秘的代码
				let yooo = myNewTabWE.buildTr(list);
				yooo.setAttribute('hidden', 'hidden');
				yooo.setAttribute('name', 'yooo');
				table.appendChild(yooo);
			} else {
				table.appendChild(myNewTabWE.buildTr(list));
			}
		}
	},
	//初始化监听器
	initListener: () => {
		//神秘的代码
		addEventListener('keydown', e => {
			if ((e.key.toLowerCase() == 'q') && e.ctrlKey) {
				for (let yooo of document.getElementsByName('yooo')) {
					yooo.removeAttribute('hidden');
				}
			}
		});
		addEventListener('keyup', e => {
			for (let yooo of document.getElementsByName('yooo')) {
				yooo.setAttribute('hidden', 'hidden');
			}
		});

		$id('change').addEventListener('click', () => {
			if (myNewTabWE.isNewDate()) {
				myNewTabWE.bingIndex = 0;   //过0点重新获取
			} else {
				myNewTabWE.bingIndex++;
			}
			myNewTabWE.getBingImage();
		});

		// 下载背景图片
		$id('download').addEventListener('click', (event) => {
			event.preventDefault(); // Prevent default navigation for href="#"
			const imageSrc = localStorage.getItem('imageSrc');
			const imageName = localStorage.getItem('imageName');
			if (imageSrc && imageName) {
				const filename = myNewTabWE.config.downloadDir ? `${myNewTabWE.config.downloadDir}/${imageName}` : imageName;
				chrome.downloads.download({
					conflictAction: 'overwrite',
					filename,
					url: imageSrc
				}, (downloadId) => {
					if (chrome.runtime.lastError) {
						myNewTabWE.notify(chrome.runtime.lastError.message, '下载失败');
						return;
					}
					myNewTabWE.notify('下载已开始', '下载壁纸');
				});
			} else {
				myNewTabWE.notify('没有可下载的图片', '下载失败');
			}
		});

		//自动判断并切换天气、日期和壁纸
		let lastCheckTime = new Date();
		setInterval(async () => {
			let now = new Date();
			if (now.getDate() != lastCheckTime.getDate()) {   //第二天
				myNewTabWE.initDate();
			}
			if (now.getDate() != lastCheckTime.getDate() || (now.getTime() - lastCheckTime.getTime()) >= 3600000) {   //第二天或间隔一小时
				lastCheckTime = now;
				if (myNewTabWE.config.weatherSrc) {
					await myNewTabWE.delay(9876);   //延迟获取避免刚唤醒后没有网络
					$id('weather').src = myNewTabWE.config.weatherSrc;
				}
			}
			if (!myNewTabWE.config.userImage && myNewTabWE.config.autoChange && myNewTabWE.isNewDate()) {
				await myNewTabWE.delay(9876);   //延迟获取避免刚唤醒后没有网络
				myNewTabWE.bingIndex = 0;
				myNewTabWE.getBingImage();
			}
		}, 60000);
	},
	//初始化背景图片
	initImage: () => {
		if (myNewTabWE.config.userImage) {   //使用自定义壁纸
			document.body.style.backgroundImage = `url("${myNewTabWE.config.userImageSrc}")`;
			$id('download').setAttribute('hidden', 'hidden');
		} else {
			let imageSrc = localStorage.getItem('imageSrc');
			if (imageSrc) {
				document.body.style.backgroundImage = `url("${imageSrc}")`;
				$id('download').setAttribute('download', localStorage.getItem('imageName'));
				if (imageSrc.startsWith('http')) {
					$id('download').setAttribute('href', imageSrc);
				} else {
					$id('download').setAttribute('href', URL.createObjectURL(myNewTabWE.dataURItoBlob(imageSrc)));
				}
				if (myNewTabWE.config.autoChange && myNewTabWE.isNewDate()) {
					myNewTabWE.getBingImage();   //过0点重新获取
				}
			} else {
				myNewTabWE.getBingImage();
			}
		}
	},
	//初始化天气
	initWeather: () => {
		return new Promise((resolve, reject) => {
			$id('weather').onload = async () => {
				for (let tab of await chrome.tabs.query({ url: chrome.runtime.getURL('html/index.html') })) {
					for (let frame of await chrome.webNavigation.getAllFrames({ tabId: tab.id })) {
						if (frame.frameId) {
							//天气页面插入css
							if (myNewTabWE.css.weather) {
								await chrome.scripting.insertCSS({
									target: {
										tabId: tab.id,
										frameIds: [frame.frameId]
									},
									css: myNewTabWE.css.weather,
									origin: 'USER',
									injectAt: 'document_start'
								});
							} else {
								await chrome.scripting.insertCSS({
									target: {
										tabId: tab.id,
										frameIds: [frame.frameId]
									},
									files: [chrome.runtime.getURL('css/weather.css')],
									origin: 'USER',
									injectAt: 'document_start'
								});
							}
							//自动适应页面大小
							let size = (await chrome.scripting.executeScript({
								target: {
									tabId: tab.id,
									frameIds: [frame.frameId]
								},
								func: () => [document.body.scrollHeight, document.body.scrollWidth],
								injectAt: 'document_end'
							}))[0].result;
							$id('weather').style.height = size[0] + 'px';
							$id('weather').style.width = size[1] + 'px';
						}
					}
				}
			};
			$id('weather').src = myNewTabWE.config.weatherSrc;
			resolve();
		});

	},

	init: () => {
		document.title = myNewTabWE.config.title;
		myNewTabWE.initCss();
		myNewTabWE.initDate();
		myNewTabWE.initSite();
		myNewTabWE.initListener();
		myNewTabWE.initImage();

		if (myNewTabWE.config.weatherSrc) {
			myNewTabWE.initWeather().then(null, e => {
				console.log('天气栏css加载失败：' + e);
			});
		}
	},

	getBingImage: async () => {
		let data, url, image;
		try {
			data = (await myNewTabWE.httpRequest(`https://cn.bing.com/HPImageArchive.aspx?format=js&n=1&mkt=zh-CN&idx=${myNewTabWE.bingIndex % myNewTabWE.config.bingMaxHistory}`,
				'json', 'https://cn.bing.com/')).images[0];
			url = 'https://cn.bing.com' + data.urlbase;
			if (myNewTabWE.config.useBigImage == 2) {
				url += '_UHD.jpg';
			} else if (myNewTabWE.config.useBigImage == 1) {
				url += '_1920x1080.jpg';
			} else if (myNewTabWE.config.useBigImage == 0) {
				url += '_1366x768.jpg';
			}
			image = await myNewTabWE.httpRequest(url, 'blob', 'https://cn.bing.com/');
		} catch (e) {
			myNewTabWE.notify(e, '获取图片失败');
			return;
		}
		let reader = new FileReader();
		reader.onload = () => {
			document.body.style.backgroundImage = `url("${reader.result}")`;

			//保存图片和获取时间
			localStorage.setItem('lastCheckTime', Date.now());
			let imageName = data.enddate + '-' +
				data.copyright.replace(/\(.*?\)/g, '').trim()
					.replace(/(\\|\/|\*|\|)/g, '')   //Win文件名不能包含下列字符
					.replace(/:/g, '：')
					.replace(/\?/g, '？')
					.replace(/("|<|>)/g, '\'') + '.jpg';
			localStorage.setItem('imageName', imageName);
			if (myNewTabWE.config.useBigImage > 1) {   //UHD大小超出localStorage限制
				localStorage.setItem('imageSrc', url);
			} else {
				localStorage.setItem('imageSrc', reader.result);
			}


			//设置图片下载链接
			$id('download').setAttribute('download', imageName);
			$id('download').setAttribute('href', URL.createObjectURL(image));
			//自动下载壁纸
			if (myNewTabWE.config.autoDownload) {
				if (myNewTabWE.config.downloadDir) {
					imageName = myNewTabWE.config.downloadDir + '/' + imageName;
				}
				chrome.downloads.download({
					conflictAction: 'overwrite',   //覆盖旧文件避免出现重复文件
					filename: imageName,
					url: URL.createObjectURL(image)
				});
			}
		};
		reader.readAsDataURL(image);
	},

	buildTr: list => {
		let tr = document.createElement('tr'),
			th = document.createElement('th'),
			td, a, img, textNode, path;

		//添加分类
		th.textContent = list.name;
		tr.appendChild(th);

		//添加站点
		for (let site of list.list) {
			td = document.createElement('td');
			a = document.createElement('a');
			img = document.createElement('img');
			textNode = document.createTextNode(site.title);

			a.setAttribute('href', site.url);
			if (myNewTabWE.config.newTabOpen) {
				a.setAttribute('target', '_blank');
			}
			img.src = site.icon ? site.icon : '../image/default.svg';

			a.appendChild(img);
			a.appendChild(textNode);
			td.appendChild(a);
			tr.appendChild(td);
		}
		return tr;
	},

	dataURItoBlob: dataURI => {
		let byteString = atob(dataURI.substring(dataURI.indexOf(',') + 1));
		let arrayBuffer = new ArrayBuffer(byteString.length);
		let array = new Uint8Array(arrayBuffer);
		for (let i = 0; i < byteString.length; i++) {
			array[i] = byteString.charCodeAt(i);
		}
		return new Blob([arrayBuffer], { type: dataURI.substring(dataURI.indexOf(':') + 1, dataURI.indexOf(';')) });
	},

	isNewDate: item => {
		let today = new Date();
		today.setHours(0, 0, 0);   //毫秒就不管了
		if (new Date(parseInt(localStorage.getItem(item ? item : 'lastCheckTime'))) < today) {
			return true;
		}
		return false;
	},

	delay: async time => {
		let now = new Date();
		await new Promise(resolve => setTimeout(resolve, time));
		if ((new Date()).getTime() - now.getTime() - time > 999) {
			//延迟的时间比预定的还久的话，怀疑是中间电脑睡眠了，重新延迟
			return await myNewTabWE.delay(time);
		}
	},

	httpRequest: (url, type, referrer) => {
		return new Promise((resolve, reject) => {
			let xhr = new XMLHttpRequest();
			if (type) {
				xhr.responseType = type;
			}
			xhr.open('GET', url);
			if (referrer) {
				xhr.setRequestHeader('referrer', referrer);
			}
			xhr.onload = () => {
				if (xhr.status == 200) {
					resolve(xhr.response);
				} else {
					reject(new Error(xhr.statusText));
				}
			};
			xhr.onerror = () => {
				reject(new Error('网络错误'));
			};
			xhr.send(null);
		});
	}
};

myNewTabWE.getStorage().then(myNewTabWE.init);
