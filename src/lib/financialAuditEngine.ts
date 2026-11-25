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
import {
  AuditIndicatorVerdict,
  FinancialAuditCrossLineSnapshot,
  FinancialAuditIndicatorItem,
  FinancialAuditPeriodType,
  FinancialAuditPredicate,
} from '../types/financialAudit';
import { FISCAL_MONTHS } from './featureCatalog';
import {
  computeAccountingStatements,
  computeCashBankBalances,
  computeFinancialAnalysisAndWarnings,
  computeRkaAbsorptionForTarget,
  formatRp,
  getMonthNameFromDate,
  getTodayIso,
} from './financeEngine';

const MONTHS_ARRAY: readonly string[] = FISCAL_MONTHS;

const parseMonthIndex1Based = (monthName?: string, isoDate?: string): number => {
  if (monthName && monthName.trim()) {
    const idx = MONTHS_ARRAY.findIndex(
      (m) => m.toLowerCase() === monthName.trim().toLowerCase()
    );
    if (idx >= 0) return idx + 1;
  }
  if (isoDate && isoDate.length >= 7) {
    const m = parseInt(isoDate.slice(5, 7), 10);
    if (!isNaN(m) && m >= 1 && m <= 12) return m;
  }
  return 0;
};

const isItemInScope = (params: {
  periodType: FinancialAuditPeriodType;
  targetYear: number;
  targetMonth?: number;
  itemYear?: number;
  itemMonthName?: string;
  itemDate?: string;
  cumulativeUpToMonth?: boolean;
}): boolean => {
  const {
    periodType,
    targetYear,
    targetMonth = 12,
    itemYear,
    itemMonthName,
    itemDate,
    cumulativeUpToMonth = false,
  } = params;

  const resolvedYear =
    typeof itemYear === 'number' && itemYear > 0
      ? itemYear
      : itemDate && itemDate.length >= 4
      ? parseInt(itemDate.slice(0, 4), 10)
      : targetYear;

  if (resolvedYear !== targetYear) return false;
  if (periodType === 'TAHUNAN') return true;

  const mIdx = parseMonthIndex1Based(itemMonthName, itemDate);
  if (mIdx === 0) return true;
  return cumulativeUpToMonth ? mIdx <= targetMonth : mIdx === targetMonth;
};

const isFinanceKeywordMatch = (text?: string): boolean => {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('keuang') ||
    t.includes('kas') ||
    t.includes('bank') ||
    t.includes('piutang') ||
    t.includes('utang') ||
    t.includes('rka') ||
    t.includes('anggaran') ||
    t.includes('pajak') ||
    t.includes('aset') ||
    t.includes('pengadaan') ||
    t.includes('pembelian') ||
    t.includes('pendapatan') ||
    t.includes('rekening air') ||
    t.includes('penagihan') ||
    t.includes('billing') ||
    t.includes('tarif') ||
    t.includes('persediaan') ||
    t.includes('biaya') ||
    t.includes('neraca') ||
    t.includes('fcr') ||
    t.includes('akuntansi')
  );
};

export const mapCompositeScoreToPredicate = (score: number): FinancialAuditPredicate => {
  if (score >= 85) return 'Sangat Baik (Sehat - Baik Sekali)';
  if (score >= 70) return 'Baik / Efektif Dengan Catatan Minor (Sehat - Baik)';
  if (score >= 55) return 'Cukup Baik / Perlu Perbaikan Terarah (Sehat - Cukup)';
  if (score >= 40) return 'Kurang Baik / Perhatian Khusus (Kurang Sehat)';
  return 'Tidak Memadai / Intervensi Kritis (Sakit)';
};

export const recomputeIndicatorsTotal = (
  indicators: FinancialAuditIndicatorItem[]
): {
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
} => {
  const updated = indicators.map((ind) => {
    const clampedScore = Math.max(1, Math.min(5, Math.round(ind.auditorScore)));
    const weightedPoints = Math.round(((clampedScore / 5) * ind.weight) * 100) / 100;
    const verdict: AuditIndicatorVerdict =
      clampedScore >= 4
        ? 'Sesuai Standar'
        : clampedScore === 3
        ? 'Perlu Perhatian'
        : 'Defisiensi Material';
    return {
      ...ind,
      auditorScore: clampedScore,
      weightedPoints,
      verdict,
    };
  });

  const calcDimScore = (dim: FinancialAuditIndicatorItem['dimension']) => {
    const items = updated.filter((i) => i.dimension === dim);
    const maxWeight = items.reduce((s, i) => s + i.weight, 0);
    const earned = items.reduce((s, i) => s + i.weightedPoints, 0);
    return maxWeight > 0 ? Math.round((earned / maxWeight) * 10000) / 100 : 0;
  };

  const totalScore = Math.round(updated.reduce((s, i) => s + i.weightedPoints, 0) * 100) / 100;

  return {
    indicators: updated,
    totalScore,
    predicate: mapCompositeScoreToPredicate(totalScore),
    dimensionScores: {
      keuanganBpkp: calcDimScore('KEUANGAN_BPKP'),
      ekonomiRka: calcDimScore('EKONOMI_RKA_PENGADAAN'),
      efisiensiPdam: calcDimScore('EFISIENSI_OPERASIONAL_PDAM'),
      kepatuhanKasPajak: calcDimScore('KEPATUHAN_KAS_PAJAK'),
      pengendalianRisikoTlr: calcDimScore('PENGENDALIAN_RISIKO_TLR'),
    },
  };
};

export interface BuildFinancialAuditInput {
  periodType: FinancialAuditPeriodType;
  year: number;
  month?: number; // 1..12 when BULANAN
  unitFilterId?: string; // 'ALL' or unit.id
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
  auditUniverseList: AuditUniverseItem[];
  riskRegisters: RiskRegister[];
  bpkpAssessments: BPKPSelfAssessment[];
  kpiItems: KPIItem[];
  kpiMeasurements: KPIMeasurement[];
  assignments: AuditAssignment[];
  findings: Finding[];
  recommendations: Recommendation[];
  followUps: FollowUp[];
  wbsReports: WBSReport[];
  investigations: Investigation[];
  regulations: Regulation[];
}

export const buildFinancialPerformanceAuditData = (
  input: BuildFinancialAuditInput
): {
  snapshot: FinancialAuditCrossLineSnapshot;
  indicators: FinancialAuditIndicatorItem[];
} => {
  const {
    periodType,
    year,
    month = new Date().getMonth() + 1,
    unitFilterId = 'ALL',
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
    wbsReports,
    investigations,
    regulations,
  } = input;

  const targetMonthName = periodType === 'BULANAN' ? MONTHS_ARRAY[month - 1] || 'Januari' : undefined;
  const periodLabel =
    periodType === 'BULANAN'
      ? `Bulan ${targetMonthName} Tahun ${year}`
      : `Tahun Buku ${year} (Januari – Desember)`;

  const matchesUnit = (uId?: string) => unitFilterId === 'ALL' || !uId || uId === unitFilterId;

  // Cutoff date for cumulative position (balance sheet, cash, RKA YTD)
  const cutoffDate =
    periodType === 'BULANAN'
      ? `${year}-${String(month).padStart(2, '0')}-31`
      : `${year}-12-31`;

  const today = getTodayIso();

  // Filter cumulative up to target period for Accounting & Balances
  const journalsYtdScope = journals.filter((j) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: j.year,
      itemMonthName: j.month,
      itemDate: j.journalDate,
      cumulativeUpToMonth: true,
    }) && matchesUnit(j.unitId)
  );

  const txYtdScope = transactions.filter((t) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: t.year,
      itemMonthName: t.month,
      itemDate: t.transactionDate,
      cumulativeUpToMonth: true,
    }) && matchesUnit(t.unitId)
  );

  const txPeriodExact = transactions.filter((t) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: t.year,
      itemMonthName: t.month,
      itemDate: t.transactionDate,
      cumulativeUpToMonth: false,
    }) && matchesUnit(t.unitId)
  );

  const statements = computeAccountingStatements({
    accounts,
    journals: journalsYtdScope,
    transactions: txYtdScope,
    yearFilter: year,
  });

  const cashBankSummary = computeCashBankBalances(
    cashBanks.filter((c) => c.isActive !== false && (unitFilterId === 'ALL' || !c.unitId || c.unitId === unitFilterId)),
    txYtdScope,
    cutoffDate
  );

  // Filter RKA items
  const scopedRkaParents = rkaItems.filter(
    (r) => r.year === year && matchesUnit(r.unitId)
  );
  const scopedRkaSubs = rkaSubItems.filter(
    (s) =>
      s.year === year &&
      (unitFilterId === 'ALL' || !s.locationUnitId || s.locationUnitId === unitFilterId) &&
      (periodType === 'TAHUNAN' || parseMonthIndex1Based(s.executionMonth) <= month)
  );

  // Also check RKA absorption per parent
  const rkaBreakdown = scopedRkaParents.map((parent) => {
    const subsForParent = rkaSubItems.filter((s) => s.parentRkaId === parent.id);
    const abs = computeRkaAbsorptionForTarget({
      parentRka: parent,
      allSubItemsForParent: subsForParent,
      allTransactions: txYtdScope,
    });
    const verifiedSubCount = subsForParent.filter(
      (s) => s.verificationStatus === 'Terverifikasi Keuangan'
    ).length;
    return {
      id: parent.id,
      code: parent.code,
      programName: parent.programName,
      category: parent.category || parent.parentCategory || '-',
      unitName: parent.unitName,
      budgetAmount: abs.budgetAmount,
      totalRealization: abs.totalRealization,
      remainingBudget: abs.remainingBudget,
      absorptionPct: abs.absorptionPct,
      isOverBudget: abs.isOverBudget,
      subCount: subsForParent.length,
      verifiedSubCount,
    };
  });

  const rkaTotalBudget = rkaBreakdown.reduce((s, r) => s + r.budgetAmount, 0);
  const rkaTotalRealization = rkaBreakdown.reduce((s, r) => s + r.totalRealization, 0);
  const rkaRemainingBudget = rkaTotalBudget - rkaTotalRealization;
  const rkaAbsorptionPct =
    rkaTotalBudget > 0 ? Math.round((rkaTotalRealization / rkaTotalBudget) * 10000) / 100 : 0;
  const rkaOverbudgetCount = rkaBreakdown.filter((r) => r.isOverBudget).length;
  const rkaUnverifiedSubCount = scopedRkaSubs.filter(
    (s) => s.verificationStatus !== 'Terverifikasi Keuangan'
  ).length;

  // PDAM Snapshots in scope
  const yearSnapshots = pdamSnapshots
    .filter((s) => s.year === year)
    .sort(
      (a, b) =>
        MONTHS_ARRAY.indexOf(b.month) - MONTHS_ARRAY.indexOf(a.month)
    );
  const targetSnapshot =
    periodType === 'BULANAN'
      ? yearSnapshots.find((s) => s.month.toLowerCase() === (targetMonthName || '').toLowerCase()) ||
        yearSnapshots.find((s) => parseMonthIndex1Based(s.month) <= month)
      : yearSnapshots[0];

  const scopedTaxes = taxes.filter((t) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: t.year,
      itemMonthName: t.month,
      itemDate: t.dueDate,
      cumulativeUpToMonth: false,
    }) && matchesUnit(t.unitId)
  );

  const scopedRecons = reconciliations.filter((r) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: r.year,
      itemMonthName: r.month,
      itemDate: r.reconcileDate,
      cumulativeUpToMonth: false,
    })
  );

  const scopedRp = receivablesPayables.filter(
    (rp) => (rp.year === year || !rp.year) && matchesUnit(rp.unitId)
  );
  const scopedAssets = assets.filter((a) => matchesUnit(a.unitId));
  const scopedInventory = inventory.filter((inv) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: inv.year,
      itemMonthName: inv.month,
      cumulativeUpToMonth: false,
    }) && matchesUnit(inv.unitId)
  );
  const scopedPurchases = purchases.filter((p) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: p.year,
      itemMonthName: p.month,
      itemDate: p.purchaseDate,
      cumulativeUpToMonth: false,
    }) && matchesUnit(p.unitId)
  );
  const scopedAuditTrails = auditTrails.filter((a) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: a.year,
      itemDate: a.timestamp?.slice(0, 10),
      cumulativeUpToMonth: false,
    })
  );

  // Early Warnings & Ratios via existing engine
  const analysis = computeFinancialAnalysisAndWarnings({
    statements,
    totalCashAndBank: cashBankSummary.totalLiquidBalance,
    transactions: txYtdScope,
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

  // Lini 1 extra metrics
  const effectiveRevenue =
    periodType === 'BULANAN' && statements.incomeStatement.monthlyTotalRevenue > 0
      ? statements.incomeStatement.monthlyTotalRevenue
      : statements.incomeStatement.totalRevenue;
  const effectiveOpRevenue =
    periodType === 'BULANAN' && statements.incomeStatement.monthlyTotalOperatingRevenue > 0
      ? statements.incomeStatement.monthlyTotalOperatingRevenue
      : statements.incomeStatement.totalOperatingRevenue;
  const effectiveExpense =
    periodType === 'BULANAN' && statements.incomeStatement.monthlyTotalExpense > 0
      ? statements.incomeStatement.monthlyTotalExpense
      : statements.incomeStatement.totalExpense;
  const effectiveOpExpense =
    periodType === 'BULANAN' && statements.incomeStatement.monthlyTotalOperatingExpense > 0
      ? statements.incomeStatement.monthlyTotalOperatingExpense
      : statements.incomeStatement.totalOperatingExpense;
  const effectiveNetIncome =
    periodType === 'BULANAN' && statements.incomeStatement.monthlyNetIncome !== 0
      ? statements.incomeStatement.monthlyNetIncome
      : statements.incomeStatement.netIncome;

  const roePct =
    statements.balanceSheet.totalEquity > 0
      ? Math.round((statements.incomeStatement.netIncome / statements.balanceSheet.totalEquity) * 10000) / 100
      : 0;
  const roaPct =
    statements.balanceSheet.totalAssets > 0
      ? Math.round((statements.incomeStatement.netIncome / statements.balanceSheet.totalAssets) * 10000) / 100
      : 0;

  // Lini 2 metrics
  const postedPeriodTxs = txPeriodExact.filter((t) => t.status === 'Disetujui / Diposting');
  const periodReceiptsTotal = postedPeriodTxs
    .filter((t) => t.type === 'PENERIMAAN')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const periodExpensesTotal = postedPeriodTxs
    .filter((t) => t.type === 'PENGELUARAN')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const periodTransfersTotal = postedPeriodTxs
    .filter((t) => t.type === 'TRANSFER')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);

  const reconciliationMatchedCount = scopedRecons.filter((r) => r.status === 'Sesuai').length;
  const reconciliationVarianceCount = scopedRecons.filter((r) => r.status === 'Selisih').length;
  const reconciliationTotalVariance = scopedRecons.reduce(
    (s, r) => s + Math.abs(Number(r.difference) || 0),
    0
  );

  const closedPeriodsCount = periodCloses.filter(
    (p) =>
      p.isClosed &&
      p.year === year &&
      (periodType === 'TAHUNAN' ||
        p.month === 'TAHUNAN' ||
        p.month.toLowerCase() === (targetMonthName || '').toLowerCase())
  ).length;

  const unpostedJournalCount = journalsYtdScope.filter((j) => j.status === 'Draft').length;
  const unbalancedJournalCount = journalsYtdScope.filter(
    (j) => Math.abs((j.totalDebit || 0) - (j.totalCredit || 0)) > 1
  ).length;

  const openReceivables = scopedRp.filter((r) => r.kind === 'PIUTANG' && r.status !== 'Lunas');
  const overdueReceivables = openReceivables.filter((r) => r.dueDate && r.dueDate < today);
  const openPayables = scopedRp.filter((r) => r.kind === 'UTANG' && r.status !== 'Lunas');
  const overduePayables = openPayables.filter((r) => r.dueDate && r.dueDate < today);

  const activeAssets = scopedAssets.filter((a) => a.status !== 'Dihapusbukukan');
  const assetsAcquisitionTotal = activeAssets.reduce((s, a) => s + (Number(a.acquisitionCost) || 0), 0);
  const assetsBookValueTotal = activeAssets.reduce((s, a) => s + (Number(a.bookValue) || 0), 0);

  const inventoryEndingValue = scopedInventory.reduce((s, i) => s + (Number(i.endingValue) || 0), 0);
  const purchasesAmountTotal = scopedPurchases
    .filter((p) => p.status !== 'Dibatalkan')
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);

  const taxTotalAmount = scopedTaxes.reduce((s, t) => s + (Number(t.taxAmount) || 0), 0);
  const taxPaidAmount = scopedTaxes
    .filter((t) => t.status === 'Dibayar' || t.status === 'Dilaporkan')
    .reduce((s, t) => s + (Number(t.taxAmount) || 0), 0);
  const taxUnpaidAmount = scopedTaxes
    .filter((t) => t.status === 'Terutang')
    .reduce((s, t) => s + (Number(t.taxAmount) || 0), 0);
  const taxOverdueCount = scopedTaxes.filter(
    (t) => t.status === 'Terutang' && t.dueDate && t.dueDate < today
  ).length;

  // PDAM Snapshot operational-financial extraction
  let pdamCollectionEfficiencyPct = 0;
  let pdamNrwPct = 0;
  let pdamProducedM3 = 0;
  let pdamSoldM3 = 0;
  let pdamActiveConnections = 0;
  let pdamBilledAmount = 0;

  if (targetSnapshot) {
    const effRows = targetSnapshot.collectionEfficiency || [];
    const totalPrevBilling = effRows.reduce((s, r) => s + (r.prevBilling || 0), 0);
    const totalCol = effRows.reduce((s, r) => s + (r.totalCollected || 0), 0);
    if (totalPrevBilling > 0) {
      pdamCollectionEfficiencyPct = Math.round((totalCol / totalPrevBilling) * 10000) / 100;
    } else if (effRows.length > 0) {
      pdamCollectionEfficiencyPct =
        Math.round(
          (effRows.reduce((s, r) => s + (r.totalEfficiencyPct || 0), 0) / effRows.length) * 100
        ) / 100;
    }

    const prodRows = targetSnapshot.productionDistribution || [];
    const useYtd = periodType === 'TAHUNAN';
    pdamProducedM3 = prodRows.reduce(
      (s, r) => s + (useYtd ? r.producedM3Ytd || 0 : r.producedM3Monthly || 0),
      0
    );
    const distributedM3 = prodRows.reduce(
      (s, r) => s + (useYtd ? r.distributedM3Ytd || 0 : r.distributedM3Monthly || 0),
      0
    );
    pdamSoldM3 = prodRows.reduce(
      (s, r) => s + (useYtd ? r.soldM3Ytd || 0 : r.soldM3Monthly || 0),
      0
    );
    const baseProd = distributedM3 > 0 ? distributedM3 : pdamProducedM3;
    if (baseProd > 0) {
      pdamNrwPct = Math.round(((baseProd - pdamSoldM3) / baseProd) * 10000) / 100;
    } else if (prodRows.length > 0) {
      pdamNrwPct =
        Math.round(
          (prodRows.reduce((s, r) => s + (useYtd ? r.nrwPctYtd || 0 : r.nrwPctMonthly || 0), 0) /
            prodRows.length) *
            100
        ) / 100;
    }

    pdamActiveConnections = (targetSnapshot.customerConnections || []).reduce(
      (s, c) => s + (c.endingActive || 0),
      0
    );
    pdamBilledAmount = (targetSnapshot.drdSummary || []).reduce(
      (s, d) => s + (useYtd ? d.billedAmountYtd || 0 : d.billedAmountMonthly || 0),
      0
    );
  }

  // Lini 3: PKPT & Audit Universe
  const yearPkpt = pkptList.filter((p) => p.year === year && matchesUnit(p.unitId));
  const pkptFinanceRelated = yearPkpt.filter(
    (p) => Boolean(p.rkaId) || isFinanceKeywordMatch(`${p.title} ${p.businessProcess} ${p.auditType}`)
  );
  const pkptCompletedCount = pkptFinanceRelated.filter((p) => p.status === 'Selesai').length;
  const auditUniverseFinanceCount = auditUniverseList.filter(
    (au) =>
      au.isActive &&
      (au.year === year || !au.year) &&
      (au.category === 'Fungsi Keuangan & Aset' ||
        au.category === 'Proyek / Investasi RKA' ||
        isFinanceKeywordMatch(`${au.entityName} ${au.businessProcess}`))
  ).length;

  // Lini 4: Risiko Keuangan, SPIP & KPI
  const finRisks = riskRegisters.filter(
    (r) =>
      r.year === year &&
      matchesUnit(r.unitId) &&
      (r.impactArea === 'Beban Keuangan (Finansial)' ||
        r.category.toLowerCase().includes('keuang') ||
        isFinanceKeywordMatch(`${r.businessProcess} ${r.event} ${r.category}`))
  );
  const finHighExtremeRisks = finRisks.filter(
    (r) => r.residualLevel === 'Tinggi' || r.residualLevel === 'Sangat Tinggi' || r.residualLevel === 'Ekstrem'
  );
  const avgInherentRiskScore =
    finRisks.length > 0
      ? Math.round((finRisks.reduce((s, r) => s + (r.inherentScore || 0), 0) / finRisks.length) * 100) / 100
      : 0;
  const avgResidualRiskScore =
    finRisks.length > 0
      ? Math.round((finRisks.reduce((s, r) => s + (r.residualScore || 0), 0) / finRisks.length) * 100) / 100
      : 0;
  const riskReductionPct =
    avgInherentRiskScore > 0
      ? Math.round(((avgInherentRiskScore - avgResidualRiskScore) / avgInherentRiskScore) * 10000) / 100
      : 0;
  const ineffectiveControlRisksCount = finRisks.filter(
    (r) => r.controlEffectiveness === 'Tidak Efektif'
  ).length;

  const yearBpkp =
    (periodType === 'BULANAN'
      ? bpkpAssessments.find((b) => b.year === year && b.periodType === 'BULANAN' && b.month === month)
      : undefined) ||
    bpkpAssessments.find((b) => b.year === year && b.periodType !== 'BULANAN') ||
    bpkpAssessments.find((b) => b.year === year) ||
    bpkpAssessments[0];
  const bpkpKinerjaScore = yearBpkp?.kinerjaScore || 0;
  const bpkpKeuanganAspectScore = yearBpkp?.aspectScores?.keuangan || 0;
  const spipMaturityScore = yearBpkp?.spipMaturityScore || 0;

  const finKpis = kpiItems.filter(
    (k) =>
      k.year === year &&
      matchesUnit(k.unitId) &&
      (k.perspective === 'Keuangan' || isFinanceKeywordMatch(`${k.name} ${k.strategicObjective}`))
  );
  const finKpiIds = new Set(finKpis.map((k) => k.id));
  const finKpiMeasures = kpiMeasurements.filter((m) => {
    if (!finKpiIds.has(m.kpiId) || m.year !== year) return false;
    if (periodType === 'BULANAN') {
      return (m.periodType === 'Bulanan' && m.periodIndex === month) || m.periodType === 'Tahunan';
    }
    return true;
  });
  const kpiFinanceAvgAchievementPct =
    finKpiMeasures.length > 0
      ? Math.round(
          (finKpiMeasures.reduce((s, m) => s + (m.cappedAchievementPct || 0), 0) /
            finKpiMeasures.length) *
            100
        ) / 100
      : 0;
  const kpiFinanceVerifiedCount = finKpiMeasures.filter(
    (m) => m.spiVerificationStatus === 'Terverifikasi SPI'
  ).length;

  // Lini 5: SPT, Temuan 5C, TLR, WBS, Investigasi, Audit Trail
  const financeAssignments = assignments.filter((a) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemDate: a.startDate || a.letterDate,
      cumulativeUpToMonth: true,
    }) &&
    matchesUnit(a.unitId) &&
    isFinanceKeywordMatch(`${a.objectName} ${a.auditType} ${a.objective} ${a.unitName}`)
  );

  const financeFindings = findings.filter((f) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemYear: f.year,
      itemDate: f.createdAt?.slice(0, 10),
      cumulativeUpToMonth: true,
    }) &&
    matchesUnit(f.unitId) &&
    ((f.potentialLoss || 0) > 0 || isFinanceKeywordMatch(`${f.title} ${f.category} ${f.condition} ${f.unitName}`))
  );
  const financeFindingsOpen = financeFindings.filter((f) => f.status !== 'Selesai').length;
  const financeFindingsClosed = financeFindings.filter((f) => f.status === 'Selesai').length;
  const financeFindingsPotentialLoss = financeFindings.reduce(
    (s, f) => s + (Number(f.potentialLoss) || 0),
    0
  );

  const finFindingIds = new Set(financeFindings.map((f) => f.id));
  const financeRecs = recommendations.filter((r) => finFindingIds.has(r.findingId));
  const financeRecsCompleted = financeRecs.filter((r) => r.status === 'Selesai').length;
  const financeRecsCompletionPct =
    financeRecs.length > 0
      ? Math.round((financeRecsCompleted / financeRecs.length) * 10000) / 100
      : 100;

  const financeWbs = wbsReports.filter(
    (w) =>
      w.year === year &&
      (periodType === 'TAHUNAN' || w.month <= month) &&
      (w.category === 'Penggelapan Kas / Aset' ||
        w.category === 'Rekayasa Penagihan & Meter Air' ||
        w.category === 'Kecurangan Pengadaan Barang/Jasa' ||
        w.category === 'Korupsi, Suap & Gratifikasi' ||
        (w.estimatedLoss || 0) > 0)
  );

  const financeInvestigations = investigations.filter((inv) =>
    isItemInScope({
      periodType,
      targetYear: year,
      targetMonth: month,
      itemDate: inv.receiptDate,
      cumulativeUpToMonth: true,
    }) &&
    matchesUnit(inv.unitId) &&
    ((inv.estimatedLoss || 0) > 0 || isFinanceKeywordMatch(`${inv.title} ${inv.suspectedModus}`))
  );
  const financeInvestigationLoss = financeInvestigations.reduce(
    (s, inv) => s + (Number(inv.estimatedLoss) || 0),
    0
  );

  const duplicateAlertsCount = scopedAuditTrails.filter((a) => a.duplicateFlag).length;
  const activeRegulationsCount = regulations.filter((r) => r.status === 'Berlaku').length;

  // Monthly Trend across Jan..Des for Year
  const monthlyTrend = MONTHS_ARRAY.map((mName, idx) => {
    const mNum = idx + 1;
    const mTxs = transactions.filter(
      (t) =>
        t.year === year &&
        t.status === 'Disetujui / Diposting' &&
        matchesUnit(t.unitId) &&
        parseMonthIndex1Based(t.month, t.transactionDate) === mNum
    );
    const receipts = mTxs
      .filter((t) => t.type === 'PENERIMAAN')
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const expenses = mTxs
      .filter((t) => t.type === 'PENGELUARAN')
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const mRkaSubReal = rkaSubItems
      .filter(
        (s) =>
          s.year === year &&
          parseMonthIndex1Based(s.executionMonth) === mNum &&
          (unitFilterId === 'ALL' || !s.locationUnitId || s.locationUnitId === unitFilterId)
      )
      .reduce((s, item) => s + (Number(item.realizationAmount) || 0), 0);
    const mFindings = findings.filter(
      (f) =>
        f.year === year &&
        matchesUnit(f.unitId) &&
        parseMonthIndex1Based(undefined, f.createdAt?.slice(0, 10)) === mNum
    ).length;
    const mDups = auditTrails.filter(
      (a) =>
        (a.year === year || parseInt(a.timestamp?.slice(0, 4) || '0', 10) === year) &&
        parseMonthIndex1Based(undefined, a.timestamp?.slice(0, 10)) === mNum &&
        a.duplicateFlag
    ).length;

    return {
      monthIndex: mNum,
      monthName: mName,
      receipts,
      expenses,
      netCashFlow: receipts - expenses,
      rkaRealization: Math.max(expenses, mRkaSubReal),
      findingsCount: mFindings,
      txCount: mTxs.length,
      duplicateFlags: mDups,
    };
  });

  // =========================================================================
  // 12 STRUCTURED AUDIT INDICATORS (3E + BPKP + SPIP + COMPLIANCE)
  // =========================================================================
  const scoreFcr =
    analysis.fcrPct >= 110
      ? 5
      : analysis.fcrPct >= 100
      ? 4
      : analysis.fcrPct >= 90
      ? 3
      : analysis.fcrPct >= 75
      ? 2
      : 1;

  const scoreOr =
    analysis.operatingRatioPct === 0 && effectiveRevenue === 0
      ? 3
      : analysis.operatingRatioPct <= 75
      ? 5
      : analysis.operatingRatioPct <= 85
      ? 4
      : analysis.operatingRatioPct <= 95
      ? 3
      : analysis.operatingRatioPct <= 105
      ? 2
      : 1;

  const scoreLiquidity =
    analysis.currentRatioPct >= 200 && analysis.cashRatioPct >= 100
      ? 5
      : analysis.currentRatioPct >= 150 && analysis.cashRatioPct >= 75
      ? 4
      : analysis.currentRatioPct >= 100
      ? 3
      : analysis.currentRatioPct >= 60
      ? 2
      : 1;

  const scoreDer =
    statements.balanceSheet.totalEquity <= 0
      ? 2
      : analysis.debtToEquityRatioPct <= 50
      ? 5
      : analysis.debtToEquityRatioPct <= 100
      ? 4
      : analysis.debtToEquityRatioPct <= 150
      ? 3
      : analysis.debtToEquityRatioPct <= 200
      ? 2
      : 1;

  const scoreRka =
    rkaTotalBudget === 0
      ? 3
      : rkaOverbudgetCount > 0
      ? 2
      : rkaAbsorptionPct >= 85 && rkaAbsorptionPct <= 100 && rkaUnverifiedSubCount === 0
      ? 5
      : rkaAbsorptionPct >= 70 && rkaAbsorptionPct <= 100
      ? 4
      : rkaAbsorptionPct >= 50
      ? 3
      : 2;

  const purchaseRealizedPct =
    scopedPurchases.length > 0
      ? (scopedPurchases.filter((p) => p.status === 'Selesai' || p.status === 'Realisasi').length /
          scopedPurchases.length) *
        100
      : 100;
  const lowStockInventoryCount = scopedInventory.filter(
    (inv) => (inv.endingQty || 0) <= (inv.minStockQty || 0) && (inv.minStockQty || 0) > 0
  ).length;
  const scoreProcurementInventory =
    scopedPurchases.length === 0 && scopedInventory.length === 0
      ? 3
      : purchaseRealizedPct >= 90 && lowStockInventoryCount === 0
      ? 5
      : purchaseRealizedPct >= 75 && lowStockInventoryCount <= 1
      ? 4
      : purchaseRealizedPct >= 60
      ? 3
      : 2;

  const scoreCollectionEff =
    !targetSnapshot
      ? 3
      : pdamCollectionEfficiencyPct >= 95
      ? 5
      : pdamCollectionEfficiencyPct >= 90
      ? 4
      : pdamCollectionEfficiencyPct >= 80
      ? 3
      : pdamCollectionEfficiencyPct >= 70
      ? 2
      : 1;

  const scoreNrw =
    !targetSnapshot
      ? 3
      : pdamNrwPct <= 20
      ? 5
      : pdamNrwPct <= 25
      ? 4
      : pdamNrwPct <= 32
      ? 3
      : pdamNrwPct <= 40
      ? 2
      : 1;

  const scoreTreasuryAccounting =
    !statements.balanceSheet.isBalanced || unbalancedJournalCount > 0 || reconciliationVarianceCount > 1
      ? 2
      : reconciliationVarianceCount === 0 &&
        unpostedJournalCount === 0 &&
        statements.balanceSheet.isBalanced &&
        (scopedRecons.length > 0 || closedPeriodsCount > 0)
      ? 5
      : reconciliationVarianceCount === 0 && statements.balanceSheet.isBalanced
      ? 4
      : 3;

  const overdueRpCount = overdueReceivables.length + overduePayables.length;
  const scoreTaxAndArAp =
    taxOverdueCount > 0
      ? 2
      : taxUnpaidAmount === 0 && overdueRpCount === 0
      ? 5
      : taxOverdueCount === 0 && overdueRpCount <= 2
      ? 4
      : 3;

  const scoreControlAuditTrail =
    duplicateAlertsCount > 2 || financeWbs.length > 1 || financeInvestigations.length > 0
      ? 2
      : duplicateAlertsCount === 0 &&
        ineffectiveControlRisksCount === 0 &&
        finHighExtremeRisks.length === 0
      ? 5
      : duplicateAlertsCount === 0 && ineffectiveControlRisksCount <= 1
      ? 4
      : 3;

  const scoreFindingsTlrKpi =
    financeFindingsOpen > 3 || financeRecsCompletionPct < 50
      ? 2
      : financeRecsCompletionPct >= 90 && financeFindingsOpen === 0
      ? 5
      : financeRecsCompletionPct >= 75
      ? 4
      : 3;

  const rawIndicators: FinancialAuditIndicatorItem[] = [
    {
      id: 'ind-fin-01',
      code: 'FIN-01',
      dimension: 'KEUANGAN_BPKP',
      dimensionLabel: 'Kinerja Keuangan BPKP',
      name: 'Financial Cost Recovery (FCR)',
      formulaDesc: 'Pendapatan Usaha / Biaya Usaha × 100%',
      standardRef: 'Kepmendagri 47/1999 & BPKP PDAM',
      benchmarkLabel: '>= 100%',
      unit: '%',
      weight: 8,
      systemValue: analysis.fcrPct,
      systemFormatted: `${analysis.fcrPct.toFixed(2)}%`,
      systemScore: scoreFcr,
      auditorScore: scoreFcr,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Manajemen Keuangan (Laporan Laba Rugi & Rasio)',
      evidenceSummary: `Pendapatan Usaha ${formatRp(effectiveOpRevenue)} vs Beban Usaha ${formatRp(effectiveOpExpense)}.`,
      auditorNotes:
        analysis.fcrPct >= 100
          ? 'Tarif dan pendapatan usaha telah memulihkan seluruh biaya operasional (full cost recovery).'
          : 'Pendapatan usaha belum menutupi biaya operasi; perlu optimalisasi penagihan & efisiensi beban.',
    },
    {
      id: 'ind-fin-02',
      code: 'FIN-02',
      dimension: 'KEUANGAN_BPKP',
      dimensionLabel: 'Kinerja Keuangan BPKP',
      name: 'Rasio Biaya Operasi (Operating Ratio)',
      formulaDesc: 'Beban Operasi / Pendapatan Operasi × 100%',
      standardRef: 'BPKP Kesehatan BUMD Air Minum',
      benchmarkLabel: '<= 85%',
      unit: '%',
      weight: 8,
      systemValue: analysis.operatingRatioPct,
      systemFormatted: `${analysis.operatingRatioPct.toFixed(2)}%`,
      systemScore: scoreOr,
      auditorScore: scoreOr,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Manajemen Keuangan (Laba Rugi & COA Beban)',
      evidenceSummary: `Total Beban Periode ${formatRp(effectiveExpense)} terhadap Pendapatan ${formatRp(effectiveRevenue)}.`,
      auditorNotes:
        analysis.operatingRatioPct <= 85
          ? 'Efisiensi beban operasi berada pada zona sehat sesuai standar BPKP (<= 85%).'
          : 'Rasio operasi tinggi (> 85%); perlu pengendalian biaya energi pompa, pemeliharaan & umum.',
    },
    {
      id: 'ind-fin-03',
      code: 'FIN-03',
      dimension: 'KEUANGAN_BPKP',
      dimensionLabel: 'Kinerja Keuangan BPKP',
      name: 'Likuiditas (Current Ratio & Cash Ratio)',
      formulaDesc: 'Aset Lancar / Kewajiban Lancar & Kas+Bank / Kewajiban Lancar',
      standardRef: 'Permendagri 118/2018 & BPKP',
      benchmarkLabel: 'CR >= 200% · Cash >= 100%',
      unit: '%',
      weight: 7,
      systemValue: analysis.currentRatioPct,
      systemFormatted: `CR ${analysis.currentRatioPct.toFixed(1)}% / Cash ${analysis.cashRatioPct.toFixed(1)}%`,
      systemScore: scoreLiquidity,
      auditorScore: scoreLiquidity,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Manajemen Keuangan (Neraca & Kas/Bank)',
      evidenceSummary: `Aset Lancar ${formatRp(statements.balanceSheet.totalCurrentAssets)}, Kas/Bank ${formatRp(cashBankSummary.totalLiquidBalance)}, Utang Lancar ${formatRp(statements.balanceSheet.totalCurrentLiabilities)}.`,
      auditorNotes:
        scoreLiquidity >= 4
          ? 'Posisi likuiditas lancar sangat memadai untuk memenuhi kewajiban jangka pendek.'
          : 'Cadangan aset lancar dan kas terhadap kewajiban jangka pendek perlu diperkuat.',
    },
    {
      id: 'ind-fin-04',
      code: 'FIN-04',
      dimension: 'KEUANGAN_BPKP',
      dimensionLabel: 'Kinerja Keuangan BPKP',
      name: 'Solvabilitas (Debt to Equity Ratio)',
      formulaDesc: 'Total Kewajiban / Total Ekuitas × 100%',
      standardRef: 'BPKP Kesehatan Keuangan BUMD',
      benchmarkLabel: '<= 100%',
      unit: '%',
      weight: 7,
      systemValue: analysis.debtToEquityRatioPct,
      systemFormatted: `${analysis.debtToEquityRatioPct.toFixed(2)}%`,
      systemScore: scoreDer,
      auditorScore: scoreDer,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Manajemen Keuangan (Neraca)',
      evidenceSummary: `Total Kewajiban ${formatRp(statements.balanceSheet.totalLiabilities)} vs Ekuitas ${formatRp(statements.balanceSheet.totalEquity)}.`,
      auditorNotes:
        analysis.debtToEquityRatioPct <= 100
          ? 'Struktur permodalan sehat dengan ketergantungan utang terkendali.'
          : 'Rasio utang terhadap ekuitas melampaui batas optimal 100%.',
    },
    {
      id: 'ind-eco-01',
      code: 'ECO-01',
      dimension: 'EKONOMI_RKA_PENGADAAN',
      dimensionLabel: 'Ekonomi RKA & Pengadaan',
      name: 'Disiplin Pagu & Penyerapan RKA',
      formulaDesc: 'Total Realisasi RKA (Anti-Ganda) / Pagu RKA × 100%',
      standardRef: 'PP 54/2017 & Pedoman RKAP BUMD',
      benchmarkLabel: '85%–100% (0 Overbudget)',
      unit: '%',
      weight: 10,
      systemValue: rkaAbsorptionPct,
      systemFormatted: `${rkaAbsorptionPct.toFixed(2)}% (${rkaOverbudgetCount} over)`,
      systemScore: scoreRka,
      auditorScore: scoreRka,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Modul RKA Berjenjang & Transaksi BKK Keuangan',
      evidenceSummary: `Pagu RKA ${formatRp(rkaTotalBudget)}, Realisasi ${formatRp(rkaTotalRealization)}, Sisa ${formatRp(rkaRemainingBudget)}, Sub belum verifikasi Keuangan: ${rkaUnverifiedSubCount}.`,
      auditorNotes:
        rkaOverbudgetCount > 0
          ? `Terdapat ${rkaOverbudgetCount} pos RKA melampaui pagu anggaran; memerlukan adendum RKAP atau evaluasi SPI.`
          : 'Penyerapan anggaran RKA terkendali tanpa pelampauan pagu.',
    },
    {
      id: 'ind-eco-02',
      code: 'ECO-02',
      dimension: 'EKONOMI_RKA_PENGADAAN',
      dimensionLabel: 'Ekonomi RKA & Pengadaan',
      name: 'Ekonomi Pengadaan & Pengendalian Persediaan',
      formulaDesc: 'Realisasi Pengadaan RKA & Kecukupan Stok Kimia/Pipa (COA 15.xx)',
      standardRef: 'Permendagri 118/2018 & Tata Kelola Pengadaan',
      benchmarkLabel: '>= 85% Realisasi & 0 Kritis Stok',
      unit: '%',
      weight: 10,
      systemValue: Math.round(purchaseRealizedPct * 100) / 100,
      systemFormatted: `${purchaseRealizedPct.toFixed(1)}% (${scopedInventory.length} item)`,
      systemScore: scoreProcurementInventory,
      auditorScore: scoreProcurementInventory,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Manajemen Keuangan (Pembelian & Persediaan PDAM)',
      evidenceSummary: `${scopedPurchases.length} transaksi pengadaan (${formatRp(purchasesAmountTotal)}), nilai persediaan akhir ${formatRp(inventoryEndingValue)}, stok di bawah minimum: ${lowStockInventoryCount}.`,
      auditorNotes:
        lowStockInventoryCount > 0
          ? `Terdapat ${lowStockInventoryCount} item persediaan di bawah minimum stok yang berisiko mengganggu kontinuitas pengolahan/distribusi.`
          : 'Realisasi pengadaan dan saldo persediaan bahan kimia/pipa terkendali dengan baik.',
    },
    {
      id: 'ind-eff-01',
      code: 'EFF-01',
      dimension: 'EFISIENSI_OPERASIONAL_PDAM',
      dimensionLabel: 'Efisiensi Operasional PDAM',
      name: 'Efisiensi Penagihan Rekening Air (Collection Efficiency)',
      formulaDesc: 'Total Penerimaan Tagihan Air / Rekening Terbit × 100%',
      standardRef: 'Permendagri 118/2018 & BPKP Aspek Keuangan',
      benchmarkLabel: '>= 90%',
      unit: '%',
      weight: 10,
      systemValue: pdamCollectionEfficiencyPct,
      systemFormatted: targetSnapshot ? `${pdamCollectionEfficiencyPct.toFixed(2)}%` : 'Belum Ada Snapshot',
      systemScore: scoreCollectionEff,
      auditorScore: scoreCollectionEff,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Snapshot Laporan Bulanan PDAM (Permendagri 118/2018)',
      evidenceSummary: targetSnapshot
        ? `Snapshot ${targetSnapshot.month} ${targetSnapshot.year}: Efisiensi Penagihan ${pdamCollectionEfficiencyPct.toFixed(2)}%, DRD Terbit ${formatRp(pdamBilledAmount)}.`
        : 'Data efisiensi penagihan per unit pada snapshot PDAM periode ini belum diisi.',
      auditorNotes:
        pdamCollectionEfficiencyPct >= 90
          ? 'Efektivitas penagihan kasir unit pelayanan mencapai ambang optimal >= 90%.'
          : 'Efisiensi penagihan masih di bawah target 90%; perlu penertiban tunggakan pelanggan.',
    },
    {
      id: 'ind-eff-02',
      code: 'EFF-02',
      dimension: 'EFISIENSI_OPERASIONAL_PDAM',
      dimensionLabel: 'Efisiensi Operasional PDAM',
      name: 'Pengendalian Kehilangan Air (NRW) & Konversi Pendapatan',
      formulaDesc: '(Air Didistribusikan - Air Terjual) / Air Didistribusikan × 100%',
      standardRef: 'BPKP Aspek Operasional & Permendagri 118/2018',
      benchmarkLabel: '<= 25%',
      unit: '%',
      weight: 10,
      systemValue: pdamNrwPct,
      systemFormatted: targetSnapshot ? `${pdamNrwPct.toFixed(2)}%` : 'Belum Ada Snapshot',
      systemScore: scoreNrw,
      auditorScore: scoreNrw,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Snapshot Produksi & Distribusi Air PDAM',
      evidenceSummary: targetSnapshot
        ? `Produksi ${pdamProducedM3.toLocaleString('id-ID')} m³, Terjual ${pdamSoldM3.toLocaleString('id-ID')} m³, Sambungan Aktif ${pdamActiveConnections.toLocaleString('id-ID')} SR.`
        : 'Data produksi dan NRW periode ini belum tercatat pada snapshot PDAM.',
      auditorNotes:
        pdamNrwPct <= 25
          ? 'Tingkat Non-Revenue Water (NRW) terkendali sesuai standar kesehatan PDAM (<= 25%).'
          : 'Tingkat NRW di atas 25% mengindikasikan potensi kehilangan pendapatan langsung dari kebocoran fisik atau komersial.',
    },
    {
      id: 'ind-cmp-01',
      code: 'CMP-01',
      dimension: 'KEPATUHAN_KAS_PAJAK',
      dimensionLabel: 'Kepatuhan Kas, Akuntansi & Pajak',
      name: 'Ketertiban Kas/Bank, Rekonsiliasi & Tutup Buku',
      formulaDesc: 'Keseimbangan Neraca, 0 Selisih Rekonsiliasi Bank & Kepatuhan Tutup Buku',
      standardRef: 'SAK ETAP / SAK EP & PP 60/2008 SPIP',
      benchmarkLabel: '0 Selisih · Neraca Seimbang',
      unit: 'Selisih',
      weight: 8,
      systemValue: reconciliationTotalVariance,
      systemFormatted: `${reconciliationVarianceCount} selisih (${formatRp(reconciliationTotalVariance)})`,
      systemScore: scoreTreasuryAccounting,
      auditorScore: scoreTreasuryAccounting,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Manajemen Keuangan (Kas/Bank, Rekonsiliasi & Jurnal)',
      evidenceSummary: `Saldo Kas/Bank ${formatRp(cashBankSummary.totalLiquidBalance)}, Rekonsiliasi Sesuai: ${reconciliationMatchedCount}/${scopedRecons.length}, Neraca Seimbang: ${statements.balanceSheet.isBalanced ? 'Ya' : 'Tidak'}, Jurnal Draft: ${unpostedJournalCount}.`,
      auditorNotes:
        scoreTreasuryAccounting >= 4
          ? 'Pembukuan akuntansi, saldo kas/bank, dan rekonsiliasi bank selaras.'
          : 'Ditemukan selisih rekonsiliasi bank, jurnal belum diposting, atau ketidakseimbangan buku.',
    },
    {
      id: 'ind-cmp-02',
      code: 'CMP-02',
      dimension: 'KEPATUHAN_KAS_PAJAK',
      dimensionLabel: 'Kepatuhan Kas, Akuntansi & Pajak',
      name: 'Kepatuhan Perpajakan & Pengelolaan Utang/Piutang',
      formulaDesc: 'Kepatuhan Setor/Lapor Pajak (0 Tunggakan Jatuh Tempo) & Kolektibilitas AP/AR',
      standardRef: 'UU KUP / PPh / PPN & Standar Piutang PDAM',
      benchmarkLabel: '0 Pajak Jatuh Tempo',
      unit: 'Kasus',
      weight: 7,
      systemValue: taxOverdueCount,
      systemFormatted: `${taxOverdueCount} pajak terlambat · ${overdueRpCount} AR/AP tempo`,
      systemScore: scoreTaxAndArAp,
      auditorScore: scoreTaxAndArAp,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Manajemen Keuangan (Perpajakan & Utang/Piutang)',
      evidenceSummary: `Pajak Terutang ${formatRp(taxUnpaidAmount)} (${taxOverdueCount} lewat jatuh tempo), Piutang Terbuka ${formatRp(openReceivables.reduce((s, r) => s + (r.remainingAmount || 0), 0))}, Utang Terbuka ${formatRp(openPayables.reduce((s, r) => s + (r.remainingAmount || 0), 0))}.`,
      auditorNotes:
        taxOverdueCount === 0
          ? 'Kewajiban pemotongan dan penyetoran pajak berjalan tertib tanpa keterlambatan.'
          : `Terdapat ${taxOverdueCount} kewajiban pajak melewati tanggal jatuh tempo yang berisiko sanksi administrasi.`,
    },
    {
      id: 'ind-gov-01',
      code: 'GOV-01',
      dimension: 'PENGENDALIAN_RISIKO_TLR',
      dimensionLabel: 'Pengendalian Internal, Risiko & TLR',
      name: 'Integritas Audit Trail, Anti-Duplikasi & Mitigasi Risiko Keuangan',
      formulaDesc: '0 Transaksi Ganda, Pengendalian Fraud WBS & Efektivitas Mitigasi Risiko 5x5',
      standardRef: 'GIAS 2024 Principle 9 & PP 60/2008 SPIP',
      benchmarkLabel: '0 Duplikat · Mitigasi Efektif',
      unit: 'Alert',
      weight: 7,
      systemValue: duplicateAlertsCount,
      systemFormatted: `${duplicateAlertsCount} duplikat · ${finHighExtremeRisks.length} risiko tinggi`,
      systemScore: scoreControlAuditTrail,
      auditorScore: scoreControlAuditTrail,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Audit Trail Keuangan, Register Risiko 5x5, WBS & Investigasi',
      evidenceSummary: `Alert Duplikat: ${duplicateAlertsCount}, Risiko Keuangan Tinggi/Ekstrem: ${finHighExtremeRisks.length}/${finRisks.length} (Penurunan Risiko ${riskReductionPct}%), WBS/Investigasi Keuangan: ${financeWbs.length + financeInvestigations.length} kasus.`,
      auditorNotes:
        duplicateAlertsCount === 0
          ? 'Tidak terdeteksi anomali transaksi ganda; pengendalian risiko keuangan berfungsi memadai.'
          : `Terdapat ${duplicateAlertsCount} indikasi transaksi ganda pada Audit Trail Keuangan yang wajib diverifikasi substansinya.`,
    },
    {
      id: 'ind-gov-02',
      code: 'GOV-02',
      dimension: 'PENGENDALIAN_RISIKO_TLR',
      dimensionLabel: 'Pengendalian Internal, Risiko & TLR',
      name: 'Penyelesaian Temuan 5C Keuangan & Verifikasi KPI Keuangan',
      formulaDesc: 'Persentase Rekomendasi Keuangan Selesai (TLR) & Capaian KPI Keuangan',
      standardRef: 'Standar AAIPI & GIAS 2024 (Monitoring Tindak Lanjut)',
      benchmarkLabel: 'TLR >= 85% Selesai',
      unit: '%',
      weight: 8,
      systemValue: financeRecsCompletionPct,
      systemFormatted: `TLR ${financeRecsCompletionPct.toFixed(1)}% · KPI ${kpiFinanceAvgAchievementPct.toFixed(1)}%`,
      systemScore: scoreFindingsTlrKpi,
      auditorScore: scoreFindingsTlrKpi,
      weightedPoints: 0,
      verdict: 'Sesuai Standar',
      sourceModule: 'Temuan 5C, Tindak Lanjut Rekomendasi & KPI Keuangan',
      evidenceSummary: `${financeFindings.length} Temuan Keuangan (${financeFindingsOpen} terbuka, potensi kerugian ${formatRp(financeFindingsPotentialLoss)}), ${financeRecsCompleted}/${financeRecs.length} Rekomendasi Selesai, KPI Keuangan: ${kpiFinanceVerifiedCount}/${finKpiMeasures.length} terverifikasi SPI.`,
      auditorNotes:
        financeRecsCompletionPct >= 85
          ? 'Komitmen tindak lanjut perbaikan atas temuan audit keuangan berjalan efektif.'
          : 'Masih terdapat rekomendasi temuan keuangan yang belum selesai ditindaklanjuti unit kerja.',
    },
  ];

  const scored = recomputeIndicatorsTotal(rawIndicators);

  const snapshot: FinancialAuditCrossLineSnapshot = {
    periodType,
    year,
    ...(periodType === 'BULANAN' ? { monthNumber: month, monthName: targetMonthName } : {}),
    periodLabel,
    computedAt: new Date().toISOString(),

    totalAssets: statements.balanceSheet.totalAssets,
    totalCurrentAssets: statements.balanceSheet.totalCurrentAssets,
    netFixedAssets: statements.balanceSheet.netFixedAssets,
    totalLiabilities: statements.balanceSheet.totalLiabilities,
    totalCurrentLiabilities: statements.balanceSheet.totalCurrentLiabilities,
    totalLongTermLiabilities: statements.balanceSheet.totalLongTermLiabilities,
    totalEquity: statements.balanceSheet.totalEquity,
    isBalanceSheetBalanced: statements.balanceSheet.isBalanced,
    totalRevenue: statements.incomeStatement.totalRevenue,
    operatingRevenue: statements.incomeStatement.totalOperatingRevenue,
    totalExpense: statements.incomeStatement.totalExpense,
    operatingExpense: statements.incomeStatement.totalOperatingExpense,
    netIncome: statements.incomeStatement.netIncome,
    budgetRevenue: statements.incomeStatement.budgetYtdRevenue,
    budgetExpense: statements.incomeStatement.budgetYtdExpense,
    budgetNetIncome: statements.incomeStatement.budgetYtdNetIncome,
    monthlyRevenue: statements.incomeStatement.monthlyTotalRevenue,
    monthlyExpense: statements.incomeStatement.monthlyTotalExpense,
    monthlyNetIncome: statements.incomeStatement.monthlyNetIncome,
    monthlyBudgetRevenue: statements.incomeStatement.budgetMonthlyRevenue,
    monthlyBudgetExpense: statements.incomeStatement.budgetMonthlyExpense,
    operatingCashFlow: statements.cashFlow.netOperatingCashFlow,
    investingCashFlow: statements.cashFlow.netInvestingCashFlow,
    financingCashFlow: statements.cashFlow.netFinancingCashFlow,
    endingCashAccounting: statements.cashFlow.endingCash,
    fcrPct: analysis.fcrPct,
    currentRatioPct: analysis.currentRatioPct,
    cashRatioPct: analysis.cashRatioPct,
    operatingRatioPct: analysis.operatingRatioPct,
    debtToEquityRatioPct: analysis.debtToEquityRatioPct,
    roePct,
    roaPct,

    totalCashBalance: cashBankSummary.totalCashBalance,
    totalBankBalance: cashBankSummary.totalBankBalance,
    totalLiquidBalance: cashBankSummary.totalLiquidBalance,
    periodReceiptsTotal,
    periodExpensesTotal,
    periodTransfersTotal,
    periodNetCashDelta: periodReceiptsTotal - periodExpensesTotal,
    reconciliationCount: scopedRecons.length,
    reconciliationMatchedCount,
    reconciliationVarianceCount,
    reconciliationTotalVariance,
    closedPeriodsCount,
    unpostedJournalCount,
    unbalancedJournalCount,
    openReceivablesTotal: openReceivables.reduce((s, r) => s + (r.remainingAmount || 0), 0),
    overdueReceivablesTotal: overdueReceivables.reduce((s, r) => s + (r.remainingAmount || 0), 0),
    overdueReceivablesCount: overdueReceivables.length,
    openPayablesTotal: openPayables.reduce((s, r) => s + (r.remainingAmount || 0), 0),
    overduePayablesTotal: overduePayables.reduce((s, r) => s + (r.remainingAmount || 0), 0),
    overduePayablesCount: overduePayables.length,
    activeAssetsCount: activeAssets.length,
    assetsAcquisitionTotal,
    assetsBookValueTotal,
    inventoryItemsCount: scopedInventory.length,
    inventoryEndingValue,
    purchasesCount: scopedPurchases.length,
    purchasesAmountTotal,
    taxRecordsCount: scopedTaxes.length,
    taxTotalAmount,
    taxPaidAmount,
    taxUnpaidAmount,
    taxOverdueCount,
    pdamCollectionEfficiencyPct,
    pdamNrwPct,
    pdamProducedM3,
    pdamSoldM3,
    pdamActiveConnections,
    pdamBilledAmount,
    pdamSnapshotAvailable: Boolean(targetSnapshot),

    rkaParentCount: scopedRkaParents.length,
    rkaSubCount: scopedRkaSubs.length,
    rkaTotalBudget,
    rkaTotalRealization,
    rkaRemainingBudget,
    rkaAbsorptionPct,
    rkaOverbudgetCount,
    rkaUnverifiedSubCount,
    pkptTotalCount: yearPkpt.length,
    pkptFinanceRelatedCount: pkptFinanceRelated.length,
    pkptCompletedCount,
    auditUniverseFinanceCount,

    financialRisksCount: finRisks.length,
    financialHighExtremeRiskCount: finHighExtremeRisks.length,
    avgInherentRiskScore,
    avgResidualRiskScore,
    riskReductionPct,
    ineffectiveControlRisksCount,
    bpkpKinerjaScore,
    bpkpKeuanganAspectScore,
    spipMaturityScore,
    kpiFinanceCount: finKpis.length,
    kpiFinanceAvgAchievementPct,
    kpiFinanceVerifiedCount,

    financeAssignmentsCount: financeAssignments.length,
    financeFindingsTotal: financeFindings.length,
    financeFindingsOpen,
    financeFindingsClosed,
    financeFindingsPotentialLoss,
    financeRecsTotal: financeRecs.length,
    financeRecsCompleted,
    financeRecsCompletionPct,
    financeWbsCount: financeWbs.length,
    financeInvestigationsCount: financeInvestigations.length,
    financeInvestigationLoss,
    duplicateAlertsCount,
    earlyWarningsCriticalCount: analysis.warnings.filter((w) => w.severity === 'KRITIS').length,
    earlyWarningsTotalCount: analysis.warnings.length,
    activeRegulationsCount,

    totalCompositeScore: scored.totalScore,
    dimensionScores: scored.dimensionScores,
    predicate: scored.predicate,

    monthlyTrend,
    rkaBreakdown,
    earlyWarnings: analysis.warnings,
  };

  return { snapshot, indicators: scored.indicators };
};

export const generateFinancialAuditReportNarratives = (params: {
  snapshot: FinancialAuditCrossLineSnapshot;
  indicators: FinancialAuditIndicatorItem[];
  institutionName: string;
  unitName: string;
  materialityAmount: number;
  auditStandards: string;
}): {
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
} => {
  const { snapshot: s, indicators, institutionName, unitName, materialityAmount, auditStandards } = params;
  const deficiencyItems = indicators.filter((i) => i.verdict === 'Defisiensi Material');
  const attentionItems = indicators.filter((i) => i.verdict === 'Perlu Perhatian');

  const bab1ExecutiveSummary =
    `Satuan Pengawasan Intern (SPI) ${institutionName} telah melaksanakan Audit Kinerja Keuangan terintegrasi lintas lini untuk periode ${s.periodLabel} dengan cakupan entitas ${unitName}. Audit ini menilai aspek Ekonomi, Efisiensi, Efektivitas (3E), kesehatan keuangan BUMD Air Minum, kepatuhan akuntansi & perpajakan, serta pengendalian internal.\n\n` +
    `Berdasarkan hasil pengujian substantif dan konsolidasi data lintas modul sistem, kinerja pengelolaan keuangan periode ${s.periodLabel} memperoleh SKOR KOMPOSIT ${s.totalCompositeScore.toFixed(2)} / 100,00 dengan predikat: ${s.predicate.toUpperCase()}.\n\n` +
    `Ikhtisar capaian utama: Total Aset tercatat ${formatRp(s.totalAssets)}, Ekuitas ${formatRp(s.totalEquity)}, Pendapatan ${formatRp(s.totalRevenue)}, Beban ${formatRp(s.totalExpense)}, dan Laba/(Rugi) Bersih ${formatRp(s.netIncome)}. Financial Cost Recovery (FCR) berada pada ${s.fcrPct.toFixed(2)}%, Operating Ratio ${s.operatingRatioPct.toFixed(2)}%, Current Ratio ${s.currentRatioPct.toFixed(2)}%, serta penyerapan RKA sebesar ${s.rkaAbsorptionPct.toFixed(2)}% dari total pagu ${formatRp(s.rkaTotalBudget)}.\n\n` +
    `Hasil pengujian pengendalian mengidentifikasi ${deficiencyItems.length} indikator berstatus Defisiensi Material dan ${attentionItems.length} indikator Perlu Perhatian, dengan ${s.earlyWarningsCriticalCount} peringatan dini kritis dan ${s.financeFindingsOpen} temuan audit keuangan 5C yang masih dalam pemantauan tindak lanjut.`;

  const bab2BasisScopeMethodology =
    `1. Dasar Hukum & Standar Pemeriksaan:\n` +
    `Audit Kinerja Keuangan dilaksanakan berpedoman pada ${auditStandards}, meliputi: Undang-Undang Nomor 23 Tahun 2014 tentang Pemerintahan Daerah, PP Nomor 54 Tahun 2017 tentang BUMD, PP Nomor 60 Tahun 2008 tentang Sistem Pengendalian Intern Pemerintah (SPIP), Permendagri Nomor 118 Tahun 2018 tentang Rencana Bisnis, RKA, Pelaporan & Evaluasi BUMD Air Minum, Standar Audit Intern Pemerintah Indonesia (AAIPI), Global Internal Audit Standards (GIAS 2024), serta Pedoman Penilaian Kinerja PDAM BPKP / Kepmendagri Nomor 47 Tahun 1999.\n\n` +
    `2. Tujuan & Ruang Lingkup Lintas Lini:\n` +
    `Pemeriksaan mencakup evaluasi terintegrasi atas 5 (lima) lini data perusahaan untuk periode ${s.periodLabel}: (a) Akuntansi & Laporan Keuangan (COA, Jurnal, Buku Besar, Neraca, Laba Rugi, Arus Kas Langsung/Tidak Langsung, Perubahan Ekuitas); (b) Perbendaharaan (Kas/Bank, Rekonsiliasi, Utang/Piutang, Aset Tetap, Persediaan, Pembelian, Perpajakan); (c) Perencanaan & Anggaran (RKA berjenjang, PKPT, Audit Universe); (d) Operasional PDAM & Risiko (Penagihan Unit, DRD, NRW, Register Risiko 5x5, SPIP, KPI Keuangan); serta (e) Pengawasan (SPT, Temuan 5C, TLR, WBS, Investigasi, dan Audit Trail Keuangan).\n\n` +
    `3. Metodologi & Penetapan Materialitas:\n` +
    `Audit menggunakan metode analitik kuantitatif berbasis data aktual sistem, rekonsiliasi silang antar-buku pembantu, pengujian pengendalian (test of controls), dan verifikasi bukti elektronik. Ambang batas materialitas pemeriksaan ditetapkan sebesar ${formatRp(materialityAmount)} untuk mengevaluasi signifikansi penyimpangan keuangan, selisih rekonsiliasi, maupun potensi kerugian perusahaan. Terdapat ${s.activeRegulationsCount} produk hukum/regulasi aktif yang menjadi kriteria kepatuhan.`;

  const bab3FinancialStatementsAnalysis =
    `Evaluasi Laporan Keuangan untuk periode ${s.periodLabel} berdasarkan buku besar akuntansi (${s.isBalanceSheetBalanced ? 'Neraca dalam posisi SEIMBANG / BALANCED' : 'TERDAPAT SELISIH NERACA YANG WAJIB DIKOREKSI'}) menunjukkan posisi keuangan sebagai berikut:\n\n` +
    `1. Posisi Neraca & Struktur Modal:\n` +
    `- Total Aset mencapai ${formatRp(s.totalAssets)}, terdiri atas Aset Lancar ${formatRp(s.totalCurrentAssets)} dan Aset Tetap Neto ${formatRp(s.netFixedAssets)}.\n` +
    `- Total Kewajiban sebesar ${formatRp(s.totalLiabilities)} (Kewajiban Lancar ${formatRp(s.totalCurrentLiabilities)} dan Kewajiban Jangka Panjang ${formatRp(s.totalLongTermLiabilities)}), serta Total Ekuitas ${formatRp(s.totalEquity)}.\n\n` +
    `2. Kinerja Laba Rugi & Pencapaian Anggaran:\n` +
    `- Realisasi Pendapatan Akumulasi (YTD) sebesar ${formatRp(s.totalRevenue)} (Operasional: ${formatRp(s.operatingRevenue)}) dibandingkan Anggaran Pendapatan ${formatRp(s.budgetRevenue)}.\n` +
    `- Realisasi Beban Akumulasi (YTD) sebesar ${formatRp(s.totalExpense)} (Operasional: ${formatRp(s.operatingExpense)}) dibandingkan Anggaran Beban ${formatRp(s.budgetExpense)}, menghasilkan Laba/(Rugi) Bersih sebesar ${formatRp(s.netIncome)}.\n` +
    (s.periodType === 'BULANAN'
      ? `- Khusus Bulan ${s.monthName}: Realisasi Pendapatan Bulanan ${formatRp(s.monthlyRevenue)} (Anggaran ${formatRp(s.monthlyBudgetRevenue)}) vs Beban Bulanan ${formatRp(s.monthlyExpense)} (Anggaran ${formatRp(s.monthlyBudgetExpense)}), Laba/(Rugi) Bulan Berjalan ${formatRp(s.monthlyNetIncome)}.\n\n`
      : `\n`) +
    `3. Analisis Arus Kas & Rasio Kesehatan Keuangan:\n` +
    `- Arus Kas Operasional Neto: ${formatRp(s.operatingCashFlow)}, Investasi Neto: ${formatRp(s.investingCashFlow)}, Pendanaan Neto: ${formatRp(s.financingCashFlow)}, Saldo Kas Akhir Pembukuan: ${formatRp(s.endingCashAccounting)}.\n` +
    `- Rasio Kunci: FCR = ${s.fcrPct.toFixed(2)}% (target >= 100%), Operating Ratio = ${s.operatingRatioPct.toFixed(2)}% (target <= 85%), Current Ratio = ${s.currentRatioPct.toFixed(2)}%, Cash Ratio = ${s.cashRatioPct.toFixed(2)}%, Debt-to-Equity Ratio = ${s.debtToEquityRatioPct.toFixed(2)}%, ROA = ${s.roaPct.toFixed(2)}%, dan ROE = ${s.roePct.toFixed(2)}%.`;

  const bab4BudgetRkaProcurementEval =
    `Evaluasi Ekonomi dan Efektivitas Anggaran pada periode ${s.periodLabel} menguji keselarasan antara RKAP induk, sub-program kerja, transaksi pengeluaran (BKK), dan realisasi pengadaan:\n\n` +
    `1. Realisasi Anggaran RKA (Mekanisme Anti-Double-Counting):\n` +
    `- Total Pos Anggaran Induk RKA tercatat sebanyak ${s.rkaParentCount} pos dengan ${s.rkaSubCount} sub-program kerja.\n` +
    `- Total Pagu Anggaran sebesar ${formatRp(s.rkaTotalBudget)}, Total Realisasi ${formatRp(s.rkaTotalRealization)} (${s.rkaAbsorptionPct.toFixed(2)}%), dan Sisa Anggaran ${formatRp(s.rkaRemainingBudget)}.\n` +
    `- Pengendalian pagu mendeteksi ${s.rkaOverbudgetCount} pos anggaran melebihi pagu (overbudget) dan ${s.rkaUnverifiedSubCount} sub-program yang belum terverifikasi Bidang Keuangan.\n\n` +
    `2. Ekonomi Pengadaan & Integrasi Perencanaan Audit (PKPT / Audit Universe):\n` +
    `- Tercatat ${s.purchasesCount} aktivitas pembelian/pengadaan senilai total ${formatRp(s.purchasesAmountTotal)} yang terhubung dengan pos RKA dan persediaan.\n` +
    `- Pada lini perencanaan pengawasan, Audit Universe mencakup ${s.auditUniverseFinanceCount} objek audit berisiko keuangan & aset, dengan ${s.pkptFinanceRelatedCount} agenda PKPT terkait keuangan (${s.pkptCompletedCount} telah selesai dilaksanakan).`;

  const bab5TreasuryAssetsTaxEval =
    `Pengujian kepatuhan perbendaharaan, manajemen aset, dan perpajakan periode ${s.periodLabel} menghasilkan temuan faktual sebagai berikut:\n\n` +
    `1. Pengelolaan Kas, Bank, Rekonsiliasi & Tutup Buku:\n` +
    `- Posisi likuiditas riil pada Kas & Bank berjumlah ${formatRp(s.totalLiquidBalance)} (Kas Tunai/Kecil: ${formatRp(s.totalCashBalance)}; Rekening Bank: ${formatRp(s.totalBankBalance)}). Pada periode ini tercatat total Penerimaan ${formatRp(s.periodReceiptsTotal)}, Pengeluaran ${formatRp(s.periodExpensesTotal)}, dan Transfer Antarbank ${formatRp(s.periodTransfersTotal)}.\n` +
    `- Dari ${s.reconciliationCount} berita acara rekonsiliasi bank, sebanyak ${s.reconciliationMatchedCount} berstatus Sesuai dan ${s.reconciliationVarianceCount} berstatus Selisih dengan nilai akumulasi selisih ${formatRp(s.reconciliationTotalVariance)}. Jurnal berstatus Draft berjumlah ${s.unpostedJournalCount}, jurnal tidak seimbang ${s.unbalancedJournalCount}, dan periode tutup buku terkunci sebanyak ${s.closedPeriodsCount} periode.\n\n` +
    `2. Pengendalian Piutang, Utang, Aset Tetap & Persediaan:\n` +
    `- Piutang terbuka mencapai ${formatRp(s.openReceivablesTotal)} (${s.overdueReceivablesCount} tagihan senilai ${formatRp(s.overdueReceivablesTotal)} melewati jatuh tempo). Utang usaha terbuka sebesar ${formatRp(s.openPayablesTotal)} (${s.overduePayablesCount} melewati jatuh tempo senilai ${formatRp(s.overduePayablesTotal)}).\n` +
    `- Aset Tetap Aktif tercatat ${s.activeAssetsCount} unit dengan nilai perolehan ${formatRp(s.assetsAcquisitionTotal)} dan nilai buku neto ${formatRp(s.assetsBookValueTotal)}. Nilai persediaan bahan kimia dan instalasi pada gudang (COA 15.xx) mencapai ${formatRp(s.inventoryEndingValue)} (${s.inventoryItemsCount} jenis barang).\n\n` +
    `3. Kepatuhan Perpajakan:\n` +
    `- Tercatat ${s.taxRecordsCount} kewajiban perpajakan (PPN, PPh 21/22/23/Final, Pajak Air Permukaan) senilai total ${formatRp(s.taxTotalAmount)}. Pajak telah disetor/dilaporkan sebesar ${formatRp(s.taxPaidAmount)}, sedangkan pajak terutang sebesar ${formatRp(s.taxUnpaidAmount)} (${s.taxOverdueCount} kewajiban lewat tanggal jatuh tempo).`;

  const bab6OperationalPdamRiskKpi =
    `Audit Kinerja Keuangan menghubungkan output finansial dengan pemicu operasional PDAM, manajemen risiko, SPIP, dan KPI korporat:\n\n` +
    `1. Integrasi Operasional PDAM (Permendagri 118/2018):\n` +
    (s.pdamSnapshotAvailable
      ? `- Efisiensi penagihan rekening air pelanggan mencapai ${s.pdamCollectionEfficiencyPct.toFixed(2)}% dengan nilai DRD terbit ${formatRp(s.pdamBilledAmount)} atas ${s.pdamActiveConnections.toLocaleString('id-ID')} sambungan rumah (SR) aktif.\n- Kinerja produksi & distribusi mencatat volume air terproduksi/terdistribusi ${s.pdamProducedM3.toLocaleString('id-ID')} m³ dan terjual ${s.pdamSoldM3.toLocaleString('id-ID')} m³, sehingga tingkat kehilangan air (NRW) tercatat ${s.pdamNrwPct.toFixed(2)}% (ambang sehat BPKP <= 25%).\n\n`
      : `- Snapshot bulanan PDAM periode ${s.periodLabel} belum seluruhnya dilengkapi; auditor merekomendasikan pemutakhiran data efisiensi penagihan, DRD, dan NRW pada modul Keuangan.\n\n`) +
    `2. Profil Risiko Keuangan, SPIP Terpadu & Cascading KPI:\n` +
    `- Register Risiko 5x5 mencatat ${s.financialRisksCount} risiko berdampak keuangan dengan rata-rata skor inheren ${s.avgInherentRiskScore.toFixed(2)} turun menjadi skor residual ${s.avgResidualRiskScore.toFixed(2)} (efektivitas mitigasi ${s.riskReductionPct.toFixed(2)}%). Masih terdapat ${s.financialHighExtremeRiskCount} risiko berperingkat Tinggi/Ekstrem dan ${s.ineffectiveControlRisksCount} pengendalian berstatus Tidak Efektif.\n` +
    `- Evaluasi BPKP & SPIP Terpadu menunjukkan Skor Kinerja Keseluruhan ${s.bpkpKinerjaScore.toFixed(2)}/5.00 (Aspek Keuangan: ${s.bpkpKeuanganAspectScore.toFixed(2)}) dan Maturitas SPIP ${s.spipMaturityScore.toFixed(2)}/5.00.\n` +
    `- Terdapat ${s.kpiFinanceCount} indikator KPI Perspektif Keuangan dengan rata-rata capaian ${s.kpiFinanceAvgAchievementPct.toFixed(2)}% (${s.kpiFinanceVerifiedCount} pengukuran telah diverifikasi SPI).`;

  const bab7InternalControlFindingsTlr =
    `Pengujian efektivitas Sistem Pengendalian Intern dan tindak lanjut pengawasan pada periode ${s.periodLabel} merangkum fakta sebagai berikut:\n\n` +
    `1. Pengendalian Internal & Jejak Audit Keuangan (Anti-Fraud):\n` +
    `- Sistem Audit Trail Keuangan mendeteksi ${s.duplicateAlertsCount} indikasi transaksi ganda (duplicate key/voucher alert) dan ${s.earlyWarningsTotalCount} peringatan dini (${s.earlyWarningsCriticalCount} berstatus KRITIS).\n` +
    `- Pada kanal Whistleblowing System (WBS) dan Audit Investigatif terkait keuangan/kas/aset/pengadaan, tercatat ${s.financeWbsCount} pengaduan WBS dan ${s.financeInvestigationsCount} kasus investigasi dengan estimasi potensi kerugian ${formatRp(s.financeInvestigationLoss)}.\n\n` +
    `2. Pelaksanaan Penugasan (SPT), Temuan 5C & Penyelesaian Tindak Lanjut (TLR):\n` +
    `- Terdapat ${s.financeAssignmentsCount} Surat Perintah Tugas (SPT) yang relevan dengan objek keuangan dan aset.\n` +
    `- Matriks Temuan Audit 5C mencatat ${s.financeFindingsTotal} temuan terkait keuangan (${s.financeFindingsOpen} masih terbuka/dalam tindak lanjut dan ${s.financeFindingsClosed} telah tuntas), dengan total potensi kerugian keuangan tercatat ${formatRp(s.financeFindingsPotentialLoss)}.\n` +
    `- Tingkat penyelesaian Tindak Lanjut Rekomendasi (TLR) keuangan mencapai ${s.financeRecsCompletionPct.toFixed(2)}% (${s.financeRecsCompleted} dari ${s.financeRecsTotal} rekomendasi dinyatakan Selesai oleh SPI).`;

  const bab8ScoringMatrixAnalysis =
    `Penilaian terstruktur terhadap 12 indikator kinerja keuangan lintas 5 dimensi menghasilkan skor terbobot total sebesar ${s.totalCompositeScore.toFixed(2)} / 100,00 (${s.predicate}):\n\n` +
    `1. Dimensi Kinerja Keuangan BPKP (Bobot 30%): Capaian ${s.dimensionScores.keuanganBpkp.toFixed(2)}%.\n` +
    `2. Dimensi Ekonomi Anggaran RKA & Pengadaan (Bobot 20%): Capaian ${s.dimensionScores.ekonomiRka.toFixed(2)}%.\n` +
    `3. Dimensi Efisiensi Operasional PDAM (Bobot 20%): Capaian ${s.dimensionScores.efisiensiPdam.toFixed(2)}%.\n` +
    `4. Dimensi Kepatuhan Kas/Bank, Akuntansi & Pajak (Bobot 15%): Capaian ${s.dimensionScores.kepatuhanKasPajak.toFixed(2)}%.\n` +
    `5. Dimensi Pengendalian Internal, Risiko & TLR 5C (Bobot 15%): Capaian ${s.dimensionScores.pengendalianRisikoTlr.toFixed(2)}%.\n\n` +
    (deficiencyItems.length > 0
      ? `Area Defisiensi Material yang memerlukan eskalasi dan perbaikan segera:\n` +
        deficiencyItems.map((d, idx) => `${idx + 1}. [${d.code}] ${d.name}: ${d.systemFormatted} (Skor ${d.auditorScore}/5) — ${d.auditorNotes}`).join('\n')
      : `Tidak terdapat indikator dengan status Defisiensi Material pada periode ini; manajemen wajib mempertahankan konsistensi pengendalian pada indikator yang berstatus Perlu Perhatian.`);

  const recList: string[] = [];
  if (s.fcrPct < 100 || s.operatingRatioPct > 85) {
    recList.push(
      `Direksi bersama Bidang Keuangan agar menyusun langkah efisiensi biaya operasi (pompa, kimia, dan umum) serta optimalisasi pendapatan guna menjaga FCR >= 100% dan Operating Ratio <= 85%.`
    );
  }
  if (s.rkaOverbudgetCount > 0 || s.rkaUnverifiedSubCount > 0) {
    recList.push(
      `Bidang Keuangan agar menertibkan verifikasi realisasi sub-program RKA (${s.rkaUnverifiedSubCount} belum terverifikasi) dan menghentikan realisasi pada pos melebihi pagu (${s.rkaOverbudgetCount} pos) sebelum dilakukan revisi RKAP sah.`
    );
  }
  if (s.reconciliationVarianceCount > 0 || s.unpostedJournalCount > 0 || !s.isBalanceSheetBalanced) {
    recList.push(
      `Bagian Akuntansi & Kasir wajib menuntaskan selisih rekonsiliasi bank (${formatRp(s.reconciliationTotalVariance)}), memposting seluruh jurnal draft (${s.unpostedJournalCount} jurnal), dan memastikan tutup buku periodik tepat waktu.`
    );
  }
  if (s.taxOverdueCount > 0 || s.overdueReceivablesCount > 0) {
    recList.push(
      `Melakukan penyetoran segera atas ${s.taxOverdueCount} kewajiban pajak jatuh tempo untuk menghindari denda fiskal serta mengintensifkan penagihan piutang jatuh tempo senilai ${formatRp(s.overdueReceivablesTotal)}.`
    );
  }
  if (s.pdamSnapshotAvailable && (s.pdamCollectionEfficiencyPct < 90 || s.pdamNrwPct > 25)) {
    recList.push(
      `Unit Pelayanan dan Bagian Teknik agar menekan tingkat kehilangan air (NRW saat ini ${s.pdamNrwPct.toFixed(2)}%) dan meningkatkan efisiensi penagihan rekening air (saat ini ${s.pdamCollectionEfficiencyPct.toFixed(2)}%).`
    );
  }
  if (s.duplicateAlertsCount > 0 || s.financeFindingsOpen > 0) {
    recList.push(
      `Melakukan verifikasi substantif atas ${s.duplicateAlertsCount} indikasi transaksi ganda dan menuntaskan ${s.financeFindingsOpen} temuan audit keuangan 5C beserta rekomendasi TLR dalam batas waktu yang ditetapkan.`
    );
  }
  if (recList.length === 0) {
    recList.push(
      `Mempertahankan disiplin rekonsiliasi kas/bank harian, pengawasan realisasi RKA berbasis pagu berjenjang, dan pelaporan keuangan bulanan Permendagri 118/2018 tepat waktu.`,
      `Mengoptimalkan pemantauan indikator Early Warning Keuangan serta menjaga kepatuhan perpajakan dan efektivitas penagihan di seluruh unit pelayanan.`
    );
  }

  const bab9ConclusionRecommendations =
    `KESIMPULAN AUDIT KINERJA KEUANGAN:\n` +
    `Berdasarkan seluruh prosedur analisis lintas modul, pengujian bukti akuntansi, evaluasi RKA, perbendaharaan, operasional PDAM, manajemen risiko, dan pengendalian internal untuk periode ${s.periodLabel}, SPI menyimpulkan bahwa kinerja keuangan ${institutionName} mencapai skor komposit ${s.totalCompositeScore.toFixed(2)} / 100,00 dengan predikat ${s.predicate.toUpperCase()}.\n\n` +
    `REKOMENDASI STRATEGIS AUDITOR:\n` +
    recList.map((r, i) => `${i + 1}. ${r}`).join('\n');

  const managementCommitment =
    `Manajemen ${institutionName} (${unitName}) menerima hasil evaluasi Audit Kinerja Keuangan periode ${s.periodLabel} beserta matriks skor 3E & BPKP, dan berkomitmen menindaklanjuti seluruh rekomendasi strategis di atas sesuai jadwal rencana aksi bersama Satuan Pengawasan Intern (SPI).`;

  return {
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
  };
};

export const getMonthLabelFromDateHelper = getMonthNameFromDate;
