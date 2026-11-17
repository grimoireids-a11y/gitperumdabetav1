import {
  AuditAssignment,
  AuditProgramStep,
  AuditReport,
  BPKPSelfAssessment,
  Finding,
  FollowUp,
  Investigation,
  PKPT,
  Recommendation,
  Regulation,
  RiskRegister,
  SPIPeriodicType,
  SPIProgram,
  WBSAssignment,
  WBSReport,
  WBSResultReport,
  WBSWorkPaper,
  WorkPaper,
} from '../types/audit';
import { formatRupiahId } from './riskAnalytics';

export const INDONESIAN_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

export interface MonthlyActivityRow {
  month: number;
  monthName: string;
  assignmentsCount: number;
  kkaCount: number;
  lhaCount: number;
  findingsCount: number;
  followUpsSubmitted: number;
  followUpsApproved: number;
  investigationsCount: number;
  wbsReportsCount: number;
}

export interface SPIPeriodicAnalytics {
  periodType: SPIPeriodicType;
  year: number;
  month?: number;
  periodLabel: string;
  // PKPT & SPI Programs (Year Context + Quarter matching if monthly)
  pkptItems: PKPT[];
  pkptTotal: number;
  pkptCompleted: number;
  pkptOngoing: number;
  pkptPlanned: number;
  pkptRealizationPct: number;
  spiPrograms: SPIProgram[];
  spiProgramsTotal: number;
  spiProgramsCompleted: number;
  spiProgramsBudgetTotal: number;
  // Audit Execution (Period Filtered)
  assignments: AuditAssignment[];
  assignmentsTotal: number;
  assignmentsOngoing: number;
  assignmentsCompleted: number;
  pkaStepsTotal: number;
  pkaStepsCompleted: number;
  workPapers: WorkPaper[];
  workPapersTotal: number;
  workPapersApproved: number;
  auditReports: AuditReport[];
  lhaTotal: number;
  lhaFinalCount: number;
  // Findings & Follow-up
  findings: Finding[];
  findingsTotal: number;
  findingsCriticalHigh: number;
  findingsMedium: number;
  findingsLow: number;
  totalPotentialLoss: number;
  recommendations: Recommendation[];
  recTotal: number;
  recCompleted: number;
  recInProgress: number;
  recNotStarted: number;
  recCompletionPct: number;
  followUps: FollowUp[];
  followUpsSubmitted: number;
  followUpsApproved: number;
  // Investigation, WBS, Regulations & Risk Context
  investigations: Investigation[];
  investigationsTotal: number;
  investigationsEstimatedLoss: number;
  wbsReports: WBSReport[];
  wbsReportsTotal: number;
  wbsAnonCount: number;
  wbsInProcessCount: number;
  wbsCompletedCount: number;
  wbsProvenCount: number;
  wbsConvertedToFindingCount: number;
  wbsAssignmentsTotal: number;
  wbsWorkPapersTotal: number;
  wbsResultsTotal: number;
  wbsEstimatedLoss: number;
  regulationsActive: number;
  regulationsInReview: number;
  risksTotal: number;
  risksCriticalHigh: number;
  spipMaturityScore: number;
  spipMaturityLevel: string;
  // 12-Month Breakdown (for Annual Report & YTD context)
  monthlyBreakdown: MonthlyActivityRow[];
}

function parseDateParts(dateStr?: string): { year: number; month: number } | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const isoMatch = dateStr.trim().match(/^(\d{4})-(\d{2})/);
  if (isoMatch) {
    return {
      year: parseInt(isoMatch[1], 10),
      month: parseInt(isoMatch[2], 10),
    };
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
    };
  }
  return null;
}

function matchesPeriod(
  dateStr: string | undefined,
  year: number,
  month?: number,
  fallbackYear?: number
): boolean {
  const parts = parseDateParts(dateStr);
  if (parts) {
    if (parts.year !== year) return false;
    if (month && parts.month !== month) return false;
    return true;
  }
  if (!month && fallbackYear) {
    return fallbackYear === year;
  }
  return false;
}

function getQuarterFromMonth(month: number): 'Q1' | 'Q2' | 'Q3' | 'Q4' {
  if (month <= 3) return 'Q1';
  if (month <= 6) return 'Q2';
  if (month <= 9) return 'Q3';
  return 'Q4';
}

export function buildSpiPeriodicAnalytics(params: {
  periodType: SPIPeriodicType;
  year: number;
  month?: number;
  pkptList: PKPT[];
  spiProgramsList: SPIProgram[];
  assignmentsList: AuditAssignment[];
  auditProgramsList: AuditProgramStep[];
  workPapersList: WorkPaper[];
  auditReportsList: AuditReport[];
  findingsList: Finding[];
  recommendationsList: Recommendation[];
  followUpsList: FollowUp[];
  investigationsList: Investigation[];
  regulationsList: Regulation[];
  risksList: RiskRegister[];
  bpkpList: BPKPSelfAssessment[];
  wbsReportsList?: WBSReport[];
  wbsAssignmentsList?: WBSAssignment[];
  wbsWorkPapersList?: WBSWorkPaper[];
  wbsResultsList?: WBSResultReport[];
}): SPIPeriodicAnalytics {
  const {
    periodType,
    year,
    month,
    pkptList,
    spiProgramsList,
    assignmentsList,
    auditProgramsList,
    workPapersList,
    auditReportsList,
    findingsList,
    recommendationsList,
    followUpsList,
    investigationsList,
    regulationsList,
    risksList,
    bpkpList,
    wbsReportsList = [],
    wbsAssignmentsList = [],
    wbsWorkPapersList = [],
    wbsResultsList = [],
  } = params;

  const activeMonth = periodType === 'BULANAN' ? month || 1 : undefined;
  const periodLabel =
    periodType === 'BULANAN'
      ? `Bulan ${INDONESIAN_MONTHS[(activeMonth || 1) - 1]} ${year}`
      : `Tahun Buku ${year}`;

  // 1. PKPT & SPI Programs
  const yearPkpt = pkptList.filter((p) => p.year === year);
  const pkptItems =
    periodType === 'BULANAN' && activeMonth
      ? yearPkpt.filter((p) => p.quarter === getQuarterFromMonth(activeMonth) || p.status === 'Berlangsung')
      : yearPkpt;

  const pkptCompleted = pkptItems.filter((p) => p.status === 'Selesai').length;
  const pkptOngoing = pkptItems.filter((p) => p.status === 'Berlangsung').length;
  const pkptPlanned = pkptItems.filter((p) => p.status === 'Rencana').length;
  const pkptRealizationPct =
    pkptItems.length > 0 ? Math.round((pkptCompleted / pkptItems.length) * 100) : 0;

  const spiPrograms = spiProgramsList.filter((s) => s.year === year);
  const spiProgramsCompleted = spiPrograms.filter((s) => s.status === 'Terealisasi').length;
  const spiProgramsBudgetTotal = spiPrograms.reduce((sum, s) => sum + (s.budget || 0), 0);

  // 2. Audit Assignments (SPT)
  const assignments = assignmentsList.filter(
    (a) =>
      matchesPeriod(a.letterDate, year, activeMonth) ||
      matchesPeriod(a.startDate, year, activeMonth)
  );
  const assignmentIds = new Set(assignments.map((a) => a.id));

  // PKA steps linked to period assignments (or all year assignments if annual)
  const yearAssignmentIds = new Set(
    assignmentsList
      .filter((a) => matchesPeriod(a.letterDate, year) || matchesPeriod(a.startDate, year))
      .map((a) => a.id)
  );
  const relevantPka = auditProgramsList.filter((step) =>
    (assignments.length > 0 ? assignmentIds : yearAssignmentIds).has(step.assignmentId)
  );

  // KKA
  const workPapers = workPapersList.filter(
    (w) =>
      matchesPeriod(w.createdAt, year, activeMonth) ||
      matchesPeriod(w.updatedAt, year, activeMonth) ||
      (periodType === 'TAHUNAN' && yearAssignmentIds.has(w.assignmentId))
  );

  // LHA
  const auditReports = auditReportsList.filter((r) =>
    matchesPeriod(r.reportDate || r.createdAt, year, activeMonth)
  );

  // 3. Findings
  const findings = findingsList.filter((f) =>
    matchesPeriod(f.createdAt, year, activeMonth, f.year)
  );
  const findingsCriticalHigh = findings.filter(
    (f) => f.riskLevel === 'Kritis' || f.riskLevel === 'Tinggi'
  ).length;
  const findingsMedium = findings.filter((f) => f.riskLevel === 'Sedang').length;
  const findingsLow = findings.filter((f) => f.riskLevel === 'Rendah').length;
  const totalPotentialLoss = findings.reduce((s, f) => s + (f.potentialLoss || 0), 0);

  // 4. Recommendations & Follow-Ups
  const yearFindingIds = new Set(
    findingsList.filter((f) => f.year === year).map((f) => f.id)
  );
  const recommendations =
    yearFindingIds.size > 0
      ? recommendationsList.filter((r) => yearFindingIds.has(r.findingId))
      : recommendationsList;
  const recCompleted = recommendations.filter((r) => r.status === 'Selesai').length;
  const recInProgress = recommendations.filter(
    (r) => r.status === 'Dalam Proses' || r.status === 'Menunggu Verifikasi'
  ).length;
  const recNotStarted = recommendations.filter(
    (r) => r.status === 'Belum Ditindaklanjuti'
  ).length;
  const recCompletionPct =
    recommendations.length > 0
      ? Math.round((recCompleted / recommendations.length) * 100)
      : 0;

  const followUps = followUpsList.filter((fu) =>
    matchesPeriod(fu.submittedAt || fu.actionDate, year, activeMonth)
  );

  // 5. Investigations, WBS, Regulations, Risk & SPIP Context
  const investigations = investigationsList.filter((inv) =>
    matchesPeriod(inv.receiptDate || inv.createdAt, year, activeMonth)
  );
  const investigationsEstimatedLoss = investigations.reduce(
    (s, inv) => s + (inv.estimatedLoss || 0),
    0
  );

  const wbsReports = wbsReportsList.filter((w) =>
    matchesPeriod(w.createdAt, year, activeMonth, w.year)
  );
  const wbsAssignments = wbsAssignmentsList.filter((a) =>
    matchesPeriod(a.letterDate || a.createdAt, year, activeMonth, a.year)
  );
  const wbsWorkPapers = wbsWorkPapersList.filter((k) =>
    matchesPeriod(k.createdAt || k.updatedAt, year, activeMonth, k.year)
  );
  const wbsResults = wbsResultsList.filter((r) =>
    matchesPeriod(r.reportDate || r.createdAt, year, activeMonth, r.year)
  );

  const wbsAnonCount = wbsReports.filter((w) => w.identityMode === 'ANONIM').length;
  const wbsCompletedCount = wbsReports.filter(
    (w) =>
      w.status === 'Laporan Hasil Selesai' ||
      w.status === 'Tidak Terbukti / Diarsipkan' ||
      w.status === 'Menjadi Temuan 5C'
  ).length;
  const wbsInProcessCount = Math.max(0, wbsReports.length - wbsCompletedCount);
  const wbsProvenCount = wbsResults.filter((r) => r.proofConclusion !== 'Tidak Terbukti / Selesai').length;
  const wbsConvertedToFindingCount = wbsResults.filter((r) => Boolean(r.syncedToFindingId)).length;
  const wbsEstimatedLoss =
    wbsResults.length > 0
      ? wbsResults.reduce((s, r) => s + (r.potentialLoss || 0), 0)
      : wbsReports.reduce((s, w) => s + (w.estimatedLoss || 0), 0);

  const regulationsActive = regulationsList.filter((r) => r.status === 'Berlaku').length;
  const regulationsInReview = regulationsList.filter((r) => r.status === 'Dalam Review').length;

  const yearRisks = risksList.filter((r) => r.year === year);
  const risksCriticalHigh = yearRisks.filter((r) => {
    const score = r.residualScore || (r.residualLikelihood || 1) * (r.residualImpact || 1);
    return score >= 12;
  }).length;

  const bpkpYear =
    bpkpList.find((b) => b.year === year) ||
    [...bpkpList].sort((a, b) => b.year - a.year)[0];

  // 6. 12-Month Breakdown Matrix
  const monthlyBreakdown: MonthlyActivityRow[] = INDONESIAN_MONTHS.map((mName, idx) => {
    const mNum = idx + 1;
    const mAssign = assignmentsList.filter(
      (a) => matchesPeriod(a.letterDate, year, mNum) || matchesPeriod(a.startDate, year, mNum)
    ).length;
    const mKka = workPapersList.filter((w) => matchesPeriod(w.createdAt, year, mNum)).length;
    const mLha = auditReportsList.filter((r) =>
      matchesPeriod(r.reportDate || r.createdAt, year, mNum)
    ).length;
    const mFindings = findingsList.filter((f) => matchesPeriod(f.createdAt, year, mNum)).length;
    const mFuSub = followUpsList.filter((fu) =>
      matchesPeriod(fu.submittedAt || fu.actionDate, year, mNum)
    ).length;
    const mFuApp = followUpsList.filter(
      (fu) => fu.status === 'Disetujui' && matchesPeriod(fu.verifiedAt || fu.submittedAt, year, mNum)
    ).length;
    const mInv = investigationsList.filter((inv) =>
      matchesPeriod(inv.receiptDate || inv.createdAt, year, mNum)
    ).length;
    const mWbs = wbsReportsList.filter((w) =>
      matchesPeriod(w.createdAt, year, mNum)
    ).length;

    return {
      month: mNum,
      monthName: mName,
      assignmentsCount: mAssign,
      kkaCount: mKka,
      lhaCount: mLha,
      findingsCount: mFindings,
      followUpsSubmitted: mFuSub,
      followUpsApproved: mFuApp,
      investigationsCount: mInv,
      wbsReportsCount: mWbs,
    };
  });

  return {
    periodType,
    year,
    month: activeMonth,
    periodLabel,
    pkptItems,
    pkptTotal: pkptItems.length,
    pkptCompleted,
    pkptOngoing,
    pkptPlanned,
    pkptRealizationPct,
    spiPrograms,
    spiProgramsTotal: spiPrograms.length,
    spiProgramsCompleted,
    spiProgramsBudgetTotal,
    assignments,
    assignmentsTotal: assignments.length,
    assignmentsOngoing: assignments.filter((a) => a.status === 'Berlangsung').length,
    assignmentsCompleted: assignments.filter((a) => a.status === 'Selesai').length,
    pkaStepsTotal: relevantPka.length,
    pkaStepsCompleted: relevantPka.filter((s) => s.status === 'Selesai').length,
    workPapers,
    workPapersTotal: workPapers.length,
    workPapersApproved: workPapers.filter((w) => w.status === 'Approved').length,
    auditReports,
    lhaTotal: auditReports.length,
    lhaFinalCount: auditReports.filter(
      (r) => r.status === 'Final / Diterbitkan ke Direktur'
    ).length,
    findings,
    findingsTotal: findings.length,
    findingsCriticalHigh,
    findingsMedium,
    findingsLow,
    totalPotentialLoss,
    recommendations,
    recTotal: recommendations.length,
    recCompleted,
    recInProgress,
    recNotStarted,
    recCompletionPct,
    followUps,
    followUpsSubmitted: followUps.length,
    followUpsApproved: followUps.filter((f) => f.status === 'Disetujui').length,
    investigations,
    investigationsTotal: investigations.length,
    investigationsEstimatedLoss,
    wbsReports,
    wbsReportsTotal: wbsReports.length,
    wbsAnonCount,
    wbsInProcessCount,
    wbsCompletedCount,
    wbsProvenCount,
    wbsConvertedToFindingCount,
    wbsAssignmentsTotal: wbsAssignments.length,
    wbsWorkPapersTotal: wbsWorkPapers.length,
    wbsResultsTotal: wbsResults.length,
    wbsEstimatedLoss,
    regulationsActive,
    regulationsInReview,
    risksTotal: yearRisks.length,
    risksCriticalHigh,
    spipMaturityScore: bpkpYear?.spipMaturityScore || 0,
    spipMaturityLevel: bpkpYear?.spipMaturityLevel || 'Belum Dinilai',
    monthlyBreakdown,
  };
}

export function generateSpiPeriodicNarratives(
  analytics: SPIPeriodicAnalytics,
  institutionName: string
) {
  const isMonthly = analytics.periodType === 'BULANAN';
  const scopeDesc = isMonthly
    ? `periode ${analytics.periodLabel}`
    : `sepanjang Tahun Buku ${analytics.year}`;
  const nextPeriodDesc = isMonthly
    ? analytics.month === 12
      ? `Bulan Januari ${analytics.year + 1}`
      : `Bulan ${INDONESIAN_MONTHS[analytics.month || 1]} ${analytics.year}`
    : `Tahun Buku ${analytics.year + 1}`;

  return {
    executiveSummary:
      `Laporan ${isMonthly ? 'Bulanan' : 'Tahunan'} Satuan Pengawasan Intern (SPI) ${institutionName} untuk ${scopeDesc} menyajikan ikhtisar capaian pelaksanaan tugas pengawasan, evaluasi pengendalian intern, pemantauan tindak lanjut hasil audit, pengelolaan pengaduan Whistleblowing System (WBS), serta fungsi konsultansi dan investigasi.\n\n` +
      `Pada ${scopeDesc}, SPI mencatat ${analytics.assignmentsTotal} Surat Perintah Tugas (SPT) audit (${analytics.assignmentsCompleted} selesai, ${analytics.assignmentsOngoing} berlangsung), penyusunan ${analytics.workPapersTotal} Kertas Kerja Audit (KKA), dan penerbitan ${analytics.lhaTotal} Laporan Hasil Audit (LHA), serta pengelolaan ${analytics.wbsReportsTotal} pengaduan WBS (${analytics.wbsConvertedToFindingCount} terkonversi menjadi Temuan 5C). Dari hasil pengawasan tersebut teridentifikasi ${analytics.findingsTotal} temuan audit 5C dengan estimasi potensi kerugian sebesar ${formatRupiahId(analytics.totalPotentialLoss)}, sementara tingkat penyelesaian rekomendasi (TLR) mencapai ${analytics.recCompletionPct}%.`,

    pkptAndProgramRealization:
      `Pelaksanaan Program Kerja Pengawasan Tahunan (PKPT) ${isMonthly ? 'triwulan berjalan & aktif' : `Tahun ${analytics.year}`} mencatat ${analytics.pkptTotal} agenda pengawasan dengan realisasi selesai sebanyak ${analytics.pkptCompleted} kegiatan (${analytics.pkptRealizationPct}%), ${analytics.pkptOngoing} kegiatan sedang berlangsung, dan ${analytics.pkptPlanned} kegiatan dalam tahap perencanaan.\n\n` +
      `Selain tugas asurans PKPT, Program Kerja Non-Audit Kapabilitas SPI Tahun ${analytics.year} mencakup ${analytics.spiProgramsTotal} program penguatan tata kelola dan metodologi (${analytics.spiProgramsCompleted} terealisasi) dengan total alokasi anggaran sebesar ${formatRupiahId(analytics.spiProgramsBudgetTotal)}.`,

    auditExecutionSummary:
      `Sepanjang ${scopeDesc}, pelaksanaan lapangan dilakukan melalui ${analytics.assignmentsTotal} Surat Perintah Tugas (SPT) yang didukung ${analytics.pkaStepsTotal} langkah Program Kerja Audit (${analytics.pkaStepsCompleted} langkah selesai dieksekusi).\n\n` +
      `Dokumentasi pembuktian audit dituangkan dalam ${analytics.workPapersTotal} Kertas Kerja Audit (${analytics.workPapersApproved} telah berstatus Approved setelah reviu berjenjang) dan dirumuskan menjadi ${analytics.lhaTotal} Laporan Hasil Audit (${analytics.lhaFinalCount} LHA berstatus Final / Diterbitkan ke Direktur).`,

    findingsAndFollowUpSummary:
      `Pada ${scopeDesc}, tercatat ${analytics.findingsTotal} temuan audit berstruktur 5C (Condition, Criteria, Cause, Consequence, Corrective Action), terdiri dari ${analytics.findingsCriticalHigh} temuan berisiko Kritis/Tinggi, ${analytics.findingsMedium} temuan Sedang, dan ${analytics.findingsLow} temuan Rendah, dengan akumulasi potensi kerugian atau inefisiensi sebesar ${formatRupiahId(analytics.totalPotentialLoss)}.\n\n` +
      `Dari keseluruhan ${analytics.recTotal} rekomendasi audit tahun ${analytics.year}, sebanyak ${analytics.recCompleted} rekomendasi (${analytics.recCompletionPct}%) telah berstatus Selesai, ${analytics.recInProgress} dalam proses/verifikasi, dan ${analytics.recNotStarted} belum ditindaklanjuti. Pada ${scopeDesc} diterima ${analytics.followUpsSubmitted} laporan tindak lanjut unit kerja dengan ${analytics.followUpsApproved} di antaranya disetujui SPI.`,

    investigationAndComplianceSummary:
      `Dalam aspek penanganan indikasi kecurangan, Whistleblowing System (WBS), dan kepatuhan regulasi, SPI mencatat ${analytics.investigationsTotal} kasus audit investigatif (estimasi kerugian ${formatRupiahId(analytics.investigationsEstimatedLoss)}) serta ${analytics.wbsReportsTotal} pengaduan WBS masuk pada ${scopeDesc} (${analytics.wbsAnonCount} Anonim, ${analytics.wbsInProcessCount} dalam telaah/pemeriksaan, ${analytics.wbsCompletedCount} selesai diproses).\n\n` +
      `Penanganan WBS pada ${scopeDesc} meliputi penerbitan ${analytics.wbsAssignmentsTotal} Surat Tugas Penanganan WBS, penyusunan ${analytics.wbsWorkPapersTotal} Kertas Kerja WBS, dan ${analytics.wbsResultsTotal} Laporan Hasil WBS (${analytics.wbsProvenCount} terbukti, dengan ${analytics.wbsConvertedToFindingCount} di antaranya masuk ke Matriks Temuan 5C dan nilai indikasi kerugian WBS sebesar ${formatRupiahId(analytics.wbsEstimatedLoss)}).\n\n` +
      `Pada fungsi kepatuhan dan konsultansi hukum, terinventarisasi ${analytics.regulationsActive} produk hukum/SOP berstatus Berlaku dan ${analytics.regulationsInReview} regulasi sedang dalam reviu SPI. Seluruh pengawasan diselaraskan dengan peta ${analytics.risksTotal} risiko korporat (${analytics.risksCriticalHigh} risiko tinggi/ekstrem) serta skor Maturitas SPIP Terpadu sebesar ${analytics.spipMaturityScore.toFixed(2)} (${analytics.spipMaturityLevel}).`,

    constraintsAndRecommendations:
      `Kendala Pengawasan Utama:\n` +
      `1. Masih terdapat rekomendasi audit tahun berjalan (${analytics.recNotStarted + analytics.recInProgress} item) yang membutuhkan percepatan pemenuhan bukti dukung dari unit kerja terperiksa.\n` +
      `2. Kesiapan dokumen transaksi dan rekonsiliasi teknis di beberapa unit pelayanan cabang masih memerlukan standardisasi sebelum pelaksanaan uji petik lapangan.\n\n` +
      `Rekomendasi Strategis Kepala SPI kepada Direksi:\n` +
      `- Mewajibkan Kepala Bidang/Unit Pelayanan menuntaskan tindak lanjut rekomendasi berstatus Tinggi/Kritis dalam 30 hari kalender.\n` +
      `- Mengoptimalkan monitoring berkala lini pertama guna menekan temuan berulang pada siklus penagihan, kas, dan pengendalian aset distribusi.`,

    nextPeriodPlan:
      `Rencana Fokus Pengawasan SPI untuk ${nextPeriodDesc}:\n` +
      `1. Menyelesaikan ${analytics.pkptOngoing + analytics.pkptPlanned} agenda PKPT yang masih berjalan/terjadwal sesuai prioritas skor risiko tertinggi.\n` +
      `2. Melakukan verifikasi lapangan atas tindak lanjut rekomendasi unit kerja dan memfinalisasi KKA/LHA yang masih dalam proses reviu.\n` +
      `3. Memperkuat asistensi penilaian mandiri RCSA serta kesiapan pemenuhan bukti dukung evaluasi SPIP Terpadu BPKP.`,
  };
}
