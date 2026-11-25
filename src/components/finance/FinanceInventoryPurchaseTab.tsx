import React, { useMemo, useState } from 'react';
import {
  Package,
  ShoppingCart,
  Plus,
  Edit3,
  Trash2,
  Download,
  AlertTriangle,
  Database,
  ArrowRight,
  X,
} from 'lucide-react';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import { RKAItem, Unit } from '../../types/audit';
import {
  FinanceGlobalFilter,
  FinanceInventoryItem,
  FinancePurchaseRecord,
} from '../../types/finance';
import {
  FINANCE_INVENTORY_CATEGORIES,
  FINANCE_PURCHASE_CATEGORIES,
  buildOfficialPDAMInventory,
  buildOfficialPDAMPurchases,
} from '../../data/financeStandards';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import {
  formatDateShort,
  formatRp,
  getMonthNameFromDate,
  getTodayIso,
  matchesGlobalFilter,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';
import { FinanceDeleteConfirmModal } from './FinanceDeleteConfirmModal';

interface FinanceInventoryPurchaseTabProps {
  filter: FinanceGlobalFilter;
  inventory: FinanceInventoryItem[];
  purchases: FinancePurchaseRecord[];
  rkaItems: RKAItem[];
  units: Unit[];
  actor: FinanceActor;
  permissions: FinancePermissions;
  onLogAudit: LogFinanceAuditFn;
}

type InvPurView = 'PERSEDIAAN' | 'PEMBELIAN';

export const FinanceInventoryPurchaseTab: React.FC<FinanceInventoryPurchaseTabProps> = ({
  filter,
  inventory,
  purchases,
  rkaItems,
  units,
  actor,
  permissions,
  onLogAudit,
}) => {
  const [subView, setSubView] = useState<InvPurView>('PERSEDIAAN');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // Inventory Modal State
  const [isInvModalOpen, setIsInvModalOpen] = useState(false);
  const [editingInv, setEditingInv] = useState<FinanceInventoryItem | null>(null);
  const [invCoaCode, setInvCoaCode] = useState('15.01.30');
  const [invCode, setInvCode] = useState('');
  const [invName, setInvName] = useState('');
  const [invCat, setInvCat] =
    useState<FinanceInventoryItem['category']>('Bahan Kimia');
  const [invMeasure, setInvMeasure] = useState('Kg / Nilai');
  const [invMonth, setInvMonth] = useState('Januari');
  const [invUnitId, setInvUnitId] = useState('');
  const [invBeginQty, setInvBeginQty] = useState('1');
  const [invInQty, setInvInQty] = useState('0');
  const [invOutQty, setInvOutQty] = useState('0');
  const [invPrevVal, setInvPrevVal] = useState('0');
  const [invEndVal, setInvEndVal] = useState('0');
  const [invMinQty, setInvMinQty] = useState('1');
  const [invNotes, setInvNotes] = useState('');

  // Purchase Modal State
  const [isPurModalOpen, setIsPurModalOpen] = useState(false);
  const [editingPur, setEditingPur] = useState<FinancePurchaseRecord | null>(null);
  const [purNo, setPurNo] = useState('');
  const [purDate, setPurDate] = useState(getTodayIso());
  const [purCat, setPurCat] =
    useState<FinancePurchaseRecord['category']>('Pipa dan Accessoris');
  const [purDesc, setPurDesc] = useState('');
  const [purVendor, setPurVendor] = useState('');
  const [purUnitId, setPurUnitId] = useState('');
  const [purRkaId, setPurRkaId] = useState('');
  const [purReqQty, setPurReqQty] = useState('1');
  const [purRealQty, setPurRealQty] = useState('1');
  const [purMeasure, setPurMeasure] = useState('Order');
  const [purAmount, setPurAmount] = useState('0');
  const [purStatus, setPurStatus] =
    useState<FinancePurchaseRecord['status']>('Selesai');
  const [purNotes, setPurNotes] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'INV'; item: FinanceInventoryItem }
    | { kind: 'PUR'; item: FinancePurchaseRecord }
    | null
  >(null);

  // Inventory Month Roll-Over Modal State
  const [isRolloverOpen, setIsRolloverOpen] = useState(false);
  const [rollSourceMonth, setRollSourceMonth] = useState('Januari');
  const [rollTargetMonth, setRollTargetMonth] = useState('Februari');
  const [rollTargetYear, setRollTargetYear] = useState('2026');

  const activeYear = filter.year !== 0 ? filter.year : new Date().getFullYear();

  const filteredInventory = useMemo(() => {
    return inventory
      .filter((item) =>
        matchesGlobalFilter(
          {
            year: item.year,
            month: item.month,
            unitId: item.unitId,
          },
          filter
        )
      )
      .sort((a, b) => a.coaCode.localeCompare(b.coaCode));
  }, [inventory, filter]);

  const filteredPurchases = useMemo(() => {
    return purchases
      .filter((p) =>
        matchesGlobalFilter(
          {
            year: p.year,
            month: p.month,
            date: p.purchaseDate,
            unitId: p.unitId,
          },
          filter
        )
      )
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
  }, [purchases, filter]);

  const invTotals = useMemo(() => {
    return filteredInventory.reduce(
      (acc, i) => ({
        prevVal: acc.prevVal + (Number(i.prevMonthValue) || 0),
        endVal: acc.endVal + (Number(i.endingValue) || 0),
        chemicalVal:
          acc.chemicalVal + (i.category === 'Bahan Kimia' ? Number(i.endingValue) || 0 : 0),
        deadStockVal:
          acc.deadStockVal +
          (i.coaCode === '15.03.91' || i.category === 'Bahan Instalasi Tidak Bergerak'
            ? Number(i.endingValue) || 0
            : 0),
      }),
      { prevVal: 0, endVal: 0, chemicalVal: 0, deadStockVal: 0 }
    );
  }, [filteredInventory]);

  // Monthly vs YTD Purchase Summary by Category
  const purchaseCategorySummary = useMemo(() => {
    const yearScoped = purchases.filter(
      (p) => (filter.year === 0 || p.year === filter.year) && p.status !== 'Dibatalkan'
    );
    const activeMonthName =
      filter.month !== 'ALL' ? filter.month : 'Januari';

    return FINANCE_PURCHASE_CATEGORIES.map((cat) => {
      const catRows = yearScoped.filter((p) => p.category === cat);
      const monthlyRows = catRows.filter(
        (p) => p.month.toLowerCase() === activeMonthName.toLowerCase()
      );
      return {
        category: cat,
        monthlyReq: monthlyRows.reduce((s, r) => s + (r.requestedQty || 0), 0),
        monthlyReal: monthlyRows.reduce((s, r) => s + (r.realizedQty || 0), 0),
        monthlyAmount: monthlyRows.reduce((s, r) => s + (r.amount || 0), 0),
        ytdReq: catRows.reduce((s, r) => s + (r.requestedQty || 0), 0),
        ytdReal: catRows.reduce((s, r) => s + (r.realizedQty || 0), 0),
        ytdAmount: catRows.reduce((s, r) => s + (r.amount || 0), 0),
      };
    });
  }, [purchases, filter.year, filter.month]);

  const handleSeedInvPur = async () => {
    setSubmitting(true);
    try {
      const invSeed = buildOfficialPDAMInventory(activeYear, 'Januari', actor.displayName);
      const purSeed = buildOfficialPDAMPurchases(activeYear, actor.displayName);
      const batch = writeBatch(db);
      invSeed.forEach((item) => {
        batch.set(doc(db, 'fin_inventory', item.id), sanitizeFirestoreRecord(item), {
          merge: true,
        });
      });
      purSeed.forEach((p) => {
        batch.set(doc(db, 'fin_purchases', p.id), sanitizeFirestoreRecord(p), {
          merge: true,
        });
      });
      await batch.commit();
      await onLogAudit({
        actionType: 'SEED',
        entityType: 'Persediaan & Pembelian PDAM',
        entityId: `seed-invpur-${activeYear}`,
        entityLabel: `Baseline Persediaan & Pembelian Jan ${activeYear}`,
        summary: `Memuat ${invSeed.length} item persediaan & ${purSeed.length} catatan pembelian resmi PDAM Januari ${activeYear}`,
        year: activeYear,
      });
      setFeedback({
        type: 'success',
        message: `Berhasil memuat ${invSeed.length} item persediaan & ${purSeed.length} rekap pembelian resmi PDAM Januari TA ${activeYear}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal memuat baseline: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRolloverInventory = async () => {
    const targetYear = parseInt(rollTargetYear, 10) || activeYear;
    const sourceItems = inventory.filter(
      (i) =>
        (filter.year === 0 || i.year === filter.year) &&
        i.month.toLowerCase() === rollSourceMonth.toLowerCase()
    );
    if (sourceItems.length === 0) {
      setFeedback({
        type: 'error',
        message: `Tidak ditemukan item persediaan pada bulan ${rollSourceMonth}.`,
      });
      return;
    }
    if (
      rollSourceMonth.toLowerCase() === rollTargetMonth.toLowerCase() &&
      targetYear === activeYear
    ) {
      setFeedback({
        type: 'error',
        message: 'Bulan tujuan roll-over harus berbeda dari bulan sumber.',
      });
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const batch = writeBatch(db);
      let createdCount = 0;

      sourceItems.forEach((src) => {
        const coaClean = (src.coaCode || src.itemCode || src.id).replace(/[^a-zA-Z0-9]/g, '');
        const newId = `inv-${targetYear}-${rollTargetMonth.toLowerCase()}-${coaClean}`;
        const nextItem: FinanceInventoryItem = sanitizeFirestoreRecord({
          ...src,
          id: newId,
          year: targetYear,
          month: rollTargetMonth,
          beginningQty: src.endingQty,
          inQty: 0,
          outQty: 0,
          endingQty: src.endingQty,
          prevMonthValue: src.endingValue,
          endingValue: src.endingValue,
          notes: `Saldo awal roll-over dari ${src.month} ${src.year}`,
          updatedBy: actor.displayName,
          updatedAt: now,
          createdAt: now,
        });
        batch.set(doc(db, 'fin_inventory', newId), nextItem, { merge: true });
        createdCount++;
      });

      await batch.commit();
      await onLogAudit({
        actionType: 'CREATE',
        entityType: 'Roll-Over Persediaan Bulanan',
        entityId: `rollover-${targetYear}-${rollTargetMonth.toLowerCase()}`,
        entityLabel: `${rollSourceMonth} -> ${rollTargetMonth} ${targetYear}`,
        summary: `Roll-over ${createdCount} item persediaan dari ${rollSourceMonth} ke ${rollTargetMonth} ${targetYear}`,
        year: targetYear,
      });

      setIsRolloverOpen(false);
      setFeedback({
        type: 'success',
        message: `${createdCount} item persediaan berhasil di-roll-over ke ${rollTargetMonth} ${targetYear} dan siap disesuaikan manual.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal roll-over persediaan: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveInventory = async () => {
    if (!invCoaCode.trim() || !invName.trim()) {
      setFeedback({ type: 'error', message: 'Kode COA dan Nama Persediaan wajib diisi.' });
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = editingInv?.id || `inv-${activeYear}-${Date.now()}`;
      const selectedUnit = units.find((u) => u.id === invUnitId);
      const beg = Number(invBeginQty) || 0;
      const qtyIn = Number(invInQty) || 0;
      const qtyOut = Number(invOutQty) || 0;
      const endQty = Math.max(0, beg + qtyIn - qtyOut);
      const endVal = Number(invEndVal) || 0;
      const unitCost = endQty > 0 ? endVal / endQty : endVal;

      const record: FinanceInventoryItem = sanitizeFirestoreRecord({
        id,
        coaCode: invCoaCode.trim(),
        itemCode: invCode.trim() || `INV-${Date.now().toString().slice(-4)}`,
        name: invName.trim(),
        category: invCat,
        unitMeasure: invMeasure.trim() || 'Unit',
        year: editingInv?.year || activeYear,
        month: invMonth,
        unitId: selectedUnit?.id || '',
        unitName: selectedUnit?.name || 'Gudang Logistik Pusat',
        beginningQty: beg,
        inQty: qtyIn,
        outQty: qtyOut,
        endingQty: endQty,
        unitCost,
        prevMonthValue: Number(invPrevVal) || 0,
        endingValue: endVal,
        minStockQty: Number(invMinQty) || 0,
        notes: invNotes.trim() || undefined,
        updatedBy: actor.displayName,
        updatedAt: now,
        createdAt: editingInv?.createdAt || now,
      });

      await setDoc(doc(db, 'fin_inventory', id), record);
      await onLogAudit({
        actionType: editingInv ? 'UPDATE' : 'CREATE',
        entityType: 'Persediaan Gudang & Kimia',
        entityId: id,
        entityLabel: `${record.coaCode} - ${record.name}`,
        summary: `${editingInv ? 'Pembaruan' : 'Penambahan'} persediaan ${record.name} (Saldo Akhir: ${formatRp(record.endingValue)})`,
        beforeData: editingInv ? (editingInv as unknown as Record<string, unknown>) : null,
        afterData: record as unknown as Record<string, unknown>,
        year: record.year,
      });
      setIsInvModalOpen(false);
      setEditingInv(null);
      setFeedback({ type: 'success', message: `Data persediaan ${record.name} disimpan.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan persediaan: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePurchase = async () => {
    if (!purDesc.trim()) {
      setFeedback({ type: 'error', message: 'Uraian pembelian barang/jasa wajib diisi.' });
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = editingPur?.id || `pur-${Date.now()}`;
      const year = parseInt(purDate.slice(0, 4), 10) || activeYear;
      const month = getMonthNameFromDate(purDate);
      const selectedUnit = units.find((u) => u.id === purUnitId);
      const selectedRka = rkaItems.find((r) => r.id === purRkaId);

      const record: FinancePurchaseRecord = sanitizeFirestoreRecord({
        id,
        purchaseNumber:
          purNo.trim() || `PO-${year}-${Date.now().toString().slice(-4)}`,
        purchaseDate: purDate,
        year,
        month,
        category: purCat,
        itemDescription: purDesc.trim(),
        vendorName: purVendor.trim() || 'Rekanan Pengadaan',
        unitId: selectedUnit?.id || '',
        unitName: selectedUnit?.name || 'Bidang Teknik & Gudang',
        rkaId: selectedRka?.id,
        rkaCode: selectedRka?.code,
        requestedQty: Number(purReqQty) || 0,
        realizedQty: Number(purRealQty) || 0,
        unitMeasure: purMeasure.trim() || 'Order',
        amount: Math.round(Number(purAmount) || 0),
        status: purStatus,
        notes: purNotes.trim() || undefined,
        createdBy: editingPur?.createdBy || actor.displayName,
        createdAt: editingPur?.createdAt || now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_purchases', id), record);
      await onLogAudit({
        actionType: editingPur ? 'UPDATE' : 'CREATE',
        entityType: 'Pembelian Barang & Persediaan',
        entityId: id,
        entityLabel: record.purchaseNumber,
        summary: `${editingPur ? 'Pembaruan' : 'Pencatatan'} pembelian ${record.purchaseNumber} (${record.category}) senilai ${formatRp(record.amount)}`,
        beforeData: editingPur ? (editingPur as unknown as Record<string, unknown>) : null,
        afterData: record as unknown as Record<string, unknown>,
        year,
      });
      setIsPurModalOpen(false);
      setEditingPur(null);
      setFeedback({ type: 'success', message: `Pembelian ${record.purchaseNumber} disimpan.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan pembelian: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || !permissions.isSuperUser) return;
    setSubmitting(true);
    try {
      if (deleteTarget.kind === 'INV') {
        const item = deleteTarget.item;
        await deleteDoc(doc(db, 'fin_inventory', item.id));
        await onLogAudit({
          actionType: 'DELETE',
          entityType: 'Persediaan Gudang & Kimia',
          entityId: item.id,
          entityLabel: `${item.coaCode} - ${item.name}`,
          summary: `Super User menghapus item persediaan ${item.name}`,
          beforeData: item as unknown as Record<string, unknown>,
          afterData: null,
          year: item.year,
        });
        setFeedback({ type: 'success', message: `Item ${item.name} dihapus.` });
      } else {
        const p = deleteTarget.item;
        await deleteDoc(doc(db, 'fin_purchases', p.id));
        await onLogAudit({
          actionType: 'DELETE',
          entityType: 'Pembelian Barang & Persediaan',
          entityId: p.id,
          entityLabel: p.purchaseNumber,
          summary: `Super User menghapus catatan pembelian ${p.purchaseNumber}`,
          beforeData: p as unknown as Record<string, unknown>,
          afterData: null,
          year: p.year,
        });
        setFeedback({ type: 'success', message: `Catatan pembelian ${p.purchaseNumber} dihapus.` });
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

  const handleExportExcel = () => {
    const rows =
      subView === 'PERSEDIAAN'
        ? filteredInventory.map((i) => ({
            Kode_COA: i.coaCode,
            Kode_Barang: i.itemCode,
            Nama_Persediaan: i.name,
            Kategori: i.category,
            Unit_Gudang: i.unitName,
            Bulan: i.month,
            Saldo_Awal_Qty: i.beginningQty,
            Masuk_Qty: i.inQty,
            Keluar_Qty: i.outQty,
            Saldo_Akhir_Qty: i.endingQty,
            Nilai_Bulan_Lalu: i.prevMonthValue,
            Nilai_Bulan_Ini: i.endingValue,
            Selisih_Nilai: i.endingValue - i.prevMonthValue,
          }))
        : filteredPurchases.map((p) => ({
            No_PO: p.purchaseNumber,
            Tanggal: p.purchaseDate,
            Bulan: p.month,
            Kategori: p.category,
            Uraian: p.itemDescription,
            Vendor: p.vendorName,
            Kode_RKA: p.rkaCode || '-',
            Diminta: p.requestedQty,
            Realisasi: p.realizedQty,
            Satuan: p.unitMeasure,
            Nilai_Rp: p.amount,
            Status: p.status,
          }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, subView);
    XLSX.writeFile(wb, `${subView}_PDAM_${activeYear}.xlsx`);
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

      {/* Top KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold text-slate-500">Total Nilai Persediaan Akhir</p>
          <p className="mt-1 text-lg font-bold text-slate-900 font-mono tabular-nums">
            {formatRp(invTotals.endVal)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Bulan lalu: {formatRp(invTotals.prevVal)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold text-slate-500">Persediaan Bahan Kimia (15.01.xx)</p>
          <p className="mt-1 text-lg font-bold text-emerald-800 font-mono tabular-nums">
            {formatRp(invTotals.chemicalVal)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Soda Ash, Tawas, Kaporit & PAC</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold text-slate-500">Instalasi Tidak Bergerak (15.03.91)</p>
          <p className="mt-1 text-lg font-bold text-amber-800 font-mono tabular-nums">
            {formatRp(invTotals.deadStockVal)}
          </p>
          <p className="text-[11px] text-amber-700 mt-0.5 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Perlu evaluasi pemanfaatan / dead stock
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[11px] font-semibold text-slate-500">Total Pembelian TA Terfilter</p>
          <p className="mt-1 text-lg font-bold text-teal-800 font-mono tabular-nums">
            {formatRp(purchaseCategorySummary.reduce((s, r) => s + r.ytdAmount, 0))}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {purchaseCategorySummary.reduce((s, r) => s + r.ytdReal, 0)} order terealisasi YTD
          </p>
        </div>
      </div>

      {/* Sub-navigation & Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSubView('PERSEDIAAN')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
              subView === 'PERSEDIAAN'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Persediaan Kimia & Instalasi (15.xx)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubView('PEMBELIAN')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
              subView === 'PEMBELIAN'
                ? 'bg-emerald-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShoppingCart className="w-3.5 h-3.5" />
            <span>Laporan & Realisasi Pembelian</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Excel</span>
          </button>

          {permissions.canOperate && (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSeedInvPur}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                <span>Muat Baseline PDAM (Jan {activeYear})</span>
              </button>

              {subView === 'PERSEDIAAN' && (
                <button
                  type="button"
                  onClick={() => {
                    const months = FISCAL_MONTHS as readonly string[];
                    const src = filter.month !== 'ALL' ? filter.month : 'Januari';
                    const idx = months.indexOf(src);
                    setRollSourceMonth(src);
                    setRollTargetMonth(idx >= 0 && idx < 11 ? months[idx + 1] : 'Februari');
                    setRollTargetYear(String(idx === 11 ? activeYear + 1 : activeYear));
                    setIsRolloverOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg cursor-pointer"
                >
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Roll-Over ke Bulan Berikutnya</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (subView === 'PERSEDIAAN') {
                    setEditingInv(null);
                    setInvCoaCode('15.01.30');
                    setInvCode(`KIM-${String(inventory.length + 1).padStart(2, '0')}`);
                    setInvName('');
                    setInvCat('Bahan Kimia');
                    setInvMeasure('Kg / Nilai');
                    setInvMonth(filter.month !== 'ALL' ? filter.month : 'Januari');
                    setInvUnitId('');
                    setInvBeginQty('1');
                    setInvInQty('0');
                    setInvOutQty('0');
                    setInvPrevVal('0');
                    setInvEndVal('0');
                    setInvMinQty('1');
                    setInvNotes('');
                    setIsInvModalOpen(true);
                  } else {
                    setEditingPur(null);
                    setPurNo(`PO-${activeYear}-${String(purchases.length + 1).padStart(3, '0')}`);
                    setPurDate(getTodayIso());
                    setPurCat('Pipa dan Accessoris');
                    setPurDesc('');
                    setPurVendor('');
                    setPurUnitId('');
                    setPurRkaId('');
                    setPurReqQty('1');
                    setPurRealQty('1');
                    setPurMeasure('Order');
                    setPurAmount('0');
                    setPurStatus('Selesai');
                    setPurNotes('');
                    setIsPurModalOpen(true);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{subView === 'PERSEDIAAN' ? 'Tambah Persediaan' : 'Catat Pembelian'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* PERSEDIAAN TABLE */}
      {subView === 'PERSEDIAAN' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">COA & Kode</th>
                  <th className="py-2.5 px-3">Nama Persediaan & Gudang</th>
                  <th className="py-2.5 px-3">Kategori</th>
                  <th className="py-2.5 px-3 text-right">Mutasi Qty (Masuk/Keluar)</th>
                  <th className="py-2.5 px-3 text-right">Nilai Bulan Lalu</th>
                  <th className="py-2.5 px-3 text-right">Nilai Bulan Ini</th>
                  <th className="py-2.5 px-3 text-right">Naik / (Turun)</th>
                  {(permissions.canOperate || permissions.isSuperUser) && (
                    <th className="py-2.5 px-3 text-right">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      Belum ada data persediaan. Klik "Muat Baseline PDAM" atau "Tambah Persediaan".
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map((item) => {
                    const diff = item.endingValue - item.prevMonthValue;
                    const isDeadStock =
                      item.coaCode === '15.03.91' ||
                      item.category === 'Bahan Instalasi Tidak Bergerak';
                    const isLowStock = item.endingQty < item.minStockQty;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 font-mono">
                          <div className="font-bold text-emerald-800">{item.coaCode}</div>
                          <div className="text-[11px] text-slate-500">{item.itemCode}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <span>{item.name}</span>
                            {isDeadStock && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded">
                                Dead Stock
                              </span>
                            )}
                            {isLowStock && (
                              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-50 text-rose-800 border border-rose-200 rounded">
                                Stok Menipis
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {item.unitName} · {item.month} {item.year}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">{item.category}</td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          <div className="font-bold text-slate-900">
                            Akhir: {item.endingQty} {item.unitMeasure}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            +{item.inQty} / -{item.outQty}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {formatRp(item.prevMonthValue)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                          {formatRp(item.endingValue)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                            diff >= 0 ? 'text-emerald-700' : 'text-rose-700'
                          }`}
                        >
                          {formatRp(diff)}
                        </td>
                        {(permissions.canOperate || permissions.isSuperUser) && (
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingInv(item);
                                  setInvCoaCode(item.coaCode);
                                  setInvCode(item.itemCode);
                                  setInvName(item.name);
                                  setInvCat(item.category);
                                  setInvMeasure(item.unitMeasure);
                                  setInvMonth(item.month);
                                  setInvUnitId(item.unitId);
                                  setInvBeginQty(String(item.beginningQty));
                                  setInvInQty(String(item.inQty));
                                  setInvOutQty(String(item.outQty));
                                  setInvPrevVal(String(item.prevMonthValue));
                                  setInvEndVal(String(item.endingValue));
                                  setInvMinQty(String(item.minStockQty));
                                  setInvNotes(item.notes || '');
                                  setIsInvModalOpen(true);
                                }}
                                className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded cursor-pointer"
                                title="Edit Persediaan"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {permissions.isSuperUser && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget({ kind: 'INV', item })}
                                  className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded cursor-pointer"
                                  title="Hapus Persediaan (Super User)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
              {filteredInventory.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50 border-t-2 border-slate-200 font-bold text-slate-900">
                    <td colSpan={4} className="py-2.5 px-3">
                      TOTAL NILAI PERSEDIAAN
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatRp(invTotals.prevVal)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-800">
                      {formatRp(invTotals.endVal)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {formatRp(invTotals.endVal - invTotals.prevVal)}
                    </td>
                    {(permissions.canOperate || permissions.isSuperUser) && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* PEMBELIAN VIEW: Monthly vs YTD Matrix + Detailed List */}
      {subView === 'PEMBELIAN' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-900">
              Rekapitulasi Pembelian Menurut Kategori (Bulan {filter.month !== 'ALL' ? filter.month : 'Januari'} vs s/d Bulan Ini)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600">
                    <th className="py-2 px-3">Jenis / Kategori Pembelian</th>
                    <th className="py-2 px-3 text-right">Order Bulan Ini</th>
                    <th className="py-2 px-3 text-right">Realisasi Bulan Ini</th>
                    <th className="py-2 px-3 text-right">Nilai Bulan Ini (Rp)</th>
                    <th className="py-2 px-3 text-right">Order s/d Bulan Ini</th>
                    <th className="py-2 px-3 text-right">Realisasi s/d Bulan Ini</th>
                    <th className="py-2 px-3 text-right">Nilai s/d Bulan Ini (Rp)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseCategorySummary.map((row) => (
                    <tr key={row.category} className="hover:bg-slate-50/80">
                      <td className="py-2 px-3 font-semibold text-slate-900">{row.category}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.monthlyReq}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.monthlyReal}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {formatRp(row.monthlyAmount)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{row.ytdReq}</td>
                      <td className="py-2 px-3 text-right font-mono">{row.ytdReal}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-800">
                        {formatRp(row.ytdAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                    <th className="py-2.5 px-3">No. PO & Tanggal</th>
                    <th className="py-2.5 px-3">Kategori & Uraian Pengadaan</th>
                    <th className="py-2.5 px-3">Vendor / Rekanan</th>
                    <th className="py-2.5 px-3">RKA Terkait</th>
                    <th className="py-2.5 px-3 text-right">Diminta / Realisasi</th>
                    <th className="py-2.5 px-3 text-right">Nilai Pembelian</th>
                    <th className="py-2.5 px-3">Status</th>
                    {(permissions.canOperate || permissions.isSuperUser) && (
                      <th className="py-2.5 px-3 text-right">Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-500">
                        Belum ada catatan pembelian pada filter terpilih.
                      </td>
                    </tr>
                  ) : (
                    filteredPurchases.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/80">
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                          <div className="font-bold text-slate-900">{p.purchaseNumber}</div>
                          <div className="text-[11px] text-slate-500">
                            {formatDateShort(p.purchaseDate)}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{p.itemDescription}</div>
                          <div className="text-[11px] text-slate-500">{p.category}</div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700">{p.vendorName}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-teal-800">
                          {p.rkaCode || '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">
                          {p.requestedQty} / <strong>{p.realizedQty}</strong> {p.unitMeasure}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                          {formatRp(p.amount)}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded border text-[11px] font-semibold bg-emerald-50 text-emerald-800 border-emerald-200">
                            {p.status}
                          </span>
                        </td>
                        {(permissions.canOperate || permissions.isSuperUser) && (
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPur(p);
                                  setPurNo(p.purchaseNumber);
                                  setPurDate(p.purchaseDate);
                                  setPurCat(p.category);
                                  setPurDesc(p.itemDescription);
                                  setPurVendor(p.vendorName);
                                  setPurUnitId(p.unitId);
                                  setPurRkaId(p.rkaId || '');
                                  setPurReqQty(String(p.requestedQty));
                                  setPurRealQty(String(p.realizedQty));
                                  setPurMeasure(p.unitMeasure);
                                  setPurAmount(String(p.amount));
                                  setPurStatus(p.status);
                                  setPurNotes(p.notes || '');
                                  setIsPurModalOpen(true);
                                }}
                                className="p-1.5 text-slate-600 hover:text-emerald-800 hover:bg-emerald-50 rounded cursor-pointer"
                                title="Edit Pembelian"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {permissions.isSuperUser && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget({ kind: 'PUR', item: p })}
                                  className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded cursor-pointer"
                                  title="Hapus Pembelian (Super User)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
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
        </div>
      )}

      {/* Modal Persediaan */}
      {isInvModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3 text-xs shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {editingInv ? `Edit Persediaan — ${editingInv.name}` : 'Tambah Item Persediaan'}
              </h3>
              <button type="button" onClick={() => setIsInvModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Kode COA Persediaan *</label>
                <input
                  type="text"
                  value={invCoaCode}
                  onChange={(e) => setInvCoaCode(e.target.value)}
                  placeholder="15.01.30"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Kode Barang</label>
                <input
                  type="text"
                  value={invCode}
                  onChange={(e) => setInvCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Nama Bahan / Barang *</label>
              <input
                type="text"
                value={invName}
                onChange={(e) => setInvName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block font-semibold mb-1">Kategori</label>
                <select
                  value={invCat}
                  onChange={(e) => setInvCat(e.target.value as FinanceInventoryItem['category'])}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg"
                >
                  {FINANCE_INVENTORY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Bulan</label>
                <select
                  value={invMonth}
                  onChange={(e) => setInvMonth(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg"
                >
                  {FISCAL_MONTHS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Satuan</label>
                <input
                  type="text"
                  value={invMeasure}
                  onChange={(e) => setInvMeasure(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="block font-semibold mb-1">Qty Awal</label>
                <input
                  type="number"
                  value={invBeginQty}
                  onChange={(e) => setInvBeginQty(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Qty Masuk</label>
                <input
                  type="number"
                  value={invInQty}
                  onChange={(e) => setInvInQty(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Qty Keluar</label>
                <input
                  type="number"
                  value={invOutQty}
                  onChange={(e) => setInvOutQty(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Min Stok</label>
                <input
                  type="number"
                  value={invMinQty}
                  onChange={(e) => setInvMinQty(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Nilai Bulan Lalu (Rp)</label>
                <input
                  type="number"
                  value={invPrevVal}
                  onChange={(e) => setInvPrevVal(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nilai Bulan Ini / Akhir (Rp)</label>
                <input
                  type="number"
                  value={invEndVal}
                  onChange={(e) => setInvEndVal(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Catatan</label>
              <input
                type="text"
                value={invNotes}
                onChange={(e) => setInvNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsInvModalOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveInventory}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Simpan Persediaan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Pembelian */}
      {isPurModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3 text-xs shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {editingPur ? `Edit Pembelian — ${editingPur.purchaseNumber}` : 'Catat Pembelian Barang'}
              </h3>
              <button type="button" onClick={() => setIsPurModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Nomor PO / Order</label>
                <input
                  type="text"
                  value={purNo}
                  onChange={(e) => setPurNo(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Tanggal Pembelian</label>
                <input
                  type="date"
                  value={purDate}
                  onChange={(e) => setPurDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Kategori Pembelian</label>
                <select
                  value={purCat}
                  onChange={(e) => setPurCat(e.target.value as FinancePurchaseRecord['category'])}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  {FINANCE_PURCHASE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Pos RKA Terkait</label>
                <select
                  value={purRkaId}
                  onChange={(e) => setPurRkaId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="">-- Tanpa RKA --</option>
                  {rkaItems.map((r) => (
                    <option key={r.id} value={r.id}>{r.code} - {r.programName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Uraian Barang / Jasa *</label>
              <input
                type="text"
                value={purDesc}
                onChange={(e) => setPurDesc(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Vendor / Rekanan</label>
                <input
                  type="text"
                  value={purVendor}
                  onChange={(e) => setPurVendor(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Status</label>
                <select
                  value={purStatus}
                  onChange={(e) => setPurStatus(e.target.value as FinancePurchaseRecord['status'])}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="Permintaan">Permintaan</option>
                  <option value="Realisasi">Realisasi</option>
                  <option value="Selesai">Selesai</option>
                  <option value="Dibatalkan">Dibatalkan</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="block font-semibold mb-1">Jml Minta</label>
                <input
                  type="number"
                  value={purReqQty}
                  onChange={(e) => setPurReqQty(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Realisasi</label>
                <input
                  type="number"
                  value={purRealQty}
                  onChange={(e) => setPurRealQty(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Satuan</label>
                <input
                  type="text"
                  value={purMeasure}
                  onChange={(e) => setPurMeasure(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nilai (Rp)</label>
                <input
                  type="number"
                  value={purAmount}
                  onChange={(e) => setPurAmount(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono font-bold"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Catatan</label>
              <input
                type="text"
                value={purNotes}
                onChange={(e) => setPurNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPurModalOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSavePurchase}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Simpan Pembelian
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Roll-Over Persediaan ke Bulan Berikutnya */}
      {isRolloverOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Roll-Over Saldo Persediaan ke Bulan Berikutnya
              </h3>
              <button type="button" onClick={() => setIsRolloverOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <p className="text-slate-600 leading-relaxed">
              Saldo akhir (kuantitas &amp; rupiah) seluruh item persediaan pada bulan sumber akan disalin menjadi <strong>Nilai Bulan Lalu / Qty Awal</strong> pada bulan tujuan.
            </p>
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block font-semibold mb-1">Dari Bulan</label>
                <select
                  value={rollSourceMonth}
                  onChange={(e) => setRollSourceMonth(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg"
                >
                  {FISCAL_MONTHS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Ke Bulan</label>
                <select
                  value={rollTargetMonth}
                  onChange={(e) => setRollTargetMonth(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg"
                >
                  {FISCAL_MONTHS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Tahun</label>
                <input
                  type="number"
                  value={rollTargetYear}
                  onChange={(e) => setRollTargetYear(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsRolloverOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleRolloverInventory}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Proses Roll-Over
              </button>
            </div>
          </div>
        </div>
      )}

      <FinanceDeleteConfirmModal
        isOpen={Boolean(deleteTarget)}
        title={deleteTarget?.kind === 'INV' ? 'Hapus Item Persediaan' : 'Hapus Catatan Pembelian'}
        itemLabel={
          deleteTarget?.kind === 'INV'
            ? `${deleteTarget.item.coaCode} - ${deleteTarget.item.name}`
            : deleteTarget?.kind === 'PUR'
            ? `${deleteTarget.item.purchaseNumber} (${formatRp(deleteTarget.item.amount)})`
            : ''
        }
        description="Penghapusan permanen akan dicatat pada jejak Audit Trail Keuangan."
        submitting={submitting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
