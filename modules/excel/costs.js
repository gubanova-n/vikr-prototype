/* Optional Excel costing layer. It enriches export snapshots, never object files. */
window.VIKR_EXCEL_COSTS=(()=>{
  const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',data=window.VIKR_EXCEL_COST_DATA;
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const num=v=>{const n=typeof v==='string'?v.replace(',','.'):v;return finite(n)?Number(n):null};
  const escape=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const parse=s=>new DOMParser().parseFromString(s,'application/xml');
  const first=(d,n)=>d.getElementsByTagNameNS(NS,n)[0];
  const all=(d,n)=>[...d.getElementsByTagNameNS(NS,n)];
  const serialize=d=>new XMLSerializer().serializeToString(d);
  const key=code=>String(code||'').replace(/\s/g,'').replace(/[–—]/g,'-').toUpperCase();
  const unit=u=>String(u||'').toLowerCase().replace(/м/g,'m').replace(/кг/g,'kg').replace(/квт/g,'kw').replace(/\s|\.|³/g,m=>m==='³'?'3':'');
  const reason=s=>key(s).replace(/(ПР\/\d+-\d+\.\d+)-[123]$/,'$1');
  const reasonKey=r=>reason(r.nr||r.NrCode)+'|'+reason(r.sp||r.SpCode);
  const positionKey=p=>{const code=key(p.code),digits=code.match(/\d{2}-\d{2}-\d{3}-\d{2}/)?.[0];if(!digits)return null;return (code.slice(0,code.indexOf(digits))||key(p.base)||'ГЭСН')+':'+digits};
  const normReasons=new Map(Object.entries(data.reasons).map(([k,v])=>[key(k),v]));
  const vrByReason=new Map();
  for(const m of data.methods.filter(m=>m.name.startsWith('НРСП Методика 2020'))){for(const [id,item] of Object.entries(m.items)){const k=reasonKey(item);if(k==='|')continue;if(!vrByReason.has(k))vrByReason.set(k,new Set());vrByReason.get(k).add(id)}}
  const defaultMethod=data.reference.method;
  function methodFor(request){const names=[...new Set((request.objects||[]).map(o=>o.info?.nrSpMethodology||o.info?.methodology?.nrSp).filter(Boolean))];return request.methodology|| (names.length===1?names[0]:defaultMethod)}
  function resolve(p,methodId,options={}){
    const method=data.methods.find(m=>m.id===methodId);if(!method)return {error:'Не выбрана методика НР/СП'};
    const catalogs=window.VIKR_EXCEL_COST_CATALOGS;
    if(options.catalog&&!catalogs.forMethod(methodId).some(c=>c.id===options.catalog))return {error:'Каталог видов работ не связан с выбранной методикой НР/СП'};
    let id=p.vr??p.Vr??p.Vr2001??p.meta?.vr??p.meta?.Vr2001;
    let origin='ФСНБ';
    const original=options.useEstimateVr!==false&&p.meta?.estimatePosition&&data.reference.byNumber[p.meta.estimatePosition+'|'+key(p.code)];
    if((id===undefined||id===null||id==='')&&original?.length===1){id=original[0];origin='Смета, позиция '+p.meta.estimatePosition}
    const pkey=positionKey(p),reasons=p.reasons?.length?p.reasons:normReasons.get(pkey)||[];
    if(id===undefined||id===null||id===''){
      const candidates=new Set();for(const r of reasons)for(const v of vrByReason.get(reasonKey(r))||[])candidates.add(v);
      if(candidates.size!==1)return {error:candidates.size?'Неоднозначный вид работ Vr':'Вид работ Vr не определён'};
      id=[...candidates][0];
    }
    id=String(id);const item=method.items[id];
    if(!item)return {vr:id,error:'Vr отсутствует в выбранной методике'};
    const workType=catalogs.workType(methodId,id,options.catalog);
    const nr=num(item.Nacl),sp=num(item.Plan),nrCurrent=num(item.NaclCurr??item.Nacl),spCurrent=num(item.PlanCurr??item.Plan);
    const supported=(mask)=>!mask||key(mask)==='ФОТ';
    return {vr:id,origin,workType,nr:supported(item.NaclMask)?nr:null,sp:supported(item.PlanMask)?sp:null,
      nrCurrent:supported(item.NaclMask)?nrCurrent:null,spCurrent:supported(item.PlanMask)?spCurrent:null,
      error:!supported(item.NaclMask)||!supported(item.PlanMask)?'База начисления не ФОТ':nr===null||sp===null||nrCurrent===null||spCurrent===null?'Норматив НР/СП отсутствует':'',
      basis:[item.NrCode,item.SpCode].filter(Boolean).join('; ')};
  }
  function getPrice(resource){
    if(['workers','drivers'].includes(resource.kind))return {value:null};
    const catalog=data.prices[resource.code]||data.prices[String(resource.code||'').replace(/^(?:ФСБЦ|ФСЭМ)[- ]*/i,'')],price=resource.price||catalog?.price;
    if(catalog&&unit(catalog.unit)!==unit(resource.unit))return {value:null,error:'Единица ресурса отличается от ФСНБ: '+catalog.unit};
    if(!price)return {value:null,error:'Цена отсутствует в ФСНБ'};
    const value=num(typeof price==='number'?price:resource.kind==='machines'?price.operation??price.value:price.cost??price.value);
    return {value,error:value===null?'Цена отсутствует в ФСНБ':''};
  }
  function enrich(model,request){
    const method=methodFor(request);let missingNorms=0,missingPrices=0,standaloneInputs=0;
    for(const row of model.rows){
      row.depth={object:1,kr:2,mark:3,package:4,vikr:4,gesn:5,resource:6}[row.type];
      if(row.type==='gesn'){row.costNorm=resolve(row.sourceRecord||row,method,request);if(row.costNorm.error)missingNorms++}
      if(row.type==='resource'){row.costPrice=getPrice(row.sourceRecord||row);if(row.costPrice.value===null&&!['workers','drivers'].includes(row.kind))missingPrices++}
      if(row.type==='gesn'&&!row.children.length){const p=row.sourceRecord||row,code=String(p.code||'').replace(/^(?:ФСБЦ|ФСЭМ)[- ]*/i,''),catalog=data.prices[code];row.costKind=catalog?(catalog.price.operation!==undefined?'machines':'materials'):null;row.costPrice=getPrice({...p,kind:row.costKind});if(row.costPrice.value===null||!row.costKind)standaloneInputs++;}
    }
    return {method,missingNorms,missingPrices,standaloneInputs};
  }
  function aggregate(children,col,fn='SUM'){
    if(!children.length)return '0';
    const refs=children.map(r=>col+r.index),parts=[];
    for(let i=0;i<refs.length;i+=200)parts.push(fn+'('+refs.slice(i,i+200).join(',')+')');
    const formula=parts.join('+');if(formula.length>7500)throw Error('Слишком много дочерних строк для стоимостной формулы. Выгрузите уровень частями.');return formula;
  }
  const guarded=(children,col)=>children.length?`IF(${aggregate(children,col,'COUNT')}=${children.length},${aggregate(children,col)},"")`:'0';
  const cachedSum=(children,col)=>children.every(r=>typeof r.costValues[col]==='number')?children.reduce((s,r)=>s+r.costValues[col],0):null;
  function calculations(model){
    for(const r of [...model.rows].reverse()){
      const n=r.index,f={},v={},has=r.children.length>0,emptyPosition=r.type==='gesn'&&!has;
      if(r.type==='resource'){
        v.K=r.costPrice.value;
        if(r.kind==='workers')f.K='IF($D$1="","",$D$1)';
        else if(r.kind==='drivers')f.K='IF($F$1="","",$F$1)';
        f.L=`IF(OR(D${n}="",K${n}=""),"",D${n}*K${n})`;v.L=v.K===null||r.qty===null?null:r.qty*v.K;
        const wage=['workers','drivers'].includes(r.kind);
        f.M=wage?`IF(L${n}="","",L${n})`:'0';v.M=wage?v.L:0;
        const global=r.kind==='materials'||r.kind==='equipment'?'$O$1':r.kind==='machines'?'$R$1':'$L$1';
        f.S=`IF(${global}="","",${global})`;v.S=null;
        f.T=`IF(K${n}="","",K${n}*IF(S${n}="",1,S${n}))`;v.T=v.K;
        f.U=`IF(OR(D${n}="",T${n}=""),"",D${n}*T${n})`;v.U=v.L;
        f.V=wage?`IF(U${n}="","",U${n})`:'0';v.V=v.M;
        f.R=`IF(L${n}="","",L${n})`;v.R=v.L;f.Y=`IF(U${n}="","",U${n})`;v.Y=v.U;
        f.AA=`IF(K${n}="","${escape(r.costPrice.error||'Введите ставку сверху или цену ресурса')}",IF(D${n}="","Количество не определено",""))`;
      }else{
        for(const c of ['L','M','U','V']){f[c]=emptyPosition?'""':guarded(r.children,c);v[c]=emptyPosition?null:cachedSum(r.children,c)}
        for(const [c,sum] of [['K','L'],['T','U']]){f[c]=`IF(OR(D${n}="",D${n}=0,${sum}${n}=""),"",${sum}${n}/D${n})`;v[c]=v[sum]!==null&&r.qty? v[sum]/r.qty:null}
        if(emptyPosition){
          delete f.K;v.K=r.costPrice.value;
          f.L=`IF(OR(D${n}="",K${n}=""),"",D${n}*K${n})`;v.L=v.K===null||r.qty===null?null:r.qty*v.K;
          if(r.costKind){f.M='0';v.M=0;const global=r.costKind==='machines'?'$R$1':'$O$1';f.S=`IF(${global}="","",${global})`}
          else {delete f.M;v.M=null;v.S=null}
          f.T=`IF(K${n}="","",K${n}*IF(S${n}="",1,S${n}))`;v.T=v.K;
          f.U=`IF(OR(D${n}="",T${n}=""),"",D${n}*T${n})`;v.U=v.L;
          f.V=`IF(M${n}="","",M${n}*IF($L$1="",1,$L$1))`;v.V=v.M;
        }
        if(r.type==='gesn'){
          v.N=r.costNorm.nr??null;v.P=r.costNorm.sp??null;v.Z=r.costNorm.vr||'';v.AC=r.costNorm.nrCurrent??null;v.AD=r.costNorm.spCurrent??null;
          for(const [c,fot,percent,factor] of [['O','M','N','$T$1'],['Q','M','P','$X$1'],['W','V','AC','$T$1'],['X','V','AD','$X$1']]){
            f[c]=`IF(${fot}${n}="","",IF(${fot}${n}=0,0,IF(${percent}${n}="","",${fot}${n}*${percent}${n}/100*IF(${factor}="",1,${factor}))))`;
            v[c]=v[fot]===null?null:v[fot]===0?0:v[percent]===null?null:v[fot]*v[percent]/100;
          }
          f.R=`IF(COUNT(L${n},O${n},Q${n})=3,SUM(L${n},O${n},Q${n}),"")`;v.R=[v.L,v.O,v.Q].every(x=>typeof x==='number')?v.L+v.O+v.Q:null;
          f.Y=`IF(COUNT(U${n},W${n},X${n})=3,SUM(U${n},W${n},X${n}),"")`;v.Y=[v.U,v.W,v.X].every(x=>typeof x==='number')?v.U+v.W+v.X:null;
          f.AA=emptyPosition?`IF(K${n}="","Введите цену позиции без ресурсов",IF(M${n}="","Укажите ФОТ позиции без ресурсов, либо 0",IF(Y${n}="","${escape(r.costNorm.error||'Расчёт не завершён')}","")))`:`IF(Y${n}="","${escape(r.costNorm.error||'Есть ресурсы без цены или количества')}","")`;
        }else{
          for(const c of ['O','Q','R','W','X','Y']){f[c]=guarded(r.children,c);v[c]=cachedSum(r.children,c)}
          f.AA=`IF(Y${n}="","Стоимость не рассчитана полностью","")`;
        }
      }
      if(r.type==='resource'){v.AA=v.Y===null?r.costPrice.error||'Введите ставку сверху или цену ресурса':''}
      else v.AA=v.Y===null?r.costNorm?.error||'Стоимость не рассчитана полностью':'';
      // Preserve numeric zero separately from a blank, including in preview engines.
      for(const c of Object.keys(f))f[c]=f[c].replace(/(\$?[A-Z]+\$?\d+)=""/g,'AND($1="",NOT(ISNUMBER($1)))');
      v.AB=r.depth;r.costValues=v;r.costFormulas=f;
    }
  }
  async function decorate(zip,model,request){
    const info=enrich(model,request);calculations(model);
    const sheetPath='xl/worksheets/sheet1.xml',sheet=parse(await zip.file(sheetPath).async('string')),rows=all(sheet,'row'),styleDoc=parse(await zip.file('xl/styles.xml').async('string')),xfs=first(styleDoc,'cellXfs');
    const topCell=rows.find(r=>r.getAttribute('r')==='1').children;
    const yellow=xfs.children[Number([...topCell].find(c=>c.getAttribute('r')==='D1').getAttribute('s'))].getAttribute('fillId');
    let fmts=first(styleDoc,'numFmts');if(!fmts){fmts=styleDoc.createElementNS(NS,'numFmts');styleDoc.documentElement.prepend(fmts)}
    const percentFmt=Math.max(164,...[...fmts.children].map(f=>Number(f.getAttribute('numFmtId'))))+1;
    const fmt=styleDoc.createElementNS(NS,'numFmt');fmt.setAttribute('numFmtId',percentFmt);fmt.setAttribute('formatCode','0.0"%"');fmts.append(fmt);fmts.setAttribute('count',fmts.children.length);
    const styleCache=new Map();
    function costStyle(base,kind){const k=base+':'+kind;if(styleCache.has(k))return styleCache.get(k);const xf=xfs.children[Number(base)||0].cloneNode(true);xf.setAttribute('numFmtId',kind==='percent'?percentFmt:kind==='index'?2:kind==='text'?0:4);xf.setAttribute('applyNumberFormat','1');if(kind==='input'){xf.setAttribute('fillId',yellow);xf.setAttribute('applyFill','1')}if(kind==='text'){let a=first(xf,'alignment');if(a){a.setAttribute('horizontal','left');a.setAttribute('wrapText','1')}}const id=xfs.children.length;xfs.append(xf);styleCache.set(k,id);return id}
    function cell(ref,value,style,formula){
      const c=sheet.createElementNS(NS,'c');c.setAttribute('r',ref);c.setAttribute('s',style);
      if(formula){const f=sheet.createElementNS(NS,'f');f.textContent=formula;c.append(f);if(typeof value!=='number')c.setAttribute('t','str');const v=sheet.createElementNS(NS,'v');v.textContent=value??'';c.append(v)}
      else if(typeof value==='number'){const v=sheet.createElementNS(NS,'v');v.textContent=value;c.append(v)}
      else if(value){c.setAttribute('t','inlineStr');const is=sheet.createElementNS(NS,'is'),t=sheet.createElementNS(NS,'t');t.textContent=value;is.append(t);c.append(is)}return c;
    }
    const columns=['K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB','AC','AD'];
    for(const r of model.rows){const row=rows.find(x=>Number(x.getAttribute('r'))===r.index),base=[...row.children].find(c=>c.getAttribute('r')==='H'+r.index)?.getAttribute('s')||0;row.setAttribute('spans','1:30');for(const col of columns){let kind=['Z','AA'].includes(col)?'text':['N','P','AC','AD'].includes(col)?'percent':col==='S'?'index':'money';if((r.type==='resource'&&['K','S'].includes(col))||(r.type==='gesn'&&!r.children.length&&(['K','S'].includes(col)||col==='M'&&!r.costKind)))kind='input';row.append(cell(col+r.index,r.costValues[col],costStyle(base,kind),r.costFormulas[col]))}}
    const footer=model.rows.at(-1).index+2,foot=rows.find(r=>Number(r.getAttribute('r'))===footer),base=[...foot.children].at(-1).getAttribute('s');
    for(const col of ['L','M','O','Q','R','U','V','W','X','Y'])foot.append(cell(col+footer,cachedSum(model.roots,col),costStyle(base,'money'),guarded(model.roots,col)));
    foot.setAttribute('spans','1:30');xfs.setAttribute('count',xfs.children.length);zip.file('xl/styles.xml',serialize(styleDoc));
    const methodCell=rows.find(r=>r.getAttribute('r')==='2').children[0];
    const ref=methodCell.getAttribute('r'),style=methodCell.getAttribute('s');methodCell.replaceWith(cell(ref,info.method,style));
    // Old sample merges must not hide quantities or descriptions in a different selection.
    const merges=first(sheet,'mergeCells');if(merges){for(const m of [...merges.children])if(Number(m.getAttribute('ref').match(/\d+/)?.[0])>=5)m.remove();merges.setAttribute('count',merges.children.length)}
    const last=model.rows.at(-1).index;
    for(const f of all(sheet,'autoFilter'))f.setAttribute('ref',`A4:AD${last}`);
    first(sheet,'dimension')?.setAttribute('ref',`A1:AD${footer}`);
    const preset=request.filterPreset||'Все уровни',presetDepth={'Все уровни':6,'Без ресурсов':5,'До ВИКР':4,'До марок':3,'Только объекты и КР':2,'Только объекты':1}[preset]??6;
    let filter=[...sheet.documentElement.children].find(c=>c.localName==='autoFilter');
    if(!filter){filter=sheet.createElementNS(NS,'autoFilter');const after=first(sheet,'customSheetViews')||first(sheet,'mergeCells')||first(sheet,'pageMargins');sheet.documentElement.insertBefore(filter,after||null)}
    filter.setAttribute('ref',`A4:AD${last}`);while(filter.firstChild)filter.firstChild.remove();
    if(presetDepth<6){const fc=sheet.createElementNS(NS,'filterColumn');fc.setAttribute('colId','27');const fs=sheet.createElementNS(NS,'customFilters'),f=sheet.createElementNS(NS,'customFilter');f.setAttribute('operator','lessThanOrEqual');f.setAttribute('val',presetDepth);fs.append(f);fc.append(fs);filter.append(fc)}
    const view=first(sheet,'sheetView');view?.setAttribute('tabSelected','1');view?.setAttribute('showGridLines','0');view?.setAttribute('zoomScale','85');
    for(const r of model.rows){const row=rows.find(x=>Number(x.getAttribute('r'))===r.index);if(r.depth>presetDepth)row.setAttribute('hidden','1');else row.removeAttribute('hidden')}
    let props=first(sheet,'sheetPr');if(!props){props=sheet.createElementNS(NS,'sheetPr');sheet.documentElement.prepend(props)}
    if(presetDepth<6)props.setAttribute('filterMode','1');else props.removeAttribute('filterMode');
    zip.file(sheetPath,serialize(sheet));
    const wb=parse(await zip.file('xl/workbook.xml').async('string'));
    for(const dn of all(wb,'definedName')){const name=dn.getAttribute('name')||'';if(name.includes('Print_Area'))dn.textContent=`'Структура'!$A$1:$Y$${footer}`;if(name.includes('_FilterDatabase'))dn.textContent=`'Структура'!$A$4:$AD$${last}`}
    zip.file('xl/workbook.xml',serialize(wb));
    return info;
  }
  return {version:'5.15',defaultMethod,methods:data.methods.map(({id,name,caption})=>({id,name,caption})),catalogs:window.VIKR_EXCEL_COST_CATALOGS.catalogs,catalogsForMethod:window.VIKR_EXCEL_COST_CATALOGS.forMethod,methodsForCatalog:window.VIKR_EXCEL_COST_CATALOGS.methodsFor,methodFor,resolve,getPrice,enrich,decorate};
})();
