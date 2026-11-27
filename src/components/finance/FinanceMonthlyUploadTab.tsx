import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  UploadCloud,
  FileSpreadsheet,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Lock,
  Calendar,
  Download,
  Trash2,
  Plus,
  Loader2,
  ArrowRight,
  Eye,
  History,
  Database,
} from 'lucide-react';
import {
  FinanceAccount,
  FinanceAsset,
  FinanceCashBankAccount,
  FinanceInventoryItem,
  FinanceMonthlyUploadParsedPayload,
  FinanceMonthlyUploadRecord,
  FinancePdamMonthlySnapshot,
  FinancePeriodClose,
  FinancePurchaseRecord,
  FinanceReceivablePayable,
  FinanceTaxRecord,
  FinanceUploadApplyMode,
} from '../../types/finance';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import { formatRp, isPeriodLocked } from '../../lib/financeEngine';
import { normalizeParsedFinanceReport } from '../../lib/financeUploadNormalizer';
import {
  commitMonthlyReportUploadToFirestore,
  computePayloadPreviewStats,
  deleteMonthlyUploadHistoryRecord,
  exportPdamMonthlyExcelTemplate,
  tryParseStructuredPdamExcelWorkbook,
  workbookToPlainText,
} from '../../lib/financeMonthlyUploadCommit';
import { buildOfficialPDAMCoaJan2026 } from '../../data/pdamOfficialBaselineJan2026';
import { FinanceActor, FinancePermissions } from './financeShared';
import { FinanceDeleteConfirmModal } from './FinanceDeleteConfirmModal';
import { FinanceSubTabId } from './FinanceDashboardTab';

interface FinanceMonthlyUploadTabProps {
  activeYear: number;
  availableYears: number[];
  accounts: FinanceAccount[];
  cashBankAccounts: FinanceCashBankAccount[];
  receivablesPayables: FinanceReceivablePayable[];
  assets: FinanceAsset[];
  taxes: FinanceTaxRecord[];
  inventory: FinanceInventoryItem[];
  purchases: FinancePurchaseRecord[];
  pdamSnapshots: FinancePdamMonthlySnapshot[];
  periodCloses: FinancePeriodClose[];
  uploadHistory: FinanceMonthlyUploadRecord[];
  actor: FinanceActor;
  permissions: FinancePermissions;
  onJumpToPeriod: (year: number, month: string, subTab: FinanceSubTabId) => void;
}

type PreviewSectionTab =
  | 'RINGKASAN'
  | 'COA'
  | 'KAS_BANK'
  | 'UTANG_PIUTANG'
  | 'ASET_PAJAK'
  | 'PERSEDIAAN_PEMBELIAN'
  | 'OPERASIONAL_PDAM';

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file dari perangkat.'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const FinanceMonthlyUploadTab: React.FC<FinanceMonthlyUploadTabProps> = ({
  activeYear,
  availableYears,
  accounts,
  cashBankAccounts,
  receivablesPayables,
  assets,
  taxes,
  inventory,
  purchases,
  pdamSnapshots,
  periodCloses,
  uploadHistory,
  actor,
  permissions,
  onJumpToPeriod,
}) => {
  // Strict Super-User Exclusivity Guard
  if (!permissions.isSuperUser) {
    return (
      <div className="bg-white border border-rose-200 rounded-xl p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-900">
          Akses Terbatas — Khusus Super User
        </h3>
        <p className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
          Modul Upload &amp; Pembacaan Otomatis Laporan Bulanan hanya dapat diakses oleh Super User (Kepala SPI / Admin Sistem) untuk menjaga integritas pembukuan setiap bulan.
        </p>
      </div>
    );
  }

  const defaultMonth = FISCAL_MONTHS[Math.min(11, Math.max(0, new Date().getMonth()))] || 'Februari';
  const yearChoices = useMemo(() => {
    const base = new Set<number>([...availableYears, 2025, 2026, 2027, activeYear || 2026]);
    return Array.from(base).sort((a, b) => a - b);
  }, [availableYears, activeYear]);

  // Step 1: Target Period
  const [targetYear, setTargetYear] = useState<number>(activeYear || 2026);
  const [targetMonth, setTargetMonth] = useState<string>(defaultMonth);
  const [applyMode, setApplyMode] = useState<FinanceUploadApplyMode>('REPLACE_MONTH');

  // Step 2: Uploaded File
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    lastApplied?: { year: number; month: string };
  } | null>(null);

  // Step 3: Parsed & Editable Payload
  const [parsedPayload, setParsedPayload] =
    useState<FinanceMonthlyUploadParsedPayload | null>(null);
  const [previewTab, setPreviewTab] = useState<PreviewSectionTab>('RINGKASAN');

  // Upload history delete modal
  const [deleteHistoryTarget, setDeleteHistoryTarget] =
    useState<FinanceMonthlyUploadRecord | null>(null);

  const periodLocked = useMemo(
    () => isPeriodLocked(periodCloses, targetYear, targetMonth),
    [periodCloses, targetYear, targetMonth]
  );

  // Live snapshot of existing data currently stored in Firestore for (targetYear, targetMonth)
  const existingPeriodStats = useMemo(() => {
    const mLower = targetMonth.toLowerCase();
    const isImplicitBaseline =
      (targetYear <= 2025 && mLower === 'desember') ||
      (targetYear >= 2026 && mLower === 'januari');

    const coaCount = accounts.filter(
      (a) =>
        a.year === targetYear &&
        (a.month ? a.month.toLowerCase() === mLower : isImplicitBaseline)
    ).length;
    const cbCount = cashBankAccounts.filter(
      (c) =>
        c.year === targetYear &&
        (c.month ? c.month.toLowerCase() === mLower : isImplicitBaseline)
    ).length;
    const rpCount = receivablesPayables.filter(
      (r) => r.year === targetYear && (r.month || '').toLowerCase() === mLower
    ).length;
    const assetCount = assets.filter(
      (a) =>
        (a.year === targetYear && (a.month || '').toLowerCase() === mLower) ||
        (isImplicitBaseline &&
          (a.id.startsWith(`ast-${targetYear}-dec-`) || a.id.startsWith(`ast-${targetYear}-jan-`)))
    ).length;
    const taxCount = taxes.filter(
      (t) => t.year === targetYear && (t.month || '').toLowerCase() === mLower
    ).length;
    const invCount = inventory.filter(
      (i) => i.year === targetYear && (i.month || '').toLowerCase() === mLower
    ).length;
    const purCount = purchases.filter(
      (p) => p.year === targetYear && (p.month || '').toLowerCase() === mLower
    ).length;
    const hasPdamSnap = pdamSnapshots.some(
      (s) => s.year === targetYear && (s.month || '').toLowerCase() === mLower
    );

    return {
      coaCount,
      cbCount,
      rpCount,
      assetCount,
      taxCount,
      invCount,
      purCount,
      hasPdamSnap,
      hasAnyData:
        coaCount > 0 ||
        cbCount > 0 ||
        rpCount > 0 ||
        assetCount > 0 ||
        taxCount > 0 ||
        invCount > 0 ||
        purCount > 0 ||
        hasPdamSnap,
    };
  }, [
    targetYear,
    targetMonth,
    accounts,
    cashBankAccounts,
    receivablesPayables,
    assets,
    taxes,
    inventory,
    purchases,
    pdamSnapshots,
  ]);

  // Synchronize parsed payload metadata whenever Super User changes targetMonth/targetYear after parsing
  const handleChangeTargetPeriod = (newYear: number, newMonth: string) => {
    setTargetYear(newYear);
    setTargetMonth(newMonth);
    setParsedPayload((prev) => {
      if (!prev) return null;
      return normalizeParsedFinanceReport({
        raw: {
          detectedPeriod: prev.detectedPeriod,
          coaAccounts: prev.coaAccounts,
          cashBanks: prev.cashBanks.map((cb) => ({ ...cb, balance: cb.openingBalance })),
          receivablesPayables: prev.receivablesPayables,
          assets: prev.assets,
          taxes: prev.taxes,
          inventory: prev.inventory,
          purchases: prev.purchases,
          pdamSnapshot: prev.pdamSnapshot,
          parserNotes: prev.parserNotes,
        },
        targetYear: newYear,
        targetMonth: newMonth,
        actorName: actor.displayName,
        parserSource: prev.parserSource,
      });
    });
  };

  const handleFilePicked = (file: File | null) => {
    setFeedback(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFeedback({
        type: 'error',
        message: `Ukuran file "${file.name}" (${formatBytes(file.size)}) melebihi batas maksimum 50 MB.`,
      });
      return;
    }
    setSelectedFile(file);
  };

  const handleExtractFile = async () => {
    if (!selectedFile) {
      setFeedback({ type: 'error', message: 'Pilih file laporan bulanan terlebih dahulu.' });
      return;
    }
    setParsing(true);
    setFeedback(null);

    try {
      const lowerName = selectedFile.name.toLowerCase();
      const isExcelOrCsv =
        lowerName.endsWith('.xlsx') ||
        lowerName.endsWith('.xls') ||
        lowerName.endsWith('.csv');

      let spreadsheetText = '';
      let mimeType = selectedFile.type || 'application/pdf';
      let fileBase64 = '';

      if (isExcelOrCsv) {
        const buf = await selectedFile.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });

        // 1. Check if uploaded workbook matches our exact structured PDAM Excel template
        const directTemplateParsed = tryParseStructuredPdamExcelWorkbook({
          workbook: wb,
          targetYear,
          targetMonth,
          actorName: actor.displayName,
        });
        if (directTemplateParsed) {
          setParsedPayload(directTemplateParsed);
          setPreviewTab('RINGKASAN');
          setFeedback({
            type: 'success',
            message: `Template Excel terbaca lengkap dan dikunci ke periode ${targetMonth} ${targetYear} (${directTemplateParsed.coaAccounts.length} akun COA, ${directTemplateParsed.cashBanks.length} Kas/Bank). Silakan review & sesuaikan sebelum diterapkan.`,
          });
          setParsing(false);
          return;
        }

        // 2. Arbitrary Excel/CSV -> extract CSV sheets and send to Gemini parser
        spreadsheetText = workbookToPlainText(wb);
        mimeType = lowerName.endsWith('.csv')
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      } else {
        // PDF / Image -> send base64 to server Gemini multimodal parser
        if (!mimeType) {
          if (lowerName.endsWith('.png')) mimeType = 'image/png';
          else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) mimeType = 'image/jpeg';
          else mimeType = 'application/pdf';
        }
        fileBase64 = await readFileAsDataUrl(selectedFile);
      }

      const res = await fetch('/api/gemini/parse-finance-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorRole: actor.role,
          actorName: actor.displayName,
          targetYear,
          targetMonth,
          fileName: selectedFile.name,
          mimeType,
          fileBase64: fileBase64 || undefined,
          spreadsheetText: spreadsheetText || undefined,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.data) {
        throw new Error(body?.error || `Gagal membaca laporan (HTTP ${res.status}).`);
      }

      const extracted = body.data as FinanceMonthlyUploadParsedPayload;
      setParsedPayload(extracted);
      setPreviewTab('RINGKASAN');
      setFeedback({
        type: 'success',
        message: `Dokumen "${selectedFile.name}" berhasil dibaca otomatis (${extracted.coaAccounts.length} akun COA, ${extracted.cashBanks.length} Kas/Bank, ${extracted.assets.length} Aset, ${extracted.receivablesPayables.length} Utang/Piutang) dan ditandai untuk periode ${targetMonth} ${targetYear}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Gagal membaca file laporan.',
      });
    } finally {
      setParsing(false);
    }
  };

  const handleLoadManualDraft = () => {
    const standardCoa = buildOfficialPDAMCoaJan2026(targetYear, actor.displayName).map((c) => ({
      ...c,
      openingBalance: c.type === 'Pendapatan' || c.type === 'Beban' ? 0 : c.openingBalance,
      prevMonthBalance: c.openingBalance,
      monthlyRealization: 0,
      ytdRealization: 0,
    }));
    const normalized = normalizeParsedFinanceReport({
      raw: {
        detectedPeriod: {
          year: targetYear,
          month: targetMonth,
          documentTitle: `Input Penyesuaian Manual ${targetMonth} ${targetYear}`,
        },
        coaAccounts: standardCoa,
        cashBanks: cashBankAccounts.slice(0, 8).map((cb) => ({
          code: cb.code,
          name: cb.name,
          accountKind: cb.accountKind,
          bankName: cb.bankName,
          accountNumber: cb.accountNumber,
          coaCode: cb.coaCode,
          balance: cb.openingBalance,
        })),
        parserNotes: [
          `Draf struktur akun standar PDAM disiapkan untuk penyesuaian manual periode ${targetMonth} ${targetYear}.`,
        ],
      },
      targetYear,
      targetMonth,
      actorName: actor.displayName,
      parserSource: 'manual-review',
    });
    setParsedPayload(normalized);
    setPreviewTab('COA');
    setFeedback({
      type: 'info',
      message: `Draf COA standar PDAM untuk ${targetMonth} ${targetYear} telah dimuat. Silakan isi/sesuaikan angka sebelum menekan Terapkan.`,
    });
  };

  const previewMetrics = useMemo(() => {
    if (!parsedPayload) return null;
    return computePayloadPreviewStats(parsedPayload);
  }, [parsedPayload]);

  const handleCommitUpload = async () => {
    if (!parsedPayload) return;
    if (periodLocked) {
      setFeedback({
        type: 'error',
        message: `Periode ${targetMonth} ${targetYear} berstatus TUTUP BUKU (terkunci). Buka kunci periode pada tab Akuntansi & COA terlebih dahulu sebelum menerapkan laporan ini.`,
      });
      return;
    }
    setCommitting(true);
    setFeedback(null);
    try {
      const res = await commitMonthlyReportUploadToFirestore({
        payload: parsedPayload,
        applyMode,
        fileMeta: {
          fileName: selectedFile?.name || `Input_Manual_${targetMonth}_${targetYear}.xlsx`,
          fileSizeBytes: selectedFile?.size || 0,
          mimeType: selectedFile?.type || 'application/octet-stream',
        },
        actor,
      });

      setFeedback({
        type: 'success',
        message: `Laporan "${res.uploadRecord.fileName}" berhasil diterapkan khusus untuk periode ${targetMonth} ${targetYear} (${res.writtenCount} dokumen disimpan${res.deletedCount > 0 ? `, ${res.deletedCount} dokumen lama bulan tersebut diperbarui` : ''}). Data bulan lain tetap aman dan tidak berubah.`,
        lastApplied: { year: targetYear, month: targetMonth },
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan ke Manajemen Keuangan: ${
          err instanceof Error ? err.message : 'Error'
        }`,
      });
    } finally {
      setCommitting(false);
    }
  };

  // Inline Editors
  const updateCoaField = (
    idx: number,
    field: keyof FinanceAccount,
    value: string | number | boolean
  ) => {
    setParsedPayload((prev) => {
      if (!prev) return null;
      const nextCoa = [...prev.coaAccounts];
      nextCoa[idx] = { ...nextCoa[idx], [field]: value };
      return { ...prev, coaAccounts: nextCoa };
    });
  };

  const addBlankCoaRow = () => {
    setParsedPayload((prev) => {
      if (!prev) return null;
      const newAcc: FinanceAccount = {
        id: `coa-${targetYear}-new-${Date.now()}`,
        code: '96.99.99',
        name: 'Akun Penyesuaian Baru',
        type: 'Beban',
        subCategory: 'Beban Administrasi & Umum',
        normalBalance: 'Debit',
        cashFlowGroup: 'Operasional',
        openingBalance: 0,
        prevMonthBalance: 0,
        monthlyRealization: 0,
        ytdRealization: 0,
        budgetMonthly: 0,
        budgetYtd: 0,
        isContra: false,
        year: targetYear,
        month: targetMonth,
        isActive: true,
        createdBy: actor.displayName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { ...prev, coaAccounts: [...prev.coaAccounts, newAcc] };
    });
  };

  const removeCoaRow = (idx: number) => {
    setParsedPayload((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        coaAccounts: prev.coaAccounts.filter((_, i) => i !== idx),
      };
    });
  };

  const updateCashBankBalance = (idx: number, balance: number) => {
    setParsedPayload((prev) => {
      if (!prev) return null;
      const next = [...prev.cashBanks];
      next[idx] = { ...next[idx], openingBalance: balance };
      return { ...prev, cashBanks: next };
    });
  };

  const sortedHistory = useMemo(
    () =>
      [...uploadHistory].sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || '')),
    [uploadHistory]
  );

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
              <Sparkles className="w-3 h-3" />
              Eksklusif Super User
            </span>
            <h2 className="text-sm font-bold text-slate-900">
              Upload &amp; Pembacaan Otomatis Laporan Keuangan Bulanan
            </h2>
          </div>
          <p className="text-xs text-slate-600">
            Unggah laporan keuangan PDAM (PDF, Excel .xlsx/.xls/.csv, atau gambar scan). Sistem membaca angka secara otomatis, mengizinkan penyesuaian manual, dan mengunci hasil khusus ke bulan yang Anda pilih.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => exportPdamMonthlyExcelTemplate(targetYear, targetMonth)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Template Excel</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
            feedback.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedback.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.message}</span>
          </div>
          {feedback.lastApplied && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  onJumpToPeriod(
                    feedback.lastApplied!.year,
                    feedback.lastApplied!.month,
                    'dashboard'
                  )
                }
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-emerald-300 text-emerald-800 rounded-lg font-bold cursor-pointer hover:bg-emerald-100"
              >
                <span>Dashboard {feedback.lastApplied.month}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  onJumpToPeriod(
                    feedback.lastApplied!.year,
                    feedback.lastApplied!.month,
                    'laporan'
                  )
                }
                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer hover:bg-emerald-800"
              >
                <span>Buka Laporan {feedback.lastApplied.month}</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 1 & Step 2 Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Step 1: Target Month & Year */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <span className="w-5 h-5 rounded-full bg-emerald-700 text-white text-[11px] flex items-center justify-center">
              1
            </span>
            <Calendar className="w-4 h-4 text-emerald-700" />
            <span>Pilih Bulan &amp; Tahun Tujuan Laporan</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Bulan Target *
              </label>
              <select
                value={targetMonth}
                onChange={(e) => handleChangeTargetPeriod(targetYear, e.target.value)}
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-900"
              >
                {FISCAL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Tahun Anggaran *
              </label>
              <select
                value={targetYear}
                onChange={(e) =>
                  handleChangeTargetPeriod(parseInt(e.target.value, 10), targetMonth)
                }
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-900"
              >
                {yearChoices.map((y) => (
                  <option key={y} value={y}>
                    TA {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Mode Penyesuaian Data Periode
            </label>
            <select
              value={applyMode}
              onChange={(e) => setApplyMode(e.target.value as FinanceUploadApplyMode)}
              className="w-full px-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
            >
              <option value="REPLACE_MONTH">
                Ganti Data Khusus Bulan {targetMonth} {targetYear} (Direkomendasikan)
              </option>
              <option value="MERGE_MONTH">
                Tambahkan / Perbarui Tanpa Menghapus Item Bulan Ini
              </option>
            </select>
          </div>

          {/* Current DB status for chosen month */}
          <div
            className={`rounded-lg border p-3 text-[11px] space-y-1 ${
              periodLocked
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : existingPeriodStats.hasAnyData
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <span>
                Status Database: {targetMonth} {targetYear}
              </span>
              {periodLocked && (
                <span className="inline-flex items-center gap-1 text-rose-700">
                  <Lock className="w-3 h-3" /> Tutup Buku
                </span>
              )}
            </div>
            {existingPeriodStats.hasAnyData ? (
              <p className="leading-relaxed">
                Sudah tersimpan: <strong>{existingPeriodStats.coaCount}</strong> COA,{' '}
                <strong>{existingPeriodStats.cbCount}</strong> Kas/Bank,{' '}
                <strong>{existingPeriodStats.rpCount}</strong> Utang/Piutang,{' '}
                <strong>{existingPeriodStats.assetCount}</strong> Aset,{' '}
                <strong>{existingPeriodStats.invCount}</strong> Persediaan
                {existingPeriodStats.hasPdamSnap ? ', Snapshot PDAM tersedia' : ''}. Bulan lain (mis. Des 2025 / Jan 2026) tidak akan terpengaruh.
              </p>
            ) : (
              <p className="leading-relaxed">
                Belum ada data laporan untuk <strong>{targetMonth} {targetYear}</strong>. Hasil upload akan disimpan terisolasi khusus untuk bulan ini.
              </p>
            )}
          </div>
        </div>

        {/* Step 2: File Upload & Extraction */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <span className="w-5 h-5 rounded-full bg-emerald-700 text-white text-[11px] flex items-center justify-center">
                  2
                </span>
                <UploadCloud className="w-4 h-4 text-emerald-700" />
                <span>Unggah Dokumen Laporan Bulanan &amp; Baca Otomatis</span>
              </div>
              <button
                type="button"
                onClick={handleLoadManualDraft}
                className="text-[11px] font-semibold text-slate-600 hover:text-emerald-800 underline cursor-pointer"
              >
                Siapkan Draf COA Kosong ({targetMonth})
              </button>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0] || null;
                handleFilePicked(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-emerald-500 bg-slate-50/70 hover:bg-emerald-50/40 rounded-xl p-5 text-center cursor-pointer transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
                onChange={(e) => handleFilePicked(e.target.files?.[0] || null)}
                className="hidden"
              />
              {selectedFile ? (
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-2 text-xs font-bold text-emerald-800">
                    {selectedFile.name.toLowerCase().endsWith('.pdf') ? (
                      <FileText className="w-5 h-5 text-rose-600" />
                    ) : (
                      <FileSpreadsheet className="w-5 h-5 text-emerald-700" />
                    )}
                    <span>{selectedFile.name}</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Ukuran: {formatBytes(selectedFile.size)} · Klik untuk mengganti file
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <UploadCloud className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-xs font-semibold text-slate-800">
                    Klik atau seret file Laporan Keuangan ke sini
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Mendukung PDF resmi PDAM, Excel (.xlsx / .xls / .csv), atau gambar scan (.png / .jpg) maksimal 50 MB
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-slate-500">
              Setiap baris akun, kas/bank, dan ikhtisar otomatis dikunci ke{' '}
              <strong className="text-slate-800">
                {targetMonth} {targetYear}
              </strong>
              .
            </span>
            <button
              type="button"
              disabled={!selectedFile || parsing}
              onClick={handleExtractFile}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {parsing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Membaca &amp; Mengekstrak Laporan...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>
                    Baca Otomatis untuk {targetMonth} {targetYear}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Step 3 & 4: Preview, Validation, Inline Adjustment & Commit */}
      {parsedPayload && previewMetrics && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <span className="w-5 h-5 rounded-full bg-emerald-700 text-white text-[11px] flex items-center justify-center">
                  3
                </span>
                <span>
                  Review &amp; Penyesuaian Data Sebelum Diterapkan ({parsedPayload.targetMonth}{' '}
                  {parsedPayload.targetYear})
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Sumber pembacaan: <strong>{parsedPayload.parserSource}</strong> · Surat:{' '}
                {parsedPayload.pdamSnapshot.letterNumber || '-'}
              </p>
            </div>

            <button
              type="button"
              disabled={committing || periodLocked}
              onClick={handleCommitUpload}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {committing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Menyimpan ke Manajemen Keuangan...</span>
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  <span>
                    Terapkan Laporan ke {targetMonth} {targetYear}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Discrepancy warning if PDF month !== chosen targetMonth */}
          {parsedPayload.detectedPeriod.discrepancyWarning && (
            <div className="bg-amber-50 border border-amber-300 rounded-lg px-3.5 py-2.5 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{parsedPayload.detectedPeriod.discrepancyWarning}</span>
              </div>
              {parsedPayload.detectedPeriod.month &&
                FISCAL_MONTHS.some(
                  (m) => m.toLowerCase() === parsedPayload.detectedPeriod.month?.toLowerCase()
                ) && (
                  <button
                    type="button"
                    onClick={() => {
                      const matchedMonth =
                        FISCAL_MONTHS.find(
                          (m) =>
                            m.toLowerCase() ===
                            parsedPayload.detectedPeriod.month?.toLowerCase()
                        ) || targetMonth;
                      handleChangeTargetPeriod(
                        parsedPayload.detectedPeriod.year || targetYear,
                        matchedMonth
                      );
                    }}
                    className="px-2.5 py-1 bg-amber-700 text-white rounded font-bold text-[11px] shrink-0 cursor-pointer hover:bg-amber-800"
                  >
                    Sesuaikan ke {parsedPayload.detectedPeriod.month}{' '}
                    {parsedPayload.detectedPeriod.year || targetYear}
                  </button>
                )}
            </div>
          )}

          {/* 4 Live Financial Validation KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                Posisi Neraca (Validasi Balance)
              </div>
              <div className="font-bold text-slate-900 tabular-nums">
                {formatRp(previewMetrics.statements.balanceSheet.totalAssets)}
              </div>
              <div
                className={`text-[11px] font-semibold ${
                  previewMetrics.statements.balanceSheet.isBalanced
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}
              >
                {previewMetrics.statements.balanceSheet.isBalanced
                  ? 'Neraca Seimbang (Aset = Pasiva)'
                  : `Selisih Pasiva: ${formatRp(
                      previewMetrics.statements.balanceSheet.totalAssets -
                        previewMetrics.statements.balanceSheet.totalLiabilitiesAndEquity
                    )}`}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                {previewMetrics.statements.incomeStatement.operatingIncome < 0
                  ? 'Rugi Usaha (Bulan / YTD)'
                  : 'Laba Usaha (Bulan / YTD)'}
              </div>
              <div
                className={`font-bold tabular-nums ${
                  previewMetrics.statements.incomeStatement.operatingIncome < 0
                    ? 'text-rose-700'
                    : 'text-emerald-700'
                }`}
              >
                {formatRp(
                  previewMetrics.statements.incomeStatement.monthlyOperatingIncome ||
                    previewMetrics.statements.incomeStatement.operatingIncome
                )}
              </div>
              <div className="text-[11px] text-slate-600 tabular-nums">
                {previewMetrics.statements.incomeStatement.netIncome < 0
                  ? 'Rugi Bersih: '
                  : 'Laba Bersih: '}
                <strong>
                  {formatRp(
                    previewMetrics.statements.incomeStatement.monthlyNetIncome ||
                      previewMetrics.statements.incomeStatement.netIncome
                  )}
                </strong>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                Total Saldo Kas &amp; Bank
              </div>
              <div className="font-bold text-slate-900 tabular-nums">
                {formatRp(previewMetrics.cashBank.totalLiquidBalance)}
              </div>
              <div className="text-[11px] text-slate-600">
                {parsedPayload.cashBanks.length} Rekening Kas &amp; Bank terekstrak
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500">
                Cakupan Data Periode {targetMonth} {targetYear}
              </div>
              <div className="font-bold text-slate-900 tabular-nums">
                {parsedPayload.coaAccounts.length} COA · {parsedPayload.assets.length} Aset
              </div>
              <div className="text-[11px] text-slate-600">
                {parsedPayload.receivablesPayables.length} Piutang/Utang ·{' '}
                {parsedPayload.inventory.length} Persediaan · {parsedPayload.taxes.length} Pajak
              </div>
            </div>
          </div>

          {/* Preview Sub-tabs */}
          <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-2">
            {(
              [
                { id: 'RINGKASAN', label: 'Ringkasan & Surat' },
                { id: 'COA', label: `COA, Neraca & Laba Rugi (${parsedPayload.coaAccounts.length})` },
                { id: 'KAS_BANK', label: `Kas & Bank (${parsedPayload.cashBanks.length})` },
                { id: 'UTANG_PIUTANG', label: `Utang & Piutang (${parsedPayload.receivablesPayables.length})` },
                { id: 'ASET_PAJAK', label: `Aset (${parsedPayload.assets.length}) & Pajak (${parsedPayload.taxes.length})` },
                { id: 'PERSEDIAAN_PEMBELIAN', label: `Persediaan (${parsedPayload.inventory.length}) & PO (${parsedPayload.purchases.length})` },
                { id: 'OPERASIONAL_PDAM', label: 'Operasional PDAM' },
              ] as { id: PreviewSectionTab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPreviewTab(t.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap cursor-pointer ${
                  previewTab === t.id
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Preview Tab Panels */}
          {previewTab === 'RINGKASAN' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="border border-slate-200 rounded-lg p-3.5 space-y-2">
                <div className="font-bold text-slate-900">Identitas Surat &amp; Pejabat Penandatangan</div>
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500">Nomor Surat</label>
                    <input
                      type="text"
                      value={parsedPayload.pdamSnapshot.letterNumber}
                      onChange={(e) =>
                        setParsedPayload((p) =>
                          p
                            ? {
                                ...p,
                                pdamSnapshot: { ...p.pdamSnapshot, letterNumber: e.target.value },
                              }
                            : null
                        )
                      }
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-slate-50"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">Direktur</label>
                      <input
                        type="text"
                        value={parsedPayload.pdamSnapshot.directorName}
                        onChange={(e) =>
                          setParsedPayload((p) =>
                            p
                              ? {
                                  ...p,
                                  pdamSnapshot: { ...p.pdamSnapshot, directorName: e.target.value },
                                }
                              : null
                          )
                        }
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-slate-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500">Kabid Keuangan</label>
                      <input
                        type="text"
                        value={parsedPayload.pdamSnapshot.kabidKeuName}
                        onChange={(e) =>
                          setParsedPayload((p) =>
                            p
                              ? {
                                  ...p,
                                  pdamSnapshot: { ...p.pdamSnapshot, kabidKeuName: e.target.value },
                                }
                              : null
                          )
                        }
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded bg-slate-50"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3.5 space-y-2">
                <div className="font-bold text-slate-900">Catatan Pembacaan Otomatis</div>
                <ul className="list-disc pl-4 space-y-1 text-slate-600">
                  <li>
                    Periode target dikunci mutlak ke{' '}
                    <strong>
                      {targetMonth} {targetYear}
                    </strong>
                    .
                  </li>
                  <li>
                    Seluruh akun Neraca &amp; Laba Rugi dapat disesuaikan langsung pada tab{' '}
                    <strong>COA, Neraca &amp; Laba Rugi</strong> sebelum diterapkan.
                  </li>
                  {(parsedPayload.parserNotes || []).map((note, idx) => (
                    <li key={idx}>{note}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {previewTab === 'COA' && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">
                  Sesuaikan nominal saldo/realisasi jika ada koreksi sebelum disimpan ke{' '}
                  <strong>
                    {targetMonth} {targetYear}
                  </strong>
                  .
                </span>
                <button
                  type="button"
                  onClick={addBlankCoaRow}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Baris COA</span>
                </button>
              </div>
              <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[420px]">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="px-2.5 py-2 text-left">Kode</th>
                      <th className="px-2.5 py-2 text-left">Nama Akun</th>
                      <th className="px-2.5 py-2 text-left">Tipe</th>
                      <th className="px-2.5 py-2 text-right">Saldo Akhir / YTD</th>
                      <th className="px-2.5 py-2 text-right">Bulan Lalu</th>
                      <th className="px-2.5 py-2 text-right">Real. Bulan Ini</th>
                      <th className="px-2.5 py-2 text-right">Anggaran Bln</th>
                      <th className="px-2.5 py-2 text-center">Kontra</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedPayload.coaAccounts.map((acc, idx) => (
                      <tr key={acc.id || idx} className="hover:bg-slate-50/70">
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={acc.code}
                            onChange={(e) => updateCoaField(idx, 'code', e.target.value)}
                            className="w-20 px-1.5 py-1 border border-slate-200 rounded font-mono text-[11px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="text"
                            value={acc.name}
                            onChange={(e) => updateCoaField(idx, 'name', e.target.value)}
                            className="w-48 px-1.5 py-1 border border-slate-200 rounded text-[11px]"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={acc.type}
                            onChange={(e) => updateCoaField(idx, 'type', e.target.value)}
                            className="px-1.5 py-1 border border-slate-200 rounded text-[11px] bg-white"
                          >
                            <option value="Aset">Aset</option>
                            <option value="Kewajiban">Kewajiban</option>
                            <option value="Ekuitas">Ekuitas</option>
                            <option value="Pendapatan">Pendapatan</option>
                            <option value="Beban">Beban</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            value={acc.openingBalance}
                            onChange={(e) =>
                              updateCoaField(
                                idx,
                                'openingBalance',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-28 px-1.5 py-1 border border-slate-200 rounded text-right tabular-nums text-[11px]"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            value={acc.prevMonthBalance ?? 0}
                            onChange={(e) =>
                              updateCoaField(
                                idx,
                                'prevMonthBalance',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-28 px-1.5 py-1 border border-slate-200 rounded text-right tabular-nums text-[11px]"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            value={acc.monthlyRealization ?? 0}
                            onChange={(e) =>
                              updateCoaField(
                                idx,
                                'monthlyRealization',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-28 px-1.5 py-1 border border-slate-200 rounded text-right tabular-nums text-[11px]"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            type="number"
                            value={acc.budgetMonthly ?? 0}
                            onChange={(e) =>
                              updateCoaField(
                                idx,
                                'budgetMonthly',
                                parseFloat(e.target.value) || 0
                              )
                            }
                            className="w-28 px-1.5 py-1 border border-slate-200 rounded text-right tabular-nums text-[11px]"
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(acc.isContra)}
                            onChange={(e) => updateCoaField(idx, 'isContra', e.target.checked)}
                          />
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeCoaRow(idx)}
                            className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                            title="Hapus baris"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {previewTab === 'KAS_BANK' && (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Kode COA</th>
                    <th className="px-3 py-2 text-left">Nama Rekening Kas/Bank</th>
                    <th className="px-3 py-2 text-left">Jenis</th>
                    <th className="px-3 py-2 text-left">No. Rekening</th>
                    <th className="px-3 py-2 text-right">Saldo Akhir ({targetMonth})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedPayload.cashBanks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                        Belum ada rincian kas/bank terekstrak untuk bulan ini.
                      </td>
                    </tr>
                  ) : (
                    parsedPayload.cashBanks.map((cb, idx) => (
                      <tr key={cb.id || idx}>
                        <td className="px-3 py-2 font-mono">{cb.coaCode}</td>
                        <td className="px-3 py-2 font-semibold">{cb.name}</td>
                        <td className="px-3 py-2">{cb.accountKind}</td>
                        <td className="px-3 py-2 text-slate-500">{cb.accountNumber || '-'}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            value={cb.openingBalance}
                            onChange={(e) =>
                              updateCashBankBalance(idx, parseFloat(e.target.value) || 0)
                            }
                            className="w-36 px-2 py-1 border border-slate-200 rounded text-right tabular-nums"
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {previewTab === 'UTANG_PIUTANG' && (
            <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-80">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left">Jenis</th>
                    <th className="px-3 py-2 text-left">No. Dokumen</th>
                    <th className="px-3 py-2 text-left">Pihak / Pelanggan</th>
                    <th className="px-3 py-2 text-left">COA</th>
                    <th className="px-3 py-2 text-right">Sisa Tagihan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {parsedPayload.receivablesPayables.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                        Tidak ada rincian utang/piutang individual pada hasil pembacaan.
                      </td>
                    </tr>
                  ) : (
                    parsedPayload.receivablesPayables.map((rp) => (
                      <tr key={rp.id}>
                        <td className="px-3 py-2 font-semibold">{rp.kind}</td>
                        <td className="px-3 py-2 font-mono">{rp.documentNumber}</td>
                        <td className="px-3 py-2">{rp.partyName}</td>
                        <td className="px-3 py-2 font-mono">{rp.coaCode}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {formatRp(rp.remainingAmount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {previewTab === 'ASET_PAJAK' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-80">
                <div className="px-3 py-2 bg-slate-50 font-bold border-b border-slate-200">
                  Aset Tetap ({parsedPayload.assets.length})
                </div>
                <table className="w-full">
                  <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-2.5 py-1.5 text-left">Kode</th>
                      <th className="px-2.5 py-1.5 text-left">Nama Aset</th>
                      <th className="px-2.5 py-1.5 text-right">Nilai Buku</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedPayload.assets.map((a) => (
                      <tr key={a.id}>
                        <td className="px-2.5 py-1.5 font-mono">{a.assetCode}</td>
                        <td className="px-2.5 py-1.5">{a.name}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">
                          {formatRp(a.bookValue)}
                        </td>
                      </tr>
                    ))}
                    {parsedPayload.assets.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                          Tidak ada daftar aset terekstrak.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-80">
                <div className="px-3 py-2 bg-slate-50 font-bold border-b border-slate-200">
                  Kewajiban &amp; Potongan Pajak ({parsedPayload.taxes.length})
                </div>
                <table className="w-full">
                  <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-2.5 py-1.5 text-left">Jenis</th>
                      <th className="px-2.5 py-1.5 text-left">Objek Pajak</th>
                      <th className="px-2.5 py-1.5 text-right">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedPayload.taxes.map((t) => (
                      <tr key={t.id}>
                        <td className="px-2.5 py-1.5 font-semibold">{t.taxType}</td>
                        <td className="px-2.5 py-1.5">{t.taxObject}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">
                          {formatRp(t.taxAmount)}
                        </td>
                      </tr>
                    ))}
                    {parsedPayload.taxes.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                          Tidak ada daftar pajak terekstrak.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {previewTab === 'PERSEDIAAN_PEMBELIAN' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-80">
                <div className="px-3 py-2 bg-slate-50 font-bold border-b border-slate-200">
                  Persediaan Gudang ({parsedPayload.inventory.length})
                </div>
                <table className="w-full">
                  <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-2.5 py-1.5 text-left">COA</th>
                      <th className="px-2.5 py-1.5 text-left">Nama Persediaan</th>
                      <th className="px-2.5 py-1.5 text-right">Nilai Akhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedPayload.inventory.map((i) => (
                      <tr key={i.id}>
                        <td className="px-2.5 py-1.5 font-mono">{i.coaCode}</td>
                        <td className="px-2.5 py-1.5">{i.name}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">
                          {formatRp(i.endingValue)}
                        </td>
                      </tr>
                    ))}
                    {parsedPayload.inventory.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                          Tidak ada daftar persediaan terekstrak.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-x-auto max-h-80">
                <div className="px-3 py-2 bg-slate-50 font-bold border-b border-slate-200">
                  Realisasi Pembelian ({parsedPayload.purchases.length})
                </div>
                <table className="w-full">
                  <thead className="bg-slate-50/70 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-2.5 py-1.5 text-left">Kategori</th>
                      <th className="px-2.5 py-1.5 text-left">Uraian</th>
                      <th className="px-2.5 py-1.5 text-right">Nilai</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedPayload.purchases.map((p) => (
                      <tr key={p.id}>
                        <td className="px-2.5 py-1.5 font-semibold">{p.category}</td>
                        <td className="px-2.5 py-1.5">{p.itemDescription}</td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">
                          {formatRp(p.amount)}
                        </td>
                      </tr>
                    ))}
                    {parsedPayload.purchases.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-slate-500">
                          Tidak ada transaksi pembelian terekstrak.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {previewTab === 'OPERASIONAL_PDAM' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-slate-500">Ikhtisar Kegiatan</div>
                <div className="text-base font-bold text-slate-900">
                  {parsedPayload.pdamSnapshot.summaryMetrics.length} indikator
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-slate-500">Efisiensi Penagihan Unit</div>
                <div className="text-base font-bold text-slate-900">
                  {parsedPayload.pdamSnapshot.collectionEfficiency.length} unit
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-slate-500">Produksi &amp; NRW</div>
                <div className="text-base font-bold text-slate-900">
                  {parsedPayload.pdamSnapshot.productionDistribution.length} unit
                </div>
              </div>
              <div className="border border-slate-200 rounded-lg p-3">
                <div className="text-slate-500">DRD &amp; Tarif</div>
                <div className="text-base font-bold text-slate-900">
                  {parsedPayload.pdamSnapshot.drdSummary.length} kelompok
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Riwayat Upload Laporan Bulanan */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
            <History className="w-4 h-4 text-emerald-700" />
            <span>Riwayat Upload Laporan Bulanan Terisolasi Per Periode</span>
          </div>
          <span className="text-[11px] text-slate-500">
            Total {sortedHistory.length} arsip upload
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left">Periode Target</th>
                <th className="px-3 py-2 text-left">Nama Dokumen</th>
                <th className="px-3 py-2 text-right">Total Aset</th>
                <th className="px-3 py-2 text-right">Laba / (Rugi) Bersih</th>
                <th className="px-3 py-2 text-right">Kas &amp; Bank</th>
                <th className="px-3 py-2 text-left">Diterapkan Oleh</th>
                <th className="px-3 py-2 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    Belum ada riwayat upload laporan bulanan baru melalui modul ini.
                  </td>
                </tr>
              ) : (
                sortedHistory.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2 font-bold text-slate-900 whitespace-nowrap">
                      {item.targetMonth} {item.targetYear}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{item.fileName}</div>
                      <div className="text-[10px] text-slate-500">
                        {item.summary.coaCount} COA · {item.summary.cashBankCount} Kas/Bank · Sumber: {item.parserSource}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatRp(item.summary.totalAssets)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums font-semibold ${
                        item.summary.netIncome < 0 ? 'text-rose-700' : 'text-emerald-700'
                      }`}
                    >
                      {formatRp(item.summary.netIncome)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatRp(item.summary.totalCashBank)}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      <div>{item.uploadedBy}</div>
                      <div className="text-[10px] text-slate-400">
                        {item.appliedAt.slice(0, 16).replace('T', ' ')}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            onJumpToPeriod(item.targetYear, item.targetMonth, 'laporan')
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded font-semibold cursor-pointer"
                          title={`Lihat laporan ${item.targetMonth} ${item.targetYear}`}
                        >
                          <Eye className="w-3 h-3" />
                          <span>Lihat</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteHistoryTarget(item)}
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                          title="Hapus catatan riwayat upload"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteHistoryTarget && (
        <FinanceDeleteConfirmModal
          isOpen={Boolean(deleteHistoryTarget)}
          title="Hapus Catatan Riwayat Upload"
          itemLabel={`${deleteHistoryTarget.fileName} (${deleteHistoryTarget.targetMonth} ${deleteHistoryTarget.targetYear})`}
          description="Tindakan ini hanya menghapus log riwayat upload ini. Data laporan keuangan pada periode terkait tetap aman tersimpan di modul Manajemen Keuangan."
          onCancel={() => setDeleteHistoryTarget(null)}
          onConfirm={async () => {
            await deleteMonthlyUploadHistoryRecord(deleteHistoryTarget);
            setDeleteHistoryTarget(null);
          }}
        />
      )}
    </div>
  );
};
