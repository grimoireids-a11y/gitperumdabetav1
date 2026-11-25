import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  BookOpen,
  FileSpreadsheet,
  Building2,
  Receipt,
  FileText,
  Activity,
  History,
  Filter,
  RotateCcw,
  Package,
  Droplets,
  Database,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { RKAItem, RKASubItem, Unit } from '../../types/audit';
import {
  FinanceAccount,
  FinanceAsset,
  FinanceAuditTrail,
  FinanceBankReconciliation,
  FinanceCashBankAccount,
  FinanceGlobalFilter,
  FinanceInventoryItem,
  FinanceJournal,
  FinancePdamMonthlySnapshot,
  FinancePeriodClose,
  FinancePurchaseRecord,
  FinanceReceivablePayable,
  FinanceTaxRecord,
  FinanceTransaction,
} from '../../types/finance';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import {
  computeAccountingStatements,
  computeCashBankBalances,
  computeFinancialAnalysisAndWarnings,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import {
  clearAndSeedJan2026Baseline,
  hasJan2026BaselineMarker,
} from '../../lib/financeBaselineReset';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';
import { FinanceDashboardTab, FinanceSubTabId } from './FinanceDashboardTab';
import { FinanceTransactionsTab } from './FinanceTransactionsTab';
import { FinanceCashBankTab } from './FinanceCashBankTab';
import { FinanceAccountingTab } from './FinanceAccountingTab';
import { FinanceReceivablesPayablesTab } from './FinanceReceivablesPayablesTab';
import { FinanceAssetsTaxTab } from './FinanceAssetsTaxTab';
import { FinanceInventoryPurchaseTab } from './FinanceInventoryPurchaseTab';
import { FinanceOperationsBillingTab } from './FinanceOperationsBillingTab';
import { FinanceReportsAnalysisTab } from './FinanceReportsAnalysisTab';
import { FinanceAuditTrailTab } from './FinanceAuditTrailTab';

const FINANCE_TABS: {
  id: FinanceSubTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'dashboard', label: 'Dashboard Keuangan', icon: LayoutDashboard },
  { id: 'penerimaan', label: 'Penerimaan', icon: ArrowDownLeft },
  { id: 'pengeluaran', label: 'Pengeluaran (RKA)', icon: ArrowUpRight },
  { id: 'kas_bank', label: 'Kas & Bank', icon: Landmark },
  { id: 'akuntansi', label: 'Akuntansi & COA', icon: BookOpen },
  { id: 'utang_piutang', label: 'Utang & Piutang', icon: FileSpreadsheet },
  { id: 'aset', label: 'Aset', icon: Building2 },
  { id: 'pajak', label: 'Pajak', icon: Receipt },
  { id: 'persediaan_pembelian', label: 'Persediaan & Pembelian', icon: Package },
  { id: 'operasional_pdam', label: 'Operasional & Penagihan PDAM', icon: Droplets },
  { id: 'laporan', label: 'Laporan', icon: FileText },
  { id: 'analisis', label: 'Analisis & Warning', icon: Activity },
  { id: 'audit_trail', label: 'Audit Trail', icon: History },
];

export const FinanceModule: React.FC = () => {
  const { userProfile, hasRole } = useAuth();
  const { activeYear, availableYears } = useFiscalYear();

  const [activeSubTab, setActiveSubTab] = useState<FinanceSubTabId>('dashboard');
  const [filter, setFilter] = useState<FinanceGlobalFilter>({
    year: activeYear,
    month: 'ALL',
    dateFrom: '',
    dateTo: '',
    bidang: 'ALL',
    unitId: 'ALL',
    coaId: 'ALL',
  });

  // Keep global year filter synchronized when navbar FiscalYear changes
  useEffect(() => {
    setFilter((prev) => ({ ...prev, year: activeYear }));
  }, [activeYear]);

  // Existing Collections (Read Integration)
  const [rkaItems, setRkaItems] = useState<RKAItem[]>([]);
  const [rkaSubItems, setRkaSubItems] = useState<RKASubItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  // Finance Collections
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [cashBankAccounts, setCashBankAccounts] = useState<FinanceCashBankAccount[]>([]);
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

  useEffect(() => {
    const unsubs = [
      onSnapshot(collection(db, 'rka_items'), (snap) => {
        setRkaItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RKAItem)));
      }),
      onSnapshot(collection(db, 'rka_sub_items'), (snap) => {
        setRkaSubItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RKASubItem)));
      }),
      onSnapshot(collection(db, 'units'), (snap) => {
        setUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Unit)));
      }),
      onSnapshot(collection(db, 'fin_accounts'), (snap) => {
        setAccounts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceAccount)));
      }),
      onSnapshot(collection(db, 'fin_cash_banks'), (snap) => {
        setCashBankAccounts(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceCashBankAccount))
        );
      }),
      onSnapshot(collection(db, 'fin_transactions'), (snap) => {
        setTransactions(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceTransaction))
        );
      }),
      onSnapshot(collection(db, 'fin_bank_reconciliations'), (snap) => {
        setReconciliations(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceBankReconciliation))
        );
      }),
      onSnapshot(collection(db, 'fin_journals'), (snap) => {
        setJournals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceJournal)));
      }),
      onSnapshot(collection(db, 'fin_period_closes'), (snap) => {
        setPeriodCloses(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePeriodClose))
        );
      }),
      onSnapshot(collection(db, 'fin_receivables_payables'), (snap) => {
        setReceivablesPayables(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceReceivablePayable))
        );
      }),
      onSnapshot(collection(db, 'fin_assets'), (snap) => {
        setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceAsset)));
      }),
      onSnapshot(collection(db, 'fin_taxes'), (snap) => {
        setTaxes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceTaxRecord)));
      }),
      onSnapshot(collection(db, 'fin_inventory'), (snap) => {
        setInventory(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceInventoryItem)));
      }),
      onSnapshot(collection(db, 'fin_purchases'), (snap) => {
        setPurchases(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePurchaseRecord)));
      }),
      onSnapshot(collection(db, 'fin_pdam_reports'), (snap) => {
        setPdamSnapshots(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinancePdamMonthlySnapshot))
        );
      }),
      onSnapshot(collection(db, 'fin_audit_trails'), (snap) => {
        setAuditTrails(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as FinanceAuditTrail))
        );
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Reuse Existing Role Permissions (No New Role/User Tables)
  const permissions: FinancePermissions = useMemo(() => {
    const canOperate = hasRole(['BIDANG_KEUANGAN', 'KEPALA_SPI', 'ADMIN_SISTEM']);
    const canApprove = hasRole([
      'BIDANG_KEUANGAN',
      'DIREKTUR',
      'KEPALA_SPI',
      'ADMIN_SISTEM',
    ]);
    const canClosePeriod = canApprove;
    const canAudit = hasRole(['KEPALA_SPI', 'AUDITOR', 'ADMIN_SISTEM', 'DEWAN_PENGAWAS']);
    const isSuperUser = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);
    return {
      canOperate,
      canApprove,
      canClosePeriod,
      canAudit,
      isSuperUser,
      isReadOnly: !canOperate && !canApprove,
    };
  }, [hasRole]);

  const actor: FinanceActor = useMemo(
    () => ({
      uid: userProfile?.uid || 'anon',
      displayName: userProfile?.displayName || 'Pengguna',
      role: userProfile?.role || 'VIEWER',
      unitId: userProfile?.unitId,
      unitName: userProfile?.unitName,
    }),
    [userProfile]
  );

  const [baselineSyncing, setBaselineSyncing] = useState(false);
  const [baselineNotice, setBaselineNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const autoSeedCheckedRef = useRef(false);

  // Automatic one-time reset & seed for January 2026 official baseline
  useEffect(() => {
    if (autoSeedCheckedRef.current) return;
    if (!userProfile?.uid) return;
    if (!permissions.canOperate && !permissions.isSuperUser) return;
    autoSeedCheckedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const alreadySeeded = await hasJan2026BaselineMarker();
        if (alreadySeeded || cancelled) return;
        setBaselineSyncing(true);
        const result = await clearAndSeedJan2026Baseline({
          actorUid: actor.uid,
          actorName: actor.displayName,
          actorRole: actor.role,
          year: 2026,
        });
        if (!cancelled) {
          setBaselineNotice({
            type: 'success',
            message: `Baseline Manajemen Keuangan Desember 2025 (Data Awal) & Januari 2026 aktif (${result.deletedCount} data lama dibersihkan; ${result.seededCounts.coa} COA, ${result.seededCounts.cashBanks} Kas/Bank, ${result.seededCounts.receivablesPayables} Utang/Piutang, ${result.seededCounts.assets} Aset, ${result.seededCounts.taxes} Pajak, ${result.seededCounts.inventory} Persediaan, ${result.seededCounts.purchases} Pembelian & ${result.seededCounts.pdamReports} Laporan PDAM dimuat).`,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setBaselineNotice({
            type: 'error',
            message: `Gagal menginisialisasi baseline Des 2025 / Jan 2026: ${
              err instanceof Error ? err.message : 'Error'
            }`,
          });
        }
      } finally {
        if (!cancelled) setBaselineSyncing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userProfile?.uid, permissions.canOperate, permissions.isSuperUser, actor.uid, actor.displayName, actor.role]);

  const handleManualResetJan2026 = async () => {
    setBaselineSyncing(true);
    try {
      const result = await clearAndSeedJan2026Baseline({
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        year: 2026,
      });
      setIsResetModalOpen(false);
      setBaselineNotice({
        type: 'success',
        message: `Data keuangan berhasil dikosongkan (${result.deletedCount} dokumen) dan diisi ulang dengan Baseline Resmi Desember 2025 (Data Awal) & Januari 2026.`,
      });
    } catch (err) {
      setBaselineNotice({
        type: 'error',
        message: `Gagal mereset baseline Des 2025 / Jan 2026: ${
          err instanceof Error ? err.message : 'Error'
        }`,
      });
    } finally {
      setBaselineSyncing(false);
    }
  };

  const logFinanceAudit: LogFinanceAuditFn = async (input) => {
    const now = new Date().toISOString();
    const id = `faud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const record: FinanceAuditTrail = sanitizeFirestoreRecord({
      id,
      timestamp: now,
      actorUid: actor.uid,
      actorName: actor.displayName,
      actorRole: actor.role,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      summary: input.summary,
      beforeData: input.beforeData || null,
      afterData: input.afterData || null,
      approvalNotes: input.approvalNotes,
      duplicateFlag: input.duplicateFlag,
      year: input.year || (filter.year !== 0 ? filter.year : activeYear),
    });
    await setDoc(doc(db, 'fin_audit_trails', id), record);
  };

  // Bidang dropdown options combined from RKA & Transactions
  const bidangOptions = useMemo(() => {
    const set = new Set<string>();
    rkaItems.forEach((r) => {
      if (r.category) set.add(r.category);
    });
    transactions.forEach((t) => {
      if (t.bidangName) set.add(t.bidangName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rkaItems, transactions]);

  const coaFilterOptions = useMemo(() => {
    const maxYear = accounts
      .filter((a) => a.isActive !== false && typeof a.year === 'number')
      .reduce((m, a) => Math.max(m, a.year || 0), 0);
    const effectiveYear =
      filter.year === 0
        ? maxYear
        : accounts.some((a) => a.isActive !== false && a.year === filter.year)
        ? filter.year
        : maxYear;
    const list = accounts.filter(
      (a) => a.isActive !== false && (effectiveYear === 0 || a.year === effectiveYear)
    );
    return (list.length > 0 ? list : accounts).sort((a, b) => a.code.localeCompare(b.code));
  }, [accounts, filter.year]);

  // Real-time Engines
  const cashBankSummary = useMemo(
    () =>
      computeCashBankBalances(
        cashBankAccounts,
        transactions,
        filter.dateTo || undefined,
        filter.year
      ),
    [cashBankAccounts, transactions, filter.dateTo, filter.year]
  );

  const statements = useMemo(
    () =>
      computeAccountingStatements({
        accounts,
        journals,
        transactions,
        yearFilter: filter.year,
      }),
    [accounts, journals, transactions, filter.year]
  );

  const analysis = useMemo(
    () =>
      computeFinancialAnalysisAndWarnings({
        statements,
        totalCashAndBank: cashBankSummary.totalLiquidBalance,
        transactions,
        receivablesPayables,
        taxes,
        rkaItems,
        rkaSubItems,
        assets,
        auditTrails,
        year: filter.year,
        pdamSnapshots,
        inventory,
      }),
    [
      statements,
      cashBankSummary.totalLiquidBalance,
      transactions,
      receivablesPayables,
      taxes,
      rkaItems,
      rkaSubItems,
      assets,
      auditTrails,
      filter.year,
      pdamSnapshots,
      inventory,
    ]
  );

  const resetFilters = () => {
    setFilter({
      year: activeYear,
      month: 'ALL',
      dateFrom: '',
      dateTo: '',
      bidang: 'ALL',
      unitId: 'ALL',
      coaId: 'ALL',
    });
  };

  return (
    <div className="space-y-4">
      {/* Global 6-Dimension Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <Filter className="w-3.5 h-3.5 text-emerald-700" />
            <span>Filter Terpadu Modul Keuangan & Realisasi RKA</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
            {permissions.isSuperUser && (
              <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded font-semibold text-emerald-800">
                Super User: Akses Penuh Edit & Hapus Data
              </span>
            )}
            {permissions.isReadOnly && (
              <span className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded font-semibold text-slate-700">
                Mode Pantau (Baca / Cetak)
              </span>
            )}
            {(permissions.canOperate || permissions.isSuperUser) && (
              <button
                type="button"
                disabled={baselineSyncing}
                onClick={() => setIsResetModalOpen(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {baselineSyncing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Database className="w-3 h-3" />
                )}
                <span>Reset Baseline Des 25 / Jan 26</span>
              </button>
            )}
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filter</span>
            </button>
          </div>
        </div>

        {(baselineSyncing || baselineNotice) && (
          <div
            className={`px-3 py-2 rounded-lg border text-[11px] flex items-center justify-between gap-2 ${
              baselineNotice?.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {baselineSyncing && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}
              <span>
                {baselineSyncing
                  ? 'Mengosongkan data lama & mengisi lengkap Baseline Desember 2025 (Data Awal) dan Januari 2026...'
                  : baselineNotice?.message}
              </span>
            </div>
            {!baselineSyncing && baselineNotice && (
              <button
                type="button"
                onClick={() => setBaselineNotice(null)}
                className="underline font-semibold shrink-0 cursor-pointer"
              >
                Tutup
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
              Tahun Anggaran
            </label>
            <select
              value={filter.year}
              onChange={(e) => setFilter({ ...filter, year: parseInt(e.target.value, 10) })}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-semibold"
            >
              <option value={0}>Semua Tahun</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  TA {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
              Bulan
            </label>
            <select
              value={filter.month}
              onChange={(e) => setFilter({ ...filter, month: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="ALL">Semua Bulan</option>
              {FISCAL_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
              Rentang Tanggal
            </label>
            <div className="grid grid-cols-2 gap-1">
              <input
                type="date"
                value={filter.dateFrom}
                onChange={(e) => setFilter({ ...filter, dateFrom: e.target.value })}
                className="w-full px-1.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px]"
                title="Dari Tanggal"
              />
              <input
                type="date"
                value={filter.dateTo}
                onChange={(e) => setFilter({ ...filter, dateTo: e.target.value })}
                className="w-full px-1.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px]"
                title="Sampai Tanggal"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
              Bidang / Kategori RKA
            </label>
            <select
              value={filter.bidang}
              onChange={(e) => setFilter({ ...filter, bidang: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="ALL">Semua Bidang</option>
              {bidangOptions.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
              Unit Kerja / Pelayanan
            </label>
            <select
              value={filter.unitId}
              onChange={(e) => setFilter({ ...filter, unitId: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="ALL">Semua Unit</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
              Kode Rekening (COA)
            </label>
            <select
              value={filter.coaId}
              onChange={(e) => setFilter({ ...filter, coaId: e.target.value })}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="ALL">Semua Kode Rekening</option>
              {coaFilterOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} - {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 11 Sub-Feature Navigation Bar (A - K) */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 flex items-center gap-1 overflow-x-auto">
        {FINANCE_TABS.map((t) => {
          const Icon = t.icon;
          const active = activeSubTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveSubTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-emerald-700 text-white shadow-2xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Sub-Module Content */}
      {activeSubTab === 'dashboard' && (
        <FinanceDashboardTab
          filter={filter}
          transactions={transactions}
          allTransactions={transactions}
          cashBankSummary={cashBankSummary}
          cashBankAccounts={cashBankAccounts}
          statements={statements}
          receivablesPayables={receivablesPayables}
          rkaItems={rkaItems}
          rkaSubItems={rkaSubItems}
          analysis={analysis}
          pdamSnapshots={pdamSnapshots}
          inventory={inventory}
          purchases={purchases}
          onNavigateSubTab={setActiveSubTab}
        />
      )}

      {(activeSubTab === 'penerimaan' || activeSubTab === 'pengeluaran') && (
        <FinanceTransactionsTab
          mode={activeSubTab === 'penerimaan' ? 'PENERIMAAN' : 'PENGELUARAN'}
          filter={filter}
          transactions={transactions}
          allTransactions={transactions}
          accounts={accounts}
          cashBankAccounts={cashBankAccounts}
          periodCloses={periodCloses}
          rkaItems={rkaItems}
          rkaSubItems={rkaSubItems}
          units={units}
          actor={actor}
          permissions={permissions}
          onLogAudit={logFinanceAudit}
        />
      )}

      {activeSubTab === 'kas_bank' && (
        <FinanceCashBankTab
          filter={filter}
          cashBankSummary={cashBankSummary}
          transactions={transactions}
          accounts={accounts}
          reconciliations={reconciliations}
          periodCloses={periodCloses}
          units={units}
          actor={actor}
          permissions={permissions}
          onLogAudit={logFinanceAudit}
        />
      )}

      {activeSubTab === 'akuntansi' && (
        <FinanceAccountingTab
          filter={filter}
          accounts={accounts}
          journals={journals}
          periodCloses={periodCloses}
          statements={statements}
          actor={actor}
          permissions={permissions}
          onLogAudit={logFinanceAudit}
        />
      )}

      {activeSubTab === 'utang_piutang' && (
        <FinanceReceivablesPayablesTab
          filter={filter}
          records={receivablesPayables}
          accounts={accounts}
          cashBankAccounts={cashBankAccounts}
          units={units}
          actor={actor}
          permissions={permissions}
          onLogAudit={logFinanceAudit}
        />
      )}

      {(activeSubTab === 'aset' || activeSubTab === 'pajak') && (
        <FinanceAssetsTaxTab
          mode={activeSubTab === 'aset' ? 'ASSETS' : 'TAXES'}
          filter={filter}
          assets={assets}
          taxes={taxes}
          accounts={accounts}
          cashBankAccounts={cashBankAccounts}
          rkaItems={rkaItems}
          units={units}
          actor={actor}
          permissions={permissions}
          onLogAudit={logFinanceAudit}
        />
      )}

      {activeSubTab === 'persediaan_pembelian' && (
        <FinanceInventoryPurchaseTab
          filter={filter}
          inventory={inventory}
          purchases={purchases}
          rkaItems={rkaItems}
          units={units}
          actor={actor}
          permissions={permissions}
          onLogAudit={logFinanceAudit}
        />
      )}

      {activeSubTab === 'operasional_pdam' && (
        <FinanceOperationsBillingTab
          filter={filter}
          snapshots={pdamSnapshots}
          actor={actor}
          permissions={permissions}
          onLogAudit={logFinanceAudit}
        />
      )}

      {(activeSubTab === 'laporan' || activeSubTab === 'analisis') && (
        <FinanceReportsAnalysisTab
          mode={activeSubTab === 'laporan' ? 'REPORTS' : 'ANALYSIS'}
          filter={filter}
          statements={statements}
          cashBankSummary={cashBankSummary}
          receivablesPayables={receivablesPayables}
          rkaItems={rkaItems}
          rkaSubItems={rkaSubItems}
          allTransactions={transactions}
          analysis={analysis}
          pdamSnapshots={pdamSnapshots}
          inventory={inventory}
          purchases={purchases}
        />
      )}

      {activeSubTab === 'audit_trail' && (
        <FinanceAuditTrailTab
          filter={filter}
          auditTrails={auditTrails}
          transactions={transactions}
        />
      )}

      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900">
                  Kosongkan &amp; Muat Baseline Des 2025 &amp; Jan 2026
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Tindakan ini akan <strong>mengosongkan seluruh transaksi, jurnal, kas/bank, COA, utang/piutang, aset, pajak, persediaan, pembelian, dan snapshot operasional</strong> lalu mengisi lengkap data awal periode <strong>Desember 2025</strong> serta periode berjalan <strong>Januari 2026</strong> Perumda Air Minum Tirta Saiyo. Data RKA, Audit Kinerja, dan Self Assessment BPKP tidak terpengaruh.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={baselineSyncing}
                onClick={() => setIsResetModalOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={baselineSyncing}
                onClick={handleManualResetJan2026}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-bold cursor-pointer disabled:opacity-60"
              >
                {baselineSyncing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Kosongkan &amp; Muat Des 25 / Jan 26</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
