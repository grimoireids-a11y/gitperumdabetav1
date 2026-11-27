import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

export const MAX_FIN_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export const ALLOWED_SUPER_USER_ROLES = ['KEPALA_SPI', 'ADMIN_SISTEM'] as const;

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

export const ALLOWED_FINANCE_REPORT_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

// ============================================================================
// SELF-CONTAINED NORMALIZER & DIAGNOSTICS (Zero relative imports for ESM/Vercel)
// ============================================================================

const getMonthNumberPadded = (monthName: string): string => {
  const idx = FISCAL_MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === (monthName || '').trim().toLowerCase()
  );
  return String(idx >= 0 ? idx + 1 : 1).padStart(2, '0');
};

const getMonthSlug = (monthName: string): string => {
  const idx = FISCAL_MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === (monthName || '').trim().toLowerCase()
  );
  const clean = (idx >= 0 ? FISCAL_MONTH_NAMES[idx] : monthName || 'Januari')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return clean.slice(0, 3) || 'jan';
};

const getMonthEndDateIso = (year: number, monthName: string): string => {
  const monthIdx = FISCAL_MONTH_NAMES.findIndex(
    (m) => m.toLowerCase() === (monthName || '').trim().toLowerCase()
  );
  const m = monthIdx >= 0 ? monthIdx + 1 : 1;
  const lastDay = new Date(year, m, 0).getDate();
  return `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

const toFiniteNumber = (val: unknown, fallback = 0): number => {
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

const inferCoaType = (rawType: unknown, code: string) => {
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
  return 'Beban';
};

const inferNormalBalance = (rawNormal: unknown, type: string, isContra: boolean) => {
  const n = String(rawNormal || '').trim().toLowerCase();
  if (n === 'debit') return 'Debit';
  if (n === 'kredit' || n === 'credit') return 'Kredit';
  if (type === 'Aset' || type === 'Beban') return isContra ? 'Kredit' : 'Debit';
  return 'Kredit';
};

const inferCashFlowGroup = (rawGroup: unknown, code: string, name: string, type: string) => {
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

const inferSubCategory = (
  rawSub: unknown,
  code: string,
  name: string,
  type: string,
  isContra: boolean
): string => {
  const sub = String(rawSub || '').trim();
  const subLower = sub.toLowerCase();
  const nameLower = name.toLowerCase();

  if (type === 'Aset') {
    if (isContra) {
      if (code.startsWith('13.09') || nameLower.includes('piutang')) {
        return 'Aset Lancar - Penyisihan Piutang';
      }
      return 'Akumulasi Penyusutan';
    }
    if (code.startsWith('11.')) {
      return nameLower.includes('bank') ? 'Aset Lancar - Bank' : 'Aset Lancar - Kas';
    }
    if (code.startsWith('13.') || code.startsWith('14.')) {
      return code.startsWith('14.') ? 'Aset Lancar - Piutang Lain-Lain' : 'Aset Lancar - Piutang Usaha';
    }
    if (code.startsWith('15.')) return 'Aset Lancar - Persediaan';
    if (code.startsWith('16.')) return 'Aset Lancar - Pembayaran Dimuka';
    if (code.startsWith('31.')) return 'Aset Tetap';
    if (subLower.includes('lancar')) return sub;
    if (subLower.includes('tetap')) return 'Aset Tetap';
    return 'Aset Tetap';
  }
  if (type === 'Kewajiban') {
    if (code.startsWith('6') || subLower.includes('panjang')) return 'Kewajiban Jangka Panjang';
    if (code.startsWith('50.06') || nameLower.includes('pajak')) return 'Kewajiban Lancar - Pajak';
    if (subLower.includes('lancar') || subLower.includes('pendek')) return sub;
    return 'Kewajiban Lancar';
  }
  if (type === 'Ekuitas') {
    if (code === '70.09.10' || nameLower.includes('tahun berjalan') || nameLower.includes('periode berjalan')) {
      return 'Ekuitas - Tahun Berjalan';
    }
    if (code === '70.07.10' || nameLower.includes('tahun lalu')) {
      return 'Ekuitas - Laba Ditahan';
    }
    return sub || 'Ekuitas - Modal';
  }
  if (type === 'Pendapatan') {
    if (code.startsWith('88.') || nameLower.includes('lain') || nameLower.includes('giro')) {
      return 'Pendapatan Lain-Lain';
    }
    return sub || 'Pendapatan Usaha';
  }
  if (code.startsWith('91.') || code.startsWith('92.') || code.startsWith('93.') || code.startsWith('95.')) {
    return sub || 'Beban Operasi Langsung';
  }
  if (code.startsWith('98.') || nameLower.includes('lain')) return 'Beban Lain-Lain';
  if (code.startsWith('96.09.') || nameLower.includes('penyusutan')) return 'Beban Penyusutan';
  return sub || 'Beban Administrasi & Umum';
};

const inferInventoryCategory = (rawCat: unknown, coaCode: string): string => {
  const c = String(rawCat || '').toLowerCase();
  if (c.includes('kimia')) return 'Bahan Kimia';
  if (c.includes('tidak bergerak')) return 'Bahan Instalasi Tidak Bergerak';
  if (c.includes('atk') || c.includes('umum')) return 'ATK & Umum';
  if (c.includes('bergerak') || c.includes('instalasi')) return 'Bahan Instalasi Bergerak';
  if (coaCode.startsWith('15.01.30') || coaCode.startsWith('15.01.40')) return 'Bahan Kimia';
  if (coaCode.startsWith('15.03.91')) return 'Bahan Instalasi Tidak Bergerak';
  return 'Bahan Instalasi Bergerak';
};

const inferPurchaseCategory = (rawCat: unknown): string => {
  const c = String(rawCat || '').toLowerCase();
  if (c.includes('alat tulis') || c.includes('atk')) return 'Alat tulis kantor';
  if (c.includes('pipa') || c.includes('access')) return 'Pipa dan Accessoris';
  if (c.includes('kimia')) return 'Bahan Kimia';
  if (c.includes('modal') || c.includes('investasi') || c.includes('aktiva')) return 'Belanja Modal';
  return 'Lainnya';
};

const inferTaxType = (rawType: unknown): string => {
  const t = String(rawType || '').toLowerCase();
  if (t.includes('ppn')) return 'PPN';
  if (t.includes('21')) return 'PPh 21';
  if (t.includes('22')) return 'PPh 22';
  if (t.includes('23')) return 'PPh 23';
  if (t.includes('final') || t.includes('4(2)')) return 'PPh Final 4(2)';
  if (t.includes('permukaan') || t.includes('air baku') || t.includes('abt')) return 'Pajak Air Permukaan';
  return 'Lainnya';
};

interface Diagnostics {
  coaCount: number;
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  neracaDiff: number;
  isBalanced: boolean;
  operatingIncome: number;
  netIncome: number;
  cashBankCount: number;
}

function computeReportAccountingDiagnostics(payload: any): Diagnostics {
  const coa = Array.isArray(payload?.coaAccounts) ? payload.coaAccounts : [];
  let totalAssets = 0;
  let totalLiabilities = 0;
  let totalEquity = 0;
  let opRev = 0;
  let opExp = 0;
  let nonOpRev = 0;
  let nonOpExp = 0;

  coa.forEach((acc: any) => {
    const val = toFiniteNumber(acc.openingBalance, 0);
    if (acc.type === 'Aset') {
      totalAssets += acc.isContra ? -Math.abs(val) : val;
    } else if (acc.type === 'Kewajiban') {
      totalLiabilities += val;
    } else if (acc.type === 'Ekuitas') {
      totalEquity += val;
    } else if (acc.type === 'Pendapatan') {
      const mVal = toFiniteNumber(acc.monthlyRealization || acc.ytdRealization || acc.openingBalance, 0);
      if ((acc.code || '').startsWith('88.')) nonOpRev += mVal;
      else opRev += mVal;
    } else if (acc.type === 'Beban') {
      const mVal = Math.abs(
        toFiniteNumber(acc.monthlyRealization || acc.ytdRealization || acc.openingBalance, 0)
      );
      if ((acc.code || '').startsWith('98.')) nonOpExp += mVal;
      else opExp += mVal;
    }
  });

  const totalLiabilitiesAndEquity = totalLiabilities + totalEquity;
  const neracaDiff = Math.abs(totalAssets - totalLiabilitiesAndEquity);
  const tolerance = Math.max(1000, totalAssets * 0.0005);
  return {
    coaCount: coa.length,
    totalAssets,
    totalLiabilitiesAndEquity,
    neracaDiff,
    isBalanced: coa.length > 0 && totalAssets > 0 && neracaDiff <= tolerance,
    operatingIncome: opRev - opExp,
    netIncome: opRev - opExp + nonOpRev - nonOpExp,
    cashBankCount: Array.isArray(payload?.cashBanks) ? payload.cashBanks.length : 0,
  };
}

function normalizeParsedFinanceReport(params: {
  raw: Record<string, any>;
  targetYear: number;
  targetMonth: string;
  actorName: string;
  parserSource: 'gemini-4-hydrogen' | 'excel-template' | 'manual-review';
}) {
  const { raw, targetYear, targetMonth, actorName, parserSource } = params;
  const mPad = getMonthNumberPadded(targetMonth);
  const mSlug = getMonthSlug(targetMonth);
  const monthEndIso = getMonthEndDateIso(targetYear, targetMonth);
  const now = new Date().toISOString();

  const coaMap = new Map<string, any>();
  const rawCoa = Array.isArray(raw?.coaAccounts) ? raw.coaAccounts : [];
  rawCoa.forEach((item: any, idx: number) => {
    const code = String(item?.code || item?.Kode || `99.99.${idx + 1}`).trim();
    const name = String(item?.name || item?.Nama_Akun || '').trim();
    if (!name) return;

    const nameUpper = name.toUpperCase();
    if (
      (nameUpper.startsWith('JUMLAH ') ||
        nameUpper.startsWith('TOTAL ') ||
        nameUpper.startsWith('SUBTOTAL')) &&
      !/^\d{2}\.\d{2}\.\d{2}$/.test(code)
    ) {
      return;
    }

    const type = inferCoaType(item?.type, code);
    const isContra = inferIsContra(item?.isContra, code, name, String(item?.subCategory || ''));
    const subCategory = inferSubCategory(item?.subCategory, code, name, type, isContra);
    const normalBalance = inferNormalBalance(item?.normalBalance, type, isContra);
    const cashFlowGroup = inferCashFlowGroup(item?.cashFlowGroup, code, name, type);

    let openingBalance = toFiniteNumber(item?.openingBalance ?? item?.balance, 0);
    let prevMonthBalance = toFiniteNumber(item?.prevMonthBalance, 0);
    let monthlyRealization = toFiniteNumber(item?.monthlyRealization, 0);
    let ytdRealization = toFiniteNumber(item?.ytdRealization, 0);

    if (isContra) {
      openingBalance = Math.abs(openingBalance);
      prevMonthBalance = Math.abs(prevMonthBalance);
    }
    if (type === 'Beban') {
      monthlyRealization = Math.abs(monthlyRealization);
      ytdRealization = Math.abs(ytdRealization);
      openingBalance = Math.abs(openingBalance);
    }

    const effectiveOpening =
      type === 'Pendapatan' || type === 'Beban'
        ? openingBalance || ytdRealization || monthlyRealization
        : openingBalance;

    const acc = {
      id: `coa-${targetYear}-${mSlug}-${cleanIdToken(code, String(idx + 1))}`,
      code,
      name,
      type,
      subCategory,
      normalBalance,
      cashFlowGroup,
      openingBalance: effectiveOpening,
      prevMonthBalance,
      monthlyRealization,
      ytdRealization: ytdRealization || effectiveOpening,
      budgetMonthly: toFiniteNumber(item?.budgetMonthly, 0),
      budgetYtd: toFiniteNumber(item?.budgetYtd, 0),
      isContra,
      year: targetYear,
      month: targetMonth,
      isActive: true,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    };
    coaMap.set(code, acc);
  });
  const coaAccounts = Array.from(coaMap.values());

  const cashBankMap = new Map<string, any>();
  const rawCb = Array.isArray(raw?.cashBanks) ? raw.cashBanks : [];
  rawCb.forEach((cb: any, idx: number) => {
    const name = String(cb?.name || '').trim();
    if (!name) return;
    const code = String(cb?.code || cb?.coaCode || `11.01.${10 + idx}`).trim();
    const rawKind = String(cb?.accountKind || '').toUpperCase();
    let accountKind = 'BANK';
    if (rawKind === 'KAS_BESAR' || name.toLowerCase().includes('kas besar')) accountKind = 'KAS_BESAR';
    else if (rawKind === 'KAS_KECIL' || name.toLowerCase().includes('kas kecil')) accountKind = 'KAS_KECIL';

    cashBankMap.set(code + '|' + name.toLowerCase(), {
      id: `cb-${targetYear}-${mSlug}-${cleanIdToken(code, String(idx + 1))}`,
      code,
      name,
      accountKind,
      bankName: cb?.bankName ? String(cb.bankName) : undefined,
      accountNumber: cb?.accountNumber ? String(cb.accountNumber) : undefined,
      coaCode: String(cb?.coaCode || code),
      openingBalance: toFiniteNumber(cb?.balance ?? cb?.openingBalance, 0),
      year: targetYear,
      month: targetMonth,
      isActive: true,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    });
  });

  if (cashBankMap.size === 0) {
    coaAccounts
      .filter((c) => c.code.startsWith('11.'))
      .forEach((c, idx) => {
        const nameLower = c.name.toLowerCase();
        const accountKind = nameLower.includes('kas besar')
          ? 'KAS_BESAR'
          : nameLower.includes('kas kecil')
          ? 'KAS_KECIL'
          : 'BANK';
        cashBankMap.set(c.code, {
          id: `cb-${targetYear}-${mSlug}-${cleanIdToken(c.code, String(idx + 1))}`,
          code: c.code,
          name: c.name,
          accountKind,
          bankName: accountKind === 'BANK' ? c.name : undefined,
          coaCode: c.code,
          openingBalance: c.openingBalance,
          year: targetYear,
          month: targetMonth,
          isActive: true,
          createdBy: actorName,
          createdAt: now,
          updatedAt: now,
        });
      });
  }
  const cashBanks = Array.from(cashBankMap.values());

  const receivablesPayables = (Array.isArray(raw?.receivablesPayables) ? raw.receivablesPayables : [])
    .filter((r: any) => String(r?.partyName || '').trim())
    .map((r: any, idx: number) => {
      const kind = String(r?.kind || '').toUpperCase().includes('UTANG') ? 'UTANG' : 'PIUTANG';
      const orig = Math.abs(toFiniteNumber(r?.originalAmount ?? r?.remainingAmount, 0));
      const paid = Math.abs(toFiniteNumber(r?.paidAmount, 0));
      const rem = toFiniteNumber(r?.remainingAmount, Math.max(0, orig - paid));
      return {
        id: `rp-${targetYear}-${mSlug}-${idx + 1}`,
        kind,
        year: targetYear,
        month: targetMonth,
        documentNumber: String(
          r?.documentNumber || `${kind === 'PIUTANG' ? 'PIU' : 'UTG'}-${targetYear}-${mPad}-${idx + 1}`
        ),
        partyName: String(r.partyName).trim(),
        category: String(r?.category || (kind === 'PIUTANG' ? 'Piutang Usaha' : 'Utang Usaha')),
        coaCode: String(r?.coaCode || (kind === 'PIUTANG' ? '13.01.10' : '50.01.10')),
        originalAmount: orig || rem,
        paidAmount: paid,
        remainingAmount: rem,
        dueDate: String(r?.dueDate || monthEndIso).slice(0, 10),
        unitId: '',
        unitName: String(r?.unitName || 'Konsolidasi PDAM'),
        status: rem <= 0 ? 'Lunas' : paid > 0 ? 'Sebagian' : 'Belum Lunas',
        notes: `Hasil ekstraksi ${targetMonth} ${targetYear}`,
        createdBy: actorName,
        createdAt: now,
        updatedAt: now,
      };
    });

  const assets = (Array.isArray(raw?.assets) ? raw.assets : [])
    .filter((a: any) => String(a?.name || '').trim())
    .map((a: any, idx: number) => {
      const cost = Math.abs(toFiniteNumber(a?.acquisitionCost, 0));
      const accDep = Math.abs(toFiniteNumber(a?.accumulatedDepreciation, 0));
      const book = toFiniteNumber(a?.bookValue, Math.max(0, cost - accDep));
      const assetCode = String(a?.assetCode || `31.01.${String(idx + 1).padStart(2, '0')}`);
      return {
        id: `ast-${targetYear}-${mSlug}-${cleanIdToken(assetCode, String(idx + 1))}`,
        assetCode,
        name: String(a.name).trim(),
        category: String(a?.category || 'Aktiva Tetap Produktif'),
        unitId: '',
        unitName: String(a?.unitName || 'Konsolidasi PDAM'),
        acquisitionDate: `${targetYear}-${mPad}-01`,
        acquisitionCost: cost,
        usefulLifeMonths: Math.max(1, toFiniteNumber(a?.usefulLifeMonths, 120)),
        accumulatedDepreciation: accDep,
        bookValue: book,
        coaAssetCode: assetCode,
        coaDepExpCode: '91.09.10',
        coaAccumDepCode: '31.10.10',
        status: 'Aktif',
        year: targetYear,
        month: targetMonth,
        notes: `Ekstraksi laporan ${targetMonth} ${targetYear}`,
        createdBy: actorName,
        createdAt: now,
        updatedAt: now,
      };
    });

  const taxes = (Array.isArray(raw?.taxes) ? raw.taxes : [])
    .filter((t: any) => String(t?.taxObject || t?.taxType || '').trim())
    .map((t: any, idx: number) => ({
      id: `tax-${targetYear}-${mSlug}-${idx + 1}`,
      taxType: inferTaxType(t?.taxType || t?.taxObject),
      year: targetYear,
      month: targetMonth,
      withholdingNumber: String(t?.withholdingNumber || `TAX-${targetYear}-${mPad}-${idx + 1}`),
      taxObject: String(t?.taxObject || t?.taxType || 'Kewajiban Pajak'),
      taxBaseAmount: Math.abs(toFiniteNumber(t?.taxBaseAmount, 0)),
      taxRatePct: Math.abs(toFiniteNumber(t?.taxRatePct, 0)),
      taxAmount: Math.abs(toFiniteNumber(t?.taxAmount, 0)),
      status:
        t?.status === 'Dibayar' || t?.status === 'Dilaporkan' ? t.status : 'Terutang',
      dueDate: monthEndIso,
      unitId: '',
      unitName: 'Bidang Umum dan Keuangan',
      notes: `Ekstraksi pajak ${targetMonth} ${targetYear}`,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    }));

  const inventory = (Array.isArray(raw?.inventory) ? raw.inventory : [])
    .filter((i: any) => String(i?.name || '').trim())
    .map((i: any, idx: number) => {
      const coaCode = String(i?.coaCode || '15.01.20');
      const endVal = toFiniteNumber(i?.endingValue, 0);
      const endQty = Math.max(0, toFiniteNumber(i?.endingQty, 1));
      return {
        id: `inv-${targetYear}-${mSlug}-${idx + 1}`,
        coaCode,
        itemCode: String(i?.itemCode || `INV-${mPad}-${idx + 1}`),
        name: String(i.name).trim(),
        category: inferInventoryCategory(i?.category, coaCode),
        year: targetYear,
        month: targetMonth,
        unitMeasure: String(i?.unitMeasure || 'Unit'),
        unitId: '',
        unitName: 'Gudang Kantor Pusat & Unit',
        beginningQty: Math.max(0, toFiniteNumber(i?.beginningQty, 0)),
        inQty: Math.max(0, toFiniteNumber(i?.inQty, 0)),
        outQty: Math.max(0, toFiniteNumber(i?.outQty, 0)),
        endingQty: endQty,
        unitCost: endQty > 0 ? Math.round(endVal / endQty) : endVal,
        prevMonthValue: toFiniteNumber(i?.prevMonthValue, 0),
        endingValue: endVal,
        minStockQty: 1,
        notes: `Ekstraksi persediaan ${targetMonth} ${targetYear}`,
        updatedBy: actorName,
        updatedAt: now,
        createdAt: now,
      };
    });

  const purchases = (Array.isArray(raw?.purchases) ? raw.purchases : [])
    .filter((p: any) => String(p?.itemDescription || p?.category || '').trim())
    .map((p: any, idx: number) => ({
      id: `pur-${targetYear}-${mSlug}-${idx + 1}`,
      purchaseNumber: String(p?.purchaseNumber || `PO-${targetYear}-${mPad}-${idx + 1}`),
      purchaseDate: String(p?.purchaseDate || monthEndIso).slice(0, 10),
      year: targetYear,
      month: targetMonth,
      category: inferPurchaseCategory(p?.category),
      itemDescription: String(p?.itemDescription || p?.category || 'Pembelian Operasional'),
      vendorName: String(p?.vendorName || 'Rekanan PDAM'),
      requestedQty: Math.max(1, toFiniteNumber(p?.requestedQty, 1)),
      realizedQty: Math.max(0, toFiniteNumber(p?.realizedQty, 1)),
      unitMeasure: String(p?.unitMeasure || 'Paket'),
      amount: Math.abs(toFiniteNumber(p?.amount, 0)),
      unitId: '',
      unitName: 'Kantor Pusat & Bagian Teknik',
      coaCode: '93.01.20',
      status: ['Permintaan', 'Realisasi', 'Selesai', 'Dibatalkan'].includes(p?.status)
        ? p.status
        : 'Selesai',
      notes: `Ekstraksi pembelian ${targetMonth} ${targetYear}`,
      createdBy: actorName,
      createdAt: now,
      updatedAt: now,
    }));

  const detYear = toFiniteNumber(raw?.detectedPeriod?.year, 0);
  const detMonthRaw = String(raw?.detectedPeriod?.month || '').trim();
  const detMonthMatched = FISCAL_MONTH_NAMES.find(
    (m) => m.toLowerCase() === detMonthRaw.toLowerCase()
  );
  const detMonth = detMonthMatched || detMonthRaw || undefined;

  let discrepancyWarning: string | undefined;
  if (
    (detYear > 0 && detYear !== targetYear) ||
    (detMonthMatched && detMonthMatched.toLowerCase() !== targetMonth.toLowerCase())
  ) {
    discrepancyWarning = `Dokumen terbaca sebagai periode ${detMonth || '?'} ${
      detYear || '?'
    }, tetapi saat ini Anda memilih target upload ${targetMonth} ${targetYear}. Periksa pilihan bulan sebelum menerapkan.`;
  }

  const rawSnap = raw?.pdamSnapshot || {};
  const cashSum = cashBanks.reduce((s: number, c: any) => s + toFiniteNumber(c.openingBalance, 0), 0);
  const pdamSnapshot = {
    id: `pdam-${targetYear}-${targetMonth}`,
    year: targetYear,
    month: targetMonth,
    letterNumber: String(
      rawSnap?.letterNumber || raw?.detectedPeriod?.letterNumber || `Um. 01.01/P-Tirta Saiyo/Pas/ -${targetYear}`
    ),
    letterDate: String(rawSnap?.letterDate || `Lubuk Sikaping, ${targetMonth} ${targetYear}`),
    directorName: String(rawSnap?.directorName || 'DEDDY EKA PUTRA, SE'),
    kabidKeuName: String(rawSnap?.kabidKeuName || 'NGADI'),
    kasubidKeuName: String(rawSnap?.kasubidKeuName || 'MURNIATI, SE'),
    summaryMetrics: Array.isArray(rawSnap.summaryMetrics) ? rawSnap.summaryMetrics : [],
    indirectCashFlow: {
      netIncomeMonthly: toFiniteNumber(rawSnap?.indirectCashFlow?.netIncomeMonthly, 0),
      depreciationAddBack: toFiniteNumber(rawSnap?.indirectCashFlow?.depreciationAddBack, 0),
      workingCapitalChanges: Array.isArray(rawSnap?.indirectCashFlow?.workingCapitalChanges)
        ? rawSnap.indirectCashFlow.workingCapitalChanges
        : [],
      netOperatingCashFlow: toFiniteNumber(rawSnap?.indirectCashFlow?.netOperatingCashFlow, 0),
      investingCashFlow: toFiniteNumber(rawSnap?.indirectCashFlow?.investingCashFlow, 0),
      financingCashFlow: toFiniteNumber(rawSnap?.indirectCashFlow?.financingCashFlow, 0),
      netCashChange: toFiniteNumber(rawSnap?.indirectCashFlow?.netCashChange, 0),
      beginningCash: toFiniteNumber(rawSnap?.indirectCashFlow?.beginningCash, 0),
      endingCash: toFiniteNumber(rawSnap?.indirectCashFlow?.endingCash, cashSum),
    },
    collectionEfficiency: Array.isArray(rawSnap.collectionEfficiency) ? rawSnap.collectionEfficiency : [],
    tariffEffectiveness: Array.isArray(rawSnap.tariffEffectiveness) ? rawSnap.tariffEffectiveness : [],
    purchaseSummary: Array.isArray(rawSnap.purchaseSummary) ? rawSnap.purchaseSummary : [],
    drdSummary: Array.isArray(rawSnap.drdSummary) ? rawSnap.drdSummary : [],
    assetGroupSummary: Array.isArray(rawSnap.assetGroupSummary) ? rawSnap.assetGroupSummary : [],
    productionDistribution: Array.isArray(rawSnap.productionDistribution)
      ? rawSnap.productionDistribution
      : [],
    customerConnections: Array.isArray(rawSnap.customerConnections) ? rawSnap.customerConnections : [],
    employeeComposition: Array.isArray(rawSnap.employeeComposition) ? rawSnap.employeeComposition : [],
    notes: rawSnap?.notes
      ? String(rawSnap.notes)
      : `Laporan Manajemen Keuangan & Operasional ${targetMonth} ${targetYear} (Hasil Upload Super User).`,
    updatedBy: actorName,
    updatedAt: now,
    createdAt: now,
  };

  // Auto-enrich sparse sub-modules from COA / Asset Group Summary
  if (receivablesPayables.length === 0) {
    coaAccounts
      .filter(
        (c) =>
          (c.code.startsWith('13.01') ||
            c.code.startsWith('13.02') ||
            c.code.startsWith('14.') ||
            c.code.startsWith('50.01') ||
            c.code.startsWith('50.02') ||
            c.code.startsWith('50.03') ||
            c.code.startsWith('62.')) &&
          !c.isContra &&
          Math.abs(c.openingBalance) > 0
      )
      .forEach((c, idx) => {
        const isPiutang = c.type === 'Aset';
        const kind = isPiutang ? 'PIUTANG' : 'UTANG';
        receivablesPayables.push({
          id: `rp-${targetYear}-${mSlug}-${cleanIdToken(c.code, String(idx + 1))}`,
          kind,
          year: targetYear,
          month: targetMonth,
          documentNumber: `${isPiutang ? 'PIU' : 'UTG'}-${targetYear}-${mPad}-${cleanIdToken(
            c.code,
            String(idx + 1)
          )}`,
          partyName: c.name,
          category: isPiutang
            ? c.code.startsWith('14.')
              ? 'Piutang Lain-Lain'
              : 'Piutang Usaha'
            : c.code.startsWith('62.')
            ? 'Kewajiban Jangka Panjang'
            : 'Utang Usaha',
          coaCode: c.code,
          originalAmount: Math.abs(c.openingBalance),
          paidAmount: 0,
          remainingAmount: Math.abs(c.openingBalance),
          dueDate: monthEndIso,
          unitId: '',
          unitName: 'Konsolidasi PDAM',
          status: 'Belum Lunas',
          notes: `Diturunkan otomatis dari Neraca COA ${c.code} (${targetMonth} ${targetYear})`,
          createdBy: actorName,
          createdAt: now,
          updatedAt: now,
        });
      });
  }

  if (assets.length === 0 && pdamSnapshot.assetGroupSummary.length > 0) {
    pdamSnapshot.assetGroupSummary.forEach((ag: any, idx: number) => {
      if (Math.abs(ag.acquisitionCost) <= 0 && Math.abs(ag.bookValueEnding) <= 0) return;
      const assetCode = `31.${String(ag.groupCode || idx + 1).padStart(2, '0')}.00`;
      assets.push({
        id: `ast-${targetYear}-${mSlug}-${cleanIdToken(assetCode, String(idx + 1))}`,
        assetCode,
        name: ag.groupName,
        category: ag.groupName,
        unitId: '',
        unitName: 'Konsolidasi PDAM',
        acquisitionDate: `${targetYear}-${mPad}-01`,
        acquisitionCost: Math.abs(ag.acquisitionCost),
        usefulLifeMonths: 120,
        accumulatedDepreciation: Math.abs(ag.accumDepEnding),
        bookValue: Math.max(0, ag.bookValueEnding || ag.acquisitionCost - ag.accumDepEnding),
        coaAssetCode: assetCode,
        coaDepExpCode: '91.09.10',
        coaAccumDepCode: '31.10.10',
        status: 'Aktif',
        year: targetYear,
        month: targetMonth,
        notes: `Diturunkan otomatis dari Rekap Aktiva Tetap (${targetMonth} ${targetYear})`,
        createdBy: actorName,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  if (inventory.length === 0) {
    coaAccounts
      .filter((c) => c.code.startsWith('15.') && Math.abs(c.openingBalance) > 0)
      .forEach((c, idx) => {
        inventory.push({
          id: `inv-${targetYear}-${mSlug}-${cleanIdToken(c.code, String(idx + 1))}`,
          coaCode: c.code,
          itemCode: `INV-${mPad}-${cleanIdToken(c.code, String(idx + 1))}`,
          name: c.name,
          category: inferInventoryCategory('', c.code),
          year: targetYear,
          month: targetMonth,
          unitMeasure: 'Paket / Nilai',
          unitId: '',
          unitName: 'Gudang Kantor Pusat & Unit',
          beginningQty: 1,
          inQty: 0,
          outQty: 0,
          endingQty: 1,
          unitCost: c.openingBalance,
          prevMonthValue: c.prevMonthBalance || c.openingBalance,
          endingValue: c.openingBalance,
          minStockQty: 1,
          notes: `Diturunkan otomatis dari Neraca COA ${c.code} (${targetMonth} ${targetYear})`,
          updatedBy: actorName,
          updatedAt: now,
          createdAt: now,
        });
      });
  }

  if (taxes.length === 0) {
    coaAccounts
      .filter(
        (c) =>
          (c.code.startsWith('50.06') || c.code === '96.08.71') &&
          Math.abs(c.openingBalance || c.monthlyRealization || 0) > 0
      )
      .forEach((c, idx) => {
        const amt = Math.abs(c.openingBalance || c.monthlyRealization || 0);
        taxes.push({
          id: `tax-${targetYear}-${mSlug}-${cleanIdToken(c.code, String(idx + 1))}`,
          taxType: inferTaxType(c.name),
          year: targetYear,
          month: targetMonth,
          withholdingNumber: `TAX-${targetYear}-${mPad}-${cleanIdToken(c.code, String(idx + 1))}`,
          taxObject: c.name,
          taxBaseAmount: amt,
          taxRatePct: 0,
          taxAmount: amt,
          status: c.type === 'Beban' ? 'Dibayar' : 'Terutang',
          dueDate: monthEndIso,
          unitId: '',
          unitName: 'Bidang Umum dan Keuangan',
          notes: `Diturunkan otomatis dari COA ${c.code} (${targetMonth} ${targetYear})`,
          createdBy: actorName,
          createdAt: now,
          updatedAt: now,
        });
      });
  }

  const basePayload = {
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
    parserNotes: Array.isArray(raw?.parserNotes) ? raw.parserNotes.map((n: any) => String(n)) : [],
  };

  const diag = computeReportAccountingDiagnostics(basePayload);
  const autoNotes: string[] = [...basePayload.parserNotes];
  if (diag.coaCount > 0) {
    autoNotes.push(
      `[Verifikasi Akuntansi] ${diag.coaCount} akun COA diekstrak · Total Aset: Rp ${Math.round(
        diag.totalAssets
      ).toLocaleString('id-ID')} · Kewajiban+Ekuitas: Rp ${Math.round(
        diag.totalLiabilitiesAndEquity
      ).toLocaleString('id-ID')} (${
        diag.isBalanced
          ? 'SEIMBANG'
          : `Selisih Rp ${Math.round(diag.neracaDiff).toLocaleString('id-ID')}`
      }).`
    );
  }
  basePayload.parserNotes = autoNotes;
  return basePayload;
}

const FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION = `Anda adalah Akuntan Publik & Auditor Senior spesialis BUMD Air Minum (PDAM) Indonesia yang menguasai SAK EP, Permendagri No. 118 Tahun 2018, serta struktur lengkap Laporan Manajemen Keuangan & Operasional Perumda Air Minum Tirta Saiyo Kabupaten Pasaman.

Tugas utama Anda: membaca SELURUH halaman dokumen laporan keuangan bulanan (PDF, gambar scan, atau Excel/CSV) dan mengekstrak setiap akun, saldo, realisasi, anggaran, kas/bank, utang/piutang, aktiva tetap, pajak, persediaan, pembelian, serta tabel operasional PDAM secara 100% akurat tanpa mengarang angka.

Standar pemetaan kode COA resmi Perumda Air Minum Tirta Saiyo:
- 11.xx: Kas & Bank (Aset Lancar, normalBalance: "Debit", cashFlowGroup: "Kas")
- 13.01.xx - 14.xx: Piutang Air & Piutang Lain-Lain (Aset Lancar, normalBalance: "Debit")
- 13.09.xx: Akumulasi Penyisihan Piutang (Aset Lancar, isContra: true, normalBalance: "Kredit", openingBalance & prevMonthBalance bernilai POSITIF!)
- 15.xx: Persediaan Kimia, ATK & Bahan Instalasi (Aset Lancar, normalBalance: "Debit")
- 16.xx: Pembayaran Dimuka (Aset Lancar, normalBalance: "Debit")
- 31.01.xx - 31.09.xx: Aktiva Tetap Produktif & Tanah (Aset Tetap, subCategory: "Aset Tetap", normalBalance: "Debit")
- 31.10.xx: Akumulasi Penyusutan / Penurunan Nilai Aktiva (Aset, subCategory: "Akumulasi Penyusutan", isContra: true, normalBalance: "Kredit", openingBalance & prevMonthBalance bernilai POSITIF!)
- 50.xx: Kewajiban Jangka Pendek / Utang Usaha / Utang Pajak / Titipan (Kewajiban Lancar, normalBalance: "Kredit")
- 62.xx: Kewajiban Jangka Panjang (Kewajiban Jangka Panjang, normalBalance: "Kredit")
- 70.01 - 70.07: Penyertaan Modal, Modal Hibah & Akumulasi Laba/Rugi Tahun Lalu (Ekuitas, normalBalance: "Kredit"; gunakan angka NEGATIF jika Akumulasi Kerugian!)
- 70.09.10: Laba / (Rugi) Tahun Berjalan (Ekuitas, subCategory: "Ekuitas - Tahun Berjalan", normalBalance: "Kredit"; gunakan POSITIF jika Laba atau NEGATIF jika Rugi!)
- 81.xx: Pendapatan Usaha (Pendapatan, normalBalance: "Kredit")
- 88.xx: Pendapatan Lain-Lain (Pendapatan, normalBalance: "Kredit")
- 91.xx - 95.xx: Biaya Langsung Usaha (Beban, normalBalance: "Debit", angka POSITIF!)
- 96.xx: Biaya Administrasi & Umum (Beban, normalBalance: "Debit", angka POSITIF!)
- 98.xx: Biaya Lain-Lain (Beban, normalBalance: "Debit", angka POSITIF!)

Aturan wajib ketelitian:
1. Konversi format angka Indonesia ("1.421.209.027,40" -> 1421209027.4) dan tanda kurung "(...)" sebagai angka negatif pada Ekuitas/Arus Kas.
2. Pada Beban (91-98), SELALU tulis nominal POSITIF.
3. JANGAN masukkan baris TOTAL/SUBTOTAL ke dalam coaAccounts — hanya akun detail individual yang memiliki kode rekening!
4. Cek keseimbangan Neraca: Total Aset Netto HARUS sama dengan Total Kewajiban + Total Ekuitas (termasuk 70.09.10).
5. Ekstrak tabel pendukung (cashBanks, receivablesPayables, assets, taxes, inventory, purchases, dan pdamSnapshot lengkap).
6. Kembalikan HANYA JSON valid tanpa markdown fences.`;

function buildFinanceReportParsePrompt(params: {
  targetYear: number;
  targetMonth: string;
  fileName: string;
  spreadsheetText?: string;
}): string {
  const { targetYear, targetMonth, fileName, spreadsheetText } = params;
  return `Ekstrak dokumen laporan keuangan bulanan "${fileName}" secara lengkap untuk periode target: ${targetMonth} ${targetYear}.

Kembalikan objek JSON valid dengan key persis:
{
  "detectedPeriod": { "year": number | null, "month": "Januari..Desember" | null, "documentTitle": string, "letterNumber": string },
  "coaAccounts": [{ "code": string, "name": string, "type": "Aset" | "Kewajiban" | "Ekuitas" | "Pendapatan" | "Beban", "subCategory": string, "normalBalance": "Debit" | "Kredit", "cashFlowGroup": "Kas" | "Operasional" | "Investasi" | "Pendanaan" | "Non-Kas", "openingBalance": number, "prevMonthBalance": number, "monthlyRealization": number, "ytdRealization": number, "budgetMonthly": number, "budgetYtd": number, "isContra": boolean }],
  "cashBanks": [{ "code": string, "name": string, "accountKind": "KAS_BESAR" | "KAS_KECIL" | "BANK", "bankName": string, "accountNumber": string, "coaCode": string, "balance": number }],
  "receivablesPayables": [{ "kind": "PIUTANG" | "UTANG", "documentNumber": string, "partyName": string, "category": string, "coaCode": string, "originalAmount": number, "paidAmount": number, "remainingAmount": number, "dueDate": "YYYY-MM-DD" }],
  "assets": [{ "assetCode": string, "name": string, "category": string, "acquisitionCost": number, "accumulatedDepreciation": number, "bookValue": number, "usefulLifeMonths": number }],
  "taxes": [{ "taxType": "PPN" | "PPh 21" | "PPh 22" | "PPh 23" | "PPh Final 4(2)" | "Pajak Air Permukaan" | "Lainnya", "withholdingNumber": string, "taxObject": string, "taxBaseAmount": number, "taxRatePct": number, "taxAmount": number, "status": "Terutang" | "Dibayar" | "Dilaporkan" }],
  "inventory": [{ "coaCode": string, "itemCode": string, "name": string, "category": "Bahan Kimia" | "Bahan Instalasi Bergerak" | "Bahan Instalasi Tidak Bergerak" | "ATK & Umum", "unitMeasure": string, "beginningQty": number, "inQty": number, "outQty": number, "endingQty": number, "prevMonthValue": number, "endingValue": number }],
  "purchases": [{ "purchaseNumber": string, "purchaseDate": "YYYY-MM-DD", "category": "Alat tulis kantor" | "Pipa dan Accessoris" | "Bahan Kimia" | "Belanja Modal" | "Lainnya", "itemDescription": string, "vendorName": string, "requestedQty": number, "realizedQty": number, "unitMeasure": string, "amount": number, "status": "Permintaan" | "Realisasi" | "Selesai" | "Dibatalkan" }],
  "pdamSnapshot": {
    "letterNumber": string, "letterDate": string, "directorName": string, "kabidKeuName": string, "kasubidKeuName": string,
    "summaryMetrics": [{ "code": string, "label": string, "section": "KEUANGAN" | "PRODUKSI_DISTRIBUSI", "unit": string, "monthlyReal": number, "monthlyBudget": number, "ytdReal": number, "ytdBudget": number }],
    "indirectCashFlow": { "netIncomeMonthly": number, "depreciationAddBack": number, "workingCapitalChanges": [{ "label": string, "amount": number }], "netOperatingCashFlow": number, "investingCashFlow": number, "financingCashFlow": number, "netCashChange": number, "beginningCash": number, "endingCash": number },
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

Catatan penting:
- Neraca: openingBalance = saldo akhir Bulan Ini (${targetMonth} ${targetYear}), prevMonthBalance = saldo Bulan Lalu.
- Laba Rugi: monthlyRealization = realisasi Bulan Ini, ytdRealization & openingBalance = realisasi s/d Bulan Ini.
- Jika suatu sub-bagian tidak ada di dokumen, kembalikan array kosong [].
${spreadsheetText ? `\nData tabel dokumen:\n${spreadsheetText}` : ''}`;
}

function buildFinanceReportVerificationPrompt(params: {
  targetYear: number;
  targetMonth: string;
  fileName: string;
  previousRawJson: Record<string, any>;
  diagnostics: Diagnostics;
  spreadsheetText?: string;
}): string {
  const { targetYear, targetMonth, fileName, previousRawJson, diagnostics, spreadsheetText } = params;
  return `AUDIT & KOREKSI EKSTRAKSI LAPORAN KEUANGAN:
Anda mengekstrak "${fileName}" (${targetMonth} ${targetYear}), namun audit internal mendeteksi ketidakcocokan:
- Akun COA terekstrak: ${diagnostics.coaCount}
- Total Aset: Rp ${Math.round(diagnostics.totalAssets).toLocaleString('id-ID')}
- Total Kewajiban + Ekuitas: Rp ${Math.round(diagnostics.totalLiabilitiesAndEquity).toLocaleString('id-ID')}
- Selisih Neraca: Rp ${Math.round(diagnostics.neracaDiff).toLocaleString('id-ID')}

Periksa ulang seluruh halaman dokumen asli, lengkapi akun yang terlewat, pastikan tidak ada baris subtotal/total masuk ke coaAccounts, cek tanda negatif 70.07.10 & 70.09.10 serta isContra: true untuk 13.09.xx & 31.10.xx hingga Neraca SEIMBANG.

JSON awal untuk dikoreksi:
${JSON.stringify(previousRawJson).slice(0, 60_000)}
${spreadsheetText ? `\nData tabel:\n${spreadsheetText.slice(0, 100_000)}` : ''}

Kembalikan HANYA JSON final lengkap.`;
}

function extractJsonFromModelText(rawText: string): Record<string, any> {
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

// ============================================================================
// ENCRYPTED STATELESS SESSION TOKEN FOR CHUNKED RESUMABLE UPLOAD (UP TO 50 MB)
// ============================================================================

function deriveTokenKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(`pdam-fin-upload:${secret}`).digest();
}

function encryptUploadUrl(uploadUrl: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveTokenKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(uploadUrl, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptUploadUrl(token: string, secret: string): string {
  const raw = Buffer.from(token, 'base64url');
  if (raw.length < 29) {
    throw new Error('Token sesi unggahan tidak valid.');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveTokenKey(secret), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  if (!decrypted.startsWith('https://generativelanguage.googleapis.com/upload/')) {
    throw new Error('URL sesi unggahan tidak valid.');
  }
  return decrypted;
}

function isTransientAiError(err: any): boolean {
  const status = Number(err?.status || err?.code || err?.response?.status || 0);
  if (status === 429 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('unavailable') ||
    msg.includes('resource_exhausted') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('try again later') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('fetch failed')
  );
}

function parseReadableAiError(err: any): { status: number; message: string } {
  const rawMsg = String(err?.message || err || '').trim();
  if (isTransientAiError(err)) {
    return {
      status: 503,
      message:
        'Server AI sedang mengalami lonjakan trafik sementara (503). Silakan klik Baca Otomatis kembali dalam beberapa detik.',
    };
  }
  const low = rawMsg.toLowerCase();
  if (low.includes('api key') || low.includes('permission_denied') || low.includes('403')) {
    return {
      status: 503,
      message:
        'Kunci akses layanan AI tidak valid atau belum diaktifkan pada server.',
    };
  }
  if (low.includes('token sesi unggahan')) {
    return { status: 400, message: rawMsg };
  }
  if (low.includes('waktu pembacaan ai habis') || low.includes('timeout')) {
    return {
      status: 504,
      message: rawMsg,
    };
  }
  return {
    status: 500,
    message: rawMsg || 'Gagal memproses dokumen laporan keuangan secara otomatis.',
  };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 1
): Promise<Response> {
  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function callGeminiWithRetryAndFallback(params: {
  aiClient: GoogleGenAI;
  contents: any[];
  systemInstruction: string;
}): Promise<{ response: any; modelUsed: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite'; usedFallbackModel: boolean }> {
  const { aiClient, contents, systemInstruction } = params;

  const runWithTimeout = async (
    model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite',
    timeoutMs: number,
    useThinking: boolean
  ) => {
    const config: any = {
      systemInstruction,
      responseMimeType: 'application/json',
    };
    if (useThinking) {
      config.thinkingConfig = { thinkingLevel: ThinkingLevel.MEDIUM };
    }
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'Waktu pembacaan AI habis (>70 detik). Jika PDF hasil scan sangat besar, silakan coba lagi.'
            )
          ),
        timeoutMs
      )
    );
    const geminiPromise = aiClient.models.generateContent({
      model,
      contents,
      config,
    });
    return Promise.race([geminiPromise, timeoutPromise]);
  };

  let lastErr: any;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await runWithTimeout('gemini-4-hydrogen', 70_000, true);
      return { response, modelUsed: 'gemini-4-hydrogen', usedFallbackModel: false };
    } catch (err: any) {
      lastErr = err;
      if (isTransientAiError(err) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (isTransientAiError(err)) {
        break;
      }
      throw err;
    }
  }

  // Fallback to free fast multimodal model gemini-3.1-flash-lite without thinkingConfig
  try {
    const fallbackRes = await runWithTimeout('gemini-3.1-flash-lite', 65_000, false);
    return { response: fallbackRes, modelUsed: 'gemini-3.1-flash-lite', usedFallbackModel: true };
  } catch (fallbackErr: any) {
    throw fallbackErr || lastErr;
  }
}

export interface FinanceParseRouteResult {
  status: number;
  json: Record<string, any>;
}

export async function handleParseFinanceReportAction(
  body: any,
  aiClient?: GoogleGenAI
): Promise<FinanceParseRouteResult> {
  let uploadedGeminiFileNameToDelete: string | null = null;
  let activeAiClient: GoogleGenAI | null = aiClient || null;

  try {
    const {
      action = 'parse',
      actorRole,
      actorName = 'Super User',
      targetYear,
      targetMonth,
      fileName = 'laporan-keuangan',
      mimeType = 'application/pdf',
      fileSize = 0,
      sessionToken,
      chunkBase64,
      offset = 0,
      isFinalChunk = false,
      geminiFileUri,
      geminiFileName,
      fileBase64,
      spreadsheetText,
    } = body || {};

    if (!ALLOWED_SUPER_USER_ROLES.includes(String(actorRole || '') as any)) {
      return {
        status: 403,
        json: {
          error:
            'Akses ditolak. Fitur upload dan pembacaan laporan bulanan hanya tersedia untuk Super User (Kepala SPI / Admin Sistem).',
        },
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return {
        status: 503,
        json: {
          error:
            'GEMINI_API_KEY belum dikonfigurasi pada server. Pembacaan otomatis PDF/Gambar membutuhkan kunci Gemini API aktif pada environment server, atau gunakan template Excel terstruktur.',
        },
      };
    }

    if (!activeAiClient) {
      activeAiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }

    const safeMime = String(mimeType || 'application/pdf').trim().toLowerCase() || 'application/pdf';

    // ACTION 1: START STATELESS GEMINI RESUMABLE UPLOAD SESSION
    if (action === 'upload_start') {
      if (!ALLOWED_FINANCE_REPORT_MIMES.has(safeMime)) {
        return {
          status: 400,
          json: { error: `Format file "${safeMime}" tidak didukung.` },
        };
      }
      const totalBytes = Number(fileSize);
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
        return { status: 400, json: { error: 'Ukuran file tidak valid.' } };
      }
      if (totalBytes > MAX_FIN_UPLOAD_BYTES) {
        return {
          status: 413,
          json: { error: 'Ukuran file melebihi batas maksimum 50 MB.' },
        };
      }

      const startRes = await fetchWithRetry(
        'https://generativelanguage.googleapis.com/upload/v1beta/files',
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(Math.floor(totalBytes)),
            'X-Goog-Upload-Header-Content-Type': safeMime,
            'Content-Type': 'application/json',
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify({
            file: {
              display_name: String(fileName || 'laporan-keuangan').slice(0, 120),
            },
          }),
        },
        1
      );

      if (!startRes.ok) {
        const errText = await startRes.text().catch(() => '');
        return {
          status: startRes.status >= 400 ? startRes.status : 502,
          json: {
            error: `Gagal memulai sesi unggahan dokumen ke Gemini Files API (${startRes.status}): ${errText.slice(0, 180)}`,
          },
        };
      }

      const uploadUrl = startRes.headers.get('x-goog-upload-url');
      if (!uploadUrl || !uploadUrl.startsWith('https://generativelanguage.googleapis.com/upload/')) {
        return {
          status: 502,
          json: { error: 'Server penyimpanan tidak mengembalikan URL unggahan yang valid.' },
        };
      }

      const token = encryptUploadUrl(uploadUrl, apiKey);
      return {
        status: 200,
        json: { sessionToken: token },
      };
    }

    // ACTION 2: UPLOAD A SINGLE CHUNK (8 MB MULTIPLE EXCEPT FINAL) STATELESSLY TO GEMINI FILES API
    if (action === 'upload_chunk') {
      if (typeof sessionToken !== 'string' || !sessionToken) {
        return { status: 400, json: { error: 'Token sesi unggahan tidak ditemukan.' } };
      }
      if (typeof chunkBase64 !== 'string' || !chunkBase64) {
        return { status: 400, json: { error: 'Data potongan file kosong.' } };
      }

      const uploadUrl = decryptUploadUrl(sessionToken, apiKey);
      const chunkBuf = Buffer.from(chunkBase64, 'base64');
      if (chunkBuf.length === 0) {
        return { status: 400, json: { error: 'Potongan file biner kosong.' } };
      }
      if (chunkBuf.length > 16 * 1024 * 1024) {
        return { status: 413, json: { error: 'Ukuran potongan melebihi 16 MB.' } };
      }

      const numericOffset = Number(offset);
      if (!Number.isInteger(numericOffset) || numericOffset < 0) {
        return { status: 400, json: { error: 'Offset unggahan tidak valid.' } };
      }

      const command = isFinalChunk ? 'upload, finalize' : 'upload';
      const chunkRes = await fetchWithRetry(
        uploadUrl,
        {
          method: 'PUT',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Length': String(chunkBuf.length),
            'X-Goog-Upload-Offset': String(numericOffset),
            'X-Goog-Upload-Command': command,
            'User-Agent': 'aistudio-build',
          },
          body: new Uint8Array(chunkBuf),
        },
        1
      );

      if (!chunkRes.ok) {
        const errText = await chunkRes.text().catch(() => '');
        return {
          status: chunkRes.status >= 400 ? chunkRes.status : 502,
          json: {
            error: `Gagal meneruskan potongan file ke server (${chunkRes.status}): ${errText.slice(0, 180)}`,
          },
        };
      }

      if (!isFinalChunk) {
        return {
          status: 200,
          json: { ok: true, receivedBytes: chunkBuf.length },
        };
      }

      const finalizedJson: any = await chunkRes.json().catch(() => ({}));
      const fileMeta = finalizedJson?.file || finalizedJson;
      if (!fileMeta?.uri || !fileMeta?.name) {
        return {
          status: 502,
          json: { error: 'Unggahan selesai, tetapi metadata file tidak diterima.' },
        };
      }

      return {
        status: 200,
        json: {
          ok: true,
          finalized: true,
          geminiFileUri: fileMeta.uri,
          geminiFileName: fileMeta.name,
          geminiMimeType: fileMeta.mimeType || safeMime,
        },
      };
    }

    // ACTION 3: PARSE REPORT WITH AI + 2-PASS AUDIT SELF-VERIFICATION
    const parsedYear = Number(targetYear);
    if (!Number.isInteger(parsedYear) || parsedYear < 2020 || parsedYear > 2100) {
      return {
        status: 400,
        json: { error: 'Tahun target tidak valid (harus 2020-2100).' },
      };
    }

    const validMonth = FISCAL_MONTH_NAMES.find(
      (m) => m.toLowerCase() === String(targetMonth || '').trim().toLowerCase()
    );
    if (!validMonth) {
      return {
        status: 400,
        json: { error: 'Bulan target wajib dipilih (Januari - Desember).' },
      };
    }

    if (!ALLOWED_FINANCE_REPORT_MIMES.has(safeMime)) {
      return {
        status: 400,
        json: { error: `Format file "${safeMime}" tidak didukung.` },
      };
    }

    if (!geminiFileUri && !fileBase64 && !spreadsheetText) {
      return {
        status: 400,
        json: { error: 'Konten file laporan kosong atau belum dipilih.' },
      };
    }

    if (typeof geminiFileName === 'string' && geminiFileName.startsWith('files/')) {
      uploadedGeminiFileNameToDelete = geminiFileName;
    }

    const promptText = buildFinanceReportParsePrompt({
      targetYear: parsedYear,
      targetMonth: validMonth,
      fileName: String(fileName).slice(0, 200),
      spreadsheetText:
        typeof spreadsheetText === 'string' ? spreadsheetText.slice(0, 450_000) : undefined,
    });

    const parts: any[] = [{ text: promptText }];

    if (typeof geminiFileUri === 'string' && geminiFileUri.length > 0) {
      if (!geminiFileUri.startsWith('https://generativelanguage.googleapis.com/')) {
        return { status: 400, json: { error: 'URI file dokumen tidak valid.' } };
      }

      if (uploadedGeminiFileNameToDelete) {
        let fileInfo = await activeAiClient.files.get({ name: uploadedGeminiFileNameToDelete });
        let attempts = 0;
        while (fileInfo.state === 'PROCESSING' && attempts < 15) {
          await new Promise((r) => setTimeout(r, 2000));
          fileInfo = await activeAiClient.files.get({ name: uploadedGeminiFileNameToDelete });
          attempts++;
        }
        if (fileInfo.state === 'FAILED') {
          throw new Error('Dokumen gagal diproses di layanan pembacaan file (status FAILED).');
        }
      }

      parts.push({
        fileData: {
          fileUri: geminiFileUri,
          mimeType: safeMime,
        },
      });
    } else if (
      typeof fileBase64 === 'string' &&
      fileBase64.length > 0 &&
      (safeMime === 'application/pdf' || safeMime.startsWith('image/'))
    ) {
      const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(cleanBase64, 'base64');
      if (buf.length > MAX_FIN_UPLOAD_BYTES) {
        return {
          status: 413,
          json: { error: 'Ukuran file melebihi batas maksimum 50 MB.' },
        };
      }
      parts.push({
        inlineData: {
          mimeType: safeMime,
          data: cleanBase64,
        },
      });
    }

    const pass1StartedAt = Date.now();
    const { response, modelUsed, usedFallbackModel } = await callGeminiWithRetryAndFallback({
      aiClient: activeAiClient,
      contents: [{ role: 'user', parts }],
      systemInstruction: FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION,
    });

    const rawText = response?.text || '';
    if (!rawText.trim()) {
      return {
        status: 502,
        json: {
          error:
            'Model tidak mengembalikan hasil pembacaan laporan. Pastikan file dapat dibaca (bukan terenkripsi password).',
        },
      };
    }

    const rawJson1 = extractJsonFromModelText(rawText);
    const normalized1 = normalizeParsedFinanceReport({
      raw: rawJson1,
      targetYear: parsedYear,
      targetMonth: validMonth,
      actorName: String(actorName),
      parserSource: 'gemini-4-hydrogen',
    });
    if (usedFallbackModel) {
      normalized1.parserNotes = [
        ...(normalized1.parserNotes || []),
        `[Mode Resiliensi AI] Menggunakan model cadangan cepat (${modelUsed}) karena model utama sedang mengalami lonjakan trafik sementara.`,
      ];
    }
    const diag1 = computeReportAccountingDiagnostics(normalized1);

    let bestNormalized = normalized1;
    let bestDiag = diag1;
    let passCount = 1;

    // Pass 2: Automatic AI Self-Verification & Correction if Pass 1 COA is sparse or Neraca is unbalanced
    const needsVerificationPass =
      !usedFallbackModel &&
      (diag1.coaCount < 6 || (diag1.totalAssets > 0 && !diag1.isBalanced)) &&
      Date.now() - pass1StartedAt < 45_000;

    if (needsVerificationPass) {
      try {
        const verificationPrompt = buildFinanceReportVerificationPrompt({
          targetYear: parsedYear,
          targetMonth: validMonth,
          fileName: String(fileName).slice(0, 200),
          previousRawJson: rawJson1,
          diagnostics: diag1,
          spreadsheetText:
            typeof spreadsheetText === 'string' ? spreadsheetText.slice(0, 100_000) : undefined,
        });
        const verifyParts = [{ text: verificationPrompt }, ...parts.slice(1)];

        const verifyTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Verification timeout')), 45_000)
        );
        const verifyPromise = activeAiClient.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [{ role: 'user', parts: verifyParts }],
          config: {
            systemInstruction: FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          },
        });

        const verifyRes: any = await Promise.race([verifyPromise, verifyTimeout]);
        const verifyText = verifyRes?.text || '';
        if (verifyText.trim()) {
          const rawJson2 = extractJsonFromModelText(verifyText);
          const normalized2 = normalizeParsedFinanceReport({
            raw: rawJson2,
            targetYear: parsedYear,
            targetMonth: validMonth,
            actorName: String(actorName),
            parserSource: 'gemini-4-hydrogen',
          });
          const diag2 = computeReportAccountingDiagnostics(normalized2);
          passCount = 2;

          const improved =
            (diag2.coaCount >= diag1.coaCount && diag2.neracaDiff < diag1.neracaDiff) ||
            (diag1.coaCount < 6 && diag2.coaCount > diag1.coaCount);

          if (improved) {
            bestNormalized = {
              ...normalized2,
              parserNotes: [
                ...(normalized2.parserNotes || []),
                `[Audit AI 2-Pass] Pemeriksaan ulang otomatis memperbaiki ekstraksi (${diag2.coaCount} akun COA, selisih Neraca berkurang dari Rp ${Math.round(
                  diag1.neracaDiff
                ).toLocaleString('id-ID')} menjadi Rp ${Math.round(diag2.neracaDiff).toLocaleString(
                  'id-ID'
                )}).`,
              ],
            };
            bestDiag = diag2;
          } else {
            bestNormalized = {
              ...normalized1,
              parserNotes: [
                ...(normalized1.parserNotes || []),
                `[Audit AI 2-Pass] Verifikasi silang selesai (${diag1.coaCount} akun COA diperiksa).`,
              ],
            };
          }
        }
      } catch (verifyErr) {
        console.warn('Pass 2 AI verification skipped due to non-fatal error:', verifyErr);
      }
    }

    return {
      status: 200,
      json: {
        data: bestNormalized,
        verification: {
          passCount,
          isBalanced: bestDiag.isBalanced,
          neracaDiff: bestDiag.neracaDiff,
          coaCount: bestDiag.coaCount,
          modelUsed,
        },
      },
    };
  } catch (err: any) {
    console.error('Error in handleParseFinanceReportAction:', err);
    const parsedErr = parseReadableAiError(err);
    return {
      status: parsedErr.status,
      json: {
        error: parsedErr.message,
      },
    };
  } finally {
    if (uploadedGeminiFileNameToDelete && activeAiClient) {
      activeAiClient.files.delete({ name: uploadedGeminiFileNameToDelete }).catch(() => undefined);
    }
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const result = await handleParseFinanceReportAction(body);
    return res.status(result.status).json(result.json);
  } catch (err: any) {
    console.error('Unhandled error in parse-finance-report handler:', err);
    return res.status(500).json({
      error: err?.message || 'Terjadi kesalahan internal pada server pembacaan laporan.',
    });
  }
}
