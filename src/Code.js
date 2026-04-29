// ==========================================
// ⚙️ ตั้งค่าระบบ (ใช้ร่วมกันทั้งครูและนักเรียน)
// ==========================================
const SHEET_ID = '19wLK2Pxn0ZGE4hy-DykS4n6ohN1Cq7ew4JopnUp5y8U';
const CURRENT_TERM = '1_2569'; 
const ATTENDANCE_SHEET_NAME = 'Attendance_Logs_' + CURRENT_TERM; 

// ==========================================
// 👨‍🏫 ส่วนที่ 1: ระบบหน้าบ้าน (Web App Entry)
// ==========================================
function doGet() {
  return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('ระบบสารสนเทศ CMCAT | วิทยาลัยเกษตรและเทคโนโลยีเชียงใหม่')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ==========================================
// 🛠️ ส่วนฟังก์ชันจัดการข้อมูล (ครู & นักเรียน)
// ==========================================

// ดึงข้อมูลห้องทั้งหมด
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

// ดึงรายชื่อนักเรียนในห้อง
function getStudentsInRoom(roomString) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('Students');
  const data = sheet.getDataRange().getValues();
  data.shift();
  const cleanRoomString = roomString.replace(/\s+/g, ''); 
  
  return data.filter(row => {
    const studentRoom = `${row[3]}${row[4]}/${row[5]}`.replace(/\s+/g, '');
    return studentRoom === cleanRoomString;
  }).map(row => ({ id: row[0].toString(), name: row[2] }));
}

// บันทึกข้อมูล SDQ (รองรับทั้งเด็กทำเองและครูทำ)
function saveSDQData(payload, evaluatorName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('SDQ_Results') || ss.insertSheet('SDQ_Results');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['วันที่บันทึก', 'ผู้ประเมิน', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'คะแนนรวม', 'สถานะ', 'ด้านอารมณ์', 'ด้านความประพฤติ', 'ด้านไม่อยู่นิ่ง', 'ด้านเพื่อน', 'ด้านสังคม']);
  }
  
  sheet.appendRow([
    new Date(), 
    evaluatorName, 
    payload.studentId, 
    payload.studentName, 
    payload.totalScore, 
    payload.status, 
    payload.scores.emotional, 
    payload.scores.conduct, 
    payload.scores.hyper, 
    payload.scores.peer, 
    payload.scores.prosocial
  ]);
  return { success: true };
}

// บันทึกการเช็คชื่อตามเทอม
function saveAttendance(records, teacherName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(ATTENDANCE_SHEET_NAME) || ss.insertSheet(ATTENDANCE_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['วันที่บันทึก', 'วันที่เช็ค', 'ครูผู้เช็ค', 'รหัสนักเรียน', 'ชื่อ-นามสกุล', 'สถานะ']);
  }
  const now = new Date();
  const today = now.toLocaleDateString('th-TH');
  
  const rows = records.map(r => [now, today, teacherName, r.id, r.name, r.status]);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  return { success: true, count: rows.length };
}

// ดึงประวัติเช็คชื่อรายบุคคล (จากชีตเทอมปัจจุบัน)
function getStudentHistory(data) {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ATTENDANCE_SHEET_NAME); 
  if(!sheet) return { success: true, data: [] };
  
  const dbData = sheet.getDataRange().getDisplayValues(); 
  if (dbData.length <= 1) return { success: true, data: [] };
  
  const logs = dbData.slice(1);
  const personalLogs = logs.filter(row => row[3].toString() === data.studentId.toString()).reverse();
  
  return { success: true, data: personalLogs };
}

// ดึงข้อมูลสรุป SDQ ทั้งห้อง (สำหรับครูดูภาพรวม)
function getSDQDashboard(roomString) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sdqSheet = ss.getSheetByName('SDQ_Results');
  if (!sdqSheet) return { success: true, data: [] };
  
  const sdqData = sdqSheet.getDataRange().getValues();
  sdqData.shift(); 
  
  const studentsInRoom = getStudentsInRoom(roomString);
  const studentIds = studentsInRoom.map(s => s.id);
  
  const results = sdqData.filter(row => studentIds.includes(row[2].toString()))
    .map(row => ({
      id: row[2],
      name: row[3],
      totalScore: row[4],
      status: row[5],
      evaluator: row[1] 
    }));
    
  return { success: true, data: results };
}

// 🟢 เพิ่มใหม่: ดึงข้อมูล SDQ เชิงลึก (ประเมินรายด้าน) ของนักเรียนรายคน
function getStudentDeepData(studentId) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName('SDQ_Results');
  if (!sheet) return { success: true, data: [] };
  
  const data = sheet.getDataRange().getValues();
  data.shift();
  
  const results = data.filter(row => row[2].toString() === studentId.toString())
    .map(row => ({
      date: row[0],
      evaluator: row[1],
      totalScore: row[4],
      status: row[5],
      scores: {
        emotional: row[6],
        conduct: row[7],
        hyper: row[8],
        peer: row[9],
        prosocial: row[10]
      }
    }));
    
  return { success: true, data: results };
}

// ==========================================
// 🔐 ส่วนระบบสมาชิก (Login)
// ==========================================
function loginStudent(data) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  // 1. ค้นหาในฐานข้อมูลนักเรียน (Sheet: Students)
  const studentSheet = ss.getSheetByName('Students');
  if (studentSheet) {
    const studentData = studentSheet.getDataRange().getValues();
    for (let i = 1; i < studentData.length; i++) {
      if (studentData[i][0].toString() === data.studentId.toString() && studentData[i][1].toString() === data.password.toString()) {
        return { 
          success: true, 
          role: 'student', 
          message: 'เข้าสู่ระบบนักเรียนสำเร็จ!',
          user: { 
            id: studentData[i][0], 
            name: studentData[i][2], 
            level: `${studentData[i][3]} ${studentData[i][4]}/${studentData[i][5]}`
          }
        };
      }
    }
  }

  // 2. ค้นหาในฐานข้อมูลครู (Sheet: Teachers)
  const teacherSheet = ss.getSheetByName('Teachers');
  if (teacherSheet) {
    const teacherData = teacherSheet.getDataRange().getValues();
    for (let i = 1; i < teacherData.length; i++) {
      if (teacherData[i][0].toString() === data.studentId.toString() && teacherData[i][3].toString() === data.password.toString()) {
        
        let rawRooms = teacherData[i][5] ? teacherData[i][5].toString() : "";
        let assignedRooms = rawRooms.split(',').map(r => r.trim()).filter(r => r !== "");

        return { 
          success: true, 
          role: 'teacher', 
          message: 'เข้าสู่ระบบครูที่ปรึกษาสำเร็จ!',
          user: { id: teacherData[i][0], name: teacherData[i][1], position: teacherData[i][2], rooms: assignedRooms }
        };
      }
    }
  }

  return { success: false, message: 'รหัสผู้ใช้งาน หรือรหัสผ่านไม่ถูกต้อง' };
}

// ==========================================
// 🚀 ส่วนหัวใจหลัก: ศูนย์กลางรับ-ส่ง API
// ==========================================
function doPost(e) {
  const res = (data) => ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  try {
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;

    // Route Actions
    if (action === 'login') return res(loginStudent(requestData));
    if (action === 'getRoomData') return res({ success: true, data: getRoomData() });
    if (action === 'getStudentsInRoom') return res({ success: true, data: getStudentsInRoom(requestData.roomString) });
    if (action === 'saveAttendance') return res(saveAttendance(requestData.records, requestData.teacherName));
    if (action === 'saveSDQData') return res(saveSDQData(requestData.payload, requestData.evaluatorName));
    if (action === 'getSDQDashboard') return res(getSDQDashboard(requestData.roomString));
    if (action === 'getHistory') return res(getStudentHistory(requestData));
    if (action === 'getStudentDeepData') return res(getStudentDeepData(requestData.studentId)); // 🟢 ใหม่

    return res({ success: false, message: 'ไม่พบคำสั่ง (Action) ที่ระบุ' });
  } catch (error) {
    return res({ success: false, message: error.toString() });
  }
}