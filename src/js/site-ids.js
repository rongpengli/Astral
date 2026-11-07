/* Assign stable navigation identities without changing existing IDs or other fields. */
'use strict';
const AstralSiteIds={
 normalize:(groups,makeId=()=>crypto.randomUUID())=>(groups||[]).map(group=>({
  ...group,_syncId:group._syncId||makeId(),
  list:(group.list||[]).map(site=>({...site,_syncId:site._syncId||makeId()}))
 }))
};
if(typeof module!=='undefined')module.exports=AstralSiteIds;
