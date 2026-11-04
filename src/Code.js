/**
 * CMCAT Information System - Ultra-High Quality Core Backend
 * Version: 2.0 (Enterprise Grade)
 * Updated: 2026-05-16
 * Focus: High Performance (O(1) Lookups), Bulk Operations, Type Safety, and Deep Data Analytics
 */

// ==========================================
// ⚙️ GLOBAL CONFIGURATION
// ==========================================
const CONFIG = {
  SHEET_ID: '19wLK2Pxn0ZGE4hy-DykS4n6ohN1Cq7ew4JopnUp5y8U',
  CURRENT_TERM: '2_2569',
  TERM_START_DATE: '12/10/2026', // วันเปิดเทอม 2 (dd/MM/ค.ศ.) = 12 ต.ค. 2569
  TIMEZONE: "GMT+7",
  SHEETS: {
    STUDENTS: 'Students',
    TEACHERS: 'Teachers',
    SDQ: 'SDQ_Results',
    SAVINGS_MASTER: 'Savings_Master', // 💰 เพิ่ม Sheet จัดการบัญชีและเป้าหมาย
    SAVINGS_TX: 'Savings_Transactions', // 💰 เพิ่ม Sheet เก็บประวัติการฝาก-ถอน
    BACKDATE: 'Backdate_Requests', // 📅 เพิ่ม Sheet คำขอเช็คชื่อย้อนหลัง
    NO_ASSEMBLY: 'No_Assembly_Days' // 🌧️ วันงดกิจกรรมหน้าเสาธง (แอดมินกรอกเอง: A=วันที่ dd/MM/yyyy, B=เหตุผล)
  },
  // 📅 นโยบายการเช็คชื่อ (ปรับได้ตามที่วิทยาลัยกำหนด)
  ATTENDANCE_POLICY: {
    ON_TIME_CUTOFF: '10:00',      // ก่อนเวลานี้ = "เช็คตอนเช้า" / หลังเวลานี้ = "เช็คหลังเวลา" (ยังบันทึกได้ แต่ถูกนับสถิติ)
    BACKDATE_MAX_DAYS: 7,         // ขอเช็คย้อนหลังได้ไม่เกินกี่วัน
    MIN_ROOMS_FOR_SCHOOL_DAY: 3,  // วันที่มีห้องเช็คชื่อ >= ค่านี้ ถือเป็น "วันที่มีกิจกรรมหน้าเสาธง"
    STATS_START_DATE: '12/10/2026' // ⚖️ เริ่มนับสถิติครูตั้งแต่วันที่ประกาศใช้ระบบ (dd/MM/ค.ศ.) ข้อมูลก่อนหน้านี้แสดงเป็น "ก่อนเริ่มใช้ระบบ" ไม่นำมาคิด
  },
  // บทบาท (คอลัมน์ G ชีต Teachers) ที่มีสิทธิ์อนุมัติคำขอเช็คย้อนหลัง
  APPROVER_ROLES: ['หัวหน้างานครูที่ปรึกษา', 'admin', 'ผู้บริหาร'],
  // บทบาทที่แก้ไขเช็คชื่อย้อนหลังได้โดยตรง (ไม่จำกัดจำนวนวัน ไม่ต้องรออนุมัติ แต่ถูกบันทึกประวัติทุกครั้ง)
  ADMIN_EDIT_ROLES: ['admin', 'ผู้บริหาร']
};

const ATTENDANCE_SHEET_NAME = `Attendance_Logs_${CONFIG.CURRENT_TERM}`;

// ==========================================
// 🚀 WEB APP ENTRY POINTS (CORS Optimized)
// ==========================================
function doGet(e) {
  // 🟢 ตรวจสอบว่าถ้า URL เป็น /?page=library ให้เปิดหน้า library.html ถ้าไม่ใช่ให้เปิด index
  if (e && e.parameter && e.parameter.page === 'library') {
      return HtmlService.createTemplateFromFile('library')
          .evaluate()
          .setTitle('ระบบเข้าใช้ห้องสมุด CMCAT');
  }
  
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('ระบบดูแลผู้เรียน CMCAT')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * API Gateway - ศูนย์กลางจัดการ Request จาก Frontend
 */
function doPost(e) {
  const output = (data) => {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  };
  
  try {
    if (!e.postData || !e.postData.contents) {
      return output({ success: false, message: "No data received (Empty Payload)." });
    }

    const request = JSON.parse(e.postData.contents);
    const action = request.action;
    const payload = request.payload || request;

    // --- ROUTING SYSTEM ---
    switch (action) {
      // 🟢 รวมคำสั่ง Login ไว้ในบรรทัดเดียว ป้องกันการสับสน
      case 'login': 
        return output(handleLogin(payload)); 
      case 'verifyTeacher': 
        return output(handleLogin(payload)); // 🟢 คืนชีพเส้นทางล็อกอิน (รองรับคำสั่งจาก index.html)
      case 'getRoomData': return output(fetchRoomList());
      case 'getStudentsInRoom': return output(fetchStudentsByRoom(payload.roomString));
      case 'saveAttendance': return output(recordAttendance(payload));

      // 📅 ระบบขออนุมัติเช็คชื่อย้อนหลัง + สถิติการทำงานครูที่ปรึกษา
      case 'getAttendancePolicy': return output(getAttendancePolicy());
      case 'submitBackdateRequest': {
        const r = submitBackdateRequest(payload);
        if (!r.success) logSystemEvent('submitBackdateRequest', payload, r.message); // 🩺 บันทึกสาเหตุที่ส่งคำขอไม่สำเร็จ
        return output(r);
      }
      case 'getBackdateRequests': return output(getBackdateRequests(payload));
      case 'reviewBackdateRequest': return output(reviewBackdateRequest(payload));
      case 'cancelBackdateRequest': return output(cancelBackdateRequest(payload));
      case 'getAdvisorPerformanceStats': return output(getAdvisorPerformanceStats());
      case 'adminEditAttendance': return output(adminEditAttendance(payload));
      case 'getMyAttendanceGaps': return output(getMyAttendanceGaps(payload));
      case 'saveSDQData': return output(recordSDQ(payload));
      case 'getSDQDashboard': return output(fetchSDQOverview(payload.roomString));
      case 'getHistory': return output(fetchStudentAttendanceHistory(payload.studentId));
      case 'getStudentDeepData': return output(fetchIndividualDeepSDQ(payload.studentId));
      case 'getRoomCalendar': return output(fetchRoomAttendanceCalendar(payload.roomString));
      case 'saveHomeroomSpeech': return output(saveHomeroomSpeech(payload)); 
      case 'getSpeechLogs': return output(getSpeechLogs()); 
      case 'getRoomHistory': return output(fetchRoomHistory(payload.roomString, payload.term)); // 🟢 คืนชีพโหลดข้อมูลรายห้องของครู
      case 'getExecutiveSummary': return output(getExecutiveSummary(payload)); // 🟢 คืนชีพ Dashboard ของ Admin
      case 'recordLibraryEntry': return output(recordLibraryEntry(payload)); // 🟢 อัปเดตรองรับ payload แบบ Object // 🟢 คืนชีพระบบห้องสมุด
      
      // 🟢 เพิ่ม Routing ระบบยืม-คืนห้องสมุดให้รองรับการเรียกจาก Cloudflare Pages
      case 'getLibraryBorrowLogs': return output(getLibraryBorrowLogs());
      case 'saveBorrowRecord': return output(saveBorrowRecord(payload));
      case 'updateReturnStatus': return output(updateReturnStatus(payload));
      case 'getLibraryStats': return output(getLibraryStats()); // 🟢 API สำหรับ Dashboard ห้องสมุด
      
      // 🎓 เพิ่ม Routing ระบบติดตามผู้สำเร็จการศึกษา (Alumni Tracking)
      case 'getAlumniMaster': return output(fetchAlumniMaster(payload.nationalId)); 
      case 'saveAlumniTracking': return output(recordAlumniTracking(payload));
      case 'getAlumniDashboardData': return output(getAlumniDashboardData(payload)); // 🟢 เพิ่ม API ดึงสถิติ Dashboard
      
      // 📝 เพิ่ม Routing ระบบสอบเสมือนจริง (E-Testing)
      case 'getExamQuestionsForMode': return output(fetchExamQuestionsForMode(payload));
      case 'submitExam': return output(recordExamSubmission(payload));

      // 🎮 เพิ่ม Routing ระบบ Live Game (Kahoot-style)
      case 'hostStartLiveGame': return output(hostStartLiveGame(payload));
      case 'studentJoinLiveGame': return output(studentJoinLiveGame(payload));
      case 'getLiveGameState': return output(getLiveGameState());
      case 'hostUpdateGameControl': return output(hostUpdateGameControl(payload));
      case 'submitLiveAnswer': return output(submitLiveAnswer(payload));
      case 'getLiveGameLeaderboard': return output(getLiveGameLeaderboard(payload.gameId)); // 🟢 เพิ่ม API ดึงตารางคะแนน
      case 'getExamDashboard': return output(getExamDashboard()); // 🟢 เพิ่ม API ดึงรายงานผลสอบ E-Testing
      
      // 💰 เพิ่ม Routing ระบบออมเงิน (Savings Tracker สำหรับ กสศ. และนักศึกษาทั่วไป)
      case 'getSavingsDashboard': return output(getSavingsDashboard(payload));
      case 'saveSavingsTransaction': return output(saveSavingsTransaction(payload));
      case 'getAdvisorSavingsReport': return output(getAdvisorSavingsReport(payload));
      
      default:
        return output({ success: false, message: `Action [${action}] is not implemented.` });
    }
  } catch (error) {
    console.error("Gateway Error: ", error);
    return output({ success: false, message: "Critical Server Error: " + error.message });
  }
}

// ==========================================
// 🛠️ HELPER & DATA SERVICES
// ==========================================

let activeSpreadsheet = null;

/** Singleton Pattern: เปิด Spreadsheet เพียงครั้งเดียวต่อ 1 Execution */
function getActiveSS() {
  if (!activeSpreadsheet) {
    activeSpreadsheet = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  }
  return activeSpreadsheet;
}

function getTargetSheet(name) {
  const ss = getActiveSS();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** ฟังก์ชันจัดรูปแบบห้องเรียนเพื่อการค้นหาที่แม่นยำ */
function normalizeRoom(str) {
  if (!str) return "";
  return String(str).replace(/\s+/g, '').replace(/\./g, '').toUpperCase().trim();
}

/** 1. ดึงรายชื่อห้องทั้งหมด (แบบ Unique) */
function fetchRoomList() {
  const sheet = getTargetSheet(CONFIG.SHEETS.STUDENTS);
  const data = sheet.getDataRange().getValues();
  data.shift(); // Remove header
  
  const rooms = data
    .filter(r => r[3] && r[4] && r[5])
    .map(r => `${r[3]} ${r[4]}/${r[5]}`.trim());
  
  return { success: true, data: [...new Set(rooms)].sort() };
}

/** 2. ดึงรายชื่อเด็กในห้อง (ระบบค้นหาแบบ Normalized) */
function fetchStudentsByRoom(roomString) {
  if (!roomString) return { success: false, message: "Room string is empty." };
  
  const searchKey = normalizeRoom(roomString);
  const data = getTargetSheet(CONFIG.SHEETS.STUDENTS).getDataRange().getValues();
  data.shift();

  const students = data
    .filter(r => normalizeRoom(`${r[3]}${r[4]}/${r[5]}`) === searchKey)
    .map(r => ({ id: String(r[0]).trim(), name: String(r[2]).trim() }))
    // 🟢 เรียงรหัสประจำตัว (Student_ID จากคอลัมน์ A) จากน้อยไปหามาก
    .sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric: true}));

  return { success: true, data: students };
}

/** 3. บันทึกการเช็คชื่อเข้าแถวหน้าเสาธง "วันนี้" (Upsert: ส่งซ้ำวันเดิมจะอัปเดตทับ ไม่เกิดแถวซ้ำ)
 *  📅 ถ้าบันทึกหลังเวลา ON_TIME_CUTOFF จะถูกติดป้าย "บันทึกล่าช้า" (ยังบันทึกได้ตามปกติ แต่ถูกนับในสถิติ)
 *  การเช็คชื่อ "วันก่อนหน้า" ต้องส่งผ่าน submitBackdateRequest และรอหัวหน้างานอนุมัติเท่านั้น */
function recordAttendance(payload) {
  const { records, teacherName } = payload;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return { success: false, message: "Invalid or empty records." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);

    const sheet = ensureAttendanceSheet();
    const now = new Date();
    const dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy");
    const entryType = isAfterCutoff(now) ? ENTRY_TYPE.LATE : ENTRY_TYPE.ON_TIME;

    const result = upsertAttendanceForDate(sheet, dateStr, records, teacherName, {
      entryType: entryType, refId: '', editEntryType: null
    });
    SpreadsheetApp.flush();

    return { success: true, count: result.count, inserted: result.inserted, updated: result.updated, entryType: entryType };
  } catch (error) {
    console.error("recordAttendance Error:", error);
    return { success: false, message: "ระบบกำลังมีผู้ใช้งานจำนวนมาก กรุณากดบันทึกอีกครั้ง" };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 📅 ATTENDANCE HELPERS (ใช้ร่วมกันระหว่างเช็คปกติ และเช็คย้อนหลังที่ได้รับอนุมัติ)
// ==========================================
const ATT_HEADER = ['Timestamp', 'Date_TH', 'Teacher', 'Student_ID', 'Name', 'Status', 'Entry_Type', 'Ref_Request_ID', 'Last_Edited'];
const ATT_COLS = ATT_HEADER.length; // 9 คอลัมน์ (G-I เพิ่มใหม่ ไม่กระทบโค้ดเดิมที่อ่านถึงคอลัมน์ F)
const ENTRY_TYPE = {
  ON_TIME: 'เช็คตอนเช้า',
  LATE: 'เช็คหลังเวลา',
  BACKDATE: 'ย้อนหลัง (อนุมัติ)',
  BACKDATE_EDIT: 'แก้ไขย้อนหลัง (อนุมัติ)'
};
// รองรับป้ายชื่อเดิมที่บันทึกไว้ก่อนเปลี่ยนคำ ('ปกติ' / 'บันทึกล่าช้า')
const LEGACY_ENTRY_TYPE = { 'ปกติ': 'เช็คตอนเช้า', 'บันทึกล่าช้า': 'เช็คหลังเวลา' };
function normEntryType(t) { t = String(t || '').trim(); return LEGACY_ENTRY_TYPE[t] || t; }

const REQ_STATUS = { PENDING: 'รออนุมัติ', APPROVED: 'อนุมัติ', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิก' };
const VALID_ATT_STATUS = ['มา', 'สาย', 'ลา', 'ขาด'];

/** เตรียมชีตเข้าแถว + เติมหัวคอลัมน์ใหม่ (G-I) ให้ชีตเดิมอัตโนมัติ */
function ensureAttendanceSheet() {
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getMaxColumns() < ATT_COLS) sheet.insertColumnsAfter(sheet.getMaxColumns(), ATT_COLS - sheet.getMaxColumns());
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, ATT_COLS).setValues([ATT_HEADER]);
  } else if (!String(sheet.getRange(1, 7).getValue()).trim()) {
    sheet.getRange(1, 7, 1, 3).setValues([ATT_HEADER.slice(6)]);
  }
  sheet.getRange('B:B').setNumberFormat('@'); // คอลัมน์วันที่เป็นข้อความล้วน
  return sheet;
}

/** แปลง "dd/MM/yyyy" (รองรับปี พ.ศ.) เป็นเลขวัน yyyymmdd สำหรับเปรียบเทียบ */
function dateStrToKey(dateStr) {
  const p = String(dateStr || '').trim().split('/');
  if (p.length !== 3) return 0;
  let y = parseInt(p[2], 10);
  if (y > 2500) y -= 543;
  return y * 10000 + parseInt(p[1], 10) * 100 + parseInt(p[0], 10);
}

/** ปรับรูปแบบวันที่ให้เป็น dd/MM/yyyy (ค.ศ.) มาตรฐานเดียวกัน */
function normalizeDateStr(dateStr) {
  const k = dateStrToKey(dateStr);
  if (!k) return '';
  const y = Math.floor(k / 10000), m = Math.floor(k / 100) % 100, d = k % 100;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/** จำนวนวันระหว่าง 2 dateKey (b - a) */
function diffDaysByKey(a, b) {
  const toUTC = k => Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100);
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

function todayKey() {
  return dateStrToKey(Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy"));
}

function isAfterCutoff(dateObj) {
  return Utilities.formatDate(dateObj, CONFIG.TIMEZONE, "HH:mm") > CONFIG.ATTENDANCE_POLICY.ON_TIME_CUTOFF;
}

/** จำแนกประเภทการบันทึกจากเวลาที่บันทึกจริง (ใช้กับข้อมูลเก่าที่ยังไม่มีคอลัมน์ Entry_Type ด้วย) */
function classifyByTimestamp(ts, dateStr) {
  const t = (ts instanceof Date) ? ts : new Date(ts);
  if (!ts || isNaN(t.getTime())) return ENTRY_TYPE.ON_TIME; // ไม่ทราบเวลา → ให้ประโยชน์แก่ครู
  const tsDateStr = Utilities.formatDate(t, CONFIG.TIMEZONE, "dd/MM/yyyy");
  if (tsDateStr === normalizeDateStr(dateStr)) return isAfterCutoff(t) ? ENTRY_TYPE.LATE : ENTRY_TYPE.ON_TIME;
  return dateStrToKey(tsDateStr) > dateStrToKey(dateStr) ? ENTRY_TYPE.BACKDATE : ENTRY_TYPE.ON_TIME;
}

/**
 * Upsert แถวเข้าแถวของวันที่กำหนด
 * - แถวใหม่: Timestamp = ตอนนี้, Entry_Type = opts.entryType
 * - แถวเดิม: เก็บ Timestamp ครั้งแรกไว้ (การแก้ไขไม่ทำให้กลายเป็น "ล่าช้า") แล้วบันทึกเวลาแก้ไขในคอลัมน์ I
 *            ถ้ามี opts.editEntryType (กรณีอนุมัติแก้ไขย้อนหลัง) จะเปลี่ยน Entry_Type ตามนั้น
 */
function upsertAttendanceForDate(sheet, dateStr, records, teacherName, opts) {
  const now = new Date();
  const existingMap = new Map(); // Student_ID -> { row, ts, type, ref }
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const WINDOW = 15000;
    const startRow = Math.max(2, lastRow - WINDOW + 1);
    const n = lastRow - startRow + 1;
    const disp = sheet.getRange(startRow, 1, n, 4).getDisplayValues();
    const raw = sheet.getRange(startRow, 1, n, ATT_COLS).getValues();
    const targetKey = dateStrToKey(dateStr);
    for (let i = n - 1; i >= 0; i--) {
      if (dateStrToKey(disp[i][1]) === targetKey) {
        const key = String(disp[i][3]).trim();
        if (!existingMap.has(key)) {
          existingMap.set(key, { row: startRow + i, ts: raw[i][0], type: String(raw[i][6] || '').trim(), ref: String(raw[i][7] || '').trim() });
        }
      }
    }
  }

  const unique = new Map(); // กัน ID ซ้ำใน payload เดียวกัน (ตัวหลังสุดชนะ)
  records.forEach(r => unique.set(String(r.id).trim(), r));

  const newRows = [];
  let updated = 0;
  unique.forEach((r, id) => {
    const ex = existingMap.get(id);
    if (ex) {
      const keepType = normEntryType(ex.type) || classifyByTimestamp(ex.ts, dateStr);
      const rowData = [
        ex.ts || now, dateStr, teacherName, id, r.name, r.status,
        opts.editEntryType || keepType,
        opts.refId || ex.ref || '',
        now
      ];
      sheet.getRange(ex.row, 1, 1, ATT_COLS).setValues([rowData]);
      updated++;
    } else {
      newRows.push([now, dateStr, teacherName, id, r.name, r.status, opts.entryType, opts.refId || '', '']);
    }
  });

  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, ATT_COLS).setValues(newRows);
  }
  return { count: unique.size, inserted: newRows.length, updated: updated };
}

/** 4. บันทึกผลประเมิน SDQ (Optimized Bulk Insert) */
function recordSDQ(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 

    const data = payload.payload || payload;
    const evaluator = payload.evaluatorName || "Unknown";
    const sheet = getTargetSheet(CONFIG.SHEETS.SDQ);
    
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Evaluator', 'Student_ID', 'Name', 'Total', 'Status', 'Emotional', 'Conduct', 'Hyper', 'Peer', 'Prosocial']);
    }

    const s = data.scores || { emotional:0, conduct:0, hyper:0, peer:0, prosocial:0 };
    const newRow = [[
      new Date(), evaluator, String(data.studentId).trim(), data.studentName,
      data.totalScore, data.status, s.emotional, s.conduct, s.hyper, s.peer, s.prosocial
    ]];
    
    // Bulk Insert แทน appendRow ทำให้สคริปต์รันเร็วขึ้น 3 เท่า
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 11).setValues(newRow);
    SpreadsheetApp.flush();
    
    return { success: true };
  } catch (error) {
    return { success: false, message: "ระบบกำลังมีผู้ใช้งานจำนวนมาก กรุณากดส่งอีกครั้ง" };
  } finally {
    lock.releaseLock();
  }
}

/** 5. ดึงประวัติการเข้าแถวรายบุคคล */
function fetchStudentAttendanceHistory(studentId) {
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() <= 1) return { success: true, data: [] };

  const data = sheet.getDataRange().getDisplayValues();
  const idStr = String(studentId).trim();

  const history = data.slice(1)
    .filter(r => String(r[3]).trim() === idStr)
    .reverse();

  return { success: true, data: history };
}

/** 6. ดึงข้อมูล SDQ ย้อนหลังทั้งหมดของนักเรียนรายคน (Deep Data) */
function fetchIndividualDeepSDQ(studentId) {
  const sheet = getTargetSheet(CONFIG.SHEETS.SDQ);
  if (sheet.getLastRow() <= 1) return { success: true, data: [] };

  const data = sheet.getDataRange().getValues();
  const idStr = String(studentId).trim();

  const results = data.slice(1)
    .filter(r => String(r[2]).trim() === idStr)
    .map(r => ({
      date: r[0],
      evaluator: r[1],
      total: r[4],
      status: r[5],
      scores: { emotional: r[6], conduct: r[7], hyper: r[8], peer: r[9], prosocial: r[10] }
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return { success: true, data: results };
}

/** 7. ดึงภาพรวม SDQ (แยกเด็ก/ครู อัตโนมัติด้วย Map) */
function fetchSDQOverview(roomString) {
  const studentResult = fetchStudentsByRoom(roomString);
  if (!studentResult.success) return studentResult;

  const studentIdSet = new Set(studentResult.data.map(s => s.id));
  const sdqSheet = getTargetSheet(CONFIG.SHEETS.SDQ);
  if (sdqSheet.getLastRow() <= 1) return { success: true, data: [] };

  const sdqData = sdqSheet.getDataRange().getValues();
  const latestMap = new Map();
  
  sdqData.slice(1).forEach(r => {
    const id = String(r[2]).trim();
    if (studentIdSet.has(id)) { // ใช้ O(1) Set Lookup
      const roleKey = r[1] === 'นักเรียนประเมินตนเอง' ? 'student' : 'teacher';
      latestMap.set(`${id}_${roleKey}`, {
        id: id, name: r[3], totalScore: r[4], status: r[5], evaluator: r[1], date: r[0]
      });
    }
  });

  return { success: true, data: Array.from(latestMap.values()) };
}

/** 🛡️ 8.5 ดึงประวัติการเข้าแถวของทั้งห้อง (รองรับเลือกเทอมย้อนหลัง เช่น "1_2569") */
function fetchRoomHistory(roomString, term) {
  const studentResult = fetchStudentsByRoom(roomString);
  if (!studentResult.success) return { success: false, data: [] };

  const studentIdSet = new Set(studentResult.data.map(s => s.id));

  // ตรวจรูปแบบเทอม (เช่น 1_2569) ถ้าไม่ถูกต้องหรือไม่ส่งมา ให้ใช้เทอมปัจจุบัน
  const termKey = /^[12]_\d{4}$/.test(String(term || '')) ? String(term) : CONFIG.CURRENT_TERM;

  // ใช้ getSheetByName เพื่อไม่ให้สร้างชีตเปล่าขึ้นมาเองเมื่อเลือกเทอมที่ไม่มีข้อมูล
  const sheet = getActiveSS().getSheetByName(`Attendance_Logs_${termKey}`);
  if (!sheet || sheet.getLastRow() <= 1) return { success: true, data: [] };

  const data = sheet.getDataRange().getDisplayValues();
  const history = data.slice(1)
    .filter(r => studentIdSet.has(String(r[3]).trim()))
    .reverse();

  return { success: true, data: history };
}

/** 8. 🟢 สรุปข้อมูลการเช็คชื่อทั้งห้อง (Dynamic Calendar Algorithm) */
function fetchRoomAttendanceCalendar(roomString) {
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() <= 1) return { success: true, data: { students: {}, classActiveDays: {} } };

  const data = sheet.getDataRange().getDisplayValues();
  data.shift(); 

  const studentResult = fetchStudentsByRoom(roomString);
  if (!studentResult.success) return studentResult;
  
  const studentIds = studentResult.data.map(s => s.id);
  const studentIdSet = new Set(studentIds);

  const studentStats = {};
  const activeDaysPerMonth = {};

  studentIds.forEach(id => { studentStats[id] = {}; });

  data.forEach(r => {
    const dateStr = r[1]; 
    const sId = String(r[3]).trim();
    const status = String(r[5]).trim();

    if (studentIdSet.has(sId) && dateStr) {
      const parts = dateStr.split('/');
      if(parts.length === 3) {
        const monthKey = `${parts[2]}-${parts[1]}`; // YYYY-MM
        
        if (!activeDaysPerMonth[monthKey]) activeDaysPerMonth[monthKey] = new Set();
        activeDaysPerMonth[monthKey].add(dateStr); 

        if (!studentStats[sId][monthKey]) {
          studentStats[sId][monthKey] = { 'มา': 0, 'สาย': 0, 'ลา': 0, 'ขาด': 0 };
        }
        if (studentStats[sId][monthKey][status] !== undefined) {
          studentStats[sId][monthKey][status]++;
        }
      }
    }
  });

  const finalClassDays = {};
  for (let month in activeDaysPerMonth) {
    finalClassDays[month] = activeDaysPerMonth[month].size;
  }

  return { 
    success: true, 
    data: { students: studentStats, classActiveDays: finalClassDays }
  };
}

// ==========================================
// 🔐 AUTHENTICATION SERVICE (Role-Based Access)
// ==========================================

function handleLogin(payload) {
  const rawID = payload.studentId || payload.username || payload.phone || payload.email;
  const rawPass = payload.password;

  if (!rawID || !rawPass) return { success: false, message: "กรุณากรอกข้อมูลรหัสประจำตัวและรหัสผ่านให้ครบถ้วน" };

  const ss = getActiveSS();
  const inputID = String(rawID).trim();
  const inputPass = String(rawPass).trim();

  // --- 1. ตรวจสอบนักเรียน ---
  const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
  if (sSheet) {
    const sData = sSheet.getDataRange().getValues(); 
    // 🚀 Fast Fail Optimization: เทียบค่าตรงๆ ก่อน ถ้าไม่ตรงให้โดดข้ามทันที (ประหยัดเวลาได้มหาศาล)
    for (let i = 1; i < sData.length; i++) {
        if (sData[i][0] == inputID || String(sData[i][0]).trim() === inputID) {
            if (sData[i][1] == inputPass || String(sData[i][1]).trim() === inputPass) {
                return {
                  success: true, role: 'student',
                  user: { id: String(sData[i][0]).trim(), name: String(sData[i][2]), level: `${sData[i][3]} ${sData[i][4]}/${sData[i][5]}` }
                };
            }
        }
    }
  }

  // --- 2. ตรวจสอบครูและผู้บริหาร ---
  const tSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  if (tSheet) {
    const tData = tSheet.getDataRange().getValues();
    for (let i = 1; i < tData.length; i++) {
        if (tData[i][0] == inputID || String(tData[i][0]).trim() === inputID) {
            if (tData[i][3] == inputPass || String(tData[i][3]).trim() === inputPass) {
                const rawRole = String(tData[i][6] || '').trim();
                let computedRole = 'teacher';
                
                if (rawRole === 'admin' || rawRole === 'ผู้บริหาร') computedRole = 'admin';
                else if (rawRole === 'ครูที่ปรึกษา') computedRole = 'teacher';
                else if (rawRole === 'หัวหน้างานครูที่ปรึกษา') computedRole = 'homeroom_head'; // 📅 ผู้อนุมัติเช็คย้อนหลัง
                else computedRole = rawRole; 

                const myRooms = tData[i][5] ? String(tData[i][5]).split(',').map(r => r.trim()).filter(r => r !== "") : [];

                return {
                  success: true, role: computedRole, 
                  user: { email: String(tData[i][0]).trim(), name: String(tData[i][1]), position: String(tData[i][2]), rooms: myRooms }
                };
            }
        }
    }
  }

  return { success: false, message: "รหัสประจำตัวหรือรหัสผ่านไม่ถูกต้อง" };
}

// ==========================================
// 📊 EXECUTIVE DASHBOARD API (Strategic Level)
// ==========================================

function getExecutiveSummary(payload) {
  try {
    const ss = getActiveSS();
    
    // 0. 🧠 ดึงข้อมูลครูเพื่อจับคู่ว่าใครประจำห้องไหน (ปรับปรุงระบบให้สะสมชื่อครูที่ปรึกษาทุกคนในห้อง)
    const tSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
    const tData = tSheet.getDataRange().getDisplayValues();
    let roomTeacherMap = {};
    tData.slice(1).forEach(r => {
      const teacherName = String(r[1]).trim();
      const rooms = r[5] ? String(r[5]).split(',').map(x => x.trim()) : [];
      rooms.forEach(rm => { 
          if(rm) {
              const searchKey = normalizeRoom(rm);
              // สร้างกล่อง Array มารองรับถ้ายังไม่เคยมีคีย์ห้องนี้มาก่อน
              if (!roomTeacherMap[searchKey]) {
                  roomTeacherMap[searchKey] = [];
              }
              // ป้องกันการบันทึกชื่อครูคนเดิมซ้ำซ้อน
              if (!roomTeacherMap[searchKey].includes(teacherName)) {
                  roomTeacherMap[searchKey].push(teacherName);
              }
          }
      });
    });

    // 1. ดึงนักเรียนและสร้างแผนผังห้องเรียน
    const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    const sData = sSheet.getDataRange().getDisplayValues();
    sData.shift(); 
    
    let totalStudents = sData.length;
    let roomList = new Set();
    let studentRoomMap = {}; 
    let roomDetails = {}; 

    sData.forEach(r => {
      const stuId = String(r[0]).trim();
      const stuName = String(r[2]).trim();
      const roomName = `${r[3]} ${r[4]}/${r[5]}`.trim(); 
      
      if(roomName) {
        roomList.add(roomName);
        if(!roomDetails[roomName]) {
          const roomKey = normalizeRoom(roomName);
          // 🟢 นำรายชื่อครูในกล่องมาเชื่อมกันด้วยการขึ้นบรรทัดใหม่ (<br>)
          const teachersArray = roomTeacherMap[roomKey] || [];
          const teachersStr = teachersArray.length > 0 ? teachersArray.join('<br>') : "ไม่ระบุ";
          
          roomDetails[roomName] = { 
            isCheckedToday: false, 
            teacher: teachersStr, 
            absentTodayList: [],
            stats: { total: {p:0, l:0, lv:0, a:0}, months: {} },
            isInternship: checkIsInternshipRoom(roomName, new Date()) // 🟢 เพิ่มการแนบสถานะห้องฝึกงาน
          };
        }
        if(stuId) studentRoomMap[stuId] = { room: roomName, name: stuName };
      }
    });

    // 2. ดึงประวัติเข้าแถว กวาดข้อมูลรวดเดียวจบ
    const attSheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
    const attData = attSheet.getDataRange().getDisplayValues();
    attData.shift();

    const todayStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy");
    let attStatsToday = { present: 0, late: 0, leave: 0, absent: 0, totalChecked: 0 };
    let checkedRoomsCount = 0;

    // 🟢 ให้ระบบนับห้องฝึกงานว่า "เช็คชื่อแล้ว" อัตโนมัติ เพื่อไม่ให้ยอดห้องส่งรายงานค้างเป็นสีแดง
    Object.keys(roomDetails).forEach(roomName => {
        if (roomDetails[roomName].isInternship) {
            roomDetails[roomName].isCheckedToday = true;
            roomDetails[roomName].checkedByName = "ระบบอัตโนมัติ (ฝึกงาน)";
            checkedRoomsCount++;
        }
    });

    attData.forEach(r => {
      const recordDate = r[1] ? String(r[1]).trim() : "";
      if(!recordDate) return;

      const parts = recordDate.split('/');
      if(parts.length !== 3) return;
      const monthKey = `${parts[2]}-${parts[1]}`; // YYYY-MM

      const teacherName = r[2] ? String(r[2]).trim() : "";
      const stuId = r[3] ? String(r[3]).trim() : "";
      const status = r[5] ? String(r[5]).trim() : "";

      const studentInfo = studentRoomMap[stuId];
      if(studentInfo) {
        const roomName = studentInfo.room;
        const rDetail = roomDetails[roomName];

        // --- เช็คเฉพาะวันนี้ (Daily Action) ---
        if (recordDate === todayStr) {
            if (status === 'มา') attStatsToday.present++;
            else if (status === 'สาย') attStatsToday.late++;
            else if (status === 'ลา') attStatsToday.leave++;
            else if (status === 'ขาด') attStatsToday.absent++;

            attStatsToday.totalChecked++;

            if(!rDetail.isCheckedToday) {
                rDetail.isCheckedToday = true;
                rDetail.checkedByName = teacherName;    // ชื่อครูที่เช็คชื่อวันนี้
                // ไม่เขียนทับ rDetail.teacher (ซึ่งเก็บชื่อครูที่ปรึกษาทั้งหมด)
                checkedRoomsCount++;
            }
            if(status === 'ขาด') rDetail.absentTodayList.push({ id: stuId, name: studentInfo.name });
        }

        // --- สะสมยอดรายเดือนและรายเทอม (Monthly & Term Aggregation) ---
        if(!rDetail.stats.months[monthKey]) rDetail.stats.months[monthKey] = {p:0, l:0, lv:0, a:0};
        
        if(status === 'มา') { rDetail.stats.total.p++; rDetail.stats.months[monthKey].p++; }
        else if(status === 'สาย') { rDetail.stats.total.l++; rDetail.stats.months[monthKey].l++; }
        else if(status === 'ลา') { rDetail.stats.total.lv++; rDetail.stats.months[monthKey].lv++; }
        else if(status === 'ขาด') { rDetail.stats.total.a++; rDetail.stats.months[monthKey].a++; }
      }
    });

    // 🟢 เรียงลำดับรายชื่อเด็กขาดเข้าแถว ตามรหัสประจำตัว จากน้อยไปหามาก ก่อนแปลงกลับเป็นชื่อส่งให้ UI
    Object.values(roomDetails).forEach(rd => {
      rd.absentTodayList.sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric: true}));
      rd.absentTodayList = rd.absentTodayList.map(s => s.name);
    });

    // 3. ดึงผล SDQ แยกกลุ่มอัตโนมัติ
    const sdqSheet = getTargetSheet(CONFIG.SHEETS.SDQ);
    const sdqData = sdqSheet.getDataRange().getDisplayValues();
    sdqData.shift();

    let sdqStats = { normal: 0, risk: 0, problem: 0 };
    let latestSdqMap = {}; 
    
    sdqData.forEach(r => {
      const stuId = r[2] ? String(r[2]).trim() : "";
      if(stuId) {
        latestSdqMap[stuId] = {
          id: stuId, name: String(r[3]).trim(), score: String(r[4]).trim(), status: String(r[5]).trim(),
          room: studentRoomMap[stuId] ? studentRoomMap[stuId].room : "-"
        };
      }
    });

    let sdqRiskList = [], sdqProblemList = [];
    Object.values(latestSdqMap).forEach(s => {
      if (s.status === 'ปกติ') sdqStats.normal++;
      else if (s.status === 'เสี่ยง') { sdqStats.risk++; sdqRiskList.push(s); }
      else if (s.status === 'มีปัญหา') { sdqStats.problem++; sdqProblemList.push(s); }
    });

    return {
      success: true,
      data: {
        todayDate: todayStr, totalStudents: totalStudents, totalRooms: roomList.size,
        checkedRoomsCount: checkedRoomsCount, attendanceToday: attStatsToday, 
        roomDetails: roomDetails, // ข้อมูลสถิติห้องส่งไปฝั่งหน้าจอทั้งหมด
        sdq: sdqStats, sdqLists: { risk: sdqRiskList, problem: sdqProblemList }
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// ==========================================
// 💰 SAVINGS TRACKER SYSTEM (ระบบออมเงิน กสศ. & ทั่วไป)
// ==========================================

/** 💰 28. ดึงข้อมูล Dashboard การออมเงินของนักเรียนรายบุคคล */
function getSavingsDashboard(payload) {
  try {
    const studentId = String(payload.studentId).trim();
    const ss = getActiveSS();
    
    // 1. ดึงข้อมูลนักเรียนเพื่อดูระดับชั้น (ปวช/ปวส)
    const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    const sData = sSheet.getDataRange().getValues();
    const studentInfo = sData.find(r => String(r[0]).trim() === studentId);
    if (!studentInfo) return { success: false, message: "ไม่พบข้อมูลนักศึกษา" };
    const level = String(studentInfo[3]).trim(); // เช่น ปวช. หรือ ปวส.
    
    // 2. ตรวจสอบและดึงข้อมูลจาก Savings_Master
    let masterSheet = getTargetSheet(CONFIG.SHEETS.SAVINGS_MASTER);
    if (masterSheet.getLastRow() === 0) {
      masterSheet.appendRow(['Student_ID', 'Student_Type', 'Monthly_Income', 'Target_Percentage', 'Target_Amount', 'Current_Balance', 'Last_Updated']);
      masterSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#f59e0b');
    }
    
    let masterData = masterSheet.getDataRange().getValues();
    let myMaster = masterData.find(r => String(r[0]).trim() === studentId);
    
    // ถ้าเพิ่งเข้าใช้งานครั้งแรก ยังไม่มีบัญชี (โยนสถานะกลับไปให้ Frontend บังคับตั้งค่า)
    if (!myMaster) {
      return { 
        success: true, 
        isNewUser: true, 
        studentLevel: level,
        data: { currentBalance: 0, transactions: [] }
      };
    }
    
    // 3. ดึงประวัติรายการจาก Savings_Transactions
    let txSheet = getTargetSheet(CONFIG.SHEETS.SAVINGS_TX);
    let txData = [];
    if (txSheet.getLastRow() > 1) {
      const rawTx = txSheet.getDataRange().getDisplayValues();
      txData = rawTx.slice(1).filter(r => String(r[2]).trim() === studentId).map(r => ({
        txId: r[0], timestamp: r[1], type: r[3], amount: parseFloat(r[4].replace(/,/g, '')), note: r[5], evidenceUrl: r[6]
      })).reverse(); // ล่าสุดขึ้นก่อน
    }
    
    // คำนวณยอดฝากเฉพาะเดือนนี้ (เพื่อทำ Progress Bar 50% หรือ 30%)
    let calculatedBalance = 0;
    let currentMonthDeposit = 0;
    const currentMonthStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "MM/yyyy");

    txData.forEach(tx => {
      if (tx.type === 'ฝาก') {
        calculatedBalance += tx.amount;
        if (tx.timestamp.includes(currentMonthStr)) {
           currentMonthDeposit += tx.amount;
        }
      } else if (tx.type === 'ถอน') {
        calculatedBalance -= tx.amount;
      }
    });

    // 🟢 Self-Healing: ซิงค์ยอด Roll-up ล่าสุดลง Master ถ้ามีการเปลี่ยนแปลง
    const masterRowIndex = masterData.findIndex(r => String(r[0]).trim() === studentId) + 1;
    if (parseFloat(myMaster[5] || 0) !== calculatedBalance) {
        masterSheet.getRange(masterRowIndex, 6).setValue(calculatedBalance);
    }
    
    return {
      success: true,
      isNewUser: false,
      studentLevel: level,
      data: {
        studentType: myMaster[1],
        monthlyIncome: myMaster[2],
        targetPercentage: myMaster[3],
        targetAmount: myMaster[4],
        currentBalance: calculatedBalance,
        currentMonthDeposit: currentMonthDeposit,
        transactions: txData
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/** 💰 29. บันทึกรายการฝาก/ถอน และตั้งเป้าหมายบัญชี (Enterprise Write Lock) */
function saveSavingsTransaction(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 🔒 ป้องกัน Race Condition
    const { studentId, studentType, monthlyIncome, type, amount, note, evidenceFile } = payload;
    const ss = getActiveSS();
    
    // --- 1. จัดการรูปภาพสลิป (ใช้ Drive API) ---
    const FOLDER_ID = '167X_522L8uWobMsOlQ2yudVkjzkhNJqg'; // โฟลเดอร์สำหรับเก็บสลิปออมเงิน
    let fileUrl = '';
    if (evidenceFile && evidenceFile.base64 && FOLDER_ID) {
        try {
            const folder = DriveApp.getFolderById(FOLDER_ID);
            const b64Data = evidenceFile.base64.split(',')[1] || evidenceFile.base64; 
            const blob = Utilities.newBlob(Utilities.base64Decode(b64Data), evidenceFile.mimeType, evidenceFile.filename);
            const file = folder.createFile(blob);
            fileUrl = file.getUrl();
            try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
        } catch (e) {
            fileUrl = 'Error Uploading';
        }
    }

    // --- 2. จัดการ Savings_Master (ตั้งค่าเป้าหมาย กสศ. อัตโนมัติ) ---
    let masterSheet = getTargetSheet(CONFIG.SHEETS.SAVINGS_MASTER);
    const masterData = masterSheet.getDataRange().getValues();
    const masterRowIndex = masterData.findIndex(r => String(r[0]).trim() === String(studentId).trim());
    
    let currentBalance = 0;
    
    // ถ้ายังไม่มีบัญชี (สร้างใหม่พร้อม Lock กฎ กสศ.)
    if (masterRowIndex === -1 && monthlyIncome) {
        let targetPercent = 0;
        if (studentType === 'กสศ_ปวช') targetPercent = Math.max(50, parseFloat(payload.targetPercentage) || 0);
        else if (studentType === 'กสศ_ปวส') targetPercent = Math.max(30, parseFloat(payload.targetPercentage) || 0);
        else targetPercent = payload.targetPercentage || 10; // ทั่วไปให้กำหนดเป้าหมายเอง
        
        const targetAmount = (parseFloat(monthlyIncome) * targetPercent) / 100;
        const initBalance = (amount && parseFloat(amount) > 0 && type === 'ฝาก') ? parseFloat(amount) : 0;
        masterSheet.appendRow([ studentId, studentType, monthlyIncome, targetPercent, targetAmount, initBalance, new Date() ]);
    } else if (masterRowIndex > -1) {
        currentBalance = parseFloat(masterData[masterRowIndex][5] || 0);

        // อัปเดตรายรับ/เป้าหมายของบัญชีที่มีอยู่แล้ว (กสศ. ไม่ต่ำกว่า 50% ปวช. / 30% ปวส.)
        if (monthlyIncome) {
            const accType = String(masterData[masterRowIndex][1]);
            let newPct = parseFloat(payload.targetPercentage) || parseFloat(masterData[masterRowIndex][3]) || 10;
            if (accType === 'กสศ_ปวช') newPct = Math.max(newPct, 50);
            else if (accType === 'กสศ_ปวส') newPct = Math.max(newPct, 30);
            const newTarget = (parseFloat(monthlyIncome) * newPct) / 100;
            masterSheet.getRange(masterRowIndex + 1, 3, 1, 3).setValues([[monthlyIncome, newPct, newTarget]]);
        }
    }

    // --- 3. บันทึก Transaction ---
    if (amount && parseFloat(amount) > 0) {
        let txSheet = getTargetSheet(CONFIG.SHEETS.SAVINGS_TX);
        if (txSheet.getLastRow() === 0) {
            txSheet.appendRow(['Transaction_ID', 'Timestamp', 'Student_ID', 'Type', 'Amount', 'Note', 'Evidence_Image']);
            txSheet.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#f59e0b');
        }
        
        const txId = "TX_" + Date.now();
        const txAmount = parseFloat(amount);
        if (type === 'ถอน' && txAmount > currentBalance) {
            return { success: false, message: "ยอดเงินไม่พอสำหรับการถอน" };
        }
        
        txSheet.appendRow([
            txId, Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss"), 
            studentId, type, txAmount, note, fileUrl
        ]);
        
        // อัปเดต Balance รวมลง Master 
        if (masterRowIndex > -1) {
            const newBalance = type === 'ฝาก' ? currentBalance + txAmount : currentBalance - txAmount;
            masterSheet.getRange(masterRowIndex + 1, 6).setValue(newBalance);
            masterSheet.getRange(masterRowIndex + 1, 7).setValue(new Date());
        }
    }
    
    SpreadsheetApp.flush();
    return { success: true, message: "บันทึกข้อมูลเรียบร้อย" };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

/** 💰 31. รายงานติดตามการออมสำหรับครูที่ปรึกษา (Visual Flags - Red/Yellow/Green) */
function getAdvisorSavingsReport(payload) {
  try {
    const roomString = payload.roomString;
    const studentResult = fetchStudentsByRoom(roomString);
    if (!studentResult.success) return studentResult;
    
    const studentIds = studentResult.data.map(s => s.id);
    const studentIdSet = new Set(studentIds); // ใช้ O(1) Lookup
    
    const masterSheet = getTargetSheet(CONFIG.SHEETS.SAVINGS_MASTER);
    if (masterSheet.getLastRow() <= 1) return { success: true, data: [] };
    const masterData = masterSheet.getDataRange().getValues();
    
    const txSheet = getTargetSheet(CONFIG.SHEETS.SAVINGS_TX);
    let txData = [];
    // 🟢 เปลี่ยนเป็น getDisplayValues() เพื่อให้อ่านวันที่และตัวเลขถูกต้อง 100%
    if (txSheet.getLastRow() > 1) txData = txSheet.getDataRange().getDisplayValues();
    
    // หากวดยอดฝากเฉพาะเดือนนี้
    const currentMonthStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "MM/yyyy");
    const currentMonthDeposits = {}; 
    
    if (txData.length > 1) {
        txData.slice(1).forEach(tx => {
            const sId = String(tx[2]).trim();
            const dateStr = String(tx[1]);
            const type = String(tx[3]);
            // 🟢 ป้องกันบั๊กเครื่องหมายจุลภาค (เช่น 3,750) ไม่ให้แปลงเป็นเลขผิดพลาด
            const amount = parseFloat(String(tx[4]).replace(/,/g, '') || 0);
            
            if (studentIdSet.has(sId) && type === 'ฝาก' && dateStr.includes(currentMonthStr)) {
                currentMonthDeposits[sId] = (currentMonthDeposits[sId] || 0) + amount;
            }
        });
    }
    
    const reportData = [];
    masterData.slice(1).forEach(r => {
        const sId = String(r[0]).trim();
        if (studentIdSet.has(sId)) {
            const stuInfo = studentResult.data.find(s => s.id === sId);
            const targetAmount = parseFloat(r[4] || 0);
            const monthDeposit = currentMonthDeposits[sId] || 0;
            
            // 🚥 Logic แถบสีแจ้งเตือนครูที่ปรึกษา
            let statusColor = 'RED'; // สัญญาณเตือน: ยังไม่ออมเลยในเดือนนี้
            if (monthDeposit >= targetAmount && targetAmount > 0) statusColor = 'GREEN'; // ปลอดภัย: ออมถึงเป้า กสศ. แล้ว
            else if (monthDeposit > 0) statusColor = 'YELLOW'; // เฝ้าระวัง: ออมแล้วแต่ยังไม่ถึงเป้า
            
// 🟢 ป้องกัน Error กรณีวันที่ในชีตเป็นรูปแบบพิเศษหรือ Invalid Date
                let lastUpdatedFormatted = '-';
                if (r[6]) {
                    try {
                        const dateObj = new Date(r[6]);
                        if (!isNaN(dateObj.getTime())) {
                            lastUpdatedFormatted = Utilities.formatDate(dateObj, CONFIG.TIMEZONE, "dd/MM/yyyy");
                        } else {
                            lastUpdatedFormatted = String(r[6]);
                        }
                    } catch (e) {
                        lastUpdatedFormatted = String(r[6]);
                    }
                }

                reportData.push({
                    studentId: sId,
                    studentName: stuInfo.name,
                    studentType: r[1],
                    monthlyIncome: r[2],
                    targetPercent: r[3],
                    targetAmount: targetAmount,
                    currentBalance: r[5],
                    currentMonthDeposit: monthDeposit,
                    statusColor: statusColor,
                    lastUpdated: lastUpdatedFormatted
                });
        }
    });
    
    // เรียงตามรหัสนักศึกษา (น้อยไปมาก)
    reportData.sort((a, b) => a.studentId.localeCompare(b.studentId, undefined, {numeric: true}));
    return { success: true, data: reportData };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/** 9. ระบบบันทึกเข้าใช้ห้องสมุด (รองรับ เข้า-ออก) */
function recordLibraryEntry(payload) {
  const ss = getActiveSS();
  const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
  const libSheet = getTargetSheet('Library_Logs');
  
  // 🟢 แยกตัวแปรมารองรับการส่งค่าแบบ Object (มีสถานะ) และแบบ String (แบบเดิม)
  const studentId = payload.studentId ? payload.studentId : payload;
  const status = payload.status ? payload.status : 'เข้าใช้งาน';
  
  // === สร้าง Header ถ้า Sheet ยังไม่มีข้อมูล ===
  if (libSheet.getLastRow() === 0) {
    libSheet.appendRow(['Timestamp', 'Student_ID', 'Name', 'Status']);
  }
  
  // ค้นหาชื่อนักเรียนจากรหัสที่ส่งมา
  const sData = sSheet.getDataRange().getValues();
  const student = sData.find(r => String(r[0]).trim() === String(studentId).trim());
  
  if (!student) {
    return { success: false, message: "ไม่พบรหัสนักศึกษานี้ในระบบ" };
  }
  
  // บันทึก Log ลงชีต
  libSheet.appendRow([new Date(), studentId, student[2], status]);
  return { success: true, name: student[2] };
}

/**
 * 🟢 ฟังก์ชันส่วนกลางสำหรับตรวจสอบว่าห้องเรียนนั้นๆ อยู่ในช่วงฝึกงานหรือไม่ (ลอจิกตามปฏิทิน CMCAT)
 */
function checkIsInternshipRoom(roomName, targetDate) {
  if (!targetDate) targetDate = new Date();
  const time = targetDate.getTime();
  const startOf = (y, m, d) => new Date(y, m - 1, d, 0, 0, 0).getTime();
  const endOf = (y, m, d) => new Date(y, m - 1, d, 23, 59, 59).getTime(); // นับรวมวันสุดท้าย

  // ลบช่องว่างออกทั้งหมด (เช่น "ปวส. 2/1" กับ "ปวส.2/1")
  const room = String(roomName).replace(/\s+/g, '').trim();

  // 1. กลุ่ม ปวช.3 ทุกห้อง (8 มิ.ย. 69 ถึง 21 ส.ค. 69)
  if (room.includes("ปวช.3")) {
    return (time >= startOf(2026, 6, 8) && time <= endOf(2026, 8, 21));
  }

  // 2. กลุ่ม ปวส.2 ที่เริ่มฝึกงานตั้งแต่วันที่ 25 พ.ค. 69
  if (time >= startOf(2026, 5, 25)) {
    if (room.endsWith("ปวส.2/3")) return time <= endOf(2026, 12, 18);
    if (room.endsWith("ปวส.2/5") || room.endsWith("ปวส.2/14")) return time <= endOf(2026, 12, 19);
    if (room.endsWith("ปวส.2/10")) return time <= endOf(2026, 12, 31);
    if (room.endsWith("ปวส.2/8")) return time <= endOf(2027, 1, 31);

    // ปวส.2/1, 2/2, 2/6, 2/7, 2/12, 2/13 (สิ้นสุด 21 ส.ค. 69)
    if (room.endsWith("ปวส.2/1") || room.endsWith("ปวส.2/2") || room.endsWith("ปวส.2/6") ||
        room.endsWith("ปวส.2/7") || room.endsWith("ปวส.2/12") || room.endsWith("ปวส.2/13")) {
      return time <= endOf(2026, 8, 21);
    }
  }

  return false;
}

/**
 * 🟢 10. ระบบบันทึกการพูดหน้าเสาธงของครู (Enterprise Grade Bulk Insert & Lock)
 */
function saveHomeroomSpeech(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // 🟢 ป้องกันครูหลายคนกดเซฟพร้อมกันแล้วข้อมูลเกิดการทับซ้อน
    const ss = getActiveSS();
    let sheet = ss.getSheetByName('Homeroom_Speech_Logs');
    
    if (!sheet) {
      sheet = ss.insertSheet('Homeroom_Speech_Logs');
      sheet.appendRow(['Timestamp', 'วันที่ทำกิจกรรม', 'ชื่อ-นามสกุลครูผู้พูด', 'หัวข้อที่พูด', 'เนื้อหา/รายละเอียดโดยย่อ']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#f1f5f9');
    }
    
    const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss");
    const newRow = [[
      timestamp,
      payload.speechDate,
      payload.teacherName,
      payload.subject,
      payload.details
    ]];
    
    // 🟢 ใช้ Bulk Insert O(1) แทน appendRow เพื่อความเสถียรและรวดเร็ว ตัดปัญหา API Timeout
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 5).setValues(newRow);
    SpreadsheetApp.flush(); 
    
    return { success: true, message: "บันทึกข้อมูลสำเร็จ" };
  } catch (error) {
    return { success: false, message: "ระบบกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}
/**
 * 🟢 11. ระบบดึงข้อมูลรายงานการพูดหน้าเสาธงสำหรับผู้บริหาร (Executive Speech Dashboard)
 */
function getSpeechLogs() {
  try {
    const ss = getActiveSS();
    const sheet = ss.getSheetByName('Homeroom_Speech_Logs');
    
    // ถ้ายังไม่มีชีต หรือไม่มีข้อมูลให้ส่ง Array ว่างกลับไป
    if (!sheet) return { success: true, data: [] };
    
    const data = sheet.getDataRange().getDisplayValues();
    if (data.length <= 1) return { success: true, data: [] };

    // เอาหัวตารางออก
    data.shift();
    
// จัดรูปฟอร์แมตข้อมูลและสลับเอาข้อมูลใหม่ล่าสุดขึ้นก่อน (Reverse)
    const logs = data.map(r => ({
      timestamp: r[0],
      date: r[1],         // วันที่ทำกิจกรรม
      teacherName: r[2],  // ชื่อครู
      subject: r[3],      // หัวข้อ
      details: r[4]       // เนื้อหา
    })).reverse();

    return { success: true, data: logs };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/** 🟢 12. ระบบดึงประวัติการยืม (Library Admin) */
function getLibraryBorrowLogs() {
  try {
    const sheet = getTargetSheet('Library_Borrow_Logs');
    if (sheet.getLastRow() <= 1) return { success: true, data: [] };
    const data = sheet.getDataRange().getDisplayValues();
    data.shift();
    
    const logs = data.map(r => ({
      borrowId: r[0],
      studentId: r[1],
      studentName: r[2],
      bookTitle: r[3],
      borrowDate: r[4],
      dueDate: r[5],
      status: r[6],
      returnDate: r[7] || ''
    })).reverse();
    return { success: true, data: logs };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** 🟢 13. บันทึกการยืมหนังสือใหม่ (Library Admin) */
function saveBorrowRecord(payload) {
  try {
    const ss = getActiveSS();
    const sheet = getTargetSheet('Library_Borrow_Logs');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Borrow_ID', 'Student_ID', 'Student_Name', 'Book_Title', 'Borrow_Date', 'Due_Date', 'Status', 'Return_Date']);
    }
    
    // หาชื่อผู้ยืม
    const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    const sData = sSheet.getDataRange().getValues();
    const student = sData.find(r => String(r[0]).trim() === String(payload.studentId).trim());
    const studentName = student ? student[2] : "ผู้รับบริการทั่วไป (ไม่ระบุชื่อ)";
    
    const borrowId = "B" + Date.now();
    sheet.appendRow([ borrowId, payload.studentId, studentName, payload.bookTitle, payload.borrowDate, payload.dueDate, 'กำลังยืม', '' ]);
    
    return { success: true, studentName: studentName };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** 🟢 14. อัปเดตสถานะรับคืนหนังสือ (Library Admin) */
function updateReturnStatus(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); 
    const borrowId = payload.borrowId || payload;
    const sheet = getTargetSheet('Library_Borrow_Logs');
    const data = sheet.getDataRange().getValues();
    
    // ข้ามแถวที่ 1 ซึ่งเป็น Header (i เริ่มที่ 1)
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === String(borrowId).trim()) {
        const rowIndex = i + 1; // ตำแหน่งแถวใน Google Sheets เริ่มที่ 1
        
        // สร้าง Timestamp เวลาปัจจุบัน
        const returnDate = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss");
        
        // อัปเดตคอลัมน์ G (7) เป็น "คืนแล้ว" และ คอลัมน์ H (8) เป็นเวลาที่คืน
        sheet.getRange(rowIndex, 7).setValue('คืนแล้ว');
        sheet.getRange(rowIndex, 8).setValue(returnDate);
        
        SpreadsheetApp.flush();
        return { success: true, message: "บันทึกการคืนหนังสือเรียบร้อยแล้ว" };
      }
    }
    return { success: false, message: "ไม่พบรหัสการยืมนี้" };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** 🟢 15. ดึงข้อมูลสถิติสำหรับ Dashboard ห้องสมุด (Library Admin) */
function getLibraryStats() {
  try {
    const ss = getActiveSS();
    
    // --- 1. สถิติการเข้าใช้ (Library_Logs) ---
    const logSheet = ss.getSheetByName('Library_Logs');
    let todayVisits = 0;
    let currentlyInLibrary = 0;
    
if (logSheet && logSheet.getLastRow() > 1) {
  const logData = logSheet.getDataRange().getValues();  // 🔧 FIX: เปลี่ยนเป็น getValues()
  logData.shift();
  
  const todayStr = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy");
  const todayRecords = [];
  
  logData.forEach(r => {
     try {
         // 🔧 FIX: ตรวจสอบว่า r[0] เป็น Date object จริง
         if (r[0] instanceof Date) {
             const logDate = Utilities.formatDate(r[0], CONFIG.TIMEZONE, "dd/MM/yyyy");
             if (logDate === todayStr) {
                 todayRecords.push(r);
             }
         }
     } catch(e) {}
  });
      
      // นับผู้เข้าใช้ทั้งหมดของวันนี้
      todayVisits = todayRecords.filter(r => r[3] === 'เข้าใช้งาน').length;
      
// คำนวณผู้ที่กำลังอยู่ในห้องสมุด (เช็คสถานะล่าสุดของนักศึกษาแต่ละคน)
      let latestStatusMap = {};
      todayRecords.forEach(r => {
         if (r[1] && r[3]) {  // 🔧 FIX: เช็คให้แน่ใจว่า r[1] (Student_ID) และ r[3] (Status) มีค่า
           latestStatusMap[r[1]] = r[3];
         }
      });
      currentlyInLibrary = Object.values(latestStatusMap).filter(status => status === 'เข้าใช้งาน').length;
    }

    // --- 2. สถิติการยืมหนังสือ (Library_Borrow_Logs) ---
    const borrowSheet = ss.getSheetByName('Library_Borrow_Logs');
    let activeBorrows = 0;
    let overdueBorrows = 0;
    
    if (borrowSheet && borrowSheet.getLastRow() > 1) {
      const borrowData = borrowSheet.getDataRange().getDisplayValues();
      borrowData.shift();
      
      const now = new Date();
      now.setHours(0,0,0,0); // รีเซ็ตเวลาเป็นเที่ยงคืนเพื่อเทียบวันที่
      
borrowData.forEach(r => {
  if (r[6] === 'กำลังยืม') {
    activeBorrows++;
    const dueStr = r[5];
    if (dueStr) {
       // 🔧 FIX: แปลง dd/MM/yyyy เป็น Date object ให้ถูกต้อง
       const parts = String(dueStr).split('/');
       if (parts.length === 3) {
         const dueDate = new Date(parts[2], parts[1] - 1, parts[0]);
         if (dueDate < now) {
            overdueBorrows++;
         }
       }
    }
  }
});
    }

    return {
      success: true,
      data: {
        todayVisits: todayVisits,
        currentlyInLibrary: currentlyInLibrary,
        activeBorrows: activeBorrows,
        overdueBorrows: overdueBorrows
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// ==========================================
// 🎓 ALUMNI TRACKING SYSTEM (ระบบติดตามผู้สำเร็จการศึกษา)
// ==========================================

/** 🟢 16. ค้นหาข้อมูลนักศึกษาเก่าเพื่อ Auto-fill จากเลขบัตรประชาชน พร้อมเช็คสถานะการตอบ */
function fetchAlumniMaster(nationalId) {
  try {
    const nId = String(nationalId).trim();
    if (!nId) return { success: false, message: "ไม่ได้ส่งเลขบัตรประชาชนมา" };

    const ss = getActiveSS();
    const masterSheet = ss.getSheetByName('Alumni_Master'); 
    if (!masterSheet) return { success: false, message: "ไม่พบฐานข้อมูล Alumni_Master" };

    const masterData = masterSheet.getDataRange().getDisplayValues();
    const students = masterData.filter(r => String(r[1]).trim() === nId);

    if (students.length > 0) {
      // 🟢 เพิ่มการตรวจสอบว่าเด็กคนนี้ (จากเลขบัตร) ตอบคำถามในปีนี้ไปแล้วหรือยัง
      const logSheet = ss.getSheetByName('Alumni_Tracking_Logs');
      const currentYearTH = String(new Date().getFullYear() + 543);
      let alreadySubmitted = false;

      if (logSheet && logSheet.getLastRow() > 1) {
        const logData = logSheet.getDataRange().getDisplayValues();
        // ค้นหาว่ามีเลขบัตรประชาชนคนนี้ ในรอบที่มีปีปัจจุบันอยู่หรือไม่
        // (หมายเหตุ: เราไม่มีคอลัมน์เลขบัตรใน Log เราจึงต้องเทียบ Student_ID ของวุฒิใดวุฒิหนึ่ง)
        const studentIds = students.map(s => String(s[0]).trim()); 
        
        for (let i = 1; i < logData.length; i++) {
          const logSId = String(logData[i][2]).trim(); // คอลัมน์ C: Student_ID
          const logRound = String(logData[i][1]).trim(); // คอลัมน์ B: Tracking_Round
          
          if (studentIds.includes(logSId) && logRound.includes(currentYearTH)) {
            alreadySubmitted = true;
            break;
          }
        }
      }

      // นำข้อมูลทุกรายการมาจัดรูปแบบเตรียมส่งกลับไปให้หน้าเว็บ
      const results = students.map(student => ({
          id: String(student[0]).trim(),
          nationalId: String(student[1]).trim(),
          prefix: String(student[2]).trim(),
          name: String(student[3]).trim(),
          level: String(student[4]).trim(),
          year: String(student[5]).trim(),
          major: String(student[6]).trim() || "ไม่ระบุสาขา",
          advisor: String(student[7]).trim() || "ไม่ระบุ"
      }));
      
      // ส่งสถานะ alreadySubmitted กลับไปด้วย
      return { success: true, data: results, alreadySubmitted: alreadySubmitted }; 
    }
    return { success: false, message: "ไม่พบข้อมูลผู้สำเร็จการศึกษาจากเลขบัตรประชาชนนี้" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/** 🟢 17. บันทึกข้อมูลการติดตามภาวะการมีงานทำ พร้อมอัปโหลดรูปลง Drive */
function recordAlumniTracking(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 
    
    // 📁 ตั้งค่า Folder ID ใน Google Drive ที่จะใช้เก็บรูปหลักฐาน (เอา ID มาใส่ตรงนี้)
    const FOLDER_ID = '1gFaMMrCS6k7YwbRP6jFFVZcvqlEiHnWA'; 
    let fileUrl = '';

    // 🟢 ระบบแปลง Base64 กลับเป็นไฟล์รูปภาพและเซฟลง Drive
    if (payload.evidenceFile && payload.evidenceFile.base64 && FOLDER_ID) {
        try {
            const folder = DriveApp.getFolderById(FOLDER_ID);
            const contentType = payload.evidenceFile.mimeType;
            const b64Data = payload.evidenceFile.base64.split(',')[1] || payload.evidenceFile.base64; 
            
            const blob = Utilities.newBlob(Utilities.base64Decode(b64Data), contentType, payload.evidenceFile.filename);
            const file = folder.createFile(blob);
            
            // ดึง URL มาเก็บไว้ก่อนเลย ป้องกัน Error ตอนตั้งค่าแชร์
            fileUrl = file.getUrl();
            
            try {
                // พยายามตั้งค่าให้คลิกดูรูปได้เลย
                file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            } catch (shareErr) {
                // 🟢 ถ้าวิทยาลัยบล็อกการแชร์สาธารณะ ระบบจะไม่พัง แต่รูปจะดูได้เฉพาะคนที่ใช้อีเมลวิทยาลัย
                console.warn("ไม่สามารถตั้งค่าแชร์แบบสาธารณะได้: ", shareErr);
            }
            
        } catch (fileErr) {
            console.error("Upload Error: ", fileErr);
            // 🟢 เปลี่ยนจากคำว่า 'อัปโหลดรูปไม่สำเร็จ' เป็นการนำ Error จริงๆ มาปริ้นลงชีต จะได้รู้ว่าพังที่อะไร
            fileUrl = 'Error: ' + fileErr.message;
        }
    }

    const ss = getActiveSS();
    const sheetName = 'Alumni_Tracking_Logs';
    let sheet = ss.getSheetByName(sheetName);
    
    // สร้างชีตพร้อม Header หากยังไม่เคยมีชีตนี้ (18 คอลัมน์ที่ออกแบบไว้)
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow([
        'Timestamp', 'Tracking_Round', 'Student_ID', 'Prefix_Name', 'Full_Name', 
        'Phone', 'Line_ID', 'Current_Address', 'Grad_Level', 'Grad_Year', 
        'Major', 'Advisor', 'Current_Status', 'Target_Name', 'Target_Role', 
        'Income_Range', 'Is_Aligned', 'Evidence_Image'
      ]);
      // ตกแต่งหัวตาราง
      sheet.getRange(1, 1, 1, 18).setFontWeight('bold').setBackground('#10b981').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
    
    // 💡 การหารอบการติดตามอัตโนมัติ (เช่น 1_2569) ตามนโยบาย สอศ.
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYearTH = now.getFullYear() + 543;
    let trackingRound = `ไม่ระบุรอบ`;
    
    if (currentMonth <= 6) trackingRound = `รอบที่ 1/${currentYearTH}`; // ก่อน 30 มิ.ย.
    else if (currentMonth <= 9) trackingRound = `รอบที่ 2/${currentYearTH}`; // 1 ก.ค. - 30 ก.ย.
    else trackingRound = `รอบที่ 3/${currentYearTH}`; // 1 ต.ค. - 31 ธ.ค.

    // จัดเตรียมชุดข้อมูล (Array 1 มิติ) ตามโครงสร้าง 18 คอลัมน์
    const newRow = [[
      now,                                  // A: Timestamp
      trackingRound,                        // B: Tracking_Round
      String(payload.studentId).trim(),     // C: Student_ID
      String(payload.prefix || ''),         // D: Prefix_Name
      String(payload.name || ''),           // E: Full_Name
      String(payload.phone || ''),          // F: Phone
      String(payload.lineId || ''),         // G: Line_ID
      String(payload.address || ''),        // H: Current_Address
      String(payload.level || ''),          // I: Grad_Level
      String(payload.year || ''),           // J: Grad_Year
      String(payload.major || ''),          // K: Major
      String(payload.advisor || ''),        // L: Advisor
      String(payload.status || ''),         // M: Current_Status (study, work, freelance, unemployed, other)
      String(payload.targetName || ''),     // N: Target_Name (ชื่อหน่วยงาน/สถานศึกษา)
      String(payload.targetRole || ''),     // O: Target_Role (ตำแหน่ง/คณะ)
      String(payload.income || ''),         // P: Income_Range
      String(payload.isAligned || ''),      // Q: Is_Aligned (ตรงสาขา/ไม่ตรงสาขา)
      String(fileUrl || '')                 // 🟢 R: Evidence_Image (ใส่ลิงก์ Drive ที่เพิ่งอัปโหลดเสร็จ)
    ]];
    
    // 🟢 Bulk Insert O(1) เพื่อประสิทธิภาพสูงสุดและหลีกเลี่ยง API Timeout
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 18).setValues(newRow);
    SpreadsheetApp.flush(); 
    
    return { success: true, message: "บันทึกข้อมูลสำเร็จ" };
  } catch (error) {
    return { success: false, message: "ระบบประมวลผลฐานข้อมูลกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง: " + error.toString() };
  } finally {
    lock.releaseLock();
  }
}

/** 🟢 18. ระบบดึงข้อมูลสถิติและรายงานติดตามภาวะการมีงานทำ สำหรับผู้บริหาร/งานแนะแนว (OVEC Compliant) */
function getAlumniDashboardData(payload) {
  try {
    const ss = getActiveSS();
    
    // 1. ดึงรายชื่อศิษย์เก่า Master
    const masterSheet = ss.getSheetByName('Alumni_Master');
    if (!masterSheet || masterSheet.getLastRow() <= 1) {
      return { success: false, message: "ยังไม่มีข้อมูลในชีต Alumni_Master" };
    }
    const masterData = masterSheet.getDataRange().getDisplayValues();
    masterData.shift(); // เอาหัวตารางออก
    
    const totalMasterCount = masterData.length;
    const masterList = [];
    const majorStats = {}; 
    const levelStats = {}; 

    masterData.forEach(r => {
      const sId = String(r[0]).trim();
      const nId = String(r[1]).trim();
      const prefix = String(r[2]).trim();
      const name = String(r[3]).trim();
      const level = String(r[4]).trim() || "ไม่ระบุระดับ";
      const year = String(r[5]).trim();
      const major = String(r[6]).trim() || "ไม่ระบุสาขา";
      const advisor = String(r[7]).trim() || "ไม่ระบุ";

      masterList.push({ sId, nId, prefix, name, level, year, major, advisor });

      if (!majorStats[major]) {
        majorStats[major] = { total: 0, responded: 0, study: 0, work: 0, freelance: 0, unemployed: 0, other: 0, aligned: 0 };
      }
      majorStats[major].total++;

      if (!levelStats[level]) {
        levelStats[level] = { total: 0, responded: 0, study: 0, work: 0, freelance: 0, unemployed: 0, other: 0 };
      }
      levelStats[level].total++;
    });

    // 2. ดึงประวัติการตอบจาก Alumni_Tracking_Logs
    const logSheet = ss.getSheetByName('Alumni_Tracking_Logs');
    const latestResponseMap = {}; 

    if (logSheet && logSheet.getLastRow() > 1) {
      const logData = logSheet.getDataRange().getDisplayValues();
      logData.shift();

      logData.forEach(r => {
        const round = String(r[1]).trim();
        const sId = String(r[2]).trim();
        const status = String(r[12]).trim(); 
        const targetName = String(r[13]).trim();
        const targetRole = String(r[14]).trim();
        const income = String(r[15]).trim();
        const isAligned = String(r[16]).trim();
        const phone = String(r[5]).trim();
        const address = String(r[7]).trim();

        // เก็บข้อมูลล่าสุดของนักศึกษาแต่ละคน
        latestResponseMap[sId] = {
          round, status, targetName, targetRole, income, isAligned, phone, address, timestamp: r[0]
        };
      });
    }

    // 3. รวมผลสถิติภาพรวม (KPI Aggregation)
    let respondedCount = 0;
    let countStudy = 0, countWork = 0, countFreelance = 0, countUnemployed = 0, countOther = 0;
    let countAligned = 0;
    const incomeDistribution = {
      'ต่ำกว่า 9,000 บาท': 0,
      '9,000 - 12,000 บาท': 0,
      '12,001 - 15,000 บาท': 0,
      '15,001 - 20,000 บาท': 0,
      'มากกว่า 20,000 บาท': 0,
      'ไม่ระบุ/ศึกษาต่อ': 0
    };

    const auditList = masterList.map(m => {
      const resp = latestResponseMap[m.sId];
      const isResponded = !!resp;

      if (isResponded) {
        respondedCount++;
        const st = resp.status;

        if (st === 'ศึกษาต่อ') { countStudy++; majorStats[m.major].study++; levelStats[m.level].study++; }
        else if (st === 'มีงานทำ') { countWork++; majorStats[m.major].work++; levelStats[m.level].work++; }
        else if (st === 'ประกอบอาชีพอิสระ') { countFreelance++; majorStats[m.major].freelance++; levelStats[m.level].freelance++; }
        else if (st.includes('ว่างงาน') || st.includes('รองาน')) { countUnemployed++; majorStats[m.major].unemployed++; levelStats[m.level].unemployed++; }
        else { countOther++; majorStats[m.major].other++; levelStats[m.level].other++; }

        majorStats[m.major].responded++;
        levelStats[m.level].responded++;

        if (resp.isAligned === 'ตรงสาขา') {
          countAligned++;
          majorStats[m.major].aligned++;
        }

        if (resp.income && incomeDistribution[resp.income] !== undefined) {
          incomeDistribution[resp.income]++;
        } else {
          incomeDistribution['ไม่ระบุ/ศึกษาต่อ']++;
        }
      }

      return {
        ...m,
        isResponded,
        response: resp || null
      };
    });

    const trackingRate = totalMasterCount > 0 ? Math.round((respondedCount / totalMasterCount) * 100) : 0;
    const activeEmployed = countWork + countFreelance + countStudy;
    const employmentRate = respondedCount > 0 ? Math.round((activeEmployed / respondedCount) * 100) : 0;
    const alignmentRate = activeEmployed > 0 ? Math.round((countAligned / activeEmployed) * 100) : 0;

    return {
      success: true,
      data: {
        summary: {
          totalMasterCount,
          respondedCount,
          unrespondedCount: totalMasterCount - respondedCount,
          trackingRate,
          employmentRate,
          alignmentRate,
          counts: {
            study: countStudy,
            work: countWork,
            freelance: countFreelance,
            unemployed: countUnemployed,
            other: countOther,
            aligned: countAligned
          }
        },
        incomeDistribution,
        majorStats,
        levelStats,
        auditList
      }
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 🟢 ฟังก์ชันสำหรับบังคับขอสิทธิ์ Google Drive แบบเต็มรูปแบบ (อ่านและสร้างไฟล์)
function authorizeDrive() {
  // คำสั่งล่อ: บังคับให้ระบบต้องขอสิทธิ์ "สร้างไฟล์" (Write Permission)
  const dummyFile = DriveApp.createFile("test_permission.txt", "ขอสิทธิ์สำเร็จ");
  
  // พอได้สิทธิ์และสร้างไฟล์ล่อเสร็จแล้ว ก็สั่งลบทิ้งลงถังขยะทันทีเพื่อไม่ให้รก Drive
  dummyFile.setTrashed(true); 
}

/**
 * 🟢 ฟังก์ชันสร้างชีตเช็คชื่อของเทอมปัจจุบัน (รันด้วยมือ 1 ครั้งตอนเปิดเทอม)
 * ปลอดภัยต่อการรันซ้ำ: ถ้ามีชีตอยู่แล้วจะไม่ทับข้อมูล
 */
function setupNewTermSheet() {
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Date_TH', 'Teacher', 'Student_ID', 'Name', 'Status']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
  }
  sheet.getRange('B:B').setNumberFormat('@');
  Logger.log('พร้อมใช้งานชีต: ' + ATTENDANCE_SHEET_NAME + ' | เปิดเทอม: ' + CONFIG.TERM_START_DATE);
}

// ==========================================
// 📝 E-TESTING & ITEM BANK SYSTEM
// ==========================================

/** 🟢 19. ดึงข้อสอบสำหรับโหมดฝึก (เลือกตามหมวดหมู่) หรือโหมดสอบจริง (ดึงตามสัดส่วน Blueprint) */
function fetchExamQuestionsForMode(payload) {
  try {
    const { mode, category } = payload; // mode: 'PRACTICE' หรือ 'SIMULATION'
    const sheet = getTargetSheet('Exam_Questions');
    if (sheet.getLastRow() <= 1) return { success: true, data: [] };
    
    const data = sheet.getDataRange().getDisplayValues();
    data.shift();

    let filteredQuestions = [];

    if (mode === 'PRACTICE') {
      filteredQuestions = data.filter(r => category === 'ALL' || String(r[1]).trim() === String(category).trim());
      filteredQuestions = shuffleArray(filteredQuestions).slice(0, 30); // สุ่มมาทำ 30 ข้อในโหมดฝึก
    } else if (mode === 'SIMULATION') {
      filteredQuestions = shuffleArray(data).slice(0, 148); // จำลอง 148 ข้อ (ปรับเปลี่ยน logic ได้ตามชอบ)
    } else if (mode === 'LIVE_GAME') {
      filteredQuestions = data.filter(r => category === 'ALL' || String(r[1]).trim() === String(category).trim());
    }

    const questions = filteredQuestions.map((r, index) => ({
      no: index + 1,
      questionId: r[0],
      category: r[1],
      subSkill: r[2],
      questionText: r[3],
      options: { A: r[4], B: r[5], C: r[6], D: r[7] }
      // ⚠️ ไม่ส่ง เฉลย(r[8]) และ คำอธิบาย(r[9]) ไปที่ Client เพื่อความปลอดภัย
    }));

    return { success: true, data: questions, total: questions.length };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/** 🛠️ Helper function สำหรับสุ่มข้อสอบ */
function shuffleArray(array) {
  let currentIndex = array.length, randomIndex;
  while (currentIndex > 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
  return array;
}

/** 🟢 20. ตรวจคำตอบและบันทึกผลสอบ (Server-Side Grading) */
function recordExamSubmission(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const { examId, studentId, mode, category, answers } = payload;
    const ss = getActiveSS();
    
    const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
    const sData = sSheet.getDataRange().getValues();
    const student = sData.find(r => String(r[0]).trim() === String(studentId).trim());
    if (!student) return { success: false, message: "ไม่พบข้อมูลนักศึกษา" };
    
    const studentName = student[2];
    const studentRoom = `${student[3]} ${student[4]}/${student[5]}`;

    const qSheet = ss.getSheetByName('Exam_Questions');
    const qData = qSheet.getDataRange().getValues();
    qData.shift();

    let score = 0;
    let totalQuestions = 0;
    const answerKey = {};

    qData.forEach(r => {
      answerKey[String(r[0]).trim()] = String(r[8]).trim(); // คอลัมน์ I คือเฉลย
    });

    for (let qId in answers) {
      totalQuestions++;
      if (answerKey[qId] && answerKey[qId] === answers[qId]) {
        score++;
      }
    }

    let resSheet = ss.getSheetByName('Exam_Results');
    if (!resSheet) {
      resSheet = ss.insertSheet('Exam_Results');
      resSheet.appendRow(['Timestamp', 'Exam_ID', 'Student_ID', 'Student_Name', 'Room', 'Score_Got', 'Total_Score', 'Percentage', 'Answers_JSON']);
    }

    const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    const timestamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss");
    
    resSheet.appendRow([
      timestamp, examId || mode, studentId, studentName, studentRoom, score, totalQuestions, percentage, JSON.stringify(answers)
    ]);
    SpreadsheetApp.flush();

    return { success: true, score: score, total: totalQuestions, percentage: percentage };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// 🎮 KAHOOT-STYLE LIVE GAME SERVICES
// ==========================================

/** 🟢 21. ครูสร้างห้องและเริ่มเกม (Host Session) */
function hostStartLiveGame(payload) {
  const { category, teacherName } = payload;
  const props = PropertiesService.getScriptProperties();
  const gameId = "GAME_" + Date.now().toString().slice(-6);

  const sheet = getTargetSheet('Exam_Questions');
  const data = sheet.getDataRange().getDisplayValues();
  data.shift();

  const filteredQuestions = data.filter(r => category === 'ALL' || String(r[1]).trim() === String(category).trim());
  const questions = filteredQuestions.map(r => ({
    questionId: r[0],
    questionText: r[3],
    options: { A: r[4], B: r[5], C: r[6], D: r[7] },
    correct: String(r[8]).trim()
  }));

  if (questions.length === 0) return { success: false, message: "ไม่พบข้อสอบในหมวดนี้" };

  props.setProperties({
    'ACTIVE_GAME_ID': gameId,
    'GAME_STATUS': 'WAITING',
    'CURRENT_Q_INDEX': '-1',
    'QUESTIONS_JSON': JSON.stringify(questions),
    'HOST_NAME': teacherName
  });

  return { success: true, gameId: gameId, totalQuestions: questions.length };
}

/** 🟢 22. นักศึกษา Join เข้าห้องเกมสด */
function studentJoinLiveGame(payload) {
  const { studentId, gameId } = payload;
  const props = PropertiesService.getScriptProperties();
  
  if (props.getProperty('ACTIVE_GAME_ID') !== gameId) {
    return { success: false, message: "ไม่พบรหัสห้องเกมนี้ หรือเกมอาจจะจบไปแล้ว" };
  }

  const ss = getActiveSS();
  const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
  const sData = sSheet.getDataRange().getValues();
  const student = sData.find(r => String(r[0]).trim() === String(studentId).trim());

  if (!student) return { success: false, message: "ไม่พบรหัสนักศึกษานี้ในระบบ" };

  return { success: true, studentName: student[2], room: `${student[3]} ${student[4]}/${student[5]}` };
}

/** 🟢 23. ดึงสถานะปัจจุบันสำหรับ Polling */
function getLiveGameState() {
  const props = PropertiesService.getScriptProperties();
  const status = props.getProperty('GAME_STATUS') || 'WAITING';
  const qIndex = parseInt(props.getProperty('CURRENT_Q_INDEX') || '-1');
  const questionsJson = props.getProperty('QUESTIONS_JSON');
  
  let currentQuestion = null;
  if (questionsJson && qIndex >= 0) {
    const questions = JSON.parse(questionsJson);
    if (questions[qIndex]) {
      const q = questions[qIndex];
      currentQuestion = {
        no: qIndex + 1,
        total: questions.length,
        questionText: q.questionText,
        options: q.options
      };
    }
  }

  return { success: true, status: status, questionIndex: qIndex, currentQuestion: currentQuestion };
}

/** 🟢 24. ครูสั่งเปลี่ยนข้อ หรือเปิด Leaderboard */
function hostUpdateGameControl(payload) {
  const { status, nextIndex } = payload;
  const props = PropertiesService.getScriptProperties();
  
  const updates = { 'GAME_STATUS': status };
  if (nextIndex !== undefined) {
    updates['CURRENT_Q_INDEX'] = String(nextIndex);
    updates['Q_START_TIME'] = String(Date.now());
  }
  
  props.setProperties(updates);
  return { success: true };
}

/** 🟢 25. เด็กส่งคำตอบเข้ามาในโหมดสด */
function submitLiveAnswer(payload) {
  const { studentId, studentName, questionIndex, selectedAnswer } = payload;
  const props = PropertiesService.getScriptProperties();
  
  if (props.getProperty('GAME_STATUS') !== 'PLAYING') {
    return { success: false, message: "หมดเวลาตอบสำหรับข้อนี้แล้ว" };
  }

  const answerCache = CacheService.getScriptCache();
  const dupKey = 'ans_' + props.getProperty('ACTIVE_GAME_ID') + '_' + String(studentId).trim() + '_' + questionIndex;
  if (answerCache.get(dupKey)) {
    return { success: false, message: "คุณตอบข้อนี้ไปแล้ว" };
  }
  answerCache.put(dupKey, '1', 3600);

  const questions = JSON.parse(props.getProperty('QUESTIONS_JSON'));
  const currentQ = questions[questionIndex];
  if (!currentQ) return { success: false, message: "ข้อสอบไม่ถูกต้อง" };

  const isCorrect = (String(selectedAnswer).trim().toUpperCase() === currentQ.correct);
  const startTime = parseInt(props.getProperty('Q_START_TIME') || Date.now());
  const elapsedSeconds = (Date.now() - startTime) / 1000;
  
  let points = 0;
  if (isCorrect) {
    const maxTime = 30; // ตั้งเวลาต่อข้อที่ 30 วินาที
    const timeFactor = Math.max(0, (maxTime - elapsedSeconds) / maxTime);
    points = Math.round(500 + (500 * timeFactor));
  }

  const ss = getActiveSS();
  let logSheet = ss.getSheetByName('Live_Game_Logs');
  if (!logSheet) {
    logSheet = ss.insertSheet('Live_Game_Logs');
    logSheet.appendRow(['Game_ID', 'Student_ID', 'Student_Name', 'Question_No', 'Selected_Answer', 'Is_Correct', 'Points_Earned', 'Timestamp']);
  }

  const gameId = props.getProperty('ACTIVE_GAME_ID');
  logSheet.appendRow([gameId, studentId, studentName, questionIndex + 1, selectedAnswer, isCorrect, points, new Date()]);
  SpreadsheetApp.flush();

  return { success: true, isCorrect: isCorrect, pointsEarned: points };
}

/** 🟢 26. ดึงข้อมูลคะแนนรวม 5 อันดับแรกของ Live Game (Leaderboard) */
function getLiveGameLeaderboard(gameId) {
  try {
    const ss = getActiveSS();
    const logSheet = ss.getSheetByName('Live_Game_Logs');
    if (!logSheet || logSheet.getLastRow() <= 1) return { success: true, data: [] };

    const data = logSheet.getDataRange().getDisplayValues();
    data.shift(); // เอาหัวตารางออก

    const scores = {};
    // กวาดข้อมูลและรวมคะแนน
    data.forEach(r => {
      if (String(r[0]).trim() === String(gameId).trim()) {
        const sName = String(r[2]).trim(); // ชื่อนักศึกษา
        const points = parseInt(r[6]) || 0; // คะแนนที่ได้
        if (!scores[sName]) scores[sName] = 0;
        scores[sName] += points;
      }
    });

    // แปลง Object เป็น Array -> เรียงลำดับจากมากไปน้อย -> ตัดมาแค่ Top 5
    const leaderboard = Object.keys(scores)
      .map(name => ({ name: name, score: scores[name] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return { success: true, data: leaderboard };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/** 🟢 27. ดึงข้อมูลรายงานผลสอบ E-Testing สำหรับ Dashboard ครู */
function getExamDashboard() {
  try {
    const ss = getActiveSS();
    const resSheet = ss.getSheetByName('Exam_Results');
    if (!resSheet || resSheet.getLastRow() <= 1) return { success: true, data: [] };

    const data = resSheet.getDataRange().getDisplayValues();
    data.shift(); // เอาหัวตารางออก

    // กรองเอาเฉพาะข้อมูลที่มีคะแนนและจัดรูปแบบ (ดึงข้อมูลล่าสุดขึ้นก่อน)
    const results = data.map(r => ({
      timestamp: r[0],
      examId: r[1],
      studentId: r[2],
      studentName: r[3],
      room: r[4],
      score: parseInt(r[5]) || 0,
      total: parseInt(r[6]) || 0,
      percentage: parseInt(r[7]) || 0
    })).filter(r => r.studentId !== '').reverse();

    return { success: true, data: results };
  } catch (error) {
    return { success: false, message: error.message };
  }
}



// =====================================================================
// 📅 BACKDATE APPROVAL SYSTEM (ระบบขออนุมัติเช็คชื่อย้อนหลัง)
//    ครูส่งคำขอ → หัวหน้างานครูที่ปรึกษาอนุมัติ → ระบบจึงบันทึกลงชีตเข้าแถว
//    ทุกคำขอถูกเก็บไว้ในชีต Backdate_Requests เพื่อใช้ทำสถิติ
// =====================================================================

const BD_HEADER = [
  'Request_ID', 'Created_At', 'Teacher_Name', 'Teacher_Email', 'Room', 'Target_Date', 'Days_Late',
  'Reason', 'Request_Type', 'Total', 'Present', 'Late', 'Leave', 'Absent', 'Records_JSON',
  'Status', 'Reviewer', 'Reviewed_At', 'Review_Note'
];
const BD = {}; BD_HEADER.forEach((h, i) => BD[h] = i); // ชื่อคอลัมน์ → index

/** 🔑 เทียบรหัสผู้ใช้แบบยืดหยุ่น: Google Sheets มักแปลง "0812345678" เป็นตัวเลข 812345678 (เลข 0 นำหน้าหาย)
 *  จึงตัด 0 นำหน้าออกเมื่อเป็นตัวเลขล้วน และไม่สนตัวพิมพ์เล็ก/ใหญ่สำหรับอีเมล */
function idKey(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d+$/.test(s) ? (s.replace(/^0+/, '') || '0') : s.toLowerCase();
}
function sameUser(a, b) { return idKey(a) !== '' && idKey(a) === idKey(b); }

function getBackdateSheet() {
  const sheet = getTargetSheet(CONFIG.SHEETS.BACKDATE);
  sheet.getRange('D:D').setNumberFormat('@'); // เก็บรหัสครูเป็นข้อความ ป้องกันเลข 0 นำหน้าหาย
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, BD_HEADER.length).setValues([BD_HEADER])
      .setFontWeight('bold').setBackground('#f1f5f9');
    sheet.setFrozenRows(1);
    sheet.getRange('F:F').setNumberFormat('@');
  }
  return sheet;
}

/** ค้นหาครูจากอีเมล/รหัสผู้ใช้ (คอลัมน์ A ชีต Teachers) */
function findTeacherByEmail(email) {
  const key = String(email || '').trim();
  if (!key) return null;
  const tSheet = getActiveSS().getSheetByName(CONFIG.SHEETS.TEACHERS);
  if (!tSheet) return null;
  const tData = tSheet.getDataRange().getValues();
  for (let i = 1; i < tData.length; i++) {
    if (String(tData[i][0]).trim() === key) {
      return {
        email: key,
        name: String(tData[i][1]).trim(),
        role: String(tData[i][6] || '').trim(),
        rooms: tData[i][5] ? String(tData[i][5]).split(',').map(r => r.trim()).filter(Boolean) : []
      };
    }
  }
  return null;
}

function formatTs(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? String(v) : Utilities.formatDate(d, CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm");
}

function backdateRowToObj(r, includeRecords) {
  const obj = {
    requestId: String(r[BD.Request_ID]),
    createdAt: formatTs(r[BD.Created_At]),
    teacherName: String(r[BD.Teacher_Name]),
    teacherEmail: String(r[BD.Teacher_Email]),
    room: String(r[BD.Room]),
    targetDate: normalizeDateStr(r[BD.Target_Date]) || String(r[BD.Target_Date]),
    daysLate: Number(r[BD.Days_Late]) || 0,
    reason: String(r[BD.Reason]),
    requestType: String(r[BD.Request_Type]),
    counts: { total: Number(r[BD.Total]) || 0, present: Number(r[BD.Present]) || 0, late: Number(r[BD.Late]) || 0, leave: Number(r[BD.Leave]) || 0, absent: Number(r[BD.Absent]) || 0 },
    status: String(r[BD.Status]),
    reviewer: String(r[BD.Reviewer] || ''),
    reviewedAt: formatTs(r[BD.Reviewed_At]),
    reviewNote: String(r[BD.Review_Note] || '')
  };
  if (includeRecords) {
    try { obj.records = JSON.parse(r[BD.Records_JSON] || '[]'); } catch (e) { obj.records = []; }
  }
  return obj;
}

/** ส่งนโยบายให้หน้าเว็บใช้ (เวลาตัดรอบ / จำนวนวันย้อนหลังสูงสุด) */
function getAttendancePolicy() {
  return {
    success: true,
    data: {
      cutoff: CONFIG.ATTENDANCE_POLICY.ON_TIME_CUTOFF,
      maxDays: CONFIG.ATTENDANCE_POLICY.BACKDATE_MAX_DAYS,
      termStart: normalizeDateStr(CONFIG.TERM_START_DATE),
      today: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy")
    }
  };
}

/** 📝 ครูส่งคำขอเช็คชื่อย้อนหลัง (ยังไม่บันทึกลงชีตเข้าแถวจนกว่าจะอนุมัติ) */
function submitBackdateRequest(payload) {
  const { teacherEmail, roomString, targetDate, reason, records } = payload || {};

  // --- ตรวจข้อมูลพื้นฐาน ---
  if (!teacherEmail || !roomString || !targetDate) return { success: false, message: "ข้อมูลคำขอไม่ครบถ้วน" };
  if (!reason || String(reason).trim().length < 5) return { success: false, message: "กรุณาระบุเหตุผลที่ต้องเช็คย้อนหลัง (อย่างน้อย 5 ตัวอักษร)" };
  if (!Array.isArray(records) || records.length === 0) return { success: false, message: "ไม่พบรายชื่อนักเรียนในคำขอ" };

  const teacher = findTeacherByEmail(teacherEmail);
  if (!teacher) return { success: false, message: "ไม่พบข้อมูลครูผู้ส่งคำขอในระบบ" };
  const isAdmin = ['admin', 'ผู้บริหาร'].includes(teacher.role);
  if (!isAdmin && !teacher.rooms.some(r => normalizeRoom(r) === normalizeRoom(roomString))) {
    return { success: false, message: "ท่านไม่ใช่ครูที่ปรึกษาของห้องนี้" };
  }

  // --- ตรวจวันที่ (รับรูปแบบ yyyy-MM-dd จาก input type=date) ---
  const m = String(targetDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { success: false, message: "รูปแบบวันที่ไม่ถูกต้อง" };
  const dateStr = `${m[3]}/${m[2]}/${m[1]}`;
  const targetKey = dateStrToKey(dateStr);
  const daysLate = diffDaysByKey(targetKey, todayKey());
  const maxDays = CONFIG.ATTENDANCE_POLICY.BACKDATE_MAX_DAYS;

  if (daysLate <= 0) return { success: false, message: "วันนี้หรือวันในอนาคต ให้ใช้การเช็คชื่อปกติ ไม่ต้องขออนุมัติ" };
  if (daysLate > maxDays) return { success: false, message: `ขอเช็คย้อนหลังได้ไม่เกิน ${maxDays} วัน กรุณาติดต่อหัวหน้างานครูที่ปรึกษาโดยตรง` };
  if (targetKey < dateStrToKey(CONFIG.TERM_START_DATE)) return { success: false, message: "วันที่เลือกอยู่ก่อนวันเปิดภาคเรียนปัจจุบัน" };

  const targetDateObj = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0);
  if (checkIsInternshipRoom(roomString, targetDateObj)) return { success: false, message: "ในวันดังกล่าวห้องนี้อยู่ในช่วงฝึกงาน ไม่ต้องเช็คชื่อ" };

  // --- กรองเฉพาะนักเรียนที่อยู่ในห้องจริง และสถานะถูกต้อง ---
  const roster = fetchStudentsByRoom(roomString);
  if (!roster.success) return roster;
  const rosterMap = new Map(roster.data.map(s => [s.id, s.name]));
  const clean = [];
  const seen = new Set();
  records.forEach(r => {
    const id = String(r.id || '').trim();
    const st = String(r.status || '').trim();
    if (rosterMap.has(id) && VALID_ATT_STATUS.includes(st) && !seen.has(id)) {
      seen.add(id);
      clean.push({ id: id, name: rosterMap.get(id), status: st });
    }
  });
  if (clean.length === 0) return { success: false, message: "ไม่มีข้อมูลนักเรียนที่ถูกต้องในคำขอ" };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getBackdateSheet();
    const roomKey = normalizeRoom(roomString);

    // --- ห้ามส่งคำขอซ้ำ (ห้อง+วันเดียวกันที่ยังรออนุมัติ) ---
    if (sheet.getLastRow() > 1) {
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BD_HEADER.length).getDisplayValues();
      const dup = rows.find(r => normalizeRoom(r[BD.Room]) === roomKey && dateStrToKey(r[BD.Target_Date]) === targetKey && r[BD.Status] === REQ_STATUS.PENDING);
      if (dup) return { success: false, message: `มีคำขอของห้องนี้ วันที่ ${dateStr} รออนุมัติอยู่แล้ว (เลขที่ ${dup[BD.Request_ID]})` };
    }

    // --- ตรวจว่าวันนั้นเคยเช็คแล้วหรือยัง (ถ้าเคย = คำขอ "แก้ไขย้อนหลัง") ---
    let alreadyChecked = false;
    const attSheet = getActiveSS().getSheetByName(ATTENDANCE_SHEET_NAME);
    if (attSheet && attSheet.getLastRow() > 1) {
      const lr = attSheet.getLastRow();
      const startRow = Math.max(2, lr - 15000 + 1);
      const vals = attSheet.getRange(startRow, 1, lr - startRow + 1, 4).getDisplayValues();
      alreadyChecked = vals.some(v => dateStrToKey(v[1]) === targetKey && rosterMap.has(String(v[3]).trim()));
    }

    const cnt = { 'มา': 0, 'สาย': 0, 'ลา': 0, 'ขาด': 0 };
    clean.forEach(r => cnt[r.status]++);

    const now = new Date();
    const requestId = 'BD' + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyMMddHHmmss") + Math.floor(Math.random() * 90 + 10);
    const row = new Array(BD_HEADER.length).fill('');
    row[BD.Request_ID] = requestId;
    row[BD.Created_At] = now;
    row[BD.Teacher_Name] = teacher.name;
    row[BD.Teacher_Email] = teacher.email;
    row[BD.Room] = roomString;
    row[BD.Target_Date] = dateStr;
    row[BD.Days_Late] = daysLate;
    row[BD.Reason] = String(reason).trim().substring(0, 500);
    row[BD.Request_Type] = alreadyChecked ? 'แก้ไขย้อนหลัง' : 'เช็คย้อนหลัง';
    row[BD.Total] = clean.length;
    row[BD.Present] = cnt['มา'];
    row[BD.Late] = cnt['สาย'];
    row[BD.Leave] = cnt['ลา'];
    row[BD.Absent] = cnt['ขาด'];
    row[BD.Records_JSON] = JSON.stringify(clean);
    row[BD.Status] = REQ_STATUS.PENDING;

    sheet.getRange(sheet.getLastRow() + 1, 1, 1, BD_HEADER.length).setValues([row]);
    SpreadsheetApp.flush();

    clearGapsCache(teacher.email);
    return { success: true, requestId: requestId, daysLate: daysLate, requestType: row[BD.Request_Type] };
  } catch (error) {
    console.error("submitBackdateRequest Error:", error);
    return { success: false, message: "บันทึกคำขอไม่สำเร็จ: " + error.message };
  } finally {
    lock.releaseLock();
  }
}

/** 📋 ดึงรายการคำขอ (กรองตามสถานะ / อีเมลครู ได้) เรียงใหม่สุดก่อน */
function getBackdateRequests(payload) {
  try {
    const p = payload || {};
    const sheet = getActiveSS().getSheetByName(CONFIG.SHEETS.BACKDATE);
    const policy = getAttendancePolicy().data;
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, data: [], pendingCount: 0, policy: policy };

    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BD_HEADER.length).getValues();
    let pendingCount = 0;
    const list = [];
    rows.forEach(r => {
      if (!r[BD.Request_ID]) return;
      if (String(r[BD.Status]) === REQ_STATUS.PENDING) pendingCount++;
      if (p.status && String(r[BD.Status]) !== p.status) return;
      if (p.teacherEmail && !sameUser(r[BD.Teacher_Email], p.teacherEmail)) return;
      list.push(backdateRowToObj(r, p.includeRecords !== false));
    });
    list.reverse();
    return { success: true, data: list, pendingCount: pendingCount, policy: policy };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

/** ✅ หัวหน้างานครูที่ปรึกษา อนุมัติ / ไม่อนุมัติ คำขอ */
function reviewBackdateRequest(payload) {
  const { requestId, decision, note, reviewerEmail } = payload || {};
  if (!requestId || !['approve', 'reject'].includes(decision)) return { success: false, message: "คำสั่งไม่ถูกต้อง" };

  const reviewer = findTeacherByEmail(reviewerEmail);
  if (!reviewer || !CONFIG.APPROVER_ROLES.includes(reviewer.role)) {
    return { success: false, message: "ท่านไม่มีสิทธิ์อนุมัติคำขอเช็คชื่อย้อนหลัง" };
  }
  if (decision === 'reject' && (!note || String(note).trim().length < 3)) {
    return { success: false, message: "กรุณาระบุเหตุผลที่ไม่อนุมัติ" };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getBackdateSheet();
    if (sheet.getLastRow() <= 1) return { success: false, message: "ไม่พบคำขอ" };
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BD_HEADER.length).getValues();
    const idx = rows.findIndex(r => String(r[BD.Request_ID]) === String(requestId));
    if (idx < 0) return { success: false, message: "ไม่พบคำขอเลขที่นี้" };
    const r = rows[idx];
    const rowNum = idx + 2;

    if (String(r[BD.Status]) !== REQ_STATUS.PENDING) return { success: false, message: `คำขอนี้ถูกดำเนินการไปแล้ว (สถานะ: ${r[BD.Status]})` };
    if (sameUser(r[BD.Teacher_Email], reviewer.email)) return { success: false, message: "ไม่สามารถอนุมัติคำขอของตนเองได้" };

    if (decision === 'approve') {
      let records = [];
      try { records = JSON.parse(r[BD.Records_JSON] || '[]'); } catch (e) { records = []; }
      if (records.length === 0) return { success: false, message: "คำขอนี้ไม่มีข้อมูลนักเรียน" };

      const attSheet = ensureAttendanceSheet();
      const dateStr = normalizeDateStr(r[BD.Target_Date]) || String(r[BD.Target_Date]);
      upsertAttendanceForDate(attSheet, dateStr, records, String(r[BD.Teacher_Name]), {
        entryType: ENTRY_TYPE.BACKDATE,
        editEntryType: ENTRY_TYPE.BACKDATE_EDIT,
        refId: String(r[BD.Request_ID])
      });
    }

    sheet.getRange(rowNum, BD.Status + 1, 1, 4).setValues([[
      decision === 'approve' ? REQ_STATUS.APPROVED : REQ_STATUS.REJECTED,
      reviewer.name,
      new Date(),
      String(note || '').trim().substring(0, 500)
    ]]);
    SpreadsheetApp.flush();
    clearGapsCache(String(r[BD.Teacher_Email]).trim());

    return { success: true, status: decision === 'approve' ? REQ_STATUS.APPROVED : REQ_STATUS.REJECTED };
  } catch (error) {
    console.error("reviewBackdateRequest Error:", error);
    return { success: false, message: "เกิดข้อผิดพลาด: " + error.message };
  } finally {
    lock.releaseLock();
  }
}

/** ↩️ ครูยกเลิกคำขอของตนเอง (เฉพาะที่ยังรออนุมัติ) */
function cancelBackdateRequest(payload) {
  const { requestId, teacherEmail } = payload || {};
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const sheet = getBackdateSheet();
    if (sheet.getLastRow() <= 1) return { success: false, message: "ไม่พบคำขอ" };
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BD_HEADER.length).getValues();
    const idx = rows.findIndex(r => String(r[BD.Request_ID]) === String(requestId));
    if (idx < 0) return { success: false, message: "ไม่พบคำขอ" };
    if (!sameUser(rows[idx][BD.Teacher_Email], teacherEmail)) return { success: false, message: "ยกเลิกได้เฉพาะคำขอของตนเอง" };
    if (String(rows[idx][BD.Status]) !== REQ_STATUS.PENDING) return { success: false, message: "คำขอนี้ถูกดำเนินการไปแล้ว" };
    sheet.getRange(idx + 2, BD.Status + 1, 1, 4).setValues([[REQ_STATUS.CANCELLED, '', new Date(), 'ครูยกเลิกคำขอเอง']]);
    SpreadsheetApp.flush();
    clearGapsCache(teacherEmail);
    return { success: true };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 📊 สถิติการทำงานของครูที่ปรึกษา (ภาคเรียนปัจจุบัน)
 * แต่ละ "ห้อง-วัน" ที่มีกิจกรรมหน้าเสาธง จะถูกจัดเป็น 1 ใน 4 กลุ่ม:
 *   ตรงเวลา (ก่อน ON_TIME_CUTOFF) | ล่าช้าในวันเดียวกัน | ย้อนหลัง (ผ่านการอนุมัติ/ข้อมูลเก่า) | ไม่ได้เช็คเลย
 * รวมกับสถิติคำขอเช็คย้อนหลังของครูแต่ละคน
 */
function getAdvisorPerformanceStats() {
  try {
    const ss = getActiveSS();
    const cutoff = CONFIG.ATTENDANCE_POLICY.ON_TIME_CUTOFF;
    const tKey = todayKey();
    const termStartKey = dateStrToKey(CONFIG.TERM_START_DATE);

    // 1. นักเรียน → ห้อง
    const sData = ss.getSheetByName(CONFIG.SHEETS.STUDENTS).getDataRange().getDisplayValues();
    sData.shift();
    const stuRoom = {};          // Student_ID → roomKey
    const roomDisplay = {};      // roomKey → ชื่อห้องสำหรับแสดงผล
    sData.forEach(r => {
      if (!r[0] || !r[3]) return;
      const name = `${r[3]} ${r[4]}/${r[5]}`.trim();
      const key = normalizeRoom(name);
      stuRoom[String(r[0]).trim()] = key;
      roomDisplay[key] = name;
    });

    // 2. ชีตเข้าแถว → สรุปเป็นราย "ห้อง-วัน"
    const roomDay = {}; // roomKey → { dateKey → { minTs, backdate } }
    const attSheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
    if (attSheet && attSheet.getLastRow() > 1) {
      const n = attSheet.getLastRow() - 1;
      const cols = Math.min(ATT_COLS, attSheet.getLastColumn());
      const disp = attSheet.getRange(2, 1, n, 4).getDisplayValues();
      const raw = attSheet.getRange(2, 1, n, cols).getValues();
      for (let i = 0; i < n; i++) {
        const roomKey = stuRoom[String(disp[i][3]).trim()];
        const dKey = dateStrToKey(disp[i][1]);
        if (!roomKey || !dKey || dKey > tKey) continue;
        if (!roomDay[roomKey]) roomDay[roomKey] = {};
        let cell = roomDay[roomKey][dKey];
        if (!cell) cell = roomDay[roomKey][dKey] = { minTs: null, backdate: false };
        const type = cols >= 7 ? String(raw[i][6] || '').trim() : '';
        if (type === ENTRY_TYPE.BACKDATE) cell.backdate = true;
        const ts = raw[i][0] instanceof Date ? raw[i][0] : new Date(raw[i][0]);
        if (!isNaN(ts.getTime()) && (!cell.minTs || ts < cell.minTs)) cell.minTs = ts;
      }
    }

    // จำแนกประเภทแต่ละห้อง-วัน (คำนวณครั้งเดียวต่อห้อง-วัน เพื่อความเร็ว)
    const dayRoomCount = {}; // dateKey → จำนวนห้องที่เช็คตรงเวลา/ล่าช้าในวันนั้น
    Object.keys(roomDay).forEach(rk => {
      Object.keys(roomDay[rk]).forEach(dk => {
        const c = roomDay[rk][dk];
        const k = parseInt(dk, 10);
        const dStr = normalizeDateStr(`${k % 100}/${Math.floor(k / 100) % 100}/${Math.floor(k / 10000)}`);
        c.cls = c.backdate ? 'backdate' : ({ [ENTRY_TYPE.ON_TIME]: 'ontime', [ENTRY_TYPE.LATE]: 'late', [ENTRY_TYPE.BACKDATE]: 'backdate' })[classifyByTimestamp(c.minTs, dStr)];
        if (c.cls === 'ontime' || c.cls === 'late') dayRoomCount[dk] = (dayRoomCount[dk] || 0) + 1;
      });
    });

    // วันที่มีกิจกรรมหน้าเสาธงจริง = วันที่มีห้องเช็คในวันนั้น >= MIN_ROOMS
    const noAssembly = getNoAssemblyDays();
    const startKey = statsStartKey();
    const schoolDays = Object.keys(dayRoomCount)
      .filter(dk => dayRoomCount[dk] >= CONFIG.ATTENDANCE_POLICY.MIN_ROOMS_FOR_SCHOOL_DAY && parseInt(dk, 10) >= startKey && !noAssembly[dk])
      .map(dk => parseInt(dk, 10)).sort((a, b) => a - b);

    // 3. สถิติรายห้อง
    const roomStats = {};
    const roomStat = (rk) => {
      if (roomStats[rk]) return roomStats[rk];
      const s = { room: roomDisplay[rk] || rk, ontime: 0, late: 0, backdate: 0, missing: 0, expected: 0, missingDates: [] };
      const days = roomDay[rk] || {};
      schoolDays.forEach(dk => {
        const c = days[dk];
        const dObj = new Date(Math.floor(dk / 10000), Math.floor(dk / 100) % 100 - 1, dk % 100, 12);
        if (!c && checkIsInternshipRoom(s.room, dObj)) return; // ช่วงฝึกงานไม่นับ
        if (!c && dk === tKey) return;                          // วันนี้ยังเช็คได้อยู่ ไม่นับว่าขาด
        s.expected++;
        if (!c) { s.missing++; s.missingDates.push(Utilities.formatDate(dObj, CONFIG.TIMEZONE, "dd/MM/yyyy")); }
        else s[c.cls]++;
      });
      return roomStats[rk] = s;
    };

    // 4. สถิติคำขอเช็คย้อนหลังรายครู
    const reqByTeacher = {};
    let adminEdits = 0;
    const bdSheet = ss.getSheetByName(CONFIG.SHEETS.BACKDATE);
    if (bdSheet && bdSheet.getLastRow() > 1) {
      bdSheet.getRange(2, 1, bdSheet.getLastRow() - 1, BD_HEADER.length).getValues().forEach(r => {
        if (!r[BD.Request_ID]) return;
        if (String(r[BD.Request_Type]) === ADMIN_EDIT_TYPE) { adminEdits++; return; } // แอดมินแก้ไขแทน ไม่นับเป็นคำขอของครู
        const key = idKey(r[BD.Teacher_Email]) || String(r[BD.Teacher_Name]).trim();
        const q = reqByTeacher[key] = reqByTeacher[key] || { total: 0, approved: 0, rejected: 0, pending: 0, cancelled: 0, sumDaysLate: 0 };
        q.total++;
        q.sumDaysLate += Number(r[BD.Days_Late]) || 0;
        const st = String(r[BD.Status]);
        if (st === REQ_STATUS.APPROVED) q.approved++;
        else if (st === REQ_STATUS.REJECTED) q.rejected++;
        else if (st === REQ_STATUS.PENDING) q.pending++;
        else if (st === REQ_STATUS.CANCELLED) q.cancelled++;
      });
    }

    // 5. รวมเป็นรายครู
    const tData = ss.getSheetByName(CONFIG.SHEETS.TEACHERS).getDataRange().getDisplayValues();
    const teachers = [];
    tData.slice(1).forEach(r => {
      const email = String(r[0]).trim();
      const name = String(r[1]).trim();
      if (!email || !name) return;
      const roomKeys = (r[5] ? String(r[5]).split(',') : []).map(x => normalizeRoom(x)).filter(Boolean);
      const req = reqByTeacher[idKey(email)] || reqByTeacher[name] || { total: 0, approved: 0, rejected: 0, pending: 0, cancelled: 0, sumDaysLate: 0 };
      if (roomKeys.length === 0 && req.total === 0) return;

      const agg = { ontime: 0, late: 0, backdate: 0, missing: 0, expected: 0 };
      const rooms = roomKeys.map(rk => {
        const s = roomStat(rk);
        ['ontime', 'late', 'backdate', 'missing', 'expected'].forEach(k => agg[k] += s[k]);
        return { room: s.room, ontime: s.ontime, late: s.late, backdate: s.backdate, missing: s.missing, expected: s.expected, missingDates: s.missingDates.slice(-10) };
      });
      const onTimeRate = agg.expected > 0 ? Math.round((agg.ontime / agg.expected) * 100) : null;
      let grade = 'ไม่มีข้อมูล';
      if (onTimeRate !== null) grade = onTimeRate >= 90 ? 'ดีเยี่ยม' : onTimeRate >= 75 ? 'ดี' : onTimeRate >= 60 ? 'พอใช้' : 'ควรพัฒนา';

      teachers.push({
        email: email, name: name, position: String(r[2] || ''), rooms: rooms,
        ...agg, onTimeRate: onTimeRate, grade: grade,
        requests: { total: req.total, approved: req.approved, rejected: req.rejected, pending: req.pending, cancelled: req.cancelled,
                    avgDaysLate: req.total > 0 ? Math.round((req.sumDaysLate / req.total) * 10) / 10 : 0 }
      });
    });

    // 6. ภาพรวม (นับห้องละครั้ง ไม่ซ้ำแม้ครูหลายคนดูแลห้องเดียวกัน)
    const summary = { ontime: 0, late: 0, backdate: 0, missing: 0, expected: 0, schoolDays: schoolDays.length,
                      requests: { total: 0, approved: 0, rejected: 0, pending: 0, cancelled: 0 }, adminEdits: adminEdits };
    Object.values(roomStats).forEach(s => ['ontime', 'late', 'backdate', 'missing', 'expected'].forEach(k => summary[k] += s[k]));
    Object.values(reqByTeacher).forEach(q => ['total', 'approved', 'rejected', 'pending', 'cancelled'].forEach(k => summary.requests[k] += q[k]));

    return { success: true, data: { teachers: teachers, summary: summary, policy: { cutoff: cutoff, maxDays: CONFIG.ATTENDANCE_POLICY.BACKDATE_MAX_DAYS, statsStart: normalizeDateStr(`${startKey % 100}/${Math.floor(startKey / 100) % 100}/${Math.floor(startKey / 10000)}`) }, term: CONFIG.CURRENT_TERM } };
  } catch (error) {
    console.error("getAdvisorPerformanceStats Error:", error);
    return { success: false, message: error.message };
  }
}


// =====================================================================
// ✏️ ADMIN DIRECT EDIT (แอดมินแก้ไขเช็คชื่อย้อนหลังได้ทุกวันในภาคเรียน)
//    - ไม่จำกัด BACKDATE_MAX_DAYS และไม่ต้องรออนุมัติ
//    - ทุกครั้งถูกบันทึกในชีต Backdate_Requests (ประเภท "แอดมินแก้ไข") เพื่อตรวจสอบย้อนหลังได้
//    - สถิติ: ถ้าวันนั้นห้องไม่เคยเช็คเลย → นับเป็น "ย้อนหลัง" ของห้องนั้น
//             ถ้าแก้ข้อมูลที่ครูเช็คไว้แล้ว → คงสถานะเดิมของวันนั้น (ตรงเวลา/ล่าช้า) ไม่ลงโทษครู
// =====================================================================
const ADMIN_EDIT_TYPE = 'แอดมินแก้ไข';

function adminEditAttendance(payload) {
  const { adminEmail, roomString, targetDate, reason, records } = payload || {};
  const admin = findTeacherByEmail(adminEmail);
  if (!admin || !CONFIG.ADMIN_EDIT_ROLES.includes(admin.role)) return { success: false, message: "เฉพาะแอดมิน/ผู้บริหารเท่านั้นที่แก้ไขได้" };
  if (!roomString || !targetDate) return { success: false, message: "กรุณาเลือกห้องและวันที่" };
  if (!reason || String(reason).trim().length < 5) return { success: false, message: "กรุณาระบุเหตุผลการแก้ไข (อย่างน้อย 5 ตัวอักษร)" };
  if (!Array.isArray(records) || records.length === 0) return { success: false, message: "ไม่พบรายชื่อนักเรียน" };

  const m = String(targetDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { success: false, message: "รูปแบบวันที่ไม่ถูกต้อง" };
  const dateStr = `${m[3]}/${m[2]}/${m[1]}`;
  const targetKey = dateStrToKey(dateStr);
  const daysLate = diffDaysByKey(targetKey, todayKey());
  if (daysLate <= 0) return { success: false, message: "วันนี้/อนาคต ให้แก้ไขผ่านหน้าเช็คชื่อปกติ" };
  if (targetKey < dateStrToKey(CONFIG.TERM_START_DATE)) return { success: false, message: "แก้ไขได้เฉพาะวันที่อยู่ในภาคเรียนปัจจุบัน" };

  const roster = fetchStudentsByRoom(roomString);
  if (!roster.success || roster.data.length === 0) return { success: false, message: "ไม่พบนักเรียนในห้องนี้" };
  const rosterMap = new Map(roster.data.map(s => [s.id, s.name]));
  const clean = [], seen = new Set();
  records.forEach(r => {
    const id = String(r.id || '').trim(), st = String(r.status || '').trim();
    if (rosterMap.has(id) && VALID_ATT_STATUS.includes(st) && !seen.has(id)) { seen.add(id); clean.push({ id: id, name: rosterMap.get(id), status: st }); }
  });
  if (clean.length === 0) return { success: false, message: "ไม่มีข้อมูลนักเรียนที่ถูกต้อง" };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const bdSheet = getBackdateSheet();
    const roomKey = normalizeRoom(roomString);
    if (bdSheet.getLastRow() > 1) {
      const rows = bdSheet.getRange(2, 1, bdSheet.getLastRow() - 1, BD_HEADER.length).getDisplayValues();
      const dup = rows.find(r => normalizeRoom(r[BD.Room]) === roomKey && dateStrToKey(r[BD.Target_Date]) === targetKey && r[BD.Status] === REQ_STATUS.PENDING);
      if (dup) return { success: false, message: `มีคำขอของครูสำหรับห้อง/วันนี้รออนุมัติอยู่ (เลขที่ ${dup[BD.Request_ID]}) กรุณาพิจารณาคำขอนั้นก่อน` };
    }

    // ผู้บันทึกในชีตเข้าแถว: ใช้ชื่อครูเดิมของวันนั้น (ถ้ามี) ไม่เช่นนั้นใช้ชื่อแอดมิน
    const attSheet = ensureAttendanceSheet();
    let originalTeacher = '';
    const lr = attSheet.getLastRow();
    if (lr > 1) {
      const startRow = Math.max(2, lr - 15000 + 1);
      const vals = attSheet.getRange(startRow, 1, lr - startRow + 1, 4).getDisplayValues();
      const hit = vals.find(v => dateStrToKey(v[1]) === targetKey && rosterMap.has(String(v[3]).trim()));
      if (hit) originalTeacher = String(hit[2]).trim();
    }

    const now = new Date();
    const requestId = 'AE' + Utilities.formatDate(now, CONFIG.TIMEZONE, "yyMMddHHmmss") + Math.floor(Math.random() * 90 + 10);
    upsertAttendanceForDate(attSheet, dateStr, clean, originalTeacher || `${admin.name} (แอดมิน)`, {
      entryType: ENTRY_TYPE.BACKDATE,   // วันที่ไม่เคยเช็ค → นับเป็นย้อนหลัง
      editEntryType: null,              // วันที่ครูเช็คแล้ว → คงประเภทเดิม
      refId: requestId
    });

    const cnt = { 'มา': 0, 'สาย': 0, 'ลา': 0, 'ขาด': 0 };
    clean.forEach(r => cnt[r.status]++);
    const row = new Array(BD_HEADER.length).fill('');
    row[BD.Request_ID] = requestId; row[BD.Created_At] = now;
    row[BD.Teacher_Name] = admin.name; row[BD.Teacher_Email] = admin.email;
    row[BD.Room] = roomString; row[BD.Target_Date] = dateStr; row[BD.Days_Late] = daysLate;
    row[BD.Reason] = String(reason).trim().substring(0, 500);
    row[BD.Request_Type] = ADMIN_EDIT_TYPE;
    row[BD.Total] = clean.length; row[BD.Present] = cnt['มา']; row[BD.Late] = cnt['สาย']; row[BD.Leave] = cnt['ลา']; row[BD.Absent] = cnt['ขาด'];
    row[BD.Records_JSON] = JSON.stringify(clean);
    row[BD.Status] = REQ_STATUS.APPROVED; row[BD.Reviewer] = admin.name; row[BD.Reviewed_At] = now;
    row[BD.Review_Note] = originalTeacher ? `แก้ไขข้อมูลเดิมของ ${originalTeacher}` : 'บันทึกแทน (วันนั้นไม่มีข้อมูล)';
    bdSheet.getRange(bdSheet.getLastRow() + 1, 1, 1, BD_HEADER.length).setValues([row]);
    SpreadsheetApp.flush();

    return { success: true, requestId: requestId, wasExisting: !!originalTeacher, count: clean.length };
  } catch (error) {
    console.error("adminEditAttendance Error:", error);
    return { success: false, message: "เกิดข้อผิดพลาด: " + error.message };
  } finally {
    lock.releaseLock();
  }
}


// =====================================================================
// 🔔 แจ้งเตือนครู: วันที่ "ไม่ได้เช็คชื่อ" ของห้องตัวเอง (ใช้ในหน้า teacher.html)
//    ผลลัพธ์เก็บใน Cache 10 นาทีต่อครู เพื่อไม่ให้สแกนชีตซ้ำทุกครั้งที่เปิดหน้า (ช่วงเช้าคนใช้เยอะ)
//    Cache ถูกล้างอัตโนมัติเมื่อครูส่ง/ยกเลิกคำขอ หรือหัวหน้างานพิจารณาคำขอ
// =====================================================================
const GAPS_CACHE_SECONDS = 600;

/** 🌧️ วันงดกิจกรรมหน้าเสาธง → Map(dateKey → เหตุผล) (สร้างชีตพร้อมหัวตารางให้อัตโนมัติถ้ายังไม่มี) */
function getNoAssemblyDays() {
  const map = {};
  const ss = getActiveSS();
  let sheet = ss.getSheetByName(CONFIG.SHEETS.NO_ASSEMBLY);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEETS.NO_ASSEMBLY);
    sheet.getRange(1, 1, 1, 2).setValues([['วันที่ (dd/MM/yyyy ค.ศ.)', 'เหตุผล เช่น ฝนตก / กิจกรรมวิทยาลัย / วันหยุด']]).setFontWeight('bold').setBackground('#f1f5f9');
    sheet.getRange('A:A').setNumberFormat('@');
    return map;
  }
  if (sheet.getLastRow() <= 1) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues().forEach(r => {
    const k = dateStrToKey(r[0]);
    if (k) map[k] = String(r[1] || 'งดกิจกรรมหน้าเสาธง').trim();
  });
  return map;
}

/** วันแรกที่นับสถิติ = ค่าที่มากกว่าระหว่างวันเปิดเทอม กับ STATS_START_DATE */
function statsStartKey() {
  return Math.max(dateStrToKey(CONFIG.TERM_START_DATE), dateStrToKey(CONFIG.ATTENDANCE_POLICY.STATS_START_DATE || CONFIG.TERM_START_DATE));
}

function clearGapsCache(email) {
  try { if (email) CacheService.getScriptCache().remove('gaps_' + idKey(email)); } catch (e) {}
}

function getMyAttendanceGaps(payload) {
  try {
    const teacher = findTeacherByEmail((payload || {}).teacherEmail);
    if (!teacher) return { success: false, message: "ไม่พบข้อมูลครู" };

    const cache = CacheService.getScriptCache();
    const cacheKey = 'gaps_' + idKey(teacher.email);
    if (!payload.fresh) {
      const hit = cache.get(cacheKey);
      if (hit) return JSON.parse(hit);
    }

    const ss = getActiveSS();
    const tKey = todayKey();
    const termStartKey = dateStrToKey(CONFIG.TERM_START_DATE);
    const maxDays = CONFIG.ATTENDANCE_POLICY.BACKDATE_MAX_DAYS;
    const myRoomKeys = new Set(teacher.rooms.map(r => normalizeRoom(r)));

    // 1. นักเรียน → ห้อง (ต้องใช้ทุกห้องเพื่อหา "วันที่มีกิจกรรมหน้าเสาธง")
    const sData = ss.getSheetByName(CONFIG.SHEETS.STUDENTS).getDataRange().getDisplayValues();
    sData.shift();
    const stuRoom = {}, roomDisplay = {};
    sData.forEach(r => {
      if (!r[0] || !r[3]) return;
      const name = `${r[3]} ${r[4]}/${r[5]}`.trim();
      const key = normalizeRoom(name);
      stuRoom[String(r[0]).trim()] = key;
      roomDisplay[key] = name;
    });

    // 2. สแกนชีตเข้าแถวครั้งเดียว: นับห้องต่อวัน + เก็บวันที่ของห้องตัวเอง
    const dayRooms = {};   // dateKey → Set(roomKey)
    const mine = {};       // roomKey → { dateKey → { minTs, types:Set } }
    myRoomKeys.forEach(k => mine[k] = {});
    const attSheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME);
    if (attSheet && attSheet.getLastRow() > 1) {
      const n = attSheet.getLastRow() - 1;
      const cols = Math.min(7, attSheet.getLastColumn());
      const vals = attSheet.getRange(2, 1, n, cols).getDisplayValues();
      const raw = attSheet.getRange(2, 1, n, 1).getValues(); // Timestamp จริง (Date) สำหรับเวลาที่บันทึก
      vals.forEach((v, i) => {
        const rk = stuRoom[String(v[3]).trim()];
        const dk = dateStrToKey(v[1]);
        if (!rk || !dk || dk > tKey) return;
        (dayRooms[dk] = dayRooms[dk] || new Set()).add(rk);
        if (mine[rk]) {
          const cell = mine[rk][dk] = mine[rk][dk] || { minTs: null, types: new Set() };
          if (cols >= 7 && v[6]) cell.types.add(normEntryType(v[6]));
          const ts = raw[i][0] instanceof Date ? raw[i][0] : new Date(raw[i][0]);
          if (!isNaN(ts.getTime()) && (!cell.minTs || ts < cell.minTs)) cell.minTs = ts;
        }
      });
    }
    const noAssembly = getNoAssemblyDays();
    const startKey = statsStartKey();
    // วันที่จะแสดงในปฏิทิน = วันที่มีห้องเช็ค >= MIN_ROOMS หรือวันงดกิจกรรม (ตั้งแต่เปิดเทอม)
    const calKeys = new Set(Object.keys(dayRooms).map(Number)
      .filter(dk => dk >= termStartKey && dayRooms[dk].size >= CONFIG.ATTENDANCE_POLICY.MIN_ROOMS_FOR_SCHOOL_DAY));
    Object.keys(noAssembly).map(Number).forEach(dk => { if (dk >= termStartKey && dk <= tKey) calKeys.add(dk); });
    const schoolDays = Array.from(calKeys).sort((a, b) => a - b);

    // 3. คำขอของครูคนนี้ (สถานะล่าสุดต่อ ห้อง+วัน)
    const reqMap = {};
    const bdSheet = ss.getSheetByName(CONFIG.SHEETS.BACKDATE);
    if (bdSheet && bdSheet.getLastRow() > 1) {
      bdSheet.getRange(2, 1, bdSheet.getLastRow() - 1, BD_HEADER.length).getDisplayValues().forEach(r => {
        if (!sameUser(r[BD.Teacher_Email], teacher.email)) return;
        reqMap[normalizeRoom(r[BD.Room]) + '|' + dateStrToKey(r[BD.Target_Date])] = r[BD.Status];
      });
    }

    // 4. สรุปรายห้อง
    const keyToStr = dk => `${String(dk % 100).padStart(2, '0')}/${String(Math.floor(dk / 100) % 100).padStart(2, '0')}/${Math.floor(dk / 10000)}`;
    const keyToIso = dk => `${Math.floor(dk / 10000)}-${String(Math.floor(dk / 100) % 100).padStart(2, '0')}-${String(dk % 100).padStart(2, '0')}`;
    const rooms = [];
    let totalMissing = 0, totalRequestable = 0;
    myRoomKeys.forEach(rk => {
      const display = roomDisplay[rk] || rk;
      const m = mine[rk];
      const counts = { ontime: 0, late: 0, backdate: 0, missing: 0 };
      const days = [];    // ทุกวันที่มีกิจกรรมหน้าเสาธง (รวมวันนี้ถ้าเช็คแล้ว)
      const missing = [];
      schoolDays.forEach(dk => {
        const c = m[dk];
        const dObj = new Date(Math.floor(dk / 10000), Math.floor(dk / 100) % 100 - 1, dk % 100, 12);
        if (!c && checkIsInternshipRoom(display, dObj)) return;
        const day = { date: keyToStr(dk), iso: keyToIso(dk), daysAgo: diffDaysByKey(dk, tKey) };
        if (c && c.minTs) day.savedAt = Utilities.formatDate(c.minTs, CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm");
        // ไม่นับในสถิติ: วันงดกิจกรรม / ก่อนเริ่มใช้ระบบ
        if (noAssembly[dk]) { day.status = 'noassembly'; day.note = noAssembly[dk]; days.push(day); return; }
        if (dk < startKey) { day.status = 'prestart'; day.checked = !!c; days.push(day); return; }
        if (!c && dk >= tKey) return; // วันนี้ยังเช็คได้ตามปกติ ไม่นับว่าขาด
        if (c) {
          // จัดประเภท: ป้ายจากคอลัมน์ Entry_Type ก่อน ไม่มีป้าย (ข้อมูลเก่า) ใช้เวลาที่บันทึกครั้งแรก
          let type;
          if (c.types.has(ENTRY_TYPE.BACKDATE)) type = ENTRY_TYPE.BACKDATE;
          else if (c.types.has(ENTRY_TYPE.LATE)) type = ENTRY_TYPE.LATE;
          else if (c.types.has(ENTRY_TYPE.ON_TIME)) type = ENTRY_TYPE.ON_TIME;
          else type = classifyByTimestamp(c.minTs, day.date);
          day.status = type === ENTRY_TYPE.BACKDATE ? 'backdate' : type === ENTRY_TYPE.LATE ? 'late' : 'ontime';
        } else {
          day.status = 'missing';
          day.requestStatus = reqMap[rk + '|' + dk] || '';
          day.requestable = day.daysAgo <= maxDays && day.requestStatus !== REQ_STATUS.PENDING;
          if (day.requestable) totalRequestable++;
          missing.push(day);
        }
        counts[day.status]++;
        days.push(day);
      });
      const counted = days.filter(d => counts[d.status] !== undefined);
      const expected = counted.length;
      totalMissing += missing.length;
      // 🔥 สถิติต่อเนื่อง: วันที่เช็คตรงเวลาติดต่อกัน (นับจากล่าสุดย้อนกลับ) และสถิติสูงสุด
      let streak = 0, best = 0, run = 0;
      counted.forEach(d => { run = d.status === 'ontime' ? run + 1 : 0; best = Math.max(best, run); });
      for (let i = counted.length - 1; i >= 0 && counted[i].status === 'ontime'; i--) streak++;
      rooms.push({
        room: display, expected: expected, checked: expected - counts.missing,
        onTime: counts.ontime, late: counts.late, backdate: counts.backdate,
        onTimeRate: expected > 0 ? Math.round(counts.ontime / expected * 100) : null,
        streak: streak, bestStreak: best,
        today: (() => { const t = days.find(d => d.daysAgo === 0); return t ? { status: t.status, savedAt: t.savedAt || '', note: t.note || '' } : null; })(),
        days: days,                 // เรียงเก่า → ใหม่ (ใช้วาดปฏิทิน)
        missing: missing.reverse()  // ล่าสุดก่อน
      });
    });

    const result = { success: true, data: { rooms: rooms, totalMissing: totalMissing, totalRequestable: totalRequestable,
      policy: { cutoff: CONFIG.ATTENDANCE_POLICY.ON_TIME_CUTOFF, maxDays: maxDays, statsStart: keyToStr(startKey) },
      todayNoAssembly: noAssembly[tKey] || '',
      generatedAt: Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm") } };
    try { cache.put(cacheKey, JSON.stringify(result), GAPS_CACHE_SECONDS); } catch (e) {}
    return result;
  } catch (error) {
    console.error("getMyAttendanceGaps Error:", error);
    return { success: false, message: error.message };
  }
}


// =====================================================================
// 🩺 SYSTEM LOG: บันทึกเหตุการณ์ที่ล้มเหลวลงชีต System_Log เพื่อตรวจสอบปัญหาได้จาก Google Sheets
//    (เก็บเฉพาะข้อมูลที่จำเป็น ไม่เก็บรายชื่อนักเรียนทั้งหมด)
// =====================================================================
function logSystemEvent(action, payload, message) {
  try {
    const ss = getActiveSS();
    let sheet = ss.getSheetByName('System_Log');
    if (!sheet) {
      sheet = ss.insertSheet('System_Log');
      sheet.getRange(1, 1, 1, 7).setValues([['Timestamp', 'Action', 'Teacher_Email', 'Teacher_Name', 'Room', 'Target_Date', 'ผลลัพธ์/สาเหตุ']])
        .setFontWeight('bold').setBackground('#fee2e2');
      sheet.setFrozenRows(1);
    }
    const p = payload || {};
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setValues([[
      Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss"), action,
      String(p.teacherEmail || ''), String(p.teacherName || ''), String(p.roomString || ''),
      String(p.targetDate || ''), String(message || '').substring(0, 300)
    ]]);
    // เก็บไว้ไม่เกิน 2,000 แถวล่าสุด
    if (sheet.getLastRow() > 2001) sheet.deleteRows(2, sheet.getLastRow() - 2001);
  } catch (e) { console.error('logSystemEvent failed:', e); }
}
