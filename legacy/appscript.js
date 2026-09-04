function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// ฟังก์ชันสำหรับเปิดหน้าเว็บ
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('EcoPink: ธนาคารขยะรักษ์โลก')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function doPost(e) {
  // เปิดใช้ LockService (Script Lock) เพื่อป้องกันการทำงานทับซ้อนเมื่อมีคนกดพร้อมกัน
  const lock = LockService.getScriptLock();
  
  try {
    // รอคิวทำงานสูงสุด 10 วินาที หากเกินกว่านั้นให้แจ้งเตือนกลับไป
    lock.waitLock(10000);
  } catch (e) {
    return responseJSON({ status: 'error', message: 'ระบบกำลังมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่อีกครั้ง' });
  }

  try {
    if (e === undefined || !e.postData) {
      return responseJSON({ status: 'error', message: 'No event object' });
    }

    const request = JSON.parse(e.postData.contents);
    const action = request.action;

    if (action === 'login') {
      return handleLogin(request.username, request.password);
    } 
    else if (action === 'getWasteTypes') {
      return getWasteTypes();
    }
    else if (action === 'saveTransaction') {
      return saveTransaction(request.data);
    }
    else if (action === 'getTransactions') {
      return getTransactions(request.room);
    }
    else if (action === 'deleteTransaction') { // <--- เพิ่ม endpoint นี้สำหรับลบรายการ
      return deleteTransaction(request.txId);
    }
    else if (action === 'saveWasteType') {
      return saveWasteType(request.data);
    }
    else if (action === 'editWasteType') {
      return editWasteType(request.data);
    }
    else if (action === 'deleteWasteType') {
      return deleteWasteType(request.id);
    }
    // === เพิ่มส่วนของนักเรียน ===
    else if (action === 'getStudents') {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      return responseJSON({ status: 'success', students: getStudentsByRoom(ss, request.room) });
    }
    else if (action === 'studentLogin') {
      return studentLogin(request.studentId, request.password);
    }
    else if (action === 'saveGameState') {
      return saveGameState(request.studentId, request.gameState);
    }
    else if (action === 'saveRecycleState') {
      return saveRecycleState(request.studentId, request.recycleState);
    }
    // เพิ่ม 3 บรรทัดนี้สำหรับฟีเจอร์เพื่อน
    else if (action === 'getClassmates') {
      return getClassmates(request.room, request.currentId);
    }
    else if (action === 'getFriendIsland') {
      return getFriendIsland(request.friendId);
    }
    else if (action === 'transferPoints') {
      return transferPoints(request.data);
    }

    return responseJSON({ status: 'error', message: 'Unknown action' });

  } catch (err) {
    return responseJSON({ status: 'error', message: err.toString() });
  } finally {
    // คืนค่า Lock กลับสู่ระบบเสมอ ไม่ว่าโค้ดด้านบนจะทำงานสำเร็จหรือ Error ก็ตาม
    lock.releaseLock();
  }
}

// ================= ฟังก์ชันหลัก =================

function handleLogin(username, password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Users');
  
  if (!userSheet) return responseJSON({ status: 'error', message: 'ไม่พบชีต Users' });
  
  const userRows = userSheet.getDataRange().getValues();
  let foundUser = null;
  
  for (let i = 1; i < userRows.length; i++) {
    if (userRows[i][0] == username && userRows[i][1] == password) {
      foundUser = {
        username: userRows[i][0],
        name: userRows[i][2],
        room: userRows[i][3],
        level: userRows[i][4]
      };
      break;
    }
  }
  
  if (!foundUser) {
    return responseJSON({ status: 'error', message: 'ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง' });
  }
  
  const role = (foundUser.level.toString().toLowerCase() === 'admin' || foundUser.room.toString().toLowerCase() === 'admin') ? 'admin' : 'teacher';
  
  const result = {
    status: 'success',
    user: foundUser,
    role: role,
    students: []
  };
  
  if (role === 'admin') {
    result.allRooms = getAllRoomsInfo(ss);
    if (result.allRooms.length > 0) {
      result.students = getStudentsByRoom(ss, 'admin'); 
    }
  } else {
    result.students = getStudentsByRoom(ss, foundUser.room);
  }
  
  return responseJSON(result);
}

// ฟังก์ชันดึงประเภทขยะ
function getWasteTypes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('WasteTypes');
  
  // สร้างชีตอัตโนมัติถ้ายังไม่มี
  if (!sheet) {
    sheet = ss.insertSheet('WasteTypes');
    sheet.appendRow(['รหัสประเภท', 'ชื่อขยะ', 'ราคาต่อกก. (บาท)', 'แต้มต่อกก.']);
    return responseJSON({ status: 'success', data: [] });
  }
  
  const data = sheet.getDataRange().getValues();
  const types = [];
  
  for (let i = 1; i < data.length; i++) {
    types.push({
      id: data[i][0],
      name: data[i][1],
      price: parseFloat(data[i][2]) || 0,
      points: parseFloat(data[i][3]) || 0
    });
  }
  return responseJSON({ status: 'success', data: types });
}

// ฟังก์ชันบันทึกการรับฝากขยะ
function saveTransaction(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Transactions');
  
  if (!sheet) {
    sheet = ss.insertSheet('Transactions');
    // เพิ่ม 'รหัสทำรายการ' เป็นคอลัมน์สุดท้าย
    sheet.appendRow(['Timestamp', 'วันที่รับซื้อ', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'ห้อง', 'ประเภทขยะ', 'น้ำหนัก (กก.)', 'ยอดเงิน (บาท)', 'แต้มสะสม', 'ผู้บันทึก (ครู)', 'รหัสทำรายการ']);
  }
  
  const timestamp = new Date();
  const timeMs = timestamp.getTime();

  if (Array.isArray(data)) {
    if (data.length === 0) return responseJSON({ status: 'success', message: 'ไม่มีข้อมูลให้บันทึก' });
    const rows = data.map((d, index) => {
      const txId = d.studentId.toString() + '_' + timeMs + '_' + index;
      return [timestamp, d.date, d.studentId, d.studentName, d.room, d.wasteTypeName, d.weight, d.totalPrice, d.totalPoints, d.teacherName, txId];
    });
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat("dd/MM/yyyy HH:mm:ss");
    return responseJSON({ status: 'success', message: `บันทึกข้อมูล ${rows.length} รายการเรียบร้อยแล้ว` });
  } else {
    // โหมดรับข้อมูลทีละแถว (รูปแบบเดิม)
    const txId = data.studentId.toString() + '_' + timeMs;
    
    sheet.appendRow([
      timestamp,
      data.date,
      data.studentId,
      data.studentName,
      data.room,
      data.wasteTypeName,
      data.weight,
      data.totalPrice,
      data.totalPoints,
      data.teacherName,
      txId
    ]);
    
    return responseJSON({ status: 'success', message: 'บันทึกข้อมูลเรียบร้อยแล้ว' });
  }
}

// ฟังก์ชันลบรายการรับฝาก <--- ฟังก์ชันใหม่สำหรับลบข้อมูล
function deleteTransaction(txId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Transactions');
  if (!sheet) return responseJSON({ status: 'error', message: 'ไม่พบชีต Transactions' });

  const data = sheet.getDataRange().getValues();
  
  // วนลูปหา row ที่มี txId ตรงกัน (txId จะอยู่ที่คอลัมน์ K หรือ index 10)
  for (let i = 1; i < data.length; i++) {
    if (data[i][10] == txId) {
      sheet.deleteRow(i + 1); // deleteRow นับบรรทัดจาก 1
      return responseJSON({ status: 'success', message: 'ลบรายการสำเร็จ' });
    }
  }
  
  return responseJSON({ status: 'error', message: 'ไม่พบรหัสทำรายการที่ต้องการลบ' });
}

// ฟังก์ชันดึงประวัติการรับฝาก (ของห้องนั้นๆ)
function getTransactions(room) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Transactions');
  
  if (!sheet) return responseJSON({ status: 'success', data: [] });
  
  const rows = sheet.getDataRange().getValues();
  const history = [];
  
  let validStudentIds = null;
  if (room !== 'admin') {
    const dataSheet = ss.getSheetByName('Data');
    if (dataSheet) {
      const dRows = dataSheet.getDataRange().getValues();
      const headers = dRows[0];
      const colRoom = headers.indexOf('ห้อง');
      const colId = headers.indexOf('รหัสนักเรียน');
      const colType = 5; // คอลัมน์ F
      
      validStudentIds = new Set();
      for (let j = 1; j < dRows.length; j++) {
        const isTeacher = (dRows[j][colType] && dRows[j][colType].toString().trim() === 'ครู');
        if (dRows[j][colRoom] == room || isTeacher) {
          validStudentIds.add(dRows[j][colId].toString());
        }
      }
    }
  }
  
  for (let i = rows.length - 1; i >= 1; i--) { // เรียงจากล่าสุดไปเก่าสุด
    // ถ้าไม่ใช่แอดมิน ให้ดูได้เฉพาะเด็กในห้องตัวเองและครู
    if (room !== 'admin') {
       if (validStudentIds && !validStudentIds.has(rows[i][2].toString())) {
         continue; 
       }
    }
    
    history.push({
      timestamp: rows[i][0],
      date: rows[i][1],
      studentId: rows[i][2],
      studentName: rows[i][3],
      room: rows[i][4],
      wasteType: rows[i][5],
      weight: rows[i][6],
      price: rows[i][7],
      points: rows[i][8],
      teacherName: rows[i][9],
      txId: rows[i][10] || '' // <--- ดึงรหัสทำรายการมาด้วย (ถ้าเป็นข้อมูลเก่าจะว่างไว้)
    });
  }
  
  return responseJSON({ status: 'success', data: history });
}

// ฟังก์ชันเพิ่มประเภทขยะ
function saveWasteType(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('WasteTypes');
  
  if (!sheet) return responseJSON({ status: 'error', message: 'ไม่พบชีต WasteTypes' });
  
  // รหัสแบบง่ายๆ W + เวลา
  const newId = 'W' + new Date().getTime().toString().slice(-4);
  sheet.appendRow([newId, data.name, data.price, data.points]);
  
  return responseJSON({ status: 'success', message: 'เพิ่มประเภทขยะเรียบร้อย' });
}

// ฟังก์ชันแก้ไขประเภทขยะ
function editWasteType(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('WasteTypes');
  
  if (!sheet) return responseJSON({ status: 'error', message: 'ไม่พบชีต WasteTypes' });
  
  const values = sheet.getDataRange().getValues();
  
  for (let i = 1; i < values.length; i++) {
    if (values[i][0].toString() === data.id.toString()) {
      const row = i + 1;
      sheet.getRange(row, 2).setValue(data.name);
      sheet.getRange(row, 3).setValue(data.price);
      sheet.getRange(row, 4).setValue(data.points);
      return responseJSON({ status: 'success', message: 'แก้ไขประเภทขยะเรียบร้อยแล้ว' });
    }
  }
  return responseJSON({ status: 'error', message: 'ไม่พบรหัสประเภทขยะที่ต้องการแก้ไข' });
}

// ฟังก์ชันลบประเภทขยะ
function deleteWasteType(id) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('WasteTypes');
  
  if (!sheet) return responseJSON({ status: 'error', message: 'ไม่พบชีต WasteTypes' });
  
  const values = sheet.getDataRange().getValues();
  
  for (let i = 1; i < values.length; i++) {
    if (values[i][0].toString() === id.toString()) {
      sheet.deleteRow(i + 1);
      return responseJSON({ status: 'success', message: 'ลบประเภทขยะเรียบร้อยแล้ว' });
    }
  }
  return responseJSON({ status: 'error', message: 'ไม่พบรหัสประเภทขยะที่ต้องการลบ' });
}


// ================= ฟังก์ชันสำหรับนักเรียน (ใหม่) =================

function studentLogin(studentId, password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('Data');
  
  if (!dataSheet) return responseJSON({ status: 'error', message: 'ไม่พบฐานข้อมูลนักเรียน' });
  
  const rows = dataSheet.getDataRange().getValues();
  const headers = rows[0];
  const colId = headers.indexOf('รหัสนักเรียน');
  const colTitle = headers.indexOf('คำนำหน้า');
  const colName = headers.indexOf('ชื่อ');
  const colSurname = headers.indexOf('นามสกุล');
  const colRoom = headers.indexOf('ห้อง');
  
  let foundStudent = null;
  
  // ค้นหานักเรียน (เบื้องต้นให้รหัสผ่านคือรหัสนักเรียน เพื่อความง่ายในการเข้าใช้งานของเด็ก)
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][colId].toString() === studentId.toString() && password === studentId.toString()) {
      foundStudent = {
        id: rows[i][colId].toString(),
        title: rows[i][colTitle],
        name: rows[i][colName],
        surname: rows[i][colSurname],
        room: rows[i][colRoom]
      };
      break;
    }
  }
  
  if (!foundStudent) {
    return responseJSON({ status: 'error', message: 'รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง' });
  }

  // ดึงประวัติการฝากขยะของเด็กคนนี้
  const txSheet = ss.getSheetByName('Transactions');
  const history = [];
  let totalWeight = 0, totalMoney = 0, totalPoints = 0;
  
  if (txSheet) {
    const txRows = txSheet.getDataRange().getValues();
    for (let i = txRows.length - 1; i >= 1; i--) {
      if (txRows[i][2].toString() === studentId.toString()) {
        const w = parseFloat(txRows[i][6]) || 0;
        const p = parseFloat(txRows[i][7]) || 0;
        const pts = parseInt(txRows[i][8]) || 0;
        
        totalWeight += w;
        totalMoney += p;
        totalPoints += pts;
        
        history.push({
          date: txRows[i][1],
          wasteType: txRows[i][5],
          weight: w,
          price: p,
          points: pts,
          txId: txRows[i][10] || '' // <--- ส่งรหัสทำรายการไปให้ส่วนของนักเรียนด้วย
        });
      }
    }
  }

  // ดึงข้อมูลเซฟเกม
  let gameState = "{}";
  let recycleState = "{}";
  const gameSheet = ss.getSheetByName('GameState');
  if (gameSheet) {
    const gameRows = gameSheet.getDataRange().getValues();
    for (let i = 1; i < gameRows.length; i++) {
      if (gameRows[i][0].toString() === studentId.toString()) {
        gameState = gameRows[i][1] || "{}";
        recycleState = gameRows[i][2] || "{}";
        break;
      }
    }
  }
  
  return responseJSON({ 
    status: 'success', 
    student: foundStudent,
    stats: { totalWeight, totalMoney, totalPoints },
    history: history,
    gameState: gameState,
    recycleState: recycleState
  });
}

function saveGameState(studentId, gameStateJSON) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('GameState');
  
  if (!sheet) {
    sheet = ss.insertSheet('GameState');
    sheet.appendRow(['รหัสนักเรียน', 'ข้อมูลเกม (JSON)']);
  }
  
  const rows = sheet.getDataRange().getValues();
  let found = false;
  
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === studentId.toString()) {
      sheet.getRange(i + 1, 2).setValue(gameStateJSON);
      found = true;
      break;
    }
  }
  
  if (!found) {
    sheet.appendRow([studentId.toString(), gameStateJSON, "{}"]);
  }
  
  return responseJSON({ status: 'success' });
}

function saveRecycleState(studentId, recycleStateJSON) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('GameState');
  
  if (!sheet) {
    sheet = ss.insertSheet('GameState');
    sheet.appendRow(['รหัสนักเรียน', 'ข้อมูลเกม (JSON)', 'ข้อมูลเกมขยะ (JSON)']);
  }
  
  const rows = sheet.getDataRange().getValues();
  let found = false;
  
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === studentId.toString()) {
      sheet.getRange(i + 1, 3).setValue(recycleStateJSON);
      found = true;
      break;
    }
  }
  
  if (!found) {
    sheet.appendRow([studentId.toString(), "{}", recycleStateJSON]);
  }
  
  return responseJSON({ status: 'success' });
}

// === เพิ่มฟังก์ชัน 3 ตัวนี้ ต่อท้ายไฟล์ ===

function getClassmates(room, currentId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) return responseJSON({ status: 'error', message: 'ไม่พบชีต Data' });
  
  const rows = dataSheet.getDataRange().getValues();
  const classmates = [];
  
  for (let i = 1; i < rows.length; i++) {
    // ดึงเฉพาะเด็กห้องเดียวกัน และไม่ใช่ตัวเอง
    if (rows[i][4] == room && rows[i][0].toString() !== currentId.toString()) {
      classmates.push({
        id: rows[i][0].toString(),
        title: rows[i][1],
        name: rows[i][2],
        surname: rows[i][3]
      });
    }
  }
  return responseJSON({ status: 'success', data: classmates });
}

function getFriendIsland(friendId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  // ใช้ชื่อชีต GameState ให้ตรงกับที่คุณเซฟไว้
  const saveSheet = ss.getSheetByName('GameState'); 
  let gameState = null;
  if (saveSheet) {
    const rows = saveSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0].toString() === friendId.toString()) {
        gameState = rows[i][1];
        break;
      }
    }
  }
  return responseJSON({ status: 'success', gameState: gameState });
}

function transferPoints(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Transactions');
  if (!sheet) {
      sheet = ss.insertSheet('Transactions');
      sheet.appendRow(['Timestamp', 'วันที่รับซื้อ', 'รหัสนักเรียน', 'ชื่อ-สกุล', 'ห้อง', 'ประเภทขยะ', 'น้ำหนัก (กก.)', 'ยอดเงิน (บาท)', 'แต้มสะสม', 'ผู้บันทึก (ครู)', 'รหัสทำรายการ']);
  }
  
  const timestamp = new Date();
  
  // <--- สร้างรหัสทำรายการสำหรับการโอน/แลกซื้อไอเทม
  const txIdSender = data.senderId.toString() + '_' + timestamp.getTime() + '_S';
  const txIdReceiver = data.receiverId.toString() + '_' + timestamp.getTime() + '_R';
  
  // บันทึกการหักแต้มคนส่ง (ติดลบ) พร้อมระบุชื่อคนรับ และบันทึกรหัสทำรายการ
  sheet.appendRow([timestamp, data.date, data.senderId, data.senderName, data.room, 'โอนแต้มให้: ' + data.receiverName, 0, 0, -data.amount, data.senderName, txIdSender]);
  
  // บันทึกการเพิ่มแต้มคนรับ พร้อมระบุชื่อคนส่ง และบันทึกรหัสทำรายการ
  sheet.appendRow([timestamp, data.date, data.receiverId, data.receiverName, data.room, 'รับโอนแต้มจาก: ' + data.senderName, 0, 0, data.amount, 'System', txIdReceiver]);
  
  return responseJSON({ status: 'success', message: 'โอนแต้มสำเร็จ' });
}

// ================= ฟังก์ชันช่วยเหลือ (Helper) ของคุณ =================

/**
 * ตัดชื่อครูให้เหลือ "ชื่อ นามสกุล" ล้วนๆ เพื่อเอาไปเทียบกับแถวบุคลากร
 * ชื่อในชีตเขียนไม่นิ่ง — มีคำนำหน้า "ครู" ติดมา มีช่องว่างซ้อน และมีช่องว่างท้ายชื่อ
 */
function normalizeTeacherName_(name) {
  return String(name || '').replace(/\s+/g, ' ').trim().replace(/^ครู\s*/, '');
}

/**
 * จับคู่ว่าบุคลากรแต่ละคนเป็นครูประจำชั้นของห้องไหนบ้าง
 *
 * ชื่อครูประจำชั้นดึงจาก 2 แหล่ง เพราะแต่ละแหล่งไม่ครบเหมือนกัน:
 *   - คอลัมน์ "ครูที่ปรึกษา" (คอลัมน์ F) ของแถวนักเรียนในชีต Data
 *   - คอลัมน์ Name ของชีต Users — บางห้องมีครูคู่ที่ระบุไว้ที่นี่ที่เดียว เช่น ม.1
 * ถ้ามีครูหลายคนจะเขียนรวมช่องเดียวคั่นด้วย "|"
 *
 * การเทียบชื่อ: ลองชื่อ-นามสกุลเต็มก่อน ไม่ตรงค่อยถอยไปเทียบชื่อต้นอย่างเดียว
 * เพราะนามสกุลสะกดไม่ตรงกันอยู่บ้าง (เช่น ป.1 ชีตเขียน "เสาวงษ์" แต่แถวบุคลากรเขียน "เสาวงศ์")
 * ส่วนชื่อต้นของบุคลากรทั้ง 18 คนไม่ซ้ำกันเลย จึงใช้เป็นตัวสำรองได้อย่างปลอดภัย
 *
 * @returns {Object} รหัสบุคลากร -> อาร์เรย์ของห้องที่เป็นครูประจำชั้น
 */
function getAdvisorRoomsMap(ss) {
  const dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) return {};

  const rows = dataSheet.getDataRange().getValues();
  const headers = rows[0];
  const colId = headers.indexOf('รหัสนักเรียน');
  const colName = headers.indexOf('ชื่อ');
  const colSurname = headers.indexOf('นามสกุล');
  const colRoom = headers.indexOf('ห้อง');
  const colType = 5; // คอลัมน์ F — แถวนักเรียนเก็บชื่อครูที่ปรึกษา ส่วนแถวบุคลากรเก็บคำว่า "ครู"

  const byFullName = {};   // "ชื่อ นามสกุล" -> รหัสบุคลากร
  const byFirstName = {};  // "ชื่อ" -> รหัสบุคลากร (ตัวสำรองเมื่อนามสกุลสะกดไม่ตรง)
  const classRooms = {};   // ห้องที่มีนักเรียนอยู่จริง
  const roomAdvisors = {}; // ห้อง -> ชุดข้อความชื่อครูที่ปรึกษา (กันซ้ำด้วย key)

  for (let i = 1; i < rows.length; i++) {
    const isTeacher = (rows[i][colType] && rows[i][colType].toString().trim() === 'ครู');

    if (isTeacher) {
      const id = rows[i][colId].toString();
      const first = normalizeTeacherName_(rows[i][colName]);
      byFullName[first + ' ' + normalizeTeacherName_(rows[i][colSurname])] = id;
      byFirstName[first] = id;
      continue;
    }

    const room = rows[i][colRoom];
    if (!room) continue;
    classRooms[room] = true;
    if (!roomAdvisors[room]) roomAdvisors[room] = {};
    if (rows[i][colType]) roomAdvisors[room][rows[i][colType]] = true;
  }

  // เติมชื่อครูจากชีต Users — รับเฉพาะห้องเรียนจริง (บัญชีแอดมินมี Room = 'Admin' จึงถูกข้ามไป)
  const userSheet = ss.getSheetByName('Users');
  if (userSheet) {
    const userRows = userSheet.getDataRange().getValues();
    for (let i = 1; i < userRows.length; i++) {
      const room = userRows[i][3];
      const name = userRows[i][2];
      if (room && name && classRooms[room]) {
        if (!roomAdvisors[room]) roomAdvisors[room] = {};
        roomAdvisors[room][name] = true;
      }
    }
  }

  const advisorRooms = {};
  for (const room in roomAdvisors) {
    for (const text in roomAdvisors[room]) {
      const parts = text.toString().split('|');
      for (let j = 0; j < parts.length; j++) {
        const full = normalizeTeacherName_(parts[j]);
        if (!full) continue;

        const id = byFullName[full] || byFirstName[full.split(' ')[0]];
        if (!id) continue;   // ชื่อที่ไม่มีแถวบุคลากรรองรับ เช่น "ครูรัตนา โครงกระโทก" ของ ม.1

        if (!advisorRooms[id]) advisorRooms[id] = [];
        if (advisorRooms[id].indexOf(room) === -1) advisorRooms[id].push(room);
      }
    }
  }
  return advisorRooms;
}

function getStudentsByRoom(ss, room) {
  const dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) return [];
  
  const rows = dataSheet.getDataRange().getValues();
  const headers = rows[0];
  
  const colId = headers.indexOf('รหัสนักเรียน');
  const colTitle = headers.indexOf('คำนำหน้า');
  const colName = headers.indexOf('ชื่อ');
  const colSurname = headers.indexOf('นามสกุล');
  const colRoom = headers.indexOf('ห้อง');
  
  const studentsList = [];
  
  // โหลด GameState และ RecycleState ล่วงหน้ามาไว้จับคู่
  const saveSheet = ss.getSheetByName('GameState');
  const savesMap = {};
  const recycleMap = {};
  if (saveSheet) {
    const saveRows = saveSheet.getDataRange().getValues();
    for (let i = 1; i < saveRows.length; i++) {
      savesMap[saveRows[i][0].toString()] = saveRows[i][1];
      recycleMap[saveRows[i][0].toString()] = saveRows[i][2] || "{}";
    }
  }
  
  // ห้องที่บุคลากรแต่ละคนเป็นครูประจำชั้น — หน้าเว็บใช้กรองรายชื่อครูในหน้ารับฝาก
  const advisorRoomsMap = getAdvisorRoomsMap(ss);

  const colType = 5; // คอลัมน์ F (index 5)
  for (let i = 1; i < rows.length; i++) {
    const isTeacher = (rows[i][colType] && rows[i][colType].toString().trim() === 'ครู');
    if (room === 'admin' || rows[i][colRoom] == room || isTeacher) {
      const id = rows[i][colId].toString();
      studentsList.push({
        id: id,
        title: rows[i][colTitle],
        name: rows[i][colName],
        surname: rows[i][colSurname],
        room: rows[i][colRoom],
        isTeacher: isTeacher,
        advisorRooms: isTeacher ? (advisorRoomsMap[id] || []) : [],
        gameState: savesMap[id] || "{}",
        recycleState: recycleMap[id] || "{}" // แนบ recycleState กลับไปด้วย
      });
    }
  }
  return studentsList;
}

function getAllRoomsInfo(ss) {
  const dataSheet = ss.getSheetByName('Data');
  if (!dataSheet) return [];
  
  const rows = dataSheet.getDataRange().getValues();
  const headers = rows[0];
  const colRoom = headers.indexOf('ห้อง');
  const colTeacher = headers.indexOf('ครูที่ปรึกษา');
  
  const roomsMap = {};
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i][colRoom];
    const t = rows[i][colTeacher] || '';
    if (r) roomsMap[r] = t;
  }
  
  const allRooms = [];
  for (const r in roomsMap) {
    allRooms.push({ room: r, teacher: roomsMap[r], level: r }); 
  }
  allRooms.sort((a, b) => a.room.localeCompare(b.room));
  return allRooms;
}

