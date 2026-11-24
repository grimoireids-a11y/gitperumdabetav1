import { UserRole } from './audit';

export type FinanceAccountType = 'Aset' | 'Kewajiban' | 'Ekuitas' | 'Pendapatan' | 'Beban';

export type FinanceCashFlowGroup =
  | 'Kas'
  | 'Operasional'
  | 'Investasi'
  | 'Pendanaan'
  | 'Non-Kas';

export interface FinanceAccount {
  id: string;
  code: string;
  name: string;
  type: FinanceAccountType;
  subCategory: string;
  normalBalance: 'Debit' | 'Kredit';
  cashFlowGroup: FinanceCashFlowGroup;
  openingBalance: number;
  year: number;
  isActive: boolean;
  description?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type FinanceCashBankKind = 'KAS_BESAR' | 'KAS_KECIL' | 'BANK';

export interface FinanceCashBankAccount {
  id: string;
  code: string;
  name: string;
  accountKind: FinanceCashBankKind;
  bankName?: string;
  accountNumber?: string;
  coaId: string;
  coaCode: string;
  unitId?: string;
  unitName?: string;
  openingBalance: number;
  isActive: boolean;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export type FinanceTransactionType = 'PENERIMAAN' | 'PENGELUARAN' | 'TRANSFER';

export type FinanceReceiptCategory =
  | 'Penerimaan Rekening Air'
  | 'Penerimaan Sambungan Baru'
  | 'Pendapatan Non-Air'
  | 'Penerimaan Lainnya';

export type FinanceExpenseCategory =
  | 'Pengeluaran Operasional'
  | 'Pembelian Barang'
  | 'Pembayaran Jasa'
  | 'Belanja Modal'
  | 'Pembayaran Pajak'
  | 'Pengeluaran Lainnya';

export type FinanceTransactionStatus =
  | 'Draft'
  | 'Menunggu Persetujuan'
  | 'Disetujui / Diposting'
  | 'Ditolak'
  | 'Dibatalkan';

export interface FinanceAttachment {
  id: string;
  fileName: string;
  fileUrl?: string;
  inlineDataUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt: string;
}

export interface FinanceTransaction {
  id: string;
  voucherNumber: string;
  type: FinanceTransactionType;
  subCategory: string;
  transactionDate: string; // YYYY-MM-DD
  year: number;
  month: string; // Januari..Desember
  description: string;
  counterpartyName: string;
  unitId: string;
  unitName: string;
  bidangName: string;
  cashBankId: string;
  cashBankName: string;
  targetCashBankId?: string;
  targetCashBankName?: string;
  coaId: string;
  coaCode: string;
  coaName: string;
  amount: number;
  // Integrasi RKA Existing (Anti-Double-Counting)
  rkaId?: string;
  rkaCode?: string;
  rkaProgramName?: string;
  rkaSubId?: string;
  rkaSubCode?: string;
  rkaSubProgramName?: string;
  rkaBudgetSnapshot?: number;
  rkaPrevRealizationSnapshot?: number;
  // Status & Approval
  status: FinanceTransactionStatus;
  attachments: FinanceAttachment[];
  duplicateKey: string;
  duplicateWarningConfirmed?: boolean;
  linkedJournalId?: string;
  linkedReceivablePayableId?: string;
  linkedTaxId?: string;
  notes?: string;
  createdBy: string;
  createdByUid: string;
  createdByRole: UserRole;
  approvedBy?: string;
  approvedAt?: string;
  approvalNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceBankReconciliation {
  id: string;
  cashBankId: string;
  cashBankName: string;
  year: number;
  month: string;
  reconcileDate: string;
  bookBalance: number;
  bankStatementBalance: number;
  inTransitDeposits: number;
  outstandingChecks: number;
  bankAdminFee: number;
  bankInterest: number;
  adjustedBookBalance: number;
  adjustedBankBalance: number;
  difference: number;
  status: 'Sesuai' | 'Selisih';
  notes?: string;
  reconciledBy: string;
  createdAt: string;
  updatedAt: string;
}

export type FinanceJournalType =
  | 'UMUM'
  | 'PENERIMAAN'
  | 'PENGELUARAN'
  | 'PENYESUAIAN'
  | 'TUTUP_BUKU';

export interface FinanceJournalLine {
  coaId: string;
  coaCode: string;
  coaName: string;
  description?: string;
  debit: number;
  credit: number;
}

export interface FinanceJournal {
  id: string;
  journalNumber: string;
  journalType: FinanceJournalType;
  journalDate: string;
  year: number;
  month: string;
  referenceNumber?: string;
  sourceTransactionId?: string;
  description: string;
  unitId?: string;
  unitName?: string;
  lines: FinanceJournalLine[];
  totalDebit: number;
  totalCredit: number;
  status: 'Draft' | 'Posted' | 'Reversed';
  createdBy: string;
  createdByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinancePeriodClose {
  id: string;
  year: number;
  month: string; // 'Januari'..'Desember' or 'TAHUNAN'
  isClosed: boolean;
  closedBy?: string;
  closedAt?: string;
  reopenedBy?: string;
  reopenedAt?: string;
  notes?: string;
  updatedAt: string;
}

export interface FinanceReceivablePayablePayment {
  id: string;
  paymentDate: string;
  amount: number;
  cashBankId: string;
  cashBankName: string;
  referenceNo: string;
  notes?: string;
  recordedBy: string;
  createdAt: string;
}

export interface FinanceReceivablePayable {
  id: string;
  kind: 'PIUTANG' | 'UTANG';
  documentNumber: string;
  partyName: string;
  category: string;
  unitId: string;
  unitName: string;
  coaId: string;
  coaCode: string;
  transactionDate: string;
  dueDate: string;
  year: number;
  month: string;
  originalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'Belum Lunas' | 'Sebagian' | 'Lunas';
  payments: FinanceReceivablePayablePayment[];
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceAssetMutation {
  id: string;
  mutationDate: string;
  fromUnitId?: string;
  fromUnitName: string;
  toUnitId?: string;
  toUnitName: string;
  condition: 'Baik' | 'Perlu Perbaikan' | 'Rusak Berat';
  notes?: string;
  recordedBy: string;
  createdAt: string;
}

export interface FinanceAsset {
  id: string;
  assetCode: string;
  name: string;
  category: string;
  unitId: string;
  unitName: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLifeMonths: number;
  salvageValue: number;
  depreciationMethod: 'Garis Lurus';
  accumulatedDepreciation: number;
  bookValue: number;
  rkaId?: string;
  rkaCode?: string;
  linkedTransactionId?: string;
  coaAssetId?: string;
  status: 'Aktif' | 'Dalam Perbaikan' | 'Dihapusbukukan';
  mutations: FinanceAssetMutation[];
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type FinanceTaxType =
  | 'PPN'
  | 'PPh 21'
  | 'PPh 22'
  | 'PPh 23'
  | 'PPh Final 4(2)'
  | 'Pajak Air Permukaan'
  | 'Lainnya';

export interface FinanceTaxRecord {
  id: string;
  taxType: FinanceTaxType;
  year: number;
  month: string;
  transactionId?: string;
  voucherNumber?: string;
  withholdingNumber: string;
  taxObject: string;
  taxBaseAmount: number;
  taxRatePct: number;
  taxAmount: number;
  status: 'Terutang' | 'Dibayar' | 'Dilaporkan';
  dueDate: string;
  paymentDate?: string;
  ntpnNumber?: string;
  cashBankId?: string;
  cashBankName?: string;
  unitId?: string;
  unitName?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type FinanceAuditActionType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'APPROVE'
  | 'REJECT'
  | 'CANCEL'
  | 'POST'
  | 'CLOSE_PERIOD'
  | 'REOPEN_PERIOD'
  | 'SEED'
  | 'DUPLICATE_OVERRIDE';

export interface FinanceAuditTrail {
  id: string;
  timestamp: string;
  actorUid: string;
  actorName: string;
  actorRole: UserRole | string;
  actionType: FinanceAuditActionType;
  entityType: string;
  entityId: string;
  entityLabel: string;
  summary: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  approvalNotes?: string;
  duplicateFlag?: boolean;
  year?: number;
}

export interface FinanceGlobalFilter {
  year: number; // 0 = Semua Tahun
  month: string; // 'ALL' or 'Januari'..'Desember'
  dateFrom: string;
  dateTo: string;
  bidang: string; // 'ALL' or category/bidang name
  unitId: string; // 'ALL' or unit.id
  coaId: string; // 'ALL' or coa.id
}
