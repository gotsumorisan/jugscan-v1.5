const PROMPT_TEMPLATES = ["JUG SCANからジャグラーの着席判断を依頼します。\n\n日時：{現在日時}\n店舗：{店舗名}\n機種：{正式機種名}\n台番号：{台番号}\n\n現在のデータ：\n- 今日の累計G：{G}G\n- BB：{BB}（{BB確率}）\n- RB：{RB}（{REG確率}）\n- 合算：{合算確率}\n- 備考：{備考または「なし」}\n\n実戦当日の最新解析をWebで確認し、パチスロAI共同実戦プロジェクトの基準で判定してください。\n\n必ず「判定：A / B / C / D」を明示してください。\nAだけ着席可とします。\n理由は重要なものを1〜2点、次の行動は1つだけ具体的に示してください。\n交換条件・残り営業時間・残り軍資金・店舗根拠など、A判定に必要な重要情報が不足している場合は都合よく推測せずCとし、最重要の確認事項を1つだけ指示してください。\n設定・店舗状況等を都合よく推測しないでください。", "JUG SCANで複数のジャグラー候補台を登録しました。\n着席候補を比較し、順位付けしてください。\n\n日時：{現在日時}\n店舗：{店舗名}\n候補台数：{N}台\n\n【候補1】\n機種：{正式機種名}\n台番号：{台番号}\n今日の累計G：{G}G\nBB：{BB}（{BB確率}）\nRB：{RB}（{REG確率}）\n合算：{合算確率}\n備考：{備考または「なし」}\n\n【候補2】\n...\n\n実戦当日の最新解析をWebで確認し、パチスロAI共同実戦プロジェクトの基準で比較してください。\n\n各台について、少なくとも以下を考慮してください。\n- サンプル量\n- 機種固有の設定差\n- REG・BB・合算の意味\n- 低設定でも十分説明可能か\n- 店舗状況や残り営業時間など、確認可能な当日条件\n\n出力形式：\n1位：{台番号}番台 / {機種} / 判定A・B・C・D\n2位：...\n\n順位と判定は別物として扱ってください。\n1位でもA基準を満たさなければ着席を勧めないでください。\n全台B/C/Dでも構いません。\nA判定だけ着席可とします。\n交換条件・残り営業時間・残り軍資金・店舗根拠など、A判定に必要な情報が不足する場合は都合よく補完せずCとしてください。\n情報不足の場合、追加確認は最重要の1項目だけ指示してください。\n都合のよい推測は禁止します。"];

function commitRecord(record,oldId) {return new Promise((resolve,reject)=>{const tx=state.db.transaction(STORE_RECORDS,'readwrite'),store=tx.objectStore(STORE_RECORDS); store.put(record); if(oldId && oldId!==record.id)store.delete(oldId); tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error);});}
async function deleteRecord(r) {if(!(await confirmModal({title:'この台を削除しますか？',message:`${r.machineNo}番台を削除します。この操作は元に戻せません。`,confirmText:'削除する',danger:true})))return; await dbDelete(STORE_RECORDS,r.id); if(state.editingOriginalId===r.id)clearForm(false); await renderRecords(); await renderHistory(); showToast('削除しました');}
function promptValues(r) {r=normalizeRecord(r);return {'正式機種名':r.machinePromptName,'台番号':r.machineNo,'G':r.games,'BB':r.bb,'RB':r.rb,'BB確率':probabilityText(r.games,r.bb),'REG確率':probabilityText(r.games,r.rb),'合算確率':probabilityText(r.games,r.bb+r.rb),'備考または「なし」':r.note || 'なし'};}
function fillTemplate(text,values) {return text.replace(/\{([^}]+)\}/g,(all,key)=>Object.hasOwn(values,key)?values[key]:all);}
function currentTimestamp() {const d=new Date();return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function singlePrompt(r) {const store=state.stores?.find(s=>s.id===r.storeId);return fillTemplate(PROMPT_TEMPLATES[0],{...promptValues(r),'現在日時':currentTimestamp(),'店舗名':store?.name || r.storeName});}
function comparisonPrompt(rows) {const base=fillTemplate(PROMPT_TEMPLATES[1],{'現在日時':currentTimestamp(),'店舗名':state.currentStore.name,'N':rows.length});const candidates=rows.map((r,i)=>fillTemplate(`【候補${i+1}】\n機種：{正式機種名}\n台番号：{台番号}\n今日の累計G：{G}G\nBB：{BB}（{BB確率}）\nRB：{RB}（{REG確率}）\n合算：{合算確率}\n備考：{備考または「なし」}`,promptValues(r))).join('\n\n');return base.replace(/【候補1】[\s\S]*?(?=実戦当日の)/,candidates+'\n\n');}
async function copyPrompt(text,message) {try {await navigator.clipboard.writeText(text);showToast(message);return true;}catch(error){console.info('Clipboard fallback',error);}const t=document.createElement('textarea');t.value=text;t.style.cssText='position:fixed;top:0;left:0;opacity:0';(document.querySelector('dialog[open]') || document.body).append(t);t.focus();t.select();t.setSelectionRange(0,text.length);let ok=false;try{ok=document.execCommand('copy');}catch(error){console.info('Copy fallback failed',error);}t.remove();if(ok){showToast(message);return true;}$('promptText').value=text;$('manualCopy').showModal();return false;}
let comparisonRows=[];
function updateSelection() {const n=$('compareList').querySelectorAll('input:checked').length;$('copySelected').disabled=n===0;$('copySelected').innerHTML=`<img class="icon" src="./assets/icons/icon-copy.svg" alt="">選択した${n}台をコピー`;}
function bindConsultation() {
 $('compareBtn').onclick=async()=>{comparisonRows=(await getRecordsFor(localDateISO(),state.currentStore.id)).sort(recordSorter('created'));$('compareContext').textContent=`${state.currentStore.name} · ${localDateISO().replaceAll('-','/')}`;$('compareList').innerHTML=comparisonRows.map((r,i)=>`<label class="candidate"><input type="checkbox" checked value="${i}"><span>${escapeHtml(r.machineNo)}番台 · ${escapeHtml(r.machineLabel)}<small>${r.games}G / REG ${probabilityText(r.games,r.rb)} / 合算 ${probabilityText(r.games,r.bb+r.rb)}</small></span></label>`).join('');updateSelection();$('compareSheet').showModal();};
 $('compareList').onchange=updateSelection;
 for(const [id,checked] of [['selectAll',true],['selectNone',false]])$(id).onclick=()=>{$('compareList').querySelectorAll('input').forEach(c=>c.checked=checked);updateSelection();};
 $('copySelected').onclick=()=>{const rows=[...$('compareList').querySelectorAll('input:checked')].map(c=>comparisonRows[Number(c.value)]);if(rows.length)void copyPrompt(comparisonPrompt(rows),`${rows.length}台分の相談プロンプトをコピーしました ✓`);};
 $('closeCompare').onclick=()=>$('compareSheet').close();$('closeManual').onclick=()=>$('manualCopy').close();$('selectPrompt').onclick=()=>{$('promptText').focus();$('promptText').select();};
 document.addEventListener('keydown',e=>{if(e.key==='Escape' && state.modalResolver)closeModal(false);});
}


const APP_VERSION = '1.5.0';
const DB_NAME = 'jugscan-db';
const DB_VERSION = 1;
const STORE_STORES = 'stores';
const STORE_RECORDS = 'records';

const PRIMARY_MACHINES = [
  'ファンキー2',
  'ネオアイム',
  'ハッピーV3',
  'マイジャグV',
  'ゴージャグ3'
];

const OTHER_MACHINES = [
  'マイジャグVI',
  'ジャグラーガールズSS',
  'ミスタージャグラー',
  'ウルトラミラクルジャグラー',
  'アイムジャグラーEX'
];

const MACHINES = [
 ['funky2','ファンキー2','ファンキージャグラー2'], ['neoaim','ネオアイム','ネオアイムジャグラーEX'], ['happyv3','ハッピーV3','ハッピージャグラーV III'], ['myjugv','マイジャグV','マイジャグラーV'], ['gojug3','ゴージャグ3','ゴーゴージャグラー3'],
 ['myjugvi','マイジャグVI','マイジャグラーVI','other'], ['girls','ジャグラーガールズSS','ジャグラーガールズSS','other'], ['mr','ミスタージャグラー','ミスタージャグラー','other'], ['ultra','ウルトラミラクルジャグラー','ウルトラミラクルジャグラー','other'], ['aim','アイムジャグラーEX','アイムジャグラーEX','other']
].map(([id,label,promptName,art])=>({id,label,promptName,art}));
function machineMeta(name) { return MACHINES.find(m=>m.label===name || m.promptName===name) || {id:'legacy-other',label:name,promptName:name,art:'other'}; }
function normalizeRecord(r) { const m=machineMeta(r.machineLabel || r.machine); return {...r,machine:r.machine || m.label,machineId:r.machineId || m.id,machineLabel:r.machineLabel || m.label,machinePromptName:r.machinePromptName || m.promptName}; }

const MACHINE_ART = Object.fromEntries(MACHINES.map(m => [m.label, './assets/machines/machine-'+(m.art || m.id)+'.webp']));

const state = {
  db: null,
  currentStore: null,
  currentMachine: PRIMARY_MACHINES[0],
  sort: 'created',
  editingId: null,
  editingOriginalId: null,
  modalResolver: null,
  showAllStores: false
};

const $ = (id) => document.getElementById(id);
const els = {};

function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function displayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const days = ['日','月','火','水','木','金','土'];
  const dt = new Date(y, m - 1, d);
  return `${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')} (${days[dt.getDay()]})`;
}

function normalizeDigits(value) {
  return String(value ?? '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, '');
}

function toInt(value) {
  const raw = String(value ?? '');
  const n = /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function probabilityText(games, count) {
  if (!games || !count) return '—';
  return `1/${Math.round(games / count)}`;
}

function probabilityDenominator(games, count) {
  if (!games || !count) return Number.POSITIVE_INFINITY;
  return games / count;
}

function makeRecordId(date, storeId, machineNo) {
  return `${date}::${storeId}::${machineNo}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_STORES)) {
        const stores = db.createObjectStore(STORE_STORES, { keyPath: 'id' });
        stores.createIndex('name', 'name', { unique: false });
        stores.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const records = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
        records.createIndex('date', 'date', { unique: false });
        records.createIndex('storeId', 'storeId', { unique: false });
        records.createIndex('dateStore', ['date', 'storeId'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txStore(storeName, mode = 'readonly') {
  return state.db.transaction(storeName, mode).objectStore(storeName);
}

function dbPut(storeName,value) { return new Promise((resolve,reject)=>{const tx=state.db.transaction(storeName,'readwrite'); tx.objectStore(storeName).put(value); tx.oncomplete=()=>resolve(value); tx.onabort=()=>reject(tx.error); tx.onerror=()=>reject(tx.error);}); }

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const req = txStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(storeName,key) { return new Promise((resolve,reject)=>{const tx=state.db.transaction(storeName,'readwrite'); tx.objectStore(storeName).delete(key); tx.oncomplete=()=>resolve(); tx.onabort=()=>reject(tx.error); tx.onerror=()=>reject(tx.error);}); }

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = txStore(storeName).getAll();
    req.onsuccess = () => resolve((req.result || []).map(r => r.machine !== undefined ? normalizeRecord(r) : r));
    req.onerror = () => reject(req.error);
  });
}

async function getRecordsFor(date, storeId) {
  return new Promise((resolve, reject) => {
    const index = txStore(STORE_RECORDS).index('dateStore');
    const req = index.getAll(IDBKeyRange.only([date, storeId]));
    req.onsuccess = () => resolve((req.result || []).map(r => r.machine !== undefined ? normalizeRecord(r) : r));
    req.onerror = () => reject(req.error);
  });
}

function setupElements() {
  [
    'dateLabel','changeStoreBtn','storeScreen','scanScreen','historyScreen','newStoreName','startNewStoreBtn',
    'showAllStoresBtn','recentStores','emptyStores','currentStoreName','recordCount','primaryMachines','otherMachineSelect',
    'machineNo','games','bb','rb','note','regProbability','combinedProbability','registerBtn','cancelEditBtn','deleteEditingBtn','clearFormBtn',
    'listMachineTitle','recordsList','emptyRecords','historyDate','historyStoreSelect','historyList','emptyHistory','backToScanBtn',
    'navStores','navScan','navHistory','modalBackdrop','modalTitle','modalMessage','modalCancel','modalConfirm','toast','bbProbability','visibleCount','compareBtn'
  ].forEach(id => els[id] = $(id));
}

function setActiveNav(name) {
  const map = { stores: els.navStores, scan: els.navScan, history: els.navHistory };
  Object.values(map).forEach(btn => btn.classList.remove('active'));
  if (map[name]) map[name].classList.add('active');
}

function showScreen(name) {
  els.storeScreen.classList.toggle('active', name === 'stores');
  els.scanScreen.classList.toggle('active', name === 'scan');
  els.historyScreen.classList.toggle('active', name === 'history');
  els.changeStoreBtn.classList.toggle('hidden', !state.currentStore || name === 'stores');
  document.body.dataset.screen = name;
  els.dateLabel.textContent = `${displayDate(localDateISO())}  v${APP_VERSION}`;
  setActiveNav(name);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 1800);
}

function confirmModal({ title = '確認', message, confirmText = 'OK', danger = false }) {
  els.modalTitle.textContent = title;
  els.modalMessage.textContent = message;
  els.modalConfirm.textContent = confirmText;
  els.modalConfirm.classList.toggle('danger', danger);
  state.modalFocus = document.activeElement;
  els.modalBackdrop.classList.remove('hidden');
  document.querySelector('.app-shell').inert = true;
  els.modalCancel.focus();
  return new Promise(resolve => { state.modalResolver = resolve; });
}

function closeModal(result) {
  els.modalBackdrop.classList.add('hidden');
  document.querySelector('.app-shell').inert = false;
  state.modalFocus?.focus();
  if (state.modalResolver) {
    state.modalResolver(result);
    state.modalResolver = null;
  }
}


function hasFormData() {
  return ['machineNo','games','bb','rb','note'].some(id => String(els[id]?.value ?? '').trim() !== '');
}

function hasUnsavedChanges() {
  return Boolean(state.editingOriginalId) || hasFormData();
}

async function confirmDiscardIfNeeded(message = '入力中の内容が消えます。移動しますか？') {
  if (!hasUnsavedChanges()) return true;
  return confirmModal({ title: '未保存の入力があります', message, confirmText: '移動する', danger: true });
}

async function requestStoreScreen() {
  const ok = await confirmDiscardIfNeeded('入力中の内容が消えます。店舗選択へ戻りますか？');
  if (!ok) return false;
  clearForm(false);
  showScreen('stores');
  return true;
}

function dataPanelElement() {
  return document.querySelector('.data-panel');
}

function scrollDataPanelIntoView(behavior = 'smooth') {
  const panel = dataPanelElement();
  if (!panel) return;
  requestAnimationFrame(() => {
    setTimeout(() => panel.scrollIntoView({ behavior, block: 'start', inline: 'nearest' }), 40);
  });
}

function focusMachineInputSoon() {
  setTimeout(() => {
    if (!els.scanScreen.classList.contains('active')) return;
    try { els.machineNo.focus({ preventScroll: true }); }
    catch (_) { els.machineNo.focus(); }
    setTimeout(() => els.machineNo.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }), 120);
  }, 90);
}

function setupIPhoneViewportHandling() {
  const updateViewport = () => {
    if (!window.visualViewport) return;
    const keyboardHeight = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
    document.body.classList.toggle('keyboard-open', keyboardHeight > 120);
    document.documentElement.style.setProperty('--visual-viewport-height', `${window.visualViewport.height}px`);
  };

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', updateViewport, { passive: true });
    updateViewport();
  }

  document.addEventListener('focusin', event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches('input, select, textarea')) return;
    document.body.classList.add('input-active');
    if (target.matches('#machineNo,#games,#bb,#rb,#note,#newStoreName')) {
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }), 220);
    }
  });

  document.addEventListener('focusout', () => {
    setTimeout(() => {
      if (!document.activeElement?.matches?.('input, select, textarea')) {
        document.body.classList.remove('input-active');
      }
      updateViewport();
    }, 80);
  });
}

function renderMachineSelectors() {
  els.primaryMachines.innerHTML = '';
  PRIMARY_MACHINES.forEach(name => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'machine-btn';
    btn.innerHTML = `<img src="${MACHINE_ART[name]}" alt=""><span>${escapeHtml(name)}</span>`;
    btn.dataset.machine = name;
    btn.addEventListener('click', () => { void selectMachine(name); });
    els.primaryMachines.appendChild(btn);
  });

  els.otherMachineSelect.innerHTML = '<option value="">機種を選択</option>' +
    OTHER_MACHINES.map(m => `<option value="${m}">${m}</option>`).join('');
  els.otherMachineSelect.addEventListener('change', () => {
    if (els.otherMachineSelect.value) void selectMachine(els.otherMachineSelect.value);
  });
  const other = document.createElement('button'); other.type='button'; other.className='machine-btn'; other.dataset.machine='other'; other.innerHTML='<img src="./assets/machines/machine-other.webp" alt=""><span>その他</span>'; other.onclick=()=>{ els.otherMachineSelect.focus(); }; els.primaryMachines.append(other);
  updateMachineButtons();
}

async function selectMachine(name) {
  if (!name || name === state.currentMachine) {
    updateMachineButtons();
    if (name && !state.editingOriginalId && !hasFormData()) focusMachineInputSoon();
    return true;
  }

  // 編集値を保持する変更にも確認を要求。
  if (state.editingOriginalId) {
    if (!(await confirmModal({title:'機種を変更しますか？',message:'入力値を保持して機種を変更します。',confirmText:'変更する'}))) { updateMachineButtons(); return false; }
    state.currentMachine = name;
    updateMachineButtons();
    await renderRecords();
    return true;
  }

  if (hasFormData()) {
    const ok = await confirmModal({
      title: '機種を変更しますか？',
      message: '入力中の内容が消えます。機種を変更しますか？',
      confirmText: '変更する',
      danger: true
    });
    if (!ok) {
      updateMachineButtons();
      return false;
    }
  }

  state.currentMachine = name;
  updateMachineButtons();
  clearForm(false);
  await renderRecords();
  focusMachineInputSoon();
  return true;
}

function updateMachineButtons() {
  [...els.primaryMachines.querySelectorAll('.machine-btn')].forEach(btn => {
    btn.classList.toggle('active', btn.dataset.machine === state.currentMachine || (btn.dataset.machine === 'other' && !PRIMARY_MACHINES.includes(state.currentMachine)));
  });
  if (OTHER_MACHINES.includes(state.currentMachine)) {
    els.otherMachineSelect.value = state.currentMachine;
  } else {
    els.otherMachineSelect.value = '';
  }
  els.listMachineTitle.textContent = state.currentMachine;
}

function sanitizeNumericInput(input) {
  const cleaned = input.value.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));
  if (input.value !== cleaned) input.value = cleaned;
}

function updateProbabilities() {
  ['machineNo','games','bb','rb'].forEach(id => sanitizeNumericInput(els[id]));
  const games = toInt(els.games.value);
  const bb = toInt(els.bb.value);
  const rb = toInt(els.rb.value);
  els.bbProbability.textContent = probabilityText(games, bb);
  els.regProbability.textContent = probabilityText(games, rb);
  els.combinedProbability.textContent = probabilityText(games, bb + rb);
}

function clearForm(focus = true) {
  els.machineNo.value = '';
  els.games.value = '';
  els.bb.value = '';
  els.rb.value = '';
  els.note.value = '';
  state.editingDate = null;
  state.editingId = null;
  state.editingOriginalId = null;
  els.registerBtn.classList.remove('save-mode'); els.registerBtn.setAttribute('aria-label','この台を登録'); els.registerBtn.innerHTML = '<span>＋ この台を登録</span>';
  els.cancelEditBtn.classList.add('hidden');
  els.deleteEditingBtn.classList.add('hidden');
  updateProbabilities();
  if (focus) setTimeout(() => els.machineNo.focus(), 30);
}

async function addOrUseStore(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) {
    showToast('店名を入力してください');
    els.newStoreName.focus();
    return;
  }
  const stores = await dbGetAll(STORE_STORES);
  let store = stores.find(s => s.name === clean);
  const now = Date.now();
  if (store) {
    store.lastUsedAt = now;
  } else {
    store = {
      id: `store_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name: clean,
      createdAt: now,
      lastUsedAt: now
    };
  }
  await dbPut(STORE_STORES, store);
  await selectStore(store);
}

async function selectStore(store) {
  if (state.currentStore && state.currentStore.id !== store.id && hasUnsavedChanges()) {
    const ok = await confirmModal({
      title: '店舗を変更しますか？',
      message: '入力中の内容が消えます。店舗を変更しますか？',
      confirmText: '変更する',
      danger: true
    });
    if (!ok) return false;
  }

  store.lastUsedAt = Date.now();
  await dbPut(STORE_STORES, store);
  state.currentStore = store;
  localStorage.setItem('jugscan-current-store-id', store.id);
  els.currentStoreName.textContent = store.name;
  els.newStoreName.value = '';
  clearForm(false);
  showScreen('scan');
  await renderRecords();
  await renderStores();
  return true;
}


async function renameStore(store) {
  const raw = window.prompt('店舗名を変更', store.name);
  if (raw === null) return;
  const clean = raw.trim().replace(/\s+/g, ' ');
  if (!clean) return showToast('店名を入力してください');
  if (clean === store.name) return;

  const stores = await dbGetAll(STORE_STORES);
  if (stores.some(s => s.id !== store.id && s.name === clean)) {
    return showToast('同じ名前の店舗がすでにあります');
  }

  store.name = clean;
  store.lastUsedAt = Date.now();

  // 履歴の表示用 storeName も同期する。storeIdは変更しない。
  const records = await dbGetAll(STORE_RECORDS);
  await new Promise((resolve,reject)=>{const tx=state.db.transaction([STORE_STORES,STORE_RECORDS],'readwrite');tx.objectStore(STORE_STORES).put(store);for(const record of records.filter(r=>r.storeId===store.id))tx.objectStore(STORE_RECORDS).put({...record,storeName:clean});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});

  if (state.currentStore?.id === store.id) {
    state.currentStore = store;
    els.currentStoreName.textContent = clean;
  }
  await renderStores();
  await renderRecords();
  await renderHistory();
  showToast('店舗名を変更しました');
}

async function deleteStore(store) {
  const records = (await dbGetAll(STORE_RECORDS)).filter(r => r.storeId === store.id);
  const ok = await confirmModal({
    title: '店舗を削除しますか？',
    message: records.length
      ? `${store.name} と保存済み ${records.length}台のデータを削除します。この操作は元に戻せません。`
      : `${store.name} を削除します。この操作は元に戻せません。`,
    confirmText: '削除する',
    danger: true
  });
  if (!ok) return;

  await new Promise((resolve,reject)=>{const tx=state.db.transaction([STORE_RECORDS,STORE_STORES],'readwrite'); records.forEach(r=>tx.objectStore(STORE_RECORDS).delete(r.id)); tx.objectStore(STORE_STORES).delete(store.id); tx.oncomplete=resolve; tx.onabort=()=>reject(tx.error); });

  if (state.currentStore?.id === store.id) {
    state.currentStore = null;
    localStorage.removeItem('jugscan-current-store-id');
    clearForm(false);
  }
  await renderStores();
  await populateHistoryStores();
  await renderHistory();
  showToast('店舗を削除しました');
}

async function renderStores() {
  const stores = (await dbGetAll(STORE_STORES)).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  state.stores = stores;
  els.emptyStores.classList.toggle('hidden', stores.length > 0);
  els.recentStores.innerHTML = '';
  const visible = state.showAllStores ? stores : stores.slice(0, 5);
  visible.forEach(store => {
    const row = document.createElement('div');
    row.className = 'store-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'store-item';
    btn.innerHTML = `<span>${escapeHtml(store.name)}<small>タップして開始</small></span><span class="chev">›</span>`;
    btn.addEventListener('click', () => { void selectStore(store); });

    const actions = document.createElement('div');
    actions.className = 'store-actions';
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'store-manage-btn';
    rename.textContent = '名前変更';
    rename.addEventListener('click', () => { void renameStore(store); });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'store-manage-btn danger';
    del.textContent = '削除';
    del.addEventListener('click', () => { void deleteStore(store); });
    actions.append(rename, del);
    row.append(btn, actions);
    els.recentStores.appendChild(row);
  });
  els.showAllStoresBtn.textContent = state.showAllStores ? '最近5件' : 'すべて表示';
  els.showAllStoresBtn.classList.toggle('hidden', stores.length <= 5);
  await populateHistoryStores(stores);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function validateForm() {
  if (['machineNo','games','bb','rb'].some(id=>els[id].value!=='' && !/^[0-9]+$/.test(els[id].value))) return '数値欄は0以上の整数で入力してください';
  const machineNoRaw = normalizeDigits(els.machineNo.value);
  const gamesRaw = normalizeDigits(els.games.value);
  const bbRaw = normalizeDigits(els.bb.value);
  const rbRaw = normalizeDigits(els.rb.value);
  const games = toInt(gamesRaw);
  const bb = toInt(bbRaw);
  const rb = toInt(rbRaw);
  if (!machineNoRaw) return '台番号を入力してください';
  if (!gamesRaw || games <= 0) return '累計Gを入力してください';
  if (bbRaw === '') return 'BBを入力してください（0回なら「0」）';
  if (rbRaw === '') return 'RBを入力してください（0回なら「0」）';
  if (![games,bb,rb].every(Number.isSafeInteger)) return '数値が大きすぎます';
  if (bb + rb > games) return 'BB・RB回数が累計Gを超えています';
  return null;
}

async function saveCurrentRecord() {
  if (!state.currentStore) return;
  const error = validateForm();
  if (error) { showToast(error); return; }

  const date = state.editingDate || localDateISO();
  const machineNo = normalizeDigits(els.machineNo.value);
  const newId = makeRecordId(date, state.currentStore.id, machineNo);
  const existing = await dbGet(STORE_RECORDS, newId);
  const now = Date.now();

  if (existing && newId !== state.editingOriginalId) {
    const overwrite = await confirmModal({
      title: '重複する台番号',
      message: `${machineNo}番台はすでに登録されています。\n現在のデータを上書きしますか？`,
      confirmText: '上書き'
    });
    if (!overwrite) return;
  }

  const prior = existing || (state.editingOriginalId ? await dbGet(STORE_RECORDS, state.editingOriginalId) : null);
  const record = {
    id: newId,
    date,
    storeId: state.currentStore.id,
    storeName: state.currentStore.name,
    machine: state.currentMachine,
    machineId: machineMeta(state.currentMachine).id,
    machineLabel: state.currentMachine,
    machinePromptName: machineMeta(state.currentMachine).promptName,
    machineNo,
    games: toInt(els.games.value),
    bb: toInt(els.bb.value),
    rb: toInt(els.rb.value),
    note: els.note.value.trim(),
    createdAt: prior?.createdAt || now,
    updatedAt: now
  };


  const resultMessage = existing && newId !== state.editingOriginalId
    ? '上書きしました'
    : state.editingOriginalId
      ? '更新しました'
      : '登録しました';
  await commitRecord(record, state.editingOriginalId);
  clearForm(true);
  showToast(resultMessage);
  await renderRecords();
}

async function renderRecords() {
  if (!state.currentStore) return;
  const all = await getRecordsFor(localDateISO(), state.currentStore.id);
  els.recordCount.textContent = `${all.length}台`;
  const filtered = all.filter(r => r.machineLabel === state.currentMachine);
  els.visibleCount.textContent = `全${all.length}台 / この機種${filtered.length}台`;
  els.compareBtn.disabled = all.length === 0;
  filtered.sort(recordSorter(state.sort));
  els.recordsList.innerHTML = '';
  els.emptyRecords.classList.toggle('hidden', filtered.length > 0);
  filtered.forEach(record => els.recordsList.appendChild(makeRecordCard(record, true)));
}

function recordSorter(sort) {
  return (a, b) => {
    if (sort === 'reg') {
      return probabilityDenominator(a.games, a.rb) - probabilityDenominator(b.games, b.rb) || Number(a.machineNo) - Number(b.machineNo);
    }
    if (sort === 'combined') {
      return probabilityDenominator(a.games, a.bb + a.rb) - probabilityDenominator(b.games, b.bb + b.rb) || Number(a.machineNo) - Number(b.machineNo);
    }
    if (sort === 'number') return Number(a.machineNo) - Number(b.machineNo);
    return (a.createdAt || 0) - (b.createdAt || 0);
  };
}

function makeRecordCard(record) {
 const r=normalizeRecord(record), card=document.createElement('article'); card.className='record-card';
 card.innerHTML=`<div class="record-machine-name">${escapeHtml(r.machineLabel)} · ${escapeHtml(r.date.replaceAll('-','/'))}</div><div class="record-top"><div>台番<strong>${escapeHtml(r.machineNo)}</strong></div><div>累計G<strong>${r.games}</strong></div><div class="bb">BB<strong>${r.bb}</strong></div><div class="rb">RB<strong>${r.rb}</strong></div></div><div class="record-bottom"><span class="bb">BB ${probabilityText(r.games,r.bb)}</span><span class="reg">REG ${probabilityText(r.games,r.rb)}</span><span class="combined">合算 ${probabilityText(r.games,r.bb+r.rb)}</span></div><p>${escapeHtml(r.note || '')}</p><div class="card-actions"><button data-action="edit"><img class="icon" src="./assets/icons/icon-edit.svg" alt="">編集</button><button data-action="delete" class="danger"><img class="icon" src="./assets/icons/icon-delete.svg" alt="">削除</button></div><button class="consult secondary-btn"><img class="icon" src="./assets/icons/icon-ai-consult.svg" alt="">ChatGPTに相談</button>`;
 card.querySelector('[data-action="edit"]').onclick=async()=>{if(!(await confirmDiscardIfNeeded()))return; const store=await dbGet(STORE_STORES,r.storeId); if(!store)return showToast('店舗が見つかりません'); state.currentStore=store; els.currentStoreName.textContent=store.name; showScreen('scan'); editRecord(r); await renderRecords();};
 card.querySelector('[data-action="delete"]').onclick=()=>deleteRecord(r);
 card.querySelector('.consult').onclick=()=>copyPrompt(singlePrompt(r),'ChatGPT相談用プロンプトをコピーしました ✓'); return card;
}

function editRecord(record) {
  state.editingDate = record.date;
  state.currentMachine = normalizeRecord(record).machineLabel;
  updateMachineButtons();
  els.machineNo.value = record.machineNo;
  els.games.value = record.games;
  els.bb.value = record.bb;
  els.rb.value = record.rb;
  els.note.value = record.note || '';
  state.editingId = record.id;
  state.editingOriginalId = record.id;
  els.registerBtn.textContent = '保存';
  els.registerBtn.setAttribute('aria-label','保存');
  els.cancelEditBtn.classList.remove('hidden');
  els.deleteEditingBtn.classList.remove('hidden');
  updateProbabilities();
  scrollDataPanelIntoView('smooth');
}


async function deleteEditingRecord() {
  if (!state.editingOriginalId) return;
  const record = await dbGet(STORE_RECORDS, state.editingOriginalId);
  if (!record) {
    clearForm(false);
    return showToast('対象データが見つかりません');
  }
  const ok = await confirmModal({
    title: 'この台を削除しますか？',
    message: `${record.machineNo}番台の保存データを削除します。この操作は元に戻せません。`,
    confirmText: '削除する',
    danger: true
  });
  if (!ok) return;
  await dbDelete(STORE_RECORDS, record.id);
  clearForm(false);
  await renderRecords();
  await renderHistory();
  await renderStores();
  showToast('台データを削除しました');
}

async function populateHistoryStores(stores = null) {
  const list = stores || (await dbGetAll(STORE_STORES)).sort((a,b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  const current = els.historyStoreSelect.value;
  els.historyStoreSelect.innerHTML = list.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (current && list.some(s => s.id === current)) els.historyStoreSelect.value = current;
  else if (state.currentStore) els.historyStoreSelect.value = state.currentStore.id;
}

async function renderHistory() {
  const date = els.historyDate.value || localDateISO();
  const storeId = els.historyStoreSelect.value;
  if (!storeId) {
    els.historyList.innerHTML = '';
    els.emptyHistory.classList.remove('hidden');
    return;
  }
  const rows = await getRecordsFor(date, storeId);
  rows.sort((a,b) => a.machine.localeCompare(b.machine, 'ja') || Number(a.machineNo) - Number(b.machineNo));
  els.historyList.innerHTML = '';
  els.emptyHistory.classList.toggle('hidden', rows.length > 0);
  rows.forEach(r => els.historyList.appendChild(makeRecordCard(r, false)));
}

function bindEvents() {
  els.startNewStoreBtn.addEventListener('click', () => addOrUseStore(els.newStoreName.value));
  els.newStoreName.addEventListener('keydown', e => { if (e.key === 'Enter') addOrUseStore(els.newStoreName.value); });
  els.showAllStoresBtn.addEventListener('click', () => { state.showAllStores = !state.showAllStores; renderStores(); });
  els.changeStoreBtn.addEventListener('click', () => { void requestStoreScreen(); });
  ['machineNo','games','bb','rb'].forEach(id => els[id].addEventListener('input', updateProbabilities));
  els.registerBtn.addEventListener('click', async()=>{if(state.saving)return;state.saving=true;els.registerBtn.disabled=true;try{await saveCurrentRecord();}catch(error){console.error(error);showToast('保存に失敗しました。入力を確認して再試行してください');}finally{state.saving=false;els.registerBtn.disabled=false;}});
  els.cancelEditBtn.addEventListener('click', () => clearForm(true));
  els.deleteEditingBtn.addEventListener('click', () => { void deleteEditingRecord(); });
  els.clearFormBtn.addEventListener('click', () => clearForm(true));

  document.querySelectorAll('.sort-btn').forEach(btn => btn.addEventListener('click', () => {
    state.sort = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('active', b === btn));
    renderRecords();
  }));

  els.navStores.addEventListener('click', () => { void requestStoreScreen(); });
  els.navScan.addEventListener('click', async () => {
    if (!state.currentStore) { showScreen('stores'); return; }
    showScreen('scan');
    await renderRecords();
  });
  els.navHistory.addEventListener('click', async () => {
    if (!(await confirmDiscardIfNeeded())) return;
    clearForm(false);
    els.historyDate.value = localDateISO();
    await populateHistoryStores();
    // 履歴を開いた直後は、今巡回している店舗を優先表示する。
    if (state.currentStore && [...els.historyStoreSelect.options].some(opt => opt.value === state.currentStore.id)) {
      els.historyStoreSelect.value = state.currentStore.id;
    }
    showScreen('history');
    await renderHistory();
  });
  els.backToScanBtn.addEventListener('click', async () => {
    if (!state.currentStore) showScreen('stores');
    else { showScreen('scan'); await renderRecords(); }
  });
  els.historyDate.addEventListener('change', renderHistory);
  els.historyStoreSelect.addEventListener('change', renderHistory);

  els.modalCancel.addEventListener('click', () => closeModal(false));
  els.modalConfirm.addEventListener('click', () => closeModal(true));
  els.modalBackdrop.addEventListener('click', e => { if (e.target === els.modalBackdrop) closeModal(false); });
}

async function restoreStore() {
  const id = localStorage.getItem('jugscan-current-store-id');
  if (!id) return false;
  const store = await dbGet(STORE_STORES, id);
  if (!store) return false;
  state.currentStore = store;
  els.currentStoreName.textContent = store.name;
  return true;
}


async function init() {
  setupElements();
  bindConsultation();
  els.dateLabel.textContent = `${displayDate(localDateISO())}  v${APP_VERSION}`;
  els.historyDate.value = localDateISO();
  state.db = await openDb();
  renderMachineSelectors();
  bindEvents();
  window.addEventListener("unhandledrejection",event=>{ console.error(event.reason); showToast("保存・操作に失敗しました。入力を確認して再試行してください"); });
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden){ els.dateLabel.textContent=`${displayDate(localDateISO())} v${APP_VERSION}`; void renderRecords(); }});
  setupIPhoneViewportHandling();
  await renderStores();
  await restoreStore();
  // 起動時は毎回、誤店舗入力を防ぐため店舗選択画面から開始する。
  showScreen('stores');

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then(reg => reg.update().catch(err => console.error('PWA更新失敗',err)))
      .catch(err => console.error('PWA更新失敗',err));
  }
}

init().catch(err => {
  console.error(err);
  alert('JUG SCANの起動に失敗しました。ページを再読み込みしてください。');
});

