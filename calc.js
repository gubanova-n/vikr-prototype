/* Расчётный модуль не зависит от экрана: сюда позже подключаются деньги и выгрузка. */
window.VIKR_CALC = (() => {
  const kinds = ["workers","drivers","machines"];
  const blank = () => ({workers:0,drivers:0,machines:0});
  const componentByKind = {workers:"labor",drivers:"machinistLabor",machines:"machine",materials:"material"};
  const ruleComponentByKind = {workers:"LaborCosts",drivers:"MachinistLaborCosts",machines:"Machine",materials:"Material"};

  function coefficientFactor(coefficient,kind,resource){
    if(coefficient?.disabled)return 1;
    let factor=Number(coefficient?.components?.[componentByKind[kind]]?.factor);
    if(!Number.isFinite(factor))factor=1;
    const individual=(coefficient?.application?.resourceFactors||[]).find(rule=>rule.kind===kind&&rule.unit===resource?.unit&&(rule.code?rule.code===resource?.code:rule.name===resource?.name));
    if(individual&&Number.isFinite(Number(individual.factor)))factor=Number(individual.factor);
    for(const rule of coefficient?.application?.resourceRules||[]){
      const selectors=rule.resources||[];
      if(!selectors.some(code=>resource?.code===code||String(resource?.code||"").startsWith(code+"-")))continue;
      const own=Number(rule.factors?.[ruleComponentByKind[kind]]);
      if(Number.isFinite(own))factor=own;
    }
    return factor;
  }
  function resourceFactor(resource,chain=[]){
    return chain.flatMap(item=>Array.isArray(item)?item:item?.coefficients||[]).reduce((value,coefficient)=>value*coefficientFactor(coefficient,resource.kind,resource),1);
  }
  function positionResources(vikr,factor=1,inherited=[]){
    const rows=[];
    for(const position of vikr.gesn||[]){
      if(position.excluded)continue;
      const chain=[...inherited,vikr.coefficients||[],position.coefficients||[]];
      for(const resource of position.resources||[])rows.push({position,resource,qty:(Number(resource.qty)||0)*factor*resourceFactor(resource,[...chain,resource.coefficients||[]])});
    }
    return rows;
  }
  function totals(vikr,factor=1,inherited=[]){
    const out=blank();
    for(const {resource,qty} of positionResources(vikr,factor,inherited))if(kinds.includes(resource.kind))out[resource.kind]+=qty;
    return out;
  }
  function materials(vikr,factor=1,inherited=[]){
    const map=new Map();
    for(const {resource,qty} of positionResources(vikr,factor,inherited)){
      if(resource.kind!=="materials")continue;
      const key=resource.code+"|"+resource.unit;
      if(!map.has(key))map.set(key,{code:resource.code,name:resource.name,unit:resource.unit,qty:0});
      map.get(key).qty+=qty;
    }
    return [...map.values()];
  }
  function addTotals(list){return list.reduce((a,v)=>({workers:a.workers+v.workers,drivers:a.drivers+v.drivers,machines:a.machines+v.machines}),blank())}
  function workFactor(item,packages){
    const own=item.baseVolume>0?(Number(item.volume)||0)/item.baseVolume:1;
    const pack=item.packageId?packages.find(p=>p.id===item.packageId):null;
    return own*(pack?(Number(pack.count)||0):1);
  }
  function normalize(source,mode,uid){
    const denominator=mode==="unit"&&source.volume>0?source.volume:1;
    const copy=structuredClone(source);
    copy.uid=uid;
    copy.sourceId=source.id;
    copy.baseVolume=mode==="unit"?1:source.volume;
    copy.volume=copy.baseVolume;
    copy.mode=mode;
    copy.coefficients=copy.coefficients||[];
    copy.gesn=copy.gesn.map(p=>({...p,id:uid+"/"+p.id,sourceId:p.id,qty:p.qty/denominator,resources:p.resources.map(r=>({...r,qty:r.qty/denominator}))}));
    return copy;
  }
  return {totals,materials,addTotals,workFactor,normalize,resourceFactor,positionResources};
})();
