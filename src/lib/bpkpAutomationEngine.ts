import {
  AuditAssignment,
  AuditReport,
  BPKPCrossModuleSyncSummary,
  BPKPDataSourceMode,
  BPKPIndicatorAssessment,
  BPKPKategoriKinerja,
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
  SPIPMaturityLevel,
  WBSReport,
} from '../types/audit';
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
} from '../types/finance';
import { FinancialPerformanceAudit } from '../types/financialAudit';
import { INITIAL_BPKP_KINERJA_INDICATORS, INITIAL_SPIP_ELEMENTS } from '../data/bpkpStandards';
import {
  computeAccountingStatements,
  computeCashBankBalances,
  computeFinancialAnalysisAndWarnings,
  computeRkaAbsorptionForTarget,
  formatRp,
  resolveMonthScopedReceivablesPayables,
} from './financeEngine';
import { FISCAL_MONTHS } from './featureCatalog';

export interface RCSAInlineItem {
  id: string;
  unitId: string;
  unitName: string;
  year: number;
  controlRating?: string;
  status?: string;
}

export interface BPKPAutomationInput {
  periodType: BPKPPeriodType;
  year: number;
  month: number; // 1..12
  accounts: FinanceAccount[];
  cashBanks: FinanceCashBankAccount[];
  transactions: FinanceTransaction[];
  reconciliations: FinanceBankReconciliation[];
  journals: FinanceJournal[];
  periodCloses: FinancePeriodClose[];
  receivablesPayables: FinanceReceivablePayable[];
  assets: FinanceAsset[];
  taxes: FinanceTaxRecord[];
  inventory: FinanceInventoryItem[];
  purchases: FinancePurchaseRecord[];
  pdamSnapshots: FinancePdamMonthlySnapshot[];
  auditTrails: FinanceAuditTrail[];
  rkaItems: RKAItem[];
  rkaSubItems: RKASubItem[];
  pkptList: PKPT[];
  riskRegisters: RiskRegister[];
  rcsaList: RCSAInlineItem[];
  kpiItems: KPIItem[];
  kpiMeasurements: KPIMeasurement[];
  assignments: AuditAssignment[];
  auditReports: AuditReport[];
  findings: Finding[];
  recommendations: Recommendation[];
  followUps: FollowUp[];
  wbsReports: WBSReport[];
  regulations: Regulation[];
  financialAudits: FinancialPerformanceAudit[];
  existingIndicators?: BPKPIndicatorAssessment[];
  existingSpipElements?: SPIPElementAssessment[];
}

export interface BPKPMonthlyTrendRow {
  monthIndex: number;
  monthName: string;
  revenue: number;
  expense: number;
  operatingRatio: number;
  cashRatioPct: number;
  cashBalance: number;
  rkaAbsorptionPct: number;
  collectionPct: number;
  nrwPct: number;
  estimatedScore: number;
  hasSavedReport: boolean;
  savedAssessmentId?: string;
  savedScore?: number;
  savedStatus?: string;
}

export interface BPKPEarlyWarningItem {
  id: string;
  severity: 'KRITIS' | 'PERINGATAN' | 'INFO';
  module: string;
  title: string;
  detail: string;
  metric: string;
}

export interface BPKPAutomationResult {
  summary: BPKPCrossModuleSyncSummary;
  indicators: BPKPIndicatorAssessment[];
  spipElements: SPIPElementAssessment[];
  kinerjaScore: number;
  kinerjaCategory: BPKPKategoriKinerja;
  aspectScores: {
    keuangan: number;
    pelayanan: number;
    operasional: number;
    sdm: number;
  };
  spipMaturityScore: number;
  spipMaturityLevel: SPIPMaturityLevel;
  syncedModules: string[];
  earlyWarnings: BPKPEarlyWarningItem[];
  narrative: {
    executiveSummary: string;
    strengthsAndAchievements: string;
    gapAnalysisAndWeaknesses: string;
    strategicRecommendations: string;
  };
}

const round2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
const round3 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 1000) / 1000;

export function parseMonth1Based(monthStr?: string, dateStr?: string): number {
  if (monthStr) {
    const idx = FISCAL_MONTHS.findIndex((m) => m.toLowerCase() === monthStr.trim().toLowerCase());
    if (idx >= 0) return idx + 1;
    const asNum = parseInt(monthStr, 10);
    if (!isNaN(asNum) && asNum >= 1 && asNum <= 12) return asNum;
  }
  if (dateStr) {
    const match = /^\d{4}-(\d{2})-\d{2}/.exec(dateStr.trim());
    if (match) {
      const m = parseInt(match[1], 10);
      if (m >= 1 && m <= 12) return m;
    }
  }
  return 0;
}

function isInScope(params: {
  periodType: BPKPPeriodType;
  targetYear: number;
  targetMonth: number;
  itemYear?: number;
  itemMonthName?: string;
  itemDate?: string;
  cumulativeUpToMonth?: boolean;
}): boolean {
  const { periodType, targetYear, targetMonth, itemYear, itemMonthName, itemDate, cumulativeUpToMonth } =
    params;
  let y = itemYear || 0;
  if (!y && itemDate && /^\d{4}/.test(itemDate)) {
    y = parseInt(itemDate.slice(0, 4), 10) || 0;
  }
  if (y !== targetYear) return false;
  if (periodType === 'TAHUNAN') return true;
  const m = parseMonth1Based(itemMonthName, itemDate);
  if (m === 0) return true;
  return cumulativeUpToMonth ? m <= targetMonth : m === targetMonth;
}

export function classifyKinerjaCategory(score: number): BPKPKategoriKinerja {
  if (score >= 4.2) return 'SEHAT - BAIK SEKALI';
  if (score >= 3.5) return 'SEHAT - BAIK';
  if (score >= 2.8) return 'SEHAT - CUKUP';
  if (score >= 2.2) return 'KURANG SEHAT';
  return 'SAKIT';
}

export function classifySpipLevel(score: number): SPIPMaturityLevel {
  if (score >= 4.5) return 'Level 5 - Optimum';
  if (score >= 4.0) return 'Level 4 - Terkelola & Terukur';
  if (score >= 3.0) return 'Level 3 - Terdefinisi';
  if (score >= 2.0) return 'Level 2 - Berkembang';
  return 'Level 1 - Rintisan';
}

// Scoring Rubrics (Kepmendagri 47/1999 & Juknis Kinerja BUMD Air Minum)
function scoreIndicatorByCode(code: string, val: number): number {
  switch (code) {
    case 'K.1': // ROE %
      if (val >= 10) return 5;
      if (val >= 7) return 4;
      if (val >= 3) return 3;
      if (val >= 0) return 2;
      return 1;
    case 'K.2': // Operating Ratio (<=0.85 target)
      if (val <= 0.85) return 5;
      if (val <= 0.92) return 4;
      if (val <= 1.0) return 3;
      if (val <= 1.1) return 2;
      return 1;
    case 'K.3': // Cash Ratio %
      if (val >= 100) return 5;
      if (val >= 80) return 4;
      if (val >= 60) return 3;
      if (val >= 40) return 2;
      return 1;
    case 'K.4': // Collection Ratio %
      if (val >= 90) return 5;
      if (val >= 85) return 4;
      if (val >= 80) return 3;
      if (val >= 75) return 2;
      return 1;
    case 'K.5': // Solvabilitas %
      if (val >= 200) return 5;
      if (val >= 170) return 4;
      if (val >= 135) return 3;
      if (val >= 100) return 2;
      return 1;
    case 'P.1': // Cakupan Pelayanan Teknis %
      if (val >= 80) return 5;
      if (val >= 60) return 4;
      if (val >= 40) return 3;
      if (val >= 20) return 2;
      return 1;
    case 'P.2': // Pertumbuhan Pelanggan %
      if (val >= 8) return 5;
      if (val >= 6) return 4;
      if (val >= 4) return 3;
      if (val >= 2) return 2;
      return 1;
    case 'P.3': // Penyelesaian Pengaduan %
      if (val >= 80) return 5;
      if (val >= 60) return 4;
      if (val >= 40) return 3;
      if (val >= 20) return 2;
      return 1;
    case 'P.4': // Kualitas Air Pelanggan %
      if (val >= 99) return 5;
      if (val >= 80) return 4;
      if (val >= 60) return 3;
      if (val >= 40) return 2;
      return 1;
    case 'P.5': // Konsumsi Air Domestik m3/bln
      if (val >= 25) return 4;
      if (val >= 15) return 5;
      if (val >= 10) return 3;
      if (val >= 5) return 2;
      return 1;
    case 'O.1': // Efisiensi Produksi %
      if (val >= 75) return 5;
      if (val >= 65) return 4;
      if (val >= 55) return 3;
      if (val >= 45) return 2;
      return 1;
    case 'O.2': // NRW % (Lower is better)
      if (val <= 20) return 5;
      if (val <= 25) return 4;
      if (val <= 30) return 3;
      if (val <= 35) return 2;
      return 1;
    case 'O.3': // Jam Operasi Jam/hari
      if (val >= 21) return 5;
      if (val >= 18) return 4;
      if (val >= 12) return 3;
      if (val >= 6) return 2;
      return 1;
    case 'O.4': // Tekanan Air %
      if (val >= 80) return 5;
      if (val >= 60) return 4;
      if (val >= 40) return 3;
      if (val >= 20) return 2;
      return 1;
    case 'O.5': // Penggantian Water Meter %
      if (val >= 80) return 5;
      if (val >= 60) return 4;
      if (val >= 40) return 3;
      if (val >= 20) return 2;
      return 1;
    case 'S.1': // Rasio Pegawai per 1.000 Pelanggan (Lower is better)
      if (val <= 6) return 5;
      if (val <= 8) return 4;
      if (val <= 10) return 3;
      if (val <= 12) return 2;
      return 1;
    case 'S.2': // Rasio Diklat Pegawai %
      if (val >= 80) return 5;
      if (val >= 60) return 4;
      if (val >= 40) return 3;
      if (val >= 20) return 2;
      return 1;
    case 'S.3': // Biaya Diklat / Biaya Pegawai %
      if (val >= 4) return 5;
      if (val >= 3) return 4;
      if (val >= 2) return 3;
      if (val >= 1) return 2;
      return 1;
    default:
      return 3;
  }
}

function findMatchingKpiRealization(
  keywords: string[],
  kpiItems: KPIItem[],
  kpiMeasurements: KPIMeasurement[],
  year: number,
  periodType: BPKPPeriodType,
  month: number
): { value: number; kpiName: string; verified: boolean } | null {
  const candidates = kpiItems.filter(
    (k) =>
      k.year === year &&
      keywords.some((kw) => `${k.name} ${k.code} ${k.operationalDefinition}`.toLowerCase().includes(kw))
  );
  if (candidates.length === 0) return null;

  for (const kpi of candidates) {
    const ms = kpiMeasurements.filter((m) => m.kpiId === kpi.id && m.year === year);
    if (ms.length === 0) continue;

    let match: KPIMeasurement | undefined;
    if (periodType === 'BULANAN') {
      match =
        ms.find((m) => m.periodType === 'Bulanan' && m.periodIndex === month) ||
        ms
          .filter((m) => m.periodType === 'Bulanan' && m.periodIndex <= month)
          .sort((a, b) => b.periodIndex - a.periodIndex)[0];
    } else {
      match =
        ms.find((m) => m.periodType === 'Tahunan') ||
        ms
          .filter((m) => m.periodType === 'Bulanan')
          .sort((a, b) => b.periodIndex - a.periodIndex)[0];
    }
    if (match && Number.isFinite(match.realizationValue)) {
      return {
        value: round2(match.realizationValue),
        kpiName: `${kpi.code} ${kpi.name}`,
        verified: match.spiVerificationStatus === 'Terverifikasi SPI',
      };
    }
  }
  return null;
}

export function runBpkpCrossModuleAutomation(input: BPKPAutomationInput): BPKPAutomationResult {
  const {
    periodType,
    year,
    month,
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
    existingIndicators,
    existingSpipElements,
  } = input;

  const nowIso = new Date().toISOString();
  const targetMonthName = FISCAL_MONTHS[Math.max(0, Math.min(11, month - 1))] || 'Januari';
  const periodLabel =
    periodType === 'BULANAN' ? `Bulan ${targetMonthName} ${year}` : `Tahun Buku ${year}`;
  const cutoffDate =
    periodType === 'BULANAN' ? `${year}-${String(month).padStart(2, '0')}-31` : `${year}-12-31`;

  // 1. Scope Finance & Accounting
  const journalsYtd = journals.filter((j) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: j.year,
      itemMonthName: j.month,
      itemDate: j.journalDate,
      cumulativeUpToMonth: true,
    })
  );
  const txYtd = transactions.filter((t) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: t.year,
      itemMonthName: t.month,
      itemDate: t.transactionDate,
      cumulativeUpToMonth: true,
    })
  );

  const bpkpMonthFilter = periodType === 'BULANAN' ? targetMonthName : 'ALL';

  const statements = computeAccountingStatements({
    accounts,
    journals: journalsYtd,
    transactions: txYtd,
    yearFilter: year,
    monthFilter: bpkpMonthFilter,
  });

  const cashBankSummary = computeCashBankBalances(
    cashBanks.filter((c) => c.isActive !== false),
    txYtd,
    cutoffDate,
    year,
    bpkpMonthFilter
  );

  // Scoped RKA
  const scopedRkaParents = rkaItems.filter((r) => r.year === year);
  const scopedRkaSubs = rkaSubItems.filter(
    (s) =>
      s.year === year &&
      (periodType === 'TAHUNAN' || parseMonth1Based(s.executionMonth) <= month)
  );
  let rkaTotalBudget = 0;
  let rkaTotalRealization = 0;
  scopedRkaParents.forEach((p) => {
    const subs = rkaSubItems.filter((s) => s.parentRkaId === p.id);
    const abs = computeRkaAbsorptionForTarget({
      parentRka: p,
      allSubItemsForParent: subs,
      allTransactions: txYtd,
    });
    rkaTotalBudget += abs.budgetAmount;
    rkaTotalRealization += abs.totalRealization;
  });
  const rkaAbsorptionPct = rkaTotalBudget > 0 ? round2((rkaTotalRealization / rkaTotalBudget) * 100) : 0;

  // PDAM Snapshots in scope
  const yearSnapshots = pdamSnapshots
    .filter((s) => s.year === year)
    .sort((a, b) => parseMonth1Based(b.month) - parseMonth1Based(a.month));
  const targetSnapshot =
    periodType === 'BULANAN'
      ? yearSnapshots.find((s) => s.month.toLowerCase() === targetMonthName.toLowerCase()) ||
        yearSnapshots.find((s) => parseMonth1Based(s.month) <= month)
      : yearSnapshots[0];

  const scopedTaxes = taxes.filter((t) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: t.year,
      itemMonthName: t.month,
      itemDate: t.dueDate,
      cumulativeUpToMonth: false,
    })
  );
  const scopedRecons = reconciliations.filter((r) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: r.year,
      itemMonthName: r.month,
      itemDate: r.reconcileDate,
      cumulativeUpToMonth: false,
    })
  );
  const scopedRp = resolveMonthScopedReceivablesPayables(
    receivablesPayables,
    year,
    bpkpMonthFilter
  );
  const scopedInventory = inventory.filter((inv) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: inv.year,
      itemMonthName: inv.month,
      cumulativeUpToMonth: false,
    })
  );
  const scopedAuditTrails = auditTrails.filter((a) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: a.year,
      itemDate: a.timestamp?.slice(0, 10),
      cumulativeUpToMonth: false,
    })
  );

  const assetSnapshotYears = Array.from(
    new Set(
      assets
        .map((a) => /^ast-(\d{4})-(dec|jan)-/.exec(a.id))
        .filter((m): m is RegExpExecArray => Boolean(m))
        .map((m) => parseInt(m[1], 10))
    )
  ).sort((a, b) => a - b);
  const targetAssetYear = (() => {
    if (assetSnapshotYears.length === 0) return 0;
    if (assetSnapshotYears.includes(year)) return year;
    const prior = assetSnapshotYears.filter((y) => y <= year);
    return prior.length > 0 ? prior[prior.length - 1] : assetSnapshotYears[0];
  })();
  const scopedAssets = assets.filter((a) => {
    const snapMatch = /^ast-(\d{4})-(dec|jan)-/.exec(a.id);
    if (snapMatch) return parseInt(snapMatch[1], 10) === targetAssetYear;
    const acqYear = parseInt(a.acquisitionDate?.slice(0, 4) || '0', 10);
    return acqYear === 0 || acqYear <= year;
  });

  const analysis = computeFinancialAnalysisAndWarnings({
    statements,
    totalCashAndBank: cashBankSummary.totalLiquidBalance,
    transactions: txYtd,
    receivablesPayables: scopedRp,
    taxes: scopedTaxes,
    rkaItems: scopedRkaParents,
    rkaSubItems: scopedRkaSubs,
    assets: scopedAssets,
    auditTrails: scopedAuditTrails,
    year,
    pdamSnapshots: targetSnapshot ? [targetSnapshot] : yearSnapshots,
    inventory: scopedInventory,
  });

  // Effective period Revenue/Expense/NetIncome
  const hasMonthlyStmtData =
    periodType === 'BULANAN' &&
    (statements.incomeStatement.monthlyTotalRevenue > 0 ||
      statements.incomeStatement.monthlyTotalExpense > 0);
  const effectiveRevenue = hasMonthlyStmtData
    ? statements.incomeStatement.monthlyTotalRevenue
    : statements.incomeStatement.totalRevenue;
  const effectiveOpRevenue = hasMonthlyStmtData
    ? statements.incomeStatement.monthlyTotalOperatingRevenue
    : statements.incomeStatement.totalOperatingRevenue;
  const effectiveExpense = hasMonthlyStmtData
    ? statements.incomeStatement.monthlyTotalExpense
    : statements.incomeStatement.totalExpense;
  const effectiveOpExpense = hasMonthlyStmtData
    ? statements.incomeStatement.monthlyTotalOperatingExpense
    : statements.incomeStatement.totalOperatingExpense;
  const effectiveNetIncome = hasMonthlyStmtData
    ? statements.incomeStatement.monthlyNetIncome
    : statements.incomeStatement.netIncome;

  // Fallback check from PDAM summaryMetrics if Accounting statements have 0 revenue
  const pdamMetrics = targetSnapshot?.summaryMetrics || [];
  const findPdamMetric = (keywords: string[], useMonthly: boolean) => {
    const row = pdamMetrics.find((m) =>
      keywords.some((kw) => `${m.code} ${m.label}`.toLowerCase().includes(kw))
    );
    if (!row) return 0;
    return useMonthly ? row.monthlyReal || row.ytdReal || 0 : row.ytdReal || row.monthlyReal || 0;
  };

  const finalRevenue =
    effectiveRevenue > 0
      ? effectiveRevenue
      : findPdamMetric(['pendapatan usaha', 'total pendapatan'], periodType === 'BULANAN');
  const finalOpRevenue =
    effectiveOpRevenue > 0
      ? effectiveOpRevenue
      : findPdamMetric(['pendapatan usaha', 'pendapatan air'], periodType === 'BULANAN') || finalRevenue;
  const finalExpense =
    effectiveExpense > 0
      ? effectiveExpense
      : findPdamMetric(['beban usaha', 'total beban', 'biaya operasi'], periodType === 'BULANAN');
  const finalOpExpense =
    effectiveOpExpense > 0
      ? effectiveOpExpense
      : findPdamMetric(['beban usaha', 'biaya operasi'], periodType === 'BULANAN') || finalExpense;
  const finalNetIncome =
    effectiveNetIncome !== 0 ? effectiveNetIncome : finalRevenue - finalExpense;

  const totalAssets = statements.balanceSheet.totalAssets;
  const totalCurrentAssets = statements.balanceSheet.totalCurrentAssets;
  const totalCurrentLiabilities = statements.balanceSheet.totalCurrentLiabilities;
  const totalLiabilities = statements.balanceSheet.totalLiabilities;
  const totalEquity = statements.balanceSheet.totalEquity;
  const totalCashAndBank = cashBankSummary.totalLiquidBalance;

  // Financial Ratios
  const roePct =
    totalEquity > 0 ? round2((statements.incomeStatement.netIncome / totalEquity) * 100) : 0;
  const operatingRatioDecimal =
    finalOpRevenue > 0 ? round2(finalOpExpense / finalOpRevenue) : 0;
  const openUtangLancar = scopedRp
    .filter((r) => r.kind === 'UTANG' && r.status !== 'Lunas')
    .reduce((s, r) => s + (r.remainingAmount || 0), 0);
  const effectiveCurLiab = totalCurrentLiabilities > 0 ? totalCurrentLiabilities : openUtangLancar;
  const cashRatioPct =
    effectiveCurLiab > 0 ? round2((totalCashAndBank / effectiveCurLiab) * 100) : analysis.cashRatioPct;
  const currentRatioPct =
    effectiveCurLiab > 0
      ? round2((totalCurrentAssets / effectiveCurLiab) * 100)
      : analysis.currentRatioPct;
  const solvabilitasPct = totalLiabilities > 0 ? round2((totalAssets / totalLiabilities) * 100) : 0;
  const fcrPct =
    finalOpExpense > 0 ? round2((finalOpRevenue / finalOpExpense) * 100) : analysis.fcrPct;

  // PDAM Operational-Financial Metrics
  let collectionEfficiencyPct = 0;
  let nrwPct = 0;
  let productionEfficiencyPct = 0;
  let activeConnections = 0;
  let customerGrowthPct = 0;
  let avgDomesticConsumptionM3 = 0;
  let employeePer1000Ratio = 0;

  if (targetSnapshot) {
    const useYtd = periodType === 'TAHUNAN';
    const effRows = targetSnapshot.collectionEfficiency || [];
    const totalPrevBill = effRows.reduce((s, r) => s + (r.prevBilling || 0), 0);
    const totalColl = effRows.reduce((s, r) => s + (r.totalCollected || 0), 0);
    if (totalPrevBill > 0) {
      collectionEfficiencyPct = round2((totalColl / totalPrevBill) * 100);
    } else if (effRows.length > 0) {
      collectionEfficiencyPct = round2(
        effRows.reduce((s, r) => s + (r.totalEfficiencyPct || 0), 0) / effRows.length
      );
    }

    const prodRows = targetSnapshot.productionDistribution || [];
    const producedM3 = prodRows.reduce(
      (s, r) => s + (useYtd ? r.producedM3Ytd || 0 : r.producedM3Monthly || 0),
      0
    );
    const distributedM3 = prodRows.reduce(
      (s, r) => s + (useYtd ? r.distributedM3Ytd || 0 : r.distributedM3Monthly || 0),
      0
    );
    const soldM3 = prodRows.reduce(
      (s, r) => s + (useYtd ? r.soldM3Ytd || 0 : r.soldM3Monthly || 0),
      0
    );
    const nrwBase = distributedM3 > 0 ? distributedM3 : producedM3;
    if (nrwBase > 0) {
      nrwPct = round2(((nrwBase - soldM3) / nrwBase) * 100);
    } else if (prodRows.length > 0) {
      nrwPct = round2(
        prodRows.reduce((s, r) => s + (useYtd ? r.nrwPctYtd || 0 : r.nrwPctMonthly || 0), 0) /
          prodRows.length
      );
    }

    const installedLps = prodRows.reduce((s, r) => s + (r.installedCapacityLps || 0), 0);
    const realLps = prodRows.reduce((s, r) => s + (r.realCapacityLps || 0), 0);
    if (installedLps > 0 && realLps > 0) {
      productionEfficiencyPct = round2((realLps / installedLps) * 100);
    } else if (installedLps > 0 && producedM3 > 0) {
      const monthsMult = useYtd ? Math.max(1, month) : 1;
      const capM3 = installedLps * 3.6 * 24 * 30 * monthsMult;
      productionEfficiencyPct = round2((producedM3 / capM3) * 100);
    }

    const connRows = targetSnapshot.customerConnections || [];
    const beginActive = connRows.reduce((s, c) => s + (c.beginningActive || 0), 0);
    activeConnections = connRows.reduce((s, c) => s + (c.endingActive || 0), 0);
    if (beginActive > 0 && activeConnections > 0) {
      customerGrowthPct = round2(((activeConnections - beginActive) / beginActive) * 100);
    }

    const domDrd = (targetSnapshot.drdSummary || []).filter(
      (d) =>
        d.tariffName.toLowerCase().includes('rumah tangga') ||
        d.tariffName.toLowerCase().includes('sosial') ||
        d.tariffGroup?.toLowerCase().includes('rt')
    );
    const drdList = domDrd.length > 0 ? domDrd : targetSnapshot.drdSummary || [];
    const domCustomers = drdList.reduce((s, d) => s + (d.customerCount || 0), 0);
    const domM3Monthly = drdList.reduce((s, d) => s + (d.cubicMetersMonthly || 0), 0);
    if (domCustomers > 0 && domM3Monthly > 0) {
      avgDomesticConsumptionM3 = round2(domM3Monthly / domCustomers);
    }

    const hrRows = targetSnapshot.employeeComposition || [];
    const totalEmployees = hrRows.reduce((s, h) => s + (h.totalCount || 0), 0);
    if (totalEmployees > 0 && activeConnections > 0) {
      employeePer1000Ratio = round2(totalEmployees / (activeConnections / 1000));
    }
  }

  // Fallback collection ratio from water billing receipts vs AR if PDAM snapshot missing
  if (collectionEfficiencyPct === 0) {
    const waterReceipts = txYtd
      .filter(
        (t) =>
          t.type === 'PENERIMAAN' &&
          t.status === 'Disetujui / Diposting' &&
          (t.subCategory.toLowerCase().includes('rekening air') ||
            t.description.toLowerCase().includes('rekening air'))
      )
      .reduce((s, t) => s + (t.amount || 0), 0);
    const waterArTotal = scopedRp
      .filter((r) => r.kind === 'PIUTANG' && r.category.toLowerCase().includes('air'))
      .reduce((s, r) => s + (r.originalAmount || 0), 0);
    if (waterReceipts > 0 && waterArTotal > 0) {
      collectionEfficiencyPct = round2(Math.min(100, (waterReceipts / (waterReceipts + waterArTotal)) * 100));
    }
  }

  // 2. Risk, RCSA, KPI, SPI Supervision Metrics
  const yearRisks = riskRegisters.filter((r) => r.year === year);
  const totalRisks = yearRisks.length;
  const avgInh =
    totalRisks > 0 ? yearRisks.reduce((s, r) => s + (r.inherentScore || 0), 0) / totalRisks : 0;
  const avgRes =
    totalRisks > 0 ? yearRisks.reduce((s, r) => s + (r.residualScore || 0), 0) / totalRisks : 0;
  const riskReductionPct = avgInh > 0 ? round2(((avgInh - avgRes) / avgInh) * 100) : 0;
  const effectiveControlCount = yearRisks.filter((r) => r.controlEffectiveness === 'Efektif').length;
  const effectiveControlPct =
    totalRisks > 0 ? round2((effectiveControlCount / totalRisks) * 100) : 0;
  const rcsaReviewedCount = rcsaList.filter(
    (rc) => rc.year === year && (rc.status === 'Direviu SPI' || rc.status === 'Disetujui')
  ).length;

  const yearKpis = kpiItems.filter((k) => k.year === year);
  const scopedKpiMeasures = kpiMeasurements.filter((m) => {
    if (m.year !== year) return false;
    if (periodType === 'BULANAN') {
      return (m.periodType === 'Bulanan' && m.periodIndex <= month) || m.periodType === 'Tahunan';
    }
    return true;
  });
  const kpiAvgAchievementPct =
    scopedKpiMeasures.length > 0
      ? round2(
          scopedKpiMeasures.reduce((s, m) => s + (m.cappedAchievementPct || 0), 0) /
            scopedKpiMeasures.length
        )
      : 0;
  const kpiVerifiedCount = scopedKpiMeasures.filter(
    (m) => m.spiVerificationStatus === 'Terverifikasi SPI'
  ).length;

  const yearPkpt = pkptList.filter((p) => p.year === year);
  const pkptCompleted = yearPkpt.filter((p) => p.status === 'Selesai').length;
  const pkptRealizationPct =
    yearPkpt.length > 0 ? round2((pkptCompleted / yearPkpt.length) * 100) : 0;

  const scopedAuditReports = auditReports.filter((ar) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemDate: ar.reportDate || ar.createdAt?.slice(0, 10),
      cumulativeUpToMonth: true,
    })
  );
  const completedAuditReports = scopedAuditReports.filter(
    (ar) =>
      ar.status === 'Final / Diterbitkan ke Direktur' ||
      ar.status === 'Persetujuan Kepala SPI' ||
      (ar.status as string) === 'Final'
  ).length;

  const scopedFindings = findings.filter((f) =>
    isInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: f.year,
      itemDate: f.createdAt?.slice(0, 10),
      cumulativeUpToMonth: true,
    })
  );
  const findingsOpenCount = scopedFindings.filter((f) => f.status !== 'Selesai').length;
  const findingsPotentialLoss = scopedFindings.reduce((s, f) => s + (f.potentialLoss || 0), 0);

  const findingIds = new Set(scopedFindings.map((f) => f.id));
  const scopedRecs = recommendations.filter((r) => findingIds.has(r.findingId));
  const completedRecs = scopedRecs.filter((r) => r.status === 'Selesai').length;
  const tlrCompletionPct =
    scopedRecs.length > 0 ? round2((completedRecs / scopedRecs.length) * 100) : 100;

  const scopedWbs = wbsReports.filter(
    (w) => w.year === year && (periodType === 'TAHUNAN' || w.month <= month)
  );
  const activeRegulationsCount = regulations.filter((r) => r.status === 'Berlaku').length;
  const bankReconciliationMatchedCount = scopedRecons.filter((r) => r.status === 'Sesuai').length;
  const periodClosedCount = periodCloses.filter(
    (p) =>
      p.isClosed &&
      p.year === year &&
      (periodType === 'TAHUNAN' ||
        p.month === 'TAHUNAN' ||
        p.month.toLowerCase() === targetMonthName.toLowerCase())
  ).length;
  const duplicateAuditTrailCount = scopedAuditTrails.filter((a) => a.duplicateFlag).length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueTaxCount = scopedTaxes.filter(
    (t) => t.status === 'Terutang' && t.dueDate && t.dueDate < todayIso
  ).length;

  const matchingFinAudit =
    financialAudits.find(
      (fa) =>
        fa.year === year &&
        fa.periodType === periodType &&
        (periodType === 'TAHUNAN' || fa.month === month)
    ) || financialAudits.find((fa) => fa.year === year);

  // Training / Diklat vs Employee Cost from COA/Ledgers if available
  const diklatLedgerSum = statements.ledgers
    .filter((l) => l.account.name.toLowerCase().includes('diklat') || l.account.name.toLowerCase().includes('pelatihan'))
    .reduce((s, l) => s + (periodType === 'BULANAN' ? l.monthlyActual || l.netSignedBalance : l.netSignedBalance), 0);
  const pegawaiLedgerSum = statements.ledgers
    .filter((l) => l.account.name.toLowerCase().includes('pegawai') || l.account.name.toLowerCase().includes('gaji'))
    .reduce((s, l) => s + (periodType === 'BULANAN' ? l.monthlyActual || l.netSignedBalance : l.netSignedBalance), 0);
  const computedDiklatPct =
    diklatLedgerSum > 0 && pegawaiLedgerSum > 0 ? round2((diklatLedgerSum / pegawaiLedgerSum) * 100) : 0;

  // 3. Build 18 Indicators with Live Cross-Module Values
  const baseIndicators =
    existingIndicators && existingIndicators.length > 0
      ? existingIndicators
      : INITIAL_BPKP_KINERJA_INDICATORS;

  const mergedIndicators: BPKPIndicatorAssessment[] = baseIndicators.map((ind) => {
    let dataSource: BPKPDataSourceMode = 'MANUAL';
    let sourceModule = 'Input Manual / Baseline SPIP';
    let autoValue: number | undefined;
    let evidenceRef = ind.evidenceRef;
    let notes = ind.notes;

    const hasAccountingData =
      totalAssets > 0 || finalRevenue > 0 || finalExpense > 0 || totalCashAndBank > 0;

    if (ind.code === 'K.1' && hasAccountingData && totalEquity > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Akuntansi Neraca & Laba Rugi';
      autoValue = roePct;
      evidenceRef = `Neraca & Laba Rugi ${periodLabel} · ${finalNetIncome < 0 ? 'Rugi Bersih' : 'Laba Bersih'} ${formatRp(finalNetIncome)} / Ekuitas ${formatRp(totalEquity)}`;
      notes = `Otomatis dari Laporan Akuntansi: ROE ${roePct.toFixed(2)}%`;
    } else if (ind.code === 'K.2' && finalOpRevenue > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Akuntansi Laba Rugi & Biaya Operasi';
      autoValue = operatingRatioDecimal;
      evidenceRef = `Laba Rugi ${periodLabel} · Biaya Ops ${formatRp(finalOpExpense)} / Pendapatan Ops ${formatRp(finalOpRevenue)}`;
      notes = `Otomatis: Rasio Operasi ${operatingRatioDecimal.toFixed(2)} (FCR ${fcrPct.toFixed(1)}%)`;
    } else if (ind.code === 'K.3' && (totalCashAndBank > 0 || effectiveCurLiab > 0)) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Kas/Bank & Kewajiban Lancar';
      autoValue = cashRatioPct;
      evidenceRef = `Kas & Bank ${formatRp(totalCashAndBank)} vs Kewajiban Lancar ${formatRp(effectiveCurLiab)}`;
      notes = `Otomatis: Cash Ratio ${cashRatioPct.toFixed(1)}% · Current Ratio ${currentRatioPct.toFixed(1)}%`;
    } else if (ind.code === 'K.4' && collectionEfficiencyPct > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = targetSnapshot ? 'Laporan PDAM Permendagri 118' : 'Transaksi & Piutang Air';
      autoValue = collectionEfficiencyPct;
      evidenceRef = targetSnapshot
        ? `Snapshot PDAM ${targetSnapshot.month} ${targetSnapshot.year} · Efektivitas Penagihan`
        : `Realisasi Penerimaan Rekening Air vs Piutang`;
      notes = `Otomatis: Efektivitas Penagihan ${collectionEfficiencyPct.toFixed(2)}%`;
    } else if (ind.code === 'K.5' && totalAssets > 0 && totalLiabilities > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Akuntansi Neraca Audited/Berjalan';
      autoValue = solvabilitasPct;
      evidenceRef = `Total Aset ${formatRp(totalAssets)} vs Total Liabilitas ${formatRp(totalLiabilities)}`;
      notes = `Otomatis: Rasio Solvabilitas ${solvabilitasPct.toFixed(1)}%`;
    } else if (ind.code === 'P.2' && customerGrowthPct !== 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Laporan PDAM Permendagri 118';
      autoValue = customerGrowthPct;
      evidenceRef = `Mutasi Sambungan Langganan (${activeConnections.toLocaleString('id-ID')} SL aktif)`;
      notes = `Otomatis dari Laporan PDAM: Pertumbuhan ${customerGrowthPct.toFixed(2)}%`;
    } else if (ind.code === 'P.5' && avgDomesticConsumptionM3 > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Laporan PDAM Permendagri 118 (DRD)';
      autoValue = avgDomesticConsumptionM3;
      evidenceRef = `Rekapitulasi DRD Golongan Tarif ${targetSnapshot?.month || targetMonthName}`;
      notes = `Otomatis dari DRD PDAM: Rata-rata ${avgDomesticConsumptionM3.toFixed(2)} m³/bln`;
    } else if (ind.code === 'O.1' && productionEfficiencyPct > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Laporan Produksi & Distribusi PDAM';
      autoValue = productionEfficiencyPct;
      evidenceRef = `Laporan Produksi IPA ${targetSnapshot?.month || targetMonthName}`;
      notes = `Otomatis dari Produksi PDAM: Efisiensi ${productionEfficiencyPct.toFixed(2)}%`;
    } else if (ind.code === 'O.2' && nrwPct > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Laporan Produksi & NRW PDAM';
      autoValue = nrwPct;
      evidenceRef = `Water Balance PDAM ${targetSnapshot?.month || targetMonthName} (NRW ${nrwPct.toFixed(2)}%)`;
      notes = `Otomatis dari Neraca Air PDAM: Tingkat Kehilangan Air ${nrwPct.toFixed(2)}%`;
    } else if (ind.code === 'S.1' && employeePer1000Ratio > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Laporan Kepegawaian & Pelanggan PDAM';
      autoValue = employeePer1000Ratio;
      evidenceRef = `Daftar Pegawai vs ${activeConnections.toLocaleString('id-ID')} SL Aktif`;
      notes = `Otomatis: ${employeePer1000Ratio.toFixed(2)} pegawai per 1.000 pelanggan`;
    } else if (ind.code === 'S.3' && computedDiklatPct > 0) {
      dataSource = 'OTOMATIS';
      sourceModule = 'Buku Besar Beban Diklat & Pegawai';
      autoValue = computedDiklatPct;
      evidenceRef = `Beban Diklat ${formatRp(diklatLedgerSum)} / Beban Pegawai ${formatRp(pegawaiLedgerSum)}`;
      notes = `Otomatis dari COA Beban Diklat: ${computedDiklatPct.toFixed(2)}%`;
    } else {
      // Try matching KPI & Cascading
      const kwMap: Record<string, string[]> = {
        'P.1': ['cakupan', 'penduduk terlayani', 'coverage'],
        'P.2': ['pertumbuhan pelanggan', 'sambungan baru'],
        'P.3': ['pengaduan', 'komplain', 'respon'],
        'P.4': ['kualitas air', 'laboratorium', 'permenkes'],
        'P.5': ['konsumsi air', 'pemakaian air'],
        'O.1': ['efisiensi produksi', 'kapasitas produksi'],
        'O.2': ['nrw', 'kehilangan air', 'kebocoran'],
        'O.3': ['jam operasi', 'kontinuitas', 'jam alir'],
        'O.4': ['tekanan air', 'bar'],
        'O.5': ['water meter', 'tera ulang', 'penggantian meter'],
        'S.1': ['rasio pegawai', '1.000 pelanggan'],
        'S.2': ['diklat', 'pelatihan', 'jam pelatihan'],
        'S.3': ['biaya diklat'],
      };
      const kpiMatch = findMatchingKpiRealization(
        kwMap[ind.code] || [],
        kpiItems,
        kpiMeasurements,
        year,
        periodType,
        month
      );
      if (kpiMatch) {
        dataSource = 'SEMI_OTOMATIS';
        sourceModule = `KPI & Cascading (${kpiMatch.kpiName})`;
        autoValue = kpiMatch.value;
        evidenceRef = `Pengukuran KPI ${kpiMatch.kpiName}${kpiMatch.verified ? ' · Terverifikasi SPI' : ''}`;
        notes = `Tersinkronisasi dari Modul KPI: ${kpiMatch.value} ${ind.unitMeasurement}`;
      }
    }

    const effectiveActual = autoValue !== undefined ? autoValue : ind.actualValue;
    const computedScore =
      autoValue !== undefined ? scoreIndicatorByCode(ind.code, effectiveActual) : ind.score;

    const indicatorResult: BPKPIndicatorAssessment = {
      ...ind,
      actualValue: effectiveActual,
      score: computedScore,
      weightedScore: round3(computedScore * ind.weight),
      evidenceRef,
      notes,
      dataSource,
      sourceModule,
    };
    if (autoValue !== undefined) {
      indicatorResult.autoComputedValue = autoValue;
      indicatorResult.autoComputedScore = computedScore;
      indicatorResult.lastSyncedAt = nowIso;
    } else {
      delete indicatorResult.autoComputedValue;
      delete indicatorResult.autoComputedScore;
      if (ind.lastSyncedAt) {
        indicatorResult.lastSyncedAt = ind.lastSyncedAt;
      } else {
        delete indicatorResult.lastSyncedAt;
      }
    }
    return indicatorResult;
  });

  let sumKeuangan = 0;
  let sumPelayanan = 0;
  let sumOperasional = 0;
  let sumSdm = 0;
  mergedIndicators.forEach((ind) => {
    const ws = ind.score * ind.weight;
    if (ind.aspect === 'KEUANGAN') sumKeuangan += ws;
    if (ind.aspect === 'PELAYANAN') sumPelayanan += ws;
    if (ind.aspect === 'OPERASIONAL') sumOperasional += ws;
    if (ind.aspect === 'SDM') sumSdm += ws;
  });

  const kinerjaScore = round2(sumKeuangan + sumPelayanan + sumOperasional + sumSdm);
  const kinerjaCategory = classifyKinerjaCategory(kinerjaScore);

  // 4. Build 21 SPIP Elements with Automated Cross-Module Evidence & Dynamic Maturity Rating
  const baseSpip =
    existingSpipElements && existingSpipElements.length > 0
      ? existingSpipElements
      : INITIAL_SPIP_ELEMENTS;

  const mergedSpip: SPIPElementAssessment[] = baseSpip.map((el) => {
    let dataSource: BPKPDataSourceMode = 'MANUAL';
    let sourceModule = 'Input Manual / Asesmen SPIP';
    let autoRating: number | undefined;
    let autoEvidence = '';
    let improvementPlan = el.improvementPlan;

    switch (el.subElementCode) {
      case '1.6': // SDM & KPI
        if (yearKpis.length > 0) {
          dataSource = 'OTOMATIS';
          sourceModule = 'KPI & Cascading 5 Tingkat';
          autoEvidence = `${yearKpis.length} KPI aktif, rata-rata capaian ${kpiAvgAchievementPct.toFixed(1)}% (${kpiVerifiedCount} terverifikasi SPI).`;
          autoRating = kpiAvgAchievementPct >= 90 && kpiVerifiedCount > 0 ? 5 : kpiAvgAchievementPct >= 75 ? 4 : 3;
        }
        break;
      case '1.7': // Peran SPI Efektif
        if (yearPkpt.length > 0 || scopedAuditReports.length > 0 || matchingFinAudit) {
          dataSource = 'OTOMATIS';
          sourceModule = 'PKPT, LHA & Audit Kinerja Keuangan';
          autoEvidence = `Realisasi PKPT ${pkptRealizationPct.toFixed(1)}% (${pkptCompleted}/${yearPkpt.length}), ${completedAuditReports} LHA final, Audit Kinerja Keuangan ${matchingFinAudit ? `${matchingFinAudit.totalScore.toFixed(1)} (${matchingFinAudit.predicate})` : 'terjadwal'}.`;
          autoRating = pkptRealizationPct >= 80 && completedAuditReports > 0 ? 5 : yearPkpt.length > 0 ? 4 : 3;
        }
        break;
      case '2.1': // Tujuan & RKAP
        if (scopedRkaParents.length > 0) {
          dataSource = 'OTOMATIS';
          sourceModule = 'RKA / RKAP Berjenjang';
          autoEvidence = `${scopedRkaParents.length} pos induk RKA · Pagu ${formatRp(rkaTotalBudget)} · Realisasi ${formatRp(rkaTotalRealization)} (${rkaAbsorptionPct.toFixed(1)}%).`;
          autoRating = rkaAbsorptionPct >= 65 && rkaAbsorptionPct <= 100 ? 5 : 4;
        }
        break;
      case '2.2': // Identifikasi Risiko Terpadu
      case '2.3': // Analisis & Mitigasi Risiko
        if (totalRisks > 0) {
          dataSource = 'OTOMATIS';
          sourceModule = 'Register Risiko 5x5 & RCSA';
          autoEvidence = `${totalRisks} risiko teridentifikasi · Reduksi inheren→residual ${riskReductionPct.toFixed(1)}% · Kontrol efektif ${effectiveControlPct.toFixed(1)}% · ${rcsaReviewedCount} RCSA direviu SPI.`;
          autoRating = effectiveControlPct >= 75 && riskReductionPct >= 20 ? 5 : effectiveControlPct >= 50 ? 4 : 3;
        }
        break;
      case '3.1': // Reviu Kinerja Entitas
        if (finalRevenue > 0 || scopedRkaParents.length > 0) {
          dataSource = 'OTOMATIS';
          sourceModule = 'Laporan Keuangan & Realisasi RKA';
          autoEvidence = `Reviu ${periodLabel}: Pendapatan ${formatRp(finalRevenue)}, Beban ${formatRp(finalExpense)}, Laba/Rugi ${formatRp(finalNetIncome)}, Serapan RKA ${rkaAbsorptionPct.toFixed(1)}%.`;
          autoRating = fcrPct >= 100 && rkaAbsorptionPct <= 100 ? 5 : 4;
        }
        break;
      case '3.3': // Pengendalian Fisik Aset & Persediaan
        if (assets.length > 0 || scopedInventory.length > 0) {
          dataSource = 'OTOMATIS';
          sourceModule = 'Registrasi Aset & Persediaan Gudang';
          const deadStockCount = scopedInventory.filter(
            (i) => i.coaCode === '15.03.91' || i.category === 'Bahan Instalasi Tidak Bergerak'
          ).length;
          autoEvidence = `${assets.length} aset tetap tercatat · ${scopedInventory.length} item persediaan aktif (${deadStockCount} dead stock 15.03.91).`;
          autoRating = deadStockCount === 0 && assets.length > 0 ? 4 : 3;
        }
        break;
      case '3.5': // Dokumentasi SPIP & Regulasi
        if (activeRegulationsCount > 0) {
          dataSource = 'OTOMATIS';
          sourceModule = 'Review Produk Hukum & SOP';
          autoEvidence = `${activeRegulationsCount} regulasi/Perdir/SOP berstatus Berlaku aktif terdokumentasi.`;
          autoRating = activeRegulationsCount >= 5 ? 4 : 3;
        }
        break;
      case '4.1': // Informasi Relevan & Tepat Waktu
        if (targetSnapshot || periodClosedCount > 0 || finalRevenue > 0) {
          dataSource = 'OTOMATIS';
          sourceModule = 'Laporan PDAM & Tutup Buku Akuntansi';
          autoEvidence = `Pelaporan ${periodLabel}: ${targetSnapshot ? `Laporan PDAM ${targetSnapshot.month} tersedia` : 'Pembukuan aktif'}, ${periodClosedCount} periode terkunci tutup buku.`;
          autoRating = periodClosedCount > 0 && targetSnapshot ? 5 : 4;
        }
        break;
      case '4.3': // Whistleblowing System (WBS)
        dataSource = 'OTOMATIS';
        sourceModule = 'Whistleblowing System (WBS)';
        autoEvidence = `Kanal WBS aktif (${scopedWbs.length} laporan masuk pada ${periodLabel}).`;
        autoRating = 4;
        break;
      case '5.1': // Ongoing Monitoring
        dataSource = 'OTOMATIS';
        sourceModule = 'Rekonsiliasi Bank & Audit Trail Keuangan';
        autoEvidence = `${bankReconciliationMatchedCount} rekonsiliasi bank Sesuai · ${duplicateAuditTrailCount} indikasi transaksi ganda pada Audit Trail · ${overdueTaxCount} pajak lewat jatuh tempo.`;
        autoRating =
          duplicateAuditTrailCount === 0 && overdueTaxCount === 0 && bankReconciliationMatchedCount > 0
            ? 5
            : duplicateAuditTrailCount > 0 || overdueTaxCount > 0
            ? 3
            : 4;
        if (duplicateAuditTrailCount > 0 || overdueTaxCount > 0) {
          improvementPlan = `Segera klarifikasi ${duplicateAuditTrailCount} indikasi transaksi ganda dan lunasi ${overdueTaxCount} pajak jatuh tempo.`;
        }
        break;
      case '5.2': // Evaluasi Terpisah SPI
        if (assignments.length > 0 || matchingFinAudit) {
          dataSource = 'OTOMATIS';
          sourceModule = 'SPT, LHA & Audit Kinerja Keuangan';
          autoEvidence = `${assignments.length} SPT penugasan audit · ${completedAuditReports} LHA final · Audit Kinerja Keuangan ${matchingFinAudit ? `${matchingFinAudit.totalScore.toFixed(1)}/100` : 'belum final'}.`;
          autoRating = completedAuditReports > 0 || Boolean(matchingFinAudit) ? 4 : 3;
        }
        break;
      case '5.3': // Penyelesaian TLR
        dataSource = 'OTOMATIS';
        sourceModule = 'Temuan 5C & Tindak Lanjut Rekomendasi';
        autoEvidence = `${scopedFindings.length} temuan 5C (${findingsOpenCount} terbuka, potensi kerugian ${formatRp(findingsPotentialLoss)}) · Penyelesaian Rekomendasi ${tlrCompletionPct.toFixed(1)}% (${completedRecs}/${scopedRecs.length}).`;
        autoRating =
          scopedRecs.length === 0 ? 4 : tlrCompletionPct >= 85 ? 5 : tlrCompletionPct >= 65 ? 4 : 3;
        if (tlrCompletionPct < 85 && scopedRecs.length > 0) {
          improvementPlan = `Percepat penyelesaian ${scopedRecs.length - completedRecs} rekomendasi terbuka untuk mencapai target nasional >= 85%.`;
        }
        break;
      default:
        break;
    }

    const effectiveRating = autoRating ?? el.selfRating;
    const spipResult: SPIPElementAssessment = {
      ...el,
      selfRating: effectiveRating,
      evidenceRef: autoEvidence ? `${autoEvidence}` : el.evidenceRef,
      improvementPlan,
      dataSource,
      sourceModule,
    };
    if (autoRating !== undefined) {
      spipResult.autoComputedRating = autoRating;
    } else {
      delete spipResult.autoComputedRating;
    }
    if (autoEvidence) {
      spipResult.autoEvidenceSummary = autoEvidence;
      spipResult.lastSyncedAt = nowIso;
    } else {
      delete spipResult.autoEvidenceSummary;
      if (el.lastSyncedAt) {
        spipResult.lastSyncedAt = el.lastSyncedAt;
      } else {
        delete spipResult.lastSyncedAt;
      }
    }
    return spipResult;
  });

  const spipAvg = round2(
    mergedSpip.reduce((s, el) => s + (Number(el.selfRating) || 1), 0) / (mergedSpip.length || 1)
  );
  const spipMaturityLevel = classifySpipLevel(spipAvg);

  const syncedModules: string[] = [];
  if (totalAssets > 0 || finalRevenue > 0 || totalCashAndBank > 0) syncedModules.push('Laporan Keuangan & Akuntansi');
  if (targetSnapshot) syncedModules.push('Laporan Keuangan PDAM Permendagri 118');
  if (scopedRkaParents.length > 0) syncedModules.push('RKA / RKAP Berjenjang');
  if (yearRisks.length > 0 || rcsaReviewedCount > 0) syncedModules.push('Manajemen Risiko & RCSA');
  if (yearKpis.length > 0) syncedModules.push('KPI & Cascading Kinerja');
  if (yearPkpt.length > 0 || scopedFindings.length > 0 || matchingFinAudit) syncedModules.push('Audit SPI, 5C & TLR');

  const summary: BPKPCrossModuleSyncSummary = {
    syncedAt: nowIso,
    periodType,
    year,
    ...(periodType === 'BULANAN' ? { month } : {}),
    periodLabel,
    totalRevenue: finalRevenue,
    totalOperatingRevenue: finalOpRevenue,
    totalExpense: finalExpense,
    totalOperatingExpense: finalOpExpense,
    netIncome: finalNetIncome,
    totalAssets,
    totalCurrentAssets,
    totalCurrentLiabilities: effectiveCurLiab,
    totalLiabilities,
    totalEquity,
    totalCashAndBank,
    fcrPct,
    roePct,
    operatingRatio: operatingRatioDecimal,
    cashRatioPct,
    currentRatioPct,
    solvabilitasPct,
    collectionEfficiencyPct,
    nrwPct,
    productionEfficiencyPct,
    activeConnections,
    customerGrowthPct,
    avgDomesticConsumptionM3,
    employeePer1000Ratio,
    rkaTotalBudget,
    rkaTotalRealization,
    rkaAbsorptionPct,
    totalRisks,
    riskReductionPct,
    effectiveControlPct,
    rcsaReviewedCount,
    kpiAvgAchievementPct,
    kpiVerifiedCount,
    pkptRealizationPct,
    completedAuditReports,
    findingsOpenCount,
    findingsPotentialLoss,
    tlrCompletionPct,
    wbsTotalCount: scopedWbs.length,
    activeRegulationsCount,
    bankReconciliationMatchedCount,
    periodClosedCount,
    duplicateAuditTrailCount,
    overdueTaxCount,
    ...(matchingFinAudit
      ? {
          financialAuditScore: matchingFinAudit.totalScore,
          financialAuditPredicate: matchingFinAudit.predicate,
        }
      : {}),
  };

  // Early Warnings cross-line
  const earlyWarnings: BPKPEarlyWarningItem[] = [];
  if (finalOpRevenue > 0 && fcrPct < 100) {
    earlyWarnings.push({
      id: 'sa-warn-fcr',
      severity: 'KRITIS',
      module: 'Laporan Keuangan',
      title: 'Financial Cost Recovery (FCR) di Bawah 100%',
      detail: `Pendapatan operasi (${formatRp(finalOpRevenue)}) belum menutup beban operasi (${formatRp(finalOpExpense)}).`,
      metric: `${fcrPct.toFixed(1)}%`,
    });
  }
  if (nrwPct > 25) {
    earlyWarnings.push({
      id: 'sa-warn-nrw',
      severity: nrwPct > 30 ? 'KRITIS' : 'PERINGATAN',
      module: 'Laporan PDAM',
      title: 'Tingkat Kehilangan Air (NRW) Melampaui 25%',
      detail: `NRW tercatat ${nrwPct.toFixed(2)}% (ambang Permendagri <= 25%), menekan skor Aspek Operasional O.2.`,
      metric: `${nrwPct.toFixed(1)}%`,
    });
  }
  if (collectionEfficiencyPct > 0 && collectionEfficiencyPct < 85) {
    earlyWarnings.push({
      id: 'sa-warn-coll',
      severity: 'PERINGATAN',
      module: 'Laporan PDAM',
      title: 'Efisiensi Penagihan Rekening Air Di Bawah Target 85%',
      detail: 'Tingkatkan penagihan tunggakan pelanggan dan rekonsiliasi DRD per unit pelayanan.',
      metric: `${collectionEfficiencyPct.toFixed(1)}%`,
    });
  }
  if (overdueTaxCount > 0 || duplicateAuditTrailCount > 0) {
    earlyWarnings.push({
      id: 'sa-warn-ctrl',
      severity: 'KRITIS',
      module: 'Pengendalian Internal & Pajak',
      title: 'Anomali Kepatuhan Pajak / Indikasi Transaksi Ganda',
      detail: `Ditemukan ${overdueTaxCount} pajak lewat jatuh tempo dan ${duplicateAuditTrailCount} indikasi transaksi ganda.`,
      metric: `${overdueTaxCount + duplicateAuditTrailCount} atensi`,
    });
  }
  if (findingsOpenCount > 0 && tlrCompletionPct < 80) {
    earlyWarnings.push({
      id: 'sa-warn-tlr',
      severity: 'PERINGATAN',
      module: 'Temuan 5C & TLR',
      title: 'Penyelesaian Rekomendasi Audit (TLR) Di Bawah 80%',
      detail: `Masih terdapat ${findingsOpenCount} temuan terbuka dengan estimasi dampak ${formatRp(findingsPotentialLoss)}.`,
      metric: `${tlrCompletionPct.toFixed(1)}%`,
    });
  }

  // Automated Narrative
  const executiveSummary =
    `Self Assessment Kinerja BUMD Air Minum dan Maturitas Penyelenggaraan SPIP Perumda Air Minum Tirta Saiyo Kabupaten Pasaman periode ${periodLabel} yang tersinkronisasi otomatis lintas modul menghasilkan Skor Kinerja Total sebesar ${kinerjaScore.toFixed(2)} / 5.00 dengan predikat "${kinerjaCategory}" (ambang sehat > 2.80), serta Indeks Maturitas SPIP sebesar ${spipAvg.toFixed(2)} / 5.00 (${spipMaturityLevel}).\n\n` +
    `Pada lini keuangan, realisasi pendapatan tercatat ${formatRp(finalRevenue)}, beban ${formatRp(finalExpense)}, saldo kas & bank ${formatRp(totalCashAndBank)}, Rasio Operasi ${operatingRatioDecimal.toFixed(2)}, Financial Cost Recovery (FCR) ${fcrPct.toFixed(1)}%, serta penyerapan anggaran RKA sebesar ${rkaAbsorptionPct.toFixed(1)}% (${formatRp(rkaTotalRealization)} dari pagu ${formatRp(rkaTotalBudget)}).`;

  const strengthsAndAchievements =
    `1. Likuiditas & Solvabilitas: Saldo kas/bank ${formatRp(totalCashAndBank)} dengan Cash Ratio ${cashRatioPct.toFixed(1)}% dan Solvabilitas ${solvabilitasPct.toFixed(1)}%.\n` +
    `2. Penyerapan RKA & KPI: Serapan anggaran berjenjang mencapai ${rkaAbsorptionPct.toFixed(1)}% dan rata-rata capaian KPI lintas perspektif sebesar ${kpiAvgAchievementPct.toFixed(1)}%.\n` +
    `3. Pengendalian Risiko & SPI: Reduksi risiko inheren ke residual ${riskReductionPct.toFixed(1)}% (${effectiveControlPct.toFixed(1)}% kontrol efektif), realisasi PKPT ${pkptRealizationPct.toFixed(1)}%, dan penyelesaian TLR ${tlrCompletionPct.toFixed(1)}%.`;

  const weakIndicators = mergedIndicators
    .filter((i) => i.score <= 3)
    .map((i) => `- ${i.code} ${i.name}: realisasi ${i.actualValue} ${i.unitMeasurement} (Skor ${i.score})`)
    .join('\n');

  const gapAnalysisAndWeaknesses =
    (weakIndicators
      ? `Indikator kinerja dengan skor <= 3 yang menjadi perhatian prioritas pada ${periodLabel}:\n${weakIndicators}\n\n`
      : `Seluruh 18 indikator kinerja berada pada skor baik (>= 4) pada ${periodLabel}.\n\n`) +
    `Status Pengendalian Internal: ${findingsOpenCount} temuan 5C terbuka (${formatRp(findingsPotentialLoss)}), ${overdueTaxCount} pajak jatuh tempo, dan ${duplicateAuditTrailCount} indikasi transaksi ganda pada Audit Trail.`;

  const strategicRecommendations =
    `1. Penguatan Kinerja Keuangan & Penagihan: Pertahankan Operating Ratio <= 0.85 dan dorong FCR > 100% melalui efisiensi biaya produksi/energi serta penagihan piutang air (Collection Ratio >= 90%).\n` +
    `2. Pengendalian Kehilangan Air (NRW): Percepat penanganan kebocoran jaringan DMA dan penggantian water meter tua untuk menjaga NRW <= 25%.\n` +
    `3. Tata Kelola RKA & Tutup Buku: Pastikan seluruh transaksi pengeluaran berelasi dengan pos RKA, lakukan rekonsiliasi bank rutin, dan kunci tutup buku periode tepat waktu.\n` +
    `4. Peningkatan Maturitas SPIP: Perkuat pemantauan tindak lanjut rekomendasi audit (target TLR >= 85%) dan evaluasi pengendalian intern berbasis risiko.`;

  return {
    summary,
    indicators: mergedIndicators,
    spipElements: mergedSpip,
    kinerjaScore,
    kinerjaCategory,
    aspectScores: {
      keuangan: round3(sumKeuangan),
      pelayanan: round3(sumPelayanan),
      operasional: round3(sumOperasional),
      sdm: round3(sumSdm),
    },
    spipMaturityScore: spipAvg,
    spipMaturityLevel,
    syncedModules,
    earlyWarnings,
    narrative: {
      executiveSummary,
      strengthsAndAchievements,
      gapAnalysisAndWeaknesses,
      strategicRecommendations,
    },
  };
}

export function build12MonthBpkpTrend(
  baseInput: Omit<BPKPAutomationInput, 'periodType' | 'month'>,
  savedAssessments: BPKPSelfAssessment[]
): BPKPMonthlyTrendRow[] {
  const { year } = baseInput;
  return FISCAL_MONTHS.map((mName, idx) => {
    const mNum = idx + 1;
    const saved = savedAssessments.find(
      (a) => a.year === year && a.periodType === 'BULANAN' && a.month === mNum
    );
    const res = runBpkpCrossModuleAutomation({
      ...baseInput,
      periodType: 'BULANAN',
      month: mNum,
      existingIndicators: saved?.indicators,
      existingSpipElements: saved?.spipElements,
    });
    return {
      monthIndex: mNum,
      monthName: mName,
      revenue: res.summary.totalRevenue,
      expense: res.summary.totalExpense,
      operatingRatio: res.summary.operatingRatio,
      cashRatioPct: res.summary.cashRatioPct,
      cashBalance: res.summary.totalCashAndBank,
      rkaAbsorptionPct: res.summary.rkaAbsorptionPct,
      collectionPct: res.summary.collectionEfficiencyPct,
      nrwPct: res.summary.nrwPct,
      estimatedScore: res.kinerjaScore,
      hasSavedReport: Boolean(saved),
      savedAssessmentId: saved?.id,
      savedScore: saved?.kinerjaScore,
      savedStatus: saved?.status,
    };
  });
}
