import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { OfficialSignatory, RiskAnnualReport, RiskProfileConfig } from '../types/audit';
import { CorporateRiskAnalytics, formatRupiahId, getEffectiveInherentScore, getEffectiveResidualScore } from './riskAnalytics';
import { BPKP_LIKELIHOOD_LEVELS, BPKP_IMPACT_LEVELS } from '../data/bpkpStandards';

export interface AnnualReportPdfOptions {
  report: RiskAnnualReport;
  profileConfig?: RiskProfileConfig | null;
  analytics: CorporateRiskAnalytics;
  branding: {
    appName?: string;
    appTagline?: string;
    institutionName?: string;
    shortInstitutionName?: string;
    address?: string;
    phone?: string;
    email?: string;
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

export function buildRiskAnnualReportPdfDoc(opts: AnnualReportPdfOptions): jsPDF {
  const { report, profileConfig, analytics, branding, signatories } = opts;

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
  const yearLabel = report.year === 0 ? 'Lintas Tahun' : `Tahun Buku ${report.year}`;

  let cursorY = topMargin;

  const ensureSpace = (neededHeight: number) => {
    if (cursorY + neededHeight > pageHeight - bottomMargin) {
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
  doc.rect(0, 0, pageWidth, 88, 'F');
  doc.setFillColor(...EMERALD_PRIMARY);
  doc.rect(0, 88, pageWidth, 3.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(167, 243, 208);
  doc.text('SATUAN PENGAWASAN INTERN (SPI) · DOKUMEN EKSEKUTIF TERBATAS', marginX, 24);

  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  const titleLines = doc.splitTextToSize(
    report.reportTitle || `LAPORAN TAHUNAN MANAJEMEN RISIKO ${yearLabel.toUpperCase()}`,
    contentWidth
  ) as string[];
  let titleY = 40;
  titleLines.forEach((l) => {
    doc.text(l, marginX, titleY);
    titleY += 9;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(209, 250, 229);
  doc.text(institution, marginX, Math.max(titleY + 3, 72));

  // Metadata Box on Cover
  doc.setFillColor(...SURFACE_ALT);
  doc.setDrawColor(...BORDER_COLOR);
  doc.roundedRect(marginX, 104, contentWidth, 74, 2.5, 2.5, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...EMERALD_DARK);
  doc.text('IDENTITAS & PENGENDALIAN DOKUMEN LAPORAN', marginX + 6, 114);

  autoTable(doc, {
    startY: 118,
    margin: { left: marginX + 5, right: marginX + 5 },
    theme: 'plain',
    styles: { fontSize: 8.8, cellPadding: 1.8, textColor: SLATE_TEXT },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 48, textColor: SLATE_MUTED },
      1: { cellWidth: contentWidth - 58 },
    },
    body: [
      ['Nomor Dokumen', `: ${report.reportNumber}`],
      ['Periode Pelaporan', `: ${yearLabel}`],
      ['Tanggal Laporan', `: ${report.reportDate}`],
      ['Status Pengesahan', `: ${report.status}`],
      ['Disusun Oleh', `: ${report.preparedBy}`],
      ['Disampaikan Kepada', `: ${report.recipient}`],
      ['Kerangka Acuan', ': ISO 31000:2018 & Pedoman Evaluasi MR SPIP Terpadu BPKP'],
    ],
  });

  // Cover KPI Highlight Strip
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...EMERALD_DARK);
  doc.text('IKHTISAR CAPAIAN PROFIL RISIKO KORPORAT', marginX, 192);

  autoTable(doc, {
    startY: 196,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8.2 },
    bodyStyles: { fontSize: 8.5, halign: 'center' },
    head: [
      [
        'Total Risiko',
        'Skor Inheren Rata-Rata',
        'Skor Residual Rata-Rata',
        'Reduksi Risiko',
        `Di Atas Selera (>${analytics.appetiteThreshold})`,
        'Efektivitas Kontrol',
      ],
    ],
    body: [
      [
        `${analytics.totalRisks}`,
        `${analytics.avgInherent.toFixed(2)}`,
        `${analytics.avgResidual.toFixed(2)}`,
        `${analytics.reductionRatePct}%`,
        `${analytics.aboveAppetiteCount} (${analytics.aboveAppetitePct}%)`,
        `${analytics.effectiveControlRatePct}%`,
      ],
    ],
  });

  // Daftar Isi Box
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...EMERALD_DARK);
  doc.text('SISTEMATIKA ISI LAPORAN (BAB I – BAB VII)', marginX, 224);

  autoTable(doc, {
    startY: 228,
    margin: { left: marginX, right: marginX },
    theme: 'striped',
    headStyles: { fillColor: [241, 245, 249], textColor: SLATE_TEXT, fontSize: 8 },
    bodyStyles: { fontSize: 8.2, cellPadding: 2 },
    head: [['Bab', 'Pokok Bahasan Utama']],
    body: [
      ['BAB I', 'Ringkasan Eksekutif & Ikhtisar Tata Kelola Manajemen Risiko'],
      ['BAB II', 'Konteks Organisasi, Pemilik Risiko & Penetapan Selera Risiko'],
      ['BAB III', 'Profil Risiko Korporat, Matriks 5×5 & Eksposur 8 Kategori SPIP / 5M'],
      ['BAB IV', 'Analisis Eksposur per Pemilik Risiko (Unit Kerja) & Penilaian RCSA'],
      ['BAB V', 'Daftar Risiko Kunci (Top Risks), Evaluasi Kaidah SPI & Status Mitigasi'],
      ['BAB VI', 'Integrasi Manajemen Risiko dengan SPIP BPKP, RKA, PKPT & Hasil Audit'],
      ['BAB VII', 'Kesimpulan, Tantangan Strategis, Peta Jalan & Lembar Pengesahan'],
    ],
  });

  // =========================================================================
  // BAB I - RINGKASAN EKSEKUTIF
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB I',
    'Ringkasan Eksekutif & Ikhtisar Tata Kelola Manajemen Risiko',
    `${institution} · ${yearLabel}`
  );

  writeParagraphs(report.executiveSummaryNarrative);

  writeSectionTitle('1.1 Tabel Indikator Kinerja Utama Manajemen Risiko');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8.2 },
    bodyStyles: { fontSize: 8.2, cellPadding: 2.2 },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 74, fontStyle: 'bold' },
      2: { cellWidth: 38, halign: 'right' },
      3: { cellWidth: contentWidth - 124 },
    },
    head: [['No', 'Indikator Tata Kelola & Profil Risiko', 'Capaian Aktual', 'Keterangan / Target Toleransi']],
    body: [
      ['1', 'Total Peristiwa Risiko Teridentifikasi', `${analytics.totalRisks} Risiko`, 'Tersebar pada unit kerja & proses bisnis'],
      ['2', 'Rata-Rata Skor Risiko Inheren', `${analytics.avgInherent.toFixed(2)} / 25`, 'Eksposur sebelum kontrol berjalan'],
      ['3', 'Rata-Rata Skor Risiko Residual', `${analytics.avgResidual.toFixed(2)} / 25`, `Target selera risiko maks: <= ${analytics.appetiteThreshold}`],
      ['4', 'Tingkat Reduksi Risiko (Inherent -> Residual)', `${analytics.reductionRatePct}%`, 'Penurunan eksposur oleh pengendalian'],
      ['5', `Risiko Melewati Batas Selera (Skor > ${analytics.appetiteThreshold})`, `${analytics.aboveAppetiteCount} (${analytics.aboveAppetitePct}%)`, `Kritis: ${analytics.criticalResidualCount} | Tinggi: ${analytics.highResidualCount}`],
      ['6', 'Efektivitas Pengendalian Eksisting ("Efektif")', `${analytics.effectiveControlRatePct}%`, `Target minimal: ${profileConfig?.targetControlEffectivenessPct ?? 80}%`],
      ['7', 'Realisasi Mitigasi Berstatus "Selesai"', `${analytics.mitigationCompletionRatePct}%`, `Target minimal: ${profileConfig?.targetMitigationCompletionPct ?? 85}%`],
      ['8', 'Kepatuhan Kaidah SPIP ("Sesuai Kaidah" SPI)', `${analytics.spiCompliantCount} / ${analytics.totalRisks}`, `Perlu perbaikan: ${analytics.spiNeedsRevisionCount} risiko`],
      ['9', 'Skor Maturitas SPIP & Unsur Penilaian Risiko', `${analytics.spipIntegration.spipMaturityScore.toFixed(2)}`, `Unsur 2 Penilaian Risiko: ${analytics.spipIntegration.riskElementAvgScore.toFixed(2)}`],
    ],
  });
  cursorY = getTableLastY(cursorY + 50);

  // =========================================================================
  // BAB II - KONTEKS ORGANISASI & SELERA RISIKO
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB II',
    'Konteks Organisasi, Pemilik Risiko & Penetapan Selera Risiko'
  );
  writeParagraphs(report.contextAndGovernanceNarrative);

  writeSectionTitle('2.1 Parameter Selera Risiko & Toleransi Risiko Korporat');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8.2 },
    bodyStyles: { fontSize: 8.2 },
    head: [['Parameter Tata Kelola Risiko', 'Nilai Ketetapan', 'Implikasi Tindak Lanjut']],
    body: [
      [
        'Ambang Batas Selera Risiko (Risk Appetite)',
        `Skor Residual <= ${analytics.appetiteThreshold}`,
        'Risiko di atas ambang ini wajib memiliki rencana perlakuan aktif & pantauan bulan berjalan SPI.',
      ],
      [
        'Toleransi Risiko Sangat Tinggi / Ekstrem (20–25)',
        `${profileConfig?.extremeToleranceCount ?? 0} Risiko (Zero Tolerance)`,
        'Eskalasi langsung kepada Direktur & prioritas utama audit operasional PKPT.',
      ],
      [
        'Target Efektivitas Kontrol Eksisting',
        `>= ${profileConfig?.targetControlEffectivenessPct ?? 80}% Efektif`,
        'Kontrol parsial/tidak efektif wajib diperkuat melalui perbaikan SOP atau otomasi sistem.',
      ],
      [
        'Target Penyelesaian Rencana Mitigasi',
        `>= ${profileConfig?.targetMitigationCompletionPct ?? 85}% Selesai`,
        'Pemantauan realisasi target waktu PIC oleh Kepala Unit dan verifikasi SPI.',
      ],
    ],
  });
  cursorY = getTableLastY(cursorY + 40);

  if (profileConfig?.appetiteStatement) {
    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(...EMERALD_DARK);
    doc.text('Pernyataan Selera Risiko (Risk Appetite Statement):', marginX, cursorY);
    cursorY += 4.5;
    writeParagraphs(profileConfig.appetiteStatement);
  }

  writeSectionTitle('2.2 Kriteria Skala Kemungkinan & Dampak (BPKP SPIP 5×5)');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 7.8 },
    bodyStyles: { fontSize: 7.5 },
    head: [['Skala', 'Kriteria Kemungkinan (Likelihood)', 'Frekuensi / Persentase', 'Kriteria Dampak (Impact)', 'Finansial & Layanan']],
    body: BPKP_LIKELIHOOD_LEVELS.map((l, idx) => {
      const imp = BPKP_IMPACT_LEVELS[idx];
      return [
        `${l.level}`,
        l.name,
        `${l.frequency} (${l.percentage})`,
        imp ? imp.name : '-',
        imp ? `${imp.financial}; Tunda SOP: ${imp.delay}` : '-',
      ];
    }),
  });
  cursorY = getTableLastY(cursorY + 45);

  // =========================================================================
  // BAB III - PROFIL RISIKO, MATRIKS 5x5 & ANALISIS KATEGORI / 5M
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB III',
    'Profil Risiko Korporat, Distribusi Matriks 5×5 & Eksposur Kategori'
  );
  writeParagraphs(report.categoryAndHeatmapAnalysis);

  writeSectionTitle('3.1 Perbandingan Distribusi Tingkat Risiko Inheren vs Residual');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8.2 },
    bodyStyles: { fontSize: 8.2 },
    head: [['Tingkat Risiko', 'Rentang Skor', 'Inheren (Jml)', 'Inheren (%)', 'Residual (Jml)', 'Residual (%)', 'Perubahan']],
    body: analytics.levelDistribution.map((row) => [
      row.level,
      row.scoreRange,
      `${row.inherentCount}`,
      `${row.inherentPct}%`,
      `${row.residualCount}`,
      `${row.residualPct}%`,
      row.delta > 0 ? `+${row.delta}` : `${row.delta}`,
    ]),
  });
  cursorY = getTableLastY(cursorY + 45);

  writeSectionTitle('3.2 Rekapitulasi Profil Risiko pada 8 Kategori Risiko SPIP');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 7.8 },
    head: [['Kategori Risiko SPIP', 'Jml', 'Avg Inheren', 'Avg Residual', 'Maks Residual', `> Selera (>${analytics.appetiteThreshold})`, 'Level Dominan']],
    body: analytics.categorySummaries.map((c) => [
      c.category,
      `${c.riskCount}`,
      c.avgInherent.toFixed(2),
      c.avgResidual.toFixed(2),
      `${c.maxResidual}`,
      `${c.aboveAppetiteCount}`,
      c.riskCount > 0 ? c.dominantLevel : 'Nihil',
    ]),
  });
  cursorY = getTableLastY(cursorY + 45);

  writeSectionTitle('3.3 Distribusi Akar Masalah Berdasarkan Kerangka 5M');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    head: [['Faktor Akar Masalah (5M)', 'Jumlah Risiko', 'Proporsi (%)', 'Avg Skor Residual', 'Melewati Selera']],
    body: analytics.cause5MSummaries.map((m) => [
      m.causeCategory,
      `${m.riskCount}`,
      `${m.pct}%`,
      m.avgResidual.toFixed(2),
      `${m.aboveAppetiteCount}`,
    ]),
  });
  cursorY = getTableLastY(cursorY + 35);

  // =========================================================================
  // BAB IV - PROFIL PER PEMILIK RISIKO (UNIT KERJA) & RCSA
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB IV',
    'Eksposur Risiko per Unit Kerja (Pemilik Risiko) & Penilaian RCSA'
  );
  writeParagraphs(report.unitExposureAnalysis);

  writeSectionTitle('4.1 Peta Eksposur Risiko per Unit Kerja / Pemilik Risiko');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5 },
    head: [['Unit Kerja / Pemilik Risiko', 'Jml Risiko', 'Avg Inh', 'Avg Res', 'Maks Res', '> Selera', 'Kontrol Efektif', 'RCSA (Self/SPI)', 'Temuan']],
    body:
      analytics.unitSummaries.length > 0
        ? analytics.unitSummaries.map((u) => [
            `${u.unitName} (${u.unitCode})`,
            `${u.riskCount}`,
            u.avgInherent.toFixed(1),
            u.avgResidual.toFixed(1),
            `${u.maxResidual}`,
            `${u.aboveAppetiteCount}`,
            `${u.effectiveControlPct}%`,
            u.rcsaCount > 0 ? `${u.rcsaAvgSelfScore}/${u.rcsaAvgSpiScore || '-'}` : '-',
            `${u.findingsCount}`,
          ])
        : [['Belum ada unit pemilik risiko terdata', '0', '0', '0', '0', '0', '0%', '-', '0']],
  });
  cursorY = getTableLastY(cursorY + 50);

  // =========================================================================
  // BAB V - TOP RISKS, EVALUASI KAIDAH & MITIGASI
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB V',
    'Daftar Risiko Kunci (Top Risks), Evaluasi Kaidah & Rencana Mitigasi'
  );
  writeParagraphs(report.mitigationAndControlEvaluation);

  writeSectionTitle('5.1 Daftar Risiko Kunci Korporat (Peringkat Skor Residual Tertinggi)');
  const topRisksSlice = analytics.topRisks.slice(0, 15);
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 7.3 },
    bodyStyles: { fontSize: 7.1, valign: 'top' },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { cellWidth: 26 },
      2: { cellWidth: 42 },
      3: { cellWidth: 15, halign: 'center' },
      4: { cellWidth: 15, halign: 'center' },
      5: { cellWidth: 42 },
      6: { cellWidth: contentWidth - 156 },
    },
    head: [['Kode', 'Unit & Kategori', 'Peristiwa Risiko & Akar', 'Inh', 'Res', 'Rencana Mitigasi & PIC', 'Status']],
    body:
      topRisksSlice.length > 0
        ? topRisksSlice.map((r) => [
            r.code,
            `${r.unitName}\n(${r.category})`,
            `${r.event}\nAkar: ${r.cause || '-'}`,
            `${getEffectiveInherentScore(r)}\n${r.inherentLevel}`,
            `${getEffectiveResidualScore(r)}\n${r.residualLevel}`,
            `${r.mitigationPlan || '-'}\nPIC: ${r.pic || '-'} (${r.targetDate || '-'})`,
            `${r.status}\n[${r.spiReviewStatus || 'Diusulkan'}]`,
          ])
        : [['-', '-', 'Belum ada data risiko pada tahun pelaporan ini.', '-', '-', '-', '-']],
  });
  cursorY = getTableLastY(cursorY + 55);

  // =========================================================================
  // BAB VI - INTEGRASI SPIP, RKA, PKPT & HASIL AUDIT
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB VI',
    'Integrasi Manajemen Risiko dengan SPIP Terpadu, RKA, PKPT & Hasil Audit'
  );
  writeParagraphs(report.spipPkptIntegrationAnalysis);

  writeSectionTitle('6.1 Penilaian Unsur 2 SPIP (Penilaian Risiko) & Penyelarasan Pengawasan');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    theme: 'grid',
    headStyles: { fillColor: EMERALD_DARK, textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    head: [['Dimensi Integrasi', 'Metrik / Sub-Unsur', 'Skor / Realisasi', 'Rencana Penguatan']],
    body: [
      ...(analytics.spipIntegration.riskSubElements.length > 0
        ? analytics.spipIntegration.riskSubElements.map((se) => [
            `SPIP ${se.code}`,
            se.name,
            `Mandiri: ${se.selfRating} | SPI: ${se.spiReviewRating ?? se.selfRating}`,
            se.improvementPlan || '-',
          ])
        : [
            [
              'SPIP Terpadu',
              'Unsur 2: Penilaian Risiko',
              'Belum ada dokumen Self Assessment SPIP tahun ini',
              'Lakukan pengisian Self Assessment SPIP untuk tahun aktif.',
            ],
          ]),
      [
        'PKPT Berbasis Risiko',
        'Rencana vs Realisasi Audit Tahunan',
        `${analytics.pkptSummary.totalPlans} PKPT (${analytics.pkptSummary.realizationPct}% Selesai)`,
        `Rata-rata skor prioritas risiko PKPT: ${analytics.pkptSummary.avgPriorityScore}`,
      ],
      [
        'Integrasi RKA',
        'Program Kerja & Anggaran Terkait',
        `${analytics.rkaSummary.totalPrograms} RKA (${formatRupiahId(analytics.rkaSummary.totalBudget)})`,
        `${analytics.rkaSummary.linkedPkptCount} item PKPT terhubung langsung dengan RKA`,
      ],
      [
        'Temuan & TLR',
        'Temuan Audit 5C & Penyelesaian Rekomendasi',
        `${analytics.findingsSummary.totalFindings} Temuan (${formatRupiahId(analytics.findingsSummary.totalPotentialLoss)})`,
        `Penyelesaian Rekomendasi: ${analytics.recommendationsSummary.completionPct}% (${analytics.recommendationsSummary.completed}/${analytics.recommendationsSummary.total})`,
      ],
    ],
  });
  cursorY = getTableLastY(cursorY + 50);

  // =========================================================================
  // BAB VII - KESIMPULAN, PETA JALAN & PENGESAHAN
  // =========================================================================
  doc.addPage();
  cursorY = topMargin;
  writeChapterHeader(
    'BAB VII',
    'Kesimpulan, Tantangan Strategis, Rencana Aksi & Lembar Pengesahan'
  );

  writeSectionTitle('7.1 Kesimpulan & Tantangan Strategis');
  writeParagraphs(report.conclusionAndChallenges);

  writeSectionTitle(`7.2 Peta Jalan & Rekomendasi Penguatan Tahun ${(report.year || new Date().getFullYear()) + 1}`);
  writeParagraphs(report.nextYearRoadmapNarrative);

  // Signature Block
  ensureSpace(58);
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

  const kSpi = signatories?.kepalaSpi;
  const dir = signatories?.direktur;
  const dewas = signatories?.dewas;

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
    doc.setFontSize(8.3);
    doc.setTextColor(...SLATE_MUTED);
    doc.text(roleHeader, cx, cursorY, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...SLATE_TEXT);
    const posLines = doc.splitTextToSize(pos, colW - 6) as string[];
    posLines.slice(0, 2).forEach((pl, i) => {
      doc.text(pl, cx, cursorY + 4.5 + i * 3.8, { align: 'center' });
    });

    doc.setFont('helvetica', 'bold');
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
    'Disusun & Diajukan Oleh:',
    kSpi?.name || report.preparedBy || 'Kepala SPI',
    kSpi?.nip || '-',
    kSpi?.position || 'Kepala Satuan Pengawasan Intern'
  );
  drawSigCol(
    1,
    'Diketahui & Disetujui:',
    dir?.name || 'Direktur',
    dir?.nip || '-',
    dir?.position || `Direktur ${shortInst}`
  );
  drawSigCol(
    2,
    'Tembusan / Pengawasan:',
    dewas?.name || 'Dewan Pengawas',
    dewas?.nip || '-',
    dewas?.position || `Dewan Pengawas ${shortInst}`
  );

  // Page Headers & Footers across all pages except Cover (page 1)
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    if (i > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(...EMERALD_DARK);
      doc.text(
        `${appName} · LAPORAN TAHUNAN MANAJEMEN RISIKO (${yearLabel.toUpperCase()})`,
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
    doc.text(
      `Rahasia Internal · ${shortInst} · Akses Terbatas Kepala SPI / Super User`,
      marginX,
      pageHeight - 8.5
    );
    doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth - marginX, pageHeight - 8.5, {
      align: 'right',
    });
  }

  return doc;
}

export function downloadRiskAnnualReportPdf(opts: AnnualReportPdfOptions): string {
  const doc = buildRiskAnnualReportPdfDoc(opts);
  const yearSlug = opts.report.year === 0 ? 'Lintas_Tahun' : String(opts.report.year);
  const filename = `Laporan_Tahunan_Manajemen_Risiko_${yearSlug}.pdf`;
  doc.save(filename);
  return filename;
}
