/* Cats describes work types. NrSp remains the sole source of NR/SP percentages. */
window.VIKR_EXCEL_COST_CATALOGS=(()=>{
  const data=window.VIKR_EXCEL_COST_CATALOG_DATA,methods=window.VIKR_EXCEL_COST_DATA.methods;
  const ids=method=>String(method?.catalogs||'').match(/\d+/g)||[];
  const forMethod=methodId=>{const method=methods.find(m=>m.id===methodId);return data.catalogs.filter(c=>ids(method).includes(c.sourceId))};
  const methodsFor=catalogId=>{const catalog=data.catalogs.find(c=>c.id===catalogId);return catalog?methods.filter(m=>ids(m).includes(catalog.sourceId)):[]};
  function exportOptions(currentMethod){
    return data.catalogs.filter(c=>!['ВР ТСН','ВР ТСН (2025)'].includes(c.id)).map(c=>{
      const compatible=methodsFor(c.id);
      // Keep an already selected regional methodology when its catalog matches.
      const method=compatible.find(m=>m.id===currentMethod)||compatible.find(m=>m.id===c.defaultMethod)||(compatible.length===1?compatible[0]:null);
      if(!method)throw Error('Для каталога «'+c.name+'» не определена методика НР/СП');
      return {id:c.id,name:c.name,methodId:method.id};
    });
  }
  function workType(methodId,vr,catalogId){
    const catalogs=forMethod(methodId).filter(c=>!catalogId||c.id===catalogId);
    const matches=catalogs.map(c=>({catalog:c,item:c.items[String(vr)]})).filter(x=>x.item);
    if(matches.length!==1)return null;
    const {catalog,item}=matches[0];
    return {vr:String(vr),name:item.attributes.Caption||'',category:item.attributes.Category||'',groups:item.groups,catalogId:catalog.id,catalogName:catalog.name,attributes:item.attributes};
  }
  return {version:'5.15',catalogs:data.catalogs,forMethod,methodsFor,exportOptions,workType};
})();
