const admin = require('firebase-admin');
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');
const { PassThrough } = require('stream');

const BUCKET = admin.storage().bucket();

const LOGO_BASE64 = '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';

function fitText(doc, text, width) {
  const original = doc.fontSize();
  let size = original;
  while (doc.widthOfString(text) > width && size > 6) {
    size -= 0.5;
    doc.fontSize(size);
  }
  const finalSize = size;
  doc.fontSize(original);
  return finalSize;
}

async function generateOneSheetPDF({ period, rows, periodId }) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margins: { top: 24, left: 24, right: 24, bottom: 24 } });
  const stream = new PassThrough();
  const filePath = `payroll_periods/${periodId}/corte_${periodId}.pdf`;
  const file = BUCKET.file(filePath);
  const writeStream = file.createWriteStream({ contentType: 'application/pdf' });

  stream.pipe(writeStream);
  doc.pipe(stream);

  // Header with logo and company name
  const headerY = doc.y;
  const logoWidth = 60;
  const logoHeight = 60;
  if (LOGO_BASE64) {
    doc.image('data:image/png;base64,' + LOGO_BASE64, doc.x, headerY, { width: logoWidth });
    doc.font('Helvetica-Bold').fontSize(20).text('Santa Elena', doc.x + logoWidth + 10, headerY + 15);
  } else {
    doc.font('Helvetica-Bold').fontSize(20).text('Santa Elena', doc.x, headerY);
  }
  doc.moveDown(2);

  // Subtitle with report name and period
  doc.font('Helvetica-Bold').fontSize(16).text('Corte de Nómina', { continued: true })
     .font('Helvetica').fontSize(12)
     .text(`   Periodo: ${dayjs(period.startAt.toDate ? period.startAt.toDate() : period.startAt).format('YYYY-MM-DD')} — ${dayjs(period.endAt.toDate ? period.endAt.toDate() : period.endAt).format('YYYY-MM-DD')}`);
  doc.moveDown(0.5);
  doc.fontSize(9).text(`Fecha de corte: ${dayjs().format('YYYY-MM-DD HH:mm')}`);
  doc.moveDown(0.5);

  // Table setup
  const cols = [
    { key: 'idx', label: '#', w: 18 },
    { key: 'name', label: 'Empleado', w: 180 },
    { key: 'hours', label: 'Horas (Reg/Ot)', w: 90 },
    { key: 'total', label: '$ Total', w: 70 },
    { key: 'tardies', label: 'Retardos', w: 55 },
    { key: 'absences', label: 'Faltas Injust.', w: 120 },
    { key: 'covers', label: 'Cubrió', w: 70 },
    { key: 'notes', label: 'Notas Gerente', w: 160 },
    { key: 'sign', label: 'Firma', w: 150 }
  ];

  const x0 = doc.x;
  let y = doc.y + 6;
  let x = x0;

  doc.font('Helvetica-Bold').fontSize(9);
  cols.forEach(c => {
    doc.text(c.label, x, y, { width: c.w });
    x += c.w;
  });
  y += 16;
  doc.moveTo(x0, y - 4).lineTo(x0 + cols.reduce((sum, c) => sum + c.w, 0), y - 4).stroke();

  doc.font('Helvetica').fontSize(9);

  const fmtMoney = (n) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(n || 0);

  rows.forEach((r, i) => {
    x = x0;
    const absCount = r.absences?.unjustified || 0;
    const absBox = `[${absCount === 0 ? 'X' : ' '}]0 [${absCount === 1 ? 'X' : ' '}]1 [${absCount === 2 ? 'X' : ' '}]2 [${absCount >= 3 ? 'X' : ' '}]3+`;
    const hoursTxt = `${(r.hours?.regular ?? 0).toFixed(1)}/${(r.hours?.overtime ?? 0).toFixed(1)}`;

    const cells = {
      idx: String(i + 1),
      name: r.fullName || r.name || '',
      hours: hoursTxt,
      total: fmtMoney(r.pay?.total),
      tardies: String(r.tardies || 0),
      absences: `${absBox}  Acum:${r.discipline?.unjustifiedYTD ?? 0}`,
      covers: r.covers ? (typeof r.covers === 'string' ? r.covers : 'Sí') : 'No',
      notes: r.managerNotes ? String(r.managerNotes) : '',
      sign: '____________________________'
    };

    const nameSize = fitText(doc, cells.name, cols[1].w - 4);
    for (const c of cols) {
      if (c.key === 'name') doc.fontSize(nameSize);
      doc.text(cells[c.key], x, y, { width: c.w });
      if (c.key === 'name') doc.fontSize(9);
      x += c.w;
    }
    y += 14;
    if (y > doc.page.height - 40) {
      doc.addPage({ size: 'LETTER', layout: 'landscape', margins: { top: 24, left: 24, right: 24, bottom: 24 } });
      y = 50;
      x = x0;
      doc.font('Helvetica-Bold').fontSize(9);
      cols.forEach(c => { doc.text(c.label, x, y, { width: c.w }); x += c.w; });
      y += 16;
      doc.moveTo(x0, y - 4).lineTo(x0 + cols.reduce((sum, c) => sum + c.w, 0), y - 4).stroke();
      doc.font('Helvetica').fontSize(9);
    }
  });

  doc.moveDown(1.2);
  doc.fontSize(9).text('Firma del Gerente: ________________________________    Fecha: ____ / ____ / ______');

  doc.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  let publicUrl = null;
  try {
    await file.makePublic();
    publicUrl = `https://storage.googleapis.com/${BUCKET.name}/${filePath}`;
  } catch (err) {
    // ignore if cannot make public
  }

  return { storagePath: filePath, publicUrl };
}

module.exports = { generateOneSheetPDF };
