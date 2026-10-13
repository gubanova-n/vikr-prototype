/* Large FGIS workbook is parsed away from the interface thread. No external network. */
importScripts('../excel/vendor/jszip.min.js');
const decode=s=>s.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,h,n,e)=>h?String.fromCodePoint(parseInt(h,16)):n?String.fromCodePoint(Number(n)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[e.toLowerCase()]));
const text=s=>[...s.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m=>decode(m[1])).join('');
const num=s=>{if(s==null||String(s).trim()===''||String(s).trim()==='-')return null;const n=Number(String(s).replace(/[\s\u00a0]/g,'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:null};
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
const key=s=>String(s||'').trim().replace(/^(?:ФСБЦ|ФСЭМ)[- ]*/i,'').replace(/\s/g,'').replace(/[–—]/g,'-').replace(/^([14])-100-(\d{2,3})$/,(_,a,g)=>a+'-100-'+String(Number(g)).padStart(3,'0'));
onmessage=async({data})=>{try{
  postMessage({progress:5,label:'Чтение файла'});
  const zip=await JSZip.loadAsync(data.buffer),name=Object.keys(zip.files).find(p=>/\/Data\.xml$/i.test(p)||/^Data\.xml$/i.test(p));
  if(data.kind==='estimate'){
    if(!name)throw Error('В архиве GSFX нет Data.xml');
    const bytes=await zip.file(name).async('uint8array'),head=new TextDecoder().decode(bytes.slice(0,180)),encoding=head.match(/encoding=["']([^"']+)/)?.[1]||'utf-8';
    const xml=new TextDecoder(encoding).decode(bytes),region=attrs(xml.match(/<RegionInfo\b([^>]*)/)?.[1]||''),positions={},ambiguous=new Set();
    for(const m of xml.matchAll(/<Position\b([^>]*)>([\s\S]*?)<\/Position>/g)){
      const p=attrs(m[1]),resources={};
      for(const r of m[2].matchAll(/<(Mch|Mat|Ot)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/g)){
        const a=attrs(r[2]),inner=r[3]||'',price=attrs(inner.match(/<PriceCurr\b([^>]*)/)?.[1]||''),base=attrs(inner.match(/<PriceBase\b([^>]*)/)?.[1]||'');
        let code=a.Code,kind=r[1]==='Mch'?'machines':r[1]==='Ot'?'workers':'materials';
        if(code)resources[key(code)]={unit:a.Units,value:num(price.Value??a.Price??base.Value),level:price.Value!=null?'current':'base',name:a.Caption,kind};
        if(kind==='machines')for(const d of inner.matchAll(/<Tzm2022\b([^>]*)\/>/g)){const v=attrs(d[1]);if(v.WorkClass)resources[key('4-100-'+Math.round(Number(v.WorkClass.replace(',','.'))*10))]={unit:'чел.-ч',value:num(v.Price),level:'current',kind:'drivers'};}
      }
      const k=p.Number+'|'+String(p.Code||'').replace(/\s/g,'').toUpperCase();
      if(positions[k]){delete positions[k];ambiguous.add(k)}else if(!ambiguous.has(k))positions[k]={vr:p.Vr2001,resources};
    }
    postMessage({result:{format:'vikr-estimate-prices-v1',name:data.name,region:region.AdmRegionZone||'',regionCode:region.AdmRegionCode||'',zoneCode:region.AdmRegionZoneCode||'',positions,ambiguous:ambiguous.size}});return;
  }
  postMessage({progress:20,label:'Распаковка сплит-формы'});
  const shared=zip.file('xl/sharedStrings.xml'),strings=shared?[...(await shared.async('string')).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>text(m[1])):[];
  const wb=await zip.file('xl/workbook.xml').async('string'),relId=attrs(wb.match(/<sheet\b([^>]*)/)?.[1]||'')['r:id'];
  const rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');let target;
  for(const m of rels.matchAll(/<Relationship\b([^>]*)\/>/g)){const a=attrs(m[1]);if(a.Id===relId)target=a.Target;}
  const path=target?(target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'')):'xl/worksheets/sheet1.xml';
  if(!zip.file(path))throw Error('Не найден лист сплит-формы');
  const xml=await zip.file(path).async('string'),records={},ambiguous=new Set();let title='',region='',zone='',count=0,header=false;
  for(const m of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
    const cols={};for(const c of m[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const a=attrs(c[1]),v=c[2]?.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]??'';cols[a.r?.replace(/\d/g,'')]=a.t==='s'?strings[Number(v)]||'':a.t==='inlineStr'?text(c[2]||''):decode(v);}
    if(Number(m[1])===1)title=cols.A||'';
    if(/Наименование субъекта Российской Федерации/i.test(cols.A||''))region=cols.G||'';
    if(/Наименование зоны субъекта/i.test(cols.A||''))zone=cols.G||'';
    if(/Код ресурса/i.test(cols.A||'')&&/текущем уровне цен/i.test(cols.H||'')){header=true;continue}
    if(!header||!/^\d[\d.]*-\d/.test(cols.A||''))continue;
    const code=key(cols.A),item={unit:cols.C||'',base:num(cols.E),current:num(cols.H),index:num(cols.I),group:cols.F||''};
    if(records[code]&&JSON.stringify(records[code])!==JSON.stringify(item)){delete records[code];ambiguous.add(code)}else if(!ambiguous.has(code))records[code]=item;
    if(++count%10000===0)postMessage({progress:Math.min(95,35+count/5000),label:'Прочитано ресурсов: '+count.toLocaleString('ru-RU')});
  }
  if(!header||!Object.keys(records).length)throw Error('Файл не содержит ожидаемые столбцы сплит-формы ФГИС ЦС (A–I). Цены не загружены.');
  postMessage({result:{format:'vikr-split-v1',name:data.name,title,region,zone,period:title.match(/на (.+? года)/)?.[1]||'',records,ambiguous:ambiguous.size,count:Object.keys(records).length,loadedAt:new Date().toISOString()}});
}catch(e){postMessage({error:e.message})}};
