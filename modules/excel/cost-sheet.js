/* v5.13 export snapshot: editable inputs are on Настройки; NR/SP rates stay in formulas. */
window.VIKR_EXCEL_COSTS=(()=>{
  const legacy=window.VIKR_EXCEL_COSTS,data=window.VIKR_EXCEL_COST_DATA,NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
  const parse=s=>new DOMParser().parseFromString(s,'application/xml'),all=(d,n)=>[...d.getElementsByTagNameNS(NS,n)],first=(d,n)=>all(d,n)[0],serialize=d=>new XMLSerializer().serializeToString(d);
  const pause=()=>new Promise(r=>setTimeout(r,0));
  const key=window.VIKR_PRICES.key;
  const global={workers:"'Настройки'!$B$7",drivers:"'Настройки'!$B$7",materials:"'Настройки'!$B$8",equipment:"'Настройки'!$B$8",machines:"'Настройки'!$B$9"};
  const blank=ref=>`NOT(ISNUMBER(${ref}))`;
  function getPrice(r,info={},p={}){
    const found=VIKR_PRICES.lookup(info,r,p);if(found.source==='Сплит-форма')return found;
    const catalog=data.prices[r.code]||data.prices[key(r.code)],saved=r.source==='ФСНБ-2022'||r.priceSource==='ФСНБ'?r.price:null;
    if(!['workers','drivers'].includes(r.kind)){
      const base=legacy.getPrice({...r,price:saved||catalog?.price});
      if(base.value!==null)return {...base,source:'ФСНБ',current:false,index:1};
    }
    if(found.estimate)return {...found.estimate,index:1};
    return {...found,value:null,index:1,source:'Не учтена цена'};
  }
  function enrich(model,request){
    const method=legacy.methodFor(request),objects=new Map((request.objects||[]).map(o=>[o.id,o]));let missingNorms=0,missingPrices=0,standaloneInputs=0;
    for(const row of model.rows){let root=row;while(root.parent)root=root.parent;row.object=objects.get(root.objectId)||request.objects?.[model.roots.indexOf(root)];const info=row.object?.info||{};
      if(row.type==='gesn'){
        const p=row.sourceRecord||row,ref=info.estimatePricing?.positions?.[p.meta?.estimatePosition+'|'+String(p.code||'').replace(/\s/g,'').toUpperCase()];
        row.costNorm=legacy.resolve(ref?.vr&&!p.vr&&!p.Vr2001?{...p,vr:ref.vr}:p,method,request);if(row.costNorm.error)missingNorms++;
        if(!row.children.length){const catalog=data.prices[key(p.code)];row.costKind=catalog?(catalog.price.operation!==undefined?'machines':'materials'):null;row.costPrice=getPrice({...p,kind:row.costKind},info,p);if(row.costPrice.value===null||!row.costKind)standaloneInputs++;}
      }
      if(row.type==='resource'){row.costPrice=getPrice(row.sourceRecord||row,info,row.parent?.sourceRecord);if(row.costPrice.value===null)missingPrices++;}
    }
    return {method,missingNorms,missingPrices,standaloneInputs};
  }
  function aggregate(children,col,fn='SUM'){
    if(!children.length)return '0';const refs=children.map(r=>col+r.index),ranges=[];let start=refs[0],end=start,last=children[0].index;
    const add=()=>ranges.push(start===end?start:start+':'+end);
    for(let i=1;i<refs.length;i++){if(children[i].index===last+1){end=refs[i]}else{add();start=end=refs[i]}last=children[i].index}add();
    const parts=[];for(let i=0;i<ranges.length;i+=200)parts.push(fn+'('+ranges.slice(i,i+200).join(',')+')');const f=parts.join('+');if(f.length>7500)throw Error('Слишком много вложенных уровней для формулы Excel. Выгрузите состав частями.');return f;
  }
  const sum=(children,col)=>children.reduce((s,r)=>s+(num(r.costValues?.[col])??0),0);
  const rateKey=r=>[r.kind,key(r.code),r.name,r.unit].join('|');
  function inputRows(model){
    const rates=new Map();for(const r of model.rows)if(r.type==='resource'&&['workers','drivers'].includes(r.kind)){const k=rateKey(r);if(!rates.has(k))rates.set(k,{kind:r.kind,code:r.code,name:r.name,unit:r.unit,prices:new Set()});if(r.costPrice.value!==null)rates.get(k).prices.add(r.costPrice.value);}
    const labor=[...rates.entries()].sort((a,b)=>a[1].kind.localeCompare(b[1].kind)||a[1].name.localeCompare(b[1].name,'ru')).map(([key,r],i)=>({...r,key,index:16+i}));const map=new Map(labor.map(r=>[r.key,r.index]));
    for(const r of model.rows)if(r.type==='resource'&&['workers','drivers'].includes(r.kind))r.laborRow=map.get(rateKey(r));
    return {labor};
  }
  async function calculations(model,progress){
    for(let i=model.rows.length-1;i>=0;i--){const r=model.rows[i],n=r.index,f={},v={},leaf=r.type==='resource'||r.type==='gesn'&&!r.children.length;
      if(leaf){
        const p=r.costPrice||{value:null,index:1,source:'Не учтена цена'},wage=r.type==='resource'&&['workers','drivers'].includes(r.kind);
        v.K=p.value;
        if(wage){const own=`'Настройки'!$E$${r.laborRow}`,general=`'Настройки'!$B$${r.kind==='workers'?5:6}`;f.K=`IF(ISNUMBER(${own}),${own},IF(ISNUMBER(${general}),${general},${p.value===null?'""':p.value}))`;f.Z=`IF(ISNUMBER(${own}),"Индивидуальная ставка",IF(ISNUMBER(${general}),"Общая ставка",${p.value===null?'"Не учтена цена"':'"'+p.source+'"'}))`;}
        else f.Z=`IF(ISNUMBER(K${n}),IF(K${n}=${p.value===null?'""':p.value},"${p.value===null?'Ручной ввод':p.source}","Ручной ввод"),"Не учтена цена")`;
        if(wage){const sourceFormula=f.Z;f.Z=`IF(ISNUMBER(K${n}),IF(K${n}=${f.K},${sourceFormula},"Ручной ввод"),"Не учтена цена")`}
        v.Z=p.source;
        f.L=`IF(AND(ISNUMBER(D${n}),ISNUMBER(K${n})),D${n}*K${n},"")`;v.L=r.qty!==null&&p.value!==null?r.qty*p.value:null;
        if(r.type==='resource'||r.costKind){f.M=wage?`IF(ISNUMBER(L${n}),L${n},"")`:'0';v.M=wage?v.L:0;}else v.M=null;
        const native=p.index??1,g=global[r.kind||r.costKind]||global.workers;
        f.S=`IF(ISNUMBER(${g}),${g}*${native},${native===1?'""':native})`;v.S=native===1?null:native;
        f.T=`IF(ISNUMBER(K${n}),K${n}*IF(ISNUMBER(S${n}),S${n},1),"")`;v.T=p.value===null?null:p.value*native;
        f.U=`IF(AND(ISNUMBER(D${n}),ISNUMBER(T${n})),D${n}*T${n},"")`;v.U=v.T!==null&&r.qty!==null?r.qty*v.T:null;
        f.V=wage?`IF(ISNUMBER(U${n}),U${n},"")`:r.type==='resource'||r.costKind?'0':`IF(ISNUMBER(M${n}),M${n}*IF(ISNUMBER(${global.workers}),${global.workers},1),"")`;v.V=wage?v.U:r.type==='resource'||r.costKind?0:null;
      }else{
        for(const c of ['L','M','U','V']){f[c]=aggregate(r.children,c);v[c]=sum(r.children,c)}
        for(const [c,a] of [['K','L'],['T','U']]){f[c]=`IF(AND(ISNUMBER(D${n}),D${n}<>0),${a}${n}/D${n},"")`;v[c]=r.qty?v[a]/r.qty:null;}
      }
      if(r.type==='gesn'){
        const norm=r.costNorm||{},nr=num(norm.nrCurrent)===null?'""':String(num(norm.nrCurrent)),sp=num(norm.spCurrent)===null?'""':String(num(norm.spCurrent));v.N=norm.nr??null;v.P=norm.sp??null;
        for(const [c,fot,pct,current,cor] of [['O','M','N',false,10],['Q','M','P',false,11],['W','V',nr,true,10],['X','V',sp,true,11]]){
          const ref=current?pct:pct+n,control=`'Настройки'!$B$${cor}`;
          f[c]=`IF(NOT(ISNUMBER(${fot}${n})),"",IF(${fot}${n}=0,0,IF(ISNUMBER(${ref}),${fot}${n}*${ref}/100*IF(ISNUMBER(${control}),${control},1),"")))`;
          const value=current?(c==='W'?norm.nrCurrent:norm.spCurrent):v[pct];v[c]=v[fot]===null?null:v[fot]===0?0:value==null?null:v[fot]*value/100;
        }
        f.R=`SUM(L${n},O${n},Q${n})`;v.R=(v.L??0)+(v.O??0)+(v.Q??0);f.Y=`SUM(U${n},W${n},X${n})`;v.Y=(v.U??0)+(v.W??0)+(v.X??0);
        const childBad=r.children.length?`COUNTIFS(AA${r.children[0].index}:AA${r.children.at(-1).index},"Неполная")`:'0';
        const incompleteConditions=[`${childBad}>0`,`NOT(ISNUMBER(L${n}))`,`NOT(ISNUMBER(M${n}))`,`AND(M${n}<>0,OR(NOT(ISNUMBER(N${n})),NOT(ISNUMBER(P${n}))))`,`AND(V${n}<>0,OR(NOT(ISNUMBER(${nr})),NOT(ISNUMBER(${sp}))))`];
        f.AA=`IF(OR(${incompleteConditions.join(',')}),"Неполная","Полная")`;
        v.AA=(r.children.some(c=>c.costValues.AA==='Неполная')||v.L===null||v.M===null||v.M!==0&&(v.N===null||v.P===null)||v.V!==0&&(norm.nrCurrent==null||norm.spCurrent==null))?'Неполная':'Полная';
      }else if(r.type==='resource'){
        f.R=`SUM(L${n})`;v.R=v.L??0;f.Y=`SUM(U${n})`;v.Y=v.U??0;
        f.AA=`IF(AND(ISNUMBER(K${n}),ISNUMBER(D${n})),"Полная","Неполная")`;v.AA=v.L===null?'Неполная':'Полная';
      }else{
        for(const c of ['O','Q','R','W','X','Y']){f[c]=aggregate(r.children,c);v[c]=sum(r.children,c)}
        const expr=r.children.length?`COUNTIFS(AA${r.children[0].index}:AA${r.children.at(-1).index},"Неполная")`:'0';
        f.AA=`IF(${expr}>0,"Неполная","Полная")`;v.AA=r.children.some(c=>c.costValues.AA==='Неполная')?'Неполная':'Полная';
      }
      // Unit prices of positions and parents include NR/SP exactly once.
      // Resource unit prices remain their original inputs. A composition-less
      // position uses direct cost L as its editable input to avoid K -> L -> R -> K.
      if(r.type!=='resource'){
        if(leaf){
          const p=r.costPrice||{value:null,index:1,source:'Не учтена цена'};
          if(p.value===null)delete f.L;
          else f.L=`IF(ISNUMBER(D${n}),D${n}*${p.value},"")`;
          f.U=`IF(ISNUMBER(L${n}),L${n}*IF(ISNUMBER(S${n}),S${n},1),"")`;
          f.Z=`IF(ISNUMBER(L${n}),IF(${p.value===null?'FALSE':`AND(ISNUMBER(D${n}),L${n}=D${n}*${p.value})`},"${p.source}","Ручной ввод"),"Не учтена цена")`;
        }
        for(const [price,total] of [['K','R'],['T','Y']]){
          f[price]=`IF(AND(ISNUMBER(D${n}),D${n}<>0),${total}${n}/D${n},"")`;
          v[price]=r.qty?v[total]/r.qty:null;
        }
      }
      r.costFormulas=f;r.costValues=v;
      if(i%200===0){progress?.(55+15*(model.rows.length-i)/model.rows.length,'Расчёт формул стоимости');await pause()}
    }
  }
  async function decorate(zip,model,request){
    const info=enrich(model,request),inputs=inputRows(model);await calculations(model,request.onProgress);
    const sheet=parse(await zip.file('xl/worksheets/sheet1.xml').async('string')),rows=new Map(all(sheet,'row').map(r=>[Number(r.getAttribute('r')),r]));
    const sd=parse(await zip.file('xl/styles.xml').async('string')),xfs=first(sd,'cellXfs'),settings=parse(await zip.file('xl/worksheets/sheet2.xml').async('string')),settingsRows=all(settings,'row'),inputStyle=[...settingsRows.find(r=>r.getAttribute('r')==='5').children].find(c=>c.getAttribute('r')==='B5')?.getAttribute('s')||0,yellow=xfs.children[inputStyle].getAttribute('fillId'),styles=new Map();
    function style(base,kind){const k=base+':'+kind;if(styles.has(k))return styles.get(k);const xf=xfs.children[Number(base)||0].cloneNode(true);xf.setAttribute('numFmtId',kind==='percent'?164:kind==='text'?0:4);xf.setAttribute('applyNumberFormat','1');let a=first(xf,'alignment');if(!a){a=sd.createElementNS(NS,'alignment');xf.append(a)}a.setAttribute('horizontal',kind==='text'?'left':'right');a.setAttribute('wrapText',kind==='text'?'1':'0');if(kind==='input'){xf.setAttribute('fillId',yellow);xf.setAttribute('applyFill','1')}const id=xfs.children.length;xfs.append(xf);styles.set(k,id);return id}
    // Explicit numeric percent format independent of the template's style numbering.
    let nf=first(sd,'numFmts');if(!nf){nf=sd.createElementNS(NS,'numFmts');sd.documentElement.prepend(nf)}let percent=[...nf.children].find(f=>f.getAttribute('formatCode')==='0.0"%"');if(!percent){percent=sd.createElementNS(NS,'numFmt');percent.setAttribute('numFmtId',Math.max(164,...[...nf.children].map(f=>Number(f.getAttribute('numFmtId'))))+1);percent.setAttribute('formatCode','0.0"%"');nf.append(percent)}nf.setAttribute('count',nf.children.length);
    const percentId=percent.getAttribute('numFmtId');
    function cell(doc,ref,value,s,formula){const c=doc.createElementNS(NS,'c');c.setAttribute('r',ref);c.setAttribute('s',s);if(formula){const f=doc.createElementNS(NS,'f');f.textContent=formula;c.append(f);if(typeof value!=='number')c.setAttribute('t','str');const v=doc.createElementNS(NS,'v');v.textContent=value??'';c.append(v)}else if(typeof value==='number'){const v=doc.createElementNS(NS,'v');v.textContent=value;c.append(v)}else if(value!==null&&value!==undefined&&value!==''){c.setAttribute('t','inlineStr');const is=doc.createElementNS(NS,'is'),t=doc.createElementNS(NS,'t');t.textContent=value;is.append(t);c.append(is)}return c}
    const cols=['K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','AA'];
    for(const [i,r] of model.rows.entries()){const row=rows.get(r.index),base=[...row.children].find(c=>c.getAttribute('r')==='H'+r.index)?.getAttribute('s')||0;for(const c of [...row.children])if(!/^[A-J]\d+$/.test(c.getAttribute('r')))c.remove();for(const col of cols){let kind=['Z','AA'].includes(col)?'text':['N','P'].includes(col)?'percent':'money';if((r.type==='resource'&&['K','S'].includes(col))||(r.type==='gesn'&&!r.children.length&&(['L','S'].includes(col)||col==='M'&&!r.costKind)))kind='input';const s=style(base,kind);if(kind==='percent')xfs.children[s].setAttribute('numFmtId',percentId);row.append(cell(sheet,col+r.index,r.costValues[col],s,r.costFormulas[col]));}row.setAttribute('spans','1:27');if(i%200===0){request.onProgress?.(70+10*i/model.rows.length,'Заполнение Excel: '+i.toLocaleString('ru-RU')+' строк');await pause()}}
    const footer=model.rows.at(-1).index+2,foot=rows.get(footer),base=[...foot.children].at(-1).getAttribute('s');for(const col of ['L','M','O','Q','R','U','V','W','X','Y'])foot.append(cell(sheet,col+footer,sum(model.roots,col),style(base,'money'),aggregate(model.roots,col)));
    foot.append(cell(sheet,'AA'+footer,model.roots.some(r=>r.costValues.AA==='Неполная')?'Неполная':'Полная',style(base,'text'),`IF(${model.roots.map(r=>`IF(AA${r.index}="Неполная",1,0)`).join('+')}>0,"Неполная","Полная")`));
    for(const c of all(sheet,'c')){const letters=c.getAttribute('r')?.match(/^[A-Z]+/)?.[0]||'';const column=[...letters].reduce((n,l)=>n*26+l.charCodeAt(0)-64,0);if(column>27)c.remove()}
    for(const el of all(sheet,'customSheetViews'))el.remove();for(const el of all(sheet,'autoFilter'))el.remove();
    const merges=first(sheet,'mergeCells');if(merges){for(const m of [...merges.children])if(Number(m.getAttribute('ref').match(/\d+/)?.[0])>=5)m.remove();merges.setAttribute('count',merges.children.length)}
    const filter=sheet.createElementNS(NS,'autoFilter');filter.setAttribute('ref',`A4:AA${model.rows.at(-1).index}`);sheet.documentElement.insertBefore(filter,merges||first(sheet,'pageMargins')||null);
    first(sheet,'dimension')?.setAttribute('ref',`A1:AA${footer}`);first(sheet,'sheetPr')?.removeAttribute('filterMode');
    const colContainer=first(sheet,'cols');if(colContainer){const definitions=[...colContainer.children];for(const col of definitions)col.remove();for(let i=1;i<=27;i++){const def=definitions.find(c=>i>=Number(c.getAttribute('min'))&&i<=Number(c.getAttribute('max'))),col=def?def.cloneNode(true):sheet.createElementNS(NS,'col');col.setAttribute('min',i);col.setAttribute('max',i);col.removeAttribute('hidden');col.removeAttribute('collapsed');if(i>=8&&i<=10||i>=11&&i<=18||i>=20&&i<=24)col.setAttribute('outlineLevel','1');else col.removeAttribute('outlineLevel');colContainer.append(col)}}
    // Completeness remains text-only. Preserve the template's static styles and input fills.
    zip.file('xl/worksheets/sheet1.xml',serialize(sheet));
    const pdata=first(settings,'sheetData'),pRows=new Map(settingsRows.map(r=>[Number(r.getAttribute('r')),r]));for(const row of [...pdata.children])if(Number(row.getAttribute('r'))>15)row.remove();
    const normalBase=[...pRows.get(5).children].find(c=>c.getAttribute('r')==='A5').getAttribute('s'),normal=style(normalBase,'text'),numeric=style(normalBase,'money'),editable=style(inputStyle,'input'),header=[...pRows.get(15).children][0].getAttribute('s');
    function addRow(n,values,inputCol){const row=settings.createElementNS(NS,'row');row.setAttribute('r',n);row.setAttribute('ht',Math.max(30,Math.min(180,Math.ceil(Math.max(String(values[0]||'').length/50,String(values[1]||'').length/22,String(values[2]||'').length/68))*14+8)));row.setAttribute('customHeight','1');values.forEach((v,i)=>row.append(cell(settings,String.fromCharCode(65+i)+n,v,i===inputCol?editable:typeof v==='number'?numeric:normal)));pdata.append(row);return row}
    for(const r of inputs.labor)addRow(r.index,[r.kind==='workers'?'Рабочие':'Машинисты',r.code,r.name,r.unit,null,r.prices.size===1?[...r.prices][0]:r.prices.size>1?'Разные цены объектов':null],4);
    const sourceRow=16+inputs.labor.length+2;addRow(sourceRow,['Источники цен и методика']);addRow(sourceRow+1,['Методика НР/СП',info.method]);addRow(sourceRow+2,['Приоритет цены','Сплит-форма, затем ФСНБ, затем исходная смета']);
    for(const [i,o]of (request.objects||[]).entries())addRow(sourceRow+3+i,[o.info?.title||'Объект',o.info?.estimateRegion||o.info?.estimatePricing?.region||'Регион сметы не указан',[o.info?.splitForm?.name||'Сплит-форма не подключена',o.info?.splitForm?.zone,o.info?.splitForm?.period,o.info?.splitForm?.path].filter(Boolean).join(' · ')]);
    first(settings,'dimension')?.setAttribute('ref',`A1:F${sourceRow+3+(request.objects||[]).length}`);for(const dv of all(settings,'dataValidation'))if(dv.getAttribute('sqref')?.includes('E16'))dv.remove();
    // Source tables need fitted text, not input-yellow everywhere.
    xfs.setAttribute('count',xfs.children.length);zip.file('xl/styles.xml',serialize(sd));zip.file('xl/worksheets/sheet2.xml',serialize(settings));
    const wb=parse(await zip.file('xl/workbook.xml').async('string'));for(const el of all(wb,'customWorkbookViews'))el.remove();for(const dn of all(wb,'definedName')){const name=dn.getAttribute('name')||'';if(name.includes('Print_Area'))dn.textContent=`'Структура'!$A$1:$AA$${footer}`;if(name.includes('_FilterDatabase'))dn.textContent=`'Структура'!$A$4:$AA$${model.rows.at(-1).index}`;}zip.file('xl/workbook.xml',serialize(wb));
    return info;
  }
  return {...legacy,version:'5.15',getPrice,enrich,decorate};
})();
