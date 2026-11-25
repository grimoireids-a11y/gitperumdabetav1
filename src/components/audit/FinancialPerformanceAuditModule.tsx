import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Edit,
  Eye,
  FileBarChart2,
  FileCheck2,
  Layers,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Scale,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { useAppBranding } from '../../context/AppBrandingContext';
import {
  AuditAssignment,
  AuditUniverseItem,
  BPKPSelfAssessment,
  Finding,
  FollowUp,
  Investigation,
  KPIItem,
  KPIMeasurement,
  PKPT,
  Recommendation,
  Regulation,
  RiskRegister,
  RKAItem,
  RKASubItem,
  Unit,
  WBSReport,
} from '../../types/audit';
import {
  FinanceAccount,
  FinanceAsset,
  FinanceAuditTrail,
  FinanceBankReconciliation,
  FinanceCashBankAccount,
  FinanceInventoryItem,
  FinanceJournal,
  FinancePdamMonthlySnapshot,
  FinancePeriodClose,
  FinancePurchaseRecord,
  FinanceReceivablePayable,
  FinanceTaxRecord,
  FinanceTransaction,
} from '../../types/finance';
import {
  FinancialAuditIndicatorItem,
  FinancialAuditPeriodType,
  FinancialAuditStatus,
  FinancialPerformanceAudit,
} from '../../types/financialAudit';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import { formatRp, sanitizeFirestoreRecord } from '../../lib/financeEngine';
import {
  buildFinancialPerformanceAuditData,
  generateFinancialAuditReportNarratives,
  recomputeIndicatorsTotal,
} from '../../lib/financialAuditEngine';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';

type SubTabKey = 'dashboard' | 'kka' | 'laporan' | 'arsip';
type ChapterKey =
  | 'all'
  | 'identitas'
  | 'bab1'
  | 'bab2'
  | 'bab3'
  | 'bab4'
  | 'bab5'
  | 'bab6'
  | 'bab7'
  | 'bab8'
  | 'bab9';

const REPORT_CHAPTERS: Array<{ key: ChapterKey; code: string; title: string }> = [
  { key: 'identitas', code: 'SAMPUL', title: 'Identitas, SPT, Materialitas & Pengendalian' },
  { key: 'bab1', code: 'BAB I', title: 'Ringkasan Eksekutif & Opini Kinerja' },
  { key: 'bab2', code: 'BAB II', title: 'Dasar Hukum, Standar Audit & Metodologi' },
  { key: 'bab3', code: 'BAB III', title: 'Analisis Laporan Keuangan & Rasio Kesehatan' },
  { key: 'bab4', code: 'BAB IV', title: 'Evaluasi RKA Berjenjang, PKPT & Pengadaan' },
  { key: 'bab5', code: 'BAB V', title: 'Audit Kas/Bank, Aset, Persediaan & Pajak' },
  { key: 'bab6', code: 'BAB VI', title: 'Operasional PDAM, Risiko Keuangan, SPIP & KPI' },
  { key: 'bab7', code: 'BAB VII', title: 'Pengendalian Internal, Audit Trail & Temuan 5C' },
  { key: 'bab8', code: 'BAB VIII', title: 'Matriks Penilaian Skor 3E & BPKP (12 Indikator)' },
  { key: 'bab9', code: 'BAB IX', title: 'Simpulan Audit, Komitmen & Rekomendasi Strategis' },
];

const AUDIT_STANDARDS_DEFAULT =
  'Standar Audit Intern Pemerintah Indonesia (AAIPI), Global Internal Audit Standards (GIAS 2024), PP Nomor 60 Tahun 2008 (SPIP), Permendagri Nomor 118 Tahun 2018, dan Pedoman Kinerja BUMD Air Minum BPKP (Kepmendagri 47/1999)';

export const FinancialPerformanceAuditModule: React.FC = () => {
  const { userProfile, hasRole } = useAuth();
  const { activeYear, availableYears } = useFiscalYear();
  const { branding } = useAppBranding();

  const isSuperUser = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);
  const canEdit = hasRole(['KEPALA_SPI', 'AUDITOR', 'ADMIN_SISTEM']);
  const canApprove = isSuperUser;
  const isViewer = !canEdit;

  const [activeSubTab, setActiveSubTab] = useState<SubTabKey>('dashboard');
  const [periodType, setPeriodType] = useState<FinancialAuditPeriodType>('BULANAN');
  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('ALL');
  const [activeChapter, setActiveChapter] = useState<ChapterKey>('all');
  const [dimensionFilter, setDimensionFilter] = useState<string>('ALL');
  const [archiveSearch, setArchiveSearch] = useState<string>('');
  const [archiveTypeFilter, setArchiveTypeFilter] = useState<string>('ALL');

  // Cross-module Firestore states
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [cashBanks, setCashBanks] = useState<FinanceCashBankAccount[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [reconciliations, setReconciliations] = useState<FinanceBankReconciliation[]>([]);
  const [journals, setJournals] = useState<FinanceJournal[]>([]);
  const [periodCloses, setPeriodCloses] = useState<FinancePeriodClose[]>([]);
  const [receivablesPayables, setReceivablesPayables] = useState<FinanceReceivablePayable[]>([]);
  const [assets, setAssets] = useState<FinanceAsset[]>([]);
  const [taxes, setTaxes] = useState<FinanceTaxRecord[]>([]);
  const [inventory, setInventory] = useState<FinanceInventoryItem[]>([]);
  const [purchases, setPurchases] = useState<FinancePurchaseRecord[]>([]);
  const [pdamSnapshots, setPdamSnapshots] = useState<FinancePdamMonthlySnapshot[]>([]);
  const [auditTrails, setAuditTrails] = useState<FinanceAuditTrail[]>([]);

  const [rkaItems, setRkaItems] = useState<RKAItem[]>([]);
  const [rkaSubItems, setRkaSubItems] = useState<RKASubItem[]>([]);
  const [pkptList, setPkptList] = useState<PKPT[]>([]);
  const [auditUniverseList, setAuditUniverseList] = useState<AuditUniverseItem[]>([]);
  const [riskRegisters, setRiskRegisters] = useState<RiskRegister[]>([]);
  const [bpkpAssessments, setBpkpAssessments] = useState<BPKPSelfAssessment[]>([]);
  const [kpiItems, setKpiItems] = useState<KPIItem[]>([]);
  const [kpiMeasurements, setKpiMeasurements] = useState<KPIMeasurement[]>([]);
  const [assignments, setAssignments] = useState<AuditAssignment[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [wbsReports, setWbsReports] = useState<WBSReport[]>([]);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [savedAudits, setSavedAudits] = useState<FinancialPerformanceAudit[]>([]);

  // Active Document Editor States
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [auditNumber, setAuditNumber] = useState<string>('');
  const [auditTitle, setAuditTitle] = useState<string>('');
  const [auditDate, setAuditDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [assignmentId, setAssignmentId] = useState<string>('');
  const [assignmentNumber, setAssignmentNumber] = useState<string>('');
  const [auditStandards, setAuditStandards] = useState<string>(AUDIT_STANDARDS_DEFAULT);
  const [materialityAmount, setMaterialityAmount] = useState<number>(25000000);
  const [materialityBasis, setMaterialityBasis] = useState<string>('1% dari Total Pendapatan Usaha / Belanja Operasional');
  const [supervisor, setSupervisor] = useState<string>('Kepala Satuan Pengawasan Intern (SPI)');
  const [teamLeader, setTeamLeader] = useState<string>('');
  const [teamMembers, setTeamMembers] = useState<string>('');
  const [preparedBy, setPreparedBy] = useState<string>('');
  const [recipient, setRecipient] = useState<string>('Direktur & Dewan Pengawas Perumda Air Minum Tirta Saiyo');
  const [status, setStatus] = useState<FinancialAuditStatus>('Draft');

  const [indicatorsState, setIndicatorsState] = useState<FinancialAuditIndicatorItem[]>([]);
  const [bab1ExecutiveSummary, setBab1ExecutiveSummary] = useState('');
  const [bab2BasisScopeMethodology, setBab2BasisScopeMethodology] = useState('');
  const [bab3FinancialStatementsAnalysis, setBab3FinancialStatementsAnalysis] = useState('');
  const [bab4BudgetRkaProcurementEval, setBab4BudgetRkaProcurementEval] = useState('');
  const [bab5TreasuryAssetsTaxEval, setBab5TreasuryAssetsTaxEval] = useState('');
  const [bab6OperationalPdamRiskKpi, setBab6OperationalPdamRiskKpi] = useState('');
  const [bab7InternalControlFindingsTlr, setBab7InternalControlFindingsTlr] = useState('');
  const [bab8ScoringMatrixAnalysis, setBab8ScoringMatrixAnalysis] = useState('');
  const [bab9ConclusionRecommendations, setBab9ConclusionRecommendations] = useState('');
  const [managementCommitment, setManagementCommitment] = useState('');

  // Feedback, Escalation & Modal States
  const [isSaving, setIsSaving] = useState(false);
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<FinancialPerformanceAudit | null>(null);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  // Real-time listeners to ALL related lines across the application
  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'fin_accounts'), (s) =>
        setAccounts(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceAccount)))
      ),
      onSnapshot(collection(db, 'fin_cash_banks'), (s) =>
        setCashBanks(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceCashBankAccount)))
      ),
      onSnapshot(collection(db, 'fin_transactions'), (s) =>
        setTransactions(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceTransaction)))
      ),
      onSnapshot(collection(db, 'fin_bank_reconciliations'), (s) =>
        setReconciliations(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceBankReconciliation)))
      ),
      onSnapshot(collection(db, 'fin_journals'), (s) =>
        setJournals(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceJournal)))
      ),
      onSnapshot(collection(db, 'fin_period_closes'), (s) =>
        setPeriodCloses(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePeriodClose)))
      ),
      onSnapshot(collection(db, 'fin_receivables_payables'), (s) =>
        setReceivablesPayables(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceReceivablePayable)))
      ),
      onSnapshot(collection(db, 'fin_assets'), (s) =>
        setAssets(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceAsset)))
      ),
      onSnapshot(collection(db, 'fin_taxes'), (s) =>
        setTaxes(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceTaxRecord)))
      ),
      onSnapshot(collection(db, 'fin_inventory'), (s) =>
        setInventory(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceInventoryItem)))
      ),
      onSnapshot(collection(db, 'fin_purchases'), (s) =>
        setPurchases(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePurchaseRecord)))
      ),
      onSnapshot(collection(db, 'fin_pdam_reports'), (s) =>
        setPdamSnapshots(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePdamMonthlySnapshot)))
      ),
      onSnapshot(collection(db, 'fin_audit_trails'), (s) =>
        setAuditTrails(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceAuditTrail)))
      ),
      onSnapshot(collection(db, 'rka_items'), (s) =>
        setRkaItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as RKAItem)))
      ),
      onSnapshot(collection(db, 'rka_sub_items'), (s) =>
        setRkaSubItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as RKASubItem)))
      ),
      onSnapshot(collection(db, 'pkpt'), (s) =>
        setPkptList(s.docs.map((d) => ({ id: d.id, ...d.data() } as PKPT)))
      ),
      onSnapshot(collection(db, 'audit_universe'), (s) =>
        setAuditUniverseList(s.docs.map((d) => ({ id: d.id, ...d.data() } as AuditUniverseItem)))
      ),
      onSnapshot(collection(db, 'risk_registers'), (s) =>
        setRiskRegisters(s.docs.map((d) => ({ id: d.id, ...d.data() } as RiskRegister)))
      ),
      onSnapshot(collection(db, 'bpkp_assessments'), (s) =>
        setBpkpAssessments(s.docs.map((d) => ({ id: d.id, ...d.data() } as BPKPSelfAssessment)))
      ),
      onSnapshot(collection(db, 'kpi_items'), (s) =>
        setKpiItems(s.docs.map((d) => ({ id: d.id, ...d.data() } as KPIItem)))
      ),
      onSnapshot(collection(db, 'kpi_measurements'), (s) =>
        setKpiMeasurements(s.docs.map((d) => ({ id: d.id, ...d.data() } as KPIMeasurement)))
      ),
      onSnapshot(collection(db, 'audit_assignments'), (s) =>
        setAssignments(s.docs.map((d) => ({ id: d.id, ...d.data() } as AuditAssignment)))
      ),
      onSnapshot(collection(db, 'findings'), (s) =>
        setFindings(s.docs.map((d) => ({ id: d.id, ...d.data() } as Finding)))
      ),
      onSnapshot(collection(db, 'recommendations'), (s) =>
        setRecommendations(s.docs.map((d) => ({ id: d.id, ...d.data() } as Recommendation)))
      ),
      onSnapshot(collection(db, 'follow_ups'), (s) =>
        setFollowUps(s.docs.map((d) => ({ id: d.id, ...d.data() } as FollowUp)))
      ),
      onSnapshot(collection(db, 'wbs_reports'), (s) =>
        setWbsReports(s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSReport)))
      ),
      onSnapshot(collection(db, 'investigations'), (s) =>
        setInvestigations(s.docs.map((d) => ({ id: d.id, ...d.data() } as Investigation)))
      ),
      onSnapshot(collection(db, 'regulations'), (s) =>
        setRegulations(s.docs.map((d) => ({ id: d.id, ...d.data() } as Regulation)))
      ),
      onSnapshot(collection(db, 'units'), (s) =>
        setUnits(s.docs.map((d) => ({ id: d.id, ...d.data() } as Unit)))
      ),
      onSnapshot(
        collection(db, 'fin_performance_audits'),
        (s) => setSavedAudits(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinancialPerformanceAudit))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'fin_performance_audits')
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  const targetUnitName = useMemo(() => {
    if (selectedUnitId === 'ALL') return 'Seluruh Unit Kerja & Wilayah Pelayanan (Konsolidasi)';
    return units.find((u) => u.id === selectedUnitId)?.name || 'Unit Kerja';
  }, [selectedUnitId, units]);

  const yearOptions = useMemo(() => {
    const yrs = new Set<number>([
      ...availableYears,
      ...transactions.map((t) => t.year),
      ...rkaItems.map((r) => r.year),
      ...savedAudits.map((a) => a.year),
    ]);
    return Array.from(yrs)
      .filter((y) => typeof y === 'number' && y > 0)
      .sort((a, b) => b - a);
  }, [availableYears, transactions, rkaItems, savedAudits]);

  // Live cross-line engine calculation
  const liveEngine = useMemo(() => {
    return buildFinancialPerformanceAuditData({
      periodType,
      year: selectedYear,
      month: periodType === 'BULANAN' ? selectedMonth : undefined,
      unitFilterId: selectedUnitId,
      accounts,
      cashBanks,
      transactions,
      reconciliations,
      journals,
      periodCloses,
      receivablesPayables,
      assets,
      taxes,
      inventory,
      purchases,
      pdamSnapshots,
      auditTrails,
      rkaItems,
      rkaSubItems,
      pkptList,
      auditUniverseList,
      riskRegisters,
      bpkpAssessments,
      kpiItems,
      kpiMeasurements,
      assignments,
      findings,
      recommendations,
      followUps,
      wbsReports,
      investigations,
      regulations,
    });
  }, [
    periodType,
    selectedYear,
    selectedMonth,
    selectedUnitId,
    accounts,
    cashBanks,
    transactions,
    reconciliations,
    journals,
    periodCloses,
    receivablesPayables,
    assets,
    taxes,
    inventory,
    purchases,
    pdamSnapshots,
    auditTrails,
    rkaItems,
    rkaSubItems,
    pkptList,
    auditUniverseList,
    riskRegisters,
    bpkpAssessments,
    kpiItems,
    kpiMeasurements,
    assignments,
    findings,
    recommendations,
    followUps,
    wbsReports,
    investigations,
    regulations,
  ]);

  const snapshot = liveEngine.snapshot;
  const institutionName =
    branding.institutionName || 'Perumda Air Minum Tirta Saiyo Kabupaten Pasaman';

  const canonicalDocId = useMemo(() => {
    const unitSlug = selectedUnitId === 'ALL' ? 'all' : selectedUnitId;
    return periodType === 'BULANAN'
      ? `fin-audit-bln-${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${unitSlug}`
      : `fin-audit-thn-${selectedYear}-${unitSlug}`;
  }, [periodType, selectedYear, selectedMonth, selectedUnitId]);

  const currentDocId = editingDocId || canonicalDocId;
  const matchedSavedDoc = useMemo(
    () => savedAudits.find((a) => a.id === currentDocId) || null,
    [savedAudits, currentDocId]
  );

  // Scored state from editable indicatorsState (or fallback to liveEngine.indicators)
  const effectiveScored = useMemo(() => {
    const list = indicatorsState.length > 0 ? indicatorsState : liveEngine.indicators;
    return recomputeIndicatorsTotal(list);
  }, [indicatorsState, liveEngine.indicators]);

  const applyGeneratedNarratives = (customIndicators?: FinancialAuditIndicatorItem[]) => {
    const inds = customIndicators || (indicatorsState.length > 0 ? indicatorsState : liveEngine.indicators);
    const recomputed = recomputeIndicatorsTotal(inds);
    const mergedSnapshot = {
      ...snapshot,
      totalCompositeScore: recomputed.totalScore,
      dimensionScores: recomputed.dimensionScores,
      predicate: recomputed.predicate,
    };
    const gen = generateFinancialAuditReportNarratives({
      snapshot: mergedSnapshot,
      indicators: recomputed.indicators,
      institutionName,
      unitName: targetUnitName,
      materialityAmount,
      auditStandards,
    });
    setBab1ExecutiveSummary(gen.bab1ExecutiveSummary);
    setBab2BasisScopeMethodology(gen.bab2BasisScopeMethodology);
    setBab3FinancialStatementsAnalysis(gen.bab3FinancialStatementsAnalysis);
    setBab4BudgetRkaProcurementEval(gen.bab4BudgetRkaProcurementEval);
    setBab5TreasuryAssetsTaxEval(gen.bab5TreasuryAssetsTaxEval);
    setBab6OperationalPdamRiskKpi(gen.bab6OperationalPdamRiskKpi);
    setBab7InternalControlFindingsTlr(gen.bab7InternalControlFindingsTlr);
    setBab8ScoringMatrixAnalysis(gen.bab8ScoringMatrixAnalysis);
    setBab9ConclusionRecommendations(gen.bab9ConclusionRecommendations);
    setManagementCommitment(gen.managementCommitment);
  };

  // Load saved document OR initialize draft when period/unit/doc changes
  useEffect(() => {
    if (matchedSavedDoc) {
      setAuditNumber(matchedSavedDoc.auditNumber);
      setAuditTitle(matchedSavedDoc.auditTitle);
      setAuditDate(matchedSavedDoc.auditDate);
      setAssignmentId(matchedSavedDoc.assignmentId || '');
      setAssignmentNumber(matchedSavedDoc.assignmentNumber || '');
      setAuditStandards(matchedSavedDoc.auditStandards || AUDIT_STANDARDS_DEFAULT);
      setMaterialityAmount(matchedSavedDoc.materialityAmount || 25000000);
      setMaterialityBasis(
        matchedSavedDoc.materialityBasis || '1% dari Total Pendapatan Usaha / Belanja Operasional'
      );
      setSupervisor(matchedSavedDoc.supervisor || 'Kepala Satuan Pengawasan Intern (SPI)');
      setTeamLeader(matchedSavedDoc.teamLeader || '');
      setTeamMembers(matchedSavedDoc.teamMembers || '');
      setPreparedBy(matchedSavedDoc.preparedBy || userProfile?.displayName || 'Auditor SPI');
      setRecipient(
        matchedSavedDoc.recipient ||
          `Direktur & Dewan Pengawas ${branding.shortInstitutionName || 'Perumda Tirta Saiyo'}`
      );
      setStatus(matchedSavedDoc.status);
      setIndicatorsState(
        matchedSavedDoc.indicators?.length ? matchedSavedDoc.indicators : liveEngine.indicators
      );
      setBab1ExecutiveSummary(matchedSavedDoc.bab1ExecutiveSummary || '');
      setBab2BasisScopeMethodology(matchedSavedDoc.bab2BasisScopeMethodology || '');
      setBab3FinancialStatementsAnalysis(matchedSavedDoc.bab3FinancialStatementsAnalysis || '');
      setBab4BudgetRkaProcurementEval(matchedSavedDoc.bab4BudgetRkaProcurementEval || '');
      setBab5TreasuryAssetsTaxEval(matchedSavedDoc.bab5TreasuryAssetsTaxEval || '');
      setBab6OperationalPdamRiskKpi(matchedSavedDoc.bab6OperationalPdamRiskKpi || '');
      setBab7InternalControlFindingsTlr(matchedSavedDoc.bab7InternalControlFindingsTlr || '');
      setBab8ScoringMatrixAnalysis(matchedSavedDoc.bab8ScoringMatrixAnalysis || '');
      setBab9ConclusionRecommendations(matchedSavedDoc.bab9ConclusionRecommendations || '');
      setManagementCommitment(matchedSavedDoc.managementCommitment || '');
    } else {
      const mStr = String(selectedMonth).padStart(2, '0');
      const mName = FISCAL_MONTHS[selectedMonth - 1] || 'Januari';
      setAuditNumber(
        periodType === 'BULANAN'
          ? `700.1/AKK-BLN/${mStr}/${selectedYear}`
          : `700.1/AKK-THN/${selectedYear}`
      );
      setAuditTitle(
        periodType === 'BULANAN'
          ? `LAPORAN HASIL AUDIT KINERJA KEUANGAN BULAN ${mName.toUpperCase()} ${selectedYear}`
          : `LAPORAN HASIL AUDIT KINERJA KEUANGAN TAHUNAN TAHUN BUKU ${selectedYear}`
      );
      setAuditDate(new Date().toISOString().slice(0, 10));
      setAssignmentId('');
      setAssignmentNumber('');
      setAuditStandards(AUDIT_STANDARDS_DEFAULT);
      const suggestedMateriality = Math.max(
        5000000,
        Math.round(
          Math.max(snapshot.operatingRevenue, snapshot.totalExpense, snapshot.rkaTotalBudget, 1000000000) *
            0.01
        )
      );
      setMaterialityAmount(suggestedMateriality);
      setSupervisor('Kepala Satuan Pengawasan Intern (SPI)');
      setTeamLeader(userProfile?.displayName || 'Ketua Tim Audit Kinerja Keuangan');
      setTeamMembers('Tim Auditor Keuangan & Kepatuhan SPI');
      setPreparedBy(userProfile?.displayName || 'Tim Audit SPI');
      setRecipient(
        `Direktur & Dewan Pengawas ${branding.shortInstitutionName || 'Perumda Tirta Saiyo'}`
      );
      setStatus('Draft');
      setIndicatorsState(liveEngine.indicators);
      applyGeneratedNarratives(liveEngine.indicators);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDocId, matchedSavedDoc?.id]);

  // Helper to show temporary notice
  const pushNotice = (kind: 'success' | 'error', text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 5500);
  };

  // Sync SPT assignment selection
  const handleSelectSpt = (id: string) => {
    setAssignmentId(id);
    const found = assignments.find((a) => a.id === id);
    if (!found) {
      setAssignmentNumber('');
      return;
    }
    setAssignmentNumber(found.letterNumber);
    if (found.supervisor) setSupervisor(found.supervisor);
    if (found.teamLeader) setTeamLeader(found.teamLeader);
    if (found.teamMembers) setTeamMembers(found.teamMembers);
    if (found.unitId) setSelectedUnitId(found.unitId);
  };

  // Update individual indicator score/notes
  const handleUpdateIndicator = (
    indId: string,
    patch: Partial<Pick<FinancialAuditIndicatorItem, 'auditorScore' | 'auditorNotes'>>
  ) => {
    if (!canEdit) return;
    setIndicatorsState((prev) => {
      const base = prev.length > 0 ? prev : liveEngine.indicators;
      const next = base.map((item) => (item.id === indId ? { ...item, ...patch } : item));
      return recomputeIndicatorsTotal(next).indicators;
    });
  };

  // Refresh system metrics inside KKA while preserving manual auditor notes/finding links
  const handleResyncSystemMetrics = () => {
    const existingMap = new Map(indicatorsState.map((i) => [i.id, i]));
    const refreshed = liveEngine.indicators.map((sysInd) => {
      const prev = existingMap.get(sysInd.id);
      return {
        ...sysInd,
        auditorNotes: prev?.auditorNotes || sysInd.auditorNotes,
        linkedFindingId: prev?.linkedFindingId,
        linkedFindingNumber: prev?.linkedFindingNumber,
      };
    });
    const recomputed = recomputeIndicatorsTotal(refreshed).indicators;
    setIndicatorsState(recomputed);
    applyGeneratedNarratives(recomputed);
    pushNotice(
      'success',
      `Data lintas modul & 12 indikator KKA periode ${snapshot.periodLabel} berhasil disinkronkan dari database aktual.`
    );
  };

  // Save Audit Report to Firestore
  const handleSaveAudit = async (overrideStatus?: FinancialAuditStatus) => {
    if (!canEdit) return;
    setIsSaving(true);
    const nowIso = new Date().toISOString();
    const nextStatus = overrideStatus || status;
    const targetId = currentDocId;

    const payload: FinancialPerformanceAudit = sanitizeFirestoreRecord({
      id: targetId,
      auditNumber: auditNumber.trim() || targetId.toUpperCase(),
      auditTitle: auditTitle.trim() || `Audit Kinerja Keuangan ${snapshot.periodLabel}`,
      periodType,
      year: selectedYear,
      ...(periodType === 'BULANAN'
        ? { month: selectedMonth, monthName: FISCAL_MONTHS[selectedMonth - 1] }
        : {}),
      auditDate,
      assignmentId: assignmentId || undefined,
      assignmentNumber: assignmentNumber || undefined,
      unitId: selectedUnitId,
      unitName: targetUnitName,
      auditStandards,
      materialityAmount,
      materialityBasis,
      supervisor,
      teamLeader,
      teamMembers,
      preparedBy: preparedBy.trim() || userProfile?.displayName || 'Auditor SPI',
      recipient,
      indicators: effectiveScored.indicators,
      totalScore: effectiveScored.totalScore,
      predicate: effectiveScored.predicate,
      dimensionScores: effectiveScored.dimensionScores,
      bab1ExecutiveSummary,
      bab2BasisScopeMethodology,
      bab3FinancialStatementsAnalysis,
      bab4BudgetRkaProcurementEval,
      bab5TreasuryAssetsTaxEval,
      bab6OperationalPdamRiskKpi,
      bab7InternalControlFindingsTlr,
      bab8ScoringMatrixAnalysis,
      bab9ConclusionRecommendations,
      managementCommitment,
      snapshotSummary: {
        totalAssets: snapshot.totalAssets,
        totalRevenue: snapshot.totalRevenue,
        totalExpense: snapshot.totalExpense,
        netIncome: snapshot.netIncome,
        fcrPct: snapshot.fcrPct,
        currentRatioPct: snapshot.currentRatioPct,
        operatingRatioPct: snapshot.operatingRatioPct,
        rkaAbsorptionPct: snapshot.rkaAbsorptionPct,
        pdamCollectionEfficiencyPct: snapshot.pdamCollectionEfficiencyPct,
        pdamNrwPct: snapshot.pdamNrwPct,
        financeFindingsTotal: snapshot.financeFindingsTotal,
        financeFindingsPotentialLoss: snapshot.financeFindingsPotentialLoss,
        computedAt: snapshot.computedAt,
      },
      status: nextStatus,
      reviewedBy:
        nextStatus === 'Review Pengendali Teknis'
          ? userProfile?.displayName || 'Pengendali Teknis'
          : matchedSavedDoc?.reviewedBy,
      reviewedAt:
        nextStatus === 'Review Pengendali Teknis' ? nowIso : matchedSavedDoc?.reviewedAt,
      approvedBy:
        nextStatus === 'Final / Disahkan ke Direksi & Dewas'
          ? userProfile?.displayName || 'Kepala SPI'
          : matchedSavedDoc?.approvedBy,
      approvedAt:
        nextStatus === 'Final / Disahkan ke Direksi & Dewas'
          ? nowIso
          : matchedSavedDoc?.approvedAt,
      createdBy: matchedSavedDoc?.createdBy || userProfile?.displayName || 'Auditor SPI',
      createdByRole: matchedSavedDoc?.createdByRole || userProfile?.role || 'AUDITOR',
      createdAt: matchedSavedDoc?.createdAt || nowIso,
      updatedAt: nowIso,
    });

    try {
      await setDoc(doc(db, 'fin_performance_audits', payload.id), payload, { merge: true });
      if (overrideStatus) setStatus(overrideStatus);
      pushNotice(
        'success',
        `Audit Kinerja Keuangan (${payload.auditNumber}) berhasil disimpan ke database.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `fin_performance_audits/${payload.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Delete saved audit (Super User)
  const handleConfirmDelete = async () => {
    if (!deleteConfirmTarget || !isSuperUser) return;
    try {
      await deleteDoc(doc(db, 'fin_performance_audits', deleteConfirmTarget.id));
      if (editingDocId === deleteConfirmTarget.id) {
        setEditingDocId(null);
      }
      pushNotice('success', `Dokumen audit ${deleteConfirmTarget.auditNumber} telah dihapus.`);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `fin_performance_audits/${deleteConfirmTarget.id}`
      );
    } finally {
      setDeleteConfirmTarget(null);
    }
  };

  // Escalate single indicator directly into 5C Findings & Recommendation
  const handleEscalateTo5C = async (ind: FinancialAuditIndicatorItem) => {
    if (!canEdit) return;
    setEscalatingId(ind.id);
    const nowIso = new Date().toISOString();
    const fId = `fnd-akk-${Date.now()}`;
    const findingNum = `5C/AKK/${selectedYear}/${String(findings.length + 1).padStart(3, '0')}`;
    const targetUnit =
      selectedUnitId !== 'ALL'
        ? units.find((u) => u.id === selectedUnitId)
        : units.find((u) => u.name.toLowerCase().includes('keuangan')) || units[0];

    const findingPayload: Finding = sanitizeFirestoreRecord({
      id: fId,
      findingNumber: findingNum,
      year: selectedYear,
      assignmentId: assignmentId || '',
      assignmentTitle: auditTitle,
      unitId: targetUnit?.id || 'unit-keuangan',
      unitName: targetUnit?.name || targetUnitName,
      title: `[Audit Kinerja Keuangan] ${ind.name} (${ind.systemFormatted})`,
      category: 'Keuangan, Anggaran & Kepatuhan',
      riskLevel: ind.auditorScore <= 2 ? 'Tinggi' : 'Sedang',
      condition: `Pada audit kinerja keuangan periode ${snapshot.periodLabel}, indikator [${ind.code}] ${ind.name} tercatat sebesar ${ind.systemFormatted} (Skor ${ind.auditorScore}/5 · ${ind.verdict}). ${ind.evidenceSummary}`,
      criteria: `${ind.standardRef} menetapkan ambang kinerja ${ind.benchmarkLabel} dengan rumus ${ind.formulaDesc}.`,
      cause: ind.auditorNotes || 'Pengendalian operasional keuangan dan pemantauan berkala belum berjalan optimal.',
      consequence:
        'Berpotensi menurunkan rasio kesehatan keuangan BUMD, menghambat likuiditas kas, atau menimbulkan risiko kepatuhan akuntansi & fiskal.',
      potentialLoss: 0,
      auditorAnalysis: `Dieskalasi otomatis dari Kertas Kerja Audit Kinerja Keuangan (${auditNumber}) untuk tindak lanjut terukur oleh unit kerja terkait.`,
      status: 'Tindak Lanjut',
      sourceType: 'AUDIT_REGULER',
      createdBy: userProfile?.displayName || 'Auditor SPI',
      createdByUid: userProfile?.uid || '',
      createdByRole: userProfile?.role || 'AUDITOR',
      createdAt: nowIso,
    });

    const rId = `rec-akk-${Date.now()}`;
    const recNum = `REC/AKK/${selectedYear}/${String(recommendations.length + 1).padStart(3, '0')}`;
    const targetDateObj = new Date();
    targetDateObj.setDate(targetDateObj.getDate() + 30);

    const recPayload: Recommendation = sanitizeFirestoreRecord({
      id: rId,
      findingId: fId,
      findingNumber: findingNum,
      findingTitle: findingPayload.title,
      unitId: findingPayload.unitId,
      unitName: findingPayload.unitName,
      sourceType: 'AUDIT_REGULER',
      createdByUid: userProfile?.uid || '',
      recNumber: recNum,
      description: `Melakukan langkah korektif terukur atas indikator ${ind.name} agar mencapai benchmark ${ind.benchmarkLabel}, disertai dokumen bukti perbaikan dan rekonsiliasi ke SPI.`,
      pic: `Kepala ${findingPayload.unitName}`,
      targetDate: targetDateObj.toISOString().slice(0, 10),
      successIndicator: `Capaian ${ind.name} memenuhi benchmark ${ind.benchmarkLabel} dan bukti aksi terverifikasi SPI.`,
      status: 'Belum Ditindaklanjuti',
    });

    try {
      await setDoc(doc(db, 'findings', fId), findingPayload);
      await setDoc(doc(db, 'recommendations', rId), recPayload);

      setIndicatorsState((prev) => {
        const base = prev.length > 0 ? prev : liveEngine.indicators;
        return base.map((item) =>
          item.id === ind.id
            ? { ...item, linkedFindingId: fId, linkedFindingNumber: findingNum }
            : item
        );
      });
      pushNotice(
        'success',
        `Indikator ${ind.code} berhasil dieskalasi ke Temuan Audit 5C (${findingNum}) & Rekomendasi (${recNum}).`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `findings/${fId}`);
    } finally {
      setEscalatingId(null);
    }
  };

  // Multi-Sheet Excel Export
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          'Nomor Audit': auditNumber,
          'Judul Laporan': auditTitle,
          'Jenis Periode': periodType,
          Periode: snapshot.periodLabel,
          'Entitas / Unit': targetUnitName,
          Status: status,
          'Skor Komposit (0-100)': effectiveScored.totalScore,
          Predikat: effectiveScored.predicate,
          'Materialitas (Rp)': materialityAmount,
          'Total Aset (Rp)': snapshot.totalAssets,
          'Total Kewajiban (Rp)': snapshot.totalLiabilities,
          'Total Ekuitas (Rp)': snapshot.totalEquity,
          'Total Pendapatan (Rp)': snapshot.totalRevenue,
          'Total Beban (Rp)': snapshot.totalExpense,
          'Laba/Rugi Bersih (Rp)': snapshot.netIncome,
          'FCR (%)': snapshot.fcrPct,
          'Operating Ratio (%)': snapshot.operatingRatioPct,
          'Current Ratio (%)': snapshot.currentRatioPct,
          'Cash Ratio (%)': snapshot.cashRatioPct,
          'DER (%)': snapshot.debtToEquityRatioPct,
          'Saldo Kas/Bank (Rp)': snapshot.totalLiquidBalance,
          'Penyerapan RKA (%)': snapshot.rkaAbsorptionPct,
          'Efisiensi Penagihan PDAM (%)': snapshot.pdamCollectionEfficiencyPct,
          'NRW (%)': snapshot.pdamNrwPct,
          'Temuan Keuangan 5C': snapshot.financeFindingsTotal,
          'Potensi Kerugian (Rp)': snapshot.financeFindingsPotentialLoss,
          'Penyelesaian TLR (%)': snapshot.financeRecsCompletionPct,
        },
      ]),
      'Ikhtisar Eksekutif'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        effectiveScored.indicators.map((ind) => ({
          Kode: ind.code,
          Dimensi: ind.dimensionLabel,
          Indikator: ind.name,
          Standar: ind.standardRef,
          Benchmark: ind.benchmarkLabel,
          'Nilai Aktual Sistem': ind.systemFormatted,
          'Bobot (%)': ind.weight,
          'Skor Sistem (1-5)': ind.systemScore,
          'Skor Auditor (1-5)': ind.auditorScore,
          'Poin Terbobot': ind.weightedPoints,
          Verdict: ind.verdict,
          'Sumber Modul': ind.sourceModule,
          'Bukti Data': ind.evidenceSummary,
          'Catatan Auditor': ind.auditorNotes,
          'Link Temuan 5C': ind.linkedFindingNumber || '-',
        }))
      ),
      'Matriks Skor 3E & BPKP'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        snapshot.rkaBreakdown.map((r) => ({
          'Kode RKA': r.code,
          'Program Induk': r.programName,
          Kategori: r.category,
          Unit: r.unitName,
          'Pagu (Rp)': r.budgetAmount,
          'Total Realisasi (Rp)': r.totalRealization,
          'Sisa Anggaran (Rp)': r.remainingBudget,
          'Penyerapan (%)': r.absorptionPct,
          'Status Pagu': r.isOverBudget ? 'Overbudget' : 'Terkendali',
          'Sub Program': r.subCount,
          'Sub Terverifikasi': r.verifiedSubCount,
        }))
      ),
      'Evaluasi Anggaran RKA'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        snapshot.earlyWarnings.length > 0
          ? snapshot.earlyWarnings.map((w) => ({
              Tingkat: w.severity,
              Kategori: w.category,
              Peringatan: w.title,
              Nilai: w.metricValue,
              Detail: w.detail,
            }))
          : [{ Keterangan: 'Tidak ada peringatan dini keuangan pada periode ini.' }]
      ),
      'Early Warning Keuangan'
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        snapshot.monthlyTrend.map((m) => ({
          Bulan: m.monthName,
          'Penerimaan Kas (Rp)': m.receipts,
          'Pengeluaran Kas (Rp)': m.expenses,
          'Arus Kas Neto (Rp)': m.netCashFlow,
          'Realisasi RKA (Rp)': m.rkaRealization,
          'Jumlah Transaksi': m.txCount,
          'Alert Duplikat': m.duplicateFlags,
          'Temuan 5C': m.findingsCount,
        }))
      ),
      'Tren Bulanan Jan-Des'
    );

    const slug =
      periodType === 'BULANAN'
        ? `Bulanan_${String(selectedMonth).padStart(2, '0')}_${selectedYear}`
        : `Tahunan_${selectedYear}`;
    XLSX.writeFile(wb, `Audit_Kinerja_Keuangan_${slug}.xlsx`);
    pushNotice('success', `Workbook Excel Audit Kinerja Keuangan (${slug}) berhasil diunduh.`);
  };

  const filteredIndicators = useMemo(() => {
    if (dimensionFilter === 'ALL') return effectiveScored.indicators;
    return effectiveScored.indicators.filter((i) => i.dimension === dimensionFilter);
  }, [effectiveScored.indicators, dimensionFilter]);

  const filteredSavedAudits = useMemo(() => {
    return [...savedAudits]
      .filter((a) => {
        const matchType = archiveTypeFilter === 'ALL' || a.periodType === archiveTypeFilter;
        const q = archiveSearch.trim().toLowerCase();
        const matchSearch =
          !q ||
          a.auditNumber.toLowerCase().includes(q) ||
          a.auditTitle.toLowerCase().includes(q) ||
          (a.unitName || '').toLowerCase().includes(q);
        return matchType && matchSearch;
      })
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }, [savedAudits, archiveSearch, archiveTypeFilter]);

  const showChapter = (key: Exclude<ChapterKey, 'all'>) =>
    activeChapter === 'all' || activeChapter === key;

  const getScoreColorClass = (score: number) => {
    if (score >= 85) return 'text-emerald-700';
    if (score >= 70) return 'text-teal-700';
    if (score >= 55) return 'text-amber-700';
    return 'text-rose-700';
  };

  const getVerdictColorClass = (verdict: string) => {
    if (verdict === 'Sesuai Standar') return 'text-emerald-700 font-semibold';
    if (verdict === 'Perlu Perhatian') return 'text-amber-700 font-semibold';
    return 'text-rose-700 font-semibold';
  };

  return (
    <div className="space-y-6">
      {/* Unified Header & Period Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium mb-1">
              <span>Pelaksanaan Audit SPI</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700">{auditNumber}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-emerald-800">{snapshot.periodLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-800">{status}</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Scale className="w-5 h-5 text-emerald-700 shrink-0" />
              <span>Audit Kinerja Keuangan Terpadu (3E, BPKP &amp; Lintas Lini)</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Evaluasi terintegrasi atas Laporan Keuangan, RKA Berjenjang, Kas/Bank, Pajak, Aset, Persediaan, Operasional PDAM, Risiko 5x5, SPIP, KPI, dan Temuan 5C sesuai standar AAIPI, GIAS 2024 &amp; Permendagri 118/2018.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Segmented Mode Toggle: Bulanan vs Tahunan */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setEditingDocId(null);
                  setPeriodType('BULANAN');
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  periodType === 'BULANAN'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per Bulan
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingDocId(null);
                  setPeriodType('TAHUNAN');
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  periodType === 'TAHUNAN'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Per Tahun
              </button>
            </div>

            {periodType === 'BULANAN' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <select
                  value={selectedMonth}
                  onChange={(e) => {
                    setEditingDocId(null);
                    setSelectedMonth(parseInt(e.target.value, 10));
                  }}
                  className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
                  aria-label="Pilih Bulan Audit"
                >
                  {FISCAL_MONTHS.map((m, idx) => (
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
                onChange={(e) => {
                  setEditingDocId(null);
                  setSelectedYear(parseInt(e.target.value, 10));
                }}
                className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer"
                aria-label="Pilih Tahun Audit"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    Tahun {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs max-w-[220px]">
              <select
                value={selectedUnitId}
                onChange={(e) => {
                  setEditingDocId(null);
                  setSelectedUnitId(e.target.value);
                }}
                className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer w-full truncate"
                aria-label="Filter Unit Objek Audit"
              >
                <option value="ALL">Konsolidasi (Semua Unit)</option>
                {units
                  .filter((u) => u.isActive !== false)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>

        {/* Navigation Sub-Tabs + Quick Global Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: 'dashboard', label: '1. Dashboard Lintas Lini', icon: FileBarChart2 },
              { id: 'kka', label: '2. Kertas Kerja 3E & BPKP (12 Indikator)', icon: ClipboardCheck },
              { id: 'laporan', label: '3. Laporan Audit Komprehensif (9 Bab)', icon: BookOpen },
              { id: 'arsip', label: `4. Arsip & Daftar Audit (${savedAudits.length})`, icon: Layers },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSubTab(tab.id as SubTabKey)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-emerald-700 text-white border-emerald-800'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={handleResyncSystemMetrics}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  title="Tarik ulang seluruh data aktual lintas modul ke KKA & Laporan"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Sinkronkan Data Lintas Lini</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveAudit()}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Menyimpan...' : 'Simpan Audit'}</span>
                </button>
              </>
            )}
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
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak / PDF / Word</span>
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs border ${
            notice.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2 font-semibold">
            {notice.kind === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-semibold hover:underline cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* =====================================================================
          TAB 1: DASHBOARD LINTAS LINI & SKOR 3E
      ===================================================================== */}
      {activeSubTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Scoreboard + 5 Dimension Bars */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Skor Komposit Audit Kinerja Keuangan
                </p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span
                    className={`text-4xl font-bold font-mono tabular-nums ${getScoreColorClass(
                      effectiveScored.totalScore
                    )}`}
                  >
                    {effectiveScored.totalScore.toFixed(2)}
                  </span>
                  <span className="text-sm font-mono text-slate-400">/ 100.00</span>
                </div>
                <p className="text-sm font-bold text-slate-900 mt-1.5">
                  {effectiveScored.predicate}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Periode {snapshot.periodLabel} · {targetUnitName}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px]">Sesuai Standar</span>
                  <span className="font-mono font-bold text-emerald-700 tabular-nums">
                    {effectiveScored.indicators.filter((i) => i.verdict === 'Sesuai Standar').length}/12
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Perlu Perhatian</span>
                  <span className="font-mono font-bold text-amber-700 tabular-nums">
                    {effectiveScored.indicators.filter((i) => i.verdict === 'Perlu Perhatian').length}/12
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Defisiensi</span>
                  <span className="font-mono font-bold text-rose-700 tabular-nums">
                    {effectiveScored.indicators.filter((i) => i.verdict === 'Defisiensi Material').length}/12
                  </span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Capaian 5 Dimensi Audit Standar 3E &amp; BPKP
                </h3>
                <span className="text-[11px] font-mono text-slate-500">
                  Bobot Total 100%
                </span>
              </div>

              <div className="space-y-3">
                {[
                  {
                    label: 'A. Kinerja Keuangan BPKP (FCR, OR, Likuiditas, DER)',
                    weight: '30%',
                    val: effectiveScored.dimensionScores.keuanganBpkp,
                  },
                  {
                    label: 'B. Ekonomi Anggaran RKA Berjenjang & Pengadaan/Persediaan',
                    weight: '20%',
                    val: effectiveScored.dimensionScores.ekonomiRka,
                  },
                  {
                    label: 'C. Efisiensi Operasional PDAM (Penagihan Unit & Pengendalian NRW)',
                    weight: '20%',
                    val: effectiveScored.dimensionScores.efisiensiPdam,
                  },
                  {
                    label: 'D. Kepatuhan Kas/Bank, Rekonsiliasi, Akuntansi & Perpajakan',
                    weight: '15%',
                    val: effectiveScored.dimensionScores.kepatuhanKasPajak,
                  },
                  {
                    label: 'E. Pengendalian Internal, Audit Trail, Risiko & Tindak Lanjut 5C',
                    weight: '15%',
                    val: effectiveScored.dimensionScores.pengendalianRisikoTlr,
                  },
                ].map((dim) => (
                  <div key={dim.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">
                        {dim.label} <span className="text-slate-400">({dim.weight})</span>
                      </span>
                      <span
                        className={`font-mono font-bold tabular-nums ${getScoreColorClass(dim.val)}`}
                      >
                        {dim.val.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          dim.val >= 80
                            ? 'bg-emerald-600'
                            : dim.val >= 60
                            ? 'bg-amber-500'
                            : 'bg-rose-600'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, dim.val))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 5-Line Cross-Module Metric Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            {/* Lini 1 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Lini 1 · Akuntansi &amp; Rasio
              </p>
              <div className="space-y-1.5 text-xs pt-1 border-t border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Aset</span>
                  <span className="font-mono font-semibold tabular-nums">{formatRp(snapshot.totalAssets)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Pendapatan</span>
                  <span className="font-mono font-semibold tabular-nums">{formatRp(snapshot.totalRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Laba/Rugi</span>
                  <span className={`font-mono font-bold tabular-nums ${snapshot.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {formatRp(snapshot.netIncome)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">FCR / OR</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {snapshot.fcrPct.toFixed(1)}% / {snapshot.operatingRatioPct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Lini 2 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Lini 2 · Kas, Pajak &amp; Aset
              </p>
              <div className="space-y-1.5 text-xs pt-1 border-t border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">Kas &amp; Bank</span>
                  <span className="font-mono font-semibold tabular-nums">{formatRp(snapshot.totalLiquidBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Rekon Selisih</span>
                  <span className={`font-mono font-semibold tabular-nums ${snapshot.reconciliationVarianceCount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {snapshot.reconciliationVarianceCount} akun
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Pajak Terutang</span>
                  <span className="font-mono font-semibold tabular-nums">{formatRp(snapshot.taxUnpaidAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Piutang Tempo</span>
                  <span className="font-mono font-semibold tabular-nums">{formatRp(snapshot.overdueReceivablesTotal)}</span>
                </div>
              </div>
            </div>

            {/* Lini 3 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Lini 3 · RKA &amp; Pengadaan
              </p>
              <div className="space-y-1.5 text-xs pt-1 border-t border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">Pagu RKA</span>
                  <span className="font-mono font-semibold tabular-nums">{formatRp(snapshot.rkaTotalBudget)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Realisasi RKA</span>
                  <span className="font-mono font-semibold tabular-nums">{formatRp(snapshot.rkaTotalRealization)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Penyerapan</span>
                  <span className="font-mono font-bold tabular-nums text-emerald-700">
                    {snapshot.rkaAbsorptionPct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Pos Overbudget</span>
                  <span className={`font-mono font-semibold tabular-nums ${snapshot.rkaOverbudgetCount > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                    {snapshot.rkaOverbudgetCount} pos · {snapshot.rkaUnverifiedSubCount} unverified
                  </span>
                </div>
              </div>
            </div>

            {/* Lini 4 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Lini 4 · PDAM, Risiko &amp; KPI
              </p>
              <div className="space-y-1.5 text-xs pt-1 border-t border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">Efisiensi Tagih</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {snapshot.pdamSnapshotAvailable ? `${snapshot.pdamCollectionEfficiencyPct.toFixed(1)}%` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tingkat NRW</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {snapshot.pdamSnapshotAvailable ? `${snapshot.pdamNrwPct.toFixed(1)}%` : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Risiko Keu. Tinggi</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {snapshot.financialHighExtremeRiskCount}/{snapshot.financialRisksCount} risiko
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">KPI Keuangan</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {snapshot.kpiFinanceAvgAchievementPct.toFixed(1)}% ({snapshot.kpiFinanceCount} KPI)
                  </span>
                </div>
              </div>
            </div>

            {/* Lini 5 */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                Lini 5 · Temuan 5C &amp; Fraud
              </p>
              <div className="space-y-1.5 text-xs pt-1 border-t border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">SPT Keuangan</span>
                  <span className="font-mono font-semibold tabular-nums">{snapshot.financeAssignmentsCount} SPT</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Temuan 5C Open</span>
                  <span className="font-mono font-semibold tabular-nums text-rose-700">
                    {snapshot.financeFindingsOpen}/{snapshot.financeFindingsTotal}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Selesai TLR</span>
                  <span className="font-mono font-semibold tabular-nums text-emerald-700">
                    {snapshot.financeRecsCompletionPct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Alert Duplikat/WBS</span>
                  <span className="font-mono font-semibold tabular-nums">
                    {snapshot.duplicateAlertsCount} dup · {snapshot.financeWbsCount} WBS
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Early Warning & Monthly Trend Matrix */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-sm font-bold text-slate-900">
                  Tren Arus Kas, Realisasi RKA &amp; Kontrol Audit Tahun {selectedYear} (Jan–Des)
                </h3>
                <span className="text-[11px] font-mono text-slate-500">
                  {periodType === 'BULANAN' ? `Fokus: ${FISCAL_MONTHS[selectedMonth - 1]}` : 'Akumulasi 12 Bulan'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <th className="py-2 px-2.5 font-semibold">Bulan</th>
                      <th className="py-2 px-2.5 font-semibold text-right">Penerimaan Kas</th>
                      <th className="py-2 px-2.5 font-semibold text-right">Pengeluaran Kas</th>
                      <th className="py-2 px-2.5 font-semibold text-right">Net Cash Flow</th>
                      <th className="py-2 px-2.5 font-semibold text-right">Realisasi RKA</th>
                      <th className="py-2 px-2.5 font-semibold text-center">Tx / Alert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {snapshot.monthlyTrend.map((m) => {
                      const isFocused = periodType === 'BULANAN' && m.monthIndex === selectedMonth;
                      return (
                        <tr
                          key={m.monthIndex}
                          className={isFocused ? 'bg-emerald-50/70 font-semibold' : 'hover:bg-slate-50/70'}
                        >
                          <td className="py-2 px-2.5 text-slate-900">{m.monthName}</td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-800">
                            {formatRp(m.receipts)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-800">
                            {formatRp(m.expenses)}
                          </td>
                          <td
                            className={`py-2 px-2.5 text-right font-mono tabular-nums ${
                              m.netCashFlow >= 0 ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {formatRp(m.netCashFlow)}
                          </td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums text-slate-700">
                            {formatRp(m.rkaRealization)}
                          </td>
                          <td className="py-2 px-2.5 text-center font-mono tabular-nums text-slate-600">
                            {m.txCount} /{' '}
                            <span className={m.duplicateFlags > 0 ? 'text-rose-700 font-bold' : ''}>
                              {m.duplicateFlags}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <h3 className="text-sm font-bold text-slate-900">
                  Peringatan Dini &amp; Atensi Auditor ({snapshot.earlyWarnings.length})
                </h3>
                <span className="text-[11px] font-mono text-rose-700 font-semibold">
                  {snapshot.earlyWarningsCriticalCount} Kritis
                </span>
              </div>

              {snapshot.earlyWarnings.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  Tidak ada anomali atau peringatan dini keuangan terdeteksi pada periode ini.
                </div>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {snapshot.earlyWarnings.map((w) => (
                    <div
                      key={w.id}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span
                          className={`font-bold ${
                            w.severity === 'KRITIS'
                              ? 'text-rose-700'
                              : w.severity === 'PERINGATAN'
                              ? 'text-amber-700'
                              : 'text-slate-700'
                          }`}
                        >
                          {w.severity} · {w.category}
                        </span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {w.metricValue}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900">{w.title}</p>
                      <p className="text-[11px] text-slate-600 leading-relaxed">{w.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: KERTAS KERJA AUDIT KINERJA (KKA 3E & BPKP - 12 INDIKATOR)
      ===================================================================== */}
      {activeSubTab === 'kka' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Kertas Kerja Pengujian Kinerja Keuangan (Matriks 12 Indikator 3E &amp; BPKP)
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Nilai sistem dihitung otomatis dari seluruh modul terkait. Auditor dapat memverifikasi skor (1–5), mencatat temuan bukti, dan mengekskalasi defisiensi langsung ke Temuan Audit 5C.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <select
                value={dimensionFilter}
                onChange={(e) => setDimensionFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
              >
                <option value="ALL">Semua Dimensi (12 Indikator)</option>
                <option value="KEUANGAN_BPKP">A. Kinerja Keuangan BPKP (30%)</option>
                <option value="EKONOMI_RKA_PENGADAAN">B. Ekonomi RKA &amp; Pengadaan (20%)</option>
                <option value="EFISIENSI_OPERASIONAL_PDAM">C. Efisiensi Operasional PDAM (20%)</option>
                <option value="KEPATUHAN_KAS_PAJAK">D. Kepatuhan Kas, Akuntansi &amp; Pajak (15%)</option>
                <option value="PENGENDALIAN_RISIKO_TLR">E. Pengendalian, Risiko &amp; TLR 5C (15%)</option>
              </select>

              <div className="px-3 py-1.5 text-xs font-mono font-bold border border-slate-200 bg-slate-50 rounded-lg text-slate-900 tabular-nums">
                Total Skor: {effectiveScored.totalScore.toFixed(2)} / 100
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse border border-slate-200">
              <thead>
                <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                  <th className="py-2.5 px-3 font-semibold w-20">Kode</th>
                  <th className="py-2.5 px-3 font-semibold min-w-[230px]">Indikator &amp; Standar Audit</th>
                  <th className="py-2.5 px-3 font-semibold text-right min-w-[140px]">Aktual Sistem</th>
                  <th className="py-2.5 px-3 font-semibold text-center w-16">Bobot</th>
                  <th className="py-2.5 px-3 font-semibold text-center w-28">Skor Auditor</th>
                  <th className="py-2.5 px-3 font-semibold text-right w-20">Poin</th>
                  <th className="py-2.5 px-3 font-semibold w-36">Simpulan / Verdict</th>
                  <th className="py-2.5 px-3 font-semibold min-w-[240px]">Catatan Verifikasi &amp; Aksi 5C</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredIndicators.map((ind) => (
                  <tr key={ind.id} className="align-top hover:bg-slate-50/70">
                    <td className="py-3 px-3 font-mono font-bold text-emerald-800">{ind.code}</td>
                    <td className="py-3 px-3 space-y-1">
                      <p className="font-bold text-slate-900">{ind.name}</p>
                      <p className="text-[11px] text-slate-600">{ind.formulaDesc}</p>
                      <p className="text-[10px] text-slate-500">
                        Standar: {ind.standardRef} · Benchmark: <span className="font-semibold">{ind.benchmarkLabel}</span>
                      </p>
                      <p className="text-[10px] text-emerald-800 font-medium">
                        Sumber: {ind.sourceModule}
                      </p>
                    </td>
                    <td className="py-3 px-3 text-right space-y-1">
                      <p className="font-mono font-bold text-slate-900 tabular-nums">
                        {ind.systemFormatted}
                      </p>
                      <p className="text-[10px] font-mono text-slate-500 tabular-nums">
                        Skor Sistem: {ind.systemScore}/5
                      </p>
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-semibold tabular-nums">
                      {ind.weight}%
                    </td>
                    <td className="py-3 px-3 text-center">
                      <select
                        disabled={!canEdit}
                        value={ind.auditorScore}
                        onChange={(e) =>
                          handleUpdateIndicator(ind.id, {
                            auditorScore: parseInt(e.target.value, 10),
                          })
                        }
                        className="px-2 py-1 text-xs font-mono font-bold border border-slate-300 rounded-md bg-white text-slate-900 disabled:opacity-60"
                      >
                        <option value={5}>5 (Optimal)</option>
                        <option value={4}>4 (Baik)</option>
                        <option value={3}>3 (Cukup)</option>
                        <option value={2}>2 (Kurang)</option>
                        <option value={1}>1 (Kritis)</option>
                      </select>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                      {ind.weightedPoints.toFixed(2)}
                    </td>
                    <td className="py-3 px-3">
                      <span className={getVerdictColorClass(ind.verdict)}>{ind.verdict}</span>
                    </td>
                    <td className="py-3 px-3 space-y-2">
                      <p className="text-[11px] text-slate-600 leading-snug">{ind.evidenceSummary}</p>
                      <textarea
                        rows={2}
                        readOnly={!canEdit}
                        value={ind.auditorNotes}
                        onChange={(e) =>
                          handleUpdateIndicator(ind.id, { auditorNotes: e.target.value })
                        }
                        placeholder="Catatan pengujian dan kesimpulan auditor..."
                        className="w-full px-2.5 py-1.5 text-[11px] border border-slate-300 rounded-md bg-slate-50 focus:bg-white text-slate-800"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {ind.linkedFindingNumber ? (
                          <span className="text-[10px] font-mono font-bold text-emerald-800">
                            Terekskalasi ke 5C: {ind.linkedFindingNumber}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">Belum ada temuan 5C</span>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            disabled={escalatingId === ind.id}
                            onClick={() => handleEscalateTo5C(ind)}
                            className="px-2.5 py-1 text-[11px] font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                          >
                            {escalatingId === ind.id
                              ? 'Membuat 5C...'
                              : 'Eskalasi ke Temuan 5C'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: LAPORAN KOMPREHENSIF AUDIT KINERJA KEUANGAN (9 BAB)
      ===================================================================== */}
      {activeSubTab === 'laporan' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Outline */}
          <aside className="lg:col-span-3 space-y-4 lg:sticky lg:top-20">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="border-b border-slate-100 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Sistematika Laporan (9 Bab)
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setActiveChapter('all')}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                  activeChapter === 'all'
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                }`}
              >
                Tampilkan Semua Bab (Utuh)
              </button>

              <div className="space-y-1">
                {REPORT_CHAPTERS.map((ch) => (
                  <button
                    key={ch.key}
                    type="button"
                    onClick={() => setActiveChapter(ch.key)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs cursor-pointer ${
                      activeChapter === ch.key
                        ? 'bg-emerald-50 text-emerald-950 border border-emerald-200 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="block text-[10px] font-mono text-emerald-700 font-semibold">
                      {ch.code}
                    </span>
                    <span className="block leading-snug">{ch.title}</span>
                  </button>
                ))}
              </div>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    applyGeneratedNarratives();
                    pushNotice(
                      'success',
                      'Seluruh 9 Bab narasi laporan berhasil disusun ulang berdasarkan data aktual lintas lini.'
                    );
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Susun Ulang Narasi 9 Bab</span>
                </button>
              )}
            </div>
          </aside>

          {/* Right Report Editor & Live Quantitative Tables */}
          <div className="lg:col-span-9 space-y-6">
            {showChapter('identitas') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="border-b border-slate-200 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-mono font-semibold text-emerald-700">
                      SAMPUL &amp; PENGENDALIAN AUDIT
                    </p>
                    <h3 className="text-base font-bold text-slate-900">
                      Identitas Penugasan &amp; Materialitas Audit Kinerja Keuangan
                    </h3>
                  </div>

                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as FinancialAuditStatus)}
                    disabled={!canApprove && status === 'Final / Disahkan ke Direksi & Dewas'}
                    className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50 text-slate-900 disabled:opacity-60"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Review Pengendali Teknis">Review Pengendali Teknis</option>
                    {canApprove && (
                      <>
                        <option value="Persetujuan Kepala SPI">Persetujuan Kepala SPI</option>
                        <option value="Final / Disahkan ke Direksi & Dewas">
                          Final / Disahkan ke Direksi &amp; Dewas
                        </option>
                      </>
                    )}
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="md:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Judul Resmi Laporan</label>
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={auditTitle}
                      onChange={(e) => setAuditTitle(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-semibold text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Nomor Laporan (LHAKK)</label>
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={auditNumber}
                      onChange={(e) => setAuditNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Tanggal Laporan</label>
                    <input
                      type="date"
                      readOnly={!canEdit}
                      value={auditDate}
                      onChange={(e) => setAuditDate(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Tautkan Surat Perintah Tugas (SPT)</label>
                    <select
                      disabled={!canEdit}
                      value={assignmentId}
                      onChange={(e) => handleSelectSpt(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
                    >
                      <option value="">-- Audit Kinerja Periodik Mandiri --</option>
                      {assignments.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.letterNumber} · {a.objectName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Ambang Materialitas (Rp)</label>
                    <input
                      type="number"
                      readOnly={!canEdit}
                      value={materialityAmount}
                      onChange={(e) => setMaterialityAmount(Number(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white font-mono text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Ketua Tim Pemeriksa</label>
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={teamLeader}
                      onChange={(e) => setTeamLeader(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Pengendali Teknis / Penanggung Jawab</label>
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={supervisor}
                      onChange={(e) => setSupervisor(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-slate-900"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block font-semibold text-slate-700 mb-1">Standar Pemeriksaan yang Diacu</label>
                    <input
                      type="text"
                      readOnly={!canEdit}
                      value={auditStandards}
                      onChange={(e) => setAuditStandards(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 focus:bg-white text-slate-900"
                    />
                  </div>
                </div>
              </section>
            )}

            {/* BAB I */}
            {showChapter('bab1') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <div className="border-b border-slate-200 pb-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB I</p>
                    <h3 className="text-base font-bold text-slate-900">
                      Ringkasan Eksekutif, Opini &amp; Predikat Kinerja Keuangan ({snapshot.periodLabel})
                    </h3>
                  </div>
                  <span className={`text-sm font-mono font-bold tabular-nums ${getScoreColorClass(effectiveScored.totalScore)}`}>
                    Skor: {effectiveScored.totalScore.toFixed(2)}/100
                  </span>
                </div>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={bab1ExecutiveSummary}
                  onChange={(e) => setBab1ExecutiveSummary(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </section>
            )}

            {/* BAB II */}
            {showChapter('bab2') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB II</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Dasar Hukum, Standar Audit, Tujuan, Metodologi &amp; Materialitas
                  </h3>
                </div>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={bab2BasisScopeMethodology}
                  onChange={(e) => setBab2BasisScopeMethodology(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </section>
            )}

            {/* BAB III */}
            {showChapter('bab3') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB III</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Analisis Laporan Keuangan Komparatif &amp; Rasio Kesehatan (FCR, OR, Likuiditas, DER)
                  </h3>
                </div>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={bab3FinancialStatementsAnalysis}
                  onChange={(e) => setBab3FinancialStatementsAnalysis(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                  {[
                    { label: 'FCR', val: `${snapshot.fcrPct.toFixed(2)}%`, std: '>= 100%' },
                    { label: 'Operating Ratio', val: `${snapshot.operatingRatioPct.toFixed(2)}%`, std: '<= 85%' },
                    { label: 'Current Ratio', val: `${snapshot.currentRatioPct.toFixed(2)}%`, std: '>= 200%' },
                    { label: 'Debt to Equity', val: `${snapshot.debtToEquityRatioPct.toFixed(2)}%`, std: '<= 100%' },
                  ].map((r) => (
                    <div key={r.label} className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                      <span className="text-slate-500 block">{r.label}</span>
                      <span className="font-mono font-bold text-base text-slate-900 tabular-nums">{r.val}</span>
                      <span className="text-[10px] text-slate-500 block">Standar: {r.std}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* BAB IV */}
            {showChapter('bab4') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB IV</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Evaluasi Realisasi Anggaran RKA Berjenjang, PKPT &amp; Pengadaan
                  </h3>
                </div>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={bab4BudgetRkaProcurementEval}
                  onChange={(e) => setBab4BudgetRkaProcurementEval(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                        <th className="py-2 px-3 font-semibold">Kode RKA</th>
                        <th className="py-2 px-3 font-semibold">Pos Anggaran Induk</th>
                        <th className="py-2 px-3 font-semibold text-right">Pagu</th>
                        <th className="py-2 px-3 font-semibold text-right">Realisasi</th>
                        <th className="py-2 px-3 font-semibold text-right">Sisa Pagu</th>
                        <th className="py-2 px-3 font-semibold text-right">Serap %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {snapshot.rkaBreakdown.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-4 text-center text-slate-500">
                            Belum ada data RKA pada tahun/unit ini.
                          </td>
                        </tr>
                      ) : (
                        snapshot.rkaBreakdown.slice(0, 12).map((r) => (
                          <tr key={r.id}>
                            <td className="py-2 px-3 font-mono text-emerald-800">{r.code}</td>
                            <td className="py-2 px-3 text-slate-900 font-medium">{r.programName}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{formatRp(r.budgetAmount)}</td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums">{formatRp(r.totalRealization)}</td>
                            <td
                              className={`py-2 px-3 text-right font-mono tabular-nums ${
                                r.isOverBudget ? 'text-rose-700 font-bold' : 'text-slate-700'
                              }`}
                            >
                              {formatRp(r.remainingBudget)}
                            </td>
                            <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                              {r.absorptionPct.toFixed(1)}%
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* BAB V */}
            {showChapter('bab5') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB V</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Audit Kas/Bank, Rekonsiliasi, Utang/Piutang, Aset Tetap, Persediaan &amp; Pajak
                  </h3>
                </div>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={bab5TreasuryAssetsTaxEval}
                  onChange={(e) => setBab5TreasuryAssetsTaxEval(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </section>
            )}

            {/* BAB VI */}
            {showChapter('bab6') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB VI</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Integrasi Operasional PDAM (Penagihan &amp; NRW), Risiko Keuangan, SPIP &amp; KPI
                  </h3>
                </div>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={bab6OperationalPdamRiskKpi}
                  onChange={(e) => setBab6OperationalPdamRiskKpi(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </section>
            )}

            {/* BAB VII */}
            {showChapter('bab7') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB VII</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Pengendalian Internal, Jejak Audit Ganda, WBS/Fraud, Temuan 5C &amp; TLR
                  </h3>
                </div>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={bab7InternalControlFindingsTlr}
                  onChange={(e) => setBab7InternalControlFindingsTlr(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
              </section>
            )}

            {/* BAB VIII */}
            {showChapter('bab8') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB VIII</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Matriks Penilaian Skor 3E &amp; BPKP (12 Indikator Terbobot)
                  </h3>
                </div>
                <textarea
                  rows={5}
                  readOnly={!canEdit}
                  value={bab8ScoringMatrixAnalysis}
                  onChange={(e) => setBab8ScoringMatrixAnalysis(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse border border-slate-200">
                    <thead>
                      <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                        <th className="py-2 px-2.5 font-semibold">Kode</th>
                        <th className="py-2 px-2.5 font-semibold">Indikator Kinerja Keuangan</th>
                        <th className="py-2 px-2.5 font-semibold text-right">Capaian</th>
                        <th className="py-2 px-2.5 font-semibold text-center">Bobot</th>
                        <th className="py-2 px-2.5 font-semibold text-center">Skor</th>
                        <th className="py-2 px-2.5 font-semibold text-right">Poin</th>
                        <th className="py-2 px-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {effectiveScored.indicators.map((ind) => (
                        <tr key={ind.id}>
                          <td className="py-2 px-2.5 font-mono font-semibold text-emerald-800">{ind.code}</td>
                          <td className="py-2 px-2.5 text-slate-900">{ind.name}</td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums">{ind.systemFormatted}</td>
                          <td className="py-2 px-2.5 text-center font-mono tabular-nums">{ind.weight}%</td>
                          <td className="py-2 px-2.5 text-center font-mono tabular-nums font-bold">{ind.auditorScore}/5</td>
                          <td className="py-2 px-2.5 text-right font-mono tabular-nums font-bold">{ind.weightedPoints.toFixed(2)}</td>
                          <td className={`py-2 px-2.5 ${getVerdictColorClass(ind.verdict)}`}>{ind.verdict}</td>
                        </tr>
                      ))}
                      <tr className="bg-slate-50 font-bold border-t border-slate-300">
                        <td colSpan={3} className="py-2.5 px-2.5 text-slate-900">
                          TOTAL SKOR KOMPOSIT ({effectiveScored.predicate})
                        </td>
                        <td className="py-2.5 px-2.5 text-center font-mono tabular-nums">100%</td>
                        <td className="py-2.5 px-2.5 text-center">-</td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-emerald-800">
                          {effectiveScored.totalScore.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-2.5 text-emerald-800">Terbobot</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* BAB IX */}
            {showChapter('bab9') && (
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="border-b border-slate-200 pb-2.5">
                  <p className="text-[11px] font-mono font-semibold text-emerald-700">BAB IX</p>
                  <h3 className="text-base font-bold text-slate-900">
                    Simpulan Audit, Rekomendasi Strategis &amp; Komitmen Manajemen
                  </h3>
                </div>
                <textarea
                  rows={6}
                  readOnly={!canEdit}
                  value={bab9ConclusionRecommendations}
                  onChange={(e) => setBab9ConclusionRecommendations(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                />
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Pernyataan Tanggapan &amp; Komitmen Manajemen Auditee
                  </label>
                  <textarea
                    rows={3}
                    readOnly={!canEdit}
                    value={managementCommitment}
                    onChange={(e) => setManagementCommitment(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white leading-relaxed text-slate-800"
                  />
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 4: ARSIP & DAFTAR AUDIT KINERJA KEUANGAN
      ===================================================================== */}
      {activeSubTab === 'arsip' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3.5">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Arsip Laporan Audit Kinerja Keuangan (Bulanan &amp; Tahunan)
              </h3>
              <p className="text-xs text-slate-600">
                Kelola dokumen audit tersimpan, muat kembali untuk reviu atau cetak resmi, serta kelola otorisasi pengesahan.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={archiveSearch}
                  onChange={(e) => setArchiveSearch(e.target.value)}
                  placeholder="Cari nomor atau judul..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-slate-50 focus:bg-white"
                />
              </div>

              <select
                value={archiveTypeFilter}
                onChange={(e) => setArchiveTypeFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded-lg bg-slate-50 text-slate-900"
              >
                <option value="ALL">Semua Periode</option>
                <option value="BULANAN">Laporan Bulanan</option>
                <option value="TAHUNAN">Laporan Tahunan</option>
              </select>

              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingDocId(null);
                    setActiveSubTab('laporan');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Susun Periode Aktif</span>
                </button>
              )}
            </div>
          </div>

          {filteredSavedAudits.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                Belum Ada Dokumen Audit Kinerja Keuangan Tersimpan
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Anda dapat meninjau perhitungan real-time pada tab Dashboard atau KKA, lalu klik Simpan Audit untuk mengarsipkan Laporan Bulanan atau Tahunan ke database.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse border border-slate-200">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 border-b border-slate-200">
                    <th className="py-2.5 px-3 font-semibold">Nomor &amp; Judul Audit</th>
                    <th className="py-2.5 px-3 font-semibold">Jenis &amp; Periode</th>
                    <th className="py-2.5 px-3 font-semibold">Entitas / Unit</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Skor Komposit</th>
                    <th className="py-2.5 px-3 font-semibold">Status Pengesahan</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredSavedAudits.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-3">
                        <p className="font-mono font-bold text-emerald-800">{item.auditNumber}</p>
                        <p className="font-semibold text-slate-900">{item.auditTitle}</p>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        <span className="font-semibold block">{item.periodType}</span>
                        <span className="text-[11px] text-slate-500">
                          {item.periodType === 'BULANAN' && item.monthName
                            ? `${item.monthName} ${item.year}`
                            : `Tahun Buku ${item.year}`}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-700">{item.unitName}</td>
                      <td className="py-3 px-3 text-right">
                        <span className={`font-mono font-bold tabular-nums ${getScoreColorClass(item.totalScore)}`}>
                          {item.totalScore.toFixed(2)} / 100
                        </span>
                        <span className="block text-[10px] text-slate-500">{item.predicate}</span>
                      </td>
                      <td className="py-3 px-3 font-semibold text-slate-800">{item.status}</td>
                      <td className="py-3 px-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPeriodType(item.periodType);
                              setSelectedYear(item.year);
                              if (item.periodType === 'BULANAN' && item.month) {
                                setSelectedMonth(item.month);
                              }
                              setSelectedUnitId(item.unitId || 'ALL');
                              setEditingDocId(item.id);
                              setActiveSubTab('laporan');
                            }}
                            className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-md cursor-pointer"
                            title={isViewer ? 'Lihat Laporan' : 'Buka & Edit Laporan'}
                          >
                            {isViewer ? <Eye className="w-4 h-4" /> : <Edit className="w-4 h-4" />}
                          </button>

                          {isSuperUser && (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmTarget(item)}
                              className="p-1.5 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-md cursor-pointer"
                              title="Hapus Arsip Audit (Super User)"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          IN-APP DELETE CONFIRMATION MODAL (SUPER USER)
      ===================================================================== */}
      {deleteConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-900">
                  Hapus Dokumen Audit Kinerja Keuangan?
                </h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Dokumen <span className="font-mono font-semibold">{deleteConfirmTarget.auditNumber}</span> ({deleteConfirmTarget.auditTitle}) akan dihapus permanen dari database. Data transaksi keuangan &amp; RKA sumber tetap aman.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteConfirmTarget(null)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
              >
                Ya, Hapus Permanen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          OFFICIAL PRINT / PDF / WORD PREVIEW MODAL (DocumentPrintPreviewModal)
      ===================================================================== */}
      <DocumentPrintPreviewModal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        documentTitle={auditTitle}
        documentSubtitle={`Audit Kinerja Keuangan Terpadu (${periodType === 'BULANAN' ? 'Laporan Bulanan' : 'Laporan Tahunan'}) · ${snapshot.periodLabel}`}
        documentNumber={auditNumber}
        initialSignatory1Role="Kepala Satuan Pengawasan Intern"
        initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
        defaultShowSignatory2={true}
      >
        {() => (
          <div className="space-y-5 font-sans text-xs text-slate-900 leading-relaxed">
            {/* Metadata Table */}
            <table className="w-full borderless text-xs">
              <tbody>
                <tr>
                  <td className="w-44 font-semibold py-1">Periode Pemeriksaan</td>
                  <td className="w-4 py-1">:</td>
                  <td className="py-1 font-semibold">{snapshot.periodLabel} ({periodType})</td>
                </tr>
                <tr>
                  <td className="font-semibold py-1">Objek / Entitas</td>
                  <td className="py-1">:</td>
                  <td className="py-1">{targetUnitName}</td>
                </tr>
                <tr>
                  <td className="font-semibold py-1">Nomor SPT / Penugasan</td>
                  <td className="py-1">:</td>
                  <td className="py-1 font-mono">{assignmentNumber || 'Audit Periodik Terjadwal PKPT'}</td>
                </tr>
                <tr>
                  <td className="font-semibold py-1">Standar Audit</td>
                  <td className="py-1">:</td>
                  <td className="py-1">{auditStandards}</td>
                </tr>
                <tr>
                  <td className="font-semibold py-1">Ambang Materialitas</td>
                  <td className="py-1">:</td>
                  <td className="py-1 font-mono">{formatRp(materialityAmount)} ({materialityBasis})</td>
                </tr>
                <tr>
                  <td className="font-semibold py-1">Tim Pemeriksa</td>
                  <td className="py-1">:</td>
                  <td className="py-1">Pengendali Teknis: {supervisor} · Ketua Tim: {teamLeader || preparedBy}</td>
                </tr>
                <tr>
                  <td className="font-semibold py-1">Hasil &amp; Predikat Audit</td>
                  <td className="py-1">:</td>
                  <td className="py-1 font-bold">
                    SKOR {effectiveScored.totalScore.toFixed(2)} / 100,00 — {effectiveScored.predicate}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Bab 1 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB I. RINGKASAN EKSEKUTIF &amp; OPINI KINERJA KEUANGAN
              </h3>
              <p className="whitespace-pre-line text-justify">{bab1ExecutiveSummary}</p>
            </div>

            {/* Bab 2 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB II. DASAR HUKUM, STANDAR AUDIT, RUANG LINGKUP &amp; METODOLOGI
              </h3>
              <p className="whitespace-pre-line text-justify">{bab2BasisScopeMethodology}</p>
            </div>

            {/* Bab 3 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB III. ANALISIS LAPORAN KEUANGAN KOMPARATIF &amp; RASIO KESEHATAN
              </h3>
              <p className="whitespace-pre-line text-justify">{bab3FinancialStatementsAnalysis}</p>
              <table className="w-full text-[11px]">
                <thead>
                  <tr>
                    <th>Pos &amp; Rasio Keuangan Kunci</th>
                    <th className="text-right">Nilai Aktual</th>
                    <th>Standar / Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Total Aset / Total Ekuitas</td>
                    <td className="text-right font-mono">{formatRp(snapshot.totalAssets)} / {formatRp(snapshot.totalEquity)}</td>
                    <td>{snapshot.isBalanceSheetBalanced ? 'Neraca Seimbang' : 'Ada Selisih Neraca'}</td>
                  </tr>
                  <tr>
                    <td>Total Pendapatan / Total Beban / {snapshot.netIncome < 0 ? 'Rugi Bersih' : 'Laba Bersih'}</td>
                    <td className="text-right font-mono">{formatRp(snapshot.totalRevenue)} / {formatRp(snapshot.totalExpense)} / {formatRp(snapshot.netIncome)}</td>
                    <td>Anggaran Pendapatan: {formatRp(snapshot.budgetRevenue)}</td>
                  </tr>
                  <tr>
                    <td>Financial Cost Recovery (FCR) / Operating Ratio</td>
                    <td className="text-right font-mono">{snapshot.fcrPct.toFixed(2)}% / {snapshot.operatingRatioPct.toFixed(2)}%</td>
                    <td>FCR &gt;= 100% · OR &lt;= 85%</td>
                  </tr>
                  <tr>
                    <td>Current Ratio / Cash Ratio / DER</td>
                    <td className="text-right font-mono">{snapshot.currentRatioPct.toFixed(1)}% / {snapshot.cashRatioPct.toFixed(1)}% / {snapshot.debtToEquityRatioPct.toFixed(1)}%</td>
                    <td>CR &gt;= 200% · Cash &gt;= 100% · DER &lt;= 100%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Bab 4 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB IV. EVALUASI ANGGARAN RKA BERJENJANG, PKPT &amp; PENGADAAN
              </h3>
              <p className="whitespace-pre-line text-justify">{bab4BudgetRkaProcurementEval}</p>
              {snapshot.rkaBreakdown.length > 0 && (
                <table className="w-full text-[10px]">
                  <thead>
                    <tr>
                      <th>Kode</th>
                      <th>Program Induk RKA</th>
                      <th className="text-right">Pagu (Rp)</th>
                      <th className="text-right">Realisasi (Rp)</th>
                      <th className="text-right">Sisa (Rp)</th>
                      <th className="text-right">Serap %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.rkaBreakdown.slice(0, 15).map((r) => (
                      <tr key={r.id}>
                        <td className="font-mono">{r.code}</td>
                        <td>{r.programName}</td>
                        <td className="text-right font-mono">{formatRp(r.budgetAmount)}</td>
                        <td className="text-right font-mono">{formatRp(r.totalRealization)}</td>
                        <td className="text-right font-mono">{formatRp(r.remainingBudget)}</td>
                        <td className="text-right font-mono">{r.absorptionPct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Bab 5 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB V. AUDIT KAS/BANK, REKONSILIASI, ASET, PERSEDIAAN &amp; PERPAJAKAN
              </h3>
              <p className="whitespace-pre-line text-justify">{bab5TreasuryAssetsTaxEval}</p>
            </div>

            {/* Bab 6 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB VI. INTEGRASI OPERASIONAL PDAM, RISIKO KEUANGAN, SPIP &amp; KPI
              </h3>
              <p className="whitespace-pre-line text-justify">{bab6OperationalPdamRiskKpi}</p>
            </div>

            {/* Bab 7 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB VII. PENGENDALIAN INTERNAL, AUDIT TRAIL GANDA, WBS &amp; TEMUAN 5C
              </h3>
              <p className="whitespace-pre-line text-justify">{bab7InternalControlFindingsTlr}</p>
            </div>

            {/* Bab 8 */}
            <div className="space-y-1.5 avoid-break">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB VIII. MATRIKS PENILAIAN SKOR 3E &amp; KESEHATAN KEUANGAN BPKP
              </h3>
              <p className="whitespace-pre-line text-justify">{bab8ScoringMatrixAnalysis}</p>
              <table className="w-full text-[10px]">
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Indikator Audit</th>
                    <th className="text-right">Aktual</th>
                    <th className="text-center">Bobot</th>
                    <th className="text-center">Skor</th>
                    <th className="text-right">Poin</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {effectiveScored.indicators.map((ind) => (
                    <tr key={ind.id}>
                      <td className="font-mono">{ind.code}</td>
                      <td>{ind.name}</td>
                      <td className="text-right font-mono">{ind.systemFormatted}</td>
                      <td className="text-center font-mono">{ind.weight}%</td>
                      <td className="text-center font-mono">{ind.auditorScore}/5</td>
                      <td className="text-right font-mono">{ind.weightedPoints.toFixed(2)}</td>
                      <td>{ind.verdict}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="font-bold">TOTAL SKOR KOMPOSIT ({effectiveScored.predicate})</td>
                    <td className="text-center font-bold font-mono">100%</td>
                    <td className="text-center">-</td>
                    <td className="text-right font-bold font-mono">{effectiveScored.totalScore.toFixed(2)}</td>
                    <td className="font-bold">FINAL</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Annual 12-Month Appendix */}
            {periodType === 'TAHUNAN' && (
              <div className="space-y-1.5 avoid-break">
                <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                  LAMPIRAN REKAPITULASI TREN BULANAN KEUANGAN &amp; KONTROL ({selectedYear})
                </h3>
                <table className="w-full text-[10px]">
                  <thead>
                    <tr>
                      <th>Bulan</th>
                      <th className="text-right">Penerimaan</th>
                      <th className="text-right">Pengeluaran</th>
                      <th className="text-right">Net Cash Flow</th>
                      <th className="text-right">Realisasi RKA</th>
                      <th className="text-center">Duplikat / Temuan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.monthlyTrend.map((m) => (
                      <tr key={m.monthIndex}>
                        <td>{m.monthName}</td>
                        <td className="text-right font-mono">{formatRp(m.receipts)}</td>
                        <td className="text-right font-mono">{formatRp(m.expenses)}</td>
                        <td className="text-right font-mono">{formatRp(m.netCashFlow)}</td>
                        <td className="text-right font-mono">{formatRp(m.rkaRealization)}</td>
                        <td className="text-center font-mono">{m.duplicateFlags} / {m.findingsCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bab 9 */}
            <div className="space-y-1.5">
              <h3 className="text-xs font-bold uppercase border-b border-slate-400 pb-1">
                BAB IX. SIMPULAN AUDIT, KOMITMEN MANAJEMEN &amp; REKOMENDASI STRATEGIS
              </h3>
              <p className="whitespace-pre-line text-justify">{bab9ConclusionRecommendations}</p>
              <p className="whitespace-pre-line text-justify mt-2 font-medium">{managementCommitment}</p>
            </div>
          </div>
        )}
      </DocumentPrintPreviewModal>
    </div>
  );
};
