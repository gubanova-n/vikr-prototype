window.VIKR_PRICES=(()=>{
  const key=s=>String(s||'').trim().replace(/^(?:ФСБЦ|ФСЭМ)[- ]*/i,'').replace(/\s/g,'').replace(/[–—]/g,'-').replace(/^([14])-100-(\d{2,3})$/,(_,a,g)=>a+'-100-'+String(Number(g)).padStart(3,'0'));
  const unit=s=>String(s||'').toLowerCase().replace(/м/g,'m').replace(/\s|\./g,'').replace(/³/g,'3');
  async function read(file,kind='split',progress=()=>{}){
    if(file.size>150*1024*1024)throw Error('Файл больше 150 МБ. Используйте сплит-форму без лишних листов.');
    const buffer=await file.arrayBuffer();
    const url=URL.createObjectURL(new Blob([window.VIKR_PRICE_WORKER_CODE],{type:'text/javascript'})),worker=new Worker(url);
    const stop=()=>{worker.terminate();URL.revokeObjectURL(url)};
    return new Promise((resolve,reject)=>{worker.onmessage=({data})=>{if(data.error){stop();reject(Error(data.error))}else if(data.result){stop();resolve(data.result)}else progress(data.progress,data.label)};worker.onerror=()=>{stop();reject(Error('Не удалось прочитать файл в фоне. Проверьте комплект файлов модуля цен.'))};worker.postMessage({buffer,name:file.name,kind},[buffer]);});
  }
  function lookup(info,r,p={}){
    const item=info?.splitForm?.records?.[key(r.code)];
    if(item&&unit(item.unit)===unit(r.unit)){
      if(item.current!==null&&item.current!==undefined)return {value:item.current,source:'Сплит-форма',current:true,detail:'Текущая цена',base:item.base};
      if(item.base!==null&&item.base!==undefined&&item.index!==null&&item.index!==undefined)return {value:item.base,source:'Сплит-форма',current:false,index:item.index,detail:'Базовая цена × индекс группы '+item.group,base:item.base};
    }
    const n=p.meta?.estimatePosition,k=n+'|'+String(p.code||'').replace(/\s/g,'').toUpperCase(),e=info?.estimatePricing?.positions?.[k]?.resources?.[key(r.code)];
    const value=r.estimatePrice??r.meta?.estimatePrice??e?.value;
    const estimate=value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&(!e?.unit||unit(e.unit)===unit(r.unit))?{value:Number(value),source:'Цена из Гранд-Сметы',current:e?.level!=='base'}:null;
    return {value:null,source:'Не учтена цена',estimate,error:item&&unit(item.unit)!==unit(r.unit)?'Не совпадает единица сплит-формы':''};
  }
  return {read,key,unit,lookup};
})();
