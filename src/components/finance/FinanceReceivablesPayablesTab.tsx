import React, { useMemo, useState } from 'react';
import {
  Plus,
  Clock,
  CreditCard,
  History,
  AlertTriangle,
  Edit3,
  Trash2,
  X,
} from 'lucide-react';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Unit } from '../../types/audit';
import {
  FinanceAccount,
  FinanceCashBankAccount,
  FinanceGlobalFilter,
  FinanceJournal,
  FinanceReceivablePayable,
  FinanceTransaction,
} from '../../types/finance';
import {
  buildDuplicateKey,
  formatDateShort,
  formatRp,
  getMonthNameFromDate,
  getTodayIso,
  matchesGlobalFilter,
  resolveMonthScopedCoa,
  resolveMonthScopedReceivablesPayables,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';
import { FinanceDeleteConfirmModal } from './FinanceDeleteConfirmModal';

interface FinanceReceivablesPayablesTabProps {
  filter: FinanceGlobalFilter;
  records: FinanceReceivablePayable[];
  accounts: FinanceAccount[];
  cashBankAccounts: FinanceCashBankAccount[];
  units: Unit[];
  actor: FinanceActor;
  permissions: FinancePermissions;
  onLogAudit: LogFinanceAuditFn;
}

const getDaysOverdue = (dueDate: string): number => {
  if (!dueDate) return 0;
  const due = new Date(`${dueDate}T00:00:00`).getTime();
  const today = new Date(`${getTodayIso()}T00:00:00`).getTime();
  if (Number.isNaN(due)) return 0;
  return Math.floor((today - due) / (1000 * 60 * 60 * 24));
};

const getAgingBucket = (dueDate: string, status: string): string => {
  if (status === 'Lunas') return 'Lunas';
  const days = getDaysOverdue(dueDate);
  if (days <= 0) return 'Belum Jatuh Tempo';
  if (days <= 30) return '0-30 Hari';
  if (days <= 60) return '31-60 Hari';
  if (days <= 90) return '61-90 Hari';
  return '> 90 Hari';
};

export const FinanceReceivablesPayablesTab: React.FC<FinanceReceivablesPayablesTabProps> = ({
  filter,
  records,
  accounts,
  cashBankAccounts,
  units,
  actor,
  permissions,
  onLogAudit,
}) => {
  const [kindTab, setKindTab] = useState<'PIUTANG' | 'UTANG'>('PIUTANG');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // Create / Edit Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FinanceReceivablePayable | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [partyName, setPartyName] = useState('');
  const [category, setCategory] = useState('Rekening Air / Tagihan');
  const [unitId, setUnitId] = useState('');
  const [coaId, setCoaId] = useState('');
  const [txDate, setTxDate] = useState(getTodayIso());
  const [dueDate, setDueDate] = useState(getTodayIso());
  const [originalAmount, setOriginalAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Payment Modal
  const [payTarget, setPayTarget] = useState<FinanceReceivablePayable | null>(null);
  const [payDate, setPayDate] = useState(getTodayIso());
  const [payAmount, setPayAmount] = useState('');
  const [payCashBankId, setPayCashBankId] = useState('');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [alsoCreateTx, setAlsoCreateTx] = useState(true);

  // History Drawer Modal
  const [historyTarget, setHistoryTarget] = useState<FinanceReceivablePayable | null>(null);

  // Delete Confirm Modal
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'RECORD'; item: FinanceReceivablePayable }
    | { kind: 'PAYMENT'; record: FinanceReceivablePayable; paymentId: string; referenceNo: string; amount: number }
    | null
  >(null);

  const filteredRecords = useMemo(() => {
    const scoped = resolveMonthScopedReceivablesPayables(records, filter.year, filter.month);
    return scoped
      .filter((r) => {
        if (r.kind !== kindTab) return false;
        if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
        return matchesGlobalFilter(
          {
            date: r.transactionDate,
            unitId: r.unitId,
            coaId: r.coaId,
          },
          { ...filter, year: 0, month: 'ALL' }
        );
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [records, kindTab, statusFilter, filter]);

  const agingSummary = useMemo(() => {
    const buckets = {
      'Belum Jatuh Tempo': 0,
      '0-30 Hari': 0,
      '31-60 Hari': 0,
      '61-90 Hari': 0,
      '> 90 Hari': 0,
    };
    filteredRecords.forEach((r) => {
      if (r.status === 'Lunas') return;
      const b = getAgingBucket(r.dueDate, r.status);
      if (b in buckets) {
        buckets[b as keyof typeof buckets] += r.remainingAmount || 0;
      }
    });
    return buckets;
  }, [filteredRecords]);

  const eligibleCoas = useMemo(() => {
    const typeNeeded = kindTab === 'PIUTANG' ? 'Aset' : 'Kewajiban';
    const scopedCoas = resolveMonthScopedCoa(accounts, filter.year, filter.month).accounts;
    const list = scopedCoas.filter((a) => a.type === typeNeeded && a.isActive !== false);
    return list.length > 0 ? list : scopedCoas;
  }, [accounts, kindTab, filter.year, filter.month]);

  const handleSaveRecord = async () => {
    const amt = Number(originalAmount);
    if (!docNumber.trim() || !partyName.trim() || !Number.isFinite(amt) || amt <= 0) {
      setFeedback({ type: 'error', message: 'Nomor dokumen, pihak terkait, dan nominal > 0 wajib diisi.' });
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = editingRecord?.id || `rp-${Date.now()}`;
      const year = parseInt(txDate.slice(0, 4), 10) || new Date().getFullYear();
      const month = getMonthNameFromDate(txDate);
      const u = units.find((x) => x.id === unitId);
      const c = eligibleCoas.find((x) => x.id === coaId);
      const roundedOrig = Math.round(amt);
      const paid = editingRecord?.paidAmount || 0;
      const remaining = Math.max(0, roundedOrig - paid);
      const computedStatus: FinanceReceivablePayable['status'] =
        remaining === 0 ? 'Lunas' : paid > 0 ? 'Sebagian' : 'Belum Lunas';

      const rec: FinanceReceivablePayable = sanitizeFirestoreRecord({
        id,
        kind: editingRecord?.kind || kindTab,
        documentNumber: docNumber.trim(),
        partyName: partyName.trim(),
        category: category.trim(),
        unitId: u?.id || '',
        unitName: u?.name || 'Kantor Pusat',
        coaId: c?.id || editingRecord?.coaId || '',
        coaCode: c?.code || editingRecord?.coaCode || (kindTab === 'PIUTANG' ? '1-1301' : '2-1101'),
        transactionDate: txDate,
        dueDate,
        year,
        month,
        originalAmount: roundedOrig,
        paidAmount: paid,
        remainingAmount: remaining,
        status: computedStatus,
        payments: editingRecord?.payments || [],
        notes: notes.trim() || undefined,
        createdBy: editingRecord?.createdBy || actor.displayName,
        createdAt: editingRecord?.createdAt || now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_receivables_payables', id), rec);
      await onLogAudit({
        actionType: editingRecord ? 'UPDATE' : 'CREATE',
        entityType: rec.kind === 'PIUTANG' ? 'Daftar Piutang' : 'Daftar Utang',
        entityId: id,
        entityLabel: rec.documentNumber,
        summary: `${editingRecord ? 'Pembaruan' : 'Pencatatan'} ${rec.kind === 'PIUTANG' ? 'piutang' : 'utang'} ${rec.documentNumber} (${rec.partyName}) sebesar ${formatRp(rec.originalAmount)}`,
        beforeData: editingRecord ? (editingRecord as unknown as Record<string, unknown>) : null,
        afterData: rec as unknown as Record<string, unknown>,
        year,
      });

      setIsCreateOpen(false);
      setEditingRecord(null);
      setFeedback({
        type: 'success',
        message: `${rec.documentNumber} berhasil ${editingRecord ? 'diperbarui' : 'disimpan'}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !permissions.isSuperUser) return;
    setSubmitting(true);
    try {
      if (deleteTarget.kind === 'RECORD') {
        const rec = deleteTarget.item;
        await deleteDoc(doc(db, 'fin_receivables_payables', rec.id));
        await onLogAudit({
          actionType: 'DELETE',
          entityType: rec.kind === 'PIUTANG' ? 'Daftar Piutang' : 'Daftar Utang',
          entityId: rec.id,
          entityLabel: rec.documentNumber,
          summary: `Super User menghapus ${rec.kind.toLowerCase()} ${rec.documentNumber} (${rec.partyName})`,
          beforeData: rec as unknown as Record<string, unknown>,
          afterData: null,
          year: rec.year,
        });
        setFeedback({ type: 'success', message: `${rec.documentNumber} berhasil dihapus permanen.` });
      } else {
        const { record, paymentId, referenceNo, amount } = deleteTarget;
        const now = new Date().toISOString();
        const remainingPayments = (record.payments || []).filter((p) => p.id !== paymentId);
        const newPaid = remainingPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const newRem = Math.max(0, (record.originalAmount || 0) - newPaid);
        const newStatus: FinanceReceivablePayable['status'] =
          newRem === 0 ? 'Lunas' : newPaid > 0 ? 'Sebagian' : 'Belum Lunas';

        const updated: FinanceReceivablePayable = sanitizeFirestoreRecord({
          ...record,
          paidAmount: newPaid,
          remainingAmount: newRem,
          status: newStatus,
          payments: remainingPayments,
          updatedAt: now,
        });
        await setDoc(doc(db, 'fin_receivables_payables', record.id), updated);
        await onLogAudit({
          actionType: 'UPDATE',
          entityType: `Riwayat Pembayaran ${record.kind}`,
          entityId: record.id,
          entityLabel: record.documentNumber,
          summary: `Super User menghapus entri pembayaran ${referenceNo} (${formatRp(amount)}) pada ${record.documentNumber}`,
          beforeData: record as unknown as Record<string, unknown>,
          afterData: updated as unknown as Record<string, unknown>,
          year: record.year,
        });
        setHistoryTarget(updated);
        setFeedback({ type: 'success', message: `Entri pembayaran ${referenceNo} berhasil dihapus.` });
      }
      setDeleteTarget(null);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menghapus data: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePayment = async () => {
    if (!payTarget) return;
    const amt = Math.round(Number(payAmount));
    if (!Number.isFinite(amt) || amt <= 0 || amt > payTarget.remainingAmount) {
      setFeedback({
        type: 'error',
        message: `Nominal pembayaran harus > 0 dan tidak melebihi sisa ${formatRp(payTarget.remainingAmount)}.`,
      });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const cb = cashBankAccounts.find((c) => c.id === payCashBankId) || cashBankAccounts[0];
      const paymentItem = {
        id: `pay-${Date.now()}`,
        paymentDate: payDate,
        amount: amt,
        cashBankId: cb?.id || '',
        cashBankName: cb?.name || 'Kas / Bank',
        referenceNo: payRef.trim() || `PAY-${Date.now().toString().slice(-4)}`,
        notes: payNotes.trim() || undefined,
        recordedBy: actor.displayName,
        createdAt: now,
      };

      const newPaid = (payTarget.paidAmount || 0) + amt;
      const newRem = Math.max(0, (payTarget.originalAmount || 0) - newPaid);
      const newStatus: FinanceReceivablePayable['status'] =
        newRem === 0 ? 'Lunas' : 'Sebagian';

      const updated: FinanceReceivablePayable = sanitizeFirestoreRecord({
        ...payTarget,
        paidAmount: newPaid,
        remainingAmount: newRem,
        status: newStatus,
        payments: [...(payTarget.payments || []), sanitizeFirestoreRecord(paymentItem)],
        updatedAt: now,
      });

      const batch = writeBatch(db);
      batch.set(doc(db, 'fin_receivables_payables', payTarget.id), updated);

      if (alsoCreateTx && cb) {
        const year = parseInt(payDate.slice(0, 4), 10) || new Date().getFullYear();
        const month = getMonthNameFromDate(payDate);
        const isReceivable = payTarget.kind === 'PIUTANG';
        const txId = `tx-rp-${Date.now()}`;
        const jrnId = `jrn-${txId}`;
        const voucherNo = `${isReceivable ? 'BKM' : 'BKK'}-RP-${Date.now().toString().slice(-4)}`;

        const tx: FinanceTransaction = sanitizeFirestoreRecord({
          id: txId,
          voucherNumber: voucherNo,
          type: isReceivable ? 'PENERIMAAN' : 'PENGELUARAN',
          subCategory: isReceivable ? 'Penerimaan Rekening Air' : 'Pengeluaran Operasional',
          transactionDate: payDate,
          year,
          month,
          description: `Pembayaran ${isReceivable ? 'Piutang' : 'Utang'} ${payTarget.documentNumber} - ${payTarget.partyName}`,
          counterpartyName: payTarget.partyName,
          unitId: payTarget.unitId,
          unitName: payTarget.unitName,
          bidangName: 'Keuangan & Penagihan',
          cashBankId: cb.id,
          cashBankName: cb.name,
          coaId: payTarget.coaId,
          coaCode: payTarget.coaCode,
          coaName: isReceivable ? 'Pelunasan Piutang' : 'Pelunasan Utang',
          amount: amt,
          status: 'Disetujui / Diposting',
          attachments: [],
          duplicateKey: buildDuplicateKey({
            type: isReceivable ? 'PENERIMAAN' : 'PENGELUARAN',
            transactionDate: payDate,
            amount: amt,
            coaId: payTarget.coaId,
            counterpartyName: payTarget.partyName,
          }),
          linkedJournalId: jrnId,
          linkedReceivablePayableId: payTarget.id,
          createdBy: actor.displayName,
          createdByUid: actor.uid,
          createdByRole: actor.role,
          approvedBy: actor.displayName,
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        const cashCoa = accounts.find((a) => a.id === cb.coaId || a.code === cb.coaCode);
        const targetCoa = accounts.find((a) => a.id === payTarget.coaId || a.code === payTarget.coaCode);

        const jrn: FinanceJournal = {
          id: jrnId,
          journalNumber: `JRN-${voucherNo}`,
          journalType: isReceivable ? 'PENERIMAAN' : 'PENGELUARAN',
          journalDate: payDate,
          year,
          month,
          referenceNumber: voucherNo,
          sourceTransactionId: txId,
          description: tx.description,
          unitId: payTarget.unitId,
          unitName: payTarget.unitName,
          lines: isReceivable
            ? [
                {
                  coaId: cashCoa?.id || cb.coaId,
                  coaCode: cashCoa?.code || cb.coaCode,
                  coaName: cashCoa?.name || cb.name,
                  debit: amt,
                  credit: 0,
                },
                {
                  coaId: targetCoa?.id || payTarget.coaId,
                  coaCode: targetCoa?.code || payTarget.coaCode,
                  coaName: targetCoa?.name || 'Piutang Usaha',
                  debit: 0,
                  credit: amt,
                },
              ]
            : [
                {
                  coaId: targetCoa?.id || payTarget.coaId,
                  coaCode: targetCoa?.code || payTarget.coaCode,
                  coaName: targetCoa?.name || 'Utang Usaha',
                  debit: amt,
                  credit: 0,
                },
                {
                  coaId: cashCoa?.id || cb.coaId,
                  coaCode: cashCoa?.code || cb.coaCode,
                  coaName: cashCoa?.name || cb.name,
                  debit: 0,
                  credit: amt,
                },
              ],
          totalDebit: amt,
          totalCredit: amt,
          status: 'Posted',
          createdBy: actor.displayName,
          createdByUid: actor.uid,
          createdAt: now,
          updatedAt: now,
        };

        batch.set(doc(db, 'fin_transactions', txId), tx);
        batch.set(doc(db, 'fin_journals', jrnId), jrn);
      }

      await batch.commit();
      await onLogAudit({
        actionType: 'UPDATE',
        entityType: `Pembayaran ${payTarget.kind}`,
        entityId: payTarget.id,
        entityLabel: payTarget.documentNumber,
        summary: `Pembayaran ${formatRp(amt)} untuk ${payTarget.documentNumber} (Sisa: ${formatRp(newRem)})`,
        beforeData: payTarget as unknown as Record<string, unknown>,
        afterData: updated as unknown as Record<string, unknown>,
        year: payTarget.year,
      });

      setPayTarget(null);
      setFeedback({ type: 'success', message: `Pembayaran ${formatRp(amt)} berhasil dicatat.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal mencatat pembayaran: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
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

      {/* Kind Switcher & Action Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setKindTab('PIUTANG')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer ${
              kindTab === 'PIUTANG'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Daftar & Umur Piutang
          </button>
          <button
            type="button"
            onClick={() => setKindTab('UTANG')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer ${
              kindTab === 'UTANG'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Daftar & Umur Utang
          </button>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
          >
            <option value="ALL">Semua Status</option>
            <option value="Belum Lunas">Belum Lunas</option>
            <option value="Sebagian">Dibayar Sebagian</option>
            <option value="Lunas">Lunas</option>
          </select>
        </div>

        {permissions.canOperate && (
          <button
            type="button"
            onClick={() => {
              setEditingRecord(null);
              setDocNumber(
                `${kindTab === 'PIUTANG' ? 'INV' : 'AP'}-${filter.year || new Date().getFullYear()}-${String(records.length + 1).padStart(3, '0')}`
              );
              setPartyName('');
              setCategory(kindTab === 'PIUTANG' ? 'Piutang Rekening Air' : 'Utang Pengadaan Rekanan');
              setUnitId(units[0]?.id || '');
              setCoaId(eligibleCoas[0]?.id || '');
              setTxDate(getTodayIso());
              setDueDate(getTodayIso());
              setOriginalAmount('');
              setNotes('');
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah {kindTab === 'PIUTANG' ? 'Piutang' : 'Utang'}</span>
          </button>
        )}
      </div>

      {/* Aging Buckets Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Object.entries(agingSummary).map(([bucket, total]) => (
          <div key={bucket} className="bg-white border border-slate-200 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-slate-500 flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-400" />
              Umur {bucket}
            </span>
            <p
              className={`mt-1.5 text-sm font-bold font-mono tabular-nums ${
                bucket === '> 90 Hari' && total > 0 ? 'text-rose-700' : 'text-slate-900'
              }`}
            >
              {formatRp(total)}
            </p>
          </div>
        ))}
      </div>

      {/* List Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-3">Dokumen & Tanggal</th>
                <th className="py-2.5 px-3">{kindTab === 'PIUTANG' ? 'Debitur / Pelanggan' : 'Kreditur / Rekanan'}</th>
                <th className="py-2.5 px-3">Jatuh Tempo & Umur</th>
                <th className="py-2.5 px-3 text-right">Nominal Awal</th>
                <th className="py-2.5 px-3 text-right">Terbayar</th>
                <th className="py-2.5 px-3 text-right">Sisa</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Belum ada data {kindTab.toLowerCase()} pada filter terpilih.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r) => {
                  const daysOver = getDaysOverdue(r.dueDate);
                  const bucket = getAgingBucket(r.dueDate, r.status);
                  const isOverdue = r.status !== 'Lunas' && daysOver > 0;
                  return (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-slate-900">{r.documentNumber}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatDateShort(r.transactionDate)} · {r.coaCode}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">{r.partyName}</div>
                        <div className="text-[11px] text-slate-500">
                          {r.category} · {r.unitName}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-mono text-slate-800">{formatDateShort(r.dueDate)}</div>
                        <div
                          className={`text-[11px] font-semibold flex items-center gap-1 ${
                            isOverdue ? 'text-rose-700' : 'text-slate-500'
                          }`}
                        >
                          {isOverdue && <AlertTriangle className="w-3 h-3" />}
                          <span>
                            {r.status === 'Lunas'
                              ? 'Lunas'
                              : isOverdue
                              ? `Terlambat ${daysOver} hari (${bucket})`
                              : bucket}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatRp(r.originalAmount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                        {formatRp(r.paidAmount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatRp(r.remainingAmount)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border ${
                            r.status === 'Lunas'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : r.status === 'Sebagian'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setHistoryTarget(r)}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded cursor-pointer"
                            title="Riwayat Pembayaran"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          {permissions.canOperate && r.status !== 'Lunas' && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayTarget(r);
                                setPayDate(getTodayIso());
                                setPayAmount(String(r.remainingAmount));
                                setPayCashBankId(cashBankAccounts[0]?.id || '');
                                setPayRef('');
                                setPayNotes('');
                                setAlsoCreateTx(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer"
                            >
                              <CreditCard className="w-3 h-3" />
                              <span>Bayar</span>
                            </button>
                          )}
                          {permissions.isSuperUser && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRecord(r);
                                  setDocNumber(r.documentNumber);
                                  setPartyName(r.partyName);
                                  setCategory(r.category);
                                  setUnitId(r.unitId || '');
                                  setCoaId(r.coaId || '');
                                  setTxDate(r.transactionDate);
                                  setDueDate(r.dueDate);
                                  setOriginalAmount(String(r.originalAmount));
                                  setNotes(r.notes || '');
                                  setIsCreateOpen(true);
                                }}
                                className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded cursor-pointer"
                                title="Edit Tagihan (Super User)"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({ kind: 'RECORD', item: r })}
                                className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded cursor-pointer"
                                title="Hapus Tagihan (Super User)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {editingRecord
                  ? `Edit ${editingRecord.kind === 'PIUTANG' ? 'Piutang' : 'Utang'} — ${editingRecord.documentNumber}`
                  : `Catat ${kindTab === 'PIUTANG' ? 'Piutang Baru' : 'Utang Baru'}`}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false);
                  setEditingRecord(null);
                }}
                className="cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Nomor Tagihan / Faktur *</label>
                <input
                  type="text"
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Kategori</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">
                {kindTab === 'PIUTANG' ? 'Nama Pelanggan / Debitur *' : 'Nama Rekanan / Kreditur *'}
              </label>
              <input
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Tanggal Tagihan</label>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Tanggal Jatuh Tempo *</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Unit Kerja</label>
                <select
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="">Kantor Pusat</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Akun COA</label>
                <select
                  value={coaId}
                  onChange={(e) => setCoaId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {eligibleCoas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Nominal Tagihan (Rp) *</label>
              <input
                type="number"
                value={originalAmount}
                onChange={(e) => setOriginalAmount(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Catatan (Opsional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsCreateOpen(false);
                  setEditingRecord(null);
                }}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveRecord}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Catat Pembayaran {payTarget.documentNumber}
              </h3>
              <button type="button" onClick={() => setPayTarget(null)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <p className="text-slate-600">
              Pihak: <strong>{payTarget.partyName}</strong> · Sisa Tagihan:{' '}
              <strong className="font-mono text-slate-900">{formatRp(payTarget.remainingAmount)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Tanggal Bayar</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nominal Bayar (Rp)</label>
                <input
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Melalui Rekening Kas / Bank</label>
              <select
                value={payCashBankId}
                onChange={(e) => setPayCashBankId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                {cashBankAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Nomor Referensi / Kwitansi</label>
              <input
                type="text"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <label className="flex items-center gap-2 font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoCreateTx}
                onChange={(e) => setAlsoCreateTx(e.target.checked)}
                className="rounded text-emerald-700"
              />
              <span>Otomatis catat di Kas/Bank & Jurnal Akuntansi</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSavePayment}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Simpan Pembayaran
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {historyTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Riwayat Pembayaran — {historyTarget.documentNumber}
              </h3>
              <button type="button" onClick={() => setHistoryTarget(null)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            {(!historyTarget.payments || historyTarget.payments.length === 0) ? (
              <p className="py-6 text-center text-slate-500">Belum ada riwayat pembayaran.</p>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {historyTarget.payments.map((p) => (
                  <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-mono font-bold text-slate-900">
                        {formatDateShort(p.paymentDate)} · {p.referenceNo}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {p.cashBankName} · Dicatat oleh {p.recordedBy}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="font-mono font-bold text-emerald-800">{formatRp(p.amount)}</div>
                      {permissions.isSuperUser && (
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              kind: 'PAYMENT',
                              record: historyTarget,
                              paymentId: p.id,
                              referenceNo: p.referenceNo,
                              amount: p.amount,
                            })
                          }
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                          title="Hapus Entri Pembayaran (Super User)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <FinanceDeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        title={
          deleteTarget?.kind === 'PAYMENT'
            ? 'Hapus Entri Pembayaran'
            : `Hapus Data ${kindTab === 'PIUTANG' ? 'Piutang' : 'Utang'}`
        }
        itemLabel={
          deleteTarget?.kind === 'RECORD'
            ? `${deleteTarget.item.documentNumber} - ${deleteTarget.item.partyName}`
            : deleteTarget?.kind === 'PAYMENT'
            ? `${deleteTarget.referenceNo} (${formatRp(deleteTarget.amount)})`
            : ''
        }
        description={
          deleteTarget?.kind === 'PAYMENT'
            ? 'Saldo terbayar dan sisa tagihan akan dihitung ulang otomatis.'
            : 'Data tagihan dan seluruh riwayat pembayarannya pada catatan ini akan dihapus permanen.'
        }
        submitting={submitting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
