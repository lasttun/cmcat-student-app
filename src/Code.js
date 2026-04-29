/**
 * CMCAT Information System - High Quality Core Backend
 * Designed for Performance & Deep Data Analytics
 */

// ==========================================
// ⚙️ GLOBAL CONFIGURATION
// ==========================================
const CONFIG = {
  SHEET_ID: '19wLK2Pxn0ZGE4hy-DykS4n6ohN1Cq7ew4JopnUp5y8U',
  CURRENT_TERM: '1_2569',
  TIMEZONE: "GMT+7",
  SHEETS: {
    STUDENTS: 'Students',
    TEACHERS: 'Teachers',
    SDQ: 'SDQ_Results'
  }
};

const ATTENDANCE_SHEET_NAME = `Attendance_Logs_${CONFIG.CURRENT_TERM}`;

// ==========================================
// 🚀 WEB APP ENTRY POINTS
// ==========================================
function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('ระบบสารสนเทศ CMCAT')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * ศูนย์กลางการรับส่งข้อมูล (API Gateway)
 */
function doPost(e) {
  const res = (data) => ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  
  try {
    const request = JSON.parse(e.postData.contents);
    const action = request.action;
    const payload = request.payload || request; // รองรับทั้งโครงสร้างแบบใหม่และเก่า

    // --- ROUTING ACTIONS ---
    switch (action) {
      case 'login': return res(handleLogin(payload));
      case 'getRoomData': return res(fetchRoomList());
      case 'getStudentsInRoom': return res(fetchStudentsByRoom(payload.roomString));
      case 'saveAttendance': return res(recordAttendance(payload));
      case 'saveSDQData': return res(recordSDQ(payload));
      case 'getSDQDashboard': return res(fetchSDQOverview(payload.roomString));
      case 'getHistory': return res(fetchStudentAttendanceHistory(payload.studentId));
      case 'getStudentDeepData': return res(fetchIndividualDeepSDQ(payload.studentId));
      default:
        return res({ success: false, message: `Action [${action}] not found.` });
    }
  } catch (error) {
    return res({ success: false, message: "System Error: " + error.toString() });
  }
}

// ==========================================
// 🛠️ DATA SERVICE FUNCTIONS
// ==========================================

function getSheet(name) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** 1. ระบบดึงรายชื่อห้องทั้งหมด (Unique List) */
function fetchRoomList() {
  const data = getSheet(CONFIG.SHEETS.STUDENTS).getDataRange().getValues();
  data.shift(); // Remove header
  
  const rooms = [...new Set(data.map(r => `${r[3]} ${r[4]}/${r[5]}`.trim()))];
  return { success: true, data: rooms.sort() };
}

/** 2. ระบบดึงรายชื่อเด็กในห้อง (Normalized Search) */
function fetchStudentsByRoom(roomString) {
  const cleanRoom = roomString.replace(/\s+/g, '');
  const data = getSheet(CONFIG.SHEETS.STUDENTS).getDataRange().getValues();
  data.shift();

  const students = data
    .filter(r => `${r[3]}${r[4]}/${r[5]}`.replace(/\s+/g, '') === cleanRoom)
    .map(r => ({ id: r[0].toString(), name: r[2] }));

  return { success: true, data: students };
}

/** 3. ระบบบันทึกการเช็คชื่อหน้าเสาธง */
function recordAttendance(payload) {
  const { records, teacherName } = payload;
  const sheet = getSheet(ATTENDANCE_SHEET_NAME);
  
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Date_TH', 'Teacher', 'Student_ID', 'Name', 'Status']);
  }

  const now = new Date();
  const dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy");
  const rows = records.map(r => [now, dateStr, teacherName, r.id, r.name, r.status]);
  
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  return { success: true, count: rows.length };
}

/** 4. ระบบบันทึก SDQ เจาะลึก 5 ด้าน */
function recordSDQ(payload) {
  const { payload: data, evaluatorName } = payload;
  const sheet = getSheet(CONFIG.SHEETS.SDQ);
  
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Evaluator', 'Student_ID', 'Name', 'Total', 'Status', 'Emotional', 'Conduct', 'Hyper', 'Peer', 'Prosocial']);
  }

  const s = data.scores;
  sheet.appendRow([
    new Date(), evaluatorName, data.studentId, data.studentName, 
    data.totalScore, data.status, s.emotional, s.conduct, s.hyper, s.peer, s.prosocial
  ]);
  return { success: true };
}

/** 5. ระบบดึงประวัติเช็คชื่อรายบุคคล */
function fetchStudentAttendanceHistory(studentId) {
  const sheet = getSheet(ATTENDANCE_SHEET_NAME);
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length <= 1) return { success: true, data: [] };

  const history = data.slice(1)
    .filter(r => r[3] === studentId.toString())
    .reverse();

  return { success: true, data: history };
}

/** 6. ระบบวิเคราะห์ Deep Data SDQ รายคน (ส่งประวัติทั้งหมด) */
function fetchIndividualDeepSDQ(studentId) {
  const sheet = getSheet(CONFIG.SHEETS.SDQ);
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, data: [] };

  const results = data.slice(1)
    .filter(r => r[2].toString() === studentId.toString())
    .map(r => ({
      date: r[0],
      evaluator: r[1],
      total: r[4],
      status: r[5],
      scores: { emotional: r[6], conduct: r[7], hyper: r[8], peer: r[9], prosocial: r[10] }
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // ใหม่ไปเก่า

  return { success: true, data: results };
}

/** 7. ระบบสรุป SDQ ทั้งห้อง (สำหรับ Dashboard ครู) */
function fetchSDQOverview(roomString) {
  const students = fetchStudentsByRoom(roomString).data;
  const studentIds = students.map(s => s.id);
  const sdqData = getSheet(CONFIG.SHEETS.SDQ).getDataRange().getValues();
  
  // ใช้ Map เพื่อดึง "ค่าล่าสุด" ของนักเรียนแต่ละคน
  const latestMap = new Map();
  sdqData.slice(1).forEach(r => {
    const id = r[2].toString();
    if (studentIds.includes(id)) {
      latestMap.set(id, {
        id: id, name: r[3], totalScore: r[4], status: r[5], evaluator: r[1], date: r[0]
      });
    }
  });

  return { success: true, data: Array.from(latestMap.values()) };
}

// ==========================================
// 🔐 AUTHENTICATION SERVICE
// ==========================================

function handleLogin(payload) {
  const { studentId, password } = payload;
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);

  // --- 1. Check Students Sheet ---
  const sData = ss.getSheetByName(CONFIG.SHEETS.STUDENTS).getDataRange().getValues();
  const student = sData.find(r => r[0].toString() === studentId.toString() && r[1].toString() === password.toString());
  
  if (student) {
    return {
      success: true,
      role: 'student',
      user: { id: student[0], name: student[2], level: `${student[3]} ${student[4]}/${student[5]}` }
    };
  }

  // --- 2. Check Teachers Sheet ---
  const tData = ss.getSheetByName(CONFIG.SHEETS.TEACHERS).getDataRange().getValues();
  const teacher = tData.find(r => r[0].toString() === studentId.toString() && r[3].toString() === password.toString());
  
  if (teacher) {
    const rooms = teacher[5] ? teacher[5].toString().split(',').map(r => r.trim()).filter(r => r) : [];
    return {
      success: true,
      role: 'teacher',
      user: { id: teacher[0], name: teacher[1], position: teacher[2], rooms: rooms }
    };
  }

  return { success: false, message: "รหัสประจำตัวหรือรหัสผ่านไม่ถูกต้อง" };
}