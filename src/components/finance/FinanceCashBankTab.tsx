import React, { useMemo, useState } from 'react';
import {
  Plus,
  ArrowLeftRight,
  CheckCircle2,
  Landmark,
  Wallet,
  Scale,
  Edit3,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Unit } from '../../types/audit';
import {
  FinanceAccount,
  FinanceBankReconciliation,
  FinanceBankStatementLine,
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
  resolveMonthScopedCoa,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';
import { FinanceDeleteConfirmModal } from './FinanceDeleteConfirmModal';

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
  const [editingTransfer, setEditingTransfer] = useState<FinanceTransaction | null>(null);
  const [trVoucher, setTrVoucher] = useState('');
  const [trDate, setTrDate] = useState(getTodayIso());
  const [trSourceId, setTrSourceId] = useState('');
  const [trTargetId, setTrTargetId] = useState('');
  const [trAmount, setTrAmount] = useState('');
  const [trDesc, setTrDesc] = useState('');

  // Modal Rekonsiliasi Bank
  const [isReconcileOpen, setIsReconcileOpen] = useState(false);
  const [editingReconciliation, setEditingReconciliation] =
    useState<FinanceBankReconciliation | null>(null);
  const [recCashBankId, setRecCashBankId] = useState('');
  const [recDate, setRecDate] = useState(getTodayIso());
  const [recBankBalance, setRecBankBalance] = useState('0');
  const [recInTransit, setRecInTransit] = useState('0');
  const [recOutstanding, setRecOutstanding] = useState('0');
  const [recAdminFee, setRecAdminFee] = useState('0');
  const [recInterest, setRecInterest] = useState('0');
  const [recNotes, setRecNotes] = useState('');

  const [deleteConfirm, setDeleteConfirm] = useState<
    | { kind: 'ACCOUNT'; item: FinanceCashBankAccount }
    | { kind: 'TRANSFER'; item: FinanceTransaction }
    | { kind: 'RECON'; item: FinanceBankReconciliation }
    | null
  >(null);

  // Modal Import Rekening Koran (.csv / .xlsx)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importBankId, setImportBankId] = useState('');
  const [importLines, setImportLines] = useState<FinanceBankStatementLine[]>([]);
  const [importFileName, setImportFileName] = useState('');

  const cashBankCoaOptions = useMemo(
    () =>
      resolveMonthScopedCoa(accounts, filter.year, filter.month).accounts.filter(
        (a) =>
          a.isActive !== false &&
          (a.cashFlowGroup === 'Kas' ||
            a.code.startsWith('11.') ||
            a.code.startsWith('1-11') ||
            a.code.startsWith('1-12'))
      ),
    [accounts, filter.year, filter.month]
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
    if (!permissions.isSuperUser && isPeriodLocked(periodCloses, year, month)) {
      setFeedback({ type: 'error', message: `Periode ${month} ${year} telah ditutup buku.` });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const src = cashBankSummary.accounts.find((a) => a.id === trSourceId)!;
      const dst = cashBankSummary.accounts.find((a) => a.id === trTargetId)!;
      const txId = editingTransfer?.id || `tx-trf-${Date.now()}`;
      const jrnId = editingTransfer?.linkedJournalId || `jrn-${txId}`;
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
        unitId: editingTransfer?.unitId || actor.unitId || '',
        unitName: editingTransfer?.unitName || actor.unitName || 'Bidang Umum dan Keuangan',
        bidangName: editingTransfer?.bidangName || 'Keuangan & Penagihan',
        cashBankId: src.id,
        cashBankName: src.name,
        targetCashBankId: dst.id,
        targetCashBankName: dst.name,
        coaId: dst.coaId,
        coaCode: dst.coaCode,
        coaName: dst.name,
        amount: Math.round(amt),
        status: 'Disetujui / Diposting',
        attachments: editingTransfer?.attachments || [],
        duplicateKey: buildDuplicateKey({
          type: 'TRANSFER',
          transactionDate: trDate,
          amount: Math.round(amt),
          coaId: dst.coaId,
          counterpartyName: dst.name,
        }),
        linkedJournalId: jrnId,
        createdBy: editingTransfer?.createdBy || actor.displayName,
        createdByUid: editingTransfer?.createdByUid || actor.uid,
        createdByRole: editingTransfer?.createdByRole || actor.role,
        approvedBy: editingTransfer?.approvedBy || actor.displayName,
        approvedAt: editingTransfer?.approvedAt || now,
        createdAt: editingTransfer?.createdAt || now,
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
        createdBy: editingTransfer?.createdBy || actor.displayName,
        createdByUid: editingTransfer?.createdByUid || actor.uid,
        createdAt: editingTransfer?.createdAt || now,
        updatedAt: now,
      };

      const batch = writeBatch(db);
      batch.set(doc(db, 'fin_transactions', txId), tx);
      batch.set(doc(db, 'fin_journals', jrnId), sanitizeFirestoreRecord(journal));
      await batch.commit();

      await onLogAudit({
        actionType: editingTransfer ? 'UPDATE' : 'POST',
        entityType: 'Transfer Kas/Bank',
        entityId: txId,
        entityLabel: voucher,
        summary: `${editingTransfer ? 'Pembaruan transfer' : 'Transfer'} ${formatRp(tx.amount)} dari ${src.name} ke ${dst.name}`,
        beforeData: editingTransfer ? (editingTransfer as unknown as Record<string, unknown>) : null,
        afterData: tx as unknown as Record<string, unknown>,
        year,
      });

      setIsTransferOpen(false);
      setEditingTransfer(null);
      setFeedback({
        type: 'success',
        message: `Transfer ${voucher} berhasil ${editingTransfer ? 'diperbarui' : 'diposting'}.`,
      });
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
      const id = editingReconciliation?.id || `rec-${Date.now()}`;
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
        reconciledBy: editingReconciliation?.reconciledBy || actor.displayName,
        createdAt: editingReconciliation?.createdAt || now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_bank_reconciliations', id), record);
      await onLogAudit({
        actionType: editingReconciliation ? 'UPDATE' : 'CREATE',
        entityType: 'Rekonsiliasi Bank',
        entityId: id,
        entityLabel: `${record.cashBankName} (${record.month} ${record.year})`,
        summary: `${editingReconciliation ? 'Pembaruan' : 'Pencatatan'} rekonsiliasi ${record.cashBankName}: Status ${record.status}, Selisih ${formatRp(record.difference)}`,
        beforeData: editingReconciliation
          ? (editingReconciliation as unknown as Record<string, unknown>)
          : null,
        afterData: record as unknown as Record<string, unknown>,
        year,
      });
      setIsReconcileOpen(false);
      setEditingReconciliation(null);
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

  const handleConfirmDelete = async () => {
    if (!deleteConfirm || !permissions.isSuperUser) return;
    setSubmitting(true);
    try {
      if (deleteConfirm.kind === 'ACCOUNT') {
        const acc = deleteConfirm.item;
        await deleteDoc(doc(db, 'fin_cash_banks', acc.id));
        await onLogAudit({
          actionType: 'DELETE',
          entityType: 'Rekening Kas & Bank',
          entityId: acc.id,
          entityLabel: `${acc.code} - ${acc.name}`,
          summary: `Super User menghapus rekening kas/bank ${acc.code} - ${acc.name}`,
          beforeData: acc as unknown as Record<string, unknown>,
          afterData: null,
        });
        setFeedback({ type: 'success', message: `Rekening ${acc.name} berhasil dihapus.` });
      } else if (deleteConfirm.kind === 'TRANSFER') {
        const tx = deleteConfirm.item;
        const batch = writeBatch(db);
        batch.delete(doc(db, 'fin_transactions', tx.id));
        if (tx.linkedJournalId) {
          batch.delete(doc(db, 'fin_journals', tx.linkedJournalId));
        }
        await batch.commit();
        await onLogAudit({
          actionType: 'DELETE',
          entityType: 'Transfer Kas/Bank',
          entityId: tx.id,
          entityLabel: tx.voucherNumber,
          summary: `Super User menghapus transfer ${tx.voucherNumber} (${formatRp(tx.amount)})`,
          beforeData: tx as unknown as Record<string, unknown>,
          afterData: null,
          year: tx.year,
        });
        setFeedback({ type: 'success', message: `Transfer ${tx.voucherNumber} berhasil dihapus.` });
      } else if (deleteConfirm.kind === 'RECON') {
        const rec = deleteConfirm.item;
        await deleteDoc(doc(db, 'fin_bank_reconciliations', rec.id));
        await onLogAudit({
          actionType: 'DELETE',
          entityType: 'Rekonsiliasi Bank',
          entityId: rec.id,
          entityLabel: `${rec.cashBankName} (${rec.month} ${rec.year})`,
          summary: `Super User menghapus rekonsiliasi bank ${rec.cashBankName} (${rec.reconcileDate})`,
          beforeData: rec as unknown as Record<string, unknown>,
          afterData: null,
          year: rec.year,
        });
        setFeedback({ type: 'success', message: `Data rekonsiliasi ${rec.cashBankName} berhasil dihapus.` });
      }
      setDeleteConfirm(null);
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menghapus data: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const parseNumericCell = (raw: unknown): number => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    const str = String(raw || '').trim();
    if (!str) return 0;
    // Handle Indonesian formatting like "1.250.000,50" or standard "1,250,000.50"
    const hasCommaDec = /,\d{1,2}$/.test(str);
    const cleaned = hasCommaDec
      ? str.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '')
      : str.replace(/,/g, '').replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const normalizeBankDate = (raw: unknown): string => {
    if (typeof raw === 'number' && raw > 25000 && raw < 70000) {
      // Excel serial date
      const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
      return d.toISOString().slice(0, 10);
    }
    const str = String(raw || '').trim();
    if (!str) return getTodayIso();
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(str);
    if (dmy) {
      const dd = dmy[1].padStart(2, '0');
      const mm = dmy[2].padStart(2, '0');
      const yyyy = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
      return `${yyyy}-${mm}-${dd}`;
    }
    const ymd = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(str);
    if (ymd) {
      return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
    }
    return getTodayIso();
  };

  const handleBankStatementFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
      });

      const defaultInCoa =
        accounts.find((a) => a.code === '81.01.10' || a.code === '4-1101')?.id || '';
      const defaultOutCoa =
        accounts.find((a) => a.code === '96.02.90' || a.code === '5-2102')?.id || '';

      const parsed: FinanceBankStatementLine[] = rawRows
        .map((row, idx): FinanceBankStatementLine | null => {
          const keys = Object.keys(row);
          const findVal = (patterns: RegExp[]) => {
            const matchedKey = keys.find((k) => patterns.some((rx) => rx.test(k.toLowerCase())));
            return matchedKey ? row[matchedKey] : '';
          };

          const rawDate = findVal([/tgl/, /tanggal/, /date/, /posting/]);
          const rawDesc = String(findVal([/uraian/, /deskripsi/, /desc/, /ket/, /remark/, /berita/])).trim();
          const rawRef = String(findVal([/ref/, /arsip/, /no\b/, /bukti/])).trim();
          const rawDebit = parseNumericCell(findVal([/debit/, /debet/, /keluar/, /^dr$/]));
          const rawCredit = parseNumericCell(findVal([/kredit/, /credit/, /masuk/, /^cr$/]));
          const rawDk = String(findVal([/^d\/?k$/, /tipe/, /mutasi/])).trim().toUpperCase();
          const rawAmount = parseNumericCell(findVal([/jumlah/, /nominal/, /amount/]));
          const rawBal = parseNumericCell(findVal([/saldo/, /balance/]));

          let direction: 'MASUK' | 'KELUAR' = 'MASUK';
          let amount = 0;
          let debit = rawDebit;
          let credit = rawCredit;

          if (rawCredit > 0 && rawDebit === 0) {
            direction = 'MASUK';
            amount = rawCredit;
          } else if (rawDebit > 0 && rawCredit === 0) {
            direction = 'KELUAR';
            amount = rawDebit;
          } else if (rawAmount > 0) {
            direction = rawDk === 'D' || rawDk === 'DB' || rawDk === 'DEBIT' ? 'KELUAR' : 'MASUK';
            amount = rawAmount;
            if (direction === 'MASUK') credit = rawAmount;
            else debit = rawAmount;
          }

          if (amount <= 0 && !rawDesc) return null;
          return {
            id: `stmt-${idx}-${Date.now()}`,
            date: normalizeBankDate(rawDate),
            description: rawDesc || `Mutasi Rekening Koran #${idx + 1}`,
            reference: rawRef || `RK-${idx + 1}`,
            debit,
            credit,
            balance: rawBal,
            direction,
            amount,
            selected: amount > 0,
            suggestedCoaId: direction === 'MASUK' ? defaultInCoa : defaultOutCoa,
          };
        })
        .filter((x): x is FinanceBankStatementLine => x !== null && x.amount > 0);

      setImportLines(parsed);
      if (parsed.length === 0) {
        setFeedback({
          type: 'error',
          message:
            'Tidak ditemukan baris transaksi yang valid pada file rekening koran. Pastikan kolom Tanggal, Uraian, Debit/Kredit tersedia.',
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal membaca file rekening koran: ${err instanceof Error ? err.message : 'Error'}`,
      });
    }
  };

  const handleApplyImportedBalanceToRecon = () => {
    const targetBank =
      cashBankSummary.accounts.find((a) => a.id === importBankId) || cashBankSummary.accounts[0];
    if (!targetBank || importLines.length === 0) return;
    const lastLine = importLines[importLines.length - 1];
    const lastDate = lastLine.date || getTodayIso();
    setEditingReconciliation(null);
    setRecCashBankId(targetBank.id);
    setRecDate(lastDate);
    setRecBankBalance(String(lastLine.balance || targetBank.currentBalance));
    setRecInTransit('0');
    setRecOutstanding('0');
    setRecAdminFee('0');
    setRecInterest('0');
    setRecNotes(`Dari Import Rekening Koran (${importFileName})`);
    setIsImportModalOpen(false);
    setIsReconcileOpen(true);
  };

  const handlePostImportedLines = async () => {
    const selected = importLines.filter((l) => l.selected && l.amount > 0);
    const targetBank = cashBankSummary.accounts.find((a) => a.id === importBankId);
    if (!targetBank || selected.length === 0) {
      setFeedback({
        type: 'error',
        message: 'Pilih rekening bank dan minimal 1 baris mutasi untuk diposting.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      let postedCount = 0;

      for (const line of selected.slice(0, 200)) {
        const year = parseInt(line.date.slice(0, 4), 10) || new Date().getFullYear();
        const month = getMonthNameFromDate(line.date);
        const coa =
          accounts.find((a) => a.id === line.suggestedCoaId) ||
          accounts[0];
        const txId = `tx-rk-${Date.now()}-${postedCount}`;
        const jrnId = `jrn-rk-${Date.now()}-${postedCount}`;
        const voucher = line.reference || `RK-${year}-${postedCount + 1}`;
        const isIn = line.direction === 'MASUK';

        const tx: FinanceTransaction = sanitizeFirestoreRecord({
          id: txId,
          voucherNumber: voucher,
          type: isIn ? 'PENERIMAAN' : 'PENGELUARAN',
          subCategory: isIn ? 'Penerimaan Lainnya' : 'Pengeluaran Operasional',
          transactionDate: line.date,
          year,
          month,
          description: line.description,
          counterpartyName: targetBank.bankName || targetBank.name,
          unitId: targetBank.unitId || '',
          unitName: targetBank.unitName || 'Bidang Umum dan Keuangan',
          bidangName: 'Keuangan & Penagihan',
          cashBankId: targetBank.id,
          cashBankName: targetBank.name,
          coaId: coa?.id || targetBank.coaId,
          coaCode: coa?.code || targetBank.coaCode,
          coaName: coa?.name || targetBank.name,
          amount: Math.round(line.amount),
          status: 'Disetujui / Diposting',
          attachments: [],
          duplicateKey: buildDuplicateKey({
            type: isIn ? 'PENERIMAAN' : 'PENGELUARAN',
            transactionDate: line.date,
            amount: Math.round(line.amount),
            coaId: coa?.id || targetBank.coaId,
            counterpartyName: targetBank.bankName || targetBank.name,
          }),
          linkedJournalId: jrnId,
          notes: `Import Rekening Koran (${importFileName})`,
          createdBy: actor.displayName,
          createdByUid: actor.uid,
          createdByRole: actor.role,
          approvedBy: actor.displayName,
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        const journal: FinanceJournal = sanitizeFirestoreRecord({
          id: jrnId,
          journalNumber: `JRN-${voucher}`,
          journalType: isIn ? 'PENERIMAAN' : 'PENGELUARAN',
          journalDate: line.date,
          year,
          month,
          referenceNumber: voucher,
          sourceTransactionId: txId,
          description: line.description,
          unitId: tx.unitId,
          unitName: tx.unitName,
          lines: [
            {
              coaId: isIn ? targetBank.coaId : (coa?.id || targetBank.coaId),
              coaCode: isIn ? targetBank.coaCode : (coa?.code || targetBank.coaCode),
              coaName: isIn ? targetBank.name : (coa?.name || targetBank.name),
              description: line.description,
              debit: Math.round(line.amount),
              credit: 0,
            },
            {
              coaId: isIn ? (coa?.id || targetBank.coaId) : targetBank.coaId,
              coaCode: isIn ? (coa?.code || targetBank.coaCode) : targetBank.coaCode,
              coaName: isIn ? (coa?.name || targetBank.name) : targetBank.name,
              description: line.description,
              debit: 0,
              credit: Math.round(line.amount),
            },
          ],
          totalDebit: Math.round(line.amount),
          totalCredit: Math.round(line.amount),
          status: 'Posted',
          createdBy: actor.displayName,
          createdByUid: actor.uid,
          createdAt: now,
          updatedAt: now,
        });

        batch.set(doc(db, 'fin_transactions', txId), tx);
        batch.set(doc(db, 'fin_journals', jrnId), journal);
        postedCount += 1;
      }

      await batch.commit();
      await onLogAudit({
        actionType: 'IMPORT',
        entityType: 'Import Rekening Koran Bank',
        entityId: `imp-${Date.now()}`,
        entityLabel: `${targetBank.name} (${importFileName})`,
        summary: `Mengimpor dan memposting ${postedCount} mutasi rekening koran ke ${targetBank.name}`,
      });

      setIsImportModalOpen(false);
      setImportLines([]);
      setFeedback({
        type: 'success',
        message: `${postedCount} baris rekening koran berhasil diposting ke transaksi kas/bank & jurnal.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal memposting rekening koran: ${err instanceof Error ? err.message : 'Error'}`,
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
                setEditingTransfer(null);
                setTrVoucher(`TRF-${filter.year || new Date().getFullYear()}-${String(transactions.length + 1).padStart(3, '0')}`);
                setTrDate(getTodayIso());
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
                setEditingReconciliation(null);
                const bankAcc = cashBankSummary.accounts.find((a) => a.accountKind === 'BANK') || cashBankSummary.accounts[0];
                setRecCashBankId(bankAcc?.id || '');
                setRecDate(getTodayIso());
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
                const defaultBank =
                  cashBankSummary.accounts.find((a) => a.accountKind === 'BANK') ||
                  cashBankSummary.accounts[0];
                setImportBankId(defaultBank?.id || '');
                setImportLines([]);
                setImportFileName('');
                setIsImportModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Rekening Koran (.csv/.xlsx)</span>
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
                  {permissions.isSuperUser && <th className="py-2.5 px-3 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerRows.rows.length === 0 ? (
                  <tr>
                    <td colSpan={permissions.isSuperUser ? 7 : 6} className="py-8 text-center text-slate-500">
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
                      {permissions.isSuperUser && (
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {r.tx.type === 'TRANSFER' ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTransfer(r.tx);
                                  setTrVoucher(r.tx.voucherNumber);
                                  setTrDate(r.tx.transactionDate);
                                  setTrSourceId(r.tx.cashBankId);
                                  setTrTargetId(r.tx.targetCashBankId || '');
                                  setTrAmount(String(r.tx.amount));
                                  setTrDesc(r.tx.description);
                                  setIsTransferOpen(true);
                                }}
                                className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-md cursor-pointer"
                                title="Edit Transfer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirm({ kind: 'TRANSFER', item: r.tx })}
                                className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md cursor-pointer"
                                title="Hapus Transfer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400">Via BKM/BKK</span>
                          )}
                        </td>
                      )}
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
                  {permissions.isSuperUser && <th className="py-2.5 px-3 text-right">Aksi</th>}
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
                    {permissions.isSuperUser && (
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAccount(acc);
                              setAccCode(acc.code);
                              setAccName(acc.name);
                              setAccKind(acc.accountKind);
                              setBankName(acc.bankName || '');
                              setAccountNumber(acc.accountNumber || '');
                              setAccCoaId(acc.coaId);
                              setAccOpeningBalance(String(acc.openingBalance || 0));
                              setAccUnitId(acc.unitId || '');
                              setIsAccountModalOpen(true);
                            }}
                            className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-md cursor-pointer"
                            title="Edit Rekening"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm({ kind: 'ACCOUNT', item: acc })}
                            className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md cursor-pointer"
                            title="Hapus Rekening"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
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
                  {permissions.isSuperUser && <th className="py-2.5 px-3 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reconciliations.length === 0 ? (
                  <tr>
                    <td colSpan={permissions.isSuperUser ? 8 : 7} className="py-8 text-center text-slate-500">
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
                      {permissions.isSuperUser && (
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingReconciliation(r);
                                setRecCashBankId(r.cashBankId);
                                setRecDate(r.reconcileDate);
                                setRecBankBalance(String(r.bankStatementBalance || 0));
                                setRecInTransit(String(r.inTransitDeposits || 0));
                                setRecOutstanding(String(r.outstandingChecks || 0));
                                setRecAdminFee(String(r.bankAdminFee || 0));
                                setRecInterest(String(r.bankInterest || 0));
                                setRecNotes(r.notes || '');
                                setIsReconcileOpen(true);
                              }}
                              className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-md cursor-pointer"
                              title="Edit Rekonsiliasi"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm({ kind: 'RECON', item: r })}
                              className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md cursor-pointer"
                              title="Hapus Rekonsiliasi"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
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
              <h3 className="text-sm font-bold text-slate-900">
                {editingTransfer
                  ? `Edit Transfer — ${editingTransfer.voucherNumber}`
                  : 'Transfer Antarbank / Pemindahbukuan Kas'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsTransferOpen(false);
                  setEditingTransfer(null);
                }}
                className="cursor-pointer"
              >
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
              <h3 className="text-sm font-bold text-slate-900">
                {editingReconciliation ? 'Edit Rekonsiliasi Bank' : 'Rekonsiliasi Bank'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsReconcileOpen(false);
                  setEditingReconciliation(null);
                }}
                className="cursor-pointer"
              >
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
      <FinanceDeleteConfirmModal
        isOpen={Boolean(deleteConfirm)}
        title={
          deleteConfirm?.kind === 'ACCOUNT'
            ? 'Hapus Rekening Kas / Bank'
            : deleteConfirm?.kind === 'TRANSFER'
            ? 'Hapus Transfer Kas / Bank'
            : 'Hapus Rekonsiliasi Bank'
        }
        itemLabel={
          deleteConfirm?.kind === 'ACCOUNT'
            ? `${deleteConfirm.item.code} - ${deleteConfirm.item.name}`
            : deleteConfirm?.kind === 'TRANSFER'
            ? `${deleteConfirm.item.voucherNumber} (${formatRp(deleteConfirm.item.amount)})`
            : deleteConfirm?.kind === 'RECON'
            ? `${deleteConfirm.item.cashBankName} (${formatDateShort(deleteConfirm.item.reconcileDate)})`
            : ''
        }
        description={
          deleteConfirm?.kind === 'TRANSFER'
            ? 'Jurnal pemindahbukuan terkait akan ikut dihapus dan saldo rekening otomatis disesuaikan.'
            : deleteConfirm?.kind === 'ACCOUNT'
            ? 'Pastikan tidak ada transaksi aktif yang masih bergantung pada rekening ini.'
            : 'Catatan hasil rekonsiliasi bank ini akan dihapus permanen.'
        }
        submitting={submitting}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={handleConfirmDelete}
      />

      {/* Modal Import Rekening Koran (.csv / .xlsx) */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-xs shadow-xl">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Import Mutasi Rekening Koran Bank (.csv / .xlsx)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Mendukung format Bank Nagari, BRI, BSI, BNI, dan Mandiri (otomatis mendeteksi Tanggal, Uraian, Debit, Kredit, Saldo)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Pilih Rekening Bank Tujuan *</label>
                  <select
                    value={importBankId}
                    onChange={(e) => setImportBankId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {cashBankSummary.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name} {a.accountNumber ? `(${a.accountNumber})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Unggah File Rekening Koran (.xlsx / .xls / .csv)</label>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleBankStatementFile}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-slate-50"
                  />
                </div>
              </div>

              {importLines.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold">
                    <span>
                      Terbaca {importLines.length} baris · Dipilih:{' '}
                      {importLines.filter((l) => l.selected).length} baris
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const allSelected = importLines.every((l) => l.selected);
                        setImportLines(importLines.map((l) => ({ ...l, selected: !allSelected })));
                      }}
                      className="text-emerald-800 hover:underline cursor-pointer"
                    >
                      {importLines.every((l) => l.selected) ? 'Batal Pilih Semua' : 'Pilih Semua'}
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600 sticky top-0">
                          <th className="py-2 px-2.5">Pilih</th>
                          <th className="py-2 px-2.5">Tanggal</th>
                          <th className="py-2 px-2.5">Uraian & Ref</th>
                          <th className="py-2 px-2.5">Arah</th>
                          <th className="py-2 px-2.5 text-right">Nominal</th>
                          <th className="py-2 px-2.5">Akun Lawan (COA)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {importLines.map((line, idx) => (
                          <tr key={line.id} className="hover:bg-slate-50">
                            <td className="py-1.5 px-2.5">
                              <input
                                type="checkbox"
                                checked={line.selected}
                                onChange={(e) => {
                                  const next = [...importLines];
                                  next[idx] = { ...next[idx], selected: e.target.checked };
                                  setImportLines(next);
                                }}
                              />
                            </td>
                            <td className="py-1.5 px-2.5 font-mono whitespace-nowrap">
                              {formatDateShort(line.date)}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <div className="font-medium text-slate-900 line-clamp-1">{line.description}</div>
                              <div className="text-[10px] font-mono text-slate-500">{line.reference}</div>
                            </td>
                            <td className="py-1.5 px-2.5">
                              <span
                                className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                  line.direction === 'MASUK'
                                    ? 'bg-emerald-50 text-emerald-800'
                                    : 'bg-rose-50 text-rose-700'
                                }`}
                              >
                                {line.direction}
                              </span>
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-mono font-bold">
                              {formatRp(line.amount)}
                            </td>
                            <td className="py-1.5 px-2.5">
                              <select
                                value={line.suggestedCoaId || ''}
                                onChange={(e) => {
                                  const next = [...importLines];
                                  next[idx] = { ...next[idx], suggestedCoaId: e.target.value };
                                  setImportLines(next);
                                }}
                                className="w-44 px-2 py-1 border border-slate-300 rounded text-[11px]"
                              >
                                {accounts.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.code} - {a.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap justify-between items-center gap-2">
              <button
                type="button"
                disabled={importLines.length === 0}
                onClick={handleApplyImportedBalanceToRecon}
                className="px-3 py-2 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                Terapkan Saldo Terakhir ke Rekonsiliasi
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="button"
                  disabled={submitting || importLines.filter((l) => l.selected).length === 0}
                  onClick={handlePostImportedLines}
                  className="px-4 py-2 bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg font-bold cursor-pointer"
                >
                  Posting {importLines.filter((l) => l.selected).length} Mutasi ke Buku Bank & Jurnal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
