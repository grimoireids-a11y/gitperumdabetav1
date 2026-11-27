import React, { useMemo, useState } from 'react';
import {
  Plus,
  Building2,
  Calculator,
  ArrowRightLeft,
  Receipt,
  CheckCircle2,
  Edit3,
  Trash2,
  X,
} from 'lucide-react';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { RKAItem, Unit } from '../../types/audit';
import {
  FinanceAccount,
  FinanceAsset,
  FinanceCashBankAccount,
  FinanceGlobalFilter,
  FinanceJournal,
  FinanceTaxRecord,
  FinanceTaxType,
  FinanceTransaction,
} from '../../types/finance';
import { FINANCE_ASSET_CATEGORIES, FINANCE_TAX_TYPES } from '../../data/financeStandards';
import {
  buildDuplicateKey,
  formatDateShort,
  formatRp,
  getMonthNameFromDate,
  getTodayIso,
  matchesGlobalFilter,
  resolveMonthScopedAssets,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';
import { FinanceDeleteConfirmModal } from './FinanceDeleteConfirmModal';

interface FinanceAssetsTaxTabProps {
  mode: 'ASSETS' | 'TAXES';
  filter: FinanceGlobalFilter;
  assets: FinanceAsset[];
  taxes: FinanceTaxRecord[];
  accounts: FinanceAccount[];
  cashBankAccounts: FinanceCashBankAccount[];
  rkaItems: RKAItem[];
  units: Unit[];
  actor: FinanceActor;
  permissions: FinancePermissions;
  onLogAudit: LogFinanceAuditFn;
}

export const FinanceAssetsTaxTab: React.FC<FinanceAssetsTaxTabProps> = ({
  mode,
  filter,
  assets,
  taxes,
  accounts,
  cashBankAccounts,
  rkaItems,
  units,
  actor,
  permissions,
  onLogAudit,
}) => {
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // Asset Modals
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<FinanceAsset | null>(null);
  const [assetCode, setAssetCode] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetCat, setAssetCat] = useState<string>(FINANCE_ASSET_CATEGORIES[0]);
  const [assetUnitId, setAssetUnitId] = useState('');
  const [assetDate, setAssetDate] = useState(getTodayIso());
  const [assetCost, setAssetCost] = useState('');
  const [assetLifeMonths, setAssetLifeMonths] = useState('60');
  const [assetSalvage, setAssetSalvage] = useState('0');
  const [assetAccumDep, setAssetAccumDep] = useState('0');
  const [assetStatus, setAssetStatus] = useState<FinanceAsset['status']>('Aktif');
  const [assetRkaId, setAssetRkaId] = useState('');

  // Asset Mutation Modal
  const [mutateAsset, setMutateAsset] = useState<FinanceAsset | null>(null);
  const [mutDate, setMutDate] = useState(getTodayIso());
  const [mutToUnitId, setMutToUnitId] = useState('');
  const [mutCondition, setMutCondition] = useState<'Baik' | 'Perlu Perbaikan' | 'Rusak Berat'>('Baik');
  const [mutNotes, setMutNotes] = useState('');

  // Tax Modals
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<FinanceTaxRecord | null>(null);
  const [taxType, setTaxType] = useState<FinanceTaxType>('PPN');
  const [withholdingNo, setWithholdingNo] = useState('');
  const [taxObject, setTaxObject] = useState('');
  const [taxBase, setTaxBase] = useState('');
  const [taxRate, setTaxRate] = useState('11');
  const [taxDueDate, setTaxDueDate] = useState(getTodayIso());
  const [taxUnitId, setTaxUnitId] = useState('');
  const [taxStatusEdit, setTaxStatusEdit] = useState<FinanceTaxRecord['status']>('Terutang');
  const [taxNtpnEdit, setTaxNtpnEdit] = useState('');
  const [taxPayDateEdit, setTaxPayDateEdit] = useState('');

  // Pay Tax Modal
  const [payTaxTarget, setPayTaxTarget] = useState<FinanceTaxRecord | null>(null);
  const [taxPayDate, setTaxPayDate] = useState(getTodayIso());
  const [ntpnNo, setNtpnNo] = useState('');
  const [taxCashBankId, setTaxCashBankId] = useState('');

  // Delete Confirm Modal
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'ASSET'; item: FinanceAsset }
    | { kind: 'TAX'; item: FinanceTaxRecord }
    | null
  >(null);

  const activeYear = filter.year !== 0 ? filter.year : 2026;

  const filteredAssets = useMemo(() => {
    const scoped = resolveMonthScopedAssets(assets, filter.year, filter.month);
    return scoped.filter((a) =>
      matchesGlobalFilter(
        {
          unitId: a.unitId,
        },
        { ...filter, year: 0, month: 'ALL' }
      )
    );
  }, [assets, filter]);

  const assetTotals = useMemo(() => {
    return filteredAssets.reduce(
      (acc, a) => ({
        cost: acc.cost + (a.acquisitionCost || 0),
        accumDep: acc.accumDep + (a.accumulatedDepreciation || 0),
        bookVal: acc.bookVal + (a.bookValue || 0),
      }),
      { cost: 0, accumDep: 0, bookVal: 0 }
    );
  }, [filteredAssets]);

  const filteredTaxes = useMemo(() => {
    return taxes.filter((t) =>
      matchesGlobalFilter(
        {
          year: t.year,
          month: t.month,
          unitId: t.unitId,
        },
        filter
      )
    );
  }, [taxes, filter]);

  const taxSummaryByType = useMemo(() => {
    const map = new Map<string, { owed: number; paid: number }>();
    FINANCE_TAX_TYPES.forEach((tt) => map.set(tt, { owed: 0, paid: 0 }));
    filteredTaxes.forEach((t) => {
      const cur = map.get(t.taxType) || { owed: 0, paid: 0 };
      if (t.status === 'Terutang') cur.owed += t.taxAmount || 0;
      else cur.paid += t.taxAmount || 0;
      map.set(t.taxType, cur);
    });
    return Array.from(map.entries()).filter(([, v]) => v.owed > 0 || v.paid > 0);
  }, [filteredTaxes]);

  // Asset Handlers
  const handleSaveAsset = async () => {
    const cost = Number(assetCost);
    const life = Math.max(1, Number(assetLifeMonths) || 60);
    const salvage = Math.max(0, Number(assetSalvage) || 0);
    const accumDep = editingAsset ? Math.max(0, Math.round(Number(assetAccumDep) || 0)) : 0;
    if (!assetCode.trim() || !assetName.trim() || !Number.isFinite(cost) || cost <= 0) {
      setFeedback({ type: 'error', message: 'Kode aset, nama aset, dan nilai perolehan > 0 wajib diisi.' });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = editingAsset?.id || `ast-${Date.now()}`;
      const u = units.find((x) => x.id === assetUnitId);
      const rka = rkaItems.find((x) => x.id === assetRkaId);
      const roundedCost = Math.round(cost);
      const roundedSalvage = Math.round(salvage);
      const computedBookValue = Math.max(roundedSalvage, roundedCost - accumDep);

      const rec: FinanceAsset = sanitizeFirestoreRecord({
        id,
        assetCode: assetCode.trim(),
        name: assetName.trim(),
        category: assetCat,
        unitId: u?.id || '',
        unitName: u?.name || 'Kantor Pusat',
        acquisitionDate: assetDate,
        acquisitionCost: roundedCost,
        usefulLifeMonths: Math.round(life),
        salvageValue: roundedSalvage,
        depreciationMethod: 'Garis Lurus',
        accumulatedDepreciation: accumDep,
        bookValue: computedBookValue,
        rkaId: rka?.id,
        rkaCode: rka?.code,
        status: editingAsset ? assetStatus : 'Aktif',
        mutations: editingAsset?.mutations || [],
        createdBy: editingAsset?.createdBy || actor.displayName,
        createdAt: editingAsset?.createdAt || now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_assets', id), rec);
      await onLogAudit({
        actionType: editingAsset ? 'UPDATE' : 'CREATE',
        entityType: 'Registrasi Aset Tetap',
        entityId: id,
        entityLabel: `${rec.assetCode} - ${rec.name}`,
        summary: `${editingAsset ? 'Pembaruan' : 'Registrasi'} aset ${rec.name} dengan nilai perolehan ${formatRp(rec.acquisitionCost)}`,
        beforeData: editingAsset ? (editingAsset as unknown as Record<string, unknown>) : null,
        afterData: rec as unknown as Record<string, unknown>,
      });

      setIsAssetModalOpen(false);
      setEditingAsset(null);
      setFeedback({
        type: 'success',
        message: `Aset ${rec.name} berhasil ${editingAsset ? 'diperbarui' : 'diregistrasi'}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan aset: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunMonthlyDepreciation = async () => {
    const activeAssets = filteredAssets.filter(
      (a) => a.status === 'Aktif' && a.bookValue > (a.salvageValue || 0)
    );
    if (activeAssets.length === 0) {
      setFeedback({ type: 'error', message: 'Tidak ada aset aktif yang dapat disusutkan.' });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const today = getTodayIso();
      const batch = writeBatch(db);
      let totalDepMonth = 0;

      activeAssets.forEach((a) => {
        const monthlyDep = Math.round(
          Math.max(0, (a.acquisitionCost - (a.salvageValue || 0)) / Math.max(1, a.usefulLifeMonths))
        );
        const applied = Math.min(monthlyDep, Math.max(0, a.bookValue - (a.salvageValue || 0)));
        if (applied <= 0) return;
        totalDepMonth += applied;
        batch.update(doc(db, 'fin_assets', a.id), {
          accumulatedDepreciation: (a.accumulatedDepreciation || 0) + applied,
          bookValue: Math.max(a.salvageValue || 0, a.bookValue - applied),
          updatedAt: now,
        });
      });

      if (totalDepMonth > 0) {
        const depExpCoa = accounts.find((c) => c.code === '5-2201') || accounts.find((c) => c.type === 'Beban');
        const accumCoa = accounts.find((c) => c.code === '1-2901') || accounts.find((c) => c.type === 'Aset');
        const jrnId = `jrn-dep-${Date.now()}`;
        const jrn: FinanceJournal = {
          id: jrnId,
          journalNumber: `JRN-DEP-${activeYear}-${Date.now().toString().slice(-4)}`,
          journalType: 'PENYESUAIAN',
          journalDate: today,
          year: activeYear,
          month: getMonthNameFromDate(today),
          description: `Beban Penyusutan Aset Tetap Bulanan (${activeAssets.length} unit aset)`,
          lines: [
            {
              coaId: depExpCoa?.id || 'coa-dep-exp',
              coaCode: depExpCoa?.code || '5-2201',
              coaName: depExpCoa?.name || 'Beban Penyusutan Aset Tetap',
              debit: totalDepMonth,
              credit: 0,
            },
            {
              coaId: accumCoa?.id || 'coa-accum-dep',
              coaCode: accumCoa?.code || '1-2901',
              coaName: accumCoa?.name || 'Akumulasi Penyusutan Aset Tetap',
              debit: 0,
              credit: totalDepMonth,
            },
          ],
          totalDebit: totalDepMonth,
          totalCredit: totalDepMonth,
          status: 'Posted',
          createdBy: actor.displayName,
          createdByUid: actor.uid,
          createdAt: now,
          updatedAt: now,
        };
        batch.set(doc(db, 'fin_journals', jrnId), jrn);
      }

      await batch.commit();
      await onLogAudit({
        actionType: 'POST',
        entityType: 'Penyusutan Aset Tetap',
        entityId: `dep-${Date.now()}`,
        entityLabel: `Penyusutan ${activeYear}`,
        summary: `Menjalankan penyusutan bulanan ${activeAssets.length} aset tetap senilai total ${formatRp(totalDepMonth)}`,
        year: activeYear,
      });

      setFeedback({
        type: 'success',
        message: `Penyusutan bulanan sebesar ${formatRp(totalDepMonth)} berhasil diposting ke jurnal penyesuaian.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menghitung penyusutan: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAssetMutation = async () => {
    if (!mutateAsset) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const targetUnit = units.find((u) => u.id === mutToUnitId);
      const mutItem = {
        id: `mut-${Date.now()}`,
        mutationDate: mutDate,
        fromUnitId: mutateAsset.unitId,
        fromUnitName: mutateAsset.unitName,
        toUnitId: targetUnit?.id || mutateAsset.unitId,
        toUnitName: targetUnit?.name || mutateAsset.unitName,
        condition: mutCondition,
        notes: mutNotes.trim() || undefined,
        recordedBy: actor.displayName,
        createdAt: now,
      };
      const updated: FinanceAsset = sanitizeFirestoreRecord({
        ...mutateAsset,
        unitId: targetUnit?.id || mutateAsset.unitId,
        unitName: targetUnit?.name || mutateAsset.unitName,
        status: mutCondition === 'Rusak Berat' ? 'Dalam Perbaikan' : 'Aktif',
        mutations: [...(mutateAsset.mutations || []), sanitizeFirestoreRecord(mutItem)],
        updatedAt: now,
      });
      await setDoc(doc(db, 'fin_assets', mutateAsset.id), updated);
      await onLogAudit({
        actionType: 'UPDATE',
        entityType: 'Mutasi Aset',
        entityId: mutateAsset.id,
        entityLabel: mutateAsset.assetCode,
        summary: `Mutasi aset ${mutateAsset.name} dari ${mutItem.fromUnitName} ke ${mutItem.toUnitName} (${mutCondition})`,
        beforeData: mutateAsset as unknown as Record<string, unknown>,
        afterData: updated as unknown as Record<string, unknown>,
      });
      setMutateAsset(null);
      setFeedback({ type: 'success', message: `Mutasi aset ${mutateAsset.name} berhasil dicatat.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal mencatat mutasi: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Tax Handlers
  const handleSaveTax = async () => {
    const base = Number(taxBase);
    const rate = Number(taxRate);
    if (!withholdingNo.trim() || !taxObject.trim() || !Number.isFinite(base) || base <= 0) {
      setFeedback({ type: 'error', message: 'Nomor bukti potong, objek pajak, dan DPP > 0 wajib diisi.' });
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = editingTax?.id || `tax-${Date.now()}`;
      const year = parseInt(taxDueDate.slice(0, 4), 10) || activeYear;
      const month = getMonthNameFromDate(taxDueDate);
      const u = units.find((x) => x.id === taxUnitId);
      const taxAmount = Math.round((base * rate) / 100);
      const finalStatus = editingTax ? taxStatusEdit : 'Terutang';

      const rec: FinanceTaxRecord = sanitizeFirestoreRecord({
        id,
        taxType,
        year,
        month,
        withholdingNumber: withholdingNo.trim(),
        taxObject: taxObject.trim(),
        taxBaseAmount: Math.round(base),
        taxRatePct: rate,
        taxAmount,
        status: finalStatus,
        dueDate: taxDueDate,
        paymentDate:
          editingTax && finalStatus !== 'Terutang'
            ? taxPayDateEdit.trim() || editingTax.paymentDate
            : undefined,
        ntpnNumber:
          editingTax && finalStatus !== 'Terutang'
            ? taxNtpnEdit.trim() || editingTax.ntpnNumber
            : undefined,
        cashBankId: editingTax?.cashBankId,
        cashBankName: editingTax?.cashBankName,
        transactionId: editingTax?.transactionId,
        voucherNumber: editingTax?.voucherNumber,
        unitId: u?.id || '',
        unitName: u?.name || 'Kantor Pusat',
        createdBy: editingTax?.createdBy || actor.displayName,
        createdAt: editingTax?.createdAt || now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_taxes', id), rec);
      await onLogAudit({
        actionType: editingTax ? 'UPDATE' : 'CREATE',
        entityType: 'Pencatatan Pajak',
        entityId: id,
        entityLabel: `${rec.taxType} · ${rec.withholdingNumber}`,
        summary: `${editingTax ? 'Pembaruan' : 'Pencatatan'} ${rec.taxType} (${rec.status}) ${formatRp(rec.taxAmount)} (${rec.taxObject})`,
        beforeData: editingTax ? (editingTax as unknown as Record<string, unknown>) : null,
        afterData: rec as unknown as Record<string, unknown>,
        year,
      });
      setIsTaxModalOpen(false);
      setEditingTax(null);
      setFeedback({
        type: 'success',
        message: `Pajak ${rec.taxType} sebesar ${formatRp(taxAmount)} berhasil ${editingTax ? 'diperbarui' : 'dicatat'}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan pajak: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !permissions.isSuperUser) return;
    setSubmitting(true);
    try {
      if (deleteTarget.kind === 'ASSET') {
        const a = deleteTarget.item;
        await deleteDoc(doc(db, 'fin_assets', a.id));
        await onLogAudit({
          actionType: 'DELETE',
          entityType: 'Registrasi Aset Tetap',
          entityId: a.id,
          entityLabel: `${a.assetCode} - ${a.name}`,
          summary: `Super User menghapus aset ${a.assetCode} (${a.name})`,
          beforeData: a as unknown as Record<string, unknown>,
          afterData: null,
        });
        setFeedback({ type: 'success', message: `Aset ${a.name} berhasil dihapus permanen.` });
      } else {
        const t = deleteTarget.item;
        await deleteDoc(doc(db, 'fin_taxes', t.id));
        await onLogAudit({
          actionType: 'DELETE',
          entityType: 'Pencatatan Pajak',
          entityId: t.id,
          entityLabel: `${t.taxType} · ${t.withholdingNumber}`,
          summary: `Super User menghapus catatan pajak ${t.taxType} (${t.withholdingNumber})`,
          beforeData: t as unknown as Record<string, unknown>,
          afterData: null,
          year: t.year,
        });
        setFeedback({ type: 'success', message: `Catatan pajak ${t.withholdingNumber} berhasil dihapus permanen.` });
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

  const handlePayTax = async () => {
    if (!payTaxTarget) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const cb = cashBankAccounts.find((c) => c.id === taxCashBankId) || cashBankAccounts[0];
      const updated: FinanceTaxRecord = sanitizeFirestoreRecord({
        ...payTaxTarget,
        status: 'Dibayar',
        paymentDate: taxPayDate,
        ntpnNumber: ntpnNo.trim() || `NTPN-${Date.now().toString().slice(-6)}`,
        cashBankId: cb?.id || '',
        cashBankName: cb?.name || '',
        updatedAt: now,
      });

      const batch = writeBatch(db);
      batch.set(doc(db, 'fin_taxes', payTaxTarget.id), updated);

      if (cb) {
        const year = parseInt(taxPayDate.slice(0, 4), 10) || activeYear;
        const month = getMonthNameFromDate(taxPayDate);
        const txId = `tx-tax-${Date.now()}`;
        const jrnId = `jrn-${txId}`;
        const voucher = `BKK-TAX-${Date.now().toString().slice(-4)}`;
        const taxCoa = accounts.find((a) => a.code === '2-1201') || accounts.find((a) => a.type === 'Kewajiban');
        const cashCoa = accounts.find((a) => a.id === cb.coaId || a.code === cb.coaCode);

        const tx: FinanceTransaction = sanitizeFirestoreRecord({
          id: txId,
          voucherNumber: voucher,
          type: 'PENGELUARAN',
          subCategory: 'Pembayaran Pajak',
          transactionDate: taxPayDate,
          year,
          month,
          description: `Setor ${payTaxTarget.taxType} (${payTaxTarget.withholdingNumber}) - NTPN ${updated.ntpnNumber}`,
          counterpartyName: 'Kas Negara / DJP',
          unitId: payTaxTarget.unitId || '',
          unitName: payTaxTarget.unitName || 'Kantor Pusat',
          bidangName: 'Keuangan & Penagihan',
          cashBankId: cb.id,
          cashBankName: cb.name,
          coaId: taxCoa?.id || 'coa-tax',
          coaCode: taxCoa?.code || '2-1201',
          coaName: taxCoa?.name || 'Utang Pajak',
          amount: payTaxTarget.taxAmount,
          status: 'Disetujui / Diposting',
          attachments: [],
          duplicateKey: buildDuplicateKey({
            type: 'PENGELUARAN',
            transactionDate: taxPayDate,
            amount: payTaxTarget.taxAmount,
            coaId: taxCoa?.id,
            counterpartyName: 'Kas Negara',
          }),
          linkedJournalId: jrnId,
          linkedTaxId: payTaxTarget.id,
          createdBy: actor.displayName,
          createdByUid: actor.uid,
          createdByRole: actor.role,
          approvedBy: actor.displayName,
          approvedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        const jrn: FinanceJournal = {
          id: jrnId,
          journalNumber: `JRN-${voucher}`,
          journalType: 'PENGELUARAN',
          journalDate: taxPayDate,
          year,
          month,
          referenceNumber: voucher,
          sourceTransactionId: txId,
          description: tx.description,
          lines: [
            {
              coaId: taxCoa?.id || 'coa-tax',
              coaCode: taxCoa?.code || '2-1201',
              coaName: taxCoa?.name || 'Utang Pajak',
              debit: payTaxTarget.taxAmount,
              credit: 0,
            },
            {
              coaId: cashCoa?.id || cb.coaId,
              coaCode: cashCoa?.code || cb.coaCode,
              coaName: cashCoa?.name || cb.name,
              debit: 0,
              credit: payTaxTarget.taxAmount,
            },
          ],
          totalDebit: payTaxTarget.taxAmount,
          totalCredit: payTaxTarget.taxAmount,
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
        actionType: 'POST',
        entityType: 'Pembayaran Pajak',
        entityId: payTaxTarget.id,
        entityLabel: `${payTaxTarget.taxType} · ${updated.ntpnNumber}`,
        summary: `Setor pajak ${payTaxTarget.taxType} sebesar ${formatRp(payTaxTarget.taxAmount)} (NTPN: ${updated.ntpnNumber})`,
        beforeData: payTaxTarget as unknown as Record<string, unknown>,
        afterData: updated as unknown as Record<string, unknown>,
        year: payTaxTarget.year,
      });

      setPayTaxTarget(null);
      setFeedback({ type: 'success', message: `Pembayaran pajak NTPN ${updated.ntpnNumber} diposting.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal bayar pajak: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (mode === 'ASSETS') {
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <span className="text-xs text-slate-500 font-medium">Total Nilai Perolehan Aset</span>
            <p className="mt-1.5 text-lg font-bold text-slate-900 font-mono tabular-nums">
              {formatRp(assetTotals.cost)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <span className="text-xs text-slate-500 font-medium">Akumulasi Penyusutan</span>
            <p className="mt-1.5 text-lg font-bold text-amber-800 font-mono tabular-nums">
              {formatRp(assetTotals.accumDep)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <span className="text-xs text-slate-500 font-medium">Nilai Buku Bersih (Net Book Value)</span>
            <p className="mt-1.5 text-lg font-bold text-emerald-800 font-mono tabular-nums">
              {formatRp(assetTotals.bookVal)}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <Building2 className="w-4 h-4 text-emerald-700" />
            <span>Daftar Aset Tetap & Penyusutan ({filteredAssets.length} aset)</span>
          </div>
          {permissions.canOperate && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={handleRunMonthlyDepreciation}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>Hitung & Posting Penyusutan Bulanan</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingAsset(null);
                  setAssetCode(`AST-${activeYear}-${String(assets.length + 1).padStart(3, '0')}`);
                  setAssetName('');
                  setAssetCat(FINANCE_ASSET_CATEGORIES[0]);
                  setAssetUnitId(units[0]?.id || '');
                  setAssetDate(getTodayIso());
                  setAssetCost('');
                  setAssetLifeMonths('60');
                  setAssetSalvage('0');
                  setAssetAccumDep('0');
                  setAssetStatus('Aktif');
                  setAssetRkaId('');
                  setIsAssetModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Registrasi Aset</span>
              </button>
            </div>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Kode & Nama Aset</th>
                  <th className="py-2.5 px-3">Kategori & Lokasi Unit</th>
                  <th className="py-2.5 px-3 text-right">Nilai Perolehan</th>
                  <th className="py-2.5 px-3 text-right">Akum. Penyusutan</th>
                  <th className="py-2.5 px-3 text-right">Nilai Buku</th>
                  <th className="py-2.5 px-3">Status & Mutasi</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Belum ada aset teregistrasi.
                    </td>
                  </tr>
                ) : (
                  filteredAssets.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-bold text-emerald-800">{a.assetCode}</div>
                        <div className="font-semibold text-slate-900">{a.name}</div>
                        <div className="text-[11px] text-slate-500">
                          Perolehan: {formatDateShort(a.acquisitionDate)} · Umur {a.usefulLifeMonths} bln
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-800">{a.category}</div>
                        <div className="text-[11px] text-slate-500">{a.unitName}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatRp(a.acquisitionCost)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-800">
                        {formatRp(a.accumulatedDepreciation)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatRp(a.bookValue)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md">
                          {a.status}
                        </span>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {(a.mutations || []).length} riwayat mutasi
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {permissions.canOperate && (
                            <button
                              type="button"
                              onClick={() => {
                                setMutateAsset(a);
                                setMutDate(getTodayIso());
                                setMutToUnitId(a.unitId);
                                setMutCondition('Baik');
                                setMutNotes('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              <span>Mutasi</span>
                            </button>
                          )}
                          {permissions.isSuperUser && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAsset(a);
                                  setAssetCode(a.assetCode);
                                  setAssetName(a.name);
                                  setAssetCat(a.category);
                                  setAssetUnitId(a.unitId || '');
                                  setAssetDate(a.acquisitionDate);
                                  setAssetCost(String(a.acquisitionCost));
                                  setAssetLifeMonths(String(a.usefulLifeMonths));
                                  setAssetSalvage(String(a.salvageValue || 0));
                                  setAssetAccumDep(String(a.accumulatedDepreciation || 0));
                                  setAssetStatus(a.status);
                                  setAssetRkaId(a.rkaId || '');
                                  setIsAssetModalOpen(true);
                                }}
                                className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded cursor-pointer"
                                title="Edit Aset (Super User)"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget({ kind: 'ASSET', item: a })}
                                className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded cursor-pointer"
                                title="Hapus Aset (Super User)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
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

        {/* Modal Registrasi Aset */}
        {isAssetModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  {editingAsset ? `Edit Aset — ${editingAsset.assetCode}` : 'Registrasi Aset Tetap Baru'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setIsAssetModalOpen(false);
                    setEditingAsset(null);
                  }}
                  className="cursor-pointer"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Kode Aset *</label>
                  <input
                    type="text"
                    value={assetCode}
                    onChange={(e) => setAssetCode(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Tanggal Perolehan</label>
                  <input
                    type="date"
                    value={assetDate}
                    onChange={(e) => setAssetDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Nama Aset *</label>
                <input
                  type="text"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Kategori Aset</label>
                  <select
                    value={assetCat}
                    onChange={(e) => setAssetCat(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {FINANCE_ASSET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Unit Lokasi</label>
                  <select
                    value={assetUnitId}
                    onChange={(e) => setAssetUnitId(e.target.value)}
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
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Nilai Perolehan (Rp) *</label>
                  <input
                    type="number"
                    value={assetCost}
                    onChange={(e) => setAssetCost(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Umur Manfaat (Bln)</label>
                  <input
                    type="number"
                    value={assetLifeMonths}
                    onChange={(e) => setAssetLifeMonths(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Nilai Sisa / Residu</label>
                  <input
                    type="number"
                    value={assetSalvage}
                    onChange={(e) => setAssetSalvage(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Sumber Anggaran RKA (Opsional)</label>
                <select
                  value={assetRkaId}
                  onChange={(e) => setAssetRkaId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="">-- Tanpa Referensi RKA --</option>
                  {rkaItems.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} - {r.programName}
                    </option>
                  ))}
                </select>
              </div>
              {editingAsset && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold mb-1">Akumulasi Penyusutan (Rp)</label>
                    <input
                      type="number"
                      value={assetAccumDep}
                      onChange={(e) => setAssetAccumDep(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold mb-1">Status Aset</label>
                    <select
                      value={assetStatus}
                      onChange={(e) => setAssetStatus(e.target.value as FinanceAsset['status'])}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    >
                      <option value="Aktif">Aktif</option>
                      <option value="Dalam Perbaikan">Dalam Perbaikan</option>
                      <option value="Dihapusbukukan">Dihapusbukukan</option>
                    </select>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAssetModalOpen(false);
                    setEditingAsset(null);
                  }}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSaveAsset}
                  className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
                >
                  {editingAsset ? 'Simpan Perubahan Aset' : 'Simpan Aset'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Mutasi Aset */}
        {mutateAsset && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3.5 text-xs shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  Mutasi Aset — {mutateAsset.assetCode}
                </h3>
                <button type="button" onClick={() => setMutateAsset(null)} className="cursor-pointer">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Tanggal Mutasi</label>
                  <input
                    type="date"
                    value={mutDate}
                    onChange={(e) => setMutDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Kondisi Fisik</label>
                  <select
                    value={mutCondition}
                    onChange={(e) =>
                      setMutCondition(e.target.value as 'Baik' | 'Perlu Perbaikan' | 'Rusak Berat')
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Baik">Baik</option>
                    <option value="Perlu Perbaikan">Perlu Perbaikan</option>
                    <option value="Rusak Berat">Rusak Berat</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold mb-1">Pindah ke Unit Lokasi</label>
                <select
                  value={mutToUnitId}
                  onChange={(e) => setMutToUnitId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Catatan Mutasi</label>
                <input
                  type="text"
                  value={mutNotes}
                  onChange={(e) => setMutNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMutateAsset(null)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSaveAssetMutation}
                  className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
                >
                  Simpan Mutasi
                </button>
              </div>
            </div>
          </div>
        )}
        <FinanceDeleteConfirmModal
          isOpen={Boolean(deleteTarget)}
          title="Hapus Data Aset Tetap"
          itemLabel={
            deleteTarget?.kind === 'ASSET'
              ? `${deleteTarget.item.assetCode} - ${deleteTarget.item.name}`
              : ''
          }
          description="Data registrasi aset dan seluruh riwayat mutasinya akan dihapus permanen."
          submitting={submitting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      </div>
    );
  }

  // TAXES MODE (H. PAJAK)
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

      {/* Tax Recap Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <span className="text-xs text-slate-500 font-medium">Total Pajak Terutang</span>
          <p className="mt-1.5 text-lg font-bold text-rose-700 font-mono tabular-nums">
            {formatRp(
              filteredTaxes
                .filter((t) => t.status === 'Terutang')
                .reduce((s, t) => s + (t.taxAmount || 0), 0)
            )}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <span className="text-xs text-slate-500 font-medium">Total Pajak Disetor / Dibayar</span>
          <p className="mt-1.5 text-lg font-bold text-emerald-800 font-mono tabular-nums">
            {formatRp(
              filteredTaxes
                .filter((t) => t.status !== 'Terutang')
                .reduce((s, t) => s + (t.taxAmount || 0), 0)
            )}
          </p>
        </div>
        {taxSummaryByType.slice(0, 2).map(([tt, info]) => (
          <div key={tt} className="bg-white border border-slate-200 rounded-xl p-4">
            <span className="text-xs text-slate-500 font-medium">Rekap {tt}</span>
            <p className="mt-1.5 text-sm font-bold text-slate-900 font-mono tabular-nums">
              Terutang: {formatRp(info.owed)}
            </p>
            <p className="text-[11px] text-emerald-700 font-mono">
              Dibayar: {formatRp(info.paid)}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Receipt className="w-4 h-4 text-emerald-700" />
          <span>Pencatatan Pajak, Bukti Potong & NTPN ({filteredTaxes.length} catatan)</span>
        </div>
        {permissions.canOperate && (
          <button
            type="button"
            onClick={() => {
              setEditingTax(null);
              setTaxType('PPN');
              setWithholdingNo(`BP-${activeYear}-${String(taxes.length + 1).padStart(3, '0')}`);
              setTaxObject('');
              setTaxBase('');
              setTaxRate('11');
              setTaxDueDate(getTodayIso());
              setTaxUnitId(units[0]?.id || '');
              setTaxStatusEdit('Terutang');
              setTaxNtpnEdit('');
              setTaxPayDateEdit('');
              setIsTaxModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Catat Pajak / Bukti Potong</span>
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 px-3">Jenis & Bukti Potong</th>
                <th className="py-2.5 px-3">Objek Pajak</th>
                <th className="py-2.5 px-3 text-right">DPP (Dasar)</th>
                <th className="py-2.5 px-3 text-right">Tarif</th>
                <th className="py-2.5 px-3 text-right">Nilai Pajak</th>
                <th className="py-2.5 px-3">Jatuh Tempo & NTPN</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTaxes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    Belum ada pencatatan pajak.
                  </td>
                </tr>
              ) : (
                filteredTaxes.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900">{t.taxType}</div>
                      <div className="text-[11px] font-mono text-slate-500">{t.withholdingNumber}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900">{t.taxObject}</div>
                      <div className="text-[11px] text-slate-500">{t.unitName || 'Kantor Pusat'}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatRp(t.taxBaseAmount)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">{t.taxRatePct}%</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatRp(t.taxAmount)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-mono">{formatDateShort(t.dueDate)}</div>
                      {t.ntpnNumber && (
                        <div className="text-[11px] font-mono text-emerald-700">NTPN: {t.ntpnNumber}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border ${
                          t.status === 'Terutang'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        }`}
                      >
                        {t.status !== 'Terutang' && <CheckCircle2 className="w-3 h-3" />}
                        {t.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {permissions.canOperate && t.status === 'Terutang' && (
                          <button
                            type="button"
                            onClick={() => {
                              setPayTaxTarget(t);
                              setTaxPayDate(getTodayIso());
                              setNtpnNo('');
                              setTaxCashBankId(cashBankAccounts[0]?.id || '');
                            }}
                            className="px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md cursor-pointer"
                          >
                            Setor Pajak
                          </button>
                        )}
                        {permissions.isSuperUser && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTax(t);
                                setTaxType(t.taxType);
                                setWithholdingNo(t.withholdingNumber);
                                setTaxObject(t.taxObject);
                                setTaxBase(String(t.taxBaseAmount));
                                setTaxRate(String(t.taxRatePct));
                                setTaxDueDate(t.dueDate);
                                setTaxUnitId(t.unitId || '');
                                setTaxStatusEdit(t.status);
                                setTaxNtpnEdit(t.ntpnNumber || '');
                                setTaxPayDateEdit(t.paymentDate || '');
                                setIsTaxModalOpen(true);
                              }}
                              className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded cursor-pointer"
                              title="Edit Pajak (Super User)"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget({ kind: 'TAX', item: t })}
                              className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded cursor-pointer"
                              title="Hapus Pajak (Super User)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
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

      {/* Modal Catat / Edit Pajak */}
      {isTaxModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {editingTax
                  ? `Edit Pajak — ${editingTax.withholdingNumber}`
                  : 'Catat Kewajiban & Bukti Potong Pajak'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsTaxModalOpen(false);
                  setEditingTax(null);
                }}
                className="cursor-pointer"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Jenis Pajak *</label>
                <select
                  value={taxType}
                  onChange={(e) => setTaxType(e.target.value as FinanceTaxType)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {FINANCE_TAX_TYPES.map((tt) => (
                    <option key={tt} value={tt}>
                      {tt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">No. Bukti Potong / SSP *</label>
                <input
                  type="text"
                  value={withholdingNo}
                  onChange={(e) => setWithholdingNo(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Objek Pajak / Uraian *</label>
              <input
                type="text"
                value={taxObject}
                onChange={(e) => setTaxObject(e.target.value)}
                placeholder="Contoh: PPN Pengadaan Bahan Kimia Tawas / PPh 23 Jasa Pemeliharaan"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold mb-1">Dasar Pengenaan (DPP)</label>
                <input
                  type="number"
                  value={taxBase}
                  onChange={(e) => setTaxBase(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Tarif (%)</label>
                <input
                  type="number"
                  step="0.1"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Jatuh Tempo Setor</label>
                <input
                  type="date"
                  value={taxDueDate}
                  onChange={(e) => setTaxDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            {editingTax && (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Status Pajak</label>
                  <select
                    value={taxStatusEdit}
                    onChange={(e) => setTaxStatusEdit(e.target.value as FinanceTaxRecord['status'])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Terutang">Terutang</option>
                    <option value="Dibayar">Dibayar</option>
                    <option value="Dilaporkan">Dilaporkan</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Tanggal Setor</label>
                  <input
                    type="date"
                    value={taxPayDateEdit}
                    onChange={(e) => setTaxPayDateEdit(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Nomor NTPN</label>
                  <input
                    type="text"
                    value={taxNtpnEdit}
                    onChange={(e) => setTaxNtpnEdit(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>
            )}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex justify-between font-bold">
              <span>Nilai Pajak Terutang:</span>
              <span className="font-mono text-emerald-800">
                {formatRp(Math.round(((Number(taxBase) || 0) * (Number(taxRate) || 0)) / 100))}
              </span>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsTaxModalOpen(false);
                  setEditingTax(null);
                }}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveTax}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                {editingTax ? 'Simpan Perubahan Pajak' : 'Simpan Pajak'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Setor Pajak */}
      {payTaxTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Setor Pajak {payTaxTarget.taxType}
              </h3>
              <button type="button" onClick={() => setPayTaxTarget(null)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <p className="text-slate-600">
              Nilai Setor: <strong className="font-mono text-slate-900">{formatRp(payTaxTarget.taxAmount)}</strong>.
              Pembayaran akan otomatis dicatat pada BKK Kas/Bank dan Jurnal Akuntansi.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Tanggal Setor</label>
                <input
                  type="date"
                  value={taxPayDate}
                  onChange={(e) => setTaxPayDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nomor NTPN</label>
                <input
                  type="text"
                  value={ntpnNo}
                  onChange={(e) => setNtpnNo(e.target.value)}
                  placeholder="NTPN DJP"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Rekening Kas / Bank Pembayar</label>
              <select
                value={taxCashBankId}
                onChange={(e) => setTaxCashBankId(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              >
                {cashBankAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} - {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayTaxTarget(null)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handlePayTax}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Konfirmasi Setor Pajak
              </button>
            </div>
          </div>
        </div>
      )}
      <FinanceDeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        title="Hapus Catatan Pajak"
        itemLabel={
          deleteTarget?.kind === 'TAX'
            ? `${deleteTarget.item.taxType} · ${deleteTarget.item.withholdingNumber} (${formatRp(deleteTarget.item.taxAmount)})`
            : ''
        }
        description="Catatan pajak ini akan dihapus permanen dari daftar pajak."
        submitting={submitting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
