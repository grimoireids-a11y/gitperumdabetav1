import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface FinanceDeleteConfirmModalProps {
  isOpen: boolean;
  title: string;
  itemLabel: string;
  description?: string;
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const FinanceDeleteConfirmModal: React.FC<FinanceDeleteConfirmModalProps> = ({
  isOpen,
  title,
  itemLabel,
  description,
  submitting = false,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-md p-5 space-y-4 text-xs shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-700 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">{title}</h3>
              <p className="text-[11px] text-slate-500">Hak Akses Super User · Tercatat di Audit Trail</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl space-y-1.5">
          <p className="text-slate-700">
            Anda akan menghapus permanen data:{' '}
            <span className="font-mono font-bold text-rose-900">{itemLabel}</span>
          </p>
          {description && <p className="text-[11px] text-rose-800">{description}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="px-3.5 py-2 font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 px-4 py-2 font-bold text-white bg-rose-700 hover:bg-rose-800 disabled:bg-rose-400 rounded-lg cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{submitting ? 'Menghapus...' : 'Ya, Hapus Permanen'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
