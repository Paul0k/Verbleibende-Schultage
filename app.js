// Dein JS — gleiche Logik wie in deinem <script> aber ausgelagert.
// (Ich habe nur die DOM-Selektoren angepasst falls nötig.)
const MS_PER_DAY = 24*60*60*1000;
const LS_KEY = 'schultage_userdata_v1';
const CURRENT_VERSION = 1;
const CUT_OFF = '2026-03-20';
const DEFAULT_HOLIDAYS = [
  {from:'2025-07-03', to:'2025-08-13', name:'Sommerferien'},
  {from:'2025-10-13', to:'2025-10-25', name:'Herbstferien'},
  {from:'2025-12-22', to:'2026-01-05', name:'Weihnachtsferien'},
  {from:'2026-02-02', to:'2026-02-03', name:'Winterferien'}
];
const DEFAULT_FEIERTAGE = [{from:'2025-11-24', to:'2025-11-24', name:'Lehrerfortbildung'}];

function ymdToDayNum(ymd){ if(!ymd) return NaN; const [y,m,d] = ymd.split('-').map(Number); return Math.floor(Date.UTC(y,m-1,d)/MS_PER_DAY); }
function todayBerlinDayNum(){ const now = new Date(); const fmt = new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}); const parts = fmt.formatToParts(now); const y = +parts.find(p=>p.type==='year').value; const m = +parts.find(p=>p.type==='month').value; const d = +parts.find(p=>p.type==='day').value; return Math.floor(Date.UTC(y,m-1,d)/MS_PER_DAY); }
function countWeekdaysDayNums(s,e,inc=true){ let st=s; if(!inc) st=s+1; let cnt=0; for(let n=st;n<=e;n++){ const w=new Date(n*MS_PER_DAY).getUTCDay(); if(w!==0 && w!==6) cnt++; } return cnt; }
function overlapWeekdaysDayNums(aS,aE,bS,bE){ const s=Math.max(aS,bS); const e=Math.min(aE,bE); if(s>e) return 0; return countWeekdaysDayNums(s,e,true); }

function loadUserData(){ try{ const raw = localStorage.getItem(LS_KEY); if(!raw) return {version:CURRENT_VERSION, user:[], removedDefaults:[]}; const p = JSON.parse(raw); p.version = (p.version||CURRENT_VERSION); p.user = Array.isArray(p.user)?p.user:[]; p.removedDefaults = Array.isArray(p.removedDefaults)?p.removedDefaults:[]; return p; }catch(e){ return {version:CURRENT_VERSION, user:[], removedDefaults:[]}; } }
function saveUserData(obj){ obj.version = CURRENT_VERSION; localStorage.setItem(LS_KEY, JSON.stringify(obj)); }

function buildEffectiveList(){ const user = loadUserData(); const cutoffDay = ymdToDayNum(CUT_OFF); const defaults = DEFAULT_HOLIDAYS.concat(DEFAULT_FEIERTAGE).filter(d=>ymdToDayNum(d.from) <= cutoffDay); const map = new Map(); defaults.forEach(d=> map.set(d.from+'|'+d.to, {from:d.from,to:d.to,name:d.name, source:'default'})); (user.removedDefaults||[]).forEach(k=> map.delete(k)); (user.user||[]).forEach(d=>{ if(!d.from||!d.to) return; map.set(d.from+'|'+d.to, {from:d.from,to:d.to,name:d.name||'', source:'user'}); }); return Array.from(map.values()).sort((a,b)=> a.from < b.from ? -1 : (a.from > b.from ? 1 : 0)); }

function renderHolidayList(){ const list = buildEffectiveList(); const el = document.getElementById('holidayList'); el.innerHTML=''; if(list.length===0){ el.textContent='–'; return; } const ul = document.createElement('ul'); list.forEach(h=>{ const li = document.createElement('li'); const span = document.createElement('span'); span.textContent = `${h.name? h.name+' ' : ''}${h.from} → ${h.to}`; const btn = document.createElement('button'); btn.className='small-btn'; btn.innerHTML='✕'; btn.title='Löschen'; btn.addEventListener('click', ()=> handleDeleteHoliday(h)); li.appendChild(span); li.appendChild(btn); ul.appendChild(li); }); el.appendChild(ul); }
function handleDeleteHoliday(entry){ const key = entry.from+'|'+entry.to; const usr = loadUserData(); if(entry.source==='user'){ usr.user=(usr.user||[]).filter(u=>!(u.from===entry.from && u.to===entry.to)); saveUserData(usr); } else { usr.removedDefaults = Array.from(new Set([...(usr.removedDefaults||[]), key])); saveUserData(usr); } renderHolidayList(); recalc(); }
function addUserHoliday(from,to,name){ if(!from||!to){ alert('Bitte beide Daten angeben'); return; } if(from>to){ alert('Ungültig'); return; } const usr = loadUserData(); usr.user = usr.user||[]; usr.user.push({from,to,name:name||''}); saveUserData(usr); renderHolidayList(); recalc(); }
function exportJSON(){ const usr = loadUserData(); const blob = new Blob([JSON.stringify(usr,null,2)], {type:'application/json'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='schultage_userdata.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
function importJSONFile(file){ if(!file){ alert('Keine Datei'); return; } const r = new FileReader(); r.onload = ()=>{ try{ const parsed = JSON.parse(r.result); const users = Array.isArray(parsed.user) ? parsed.user.filter(u=>u && u.from && u.to) : []; const removed = Array.isArray(parsed.removedDefaults)?parsed.removedDefaults:[]; const p = { version: CURRENT_VERSION, user: users, removedDefaults: removed }; saveUserData(p); renderHolidayList(); recalc(); alert('Import fertig'); }catch(e){ alert('Ungültige Datei'); } }; r.readAsText(file); }

function calcUntilDayNums(startDayNum, endDayNum, includeStart){
  if(isNaN(startDayNum) || isNaN(endDayNum)) return { total:0, weekdays:0, holidayWeekdays:0, schooldays:0 };
  if(endDayNum < startDayNum) return { total:0, weekdays:0, holidayWeekdays:0, schooldays:0 };
  const total = endDayNum - startDayNum + (includeStart?1:0);
  const weekdays = countWeekdaysDayNums(startDayNum, endDayNum, includeStart);
  const holidays = buildEffectiveList();
  let holidayWeekdays = 0;
  for(const h of holidays){ const hs = ymdToDayNum(h.from); const he = ymdToDayNum(h.to); holidayWeekdays += overlapWeekdaysDayNums(startDayNum, endDayNum, hs, he); }
  const schooldays = Math.max(0, weekdays - holidayWeekdays);
  return { total, weekdays, holidayWeekdays, schooldays };
}

const elSchoolDays = document.getElementById('schoolDays');
const elDaysTotal = document.getElementById('daysTotal');
const elJulyTotal = document.getElementById('julyTotal');
const elEndDate = document.getElementById('endDate');
const elInclude = document.getElementById('includeToday');
const elShowBgImage = document.getElementById('showBackgroundImage');
const elHolidayFrom = document.getElementById('holidayFrom');
const elHolidayTo = document.getElementById('holidayTo');
const btnAdd = document.getElementById('addHoliday');
const btnReset = document.getElementById('resetHolidays');
const elHolidayList = document.getElementById('holidayList');
const btnExport = document.getElementById('exportBtn');
const fileInput = document.getElementById('importFile');
const btnOpen = document.getElementById('openSettings');
const drawer = document.getElementById('settingsDrawer');
const btnClose = document.getElementById('closeSettings');

function animateValue(el, start, end, duration=600){
  start = Number(start)||0; end = Number(end)||0;
  const range = end - start;
  if(range === 0){ el.textContent = String(end); el.classList.add('pulse'); setTimeout(()=>el.classList.remove('pulse'), 600); return; }
  const startTime = performance.now();
  function step(now){
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const current = Math.round(start + range * eased);
    el.textContent = current;
    if(t < 1) requestAnimationFrame(step);
    else { el.classList.add('pulse'); setTimeout(()=>el.classList.remove('pulse'), 600); }
  }
  requestAnimationFrame(step);
}

function setNumberElements(schooldays, total, julyTotal){
  animateValue(elSchoolDays, parseInt(elSchoolDays.textContent) || 0, schooldays, 650);
  animateValue(elDaysTotal, parseInt(elDaysTotal.textContent) || 0, total, 650);
  animateValue(elJulyTotal, parseInt(elJulyTotal.textContent) || 0, julyTotal, 650);
}

function recalc(){
  const today = todayBerlinDayNum();
  const val = elEndDate.value;
  if(!val){ setNumberElements(0,0,0); return; }
  const endDay = ymdToDayNum(val);
  const include = !!elInclude.checked;
  if(isNaN(endDay)){ setNumberElements(0,0,0); return; }
  const r = calcUntilDayNums(today, endDay, include);
  const julyDay = ymdToDayNum('2026-06-25');
  const r2 = calcUntilDayNums(today, julyDay, include);
  setNumberElements(r.schooldays, r.total, r2.total);
}

(function addMainNumberInteractivity(){
  const el = elSchoolDays;
  el.addEventListener('pointerenter', (e) => {
    if(e.pointerType === 'mouse' || e.pointerType === 'pen'){
      el.classList.add('hovered');
      el.style.cursor = 'pointer';
    }
  });
  el.addEventListener('pointerleave', ()=> { el.classList.remove('hovered'); el.style.cursor = ''; });

  el.addEventListener('focus', ()=> el.classList.add('hovered'));
  el.addEventListener('blur', ()=> el.classList.remove('hovered'));

  let touchTimeout = null;
  el.addEventListener('touchstart', ()=> {
    el.classList.add('hovered');
    if(touchTimeout) clearTimeout(touchTimeout);
    touchTimeout = setTimeout(()=> { el.classList.remove('hovered'); touchTimeout = null; }, 700);
  }, {passive:true});
  el.addEventListener('touchend', ()=> {
    if(touchTimeout){ clearTimeout(touchTimeout); el.classList.remove('hovered'); touchTimeout = null; }
  }, {passive:true});

  el.addEventListener('click', ()=> {
    el.classList.add('pulse');
    setTimeout(()=> el.classList.remove('pulse'), 600);
  });
})();

function toggleBackgroundImage(show) {
  if (show) {
    document.body.classList.remove('no-bg-image');
  } else {
    document.body.classList.add('no-bg-image');
  }
}

(function init(){
  const s = loadUserData(); saveUserData(s);
  const savedEnd = localStorage.getItem('schultage_enddate_v1'); if(savedEnd) elEndDate.value = savedEnd; else elEndDate.value = '2026-03-20';
  renderHolidayList(); elInclude.checked = false; recalc();

  // Hintergrundbild-Einstellung laden
  const savedBgImage = localStorage.getItem('schultage_bgimage_v1');
  const showBgImage = savedBgImage !== 'false'; // Standard: an (true)
  elShowBgImage.checked = showBgImage;
  toggleBackgroundImage(showBgImage);

  btnOpen.addEventListener('click', ()=>{ drawer.classList.toggle('open'); drawer.setAttribute('aria-hidden', drawer.classList.contains('open') ? 'false' : 'true'); });
  btnClose.addEventListener('click', ()=>{ drawer.classList.remove('open'); drawer.setAttribute('aria-hidden','true'); });

  btnAdd && btnAdd.addEventListener('click', ()=>{ addUserHoliday(elHolidayFrom.value, elHolidayTo.value, ''); elHolidayFrom.value=''; elHolidayTo.value=''; });
  btnReset && btnReset.addEventListener('click', ()=>{ if(confirm('Benutzer-Ferien zurücksetzen?')){ localStorage.removeItem(LS_KEY); renderHolidayList(); recalc(); } });

  elEndDate.addEventListener('change', ()=>{ localStorage.setItem('schultage_enddate_v1', elEndDate.value); recalc(); });
  elInclude.addEventListener('change', recalc);
  elShowBgImage.addEventListener('change', ()=>{ 
    const show = elShowBgImage.checked; 
    localStorage.setItem('schultage_bgimage_v1', show ? 'true' : 'false'); 
    toggleBackgroundImage(show); 
  });
  btnExport && btnExport.addEventListener('click', exportJSON);
  fileInput && fileInput.addEventListener('change', (ev)=>{ const f = ev.target.files && ev.target.files[0]; if(f) importJSONFile(f); ev.target.value=''; });

  window.addEventListener('focus', recalc);
})();
