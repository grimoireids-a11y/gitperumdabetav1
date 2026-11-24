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
  X,
} from 'lucide-react';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  FinanceGlobalFilter,
  FinancePdamMonthlySnapshot,
} from '../../types/finance';
import {
  buildOfficialPDAMCashBankAccounts,
  buildOfficialPDAMCoa,
  buildOfficialPDAMInventory,
  buildOfficialPDAMPurchases,
  buildOfficialPDAMSnapshotSep2026,
} from '../../data/financeStandards';
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
  | 'SURAT_PENGANTAR';

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
  const [newMonth, setNewMonth] = useState('Oktober');
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

  // One-click Idempotent Official PDAM Baseline Seeder
  const handleLoadOfficialBaseline = async () => {
    setSubmitting(true);
    try {
      const targetYear = 2026;
      const coaList = buildOfficialPDAMCoa(targetYear, actor.displayName);
      const cbList = buildOfficialPDAMCashBankAccounts(targetYear, actor.displayName);
      const invList = buildOfficialPDAMInventory(targetYear, 'September', actor.displayName);
      const purList = buildOfficialPDAMPurchases(targetYear, actor.displayName);
      const snap = buildOfficialPDAMSnapshotSep2026(actor.displayName);

      const batch = writeBatch(db);
      coaList.forEach((c) => {
        batch.set(doc(db, 'fin_accounts', c.id), sanitizeFirestoreRecord(c), { merge: true });
      });
      cbList.forEach((cb) => {
        batch.set(doc(db, 'fin_cash_banks', cb.id), sanitizeFirestoreRecord(cb), { merge: true });
      });
      invList.forEach((inv) => {
        batch.set(doc(db, 'fin_inventory', inv.id), sanitizeFirestoreRecord(inv), { merge: true });
      });
      purList.forEach((p) => {
        batch.set(doc(db, 'fin_purchases', p.id), sanitizeFirestoreRecord(p), { merge: true });
      });
      batch.set(doc(db, 'fin_pdam_reports', snap.id), sanitizeFirestoreRecord(snap), {
        merge: true,
      });

      await batch.commit();
      await onLogAudit({
        actionType: 'SEED',
        entityType: 'Baseline Resmi Laporan PDAM Tirta Saiyo',
        entityId: snap.id,
        entityLabel: `Laporan Keuangan & Manajemen September ${targetYear}`,
        summary: `Memuat baseline resmi September 2026 (${coaList.length} COA, ${cbList.length} Kas/Bank, Persediaan, Pembelian & 13 Laporan Operasional)`,
        year: targetYear,
      });

      setSelectedSnapshotId(snap.id);
      setFeedback({
        type: 'success',
        message: `Baseline Resmi PDAM Tirta Saiyo September 2026 berhasil dimuat (${coaList.length} akun COA, ${cbList.length} rekening Kas/Bank, Persediaan, Pembelian, & Snapshot Operasional).`,
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
      const template = activeSnapshot || buildOfficialPDAMSnapshotSep2026(actor.displayName);
      const now = new Date().toISOString();
      const cloned: FinancePdamMonthlySnapshot = sanitizeFirestoreRecord({
        ...JSON.parse(JSON.stringify(template)),
        id,
        year: y,
        month: m,
        letterDate: `Lubuk Sikaping, ${m} ${y}`,
        createdAt: now,
        updatedAt: now,
        updatedBy: actor.displayName,
      });
      await setDoc(doc(db, 'fin_pdam_reports', id), cloned);
      await onLogAudit({
        actionType: 'CREATE',
        entityType: 'Laporan Operasional & Penagihan PDAM',
        entityId: id,
        entityLabel: `${m} ${y}`,
        summary: `Membuat periode laporan operasional PDAM ${m} ${y}`,
        afterData: cloned as unknown as Record<string, unknown>,
        year: y,
      });
      setSelectedSnapshotId(id);
      setIsNewPeriodOpen(false);
      setFeedback({ type: 'success', message: `Periode ${m} ${y} siap diedit.` });
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
          {permissions.canOperate && (
            <button
              type="button"
              disabled={submitting}
              onClick={handleLoadOfficialBaseline}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Muat Baseline Resmi PDAM (Sep 2026)</span>
            </button>
          )}

          {canEditData && (
            <button
              type="button"
              onClick={() => setIsNewPeriodOpen(true)}
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
            Data Operasional & Penagihan PDAM Belum Dimuat
          </p>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            Klik tombol &quot;Muat Baseline Resmi PDAM (Sep 2026)&quot; di atas untuk menginisialisasi 67 akun COA, 8 rekening kas/bank, persediaan kimia & instalasi, pembelian, serta 9 lampiran operasional resmi Perumda Air Minum Tirta Saiyo.
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
                          ) : (
                            m.unit === 'Rp' ? formatRp(m.monthlyReal) : m.monthlyReal.toLocaleString('id-ID')
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {m.unit === 'Rp' ? formatRp(m.monthlyBudget) : m.monthlyBudget.toLocaleString('id-ID')}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums font-semibold">
                          {canEditData ? (
                            <input
                              type="number"
                              value={m.ytdReal}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.summaryMetrics];
                                  next[idx] = { ...next[idx], ytdReal: val };
                                  return { ...prev, summaryMetrics: next };
                                });
                              }}
                              className="w-36 text-right px-2 py-1 border border-slate-200 rounded bg-slate-50 font-mono"
                            />
                          ) : (
                            m.unit === 'Rp' ? formatRp(m.ytdReal) : m.ytdReal.toLocaleString('id-ID')
                          )}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {m.unit === 'Rp' ? formatRp(m.ytdBudget) : m.ytdBudget.toLocaleString('id-ID')}
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
                        <td className="py-1.5 px-3 text-right font-mono">{formatRp(u.prevBilling)}</td>
                        <td className="py-1.5 px-3 text-right font-mono">
                          {canEditData ? (
                            <input
                              type="number"
                              value={u.arrearsCollected}
                              onChange={(e) => {
                                const val = Number(e.target.value) || 0;
                                updateDraft((prev) => {
                                  const next = [...prev.collectionEfficiency];
                                  const totalCollected = val + next[idx].currentCollected;
                                  const prevBill = next[idx].prevBilling || 1;
                                  next[idx] = {
                                    ...next[idx],
                                    arrearsCollected: val,
                                    totalCollected,
                                    totalEfficiencyPct: Math.round((totalCollected / prevBill) * 10000) / 100,
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
                                  const totalCollected = next[idx].arrearsCollected + val;
                                  const prevBill = next[idx].prevBilling || 1;
                                  next[idx] = {
                                    ...next[idx],
                                    currentCollected: val,
                                    totalCollected,
                                    currentEfficiencyPct: Math.round((val / prevBill) * 10000) / 100,
                                    totalEfficiencyPct: Math.round((totalCollected / prevBill) * 10000) / 100,
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
                    {draft.tariffEffectiveness.map((t) => (
                      <tr key={t.tariffCode} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-semibold text-slate-900">{t.tariffName}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatRp(t.receivableMonth1)}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatRp(t.receivableMonth2)}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatRp(t.receivableMonth3)}</td>
                        <td className="py-2 px-3 text-right font-mono text-rose-700">{formatRp(t.receivableAbove3Months)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{formatRp(t.totalReceivable)}</td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-800">{formatRp(t.collectedAmount)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold">{t.effectivenessPct.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
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
                      <th className="py-2.5 px-3 text-right">M3 (Bln Ini)</th>
                      <th className="py-2.5 px-3 text-right">Rupiah (Bln Ini)</th>
                      <th className="py-2.5 px-3 text-right">M3 (s/d Bln Ini)</th>
                      <th className="py-2.5 px-3 text-right">Rupiah (s/d Bln Ini)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.drdSummary.map((d) => (
                      <tr key={`${d.tariffGroup}-${d.tariffName}`} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3">
                          <span className="font-mono text-[10px] text-slate-500 mr-1.5">{d.tariffGroup}</span>
                          <span className="font-semibold text-slate-900">{d.tariffName}</span>
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{d.customerCount.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right font-mono">{d.cubicMetersMonthly.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right font-mono font-semibold">{formatRp(d.billedAmountMonthly)}</td>
                        <td className="py-2 px-3 text-right font-mono">{d.cubicMetersYtd.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">{formatRp(d.billedAmountYtd)}</td>
                      </tr>
                    ))}
                  </tbody>
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
                      <th className="py-2.5 px-3 text-right">Susut Bulan Ini</th>
                      <th className="py-2.5 px-3 text-right">Susut s/d Bulan Ini</th>
                      <th className="py-2.5 px-3 text-right">Akumulasi Susut Akhir</th>
                      <th className="py-2.5 px-3 text-right">Nilai Buku Akhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.assetGroupSummary.map((a) => (
                      <tr key={a.groupCode} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-mono font-bold text-emerald-800">{a.groupCode}</td>
                        <td className="py-2 px-3 font-semibold text-slate-900">{a.groupName}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatRp(a.acquisitionCost)}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatRp(a.depreciationMonthly)}</td>
                        <td className="py-2 px-3 text-right font-mono">{formatRp(a.depreciationYtd)}</td>
                        <td className="py-2 px-3 text-right font-mono text-rose-700">{formatRp(a.accumDepEnding)}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{formatRp(a.bookValueEnding)}</td>
                      </tr>
                    ))}
                  </tbody>
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
                      <th className="py-2.5 px-3 text-right">Terpasang (L/D)</th>
                      <th className="py-2.5 px-3 text-right">Riil (L/D)</th>
                      <th className="py-2.5 px-3 text-right">Produksi M3 (Bln Ini)</th>
                      <th className="py-2.5 px-3 text-right">Distribusi M3</th>
                      <th className="py-2.5 px-3 text-right">Terjual M3</th>
                      <th className="py-2.5 px-3 text-right">NRW M3</th>
                      <th className="py-2.5 px-3 text-right">% NRW Bln Ini</th>
                      <th className="py-2.5 px-3 text-right">% NRW YTD</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {draft.productionDistribution.map((p) => (
                      <tr key={p.unitName} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-semibold text-slate-900">{p.unitName}</td>
                        <td className="py-2 px-3 text-right font-mono">{p.installedCapacityLps}</td>
                        <td className="py-2 px-3 text-right font-mono">{p.realCapacityLps}</td>
                        <td className="py-2 px-3 text-right font-mono">{p.producedM3Monthly.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right font-mono">{p.distributedM3Monthly.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-800 font-semibold">{p.soldM3Monthly.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right font-mono">{p.nrwM3Monthly.toLocaleString('id-ID')}</td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-bold ${
                            p.nrwPctMonthly > 25 ? 'text-rose-700' : 'text-emerald-800'
                          }`}
                        >
                          {p.nrwPctMonthly.toFixed(2)}%
                        </td>
                        <td className="py-2 px-3 text-right font-mono">{p.nrwPctYtd.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
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
                    {draft.customerConnections.map((c) => (
                      <tr key={c.unitName} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-semibold text-slate-900">{c.unitName}</td>
                        <td className="py-2 px-3 text-right font-mono">{c.beginningActive.toLocaleString('id-ID')}</td>
                        <td className="py-2 px-3 text-right font-mono">{c.inactiveCount}</td>
                        <td className="py-2 px-3 text-right font-mono text-rose-700">{c.disconnectedCount}</td>
                        <td className="py-2 px-3 text-right font-mono text-emerald-700">{c.reconnectedCount}</td>
                        <td className="py-2 px-3 text-right font-mono text-teal-800 font-semibold">{c.newConnectionsCount}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{c.endingActive.toLocaleString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
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
                    {draft.employeeComposition.map((e) => (
                      <tr key={e.unitName} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-semibold text-slate-900">{e.unitName}</td>
                        <td className="py-2 px-3 text-right font-mono">{e.direksiCount}</td>
                        <td className="py-2 px-3 text-right font-mono">{e.permanentCount}</td>
                        <td className="py-2 px-3 text-right font-mono">{e.contractCount}</td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">{e.totalCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 9. SURAT PENGANTAR */}
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
                  <label className="block font-semibold mb-1">Tempat & Tanggal Surat</label>
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
                  <label className="block font-semibold mb-1">Kabid Umum & Keuangan</label>
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
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Period Modal */}
      {isNewPeriodOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-sm p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Tambah Periode Laporan PDAM</h3>
              <button type="button" onClick={() => setIsNewPeriodOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
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
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
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
