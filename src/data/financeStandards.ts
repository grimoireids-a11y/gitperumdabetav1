import { FinanceAccount, FinanceCashBankAccount } from '../types/finance';

export {
  buildOfficialPDAMCashBankAccountsJan2026 as buildOfficialPDAMCashBankAccounts,
  buildOfficialPDAMCoaJan2026 as buildOfficialPDAMCoa,
  buildOfficialPDAMInventoryJan2026 as buildOfficialPDAMInventory,
  buildOfficialPDAMPurchasesJan2026 as buildOfficialPDAMPurchases,
  buildOfficialPDAMReceivablesPayablesJan2026 as buildOfficialPDAMReceivablesPayables,
  buildOfficialPDAMAssetsJan2026 as buildOfficialPDAMAssets,
  buildOfficialPDAMTaxesJan2026 as buildOfficialPDAMTaxes,
  buildOfficialPDAMSnapshotJan2026,
} from './pdamOfficialBaselineJan2026';

export {
  buildOfficialPDAMCashBankAccountsDec2025,
  buildOfficialPDAMCoaDec2025,
  buildOfficialPDAMInventoryDec2025,
  buildOfficialPDAMReceivablesPayablesDec2025,
  buildOfficialPDAMAssetsDec2025,
  buildOfficialPDAMTaxesDec2025,
  buildOfficialPDAMSnapshotDec2025,
} from './pdamOfficialBaselineDec2025';

export { buildOfficialPDAMSnapshotSep2026 } from './pdamOfficialBaseline2026';

export const FINANCE_INVENTORY_CATEGORIES = [
  'Bahan Kimia',
  'Bahan Instalasi Bergerak',
  'Bahan Instalasi Tidak Bergerak',
  'ATK & Umum',
] as const;

export const FINANCE_PURCHASE_CATEGORIES = [
  'Alat tulis kantor',
  'Pipa dan Accessoris',
  'Bahan Kimia',
  'Belanja Modal',
  'Lainnya',
] as const;

export const PDAM_ASSET_GROUP_NAMES = [
  '01 - Tanah dan Penyempurnaan Tanah',
  '02 - Instalasi Sumber Air',
  '03 - Instalasi Pompa',
  '04 - Instalasi Pengolahan Air',
  '05 - Instalasi Transmisi dan Distribusi',
  '06 - Bangunan / Gedung',
  '07 - Peralatan dan Perlengkapan',
  '08 - Kendaraan / Alat Pengangkutan',
  '09 - Inventaris / Perabot Kantor',
] as const;

export const FINANCE_RECEIPT_CATEGORIES = [
  'Penerimaan Rekening Air',
  'Penerimaan Sambungan Baru',
  'Pendapatan Non-Air',
  'Penerimaan Lainnya',
] as const;

export const FINANCE_EXPENSE_CATEGORIES = [
  'Pengeluaran Operasional',
  'Pembelian Barang',
  'Pembayaran Jasa',
  'Belanja Modal',
  'Pembayaran Pajak',
  'Pengeluaran Lainnya',
] as const;

export const FINANCE_TAX_TYPES = [
  'PPN',
  'PPh 21',
  'PPh 22',
  'PPh 23',
  'PPh Final 4(2)',
  'Pajak Air Permukaan',
  'Lainnya',
] as const;

export const FINANCE_ASSET_CATEGORIES = [
  'Tanah & Sumber Air Baku',
  'Instalasi Pengolahan Air (IPA)',
  'Jaringan Pipa Transmisi & Distribusi',
  'Bangunan & Reservoir',
  'Pompa, Mesin & Peralatan Teknik',
  'Water Meter & Alat Ukur',
  'Kendaraan Operasional',
  'Peralatan Kantor & TI',
] as const;

export const buildDefaultPDAMCoa = (
  year: number,
  createdBy: string
): FinanceAccount[] => {
  const now = new Date().toISOString();
  const base = (
    code: string,
    name: string,
    type: FinanceAccount['type'],
    subCategory: string,
    normalBalance: 'Debit' | 'Kredit',
    cashFlowGroup: FinanceAccount['cashFlowGroup'],
    openingBalance = 0
  ): FinanceAccount => ({
    id: `coa-${year}-${code.replace(/[^a-zA-Z0-9]/g, '')}`,
    code,
    name,
    type,
    subCategory,
    normalBalance,
    cashFlowGroup,
    openingBalance,
    year,
    isActive: true,
    createdBy,
    createdAt: now,
    updatedAt: now,
  });

  return [
    // ASET LANCAR
    base('1-1101', 'Kas Besar Kantor Pusat', 'Aset', 'Aset Lancar', 'Debit', 'Kas', 75_000_000),
    base('1-1102', 'Kas Kecil Operasional', 'Aset', 'Aset Lancar', 'Debit', 'Kas', 15_000_000),
    base('1-1201', 'Bank Nagari - Giro Operasional', 'Aset', 'Aset Lancar', 'Debit', 'Kas', 850_000_000),
    base('1-1202', 'Bank BRI - Penerimaan Pelanggan', 'Aset', 'Aset Lancar', 'Debit', 'Kas', 420_000_000),
    base('1-1301', 'Piutang Rekening Air Pelanggan', 'Aset', 'Aset Lancar', 'Debit', 'Operasional', 310_000_000),
    base('1-1302', 'Piutang Non-Air & Sambungan Baru', 'Aset', 'Aset Lancar', 'Debit', 'Operasional', 45_000_000),
    base('1-1401', 'Persediaan Bahan Kimia & Pipa', 'Aset', 'Aset Lancar', 'Debit', 'Operasional', 185_000_000),
    // ASET TETAP
    base('1-2101', 'Tanah & Sumber Air Baku', 'Aset', 'Aset Tetap', 'Debit', 'Investasi', 1_450_000_000),
    base('1-2102', 'Instalasi Pengolahan Air & Pipa Distribusi', 'Aset', 'Aset Tetap', 'Debit', 'Investasi', 4_800_000_000),
    base('1-2103', 'Pompa, Peralatan Teknik & Kendaraan', 'Aset', 'Aset Tetap', 'Debit', 'Investasi', 950_000_000),
    base('1-2901', 'Akumulasi Penyusutan Aset Tetap', 'Aset', 'Akumulasi Penyusutan', 'Kredit', 'Non-Kas', 1_240_000_000),
    // KEWAJIBAN
    base('2-1101', 'Utang Usaha Rekanan & Pengadaan', 'Kewajiban', 'Kewajiban Lancar', 'Kredit', 'Operasional', 165_000_000),
    base('2-1201', 'Utang Pajak (PPN / PPh / PAP)', 'Kewajiban', 'Kewajiban Lancar', 'Kredit', 'Operasional', 28_000_000),
    base('2-1301', 'Uang Jaminan Langganan & Biaya YMH Dibayar', 'Kewajiban', 'Kewajiban Lancar', 'Kredit', 'Operasional', 92_000_000),
    base('2-2101', 'Utang Jangka Panjang Investasi', 'Kewajiban', 'Kewajiban Jangka Panjang', 'Kredit', 'Pendanaan', 450_000_000),
    // EKUITAS
    base('3-1101', 'Penyertaan Modal Pemerintah Daerah (KPM)', 'Ekuitas', 'Ekuitas', 'Kredit', 'Pendanaan', 5_500_000_000),
    base('3-2101', 'Cadangan Tujuan & Laba Ditahan', 'Ekuitas', 'Ekuitas', 'Kredit', 'Pendanaan', 1_625_000_000),
    // PENDAPATAN
    base('4-1101', 'Pendapatan Penjualan Air (Rekening Air)', 'Pendapatan', 'Pendapatan Usaha', 'Kredit', 'Operasional', 0),
    base('4-1102', 'Pendapatan Sambungan Baru', 'Pendapatan', 'Pendapatan Usaha', 'Kredit', 'Operasional', 0),
    base('4-1201', 'Pendapatan Non-Air & Jasa Pelayanan', 'Pendapatan', 'Pendapatan Usaha', 'Kredit', 'Operasional', 0),
    base('4-2101', 'Pendapatan Lain-Lain / Jasa Giro Bank', 'Pendapatan', 'Pendapatan Lain-Lain', 'Kredit', 'Operasional', 0),
    // BEBAN
    base('5-1101', 'Beban Sumber Air, Energi Listrik & Pompa', 'Beban', 'Beban Operasi Langsung', 'Debit', 'Operasional', 0),
    base('5-1102', 'Beban Pengolahan Air & Bahan Kimia', 'Beban', 'Beban Operasi Langsung', 'Debit', 'Operasional', 0),
    base('5-1201', 'Beban Transmisi, Distribusi & Pemeliharaan Pipa', 'Beban', 'Beban Operasi Langsung', 'Debit', 'Operasional', 0),
    base('5-2101', 'Beban Pegawai & Kesejahteraan', 'Beban', 'Beban Administrasi & Umum', 'Debit', 'Operasional', 0),
    base('5-2102', 'Beban Kantor, ATK & Operasional Umum', 'Beban', 'Beban Administrasi & Umum', 'Debit', 'Operasional', 0),
    base('5-2103', 'Beban Jasa Profesional & Pihak Ketiga', 'Beban', 'Beban Administrasi & Umum', 'Debit', 'Operasional', 0),
    base('5-2201', 'Beban Penyusutan Aset Tetap', 'Beban', 'Beban Penyusutan', 'Debit', 'Non-Kas', 0),
    base('5-3101', 'Beban Pajak & Retribusi Daerah', 'Beban', 'Beban Lain-Lain', 'Debit', 'Operasional', 0),
    base('5-3102', 'Beban Administrasi Bank & Lainnya', 'Beban', 'Beban Lain-Lain', 'Debit', 'Operasional', 0),
  ];
};

export const buildDefaultCashBankAccounts = (
  year: number,
  createdBy: string,
  unitId = '',
  unitName = 'Bidang Umum dan Keuangan'
): FinanceCashBankAccount[] => {
  const now = new Date().toISOString();
  return [
    {
      id: 'cb-kas-besar',
      code: 'KAS-01',
      name: 'Kas Besar Kantor Pusat',
      accountKind: 'KAS_BESAR',
      coaId: `coa-${year}-11101`,
      coaCode: '1-1101',
      unitId,
      unitName,
      openingBalance: 75_000_000,
      isActive: true,
      notes: 'Kas utama penerimaan dan pengeluaran tunai kantor pusat',
      createdBy,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cb-kas-kecil',
      code: 'KAS-02',
      name: 'Kas Kecil Operasional (Petty Cash)',
      accountKind: 'KAS_KECIL',
      coaId: `coa-${year}-11102`,
      coaCode: '1-1102',
      unitId,
      unitName,
      openingBalance: 15_000_000,
      isActive: true,
      notes: 'Dana kas kecil operasional harian kantor dan unit',
      createdBy,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cb-bank-nagari',
      code: 'BNK-01',
      name: 'Bank Nagari - Giro Operasional',
      accountKind: 'BANK',
      bankName: 'Bank Nagari Cabang Lubuk Sikaping',
      accountNumber: '0100.0101.00451-2',
      coaId: `coa-${year}-11201`,
      coaCode: '1-1201',
      unitId,
      unitName,
      openingBalance: 850_000_000,
      isActive: true,
      notes: 'Rekening giro operasional utama Perumda Air Minum Tirta Saiyo',
      createdBy,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'cb-bank-bri',
      code: 'BNK-02',
      name: 'Bank BRI - Penerimaan Rekening Air',
      accountKind: 'BANK',
      bankName: 'Bank BRI Unit Pasaman',
      accountNumber: '0042-01-001892-30-1',
      coaId: `coa-${year}-11202`,
      coaCode: '1-1202',
      unitId,
      unitName,
      openingBalance: 420_000_000,
      isActive: true,
      notes: 'Rekening penampungan pembayaran tagihan rekening air & sambungan baru',
      createdBy,
      createdAt: now,
      updatedAt: now,
    },
  ];
};
