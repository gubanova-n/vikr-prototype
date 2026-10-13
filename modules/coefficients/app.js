(() => {
  "use strict";
  if(window.parent!==window)document.documentElement.classList.add("embedded");

  const META = window.FSNB_COEFFICIENT_META || {};
  const COEFFICIENTS = [...(window.FSNB_COEFFICIENTS || []),...loadCustomCoefficients()];
  const NORMS = window.FSNB_COEFFICIENT_NORMS || [];
  const SELECTORS = window.FSNB_COEFFICIENT_SELECTORS || {};
  const SECTION_BASES = {"02":"ГЭСН","03":"ГЭСНм","04":"ГЭСНр","05":"ГЭСНп","06":"ГЭСНмр"};
  const COMPONENT_LABELS = {labor:"Затраты труда рабочих",machinistLabor:"Затраты труда машинистов",machine:"Машины и механизмы",material:"Материалы"};
  const PAGE_SIZE = 100;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]);
  const normalize = value => String(value ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g,"е").replace(/[–—]/g,"-").replace(/\s+/g," ").trim();
  const formatNumber = (value, digits = 4) => Number.isFinite(Number(value)) ? new Intl.NumberFormat("ru-RU", {maximumFractionDigits:digits}).format(Number(value)) : String(value ?? "—");

  const coefficientByCode = new Map(COEFFICIENTS.map(item => [item.code, item]));
  const normByKey = new Map(NORMS.map(item => [item.key, item]));
  const resolvedPositionsCache = new Map();
  const state = {
    view:"general",
    query:"",
    positionCodes:[],
    node:{type:"all",value:"all",label:"Все позиционные коэффициенты"},
    page:1,
    activeCode:null,
    selection:new Set(),
    expanded:new Set(["scope:С."]),
    formulaVariables:new Map(),
    advanced:{decree:"",formula:"",component:""},
  };

  let lockedPositionCodes=[];
  function loadCustomCoefficients(){try{const items=JSON.parse(localStorage.getItem('vikr-own-coefficients-v1')||'[]');return Array.isArray(items)?items.filter(item=>item?.custom&&typeof item.code==='string'&&typeof item.name==='string'&&item.components&&Array.isArray(item.directCosts)&&Array.isArray(item.sections)&&Array.isArray(item.resourceRules)):[]}catch{return []}}
  function showCustomCoefficient(){
    const positions=lockedPositionCodes.length?lockedPositionCodes:state.view==='positions'?state.positionCodes:[];
    openDialog(`<h2 id="sub-title">Свой коэффициент</h2><div class="advanced-grid"><label class="field"><span>Код</span><input id="own-coefficient-code" placeholder="Можно оставить пустым"></label><label class="field"><span>Наименование / условие применения</span><input id="own-coefficient-name" required></label>${Object.entries(COMPONENT_LABELS).map(([key,label])=>`<label class="field"><span>${esc(label)}</span><input data-own-factor="${key}" inputmode="decimal" value="1"></label>`).join('')}</div><label class="field"><span>Коды ГЭСН (через точку с запятой; пусто — общий коэффициент)</span><input id="own-coefficient-positions" value="${esc(positions.join('; '))}" ${lockedPositionCodes.length?'readonly':''}></label><div class="dialog-actions"><button class="primary" id="own-coefficient-save">${window.parent!==window?"Создать и применить":"Сохранить коэффициент"}</button></div>`,true);
    $('#own-coefficient-save').onclick=()=>{const name=$('#own-coefficient-name').value.trim();if(!name){toast('Укажите наименование коэффициента');return}const components={};for(const input of $$('[data-own-factor]')){const raw=input.value.trim(),value=Number(raw.replace(',','.'));if(!raw||!Number.isFinite(value)||value<0){toast('Укажите неотрицательные числовые коэффициенты');return}components[input.dataset.ownFactor]={value,formula:null}}
      const directCosts=lockedPositionCodes.length?[...lockedPositionCodes]:$('#own-coefficient-positions').value.split(';').map(code=>code.trim()).filter(Boolean);
      if(directCosts.some(code=>!parsePosition(code).code.match(/^\d{2}(?:-\d{2,3}){2,4}$/))){toast('Укажите полный код ГЭСН, например ГЭСН 01-02-087-03');return}
      const code=$('#own-coefficient-code').value.trim()||'СВОЙ-'+crypto.randomUUID().slice(0,8);if(coefficientByCode.has(code)){toast('Коэффициент с таким кодом уже существует');return}
      const item={custom:true,code,name,base:'Свой',path:[{code:'Свои',name:'Свои коэффициенты'}],target:'Расход ресурсов',decree:'Пользовательский',components,hasFormula:false,hasRules:directCosts.length>0,directCosts,sections:[],resourceRules:[],matchCount:directCosts.length};
      try{localStorage.setItem('vikr-own-coefficients-v1',JSON.stringify([...COEFFICIENTS.filter(c=>c.custom),item]))}catch{toast('Не удалось сохранить свой коэффициент');return}
      COEFFICIENTS.push(item);coefficientByCode.set(code,item);state.query='';$('#global-search').value='';state.advanced={decree:'',formula:'',component:''};state.node={type:'all',value:'all',label:'Все позиционные коэффициенты'};closeDialog();switchView(item.hasRules?'positions':'general');state.selection.add(code);state.activeCode=code;updateHeader();renderTree();renderResults();renderSelection();renderDetail(item);toast('Свой коэффициент сохранён');if(window.parent!==window)exportCoefficients(item.hasRules?'position':'object',[code]);
    };
  }


  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
  }

  function openDialog(html, wide = false) {
    $("#sub-dialog-body").innerHTML = html;
    $("#sub-overlay .sub-dialog").classList.toggle("wide", wide);
    $("#sub-overlay").classList.remove("hidden");
  }

  function closeDialog() {
    $("#sub-overlay").classList.add("hidden");
    $("#sub-overlay .sub-dialog").classList.remove("wide");
  }

  function scopeGroups() {
    const groups = new Map();
    for (const item of COEFFICIENTS.filter(item => item.hasRules && (!lockedPositionCodes.length || lockedPositionCodes.map(parsePosition).some(position=>coefficientMatchesPosition(item,position))))) {
      const scope = item.path?.[0] || {code:"—",name:"Без раздела"};
      if (!groups.has(scope.code)) groups.set(scope.code, {scope,count:0,parts:new Map()});
      const group = groups.get(scope.code);
      group.count += 1;
      const part = item.path?.[1] || {code:"—",name:"Без части"};
      if (!group.parts.has(part.code)) group.parts.set(part.code, {part,count:0});
      group.parts.get(part.code).count += 1;
    }
    return groups;
  }

  function updateHeader() {
    const generalCount = COEFFICIENTS.filter(item => !item.hasRules).length;
    const positionCount = COEFFICIENTS.length - generalCount;
    $("#version-caption").textContent = `ФСНБ-2022 · ${META.edition || ""} · ${formatNumber(positionCount,0)} позиционных · ${formatNumber(generalCount,0)} общих`;
    $("#tree-summary").textContent = `${formatNumber(positionCount,0)} позиционных коэффициентов · ${formatNumber(META.normCount || NORMS.length,0)} нормативов`;
  }

  function renderTree() {
    const groups = scopeGroups();
    const positionCount = COEFFICIENTS.filter(item => item.hasRules && (!lockedPositionCodes.length || lockedPositionCodes.map(parsePosition).some(position=>coefficientMatchesPosition(item,position)))).length;
    let html = `<button class="tree-row ${state.node.type === "all" ? "active" : ""}" data-node-type="all" data-node-value="all" data-label="Все позиционные коэффициенты"><span class="tree-glyph root">К</span><span class="tree-copy"><strong>Все позиционные</strong><small>${formatNumber(positionCount,0)} записей</small></span></button>`;
    for (const group of groups.values()) {
      const key = `scope:${group.scope.code}`;
      const expanded = state.expanded.has(key);
      html += `<button class="tree-row level-1 ${state.node.type === "scope" && state.node.value === group.scope.code ? "active" : ""}" data-expand="${esc(key)}" data-node-type="scope" data-node-value="${esc(group.scope.code)}" data-label="${esc(group.scope.name)}"><span class="twisty">${expanded ? "⌄" : "›"}</span><span class="tree-glyph">${esc(group.scope.code.replace(".",""))}</span><span class="tree-copy"><strong>${esc(group.scope.name)}</strong><small>${formatNumber(group.count,0)} коэффициентов</small></span></button>`;
      if (expanded) {
        for (const entry of group.parts.values()) {
          const value = `${group.scope.code}|${entry.part.code}`;
          html += `<button class="tree-row level-2 ${state.node.type === "part" && state.node.value === value ? "active" : ""}" data-node-type="part" data-node-value="${esc(value)}" data-label="${esc(entry.part.name)}"><span class="twisty"></span><span class="tree-glyph">${esc(entry.part.code.replace(/^.*Ч\./,""))}</span><span class="tree-copy"><strong>${esc(entry.part.name)}</strong><small>${formatNumber(entry.count,0)} коэффициентов</small></span></button>`;
        }
      }
    }
    $("#catalog-tree").innerHTML = html;
    $$(".tree-row", $("#catalog-tree")).forEach(button => button.onclick = () => {
      if (button.dataset.expand) {
        if (state.expanded.has(button.dataset.expand)) state.expanded.delete(button.dataset.expand); else state.expanded.add(button.dataset.expand);
      }
      state.node = {type:button.dataset.nodeType,value:button.dataset.nodeValue,label:button.dataset.label};
      state.page = 1;
      state.activeCode = null;
      renderTree();
      renderResults();
      clearDetail();
    });
  }

  function parsePosition(value) {
    const cleaned = String(value || "").trim().replace(/^(ГЭСН(?:мр|м|п|р)?)(?=\d)/i,'$1 ').replace(/\s+/g," ");
    const match = cleaned.match(/^(ГЭСНмр|ГЭСНм|ГЭСНп|ГЭСНр|ГЭСН)\s+(.+)$/i);
    if (match) {
      const canonical = Object.keys({ГЭСН:1,ГЭСНм:1,ГЭСНмр:1,ГЭСНп:1,ГЭСНр:1}).find(key => key.toLocaleLowerCase("ru-RU") === match[1].toLocaleLowerCase("ru-RU"));
      return {base:canonical || match[1],code:match[2]};
    }
    return {base:"",code:cleaned};
  }

  function selectorMatchesPosition(raw, position) {
    const [prefix, ...rest] = raw.split("-");
    const base = SECTION_BASES[prefix] || "";
    const selector = rest.join("-");
    if (position.base && position.base !== base) return false;
    return position.code === selector || position.code.startsWith(selector + "-");
  }

  function coefficientMatchesPosition(item, position) {
    return window.VIKR_COEFFICIENT_MATCH.matches(item,position,true);
  }

  function filteredItems() {
    let items = COEFFICIENTS.filter(item => state.view === "general" ? !item.hasRules : item.hasRules);
    if (state.view === "positions" && state.node.type === "scope") items = items.filter(item => item.path?.[0]?.code === state.node.value);
    if (state.view === "positions" && state.node.type === "part") {
      const [scope, part] = state.node.value.split("|");
      items = items.filter(item => item.path?.[0]?.code === scope && item.path?.[1]?.code === part);
    }
    if (state.view === "positions" && state.positionCodes.length) {
      const positions = state.positionCodes.map(parsePosition).filter(item => item.code);
      items = items.filter(item => positions.some(position => coefficientMatchesPosition(item, position)));
    }
    if (state.advanced.decree) items = items.filter(item => item.decree === state.advanced.decree);
    if (state.advanced.formula === "yes") items = items.filter(item => item.hasFormula);
    if (state.advanced.formula === "no") items = items.filter(item => !item.hasFormula);
    if (state.advanced.component) items = items.filter(item => item.components[state.advanced.component]);
    const query = normalize(state.query);
    if (query) items = items.filter(item => normalize(`${item.code} ${item.name} ${item.decree} ${(item.path || []).map(x => `${x.code} ${x.name}`).join(" ")} ${item.directCosts.join(" ")} ${item.sections.join(" ")}`).includes(query));
    return items;
  }

  function effectBadges(item) {
    const badges = [];
    const shortLabels = {
      labor: "Рабочие",
      machinistLabor: "Машинисты",
      machine: "Машины",
      material: "Материалы",
    };
    for (const [key, label] of Object.entries(COMPONENT_LABELS)) {
      const component = item.components[key];
      if (!component) continue;
      const value = component.formula ? `f(N)` : `×${formatNumber(component.value)}`;
      badges.push(`<span class="badge ${component.formula ? "formula" : ""}" title="${esc(label)}">${esc(shortLabels[key] || label)} ${esc(value)}</span>`);
    }
    if (!item.hasRules) badges.push('<span class="badge general">общий</span>');
    return badges.join("");
  }

  function renderResults() {
    const items = filteredItems();
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state.page = Math.min(state.page, pageCount);
    const offset = (state.page - 1) * PAGE_SIZE;
    const pageItems = items.slice(offset, offset + PAGE_SIZE);
    $("#results-summary").textContent = `${formatNumber(items.length,0)} найдено`;
    $("#result-path").textContent = state.view === "general" ? "Общие коэффициенты для объекта" : state.positionCodes.length ? `Для позиции: ${state.positionCodes.join(", ")}` : state.node.label;
    $("#page-caption").textContent = `Страница ${state.page} из ${pageCount}`;
    $("#page-prev").disabled = state.page <= 1;
    $("#page-next").disabled = state.page >= pageCount;
    $("#results-empty").classList.toggle("hidden", pageItems.length > 0);
    const pageSelectionCount = pageItems.filter(item => state.selection.has(item.code)).length;
    $("#select-all-page").checked = pageItems.length > 0 && pageSelectionCount === pageItems.length;
    $("#select-all-page").indeterminate = pageSelectionCount > 0 && pageSelectionCount < pageItems.length;
    $("#select-all-page").disabled = pageItems.length === 0;
    $("#results-body").innerHTML = pageItems.map(item => `<tr class="${item.code === state.activeCode ? "active" : ""}" data-code="${esc(item.code)}"><td><input class="result-pick" type="checkbox" ${state.selection.has(item.code) ? "checked" : ""} aria-label="Выбрать ${esc(item.code)}"></td><td class="code">${esc(item.code)}</td><td class="name">${esc(item.name)}<small>${state.view === "general" ? "Общий коэффициент для объекта" : esc(item.path?.[1]?.name || item.path?.[0]?.name || "Без раздела")}</small></td><td><div class="effect-line">${effectBadges(item)}</div></td></tr>`).join("");
    $$("#results-body tr").forEach(row => row.onclick = event => {
      if (event.target.matches("input")) return;
      state.activeCode = row.dataset.code;
      renderResults();
      renderDetail(coefficientByCode.get(state.activeCode));
    });
    $$(".result-pick", $("#results-body")).forEach(input => input.onchange = event => {
      const code = event.target.closest("tr").dataset.code;
      if (event.target.checked) state.selection.add(code); else state.selection.delete(code);
      renderSelection();
      event.stopPropagation();
    });
  }

  function clearDetail() {
    $("#detail-empty").classList.remove("hidden");
    $("#detail-content").classList.add("hidden");
    $("#detail-content").innerHTML = "";
  }

  function formulaTokens(formula) {
    const source = formula.toLocaleUpperCase("ru-RU").replace(/(\d),(\d)/g,"$1.$2").replace(/\s+/g,"");
    const tokens = source.match(/ДЕЛЦЕЛ|N|\d+(?:\.\d+)?|[()+\-*/^;]/g) || [];
    if (tokens.join("") !== source) throw new Error("Неподдерживаемая формула");
    return tokens;
  }

  function evaluateFormula(formula, nValue) {
    const tokens = formulaTokens(formula);
    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = expected => {
      const token = tokens[cursor++];
      if (expected && token !== expected) throw new Error(`Ожидалось ${expected}`);
      return token;
    };
    const primary = () => {
      const token = peek();
      if (token === "(") { take("("); const value = expression(); take(")"); return value; }
      if (token === "N") { take(); return Number(nValue); }
      if (token === "ДЕЛЦЕЛ") { take(); take("("); const left = expression(); take(";"); const right = expression(); take(")"); return Math.trunc(left / right); }
      if (/^\d/.test(token || "")) return Number(take());
      throw new Error("Некорректная формула");
    };
    const unary = () => peek() === "-" ? (take("-"), -unary()) : peek() === "+" ? (take("+"), unary()) : primary();
    const power = () => { const left = unary(); return peek() === "^" ? (take("^"), left ** power()) : left; };
    const term = () => { let value = power(); while (["*","/"].includes(peek())) { const operator = take(); const right = power(); value = operator === "*" ? value * right : value / right; } return value; };
    const expression = () => { let value = term(); while (["+","-"].includes(peek())) { const operator = take(); const right = term(); value = operator === "+" ? value + right : value - right; } return value; };
    const value = expression();
    if (cursor !== tokens.length || !Number.isFinite(value)) throw new Error("Формула не вычислена");
    return value;
  }

  function resolvedComponent(component, nValue) {
    if (!component) return null;
    if (component.formula) {
      try { return evaluateFormula(component.formula, nValue); } catch { return null; }
    }
    const value = Number(String(component.value).replace(",","."));
    return Number.isFinite(value) ? value : null;
  }

  function renderComponentCards(item, nValue) {
    return Object.entries(COMPONENT_LABELS).map(([key,label]) => {
      const component = item.components[key];
      if (!component) return `<div class="effect-card inactive"><small>${esc(label)}</small><strong>Не изменяется</strong></div>`;
      const resolved = resolvedComponent(component, nValue);
      return `<div class="effect-card" data-component="${key}"><small>${esc(label)}</small>${component.formula ? `<code>${esc(component.formula)}</code><strong class="resolved-value">${resolved === null ? "—" : `×${formatNumber(resolved,6)}`}</strong>` : `<strong>×${esc(formatNumber(component.value,6))}</strong>`}</div>`;
    }).join("");
  }

  function shortRuleList(values, type) {
    const shown = values.slice(0,8);
    if (!shown.length) return "";
    return `<ul class="rule-list">${shown.map(value => `<li><span>${type === "cost" ? "Позиция" : "Раздел или таблица"}</span><code>${esc(value)}</code></li>`).join("")}${values.length > shown.length ? `<li><span>Остальные ссылки</span><strong>ещё ${formatNumber(values.length-shown.length,0)}</strong></li>` : ""}</ul>`;
  }

  function renderResourceRules(item) {
    if (!item.resourceRules.length) return "";
    const rows = item.resourceRules.flatMap(rule => rule.resources.map(code => `<tr><td><code>${esc(code)}</code></td><td>${Object.entries(rule.factors).map(([key,value]) => `${esc(COMPONENT_LABELS[key === "Material" ? "material" : key === "Machine" ? "machine" : "machinistLabor"] || key)}: ×${esc(value)}`).join("<br>")}</td></tr>`)).join("");
    return `<div class="section-head"><h3>Изменения отдельных ресурсов</h3><small>${formatNumber(item.resourceRules.reduce((sum,rule) => sum + rule.resources.length,0),0)} ссылок</small></div><table class="resource-adjustments"><thead><tr><th>Код ресурса или группы</th><th>Действие</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderDetail(item) {
    if (!item) return clearDetail();
    $("#detail-empty").classList.add("hidden");
    $("#detail-content").classList.remove("hidden");
    const isGeneral = !item.hasRules;
    const nValue = state.formulaVariables.get(item.code) ?? 1;
    const formulaEditor = item.hasFormula ? `<div class="formula-editor"><label class="field"><span>Значение N</span><input id="formula-n" type="number" step="1" value="${esc(nValue)}"></label><span>Формулы пересчитываются перед передачей коэффициента в основную систему.</span></div>` : "";
    const crumb = isGeneral ? "" : `<div class="crumb">${(item.path || []).map(part => esc(`${part.code} ${part.name}`)).join(" → ")}</div>`;
    const actionButtons = isGeneral
      ? `<button class="primary" id="detail-add-object">К выбранному уровню</button>`
      : `<button class="soft" id="detail-add-position">К позиции</button><button class="soft" id="detail-add-group">К группе</button><button class="primary" id="detail-add-object">К объекту по правилам</button>`;
    const application = isGeneral
      ? `<div class="section-head"><h3>Применение</h3><small>общий коэффициент</small></div><div class="note general-note"><strong>Применяется ко всему выбранному уровню.</strong> Коэффициент будет сохранён на элементе, из которого открыт модуль, и распространён на все вложенные позиции и ресурсы. Условие выбора указано в наименовании коэффициента.</div>`
      : `<div class="section-head"><h3>Область применения</h3><button class="quiet" id="show-positions">Показать позиции</button></div><div class="rule-summary"><div class="rule-box"><small>Прямые позиции</small><strong>${formatNumber(item.directCosts.length,0)}</strong></div><div class="rule-box"><small>Разделы и таблицы</small><strong>${formatNumber(item.sections.length,0)}</strong></div><div class="rule-box"><small>После раскрытия правил</small><strong>${formatNumber(item.matchCount,0)}</strong></div></div>${shortRuleList(item.directCosts,"cost")}${shortRuleList(item.sections,"section")}<div class="note">При применении к объекту коэффициент будет назначен только позициям, которые перечислены непосредственно или входят в указанные разделы ФСНБ.</div>${renderResourceRules(item)}`;
    $("#detail-content").innerHTML = `${crumb}<div class="detail-kicker">${esc(item.code)}</div><h2>${esc(item.name)}</h2><div class="detail-stats"><div class="stat"><small>Приказ</small><strong>${esc(item.decree)}</strong></div><div class="stat"><small>Изменяемая величина</small><strong>${esc(item.target)}</strong></div><div class="stat"><small>Применение</small><strong>${isGeneral ? "Все позиции объекта" : `${formatNumber(item.matchCount,0)} позиций`}</strong></div></div><div class="detail-actions">${actionButtons}</div><div class="section-head"><h3>Коэффициенты к расходу ресурсов</h3><small>${item.hasFormula ? "с формулой" : "фиксированные значения"}</small></div><div class="effect-grid">${renderComponentCards(item,nValue)}</div>${formulaEditor}${application}`;
    if ($("#detail-add-position")) $("#detail-add-position").onclick = () => exportCoefficients("position", [item.code]);
    if ($("#detail-add-group")) $("#detail-add-group").onclick = () => exportCoefficients("group", [item.code]);
    $("#detail-add-object").onclick = () => exportCoefficients("object", [item.code]);
    if ($("#show-positions")) $("#show-positions").onclick = () => showPositions(item);
    if ($("#formula-n")) $("#formula-n").oninput = event => {
      const value = Number(event.target.value);
      state.formulaVariables.set(item.code, Number.isFinite(value) ? value : 1);
      for (const [key, component] of Object.entries(item.components)) {
        if (!component.formula) continue;
        const resolved = resolvedComponent(component, state.formulaVariables.get(item.code));
        const target = $(`[data-component="${key}"] .resolved-value`, $("#detail-content"));
        if (target) target.textContent = resolved === null ? "—" : `×${formatNumber(resolved,6)}`;
      }
    };
  }

  function resolvePositions(item) {
    if (resolvedPositionsCache.has(item.code)) return resolvedPositionsCache.get(item.code);
    const indexes = new Set();
    for (const key of item.directCosts) {
      const norm = normByKey.get(key);
      if (norm) indexes.add(norm.i);
    }
    for (const selector of item.sections) for (const index of SELECTORS[selector] || []) indexes.add(index);
    const result = [...indexes].map(index => NORMS[index]).filter(Boolean).sort((a,b) => a.base.localeCompare(b.base,"ru") || a.code.localeCompare(b.code,"ru",{numeric:true}));
    resolvedPositionsCache.set(item.code, result);
    return result;
  }

  function showPositions(item) {
    const positions = resolvePositions(item);
    const limit = 500;
    openDialog(`<h2 id="sub-title">Позиции, попадающие под правило</h2><p><strong>${esc(item.code)}</strong> · ${esc(item.name)}</p><div class="position-preview"><table><thead><tr><th>Код</th><th>Наименование</th><th>Ед. изм.</th></tr></thead><tbody>${positions.slice(0,limit).map(norm => `<tr><td><code>${esc(norm.key)}</code></td><td>${esc(norm.name)}</td><td>${esc(norm.unit || "—")}</td></tr>`).join("")}</tbody></table></div>${positions.length > limit ? `<div class="note">Показаны первые ${formatNumber(limit,0)} из ${formatNumber(positions.length,0)} позиций. При передаче учитывается полный список.</div>` : ""}`, true);

  }

  function renderSelection() {
    const count = state.selection.size;
    const isGeneral = state.view === "general";
    $("#selection-count").textContent = count ? `Выбрано: ${formatNumber(count,0)}` : "Ничего не выбрано";
    $("#selection-hint").textContent = isGeneral
      ? count ? "Общие коэффициенты будут применены ко всем позициям объекта" : "Можно выбрать один или несколько общих коэффициентов"
      : count ? "Можно применить к позиции, группе или объекту по правилам XML" : "Можно выбрать один коэффициент или группу";
    $("#selection-clear").disabled = !count;
    $("#add-position").classList.toggle("hidden", isGeneral);
    $("#add-group").classList.toggle("hidden", isGeneral);
    $("#add-position").disabled = !count || isGeneral;
    $("#add-group").disabled = !count || isGeneral;
    $("#add-object").disabled = !count;
    $("#add-object").textContent = isGeneral ? "К выбранному уровню" : "К выбранному уровню по правилам";
    $("#add-object").title = "";
  }

  function preparedCoefficient(item) {
    const nValue = state.formulaVariables.get(item.code) ?? 1;
    const resolvedComponents = {};
    for (const [key, component] of Object.entries(item.components)) resolvedComponents[key] = {source:{...component},factor:resolvedComponent(component,nValue)};
    return {
      code:item.code,
      name:item.name,
      base:item.base,
      path:structuredClone(item.path),
      target:item.target,
      decree:item.decree,
      formulaN:item.hasFormula ? nValue : null,
      components:resolvedComponents,
      application:{
        type:item.hasRules ? "matchedPositions" : "allObjectPositions",
        directCosts:[...item.directCosts],
        sections:[...item.sections],
        resourceRules:structuredClone(item.resourceRules),
        matchCount:item.hasRules ? item.matchCount : null,
        automatic:true,
        appliesToAll:!item.hasRules,
      },
    };
  }

  function buildPayload(scope, codes = [...state.selection]) {
    const items = codes.map(code => coefficientByCode.get(code)).filter(Boolean);
    const hasGeneral = items.some(item => !item.hasRules);
    const hasPosition = items.some(item => item.hasRules);
    if (hasGeneral && hasPosition) throw new Error("Общие и позиционные коэффициенты нельзя передавать одним пакетом");
    if (scope !== "object" && hasGeneral) throw new Error("Общие коэффициенты добавляются только к объекту");
    return {
      schemaVersion:1,
      module:"fsnb-coefficients",
      database:{title:META.title,edition:META.edition,sourceFile:META.sourceFile},
      targetScope:scope,
      context:{positionCodes:[...state.positionCodes]},
      items:items.map(preparedCoefficient),
    };
  }

  function exportCoefficients(scope, codes = [...state.selection]) {
    try {
      const payload = buildPayload(scope,codes);
      window.dispatchEvent(new CustomEvent("fsnb-coefficients:select", {detail:payload}));
      if (window.parent && window.parent !== window) window.parent.postMessage({type:"vikr:coefficient-select",payload}, "*");
      if (typeof window.FSNBCoefficientModule?.onSelect === "function") window.FSNBCoefficientModule.onSelect(payload);
      const containsGeneral = payload.items.some(item => item.application.appliesToAll);
      const scopeLabel = scope === "object" ? containsGeneral ? "к объекту" : "к объекту по правилам" : {position:"к позиции",group:"к группе позиций"}[scope];
      openDialog(`<h2 id="sub-title">Коэффициенты подготовлены</h2><p>Сформирован пакет для передачи ${esc(scopeLabel)}. В автономном режиме его можно проверить ниже.</p><div class="export-preview">${esc(JSON.stringify(payload,null,2))}</div>`, true);

      toast(`Подготовлено коэффициентов: ${payload.items.length}`);
    } catch (error) {
      toast(error.message);
    }
  }

  function showAdvanced() {
    const decrees = META.decrees || [];
    openDialog(`<h2 id="sub-title">Расширенный поиск</h2><p>Фильтры применяются только внутри выбранного вида коэффициентов.</p><div class="advanced-grid"><label class="field"><span>Приказ</span><select id="adv-decree"><option value="">Все приказы</option>${decrees.map(item => `<option value="${esc(item.code)}" ${state.advanced.decree === item.code ? "selected" : ""}>${esc(item.code)} · ${formatNumber(item.count,0)}</option>`).join("")}</select></label><label class="field"><span>Формула</span><select id="adv-formula"><option value="">Любой вид</option><option value="yes" ${state.advanced.formula === "yes" ? "selected" : ""}>Требуется значение N</option><option value="no" ${state.advanced.formula === "no" ? "selected" : ""}>Фиксированное значение</option></select></label><label class="field"><span>Изменяемый ресурс</span><select id="adv-component"><option value="">Любой</option>${Object.entries(COMPONENT_LABELS).map(([key,label]) => `<option value="${key}" ${state.advanced.component === key ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label></div><div class="dialog-actions"><button class="outline" id="adv-reset">Сбросить</button><button class="primary" id="adv-apply">Применить</button></div>`);

    $("#adv-reset").onclick = () => { state.advanced={decree:"",formula:"",component:""}; state.page=1; closeDialog(); renderResults(); };
    $("#adv-apply").onclick = () => {
      state.advanced.decree = $("#adv-decree").value;
      state.advanced.formula = $("#adv-formula").value;
      state.advanced.component = $("#adv-component").value;
      state.page=1;
      closeDialog();
      renderResults();
    };
  }

  function showDatabaseInfo() {
    openDialog(`<h2 id="sub-title">${esc(META.title || "Поправочные коэффициенты ФСНБ-2022")}</h2><p>${esc(META.edition || "")} · источник: ${esc(META.sourceFile || "—")}</p><div class="detail-stats"><div class="stat"><small>Всего коэффициентов</small><strong>${formatNumber(META.coefficientCount || 0,0)}</strong></div><div class="stat"><small>Для позиций</small><strong>${formatNumber(META.withRulesCount || 0,0)}</strong></div><div class="stat"><small>Общие</small><strong>${formatNumber(META.withoutRulesCount || 0,0)}</strong></div></div><h3>Как разделены данные XML</h3><ul><li><strong>Для позиций</strong> — коэффициенты с <strong>Applys</strong>. Ссылки Cost и Section определяют конкретные позиции ФСНБ.</li><li><strong>Общие</strong> — коэффициенты без <strong>Applys</strong>. Они выбираются отдельно и применяются ко всем позициям объекта.</li><li><strong>Resources</strong> — отдельные изменения машин, материалов или труда машинистов внутри подходящих позиций.</li></ul>`);

  }

  function showUpdateInfo() {
    openDialog(`<h2 id="sub-title">Обновление коэффициентов</h2><p>Модуль обновляется из полного комплекта XML ФСНБ. Вместе с коэффициентами повторно строится индекс нормативов, необходимый для раскрытия правил Section.</p><ol><li>Скачать новую редакцию открытых данных ФСНБ.</li><li>Поместить нормативные XML и файл рекомендуемой привязки коэффициентов в одну папку.</li><li>Запустить <strong>«Обновить данные.cmd»</strong> и выбрать эту папку.</li><li>Текущие данные заменятся только после проверки всех ссылок.</li></ol>`);

  }

  function switchView(view) {
    state.view = view;
    state.page = 1;
    state.activeCode = null;
    state.selection.clear();
    const isGeneral = view === "general";
    $("#position-context").classList.toggle("hidden", isGeneral);
    $("#catalog-pane").classList.toggle("hidden", isGeneral);
    $("#module-workspace").classList.toggle("general-view", isGeneral);
    $("#global-search").placeholder = isGeneral ? "Код или условие применения общего коэффициента" : "Код, условие применения или норматив ФСНБ";
    $$(".view-switch button").forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",String(active));
    });
    renderSelection();
    renderResults();
    const initial = filteredItems()[0];
    if (initial) {
      state.activeCode = initial.code;
      renderResults();
      renderDetail(initial);
    } else {
      clearDetail();
    }
  }

  function applyPositionContext() {
    if(lockedPositionCodes.length)return;
    const value = $("#position-code").value.trim();
    state.positionCodes = value ? [value] : [];
    state.page=1;
    state.activeCode=null;
    renderResults();
    clearDetail();
  }

  function openModule(options = {}) {
    lockedPositionCodes=options.restrictPositions?[...(options.positionCodes||[])]:[];
    state.positionCodes=[...(options.positionCodes||[])];
    $("#position-code").readOnly=lockedPositionCodes.length>0;
    $("#position-apply").classList.toggle("hidden",lockedPositionCodes.length>0);
    $("#position-context small").textContent=lockedPositionCodes.length?"Показаны только коэффициенты, применимые к открытой ГЭСН.":"Без кода показаны все позиционные коэффициенты. Поиск учитывает прямые ссылки и правила разделов.";
    $("#coefficient-overlay").classList.remove("hidden");
    $("#module-launcher").classList.add("hidden");
    if (typeof options.onSelect === "function") window.FSNBCoefficientModule.onSelect = options.onSelect;
    if (options.positionCodes?.length) {
      state.positionCodes = [...options.positionCodes];
      $("#position-code").value = state.positionCodes.join("; ");
      switchView(options.restrictPositions?"positions":"general");
    } else {
      switchView("general");
    }
    renderTree();
  }

  function closeModule() {
    $("#coefficient-overlay").classList.add("hidden");
    $("#module-launcher").classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("fsnb-coefficients:close"));
    if (window.parent && window.parent !== window) window.parent.postMessage({type:"vikr:module-close",module:"coefficients"}, "*");
  }

  function init() {
    window.FSNBCoefficientModule = {open:openModule,close:closeModule,getSelection:(scope="position") => buildPayload(scope),onSelect:null};
    updateHeader();
    renderTree();
    renderResults();
    renderSelection();
    $("#global-search").oninput = event => { state.query=event.target.value; state.page=1; renderResults(); };
    $("#advanced-search").onclick = showAdvanced;
    $("#custom-coefficient").onclick=showCustomCoefficient;
    window.addEventListener("message",event=>{if(event.source!==window.parent||event.data?.type!=="vikr:coefficient-context")return;openModule(event.data.options||{});if(event.data.options?.createCustom)showCustomCoefficient()});
    $("#database-info").onclick = showDatabaseInfo;
    $("#database-update").onclick = showUpdateInfo;
    $("#module-close").onclick = closeModule;
    $("#module-launcher").onclick = () => openModule();
    $("#sub-close").onclick = closeDialog;
    
    $$(".view-switch button").forEach(button => button.onclick = () => switchView(button.dataset.view));
    $("#position-apply").onclick = applyPositionContext;
    $("#position-code").onkeydown = event => { if (event.key === "Enter") applyPositionContext(); };
    $("#page-prev").onclick = () => { state.page-=1; renderResults(); };
    $("#page-next").onclick = () => { state.page+=1; renderResults(); };
    $("#select-all-page").onchange = event => {
      const pageItems = filteredItems().slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);
      for (const item of pageItems) event.target.checked ? state.selection.add(item.code) : state.selection.delete(item.code);
      renderSelection();
      renderResults();
    };
    $("#selection-clear").onclick = () => { state.selection.clear(); renderSelection(); renderResults(); };
    $("#add-position").onclick = () => exportCoefficients("position");
    $("#add-group").onclick = () => exportCoefficients("group");
    $("#add-object").onclick = () => exportCoefficients("object");
    $("#collapse-tree").onclick = () => { state.expanded.clear(); renderTree(); };
    document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#global-search").focus(); }
      
    });
    switchView("general");
  }

  init();
})();
