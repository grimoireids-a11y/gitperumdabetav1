import React, { useMemo } from 'react';
import {
  Wallet,
  Landmark,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Scale,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  ChevronRight,
  Package,
  Droplets,
} from 'lucide-react';
import { RKAItem, RKASubItem } from '../../types/audit';
import {
  FinanceCashBankAccount,
  FinanceGlobalFilter,
  FinanceInventoryItem,
  FinancePdamMonthlySnapshot,
  FinancePurchaseRecord,
  FinanceReceivablePayable,
  FinanceTransaction,
} from '../../types/finance';
import {
  AccountingStatements,
  CashBankComputedAccount,
  FinancialAnalysisResult,
  computeRkaAbsorptionForTarget,
  formatRp,
  matchesGlobalFilter,
} from '../../lib/financeEngine';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';

export type FinanceSubTabId =
  | 'dashboard'
  | 'penerimaan'
  | 'pengeluaran'
  | 'kas_bank'
  | 'akuntansi'
  | 'utang_piutang'
  | 'aset'
  | 'pajak'
  | 'persediaan_pembelian'
  | 'operasional_pdam'
  | 'laporan'
  | 'analisis'
  | 'audit_trail';

interface FinanceDashboardTabProps {
  filter: FinanceGlobalFilter;
  transactions: FinanceTransaction[];
  allTransactions: FinanceTransaction[];
  cashBankSummary: {
    accounts: CashBankComputedAccount[];
    totalCashBalance: number;
    totalBankBalance: number;
    totalLiquidBalance: number;
  };
  cashBankAccounts: FinanceCashBankAccount[];
  statements: AccountingStatements;
  receivablesPayables: FinanceReceivablePayable[];
  rkaItems: RKAItem[];
  rkaSubItems: RKASubItem[];
  analysis: FinancialAnalysisResult;
  pdamSnapshots?: FinancePdamMonthlySnapshot[];
  inventory?: FinanceInventoryItem[];
  purchases?: FinancePurchaseRecord[];
  onNavigateSubTab: (tab: FinanceSubTabId) => void;
}

export const FinanceDashboardTab: React.FC<FinanceDashboardTabProps> = ({
  filter,
  transactions,
  allTransactions,
  cashBankSummary,
  statements,
  receivablesPayables,
  rkaItems,
  rkaSubItems,
  analysis,
  pdamSnapshots = [],
  inventory = [],
  purchases = [],
  onNavigateSubTab,
}) => {
  const postedFilteredTxs = useMemo(
    () =>
      transactions.filter(
        (t) =>
          t.status === 'Disetujui / Diposting' &&
          t.type !== 'TRANSFER' &&
          matchesGlobalFilter(
            {
              year: t.year,
              month: t.month,
              date: t.transactionDate,
              bidang: t.bidangName,
              unitId: t.unitId,
              coaId: t.coaId,
            },
            filter
          )
      ),
    [transactions, filter]
  );

  const totalPenerimaan = useMemo(
    () =>
      postedFilteredTxs
        .filter((t) => t.type === 'PENERIMAAN')
        .reduce((s, t) => s + (t.amount || 0), 0),
    [postedFilteredTxs]
  );

  const totalPengeluaran = useMemo(
    () =>
      postedFilteredTxs
        .filter((t) => t.type === 'PENGELUARAN')
        .reduce((s, t) => s + (t.amount || 0), 0),
    [postedFilteredTxs]
  );

  const pendingApprovals = useMemo(
    () => transactions.filter((t) => t.status === 'Menunggu Persetujuan').length,
    [transactions]
  );

  const openPiutang = useMemo(
    () =>
      receivablesPayables
        .filter(
          (rp) =>
            rp.kind === 'PIUTANG' &&
            rp.status !== 'Lunas' &&
            (filter.year === 0 || rp.year === filter.year) &&
            (filter.unitId === 'ALL' || rp.unitId === filter.unitId)
        )
        .reduce((s, rp) => s + (rp.remainingAmount || 0), 0),
    [receivablesPayables, filter.year, filter.unitId]
  );

  const openUtang = useMemo(
    () =>
      receivablesPayables
        .filter(
          (rp) =>
            rp.kind === 'UTANG' &&
            rp.status !== 'Lunas' &&
            (filter.year === 0 || rp.year === filter.year) &&
            (filter.unitId === 'ALL' || rp.unitId === filter.unitId)
        )
        .reduce((s, rp) => s + (rp.remainingAmount || 0), 0),
    [receivablesPayables, filter.year, filter.unitId]
  );

  // RKA Budget vs Realization (respecting global filters)
  const rkaRows = useMemo(() => {
    return rkaItems
      .filter((r) => {
        if (filter.year !== 0 && r.year !== filter.year) return false;
        if (filter.bidang !== 'ALL' && r.category !== filter.bidang) return false;
        if (filter.unitId !== 'ALL' && r.unitId !== filter.unitId) return false;
        return true;
      })
      .map((r) => {
        const subs = rkaSubItems.filter((s) => s.parentRkaId === r.id);
        const abs = computeRkaAbsorptionForTarget({
          parentRka: r,
          allSubItemsForParent: subs,
          allTransactions,
        });
        return {
          rka: r,
          subCount: subs.length,
          abs,
        };
      })
      .sort((a, b) => b.abs.budgetAmount - a.abs.budgetAmount);
  }, [rkaItems, rkaSubItems, allTransactions, filter.year, filter.bidang, filter.unitId]);

  const rkaTotals = useMemo(() => {
    return rkaRows.reduce(
      (acc, row) => ({
        pagu: acc.pagu + row.abs.budgetAmount,
        realized: acc.realized + row.abs.totalRealization,
        remaining: acc.remaining + row.abs.remainingBudget,
      }),
      { pagu: 0, realized: 0, remaining: 0 }
    );
  }, [rkaRows]);

  const rkaPct =
    rkaTotals.pagu > 0 ? Math.round((rkaTotals.realized / rkaTotals.pagu) * 1000) / 10 : 0;

  // Monthly Cash Flow Chart (Januari - Desember)
  const monthlyCashFlow = useMemo(() => {
    const yearFiltered = transactions.filter(
      (t) =>
        t.status === 'Disetujui / Diposting' &&
        t.type !== 'TRANSFER' &&
        (filter.year === 0 || t.year === filter.year) &&
        (filter.unitId === 'ALL' || t.unitId === filter.unitId) &&
        (filter.bidang === 'ALL' || t.bidangName === filter.bidang) &&
        (filter.coaId === 'ALL' || t.coaId === filter.coaId)
    );

    const rows = FISCAL_MONTHS.map((m) => {
      const inflow = yearFiltered
        .filter((t) => t.month === m && t.type === 'PENERIMAAN')
        .reduce((s, t) => s + (t.amount || 0), 0);
      const outflow = yearFiltered
        .filter((t) => t.month === m && t.type === 'PENGELUARAN')
        .reduce((s, t) => s + (t.amount || 0), 0);
      return {
        month: m,
        short: m.slice(0, 3),
        inflow,
        outflow,
        net: inflow - outflow,
      };
    });

    const maxVal = Math.max(
      1,
      ...rows.map((r) => Math.max(r.inflow, r.outflow))
    );
    return { rows, maxVal };
  }, [transactions, filter.year, filter.unitId, filter.bidang, filter.coaId]);

  const netIncome = statements.incomeStatement.netIncome;

  const activePdamSnapshot = useMemo(() => {
    const candidates = pdamSnapshots.filter(
      (s) =>
        (filter.year === 0 || s.year === filter.year) &&
        (filter.month === 'ALL' || s.month.toLowerCase() === filter.month.toLowerCase())
    );
    const list = candidates.length > 0 ? candidates : pdamSnapshots;
    return [...list].sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      const months = FISCAL_MONTHS as readonly string[];
      return months.indexOf(b.month) - months.indexOf(a.month);
    })[0];
  }, [pdamSnapshots, filter.year, filter.month]);

  const pdamKpis = useMemo(() => {
    const invFiltered = inventory.filter(
      (i) =>
        (filter.year === 0 || i.year === filter.year) &&
        (filter.unitId === 'ALL' || !i.unitId || i.unitId === filter.unitId)
    );
    const totalInventoryVal = invFiltered.reduce((s, i) => s + (i.endingValue || 0), 0);

    const purFiltered = purchases.filter(
      (p) =>
        (filter.year === 0 || p.year === filter.year) &&
        (filter.month === 'ALL' || p.month.toLowerCase() === filter.month.toLowerCase())
    );
    const totalPurchasesVal = purFiltered.reduce((s, p) => s + (p.amount || 0), 0);

    if (!activePdamSnapshot) {
      return {
        hasSnapshot: false,
        periodText: 'Belum Dimuat',
        billingEffTotalPct: 0,
        billingEffCurrentPct: 0,
        nrwPct: 0,
        activeCustomers: 0,
        totalInventoryVal,
        totalPurchasesVal,
      };
    }

    const totPrevBill = activePdamSnapshot.collectionEfficiency.reduce(
      (s, u) => s + (u.prevBilling || 0),
      0
    );
    const totCurColl = activePdamSnapshot.collectionEfficiency.reduce(
      (s, u) => s + (u.currentCollected || 0),
      0
    );
    const totAllColl = activePdamSnapshot.collectionEfficiency.reduce(
      (s, u) => s + (u.totalCollected || 0),
      0
    );
    const billingEffTotalPct = totPrevBill > 0 ? (totAllColl / totPrevBill) * 100 : 0;
    const billingEffCurrentPct = totPrevBill > 0 ? (totCurColl / totPrevBill) * 100 : 0;

    const totDist = activePdamSnapshot.productionDistribution.reduce(
      (s, u) => s + (u.distributedM3Monthly || 0),
      0
    );
    const totNrw = activePdamSnapshot.productionDistribution.reduce(
      (s, u) => s + (u.nrwM3Monthly || 0),
      0
    );
    const nrwPct = totDist > 0 ? (totNrw / totDist) * 100 : 0;

    const activeCustomers = activePdamSnapshot.customerConnections.reduce(
      (s, c) => s + (c.endingActive || 0),
      0
    );

    return {
      hasSnapshot: true,
      periodText: `${activePdamSnapshot.month} ${activePdamSnapshot.year}`,
      billingEffTotalPct,
      billingEffCurrentPct,
      nrwPct,
      activeCustomers,
      totalInventoryVal,
      totalPurchasesVal,
    };
  }, [activePdamSnapshot, inventory, purchases, filter.year, filter.month, filter.unitId]);

  return (
    <div className="space-y-5">
      {/* Early Warning Strip */}
      {analysis.warnings.some((w) => w.severity !== 'INFO') && (
        <div className="bg-amber-50/90 border border-amber-300 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-950">
                Peringatan Dini Keuangan & Pengendalian RKA ({analysis.warnings.filter((w) => w.severity !== 'INFO').length} temuan aktif)
              </p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                {analysis.warnings[0]?.title} — {analysis.warnings[0]?.detail}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateSubTab('analisis')}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-amber-950 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Lihat Early Warning</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Row 1: Primary Liquidity & Cash Flow KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Saldo Kas (Tunai & Kas Kecil)</span>
            <Wallet className="w-4 h-4 text-emerald-700 shrink-0" />
          </div>
          <p className="mt-2 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {formatRp(cashBankSummary.totalCashBalance)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {cashBankSummary.accounts.filter((a) => a.accountKind !== 'BANK').length} rekening kas aktif
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Saldo Bank</span>
            <Landmark className="w-4 h-4 text-teal-700 shrink-0" />
          </div>
          <p className="mt-2 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {formatRp(cashBankSummary.totalBankBalance)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Likuiditas total: <span className="font-mono font-semibold text-slate-700">{formatRp(cashBankSummary.totalLiquidBalance)}</span>
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Total Penerimaan (Terposting)</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-600 shrink-0" />
          </div>
          <p className="mt-2 text-lg font-bold text-emerald-800 font-mono tabular-nums">
            {formatRp(totalPenerimaan)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {postedFilteredTxs.filter((t) => t.type === 'PENERIMAAN').length} transaksi kas masuk
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Total Pengeluaran (Terposting)</span>
            <ArrowUpRight className="w-4 h-4 text-rose-600 shrink-0" />
          </div>
          <p className="mt-2 text-lg font-bold text-rose-700 font-mono tabular-nums">
            {formatRp(totalPengeluaran)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {postedFilteredTxs.filter((t) => t.type === 'PENGELUARAN').length} transaksi kas keluar
            {pendingApprovals > 0 ? ` · ${pendingApprovals} menunggu verifikasi` : ''}
          </p>
        </div>
      </div>

      {/* Row 2: Accrual Accounting & AR/AP & RKA Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
            <span>Pendapatan (Akuntansi)</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <p className="mt-1.5 text-base font-bold text-slate-900 font-mono tabular-nums">
            {formatRp(statements.incomeStatement.totalRevenue)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
            <span>Biaya / Beban</span>
            <TrendingDown className="w-3.5 h-3.5 text-rose-600" />
          </div>
          <p className="mt-1.5 text-base font-bold text-slate-900 font-mono tabular-nums">
            {formatRp(statements.incomeStatement.totalExpense)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
            <span>Laba / (Rugi) Bersih</span>
            <Scale className="w-3.5 h-3.5 text-slate-600" />
          </div>
          <p
            className={`mt-1.5 text-base font-bold font-mono tabular-nums ${
              netIncome >= 0 ? 'text-emerald-800' : 'text-rose-700'
            }`}
          >
            {formatRp(netIncome)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
            <span>Saldo Piutang Usaha</span>
            <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
          </div>
          <p className="mt-1.5 text-base font-bold text-slate-900 font-mono tabular-nums">
            {formatRp(openPiutang)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-semibold">
            <span>Saldo Utang Usaha</span>
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <p className="mt-1.5 text-base font-bold text-slate-900 font-mono tabular-nums">
            {formatRp(openUtang)}
          </p>
        </div>
      </div>

      {/* Row 2B: Ringkasan Operasional PDAM, Penagihan & Persediaan */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <Droplets className="w-4 h-4 text-emerald-700 shrink-0" />
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                Ringkasan Operasional PDAM, Penagihan & Gudang ({pdamKpis.periodText})
              </h3>
              <p className="text-[11px] text-slate-500">
                Indikator kinerja teknik, efisiensi penagihan rekening air, persediaan kimia/pipa, dan nilai buku aktiva tetap
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigateSubTab('persediaan_pembelian')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer"
            >
              <Package className="w-3.5 h-3.5 text-emerald-700" />
              <span>Persediaan & Pembelian</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateSubTab('operasional_pdam')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
            >
              <Droplets className="w-3.5 h-3.5 text-emerald-700" />
              <span>{pdamKpis.hasSnapshot ? 'Kelola Data Operasional PDAM' : 'Muat Baseline PDAM Sep 2026'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="p-3 bg-slate-50/80 border border-slate-200/80 rounded-lg">
            <span className="text-[11px] text-slate-500 font-semibold block">
              Efisiensi Penagihan Air
            </span>
            <p
              className={`mt-1 text-base font-bold font-mono tabular-nums ${
                pdamKpis.billingEffTotalPct >= 90 ? 'text-emerald-800' : 'text-amber-700'
              }`}
            >
              {pdamKpis.hasSnapshot ? `${pdamKpis.billingEffTotalPct.toFixed(2)}%` : '-'}
            </p>
            <span className="text-[10px] text-slate-500">
              {pdamKpis.hasSnapshot
                ? `Lancar bln berjalan: ${pdamKpis.billingEffCurrentPct.toFixed(2)}%`
                : 'Belum ada snapshot bulanan'}
            </span>
          </div>

          <div className="p-3 bg-slate-50/80 border border-slate-200/80 rounded-lg">
            <span className="text-[11px] text-slate-500 font-semibold block">
              Kehilangan Air (NRW)
            </span>
            <p
              className={`mt-1 text-base font-bold font-mono tabular-nums ${
                pdamKpis.nrwPct <= 25 ? 'text-emerald-800' : 'text-rose-700'
              }`}
            >
              {pdamKpis.hasSnapshot ? `${pdamKpis.nrwPct.toFixed(2)}%` : '-'}
            </p>
            <span className="text-[10px] text-slate-500">
              Ambang batas sehat ≤ 25%
            </span>
          </div>

          <div className="p-3 bg-slate-50/80 border border-slate-200/80 rounded-lg">
            <span className="text-[11px] text-slate-500 font-semibold block">
              Pelanggan Aktif (SR)
            </span>
            <p className="mt-1 text-base font-bold text-slate-900 font-mono tabular-nums">
              {pdamKpis.hasSnapshot ? `${pdamKpis.activeCustomers.toLocaleString('id-ID')} SR` : '-'}
            </p>
            <span className="text-[10px] text-slate-500">
              11 Unit Pelayanan Pasaman
            </span>
          </div>

          <div className="p-3 bg-slate-50/80 border border-slate-200/80 rounded-lg">
            <span className="text-[11px] text-slate-500 font-semibold block">
              Persediaan Kimia & Instalasi
            </span>
            <p className="mt-1 text-base font-bold text-slate-900 font-mono tabular-nums">
              {formatRp(pdamKpis.totalInventoryVal)}
            </p>
            <span className="text-[10px] text-slate-500">
              Pembelian terfilter: {formatRp(pdamKpis.totalPurchasesVal)}
            </span>
          </div>

          <div className="p-3 bg-slate-50/80 border border-slate-200/80 rounded-lg">
            <span className="text-[11px] text-slate-500 font-semibold block">
              Aktiva Tetap Bersih (NBV)
            </span>
            <p className="mt-1 text-base font-bold text-slate-900 font-mono tabular-nums">
              {formatRp(statements.balanceSheet.netFixedAssets)}
            </p>
            <span className="text-[10px] text-slate-500">
              Setelah akumulasi penyusutan
            </span>
          </div>
        </div>
      </div>

      {/* Row 3: Monthly Cash Flow Chart + RKA Absorption Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Cash Flow Chart */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Grafik Arus Kas Bulanan ({filter.year === 0 ? 'Semua Tahun' : `TA ${filter.year}`})
              </h3>
              <p className="text-[11px] text-slate-500">
                Perbandingan penerimaan kas masuk vs pengeluaran kas keluar terposting
              </p>
            </div>
            <div className="flex items-center gap-4 text-[11px] font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600 inline-block" />
                Penerimaan
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                Pengeluaran
              </span>
            </div>
          </div>

          <div className="mt-4 flex-1 grid grid-cols-12 gap-1.5 items-end min-h-[210px] pt-4">
            {monthlyCashFlow.rows.map((m) => {
              const inH = Math.max(2, Math.round((m.inflow / monthlyCashFlow.maxVal) * 165));
              const outH = Math.max(2, Math.round((m.outflow / monthlyCashFlow.maxVal) * 165));
              const isSelectedMonth =
                filter.month !== 'ALL' && filter.month.toLowerCase() === m.month.toLowerCase();
              return (
                <div
                  key={m.month}
                  className={`flex flex-col items-center gap-1.5 px-0.5 py-1 rounded-lg ${
                    isSelectedMonth ? 'bg-emerald-50 ring-1 ring-emerald-300' : ''
                  }`}
                  title={`${m.month}: Masuk ${formatRp(m.inflow)} | Keluar ${formatRp(m.outflow)} | Bersih ${formatRp(m.net)}`}
                >
                  <div className="w-full h-[170px] flex items-end justify-center gap-1">
                    <div
                      className="w-2.5 sm:w-3 bg-emerald-600 rounded-t-xs transition-all"
                      style={{ height: `${m.inflow > 0 ? inH : 2}px` }}
                    />
                    <div
                      className="w-2.5 sm:w-3 bg-rose-500 rounded-t-xs transition-all"
                      style={{ height: `${m.outflow > 0 ? outH : 2}px` }}
                    />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-600">{m.short}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* RKA Summary Card */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Realisasi Anggaran RKA Existing
                </h3>
                <p className="text-[11px] text-slate-500">
                  Integrasi langsung dari pos induk RKA tanpa penghitungan ganda
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateSubTab('pengeluaran')}
                className="px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                + Pengeluaran RKA
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Total Pagu RKA Terfilter</span>
                <span className="font-bold text-slate-900 font-mono tabular-nums">
                  {formatRp(rkaTotals.pagu)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Total Realisasi Anggaran</span>
                <span className="font-bold text-emerald-800 font-mono tabular-nums">
                  {formatRp(rkaTotals.realized)} ({rkaPct}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Sisa Anggaran Tersedia</span>
                <span
                  className={`font-bold font-mono tabular-nums ${
                    rkaTotals.remaining < 0 ? 'text-rose-700' : 'text-slate-900'
                  }`}
                >
                  {formatRp(rkaTotals.remaining)}
                </span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div
                  className={`h-full transition-all ${
                    rkaPct > 100
                      ? 'bg-rose-600'
                      : rkaPct >= 85
                      ? 'bg-amber-500'
                      : 'bg-emerald-600'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, rkaPct))}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-slate-500 block">Cost Recovery (FCR)</span>
              <span
                className={`text-sm font-bold font-mono tabular-nums ${
                  analysis.fcrPct >= 100 ? 'text-emerald-800' : 'text-rose-700'
                }`}
              >
                {analysis.fcrPct.toFixed(1)}%
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-slate-500 block">Operating Ratio</span>
              <span
                className={`text-sm font-bold font-mono tabular-nums ${
                  analysis.operatingRatioPct <= 85 ? 'text-emerald-800' : 'text-amber-700'
                }`}
              >
                {analysis.operatingRatioPct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 4: RKA Monitoring Matrix Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-slate-900">
              Monitoring Penyerapan Pos Anggaran RKA Existing
            </h3>
            <p className="text-[11px] text-slate-500">
              Rumus: Sisa Anggaran = Pagu − Total Realisasi · Persentase = Total Realisasi / Pagu × 100%
            </p>
          </div>
          <span className="text-[11px] font-semibold text-slate-600">
            {rkaRows.length} Pos RKA
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-3">Kode & Kegiatan RKA</th>
                <th className="py-2.5 px-3">Bidang / Unit</th>
                <th className="py-2.5 px-3 text-right">Pagu Anggaran</th>
                <th className="py-2.5 px-3 text-right">Realisasi Sebelumnya</th>
                <th className="py-2.5 px-3 text-right">Transaksi Keuangan</th>
                <th className="py-2.5 px-3 text-right">Total Realisasi</th>
                <th className="py-2.5 px-3 text-right">Sisa Anggaran</th>
                <th className="py-2.5 px-3 text-right">% Serap</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rkaRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Tidak ada pos RKA untuk filter tahun/bidang/unit terpilih.
                  </td>
                </tr>
              ) : (
                rkaRows.slice(0, 12).map(({ rka, abs }) => (
                  <tr key={rka.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3">
                      <div className="font-mono text-[11px] font-bold text-emerald-800">
                        {rka.code} · {rka.status}
                      </div>
                      <div className="font-medium text-slate-900 line-clamp-1">
                        {rka.programName}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      <div className="font-medium">{rka.category}</div>
                      <div className="text-[11px] text-slate-500">{rka.unitName}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatRp(abs.budgetAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                      {formatRp(abs.baselineRealization)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-teal-800">
                      {formatRp(abs.postedFinanceRealization)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatRp(abs.totalRealization)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                        abs.remainingBudget < 0 ? 'text-rose-700' : 'text-emerald-800'
                      }`}
                    >
                      {formatRp(abs.remainingBudget)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${
                          abs.isOverBudget
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : abs.absorptionPct >= 85
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {abs.absorptionPct >= 100 ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : null}
                        {abs.absorptionPct.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
