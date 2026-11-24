import { UserRole } from './audit';

export type FinancialAuditPeriodType = 'BULANAN' | 'TAHUNAN';

export type FinancialAuditStatus =
  | 'Draft'
  | 'Review Pengendali Teknis'
  | 'Persetujuan Kepala SPI'
  | 'Final / Disahkan ke Direksi & Dewas';

export type FinancialAuditPredicate =
  | 'Sangat Baik (Sehat - Baik Sekali)'
  | 'Baik / Efektif Dengan Catatan Minor (Sehat - Baik)'
  | 'Cukup Baik / Perlu Perbaikan Terarah (Sehat - Cukup)'
  | 'Kurang Baik / Perhatian Khusus (Kurang Sehat)'
  | 'Tidak Memadai / Intervensi Kritis (Sakit)';

export type FinancialAuditDimension =
  | 'KEUANGAN_BPKP'
  | 'EKONOMI_RKA_PENGADAAN'
  | 'EFISIENSI_OPERASIONAL_PDAM'
  | 'KEPATUHAN_KAS_PAJAK'
  | 'PENGENDALIAN_RISIKO_TLR';

export type AuditIndicatorVerdict =
  | 'Sesuai Standar'
  | 'Perlu Perhatian'
  | 'Defisiensi Material';

export interface FinancialAuditIndicatorItem {
  id: string;
  code: string;
  dimension: FinancialAuditDimension;
  dimensionLabel: string;
  name: string;
  formulaDesc: string;
  standardRef: string;
  benchmarkLabel: string;
  unit: string;
  weight: number; // total across 12 indicators = 100
  systemValue: number;
  systemFormatted: string;
  systemScore: number; // 1..5
  auditorScore: number; // 1..5 (defaults to systemScore, editable by auditor)
  weightedPoints: number; // (auditorScore / 5) * weight -> sums to max 100
  verdict: AuditIndicatorVerdict;
  sourceModule: string;
  evidenceSummary: string;
  auditorNotes: string;
  linkedFindingId?: string;
  linkedFindingNumber?: string;
}

export interface FinancialAuditCrossLineSnapshot {
  periodType: FinancialAuditPeriodType;
  year: number;
  monthNumber?: number; // 1..12 when BULANAN
  monthName?: string;
  periodLabel: string;
  computedAt: string;

  // Lini 1: Akuntansi & Rasio
  totalAssets: number;
  totalCurrentAssets: number;
  netFixedAssets: number;
  totalLiabilities: number;
  totalCurrentLiabilities: number;
  totalLongTermLiabilities: number;
  totalEquity: number;
  isBalanceSheetBalanced: boolean;
  totalRevenue: number;
  operatingRevenue: number;
  totalExpense: number;
  operatingExpense: number;
  netIncome: number;
  budgetRevenue: number;
  budgetExpense: number;
  budgetNetIncome: number;
  monthlyRevenue: number;
  monthlyExpense: number;
  monthlyNetIncome: number;
  monthlyBudgetRevenue: number;
  monthlyBudgetExpense: number;
  operatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  endingCashAccounting: number;
  fcrPct: number;
  currentRatioPct: number;
  cashRatioPct: number;
  operatingRatioPct: number;
  debtToEquityRatioPct: number;
  roePct: number;
  roaPct: number;

  // Lini 2: Kas/Bank, Rekonsiliasi, Utang/Piutang, Aset, Persediaan, Pajak, PDAM
  totalCashBalance: number;
  totalBankBalance: number;
  totalLiquidBalance: number;
  periodReceiptsTotal: number;
  periodExpensesTotal: number;
  periodTransfersTotal: number;
  periodNetCashDelta: number;
  reconciliationCount: number;
  reconciliationMatchedCount: number;
  reconciliationVarianceCount: number;
  reconciliationTotalVariance: number;
  closedPeriodsCount: number;
  unpostedJournalCount: number;
  unbalancedJournalCount: number;
  openReceivablesTotal: number;
  overdueReceivablesTotal: number;
  overdueReceivablesCount: number;
  openPayablesTotal: number;
  overduePayablesTotal: number;
  overduePayablesCount: number;
  activeAssetsCount: number;
  assetsAcquisitionTotal: number;
  assetsBookValueTotal: number;
  inventoryItemsCount: number;
  inventoryEndingValue: number;
  purchasesCount: number;
  purchasesAmountTotal: number;
  taxRecordsCount: number;
  taxTotalAmount: number;
  taxPaidAmount: number;
  taxUnpaidAmount: number;
  taxOverdueCount: number;
  pdamCollectionEfficiencyPct: number;
  pdamNrwPct: number;
  pdamProducedM3: number;
  pdamSoldM3: number;
  pdamActiveConnections: number;
  pdamBilledAmount: number;
  pdamSnapshotAvailable: boolean;

  // Lini 3: RKA, PKPT & Audit Universe
  rkaParentCount: number;
  rkaSubCount: number;
  rkaTotalBudget: number;
  rkaTotalRealization: number;
  rkaRemainingBudget: number;
  rkaAbsorptionPct: number;
  rkaOverbudgetCount: number;
  rkaUnverifiedSubCount: number;
  pkptTotalCount: number;
  pkptFinanceRelatedCount: number;
  pkptCompletedCount: number;
  auditUniverseFinanceCount: number;

  // Lini 4: Risiko Keuangan, SPIP & KPI
  financialRisksCount: number;
  financialHighExtremeRiskCount: number;
  avgInherentRiskScore: number;
  avgResidualRiskScore: number;
  riskReductionPct: number;
  ineffectiveControlRisksCount: number;
  bpkpKinerjaScore: number;
  bpkpKeuanganAspectScore: number;
  spipMaturityScore: number;
  kpiFinanceCount: number;
  kpiFinanceAvgAchievementPct: number;
  kpiFinanceVerifiedCount: number;

  // Lini 5: SPT, Temuan 5C, WBS, Investigasi, Audit Trail & Regulasi
  financeAssignmentsCount: number;
  financeFindingsTotal: number;
  financeFindingsOpen: number;
  financeFindingsClosed: number;
  financeFindingsPotentialLoss: number;
  financeRecsTotal: number;
  financeRecsCompleted: number;
  financeRecsCompletionPct: number;
  financeWbsCount: number;
  financeInvestigationsCount: number;
  financeInvestigationLoss: number;
  duplicateAlertsCount: number;
  earlyWarningsCriticalCount: number;
  earlyWarningsTotalCount: number;
  activeRegulationsCount: number;

  // Composite 3E & BPKP Scores (0..100)
  totalCompositeScore: number;
  dimensionScores: {
    keuanganBpkp: number; // 0..100 normalized
    ekonomiRka: number;
    efisiensiPdam: number;
    kepatuhanKasPajak: number;
    pengendalianRisikoTlr: number;
  };
  predicate: FinancialAuditPredicate;

  // Detailed sub-lists for tables & exports
  monthlyTrend: Array<{
    monthIndex: number;
    monthName: string;
    receipts: number;
    expenses: number;
    netCashFlow: number;
    rkaRealization: number;
    findingsCount: number;
    txCount: number;
    duplicateFlags: number;
  }>;
  rkaBreakdown: Array<{
    id: string;
    code: string;
    programName: string;
    category: string;
    unitName: string;
    budgetAmount: number;
    totalRealization: number;
    remainingBudget: number;
    absorptionPct: number;
    isOverBudget: boolean;
    subCount: number;
    verifiedSubCount: number;
  }>;
  earlyWarnings: Array<{
    id: string;
    severity: 'KRITIS' | 'PERINGATAN' | 'INFO';
    category: string;
    title: string;
    detail: string;
    metricValue: string;
  }>;
}

export interface FinancialPerformanceAudit {
  id: string;
  auditNumber: string;
  auditTitle: string;
  periodType: FinancialAuditPeriodType;
  year: number;
  month?: number; // 1..12 for BULANAN
  monthName?: string;
  auditDate: string;
  assignmentId?: string;
  assignmentNumber?: string;
  unitId?: string;
  unitName: string;
  auditStandards: string; // e.g., AAIPI, GIAS 2024, Permendagri 118/2018, PP 60/2008
  materialityAmount: number;
  materialityBasis: string;
  supervisor: string;
  teamLeader: string;
  teamMembers: string;
  preparedBy: string;
  recipient: string;

  // Evaluation Matrix
  indicators: FinancialAuditIndicatorItem[];
  totalScore: number;
  predicate: FinancialAuditPredicate;
  dimensionScores: {
    keuanganBpkp: number;
    ekonomiRka: number;
    efisiensiPdam: number;
    kepatuhanKasPajak: number;
    pengendalianRisikoTlr: number;
  };

  // 9-Chapter Comprehensive Audit Report Narratives
  bab1ExecutiveSummary: string;
  bab2BasisScopeMethodology: string;
  bab3FinancialStatementsAnalysis: string;
  bab4BudgetRkaProcurementEval: string;
  bab5TreasuryAssetsTaxEval: string;
  bab6OperationalPdamRiskKpi: string;
  bab7InternalControlFindingsTlr: string;
  bab8ScoringMatrixAnalysis: string;
  bab9ConclusionRecommendations: string;
  managementCommitment: string;

  // Snapshot for historical integrity even after live DB changes
  snapshotSummary?: {
    totalAssets: number;
    totalRevenue: number;
    totalExpense: number;
    netIncome: number;
    fcrPct: number;
    currentRatioPct: number;
    operatingRatioPct: number;
    rkaAbsorptionPct: number;
    pdamCollectionEfficiencyPct: number;
    pdamNrwPct: number;
    financeFindingsTotal: number;
    financeFindingsPotentialLoss: number;
    computedAt: string;
  };

  status: FinancialAuditStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdBy: string;
  createdByRole?: UserRole | string;
  createdAt: string;
  updatedAt: string;
}
