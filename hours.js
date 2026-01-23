// Stundenplan- und Stundenberechnungs-Logik
const MS_PER_DAY = 24*60*60*1000;
const LS_KEY_TIMETABLE = 'schultage_timetable_v4';
const LS_KEY_REFERENCE_DATE = 'schultage_reference_date_v1';
const LS_KEY_DISPLAY_MODE = 'schultage_display_mode_v1';

// Zeitslots für neue Schulstruktur (7 Blöcke: 6×55min + 1×35min)
const TIME_SLOTS = [
  { name: '1. Block', time: '7:50-8:45', hours: 0.92, startMinutes: 7 * 60 + 50, endMinutes: 8 * 60 + 45, type: 'Fach' },
  { name: '2. Block', time: '8:50-9:45', hours: 0.92, startMinutes: 8 * 60 + 50, endMinutes: 9 * 60 + 45, type: 'Dalton' },
  { name: '3. Block', time: '10:05-11:00', hours: 0.92, startMinutes: 10 * 60 + 5, endMinutes: 11 * 60 + 0, type: 'Fach' },
  { name: '4. Block', time: '11:05-12:00', hours: 0.92, startMinutes: 11 * 60 + 5, endMinutes: 12 * 60 + 0, type: 'Dalton' },
  { name: '5. Block', time: '12:20-13:15', hours: 0.92, startMinutes: 12 * 60 + 20, endMinutes: 13 * 60 + 15, type: 'Fach' },
  { name: '6. Block', time: '14:00-14:35', hours: 0.58, startMinutes: 14 * 60 + 0, endMinutes: 14 * 60 + 35, type: 'Dalton' },
  { name: '7. Block', time: '14:35-15:30', hours: 0.92, startMinutes: 14 * 60 + 35, endMinutes: 15 * 60 + 30, type: 'Fach' }
];

const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];

let realtimeUpdateIntervalId = null;



function getBerlinCurrentSeconds(){
  const now = new Date();
  const berlinString = now.toLocaleString('en-US', { timeZone: 'Europe/Berlin' });
  const berlinNow = new Date(berlinString);
  const hours = berlinNow.getHours();
  const minutes = berlinNow.getMinutes();
  const seconds = berlinNow.getSeconds();
  return hours * 3600 + minutes * 60 + seconds;
}

function ymdToDayNum(ymd){ 
  if(!ymd) return NaN; 
  const [y,m,d] = ymd.split('-').map(Number); 
  return Math.floor(Date.UTC(y,m-1,d)/MS_PER_DAY); 
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

function getEndDate(){
  const savedEnd = localStorage.getItem('schultage_enddate_v1');
  return savedEnd || '2026-03-20';
}

function getIncludeToday(){
  return localStorage.getItem('schultage_includetoday_v1') === 'true';
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

// Stundenplan-Funktionen
function loadTimetableData(){
  try {
    const raw = localStorage.getItem(LS_KEY_TIMETABLE);
    if(!raw) return { 
      subjects: [], 
      weekA: { schedule: initializeSchedule() }, 
      weekB: { schedule: initializeSchedule() },
      subjectSettings: {} // Einstellungen pro Fach (z.B. onlyFirstSemester)
    };
    const data = JSON.parse(raw);
    
    // Migriere alte Datenstruktur
    if(!data.subjects) data.subjects = [];
    if(!data.subjectSettings) data.subjectSettings = {};
    
    // Migriere alte Struktur zu neuer
    if(data.weekA && Array.isArray(data.weekA)){
      // Alte Struktur - migriere zu neuer
      const subjects = new Set();
      data.weekA.forEach(s => {
        if(s.name) subjects.add(s.name);
      });
      if(data.weekB){
        data.weekB.forEach(s => {
          if(s.name) subjects.add(s.name);
        });
      }
      data.subjects = Array.from(subjects).map(name => ({ name: name.trim() }));
      data.weekA = { schedule: initializeSchedule() };
      data.weekB = { schedule: initializeSchedule() };
    } else if(!data.weekA || !data.weekA.schedule){
      data.weekA = { schedule: initializeSchedule() };
      data.weekB = { schedule: initializeSchedule() };
    }
    
     // Stelle sicher, dass onlyFirstSemester in subjectSettings ist
     if(data.weekA.onlyFirstSemester){
       Object.keys(data.weekA.onlyFirstSemester).forEach(subjectName => {
         if(data.weekA.onlyFirstSemester[subjectName]){
           data.subjectSettings[subjectName] = { onlyFirstSemester: true };
         }
       });
       delete data.weekA.onlyFirstSemester;
     }
     if(data.weekB && data.weekB.onlyFirstSemester){
       Object.keys(data.weekB.onlyFirstSemester).forEach(subjectName => {
         if(data.weekB.onlyFirstSemester[subjectName]){
           data.subjectSettings[subjectName] = { onlyFirstSemester: true };
         }
       });
       delete data.weekB.onlyFirstSemester;
     }

     // Migriere von 5-Slot zu 7-Slot Struktur
     if(data.weekA && data.weekA.schedule){
       data.weekA.schedule = sanitizeSchedule(data.weekA.schedule);
     }
     if(data.weekB && data.weekB.schedule){
       data.weekB.schedule = sanitizeSchedule(data.weekB.schedule);
     }

     return data;
  } catch(e) {
    return { 
      subjects: [], 
      weekA: { schedule: initializeSchedule() }, 
      weekB: { schedule: initializeSchedule() },
      subjectSettings: {}
    };
  }
}

// Initialisiere leeren Stundenplan (5 Wochentage x 7 Zeitslots)
function initializeSchedule(){
  const schedule = [];
  for(let day = 0; day < 5; day++){
    schedule[day] = [];
    for(let slot = 0; slot < 7; slot++){
      schedule[day][slot] = ''; // Leer = kein Fach
    }
  }
  return schedule;
}

function saveTimetableData(data){
  localStorage.setItem(LS_KEY_TIMETABLE, JSON.stringify(data));
}

function getReferenceDate(){
  const saved = localStorage.getItem(LS_KEY_REFERENCE_DATE);
  return saved || '';
}

function saveReferenceDate(date){
  localStorage.setItem(LS_KEY_REFERENCE_DATE, date);
}

function getDisplayMode(){
  // false = time mode (hours/minutes), true = block mode (real-time blocks)
  const saved = localStorage.getItem(LS_KEY_DISPLAY_MODE);
  return saved === 'true';
}

function saveDisplayMode(flag){
  localStorage.setItem(LS_KEY_DISPLAY_MODE, flag ? 'true' : 'false');
}

// Bestimme welche Woche (A oder B) für einen bestimmten Tag aktiv ist
function getActiveWeek(referenceDate, dateYmd){
  if(!referenceDate) return 'A'; // Fallback
  
  const refDayNum = ymdToDayNum(referenceDate);
  const dayNum = ymdToDayNum(dateYmd);
  
  if(isNaN(refDayNum) || isNaN(dayNum) || dayNum < refDayNum) return 'A';
  
  // Finde den Montag der Referenzwoche
  const refDate = new Date(refDayNum * MS_PER_DAY);
  const refDayOfWeek = refDate.getUTCDay();
  const daysToMonday = (refDayOfWeek + 6) % 7; // 0=Sonntag->6, 1=Montag->0, etc.
  const refMonday = refDayNum - daysToMonday;
  
  // Finde den Montag der aktuellen Woche
  const currentDate = new Date(dayNum * MS_PER_DAY);
  const currentDayOfWeek = currentDate.getUTCDay();
  const daysToCurrentMonday = (currentDayOfWeek + 6) % 7;
  const currentMonday = dayNum - daysToCurrentMonday;
  
  // Berechne Wochennummer (0-basiert)
  const weeksDiff = Math.floor((currentMonday - refMonday) / 7);
  
  // Woche 0 (erste Woche) = A, Woche 1 = B, Woche 2 = A, etc.
  return (weeksDiff % 2 === 0) ? 'A' : 'B';
}

// Berechne verbleibende Schultage
function getRemainingSchoolDays(){
  const today = todayBerlinDayNum();
  const endDate = getEndDate();
  const endDayNum = ymdToDayNum(endDate);
  const includeToday = getIncludeToday();
  
  if(isNaN(endDayNum)) return 0;
  
  const result = calcUntilDayNums(today, endDayNum, includeToday);
  return result.schooldays;
}

// Berechne verbleibende Schulwochen (von heute bis Ende)
function getRemainingSchoolWeeks(cutoffDate = null){
  const today = todayBerlinDayNum();
  const endDate = cutoffDate || getEndDate();
  const endDayNum = ymdToDayNum(endDate);
  const includeToday = getIncludeToday();
  
  if(isNaN(endDayNum)) return 0;
  
  const holidays = buildEffectiveList();
  const startDay = includeToday ? today : today + 1;
  
  // Wenn das Cut-off-Datum in der Vergangenheit liegt, keine Wochen
  if(endDayNum < startDay) return 0;
  
  // Finde den ersten Montag nach/bis heute
  const todayDate = new Date(startDay * MS_PER_DAY);
  const todayDayOfWeek = todayDate.getUTCDay();
  const daysToMonday = (todayDayOfWeek + 6) % 7;
  let checkMonday = startDay - daysToMonday;
  
  // Zähle verbleibende Schulwochen (Montag-Freitag)
  let weekCount = 0;
  
  // Gehe durch alle Wochen von checkMonday bis endDayNum
  while(checkMonday <= endDayNum){
    let hasSchoolDay = false;
    
    // Prüfe Montag-Freitag dieser Woche
    for(let dayOffset = 0; dayOffset < 5; dayOffset++){
      const dayNum = checkMonday + dayOffset;
      if(dayNum > endDayNum) break;
      if(dayNum < startDay) continue;
      
      // Prüfe ob Ferien
      let isHoliday = false;
      for(const h of holidays){
        const hs = ymdToDayNum(h.from);
        const he = ymdToDayNum(h.to);
        if(dayNum >= hs && dayNum <= he){
          isHoliday = true;
          break;
        }
      }
      
      if(!isHoliday){
        hasSchoolDay = true;
        break;
      }
    }
    
    if(hasSchoolDay){
      weekCount++;
    }
    
    checkMonday += 7; // Nächste Woche
  }
  
  return weekCount;
}

// Berechne verbleibende Stunden
function calculateRemainingHours(timetableData, referenceDate){
  if(!referenceDate) return { totalSeconds: 0, subjectSeconds: {} };
  
  const today = todayBerlinDayNum();
  const endDate = getEndDate();
  const endDayNum = ymdToDayNum(endDate);
  const includeToday = getIncludeToday();
  const startDay = includeToday ? today : today + 1;
  const displayMode = getDisplayMode();
  const useRealTimeBlocks = displayMode; // In block mode, always use real-time calculation
  
  if(isNaN(endDayNum)) return { totalSeconds: 0, subjectSeconds: {} };
  
  // Finde den ersten verbleibenden Schultag
  const holidays = buildEffectiveList();
  let firstSchoolDay = null;
  
  for(let dayNum = startDay; dayNum <= endDayNum; dayNum++){
    const dayOfWeek = new Date(dayNum * MS_PER_DAY).getUTCDay();
    if(dayOfWeek === 0 || dayOfWeek === 6) continue; // Wochenende
    
    let isHoliday = false;
    for(const h of holidays){
      const hs = ymdToDayNum(h.from);
      const he = ymdToDayNum(h.to);
      if(dayNum >= hs && dayNum <= he){
        isHoliday = true;
        break;
      }
    }
    if(isHoliday) continue;
    
    firstSchoolDay = dayNum;
    break;
  }
  
  if(!firstSchoolDay) return { totalSeconds: 0, subjectSeconds: {} };
  
  // Bestimme welche Woche (A oder B) der erste Schultag ist
  const firstSchoolDayYmd = new Date(firstSchoolDay * MS_PER_DAY).toISOString().split('T')[0];
  const firstWeekType = getActiveWeek(referenceDate, firstSchoolDayYmd);
  
  // Berechne wie viele Wochen A und B noch kommen (gesamtes Schuljahr)
  const totalWeeks = getRemainingSchoolWeeks();
  
  let weeksA, weeksB;
  if(firstWeekType === 'A'){
    weeksA = Math.ceil(totalWeeks / 2);
    weeksB = Math.floor(totalWeeks / 2);
  } else {
    weeksA = Math.floor(totalWeeks / 2);
    weeksB = Math.ceil(totalWeeks / 2);
  }
  
  // Berechne Wochen für erstes Halbjahr (bis 19.12.)
  // Das erste Halbjahr endet am 19.12. des Jahres vor dem Schuljahresende
  // Wenn Schuljahr bis März 2026 geht, dann endet 1. Halbjahr am 19.12.2025
  const endDateObj = new Date(endDayNum * MS_PER_DAY);
  let firstSemesterYear = endDateObj.getUTCFullYear();
  // Wenn Enddatum im Januar-März liegt, ist das Halbjahr im Vorjahr
  const endMonth = endDateObj.getUTCMonth();
  if(endMonth < 3){ // 0=Januar, 1=Februar, 2=März
    firstSemesterYear = firstSemesterYear - 1;
  }
  const firstSemesterEndDate = `${firstSemesterYear}-12-19`;
  const firstSemesterWeeks = getRemainingSchoolWeeks(firstSemesterEndDate);
  
  let weeksAFirstSemester, weeksBFirstSemester;
  if(firstWeekType === 'A'){
    weeksAFirstSemester = Math.ceil(firstSemesterWeeks / 2);
    weeksBFirstSemester = Math.floor(firstSemesterWeeks / 2);
  } else {
    weeksAFirstSemester = Math.floor(firstSemesterWeeks / 2);
    weeksBFirstSemester = Math.ceil(firstSemesterWeeks / 2);
  }
  
  // Immer Tagesmodus verwenden (Dropdown-basiert)
  const currentSecondsBerlin = includeToday ? getBerlinCurrentSeconds() : null;
  return calculateRemainingHoursDaily(
    timetableData,
    referenceDate,
    firstWeekType,
    weeksA,
    weeksB,
    weeksAFirstSemester,
    weeksBFirstSemester,
    startDay,
    endDayNum,
    holidays,
    includeToday,
    today,
    currentSecondsBerlin,
    useRealTimeBlocks
  );
}

// Berechne Stunden im Tagesmodus
function calculateRemainingHoursDaily(
  timetableData,
  referenceDate,
  firstWeekType,
  weeksA,
  weeksB,
  weeksAFirstSemester,
  weeksBFirstSemester,
  startDay,
  endDayNum,
  holidays,
  includeTodayFlag,
  todayDayNum,
  currentSecondsBerlin,
  useRealTimeBlocks
){
  const subjectSeconds = {};
  const subjectBlocks = {};
  let totalSeconds = 0;
  let totalBlocks = 0;

  // Initialisiere alle Fächer mit 0 Stunden und Blöcken
  if(timetableData.subjects && Array.isArray(timetableData.subjects)){
    timetableData.subjects.forEach(subject => {
      if(subject && subject.name && subject.name.trim()){
        subjectSeconds[subject.name] = 0;
        subjectBlocks[subject.name] = 0;
      }
    });
  }
  
  // Prüfe ob dieser Tag im ersten Halbjahr liegt
  const endDateObj = new Date(endDayNum * MS_PER_DAY);
  let firstSemesterYear = endDateObj.getUTCFullYear();
  const endMonth = endDateObj.getUTCMonth();
  if(endMonth < 3){
    firstSemesterYear = firstSemesterYear - 1;
  }
  const firstSemesterEndDate = `${firstSemesterYear}-12-19`;
  const firstSemesterEndDayNum = ymdToDayNum(firstSemesterEndDate);
  
  // Gehe durch alle verbleibenden Tage
  for(let dayNum = startDay; dayNum <= endDayNum; dayNum++){
    const dayOfWeek = new Date(dayNum * MS_PER_DAY).getUTCDay();
    
    // Überspringe Wochenenden (0=Sonntag, 6=Samstag)
    if(dayOfWeek === 0 || dayOfWeek === 6) continue;
    
    // Überspringe Ferien
    let isHoliday = false;
    for(const h of holidays){
      const hs = ymdToDayNum(h.from);
      const he = ymdToDayNum(h.to);
      if(dayNum >= hs && dayNum <= he){
        isHoliday = true;
        break;
      }
    }
    if(isHoliday) continue;
    
    // Bestimme aktive Woche für diesen Tag
    const dayYmd = new Date(dayNum * MS_PER_DAY).toISOString().split('T')[0];
    const activeWeek = getActiveWeek(referenceDate, dayYmd);
    const weekData = activeWeek === 'A' ? timetableData.weekA : timetableData.weekB;
    const schedule = weekData.schedule || initializeSchedule();
    
    // Wochentag: JavaScript getDay() gibt 0=Sonntag, 1=Montag, ..., 6=Samstag
    // Wir brauchen: 0=Montag, 1=Dienstag, ..., 4=Freitag
    let weekdayIndex;
    if(dayOfWeek === 0) continue; // Sonntag überspringen
    weekdayIndex = dayOfWeek - 1; // Montag(1)->0, Dienstag(2)->1, ..., Freitag(5)->4
    if(weekdayIndex > 4 || weekdayIndex < 0) continue; // Sicherheit
    
    const isFirstSemester = dayNum <= firstSemesterEndDayNum;
    const isToday = includeTodayFlag && currentSecondsBerlin !== null && dayNum === todayDayNum;
    
    // Gehe durch alle Zeitslots an diesem Tag
    if(schedule && schedule[weekdayIndex]){
      TIME_SLOTS.forEach((slot, slotIndex) => {
        const subjectName = schedule[weekdayIndex][slotIndex];
        if(!subjectName || !subjectName.trim()) return;
        
        // Prüfe ob Fach nur erstes Halbjahr und Tag ist nach erstem Halbjahr
        if(timetableData.subjectSettings){
          const subjectSettings = timetableData.subjectSettings[subjectName];
          if(subjectSettings && subjectSettings.onlyFirstSemester && !isFirstSemester) return;
        }
        
        const slotStartSeconds = slot.startMinutes * 60;
        const slotEndSeconds = slot.endMinutes * 60;
        const actualDurationSeconds = Math.max(slotEndSeconds - slotStartSeconds, 1);
        const fullSlotSeconds = useRealTimeBlocks ? actualDurationSeconds : slot.hours * 3600;
        let slotSeconds = fullSlotSeconds;
        
        if(isToday && currentSecondsBerlin !== null){
          let ratio;
          if(currentSecondsBerlin >= slotEndSeconds){
            ratio = 0;
          } else if(currentSecondsBerlin <= slotStartSeconds){
            ratio = 1;
          } else {
            ratio = (slotEndSeconds - currentSecondsBerlin) / actualDurationSeconds;
          }
          ratio = Math.max(0, Math.min(1, ratio));
          slotSeconds = Math.round(fullSlotSeconds * ratio);
        }

        if(slotSeconds <= 0) return;

        // Zähle Sekunden (ggf. Rest) für diesen Slot
        subjectSeconds[subjectName] = (subjectSeconds[subjectName] || 0) + slotSeconds;
        totalSeconds += slotSeconds;

        // Zähle Blöcke (ggf. Rest) für diesen Slot
        let slotBlocks = 1.0; // Standard: 1 voller Block
        if(isToday && currentSecondsBerlin !== null){
          // Verwende denselben ratio für Blöcke
          let ratio;
          if(currentSecondsBerlin >= slotEndSeconds){
            ratio = 0;
          } else if(currentSecondsBerlin <= slotStartSeconds){
            ratio = 1;
          } else {
            ratio = (slotEndSeconds - currentSecondsBerlin) / actualDurationSeconds;
          }
          ratio = Math.max(0, Math.min(1, ratio));
          slotBlocks = ratio;
        }

        subjectBlocks[subjectName] = (subjectBlocks[subjectName] || 0) + slotBlocks;
        totalBlocks += slotBlocks;
      });
    }
  }
  
  // Entferne Fächer mit 0 Stunden und Blöcken
  Object.keys(subjectSeconds).forEach(key => {
    if(subjectSeconds[key] === 0){
      delete subjectSeconds[key];
      delete subjectBlocks[key];
    }
  });

  return { totalSeconds, subjectSeconds, totalBlocks, subjectBlocks };
}

// UI-Funktionen
let currentWeekView = 'A';

function renderTimetable(week){
  renderTimetableDaily(week);
}

function renderTimetableDaily(week){
  const containerEl = document.getElementById(`timetableSchedule${week}`);
  containerEl.innerHTML = '';
  
  // Stelle sicher, dass weekData existiert
  if(!timetableData[`week${week}`]){
    timetableData[`week${week}`] = { schedule: initializeSchedule() };
  }
  
  const weekData = timetableData[`week${week}`];
  
  // Stelle sicher, dass schedule existiert und korrekt initialisiert ist
  if(!weekData.schedule || !Array.isArray(weekData.schedule) || weekData.schedule.length === 0){
    weekData.schedule = initializeSchedule();
    saveTimetableData(timetableData);
  }
  
  const schedule = weekData.schedule;
  
  // Stelle sicher, dass alle Tage und Slots initialisiert sind
  // UND dass alle Werte wirklich leer sind, wenn sie nicht explizit gesetzt wurden
  for(let day = 0; day < 5; day++){
    if(!schedule[day] || !Array.isArray(schedule[day])){
      schedule[day] = ['', '', '', '', '', '', ''];
    } else {
      // Stelle sicher, dass alle Slots Strings sind und leer, wenn nicht explizit gesetzt
      for(let slot = 0; slot < 7; slot++){
        const currentSlotValue = schedule[day][slot];
        // Nur behalten wenn es ein nicht-leerer String ist UND das Fach noch existiert
        if(currentSlotValue && typeof currentSlotValue === 'string' && currentSlotValue.trim()){
          const subjectExists = timetableData.subjects && timetableData.subjects.some(s => s && s.name && s.name.trim() === currentSlotValue.trim());
          if(!subjectExists){
            // Fach existiert nicht mehr, setze auf leer
            schedule[day][slot] = '';
          }
        } else {
          // Wert ist leer, undefined, null oder kein String - setze auf leer
          schedule[day][slot] = '';
        }
      }
    }
  }
  
  // Speichere den bereinigten Schedule
  weekData.schedule = schedule;
  saveTimetableData(timetableData);
  
  // Erstelle Stundenplan-Tabelle
  const timetableTable = document.createElement('div');
  timetableTable.className = 'timetable-table';
  
  // Header mit Wochentagen
  const tableHeader = document.createElement('div');
  tableHeader.className = 'timetable-header';
  const emptyHeader = document.createElement('div');
  emptyHeader.className = 'timetable-cell-header';
  tableHeader.appendChild(emptyHeader);
  WEEKDAYS.forEach(day => {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'timetable-cell-header';
    dayHeader.textContent = day;
    tableHeader.appendChild(dayHeader);
  });
  timetableTable.appendChild(tableHeader);
  
  // Zeilen für jeden Zeitslot
  TIME_SLOTS.forEach((slot, slotIndex) => {
    const tableRow = document.createElement('div');
    tableRow.className = 'timetable-row';
    
    const slotLabel = document.createElement('div');
    slotLabel.className = 'timetable-slot-label';
    slotLabel.textContent = `${slot.name}`;
    slotLabel.title = `${slot.time} (${slot.hours} Stunden)`;
    tableRow.appendChild(slotLabel);
    
    // Zellen für jeden Wochentag
    WEEKDAYS.forEach((day, dayIndex) => {
      const cell = document.createElement('div');
      cell.className = 'timetable-cell';
      
      const select = document.createElement('select');
      select.className = 'timetable-select';
      
      // Stelle sicher, dass der Schedule-Wert korrekt initialisiert ist
      if(!schedule[dayIndex]){
        schedule[dayIndex] = [];
      }
      if(schedule[dayIndex][slotIndex] === undefined || schedule[dayIndex][slotIndex] === null || schedule[dayIndex][slotIndex] === ''){
        schedule[dayIndex][slotIndex] = '';
      }
      
      // Hole aktuellen Wert aus Schedule (falls vorhanden)
      const currentValue = (schedule[dayIndex][slotIndex] && typeof schedule[dayIndex][slotIndex] === 'string' && schedule[dayIndex][slotIndex].trim()) 
        ? schedule[dayIndex][slotIndex] 
        : '';
      
      // Option: Leer (zuerst hinzufügen)
      const emptyOption = document.createElement('option');
      emptyOption.value = '';
      emptyOption.textContent = '—';
      select.appendChild(emptyOption);
      
      // Optionen für alle Fächer
      if(timetableData.subjects && Array.isArray(timetableData.subjects)){
        timetableData.subjects.forEach(subject => {
          if(subject && subject.name && subject.name.trim()){
            const option = document.createElement('option');
            option.value = subject.name;
            option.textContent = subject.name;
            select.appendChild(option);
          }
        });
      }
      
      // Setze den Wert NUR wenn ein gültiger Wert im Schedule existiert
      // UND das Fach noch existiert
      if(currentValue){
        // Prüfe, ob das Fach noch existiert
        const subjectExists = timetableData.subjects && timetableData.subjects.some(s => s && s.name && s.name.trim() === currentValue);
        if(subjectExists){
          // Setze Wert und markiere entsprechende Option als selected
          select.value = currentValue;
        } else {
          // Fach existiert nicht mehr, setze Schedule auf leer
          schedule[dayIndex][slotIndex] = '';
          select.selectedIndex = 0; // Wähle erste Option (leer)
        }
      } else {
        // Kein Wert vorhanden, stelle sicher dass leer ausgewählt ist
        select.selectedIndex = 0; // Wähle erste Option (leer)
        schedule[dayIndex][slotIndex] = '';
      }
      
      // Event Listener hinzufügen (nachdem Wert gesetzt wurde)
      select.addEventListener('change', () => {
        const newValue = select.value || '';
        
        // Aktualisiere Schedule
        if(!schedule[dayIndex]){
          schedule[dayIndex] = [];
        }
        schedule[dayIndex][slotIndex] = newValue;
        
        // Speichere Daten
        if(!timetableData[`week${week}`]){
          timetableData[`week${week}`] = { schedule: initializeSchedule() };
        }
        timetableData[`week${week}`].schedule = schedule;
        saveTimetableData(timetableData);
        updateHoursDisplay();
      });
      
      cell.appendChild(select);
      tableRow.appendChild(cell);
    });
    
    timetableTable.appendChild(tableRow);
  });
  
  containerEl.appendChild(timetableTable);
}

// Rendere Fächerliste
function renderSubjectsList(){
  const listEl = document.getElementById('subjectsList');
  listEl.innerHTML = '';
  
  if(timetableData.subjects.length === 0){
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-message';
    emptyMsg.textContent = 'Noch keine Fächer hinzugefügt';
    listEl.appendChild(emptyMsg);
    return;
  }
  
  timetableData.subjects.forEach((subject, index) => {
    const subjectRow = document.createElement('div');
    subjectRow.className = 'subject-row';
    
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'subject-name-input';
    nameInput.placeholder = 'Fachname';
    nameInput.value = subject.name || '';
    nameInput.addEventListener('change', () => {
      const oldName = subject.name;
      subject.name = nameInput.value.trim();
      
      // Aktualisiere alle Verweise auf dieses Fach im Stundenplan
      if(oldName !== subject.name){
        // Aktualisiere Stundenplan
        ['A', 'B'].forEach(week => {
          const weekData = timetableData[`week${week}`];
          if(weekData && weekData.schedule){
            const schedule = weekData.schedule;
            for(let day = 0; day < 5; day++){
              if(schedule[day]){
                for(let slot = 0; slot < 7; slot++){
                  if(schedule[day][slot] === oldName){
                    schedule[day][slot] = subject.name;
                  }
                }
              }
            }
          }
        });
        
        // Aktualisiere Einstellungen
        if(timetableData.subjectSettings[oldName]){
          timetableData.subjectSettings[subject.name] = timetableData.subjectSettings[oldName];
          delete timetableData.subjectSettings[oldName];
        }
      }
      
      saveTimetableData(timetableData);
      renderTimetable('A');
      renderTimetable('B');
      updateHoursDisplay();
      
      // Kein automatisches Scrollen mehr
    });
    
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'checkbox-wrapper';
    
    const firstSemesterCheckbox = document.createElement('input');
    firstSemesterCheckbox.type = 'checkbox';
    firstSemesterCheckbox.className = 'checkbox';
    firstSemesterCheckbox.id = `firstSemester-${index}`;
    const subjectSettings = timetableData.subjectSettings[subject.name] || {};
    firstSemesterCheckbox.checked = subjectSettings.onlyFirstSemester || false;
    firstSemesterCheckbox.addEventListener('change', () => {
      if(!timetableData.subjectSettings[subject.name]){
        timetableData.subjectSettings[subject.name] = {};
      }
      timetableData.subjectSettings[subject.name].onlyFirstSemester = firstSemesterCheckbox.checked;
      saveTimetableData(timetableData);
      updateHoursDisplay();
    });
    
    const checkboxLabel = document.createElement('label');
    checkboxLabel.htmlFor = `firstSemester-${index}`;
    checkboxLabel.className = 'checkbox-label-small';
    checkboxLabel.textContent = 'Nur 1. Halbjahr';
    checkboxLabel.title = 'Nur bis 19.12. zählen';
    
    checkboxWrapper.appendChild(firstSemesterCheckbox);
    checkboxWrapper.appendChild(checkboxLabel);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'small-btn delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Löschen';
    deleteBtn.addEventListener('click', () => {
      const subjectName = subject.name;
      // Entferne Fach aus Stundenplan
      ['A', 'B'].forEach(week => {
        const weekData = timetableData[`week${week}`];
        if(weekData && weekData.schedule){
          const schedule = weekData.schedule;
          for(let day = 0; day < 5; day++){
            if(schedule[day]){
              for(let slot = 0; slot < 7; slot++){
                if(schedule[day][slot] === subjectName){
                  schedule[day][slot] = '';
                }
              }
            }
          }
        }
      });
      
      // Entferne Fach aus Liste und Einstellungen
      timetableData.subjects.splice(index, 1);
      delete timetableData.subjectSettings[subjectName];
      
      saveTimetableData(timetableData);
      renderSubjectsList();
      renderTimetable('A');
      renderTimetable('B');
      updateHoursDisplay();
    });
    
    subjectRow.appendChild(nameInput);
    subjectRow.appendChild(checkboxWrapper);
    subjectRow.appendChild(deleteBtn);
    listEl.appendChild(subjectRow);
  });
}

function renderSubjectListWeekly(week, subjects, listEl){
  if(subjects.length === 0){
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-message';
    emptyMsg.textContent = 'Noch keine Fächer hinzugefügt';
    listEl.appendChild(emptyMsg);
    return;
  }
  
  subjects.forEach((subject, index) => {
    const subjectRow = document.createElement('div');
    subjectRow.className = 'subject-row';
    
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'subject-name-input';
    nameInput.placeholder = 'Fachname';
    nameInput.value = subject.name || '';
    nameInput.addEventListener('change', () => {
      subject.name = nameInput.value.trim();
      saveTimetableData(timetableData);
      updateHoursDisplay();
    });
    
    const hoursInput = document.createElement('input');
    hoursInput.type = 'number';
    hoursInput.className = 'subject-hours-input';
    hoursInput.placeholder = 'Std./Woche';
    hoursInput.min = '0';
    hoursInput.step = '0.5';
    hoursInput.value = subject.hours || '';
    hoursInput.addEventListener('change', () => {
      subject.hours = parseFloat(hoursInput.value) || 0;
      saveTimetableData(timetableData);
      updateHoursDisplay();
    });
    
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'checkbox-wrapper';
    
    const firstSemesterCheckbox = document.createElement('input');
    firstSemesterCheckbox.type = 'checkbox';
    firstSemesterCheckbox.className = 'checkbox';
    firstSemesterCheckbox.id = `firstSemester-${week}-${index}`;
    firstSemesterCheckbox.checked = subject.onlyFirstSemester || false;
    firstSemesterCheckbox.addEventListener('change', () => {
      subject.onlyFirstSemester = firstSemesterCheckbox.checked;
      // Synchronisiere mit derselben Option in der anderen Woche, falls das Fach dort auch existiert
      const otherWeek = week === 'A' ? 'B' : 'A';
      timetableData[`week${otherWeek}`].forEach(s => {
        if(s.name && s.name.trim() === subject.name && subject.name.trim()){
          s.onlyFirstSemester = firstSemesterCheckbox.checked;
        }
      });
      saveTimetableData(timetableData);
      // Aktualisiere die andere Woche, falls sie sichtbar ist
      if(document.getElementById(`subjectList${otherWeek}`).children.length > 0){
        renderSubjectList(otherWeek, timetableData[`week${otherWeek}`]);
      }
      updateHoursDisplay();
    });
    
    const checkboxLabel = document.createElement('label');
    checkboxLabel.htmlFor = `firstSemester-${week}-${index}`;
    checkboxLabel.className = 'checkbox-label-small';
    checkboxLabel.textContent = 'Nur 1. Halbjahr';
    checkboxLabel.title = 'Nur bis 19.12. zählen';
    
    checkboxWrapper.appendChild(firstSemesterCheckbox);
    checkboxWrapper.appendChild(checkboxLabel);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'small-btn delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Löschen';
    deleteBtn.addEventListener('click', () => {
      timetableData[`week${week}`].splice(index, 1);
      saveTimetableData(timetableData);
      renderSubjectList(week, timetableData[`week${week}`]);
      updateHoursDisplay();
    });
    
    subjectRow.appendChild(nameInput);
    subjectRow.appendChild(hoursInput);
    subjectRow.appendChild(checkboxWrapper);
    subjectRow.appendChild(deleteBtn);
    listEl.appendChild(subjectRow);
  });
}

function renderSubjectListDaily(week, subjects, listEl){
  if(subjects.length === 0){
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'empty-message';
    emptyMsg.textContent = 'Noch keine Fächer hinzugefügt';
    listEl.appendChild(emptyMsg);
    return;
  }
  
  subjects.forEach((subject, index) => {
    const subjectCard = document.createElement('div');
    subjectCard.className = 'subject-card-daily';
    
    // Fachname und Optionen
    const subjectHeader = document.createElement('div');
    subjectHeader.className = 'subject-header-daily';
    
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'subject-name-input-daily';
    nameInput.placeholder = 'Fachname';
    nameInput.value = subject.name || '';
    nameInput.addEventListener('change', () => {
      subject.name = nameInput.value.trim();
      saveTimetableData(timetableData);
      updateHoursDisplay();
    });
    
    const checkboxWrapper = document.createElement('div');
    checkboxWrapper.className = 'checkbox-wrapper';
    
    const firstSemesterCheckbox = document.createElement('input');
    firstSemesterCheckbox.type = 'checkbox';
    firstSemesterCheckbox.className = 'checkbox';
    firstSemesterCheckbox.id = `firstSemester-${week}-${index}`;
    firstSemesterCheckbox.checked = subject.onlyFirstSemester || false;
    firstSemesterCheckbox.addEventListener('change', () => {
      subject.onlyFirstSemester = firstSemesterCheckbox.checked;
      const otherWeek = week === 'A' ? 'B' : 'A';
      timetableData[`week${otherWeek}`].forEach(s => {
        if(s.name && s.name.trim() === subject.name && subject.name.trim()){
          s.onlyFirstSemester = firstSemesterCheckbox.checked;
        }
      });
      saveTimetableData(timetableData);
      if(document.getElementById(`subjectList${otherWeek}`).children.length > 0){
        renderSubjectList(otherWeek, timetableData[`week${otherWeek}`]);
      }
      updateHoursDisplay();
    });
    
    const checkboxLabel = document.createElement('label');
    checkboxLabel.htmlFor = `firstSemester-${week}-${index}`;
    checkboxLabel.className = 'checkbox-label-small';
    checkboxLabel.textContent = 'Nur 1. Halbjahr';
    checkboxLabel.title = 'Nur bis 19.12. zählen';
    
    checkboxWrapper.appendChild(firstSemesterCheckbox);
    checkboxWrapper.appendChild(checkboxLabel);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'small-btn delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'Löschen';
    deleteBtn.addEventListener('click', () => {
      timetableData[`week${week}`].splice(index, 1);
      saveTimetableData(timetableData);
      renderSubjectList(week, timetableData[`week${week}`]);
      updateHoursDisplay();
    });
    
    subjectHeader.appendChild(nameInput);
    subjectHeader.appendChild(checkboxWrapper);
    subjectHeader.appendChild(deleteBtn);
    
    // Stundenplan-Tabelle
    const timetableTable = document.createElement('div');
    timetableTable.className = 'timetable-table';
    
    // Header mit Wochentagen
    const tableHeader = document.createElement('div');
    tableHeader.className = 'timetable-header';
    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'timetable-cell-header';
    tableHeader.appendChild(emptyHeader);
    WEEKDAYS.forEach(day => {
      const dayHeader = document.createElement('div');
      dayHeader.className = 'timetable-cell-header';
      dayHeader.textContent = day;
      tableHeader.appendChild(dayHeader);
    });
    timetableTable.appendChild(tableHeader);
    
    // Initialisiere days-Array falls nicht vorhanden
    if(!subject.days){
      subject.days = [];
      for(let i = 0; i < 5; i++){
        subject.days[i] = [false, false, false, false, false];
      }
    }
    
    // Zeilen für jeden Zeitslot
    TIME_SLOTS.forEach((slot, slotIndex) => {
      const tableRow = document.createElement('div');
      tableRow.className = 'timetable-row';
      
      const slotLabel = document.createElement('div');
      slotLabel.className = 'timetable-slot-label';
      slotLabel.textContent = `${slot.name}`;
      slotLabel.title = slot.time;
      tableRow.appendChild(slotLabel);
      
      // Zellen für jeden Wochentag
      WEEKDAYS.forEach((day, dayIndex) => {
        const cell = document.createElement('div');
        cell.className = 'timetable-cell';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'timetable-checkbox';
        checkbox.checked = subject.days[dayIndex] && subject.days[dayIndex][slotIndex] || false;
        checkbox.addEventListener('change', () => {
          if(!subject.days[dayIndex]){
            subject.days[dayIndex] = [false, false, false, false, false];
          }
          subject.days[dayIndex][slotIndex] = checkbox.checked;
          saveTimetableData(timetableData);
          updateHoursDisplay();
        });
        
        cell.appendChild(checkbox);
        tableRow.appendChild(cell);
      });
      
      timetableTable.appendChild(tableRow);
    });
    
    subjectCard.appendChild(subjectHeader);
    subjectCard.appendChild(timetableTable);
    listEl.appendChild(subjectCard);
  });
}

function addSubject(){
  timetableData.subjects.push({ name: '' });
  saveTimetableData(timetableData);
  renderSubjectsList();
  // Aktualisiere Dropdowns in Stundenplan
  renderTimetable('A');
  renderTimetable('B');
  
  // Fokus auf das neue Eingabefeld setzen (ohne die Seite zu scrollen)
  setTimeout(() => {
    const nameInputs = document.querySelectorAll('.subject-name-input');
    if(nameInputs.length > 0){
      const lastInput = nameInputs[nameInputs.length - 1];
      // Einfach fokussieren ohne zu scrollen
      // Wenn das Feld außerhalb des Viewports ist, wird der Browser automatisch minimal scrollen,
      // aber wir verhindern explizites Scrollen
      try {
        lastInput.focus({ preventScroll: true });
      } catch(e) {
        // Fallback für Browser die preventScroll nicht unterstützen
        lastInput.focus();
      }
    }
  }, 50);
}

// Kopiere Woche A nach Woche B
function copyWeekAToB(){
  if(!timetableData.weekA){
    timetableData.weekA = { schedule: initializeSchedule() };
  }
  
  const scheduleA = timetableData.weekA.schedule || initializeSchedule();
  
  // Erstelle eine tiefe Kopie des Schedules
  const scheduleBCopy = [];
  
  for(let day = 0; day < 5; day++){
    scheduleBCopy[day] = [];
    if(scheduleA[day] && Array.isArray(scheduleA[day])){
      for(let slot = 0; slot < 7; slot++){
        scheduleBCopy[day][slot] = scheduleA[day][slot] || '';
      }
    } else {
      scheduleBCopy[day] = ['', '', '', '', '', '', ''];
    }
  }
  
  if(!timetableData.weekB){
    timetableData.weekB = { schedule: initializeSchedule() };
  }
  timetableData.weekB.schedule = scheduleBCopy;
  saveTimetableData(timetableData);
  renderTimetable('B');
  updateHoursDisplay();
  
  // Wechsle zu Woche B
  const weekBtns = document.querySelectorAll('.week-btn');
  weekBtns.forEach(btn => {
    if(btn.dataset.week === 'B'){
      btn.click();
    }
  });
}

// Kopiere Woche B nach Woche A
function copyWeekBToA(){
  if(!timetableData.weekB){
    timetableData.weekB = { schedule: initializeSchedule() };
  }
  
  const scheduleB = timetableData.weekB.schedule || initializeSchedule();
  
  // Erstelle eine tiefe Kopie des Schedules
  const scheduleACopy = [];
  
  for(let day = 0; day < 5; day++){
    scheduleACopy[day] = [];
    if(scheduleB[day] && Array.isArray(scheduleB[day])){
      for(let slot = 0; slot < 7; slot++){
        scheduleACopy[day][slot] = scheduleB[day][slot] || '';
      }
    } else {
      scheduleACopy[day] = ['', '', '', '', '', '', ''];
    }
  }
  
  if(!timetableData.weekA){
    timetableData.weekA = { schedule: initializeSchedule() };
  }
  timetableData.weekA.schedule = scheduleACopy;
  saveTimetableData(timetableData);
  renderTimetable('A');
  updateHoursDisplay();
  
  // Wechsle zu Woche A
  const weekBtns = document.querySelectorAll('.week-btn');
  weekBtns.forEach(btn => {
    if(btn.dataset.week === 'A'){
      btn.click();
    }
  });
}

// Leere den Stundenplan einer Woche
function clearTimetable(week){
  if(!confirm(`Möchten Sie wirklich Woche ${week} leeren?`)){
    return;
  }
  
  if(!timetableData[`week${week}`]){
    timetableData[`week${week}`] = { schedule: initializeSchedule() };
  } else {
    timetableData[`week${week}`].schedule = initializeSchedule();
  }
  
  saveTimetableData(timetableData);
  renderTimetable(week);
  updateHoursDisplay();
}

function sanitizeSchedule(schedule){
  const sanitized = [];
  for(let day = 0; day < 5; day++){
    sanitized[day] = [];
    if(schedule && Array.isArray(schedule[day])){
      // Migriere von 5-Slot zu 7-Slot Struktur
      const existingSlots = schedule[day].length;
      for(let slot = 0; slot < 7; slot++){
        if(slot < existingSlots){
          const value = schedule[day][slot];
          sanitized[day][slot] = (typeof value === 'string') ? value : '';
        } else {
          // Neue Slots (6 und 7) als leer initialisieren
          sanitized[day][slot] = '';
        }
      }
    } else {
      sanitized[day] = ['', '', '', '', '', '', ''];
    }
  }
  return sanitized;
}

function sanitizeImportedData(data){
  const sanitized = {
    subjects: [],
    weekA: { schedule: sanitizeSchedule([]) },
    weekB: { schedule: sanitizeSchedule([]) },
    subjectSettings: {}
  };
  
  if(data && Array.isArray(data.subjects)){
    sanitized.subjects = data.subjects
      .filter(s => s && typeof s.name === 'string' && s.name.trim())
      .map(s => ({ name: s.name.trim() }));
  }
  
  if(data && data.subjectSettings && typeof data.subjectSettings === 'object'){
    sanitized.subjectSettings = {};
    Object.entries(data.subjectSettings).forEach(([key, value]) => {
      if(typeof key === 'string' && key.trim()){
        sanitized.subjectSettings[key.trim()] = {
          onlyFirstSemester: !!(value && value.onlyFirstSemester)
        };
      }
    });
  }
  
  if(data && data.weekA){
    const schedule = Array.isArray(data.weekA) ? data.weekA : data.weekA.schedule;
    sanitized.weekA.schedule = sanitizeSchedule(schedule);
  }
  if(data && data.weekB){
    const schedule = Array.isArray(data.weekB) ? data.weekB : data.weekB.schedule;
    sanitized.weekB.schedule = sanitizeSchedule(schedule);
  }
  
  return sanitized;
}

function exportSchedule(){
  const exportData = {
    subjects: timetableData.subjects,
    weekA: timetableData.weekA,
    weekB: timetableData.weekB,
    subjectSettings: timetableData.subjectSettings,
    displayMode: getDisplayMode()
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'stundenplan_export.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importScheduleFromJSON(json){
  try{
    const parsed = JSON.parse(json);
    const sanitized = sanitizeImportedData(parsed);
    timetableData.subjects = sanitized.subjects;
    timetableData.weekA = { schedule: sanitized.weekA.schedule };
    timetableData.weekB = { schedule: sanitized.weekB.schedule };
    timetableData.subjectSettings = sanitized.subjectSettings;
    
    saveTimetableData(timetableData);
    renderSubjectsList();
    renderTimetable('A');
    renderTimetable('B');
    updateHoursDisplay();
    
    // Handle new unified display mode setting
    if(parsed && typeof parsed.displayMode === 'boolean'){
      saveDisplayMode(parsed.displayMode);
      const displayModeSwitch = document.getElementById('displayModeSwitch');
      if(displayModeSwitch){
        displayModeSwitch.checked = parsed.displayMode;
      }
    }
    // Backward compatibility: convert old separate settings to new unified setting
    else if(parsed && (typeof parsed.useRealTimeBlocks === 'boolean' || typeof parsed.showBlocksInsteadOfTime === 'boolean')){
      const useRealTime = parsed.useRealTimeBlocks === true;
      const showBlocks = parsed.showBlocksInsteadOfTime === true;
      // If both were enabled, or just showBlocks was enabled, use block mode
      const displayMode = showBlocks;
      saveDisplayMode(displayMode);
      const displayModeSwitch = document.getElementById('displayModeSwitch');
      if(displayModeSwitch){
        displayModeSwitch.checked = displayMode;
      }
    }
    
    alert('Stundenplan erfolgreich importiert.');
    const textarea = document.getElementById('importScheduleText');
    if(textarea){
      textarea.value = '';
    }
  } catch (err){
    console.error(err);
    alert('Import fehlgeschlagen: Ungültige Datei.');
  }
}

function handleImportScheduleFile(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importScheduleFromJSON(reader.result);
  };
  reader.onerror = () => {
    alert('Datei konnte nicht gelesen werden.');
  };
  reader.readAsText(file);
  // Reset input so same file can be selected again later
  event.target.value = '';
}

function importScheduleFromTextarea(){
  const textarea = document.getElementById('importScheduleText');
  if(!textarea) return;
  const content = textarea.value.trim();
  if(!content){
    alert('Bitte JSON-Text einfügen.');
    return;
  }
  importScheduleFromJSON(content);
}

function formatDuration(totalSeconds, showSeconds = false){
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if(hours > 0){
    parts.push(`${hours}h`);
  }
  if(minutes > 0 || hours > 0){
    parts.push(`${minutes}m`);
  }
  if(showSeconds && (secs > 0 || minutes === 0 && hours === 0)){
    parts.push(`${secs}s`);
  }
  if(parts.length === 0){
    parts.push('0m');
  }
  return parts.join(' ');
}

function formatSchoolHours(totalSeconds){
  const schulstunden = Math.max(0, totalSeconds) / (60 * 60);
  return `${schulstunden.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} Stunden`;
}

function updateHoursDisplay(){
  const referenceDate = getReferenceDate();
  if(!referenceDate){
    document.getElementById('totalHours').textContent = '–';
    document.getElementById('subjectHoursList').innerHTML = '<p class="muted">Bitte zuerst Referenzdatum festlegen</p>';
    return;
  }
  
  const displayMode = getDisplayMode(); // false = time, true = blocks
  const result = calculateRemainingHours(timetableData, referenceDate);

  // Gesamtstunden / Gesamtblöcke
  if(displayMode){
    // Block mode (real-time): use actual durations and show block count
    const totalBlocks = result.totalBlocks || 0;
    document.getElementById('totalHours').textContent = totalBlocks.toFixed(1) + ' Blöcke';
  } else {
    // Time mode: use predefined hours and show time
    const totalSeconds = result.totalSeconds || 0;
    document.getElementById('totalHours').textContent = formatSchoolHours(totalSeconds);
  }
  
  // Stunden pro Fach
  const listEl = document.getElementById('subjectHoursList');
  listEl.innerHTML = '';
  
  const subjectSecondsMap = result.subjectSeconds || {};
  const subjects = Object.keys(subjectSecondsMap).sort();
  
  if(subjects.length === 0){
    listEl.innerHTML = '<p class="muted">Keine Fächer im Stundenplan</p>';
    return;
  }
  
  subjects.forEach(subject => {
    const seconds = subjectSecondsMap[subject];
    const blocks = result.subjectBlocks ? result.subjectBlocks[subject] : 0;

    if(displayMode){
      if(!blocks || blocks <= 0) return; // Überspringe Fächer mit 0 Blöcken
    } else {
      if(!seconds || seconds <= 0) return; // Überspringe Fächer mit 0 Zeit
    }

    const card = document.createElement('div');
    card.className = 'subject-hours-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'subject-hours-name';
    nameEl.textContent = subject;

    const hoursEl = document.createElement('div');
    hoursEl.className = 'subject-hours-value';
    if(displayMode){
      hoursEl.textContent = blocks.toFixed(1) + ' Blöcke';
    } else {
      hoursEl.textContent = formatSchoolHours(seconds);
    }

    card.appendChild(nameEl);
    card.appendChild(hoursEl);
    listEl.appendChild(card);
  });
  
  if(!listEl.hasChildNodes()){
    listEl.innerHTML = '<p class="muted">Keine Fächer mit verbleibender Zeit</p>';
  }
}

let timetableData = loadTimetableData();

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Wochen-Selector
  const weekBtns = document.querySelectorAll('.week-btn');
  weekBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const week = btn.dataset.week;
      currentWeekView = week;
      
      weekBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      document.getElementById('timetableA').classList.toggle('hidden', week !== 'A');
      document.getElementById('timetableB').classList.toggle('hidden', week !== 'B');
    });
  });
  
  // Referenzdatum
  const referenceDateInput = document.getElementById('referenceDate');
  const savedRefDate = getReferenceDate();
  if(savedRefDate){
    referenceDateInput.value = savedRefDate;
  }
  referenceDateInput.addEventListener('change', () => {
    saveReferenceDate(referenceDateInput.value);
    updateHoursDisplay();
  });
  
  // Anzeigemodus Switch (Stunden / Blöcke)
  const displayModeSwitch = document.getElementById('displayModeSwitch');
  if(displayModeSwitch){
    displayModeSwitch.checked = getDisplayMode();
    displayModeSwitch.addEventListener('change', () => {
      saveDisplayMode(displayModeSwitch.checked);
      updateHoursDisplay();
    });
  }
  
  // Fach hinzufügen
  document.getElementById('addSubject').addEventListener('click', () => addSubject());
  
  // Export / Import
  const exportBtn = document.getElementById('exportSchedule');
  exportBtn && exportBtn.addEventListener('click', exportSchedule);

  const importInput = document.getElementById('importScheduleInput');
  importInput && importInput.addEventListener('change', handleImportScheduleFile);
  const importTextBtn = document.getElementById('importScheduleTextBtn');
  importTextBtn && importTextBtn.addEventListener('click', importScheduleFromTextarea);

  // Woche A nach B kopieren
  document.getElementById('copyAtoB').addEventListener('click', () => copyWeekAToB());
  
  // Woche B nach A kopieren
  document.getElementById('copyBtoA').addEventListener('click', () => copyWeekBToA());
  
  // Stundenplan leeren
  document.getElementById('clearA').addEventListener('click', () => clearTimetable('A'));
  document.getElementById('clearB').addEventListener('click', () => clearTimetable('B'));
  
  // Initial rendern
  renderSubjectsList();
  renderTimetable('A');
  renderTimetable('B');
  updateHoursDisplay();
  // Echtzeit-Updates jede Minute (einmalig einrichten)
  if(!realtimeUpdateIntervalId){
    realtimeUpdateIntervalId = setInterval(() => {
      updateHoursDisplay();
    }, 1000);
  }
  
  // Aktualisiere Anzeige wenn sich Daten ändern (z.B. Enddatum auf Hauptseite)
  window.addEventListener('storage', () => {
    timetableData = loadTimetableData();
    renderSubjectsList();
    renderTimetable('A');
    renderTimetable('B');
    updateHoursDisplay();
    if(realTimeBlocksCheckbox){
      realTimeBlocksCheckbox.checked = getUseRealTimeBlocks();
    }
  });
  
  // Aktualisiere beim Fokus (falls Daten auf anderer Seite geändert wurden)
  window.addEventListener('focus', () => {
    timetableData = loadTimetableData();
    renderSubjectsList();
    renderTimetable('A');
    renderTimetable('B');
    updateHoursDisplay();
    if(realTimeBlocksCheckbox){
      realTimeBlocksCheckbox.checked = getUseRealTimeBlocks();
    }
  });
});

