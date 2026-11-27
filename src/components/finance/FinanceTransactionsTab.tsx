import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Ban,
  Upload,
  Link2,
  Trash2,
  AlertTriangle,
  FileText,
  Edit3,
  ExternalLink,
  X,
} from 'lucide-react';
import { doc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { RKAItem, RKASubItem, Unit } from '../../types/audit';
import {
  FinanceAccount,
  FinanceAttachment,
  FinanceCashBankAccount,
  FinanceGlobalFilter,
  FinanceJournal,
  FinancePeriodClose,
  FinanceTransaction,
  FinanceTransactionStatus,
} from '../../types/finance';
import {
  FINANCE_EXPENSE_CATEGORIES,
  FINANCE_RECEIPT_CATEGORIES,
} from '../../data/financeStandards';
import {
  buildDuplicateKey,
  computeRkaAbsorptionForTarget,
  findPotentialDuplicateTransactions,
  formatDateShort,
  formatRp,
  getMonthNameFromDate,
  getRkaBaselineRealization,
  getTodayIso,
  isPeriodLocked,
  matchesGlobalFilter,
  resolveMonthScopedCoa,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import {
  FinanceActor,
  FinancePermissions,
  LogFinanceAuditFn,
  getTxStatusStyle,
  readAttachmentAsInlineData,
} from './financeShared';
import { FinanceDeleteConfirmModal } from './FinanceDeleteConfirmModal';

interface FinanceTransactionsTabProps {
  mode: 'PENERIMAAN' | 'PENGELUARAN';
  filter: FinanceGlobalFilter;
  transactions: FinanceTransaction[];
  allTransactions: FinanceTransaction[];
  accounts: FinanceAccount[];
  cashBankAccounts: FinanceCashBankAccount[];
  periodCloses: FinancePeriodClose[];
  rkaItems: RKAItem[];
  rkaSubItems: RKASubItem[];
  units: Unit[];
  actor: FinanceActor;
  permissions: FinancePermissions;
  onLogAudit: LogFinanceAuditFn;
}

export const FinanceTransactionsTab: React.FC<FinanceTransactionsTabProps> = ({
  mode,
  filter,
  transactions,
  allTransactions,
  accounts,
  cashBankAccounts,
  periodCloses,
  rkaItems,
  rkaSubItems,
  units,
  actor,
  permissions,
  onLogAudit,
}) => {
  const isReceipt = mode === 'PENERIMAAN';
  const categories = isReceipt
    ? FINANCE_RECEIPT_CATEGORIES
    : FINANCE_EXPENSE_CATEGORIES;

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Modal Create/Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateConfirmChecked, setDuplicateConfirmChecked] = useState(false);

  // Form states
  const [voucherNumber, setVoucherNumber] = useState('');
  const [transactionDate, setTransactionDate] = useState(getTodayIso());
  const [subCategory, setSubCategory] = useState<string>(categories[0]);
  const [description, setDescription] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [unitId, setUnitId] = useState('');
  const [bidangName, setBidangName] = useState('');
  const [cashBankId, setCashBankId] = useState('');
  const [coaId, setCoaId] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [rkaId, setRkaId] = useState('');
  const [rkaSubId, setRkaSubId] = useState('');
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<FinanceAttachment[]>([]);
  const [attachmentUrlInput, setAttachmentUrlInput] = useState('');
  const [attachmentLabelInput, setAttachmentLabelInput] = useState('');

  // Approval / Cancel Modal
  const [actionModal, setActionModal] = useState<{
    tx: FinanceTransaction;
    action: 'APPROVE' | 'REJECT' | 'CANCEL';
  } | null>(null);
  const [actionNotes, setActionNotes] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<FinanceTransaction | null>(null);

  const eligibleCoaList = useMemo(() => {
    const targetTypes = isReceipt
      ? ['Pendapatan', 'Aset', 'Kewajiban', 'Ekuitas']
      : ['Beban', 'Aset', 'Kewajiban', 'Ekuitas'];
    const scopedAccounts = resolveMonthScopedCoa(accounts, filter.year, filter.month).accounts;
    const scoped = scopedAccounts.filter(
      (a) => a.isActive !== false && targetTypes.includes(a.type)
    );
    return (scoped.length > 0 ? scoped : scopedAccounts.filter((a) => targetTypes.includes(a.type))).sort(
      (a, b) => a.code.localeCompare(b.code)
    );
  }, [accounts, isReceipt, filter.year, filter.month]);

  const txYear = useMemo(() => {
    const parsed = parseInt(transactionDate.slice(0, 4), 10);
    return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
  }, [transactionDate]);
  const txMonth = useMemo(() => getMonthNameFromDate(transactionDate), [transactionDate]);

  const availableRkaParents = useMemo(() => {
    return rkaItems
      .filter((r) => r.year === txYear)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [rkaItems, txYear]);

  const availableRkaSubs = useMemo(() => {
    if (!rkaId) return [];
    return rkaSubItems
      .filter((s) => s.parentRkaId === rkaId)
      .sort((a, b) => a.subCode.localeCompare(b.subCode));
  }, [rkaSubItems, rkaId]);

  const selectedParentRka = useMemo(
    () => rkaItems.find((r) => r.id === rkaId) || null,
    [rkaItems, rkaId]
  );

  const selectedSubRka = useMemo(
    () => rkaSubItems.find((s) => s.id === rkaSubId) || null,
    [rkaSubItems, rkaSubId]
  );

  // Real-time RKA Absorption panel inside form
  const formRkaAbsorption = useMemo(() => {
    if (!selectedParentRka) return null;
    const subs = rkaSubItems.filter((s) => s.parentRkaId === selectedParentRka.id);
    return computeRkaAbsorptionForTarget({
      parentRka: selectedParentRka,
      targetSub: selectedSubRka,
      allSubItemsForParent: subs,
      allTransactions,
      currentAmount: Number(amount) || 0,
      excludeTxId: editingTx?.id,
    });
  }, [selectedParentRka, selectedSubRka, rkaSubItems, allTransactions, amount, editingTx]);

  // Duplicate Pre-Save Check
  const duplicateMatches = useMemo(() => {
    if (!isModalOpen) return [];
    return findPotentialDuplicateTransactions(
      {
        id: editingTx?.id,
        voucherNumber,
        type: mode,
        transactionDate,
        amount: Number(amount) || 0,
        rkaId: !isReceipt ? rkaId : undefined,
        coaId,
        counterpartyName,
      },
      allTransactions
    );
  }, [
    isModalOpen,
    editingTx,
    voucherNumber,
    mode,
    transactionDate,
    amount,
    isReceipt,
    rkaId,
    coaId,
    counterpartyName,
    allTransactions,
  ]);

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((t) => {
        if (t.type !== mode) return false;
        if (
          !matchesGlobalFilter(
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
        ) {
          return false;
        }
        if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
        if (categoryFilter !== 'ALL' && t.subCategory !== categoryFilter) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.trim().toLowerCase();
          const match =
            t.voucherNumber.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.counterpartyName.toLowerCase().includes(q) ||
            (t.rkaCode || '').toLowerCase().includes(q) ||
            (t.coaCode || '').toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  }, [transactions, mode, filter, statusFilter, categoryFilter, searchTerm]);

  // Category Recap
  const categoryRecap = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    categories.forEach((c) => map.set(c, { count: 0, total: 0 }));
    filteredTransactions
      .filter((t) => t.status === 'Disetujui / Diposting')
      .forEach((t) => {
        const cur = map.get(t.subCategory) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += Number(t.amount) || 0;
        map.set(t.subCategory, cur);
      });
    return Array.from(map.entries());
  }, [categories, filteredTransactions]);

  const generateVoucherNo = () => {
    const prefix = isReceipt ? 'BKM' : 'BKK';
    const yearPart = filter.year !== 0 ? filter.year : new Date().getFullYear();
    const seq =
      transactions.filter((t) => t.type === mode && t.year === yearPart).length + 1;
    return `${prefix}-${yearPart}-${String(seq).padStart(4, '0')}`;
  };

  const openCreateModal = () => {
    setEditingTx(null);
    setVoucherNumber(generateVoucherNo());
    const defaultYear = filter.year !== 0 ? filter.year : new Date().getFullYear();
    const today = getTodayIso();
    setTransactionDate(today.startsWith(String(defaultYear)) ? today : `${defaultYear}-01-15`);
    setSubCategory(categories[0]);
    setDescription('');
    setCounterpartyName('');
    const defUnit =
      units.find((u) => u.id === actor.unitId) || units[0];
    setUnitId(defUnit?.id || '');
    setBidangName(defUnit?.category === 'BIDANG' ? defUnit.name : 'Bidang Umum dan Keuangan');
    setCashBankId(cashBankAccounts[0]?.id || '');
    setCoaId(eligibleCoaList[0]?.id || '');
    setAmount('');
    setRkaId('');
    setRkaSubId('');
    setNotes('');
    setAttachments([]);
    setAttachmentUrlInput('');
    setAttachmentLabelInput('');
    setDuplicateConfirmChecked(false);
    setIsModalOpen(true);
  };

  const openEditModal = (tx: FinanceTransaction) => {
    setEditingTx(tx);
    setVoucherNumber(tx.voucherNumber);
    setTransactionDate(tx.transactionDate);
    setSubCategory(tx.subCategory);
    setDescription(tx.description);
    setCounterpartyName(tx.counterpartyName);
    setUnitId(tx.unitId);
    setBidangName(tx.bidangName);
    setCashBankId(tx.cashBankId);
    setCoaId(tx.coaId);
    setAmount(String(tx.amount));
    setRkaId(tx.rkaId || '');
    setRkaSubId(tx.rkaSubId || '');
    setNotes(tx.notes || '');
    setAttachments(tx.attachments || []);
    setAttachmentUrlInput('');
    setAttachmentLabelInput('');
    setDuplicateConfirmChecked(Boolean(tx.duplicateWarningConfirmed));
    setIsModalOpen(true);
  };

  const handleFileAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const { attachment, error } = await readAttachmentAsInlineData(files[0]);
    if (error) {
      setFeedback({ type: 'error', message: error });
    } else if (attachment) {
      setAttachments((prev) => [...prev, attachment]);
    }
    e.target.value = '';
  };

  const handleAddAttachmentUrl = () => {
    const cleanUrl = attachmentUrlInput.trim();
    if (!cleanUrl) return;
    setAttachments((prev) => [
      ...prev,
      {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fileName: attachmentLabelInput.trim() || 'Tautan Bukti Transaksi',
        fileUrl: cleanUrl,
        uploadedAt: new Date().toISOString(),
      },
    ]);
    setAttachmentUrlInput('');
    setAttachmentLabelInput('');
  };

  // Helper to sync RKA realization counts across one or more affected parent/sub RKA IDs (Anti-Double-Counting)
  const syncMultipleRkasToBatch = (
    batch: ReturnType<typeof writeBatch>,
    targets: Array<{ rkaId?: string; rkaSubId?: string }>,
    updatedAllTxs: FinanceTransaction[],
    txDate: string
  ) => {
    const parentIds = new Set<string>();
    const subIds = new Set<string>();
    targets.forEach((t) => {
      if (t.rkaId) parentIds.add(t.rkaId);
      if (t.rkaSubId) subIds.add(t.rkaSubId);
    });

    parentIds.forEach((pid) => {
      const parentRka = rkaItems.find((r) => r.id === pid);
      if (!parentRka) return;
      const subsForParent = rkaSubItems.filter((s) => s.parentRkaId === parentRka.id);
      const parentBaseline = getRkaBaselineRealization(parentRka, subsForParent);
      const postedParentTotal = updatedAllTxs
        .filter(
          (t) =>
            t.type === 'PENGELUARAN' &&
            t.status === 'Disetujui / Diposting' &&
            t.rkaId === parentRka.id
        )
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);

      batch.update(doc(db, 'rka_items', parentRka.id), {
        financeBaselineRealization: parentBaseline,
        financePostedRealization: postedParentTotal,
        realizationAmount: parentBaseline + postedParentTotal,
        realizationDate: txDate,
        updatedAt: new Date().toISOString(),
      });
    });

    subIds.forEach((sid) => {
      const subItem = rkaSubItems.find((s) => s.id === sid);
      if (!subItem) return;
      const parentRka = rkaItems.find((r) => r.id === subItem.parentRkaId);
      if (!parentRka) return;
      const subsForParent = rkaSubItems.filter((s) => s.parentRkaId === parentRka.id);
      const subBaseline = getRkaBaselineRealization(parentRka, subsForParent, subItem);
      const postedSubTotal = updatedAllTxs
        .filter(
          (t) =>
            t.type === 'PENGELUARAN' &&
            t.status === 'Disetujui / Diposting' &&
            t.rkaSubId === subItem.id
        )
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);

      batch.update(doc(db, 'rka_sub_items', subItem.id), {
        financeBaselineRealization: subBaseline,
        financePostedRealization: postedSubTotal,
        realizationAmount: subBaseline + postedSubTotal,
        realizationDate: txDate,
        updatedAt: new Date().toISOString(),
      });
    });
  };

  const buildAutoJournalForTransaction = (
    tx: FinanceTransaction,
    journalId: string
  ): FinanceJournal => {
    const cb = cashBankAccounts.find((c) => c.id === tx.cashBankId);
    const cashCoa =
      accounts.find((a) => a.id === cb?.coaId || a.code === cb?.coaCode) || null;
    const cashCoaId = cashCoa?.id || cb?.coaId || 'coa-kas';
    const cashCoaCode = cashCoa?.code || cb?.coaCode || '1-1101';
    const cashCoaName = cashCoa?.name || tx.cashBankName;

    const lines = isReceipt
      ? [
          {
            coaId: cashCoaId,
            coaCode: cashCoaCode,
            coaName: cashCoaName,
            description: `${tx.voucherNumber} - ${tx.description}`,
            debit: tx.amount,
            credit: 0,
          },
          {
            coaId: tx.coaId,
            coaCode: tx.coaCode,
            coaName: tx.coaName,
            description: `${tx.counterpartyName} (${tx.subCategory})`,
            debit: 0,
            credit: tx.amount,
          },
        ]
      : [
          {
            coaId: tx.coaId,
            coaCode: tx.coaCode,
            coaName: tx.coaName,
            description: `${tx.voucherNumber} - ${tx.description}${tx.rkaCode ? ` [RKA ${tx.rkaCode}]` : ''}`,
            debit: tx.amount,
            credit: 0,
          },
          {
            coaId: cashCoaId,
            coaCode: cashCoaCode,
            coaName: cashCoaName,
            description: `Pembayaran via ${tx.cashBankName}`,
            debit: 0,
            credit: tx.amount,
          },
        ];

    const now = new Date().toISOString();
    return {
      id: journalId,
      journalNumber: `JRN-${tx.voucherNumber}`,
      journalType: isReceipt ? 'PENERIMAAN' : 'PENGELUARAN',
      journalDate: tx.transactionDate,
      year: tx.year,
      month: tx.month,
      referenceNumber: tx.voucherNumber,
      sourceTransactionId: tx.id,
      description: `${isReceipt ? 'Penerimaan' : 'Pengeluaran'}: ${tx.description}`,
      unitId: tx.unitId,
      unitName: tx.unitName,
      lines,
      totalDebit: tx.amount,
      totalCredit: tx.amount,
      status: 'Posted',
      createdBy: actor.displayName,
      createdByUid: actor.uid,
      createdAt: now,
      updatedAt: now,
    };
  };

  const handleSaveTransaction = async (submitStatus: FinanceTransactionStatus) => {
    setFeedback(null);
    const numAmount = Number(amount);
    if (!voucherNumber.trim() || !description.trim() || !Number.isFinite(numAmount) || numAmount <= 0) {
      setFeedback({
        type: 'error',
        message: 'Nomor bukti, uraian transaksi, dan nominal (> Rp 0) wajib diisi.',
      });
      return;
    }
    if (!cashBankId || !coaId) {
      setFeedback({
        type: 'error',
        message: 'Pilih rekening Kas/Bank serta Kode Rekening Akun (COA).',
      });
      return;
    }
    if (!permissions.isSuperUser && isPeriodLocked(periodCloses, txYear, txMonth)) {
      setFeedback({
        type: 'error',
        message: `Periode ${txMonth} ${txYear} sudah ditutup buku. Buka tutup buku terlebih dahulu jika ada koreksi resmi.`,
      });
      return;
    }
    if (duplicateMatches.length > 0 && !duplicateConfirmChecked) {
      setFeedback({
        type: 'error',
        message: 'Terdeteksi potensi transaksi ganda. Periksa daftar peringatan dan centang konfirmasi jika transaksi ini memang berbeda.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const txId = editingTx?.id || `tx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const selectedUnit = units.find((u) => u.id === unitId);
      const selectedCb = cashBankAccounts.find((c) => c.id === cashBankId);
      const selectedCoa = eligibleCoaList.find((a) => a.id === coaId);

      const shouldAutoPost =
        submitStatus === 'Disetujui / Diposting' && permissions.canApprove;
      const finalStatus: FinanceTransactionStatus = shouldAutoPost
        ? 'Disetujui / Diposting'
        : submitStatus;

      const linkedJournalId = shouldAutoPost
        ? editingTx?.linkedJournalId || `jrn-${txId}`
        : undefined;

      const payload: FinanceTransaction = sanitizeFirestoreRecord({
        id: txId,
        voucherNumber: voucherNumber.trim(),
        type: mode,
        subCategory,
        transactionDate,
        year: txYear,
        month: txMonth,
        description: description.trim(),
        counterpartyName: counterpartyName.trim() || '-',
        unitId: selectedUnit?.id || unitId || '',
        unitName: selectedUnit?.name || 'Kantor Pusat',
        bidangName:
          bidangName.trim() ||
          selectedParentRka?.category ||
          selectedUnit?.name ||
          'Bidang Umum dan Keuangan',
        cashBankId: selectedCb?.id || cashBankId,
        cashBankName: selectedCb?.name || '',
        coaId: selectedCoa?.id || coaId,
        coaCode: selectedCoa?.code || '',
        coaName: selectedCoa?.name || '',
        amount: Math.round(numAmount),
        rkaId: !isReceipt && selectedParentRka ? selectedParentRka.id : undefined,
        rkaCode: !isReceipt && selectedParentRka ? selectedParentRka.code : undefined,
        rkaProgramName:
          !isReceipt && selectedParentRka ? selectedParentRka.programName : undefined,
        rkaSubId: !isReceipt && selectedSubRka ? selectedSubRka.id : undefined,
        rkaSubCode: !isReceipt && selectedSubRka ? selectedSubRka.subCode : undefined,
        rkaSubProgramName:
          !isReceipt && selectedSubRka ? selectedSubRka.programName : undefined,
        rkaBudgetSnapshot: formRkaAbsorption?.budgetAmount,
        rkaPrevRealizationSnapshot: formRkaAbsorption?.previousRealization,
        status: finalStatus,
        attachments,
        duplicateKey: buildDuplicateKey({
          type: mode,
          transactionDate,
          amount: Math.round(numAmount),
          rkaId: !isReceipt ? rkaId : undefined,
          coaId,
          counterpartyName,
        }),
        duplicateWarningConfirmed: duplicateMatches.length > 0 && duplicateConfirmChecked,
        linkedJournalId,
        notes: notes.trim() || undefined,
        createdBy: editingTx?.createdBy || actor.displayName,
        createdByUid: editingTx?.createdByUid || actor.uid,
        createdByRole: editingTx?.createdByRole || actor.role,
        approvedBy: shouldAutoPost ? editingTx?.approvedBy || actor.displayName : undefined,
        approvedAt: shouldAutoPost ? editingTx?.approvedAt || now : undefined,
        createdAt: editingTx?.createdAt || now,
        updatedAt: now,
      });

      const batch = writeBatch(db);
      batch.set(doc(db, 'fin_transactions', txId), payload);

      if (shouldAutoPost && linkedJournalId) {
        const journal = buildAutoJournalForTransaction(payload, linkedJournalId);
        batch.set(doc(db, 'fin_journals', linkedJournalId), sanitizeFirestoreRecord(journal));
      } else if (!shouldAutoPost && editingTx?.linkedJournalId) {
        batch.delete(doc(db, 'fin_journals', editingTx.linkedJournalId));
      }

      const updatedAllTxs = [
        ...allTransactions.filter((t) => t.id !== txId),
        payload,
      ];
      const rkaTargets: Array<{ rkaId?: string; rkaSubId?: string }> = [];
      if (editingTx?.type === 'PENGELUARAN' && editingTx.rkaId) {
        rkaTargets.push({ rkaId: editingTx.rkaId, rkaSubId: editingTx.rkaSubId });
      }
      if (!isReceipt && payload.rkaId) {
        rkaTargets.push({ rkaId: payload.rkaId, rkaSubId: payload.rkaSubId });
      }
      if (rkaTargets.length > 0) {
        syncMultipleRkasToBatch(batch, rkaTargets, updatedAllTxs, payload.transactionDate);
      }

      await batch.commit();

      await onLogAudit({
        actionType:
          duplicateMatches.length > 0
            ? 'DUPLICATE_OVERRIDE'
            : editingTx
            ? 'UPDATE'
            : shouldAutoPost
            ? 'POST'
            : 'CREATE',
        entityType: isReceipt ? 'Penerimaan (BKM)' : 'Pengeluaran (BKK)',
        entityId: txId,
        entityLabel: payload.voucherNumber,
        summary: `${editingTx ? 'Pembaruan' : 'Pencatatan'} ${payload.voucherNumber} (${formatRp(payload.amount)}) · Status: ${payload.status}${
          payload.rkaCode ? ` · RKA ${payload.rkaCode}` : ''
        }`,
        beforeData: editingTx ? (editingTx as unknown as Record<string, unknown>) : null,
        afterData: payload as unknown as Record<string, unknown>,
        duplicateFlag: duplicateMatches.length > 0,
        year: payload.year,
      });

      setIsModalOpen(false);
      setFeedback({
        type: 'success',
        message: `${payload.voucherNumber} berhasil disimpan (${payload.status}).`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan transaksi: ${err instanceof Error ? err.message : 'Kesalahan jaringan'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTransaction = async () => {
    if (!deleteTarget || !permissions.isSuperUser) return;
    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'fin_transactions', deleteTarget.id));
      if (deleteTarget.linkedJournalId) {
        batch.delete(doc(db, 'fin_journals', deleteTarget.linkedJournalId));
      }

      const remainingTxs = allTransactions.filter((t) => t.id !== deleteTarget.id);
      if (deleteTarget.type === 'PENGELUARAN' && deleteTarget.rkaId) {
        syncMultipleRkasToBatch(
          batch,
          [{ rkaId: deleteTarget.rkaId, rkaSubId: deleteTarget.rkaSubId }],
          remainingTxs,
          getTodayIso()
        );
      }

      await batch.commit();
      await onLogAudit({
        actionType: 'DELETE',
        entityType: isReceipt ? 'Penerimaan (BKM)' : 'Pengeluaran (BKK)',
        entityId: deleteTarget.id,
        entityLabel: deleteTarget.voucherNumber,
        summary: `Super User menghapus transaksi ${deleteTarget.voucherNumber} (${formatRp(deleteTarget.amount)})`,
        beforeData: deleteTarget as unknown as Record<string, unknown>,
        afterData: null,
        year: deleteTarget.year,
      });

      setDeleteTarget(null);
      setFeedback({
        type: 'success',
        message: `Transaksi ${deleteTarget.voucherNumber} berhasil dihapus permanen.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menghapus transaksi: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleExecuteAction = async () => {
    if (!actionModal) return;
    const { tx, action } = actionModal;
    if (!permissions.isSuperUser && isPeriodLocked(periodCloses, tx.year, tx.month)) {
      setFeedback({
        type: 'error',
        message: `Periode ${tx.month} ${tx.year} sudah ditutup buku.`,
      });
      setActionModal(null);
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const newStatus: FinanceTransactionStatus =
        action === 'APPROVE'
          ? 'Disetujui / Diposting'
          : action === 'REJECT'
          ? 'Ditolak'
          : 'Dibatalkan';

      const journalId = tx.linkedJournalId || `jrn-${tx.id}`;
      const updatedTx: FinanceTransaction = sanitizeFirestoreRecord({
        ...tx,
        status: newStatus,
        linkedJournalId: action === 'APPROVE' ? journalId : tx.linkedJournalId,
        approvedBy: action === 'APPROVE' ? actor.displayName : tx.approvedBy,
        approvedAt: action === 'APPROVE' ? now : tx.approvedAt,
        approvalNotes: actionNotes.trim() || tx.approvalNotes,
        updatedAt: now,
      });

      const batch = writeBatch(db);
      batch.set(doc(db, 'fin_transactions', tx.id), updatedTx);

      if (action === 'APPROVE') {
        const journal = buildAutoJournalForTransaction(updatedTx, journalId);
        batch.set(doc(db, 'fin_journals', journalId), sanitizeFirestoreRecord(journal));
      } else if (action === 'CANCEL' && tx.linkedJournalId) {
        batch.update(doc(db, 'fin_journals', tx.linkedJournalId), {
          status: 'Reversed',
          updatedAt: now,
        });
      }

      const updatedAllTxs = allTransactions.map((item) =>
        item.id === tx.id ? updatedTx : item
      );
      if (tx.type === 'PENGELUARAN' && tx.rkaId) {
        syncMultipleRkasToBatch(
          batch,
          [{ rkaId: tx.rkaId, rkaSubId: tx.rkaSubId }],
          updatedAllTxs,
          tx.transactionDate
        );
      }

      await batch.commit();

      await onLogAudit({
        actionType:
          action === 'APPROVE' ? 'APPROVE' : action === 'REJECT' ? 'REJECT' : 'CANCEL',
        entityType: isReceipt ? 'Penerimaan (BKM)' : 'Pengeluaran (BKK)',
        entityId: tx.id,
        entityLabel: tx.voucherNumber,
        summary: `${
          action === 'APPROVE'
            ? 'Menyetujui & Memposting'
            : action === 'REJECT'
            ? 'Menolak'
            : 'Membatalkan'
        } ${tx.voucherNumber} (${formatRp(tx.amount)})`,
        beforeData: tx as unknown as Record<string, unknown>,
        afterData: updatedTx as unknown as Record<string, unknown>,
        approvalNotes: actionNotes.trim() || undefined,
        year: tx.year,
      });

      setActionModal(null);
      setActionNotes('');
      setFeedback({
        type: 'success',
        message: `${tx.voucherNumber} diperbarui menjadi "${newStatus}".`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal memproses aksi: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span className="font-medium">{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs underline font-semibold shrink-0 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Recap Strip per Category */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {categoryRecap.map(([catName, info]) => (
          <div
            key={catName}
            className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col justify-between"
          >
            <span className="text-[11px] font-semibold text-slate-600 line-clamp-1">
              {catName}
            </span>
            <div className="mt-1.5 flex items-baseline justify-between gap-1">
              <span className="text-sm font-bold text-slate-900 font-mono tabular-nums">
                {formatRp(info.total)}
              </span>
              <span className="text-[11px] text-slate-500">{info.count} trx</span>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={`Cari nomor ${isReceipt ? 'BKM' : 'BKK'}, uraian, pihak, RKA...`}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-emerald-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700"
          >
            <option value="ALL">Semua Jenis {isReceipt ? 'Penerimaan' : 'Pengeluaran'}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium text-slate-700"
          >
            <option value="ALL">Semua Status</option>
            <option value="Draft">Draft</option>
            <option value="Menunggu Persetujuan">Menunggu Persetujuan</option>
            <option value="Disetujui / Diposting">Disetujui / Diposting</option>
            <option value="Ditolak">Ditolak</option>
            <option value="Dibatalkan">Dibatalkan</option>
          </select>
        </div>

        {permissions.canOperate && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{isReceipt ? 'Catat Bukti Kas Masuk (BKM)' : 'Catat Bukti Kas Keluar (BKK)'}</span>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-3">Tanggal & Bukti</th>
                <th className="py-2.5 px-3">Jenis & Uraian</th>
                <th className="py-2.5 px-3">Kas / Bank & Akun</th>
                {!isReceipt && <th className="py-2.5 px-3">Pos RKA Terkait</th>}
                <th className="py-2.5 px-3 text-right">Nominal</th>
                <th className="py-2.5 px-3">Status & Lampiran</th>
                <th className="py-2.5 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={isReceipt ? 6 : 7} className="py-10 text-center text-slate-500">
                    Belum ada transaksi {isReceipt ? 'penerimaan' : 'pengeluaran'} sesuai filter.
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/80 align-top">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-mono font-bold text-slate-900">{tx.voucherNumber}</div>
                      <div className="text-[11px] text-slate-500">
                        {formatDateShort(tx.transactionDate)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 max-w-xs">
                      <div className="text-[11px] font-semibold text-emerald-800">
                        {tx.subCategory}
                      </div>
                      <div className="font-medium text-slate-900">{tx.description}</div>
                      <div className="text-[11px] text-slate-500">
                        {isReceipt ? 'Dari: ' : 'Kepada: '}
                        {tx.counterpartyName} · {tx.unitName}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-800">{tx.cashBankName}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {tx.coaCode} · {tx.coaName}
                      </div>
                    </td>
                    {!isReceipt && (
                      <td className="py-2.5 px-3 max-w-[210px]">
                        {tx.rkaCode ? (
                          <div>
                            <div className="font-mono text-[11px] font-bold text-teal-800">
                              {tx.rkaCode}
                              {tx.rkaSubCode ? ` › ${tx.rkaSubCode}` : ''}
                            </div>
                            <div className="text-[11px] text-slate-600 line-clamp-2">
                              {tx.rkaSubProgramName || tx.rkaProgramName}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">Non-RKA / Umum</span>
                        )}
                      </td>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                      {formatRp(tx.amount)}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded-md border ${getTxStatusStyle(
                          tx.status
                        )}`}
                      >
                        {tx.status}
                      </span>
                      {tx.attachments && tx.attachments.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {tx.attachments.map((att) => (
                            <a
                              key={att.id}
                              href={att.inlineDataUrl || att.fileUrl || '#'}
                              download={att.inlineDataUrl ? att.fileName : undefined}
                              target={att.fileUrl ? '_blank' : undefined}
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-teal-700 hover:underline"
                            >
                              <FileText className="w-3 h-3" />
                              <span className="max-w-[90px] truncate">{att.fileName}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {(permissions.isSuperUser ||
                          (permissions.canOperate &&
                            (tx.status === 'Draft' || tx.status === 'Menunggu Persetujuan'))) && (
                          <button
                            type="button"
                            onClick={() => openEditModal(tx)}
                            className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded-md cursor-pointer"
                            title="Edit Transaksi"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {permissions.canApprove &&
                          (tx.status === 'Draft' || tx.status === 'Menunggu Persetujuan') && (
                            <>
                              <button
                                type="button"
                                onClick={() => setActionModal({ tx, action: 'APPROVE' })}
                                className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-md cursor-pointer"
                                title="Setujui & Posting ke Jurnal/RKA"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setActionModal({ tx, action: 'REJECT' })}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer"
                                title="Tolak Transaksi"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        {permissions.canApprove && tx.status === 'Disetujui / Diposting' && (
                          <button
                            type="button"
                            onClick={() => setActionModal({ tx, action: 'CANCEL' })}
                            className="p-1.5 text-rose-700 hover:bg-rose-50 rounded-md cursor-pointer"
                            title="Batalkan & Balik Jurnal / Realisasi RKA"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {permissions.isSuperUser && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(tx)}
                            className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md cursor-pointer"
                            title="Hapus Transaksi (Super User)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {editingTx ? 'Edit' : 'Input'}{' '}
                  {isReceipt ? 'Bukti Kas Masuk (BKM)' : 'Bukti Kas Keluar (BKK)'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Otomatis terhubung ke Kas/Bank, Jurnal Akuntansi{!isReceipt ? ', dan Pos RKA Existing' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Duplicate Warning Alert */}
              {duplicateMatches.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 font-bold text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Deteksi Potensi Transaksi Ganda ({duplicateMatches.length})</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-[11px] text-amber-900">
                    {duplicateMatches.map((m, i) => (
                      <li key={i}>
                        <span className="font-mono font-bold">{m.existingTx.voucherNumber}</span>:{' '}
                        {m.reason}
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-center gap-2 pt-1 font-semibold text-amber-950 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={duplicateConfirmChecked}
                      onChange={(e) => setDuplicateConfirmChecked(e.target.checked)}
                      className="rounded text-amber-700"
                    />
                    <span>Saya konfirmasi transaksi ini bukan duplikat (tercatat di Audit Trail).</span>
                  </label>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nomor Bukti ({isReceipt ? 'BKM' : 'BKK'}) *
                  </label>
                  <input
                    type="text"
                    value={voucherNumber}
                    onChange={(e) => setVoucherNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Tanggal Transaksi *
                  </label>
                  <input
                    type="date"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Kategori {isReceipt ? 'Penerimaan' : 'Pengeluaran'} *
                  </label>
                  <select
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-medium"
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    {isReceipt ? 'Diterima Dari (Pelanggan / Penyetor)' : 'Dibayarkan Kepada (Rekanan / Penerima)'}
                  </label>
                  <input
                    type="text"
                    value={counterpartyName}
                    onChange={(e) => setCounterpartyName(e.target.value)}
                    placeholder={isReceipt ? 'Contoh: Pelanggan Wilayah Lubuk Sikaping' : 'Contoh: PT Supplier Kimia / PLN'}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nominal (Rp) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Uraian / Keterangan Transaksi *
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Jelaskan transaksi secara jelas sesuai bukti kas..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Rekening Kas / Bank *
                  </label>
                  <select
                    value={cashBankId}
                    onChange={(e) => setCashBankId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">-- Pilih Kas / Bank --</option>
                    {cashBankAccounts.map((cb) => (
                      <option key={cb.id} value={cb.id}>
                        {cb.code} - {cb.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Akun COA (Kode Rekening) *
                  </label>
                  <select
                    value={coaId}
                    onChange={(e) => setCoaId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">-- Pilih Kode Rekening Akun --</option>
                    {eligibleCoaList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name} ({a.type})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Unit Kerja / Unit Pelayanan
                  </label>
                  <select
                    value={unitId}
                    onChange={(e) => setUnitId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Kantor Pusat / Umum</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Bidang Penanggung Jawab
                  </label>
                  <input
                    type="text"
                    value={bidangName}
                    onChange={(e) => setBidangName(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Integrasi RKA Existing untuk PENGELUARAN */}
              {!isReceipt && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">
                      Integrasi Pos Anggaran RKA Existing (TA {txYear})
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Anti-double-counting otomatis
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Pos Anggaran Induk RKA
                      </label>
                      <select
                        value={rkaId}
                        onChange={(e) => {
                          setRkaId(e.target.value);
                          setRkaSubId('');
                          const found = rkaItems.find((r) => r.id === e.target.value);
                          if (found) {
                            setBidangName(found.category);
                            if (found.unitId) setUnitId(found.unitId);
                          }
                        }}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">-- Non-RKA / Tidak Terkait Pos RKA --</option>
                        {availableRkaParents.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.code} - {r.programName} ({formatRp(r.budgetAmount)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        Sub-Program Kerja RKA (Opsional)
                      </label>
                      <select
                        value={rkaSubId}
                        onChange={(e) => setRkaSubId(e.target.value)}
                        disabled={!rkaId || availableRkaSubs.length === 0}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      >
                        <option value="">-- Pos Induk Langsung --</option>
                        {availableRkaSubs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.subCode} - {s.programName} ({formatRp(s.allocatedBudget)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {formRkaAbsorption && (
                    <div className="bg-white border border-slate-200 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-[11px]">
                      <div>
                        <span className="text-slate-500 block">Pagu Anggaran</span>
                        <span className="font-mono font-bold text-slate-900">
                          {formatRp(formRkaAbsorption.budgetAmount)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Realisasi Sebelumnya</span>
                        <span className="font-mono font-semibold text-slate-700">
                          {formatRp(formRkaAbsorption.previousRealization)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Realisasi Saat Ini</span>
                        <span className="font-mono font-semibold text-teal-800">
                          {formatRp(formRkaAbsorption.currentRealization)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Total Realisasi</span>
                        <span className="font-mono font-bold text-slate-900">
                          {formatRp(formRkaAbsorption.totalRealization)} ({formRkaAbsorption.absorptionPct}%)
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Sisa Anggaran</span>
                        <span
                          className={`font-mono font-bold ${
                            formRkaAbsorption.remainingBudget < 0
                              ? 'text-rose-700'
                              : 'text-emerald-800'
                          }`}
                        >
                          {formatRp(formRkaAbsorption.remainingBudget)}
                        </span>
                      </div>
                      {formRkaAbsorption.isOverBudget && (
                        <div className="col-span-full text-rose-700 font-semibold flex items-center gap-1.5 pt-1 border-t border-rose-100">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>Peringatan: Nominal pengeluaran melebihi sisa pagu anggaran RKA terpilih.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Upload / Link Bukti Transaksi */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-800">
                    Bukti Transaksi (Upload Dokumen ≤ 350 KB atau Tautan URL)
                  </span>
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-white border border-emerald-300 rounded-lg cursor-pointer hover:bg-emerald-50">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={handleFileAttachment}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={attachmentLabelInput}
                    onChange={(e) => setAttachmentLabelInput(e.target.value)}
                    placeholder="Nama bukti (misal: Kwitansi #01)"
                    className="sm:w-44 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    type="url"
                    value={attachmentUrlInput}
                    onChange={(e) => setAttachmentUrlInput(e.target.value)}
                    placeholder="https://drive.google.com/... (opsional)"
                    className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={handleAddAttachmentUrl}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>Tambah Tautan</span>
                  </button>
                </div>

                {attachments.length > 0 && (
                  <div className="space-y-1">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px]"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileText className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                          <span className="font-medium truncate">{att.fileName}</span>
                          {att.fileUrl && <ExternalLink className="w-3 h-3 text-slate-400" />}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setAttachments((prev) => prev.filter((x) => x.id !== att.id))
                          }
                          className="text-rose-600 hover:text-rose-800 p-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Catatan Tambahan
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveTransaction('Draft')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-200 hover:bg-slate-300 rounded-lg cursor-pointer"
              >
                Simpan Draft
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveTransaction('Menunggu Persetujuan')}
                className="px-3.5 py-2 text-xs font-bold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg cursor-pointer"
              >
                Ajukan Verifikasi
              </button>
              {permissions.canApprove && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleSaveTransaction('Disetujui / Diposting')}
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  {editingTx?.status === 'Disetujui / Diposting'
                    ? 'Simpan Perubahan (Terposting)'
                    : 'Simpan & Posting'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Approval / Reject / Cancel Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-4 shadow-xl text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              {actionModal.action === 'APPROVE'
                ? 'Setujui & Posting Transaksi'
                : actionModal.action === 'REJECT'
                ? 'Tolak Pengajuan Transaksi'
                : 'Batalkan Transaksi Terposting'}
            </h3>
            <p className="text-slate-600">
              Bukti <span className="font-mono font-bold text-slate-900">{actionModal.tx.voucherNumber}</span> sebesar{' '}
              <span className="font-mono font-bold text-slate-900">{formatRp(actionModal.tx.amount)}</span>.
              {actionModal.action === 'APPROVE'
                ? ' Jurnal otomatis dan pembaruan realisasi RKA akan dicatat.'
                : actionModal.action === 'CANCEL'
                ? ' Jurnal terkait akan dibalik (Reversed) dan realisasi RKA dikembalikan otomatis.'
                : ''}
            </p>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Catatan Persetujuan / Alasan
              </label>
              <textarea
                rows={2}
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                placeholder="Catatan verifikator..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setActionModal(null);
                  setActionNotes('');
                }}
                className="px-3.5 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleExecuteAction}
                className={`px-4 py-2 font-bold text-white rounded-lg cursor-pointer ${
                  actionModal.action === 'APPROVE'
                    ? 'bg-emerald-700 hover:bg-emerald-800'
                    : 'bg-rose-700 hover:bg-rose-800'
                }`}
              >
                Konfirmasi
              </button>
            </div>
          </div>
        </div>
      )}
      <FinanceDeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        title={`Hapus ${isReceipt ? 'Bukti Kas Masuk (BKM)' : 'Bukti Kas Keluar (BKK)'}`}
        itemLabel={
          deleteTarget
            ? `${deleteTarget.voucherNumber} (${formatRp(deleteTarget.amount)})`
            : ''
        }
        description={
          deleteTarget?.linkedJournalId || deleteTarget?.rkaCode
            ? 'Jurnal akuntansi otomatis terkait akan ikut dihapus dan penyerapan anggaran RKA akan dihitung ulang.'
            : 'Data transaksi ini akan dihapus permanen dari database.'
        }
        submitting={submitting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteTransaction}
      />
    </div>
  );
};
