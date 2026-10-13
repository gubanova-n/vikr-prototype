(() => {
  "use strict";
  if(window.parent!==window)document.documentElement.classList.add("embedded");

  const META = window.FSNB_META || {};
  const NORMS = window.FSNB_INDEX || [];
  const RESOURCES = window.FSNB_RESOURCE_INDEX || [];
  const HIERARCHY = window.FSNB_HIERARCHY || {norms:[], resources:[]};
  const TG = window.FSNB_TG || {};
  const USAGE = window.FSNB_RESOURCE_USAGE || [];
  const PAGE_SIZE = 100;
  const CHUNK_SIZE = 200;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
  const norm = (value) => String(value ?? "").toLocaleLowerCase("ru-RU").replace(/ё/g,"е").replace(/[–—]/g,"-").replace(/\s+/g," ").trim();
  const formatNumber = (value, digits = 5) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? new Intl.NumberFormat("ru-RU", {maximumFractionDigits:digits}).format(parsed) : String(value ?? "—");
  };

  const resourceByCode = new Map(RESOURCES.map(item => [item.code, item]));
  const normByKey = new Map(NORMS.map(item => [item.key, item]));
  const resourceByKey = new Map(RESOURCES.map(item => [item.key, item]));
  const usageSearchRows = USAGE.map(item => ({search:norm(`${item.code} ${item.name} ${item.unit}`), norms:item.norms || []}));
  const usageSearchCache = new Map();
  const selectedDetailResources = new Map();
  const loadedChunks = new Map();
  const hierarchyById = new Map();
  const hierarchyParentById = new Map();
  const normTableCache = new Map();
  const registerHierarchy = (nodes, parent = null) => {
    for (const node of nodes || []) {
      hierarchyById.set(node.id, node);
      if (parent) hierarchyParentById.set(node.id, parent.id);
      registerHierarchy(node.children, node);
    }
  };
  registerHierarchy(HIERARCHY.norms);
  registerHierarchy(HIERARCHY.resources);
  const state = {
    view:"norms",
    query:"",
    node:{type:"all", value:"all", label:"Вся нормативная база"},
    page:1,
    activeKey:null,
    selection:new Set(),
    expanded:new Set(["norm|ГЭСН"]),
    advanced:{base:"", unit:"", resourceCategory:"", scope:"all"}
  };

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

  function dataLabel() {
    return [META.title, META.edition, META.decree].filter(Boolean).join(" · ");
  }

  function updateHeader() {
    $("#version-caption").textContent = dataLabel();
    $("#tree-summary").textContent = `${formatNumber(META.normCount || NORMS.length, 0)} нормативов · ${formatNumber(META.resourceCount || RESOURCES.length, 0)} ресурсов`;
  }

  function nodeGlyph(node) {
    if (node.type === "База") return node.code.replace("ГЭСН", "") || "Г";
    if (node.type === "Категория") return ({Материал:"М",Оборудование:"О",МашиныМеханизмы:"МХ"})[node.category] || "Р";
    return ({Сборник:"С",Раздел:"Р",Подраздел:"П",Таблица:"Т",Книга:"К",Часть:"Ч",Группа:"Г"})[node.type] || (node.code || "•").slice(-2);
  }

  function nodeTitle(node) {
    if (node.type === "База") return node.name;
    if (node.type === "Категория") return resourceCategoryLabel(node.category);
    const prefix = node.type === "Сборник" ? node.code : `${node.type} ${node.code}`;
    return `${prefix}. ${node.name}`;
  }

  function nodePathLabel(node) {
    const parts = [];
    let current = node;
    while (current) {
      parts.unshift(nodeTitle(current));
      current = hierarchyById.get(hierarchyParentById.get(current.id));
    }
    return parts.join(" → ");
  }

  function renderHierarchyNode(node, depth) {
    const hasChildren = Boolean(node.children?.length);
    const expanded = hasChildren && state.expanded.has(node.id);
    const active = state.node.type === "hierarchy" && state.node.value === node.id;
    let html = `<button class="tree-row ${active ? "active" : ""}" style="--tree-depth:${depth}" ${hasChildren ? `data-expand="${esc(node.id)}"` : ""} data-node-type="hierarchy" data-node-value="${esc(node.id)}" data-label="${esc(nodePathLabel(node))}" title="${esc(nodeTitle(node))}"><span class="twisty">${hasChildren ? expanded ? "⌄" : "›" : ""}</span><span class="tree-glyph">${esc(nodeGlyph(node))}</span><span class="tree-copy"><strong>${esc(nodeTitle(node))}</strong><small>${formatNumber(node.count,0)} ${state.view === "norms" ? "нормативов" : "ресурсов"}</small></span></button>`;
    if (expanded) for (const child of node.children) html += renderHierarchyNode(child, depth + 1);
    return html;
  }

  function renderTree() {
    const tree = $("#catalog-tree");
    const isNorms = state.view === "norms";
    const roots = isNorms ? HIERARCHY.norms : HIERARCHY.resources;
    const total = isNorms ? NORMS.length : RESOURCES.length;
    const label = isNorms ? "Вся нормативная база" : "Все ресурсы";
    let html = `<button class="tree-row ${state.node.type === "all" ? "active" : ""}" style="--tree-depth:0" data-node-type="all" data-node-value="all" data-label="${label}"><span class="twisty"></span><span class="tree-glyph root">${isNorms ? "Ф" : "Р"}</span><span class="tree-copy"><strong>${isNorms ? "ФСНБ-2022" : "Каталог ресурсов"}</strong><small>${formatNumber(total,0)} ${isNorms ? "нормативов" : "ресурсов"}</small></span></button>`;
    for (const root of roots) html += renderHierarchyNode(root, 1);
    tree.innerHTML = html;
    bindTree();
  }

  function bindTree() {
    $$(".tree-row", $("#catalog-tree")).forEach(button => button.onclick = () => {
      const expandKey = button.dataset.expand;
      if (expandKey) {
        if (state.expanded.has(expandKey)) state.expanded.delete(expandKey); else state.expanded.add(expandKey);
      }
      state.node = {type:button.dataset.nodeType, value:button.dataset.nodeValue, label:button.dataset.label};
      state.page = 1;
      state.activeKey = null;
      renderTree();
      renderResults();
      clearDetail();
    });
  }

  function normTableKeys(node) {
    if (normTableCache.has(node.id)) return normTableCache.get(node.id);
    const keys = new Set();
    const visit = current => {
      if (current.type === "Таблица") keys.add(`${current.base}|${current.code}`);
      for (const child of current.children || []) visit(child);
    };
    visit(node);
    normTableCache.set(node.id, keys);
    return keys;
  }

  function resourceMatchesNode(item, node) {
    if (item.category !== node.category) return false;
    if (node.type === "Категория") return true;
    return item.code === node.code || item.code.startsWith(`${node.code}.`) || item.code.startsWith(`${node.code}-`);
  }

  function filteredItems() {
    const query = norm(state.query);
    if (state.view === "resources") {
      let items = RESOURCES;
      if (state.node.type === "hierarchy") {
        const node = hierarchyById.get(state.node.value);
        if (node) items = items.filter(item => resourceMatchesNode(item, node));
      }
      if (state.advanced.resourceCategory) items = items.filter(item => item.category === state.advanced.resourceCategory);
      if (state.advanced.unit) items = items.filter(item => norm(item.unit).includes(norm(state.advanced.unit)));
      if (query) items = items.filter(item => norm(`${item.code} ${item.name} ${item.unit}`).includes(query));
      return items;
    }
    let items = NORMS;
    if (state.node.type === "hierarchy") {
      const node = hierarchyById.get(state.node.value);
      if (node?.type === "База") {
        items = items.filter(item => item.base === node.base);
      } else if (node) {
        const tables = normTableKeys(node);
        items = items.filter(item => tables.has(`${item.base}|${item.table}`));
      }
    }
    if (state.advanced.base) items = items.filter(item => item.base === state.advanced.base);
    if (state.advanced.unit) items = items.filter(item => norm(item.unit).includes(norm(state.advanced.unit)));
    if (query) {
      const scope = state.advanced.scope || "all";
      let usageMatches = null;
      if (scope !== "norms") {
        if (!usageSearchCache.has(query)) {
          const indexes = new Set();
          for (const row of usageSearchRows) if (row.search.includes(query)) for (const index of row.norms) indexes.add(index);
          usageSearchCache.set(query, indexes);
        }
        usageMatches = usageSearchCache.get(query);
      }
      items = items.filter(item => {
        const direct = norm(`${item.base} ${item.code} ${item.name} ${item.table} ${item.tableName}`).includes(query);
        const throughResource = usageMatches?.has(item.i) || false;
        return scope === "norms" ? direct : scope === "resources" ? throughResource : direct || throughResource;
      });
    }
    return items;
  }

  function renderResults() {
    const items = filteredItems();
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state.page = Math.min(state.page, pageCount);
    const offset = (state.page - 1) * PAGE_SIZE;
    const pageItems = items.slice(offset, offset + PAGE_SIZE);
    $("#results-heading").textContent = state.view === "norms" ? "Нормативы" : "Каталог ресурсов";
    $("#results-summary").textContent = `${formatNumber(items.length,0)} найдено`;
    $("#result-path").textContent = state.node.label || "Вся база";
    $("#page-caption").textContent = `Страница ${state.page} из ${pageCount}`;
    $("#page-prev").disabled = state.page <= 1;
    $("#page-next").disabled = state.page >= pageCount;
    $("#results-empty").classList.toggle("hidden", pageItems.length > 0);
    const pageSelectionCount = pageItems.filter(item => state.selection.has(item.key)).length;
    $("#select-all-page").checked = pageItems.length > 0 && pageSelectionCount === pageItems.length;
    $("#select-all-page").indeterminate = pageSelectionCount > 0 && pageSelectionCount < pageItems.length;
    $("#select-all-page").disabled = pageItems.length === 0;

    $("#results-body").innerHTML = pageItems.map(item => `<tr class="${item.key === state.activeKey ? "active" : ""}" data-key="${esc(item.key)}"><td><input class="result-pick" type="checkbox" ${state.selection.has(item.key) ? "checked" : ""} aria-label="Выбрать ${esc(item.code)}"></td><td class="code">${esc(item.base ? `${item.base} ${item.code}` : item.code)}</td><td class="name">${esc(item.name)}<small>${esc(item.base ? item.tableName || item.collectionName : resourceCategoryLabel(item.category))}</small></td><td class="unit">${esc(item.unit || "—")}</td></tr>`).join("");

    $$("#results-body tr").forEach(row => row.onclick = event => {
      if (event.target.matches("input")) return;
      state.activeKey = row.dataset.key;
      renderResults();
      showDetail(state.activeKey);
    });
    $$(".result-pick", $("#results-body")).forEach(input => input.onchange = event => {
      const key = event.target.closest("tr").dataset.key;
      toggleSelection(key, event.target.checked);
      event.stopPropagation();
    });
  }

  function resourceCategoryLabel(category) {
    return ({Материал:"Материал",Оборудование:"Оборудование",МашиныМеханизмы:"Машина или механизм"})[category] || category || "Ресурс";
  }

  function clearDetail() {
    $("#detail-empty").classList.remove("hidden");
    $("#detail-content").classList.add("hidden");
    $("#detail-content").innerHTML = "";
  }

  function loadChunk(chunkId) {
    if (window.FSNB_NORM_CHUNKS?.[chunkId]) return Promise.resolve(window.FSNB_NORM_CHUNKS[chunkId]);
    if (loadedChunks.has(chunkId)) return loadedChunks.get(chunkId);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `data/norms/norm-${String(chunkId).padStart(3,"0")}.js`;
      script.onload = () => resolve(window.FSNB_NORM_CHUNKS?.[chunkId] || []);
      script.onerror = () => reject(new Error(`Не удалось загрузить блок ${chunkId}`));
      document.head.appendChild(script);
    });
    loadedChunks.set(chunkId, promise);
    return promise;
  }

  async function getNormDetail(index) {
    const chunk = await loadChunk(Math.floor(index / CHUNK_SIZE));
    return chunk.find(item => item.i === index);
  }

  async function showDetail(key) {
    $("#detail-empty").classList.add("hidden");
    $("#detail-content").classList.remove("hidden");
    $("#detail-content").innerHTML = `<div class="detail-empty"><strong>Загрузка…</strong><span>Получаем состав выбранного элемента.</span></div>`;
    try {
      if (key.startsWith("resource:")) renderResourceDetail(resourceByKey.get(key));
      else renderNormDetail(await getNormDetail(normByKey.get(key).i));
    } catch (error) {
      $("#detail-content").innerHTML = `<div class="note">Не удалось открыть состав: ${esc(error.message)}</div>`;
    }
  }

  function kindLabel(kind) {
    return ({labor:"Затраты труда рабочих",laborDetail:"Состав исполнителей",machinist:"Затраты труда машинистов",machine:"Машины и механизмы",material:"Материалы и оборудование",abstract:"Ресурсы без стоимости",service:"Служебные ресурсы"})[kind] || "Прочие ресурсы";
  }

  function renderNormDetail(item) {
    if (!item) return clearDetail();
    const groups = new Map();
    for (const [index, resource] of (item.resources || []).entries()) {
      if (!groups.has(resource.kind)) groups.set(resource.kind, []);
      groups.get(resource.kind).push({resource,index});
    }
    const rows = [...groups].map(([kind, resources]) => `<tr class="kind-row"><td colspan="5">${esc(kindLabel(kind))} · ${resources.length}</td></tr>${resources.map(({resource,index}) => {
      const abstract = resource.kind === "abstract";
      const catalog = resourceByCode.get(resource.code);
      const priceStored = !!catalog?.price;
      const selectionKey = `normResource:${item.i}:${index}`;
      return `<tr class="${abstract ? "abstract" : ""}" data-resource-index="${index}" data-resource-code="${esc(resource.code)}"><td><input class="resource-pick" type="checkbox" ${state.selection.has(selectionKey) ? "checked" : ""} aria-label="Выбрать ресурс ${esc(resource.code)}"></td><td class="resource-code">${esc(resource.code || "—")}</td><td class="resource-name">${esc(resource.name || catalog?.name || "Без наименования")}${abstract ? `<small>Стоимость отсутствует${resource.tg ? ` · ТГ ${esc(resource.tg)}` : ""}</small>` : priceStored ? `<small>Стоимость сохранена в каталоге и скрыта в текущей версии</small>` : ""}</td><td>${esc(resource.unit || catalog?.unit || "—")}</td><td class="${resource.qty === "П" ? "qty-project" : ""}">${esc(resource.qty === "П" ? "П" : formatNumber(resource.qty))}</td></tr>`;
    }).join("")}`).join("");

    $("#detail-content").innerHTML = `<div class="crumb">${(item.path || []).map(esc).join(" → ")}</div><div class="detail-kicker">${esc(item.base)} ${esc(item.code)}</div><h2>${esc(item.name)}</h2><div class="detail-stats"><div class="stat"><small>Единица измерения</small><strong>${esc(item.unit || "—")}</strong></div><div class="stat"><small>Ресурсов</small><strong>${formatNumber((item.resources || []).length,0)}</strong></div><div class="stat"><small>Состав работ</small><strong>${formatNumber((item.works || []).length,0)} пунктов</strong></div></div><div class="detail-actions"><button class="primary" id="add-current">Добавить норматив</button><button class="outline" id="show-works">Состав работ</button></div><div class="section-head"><h3>Ресурсы норматива</h3><small>Расход на единицу норматива</small></div><table class="resources-table"><thead><tr><th></th><th>Код</th><th>Наименование</th><th>Ед.</th><th>Расход</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Ресурсы не указаны</td></tr>'}</tbody></table>${(item.resources || []).some(x => x.qty === "П") ? '<div class="note"><strong>П</strong> — расход определяется по проектным данным.</div>' : ""}`;
    $("#add-current").onclick = () => addOne(item.key);
    $("#show-works").onclick = () => showWorks(item);
    $$(".resource-pick", $("#detail-content")).forEach(input => input.onchange = event => {
      const row = event.target.closest("tr");
      const index = Number(row.dataset.resourceIndex);
      const key = `normResource:${item.i}:${index}`;
      if (event.target.checked) {
        state.selection.add(key);
        selectedDetailResources.set(key, {parent:item, resource:item.resources[index]});
      } else {
        state.selection.delete(key);
        selectedDetailResources.delete(key);
      }
      renderSelection();
      event.stopPropagation();
    });
    $$("tr.abstract", $("#detail-content")).forEach(row => row.onclick = event => {
      if (event.target.matches("input")) return;
      const resource = item.resources.find(x => x.code === row.dataset.resourceCode && x.kind === "abstract");
      showCandidates(resource);
    });
  }

  function renderResourceDetail(item) {
    if (!item) return clearDetail();
    const priceFields = item.price ? Object.keys(item.price).length : 0;
    $("#detail-content").innerHTML = `<div class="crumb">ФСБЦ → ${esc(resourceCategoryLabel(item.category))}</div><div class="detail-kicker">${esc(item.code)}</div><h2>${esc(item.name)}</h2><div class="detail-stats"><div class="stat"><small>Единица измерения</small><strong>${esc(item.unit || "—")}</strong></div><div class="stat"><small>Категория</small><strong>${esc(resourceCategoryLabel(item.category))}</strong></div><div class="stat"><small>Стоимостные поля</small><strong>${priceFields ? "Сохранены" : "Отсутствуют"}</strong></div></div><div class="detail-actions"><button class="primary" id="add-current">Добавить ресурс</button></div><div class="note">Стоимости перенесены из исходного XML, но в текущей версии интерфейса не отображаются. При передаче ресурса они сохраняются.</div>`;
    $("#add-current").onclick = () => addOne(item.key);
  }

  function showWorks(item) {
    openDialog(`<h2 id="sub-title">Состав работ</h2><p><strong>${esc(item.base)} ${esc(item.code)}</strong> · ${esc(item.name)}</p>${item.works?.length ? `<ol class="work-list">${item.works.map(work => `<li>${esc(work)}</li>`).join("")}</ol>` : '<div class="empty"><strong>Состав работ не указан</strong></div>'}`);

  }

  function showCandidates(resource) {
    const codes = TG[resource.tg] || [];
    const candidates = codes.map(code => resourceByCode.get(code)).filter(Boolean);
    openDialog(`<h2 id="sub-title">Конкретные ресурсы технологической группы</h2><p><strong>${esc(resource.code)} · ${esc(resource.name)}</strong><br>Технологическая группа ${esc(resource.tg || "не указана")}. У обобщённого ресурса стоимость отсутствует.</p>${candidates.length ? `<div class="candidate-list">${candidates.map(item => `<label class="candidate"><input type="radio" name="tg-candidate" value="${esc(item.code)}"><b>${esc(item.code)}</b><span>${esc(item.name)}</span><span>${esc(item.unit || "—")}</span></label>`).join("")}</div>` : '<div class="note">В текущей редакции базы для этой технологической группы конкретные ресурсы не определены.</div>'}<div class="dialog-actions">${candidates.length ? '<button class="primary" id="candidate-add" disabled>Выбрать ресурс</button>' : ""}</div>`, true);

    const add = $("#candidate-add");
    if (add) {
      $$("input[name=tg-candidate]").forEach(input => input.onchange = () => add.disabled = false);
      add.onclick = () => {
        const selected = $("input[name=tg-candidate]:checked");
        if (!selected) return;
        addOne(`resource:${selected.value}`);
        closeDialog();
      };
    }
  }

  function toggleSelection(key, checked) {
    if (checked) state.selection.add(key); else state.selection.delete(key);
    renderSelection();
    renderResults();
  }

  function addOne(key) {
    state.selection.add(key);
    renderSelection();
    exportSelection();
  }

  function renderSelection() {
    const count = state.selection.size;
    $("#selection-count").textContent = count ? `Выбрано: ${formatNumber(count,0)}` : "Ничего не выбрано";
    $("#selection-hint").textContent = count ? "Выбранные элементы будут переданы в рабочий объект" : "Можно добавить одну строку или группу строк";
    $("#selection-clear").disabled = !count;
    $("#selection-add").disabled = !count;
  }

  function enrichResource(resource) {
    const catalog = resourceByCode.get(resource.code);
    return {...resource, price:catalog?.price || null, catalogCategory:catalog?.category || null};
  }

  async function selectionPayload() {
    const items = [];
    for (const key of state.selection) {
      if (key.startsWith("normResource:")) {
        const selected = selectedDetailResources.get(key);
        if (selected) items.push({type:"normResource",parent:{key:selected.parent.key,base:selected.parent.base,code:selected.parent.code,name:selected.parent.name,unit:selected.parent.unit},resource:enrichResource(structuredClone(selected.resource))});
      } else if (key.startsWith("resource:")) {
        const resource = resourceByKey.get(key);
        if (resource) items.push({type:"resource",...structuredClone(resource)});
      } else {
        const summary = normByKey.get(key);
        if (!summary) continue;
        const detail = await getNormDetail(summary.i);
        items.push({type:"norm",...structuredClone(detail),resources:(detail.resources || []).map(enrichResource)});
      }
    }
    return {schemaVersion:1,database:{title:META.title,edition:META.edition,decree:META.decree,created:META.created,priceLevel:META.priceLevel},items};
  }

  async function exportSelection() {
    const button = $("#selection-add");
    button.disabled = true;
    button.textContent = "Подготовка…";
    try {
      const payload = await selectionPayload();
      window.dispatchEvent(new CustomEvent("fsnb:select", {detail:payload}));
      if (window.parent && window.parent !== window) window.parent.postMessage({type:"vikr:fsnb-select",payload}, "*");
      if (typeof window.FSNBModule?.onSelect === "function") window.FSNBModule.onSelect(payload);
      openDialog(`<h2 id="sub-title">Выбранные элементы подготовлены</h2><p>Модуль сформировал пакет для передачи в основную систему. В демонстрационном режиме можно проверить его содержимое ниже.</p><div class="export-preview">${esc(JSON.stringify(payload,null,2))}</div>`, true);

      toast(`Подготовлено элементов: ${payload.items.length}`);
    } catch (error) {
      toast(`Не удалось подготовить выбор: ${error.message}`);
    } finally {
      button.textContent = "Добавить выбранное";
      button.disabled = !state.selection.size;
    }
  }

  function showAdvanced() {
    const bases = [...new Set(NORMS.map(item => item.base))];
    openDialog(`<h2 id="sub-title">Расширенный поиск</h2><p>Параметры применяются вместе с основной строкой поиска.</p><div class="advanced-grid">${state.view === "norms" ? `<label class="field"><span>Раздел нормативов</span><select id="adv-base"><option value="">Все разделы</option>${bases.map(base => `<option value="${esc(base)}" ${state.advanced.base === base ? "selected" : ""}>${esc(base)}</option>`).join("")}</select></label><label class="field"><span>Область поиска</span><select id="adv-scope"><option value="all" ${state.advanced.scope === "all" ? "selected" : ""}>Нормативы и их ресурсы</option><option value="norms" ${state.advanced.scope === "norms" ? "selected" : ""}>Только нормативы</option><option value="resources" ${state.advanced.scope === "resources" ? "selected" : ""}>Только ресурсы внутри нормативов</option></select></label>` : `<label class="field"><span>Категория ресурса</span><select id="adv-category"><option value="">Все категории</option><option value="Материал" ${state.advanced.resourceCategory === "Материал" ? "selected" : ""}>Материалы</option><option value="Оборудование" ${state.advanced.resourceCategory === "Оборудование" ? "selected" : ""}>Оборудование</option><option value="МашиныМеханизмы" ${state.advanced.resourceCategory === "МашиныМеханизмы" ? "selected" : ""}>Машины и механизмы</option></select></label>`}<label class="field"><span>Единица измерения содержит</span><input id="adv-unit" value="${esc(state.advanced.unit)}" placeholder="Например, м3 или маш.-ч"></label></div><div class="dialog-actions"><button class="outline" id="adv-reset">Сбросить</button><button class="primary" id="adv-apply">Применить</button></div>`);

    $("#adv-reset").onclick = () => { state.advanced={base:"",unit:"",resourceCategory:"",scope:"all"}; closeDialog(); state.page=1; renderResults(); };
    $("#adv-apply").onclick = () => {
      state.advanced.base = $("#adv-base")?.value || "";
      state.advanced.resourceCategory = $("#adv-category")?.value || "";
      state.advanced.scope = $("#adv-scope")?.value || state.advanced.scope || "all";
      state.advanced.unit = $("#adv-unit").value.trim();
      state.page = 1;
      closeDialog();
      renderResults();
    };
  }

  function showDatabaseInfo() {
    openDialog(`<h2 id="sub-title">${esc(META.title || "ФСНБ-2022")}</h2><p>${esc(META.edition || "")} · ${esc(META.decree || "")}</p><div class="detail-stats"><div class="stat"><small>Дата формирования XML</small><strong>${esc(META.created || "—")}</strong></div><div class="stat"><small>Уровень цен</small><strong>${esc(META.priceLevel || "—")}</strong></div><div class="stat"><small>Исходных файлов</small><strong>${formatNumber(META.sourceFiles || 0,0)}</strong></div></div><h3>Состав загруженной базы</h3><ul><li>${formatNumber(META.normCount || NORMS.length,0)} нормативов ГЭСН, ГЭСНм, ГЭСНмр, ГЭСНп и ГЭСНр.</li><li>${formatNumber(META.resourceCount || RESOURCES.length,0)} материалов, оборудования, машин и механизмов.</li><li>Стоимости сохранены, но в текущем интерфейсе не отображаются.</li><li>Ресурсы без стоимости отмечены отдельно.</li></ul>${META.demo ? '<div class="note">Сейчас открыт демонстрационный набор. После импорта исходных XML здесь будет отображаться полная база.</div>' : ""}`);

  }

  function showUpdateInfo() {
    openDialog(`<h2 id="sub-title">Обновление ФСНБ</h2><p>Обновление не изменяет интерфейс и формат передачи выбранных элементов. Предыдущий рабочий набор сохраняется как резервный.</p><ol><li>Скачать новую редакцию ФСНБ в формате открытых данных.</li><li>Поместить все десять XML-файлов в отдельную папку.</li><li>Запустить файл <strong>«Обновить базу.cmd»</strong> в папке модуля и выбрать эту папку.</li><li>После полной проверки модуль переключится на новую редакцию.</li></ol><div class="note">Частичное смешивание файлов разных дополнений запрещено: обновляется весь комплект.</div>`);

  }

  let resourcesOnly=false;
  function switchView(view) {
    if(resourcesOnly&&view!=="resources")return;
    state.view = view;
    state.node = {type:"all", value:"all", label:view === "norms" ? "Вся нормативная база" : "Все ресурсы"};
    state.expanded = new Set([view === "norms" ? "norm|ГЭСН" : "resource|Материал"]);
    state.page = 1;
    state.activeKey = null;
    $$(".view-switch button").forEach(button => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    renderTree();
    renderResults();
    clearDetail();
  }

  function openModule(options = {}) {
    resourcesOnly=options.resourcesOnly===true;
    $('.view-switch button[data-view="norms"]').hidden=resourcesOnly;
    state.selection.clear();selectedDetailResources.clear();renderSelection();
    switchView(resourcesOnly?"resources":"norms");
    $("#fsnb-overlay").classList.remove("hidden");
    $("#module-launcher").classList.add("hidden");
    if (typeof options.onSelect === "function") window.FSNBModule.onSelect = options.onSelect;
  }

  function closeModule() {
    $("#fsnb-overlay").classList.add("hidden");
    $("#module-launcher").classList.remove("hidden");
    window.dispatchEvent(new CustomEvent("fsnb:close"));
    if (window.parent && window.parent !== window) window.parent.postMessage({type:"vikr:module-close",module:"fsnb"}, "*");
  }

  function init() {
    window.addEventListener("message",event=>{if(event.source===window.parent&&event.data?.type==="vikr:fsnb-context")openModule(event.data.options||{})});
    window.FSNBModule = {open:openModule,close:closeModule,getSelection:selectionPayload,onSelect:null};
    updateHeader();
    renderTree();
    renderResults();
    renderSelection();
    $("#global-search").oninput = event => { state.query=event.target.value; state.page=1; renderResults(); };
    $("#advanced-search").onclick = showAdvanced;
    $("#database-info").onclick = showDatabaseInfo;
    $("#database-update").onclick = showUpdateInfo;
    $("#module-close").onclick = closeModule;
    $("#module-launcher").onclick = () => openModule();
    $("#sub-close").onclick = closeDialog;
    
    $$(".view-switch button").forEach(button => button.onclick = () => switchView(button.dataset.view));
    $("#page-prev").onclick = () => { state.page-=1; renderResults(); };
    $("#page-next").onclick = () => { state.page+=1; renderResults(); };
    $("#select-all-page").onchange = event => {
      const items = filteredItems().slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE);
      items.forEach(item => event.target.checked ? state.selection.add(item.key) : state.selection.delete(item.key));
      renderSelection();
      renderResults();
    };
    $("#selection-clear").onclick = () => { state.selection.clear(); selectedDetailResources.clear(); renderSelection(); renderResults(); if (state.activeKey) showDetail(state.activeKey); };
    $("#selection-add").onclick = exportSelection;
    $("#collapse-tree").onclick = () => { state.expanded.clear(); renderTree(); };
    document.addEventListener("keydown", event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("#global-search").focus(); }
      
    });
    if (NORMS[1]) { state.activeKey=NORMS[1].key; renderResults(); showDetail(state.activeKey); }
  }

  init();
})();
