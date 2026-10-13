(() => {
  "use strict";
  const C=window.VIKR_CALC, objectFiles=window.VIKR_OBJECT_FILES;
  const $=s=>document.querySelector(s);
  const clone=x=>structuredClone(x);
  const num=(x,d=4)=>x==null||!Number.isFinite(Number(x))?"—":new Intl.NumberFormat("ru-RU",{maximumFractionDigits:d}).format(Number(x));
  const esc=x=>String(Array.isArray(x)?x.map(item=>item?.name||item?.code||"Коэффициент").join(", "):x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  const uid=()=>"n"+Math.random().toString(36).slice(2,10);
  const trashIcon='<svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 5h12l-.8 12a2 2 0 0 1-2 2H8.8a2 2 0 0 1-2-2L6 8Zm4 3v8h1.5v-8H10Zm3.5 0v8H15v-8h-1.5Z"/></svg>';
  const burgerIcon='<svg class="burger-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const disclosureIcon=expanded=>`<svg class="disclosure-icon${expanded?' is-expanded':''}" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 2 13 8 4 14Z"/></svg>`;
  const storage={work:"vikr-v3.16-work",copies:"vikr-v3.16-copies",settings:"vikr-v3.3-settings"};
  const legacyStorage={work:"vikr-v3.15-work",copies:"vikr-v3.15-copies"};
  function load(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}}
  let workDbPromise,workSaveQueue=Promise.resolve(),workSaveTimer,lastSavedWorkJson=null;
  function openWorkDb(){
    if(!window.indexedDB)return Promise.resolve(null);
    workDbPromise||=new Promise(resolve=>{try{const request=indexedDB.open("vikr-prototype-v3.16",1);request.onupgradeneeded=()=>request.result.createObjectStore("states");request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null)}catch{resolve(null)}});
    return workDbPromise;
  }
  async function readWorkState(key){const db=await openWorkDb();if(!db)return null;return new Promise(resolve=>{try{const request=db.transaction("states","readonly").objectStore("states").get(key);request.onsuccess=()=>resolve(request.result??null);request.onerror=()=>resolve(null)}catch{resolve(null)}})}
  async function readLegacyWorkState(key){if(!window.indexedDB)return null;return new Promise(resolve=>{try{const request=indexedDB.open("vikr-prototype-v3.15",1);request.onsuccess=()=>{const db=request.result;try{const get=db.transaction("states","readonly").objectStore("states").get(key);get.onsuccess=()=>resolve(get.result??null);get.onerror=()=>resolve(null)}catch{resolve(null)}};request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null)}catch{resolve(null)}})}
  async function writeWorkState(key,value){const db=await openWorkDb();if(!db)return false;return new Promise(resolve=>{try{const transaction=db.transaction("states","readwrite");transaction.objectStore("states").put(value,key);transaction.oncomplete=()=>resolve(true);transaction.onerror=()=>resolve(false);transaction.onabort=()=>resolve(false)}catch{resolve(false)}})}
  function persistWorkNow(){
    clearTimeout(workSaveTimer);
    const json=JSON.stringify(work);
    const snapshot=clone(work);
    workSaveQueue=workSaveQueue.catch(()=>false).then(async()=>{if(json===lastSavedWorkJson)return true;if(await writeWorkState(storage.work,snapshot)){lastSavedWorkJson=json;return true}try{localStorage.setItem(storage.work,json);lastSavedWorkJson=json;return true}catch{return false}});
    return workSaveQueue;
  }
  function queueWorkSave(){clearTimeout(workSaveTimer);workSaveTimer=setTimeout(()=>{persistWorkNow().then(ok=>{if(!ok)toast("Не удалось сохранить рабочий объект")})},250)}
  async function persistCopiesNow(){const snapshot=clone(savedCopies);if(await writeWorkState(storage.copies,snapshot))return true;try{localStorage.setItem(storage.copies,JSON.stringify(snapshot));return true}catch{toast("Не удалось сохранить копии объектов");return false}}

  // Объекты загружаются только из разрешённой папки. Браузер хранит лишь настройки интерфейса.
  let base=[];
  function hydratePosition(p){
    if(p.source==="ФСНБ-2022"||p.base||/^\d{2}-\d{2}-\d{3}-\d{2}$/.test(p.code||""))p.code=fsnbFullCode(p.code,p.base);
    if(typeof p.coefficients==="string")p.coefficients=p.coefficients.trim()?[{assignmentId:`legacy-${p.id}`,code:"Исходный",name:p.coefficients.trim(),legacy:true,resourceRules:[]}]:undefined;
    else if(!Array.isArray(p.coefficients)||!p.coefficients.length)delete p.coefficients;
    p.resources||=[];
    for(const r of p.resources)if(!Array.isArray(r.coefficients)||!r.coefficients.length)delete r.coefficients;
    return p;
  }
  function hydrateVikr(v){v.coefficients=Array.isArray(v.coefficients)?v.coefficients:[];v.gesn||=[];v.gesn.forEach(hydratePosition);return v}
  const emptyBaseInfo=()=>({title:"",levels:{},krCatalog:[],deleted:true});
  let baseInfo=emptyBaseInfo(),baseObjects=[],activeBaseId=null;
  let folderWriteQueue=Promise.resolve(),customBaseSaveQueue=Promise.resolve(),pendingFolderWrites=0,pendingLocalWrites=0;
  let folderStatus="Папка не выбрана";
  function clearFolderObjects(){
    baseObjects=[];base=[];baseInfo=emptyBaseInfo();activeBaseId=null;
    ui.baseObjectMode=true;ui.selection.clear();ui.objectSelection.clear();ui.baseHistory=[];ui.baseForward=[];ui.baseGesnFocus=null;
    ui.activeNode={type:"object",value:"all"};ui.baseDetail={...ui.activeNode};ui.baseFocus=null;
    screenPast=[];screenFuture=[];screenCurrent=null;
  }
  function queueObjectFileSave(object){
    if(!object||!objectFiles.isReady()){toast("Сначала выберите папку и разрешите доступ");return false}
    const snapshot=clone(object);pendingFolderWrites++;
    folderWriteQueue=folderWriteQueue.catch(()=>false).then(()=>objectFiles.write(snapshot)).then(ok=>{
      if(!ok){toast("Файл не сохранён: он удалён, изменён извне или доступ к папке утрачен. Обновите список.");setTimeout(()=>refreshObjectsFolder(),0)}
      return ok;
    }).finally(()=>pendingFolderWrites--);
    customBaseSaveQueue=folderWriteQueue;
    return true;
  }
  function persistBase(){
    const active=baseObjects.find(object=>object.id===activeBaseId);if(!active)return false;
    if(active.packages){const ids=new Set(base.map(v=>v.id));for(const pack of active.packages)pack.memberIds=(pack.memberIds||[]).filter(id=>ids.has(id))}
    return queueObjectFileSave(active);
  }
  function persistBaseInfo(){return queueObjectFileSave(baseObjects.find(object=>object.id===activeBaseId))}
  function selectBaseObject(id,open=true){
    const object=baseObjects.find(x=>x.id===id);if(!object)return;
    activeBaseId=id;base=object.vikrs;baseInfo=object.info;
    if(open&&baseInfo.treeHidden){baseInfo.treeHidden=false;persistBaseInfo()}
    try{localStorage.setItem("vikr-v4.0-active-object",id)}catch{}
    ui.baseObjectMode=!open;ui.baseGesnFocus=null;ui.baseHistory=[];ui.baseTreeExpanded.add("object|all");ui.objectSelection.clear();ui.selection.clear();ui.query="";$("#search").value="";
    ui.activeNode={type:"object",value:"all"};ui.baseDetail={...ui.activeNode};ui.baseFocus=base[0]?.id;ui.baseView="kr";
    renderAll();
  }
  function openCreateBaseObject(){
    modal(`<h2 id="dialog-title">Создать объект</h2><p>Новый объект появится в Базе без конструктивов и ВИКР.</p><div class="dialog-grid"><label class="field wide"><span>Наименование</span><input id="new-object-name" placeholder="Название объекта" required></label><label class="field"><span>Единица измерения</span><input id="new-object-unit" placeholder="Например, км"></label><label class="field"><span>Объём</span><input id="new-object-volume" type="number" min="0" step="any" placeholder="Можно указать позже"></label></div><div class="dialog-actions"><button class="outline" id="new-object-cancel">Отмена</button><button class="primary" id="new-object-save">Создать</button></div>`,()=>{
      $("#new-object-cancel").onclick=closeModal;$("#new-object-name").focus();
      $("#new-object-save").onclick=async()=>{const title=$("#new-object-name").value.trim(),raw=$("#new-object-volume").value.trim(),volume=raw===""?null:Number(raw),unit=$("#new-object-unit").value.trim();if(!title||volume!==null&&(!Number.isFinite(volume)||volume<0)){toast("Укажите название и корректный объём");return}
        const info={title,location:"",description:"",source:"",note:"",levels:{object:{name:title,unit,volume,note:"",coefficients:[]}},krCatalog:[],treeHidden:false,deleted:false},object={id:uid(),info,vikrs:[]};
        if(!await ensureFolderAccess())return;
        if(!await objectFiles.write(object,{create:true})){toast("Не удалось создать файл объекта в папке «Объекты»");return}
        baseObjects.push(object);closeModal();selectBaseObject(object.id,false);toast("Объект создан");
      };
    });
  }
  async function chooseObjectsFolder(){
    if(pendingFolderWrites){toast("Дождитесь сохранения изменений перед выбором другой папки");return false}
    const result=await objectFiles.choose();
    if(!result.ok){
      if(result.reason==="unsupported")toast("Браузер не поддерживает выбор папки. Откройте прототип в Chrome или Edge");
      else if(result.reason!=="cancelled")toast("Не удалось получить доступ к выбранной папке");
      if(!objectFiles.isReady()){clearFolderObjects();renderAll()}
      return false;
    }
    clearFolderObjects();ui.query="";$("#search").value="";
    return refreshObjectsFolder();
  }
  async function ensureFolderAccess(){
    if(!objectFiles.hasHandle())return chooseObjectsFolder();
    if(await objectFiles.permitted(true)){
      if(!objectFiles.isReady())return refreshObjectsFolder();
      return true;
    }
    clearFolderObjects();folderStatus="Нужен доступ к выбранной папке";renderAll();
    toast("Разрешите доступ к папке через «Выбрать папку»");return false;
  }
  async function refreshObjectsFolder(rerender=true){
    await folderWriteQueue;
    const found=await objectFiles.list();
    if(!found){
      clearFolderObjects();folderStatus=objectFiles.hasHandle()?"Нет доступа к выбранной папке":"Папка не выбрана";
      if(rerender){renderAll();toast(folderStatus)}
      return false;
    }
    const previousId=activeBaseId;
    baseObjects=found.objects;
    for(const object of baseObjects){object.info.levels||={};object.info.krCatalog||=[];object.packages||=[];object.vikrs.forEach(hydrateVikr)}
    const active=baseObjects.find(object=>object.id===previousId)||baseObjects[0];
    activeBaseId=active?.id||null;base=active?.vikrs||[];baseInfo=active?.info||emptyBaseInfo();
    ui.baseObjectMode=true;ui.selection.clear();ui.objectSelection.clear();ui.activeNode={type:"object",value:"all"};ui.baseDetail={...ui.activeNode};ui.baseFocus=base[0]?.id;
    ui.baseHistory=[];ui.baseForward=[];ui.baseGesnFocus=null;
    screenPast=[];screenFuture=[];screenCurrent=null;
    folderStatus="Папка подключена";
    if(rerender){renderAll();toast(found.invalid.length?"Загружено объектов: "+baseObjects.length+". Некорректных файлов: "+found.invalid.length:"Загружено объектов: "+baseObjects.length)}
    return true;
  }
  const initialWork={id:uid(),present:false,name:"Новый рабочий объект",unit:"",volume:null,baseVolume:null,levelMeta:{},coefficients:[],info:{title:"",location:"",description:"",source:"",note:""},structures:[],vikrs:[],packages:[],loose:[]};
  let work=clone(initialWork);
  work.info||={title:"",location:"",description:"",source:"",note:""};
  work.unit||="";work.volume=work.volume??null;work.baseVolume=work.baseVolume??work.volume;work.levelMeta||={};
  let savedCopies=[];
  let settings=load(storage.settings,{theme:"light"});
  let ui={space:"base",query:"",workType:"",krFilter:"",markFilter:"",unitFilter:"",advancedOpen:false,filter:"all",activeNode:{type:"object",value:"all"},baseDetail:{type:"object",value:"all"},baseFocus:base[0]?.id,baseMode:"full",baseView:"kr",baseObjectMode:true,objectSelection:new Set(),selection:new Set(),baseTreeExpanded:new Set(["object|all"]),baseGesnFocus:null,baseHistory:[],workFocus:{type:"object",id:work.id},workView:"kr",workMode:"full",workType:"",workKrFilter:"",workMarkFilter:"",workUnitFilter:"",workAdvancedOpen:false,poolSelection:new Set(),gesnSelection:new Set(),workSelection:new Set(),workTreeEdit:false,workTreeExpanded:new Set(["object"]),workQuery:"",workListOpen:false};

  const baseUiKey="vikr-v4.3-base-ui";
  function saveBaseUi(){
    const table=$("#space-base .table-scroll"),tree=$("#base-tree .base-tree-list");
    try{localStorage.setItem(baseUiKey,JSON.stringify({objectId:activeBaseId,baseObjectMode:ui.baseObjectMode,activeNode:ui.activeNode,baseDetail:ui.baseDetail,baseView:ui.baseView,baseMode:ui.baseMode,baseGesnFocus:ui.baseGesnFocus,baseHistory:ui.baseHistory,baseTreeExpanded:[...ui.baseTreeExpanded],advancedOpen:ui.advancedOpen,query:ui.query,workType:ui.workType,krFilter:ui.krFilter,markFilter:ui.markFilter,unitFilter:ui.unitFilter,tableX:table?.scrollLeft||0,tableY:table?.scrollTop||0,treeY:tree?.scrollTop||0}))}catch{}
  }
  function restoreBaseUi(saved){
    if(!saved||saved.objectId!==activeBaseId)return;
    ui.baseObjectMode=Boolean(saved.baseObjectMode)||!activeBaseId;
    const n=saved.activeNode||{type:"object",value:"all"};
    const valid=n.type==="object"||n.type==="kr"&&knownKrs().includes(n.value)||n.type==="mark"&&(base.some(v=>(v.kr||"Не распределено")+"|"+(v.mark||"")===n.value)||Boolean(baseInfo.levels?.["mark:"+n.value]))||n.type==="vikr"&&base.some(v=>v.id===n.value)||n.type==="package"&&activePackages().some(p=>p.id===n.value);
    ui.activeNode=valid?n:{type:"object",value:"all"};
    const detail=saved.baseDetail;ui.baseDetail=detail&&["object","kr","mark","vikr","package"].includes(detail.type)?detail:{...ui.activeNode};
    ui.baseView=["kr","mark","vikr"].includes(saved.baseView)?saved.baseView:"kr";ensureBaseView();
    ui.baseMode=saved.baseMode==="unit"?"unit":"full";
    ui.baseTreeExpanded=new Set(Array.isArray(saved.baseTreeExpanded)?saved.baseTreeExpanded:["object|all"]);
    ui.baseGesnFocus=ui.activeNode.type==="vikr"&&base.find(v=>v.id===ui.activeNode.value)?.gesn.some(p=>p.id===saved.baseGesnFocus)?saved.baseGesnFocus:null;ui.baseHistory=Array.isArray(saved.baseHistory)?saved.baseHistory.filter(item=>item?.activeNode&&["object","kr","mark","vikr","package"].includes(item.activeNode.type)):[];
    ui.advancedOpen=Boolean(saved.advancedOpen);ui.query=String(saved.query||"");ui.workType=String(saved.workType||"");ui.krFilter=String(saved.krFilter||"");ui.markFilter=String(saved.markFilter||"");ui.unitFilter=String(saved.unitFilter||"");
    $("#search").value=ui.query;
    requestAnimationFrame(()=>{const table=$("#space-base .table-scroll"),tree=$("#base-tree .base-tree-list");if(table){table.scrollLeft=Number(saved.tableX)||0;table.scrollTop=Number(saved.tableY)||0}if(tree)tree.scrollTop=Number(saved.treeY)||0});
  }

  function toast(message){const t=$("#toast");t.textContent=message;t.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove("show"),2600)}
  function modal(html,onReady,wide=false){$("#dialog-body").innerHTML=html;$("#overlay .dialog").classList.toggle("dialog-wide",wide);$("#overlay").classList.remove("hidden");onReady?.();positionModalBackButtons();decorateQuantities($("#dialog-body"));document.querySelectorAll("#dialog-body button").forEach(button=>{if(/^(Отмена|Отменить|Закрыть)$/.test(button.textContent.trim()))button.remove()});document.querySelectorAll("#dialog-body .dialog-actions").forEach(actions=>{if(!actions.querySelector("button"))actions.remove()})}
  function closeModal(){$("#overlay").classList.add("hidden");$("#overlay .dialog").classList.remove("dialog-wide")}
  function baseCoefficientChain(v){return [baseInfo.levels.object?.coefficients||[],baseInfo.levels["kr:"+(v.kr||"Не распределено")]?.coefficients||[],baseInfo.levels["mark:"+(v.kr||"Не распределено")+"|"+(v.mark||"")]?.coefficients||[]]}
  function workCoefficientChain(v){const pack=packageFor(v);return [work.coefficients||[],work.levelMeta["kr:"+(v.kr||"")]?.coefficients||[],work.levelMeta["mark:"+(v.kr||"")+"|"+(v.mark||"")]?.coefficients||[],pack?.coefficients||[]]}
  function baseTotals(v,factor=1){return C.totals(v,factor,baseCoefficientChain(v))}
  function workVikrTotals(v,factor=1){return C.totals(v,factor,workCoefficientChain(v))}
  function totalsFor(items){return C.addTotals(items.map(v=>baseTotals(v)))}
  const norm=x=>String(x??"").toLocaleLowerCase("ru-RU").replace(/[.\s]/g,"").replace(/[–—]/g,"-");
  function knownKrs(){const catalog=(baseInfo.krCatalog||[]).map(x=>x.code),fromVikr=base.map(v=>v.kr||"Не распределено");return [...new Set([...catalog,...fromVikr])].filter(Boolean)}
  function krCatalogItem(code){return (baseInfo.krCatalog||[]).find(x=>x.code===code)}
  function findFormWork(v){return Array.isArray(v.meta?.works)?v.meta.works:[]}
  function activePackages(){return baseObjects.find(object=>object.id===activeBaseId)?.packages||[]}
  function groupIds(type,value){if(type==="object")return base.map(v=>v.id);if(type==="package"){const pack=activePackages().find(item=>item.id===value);return (pack?.memberIds||base.filter(v=>v.packageId===value).map(v=>v.id)).filter(id=>base.some(v=>v.id===id))}if(type==="kr")return base.filter(v=>(v.kr||"Не распределено")===value).map(v=>v.id);if(type==="mark"){const [kr,mark]=value.split("|");return base.filter(v=>(v.kr||"Не распределено")===kr&&v.mark===mark).map(v=>v.id)}return [value]}
  function levelKey(type,value){return type==="object"?"object":type+":"+value}
  function getLevelMeta(type,value){if(type==="package"){const pack=activePackages().find(item=>item.id===value);return {name:pack?.name||"Комплект",unit:pack?.unit||"комплект",volume:pack?.count??1,note:""}}if(type==="vikr"){const v=base.find(x=>x.id===value);return {unit:v?.unit||"",volume:Number(v?.volume)||0,note:v?.note||""}}if(type==="mark")return baseInfo.levels[levelKey(type,value)]||{unit:"",volume:null};if(type==="kr"){const stored=baseInfo.levels[levelKey(type,value)]||{},catalog=krCatalogItem(value)||{};return {...catalog,...stored,name:stored.name||catalog.name||value,unit:stored.unit||catalog.unit||"",volume:stored.volume==null||stored.volume===""?catalog.volume??null:stored.volume,note:stored.note||""}}return baseInfo.levels[levelKey(type,value)]||{unit:"",volume:null,note:""}}
  function levelMetaText(type,value){const m=getLevelMeta(type,value);return m.volume!=null&&m.volume!==""?`Количество: ${num(m.volume)} · Ед. изм.: ${m.unit||"Не указана"}`:"Объём не задан"}
  function knownMarks(kr){return [...new Set([...base.filter(v=>(v.kr||"Не распределено")===kr).map(v=>v.mark||""),...Object.keys(baseInfo.levels||{}).filter(k=>k.startsWith("mark:"+kr+"|")).map(k=>k.slice(6+kr.length))])]}
  function scaleBaseVikr(v,factor){window.VIKR_QUANTITIES.vikr(v,factor)}
  function editBaseLevel(type,value,onBack){
    if(type==="vikr"){editBaseVikrNew(value,null,onBack);return}
    const meta=clone(getLevelMeta(type,value)),items=groupIds(type,value).map(id=>base.find(v=>v.id===id)).filter(Boolean),isMark=type==="mark",catalog=type==="kr"?krCatalogItem(value):null;
    const currentName=type==="object"?baseInfo.title:type==="kr"?meta.name||catalog?.name||value:value.split("|")[1];
    const codeField=type==="kr"?`<label class="field"><span>Код</span><input id="level-code" value="${esc(value)}"></label>`:"";
    const amountFields=isMark?"":`<label class="field"><span>Единица измерения</span><input id="level-unit" value="${esc(meta.unit||"")}" placeholder="Например, км или комплект"></label><label class="field"><span>Объём уровня</span><input id="level-volume" type="number" min="0" step="any" value="${meta.volume==null?"":meta.volume}"></label>`;
    const scaleField=isMark?"":`<label class="radio-row"><input type="checkbox" id="level-scale" ${Number(meta.volume)>0?"checked":"disabled"}><span><strong>Пересчитать вложенные ВИКР пропорционально</strong><small>${Number(meta.volume)>0?"Объёмы ВИКР изменятся от объёма уровня, а ГЭСН и ресурсы пересчитаются от ВИКР.":"Станет доступно после сохранения первого объёма уровня."}</small></span></label>`;
    modal(`<h2 id="dialog-title">Изменить ${type==="object"?"объект":type==="kr"?"конструктив":"марку"}</h2><p>${isMark?"Объём марки можно задать и изменить прямо в окне просмотра. Связи и состав ВИКР сохраняются.":"При изменении объёма вложенные ВИКР и их состав пересчитываются пропорционально."}</p><div class="dialog-grid">${codeField}<label class="field ${type==="object"||isMark?"wide":""}"><span>Наименование</span><input id="level-name" value="${esc(currentName)}"></label>${amountFields}<label class="field wide"><span>Комментарий уровня</span><textarea id="level-note">${esc(meta.note||"")}</textarea></label></div>${scaleField}<div class="dialog-actions dialog-actions-split">${onBack?'<button class="outline" id="level-back">Назад</button>':''}<div><button class="outline" id="level-cancel">Отменить</button><button class="primary" id="level-save">Сохранить</button></div></div>`,()=>{
      if(onBack)$("#level-back").onclick=onBack;$("#level-cancel").onclick=closeModal;$("#level-save").onclick=()=>{
        const name=$("#level-name").value.trim(),code=type==="kr"?$("#level-code").value.trim():value,unit=isMark?meta.unit||"":$("#level-unit").value.trim(),raw=isMark?"":$("#level-volume").value.trim(),volume=isMark?meta.volume??null:raw===""?null:Number(raw),note=$("#level-note").value.trim();
        if(!name||type==="kr"&&!code||volume!=null&&(!Number.isFinite(volume)||volume<0)){toast("Проверьте наименование и объём");return}
        if(!isMark&&$("#level-scale").checked&&Number(meta.volume)>0&&volume!=null&&volume!==Number(meta.volume)){const factor=volume/Number(meta.volume);window.VIKR_QUANTITIES.scaleNode(baseObjects.find(o=>o.id===activeBaseId),{type,value},factor)}
        const oldKey=levelKey(type,value);
        if(type==="object")baseInfo.title=name;
        if(type==="kr"&&code!==value){base.filter(v=>(v.kr||"Не распределено")===value).forEach(v=>v.kr=code);for(const key of Object.keys(baseInfo.levels)){if(key.startsWith("mark:"+value+"|")){baseInfo.levels["mark:"+code+key.slice(("mark:"+value).length)]=baseInfo.levels[key];delete baseInfo.levels[key]}}ui.activeNode={type:"kr",value:code};ui.baseDetail={...ui.activeNode}}
        if(type==="kr"){const item=catalog||{code};item.code=code;item.name=name;if(!catalog)baseInfo.krCatalog.push(item)}
        if(type==="mark"){const [kr,mark]=value.split("|");if(name!==mark){base.filter(v=>(v.kr||"Не распределено")===kr&&v.mark===mark).forEach(v=>v.mark=name);ui.activeNode={type:"mark",value:kr+"|"+name};ui.baseDetail={...ui.activeNode}}}
        const newValue=type==="kr"?code:type==="mark"?value.split("|")[0]+"|"+name:value,newKey=levelKey(type,newValue);
        if(oldKey!==newKey)delete baseInfo.levels[oldKey];baseInfo.levels[newKey]={...meta,name,unit,volume,note};
        persistBase();persistBaseInfo();ui.baseFocus=groupIds(ui.activeNode.type,ui.activeNode.value)[0];closeModal();renderNav();renderObjectLists();renderBase();toast("Уровень обновлён");
      }
    })
  }
  function isActiveNode(v){const n=ui.activeNode;return n.type==="object"||n.type==="package"&&(v.packageId===n.value||activePackages().find(pack=>pack.id===n.value)?.memberIds?.includes(v.id))||n.type==="kr"&&(v.kr||"Не распределено")===n.value||n.type==="mark"&&(v.kr||"Не распределено")+"|"+v.mark===n.value||n.type==="vikr"&&v.id===n.value}
  function visibleBase(){
    const query=ui.query.toLowerCase().trim(),terms=query.split(/\s+/).filter(Boolean),workTerms=ui.workType.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let scope=base.filter(isActiveNode);
    if(ui.krFilter)scope=scope.filter(v=>(v.kr||"Не распределено")===ui.krFilter);
    if(ui.markFilter)scope=scope.filter(v=>(v.mark||"Без марки")===ui.markFilter);
    if(ui.unitFilter)scope=scope.filter(v=>(v.unit||"")===ui.unitFilter);
    if(workTerms.length)scope=scope.filter(v=>workTerms.every(t=>(v.code+" "+v.name+" "+worksOfVikr(v).join(" ")).toLowerCase().includes(t)));
    if(query){const exact=scope.filter(v=>String(v.code).toLowerCase()===query);if(exact.length)return exact}
    return scope.filter(v=>terms.every(t=>[v.code,v.name,v.kr,v.mark,v.note,...v.gesn.flatMap(p=>[p.code,p.name,...p.resources.flatMap(r=>[r.code,r.name])])].join(" ").toLowerCase().includes(t)))
  }
  function filterMatch(v){return true}
  function applyTheme(){document.documentElement.dataset.theme=settings.theme==="dark"?"dark":"light"}
  function renderObjectLists(){
    const list=$("#base-object-list");
    list.innerHTML=baseObjects.length?baseObjects.map(object=>`<button data-id="${esc(object.id)}" class="${object.id===activeBaseId&&!ui.baseObjectMode?'active':''}" title="${esc(object.info.title)}">${esc(object.info.title)}</button>`).join(""):'<span class="empty-list">Нет объектов</span>';
    list.querySelectorAll("button").forEach(button=>button.onclick=()=>selectBaseObject(button.dataset.id));
  }
  function toggleObjectList(space){const id=space==="base"?"#base-object-list":"#work-object-list",other=space==="base"?"#work-object-list":"#base-object-list";const list=$(id),willOpen=list.classList.contains("hidden");$(other).classList.add("hidden");list.classList.toggle("hidden",!willOpen);if(willOpen)renderObjectLists()}
  function renderNav(){
    ui.space="base";$("#nav-base").classList.add("active");$("#space-base").classList.remove("hidden");$("#space-work").classList.add("hidden");
    $("#page-title").textContent="База ВИКР";$("#rail-object-name").textContent=activeBaseId?baseInfo.title:"Объект не выбран";
    $("#top-actions").innerHTML=`<span class="selected-folder" title="${esc(folderStatus)}">${objectFiles.folderName?.()?`Папка: <strong>${esc(objectFiles.folderName())}</strong>${objectFiles.isReady()?"":" · нет доступа"}`:"Папка не выбрана"}</span><button class="outline" id="choose-objects-folder">Выбрать папку</button><button class="outline" id="refresh-objects-folder">Обновить</button><button class="primary" id="create-base-object">Создать объект</button>`;
    $("#create-base-object").onclick=openCreateBaseObject;$("#create-base-object").disabled=!objectFiles.isReady();
    $("#choose-objects-folder").onclick=chooseObjectsFolder;
    $("#refresh-objects-folder").onclick=async()=>{if(!await ensureFolderAccess())return;await refreshObjectsFolder()};
  }
  function switchSpace(){ui.space="base";renderAll()}
  function renderAll(){renderNav();renderObjectLists();$("#work-selection-drawer").classList.add("hidden");renderBase()}
  function filterChips(){}
  function treeLine(type,value,label,level,count,glyph){const ids=groupIds(type,value),checked=ids.length>0&&ids.every(id=>ui.selection.has(id)),partial=!checked&&ids.some(id=>ui.selection.has(id));return `<div class="tree-row level-${level} ${ui.activeNode.type===type&&ui.activeNode.value===value?'active':''}" data-node="${type}" data-value="${esc(value)}"><span class="twisty">${type==='vikr'?'·':'⌄'}</span><span class="glyph ${type==='object'?'object':''} ${value==='Не распределено'?'alert':''}">${esc(glyph)}</span><span class="tree-text"><strong>${esc(label)}</strong><small>${count} ${type==='vikr'?'ГЭСН':'ВИКР'}</small></span><input type="checkbox" data-select-node="${type}" data-select-value="${esc(value)}" ${checked?'checked':''} ${partial?'data-partial="1"':''} aria-label="Выбрать ${esc(label)}"></div>`}
  function nodePath(n){
    const object=baseInfo.title||"Объект";
    if(n.type==="object")return object;
    if(n.type==="package")return `${object} › Комплект ${activePackages().find(pack=>pack.id===n.value)?.name||""}`;
    if(n.type==="kr")return `${object} › ${n.value}`;
    if(n.type==="mark"){const [kr,mark]=n.value.split("|");return `${object} › ${kr} › ${mark||"Без марки"}`}
    const v=base.find(x=>x.id===n.value);return v?`${object} › ${v.kr||"Не распределено"} › ${v.mark||"Без марки"} › ${v.code}`:object;
  }
  function renderBaseTree(){
    if(baseInfo.treeHidden||baseInfo.deleted){$("#base-tree").innerHTML=baseInfo.deleted?'<div class="empty">В Базе пока нет объектов.</div>':'<div class="empty">Объект убран из дерева. Выберите его в списке «+» у Базы.</div>';return}
    const previousScroll=$("#base-tree .base-tree-list")?.scrollTop||0,expanded=ui.baseTreeExpanded,row=(type,value,label,level,glyph,expandable=false)=>{const key=type+"|"+value,active=ui.activeNode.type===type&&ui.activeNode.value===value;return `<div class="base-tree-line" style="--level:${level}"><button class="tree-toggle" data-key="${esc(key)}" ${expandable?'':'disabled'} aria-label="${expanded.has(key)?'Свернуть':'Развернуть'} ${esc(label)}">${expandable?disclosureIcon(expanded.has(key)):''}</button><button class="tree-node ${active?'active':''}" data-type="${type}" data-value="${esc(value)}" style="--level:${level}"><span class="glyph ${type==='object'?'object':''}">${esc(glyph)}</span><span>${esc(label)}</span></button></div>`};
    let html=`<button class="outline full" id="open-base-picker">Выбрать уровень ▾</button><div class="base-tree-list">${row("object","all",baseInfo.title||"Объект",0,"О",true)}`;
    if(expanded.has("object|all"))for(const kr of knownKrs()){
      const marks=[...new Set([...base.filter(v=>(v.kr||"Не распределено")===kr).map(v=>v.mark||"Без марки"),...Object.keys(baseInfo.levels||{}).filter(k=>k.startsWith("mark:"+kr+"|")).map(k=>k.slice(6+kr.length))])],krExpandable=marks.length>0,krLabel=krCatalogItem(kr)?.name||kr;
      html+=row("kr",kr,`${kr} · ${krLabel}`,1,"КР",krExpandable);
      if(krExpandable&&expanded.has("kr|"+kr))for(const mark of marks){const markValue=kr+"|"+(mark==="Без марки"?"":mark),items=base.filter(v=>(v.kr||"Не распределено")===kr&&(v.mark||"Без марки")===mark),markExpandable=items.length>0;if(mark==="Без марки"){for(const v of items)html+=row("vikr",v.id,`${v.code} · ${v.name}`,2,"В")}else{html+=row("mark",markValue,mark,2,"М",markExpandable);if(markExpandable&&expanded.has("mark|"+markValue))for(const v of items)html+=row("vikr",v.id,`${v.code} · ${v.name}`,3,"В")}}
    }
    html+="</div>";$("#base-tree").innerHTML=html;$("#base-tree .base-tree-list").scrollTop=previousScroll;
    $("#open-base-picker").onclick=openBasePicker;
    $("#base-tree").querySelectorAll(".tree-toggle:not(:disabled)").forEach(button=>button.onclick=()=>{expanded.has(button.dataset.key)?expanded.delete(button.dataset.key):expanded.add(button.dataset.key);renderBaseTree();saveBaseUi()});
    $("#base-tree").querySelectorAll(".tree-node").forEach(button=>button.onclick=()=>{ui.activeNode={type:button.dataset.type,value:button.dataset.value};ui.baseDetail={...ui.activeNode};ui.baseFocus=button.dataset.type==="vikr"?button.dataset.value:groupIds(button.dataset.type,button.dataset.value)[0];ui.baseGesnFocus=null;ui.baseHistory=[];ui.baseView=button.dataset.type==="kr"?"mark":"vikr";if(button.dataset.type==="object")ui.baseView="kr";renderBase()});
  }
  function deleteBaseObject(){
    const deletedId=activeBaseId;if(!deletedId)return;
    pendingFolderWrites++;
    folderWriteQueue=folderWriteQueue.catch(()=>false).then(async()=>{
      const ok=await objectFiles.remove(deletedId);if(!ok)toast("Не удалось удалить файл объекта");return ok;
    }).finally(()=>pendingFolderWrites--);
    customBaseSaveQueue=folderWriteQueue;
    folderWriteQueue.then(()=>refreshObjectsFolder());
  }
  function removeBaseLevel(type,value){
    const ids=groupIds(type,value).filter(id=>base.some(v=>v.id===id));
    const label=type==="package"?`комплект «${activePackages().find(pack=>pack.id===value)?.name||value}»`:type==="kr"?`конструктив «${value}»`:type==="mark"?`марку «${value.split("|")[1]}»`:`ВИКР «${base.find(v=>v.id===value)?.code||value}»`;
    confirmDelete(label,`Будет удалено ${ids.length} ВИКР со всеми ГЭСН и ресурсами.`,()=>{
      const removed=new Set(ids);for(let i=base.length-1;i>=0;i--)if(removed.has(base[i].id))base.splice(i,1);
      if(type==="kr"){
        baseInfo.krCatalog=(baseInfo.krCatalog||[]).filter(x=>x.code!==value);
        for(const key of Object.keys(baseInfo.levels))if(key==="kr:"+value||key.startsWith("mark:"+value+"|"))delete baseInfo.levels[key];
      }else if(type==="mark")delete baseInfo.levels[levelKey(type,value)];
      if(type==="package"){
        const object=baseObjects.find(item=>item.id===activeBaseId);if(object)object.packages=(object.packages||[]).filter(pack=>pack.id!==value);
      }
      persistBase();persistBaseInfo();
      ui.selection.clear();ui.baseFocus=base[0]?.id;ui.activeNode={type:"object",value:"all"};ui.baseDetail={...ui.activeNode};
    });
  }
  function openObjectPicker(){
    let editing=false;
    modal(`<h2 id="dialog-title">Выбор объекта</h2><p>Выберите объект для просмотра его структуры и ВИКР.</p><div class="picker-tree" id="object-list"></div><div class="dialog-actions"><button class="outline" id="object-edit">Изменить</button><button class="outline" id="object-close">Закрыть</button></div>`,()=>{
      const draw=()=>{$("#object-list").innerHTML=baseInfo.deleted?'<div class="empty">В Базе пока нет объектов.</div>':`<div class="picker-item"><button class="picker-label" id="select-object"><strong>${esc(baseInfo.title||"Объект")}</strong><small>${base.length} ВИКР · ${esc(levelMetaText("object","all"))}</small></button>${editing?'<button class="icon-edit" id="edit-object-level" aria-label="Изменить объект">✎</button><button class="icon-delete" id="delete-object" aria-label="Удалить объект">${trashIcon}</button>':''}</div>`;if($("#select-object"))$("#select-object").onclick=()=>{ui.activeNode={type:"object",value:"all"};ui.baseDetail={...ui.activeNode};ui.page=1;closeModal();renderBase()};if($("#edit-object-level"))$("#edit-object-level").onclick=()=>editBaseLevel("object","all",openObjectPicker);if($("#delete-object"))$("#delete-object").onclick=()=>confirmDelete(`Объект «${baseInfo.title||"Объект"}»`,"Объект, его структура, ВИКР, ГЭСН и ресурсы будут удалены.",deleteBaseObject)};
      $("#object-edit").onclick=()=>{editing=!editing;$("#object-edit").textContent=editing?"Готово":"Изменить";draw()};$("#object-close").onclick=closeModal;draw();
    },true);
  }
  function openBasePicker(){
    const expanded=new Set(["object|all"]);let editing=false;
    const glyphs={object:"О",kr:"КР",mark:"М",vikr:"В",gesn:"Г"};
    modal(`<h2 id="dialog-title">Выбрать уровень</h2><p>Раскройте структуру объекта до ГЭСН или найдите уровень по коду и названию.</p><label class="field"><span>Поиск</span><input id="picker-search" placeholder="Код или часть названия"></label><div class="picker-tree" id="picker-tree"></div><div class="dialog-actions"><button class="outline" id="picker-edit">Изменить</button><button class="outline" id="close-picker">Закрыть</button></div>`,()=>{
      const item=(type,value,label,level,count,canExpand,owner="")=>{const key=type+"|"+value,attrs=`data-type="${type}" data-value="${esc(value)}" data-owner="${esc(owner)}"`,meta=type==="gesn"?"":levelMetaText(type,value);return `<div class="picker-item" style="--level:${level}"><button class="picker-toggle" data-key="${esc(key)}" ${canExpand?'':'disabled'} aria-label="${expanded.has(key)?'Свернуть':'Раскрыть'} ${esc(label)}">${canExpand?disclosureIcon(expanded.has(key)):'·'}</button><button class="picker-label" ${attrs}><span class="type-badge">${glyphs[type]}</span><strong>${esc(label)}</strong><small>${esc(count)}${meta?` · ${esc(meta)}`:""}</small></button>${editing?`<button class="icon-edit picker-edit" ${attrs} aria-label="Изменить ${esc(label)}">✎</button>${type!=="object"?`<button class="icon-delete picker-delete" ${attrs} aria-label="Удалить ${esc(label)}">${trashIcon}</button>`:''}`:''}</div>`};
      const positionRow=(v,p,level)=>item("gesn",p.id,`${p.code} · ${p.name}`,level,`${p.resources?.length||0} ресурсов`,false,v.id);
      const vikrRows=(v,level)=>item("vikr",v.id,`${v.code} · ${v.name}`,level,`${v.gesn.length} ГЭСН`,v.gesn.length>0)+(expanded.has("vikr|"+v.id)?v.gesn.map(p=>positionRow(v,p,level+1)).join(""):"");
      const draw=()=>{
        const q=norm($("#picker-search").value);let html="";
        if(baseInfo.deleted)html='<div class="empty">Сначала добавьте объект в Базу.</div>';
        else if(q){for(const v of base){if(norm(v.code+" "+v.name+" "+v.kr+" "+v.mark).includes(q))html+=vikrRows(v,0);else html+=v.gesn.filter(p=>norm(p.code+" "+p.name).includes(q)).map(p=>positionRow(v,p,0)).join("")}if(!html)html='<div class="empty">Ничего не найдено</div>'}
        else{
          html+=item("object","all",baseInfo.title||"Объект",0,`${base.length} ВИКР`,true);
          if(expanded.has("object|all"))for(const kr of knownKrs()){
            const group=base.filter(v=>(v.kr||"Не распределено")===kr),krName=krCatalogItem(kr)?.name||kr;
            html+=item("kr",kr,`${kr} · ${krName}`,1,`${group.length} ВИКР`,knownMarks(kr).length>0);
            if(expanded.has("kr|"+kr))for(const mark of knownMarks(kr)){
              const items=group.filter(v=>(v.mark||"")===mark),key=kr+"|"+mark;
              html+=item("mark",key,mark||"Без марки",2,`${items.length} ВИКР`,items.length>0);
              if(expanded.has("mark|"+key))for(const v of items)html+=vikrRows(v,3);
            }
          }
        }
        $("#picker-tree").innerHTML=html;
        $("#picker-tree").querySelectorAll(".picker-toggle:not(:disabled)").forEach(b=>b.onclick=()=>{expanded.has(b.dataset.key)?expanded.delete(b.dataset.key):expanded.add(b.dataset.key);draw()});
        $("#picker-tree").querySelectorAll(".picker-label").forEach(b=>b.onclick=()=>{const type=b.dataset.type,value=b.dataset.value,owner=b.dataset.owner;ui.activeNode=type==="gesn"?{type:"vikr",value:owner}:{type,value};ui.baseDetail={...ui.activeNode};ui.baseFocus=type==="gesn"?owner:type==="vikr"?value:groupIds(type,value)[0];ui.baseGesnFocus=type==="gesn"?value:null;ui.page=1;closeModal();renderBase()});
        $("#picker-tree").querySelectorAll(".picker-edit").forEach(b=>b.onclick=()=>{if(b.dataset.type!=="gesn"){editBaseLevel(b.dataset.type,b.dataset.value,openBasePicker);return}const v=base.find(v=>v.id===b.dataset.owner);if(v)editAnyPosition(v.gesn,b.dataset.value,"base",()=>{persistBase();renderBase();openBasePicker()})});
        $("#picker-tree").querySelectorAll(".picker-delete").forEach(b=>b.onclick=()=>{if(b.dataset.type!=="gesn"){removeBaseLevel(b.dataset.type,b.dataset.value);return}const v=base.find(v=>v.id===b.dataset.owner),p=v?.gesn.find(p=>p.id===b.dataset.value);if(p)confirmDelete(`ГЭСН ${p.code}`,"ГЭСН и её ресурсы будут удалены из текущего состава.",()=>{v.gesn.splice(v.gesn.indexOf(p),1);if(ui.baseGesnFocus===p.id)ui.baseGesnFocus=null;persistBase()},openBasePicker)});
      };
      $("#picker-search").oninput=draw;$("#picker-edit").onclick=()=>{editing=!editing;$("#picker-edit").textContent=editing?"Готово":"Изменить";draw()};$("#close-picker").onclick=closeModal;draw();
    },true);
  }
  function filtersActive(){return Boolean(ui.query.trim()||ui.workType.trim()||ui.krFilter||ui.markFilter||ui.unitFilter)}
  function availableBaseViews(){const type=ui.activeNode.type;if(type==="object")return ["kr","mark","vikr"];if(type==="kr")return ["mark","vikr"];return ["vikr"]}
  function ensureBaseView(){const allowed=availableBaseViews();if(!allowed.includes(ui.baseView))ui.baseView=allowed[0]}
  function directRows(items){
    if(baseInfo.deleted)return [];
    ensureBaseView();
    const vikrRow=v=>({type:"vikr",value:v.id,label:v.name,code:v.code,badge:"В",place:`${v.kr||"Не распределено"} → ${v.mark||"Без марки"}`,items:[v],count:`${v.gesn.length} ГЭСН`});
    if(ui.baseView==="vikr")return items.map(vikrRow);
    if(ui.baseView==="kr"){const keys=ui.activeNode.type==="object"&&!filtersActive()?knownKrs():[...new Set(items.map(v=>v.kr||"Не распределено"))];return keys.map(kr=>{const nested=items.filter(v=>(v.kr||"Не распределено")===kr),catalog=krCatalogItem(kr),meta=getLevelMeta("kr",kr);return {type:"kr",value:kr,label:meta.name||catalog?.name||kr,code:kr,badge:"КР",place:baseInfo.title||"Объект",items:nested,count:`${new Set(nested.map(v=>v.mark||"Без марки")).size} марок · ${nested.length} ВИКР`}})}
    if(ui.activeNode.type==="kr"){const marks=[...new Set([...items.map(v=>v.mark).filter(Boolean),...(!filtersActive()?Object.keys(baseInfo.levels||{}).filter(k=>k.startsWith("mark:"+ui.activeNode.value+"|")).map(k=>k.slice(6+ui.activeNode.value.length)):[])])];return [...marks.map(mark=>{const value=ui.activeNode.value+"|"+mark,nested=items.filter(v=>v.mark===mark);return {type:"mark",value,label:getLevelMeta("mark",value).name||mark,code:mark,badge:"М",place:ui.activeNode.value,items:nested,count:`${nested.length} ВИКР`}}),...items.filter(v=>!v.mark).map(vikrRow)]}
    const keys=[...new Set([...items.map(v=>(v.kr||"Не распределено")+"|"+(v.mark||"")),...(!filtersActive()?Object.keys(baseInfo.levels||{}).filter(k=>k.startsWith("mark:")).map(k=>k.slice(5)):[])])];
    return keys.map(value=>{const [kr,mark]=value.split("|"),nested=items.filter(v=>(v.kr||"Не распределено")===kr&&(v.mark||"")===mark);return {type:"mark",value,label:mark||"Без марки",code:mark||"Без марки",badge:"М",place:kr,items:nested,count:`${nested.length} ВИКР`}});
  }
  function rowIds(row){return row.items.map(v=>v.id)}
  function rowSelectionTokens(row){if(row.type==="gesn")return ["position:"+row.value];if(row.type==="resource")return ["resource:"+row.position.id+":"+row.value];const ids=rowIds(row);return ids.length?ids:[`level:${row.type}:${row.value}`]}
  function selectedEmptyLevels(){return [...ui.selection].filter(value=>value.startsWith("level:")).map(value=>{const [,type,...parts]=value.split(":");return {type,value:parts.join(":")}})}
  function rowMeta(row){return row.type==="vikr"?{unit:row.items[0]?.unit||"",volume:Number(row.items[0]?.volume)||null}:getLevelMeta(row.type,row.value)}
  function mountBurgerVolume(element,node,onSaved){const object=baseObjects.find(o=>o.id===activeBaseId);window.VIKR_STRUCTURE_FEATURES.mountVolumeEditor(element,object,node,baseFeatureHost(),onSaved,"burger")}
  function childLevelsHtml(children){
    return `<div class="level-detail-list">${children.map((child,index)=>{const t=totalsFor(child.items);return `<div class="level-detail-row"><div><b><span class="type-badge">${esc(child.badge||({kr:"КР",mark:"М",vikr:"В"}[child.type]))}</span> ${esc(child.code)} · ${esc(child.label)}</b><small>${esc(child.count)}</small></div><div><span>${num(t.workers)} чел.-ч</span><span>${num(t.drivers)} чел.-ч</span><span>${num(t.machines)} маш.-ч</span></div><div class="burger-child-volume" data-child-index="${index}"></div></div>`}).join("")||'<div class="empty">Вложенных элементов нет</div>'}</div>`;
  }
  function mountBurgerEditors(parentElement,parentNode,children,onSaved){
    const object=baseObjects.find(o=>o.id===activeBaseId),body=$("#dialog-body"),host=baseFeatureHost();let busy=false;
    const guarded={...host,commit:async changed=>{
      if(busy)throw Error("Дождитесь сохранения текущего объёма");
      busy=true;const controls=[...body.querySelectorAll('input,button[id$="-volume-save"]')].map(el=>({el,disabled:el.disabled}));controls.forEach(({el})=>el.disabled=true);
      try{return await host.commit(changed)}finally{busy=false;controls.forEach(({el,disabled})=>el.disabled=disabled)}
    }};
    const refresh=draft=>{const scroll=body.querySelector('.burger-elements,.expanded-positions,.burger-details>.works-list')?.scrollTop||0,opened=body.querySelector('.works-details')?.open;onSaved?.(draft);const next=$("#dialog-body"),details=next.querySelector('.works-details');if(details)details.open=!!opened;const works=next.querySelector('.burger-level-works');if(works)works.classList.toggle('hidden',!opened);const list=next.querySelector('.burger-elements,.expanded-positions,.burger-details>.works-list');if(list)list.scrollTop=scroll};
    window.VIKR_STRUCTURE_FEATURES.mountVolumeEditor(parentElement,object,parentNode,guarded,refresh,"burger",{inline:true});
    const panel=document.createElement('div');body.querySelector('.burger-details')?.prepend(panel);window.VIKR_STRUCTURE_FEATURES.mountCoefficientPanel(panel,object,parentNode,host);
    body.querySelectorAll(".burger-child-volume").forEach(el=>{const index=Number(el.dataset.childIndex),node=children[index];if(node&&node.type!=="resource")window.VIKR_STRUCTURE_FEATURES.mountVolumeEditor(el,object,node,guarded,refresh,"burger-child-"+index,{compact:true,inline:true})});
    const details=body.querySelector('.works-details'),works=body.querySelector('.burger-level-works');if(details&&works)details.ontoggle=()=>works.classList.toggle('hidden',!details.open);
  }
  function openBaseLevelDetails(type,value){
    if(type==="vikr"){openBaseMoreNew(value);return}
    const items=groupIds(type,value).map(id=>base.find(v=>v.id===id)).filter(Boolean),meta=getLevelMeta(type,value),totals=totalsFor(items);
    const title=type==="kr"?getLevelMeta(type,value).name||krCatalogItem(value)?.name||value:value.split("|")[1]||"Без марки",label=type==="kr"?"Конструктив":"Марка",works=worksOfItems(items),children=directRowsForNode(type,value,items);
    modal(`<h2 id="dialog-title">${esc(title)}</h2><p>${label} · ${items.length} ВИКР</p><div class="burger-details">${summaryStats("Основной объём",meta.volume!=null?{value:num(meta.volume),unit:meta.unit||""}:"—",totals)}${meta.note?`<div class="note">${esc(meta.note)}</div>`:""}<details class="works-details"><summary>Виды работ · ${works.length}</summary></details><div class="burger-elements"><div class="burger-level-works hidden">${works.length?`<ol class="works-list">${works.map(w=>`<li>${esc(w)}</li>`).join("")}</ol>`:'<div class="empty">Виды работ не найдены в расшифровке УЕР.</div>'}</div><div class="section-head" style="margin-top:8px"><h3>${type==="kr"?"Марки конструктива":"ВИКР марки"}</h3><small>${children.length}</small></div>${childLevelsHtml(children)}</div></div><div class="dialog-actions"><button class="outline" id="close-level-more">Закрыть</button><button class="primary" id="edit-level-more">Изменить</button></div>`,()=>{mountBurgerEditors($("#dialog-body .stat.unit"),{type,value},children.map(child=>({type:child.type,value:child.value})),()=>openBaseLevelDetails(type,value));$("#close-level-more").onclick=closeModal;$("#edit-level-more").onclick=()=>editBaseLevel(type,value,()=>openBaseLevelDetails(type,value))},true)
  }
  function directRowsForNode(type,value,items){
    if(type==="kr")return knownMarks(value).map(mark=>{const nested=items.filter(v=>(v.mark||"")===mark);return {type:"mark",value:value+"|"+mark,label:mark||"Без марки",code:mark||"Без марки",badge:"М",items:nested,count:`${nested.length} ВИКР`}});
    return items.map(v=>({type:"vikr",value:v.id,label:v.name,code:v.code,badge:"В",items:[v],count:`${v.gesn.length} ГЭСН`}))
  }
  function baseDetailRows(v){
    if(!v)return [];
    if(ui.baseGesnFocus){const p=v.gesn.find(item=>item.id===ui.baseGesnFocus);return p?(p.resources||[]).map((resource,index)=>({type:"resource",value:String(index),label:resource.name,code:resource.code||"—",badge:"Р",place:`${p.code} · ${p.name}`,items:[v],position:p,resource,count:""})):[]}
    return (v.gesn||[]).map(p=>({type:"gesn",value:p.id,label:p.name,code:p.code,badge:"Г",place:`${v.code} · ${v.name}`,items:[v],position:p,count:`${(p.resources||[]).length} ресурсов`}))
  }
  function openBaseRowLevel(row){
    if(row.type==="resource")return;
    const table=$("#space-base .table-scroll");ui.baseHistory.push({activeNode:{...ui.activeNode},baseDetail:{...ui.baseDetail},baseView:ui.baseView,baseGesnFocus:ui.baseGesnFocus,baseFocus:ui.baseFocus,tableX:table.scrollLeft,tableY:table.scrollTop});
    if(row.type==="gesn"){ui.baseGesnFocus=row.value;ui.baseDetail={type:"vikr",value:ui.activeNode.value}}
    else{ui.activeNode={type:row.type,value:row.value};ui.baseDetail={...ui.activeNode};ui.baseFocus=row.items[0]?.id;ui.baseGesnFocus=null;ui.baseView=row.type==="kr"?"mark":"vikr";ui.baseTreeExpanded.add("object|all");if(row.type==="mark")ui.baseTreeExpanded.add("kr|"+row.value.split("|")[0]);if(row.type==="vikr"){const selected=base.find(v=>v.id===row.value);if(selected){ui.baseTreeExpanded.add("kr|"+(selected.kr||"Не распределено"));if(selected.mark)ui.baseTreeExpanded.add("mark|"+(selected.kr||"Не распределено")+"|"+selected.mark)}}}
    renderBase();table.scrollTop=0;table.scrollLeft=0;saveBaseUi()
  }
  function backBaseLevel(){
    const previous=ui.baseHistory.pop();if(!previous)return;
    ui.activeNode=previous.activeNode;ui.baseDetail=previous.baseDetail;ui.baseView=previous.baseView;ui.baseGesnFocus=previous.baseGesnFocus;ui.baseFocus=previous.baseFocus;
    renderBase();const table=$("#space-base .table-scroll");table.scrollLeft=previous.tableX||0;table.scrollTop=previous.tableY||0;saveBaseUi()
  }
  function editBaseTableRow(row){
    if(row.type==="gesn"){
      editAnyPosition(row.items[0].gesn,row.position.id,"base",()=>{persistBase();closeModal();renderBase()});
      return;
    }
    if(row.type!=="resource"){openBaseLevelDetails(row.type,row.value);return}
    const resource=row.resource,kinds=[["workers","Рабочие"],["drivers","Машинисты"],["machines","Машины и механизмы"],["materials","Материал"]];
    modal(`<h2 id="dialog-title">Изменить ресурс</h2><div class="dialog-grid"><label class="field"><span>Код</span><input id="base-resource-code" value="${esc(resource.code||"")}"></label><label class="field"><span>Тип</span><select id="base-resource-kind">${kinds.map(([value,label])=>`<option value="${value}" ${resource.kind===value?'selected':''}>${label}</option>`).join("")}</select></label><label class="field wide"><span>Наименование</span><input id="base-resource-name" value="${esc(resource.name||"")}"></label><label class="field"><span>Единица</span><input id="base-resource-unit" value="${esc(resource.unit||"")}"></label><label class="field"><span>Количество</span><input id="base-resource-qty" type="number" step="any" readonly title="Количество пересчитывается при изменении объёма ГЭСН" value="${Number(resource.qty)||0}"></label></div><div class="dialog-actions"><button class="outline" id="base-resource-cancel">Отменить</button><button class="primary" id="base-resource-save">Сохранить</button></div>`,()=>{
      const object=baseObjects.find(o=>o.id===activeBaseId),index=row.position.resources.indexOf(resource),rows=window.VIKR_STRUCTURE_FEATURES.coefficientRows([object],[{objectId:object.id,type:'resource',positionId:row.position.id,index}]);if(rows.length)$('#dialog-body .dialog-actions').insertAdjacentHTML('beforebegin',`<div class="burger-coefficients"><strong>Коэффициенты ресурса — собственные и унаследованные</strong>${window.VIKR_STRUCTURE_FEATURES.coefficientPreview(rows)}</div>`);
      $("#base-resource-cancel").onclick=closeModal;
      $("#base-resource-save").onclick=()=>{const name=$("#base-resource-name").value.trim(),qty=Number(resource.qty);if(!name||!Number.isFinite(qty)){toast("Проверьте наименование и количество");return}Object.assign(resource,{code:$("#base-resource-code").value.trim(),name,kind:$("#base-resource-kind").value,unit:$("#base-resource-unit").value.trim()||"шт.",qty});persistBase();closeModal();renderBase();toast("Ресурс обновлён")};
    });
  }
  function deleteBaseTableRow(row){
    if(row.type==="gesn"){
      confirmDelete(`ГЭСН ${row.position.code}`,"ГЭСН и все её ресурсы будут удалены из ВИКР.",()=>{const positions=row.items[0].gesn;positions.splice(positions.indexOf(row.position),1);if(ui.baseGesnFocus===row.position.id)ui.baseGesnFocus=null;persistBase()});
    }else if(row.type==="resource"){
      confirmDelete(`Ресурс ${row.resource.code||row.resource.name}`,"Ресурс будет удалён из ГЭСН.",()=>{const resources=row.position.resources;resources.splice(resources.indexOf(row.resource),1);persistBase()});
    }else removeBaseLevel(row.type,row.value);
  }
  function renderBaseRows(){syncScreenHistory();
    const allItems=visibleBase(),n=ui.activeNode,detail=n.type==="vikr",v=detail?allItems[0]:null,rows=detail?baseDetailRows(v):directRows(allItems);workspaceRows=rows;
    const scope=n.type==="object"?"объекта":n.type==="package"?`комплекта · ${activePackages().find(pack=>pack.id===n.value)?.name||""}`:n.type==="kr"?`конструктива · ${n.value}`:n.type==="mark"?`марки · ${n.value.split("|")[1]||"Без марки"}`:"выбранного ВИКР",viewLabel=detail?ui.baseGesnFocus?"Ресурсы ГЭСН":"ГЭСН":ui.baseView==="kr"?"Конструктивы":ui.baseView==="mark"?"Марки":"ВИКР";
    $("#base-level-back").classList.add("hidden");$("#base-level-back").onclick=backBaseLevel;
    $("#list-title").textContent=detail?`${viewLabel} · ${ui.baseGesnFocus?v?.gesn.find(p=>p.id===ui.baseGesnFocus)?.code||"":v?.code||""}`:`${viewLabel} ${scope}`;
    $("#list-subtitle").textContent=detail?`${rows.length} элементов`:`${rows.length} элементов · ${allItems.length} ВИКР`;
    renderBaseBreadcrumbs();
    $("#space-base table.rows").classList.toggle("hide-unit",!detail&&ui.baseView==="mark"&&!rows.some(row=>rowMeta(row).volume!=null)&&!rows.some(row=>rowMeta(row).volume!=null));
    $("#base-empty").classList.toggle("hidden",rows.length>0);$("#base-empty").textContent=baseInfo.deleted?"Объект удалён из Базы.":"Ничего не найдено. Измените запрос или фильтры.";
    $("#base-rows").innerHTML=rows.map((row,index)=>{
      const leaf=row.type==="gesn"||row.type==="resource",owner=row.items[0],perUnit=ui.baseMode==="unit";
      let meta=leaf?null:rowMeta(row),totals,shownVolume,unit;
      if(leaf){
        const factor=perUnit?(Number(owner?.volume)>0?1/owner.volume:null):1,p=row.position;
        if(row.type==="gesn")totals=factor==null?null:C.totals({...owner,gesn:[p]},factor,baseCoefficientChain(owner));
        else if(factor!=null){const r=row.resource,adjusted=factor*C.resourceFactor(r,[...baseCoefficientChain(owner),owner.coefficients||[],p.coefficients||[],r.coefficients||[]]);totals={workers:0,drivers:0,machines:0};if(r.kind in totals)totals[r.kind]=Number(r.qty||0)*adjusted}
        shownVolume=factor==null?null:Number(row.type==="gesn"?p.qty:row.resource.qty)*factor*(row.type==="resource"?C.resourceFactor(row.resource,[...baseCoefficientChain(owner),owner.coefficients||[],p.coefficients||[],row.resource.coefficients||[]]):1);
        unit=row.type==="gesn"?p.unit:row.resource.unit;
      }else{const hasVolume=Number(meta.volume)>0,raw=totalsFor(row.items);totals=perUnit&&hasVolume?{workers:raw.workers/meta.volume,drivers:raw.drivers/meta.volume,machines:raw.machines/meta.volume}:perUnit?null:raw;shownVolume=hasVolume?perUnit?1:meta.volume:window.VIKR_QUANTITIES.finite(meta.volume)?Number(meta.volume):null;unit=meta.unit||""}
      const ids=rowSelectionTokens(row),checked=ids.length>0&&ids.every(id=>ui.selection.has(id)),partial=!checked&&ids.some(id=>ui.selection.has(id)),active=ui.baseDetail.type===row.type&&ui.baseDetail.value===row.value;
      const volumeNote=leaf||row.type==="mark"?"":!meta.volume?" · Объём не задан":"";
      const code=leaf&&row.type==="resource"?`<span class="row-code-text">${esc(row.code)}</span>`:`<button class="row-code-link" data-index="${index}"><span class="type-badge">${esc(row.badge||"В")}</span><span>${esc(row.code)}</span></button>`;
      const name=row.type==="resource"?`<span class="row-name-text">${esc(row.label)}</span>`:`<button class="row-name-link" data-index="${index}">${esc(row.label)}</button>`;
      const actions=`<button class="icon-edit row-edit" data-index="${index}" aria-label="${leaf?'Изменить':'Открыть'} ${esc(row.label)}" title="${leaf?'Изменить':'Открыть'}">${burgerIcon}</button><button class="icon-delete row-delete" data-index="${index}" aria-label="Удалить ${esc(row.label)}">${trashIcon}</button>`;
      return `<tr data-index="${index}" class="${active?'active':''}"><td>${`<input type="checkbox" class="row-select" ${checked?'checked':''} ${partial?'data-partial="1"':''} aria-label="Выбрать ${esc(row.label)}">`}</td><td class="code">${code}</td><td>${name}${row.count?`<small>${esc(row.count)}${volumeNote}</small>`:""}</td><td>${esc(row.place||nodePath({type:row.type,value:row.value}))}</td><td class="right">${totals?num(totals.workers):"—"}</td><td class="right">${totals?num(totals.drivers):"—"}</td><td class="right">${totals?num(totals.machines):"—"}</td><td class="right">${shownVolume==null?"—":num(shownVolume)}</td><td>${esc(unit)}</td><td class="row-tools">${actions}</td></tr>`;
    }).join("");
    const footerItems=detail&&ui.baseGesnFocus&&v?[{...v,gesn:v.gesn.filter(p=>p.id===ui.baseGesnFocus)}]:allItems,canSum=ui.baseMode==="full"&&footerItems.length>0,totals=canSum?C.addTotals(footerItems.map(item=>baseTotals(item))):null,unit=!detail&&allItems.length&&allItems.every(item=>item.unit===allItems[0].unit&&Number(item.volume)>0)?allItems[0].unit:null,volume=canSum&&unit?allItems.reduce((sum,item)=>sum+Number(item.volume),0):null;
    $("#base-totals").innerHTML=`<tr><td></td><td colspan="3">Итого по текущему списку</td><td class="right">${num(totals?.workers)}</td><td class="right">${num(totals?.drivers)}</td><td class="right">${num(totals?.machines)}</td><td class="right">${num(volume)}</td><td>${volume!=null?esc(unit):""}</td><td></td></tr>`;
    const allBox=$("#table-select-all"),ids=rows.flatMap(rowSelectionTokens),allSelected=ids.length>0&&ids.every(id=>ui.selection.has(id)),someSelected=ids.some(id=>ui.selection.has(id));allBox.disabled=ids.length===0;allBox.checked=allSelected;allBox.indeterminate=!allSelected&&someSelected;allBox.onchange=()=>{ids.forEach(id=>allBox.checked?ui.selection.add(id):ui.selection.delete(id));renderBaseRows();renderSelection()};
    $("#base-rows").querySelectorAll(".row-select").forEach(box=>{if(box.dataset.partial)box.indeterminate=true;box.onchange=()=>{const row=rows[Number(box.closest("tr").dataset.index)];rowSelectionTokens(row).forEach(id=>box.checked?ui.selection.add(id):ui.selection.delete(id));renderBaseRows();renderSelection()}});
    $("#base-rows").querySelectorAll("tr").forEach(tr=>tr.onclick=e=>{if(e.target.closest("button,input"))return;const row=rows[Number(tr.dataset.index)];if(row.type==="gesn"||row.type==="resource")return;ui.baseDetail={type:row.type,value:row.value};ui.baseFocus=row.items[0]?.id;renderBaseRows();renderBaseDetailNew()});
    $("#base-rows").querySelectorAll(".row-name-link,.row-code-link").forEach(button=>button.onclick=()=>openBaseRowLevel(rows[Number(button.dataset.index)]));
    $("#base-rows").querySelectorAll(".row-edit").forEach(button=>button.onclick=()=>editBaseTableRow(rows[Number(button.dataset.index)]));
    $("#base-rows").querySelectorAll(".row-delete").forEach(button=>button.onclick=()=>deleteBaseTableRow(rows[Number(button.dataset.index)]));
  }
  function resourceList(position,factor=1,editable=false,inherited=[]){if(!inherited.length){const workOwner=work?.vikrs?.find(v=>v.gesn?.includes(position)),baseOwner=base.find(v=>v.gesn?.includes(position));if(workOwner)inherited=[...workCoefficientChain(workOwner),workOwner.coefficients||[],position.coefficients||[]];else if(baseOwner)inherited=[...baseCoefficientChain(baseOwner),baseOwner.coefficients||[],position.coefficients||[]]}return `<div class="resource-list">${position.resources.map((r,index)=>{const adjusted=factor*C.resourceFactor(r,[...inherited,r.coefficients||[]]);return `<div class="resource ${r.qty<0?'negative':''}"><span>${esc(r.name)}<small>${esc(r.code)} · ${esc(r.kind==='workers'?'Рабочие':r.kind==='drivers'?'Машинисты':r.kind==='machines'?'Машины и механизмы':'Материал')}${adjusted!==factor?` · коэф. ${num(adjusted/factor)}`:''}</small></span><strong>${quantityMarkup(num(r.qty*adjusted),r.unit)}</strong>${editable?`<button class="quiet edit-base-resource" data-index="${index}">Изменить</button>`:''}</div>`}).join("")}</div>`}

  function summaryStats(label,volume,totals){return `<div class="stats"><div class="stat unit"><small>${esc(label)}</small><strong>${volume&&typeof volume==="object"?quantityMarkup(volume.value,volume.unit):esc(volume)}</strong></div><div class="stat"><small>Рабочие</small><strong>${num(totals?.workers)} чел.-ч</strong></div><div class="stat"><small>Машинисты</small><strong>${num(totals?.drivers)} чел.-ч</strong></div><div class="stat"><small>Машины и механизмы</small><strong>${num(totals?.machines)} маш.-ч</strong></div></div>`}
  function referenceHtml(info,title,showTitle=true){const field=(label,value)=>`<div><small>${label}</small><strong>${esc(value||"Не заполнено")}</strong></div>`;return `<div class="reference-info">${showTitle?'<div class="section-head"><h3>Сведения об объекте</h3></div>':''}${field("Наименование",title)}${field("Местоположение",info.location)}${field("Описание",info.description)}${field("Источник",info.source)}${field("Примечание",info.note)}</div>`}
  function editObjectInfo(kind,onBack){const isBase=kind==="base",info=isBase?baseInfo:work.info,title=isBase?baseInfo.title:work.name;modal(`<h2 id="dialog-title">Сведения об объекте</h2><p>${isBase?"Изменения сохраняются в записи Базы.":"Поля рабочего объекта заполняются вручную и не копируются из аналога."}</p><div class="dialog-grid"><label class="field wide"><span>Наименование</span><input id="info-title" value="${esc(title)}"></label><label class="field wide"><span>Местоположение</span><input id="info-location" value="${esc(info.location)}" placeholder="Можно заполнить позже"></label><label class="field wide"><span>Краткое описание</span><textarea id="info-description">${esc(info.description)}</textarea></label><label class="field wide"><span>Источник</span><input id="info-source" value="${esc(info.source)}" placeholder="Например, карточка или документ"></label><label class="field wide"><span>Примечание</span><textarea id="info-note">${esc(info.note)}</textarea></label></div><div class="dialog-actions dialog-actions-split">${onBack?'<button class="outline" id="info-back">Назад</button>':''}<div><button class="outline" id="info-cancel">Отменить</button><button class="primary" id="info-save">Сохранить</button></div></div>`,()=>{if(onBack)$("#info-back").onclick=onBack;$("#info-cancel").onclick=closeModal;$("#info-save").onclick=()=>{const name=$("#info-title").value.trim();if(!name){toast("Укажите наименование объекта");return}info.location=$("#info-location").value.trim();info.description=$("#info-description").value.trim();info.source=$("#info-source").value.trim();info.note=$("#info-note").value.trim();if(isBase){info.title=name;persistBaseInfo()}else work.name=name;closeModal();renderAll();toast("Сведения сохранены")}})}
  function worksOf(position){return (position.works?.length?position.works:window.VIKR_FSNB_WORKS?.(position)||[]).map(w=>typeof w==="string"?w:w?.name||"").map(w=>w.trim()).filter(Boolean)}
  function worksOfVikr(v){const seen=new Set(),result=[];for(const name of (v.gesn||[]).flatMap(worksOf)){const key=name.toLocaleLowerCase("ru-RU").replace(/\s+/g," ");if(!seen.has(key)){seen.add(key);result.push(name)}}return result}
  function worksOfItems(items){const seen=new Set(),result=[];for(const v of items)for(const name of worksOfVikr(v)){const key=norm(name);if(key&&!seen.has(key)){seen.add(key);result.push(name)}}return result}
  function showGesnWorks(position,onBack){const works=worksOf(position);modal(`<h2 id="dialog-title">Состав работ ГЭСН</h2><p>${esc(position.code)} · ${esc(position.name)}</p><div id="gesn-inherited-coefficients"></div>${works.length?`<ol class="works-list">${works.map(w=>`<li>${esc(w)}</li>`).join("")}</ol>`:'<div class="empty">Состав работ не загружен: в смете эти сведения не собирались.</div>'}<div class="dialog-actions">${onBack?'<button class="outline" id="back-works">Назад</button>':''}<button class="primary" id="close-works">Закрыть</button></div>`,()=>{const inBase=ui.space==='base'&&base.some(v=>v.gesn?.some(p=>p.id===position.id)),object=inBase?baseObjects.find(o=>o.id===activeBaseId):workFeatureObject();window.VIKR_STRUCTURE_FEATURES.mountCoefficientPanel($("#gesn-inherited-coefficients"),object,{type:'gesn',value:position.id},inBase?baseFeatureHost():workFeatureHost());if(onBack)$("#back-works").onclick=onBack;$("#close-works").onclick=closeModal},true)}
  function showVikrWorks(v){const works=worksOfVikr(v);modal(`<h2 id="dialog-title">Состав работ ВИКР ${esc(v.code)}</h2><p>Работы входящих ГЭСН объединяются без повторов и нумеруются заново.</p>${works.length?`<ol class="works-list">${works.map(w=>`<li>${esc(w)}</li>`).join("")}</ol>`:'<div class="empty">Состав работ ГЭСН пока не загружен.</div>'}<div class="dialog-actions"><button class="primary" id="close-works">Закрыть</button></div>`,()=>{$("#close-works").onclick=closeModal},true)}
  function openObjectDetails(){
    const children=knownKrs().map(kr=>{const items=base.filter(v=>(v.kr||"Не распределено")===kr);return {type:"kr",value:kr,badge:"КР",code:kr,label:getLevelMeta("kr",kr).name||krCatalogItem(kr)?.name||kr,items,count:`${items.length} ВИКР`}});
    modal(`<h2 id="dialog-title">Сведения об объекте</h2>${referenceHtml(baseInfo,baseInfo.title,false)}<div class="burger-details">${summaryStats("Основной объём","—",totalsFor(base))}<div class="dataset-summary"><div><small>Записей ВИКР</small><strong>${num(base.length,0)}</strong></div><div><small>ГЭСН</small><strong>${num(base.reduce((sum,v)=>sum+(v.gesn||[]).length,0),0)}</strong></div></div><div class="burger-elements"><div class="section-head"><h3>Конструктивы объекта</h3><small>${children.length}</small></div>${childLevelsHtml(children)}</div></div><div class="dialog-actions"><button class="primary" id="object-details-edit">Изменить</button></div>`,()=>{mountBurgerEditors($("#dialog-body .stat.unit"),{type:"object",value:"all"},children.map(child=>({type:child.type,value:child.value})),openObjectDetails);$("#object-details-edit").onclick=()=>editObjectInfo("base",openObjectDetails)},true)
  }
  function renderBaseDetailNew(){
    if(baseInfo.deleted){$("#base-detail").innerHTML="";return}
    const n=ui.baseDetail||{type:"object",value:"all"};
    const items=groupIds(n.type,n.value).map(id=>base.find(v=>v.id===id)).filter(Boolean),levelVikr=n.type==="vikr"?items[0]:null;
    const title=n.type==="object"?baseInfo.deleted?"Объект не выбран":baseInfo.title||"Объект":n.type==="package"?activePackages().find(pack=>pack.id===n.value)?.name||"Комплект":n.type==="kr"?getLevelMeta("kr",n.value).name||krCatalogItem(n.value)?.name||n.value:n.type==="mark"?n.value.split("|")[1]:levelVikr?`${levelVikr.code} · ${levelVikr.name}`:"Уровень не найден";
    const label=n.type==="object"?"Объект":n.type==="package"?"Комплект":n.type==="kr"?"Конструктив":n.type==="mark"?"Марка":"ВИКР";
    let totals=totalsFor(items),volume="—",volumeLabel="Основной объём уровня",levelNote="";
    if(levelVikr){const unavailable=ui.baseMode==="unit"&&!(Number(levelVikr.volume)>0),factor=ui.baseMode==="unit"&&levelVikr.volume>0?1/levelVikr.volume:1;totals=unavailable?null:baseTotals(levelVikr,factor);volumeLabel=ui.baseMode==="unit"?`На 1 ${levelVikr.unit}`:"Ключевой объём";volume=unavailable?"—":ui.baseMode==="unit"?{value:"1",unit:levelVikr.unit}:levelVikr.volume!=null?{value:num(levelVikr.volume),unit:levelVikr.unit}:"—";levelNote=levelVikr.note||""}
    else{const meta=getLevelMeta(n.type,n.value);if(meta.volume!=null)volume={value:num(meta.volume),unit:meta.unit||""};levelNote=meta.note||""}
    const summaryRow=(name,value,extra="")=>`<div class="base-summary-row ${extra}"><small>${esc(name)}</small><strong>${extra==="volume"&&typeof value==="object"?quantityMarkup(value.value,value.unit):esc(value)}</strong></div>`;
    const objectName=baseInfo.deleted?"Объект не выбран":baseInfo.title||"Объект";
    $("#base-detail").innerHTML=`<div class="detail-content base-summary"><div class="section-head"><h2>Сводка</h2></div>${summaryRow("Объект",objectName,"object")}${n.type==="object"?"":summaryRow(label,title,"selected")}${summaryRow(volumeLabel,volume,"volume")}${summaryRow("Рабочие",`${num(totals?.workers)} чел.-ч`)}${summaryRow("Машинисты",`${num(totals?.drivers)} чел.-ч`)}${summaryRow("Машины и механизмы",`${num(totals?.machines)} маш.-ч`)}${summaryRow("Комментарий",levelNote||"Не указан","comment")}<button class="soft full" id="base-object-details">Подробнее об объекте</button></div>`;
    $("#base-object-details").onclick=openObjectDetails;
    enhanceBaseSummaryIntegration(n);
    $("#base-object-details").insertAdjacentHTML("beforebegin",'<button class="soft full" id="base-add-element">Добавить элемент</button>');
    $("#base-add-element").onclick=()=>openAddElement();
    decorateQuantities($("#base-detail"));
    const object=baseObjects.find(o=>o.id===activeBaseId);window.VIKR_STRUCTURE_FEATURES.mountSummary($("#base-detail"),object,{type:n.type,value:n.value},baseFeatureHost(),"base");
    if(object)window.VIKR_STRUCTURE_FEATURES.mountCoefficientSummary($("#base-detail"),object,{type:n.type,value:n.value},baseFeatureHost(),"base");
    window.VIKR_OBJECT_PRICING.mount($("#base-detail .base-summary"),object,baseFeatureHost());
  }
  function openBaseMoreNew(id,initialMode="positions"){
    const v=base.find(x=>x.id===id);if(!v)return;const factor=ui.baseMode==="unit"&&v.volume>0?1/v.volume:1;
    const render=mode=>{const works=worksOfVikr(v),totals=totalsFor([v]);
      modal(`<h2 id="dialog-title"><span class="type-badge">В</span> ${esc(v.code)} · ${esc(v.name)}</h2><p>${esc(v.kr||"Не распределено")} → ${esc(v.mark||"Без марки")}</p><div class="burger-details">${summaryStats("Основной объём",{value:num(v.volume),unit:v.unit||""},totals)}<div class="seg"><button id="more-positions" class="${mode==='positions'?'active':''}">ГЭСН и ресурсы</button><button id="more-works" class="${mode==='works'?'active':''}">Состав работ ВИКР</button></div>${mode==='positions'?`<div class="expanded-positions">${v.gesn.map((p,index)=>`<div class="position"><div class="position-head"><span class="type-badge">Г</span><div class="position-text"><b>${esc(p.code)}</b><span>${esc(p.name)}</span></div><div class="burger-child-volume" data-child-index="${index}"></div><button class="dots gesn-works" data-id="${esc(p.id)}" aria-label="Состав работ ${esc(p.code)}">⋯</button></div>${resourceList(p,factor)}</div>`).join("")}</div>`:works.length?`<ol class="works-list">${works.map(w=>`<li>${esc(w)}</li>`).join("")}</ol>`:'<div class="empty">Состав работ дочерних ГЭСН отсутствует в объекте и подключённом справочнике ФСНБ.</div>'}</div><div class="dialog-actions"><button class="primary" id="edit-more">Изменить</button></div>`,()=>{
        mountBurgerEditors($("#dialog-body .stat.unit"),{type:"vikr",value:id},v.gesn.map(p=>({type:"gesn",value:p.id})),()=>openBaseMoreNew(id,mode));
        $("#more-positions").onclick=()=>render("positions");$("#more-works").onclick=()=>render("works");$("#edit-more").onclick=()=>editBaseVikrNew(id,null,()=>openBaseMoreNew(id,mode));
        document.querySelectorAll("#dialog-body .gesn-works").forEach(b=>b.onclick=()=>{const previousScroll=$("#dialog-body .expanded-positions")?.scrollTop||0;showGesnWorks(v.gesn.find(p=>p.id===b.dataset.id),()=>{openBaseMoreNew(id,mode);const list=$("#dialog-body .expanded-positions");if(list)list.scrollTop=previousScroll})});
      },true)
    };render(initialMode)
  }
  function renderAdvancedSearch(){
    $("#advanced-search").classList.toggle("hidden",!ui.advancedOpen);$("#advanced-toggle").textContent=ui.advancedOpen?"Скрыть фильтры":"Расширенный поиск";
    const optionList=(values,current,allLabel)=>`<option value="">${allLabel}</option>${values.map(value=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(value)}</option>`).join("")}`;
    $("#work-types").innerHTML=[...new Map(base.flatMap(worksOfVikr).map(name=>[name.toLocaleLowerCase("ru-RU"),name])).values()].sort((a,b)=>a.localeCompare(b,"ru")).map(name=>`<option value="${esc(name)}"></option>`).join("");
    $("#filter-work").value=ui.workType;
    const krs=knownKrs().sort((a,b)=>a.localeCompare(b,"ru"));$("#filter-kr").innerHTML=optionList(krs,ui.krFilter,"Все конструктивы");
    const markSource=ui.krFilter?base.filter(v=>(v.kr||"Не распределено")===ui.krFilter):base,marks=[...new Set(markSource.map(v=>v.mark||"Без марки"))].sort((a,b)=>a.localeCompare(b,"ru"));if(ui.markFilter&&!marks.includes(ui.markFilter))ui.markFilter="";$("#filter-mark").innerHTML=optionList(marks,ui.markFilter,"Все марки");
    const units=[...new Set(base.map(v=>v.unit).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru"));$("#filter-unit").innerHTML=optionList(units,ui.unitFilter,"Все единицы");
    const refresh=()=>{ui.baseDetail={...ui.activeNode};ui.baseFocus=visibleBase()[0]?.id;renderBaseRows();renderBaseDetailNew();renderSelection()};
    $("#advanced-toggle").onclick=()=>{ui.advancedOpen=!ui.advancedOpen;renderAdvancedSearch()};
    $("#filter-work").oninput=e=>{ui.workType=e.target.value;if(ui.workType.trim())ui.baseView="vikr";renderBaseView();refresh()};
    $("#filter-kr").onchange=e=>{ui.krFilter=e.target.value;ui.markFilter="";renderAdvancedSearch();refresh()};
    $("#filter-mark").onchange=e=>{ui.markFilter=e.target.value;refresh()};
    $("#filter-unit").onchange=e=>{ui.unitFilter=e.target.value;refresh()};
    $("#filters-reset").onclick=()=>{ui.workType="";ui.krFilter="";ui.markFilter="";ui.unitFilter="";ui.query="";$("#search").value="";renderAdvancedSearch();refresh()};
  }
  function renderBaseObjectMode(){
    $("#advanced-search").classList.add("hidden");$("#advanced-toggle").disabled=true;
    $("#space-base .columns").classList.add("base-object-mode");$("#base-level-back").classList.add("hidden");$("#base-tree").innerHTML="";$("#base-detail").innerHTML="";
    renderBaseMode();renderBaseView();
    const query=ui.query.trim().toLocaleLowerCase("ru-RU"),shown=baseObjects.filter(object=>!query||object.info.title.toLocaleLowerCase("ru-RU").includes(query));
    $("#list-title").textContent="Объекты Базы";$("#list-subtitle").textContent=`${shown.length} объектов`;
    document.querySelector("table.rows").classList.remove("hide-unit");
    $("#base-empty").classList.toggle("hidden",shown.length>0);$("#base-empty").textContent=!objectFiles.isReady()?"Выберите папку и разрешите доступ. Без папки объектов нет.":query?"Объекты не найдены.":"В выбранной папке нет объектов. Создайте объект или добавьте JSON-файлы.";
    $("#base-rows").innerHTML=shown.map(object=>{const meta=object.info.levels?.object||{},raw=C.addTotals(object.vikrs.map(v=>C.totals(v,1,[meta.coefficients||[],object.info.levels?.["kr:"+(v.kr||"Не распределено")]?.coefficients||[],object.info.levels?.["mark:"+(v.kr||"Не распределено")+"|"+(v.mark||"")]?.coefficients||[]]))),perUnit=ui.baseMode==="unit",hasVolume=Number(meta.volume)>0,totals=perUnit&&hasVolume?{workers:raw.workers/meta.volume,drivers:raw.drivers/meta.volume,machines:raw.machines/meta.volume}:perUnit?null:raw;return `<tr class="object-record"><td></td><td class="code">—</td><td><button class="row-name-link open-base-object" data-id="${esc(object.id)}">${esc(object.info.title)}</button><small>${object.vikrs.length} ВИКР</small></td><td>—</td><td class="right">${totals?num(totals.workers):"—"}</td><td class="right">${totals?num(totals.drivers):"—"}</td><td class="right">${totals?num(totals.machines):"—"}</td><td class="right">${hasVolume?num(perUnit?1:meta.volume):"—"}</td><td>${esc(meta.unit||"")}</td><td class="row-tools"><button class="icon-edit edit-base-object" data-id="${esc(object.id)}" aria-label="Изменить ${esc(object.info.title)}">✎</button><button class="icon-delete delete-base-object" data-id="${esc(object.id)}" aria-label="Удалить ${esc(object.info.title)}">${trashIcon}</button></td></tr>`}).join("");
    $("#base-totals").innerHTML='<tr><td></td><td colspan="3">Итого</td><td class="right">—</td><td class="right">—</td><td class="right">—</td><td class="right">—</td><td>—</td><td></td></tr>';
    const allBox=$("#table-select-all");allBox.checked=false;allBox.indeterminate=false;allBox.disabled=true;allBox.onchange=null;
    $("#base-rows").querySelectorAll(".open-base-object").forEach(button=>button.onclick=()=>selectBaseObject(button.dataset.id));
    $("#base-rows").querySelectorAll(".edit-base-object").forEach(button=>button.onclick=()=>{selectBaseObject(button.dataset.id);editBaseLevel("object","all")});
    $("#base-rows").querySelectorAll(".delete-base-object").forEach(button=>button.onclick=()=>{const object=baseObjects.find(x=>x.id===button.dataset.id);selectBaseObject(button.dataset.id,false);confirmDelete(`Объект «${object.info.title}»`,"Объект, его структура, ВИКР, ГЭСН и ресурсы будут удалены.",deleteBaseObject)});
    $("#selection-drawer").classList.add("hidden");
  }
  function renderBaseObjectModeV41(){syncScreenHistory();
    renderBaseObjectMode();
    const rows=[...$("#base-rows").querySelectorAll(".object-record")];
    for(const row of rows){
      const id=row.querySelector(".open-base-object")?.dataset.id;if(!id)continue;
      const box=document.createElement("input");box.type="checkbox";box.className="object-row-select";box.checked=ui.objectSelection.has(id);box.setAttribute("aria-label",`Выбрать объект ${baseObjects.find(x=>x.id===id)?.info.title||""}`);
      box.onchange=()=>{box.checked?ui.objectSelection.add(id):ui.objectSelection.delete(id);renderBaseObjectModeV41()};
      row.cells[0].appendChild(box);
    }
    const ids=rows.map(row=>row.querySelector(".open-base-object")?.dataset.id).filter(Boolean),all=$("#table-select-all");
    all.disabled=ids.length===0;all.checked=ids.length>0&&ids.every(id=>ui.objectSelection.has(id));all.indeterminate=!all.checked&&ids.some(id=>ui.objectSelection.has(id));
    all.onchange=()=>{ids.forEach(id=>all.checked?ui.objectSelection.add(id):ui.objectSelection.delete(id));renderBaseObjectModeV41()};
    renderObjectSelectionV41();
    renderBaseBreadcrumbs();
  }
  function renderObjectSelectionV41(){
    $("#transfer-selection").classList.remove("hidden");
    const selected=baseObjects.filter(object=>ui.objectSelection.has(object.id)),drawer=$("#selection-drawer");
    drawer.classList.toggle("hidden",selected.length===0);
    if(!selected.length)return;
    $("#selection-title").innerHTML=`Выбрано <span id="selected-count">${selected.length}</span> ${selected.length===1?"объект":"объекта"}`;
    $("#selection-summary").innerHTML=`<div class="drawer-body"><p class="subtle">${selected.map(object=>esc(object.info.title)).join("; ")}</p><p class="subtle">${selected.reduce((sum,object)=>sum+object.vikrs.length,0)} ВИКР. Объекты и их состав можно скопировать в другой объект Базы.</p></div>`;
    $("#compare-selection").classList.add("hidden");$("#transfer-selection").textContent=selected.length===1?"Копировать объект":"Копировать объекты";
  }
  function renderBase(){$("#space-base .list-pane").classList.toggle("object-empty",!ui.baseObjectMode&&Boolean(baseInfo.deleted));if(ui.baseObjectMode){renderBaseObjectModeV41();renderBaseBreadcrumbs();saveBaseUi();return}$("#advanced-toggle").disabled=false;$("#space-base .columns").classList.remove("base-object-mode");renderAdvancedSearch();renderBaseMode();renderBaseView();renderBaseTree();renderBaseRows();renderBaseDetailNew();renderSelection();renderBaseBreadcrumbs();decorateQuantities($("#base-detail"));saveBaseUi()}
  function renderBaseMode(){document.querySelectorAll("#base-mode button").forEach(b=>{b.classList.toggle("active",b.dataset.mode===ui.baseMode);b.onclick=()=>{ui.baseMode=b.dataset.mode;renderBase()}})}
  function renderBaseView(){const labels={kr:"Конструктивы",mark:"Марки",vikr:"ВИКР"};if(ui.baseObjectMode){$("#base-view").innerHTML=["kr","mark","vikr"].map(view=>`<button disabled>${labels[view]}</button>`).join("");return}if(ui.activeNode.type==="vikr"){$("#base-view").innerHTML="";return}ensureBaseView();$("#base-view").innerHTML=availableBaseViews().map(view=>`<button data-view="${view}" class="${ui.baseView===view?'active':''}">${labels[view]}</button>`).join("");$("#base-view").querySelectorAll("button").forEach(button=>button.onclick=()=>{ui.baseView=button.dataset.view;ui.baseGesnFocus=null;ui.baseDetail={...ui.activeNode};ui.baseFocus=visibleBase()[0]?.id;renderBaseView();renderBaseRows();renderBaseDetailNew();saveBaseUi()})}

  function renderSelection(){renderWorkspaceTools();$("#transfer-selection").classList.remove("hidden");if([...ui.selection].some(t=>t.startsWith("position:")||t.startsWith("resource:"))){const count=workspaceNodes().length;$("#selection-drawer").classList.toggle("hidden",ui.space!=="base"||!count);$("#selection-title").textContent=`Выбрано элементов: ${count}`;$("#selection-summary").innerHTML='<div class="drawer-body"><p class="subtle">Экспорт сохраняет выбранные ГЭСН или ресурсы вместе с их родительскими уровнями.</p></div>';$("#compare-selection").classList.add("hidden");$("#transfer-selection").classList.add("hidden");return}
    if(ui.baseObjectMode){renderObjectSelectionV41();return}
    if(ui.baseObjectMode){const count=ui.objectSelection.size,drawer=$("#selection-drawer");drawer.classList.toggle("hidden",ui.space!=="base"||count===0);if(!count)return;$("#selection-title").innerHTML=`Выбрано <span id="selected-count">${count}</span> ${count===1?'объект':'объекта'}`;$("#selection-summary").innerHTML='<div class="drawer-body"><p class="subtle">После подтверждения откроется структура выбранного объекта.</p></div>';$("#compare-selection").classList.add("hidden");$("#transfer-selection").textContent=count===1?"Выбрать объект":"Выбрать объекты";return}
    $("#transfer-selection").textContent="Добавить в объект";
    const ids=[...ui.selection],items=ids.map(id=>base.find(v=>v.id===id)).filter(Boolean);
    const emptyLevels=selectedEmptyLevels(),count=items.length+emptyLevels.length;
    $("#selection-drawer").classList.toggle("hidden",ui.space!=="base"||count===0);if(ui.space!=="base"||!count)return;
    $("#selection-title").innerHTML=`Выбрано <span id="selected-count">${count}</span> ${emptyLevels.length?'элементов':'ВИКР'}`;$("#compare-selection").classList.toggle("hidden",items.length<2);
    const t=totalsFor(items),vols=new Map();
    for(const v of items)if(v.volume)vols.set(v.unit,(vols.get(v.unit)||0)+v.volume);
    $("#selection-summary").innerHTML=`<div class="drawer-body"><p class="subtle">Выбрано ВИКР: ${items.length}.${emptyLevels.length?` Пустых уровней структуры: ${emptyLevels.length}.`:""}</p><div class="drawer-totals"><div class="stat"><small>Рабочие</small><strong>${num(t.workers)} чел.-ч</strong></div><div class="stat"><small>Машинисты</small><strong>${num(t.drivers)} чел.-ч</strong></div><div class="stat"><small>Механизмы</small><strong>${num(t.machines)} маш.-ч</strong></div></div><p class="subtle">Объёмы: ${[...vols].map(([unit,value])=>num(value)+" "+esc(unit)).join("; ")||"не определены"}.</p></div>`;
  }

  function editBaseVikrNew(id,existingDraft,onBack){
    const original=base.find(v=>v.id===id);if(!original)return;
    const draft=existingDraft||clone(original);
    let lastVolume=draft.volume;
    modal(`<h2 id="dialog-title">Изменить ВИКР в Базе</h2><p>Сохранение обновит исходную запись. ГЭСН и их ресурсы можно изменить ниже.</p><div class="dialog-grid dialog-grid-three"><label class="field"><span>Код</span><input id="bv-code" value="${esc(draft.code)}"></label><label class="field"><span>Ключевой объём</span><input id="bv-volume" type="number" min="0" step="any" value="${draft.volume??''}"></label><label class="field"><span>Единица</span><input id="bv-unit" value="${esc(draft.unit)}"></label><label class="field wide"><span>Наименование</span><input id="bv-name" value="${esc(draft.name)}"></label><label class="field wide"><span>Комментарий</span><textarea id="bv-note">${esc(draft.note)}</textarea></label></div><label class="radio-row"><input type="checkbox" id="bv-scale" checked><span>При изменении ключевого объёма пересчитать ГЭСН и ресурсы пропорционально</span></label><div class="section-head" style="margin-top:16px"><h3>ГЭСН</h3><button class="quiet" id="bv-add-position">+ ГЭСН</button></div><div class="checklist">${draft.gesn.map(p=>`<div class="base-edit-position"><span class="type-badge">Г</span><div><b>${esc(p.code)}</b><span>${esc(p.name)}</span><small>${quantityMarkup(num(p.qty),p.unit)} · ${p.resources.length} ресурсов</small></div><div class="row-actions"><button class="icon-edit bv-edit-position" data-id="${esc(p.id)}" aria-label="Изменить ${esc(p.code)}">✎</button><button class="icon-delete bv-delete-position" data-id="${esc(p.id)}" aria-label="Удалить ${esc(p.code)}">${trashIcon}</button></div></div>`).join('')||'<div class="empty">ГЭСН пока нет</div>'}</div><div class="dialog-actions dialog-actions-split"><div>${onBack?'<button class="outline" id="bv-back">Назад</button>':''}<button class="icon-delete danger-icon" id="bv-delete" aria-label="Удалить ВИКР" title="Удалить ВИКР">${trashIcon}</button></div><div><button class="outline" id="bv-cancel">Отменить</button><button class="primary" id="bv-save">Сохранить в Базе</button></div></div>`,()=>{
      const pull=()=>{const volume=Number($("#bv-volume").value),name=$("#bv-name").value.trim();if(!name||!Number.isFinite(volume)||volume<0){toast("Проверьте наименование и объём");return false}if($("#bv-scale").checked&&lastVolume>0&&volume!==lastVolume){const factor=volume/lastVolume;window.VIKR_QUANTITIES.vikr(draft,factor)}lastVolume=volume;draft.volume=volume;draft.code=$("#bv-code").value.trim()||"Без кода";draft.name=name;draft.unit=$("#bv-unit").value.trim()||draft.unit;draft.note=$("#bv-note").value.trim();return true};
      if(onBack)$("#bv-back").onclick=onBack;$("#bv-cancel").onclick=closeModal;
      $("#bv-save").onclick=()=>{if(!pull())return;Object.assign(original,draft);persistBase();closeModal();renderBase();toast("ВИКР и ГЭСН сохранены в Базе")};
      document.querySelectorAll(".bv-edit-position").forEach(b=>b.onclick=()=>{if(!pull())return;editAnyPosition(draft.gesn,b.dataset.id,"base",()=>editBaseVikrNew(id,draft,onBack))});
      document.querySelectorAll(".bv-delete-position").forEach(b=>b.onclick=()=>{if(!pull())return;const p=draft.gesn.find(x=>x.id===b.dataset.id);confirmDelete(`ГЭСН ${p?.code||""}`,"Позиция и все её ресурсы будут удалены из ВИКР.",()=>{draft.gesn=draft.gesn.filter(x=>x.id!==b.dataset.id);editBaseVikrNew(id,draft,onBack)},()=>editBaseVikrNew(id,draft,onBack))});
      $("#bv-add-position").onclick=()=>{if(!pull())return;const p={id:uid(),code:"Новая ГЭСН",name:"Новая работа",unit:"шт.",qty:0,resources:[]};draft.gesn.push(p);editAnyPosition(draft.gesn,p.id,"base",()=>editBaseVikrNew(id,draft,onBack))};
      $("#bv-delete").onclick=()=>confirmDelete(`ВИКР ${draft.code}`,"ВИКР, все его ГЭСН и ресурсы будут удалены из локальной Базы.",()=>{const i=base.indexOf(original);if(i>=0)base.splice(i,1);persistBase();ui.baseFocus=base[0]?.id;ui.activeNode={type:"object",value:"all"};ui.baseDetail={...ui.activeNode};ui.selection.delete(id)},()=>editBaseVikrNew(id,draft,onBack));
    },true);
  }
  function inferredPackageName(ids){const items=ids.map(id=>base.find(v=>v.id===id)).filter(Boolean);const marks=[...new Set(items.map(v=>v.mark))],krs=[...new Set(items.map(v=>v.kr||"Не распределено"))];if(krs.length===1&&marks.length===1)return `${krs[0]} · ${marks[0]}`;if(krs.length===1)return krs[0];return "Выбранные работы"}
  function openTransfer(ids,level=null){const items=ids.map(id=>base.find(v=>v.id===id)).filter(Boolean);if(!items.length&&!(["kr","mark"].includes(level?.type)))return;const upper=items.length>1;modal(`<h2 id="dialog-title">Добавить в рабочий объект</h2><p>${items.length} ВИКР. Копируются все ГЭСН, ресурсы и связи. Перенесённый состав дальше живёт независимо от Базы.</p><label class="radio-row"><input type="radio" name="transfer-mode" value="full" checked><span><strong>С исходным объёмом</strong><small>Каждый ВИКР сохраняет своё количество.</small></span></label><label class="radio-row"><input type="radio" name="transfer-mode" value="unit"><span><strong>${upper?'На 1 комплект':'На 1 единицу ВИКР'}</strong><small>${upper?'Один комплект содержит исходные объёмы всех выбранных работ.':'ГЭСН и ресурсы делятся на исходный ключевой объём ВИКР.'}</small></span></label>${upper?`<label class="radio-row"><input type="checkbox" id="as-package" ${level?"":"checked"}><span>Сохранить выбранный набор как комплект</span></label><label class="field" style="margin-top:10px"><span>Название комплекта</span><input id="package-name" value="${esc(inferredPackageName(ids))}"></label>`:''}<div class="dialog-grid"><label class="field wide"><span>Куда добавить</span><select id="transfer-target"><option value="original">Сохранить место из Базы</option><option value="none">Без места — разнести позже</option><option value="new">Создать структуру вручную</option>${work.structures.flatMap(s=>s.marks.map(m=>`<option value="existing|${esc(s.kr)}|${esc(m)}">${esc(s.kr)} → ${esc(m)}</option>`)).join("")}</select></label><label class="field" id="target-kr-field" style="display:none"><span>Конструктив</span><input id="target-kr" placeholder="Например, ВЛ"></label><label class="field" id="target-mark-field" style="display:none"><span>Марка</span><input id="target-mark" placeholder="Например, ТЛ"></label></div><div class="dialog-actions"><button class="outline" id="cancel-dialog">Отмена</button><button class="primary" id="confirm-transfer">Добавить</button></div>`,()=>{$("#cancel-dialog").onclick=closeModal;$("#transfer-target").onchange=e=>{const show=e.target.value==="new";$("#target-kr-field").style.display=show?"block":"none";$("#target-mark-field").style.display=show?"block":"none"};$("#confirm-transfer").onclick=async()=>{const mode=document.querySelector('input[name="transfer-mode"]:checked').value,target=$("#transfer-target").value;if(mode==="unit"&&items.length===1&&items[0].volume<=0){toast("Для этого ВИКР не определён ключевой объём");return}if(!work.present){work=clone(initialWork);work.id=uid();work.name=baseInfo.title||"Объект";work.present=true}if(level?.type==="object"&&work.vikrs.length===0&&work.structures.length===0){work.name=baseInfo.title||"Объект";const meta=getLevelMeta("object","all");work.unit=meta.unit||"";work.volume=meta.volume??null;work.baseVolume=work.volume}if(level?.type==="object"&&target==="original")knownKrs().forEach(kr=>ensureStructure(kr,""));if(level?.type==="kr"&&target==="original")ensureStructure(level.value,"");if(level?.type==="mark"&&target==="original"){const [kr,mark]=level.value.split("|");ensureStructure(kr,mark)}let packageId=null;if(upper&&$("#as-package").checked){packageId=uid();work.packages.push({id:packageId,name:$("#package-name").value.trim()||"Комплект",count:1,unit:"комплект",memberIds:[]})}for(const source of items){if(mode==="unit"&&!upper&&source.volume<=0){toast("Для этого ВИКР не определён ключевой объём");return}const item=C.normalize(source,mode==="unit"&&!upper?"unit":"full",uid());if(target==="none"){item.kr="";item.mark=""}else if(target==="new"){item.kr=$("#target-kr").value.trim();item.mark=$("#target-mark").value.trim()}else if(target.startsWith("existing|")){[,item.kr,item.mark]=target.split("|")}if(packageId){item.packageId=packageId;work.packages.at(-1).memberIds.push(item.uid)}work.vikrs.push(item);ensureStructure(item.kr,item.mark);ui.workFocus={type:"vikr",id:item.uid}}ui.workFocus={type:target!=="original"&&level?.type!=="object"?"object":level?.type==="object"?"object":level?.type==="kr"?"kr":level?.type==="mark"?"mark":"vikr",id:level?.type==="object"?work.id:level?.type==="kr"||level?.type==="mark"?level.value:work.vikrs.at(-1)?.uid};ui.workView=level?.type==="object"?"kr":level?.type==="kr"?"mark":"vikr";const saved=await persistWorkNow();closeModal();ui.selection.clear();renderSelection();switchSpace("work");toast(saved?`${items.length} ВИКР добавлено и сохранено`:"ВИКР добавлены, но сохранить рабочий объект не удалось")}})}
  function openTransferV41(ids=[],level=null,objectIds=[],emptyLevels=[]){
    const wholeObjects=objectIds.map(id=>baseObjects.find(object=>object.id===id)).filter(Boolean);
    const source=baseObjects.find(object=>object.id===activeBaseId);
    const records=wholeObjects.length?wholeObjects.flatMap(object=>object.vikrs.map(v=>({object,v}))):ids.map(id=>base.find(v=>v.id===id)).filter(Boolean).map(v=>({object:source,v}));
    const levels=level?[level]:emptyLevels;
    if(!records.length&&!wholeObjects.length&&!levels.length){toast("Сначала выберите объект или элементы");return}
    const single=records.length===1,upper=records.length>1,sourceName=wholeObjects.length===1?wholeObjects[0].info.title:level?.type==="object"?baseInfo.title:"";
    const selectedName=inferredPackageName(records.filter(item=>item.object===source).map(item=>item.v.id));
    modal(`<h2 id="dialog-title">Добавить в объект</h2><p>${records.length} ВИКР. Копируются все ГЭСН, ресурсы и связи; исходные объекты сохраняются.</p><label class="radio-row"><input type="radio" name="transfer-mode" value="full" checked><span><strong>С исходным объёмом</strong><small>Каждый ВИКР сохранит своё количество.</small></span></label><label class="radio-row"><input type="radio" name="transfer-mode" value="unit"><span><strong>${upper?"На 1 комплект":"На 1 единицу ВИКР"}</strong><small>${upper?"Один комплект содержит исходные объёмы выбранных работ.":"ГЭСН и ресурсы делятся на ключевой объём ВИКР."}</small></span></label>${upper?`<label class="radio-row"><input type="checkbox" id="as-package" ${level?"":"checked"}><span>Сохранить выбранный набор как комплект</span></label><label class="field" style="margin-top:10px"><span>Название комплекта</span><input id="package-name" value="${esc(selectedName)}"></label>`:""}<div class="dialog-grid"><label class="field wide"><span>Куда добавить</span><select id="transfer-target"><option value="new">Создать новый объект</option>${baseObjects.map(object=>`<option value="${esc(object.id)}">${esc(object.info.title)}</option>`).join("")}</select></label><label class="field wide" id="transfer-name-field"><span>Название нового объекта</span><input id="transfer-new-name" value="${esc(sourceName)}" placeholder="Укажите название"></label></div><div class="dialog-actions"><button class="outline" id="cancel-transfer">Отмена</button><button class="primary" id="confirm-transfer-v41">Добавить</button></div>`,()=>{
      $("#cancel-transfer").onclick=closeModal;
      $("#transfer-target").onchange=()=>$("#transfer-name-field").classList.toggle("hidden",$("#transfer-target").value!=="new");
      $("#confirm-transfer-v41").onclick=async()=>{
        const mode=document.querySelector('input[name="transfer-mode"]:checked')?.value||"full",targetId=$("#transfer-target").value,newName=$("#transfer-new-name").value.trim();
        if(targetId==="new"&&!newName){toast("Укажите название нового объекта");return}
        if(mode==="unit"&&single&&!(Number(records[0].v.volume)>0)){toast("У выбранного ВИКР не указан ключевой объём");return}
        if(!await ensureFolderAccess())return;
        await folderWriteQueue;
        let target;
        if(targetId==="new"){
          const fromWhole=wholeObjects.length===1?wholeObjects[0]:level?.type==="object"?source:null;
          const info=fromWhole?clone(fromWhole.info):{title:newName,location:"",description:"",source:"",note:"",levels:{object:{name:newName,unit:"",volume:null,note:"",coefficients:[]}},krCatalog:[]};
          info.title=newName;info.deleted=false;info.treeHidden=false;info.levels||={};info.levels.object={...(info.levels.object||{}),name:newName};
          target={id:uid(),info,vikrs:[],packages:[]};
        }else{
          const existing=baseObjects.find(object=>object.id===targetId);
          if(!existing){toast("Целевой объект не найден. Нажмите «Обновить»");return}
          target=clone(existing);
        }
        target.info.levels||={};target.info.krCatalog||=[];target.packages||=[];
        const copyMeta=(from,kr,mark)=>{
          if(!kr)return;
          const catalog=(from.info.krCatalog||[]).find(item=>item.code===kr);
          if(catalog&&!target.info.krCatalog.some(item=>item.code===kr))target.info.krCatalog.push(clone(catalog));
          for(const key of [`kr:${kr}`,mark?`mark:${kr}|${mark}`:null])if(key&&from.info.levels?.[key]&&!target.info.levels[key])target.info.levels[key]=clone(from.info.levels[key]);
        };
        for(const object of wholeObjects){for(const item of object.info.krCatalog||[])if(!target.info.krCatalog.some(entry=>entry.code===item.code))target.info.krCatalog.push(clone(item));for(const [key,value] of Object.entries(object.info.levels||{}))if(key!=="object"&&!target.info.levels[key])target.info.levels[key]=clone(value)}
        for(const node of levels){if(node.type==="kr")copyMeta(source,node.value,"");if(node.type==="mark"){const [kr,mark]=node.value.split("|");copyMeta(source,kr,mark)}}
        const packageEnabled=upper&&$("#as-package")?.checked,packageId=packageEnabled?uid():null,packageName=packageEnabled?$("#package-name").value.trim()||"Комплект":"";
        if(packageEnabled)target.packages.push({id:packageId,name:packageName,count:1,unit:"комплект",memberIds:[]});
        const inheritedPackages=new Map();
        for(const {object,v} of records){
          copyMeta(object,v.kr,v.mark);
          const item=clone(v),oldId=item.id,denominator=mode==="unit"&&single?Number(v.volume):1;
          item.id=uid();item.sourceId=oldId;delete item.uid;
          if(denominator!==1){item.volume=1;for(const position of item.gesn||[]){position.qty=(Number(position.qty)||0)/denominator;for(const resource of position.resources||[])resource.qty=(Number(resource.qty)||0)/denominator}}
          for(const position of item.gesn||[]){position.id=uid();for(const resource of position.resources||[])if(resource.id)resource.id=uid()}
          if(packageId){item.packageId=packageId;target.packages.at(-1).memberIds.push(item.id)}
          else if(v.packageId){const key=object.id+"|"+v.packageId;let inherited=inheritedPackages.get(key);if(!inherited){const original=(object.packages||[]).find(pack=>pack.id===v.packageId);if(original){inherited={...clone(original),id:uid(),memberIds:[]};target.packages.push(inherited);inheritedPackages.set(key,inherited)}}if(inherited){item.packageId=inherited.id;inherited.memberIds.push(item.id)}else delete item.packageId}
          target.vikrs.push(item);
        }
        if(!await objectFiles.write(target,{create:targetId==="new"})){toast("Не удалось сохранить целевой объект в папке «Объекты»");return}

        const existingIndex=baseObjects.findIndex(object=>object.id===target.id);
        if(existingIndex<0)baseObjects.push(target);else baseObjects[existingIndex]=target;
        ui.selection.clear();ui.objectSelection.clear();closeModal();selectBaseObject(target.id);toast(`${records.length} ВИКР добавлено в объект`);
      };
    });
  }
  function ensureStructure(kr,mark){if(!kr)return;let s=work.structures.find(x=>x.kr===kr);if(!s){s={kr,marks:[]};work.structures.push(s)}if(!work.levelMeta["kr:"+kr]){const meta=getLevelMeta("kr",kr);if(meta.volume!=null||meta.unit)work.levelMeta["kr:"+kr]=clone(meta)}if(mark&&!s.marks.includes(mark))s.marks.push(mark)}
  function compareSelection(){const items=[...ui.selection].map(id=>base.find(v=>v.id===id)).filter(Boolean);if(items.length<2){toast("Выберите минимум два ВИКР для сравнения");return}modal(`<h2 id="dialog-title">Сравнение выбранных ВИКР</h2><p>Сравнение выбранных ВИКР по основным показателям.</p><div style="overflow:auto"><table class="small-table"><thead><tr><th>Показатель</th>${items.map(v=>`<th>${esc(v.code)}</th>`).join("")}</tr></thead><tbody><tr><td>Работа</td>${items.map(v=>`<td>${esc(v.name)}</td>`).join("")}</tr><tr><td>Место</td>${items.map(v=>`<td>${esc(v.kr||'Без КР')} / ${esc(v.mark)}</td>`).join("")}</tr><tr><td>Объём</td>${items.map(v=>`<td>${v.volume!=null?quantityMarkup(num(ui.baseMode==="unit"?1:v.volume),v.unit):"—"}</td>`).join("")}</tr><tr><td>ГЭСН</td>${items.map(v=>`<td>${v.gesn.length}</td>`).join("")}</tr><tr><td>Рабочие</td>${items.map(v=>`<td>${num(baseTotals(v).workers)} ч</td>`).join("")}</tr></tbody></table></div><div class="dialog-actions"><button class="primary" id="close-compare">Закрыть</button></div>`,()=>{$("#close-compare").onclick=closeModal})}

  function workItem(){return work.vikrs.find(v=>v.uid===ui.workFocus.id)}
  function packageFor(item){return item.packageId?work.packages.find(p=>p.id===item.packageId):null}
  function workTotals(items){return C.addTotals(items.map(v=>workVikrTotals(v,C.workFactor(v,work.packages))))}
  function workLevelItems(f){if(f.type==="object")return work.vikrs;if(f.type==="kr")return work.vikrs.filter(v=>v.kr===f.id);if(f.type==="mark"){const [kr,mark]=f.id.split("|");return work.vikrs.filter(v=>v.kr===kr&&v.mark===mark)}if(f.type==="package")return work.vikrs.filter(v=>v.packageId===f.id);return []}
  function workLevelMeta(f){if(f.type==="object")return {unit:work.unit||"",volume:work.volume??null};if(f.type==="kr")return work.levelMeta["kr:"+f.id]||clone(getLevelMeta("kr",f.id));if(f.type==="mark")return work.levelMeta["mark:"+f.id]||{unit:"",volume:null};if(f.type==="package"){const p=work.packages.find(x=>x.id===f.id);return {unit:p?.unit||"комплект",volume:p?.count??null}}return {unit:"",volume:null}}
  function editWorkLevel(f){
    if(f.type==="vikr"){const v=work.vikrs.find(x=>x.uid===f.id);if(v)editWorkVikr(v);return}
    const isMark=f.type==="mark",isPackage=f.type==="package",meta=clone(workLevelMeta(f)),items=workLevelItems(f),pack=isPackage?work.packages.find(p=>p.id===f.id):null;
    const current=f.type==="object"?work.name:f.type==="kr"?f.id:isMark?f.id.split("|")[1]:pack?.name||"";
    const amountFields=isMark?"":`<label class="field"><span>${isPackage?"Единица":"Единица измерения"}</span><input id="work-level-unit" value="${esc(meta.unit||"")}" ${isPackage?'readonly':''}></label><label class="field"><span>${isPackage?"Количество":"Объём уровня"}</span><input id="work-level-volume" type="number" min="0" step="any" value="${meta.volume??''}"></label>`;
    const scaleField=isMark||isPackage?"":`<label class="radio-row"><input type="checkbox" id="work-level-scale" ${Number(meta.volume)>0?"checked":"disabled"}><span><strong>Пересчитать вложенные ВИКР пропорционально</strong><small>Ресурсы пересчитываются через новые объёмы ВИКР.</small></span></label>`;
    modal(`<h2 id="dialog-title">Изменить ${f.type==="object"?"объект":f.type==="kr"?"конструктив":isMark?"марку":"комплект"}</h2><p>${isMark?"Основной объём марки можно задать в сводке; её состав пересчитывается пропорционально.":"Изменение верхнего объёма меняет объёмы вложенных ВИКР."}</p><div class="dialog-grid"><label class="field ${isMark?"wide":""}"><span>Наименование</span><input id="work-level-name" value="${esc(current)}"></label>${amountFields}</div>${scaleField}<div class="dialog-actions dialog-actions-split"><div><button class="outline" id="work-level-cancel">Отменить</button><button class="primary" id="work-level-save">Сохранить</button></div></div>`,()=>{
      $("#work-level-cancel").onclick=closeModal;$("#work-level-save").onclick=()=>{const name=$("#work-level-name").value.trim(),raw=isMark?"":$("#work-level-volume").value.trim(),volume=isMark?meta.volume??null:raw===""?null:Number(raw),unit=isMark?meta.unit||"":$("#work-level-unit").value.trim();if(!name||volume!=null&&(!Number.isFinite(volume)||volume<0)){toast("Проверьте наименование и объём");return}if(!isMark&&!isPackage&&$("#work-level-scale").checked&&Number(meta.volume)>0&&volume!=null&&volume!==Number(meta.volume)){const factor=volume/Number(meta.volume);items.forEach(v=>v.volume=(Number(v.volume)||0)*factor)}if(f.type==="object"){work.name=name;work.unit=unit;work.volume=volume}else if(f.type==="kr"){if(name!==f.id){const s=work.structures.find(x=>x.kr===f.id);if(s)s.kr=name;work.vikrs.filter(x=>x.kr===f.id).forEach(x=>x.kr=name);delete work.levelMeta["kr:"+f.id];ui.workFocus={type:"kr",id:name}}work.levelMeta["kr:"+name]={unit,volume}}else if(isMark){const [kr,mark]=f.id.split("|"),s=work.structures.find(x=>x.kr===kr);if(s)s.marks=s.marks.map(x=>x===mark?name:x);work.vikrs.filter(x=>x.kr===kr&&x.mark===mark).forEach(x=>x.mark=name);if(name!==mark){work.levelMeta["mark:"+kr+"|"+name]=clone(meta);delete work.levelMeta["mark:"+f.id]}ui.workFocus={type:"mark",id:kr+"|"+name}}else if(pack){pack.name=name;pack.count=volume}closeModal();renderWork();toast("Уровень обновлён")}
    })
  }
  function deleteWorkNode(f){
    const v=f.type==="vikr"?work.vikrs.find(x=>x.uid===f.id):null;let label="",count=0;
    if(f.type==="vikr"&&v){label=`ВИКР ${v.code}`;count=v.gesn.length}
    else if(f.type==="kr"){label=`конструктив ${f.id}`;count=work.vikrs.filter(x=>x.kr===f.id).length}
    else if(f.type==="mark"){const [kr,mark]=f.id.split("|");label=`марку ${mark}`;count=work.vikrs.filter(x=>x.kr===kr&&x.mark===mark).length}
    else if(f.type==="package"){const p=work.packages.find(x=>x.id===f.id);label=`комплект ${p?.name||""}`;count=work.vikrs.filter(x=>x.packageId===f.id).length}
    else if(f.type==="pool"){label="ГЭСН без ВИКР";count=work.loose.length}
    else if(f.type==="unplaced"){label="ВИКР без места";count=work.vikrs.filter(x=>!x.kr).length}
    else{label=`рабочий объект «${work.name}»`;count=work.vikrs.length}
    confirmDelete(label,f.type==="object"?"Объект и все связанные с ним конструктивы, марки, ВИКР, ГЭСН и ресурсы будут удалены из Рабочего объекта.":f.type==="vikr"?"ВИКР и все его ГЭСН будут удалены.":`Будет удалено вложенных элементов: ${count}.`,()=>{
      if(f.type==="object"){work=clone(initialWork);work.id=uid()}
      else{
        if(f.type==="vikr")work.vikrs=work.vikrs.filter(x=>x.uid!==f.id);
        else if(f.type==="mark"){const [kr,mark]=f.id.split("|");work.vikrs=work.vikrs.filter(x=>!(x.kr===kr&&x.mark===mark));const structure=work.structures.find(x=>x.kr===kr);if(structure)structure.marks=structure.marks.filter(x=>x!==mark)}
        else if(f.type==="kr"){work.vikrs=work.vikrs.filter(x=>x.kr!==f.id);work.structures=work.structures.filter(x=>x.kr!==f.id);delete work.levelMeta["kr:"+f.id]}
        else if(f.type==="package"){work.vikrs=work.vikrs.filter(x=>x.packageId!==f.id);work.packages=work.packages.filter(x=>x.id!==f.id)}
        else if(f.type==="pool")work.loose=[];
        else if(f.type==="unplaced")work.vikrs=work.vikrs.filter(x=>x.packageId||x.kr);
        const remaining=new Set(work.vikrs.map(x=>x.uid));work.packages.forEach(p=>p.memberIds=p.memberIds.filter(id=>remaining.has(id)));
      }
      ui.workSelection.clear();ui.gesnSelection.clear();ui.workFocus={type:"object",id:work.id};
    });
  }
  function editWorkNode(f){if(["object","kr","mark","package","vikr"].includes(f.type))editWorkLevel(f)}
  function renderWorkTree(){
    if(!work.present){$("#work-tree").innerHTML="";return}
    if(work.treeHidden){$("#work-tree").innerHTML='<div class="empty">Объект убран из дерева. Выберите его в списке «+» у Рабочего объекта.</div>';return}
    const expanded=ui.workTreeExpanded,key=(type,id)=>type==="object"?"object":type+"|"+id;
    const row=(type,id,label,level,glyph,expandable=false)=>`<div class="base-tree-line" style="--level:${level}"><button class="tree-toggle" data-key="${esc(key(type,id))}" ${expandable?'':'disabled'} aria-label="${expanded.has(key(type,id))?'Свернуть':'Развернуть'} ${esc(label)}">${expandable?disclosureIcon(expanded.has(key(type,id))):''}</button><button class="tree-node ${ui.workFocus.type===type&&ui.workFocus.id===id?'active':''}" data-type="${type}" data-id="${esc(id)}" style="--level:${level}"><span class="glyph ${type==='object'?'object':''}">${esc(glyph)}</span><span>${esc(label)}</span></button></div>`;
    let html=`<button class="outline full" id="open-work-picker">Выбрать уровень ▾</button><div class="base-tree-list">`;
    const children=work.structures.length||work.vikrs.length||work.packages.length||work.loose.length;
    html+=row("object",work.id,work.name,0,"О",children);
    if(expanded.has("object")){
      for(const pack of work.packages){const members=work.vikrs.filter(v=>v.packageId===pack.id);html+=row("package",pack.id,pack.name,1,"К",members.length>0);if(expanded.has(key("package",pack.id)))for(const v of members)html+=row("vikr",v.uid,v.code+" · "+v.name,2,"В")}
      for(const structure of work.structures){const kr=structure.kr,direct=work.vikrs.filter(v=>!v.packageId&&v.kr===kr),hasChildren=structure.marks.length||direct.length;html+=row("kr",kr,kr,1,"КР",hasChildren);if(expanded.has(key("kr",kr))){for(const mark of structure.marks){const vs=direct.filter(v=>v.mark===mark),id=kr+"|"+mark;html+=row("mark",id,mark,2,"М",vs.length>0);if(expanded.has(key("mark",id)))for(const v of vs)html+=row("vikr",v.uid,v.code+" · "+v.name,3,"В")}for(const v of direct.filter(v=>!v.mark))html+=row("vikr",v.uid,v.code+" · "+v.name,2,"В")}}
      const unplaced=work.vikrs.filter(v=>!v.packageId&&!v.kr);if(unplaced.length){html+=row("unplaced","none","Без места",1,"!",true);if(expanded.has(key("unplaced","none")))for(const v of unplaced)html+=row("vikr",v.uid,v.code+" · "+v.name,2,"В")}
      if(work.loose.length)html+=row("pool","pool","ГЭСН без ВИКР",1,"Г");
    }
    $("#work-tree").innerHTML=html+"</div>";
    $("#open-work-picker").onclick=openWorkLevelPicker;
    $("#work-tree").querySelectorAll(".tree-toggle:not(:disabled)").forEach(b=>b.onclick=()=>{expanded.has(b.dataset.key)?expanded.delete(b.dataset.key):expanded.add(b.dataset.key);renderWorkTree()});
    $("#work-tree").querySelectorAll(".tree-node").forEach(b=>b.onclick=()=>{ui.workFocus={type:b.dataset.type,id:b.dataset.id};ui.workSelection.clear();ui.gesnSelection.clear();renderWork()});
  }
  function openWorkLevelPicker(){
    if(!work.present)return;
    const options=[{type:"object",id:work.id,label:work.name},...work.packages.map(p=>({type:"package",id:p.id,label:p.name})),...work.structures.flatMap(structure=>[{type:"kr",id:structure.kr,label:structure.kr},...structure.marks.map(mark=>({type:"mark",id:structure.kr+"|"+mark,label:mark}))]),...work.vikrs.map(v=>({type:"vikr",id:v.uid,label:v.code+" · "+v.name}))];
    modal(`<h2 id="dialog-title">Выбрать уровень</h2><p>Выберите объект, конструктив, марку или ВИКР рабочего объекта.</p><label class="field"><span>Поиск</span><input id="work-picker-search" placeholder="Код или часть названия"></label><div class="picker-tree" id="work-picker-tree"></div><div class="dialog-actions"><button class="outline" id="work-picker-add">+ Уровень</button><button class="outline" id="work-picker-close">Закрыть</button></div>`,()=>{
      const draw=()=>{const q=$("#work-picker-search").value.trim().toLocaleLowerCase("ru-RU");$("#work-picker-tree").innerHTML=options.filter(o=>o.label.toLocaleLowerCase("ru-RU").includes(q)).map(o=>`<div class="picker-item"><button class="picker-label work-picker-choice" data-type="${o.type}" data-id="${esc(o.id)}"><strong>${esc(o.label)}</strong></button><button class="icon-edit work-picker-edit" data-type="${o.type}" data-id="${esc(o.id)}" aria-label="Изменить ${esc(o.label)}">✎</button></div>`).join("")||'<div class="empty">Ничего не найдено</div>';$("#work-picker-tree").querySelectorAll(".work-picker-choice").forEach(b=>b.onclick=()=>{ui.workFocus={type:b.dataset.type,id:b.dataset.id};closeModal();renderWork()});$("#work-picker-tree").querySelectorAll(".work-picker-edit").forEach(b=>b.onclick=()=>editWorkNode({type:b.dataset.type,id:b.dataset.id}))};
      $("#work-picker-search").oninput=draw;$("#work-picker-add").onclick=addStructure;$("#work-picker-close").onclick=closeModal;draw();
    },true);
  }
  function visibleWorkItems(f){
    let items=work.vikrs;if(f.type==="kr")items=items.filter(v=>v.kr===f.id);else if(f.type==="mark"){const [kr,mark]=f.id.split("|");items=items.filter(v=>v.kr===kr&&v.mark===mark)}else if(f.type==="package")items=items.filter(v=>v.packageId===f.id);else if(f.type==="unplaced")items=items.filter(v=>!v.kr);else if(f.type==="vikr")items=items.filter(v=>v.uid===f.id);
    if(ui.workKrFilter)items=items.filter(v=>v.kr===ui.workKrFilter);
    if(ui.workMarkFilter)items=items.filter(v=>(v.mark||"Без марки")===ui.workMarkFilter);
    if(ui.workUnitFilter)items=items.filter(v=>v.unit===ui.workUnitFilter);
    const terms=ui.workQuery.toLocaleLowerCase("ru-RU").trim().split(/\s+/).filter(Boolean),workTerms=ui.workType.toLocaleLowerCase("ru-RU").trim().split(/\s+/).filter(Boolean);
    if(workTerms.length)items=items.filter(v=>workTerms.every(term=>(v.code+" "+v.name+" "+worksOfVikr(v).join(" ")).toLocaleLowerCase("ru-RU").includes(term)));
    return items.filter(v=>terms.every(term=>[v.code,v.name,v.kr,v.mark,v.note,...(v.gesn||[]).flatMap(p=>[p.code,p.name,...(p.resources||[]).flatMap(r=>[r.code,r.name])])].join(" ").toLocaleLowerCase("ru-RU").includes(term)));
  }
  function renderWorkAdvancedSearch(){
    $("#work-advanced-search").classList.toggle("hidden",!ui.workAdvancedOpen);$("#work-advanced-toggle").textContent=ui.workAdvancedOpen?"Скрыть фильтры":"Расширенный поиск";$("#work-advanced-toggle").setAttribute("aria-expanded",String(ui.workAdvancedOpen));
    const optionList=(values,current,label)=>`<option value="">${label}</option>${values.map(value=>`<option value="${esc(value)}" ${value===current?'selected':''}>${esc(value)}</option>`).join("")}`;
    $("#work-work-types").innerHTML=[...new Set(work.vikrs.flatMap(worksOfVikr))].sort((a,b)=>a.localeCompare(b,"ru")).map(value=>`<option value="${esc(value)}"></option>`).join("");
    $("#work-filter-type").value=ui.workType;
    $("#work-filter-kr").innerHTML=optionList([...new Set(work.structures.map(s=>s.kr))].sort((a,b)=>a.localeCompare(b,"ru")),ui.workKrFilter,"Все конструктивы");
    const markSource=ui.workKrFilter?work.vikrs.filter(v=>v.kr===ui.workKrFilter):work.vikrs;
    $("#work-filter-mark").innerHTML=optionList([...new Set(markSource.map(v=>v.mark||"Без марки"))].sort((a,b)=>a.localeCompare(b,"ru")),ui.workMarkFilter,"Все марки");
    $("#work-filter-unit").innerHTML=optionList([...new Set(work.vikrs.map(v=>v.unit).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ru")),ui.workUnitFilter,"Все единицы");
    $("#work-filter-type").oninput=e=>{ui.workType=e.target.value;if(ui.workType.trim())ui.workView="vikr";renderWorkLevel()};
    $("#work-filter-kr").onchange=e=>{ui.workKrFilter=e.target.value;ui.workMarkFilter="";renderWorkAdvancedSearch();renderWorkLevel()};
    $("#work-filter-mark").onchange=e=>{ui.workMarkFilter=e.target.value;renderWorkLevel()};
    $("#work-filter-unit").onchange=e=>{ui.workUnitFilter=e.target.value;renderWorkLevel()};
    $("#work-filters-reset").onclick=()=>{ui.workType="";ui.workKrFilter="";ui.workMarkFilter="";ui.workUnitFilter="";ui.workQuery="";$("#work-search").value="";renderWorkAdvancedSearch();renderWorkLevel()};
  }
  function renderWork(){renderWorkAdvancedSearch();renderWorkTree();$("#work-selection-drawer").classList.add("hidden");if(!work.present){$("#work-main").innerHTML="";$("#work-side").innerHTML="";persistWorkNow().then(ok=>{if(!ok)toast("Не удалось сохранить рабочий объект")});return}const f=ui.workFocus;if(f.type==="pool"){renderPool();enhancePoolIntegration()}else renderWorkLevel();renderWorkSideNew();persistWorkNow().then(ok=>{if(!ok)toast("Не удалось сохранить рабочий объект")})}
  function renderWorkVikr(v,root="#work-main"){
    const factor=C.workFactor(v,work.packages),t=workVikrTotals(v,factor),pack=packageFor(v),positionIds=new Set(v.gesn.map(p=>p.id));
    for(const id of [...ui.gesnSelection])if(!positionIds.has(id))ui.gesnSelection.delete(id);
    const selected=v.gesn.filter(p=>ui.gesnSelection.has(p.id)),allExcluded=selected.length>0&&selected.every(p=>p.excluded);
    $(root).innerHTML=`<div class="work-head"><div class="crumb">${esc(pack?pack.name:(v.kr||'Без места')+' › '+(v.mark||'Без марки'))} › ВИКР</div><div class="level-heading"><h2><span class="type-badge">В</span> ${esc(v.code)} · ${esc(v.name)}</h2><button class="icon-edit" id="work-vikr-edit" aria-label="Изменить ВИКР">✎</button></div><span class="subtle">${v.sourceId?'Копия из Базы · исходная запись не меняется':'Создано в рабочем объекте'}${v.mode==='unit'?' · перенесено на 1 '+esc(v.unit):''}</span>${pack?`<p class="subtle">Входит в комплект «${esc(pack.name)}»; объём комплекта также влияет на показатели.</p>`:''}</div><div class="work-summary four"><div class="stat volume-stat"><label class="field"><span>Объём ВИКР</span><div class="volume-inline"><input id="work-volume" type="number" step="any" min="0" value="${v.volume??''}"><span>${esc(v.unit)}</span></div></label></div><div class="stat metric"><small>Рабочие</small><strong>${num(t.workers)} чел.-ч</strong></div><div class="stat"><small>Машинисты</small><strong>${num(t.drivers)} чел.-ч</strong></div><div class="stat"><small>Машины и механизмы</small><strong>${num(t.machines)} маш.-ч</strong></div></div><div class="work-section"><div class="section-head"><h3>Состав ГЭСН</h3><div class="stack-actions"><label class="select-all-row"><input type="checkbox" id="gesn-select-all"> Выбрать все</label><button class="quiet" id="add-gesn-base">+ Из Базы</button><button class="quiet" id="add-gesn-own">+ Своя ГЭСН</button></div></div><div class="bulk-bar ${selected.length?'':'hidden'}" id="gesn-bulk"><strong>Выбрано: ${selected.length}</strong><button class="soft" id="group-selected-gesn">Создать отдельный ВИКР</button><button class="soft" id="toggle-selected-gesn">${allExcluded?'Включить в расчёт':'Исключить из расчёта'}</button><button class="danger-btn" id="delete-selected-gesn">Удалить</button><button class="quiet" id="clear-selected-gesn">Снять выбор</button></div>${v.gesn.length?v.gesn.map(p=>`<div class="work-position ${p.excluded?'excluded':''}" data-position="${esc(p.id)}"><div class="position-head"><input type="checkbox" class="position-select" data-position="${esc(p.id)}" ${ui.gesnSelection.has(p.id)?'checked':''} aria-label="Выбрать ${esc(p.code)}"><span class="type-badge">Г</span><div class="position-text"><b>${esc(p.code)}</b><span>${esc(p.name)}</span><small>${p.excluded?'Исключена из итогов':'Входит в расчёт'}${p.coefficients?` · ${esc(Array.isArray(p.coefficients)?p.coefficients.map(item=>item.name||item.code).join("; "):p.coefficients)}`:""}</small></div><em>${quantityMarkup(num(p.qty*factor),p.unit)}</em><button class="icon-edit edit-position" data-position="${esc(p.id)}" aria-label="Изменить ${esc(p.code)}">✎</button><button class="icon-delete delete-position-direct" data-position="${esc(p.id)}" aria-label="Удалить ${esc(p.code)}">${trashIcon}</button><button class="dots gesn-works" data-position="${esc(p.id)}" aria-label="Состав работ ${esc(p.code)}">⋯</button></div>${resourceList(p,factor)}</div>`).join(""):'<div class="empty">ГЭСН пока нет. Добавьте позицию из Базы или создайте свою.</div>'}</div>`;
    $("#work-volume").oninput=e=>{const n=Number(e.target.value);if(!Number.isFinite(n)||n<0)return;v.volume=n;renderWorkVikr(v,root);renderWorkSideNew();persistWorkNow().then(ok=>{if(!ok)toast("Не удалось сохранить рабочий объект")})};
    const all=$("#gesn-select-all");all.checked=v.gesn.length>0&&v.gesn.every(p=>ui.gesnSelection.has(p.id));all.indeterminate=!all.checked&&v.gesn.some(p=>ui.gesnSelection.has(p.id));all.onchange=()=>{v.gesn.forEach(p=>all.checked?ui.gesnSelection.add(p.id):ui.gesnSelection.delete(p.id));renderWorkVikr(v,root)};
    $("#work-vikr-edit").onclick=()=>editWorkVikr(v);$("#add-gesn-base").onclick=()=>openGesnPicker(v);$("#add-gesn-own").onclick=()=>openOwnGesn(v);
    document.querySelectorAll(".position-select").forEach(x=>x.onchange=()=>{x.checked?ui.gesnSelection.add(x.dataset.position):ui.gesnSelection.delete(x.dataset.position);renderWorkVikr(v,root)});
    document.querySelectorAll(".edit-position").forEach(b=>b.onclick=()=>editWorkPosition(v,b.dataset.position));document.querySelectorAll(root+" .gesn-works").forEach(b=>b.onclick=()=>showGesnWorks(v.gesn.find(p=>p.id===b.dataset.position)));
    document.querySelectorAll(".delete-position-direct").forEach(b=>b.onclick=()=>{const p=v.gesn.find(x=>x.id===b.dataset.position);confirmDelete(`ГЭСН ${p?.code||""}`,"Позиция и все её ресурсы будут удалены из рабочего объекта.",()=>{v.gesn=v.gesn.filter(x=>x.id!==b.dataset.position);renderWork()})});
    if(selected.length){$("#group-selected-gesn").onclick=()=>groupSelectedPositions(v);$("#toggle-selected-gesn").onclick=()=>{selected.forEach(p=>p.excluded=!allExcluded);ui.gesnSelection.clear();renderWork();toast(allExcluded?"ГЭСН включены в расчёт":"ГЭСН исключены из расчёта")};$("#delete-selected-gesn").onclick=()=>confirmDelete("Удалить выбранные ГЭСН?",`Будет удалено позиций: ${selected.length}.`,()=>{const ids=new Set(selected.map(p=>p.id));v.gesn=v.gesn.filter(p=>!ids.has(p.id));ui.gesnSelection.clear()});$("#clear-selected-gesn").onclick=()=>{ui.gesnSelection.clear();renderWorkVikr(v,root)}}
    enhanceWorkVikrIntegration(v,root);
  }
  function moveWorkVikrs(ids){
    const items=work.vikrs.filter(v=>ids.includes(v.uid));if(!items.length)return;
    modal(`<h2 id="dialog-title">Переместить ВИКР</h2><p>Новый конструктив и марка будут назначены ${items.length} выбранным ВИКР.</p><div class="dialog-grid"><label class="field"><span>Конструктив</span><input id="bulk-place-kr" value="${esc(items[0].kr||"")}" placeholder="Можно оставить пустым"></label><label class="field"><span>Марка</span><input id="bulk-place-mark" value="${esc(items[0].mark||"")}" placeholder="Можно оставить пустой"></label></div><div class="dialog-actions"><button class="outline" id="bulk-place-cancel">Отмена</button><button class="primary" id="bulk-place-save">Переместить</button></div>`,()=>{$("#bulk-place-cancel").onclick=closeModal;$("#bulk-place-save").onclick=()=>{const kr=$("#bulk-place-kr").value.trim(),mark=$("#bulk-place-mark").value.trim();items.forEach(v=>{v.kr=kr;v.mark=mark;ensureStructure(kr,mark)});ui.workSelection.clear();ui.workFocus={type:kr?mark?"mark":"kr":"unplaced",id:kr?mark?kr+"|"+mark:kr:"none"};closeModal();renderWork();toast("ВИКР перемещены")}})
  }
  function deleteSelectedWorkVikrs(ids){const items=work.vikrs.filter(v=>ids.includes(v.uid));if(!items.length)return;confirmDelete(`Выбранные ВИКР: ${items.length}`,`Будут удалены все выбранные ВИКР с ГЭСН и ресурсами.`,()=>{const set=new Set(ids);work.vikrs=work.vikrs.filter(v=>!set.has(v.uid));work.packages.forEach(p=>p.memberIds=p.memberIds.filter(id=>!set.has(id)));ui.workSelection.clear();ui.workFocus={type:"object",id:work.id}})}
  function renderWorkLevel(){if(!work.present){$("#work-main").innerHTML="";return}
    const f=ui.workFocus,views=f.type==="object"?["kr","mark","vikr"]:f.type==="kr"?["mark","vikr"]:["vikr"];
    if(!views.includes(ui.workView))ui.workView=views[0];
    const items=visibleWorkItems(f);
    const rows=ui.workView==="kr"?(ui.workQuery||ui.workType||ui.workKrFilter||ui.workMarkFilter||ui.workUnitFilter?work.structures.filter(structure=>items.some(v=>v.kr===structure.kr)):work.structures).map(structure=>({type:"kr",id:structure.kr,code:structure.kr,name:workLevelMeta({type:"kr",id:structure.kr}).name||getLevelMeta("kr",structure.kr).name||structure.kr,items:items.filter(v=>v.kr===structure.kr),place:work.name})):ui.workView==="mark"?[...new Set(items.map(v=>v.kr+"|"+v.mark))].map(id=>{const [kr,mark]=id.split("|");return {type:"mark",id,code:mark||"Без марки",name:mark||"Без марки",items:items.filter(v=>v.kr===kr&&v.mark===mark),place:kr}}):items.map(v=>({type:"vikr",id:v.uid,code:v.code,name:v.name,items:[v],place:(v.kr||"Без КР")+" → "+(v.mark||"Без марки")}));
    const labels={kr:"Конструктивы",mark:"Марки",vikr:"ВИКР"},scope=f.type==="object"?"объекта":f.type==="kr"?"конструктива":f.type==="mark"?"марки":"объекта",allIds=items.map(v=>v.uid);
    const volumeFor=row=>row.type==="vikr"?{volume:row.items[0]?.volume,unit:row.items[0]?.unit}:workLevelMeta({type:row.type,id:row.id});
    const totals=ui.workMode==="full"?workTotals(items):null;
    $("#work-main").innerHTML=`<div class="pane-title"><div><h2>${labels[ui.workView]} ${scope}</h2><small>${rows.length} элементов · ${items.length} ВИКР</small></div></div><div class="base-mode-row"><div class="mode-group"><span>Расчёт</span><div class="seg" id="work-mode"><button data-mode="full" class="${ui.workMode==='full'?'active':''}">На объём</button><button data-mode="unit" class="${ui.workMode==='unit'?'active':''}">На 1 ед.</button></div></div><div class="mode-group"><div class="seg" id="work-view">${views.map(view=>`<button data-view="${view}" class="${ui.workView===view?'active':''}">${labels[view]}</button>`).join("")}</div></div></div><div class="table-scroll" tabindex="0" aria-label="Состав выбранного уровня"><table class="rows work-rows ${ui.workView==='mark'&&!rows.some(row=>volumeFor(row).volume!=null)?'hide-unit':''}"><thead><tr><th class="check"><input type="checkbox" id="work-table-select-all" aria-label="Выбрать все элементы списка"></th><th>Код / тип</th><th>Наименование</th><th>Место</th><th class="right">Рабочие<small>чел.-ч</small></th><th class="right">Машинисты<small>чел.-ч</small></th><th class="right">Машины и механизмы<small>маш.-ч</small></th><th class="right">Объём</th><th>Ед.</th><th class="row-tools-head"></th></tr></thead><tbody>${rows.map((row,i)=>{const meta=volumeFor(row),raw=workTotals(row.items),hasVolume=Number(meta.volume)>0,shown=ui.workMode==='unit'?(hasVolume?{workers:raw.workers/meta.volume,drivers:raw.drivers/meta.volume,machines:raw.machines/meta.volume}:null):raw,ids=row.items.map(v=>v.uid),checked=ids.length>0&&ids.every(id=>ui.workSelection.has(id)),partial=!checked&&ids.some(id=>ui.workSelection.has(id));return `<tr data-index="${i}"><td><input type="checkbox" class="work-row-select" data-index="${i}" ${checked?'checked':''} ${partial?'data-partial="1"':''} aria-label="Выбрать ${esc(row.name)}"></td><td class="code"><span class="type-badge">${row.type==='kr'?'КР':row.type==='mark'?'М':'В'}</span><span>${esc(row.code)}</span></td><td><button class="row-name-link work-row-open" data-index="${i}">${esc(row.name)}</button><small>${row.type==='vikr'?`${row.items[0].gesn.length} ГЭСН`:`${row.items.length} ВИКР`}</small></td><td>${esc(row.place)}</td><td class="right">${shown?num(shown.workers):'—'}</td><td class="right">${shown?num(shown.drivers):'—'}</td><td class="right">${shown?num(shown.machines):'—'}</td><td class="right">${hasVolume?num(ui.workMode==='unit'?1:meta.volume):'—'}</td><td>${esc(meta.unit||'')}</td><td class="row-tools"><button class="icon-edit work-row-edit" data-index="${i}" aria-label="Изменить ${esc(row.name)}">✎</button><button class="icon-delete work-row-delete" data-index="${i}" aria-label="Удалить ${esc(row.name)}">${trashIcon}</button></td></tr>`}).join("")}</tbody><tfoot><tr><td></td><td colspan="3">Итого по текущему списку</td><td class="right">${num(totals?.workers)}</td><td class="right">${num(totals?.drivers)}</td><td class="right">${num(totals?.machines)}</td><td class="right">—</td><td></td><td></td></tr></tfoot></table>${rows.length?'':'<div class="empty">В рабочем объекте пока нет данных. Добавьте объект или уровень из Базы.</div>'}</div>`;
    $("#work-mode").querySelectorAll("button").forEach(b=>b.onclick=()=>{ui.workMode=b.dataset.mode;renderWorkLevel();renderWorkSideNew()});
    $("#work-view").querySelectorAll("button").forEach(b=>b.onclick=()=>{ui.workView=b.dataset.view;renderWorkLevel()});
    const all=$("#work-table-select-all");all.checked=allIds.length>0&&allIds.every(id=>ui.workSelection.has(id));all.indeterminate=!all.checked&&allIds.some(id=>ui.workSelection.has(id));all.onchange=()=>{allIds.forEach(id=>all.checked?ui.workSelection.add(id):ui.workSelection.delete(id));renderWorkLevel()};
    $("#work-main").querySelectorAll(".work-row-select").forEach(b=>{if(b.dataset.partial)b.indeterminate=true;b.onchange=()=>{rows[Number(b.dataset.index)].items.forEach(v=>b.checked?ui.workSelection.add(v.uid):ui.workSelection.delete(v.uid));renderWorkLevel()}});
    $("#work-main").querySelectorAll(".work-row-open").forEach(b=>b.onclick=()=>{const row=rows[Number(b.dataset.index)];if(row.type==='vikr'){openWorkVikrDetails(row.items[0]);return}ui.workFocus={type:row.type,id:row.id};ui.workView=row.type==='kr'?'mark':'vikr';renderWork()});
    $("#work-main").querySelectorAll(".work-row-edit").forEach(b=>b.onclick=()=>editWorkLevel({type:rows[Number(b.dataset.index)].type,id:rows[Number(b.dataset.index)].id}));
    $("#work-main").querySelectorAll(".work-row-delete").forEach(b=>b.onclick=()=>deleteWorkNode({type:rows[Number(b.dataset.index)].type,id:rows[Number(b.dataset.index)].id}));
    renderWorkSelection(items);
  }
  function renderWorkSelection(items){
    const ids=items.filter(v=>ui.workSelection.has(v.uid)).map(v=>v.uid),drawer=$("#work-selection-drawer");
    drawer.classList.toggle("hidden",ids.length===0);$("#work-selected-count").textContent=ids.length;
    $("#work-clear-selection").onclick=()=>{ui.workSelection.clear();renderWorkLevel()};
    $("#work-move-selection").onclick=()=>moveWorkVikrs(ids);
    $("#work-delete-selection").onclick=()=>deleteSelectedWorkVikrs(ids);
  }
  function openWorkVikrDetails(v){modal(`<h2 id="dialog-title">ВИКР ${esc(v.code)} · ${esc(v.name)}</h2><div id="work-vikr-detail"></div><div class="dialog-actions"><button class="outline" id="work-detail-close">Закрыть</button></div>`,()=>{$("#work-detail-close").onclick=()=>{closeModal();renderWork()};renderWorkVikr(v,"#work-vikr-detail")},true)}
  function renderPool(){$("#work-main").innerHTML=`<div class="work-head"><div class="crumb">Рабочий объект</div><h2>ГЭСН без ВИКР</h2><p class="subtle">Выберите несколько позиций и создайте из них один ВИКР. Каждая позиция и её ресурсы сохранятся внутри.</p></div><div class="work-section"><div class="section-head"><h3>Позиции</h3><div class="stack-actions"><label class="select-all-row"><input type="checkbox" id="pool-select-all"> Выбрать все</label><button class="quiet" id="pool-add">+ Добавить ГЭСН</button></div></div>${work.loose.map(p=>`<div class="work-position"><div class="position-head"><input type="checkbox" class="pool-check" data-id="${esc(p.id)}" ${ui.poolSelection.has(p.id)?'checked':''} aria-label="Выбрать ${esc(p.code)}"><span class="type-badge">Г</span><div class="position-text"><b>${esc(p.code)}</b><span>${esc(p.name)}</span></div><em>${quantityMarkup(num(p.qty),p.unit)}</em><button class="icon-edit edit-loose" data-id="${esc(p.id)}" aria-label="Изменить ${esc(p.code)}">✎</button><button class="icon-delete delete-loose" data-id="${esc(p.id)}" aria-label="Удалить ${esc(p.code)}">${trashIcon}</button><button class="dots gesn-works" data-id="${esc(p.id)}" aria-label="Состав работ ${esc(p.code)}">⋯</button></div>${resourceList(p)}</div>`).join("")}<div class="stack-actions" style="margin-top:15px"><button class="primary" id="create-from-pool">Создать ВИКР из выбранных ГЭСН</button></div></div>`;const all=$("#pool-select-all");all.checked=work.loose.length>0&&work.loose.every(p=>ui.poolSelection.has(p.id));all.indeterminate=!all.checked&&work.loose.some(p=>ui.poolSelection.has(p.id));all.onchange=()=>{work.loose.forEach(p=>all.checked?ui.poolSelection.add(p.id):ui.poolSelection.delete(p.id));renderPool()};document.querySelectorAll(".pool-check").forEach(x=>x.onchange=e=>{e.target.checked?ui.poolSelection.add(x.dataset.id):ui.poolSelection.delete(x.dataset.id);renderPool()});document.querySelectorAll(".edit-loose").forEach(b=>b.onclick=()=>editAnyPosition(work.loose,b.dataset.id,"work",()=>renderWork()));document.querySelectorAll(".delete-loose").forEach(b=>b.onclick=()=>{const p=work.loose.find(x=>x.id===b.dataset.id);confirmDelete(`ГЭСН ${p?.code||""}`,"Позиция и все её ресурсы будут удалены.",()=>{work.loose=work.loose.filter(x=>x.id!==b.dataset.id);ui.poolSelection.delete(b.dataset.id)})});document.querySelectorAll("#work-main .gesn-works").forEach(b=>b.onclick=()=>showGesnWorks(work.loose.find(p=>p.id===b.dataset.id)));$("#pool-add").onclick=()=>openGesnPicker(null);$("#create-from-pool").onclick=()=>{const positions=work.loose.filter(p=>ui.poolSelection.has(p.id));if(!positions.length){toast("Сначала выберите ГЭСН");return}openCreateVikr(positions)}}

  function renderWorkSideNew(){
    work.info||={title:"",location:"",description:"",source:"",note:""};
    const f=ui.workFocus,v=f.type==="vikr"?workItem():null;
    let items=work.vikrs,title=work.name,label="Объект",volume=work.volume!=null?`${num(work.volume)} ${esc(work.unit||"")}`:"—";
    if(f.type==="vikr"&&v){items=[v];title=`${v.code} · ${v.name}`;label="ВИКР";volume=`${num(v.volume)} ${v.unit}`}
    else if(f.type==="kr"){items=items.filter(x=>x.kr===f.id);title=f.id;label="Конструктив";const m=workLevelMeta(f);volume=m.volume!=null?`${num(m.volume)} ${esc(m.unit||"")}`:"—"}
    else if(f.type==="mark"){const [kr,mark]=f.id.split("|");items=items.filter(x=>x.kr===kr&&x.mark===mark);title=mark;label="Марка";volume="—"}
    else if(f.type==="package"){const pack=work.packages.find(x=>x.id===f.id);items=items.filter(x=>x.packageId===f.id);title=pack?.name||"Комплект";label="Комплект";volume=`${num(pack?.count)} комплект`}
    else if(f.type==="unplaced"){items=items.filter(x=>!x.kr);title="Без места";label="Работы без места"}
    else if(f.type==="pool"){items=[{gesn:work.loose,baseVolume:1,volume:1}];title="ГЭСН без ВИКР";label="Подборка"}
    let totals=workTotals(items);if(f.type==="vikr"&&v&&ui.workMode==="unit"){if(Number(v.volume)>0){totals={workers:totals.workers/v.volume,drivers:totals.drivers/v.volume,machines:totals.machines/v.volume};volume=`1 ${v.unit}`}else{totals=null;volume="—"}}
    const summaryRow=(name,value,extra="")=>`<div class="base-summary-row ${extra}"><small>${esc(name)}</small><strong>${extra==="volume"&&typeof value==="object"?quantityMarkup(value.value,value.unit):esc(value)}</strong></div>`;
    const note=f.type==="vikr"?v?.note:f.type==="object"?work.info.note:workLevelMeta(f).note;
    $("#work-side").innerHTML=`<div class="detail-content base-summary work-side-summary"><div class="section-head"><h2>Сводка</h2></div>${summaryRow("Объект",work.name,"object")}${f.type==='object'?'':summaryRow(label,title,"selected")}${summaryRow(f.type==='vikr'?"Ключевой объём":f.type==='mark'?"Объём марки не применяется":"Основной объём уровня",volume,"volume")}${summaryRow("Рабочие",`${num(totals?.workers)} чел.-ч`)}${summaryRow("Машинисты",`${num(totals?.drivers)} чел.-ч`)}${summaryRow("Машины и механизмы",`${num(totals?.machines)} маш.-ч`)}${summaryRow("Комментарий",note||"Не указан","comment")}<div class="summary-action-row"><button class="summary-action" id="coeff-placeholder">Коэффициенты</button><button class="summary-add" id="coeff-add" aria-label="Добавить коэффициент">+</button></div><div class="summary-action-row"><button class="summary-action" id="fsnb-placeholder">ФСНБ</button><button class="summary-add" id="fsnb-add" aria-label="Добавить из ФСНБ">+</button></div><button class="soft full" id="work-object-details">Подробнее об объекте</button></div>`;
    $("#coeff-placeholder").onclick=()=>openCoefficientManager(contextFromWorkFocus());
    $("#coeff-add").onclick=()=>openCoefficientModule(contextFromWorkFocus());
    $("#fsnb-placeholder").onclick=()=>openFsnbModule(contextFromWorkFocus());
    $("#fsnb-add").onclick=()=>openFsnbModule(contextFromWorkFocus());
    $("#work-object-details").onclick=openWorkDetails;
    window.VIKR_STRUCTURE_FEATURES.mountSummary($("#work-side"),workFeatureObject(),{type:f.type,value:f.id},workFeatureHost(),"work");
    function openWorkDetails(){modal(`<h2 id="dialog-title">Сведения об объекте</h2>${referenceHtml(work.info,work.name,false)}<div class="dialog-actions"><button class="outline" id="work-details-close">Закрыть</button><button class="primary" id="work-details-edit">Изменить</button></div>`,()=>{$("#work-details-close").onclick=closeModal;$("#work-details-edit").onclick=()=>editObjectInfo("work",openWorkDetails)});}
  }
  let integratedModule={kind:null,context:null};
  function contextFromWorkFocus(){const f=ui.workFocus||{type:"object",id:work.id},v=f.type==="vikr"?workItem():null;return {space:"work",type:f.type,id:f.id,positionIds:f.type==="vikr"&&ui.gesnSelection.size?[...ui.gesnSelection]:[],label:f.type==="object"?work.name:f.type==="vikr"?`${v?.code||""} · ${v?.name||"ВИКР"}`:f.type==="pool"?"ГЭСН без ВИКР":f.id}}
  function contextFromBaseDetail(){const n=ui.baseDetail||{type:"object",value:"all"},v=n.type==="vikr"?base.find(x=>x.id===n.value):null;return {space:"base",type:n.type,id:n.value,positionIds:[],label:n.type==="object"?baseInfo.title:n.type==="vikr"?`${v?.code||""} · ${v?.name||"ВИКР"}`:n.value}}
  function closeIntegratedModule(){const host=$("#module-host"),frame=$("#module-frame");host.classList.add("hidden");host.classList.remove("loading");frame.onload=null;frame.src="about:blank";integratedModule={kind:null,context:null}}
  function openIntegratedModule(kind,context){
    integratedModule={kind,context:{...context}};
    $("#module-host-title").textContent=kind==="fsnb"?"Нормативная база ФСНБ":"Поправочные коэффициенты ФСНБ";
    $("#module-host-context").textContent=`Добавление в ${context.space==="base"?"Базу ВИКР":"рабочий объект"}: ${context.label||"текущий уровень"}`;
    const frame=$("#module-frame"),host=$("#module-host"),source=kind==="fsnb"?"modules/fsnb/index.html":"modules/coefficients/index.html";
    host.classList.add("loading");host.classList.remove("hidden");
    frame.onload=()=>{if(integratedModule.kind===kind&&frame.getAttribute("src")===source){host.classList.remove("loading");sendCoefficientContext();if(kind==="fsnb")frame.contentWindow.postMessage({type:"vikr:fsnb-context",options:{resourcesOnly:context.resourcesOnly===true}},"*")}};
    frame.src=source;
  }
  function openFsnbModule(context){openIntegratedModule("fsnb",context)}
  function openCoefficientModule(context){openIntegratedModule("coefficients",context)}
  function handleIntegratedMessage(event){if(event.source!==$("#module-frame").contentWindow)return;const message=event.data||{},context=integratedModule.context;if(message.type==="vikr:module-close"){closeIntegratedModule();return}if(!context)return;if(message.type==="vikr:fsnb-select"){if(context.resourcesOnly){const items=(message.payload?.items||[]).filter(item=>item.type==="resource");if(!items.length){toast("Выберите ресурс из каталога ФСНБ");return}closeIntegratedModule();context.onResourceSelect?.(items.map(item=>convertFsnbResource(item)));return}closeIntegratedModule();openFsnbImportDialog(message.payload,context)}else if(message.type==="vikr:coefficient-select"){closeIntegratedModule();applyCoefficientPayload(message.payload,context)}}

  function allWorkPositions(){return [...work.vikrs.flatMap(v=>v.gesn||[]),...(work.loose||[])]}
  function allBasePositions(){return base.flatMap(v=>v.gesn||[])}
  function vikrsForContext(context){
    const source=context.space==="base"?base:work.vikrs;
    if(context.type==="object")return source;
    if(context.type==="vikr")return source.filter(v=>(context.space==="base"?v.id:v.uid)===context.id);
    if(context.type==="kr")return source.filter(v=>(v.kr||"Не распределено")===context.id||v.kr===context.id);
    if(context.type==="mark"){const [kr,mark]=String(context.id).split("|");return source.filter(v=>v.kr===kr&&(v.mark||"")===mark)}
    if(context.type==="package")return source.filter(v=>v.packageId===context.id);
    if(context.type==="unplaced")return source.filter(v=>!v.kr);
    return [];
  }
  function positionsForContext(context){
    if(context.positionDraft)return [context.positionDraft];
    if(context.positionIds?.length){const ids=new Set(context.positionIds);return (context.space==="base"?allBasePositions():allWorkPositions()).filter(p=>ids.has(p.id))}
    if(context.type==="pool")return work.loose||[];
    return vikrsForContext(context).flatMap(v=>v.gesn||[]);
  }
  function ensureCoefficientHolder(holder){if(holder&&!Array.isArray(holder.coefficients))holder.coefficients=[];return holder}
  function contextHolders(context){
    if(context.positionDraft)return [ensureCoefficientHolder(context.positionDraft)];
    if(context.positionIds?.length)return positionsForContext(context).map(ensureCoefficientHolder);
    if(context.space==="base"){
      if(context.type==="object")return [ensureCoefficientHolder(baseInfo.levels.object)];
      if(context.type==="kr"||context.type==="mark"){const key=levelKey(context.type,context.id);baseInfo.levels[key]||={name:context.id,unit:"",volume:null,note:""};return [ensureCoefficientHolder(baseInfo.levels[key])]}
      if(context.type==="vikr")return [ensureCoefficientHolder(base.find(v=>v.id===context.id))].filter(Boolean);
    }else{
      if(context.type==="object")return [ensureCoefficientHolder(work)];
      if(context.type==="kr"||context.type==="mark"){const key=context.type+":"+context.id;work.levelMeta[key]||={unit:"",volume:null,note:""};return [ensureCoefficientHolder(work.levelMeta[key])]}
      if(context.type==="vikr")return [ensureCoefficientHolder(work.vikrs.find(v=>v.uid===context.id))].filter(Boolean);
      if(context.type==="package")return [ensureCoefficientHolder(work.packages.find(v=>v.id===context.id))].filter(Boolean);
      if(context.type==="pool")return (work.loose||[]).map(ensureCoefficientHolder);
    }
    return [];
  }
  function canonicalNormCode(value){
    const raw=String(value||"").toLocaleUpperCase("ru-RU").replace(/Ё/g,"Е"),family=raw.match(/ГЭСН(?:МР|М|П|Р)?|ФЕР(?:МР|М|П|Р)?/)?.[0]||"",numeric=raw.match(/\d{2}(?:-\d{2,3}){2,4}/)?.[0]||"";
    return {family,numeric,full:[family,numeric].filter(Boolean).join(" ")};
  }
  function normalizedPositionCode(position){return canonicalNormCode(`${position.base||""} ${position.code||""}`)}
  function coefficientMatchesPosition(coefficient,position){
    if(coefficient.application?.appliesToAll)return true;
    const target=normalizedPositionCode(position);
    const direct=(coefficient.application?.directCosts||[]).some(value=>{const item=canonicalNormCode(value);return item.numeric&&item.numeric===target.numeric&&(!item.family||!target.family||item.family===target.family)});
    const section=(coefficient.application?.sections||[]).some(value=>{const [prefix,...parts]=String(value).split("-"),families={"02":"ГЭСН","03":"ГЭСНМ","04":"ГЭСНР","05":"ГЭСНП","06":"ГЭСНМР"},family=families[prefix],selector=family?parts.join("-"):canonicalNormCode(value).numeric;return selector&&(!family||!target.family||family===target.family)&&(target.numeric===selector||target.numeric.startsWith(selector+"-"))});
    return direct||section;
  }
  function saveCoefficientChanges(context){if(context.positionDraft){context.onCoefficientChange?.();return}if(context.space==="base"){persistBase();persistBaseInfo();renderBase()}else{queueWorkSave();renderWork()}}
  function applyCoefficientPayload(payload,context){
    const items=(payload.items||[]).map(item=>({...clone(item),assignmentId:uid(),assignedAt:new Date().toISOString(),assignedTo:context.label||context.type}));
    if(!items.length){toast("Коэффициенты не выбраны");return}
    const general=items.every(item=>item.application?.appliesToAll),explicit=context.positionIds?.length>0;
    if(general||explicit){const holders=contextHolders(context);let added=0;for(const holder of holders)for(const item of items)if(!explicit||coefficientMatchesPosition(item,holder)){holder.coefficients.push(clone(item));added++}if(!added){toast("Для выбранной ГЭСН нет применимых коэффициентов");return}saveCoefficientChanges(context);toast(`Добавлено коэффициентов: ${added}`);if(!context.positionDraft)openCoefficientManager(context);return}
    const positions=positionsForContext(context);let matched=0;
    for(const position of positions)for(const item of items)if(coefficientMatchesPosition(item,position)){ensureCoefficientHolder(position).coefficients.push(clone(item));matched++}
    if(!matched){toast("На выбранном уровне нет позиций, подходящих под правила XML");return}
    saveCoefficientChanges(context);toast(`Коэффициенты назначены: ${matched} связей`);openCoefficientManager(context);
  }
  function factorBadges(item){const labels={labor:"Рабочие",machinistLabor:"Машинисты",machine:"Машины",material:"Материалы"};return Object.entries(item.components||{}).filter(([,value])=>Number.isFinite(Number(value.factor))).map(([key,value])=>`<span>${esc(labels[key]||key)} × ${num(value.factor)}</span>`).join("")}
  function coefficientsVisibleAt(context){
    const rows=[];
    const add=(label,holder,own=false)=>{for(const item of holder?.coefficients||[])rows.push({label,item,holder,own})};
    if(context.space==="base"){
      add("Объект",baseInfo.levels.object,context.type==="object");
      if(context.type!=="object"){const v=context.type==="vikr"?base.find(x=>x.id===context.id):null,kr=context.type==="kr"?context.id:context.type==="mark"?context.id.split("|")[0]:v?.kr,mark=context.type==="mark"?context.id:v?`${v.kr}|${v.mark||""}`:null;if(kr)add("Конструктив",baseInfo.levels["kr:"+kr],context.type==="kr");if(mark)add("Марка",baseInfo.levels["mark:"+mark],context.type==="mark");if(v)add("ВИКР",v,context.type==="vikr")}
    }else{
      add("Объект",work,context.type==="object");
      const v=context.type==="vikr"?work.vikrs.find(x=>x.uid===context.id):null,kr=context.type==="kr"?context.id:context.type==="mark"?context.id.split("|")[0]:v?.kr,mark=context.type==="mark"?context.id:v&&v.mark?`${v.kr}|${v.mark}`:null;if(kr)add("Конструктив",work.levelMeta["kr:"+kr],context.type==="kr");if(mark)add("Марка",work.levelMeta["mark:"+mark],context.type==="mark");if(v){const pack=packageFor(v);if(pack)add("Комплект",pack,context.type==="package");add("ВИКР",v,context.type==="vikr")}
    }
    const holders=contextHolders(context);if(context.positionIds?.length||context.type==="pool")for(const holder of holders)add("ГЭСН",holder,true);
    const descendant=positionsForContext(context).flatMap(p=>(p.coefficients||[]).map(item=>({label:`ГЭСН ${p.code}`,item,holder:p,own:context.positionIds?.includes(p.id)||context.type==="pool"})));
    if(!context.positionIds?.length&&context.type!=="pool")rows.push(...descendant);
    return rows;
  }
  function openCoefficientManager(context){
    if(!context.positionDraft&&['object','kr','mark','vikr','package'].includes(context.type)){
      const objects=context.space==='base'?baseObjects:[workFeatureObject()],objectId=context.space==='base'?activeBaseId:work.id;
      const nodes=context.positionIds?.length?context.positionIds.map(id=>({objectId,type:'gesn',value:id})):[{objectId,type:context.type,value:context.id||'all'}];
      return window.VIKR_STRUCTURE_FEATURES.showCoefficients(objects,nodes,context.space==='base'?baseFeatureHost():workFeatureHost(),{overview:context.type==='object'&&!context.positionIds?.length});
    }
    const rows=coefficientsVisibleAt(context),ownRows=rows.filter(row=>row.own);
    modal(`<h2 id="dialog-title">Коэффициенты: ${esc(context.label||"текущий уровень")}</h2><p>Коэффициенты рассчитываются последовательно сверху вниз. Исходные нормативы ресурсов не изменяются.</p><div class="coefficient-chain-note">Объект → конструктив → марка → комплект → ВИКР → ГЭСН → ресурс. Коэффициенты одного уровня применяются в показанном порядке.</div><div class="coefficient-list">${rows.map((row,index)=>`<div class="coefficient-card"><div><small>${esc(row.label)} · шаг ${index+1}</small><strong>${esc(row.item.code)} · ${esc(row.item.name)}</strong><div class="coefficient-factors">${factorBadges(row.item)}</div></div>${row.own?`<div class="row-actions"><button class="quiet coeff-up" data-id="${esc(row.item.assignmentId||row.item.code)}" title="Выше">↑</button><button class="quiet coeff-down" data-id="${esc(row.item.assignmentId||row.item.code)}" title="Ниже">↓</button><button class="icon-delete coeff-remove" data-id="${esc(row.item.assignmentId||row.item.code)}" aria-label="Удалить коэффициент">${trashIcon}</button></div>`:""}</div>`).join("")||'<div class="empty">На этом уровне и ниже коэффициенты пока не назначены.</div>'}</div><div class="dialog-actions"><button class="outline" id="coeff-close">Закрыть</button><button class="outline" id="coeff-add-custom">+ Свой коэффициент</button><button class="primary" id="coeff-add-here">+ Добавить коэффициент</button></div>`,()=>{
      $("#coeff-add-custom").onclick=()=>{closeModal();openCoefficientModule({...context,createCustom:true})};$("#coeff-close").onclick=closeModal;$("#coeff-add-here").onclick=()=>{closeModal();openCoefficientModule(context)};
      const findOwn=id=>ownRows.find(row=>(row.item.assignmentId||row.item.code)===id);
      document.querySelectorAll(".coeff-remove").forEach(button=>button.onclick=()=>{const row=findOwn(button.dataset.id);if(!row)return;row.holder.coefficients=row.holder.coefficients.filter(item=>(item.assignmentId||item.code)!==button.dataset.id);saveCoefficientChanges(context);openCoefficientManager(context)});
      const move=(id,delta)=>{const row=findOwn(id);if(!row)return;const list=row.holder.coefficients,index=list.findIndex(item=>(item.assignmentId||item.code)===id),next=index+delta;if(index<0||next<0||next>=list.length)return;[list[index],list[next]]=[list[next],list[index]];saveCoefficientChanges(context);openCoefficientManager(context)};
      document.querySelectorAll(".coeff-up").forEach(button=>button.onclick=()=>move(button.dataset.id,-1));document.querySelectorAll(".coeff-down").forEach(button=>button.onclick=()=>move(button.dataset.id,1));
    },true)
  }

  function fsnbResourceKind(resource){const kind=resource.kind||resource.resource?.kind,category=resource.category||resource.catalogCategory||resource.resource?.catalogCategory;if(kind==="labor"||kind==="laborDetail")return "workers";if(kind==="machinist")return "drivers";if(kind==="machine"||category==="МашиныМеханизмы")return "machines";return "materials"}
  function convertFsnbResource(source){const resource=source.resource||source;return {id:uid(),source:"ФСНБ-2022",code:resource.code||"Без кода",name:resource.name||"Ресурс ФСНБ",kind:fsnbResourceKind(source),unit:resource.unit||"шт.",qty:Number(resource.qty??1)||0,price:resource.price||null,catalogCategory:resource.category||resource.catalogCategory||null}}
  function convertFsnbNorm(item){return {id:uid(),sourceId:item.key,source:"ФСНБ-2022",base:item.base||"ГЭСН",code:fsnbFullCode(item.code,item.base),name:item.name,unit:item.unit||"шт.",qty:1,path:clone(item.path||[]),works:clone(item.works||[]),reasons:clone(item.reasons||[]),resources:(item.resources||[]).map(convertFsnbResource)}}
  function createImportedWorkVikr(positions,fields){const volume=Number(fields.volume)||1,v={uid:uid(),id:"fsnb-"+uid(),code:fields.code||positions[0]?.code||"ФСНБ",name:fields.name||positions[0]?.name||"Позиции ФСНБ",kr:fields.kr||"",mark:fields.mark||"",unit:fields.unit||positions[0]?.unit||"шт.",volume,baseVolume:volume,mode:"fsnb",gesn:positions,coefficients:[],note:"Создано из нормативной базы ФСНБ-2022"};work.vikrs.push(v);ensureStructure(v.kr,v.mark);return v}
  function createImportedBaseVikr(positions,fields){const volume=Number(fields.volume)||1,v={id:"fsnb-"+uid(),code:fields.code||positions[0]?.code||"ФСНБ",name:fields.name||positions[0]?.name||"Позиции ФСНБ",kr:fields.kr||"Не распределено",mark:fields.mark||"Без марки",unit:fields.unit||positions[0]?.unit||"шт.",volume,gesn:positions,coefficients:[],note:"Создано из нормативной базы ФСНБ-2022"};base.push(v);return v}
  function fsnbPositionOptions(space){const rows=[];(space==="base"?base:work.vikrs).forEach(v=>(v.gesn||[]).forEach(p=>rows.push({value:(space==="base"?"b:":"w:")+(space==="base"?v.id:v.uid)+":"+p.id,label:`${p.code} · ${p.name}`})));if(space==="work")for(const p of work.loose||[])rows.push({value:"l:"+p.id,label:`Без ВИКР · ${p.code} · ${p.name}`});return rows}
  function findPositionByOption(value){const parts=String(value).split(":"),space=parts.shift(),owner=parts.shift(),id=parts.join(":");if(space==="l")return work.loose.find(p=>p.id===owner);const list=space==="b"?base:work.vikrs,target=list.find(v=>(space==="b"?v.id:v.uid)===owner);return target?.gesn.find(p=>p.id===id)}
  function openFsnbImportDialog(payload,context){
    const norms=(payload.items||[]).filter(item=>item.type==="norm").map(convertFsnbNorm),resources=(payload.items||[]).filter(item=>item.type!=="norm").map(convertFsnbResource);
    if(!norms.length&&!resources.length){toast("В ФСНБ ничего не выбрано");return}
    const isWork=context.space==="work",directVikr=context.type==="vikr"?vikrsForContext(context)[0]:null,destinations=[];
    if(directVikr)destinations.push({value:(isWork?"work:":"base:")+(isWork?directVikr.uid:directVikr.id),label:`Текущий ВИКР: ${directVikr.code} · ${directVikr.name}`});
    else if(isWork){destinations.push({value:"work:loose",label:"Самостоятельные позиции (без ВИКР)"},...work.vikrs.map(v=>({value:"work:"+v.uid,label:`Существующий ВИКР: ${v.code} · ${v.name}`})),{value:"work:new",label:"Создать новый ВИКР"})}
    else destinations.push(...base.map(v=>({value:"base:"+v.id,label:`Существующий ВИКР: ${v.code} · ${v.name}`})),{value:"base:new",label:"Создать новый элемент Базы ВИКР"});
    const positionOptions=fsnbPositionOptions(context.space),first=norms[0];
    modal(`<h2 id="dialog-title">Добавление из ФСНБ</h2><p>Выбрано нормативов: ${norms.length}; отдельных ресурсов: ${resources.length}. Норматив переносится вместе со всеми ресурсами и их расходом.</p>${norms.length?`<label class="field"><span>Куда добавить позиции</span><select id="fsnb-destination">${destinations.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("")}</select></label><div class="dialog-grid" id="fsnb-new-fields"><label class="field"><span>Код нового ВИКР</span><input id="fsnb-new-code" value="${esc(first?.code||"ФСНБ")}"></label><label class="field"><span>Единица</span><input id="fsnb-new-unit" value="${esc(first?.unit||"шт.")}"></label><label class="field wide"><span>Наименование</span><input id="fsnb-new-name" value="${esc(first?.name||"Позиции ФСНБ")}"></label><label class="field"><span>Объём</span><input id="fsnb-new-volume" type="number" min="0" step="any" value="1"></label><label class="field"><span>Конструктив</span><input id="fsnb-new-kr"></label><label class="field"><span>Марка</span><input id="fsnb-new-mark"></label></div>`:""}${resources.length?`<label class="field"><span>Куда добавить отдельные ресурсы</span><select id="fsnb-resource-target">${norms.length?'<option value="imported">В первую добавляемую позицию</option>':''}${positionOptions.map(item=>`<option value="${esc(item.value)}">${esc(item.label)}</option>`).join("")}</select></label>`:""}<div class="dialog-actions"><button class="outline" id="fsnb-import-cancel">Отмена</button><button class="primary" id="fsnb-import-confirm">Добавить</button></div>`,()=>{
      const fields=$("#fsnb-new-fields"),destination=$("#fsnb-destination");const toggle=()=>{if(fields)fields.classList.toggle("hidden",!destination?.value.endsWith(":new"))};destination?.addEventListener("change",toggle);toggle();
      $("#fsnb-import-cancel").onclick=closeModal;$("#fsnb-import-confirm").onclick=()=>{let importedFirst=null,targetVikr=null;
        if(norms.length){const value=destination.value,[space,id]=value.split(":");if(id==="loose"){work.loose.push(...norms);importedFirst=norms[0];ui.workFocus={type:"pool",id:"pool"}}else if(id==="new"){const fieldsValue={code:$("#fsnb-new-code").value.trim(),name:$("#fsnb-new-name").value.trim(),unit:$("#fsnb-new-unit").value.trim(),volume:$("#fsnb-new-volume").value,kr:$("#fsnb-new-kr").value.trim(),mark:$("#fsnb-new-mark").value.trim()};targetVikr=space==="work"?createImportedWorkVikr(norms,fieldsValue):createImportedBaseVikr(norms,fieldsValue);importedFirst=norms[0];if(space==="work")ui.workFocus={type:"vikr",id:targetVikr.uid};else{ui.activeNode={type:"vikr",value:targetVikr.id};ui.baseDetail={...ui.activeNode}}}else{targetVikr=(space==="work"?work.vikrs:base).find(v=>(space==="work"?v.uid:v.id)===id);targetVikr?.gesn.push(...norms);importedFirst=norms[0]}}
        if(resources.length){const resourceTarget=$("#fsnb-resource-target").value==="imported"?importedFirst:findPositionByOption($("#fsnb-resource-target").value);if(resourceTarget)resourceTarget.resources.push(...resources)}
        if(context.space==="base")persistBase();else{work.present=true;queueWorkSave()}closeModal();renderAll();toast(`Из ФСНБ добавлено: ${norms.length} позиций, ${resources.length} ресурсов`)
      }
    },true)
  }
  function linkLooseToExisting(){const positions=work.loose.filter(p=>ui.poolSelection.has(p.id));if(!positions.length){toast("Сначала выберите ГЭСН");return}if(!work.vikrs.length){toast("В рабочем объекте пока нет ВИКР");return}modal(`<h2 id="dialog-title">Привязать ГЭСН к существующему ВИКР</h2><p>Выбрано позиций: ${positions.length}. Позиции перестанут быть самостоятельными и войдут в состав выбранного ВИКР.</p><div class="link-vikr-grid">${work.vikrs.map(v=>`<label><input type="radio" name="link-vikr" value="${esc(v.uid)}"><span><strong>${esc(v.code)} · ${esc(v.name)}</strong><small>${esc(v.kr||"Без места")} → ${esc(v.mark||"Без марки")}</small></span></label>`).join("")}</div><div class="dialog-actions"><button class="outline" id="link-cancel">Отмена</button><button class="primary" id="link-confirm" disabled>Привязать</button></div>`,()=>{$("#link-cancel").onclick=closeModal;document.querySelectorAll('[name="link-vikr"]').forEach(input=>input.onchange=()=>$("#link-confirm").disabled=false);$("#link-confirm").onclick=()=>{const id=document.querySelector('[name="link-vikr"]:checked')?.value,v=work.vikrs.find(item=>item.uid===id);if(!v)return;const ids=new Set(positions.map(p=>p.id));v.gesn.push(...positions);work.loose=work.loose.filter(p=>!ids.has(p.id));ui.poolSelection.clear();ui.workFocus={type:"vikr",id:v.uid};closeModal();renderWork();toast("ГЭСН привязаны к существующему ВИКР")}},true)}
  function enhancePoolIntegration(){const create=$("#create-from-pool");if(!create||$("#link-pool-existing"))return;create.insertAdjacentHTML("afterend",'<button class="soft" id="link-pool-existing">Привязать к существующему ВИКР</button>');$("#link-pool-existing").onclick=linkLooseToExisting;const add=$("#pool-add");if(add){add.textContent="+ Из ФСНБ";add.onclick=()=>openFsnbModule({space:"work",type:"pool",id:"pool",positionIds:[],label:"самостоятельные позиции"})}}
  function enhanceWorkVikrIntegration(v,root){const add=$(root+" #add-gesn-base");if(add){add.textContent="+ Из ФСНБ";add.onclick=()=>openFsnbModule({space:"work",type:"vikr",id:v.uid,positionIds:[],label:`${v.code} · ${v.name}`})}const own=$(root+" #add-gesn-own");if(own&&!$(root+" #add-vikr-coefficient")){own.insertAdjacentHTML("beforebegin",'<button class="quiet" id="add-vikr-coefficient">+ Коэффициент</button>');$(root+" #add-vikr-coefficient").onclick=()=>openCoefficientModule({space:"work",type:"vikr",id:v.uid,positionIds:[...ui.gesnSelection],label:ui.gesnSelection.size?`выбранные ГЭСН (${ui.gesnSelection.size})`:`${v.code} · ${v.name}`})}}
  function enhanceBaseSummaryIntegration(context){const detail=$("#base-detail .base-summary"),more=$("#base-object-details");if(!detail||!more)return;more.insertAdjacentHTML("beforebegin",'<div class="summary-action-row"><button class="summary-action" id="base-coefficients">Коэффициенты</button><button class="summary-add" id="base-coefficients-add" aria-label="Добавить коэффициент">+</button></div><div class="summary-action-row"><button class="summary-action" id="base-fsnb">ФСНБ</button><button class="summary-add" id="base-fsnb-add" aria-label="Добавить из ФСНБ">+</button></div>');const ctx={space:"base",type:context.type,id:context.value,positionIds:[],label:context.type==="object"?baseInfo.title:context.value};$("#base-coefficients").onclick=()=>openCoefficientManager(ctx);$("#base-coefficients-add").onclick=()=>openCoefficientModule(ctx);$("#base-fsnb").onclick=()=>openFsnbModule(ctx);$("#base-fsnb-add").onclick=()=>openFsnbModule(ctx)}
  function placeholder(title,text){modal(`<h2 id="dialog-title">${esc(title)}</h2>${text?`<p>${esc(text)}</p>`:""}<div class="dialog-actions"><button class="primary" id="close-info">Понятно</button></div>`,()=>{$("#close-info").onclick=closeModal})}
  function showMaterials(v){const factor=C.workFactor(v,work.packages),items=C.materials(v,factor,workCoefficientChain(v));modal(`<h2 id="dialog-title">Материалы ВИКР ${esc(v.code)}</h2><p>Количество каждого материала собрано из дочерних ГЭСН с учётом последовательной цепочки коэффициентов.</p><table class="small-table"><thead><tr><th>Код</th><th>Материал</th><th class="right">Количество</th></tr></thead><tbody>${items.map(r=>`<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="right">${quantityMarkup(num(r.qty),r.unit)}</td></tr>`).join("")||'<tr><td colspan="3">Материалов нет</td></tr>'}</tbody></table><div class="dialog-actions"><button class="primary" id="close-info">Закрыть</button></div>`,()=>{$("#close-info").onclick=closeModal})}
  function openPlace(v){modal(`<h2 id="dialog-title">Связи ВИКР</h2><p>Можно оставить ВИКР без места и создать структуру позже.</p><div class="dialog-grid"><label class="field"><span>Конструктив</span><input id="place-kr" value="${esc(v.kr)}" placeholder="Можно оставить пустым"></label><label class="field"><span>Марка</span><input id="place-mark" value="${esc(v.mark)}" placeholder="Можно оставить пустой"></label></div><div class="dialog-actions dialog-actions-split"><button class="outline" id="back-place">Назад</button><div><button class="outline" id="cancel-dialog">Отменить</button><button class="primary" id="save-place">Сохранить связи</button></div></div>`,()=>{$("#back-place").onclick=()=>editWorkVikr(v);$("#cancel-dialog").onclick=closeModal;$("#save-place").onclick=()=>{v.kr=$("#place-kr").value.trim();v.mark=$("#place-mark").value.trim();ensureStructure(v.kr,v.mark);closeModal();renderWork()}})}
  function addStructure(){modal(`<h2 id="dialog-title">Добавить уровень структуры</h2><p>Конструктив и марку можно создать без ВИКР.</p><div class="dialog-grid"><label class="field"><span>Конструктив</span><input id="new-kr" placeholder="Например, ВЛ"></label><label class="field"><span>Марка, необязательно</span><input id="new-mark" placeholder="Например, АС"></label></div><div class="dialog-actions"><button class="outline" id="cancel-dialog">Отмена</button><button class="primary" id="save-structure">Добавить</button></div>`,()=>{$("#cancel-dialog").onclick=closeModal;$("#save-structure").onclick=()=>{const kr=$("#new-kr").value.trim(),mark=$("#new-mark").value.trim();if(!kr){toast("Укажите конструктив");return}ensureStructure(kr,mark);ui.workFocus={type:mark?"mark":"kr",id:mark?kr+"|"+mark:kr};closeModal();renderWork()}})}
  function openCreateVikr(positions=[]){const f=ui.workFocus;let kr="",mark="";if(f.type==="mark")[kr,mark]=f.id.split("|");else if(f.type==="kr")kr=f.id;else if(f.type==="vikr"){const v=workItem();kr=v?.kr||"";mark=v?.mark||""}modal(`<h2 id="dialog-title">${positions.length?'Создать ВИКР из ГЭСН':'Создать ВИКР'}</h2><p>${positions.length?`${positions.length} выбранных ГЭСН и их ресурсы войдут в новый ВИКР.`:'Можно создать ВИКР без ГЭСН и добавить состав позже.'}</p><div class="dialog-grid"><label class="field"><span>Код</span><input id="new-v-code" placeholder="Можно указать позже"></label><label class="field"><span>Единица</span><select id="new-v-unit"><option>м³</option><option>м</option><option>км</option><option>т</option><option>шт.</option><option>комплект</option></select></label><label class="field wide"><span>Наименование</span><input id="new-v-name" placeholder="Например, разработка грунта"></label><label class="field"><span>Объём</span><input id="new-v-volume" type="number" min="0" step="any" value="1"></label><label class="field"><span>Конструктив</span><input id="new-v-kr" value="${esc(kr)}" placeholder="Можно оставить пустым"></label><label class="field"><span>Марка</span><input id="new-v-mark" value="${esc(mark)}" placeholder="Можно оставить пустой"></label></div><div class="dialog-actions"><button class="outline" id="cancel-dialog">Отмена</button><button class="primary" id="save-vikr">Создать</button></div>`,()=>{$("#cancel-dialog").onclick=closeModal;$("#save-vikr").onclick=()=>{const name=$("#new-v-name").value.trim(),volume=Number($("#new-v-volume").value);if(!name||!Number.isFinite(volume)||volume<0){toast("Укажите название и объём");return}const v={uid:uid(),id:"manual-"+uid(),code:$("#new-v-code").value.trim()||"Новый",name,kr:$("#new-v-kr").value.trim(),mark:$("#new-v-mark").value.trim(),unit:$("#new-v-unit").value,volume,baseVolume:volume||1,mode:"manual",gesn:positions.map(p=>clone(p)),note:"Создано вручную"};v.gesn.forEach(p=>p.id=uid());work.vikrs.push(v);ensureStructure(v.kr,v.mark);if(positions.length){const ids=new Set(positions.map(p=>p.id));work.loose=work.loose.filter(p=>!ids.has(p.id));ui.poolSelection.clear()}ui.workFocus={type:"vikr",id:v.uid};closeModal();renderWork();toast("ВИКР создан с выбранным составом")}})}
  function groupSelectedPositions(v){const ids=new Set(ui.gesnSelection);if(!ids.size){toast("Выберите ГЭСН в составе ВИКР");return}const positions=v.gesn.filter(p=>ids.has(p.id)).map(p=>clone(p));v.gesn=v.gesn.filter(p=>!ids.has(p.id));work.loose.push(...positions);ui.gesnSelection.clear();ui.workFocus={type:"pool",id:"pool"};ui.poolSelection=new Set(positions.map(p=>p.id));renderWork();toast("ГЭСН перенесены в подборку — создайте из них новый ВИКР")}
  function openGesnPicker(target){const options=base.flatMap(v=>v.gesn.map(p=>({v,p})));modal(`<h2 id="dialog-title">Добавить ГЭСН из Базы</h2><p>Выберите расценку: она переносится вместе с дочерними ресурсами. ФСНБ будет подключена позже.</p><label class="field"><span>Поиск по коду или названию</span><input id="gesn-search" placeholder="Например, уплотнение"></label><div class="checklist" id="gesn-options" style="margin-top:12px"></div><div class="dialog-actions"><button class="outline" id="cancel-dialog">Отмена</button><button class="primary" id="confirm-gesn" disabled>Добавить</button></div>`,()=>{let chosen=null;const draw=()=>{$("#gesn-options").innerHTML=options.map((o,i)=>({o,i})).filter(({o})=>(o.p.code+" "+o.p.name).toLowerCase().includes($("#gesn-search").value.toLowerCase())).map(({o,i})=>`<label><input type="radio" name="gesn-choice" value="${i}"><span>${esc(o.p.code)} · ${esc(o.p.name)}<small>Источник: ${esc(o.v.code)} · ${num(o.p.qty)} ${esc(o.p.unit)} · ${o.p.resources.length} ресурсов</small></span></label>`).join("")||'<div class="empty">Нет совпадений</div>';$("#gesn-options").querySelectorAll("input").forEach(x=>x.onchange=()=>{chosen=Number(x.value);$("#confirm-gesn").disabled=false})};$("#gesn-search").oninput=draw;draw();$("#cancel-dialog").onclick=closeModal;$("#confirm-gesn").onclick=()=>{if(chosen==null)return;const source=options[chosen],p=clone(source.p);p.id=uid();p.sourceId=source.p.id;if(target){const ratio=source.v.volume>0?target.baseVolume/source.v.volume:1;p.qty*=ratio;p.resources.forEach(r=>r.qty*=ratio);target.gesn.push(p)}else work.loose.push(p);closeModal();renderWork();toast("ГЭСН добавлена с ресурсами")}})}
  function openOwnGesn(target){modal(`<h2 id="dialog-title">Добавить свою ГЭСН</h2><p>После создания можно добавить и изменить ресурсы.</p><div class="dialog-grid"><label class="field"><span>Код</span><input id="own-code" placeholder="Например, Расчёт 01"></label><label class="field"><span>Единица</span><input id="own-unit" value="м³"></label><label class="field wide"><span>Наименование</span><input id="own-name" placeholder="Описание работы"></label><label class="field"><span>Количество на базовый объём ВИКР</span><input id="own-qty" type="number" step="any" value="1"></label></div><div class="dialog-actions"><button class="outline" id="cancel-dialog">Отмена</button><button class="primary" id="save-own">Добавить</button></div>`,()=>{$("#cancel-dialog").onclick=closeModal;$("#save-own").onclick=()=>{const name=$("#own-name").value.trim(),qty=Number($("#own-qty").value);if(!name||!Number.isFinite(qty)){toast("Укажите название и количество");return}target.gesn.push({id:uid(),code:$("#own-code").value.trim()||"Собственная",name,unit:$("#own-unit").value.trim()||"шт.",qty,resources:[]});closeModal();renderWork();toast("Позиция добавлена")}})}
  function editWorkPosition(v,id){editAnyPosition(v.gesn,id,"work",()=>renderWork())}
  function confirmDelete(label,details,onDelete,onNo=closeModal){modal(`<h2 id="dialog-title">Подтвердить?</h2><p class="delete-target">${esc(label)}</p><p>${esc(details)}</p><div class="dialog-actions"><button class="outline" id="cancel-delete">Нет</button><button class="danger-btn" id="confirm-delete">Да</button></div>`,()=>{$("#cancel-delete").onclick=onNo;$("#confirm-delete").onclick=()=>{onDelete();closeModal();renderAll();toast("Элемент удалён")}})}

  function editAnyPosition(positions,id,origin,onDone){
    const original=positions.find(p=>p.id===id);if(!original)return;
    const draft=clone(original);
    const kinds=[['workers','Рабочие'],['drivers','Машинисты'],['machines','Механизм'],['materials','Материал']];
    const row=(r,i)=>`<div class="resource-editor-row" data-ri="${i}"><input type="checkbox" class="resource-pick" aria-label="Выбрать ресурс ${esc(r.name)}"><label class="field"><span>Код</span><input class="res-code" value="${esc(r.code)}"></label><label class="field res-name-field"><span>Наименование</span><input class="res-name" value="${esc(r.name)}"></label><label class="field"><span>Тип</span><select class="res-kind">${kinds.map(([value,label])=>`<option value="${value}" ${r.kind===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>Ед.</span><input class="res-unit" value="${esc(r.unit)}"></label><label class="field"><span>Количество</span><input class="res-qty" type="number" step="any" ${origin==='base'?'readonly title="Количество пересчитывается при изменении объёма ГЭСН"':''} value="${r.qty}"></label></div>`;
    modal(`<h2 id="dialog-title">Изменить ГЭСН и ресурсы</h2><p>Изменения относятся к ${origin==='base'?'записи Базы':'рабочему объекту'}. ${origin==='base'?'Количество ресурсов пересчитывается пропорционально объёму ГЭСН. Ручное изменение количества ресурсов недоступно.':'Количество ресурсов при изменении объёма ГЭСН пересчитается, если вы не задали его вручную.'}</p><div class="dialog-grid"><label class="field"><span>Код</span><input id="pos-code" value="${esc(draft.code)}"></label><label class="field"><span>Единица</span><input id="pos-unit" value="${esc(draft.unit)}"></label><label class="field wide"><span>Наименование</span><input id="pos-name" value="${esc(draft.name)}"></label><label class="field"><span>Количество</span><input id="pos-qty" type="number" step="any" value="${draft.qty}"></label>${!(Number(draft.qty)>0)&&draft.resources.some(r=>Number(r.qty))?`<label class="field"><span>Исходный объём существующего состава</span><input id="pos-reference" type="number" step="any" min="0" placeholder="Положительное число"></label>`:""}</div><div class="summary-action-row position-coefficient-row"><button class="summary-action" id="position-coefficients">Коэффициент</button><button class="summary-add" id="position-coefficients-add" aria-label="Добавить коэффициент к ГЭСН">+</button></div><div id="position-coefficient-list" class="coefficient-list hidden"></div><div class="section-head"><h3>Ресурсы ГЭСН</h3><div class="stack-actions"><label class="select-all-row"><input type="checkbox" id="resource-select-all"> Выбрать все</label><button class="quiet" id="remove-picked-resources">Убрать выбранные</button><button class="quiet" id="add-resource">+ Ресурс</button></div></div><div id="resource-editor">${draft.resources.map(row).join('')}</div><div class="dialog-actions dialog-actions-split"><div>${origin==='base'?'':`<button class="outline" id="toggle-position">${original.excluded?'Включить в расчёт':'Исключить из расчёта'}</button>`}<button class="icon-delete danger-icon" id="remove-position" aria-label="Удалить ГЭСН" title="Удалить ГЭСН">${trashIcon}</button></div><div><button class="outline" id="cancel-position">Отменить</button><button class="primary" id="save-position">Сохранить ГЭСН</button></div></div>`,()=>{
      const wireResourceSelection=()=>{const all=$("#resource-select-all"),boxes=[...document.querySelectorAll("#resource-editor .resource-pick")];all.checked=boxes.length>0&&boxes.every(x=>x.checked);all.indeterminate=!all.checked&&boxes.some(x=>x.checked);all.onchange=()=>boxes.forEach(x=>x.checked=all.checked);boxes.forEach(x=>x.onchange=()=>{all.checked=boxes.length>0&&boxes.every(y=>y.checked);all.indeterminate=!all.checked&&boxes.some(y=>y.checked)})};
      const addedResourceIds=new Set();
      const appendResources=items=>{for(const r of items){addedResourceIds.add(r.id);const i=draft.resources.length;draft.resources.push(r);$("#resource-editor").insertAdjacentHTML("beforeend",row(r,i))}wireResourceSelection()};
      $("#add-resource").insertAdjacentHTML("afterend",'<div id="resource-source-choice" class="resource-source-choice hidden"><span>Добавить ресурс</span><button class="outline" id="resource-own">Свой ресурс</button><button class="primary" id="resource-fsnb">Из базы ФСНБ</button><button class="quiet" id="resource-source-cancel" aria-label="Закрыть выбор источника">×</button></div>');
      const closeResourceChoice=()=>$("#resource-source-choice").classList.add("hidden");
      $("#add-resource").onclick=()=>$("#resource-source-choice").classList.toggle("hidden");
      $("#resource-source-cancel").onclick=closeResourceChoice;
      $("#resource-own").onclick=()=>{closeResourceChoice();appendResources([{id:uid(),code:"",name:"",kind:"materials",unit:"шт.",qty:0}]);$("#resource-editor .resource-editor-row:last-child .res-name").focus()};
      $("#resource-fsnb").onclick=()=>{closeResourceChoice();openFsnbModule({space:origin,resourcesOnly:true,label:$("#pos-code").value+" · "+$("#pos-name").value,onResourceSelect:items=>{appendResources(items);toast("Ресурсы добавлены в редактируемую ГЭСН. Сохраните изменения.")}})};
      $("#remove-picked-resources").onclick=()=>{document.querySelectorAll("#resource-editor .resource-pick:checked").forEach(x=>x.closest(".resource-editor-row").remove());wireResourceSelection()};
      wireResourceSelection();
      wirePositionCoefficients(draft,origin);$("#cancel-position").onclick=closeModal;
      const object=origin==='base'?baseObjects.find(o=>o.id===activeBaseId):workFeatureObject(),inherited=window.VIKR_STRUCTURE_FEATURES.coefficientRows([object],[{objectId:object.id,type:'gesn',value:draft.id}]).filter(r=>r.relation==='Унаследован сверху');if(inherited.length)$('#position-coefficients').closest('.position-coefficient-row').insertAdjacentHTML('beforebegin',`<div class="burger-coefficients"><strong>Унаследованы сверху · ${inherited.length}</strong>${window.VIKR_STRUCTURE_FEATURES.coefficientPreview(inherited)}<small class="subtle">Уже учитываются в расчёте ресурсов. Изменить можно на уровне назначения через «Коэффициенты объекта».</small></div>`);
      $("#save-position").onclick=()=>{const qty=Number($("#pos-qty").value),name=$("#pos-name").value.trim();if(!name||!Number.isFinite(qty)||qty<0){toast("Проверьте наименование и количество");return}const reference=$("#pos-reference");if(reference&&!(Number(reference.value)>0)){toast("Укажите положительный исходный объём состава");return}draft.code=$("#pos-code").value.trim()||"Без кода";draft.name=name;draft.unit=$("#pos-unit").value.trim()||"шт.";const oldQty=reference?Number(reference.value):draft.qty;draft.qty=qty;draft.resources=[...document.querySelectorAll("#resource-editor .resource-editor-row")].map(el=>{const previous=draft.resources[Number(el.dataset.ri)]||{qty:0};const entered=origin==='base'?Number(previous.qty):Number(el.querySelector(".res-qty").value);return {...previous,code:el.querySelector(".res-code").value.trim(),name:el.querySelector(".res-name").value.trim()||"Без наименования",kind:el.querySelector(".res-kind").value,unit:el.querySelector(".res-unit").value.trim()||"шт.",qty:!addedResourceIds.has(previous.id)&&entered===previous.qty&&oldQty?entered*qty/oldQty:entered}});Object.assign(original,draft);closeModal();onDone?.();toast("ГЭСН обновлена")};
      if(origin!=='base')$("#toggle-position").onclick=()=>{original.excluded=!original.excluded;closeModal();onDone?.();toast(original.excluded?"ГЭСН исключена из расчёта":"ГЭСН включена в расчёт")};
      $("#remove-position").onclick=()=>confirmDelete(`ГЭСН ${original.code}`,"Позиция и все её ресурсы будут удалены из текущего состава.",()=>{positions.splice(positions.indexOf(original),1);onDone?.()});
    },true);
  }

  function editWorkVikr(v){modal(`<h2 id="dialog-title">Изменить ВИКР</h2><p>Здесь доступны основные поля и действия с ВИКР.</p><div class="dialog-grid"><label class="field"><span>Код</span><input id="wv-code" value="${esc(v.code)}"></label><label class="field"><span>Объём</span><input id="wv-volume" type="number" min="0" step="any" value="${v.volume}"></label><label class="field wide"><span>Наименование</span><input id="wv-name" value="${esc(v.name)}"></label><label class="field"><span>Единица</span><input id="wv-unit" value="${esc(v.unit)}"></label><label class="field"><span>Конструктив</span><input id="wv-kr" value="${esc(v.kr)}"></label><label class="field"><span>Марка</span><input id="wv-mark" value="${esc(v.mark)}"></label></div><div class="dialog-actions dialog-actions-split"><div><button class="outline" id="move-wv">Переместить</button><button class="icon-delete danger-icon" id="delete-wv" aria-label="Удалить ВИКР" title="Удалить ВИКР">${trashIcon}</button></div><div><button class="outline" id="cancel-wv">Отменить</button><button class="primary" id="save-wv">Сохранить ВИКР</button></div></div>`,()=>{$("#cancel-wv").onclick=closeModal;$("#move-wv").onclick=()=>openPlace(v);$("#delete-wv").onclick=()=>deleteWorkNode({type:"vikr",id:v.uid});$("#save-wv").onclick=()=>{const volume=Number($("#wv-volume").value),name=$("#wv-name").value.trim();if(!name||!Number.isFinite(volume)||volume<0){toast("Проверьте наименование и объём");return}v.code=$("#wv-code").value.trim()||"Без кода";v.name=name;v.volume=volume;v.unit=$("#wv-unit").value.trim()||v.unit;v.kr=$("#wv-kr").value.trim();v.mark=$("#wv-mark").value.trim();ensureStructure(v.kr,v.mark);closeModal();renderWork();toast("ВИКР обновлён")}})}

  function openBaseActions(){const node=ui.activeNode,ids=groupIds(node.type,node.value).filter(id=>base.some(v=>v.id===id));if(!ids.length){toast("На этом уровне нет ВИКР");return}const label=node.type==="object"?"все ВИКР объекта":node.type==="kr"?`конструктив ${node.value}`:node.type==="mark"?`марку ${node.value.split("|")[1]}`:`ВИКР ${base.find(v=>v.id===ids[0])?.code}`;modal(`<h2 id="dialog-title">Действия: ${esc(label)}</h2><p>В выбранном уровне ${ids.length} ВИКР. Удаление затронет их ГЭСН и ресурсы в локальной Базе.</p><div class="dialog-actions"><button class="outline" id="cancel-actions">Отмена</button><button class="danger-btn" id="delete-base-level">Удалить выбранный уровень</button></div>`,()=>{$("#cancel-actions").onclick=closeModal;$("#delete-base-level").onclick=()=>confirmDelete(`Удалить ${label}?`,`Будет удалено ${ids.length} ВИКР со всем составом.`,()=>{for(let i=base.length-1;i>=0;i--)if(ids.includes(base[i].id))base.splice(i,1);persistBase();ui.selection.clear();ui.baseFocus=base[0]?.id;ui.activeNode={type:"object",value:"all"}})})}


  function renameWorkLevel(f){let current=f.type==='object'?work.name:f.type==='kr'?f.id:f.type==='mark'?f.id.split('|')[1]:work.packages.find(p=>p.id===f.id)?.name||'';modal(`<h2 id="dialog-title">Переименовать</h2><label class="field"><span>Новое название</span><input id="rename-value" value="${esc(current)}"></label><div class="dialog-actions"><button class="outline" id="cancel-rename">Отмена</button><button class="primary" id="save-rename">Сохранить</button></div>`,()=>{$("#cancel-rename").onclick=closeModal;$("#save-rename").onclick=()=>{const next=$("#rename-value").value.trim();if(!next){toast("Введите название");return}if(f.type==='object')work.name=next;else if(f.type==='kr'){const s=work.structures.find(x=>x.kr===f.id);if(s)s.kr=next;work.vikrs.filter(x=>x.kr===f.id).forEach(x=>x.kr=next);ui.workFocus={type:'kr',id:next}}else if(f.type==='mark'){const [kr,mark]=f.id.split('|'),s=work.structures.find(x=>x.kr===kr);if(s)s.marks=s.marks.map(x=>x===mark?next:x);work.vikrs.filter(x=>x.kr===kr&&x.mark===mark).forEach(x=>x.mark=next);ui.workFocus={type:'mark',id:kr+'|'+next}}else{const p=work.packages.find(x=>x.id===f.id);if(p)p.name=next}closeModal();renderAll();toast("Название обновлено")}})}

  async function saveWork(){const saved=await persistWorkNow();toast(saved?"Рабочий объект сохранён на этом компьютере":"Не удалось сохранить рабочий объект")}
  function openSavedWork(){
    const all=work.present?[work,...savedCopies]:savedCopies;
    modal(`<h2 id="dialog-title">Сохранённые объекты</h2><p>Откройте независимую рабочую копию.</p><div class="checklist">${all.map((item,i)=>`<label><span style="flex:1"><strong>${esc(item.name)}</strong><small>${item.vikrs.length} ВИКР · ${item.structures.length} конструктивов</small></span><button class="soft saved-open" data-i="${i}" ${work.present&&i===0?'disabled':''}>${work.present&&i===0?'Открыт':'Открыть'}</button></label>`).join("")||'<div class="empty">Нет сохранённых объектов</div>'}</div><div class="dialog-actions"><button class="outline" id="close-saved">Закрыть</button></div>`,()=>{
      $("#close-saved").onclick=closeModal;
      document.querySelectorAll(".saved-open:not(:disabled)").forEach(b=>b.onclick=async()=>{
        const i=Number(b.dataset.i);
        if(work.present){savedCopies[i-1]=clone(work);work=clone(all[i])}
        else work=clone(savedCopies.splice(i,1)[0]);
        await persistCopiesNow();await persistWorkNow();ui.workFocus={type:"object",id:work.id};closeModal();renderAll();toast("Объект открыт");
      });
    });
  }
  function saveAs(){if(!work.present)return;modal(`<h2 id="dialog-title">Сохранить как</h2><p>Будет создана независимая копия текущего рабочего объекта.</p><label class="field"><span>Название копии</span><input id="copy-name" value="${esc(work.name)} · вариант 2"></label><div class="dialog-actions"><button class="outline" id="cancel-dialog">Отмена</button><button class="primary" id="confirm-save-as">Создать копию</button></div>`,()=>{$("#cancel-dialog").onclick=closeModal;$("#confirm-save-as").onclick=async()=>{savedCopies.push(clone(work));await persistCopiesNow();work=clone(work);work.id=uid();work.name=$("#copy-name").value.trim()||work.name+" · копия";ui.workFocus={type:"object",id:work.id};await persistWorkNow();closeModal();renderAll();toast("Независимая копия создана")}})}
  function openSettings(){
    modal(`<h2 id="dialog-title">Настройки</h2><p>Основные параметры интерфейса сохраняются на этом компьютере.</p><div class="dialog-grid"><label class="field"><span>Тема</span><select id="settings-theme"><option value="light" ${settings.theme==="light"?'selected':''}>Светлая</option><option value="dark" ${settings.theme==="dark"?'selected':''}>Тёмная</option></select></label></div><div class="settings-placeholder"><strong>Компоновка экрана</strong><p>В следующих версиях здесь можно будет скрывать и возвращать отдельные блоки экрана.</p><label><input type="checkbox" checked disabled> Панель базы</label><label><input type="checkbox" checked disabled> Состав выбранного уровня</label><label><input type="checkbox" checked disabled> Сводка</label></div><div class="dialog-actions"><button class="outline" id="settings-cancel">Отмена</button><button class="primary" id="settings-save">Сохранить</button></div>`,()=>{$("#settings-cancel").onclick=closeModal;$("#settings-save").onclick=()=>{settings.theme=$("#settings-theme").value;localStorage.setItem(storage.settings,JSON.stringify(settings));applyTheme();closeModal();renderAll();toast("Настройки сохранены")}})
  }
  function openStructureEditor(space){
    const isBase=space==="base";
    const rows=[];
    const add=(type,id,label,level)=>rows.push({type,id,label,level});
    if(isBase){
      if(!baseInfo.deleted&&!baseInfo.treeHidden){add("object","all",baseInfo.title||"Объект",0);for(const pack of activePackages()){add("package",pack.id,"Комплект · "+pack.name,1);for(const id of groupIds("package",pack.id)){const v=base.find(item=>item.id===id);if(v)add("vikr",v.id,v.code+" · "+v.name,2)}}for(const kr of knownKrs()){add("kr",kr,kr+" · "+(krCatalogItem(kr)?.name||kr),1);for(const mark of knownMarks(kr)){add("mark",kr+"|"+mark,mark||"Без марки",2);for(const v of base.filter(v=>(v.kr||"Не распределено")===kr&&(v.mark||"")===mark))add("vikr",v.id,v.code+" · "+v.name,3)}}}
    }else{
      if(work.present&&!work.treeHidden)add("object",work.id,work.name,0);
      if(work.present&&!work.treeHidden)for(const pack of work.packages){add("package",pack.id,pack.name,1);for(const v of work.vikrs.filter(v=>v.packageId===pack.id))add("vikr",v.uid,v.code+" · "+v.name,2)}
      if(work.present&&!work.treeHidden)for(const structure of work.structures){const kr=structure.kr;add("kr",kr,kr,1);for(const mark of structure.marks){add("mark",kr+"|"+mark,mark,2);for(const v of work.vikrs.filter(v=>!v.packageId&&v.kr===kr&&v.mark===mark))add("vikr",v.uid,v.code+" · "+v.name,3)}for(const v of work.vikrs.filter(v=>!v.packageId&&v.kr===kr&&!v.mark))add("vikr",v.uid,v.code+" · "+v.name,2)}
      if(work.present&&!work.treeHidden)for(const v of work.vikrs.filter(v=>!v.packageId&&!v.kr))add("vikr",v.uid,v.code+" · "+v.name,1);
    }
    const badges={object:"О",kr:"КР",mark:"М",vikr:"В",package:"К"};
    modal(`<h2 id="dialog-title">Изменить структуру</h2><p class="structure-hint">Перетащите ВИКР на объект, конструктив или марку, а марку — на конструктив. Корзина удаляет выбранный уровень со вложенным составом.</p><div class="structure-editor" id="structure-editor">${rows.map((row,i)=>`<div class="structure-row" style="--level:${row.level}" data-i="${i}" draggable="${row.type==='object'?'false':'true'}"><span class="type-badge">${badges[row.type]}</span><span class="structure-name" title="${esc(row.label)}">${esc(row.label)}</span><button class="icon-delete structure-delete" data-i="${i}" aria-label="Удалить ${esc(row.label)}" title="Удалить ${esc(row.label)}">${trashIcon}</button></div>`).join("")||'<div class="empty">Нет объектов</div>'}</div><div class="dialog-actions"><button class="outline" id="structure-close">Закрыть</button></div>`,()=>{
      $("#structure-close").onclick=closeModal;
      $("#structure-editor").querySelectorAll(".structure-delete").forEach(b=>b.onclick=()=>{const r=rows[Number(b.dataset.i)];if(isBase){if(r.type==="object")confirmDelete(`Объект «${baseInfo.title||"Объект"}»`,"Объект, все связанные конструктивы, марки, ВИКР, ГЭСН и ресурсы будут удалены из Базы.",deleteBaseObject);else removeBaseLevel(r.type,r.id)}else deleteWorkNode({type:r.type,id:r.id})});
      let dragged=null;$("#structure-editor").querySelectorAll(".structure-row").forEach(el=>{el.ondragstart=e=>{dragged=rows[Number(el.dataset.i)];e.dataTransfer.effectAllowed="move";e.dataTransfer.setData("text/plain",dragged.type+"|"+dragged.id)};el.ondragover=e=>{const target=rows[Number(el.dataset.i)];if(dragged&&canMoveStructure(dragged,target)){e.preventDefault();el.classList.add("drag-over")}};el.ondragleave=()=>el.classList.remove("drag-over");el.ondrop=async e=>{e.preventDefault();el.classList.remove("drag-over");const target=rows[Number(el.dataset.i)];if(!dragged||!canMoveStructure(dragged,target))return;const moved=isBase?moveBaseStructure(dragged,target):moveWorkStructure(dragged,target);if(!moved)return;if(isBase){if(!persistBase())return;ui.activeNode={type:"object",value:"all"};ui.baseDetail={...ui.activeNode};renderBase()}else{await persistWorkNow();ui.workFocus={type:"object",id:work.id};renderWork()}openStructureEditor(space);toast("Структура обновлена")};el.ondragend=()=>{$("#structure-editor")?.querySelectorAll(".drag-over").forEach(x=>x.classList.remove("drag-over"));dragged=null}})
    },true);
  }
  function canMoveStructure(source,target){if(source===target)return false;return source.type==="vikr"&&["object","kr","mark","package"].includes(target.type)||source.type==="mark"&&target.type==="kr"}
  function moveBaseStructure(source,target){
    if(source.type==="vikr"){const v=base.find(x=>x.id===source.id);if(!v)return false;for(const pack of activePackages())pack.memberIds=(pack.memberIds||[]).filter(id=>id!==v.id);delete v.packageId;if(target.type==="package"){const pack=activePackages().find(item=>item.id===target.id);if(!pack)return false;v.packageId=pack.id;pack.memberIds.push(v.id)}else if(target.type==="object"){v.kr="";v.mark=""}else if(target.type==="kr"){v.kr=target.id;v.mark=""}else{[v.kr,v.mark]=target.id.split("|")}return true}
    if(source.type==="mark"&&target.type==="kr"){const [fromKr,mark]=source.id.split("|");if(fromKr===target.id)return false;base.filter(v=>(v.kr||"Не распределено")===fromKr&&(v.mark||"")===mark).forEach(v=>v.kr=target.id);const oldKey=levelKey("mark",source.id),newKey=levelKey("mark",target.id+"|"+mark);if(baseInfo.levels[oldKey]){baseInfo.levels[newKey]=baseInfo.levels[oldKey];delete baseInfo.levels[oldKey];persistBaseInfo()}return true}return false
  }
  function moveWorkStructure(source,target){
    if(source.type==="vikr"){const v=work.vikrs.find(x=>x.uid===source.id);if(!v)return false;work.packages.forEach(p=>p.memberIds=p.memberIds.filter(id=>id!==v.uid));v.packageId=null;if(target.type==="object"){v.kr="";v.mark=""}else if(target.type==="package"){const pack=work.packages.find(x=>x.id===target.id);if(!pack)return false;v.packageId=pack.id;if(!pack.memberIds.includes(v.uid))pack.memberIds.push(v.uid)}else if(target.type==="kr"){v.kr=target.id;v.mark=""}else{[v.kr,v.mark]=target.id.split("|")}ensureStructure(v.kr,v.mark);return true}
    if(source.type==="mark"&&target.type==="kr"){const [fromKr,mark]=source.id.split("|");if(fromKr===target.id)return false;const old=work.structures.find(x=>x.kr===fromKr);if(old)old.marks=old.marks.filter(x=>x!==mark);work.vikrs.filter(v=>v.kr===fromKr&&v.mark===mark).forEach(v=>v.kr=target.id);ensureStructure(target.id,mark);return true}return false
  }
  function fsnbFullCode(code,baseName="ГЭСН"){
    const text=String(code||"").trim();
    return /^(?:ГЭСН|ФЕР|ТЕР)/i.test(text)?text:`${baseName||"ГЭСН"} ${text}`.trim();
  }
  function quantityMarkup(value,unit){return `<span class="quantity-pair"><span class="quantity-value"><small>Количество</small><b>${esc(value)}</b></span><span class="quantity-unit"><small>Ед. изм.</small><b>${esc(unit)}</b></span></span>`}
  function decorateQuantities(root){
    if(!root)return;
    for(const el of root.querySelectorAll(".position-head em,.resource-list .resource>strong,.level-detail-row>strong,.stat.unit>strong,.base-summary-row:not(.object):not(.selected):not(.comment)>strong")){
      if(el.children.length)continue;
      const text=el.textContent.trim(),match=text.match(/^(-?(?:\d{1,3}(?:[\u00a0\u202f ]\d{3})+|\d+)(?:[,.]\d+)?)\s+(.+)$/);
      if(match)el.innerHTML=quantityMarkup(match[1],match[2]);
    }
  }
  function basePathEntries(){
    const entries=[{label:"База",type:"root",value:""}];if(ui.baseObjectMode||!activeBaseId)return entries;
    entries.push({label:baseInfo.title,type:"object",value:"all"});
    const n=ui.activeNode,v=n.type==="vikr"?base.find(item=>item.id===n.value):null;
    const kr=n.type==="kr"?n.value:n.type==="mark"?n.value.split("|")[0]:v?.kr;
    const mark=n.type==="mark"?n.value.split("|")[1]:v?.mark;
    if(kr)entries.push({label:kr,type:"kr",value:kr});
    if(mark)entries.push({label:mark,type:"mark",value:kr+"|"+mark});
    if(n.type==="package")entries.push({label:activePackages().find(p=>p.id===n.value)?.name||"Комплект",type:"package",value:n.value});
    if(v)entries.push({label:`${v.code} · ${v.name}`,type:"vikr",value:v.id});
    if(v&&ui.baseGesnFocus){const p=v.gesn.find(p=>p.id===ui.baseGesnFocus);if(p)entries.push({label:p.code,type:"gesn",value:p.id,owner:v.id})}
    return entries;
  }
  function renderBaseBreadcrumbs(){
    let path=$("#base-breadcrumbs");if(!path){path=document.createElement("nav");path.id="base-breadcrumbs";path.className="base-breadcrumbs";path.setAttribute("aria-label","Путь в Базе");$("#list-subtitle").after(path)}
    const entries=basePathEntries();path.innerHTML=entries.map((entry,i)=>`${i?'<span class="path-separator" aria-hidden="true">›</span>':""}<button data-step="${i}" ${i===entries.length-1?'aria-current="location"':''} title="${esc(entry.label)}">${esc(entry.label)}</button>`).join("");
    path.querySelectorAll("button").forEach(button=>button.onclick=()=>{const entry=entries[Number(button.dataset.step)];ui.selection.clear();ui.query="";$("#search").value="";ui.workType="";ui.krFilter="";ui.markFilter="";ui.unitFilter="";ui.baseHistory=[];
      if(entry.type==="root"){ui.baseObjectMode=true;ui.baseGesnFocus=null}
      else{ui.baseObjectMode=false;ui.activeNode={type:entry.type==="gesn"?"vikr":entry.type,value:entry.owner||entry.value};ui.baseDetail={...ui.activeNode};ui.baseGesnFocus=entry.type==="gesn"?entry.value:null;ui.baseView=entry.type==="object"?"kr":entry.type==="kr"?"mark":"vikr";ui.baseFocus=groupIds(ui.activeNode.type,ui.activeNode.value)[0]}
      renderBase();
    });
  }
  function insertionParents(object,type){
    const krs=[...new Set([...(object.info.krCatalog||[]).map(x=>x.code),...object.vikrs.map(v=>v.kr).filter(Boolean),...Object.keys(object.info.levels||{}).filter(k=>k.startsWith("kr:")).map(k=>k.slice(3))])];
    const marks=[...new Set([...object.vikrs.filter(v=>v.mark).map(v=>v.kr+"|"+v.mark),...Object.keys(object.info.levels||{}).filter(k=>k.startsWith("mark:")).map(k=>k.slice(5))])];
    if(type==="kr")return [{value:"object",label:object.info.title}];
    if(type==="mark")return krs.map(kr=>({value:"kr:"+kr,label:kr+" · "+(object.info.levels?.["kr:"+kr]?.name||object.info.krCatalog.find(x=>x.code===kr)?.name||kr)}));
    if(type==="vikr")return [{value:"object",label:object.info.title+" · без КР и марки"},...krs.map(kr=>({value:"kr:"+kr,label:"КР "+kr})),...marks.map(mark=>({value:"mark:"+mark,label:"КР "+mark.split("|")[0]+" → "+mark.split("|")[1]}))];
    if(type==="gesn")return object.vikrs.map(v=>({value:"vikr:"+v.id,label:`${v.kr||"Без КР"} → ${v.mark||"Без марки"} → ${v.code} · ${v.name}`}));
    return object.vikrs.flatMap(v=>(v.gesn||[]).map(p=>({value:JSON.stringify([v.id,p.id]),label:`${v.code} → ${p.code} · ${p.name}`})));
  }
  function openAddElement(){
    const target=baseObjects.find(o=>o.id===activeBaseId);if(!target){toast("Сначала откройте объект");return}
    const node={...(ui.baseDetail||ui.activeNode)},gesnFocus=node.type==="vikr"&&node.value===ui.activeNode.value?ui.baseGesnFocus:null;
    const defaultType=gesnFocus?"resource":node.type==="vikr"?"gesn":node.type==="mark"?"vikr":node.type==="kr"?"mark":"kr";
    let source=null;
    modal(`<h2 id="dialog-title">Добавить элемент</h2><p>Объект: ${esc(target.info.title)}</p><div class="dialog-grid"><label class="field"><span>Уровень строки</span><select id="element-type"><option value="kr">КР</option><option value="mark">Марка</option><option value="vikr">ВИКР</option><option value="gesn">ГЭСН</option><option value="resource">Ресурс</option></select></label><label class="field"><span>Источник</span><select id="element-source"><option value="new">Новая строка</option><option value="base">Выбрать из Базы</option></select></label><label class="field wide"><span>Родительский элемент</span><select id="element-parent"></select></label></div><div id="element-source-block" class="hidden"><button class="outline" id="element-browse">Открыть Базу для выбора</button><div class="element-source-caption" id="element-source-caption">Элемент не выбран</div></div><div class="dialog-grid" id="element-fields"><label class="field"><span>Код</span><input id="element-code"></label><label class="field"><span>Единица измерения</span><input id="element-unit" placeholder="Например, 1000 м3"></label><label class="field wide"><span>Наименование</span><input id="element-name"></label><label class="field"><span>Количество / объём</span><input id="element-volume" type="number" min="0" step="any" value="0"></label><label class="field" id="element-kind-field"><span>Тип ресурса</span><select id="element-kind"><option value="materials">Материал</option><option value="workers">Рабочие</option><option value="drivers">Машинисты</option><option value="machines">Машины и механизмы</option></select></label></div><div class="dialog-actions"><button class="primary" id="element-confirm">Добавить</button></div>`,()=>{
      const type=$("#element-type"),sourceMode=$("#element-source"),parent=$("#element-parent");type.value=defaultType;
      const drawParents=()=>{const options=insertionParents(target,type.value);parent.innerHTML=options.map(o=>`<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
        const preferred=type.value==="resource"&&node.type==="vikr"&&gesnFocus?JSON.stringify([node.value,gesnFocus]):type.value==="gesn"&&node.type==="vikr"?"vikr:"+node.value:node.type==="mark"?"mark:"+node.value:node.type==="kr"?"kr:"+node.value:"object";
        if(options.some(o=>o.value===preferred))parent.value=preferred;parent.disabled=!options.length;$("#element-confirm").disabled=!options.length;
        $("#element-kind-field").classList.toggle("hidden",type.value!=="resource");
        for(const id of ["element-unit","element-volume"])$("#"+id).closest("label").classList.toggle("hidden",type.value==="mark");
        if(!options.length)parent.innerHTML='<option>Сначала создайте родительский элемент</option>';
        $("#element-code").value=type.value==="gesn"?"ГЭСН ":"";source=null;$("#element-source-caption").textContent="Элемент не выбран";
      };
      type.onchange=drawParents;drawParents();sourceMode.onchange=()=>{$("#element-source-block").classList.toggle("hidden",sourceMode.value!=="base");$("#element-fields").classList.toggle("hidden",sourceMode.value==="base")};
      $("#element-browse").onclick=()=>openElementSourceBrowser(type.value,selection=>{source=selection;$("#element-source-caption").textContent=`Выбрано: ${selection.records.length} · ${selection.mode==='full'?'пропорционально объёму принимающего объекта':selection.mode==='unit'?'на 1 ед. уровня':'на 1 ед. объекта'} · ${selection.records.map(r=>r.label).join('; ')}`});
      $("#element-confirm").onclick=async()=>{
        if(sourceMode.value==="base"&&!source){toast("Выберите элемент из Базы");return}
        const fields={code:$("#element-code").value.trim(),name:$("#element-name").value.trim(),unit:$("#element-unit").value.trim(),volume:Number($("#element-volume").value),kind:$("#element-kind").value};
        if(sourceMode.value==="new"&&(!fields.name||!Number.isFinite(fields.volume)||fields.volume<0||["kr","mark"].includes(type.value)&&!fields.code)){toast("Укажите код, наименование и корректное количество");return}
        if(sourceMode.value==="new"&&["kr","mark"].includes(type.value)&&fields.code.includes("|")){toast("Символ | используется как разделитель структуры. Укажите код без него");return}
        const chosenType=type.value,chosenParent=parent.value,chosenSource=sourceMode.value==="base"?source:null;
        const confirm=$("#element-confirm");confirm.disabled=true;
        try{if(!await ensureFolderAccess()){confirm.disabled=false;return}await folderWriteQueue;
          const currentTarget=baseObjects.find(o=>o.id===target.id);if(!currentTarget){toast("Объект не найден в выбранной папке");confirm.disabled=false;return}
          const draft=clone(currentTarget);if(chosenSource?.tree){window.VIKR_SOURCE_TREE.importSelection(draft,chosenSource,{type:chosenType,parent:chosenParent})}else if(chosenSource){for(const record of chosenSource.records){const normalized=window.VIKR_SOURCE_SELECTION.normalized(record,chosenSource.mode,currentTarget);if(!appendElement(draft,chosenType,chosenParent,normalized,fields)){confirm.disabled=false;return}}}else if(!appendElement(draft,chosenType,chosenParent,null,fields)){confirm.disabled=false;return}draft.vikrs.forEach(hydrateVikr);
          if(!await objectFiles.write(draft)){toast("Не удалось сохранить объект в выбранной папке");confirm.disabled=false;return}
          Object.assign(currentTarget,draft);activeBaseId=currentTarget.id;base=currentTarget.vikrs;baseInfo=currentTarget.info;closeModal();renderAll();toast("Элемент добавлен и сохранён");
        }catch(error){confirm.disabled=false;toast("Не удалось добавить элемент: "+error.message)}
      };
    },true);
  }
  function freshPosition(position){const p=clone(position);p.sourceId=p.sourceId||p.id;p.id=uid();if(p.source==="ФСНБ-2022"||p.base||/^\d{2}-\d{2}-\d{3}-\d{2}$/.test(p.code||""))p.code=fsnbFullCode(p.code,p.base);p.resources=(p.resources||[]).map(r=>({...r,id:uid()}));return p}
  function freshVikr(v){const copy=clone(v);copy.sourceId=v.id;copy.id=uid();delete copy.uid;delete copy.packageId;copy.gesn=(v.gesn||[]).map(freshPosition);return copy}
  function appendElement(target,type,parent,source,fields){
    target.info.levels||={};target.info.krCatalog||=[];
    const exists=(type,code)=>type==="kr"?target.info.krCatalog.some(k=>k.code===code)||target.vikrs.some(v=>v.kr===code):Boolean(target.info.levels["mark:"+code])||target.vikrs.some(v=>v.kr+"|"+v.mark===code);
    const metaFrom=(object,key)=>clone(object.info.levels?.[key]||{});
    if(type==="kr"){
      const code=source?source.value:fields.code;if(exists("kr",code)){toast("КР с таким кодом уже есть в объекте");return false}
      const catalog=source?clone(source.object.info.krCatalog.find(k=>k.code===code)||{code,name:code}):{code,name:fields.name};target.info.krCatalog.push(catalog);
      target.info.levels["kr:"+code]=source?metaFrom(source.object,"kr:"+code):{name:fields.name,unit:fields.unit,volume:fields.volume,note:"",coefficients:[]};
      if(source){for(const [key,value] of Object.entries(source.object.info.levels||{}))if(key.startsWith("mark:"+code+"|"))target.info.levels[key]=clone(value);target.vikrs.push(...source.object.vikrs.filter(v=>(v.kr||"Не распределено")===code).map(freshVikr))}
    }else if(type==="mark"){
      const kr=parent.slice(3),mark=source?source.value.split("|").slice(1).join("|"):fields.code,key=kr+"|"+mark;
      if(exists("mark",key)){toast("Марка с таким кодом уже есть в этом КР");return false}
      target.info.levels["mark:"+key]=source?metaFrom(source.object,"mark:"+source.value):{name:fields.name,unit:"",volume:null,note:"",coefficients:[]};
      if(source)target.vikrs.push(...source.object.vikrs.filter(v=>(v.kr||"Не распределено")+"|"+(v.mark||"")===source.value).map(v=>({...freshVikr(v),kr,mark})));
    }else if(type==="vikr"){
      const item=source?freshVikr(source.item):{id:uid(),code:fields.code||"Без кода",name:fields.name,volume:fields.volume,unit:fields.unit,gesn:[],coefficients:[],note:""};
      item.kr="";item.mark="";if(parent.startsWith("kr:"))item.kr=parent.slice(3);else if(parent.startsWith("mark:"))[item.kr,item.mark]=parent.slice(5).split("|");target.vikrs.push(item);
    }else if(type==="gesn"){
      const owner=target.vikrs.find(v=>v.id===parent.slice(5));if(!owner){toast("ВИКР не найден");return false}
      owner.gesn.push(source?freshPosition(source.item):{id:uid(),code:fsnbFullCode(fields.code),name:fields.name,unit:fields.unit,qty:fields.volume,resources:[],coefficients:[]});
    }else{
      const [vId,pId]=JSON.parse(parent),position=target.vikrs.find(v=>v.id===vId)?.gesn.find(p=>p.id===pId);if(!position){toast("ГЭСН не найдена");return false}
      position.resources.push(source?{...clone(source.item),id:uid()}:{id:uid(),code:fields.code,name:fields.name,unit:fields.unit,qty:fields.volume,kind:fields.kind});
    }
    return true;
  }
  function openElementSourceBrowser(type,onChoose){return window.VIKR_SOURCE_SELECTION.open(baseObjects,type,onChoose,baseObjects.find(o=>o.id===activeBaseId))}
  let screenPast=[],screenFuture=[],screenCurrent=null,restoringScreen=false,workspaceRows=[];
  const toolIcon=paths=>`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  function captureScreen(){const table=$("#space-base .table-scroll");return {objectId:activeBaseId,baseObjectMode:ui.baseObjectMode,activeNode:{...ui.activeNode},baseDetail:{...ui.baseDetail},baseView:ui.baseView,baseGesnFocus:ui.baseGesnFocus,baseFocus:ui.baseFocus,query:ui.query,workType:ui.workType,krFilter:ui.krFilter,markFilter:ui.markFilter,unitFilter:ui.unitFilter,tableX:table?.scrollLeft||0,tableY:table?.scrollTop||0}}
  function screenKey(screen){const {tableX,tableY,baseDetail,baseFocus,...location}=screen;return JSON.stringify(location)}
  function syncScreenHistory(){const next=captureScreen();if(!restoringScreen&&screenCurrent&&screenKey(next)!==screenKey(screenCurrent)){screenPast.push(screenCurrent);screenFuture=[]}screenCurrent=next;renderWorkspaceTools()}
  function validScreen(screen){const object=baseObjects.find(o=>o.id===screen.objectId);if(screen.baseObjectMode)return true;if(!object)return false;const n=screen.activeNode;if(n.type==='vikr')return object.vikrs.some(v=>v.id===n.value&&(!screen.baseGesnFocus||v.gesn.some(p=>p.id===screen.baseGesnFocus)));if(n.type==='kr')return object.vikrs.some(v=>(v.kr||'Не распределено')===n.value)||object.info.krCatalog?.some(kr=>kr.code===n.value);if(n.type==='mark')return object.vikrs.some(v=>(v.kr||'Не распределено')+'|'+(v.mark||'')===n.value)||Boolean(object.info.levels?.['mark:'+n.value]);return true}
  function travelScreen(forward){const from=forward?screenFuture:screenPast,to=forward?screenPast:screenFuture;let next;while(from.length){const candidate=from.pop();if(validScreen(candidate)){next=candidate;break}}if(!next){renderWorkspaceTools();return}to.push(captureScreen());const object=baseObjects.find(o=>o.id===next.objectId)||baseObjects[0];activeBaseId=object?.id||null;base=object?.vikrs||[];baseInfo=object?.info||{title:'',levels:{},krCatalog:[],deleted:true};Object.assign(ui,next);ui.selection.clear();ui.objectSelection.clear();$("#search").value=ui.query;restoringScreen=true;try{renderAll();const table=$("#space-base .table-scroll");table.scrollLeft=next.tableX||0;table.scrollTop=next.tableY||0;screenCurrent=captureScreen()}finally{restoringScreen=false}saveBaseUi();renderWorkspaceTools()}
  function renderWorkspaceTools(){const host=$("#workspace-tools");if(!host)return;const icons={back:toolIcon('<path d="M15 5l-7 7 7 7"/>'),forward:toolIcon('<path d="M9 5l7 7-7 7"/>'),copy:toolIcon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>'),move:toolIcon('<path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>')};const hasItems=ui.baseObjectMode?ui.objectSelection.size>0:Boolean(activeBaseId);host.innerHTML=Object.entries({back:'Назад',forward:'Вперёд',copy:'Копировать',move:'Переместить'}).map(([key,label])=>`<button class="workspace-tool" data-action="${key}" title="${label}" aria-label="${label}" ${(key==='back'?!screenPast.some(validScreen):key==='forward'?!screenFuture.some(validScreen):!hasItems)?'disabled':''}>${icons[key]}</button>`).join('');host.querySelectorAll('button').forEach(b=>b.onclick=()=>b.dataset.action==='back'?travelScreen(false):b.dataset.action==='forward'?travelScreen(true):openWorkspaceTransfer(b.dataset.action));renderExcelActions()}
  function positionModalBackButtons(){const root=$("#dialog-body");for(const button of root.querySelectorAll('button')){if(button.textContent.trim()!=='Назад')continue;const actions=button.closest('.dialog-actions');if(!actions)continue;const oldParent=button.parentElement,last=actions.lastElementChild,right=last?.tagName==='DIV'?last:actions;right.insertBefore(button,right.querySelector('.primary')||null);if(oldParent!==actions&&oldParent!==right&&!oldParent.children.length)oldParent.remove();if(actions.children.length===1)actions.style.justifyContent="flex-end"}}
  function sendCoefficientContext(){if(integratedModule.kind!=='coefficients')return;const ctx=integratedModule.context,codes=ctx.positionIds?.length?positionsForContext(ctx).map(p=>{const code=normalizedPositionCode(p);return [code.family,code.numeric].filter(Boolean).join(' ')}).filter(Boolean):[];$("#module-frame").contentWindow.postMessage({type:'vikr:coefficient-context',options:{positionCodes:codes,restrictPositions:Boolean(ctx.positionIds?.length),createCustom:ctx.createCustom===true}},'*')}
  function wirePositionCoefficients(draft,origin){const list=$("#position-coefficient-list"),label=$("#position-coefficients");const draw=()=>{label.textContent=`Коэффициент${draft.coefficients?.length?' · '+draft.coefficients.length:''}`;list.innerHTML=(draft.coefficients||[]).map((item,index)=>`<div class="coefficient-card"><div><strong>${esc(item.code)} · ${esc(item.name)}</strong><div class="coefficient-factors">${factorBadges(item)}</div></div><button class="icon-delete" data-index="${index}" title="Удалить коэффициент" aria-label="Удалить коэффициент">${trashIcon}</button></div>`).join('')||'<div class="empty">Коэффициенты к этой ГЭСН пока не назначены.</div>';list.querySelectorAll('button').forEach(b=>b.onclick=()=>{draft.coefficients.splice(Number(b.dataset.index),1);draw()})};label.onclick=()=>{list.classList.toggle('hidden');draw()};$("#position-coefficients-add").onclick=()=>{const owner=(origin==='base'?base:work.vikrs).find(v=>v.gesn.some(p=>p.id===draft.id));draft.code=$("#pos-code").value;draft.name=$("#pos-name").value;openCoefficientModule({space:origin,type:'vikr',id:origin==='base'?owner?.id:owner?.uid,positionIds:[draft.id],positionDraft:draft,onCoefficientChange:()=>{list.classList.remove('hidden');draw()},label:`${draft.code} · ${draft.name}`})};draw()}
  function renderExcelActions(){
    const host=$("#workspace-tools");if(host&&!host.querySelector('.export-tool')){const b=document.createElement('button');b.className='workspace-tool export-tool';b.textContent='Excel';b.title='Экспорт выбранного состава или открытого уровня в Excel';b.setAttribute('aria-label',b.title);b.disabled=!objectFiles?.isReady()||!baseObjects.length;b.onclick=()=>openExcelExport();host.append(b)}
    const selection=$("#selection-drawer .drawer-actions");if(selection&&!$("#export-selection")){const b=document.createElement('button');b.className='outline';b.id='export-selection';b.textContent='Экспорт в Excel';b.onclick=()=>openExcelExport();selection.prepend(b)}
    const chosen=$("#selection-drawer .drawer-actions");if(chosen&&!$("#own-selection-coefficient")){const b=document.createElement("button");b.className="outline";b.id="own-selection-coefficient";b.textContent="Свой коэффициент";b.onclick=addOwnSelectionCoefficient;chosen.append(b)}
    const working=$("#work-selection-drawer .drawer-actions");if(working&&!$("#work-export-selection")){const b=document.createElement('button');b.className='outline';b.id='work-export-selection';b.textContent='Экспорт в Excel';b.onclick=()=>openWorkExcelExport();working.prepend(b)}
  }
  function openExcelExport(nodes=null){
    if(!objectFiles?.isReady()||!baseObjects.length){toast('Сначала выберите папку с объектами');return}
    const selected=nodes||workspaceNodes();if(!selected.length){toast('Выберите объекты или откройте нужный уровень');return}
    try{window.VIKR_EXCEL.open({objects:baseObjects,nodes:selected})}catch(error){toast(error.message)}
  }
  function openWorkExcelExport(context=null){
    if(!work.present){toast('Рабочий объект не выбран');return}
    const object={id:work.id,exportWorking:true,info:{title:work.name,levels:{...clone(work.levelMeta||{}),object:{volume:work.volume,unit:work.unit,coefficients:clone(work.coefficients||[])}}},packages:clone(work.packages||[]),vikrs:work.vikrs.map(v=>({...clone(v),id:v.uid}))};
    if(work.loose?.length)object.vikrs.push({id:'export-loose',name:'Самостоятельные позиции',exportLoose:true,gesn:clone(work.loose),kr:'',mark:'',volume:1,baseVolume:1});
    let nodes=context?[{objectId:work.id,type:context.type,value:context.value||context.id}]:ui.workSelection.size?[...ui.workSelection].map(value=>({objectId:work.id,type:'vikr',value})):ui.poolSelection.size?[...ui.poolSelection].map(value=>({objectId:work.id,type:'gesn',value})):[{objectId:work.id,type:ui.workFocus.type,value:ui.workFocus.id}];
    nodes=nodes.map(n=>n.type==='pool'?{...n,type:'vikr',value:'export-loose'}:n);
    try{window.VIKR_EXCEL.open({objects:[object],nodes})}catch(error){toast(error.message)}
  }
  function workspaceNodes(){
    if(ui.baseObjectMode)return [...ui.objectSelection].map(objectId=>({objectId,type:'object',value:'all'}));
    const nodes=[],covered=new Set(),objectId=activeBaseId;
    for(const row of workspaceRows){const tokens=rowSelectionTokens(row);if(!tokens.length||!tokens.every(t=>ui.selection.has(t)))continue;tokens.forEach(t=>covered.add(t));nodes.push({objectId,type:row.type,value:row.value,...(row.type==='resource'?{positionId:row.position.id,index:Number(row.value)}:{})})}
    for(const token of ui.selection){if(covered.has(token))continue;if(token.startsWith('level:')){const [,type,...value]=token.split(':');nodes.push({objectId,type,value:value.join(':')})}else if(token.startsWith('position:'))nodes.push({objectId,type:'gesn',value:token.slice(9)});else if(token.startsWith('resource:')){const [,positionId,index]=token.split(':');nodes.push({objectId,type:'resource',value:index,positionId,index:Number(index)})}else if(base.some(v=>v.id===token))nodes.push({objectId,type:'vikr',value:token})}
    if(!nodes.length){const n=ui.activeNode;nodes.push({objectId,type:ui.baseGesnFocus?'gesn':n.type,value:ui.baseGesnFocus||n.value})}
    return window.VIKR_WORKSPACE_TRANSFER.normalize(baseObjects,nodes);
  }
  function workspaceParents(object,nodes){if(!object)return [];const types=new Set(nodes.map(n=>n.type));if(types.has('resource'))return object.vikrs.flatMap(v=>v.gesn.map(p=>({type:'gesn',value:p.id,label:`${v.code} → ${p.code} · ${p.name}`})));if(types.has('gesn'))return object.vikrs.map(v=>({type:'vikr',value:v.id,label:`${v.code} · ${v.name}`}));const options=[{type:'object',value:'all',label:'Сохранить исходную структуру'}];if([...types].every(t=>t==='mark'||t==='vikr'))for(const kr of new Set([...object.vikrs.map(v=>v.kr||'Не распределено'),...(object.info.krCatalog||[]).map(k=>k.code)]))options.push({type:'kr',value:kr,label:'Конструктив: '+kr});if([...types].every(t=>t==='vikr'))for(const key of new Set([...object.vikrs.filter(v=>v.mark).map(v=>(v.kr||'Не распределено')+'|'+v.mark),...Object.keys(object.info.levels||{}).filter(k=>k.startsWith('mark:')).map(k=>k.slice(5))]))options.push({type:'mark',value:key,label:'Марка: '+key.replace('|',' → ')});return options}
  async function persistWorkspacePlan(plan){
    const originals=new Map(baseObjects.map(o=>[o.id,clone(o)])),written=[],deleted=[];
    try{
      for(const object of plan.changed){if(!await objectFiles.write(object,{create:!originals.has(object.id)}))throw Error("Не удалось сохранить объект «"+object.info.title+"»");written.push(object.id)}
      for(const id of plan.removed){if(!await objectFiles.remove(id))throw Error("Не удалось удалить исходный файл объекта");deleted.push(id)}
    }catch(error){
      let restored=true;for(const id of [...written,...deleted]){const original=originals.get(id);const ok=original?await objectFiles.write(original,{create:deleted.includes(id)}):await objectFiles.remove(id);restored=ok&&restored}
      toast(error.message+(restored?"":". Не все файлы удалось восстановить; проверьте выбранную папку"));return false;
    }
    for(const object of plan.changed){const index=baseObjects.findIndex(o=>o.id===object.id);if(index<0)baseObjects.push(object);else baseObjects[index]=object}
    baseObjects=baseObjects.filter(o=>!plan.removed.includes(o.id));return true;
  }
  function openWorkspaceTransfer(action){
    const move=action==='move',nodes=workspaceNodes();if(!nodes.length){toast('Сначала выберите элементы');return}
    return window.VIKR_TRANSFER_DIALOG.open(baseObjects,nodes,move,workspaceParents,async destination=>{
      window.VIKR_WORKSPACE_TRANSFER.build(baseObjects,nodes,destination,move);
      if(!await ensureFolderAccess())return false;await Promise.all([folderWriteQueue,customBaseSaveQueue]);
      const plan=window.VIKR_WORKSPACE_TRANSFER.build(baseObjects,nodes,destination,move);
      if(!await persistWorkspacePlan(plan))return false;ui.selection.clear();ui.objectSelection.clear();selectBaseObject(plan.targetId);return true;
    },toast,{title:action==='add'?'Добавить в объект':null,allowPackage:action==='add'});
  }
  function addCoefficientToNodes(nodes,space){const node=nodes[0],object=space==='base'?baseObjects.find(o=>o.id===node.objectId):workFeatureObject();if(!node||!object)return;const positionIds=nodes.filter(n=>n.type==='gesn').map(n=>n.value),owner=positionIds.length?object.vikrs.find(v=>v.gesn?.some(p=>p.id===positionIds[0])):null;openCoefficientModule({space,type:owner?.exportLoose?'pool':positionIds.length?'vikr':node.type,id:positionIds.length?owner?.id:node.value,positionIds,label:node.type==='object'?object.info.title:node.value})}
  function baseFeatureHost(){return {notify:toast,addCoefficient:nodes=>addCoefficientToNodes(nodes,'base'),commit:async changed=>{
    if(!await ensureFolderAccess())return false;await Promise.all([folderWriteQueue,customBaseSaveQueue]);
    if(!await persistWorkspacePlan({changed,removed:[]}))return false;
    const current=baseObjects.find(o=>o.id===activeBaseId);base=current?.vikrs||[];baseInfo=current?.info||emptyBaseInfo();renderAll();return true;
  }}}
  function workFeatureObject(){return {id:work.id,exportWorking:true,info:{title:work.name,levels:{...clone(work.levelMeta),object:{name:work.name,volume:work.volume,unit:work.unit,coefficients:clone(work.coefficients||[])}}},vikrs:work.vikrs.map(v=>({...clone(v),id:v.uid})).concat(work.loose?.length?[{id:'feature-loose',gesn:clone(work.loose),volume:1,baseVolume:1,exportLoose:true}]:[]),packages:clone(work.packages)}}
  function workFeatureHost(){return {notify:toast,addCoefficient:nodes=>addCoefficientToNodes(nodes,'work'),commit:async changed=>{const o=changed[0],meta=o.info.levels.object,ratio=Number(work.volume)>0?Number(meta.volume)/work.volume:1;work.volume=meta.volume;work.unit=meta.unit;work.coefficients=meta.coefficients||[];work.levelMeta=clone(o.info.levels);delete work.levelMeta.object;work.vikrs=o.vikrs.filter(v=>!v.exportLoose);work.loose=o.vikrs.find(v=>v.exportLoose)?.gesn||[];work.packages=o.packages;if(Number(work.baseVolume)>0)work.baseVolume*=ratio;renderWork();return await persistWorkNow()}}}
  function addOwnSelectionCoefficient(){const nodes=workspaceNodes();window.VIKR_STRUCTURE_FEATURES.ownCoefficient(baseObjects,nodes,baseFeatureHost())}

  function init(){
    applyTheme();document.querySelectorAll(".nav[data-space]").forEach(b=>b.onclick=()=>switchSpace(b.dataset.space));$("#nav-settings").onclick=openSettings;
    window.addEventListener("pagehide",saveBaseUi);window.addEventListener("beforeunload",event=>{saveBaseUi();if(pendingFolderWrites||pendingLocalWrites){event.preventDefault();event.returnValue=""}});
    $("#search").oninput=e=>{ui.query=e.target.value;if(ui.baseObjectMode){renderBaseObjectModeV41();return}if(ui.query.trim())ui.baseView="vikr";ui.baseGesnFocus=null;ui.baseDetail={...ui.activeNode};ui.baseFocus=visibleBase()[0]?.id;renderBaseView();renderBaseRows();renderBaseDetailNew();saveBaseUi()};
    $("#choose-object").onclick=()=>openStructureEditor("base");
    $("#clear-selection").onclick=()=>{if(ui.baseObjectMode)ui.objectSelection.clear();else ui.selection.clear();renderBase()};
    $("#transfer-selection").onclick=()=>openWorkspaceTransfer("add");
    $("#compare-selection").onclick=compareSelection;$("#dialog-close").onclick=closeModal;$("#module-host-close").onclick=closeIntegratedModule;
    $("#work-search").oninput=e=>{ui.workQuery=e.target.value;if(ui.workQuery.trim())ui.workView="vikr";renderWorkLevel()};$("#work-advanced-toggle").onclick=()=>{ui.workAdvancedOpen=!ui.workAdvancedOpen;renderWorkAdvancedSearch()};$("#choose-work-object").onclick=()=>openStructureEditor("work");
    $("#nav-base").onclick=()=>{ui.baseObjectMode=true;ui.baseGesnFocus=null;ui.baseHistory=[];ui.objectSelection.clear();ui.selection.clear();ui.query="";$("#search").value="";switchSpace("base")};
    const tableScroll=$("#space-base .table-scroll");tableScroll.addEventListener("scroll",saveBaseUi);
    renderAll()
  }
  async function start(){
    const rememberedUi=load(baseUiKey,null);
    await objectFiles.restore();
    if(await objectFiles.permitted())await refreshObjectsFolder(false);
    else if(objectFiles.hasHandle())folderStatus="Нужен доступ к выбранной папке";
    if(objectFiles.isReady()&&rememberedUi?.objectId){const selected=baseObjects.find(o=>o.id===rememberedUi.objectId);if(selected){activeBaseId=selected.id;base=selected.vikrs;baseInfo=selected.info}}
    window.addEventListener("message",handleIntegratedMessage);
    restoreBaseUi(rememberedUi);init();
  }
  start();
})();





