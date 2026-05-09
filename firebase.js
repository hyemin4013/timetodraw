

// ══════════════════════════════════════════════════════════════
//  firebase.js — Firestore data layer for 미술시간
//
//  HOW TO SET UP:
//  1. Go to https://console.firebase.google.com/ and create a project.
//  2. Enable Firestore (Native mode).
//  3. In index.html, add your config BEFORE the firebase-app-compat script:
//
//       const firebaseConfig = {
//         apiKey: "...",
//         authDomain: "...",
//         projectId: "...",
//         storageBucket: "...",
//         messagingSenderId: "...",
//         appId: "..."
//       };
//       firebase.initializeApp(firebaseConfig);
//
//  4. For GitHub Pages: in Firestore Rules, allow reads/writes from your origin.
// ══════════════════════════════════════════════════════════════

// Reference to Firestore instance (requires firebase.initializeApp() to be called first)
// eslint-disable-next-line no-undef
const db = firebase.firestore();

const COL = {
  STUDENTS:   'students',
  SCHEDULES:  'schedules',
  ATTENDANCE: 'attendance',
  SETTINGS:   'settings',
};

// ── Document ID helpers ───────────────────────────────────────
// Deterministic IDs avoid compound-query index requirements on Firestore free tier.

function scheduleDocId(studentId, yearMonth, dayOfWeek, hour) {
  return `${studentId}_${yearMonth}_d${dayOfWeek}_h${hour}`;
}

function attendanceDocId(studentId, date) {
  return `${studentId}_${date}`;
}


// ── Students ──────────────────────────────────────────────────

async function getStudents() {
  const snap = await db.collection(COL.STUDENTS).orderBy('name').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function addStudent(data) {
  const ref = await db.collection(COL.STUDENTS).add(data);
  return ref.id;
}

async function updateStudent(id, data) {
  await db.collection(COL.STUDENTS).doc(id).update(data);
}

async function deleteStudent(id) {
  await db.collection(COL.STUDENTS).doc(id).delete();
}


// ── Schedules ─────────────────────────────────────────────────
// Schema: { studentId, yearMonth (YYYY-MM), dayOfWeek (1=Mon…6=Sat), hour (10-19), paid }

async function getSchedules(yearMonth) {
  const snap = await db.collection(COL.SCHEDULES)
    .where('yearMonth', '==', yearMonth)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function setSchedule(data) {
  // Upsert using deterministic ID
  const docId = scheduleDocId(data.studentId, data.yearMonth, data.dayOfWeek, data.hour);
  await db.collection(COL.SCHEDULES).doc(docId).set(data, { merge: true });
  return docId;
}

async function updateSchedule(id, data) {
  await db.collection(COL.SCHEDULES).doc(id).update(data);
}

async function deleteSchedule(id) {
  await db.collection(COL.SCHEDULES).doc(id).delete();
}

async function copySchedules(fromYearMonth, toYearMonth) {
  const fromSchedules = await getSchedules(fromYearMonth);
  if (fromSchedules.length === 0) return 0;
  const batch = db.batch();
  fromSchedules.forEach(sc => {
    const newData = {
      studentId: sc.studentId,
      yearMonth: toYearMonth,
      dayOfWeek: sc.dayOfWeek,
      hour: sc.hour,
      paid: false,
    };
    const docId = scheduleDocId(sc.studentId, toYearMonth, sc.dayOfWeek, sc.hour);
    batch.set(db.collection(COL.SCHEDULES).doc(docId), newData, { merge: true });
  });
  await batch.commit();
  return fromSchedules.length;
}


// ── Attendance ────────────────────────────────────────────────
// Schema: { studentId, date (YYYY-MM-DD), yearMonth (YYYY-MM), status ('present'|'absent'|'makeup'), originalDate?, actualTime? }

async function getAttendanceForMonth(yearMonth) {
  const snap = await db.collection(COL.ATTENDANCE)
    .where('yearMonth', '==', yearMonth)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function upsertAttendance(data) {
  // Ensure yearMonth is always stored for efficient querying
  const enriched = {
    ...data,
    yearMonth: data.date.slice(0, 7),
  };
  const docId = attendanceDocId(data.studentId, data.date);
  await db.collection(COL.ATTENDANCE).doc(docId).set(enriched, { merge: true });
  return docId;
}

async function deleteAttendance(studentId, date) {
  const docId = attendanceDocId(studentId, date);
  await db.collection(COL.ATTENDANCE).doc(docId).delete();
}


// ── Settings ──────────────────────────────────────────────────
// Single document 'global' under 'settings' collection
// Schema: { disabledDates: ['YYYY-MM-DD', ...] }

async function getSettings() {
  const doc = await db.collection(COL.SETTINGS).doc('global').get();
  if (!doc.exists) return { disabledDates: [] };
  return doc.data();
}

async function saveSettings(data) {
  await db.collection(COL.SETTINGS).doc('global').set(data, { merge: true });
}

async function removeDisabledDate(dateStr) {
  const settings = await getSettings();
  const dates = (settings.disabledDates || []).filter(d => d !== dateStr);
  await saveSettings({ disabledDates: dates });
}

// Persistence disabled — avoids first-load empty-result race condition