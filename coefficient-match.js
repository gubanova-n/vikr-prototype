/* Distinguish positional recommendation from broad conditional eligibility. */
window.VIKR_COEFFICIENT_MATCH=(()=>{
  const parse=value=>{const s=String(value||'').toUpperCase().replace(/\s/g,'');const m=s.match(/^(ГЭСНМР|ГЭСНМ|ГЭСНР|ГЭСНП|ГЭСН)?(\d{2}(?:-\d{2,3}){0,4})$/);return m?{base:m[1]||'',code:m[2]}:{base:'',code:''}};
  const families={'02':'ГЭСН','03':'ГЭСНМ','04':'ГЭСНР','05':'ГЭСНП','06':'ГЭСНМР'};
  function matches(item,value,recommended=true){
    const p=typeof value==='string'?parse(value):parse((value.base||'')+' '+(value.code||''));if(!p.code)return false;
    const app=item.application||item,direct=app.directCosts||[],sections=app.sections||[];
    if(app.appliesToAll)return true;
    if(direct.some(s=>{const d=parse(s);return d.code===p.code&&(!p.base||!d.base||p.base===d.base)}))return true;
    const origin=(String(item.code||'').match(/(ГЭСН(?:мр|м|р|п)?)-ПР-(\d{2})-/i)||[]),originBase=(origin[1]||item.base||'').toUpperCase(),originBook=origin[2];
    const targetBooks=new Set(sections.map(s=>{const [family,book]=s.split('-');return family+'-'+book}));
    return sections.some(s=>{const [family,...parts]=s.split('-'),base=families[family],selector=parts.join('-');if(!base||p.base&&p.base!==base||!(p.code===selector||p.code.startsWith(selector+'-')))return false;
      // Broad references to multiple foreign collections describe production conditions,
      // not a recommendation for every norm in those collections. Specific cross-book
      // references and a sole target collection remain visible (including ГЭСН33 3.19).
      return !recommended||item.custom||parts.length>1||(originBase===base&&originBook===parts[0])||targetBooks.size===1;
    });
  }
  return {parse,matches};
})();
