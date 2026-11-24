import React, { useMemo, useState } from 'react';
import {
  Printer,
  Download,
  TrendingUp,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  Scale,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { RKAItem, RKASubItem } from '../../types/audit';
import {
  FinanceGlobalFilter,
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
} from '../../lib/financeEngine';
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
}

type FinanceReportId =
  | 'NERACA'
  | 'LABA_RUGI'
  | 'ARUS_KAS'
  | 'PERUBAHAN_EKUITAS'
  | 'BUKU_BESAR'
  | 'NERACA_SALDO'
  | 'KAS_BANK'
  | 'UTANG_PIUTANG'
  | 'REALISASI_RKA';

const REPORT_OPTIONS: { id: FinanceReportId; label: string }[] = [
  { id: 'NERACA', label: '1. Neraca (Posisi Keuangan)' },
  { id: 'LABA_RUGI', label: '2. Laporan Laba Rugi' },
  { id: 'ARUS_KAS', label: '3. Laporan Arus Kas' },
  { id: 'PERUBAHAN_EKUITAS', label: '4. Laporan Perubahan Ekuitas' },
  { id: 'BUKU_BESAR', label: '5. Ringkasan Buku Besar' },
  { id: 'NERACA_SALDO', label: '6. Neraca Saldo' },
  { id: 'KAS_BANK', label: '7. Laporan Kas dan Bank' },
  { id: 'UTANG_PIUTANG', label: '8. Laporan Utang dan Piutang' },
  { id: 'REALISASI_RKA', label: '9. Laporan Realisasi Anggaran (RKA)' },
];

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
}) => {
  const [selectedReport, setSelectedReport] = useState<FinanceReportId>('NERACA');
  const [isPrintOpen, setIsPrintOpen] = useState(false);

  const periodLabel = useMemo(() => {
    const yLabel = filter.year === 0 ? 'Semua Tahun Anggaran' : `Tahun Anggaran ${filter.year}`;
    const mLabel = filter.month === 'ALL' ? '' : ` · Bulan ${filter.month}`;
    return `${yLabel}${mLabel}`;
  }, [filter.year, filter.month]);

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

  const handleExportExcel = () => {
    let sheetData: Record<string, string | number>[] = [];
    const filename = `Laporan_Keuangan_${selectedReport}_${filter.year || 'ALL'}.xlsx`;

    switch (selectedReport) {
      case 'NERACA': {
        sheetData = [
          ...statements.balanceSheet.currentAssets.map((l) => ({
            Kelompok: 'Aset Lancar',
            Kode: l.account.code,
            Akun: l.account.name,
            Saldo: l.netSignedBalance,
          })),
          ...statements.balanceSheet.fixedAssets.map((l) => ({
            Kelompok: 'Aset Tetap',
            Kode: l.account.code,
            Akun: l.account.name,
            Saldo: l.netSignedBalance,
          })),
          ...statements.balanceSheet.currentLiabilities.map((l) => ({
            Kelompok: 'Kewajiban Lancar',
            Kode: l.account.code,
            Akun: l.account.name,
            Saldo: l.netSignedBalance,
          })),
          ...statements.balanceSheet.longTermLiabilities.map((l) => ({
            Kelompok: 'Kewajiban Jangka Panjang',
            Kode: l.account.code,
            Akun: l.account.name,
            Saldo: l.netSignedBalance,
          })),
          ...statements.balanceSheet.equityAccounts.map((l) => ({
            Kelompok: 'Ekuitas',
            Kode: l.account.code,
            Akun: l.account.name,
            Saldo: l.netSignedBalance,
          })),
          {
            Kelompok: 'Ekuitas',
            Kode: 'LABA-TAHUN-BERJALAN',
            Akun: 'Laba / (Rugi) Tahun Berjalan',
            Saldo: statements.balanceSheet.currentYearEarnings,
          },
        ];
        break;
      }
      case 'LABA_RUGI': {
        sheetData = [
          ...statements.incomeStatement.operatingRevenues.map((l) => ({
            Kelompok: 'Pendapatan Usaha',
            Kode: l.account.code,
            Akun: l.account.name,
            Nilai: l.netSignedBalance,
          })),
          ...statements.incomeStatement.otherRevenues.map((l) => ({
            Kelompok: 'Pendapatan Lain-Lain',
            Kode: l.account.code,
            Akun: l.account.name,
            Nilai: l.netSignedBalance,
          })),
          ...statements.incomeStatement.directExpenses.map((l) => ({
            Kelompok: 'Beban Operasi Langsung',
            Kode: l.account.code,
            Akun: l.account.name,
            Nilai: l.netSignedBalance,
          })),
          ...statements.incomeStatement.adminExpenses.map((l) => ({
            Kelompok: 'Beban Administrasi & Umum',
            Kode: l.account.code,
            Akun: l.account.name,
            Nilai: l.netSignedBalance,
          })),
          ...statements.incomeStatement.depreciationExpenses.map((l) => ({
            Kelompok: 'Beban Penyusutan',
            Kode: l.account.code,
            Akun: l.account.name,
            Nilai: l.netSignedBalance,
          })),
          ...statements.incomeStatement.otherExpenses.map((l) => ({
            Kelompok: 'Beban Lain-Lain',
            Kode: l.account.code,
            Akun: l.account.name,
            Nilai: l.netSignedBalance,
          })),
        ];
        break;
      }
      case 'ARUS_KAS': {
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
    XLSX.utils.book_append_sheet(wb, ws, selectedReport);
    XLSX.writeFile(wb, filename);
  };

  const renderReportBody = (isPrintView = false) => {
    const tblClass = isPrintView
      ? 'w-full text-left border-collapse text-[11px]'
      : 'w-full text-left border-collapse text-xs';

    switch (selectedReport) {
      case 'NERACA': {
        const bs = statements.balanceSheet;
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* AKTIVA */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                  ASET (AKTIVA)
                </div>
                <table className={tblClass}>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={2} className="py-1.5 px-3">Aset Lancar</td>
                    </tr>
                    {bs.currentAssets.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1.5 px-3">{l.account.code} · {l.account.name}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(l.netSignedBalance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/80 font-bold">
                      <td className="py-1.5 px-3">Total Aset Lancar</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(bs.totalCurrentAssets)}</td>
                    </tr>

                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={2} className="py-1.5 px-3">Aset Tetap & Akumulasi Penyusutan</td>
                    </tr>
                    {bs.fixedAssets.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1.5 px-3">{l.account.code} · {l.account.name}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(l.netSignedBalance)}</td>
                      </tr>
                    ))}
                    {bs.accumulatedDepreciation.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1.5 px-3">{l.account.code} · {l.account.name} (Pengurang)</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-rose-700">({formatRp(l.netSignedBalance)})</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/80 font-bold">
                      <td className="py-1.5 px-3">Nilai Buku Aset Tetap Bersih</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(bs.netFixedAssets)}</td>
                    </tr>
                    <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                      <td className="py-2 px-3">TOTAL ASET</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatRp(bs.totalAssets)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* PASIVA */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-3.5 py-2 bg-slate-100 font-bold text-slate-900 text-xs">
                  KEWAJIBAN & EKUITAS (PASIVA)
                </div>
                <table className={tblClass}>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={2} className="py-1.5 px-3">Kewajiban Lancar</td>
                    </tr>
                    {bs.currentLiabilities.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1.5 px-3">{l.account.code} · {l.account.name}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(l.netSignedBalance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={2} className="py-1.5 px-3">Kewajiban Jangka Panjang</td>
                    </tr>
                    {bs.longTermLiabilities.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1.5 px-3">{l.account.code} · {l.account.name}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(l.netSignedBalance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/80 font-bold">
                      <td className="py-1.5 px-3">Total Kewajiban</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(bs.totalLiabilities)}</td>
                    </tr>

                    <tr className="bg-slate-50 font-semibold text-slate-700">
                      <td colSpan={2} className="py-1.5 px-3">Ekuitas</td>
                    </tr>
                    {bs.equityAccounts.map((l) => (
                      <tr key={l.account.id}>
                        <td className="py-1.5 px-3">{l.account.code} · {l.account.name}</td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(l.netSignedBalance)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1.5 px-3">Laba / (Rugi) Periode Berjalan</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(bs.currentYearEarnings)}</td>
                    </tr>
                    <tr className="bg-slate-50/80 font-bold">
                      <td className="py-1.5 px-3">Total Ekuitas</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums">{formatRp(bs.totalEquity)}</td>
                    </tr>
                    <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                      <td className="py-2 px-3">TOTAL KEWAJIBAN & EKUITAS</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatRp(bs.totalLiabilitiesAndEquity)}</td>
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
        return (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className={tblClass}>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50 font-bold text-slate-800">
                  <td colSpan={2} className="py-2 px-3">PENDAPATAN USAHA & LAIN-LAIN</td>
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
                  <td colSpan={2} className="py-2 px-3">BEBAN OPERASIONAL, ADMINISTRASI, PENYUSUTAN & LAINNYA</td>
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

      case 'ARUS_KAS': {
        const cf = statements.cashFlow;
        return (
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className={tblClass}>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={2} className="py-2 px-3">Arus Kas dari Aktivitas Operasional</td>
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
                  <td className="py-1.5 px-3">Belanja Modal & Pengadaan Aset</td>
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
                  <td className="py-1.5 px-3">Saldo Kas & Bank Awal Periode</td>
                  <td className="py-1.5 px-3 text-right font-mono">{formatRp(cf.beginningCash)}</td>
                </tr>
                <tr className="bg-emerald-50 font-bold text-emerald-950 border-t-2 border-emerald-200">
                  <td className="py-2 px-3">SALDO KAS & BANK AKHIR PERIODE</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(cf.endingCash)}</td>
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
                  <td className="py-2 px-3">Penyertaan Modal Pemerintah Daerah (Awal)</td>
                  <td className="py-2 px-3 text-right font-mono">{formatRp(eq.beginningCapital)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-3">Cadangan & Laba Ditahan (Awal)</td>
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
          <div className="border border-slate-200 rounded-xl overflow-hidden">
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
          <div className="border border-slate-200 rounded-xl overflow-hidden">
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
          <div className="border border-slate-200 rounded-xl overflow-hidden">
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
          <div className="border border-slate-200 rounded-xl overflow-hidden">
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

    return (
      <div className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {REPORT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelectedReport(opt.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedReport === opt.id
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={() => setIsPrintOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak / PDF Resmi</span>
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-slate-900">{activeReportTitle}</h3>
              <p className="text-[11px] text-slate-500">{periodLabel}</p>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              Neraca Seimbang: {statements.balanceSheet.isBalanced ? 'Ya' : 'Cek Penyesuaian'}
            </span>
          </div>
          {renderReportBody(false)}
        </div>

        <DocumentPrintPreviewModal
          isOpen={isPrintOpen}
          onClose={() => setIsPrintOpen(false)}
          documentTitle={activeReportTitle.replace(/^\d+\.\s*/, '')}
          documentSubtitle={periodLabel}
          documentNumber={`KEU-${selectedReport}-${filter.year || new Date().getFullYear()}`}
          initialSignatory1Role="Bidang Keuangan"
          initialSignatory2Role="Direktur"
          defaultShowSignatory2={true}
        >
          {() => <div className="space-y-4">{renderReportBody(true)}</div>}
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

      {/* Revenue vs Expense Breakdown + 6-Month Projection */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-700" />
            <span>Analisis Pendapatan & Struktur Biaya</span>
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
