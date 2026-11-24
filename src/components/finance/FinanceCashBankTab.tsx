import React, { useMemo, useState } from 'react';
import {
  Plus,
  ArrowLeftRight,
  CheckCircle2,
  Landmark,
  Wallet,
  Scale,
  X,
} from 'lucide-react';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Unit } from '../../types/audit';
import {
  FinanceAccount,
  FinanceBankReconciliation,
  FinanceCashBankAccount,
  FinanceCashBankKind,
  FinanceGlobalFilter,
  FinanceJournal,
  FinancePeriodClose,
  FinanceTransaction,
} from '../../types/finance';
import {
  CashBankComputedAccount,
  buildDuplicateKey,
  formatDateShort,
  formatRp,
  getMonthNameFromDate,
  getTodayIso,
  isPeriodLocked,
  matchesGlobalFilter,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';

interface FinanceCashBankTabProps {
  filter: FinanceGlobalFilter;
  cashBankSummary: {
    accounts: CashBankComputedAccount[];
    totalCashBalance: number;
    totalBankBalance: number;
    totalLiquidBalance: number;
  };
  transactions: FinanceTransaction[];
  accounts: FinanceAccount[];
  reconciliations: FinanceBankReconciliation[];
  periodCloses: FinancePeriodClose[];
  units: Unit[];
  actor: FinanceActor;
  permissions: FinancePermissions;
  onLogAudit: LogFinanceAuditFn;
}

type CashBankView = 'BKU' | 'KAS_KECIL' | 'MUTASI_BANK' | 'REKENING' | 'REKONSILIASI' | 'SALDO_HARIAN';

export const FinanceCashBankTab: React.FC<FinanceCashBankTabProps> = ({
  filter,
  cashBankSummary,
  transactions,
  accounts,
  reconciliations,
  periodCloses,
  units,
  actor,
  permissions,
  onLogAudit,
}) => {
  const [subView, setSubView] = useState<CashBankView>('BKU');
  const [selectedCashBankId, setSelectedCashBankId] = useState<string>('ALL');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // Modal Tambah/Edit Rekening Kas & Bank
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<FinanceCashBankAccount | null>(null);
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [accKind, setAccKind] = useState<FinanceCashBankKind>('BANK');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accCoaId, setAccCoaId] = useState('');
  const [accOpeningBalance, setAccOpeningBalance] = useState('0');
  const [accUnitId, setAccUnitId] = useState('');

  // Modal Transfer Antarbank / Kas
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [trVoucher, setTrVoucher] = useState('');
  const [trDate, setTrDate] = useState(getTodayIso());
  const [trSourceId, setTrSourceId] = useState('');
  const [trTargetId, setTrTargetId] = useState('');
  const [trAmount, setTrAmount] = useState('');
  const [trDesc, setTrDesc] = useState('');

  // Modal Rekonsiliasi Bank
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);
  const [recCashBankId, setRecCashBankId] = useState('');
  const [recDate, setRecDate] = useState(getTodayIso());
  const [recBankBalance, setRecBankBalance] = useState('0');
  const [recInTransit, setRecInTransit] = useState('0');
  const [recOutstanding, setRecOutstanding] = useState('0');
  const [recAdminFee, setRecAdminFee] = useState('0');
  const [recInterest, setRecInterest] = useState('0');
  const [recNotes, setRecNotes] = useState('');

  const cashBankCoaOptions = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.isActive !== false &&
          (a.cashFlowGroup === 'Kas' || a.code.startsWith('1-11') || a.code.startsWith('1-12'))
      ),
    [accounts]
  );

  // BKU / Mutasi Ledger Rows with Running Balance
  const ledgerRows = useMemo(() => {
    const scopeAccounts =
      subView === 'KAS_KECIL'
        ? cashBankSummary.accounts.filter((a) => a.accountKind === 'KAS_KECIL')
        : subView === 'MUTASI_BANK'
        ? cashBankSummary.accounts.filter((a) => a.accountKind === 'BANK')
        : selectedCashBankId !== 'ALL'
        ? cashBankSummary.accounts.filter((a) => a.id === selectedCashBankId)
        : cashBankSummary.accounts;

    const scopeIds = new Set(scopeAccounts.map((a) => a.id));
    const openingSum = scopeAccounts.reduce((s, a) => s + (a.openingBalance || 0), 0);

    const posted = transactions
      .filter((t) => {
        if (t.status !== 'Disetujui / Diposting') return false;
        const hitsSource = scopeIds.has(t.cashBankId);
        const hitsTarget = t.type === 'TRANSFER' && t.targetCashBankId && scopeIds.has(t.targetCashBankId);
        if (!hitsSource && !hitsTarget) return false;
        return matchesGlobalFilter(
          {
            year: t.year,
            month: t.month,
            date: t.transactionDate,
            bidang: t.bidangName,
            unitId: t.unitId,
          },
          filter
        );
      })
      .sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));

    let running = openingSum;
    const rows = posted.map((tx) => {
      let debit = 0;
      let credit = 0;
      if (tx.type === 'PENERIMAAN') {
        debit = tx.amount;
      } else if (tx.type === 'PENGELUARAN') {
        credit = tx.amount;
      } else if (tx.type === 'TRANSFER') {
        if (scopeIds.has(tx.targetCashBankId || '') && !scopeIds.has(tx.cashBankId)) {
          debit = tx.amount;
        } else if (scopeIds.has(tx.cashBankId) && !scopeIds.has(tx.targetCashBankId || '')) {
          credit = tx.amount;
        } else {
          // Internal transfer within selected scope
          debit = tx.amount;
          credit = tx.amount;
        }
      }
      running += debit - credit;
      return {
        tx,
        debit,
        credit,
        runningBalance: running,
      };
    });

    return { openingSum, rows, endingBalance: running };
  }, [cashBankSummary.accounts, transactions, subView, selectedCashBankId, filter]);

  // Daily Balance Summary (Saldo Harian)
  const dailyBalances = useMemo(() => {
    const byDate = new Map<string, { debit: number; credit: number; closing: number; count: number }>();
    ledgerRows.rows.forEach((r) => {
      const d = r.tx.transactionDate;
      const cur = byDate.get(d) || { debit: 0, credit: 0, closing: r.runningBalance, count: 0 };
      cur.debit += r.debit;
      cur.credit += r.credit;
      cur.closing = r.runningBalance;
      cur.count += 1;
      byDate.set(d, cur);
    });
    return Array.from(byDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [ledgerRows]);

  const handleSaveAccount = async () => {
    if (!accCode.trim() || !accName.trim()) {
      setFeedback({ type: 'error', message: 'Kode dan nama rekening kas/bank wajib diisi.' });
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = editingAccount?.id || `cb-${Date.now()}`;
      const selectedCoa = cashBankCoaOptions.find((a) => a.id === accCoaId) || accounts[0];
      const selectedUnit = units.find((u) => u.id === accUnitId);

      const record: FinanceCashBankAccount = sanitizeFirestoreRecord({
        id,
        code: accCode.trim(),
        name: accName.trim(),
        accountKind: accKind,
        bankName: accKind === 'BANK' ? bankName.trim() : undefined,
        accountNumber: accKind === 'BANK' ? accountNumber.trim() : undefined,
        coaId: selectedCoa?.id || accCoaId || 'coa-kas',
        coaCode: selectedCoa?.code || '1-1101',
        unitId: selectedUnit?.id || '',
        unitName: selectedUnit?.name || 'Kantor Pusat',
        openingBalance: Number(accOpeningBalance) || 0,
        isActive: true,
        createdBy: editingAccount?.createdBy || actor.displayName,
        createdAt: editingAccount?.createdAt || now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_cash_banks', id), record);
      await onLogAudit({
        actionType: editingAccount ? 'UPDATE' : 'CREATE',
        entityType: 'Rekening Kas & Bank',
        entityId: id,
        entityLabel: `${record.code} - ${record.name}`,
        summary: `${editingAccount ? 'Pembaruan' : 'Penambahan'} rekening kas/bank ${record.name}`,
        beforeData: editingAccount ? (editingAccount as unknown as Record<string, unknown>) : null,
        afterData: record as unknown as Record<string, unknown>,
      });

      setIsAccountModalOpen(false);
      setFeedback({ type: 'success', message: `Rekening ${record.name} berhasil disimpan.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan rekening: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveTransfer = async () => {
    const amt = Number(trAmount);
    if (!trSourceId || !trTargetId || trSourceId === trTargetId || !Number.isFinite(amt) || amt <= 0) {
      setFeedback({
        type: 'error',
        message: 'Pilih rekening asal dan tujuan yang berbeda serta isi nominal > 0.',
      });
      return;
    }
    const year = parseInt(trDate.slice(0, 4), 10) || new Date().getFullYear();
    const month = getMonthNameFromDate(trDate);
    if (isPeriodLocked(periodCloses, year, month)) {
      setFeedback({ type: 'error', message: `Periode ${month} ${year} telah ditutup buku.` });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const src = cashBankSummary.accounts.find((a) => a.id === trSourceId)!;
      const dst = cashBankSummary.accounts.find((a) => a.id === trTargetId)!;
      const txId = `tx-trf-${Date.now()}`;
      const jrnId = `jrn-${txId}`;
      const voucher = trVoucher.trim() || `TRF-${year}-${Date.now().toString().slice(-4)}`;

      const tx: FinanceTransaction = sanitizeFirestoreRecord({
        id: txId,
        voucherNumber: voucher,
        type: 'TRANSFER',
        subCategory: 'Transfer Antarbank / Kas',
        transactionDate: trDate,
        year,
        month,
        description: trDesc.trim() || `Pemindahbukuan dari ${src.name} ke ${dst.name}`,
        counterpartyName: dst.name,
        unitId: actor.unitId || '',
        unitName: actor.unitName || 'Bidang Umum dan Keuangan',
        bidangName: 'Keuangan & Penagihan',
        cashBankId: src.id,
        cashBankName: src.name,
        targetCashBankId: dst.id,
        targetCashBankName: dst.name,
        coaId: dst.coaId,
        coaCode: dst.coaCode,
        coaName: dst.name,
        amount: Math.round(amt),
        status: 'Disetujui / Diposting',
        attachments: [],
        duplicateKey: buildDuplicateKey({
          type: 'TRANSFER',
          transactionDate: trDate,
          amount: Math.round(amt),
          coaId: dst.coaId,
          counterpartyName: dst.name,
        }),
        linkedJournalId: jrnId,
        createdBy: actor.displayName,
        createdByUid: actor.uid,
        createdByRole: actor.role,
        approvedBy: actor.displayName,
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const journal: FinanceJournal = {
        id: jrnId,
        journalNumber: `JRN-${voucher}`,
        journalType: 'UMUM',
        journalDate: trDate,
        year,
        month,
        referenceNumber: voucher,
        sourceTransactionId: txId,
        description: tx.description,
        unitId: tx.unitId,
        unitName: tx.unitName,
        lines: [
          {
            coaId: dst.coaId,
            coaCode: dst.coaCode,
            coaName: dst.name,
            description: `Penerimaan transfer dari ${src.name}`,
            debit: tx.amount,
            credit: 0,
          },
          {
            coaId: src.coaId,
            coaCode: src.coaCode,
            coaName: src.name,
            description: `Pengiriman transfer ke ${dst.name}`,
            debit: 0,
            credit: tx.amount,
          },
        ],
        totalDebit: tx.amount,
        totalCredit: tx.amount,
        status: 'Posted',
        createdBy: actor.displayName,
        createdByUid: actor.uid,
        createdAt: now,
        updatedAt: now,
      };

      const batch = writeBatch(db);
      batch.set(doc(db, 'fin_transactions', txId), tx);
      batch.set(doc(db, 'fin_journals', jrnId), journal);
      await batch.commit();

      await onLogAudit({
        actionType: 'POST',
        entityType: 'Transfer Kas/Bank',
        entityId: txId,
        entityLabel: voucher,
        summary: `Transfer ${formatRp(tx.amount)} dari ${src.name} ke ${dst.name}`,
        afterData: tx as unknown as Record<string, unknown>,
        year,
      });

      setIsTransferOpen(false);
      setFeedback({ type: 'success', message: `Transfer ${voucher} berhasil diposting.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal transfer: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const selectedRecAccount = useMemo(
    () => cashBankSummary.accounts.find((a) => a.id === recCashBankId),
    [cashBankSummary.accounts, recCashBankId]
  );

  const recBookBal = selectedRecAccount?.currentBalance || 0;
  const recAdjBook =
    recBookBal + (Number(recInterest) || 0) - (Number(recAdminFee) || 0);
  const recAdjBank =
    (Number(recBankBalance) || 0) +
    (Number(recInTransit) || 0) -
    (Number(recOutstanding) || 0);
  const recDiff = recAdjBook - recAdjBank;

  const handleSaveReconciliation = async () => {
    if (!selectedRecAccount) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = `rec-${Date.now()}`;
      const year = parseInt(recDate.slice(0, 4), 10) || new Date().getFullYear();
      const month = getMonthNameFromDate(recDate);
      const record: FinanceBankReconciliation = sanitizeFirestoreRecord({
        id,
        cashBankId: selectedRecAccount.id,
        cashBankName: selectedRecAccount.name,
        year,
        month,
        reconcileDate: recDate,
        bookBalance: recBookBal,
        bankStatementBalance: Number(recBankBalance) || 0,
        inTransitDeposits: Number(recInTransit) || 0,
        outstandingChecks: Number(recOutstanding) || 0,
        bankAdminFee: Number(recAdminFee) || 0,
        bankInterest: Number(recInterest) || 0,
        adjustedBookBalance: recAdjBook,
        adjustedBankBalance: recAdjBank,
        difference: recDiff,
        status: Math.abs(recDiff) < 1 ? 'Sesuai' : 'Selisih',
        notes: recNotes.trim() || undefined,
        reconciledBy: actor.displayName,
        createdAt: now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_bank_reconciliations', id), record);
      await onLogAudit({
        actionType: 'CREATE',
        entityType: 'Rekonsiliasi Bank',
        entityId: id,
        entityLabel: `${record.cashBankName} (${record.month} ${record.year})`,
        summary: `Rekonsiliasi ${record.cashBankName}: Status ${record.status}, Selisih ${formatRp(record.difference)}`,
        afterData: record as unknown as Record<string, unknown>,
        year,
      });
      setIsReconcileOpen(false);
      setFeedback({
        type: 'success',
        message: `Rekonsiliasi ${record.cashBankName} disimpan (${record.status}).`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan rekonsiliasi: ${err instanceof Error ? err.message : 'Error'}`,
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

      {/* Account Balances Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cashBankSummary.accounts.map((acc) => (
          <div key={acc.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>
                {acc.code} · {acc.accountKind === 'BANK' ? 'Bank' : acc.accountKind === 'KAS_KECIL' ? 'Kas Kecil' : 'Kas Besar'}
              </span>
              {acc.accountKind === 'BANK' ? (
                <Landmark className="w-3.5 h-3.5 text-teal-700" />
              ) : (
                <Wallet className="w-3.5 h-3.5 text-emerald-700" />
              )}
            </div>
            <p className="mt-1 text-xs font-bold text-slate-900 truncate">{acc.name}</p>
            <p className="mt-1.5 text-base font-bold text-slate-900 font-mono tabular-nums">
              {formatRp(acc.currentBalance)}
            </p>
            {acc.accountNumber && (
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{acc.accountNumber}</p>
            )}
          </div>
        ))}
      </div>

      {/* Sub-navigation & Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'BKU', label: 'Buku Kas Umum' },
            { id: 'KAS_KECIL', label: 'Kas Kecil' },
            { id: 'MUTASI_BANK', label: 'Mutasi Bank' },
            { id: 'REKENING', label: 'Daftar Rekening Bank & Kas' },
            { id: 'REKONSILIASI', label: 'Rekonsiliasi Bank' },
            { id: 'SALDO_HARIAN', label: 'Saldo Harian' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubView(tab.id as CashBankView)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subView === tab.id
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {permissions.canOperate && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTrVoucher(`TRF-${filter.year || new Date().getFullYear()}-${String(transactions.length + 1).padStart(3, '0')}`);
                setTrSourceId(cashBankSummary.accounts[0]?.id || '');
                setTrTargetId(cashBankSummary.accounts[1]?.id || '');
                setTrAmount('');
                setTrDesc('');
                setIsTransferOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              <span>Transfer Antarbank / Kas</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const bankAcc = cashBankSummary.accounts.find((a) => a.accountKind === 'BANK') || cashBankSummary.accounts[0];
                setRecCashBankId(bankAcc?.id || '');
                setRecBankBalance(String(bankAcc?.currentBalance || 0));
                setRecInTransit('0');
                setRecOutstanding('0');
                setRecAdminFee('0');
                setRecInterest('0');
                setRecNotes('');
                setIsReconcileOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Rekonsiliasi Bank</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingAccount(null);
                setAccCode(`BNK-${String(cashBankSummary.accounts.length + 1).padStart(2, '0')}`);
                setAccName('');
                setAccKind('BANK');
                setBankName('');
                setAccountNumber('');
                setAccCoaId(cashBankCoaOptions[0]?.id || '');
                setAccOpeningBalance('0');
                setAccUnitId('');
                setIsAccountModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Rekening</span>
            </button>
          </div>
        )}
      </div>

      {/* Views */}
      {(subView === 'BKU' || subView === 'KAS_KECIL' || subView === 'MUTASI_BANK') && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-900">
              {subView === 'BKU'
                ? 'Buku Kas Umum (BKU) & Rekening Bank'
                : subView === 'KAS_KECIL'
                ? 'Buku Kas Kecil Operasional'
                : 'Mutasi Rekening Bank'}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {subView === 'BKU' && (
                <select
                  value={selectedCashBankId}
                  onChange={(e) => setSelectedCashBankId(e.target.value)}
                  className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg text-xs"
                >
                  <option value="ALL">Semua Rekening Kas & Bank</option>
                  {cashBankSummary.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-slate-600">
                Saldo Awal: <strong className="font-mono text-slate-900">{formatRp(ledgerRows.openingSum)}</strong>
              </span>
              <span className="text-slate-600">
                Saldo Akhir: <strong className="font-mono text-emerald-800">{formatRp(ledgerRows.endingBalance)}</strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Tanggal & Bukti</th>
                  <th className="py-2.5 px-3">Rekening Kas/Bank</th>
                  <th className="py-2.5 px-3">Uraian Mutasi</th>
                  <th className="py-2.5 px-3 text-right">Masuk (Debit)</th>
                  <th className="py-2.5 px-3 text-right">Keluar (Kredit)</th>
                  <th className="py-2.5 px-3 text-right">Saldo Berjalan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerRows.rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Belum ada mutasi terposting untuk tampilan ini.
                    </td>
                  </tr>
                ) : (
                  ledgerRows.rows.map((r) => (
                    <tr key={r.tx.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-slate-900">{r.tx.voucherNumber}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatDateShort(r.tx.transactionDate)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800">{r.tx.cashBankName}</div>
                        {r.tx.targetCashBankName && (
                          <div className="text-[11px] text-teal-700">→ {r.tx.targetCashBankName}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{r.tx.description}</div>
                        <div className="text-[11px] text-slate-500">
                          {r.tx.coaCode} · {r.tx.counterpartyName}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700 font-semibold">
                        {r.debit > 0 ? formatRp(r.debit) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-700 font-semibold">
                        {r.credit > 0 ? formatRp(r.credit) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatRp(r.runningBalance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subView === 'REKENING' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Kode & Nama Rekening</th>
                  <th className="py-2.5 px-3">Jenis / Bank & No. Rek</th>
                  <th className="py-2.5 px-3">Akun COA</th>
                  <th className="py-2.5 px-3 text-right">Saldo Awal</th>
                  <th className="py-2.5 px-3 text-right">Mutasi Masuk</th>
                  <th className="py-2.5 px-3 text-right">Mutasi Keluar</th>
                  <th className="py-2.5 px-3 text-right">Saldo Kini</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cashBankSummary.accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3">
                      <div className="font-mono font-bold text-emerald-800">{acc.code}</div>
                      <div className="font-semibold text-slate-900">{acc.name}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">
                      <div>{acc.accountKind}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {acc.bankName ? `${acc.bankName} · ${acc.accountNumber}` : acc.unitName}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700">{acc.coaCode}</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatRp(acc.openingBalance)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {formatRp(acc.totalIn + acc.transferIn)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-700">
                      {formatRp(acc.totalOut + acc.transferOut)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatRp(acc.currentBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subView === 'REKONSILIASI' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Tanggal & Rekening</th>
                  <th className="py-2.5 px-3 text-right">Saldo Buku</th>
                  <th className="py-2.5 px-3 text-right">Rekening Koran</th>
                  <th className="py-2.5 px-3 text-right">Buku Terkoreksi</th>
                  <th className="py-2.5 px-3 text-right">Bank Terkoreksi</th>
                  <th className="py-2.5 px-3 text-right">Selisih</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliations.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Belum ada riwayat rekonsiliasi bank. Klik "Rekonsiliasi Bank" untuk mencatat.
                    </td>
                  </tr>
                ) : (
                  reconciliations.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">{r.cashBankName}</div>
                        <div className="text-[11px] text-slate-500">
                          {formatDateShort(r.reconcileDate)} · Oleh {r.reconciledBy}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatRp(r.bookBalance)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatRp(r.bankStatementBalance)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        {formatRp(r.adjustedBookBalance)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        {formatRp(r.adjustedBankBalance)}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono tabular-nums font-bold ${
                          Math.abs(r.difference) < 1 ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {formatRp(r.difference)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                            r.status === 'Sesuai'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-rose-50 text-rose-800 border-rose-200'
                          }`}
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subView === 'SALDO_HARIAN' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Tanggal</th>
                  <th className="py-2.5 px-3 text-right">Jumlah Transaksi</th>
                  <th className="py-2.5 px-3 text-right">Total Penerimaan Harian</th>
                  <th className="py-2.5 px-3 text-right">Total Pengeluaran Harian</th>
                  <th className="py-2.5 px-3 text-right">Saldo Penutupan Harian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dailyBalances.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      Belum ada pergerakan saldo harian pada periode ini.
                    </td>
                  </tr>
                ) : (
                  dailyBalances.map(([date, info]) => (
                    <tr key={date} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900">
                        {formatDateShort(date)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{info.count}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                        {formatRp(info.debit)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-rose-700">
                        {formatRp(info.credit)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatRp(info.closing)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tambah Rekening */}
      {isAccountModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Tambah / Edit Rekening Kas & Bank</h3>
              <button type="button" onClick={() => setIsAccountModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Kode *</label>
                <input
                  type="text"
                  value={accCode}
                  onChange={(e) => setAccCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Jenis *</label>
                <select
                  value={accKind}
                  onChange={(e) => setAccKind(e.target.value as FinanceCashBankKind)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="BANK">Rekening Bank</option>
                  <option value="KAS_BESAR">Kas Besar</option>
                  <option value="KAS_KECIL">Kas Kecil</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Nama Rekening *</label>
              <input
                type="text"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            {accKind === 'BANK' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Nama Bank</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Nomor Rekening</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Akun COA Terhubung</label>
                <select
                  value={accCoaId}
                  onChange={(e) => setAccCoaId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {cashBankCoaOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} - {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Saldo Awal (Rp)</label>
                <input
                  type="number"
                  value={accOpeningBalance}
                  onChange={(e) => setAccOpeningBalance(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveAccount}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Simpan Rekening
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Transfer Antarbank / Kas */}
      {isTransferOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Transfer Antarbank / Pemindahbukuan Kas</h3>
              <button type="button" onClick={() => setIsTransferOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Nomor Referensi</label>
                <input
                  type="text"
                  value={trVoucher}
                  onChange={(e) => setTrVoucher(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Tanggal Transfer</label>
                <input
                  type="date"
                  value={trDate}
                  onChange={(e) => setTrDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Dari Rekening (Asal) *</label>
                <select
                  value={trSourceId}
                  onChange={(e) => setTrSourceId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {cashBankSummary.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatRp(a.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Ke Rekening (Tujuan) *</label>
                <select
                  value={trTargetId}
                  onChange={(e) => setTrTargetId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {cashBankSummary.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Nominal Transfer (Rp) *</label>
              <input
                type="number"
                value={trAmount}
                onChange={(e) => setTrAmount(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Keterangan</label>
              <input
                type="text"
                value={trDesc}
                onChange={(e) => setTrDesc(e.target.value)}
                placeholder="Contoh: Pengisian ulang kas kecil / Pemindahbukuan dana"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsTransferOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveTransfer}
                className="px-4 py-2 bg-teal-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Posting Transfer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Rekonsiliasi Bank */}
      {isReconcileOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Rekonsiliasi Bank</h3>
              <button type="button" onClick={() => setIsReconcileOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Rekening Bank / Kas</label>
                <select
                  value={recCashBankId}
                  onChange={(e) => setRecCashBankId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {cashBankSummary.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Tanggal Rekonsiliasi</label>
                <input
                  type="date"
                  value={recDate}
                  onChange={(e) => setRecDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Saldo Rekening Koran Bank (Rp)</label>
                <input
                  type="number"
                  value={recBankBalance}
                  onChange={(e) => setRecBankBalance(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Setoran Dalam Perjalanan (+)</label>
                <input
                  type="number"
                  value={recInTransit}
                  onChange={(e) => setRecInTransit(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Cek Beredar / Outstanding (-)</label>
                <input
                  type="number"
                  value={recOutstanding}
                  onChange={(e) => setRecOutstanding(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Jasa Giro / Bunga Bank (+ Buku)</label>
                <input
                  type="number"
                  value={recInterest}
                  onChange={(e) => setRecInterest(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Biaya Admin Bank (- Buku)</label>
                <input
                  type="number"
                  value={recAdminFee}
                  onChange={(e) => setRecAdminFee(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <span className="text-slate-500 block">Saldo Buku Terkoreksi</span>
                <span className="font-mono font-bold text-slate-900">{formatRp(recAdjBook)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Saldo Bank Terkoreksi</span>
                <span className="font-mono font-bold text-slate-900">{formatRp(recAdjBank)}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Selisih Rekonsiliasi</span>
                <span
                  className={`font-mono font-bold ${
                    Math.abs(recDiff) < 1 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {formatRp(recDiff)}
                </span>
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-1">Catatan Rekonsiliasi</label>
              <input
                type="text"
                value={recNotes}
                onChange={(e) => setRecNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsReconcileOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveReconciliation}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Simpan Rekonsiliasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
