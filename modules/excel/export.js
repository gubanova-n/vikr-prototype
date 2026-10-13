/* Offline XLSX export. The host passes a snapshot: this module never writes object files.
 * The supplied Excel form is kept intact (styles, panes, widths and table headers).
 * Only the hierarchy rows and their direct-child formulas are populated. */
window.VIKR_EXCEL = (() => {
  'use strict';
  const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const labels={object:'Объект',kr:'КР',mark:'Марка',package:'Комплект',vikr:'ВИКР',gesn:'ГЭСН',workers:'Рабочие',drivers:'Машинисты',machines:'Машины',materials:'Материалы'};
  const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const number=v=>finite(v)?Number(v):null;
  const xml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const parse=s=>{const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('Не удалось прочитать форму Excel');return d};
  const serialize=d=>new XMLSerializer().serializeToString(d);
  const tag=(d,name)=>d.getElementsByTagNameNS(NS,name)[0];
  const krOf=v=>v.kr||'Не распределено';
  const idOf=v=>v.id||v.uid;

  function buildRows({objects,nodes,calc=window.VIKR_CALC}) {
    if(!objects?.length||!nodes?.length)throw Error('Сначала выберите объект или элементы');
    const rows=[],roots=[],warnings={missing:0,excluded:0,derived:0,manual:0},totals=[0,0,0];
    const add=(type,code,name,qty,unit,parent)=>{const row={type,code:String(code||''),name:String(name||''),qty:number(qty),unit:unit||'',parent,children:[],totals:[0,0,0],known:0,incomplete:false,index:rows.length+5};rows.push(row);if(parent)parent.children.push(row);return row};
    for(const object of objects){
      const chosen=nodes.filter(n=>n.objectId===object.id);if(!chosen.length)continue;
      const levels=object.info?.levels||{},full=chosen.some(n=>n.type==='object'),root=add('object','',object.info?.title||object.name||'Объект',full?levels.object?.volume:null,levels.object?.unit,null);roots.push(root);
      root.objectId=object.id;
      const krs=new Map(),marks=new Map(),packages=new Map();
      function ensureKr(kr){if(krs.has(kr))return krs.get(kr);const meta=levels['kr:'+kr]||{},catalog=object.info?.krCatalog?.find(k=>k.code===kr),explicit=full||chosen.some(n=>n.type==='kr'&&n.value===kr);const r=add('kr',kr,meta.name||catalog?.name||kr,explicit?meta.volume:null,meta.unit,root);krs.set(kr,r);return r}
      function ensureMark(kr,mark){const key=kr+'|'+mark;if(marks.has(key))return marks.get(key);const meta=levels['mark:'+key]||{},r=add('mark',mark,meta.name||mark||'Без марки',null,'',ensureKr(kr));marks.set(key,r);return r}
      // Traverse one branch at a time: cached parents must never make non-contiguous subtrees.
      const groups=new Map();
      for(const v of object.vikrs||[]){const key=krOf(v)+'|'+(v.mark||'');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(v)}
      for(const key of Object.keys(levels)){if(key.startsWith('mark:')&&!groups.has(key.slice(5)))groups.set(key.slice(5),[]);else if(key.startsWith('kr:')&&!groups.has(key.slice(3)+'|')&&![...groups.keys()].some(k=>k.startsWith(key.slice(3)+'|')))groups.set(key.slice(3)+'|',[])}
      for(const entry of object.info?.krCatalog||[])if(![...groups.keys()].some(k=>k.startsWith(entry.code+'|')))groups.set(entry.code+'|',[]);
      for(const node of chosen){if(node.type==='kr'&&![...groups.keys()].some(k=>k.startsWith(node.value+'|')))groups.set(node.value+'|',[]);if(node.type==='mark'&&!groups.has(node.value))groups.set(node.value,[])}
      // Stable grouping preserves order within each KR/mark while keeping the hierarchy contiguous.
      const krGroups=new Map();for(const [key,items] of groups){const split=key.indexOf('|'),kr=key.slice(0,split),mark=key.slice(split+1);if(!krGroups.has(kr))krGroups.set(kr,[]);krGroups.get(kr).push({mark,items})}
      for(const [kr,entries] of krGroups)for(const {mark,items} of entries){
        const branch=full||chosen.some(n=>n.type==='kr'&&n.value===kr||n.type==='mark'&&n.value===kr+'|'+mark);
        if(branch&&!items.length){if(mark)ensureMark(kr,mark);else ensureKr(kr)}
        // A package may contain several VIKR, so keep package members together within their mark.
        const ordered=[...items.filter(v=>!v.packageId),...items.filter(v=>v.packageId).sort((a,b)=>String(a.packageId).localeCompare(String(b.packageId)))];
        for(const v of ordered){
          const vid=idOf(v),whole=branch||chosen.some(n=>n.type==='vikr'&&n.value===vid||n.type==='package'&&n.value===v.packageId);
          const selectedPositions=(v.gesn||[]).filter(p=>whole||chosen.some(n=>n.type==='gesn'&&n.value===p.id||n.type==='resource'&&n.positionId===p.id));
          if(!whole&&!selectedPositions.length)continue;
          let parent=ensureMark(kr,mark);
          const pack=(object.packages||[]).find(p=>p.id===v.packageId);
          if(pack){const pk=kr+'|'+mark+'|'+pack.id;if(!packages.has(pk))packages.set(pk,add('package','',pack.name,pack.count,pack.unit||'комплект',parent));parent=packages.get(pk)}
          const factor=object.exportWorking?calc.workFactor(v,object.packages||[]):1;
          const vr=v.exportLoose?null:add('vikr',v.code,v.name,whole?v.volume:null,v.unit,parent);
          const chain=[levels.object?.coefficients||[],levels['kr:'+kr]?.coefficients||[],levels['mark:'+kr+'|'+mark]?.coefficients||[]];
          if(object.exportWorking&&pack)chain.push(pack.coefficients||[]);
          for(const p of selectedPositions){
            if(p.excluded){warnings.excluded++;continue}
            const selected=(p.resources||[]).map((r,index)=>({r,index})).filter(({index})=>whole||chosen.some(n=>n.type==='gesn'&&n.value===p.id||n.type==='resource'&&n.positionId===p.id&&Number(n.index??n.value)===index));
            const pr=add('gesn',p.code,p.name,finite(p.qty)?Number(p.qty)*factor:null,p.unit,vr||parent);
            pr.sourceRecord=p;
            if(!selected.length){pr.incomplete=true;warnings.missing++}
            for(const {r} of selected){
              const rr=add('resource',r.code,r.name,null,r.unit,pr);rr.kind=r.kind;rr.label=labels[r.kind]||'Ресурс';
              rr.sourceRecord=r;
              const stored=number(r.qty),sourceFactor=number(r.meta?.coefficient)??1,extra=calc.resourceFactor(r,[...chain,v.coefficients||[],p.coefficients||[],r.coefficients||[]]);
              if(!finite(extra)||stored===null){rr.incomplete=true;warnings.missing++;continue}
              rr.coefficient=sourceFactor*extra;
              let norm=number(r.meta?.norm),pqty=number(p.qty);
              if(norm===null&&pqty!==null&&pqty!==0&&sourceFactor!==0){norm=stored/(pqty*sourceFactor);rr.derived=true;warnings.derived++}
              rr.norm=norm;
              const expected=pqty!==null&&norm!==null?pqty*norm*sourceFactor:null;
              const consistent=expected!==null&&Math.abs(expected-stored)<=Math.max(1e-9,Math.abs(stored)*1e-10);
              rr.qty=stored*factor*extra;
              if(!Number.isFinite(rr.qty)||!Number.isFinite(rr.coefficient))throw Error('Нечисловой расход или коэффициент: '+r.code);
              if(consistent)rr.quantityFormula=`D${pr.index}*F${rr.index}*G${rr.index}`;
              else {rr.manual=true;warnings.manual++;rr.baseQty=stored*factor;rr.extraFactor=extra;if(sourceFactor!==0)rr.quantityFormula=`${rr.baseQty/sourceFactor}*G${rr.index}`;else{rr.coefficient=extra;rr.quantityFormula=`${rr.baseQty}*G${rr.index}`}}
              rr.known=1;const ci=['workers','drivers','machines'].indexOf(r.kind);if(ci>=0)rr.totals[ci]=rr.qty;
            }
          }
        }
      }
      // Full object also keeps empty named structure, without manufacturing VIKR or GESN.
      if(!full)root.name+=' (выбранный состав)';
    }
    if(!rows.length)throw Error('Выбранные элементы уже отсутствуют в открытой базе. Обновите папку.');
    for(let i=rows.length-1;i>=0;i--){const r=rows[i];for(const c of r.children){r.known+=c.known;r.incomplete||=c.incomplete;r.totals=r.totals.map((t,j)=>t+c.totals[j])}if(r.incomplete)r.name+=r.type==='gesn'?' [состав ресурсов не определён полностью]':' [неполный состав]';if(r.manual)r.name+=' [расход по объекту]';else if(r.derived)r.name+=' [расчётная норма]'}
    roots.forEach(r=>r.totals.forEach((t,i)=>totals[i]+=t));
    return {rows,roots,warnings,totals};
  }

  function sumChildren(children,column){
    if(!children.length)return '0';
    const ranges=[];let start=children[0].index,last=start;
    const append=()=>ranges.push(start===last?column+start:column+start+':'+column+last);
    for(const c of children.slice(1)){if(c.index===last+1)last=c.index;else{append();start=last=c.index}}append();
    const parts=[];for(let i=0;i<ranges.length;i+=200)parts.push('SUM('+ranges.slice(i,i+200).join(',')+')');
    const formula=parts.join('+');if(formula.length>8192)throw Error('Слишком много дочерних элементов для одной формулы Excel. Выгрузите этот уровень частями.');return formula;
  }

  async function createXlsx(request,model=buildRows(request)){
    request.onProgress?.(5,'Подготовка выбранного состава');await new Promise(r=>setTimeout(r,0));
    if(!window.VIKR_EXCEL_COSTS)throw Error('Не загружен модуль стоимости Excel. Проверьте, что папка новой версии скопирована полностью.');
    if(model.rows.length>1048570)throw Error('Выбор превышает предельное число строк Excel. Выгрузите объекты отдельно.');
    const zip=await JSZip.loadAsync(request.template||window.VIKR_EXCEL_TEMPLATE,{base64:!request.template});
    const sheetPath='xl/worksheets/sheet1.xml',sheet=parse(await zip.file(sheetPath).async('string')),data=tag(sheet,'sheetData');
    const original=[...data.children],samples={object:5,kr:6,mark:7,package:7,vikr:8,gesn:9,resource:10,resourceAlt:11,total:74};
    const styles={};for(const [type,idx] of Object.entries(samples)){const row=original.find(r=>r.getAttribute('r')===String(idx));if(!row)throw Error('Форма не содержит эталонные строки структуры');styles[type]={height:row.getAttribute('ht'),cells:[...row.children].map(c=>c.getAttribute('s')||'0')}}
    // Preserve every original style. Add only wrapped variants of resource names so
    // real long catalogue descriptions do not disappear behind the quantity column.
    const styleDoc=parse(await zip.file('xl/styles.xml').async('string')),xfs=tag(styleDoc,'cellXfs');
    for(const type of ['resource','resourceAlt']){const originalStyle=xfs.children[Number(styles[type].cells[2])],wrapped=originalStyle.cloneNode(true);let alignment=wrapped.getElementsByTagNameNS(NS,'alignment')[0];if(!alignment){alignment=styleDoc.createElementNS(NS,'alignment');wrapped.append(alignment)}alignment.setAttribute('wrapText','1');wrapped.setAttribute('applyAlignment','1');styles[type].cells[2]=String(xfs.children.length);xfs.append(wrapped)}
    xfs.setAttribute('count',String(xfs.children.length));zip.file('xl/styles.xml',serialize(styleDoc));
    // Keep the three reserved blank rows and the original row 4 headers exactly as supplied.
    for(const r of original)if(Number(r.getAttribute('r'))>4)r.remove();
    let resourceIndex=0;
    function cell(col,row,value,style,formula){const ref=String.fromCharCode(65+col)+row;if(value===null||value===undefined)return `<c r="${ref}" s="${style}"/>`;if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Нечисловое значение Excel');return `<c r="${ref}" s="${style}">${formula?'<f>'+xml(formula)+'</f>':''}<v>${value}</v></c>`}const text=String(value);if(text.length>32767)throw Error('Название превышает предел 32767 символов в ячейке Excel');return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`}
    const generated=[];
    for(const [i,r] of model.rows.entries()){
      const s=styles[r.type==='resource'?(resourceIndex++%2?'resourceAlt':'resource'):r.type],values=[r.label||labels[r.type],r.code,r.name,r.qty,r.unit,r.norm??null,r.coefficient??null,...r.totals],formulas={};
      if(r.quantityFormula)formulas[3]=r.quantityFormula;
      for(let k=0;k<3;k++){const col=String.fromCharCode(72+k);if(r.incomplete&&!r.known)values[k+7]=null;else formulas[k+7]=r.type==='resource'?(['workers','drivers','machines'][k]===r.kind?'D'+r.index:'0'):sumChildren(r.children,col)}
      // Wrap long names at the template's original column width, rather than cutting them off.
      const lines=Math.ceil(Math.max(1,r.name.length)/53),height=Math.max(Number(s.height)||30,Math.min(409,lines*15+8));
      generated.push(`<row r="${r.index}" spans="1:10" ht="${height}" customHeight="1">${values.map((v,col)=>cell(col,r.index,v,s.cells[col],formulas[col])).join('')}</row>`);
      if(i%200===0){request.onProgress?.(10+40*i/model.rows.length,'Структура Excel: '+i.toLocaleString('ru-RU')+' из '+model.rows.length.toLocaleString('ru-RU')+' строк');await new Promise(r=>setTimeout(r,0));}
    }
    const last=model.rows.at(-1).index,footer=last+2,s=styles.total;
    generated.push(`<row r="${footer}" spans="1:10" ht="30" customHeight="1">${[null,null,model.roots.some(r=>r.incomplete)?'Итого по известному составу':'Итого',null,null,null,null,...model.totals].map((v,c)=>cell(c,footer,c>=7&&model.roots.every(r=>r.incomplete&&!r.known)?null:v,s.cells[c],c>=7?sumChildren(model.roots,String.fromCharCode(65+c)):null)).join('')}</row>`);
    const generatedDoc=parse(`<sheetData xmlns="${NS}">${generated.join('')}</sheetData>`);for(const row of [...generatedDoc.documentElement.children])data.append(sheet.importNode(row,true));
    tag(sheet,'dimension')?.setAttribute('ref',`A1:J${footer}`);let out=serialize(sheet);
    // Remove any old filter state; export always opens with all levels visible.
    zip.file(sheetPath,out);
    if(zip.file('xl/tables/table1.xml')){const table=parse(await zip.file('xl/tables/table1.xml').async('string'));table.documentElement.setAttribute('ref',`A4:J${last}`);const filter=tag(table,'autoFilter');filter.setAttribute('ref',`A4:J${last}`);while(filter.firstChild)filter.firstChild.remove();zip.file('xl/tables/table1.xml',serialize(table))}
    const wb=parse(await zip.file('xl/workbook.xml').async('string'));let calc=tag(wb,'calcPr');if(!calc){calc=wb.createElementNS(NS,'calcPr');wb.documentElement.append(calc)}calc.setAttribute('calcMode','auto');calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');
    // Old calculation chains and stale print ranges must not point into the replaced sample data.
    for(const name of [...wb.getElementsByTagNameNS(NS,'definedName')])if(/Print_Area|_FilterDatabase/.test(name.getAttribute('name')||''))name.textContent=`'Структура'!$A$4:$J$${last}`;
    zip.file('xl/workbook.xml',serialize(wb));zip.remove('xl/calcChain.xml');
    for(const path of ['xl/_rels/workbook.xml.rels','[Content_Types].xml']){const d=parse(await zip.file(path).async('string'));for(const el of [...d.documentElement.children])if([...el.attributes].some(a=>/calcChain/i.test(a.value)))el.remove();zip.file(path,serialize(d))}
    if(window.VIKR_EXCEL_COSTS)await window.VIKR_EXCEL_COSTS.decorate(zip,model,request);
    request.onProgress?.(85,'Сборка файла Excel');await new Promise(r=>setTimeout(r,0));
    return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',compression:'DEFLATE',compressionOptions:{level:3}},({percent})=>request.onProgress?.(85+percent*.15,'Сжатие и сохранение файла'));
  }

  function selectionSummary(nodes,model){
    const counts=new Map();for(const n of nodes){const key=n.type;counts.set(key,(counts.get(key)||0)+1)}
    const chosen=[...counts].map(([key,count])=>({object:'Объекты',kr:'КР',mark:'Марки',package:'Комплекты',vikr:'ВИКР',gesn:'ГЭСН',resource:'Ресурсы'}[key]||key)+': '+count).join(' · ');
    const composition=['vikr','gesn','resource'].map(type=>({vikr:'ВИКР',gesn:'ГЭСН',resource:'Ресурсы'}[type])+': '+model.rows.filter(r=>r.type===type).length.toLocaleString('ru-RU')).join(' · ');
    return {chosen,composition};
  }

  function open(request){
    if(!window.VIKR_EXCEL_COSTS)throw Error('Не загружен модуль стоимости Excel. Проверьте целостность папки новой версии.');
    const snapshot=structuredClone({...request,calc:undefined});snapshot.calc=window.VIKR_CALC;
    const model=buildRows(snapshot),previous=document.activeElement,summary=selectionSummary(snapshot.nodes,model);
    const costs=window.VIKR_EXCEL_COSTS;snapshot.methodology=costs?.methodFor(snapshot);
    const catalogService=window.VIKR_EXCEL_COST_CATALOGS;
    if(!catalogService.exportOptions(snapshot.methodology).some(m=>m.id===catalogService.forMethod(snapshot.methodology)[0]?.id))snapshot.methodology=costs.defaultMethod;
    const methodOptions=catalogService.exportOptions(snapshot.methodology);
    const previousCatalog=catalogService.forMethod(snapshot.methodology)[0]?.id;
    const selectedOption=methodOptions.find(m=>m.id===previousCatalog)||methodOptions.find(m=>m.id===catalogService.forMethod(costs.defaultMethod)[0]?.id)||methodOptions[0];
    snapshot.catalog=selectedOption.id;
    snapshot.methodology=selectedOption.methodId;
    const host=document.createElement('div');host.className='overlay excel-export-overlay';
    host.innerHTML=`<div class="dialog excel-export-dialog" role="dialog" aria-modal="true" aria-labelledby="excel-export-title"><button class="close dialog-close" aria-label="Закрыть">×</button><h2 id="excel-export-title">Экспорт в Excel</h2><p>Выбранные элементы с родительскими уровнями и всем дочерним составом.</p><div class="excel-export-stats"><strong>Выбрано: ${xml(summary.chosen)}</strong></div><div class="excel-export-composition"><span>Выгружаемый состав: ${xml(summary.composition)}</span><span>Объектов: ${model.roots.length} · Всего строк с родительскими уровнями: ${model.rows.length.toLocaleString('ru-RU')}</span></div><div class="note">Ваша форма: первые 3 строки пустые, заголовки в строке 4 закреплены. Общие фильтры позволяют оставить только нужные уровни. Итоги считаются по составу, без повторного суммирования родителей.</div><p class="subtle">Выгружаются фактические количества на объём. Режим «На 1 ед.» и поисковые фильтры не меняют выбранный состав.</p><div class="excel-export-notices"></div><label class="field"><span>Название файла</span><input id="excel-export-name" value="${xml((model.roots.length===1?model.roots[0].name.replace(/ \(выбранный состав\).*/, ''):'Выбранные объекты')+' — структура')}"></label><div class="dialog-actions"><button class="primary" id="excel-export-save">Выгрузить .xlsx</button></div><div class="excel-export-status" role="status" aria-live="polite"></div></div>`;
    const note=host.querySelector('.note');note.textContent='Заголовки в строке 4 закреплены. Ставки, индивидуальные цены труда и индексы находятся на листе «Настройки». Общий фильтр в столбце «Уровень» позволяет выбрать нужные уровни; фильтр «Полнота суммы» — найти частичные итоги. Известные стоимости суммируются даже при отсутствии остальных цен.';
    if(costs){const settings=document.createElement('div');settings.className='excel-export-settings';settings.innerHTML=`<label class="field"><span>Методика НР и СП</span><select id="excel-export-method">${methodOptions.map(m=>`<option value="${xml(m.id)}" ${m.id===snapshot.catalog?'selected':''}>${xml(m.name)}</option>`).join('')}</select></label><p class="subtle">Проверьте методику исходной сметы. Цены берутся из подключённой к объекту сплит-формы, затем ФСНБ, затем исходной сметы.</p><p class="subtle" id="excel-cost-coverage"></p>`;host.querySelector('.excel-export-notices').before(settings);const methodSelect=settings.querySelector('#excel-export-method'),update=()=>{snapshot.catalog=methodSelect.value;snapshot.methodology=methodOptions.find(m=>m.id===snapshot.catalog).methodId;const info=costs.enrich(model,snapshot);settings.querySelector('#excel-cost-coverage').textContent=`Позиции без однозначного норматива НР/СП: ${info.missingNorms}. Ресурсы без цены: ${info.missingPrices}. Отсутствующие ставки можно заполнить на листе «Настройки».`};methodSelect.onchange=update;update();}
    const notices=host.querySelector('.excel-export-notices'),w=model.warnings;
    if(costs){const settings=host.querySelector('.excel-export-settings'),reference=document.createElement('label');reference.className='excel-reference-choice';reference.innerHTML='<input id="excel-estimate-vr" type="checkbox" checked> Использовать Vr из предоставленной сметы при совпадении номера и кода позиции';settings.querySelector('#excel-cost-coverage').before(reference);reference.querySelector('input').onchange=e=>{snapshot.useEstimateVr=e.target.checked;settings.querySelector('#excel-export-method').onchange()};}
    if(costs){const select=host.querySelector('#excel-export-method'),previousChange=select.onchange;select.onchange=()=>{previousChange();const info=costs.enrich(model,snapshot);if(info.standaloneInputs)host.querySelector('#excel-cost-coverage').textContent+=` Позиции без состава, требующие ручной цены/ФОТ: ${info.standaloneInputs}.`;};select.onchange();}
    const messages=[];if(w.missing)messages.push(`Неполный состав: ${w.missing}. Неизвестные затраты не подменяются нулём.`);if(w.excluded)messages.push(`Исключённые из расчёта ГЭСН не выгружаются: ${w.excluded}.`);if(w.derived)messages.push(`Нормы, рассчитанные из сохранённого расхода: ${w.derived}. Они отмечены в строках.`);if(w.manual)messages.push(`Расходы, заданные в объекте отдельно от исходной нормы: ${w.manual}. Сохранены без пересчёта по старой норме.`);
    notices.textContent=messages.join(' ');document.body.append(host);
    let busy=false;const close=()=>{if(busy)return;host.remove();document.removeEventListener('keydown',key,true);previous?.focus()};const key=e=>{if(e.key==='Escape'){e.stopImmediatePropagation();close()}if(e.key==='Tab'){const controls=[...host.querySelectorAll('button:not(:disabled),input,select')],first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};
    document.addEventListener('keydown',key,true);host.querySelector('.close').onclick=close;host.addEventListener('click',e=>{if(e.target===host)close()});
    const button=host.querySelector('#excel-export-save'),status=host.querySelector('.excel-export-status');
    button.onclick=async()=>{if(busy)return;busy=true;const controls=[...host.querySelectorAll('input,select,button')];controls.forEach(c=>c.disabled=true);status.innerHTML='<progress max="100" value="0" style="width:100%"></progress><div class="excel-progress-caption">Подготовка файла…</div>';snapshot.onProgress=(percent,phase)=>{status.querySelector('progress').value=percent;status.querySelector('.excel-progress-caption').textContent=Math.min(100,Math.round(percent))+'% · '+phase;};try{await new Promise(r=>setTimeout(r,30));const blob=await createXlsx(snapshot,model),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=(host.querySelector('#excel-export-name').value.trim()||'Структура').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,160).replace(/[. ]+$/,'')+'.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),60000);status.textContent='Файл передан браузеру для сохранения.'}catch(error){status.textContent='Не удалось выгрузить: '+error.message}finally{busy=false;controls.forEach(c=>c.disabled=false);delete snapshot.onProgress}};
    button.focus();return host;
  }
    return {version:'5.13',buildRows,createXlsx,open};
})();
