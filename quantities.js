/* Shared proportional quantities. Physical volumes/consumptions change; unit norms,
 * prices and coefficient factors remain intact. Work snapshots retain base ratios. */
window.VIKR_QUANTITIES=(()=>{
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const clone=v=>structuredClone(v);
  const krOf=v=>v.kr||'Не распределено';
  function amount(holder,key,factor){if(holder&&finite(holder[key]))holder[key]=Number(holder[key])*factor}
  function resource(r,f){amount(r,'qty',f)}
  function position(p,f){amount(p,'qty',f);for(const r of p.resources||[])resource(r,f)}
  function vikr(v,f){amount(v,'volume',f);amount(v,'baseVolume',f);for(const p of v.gesn||[])position(p,f)}
  function members(o,n){return (o.vikrs||[]).filter(v=>n.type==='object'||n.type==='vikr'&&(v.id||v.uid)===n.value||n.type==='kr'&&krOf(v)===n.value||n.type==='mark'&&krOf(v)+'|'+(v.mark||'')===n.value||n.type==='package'&&v.packageId===n.value)}
  function meta(o,n){if(n.type==='object')return o.info?.levels?.object||{};if(n.type==='vikr'){const v=members(o,n)[0];return {volume:v?.volume,unit:v?.unit}}if(n.type==='gesn'){const p=o.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===n.value);return {volume:p?.qty,unit:p?.unit}}if(n.type==='resource'){const p=o.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===n.positionId),r=p?.resources?.[n.index];return {volume:r?.qty,unit:r?.unit}}if(n.type==='package'){const p=o.packages?.find(p=>p.id===n.value);return {volume:p?.count,unit:p?.unit||'комплект'}}return o.info?.levels?.[n.type+':'+n.value]||o.info?.krCatalog?.find(k=>n.type==='kr'&&k.code===n.value)||{}}
  function denominator(o,n,mode='full'){if(mode==='full')return 1;const m=meta(o,mode==='objectUnit'?{type:'object'}:n);if(!(Number(m.volume)>0))throw Error('Для переноса на единицу нужен положительный исходный объём '+(mode==='objectUnit'?'объекта':'выбранного уровня')+'. Укажите объём или выберите другой режим.');return Number(m.volume)}
  function importFactor(source,node,mode,target){
    if(mode!=='full')return 1/denominator(source,node,mode);
    const from=meta(source,{type:'object'}),to=meta(target,{type:'object'});
    if(!(Number(from.volume)>0))throw Error('В объекте-источнике не задан положительный объём. Укажите его перед добавлением с объёмом.');
    if(!finite(to.volume)||Number(to.volume)<0)throw Error('В принимающем объекте не задан объём. Укажите его перед добавлением с объёмом.');
    const unit=v=>String(v||'').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g,'');
    if(unit(from.unit)&&unit(to.unit)&&unit(from.unit)!==unit(to.unit))throw Error('Единицы объектов различаются: '+from.unit+' и '+to.unit+'. Автоматическая конвертация не выполняется.');
    return Number(to.volume)/Number(from.volume);
  }
  function scaleMeta(info,f,includeObject=true){for(const [key,m] of Object.entries(info?.levels||{}))if(includeObject||key!=='object')amount(m,'volume',f);for(const k of info?.krCatalog||[])amount(k,'volume',f)}
  function scaleNode(o,n,f){if(!Number.isFinite(f)||f<0)throw Error('Некорректный множитель объёма');
    if(n.type==='resource'){const p=o.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===n.positionId),r=p?.resources?.[n.index];if(!r)throw Error('Ресурс не найден');resource(r,f);return}
    if(n.type==='gesn'){const p=o.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===n.value);if(!p)throw Error('ГЭСН не найдена');position(p,f);return}
    if(n.type==='package'){const p=o.packages?.find(p=>p.id===n.value);amount(p,'count',f);if(!o.exportWorking)members(o,n).forEach(v=>vikr(v,f));return}
    members(o,n).forEach(v=>vikr(v,f));
    if(n.type==='object')scaleMeta(o.info,f);
    else if(n.type==='kr'){for(const [key,m] of Object.entries(o.info?.levels||{}))if(key==='kr:'+n.value||key.startsWith('mark:'+n.value+'|'))amount(m,'volume',f);for(const k of o.info?.krCatalog||[])if(k.code===n.value)amount(k,'volume',f)}
    else if(n.type==='mark')amount(o.info?.levels?.['mark:'+n.value],'volume',f);
    // Package count is a repetition factor, not a second proportional multiplier.
    // Scaling its count instead of its stored children avoids applying the ratio twice.
  }
  function setVolume(o,n,next,reference=null){if(!finite(next)||Number(next)<0)throw Error('Укажите неотрицательный объём');const old=meta(o,n).volume,ref=reference??old,items=members(o,n),position=['gesn','resource'].includes(n.type)?o.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===(n.type==='gesn'?n.value:n.positionId)):null,hasContents=n.type==='gesn'?(position?.resources||[]).some(r=>Number(r.qty)):items.some(v=>(v.gesn||[]).length||Number(v.volume));
    if(Number(next)===Number(old)&&finite(old))return;
    if(Number(ref)>0)scaleNode(o,n,Number(next)/Number(ref));else if(hasContents&&Number(next)!==0)throw Error('Исходный объём не задан или равен нулю. Укажите положительный объём, на который рассчитан существующий состав.');
    if(n.type==='gesn'||n.type==='resource'){const h=n.type==='gesn'?position:position?.resources?.[n.index];if(!h)throw Error('Элемент не найден');h.qty=Number(next)}
    else if(n.type==='vikr'){const v=items[0];if(!v)throw Error('ВИКР не найден');v.volume=Number(next)}
    else if(n.type==='package'){const p=o.packages?.find(p=>p.id===n.value);if(!p)throw Error('Комплект не найден');p.count=Number(next)}
    else{const key=n.type==='object'?'object':n.type+':'+n.value;o.info.levels||={};o.info.levels[key]||={};o.info.levels[key].volume=Number(next);if(n.type==='kr'){const k=o.info.krCatalog?.find(k=>k.code===n.value);if(k)k.volume=Number(next)}}
  }
  function basis(objects,nodes,mode='full'){if(nodes.length===1){const o=objects.find(o=>o.id===nodes[0].objectId),m=meta(o,mode==='objectUnit'?{type:'object'}:nodes[0]);return {volume:mode==='full'?m.volume:Number(m.volume)>0?1:null,unit:m.unit||''}}
    const ids=new Set(nodes.map(n=>n.objectId));if(ids.size===1&&mode!=='unit'){const m=meta(objects.find(o=>o.id===nodes[0].objectId),{type:'object'});return {volume:mode==='objectUnit'?(Number(m.volume)>0?1:null):m.volume,unit:m.unit||''}}return {volume:null,unit:''}}
  return {finite,clone,resource,position,vikr,members,meta,denominator,importFactor,scaleMeta,scaleNode,setVolume,basis};
})();
