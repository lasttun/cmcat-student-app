/**
 * CMCAT Information System - Ultra-High Quality Core Backend
 * Updated: 2026-04-29
 * Focus: Reliability, Deep Data Analytics, Calendar System, and Type Safety
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
// 🚀 WEB APP ENTRY POINTS (CORS Optimized)
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
 * API Gateway - ศูนย์กลางจัดการ Request จากหน้าเว็บ
 */
function doPost(e) {
  const output = (data) => {
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  };
  
  try {
    if (!e.postData || !e.postData.contents) {
      return output({ success: false, message: "No data received." });
    }

    const request = JSON.parse(e.postData.contents);
    const action = request.action;
    const payload = request.payload || request; // รองรับ Payload ทั้งแบบ Nested และ Flat

    // --- ROUTING SYSTEM ---
    switch (action) {
      case 'login': return output(handleLogin(payload));
      case 'getRoomData': return output(fetchRoomList());
      case 'getStudentsInRoom': return output(fetchStudentsByRoom(payload.roomString));
      case 'saveAttendance': return output(recordAttendance(payload));
      case 'saveSDQData': return output(recordSDQ(payload));
      case 'getSDQDashboard': return output(fetchSDQOverview(payload.roomString));
      case 'getHistory': return output(fetchStudentAttendanceHistory(payload.studentId));
      case 'getStudentDeepData': return output(fetchIndividualDeepSDQ(payload.studentId));
      case 'getRoomCalendar': return output(fetchRoomAttendanceCalendar(payload.roomString)); // 🟢 ใหม่: ระบบปฏิทิน
      case 'getRoomHistory': return output(fetchRoomHistory(payload.roomString)); // 🛡️ เพิ่มใหม่: ดึงประวัติทั้งห้องเพื่อกันครูเช็คชื่อซ้ำ
      default:
        return output({ success: false, message: `Action [${action}] is not implemented.` });
    }
  } catch (error) {
    return output({ success: false, message: "Critical Server Error: " + error.toString() });
  }
}

// ==========================================
// 🛠️ HELPER & DATA SERVICES
// ==========================================

/** เปิด Spreadsheet เพียงครั้งเดียวต่อ 1 Execution เพื่อประหยัด Resource */
function getActiveSS() {
  return SpreadsheetApp.openById(CONFIG.SHEET_ID);
}

function getTargetSheet(name) {
  const ss = getActiveSS();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** ฟังก์ชันจัดรูปแบบห้องเรียนให้เป็นมาตรฐานเดียวกันเพื่อการค้นหา */
function normalizeRoom(str) {
  if (!str) return "";
  return str.toString().replace(/\s+/g, '').replace(/\./g, '').trim();
}

/** 1. ดึงรายชื่อห้องทั้งหมด (แบบ Unique) */
function fetchRoomList() {
  const sheet = getTargetSheet(CONFIG.SHEETS.STUDENTS);
  const data = sheet.getDataRange().getValues();
  data.shift(); // ตัดหัวตาราง
  
  const rooms = data
    .filter(r => r[3] && r[4] && r[5])
    .map(r => `${r[3]} ${r[4]}/${r[5]}`.trim());
  
  const uniqueRooms = [...new Set(rooms)].sort();
  return { success: true, data: uniqueRooms };
}

/** 2. ดึงรายชื่อเด็กในห้อง (ระบบค้นหาแบบ Normalized) */
function fetchStudentsByRoom(roomString) {
  const searchKey = normalizeRoom(roomString);
  const data = getTargetSheet(CONFIG.SHEETS.STUDENTS).getDataRange().getValues();
  data.shift();

  const students = data
    .filter(r => normalizeRoom(`${r[3]}${r[4]}/${r[5]}`) === searchKey)
    .map(r => ({ id: r[0].toString(), name: r[2].toString() }));

  return { success: true, data: students };
}

/** 3. บันทึกการเช็คชื่อเข้าแถวหน้าเสาธง */
function recordAttendance(payload) {
  const { records, teacherName } = payload;
  if (!records || !Array.isArray(records)) return { success: false, message: "Invalid records." };

  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Date_TH', 'Teacher', 'Student_ID', 'Name', 'Status']);
  }

  const now = new Date();
  const dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy");
  const rows = records.map(r => [now, dateStr, teacherName, r.id.toString(), r.name, r.status]);
  
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  return { success: true, count: rows.length };
}

/** 4. บันทึกผลประเมิน SDQ (ทั้งครูและนักเรียน) */
function recordSDQ(payload) {
  // รองรับการส่งข้อมูลแบบ { payload: {...}, evaluatorName: "..." }
  const data = payload.payload || payload;
  const evaluator = payload.evaluatorName || "Unknown";
  
  const sheet = getTargetSheet(CONFIG.SHEETS.SDQ);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Evaluator', 'Student_ID', 'Name', 'Total', 'Status', 'Emotional', 'Conduct', 'Hyper', 'Peer', 'Prosocial']);
  }

  const s = data.scores || { emotional:0, conduct:0, hyper:0, peer:0, prosocial:0 };
  sheet.appendRow([
    new Date(), evaluator, data.studentId.toString(), data.studentName, 
    data.totalScore, data.status, s.emotional, s.conduct, s.hyper, s.peer, s.prosocial
  ]);
  return { success: true };
}

/** 5. ดึงประวัติการเข้าแถวรายบุคคล */
function fetchStudentAttendanceHistory(studentId) {
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() <= 1) return { success: true, data: [] };

  const data = sheet.getDataRange().getDisplayValues();
  const idStr = studentId.toString();

  const history = data.slice(1)
    .filter(r => r[3] === idStr)
    .reverse();

  return { success: true, data: history };
}

/** 6. ดึงข้อมูล SDQ ย้อนหลังทั้งหมดของนักเรียนรายคน (Deep Data) */
function fetchIndividualDeepSDQ(studentId) {
  const sheet = getTargetSheet(CONFIG.SHEETS.SDQ);
  if (sheet.getLastRow() <= 1) return { success: true, data: [] };

  const data = sheet.getDataRange().getValues();
  const idStr = studentId.toString();

  const results = data.slice(1)
    .filter(r => r[2].toString() === idStr)
    .map(r => ({
      date: r[0],
      evaluator: r[1],
      total: r[4],
      status: r[5],
      scores: { emotional: r[6], conduct: r[7], hyper: r[8], peer: r[9], prosocial: r[10] }
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // เรียงจากใหม่ไปเก่า

  return { success: true, data: results };
}

/** 7. ดึงภาพรวม SDQ (ค่าล่าสุดของทุกคนในห้อง) สำหรับครู (แยกเด็ก/ครู) */
function fetchSDQOverview(roomString) {
  const studentResult = fetchStudentsByRoom(roomString);
  if (!studentResult.success) return studentResult;

  const studentIds = studentResult.data.map(s => s.id);
  const sdqSheet = getTargetSheet(CONFIG.SHEETS.SDQ);
  if (sdqSheet.getLastRow() <= 1) return { success: true, data: [] };

  const sdqData = sdqSheet.getDataRange().getValues();
  
  // ใช้ Map เพื่อเก็บค่า "แยกตามผู้ประเมิน" (นักเรียนทำ vs ครูทำ) เพื่อรองรับการประเมินรอบด้าน
  const latestMap = new Map();
  sdqData.slice(1).forEach(r => {
    const id = r[2].toString();
    if (studentIds.includes(id)) {
      // สร้าง Key แยกกัน เพื่อไม่ให้ข้อมูลนักเรียนกับครูทับกัน (เช่น 663001_student และ 663001_teacher)
      const roleKey = r[1] === 'นักเรียนประเมินตนเอง' ? 'student' : 'teacher';
      const key = id + "_" + roleKey;
      
      latestMap.set(key, {
        id: id, name: r[3], totalScore: r[4], status: r[5], evaluator: r[1], date: r[0]
      });
    }
  });

  return { success: true, data: Array.from(latestMap.values()) };
}

/** 🛡️ 8.5 ดึงประวัติการเข้าแถวของทั้งห้อง (ใช้ตรวจสอบว่าวันนี้มีครูท่านอื่นเช็คไปหรือยัง) */
function fetchRoomHistory(roomString) {
  const studentResult = fetchStudentsByRoom(roomString);
  if (!studentResult.success) return { success: false, data: [] };
  
  const studentIds = studentResult.data.map(s => s.id);
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() <= 1) return { success: true, data: [] };

  const data = sheet.getDataRange().getDisplayValues();
  
  // กรองเอาเฉพาะประวัติการเช็คชื่อที่เป็นของนักเรียนในห้องนี้
  const history = data.slice(1)
    .filter(r => studentIds.includes(r[3])) // r[3] คือรหัสนักเรียน (Student_ID)
    .reverse(); // เรียงจากล่าสุดไปเก่า

  return { success: true, data: history };
}

/** 8. 🟢 สรุปข้อมูลการเช็คชื่อทั้งห้อง (รองรับระบบ Dynamic Days และ วันหยุด) */
function fetchRoomAttendanceCalendar(roomString) {
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() <= 1) return { success: true, data: { students: {}, classActiveDays: {} } };

  const data = sheet.getDataRange().getDisplayValues();
  data.shift(); // ลบหัวตาราง

  const studentResult = fetchStudentsByRoom(roomString);
  if (!studentResult.success) return studentResult;
  const studentIds = studentResult.data.map(s => s.id);

  // 1. สร้างโครงสร้างเก็บข้อมูลนักเรียน { "6630001": { "2026-04": { "มา":10, "สาย":2, ...} } }
  // และโครงสร้างเก็บ "วันที่มีการเช็คชื่อจริงของห้องนี้" { "2026-04": Set(วันที่) }
  const studentStats = {};
  const activeDaysPerMonth = {};

  // เตรียมโครงสร้างเริ่มต้นให้นักเรียนทุกคน
  studentIds.forEach(id => {
    studentStats[id] = {};
  });

  data.forEach(r => {
    const dateStr = r[1]; // คอลัมน์ Date_TH (DD/MM/YYYY)
    const sId = r[3];
    const status = r[5];

    if (studentIds.includes(sId)) {
      // แปลง DD/MM/YYYY เป็น YYYY-MM เพื่อใช้เป็น Key ของเดือน
      const parts = dateStr.split('/');
      if(parts.length === 3) {
        const monthKey = `${parts[2]}-${parts[1]}`; // YYYY-MM
        
        // ก. เก็บสถิติวันที่เช็คชื่อจริงของห้อง (Dynamic Denominator)
        if (!activeDaysPerMonth[monthKey]) activeDaysPerMonth[monthKey] = new Set();
        activeDaysPerMonth[monthKey].add(dateStr); // Set จะไม่เก็บวันที่ซ้ำกัน

        // ข. เก็บสถิติของเด็กแต่ละคน
        if (!studentStats[sId][monthKey]) {
          studentStats[sId][monthKey] = { 'มา': 0, 'สาย': 0, 'ลา': 0, 'ขาด': 0 };
        }
        if (studentStats[sId][monthKey][status] !== undefined) {
          studentStats[sId][monthKey][status]++;
        }
      }
    }
  });

  // 2. แปลง Set ให้เป็นจำนวนวันรวมที่แท้จริงของแต่ละเดือน
  const finalClassDays = {};
  for (let month in activeDaysPerMonth) {
    finalClassDays[month] = activeDaysPerMonth[month].size;
  }

  // ส่งข้อมูลกลับไปให้ Frontend
  return { 
    success: true, 
    data: {
      students: studentStats,
      classActiveDays: finalClassDays // วันที่เป็นฐานในการคำนวณร้อยละ
    }
  };
}

// ==========================================
// 🔐 AUTHENTICATION SERVICE (Robust Version)
// ==========================================

function handleLogin(payload) {
  const { studentId, password } = payload;
  if (!studentId || !password) return { success: false, message: "กรุณากรอกข้อมูลให้ครบถ้วน" };

  const ss = getActiveSS();
  const inputID = studentId.toString().trim();
  const inputPass = password.toString().trim();

  // --- 1. ตรวจสอบในฐานข้อมูลนักเรียน (Students) ---
  const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
  if (sSheet) {
    const sData = sSheet.getDataRange().getValues();
    const student = sData.find(r => r[0].toString().trim() === inputID && r[1].toString().trim() === inputPass);
    
    if (student) {
      return {
        success: true,
        role: 'student',
        user: { 
          id: student[0].toString(), 
          name: student[2], 
          level: `${student[3]} ${student[4]}/${student[5]}` 
        }
      };
    }
  }

  // --- 2. ตรวจสอบในฐานข้อมูลครู (Teachers) ---
  const tSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
  if (tSheet) {
    const tData = tSheet.getDataRange().getValues();
    const teacher = tData.find(r => r[0].toString().trim() === inputID && r[3].toString().trim() === inputPass);
    
    if (teacher) {
      // คอลัมน์ที่ 6 (Index 5) คือรายการห้อง
      const rawRooms = teacher[5] ? teacher[5].toString() : "";
      const rooms = rawRooms.split(',').map(r => r.trim()).filter(r => r);
      
      return {
        success: true,
        role: 'teacher',
        user: { 
          id: teacher[0].toString(), 
          name: teacher[1], 
          position: teacher[2], 
          rooms: rooms 
        }
      };
    }
  }

  return { success: false, message: "รหัสประจำตัวหรือรหัสผ่านไม่ถูกต้อง" };
}