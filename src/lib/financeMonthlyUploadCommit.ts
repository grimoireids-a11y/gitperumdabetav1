import * as XLSX from 'xlsx';
import {
  collection,
  deleteDoc,
  doc,
  DocumentReference,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  computeAccountingStatements,
  computeCashBankBalances,
  sanitizeFirestoreRecord,
} from './financeEngine';
import {
  FISCAL_MONTH_NAMES,
  getMonthSlug,
  normalizeParsedFinanceReport,
  toFiniteNumber,
} from './financeUploadNormalizer';
import {
  FinanceAccount,
  FinanceAsset,
  FinanceAuditTrail,
  FinanceCashBankAccount,
  FinanceInventoryItem,
  FinanceMonthlyUploadParsedPayload,
  FinanceMonthlyUploadRecord,
  FinancePdamMonthlySnapshot,
  FinancePurchaseRecord,
  FinanceReceivablePayable,
  FinanceTaxRecord,
  FinanceUploadApplyMode,
} from '../types/finance';
import { buildOfficialPDAMCoaJan2026 } from '../data/pdamOfficialBaselineJan2026';

const BATCH_LIMIT = 400;

export function workbookToPlainText(workbook: XLSX.WorkBook): string {
  const sections: string[] = [];
  workbook.SheetNames.forEach((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim()) {
      sections.push(`=== SHEET: ${name} ===\n${csv}`);
    }
  });
  return sections.join('\n\n');
}

export function tryParseStructuredPdamExcelWorkbook(params: {
  workbook: XLSX.WorkBook;
  targetYear: number;
  targetMonth: string;
  actorName: string;
}): FinanceMonthlyUploadParsedPayload | null {
  const { workbook, targetYear, targetMonth, actorName } = params;
  const sheetNamesUpper = workbook.SheetNames.map((s) => s.trim().toUpperCase());
  const hasTemplateSheet =
    sheetNamesUpper.includes('COA_NERACA_LR') || sheetNamesUpper.includes('KAS_BANK');
  if (!hasTemplateSheet) return null;

  const getRows = (targetUpper: string): Record<string, any>[] => {
    const idx = sheetNamesUpper.indexOf(targetUpper);
    if (idx < 0) return [];
    const sheet = workbook.Sheets[workbook.SheetNames[idx]];
    return sheet ? XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' }) : [];
  };

  const coaRows = getRows('COA_NERACA_LR').map((r) => ({
    code: r.Kode || r.code || '',
    name: r.Nama_Akun || r.name || '',
    type: r.Tipe || r.type || 'Beban',
    subCategory: r.Sub_Kategori || r.subCategory || '',
    normalBalance: r.Saldo_Normal || r.normalBalance || '',
    cashFlowGroup: r.Grup_Arus_Kas || r.cashFlowGroup || '',
    openingBalance: toFiniteNumber(r.Saldo_Akhir_Bulan_Ini ?? r.openingBalance, 0),
    prevMonthBalance: toFiniteNumber(r.Saldo_Bulan_Lalu ?? r.prevMonthBalance, 0),
    monthlyRealization: toFiniteNumber(r.Realisasi_Bulan_Ini ?? r.monthlyRealization, 0),
    ytdRealization: toFiniteNumber(r.Realisasi_SD_Bulan_Ini ?? r.ytdRealization, 0),
    budgetMonthly: toFiniteNumber(r.Anggaran_Bulan_Ini ?? r.budgetMonthly, 0),
    budgetYtd: toFiniteNumber(r.Anggaran_SD_Bulan_Ini ?? r.budgetYtd, 0),
    isContra: String(r.Kontra || r.isContra || '').toLowerCase() === 'ya' || r.isContra === true,
  }));

  const cbRows = getRows('KAS_BANK').map((r) => ({
    code: r.Kode || r.code || '',
    name: r.Nama_Rekening || r.name || '',
    accountKind: r.Jenis || r.accountKind || 'BANK',
    bankName: r.Nama_Bank || r.bankName || '',
    accountNumber: r.No_Rekening || r.accountNumber || '',
    coaCode: r.Kode_COA || r.coaCode || r.Kode || '',
    balance: toFiniteNumber(r.Saldo_Akhir ?? r.balance, 0),
  }));

  const rpRows = getRows('UTANG_PIUTANG').map((r) => ({
    kind: r.Jenis || r.kind || 'PIUTANG',
    documentNumber: r.No_Dokumen || r.documentNumber || '',
    partyName: r.Pihak || r.partyName || '',
    category: r.Kategori || r.category || '',
    coaCode: r.Kode_COA || r.coaCode || '',
    originalAmount: toFiniteNumber(r.Nilai_Awal ?? r.originalAmount, 0),
    paidAmount: toFiniteNumber(r.Dibayar ?? r.paidAmount, 0),
    remainingAmount: toFiniteNumber(r.Sisa_Tagihan ?? r.remainingAmount, 0),
    dueDate: r.Jatuh_Tempo || r.dueDate || '',
  }));

  const assetRows = getRows('ASET').map((r) => ({
    assetCode: r.Kode_Aset || r.assetCode || '',
    name: r.Nama_Aset || r.name || '',
    category: r.Kelompok || r.category || '',
    acquisitionCost: toFiniteNumber(r.Harga_Perolehan ?? r.acquisitionCost, 0),
    accumulatedDepreciation: toFiniteNumber(r.Akumulasi_Penyusutan ?? r.accumulatedDepreciation, 0),
    bookValue: toFiniteNumber(r.Nilai_Buku ?? r.bookValue, 0),
    usefulLifeMonths: toFiniteNumber(r.Umur_Bulan ?? r.usefulLifeMonths, 120),
  }));

  const taxRows = getRows('PAJAK').map((r) => ({
    taxType: r.Jenis_Pajak || r.taxType || 'Lainnya',
    withholdingNumber: r.No_Bukti || r.withholdingNumber || '',
    taxObject: r.Objek_Pajak || r.taxObject || '',
    taxBaseAmount: toFiniteNumber(r.DPP ?? r.taxBaseAmount, 0),
    taxRatePct: toFiniteNumber(r.Tarif_Pct ?? r.taxRatePct, 0),
    taxAmount: toFiniteNumber(r.Nilai_Pajak ?? r.taxAmount, 0),
    status: r.Status || r.status || 'Terutang',
  }));

  const invRows = getRows('PERSEDIAAN').map((r) => ({
    coaCode: r.Kode_COA || r.coaCode || '15.01.20',
    itemCode: r.Kode_Barang || r.itemCode || '',
    name: r.Nama_Persediaan || r.name || '',
    category: r.Kategori || r.category || '',
    unitMeasure: r.Satuan || r.unitMeasure || 'Unit',
    beginningQty: toFiniteNumber(r.Qty_Awal ?? r.beginningQty, 0),
    inQty: toFiniteNumber(r.Qty_Masuk ?? r.inQty, 0),
    outQty: toFiniteNumber(r.Qty_Keluar ?? r.outQty, 0),
    endingQty: toFiniteNumber(r.Qty_Akhir ?? r.endingQty, 0),
    prevMonthValue: toFiniteNumber(r.Nilai_Bulan_Lalu ?? r.prevMonthValue, 0),
    endingValue: toFiniteNumber(r.Nilai_Akhir ?? r.endingValue, 0),
  }));

  const purRows = getRows('PEMBELIAN').map((r) => ({
    purchaseNumber: r.No_PO || r.purchaseNumber || '',
    purchaseDate: r.Tanggal || r.purchaseDate || '',
    category: r.Kategori || r.category || 'Lainnya',
    itemDescription: r.Uraian || r.itemDescription || '',
    vendorName: r.Pemasok || r.vendorName || '',
    requestedQty: toFiniteNumber(r.Qty_Minta ?? r.requestedQty, 1),
    realizedQty: toFiniteNumber(r.Qty_Realisasi ?? r.realizedQty, 1),
    unitMeasure: r.Satuan || r.unitMeasure || 'Paket',
    amount: toFiniteNumber(r.Nilai ?? r.amount, 0),
    status: r.Status || r.status || 'Selesai',
  }));

  const infoRows = getRows('INFO_SURAT');
  const infoMap = new Map<string, string>();
  infoRows.forEach((r) => {
    const k = String(r.Bagian || r.Key || '').trim().toLowerCase();
    const v = String(r.Nilai || r.Value || '').trim();
    if (k) infoMap.set(k, v);
  });

  return normalizeParsedFinanceReport({
    raw: {
      detectedPeriod: {
        year: infoMap.get('tahun') ? toFiniteNumber(infoMap.get('tahun'), targetYear) : targetYear,
        month: infoMap.get('bulan') || targetMonth,
        documentTitle: infoMap.get('judul') || `Laporan Keuangan ${targetMonth} ${targetYear}`,
        letterNumber: infoMap.get('nomor_surat'),
      },
      coaAccounts: coaRows.filter((c) => c.code && c.name),
      cashBanks: cbRows.filter((c) => c.name),
      receivablesPayables: rpRows.filter((r) => r.partyName),
      assets: assetRows.filter((a) => a.name),
      taxes: taxRows.filter((t) => t.taxObject),
      inventory: invRows.filter((i) => i.name),
      purchases: purRows.filter((p) => p.itemDescription),
      pdamSnapshot: {
        letterNumber: infoMap.get('nomor_surat'),
        letterDate: infoMap.get('tanggal_surat'),
        directorName: infoMap.get('direktur'),
        kabidKeuName: infoMap.get('kabid_keuangan'),
        kasubidKeuName: infoMap.get('kasubid_keuangan'),
      },
      parserNotes: ['Dibaca langsung dari template Excel terstruktur PDAM Tirta Saiyo.'],
    },
    targetYear,
    targetMonth,
    actorName,
    parserSource: 'excel-template',
  });
}

export function exportPdamMonthlyExcelTemplate(targetYear: number, targetMonth: string): void {
  const wb = XLSX.utils.book_new();
  const sampleCoa = buildOfficialPDAMCoaJan2026(targetYear, 'Template').map((c) => ({
    Kode: c.code,
    Nama_Akun: c.name,
    Tipe: c.type,
    Sub_Kategori: c.subCategory,
    Saldo_Normal: c.normalBalance,
    Grup_Arus_Kas: c.cashFlowGroup,
    Saldo_Akhir_Bulan_Ini: 0,
    Saldo_Bulan_Lalu: c.openingBalance,
    Realisasi_Bulan_Ini: 0,
    Realisasi_SD_Bulan_Ini: 0,
    Anggaran_Bulan_Ini: c.budgetMonthly || 0,
    Anggaran_SD_Bulan_Ini: c.budgetYtd || 0,
    Kontra: c.isContra ? 'Ya' : 'Tidak',
  }));

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Bagian: 'tahun', Nilai: String(targetYear) },
      { Bagian: 'bulan', Nilai: targetMonth },
      { Bagian: 'judul', Nilai: `Laporan Keuangan & Manajemen ${targetMonth} ${targetYear}` },
      { Bagian: 'nomor_surat', Nilai: `Um. 01.01/P-Tirta Saiyo/Pas/ -${targetYear}` },
      { Bagian: 'tanggal_surat', Nilai: `Lubuk Sikaping, ${targetMonth} ${targetYear}` },
      { Bagian: 'direktur', Nilai: 'DEDDY EKA PUTRA, SE' },
      { Bagian: 'kabid_keuangan', Nilai: 'NGADI' },
      { Bagian: 'kasubid_keuangan', Nilai: 'MURNIATI, SE' },
    ]),
    'INFO_SURAT'
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sampleCoa), 'COA_NERACA_LR');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Kode: '11.01.00', Nama_Rekening: 'Kas Besar Kantor Pusat', Jenis: 'KAS_BESAR', Nama_Bank: '', No_Rekening: '', Kode_COA: '11.01.00', Saldo_Akhir: 0 },
      { Kode: '11.02.10', Nama_Rekening: 'Kas Kecil Operasional', Jenis: 'KAS_KECIL', Nama_Bank: '', No_Rekening: '', Kode_COA: '11.02.10', Saldo_Akhir: 0 },
      { Kode: '11.01.10', Nama_Rekening: 'Bank Nagari Cabang Lubuk Sikaping', Jenis: 'BANK', Nama_Bank: 'Bank Nagari', No_Rekening: '08000101008500', Kode_COA: '11.01.10', Saldo_Akhir: 0 },
    ]),
    'KAS_BANK'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Jenis: 'PIUTANG', No_Dokumen: `PIU-${targetYear}-01`, Pihak: 'Pelanggan Rekening Air', Kategori: 'Piutang Usaha', Kode_COA: '13.01.10', Nilai_Awal: 0, Dibayar: 0, Sisa_Tagihan: 0, Jatuh_Tempo: `${targetYear}-12-31` },
    ]),
    'UTANG_PIUTANG'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Kode_Aset: '31.01.10', Nama_Aset: 'Tanah dan Hak Atas Tanah', Kelompok: 'Tanah & Sumber Air Baku', Harga_Perolehan: 0, Akumulasi_Penyusutan: 0, Nilai_Buku: 0, Umur_Bulan: 1 },
    ]),
    'ASET'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Jenis_Pajak: 'PPh 23', No_Bukti: `BUPOT-${targetYear}-01`, Objek_Pajak: 'PPh Pasal 23', DPP: 0, Tarif_Pct: 2, Nilai_Pajak: 0, Status: 'Terutang' },
    ]),
    'PAJAK'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { Kode_COA: '15.01.30', Kode_Barang: 'INV-KIMIA', Nama_Persediaan: 'Persediaan Bahan Kimia', Kategori: 'Bahan Kimia', Satuan: 'Kg / Nilai', Qty_Awal: 0, Qty_Masuk: 0, Qty_Keluar: 0, Qty_Akhir: 0, Nilai_Bulan_Lalu: 0, Nilai_Akhir: 0 },
    ]),
    'PERSEDIAAN'
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      { No_PO: `PO-${targetYear}-01`, Tanggal: `${targetYear}-01-15`, Kategori: 'Pipa dan Accessoris', Uraian: 'Pembelian Pipa & Aksesoris', Pemasok: 'Rekanan PDAM', Qty_Minta: 1, Qty_Realisasi: 1, Satuan: 'Paket', Nilai: 0, Status: 'Selesai' },
    ]),
    'PEMBELIAN'
  );

  XLSX.writeFile(wb, `Template_Laporan_Bulanan_${targetMonth}_${targetYear}.xlsx`);
}

function isDocInTargetMonthScope(params: {
  colName: string;
  id: string;
  data: Record<string, any>;
  targetYear: number;
  targetMonth: string;
}): boolean {
  const { colName, id, data, targetYear, targetMonth } = params;
  const targetLower = targetMonth.toLowerCase();
  const mSlug = getMonthSlug(targetMonth);

  if (colName === 'fin_pdam_reports') {
    return (
      id === `pdam-${targetYear}-${targetMonth}` ||
      (data.year === targetYear && String(data.month || '').toLowerCase() === targetLower)
    );
  }

  if (colName === 'fin_accounts') {
    if (data.year !== targetYear) return false;
    if (data.month) return String(data.month).toLowerCase() === targetLower;
    if (id.startsWith(`coa-${targetYear}-${mSlug}-`)) return true;
    // Legacy baseline COA without month field: only treat as belonging to Jan (2026+) or Dec (2025)
    return (
      (targetYear <= 2025 && targetLower === 'desember') ||
      (targetYear >= 2026 && targetLower === 'januari')
    );
  }

  if (colName === 'fin_cash_banks') {
    if (data.year !== targetYear) return false;
    if (data.month) return String(data.month).toLowerCase() === targetLower;
    if (id.startsWith(`cb-${targetYear}-${mSlug}-`)) return true;
    return (
      (targetYear <= 2025 && targetLower === 'desember') ||
      (targetYear >= 2026 && targetLower === 'januari')
    );
  }

  if (colName === 'fin_assets') {
    if (data.year === targetYear && String(data.month || '').toLowerCase() === targetLower) {
      return true;
    }
    if (id.startsWith(`ast-${targetYear}-${mSlug}-`)) return true;
    return false;
  }

  // Collections natively having year & month:
  return (
    data.year === targetYear &&
    String(data.month || '').trim().toLowerCase() === targetLower
  );
}

export interface MonthlyCommitSummary {
  deletedCount: number;
  writtenCount: number;
  uploadRecord: FinanceMonthlyUploadRecord;
}

export async function commitMonthlyReportUploadToFirestore(params: {
  payload: FinanceMonthlyUploadParsedPayload;
  applyMode: FinanceUploadApplyMode;
  fileMeta: { fileName: string; fileSizeBytes: number; mimeType: string };
  actor: { uid: string; displayName: string; role: string };
}): Promise<MonthlyCommitSummary> {
  const { payload, applyMode, fileMeta, actor } = params;
  const { targetYear, targetMonth } = payload;
  const now = new Date().toISOString();
  const mSlug = getMonthSlug(targetMonth);

  // Stamp explicit targetYear & targetMonth onto every item one last time before committing
  const coaList: FinanceAccount[] = payload.coaAccounts.map((c, idx) => ({
    ...c,
    id: `coa-${targetYear}-${mSlug}-${(c.code || String(idx + 1)).replace(/[^a-zA-Z0-9]/g, '')}`,
    year: targetYear,
    month: targetMonth,
    updatedAt: now,
  }));

  const cbList: FinanceCashBankAccount[] = payload.cashBanks.map((cb, idx) => ({
    ...cb,
    id: `cb-${targetYear}-${mSlug}-${((cb.code || '') + '-' + cb.name.slice(0, 12)).replace(/[^a-zA-Z0-9]/g, '') || idx + 1}`,
    year: targetYear,
    month: targetMonth,
    updatedAt: now,
  }));

  const rpList: FinanceReceivablePayable[] = payload.receivablesPayables.map((rp, idx) => ({
    ...rp,
    id: rp.id || `rp-${targetYear}-${mSlug}-${idx + 1}`,
    year: targetYear,
    month: targetMonth,
    updatedAt: now,
  }));

  const assetList: FinanceAsset[] = payload.assets.map((a, idx) => ({
    ...a,
    id: `ast-${targetYear}-${mSlug}-${(a.assetCode || String(idx + 1)).replace(/[^a-zA-Z0-9]/g, '')}`,
    year: targetYear,
    month: targetMonth,
    updatedAt: now,
  }));

  const taxList: FinanceTaxRecord[] = payload.taxes.map((t, idx) => ({
    ...t,
    id: t.id || `tax-${targetYear}-${mSlug}-${idx + 1}`,
    year: targetYear,
    month: targetMonth,
    updatedAt: now,
  }));

  const invList: FinanceInventoryItem[] = payload.inventory.map((i, idx) => ({
    ...i,
    id: i.id || `inv-${targetYear}-${mSlug}-${idx + 1}`,
    year: targetYear,
    month: targetMonth,
    updatedAt: now,
  }));

  const purList: FinancePurchaseRecord[] = payload.purchases.map((p, idx) => ({
    ...p,
    id: p.id || `pur-${targetYear}-${mSlug}-${idx + 1}`,
    year: targetYear,
    month: targetMonth,
    updatedAt: now,
  }));

  const pdamSnap: FinancePdamMonthlySnapshot = {
    ...payload.pdamSnapshot,
    id: `pdam-${targetYear}-${targetMonth}`,
    year: targetYear,
    month: targetMonth,
    updatedBy: actor.displayName,
    updatedAt: now,
  };

  // 1. Delete existing records ONLY inside (targetYear, targetMonth) when REPLACE_MONTH
  const deleteRefs: DocumentReference[] = [];
  if (applyMode === 'REPLACE_MONTH') {
    const targetCols: { colName: string; hasNewData: boolean }[] = [
      { colName: 'fin_accounts', hasNewData: coaList.length > 0 },
      { colName: 'fin_cash_banks', hasNewData: cbList.length > 0 },
      { colName: 'fin_receivables_payables', hasNewData: rpList.length > 0 },
      { colName: 'fin_assets', hasNewData: assetList.length > 0 },
      { colName: 'fin_taxes', hasNewData: taxList.length > 0 },
      { colName: 'fin_inventory', hasNewData: invList.length > 0 },
      { colName: 'fin_purchases', hasNewData: purList.length > 0 },
      { colName: 'fin_pdam_reports', hasNewData: true },
    ];

    for (const { colName, hasNewData } of targetCols) {
      if (!hasNewData) continue;
      const snap = await getDocs(collection(db, colName));
      snap.docs.forEach((d) => {
        if (
          isDocInTargetMonthScope({
            colName,
            id: d.id,
            data: d.data(),
            targetYear,
            targetMonth,
          })
        ) {
          deleteRefs.push(d.ref);
        }
      });
    }

    for (let i = 0; i < deleteRefs.length; i += BATCH_LIMIT) {
      const batch = writeBatch(db);
      deleteRefs.slice(i, i + BATCH_LIMIT).forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  }

  // 2. Compute authoritative preview summary for Upload History & Audit Trail
  const previewStatements = computeAccountingStatements({
    accounts: coaList,
    journals: [],
    transactions: [],
    yearFilter: targetYear,
    monthFilter: targetMonth,
  });
  const previewCash = computeCashBankBalances(cbList, [], undefined, targetYear, targetMonth);

  const uploadId = `fup-${targetYear}-${mSlug}-${Date.now()}`;
  const uploadRecord: FinanceMonthlyUploadRecord = sanitizeFirestoreRecord({
    id: uploadId,
    targetYear,
    targetMonth,
    fileName: fileMeta.fileName,
    fileSizeBytes: fileMeta.fileSizeBytes,
    fileMimeType: fileMeta.mimeType,
    parserSource: payload.parserSource,
    applyMode,
    detectedPeriodLabel:
      payload.detectedPeriod.month || payload.detectedPeriod.year
        ? `${payload.detectedPeriod.month || '-'} ${payload.detectedPeriod.year || '-'}`
        : `${targetMonth} ${targetYear}`,
    summary: {
      totalAssets: previewStatements.balanceSheet.totalAssets,
      totalLiabilitiesAndEquity: previewStatements.balanceSheet.totalLiabilitiesAndEquity,
      isBalanced: previewStatements.balanceSheet.isBalanced,
      operatingRevenue: previewStatements.incomeStatement.monthlyTotalOperatingRevenue || previewStatements.incomeStatement.totalOperatingRevenue,
      operatingExpense: previewStatements.incomeStatement.monthlyTotalOperatingExpense || previewStatements.incomeStatement.totalOperatingExpense,
      operatingIncome: previewStatements.incomeStatement.monthlyOperatingIncome || previewStatements.incomeStatement.operatingIncome,
      netIncome: previewStatements.incomeStatement.monthlyNetIncome || previewStatements.incomeStatement.netIncome,
      totalCashBank: previewCash.totalLiquidBalance,
      coaCount: coaList.length,
      cashBankCount: cbList.length,
      rpCount: rpList.length,
      assetCount: assetList.length,
      taxCount: taxList.length,
      inventoryCount: invList.length,
      purchaseCount: purList.length,
    },
    uploadedBy: actor.displayName,
    uploadedByUid: actor.uid,
    uploadedByRole: actor.role,
    appliedAt: now,
    status: 'Diterapkan',
  });

  const auditEntry: FinanceAuditTrail = sanitizeFirestoreRecord({
    id: `faud-upload-${targetYear}-${mSlug}-${Date.now()}`,
    timestamp: now,
    actorUid: actor.uid,
    actorName: actor.displayName,
    actorRole: actor.role,
    actionType: 'IMPORT',
    entityType: `Upload Laporan Bulanan (${targetMonth} ${targetYear})`,
    entityId: uploadId,
    entityLabel: `${fileMeta.fileName} -> ${targetMonth} ${targetYear}`,
    summary: `Super User menerapkan laporan "${fileMeta.fileName}" khusus ke periode ${targetMonth} ${targetYear} (Mode: ${applyMode}). Total COA: ${coaList.length}, Kas/Bank: ${cbList.length}, Utang/Piutang: ${rpList.length}, Aset: ${assetList.length}, Pajak: ${taxList.length}, Persediaan: ${invList.length}, Pembelian: ${purList.length}.`,
    beforeData: null,
    afterData: uploadRecord.summary as unknown as Record<string, unknown>,
    year: targetYear,
  });

  // 3. Stage chunked writes
  const writeOps: { ref: DocumentReference; data: Record<string, unknown> }[] = [
    ...coaList.map((item) => ({
      ref: doc(db, 'fin_accounts', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...cbList.map((item) => ({
      ref: doc(db, 'fin_cash_banks', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...rpList.map((item) => ({
      ref: doc(db, 'fin_receivables_payables', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...assetList.map((item) => ({
      ref: doc(db, 'fin_assets', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...taxList.map((item) => ({
      ref: doc(db, 'fin_taxes', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...invList.map((item) => ({
      ref: doc(db, 'fin_inventory', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...purList.map((item) => ({
      ref: doc(db, 'fin_purchases', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    {
      ref: doc(db, 'fin_pdam_reports', pdamSnap.id),
      data: sanitizeFirestoreRecord(pdamSnap) as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'fin_monthly_report_uploads', uploadRecord.id),
      data: uploadRecord as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'fin_audit_trails', auditEntry.id),
      data: auditEntry as unknown as Record<string, unknown>,
    },
  ];

  for (let i = 0; i < writeOps.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    writeOps.slice(i, i + BATCH_LIMIT).forEach(({ ref, data }) => {
      batch.set(ref, data);
    });
    await batch.commit();
  }

  return {
    deletedCount: deleteRefs.length,
    writtenCount: writeOps.length,
    uploadRecord,
  };
}

export async function deleteMonthlyUploadHistoryRecord(
  record: FinanceMonthlyUploadRecord
): Promise<void> {
  await deleteDoc(doc(db, 'fin_monthly_report_uploads', record.id));
}

export function computePayloadPreviewStats(payload: FinanceMonthlyUploadParsedPayload) {
  const statements = computeAccountingStatements({
    accounts: payload.coaAccounts,
    journals: [],
    transactions: [],
    yearFilter: payload.targetYear,
    monthFilter: payload.targetMonth,
  });
  const cashBank = computeCashBankBalances(
    payload.cashBanks,
    [],
    undefined,
    payload.targetYear,
    payload.targetMonth
  );
  return { statements, cashBank };
}

export const SUPPORTED_FISCAL_MONTHS = FISCAL_MONTH_NAMES;
