import React, { useMemo, useState } from 'react';
import {
  Printer,
  Download,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Scale,
  Droplets,
  Package,
  FileText,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { RKAItem, RKASubItem } from '../../types/audit';
import {
  FinanceGlobalFilter,
  FinanceInventoryItem,
  FinancePdamMonthlySnapshot,
  FinancePurchaseRecord,
  FinanceReceivablePayable,
  FinanceTransaction,
} from '../../types/finance';
import {
  AccountingStatements,
  CashBankComputedAccount,
  FinancialAnalysisResult,
  computeRkaAbsorptionForTarget,
  formatDateShort,
  formatRp,
  isContraAssetAccount,
} from '../../lib/financeEngine';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';

interface FinanceReportsAnalysisTabProps {
  mode: 'REPORTS' | 'ANALYSIS';
  filter: FinanceGlobalFilter;
  statements: AccountingStatements;
  cashBankSummary: {
    accounts: CashBankComputedAccount[];
    totalCashBalance: number;
    totalBankBalance: number;
    totalLiquidBalance: number;
  };
  receivablesPayables: FinanceReceivablePayable[];
  rkaItems: RKAItem[];
  rkaSubItems: RKASubItem[];
  allTransactions: FinanceTransaction[];
  analysis: FinancialAnalysisResult;
  pdamSnapshots?: FinancePdamMonthlySnapshot[];
  inventory?: FinanceInventoryItem[];
  purchases?: FinancePurchaseRecord[];
}

type FinanceReportId =
  | 'SURAT_PENGANTAR'
  | 'RINGKASAN_KEGIATAN'
  | 'NERACA'
  | 'ARUS_KAS'
  | 'LABA_RUGI'
  | 'EFISIENSI_PENAGIHAN'
  | 'EFEKTIVITAS_PENAGIHAN'
  | 'PEMBELIAN_PERSEDIAAN'
  | 'IKHTISAR_REKENING_AIR'
  | 'REKAP_AKTIVA'
  | 'PRODUKSI_DISTRIBUSI'
  | 'SAMBUNGAN_LANGGANAN'
  | 'KONDISI_KARYAWAN'
  | 'PERUBAHAN_EKUITAS'
  | 'BUKU_BESAR'
  | 'NERACA_SALDO'
  | 'KAS_BANK'
  | 'UTANG_PIUTANG'
  | 'REALISASI_RKA';

const REPORT_OPTIONS: { id: FinanceReportId; label: string; group: 'PDAM' | 'AKUNTANSI' }[] = [
  { id: 'SURAT_PENGANTAR', label: '0. Surat Pengantar (Permendagri 118)', group: 'PDAM' },
  { id: 'RINGKASAN_KEGIATAN', label: '1. Ringkasan Kegiatan', group: 'PDAM' },
  { id: 'NERACA', label: '2. Neraca Komparatif', group: 'PDAM' },
  { id: 'ARUS_KAS', label: '3. Laporan Arus Kas', group: 'PDAM' },
  { id: 'LABA_RUGI', label: '4. Laporan Laba Rugi', group: 'PDAM' },
  { id: 'EFISIENSI_PENAGIHAN', label: '5. Efisiensi Penagihan Rekening', group: 'PDAM' },
  { id: 'EFEKTIVITAS_PENAGIHAN', label: '6. Efektivitas Penagihan & Piutang', group: 'PDAM' },
  { id: 'PEMBELIAN_PERSEDIAAN', label: '7. Laporan Pembelian & Persediaan', group: 'PDAM' },
  { id: 'IKHTISAR_REKENING_AIR', label: '8. Ikhtisar Rekening Air (DRD)', group: 'PDAM' },
  { id: 'REKAP_AKTIVA', label: '9. Rekapitulasi Aktiva & Penyusutan', group: 'PDAM' },
  { id: 'PRODUKSI_DISTRIBUSI', label: '10. Laporan Produksi, Distribusi & NRW', group: 'PDAM' },
  { id: 'SAMBUNGAN_LANGGANAN', label: '11. Laporan Sambungan Langganan', group: 'PDAM' },
  { id: 'KONDISI_KARYAWAN', label: '12. Laporan Kondisi Karyawan', group: 'PDAM' },
  { id: 'PERUBAHAN_EKUITAS', label: '13. Perubahan Ekuitas', group: 'AKUNTANSI' },
  { id: 'BUKU_BESAR', label: '14. Ringkasan Buku Besar', group: 'AKUNTANSI' },
  { id: 'NERACA_SALDO', label: '15. Neraca Saldo', group: 'AKUNTANSI' },
  { id: 'KAS_BANK', label: '16. Laporan Kas dan Bank', group: 'AKUNTANSI' },
  { id: 'UTANG_PIUTANG', label: '17. Laporan Utang dan Piutang', group: 'AKUNTANSI' },
  { id: 'REALISASI_RKA', label: '18. Realisasi Anggaran RKA', group: 'AKUNTANSI' },
];

const pctVal = (real: number, budget: number): string => {
  if (!budget || Math.abs(budget) < 0.001) return '0,00%';
  return `${((real / budget) * 100).toFixed(2)}%`;
};

export const FinanceReportsAnalysisTab: React.FC<FinanceReportsAnalysisTabProps> = ({
  mode,
  filter,
  statements,
  cashBankSummary,
  receivablesPayables,
  rkaItems,
  rkaSubItems,
  allTransactions,
  analysis,
  pdamSnapshots = [],
  inventory = [],
  purchases = [],
}) => {
  const [selectedReport, setSelectedReport] = useState<FinanceReportId>('NERACA');
  const [cashFlowMethod, setCashFlowMethod] = useState<'INDIRECT' | 'DIRECT'>('INDIRECT');
  const [incomeLayout, setIncomeLayout] = useState<'COMPARATIVE' | 'COMPACT'>('COMPARATIVE');
  const [includeSuratHeader, setIncludeSuratHeader] = useState(true);
  const [isPrintOpen, setIsPrintOpen] = useState(false);

  const activeSnapshot = useMemo(() => {
    const candidates = pdamSnapshots.filter(
      (s) =>
        (filter.year === 0 || s.year === filter.year) &&
        (filter.month === 'ALL' || s.month.toLowerCase() === filter.month.toLowerCase())
    );
    const list = candidates.length > 0 ? candidates : pdamSnapshots;
    return [...list].sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      const months = FISCAL_MONTHS as readonly string[];
      return months.indexOf(b.month) - months.indexOf(a.month);
    })[0];
  }, [pdamSnapshots, filter.year, filter.month]);

  const periodLabel = useMemo(() => {
    if (activeSnapshot && filter.month === 'ALL' && (filter.year === 0 || filter.year === activeSnapshot.year)) {
      return `Periode ${activeSnapshot.month} ${activeSnapshot.year} · Perumda Air Minum Tirta Saiyo`;
    }
    const yLabel = filter.year === 0 ? 'Semua Tahun Anggaran' : `Tahun Anggaran ${filter.year}`;
    const mLabel = filter.month === 'ALL' ? '' : ` · Bulan ${filter.month}`;
    return `${yLabel}${mLabel}`;
  }, [filter.year, filter.month, activeSnapshot]);

  const rkaReportRows = useMemo(() => {
    return rkaItems
      .filter((r) => {
        if (filter.year !== 0 && r.year !== filter.year) return false;
        if (filter.bidang !== 'ALL' && r.category !== filter.bidang) return false;
        if (filter.unitId !== 'ALL' && r.unitId !== filter.unitId) return false;
        return true;
      })
      .map((r) => {
        const subs = rkaSubItems.filter((s) => s.parentRkaId === r.id);
        const abs = computeRkaAbsorptionForTarget({
          parentRka: r,
          allSubItemsForParent: subs,
          allTransactions,
        });
        return { rka: r, abs };
      })
      .sort((a, b) => a.rka.code.localeCompare(b.rka.code));
  }, [rkaItems, rkaSubItems, allTransactions, filter.year, filter.bidang, filter.unitId]);

  const filteredInventory = useMemo(() => {
    return inventory.filter(
      (i) =>
        (filter.year === 0 || i.year === filter.year) &&
        (filter.unitId === 'ALL' || !i.unitId || i.unitId === filter.unitId)
    );
  }, [inventory, filter.year, filter.unitId]);

  const filteredPurchases = useMemo(() => {
    return purchases.filter(
      (p) =>
        (filter.year === 0 || p.year === filter.year) &&
        (filter.month === 'ALL' || p.month.toLowerCase() === filter.month.toLowerCase()) &&
        (filter.unitId === 'ALL' || !p.unitId || p.unitId === filter.unitId)
    );
  }, [purchases, filter.year, filter.month, filter.unitId]);

  const purchaseCategorySummary = useMemo(() => {
    if (activeSnapshot?.purchaseSummary && activeSnapshot.purchaseSummary.length > 0 && purchases.length === 0) {
      return activeSnapshot.purchaseSummary;
    }
    const targetMonth = filter.month !== 'ALL' ? filter.month : activeSnapshot?.month || 'September';
    const cats = Array.from(
      new Set([
        'Alat tulis kantor',
        'Pipa dan Accessoris',
        'Bahan Kimia',
        ...purchases.filter((p) => filter.year === 0 || p.year === filter.year).map((p) => p.category),
      ])
    );
    return cats.map((cat) => {
      const yearCat = purchases.filter(
        (p) => (filter.year === 0 || p.year === filter.year) && p.category === cat && p.status !== 'Dibatalkan'
      );
      const monthCat = yearCat.filter((p) => p.month.toLowerCase() === targetMonth.toLowerCase());
      return {
        category: cat,
        requestedMonthly: monthCat.reduce((s, p) => s + (p.requestedQty || 0), 0),
        realizedMonthly: monthCat.reduce((s, p) => s + (p.realizedQty || 0), 0),
        amountMonthly: monthCat.reduce((s, p) => s + (p.amount || 0), 0),
        requestedYtd: yearCat.reduce((s, p) => s + (p.requestedQty || 0), 0),
        realizedYtd: yearCat.reduce((s, p) => s + (p.realizedQty || 0), 0),
        amountYtd: yearCat.reduce((s, p) => s + (p.amount || 0), 0),
      };
    });
  }, [purchases, activeSnapshot, filter.year, filter.month]);

  const handleExportExcel = () => {
    let sheetData: Record<string, string | number>[] = [];
    const filename = `Laporan_PDAM_${selectedReport}_${filter.year || 'ALL'}.xlsx`;

    switch (selectedReport) {
      case 'SURAT_PENGANTAR': {
        sheetData = activeSnapshot
          ? [
              { Bagian: 'Nomor Surat', Isi: activeSnapshot.letterNumber },
              { Bagian: 'Tanggal', Isi: activeSnapshot.letterDate },
              { Bagian: 'Tujuan', Isi: activeSnapshot.recipient },
              { Bagian: 'Dasar Hukum', Isi: activeSnapshot.legalBasis },
              { Bagian: 'Direktur', Isi: activeSnapshot.directorName },
              { Bagian: 'Kabid Umum & Keuangan', Isi: `${activeSnapshot.kabidKeuName} (${activeSnapshot.kabidKeuNik})` },
              { Bagian: 'Kasubid Keuangan', Isi: `${activeSnapshot.kasubidKeuName} (${activeSnapshot.kasubidKeuNik})` },
            ]
          : [];
        break;
      }
      case 'RINGKASAN_KEGIATAN': {
        sheetData = (activeSnapshot?.summaryMetrics || []).map((m) => ({
          Kode: m.code,
          Bagian: m.section,
          Uraian: m.label,
          Satuan: m.unit,
          Bulan_Ini_Real: m.monthlyReal,
          Bulan_Ini_Anggaran: m.monthlyBudget,
          Bulan_Ini_Selisih: m.monthlyReal - m.monthlyBudget,
          SD_Bulan_Ini_Real: m.ytdReal,
          SD_Bulan_Ini_Anggaran: m.ytdBudget,
          SD_Bulan_Ini_Selisih: m.ytdReal - m.ytdBudget,
        }));
        break;
      }
      case 'NERACA': {
        sheetData = [
          ...statements.balanceSheet.currentAssets.map((l) => {
            const sign = isContraAssetAccount(l.account) ? -1 : 1;
            const cur = sign * l.netSignedBalance;
            const prev = sign * l.prevMonthBalance;
            return {
              Kelompok: 'Aset Lancar',
              Kode: l.account.code,
              Akun: l.account.name,
              Bulan_Ini: cur,
              Bulan_Lalu: prev,
              Naik_Turun: cur - prev,
            };
          }),
          ...statements.balanceSheet.fixedAssets.map((l) => ({
            Kelompok: 'Aset Tetap',
            Kode: l.account.code,
            Akun: l.account.name,
            Bulan_Ini: l.netSignedBalance,
            Bulan_Lalu: l.prevMonthBalance,
            Naik_Turun: l.netSignedBalance - l.prevMonthBalance,
          })),
          ...statements.balanceSheet.accumulatedDepreciation.map((l) => ({
            Kelompok: 'Akumulasi Penyusutan',
            Kode: l.account.code,
            Akun: l.account.name,
            Bulan_Ini: -l.netSignedBalance,
            Bulan_Lalu: -l.prevMonthBalance,
            Naik_Turun: -(l.netSignedBalance - l.prevMonthBalance),
          })),
          ...statements.balanceSheet.currentLiabilities.map((l) => ({
            Kelompok: 'Kewajiban Lancar',
            Kode: l.account.code,
            Akun: l.account.name,
            Bulan_Ini: l.netSignedBalance,
            Bulan_Lalu: l.prevMonthBalance,
            Naik_Turun: l.netSignedBalance - l.prevMonthBalance,
          })),
          ...statements.balanceSheet.longTermLiabilities.map((l) => ({
            Kelompok: 'Kewajiban Jangka Panjang',
            Kode: l.account.code,
            Akun: l.account.name,
            Bulan_Ini: l.netSignedBalance,
            Bulan_Lalu: l.prevMonthBalance,
            Naik_Turun: l.netSignedBalance - l.prevMonthBalance,
          })),
          ...statements.balanceSheet.equityAccounts.map((l) => ({
            Kelompok: 'Ekuitas',
            Kode: l.account.code,
            Akun: l.account.name,
            Bulan_Ini: l.netSignedBalance,
            Bulan_Lalu: l.prevMonthBalance,
            Naik_Turun: l.netSignedBalance - l.prevMonthBalance,
          })),
          {
            Kelompok: 'Ekuitas',
            Kode: '70.09.10',
            Akun: 'Laba / (Rugi) Tahun Berjalan',
            Bulan_Ini: statements.balanceSheet.currentYearEarnings,
            Bulan_Lalu: statements.balanceSheet.prevCurrentYearEarnings,
            Naik_Turun:
              statements.balanceSheet.currentYearEarnings - statements.balanceSheet.prevCurrentYearEarnings,
          },
        ];
        break;
      }
      case 'LABA_RUGI': {
        const rows = [
          ...statements.incomeStatement.operatingRevenues.map((l) => ({ grp: 'Pendapatan Usaha', l })),
          ...statements.incomeStatement.otherRevenues.map((l) => ({ grp: 'Pendapatan Lain-Lain', l })),
          ...statements.incomeStatement.directExpenses.map((l) => ({ grp: 'Beban Operasi Langsung', l })),
          ...statements.incomeStatement.adminExpenses.map((l) => ({ grp: 'Beban Administrasi & Umum', l })),
          ...statements.incomeStatement.depreciationExpenses.map((l) => ({ grp: 'Beban Penyusutan', l })),
          ...statements.incomeStatement.otherExpenses.map((l) => ({ grp: 'Beban Lain-Lain', l })),
        ];
        sheetData = rows.map(({ grp, l }) => ({
          Kelompok: grp,
          Kode: l.account.code,
          Akun: l.account.name,
          Bulan_Ini_Real: l.monthlyActual,
          Bulan_Ini_Anggaran: l.monthlyBudget,
          Bulan_Ini_Selisih: l.monthlyActual - l.monthlyBudget,
          SD_Bulan_Ini_Real: l.netSignedBalance,
          SD_Bulan_Ini_Anggaran: l.ytdBudget,
          SD_Bulan_Ini_Selisih: l.netSignedBalance - l.ytdBudget,
        }));
        break;
      }
      case 'ARUS_KAS': {
        if (cashFlowMethod === 'INDIRECT') {
          const snapCf = activeSnapshot?.indirectCashFlow;
          const ind = statements.indirectCashFlow;
          sheetData = snapCf
            ? [
                { Aktivitas: 'Operasi', Uraian: 'Laba (Rugi) Bulan Ini', Nilai: snapCf.netIncomeMonthly },
                { Aktivitas: 'Operasi', Uraian: 'Penyusutan Aktiva Tetap', Nilai: snapCf.depreciationAddBack },
                ...snapCf.workingCapitalChanges.map((w) => ({
                  Aktivitas: 'Modal Kerja',
                  Uraian: w.label,
                  Nilai: w.amount,
                })),
                { Aktivitas: 'Operasi', Uraian: 'Arus Kas Bersih Aktivitas Operasi', Nilai: snapCf.netOperatingCashFlow },
                { Aktivitas: 'Investasi', Uraian: 'Penambahan Aktiva Tetap (Investasi)', Nilai: snapCf.investingCashFlow },
                { Aktivitas: 'Pendanaan', Uraian: 'Arus Kas Aktivitas Pendanaan', Nilai: snapCf.financingCashFlow },
                { Aktivitas: 'Ringkasan', Uraian: 'Kenaikan (Penurunan) Kas', Nilai: snapCf.netCashChange },
                { Aktivitas: 'Ringkasan', Uraian: 'Saldo Kas Awal Bulan', Nilai: snapCf.beginningCash },
                { Aktivitas: 'Ringkasan', Uraian: 'Saldo Kas Akhir Bulan', Nilai: snapCf.endingCash },
              ]
            : [
                { Aktivitas: 'Operasi', Uraian: 'Laba (Rugi) Periode', Nilai: ind.netIncome },
                { Aktivitas: 'Operasi', Uraian: 'Penyusutan Aktiva Tetap', Nilai: ind.depreciationAddBack },
                { Aktivitas: 'Operasi', Uraian: 'Perubahan Modal Kerja Bersih', Nilai: ind.workingCapitalDelta },
                { Aktivitas: 'Operasi', Uraian: 'Arus Kas Bersih Operasi', Nilai: ind.netOperatingCashFlow },
                { Aktivitas: 'Investasi', Uraian: 'Arus Kas Bersih Investasi', Nilai: ind.netInvestingCashFlow },
                { Aktivitas: 'Pendanaan', Uraian: 'Arus Kas Bersih Pendanaan', Nilai: ind.netFinancingCashFlow },
                { Aktivitas: 'Ringkasan', Uraian: 'Saldo Kas Awal', Nilai: ind.beginningCash },
                { Aktivitas: 'Ringkasan', Uraian: 'Saldo Kas Akhir', Nilai: ind.endingCash },
              ];
        } else {
          sheetData = [
            { Aktivitas: 'Operasional', Uraian: 'Arus Kas Masuk Operasional', Nilai: statements.cashFlow.operatingInflows },
            { Aktivitas: 'Operasional', Uraian: 'Arus Kas Keluar Operasional', Nilai: -statements.cashFlow.operatingOutflows },
            { Aktivitas: 'Investasi', Uraian: 'Arus Kas Masuk Investasi', Nilai: statements.cashFlow.investingInflows },
            { Aktivitas: 'Investasi', Uraian: 'Arus Kas Keluar Investasi (Belanja Modal)', Nilai: -statements.cashFlow.investingOutflows },
            { Aktivitas: 'Pendanaan', Uraian: 'Arus Kas Masuk Pendanaan', Nilai: statements.cashFlow.financingInflows },
            { Aktivitas: 'Pendanaan', Uraian: 'Arus Kas Keluar Pendanaan', Nilai: -statements.cashFlow.financingOutflows },
            { Aktivitas: 'Ringkasan', Uraian: 'Saldo Kas Awal', Nilai: statements.cashFlow.beginningCash },
            { Aktivitas: 'Ringkasan', Uraian: 'Saldo Kas Akhir', Nilai: statements.cashFlow.endingCash },
          ];
        }
        break;
      }
      case 'EFISIENSI_PENAGIHAN': {
        sheetData = (activeSnapshot?.collectionEfficiency || []).map((u) => ({
          Unit: u.unitName,
          Rek_Bulan_Lalu: u.prevBilling,
          Tunggakan_Tertagih: u.arrearsCollected,
          Lancar_Tertagih: u.currentCollected,
          Total_Tertagih: u.totalCollected,
          Efisiensi_Lancar_Pct: u.currentEfficiencyPct,
          Efisiensi_Total_Pct: u.totalEfficiencyPct,
        }));
        break;
      }
      case 'EFEKTIVITAS_PENAGIHAN': {
        sheetData = (activeSnapshot?.tariffEffectiveness || []).map((t) => ({
          Kode_Gol: t.tariffCode,
          Kelompok_Tarif: t.tariffName,
          Piutang_1_Bln: t.receivableMonth1,
          Piutang_2_Bln: t.receivableMonth2,
          Piutang_3_Bln: t.receivableMonth3,
          Piutang_Above_3_Bln: t.receivableAbove3Months,
          Total_Piutang: t.totalReceivable,
          Penerimaan_Tertagih: t.collectedAmount,
          Efektivitas_Pct: t.effectivenessPct,
        }));
        break;
      }
      case 'PEMBELIAN_PERSEDIAAN': {
        sheetData = [
          ...purchaseCategorySummary.map((c) => ({
            Bagian: 'Rekap Pembelian',
            Kode_Atau_Kategori: c.category,
            Uraian: `Permintaan Bln: ${c.requestedMonthly} | Realisasi Bln: ${c.realizedMonthly} | YTD: ${c.realizedYtd}`,
            Nilai_Bulan_Ini: c.amountMonthly,
            Nilai_SD_Bulan_Ini: c.amountYtd,
          })),
          ...filteredInventory.map((inv) => ({
            Bagian: 'Saldo Persediaan',
            Kode_Atau_Kategori: inv.coaCode,
            Uraian: `${inv.itemCode} - ${inv.name}`,
            Nilai_Bulan_Ini: inv.prevMonthValue,
            Nilai_SD_Bulan_Ini: inv.endingValue,
          })),
        ];
        break;
      }
      case 'IKHTISAR_REKENING_AIR': {
        sheetData = (activeSnapshot?.drdSummary || []).map((d) => ({
          Kelompok: d.tariffGroup,
          Golongan_Tarif: d.tariffName,
          Pelanggan: d.customerCount,
          Rek_Bulan_Ini: d.billedSlipsMonthly,
          M3_Bulan_Ini: d.cubicMetersMonthly,
          Rupiah_Bulan_Ini: d.billedAmountMonthly,
          Rek_YTD: d.billedSlipsYtd,
          M3_YTD: d.cubicMetersYtd,
          Rupiah_YTD: d.billedAmountYtd,
        }));
        break;
      }
      case 'REKAP_AKTIVA': {
        sheetData = (activeSnapshot?.assetGroupSummary || []).map((a) => ({
          Kode: a.groupCode,
          Kelompok_Aktiva: a.groupName,
          Nilai_Perolehan: a.acquisitionCost,
          Akum_Peny_Thn_Lalu: a.accumDepPrevYear,
          Peny_Bulan_Ini: a.depreciationMonthly,
          Peny_YTD: a.depreciationYtd,
          Akum_Peny_Akhir: a.accumDepEnding,
          Nilai_Buku_Akhir: a.bookValueEnding,
        }));
        break;
      }
      case 'PRODUKSI_DISTRIBUSI': {
        sheetData = (activeSnapshot?.productionDistribution || []).map((p) => ({
          Unit: p.unitName,
          Kap_Terpasang_Lps: p.installedCapacityLps,
          Kap_Riil_Lps: p.realCapacityLps,
          Produksi_M3_Bln: p.producedM3Monthly,
          Distribusi_M3_Bln: p.distributedM3Monthly,
          Terjual_M3_Bln: p.soldM3Monthly,
          NRW_M3_Bln: p.nrwM3Monthly,
          NRW_Pct_Bln: p.nrwPctMonthly,
          Produksi_M3_YTD: p.producedM3Ytd,
          Distribusi_M3_YTD: p.distributedM3Ytd,
          Terjual_M3_YTD: p.soldM3Ytd,
          NRW_Pct_YTD: p.nrwPctYtd,
        }));
        break;
      }
      case 'SAMBUNGAN_LANGGANAN': {
        sheetData = (activeSnapshot?.customerConnections || []).map((c) => ({
          Unit: c.unitName,
          Awal_Aktif: c.beginningActive,
          Non_Aktif: c.inactiveCount,
          Putus_Cabut: c.disconnectedCount,
          Buka_Kembali: c.reconnectedCount,
          Sambungan_Baru: c.newConnectionsCount,
          Akhir_Aktif: c.endingActive,
        }));
        break;
      }
      case 'KONDISI_KARYAWAN': {
        sheetData = (activeSnapshot?.employeeComposition || []).map((e) => ({
          Unit_Bagian: e.unitName,
          Direksi: e.direksiCount,
          Pegawai_Tetap: e.permanentCount,
          Pegawai_Kontrak: e.contractCount,
          Total: e.totalCount,
        }));
        break;
      }
      case 'PERUBAHAN_EKUITAS': {
        sheetData = [
          { Komponen: 'Penyertaan Modal Awal', Nilai: statements.equityChanges.beginningCapital },
          { Komponen: 'Laba Ditahan / Cadangan Awal', Nilai: statements.equityChanges.retainedEarningsOpening },
          { Komponen: 'Penyesuaian Ekuitas Periode', Nilai: statements.equityChanges.equityAdjustments },
          { Komponen: 'Laba / (Rugi) Bersih Periode Berjalan', Nilai: statements.equityChanges.netIncome },
          { Komponen: 'Saldo Ekuitas Akhir', Nilai: statements.equityChanges.endingEquity },
        ];
        break;
      }
      case 'BUKU_BESAR':
      case 'NERACA_SALDO': {
        sheetData = statements.ledgers.map((l) => ({
          Kode: l.account.code,
          Nama_Akun: l.account.name,
          Tipe: l.account.type,
          Saldo_Awal_D: l.openingDebit,
          Saldo_Awal_K: l.openingCredit,
          Mutasi_Debit: l.periodDebit,
          Mutasi_Kredit: l.periodCredit,
          Saldo_Akhir_D: l.endingDebit,
          Saldo_Akhir_K: l.endingCredit,
        }));
        break;
      }
      case 'KAS_BANK': {
        sheetData = cashBankSummary.accounts.map((a) => ({
          Kode: a.code,
          Nama_Rekening: a.name,
          Jenis: a.accountKind,
          Saldo_Awal: a.openingBalance,
          Total_Masuk: a.totalIn + a.transferIn,
          Total_Keluar: a.totalOut + a.transferOut,
          Saldo_Akhir: a.currentBalance,
        }));
        break;
      }
      case 'UTANG_PIUTANG': {
        sheetData = receivablesPayables.map((rp) => ({
          Jenis: rp.kind,
          Nomor_Dokumen: rp.documentNumber,
          Pihak: rp.partyName,
          Jatuh_Tempo: rp.dueDate,
          Nominal_Awal: rp.originalAmount,
          Terbayar: rp.paidAmount,
          Sisa: rp.remainingAmount,
          Status: rp.status,
        }));
        break;
      }
      case 'REALISASI_RKA': {
        sheetData = rkaReportRows.map(({ rka, abs }) => ({
          Kode_RKA: rka.code,
          Program_Kegiatan: rka.programName,
          Bidang: rka.category,
          Unit: rka.unitName,
          Pagu_Anggaran: abs.budgetAmount,
          Realisasi_Sebelumnya: abs.previousRealization,
          Realisasi_Keuangan: abs.postedFinanceRealization,
          Total_Realisasi: abs.totalRealization,
          Sisa_Anggaran: abs.remainingBudget,
          Persentase_Serap: `${abs.absorptionPct}%`,
        }));
        break;
      }
    }

    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, selectedReport.slice(0, 31));
    XLSX.writeFile(wb, filename);
  };

  const renderMissingSnapshotNotice = () => (
    <div className="p-8 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50">
      <Droplets className="w-8 h-8 text-slate-400 mx-auto mb-2" />
      <p className="text-xs font-bold text-slate-800">
        Snapshot Operasional & Keuangan PDAM Belum Dimuat
      </p>
      <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
        Buka tab <strong>Operasional & Penagihan PDAM</strong> lalu klik tombol{' '}
        <strong>&quot;Muat Baseline Resmi PDAM (Sep 2026)&quot;</strong> untuk mengisi seluruh
        laporan resmi Permendagri 118/2018.
      </p>
    </div>
  );

  const renderSuratPengantarBanner = () => {
    if (!activeSnapshot) return null;
    return (
      <div className="p-4 border border-slate-300 rounded-xl bg-slate-50/60 space-y-2 text-xs">
        <div className="flex flex-wrap justify-between gap-2 text-[11px]">
          <div>
            <p className="font-bold text-slate-900">
              Nomor: {activeSnapshot.letterNumber}
            </p>
            <p className="text-slate-600">Hal: Penyampaian Laporan Keuangan & Manajemen Bulan {activeSnapshot.month} {activeSnapshot.year}</p>
          </div>
          <p className="font-medium text-slate-700">{activeSnapshot.letterDate}</p>
        </div>
        <p className="text-[11px] text-slate-800 font-semibold">{activeSnapshot.recipient}</p>
        <p className="text-[11px] text-slate-600 italic">{activeSnapshot.legalBasis}</p>
      </div>
    );
  };

  const renderReportBody = (isPrintView = false) => {
    const tblClass = isPrintView
      ? 'w-full text-left border-collapse text-[10px]'
      : 'w-full text-left border-collapse text-xs';

    switch (selectedReport) {
      case 'SURAT_PENGANTAR': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        return (
          <div className="p-5 sm:p-8 border border-slate-300 rounded-xl bg-white space-y-5 text-xs text-slate-800 leading-relaxed">
            <div className="flex flex-wrap justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="space-y-0.5">
                <p>Nomor : <span className="font-mono font-bold">{activeSnapshot.letterNumber}</span></p>
                <p>Sifat : Biasa</p>
                <p>Lampiran : 1 (Satu) Berkas</p>
                <p>Perihal : <span className="font-bold">Laporan Keuangan & Manajemen Bulan {activeSnapshot.month} {activeSnapshot.year}</span></p>
              </div>
              <div className="text-right">
                <p className="font-semibold">{activeSnapshot.letterDate}</p>
              </div>
            </div>

            <div className="space-y-1">
              <p>Kepada Yth.</p>
              <p className="font-bold">{activeSnapshot.recipient}</p>
              <p>di Lubuk Sikaping</p>
            </div>

            <div className="space-y-3 text-justify">
              <p>Dengan hormat,</p>
              <p>
                Memenuhi ketentuan <strong>{activeSnapshot.legalBasis}</strong>, bersama ini kami
                sampaikan Laporan Keuangan dan Kinerja Operasional Perusahaan Umum Daerah Air Minum
                Tirta Saiyo Kabupaten Pasaman untuk periode bulan{' '}
                <strong>{activeSnapshot.month} {activeSnapshot.year}</strong> yang mencakup:
                Ringkasan Kegiatan, Neraca Komparatif, Laporan Arus Kas, Laporan Laba Rugi
                Komparatif Anggaran, Efisiensi &amp; Efektivitas Penagihan, Pembelian &amp;
                Persediaan, Ikhtisar Rekening Air (DRD), Rekapitulasi Aktiva Tetap, Produksi &amp;
                NRW, Sambungan Langganan, serta Kondisi Karyawan.
              </p>
              <p>
                Demikian laporan ini disampaikan sebagai bahan pengawasan, evaluasi kinerja, dan
                pertanggungjawaban pengelolaan BUMD. Atas perhatian dan arahan Bapak/Ibu, kami
                ucapkan terima kasih.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-slate-200 text-center">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-[11px] text-slate-500">Disusun Oleh · Kasubid Keuangan</p>
                <p className="mt-8 font-bold text-slate-900 underline">{activeSnapshot.kasubidKeuName}</p>
                <p className="text-[11px] font-mono text-slate-600">NIK. {activeSnapshot.kasubidKeuNik}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-[11px] text-slate-500">Diperiksa Oleh · Kabid Umum &amp; Keuangan</p>
                <p className="mt-8 font-bold text-slate-900 underline">{activeSnapshot.kabidKeuName}</p>
                <p className="text-[11px] font-mono text-slate-600">NIK. {activeSnapshot.kabidKeuNik}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-[11px] text-slate-500">Mengetahui / Menyetujui · Direktur</p>
                <p className="mt-8 font-bold text-slate-900 underline">{activeSnapshot.directorName}</p>
                <p className="text-[11px] text-slate-600">Perumda Air Minum Tirta Saiyo</p>
              </div>
            </div>
          </div>
        );
      }

      case 'RINGKASAN_KEGIATAN': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const keu = activeSnapshot.summaryMetrics.filter((m) => m.section === 'KEUANGAN');
        const ops = activeSnapshot.summaryMetrics.filter((m) => m.section === 'PRODUKSI_DISTRIBUSI');
        const fmtMetric = (val: number, unit: string) =>
          unit === 'Rp' ? formatRp(val) : `${val.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${unit}`;

        return (
          <div className="space-y-4">
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                A. RINGKASAN KEUANGAN (BULAN INI VS ANGGARAN &amp; S/D BULAN INI)
              </div>
              <table className={tblClass}>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-2 px-3">Kode</th>
                    <th className="py-2 px-3">Uraian Indikator</th>
                    <th className="py-2 px-3 text-right">Bln Ini (Real)</th>
                    <th className="py-2 px-3 text-right">Bln Ini (Angg)</th>
                    <th className="py-2 px-3 text-right">% Bln</th>
                    <th className="py-2 px-3 text-right">S/D Bln (Real)</th>
                    <th className="py-2 px-3 text-right">S/D Bln (Angg)</th>
                    <th className="py-2 px-3 text-right">% YTD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keu.map((m) => (
                    <tr key={m.code} className={m.code === '4' ? 'bg-emerald-50/70 font-bold' : ''}>
                      <td className="py-1.5 px-3 font-mono font-bold text-slate-600">{m.code}</td>
                      <td className="py-1.5 px-3">{m.label}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{fmtMetric(m.monthlyReal, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-500">{fmtMetric(m.monthlyBudget, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{pctVal(m.monthlyReal, m.monthlyBudget)}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-semibold">{fmtMetric(m.ytdReal, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-500">{fmtMetric(m.ytdBudget, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-semibold">{pctVal(m.ytdReal, m.ytdBudget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                B. RINGKASAN PRODUKSI, DISTRIBUSI &amp; PELANGGAN
              </div>
              <table className={tblClass}>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-2 px-3">Kode</th>
                    <th className="py-2 px-3">Uraian Indikator Teknik</th>
                    <th className="py-2 px-3 text-right">Bln Ini (Real)</th>
                    <th className="py-2 px-3 text-right">Bln Ini (Target)</th>
                    <th className="py-2 px-3 text-right">% Bln</th>
                    <th className="py-2 px-3 text-right">S/D Bln (Real)</th>
                    <th className="py-2 px-3 text-right">S/D Bln (Target)</th>
                    <th className="py-2 px-3 text-right">% YTD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ops.map((m) => (
                    <tr key={m.code} className={m.code === 'B.11' ? 'bg-amber-50/70 font-semibold' : ''}>
                      <td className="py-1.5 px-3 font-mono font-bold text-slate-600">{m.code}</td>
                      <td className="py-1.5 px-3">{m.label}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{fmtMetric(m.monthlyReal, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-500">{fmtMetric(m.monthlyBudget, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{pctVal(m.monthlyReal, m.monthlyBudget)}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-semibold">{fmtMetric(m.ytdReal, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono text-slate-500">{fmtMetric(m.ytdBudget, m.unit)}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-semibold">{pctVal(m.ytdReal, m.ytdBudget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'NERACA': {
        const bs = statements.balanceSheet;
        const deltaCell = (curr: number, prev: number) => {
          const d = curr - prev;
          return (
            <span className={d < 0 ? 'text-rose-700' : d > 0 ? 'text-emerald-800' : 'text-slate-500'}>
              {formatRp(d)}
            </span>
          );
        };

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* AKTIVA KOMPARATIF */}
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                  ASET (AKTIVA) — KOMPARATIF BULAN INI VS BULAN LALU
                </div>
                <table className={tblClass}>
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-600">
                      <th className="py-1.5 px-2.5">Kode &amp; Nama Akun</th>
                      <th className="py-1.5 px-2.5 text-right">Bulan Ini</th>
                      <th className="py-1.5 px-2.5 text-right">Bulan Lalu</th>
                      <th className="py-1.5 px-2.5 text-right">Naik / (Turun)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={4} className="py-1.5 px-2.5">Aset Lancar</td>
                    </tr>
                    {bs.currentAssets.map((l) => {
                      const sign = isContraAssetAccount(l.account) ? -1 : 1;
                      const curr = sign * l.netSignedBalance;
                      const prev = sign * l.prevMonthBalance;
                      return (
                        <tr key={l.account.id}>
                          <td className={`py-1 px-2.5 ${sign < 0 ? 'text-rose-700 italic' : ''}`}>
                            {l.account.code} · {l.account.name}
                          </td>
                          <td className="py-1 px-2.5 text-right font-mono tabular-nums">{formatRp(curr)}</td>
                          <td className="py-1 px-2.5 text-right font-mono tabular-nums text-slate-500">{formatRp(prev)}</td>
                          <td className="py-1 px-2.5 text-right font-mono tabular-nums">{deltaCell(curr, prev)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-slate-50/90 font-bold">
                      <td className="py-1.5 px-2.5">Jumlah Aset Lancar</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(bs.totalCurrentAssets)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono text-slate-600">{formatRp(bs.prevTotalCurrentAssets)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{deltaCell(bs.totalCurrentAssets, bs.prevTotalCurrentAssets)}</td>
                    </tr>

                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={4} className="py-1.5 px-2.5">Aset Tetap &amp; Akumulasi Penyusutan</td>
                    </tr>
                    {bs.fixedAssets.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1 px-2.5">{l.account.code} · {l.account.name}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{formatRp(l.netSignedBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono text-slate-500">{formatRp(l.prevMonthBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{deltaCell(l.netSignedBalance, l.prevMonthBalance)}</td>
                      </tr>
                    ))}
                    {bs.accumulatedDepreciation.map((l) => (
                      <tr key={l.account.id} className="text-rose-700">
                        <td className="py-1 px-2.5">{l.account.code} · {l.account.name}</td>
                        <td className="py-1 px-2.5 text-right font-mono">({formatRp(l.netSignedBalance)})</td>
                        <td className="py-1 px-2.5 text-right font-mono">({formatRp(l.prevMonthBalance)})</td>
                        <td className="py-1 px-2.5 text-right font-mono">{deltaCell(-l.netSignedBalance, -l.prevMonthBalance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/90 font-bold">
                      <td className="py-1.5 px-2.5">Nilai Buku Aset Tetap Bersih</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(bs.netFixedAssets)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono text-slate-600">{formatRp(bs.prevNetFixedAssets)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{deltaCell(bs.netFixedAssets, bs.prevNetFixedAssets)}</td>
                    </tr>
                    <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                      <td className="py-2 px-2.5">TOTAL ASET (AKTIVA)</td>
                      <td className="py-2 px-2.5 text-right font-mono">{formatRp(bs.totalAssets)}</td>
                      <td className="py-2 px-2.5 text-right font-mono">{formatRp(bs.prevTotalAssets)}</td>
                      <td className="py-2 px-2.5 text-right font-mono">{deltaCell(bs.totalAssets, bs.prevTotalAssets)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* PASIVA KOMPARATIF */}
              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                  KEWAJIBAN &amp; EKUITAS (PASIVA) — KOMPARATIF
                </div>
                <table className={tblClass}>
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-600">
                      <th className="py-1.5 px-2.5">Kode &amp; Nama Akun</th>
                      <th className="py-1.5 px-2.5 text-right">Bulan Ini</th>
                      <th className="py-1.5 px-2.5 text-right">Bulan Lalu</th>
                      <th className="py-1.5 px-2.5 text-right">Naik / (Turun)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={4} className="py-1.5 px-2.5">Kewajiban Lancar</td>
                    </tr>
                    {bs.currentLiabilities.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1 px-2.5">{l.account.code} · {l.account.name}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{formatRp(l.netSignedBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono text-slate-500">{formatRp(l.prevMonthBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{deltaCell(l.netSignedBalance, l.prevMonthBalance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={4} className="py-1.5 px-2.5">Kewajiban Jangka Panjang</td>
                    </tr>
                    {bs.longTermLiabilities.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1 px-2.5">{l.account.code} · {l.account.name}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{formatRp(l.netSignedBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono text-slate-500">{formatRp(l.prevMonthBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{deltaCell(l.netSignedBalance, l.prevMonthBalance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/90 font-bold">
                      <td className="py-1.5 px-2.5">Total Kewajiban</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(bs.totalLiabilities)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono text-slate-600">{formatRp(bs.prevTotalLiabilities)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{deltaCell(bs.totalLiabilities, bs.prevTotalLiabilities)}</td>
                    </tr>

                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={4} className="py-1.5 px-2.5">Modal &amp; Cadangan (Ekuitas)</td>
                    </tr>
                    {bs.equityAccounts.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1 px-2.5">{l.account.code} · {l.account.name}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{formatRp(l.netSignedBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono text-slate-500">{formatRp(l.prevMonthBalance)}</td>
                        <td className="py-1 px-2.5 text-right font-mono">{deltaCell(l.netSignedBalance, l.prevMonthBalance)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1 px-2.5">70.09.10 · Laba / (Rugi) Tahun Berjalan</td>
                      <td className="py-1 px-2.5 text-right font-mono">{formatRp(bs.currentYearEarnings)}</td>
                      <td className="py-1 px-2.5 text-right font-mono text-slate-500">{formatRp(bs.prevCurrentYearEarnings)}</td>
                      <td className="py-1 px-2.5 text-right font-mono">{deltaCell(bs.currentYearEarnings, bs.prevCurrentYearEarnings)}</td>
                    </tr>
                    <tr className="bg-slate-50/90 font-bold">
                      <td className="py-1.5 px-2.5">Total Ekuitas</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(bs.totalEquity)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono text-slate-600">{formatRp(bs.prevTotalEquity)}</td>
                      <td className="py-1.5 px-2.5 text-right font-mono">{deltaCell(bs.totalEquity, bs.prevTotalEquity)}</td>
                    </tr>
                    <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                      <td className="py-2 px-2.5">TOTAL KEWAJIBAN &amp; EKUITAS</td>
                      <td className="py-2 px-2.5 text-right font-mono">{formatRp(bs.totalLiabilitiesAndEquity)}</td>
                      <td className="py-2 px-2.5 text-right font-mono">{formatRp(bs.prevTotalLiabilitiesAndEquity)}</td>
                      <td className="py-2 px-2.5 text-right font-mono">{deltaCell(bs.totalLiabilitiesAndEquity, bs.prevTotalLiabilitiesAndEquity)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      }

      case 'LABA_RUGI': {
        const is = statements.incomeStatement;
        if (incomeLayout === 'COMPACT') {
          return (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className={tblClass}>
                <tbody className="divide-y divide-slate-100">
                  <tr className="bg-slate-50 font-bold text-slate-800">
                    <td colSpan={2} className="py-2 px-3">PENDAPATAN USAHA &amp; LAIN-LAIN</td>
                  </tr>
                  {[...is.operatingRevenues, ...is.otherRevenues].map((l) => (
                    <tr key={l.account.id}>
                      <td className="py-1.5 px-3">{l.account.code} · {l.account.name}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(l.netSignedBalance)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td className="py-2 px-3">Total Pendapatan</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-800">{formatRp(is.totalRevenue)}</td>
                  </tr>

                  <tr className="bg-slate-50 font-bold text-slate-800">
                    <td colSpan={2} className="py-2 px-3">BEBAN OPERASIONAL, ADMINISTRASI, PENYUSUTAN &amp; LAINNYA</td>
                  </tr>
                  {[...is.directExpenses, ...is.adminExpenses, ...is.depreciationExpenses, ...is.otherExpenses].map((l) => (
                    <tr key={l.account.id}>
                      <td className="py-1.5 px-3">{l.account.code} · {l.account.name}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(l.netSignedBalance)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td className="py-2 px-3">Total Beban</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-rose-700">{formatRp(is.totalExpense)}</td>
                  </tr>

                  <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                    <td className="py-2.5 px-3">LABA / (RUGI) BERSIH</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatRp(is.netIncome)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        }

        const renderSectionRows = (
          title: string,
          rows: typeof is.operatingRevenues,
          subLabel: string
        ) => {
          const sumMReal = rows.reduce((s, r) => s + r.monthlyActual, 0);
          const sumMBudg = rows.reduce((s, r) => s + r.monthlyBudget, 0);
          const sumYReal = rows.reduce((s, r) => s + r.netSignedBalance, 0);
          const sumYBudg = rows.reduce((s, r) => s + r.ytdBudget, 0);
          return (
            <>
              <tr className="bg-slate-100 font-bold text-slate-800">
                <td colSpan={9} className="py-1.5 px-2.5">{title}</td>
              </tr>
              {rows.map((l) => (
                <tr key={l.account.id} className="hover:bg-slate-50/70">
                  <td className="py-1 px-2.5">{l.account.code} · {l.account.name}</td>
                  <td className="py-1 px-2 text-right font-mono">{formatRp(l.monthlyActual)}</td>
                  <td className="py-1 px-2 text-right font-mono text-slate-500">{formatRp(l.monthlyBudget)}</td>
                  <td className="py-1 px-2 text-right font-mono">{formatRp(l.monthlyActual - l.monthlyBudget)}</td>
                  <td className="py-1 px-2 text-right font-mono">{pctVal(l.monthlyActual, l.monthlyBudget)}</td>
                  <td className="py-1 px-2 text-right font-mono font-semibold">{formatRp(l.netSignedBalance)}</td>
                  <td className="py-1 px-2 text-right font-mono text-slate-500">{formatRp(l.ytdBudget)}</td>
                  <td className="py-1 px-2 text-right font-mono">{formatRp(l.netSignedBalance - l.ytdBudget)}</td>
                  <td className="py-1 px-2 text-right font-mono font-semibold">{pctVal(l.netSignedBalance, l.ytdBudget)}</td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className="py-1.5 px-2.5">{subLabel}</td>
                <td className="py-1.5 px-2 text-right font-mono">{formatRp(sumMReal)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{formatRp(sumMBudg)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{formatRp(sumMReal - sumMBudg)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{pctVal(sumMReal, sumMBudg)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{formatRp(sumYReal)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{formatRp(sumYBudg)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{formatRp(sumYReal - sumYBudg)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{pctVal(sumYReal, sumYBudg)}</td>
              </tr>
            </>
          );
        };

        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-700">
                  <th rowSpan={2} className="py-2 px-2.5">Kode &amp; Uraian Pos Laba Rugi</th>
                  <th colSpan={4} className="py-1 px-2 text-center border-b border-l border-slate-200 bg-emerald-50/50">
                    BULAN INI
                  </th>
                  <th colSpan={4} className="py-1 px-2 text-center border-b border-l border-slate-200 bg-teal-50/50">
                    S/D BULAN INI (YTD)
                  </th>
                </tr>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-semibold text-slate-600">
                  <th className="py-1 px-2 text-right border-l border-slate-200">Realisasi</th>
                  <th className="py-1 px-2 text-right">Anggaran</th>
                  <th className="py-1 px-2 text-right">Lebih/(Krg)</th>
                  <th className="py-1 px-2 text-right">%</th>
                  <th className="py-1 px-2 text-right border-l border-slate-200">Realisasi</th>
                  <th className="py-1 px-2 text-right">Anggaran</th>
                  <th className="py-1 px-2 text-right">Lebih/(Krg)</th>
                  <th className="py-1 px-2 text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {renderSectionRows('PENDAPATAN USAHA', is.operatingRevenues, 'Jumlah Pendapatan Usaha')}
                {renderSectionRows('PENDAPATAN LAIN-LAIN', is.otherRevenues, 'Jumlah Pendapatan Lain-Lain')}
                <tr className="bg-emerald-50/60 font-bold text-emerald-950">
                  <td className="py-1.5 px-2.5">JUMLAH PENDAPATAN</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.monthlyTotalRevenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.budgetMonthlyRevenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.monthlyTotalRevenue - is.budgetMonthlyRevenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{pctVal(is.monthlyTotalRevenue, is.budgetMonthlyRevenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.totalRevenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.budgetYtdRevenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.totalRevenue - is.budgetYtdRevenue)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{pctVal(is.totalRevenue, is.budgetYtdRevenue)}</td>
                </tr>

                {renderSectionRows('BEBAN OPERASI LANGSUNG', is.directExpenses, 'Jumlah Beban Operasi Langsung')}
                {renderSectionRows('BEBAN ADMINISTRASI & UMUM', is.adminExpenses, 'Jumlah Beban Administrasi & Umum')}
                {renderSectionRows('BEBAN PENYUSUTAN', is.depreciationExpenses, 'Jumlah Beban Penyusutan')}
                {is.otherExpenses.length > 0 && renderSectionRows('BEBAN LAIN-LAIN', is.otherExpenses, 'Jumlah Beban Lain-Lain')}

                <tr className="bg-rose-50/60 font-bold text-rose-950">
                  <td className="py-1.5 px-2.5">JUMLAH BEBAN</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.monthlyTotalExpense)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.budgetMonthlyExpense)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.monthlyTotalExpense - is.budgetMonthlyExpense)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{pctVal(is.monthlyTotalExpense, is.budgetMonthlyExpense)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.totalExpense)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.budgetYtdExpense)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{formatRp(is.totalExpense - is.budgetYtdExpense)}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{pctVal(is.totalExpense, is.budgetYtdExpense)}</td>
                </tr>

                <tr className="bg-emerald-100 font-bold text-emerald-950 border-t-2 border-emerald-300">
                  <td className="py-2 px-2.5">LABA / (RUGI) BERSIH</td>
                  <td className="py-2 px-2 text-right font-mono">{formatRp(is.monthlyNetIncome)}</td>
                  <td className="py-2 px-2 text-right font-mono">{formatRp(is.budgetMonthlyNetIncome)}</td>
                  <td className="py-2 px-2 text-right font-mono">{formatRp(is.monthlyNetIncome - is.budgetMonthlyNetIncome)}</td>
                  <td className="py-2 px-2 text-right font-mono">{pctVal(is.monthlyNetIncome, is.budgetMonthlyNetIncome)}</td>
                  <td className="py-2 px-2 text-right font-mono">{formatRp(is.netIncome)}</td>
                  <td className="py-2 px-2 text-right font-mono">{formatRp(is.budgetYtdNetIncome)}</td>
                  <td className="py-2 px-2 text-right font-mono">{formatRp(is.netIncome - is.budgetYtdNetIncome)}</td>
                  <td className="py-2 px-2 text-right font-mono">{pctVal(is.netIncome, is.budgetYtdNetIncome)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'ARUS_KAS': {
        if (cashFlowMethod === 'INDIRECT') {
          const snapCf = activeSnapshot?.indirectCashFlow;
          const ind = statements.indirectCashFlow;
          return (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                LAPORAN ARUS KAS — METODE TIDAK LANGSUNG (SESUAI PERMENDAGRI 118/2018)
              </div>
              {snapCf ? (
                <table className={tblClass}>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={2} className="py-2 px-3">Arus Kas dari Aktivitas Operasi</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3">Laba (Rugi) Bulan Ini</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(snapCf.netIncomeMonthly)}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3">Penyesuaian: Penyusutan Aktiva Tetap (Non-Kas)</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(snapCf.depreciationAddBack)}</td>
                    </tr>
                    {snapCf.workingCapitalChanges.map((w, idx) => (
                      <tr key={idx}>
                        <td className="py-1.5 px-3 pl-6 text-slate-700">{w.label}</td>
                        <td className={`py-1.5 px-3 text-right font-mono ${w.amount < 0 ? 'text-rose-700' : ''}`}>
                          {formatRp(w.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-bold">
                      <td className="py-2 px-3">Arus Kas Bersih Diperoleh dari Aktivitas Operasi</td>
                      <td className="py-2 px-3 text-right font-mono text-emerald-800">{formatRp(snapCf.netOperatingCashFlow)}</td>
                    </tr>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={2} className="py-2 px-3">Arus Kas dari Aktivitas Investasi</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3">Penambahan Aktiva Tetap / Belanja Investasi</td>
                      <td className="py-1.5 px-3 text-right font-mono text-rose-700">{formatRp(snapCf.investingCashFlow)}</td>
                    </tr>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={2} className="py-2 px-3">Arus Kas dari Aktivitas Pendanaan</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3">Arus Kas Bersih Aktivitas Pendanaan</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(snapCf.financingCashFlow)}</td>
                    </tr>
                    <tr className="font-semibold">
                      <td className="py-1.5 px-3">Kenaikan / (Penurunan) Bersih Kas &amp; Setara Kas</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(snapCf.netCashChange)}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 px-3">Saldo Kas &amp; Bank Awal Bulan</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(snapCf.beginningCash)}</td>
                    </tr>
                    <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                      <td className="py-2 px-3">SALDO KAS &amp; BANK AKHIR BULAN</td>
                      <td className="py-2 px-3 text-right font-mono">{formatRp(snapCf.endingCash)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <table className={tblClass}>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-slate-50 font-bold"><td colSpan={2} className="py-2 px-3">Arus Kas Aktivitas Operasi (Dari Buku Besar)</td></tr>
                    <tr><td className="py-1.5 px-3">Laba (Rugi) Bersih Periode</td><td className="py-1.5 px-3 text-right font-mono">{formatRp(ind.netIncome)}</td></tr>
                    <tr><td className="py-1.5 px-3">Penambahan Kembali Penyusutan</td><td className="py-1.5 px-3 text-right font-mono">{formatRp(ind.depreciationAddBack)}</td></tr>
                    <tr><td className="py-1.5 px-3">Perubahan Modal Kerja (Piutang, Persediaan, Utang)</td><td className="py-1.5 px-3 text-right font-mono">{formatRp(ind.workingCapitalDelta)}</td></tr>
                    <tr className="bg-slate-50 font-bold"><td className="py-1.5 px-3">Arus Kas Bersih Operasi</td><td className="py-1.5 px-3 text-right font-mono">{formatRp(ind.netOperatingCashFlow)}</td></tr>
                    <tr><td className="py-1.5 px-3">Arus Kas Bersih Investasi</td><td className="py-1.5 px-3 text-right font-mono">{formatRp(ind.netInvestingCashFlow)}</td></tr>
                    <tr><td className="py-1.5 px-3">Arus Kas Bersih Pendanaan</td><td className="py-1.5 px-3 text-right font-mono">{formatRp(ind.netFinancingCashFlow)}</td></tr>
                    <tr><td className="py-1.5 px-3">Saldo Kas &amp; Bank Awal</td><td className="py-1.5 px-3 text-right font-mono">{formatRp(ind.beginningCash)}</td></tr>
                    <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200"><td className="py-2 px-3">SALDO KAS &amp; BANK AKHIR</td><td className="py-2 px-3 text-right font-mono">{formatRp(ind.endingCash)}</td></tr>
                  </tbody>
                </table>
              )}
            </div>
          );
        }

        const cf = statements.cashFlow;
        return (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className={tblClass}>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={2} className="py-2 px-3">Arus Kas dari Aktivitas Operasional (Metode Langsung BKM/BKK)</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">Penerimaan Kas Operasional</td>
                  <td className="py-1.5 px-3 text-right font-mono text-emerald-700">{formatRp(cf.operatingInflows)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">Pengeluaran Kas Operasional</td>
                  <td className="py-1.5 px-3 text-right font-mono text-rose-700">({formatRp(cf.operatingOutflows)})</td>
                </tr>
                <tr className="bg-slate-50/70 font-bold">
                  <td className="py-1.5 px-3">Arus Kas Bersih Aktivitas Operasional</td>
                  <td className="py-1.5 px-3 text-right font-mono">{formatRp(cf.netOperatingCashFlow)}</td>
                </tr>

                <tr className="bg-slate-50 font-bold">
                  <td colSpan={2} className="py-2 px-3">Arus Kas dari Aktivitas Investasi</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">Penerimaan Investasi</td>
                  <td className="py-1.5 px-3 text-right font-mono">{formatRp(cf.investingInflows)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">Belanja Modal &amp; Pengadaan Aset</td>
                  <td className="py-1.5 px-3 text-right font-mono text-rose-700">({formatRp(cf.investingOutflows)})</td>
                </tr>
                <tr className="bg-slate-50/70 font-bold">
                  <td className="py-1.5 px-3">Arus Kas Bersih Aktivitas Investasi</td>
                  <td className="py-1.5 px-3 text-right font-mono">{formatRp(cf.netInvestingCashFlow)}</td>
                </tr>

                <tr className="bg-slate-50 font-bold">
                  <td colSpan={2} className="py-2 px-3">Arus Kas dari Aktivitas Pendanaan</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">Arus Kas Bersih Aktivitas Pendanaan</td>
                  <td className="py-1.5 px-3 text-right font-mono">{formatRp(cf.netFinancingCashFlow)}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-1.5 px-3">Kenaikan / (Penurunan) Bersih Kas</td>
                  <td className="py-1.5 px-3 text-right font-mono">{formatRp(cf.netCashChange)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-3">Saldo Kas &amp; Bank Awal Periode</td>
                  <td className="py-1.5 px-3 text-right font-mono">{formatRp(cf.beginningCash)}</td>
                </tr>
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td className="py-2 px-3">SALDO KAS &amp; BANK AKHIR PERIODE</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(cf.endingCash)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'EFISIENSI_PENAGIHAN': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const rows = activeSnapshot.collectionEfficiency;
        const totPrev = rows.reduce((s, r) => s + r.prevBilling, 0);
        const totArr = rows.reduce((s, r) => s + r.arrearsCollected, 0);
        const totCur = rows.reduce((s, r) => s + r.currentCollected, 0);
        const totAll = rows.reduce((s, r) => s + r.totalCollected, 0);
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-3">Unit Pelayanan</th>
                  <th className="py-2 px-3 text-right">Rek. Bulan Lalu</th>
                  <th className="py-2 px-3 text-right">Tertagih Tunggakan</th>
                  <th className="py-2 px-3 text-right">Tertagih Lancar</th>
                  <th className="py-2 px-3 text-right">Total Penerimaan</th>
                  <th className="py-2 px-3 text-right">% Lancar</th>
                  <th className="py-2 px-3 text-right">% Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((u) => (
                  <tr key={u.unitName}>
                    <td className="py-1.5 px-3 font-medium">{u.unitName}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(u.prevBilling)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(u.arrearsCollected)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(u.currentCollected)}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-semibold">{formatRp(u.totalCollected)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{u.currentEfficiencyPct.toFixed(2)}%</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold text-emerald-800">{u.totalEfficiencyPct.toFixed(2)}%</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td className="py-2 px-3">TOTAL KESELURUHAN</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(totPrev)}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(totArr)}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(totCur)}</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(totAll)}</td>
                  <td className="py-2 px-3 text-right font-mono">{totPrev > 0 ? ((totCur / totPrev) * 100).toFixed(2) : '0.00'}%</td>
                  <td className="py-2 px-3 text-right font-mono">{totPrev > 0 ? ((totAll / totPrev) * 100).toFixed(2) : '0.00'}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'EFEKTIVITAS_PENAGIHAN': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const rows = activeSnapshot.tariffEffectiveness;
        const totRec = rows.reduce((s, r) => s + r.totalReceivable, 0);
        const totCol = rows.reduce((s, r) => s + r.collectedAmount, 0);
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-2.5">Kode</th>
                  <th className="py-2 px-2.5">Kelompok Tarif</th>
                  <th className="py-2 px-2.5 text-right">1 Bulan</th>
                  <th className="py-2 px-2.5 text-right">2 Bulan</th>
                  <th className="py-2 px-2.5 text-right">&gt; 3 Bulan</th>
                  <th className="py-2 px-2.5 text-right">Total Piutang</th>
                  <th className="py-2 px-2.5 text-right">Tertagih</th>
                  <th className="py-2 px-2.5 text-right">Efektivitas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((t) => (
                  <tr key={t.tariffCode}>
                    <td className="py-1.5 px-2.5 font-mono font-bold">{t.tariffCode}</td>
                    <td className="py-1.5 px-2.5">{t.tariffName}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(t.receivableMonth1)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(t.receivableMonth2)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(t.receivableAbove3Months)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono font-semibold">{formatRp(t.totalReceivable)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono text-emerald-800">{formatRp(t.collectedAmount)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono font-bold">{t.effectivenessPct.toFixed(2)}%</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td colSpan={5} className="py-2 px-2.5">TOTAL PIUTANG REKENING AIR PER KELOMPOK TARIF</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(totRec)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(totCol)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">
                    {totRec + totCol > 0 ? ((totCol / (totRec + totCol)) * 100).toFixed(2) : '0.00'}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'PEMBELIAN_PERSEDIAAN': {
        const totPurM = purchaseCategorySummary.reduce((s, r) => s + r.amountMonthly, 0);
        const totPurY = purchaseCategorySummary.reduce((s, r) => s + r.amountYtd, 0);
        const totInvPrev = filteredInventory.reduce((s, i) => s + i.prevMonthValue, 0);
        const totInvEnd = filteredInventory.reduce((s, i) => s + i.endingValue, 0);
        return (
          <div className="space-y-4">
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                A. REKAPITULASI PEMBELIAN BARANG (BULAN INI &amp; S/D BULAN INI)
              </div>
              <table className={tblClass}>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-2 px-3">Kategori Pembelian</th>
                    <th className="py-2 px-3 text-right">Order Bln Ini</th>
                    <th className="py-2 px-3 text-right">Realisasi Bln Ini</th>
                    <th className="py-2 px-3 text-right">Nilai Bulan Ini</th>
                    <th className="py-2 px-3 text-right">Order YTD</th>
                    <th className="py-2 px-3 text-right">Realisasi YTD</th>
                    <th className="py-2 px-3 text-right">Nilai S/D Bulan Ini</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {purchaseCategorySummary.map((r) => (
                    <tr key={r.category}>
                      <td className="py-1.5 px-3 font-medium">{r.category}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{r.requestedMonthly}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{r.realizedMonthly}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(r.amountMonthly)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{r.requestedYtd}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{r.realizedYtd}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-bold">{formatRp(r.amountYtd)}</td>
                    </tr>
                  ))}
                  <tr className="bg-emerald-50 font-bold text-emerald-950">
                    <td colSpan={3} className="py-2 px-3">TOTAL NILAI PEMBELIAN</td>
                    <td className="py-2 px-3 text-right font-mono">{formatRp(totPurM)}</td>
                    <td colSpan={2} />
                    <td className="py-2 px-3 text-right font-mono">{formatRp(totPurY)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                B. POSISI PERSEDIAAN GUDANG (BAHAN KIMIA &amp; BAHAN INSTALASI)
              </div>
              <table className={tblClass}>
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                    <th className="py-2 px-3">Kode COA</th>
                    <th className="py-2 px-3">Nama Barang Persediaan</th>
                    <th className="py-2 px-3">Kategori</th>
                    <th className="py-2 px-3 text-right">Saldo Bulan Lalu</th>
                    <th className="py-2 px-3 text-right">Saldo Bulan Ini</th>
                    <th className="py-2 px-3 text-right">Selisih Mutasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInventory.map((inv) => (
                    <tr key={inv.id}>
                      <td className="py-1.5 px-3 font-mono font-bold">{inv.coaCode}</td>
                      <td className="py-1.5 px-3">{inv.name}</td>
                      <td className="py-1.5 px-3 text-slate-600">{inv.category}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(inv.prevMonthValue)}</td>
                      <td className="py-1.5 px-3 text-right font-mono font-bold">{formatRp(inv.endingValue)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{formatRp(inv.endingValue - inv.prevMonthValue)}</td>
                    </tr>
                  ))}
                  <tr className="bg-emerald-50 font-bold text-emerald-950">
                    <td colSpan={3} className="py-2 px-3">TOTAL PERSEDIAAN</td>
                    <td className="py-2 px-3 text-right font-mono">{formatRp(totInvPrev)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatRp(totInvEnd)}</td>
                    <td className="py-2 px-3 text-right font-mono">{formatRp(totInvEnd - totInvPrev)}</td>
                  </tr>
                </tbody>
              </table>
              {filteredPurchases.length > 0 && (
                <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-600">
                  Menampilkan {filteredInventory.length} item persediaan &amp; {filteredPurchases.length} transaksi pembelian terfilter.
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'IKHTISAR_REKENING_AIR': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const rows = activeSnapshot.drdSummary;
        const totCust = rows.reduce((s, r) => s + r.customerCount, 0);
        const totM3M = rows.reduce((s, r) => s + r.cubicMetersMonthly, 0);
        const totRpM = rows.reduce((s, r) => s + r.billedAmountMonthly, 0);
        const totM3Y = rows.reduce((s, r) => s + r.cubicMetersYtd, 0);
        const totRpY = rows.reduce((s, r) => s + r.billedAmountYtd, 0);
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-2.5">Kelompok</th>
                  <th className="py-2 px-2.5">Golongan Tarif</th>
                  <th className="py-2 px-2.5 text-right">Pelanggan</th>
                  <th className="py-2 px-2.5 text-right">Rek (Bln Ini)</th>
                  <th className="py-2 px-2.5 text-right">M3 (Bln Ini)</th>
                  <th className="py-2 px-2.5 text-right">Rupiah (Bln Ini)</th>
                  <th className="py-2 px-2.5 text-right">M3 (S/D Bln)</th>
                  <th className="py-2 px-2.5 text-right">Rupiah (S/D Bln)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((d, idx) => (
                  <tr key={`${d.tariffGroup}-${idx}`}>
                    <td className="py-1.5 px-2.5 font-semibold text-slate-600">{d.tariffGroup}</td>
                    <td className="py-1.5 px-2.5">{d.tariffName}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{d.customerCount.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{d.billedSlipsMonthly.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{d.cubicMetersMonthly.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono font-semibold">{formatRp(d.billedAmountMonthly)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{d.cubicMetersYtd.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono font-semibold">{formatRp(d.billedAmountYtd)}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td colSpan={2} className="py-2 px-2.5">TOTAL DRD REKENING AIR</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totCust.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2.5 text-right font-mono">-</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totM3M.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(totRpM)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totM3Y.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(totRpY)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'REKAP_AKTIVA': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const rows = activeSnapshot.assetGroupSummary;
        const tCost = rows.reduce((s, r) => s + r.acquisitionCost, 0);
        const tAccPrev = rows.reduce((s, r) => s + r.accumDepPrevYear, 0);
        const tDepM = rows.reduce((s, r) => s + r.depreciationMonthly, 0);
        const tDepY = rows.reduce((s, r) => s + r.depreciationYtd, 0);
        const tAccEnd = rows.reduce((s, r) => s + r.accumDepEnding, 0);
        const tNbv = rows.reduce((s, r) => s + r.bookValueEnding, 0);
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-2.5">Kode</th>
                  <th className="py-2 px-2.5">Kelompok Aktiva Tetap</th>
                  <th className="py-2 px-2.5 text-right">Harga Perolehan</th>
                  <th className="py-2 px-2.5 text-right">Akum. Peny. Thn Lalu</th>
                  <th className="py-2 px-2.5 text-right">Peny. Bln Ini</th>
                  <th className="py-2 px-2.5 text-right">Peny. S/D Bln Ini</th>
                  <th className="py-2 px-2.5 text-right">Akum. Peny. Akhir</th>
                  <th className="py-2 px-2.5 text-right">Nilai Buku Akhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((a) => (
                  <tr key={a.groupCode}>
                    <td className="py-1.5 px-2.5 font-mono font-bold">{a.groupCode}</td>
                    <td className="py-1.5 px-2.5 font-medium">{a.groupName}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(a.acquisitionCost)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(a.accumDepPrevYear)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(a.depreciationMonthly)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(a.depreciationYtd)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{formatRp(a.accumDepEnding)}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono font-bold">{formatRp(a.bookValueEnding)}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td colSpan={2} className="py-2 px-2.5">TOTAL REKAPITULASI AKTIVA TETAP</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(tCost)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(tAccPrev)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(tDepM)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(tDepY)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(tAccEnd)}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{formatRp(tNbv)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'PRODUKSI_DISTRIBUSI': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const rows = activeSnapshot.productionDistribution;
        const totProdM = rows.reduce((s, r) => s + r.producedM3Monthly, 0);
        const totDistM = rows.reduce((s, r) => s + r.distributedM3Monthly, 0);
        const totSoldM = rows.reduce((s, r) => s + r.soldM3Monthly, 0);
        const totNrwM = rows.reduce((s, r) => s + r.nrwM3Monthly, 0);
        const totNrwPct = totDistM > 0 ? (totNrwM / totDistM) * 100 : 0;
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-2.5">Unit Pelayanan</th>
                  <th className="py-2 px-2.5 text-right">Kap. (L/Det)</th>
                  <th className="py-2 px-2.5 text-right">Produksi M3 (Bln)</th>
                  <th className="py-2 px-2.5 text-right">Distribusi M3 (Bln)</th>
                  <th className="py-2 px-2.5 text-right">Terjual M3 (Bln)</th>
                  <th className="py-2 px-2.5 text-right">NRW M3 (Bln)</th>
                  <th className="py-2 px-2.5 text-right">% NRW Bln</th>
                  <th className="py-2 px-2.5 text-right">% NRW YTD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.unitName}>
                    <td className="py-1.5 px-2.5 font-medium">{p.unitName}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{p.installedCapacityLps} / {p.realCapacityLps}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{p.producedM3Monthly.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{p.distributedM3Monthly.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{p.soldM3Monthly.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{p.nrwM3Monthly.toLocaleString('id-ID')}</td>
                    <td className={`py-1.5 px-2.5 text-right font-mono font-bold ${p.nrwPctMonthly > 25 ? 'text-rose-700' : 'text-emerald-800'}`}>
                      {p.nrwPctMonthly.toFixed(2)}%
                    </td>
                    <td className="py-1.5 px-2.5 text-right font-mono">{p.nrwPctYtd.toFixed(2)}%</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td colSpan={2} className="py-2 px-2.5">TOTAL PRODUKSI &amp; DISTRIBUSI</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totProdM.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totDistM.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totSoldM.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totNrwM.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-2.5 text-right font-mono">{totNrwPct.toFixed(2)}%</td>
                  <td className="py-2 px-2.5 text-right font-mono">-</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'SAMBUNGAN_LANGGANAN': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const rows = activeSnapshot.customerConnections;
        const tBeg = rows.reduce((s, r) => s + r.beginningActive, 0);
        const tInact = rows.reduce((s, r) => s + r.inactiveCount, 0);
        const tDisc = rows.reduce((s, r) => s + r.disconnectedCount, 0);
        const tRec = rows.reduce((s, r) => s + r.reconnectedCount, 0);
        const tNew = rows.reduce((s, r) => s + r.newConnectionsCount, 0);
        const tEnd = rows.reduce((s, r) => s + r.endingActive, 0);
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-3">Unit Pelayanan</th>
                  <th className="py-2 px-3 text-right">Aktif Awal</th>
                  <th className="py-2 px-3 text-right">Non Aktif / Tunggu</th>
                  <th className="py-2 px-3 text-right">Putus / Cabut</th>
                  <th className="py-2 px-3 text-right">Buka Kembali</th>
                  <th className="py-2 px-3 text-right">Sambungan Baru</th>
                  <th className="py-2 px-3 text-right">Aktif Akhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.unitName}>
                    <td className="py-1.5 px-3 font-medium">{c.unitName}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{c.beginningActive.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{c.inactiveCount.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-rose-700">{c.disconnectedCount.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-emerald-700">{c.reconnectedCount.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-emerald-700">{c.newConnectionsCount.toLocaleString('id-ID')}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold">{c.endingActive.toLocaleString('id-ID')}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td className="py-2 px-3">TOTAL SAMBUNGAN LANGGANAN (SR)</td>
                  <td className="py-2 px-3 text-right font-mono">{tBeg.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-3 text-right font-mono">{tInact.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-3 text-right font-mono">{tDisc.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-3 text-right font-mono">{tRec.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-3 text-right font-mono">{tNew.toLocaleString('id-ID')}</td>
                  <td className="py-2 px-3 text-right font-mono">{tEnd.toLocaleString('id-ID')}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'KONDISI_KARYAWAN': {
        if (!activeSnapshot) return renderMissingSnapshotNotice();
        const rows = activeSnapshot.employeeComposition;
        const tDir = rows.reduce((s, r) => s + r.direksiCount, 0);
        const tPerm = rows.reduce((s, r) => s + r.permanentCount, 0);
        const tCont = rows.reduce((s, r) => s + r.contractCount, 0);
        const tAll = rows.reduce((s, r) => s + r.totalCount, 0);
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-3">Unit / Bagian</th>
                  <th className="py-2 px-3 text-right">Direksi</th>
                  <th className="py-2 px-3 text-right">Pegawai Tetap</th>
                  <th className="py-2 px-3 text-right">Pegawai Kontrak</th>
                  <th className="py-2 px-3 text-right">Jumlah Personil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((e) => (
                  <tr key={e.unitName}>
                    <td className="py-1.5 px-3 font-medium">{e.unitName}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{e.direksiCount}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{e.permanentCount}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{e.contractCount}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold">{e.totalCount}</td>
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td className="py-2 px-3">TOTAL SUMBER DAYA MANUSIA</td>
                  <td className="py-2 px-3 text-right font-mono">{tDir}</td>
                  <td className="py-2 px-3 text-right font-mono">{tPerm}</td>
                  <td className="py-2 px-3 text-right font-mono">{tCont}</td>
                  <td className="py-2 px-3 text-right font-mono">{tAll} Orang</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'PERUBAHAN_EKUITAS': {
        const eq = statements.equityChanges;
        return (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className={tblClass}>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2 px-3">Penyertaan Modal Pemerintah Daerah &amp; Pusat</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(eq.beginningCapital)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3">Cadangan &amp; Akumulasi Laba/(Rugi) Tahun Lalu</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(eq.retainedEarningsOpening)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3">Mutasi / Penyesuaian Modal Periode Berjalan</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(eq.equityAdjustments)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3">Laba / (Rugi) Bersih Periode Berjalan</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(eq.netIncome)}</td>
                </tr>
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td className="py-2.5 px-3">SALDO EKUITAS AKHIR</td>
                  <td className="py-2.5 px-3 text-right font-mono">{formatRp(eq.endingEquity)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      }

      case 'BUKU_BESAR':
      case 'NERACA_SALDO': {
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-3">Kode</th>
                  <th className="py-2 px-3">Nama Akun</th>
                  <th className="py-2 px-3 text-right">Mutasi Debit</th>
                  <th className="py-2 px-3 text-right">Mutasi Kredit</th>
                  <th className="py-2 px-3 text-right">Saldo Akhir Debit</th>
                  <th className="py-2 px-3 text-right">Saldo Akhir Kredit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.ledgers.map((l) => (
                  <tr key={l.account.id}>
                    <td className="py-1.5 px-3 font-mono font-bold">{l.account.code}</td>
                    <td className="py-1.5 px-3">{l.account.name}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(l.periodDebit)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(l.periodCredit)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{l.endingDebit > 0 ? formatRp(l.endingDebit) : '-'}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{l.endingCredit > 0 ? formatRp(l.endingCredit) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'KAS_BANK': {
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-3">Kode</th>
                  <th className="py-2 px-3">Rekening Kas / Bank</th>
                  <th className="py-2 px-3 text-right">Saldo Awal</th>
                  <th className="py-2 px-3 text-right">Total Masuk</th>
                  <th className="py-2 px-3 text-right">Total Keluar</th>
                  <th className="py-2 px-3 text-right">Saldo Akhir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cashBankSummary.accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="py-1.5 px-3 font-mono font-bold">{a.code}</td>
                    <td className="py-1.5 px-3">{a.name}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(a.openingBalance)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(a.totalIn + a.transferIn)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(a.totalOut + a.transferOut)}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold">{formatRp(a.currentBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'UTANG_PIUTANG': {
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-3">Jenis</th>
                  <th className="py-2 px-3">Dokumen</th>
                  <th className="py-2 px-3">Pihak</th>
                  <th className="py-2 px-3">Jatuh Tempo</th>
                  <th className="py-2 px-3 text-right">Tagihan</th>
                  <th className="py-2 px-3 text-right">Sisa</th>
                  <th className="py-2 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {receivablesPayables.map((rp) => (
                  <tr key={rp.id}>
                    <td className="py-1.5 px-3 font-bold">{rp.kind}</td>
                    <td className="py-1.5 px-3 font-mono">{rp.documentNumber}</td>
                    <td className="py-1.5 px-3">{rp.partyName}</td>
                    <td className="py-1.5 px-3 font-mono">{formatDateShort(rp.dueDate)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(rp.originalAmount)}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold">{formatRp(rp.remainingAmount)}</td>
                    <td className="py-1.5 px-3">{rp.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      case 'REALISASI_RKA': {
        return (
          <div className="border border-slate-200 rounded-xl overflow-x-auto">
            <table className={tblClass}>
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-600">
                  <th className="py-2 px-3">Kode RKA</th>
                  <th className="py-2 px-3">Program / Kegiatan</th>
                  <th className="py-2 px-3 text-right">Pagu</th>
                  <th className="py-2 px-3 text-right">Realisasi Sebelum</th>
                  <th className="py-2 px-3 text-right">Realisasi Keuangan</th>
                  <th className="py-2 px-3 text-right">Total Realisasi</th>
                  <th className="py-2 px-3 text-right">Sisa Anggaran</th>
                  <th className="py-2 px-3 text-right">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rkaReportRows.map(({ rka, abs }) => (
                  <tr key={rka.id}>
                    <td className="py-1.5 px-3 font-mono font-bold">{rka.code}</td>
                    <td className="py-1.5 px-3">{rka.programName}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(abs.budgetAmount)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(abs.baselineRealization)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(abs.postedFinanceRealization)}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold">{formatRp(abs.totalRealization)}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{formatRp(abs.remainingBudget)}</td>
                    <td className="py-1.5 px-3 text-right font-mono font-bold">{abs.absorptionPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }
  };

  if (mode === 'REPORTS') {
    const activeReportTitle =
      REPORT_OPTIONS.find((r) => r.id === selectedReport)?.label || 'Laporan Keuangan';
    const pdamOpts = REPORT_OPTIONS.filter((r) => r.group === 'PDAM');
    const akuntansiOpts = REPORT_OPTIONS.filter((r) => r.group === 'AKUNTANSI');

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" />
              Laporan Resmi Bulanan Perumda Tirta Saiyo (Permendagri No. 118 Tahun 2018)
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Excel</span>
              </button>
              <button
                type="button"
                onClick={() => setIsPrintOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak / PDF Resmi</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {pdamOpts.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedReport(opt.id)}
                className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedReport === opt.id
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase mr-1">
              Akuntansi &amp; RKA:
            </span>
            {akuntansiOpts.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedReport(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedReport === opt.id
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{activeReportTitle}</h3>
              <p className="text-[11px] text-slate-500">{periodLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selectedReport === 'ARUS_KAS' && (
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px]">
                  <button
                    type="button"
                    onClick={() => setCashFlowMethod('INDIRECT')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      cashFlowMethod === 'INDIRECT' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Metode Tidak Langsung
                  </button>
                  <button
                    type="button"
                    onClick={() => setCashFlowMethod('DIRECT')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      cashFlowMethod === 'DIRECT' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Metode Langsung (BKM/BKK)
                  </button>
                </div>
              )}

              {selectedReport === 'LABA_RUGI' && (
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px]">
                  <button
                    type="button"
                    onClick={() => setIncomeLayout('COMPARATIVE')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      incomeLayout === 'COMPARATIVE' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Komparatif Anggaran &amp; YTD
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncomeLayout('COMPACT')}
                    className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
                      incomeLayout === 'COMPACT' ? 'bg-white text-emerald-800 shadow-2xs' : 'text-slate-600'
                    }`}
                  >
                    Ringkas SAK-ETAP
                  </button>
                </div>
              )}

              {activeSnapshot && selectedReport !== 'SURAT_PENGANTAR' && (
                <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeSuratHeader}
                    onChange={(e) => setIncludeSuratHeader(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-700"
                  />
                  <span>Header Surat Pengantar Permendagri 118</span>
                </label>
              )}

              <span className="text-[11px] font-mono text-slate-500">
                Neraca Seimbang: {statements.balanceSheet.isBalanced ? 'Ya' : 'Cek Penyesuaian'}
              </span>
            </div>
          </div>
          {renderReportBody(false)}
        </div>

        <DocumentPrintPreviewModal
          isOpen={isPrintOpen}
          onClose={() => setIsPrintOpen(false)}
          documentTitle={activeReportTitle.replace(/^\d+\.\s*/, '')}
          documentSubtitle={periodLabel}
          documentNumber={
            activeSnapshot?.letterNumber || `KEU-${selectedReport}-${filter.year || new Date().getFullYear()}`
          }
          initialSignatory1Role={
            activeSnapshot
              ? `Kasubid Keuangan · ${activeSnapshot.kasubidKeuName} (${activeSnapshot.kasubidKeuNik})`
              : 'Bidang Keuangan'
          }
          initialSignatory2Role={
            activeSnapshot ? `Direktur · ${activeSnapshot.directorName}` : 'Direktur'
          }
          defaultShowSignatory2={true}
        >
          {() => (
            <div className="space-y-4">
              {includeSuratHeader && selectedReport !== 'SURAT_PENGANTAR' && renderSuratPengantarBanner()}
              {renderReportBody(true)}
            </div>
          )}
        </DocumentPrintPreviewModal>
      </div>
    );
  }

  // ANALYSIS MODE (J. ANALISIS & EARLY WARNING)
  const ratioCards = [
    {
      name: 'Financial Cost Recovery (FCR)',
      value: `${analysis.fcrPct.toFixed(1)}%`,
      benchmark: 'Target Sehat ≥ 100%',
      healthy: analysis.fcrPct >= 100,
      formula: 'Pendapatan Usaha / Biaya Usaha × 100%',
    },
    {
      name: 'Current Ratio (Rasio Lancar)',
      value: `${analysis.currentRatioPct.toFixed(1)}%`,
      benchmark: 'Target Sehat ≥ 150%',
      healthy: analysis.currentRatioPct >= 150,
      formula: 'Aset Lancar / Kewajiban Lancar × 100%',
    },
    {
      name: 'Cash Ratio (Rasio Kas)',
      value: `${analysis.cashRatioPct.toFixed(1)}%`,
      benchmark: 'Target Sehat ≥ 50%',
      healthy: analysis.cashRatioPct >= 50,
      formula: '(Kas + Bank) / Kewajiban Lancar × 100%',
    },
    {
      name: 'Operating Ratio (Rasio Operasi)',
      value: `${analysis.operatingRatioPct.toFixed(1)}%`,
      benchmark: 'Target Sehat ≤ 85%',
      healthy: analysis.operatingRatioPct > 0 && analysis.operatingRatioPct <= 85,
      formula: 'Biaya Operasi / Pendapatan Operasi × 100%',
    },
    {
      name: 'Debt to Equity Ratio (DER)',
      value: `${analysis.debtToEquityRatioPct.toFixed(1)}%`,
      benchmark: 'Target Sehat ≤ 100%',
      healthy: analysis.debtToEquityRatioPct <= 100,
      formula: 'Total Kewajiban / Total Ekuitas × 100%',
    },
  ];

  // PDAM Operational KPIs
  const opMetrics = (() => {
    const totInvVal = filteredInventory.reduce((s, i) => s + (i.endingValue || 0), 0);
    if (!activeSnapshot) {
      return {
        hasSnap: false,
        nrwPct: 0,
        billingEffPct: 0,
        activeSr: 0,
        totInvVal,
      };
    }
    const totDist = activeSnapshot.productionDistribution.reduce((s, u) => s + (u.distributedM3Monthly || 0), 0);
    const totNrw = activeSnapshot.productionDistribution.reduce((s, u) => s + (u.nrwM3Monthly || 0), 0);
    const nrwPct = totDist > 0 ? (totNrw / totDist) * 100 : 0;

    const totPrevBill = activeSnapshot.collectionEfficiency.reduce((s, u) => s + (u.prevBilling || 0), 0);
    const totAllColl = activeSnapshot.collectionEfficiency.reduce((s, u) => s + (u.totalCollected || 0), 0);
    const billingEffPct = totPrevBill > 0 ? (totAllColl / totPrevBill) * 100 : 0;

    const activeSr = activeSnapshot.customerConnections.reduce((s, c) => s + (c.endingActive || 0), 0);
    return {
      hasSnap: true,
      nrwPct,
      billingEffPct,
      activeSr,
      totInvVal,
    };
  })();

  return (
    <div className="space-y-4">
      {/* Ratio KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {ratioCards.map((c) => (
          <div key={c.name} className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
              <span>{c.name}</span>
              <Scale className={`w-3.5 h-3.5 ${c.healthy ? 'text-emerald-600' : 'text-amber-600'}`} />
            </div>
            <p
              className={`text-xl font-bold font-mono tabular-nums ${
                c.healthy ? 'text-emerald-800' : 'text-amber-700'
              }`}
            >
              {c.value}
            </p>
            <p className="text-[11px] font-medium text-slate-600">{c.benchmark}</p>
            <p className="text-[10px] text-slate-400">{c.formula}</p>
          </div>
        ))}
      </div>

      {/* PDAM Operational Ratio Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-500">Efisiensi Penagihan Rekening Air</span>
            <p className={`text-lg font-bold font-mono mt-0.5 ${opMetrics.billingEffPct >= 90 ? 'text-emerald-800' : 'text-amber-700'}`}>
              {opMetrics.hasSnap ? `${opMetrics.billingEffPct.toFixed(2)}%` : '-'}
            </p>
            <span className="text-[10px] text-slate-500">Total tertagih / ketetapan bulan lalu</span>
          </div>
          <Droplets className="w-5 h-5 text-emerald-700 shrink-0" />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-500">Kehilangan Air (NRW) &amp; Pelanggan</span>
            <p className={`text-lg font-bold font-mono mt-0.5 ${opMetrics.nrwPct <= 25 ? 'text-emerald-800' : 'text-rose-700'}`}>
              {opMetrics.hasSnap ? `${opMetrics.nrwPct.toFixed(2)}%` : '-'}
            </p>
            <span className="text-[10px] text-slate-500">
              {opMetrics.hasSnap ? `${opMetrics.activeSr.toLocaleString('id-ID')} SR aktif · Target NRW ≤ 25%` : 'Muat snapshot di tab Operasional PDAM'}
            </span>
          </div>
          <AlertTriangle className={`w-5 h-5 shrink-0 ${opMetrics.nrwPct > 25 ? 'text-rose-600' : 'text-emerald-600'}`} />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-slate-500">Persediaan Gudang &amp; Nilai Buku Aktiva</span>
            <p className="text-lg font-bold font-mono text-slate-900 mt-0.5">
              {formatRp(statements.balanceSheet.netFixedAssets)}
            </p>
            <span className="text-[10px] text-slate-500">
              Persediaan kimia/instalasi: {formatRp(opMetrics.totInvVal)}
            </span>
          </div>
          <Package className="w-5 h-5 text-teal-700 shrink-0" />
        </div>
      </div>

      {/* Revenue vs Expense Breakdown + 6-Month Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-700" />
            <span>Analisis Pendapatan &amp; Struktur Biaya</span>
          </h3>
          <div className="space-y-2 text-xs">
            {[
              { label: 'Pendapatan Usaha', val: statements.incomeStatement.totalOperatingRevenue, color: 'bg-emerald-600' },
              { label: 'Pendapatan Lain-Lain', val: statements.incomeStatement.totalOtherRevenue, color: 'bg-teal-500' },
              { label: 'Beban Operasi Langsung', val: statements.incomeStatement.directExpenses.reduce((s, l) => s + l.netSignedBalance, 0), color: 'bg-rose-600' },
              { label: 'Beban Administrasi & Umum', val: statements.incomeStatement.adminExpenses.reduce((s, l) => s + l.netSignedBalance, 0), color: 'bg-amber-600' },
              { label: 'Beban Penyusutan', val: statements.incomeStatement.depreciationExpenses.reduce((s, l) => s + l.netSignedBalance, 0), color: 'bg-slate-500' },
            ].map((row) => {
              const base = Math.max(1, statements.incomeStatement.totalRevenue, statements.incomeStatement.totalExpense);
              const widthPct = Math.min(100, Math.round((Math.abs(row.val) / base) * 100));
              return (
                <div key={row.label} className="space-y-1">
                  <div className="flex justify-between">
                    <span className="font-medium text-slate-700">{row.label}</span>
                    <span className="font-mono font-bold text-slate-900">{formatRp(row.val)}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${row.color}`} style={{ width: `${widthPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h3 className="text-sm font-bold text-slate-900">
              Proyeksi Arus Kas 6 Bulan Ke Depan
            </h3>
            <p className="text-[11px] text-slate-500">
              Dihitung dari rata-rata arus kas aktual, jadwal jatuh tempo utang/piutang, dan sisa rencana belanja RKA
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600">
                  <th className="py-2 px-3">Bulan Proyeksi</th>
                  <th className="py-2 px-3 text-right">Proyeksi Masuk</th>
                  <th className="py-2 px-3 text-right">Proyeksi Keluar</th>
                  <th className="py-2 px-3 text-right">Arus Bersih</th>
                  <th className="py-2 px-3 text-right">Proyeksi Saldo Kas/Bank</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysis.cashFlowProjection.map((p) => (
                  <tr key={p.label} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3 font-semibold text-slate-900">{p.label}</td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-700">{formatRp(p.projectedInflow)}</td>
                    <td className="py-2 px-3 text-right font-mono text-rose-700">{formatRp(p.projectedOutflow)}</td>
                    <td
                      className={`py-2 px-3 text-right font-mono font-semibold ${
                        p.projectedNet >= 0 ? 'text-emerald-800' : 'text-rose-700'
                      }`}
                    >
                      {formatRp(p.projectedNet)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                      {formatRp(p.projectedEndingBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Financial Early Warning Panel */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-700" />
          <h3 className="text-sm font-bold text-slate-900">
            Financial Early Warning System ({analysis.warnings.length} Indikator)
          </h3>
        </div>
        <div className="divide-y divide-slate-100">
          {analysis.warnings.map((w) => (
            <div key={w.id} className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-start gap-2.5">
                {w.severity === 'INFO' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      w.severity === 'KRITIS' ? 'text-rose-600' : 'text-amber-600'
                    }`}
                  />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{w.title}</span>
                    <span className="text-[10px] font-semibold text-slate-500">· {w.category}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">{w.detail}</p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-md border ${
                  w.severity === 'KRITIS'
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : w.severity === 'PERINGATAN'
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                {w.metricValue}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
