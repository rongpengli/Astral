/* Compact sync controls share the same row and native selects as other options. */
'use strict';
(async()=>{
 await AstralStore.ready;
 const el=id=>document.getElementById(id);
 const state=async()=> (await chrome.storage.local.get('__astralSync')).__astralSync||{enabled:true,status:'pending'};
 let busy=false,desired=null,renderSerial=0,actionSerial=0;
 const descriptions={'preset-choice':'已载入默认配置。请选择本机上传或云端恢复。',off:'已关闭','waiting-cloud':'等待云端配置',pending:'待同步',syncing:'同步中…',synced:'已同步',error:'同步失败',conflict:'配置冲突'};
 async function render(){
  const serial=++renderSerial,s=await state();if(serial!==renderSerial)return;
  const enabled=desired===null?!!s.enabled&&!s.userDisabled&&!s.importBlocked:desired;
  el('astral-sync-mode').value=enabled?'on':'off';
  el('astral-sync-tools').hidden=!(s.enabled&&!s.userDisabled&&!s.importBlocked&&desired!==false);
  for(const id of ['astral-sync-push','astral-sync-pull'])el(id).disabled=busy;
  el('astral-sync-mode').disabled=false;
  el('astral-sync-retry').disabled=busy||!enabled;
  el('astral-sync-status').textContent=busy?'处理中…':descriptions[s.status]||s.status||'已关闭';
  el('astral-sync-time').textContent=s.lastSuccess?'上次同步：'+new Date(s.lastSuccess).toLocaleString():'';
  el('astral-sync-retry-info').textContent=s.status==='error'&&s.nextRetry?'预计重试：'+new Date(s.nextRetry).toLocaleString():'';
  const detail=[s.error,s.conflicts?.length?'冲突字段：'+s.conflicts.join('、'):''].filter(Boolean).join('；');
  el('astral-sync-detail').textContent=detail;el('astral-sync-detail').hidden=!detail;
 }
 async function action(action,enabled=null,successMessage=null){
  if(busy&&action!=='disable')return;
  const serial=++actionSerial;busy=true;desired=enabled;
  try{await render();if(action!=='disable'){await AstralStore.ready;await AstralStore.flush()}const result=await chrome.runtime.sendMessage({type:'ASTRAL_SYNC_COMMAND',action});if(!result?.ok)throw Error(result?.error||'同步失败');if(successMessage&&serial===actionSerial)AstralStore.notify(successMessage,'同步已关闭')}
  catch(error){if(serial===actionSerial)AstralStore.notify(error.message||String(error),'同步失败')}
  finally{if(serial===actionSerial){busy=false;desired=null;await render()}}
 }
 el('astral-sync-mode').addEventListener('change',async()=>{
  if(el('astral-sync-mode').value==='on'){action('enable',true);return}
  const s=await state(),failure=(await chrome.storage.local.get('__astralImportFailure')).__astralImportFailure;
  const cloudPending=!!s.importUploadPending||failure?.kind==='cloud';
  if(cloudPending||failure){
   const prompt=cloudPending?'配置已导入本机，但尚未同步成功。关闭同步将停止自动重试，是否继续？':'最近一次配置导入失败，是否关闭同步？';
   if(!confirm(prompt)){await render();return}
  }
  action('disable',false,cloudPending?'本机配置已保留，未完成的上传已停止自动重试':failure?'最近一次导入未成功，请检查文件后重新导入':null);
 });
 el('astral-sync-retry').addEventListener('click',()=>action('run'));
 el('astral-sync-push').addEventListener('click',()=>{if(confirm('以本机配置覆盖云端？请先确认本机网址完整并已备份。'))action('upload')});
 el('astral-sync-pull').addEventListener('click',()=>{if(confirm('从云端恢复将替换本机配置，并先自动备份当前配置。确定继续？'))action('download')});
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&'__astralSync' in changes)render().catch(()=>{})});
 await render();
})();
