import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  ShieldAlert,
  Lock,
  Save,
  Printer,
  Download,
  FileBarChart2,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Layers,
  Star,
  Calendar,
  ArrowRight,
  Search,
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
  PKPT,
  Recommendation,
  RKAItem,
  RiskProfileConfig,
  RiskProfileStatus,
  RiskRegister,
  Unit,
} from '../../types/audit';
import {
  RCSAAnalyticsItem,
  buildCorporateRiskAnalytics,
  getEffectiveInherentScore,
  getEffectiveResidualScore,
} from '../../lib/riskAnalytics';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';

interface RiskProfileModuleProps {
  onNavigateToAnnualReport?: () => void;
  onNavigateToRiskRegister?: () => void;
}

type ProfileSubTab =
  | 'matrix'
  | 'categories'
  | 'units'
  | 'top_risks'
  | 'appetite';

export const RiskProfileModule: React.FC<RiskProfileModuleProps> = ({
  onNavigateToAnnualReport,
  onNavigateToRiskRegister,
}) => {
  const { userProfile } = useAuth();
  const { activeYear, availableYears } = useFiscalYear();
  const { branding } = useAppBranding();

  const isSuperOrKepalaSpi =
    userProfile?.role === 'KEPALA_SPI' || userProfile?.role === 'ADMIN_SISTEM';

  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [subTab, setSubTab] = useState<ProfileSubTab>('matrix');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyAboveAppetite, setOnlyAboveAppetite] = useState(false);

  // Interactive drill-down for 5x5 matrix cell
  const [selectedMatrixCell, setSelectedMatrixCell] = useState<{
    mode: 'inherent' | 'residual';
    l: number;
    i: number;
  } | null>(null);

  // Firestore raw collections
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

  // Editable Profile Configuration states
  const [appetiteThreshold, setAppetiteThreshold] = useState<number>(10);
  const [extremeToleranceCount, setExtremeToleranceCount] = useState<number>(0);
  const [targetControlEffectivenessPct, setTargetControlEffectivenessPct] = useState<number>(80);
  const [targetMitigationCompletionPct, setTargetMitigationCompletionPct] = useState<number>(85);
  const [appetiteStatement, setAppetiteStatement] = useState<string>(
    'Perusahaan menetapkan tingkat selera risiko (Risk Appetite) pada batas skor residual maksimal 10 (Zona Rendah hingga Sedang). Risiko di luar ambang batas tersebut wajib disertai rencana perlakuan mitigasi yang terukur dan diawasi secara berkala oleh Kepala SPI.'
  );
  const [priorityFocusNote, setPriorityFocusNote] = useState<string>(
    'Prioritas pengendalian difokuskan pada keandalan infrastruktur distribusi/produksi, pencegahan potensi fraud kas dan meter air, serta kepatuhan baku mutu layanan pelanggan.'
  );
  const [kepalaSpiConclusion, setKepalaSpiConclusion] = useState<string>(
    'Profil risiko korporat menunjukkan penurunan eksposur dari tingkat inheren ke residual melalui kontrol eksisting, namun risiko di atas selera risiko tetap menjadi fokus utama audit berbasis risiko (PKPT).'
  );
  const [strategicDirection, setStrategicDirection] = useState<string>(
    'Perkuat pengendalian preventif di Lini Pertama, selesaikan rencana mitigasi risiko tinggi tepat waktu, dan tingkatkan kapabilitas evaluasi risiko SPIP menuju Level 4.'
  );
  const [priorityRiskIds, setPriorityRiskIds] = useState<string[]>([]);
  const [profileStatus, setProfileStatus] = useState<RiskProfileStatus>('Draft');

  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  useEffect(() => {
    if (!isSuperOrKepalaSpi) return;

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
    ];

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [isSuperOrKepalaSpi]);

  // Sync saved profile config for selectedYear
  const currentSavedProfile = useMemo(() => {
    const targetId = `profile-${selectedYear}`;
    return savedProfiles.find((p) => p.id === targetId || p.year === selectedYear) || null;
  }, [savedProfiles, selectedYear]);

  useEffect(() => {
    if (currentSavedProfile) {
      setAppetiteThreshold(currentSavedProfile.appetiteThreshold ?? 10);
      setExtremeToleranceCount(currentSavedProfile.extremeToleranceCount ?? 0);
      setTargetControlEffectivenessPct(currentSavedProfile.targetControlEffectivenessPct ?? 80);
      setTargetMitigationCompletionPct(currentSavedProfile.targetMitigationCompletionPct ?? 85);
      setAppetiteStatement(currentSavedProfile.appetiteStatement || '');
      setPriorityFocusNote(currentSavedProfile.priorityFocusNote || '');
      setKepalaSpiConclusion(currentSavedProfile.kepalaSpiConclusion || '');
      setStrategicDirection(currentSavedProfile.strategicDirection || '');
      setPriorityRiskIds(currentSavedProfile.priorityRiskIds || []);
      setProfileStatus(currentSavedProfile.status || 'Draft');
    } else {
      setAppetiteThreshold(10);
      setExtremeToleranceCount(0);
      setTargetControlEffectivenessPct(80);
      setTargetMitigationCompletionPct(85);
      setPriorityRiskIds([]);
      setProfileStatus('Draft');
    }
    setSelectedMatrixCell(null);
  }, [currentSavedProfile, selectedYear]);

  const yearOptions = useMemo(() => {
    const docYears = [
      ...risks.map((r) => r.year),
      ...savedProfiles.map((p) => p.year),
    ].filter((y) => typeof y === 'number' && y > 0);
    return Array.from(new Set([...availableYears, ...docYears])).sort((a, b) => b - a);
  }, [availableYears, risks, savedProfiles]);

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

  // Strict RBAC guard
  if (!isSuperOrKepalaSpi) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center max-w-xl mx-auto mt-10">
        <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-base font-bold text-slate-900">Akses Terbatas — Khusus Kepala SPI / Super User</h2>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          Modul Profil Risiko Korporat bersifat strategis dan hanya dapat diakses oleh Kepala Satuan Pengawasan Intern (SPI) atau Super User.
        </p>
      </div>
    );
  }

  const getCellColorClass = (score: number) => {
    if (score >= 20) return 'bg-rose-600 text-white border-rose-700';
    if (score >= 12) return 'bg-orange-500 text-white border-orange-600';
    if (score >= 5) return 'bg-amber-400 text-slate-950 border-amber-500';
    if (score >= 3) return 'bg-emerald-500 text-white border-emerald-600';
    return 'bg-emerald-700 text-white border-emerald-800';
  };

  const getLevelBadgeClass = (level: string) => {
    if (level === 'Sangat Tinggi' || level === 'Ekstrem') {
      return 'text-rose-700 bg-rose-50 border-rose-200';
    }
    if (level === 'Tinggi') return 'text-orange-700 bg-orange-50 border-orange-200';
    if (level === 'Sedang') return 'text-amber-800 bg-amber-50 border-amber-200';
    return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  };

  const togglePriorityRisk = (riskId: string) => {
    setPriorityRiskIds((prev) =>
      prev.includes(riskId) ? prev.filter((id) => id !== riskId) : [...prev, riskId]
    );
  };

  const handleSaveProfile = async (overrideStatus?: RiskProfileStatus) => {
    setIsSaving(true);
    setSaveFeedback(null);
    const id = `profile-${selectedYear}`;
    const nowIso = new Date().toISOString();
    const nextStatus = overrideStatus || profileStatus;

    const payload: RiskProfileConfig = {
      id,
      year: selectedYear,
      appetiteThreshold,
      extremeToleranceCount,
      targetControlEffectivenessPct,
      targetMitigationCompletionPct,
      appetiteStatement,
      priorityFocusNote,
      kepalaSpiConclusion,
      strategicDirection,
      priorityRiskIds,
      status: nextStatus,
      snapshotMetrics: {
        totalRisks: analytics.totalRisks,
        avgInherent: analytics.avgInherent,
        avgResidual: analytics.avgResidual,
        reductionPct: analytics.reductionRatePct,
        aboveAppetiteCount: analytics.aboveAppetiteCount,
        effectiveControlPct: analytics.effectiveControlRatePct,
        spipRiskMaturity: analytics.spipIntegration.riskElementAvgScore,
        snapshotAt: nowIso,
      },
      updatedBy: userProfile?.displayName || userProfile?.email || 'Kepala SPI',
      updatedAt: nowIso,
    };

    try {
      await setDoc(doc(db, 'risk_profiles', id), payload, { merge: true });
      if (overrideStatus) setProfileStatus(overrideStatus);
      setSaveFeedback(
        `Profil Risiko ${selectedYear === 0 ? 'Lintas Tahun' : `Tahun ${selectedYear}`} berhasil disimpan ke Firebase (${nextStatus}).`
      );
      setTimeout(() => setSaveFeedback(null), 5000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `risk_profiles/${id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    const summarySheet = XLSX.utils.json_to_sheet([
      {
        'Periode Profil': selectedYear === 0 ? 'Semua Tahun' : selectedYear,
        'Status Penetapan': profileStatus,
        'Ambang Selera Risiko (Max Residual)': appetiteThreshold,
        'Total Risiko': analytics.totalRisks,
        'Skor Inheren Rata-Rata': analytics.avgInherent,
        'Skor Residual Rata-Rata': analytics.avgResidual,
        'Reduksi Risiko (%)': analytics.reductionRatePct,
        'Risiko > Selera Risiko': analytics.aboveAppetiteCount,
        'Efektivitas Kontrol (%)': analytics.effectiveControlRatePct,
        'Penyelesaian Mitigasi (%)': analytics.mitigationCompletionRatePct,
        'Skor Unsur 2 SPIP': analytics.spipIntegration.riskElementAvgScore,
      },
    ]);
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Ikhtisar Profil');

    const catSheet = XLSX.utils.json_to_sheet(
      analytics.categorySummaries.map((c, idx) => ({
        No: idx + 1,
        'Kategori Risiko SPIP': c.category,
        'Jumlah Risiko': c.riskCount,
        'Avg Inheren': c.avgInherent,
        'Avg Residual': c.avgResidual,
        'Maks Residual': c.maxResidual,
        'Melewati Selera Risiko': c.aboveAppetiteCount,
        'Level Dominan': c.dominantLevel,
        'Kontrol Efektif': c.effectiveControlCount,
      }))
    );
    XLSX.utils.book_append_sheet(wb, catSheet, 'Profil 8 Kategori');

    const unitSheet = XLSX.utils.json_to_sheet(
      analytics.unitSummaries.map((u, idx) => ({
        No: idx + 1,
        Kode: u.unitCode,
        'Unit Kerja / Pemilik Risiko': u.unitName,
        'Jumlah Risiko': u.riskCount,
        'Avg Inheren': u.avgInherent,
        'Avg Residual': u.avgResidual,
        'Maks Residual': u.maxResidual,
        'Melewati Selera Risiko': u.aboveAppetiteCount,
        'Kontrol Efektif (%)': u.effectiveControlPct,
        'RCSA Self Score': u.rcsaAvgSelfScore,
        'RCSA SPI Score': u.rcsaAvgSpiScore,
        'Temuan Audit': u.findingsCount,
      }))
    );
    XLSX.utils.book_append_sheet(wb, unitSheet, 'Profil per Unit');

    const topSheet = XLSX.utils.json_to_sheet(
      analytics.topRisks.map((r, idx) => ({
        Peringkat: idx + 1,
        Kode: r.code,
        'Risiko Kunci Kepala SPI': priorityRiskIds.includes(r.id) ? 'YA' : 'TIDAK',
        'Unit Kerja': r.unitName,
        Kategori: r.category,
        'Peristiwa Risiko': r.event,
        'Akar 5M': r.causeCategory5M || '-',
        'Skor Inheren': getEffectiveInherentScore(r),
        'Level Inheren': r.inherentLevel,
        'Skor Residual': getEffectiveResidualScore(r),
        'Level Residual': r.residualLevel,
        'Status Selera':
          getEffectiveResidualScore(r) > appetiteThreshold ? 'Melewati Selera' : 'Dalam Selera',
        'Rencana Mitigasi': r.mitigationPlan,
        PIC: r.pic,
        Status: r.status,
      }))
    );
    XLSX.utils.book_append_sheet(wb, topSheet, 'Daftar Risiko Kunci');

    const yearSlug = selectedYear === 0 ? 'Lintas_Tahun' : String(selectedYear);
    XLSX.writeFile(wb, `Profil_Risiko_Korporat_${yearSlug}.xlsx`);
  };

  const drilldownRisks = useMemo(() => {
    if (!selectedMatrixCell) return [];
    const key = `${selectedMatrixCell.l}-${selectedMatrixCell.i}`;
    return selectedMatrixCell.mode === 'inherent'
      ? analytics.inherentGrid[key] || []
      : analytics.residualGrid[key] || [];
  }, [selectedMatrixCell, analytics]);

  const filteredTopRisks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return analytics.topRisks.filter((r) => {
      if (onlyAboveAppetite && getEffectiveResidualScore(r) <= appetiteThreshold) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.event.toLowerCase().includes(q) ||
        r.unitName.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [analytics.topRisks, onlyAboveAppetite, appetiteThreshold, searchQuery]);

  const yearLabel = selectedYear === 0 ? 'Lintas Tahun (Semua)' : `Tahun ${selectedYear}`;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium mb-1">
            <span>Akses Eksklusif Kepala SPI &amp; Super User</span>
            <span aria-hidden="true">·</span>
            <span>{yearLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-emerald-800">{profileStatus}</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-emerald-700 shrink-0" />
            <span>Profil Risiko Korporat &amp; Unit Kerja</span>
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Konsolidasi peta eksposur risiko 5×5, selera risiko, profil 8 kategori SPIP, ketahanan unit pemilik risiko, dan penetapan risiko kunci korporat.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
              aria-label="Pilih Tahun Profil Risiko"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Tahun {y}
                </option>
              ))}
              <option value={0}>Semua Tahun</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => handleSaveProfile()}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Profil'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-700" />
            <span>Ekspor Excel</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-slate-700" />
            <span>Cetak Resmi</span>
          </button>

          {onNavigateToAnnualReport && (
            <button
              type="button"
              onClick={onNavigateToAnnualReport}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileBarChart2 className="w-3.5 h-3.5 text-emerald-700" />
              <span>Laporan Tahunan</span>
            </button>
          )}
        </div>
      </div>

      {saveFeedback && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-emerald-900">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{saveFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveFeedback(null)}
            className="text-emerald-700 hover:text-emerald-950 font-semibold"
          >
            Tutup
          </button>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Risiko Terpetakan</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{analytics.totalRisks}</p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.unitSummaries.filter((u) => u.riskCount > 0).length} unit pemilik aktif
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Skor Rata-Rata (Inh → Res)</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.avgInherent.toFixed(1)} <span className="text-slate-400 text-base">→</span>{' '}
            <span className="text-emerald-700">{analytics.avgResidual.toFixed(1)}</span>
          </p>
          <p className="text-[11px] text-emerald-700 font-medium mt-1 tabular-nums">
            Reduksi eksposur {analytics.reductionRatePct}%
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Melewati Selera (&gt;{appetiteThreshold})</p>
          <p
            className={`text-2xl font-bold mt-1 tabular-nums ${
              analytics.aboveAppetiteCount > 0 ? 'text-rose-700' : 'text-emerald-700'
            }`}
          >
            {analytics.aboveAppetiteCount}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.aboveAppetitePct}% dari portofolio ({analytics.criticalResidualCount} Ekstrem)
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Efektivitas Kontrol</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.effectiveControlRatePct}%
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            Target ketetapan: ≥ {targetControlEffectivenessPct}%
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Sesuai Kaidah SPIP</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.spiCompliantCount}
            <span className="text-sm font-medium text-slate-400">/{analytics.totalRisks}</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.spiNeedsRevisionCount} perlu perbaikan kaidah
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Mitigasi Selesai</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.mitigationCompletionRatePct}%
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {analytics.mitigationCompletedCount} selesai · {analytics.mitigationInProgressCount} berjalan
          </p>
        </div>
      </div>

      {/* Sub-Navigation Segmented Bar */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-slate-100 border border-slate-200 rounded-xl">
        {[
          { id: 'matrix', label: 'Matriks 5×5 & Pergeseran Risiko', icon: Layers },
          { id: 'categories', label: 'Profil 8 Kategori SPIP & 5M', icon: FileBarChart2 },
          { id: 'units', label: 'Eksposur per Pemilik Risiko', icon: Building2 },
          { id: 'top_risks', label: `Risiko Kunci & Prioritas (${analytics.topRisks.length})`, icon: AlertTriangle },
          { id: 'appetite', label: 'Selera Risiko & Pengesahan Kepala SPI', icon: Sliders },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id as ProfileSubTab)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-emerald-700' : 'text-slate-500'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Empty State Banner when no risks for year */}
      {analytics.totalRisks === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Belum ada data Register Risiko pada {yearLabel}
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Tambahkan entri di Register Risiko 5×5 terlebih dahulu atau pilih opsi "Semua Tahun" untuk melihat profil risiko historis.
            </p>
          </div>
          {onNavigateToRiskRegister && (
            <button
              type="button"
              onClick={onNavigateToRiskRegister}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Buka Register Risiko</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* TAB 1: MATRIKS 5x5 & PERGESERAN */}
      {subTab === 'matrix' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {(['inherent', 'residual'] as const).map((mode) => {
              const grid = mode === 'inherent' ? analytics.inherentGrid : analytics.residualGrid;
              const title =
                mode === 'inherent'
                  ? 'Peta Risiko Inheren (Sebelum Pengendalian)'
                  : 'Peta Risiko Residual (Setelah Pengendalian)';
              const subtitle =
                mode === 'inherent'
                  ? `Rata-rata skor inheren: ${analytics.avgInherent.toFixed(2)}`
                  : `Rata-rata skor residual: ${analytics.avgResidual.toFixed(2)} (Ambang selera: ≤${appetiteThreshold})`;

              return (
                <div key={mode} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                      <p className="text-xs text-slate-500 mt-0.5 tabular-nums">{subtitle}</p>
                    </div>
                    <span className="text-[11px] font-medium text-slate-500">Klik sel untuk rincian</span>
                  </div>

                  <div className="overflow-x-auto">
                    <div className="min-w-[340px]">
                      <div className="grid grid-cols-6 gap-1.5 text-center text-[11px]">
                        <div className="flex items-center justify-center font-semibold text-slate-500 text-[10px]">
                          L \ I
                        </div>
                        {[1, 2, 3, 4, 5].map((imp) => (
                          <div key={imp} className="py-1 font-semibold text-slate-600 bg-slate-50 rounded">
                            Dampak {imp}
                          </div>
                        ))}

                        {[5, 4, 3, 2, 1].map((lik) => (
                          <React.Fragment key={lik}>
                            <div className="flex items-center justify-center font-semibold text-slate-600 bg-slate-50 rounded py-2">
                              K-{lik}
                            </div>
                            {[1, 2, 3, 4, 5].map((imp) => {
                              const cellScore = lik * imp;
                              const count = grid[`${lik}-${imp}`]?.length || 0;
                              const isSelected =
                                selectedMatrixCell?.mode === mode &&
                                selectedMatrixCell.l === lik &&
                                selectedMatrixCell.i === imp;
                              return (
                                <button
                                  key={`${lik}-${imp}`}
                                  type="button"
                                  onClick={() => setSelectedMatrixCell({ mode, l: lik, i: imp })}
                                  className={`relative py-2.5 px-1 rounded-lg border text-center transition-transform cursor-pointer ${getCellColorClass(
                                    cellScore
                                  )} ${
                                    isSelected ? 'ring-2 ring-slate-950 scale-[1.03]' : 'hover:opacity-90'
                                  }`}
                                  title={`Kemungkinan ${lik} × Dampak ${imp} = Skor ${cellScore} (${count} risiko)`}
                                >
                                  <span className="block text-[10px] opacity-85 font-mono tabular-nums">
                                    {cellScore}
                                  </span>
                                  <span className="block text-sm font-extrabold tabular-nums">
                                    {count}
                                  </span>
                                  {mode === 'residual' && cellScore > appetiteThreshold && (
                                    <span className="block text-[9px] font-semibold opacity-95">
                                      &gt;Selera
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Drill-down Panel if Matrix Cell Clicked */}
          {selectedMatrixCell && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Rincian Risiko Sel{' '}
                    {selectedMatrixCell.mode === 'inherent' ? 'Inheren' : 'Residual'} (Kemungkinan{' '}
                    {selectedMatrixCell.l} × Dampak {selectedMatrixCell.i} = Skor{' '}
                    {selectedMatrixCell.l * selectedMatrixCell.i})
                  </h4>
                  <p className="text-xs text-slate-500 tabular-nums">
                    Ditemukan {drilldownRisks.length} peristiwa risiko pada koordinat ini.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMatrixCell(null)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Tutup Rincian
                </button>
              </div>

              {drilldownRisks.length === 0 ? (
                <p className="text-xs text-slate-500 py-3">Tidak ada risiko di koordinat matriks ini.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Kode</th>
                        <th className="py-2 pr-3 font-semibold">Unit Kerja</th>
                        <th className="py-2 pr-3 font-semibold">Peristiwa Risiko</th>
                        <th className="py-2 pr-3 font-semibold text-right">Inheren</th>
                        <th className="py-2 pr-3 font-semibold text-right">Residual</th>
                        <th className="py-2 font-semibold">Mitigasi &amp; PIC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {drilldownRisks.map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            {r.code}
                          </td>
                          <td className="py-2.5 pr-3 text-slate-700">{r.unitName}</td>
                          <td className="py-2.5 pr-3 text-slate-900 font-medium">{r.event}</td>
                          <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                            {getEffectiveInherentScore(r)}
                          </td>
                          <td className="py-2.5 pr-3 text-right font-mono font-bold tabular-nums text-emerald-800">
                            {getEffectiveResidualScore(r)}
                          </td>
                          <td className="py-2.5 text-slate-600">
                            {r.mitigationPlan || '-'} · PIC: {r.pic || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Comparison Table Inherent vs Residual */}
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Tabel Pergeseran Profil Risiko (Inheren vs Residual)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Menunjukkan efektivitas pengendalian internal dalam menurunkan jumlah risiko dari zona tinggi ke zona dapat diterima.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 font-semibold">Tingkat Risiko</th>
                    <th className="py-2.5 px-3 font-semibold">Rentang Skor</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Inheren (Jml)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Inheren (%)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Residual (Jml)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Residual (%)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Selisih Pergeseran</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.levelDistribution.map((row) => (
                    <tr key={row.level} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-3 font-semibold text-slate-900">{row.level}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 tabular-nums">{row.scoreRange}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">{row.inherentCount}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        {row.inherentPct}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-slate-900">
                        {row.residualCount}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        {row.residualPct}%
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                        <span
                          className={
                            row.delta < 0
                              ? 'text-emerald-700'
                              : row.delta > 0
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }
                        >
                          {row.delta > 0 ? `+${row.delta}` : row.delta}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PROFIL 8 KATEGORI & 5M */}
      {subTab === 'categories' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Profil Risiko Berdasarkan 8 Kategori SPIP BPKP
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Perbandingan skor rata-rata inheren, residual, puncak eksposur, dan pelanggaran batas selera risiko per kategori.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2.5 px-3 font-semibold">Kategori Risiko</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Jml</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Avg Inheren</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Avg Residual</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Maks Residual</th>
                    <th className="py-2.5 px-3 font-semibold text-right">&gt; Selera</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Kontrol Efektif</th>
                    <th className="py-2.5 px-3 font-semibold">Tingkat Dominan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.categorySummaries.map((cat) => (
                    <tr key={cat.category} className="hover:bg-slate-50/70">
                      <td className="py-3 px-3">
                        <p className="font-semibold text-slate-900">{cat.category}</p>
                        <p className="text-[11px] text-slate-500 line-clamp-1">{cat.definition}</p>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums">
                        {cat.riskCount}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                        {cat.avgInherent.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold tabular-nums text-emerald-800">
                        {cat.avgResidual.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {cat.maxResidual}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        <span
                          className={
                            cat.aboveAppetiteCount > 0
                              ? 'font-bold text-rose-700'
                              : 'text-slate-500'
                          }
                        >
                          {cat.aboveAppetiteCount}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {cat.effectiveControlCount}/{cat.riskCount}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border text-[11px] font-semibold ${getLevelBadgeClass(
                            cat.riskCount > 0 ? cat.dominantLevel : 'Sangat Rendah'
                          )}`}
                        >
                          {cat.riskCount > 0 ? cat.dominantLevel : 'Nihil'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Profil Akar Masalah Risiko (Kerangka 5M)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Identifikasi faktor penyebab paling dominan agar program mitigasi tepat sasaran.
              </p>
            </div>
            <div className="space-y-3">
              {analytics.cause5MSummaries.map((m) => (
                <div key={m.causeCategory} className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-800">{m.causeCategory}</span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      {m.riskCount} risiko ({m.pct}%) · Avg Residual {m.avgResidual.toFixed(2)} ·{' '}
                      {m.aboveAppetiteCount} di atas selera
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-700 rounded-full"
                      style={{ width: `${Math.min(100, Math.max(m.riskCount > 0 ? 4 : 0, m.pct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: EKSPOSUR PER PEMILIK RISIKO */}
      {subTab === 'units' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900">
              Peringkat Eksposur Risiko per Unit Kerja (Pemilik Risiko)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Diurutkan berdasarkan skor residual puncak, rata-rata residual, keterkaitan RCSA, temuan audit, dan alokasi PKPT.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">Unit Kerja / Pemilik Risiko</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Jml Risiko</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Avg Inheren</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Avg Residual</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Maks Residual</th>
                  <th className="py-2.5 px-3 font-semibold text-right">&gt; Selera</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Kontrol Efektif</th>
                  <th className="py-2.5 px-3 font-semibold text-right">RCSA (Self/SPI)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">PKPT</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Temuan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.unitSummaries.map((u) => (
                  <tr key={u.unitId} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-slate-900">{u.unitName}</p>
                      <p className="text-[11px] text-slate-500">
                        {u.unitCode} · {u.headName}
                      </p>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">
                      {u.riskCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {u.avgInherent.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums text-emerald-800">
                      {u.avgResidual.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums">
                      <span className={u.maxResidual > appetiteThreshold ? 'text-rose-700' : 'text-slate-900'}>
                        {u.maxResidual}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      <span className={u.aboveAppetiteCount > 0 ? 'font-bold text-rose-700' : 'text-slate-500'}>
                        {u.aboveAppetiteCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {u.effectiveControlPct}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {u.rcsaCount > 0 ? `${u.rcsaAvgSelfScore} / ${u.rcsaAvgSpiScore || '-'}` : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{u.pkptCount}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{u.findingsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: TOP RISKS & PRIORITAS KEPALA SPI */}
      {subTab === 'top_risks' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Daftar Risiko Kunci Korporat (Peringkat Skor Residual)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Tandai bintang pada risiko yang ditetapkan Kepala SPI sebagai Risiko Kunci Prioritas pengawasan tahun berjalan, lalu klik "Simpan Profil".
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari kode, unit, peristiwa..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-hidden"
                />
              </div>

              <button
                type="button"
                onClick={() => setOnlyAboveAppetite((v) => !v)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  onlyAboveAppetite
                    ? 'bg-rose-700 text-white border-rose-800'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {onlyAboveAppetite ? `Hanya > Selera (>${appetiteThreshold})` : 'Tampilkan Semua Risiko'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-2 font-semibold text-center w-12">Kunci</th>
                  <th className="py-2.5 px-3 font-semibold">Kode &amp; Unit</th>
                  <th className="py-2.5 px-3 font-semibold">Peristiwa Risiko &amp; Kategori</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Inh</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Res</th>
                  <th className="py-2.5 px-3 font-semibold">Rencana Mitigasi &amp; PIC</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTopRisks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Tidak ada risiko yang sesuai kriteria filter.
                    </td>
                  </tr>
                ) : (
                  filteredTopRisks.map((r) => {
                    const inhScore = getEffectiveInherentScore(r);
                    const resScore = getEffectiveResidualScore(r);
                    const isPinned = priorityRiskIds.includes(r.id);
                    const exceeds = resScore > appetiteThreshold;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/70 align-top">
                        <td className="py-3 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => togglePriorityRisk(r.id)}
                            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                              isPinned
                                ? 'bg-amber-50 border-amber-300 text-amber-600'
                                : 'bg-white border-slate-200 text-slate-300 hover:text-amber-500'
                            }`}
                            title={isPinned ? 'Hapus dari Risiko Kunci Kepala SPI' : 'Tetapkan sebagai Risiko Kunci Kepala SPI'}
                          >
                            <Star className={`w-3.5 h-3.5 ${isPinned ? 'fill-amber-400' : ''}`} />
                          </button>
                        </td>
                        <td className="py-3 px-3">
                          <p className="font-mono font-bold text-slate-900">{r.code}</p>
                          <p className="text-[11px] text-slate-600">{r.unitName}</p>
                        </td>
                        <td className="py-3 px-3 max-w-md">
                          <p className="font-semibold text-slate-900 leading-snug">{r.event}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {r.category} · {r.causeCategory5M || '5M'}
                          </p>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                          {inhScore}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold tabular-nums">
                          <span className={exceeds ? 'text-rose-700' : 'text-emerald-800'}>
                            {resScore}
                          </span>
                          <span className="block text-[10px] font-normal text-slate-500">
                            {exceeds ? 'Melewati Selera' : 'Dalam Selera'}
                          </span>
                        </td>
                        <td className="py-3 px-3 max-w-sm">
                          <p className="text-slate-700 leading-snug">{r.mitigationPlan || '-'}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            PIC: {r.pic || '-'} · Target: {r.targetDate || '-'}
                          </p>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <p className="font-semibold text-slate-800">{r.status}</p>
                          <p className="text-[11px] text-slate-500">{r.spiReviewStatus || 'Diusulkan Auditee'}</p>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 5: PENETAPAN SELERA RISIKO & PENGESAHAN KEPALA SPI */}
      {subTab === 'appetite' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
          <div className="border-b border-slate-100 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Penetapan Selera Risiko, Toleransi &amp; Pengesahan Profil Risiko ({yearLabel})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Parameter ini menjadi acuan otomatis pada Profil Risiko, Laporan Tahunan Manajemen Risiko, dan prioritas audit PKPT.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={profileStatus}
                onChange={(e) => setProfileStatus(e.target.value as RiskProfileStatus)}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
              >
                <option value="Draft">Draft</option>
                <option value="Ditetapkan Kepala SPI">Ditetapkan Kepala SPI</option>
                <option value="Disetujui Direksi">Disetujui Direksi</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Ambang Selera Risiko (Maks Skor Residual)
              </label>
              <select
                value={appetiteThreshold}
                onChange={(e) => setAppetiteThreshold(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg bg-white text-slate-900"
              >
                <option value={4}>4 — Konservatif (Maks Rendah)</option>
                <option value={8}>8 — Moderat Ketat (Maks Sedang Bawah)</option>
                <option value={10}>10 — Standar BPKP (Maks Zona Sedang)</option>
                <option value={12}>12 — Agresif Terbatas (Batas Bawah Tinggi)</option>
                <option value={15}>15 — Tinggi Terkendali</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Toleransi Risiko Ekstrem (Skor 20–25)
              </label>
              <input
                type="number"
                min={0}
                max={20}
                value={extremeToleranceCount}
                onChange={(e) => setExtremeToleranceCount(Math.max(0, parseInt(e.target.value || '0', 10)))}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Efektivitas Kontrol (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={targetControlEffectivenessPct}
                onChange={(e) =>
                  setTargetControlEffectivenessPct(
                    Math.min(100, Math.max(0, parseInt(e.target.value || '0', 10)))
                  )
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Penyelesaian Mitigasi (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={targetMitigationCompletionPct}
                onChange={(e) =>
                  setTargetMitigationCompletionPct(
                    Math.min(100, Math.max(0, parseInt(e.target.value || '0', 10)))
                  )
                }
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pernyataan Selera Risiko Korporat (Risk Appetite Statement)
              </label>
              <textarea
                rows={4}
                value={appetiteStatement}
                onChange={(e) => setAppetiteStatement(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Fokus Pengawasan Prioritas Kepala SPI
              </label>
              <textarea
                rows={4}
                value={priorityFocusNote}
                onChange={(e) => setPriorityFocusNote(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Kesimpulan Evaluasi Profil Risiko oleh Kepala SPI
              </label>
              <textarea
                rows={4}
                value={kepalaSpiConclusion}
                onChange={(e) => setKepalaSpiConclusion(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Arahan Strategis Pengendalian &amp; Mitigasi
              </label>
              <textarea
                rows={4}
                value={strategicDirection}
                onChange={(e) => setStrategicDirection(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
            <p className="text-xs text-slate-500">
              {currentSavedProfile?.updatedAt
                ? `Terakhir disimpan oleh ${currentSavedProfile.updatedBy} pada ${new Date(
                    currentSavedProfile.updatedAt
                  ).toLocaleString('id-ID')}`
                : 'Belum ada penetapan tersimpan untuk periode ini.'}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleSaveProfile('Draft')}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Simpan sebagai Draft
              </button>
              <button
                type="button"
                onClick={() => handleSaveProfile('Ditetapkan Kepala SPI')}
                disabled={isSaving}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                Tetapkan Profil Risiko (Kepala SPI)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Official Print Preview Modal for Profil Risiko */}
      {isPrintModalOpen && (
        <DocumentPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          documentTitle="PROFIL RISIKO KORPORAT & UNIT KERJA (BERBASIS SPIP)"
          documentSubtitle={`${branding.institutionName || 'Perumda Air Minum Tirta Saiyo'} · ${yearLabel}`}
          documentNumber={`PRF-RSK/SPI/${selectedYear === 0 ? 'MULTI' : selectedYear}`}
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
          defaultShowSignatory2={true}
        >
          {() => (
            <div className="space-y-5 text-xs text-slate-900">
              <table className="w-full text-xs border-collapse border border-slate-400">
                <tbody>
                  <tr>
                    <td className="p-2 border border-slate-300 font-semibold bg-slate-50 w-1/3">
                      Periode Profil Risiko
                    </td>
                    <td className="p-2 border border-slate-300">{yearLabel}</td>
                  </tr>
                  <tr>
                    <td className="p-2 border border-slate-300 font-semibold bg-slate-50">
                      Status Penetapan &amp; Ambang Selera
                    </td>
                    <td className="p-2 border border-slate-300">
                      {profileStatus} · Batas Maks Skor Residual: ≤ {appetiteThreshold}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-2 border border-slate-300 font-semibold bg-slate-50">
                      Ringkasan Portofolio Risiko
                    </td>
                    <td className="p-2 border border-slate-300">
                      Total {analytics.totalRisks} risiko · Inheren Rata-rata {analytics.avgInherent.toFixed(2)} → Residual Rata-rata {analytics.avgResidual.toFixed(2)} (Reduksi {analytics.reductionRatePct}%) · {analytics.aboveAppetiteCount} risiko melewati selera
                    </td>
                  </tr>
                </tbody>
              </table>

              <div>
                <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-1.5">
                  1. Pernyataan Selera Risiko &amp; Evaluasi Kepala SPI
                </h4>
                <p className="text-[11px] leading-relaxed mb-1">{appetiteStatement}</p>
                <p className="text-[11px] leading-relaxed">{kepalaSpiConclusion}</p>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-1.5">
                  2. Profil Risiko per 8 Kategori SPIP
                </h4>
                <table className="w-full text-[10px] border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="p-1.5 border border-slate-300 text-left">Kategori</th>
                      <th className="p-1.5 border border-slate-300 text-center">Jml</th>
                      <th className="p-1.5 border border-slate-300 text-center">Avg Inh</th>
                      <th className="p-1.5 border border-slate-300 text-center">Avg Res</th>
                      <th className="p-1.5 border border-slate-300 text-center">&gt; Selera</th>
                      <th className="p-1.5 border border-slate-300 text-left">Level Dominan</th>
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
                        <td className="p-1.5 border border-slate-300">{c.riskCount > 0 ? c.dominantLevel : 'Nihil'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 uppercase text-[11px] mb-1.5">
                  3. Daftar Risiko Prioritas Utama (Top 10 Residual)
                </h4>
                <table className="w-full text-[10px] border-collapse border border-slate-400">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="p-1.5 border border-slate-300">Kode</th>
                      <th className="p-1.5 border border-slate-300 text-left">Unit Kerja</th>
                      <th className="p-1.5 border border-slate-300 text-left">Peristiwa Risiko</th>
                      <th className="p-1.5 border border-slate-300 text-center">Inh</th>
                      <th className="p-1.5 border border-slate-300 text-center">Res</th>
                      <th className="p-1.5 border border-slate-300 text-left">Mitigasi &amp; PIC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topRisks.slice(0, 10).map((r) => (
                      <tr key={r.id}>
                        <td className="p-1.5 border border-slate-300 font-mono">{r.code}</td>
                        <td className="p-1.5 border border-slate-300">{r.unitName}</td>
                        <td className="p-1.5 border border-slate-300">{r.event}</td>
                        <td className="p-1.5 border border-slate-300 text-center">{getEffectiveInherentScore(r)}</td>
                        <td className="p-1.5 border border-slate-300 text-center font-bold">{getEffectiveResidualScore(r)}</td>
                        <td className="p-1.5 border border-slate-300">
                          {r.mitigationPlan} ({r.pic})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
