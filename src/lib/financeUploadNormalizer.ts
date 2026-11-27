import {
  FinanceAccount,
  FinanceAccountType,
  FinanceAsset,
  FinanceCashBankAccount,
  FinanceCashBankKind,
  FinanceCashFlowGroup,
  FinanceInventoryItem,
  FinanceMonthlyUploadParsedPayload,
  FinancePdamMonthlySnapshot,
  FinancePurchaseRecord,
  FinanceReceivablePayable,
  FinanceTaxRecord,
  FinanceTaxType,
} from '../types/finance';

export const FISCAL_MONTH_NAMES = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

export const ALLOWED_SUPER_USER_ROLES = ['KEPALA_SPI', 'ADMIN_SISTEM'] as const;

export const getMonthNumberPadded = (monthName: string): string => {
  const idx = FISCAL_MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === (monthName || '').trim().toLowerCase()
  );
  return String(idx >= 0 ? idx + 1 : 1).padStart(2, '0');
};

export const getMonthSlug = (monthName: string): string => {
  const idx = FISCAL_MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === (monthName || '').trim().toLowerCase()
  );
  const clean = (idx >= 0 ? FISCAL_MONTH_NAMES[idx] : monthName || 'Januari')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return clean.slice(0, 3) || 'jan';
};

export const getMonthEndDateIso = (year: number, monthName: string): string => {
  const monthIdx = FISCAL_MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === (monthName || '').trim().toLowerCase()
  );
  const m = monthIdx >= 0 ? monthIdx + 1 : 1;
  const lastDay = new Date(year, m, 0).getDate();
  return `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

export const toFiniteNumber = (val: unknown, fallback = 0): number => {
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return fallback;
    const isParenNeg = /^\(.*\)$/.test(trimmed);
    const cleaned = trimmed
      .replace(/[RpIDR\s()]/gi, '')
      .replace(/\.(?=\d{3}(?:[.,]|$))/g, '')
      .replace(/,/g, '.');
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return fallback;
    return isParenNeg ? -Math.abs(parsed) : parsed;
  }
  return fallback;
};

const cleanIdToken = (raw: string, fallback: string): string => {
  const c = (raw || '').replace(/[^a-zA-Z0-9]/g, '');
  return c || fallback;
};

const inferCoaType = (rawType: unknown, code: string): FinanceAccountType => {
  const t = String(rawType || '').trim().toLowerCase();
  if (t.includes('aset') || t.includes('aktiva')) return 'Aset';
  if (t.includes('kewajiban') || t.includes('utang') || t.includes('hutang')) return 'Kewajiban';
  if (t.includes('ekuitas') || t.includes('modal')) return 'Ekuitas';
  if (t.includes('pendapatan') || t.includes('penghasilan')) return 'Pendapatan';
  if (t.includes('beban') || t.includes('biaya')) return 'Beban';
  if (code.startsWith('1') || code.startsWith('2') || code.startsWith('3') || code.startsWith('4')) {
    return 'Aset';
  }
  if (code.startsWith('5') || code.startsWith('6')) return 'Kewajiban';
  if (code.startsWith('7')) return 'Ekuitas';
  if (code.startsWith('8')) return 'Pendapatan';
  if (code.startsWith('9')) return 'Beban';
  return 'Beban';
};

const inferNormalBalance = (
  rawNormal: unknown,
  type: FinanceAccountType,
  isContra: boolean
): 'Debit' | 'Kredit' => {
  const n = String(rawNormal || '').trim().toLowerCase();
  if (n === 'debit') return 'Debit';
  if (n === 'kredit' || n === 'credit') return 'Kredit';
  if (type === 'Aset' || type === 'Beban') return isContra ? 'Kredit' : 'Debit';
  return 'Kredit';
};

const inferCashFlowGroup = (
  rawGroup: unknown,
  code: string,
  name: string,
  type: FinanceAccountType
): FinanceCashFlowGroup => {
  const g = String(rawGroup || '').trim().toLowerCase();
  if (g === 'kas') return 'Kas';
  if (g === 'investasi') return 'Investasi';
  if (g === 'pendanaan') return 'Pendanaan';
  if (g === 'non-kas' || g === 'nonkas') return 'Non-Kas';
  if (g === 'operasional') return 'Operasional';
  const lowName = name.toLowerCase();
  if (code.startsWith('11.') || lowName.includes('kas') || lowName.includes('bank')) return 'Kas';
  if (code.startsWith('31.') || lowName.includes('aktiva tetap')) return 'Investasi';
  if (type === 'Ekuitas' || code.startsWith('6')) return 'Pendanaan';
  return 'Operasional';
};

const inferIsContra = (rawContra: unknown, code: string, name: string, subCat: string): boolean => {
  if (typeof rawContra === 'boolean') return rawContra;
  const txt = `${name} ${subCat}`.toLowerCase();
  return (
    code.startsWith('13.09') ||
    code.startsWith('31.10') ||
    txt.includes('akumulasi') ||
    txt.includes('penyisihan') ||
    txt.includes('penurunan nilai')
  );
};

const inferInventoryCategory = (
  rawCat: unknown,
  coaCode: string
): FinanceInventoryItem['category'] => {
  const c = String(rawCat || '').toLowerCase();
  if (c.includes('kimia')) return 'Bahan Kimia';
  if (c.includes('tidak bergerak')) return 'Bahan Instalasi Tidak Bergerak';
  if (c.includes('atk') || c.includes('umum')) return 'ATK & Umum';
  if (c.includes('bergerak') || c.includes('instalasi')) return 'Bahan Instalasi Bergerak';
  if (coaCode.startsWith('15.01.30') || coaCode.startsWith('15.01.40')) return 'Bahan Kimia';
  if (coaCode.startsWith('15.03.91')) return 'Bahan Instalasi Tidak Bergerak';
  return 'Bahan Instalasi Bergerak';
};

const inferPurchaseCategory = (rawCat: unknown): FinancePurchaseRecord['category'] => {
  const c = String(rawCat || '').toLowerCase();
  if (c.includes('alat tulis') || c.includes('atk')) return 'Alat tulis kantor';
  if (c.includes('pipa') || c.includes('access')) return 'Pipa dan Accessoris';
  if (c.includes('kimia')) return 'Bahan Kimia';
  if (c.includes('modal') || c.includes('aset')) return 'Belanja Modal';
  return 'Lainnya';
};

const inferTaxType = (rawType: unknown): FinanceTaxType => {
  const t = String(rawType || '').toLowerCase();
  if (t.includes('ppn')) return 'PPN';
  if (t.includes('21')) return 'PPh 21';
  if (t.includes('22')) return 'PPh 22';
  if (t.includes('23')) return 'PPh 23';
  if (t.includes('4(2)') || t.includes('final')) return 'PPh Final 4(2)';
  if (t.includes('permukaan')) return 'Pajak Air Permukaan';
  return 'Lainnya';
};

export function normalizeParsedFinanceReport(params: {
  raw: Record<string, any>;
  targetYear: number;
  targetMonth: string;
  actorName: string;
  parserSource: 'gemini-4-hydrogen' | 'excel-template' | 'manual-review';
}): FinanceMonthlyUploadParsedPayload {
  const { raw = {}, targetYear, targetMonth, actorName, parserSource } = params;
  const now = new Date().toISOString();
  const mSlug = getMonthSlug(targetMonth);
  const mPad = getMonthNumberPadded(targetMonth);
  const monthEndIso = getMonthEndDateIso(targetYear, targetMonth);

  // 1. Detected Period Check
  const detYear = raw?.detectedPeriod?.year ? toFiniteNumber(raw.detectedPeriod.year, 0) : undefined;
  const detMonth = raw?.detectedPeriod?.month ? String(raw.detectedPeriod.month).trim() : undefined;
  let discrepancyWarning = raw?.detectedPeriod?.discrepancyWarning
    ? String(raw.detectedPeriod.discrepancyWarning)
    : undefined;

  if (!discrepancyWarning && ((detYear && detYear !== targetYear) || (detMonth && detMonth.toLowerCase() !== targetMonth.toLowerCase()))) {
    discrepancyWarning = `Dokumen terdeteksi sebagai periode "${detMonth || '?'} ${detYear || '?'}", sedangkan target penyimpanan yang Anda pilih adalah "${targetMonth} ${targetYear}". Sistem tetap akan mengunci hasil import ini ke periode ${targetMonth} ${targetYear}.`;
  }

  // 2. COA Accounts (scoped strictly to targetYear + targetMonth)
  const rawCoas = Array.isArray(raw.coaAccounts) ? raw.coaAccounts : [];
  const coaByCode = new Map<string, FinanceAccount>();
  rawCoas.forEach((item: any, idx: number) => {
    const code = String(item?.code || `99.${String(idx + 1).padStart(2, '0')}`).trim();
    const name = String(item?.name || `Akun ${code}`).trim();
    const type = inferCoaType(item?.type, code);
    const subCategory = String(
      item?.subCategory ||
        (type === 'Aset'
          ? code.startsWith('31.')
            ? 'Aset Tetap Produktif'
            : 'Aset Lancar'
          : type === 'Kewajiban'
          ? code.startsWith('6')
            ? 'Kewajiban Jangka Panjang'
            : 'Kewajiban Lancar'
          : type === 'Ekuitas'
          ? 'Ekuitas & Cadangan'
          : type === 'Pendapatan'
          ? 'Pendapatan Usaha'
          : 'Beban Operasi')
    ).trim();
    const isContra = inferIsContra(item?.isContra, code, name, subCategory);
    const normalBalance = inferNormalBalance(item?.normalBalance, type, isContra);
    const cashFlowGroup = inferCashFlowGroup(item?.cashFlowGroup, code, name, type);

    const openingBalance = toFiniteNumber(
      item?.openingBalance ?? item?.endingBalance ?? item?.currentBalance,
      0
    );
    const prevMonthBalance = toFiniteNumber(item?.prevMonthBalance, 0);
    const monthlyRealization = toFiniteNumber(
      item?.monthlyRealization,
      type === 'Pendapatan' || type === 'Beban' ? openingBalance : 0
    );
    const ytdRealization = toFiniteNumber(
      item?.ytdRealization,
      type === 'Pendapatan' || type === 'Beban' ? openingBalance : 0
    );
    const budgetMonthly = toFiniteNumber(item?.budgetMonthly, 0);
    const budgetYtd = toFiniteNumber(item?.budgetYtd, budgetMonthly);

    const coaId = `coa-${targetYear}-${mSlug}-${cleanIdToken(code, String(idx + 1))}`;
    coaByCode.set(code, {
      id: coaId,
      code,
      name,
      type,
      subCategory,
      normalBalance,
      cashFlowGroup,
      openingBalance,
      prevMonthBalance,
      monthlyRealization,
      ytdRealization,
      budgetMonthly,
      budgetYtd,
      isContra,
      year: targetYear,
      month: targetMonth,
      isActive: true,
      description: item?.description ? String(item.description) : undefined,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    });
  });
  const coaAccounts = Array.from(coaByCode.values()).sort((a, b) => a.code.localeCompare(b.code));

  // 3. Cash & Bank Accounts (scoped strictly to targetYear + targetMonth)
  const rawCashBanks = Array.isArray(raw.cashBanks) ? raw.cashBanks : [];
  const cashBanks: FinanceCashBankAccount[] = rawCashBanks.map((cb: any, idx: number) => {
    const code = String(cb?.code || cb?.coaCode || `11.${String(idx + 1).padStart(2, '0')}.00`).trim();
    const coaCode = String(cb?.coaCode || code).trim();
    const name = String(cb?.name || `Rekening ${code}`).trim();
    const rawKind = String(cb?.accountKind || '').toUpperCase();
    const accountKind: FinanceCashBankKind =
      rawKind === 'KAS_BESAR' || rawKind === 'KAS_KECIL' || rawKind === 'BANK'
        ? (rawKind as FinanceCashBankKind)
        : name.toLowerCase().includes('kas kecil')
        ? 'KAS_KECIL'
        : name.toLowerCase().includes('kas')
        ? 'KAS_BESAR'
        : 'BANK';
    const matchedCoa = coaByCode.get(coaCode);
    const idToken = cleanIdToken(`${code}-${name.slice(0, 12)}`, String(idx + 1));
    return {
      id: `cb-${targetYear}-${mSlug}-${idToken}`,
      code,
      name,
      accountKind,
      bankName: cb?.bankName ? String(cb.bankName).trim() : undefined,
      accountNumber: cb?.accountNumber ? String(cb.accountNumber).trim() : undefined,
      coaId: matchedCoa?.id || `coa-${targetYear}-${mSlug}-${cleanIdToken(coaCode, '1101')}`,
      coaCode,
      year: targetYear,
      month: targetMonth,
      unitId: '',
      unitName: String(cb?.unitName || 'Bidang Umum dan Keuangan'),
      openingBalance: toFiniteNumber(cb?.balance ?? cb?.openingBalance, 0),
      isActive: true,
      notes: cb?.notes
        ? String(cb.notes)
        : `Hasil upload laporan ${targetMonth} ${targetYear}`,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    };
  });

  // Fallback derive Kas/Bank if PDF parser put 11.xx in COA but didn't populate cashBanks separately
  if (cashBanks.length === 0) {
    coaAccounts
      .filter((c) => c.type === 'Aset' && (c.cashFlowGroup === 'Kas' || c.code.startsWith('11.')))
      .forEach((c, idx) => {
        const lower = c.name.toLowerCase();
        const kind: FinanceCashBankKind = lower.includes('kas kecil')
          ? 'KAS_KECIL'
          : lower.includes('kas')
          ? 'KAS_BESAR'
          : 'BANK';
        cashBanks.push({
          id: `cb-${targetYear}-${mSlug}-${cleanIdToken(c.code, String(idx + 1))}`,
          code: c.code,
          name: c.name,
          accountKind: kind,
          coaId: c.id,
          coaCode: c.code,
          year: targetYear,
          month: targetMonth,
          unitId: '',
          unitName: 'Bidang Umum dan Keuangan',
          openingBalance: c.openingBalance,
          isActive: true,
          notes: `Diturunkan otomatis dari COA ${c.code} periode ${targetMonth} ${targetYear}`,
          createdBy: actorName,
          createdAt: now,
          updatedAt: now,
        });
      });
  }

  // 4. Receivables & Payables
  const rawRps = Array.isArray(raw.receivablesPayables) ? raw.receivablesPayables : [];
  const receivablesPayables: FinanceReceivablePayable[] = rawRps.map((rp: any, idx: number) => {
    const kind: 'PIUTANG' | 'UTANG' =
      String(rp?.kind || '').toUpperCase() === 'UTANG' ? 'UTANG' : 'PIUTANG';
    const docNum = String(
      rp?.documentNumber || `${kind === 'PIUTANG' ? 'PIU' : 'UTG'}-${targetYear}-${mPad}-${idx + 1}`
    ).trim();
    const orig = Math.max(0, toFiniteNumber(rp?.originalAmount ?? rp?.remainingAmount, 0));
    const paid = Math.max(0, toFiniteNumber(rp?.paidAmount, 0));
    const rem = Math.max(0, toFiniteNumber(rp?.remainingAmount, Math.max(0, orig - paid)));
    const status: FinanceReceivablePayable['status'] =
      rem <= 0 ? 'Lunas' : paid > 0 ? 'Sebagian' : 'Belum Lunas';
    const coaCode = String(rp?.coaCode || (kind === 'PIUTANG' ? '13.01.10' : '50.01.10')).trim();
    return {
      id: `rp-${targetYear}-${mSlug}-${cleanIdToken(docNum, String(idx + 1))}-${idx + 1}`,
      kind,
      documentNumber: docNum,
      partyName: String(rp?.partyName || 'Pelanggan / Rekanan PDAM').trim(),
      category: String(
        rp?.category || (kind === 'PIUTANG' ? 'Piutang Rekening Air' : 'Utang Usaha / Operasional')
      ).trim(),
      unitId: '',
      unitName: String(rp?.unitName || 'Kantor Pusat & Unit Pelayanan'),
      coaId:
        coaByCode.get(coaCode)?.id || `coa-${targetYear}-${mSlug}-${cleanIdToken(coaCode, '1301')}`,
      coaCode,
      transactionDate: String(rp?.transactionDate || monthEndIso),
      dueDate: String(rp?.dueDate || monthEndIso),
      year: targetYear,
      month: targetMonth,
      originalAmount: orig || rem,
      paidAmount: paid,
      remainingAmount: rem,
      status,
      payments: [],
      notes: rp?.notes ? String(rp.notes) : `Upload ${targetMonth} ${targetYear}`,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    };
  });

  // 5. Fixed Assets (month-scoped so Jan vs Feb vs Mar snapshots never overwrite)
  const rawAssets = Array.isArray(raw.assets) ? raw.assets : [];
  const assets: FinanceAsset[] = rawAssets.map((a: any, idx: number) => {
    const assetCode = String(a?.assetCode || `31.${String(idx + 1).padStart(2, '0')}.00`).trim();
    const cost = Math.max(0, toFiniteNumber(a?.acquisitionCost, 0));
    const accum = Math.max(0, toFiniteNumber(a?.accumulatedDepreciation, 0));
    const bookValue =
      a?.bookValue !== undefined ? Math.max(0, toFiniteNumber(a.bookValue, 0)) : Math.max(0, cost - accum);
    return {
      id: `ast-${targetYear}-${mSlug}-${cleanIdToken(assetCode, String(idx + 1))}`,
      assetCode,
      name: String(a?.name || `Aset ${assetCode}`).trim(),
      category: String(a?.category || 'Aktiva Tetap Produktif').trim(),
      unitId: '',
      unitName: String(a?.unitName || 'Kantor Pusat & 11 Unit Pelayanan'),
      year: targetYear,
      month: targetMonth,
      acquisitionDate: String(a?.acquisitionDate || monthEndIso),
      acquisitionCost: cost,
      usefulLifeMonths: Math.max(1, toFiniteNumber(a?.usefulLifeMonths, 120)),
      salvageValue: Math.max(0, toFiniteNumber(a?.salvageValue, 0)),
      depreciationMethod: 'Garis Lurus',
      accumulatedDepreciation: accum,
      bookValue,
      coaAssetId:
        coaByCode.get(assetCode)?.id ||
        `coa-${targetYear}-${mSlug}-${cleanIdToken(assetCode, '3101')}`,
      status:
        a?.status === 'Dalam Perbaikan' || a?.status === 'Dihapusbukukan' ? a.status : 'Aktif',
      mutations: [],
      notes: a?.notes ? String(a.notes) : `Rekap Aktiva ${targetMonth} ${targetYear}`,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    };
  });

  // 6. Taxes
  const rawTaxes = Array.isArray(raw.taxes) ? raw.taxes : [];
  const taxes: FinanceTaxRecord[] = rawTaxes.map((t: any, idx: number) => {
    const taxType = inferTaxType(t?.taxType);
    const status: FinanceTaxRecord['status'] =
      t?.status === 'Dibayar' || t?.status === 'Dilaporkan' ? t.status : 'Terutang';
    const withholdingNumber = String(
      t?.withholdingNumber || `TAX-${targetYear}-${mPad}-${idx + 1}`
    ).trim();
    return {
      id: `tax-${targetYear}-${mSlug}-${cleanIdToken(withholdingNumber, String(idx + 1))}-${idx + 1}`,
      taxType,
      year: targetYear,
      month: targetMonth,
      withholdingNumber,
      taxObject: String(t?.taxObject || `Kewajiban ${taxType} ${targetMonth} ${targetYear}`).trim(),
      taxBaseAmount: Math.max(0, toFiniteNumber(t?.taxBaseAmount, 0)),
      taxRatePct: Math.max(0, toFiniteNumber(t?.taxRatePct, 0)),
      taxAmount: Math.max(0, toFiniteNumber(t?.taxAmount, 0)),
      status,
      dueDate: String(t?.dueDate || monthEndIso),
      paymentDate: t?.paymentDate ? String(t.paymentDate) : undefined,
      ntpnNumber: t?.ntpnNumber ? String(t.ntpnNumber) : undefined,
      unitId: '',
      unitName: String(t?.unitName || 'Bidang Umum dan Keuangan'),
      notes: t?.notes ? String(t.notes) : `Upload Pajak ${targetMonth} ${targetYear}`,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    };
  });

  // 7. Inventory
  const rawInv = Array.isArray(raw.inventory) ? raw.inventory : [];
  const inventory: FinanceInventoryItem[] = rawInv.map((inv: any, idx: number) => {
    const coaCode = String(inv?.coaCode || '15.01.20').trim();
    const itemCode = String(inv?.itemCode || `INV-${mSlug.toUpperCase()}-${idx + 1}`).trim();
    const begQty = Math.max(0, toFiniteNumber(inv?.beginningQty, 0));
    const inQty = Math.max(0, toFiniteNumber(inv?.inQty, 0));
    const outQty = Math.max(0, toFiniteNumber(inv?.outQty, 0));
    const endQty = toFiniteNumber(inv?.endingQty, Math.max(0, begQty + inQty - outQty));
    const endVal = Math.max(0, toFiniteNumber(inv?.endingValue, 0));
    return {
      id: `inv-${targetYear}-${mSlug}-${cleanIdToken(itemCode, String(idx + 1))}-${idx + 1}`,
      coaCode,
      itemCode,
      name: String(inv?.name || `Persediaan ${coaCode}`).trim(),
      category: inferInventoryCategory(inv?.category, coaCode),
      unitMeasure: String(inv?.unitMeasure || 'Unit / Nilai'),
      year: targetYear,
      month: targetMonth,
      unitId: '',
      unitName: String(inv?.unitName || 'Gudang Kantor Pusat & Unit'),
      beginningQty: begQty,
      inQty,
      outQty,
      endingQty: endQty,
      unitCost: endQty > 0 ? Math.round(endVal / endQty) : endVal,
      prevMonthValue: Math.max(0, toFiniteNumber(inv?.prevMonthValue, 0)),
      endingValue: endVal,
      minStockQty: Math.max(0, toFiniteNumber(inv?.minStockQty, 1)),
      notes: inv?.notes ? String(inv.notes) : `Persediaan ${targetMonth} ${targetYear}`,
      updatedBy: actorName,
      updatedAt: now,
      createdAt: now,
    };
  });

  // 8. Purchases
  const rawPurchases = Array.isArray(raw.purchases) ? raw.purchases : [];
  const purchases: FinancePurchaseRecord[] = rawPurchases.map((p: any, idx: number) => {
    const purNo = String(p?.purchaseNumber || `PO-${targetYear}-${mPad}-${idx + 1}`).trim();
    const status: FinancePurchaseRecord['status'] =
      p?.status === 'Permintaan' ||
      p?.status === 'Realisasi' ||
      p?.status === 'Dibatalkan'
        ? p.status
        : 'Selesai';
    return {
      id: `pur-${targetYear}-${mSlug}-${cleanIdToken(purNo, String(idx + 1))}-${idx + 1}`,
      purchaseNumber: purNo,
      purchaseDate: String(p?.purchaseDate || monthEndIso),
      year: targetYear,
      month: targetMonth,
      category: inferPurchaseCategory(p?.category),
      itemDescription: String(p?.itemDescription || 'Pengadaan Operasional').trim(),
      vendorName: String(p?.vendorName || 'Rekanan Pemasok PDAM').trim(),
      unitId: '',
      unitName: String(p?.unitName || 'Bagian Umum / Logistik'),
      requestedQty: Math.max(0, toFiniteNumber(p?.requestedQty, 1)),
      realizedQty: Math.max(0, toFiniteNumber(p?.realizedQty, 1)),
      unitMeasure: String(p?.unitMeasure || 'Paket'),
      amount: Math.max(0, toFiniteNumber(p?.amount, 0)),
      status,
      notes: p?.notes ? String(p.notes) : `Pembelian ${targetMonth} ${targetYear}`,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    };
  });

  // 9. PDAM Monthly Snapshot (strictly keyed pdam-${targetYear}-${targetMonth})
  const rawSnap = raw.pdamSnapshot || {};
  const cashSum = cashBanks.reduce((s, c) => s + (c.openingBalance || 0), 0);
  const pdamSnapshot: FinancePdamMonthlySnapshot = {
    id: `pdam-${targetYear}-${targetMonth}`,
    year: targetYear,
    month: targetMonth,
    letterNumber: String(
      rawSnap.letterNumber || `Um. 01.01/P-Tirta Saiyo/Pas/${mPad}-${targetYear}`
    ),
    letterDate: String(rawSnap.letterDate || `Lubuk Sikaping, ${targetMonth} ${targetYear}`),
    recipient: String(
      rawSnap.recipient ||
        'Yth. KPM Selaku Dewan Pengawas Perusahaan Umum Daerah Air Minum Tirta Saiyo Kabupaten Pasaman'
    ),
    legalBasis: String(
      rawSnap.legalBasis ||
        'Peraturan Menteri Dalam Negeri No. 118 Tahun 2018 Pasal 28 tentang Rencana Bisnis, Rencana Kerja dan Anggaran, Kerja Sama, Pelaporan dan Evaluasi BUMD.'
    ),
    directorName: String(rawSnap.directorName || 'DEDDY EKA PUTRA, SE'),
    kabidKeuName: String(rawSnap.kabidKeuName || 'NGADI'),
    kabidKeuNik: String(rawSnap.kabidKeuNik || '25730906109'),
    kasubidKeuName: String(rawSnap.kasubidKeuName || 'MURNIATI, SE'),
    kasubidKeuNik: String(rawSnap.kasubidKeuNik || '25850962123'),
    summaryMetrics: Array.isArray(rawSnap.summaryMetrics)
      ? rawSnap.summaryMetrics.map((m: any, i: number) => ({
          code: String(m?.code || `M.${i + 1}`),
          label: String(m?.label || 'Indikator'),
          section: m?.section === 'PRODUKSI_DISTRIBUSI' ? 'PRODUKSI_DISTRIBUSI' : 'KEUANGAN',
          unit: String(m?.unit || 'Rp'),
          monthlyReal: toFiniteNumber(m?.monthlyReal, 0),
          monthlyBudget: toFiniteNumber(m?.monthlyBudget, 0),
          ytdReal: toFiniteNumber(m?.ytdReal, 0),
          ytdBudget: toFiniteNumber(m?.ytdBudget, 0),
        }))
      : [],
    indirectCashFlow: {
      netIncomeMonthly: toFiniteNumber(rawSnap?.indirectCashFlow?.netIncomeMonthly, 0),
      depreciationAddBack: toFiniteNumber(rawSnap?.indirectCashFlow?.depreciationAddBack, 0),
      workingCapitalChanges: Array.isArray(rawSnap?.indirectCashFlow?.workingCapitalChanges)
        ? rawSnap.indirectCashFlow.workingCapitalChanges.map((w: any) => ({
            label: String(w?.label || 'Perubahan Modal Kerja'),
            amount: toFiniteNumber(w?.amount, 0),
          }))
        : [],
      netOperatingCashFlow: toFiniteNumber(rawSnap?.indirectCashFlow?.netOperatingCashFlow, 0),
      investingCashFlow: toFiniteNumber(rawSnap?.indirectCashFlow?.investingCashFlow, 0),
      financingCashFlow: toFiniteNumber(rawSnap?.indirectCashFlow?.financingCashFlow, 0),
      netCashChange: toFiniteNumber(rawSnap?.indirectCashFlow?.netCashChange, 0),
      beginningCash: toFiniteNumber(rawSnap?.indirectCashFlow?.beginningCash, 0),
      endingCash: toFiniteNumber(rawSnap?.indirectCashFlow?.endingCash, cashSum),
    },
    collectionEfficiency: Array.isArray(rawSnap.collectionEfficiency)
      ? rawSnap.collectionEfficiency.map((u: any) => ({
          unitName: String(u?.unitName || 'Unit'),
          prevBilling: toFiniteNumber(u?.prevBilling, 0),
          arrearsCollected: toFiniteNumber(u?.arrearsCollected, 0),
          currentCollected: toFiniteNumber(u?.currentCollected, 0),
          totalCollected: toFiniteNumber(u?.totalCollected, 0),
          currentEfficiencyPct: toFiniteNumber(u?.currentEfficiencyPct, 0),
          totalEfficiencyPct: toFiniteNumber(u?.totalEfficiencyPct, 0),
        }))
      : [],
    tariffEffectiveness: Array.isArray(rawSnap.tariffEffectiveness)
      ? rawSnap.tariffEffectiveness.map((t: any) => ({
          tariffCode: String(t?.tariffCode || '-'),
          tariffName: String(t?.tariffName || 'Kelompok'),
          receivableMonth1: toFiniteNumber(t?.receivableMonth1, 0),
          receivableMonth2: toFiniteNumber(t?.receivableMonth2, 0),
          receivableMonth3: toFiniteNumber(t?.receivableMonth3, 0),
          receivableAbove3Months: toFiniteNumber(t?.receivableAbove3Months, 0),
          totalReceivable: toFiniteNumber(t?.totalReceivable, 0),
          collectedAmount: toFiniteNumber(t?.collectedAmount, 0),
          effectivenessPct: toFiniteNumber(t?.effectivenessPct, 0),
        }))
      : [],
    purchaseSummary: Array.isArray(rawSnap.purchaseSummary)
      ? rawSnap.purchaseSummary.map((ps: any) => ({
          category: String(ps?.category || 'Lainnya'),
          requestedMonthly: toFiniteNumber(ps?.requestedMonthly, 0),
          realizedMonthly: toFiniteNumber(ps?.realizedMonthly, 0),
          amountMonthly: toFiniteNumber(ps?.amountMonthly, 0),
          requestedYtd: toFiniteNumber(ps?.requestedYtd, 0),
          realizedYtd: toFiniteNumber(ps?.realizedYtd, 0),
          amountYtd: toFiniteNumber(ps?.amountYtd, 0),
        }))
      : [],
    drdSummary: Array.isArray(rawSnap.drdSummary)
      ? rawSnap.drdSummary.map((d: any) => ({
          tariffGroup: String(d?.tariffGroup || '-'),
          tariffName: String(d?.tariffName || '-'),
          customerCount: toFiniteNumber(d?.customerCount, 0),
          billedSlipsMonthly: toFiniteNumber(d?.billedSlipsMonthly, 0),
          cubicMetersMonthly: toFiniteNumber(d?.cubicMetersMonthly, 0),
          billedAmountMonthly: toFiniteNumber(d?.billedAmountMonthly, 0),
          billedSlipsYtd: toFiniteNumber(d?.billedSlipsYtd, 0),
          cubicMetersYtd: toFiniteNumber(d?.cubicMetersYtd, 0),
          billedAmountYtd: toFiniteNumber(d?.billedAmountYtd, 0),
        }))
      : [],
    assetGroupSummary: Array.isArray(rawSnap.assetGroupSummary)
      ? rawSnap.assetGroupSummary.map((ag: any) => ({
          groupCode: String(ag?.groupCode || '01'),
          groupName: String(ag?.groupName || 'Kelompok Aktiva'),
          acquisitionCost: toFiniteNumber(ag?.acquisitionCost, 0),
          accumDepPrevYear: toFiniteNumber(ag?.accumDepPrevYear, 0),
          depreciationMonthly: toFiniteNumber(ag?.depreciationMonthly, 0),
          depreciationYtd: toFiniteNumber(ag?.depreciationYtd, 0),
          accumDepEnding: toFiniteNumber(ag?.accumDepEnding, 0),
          bookValueEnding: toFiniteNumber(ag?.bookValueEnding, 0),
        }))
      : [],
    productionDistribution: Array.isArray(rawSnap.productionDistribution)
      ? rawSnap.productionDistribution.map((pd: any) => ({
          unitName: String(pd?.unitName || 'Unit'),
          installedCapacityLps: toFiniteNumber(pd?.installedCapacityLps, 0),
          realCapacityLps: toFiniteNumber(pd?.realCapacityLps, 0),
          producedM3Monthly: toFiniteNumber(pd?.producedM3Monthly, 0),
          distributedM3Monthly: toFiniteNumber(pd?.distributedM3Monthly, 0),
          soldM3Monthly: toFiniteNumber(pd?.soldM3Monthly, 0),
          nrwM3Monthly: toFiniteNumber(pd?.nrwM3Monthly, 0),
          nrwPctMonthly: toFiniteNumber(pd?.nrwPctMonthly, 0),
          producedM3Ytd: toFiniteNumber(pd?.producedM3Ytd, 0),
          distributedM3Ytd: toFiniteNumber(pd?.distributedM3Ytd, 0),
          soldM3Ytd: toFiniteNumber(pd?.soldM3Ytd, 0),
          nrwM3Ytd: toFiniteNumber(pd?.nrwM3Ytd, 0),
          nrwPctYtd: toFiniteNumber(pd?.nrwPctYtd, 0),
        }))
      : [],
    customerConnections: Array.isArray(rawSnap.customerConnections)
      ? rawSnap.customerConnections.map((cc: any) => ({
          unitName: String(cc?.unitName || 'Unit'),
          beginningActive: toFiniteNumber(cc?.beginningActive, 0),
          inactiveCount: toFiniteNumber(cc?.inactiveCount, 0),
          disconnectedCount: toFiniteNumber(cc?.disconnectedCount, 0),
          reconnectedCount: toFiniteNumber(cc?.reconnectedCount, 0),
          newConnectionsCount: toFiniteNumber(cc?.newConnectionsCount, 0),
          endingActive: toFiniteNumber(cc?.endingActive, 0),
        }))
      : [],
    employeeComposition: Array.isArray(rawSnap.employeeComposition)
      ? rawSnap.employeeComposition.map((hr: any) => ({
          unitName: String(hr?.unitName || 'Unit'),
          direksiCount: toFiniteNumber(hr?.direksiCount, 0),
          permanentCount: toFiniteNumber(hr?.permanentCount, 0),
          contractCount: toFiniteNumber(hr?.contractCount, 0),
          totalCount: toFiniteNumber(hr?.totalCount, 0),
        }))
      : [],
    notes: rawSnap?.notes
      ? String(rawSnap.notes)
      : `Laporan Manajemen Keuangan & Operasional ${targetMonth} ${targetYear} (Hasil Upload Super User).`,
    updatedBy: actorName,
    updatedAt: now,
    createdAt: now,
  };

  return {
    targetYear,
    targetMonth,
    detectedPeriod: {
      year: detYear || undefined,
      month: detMonth || undefined,
      documentTitle: raw?.detectedPeriod?.documentTitle
        ? String(raw.detectedPeriod.documentTitle)
        : undefined,
      letterNumber: pdamSnapshot.letterNumber,
      discrepancyWarning,
    },
    coaAccounts,
    cashBanks,
    receivablesPayables,
    assets,
    taxes,
    inventory,
    purchases,
    pdamSnapshot,
    parserSource,
    parserNotes: Array.isArray(raw.parserNotes)
      ? raw.parserNotes.map((n: any) => String(n))
      : undefined,
  };
}

export const FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION = `Anda adalah Akuntan Publik & Auditor Senior spesialis BUMD Air Minum (PDAM) Indonesia yang menguasai standar akuntansi SAK EP / Permendagri No. 118 Tahun 2018 serta sistem akun Perumda Air Minum Tirta Saiyo Kabupaten Pasaman.
Tugas Anda: membaca dokumen laporan keuangan bulanan (PDF/Gambar/Excel/CSV) dan mengekstrak seluruh angka keuangan dan operasionalnya secara presisi ke format JSON terstruktur tanpa mengarang atau mengira-ngira angka.

Aturan ketat ekstraksi angka:
1. Angka di Indonesia menggunakan titik sebagai pemisah ribuan dan koma sebagai desimal, atau tanda kurung "(...)" sebagai nilai negatif. Selalu konversi ke angka JSON murni (number).
2. Untuk Laba Rugi:
   - Pendapatan bernilai positif (normalBalance: "Kredit").
   - Beban/Biaya (91.xx, 92.xx, 93.xx, 95.xx, 96.xx, 98.xx) dicatat sebagai angka POSITIF (normalBalance: "Debit") agar mesin akuntansi menghitung Pendapatan - Beban = Laba/(Rugi). Jika perusahaan mengalami RUGI, biarkan beban tetap positif sehingga (Pendapatan - Beban) bernilai negatif!
   - Akun kontra aset seperti Penyisihan Piutang (13.09.xx) dan Akumulasi Penyusutan / Penurunan Nilai Aktiva (31.10.xx) wajib diberi "isContra": true, "normalBalance": "Kredit", dan nilai nominal POSITIF di "openingBalance" & "prevMonthBalance".
   - Akun Laba/(Rugi) Tahun Berjalan (70.09.10) mengikuti tanda sebenarnya: POSITIF jika Laba, NEGATIF jika Rugi!
3. Pastikan Neraca seimbang (Total Aset = Total Kewajiban + Ekuitas).
4. Kembalikan HANYA JSON valid tanpa markdown fences.`;

export function buildFinanceReportParsePrompt(params: {
  targetYear: number;
  targetMonth: string;
  fileName: string;
  spreadsheetText?: string;
}): string {
  const { targetYear, targetMonth, fileName, spreadsheetText } = params;
  return `Ekstrak dokumen laporan keuangan bulanan "${fileName}" agar hasilnya mewakili periode target: ${targetMonth} ${targetYear}.

Kembalikan objek JSON valid persis mengikuti struktur key berikut:
{
  "detectedPeriod": {
    "year": number | null,
    "month": "Januari..Desember" | null,
    "documentTitle": string,
    "letterNumber": string
  },
  "coaAccounts": [
    {
      "code": "11.01.00",
      "name": "Kas Besar",
      "type": "Aset" | "Kewajiban" | "Ekuitas" | "Pendapatan" | "Beban",
      "subCategory": "Aset Lancar" | "Aset Tetap Produktif" | "Akumulasi Penyusutan" | "Kewajiban Lancar" | "Kewajiban Jangka Panjang" | "Ekuitas & Cadangan" | "Laba / (Rugi) Tahun Berjalan" | "Pendapatan Usaha" | "Pendapatan Lain-Lain" | "Beban Langsung Usaha" | "Beban Administrasi & Umum" | "Beban Penyusutan" | "Beban Lain-Lain",
      "normalBalance": "Debit" | "Kredit",
      "cashFlowGroup": "Kas" | "Operasional" | "Investasi" | "Pendanaan" | "Non-Kas",
      "openingBalance": number,
      "prevMonthBalance": number,
      "monthlyRealization": number,
      "ytdRealization": number,
      "budgetMonthly": number,
      "budgetYtd": number,
      "isContra": boolean
    }
  ],
  "cashBanks": [
    {
      "code": "11.01.10",
      "name": "Bank Nagari",
      "accountKind": "KAS_BESAR" | "KAS_KECIL" | "BANK",
      "bankName": string,
      "accountNumber": string,
      "coaCode": "11.01.10",
      "balance": number
    }
  ],
  "receivablesPayables": [
    {
      "kind": "PIUTANG" | "UTANG",
      "documentNumber": string,
      "partyName": string,
      "category": string,
      "coaCode": string,
      "originalAmount": number,
      "paidAmount": number,
      "remainingAmount": number,
      "dueDate": "YYYY-MM-DD"
    }
  ],
  "assets": [
    {
      "assetCode": "31.01.10",
      "name": string,
      "category": string,
      "acquisitionCost": number,
      "accumulatedDepreciation": number,
      "bookValue": number,
      "usefulLifeMonths": number
    }
  ],
  "taxes": [
    {
      "taxType": "PPN" | "PPh 21" | "PPh 22" | "PPh 23" | "PPh Final 4(2)" | "Pajak Air Permukaan" | "Lainnya",
      "withholdingNumber": string,
      "taxObject": string,
      "taxBaseAmount": number,
      "taxRatePct": number,
      "taxAmount": number,
      "status": "Terutang" | "Dibayar" | "Dilaporkan"
    }
  ],
  "inventory": [
    {
      "coaCode": "15.01.30",
      "itemCode": string,
      "name": string,
      "category": "Bahan Kimia" | "Bahan Instalasi Bergerak" | "Bahan Instalasi Tidak Bergerak" | "ATK & Umum",
      "unitMeasure": string,
      "beginningQty": number,
      "inQty": number,
      "outQty": number,
      "endingQty": number,
      "prevMonthValue": number,
      "endingValue": number
    }
  ],
  "purchases": [
    {
      "purchaseNumber": string,
      "purchaseDate": "YYYY-MM-DD",
      "category": "Alat tulis kantor" | "Pipa dan Accessoris" | "Bahan Kimia" | "Belanja Modal" | "Lainnya",
      "itemDescription": string,
      "vendorName": string,
      "requestedQty": number,
      "realizedQty": number,
      "unitMeasure": string,
      "amount": number,
      "status": "Permintaan" | "Realisasi" | "Selesai" | "Dibatalkan"
    }
  ],
  "pdamSnapshot": {
    "letterNumber": string,
    "letterDate": string,
    "directorName": string,
    "kabidKeuName": string,
    "kasubidKeuName": string,
    "summaryMetrics": [{ "code": string, "label": string, "section": "KEUANGAN" | "PRODUKSI_DISTRIBUSI", "unit": string, "monthlyReal": number, "monthlyBudget": number, "ytdReal": number, "ytdBudget": number }],
    "indirectCashFlow": {
      "netIncomeMonthly": number,
      "depreciationAddBack": number,
      "workingCapitalChanges": [{ "label": string, "amount": number }],
      "netOperatingCashFlow": number,
      "investingCashFlow": number,
      "financingCashFlow": number,
      "netCashChange": number,
      "beginningCash": number,
      "endingCash": number
    },
    "collectionEfficiency": [{ "unitName": string, "prevBilling": number, "arrearsCollected": number, "currentCollected": number, "totalCollected": number, "currentEfficiencyPct": number, "totalEfficiencyPct": number }],
    "tariffEffectiveness": [{ "tariffCode": string, "tariffName": string, "receivableMonth1": number, "receivableMonth2": number, "receivableMonth3": number, "receivableAbove3Months": number, "totalReceivable": number, "collectedAmount": number, "effectivenessPct": number }],
    "purchaseSummary": [{ "category": string, "requestedMonthly": number, "realizedMonthly": number, "amountMonthly": number, "requestedYtd": number, "realizedYtd": number, "amountYtd": number }],
    "drdSummary": [{ "tariffGroup": string, "tariffName": string, "customerCount": number, "billedSlipsMonthly": number, "cubicMetersMonthly": number, "billedAmountMonthly": number, "billedSlipsYtd": number, "cubicMetersYtd": number, "billedAmountYtd": number }],
    "assetGroupSummary": [{ "groupCode": string, "groupName": string, "acquisitionCost": number, "accumDepPrevYear": number, "depreciationMonthly": number, "depreciationYtd": number, "accumDepEnding": number, "bookValueEnding": number }],
    "productionDistribution": [{ "unitName": string, "installedCapacityLps": number, "realCapacityLps": number, "producedM3Monthly": number, "distributedM3Monthly": number, "soldM3Monthly": number, "nrwM3Monthly": number, "nrwPctMonthly": number, "producedM3Ytd": number, "distributedM3Ytd": number, "soldM3Ytd": number, "nrwM3Ytd": number, "nrwPctYtd": number }],
    "customerConnections": [{ "unitName": string, "beginningActive": number, "inactiveCount": number, "disconnectedCount": number, "reconnectedCount": number, "newConnectionsCount": number, "endingActive": number }],
    "employeeComposition": [{ "unitName": string, "direksiCount": number, "permanentCount": number, "contractCount": number, "totalCount": number }]
  },
  "parserNotes": [string]
}

Instruksi penting:
- Untuk coaAccounts bagian Neraca (Aset/Kewajiban/Ekuitas): isi "openingBalance" dengan saldo akhir Bulan Ini (periode ${targetMonth} ${targetYear}) dan "prevMonthBalance" dengan saldo Bulan Lalu.
- Untuk coaAccounts bagian Laba Rugi (Pendapatan/Beban): isi "monthlyRealization" dengan realisasi Bulan Ini, "ytdRealization" dan "openingBalance" dengan realisasi s/d Bulan Ini (YTD), serta "budgetMonthly" & "budgetYtd" dengan angka Anggaran jika ada.
- Jika bagian tertentu (mis. DRD/Karyawan) tidak terdapat pada dokumen, kembalikan array kosong [] pada key tersebut — JANGAN mengarang data!
${spreadsheetText ? `\nData tabel/teks dokumen yang diunggah:\n${spreadsheetText}` : ''}`;
}

export function extractJsonFromModelText(rawText: string): Record<string, any> {
  const cleaned = (rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const slice =
    firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
  return JSON.parse(slice);
}

