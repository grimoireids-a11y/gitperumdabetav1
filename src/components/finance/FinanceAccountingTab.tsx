import React, { useMemo, useState } from 'react';
import {
  Plus,
  Lock,
  Unlock,
  Database,
  Trash2,
  X,
  CheckCircle2,
  Edit3,
} from 'lucide-react';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import {
  FinanceAccount,
  FinanceAccountType,
  FinanceCashFlowGroup,
  FinanceGlobalFilter,
  FinanceJournal,
  FinanceJournalLine,
  FinanceJournalType,
  FinancePeriodClose,
} from '../../types/finance';
import { buildDefaultCashBankAccounts, buildDefaultPDAMCoa } from '../../data/financeStandards';
import { FISCAL_MONTHS } from '../../lib/featureCatalog';
import {
  AccountingStatements,
  formatDateShort,
  formatRp,
  getMonthNameFromDate,
  getTodayIso,
  isPeriodLocked,
  sanitizeFirestoreRecord,
} from '../../lib/financeEngine';
import { FinanceActor, FinancePermissions, LogFinanceAuditFn } from './financeShared';

interface FinanceAccountingTabProps {
  filter: FinanceGlobalFilter;
  accounts: FinanceAccount[];
  journals: FinanceJournal[];
  periodCloses: FinancePeriodClose[];
  statements: AccountingStatements;
  actor: FinanceActor;
  permissions: FinancePermissions;
  onLogAudit: LogFinanceAuditFn;
}

type AccountingView = 'COA' | 'JURNAL' | 'BUKU_BESAR' | 'NERACA_SALDO' | 'TUTUP_BUKU';

export const FinanceAccountingTab: React.FC<FinanceAccountingTabProps> = ({
  filter,
  accounts,
  journals,
  periodCloses,
  statements,
  actor,
  permissions,
  onLogAudit,
}) => {
  const [subView, setSubView] = useState<AccountingView>('COA');
  const [journalTypeFilter, setJournalTypeFilter] = useState<string>('ALL');
  const [selectedLedgerCoaId, setSelectedLedgerCoaId] = useState<string>('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // COA Modal
  const [isCoaModalOpen, setIsCoaModalOpen] = useState(false);
  const [editingCoa, setEditingCoa] = useState<FinanceAccount | null>(null);
  const [coaCode, setCoaCode] = useState('');
  const [coaName, setCoaName] = useState('');
  const [coaType, setCoaType] = useState<FinanceAccountType>('Beban');
  const [coaSubCategory, setCoaSubCategory] = useState('Beban Administrasi & Umum');
  const [coaNormal, setCoaNormal] = useState<'Debit' | 'Kredit'>('Debit');
  const [coaCfGroup, setCoaCfGroup] = useState<FinanceCashFlowGroup>('Operasional');
  const [coaOpening, setCoaOpening] = useState('0');

  // Journal Modal
  const [isJournalModalOpen, setIsJournalModalOpen] = useState(false);
  const [jrnNumber, setJrnNumber] = useState('');
  const [jrnType, setJrnType] = useState<FinanceJournalType>('UMUM');
  const [jrnDate, setJrnDate] = useState(getTodayIso());
  const [jrnDesc, setJrnDesc] = useState('');
  const [jrnLines, setJrnLines] = useState<FinanceJournalLine[]>([
    { coaId: '', coaCode: '', coaName: '', description: '', debit: 0, credit: 0 },
    { coaId: '', coaCode: '', coaName: '', description: '', debit: 0, credit: 0 },
  ]);

  const activeYear = filter.year !== 0 ? filter.year : new Date().getFullYear();

  const sortedAccounts = useMemo(() => {
    const filtered = accounts.filter((a) => filter.year === 0 || a.year === filter.year);
    return (filtered.length > 0 ? filtered : accounts).sort((a, b) =>
      a.code.localeCompare(b.code)
    );
  }, [accounts, filter.year]);

  const filteredJournals = useMemo(() => {
    return journals
      .filter((j) => {
        if (filter.year !== 0 && j.year !== filter.year) return false;
        if (filter.month !== 'ALL' && j.month.toLowerCase() !== filter.month.toLowerCase()) {
          return false;
        }
        if (journalTypeFilter !== 'ALL' && j.journalType !== journalTypeFilter) return false;
        if (
          filter.coaId !== 'ALL' &&
          !j.lines.some((l) => l.coaId === filter.coaId)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.journalDate.localeCompare(a.journalDate));
  }, [journals, filter, journalTypeFilter]);

  const selectedLedger = useMemo(() => {
    if (selectedLedgerCoaId) {
      const found = statements.ledgers.find((l) => l.account.id === selectedLedgerCoaId);
      if (found) return found;
    }
    return statements.ledgers[0] || null;
  }, [statements.ledgers, selectedLedgerCoaId]);

  const handleSeedDefaults = async () => {
    setSubmitting(true);
    try {
      const existingCodes = new Set(
        accounts.filter((a) => a.year === activeYear).map((a) => a.code)
      );
      const defaultsCoa = buildDefaultPDAMCoa(activeYear, actor.displayName).filter(
        (c) => !existingCodes.has(c.code)
      );
      const defaultsCb = buildDefaultCashBankAccounts(
        activeYear,
        actor.displayName,
        actor.unitId || '',
        actor.unitName || 'Bidang Umum dan Keuangan'
      );

      const batch = writeBatch(db);
      defaultsCoa.forEach((c) => {
        batch.set(doc(db, 'fin_accounts', c.id), sanitizeFirestoreRecord(c));
      });
      defaultsCb.forEach((cb) => {
        batch.set(doc(db, 'fin_cash_banks', cb.id), sanitizeFirestoreRecord(cb), {
          merge: true,
        });
      });
      await batch.commit();

      await onLogAudit({
        actionType: 'SEED',
        entityType: 'COA & Kas/Bank Standar PDAM',
        entityId: `seed-${activeYear}`,
        entityLabel: `Standar PDAM TA ${activeYear}`,
        summary: `Inisialisasi ${defaultsCoa.length} akun COA & rekening Kas/Bank standar PDAM untuk TA ${activeYear}`,
        year: activeYear,
      });

      setFeedback({
        type: 'success',
        message: `${defaultsCoa.length} akun COA baru & rekening Kas/Bank standar PDAM TA ${activeYear} berhasil diinisialisasi.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal inisialisasi COA: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveCoa = async () => {
    if (!coaCode.trim() || !coaName.trim()) {
      setFeedback({ type: 'error', message: 'Kode dan nama akun COA wajib diisi.' });
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id =
        editingCoa?.id || `coa-${activeYear}-${coaCode.trim().replace(/[^a-zA-Z0-9]/g, '')}`;
      const record: FinanceAccount = sanitizeFirestoreRecord({
        id,
        code: coaCode.trim(),
        name: coaName.trim(),
        type: coaType,
        subCategory: coaSubCategory.trim(),
        normalBalance: coaNormal,
        cashFlowGroup: coaCfGroup,
        openingBalance: Number(coaOpening) || 0,
        year: editingCoa?.year || activeYear,
        isActive: true,
        createdBy: editingCoa?.createdBy || actor.displayName,
        createdAt: editingCoa?.createdAt || now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_accounts', id), record);
      await onLogAudit({
        actionType: editingCoa ? 'UPDATE' : 'CREATE',
        entityType: 'Chart of Accounts (COA)',
        entityId: id,
        entityLabel: `${record.code} - ${record.name}`,
        summary: `${editingCoa ? 'Memperbarui' : 'Menambahkan'} akun COA ${record.code} (${record.name})`,
        beforeData: editingCoa ? (editingCoa as unknown as Record<string, unknown>) : null,
        afterData: record as unknown as Record<string, unknown>,
        year: record.year,
      });
      setIsCoaModalOpen(false);
      setFeedback({ type: 'success', message: `Akun ${record.code} berhasil disimpan.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan akun: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const totalJrnDebit = jrnLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalJrnCredit = jrnLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const isJrnBalanced = totalJrnDebit > 0 && Math.abs(totalJrnDebit - totalJrnCredit) < 1;

  const handleSaveJournal = async () => {
    if (!jrnDesc.trim() || !isJrnBalanced) {
      setFeedback({
        type: 'error',
        message: 'Uraian wajib diisi dan total Debit harus sama dengan total Kredit (> 0).',
      });
      return;
    }
    const year = parseInt(jrnDate.slice(0, 4), 10) || activeYear;
    const month = getMonthNameFromDate(jrnDate);
    if (isPeriodLocked(periodCloses, year, month)) {
      setFeedback({ type: 'error', message: `Periode ${month} ${year} telah ditutup buku.` });
      return;
    }

    const validLines = jrnLines
      .filter((l) => l.coaId && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0))
      .map((l) => {
        const coa = sortedAccounts.find((a) => a.id === l.coaId);
        return {
          coaId: l.coaId,
          coaCode: coa?.code || l.coaCode,
          coaName: coa?.name || l.coaName,
          description: l.description || jrnDesc.trim(),
          debit: Math.round(Number(l.debit) || 0),
          credit: Math.round(Number(l.credit) || 0),
        };
      });

    if (validLines.length < 2) {
      setFeedback({ type: 'error', message: 'Jurnal minimal memiliki 2 baris akun (Debit & Kredit).' });
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = `jrn-man-${Date.now()}`;
      const record: FinanceJournal = sanitizeFirestoreRecord({
        id,
        journalNumber: jrnNumber.trim() || `JRN-${year}-${Date.now().toString().slice(-4)}`,
        journalType: jrnType,
        journalDate: jrnDate,
        year,
        month,
        description: jrnDesc.trim(),
        lines: validLines,
        totalDebit: totalJrnDebit,
        totalCredit: totalJrnCredit,
        status: 'Posted',
        createdBy: actor.displayName,
        createdByUid: actor.uid,
        createdAt: now,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_journals', id), record);
      await onLogAudit({
        actionType: 'POST',
        entityType: `Jurnal ${record.journalType}`,
        entityId: id,
        entityLabel: record.journalNumber,
        summary: `Posting jurnal ${record.journalNumber} (${record.journalType}) sebesar ${formatRp(record.totalDebit)}`,
        afterData: record as unknown as Record<string, unknown>,
        year,
      });
      setIsJournalModalOpen(false);
      setFeedback({ type: 'success', message: `Jurnal ${record.journalNumber} berhasil diposting.` });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal menyimpan jurnal: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTogglePeriodClose = async (month: string, currentlyClosed: boolean) => {
    if (!permissions.canClosePeriod) return;
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const id = `close-${activeYear}-${month}`;
      const record: FinancePeriodClose = sanitizeFirestoreRecord({
        id,
        year: activeYear,
        month,
        isClosed: !currentlyClosed,
        closedBy: !currentlyClosed ? actor.displayName : undefined,
        closedAt: !currentlyClosed ? now : undefined,
        reopenedBy: currentlyClosed ? actor.displayName : undefined,
        reopenedAt: currentlyClosed ? now : undefined,
        updatedAt: now,
      });

      await setDoc(doc(db, 'fin_period_closes', id), record);
      await onLogAudit({
        actionType: !currentlyClosed ? 'CLOSE_PERIOD' : 'REOPEN_PERIOD',
        entityType: 'Tutup Buku Periode',
        entityId: id,
        entityLabel: `${month} ${activeYear}`,
        summary: `${!currentlyClosed ? 'Menutup buku' : 'Membuka kembali'} periode ${month} ${activeYear}`,
        afterData: record as unknown as Record<string, unknown>,
        year: activeYear,
      });
      setFeedback({
        type: 'success',
        message: `Periode ${month} ${activeYear} ${!currentlyClosed ? 'ditutup' : 'dibuka kembali'}.`,
      });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: `Gagal memperbarui status tutup buku: ${err instanceof Error ? err.message : 'Error'}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} className="underline cursor-pointer">
            Tutup
          </button>
        </div>
      )}

      {/* Sub-Tabs & Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'COA', label: 'Chart of Accounts (COA)' },
            { id: 'JURNAL', label: 'Jurnal (Umum/Kas/Penyesuaian)' },
            { id: 'BUKU_BESAR', label: 'Buku Besar' },
            { id: 'NERACA_SALDO', label: 'Neraca Saldo' },
            { id: 'TUTUP_BUKU', label: 'Tutup Buku Periode' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubView(tab.id as AccountingView)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                subView === tab.id
                  ? 'bg-emerald-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {permissions.canOperate && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSeedDefaults}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Inisialisasi COA Standar PDAM ({activeYear})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setJrnNumber(`JRN-${activeYear}-${String(journals.length + 1).padStart(4, '0')}`);
                setJrnType('UMUM');
                setJrnDate(getTodayIso());
                setJrnDesc('');
                setJrnLines([
                  { coaId: sortedAccounts[0]?.id || '', coaCode: '', coaName: '', description: '', debit: 0, credit: 0 },
                  { coaId: sortedAccounts[1]?.id || '', coaCode: '', coaName: '', description: '', debit: 0, credit: 0 },
                ]);
                setIsJournalModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Buat Jurnal Manual</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setEditingCoa(null);
                setCoaCode('');
                setCoaName('');
                setCoaType('Beban');
                setCoaSubCategory('Beban Administrasi & Umum');
                setCoaNormal('Debit');
                setCoaCfGroup('Operasional');
                setCoaOpening('0');
                setIsCoaModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Akun COA</span>
            </button>
          </div>
        )}
      </div>

      {/* COA View */}
      {subView === 'COA' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Kode Akun</th>
                  <th className="py-2.5 px-3">Nama Akun</th>
                  <th className="py-2.5 px-3">Klasifikasi</th>
                  <th className="py-2.5 px-3">Saldo Normal</th>
                  <th className="py-2.5 px-3">Arus Kas</th>
                  <th className="py-2.5 px-3 text-right">Saldo Awal</th>
                  <th className="py-2.5 px-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      Belum ada Chart of Accounts. Klik "Inisialisasi COA Standar PDAM" untuk memuat akun baku BUMD Air Minum.
                    </td>
                  </tr>
                ) : (
                  sortedAccounts.map((acc) => (
                    <tr key={acc.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-800">{acc.code}</td>
                      <td className="py-2.5 px-3 font-medium text-slate-900">{acc.name}</td>
                      <td className="py-2.5 px-3 text-slate-600">
                        <span className="font-semibold">{acc.type}</span> · {acc.subCategory}
                      </td>
                      <td className="py-2.5 px-3">{acc.normalBalance}</td>
                      <td className="py-2.5 px-3 text-slate-600">{acc.cashFlowGroup}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {formatRp(acc.openingBalance)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {permissions.canOperate && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCoa(acc);
                              setCoaCode(acc.code);
                              setCoaName(acc.name);
                              setCoaType(acc.type);
                              setCoaSubCategory(acc.subCategory);
                              setCoaNormal(acc.normalBalance);
                              setCoaCfGroup(acc.cashFlowGroup);
                              setCoaOpening(String(acc.openingBalance));
                              setIsCoaModalOpen(true);
                            }}
                            className="p-1.5 text-slate-500 hover:text-emerald-800 rounded cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Jurnal View */}
      {subView === 'JURNAL' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {['ALL', 'UMUM', 'PENERIMAAN', 'PENGELUARAN', 'PENYESUAIAN'].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setJournalTypeFilter(t)}
                className={`px-3 py-1 text-xs font-semibold rounded-lg border cursor-pointer ${
                  journalTypeFilter === t
                    ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {t === 'ALL' ? 'Semua Jurnal' : `Jurnal ${t}`}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredJournals.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500">
                Belum ada entri jurnal pada filter terpilih.
              </div>
            ) : (
              filteredJournals.map((j) => (
                <div key={j.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-slate-900">{j.journalNumber}</span>
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-white border border-slate-200 rounded text-slate-700">
                        {j.journalType}
                      </span>
                      <span className="text-slate-500">{formatDateShort(j.journalDate)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">{j.description}</span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-bold rounded border ${
                          j.status === 'Posted'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}
                      >
                        {j.status}
                      </span>
                    </div>
                  </div>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] text-slate-500">
                        <th className="py-1.5 px-4">Akun COA</th>
                        <th className="py-1.5 px-4">Keterangan Baris</th>
                        <th className="py-1.5 px-4 text-right">Debit</th>
                        <th className="py-1.5 px-4 text-right">Kredit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {j.lines.map((line, idx) => (
                        <tr key={idx}>
                          <td className="py-2 px-4 font-mono text-slate-800">
                            {line.coaCode} · {line.coaName}
                          </td>
                          <td className="py-2 px-4 text-slate-600">{line.description || '-'}</td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums">
                            {line.debit > 0 ? formatRp(line.debit) : '-'}
                          </td>
                          <td className="py-2 px-4 text-right font-mono tabular-nums">
                            {line.credit > 0 ? formatRp(line.credit) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Buku Besar View */}
      {subView === 'BUKU_BESAR' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-900">Pilih Akun Buku Besar:</span>
              <select
                value={selectedLedger?.account.id || ''}
                onChange={(e) => setSelectedLedgerCoaId(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium"
              >
                {statements.ledgers.map((l) => (
                  <option key={l.account.id} value={l.account.id}>
                    {l.account.code} - {l.account.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedLedger && (
              <div className="font-mono text-xs">
                Saldo Akhir:{' '}
                <strong className="text-emerald-800">{formatRp(selectedLedger.netSignedBalance)}</strong>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Tanggal</th>
                  <th className="py-2.5 px-3">Nomor Jurnal</th>
                  <th className="py-2.5 px-3">Keterangan</th>
                  <th className="py-2.5 px-3 text-right">Debit</th>
                  <th className="py-2.5 px-3 text-right">Kredit</th>
                  <th className="py-2.5 px-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!selectedLedger ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      Pilih akun COA terlebih dahulu.
                    </td>
                  </tr>
                ) : (
                  <>
                    <tr className="bg-slate-50/60 font-semibold">
                      <td className="py-2 px-3">-</td>
                      <td className="py-2 px-3">SALDO AWAL</td>
                      <td className="py-2 px-3">Saldo awal tahun buku {selectedLedger.account.year}</td>
                      <td className="py-2 px-3 text-right font-mono">
                        {selectedLedger.openingDebit > 0 ? formatRp(selectedLedger.openingDebit) : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {selectedLedger.openingCredit > 0 ? formatRp(selectedLedger.openingCredit) : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">
                        {formatRp(selectedLedger.account.openingBalance)}
                      </td>
                    </tr>
                    {selectedLedger.movements.map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-mono">{formatDateShort(m.journalDate)}</td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-800">{m.journalNumber}</td>
                        <td className="py-2 px-3">{m.description}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {m.debit > 0 ? formatRp(m.debit) : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums">
                          {m.credit > 0 ? formatRp(m.credit) : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums font-bold">
                          {formatRp(m.runningBalance)}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Neraca Saldo View */}
      {subView === 'NERACA_SALDO' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-3">Kode</th>
                  <th className="py-2.5 px-3">Nama Akun</th>
                  <th className="py-2.5 px-3 text-right">Mutasi Debit</th>
                  <th className="py-2.5 px-3 text-right">Mutasi Kredit</th>
                  <th className="py-2.5 px-3 text-right">Saldo Akhir Debit</th>
                  <th className="py-2.5 px-3 text-right">Saldo Akhir Kredit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.ledgers.map((l) => (
                  <tr key={l.account.id} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3 font-mono font-bold text-emerald-800">{l.account.code}</td>
                    <td className="py-2 px-3 font-medium text-slate-900">{l.account.name}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      {formatRp(l.periodDebit)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">
                      {formatRp(l.periodCredit)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                      {l.endingDebit > 0 ? formatRp(l.endingDebit) : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                      {l.endingCredit > 0 ? formatRp(l.endingCredit) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
                  <td colSpan={2} className="py-2.5 px-3">
                    TOTAL NERACA SALDO
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {formatRp(statements.trialBalanceTotals.periodDebit)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {formatRp(statements.trialBalanceTotals.periodCredit)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-800">
                    {formatRp(statements.trialBalanceTotals.endingDebit)}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-800">
                    {formatRp(statements.trialBalanceTotals.endingCredit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Tutup Buku View */}
      {subView === 'TUTUP_BUKU' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[...FISCAL_MONTHS, 'TAHUNAN'].map((monthName) => {
            const closeRec = periodCloses.find(
              (p) => p.year === activeYear && p.month.toLowerCase() === monthName.toLowerCase()
            );
            const closed = Boolean(closeRec?.isClosed);
            return (
              <div
                key={monthName}
                className={`p-4 rounded-xl border flex flex-col justify-between gap-3 ${
                  closed ? 'bg-slate-50 border-slate-300' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {monthName === 'TAHUNAN' ? `Tutup Buku Tahunan ${activeYear}` : `${monthName} ${activeYear}`}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {closed ? `Ditutup oleh ${closeRec?.closedBy || '-'}` : 'Periode terbuka (dapat posting)'}
                    </p>
                  </div>
                  {closed ? (
                    <Lock className="w-4 h-4 text-rose-600" />
                  ) : (
                    <Unlock className="w-4 h-4 text-emerald-600" />
                  )}
                </div>

                {permissions.canClosePeriod && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleTogglePeriodClose(monthName, closed)}
                    className={`w-full py-1.5 text-xs font-bold rounded-lg border cursor-pointer ${
                      closed
                        ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                        : 'bg-emerald-700 text-white border-emerald-700 hover:bg-emerald-800'
                    }`}
                  >
                    {closed ? 'Buka Kembali Periode' : 'Tutup Buku Periode'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* COA Modal */}
      {isCoaModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg p-5 space-y-3.5 text-xs shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {editingCoa ? 'Edit Akun COA' : 'Tambah Akun Chart of Accounts'}
              </h3>
              <button type="button" onClick={() => setIsCoaModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Kode Akun *</label>
                <input
                  type="text"
                  value={coaCode}
                  onChange={(e) => setCoaCode(e.target.value)}
                  placeholder="Contoh: 5-2105"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Tipe Akun *</label>
                <select
                  value={coaType}
                  onChange={(e) => {
                    const t = e.target.value as FinanceAccountType;
                    setCoaType(t);
                    setCoaNormal(t === 'Aset' || t === 'Beban' ? 'Debit' : 'Kredit');
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="Aset">Aset</option>
                  <option value="Kewajiban">Kewajiban</option>
                  <option value="Ekuitas">Ekuitas</option>
                  <option value="Pendapatan">Pendapatan</option>
                  <option value="Beban">Beban</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Nama Akun *</label>
              <input
                type="text"
                value={coaName}
                onChange={(e) => setCoaName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Sub-Kategori Laporan</label>
                <input
                  type="text"
                  value={coaSubCategory}
                  onChange={(e) => setCoaSubCategory(e.target.value)}
                  placeholder="Contoh: Aset Lancar / Beban Operasi Langsung"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Kelompok Arus Kas</label>
                <select
                  value={coaCfGroup}
                  onChange={(e) => setCoaCfGroup(e.target.value as FinanceCashFlowGroup)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="Operasional">Operasional</option>
                  <option value="Investasi">Investasi</option>
                  <option value="Pendanaan">Pendanaan</option>
                  <option value="Kas">Kas & Setara Kas</option>
                  <option value="Non-Kas">Non-Kas</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Saldo Normal</label>
                <select
                  value={coaNormal}
                  onChange={(e) => setCoaNormal(e.target.value as 'Debit' | 'Kredit')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="Debit">Debit</option>
                  <option value="Kredit">Kredit</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Saldo Awal TA {activeYear} (Rp)</label>
                <input
                  type="number"
                  value={coaOpening}
                  onChange={(e) => setCoaOpening(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsCoaModalOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSaveCoa}
                className="px-4 py-2 bg-emerald-700 text-white rounded-lg font-bold cursor-pointer"
              >
                Simpan Akun
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Journal Modal */}
      {isJournalModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden text-xs shadow-xl">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-sm font-bold text-slate-900">Buat Entri Jurnal Akuntansi</h3>
              <button type="button" onClick={() => setIsJournalModalOpen(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Nomor Jurnal *</label>
                  <input
                    type="text"
                    value={jrnNumber}
                    onChange={(e) => setJrnNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Jenis Jurnal *</label>
                  <select
                    value={jrnType}
                    onChange={(e) => setJrnType(e.target.value as FinanceJournalType)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="UMUM">Jurnal Umum</option>
                    <option value="PENERIMAAN">Jurnal Penerimaan</option>
                    <option value="PENGELUARAN">Jurnal Pengeluaran</option>
                    <option value="PENYESUAIAN">Jurnal Penyesuaian</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Tanggal Jurnal *</label>
                  <input
                    type="date"
                    value={jrnDate}
                    onChange={(e) => setJrnDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Uraian Jurnal *</label>
                <input
                  type="text"
                  value={jrnDesc}
                  onChange={(e) => setJrnDesc(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                      <th className="py-2 px-3">Akun COA</th>
                      <th className="py-2 px-3">Keterangan</th>
                      <th className="py-2 px-3 text-right">Debit (Rp)</th>
                      <th className="py-2 px-3 text-right">Kredit (Rp)</th>
                      <th className="py-2 px-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {jrnLines.map((line, idx) => (
                      <tr key={idx}>
                        <td className="p-2">
                          <select
                            value={line.coaId}
                            onChange={(e) => {
                              const next = [...jrnLines];
                              next[idx] = { ...next[idx], coaId: e.target.value };
                              setJrnLines(next);
                            }}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded"
                          >
                            <option value="">-- Pilih COA --</option>
                            {sortedAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} - {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={line.description || ''}
                            onChange={(e) => {
                              const next = [...jrnLines];
                              next[idx] = { ...next[idx], description: e.target.value };
                              setJrnLines(next);
                            }}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={line.debit}
                            onChange={(e) => {
                              const next = [...jrnLines];
                              next[idx] = { ...next[idx], debit: Number(e.target.value) || 0 };
                              setJrnLines(next);
                            }}
                            className="w-28 text-right px-2 py-1.5 border border-slate-300 rounded font-mono"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            value={line.credit}
                            onChange={(e) => {
                              const next = [...jrnLines];
                              next[idx] = { ...next[idx], credit: Number(e.target.value) || 0 };
                              setJrnLines(next);
                            }}
                            className="w-28 text-right px-2 py-1.5 border border-slate-300 rounded font-mono"
                          />
                        </td>
                        <td className="p-2 text-center">
                          {jrnLines.length > 2 && (
                            <button
                              type="button"
                              onClick={() => setJrnLines(jrnLines.filter((_, i) => i !== idx))}
                              className="text-rose-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setJrnLines([
                        ...jrnLines,
                        { coaId: '', coaCode: '', coaName: '', description: '', debit: 0, credit: 0 },
                      ])
                    }
                    className="text-emerald-800 font-bold hover:underline cursor-pointer"
                  >
                    + Tambah Baris
                  </button>
                  <div className="flex items-center gap-4 font-mono">
                    <span>Debit: <strong>{formatRp(totalJrnDebit)}</strong></span>
                    <span>Kredit: <strong>{formatRp(totalJrnCredit)}</strong></span>
                    <span
                      className={`inline-flex items-center gap-1 font-bold ${
                        isJrnBalanced ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {isJrnBalanced ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Seimbang
                        </>
                      ) : (
                        'Tidak Seimbang'
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsJournalModalOpen(false)}
                className="px-3.5 py-2 border border-slate-300 rounded-lg font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submitting || !isJrnBalanced}
                onClick={handleSaveJournal}
                className="px-4 py-2 bg-emerald-700 disabled:bg-slate-300 text-white rounded-lg font-bold cursor-pointer"
              >
                Posting Jurnal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
