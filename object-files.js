/* Файлы выбранной пользователем папки — единственный источник объектов. */
window.VIKR_OBJECT_FILES = (() => {
  let directory=null,ready=false,dbPromise;
  const records=new Map(),handleKey="objects-directory-file-only";
  function openDb(){
    if(!window.indexedDB)return Promise.resolve(null);
    dbPromise||=new Promise(resolve=>{try{
      const request=indexedDB.open("vikr-prototype-v4.1-files",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("handles");
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null);
    }catch{resolve(null)}});return dbPromise;
  }
  async function restore(){
    const db=await openDb();if(!db)return false;
    directory=await new Promise(resolve=>{try{const request=db.transaction("handles","readonly").objectStore("handles").get(handleKey);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>resolve(null)}catch{resolve(null)}});
    ready=false;records.clear();return Boolean(directory);
  }
  async function remember(handle){
    const db=await openDb();if(!db)return false;
    return new Promise(resolve=>{try{const tx=db.transaction("handles","readwrite");tx.objectStore("handles").put(handle,handleKey);tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false)}catch{resolve(false)}});
  }
  async function permitted(prompt=false){
    if(!directory){ready=false;return false}
    try{const granted=await directory.queryPermission({mode:"readwrite"})==="granted"||prompt&&await directory.requestPermission({mode:"readwrite"})==="granted";
      if(!granted)ready=false;return Boolean(granted);
    }catch{ready=false;return false}
  }
  async function choose(){
    if(typeof window.showDirectoryPicker!=="function")return {ok:false,reason:"unsupported"};
    try{
      const selected=await window.showDirectoryPicker({id:"vikr-objects",mode:"readwrite"});
      const granted=await selected.queryPermission({mode:"readwrite"})==="granted"||await selected.requestPermission({mode:"readwrite"})==="granted";
      if(!granted)return {ok:false,reason:"denied"};
      directory=selected;ready=false;records.clear();await remember(selected);return {ok:true};
    }catch(error){return {ok:false,reason:error?.name==="AbortError"?"cancelled":"denied",errorName:error?.name}}
  }
  async function fingerprint(text){
    const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
    return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,"0")).join("");
  }
  function validObject(data){
    if(!data||typeof data.id!=="string"||!data.id||!data.info||typeof data.info.title!=="string"||!Array.isArray(data.vikrs))return false;
    if(data.format&&data.format!=="vikr-object-v1")return false;
    return data.vikrs.every(v=>v&&typeof v.id==="string"&&typeof v.name==="string"&&Array.isArray(v.gesn)&&v.gesn.every(p=>p&&typeof p.id==="string"&&typeof p.name==="string"&&Array.isArray(p.resources)&&p.resources.every(r=>r&&typeof r.name==="string")));
  }
  async function list(){
    if(!await permitted())return null;
    const objects=[],invalid=[],nextRecords=new Map();
    try{
      // Браузер не гарантирует порядок перечисления файлов папки.
      const entries=[],byName=new Intl.Collator("ru",{numeric:true,sensitivity:"base"});
      for await(const [name,entry] of directory.entries())if(entry.kind==="file"&&name.toLowerCase().endsWith(".json"))entries.push([name,entry]);
      entries.sort(([a],[b])=>byName.compare(a,b)||(a<b?-1:a>b?1:0));
      for(const [name,entry] of entries){
        if(entry.kind!=="file"||!name.toLowerCase().endsWith(".json"))continue;
        try{
          const raw=await(await entry.getFile()).text(),data=JSON.parse(raw);
          if(!validObject(data)||nextRecords.has(data.id))throw Error("invalid-object");
          objects.push({id:data.id,info:data.info,vikrs:data.vikrs,packages:Array.isArray(data.packages)?data.packages:[]});
          nextRecords.set(data.id,{name,hash:await fingerprint(raw)});
        }catch{invalid.push(name)}
      }
      records.clear();for(const [id,record] of nextRecords)records.set(id,record);ready=true;
      return {objects,invalid};
    }catch{ready=false;records.clear();return null}
  }
  function titleStem(object){
    let stem=String(object.info?.title||"Объект").replace(/[<>:"/\\|?*\x00-\x1f]/g,"_").replace(/[. ]+$/g,"").trim().slice(0,120);
    if(!stem)stem="Объект";if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(stem))stem="_"+stem;
    return stem;
  }
  async function titleFileName(object,previous){
    const occupied=new Set();
    for await(const [name,entry] of directory.entries())if(entry.kind==="file"&&name!==previous)occupied.add(name.toLowerCase());
    const stem=titleStem(object);for(let n=1;;n++){const name=stem+(n===1?"":" ("+n+")")+".json";if(!occupied.has(name.toLowerCase()))return name}
  }
  async function unchanged(record){
    if(!record)return false;
    try{const file=await directory.getFileHandle(record.name);return await fingerprint(await(await file.getFile()).text())===record.hash}catch{return false}
  }
  async function write(object,{create=false}={}){
    if(!ready||!await permitted()||!validObject(object))return false;
    const previous=records.get(object.id);
    if(previous&&!await unchanged(previous)||!previous&&!create)return false;
    try{
      const name=await titleFileName(object,previous?.name),raw=JSON.stringify({format:"vikr-object-v1",id:object.id,info:object.info,vikrs:object.vikrs,packages:object.packages||[]});
      const file=await directory.getFileHandle(name,{create:true}),stream=await file.createWritable();
      await stream.write(raw);await stream.close();
      if(previous&&previous.name!==name){
        try{await directory.removeEntry(previous.name)}catch{await directory.removeEntry(name);return false}
      }
      records.set(object.id,{name,hash:await fingerprint(raw)});return true;
    }catch{return false}
  }
  async function remove(id){
    if(!ready||!await permitted())return false;
    const record=records.get(id);if(!record)return false;
    try{
      try{await directory.getFileHandle(record.name)}catch(error){if(error?.name==="NotFoundError"){records.delete(id);return true}throw error}
      if(!await unchanged(record))return false;
      await directory.removeEntry(record.name);records.delete(id);return true;
    }catch{return false}
  }
  return {restore,choose,permitted,list,write,remove,hasHandle:()=>Boolean(directory),isReady:()=>ready,folderName:()=>directory?.name||""};
})();
