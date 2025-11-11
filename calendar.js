// Kalender-Logik für Schultage-Anzeige
const MS_PER_DAY = 24*60*60*1000;

let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

function ymdToDayNum(ymd){ 
  if(!ymd) return NaN; 
  const [y,m,d] = ymd.split('-').map(Number); 
  return Math.floor(Date.UTC(y,m-1,d)/MS_PER_DAY); 
}

function dayNumToYmd(dayNum){
  const date = new Date(dayNum * MS_PER_DAY);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayBerlinDayNum(){ 
  const now = new Date(); 
  const fmt = new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}); 
  const parts = fmt.formatToParts(now); 
  const y = +parts.find(p=>p.type==='year').value; 
  const m = +parts.find(p=>p.type==='month').value; 
  const d = +parts.find(p=>p.type==='day').value; 
  return Math.floor(Date.UTC(y,m-1,d)/MS_PER_DAY); 
}

function countWeekdaysDayNums(s,e,inc=true){ 
  let st=s; 
  if(!inc) st=s+1; 
  let cnt=0; 
  for(let n=st;n<=e;n++){ 
    const w=new Date(n*MS_PER_DAY).getUTCDay(); 
    if(w!==0 && w!==6) cnt++; 
  } 
  return cnt; 
}

function overlapWeekdaysDayNums(aS,aE,bS,bE){ 
  const s=Math.max(aS,bS); 
  const e=Math.min(aE,bE); 
  if(s>e) return 0; 
  return countWeekdaysDayNums(s,e,true); 
}

function loadUserData(){ 
  try{ 
    const raw = localStorage.getItem('schultage_userdata_v1'); 
    if(!raw) return {version:1, user:[], removedDefaults:[]}; 
    const p = JSON.parse(raw); 
    p.version = (p.version||1); 
    p.user = Array.isArray(p.user)?p.user:[]; 
    p.removedDefaults = Array.isArray(p.removedDefaults)?p.removedDefaults:[]; 
    return p; 
  }catch(e){ 
    return {version:1, user:[], removedDefaults:[]}; 
  } 
}

function buildEffectiveList(){ 
  const CUT_OFF = '2026-03-20';
  const DEFAULT_HOLIDAYS = [
    {from:'2025-07-03', to:'2025-08-13', name:'Sommerferien'},
    {from:'2025-10-13', to:'2025-10-25', name:'Herbstferien'},
    {from:'2025-12-22', to:'2026-01-05', name:'Weihnachtsferien'},
    {from:'2026-02-02', to:'2026-02-03', name:'Winterferien'}
  ];
  const DEFAULT_FEIERTAGE = [{from:'2025-11-24', to:'2025-11-24', name:'Lehrerfortbildung'}];
  
  const user = loadUserData(); 
  const cutoffDay = ymdToDayNum(CUT_OFF); 
  const defaults = DEFAULT_HOLIDAYS.concat(DEFAULT_FEIERTAGE).filter(d=>ymdToDayNum(d.from) <= cutoffDay); 
  const map = new Map(); 
  defaults.forEach(d=> map.set(d.from+'|'+d.to, {from:d.from,to:d.to,name:d.name, source:'default'})); 
  (user.removedDefaults||[]).forEach(k=> map.delete(k)); 
  (user.user||[]).forEach(d=>{ 
    if(!d.from||!d.to) return; 
    map.set(d.from+'|'+d.to, {from:d.from,to:d.to,name:d.name||'', source:'user'}); 
  }); 
  return Array.from(map.values()).sort((a,b)=> a.from < b.from ? -1 : (a.from > b.from ? 1 : 0)); 
}

function isHoliday(dayNum){
  const holidays = buildEffectiveList();
  for(const h of holidays){
    const hs = ymdToDayNum(h.from);
    const he = ymdToDayNum(h.to);
    if(dayNum >= hs && dayNum <= he){
      return true;
    }
  }
  return false;
}

function calcUntilDayNums(startDayNum, endDayNum, includeStart){
  if(isNaN(startDayNum) || isNaN(endDayNum)) return { total:0, weekdays:0, holidayWeekdays:0, schooldays:0 };
  if(endDayNum < startDayNum) return { total:0, weekdays:0, holidayWeekdays:0, schooldays:0 };
  const total = endDayNum - startDayNum + (includeStart?1:0);
  const weekdays = countWeekdaysDayNums(startDayNum, endDayNum, includeStart);
  const holidays = buildEffectiveList();
  let holidayWeekdays = 0;
  for(const h of holidays){ 
    const hs = ymdToDayNum(h.from); 
    const he = ymdToDayNum(h.to); 
    holidayWeekdays += overlapWeekdaysDayNums(startDayNum, endDayNum, hs, he); 
  }
  const schooldays = Math.max(0, weekdays - holidayWeekdays);
  return { total, weekdays, holidayWeekdays, schooldays };
}

function getEndDate(){
  const savedEnd = localStorage.getItem('schultage_enddate_v1');
  return savedEnd || '2026-03-20';
}

function getRemainingSchoolDays(dateDayNum){
  const today = todayBerlinDayNum();
  const endDate = getEndDate();
  const endDayNum = ymdToDayNum(endDate);
  // includeToday-Einstellung aus localStorage (Standard: false)
  const includeToday = localStorage.getItem('schultage_includetoday_v1') === 'true';

  if(dateDayNum < today) return null; // Vergangene Tage
  if(dateDayNum > endDayNum) return null; // Nach dem letzten Schultag

  // Wenn includeToday aktiv ist und die Zelle das heutige Datum ist,
  // zählen wir ab heute (inklusive). Für alle anderen Zellen zählen wir
  // ab dem nächsten Tag (exklusiv), damit am letzten Schultag 0 übrig bleibt.
  const startDay = (includeToday && dateDayNum === today) ? dateDayNum : dateDayNum +2;

  // Wenn Start nach Ende liegt: keine verbleibenden Tage
  if(startDay > endDayNum) return 0;

  // calcUntilDayNums erwartet inkl. Start-Flag; wir übergeben true,
  // weil startDay bereits so gewählt ist, wie wir ihn einbeziehen wollen.
  const result = calcUntilDayNums(startDay, endDayNum, /*includeStart=*/ true);
  return result.schooldays;
}


function getDaysInMonth(month, year){
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(month, year){
  // JavaScript's getDay() gibt zurück: 0=Sonntag, 1=Montag, ..., 6=Samstag
  // Wir konvertieren zu: 0=Montag, 1=Dienstag, ..., 6=Sonntag
  const day = new Date(year, month, 1).getDay();
  return (day + 6) % 7; // Sonntag (0) -> 6, Montag (1) -> 0, etc.
}

function renderCalendar(){
  const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 
                      'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']; // Woche beginnt mit Montag
  
  const monthYearEl = document.getElementById('monthYear');
  monthYearEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  const calendarGrid = document.getElementById('calendarGrid');
  calendarGrid.innerHTML = '';
  
  // Wochentags-Header
  dayNames.forEach(day => {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'calendar-day-header';
    dayHeader.textContent = day;
    calendarGrid.appendChild(dayHeader);
  });
  
  const today = todayBerlinDayNum();
  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);
  
  // Leere Zellen für Tage vor dem ersten Tag des Monats
  for(let i = 0; i < firstDay; i++){
    const emptyDay = document.createElement('div');
    emptyDay.className = 'calendar-day empty';
    calendarGrid.appendChild(emptyDay);
  }
  
  // Tage des Monats
  for(let day = 1; day <= daysInMonth; day++){
    const date = new Date(currentYear, currentMonth, day);
    const dayOfWeek = date.getDay();
    const dayNum = Math.floor(date.getTime() / MS_PER_DAY);
    const ymd = dayNumToYmd(dayNum);
    
    const dayEl = document.createElement('div');
    dayEl.className = 'calendar-day';
    
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isPast = dayNum < today;
    const isHolidayDay = isHoliday(dayNum);
    const remainingDays = getRemainingSchoolDays(dayNum);
    
    if(isPast){
      dayEl.classList.add('past');
    } else if(isHolidayDay){
      dayEl.classList.add('holiday');
    } else if(isWeekend){
      dayEl.classList.add('weekend');
    }
    
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = day;
    dayEl.appendChild(dayNumber);
    
    if(remainingDays !== null && !isPast && !isWeekend && !isHolidayDay){
      const schoolDays = document.createElement('div');
      schoolDays.className = 'school-days-count';
      schoolDays.textContent = `${remainingDays}`;
      dayEl.appendChild(schoolDays);
    } else if(isHolidayDay && !isPast){
      const holidayLabel = document.createElement('div');
      holidayLabel.className = 'holiday-label';
      holidayLabel.textContent = 'Ferien';
      dayEl.appendChild(holidayLabel);
    }
    
    calendarGrid.appendChild(dayEl);
  }
}

function goToToday(){
  const now = new Date();
  currentMonth = now.getMonth();
  currentYear = now.getFullYear();
  renderCalendar();
}

function prevMonth(){
  currentMonth--;
  if(currentMonth < 0){
    currentMonth = 11;
    currentYear--;
  }
  renderCalendar();
}

function nextMonth(){
  currentMonth++;
  if(currentMonth > 11){
    currentMonth = 0;
    currentYear++;
  }
  renderCalendar();
}

function renderHolidayList(){ 
  const list = buildEffectiveList(); 
  const el = document.getElementById('holidayList'); 
  el.innerHTML=''; 
  if(list.length===0){ 
    el.textContent='–'; 
    return; 
  } 
  const ul = document.createElement('ul'); 
  list.forEach(h=>{ 
    const li = document.createElement('li'); 
    const span = document.createElement('span'); 
    span.textContent = `${h.name? h.name+' ' : ''}${h.from} → ${h.to}`; 
    const btn = document.createElement('button'); 
    btn.className='small-btn'; 
    btn.innerHTML='✕'; 
    btn.title='Löschen'; 
    btn.addEventListener('click', ()=> handleDeleteHoliday(h)); 
    li.appendChild(span); 
    li.appendChild(btn); 
    ul.appendChild(li); 
  }); 
  el.appendChild(ul); 
}

function handleDeleteHoliday(entry){ 
  const key = entry.from+'|'+entry.to; 
  const usr = loadUserData(); 
  if(entry.source==='user'){ 
    usr.user=(usr.user||[]).filter(u=>!(u.from===entry.from && u.to===entry.to)); 
    saveUserData(usr); 
  } else { 
    usr.removedDefaults = Array.from(new Set([...(usr.removedDefaults||[]), key])); 
    saveUserData(usr); 
  } 
  renderHolidayList(); 
  renderCalendar(); // Kalender neu rendern
}

function saveUserData(obj){ 
  obj.version = 1; 
  localStorage.setItem('schultage_userdata_v1', JSON.stringify(obj)); 
}

function addUserHoliday(from,to,name){ 
  if(!from||!to){ 
    alert('Bitte beide Daten angeben'); 
    return; 
  } 
  if(from>to){ 
    alert('Ungültig'); 
    return; 
  } 
  const usr = loadUserData(); 
  usr.user = usr.user||[]; 
  usr.user.push({from,to,name:name||''}); 
  saveUserData(usr); 
  renderHolidayList(); 
  renderCalendar(); // Kalender neu rendern
}

function exportJSON(){ 
  const usr = loadUserData(); 
  const blob = new Blob([JSON.stringify(usr,null,2)], {type:'application/json'}); 
  const url = URL.createObjectURL(blob); 
  const a=document.createElement('a'); 
  a.href=url; 
  a.download='schultage_userdata.json'; 
  document.body.appendChild(a); 
  a.click(); 
  a.remove(); 
  URL.revokeObjectURL(url); 
}

function importJSONFile(file){ 
  if(!file){ 
    alert('Keine Datei'); 
    return; 
  } 
  const r = new FileReader(); 
  r.onload = ()=>{ 
    try{ 
      const parsed = JSON.parse(r.result); 
      const users = Array.isArray(parsed.user) ? parsed.user.filter(u=>u && u.from && u.to) : []; 
      const removed = Array.isArray(parsed.removedDefaults)?parsed.removedDefaults:[]; 
      const p = { version: 1, user: users, removedDefaults: removed }; 
      saveUserData(p); 
      renderHolidayList(); 
      renderCalendar(); // Kalender neu rendern
      alert('Import fertig'); 
    }catch(e){ 
      alert('Ungültige Datei'); 
    } 
  }; 
  r.readAsText(file); 
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Hintergrundbild auf Kalenderseite deaktivieren
  document.body.classList.add('no-bg-image');
  
  const now = new Date();
  currentMonth = now.getMonth();
  currentYear = now.getFullYear();
  
  // Einstellungen initialisieren
  const s = loadUserData(); 
  saveUserData(s);
  const savedEnd = localStorage.getItem('schultage_enddate_v1'); 
  const elEndDate = document.getElementById('endDate');
  if(savedEnd) {
    elEndDate.value = savedEnd;
  } else {
    elEndDate.value = '2026-03-20';
  }
  
  // Lade includeToday-Einstellung
  const savedIncludeToday = localStorage.getItem('schultage_includetoday_v1');
  const elInclude = document.getElementById('includeToday');
  if(savedIncludeToday !== null) {
    elInclude.checked = savedIncludeToday === 'true';
  } else {
    elInclude.checked = false; // Standard: false
  }
  
  renderHolidayList();
  renderCalendar();
  
  // Kalender-Navigation
  document.getElementById('prevMonth').addEventListener('click', prevMonth);
  document.getElementById('nextMonth').addEventListener('click', nextMonth);
  document.getElementById('todayBtn').addEventListener('click', goToToday);
  
  // Einstellungen-Drawer
  const btnOpen = document.getElementById('openSettings');
  const drawer = document.getElementById('settingsDrawer');
  const btnClose = document.getElementById('closeSettings');
  
  btnOpen.addEventListener('click', ()=>{ 
    drawer.classList.toggle('open'); 
    drawer.setAttribute('aria-hidden', drawer.classList.contains('open') ? 'false' : 'true'); 
  });
  
  btnClose.addEventListener('click', ()=>{ 
    drawer.classList.remove('open'); 
    drawer.setAttribute('aria-hidden','true'); 
  });
  
  // Einstellungen-Event-Listener
  const btnAdd = document.getElementById('addHoliday');
  const btnReset = document.getElementById('resetHolidays');
  const elHolidayFrom = document.getElementById('holidayFrom');
  const elHolidayTo = document.getElementById('holidayTo');
  const btnExport = document.getElementById('exportBtn');
  const fileInput = document.getElementById('importFile');
  
  btnAdd && btnAdd.addEventListener('click', ()=>{ 
    addUserHoliday(elHolidayFrom.value, elHolidayTo.value, ''); 
    elHolidayFrom.value=''; 
    elHolidayTo.value=''; 
  });
  
  btnReset && btnReset.addEventListener('click', ()=>{ 
    if(confirm('Benutzer-Ferien zurücksetzen?')){ 
      localStorage.removeItem('schultage_userdata_v1'); 
      renderHolidayList(); 
      renderCalendar(); 
    } 
  });
  
  elEndDate.addEventListener('change', ()=>{ 
    localStorage.setItem('schultage_enddate_v1', elEndDate.value); 
    renderCalendar(); // Kalender neu rendern
  });
  
  elInclude.addEventListener('change', ()=>{ 
    localStorage.setItem('schultage_includetoday_v1', elInclude.checked ? 'true' : 'false'); 
    renderCalendar(); // Kalender neu rendern
  });
  
  btnExport && btnExport.addEventListener('click', exportJSON);
  fileInput && fileInput.addEventListener('change', (ev)=>{ 
    const f = ev.target.files && ev.target.files[0]; 
    if(f) importJSONFile(f); 
    ev.target.value=''; 
  });
});

	