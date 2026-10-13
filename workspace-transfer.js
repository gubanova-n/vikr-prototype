/* Copy and move the selected hierarchy together with its children. */
window.VIKR_WORKSPACE_TRANSFER = (() => {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const uid=()=>crypto.randomUUID();
  const krOf=v=>v.kr||"Не распределено";
  function contains(object,parent,node) {
    if(parent.type==='object')return true;
    const v=node.type==='vikr'?object.vikrs.find(v=>v.id===node.value):object.vikrs.find(v=>v.gesn?.some(p=>p.id===(node.type==='gesn'?node.value:node.positionId)));
    if(parent.type==='kr')return node.type==='mark'?node.value.startsWith(parent.value+'|'):v&&krOf(v)===parent.value;
    if(parent.type==='mark')return v&&krOf(v)+'|'+(v.mark||'')===parent.value;
    if(parent.type==='package')return v?.packageId===parent.value;
    if(parent.type==='vikr')return v?.id===parent.value;
    if(parent.type==='gesn')return node.type==='resource'&&node.positionId===parent.value;
    return false;
  }
  function normalize(objects,nodes) {
    const unique=[...new Map(nodes.map(n=>[JSON.stringify(n),n])).values()];
    return unique.filter(n=>!unique.some(p=>p!==n&&p.objectId===n.objectId&&contains(objects.find(o=>o.id===n.objectId),p,n)));
  }
  function build(objects,nodes,destination,move=false) {
    nodes=normalize(objects,nodes);
    if(!nodes.length)throw Error('Сначала выберите элементы');
    const Q=window.VIKR_QUANTITIES,mode=move?'full':destination.mode||'full',basis=Q.basis(objects,nodes,mode==='full'?'objectUnit':mode);
    for(const n of nodes)Q.denominator(objects.find(o=>o.id===n.objectId),n,mode);
    const snapshots=new Map(objects.map(o=>[o.id,clone(o)]));
    const fresh=!destination.objectId;
    const whole=nodes.length===1&&nodes[0].type==='object'?snapshots.get(nodes[0].objectId):null;
    const target=fresh?{id:uid(),info:whole?clone(whole.info):{title:destination.title,levels:{object:{name:destination.title,unit:'',volume:null,note:'',coefficients:[]}},krCatalog:[]},vikrs:[],packages:[]}:snapshots.get(destination.objectId);
    if(!target)throw Error('Целевой объект не найден');
    if(fresh){target.info.title=destination.title;target.info.levels||={};target.info.levels.object={...(target.info.levels.object||{}),name:destination.title,volume:whole&&mode==='unit'?1:Q.finite(destination.volume)?Number(destination.volume):mode==='full'&&new Set(nodes.map(n=>n.objectId)).size===1?Q.meta(objects.find(o=>o.id===nodes[0].objectId),{type:'object'}).volume:basis.volume??null,unit:destination.unit||basis.unit};target.info.deleted=false;target.info.treeHidden=false;if(whole)Q.scaleMeta(target.info,move?1:Q.importFactor(whole,nodes[0],mode,target),false)}
    target.info.levels||={};target.info.krCatalog||=[];target.packages||=[];
    const priorVikrs=new Set(target.vikrs.map(v=>v.id)),priorPackages=new Set(target.packages.map(p=>p.id));
    const changed=new Set([target.id]),removed=new Set(),packageCopies=new Map(),copiedVikrs=new Set();
    let copyFactor=1,copyNode=null;
    const copiedMeta=value=>{const m=clone(value);if(Q.finite(m.volume))m.volume*=copyFactor;return m};
    function copyMeta(source,kr,mark) {
      const entry=source.info.krCatalog?.find(x=>x.code===kr);
      if(entry&&!target.info.krCatalog.some(x=>x.code===kr)){const m=copiedMeta(entry);if(!['object','kr'].includes(copyNode?.type))m.volume=null;target.info.krCatalog.push(m)}
      for(const key of ['kr:'+kr,mark?'mark:'+kr+'|'+mark:null])if(key&&source.info.levels?.[key]&&!target.info.levels[key]){const m=copiedMeta(source.info.levels[key]);if(key.startsWith('kr:')&&!['object','kr'].includes(copyNode?.type))m.volume=null;target.info.levels[key]=m}
    }
    function detach(source,node) {
      if(node.type==='object'){removed.add(source.id);return}
      if(node.type==='resource'){const p=source.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===node.positionId);if(p)p.resources.splice(node.index,1);return}
      if(node.type==='gesn'){for(const v of source.vikrs)v.gesn=v.gesn.filter(p=>p.id!==node.value);return}
      const ids=new Set(source.vikrs.filter(v=>node.type==='vikr'?v.id===node.value:node.type==='kr'?krOf(v)===node.value:node.type==='mark'?krOf(v)+'|'+(v.mark||'')===node.value:v.packageId===node.value).map(v=>v.id));
      source.vikrs=source.vikrs.filter(v=>!ids.has(v.id));
      for(const pack of source.packages||[])pack.memberIds=(pack.memberIds||[]).filter(id=>!ids.has(id));
      if(node.type==='kr'){source.info.krCatalog=(source.info.krCatalog||[]).filter(x=>x.code!==node.value);for(const key of Object.keys(source.info.levels||{}))if(key==='kr:'+node.value||key.startsWith('mark:'+node.value+'|'))delete source.info.levels[key]}
      if(node.type==='mark')delete source.info.levels['mark:'+node.value];
      if(node.type==='package')source.packages=(source.packages||[]).filter(p=>p.id!==node.value);
    }
    if(move){
      for(const node of nodes){
        if(node.objectId!==target.id)continue;
        if(node.type==='object')throw Error('Нельзя переместить объект в самого себя');
        if(destination.parentType==='object')throw Error('Элемент уже находится в выбранном месте');
        if(node.type==='mark'&&node.value.split('|')[0]===destination.parentValue)throw Error('Марка уже находится в выбранном конструктиве');
        const parent=destination.parentType==='mark'?{type:'mark',value:destination.parentValue}:destination.parentType==='kr'?{type:'kr',value:destination.parentValue}:destination.parentType==='vikr'?{type:'vikr',value:destination.parentValue}:destination.parentType==='gesn'?{type:'gesn',value:destination.parentValue}:null;
        if(parent&&(node.type===parent.type&&node.value===parent.value||contains(objects.find(o=>o.id===target.id),node,parent)))throw Error('Нельзя переместить элемент внутрь самого себя');
        if(node.type==='resource'&&node.positionId===destination.parentValue)throw Error('Ресурс уже находится в выбранной ГЭСН');
        if(node.type==='gesn'&&objects.find(o=>o.id===target.id).vikrs.find(v=>v.id===destination.parentValue)?.gesn.some(p=>p.id===node.value))throw Error('ГЭСН уже находится в выбранном ВИКР');
      }
      const sorted=[...nodes].sort((a,b)=>(b.index??-1)-(a.index??-1));
      for(const node of sorted){const source=snapshots.get(node.objectId);changed.add(source.id);detach(source,node)}
    }
    // Read source records from the originals; the destination is a separate snapshot.
    const incoming=nodes.map(node=>({node,source:objects.find(o=>o.id===node.objectId)}));
    for(const {node,source} of incoming){
      if(!source)throw Error('Исходный объект не найден');
      copyNode=node;copyFactor=move?1:Q.importFactor(source,node,mode,target);
      if(move&&source.id===target.id&&node.type==='object')throw Error('Нельзя переместить объект в самого себя');
      if(node.type==='gesn'||node.type==='resource'){
        const position=source.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===(node.type==='gesn'?node.value:node.positionId));
        const parent=node.type==='gesn'?target.vikrs.find(v=>v.id===destination.parentValue):target.vikrs.flatMap(v=>v.gesn||[]).find(p=>p.id===destination.parentValue);
        if(!position||!parent)throw Error('Выберите родительский элемент');
        if(move&&source.id===target.id&&(node.type==='gesn'?parent.gesn.some(p=>p.id===position.id):parent.id===position.id))throw Error('Элемент уже находится в выбранном месте');
        const item=clone(node.type==='gesn'?position:position.resources[node.index]);
        if(!item)throw Error('Элемент не найден');
        if(node.type==='gesn')Q.position(item,copyFactor);else Q.resource(item,copyFactor);
        if(!move){item.id=uid();if(node.type==='gesn')for(const r of item.resources||[])r.id=uid()}
        (node.type==='gesn'?parent.gesn:parent.resources).push(item);
      }else{
        const selected=source.vikrs.filter(v=>node.type==='object'||(node.type==='vikr'?v.id===node.value:node.type==='kr'?krOf(v)===node.value:node.type==='mark'?krOf(v)+'|'+(v.mark||'')===node.value:v.packageId===node.value));
        if(node.type==='object'){for(const kr of source.info.krCatalog||[])copyMeta(source,kr.code,'');for(const key of Object.keys(source.info.levels||{}))if(key!=='object'&&!target.info.levels[key])target.info.levels[key]=copiedMeta(source.info.levels[key])}
        if(node.type==='kr'){copyMeta(source,node.value,'');for(const key of Object.keys(source.info.levels||{}))if(key.startsWith('mark:'+node.value+'|')&&!target.info.levels[key])target.info.levels[key]=copiedMeta(source.info.levels[key])}
        if(node.type==='mark'){const [kr,mark]=node.value.split('|'),newKr=destination.parentType==='kr'?destination.parentValue:kr;if(newKr===kr)copyMeta(source,kr,mark);else{const meta=source.info.levels?.['mark:'+node.value];if(meta&&!target.info.levels['mark:'+newKr+'|'+mark])target.info.levels['mark:'+newKr+'|'+mark]=copiedMeta(meta)}}
        for(const v of selected){
          const sourceKey=source.id+'|'+v.id;if(copiedVikrs.has(sourceKey))continue;copiedVikrs.add(sourceKey);
          const item=clone(v);Q.vikr(item,copyFactor);if(!destination.parentType||destination.parentType==='object')copyMeta(source,krOf(v),v.mark);
          if(!move){item.id=uid();for(const p of item.gesn||[]){p.id=uid();for(const r of p.resources||[])r.id=uid()}}
          if(destination.parentType==='kr'){item.kr=destination.parentValue;if(node.type==='vikr')item.mark=''}
          if(destination.parentType==='mark'){[item.kr,item.mark]=destination.parentValue.split('|')}
          if(v.packageId&&(!destination.parentType||destination.parentType==='object')){const key=source.id+'|'+v.packageId;let pack=packageCopies.get(key);if(!pack){const original=source.packages?.find(p=>p.id===v.packageId);if(original){pack={...clone(original),id:uid(),memberIds:[]};target.packages.push(pack);packageCopies.set(key,pack)}}if(pack){item.packageId=pack.id;pack.memberIds.push(item.id)}else delete item.packageId}else delete item.packageId;
          target.vikrs.push(item);
        }
      }
    }
    if(!move&&destination.packageName){
      const members=target.vikrs.filter(v=>!priorVikrs.has(v.id)),ids=new Set(members.map(v=>v.id));
      if(members.length){for(const p of target.packages)if(!priorPackages.has(p.id))p.memberIds=(p.memberIds||[]).filter(id=>!ids.has(id));target.packages=target.packages.filter(p=>priorPackages.has(p.id)||p.memberIds?.length);const pack={id:uid(),name:destination.packageName,count:1,unit:'комплект',memberIds:[...ids]};members.forEach(v=>v.packageId=pack.id);target.packages.push(pack)}
    }
    // Incoming records were scaled once. Existing target records and unit imports stay intact.
    for(const id of removed)changed.delete(id);
    snapshots.set(target.id,target);
    return {targetId:target.id,changed:[...changed].map(id=>snapshots.get(id)),removed:[...removed],nodes};
  }
  return {build,normalize,contains};
})();
