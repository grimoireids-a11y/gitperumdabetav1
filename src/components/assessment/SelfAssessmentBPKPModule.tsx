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
  Award,
  BarChart3,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Edit3,
  Eye,
  FileSpreadsheet,
  FileText,
  Landmark,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { requestSpiAssist } from '../../lib/spiAssistClient';
import {
  AuditAssignment,
  AuditReport,
  BPKPIndicatorAssessment,
  BPKPPeriodType,
  BPKPSelfAssessment,
  Finding,
  FollowUp,
  KPIItem,
  KPIMeasurement,
  PKPT,
  Recommendation,
  Regulation,
  RKAItem,
  RKASubItem,
  RiskRegister,
  SPIPElementAssessment,
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
import { FinancialPerformanceAudit } from '../../types/financialAudit';
import { INITIAL_BPKP_KINERJA_INDICATORS, INITIAL_SPIP_ELEMENTS } from '../../data/bpkpStandards';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';
import { formatRp, sanitizeFirestoreRecord } from '../../lib/financeEngine';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import {
  build12MonthBpkpTrend,
  classifyKinerjaCategory,
  classifySpipLevel,
  RCSAInlineItem,
  runBpkpCrossModuleAutomation,
} from '../../lib/bpkpAutomationEngine';

type ViewTab = 'hub' | 'kinerja' | 'spip' | 'report';

export const SelfAssessmentBPKPModule: React.FC = () => {
  const { userProfile, hasRole } = useAuth();
  const { activeYear, availableYears } = useFiscalYear();

  // Period Selection (Annual / Monthly)
  const [periodType, setPeriodType] = useState<BPKPPeriodType>('TAHUNAN');
  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(() => new Date().getMonth() + 1);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  // Firestore collections
  const [assessments, setAssessments] = useState<BPKPSelfAssessment[]>([]);
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
  const [riskRegisters, setRiskRegisters] = useState<RiskRegister[]>([]);
  const [rcsaList, setRcsaList] = useState<RCSAInlineItem[]>([]);
  const [kpiItems, setKpiItems] = useState<KPIItem[]>([]);
  const [kpiMeasurements, setKpiMeasurements] = useState<KPIMeasurement[]>([]);
  const [assignments, setAssignments] = useState<AuditAssignment[]>([]);
  const [auditReports, setAuditReports] = useState<AuditReport[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [wbsReports, setWbsReports] = useState<WBSReport[]>([]);
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [financialAudits, setFinancialAudits] = useState<FinancialPerformanceAudit[]>([]);

  // Workspace UI state
  const [viewTab, setViewTab] = useState<ViewTab>('hub');
  const [filterAspect, setFilterAspect] = useState<string>('ALL');
  const [filterSpipElement, setFilterSpipElement] = useState<number>(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editableIndicators, setEditableIndicators] = useState<BPKPIndicatorAssessment[]>(
    INITIAL_BPKP_KINERJA_INDICATORS
  );
  const [editableSpipElements, setEditableSpipElements] = useState<SPIPElementAssessment[]>(
    INITIAL_SPIP_ELEMENTS
  );
  const [editableSummary, setEditableSummary] = useState('');
  const [editableRecommendations, setEditableRecommendations] = useState('');

  // Status, Modals & Progress
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BPKPSelfAssessment | null>(null);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const canManage = hasRole(['KEPALA_SPI', 'AUDITOR', 'ADMIN_SISTEM']);
  const canApprove = hasRole(['KEPALA_SPI', 'DIREKTUR', 'ADMIN_SISTEM']);
  const isSuperUser = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);

  // Subscribe to all integrated Firestore collections
  useEffect(() => {
    const unsubs: (() => void)[] = [
      onSnapshot(collection(db, 'bpkp_assessments'), (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BPKPSelfAssessment));
        data.sort((a, b) => {
          if (b.year !== a.year) return b.year - a.year;
          const aType = a.periodType === 'BULANAN' ? 1 : 0;
          const bType = b.periodType === 'BULANAN' ? 1 : 0;
          if (aType !== bType) return aType - bType;
          return (b.month || 0) - (a.month || 0);
        });
        setAssessments(data);
      }),
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
        setReconciliations(
          s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceBankReconciliation))
        )
      ),
      onSnapshot(collection(db, 'fin_journals'), (s) =>
        setJournals(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceJournal)))
      ),
      onSnapshot(collection(db, 'fin_period_closes'), (s) =>
        setPeriodCloses(s.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePeriodClose)))
      ),
      onSnapshot(collection(db, 'fin_receivables_payables'), (s) =>
        setReceivablesPayables(
          s.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceReceivablePayable))
        )
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
        setPdamSnapshots(
          s.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePdamMonthlySnapshot))
        )
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
      onSnapshot(collection(db, 'risk_registers'), (s) =>
        setRiskRegisters(s.docs.map((d) => ({ id: d.id, ...d.data() } as RiskRegister)))
      ),
      onSnapshot(collection(db, 'rcsa_assessments'), (s) =>
        setRcsaList(s.docs.map((d) => ({ id: d.id, ...d.data() } as RCSAInlineItem)))
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
      onSnapshot(collection(db, 'audit_reports'), (s) =>
        setAuditReports(s.docs.map((d) => ({ id: d.id, ...d.data() } as AuditReport)))
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
      onSnapshot(collection(db, 'regulations'), (s) =>
        setRegulations(s.docs.map((d) => ({ id: d.id, ...d.data() } as Regulation)))
      ),
      onSnapshot(collection(db, 'fin_performance_audits'), (s) =>
        setFinancialAudits(
          s.docs.map((d) => ({ id: d.id, ...d.data() } as FinancialPerformanceAudit))
        )
      ),
    ];

    return () => unsubs.forEach((u) => u());
  }, []);

  // Resolve matching saved assessment for active (periodType, selectedYear, selectedMonth)
  const activeAssessment = useMemo(() => {
    if (periodType === 'BULANAN') {
      return (
        assessments.find(
          (a) => a.year === selectedYear && a.periodType === 'BULANAN' && a.month === selectedMonth
        ) || null
      );
    }
    return (
      assessments.find(
        (a) =>
          a.year === selectedYear && (a.periodType === 'TAHUNAN' || a.periodType === undefined)
      ) || null
    );
  }, [assessments, periodType, selectedYear, selectedMonth]);

  // Real-time Cross-Module Automation Engine output
  const liveAutoResult = useMemo(() => {
    return runBpkpCrossModuleAutomation({
      periodType,
      year: selectedYear,
      month: selectedMonth,
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
      riskRegisters,
      rcsaList,
      kpiItems,
      kpiMeasurements,
      assignments,
      auditReports,
      findings,
      recommendations,
      followUps,
      wbsReports,
      regulations,
      financialAudits,
      existingIndicators: activeAssessment?.indicators,
      existingSpipElements: activeAssessment?.spipElements,
    });
  }, [
    periodType,
    selectedYear,
    selectedMonth,
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
    riskRegisters,
    rcsaList,
    kpiItems,
    kpiMeasurements,
    assignments,
    auditReports,
    findings,
    recommendations,
    followUps,
    wbsReports,
    regulations,
    financialAudits,
    activeAssessment,
  ]);

  // 12-Month Trend Matrix for active year
  const monthlyTrendRows = useMemo(() => {
    return build12MonthBpkpTrend(
      {
        year: selectedYear,
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
        riskRegisters,
        rcsaList,
        kpiItems,
        kpiMeasurements,
        assignments,
        auditReports,
        findings,
        recommendations,
        followUps,
        wbsReports,
        regulations,
        financialAudits,
      },
      assessments
    );
  }, [
    selectedYear,
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
    riskRegisters,
    rcsaList,
    kpiItems,
    kpiMeasurements,
    assignments,
    auditReports,
    findings,
    recommendations,
    followUps,
    wbsReports,
    regulations,
    financialAudits,
    assessments,
  ]);

  // Sync editable local buffers when period or saved document changes
  useEffect(() => {
    setIsEditing(false);
    if (activeAssessment) {
      setEditableIndicators(activeAssessment.indicators || liveAutoResult.indicators);
      setEditableSpipElements(activeAssessment.spipElements || liveAutoResult.spipElements);
      setEditableSummary(
        activeAssessment.aiExecutiveSummary || liveAutoResult.narrative.executiveSummary
      );
      setEditableRecommendations(
        activeAssessment.aiStrategicRecommendations ||
          liveAutoResult.narrative.strategicRecommendations
      );
    } else {
      setEditableIndicators(liveAutoResult.indicators);
      setEditableSpipElements(liveAutoResult.spipElements);
      setEditableSummary(liveAutoResult.narrative.executiveSummary);
      setEditableRecommendations(liveAutoResult.narrative.strategicRecommendations);
    }
  }, [activeAssessment?.id, periodType, selectedYear, selectedMonth]);

  const activePeriodLabel =
    periodType === 'BULANAN'
      ? `Bulan ${FISCAL_MONTHS[selectedMonth - 1]} ${selectedYear}`
      : `Tahun Buku ${selectedYear}`;

  // Target Firestore ID builder
  const getTargetDocId = (pType: BPKPPeriodType, y: number, m?: number) => {
    if (pType === 'BULANAN' && m) {
      return `SA-SPIP-${y}-M${String(m).padStart(2, '0')}`;
    }
    const existingAnnual = assessments.find(
      (a) => a.year === y && (a.periodType === 'TAHUNAN' || a.periodType === undefined)
    );
    return existingAnnual?.id || `SA-SPIP-${y}`;
  };

  // Sync & Save Current Period (Monthly or Annual) to Firestore
  const handleAutoSyncAndSave = async () => {
    if (!canManage) return;
    setIsSyncing(true);
    setNotice(null);

    try {
      const targetId = getTargetDocId(periodType, selectedYear, selectedMonth);
      const nowIso = new Date().toISOString();
      const docPayload: BPKPSelfAssessment = {
        id: targetId,
        year: selectedYear,
        periodType,
        month: periodType === 'BULANAN' ? selectedMonth : undefined,
        periodLabel: activePeriodLabel,
        assessmentTitle:
          periodType === 'BULANAN'
            ? `Laporan Self Assessment Kinerja BUMD & SPIP Bulan ${FISCAL_MONTHS[selectedMonth - 1]} Tahun ${selectedYear}`
            : `Laporan Self Assessment Kinerja BUMD & Maturitas SPIP Tahun ${selectedYear}`,
        assessmentDate: nowIso.slice(0, 10),
        evaluatorName:
          activeAssessment?.evaluatorName ||
          userProfile?.displayName ||
          'Tim Asesor SPI Perumda Tirta Saiyo',
        evaluatorRole:
          activeAssessment?.evaluatorRole ||
          (userProfile?.role === 'KEPALA_SPI' ? 'Kepala Satuan Pengawasan Intern' : 'Auditor SPI'),
        status: activeAssessment?.status || 'Verifikasi SPI',
        kinerjaScore: liveAutoResult.kinerjaScore,
        kinerjaCategory: liveAutoResult.kinerjaCategory,
        aspectScores: liveAutoResult.aspectScores,
        indicators: liveAutoResult.indicators,
        spipMaturityScore: liveAutoResult.spipMaturityScore,
        spipMaturityLevel: liveAutoResult.spipMaturityLevel,
        spipElements: liveAutoResult.spipElements,
        isAutoSynced: true,
        lastSyncedAt: nowIso,
        syncedModules: liveAutoResult.syncedModules,
        crossModuleSummary: liveAutoResult.summary,
        aiExecutiveSummary: liveAutoResult.narrative.executiveSummary,
        aiStrategicRecommendations: liveAutoResult.narrative.strategicRecommendations,
        verifiedBy: activeAssessment?.verifiedBy,
        verifiedAt: activeAssessment?.verifiedAt,
        approvedBy: activeAssessment?.approvedBy,
        approvedAt: activeAssessment?.approvedAt,
        createdBy: activeAssessment?.createdBy || userProfile?.displayName || 'SPI',
        createdAt: activeAssessment?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      const cleaned = sanitizeFirestoreRecord(docPayload);
      await setDoc(doc(db, 'bpkp_assessments', targetId), cleaned, { merge: true });

      setEditableIndicators(liveAutoResult.indicators);
      setEditableSpipElements(liveAutoResult.spipElements);
      setEditableSummary(liveAutoResult.narrative.executiveSummary);
      setEditableRecommendations(liveAutoResult.narrative.strategicRecommendations);
      setIsEditing(false);
      setNotice({
        type: 'success',
        message: `Self Assessment ${activePeriodLabel} berhasil disinkronisasi otomatis dari ${liveAutoResult.syncedModules.length} modul lintas lini dan disimpan.`,
      });
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: `Gagal menyinkronisasi Self Assessment: ${err?.message || 'Kesalahan sistem.'}`,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Batch Generate all 12 Monthly Assessments for selectedYear
  const handleBatchGenerate12Months = async () => {
    if (!canManage) return;
    setIsBatchGenerating(true);
    setNotice(null);

    try {
      const nowIso = new Date().toISOString();
      let generatedCount = 0;

      for (let mNum = 1; mNum <= 12; mNum++) {
        const existingMonth = assessments.find(
          (a) => a.year === selectedYear && a.periodType === 'BULANAN' && a.month === mNum
        );
        const autoRes = runBpkpCrossModuleAutomation({
          periodType: 'BULANAN',
          year: selectedYear,
          month: mNum,
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
          riskRegisters,
          rcsaList,
          kpiItems,
          kpiMeasurements,
          assignments,
          auditReports,
          findings,
          recommendations,
          followUps,
          wbsReports,
          regulations,
          financialAudits,
          existingIndicators: existingMonth?.indicators,
          existingSpipElements: existingMonth?.spipElements,
        });

        const docId = `SA-SPIP-${selectedYear}-M${String(mNum).padStart(2, '0')}`;
        const mName = FISCAL_MONTHS[mNum - 1];
        const payload: BPKPSelfAssessment = {
          id: docId,
          year: selectedYear,
          periodType: 'BULANAN',
          month: mNum,
          periodLabel: `Bulan ${mName} ${selectedYear}`,
          assessmentTitle: `Laporan Self Assessment Kinerja BUMD & SPIP Bulan ${mName} Tahun ${selectedYear}`,
          assessmentDate: nowIso.slice(0, 10),
          evaluatorName:
            existingMonth?.evaluatorName || userProfile?.displayName || 'Tim Asesor SPI',
          evaluatorRole: 'Satuan Pengawasan Intern',
          status: existingMonth?.status || 'Verifikasi SPI',
          kinerjaScore: autoRes.kinerjaScore,
          kinerjaCategory: autoRes.kinerjaCategory,
          aspectScores: autoRes.aspectScores,
          indicators: autoRes.indicators,
          spipMaturityScore: autoRes.spipMaturityScore,
          spipMaturityLevel: autoRes.spipMaturityLevel,
          spipElements: autoRes.spipElements,
          isAutoSynced: true,
          lastSyncedAt: nowIso,
          syncedModules: autoRes.syncedModules,
          crossModuleSummary: autoRes.summary,
          aiExecutiveSummary: autoRes.narrative.executiveSummary,
          aiStrategicRecommendations: autoRes.narrative.strategicRecommendations,
          createdBy: existingMonth?.createdBy || userProfile?.displayName || 'SPI',
          createdAt: existingMonth?.createdAt || nowIso,
          updatedAt: nowIso,
        };

        await setDoc(doc(db, 'bpkp_assessments', docId), sanitizeFirestoreRecord(payload), {
          merge: true,
        });
        generatedCount++;
      }

      setNotice({
        type: 'success',
        message: `${generatedCount} Laporan Self Assessment Bulanan (Januari – Desember ${selectedYear}) berhasil disinkronisasi otomatis dan disimpan.`,
      });
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: `Gagal generate laporan 12 bulan: ${err?.message || 'Kesalahan sistem.'}`,
      });
    } finally {
      setIsBatchGenerating(false);
    }
  };

  // Manual edits on Indicators / SPIP Elements
  const handleIndicatorChange = (
    id: string,
    field: 'actualValue' | 'score' | 'evidenceRef' | 'notes',
    val: string | number
  ) => {
    setEditableIndicators((prev) =>
      prev.map((ind) => {
        if (ind.id !== id) return ind;
        const updated = { ...ind, [field]: val, dataSource: 'MANUAL' as const };
        if (field === 'score') {
          const scoreNum = Number(val) || 1;
          updated.score = scoreNum;
          updated.weightedScore = Math.round(scoreNum * updated.weight * 1000) / 1000;
        }
        return updated;
      })
    );
  };

  const handleApplyLiveValueToIndicator = (code: string) => {
    const liveInd = liveAutoResult.indicators.find((i) => i.code === code);
    if (!liveInd) return;
    setEditableIndicators((prev) => prev.map((ind) => (ind.code === code ? liveInd : ind)));
    setIsEditing(true);
    setNotice({
      type: 'info',
      message: `Nilai otomatis indikator ${code} (${liveInd.actualValue} ${liveInd.unitMeasurement}) diterapkan ke lembar kerja. Klik "Simpan Perubahan" untuk menyimpan ke database.`,
    });
  };

  const handleSpipElementChange = (
    id: string,
    field: 'selfRating' | 'evidenceRef' | 'improvementPlan',
    val: string | number
  ) => {
    setEditableSpipElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, [field]: val } : el))
    );
  };

  // Save edited scores/narratives to Firestore
  const handleSaveManualEdits = async () => {
    if (!canManage) return;
    let sumKeuangan = 0;
    let sumPelayanan = 0;
    let sumOperasional = 0;
    let sumSdm = 0;

    editableIndicators.forEach((ind) => {
      const ws = (Number(ind.score) || 1) * ind.weight;
      if (ind.aspect === 'KEUANGAN') sumKeuangan += ws;
      if (ind.aspect === 'PELAYANAN') sumPelayanan += ws;
      if (ind.aspect === 'OPERASIONAL') sumOperasional += ws;
      if (ind.aspect === 'SDM') sumSdm += ws;
    });

    const totalKinerja = Math.round((sumKeuangan + sumPelayanan + sumOperasional + sumSdm) * 100) / 100;
    const category = classifyKinerjaCategory(totalKinerja);
    const totalSpip = editableSpipElements.reduce((s, e) => s + (Number(e.selfRating) || 1), 0);
    const avgSpip = Math.round((totalSpip / (editableSpipElements.length || 1)) * 100) / 100;
    const maturityLevel = classifySpipLevel(avgSpip);

    const targetId = getTargetDocId(periodType, selectedYear, selectedMonth);
    const nowIso = new Date().toISOString();

    const updatedDoc: BPKPSelfAssessment = {
      id: targetId,
      year: selectedYear,
      periodType,
      month: periodType === 'BULANAN' ? selectedMonth : undefined,
      periodLabel: activePeriodLabel,
      assessmentTitle:
        activeAssessment?.assessmentTitle ||
        (periodType === 'BULANAN'
          ? `Laporan Self Assessment Kinerja BUMD & SPIP Bulan ${FISCAL_MONTHS[selectedMonth - 1]} Tahun ${selectedYear}`
          : `Laporan Self Assessment Kinerja BUMD & Maturitas SPIP Tahun ${selectedYear}`),
      assessmentDate: activeAssessment?.assessmentDate || nowIso.slice(0, 10),
      evaluatorName:
        activeAssessment?.evaluatorName || userProfile?.displayName || 'Tim Asesor SPI',
      evaluatorRole: activeAssessment?.evaluatorRole || 'Satuan Pengawasan Intern',
      status: activeAssessment?.status || 'Draft',
      kinerjaScore: totalKinerja,
      kinerjaCategory: category,
      aspectScores: {
        keuangan: Math.round(sumKeuangan * 1000) / 1000,
        pelayanan: Math.round(sumPelayanan * 1000) / 1000,
        operasional: Math.round(sumOperasional * 1000) / 1000,
        sdm: Math.round(sumSdm * 1000) / 1000,
      },
      indicators: editableIndicators,
      spipMaturityScore: avgSpip,
      spipMaturityLevel: maturityLevel,
      spipElements: editableSpipElements,
      isAutoSynced: activeAssessment?.isAutoSynced ?? true,
      lastSyncedAt: activeAssessment?.lastSyncedAt || nowIso,
      syncedModules: activeAssessment?.syncedModules || liveAutoResult.syncedModules,
      crossModuleSummary: liveAutoResult.summary,
      aiExecutiveSummary: editableSummary,
      aiStrategicRecommendations: editableRecommendations,
      createdBy: activeAssessment?.createdBy || userProfile?.displayName || 'SPI',
      createdAt: activeAssessment?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      await setDoc(doc(db, 'bpkp_assessments', targetId), sanitizeFirestoreRecord(updatedDoc), {
        merge: true,
      });
      setIsEditing(false);
      setNotice({
        type: 'success',
        message: `Perubahan Self Assessment ${activePeriodLabel} berhasil disimpan.`,
      });
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: `Gagal menyimpan perubahan: ${err?.message || 'Kesalahan sistem.'}`,
      });
    }
  };

  // Workflow Status Change
  const handleStatusUpdate = async (
    nextStatus: BPKPSelfAssessment['status']
  ) => {
    if (!activeAssessment) return;
    const nowIso = new Date().toISOString();
    const patch: Partial<BPKPSelfAssessment> = {
      status: nextStatus,
      updatedAt: nowIso,
    };
    if (nextStatus === 'Verifikasi SPI') {
      patch.verifiedBy = userProfile?.displayName || 'Kepala SPI';
      patch.verifiedAt = nowIso;
    }
    if (nextStatus === 'Disetujui Direktur' || nextStatus === 'Final Terverifikasi') {
      patch.approvedBy = userProfile?.displayName || 'Pimpinan';
      patch.approvedAt = nowIso;
    }

    try {
      await setDoc(doc(db, 'bpkp_assessments', activeAssessment.id), sanitizeFirestoreRecord(patch), { merge: true });
      setNotice({
        type: 'success',
        message: `Status Self Assessment ${activePeriodLabel} diperbarui menjadi "${nextStatus}".`,
      });
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: `Gagal memperbarui status: ${err?.message || 'Kesalahan sistem.'}`,
      });
    }
  };

  // AI Diagnostic Enhancement
  const handleRunAiDiagnostic = async () => {
    if (!canManage) return;
    setIsAiAnalyzing(true);
    setNotice(null);

    try {
      const res = await requestSpiAssist('analyze_bpkp_assessment', {
        year: selectedYear,
        periodLabel: activePeriodLabel,
        kinerjaScore: displayedKinerjaScore,
        kinerjaCategory: displayedKinerjaCategory,
        aspectScores: displayedAspectScores,
        indicators: editableIndicators,
        spipMaturityScore: displayedSpipScore,
        spipMaturityLevel: displayedSpipLevel,
        spipElements: editableSpipElements,
        crossModuleSummary: liveAutoResult.summary,
      });

      const rawText = res.text || '';
      let parsed: any = null;
      try {
        const cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = null;
      }

      const nextSummary =
        parsed?.executiveSummary || liveAutoResult.narrative.executiveSummary;
      const nextRecs =
        parsed?.strategicRecommendations || liveAutoResult.narrative.strategicRecommendations;

      setEditableSummary(nextSummary);
      setEditableRecommendations(nextRecs);

      if (activeAssessment) {
        await setDoc(
          doc(db, 'bpkp_assessments', activeAssessment.id),
          {
            aiExecutiveSummary: nextSummary,
            aiStrategicRecommendations: nextRecs,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }

      setViewTab('report');
      setNotice({
        type: 'success',
        message: `Ringkasan diagnostik dan rekomendasi strategis untuk ${activePeriodLabel} berhasil diperbarui.`,
      });
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: `Gagal memproses diagnostik: ${err?.message || 'Kesalahan sistem.'}`,
      });
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  // Delete saved assessment (Super User only)
  const handleConfirmDelete = async () => {
    if (!deleteTarget || !isSuperUser) return;
    try {
      await deleteDoc(doc(db, 'bpkp_assessments', deleteTarget.id));
      setNotice({
        type: 'success',
        message: `Dokumen Self Assessment "${deleteTarget.assessmentTitle}" berhasil dihapus.`,
      });
      setDeleteTarget(null);
    } catch (err: any) {
      setNotice({
        type: 'error',
        message: `Gagal menghapus dokumen: ${err?.message || 'Kesalahan sistem.'}`,
      });
    }
  };

  // Export Multi-Sheet Excel (.xlsx)
  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();

    const s = liveAutoResult.summary;
    const overviewRows = [
      ['LAPORAN SELF ASSESSMENT KINERJA BUMD & MATURITAS SPIP TERINTEGRASI'],
      ['Entitas', 'Perumda Air Minum Tirta Saiyo Kabupaten Pasaman'],
      ['Periode Laporan', activePeriodLabel],
      ['Tipe Periode', periodType === 'BULANAN' ? 'Laporan Bulanan' : 'Laporan Tahunan'],
      ['Status Dokumen', activeAssessment?.status || 'Pratinjau Otomatis (Belum Disimpan)'],
      ['Skor Kinerja Total', displayedKinerjaScore, displayedKinerjaCategory],
      ['Indeks Maturitas SPIP', displayedSpipScore, displayedSpipLevel],
      [''],
      ['INTEGRASI LINTAS MODUL (DATA AKTUAL SISTEM)'],
      ['Total Pendapatan', s.totalRevenue],
      ['Total Biaya', s.totalExpense],
      ['Laba / Rugi Bersih', s.netIncome],
      ['Saldo Kas & Bank', s.totalCashAndBank],
      ['Total Aset', s.totalAssets],
      ['Total Kewajiban Lancar', s.totalCurrentLiabilities],
      ['Total Ekuitas', s.totalEquity],
      ['Financial Cost Recovery (FCR %)', s.fcrPct],
      ['Operating Ratio', s.operatingRatio],
      ['Cash Ratio (%)', s.cashRatioPct],
      ['Return on Equity (ROE %)', s.roePct],
      ['Solvabilitas (%)', s.solvabilitasPct],
      ['Efektivitas Penagihan PDAM (%)', s.collectionEfficiencyPct],
      ['Tingkat Kehilangan Air / NRW (%)', s.nrwPct],
      ['Total Pagu RKA', s.rkaTotalBudget],
      ['Total Realisasi RKA', s.rkaTotalRealization],
      ['Penyerapan RKA (%)', s.rkaAbsorptionPct],
      ['Rata-rata Capaian KPI (%)', s.kpiAvgAchievementPct],
      ['Reduksi Risiko Inheren->Residual (%)', s.riskReductionPct],
      ['Realisasi PKPT (%)', s.pkptRealizationPct],
      ['Penyelesaian Rekomendasi / TLR (%)', s.tlrCompletionPct],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(overviewRows), 'Ringkasan Lintas Modul');

    const indRows = [
      ['Kode', 'Aspek', 'Indikator Kinerja', 'Sumber Data', 'Modul Sumber', 'Target', 'Satuan', 'Realisasi', 'Skor (1-5)', 'Bobot (%)', 'Skor Bobot', 'Bukti Dukung'],
      ...editableIndicators.map((ind) => [
        ind.code,
        ind.aspect,
        ind.name,
        ind.dataSource || 'MANUAL',
        ind.sourceModule || '-',
        ind.targetValue,
        ind.unitMeasurement,
        ind.actualValue,
        ind.score,
        Number((ind.weight * 100).toFixed(1)),
        Number((ind.score * ind.weight).toFixed(3)),
        ind.evidenceRef || '-',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(indRows), '18 Indikator Kinerja');

    const spipRows = [
      ['Unsur', 'Nama Unsur SPIP', 'Kode', 'Sub-Unsur SPIP', 'Sumber', 'Rating (1-5)', 'Bukti Dukung Otomatis / Manual', 'Rencana Peningkatan'],
      ...editableSpipElements.map((el) => [
        el.elementNumber,
        el.elementName,
        el.subElementCode,
        el.subElementName,
        el.sourceModule || 'Manual',
        el.selfRating,
        el.evidenceRef,
        el.improvementPlan,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(spipRows), 'Maturitas 5 Unsur SPIP');

    const trendRows = [
      ['Bulan', 'Pendapatan (Rp)', 'Biaya (Rp)', 'Operating Ratio', 'Cash Ratio (%)', 'Saldo Kas/Bank (Rp)', 'Serapan RKA (%)', 'Penagihan PDAM (%)', 'NRW (%)', 'Skor Estimasi', 'Status Arsip Bulanan'],
      ...monthlyTrendRows.map((r) => [
        r.monthName,
        r.revenue,
        r.expense,
        r.operatingRatio,
        r.cashRatioPct,
        r.cashBalance,
        r.rkaAbsorptionPct,
        r.collectionPct,
        r.nrwPct,
        r.estimatedScore,
        r.hasSavedReport ? `Tersimpan (${r.savedScore?.toFixed(2)} · ${r.savedStatus})` : 'Otomatis Live',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(trendRows), `Tren 12 Bulan ${selectedYear}`);

    const safeFilePeriod =
      periodType === 'BULANAN'
        ? `${selectedYear}_M${String(selectedMonth).padStart(2, '0')}_${FISCAL_MONTHS[selectedMonth - 1]}`
        : `${selectedYear}_Tahunan`;
    XLSX.writeFile(wb, `Self_Assessment_SPIP_Tirta_Saiyo_${safeFilePeriod}.xlsx`);
  };

  // Displayed KPIs (Saved doc if not editing/unsynced, otherwise live/editable)
  const displayedScoresFromEditable = useMemo(() => {
    let k = 0;
    let p = 0;
    let o = 0;
    let s = 0;
    editableIndicators.forEach((ind) => {
      const ws = (Number(ind.score) || 1) * ind.weight;
      if (ind.aspect === 'KEUANGAN') k += ws;
      if (ind.aspect === 'PELAYANAN') p += ws;
      if (ind.aspect === 'OPERASIONAL') o += ws;
      if (ind.aspect === 'SDM') s += ws;
    });
    const total = Math.round((k + p + o + s) * 100) / 100;
    const spipAvg =
      Math.round(
        (editableSpipElements.reduce((acc, el) => acc + (Number(el.selfRating) || 1), 0) /
          (editableSpipElements.length || 1)) *
          100
      ) / 100;
    return {
      total,
      category: classifyKinerjaCategory(total),
      aspects: {
        keuangan: Math.round(k * 1000) / 1000,
        pelayanan: Math.round(p * 1000) / 1000,
        operasional: Math.round(o * 1000) / 1000,
        sdm: Math.round(s * 1000) / 1000,
      },
      spipAvg,
      spipLevel: classifySpipLevel(spipAvg),
    };
  }, [editableIndicators, editableSpipElements]);

  const displayedKinerjaScore = isEditing
    ? displayedScoresFromEditable.total
    : activeAssessment?.kinerjaScore ?? liveAutoResult.kinerjaScore;
  const displayedKinerjaCategory = isEditing
    ? displayedScoresFromEditable.category
    : activeAssessment?.kinerjaCategory ?? liveAutoResult.kinerjaCategory;
  const displayedAspectScores = isEditing
    ? displayedScoresFromEditable.aspects
    : activeAssessment?.aspectScores ?? liveAutoResult.aspectScores;
  const displayedSpipScore = isEditing
    ? displayedScoresFromEditable.spipAvg
    : activeAssessment?.spipMaturityScore ?? liveAutoResult.spipMaturityScore;
  const displayedSpipLevel = isEditing
    ? displayedScoresFromEditable.spipLevel
    : activeAssessment?.spipMaturityLevel ?? liveAutoResult.spipMaturityLevel;

  const filteredIndicators = editableIndicators.filter(
    (ind) => filterAspect === 'ALL' || ind.aspect === filterAspect
  );
  const filteredSpipElements = editableSpipElements.filter(
    (el) => filterSpipElement === 0 || el.elementNumber === filterSpipElement
  );

  const autoSyncCount = liveAutoResult.indicators.filter(
    (i) => i.dataSource !== 'MANUAL'
  ).length;
  const cs = liveAutoResult.summary;

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="bg-white p-5 sm:p-6 rounded-xl border border-slate-200 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-emerald-800">
              Standar Kinerja BUMD & Maturitas SPIP (PP 60/2008)
            </span>
            <span aria-hidden="true">·</span>
            <span>Terintegrasi Lintas Modul Keuangan, PDAM, RKA, Risiko, KPI & SPI</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums font-medium text-slate-700">
              {autoSyncCount}/18 Indikator Otomatis
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Award className="w-6 h-6 text-emerald-700 shrink-0" />
            <span>Self Assessment Terpadu & Otomatis ({activePeriodLabel})</span>
          </h1>
          <p className="text-xs text-slate-600 max-w-3xl">
            Sinkronisasi real-time dengan Laporan Keuangan, Snapshot PDAM Permendagri 118/2018, Realisasi RKA Berjenjang, Register Risiko/RCSA, KPI 5 Tingkat, PKPT, dan Tindak Lanjut Temuan 5C untuk pelaporan Bulanan & Tahunan.
          </p>
        </div>

        {/* Period & Sync Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Segmented Control: Tahunan | Bulanan */}
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setPeriodType('TAHUNAN')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                periodType === 'TAHUNAN'
                  ? 'bg-white text-emerald-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Laporan Tahunan
            </button>
            <button
              type="button"
              onClick={() => setPeriodType('BULANAN')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                periodType === 'BULANAN'
                  ? 'bg-white text-emerald-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Laporan Bulanan
            </button>
          </div>

          {/* Year Select */}
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800 font-mono tabular-nums"
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>
                Tahun {y}
              </option>
            ))}
          </select>

          {/* Month Select (only when Bulanan) */}
          {periodType === 'BULANAN' && (
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800"
            >
              {FISCAL_MONTHS.map((mName, idx) => (
                <option key={mName} value={idx + 1}>
                  {mName}
                </option>
              ))}
            </select>
          )}

          {canManage && (
            <button
              type="button"
              onClick={handleAutoSyncAndSave}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {isSyncing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>{activeAssessment ? 'Sinkronkan & Perbarui' : 'Sinkronkan & Simpan'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-emerald-900 bg-slate-50 hover:bg-emerald-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-emerald-700" />
            <span>Cetak Laporan</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-emerald-900 bg-slate-50 hover:bg-emerald-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Ekspor Excel</span>
          </button>
        </div>
      </div>

      {/* Inline Notification Banner */}
      {notice && (
        <div
          className={`p-3.5 rounded-xl border text-xs font-medium flex items-center justify-between gap-3 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : notice.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <span className="flex items-center gap-2">
            {notice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : notice.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            ) : (
              <RefreshCw className="w-4 h-4 text-slate-600 shrink-0" />
            )}
            <span>{notice.message}</span>
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold underline shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Executive Summary 4-Column KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-emerald-900 text-white p-5 rounded-xl border border-emerald-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-emerald-200">
            <span>Skor Kinerja BUMD ({periodType === 'BULANAN' ? FISCAL_MONTHS[selectedMonth - 1] : selectedYear})</span>
            <Award className="w-4 h-4 text-amber-300 shrink-0" />
          </div>
          <div className="mt-2">
            <p className="text-lg font-bold text-amber-300 tracking-tight">
              {displayedKinerjaCategory}
            </p>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-3xl font-bold">{displayedKinerjaScore.toFixed(2)}</span>
              <span className="text-xs text-emerald-200">/ 5.00</span>
            </div>
          </div>
          <p className="text-[11px] text-emerald-200/90 mt-3 pt-2 border-t border-emerald-800">
            Ambang Sehat &gt; 2.80 · Estimasi Live: <span className="font-mono tabular-nums font-semibold">{liveAutoResult.kinerjaScore.toFixed(2)}</span>
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Maturitas SPIP (PP 60/2008)</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <div className="mt-2">
            <p className="text-sm font-bold text-slate-900">{displayedSpipLevel}</p>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-2xl font-bold text-emerald-800">
                {displayedSpipScore.toFixed(2)}
              </span>
              <span className="text-xs text-slate-400">/ 5.00</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-3 pt-2 border-t border-slate-100">
            21 Sub-Unsur · Integrasi Risiko, RKA, WBS & TLR
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500 pb-2 border-b border-slate-100">
            <span className="font-semibold text-slate-700">Capaian 4 Aspek Kinerja</span>
            <span className="font-mono tabular-nums text-[11px] text-emerald-700">Bobot Total 100%</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Keuangan (25%)</span>
              <span className="font-mono tabular-nums font-bold text-slate-900">
                {(displayedAspectScores.keuangan || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Pelayanan (25%)</span>
              <span className="font-mono tabular-nums font-bold text-slate-900">
                {(displayedAspectScores.pelayanan || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Operasi (35%)</span>
              <span className="font-mono tabular-nums font-bold text-slate-900">
                {(displayedAspectScores.operasional || 0).toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">SDM (15%)</span>
              <span className="font-mono tabular-nums font-bold text-slate-900">
                {(displayedAspectScores.sdm || 0).toFixed(2)}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-100">
            Keuangan: FCR <span className="font-mono tabular-nums font-semibold text-slate-700">{cs.fcrPct.toFixed(1)}%</span> · OR <span className="font-mono tabular-nums font-semibold text-slate-700">{cs.operatingRatio.toFixed(2)}</span>
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Status Dokumen Periode</span>
            <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          <div className="mt-2 space-y-1">
            <p className="text-sm font-bold text-slate-900">
              {activeAssessment ? activeAssessment.status : 'Belum Tersimpan (Mode Live)'}
            </p>
            <p className="text-xs text-slate-500 truncate">
              {activeAssessment
                ? `Sinkron terakhir: ${activeAssessment.lastSyncedAt ? activeAssessment.lastSyncedAt.slice(0, 10) : activeAssessment.updatedAt.slice(0, 10)}`
                : 'Klik "Sinkronkan & Simpan" untuk merekam periode ini'}
            </p>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              {liveAutoResult.syncedModules.length} Modul Aktif
            </span>
            {canApprove && activeAssessment && (
              <select
                value={activeAssessment.status}
                onChange={(e) =>
                  handleStatusUpdate(e.target.value as BPKPSelfAssessment['status'])
                }
                className="text-xs font-semibold bg-slate-50 border border-slate-300 rounded-md px-2 py-1 text-slate-800"
              >
                <option value="Draft">Draft</option>
                <option value="Verifikasi SPI">Verifikasi SPI</option>
                <option value="Disetujui Direktur">Disetujui Direktur</option>
                <option value="Final Terverifikasi">Final Terverifikasi</option>
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Main Navigation Workspace Container */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Sub-Navigation & Action Bar */}
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setViewTab('hub')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'hub'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>1. Hub Otomasi & Tren 12 Bulan</span>
            </button>

            <button
              type="button"
              onClick={() => setViewTab('kinerja')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'kinerja'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>2. Indikator Kinerja (18)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewTab('spip')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'spip'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>3. Maturitas SPIP (21 Sub-Unsur)</span>
            </button>

            <button
              type="button"
              onClick={() => setViewTab('report')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewTab === 'report'
                  ? 'bg-emerald-800 text-white'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>4. Laporan Bulanan / Tahunan & Arsip</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canManage && (
              <>
                <button
                  type="button"
                  onClick={handleBatchGenerate12Months}
                  disabled={isBatchGenerating}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isBatchGenerating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Generate 12 Bulan ({selectedYear})</span>
                </button>

                <button
                  type="button"
                  onClick={handleRunAiDiagnostic}
                  disabled={isAiAnalyzing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isAiAnalyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                  )}
                  <span>Diagnostik Narasi AI</span>
                </button>

                {isEditing ? (
                  <button
                    type="button"
                    onClick={handleSaveManualEdits}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Simpan Perubahan</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Edit Manual</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* TAB 1: HUB OTOMASI LINTAS MODUL & TREN 12 BULAN */}
        {viewTab === 'hub' && (
          <div className="p-5 sm:p-6 space-y-6">
            {/* Cross-Module Live Feeds Grid */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    Koneksi Data Real-Time Lintas Modul ({activePeriodLabel})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Nilai kinerja dan bukti SPIP ditarik otomatis dari 6 lini sistem di bawah ini tanpa input ganda.
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  Terhubung: {liveAutoResult.syncedModules.join(' · ') || 'Menunggu data transaksi'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-xs">
                {/* Lini 1: Laporan Keuangan & Akuntansi */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Landmark className="w-4 h-4 text-emerald-700" />
                      Laporan Keuangan & Akuntansi
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700">K.1, K.2, K.3, K.5, S.3</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Pendapatan</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {formatRp(cs.totalRevenue)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Beban / Biaya</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {formatRp(cs.totalExpense)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Kas & Bank Likuid</span>
                      <span className="font-mono tabular-nums font-bold text-emerald-800">
                        {formatRp(cs.totalCashAndBank)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Laba / Rugi Bersih</span>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          cs.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {formatRp(cs.netIncome)}
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 font-mono tabular-nums">
                    <span>ROE: {cs.roePct.toFixed(1)}%</span>
                    <span>OR: {cs.operatingRatio.toFixed(2)}</span>
                    <span>Cash: {cs.cashRatioPct.toFixed(1)}%</span>
                    <span>Solv: {cs.solvabilitasPct.toFixed(0)}%</span>
                  </div>
                </div>

                {/* Lini 2: Laporan Keuangan PDAM Permendagri 118/2018 */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-emerald-700" />
                      Laporan PDAM (Permendagri 118)
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700">K.4, P.2, P.5, O.1, O.2, S.1</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Efektivitas Penagihan</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.collectionEfficiencyPct.toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Kehilangan Air (NRW)</span>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          cs.nrwPct > 25 ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {cs.nrwPct.toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Efisiensi Produksi</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.productionEfficiencyPct.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Pelanggan Aktif</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.activeConnections.toLocaleString('id-ID')} SL
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 font-mono tabular-nums">
                    <span>Pertumbuhan: {cs.customerGrowthPct.toFixed(2)}%</span>
                    <span>Domestik: {cs.avgDomesticConsumptionM3.toFixed(1)} m³/bln</span>
                    <span>SDM/1000 SL: {cs.employeePer1000Ratio.toFixed(2)}</span>
                  </div>
                </div>

                {/* Lini 3: RKA Berjenjang & KPI 5 Tingkat */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <BookOpen className="w-4 h-4 text-emerald-700" />
                      RKA Berjenjang & KPI Cascading
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700">SPIP 1.6, 2.1, 3.1 + P/O/S</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Total Pagu RKA</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {formatRp(cs.rkaTotalBudget)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Realisasi RKA</span>
                      <span className="font-mono tabular-nums font-bold text-emerald-800">
                        {formatRp(cs.rkaTotalRealization)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Penyerapan Anggaran</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.rkaAbsorptionPct.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Rata-rata Capaian KPI</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.kpiAvgAchievementPct.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 font-mono tabular-nums">
                    <span>KPI Terverifikasi SPI: {cs.kpiVerifiedCount}</span>
                    <span>Tutup Buku: {cs.periodClosedCount} periode</span>
                  </div>
                </div>

                {/* Lini 4: Manajemen Risiko & RCSA */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-700" />
                      Manajemen Risiko & RCSA Unit
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700">SPIP Unsur 2 (2.2, 2.3)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Total Risiko Aktif</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.totalRisks} Risiko
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Reduksi Risiko</span>
                      <span className="font-mono tabular-nums font-bold text-emerald-700">
                        {cs.riskReductionPct.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Kontrol Efektif</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.effectiveControlPct.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">RCSA Direviu SPI</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.rcsaReviewedCount} Dokumen
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lini 5: Pengawasan Intern (PKPT, LHA, Audit Kinerja Keuangan) */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <ClipboardCheck className="w-4 h-4 text-emerald-700" />
                      PKPT, LHA & Audit Kinerja
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700">SPIP 1.7, 5.2</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Realisasi PKPT</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.pkptRealizationPct.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">LHA Final Terbit</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.completedAuditReports} Laporan
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Skor Audit Kinerja Keu.</span>
                      <span className="font-mono tabular-nums font-bold text-emerald-800">
                        {cs.financialAuditScore !== undefined
                          ? `${cs.financialAuditScore.toFixed(1)} / 100`
                          : 'Belum dinilai'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Rekonsiliasi Bank Sesuai</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.bankReconciliationMatchedCount} Dokumen
                      </span>
                    </div>
                  </div>
                </div>

                {/* Lini 6: Temuan 5C, TLR, WBS & Pajak */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-emerald-700" />
                      Temuan 5C, TLR, WBS & Kepatuhan
                    </span>
                    <span className="text-[11px] font-semibold text-emerald-700">SPIP 3.5, 4.3, 5.1, 5.3</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-slate-500 block">Temuan 5C Terbuka</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.findingsOpenCount} Temuan
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Penyelesaian TLR</span>
                      <span className="font-mono tabular-nums font-bold text-emerald-700">
                        {cs.tlrCompletionPct.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Laporan WBS & Regulasi</span>
                      <span className="font-mono tabular-nums font-bold text-slate-900">
                        {cs.wbsTotalCount} WBS · {cs.activeRegulationsCount} SOP
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Duplikasi / Pajak Terlambat</span>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          cs.duplicateAuditTrailCount + cs.overdueTaxCount > 0
                            ? 'text-rose-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {cs.duplicateAuditTrailCount} Dup · {cs.overdueTaxCount} Pajak
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Early Warnings Strip */}
            {liveAutoResult.earlyWarnings.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Peringatan Dini Lintas Lini ({liveAutoResult.earlyWarnings.length} Atensi)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {liveAutoResult.earlyWarnings.map((w) => (
                    <div
                      key={w.id}
                      className={`p-3.5 rounded-xl border text-xs flex items-start justify-between gap-3 ${
                        w.severity === 'KRITIS'
                          ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                          : 'bg-amber-50/70 border-amber-200 text-amber-950'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold">
                          <span>{w.severity}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{w.module}</span>
                        </div>
                        <p className="font-bold">{w.title}</p>
                        <p className="text-[11px] opacity-90">{w.detail}</p>
                      </div>
                      <span className="font-mono tabular-nums font-bold text-sm shrink-0">
                        {w.metric}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 12-Month Trend Matrix Table (Jan - Des) */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Matriks Tren Bulanan Otomatis (Januari – Desember {selectedYear})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Klik baris bulan mana pun untuk membuka atau menyusun Laporan Self Assessment Bulanan pada bulan tersebut.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Bulan</th>
                      <th className="p-3 text-right">Pendapatan (Rp)</th>
                      <th className="p-3 text-right">Biaya (Rp)</th>
                      <th className="p-3 text-right">Op. Ratio</th>
                      <th className="p-3 text-right">Cash Ratio</th>
                      <th className="p-3 text-right">Serapan RKA</th>
                      <th className="p-3 text-right">Penagihan</th>
                      <th className="p-3 text-right">NRW</th>
                      <th className="p-3 text-right">Skor Kinerja</th>
                      <th className="p-3">Status Laporan</th>
                      <th className="p-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {monthlyTrendRows.map((row) => {
                      const isCurrentSelected =
                        periodType === 'BULANAN' && selectedMonth === row.monthIndex;
                      return (
                        <tr
                          key={row.monthIndex}
                          className={`hover:bg-slate-50 transition-colors ${
                            isCurrentSelected ? 'bg-emerald-50/70' : ''
                          }`}
                        >
                          <td className="p-3 font-semibold text-slate-900">{row.monthName}</td>
                          <td className="p-3 text-right font-mono tabular-nums text-slate-800">
                            {formatRp(row.revenue)}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums text-slate-800">
                            {formatRp(row.expense)}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            {row.operatingRatio > 0 ? row.operatingRatio.toFixed(2) : '-'}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            {row.cashRatioPct > 0 ? `${row.cashRatioPct.toFixed(1)}%` : '-'}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            {row.rkaAbsorptionPct.toFixed(1)}%
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            {row.collectionPct > 0 ? `${row.collectionPct.toFixed(1)}%` : '-'}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums">
                            {row.nrwPct > 0 ? `${row.nrwPct.toFixed(1)}%` : '-'}
                          </td>
                          <td className="p-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                            {(row.savedScore ?? row.estimatedScore).toFixed(2)}
                          </td>
                          <td className="p-3 text-xs">
                            {row.hasSavedReport ? (
                              <span className="font-semibold text-emerald-700">
                                Tersimpan · {row.savedStatus}
                              </span>
                            ) : (
                              <span className="text-slate-500">Live Otomatis</span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setPeriodType('BULANAN');
                                setSelectedMonth(row.monthIndex);
                              }}
                              className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline whitespace-nowrap cursor-pointer"
                            >
                              Buka Bulan Ini
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: EVALUASI 18 INDIKATOR KINERJA BUMD */}
        {viewTab === 'kinerja' && (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-700">Filter Aspek:</span>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                  {['ALL', 'KEUANGAN', 'PELAYANAN', 'OPERASIONAL', 'SDM'].map((asp) => (
                    <button
                      key={asp}
                      type="button"
                      onClick={() => setFilterAspect(asp)}
                      className={`px-2.5 py-1 rounded-md font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        filterAspect === asp
                          ? 'bg-white text-emerald-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {asp === 'ALL' ? 'Semua (18 Indikator)' : asp}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs text-slate-500">
                Periode: <strong className="text-slate-800">{activePeriodLabel}</strong> · Bobot Total 100% (Maks 5.00)
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100/80 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-14 text-center">Kode</th>
                    <th className="p-3">Indikator & Sumber Otomasi</th>
                    <th className="p-3 text-right w-24">Target</th>
                    <th className="p-3 text-right w-28">Nilai Sistem Live</th>
                    <th className="p-3 text-right w-28">Realisasi Aktif</th>
                    <th className="p-3 text-center w-24">Skor (1-5)</th>
                    <th className="p-3 text-right w-24">Skor Bobot</th>
                    <th className="p-3 w-64">Bukti Dukung & Referensi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredIndicators.map((ind) => {
                    const liveInd = liveAutoResult.indicators.find((x) => x.code === ind.code);
                    const hasLiveDiff =
                      liveInd?.autoComputedValue !== undefined &&
                      Math.abs((liveInd.autoComputedValue || 0) - (ind.actualValue || 0)) > 0.01;
                    return (
                      <tr key={ind.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="p-3 text-center font-mono font-bold text-emerald-800">
                          {ind.code}
                        </td>
                        <td className="p-3 space-y-0.5">
                          <span className="font-bold text-slate-900 block">{ind.name}</span>
                          <div className="text-[11px] text-slate-500">
                            <span>Aspek {ind.aspect}</span>
                            <span aria-hidden="true"> · </span>
                            <span className="font-mono tabular-nums">
                              Bobot {(ind.weight * 100).toFixed(1)}%
                            </span>
                            <span aria-hidden="true"> · </span>
                            <span
                              className={
                                liveInd?.dataSource === 'OTOMATIS'
                                  ? 'text-emerald-700 font-semibold'
                                  : liveInd?.dataSource === 'SEMI_OTOMATIS'
                                  ? 'text-amber-700 font-semibold'
                                  : 'text-slate-500'
                              }
                            >
                              {liveInd?.sourceModule || ind.sourceModule || 'Input Manual'}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono tabular-nums text-slate-700">
                          {ind.targetValue} {ind.unitMeasurement}
                        </td>
                        <td className="p-3 text-right font-mono tabular-nums">
                          {liveInd?.autoComputedValue !== undefined ? (
                            <div className="space-y-0.5">
                              <span className="font-bold text-emerald-800 block">
                                {liveInd.autoComputedValue} {ind.unitMeasurement}
                              </span>
                              {hasLiveDiff && canManage && (
                                <button
                                  type="button"
                                  onClick={() => handleApplyLiveValueToIndicator(ind.code)}
                                  className="text-[11px] font-sans font-semibold text-emerald-700 underline cursor-pointer"
                                >
                                  Terapkan
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">Manual</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.01"
                              value={ind.actualValue}
                              onChange={(e) =>
                                handleIndicatorChange(
                                  ind.id,
                                  'actualValue',
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              className="w-24 px-2 py-1 text-right font-mono tabular-nums font-bold bg-white border border-emerald-400 rounded text-xs"
                            />
                          ) : (
                            <span className="font-mono tabular-nums font-bold text-slate-900">
                              {ind.actualValue} {ind.unitMeasurement}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <select
                              value={ind.score}
                              onChange={(e) => handleIndicatorChange(ind.id, 'score', e.target.value)}
                              className="px-2 py-1 text-xs font-bold bg-white border border-emerald-400 rounded"
                            >
                              <option value={5}>5 - Sangat Baik</option>
                              <option value={4}>4 - Baik</option>
                              <option value={3}>3 - Cukup</option>
                              <option value={2}>2 - Kurang</option>
                              <option value={1}>1 - Buruk</option>
                            </select>
                          ) : (
                            <span
                              className={`font-mono tabular-nums font-bold ${
                                ind.score >= 4
                                  ? 'text-emerald-700'
                                  : ind.score === 3
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                              }`}
                            >
                              {ind.score} / 5
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono tabular-nums font-bold text-slate-900">
                          {(ind.score * ind.weight).toFixed(3)}
                        </td>
                        <td className="p-3 text-xs">
                          {isEditing ? (
                            <textarea
                              rows={2}
                              value={ind.evidenceRef}
                              onChange={(e) =>
                                handleIndicatorChange(ind.id, 'evidenceRef', e.target.value)
                              }
                              className="w-full p-1.5 text-xs bg-white border border-slate-300 rounded leading-tight"
                            />
                          ) : (
                            <p className="text-[11px] text-slate-600 leading-snug">
                              {ind.evidenceRef || '-'}
                            </p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: MATURITAS 5 UNSUR SPIP TERINTEGRASI */}
        {viewTab === 'spip' && (
          <div className="p-5 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 text-xs">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">
                  Maturitas SPIP Terintegrasi 5 Unsur (PP 60/2008) — {activePeriodLabel}
                </h3>
                <p className="text-xs text-slate-500">
                  Sub-unsur SPIP tersinkronisasi otomatis dengan RKA, Risiko/RCSA, Rekonsiliasi/Tutup Buku, WBS, PKPT, LHA, dan Tindak Lanjut 5C.
                </p>
              </div>
              <select
                value={filterSpipElement}
                onChange={(e) => setFilterSpipElement(Number(e.target.value))}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800"
              >
                <option value={0}>Semua 5 Unsur SPIP (21 Sub-Unsur)</option>
                <option value={1}>Unsur 1: Lingkungan Pengendalian</option>
                <option value={2}>Unsur 2: Penilaian Risiko</option>
                <option value={3}>Unsur 3: Kegiatan Pengendalian</option>
                <option value={4}>Unsur 4: Informasi & Komunikasi</option>
                <option value={5}>Unsur 5: Pemantauan Pengendalian Intern</option>
              </select>
            </div>

            <div className="space-y-3">
              {filteredSpipElements.map((el) => {
                const liveEl = liveAutoResult.spipElements.find((x) => x.id === el.id);
                return (
                  <div
                    key={el.id}
                    className="p-4 bg-slate-50/60 border border-slate-200 rounded-xl space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="text-xs text-slate-500">
                          <span className="font-mono font-bold text-emerald-800">
                            {el.subElementCode}
                          </span>
                          <span aria-hidden="true"> · </span>
                          <span>{el.elementName}</span>
                          <span aria-hidden="true"> · </span>
                          <span
                            className={
                              liveEl?.dataSource === 'OTOMATIS'
                                ? 'text-emerald-700 font-semibold'
                                : 'text-slate-500'
                            }
                          >
                            {liveEl?.sourceModule || 'Manual'}
                          </span>
                        </div>
                        <p className="font-bold text-slate-900 text-sm">{el.subElementName}</p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 text-xs">
                        {liveEl?.autoComputedRating && (
                          <span className="text-[11px] font-mono tabular-nums text-emerald-700 font-semibold">
                            Rekomendasi Sistem: Level {liveEl.autoComputedRating}
                          </span>
                        )}
                        {isEditing ? (
                          <select
                            value={el.selfRating}
                            onChange={(e) =>
                              handleSpipElementChange(
                                el.id,
                                'selfRating',
                                parseInt(e.target.value, 10)
                              )
                            }
                            className="px-2 py-1 text-xs font-semibold bg-white border border-emerald-400 rounded"
                          >
                            <option value={1}>Level 1 - Rintisan</option>
                            <option value={2}>Level 2 - Berkembang</option>
                            <option value={3}>Level 3 - Terdefinisi</option>
                            <option value={4}>Level 4 - Terkelola & Terukur</option>
                            <option value={5}>Level 5 - Optimum</option>
                          </select>
                        ) : (
                          <span
                            className={`font-mono tabular-nums font-bold ${
                              el.selfRating >= 4
                                ? 'text-emerald-700'
                                : el.selfRating === 3
                                ? 'text-amber-700'
                                : 'text-rose-700'
                            }`}
                          >
                            Level {el.selfRating} / 5
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-600">
                      <strong className="text-slate-800">Kriteria: </strong>
                      {el.bpkpCriteria}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="font-semibold text-slate-700 block mb-1">
                          Bukti Dukung & Realisasi Lintas Modul:
                        </span>
                        {isEditing ? (
                          <textarea
                            rows={2}
                            value={el.evidenceRef}
                            onChange={(e) =>
                              handleSpipElementChange(el.id, 'evidenceRef', e.target.value)
                            }
                            className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                          />
                        ) : (
                          <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200">
                            {el.evidenceRef || '-'}
                          </p>
                        )}
                      </div>

                      <div>
                        <span className="font-semibold text-slate-700 block mb-1">
                          Rencana Peningkatan / Aksi SPIP:
                        </span>
                        {isEditing ? (
                          <textarea
                            rows={2}
                            value={el.improvementPlan}
                            onChange={(e) =>
                              handleSpipElementChange(el.id, 'improvementPlan', e.target.value)
                            }
                            className="w-full p-2 bg-white border border-slate-300 rounded text-xs"
                          />
                        ) : (
                          <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200">
                            {el.improvementPlan || '-'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: LAPORAN BULANAN / TAHUNAN & ARSIP */}
        {viewTab === 'report' && (
          <div className="p-5 sm:p-6 space-y-6">
            {/* Report Editor & Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Naskah Laporan Self Assessment ({activePeriodLabel})
                </h3>
                <p className="text-xs text-slate-500">
                  Ringkasan eksekutif dan rekomendasi disusun otomatis dari capaian keuangan, PDAM, RKA, risiko, dan pengawasan SPI.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Pratinjau & Cetak PDF / Word</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg whitespace-nowrap cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Unduh Excel (.xlsx)</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 text-xs">
              <div className="space-y-2">
                <label className="font-bold text-slate-800 block">
                  Ringkasan Eksekutif ({activePeriodLabel})
                </label>
                {isEditing ? (
                  <textarea
                    rows={7}
                    value={editableSummary}
                    onChange={(e) => setEditableSummary(e.target.value)}
                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-xs leading-relaxed"
                  />
                ) : (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 whitespace-pre-line leading-relaxed text-slate-700">
                    {editableSummary}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="font-bold text-slate-800 block">
                  Rekomendasi Strategis & Rencana Aksi
                </label>
                {isEditing ? (
                  <textarea
                    rows={7}
                    value={editableRecommendations}
                    onChange={(e) => setEditableRecommendations(e.target.value)}
                    className="w-full p-3 border border-slate-300 rounded-xl bg-white text-xs leading-relaxed"
                  />
                ) : (
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 whitespace-pre-line leading-relaxed text-slate-700">
                    {editableRecommendations}
                  </div>
                )}
              </div>
            </div>

            {/* Saved Assessments Archive (Monthly & Annual) */}
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">
                  Arsip Dokumen Self Assessment Tersimpan ({assessments.length} Dokumen)
                </h4>
                <span className="text-xs text-slate-500">
                  Mencakup laporan Tahunan & Bulanan
                </span>
              </div>

              {assessments.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-slate-300 rounded-xl space-y-2">
                  <p className="text-xs text-slate-600">
                    Belum ada dokumen Self Assessment tersimpan di database untuk periode ini.
                  </p>
                  {canManage && (
                    <button
                      type="button"
                      onClick={handleAutoSyncAndSave}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Sinkronkan & Simpan {activePeriodLabel}</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100/90 text-slate-700 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="p-3">Periode</th>
                        <th className="p-3">Jenis</th>
                        <th className="p-3">Judul Dokumen</th>
                        <th className="p-3 text-right">Skor Kinerja</th>
                        <th className="p-3 text-right">SPIP</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {assessments.map((ass) => {
                        const isMonthly = ass.periodType === 'BULANAN';
                        return (
                          <tr key={ass.id} className="hover:bg-slate-50">
                            <td className="p-3 font-semibold text-slate-900 font-mono tabular-nums">
                              {isMonthly && ass.month
                                ? `${FISCAL_MONTHS[ass.month - 1]} ${ass.year}`
                                : `Tahun ${ass.year}`}
                            </td>
                            <td className="p-3 text-slate-600">
                              {isMonthly ? 'Bulanan' : 'Tahunan'}
                            </td>
                            <td className="p-3 font-medium text-slate-800">
                              {ass.assessmentTitle}
                            </td>
                            <td className="p-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                              {ass.kinerjaScore.toFixed(2)} ({ass.kinerjaCategory})
                            </td>
                            <td className="p-3 text-right font-mono tabular-nums font-semibold">
                              {ass.spipMaturityScore.toFixed(2)}
                            </td>
                            <td className="p-3 text-slate-700">{ass.status}</td>
                            <td className="p-3 text-right space-x-3 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedYear(ass.year);
                                  if (ass.periodType === 'BULANAN' && ass.month) {
                                    setPeriodType('BULANAN');
                                    setSelectedMonth(ass.month);
                                  } else {
                                    setPeriodType('TAHUNAN');
                                  }
                                  setViewTab('hub');
                                }}
                                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
                              >
                                Buka
                              </button>
                              {isSuperUser && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(ass)}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:text-rose-900 cursor-pointer"
                                  title="Hapus dokumen (Super User)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Hapus</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* IN-APP DELETE CONFIRMATION MODAL */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">
                  Hapus Dokumen Self Assessment?
                </h3>
                <p className="text-xs text-slate-600">
                  Anda akan menghapus dokumen{' '}
                  <strong>{deleteTarget.assessmentTitle}</strong>. Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
              >
                Ya, Hapus Dokumen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OFFICIAL PRINT / PDF / WORD PREVIEW MODAL */}
      {isPrintModalOpen && (
        <DocumentPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          documentTitle={`LAPORAN SELF ASSESSMENT KINERJA BUMD & MATURITAS SPIP (${periodType === 'BULANAN' ? 'BULANAN' : 'TAHUNAN'})`}
          documentSubtitle={`Standar Kinerja BUMD Air Minum & PP 60/2008 · ${activePeriodLabel}`}
          documentNumber={
            periodType === 'BULANAN'
              ? `700.1/SA-SPIP/PTS/${selectedYear}/${String(selectedMonth).padStart(2, '0')}`
              : `700.1/SA-SPIP/PTS/${selectedYear}`
          }
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
          defaultShowSignatory2={true}
        >
          {(_config) => (
            <div className="space-y-6 text-slate-900 leading-relaxed font-serif text-[11px]">
              {/* Metadata Table */}
              <div className="border-b border-slate-300 pb-3 font-sans">
                <table className="w-full text-xs">
                  <tbody>
                    <tr>
                      <td className="w-44 font-bold text-slate-700 py-0.5">Nama Entitas</td>
                      <td className="w-3 text-center">:</td>
                      <td className="font-bold py-0.5">
                        Perumda Air Minum Tirta Saiyo Kabupaten Pasaman
                      </td>
                    </tr>
                    <tr>
                      <td className="font-bold text-slate-700 py-0.5">Periode Penilaian</td>
                      <td className="text-center">:</td>
                      <td className="py-0.5 font-bold">
                        {activePeriodLabel} ({periodType === 'BULANAN' ? 'Laporan Bulanan' : 'Laporan Tahunan'})
                      </td>
                    </tr>
                    <tr>
                      <td className="font-bold text-slate-700 py-0.5">Predikat Kinerja BUMD</td>
                      <td className="text-center">:</td>
                      <td className="py-0.5 font-bold text-emerald-900">
                        {displayedKinerjaCategory} (Skor: {displayedKinerjaScore.toFixed(2)} / 5.00)
                      </td>
                    </tr>
                    <tr>
                      <td className="font-bold text-slate-700 py-0.5">Maturitas SPIP (PP 60/2008)</td>
                      <td className="text-center">:</td>
                      <td className="py-0.5 font-bold">
                        {displayedSpipLevel} (Indeks: {displayedSpipScore.toFixed(2)} / 5.00)
                      </td>
                    </tr>
                    <tr>
                      <td className="font-bold text-slate-700 py-0.5">Modul Terintegrasi</td>
                      <td className="text-center">:</td>
                      <td className="py-0.5">
                        {liveAutoResult.syncedModules.join(', ') || 'Data Evaluasi Mandiri'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Bab I */}
              <div className="space-y-1.5">
                <h4 className="font-sans font-bold uppercase tracking-wider text-xs border-b border-slate-400 pb-1">
                  I. RINGKASAN EKSEKUTIF HASIL SELF ASSESSMENT
                </h4>
                <p className="text-justify whitespace-pre-line">{editableSummary}</p>
              </div>

              {/* Bab II: Ikhtisar Keuangan & Kinerja Lintas Modul */}
              <div className="space-y-1.5">
                <h4 className="font-sans font-bold uppercase tracking-wider text-xs border-b border-slate-400 pb-1">
                  II. IKHTISAR INTEGRASI LAPORAN KEUANGAN & DATA LINTAS MODUL
                </h4>
                <table className="w-full border-collapse border border-slate-400 text-[10px] font-sans">
                  <thead className="bg-slate-100 font-bold">
                    <tr>
                      <th className="border border-slate-400 p-1.5 text-left">Dimensi / Sumber Modul</th>
                      <th className="border border-slate-400 p-1.5 text-left">Indikator Utama Terintegrasi</th>
                      <th className="border border-slate-400 p-1.5 text-right">Capaian Aktual</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-slate-400 p-1.5 font-semibold">Akuntansi & Laba Rugi</td>
                      <td className="border border-slate-400 p-1.5">Pendapatan / Beban / Laba Bersih</td>
                      <td className="border border-slate-400 p-1.5 text-right font-mono">
                        {formatRp(cs.totalRevenue)} / {formatRp(cs.totalExpense)} / {formatRp(cs.netIncome)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-400 p-1.5 font-semibold">Kas, Bank & Neraca</td>
                      <td className="border border-slate-400 p-1.5">Kas & Bank / FCR / Operating Ratio / Cash Ratio</td>
                      <td className="border border-slate-400 p-1.5 text-right font-mono">
                        {formatRp(cs.totalCashAndBank)} · FCR {cs.fcrPct.toFixed(1)}% · OR {cs.operatingRatio.toFixed(2)} · Cash {cs.cashRatioPct.toFixed(1)}%
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-400 p-1.5 font-semibold">Laporan PDAM Permendagri 118</td>
                      <td className="border border-slate-400 p-1.5">Efektivitas Penagihan / NRW / Sambungan Aktif</td>
                      <td className="border border-slate-400 p-1.5 text-right font-mono">
                        {cs.collectionEfficiencyPct.toFixed(1)}% · NRW {cs.nrwPct.toFixed(1)}% · {cs.activeConnections.toLocaleString('id-ID')} SL
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-400 p-1.5 font-semibold">RKA & KPI 5 Tingkat</td>
                      <td className="border border-slate-400 p-1.5">Penyerapan RKA / Rata-rata Capaian KPI</td>
                      <td className="border border-slate-400 p-1.5 text-right font-mono">
                        {cs.rkaAbsorptionPct.toFixed(1)}% ({formatRp(cs.rkaTotalRealization)}) · KPI {cs.kpiAvgAchievementPct.toFixed(1)}%
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-slate-400 p-1.5 font-semibold">Risiko, PKPT & TLR 5C</td>
                      <td className="border border-slate-400 p-1.5">Kontrol Risiko Efektif / Realisasi PKPT / Penyelesaian TLR</td>
                      <td className="border border-slate-400 p-1.5 text-right font-mono">
                        {cs.effectiveControlPct.toFixed(1)}% · PKPT {cs.pkptRealizationPct.toFixed(1)}% · TLR {cs.tlrCompletionPct.toFixed(1)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Bab III: 18 Indikator Kinerja */}
              <div className="space-y-1.5">
                <h4 className="font-sans font-bold uppercase tracking-wider text-xs border-b border-slate-400 pb-1">
                  III. MATRIKS EVALUASI 18 INDIKATOR KINERJA BUMD AIR MINUM
                </h4>
                <table className="w-full border-collapse border border-slate-400 text-[9.5px]">
                  <thead className="bg-slate-100 font-sans font-bold text-center">
                    <tr>
                      <th className="border border-slate-400 p-1 w-8">Kode</th>
                      <th className="border border-slate-400 p-1 text-left">Indikator Standar BUMD</th>
                      <th className="border border-slate-400 p-1 w-14">Bobot</th>
                      <th className="border border-slate-400 p-1 w-16">Target</th>
                      <th className="border border-slate-400 p-1 w-16">Realisasi</th>
                      <th className="border border-slate-400 p-1 w-10">Skor</th>
                      <th className="border border-slate-400 p-1 w-14">Skor Bobot</th>
                      <th className="border border-slate-400 p-1 text-left">Bukti & Sumber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editableIndicators.map((ind) => (
                      <tr key={ind.id}>
                        <td className="border border-slate-400 p-1 text-center font-mono font-bold">
                          {ind.code}
                        </td>
                        <td className="border border-slate-400 p-1">
                          <span className="font-bold">{ind.name}</span> ({ind.aspect})
                        </td>
                        <td className="border border-slate-400 p-1 text-center font-mono">
                          {(ind.weight * 100).toFixed(1)}%
                        </td>
                        <td className="border border-slate-400 p-1 text-right font-mono">
                          {ind.targetValue} {ind.unitMeasurement}
                        </td>
                        <td className="border border-slate-400 p-1 text-right font-bold font-mono">
                          {ind.actualValue} {ind.unitMeasurement}
                        </td>
                        <td className="border border-slate-400 p-1 text-center font-bold font-mono">
                          {ind.score}
                        </td>
                        <td className="border border-slate-400 p-1 text-right font-bold font-mono">
                          {(ind.score * ind.weight).toFixed(3)}
                        </td>
                        <td className="border border-slate-400 p-1 text-[9px]">
                          {ind.evidenceRef || '-'}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-100 font-bold font-sans">
                      <td colSpan={6} className="border border-slate-400 p-1 text-right">
                        TOTAL SKOR KINERJA ({displayedKinerjaCategory}):
                      </td>
                      <td className="border border-slate-400 p-1 text-right font-mono text-emerald-900">
                        {displayedKinerjaScore.toFixed(2)}
                      </td>
                      <td className="border border-slate-400 p-1"></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Bab IV: Maturitas 5 Unsur SPIP */}
              <div className="space-y-1.5">
                <h4 className="font-sans font-bold uppercase tracking-wider text-xs border-b border-slate-400 pb-1">
                  IV. REKAPITULASI MATURITAS SPIP TERINTEGRASI ({displayedSpipLevel} · {displayedSpipScore.toFixed(2)})
                </h4>
                <table className="w-full border-collapse border border-slate-400 text-[9.5px]">
                  <thead className="bg-slate-100 font-sans font-bold">
                    <tr>
                      <th className="border border-slate-400 p-1 w-10 text-center">Kode</th>
                      <th className="border border-slate-400 p-1 text-left">Sub-Unsur SPIP</th>
                      <th className="border border-slate-400 p-1 w-14 text-center">Level</th>
                      <th className="border border-slate-400 p-1 text-left">Bukti Dukung Terintegrasi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editableSpipElements.map((el) => (
                      <tr key={el.id}>
                        <td className="border border-slate-400 p-1 text-center font-mono font-bold">
                          {el.subElementCode}
                        </td>
                        <td className="border border-slate-400 p-1">
                          <span className="font-bold">{el.subElementName}</span> ({el.elementName})
                        </td>
                        <td className="border border-slate-400 p-1 text-center font-mono font-bold">
                          Level {el.selfRating}
                        </td>
                        <td className="border border-slate-400 p-1 text-[9px]">{el.evidenceRef}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Bab V (for Annual Report): Tren 12 Bulan */}
              {periodType === 'TAHUNAN' && (
                <div className="space-y-1.5">
                  <h4 className="font-sans font-bold uppercase tracking-wider text-xs border-b border-slate-400 pb-1">
                    V. TREN CAPAIAN BULANAN OTOMATIS (JANUARI – DESEMBER {selectedYear})
                  </h4>
                  <table className="w-full border-collapse border border-slate-400 text-[9.5px] font-sans">
                    <thead className="bg-slate-100 font-bold">
                      <tr>
                        <th className="border border-slate-400 p-1 text-left">Bulan</th>
                        <th className="border border-slate-400 p-1 text-right">Pendapatan</th>
                        <th className="border border-slate-400 p-1 text-right">Biaya</th>
                        <th className="border border-slate-400 p-1 text-right">Op. Ratio</th>
                        <th className="border border-slate-400 p-1 text-right">Serapan RKA</th>
                        <th className="border border-slate-400 p-1 text-right">NRW %</th>
                        <th className="border border-slate-400 p-1 text-right">Skor BPKP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyTrendRows.map((row) => (
                        <tr key={row.monthIndex}>
                          <td className="border border-slate-400 p-1 font-semibold">{row.monthName}</td>
                          <td className="border border-slate-400 p-1 text-right font-mono">
                            {formatRp(row.revenue)}
                          </td>
                          <td className="border border-slate-400 p-1 text-right font-mono">
                            {formatRp(row.expense)}
                          </td>
                          <td className="border border-slate-400 p-1 text-right font-mono">
                            {row.operatingRatio > 0 ? row.operatingRatio.toFixed(2) : '-'}
                          </td>
                          <td className="border border-slate-400 p-1 text-right font-mono">
                            {row.rkaAbsorptionPct.toFixed(1)}%
                          </td>
                          <td className="border border-slate-400 p-1 text-right font-mono">
                            {row.nrwPct > 0 ? `${row.nrwPct.toFixed(1)}%` : '-'}
                          </td>
                          <td className="border border-slate-400 p-1 text-right font-mono font-bold">
                            {(row.savedScore ?? row.estimatedScore).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Bab VI: Rekomendasi Strategis */}
              <div className="space-y-1.5">
                <h4 className="font-sans font-bold uppercase tracking-wider text-xs border-b border-slate-400 pb-1">
                  {periodType === 'TAHUNAN' ? 'VI.' : 'V.'} REKOMENDASI TINDAK LANJUT STRATEGIS
                </h4>
                <div className="whitespace-pre-line text-justify leading-relaxed bg-slate-50 p-2.5 rounded border border-slate-200">
                  {editableRecommendations}
                </div>
              </div>
            </div>
          )}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
