import {
  collection,
  doc,
  DocumentReference,
  getDoc,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { sanitizeFirestoreRecord } from './financeEngine';
import {
  buildOfficialPDAMAssetsDec2025,
  buildOfficialPDAMCashBankAccountsDec2025,
  buildOfficialPDAMCoaDec2025,
  buildOfficialPDAMInventoryDec2025,
  buildOfficialPDAMReceivablesPayablesDec2025,
  buildOfficialPDAMSnapshotDec2025,
  buildOfficialPDAMTaxesDec2025,
} from '../data/pdamOfficialBaselineDec2025';
import {
  buildOfficialPDAMAssetsJan2026,
  buildOfficialPDAMCashBankAccountsJan2026,
  buildOfficialPDAMCoaJan2026,
  buildOfficialPDAMInventoryJan2026,
  buildOfficialPDAMPurchasesJan2026,
  buildOfficialPDAMReceivablesPayablesJan2026,
  buildOfficialPDAMSnapshotJan2026,
  buildOfficialPDAMTaxesJan2026,
} from '../data/pdamOfficialBaselineJan2026';
import { FinanceAuditTrail } from '../types/finance';

export const FINANCE_BASELINE_JAN2026_MARKER_DOC = 'finance_baseline_dec2025_jan2026_v1';

export const FINANCE_COLLECTIONS_TO_CLEAR = [
  'fin_transactions',
  'fin_journals',
  'fin_bank_reconciliations',
  'fin_period_closes',
  'fin_receivables_payables',
  'fin_assets',
  'fin_taxes',
  'fin_inventory',
  'fin_purchases',
  'fin_pdam_reports',
  'fin_cash_banks',
  'fin_accounts',
  'fin_audit_trails',
  'fin_monthly_report_uploads',
] as const;

const BATCH_LIMIT = 400;

export async function hasJan2026BaselineMarker(): Promise<boolean> {
  const snap = await getDoc(doc(db, 'app_settings', FINANCE_BASELINE_JAN2026_MARKER_DOC));
  return snap.exists();
}

export interface ClearAndSeedJan2026Result {
  deletedCount: number;
  seededCounts: {
    coa: number;
    cashBanks: number;
    receivablesPayables: number;
    assets: number;
    taxes: number;
    inventory: number;
    purchases: number;
    pdamReports: number;
  };
}

export async function clearAndSeedJan2026Baseline(params: {
  actorUid: string;
  actorName: string;
  actorRole: string;
  year?: number;
}): Promise<ClearAndSeedJan2026Result> {
  const janYear = params.year ?? 2026;
  const decYear = janYear - 1;
  const now = new Date().toISOString();

  // 1. Collect and delete all existing finance documents across all 13 collections
  const refsToDelete: DocumentReference[] = [];
  for (const colName of FINANCE_COLLECTIONS_TO_CLEAR) {
    const snap = await getDocs(collection(db, colName));
    snap.docs.forEach((d) => refsToDelete.push(d.ref));
  }

  for (let i = 0; i < refsToDelete.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    refsToDelete.slice(i, i + BATCH_LIMIT).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  // 2A. Build December 2025 initial baseline dataset (data awal sebelum Januari 2026)
  const coaDec = buildOfficialPDAMCoaDec2025(decYear, params.actorName);
  const cashBanksDec = buildOfficialPDAMCashBankAccountsDec2025(decYear, params.actorName);
  const rpDec = buildOfficialPDAMReceivablesPayablesDec2025(decYear, params.actorName);
  const assetsDec = buildOfficialPDAMAssetsDec2025(decYear, params.actorName);
  const taxesDec = buildOfficialPDAMTaxesDec2025(decYear, params.actorName);
  const invDec = buildOfficialPDAMInventoryDec2025(decYear, 'Desember', params.actorName);
  const snapDec = buildOfficialPDAMSnapshotDec2025(params.actorName);

  // 2B. Build January 2026 official baseline dataset
  const coaJan = buildOfficialPDAMCoaJan2026(janYear, params.actorName);
  const cashBanksJan = buildOfficialPDAMCashBankAccountsJan2026(janYear, params.actorName);
  const rpJan = buildOfficialPDAMReceivablesPayablesJan2026(janYear, params.actorName);
  const assetsJan = buildOfficialPDAMAssetsJan2026(janYear, params.actorName);
  const taxesJan = buildOfficialPDAMTaxesJan2026(janYear, params.actorName);
  const invJan = buildOfficialPDAMInventoryJan2026(janYear, 'Januari', params.actorName);
  const purchasesJan = buildOfficialPDAMPurchasesJan2026(janYear, params.actorName);
  const snapJan = buildOfficialPDAMSnapshotJan2026(params.actorName);

  const coa = [...coaDec, ...coaJan];
  const cashBanks = [...cashBanksDec, ...cashBanksJan];
  const receivablesPayables = [...rpDec, ...rpJan];
  const assets = [...assetsDec, ...assetsJan];
  const taxes = [...taxesDec, ...taxesJan];
  const inventory = [...invDec, ...invJan];
  const purchases = [...purchasesJan];

  const seedAuditDec: FinanceAuditTrail = sanitizeFirestoreRecord({
    id: `faud-seed-dec${decYear}`,
    timestamp: now,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: params.actorRole,
    actionType: 'SEED',
    entityType: `Baseline Data Awal Keuangan PDAM (Desember ${decYear})`,
    entityId: snapDec.id,
    entityLabel: `Data Awal Desember ${decYear} (Sebelum Januari ${janYear})`,
    summary: `Mengisi data awal resmi Desember ${decYear}: ${coaDec.length} COA (Rugi Usaha -Rp 209.486.961 / Rugi Bersih -Rp 447.634.269 bln & -Rp 2.194.377.265 YTD), ${cashBanksDec.length} Kas/Bank, ${rpDec.length} Utang/Piutang, ${assetsDec.length} Aset, ${taxesDec.length} Pajak, ${invDec.length} Persediaan.`,
    beforeData: null,
    afterData: {
      year: decYear,
      month: 'Desember',
      coaCount: coaDec.length,
      cashBanksCount: cashBanksDec.length,
      receivablesPayablesCount: rpDec.length,
      assetsCount: assetsDec.length,
      taxesCount: taxesDec.length,
      inventoryCount: invDec.length,
    },
    year: decYear,
  });

  const seedAuditJan: FinanceAuditTrail = sanitizeFirestoreRecord({
    id: `faud-seed-jan${janYear}`,
    timestamp: now,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: params.actorRole,
    actionType: 'SEED',
    entityType: `Baseline Resmi Keuangan PDAM (Januari ${janYear})`,
    entityId: snapJan.id,
    entityLabel: `Reset & Baseline Desember ${decYear} - Januari ${janYear}`,
    summary: `Mengosongkan data keuangan lama (${refsToDelete.length} dokumen) dan mengisi lengkap Desember ${decYear} (data awal) serta Januari ${janYear}: ${coa.length} COA, ${cashBanks.length} Kas/Bank, ${receivablesPayables.length} Utang/Piutang, ${assets.length} Aset, ${taxes.length} Pajak, ${inventory.length} Persediaan, ${purchases.length} Pembelian & 2 Snapshot Laporan PDAM.`,
    beforeData: null,
    afterData: {
      deletedCount: refsToDelete.length,
      coaCount: coa.length,
      cashBanksCount: cashBanks.length,
      receivablesPayablesCount: receivablesPayables.length,
      assetsCount: assets.length,
      taxesCount: taxes.length,
      inventoryCount: inventory.length,
      purchasesCount: purchases.length,
      pdamReportsCount: 2,
    },
    year: janYear,
  });

  // 3. Stage all writes and commit in chunks <= 400
  const writeOps: { ref: DocumentReference; data: Record<string, unknown> }[] = [
    ...coa.map((item) => ({
      ref: doc(db, 'fin_accounts', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...cashBanks.map((item) => ({
      ref: doc(db, 'fin_cash_banks', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...receivablesPayables.map((item) => ({
      ref: doc(db, 'fin_receivables_payables', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...assets.map((item) => ({
      ref: doc(db, 'fin_assets', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...taxes.map((item) => ({
      ref: doc(db, 'fin_taxes', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...inventory.map((item) => ({
      ref: doc(db, 'fin_inventory', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    ...purchases.map((item) => ({
      ref: doc(db, 'fin_purchases', item.id),
      data: sanitizeFirestoreRecord(item) as unknown as Record<string, unknown>,
    })),
    {
      ref: doc(db, 'fin_pdam_reports', snapDec.id),
      data: sanitizeFirestoreRecord(snapDec) as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'fin_pdam_reports', snapJan.id),
      data: sanitizeFirestoreRecord(snapJan) as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'fin_audit_trails', seedAuditDec.id),
      data: seedAuditDec as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'fin_audit_trails', seedAuditJan.id),
      data: seedAuditJan as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'app_settings', FINANCE_BASELINE_JAN2026_MARKER_DOC),
      data: sanitizeFirestoreRecord({
        id: FINANCE_BASELINE_JAN2026_MARKER_DOC,
        baseline: 'DESEMBER_2025_JANUARI_2026',
        initialYear: decYear,
        initialMonth: 'Desember',
        year: janYear,
        month: 'Januari',
        deletedCount: refsToDelete.length,
        seededAt: now,
        seededBy: params.actorName,
        seededByUid: params.actorUid,
      }),
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
    deletedCount: refsToDelete.length,
    seededCounts: {
      coa: coa.length,
      cashBanks: cashBanks.length,
      receivablesPayables: receivablesPayables.length,
      assets: assets.length,
      taxes: taxes.length,
      inventory: inventory.length,
      purchases: purchases.length,
      pdamReports: 2,
    },
  };
}
