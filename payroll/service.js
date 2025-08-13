const admin = require('firebase-admin');
const dayjs = require('dayjs');
const { generateOneSheetPDF } = require('./sheetPdf');

const db = admin.firestore();

/**
 * Determines the start and end timestamps for a new draft payroll period. If a
 * previous period exists, the new one starts just after the last period’s end;
 * otherwise it spans the last seven days.
 */
function cutoffFromLast(periods) {
  if (periods.length) {
    const last = periods[0];
    const startAt = dayjs(last.endAt.toDate()).add(1, 'second').toDate();
    const endAt = new Date();
    return { startAt, endAt };
  }
  const endAt = new Date();
  const startAt = dayjs(endAt).subtract(7, 'day').toDate();
  return { startAt, endAt };
}

/**
 * Returns the most recently closed payroll period.
 */
async function getLastClosed() {
  const snap = await db
    .collection('payroll_periods')
    .where('status', '==', 'closed')
    .orderBy('endAt', 'desc')
    .limit(1)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Starts a new draft payroll period.
 * @param {{createdBy?: string}} opts options including createdBy
 */
async function startPeriod({ createdBy }) {
  const last = await getLastClosed();
  const { startAt, endAt } = cutoffFromLast(last);
  const ref = await db.collection('payroll_periods').add({
    startAt,
    endAt,
    status: 'draft',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: createdBy || null,
    closedAt: null,
  });
  return { id: ref.id, startAt, endAt, status: 'draft' };
}

/**
 * Stubbed attendance calculation. Replace this with real attendance logic.
 */
async function computeForEmployee(employee, startAt, endAt) {
  const hoursRegular = 36.5;
  const hoursOt = 2.0;
  const tardies = 1;
  const absencesUnj = 0;
  const absencesJ = 0;
  const covers = false;
 const basePayType = employee.basePayType || 'hourly';
  let basePay = employee.basePay ?? 60;
  const otMultiplier = 1.5;
    // Convert daily pay to hourly if basePayType is 'daily'
  if (basePayType === 'daily') {
    let hoursPerDay = 8;
    if (
      employee.schedule &&
      employee.schedule.shift &&
      employee.schedule.shift.start &&
      employee.schedule.shift.end
    ) {
      const [startHour, startMin] = employee.schedule.shift.start.split(':').map(Number);
      const [endHour, endMin] = employee.schedule.shift.end.split(':').map(Number);
      hoursPerDay = (endHour + endMin / 60) - (startHour + startMin / 60);
      if (hoursPerDay <= 0) hoursPerDay = 8;
    }
    basePay = basePay / hoursPerDay;
  }
 const regularPay = (basePayType === 'hourly' || basePayType === 'daily') ? hoursRegular * basePay : 0;
 const overtimePay = (basePayType === 'hourly' || basePayType === 'daily') ? hoursOt * basePay * otMultiplier : 0;
  const salaryPay = basePayType === 'salary' ? employee.basePay || 0 : 0;
 const total = (basePayType === 'hourly' || basePayType === 'daily') ? regularPay + overtimePay : salaryPay;
  return {
    hours: { regular: hoursRegular, overtime: hoursOt },
    tardies,
    absences: { unjustified: absencesUnj, justified: absencesJ },
    covers,
    pay: { basePayType, basePay, total },
    discipline: { unjustifiedYTD: employee.discipline?.unjustifiedYTD || 0 },
    managerNotes: '',
    locked: false,
  };
}

/**
 * Loads active employees. Adjust the query if your collection uses different
 * filters or naming.
 */
async function loadEmployees() {
  const snap = await db
    .collection('employees')
    .where('deleted', '==', false)
    .get()
    .catch(async () => {
      return { empty: true, docs: [] };
    });
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Retrieves or generates a draft preview for a payroll period. On the first
 * invocation, it calculates draft entries for each employee and stores them
 * under the period’s `employees` subcollection.
 */
async function getPreview(periodId) {
  const periodRef = db.collection('payroll_periods').doc(periodId);
  const periodDoc = await periodRef.get();
  if (!periodDoc.exists) throw new Error('period not found');
  const { startAt, endAt } = periodDoc.data();
  const itemsRef = periodRef.collection('employees');
  const itemsSnap = await itemsRef.get();
  if (!itemsSnap.empty) {
    return itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const employees = await loadEmployees();
  const batch = db.batch();
  const rows = [];
  for (const emp of employees) {
    const row = await computeForEmployee(
      emp,
      startAt.toDate ? startAt.toDate() : startAt,
      endAt.toDate ? endAt.toDate() : endAt
    );
    batch.set(itemsRef.doc(emp.id), row, { merge: true });
    rows.push({ id: emp.id, ...row, fullName: emp.fullName || '' });
  }
  await batch.commit();
  return rows;
}

/**
 * Merges edits from a manager into an employee’s draft payroll item.
 */
async function updateEmployeeItem(periodId, employeeId, payload) {
  const ref = db
    .collection('payroll_periods')
    .doc(periodId)
    .collection('employees')
    .doc(employeeId);
  const editable = {};
  if (payload.managerNotes !== undefined) editable.managerNotes = String(payload.managerNotes).slice(0, 140);
  if (payload.covers !== undefined) editable.covers = payload.covers;
  if (
    payload.absences?.unjustified !== undefined ||
    payload.absences?.justified !== undefined
  ) {
    editable['absences'] = {};
    if (payload.absences.unjustified !== undefined) editable.absences.unjustified = Number(payload.absences.unjustified);
    if (payload.absences.justified !== undefined) editable.absences.justified = Number(payload.absences.justified);
  }
  if (payload.pay?.total !== undefined) editable['pay.total'] = Number(payload.pay.total);
  await ref.set(editable, { merge: true });
  const doc = await ref.get();
  return { id: doc.id, ...doc.data() };
}

/**
 * Finalizes a payroll period: updates employees’ discipline records with
 * accumulated unjustified absences, generates a PDF report, and marks the
 * period as closed.
 */
async function closePeriod(periodId) {
  const periodRef = db.collection('payroll_periods').doc(periodId);
  const periodDoc = await periodRef.get();
  if (!periodDoc.exists) throw new Error('period not found');
  const period = periodDoc.data();
  const itemsSnap = await periodRef.collection('employees').get();
  const rows = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const batch = db.batch();
  for (const r of rows) {
    if (!r.absences?.unjustified) continue;
    const discRef = db
      .collection('employees')
      .doc(r.id)
      .collection('private')
      .doc('discipline');
    const discDoc = await discRef.get();
    const current = discDoc.exists ? discDoc.data().unjustifiedAbsencesYTD || 0 : 0;
    batch.set(
      discRef,
      {
        unjustifiedAbsencesYTD: current + Number(r.absences.unjustified || 0),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await batch.commit();
  const { storagePath, publicUrl } = await generateOneSheetPDF({ period, rows, periodId });
  await periodRef.set(
    {
      status: 'closed',
      closedAt: admin.firestore.FieldValue.serverTimestamp(),
      pdfPath: storagePath,
      pdfUrl: publicUrl || null,
    },
    { merge: true }
  );
  return { storagePath, publicUrl: publicUrl || null };
}

module.exports = {
  startPeriod,
  getPreview,
  updateEmployeeItem,
  closePeriod,
};
