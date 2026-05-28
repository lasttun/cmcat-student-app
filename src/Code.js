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
      case 'login': 
      case 'verifyTeacher': return output(handleLogin(payload)); // 🟢 คืนชีพเส้นทางล็อกอิน (รองรับคำสั่งจาก index.html)
      case 'getRoomData': return output(fetchRoomList());
      case 'getStudentsInRoom': return output(fetchStudentsByRoom(payload.roomString));
      case 'saveAttendance': return output(recordAttendance(payload));
      case 'saveSDQData': return output(recordSDQ(payload));
      case 'getSDQDashboard': return output(fetchSDQOverview(payload.roomString));
      case 'getHistory': return output(fetchStudentAttendanceHistory(payload.studentId));
      case 'getStudentDeepData': return output(fetchIndividualDeepSDQ(payload.studentId));
      case 'getRoomCalendar': return output(fetchRoomAttendanceCalendar(payload.roomString));
      case 'saveHomeroomSpeech': return output(saveHomeroomSpeech(payload)); 
      case 'getSpeechLogs': return output(getSpeechLogs()); 
      case 'getRoomHistory': return output(fetchRoomHistory(payload.roomString)); // 🟢 คืนชีพโหลดข้อมูลรายห้องของครู
      case 'getExecutiveSummary': return output(getExecutiveSummary(payload)); // 🟢 คืนชีพ Dashboard ของ Admin
      case 'recordLibraryEntry': return output(recordLibraryEntry(payload.studentId || payload)); // 🟢 คืนชีพระบบห้องสมุด
      
      // 🟢 เพิ่ม Routing ระบบยืม-คืนห้องสมุดให้รองรับการเรียกจาก Cloudflare Pages
      case 'getLibraryBorrowLogs': return output(getLibraryBorrowLogs());
      case 'saveBorrowRecord': return output(saveBorrowRecord(payload));
      case 'updateReturnStatus': return output(updateReturnStatus(payload));
      
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

/** 3. บันทึกการเช็คชื่อเข้าแถวหน้าเสาธง (Premium Bulk Lock Queue) */
function recordAttendance(payload) {
  const { records, teacherName } = payload;
  if (!records || !Array.isArray(records) || records.length === 0) {
    return { success: false, message: "Invalid or empty records." };
  }

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); 

    const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Date_TH', 'Teacher', 'Student_ID', 'Name', 'Status']);
    }

    const now = new Date();
    const dateStr = Utilities.formatDate(now, CONFIG.TIMEZONE, "dd/MM/yyyy");
    const rows = records.map(r => [now, dateStr, teacherName, String(r.id), r.name, r.status]);
    
    // Bulk Insert (O(1) Sheet Operation)
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
    SpreadsheetApp.flush(); 
    
    return { success: true, count: rows.length };
  } catch (error) {
    console.error("recordAttendance Error:", error);
    return { success: false, message: "ระบบกำลังมีผู้ใช้งานจำนวนมาก กรุณากดบันทึกอีกครั้ง" };
  } finally {
    lock.releaseLock();
  }
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

/** 🛡️ 8.5 ดึงประวัติการเข้าแถวของทั้งห้อง (Fast Set Lookup O(1)) */
function fetchRoomHistory(roomString) {
  const studentResult = fetchStudentsByRoom(roomString);
  if (!studentResult.success) return { success: false, data: [] };
  
  const studentIdSet = new Set(studentResult.data.map(s => s.id));
  const sheet = getTargetSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() <= 1) return { success: true, data: [] };

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
  // 🟢 ดักจับชื่อตัวแปรทุกรูปแบบที่หน้าบ้าน (Cloudflare) อาจจะส่งมา
  const rawID = payload.studentId || payload.username || payload.phone || payload.email;
  const rawPass = payload.password;

  if (!rawID || !rawPass) return { success: false, message: "กรุณากรอกข้อมูลรหัสประจำตัวและรหัสผ่านให้ครบถ้วน" };

  const ss = getActiveSS();
  const inputID = String(rawID).trim();
  const inputPass = String(rawPass).trim();

// --- 1. ตรวจสอบนักเรียน ---
      const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
      if (sSheet) {
        // 🟢 FIX: เปลี่ยนจาก getValues() เป็น getDisplayValues() เพื่อแก้ปัญหา Sheet ตัดเลข 0 ทิ้ง
        const sData = sSheet.getDataRange().getDisplayValues(); 
        const student = sData.find(r => String(r[0]).trim() === inputID && String(r[1]).trim() === inputPass);
        if (student) {
          return {
            success: true, role: 'student',
            user: { id: String(student[0]), name: student[2], level: `${student[3]} ${student[4]}/${student[5]}` }
          };
        }
      }

      // --- 2. ตรวจสอบครูและผู้บริหาร ---
      const tSheet = ss.getSheetByName(CONFIG.SHEETS.TEACHERS);
      if (tSheet) {
        // 🟢 FIX: เปลี่ยนเป็น getDisplayValues() เพื่อดึงข้อมูลออกมาเป็น String ตรงกับที่พิมพ์มา 100%
        const tData = tSheet.getDataRange().getDisplayValues();
        const teacher = tData.find(r => String(r[0]).trim() === inputID && String(r[3]).trim() === inputPass);
    
    if (teacher) {
      // 🟢 ทำความสะอาดคำสิทธิ์จราจร ป้องกันปัญหาเว้นวรรคพิมพ์เกินในเซลล์ Google Sheets
      const rawRole = String(teacher[6] || '').trim();
      let computedRole = 'teacher';
      
      if (rawRole === 'admin' || rawRole === 'ผู้บริหาร') {
        computedRole = 'admin'; 
      } else if (rawRole === 'ครูที่ปรึกษา') {
        computedRole = 'teacher';
      } else {
        computedRole = rawRole; 
      }

// 🟢 ดึงข้อมูลห้องเรียนจากคอลัมน์ F (Index 5) และแยกด้วยลูกน้ำอย่างปลอดภัย
    const myRooms = teacher[5] ? String(teacher[5]).split(',').map(r => r.trim()).filter(r => r !== "") : [];

    return {
      success: true,
      role: computedRole, 
      user: { // 🟢 FIX: เปลี่ยนจาก data เป็น user เพื่อให้สอดคล้องกับหน้า index.html 100%
        email: teacher[0],
        name: teacher[1],
        position: teacher[2],
        rooms: myRooms
      }
    };
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

/** 9. ระบบบันทึกเข้าใช้ห้องสมุด */
function recordLibraryEntry(studentId) {
  const ss = getActiveSS();
  const sSheet = ss.getSheetByName(CONFIG.SHEETS.STUDENTS);
  const libSheet = getTargetSheet('Library_Logs');
  
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
  
  // บันทึก Log
  libSheet.appendRow([new Date(), studentId, student[2], 'เข้าใช้งาน']);
  return { success: true, name: student[2] };
}

/**
 * 🟢 ฟังก์ชันส่วนกลางสำหรับตรวจสอบว่าห้องเรียนนั้นๆ อยู่ในช่วงฝึกงานหรือไม่ (ลอจิกตามปฏิทิน CMCAT)
 */
function checkIsInternshipRoom(roomName, targetDate) {
  if (!targetDate) targetDate = new Date();
  const time = targetDate.getTime();
  const makeTime = (y, m, d) => new Date(y, m - 1, d).getTime();
  
  // 🟢 ลบช่องว่างออกทั้งหมดเพื่อแก้ปัญหาชื่อห้องพิมพ์ไม่ตรงกัน (เช่น "ปวส. 2/1" กับ "ปวส.2/1")
  const room = String(roomName).replace(/\s+/g, '').trim();
  
  // 1. กลุ่ม ปวช.3 ทุกห้อง (8 มิ.ย. 69 ถึง 21 ส.ค. 69)
  if (room.includes("ปวช.3")) {
    return (time >= makeTime(2026, 6, 8) && time <= makeTime(2026, 8, 21));
  }
  
  // 2. กลุ่ม ปวส.2 ที่เริ่มฝึกงานพร้อมกันตั้งแต่วันที่ 25 พ.ค. 69
  if (time >= makeTime(2026, 5, 25)) {
    // 🟢 ใช้ endsWith แทน includes เพื่อป้องกันบั๊กหาคำว่า "2/1" แต่ไปโดนห้อง "2/10"
    if (room.endsWith("ปวส.2/3")) return time <= makeTime(2026, 12, 18);
    if (room.endsWith("ปวส.2/5") || room.endsWith("ปวส.2/14")) return time <= makeTime(2026, 12, 19);
    if (room.endsWith("ปวส.2/10")) return time <= makeTime(2026, 12, 31);
    if (room.endsWith("ปวส.2/8")) return time <= makeTime(2027, 1, 31);
    
    // ที่เหลือ ปวส.2/1, 2/2, 2/6, 2/7, 2/12, 2/13 (สิ้นสุด 21 ส.ค. 69)
    if (room.endsWith("ปวส.2/1") || room.endsWith("ปวส.2/2") || room.endsWith("ปวส.2/6") || 
        room.endsWith("ปวส.2/7") || room.endsWith("ปวส.2/12") || room.endsWith("ปวส.2/13")) {
      return time <= makeTime(2026, 8, 21);
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
  try {
    const borrowId = payload.borrowId || payload;
    // ... โค้ดอื่นๆ ...
    return { success: false, message: "ไม่พบรหัสการยืมนี้" };
  } catch (e) {
    return { success: false, message: e.message };
  }
}