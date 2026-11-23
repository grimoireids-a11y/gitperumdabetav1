import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  FileText,
  Calendar,
  Save,
  FileDown,
  Download,
  Printer,
  RefreshCw,
  CheckCircle2,
  BookOpen,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { useAppBranding } from '../../context/AppBrandingContext';
import {
  AuditAssignment,
  AuditProgramStep,
  AuditReport,
  BPKPSelfAssessment,
  Finding,
  FollowUp,
  Investigation,
  OfficialSignatory,
  PKPT,
  Recommendation,
  Regulation,
  RiskRegister,
  SPIPeriodicReport,
  SPIPeriodicReportStatus,
  SPIPeriodicType,
  SPIProgram,
  WBSAssignment,
  WBSReport,
  WBSResultReport,
  WBSWorkPaper,
  WorkPaper,
} from '../../types/audit';
import {
  INDONESIAN_MONTHS,
  buildSpiPeriodicAnalytics,
  generateSpiPeriodicNarratives,
} from '../../lib/spiPeriodicAnalytics';
import { formatPkptExecutionSchedule } from '../../lib/featureCatalog';
import { formatRupiahId } from '../../lib/riskAnalytics';
import { downloadSpiPeriodicReportPdf } from '../../lib/spiPeriodicReportPdfGenerator';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';
import { INITIAL_OFFICIALS } from '../../data/initialData';

type PeriodicSectionKey = 'all' | 'identitas' | 'bab1' | 'bab2' | 'bab3' | 'bab4' | 'bab5' | 'bab6';

const PERIODIC_SECTIONS: Array<{ key: PeriodicSectionKey; code: string; title: string }> = [
  { key: 'identitas', code: 'SAMPUL', title: 'Identitas & Pengendalian Laporan' },
  { key: 'bab1', code: 'BAB I', title: 'Ringkasan Eksekutif & KPI SPI' },
  { key: 'bab2', code: 'BAB II', title: 'Realisasi PKPT & Program Non-Audit' },
  { key: 'bab3', code: 'BAB III', title: 'Pelaksanaan SPT, KKA & LHA' },
  { key: 'bab4', code: 'BAB IV', title: 'Temuan 5C & Tindak Lanjut (TLR)' },
  { key: 'bab5', code: 'BAB V', title: 'Investigasi, Regulasi & Risiko SPIP' },
  { key: 'bab6', code: 'BAB VI', title: 'Kendala, Rencana Kerja & Pengesahan' },
];

export const SPIPeriodicReportModule: React.FC = () => {
  const { userProfile, hasRole } = useAuth();
  const { activeYear, availableYears } = useFiscalYear();
  const { branding } = useAppBranding();

  const canApprove = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);
  const isViewer = userProfile?.role === 'VIEWER';
  const canEdit = !isViewer;

  const [periodType, setPeriodType] = useState<SPIPeriodicType>('BULANAN');
  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [activeSection, setActiveSection] = useState<PeriodicSectionKey>('all');

  // Firestore data states
  const [pkptList, setPkptList] = useState<PKPT[]>([]);
  const [spiProgramsList, setSpiProgramsList] = useState<SPIProgram[]>([]);
  const [assignmentsList, setAssignmentsList] = useState<AuditAssignment[]>([]);
  const [auditProgramsList, setAuditProgramsList] = useState<AuditProgramStep[]>([]);
  const [workPapersList, setWorkPapersList] = useState<WorkPaper[]>([]);
  const [auditReportsList, setAuditReportsList] = useState<AuditReport[]>([]);
  const [findingsList, setFindingsList] = useState<Finding[]>([]);
  const [recommendationsList, setRecommendationsList] = useState<Recommendation[]>([]);
  const [followUpsList, setFollowUpsList] = useState<FollowUp[]>([]);
  const [investigationsList, setInvestigationsList] = useState<Investigation[]>([]);
  const [regulationsList, setRegulationsList] = useState<Regulation[]>([]);
  const [risksList, setRisksList] = useState<RiskRegister[]>([]);
  const [bpkpList, setBpkpList] = useState<BPKPSelfAssessment[]>([]);
  const [wbsReportsList, setWbsReportsList] = useState<WBSReport[]>([]);
  const [wbsAssignmentsList, setWbsAssignmentsList] = useState<WBSAssignment[]>([]);
  const [wbsWorkPapersList, setWbsWorkPapersList] = useState<WBSWorkPaper[]>([]);
  const [wbsResultsList, setWbsResultsList] = useState<WBSResultReport[]>([]);
  const [savedReports, setSavedReports] = useState<SPIPeriodicReport[]>([]);
  const [officials, setOfficials] = useState<OfficialSignatory[]>(INITIAL_OFFICIALS);

  // Form states
  const [reportNumber, setReportNumber] = useState('');
  const [reportTitle, setReportTitle] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [recipient, setRecipient] = useState('');
  const [status, setStatus] = useState<SPIPeriodicReportStatus>('Draft');

  const [executiveSummary, setExecutiveSummary] = useState('');
  const [pkptAndProgramRealization, setPkptAndProgramRealization] = useState('');
  const [auditExecutionSummary, setAuditExecutionSummary] = useState('');
  const [findingsAndFollowUpSummary, setFindingsAndFollowUpSummary] = useState('');
  const [investigationAndComplianceSummary, setInvestigationAndComplianceSummary] = useState('');
  const [constraintsAndRecommendations, setConstraintsAndRecommendations] = useState('');
  const [nextPeriodPlan, setNextPeriodPlan] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        collection(db, 'pkpt'),
        (s) => setPkptList(s.docs.map((d) => ({ id: d.id, ...d.data() } as PKPT))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'pkpt')
      ),
      onSnapshot(
        collection(db, 'spi_programs'),
        (s) => setSpiProgramsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as SPIProgram))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'spi_programs')
      ),
      onSnapshot(
        collection(db, 'audit_assignments'),
        (s) => setAssignmentsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as AuditAssignment))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'audit_assignments')
      ),
      onSnapshot(
        collection(db, 'audit_programs'),
        (s) => setAuditProgramsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as AuditProgramStep))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'audit_programs')
      ),
      onSnapshot(
        collection(db, 'work_papers'),
        (s) => setWorkPapersList(s.docs.map((d) => ({ id: d.id, ...d.data() } as WorkPaper))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'work_papers')
      ),
      onSnapshot(
        collection(db, 'audit_reports'),
        (s) => setAuditReportsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as AuditReport))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'audit_reports')
      ),
      onSnapshot(
        collection(db, 'findings'),
        (s) => setFindingsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as Finding))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'findings')
      ),
      onSnapshot(
        collection(db, 'recommendations'),
        (s) => setRecommendationsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as Recommendation))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'recommendations')
      ),
      onSnapshot(
        collection(db, 'follow_ups'),
        (s) => setFollowUpsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as FollowUp))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'follow_ups')
      ),
      onSnapshot(
        collection(db, 'investigations'),
        (s) => setInvestigationsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as Investigation))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'investigations')
      ),
      onSnapshot(
        collection(db, 'regulations'),
        (s) => setRegulationsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as Regulation))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'regulations')
      ),
      onSnapshot(
        collection(db, 'risk_registers'),
        (s) => setRisksList(s.docs.map((d) => ({ id: d.id, ...d.data() } as RiskRegister))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'risk_registers')
      ),
      onSnapshot(
        collection(db, 'bpkp_assessments'),
        (s) => setBpkpList(s.docs.map((d) => ({ id: d.id, ...d.data() } as BPKPSelfAssessment))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'bpkp_assessments')
      ),
      onSnapshot(
        collection(db, 'wbs_reports'),
        (s) => setWbsReportsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSReport))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_reports')
      ),
      onSnapshot(
        collection(db, 'wbs_assignments'),
        (s) => setWbsAssignmentsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSAssignment))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_assignments')
      ),
      onSnapshot(
        collection(db, 'wbs_work_papers'),
        (s) => setWbsWorkPapersList(s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSWorkPaper))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_work_papers')
      ),
      onSnapshot(
        collection(db, 'wbs_results'),
        (s) => setWbsResultsList(s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSResultReport))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_results')
      ),
      onSnapshot(
        collection(db, 'spi_periodic_reports'),
        (s) => setSavedReports(s.docs.map((d) => ({ id: d.id, ...d.data() } as SPIPeriodicReport))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'spi_periodic_reports')
      ),
      onSnapshot(
        collection(db, 'signatories'),
        (s) => {
          if (!s.empty) {
            const list = s.docs.map((d) => ({ id: d.id, ...d.data() } as OfficialSignatory));
            list.sort((a, b) => (a.order || 99) - (b.order || 99));
            setOfficials(list);
          }
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'signatories')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  const currentDocId = useMemo(() => {
    return periodType === 'BULANAN'
      ? `spi-bulanan-${selectedYear}-${String(selectedMonth).padStart(2, '0')}`
      : `spi-tahunan-${selectedYear}`;
  }, [periodType, selectedYear, selectedMonth]);

  const currentSavedReport = useMemo(() => {
    return savedReports.find((r) => r.id === currentDocId) || null;
  }, [savedReports, currentDocId]);

  const analytics = useMemo(
    () =>
      buildSpiPeriodicAnalytics({
        periodType,
        year: selectedYear,
        month: periodType === 'BULANAN' ? selectedMonth : undefined,
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
        wbsReportsList,
        wbsAssignmentsList,
        wbsWorkPapersList,
        wbsResultsList,
      }),
    [
      periodType,
      selectedYear,
      selectedMonth,
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
      wbsReportsList,
      wbsAssignmentsList,
      wbsWorkPapersList,
      wbsResultsList,
    ]
  );

  const institutionName =
    branding.institutionName || 'Perumda Air Minum Tirta Saiyo Kabupaten Pasaman';

  const applyGeneratedNarratives = () => {
    const gen = generateSpiPeriodicNarratives(analytics, institutionName);
    setExecutiveSummary(gen.executiveSummary);
    setPkptAndProgramRealization(gen.pkptAndProgramRealization);
    setAuditExecutionSummary(gen.auditExecutionSummary);
    setFindingsAndFollowUpSummary(gen.findingsAndFollowUpSummary);
    setInvestigationAndComplianceSummary(gen.investigationAndComplianceSummary);
    setConstraintsAndRecommendations(gen.constraintsAndRecommendations);
    setNextPeriodPlan(gen.nextPeriodPlan);
  };

  useEffect(() => {
    const todayFmt = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());

    if (currentSavedReport) {
      setReportNumber(currentSavedReport.reportNumber);
      setReportTitle(currentSavedReport.reportTitle);
      setReportDate(currentSavedReport.reportDate);
      setPreparedBy(currentSavedReport.preparedBy);
      setRecipient(currentSavedReport.recipient);
      setStatus(currentSavedReport.status);
      setExecutiveSummary(currentSavedReport.executiveSummary);
      setPkptAndProgramRealization(currentSavedReport.pkptAndProgramRealization);
      setAuditExecutionSummary(currentSavedReport.auditExecutionSummary);
      setFindingsAndFollowUpSummary(currentSavedReport.findingsAndFollowUpSummary);
      setInvestigationAndComplianceSummary(currentSavedReport.investigationAndComplianceSummary);
      setConstraintsAndRecommendations(currentSavedReport.constraintsAndRecommendations);
      setNextPeriodPlan(currentSavedReport.nextPeriodPlan);
    } else {
      const mStr = String(selectedMonth).padStart(2, '0');
      const mName = INDONESIAN_MONTHS[selectedMonth - 1];
      setReportNumber(
        periodType === 'BULANAN'
          ? `LAP-SPI-BLN/PTS/${mStr}/${selectedYear}`
          : `LAP-SPI-THN/PTS/${selectedYear}`
      );
      setReportTitle(
        periodType === 'BULANAN'
          ? `LAPORAN BULANAN KEGIATAN PENGAWASAN SPI — BULAN ${mName.toUpperCase()} ${selectedYear}`
          : `LAPORAN TAHUNAN KEGIATAN PENGAWASAN SPI — TAHUN BUKU ${selectedYear}`
      );
      setReportDate(todayFmt);
      setPreparedBy(userProfile?.displayName || 'Kepala Satuan Pengawasan Intern');
      setRecipient(
        `Direktur & Dewan Pengawas ${branding.shortInstitutionName || 'Perumda Tirta Saiyo'}`
      );
      setStatus('Draft');
      applyGeneratedNarratives();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSavedReport?.id, currentDocId]);

  const yearOptions = useMemo(() => {
    const docYears = [
      ...pkptList.map((p) => p.year),
      ...findingsList.map((f) => f.year),
      ...savedReports.map((r) => r.year),
    ].filter((y) => typeof y === 'number' && y > 0);
    return Array.from(new Set([...availableYears, ...docYears])).sort((a, b) => b - a);
  }, [availableYears, pkptList, findingsList, savedReports]);

  const resolvedSignatories = useMemo(() => {
    const findByPos = (kw: string) =>
      officials.find((o) => o.position.toLowerCase().includes(kw.toLowerCase()));
    return {
      kepalaSpi: findByPos('kepala satuan pengawasan') || findByPos('kepala spi') || officials[0],
      direktur: findByPos('direktur') || officials[1],
      dewas: findByPos('dewan pengawas') || officials[2],
      location: 'Lubuk Sikaping',
    };
  }, [officials]);

  const buildReportPayload = (overrideStatus?: SPIPeriodicReportStatus): SPIPeriodicReport => {
    const nowIso = new Date().toISOString();
    const nextStatus = overrideStatus || status;
    return {
      id: currentDocId,
      periodType,
      year: selectedYear,
      ...(periodType === 'BULANAN' ? { month: selectedMonth } : {}),
      reportNumber: reportNumber.trim() || currentDocId.toUpperCase(),
      reportTitle: reportTitle.trim() || `Laporan SPI ${analytics.periodLabel}`,
      reportDate: reportDate.trim() || new Date().toISOString().slice(0, 10),
      preparedBy: preparedBy.trim() || 'Kepala SPI',
      recipient: recipient.trim() || 'Direktur & Dewan Pengawas',
      executiveSummary,
      pkptAndProgramRealization,
      auditExecutionSummary,
      findingsAndFollowUpSummary,
      investigationAndComplianceSummary,
      constraintsAndRecommendations,
      nextPeriodPlan,
      status: nextStatus,
      approvedBy:
        nextStatus === 'Disahkan & Disampaikan ke Direksi'
          ? userProfile?.displayName || 'Kepala SPI'
          : currentSavedReport?.approvedBy,
      approvedAt:
        nextStatus === 'Disahkan & Disampaikan ke Direksi'
          ? nowIso
          : currentSavedReport?.approvedAt,
      createdBy: currentSavedReport?.createdBy || userProfile?.displayName || 'Kepala SPI',
      createdAt: currentSavedReport?.createdAt || nowIso,
      updatedAt: nowIso,
    };
  };

  const handleSaveReport = async (overrideStatus?: SPIPeriodicReportStatus) => {
    if (!canEdit) return;
    setIsSaving(true);
    setNotice(null);
    const payload = buildReportPayload(overrideStatus);
    try {
      await setDoc(doc(db, 'spi_periodic_reports', payload.id), payload, { merge: true });
      if (overrideStatus) setStatus(overrideStatus);
      setNotice(
        `Laporan ${periodType === 'BULANAN' ? 'Bulanan' : 'Tahunan'} SPI (${payload.reportNumber}) berhasil disimpan ke Firebase.`
      );
      setTimeout(() => setNotice(null), 5000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `spi_periodic_reports/${payload.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncNarratives = () => {
    if (!canEdit) return;
    applyGeneratedNarratives();
    setNotice(`Narasi laporan ${analytics.periodLabel} disinkronkan dari data operasional SPI terbaru.`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleDownloadPdf = () => {
    const filename = downloadSpiPeriodicReportPdf({
      report: buildReportPayload(),
      analytics,
      branding,
      signatories: resolvedSignatories,
    });
    setNotice(`File PDF berhasil diunduh: ${filename}`);
    setTimeout(() => setNotice(null), 5000);
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          'Nomor Laporan': reportNumber,
          'Jenis Laporan': periodType,
          Periode: analytics.periodLabel,
          Status: status,
          'PKPT Selesai': `${analytics.pkptCompleted}/${analytics.pkptTotal} (${analytics.pkptRealizationPct}%)`,
          'SPT Audit': analytics.assignmentsTotal,
          'KKA Disusun': analytics.workPapersTotal,
          'LHA Terbit': analytics.lhaTotal,
          'Temuan 5C': analytics.findingsTotal,
          'Potensi Kerugian': analytics.totalPotentialLoss,
          'Penyelesaian TLR (%)': analytics.recCompletionPct,
          'Kasus Investigasi': analytics.investigationsTotal,
          'Pengaduan WBS Masuk': analytics.wbsReportsTotal,
          'WBS Jadi Temuan 5C': analytics.wbsConvertedToFindingCount,
        },
      ]),
      'Ikhtisar Pengawasan'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.pkptItems.map((p) => ({
          Judul: p.title,
          Unit: p.unitName,
          Jenis: p.auditType,
          'Bulan Berjalan': formatPkptExecutionSchedule(p),
          'Skor Prioritas': p.priorityScore || p.riskScore,
          Status: p.status,
        }))
      ),
      'Realisasi PKPT'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.assignments.map((a) => ({
          'No. SPT': a.letterNumber,
          Tanggal: a.letterDate,
          'Objek Audit': a.objectName,
          Unit: a.unitName,
          'Ketua Tim': a.teamLeader,
          Status: a.status,
        }))
      ),
      'Surat Tugas & LHA'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.findings.map((f) => ({
          'No. Temuan': f.findingNumber,
          Unit: f.unitName,
          Judul: f.title,
          Sumber: f.sourceType || 'AUDIT_REGULER',
          Risiko: f.riskLevel,
          'Potensi Kerugian': f.potentialLoss || 0,
          Status: f.status,
        }))
      ),
      'Temuan Audit 5C'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.wbsReports.map((w) => ({
          'Nomor Tiket': w.ticketNumber,
          'Mode Identitas': w.identityMode,
          Kategori: w.category,
          Judul: w.title,
          'Unit Terlapor': w.reportedUnitName,
          Status: w.status,
          'No. ST WBS': w.linkedAssignmentNumber || '-',
          'Temuan 5C': w.linkedFindingNumber || '-',
          'Tanggal Masuk': w.createdAt.slice(0, 10),
        }))
      ),
      'Rekap Pengaduan WBS'
    );

    if (periodType === 'TAHUNAN') {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          analytics.monthlyBreakdown.map((m) => ({
            Bulan: m.monthName,
            'SPT Audit': m.assignmentsCount,
            KKA: m.kkaCount,
            LHA: m.lhaCount,
            'Temuan 5C': m.findingsCount,
            'TLR Masuk': m.followUpsSubmitted,
            'TLR Disetujui': m.followUpsApproved,
            Investigasi: m.investigationsCount,
            'Pengaduan WBS': m.wbsReportsCount,
          }))
        ),
        'Rekap Bulanan Jan-Des'
      );
    }

    const slug =
      periodType === 'BULANAN'
        ? `Bulanan_${String(selectedMonth).padStart(2, '0')}_${selectedYear}`
        : `Tahunan_${selectedYear}`;
    XLSX.writeFile(wb, `Laporan_SPI_${slug}.xlsx`);
  };

  const showSection = (key: Exclude<PeriodicSectionKey, 'all'>) =>
    activeSection === 'all' || activeSection === key;

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium mb-1">
              <span className="font-mono">{reportNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{analytics.periodLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-emerald-800">{status}</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-700 shrink-0" />
              <span>Laporan SPI Bulanan &amp; Tahunan</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Konsolidasi berkala realisasi PKPT, program kapabilitas SPI, surat tugas (SPT), KKA, LHA, temuan 5C, tindak lanjut rekomendasi, dan investigasi.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Segmented Mode Toggle: Bulanan vs Tahunan */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              <button
                type="button"
                onClick={() => setPeriodType('BULANAN')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  periodType === 'BULANAN'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Laporan Bulanan
              </button>
              <button
                type="button"
                onClick={() => setPeriodType('TAHUNAN')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  periodType === 'TAHUNAN'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Laporan Tahunan
              </button>
            </div>

            {periodType === 'BULANAN' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value, 10))}
                  className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
                  aria-label="Pilih Bulan Laporan SPI"
                >
                  {INDONESIAN_MONTHS.map((m, idx) => (
                    <option key={m} value={idx + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
                className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
                aria-label="Pilih Tahun Laporan SPI"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    Tahun {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="text-xs text-slate-500">
            {currentSavedReport?.updatedAt
              ? `Tersimpan di database (${new Date(currentSavedReport.updatedAt).toLocaleString('id-ID')})`
              : 'Draf otomatis disusun dari data real-time periode aktif.'}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={handleSyncNarratives}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Sinkronkan Narasi</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSaveReport()}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Menyimpan...' : 'Simpan Laporan'}</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleDownloadPdf}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Unduh PDF</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              <span>Excel</span>
            </button>

            <button
              type="button"
              onClick={() => setIsPrintModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Pratinjau Cetak</span>
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-semibold text-emerald-700 hover:text-emerald-950"
          >
            Tutup
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Realisasi PKPT</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.pkptRealizationPct}%
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.pkptCompleted} dari {analytics.pkptTotal} agenda
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">SPT Audit</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.assignmentsTotal}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.assignmentsCompleted} selesai · {analytics.assignmentsOngoing} berjalan
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">KKA &amp; LHA</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.workPapersTotal} <span className="text-slate-400 text-base">/</span>{' '}
            <span className="text-emerald-700">{analytics.lhaTotal}</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.workPapersApproved} KKA Approved · {analytics.lhaFinalCount} LHA Final
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Temuan Audit 5C</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.findingsTotal}
          </p>
          <p className="text-[11px] text-rose-700 font-medium mt-1 tabular-nums">
            {analytics.findingsCriticalHigh} Kritis/Tinggi
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Penyelesaian TLR</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1 tabular-nums">
            {analytics.recCompletionPct}%
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.recCompleted}/{analytics.recTotal} rekomendasi
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">WBS &amp; Investigasi</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.wbsReportsTotal} <span className="text-slate-400 text-base">/</span>{' '}
            <span className="text-indigo-700">{analytics.investigationsTotal}</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.wbsConvertedToFindingCount} WBS ke 5C · SPIP {analytics.spipMaturityScore.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Navigation & Saved Reports */}
        <aside className="lg:col-span-3 space-y-4 lg:sticky lg:top-20">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="border-b border-slate-100 pb-2.5">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5 text-emerald-700" />
                <span>Sistematika Laporan</span>
              </h3>
            </div>

            <button
              type="button"
              onClick={() => setActiveSection('all')}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                activeSection === 'all'
                  ? 'bg-emerald-700 text-white'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              Tampilkan Semua Bab (Utuh)
            </button>

            <div className="space-y-1">
              {PERIODIC_SECTIONS.map((sec) => (
                <button
                  key={sec.key}
                  type="button"
                  onClick={() => setActiveSection(sec.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer ${
                    activeSection === sec.key
                      ? 'bg-emerald-50 text-emerald-950 border border-emerald-200 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-[10px] font-mono text-emerald-700 font-semibold">
                    {sec.code}
                  </span>
                  <span className="block leading-snug">{sec.title}</span>
                </button>
              ))}
            </div>
          </div>

          {savedReports.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
              <h4 className="text-xs font-bold text-slate-900">Arsip Tersimpan ({savedReports.length})</h4>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {[...savedReports]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((sr) => (
                    <button
                      key={sr.id}
                      type="button"
                      onClick={() => {
                        setPeriodType(sr.periodType);
                        setSelectedYear(sr.year);
                        if (sr.periodType === 'BULANAN' && sr.month) {
                          setSelectedMonth(sr.month);
                        }
                      }}
                      className={`w-full text-left px-2.5 py-2 rounded-lg border text-[11px] cursor-pointer ${
                        sr.id === currentDocId
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-950 font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span className="block font-mono font-semibold">{sr.reportNumber}</span>
                      <span className="block text-[10px] text-slate-500">
                        {sr.periodType === 'BULANAN' && sr.month
                          ? `${INDONESIAN_MONTHS[sr.month - 1]} ${sr.year}`
                          : `Tahunan ${sr.year}`}{' '}
                        · {sr.status}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </aside>

        {/* Right Structured Report Sections */}
        <div className="lg:col-span-9 space-y-6">
          {/* IDENTITAS */}
          {showSection('identitas') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-200 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">SAMPUL &amp; IDENTITAS</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Pengendalian Laporan {periodType === 'BULANAN' ? 'Bulanan' : 'Tahunan'} SPI
                  </h3>
                </div>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SPIPeriodicReportStatus)}
                  disabled={!canApprove}
                  className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50 text-slate-900 disabled:opacity-60"
                >
                  <option value="Draft">Draft</option>
                  <option value="Review Kepala SPI">Review Kepala SPI</option>
                  <option value="Disahkan & Disampaikan ke Direksi">
                    Disahkan &amp; Disampaikan ke Direksi
                  </option>
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="md:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Judul Laporan</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={reportTitle}
                    onChange={(e) => setReportTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-semibold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nomor Laporan</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={reportNumber}
                    onChange={(e) => setReportNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Laporan</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Disusun Oleh</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={preparedBy}
                    onChange={(e) => setPreparedBy(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Disampaikan Kepada</label>
                  <input
                    type="text"
                    readOnly={!canEdit}
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-slate-900"
                  />
                </div>
              </div>
            </section>
          )}

          {/* BAB I */}
          {showSection('bab1') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB I</p>
                <h3 className="text-base font-bold text-slate-900">
                  Ringkasan Eksekutif &amp; Capaian Kinerja Pengawasan ({analytics.periodLabel})
                </h3>
              </div>
              <textarea
                rows={6}
                readOnly={!canEdit}
                value={executiveSummary}
                onChange={(e) => setExecutiveSummary(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
              />
            </section>
          )}

          {/* BAB II */}
          {showSection('bab2') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB II</p>
                <h3 className="text-base font-bold text-slate-900">
                  Realisasi PKPT &amp; Program Kerja Tahunan Kapabilitas SPI
                </h3>
              </div>

              <textarea
                rows={5}
                readOnly={!canEdit}
                value={pkptAndProgramRealization}
                onChange={(e) => setPkptAndProgramRealization(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2 px-3 font-semibold">Judul Pengawasan PKPT</th>
                      <th className="py-2 px-3 font-semibold">Unit / Auditee</th>
                      <th className="py-2 px-3 font-semibold">Jenis</th>
                      <th className="py-2 px-3 font-semibold text-center">Bulan Berjalan</th>
                      <th className="py-2 px-3 font-semibold text-right">Prioritas</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.pkptItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-4 px-3 text-center text-slate-500">
                          Belum ada agenda PKPT pada periode ini.
                        </td>
                      </tr>
                    ) : (
                      analytics.pkptItems.map((p) => (
                        <tr key={p.id}>
                          <td className="py-2 px-3 font-medium text-slate-900">{p.title}</td>
                          <td className="py-2 px-3 text-slate-700">{p.unitName}</td>
                          <td className="py-2 px-3 text-slate-600">{p.auditType}</td>
                          <td className="py-2 px-3 text-center font-mono">{formatPkptExecutionSchedule(p)}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {p.priorityScore || p.riskScore || 0}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">{p.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* BAB III */}
          {showSection('bab3') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB III</p>
                <h3 className="text-base font-bold text-slate-900">
                  Pelaksanaan Audit: Surat Perintah Tugas (SPT), KKA &amp; Laporan Hasil Audit (LHA)
                </h3>
              </div>

              <textarea
                rows={5}
                readOnly={!canEdit}
                value={auditExecutionSummary}
                onChange={(e) => setAuditExecutionSummary(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
              />

              {periodType === 'TAHUNAN' && (
                <div>
                  <h4 className="text-xs font-bold text-slate-800 mb-2">
                    Rekapitulasi Aktivitas Bulanan SPI Tahun {selectedYear} (Januari – Desember)
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <th className="py-2 px-3 font-semibold">Bulan</th>
                          <th className="py-2 px-3 font-semibold text-right">SPT</th>
                          <th className="py-2 px-3 font-semibold text-right">KKA</th>
                          <th className="py-2 px-3 font-semibold text-right">LHA</th>
                          <th className="py-2 px-3 font-semibold text-right">Temuan 5C</th>
                          <th className="py-2 px-3 font-semibold text-right">TLR Masuk</th>
                          <th className="py-2 px-3 font-semibold text-right">TLR Disetujui</th>
                          <th className="py-2 px-3 font-semibold text-right">Investigasi</th>
                          <th className="py-2 px-3 font-semibold text-right">WBS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analytics.monthlyBreakdown.map((m) => (
                          <tr key={m.month} className="hover:bg-slate-50/70">
                            <td className="py-2 px-3 font-medium text-slate-900">{m.monthName}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{m.assignmentsCount}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{m.kkaCount}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-emerald-700">{m.lhaCount}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{m.findingsCount}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{m.followUpsSubmitted}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{m.followUpsApproved}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{m.investigationsCount}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-indigo-700">{m.wbsReportsCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 mb-2">
                    Surat Perintah Tugas (SPT) Periode Ini ({analytics.assignmentsTotal})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <th className="py-2 px-2.5 font-semibold">No. SPT</th>
                          <th className="py-2 px-2.5 font-semibold">Objek &amp; Unit</th>
                          <th className="py-2 px-2.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analytics.assignments.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-4 px-2.5 text-center text-slate-500">
                              Tidak ada SPT pada periode ini.
                            </td>
                          </tr>
                        ) : (
                          analytics.assignments.map((a) => (
                            <tr key={a.id}>
                              <td className="py-2 px-2.5 font-mono font-semibold whitespace-nowrap">
                                {a.letterNumber}
                              </td>
                              <td className="py-2 px-2.5 text-slate-800">
                                {a.objectName} · {a.unitName}
                              </td>
                              <td className="py-2 px-2.5 font-semibold">{a.status}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-800 mb-2">
                    Laporan Hasil Audit (LHA) Terbit ({analytics.lhaTotal})
                  </h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <th className="py-2 px-2.5 font-semibold">No. LHA</th>
                          <th className="py-2 px-2.5 font-semibold">Judul &amp; Opini</th>
                          <th className="py-2 px-2.5 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analytics.auditReports.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-4 px-2.5 text-center text-slate-500">
                              Belum ada LHA terbit pada periode ini.
                            </td>
                          </tr>
                        ) : (
                          analytics.auditReports.map((r) => (
                            <tr key={r.id}>
                              <td className="py-2 px-2.5 font-mono font-semibold whitespace-nowrap">
                                {r.reportNumber}
                              </td>
                              <td className="py-2 px-2.5 text-slate-800">
                                <span className="font-medium block">{r.auditTitle}</span>
                                <span className="text-slate-500">{r.auditOpinion}</span>
                              </td>
                              <td className="py-2 px-2.5 font-semibold">{r.status}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* BAB IV */}
          {showSection('bab4') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB IV</p>
                <h3 className="text-base font-bold text-slate-900">
                  Temuan Audit 5C, Potensi Kerugian &amp; Tindak Lanjut Rekomendasi
                </h3>
              </div>

              <textarea
                rows={5}
                readOnly={!canEdit}
                value={findingsAndFollowUpSummary}
                onChange={(e) => setFindingsAndFollowUpSummary(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
              />

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2 px-3 font-semibold">No. Temuan</th>
                      <th className="py-2 px-3 font-semibold">Unit Kerja</th>
                      <th className="py-2 px-3 font-semibold">Judul Temuan</th>
                      <th className="py-2 px-3 font-semibold">Risiko</th>
                      <th className="py-2 px-3 font-semibold text-right">Potensi Kerugian</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.findings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-4 px-3 text-center text-slate-500">
                          Tidak ada temuan audit baru pada periode ini.
                        </td>
                      </tr>
                    ) : (
                      analytics.findings.map((f) => (
                        <tr key={f.id}>
                          <td className="py-2 px-3 font-mono font-semibold whitespace-nowrap">
                            {f.findingNumber}
                          </td>
                          <td className="py-2 px-3 text-slate-700">{f.unitName}</td>
                          <td className="py-2 px-3 font-medium text-slate-900">{f.title}</td>
                          <td className="py-2 px-3 font-semibold">{f.riskLevel}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {formatRupiahId(f.potentialLoss || 0)}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800">{f.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* BAB V */}
          {showSection('bab5') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB V</p>
                <h3 className="text-base font-bold text-slate-900">
                  Audit Investigatif, Kepatuhan Produk Hukum &amp; Konteks Risiko / SPIP
                </h3>
              </div>

              <textarea
                rows={5}
                readOnly={!canEdit}
                value={investigationAndComplianceSummary}
                onChange={(e) => setInvestigationAndComplianceSummary(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
              />

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 text-xs tabular-nums">
                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-slate-500 font-medium">Whistleblowing System (WBS)</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {analytics.wbsReportsTotal} Laporan
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    {analytics.wbsAssignmentsTotal} ST · {analytics.wbsWorkPapersTotal} KKA · {analytics.wbsConvertedToFindingCount} ke 5C
                  </p>
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-slate-500 font-medium">Audit Investigatif Periode Ini</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {analytics.investigationsTotal} Kasus
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Estimasi kerugian: {formatRupiahId(analytics.investigationsEstimatedLoss)}
                  </p>
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-slate-500 font-medium">Kepatuhan &amp; Produk Hukum</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {analytics.regulationsActive} Berlaku
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    {analytics.regulationsInReview} regulasi dalam review SPI
                  </p>
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-slate-500 font-medium">Risiko Korporat &amp; SPIP</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {analytics.risksTotal} Risiko · SPIP {analytics.spipMaturityScore.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    {analytics.risksCriticalHigh} risiko tinggi/ekstrem ({analytics.spipMaturityLevel})
                  </p>
                </div>
              </div>

              {analytics.wbsReports.length > 0 && (
                <div className="overflow-x-auto pt-2">
                  <h4 className="text-xs font-bold text-slate-800 mb-2">
                    Rekapitulasi Pengelolaan Whistleblowing System (WBS) Periode {analytics.periodLabel}
                  </h4>
                  <table className="w-full text-left text-xs border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3 font-semibold">No. Tiket</th>
                        <th className="py-2 px-3 font-semibold">Identitas</th>
                        <th className="py-2 px-3 font-semibold">Judul &amp; Unit</th>
                        <th className="py-2 px-3 font-semibold">Status WBS</th>
                        <th className="py-2 px-3 font-semibold">Surat Tugas / Temuan 5C</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analytics.wbsReports.map((w) => (
                        <tr key={w.id}>
                          <td className="py-2 px-3 font-mono font-semibold whitespace-nowrap">
                            {w.ticketNumber}
                          </td>
                          <td className="py-2 px-3">{w.identityMode}</td>
                          <td className="py-2 px-3">
                            <span className="font-medium text-slate-900 block">{w.title}</span>
                            <span className="text-slate-500">{w.reportedUnitName}</span>
                          </td>
                          <td className="py-2 px-3 font-semibold">{w.status}</td>
                          <td className="py-2 px-3 font-mono text-[11px]">
                            {w.linkedAssignmentNumber || '-'}
                            {w.linkedFindingNumber ? ` · ${w.linkedFindingNumber}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* BAB VI */}
          {showSection('bab6') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB VI</p>
                <h3 className="text-base font-bold text-slate-900">
                  Kendala Pengawasan, Rekomendasi Strategis, Rencana Kerja &amp; Pengesahan
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  6.1 Kendala Pengawasan &amp; Rekomendasi Strategis kepada Direksi
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={constraintsAndRecommendations}
                  onChange={(e) => setConstraintsAndRecommendations(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  6.2 Rencana Fokus Pengawasan Periode Berikutnya
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={nextPeriodPlan}
                  onChange={(e) => setNextPeriodPlan(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              {canApprove && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => handleSaveReport('Disahkan & Disampaikan ke Direksi')}
                    disabled={isSaving}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                  >
                    Sahkan &amp; Sampaikan ke Direksi
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Print Preview Modal */}
      {isPrintModalOpen && (
        <DocumentPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          documentTitle={reportTitle}
          documentSubtitle={`${institutionName} · ${analytics.periodLabel}`}
          documentNumber={reportNumber}
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
          defaultShowSignatory2={true}
          defaultShowSignatory3={true}
        >
          {() => (
            <div className="space-y-5 text-xs text-slate-900 leading-relaxed">
              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-1.5">
                  BAB I — Ringkasan Eksekutif Pengawasan SPI
                </h4>
                <p className="whitespace-pre-line text-justify">{executiveSummary}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-1.5">
                  BAB II — Realisasi PKPT &amp; Program Kapabilitas SPI
                </h4>
                <p className="whitespace-pre-line text-justify">{pkptAndProgramRealization}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-1.5">
                  BAB III — Pelaksanaan Audit (SPT, KKA &amp; LHA)
                </h4>
                <p className="whitespace-pre-line text-justify">{auditExecutionSummary}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-1.5">
                  BAB IV — Temuan Audit 5C &amp; Tindak Lanjut Rekomendasi
                </h4>
                <p className="whitespace-pre-line text-justify">{findingsAndFollowUpSummary}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-1.5">
                  BAB V — Audit Investigatif, Kepatuhan &amp; Risiko SPIP
                </h4>
                <p className="whitespace-pre-line text-justify">{investigationAndComplianceSummary}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-1.5">
                  BAB VI — Kendala, Rekomendasi &amp; Rencana Periode Berikutnya
                </h4>
                <p className="whitespace-pre-line text-justify mb-2">{constraintsAndRecommendations}</p>
                <p className="whitespace-pre-line text-justify">{nextPeriodPlan}</p>
              </div>
            </div>
          )}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
