import React, { useEffect, useMemo, useState } from 'react';
import {
  Database,
  Plus,
  Save,
  Trash2,
  Droplets,
  ReceiptText,
  Users,
  Layers,
  Gauge,
  FileText,
  CheckCircle2,
  TrendingUp,
  X,
} from 'lucide-react';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  FinanceGlobalFilter,
  FinancePdamMonthlySnapshot,
} from '../../types/finance';
import { buildOfficialPDAMSnapshotJan2026 } from '../../data/financeStandards';
import { clearAndSeedJan2026Baseline } from '../../lib/financeBaselineReset';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import { formatRp, sanitizeFirestoreRecord } from '../../lib/financeEngine';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';
import { FinanceDeleteConfirmModal } from './FinanceDeleteConfirmModal';

interface FinanceOperationsBillingTabProps {
  filter: FinanceGlobalFilter;
  snapshots: FinancePdamMonthlySnapshot[];
  actor: FinanceActor;
  permissions: FinancePermissions;
  onLogAudit: LogFinanceAuditFn;
}

type PdamView =
  | 'RINGKASAN'
  | 'EFISIENSI'
  | 'EFEKTIVITAS'
  | 'DRD'
  | 'AKTIVA_9'
  | 'PRODUKSI_NRW'
  | 'SAMBUNGAN'
  | 'KARYAWAN'
  | 'ARUS_KAS_TL'
  | 'SURAT_PENGANTAR';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const FinanceOperationsBillingTab: React.FC<FinanceOperationsBillingTabProps> = ({
  filter,
  snapshots,
  actor,
  permissions,
  onLogAudit,
}) => {
  const [subView, setSubView] = useState<PdamView>('RINGKASAN');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [draft, setDraft] = useState<FinancePdamMonthlySnapshot | null>(null);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // New Period Modal
  const [isNewPeriodOpen, setIsNewPeriodOpen] = useState(false);
  const [newYear, setNewYear] = useState('2026');
  const [newMonth, setNewMonth] = useState('Februari');
  const [createMode, setCreateMode] = useState<'ROLLOVER' | 'BLANK'>('ROLLOVER');

  // Baseline Reset Confirmation Modal
  const [isBaselineConfirmOpen, setIsBaselineConfirmOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<FinancePdamMonthlySnapshot | null>(null);

  const sortedSnapshots = useMemo(() => {
    return [...snapshots].sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      const months = FISCAL_MONTHS as readonly string[];
      return months.indexOf(b.month) - months.indexOf(a.month);
    });
  }, [snapshots]);

  const activeSnapshot = useMemo(() => {
    if (selectedSnapshotId) {
      const found = sortedSnapshots.find((s) => s.id === selectedSnapshotId);
      if (found) return found;
    }
    const yearMatch = sortedSnapshots.find(
      (s) =>
        (filter.year === 0 || s.year === filter.year) &&
        (filter.month === 'ALL' || s.month.toLowerCase() === filter.month.toLowerCase())
    );
    return yearMatch || sortedSnapshots[0] || null;
  }, [sortedSnapshots, selectedSnapshotId, filter.year, filter.month]);

  useEffect(() => {
    if (activeSnapshot) {
      setDraft(JSON.parse(JSON.stringify(activeSnapshot)) as FinancePdamMonthlySnapshot);
      setDirty(false);
    } else {
      setDraft(null);
      setDirty(false);
    }
  }, [activeSnapshot]);

  const activeYear = filter.year !== 0 ? filter.year : 2026;

  // Clear & Load Official January 2026 PDAM Baseline
  const handleLoadOfficialBaseline = async () => {
    setSubmitting(true);
    try {
      const targetYear = 2026;
      const result = await clearAndSeedJan2026Baseline({
        actorUid: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        year: targetYear,
      });

      setIsBaselineConfirmOpen(false);
      setSelectedSnapshotId(`pdam-${targetYear}-Januari`);
      setFeedback({
        type: 'success',
        message: `Data keuangan dikosongkan (${result.deletedCount} data lama) & Baseline Resmi PDAM Tirta Saiyo Januari ${targetYear} dimuat (${result.seededCounts.coa} COA, ${result.seededCounts.cashBanks} Kas/Bank, ${result.seededCounts.receivablesPayables} Utang/Piutang, ${result.seededCounts.assets} Aset, ${result.seededCounts.taxes} Pajak, ${result.seededCounts.inventory} Persediaan, ${result.seededCounts.purchases} Pembelian & Operasional PDAM).`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal memuat baseline resmi: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!draft) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const updated: FinancePdamMonthlySnapshot = sanitizeFirestoreRecord({
        ...draft,
        updatedBy: actor.displayName,
        updatedAt: now,
      });
      await setDoc(doc(db, 'fin_pdam_reports', updated.id), updated);
      await onLogAudit({
        actionType: 'UPDATE',
        entityType: 'Laporan Operasional & Penagihan PDAM',
        entityId: updated.id,
        entityLabel: `${updated.month} ${updated.year}`,
        summary: `Memperbarui data operasional & penagihan PDAM periode ${updated.month} ${updated.year}`,
        beforeData: activeSnapshot
          ? (activeSnapshot as unknown as Record<string, unknown>)
          : null,
        afterData: updated as unknown as Record<string, unknown>,
        year: updated.year,
      });
      setDirty(false);
      setFeedback({
        type: 'success',
        message: `Perubahan periode ${updated.month} ${updated.year} berhasil disimpan.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan perubahan: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openNewPeriodModal = () => {
    const months = FISCAL_MONTHS as readonly string[];
    const latest = sortedSnapshots[0];
    if (latest) {
      const idx = months.indexOf(latest.month);
      if (idx >= 0 && idx < 11) {
        setNewYear(String(latest.year));
        setNewMonth(months[idx + 1]);
      } else {
        setNewYear(String(latest.year + 1));
        setNewMonth('Januari');
      }
    } else {
      setNewYear(String(activeYear));
      setNewMonth('Februari');
    }
    setCreateMode('ROLLOVER');
    setIsNewPeriodOpen(true);
  };

  const handleCreatePeriod = async () => {
    const y = parseInt(newYear, 10) || activeYear;
    const m = newMonth;
    const id = `pdam-${y}-${m}`;
    if (snapshots.some((s) => s.id === id)) {
      setFeedback({ type: 'error', message: `Periode ${m} ${y} sudah terdaftar.` });
      return;
    }
    setSubmitting(true);
    try {
      const baseTemplate = activeSnapshot || buildOfficialPDAMSnapshotJan2026(actor.displayName);
      const source = JSON.parse(JSON.stringify(baseTemplate)) as FinancePdamMonthlySnapshot;
      const now = new Date().toISOString();

      let nextSnap: FinancePdamMonthlySnapshot;

      if (createMode === 'ROLLOVER') {
        const prevEndingCash = source.indirectCashFlow?.endingCash || 0;
        const wc = (source.indirectCashFlow?.workingCapitalChanges || []).map((w) => ({
          label: w.label,
          amount: 0,
        }));
        nextSnap = {
          ...source,
          id,
          year: y,
          month: m,
          letterNumber: source.letterNumber,
          letterDate: `Lubuk Sikaping, ${m} ${y}`,
          summaryMetrics: source.summaryMetrics.map((sm) => ({
            ...sm,
            monthlyReal: 0,
          })),
          indirectCashFlow: {
            netIncomeMonthly: 0,
            depreciationAddBack: 0,
            workingCapitalChanges: wc,
            netOperatingCashFlow: 0,
            investingCashFlow: 0,
            financingCashFlow: 0,
            netCashChange: 0,
            beginningCash: prevEndingCash,
            endingCash: prevEndingCash,
          },
          collectionEfficiency: source.collectionEfficiency.map((ce) => ({
            ...ce,
            prevBilling: 0,
            arrearsCollected: 0,
            currentCollected: 0,
            totalCollected: 0,
            currentEfficiencyPct: 0,
            totalEfficiencyPct: 0,
          })),
          tariffEffectiveness: source.tariffEffectiveness.map((te) => ({
            ...te,
            receivableMonth1: 0,
            receivableMonth2: 0,
            receivableMonth3: 0,
            receivableAbove3Months: 0,
            totalReceivable: 0,
            collectedAmount: 0,
            effectivenessPct: 0,
          })),
          drdSummary: source.drdSummary.map((d) => ({
            ...d,
            billedSlipsMonthly: 0,
            cubicMetersMonthly: 0,
            billedAmountMonthly: 0,
          })),
          assetGroupSummary: source.assetGroupSummary.map((a) => ({
            ...a,
            depreciationMonthly: 0,
          })),
          productionDistribution: source.productionDistribution.map((p) => ({
            ...p,
            producedM3Monthly: 0,
            distributedM3Monthly: 0,
            soldM3Monthly: 0,
            nrwM3Monthly: 0,
            nrwPctMonthly: 0,
          })),
          customerConnections: source.customerConnections.map((c) => ({
            ...c,
            beginningActive: c.endingActive,
            inactiveCount: 0,
            disconnectedCount: 0,
            reconnectedCount: 0,
            newConnectionsCount: 0,
            endingActive: c.endingActive,
          })),
          notes: `Laporan Keuangan & Manajemen Bulan ${m} ${y} (Roll-over dari ${source.month} ${source.year}).`,
          createdAt: now,
          updatedAt: now,
          updatedBy: actor.displayName,
        };
      } else {
        // BLANK manual template preserving category/unit/COA labels
        const wc = (source.indirectCashFlow?.workingCapitalChanges || []).map((w) => ({
          label: w.label,
          amount: 0,
        }));
        nextSnap = {
          ...source,
          id,
          year: y,
          month: m,
          letterDate: `Lubuk Sikaping, ${m} ${y}`,
          summaryMetrics: source.summaryMetrics.map((sm) => ({
            ...sm,
            monthlyReal: 0,
            ytdReal: 0,
          })),
          indirectCashFlow: {
            netIncomeMonthly: 0,
            depreciationAddBack: 0,
            workingCapitalChanges: wc,
            netOperatingCashFlow: 0,
            investingCashFlow: 0,
            financingCashFlow: 0,
            netCashChange: 0,
            beginningCash: 0,
            endingCash: 0,
          },
          collectionEfficiency: source.collectionEfficiency.map((ce) => ({
            ...ce,
            prevBilling: 0,
            arrearsCollected: 0,
            currentCollected: 0,
            totalCollected: 0,
            currentEfficiencyPct: 0,
            totalEfficiencyPct: 0,
          })),
          tariffEffectiveness: source.tariffEffectiveness.map((te) => ({
            ...te,
            receivableMonth1: 0,
            receivableMonth2: 0,
            receivableMonth3: 0,
            receivableAbove3Months: 0,
            totalReceivable: 0,
            collectedAmount: 0,
            effectivenessPct: 0,
          })),
          drdSummary: source.drdSummary.map((d) => ({
            ...d,
            billedSlipsMonthly: 0,
            cubicMetersMonthly: 0,
            billedAmountMonthly: 0,
            billedSlipsYtd: 0,
            cubicMetersYtd: 0,
            billedAmountYtd: 0,
          })),
          assetGroupSummary: source.assetGroupSummary.map((a) => ({
            ...a,
            depreciationMonthly: 0,
            depreciationYtd: 0,
            accumDepEnding: a.accumDepPrevYear,
            bookValueEnding: a.acquisitionCost - a.accumDepPrevYear,
          })),
          productionDistribution: source.productionDistribution.map((p) => ({
            ...p,
            producedM3Monthly: 0,
            distributedM3Monthly: 0,
            soldM3Monthly: 0,
            nrwM3Monthly: 0,
            nrwPctMonthly: 0,
            producedM3Ytd: 0,
            distributedM3Ytd: 0,
            soldM3Ytd: 0,
            nrwM3Ytd: 0,
            nrwPctYtd: 0,
          })),
          customerConnections: source.customerConnections.map((c) => ({
            ...c,
            beginningActive: 0,
            inactiveCount: 0,
            disconnectedCount: 0,
            reconnectedCount: 0,
            newConnectionsCount: 0,
            endingActive: 0,
          })),
          notes: `Laporan Keuangan & Manajemen Bulan ${m} ${y} (Input manual baru).`,
          createdAt: now,
          updatedAt: now,
          updatedBy: actor.displayName,
        };
      }

      const clean = sanitizeFirestoreRecord(nextSnap);
      await setDoc(doc(db, 'fin_pdam_reports', id), clean);
      await onLogAudit({
        actionType: 'CREATE',
        entityType: 'Laporan Operasional & Penagihan PDAM',
        entityId: id,
        entityLabel: `${m} ${y}`,
        summary: `Membuat periode laporan operasional PDAM ${m} ${y} (Mode: ${createMode === 'ROLLOVER' ? 'Roll-Over' : 'Manual Baru'})`,
        afterData: clean as unknown as Record<string, unknown>,
        year: y,
      });
      setSelectedSnapshotId(id);
      setIsNewPeriodOpen(false);
      setFeedback({ type: 'success', message: `Periode ${m} ${y} berhasil dibuat dan siap diisi manual.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal membuat periode: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !permissions.isSuperUser) return;
    setSubmitting(true);
    try {
      await deleteDoc(doc(db, 'fin_pdam_reports', deleteTarget.id));
      await onLogAudit({
        actionType: 'DELETE',
        entityType: 'Laporan Operasional & Penagihan PDAM',
        entityId: deleteTarget.id,
        entityLabel: `${deleteTarget.month} ${deleteTarget.year}`,
        summary: `Super User menghapus periode laporan PDAM ${deleteTarget.month} ${deleteTarget.year}`,
        beforeData: deleteTarget as unknown as Record<string, unknown>,
        afterData: null,
        year: deleteTarget.year,
      });
      setDeleteTarget(null);
      setSelectedSnapshotId('');
      setFeedback({ type: 'success', message: 'Periode laporan berhasil dihapus.' });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menghapus periode: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canEditData = permissions.canOperate || permissions.isSuperUser;

  const updateDraft = (updater: (prev: FinancePdamMonthlySnapshot) => FinancePdamMonthlySnapshot) => {
    if (!draft) return;
    setDraft(updater(draft));
    setDirty(true);
  };

  // Precomputed footer totals for display clarity
  const effTotals = useMemo(() => {
    if (!draft) return { prev: 0, arr: 0, cur: 0, tot: 0, curPct: 0, totPct: 0 };
    const prev = draft.collectionEfficiency.reduce((s, r) => s + (r.prevBilling || 0), 0);
    const arr = draft.collectionEfficiency.reduce((s, r) => s + (r.arrearsCollected || 0), 0);
    const cur = draft.collectionEfficiency.reduce((s, r) => s + (r.currentCollected || 0), 0);
    const tot = arr + cur;
    return {
      prev,
      arr,
      cur,
      tot,
      curPct: prev > 0 ? round2((cur / prev) * 100) : 0,
      totPct: prev > 0 ? round2((tot / prev) * 100) : 0,
    };
  }, [draft]);

  const tariffTotals = useMemo(() => {
    if (!draft) return { m1: 0, m2: 0, m3: 0, ab3: 0, tot: 0, col: 0, pct: 0 };
    const m1 = draft.tariffEffectiveness.reduce((s, r) => s + (r.receivableMonth1 || 0), 0);
    const m2 = draft.tariffEffectiveness.reduce((s, r) => s + (r.receivableMonth2 || 0), 0);
    const m3 = draft.tariffEffectiveness.reduce((s, r) => s + (r.receivableMonth3 || 0), 0);
    const ab3 = draft.tariffEffectiveness.reduce((s, r) => s + (r.receivableAbove3Months || 0), 0);
    const tot = draft.tariffEffectiveness.reduce((s, r) => s + (r.totalReceivable || 0), 0);
    const col = draft.tariffEffectiveness.reduce((s, r) => s + (r.collectedAmount || 0), 0);
    return {
      m1,
      m2,
      m3,
      ab3,
      tot,
      col,
      pct: col + tot > 0 ? round2((col / (col + tot)) * 100) : 0,
    };
  }, [draft]);

  const drdTotals = useMemo(() => {
    if (!draft) return { cust: 0, slpM: 0, m3M: 0, amtM: 0, slpY: 0, m3Y: 0, amtY: 0 };
    return draft.drdSummary.reduce(
      (acc, r) => ({
        cust: acc.cust + (r.customerCount || 0),
        slpM: acc.slpM + (r.billedSlipsMonthly || 0),
        m3M: acc.m3M + (r.cubicMetersMonthly || 0),
        amtM: acc.amtM + (r.billedAmountMonthly || 0),
        slpY: acc.slpY + (r.billedSlipsYtd || 0),
        m3Y: acc.m3Y + (r.cubicMetersYtd || 0),
        amtY: acc.amtY + (r.billedAmountYtd || 0),
      }),
      { cust: 0, slpM: 0, m3M: 0, amtM: 0, slpY: 0, m3Y: 0, amtY: 0 }
    );
  }, [draft]);

  const assetTotals = useMemo(() => {
    if (!draft) return { cost: 0, prevAcc: 0, depM: 0, depY: 0, accEnd: 0, book: 0 };
    return draft.assetGroupSummary.reduce(
      (acc, a) => ({
        cost: acc.cost + (a.acquisitionCost || 0),
        prevAcc: acc.prevAcc + (a.accumDepPrevYear || 0),
        depM: acc.depM + (a.depreciationMonthly || 0),
        depY: acc.depY + (a.depreciationYtd || 0),
        accEnd: acc.accEnd + (a.accumDepEnding || 0),
        book: acc.book + (a.bookValueEnding || 0),
      }),
      { cost: 0, prevAcc: 0, depM: 0, depY: 0, accEnd: 0, book: 0 }
    );
  }, [draft]);

  const prodTotals = useMemo(() => {
    if (!draft)
      return {
        inst: 0,
        real: 0,
        prodM: 0,
        distM: 0,
        soldM: 0,
        nrwM: 0,
        pctM: 0,
        prodY: 0,
        distY: 0,
        soldY: 0,
        nrwY: 0,
        pctY: 0,
      };
    const t = draft.productionDistribution.reduce(
      (acc, p) => ({
        inst: acc.inst + (p.installedCapacityLps || 0),
        real: acc.real + (p.realCapacityLps || 0),
        prodM: acc.prodM + (p.producedM3Monthly || 0),
        distM: acc.distM + (p.distributedM3Monthly || 0),
        soldM: acc.soldM + (p.soldM3Monthly || 0),
        nrwM: acc.nrwM + (p.nrwM3Monthly || 0),
        prodY: acc.prodY + (p.producedM3Ytd || 0),
        distY: acc.distY + (p.distributedM3Ytd || 0),
        soldY: acc.soldY + (p.soldM3Ytd || 0),
        nrwY: acc.nrwY + (p.nrwM3Ytd || 0),
      }),
      { inst: 0, real: 0, prodM: 0, distM: 0, soldM: 0, nrwM: 0, prodY: 0, distY: 0, soldY: 0, nrwY: 0 }
    );
    return {
      ...t,
      pctM: t.distM > 0 ? round2((t.nrwM / t.distM) * 100) : 0,
      pctY: t.distY > 0 ? round2((t.nrwY / t.distY) * 100) : 0,
    };
  }, [draft]);

  const connTotals = useMemo(() => {
    if (!draft) return { beg: 0, inact: 0, disc: 0, rec: 0, news: 0, end: 0 };
    return draft.customerConnections.reduce(
      (acc, c) => ({
        beg: acc.beg + (c.beginningActive || 0),
        inact: acc.inact + (c.inactiveCount || 0),
        disc: acc.disc + (c.disconnectedCount || 0),
        rec: acc.rec + (c.reconnectedCount || 0),
        news: acc.news + (c.newConnectionsCount || 0),
        end: acc.end + (c.endingActive || 0),
      }),
      { beg: 0, inact: 0, disc: 0, rec: 0, news: 0, end: 0 }
    );
  }, [draft]);

  const hrTotals = useMemo(() => {
    if (!draft) return { dir: 0, perm: 0, cont: 0, tot: 0 };
    return draft.employeeComposition.reduce(
      (acc, e) => ({
        dir: acc.dir + (e.direksiCount || 0),
        perm: acc.perm + (e.permanentCount || 0),
        cont: acc.cont + (e.contractCount || 0),
        tot: acc.tot + (e.totalCount || 0),
      }),
      { dir: 0, perm: 0, cont: 0, tot: 0 }
    );
  }, [draft]);

  const recalcIndirectCashFlow = (
    cf: FinancePdamMonthlySnapshot['indirectCashFlow']
  ): FinancePdamMonthlySnapshot['indirectCashFlow'] => {
    const wcTotal = (cf.workingCapitalChanges || []).reduce((s, w) => s + (w.amount || 0), 0);
    const netOp = round2((cf.netIncomeMonthly || 0) + (cf.depreciationAddBack || 0) + wcTotal);
    const netChange = round2(netOp + (cf.investingCashFlow || 0) + (cf.financingCashFlow || 0));
    const ending = round2((cf.beginningCash || 0) + netChange);
    return {
      ...cf,
      netOperatingCashFlow: netOp,
      netCashChange: netChange,
      endingCash: ending,
    };
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} className="underline cursor-pointer">
            Tutup
          </button>
        </div>
      )}

      {/* Header Control Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span className="font-bold text-slate-900">Periode Laporan PDAM:</span>
          <select
            value={draft?.id || ''}
            onChange={(e) => setSelectedSnapshotId(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
          >
            {sortedSnapshots.length === 0 ? (
              <option value="">Belum ada periode tersimpan</option>
            ) : (
              sortedSnapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.month} {s.year} ({s.collectionEfficiency.length} Unit)
                </option>
              ))
            )}
          </select>

          {dirty && (
            <span className="px-2 py-0.5 text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded">
              Ada Perubahan Belum Disimpan
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(permissions.canOperate || permissions.isSuperUser) && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => setIsBaselineConfirmOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Muat Baseline Resmi PDAM (Jan 2026)</span>
            </button>
          )}

          {canEditData && (
            <button
              type="button"
              onClick={openNewPeriodModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Periode</span>
            </button>
          )}

          {canEditData && draft && (
            <button
              type="button"
              disabled={submitting || !dirty}
              onClick={handleSaveDraft}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Simpan Perubahan</span>
            </button>
          )}

          {permissions.isSuperUser && draft && (
            <button
              type="button"
              onClick={() => setDeleteTarget(draft)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
              title="Hapus Periode Ini (Super User)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus</span>
            </button>
          )}
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 flex items-center gap-1 overflow-x-auto">
        {[
          { id: 'RINGKASAN', label: 'Ringkasan Utama', icon: Gauge },
          { id: 'EFISIENSI', label: 'Efisiensi Penagihan (11 Unit)', icon: ReceiptText },
          { id: 'EFEKTIVITAS', label: 'Efektivitas & Umur Piutang', icon: Layers },
          { id: 'DRD', label: 'Ikhtisar Rekening Air (DRD)', icon: FileText },
          { id: 'AKTIVA_9', label: 'Rekap Penyusutan 9 Aktiva', icon: CheckCircle2 },
          { id: 'PRODUKSI_NRW', label: 'Produksi, Distribusi & NRW', icon: Droplets },
          { id: 'SAMBUNGAN', label: 'Posisi Sambungan (SR)', icon: Users },
          { id: 'KARYAWAN', label: 'Kondisi Karyawan', icon: Users },
          { id: 'ARUS_KAS_TL', label: 'Arus Kas (Tidak Langsung)', icon: TrendingUp },
          { id: 'SURAT_PENGANTAR', label: 'Surat Pengantar (Permendagri 118)', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubView(tab.id as PdamView)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                subView === tab.id
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {!draft ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="text-sm font-bold text-slate-900">
            Data Operasional &amp; Penagihan PDAM Belum Dimuat
          </p>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            Klik tombol &quot;Muat Baseline Resmi PDAM (Jan 2026)&quot; di atas untuk mengosongkan data lama dan menginisialisasi baseline resmi Januari 2026 Perumda Air Minum Tirta Saiyo.
          </p>
        </div>
      ) : (
        <>
          {/* 1. RINGKASAN */}
          {subView === 'RINGKASAN' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">No</th>
                      <th className="py-2.5 px-3">Uraian Kegiatan Utama</th>
                      <th className="py-2.5 px-3">Satuan</th>
                      <th className="py-2.5 px-3 text-right">Realisasi Bulan Ini</th>
                      <th className="py-2.5 px-3 text-right">Anggaran Bulan Ini</th>
                      <th className="py-2.5 px-3 text-right">Realisasi s/d Bulan Ini</th>
                      <th className="py-2.5 px-3 text-right">Anggaran s/d Bulan Ini</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.summaryMetrics.map((m, idx) => (
                      <tr key={m.code} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-mono font-bold text-emerald-800">{m.code}</td>
                        <td className="py-2 px-3 font-medium text-slate-900">{m.label}</td>
                        <td className="py-2 px-3 text-slate-500">{m.unit}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">
                          {canEditData ? (
                            <input
                              type="number"
                              step="any"
                              value={m.monthlyReal}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.summaryMetrics];
                                  next[idx] = { ...next[idx], monthlyReal: val };
                                  return { ...prev, summaryMetrics: next };
                                });
                              }}
                              className="w-32 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                            />
                          ) : m.unit === 'Rp' ? (
                            formatRp(m.monthlyReal)
                          ) : (
                            m.monthlyReal.toLocaleString('id-ID')
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {canEditData ? (
                            <input
                              type="number"
                              step="any"
                              value={m.monthlyBudget}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.summaryMetrics];
                                  next[idx] = { ...next[idx], monthlyBudget: val };
                                  return { ...prev, summaryMetrics: next };
                                });
                              }}
                              className="w-32 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-slate-700"
                            />
                          ) : m.unit === 'Rp' ? (
                            formatRp(m.monthlyBudget)
                          ) : (
                            m.monthlyBudget.toLocaleString('id-ID')
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums font-semibold">
                          {canEditData ? (
                            <input
                              type="number"
                              step="any"
                              value={m.ytdReal}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.summaryMetrics];
                                  next[idx] = { ...next[idx], ytdReal: val };
                                  return { ...prev, summaryMetrics: next };
                                });
                              }}
                              className="w-36 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono font-semibold"
                            />
                          ) : m.unit === 'Rp' ? (
                            formatRp(m.ytdReal)
                          ) : (
                            m.ytdReal.toLocaleString('id-ID')
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {canEditData ? (
                            <input
                              type="number"
                              step="any"
                              value={m.ytdBudget}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.summaryMetrics];
                                  next[idx] = { ...next[idx], ytdBudget: val };
                                  return { ...prev, summaryMetrics: next };
                                });
                              }}
                              className="w-36 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-slate-700"
                            />
                          ) : m.unit === 'Rp' ? (
                            formatRp(m.ytdBudget)
                          ) : (
                            m.ytdBudget.toLocaleString('id-ID')
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 2. EFISIENSI PENAGIHAN */}
          {subView === 'EFISIENSI' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Unit Pelayanan</th>
                      <th className="py-2.5 px-3 text-right">Rekening Bulan Lalu</th>
                      <th className="py-2.5 px-3 text-right">Tagih Tunggakan</th>
                      <th className="py-2.5 px-3 text-right">Tagih Lancar</th>
                      <th className="py-2.5 px-3 text-right">Total Tagihan Masuk</th>
                      <th className="py-2.5 px-3 text-right">% Lancar</th>
                      <th className="py-2.5 px-3 text-right">% Total Efisiensi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.collectionEfficiency.map((u, idx) => (
                      <tr key={u.unitName} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-semibold text-slate-900">{u.unitName}</td>
                        <td className="py-1.5 px-3 text-right font-mono">
                          {canEditData ? (
                            <input
                              type="number"
                              value={u.prevBilling}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.collectionEfficiency];
                                  const row = next[idx];
                                  const totalCollected = (row.arrearsCollected || 0) + (row.currentCollected || 0);
                                  next[idx] = {
                                    ...row,
                                    prevBilling: val,
                                    totalCollected,
                                    currentEfficiencyPct: val > 0 ? round2((row.currentCollected / val) * 100) : 0,
                                    totalEfficiencyPct: val > 0 ? round2((totalCollected / val) * 100) : 0,
                                  };
                                  return { ...prev, collectionEfficiency: next };
                                });
                              }}
                              className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                            />
                          ) : (
                            formatRp(u.prevBilling)
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono">
                          {canEditData ? (
                            <input
                              type="number"
                              value={u.arrearsCollected}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.collectionEfficiency];
                                  const row = next[idx];
                                  const totalCollected = val + (row.currentCollected || 0);
                                  const prevBill = row.prevBilling || 0;
                                  next[idx] = {
                                    ...row,
                                    arrearsCollected: val,
                                    totalCollected,
                                    totalEfficiencyPct: prevBill > 0 ? round2((totalCollected / prevBill) * 100) : 0,
                                  };
                                  return { ...prev, collectionEfficiency: next };
                                });
                              }}
                              className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                            />
                          ) : (
                            formatRp(u.arrearsCollected)
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono">
                          {canEditData ? (
                            <input
                              type="number"
                              value={u.currentCollected}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.collectionEfficiency];
                                  const row = next[idx];
                                  const totalCollected = (row.arrearsCollected || 0) + val;
                                  const prevBill = row.prevBilling || 0;
                                  next[idx] = {
                                    ...row,
                                    currentCollected: val,
                                    totalCollected,
                                    currentEfficiencyPct: prevBill > 0 ? round2((val / prevBill) * 100) : 0,
                                    totalEfficiencyPct: prevBill > 0 ? round2((totalCollected / prevBill) * 100) : 0,
                                  };
                                  return { ...prev, collectionEfficiency: next };
                                });
                              }}
                              className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                            />
                          ) : (
                            formatRp(u.currentCollected)
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                          {formatRp(u.totalCollected)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{u.currentEfficiencyPct.toFixed(2)}%</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">
                          {u.totalEfficiencyPct.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-2.5 px-3">TOTAL EFISIENSI PENAGIHAN</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatRp(effTotals.prev)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatRp(effTotals.arr)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatRp(effTotals.cur)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatRp(effTotals.tot)}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{effTotals.curPct.toFixed(2)}%</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-800">
                        {effTotals.totPct.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 3. EFEKTIVITAS */}
          {subView === 'EFEKTIVITAS' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Golongan Tarif</th>
                      <th className="py-2.5 px-3 text-right">1 Bulan</th>
                      <th className="py-2.5 px-3 text-right">2 Bulan</th>
                      <th className="py-2.5 px-3 text-right">3 Bulan</th>
                      <th className="py-2.5 px-3 text-right">&gt; 3 Bulan</th>
                      <th className="py-2.5 px-3 text-right">Total Piutang</th>
                      <th className="py-2.5 px-3 text-right">Tertagih</th>
                      <th className="py-2.5 px-3 text-right">Efektivitas (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.tariffEffectiveness.map((t, idx) => {
                      const updateTariffRow = (
                        field:
                          | 'receivableMonth1'
                          | 'receivableMonth2'
                          | 'receivableMonth3'
                          | 'receivableAbove3Months'
                          | 'collectedAmount',
                        val: number
                      ) => {
                        updateDraft((prev) => {
                          const next = [...prev.tariffEffectiveness];
                          const updated = { ...next[idx], [field]: val };
                          const totalReceivable =
                            (updated.receivableMonth1 || 0) +
                            (updated.receivableMonth2 || 0) +
                            (updated.receivableMonth3 || 0) +
                            (updated.receivableAbove3Months || 0);
                          const collected = updated.collectedAmount || 0;
                          updated.totalReceivable = totalReceivable;
                          updated.effectivenessPct =
                            collected + totalReceivable > 0
                              ? round2((collected / (collected + totalReceivable)) * 100)
                              : 0;
                          next[idx] = updated;
                          return { ...prev, tariffEffectiveness: next };
                        });
                      };

                      return (
                        <tr key={t.tariffCode} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">
                            {t.tariffName}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={t.receivableMonth1}
                                onChange={(e) =>
                                  updateTariffRow('receivableMonth1', Number(e.target.value) || 0)
                                }
                                className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              formatRp(t.receivableMonth1)
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={t.receivableMonth2}
                                onChange={(e) =>
                                  updateTariffRow('receivableMonth2', Number(e.target.value) || 0)
                                }
                                className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              formatRp(t.receivableMonth2)
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={t.receivableMonth3}
                                onChange={(e) =>
                                  updateTariffRow('receivableMonth3', Number(e.target.value) || 0)
                                }
                                className="w-24 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              formatRp(t.receivableMonth3)
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-rose-700">
                            {canEditData ? (
                              <input
                                type="number"
                                value={t.receivableAbove3Months}
                                onChange={(e) =>
                                  updateTariffRow(
                                    'receivableAbove3Months',
                                    Number(e.target.value) || 0
                                  )
                                }
                                className="w-32 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-rose-700"
                              />
                            ) : (
                              formatRp(t.receivableAbove3Months)
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold whitespace-nowrap">
                            {formatRp(t.totalReceivable)}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-emerald-800">
                            {canEditData ? (
                              <input
                                type="number"
                                value={t.collectedAmount}
                                onChange={(e) =>
                                  updateTariffRow('collectedAmount', Number(e.target.value) || 0)
                                }
                                className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-emerald-800"
                              />
                            ) : (
                              formatRp(t.collectedAmount)
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold">
                            {t.effectivenessPct.toFixed(2)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-2.5 px-3">TOTAL PIUTANG &amp; EFEKTIVITAS</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatRp(tariffTotals.m1)}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatRp(tariffTotals.m2)}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatRp(tariffTotals.m3)}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-rose-700">
                        {formatRp(tariffTotals.ab3)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatRp(tariffTotals.tot)}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-emerald-800">
                        {formatRp(tariffTotals.col)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {tariffTotals.pct.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 4. DRD */}
          {subView === 'DRD' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Golongan Tarif</th>
                      <th className="py-2.5 px-3 text-right">Pelanggan</th>
                      <th className="py-2.5 px-3 text-right">Lbr Rek (Bln)</th>
                      <th className="py-2.5 px-3 text-right">M3 (Bln Ini)</th>
                      <th className="py-2.5 px-3 text-right">Rupiah (Bln Ini)</th>
                      <th className="py-2.5 px-3 text-right">Lbr Rek (YTD)</th>
                      <th className="py-2.5 px-3 text-right">M3 (s/d Bln Ini)</th>
                      <th className="py-2.5 px-3 text-right">Rupiah (s/d Bln Ini)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.drdSummary.map((d, idx) => {
                      const updateDrd = (
                        field:
                          | 'customerCount'
                          | 'billedSlipsMonthly'
                          | 'cubicMetersMonthly'
                          | 'billedAmountMonthly'
                          | 'billedSlipsYtd'
                          | 'cubicMetersYtd'
                          | 'billedAmountYtd',
                        val: number
                      ) => {
                        updateDraft((prev) => {
                          const next = [...prev.drdSummary];
                          next[idx] = { ...next[idx], [field]: val };
                          return { ...prev, drdSummary: next };
                        });
                      };
                      return (
                        <tr key={`${d.tariffGroup}-${d.tariffName}`} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className="font-mono text-[10px] text-slate-500 mr-1.5">
                              {d.tariffGroup}
                            </span>
                            <span className="font-semibold text-slate-900">{d.tariffName}</span>
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={d.customerCount}
                                onChange={(e) =>
                                  updateDrd('customerCount', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              d.customerCount.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={d.billedSlipsMonthly}
                                onChange={(e) =>
                                  updateDrd('billedSlipsMonthly', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              d.billedSlipsMonthly.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={d.cubicMetersMonthly}
                                onChange={(e) =>
                                  updateDrd('cubicMetersMonthly', Number(e.target.value) || 0)
                                }
                                className="w-24 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              d.cubicMetersMonthly.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono font-semibold">
                            {canEditData ? (
                              <input
                                type="number"
                                value={d.billedAmountMonthly}
                                onChange={(e) =>
                                  updateDrd('billedAmountMonthly', Number(e.target.value) || 0)
                                }
                                className="w-32 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono font-semibold"
                              />
                            ) : (
                              formatRp(d.billedAmountMonthly)
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={d.billedSlipsYtd}
                                onChange={(e) =>
                                  updateDrd('billedSlipsYtd', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              d.billedSlipsYtd.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={d.cubicMetersYtd}
                                onChange={(e) =>
                                  updateDrd('cubicMetersYtd', Number(e.target.value) || 0)
                                }
                                className="w-24 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              d.cubicMetersYtd.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono font-bold text-emerald-800">
                            {canEditData ? (
                              <input
                                type="number"
                                value={d.billedAmountYtd}
                                onChange={(e) =>
                                  updateDrd('billedAmountYtd', Number(e.target.value) || 0)
                                }
                                className="w-32 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono font-bold text-emerald-800"
                              />
                            ) : (
                              formatRp(d.billedAmountYtd)
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-2.5 px-3">TOTAL DRD REKENING AIR</td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {drdTotals.cust.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {drdTotals.slpM.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {drdTotals.m3M.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatRp(drdTotals.amtM)}</td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {drdTotals.slpY.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {drdTotals.m3Y.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-emerald-800">
                        {formatRp(drdTotals.amtY)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 5. AKTIVA 9 KELOMPOK */}
          {subView === 'AKTIVA_9' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Kode</th>
                      <th className="py-2.5 px-3">Kelompok Aktiva Tetap</th>
                      <th className="py-2.5 px-3 text-right">Harga Perolehan</th>
                      <th className="py-2.5 px-3 text-right">Akum. Susut Thn Lalu</th>
                      <th className="py-2.5 px-3 text-right">Susut Bulan Ini</th>
                      <th className="py-2.5 px-3 text-right">Susut s/d Bulan Ini</th>
                      <th className="py-2.5 px-3 text-right">Akumulasi Susut Akhir</th>
                      <th className="py-2.5 px-3 text-right">Nilai Buku Akhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.assetGroupSummary.map((a, idx) => {
                      const updateAssetGroup = (
                        field:
                          | 'acquisitionCost'
                          | 'accumDepPrevYear'
                          | 'depreciationMonthly'
                          | 'depreciationYtd',
                        val: number
                      ) => {
                        updateDraft((prev) => {
                          const next = [...prev.assetGroupSummary];
                          const updated = { ...next[idx], [field]: val };
                          updated.accumDepEnding = round2(
                            (updated.accumDepPrevYear || 0) + (updated.depreciationYtd || 0)
                          );
                          updated.bookValueEnding = round2(
                            (updated.acquisitionCost || 0) - updated.accumDepEnding
                          );
                          next[idx] = updated;
                          return { ...prev, assetGroupSummary: next };
                        });
                      };

                      return (
                        <tr key={a.groupCode} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 font-mono font-bold text-emerald-800">
                            {a.groupCode}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{a.groupName}</td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                step="any"
                                value={a.acquisitionCost}
                                onChange={(e) =>
                                  updateAssetGroup('acquisitionCost', Number(e.target.value) || 0)
                                }
                                className="w-32 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              formatRp(a.acquisitionCost)
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                step="any"
                                value={a.accumDepPrevYear}
                                onChange={(e) =>
                                  updateAssetGroup('accumDepPrevYear', Number(e.target.value) || 0)
                                }
                                className="w-32 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              formatRp(a.accumDepPrevYear)
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                step="any"
                                value={a.depreciationMonthly}
                                onChange={(e) =>
                                  updateAssetGroup(
                                    'depreciationMonthly',
                                    Number(e.target.value) || 0
                                  )
                                }
                                className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              formatRp(a.depreciationMonthly)
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                step="any"
                                value={a.depreciationYtd}
                                onChange={(e) =>
                                  updateAssetGroup('depreciationYtd', Number(e.target.value) || 0)
                                }
                                className="w-28 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              formatRp(a.depreciationYtd)
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-rose-700 whitespace-nowrap">
                            {formatRp(a.accumDepEnding)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                            {formatRp(a.bookValueEnding)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td colSpan={2} className="py-2.5 px-3">
                        TOTAL 9 KELOMPOK AKTIVA TETAP
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatRp(assetTotals.cost)}</td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {formatRp(assetTotals.prevAcc)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatRp(assetTotals.depM)}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatRp(assetTotals.depY)}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                        {formatRp(assetTotals.accEnd)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {formatRp(assetTotals.book)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 6. PRODUKSI & NRW */}
          {subView === 'PRODUKSI_NRW' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Unit Produksi</th>
                      <th className="py-2.5 px-2 text-right">Terpasang (L/D)</th>
                      <th className="py-2.5 px-2 text-right">Riil (L/D)</th>
                      <th className="py-2.5 px-2 text-right">Prod M3 (Bln)</th>
                      <th className="py-2.5 px-2 text-right">Distr M3 (Bln)</th>
                      <th className="py-2.5 px-2 text-right">Terjual M3 (Bln)</th>
                      <th className="py-2.5 px-2 text-right">NRW M3 (Bln)</th>
                      <th className="py-2.5 px-2 text-right">% NRW Bln</th>
                      <th className="py-2.5 px-2 text-right">Prod M3 (YTD)</th>
                      <th className="py-2.5 px-2 text-right">Distr M3 (YTD)</th>
                      <th className="py-2.5 px-2 text-right">Terjual M3 (YTD)</th>
                      <th className="py-2.5 px-2 text-right">NRW M3 (YTD)</th>
                      <th className="py-2.5 px-2 text-right">% NRW YTD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.productionDistribution.map((p, idx) => {
                      const updateProd = (
                        field:
                          | 'installedCapacityLps'
                          | 'realCapacityLps'
                          | 'producedM3Monthly'
                          | 'distributedM3Monthly'
                          | 'soldM3Monthly'
                          | 'nrwM3Monthly'
                          | 'producedM3Ytd'
                          | 'distributedM3Ytd'
                          | 'soldM3Ytd'
                          | 'nrwM3Ytd',
                        val: number
                      ) => {
                        updateDraft((prev) => {
                          const next = [...prev.productionDistribution];
                          const updated = { ...next[idx], [field]: val };
                          updated.nrwPctMonthly =
                            updated.distributedM3Monthly > 0
                              ? round2((updated.nrwM3Monthly / updated.distributedM3Monthly) * 100)
                              : 0;
                          updated.nrwPctYtd =
                            updated.distributedM3Ytd > 0
                              ? round2((updated.nrwM3Ytd / updated.distributedM3Ytd) * 100)
                              : 0;
                          next[idx] = updated;
                          return { ...prev, productionDistribution: next };
                        });
                      };

                      return (
                        <tr key={p.unitName} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 font-semibold text-slate-900 whitespace-nowrap">
                            {p.unitName}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                step="any"
                                value={p.installedCapacityLps}
                                onChange={(e) =>
                                  updateProd('installedCapacityLps', Number(e.target.value) || 0)
                                }
                                className="w-16 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.installedCapacityLps
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                step="any"
                                value={p.realCapacityLps}
                                onChange={(e) =>
                                  updateProd('realCapacityLps', Number(e.target.value) || 0)
                                }
                                className="w-16 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.realCapacityLps
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.producedM3Monthly}
                                onChange={(e) =>
                                  updateProd('producedM3Monthly', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.producedM3Monthly.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.distributedM3Monthly}
                                onChange={(e) =>
                                  updateProd('distributedM3Monthly', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.distributedM3Monthly.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono text-emerald-800 font-semibold">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.soldM3Monthly}
                                onChange={(e) =>
                                  updateProd('soldM3Monthly', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-emerald-800"
                              />
                            ) : (
                              p.soldM3Monthly.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.nrwM3Monthly}
                                onChange={(e) =>
                                  updateProd('nrwM3Monthly', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.nrwM3Monthly.toLocaleString('id-ID')
                            )}
                          </td>
                          <td
                            className={`py-2 px-2 text-right font-mono font-bold ${
                              p.nrwPctMonthly > 25 ? 'text-rose-700' : 'text-emerald-800'
                            }`}
                          >
                            {p.nrwPctMonthly.toFixed(2)}%
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.producedM3Ytd}
                                onChange={(e) =>
                                  updateProd('producedM3Ytd', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.producedM3Ytd.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.distributedM3Ytd}
                                onChange={(e) =>
                                  updateProd('distributedM3Ytd', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.distributedM3Ytd.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.soldM3Ytd}
                                onChange={(e) =>
                                  updateProd('soldM3Ytd', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.soldM3Ytd.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-1.5 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={p.nrwM3Ytd}
                                onChange={(e) =>
                                  updateProd('nrwM3Ytd', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-1.5 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              p.nrwM3Ytd.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-mono">{p.nrwPctYtd.toFixed(2)}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-2.5 px-3">TOTAL PRODUKSI &amp; NRW</td>
                      <td className="py-2.5 px-1.5 text-right font-mono">{prodTotals.inst}</td>
                      <td className="py-2.5 px-1.5 text-right font-mono">{prodTotals.real}</td>
                      <td className="py-2.5 px-1.5 text-right font-mono">
                        {prodTotals.prodM.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono">
                        {prodTotals.distM.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono text-emerald-800">
                        {prodTotals.soldM.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono">
                        {prodTotals.nrwM.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {prodTotals.pctM.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono">
                        {prodTotals.prodY.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono">
                        {prodTotals.distY.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono">
                        {prodTotals.soldY.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono">
                        {prodTotals.nrwY.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {prodTotals.pctY.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 7. SAMBUNGAN LANGGANAN */}
          {subView === 'SAMBUNGAN' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Cabang / Unit Pelayanan</th>
                      <th className="py-2.5 px-3 text-right">Aktif Awal</th>
                      <th className="py-2.5 px-3 text-right">Tutup Sementara</th>
                      <th className="py-2.5 px-3 text-right">Pemutusan</th>
                      <th className="py-2.5 px-3 text-right">Buka Kembali</th>
                      <th className="py-2.5 px-3 text-right">Sambungan Baru</th>
                      <th className="py-2.5 px-3 text-right">Aktif Akhir (SR)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.customerConnections.map((c, idx) => {
                      const updateConn = (
                        field:
                          | 'beginningActive'
                          | 'inactiveCount'
                          | 'disconnectedCount'
                          | 'reconnectedCount'
                          | 'newConnectionsCount',
                        val: number
                      ) => {
                        updateDraft((prev) => {
                          const next = [...prev.customerConnections];
                          const updated = { ...next[idx], [field]: val };
                          updated.endingActive =
                            (updated.beginningActive || 0) -
                            (updated.inactiveCount || 0) -
                            (updated.disconnectedCount || 0) +
                            (updated.reconnectedCount || 0) +
                            (updated.newConnectionsCount || 0);
                          next[idx] = updated;
                          return { ...prev, customerConnections: next };
                        });
                      };

                      return (
                        <tr key={c.unitName} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 font-semibold text-slate-900">{c.unitName}</td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={c.beginningActive}
                                onChange={(e) =>
                                  updateConn('beginningActive', Number(e.target.value) || 0)
                                }
                                className="w-24 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              c.beginningActive.toLocaleString('id-ID')
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={c.inactiveCount}
                                onChange={(e) =>
                                  updateConn('inactiveCount', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              c.inactiveCount
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-rose-700">
                            {canEditData ? (
                              <input
                                type="number"
                                value={c.disconnectedCount}
                                onChange={(e) =>
                                  updateConn('disconnectedCount', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-rose-700"
                              />
                            ) : (
                              c.disconnectedCount
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-emerald-700">
                            {canEditData ? (
                              <input
                                type="number"
                                value={c.reconnectedCount}
                                onChange={(e) =>
                                  updateConn('reconnectedCount', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-emerald-700"
                              />
                            ) : (
                              c.reconnectedCount
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-teal-800 font-semibold">
                            {canEditData ? (
                              <input
                                type="number"
                                value={c.newConnectionsCount}
                                onChange={(e) =>
                                  updateConn('newConnectionsCount', Number(e.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono text-teal-800"
                              />
                            ) : (
                              c.newConnectionsCount
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                            {c.endingActive.toLocaleString('id-ID')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-2.5 px-3">TOTAL SAMBUNGAN LANGGANAN (SR)</td>
                      <td className="py-2.5 px-2 text-right font-mono">
                        {connTotals.beg.toLocaleString('id-ID')}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono">{connTotals.inact}</td>
                      <td className="py-2.5 px-2 text-right font-mono text-rose-700">
                        {connTotals.disc}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-emerald-700">
                        {connTotals.rec}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono text-teal-800">
                        {connTotals.news}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">
                        {connTotals.end.toLocaleString('id-ID')}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 8. KARYAWAN */}
          {subView === 'KARYAWAN' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                      <th className="py-2.5 px-3">Unit Kerja</th>
                      <th className="py-2.5 px-3 text-right">Direksi</th>
                      <th className="py-2.5 px-3 text-right">Pegawai Tetap</th>
                      <th className="py-2.5 px-3 text-right">Kontrak</th>
                      <th className="py-2.5 px-3 text-right">Total Personil</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.employeeComposition.map((e, idx) => {
                      const updateHr = (
                        field: 'direksiCount' | 'permanentCount' | 'contractCount',
                        val: number
                      ) => {
                        updateDraft((prev) => {
                          const next = [...prev.employeeComposition];
                          const updated = { ...next[idx], [field]: val };
                          updated.totalCount =
                            (updated.direksiCount || 0) +
                            (updated.permanentCount || 0) +
                            (updated.contractCount || 0);
                          next[idx] = updated;
                          return { ...prev, employeeComposition: next };
                        });
                      };

                      return (
                        <tr key={e.unitName} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 font-semibold text-slate-900">{e.unitName}</td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={e.direksiCount}
                                onChange={(ev) =>
                                  updateHr('direksiCount', Number(ev.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              e.direksiCount
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={e.permanentCount}
                                onChange={(ev) =>
                                  updateHr('permanentCount', Number(ev.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              e.permanentCount
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {canEditData ? (
                              <input
                                type="number"
                                value={e.contractCount}
                                onChange={(ev) =>
                                  updateHr('contractCount', Number(ev.target.value) || 0)
                                }
                                className="w-20 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                              />
                            ) : (
                              e.contractCount
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">
                            {e.totalCount}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                      <td className="py-2.5 px-3">TOTAL PERSONIL / KARYAWAN</td>
                      <td className="py-2.5 px-2 text-right font-mono">{hrTotals.dir}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{hrTotals.perm}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{hrTotals.cont}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-emerald-800">
                        {hrTotals.tot}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 9. ARUS KAS TIDAK LANGSUNG (MANUAL) */}
          {subView === 'ARUS_KAS_TL' && draft.indirectCashFlow && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
              <div className="border-b border-slate-200 pb-2.5">
                <h3 className="text-sm font-bold text-slate-900">
                  Laporan Arus Kas Metode Tidak Langsung ({draft.month} {draft.year})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Isi angka perubahan komponen modal kerja, investasi, dan pendanaan secara manual. Total arus kas &amp; saldo akhir kas dihitung otomatis.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Laba / (Rugi) Bersih Periode</label>
                  <input
                    type="number"
                    step="any"
                    disabled={!canEditData}
                    value={draft.indirectCashFlow.netIncomeMonthly}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      updateDraft((p) => ({
                        ...p,
                        indirectCashFlow: recalcIndirectCashFlow({
                          ...p.indirectCashFlow!,
                          netIncomeMonthly: val,
                        }),
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-right"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Penyesuaian Penyusutan Aktiva Tetap</label>
                  <input
                    type="number"
                    step="any"
                    disabled={!canEditData}
                    value={draft.indirectCashFlow.depreciationAddBack}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      updateDraft((p) => ({
                        ...p,
                        indirectCashFlow: recalcIndirectCashFlow({
                          ...p.indirectCashFlow!,
                          depreciationAddBack: val,
                        }),
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-right"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <p className="font-bold text-slate-800">Perubahan Modal Kerja (Aktivitas Operasi):</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {draft.indirectCashFlow.workingCapitalChanges.map((wc, idx) => (
                    <div key={wc.label} className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                      <span className="text-[11px] font-medium text-slate-700">{wc.label}</span>
                      <input
                        type="number"
                        step="any"
                        disabled={!canEditData}
                        value={wc.amount}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          updateDraft((p) => {
                            const nextWc = [...p.indirectCashFlow!.workingCapitalChanges];
                            nextWc[idx] = { ...nextWc[idx], amount: val };
                            return {
                              ...p,
                              indirectCashFlow: recalcIndirectCashFlow({
                                ...p.indirectCashFlow!,
                                workingCapitalChanges: nextWc,
                              }),
                            };
                          });
                        }}
                        className="w-36 px-2.5 py-1 border border-slate-300 rounded bg-white font-mono text-right"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                <div>
                  <label className="block font-semibold mb-1">Arus Kas Aktivitas Investasi</label>
                  <input
                    type="number"
                    step="any"
                    disabled={!canEditData}
                    value={draft.indirectCashFlow.investingCashFlow}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      updateDraft((p) => ({
                        ...p,
                        indirectCashFlow: recalcIndirectCashFlow({
                          ...p.indirectCashFlow!,
                          investingCashFlow: val,
                        }),
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-right"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Arus Kas Aktivitas Pendanaan</label>
                  <input
                    type="number"
                    step="any"
                    disabled={!canEditData}
                    value={draft.indirectCashFlow.financingCashFlow}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      updateDraft((p) => ({
                        ...p,
                        indirectCashFlow: recalcIndirectCashFlow({
                          ...p.indirectCashFlow!,
                          financingCashFlow: val,
                        }),
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-right"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Saldo Kas &amp; Setara Kas Awal</label>
                  <input
                    type="number"
                    step="any"
                    disabled={!canEditData}
                    value={draft.indirectCashFlow.beginningCash}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 0;
                      updateDraft((p) => ({
                        ...p,
                        indirectCashFlow: recalcIndirectCashFlow({
                          ...p.indirectCashFlow!,
                          beginningCash: val,
                        }),
                      }));
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-right"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl font-bold">
                <div>
                  <span className="text-[11px] text-emerald-800 block">Arus Kas Bersih Operasi</span>
                  <span className="text-sm font-mono text-slate-900">
                    {formatRp(draft.indirectCashFlow.netOperatingCashFlow)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-emerald-800 block">Kenaikan / (Penurunan) Kas</span>
                  <span className="text-sm font-mono text-slate-900">
                    {formatRp(draft.indirectCashFlow.netCashChange)}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-emerald-800 block">Saldo Kas &amp; Bank Akhir</span>
                  <span className="text-sm font-mono text-emerald-900">
                    {formatRp(draft.indirectCashFlow.endingCash)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 10. SURAT PENGANTAR */}
          {subView === 'SURAT_PENGANTAR' && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Nomor Surat Pengantar</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.letterNumber}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, letterNumber: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Tempat &amp; Tanggal Surat</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.letterDate}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, letterDate: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block font-semibold mb-1">Tujuan Surat (KPM / Dewas)</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.recipient}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, recipient: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block font-semibold mb-1">Dasar Hukum (Permendagri)</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.legalBasis}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, legalBasis: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Direktur</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.directorName}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, directorName: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Kabid Umum &amp; Keuangan</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.kabidKeuName}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, kabidKeuName: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">NIK Kabid Keuangan</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.kabidKeuNik}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, kabidKeuNik: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Kasubid Keuangan</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.kasubidKeuName}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, kasubidKeuName: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">NIK Kasubid Keuangan</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.kasubidKeuNik}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, kasubidKeuNik: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Catatan Laporan Periode</label>
                  <input
                    type="text"
                    disabled={!canEditData}
                    value={draft.notes || ''}
                    onChange={(e) =>
                      updateDraft((p) => ({ ...p, notes: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Period Modal */}
      {isNewPeriodOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Tambah Periode Laporan PDAM</h3>
              <button type="button" onClick={() => setIsNewPeriodOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Tahun</label>
                <input
                  type="number"
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Bulan</label>
                <select
                  value={newMonth}
                  onChange={(e) => setNewMonth(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {FISCAL_MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <label className="block font-semibold">Pola Inisialisasi Data</label>
              <label className="flex items-start gap-2.5 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="pdamCreateMode"
                  checked={createMode === 'ROLLOVER'}
                  onChange={() => setCreateMode('ROLLOVER')}
                  className="mt-0.5 text-emerald-700"
                />
                <div>
                  <div className="font-bold text-slate-900">
                    Roll-Over dari Periode Sebelumnya (Rekomendasi)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Saldo akhir SR menjadi awal bulan baru, akumulasi aset &amp; anggaran dilanjutkan, angka bulanan direset ke 0 siap input manual.
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2.5 p-2.5 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                <input
                  type="radio"
                  name="pdamCreateMode"
                  checked={createMode === 'BLANK'}
                  onChange={() => setCreateMode('BLANK')}
                  className="mt-0.5 text-emerald-700"
                />
                <div>
                  <div className="font-bold text-slate-900">Kosongkan Semua Angka (Input Manual Baru)</div>
                  <div className="text-[11px] text-slate-500">
                    Struktur unit, tarif, dan kategori dipertahankan; seluruh realisasi disetel ke 0 untuk diisi mandiri dari awal.
                  </div>
                </div>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsNewPeriodOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleCreatePeriod}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Buat Periode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Baseline Reset Confirmation Modal */}
      {isBaselineConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Kosongkan &amp; Muat Baseline Resmi Januari 2026
              </h3>
              <button
                type="button"
                onClick={() => setIsBaselineConfirmOpen(false)}
                className="cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Seluruh data transaksi, COA, kas/bank, utang/piutang, aset, pajak, persediaan, pembelian, dan laporan operasional akan dikosongkan lalu diisi ulang menggunakan <strong>Laporan Bulan Januari 2026 Perumda Air Minum Tirta Saiyo</strong>.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsBaselineConfirmOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleLoadOfficialBaseline}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Konfirmasi &amp; Muat Jan 2026
              </button>
            </div>
          </div>
        </div>
      )}

      <FinanceDeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Hapus Periode Laporan PDAM"
        itemLabel={deleteTarget ? `${deleteTarget.month} ${deleteTarget.year}` : ''}
        description="Seluruh snapshot tabel efisiensi, DRD, produksi & karyawan untuk periode ini akan dihapus."
        submitting={submitting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
