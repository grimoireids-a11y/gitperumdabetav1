import React, { useMemo, useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  History,
} from 'lucide-react';
import { FinanceAuditTrail, FinanceGlobalFilter, FinanceTransaction } from '../../types/finance';
import { formatDateShort, formatRp } from '../../lib/financeEngine';

interface FinanceAuditTrailTabProps {
  filter: FinanceGlobalFilter;
  auditTrails: FinanceAuditTrail[];
  transactions: FinanceTransaction[];
}

export const FinanceAuditTrailTab: React.FC<FinanceAuditTrailTabProps> = ({
  filter,
  auditTrails,
  transactions,
}) => {
  const [subView, setSubView] = useState<'ALL_LOGS' | 'DUPLICATES'>('ALL_LOGS');
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    return auditTrails
      .filter((a) => {
        if (filter.year !== 0 && a.year && a.year !== filter.year) return false;
        if (actionFilter !== 'ALL' && a.actionType !== actionFilter) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.trim().toLowerCase();
          const match =
            a.entityLabel.toLowerCase().includes(q) ||
            a.summary.toLowerCase().includes(q) ||
            a.actorName.toLowerCase().includes(q) ||
            a.entityType.toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [auditTrails, filter.year, actionFilter, searchTerm]);

  // Live Duplicate Scanner across active transactions
  const duplicateGroups = useMemo(() => {
    const map = new Map<string, FinanceTransaction[]>();
    transactions
      .filter((t) => t.status !== 'Dibatalkan' && t.status !== 'Ditolak')
      .forEach((t) => {
        const list = map.get(t.duplicateKey) || [];
        list.push(t);
        map.set(t.duplicateKey, list);
      });

    const voucherMap = new Map<string, FinanceTransaction[]>();
    transactions
      .filter((t) => t.status !== 'Dibatalkan' && t.status !== 'Ditolak')
      .forEach((t) => {
        const key = t.voucherNumber.trim().toUpperCase();
        const list = voucherMap.get(key) || [];
        list.push(t);
        voucherMap.set(key, list);
      });

    const groups: { reason: string; items: FinanceTransaction[] }[] = [];
    map.forEach((items) => {
      if (items.length > 1) {
        groups.push({
          reason: `Kombinasi identik (Jenis, Tanggal ${formatDateShort(items[0].transactionDate)}, Nominal ${formatRp(items[0].amount)}, Pihak "${items[0].counterpartyName}")`,
          items,
        });
      }
    });
    voucherMap.forEach((items, voucher) => {
      if (items.length > 1) {
        groups.push({
          reason: `Nomor bukti kas duplikat: ${voucher}`,
          items,
        });
      }
    });
    return groups;
  }, [transactions]);

  const overrideFlags = useMemo(
    () => auditTrails.filter((a) => a.duplicateFlag),
    [auditTrails]
  );

  return (
    <div className="space-y-4">
      {/* Sub-view Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubView('ALL_LOGS')}
            className={`px-3.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer ${
              subView === 'ALL_LOGS'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Riwayat Transaksi, Perubahan & Persetujuan ({filteredLogs.length})
          </button>
          <button
            type="button"
            onClick={() => setSubView('DUPLICATES')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg cursor-pointer ${
              subView === 'DUPLICATES'
                ? 'bg-emerald-700 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Deteksi Transaksi Ganda ({duplicateGroups.length + overrideFlags.length})</span>
          </button>
        </div>

        {subView === 'ALL_LOGS' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari pengguna, bukti, uraian..."
                className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
              />
            </div>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg"
            >
              <option value="ALL">Semua Aksi</option>
              <option value="CREATE">CREATE</option>
              <option value="UPDATE">UPDATE</option>
              <option value="APPROVE">APPROVE</option>
              <option value="REJECT">REJECT</option>
              <option value="CANCEL">CANCEL</option>
              <option value="POST">POST</option>
              <option value="CLOSE_PERIOD">CLOSE_PERIOD</option>
              <option value="DUPLICATE_OVERRIDE">DUPLICATE_OVERRIDE</option>
            </select>
          </div>
        )}
      </div>

      {subView === 'ALL_LOGS' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="divide-y divide-slate-100">
            {filteredLogs.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                Belum ada log audit trail keuangan pada filter terpilih.
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isExpanded = expandedId === log.id;
                const hasDiff = Boolean(log.beforeData || log.afterData);
                return (
                  <div key={log.id} className="p-3.5 text-xs hover:bg-slate-50/70">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 text-[10px] font-bold font-mono rounded border bg-slate-100 text-slate-800 border-slate-200">
                            {log.actionType}
                          </span>
                          <span className="font-bold text-slate-900">{log.entityType}</span>
                          <span className="font-mono text-emerald-800 font-bold">
                            {log.entityLabel}
                          </span>
                          {log.duplicateFlag && (
                            <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300 rounded">
                              Indikasi Duplikat
                            </span>
                          )}
                        </div>
                        <p className="text-slate-700">{log.summary}</p>
                        {log.approvalNotes && (
                          <p className="text-[11px] text-slate-500">
                            Catatan Persetujuan: <span className="italic">{log.approvalNotes}</span>
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0 space-y-1">
                        <div className="font-semibold text-slate-800">
                          {log.actorName}{' '}
                          <span className="text-[11px] text-slate-500 font-normal">({log.actorRole})</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 flex items-center justify-end gap-1">
                          <History className="w-3 h-3" />
                          <span>{new Date(log.timestamp).toLocaleString('id-ID')}</span>
                        </div>
                        {hasDiff && (
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : log.id)}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 hover:underline cursor-pointer"
                          >
                            <span>Data Sebelum / Sesudah</span>
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && hasDiff && (
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                          <p className="text-[11px] font-bold text-slate-600 mb-1">
                            Data Sebelum Perubahan
                          </p>
                          <pre className="text-[10px] font-mono text-slate-700 overflow-x-auto max-h-48">
                            {log.beforeData ? JSON.stringify(log.beforeData, null, 2) : '(Data Baru)'}
                          </pre>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                          <p className="text-[11px] font-bold text-emerald-800 mb-1">
                            Data Sesudah Perubahan
                          </p>
                          <pre className="text-[10px] font-mono text-slate-700 overflow-x-auto max-h-48">
                            {log.afterData ? JSON.stringify(log.afterData, null, 2) : '(Dihapus / Nihil)'}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {duplicateGroups.length === 0 && overrideFlags.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-600 flex flex-col items-center gap-2">
              <ShieldCheck className="w-8 h-8 text-emerald-600" />
              <p className="font-bold text-slate-900">Tidak Ada Transaksi Ganda Terdeteksi</p>
              <p className="text-slate-500">
                Seluruh nomor bukti kas, kombinasi tanggal/nominal/pihak, dan riwayat persetujuan bersih dari duplikasi.
              </p>
            </div>
          ) : (
            <>
              {duplicateGroups.map((grp, idx) => (
                <div key={idx} className="bg-white border border-amber-300 rounded-xl p-4 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-950">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    <span>{grp.reason}</span>
                  </div>
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {grp.items.map((tx) => (
                      <div key={tx.id} className="p-2.5 flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-slate-900">{tx.voucherNumber}</span>{' '}
                          · {tx.description} ({tx.counterpartyName})
                        </div>
                        <div className="font-mono font-bold text-slate-900">
                          {formatRp(tx.amount)} · {tx.status}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {overrideFlags.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                  <h4 className="font-bold text-slate-900">
                    Transaksi yang Disimpan dengan Konfirmasi Peringatan Duplikat ({overrideFlags.length})
                  </h4>
                  <div className="divide-y divide-slate-100">
                    {overrideFlags.map((o) => (
                      <div key={o.id} className="py-2 flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold">{o.entityLabel}</span> — {o.summary}
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {o.actorName} · {new Date(o.timestamp).toLocaleDateString('id-ID')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
