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

export const FINANCE_BASELINE_JAN2026_MARKER_DOC = 'finance_baseline_jan2026_v1';

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
  const year = params.year ?? 2026;
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

  // 2. Build complete official January 2026 baseline dataset
  const coa = buildOfficialPDAMCoaJan2026(year, params.actorName);
  const cashBanks = buildOfficialPDAMCashBankAccountsJan2026(year, params.actorName);
  const receivablesPayables = buildOfficialPDAMReceivablesPayablesJan2026(
    year,
    params.actorName
  );
  const assets = buildOfficialPDAMAssetsJan2026(year, params.actorName);
  const taxes = buildOfficialPDAMTaxesJan2026(year, params.actorName);
  const inventory = buildOfficialPDAMInventoryJan2026(year, 'Januari', params.actorName);
  const purchases = buildOfficialPDAMPurchasesJan2026(year, params.actorName);
  const snapshot = buildOfficialPDAMSnapshotJan2026(params.actorName);

  const seedAudit: FinanceAuditTrail = sanitizeFirestoreRecord({
    id: `faud-seed-jan${year}`,
    timestamp: now,
    actorUid: params.actorUid,
    actorName: params.actorName,
    actorRole: params.actorRole,
    actionType: 'SEED',
    entityType: 'Baseline Resmi Keuangan PDAM (Januari 2026)',
    entityId: snapshot.id,
    entityLabel: `Reset & Baseline Januari ${year}`,
    summary: `Mengosongkan data keuangan lama (${refsToDelete.length} dokumen) dan mengisi baseline resmi Januari ${year}: ${coa.length} COA, ${cashBanks.length} Kas/Bank, ${receivablesPayables.length} Utang/Piutang, ${assets.length} Aset, ${taxes.length} Pajak, ${inventory.length} Persediaan, ${purchases.length} Pembelian & Snapshot Operasional.`,
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
    },
    year,
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
      ref: doc(db, 'fin_pdam_reports', snapshot.id),
      data: sanitizeFirestoreRecord(snapshot) as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'fin_audit_trails', seedAudit.id),
      data: seedAudit as unknown as Record<string, unknown>,
    },
    {
      ref: doc(db, 'app_settings', FINANCE_BASELINE_JAN2026_MARKER_DOC),
      data: sanitizeFirestoreRecord({
        id: FINANCE_BASELINE_JAN2026_MARKER_DOC,
        baseline: 'JANUARI_2026',
        year,
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
      pdamReports: 1,
    },
  };
}
