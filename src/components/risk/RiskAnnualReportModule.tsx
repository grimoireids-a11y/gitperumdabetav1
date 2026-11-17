import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  FileBarChart2,
  Lock,
  Save,
  FileDown,
  Download,
  Printer,
  RefreshCw,
  CheckCircle2,
  Calendar,
  BookOpen,
  ShieldAlert,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { useAppBranding } from '../../context/AppBrandingContext';
import {
  BPKPSelfAssessment,
  Finding,
  FollowUp,
  OfficialSignatory,
  PKPT,
  Recommendation,
  RKAItem,
  RiskAnnualReport,
  RiskAnnualReportStatus,
  RiskProfileConfig,
  RiskRegister,
  Unit,
} from '../../types/audit';
import {
  RCSAAnalyticsItem,
  buildCorporateRiskAnalytics,
  formatRupiahId,
  generateDefaultAnnualReportNarratives,
  getEffectiveInherentScore,
  getEffectiveResidualScore,
} from '../../lib/riskAnalytics';
import {
  BPKP_IMPACT_LEVELS,
  BPKP_LIKELIHOOD_LEVELS,
} from '../../data/bpkpStandards';
import { downloadRiskAnnualReportPdf } from '../../lib/riskAnnualReportPdfGenerator';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';
import { INITIAL_OFFICIALS } from '../../data/initialData';

interface RiskAnnualReportModuleProps {
  onNavigateToRiskProfile?: () => void;
}

type ReportSectionKey =
  | 'all'
  | 'identitas'
  | 'bab1'
  | 'bab2'
  | 'bab3'
  | 'bab4'
  | 'bab5'
  | 'bab6'
  | 'bab7';

const REPORT_SECTIONS: Array<{ key: ReportSectionKey; code: string; title: string }> = [
  { key: 'identitas', code: 'SAMPUL', title: 'Identitas & Pengendalian Laporan' },
  { key: 'bab1', code: 'BAB I', title: 'Ringkasan Eksekutif & KPI Risiko' },
  { key: 'bab2', code: 'BAB II', title: 'Konteks Organisasi & Selera Risiko' },
  { key: 'bab3', code: 'BAB III', title: 'Profil Matriks 5×5, Kategori & 5M' },
  { key: 'bab4', code: 'BAB IV', title: 'Eksposur Unit Kerja & RCSA' },
  { key: 'bab5', code: 'BAB V', title: 'Risiko Kunci (Top Risks) & Mitigasi' },
  { key: 'bab6', code: 'BAB VI', title: 'Integrasi SPIP, RKA, PKPT & Audit' },
  { key: 'bab7', code: 'BAB VII', title: 'Kesimpulan, Peta Jalan & Pengesahan' },
];

export const RiskAnnualReportModule: React.FC<RiskAnnualReportModuleProps> = ({
  onNavigateToRiskProfile,
}) => {
  const { userProfile } = useAuth();
  const { activeYear, availableYears } = useFiscalYear();
  const { branding } = useAppBranding();

  const isSuperOrKepalaSpi =
    userProfile?.role === 'KEPALA_SPI' || userProfile?.role === 'ADMIN_SISTEM';
  const isViewer = userProfile?.role === 'VIEWER';
  const canAccess = isSuperOrKepalaSpi || isViewer;
  const canEdit = isSuperOrKepalaSpi;

  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [activeSection, setActiveSection] = useState<ReportSectionKey>('all');

  // Firestore collections
  const [risks, setRisks] = useState<RiskRegister[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [rcsaList, setRcsaList] = useState<RCSAAnalyticsItem[]>([]);
  const [bpkpList, setBpkpList] = useState<BPKPSelfAssessment[]>([]);
  const [pkptList, setPkptList] = useState<PKPT[]>([]);
  const [rkaList, setRkaList] = useState<RKAItem[]>([]);
  const [findingsList, setFindingsList] = useState<Finding[]>([]);
  const [recommendationsList, setRecommendationsList] = useState<Recommendation[]>([]);
  const [followUpsList, setFollowUpsList] = useState<FollowUp[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<RiskProfileConfig[]>([]);
  const [savedReports, setSavedReports] = useState<RiskAnnualReport[]>([]);
  const [officials, setOfficials] = useState<OfficialSignatory[]>(INITIAL_OFFICIALS);

  // Editable report metadata & narratives
  const [reportNumber, setReportNumber] = useState('');
  const [reportTitle, setReportTitle] = useState('');
  const [reportDate, setReportDate] = useState('');
  const [preparedBy, setPreparedBy] = useState('');
  const [recipient, setRecipient] = useState('');
  const [status, setStatus] = useState<RiskAnnualReportStatus>('Draft');

  const [executiveSummaryNarrative, setExecutiveSummaryNarrative] = useState('');
  const [contextAndGovernanceNarrative, setContextAndGovernanceNarrative] = useState('');
  const [categoryAndHeatmapAnalysis, setCategoryAndHeatmapAnalysis] = useState('');
  const [unitExposureAnalysis, setUnitExposureAnalysis] = useState('');
  const [mitigationAndControlEvaluation, setMitigationAndControlEvaluation] = useState('');
  const [spipPkptIntegrationAnalysis, setSpipPkptIntegrationAnalysis] = useState('');
  const [conclusionAndChallenges, setConclusionAndChallenges] = useState('');
  const [nextYearRoadmapNarrative, setNextYearRoadmapNarrative] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  useEffect(() => {
    if (!canAccess) return;

    const unsubs = [
      onSnapshot(
        collection(db, 'risk_registers'),
        (s) => setRisks(s.docs.map((d) => ({ id: d.id, ...d.data() } as RiskRegister))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'risk_registers')
      ),
      onSnapshot(
        collection(db, 'units'),
        (s) => setUnits(s.docs.map((d) => ({ id: d.id, ...d.data() } as Unit))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'units')
      ),
      onSnapshot(
        collection(db, 'rcsa_assessments'),
        (s) => setRcsaList(s.docs.map((d) => ({ id: d.id, ...d.data() } as RCSAAnalyticsItem))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'rcsa_assessments')
      ),
      onSnapshot(
        collection(db, 'bpkp_assessments'),
        (s) => setBpkpList(s.docs.map((d) => ({ id: d.id, ...d.data() } as BPKPSelfAssessment))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'bpkp_assessments')
      ),
      onSnapshot(
        collection(db, 'pkpt'),
        (s) => setPkptList(s.docs.map((d) => ({ id: d.id, ...d.data() } as PKPT))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'pkpt')
      ),
      onSnapshot(
        collection(db, 'rka_items'),
        (s) => setRkaList(s.docs.map((d) => ({ id: d.id, ...d.data() } as RKAItem))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'rka_items')
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
        collection(db, 'risk_profiles'),
        (s) => setSavedProfiles(s.docs.map((d) => ({ id: d.id, ...d.data() } as RiskProfileConfig))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'risk_profiles')
      ),
      onSnapshot(
        collection(db, 'risk_annual_reports'),
        (s) => setSavedReports(s.docs.map((d) => ({ id: d.id, ...d.data() } as RiskAnnualReport))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'risk_annual_reports')
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
  }, [canAccess]);

  const activeProfileConfig = useMemo(() => {
    return (
      savedProfiles.find((p) => p.id === `profile-${selectedYear}` || p.year === selectedYear) ||
      null
    );
  }, [savedProfiles, selectedYear]);

  const appetiteThreshold = activeProfileConfig?.appetiteThreshold ?? 10;

  const analytics = useMemo(
    () =>
      buildCorporateRiskAnalytics({
        year: selectedYear,
        appetiteThreshold,
        risks,
        units,
        rcsaList,
        bpkpList,
        pkptList,
        rkaList,
        findingsList,
        recommendationsList,
        followUpsList,
      }),
    [
      selectedYear,
      appetiteThreshold,
      risks,
      units,
      rcsaList,
      bpkpList,
      pkptList,
      rkaList,
      findingsList,
      recommendationsList,
      followUpsList,
    ]
  );

  const currentSavedReport = useMemo(() => {
    const id = `rar-${selectedYear}`;
    return savedReports.find((r) => r.id === id || r.year === selectedYear) || null;
  }, [savedReports, selectedYear]);

  const institutionName =
    branding.institutionName || 'Perumda Air Minum Tirta Saiyo Kabupaten Pasaman';

  const applyGeneratedNarratives = () => {
    const activeUnitsCount = units.filter((u) => u.isActive).length || units.length || 1;
    const generated = generateDefaultAnnualReportNarratives(
      analytics,
      institutionName,
      activeUnitsCount
    );
    setExecutiveSummaryNarrative(generated.executiveSummaryNarrative);
    setContextAndGovernanceNarrative(generated.contextAndGovernanceNarrative);
    setCategoryAndHeatmapAnalysis(generated.categoryAndHeatmapAnalysis);
    setUnitExposureAnalysis(generated.unitExposureAnalysis);
    setMitigationAndControlEvaluation(generated.mitigationAndControlEvaluation);
    setSpipPkptIntegrationAnalysis(generated.spipPkptIntegrationAnalysis);
    setConclusionAndChallenges(generated.conclusionAndChallenges);
    setNextYearRoadmapNarrative(generated.nextYearRoadmapNarrative);
  };

  useEffect(() => {
    const formattedToday = new Intl.DateTimeFormat('id-ID', {
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
      setExecutiveSummaryNarrative(currentSavedReport.executiveSummaryNarrative);
      setContextAndGovernanceNarrative(currentSavedReport.contextAndGovernanceNarrative);
      setCategoryAndHeatmapAnalysis(currentSavedReport.categoryAndHeatmapAnalysis);
      setUnitExposureAnalysis(currentSavedReport.unitExposureAnalysis);
      setMitigationAndControlEvaluation(currentSavedReport.mitigationAndControlEvaluation);
      setSpipPkptIntegrationAnalysis(currentSavedReport.spipPkptIntegrationAnalysis);
      setConclusionAndChallenges(currentSavedReport.conclusionAndChallenges);
      setNextYearRoadmapNarrative(currentSavedReport.nextYearRoadmapNarrative);
    } else {
      const yStr = selectedYear === 0 ? 'MULTI' : String(selectedYear);
      setReportNumber(`LAP-MR/SPI-PTS/${yStr}`);
      setReportTitle(
        `LAPORAN TAHUNAN MANAJEMEN RISIKO KORPORAT ${
          selectedYear === 0 ? 'LINTAS TAHUN' : `TAHUN BUKU ${selectedYear}`
        }`
      );
      setReportDate(formattedToday);
      setPreparedBy(userProfile?.displayName || 'Kepala Satuan Pengawasan Intern');
      setRecipient(`Direktur & Dewan Pengawas ${branding.shortInstitutionName || 'Perumda Tirta Saiyo'}`);
      setStatus('Draft');
      applyGeneratedNarratives();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSavedReport?.id, selectedYear]);

  const yearOptions = useMemo(() => {
    const docYears = [
      ...risks.map((r) => r.year),
      ...savedReports.map((r) => r.year),
    ].filter((y) => typeof y === 'number' && y > 0);
    return Array.from(new Set([...availableYears, ...docYears])).sort((a, b) => b - a);
  }, [availableYears, risks, savedReports]);

  const resolvedSignatories = useMemo(() => {
    const findByPos = (keyword: string) =>
      officials.find((o) => o.position.toLowerCase().includes(keyword.toLowerCase()));
    return {
      kepalaSpi: findByPos('kepala satuan pengawasan') || findByPos('kepala spi') || officials[0],
      direktur: findByPos('direktur') || officials[1],
      dewas: findByPos('dewan pengawas') || officials[2],
      location: 'Lubuk Sikaping',
    };
  }, [officials]);

  if (!canAccess) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto mt-10">
        <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900">
          Akses Terbatas — Khusus Kepala SPI / Super User
        </h2>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          Laporan Tahunan Manajemen Risiko hanya dapat disusun, disunting, disahkan, dan diekspor oleh Kepala SPI atau Super User.
        </p>
      </div>
    );
  }

  const buildReportObject = (overrideStatus?: RiskAnnualReportStatus): RiskAnnualReport => {
    const nowIso = new Date().toISOString();
    const nextStatus = overrideStatus || status;
    return {
      id: `rar-${selectedYear}`,
      year: selectedYear,
      reportNumber: reportNumber.trim() || `LAP-MR/SPI-PTS/${selectedYear}`,
      reportTitle:
        reportTitle.trim() || `LAPORAN TAHUNAN MANAJEMEN RISIKO TAHUN ${selectedYear}`,
      reportDate: reportDate.trim() || new Date().toISOString().slice(0, 10),
      preparedBy: preparedBy.trim() || 'Kepala SPI',
      recipient: recipient.trim() || 'Direktur & Dewan Pengawas',
      appetiteThreshold,
      executiveSummaryNarrative,
      contextAndGovernanceNarrative,
      categoryAndHeatmapAnalysis,
      unitExposureAnalysis,
      mitigationAndControlEvaluation,
      spipPkptIntegrationAnalysis,
      conclusionAndChallenges,
      nextYearRoadmapNarrative,
      status: nextStatus,
      approvedBy:
        nextStatus !== 'Draft'
          ? userProfile?.displayName || 'Kepala SPI'
          : currentSavedReport?.approvedBy,
      approvedAt: nextStatus !== 'Draft' ? nowIso : currentSavedReport?.approvedAt,
      createdBy: currentSavedReport?.createdBy || userProfile?.displayName || 'Kepala SPI',
      createdAt: currentSavedReport?.createdAt || nowIso,
      updatedAt: nowIso,
    };
  };

  const handleSaveReport = async (overrideStatus?: RiskAnnualReportStatus) => {
    if (!canEdit) return;
    setIsSaving(true);
    setFeedbackNotice(null);
    const reportObj = buildReportObject(overrideStatus);

    try {
      await setDoc(doc(db, 'risk_annual_reports', reportObj.id), reportObj, { merge: true });
      if (overrideStatus) setStatus(overrideStatus);
      setFeedbackNotice(
        `Laporan Tahunan Manajemen Risiko (${reportObj.reportNumber}) berhasil disimpan dengan status "${reportObj.status}".`
      );
      setTimeout(() => setFeedbackNotice(null), 5000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `risk_annual_reports/${reportObj.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncFromLiveData = () => {
    if (!canEdit) return;
    applyGeneratedNarratives();
    setFeedbackNotice(
      'Seluruh narasi Bab I hingga Bab VII berhasil disinkronkan ulang menggunakan data real-time terbaru.'
    );
    setTimeout(() => setFeedbackNotice(null), 5000);
  };

  const handleDownloadPdf = () => {
    const filename = downloadRiskAnnualReportPdf({
      report: buildReportObject(),
      profileConfig: activeProfileConfig,
      analytics,
      branding,
      signatories: resolvedSignatories,
    });
    setFeedbackNotice(`Dokumen PDF multi-halaman berhasil diunduh: ${filename}`);
    setTimeout(() => setFeedbackNotice(null), 5000);
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          'Nomor Laporan': reportNumber,
          'Judul Laporan': reportTitle,
          'Tahun Buku': selectedYear === 0 ? 'Lintas Tahun' : selectedYear,
          'Tanggal Laporan': reportDate,
          Penyusun: preparedBy,
          Tujuan: recipient,
          Status: status,
          'Total Risiko': analytics.totalRisks,
          'Avg Skor Inheren': analytics.avgInherent,
          'Avg Skor Residual': analytics.avgResidual,
          'Reduksi Eksposur (%)': analytics.reductionRatePct,
          'Melewati Selera Risiko': analytics.aboveAppetiteCount,
          'Efektivitas Kontrol (%)': analytics.effectiveControlRatePct,
          'Mitigasi Selesai (%)': analytics.mitigationCompletionRatePct,
          'Skor Maturitas SPIP': analytics.spipIntegration.spipMaturityScore,
          'Skor Unsur 2 SPIP': analytics.spipIntegration.riskElementAvgScore,
        },
      ]),
      'Bab I Ikhtisar'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.levelDistribution.map((row) => ({
          'Tingkat Risiko': row.level,
          'Rentang Skor': row.scoreRange,
          'Inheren (Jml)': row.inherentCount,
          'Inheren (%)': row.inherentPct,
          'Residual (Jml)': row.residualCount,
          'Residual (%)': row.residualPct,
          Perubahan: row.delta,
        }))
      ),
      'Bab III Level Risiko'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.categorySummaries.map((c) => ({
          'Kategori Risiko SPIP': c.category,
          'Jumlah Risiko': c.riskCount,
          'Avg Inheren': c.avgInherent,
          'Avg Residual': c.avgResidual,
          'Maks Residual': c.maxResidual,
          '> Selera': c.aboveAppetiteCount,
          'Level Dominan': c.dominantLevel,
        }))
      ),
      'Bab III Kategori SPIP'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.unitSummaries.map((u) => ({
          Kode: u.unitCode,
          'Unit Kerja / Pemilik Risiko': u.unitName,
          'Jumlah Risiko': u.riskCount,
          'Avg Inheren': u.avgInherent,
          'Avg Residual': u.avgResidual,
          'Maks Residual': u.maxResidual,
          '> Selera': u.aboveAppetiteCount,
          'Kontrol Efektif (%)': u.effectiveControlPct,
          'RCSA Self': u.rcsaAvgSelfScore,
          'RCSA SPI': u.rcsaAvgSpiScore,
          'Temuan Audit': u.findingsCount,
          'Item PKPT': u.pkptCount,
        }))
      ),
      'Bab IV Eksposur Unit'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        analytics.topRisks.map((r, idx) => ({
          Peringkat: idx + 1,
          Kode: r.code,
          Unit: r.unitName,
          Kategori: r.category,
          'Peristiwa Risiko': r.event,
          'Akar 5M': r.causeCategory5M || '-',
          Penyebab: r.cause,
          'Skor Inheren': getEffectiveInherentScore(r),
          'Skor Residual': getEffectiveResidualScore(r),
          'Opsi Perlakuan': r.treatmentOption || 'Mengurangi (Reduce)',
          'Rencana Mitigasi': r.mitigationPlan,
          PIC: r.pic,
          Target: r.targetDate,
          Status: r.status,
          'Evaluasi SPI': r.spiReviewStatus || 'Diusulkan Auditee',
        }))
      ),
      'Bab V Top Risks'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Bab: 'BAB I - Ringkasan Eksekutif', Narasi: executiveSummaryNarrative },
        { Bab: 'BAB II - Konteks & Tata Kelola', Narasi: contextAndGovernanceNarrative },
        { Bab: 'BAB III - Profil Matriks & Kategori', Narasi: categoryAndHeatmapAnalysis },
        { Bab: 'BAB IV - Eksposur Unit & RCSA', Narasi: unitExposureAnalysis },
        { Bab: 'BAB V - Evaluasi Kontrol & Mitigasi', Narasi: mitigationAndControlEvaluation },
        { Bab: 'BAB VI - Integrasi SPIP & PKPT', Narasi: spipPkptIntegrationAnalysis },
        { Bab: 'BAB VII - Kesimpulan & Tantangan', Narasi: conclusionAndChallenges },
        { Bab: 'BAB VII - Peta Jalan Tahun Berikutnya', Narasi: nextYearRoadmapNarrative },
      ]),
      'Naskah Narasi Bab I-VII'
    );

    const yearSlug = selectedYear === 0 ? 'Lintas_Tahun' : String(selectedYear);
    XLSX.writeFile(wb, `Laporan_Tahunan_Manajemen_Risiko_${yearSlug}.xlsx`);
  };

  const showSection = (key: Exclude<ReportSectionKey, 'all'>) =>
    activeSection === 'all' || activeSection === key;

  const yearLabel = selectedYear === 0 ? 'Lintas Tahun' : `Tahun Buku ${selectedYear}`;

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium mb-1">
            <span>{isViewer ? 'Mode Lihat & Cetak (Viewer)' : 'Akses Eksklusif Kepala SPI & Super User'}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{reportNumber}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-emerald-800">{status}</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileBarChart2 className="w-5 h-5 text-emerald-700 shrink-0" />
            <span>Laporan Tahunan Manajemen Risiko</span>
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Dokumen eksekutif terstruktur 7 bab (ISO 31000 &amp; SPIP Terpadu) yang memadukan profil risiko 5×5, RCSA, SPIP BPKP, PKPT, RKA, dan hasil audit.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
              aria-label="Pilih Tahun Laporan"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Tahun {y}
                </option>
              ))}
              <option value={0}>Semua Tahun</option>
            </select>
          </div>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={handleSyncFromLiveData}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Buat ulang narasi otomatis berdasarkan angka data Firestore terbaru"
              >
                <RefreshCw className="w-3.5 h-3.5 text-emerald-700" />
                <span>Sinkronkan Narasi</span>
              </button>

              <button
                type="button"
                onClick={() => handleSaveReport()}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Menyimpan...' : 'Simpan Laporan'}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleDownloadPdf}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Unduh PDF Lengkap</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-700" />
            <span>Excel</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Pratinjau Cetak</span>
          </button>
        </div>
      </div>

      {feedbackNotice && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{feedbackNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackNotice(null)}
            className="font-semibold text-emerald-700 hover:text-emerald-950"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Two-Column Structure: Left Chapter Navigator + Right Structured Report Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Navigation Panel */}
        <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-4 space-y-3 lg:sticky lg:top-20">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-emerald-700" />
              <span>Sistematika Bab</span>
            </h3>
            {onNavigateToRiskProfile && (
              <button
                type="button"
                onClick={onNavigateToRiskProfile}
                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
              >
                Profil Risiko →
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setActiveSection('all')}
            className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              activeSection === 'all'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
            }`}
          >
            Tampilkan Laporan Utuh (Bab I–VII)
          </button>

          <div className="space-y-1">
            {REPORT_SECTIONS.map((sec) => {
              const active = activeSection === sec.key;
              return (
                <button
                  key={sec.key}
                  type="button"
                  onClick={() => setActiveSection(sec.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-50 text-emerald-950 border border-emerald-200 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-[10px] font-mono text-emerald-700 font-semibold">
                    {sec.code}
                  </span>
                  <span className="block leading-snug">{sec.title}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-100 space-y-2 text-[11px] text-slate-600">
            <div className="flex items-center justify-between">
              <span>Ambang Selera Risiko</span>
              <span className="font-mono font-bold text-slate-900">≤ {appetiteThreshold}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Total Risiko Data</span>
              <span className="font-mono font-bold text-slate-900">{analytics.totalRisks}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Penetapan Status</span>
              <span className="font-semibold text-emerald-800">{status}</span>
            </div>
          </div>
        </aside>

        {/* Right Structured Report Content */}
        <div className="lg:col-span-9 space-y-6">
          {/* IDENTITAS & PENGENDALIAN DOKUMEN */}
          {showSection('identitas') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
                    Identitas Dokumen Resmi
                  </p>
                  <h3 className="text-base font-bold text-slate-900 mt-0.5">
                    Sampul &amp; Pengendalian Laporan Tahunan ({yearLabel})
                  </h3>
                </div>
                <select
                  value={status}
                  disabled={!canEdit}
                  onChange={(e) => setStatus(e.target.value as RiskAnnualReportStatus)}
                  className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50 text-slate-900 disabled:opacity-75"
                >
                  <option value="Draft">Draft</option>
                  <option value="Final / Disahkan Kepala SPI">Final / Disahkan Kepala SPI</option>
                  <option value="Disampaikan ke Direksi & Dewas">
                    Disampaikan ke Direksi &amp; Dewas
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
                  <label className="block font-semibold text-slate-700 mb-1">
                    Disampaikan Kepada
                  </label>
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

          {/* BAB I - RINGKASAN EKSEKUTIF */}
          {showSection('bab1') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB I</p>
                <h3 className="text-base font-bold text-slate-900">
                  Ringkasan Eksekutif &amp; Ikhtisar Tata Kelola Manajemen Risiko
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Narasi Ringkasan Eksekutif (Dapat Disunting Kepala SPI)
                </label>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={executiveSummaryNarrative}
                  onChange={(e) => setExecutiveSummaryNarrative(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2.5">
                  1.1 Matriks Capaian Kinerja Utama Manajemen Risiko ({yearLabel})
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3 font-semibold">Indikator Utama</th>
                        <th className="py-2 px-3 font-semibold text-right">Capaian Aktual</th>
                        <th className="py-2 px-3 font-semibold">Keterangan / Acuan Toleransi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-900">Total Risiko Terpetakan</td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                          {analytics.totalRisks} Risiko
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {analytics.unitSummaries.filter((u) => u.riskCount > 0).length} unit kerja aktif
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          Skor Rata-Rata Inheren → Residual
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                          {analytics.avgInherent.toFixed(2)} → {analytics.avgResidual.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-emerald-700 font-medium tabular-nums">
                          Penurunan eksposur {analytics.reductionRatePct}%
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          Risiko Melewati Selera Risiko (&gt;{appetiteThreshold})
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums text-rose-700">
                          {analytics.aboveAppetiteCount} ({analytics.aboveAppetitePct}%)
                        </td>
                        <td className="py-2 px-3 text-slate-600 tabular-nums">
                          Sangat Tinggi: {analytics.criticalResidualCount} · Tinggi: {analytics.highResidualCount}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          Efektivitas Kontrol Eksisting ("Efektif")
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                          {analytics.effectiveControlRatePct}%
                        </td>
                        <td className="py-2 px-3 text-slate-600 tabular-nums">
                          Target minimal: ≥ {activeProfileConfig?.targetControlEffectivenessPct ?? 80}%
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          Realisasi Penyelesaian Mitigasi ("Selesai")
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                          {analytics.mitigationCompletionRatePct}%
                        </td>
                        <td className="py-2 px-3 text-slate-600 tabular-nums">
                          {analytics.mitigationCompletedCount} selesai · {analytics.mitigationInProgressCount} dalam proses
                        </td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          Maturitas SPIP Terpadu &amp; Unsur Penilaian Risiko
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                          {analytics.spipIntegration.spipMaturityScore.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-slate-600 tabular-nums">
                          {analytics.spipIntegration.spipMaturityLevel} · Unsur 2: {analytics.spipIntegration.riskElementAvgScore.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* BAB II - KONTEKS ORGANISASI & SELERA RISIKO */}
          {showSection('bab2') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB II</p>
                <h3 className="text-base font-bold text-slate-900">
                  Konteks Organisasi, Struktur Pemilik Risiko &amp; Penetapan Selera Risiko
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Narasi Konteks Organisasi &amp; Tata Kelola Tiga Lini
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={contextAndGovernanceNarrative}
                  onChange={(e) => setContextAndGovernanceNarrative(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-2 text-xs">
                  <h4 className="font-bold text-slate-900">2.1 Ketetapan Selera Risiko Korporat</h4>
                  <p className="text-slate-700 leading-relaxed">
                    {activeProfileConfig?.appetiteStatement ||
                      `Ambang batas selera risiko ditetapkan pada skor residual maksimal ${appetiteThreshold}. Risiko melampaui ambang batas wajib disertai rencana mitigasi aktif.`}
                  </p>
                  <div className="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2 text-[11px] tabular-nums">
                    <div>
                      <span className="text-slate-500 block">Maks Skor Residual</span>
                      <strong className="text-slate-900">≤ {appetiteThreshold}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Toleransi Ekstrem</span>
                      <strong className="text-slate-900">
                        {activeProfileConfig?.extremeToleranceCount ?? 0} Risiko
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg p-4 bg-slate-50/70 space-y-2 text-xs">
                  <h4 className="font-bold text-slate-900">2.2 Komposisi Pemilik Risiko</h4>
                  <div className="space-y-1.5 text-[11px] tabular-nums">
                    {(['PIMPINAN', 'PENGAWASAN', 'BIDANG', 'UNIT_PELAYANAN'] as const).map((cat) => {
                      const count = units.filter((u) => u.category === cat && u.isActive).length;
                      return (
                        <div key={cat} className="flex items-center justify-between">
                          <span className="text-slate-600">{cat.replace('_', ' ')}</span>
                          <span className="font-mono font-semibold text-slate-900">{count} Unit</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2">
                  2.3 Skala Kriteria Kemungkinan &amp; Dampak 5×5 (BPKP SPIP)
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-2.5 font-semibold text-center">Skala</th>
                        <th className="py-2 px-2.5 font-semibold">Kemungkinan</th>
                        <th className="py-2 px-2.5 font-semibold">Frekuensi</th>
                        <th className="py-2 px-2.5 font-semibold">Dampak</th>
                        <th className="py-2 px-2.5 font-semibold">Tolok Ukur Finansial &amp; Layanan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {BPKP_LIKELIHOOD_LEVELS.map((l, idx) => {
                        const imp = BPKP_IMPACT_LEVELS[idx];
                        return (
                          <tr key={l.level}>
                            <td className="py-2 px-2.5 text-center font-mono font-bold">{l.level}</td>
                            <td className="py-2 px-2.5 font-medium text-slate-900">{l.name}</td>
                            <td className="py-2 px-2.5 text-slate-600">{l.frequency}</td>
                            <td className="py-2 px-2.5 font-medium text-slate-900">{imp?.name}</td>
                            <td className="py-2 px-2.5 text-slate-600">
                              {imp?.financial} · Tunda SOP {imp?.delay}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {/* BAB III - PROFIL MATRIKS 5x5, KATEGORI SPIP & 5M */}
          {showSection('bab3') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB III</p>
                <h3 className="text-base font-bold text-slate-900">
                  Profil Risiko Korporat, Distribusi Matriks 5×5 &amp; Eksposur Kategori
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Narasi Analisis Distribusi Matriks, Kategori &amp; Akar Masalah
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={categoryAndHeatmapAnalysis}
                  onChange={(e) => setCategoryAndHeatmapAnalysis(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2">
                  3.1 Distribusi Tingkat Risiko Inheren vs Residual
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <th className="py-2 px-3 font-semibold">Tingkat Risiko</th>
                        <th className="py-2 px-3 font-semibold">Skor</th>
                        <th className="py-2 px-3 font-semibold text-right">Inheren</th>
                        <th className="py-2 px-3 font-semibold text-right">Residual</th>
                        <th className="py-2 px-3 font-semibold text-right">Pergeseran</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analytics.levelDistribution.map((row) => (
                        <tr key={row.level}>
                          <td className="py-2 px-3 font-semibold text-slate-900">{row.level}</td>
                          <td className="py-2 px-3 font-mono text-slate-600 tabular-nums">{row.scoreRange}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">
                            {row.inherentCount} ({row.inherentPct}%)
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">
                            {row.residualCount} ({row.residualPct}%)
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">
                            {row.delta > 0 ? `+${row.delta}` : row.delta}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold text-slate-800 mb-2">
                  3.2 Rekapitulasi 8 Kategori Risiko SPIP &amp; Akar Masalah 5M
                </h4>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <th className="py-2 px-2.5 font-semibold">Kategori SPIP</th>
                          <th className="py-2 px-2.5 font-semibold text-right">Jml</th>
                          <th className="py-2 px-2.5 font-semibold text-right">Inh</th>
                          <th className="py-2 px-2.5 font-semibold text-right">Res</th>
                          <th className="py-2 px-2.5 font-semibold text-right">&gt;Selera</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analytics.categorySummaries.map((c) => (
                          <tr key={c.category}>
                            <td className="py-1.5 px-2.5 font-medium text-slate-900">{c.category}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">{c.riskCount}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">{c.avgInherent.toFixed(1)}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold tabular-nums">{c.avgResidual.toFixed(1)}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-rose-700">{c.aboveAppetiteCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <th className="py-2 px-2.5 font-semibold">Akar Masalah 5M</th>
                          <th className="py-2 px-2.5 font-semibold text-right">Jml</th>
                          <th className="py-2 px-2.5 font-semibold text-right">Porsi</th>
                          <th className="py-2 px-2.5 font-semibold text-right">Avg Res</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {analytics.cause5MSummaries.map((m) => (
                          <tr key={m.causeCategory}>
                            <td className="py-1.5 px-2.5 font-medium text-slate-900">{m.causeCategory}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">{m.riskCount}</td>
                            <td className="py-1.5 px-2.5 text-right font-mono tabular-nums">{m.pct}%</td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold tabular-nums">{m.avgResidual.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* BAB IV - EKSPOSUR UNIT KERJA & RCSA */}
          {showSection('bab4') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB IV</p>
                <h3 className="text-base font-bold text-slate-900">
                  Analisis Eksposur Risiko per Unit Kerja (Pemilik Risiko) &amp; Penilaian RCSA
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Narasi Analisis Eksposur Unit Kerja &amp; RCSA
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={unitExposureAnalysis}
                  onChange={(e) => setUnitExposureAnalysis(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2 px-3 font-semibold">Unit Kerja / Pemilik Risiko</th>
                      <th className="py-2 px-3 font-semibold text-right">Jml Risiko</th>
                      <th className="py-2 px-3 font-semibold text-right">Avg Inh</th>
                      <th className="py-2 px-3 font-semibold text-right">Avg Res</th>
                      <th className="py-2 px-3 font-semibold text-right">Maks Res</th>
                      <th className="py-2 px-3 font-semibold text-right">&gt;Selera</th>
                      <th className="py-2 px-3 font-semibold text-right">Kontrol Efektif</th>
                      <th className="py-2 px-3 font-semibold text-right">RCSA (Self/SPI)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.unitSummaries.map((u) => (
                      <tr key={u.unitId}>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {u.unitName} <span className="text-slate-400">({u.unitCode})</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{u.riskCount}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{u.avgInherent.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">{u.avgResidual.toFixed(1)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold tabular-nums">{u.maxResidual}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-rose-700">{u.aboveAppetiteCount}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">{u.effectiveControlPct}%</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {u.rcsaCount > 0 ? `${u.rcsaAvgSelfScore}/${u.rcsaAvgSpiScore || '-'}` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* BAB V - TOP RISKS, KAIDAH & MITIGASI */}
          {showSection('bab5') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB V</p>
                <h3 className="text-base font-bold text-slate-900">
                  Daftar Risiko Kunci (Top Risks), Evaluasi Kaidah &amp; Rencana Mitigasi
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Narasi Evaluasi Efektivitas Pengendalian, Kaidah SPIP &amp; Progres Mitigasi
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={mitigationAndControlEvaluation}
                  onChange={(e) => setMitigationAndControlEvaluation(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] border-collapse border border-slate-200">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2 px-2.5 font-semibold">Kode</th>
                      <th className="py-2 px-2.5 font-semibold">Unit Kerja</th>
                      <th className="py-2 px-2.5 font-semibold">Peristiwa Risiko</th>
                      <th className="py-2 px-2.5 font-semibold text-right">Inh</th>
                      <th className="py-2 px-2.5 font-semibold text-right">Res</th>
                      <th className="py-2 px-2.5 font-semibold">Rencana Mitigasi &amp; PIC</th>
                      <th className="py-2 px-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.topRisks.slice(0, 15).map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="py-2 px-2.5 font-mono font-semibold whitespace-nowrap">{r.code}</td>
                        <td className="py-2 px-2.5 text-slate-700">{r.unitName}</td>
                        <td className="py-2 px-2.5 font-medium text-slate-900">{r.event}</td>
                        <td className="py-2 px-2.5 text-right font-mono tabular-nums">
                          {getEffectiveInherentScore(r)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-mono font-bold tabular-nums text-rose-700">
                          {getEffectiveResidualScore(r)}
                        </td>
                        <td className="py-2 px-2.5 text-slate-600">
                          {r.mitigationPlan} · PIC: {r.pic}
                        </td>
                        <td className="py-2 px-2.5 whitespace-nowrap">
                          <span className="font-semibold text-slate-800">{r.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* BAB VI - INTEGRASI SPIP, RKA, PKPT & TEMUAN AUDIT */}
          {showSection('bab6') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB VI</p>
                <h3 className="text-base font-bold text-slate-900">
                  Integrasi Manajemen Risiko dengan SPIP Terpadu, RKA, PKPT &amp; Hasil Audit
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Narasi Integrasi Lintas Modul (SPIP BPKP, RKA, PKPT &amp; Temuan 5C)
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={spipPkptIntegrationAnalysis}
                  onChange={(e) => setSpipPkptIntegrationAnalysis(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs tabular-nums">
                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-slate-500 font-medium">Self Assessment SPIP Terpadu</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {analytics.spipIntegration.spipMaturityScore.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    {analytics.spipIntegration.spipMaturityLevel} · Unsur 2 Penilaian Risiko:{' '}
                    {analytics.spipIntegration.riskElementAvgScore.toFixed(2)}
                  </p>
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-slate-500 font-medium">PKPT &amp; Integrasi RKA</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {analytics.pkptSummary.totalPlans} PKPT · {analytics.pkptSummary.realizationPct}%
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    {analytics.rkaSummary.totalPrograms} RKA ({formatRupiahId(analytics.rkaSummary.totalBudget)})
                  </p>
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <p className="text-slate-500 font-medium">Temuan 5C &amp; Tindak Lanjut</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">
                    {analytics.findingsSummary.totalFindings} Temuan
                  </p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Potensi: {formatRupiahId(analytics.findingsSummary.totalPotentialLoss)} · TLR Selesai:{' '}
                    {analytics.recommendationsSummary.completionPct}%
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* BAB VII - KESIMPULAN, PETA JALAN & PENGESAHAN */}
          {showSection('bab7') && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB VII</p>
                <h3 className="text-base font-bold text-slate-900">
                  Kesimpulan, Tantangan Strategis, Peta Jalan Tahun Berikutnya &amp; Lembar Pengesahan
                </h3>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  7.1 Kesimpulan Umum &amp; Tantangan Strategis
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={conclusionAndChallenges}
                  onChange={(e) => setConclusionAndChallenges(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  7.2 Peta Jalan &amp; Rencana Aksi Penguatan Tahun{' '}
                  {(selectedYear || new Date().getFullYear()) + 1}
                </label>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={nextYearRoadmapNarrative}
                  onChange={(e) => setNextYearRoadmapNarrative(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h4 className="text-xs font-bold text-slate-800 mb-3">
                  7.3 Pratinjau Lembar Pengesahan Pejabat Penandatangan
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center text-xs">
                  {[
                    { role: 'Disusun & Diajukan Oleh:', person: resolvedSignatories.kepalaSpi, fallbackPos: 'Kepala SPI' },
                    { role: 'Diketahui & Disetujui:', person: resolvedSignatories.direktur, fallbackPos: 'Direktur' },
                    { role: 'Tembusan / Pengawasan:', person: resolvedSignatories.dewas, fallbackPos: 'Dewan Pengawas' },
                  ].map((sig, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-lg p-4 bg-slate-50/70">
                      <p className="text-[11px] text-slate-500">{sig.role}</p>
                      <p className="font-semibold text-slate-800 mt-0.5">
                        {sig.person?.position || sig.fallbackPos}
                      </p>
                      <div className="h-10" />
                      <p className="font-bold text-slate-900 underline">
                        {sig.person?.name || sig.fallbackPos}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono">
                        NIP. {sig.person?.nip || '-'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {canEdit && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => handleSaveReport('Final / Disahkan Kepala SPI')}
                    disabled={isSaving}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                  >
                    Sahkan &amp; Simpan Laporan (Kepala SPI)
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {/* Print Preview & Word Export Modal */}
      {isPrintModalOpen && (
        <DocumentPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          documentTitle={reportTitle}
          documentSubtitle={`${institutionName} · ${yearLabel}`}
          documentNumber={reportNumber}
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
          defaultShowSignatory2={true}
          defaultShowSignatory3={true}
        >
          {() => (
            <div className="space-y-6 text-xs text-slate-900 leading-relaxed">
              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-2">
                  BAB I — Ringkasan Eksekutif &amp; Tata Kelola Risiko
                </h4>
                <p className="whitespace-pre-line text-justify">{executiveSummaryNarrative}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-2">
                  BAB II — Konteks Organisasi &amp; Selera Risiko
                </h4>
                <p className="whitespace-pre-line text-justify">{contextAndGovernanceNarrative}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-2">
                  BAB III — Profil Matriks 5×5 &amp; Kategori SPIP
                </h4>
                <p className="whitespace-pre-line text-justify mb-2">{categoryAndHeatmapAnalysis}</p>
                <table className="w-full text-[10px] border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="p-1.5 border border-slate-300 text-left">Kategori SPIP</th>
                      <th className="p-1.5 border border-slate-300 text-center">Jml</th>
                      <th className="p-1.5 border border-slate-300 text-center">Avg Inh</th>
                      <th className="p-1.5 border border-slate-300 text-center">Avg Res</th>
                      <th className="p-1.5 border border-slate-300 text-center">&gt; Selera</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.categorySummaries.map((c) => (
                      <tr key={c.category}>
                        <td className="p-1.5 border border-slate-300 font-semibold">{c.category}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{c.riskCount}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{c.avgInherent.toFixed(2)}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{c.avgResidual.toFixed(2)}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{c.aboveAppetiteCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-2">
                  BAB IV — Eksposur Risiko per Unit Kerja
                </h4>
                <p className="whitespace-pre-line text-justify mb-2">{unitExposureAnalysis}</p>
                <table className="w-full text-[10px] border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="p-1.5 border border-slate-300 text-left">Unit Kerja</th>
                      <th className="p-1.5 border border-slate-300 text-center">Jml</th>
                      <th className="p-1.5 border border-slate-300 text-center">Avg Inh</th>
                      <th className="p-1.5 border border-slate-300 text-center">Avg Res</th>
                      <th className="p-1.5 border border-slate-300 text-center">Maks</th>
                      <th className="p-1.5 border border-slate-300 text-center">&gt; Selera</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.unitSummaries.map((u) => (
                      <tr key={u.unitId}>
                        <td className="p-1.5 border border-slate-300">{u.unitName}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{u.riskCount}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{u.avgInherent.toFixed(1)}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{u.avgResidual.toFixed(1)}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{u.maxResidual}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{u.aboveAppetiteCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-2">
                  BAB V — Risiko Kunci (Top Risks) &amp; Evaluasi Mitigasi
                </h4>
                <p className="whitespace-pre-line text-justify">{mitigationAndControlEvaluation}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-2">
                  BAB VI — Integrasi SPIP, RKA, PKPT &amp; Audit
                </h4>
                <p className="whitespace-pre-line text-justify">{spipPkptIntegrationAnalysis}</p>
              </div>

              <div>
                <h4 className="font-bold uppercase text-xs border-b border-slate-400 pb-1 mb-2">
                  BAB VII — Kesimpulan, Tantangan &amp; Peta Jalan Tahun Berikutnya
                </h4>
                <p className="whitespace-pre-line text-justify mb-2">{conclusionAndChallenges}</p>
                <p className="whitespace-pre-line text-justify">{nextYearRoadmapNarrative}</p>
              </div>
            </div>
          )}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
