import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { OfficialSignatory, SPIPeriodicReport } from '../types/audit';
import { SPIPeriodicAnalytics } from './spiPeriodicAnalytics';
import { formatRupiahId } from './riskAnalytics';

export interface SpiPeriodicPdfOptions {
  report: SPIPeriodicReport;
  analytics: SPIPeriodicAnalytics;
  branding: {
    appName?: string;
    institutionName?: string;
    shortInstitutionName?: string;
  };
  signatories?: {
    kepalaSpi?: OfficialSignatory;
    direktur?: OfficialSignatory;
    dewas?: OfficialSignatory;
    location?: string;
  };
}

const EMERALD_DARK: [number, number, number] = [10, 47, 28];
const EMERALD_PRIMARY: [number, number, number] = [4, 120, 87];
const SLATE_TEXT: [number, number, number] = [15, 23, 42];
const SLATE_MUTED: [number, number, number] = [100, 116, 139];
const BORDER_COLOR: [number, number, number] = [203, 213, 225];
const SURFACE_ALT: [number, number, number] = [248, 250, 252];

export function buildSpiPeriodicReportPdfDoc(opts: SpiPeriodicPdfOptions): jsPDF {
  const { report, analytics, branding, signatories } = opts;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 16;
  const contentWidth = pageWidth - marginX * 2;
  const topMargin = 22;
  const bottomMargin = 18;

  const institution =
    branding.institutionName || 'Perumda Air Minum Tirta Saiyo Kabupaten Pasaman';
  const shortInst = branding.shortInstitutionName || 'Perumda Tirta Saiyo Pasaman';
  const appName = branding.appName || 'SPI SMART';
  const isMonthly = report.periodType === 'BULANAN';

  let cursorY = topMargin;

  const ensureSpace = (needed: number) => {
    if (cursorY + needed > pageHeight - bottomMargin) {
      doc.addPage();
      cursorY = topMargin;
    }
  };

  const writeChapterHeader = (chapterNum: string, title: string, subtitle?: string) => {
    ensureSpace(22);
    doc.setFillColor(...EMERALD_DARK);
    doc.rect(marginX, cursorY, contentWidth, 12, 'F');
    doc.setFillColor(245, 158, 11);
    doc.rect(marginX, cursorY, 2.5, 12, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(167, 243, 208);
    doc.text(chapterNum.toUpperCase(), marginX + 5, cursorY + 4.3);

    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(title, marginX + 5, cursorY + 9.6);

    cursorY += 15;
    if (subtitle) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(...SLATE_MUTED);
      doc.text(subtitle, marginX, cursorY);
      cursorY += 5;
    }
  };

  const writeSectionTitle = (title: string) => {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...EMERALD_DARK);
    doc.text(title, marginX, cursorY);
    doc.setDrawColor(...BORDER_COLOR);
    doc.line(marginX, cursorY + 1.5, marginX + contentWidth, cursorY + 1.5);
    cursorY += 6;
  };

  const writeParagraphs = (text: string) => {
    const blocks = (text || '-').split(/\n\s*\n/);
    blocks.forEach((block) => {
      const lines = doc.splitTextToSize(block.trim(), contentWidth) as string[];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...SLATE_TEXT);
      lines.forEach((line) => {
        ensureSpace(5);
        doc.text(line, marginX, cursorY);
        cursorY += 4.3;
      });
      cursorY += 2.2;
    });
  };

  const getTableLastY = (fallback: number): number => {
    const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
    return last?.finalY ? last.finalY + 6 : fallback;
  };

  // =========================================================================
  // COVER PAGE
  // =========================================================================
  doc.setFillColor(...EMERALD_DARK);
  doc.rect(0, 0, pageWidth, 86, 'F');
  doc.setFillColor(...EMERALD_PRIMARY);
  doc.rect(0, 86, pageWidth, 3.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(167, 243, 208);
  doc.text(
    `SATUAN PENGAWASAN INTERN (SPI) · LAPORAN ${isMonthly ? 'BULANAN' : 'TAHUNAN'} PENGAWASAN`,
    marginX,
    24
  );

  doc.setFontSize(21);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(report.reportTitle, contentWidth) as string[];
  let ty = 39;
  titleLines.forEach((l) => {
    doc.text(l, marginX, ty);
    ty += 8.5;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(209, 250, 229);
  doc.text(institution, marginX, Math.max(ty + 3, 72));

  doc.setFillColor(...SURFACE_ALT);
  doc.setDrawColor(...BORDER_COLOR);
  doc.roundedRect(marginX, 102, contentWidth, 68, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...EMERALD_DARK);
  doc.text('IDENTITAS LAPORAN PENGAWASAN SPI', marginX + 6, 112);

  autoTable(doc, {
    startY: 116,
    margin: { left: marginX + 5, right: marginX + 5 },
    theme: 'plain',
    styles: { fontSize: 8.8, cellPadding: 1.8, textColor: SLATE_TEXT },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 46, textColor: SLATE_MUTED },
      1: { cellWidth: contentWidth - 56 },
    },
    body: [
      ['Nomor Laporan', `: ${report.reportNumber}`],
      ['Jenis & Periode', `: Laporan ${isMonthly ? 'Bulanan' : 'Tahunan'} SPI (${analytics.periodLabel})`],
      ['Tanggal Terbit', `: ${report.reportDate}`],
      ['Status Pengesahan', `: ${report.status}`],
      ['Disusun Oleh', `: ${report.preparedBy}`],
      ['Disampaikan Kepada', `: ${report.recipient}`],
    ],
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...EMERALD_DARK);
  doc.text('IKHTISAR CAPAIAN PENGAWASAN PERIODE INI', marginX, 184);

  autoTable(doc, {
    startY: 188,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8.2 },
    bodyStyles: { fontSize: 8.5, halign: 'center' },
    head: [['Realisasi PKPT', 'SPT Audit', 'KKA Disusun', 'LHA Terbit', 'Temuan 5C', 'Penyelesaian TLR']],
    body: [
      [
        `${analytics.pkptCompleted}/${analytics.pkptTotal} (${analytics.pkptRealizationPct}%)`,
        `${analytics.assignmentsTotal}`,
        `${analytics.workPapersTotal}`,
        `${analytics.lhaTotal}`,
        `${analytics.findingsTotal}`,
        `${analytics.recCompletionPct}%`,
      ],
    ],
  });

  // =========================================================================
  // BAB I - RINGKASAN EKSEKUTIF
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB I',
    'Ringkasan Eksekutif & Ikhtisar Kinerja Pengawasan SPI',
    `${institution} · ${analytics.periodLabel}`
  );
  writeParagraphs(report.executiveSummary);

  writeSectionTitle('1.1 Tabel Indikator Kinerja Pengawasan SPI');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8.2 },
    bodyStyles: { fontSize: 8.2 },
    head: [['Indikator Pengawasan', 'Realisasi Periode', 'Rincian Status']],
    body: [
      ['PKPT Berbasis Risiko', `${analytics.pkptCompleted} / ${analytics.pkptTotal} (${analytics.pkptRealizationPct}%)`, `Berlangsung: ${analytics.pkptOngoing} · Rencana: ${analytics.pkptPlanned}`],
      ['Program Kapabilitas SPI', `${analytics.spiProgramsCompleted} / ${analytics.spiProgramsTotal}`, `Anggaran Program: ${formatRupiahId(analytics.spiProgramsBudgetTotal)}`],
      ['Surat Perintah Tugas (SPT)', `${analytics.assignmentsTotal} Penugasan`, `Selesai: ${analytics.assignmentsCompleted} · Berlangsung: ${analytics.assignmentsOngoing}`],
      ['Program Kerja Audit (PKA) & KKA', `${analytics.workPapersTotal} KKA`, `KKA Approved: ${analytics.workPapersApproved} · PKA Selesai: ${analytics.pkaStepsCompleted}/${analytics.pkaStepsTotal}`],
      ['Laporan Hasil Audit (LHA)', `${analytics.lhaTotal} Laporan`, `Final / Terbit ke Direktur: ${analytics.lhaFinalCount}`],
      ['Temuan Audit 5C', `${analytics.findingsTotal} Temuan`, `Kritis/Tinggi: ${analytics.findingsCriticalHigh} · Potensi Kerugian: ${formatRupiahId(analytics.totalPotentialLoss)}`],
      ['Tindak Lanjut Rekomendasi (TLR)', `${analytics.recCompletionPct}% Selesai`, `Selesai: ${analytics.recCompleted}/${analytics.recTotal} · TLR Disetujui: ${analytics.followUpsApproved}`],
      ['Whistleblowing System (WBS)', `${analytics.wbsReportsTotal} Laporan`, `Anonim: ${analytics.wbsAnonCount} · ST WBS: ${analytics.wbsAssignmentsTotal} · Masuk 5C: ${analytics.wbsConvertedToFindingCount}`],
      ['Investigasi & Kepatuhan Hukum', `${analytics.investigationsTotal} Kasus`, `Regulasi Berlaku: ${analytics.regulationsActive} · Dalam Review: ${analytics.regulationsInReview}`],
    ],
  });
  cursorY = getTableLastY(cursorY + 50);

  // =========================================================================
  // BAB II - REALISASI PKPT & PROGRAM TAHUNAN SPI
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader('BAB II', 'Realisasi PKPT & Program Kerja Tahunan Kapabilitas SPI');
  writeParagraphs(report.pkptAndProgramRealization);

  writeSectionTitle('2.1 Daftar Agenda PKPT Terkait Periode Pelaporan');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 7.8 },
    bodyStyles: { fontSize: 7.6 },
    head: [['Judul Pengawasan PKPT', 'Unit / Auditee', 'Jenis Audit', 'Kuartal', 'Skor Prioritas', 'Status']],
    body:
      analytics.pkptItems.length > 0
        ? analytics.pkptItems.map((p) => [
            p.title,
            p.unitName,
            p.auditType,
            p.quarter,
            `${p.priorityScore || p.riskScore || 0}`,
            p.status,
          ])
        : [['Belum ada agenda PKPT pada periode ini', '-', '-', '-', '-', '-']],
  });
  cursorY = getTableLastY(cursorY + 45);

  writeSectionTitle('2.2 Program Kerja Non-Audit Kapabilitas SPI');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 7.8 },
    bodyStyles: { fontSize: 7.6 },
    head: [['Nama Kegiatan Kapabilitas SPI', 'Jadwal', 'PIC', 'Anggaran', 'Status']],
    body:
      analytics.spiPrograms.length > 0
        ? analytics.spiPrograms.map((s) => [
            s.activityName,
            s.schedule,
            s.pic,
            formatRupiahId(s.budget),
            s.status,
          ])
        : [['Belum ada program non-audit SPI tercatat pada tahun ini', '-', '-', '-', '-']],
  });
  cursorY = getTableLastY(cursorY + 40);

  // =========================================================================
  // BAB III - PELAKSANAAN AUDIT (SPT, KKA & LHA)
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader('BAB III', 'Pelaksanaan Audit: Surat Tugas (SPT), KKA & Laporan Hasil Audit (LHA)');
  writeParagraphs(report.auditExecutionSummary);

  writeSectionTitle('3.1 Daftar Surat Perintah Tugas (SPT) Periode Pelaporan');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 7.6 },
    bodyStyles: { fontSize: 7.5 },
    head: [['No. SPT & Tanggal', 'Objek Audit & Unit', 'Jenis Audit', 'Ketua Tim', 'Periode Pelaksanaan', 'Status']],
    body:
      analytics.assignments.length > 0
        ? analytics.assignments.map((a) => [
            `${a.letterNumber}\n(${a.letterDate})`,
            `${a.objectName}\n${a.unitName}`,
            a.auditType,
            a.teamLeader,
            `${a.startDate} s.d ${a.endDate}`,
            a.status,
          ])
        : [['Tidak ada SPT diterbitkan pada periode ini', '-', '-', '-', '-', '-']],
  });
  cursorY = getTableLastY(cursorY + 45);

  writeSectionTitle('3.2 Laporan Hasil Audit (LHA) Terbit & Opini Pengawasan');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 7.6 },
    bodyStyles: { fontSize: 7.5 },
    head: [['No. LHA & Tanggal', 'Judul Audit & Unit', 'Opini Audit', 'Status Pengesahan']],
    body:
      analytics.auditReports.length > 0
        ? analytics.auditReports.map((r) => [
            `${r.reportNumber}\n(${r.reportDate})`,
            `${r.auditTitle}\n${r.unitName}`,
            r.auditOpinion,
            r.status,
          ])
        : [['Belum ada LHA diterbitkan pada periode ini', '-', '-', '-']],
  });
  cursorY = getTableLastY(cursorY + 40);

  if (!isMonthly) {
    writeSectionTitle(`3.3 Rekapitulasi Aktivitas Bulanan SPI Sepanjang Tahun ${report.year}`);
    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5, halign: 'center' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
      head: [['Bulan', 'SPT', 'KKA', 'LHA', 'Temuan 5C', 'TLR Masuk', 'TLR Disetujui', 'Investigasi', 'WBS']],
      body: analytics.monthlyBreakdown.map((m) => [
        m.monthName,
        `${m.assignmentsCount}`,
        `${m.kkaCount}`,
        `${m.lhaCount}`,
        `${m.findingsCount}`,
        `${m.followUpsSubmitted}`,
        `${m.followUpsApproved}`,
        `${m.investigationsCount}`,
        `${m.wbsReportsCount}`,
      ]),
    });
    cursorY = getTableLastY(cursorY + 55);
  }

  // =========================================================================
  // BAB IV - TEMUAN AUDIT 5C & TINDAK LANJUT
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader('BAB IV', 'Temuan Audit 5C, Potensi Kerugian & Tindak Lanjut Rekomendasi');
  writeParagraphs(report.findingsAndFollowUpSummary);

  writeSectionTitle('4.1 Matriks Temuan Audit 5C Periode Pelaporan');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 7.5 },
    bodyStyles: { fontSize: 7.4 },
    head: [['No. Temuan', 'Unit Kerja', 'Judul Temuan', 'Level Risiko', 'Potensi Kerugian', 'Status']],
    body:
      analytics.findings.length > 0
        ? analytics.findings.map((f) => [
            f.findingNumber,
            f.unitName,
            f.title,
            f.riskLevel,
            formatRupiahId(f.potentialLoss || 0),
            f.status,
          ])
        : [['-', '-', 'Tidak ada temuan audit baru pada periode ini', '-', 'Rp 0', '-']],
  });
  cursorY = getTableLastY(cursorY + 45);

  writeSectionTitle('4.2 Rekapitulasi Status Rekomendasi & Tindak Lanjut (TLR)');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    head: [['Kategori Status Rekomendasi', 'Jumlah', 'Persentase']],
    body: [
      ['Selesai Ditindaklanjuti', `${analytics.recCompleted}`, `${analytics.recCompletionPct}%`],
      ['Dalam Proses / Menunggu Verifikasi SPI', `${analytics.recInProgress}`, `${analytics.recTotal > 0 ? Math.round((analytics.recInProgress / analytics.recTotal) * 100) : 0}%`],
      ['Belum Ditindaklanjuti', `${analytics.recNotStarted}`, `${analytics.recTotal > 0 ? Math.round((analytics.recNotStarted / analytics.recTotal) * 100) : 0}%`],
      ['Total Rekomendasi Tahun Aktif', `${analytics.recTotal}`, '100%'],
    ],
  });
  cursorY = getTableLastY(cursorY + 35);

  // =========================================================================
  // BAB V & VI - INVESTIGASI, WBS, REGULASI, KENDALA & PENGESAHAN
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader('BAB V', 'Whistleblowing System (WBS), Audit Investigatif, Kepatuhan & Risiko SPIP');
  writeParagraphs(report.investigationAndComplianceSummary);

  writeSectionTitle('5.1 Rekapitulasi Penanganan Whistleblowing System (WBS)');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 7.5 },
    bodyStyles: { fontSize: 7.4 },
    head: [['No. Tiket WBS', 'Identitas', 'Judul & Unit Terlapor', 'Status Penanganan', 'SPT WBS / Temuan 5C']],
    body:
      analytics.wbsReports.length > 0
        ? analytics.wbsReports.map((w) => [
            w.ticketNumber,
            w.identityMode,
            `${w.title}\n(${w.reportedUnitName})`,
            w.status,
            `${w.linkedAssignmentNumber || '-'}${w.linkedFindingNumber ? `\n${w.linkedFindingNumber}` : ''}`,
          ])
        : [['-', '-', 'Tidak ada pengaduan WBS baru pada periode ini', '-', '-']],
  });
  cursorY = getTableLastY(cursorY + 35);

  writeChapterHeader('BAB VI', 'Kendala, Rekomendasi Strategis, Rencana Kerja & Pengesahan');
  writeSectionTitle('6.1 Kendala & Rekomendasi Strategis kepada Direksi');
  writeParagraphs(report.constraintsAndRecommendations);

  writeSectionTitle('6.2 Rencana Fokus Pengawasan Periode Berikutnya');
  writeParagraphs(report.nextPeriodPlan);

  ensureSpace(56);
  cursorY += 4;
  doc.setDrawColor(...BORDER_COLOR);
  doc.line(marginX, cursorY, marginX + contentWidth, cursorY);
  cursorY += 7;

  const signLoc = signatories?.location || 'Lubuk Sikaping';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_TEXT);
  doc.text(`${signLoc}, ${report.reportDate}`, pageWidth - marginX, cursorY, { align: 'right' });
  cursorY += 6;

  const colW = contentWidth / 3;
  const drawSigCol = (
    colIdx: number,
    roleHeader: string,
    personName: string,
    nip: string,
    pos: string
  ) => {
    const cx = marginX + colIdx * colW + colW / 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(...SLATE_MUTED);
    doc.text(roleHeader, cx, cursorY, { align: 'center' });

    doc.setFontSize(8.4);
    doc.setTextColor(...SLATE_TEXT);
    const posLines = doc.splitTextToSize(pos, colW - 6) as string[];
    posLines.slice(0, 2).forEach((pl, i) => {
      doc.text(pl, cx, cursorY + 4.5 + i * 3.8, { align: 'center' });
    });

    doc.setFontSize(8.8);
    doc.text(personName, cx, cursorY + 28, { align: 'center' });
    doc.line(cx - 24, cursorY + 29, cx + 24, cursorY + 29);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(...SLATE_MUTED);
    doc.text(`NIP. ${nip || '-'}`, cx, cursorY + 33, { align: 'center' });
  };

  drawSigCol(
    0,
    'Disusun Oleh:',
    signatories?.kepalaSpi?.name || report.preparedBy || 'Kepala SPI',
    signatories?.kepalaSpi?.nip || '-',
    signatories?.kepalaSpi?.position || 'Kepala Satuan Pengawasan Intern'
  );
  drawSigCol(
    1,
    'Diketahui Oleh:',
    signatories?.direktur?.name || 'Direktur',
    signatories?.direktur?.nip || '-',
    signatories?.direktur?.position || `Direktur ${shortInst}`
  );
  drawSigCol(
    2,
    'Tembusan:',
    signatories?.dewas?.name || 'Dewan Pengawas',
    signatories?.dewas?.nip || '-',
    signatories?.dewas?.position || `Dewan Pengawas ${shortInst}`
  );

  // Page Headers & Footers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...EMERALD_DARK);
      doc.text(
        `${appName} · LAPORAN ${isMonthly ? 'BULANAN' : 'TAHUNAN'} SPI (${analytics.periodLabel.toUpperCase()})`,
        marginX,
        12
      );
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...SLATE_MUTED);
      doc.text(report.reportNumber, pageWidth - marginX, 12, { align: 'right' });
      doc.setDrawColor(...BORDER_COLOR);
      doc.line(marginX, 14.5, pageWidth - marginX, 14.5);
    }

    doc.setDrawColor(...BORDER_COLOR);
    doc.line(marginX, pageHeight - 13, pageWidth - marginX, pageHeight - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...SLATE_MUTED);
    doc.text(`Satuan Pengawasan Intern · ${shortInst}`, marginX, pageHeight - 8.5);
    doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth - marginX, pageHeight - 8.5, {
      align: 'right',
    });
  }

  return doc;
}

export function downloadSpiPeriodicReportPdf(opts: SpiPeriodicPdfOptions): string {
  const doc = buildSpiPeriodicReportPdfDoc(opts);
  const slug =
    opts.report.periodType === 'BULANAN'
      ? `Bulanan_${String(opts.report.month || 1).padStart(2, '0')}_${opts.report.year}`
      : `Tahunan_${opts.report.year}`;
  const filename = `Laporan_SPI_${slug}.pdf`;
  doc.save(filename);
  return filename;
}
