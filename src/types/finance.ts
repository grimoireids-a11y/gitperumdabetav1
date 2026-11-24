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
  prevMonthBalance?: number;
  monthlyRealization?: number;
  ytdRealization?: number;
  budgetMonthly?: number;
  budgetYtd?: number;
  isContra?: boolean;
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
  | 'IMPORT'
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

// =========================================================================
// PDAM PERMENDAGRI 118/2018 & OPERATIONAL-FINANCIAL EXTENSIONS
// =========================================================================

export interface FinanceInventoryItem {
  id: string;
  coaCode: string; // e.g., 15.01.04, 15.01.20, 15.01.30, 15.01.40, 15.03.90, 15.03.91
  itemCode: string;
  name: string;
  category: 'Bahan Kimia' | 'Bahan Instalasi Bergerak' | 'Bahan Instalasi Tidak Bergerak' | 'ATK & Umum';
  unitMeasure: string; // Kg, Liter, Batang, Buah, Unit, Paket
  year: number;
  month: string;
  unitId: string;
  unitName: string;
  beginningQty: number;
  inQty: number;
  outQty: number;
  endingQty: number;
  unitCost: number;
  prevMonthValue: number;
  endingValue: number;
  minStockQty: number;
  notes?: string;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
}

export interface FinancePurchaseRecord {
  id: string;
  purchaseNumber: string;
  purchaseDate: string;
  year: number;
  month: string;
  category: 'Alat tulis kantor' | 'Pipa dan Accessoris' | 'Bahan Kimia' | 'Belanja Modal' | 'Lainnya';
  itemDescription: string;
  vendorName: string;
  unitId: string;
  unitName: string;
  rkaId?: string;
  rkaCode?: string;
  requestedQty: number;
  realizedQty: number;
  unitMeasure: string;
  amount: number;
  status: 'Permintaan' | 'Realisasi' | 'Selesai' | 'Dibatalkan';
  linkedTransactionId?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinancePdamUnitEfficiency {
  unitName: string;
  prevBilling: number;
  arrearsCollected: number;
  currentCollected: number;
  totalCollected: number;
  currentEfficiencyPct: number;
  totalEfficiencyPct: number;
}

export interface FinancePdamTariffCollection {
  tariffCode: string;
  tariffName: string;
  receivableMonth1: number;
  receivableMonth2: number;
  receivableMonth3: number;
  receivableAbove3Months: number;
  totalReceivable: number;
  collectedAmount: number;
  effectivenessPct: number;
}

export interface FinancePdamDrdRow {
  tariffGroup: string;
  tariffName: string;
  customerCount: number;
  billedSlipsMonthly: number;
  cubicMetersMonthly: number;
  billedAmountMonthly: number;
  billedSlipsYtd: number;
  cubicMetersYtd: number;
  billedAmountYtd: number;
}

export interface FinancePdamAssetGroupRow {
  groupCode: string;
  groupName: string;
  acquisitionCost: number;
  accumDepPrevYear: number;
  depreciationMonthly: number;
  depreciationYtd: number;
  accumDepEnding: number;
  bookValueEnding: number;
}

export interface FinancePdamProductionUnit {
  unitName: string;
  installedCapacityLps: number;
  realCapacityLps: number;
  producedM3Monthly: number;
  distributedM3Monthly: number;
  soldM3Monthly: number;
  nrwM3Monthly: number;
  nrwPctMonthly: number;
  producedM3Ytd: number;
  distributedM3Ytd: number;
  soldM3Ytd: number;
  nrwM3Ytd: number;
  nrwPctYtd: number;
}

export interface FinancePdamConnectionRow {
  unitName: string;
  beginningActive: number;
  inactiveCount: number;
  disconnectedCount: number;
  reconnectedCount: number;
  newConnectionsCount: number;
  endingActive: number;
}

export interface FinancePdamHrUnitRow {
  unitName: string;
  direksiCount: number;
  permanentCount: number;
  contractCount: number;
  totalCount: number;
}

export interface FinancePdamSummaryMetric {
  code: string;
  label: string;
  section: 'KEUANGAN' | 'PRODUKSI_DISTRIBUSI';
  unit: string;
  monthlyReal: number;
  monthlyBudget: number;
  ytdReal: number;
  ytdBudget: number;
}

export interface FinancePdamIndirectCashFlow {
  netIncomeMonthly: number;
  depreciationAddBack: number;
  workingCapitalChanges: { label: string; amount: number }[];
  netOperatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netCashChange: number;
  beginningCash: number;
  endingCash: number;
}

export interface FinancePdamPurchaseSummaryRow {
  category: string;
  requestedMonthly: number;
  realizedMonthly: number;
  amountMonthly: number;
  requestedYtd: number;
  realizedYtd: number;
  amountYtd: number;
}

export interface FinancePdamMonthlySnapshot {
  id: string; // e.g., pdam-2026-September
  year: number;
  month: string;
  letterNumber: string;
  letterDate: string;
  recipient: string;
  legalBasis: string;
  directorName: string;
  kabidKeuName: string;
  kabidKeuNik: string;
  kasubidKeuName: string;
  kasubidKeuNik: string;
  summaryMetrics: FinancePdamSummaryMetric[];
  indirectCashFlow: FinancePdamIndirectCashFlow;
  collectionEfficiency: FinancePdamUnitEfficiency[];
  tariffEffectiveness: FinancePdamTariffCollection[];
  purchaseSummary: FinancePdamPurchaseSummaryRow[];
  drdSummary: FinancePdamDrdRow[];
  assetGroupSummary: FinancePdamAssetGroupRow[];
  productionDistribution: FinancePdamProductionUnit[];
  customerConnections: FinancePdamConnectionRow[];
  employeeComposition: FinancePdamHrUnitRow[];
  notes?: string;
  updatedBy: string;
  updatedAt: string;
  createdAt: string;
}

export interface FinanceBankStatementLine {
  id: string;
  date: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  direction: 'MASUK' | 'KELUAR';
  amount: number;
  selected: boolean;
  suggestedCoaId?: string;
}

