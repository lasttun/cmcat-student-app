// ==========================================
// ⚙️ ตั้งค่าระบบ (ใช้ร่วมกันทั้งครูและนักเรียน)
// ==========================================
const SHEET_ID = '19wLK2Pxn0ZGE4hy-DykS4n6ohN1Cq7ew4JopnUp5y8U';

// ==========================================
// 👨‍🏫 ส่วนที่ 1: ระบบหน้าบ้านของครูที่ปรึกษา (รันด้วย google.script.run - เก็บไว้เผื่อฉุกเฉิน)
// ==========================================
function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('ระบบครูที่ปรึกษา | วิทยาลัยเกษตรและเทคโนโลยีเชียงใหม่')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// 🛠️ ส่วนฟังก์ชันจัดการข้อมูล (ถูกเรียกใช้จาก API)
// ==========================================
function getRoomData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Students');
  const data = sheet.getDataRange().getValues();
  data.shift(); 
  
  let rooms = {};
  data.forEach(row => {
    let level = row[3], year = row[4], room = row[5];  
    if(level && year && room) {
        let key = `${level} ${year}/${room}`;
        if (!rooms[key]) rooms[key] = true;
    }
  });
  return Object.keys(rooms).sort();
}

function getStudentsInRoom(roomString) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Students');
  const data = sheet.getDataRange().getValues();
  data.shift();
  return data.filter(row => `${row[3]} ${row[4]}/${row[5]}` === roomString)
             .map(row => ({ id: row[0].toString(), name: row[2] }));
}

// 🟢 อัปเดต: เปลี่ยนจากการดึง Email อัตโนมัติ เป็นรับค่าชื่อครู (teacherName) จากระบบ Login
function saveSDQData(payload, teacherName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('SDQ_Results') || ss.insertSheet('SDQ_Results');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['วันที่บันทึก', 'ครูผู้บันทึก', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'คะแนนรวม', 'สถานะ', 'ด้านอารมณ์', 'ด้านความประพฤติ', 'ด้านไม่อยู่นิ่ง', 'ด้านเพื่อน', 'ด้านสังคม']);
  }
  
  // ใช้ teacherName แทน Session.getActiveUser().getEmail()
  sheet.appendRow([new Date(), teacherName, payload.studentId, payload.studentName, payload.totalScore, payload.status, payload.scores.emotional, payload.scores.conduct, payload.scores.hyper, payload.scores.peer, payload.scores.prosocial]);
  return { success: true };
}

// 🟢 อัปเดต: เปลี่ยนจากการดึง Email อัตโนมัติ เป็นรับค่าชื่อครู (teacherName) จากระบบ Login
function saveAttendance(records, teacherName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Attendance_Logs') || ss.insertSheet('Attendance_Logs');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['วันที่บันทึก', 'วันที่เช็ค', 'ครูผู้เช็ค', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'สถานะ']);
  }
  const now = new Date();
  const today = now.toLocaleDateString('th-TH');
  
  // ใช้ teacherName แทน Session.getActiveUser().getEmail()
  const rows = records.map(r => [now, today, teacherName, r.id, r.name, r.status]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  return { success: true, count: rows.length };
}

// ==========================================
// 🎓 ส่วนที่ 2: Backend API (ใช้ติดต่อกับ Cloudflare Pages ผ่าน fetch)
// ==========================================
function doPost(e) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  try {
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action; 
    let result = {};

    // 📌 API สำหรับนักเรียน
    if (action === 'register') {
      result = registerStudent(requestData);
    } else if (action === 'login') {
      result = loginStudent(requestData);
    } else if (action === 'getHistory') {
      result = getStudentHistory(requestData);
    } 
    // 📌 API สำหรับครูที่ปรึกษา (เพิ่มเข้ามาใหม่)
    else if (action === 'getRoomData') {
      result = { success: true, data: getRoomData() };
    } else if (action === 'getStudentsInRoom') {
      result = { success: true, data: getStudentsInRoom(requestData.roomString) };
    } else if (action === 'saveAttendance') {
      result = saveAttendance(requestData.records, requestData.teacherName); 
    } else if (action === 'saveSDQData') {
      result = saveSDQData(requestData.payload, requestData.teacherName); 
    } else {
      result = { success: false, message: 'ไม่พบคำสั่ง (action) ที่ระบุ' };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function registerStudent(data) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { success: false, message: 'ระบบคนใช้งานเยอะ กรุณาลองใหม่' };
  
  try {
    const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Users') || SpreadsheetApp.openById(SHEET_ID).insertSheet('Users');
    const dbData = sheet.getDataRange().getValues();
    
    for (let i = 1; i < dbData.length; i++) {
      if (dbData[i][0].toString() === data.studentId.toString()) {
        return { success: false, message: 'รหัสนักเรียนนี้ ถูกลงทะเบียนไปแล้ว' };
      }
    }
    
    sheet.appendRow([
      "'" + data.studentId, 
      data.name, 
      data.level, 
      "'" + data.password, 
      new Date()
    ]);
    
    return { success: true, message: 'สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบ' };
  } finally { 
    lock.releaseLock(); 
  }
}

function loginStudent(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // 1. ค้นหาในฐานข้อมูลนักเรียนก่อน
  const studentSheet = ss.getSheetByName('Users');
  if (studentSheet) {
    const studentData = studentSheet.getDataRange().getValues();
    for (let i = 1; i < studentData.length; i++) {
      if (studentData[i][0].toString() === data.studentId.toString() && studentData[i][3].toString() === data.password.toString()) {
        return { 
          success: true, 
          role: 'student', 
          message: 'เข้าสู่ระบบนักเรียนสำเร็จ!',
          user: { id: studentData[i][0], name: studentData[i][1], level: studentData[i][2] }
        };
      }
    }
  }

  // 2. ถ้าไม่ใช่นักเรียน ให้ค้นหาในฐานข้อมูลครู
  const teacherSheet = ss.getSheetByName('Teachers');
  if (teacherSheet) {
    const teacherData = teacherSheet.getDataRange().getValues();
    for (let i = 1; i < teacherData.length; i++) {
      if (teacherData[i][0].toString() === data.studentId.toString() && teacherData[i][3].toString() === data.password.toString()) {
        return { 
          success: true, 
          role: 'teacher', 
          message: 'เข้าสู่ระบบครูที่ปรึกษาสำเร็จ!',
          user: { id: teacherData[i][0], name: teacherData[i][1], position: teacherData[i][2] }
        };
      }
    }
  }

  return { success: false, message: 'รหัสผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง' };
}

function getStudentHistory(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Attendance_Logs'); 
  if(!sheet) return { success: true, data: [] };
  
  const dbData = sheet.getDataRange().getDisplayValues(); 
  if (dbData.length <= 1) return { success: true, data: [] };
  
  const logs = dbData.slice(1);
  // เทียบกับ Index 3 (รหัสนักเรียนในตาราง Attendance_Logs ที่ครูเช็ค)
  const personalLogs = logs.filter(row => row[3].toString() === data.studentId.toString()).reverse();
  
  return { success: true, data: personalLogs };
}