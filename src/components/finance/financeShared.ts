import { UserRole } from '../../types/audit';
import {
  FinanceAttachment,
  FinanceAuditActionType,
  FinanceTransactionStatus,
} from '../../types/finance';

export interface FinancePermissions {
  canOperate: boolean; // BIDANG_KEUANGAN, KEPALA_SPI, ADMIN_SISTEM
  canApprove: boolean; // BIDANG_KEUANGAN, DIREKTUR, KEPALA_SPI, ADMIN_SISTEM
  canClosePeriod: boolean; // BIDANG_KEUANGAN, DIREKTUR, KEPALA_SPI, ADMIN_SISTEM
  canAudit: boolean; // KEPALA_SPI, AUDITOR, ADMIN_SISTEM, DEWAN_PENGAWAS
  isSuperUser: boolean; // KEPALA_SPI, ADMIN_SISTEM (Full Edit & Delete across Finance)
  isReadOnly: boolean;
}

export interface LogFinanceAuditInput {
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

export type LogFinanceAuditFn = (input: LogFinanceAuditInput) => Promise<void>;

export interface FinanceActor {
  uid: string;
  displayName: string;
  role: UserRole;
  unitId?: string;
  unitName?: string;
}

export const getTxStatusStyle = (status: FinanceTransactionStatus): string => {
  switch (status) {
    case 'Disetujui / Diposting':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'Menunggu Persetujuan':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'Ditolak':
    case 'Dibatalkan':
      return 'bg-rose-50 text-rose-800 border-rose-200';
    case 'Draft':
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

export const readAttachmentAsInlineData = (
  file: File
): Promise<{ attachment?: FinanceAttachment; error?: string }> => {
  return new Promise((resolve) => {
    const maxBytes = 350 * 1024; // 350 KB limit for safe Firestore document storage
    if (file.size > maxBytes) {
      resolve({
        error: `Ukuran file "${file.name}" (${Math.round(file.size / 1024)} KB) melebihi batas penyimpanan langsung 350 KB. Gunakan tautan URL Google Drive / arsip kantor.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        resolve({ error: 'Gagal membaca isi file lampiran.' });
        return;
      }
      resolve({
        attachment: {
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fileName: file.name,
          inlineDataUrl: result,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          uploadedAt: new Date().toISOString(),
        },
      });
    };
    reader.onerror = () => resolve({ error: 'Gagal memproses file lampiran.' });
    reader.readAsDataURL(file);
  });
};
