import { RKAItem, RKASubItem } from '../types/audit';
import {
  FinanceAccount,
  FinanceAsset,
  FinanceAuditTrail,
  FinanceCashBankAccount,
  FinanceGlobalFilter,
  FinanceInventoryItem,
  FinanceJournal,
  FinancePdamMonthlySnapshot,
  FinancePeriodClose,
  FinanceReceivablePayable,
  FinanceTaxRecord,
  FinanceTransaction,
} from '../types/finance';
import { FISCAL_MONTHS } from './featureCatalog';

export const isContraAssetAccount = (account: FinanceAccount): boolean => {
  if (account.isContra) return true;
  const sub = (account.subCategory || '').toLowerCase();
  const code = (account.code || '').trim();
  return (
    code === '1-2901' ||
    code.startsWith('13.09') ||
    code.startsWith('31.10') ||
    sub.includes('akumulasi') ||
    sub.includes('penyisihan') ||
    sub.includes('penurunan nilai')
  );
};

export const formatRp = (val: number): string => {
  const num = Number.isFinite(val) ? val : 0;
  const prefix = num < 0 ? '-Rp ' : 'Rp ';
  return `${prefix}${Math.abs(Math.round(num)).toLocaleString('id-ID')}`;
};

export const getTodayIso = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const getMonthNameFromDate = (dateStr?: string): string => {
  if (!dateStr) return FISCAL_MONTHS[new Date().getMonth()];
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (match) {
    const idx = parseInt(match[2], 10) - 1;
    if (idx >= 0 && idx < 12) return FISCAL_MONTHS[idx];
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return FISCAL_MONTHS[d.getMonth()];
  }
  return FISCAL_MONTHS[new Date().getMonth()];
};

export const formatDateShort = (dateStr?: string): string => {
  if (!dateStr || !dateStr.trim()) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return dateStr.slice(0, 10);
};

const sanitizeFirestoreValue = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeFirestoreValue(item))
      .filter((item) => item !== undefined);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const clean: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([k, v]) => {
    if (v !== undefined) {
      const sanitized = sanitizeFirestoreValue(v);
      if (sanitized !== undefined) {
        clean[k] = sanitized;
      }
    }
  });
  return clean;
};

export const sanitizeFirestoreRecord = <T extends object>(obj: T): T => {
  return sanitizeFirestoreValue(obj) as T;
};

export const isPeriodLocked = (
  periodCloses: FinancePeriodClose[],
  year: number,
  month: string
): boolean => {
  return periodCloses.some(
    (p) =>
      p.isClosed &&
      p.year === year &&
      (p.month === 'TAHUNAN' || p.month.toLowerCase() === month.toLowerCase())
  );
};

export const matchesGlobalFilter = (
  item: {
    year?: number;
    month?: string;
    date?: string;
    bidang?: string;
    unitId?: string;
    coaId?: string;
    coaIds?: string[];
  },
  filter: FinanceGlobalFilter
): boolean => {
  if (filter.year !== 0 && item.year !== undefined && item.year !== filter.year) {
    return false;
  }
  if (
    filter.month !== 'ALL' &&
    item.month !== undefined &&
    item.month.toLowerCase() !== filter.month.toLowerCase()
  ) {
    return false;
  }
  if (filter.dateFrom && item.date && item.date < filter.dateFrom) {
    return false;
  }
  if (filter.dateTo && item.date && item.date > filter.dateTo) {
    return false;
  }
  if (
    filter.bidang !== 'ALL' &&
    item.bidang !== undefined &&
    item.bidang.trim().toLowerCase() !== filter.bidang.trim().toLowerCase()
  ) {
    return false;
  }
  if (filter.unitId !== 'ALL' && item.unitId !== undefined && item.unitId !== filter.unitId) {
    return false;
  }
  if (filter.coaId !== 'ALL') {
    if (item.coaIds) {
      if (!item.coaIds.includes(filter.coaId)) return false;
    } else if (item.coaId !== undefined && item.coaId !== filter.coaId) {
      return false;
    }
  }
  return true;
};

// =========================================================================
// INTEGRASI RKA EXISTING & ANTI-DOUBLE-COUNTING ENGINE
// =========================================================================

export interface RKAAbsorptionResult {
  budgetAmount: number;
  baselineRealization: number;
  postedFinanceRealization: number;
  previousRealization: number;
  currentRealization: number;
  totalRealization: number;
  remainingBudget: number;
  absorptionPct: number;
  isOverBudget: boolean;
}

export const getRkaBaselineRealization = (
  parentRka: RKAItem,
  subItemsForParent: RKASubItem[],
  targetSub?: RKASubItem | null
): number => {
  if (targetSub) {
    if (typeof targetSub.financeBaselineRealization === 'number') {
      return Math.max(0, targetSub.financeBaselineRealization);
    }
    return Math.max(
      0,
      (targetSub.realizationAmount || 0) - (targetSub.financePostedRealization || 0)
    );
  }
  if (subItemsForParent.length > 0) {
    return subItemsForParent.reduce((sum, s) => {
      const subBase =
        typeof s.financeBaselineRealization === 'number'
          ? s.financeBaselineRealization
          : Math.max(0, (s.realizationAmount || 0) - (s.financePostedRealization || 0));
      return sum + Math.max(0, subBase);
    }, 0);
  }
  if (typeof parentRka.financeBaselineRealization === 'number') {
    return Math.max(0, parentRka.financeBaselineRealization);
  }
  return Math.max(
    0,
    (parentRka.realizationAmount || 0) - (parentRka.financePostedRealization || 0)
  );
};

export const computeRkaAbsorptionForTarget = (params: {
  parentRka: RKAItem;
  targetSub?: RKASubItem | null;
  allSubItemsForParent: RKASubItem[];
  allTransactions: FinanceTransaction[];
  currentAmount?: number;
  excludeTxId?: string;
}): RKAAbsorptionResult => {
  const {
    parentRka,
    targetSub = null,
    allSubItemsForParent,
    allTransactions,
    currentAmount = 0,
    excludeTxId,
  } = params;

  const budgetAmount = targetSub
    ? Number(targetSub.allocatedBudget) || 0
    : Number(parentRka.budgetAmount) || 0;

  const baselineRealization = getRkaBaselineRealization(
    parentRka,
    allSubItemsForParent,
    targetSub
  );

  const postedFinanceRealization = allTransactions
    .filter(
      (tx) =>
        tx.id !== excludeTxId &&
        tx.type === 'PENGELUARAN' &&
        tx.status === 'Disetujui / Diposting' &&
        (targetSub ? tx.rkaSubId === targetSub.id : tx.rkaId === parentRka.id)
    )
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

  const previousRealization = baselineRealization + postedFinanceRealization;
  const currentRealization = Math.max(0, Number(currentAmount) || 0);
  const totalRealization = previousRealization + currentRealization;
  const remainingBudget = budgetAmount - totalRealization;
  const absorptionPct =
    budgetAmount > 0 ? Math.round((totalRealization / budgetAmount) * 10000) / 100 : 0;

  return {
    budgetAmount,
    baselineRealization,
    postedFinanceRealization,
    previousRealization,
    currentRealization,
    totalRealization,
    remainingBudget,
    absorptionPct,
    isOverBudget: totalRealization > budgetAmount && budgetAmount > 0,
  };
};

// =========================================================================
// DETEKSI TRANSAKSI GANDA (ANTI-DUPLIKASI)
// =========================================================================

export const buildDuplicateKey = (tx: {
  type: string;
  transactionDate: string;
  amount: number;
  rkaId?: string;
  coaId?: string;
  counterpartyName?: string;
}): string => {
  const party = (tx.counterpartyName || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const targetRef = tx.rkaId || tx.coaId || '';
  return `${tx.type}|${tx.transactionDate}|${Math.round(Number(tx.amount) || 0)}|${targetRef}|${party}`;
};

export interface DuplicateMatch {
  existingTx: FinanceTransaction;
  reason: string;
  severity: 'HIGH' | 'MEDIUM';
}

export const findPotentialDuplicateTransactions = (
  candidate: {
    id?: string;
    voucherNumber: string;
    type: string;
    transactionDate: string;
    amount: number;
    rkaId?: string;
    coaId?: string;
    counterpartyName?: string;
  },
  existingTransactions: FinanceTransaction[]
): DuplicateMatch[] => {
  const candidateKey = buildDuplicateKey(candidate);
  const cleanVoucher = candidate.voucherNumber.trim().toUpperCase();
  const matches: DuplicateMatch[] = [];

  existingTransactions.forEach((tx) => {
    if (tx.id === candidate.id) return;
    if (tx.status === 'Dibatalkan' || tx.status === 'Ditolak') return;

    if (cleanVoucher && tx.voucherNumber.trim().toUpperCase() === cleanVoucher) {
      matches.push({
        existingTx: tx,
        reason: `Nomor bukti "${tx.voucherNumber}" sudah terdaftar pada tanggal ${formatDateShort(tx.transactionDate)}.`,
        severity: 'HIGH',
      });
      return;
    }

    if (tx.duplicateKey === candidateKey && candidate.amount > 0) {
      matches.push({
        existingTx: tx,
        reason: `Identik jenis, tanggal, nominal (${formatRp(tx.amount)}), pihak "${tx.counterpartyName}", dan pos RKA/akun.`,
        severity: 'HIGH',
      });
      return;
    }

    if (
      tx.type === candidate.type &&
      tx.transactionDate === candidate.transactionDate &&
      Math.round(tx.amount) === Math.round(candidate.amount) &&
      candidate.amount > 0
    ) {
      matches.push({
        existingTx: tx,
        reason: `Nominal dan tanggal transaksi sama (${formatDateShort(tx.transactionDate)} · ${formatRp(tx.amount)}).`,
        severity: 'MEDIUM',
      });
    }
  });

  return matches;
};

// =========================================================================
// KAS & BANK ENGINE
// =========================================================================

export interface CashBankComputedAccount extends FinanceCashBankAccount {
  totalIn: number;
  totalOut: number;
  transferIn: number;
  transferOut: number;
  currentBalance: number;
}

export const computeCashBankBalances = (
  accounts: FinanceCashBankAccount[],
  transactions: FinanceTransaction[],
  dateCutoff?: string,
  yearFilter?: number
): {
  accounts: CashBankComputedAccount[];
  totalCashBalance: number;
  totalBankBalance: number;
  totalLiquidBalance: number;
} => {
  const maxYear = accounts.reduce(
    (max, acc) => (typeof acc.year === 'number' && acc.year > max ? acc.year : max),
    0
  );

  let scopedAccounts = accounts;
  if (yearFilter && yearFilter !== 0) {
    const exactYearMatches = accounts.filter((a) => a.year === yearFilter);
    if (exactYearMatches.length > 0) {
      scopedAccounts = accounts.filter((a) => a.year === yearFilter || a.year === undefined);
    } else if (maxYear > 0) {
      const priorYears = accounts
        .map((a) => a.year || 0)
        .filter((y) => y > 0 && y <= yearFilter);
      const fallbackYear = priorYears.length > 0 ? Math.max(...priorYears) : maxYear;
      scopedAccounts = accounts.filter((a) => a.year === fallbackYear || a.year === undefined);
    }
  } else if (maxYear > 0) {
    scopedAccounts = accounts.filter((a) => a.year === maxYear || a.year === undefined);
  }

  const posted = transactions.filter(
    (t) =>
      t.status === 'Disetujui / Diposting' &&
      (!yearFilter || yearFilter === 0 || t.year === yearFilter) &&
      (!dateCutoff || t.transactionDate <= dateCutoff)
  );

  const computed: CashBankComputedAccount[] = scopedAccounts.map((acc) => {
    let totalIn = 0;
    let totalOut = 0;
    let transferIn = 0;
    let transferOut = 0;

    posted.forEach((tx) => {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'PENERIMAAN' && tx.cashBankId === acc.id) {
        totalIn += amt;
      } else if (tx.type === 'PENGELUARAN' && tx.cashBankId === acc.id) {
        totalOut += amt;
      } else if (tx.type === 'TRANSFER') {
        if (tx.cashBankId === acc.id) transferOut += amt;
        if (tx.targetCashBankId === acc.id) transferIn += amt;
      }
    });

    const currentBalance =
      (Number(acc.openingBalance) || 0) + totalIn + transferIn - totalOut - transferOut;

    return {
      ...acc,
      totalIn,
      totalOut,
      transferIn,
      transferOut,
      currentBalance,
    };
  });

  const totalCashBalance = computed
    .filter((a) => a.accountKind === 'KAS_BESAR' || a.accountKind === 'KAS_KECIL')
    .reduce((s, a) => s + a.currentBalance, 0);
  const totalBankBalance = computed
    .filter((a) => a.accountKind === 'BANK')
    .reduce((s, a) => s + a.currentBalance, 0);

  return {
    accounts: computed,
    totalCashBalance,
    totalBankBalance,
    totalLiquidBalance: totalCashBalance + totalBankBalance,
  };
};

// =========================================================================
// MESIN AKUNTANSI (BUKU BESAR, NERACA SALDO, LABA RUGI, NERACA, ARUS KAS, EKUITAS)
// =========================================================================

export interface AccountLedgerSummary {
  account: FinanceAccount;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  periodNetMovement: number;
  endingDebit: number;
  endingCredit: number;
  netSignedBalance: number; // + in normal balance direction
  prevMonthBalance: number;
  monthlyActual: number;
  monthlyBudget: number;
  ytdActual: number;
  ytdBudget: number;
  movements: {
    journalId: string;
    journalNumber: string;
    journalDate: string;
    journalType: string;
    description: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }[];
}

export interface AccountingStatements {
  ledgers: AccountLedgerSummary[];
  trialBalanceTotals: {
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    endingDebit: number;
    endingCredit: number;
  };
  incomeStatement: {
    operatingRevenues: AccountLedgerSummary[];
    otherRevenues: AccountLedgerSummary[];
    totalOperatingRevenue: number;
    totalOtherRevenue: number;
    totalRevenue: number;
    directExpenses: AccountLedgerSummary[];
    adminExpenses: AccountLedgerSummary[];
    depreciationExpenses: AccountLedgerSummary[];
    grossOperatingExpenses: AccountLedgerSummary[];
    adminTotalExpenses: AccountLedgerSummary[];
    otherExpenses: AccountLedgerSummary[];
    totalOperatingExpense: number;
    totalOtherExpense: number;
    totalExpense: number;
    grossProfit: number;
    operatingIncome: number;
    netOtherIncome: number;
    netIncome: number;
    // Comparative Monthly vs Budget vs YTD
    monthlyTotalOperatingRevenue: number;
    monthlyTotalOtherRevenue: number;
    monthlyTotalRevenue: number;
    monthlyTotalOperatingExpense: number;
    monthlyTotalOtherExpense: number;
    monthlyTotalExpense: number;
    monthlyGrossProfit: number;
    monthlyOperatingIncome: number;
    monthlyNetOtherIncome: number;
    monthlyNetIncome: number;
    budgetMonthlyOperatingRevenue: number;
    budgetYtdOperatingRevenue: number;
    budgetMonthlyOtherRevenue: number;
    budgetYtdOtherRevenue: number;
    budgetMonthlyOtherExpense: number;
    budgetYtdOtherExpense: number;
    budgetMonthlyGrossProfit: number;
    budgetYtdGrossProfit: number;
    budgetMonthlyOperatingIncome: number;
    budgetYtdOperatingIncome: number;
    budgetMonthlyNetOtherIncome: number;
    budgetYtdNetOtherIncome: number;
    budgetMonthlyRevenue: number;
    budgetMonthlyExpense: number;
    budgetMonthlyNetIncome: number;
    budgetYtdRevenue: number;
    budgetYtdExpense: number;
    budgetYtdNetIncome: number;
  };
  balanceSheet: {
    currentAssets: AccountLedgerSummary[];
    fixedAssets: AccountLedgerSummary[];
    accumulatedDepreciation: AccountLedgerSummary[];
    totalCurrentAssets: number;
    netFixedAssets: number;
    totalAssets: number;
    currentLiabilities: AccountLedgerSummary[];
    longTermLiabilities: AccountLedgerSummary[];
    totalCurrentLiabilities: number;
    totalLongTermLiabilities: number;
    totalLiabilities: number;
    equityAccounts: AccountLedgerSummary[];
    currentYearEarnings: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    isBalanced: boolean;
    // Comparative Bulan Lalu
    prevTotalCurrentAssets: number;
    prevNetFixedAssets: number;
    prevTotalAssets: number;
    prevTotalCurrentLiabilities: number;
    prevTotalLongTermLiabilities: number;
    prevTotalLiabilities: number;
    prevCurrentYearEarnings: number;
    prevTotalEquity: number;
    prevTotalLiabilitiesAndEquity: number;
  };
  cashFlow: {
    operatingInflows: number;
    operatingOutflows: number;
    netOperatingCashFlow: number;
    investingOutflows: number;
    investingInflows: number;
    netInvestingCashFlow: number;
    financingInflows: number;
    financingOutflows: number;
    netFinancingCashFlow: number;
    netCashChange: number;
    beginningCash: number;
    endingCash: number;
  };
  indirectCashFlow: {
    netIncome: number;
    depreciationAddBack: number;
    workingCapitalDelta: number;
    netOperatingCashFlow: number;
    netInvestingCashFlow: number;
    netFinancingCashFlow: number;
    netCashChange: number;
    beginningCash: number;
    endingCash: number;
  };
  equityChanges: {
    beginningCapital: number;
    retainedEarningsOpening: number;
    equityAdjustments: number;
    netIncome: number;
    endingEquity: number;
  };
}

export const computeAccountingStatements = (params: {
  accounts: FinanceAccount[];
  journals: FinanceJournal[];
  transactions: FinanceTransaction[];
  yearFilter: number;
}): AccountingStatements => {
  const { accounts, journals, transactions, yearFilter } = params;

  // Deduplicate COA by code for the selected year (when yearFilter === 0, pick latest year instead of double-counting multiple years)
  const maxCoaYear = accounts
    .filter((a) => a.isActive !== false && typeof a.year === 'number')
    .reduce((max, a) => Math.max(max, a.year || 0), 0);

  const effectiveCoaYear =
    yearFilter === 0
      ? maxCoaYear
      : accounts.some((a) => a.isActive !== false && a.year === yearFilter)
      ? yearFilter
      : maxCoaYear;

  const sortedAccounts = [...accounts]
    .filter(
      (a) =>
        a.isActive !== false &&
        (effectiveCoaYear === 0 || a.year === effectiveCoaYear)
    )
    .sort((a, b) => a.code.localeCompare(b.code));

  const activeCoa =
    sortedAccounts.length > 0
      ? sortedAccounts
      : Array.from(
          [...accounts]
            .filter((a) => a.isActive !== false)
            .sort((a, b) => (b.year || 0) - (a.year || 0))
            .reduce((map, acc) => {
              if (!map.has(acc.code)) map.set(acc.code, acc);
              return map;
            }, new Map<string, FinanceAccount>())
            .values()
        ).sort((a, b) => a.code.localeCompare(b.code));

  const postedJournals = journals
    .filter((j) => j.status === 'Posted' && (yearFilter === 0 || j.year === yearFilter))
    .sort((a, b) => a.journalDate.localeCompare(b.journalDate));

  const ledgers: AccountLedgerSummary[] = activeCoa.map((account) => {
    const openAmt = Number(account.openingBalance) || 0;
    const openingDebit = account.normalBalance === 'Debit' ? openAmt : 0;
    const openingCredit = account.normalBalance === 'Kredit' ? openAmt : 0;

    let periodDebit = 0;
    let periodCredit = 0;
    let running = openAmt;
    const movements: AccountLedgerSummary['movements'] = [];

    postedJournals.forEach((j) => {
      j.lines.forEach((line) => {
        if (line.coaId === account.id || line.coaCode === account.code) {
          const d = Number(line.debit) || 0;
          const c = Number(line.credit) || 0;
          if (d === 0 && c === 0) return;
          periodDebit += d;
          periodCredit += c;
          running += account.normalBalance === 'Debit' ? d - c : c - d;
          movements.push({
            journalId: j.id,
            journalNumber: j.journalNumber,
            journalDate: j.journalDate,
            journalType: j.journalType,
            description: line.description || j.description,
            debit: d,
            credit: c,
            runningBalance: running,
          });
        }
      });
    });

    const periodNetMovement =
      account.normalBalance === 'Debit' ? periodDebit - periodCredit : periodCredit - periodDebit;
    const netSignedBalance = running;
    const rawSigned = openingDebit - openingCredit + (periodDebit - periodCredit);
    const endingDebit = rawSigned > 0 ? rawSigned : 0;
    const endingCredit = rawSigned < 0 ? Math.abs(rawSigned) : 0;

    const prevMonthBalance =
      typeof account.prevMonthBalance === 'number'
        ? account.prevMonthBalance
        : openAmt;

    const hasMonthlyBaseline = typeof account.monthlyRealization === 'number';
    const monthlyActual = hasMonthlyBaseline
      ? (account.monthlyRealization || 0) + periodNetMovement
      : periodNetMovement;
    const ytdActual =
      typeof account.ytdRealization === 'number' && account.openingBalance === 0
        ? (account.ytdRealization || 0) + periodNetMovement
        : netSignedBalance;

    return {
      account,
      openingDebit,
      openingCredit,
      periodDebit,
      periodCredit,
      periodNetMovement,
      endingDebit,
      endingCredit,
      netSignedBalance,
      prevMonthBalance,
      monthlyActual,
      monthlyBudget: Number(account.budgetMonthly) || 0,
      ytdActual,
      ytdBudget: Number(account.budgetYtd) || 0,
      movements,
    };
  });

  const trialBalanceTotals = ledgers.reduce(
    (acc, l) => ({
      openingDebit: acc.openingDebit + l.openingDebit,
      openingCredit: acc.openingCredit + l.openingCredit,
      periodDebit: acc.periodDebit + l.periodDebit,
      periodCredit: acc.periodCredit + l.periodCredit,
      endingDebit: acc.endingDebit + l.endingDebit,
      endingCredit: acc.endingCredit + l.endingCredit,
    }),
    {
      openingDebit: 0,
      openingCredit: 0,
      periodDebit: 0,
      periodCredit: 0,
      endingDebit: 0,
      endingCredit: 0,
    }
  );

  // Income Statement
  const revenueLedgers = ledgers.filter((l) => l.account.type === 'Pendapatan');
  const operatingRevenues = revenueLedgers.filter(
    (l) =>
      l.account.subCategory.toLowerCase().includes('usaha') ||
      l.account.code.startsWith('81.') ||
      l.account.code.startsWith('4-1')
  );
  const otherRevenues = revenueLedgers.filter(
    (l) =>
      !l.account.subCategory.toLowerCase().includes('usaha') &&
      !l.account.code.startsWith('81.') &&
      !l.account.code.startsWith('4-1')
  );

  const totalOperatingRevenue = operatingRevenues.reduce((s, l) => s + l.netSignedBalance, 0);
  const totalOtherRevenue = otherRevenues.reduce((s, l) => s + l.netSignedBalance, 0);
  const totalRevenue = totalOperatingRevenue + totalOtherRevenue;

  const monthlyTotalOperatingRevenue = operatingRevenues.reduce((s, l) => s + l.monthlyActual, 0);
  const monthlyTotalOtherRevenue = otherRevenues.reduce((s, l) => s + l.monthlyActual, 0);
  const monthlyTotalRevenue = monthlyTotalOperatingRevenue + monthlyTotalOtherRevenue;

  const budgetMonthlyOperatingRevenue = operatingRevenues.reduce((s, l) => s + l.monthlyBudget, 0);
  const budgetYtdOperatingRevenue = operatingRevenues.reduce((s, l) => s + l.ytdBudget, 0);
  const budgetMonthlyOtherRevenue = otherRevenues.reduce((s, l) => s + l.monthlyBudget, 0);
  const budgetYtdOtherRevenue = otherRevenues.reduce((s, l) => s + l.ytdBudget, 0);
  const budgetMonthlyRevenue = revenueLedgers.reduce((s, l) => s + l.monthlyBudget, 0);
  const budgetYtdRevenue = revenueLedgers.reduce((s, l) => s + l.ytdBudget, 0);

  const expenseLedgers = ledgers.filter((l) => l.account.type === 'Beban');
  const isDepExp = (l: AccountLedgerSummary) =>
    l.account.subCategory.toLowerCase().includes('penyusutan') ||
    l.account.code.includes('.09.') ||
    l.account.code.startsWith('5-22');
  const isDirectExp = (l: AccountLedgerSummary) =>
    !isDepExp(l) &&
    (l.account.subCategory.toLowerCase().includes('langsung') ||
      l.account.code.startsWith('91.') ||
      l.account.code.startsWith('92.') ||
      l.account.code.startsWith('93.') ||
      l.account.code.startsWith('95.') ||
      l.account.code.startsWith('5-1'));
  const isAdminExp = (l: AccountLedgerSummary) =>
    !isDepExp(l) &&
    !isDirectExp(l) &&
    (l.account.subCategory.toLowerCase().includes('administrasi') ||
      l.account.code.startsWith('96.') ||
      l.account.code.startsWith('5-21'));

  const isDirectSectionExp = (l: AccountLedgerSummary) =>
    l.account.code.startsWith('91.') ||
    l.account.code.startsWith('92.') ||
    l.account.code.startsWith('93.') ||
    l.account.code.startsWith('95.') ||
    l.account.code.startsWith('5-1') ||
    l.account.subCategory.toLowerCase().includes('langsung');

  const isAdminSectionExp = (l: AccountLedgerSummary) =>
    !isDirectSectionExp(l) &&
    (l.account.code.startsWith('96.') ||
      l.account.code.startsWith('5-2') ||
      l.account.subCategory.toLowerCase().includes('administrasi') ||
      l.account.subCategory.toLowerCase().includes('penyusutan umum'));

  const depreciationExpenses = expenseLedgers.filter(isDepExp);
  const directExpenses = expenseLedgers.filter(isDirectExp);
  const adminExpenses = expenseLedgers.filter(isAdminExp);
  const grossOperatingExpenses = expenseLedgers.filter(isDirectSectionExp);
  const adminTotalExpenses = expenseLedgers.filter(isAdminSectionExp);
  const otherExpenses = expenseLedgers.filter(
    (l) => !isDepExp(l) && !isDirectExp(l) && !isAdminExp(l)
  );

  const totalDirectSectionExpense = grossOperatingExpenses.reduce(
    (s, l) => s + l.netSignedBalance,
    0
  );
  const totalAdminSectionExpense = adminTotalExpenses.reduce(
    (s, l) => s + l.netSignedBalance,
    0
  );
  const totalOperatingExpense =
    directExpenses.reduce((s, l) => s + l.netSignedBalance, 0) +
    adminExpenses.reduce((s, l) => s + l.netSignedBalance, 0) +
    depreciationExpenses.reduce((s, l) => s + l.netSignedBalance, 0);
  const totalOtherExpense = otherExpenses.reduce((s, l) => s + l.netSignedBalance, 0);
  const totalExpense = totalOperatingExpense + totalOtherExpense;
  const grossProfit = totalOperatingRevenue - totalDirectSectionExpense;
  const operatingIncome = grossProfit - totalAdminSectionExpense;
  const netOtherIncome = totalOtherRevenue - totalOtherExpense;
  const netIncome = totalRevenue - totalExpense;

  const monthlyTotalDirectSectionExpense = grossOperatingExpenses.reduce(
    (s, l) => s + l.monthlyActual,
    0
  );
  const monthlyTotalAdminSectionExpense = adminTotalExpenses.reduce(
    (s, l) => s + l.monthlyActual,
    0
  );
  const monthlyTotalOperatingExpense =
    directExpenses.reduce((s, l) => s + l.monthlyActual, 0) +
    adminExpenses.reduce((s, l) => s + l.monthlyActual, 0) +
    depreciationExpenses.reduce((s, l) => s + l.monthlyActual, 0);
  const monthlyTotalOtherExpense = otherExpenses.reduce((s, l) => s + l.monthlyActual, 0);
  const monthlyTotalExpense = monthlyTotalOperatingExpense + monthlyTotalOtherExpense;
  const monthlyGrossProfit = monthlyTotalOperatingRevenue - monthlyTotalDirectSectionExpense;
  const monthlyOperatingIncome = monthlyGrossProfit - monthlyTotalAdminSectionExpense;
  const monthlyNetOtherIncome = monthlyTotalOtherRevenue - monthlyTotalOtherExpense;
  const monthlyNetIncome = monthlyTotalRevenue - monthlyTotalExpense;

  const budgetMonthlyDirectSectionExpense = grossOperatingExpenses.reduce(
    (s, l) => s + l.monthlyBudget,
    0
  );
  const budgetYtdDirectSectionExpense = grossOperatingExpenses.reduce(
    (s, l) => s + l.ytdBudget,
    0
  );
  const budgetMonthlyAdminSectionExpense = adminTotalExpenses.reduce(
    (s, l) => s + l.monthlyBudget,
    0
  );
  const budgetYtdAdminSectionExpense = adminTotalExpenses.reduce(
    (s, l) => s + l.ytdBudget,
    0
  );
  const budgetMonthlyOtherExpense = otherExpenses.reduce((s, l) => s + l.monthlyBudget, 0);
  const budgetYtdOtherExpense = otherExpenses.reduce((s, l) => s + l.ytdBudget, 0);

  const budgetMonthlyGrossProfit =
    budgetMonthlyOperatingRevenue - budgetMonthlyDirectSectionExpense;
  const budgetYtdGrossProfit = budgetYtdOperatingRevenue - budgetYtdDirectSectionExpense;
  const budgetMonthlyOperatingIncome =
    budgetMonthlyGrossProfit - budgetMonthlyAdminSectionExpense;
  const budgetYtdOperatingIncome = budgetYtdGrossProfit - budgetYtdAdminSectionExpense;
  const budgetMonthlyNetOtherIncome = budgetMonthlyOtherRevenue - budgetMonthlyOtherExpense;
  const budgetYtdNetOtherIncome = budgetYtdOtherRevenue - budgetYtdOtherExpense;

  const budgetMonthlyExpense = expenseLedgers.reduce((s, l) => s + l.monthlyBudget, 0);
  const budgetYtdExpense = expenseLedgers.reduce((s, l) => s + l.ytdBudget, 0);
  const budgetMonthlyNetIncome = budgetMonthlyRevenue - budgetMonthlyExpense;
  const budgetYtdNetIncome = budgetYtdRevenue - budgetYtdExpense;

  // Balance Sheet (Supports contra current assets like 13.09.10 and contra fixed assets like 31.10.xx / 1-2901)
  const assetLedgers = ledgers.filter((l) => l.account.type === 'Aset');
  const currentAssets = assetLedgers.filter((l) =>
    l.account.subCategory.toLowerCase().includes('lancar')
  );
  const accumulatedDepreciation = assetLedgers.filter(
    (l) => !l.account.subCategory.toLowerCase().includes('lancar') && isContraAssetAccount(l.account)
  );
  const fixedAssets = assetLedgers.filter(
    (l) => !l.account.subCategory.toLowerCase().includes('lancar') && !isContraAssetAccount(l.account)
  );

  const totalCurrentAssets = currentAssets.reduce(
    (s, l) => s + (isContraAssetAccount(l.account) ? -l.netSignedBalance : l.netSignedBalance),
    0
  );
  const grossFixedAssets = fixedAssets.reduce((s, l) => s + l.netSignedBalance, 0);
  const totalAccumDep = accumulatedDepreciation.reduce((s, l) => s + l.netSignedBalance, 0);
  const netFixedAssets = grossFixedAssets - totalAccumDep;
  const totalAssets = totalCurrentAssets + netFixedAssets;

  const prevTotalCurrentAssets = currentAssets.reduce(
    (s, l) => s + (isContraAssetAccount(l.account) ? -l.prevMonthBalance : l.prevMonthBalance),
    0
  );
  const prevGrossFixedAssets = fixedAssets.reduce((s, l) => s + l.prevMonthBalance, 0);
  const prevTotalAccumDep = accumulatedDepreciation.reduce((s, l) => s + l.prevMonthBalance, 0);
  const prevNetFixedAssets = prevGrossFixedAssets - prevTotalAccumDep;
  const prevTotalAssets = prevTotalCurrentAssets + prevNetFixedAssets;

  const liabilityLedgers = ledgers.filter((l) => l.account.type === 'Kewajiban');
  const currentLiabilities = liabilityLedgers.filter((l) =>
    l.account.subCategory.toLowerCase().includes('lancar')
  );
  const longTermLiabilities = liabilityLedgers.filter(
    (l) => !l.account.subCategory.toLowerCase().includes('lancar')
  );
  const totalCurrentLiabilities = currentLiabilities.reduce((s, l) => s + l.netSignedBalance, 0);
  const totalLongTermLiabilities = longTermLiabilities.reduce((s, l) => s + l.netSignedBalance, 0);
  const totalLiabilities = totalCurrentLiabilities + totalLongTermLiabilities;

  const prevTotalCurrentLiabilities = currentLiabilities.reduce((s, l) => s + l.prevMonthBalance, 0);
  const prevTotalLongTermLiabilities = longTermLiabilities.reduce((s, l) => s + l.prevMonthBalance, 0);
  const prevTotalLiabilities = prevTotalCurrentLiabilities + prevTotalLongTermLiabilities;

  const allEquityLedgers = ledgers.filter((l) => l.account.type === 'Ekuitas');
  const currentEarningsCoa = allEquityLedgers.find(
    (l) =>
      l.account.code === '70.09.10' ||
      l.account.subCategory.toLowerCase().includes('tahun berjalan')
  );
  const equityAccounts = allEquityLedgers.filter((l) => l !== currentEarningsCoa);
  const baseEquity = equityAccounts.reduce((s, l) => s + l.netSignedBalance, 0);
  const periodNetDelta =
    revenueLedgers.reduce((s, l) => s + l.periodNetMovement, 0) -
    expenseLedgers.reduce((s, l) => s + l.periodNetMovement, 0);
  const currentYearEarnings = currentEarningsCoa
    ? currentEarningsCoa.netSignedBalance + periodNetDelta
    : netIncome;
  const totalEquity = baseEquity + currentYearEarnings;
  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;

  const prevBaseEquity = equityAccounts.reduce((s, l) => s + l.prevMonthBalance, 0);
  const prevCurrentYearEarnings = currentEarningsCoa ? currentEarningsCoa.prevMonthBalance : 0;
  const prevTotalEquity = prevBaseEquity + prevCurrentYearEarnings;
  const prevTotalLiabilitiesAndEquity = prevTotalLiabilities + prevTotalEquity;

  // Cash Flow from Posted Transactions (Actual Direct Method)
  const postedTxs = transactions.filter(
    (t) => t.status === 'Disetujui / Diposting' && (yearFilter === 0 || t.year === yearFilter)
  );
  const coaMap = new Map(activeCoa.map((c) => [c.id, c]));

  let operatingInflows = 0;
  let operatingOutflows = 0;
  let investingInflows = 0;
  let investingOutflows = 0;
  let financingInflows = 0;
  let financingOutflows = 0;

  postedTxs.forEach((tx) => {
    if (tx.type === 'TRANSFER') return;
    const amt = Number(tx.amount) || 0;
    const coa = coaMap.get(tx.coaId);
    const group =
      coa?.cashFlowGroup ||
      (tx.subCategory === 'Belanja Modal' ? 'Investasi' : 'Operasional');

    if (group === 'Investasi' || tx.subCategory === 'Belanja Modal') {
      if (tx.type === 'PENERIMAAN') investingInflows += amt;
      else investingOutflows += amt;
    } else if (group === 'Pendanaan') {
      if (tx.type === 'PENERIMAAN') financingInflows += amt;
      else financingOutflows += amt;
    } else {
      if (tx.type === 'PENERIMAAN') operatingInflows += amt;
      else operatingOutflows += amt;
    }
  });

  const netOperatingCashFlow = operatingInflows - operatingOutflows;
  const netInvestingCashFlow = investingInflows - investingOutflows;
  const netFinancingCashFlow = financingInflows - financingOutflows;
  const netCashChange = netOperatingCashFlow + netInvestingCashFlow + netFinancingCashFlow;

  const cashLedgers = ledgers.filter((l) => l.account.cashFlowGroup === 'Kas');
  const beginningCash = cashLedgers.reduce((s, l) => s + (Number(l.account.openingBalance) || 0), 0);
  const endingCash = beginningCash + netCashChange;

  // Indirect Cash Flow derived from monthly earnings + depreciation + comparative BS changes
  const monthlyDepAddBack = depreciationExpenses.reduce((s, l) => s + l.monthlyActual, 0);
  const effectiveNetIncome = monthlyNetIncome !== 0 ? monthlyNetIncome : netIncome;
  const effectiveDepAddBack =
    monthlyDepAddBack !== 0
      ? monthlyDepAddBack
      : depreciationExpenses.reduce((s, l) => s + l.netSignedBalance, 0);
  const nonCashCurrentAssetsCurr = currentAssets
    .filter((l) => l.account.cashFlowGroup !== 'Kas')
    .reduce((s, l) => s + (isContraAssetAccount(l.account) ? -l.netSignedBalance : l.netSignedBalance), 0);
  const nonCashCurrentAssetsPrev = currentAssets
    .filter((l) => l.account.cashFlowGroup !== 'Kas')
    .reduce((s, l) => s + (isContraAssetAccount(l.account) ? -l.prevMonthBalance : l.prevMonthBalance), 0);
  const workingCapitalDelta =
    -(nonCashCurrentAssetsCurr - nonCashCurrentAssetsPrev) +
    (totalCurrentLiabilities - prevTotalCurrentLiabilities);
  const indirectOpCf = effectiveNetIncome + effectiveDepAddBack + workingCapitalDelta;
  const indirectInvCf = -(grossFixedAssets - prevGrossFixedAssets);
  const indirectFinCf =
    totalLongTermLiabilities - prevTotalLongTermLiabilities + (baseEquity - prevBaseEquity);
  const indirectNetChange = indirectOpCf + indirectInvCf + indirectFinCf;
  const indirectBeginCash = cashLedgers.reduce((s, l) => s + l.prevMonthBalance, 0);
  const indirectEndCash = cashLedgers.reduce((s, l) => s + l.netSignedBalance, 0);

  const capitalAccounts = equityAccounts.filter((l) =>
    l.account.name.toLowerCase().includes('modal')
  );
  const beginningCapital = capitalAccounts.reduce(
    (s, l) => s + (l.openingCredit - l.openingDebit),
    0
  );
  const retainedEarningsOpening = equityAccounts
    .filter((l) => !l.account.name.toLowerCase().includes('modal'))
    .reduce((s, l) => s + (l.openingCredit - l.openingDebit), 0);
  const equityAdjustments = equityAccounts.reduce(
    (s, l) => s + (l.periodCredit - l.periodDebit),
    0
  );

  return {
    ledgers,
    trialBalanceTotals,
    incomeStatement: {
      operatingRevenues,
      otherRevenues,
      totalOperatingRevenue,
      totalOtherRevenue,
      totalRevenue,
      directExpenses,
      adminExpenses,
      depreciationExpenses,
      grossOperatingExpenses,
      adminTotalExpenses,
      otherExpenses,
      totalOperatingExpense,
      totalOtherExpense,
      totalExpense,
      grossProfit,
      operatingIncome,
      netOtherIncome,
      netIncome,
      monthlyTotalOperatingRevenue,
      monthlyTotalOtherRevenue,
      monthlyTotalRevenue,
      monthlyTotalOperatingExpense,
      monthlyTotalOtherExpense,
      monthlyTotalExpense,
      monthlyGrossProfit,
      monthlyOperatingIncome,
      monthlyNetOtherIncome,
      monthlyNetIncome,
      budgetMonthlyOperatingRevenue,
      budgetYtdOperatingRevenue,
      budgetMonthlyOtherRevenue,
      budgetYtdOtherRevenue,
      budgetMonthlyOtherExpense,
      budgetYtdOtherExpense,
      budgetMonthlyGrossProfit,
      budgetYtdGrossProfit,
      budgetMonthlyOperatingIncome,
      budgetYtdOperatingIncome,
      budgetMonthlyNetOtherIncome,
      budgetYtdNetOtherIncome,
      budgetMonthlyRevenue,
      budgetMonthlyExpense,
      budgetMonthlyNetIncome,
      budgetYtdRevenue,
      budgetYtdExpense,
      budgetYtdNetIncome,
    },
    balanceSheet: {
      currentAssets,
      fixedAssets,
      accumulatedDepreciation,
      totalCurrentAssets,
      netFixedAssets,
      totalAssets,
      currentLiabilities,
      longTermLiabilities,
      totalCurrentLiabilities,
      totalLongTermLiabilities,
      totalLiabilities,
      equityAccounts,
      currentYearEarnings,
      totalEquity,
      totalLiabilitiesAndEquity,
      isBalanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 5,
      prevTotalCurrentAssets,
      prevNetFixedAssets,
      prevTotalAssets,
      prevTotalCurrentLiabilities,
      prevTotalLongTermLiabilities,
      prevTotalLiabilities,
      prevCurrentYearEarnings,
      prevTotalEquity,
      prevTotalLiabilitiesAndEquity,
    },
    cashFlow: {
      operatingInflows,
      operatingOutflows,
      netOperatingCashFlow,
      investingOutflows,
      investingInflows,
      netInvestingCashFlow,
      financingInflows,
      financingOutflows,
      netFinancingCashFlow,
      netCashChange,
      beginningCash,
      endingCash,
    },
    indirectCashFlow: {
      netIncome: effectiveNetIncome,
      depreciationAddBack: effectiveDepAddBack,
      workingCapitalDelta,
      netOperatingCashFlow: indirectOpCf,
      netInvestingCashFlow: indirectInvCf,
      netFinancingCashFlow: indirectFinCf,
      netCashChange: indirectNetChange,
      beginningCash: indirectBeginCash,
      endingCash: indirectEndCash,
    },
    equityChanges: {
      beginningCapital,
      retainedEarningsOpening,
      equityAdjustments,
      netIncome: currentYearEarnings,
      endingEquity: baseEquity + currentYearEarnings,
    },
  };
};

// =========================================================================
// ANALISIS RASIO KEUANGAN, PROYEKSI ARUS KAS & EARLY WARNING
// =========================================================================

export interface FinancialEarlyWarningItem {
  id: string;
  severity: 'KRITIS' | 'PERINGATAN' | 'INFO';
  category: string;
  title: string;
  detail: string;
  metricValue: string;
}

export interface FinancialAnalysisResult {
  fcrPct: number;
  currentRatioPct: number;
  cashRatioPct: number;
  operatingRatioPct: number;
  debtToEquityRatioPct: number;
  cashFlowProjection: {
    label: string;
    projectedInflow: number;
    projectedOutflow: number;
    projectedNet: number;
    projectedEndingBalance: number;
  }[];
  warnings: FinancialEarlyWarningItem[];
}

export const computeFinancialAnalysisAndWarnings = (params: {
  statements: AccountingStatements;
  totalCashAndBank: number;
  transactions: FinanceTransaction[];
  receivablesPayables: FinanceReceivablePayable[];
  taxes: FinanceTaxRecord[];
  rkaItems: RKAItem[];
  rkaSubItems: RKASubItem[];
  assets: FinanceAsset[];
  auditTrails: FinanceAuditTrail[];
  year: number;
  pdamSnapshots?: FinancePdamMonthlySnapshot[];
  inventory?: FinanceInventoryItem[];
}): FinancialAnalysisResult => {
  const {
    statements,
    totalCashAndBank,
    transactions,
    receivablesPayables,
    taxes,
    rkaItems,
    rkaSubItems,
    auditTrails,
    year,
    pdamSnapshots = [],
    inventory = [],
  } = params;

  const opRev = statements.incomeStatement.totalOperatingRevenue;
  const totRev = statements.incomeStatement.totalRevenue;
  const opExp = statements.incomeStatement.totalOperatingExpense;
  const totExp = statements.incomeStatement.totalExpense;

  const curAssets = statements.balanceSheet.totalCurrentAssets;
  const curLiab = statements.balanceSheet.totalCurrentLiabilities;
  const totLiab = statements.balanceSheet.totalLiabilities;
  const totEquity = statements.balanceSheet.totalEquity;

  // FCR: Pendapatan Usaha / Biaya Usaha * 100%
  const fcrPct =
    opExp > 0
      ? Math.round(((opRev > 0 ? opRev : totRev) / opExp) * 10000) / 100
      : totRev > 0
      ? 100
      : 0;
  // Operating Ratio: Biaya Operasi / Pendapatan Operasi * 100%
  const operatingRatioPct =
    opRev > 0 ? Math.round((opExp / opRev) * 10000) / 100 : totRev > 0 ? Math.round((totExp / totRev) * 10000) / 100 : 0;
  // Current Ratio: Aset Lancar / Kewajiban Lancar * 100%
  const currentRatioPct = curLiab > 0 ? Math.round((curAssets / curLiab) * 10000) / 100 : 0;
  // Cash Ratio: (Kas + Bank) / Kewajiban Lancar * 100%
  const cashRatioPct = curLiab > 0 ? Math.round((totalCashAndBank / curLiab) * 10000) / 100 : 0;
  // Debt to Equity Ratio: Total Kewajiban / Total Ekuitas * 100%
  const debtToEquityRatioPct = totEquity > 0 ? Math.round((totLiab / totEquity) * 10000) / 100 : 0;

  // 6-Month Cash Flow Projection starting from next month
  const postedYearTxs = transactions.filter(
    (t) => t.status === 'Disetujui / Diposting' && (year === 0 || t.year === year) && t.type !== 'TRANSFER'
  );
  const activeMonthsSet = new Set(postedYearTxs.map((t) => t.month));
  const divisor = Math.max(1, activeMonthsSet.size);
  const avgMonthlyInflow =
    postedYearTxs
      .filter((t) => t.type === 'PENERIMAAN')
      .reduce((s, t) => s + (t.amount || 0), 0) / divisor;
  const avgMonthlyOutflow =
    postedYearTxs
      .filter((t) => t.type === 'PENGELUARAN')
      .reduce((s, t) => s + (t.amount || 0), 0) / divisor;

  const currentMonthIdx = new Date().getMonth();
  const cashFlowProjection: FinancialAnalysisResult['cashFlowProjection'] = [];
  let runningProjBalance = totalCashAndBank;

  for (let offset = 1; offset <= 6; offset++) {
    const mIdx = (currentMonthIdx + offset) % 12;
    const mName = FISCAL_MONTHS[mIdx];
    // Add scheduled remaining RKA sub-program budgets & open AR/AP due in that month
    const scheduledRkaOut = rkaSubItems
      .filter(
        (s) =>
          (year === 0 || s.year === year) &&
          s.executionMonth === mName &&
          s.status !== 'Selesai'
      )
      .reduce((sum, s) => sum + Math.max(0, (s.allocatedBudget || 0) - (s.realizationAmount || 0)), 0);

    const openReceivableMonth = receivablesPayables
      .filter(
        (rp) =>
          rp.kind === 'PIUTANG' &&
          rp.status !== 'Lunas' &&
          getMonthNameFromDate(rp.dueDate) === mName
      )
      .reduce((sum, rp) => sum + (rp.remainingAmount || 0) * 0.8, 0);

    const openPayableMonth = receivablesPayables
      .filter(
        (rp) =>
          rp.kind === 'UTANG' &&
          rp.status !== 'Lunas' &&
          getMonthNameFromDate(rp.dueDate) === mName
      )
      .reduce((sum, rp) => sum + (rp.remainingAmount || 0), 0);

    const projectedInflow = Math.round(avgMonthlyInflow + openReceivableMonth);
    const projectedOutflow = Math.round(
      avgMonthlyOutflow + openPayableMonth + scheduledRkaOut * 0.5
    );
    const projectedNet = projectedInflow - projectedOutflow;
    runningProjBalance += projectedNet;

    cashFlowProjection.push({
      label: mName,
      projectedInflow,
      projectedOutflow,
      projectedNet,
      projectedEndingBalance: runningProjBalance,
    });
  }

  // Early Warnings
  const warnings: FinancialEarlyWarningItem[] = [];
  const today = getTodayIso();

  if (statements.incomeStatement.operatingIncome < 0) {
    warnings.push({
      id: 'warn-operating-loss',
      severity: 'KRITIS',
      category: 'Profitabilitas Usaha',
      title: 'Perusahaan Mengalami Rugi Usaha',
      detail: `Pendapatan usaha (${formatRp(opRev)}) lebih kecil daripada total biaya usaha langsung & administrasi (${formatRp(opExp)}), menghasilkan Rugi Usaha sebesar ${formatRp(statements.incomeStatement.operatingIncome)}.`,
      metricValue: formatRp(statements.incomeStatement.operatingIncome),
    });
  }

  if (statements.incomeStatement.netIncome < 0) {
    warnings.push({
      id: 'warn-net-loss',
      severity: 'KRITIS',
      category: 'Laba / (Rugi) Bersih',
      title: 'Perusahaan Mengalami Rugi Bersih',
      detail: `Setelah memperhitungkan pendapatan/(beban) lain-lain serta pajak tangguhan, hasil usaha periode ini menunjukkan Rugi Bersih sebesar ${formatRp(statements.incomeStatement.netIncome)}.`,
      metricValue: formatRp(statements.incomeStatement.netIncome),
    });
  }

  if (opRev > 0 && fcrPct < 100) {
    warnings.push({
      id: 'warn-fcr',
      severity: 'KRITIS',
      category: 'Profitabilitas & Pemulihan Biaya',
      title: 'Financial Cost Recovery (FCR) di Bawah 100%',
      detail: 'Pendapatan usaha belum menutupi seluruh biaya operasi. Evaluasi efisiensi energi pompa, NRW, dan penyesuaian penagihan.',
      metricValue: `${fcrPct.toFixed(1)}%`,
    });
  }

  if (opRev > 0 && operatingRatioPct > 90) {
    warnings.push({
      id: 'warn-or',
      severity: operatingRatioPct >= 100 ? 'KRITIS' : 'PERINGATAN',
      category: 'Efisiensi Operasional',
      title: 'Rasio Operasi (Operating Ratio) Tinggi',
      detail: 'Beban operasi melebihi 90% pendapatan operasi (ambang sehat BPKP <= 85%).',
      metricValue: `${operatingRatioPct.toFixed(1)}%`,
    });
  }

  if (curLiab > 0 && cashRatioPct < 50) {
    warnings.push({
      id: 'warn-cash-ratio',
      severity: 'PERINGATAN',
      category: 'Likuiditas Kas',
      title: 'Cash Ratio di Bawah 50%',
      detail: 'Cadangan kas dan bank terhadap kewajiban lancar jangka pendek menipis.',
      metricValue: `${cashRatioPct.toFixed(1)}%`,
    });
  }

  // Overbudget or >= 90% RKA
  rkaItems
    .filter((r) => year === 0 || r.year === year)
    .forEach((r) => {
      const subs = rkaSubItems.filter((s) => s.parentRkaId === r.id);
      const abs = computeRkaAbsorptionForTarget({
        parentRka: r,
        allSubItemsForParent: subs,
        allTransactions: transactions,
      });
      if (abs.isOverBudget) {
        warnings.push({
          id: `warn-rka-over-${r.id}`,
          severity: 'KRITIS',
          category: 'Pengendalian Anggaran RKA',
          title: `Realisasi Melampaui Pagu RKA ${r.code}`,
          detail: `${r.programName} melebihi pagu sebesar ${formatRp(Math.abs(abs.remainingBudget))}.`,
          metricValue: `${abs.absorptionPct.toFixed(1)}%`,
        });
      } else if (abs.absorptionPct >= 90) {
        warnings.push({
          id: `warn-rka-high-${r.id}`,
          severity: 'PERINGATAN',
          category: 'Pengendalian Anggaran RKA',
          title: `Penyerapan RKA ${r.code} Mendekati Batas Pagu`,
          detail: `Sisa anggaran tinggal ${formatRp(abs.remainingBudget)}.`,
          metricValue: `${abs.absorptionPct.toFixed(1)}%`,
        });
      }
    });

  // Overdue Receivables & Payables
  const overdueRp = receivablesPayables.filter(
    (rp) => rp.status !== 'Lunas' && rp.dueDate && rp.dueDate < today
  );
  if (overdueRp.length > 0) {
    const totalOverdue = overdueRp.reduce((s, rp) => s + (rp.remainingAmount || 0), 0);
    warnings.push({
      id: 'warn-rp-overdue',
      severity: 'PERINGATAN',
      category: 'Utang & Piutang Jatuh Tempo',
      title: `${overdueRp.length} Tagihan Utang/Piutang Melewati Jatuh Tempo`,
      detail: 'Segera lakukan penagihan piutang pelanggan atau penjadwalan pelunasan kewajiban rekanan.',
      metricValue: formatRp(totalOverdue),
    });
  }

  // Unpaid Taxes past due
  const unpaidTaxes = taxes.filter((t) => t.status === 'Terutang' && t.dueDate && t.dueDate < today);
  if (unpaidTaxes.length > 0) {
    const totalTaxDue = unpaidTaxes.reduce((s, t) => s + (t.taxAmount || 0), 0);
    warnings.push({
      id: 'warn-tax-overdue',
      severity: 'KRITIS',
      category: 'Kepatuhan Pajak',
      title: `${unpaidTaxes.length} Kewajiban Pajak Terutang Lewat Jatuh Tempo`,
      detail: 'Berisiko terkena denda keterlambatan setor/lapor pajak.',
      metricValue: formatRp(totalTaxDue),
    });
  }

  // Duplicate transaction audit flags
  const dupAlerts = auditTrails.filter((a) => a.duplicateFlag).length;
  if (dupAlerts > 0) {
    warnings.push({
      id: 'warn-dup-tx',
      severity: 'PERINGATAN',
      category: 'Pengendalian Internal (SPI)',
      title: `${dupAlerts} Indikasi Transaksi Ganda Terdeteksi`,
      detail: 'Periksa tab Audit Trail Keuangan untuk memverifikasi keabsahan bukti transaksi.',
      metricValue: `${dupAlerts} temuan`,
    });
  }

  // PDAM Operational & Billing Warnings from Snapshots & Inventory
  const activeSnapshot = pdamSnapshots
    .filter((s) => year === 0 || s.year === year)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  if (activeSnapshot) {
    const totDist = activeSnapshot.productionDistribution.reduce(
      (s, u) => s + (u.distributedM3Monthly || 0),
      0
    );
    const totNrw = activeSnapshot.productionDistribution.reduce(
      (s, u) => s + (u.nrwM3Monthly || 0),
      0
    );
    const nrwPct = totDist > 0 ? (totNrw / totDist) * 100 : 0;
    if (nrwPct > 25) {
      warnings.push({
        id: 'warn-pdam-nrw',
        severity: nrwPct > 30 ? 'KRITIS' : 'PERINGATAN',
        category: 'Produksi & Kehilangan Air (NRW)',
        title: `Tingkat Kehilangan Air (NRW) ${activeSnapshot.month} ${activeSnapshot.year} Melebihi 25%`,
        detail: `NRW rata-rata sebesar ${nrwPct.toFixed(2)}% (ambang Permendagri <= 25%). Fokus pengendalian kebocoran pada unit NRW tertinggi.`,
        metricValue: `${nrwPct.toFixed(1)}%`,
      });
    }

    const totPrevBill = activeSnapshot.collectionEfficiency.reduce(
      (s, u) => s + (u.prevBilling || 0),
      0
    );
    const totCurColl = activeSnapshot.collectionEfficiency.reduce(
      (s, u) => s + (u.currentCollected || 0),
      0
    );
    const effCurPct = totPrevBill > 0 ? (totCurColl / totPrevBill) * 100 : 0;
    if (totPrevBill > 0 && effCurPct < 80) {
      warnings.push({
        id: 'warn-pdam-billing-eff',
        severity: 'PERINGATAN',
        category: 'Efisiensi Penagihan Rekening Air',
        title: `Efisiensi Penagihan Lancar (${activeSnapshot.month}) Di Bawah 80%`,
        detail: `Realisasi penagihan bulan berjalan baru mencapai ${effCurPct.toFixed(2)}% dari ketetapan rekening air.`,
        metricValue: `${effCurPct.toFixed(1)}%`,
      });
    }
  }

  const maxInvYear = inventory.reduce((m, i) => Math.max(m, i.year || 0), 0);
  const effectiveInvYear =
    year === 0
      ? maxInvYear
      : inventory.some((i) => i.year === year)
      ? year
      : maxInvYear;
  const deadStockValue = inventory
    .filter(
      (i) =>
        (effectiveInvYear === 0 || i.year === effectiveInvYear) &&
        (i.coaCode === '15.03.91' || i.category === 'Bahan Instalasi Tidak Bergerak')
    )
    .reduce((s, i) => s + (i.endingValue || 0), 0);
  if (deadStockValue > 0) {
    warnings.push({
      id: 'warn-pdam-deadstock',
      severity: 'INFO',
      category: 'Pengendalian Persediaan Gudang',
      title: 'Terdapat Persediaan Instalasi Tidak Bergerak (Dead Stock)',
      detail: 'Nilai persediaan kode 15.03.91 perlu evaluasi pemanfaatan atau usulan penghapusbukuan.',
      metricValue: formatRp(deadStockValue),
    });
  }

  if (warnings.length === 0) {
    warnings.push({
      id: 'warn-ok',
      severity: 'INFO',
      category: 'Kondisi Keuangan',
      title: 'Indikator Keuangan & Anggaran dalam Kondisi Terkendali',
      detail: 'Tidak ditemukan pelanggaran pagu RKA, keterlambatan pajak, atau anomali likuiditas kritis.',
      metricValue: 'Normal',
    });
  }

  return {
    fcrPct,
    currentRatioPct,
    cashRatioPct,
    operatingRatioPct,
    debtToEquityRatioPct,
    cashFlowProjection,
    warnings,
  };
};
