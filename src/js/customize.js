/* Homepage CSS editor. Weather customization is no longer supported. */
'use strict';
const $id=id=>document.getElementById(id);
const LAST_MODIFY_CSS_VERSION='1.12.5';
(async()=>{
 await AstralStore.ready;
 const saved=AstralStore.read().css,editor=$id('index-css');
 editor.value=saved.index||'';
 const adjust=()=>{editor.rows=Math.max(12,editor.value.split('\n').length)};
 if(saved.index&&saved.version!==LAST_MODIFY_CSS_VERSION)$id('tips').textContent='主页默认样式已更新，请检查定制 CSS 是否需要调整';
 let defaultCSS='';
 try{const response=await fetch('../css/index.css');if(!response.ok)throw Error('无法读取默认样式');defaultCSS=await response.text()}catch(error){AstralStore.notify(error.message,'默认样式加载失败')}
 $id('index-default').addEventListener('click',()=>{if(!editor.value||confirm('是否加载默认 CSS？')){editor.value=defaultCSS;adjust()}});
 $id('index-save').addEventListener('click',async()=>{try{AstralStore.write({css:{...AstralStore.read().css,index:editor.value,version:editor.value?LAST_MODIFY_CSS_VERSION:0}});await AstralStore.flush();AstralStore.notify('已保存','主页 CSS')}catch(error){AstralStore.notify(error.message,'保存失败')}});
 editor.addEventListener('input',adjust);
 editor.addEventListener('keydown',event=>{if(event.key!=='Tab')return;event.preventDefault();const start=editor.selectionStart,end=editor.selectionEnd;editor.value=editor.value.slice(0,start)+'\t'+editor.value.slice(end);editor.selectionStart=editor.selectionEnd=start+1;adjust()});
 adjust();
})();
