/**************************************************
*   by rongpengli
*   https://github.com/rongpengli/
**************************************************/
'use strict';
const AstralCompat=(()=>{
 function equal(a,b){
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
  const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
  return ak.length===bk.length&&ak.every((key,index)=>key===bk[index]&&equal(a[key],b[key]));
 }
 return {equal};
})();
