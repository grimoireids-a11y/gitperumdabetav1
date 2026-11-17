import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { WBSEvidenceAttachment } from '../types/audit';

export const WBS_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB exact
export const WBS_MAX_FILE_SIZE_LABEL = '2 MB';
const INLINE_THRESHOLD_CHARS = 350_000;
const CHUNK_CHAR_SIZE = 450_000;

export const WBS_ALLOWED_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
];

export const WBS_VIOLATION_CATEGORIES = [
  'Korupsi, Suap & Gratifikasi',
  'Penggelapan Kas / Aset',
  'Rekayasa Penagihan & Meter Air',
  'Penyalahgunaan Wewenang & Nepotisme',
  'Kecurangan Pengadaan Barang/Jasa',
  'Pelanggaran SOP & Kode Etik',
  'Lainnya',
] as const;

export function generateWbsTicketNumber(year: number): string {
  const randomDigits = Math.floor(100000 + Math.random() * 900000);
  return `WBS-${year}-${randomDigits}`;
}

export function computeSlaDeadlineIso(baseDate: Date, days = 7): string {
  const d = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Gagal membaca berkas.'));
      }
    };
    reader.onerror = () => reject(new Error('Gagal membaca file lampiran.'));
    reader.readAsDataURL(file);
  });
}

export function validateWbsEvidenceFile(file: File): string | null {
  if (file.size > WBS_MAX_FILE_SIZE_BYTES) {
    return `Ukuran file "${file.name}" (${formatBytes(file.size)}) melebihi batas maksimal ${WBS_MAX_FILE_SIZE_LABEL}.`;
  }
  const lowerName = file.name.toLowerCase();
  const hasAllowedExt = WBS_ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  const isImageMime = file.type.startsWith('image/');
  const isDocMime =
    file.type === 'application/pdf' ||
    file.type.includes('word') ||
    file.type.includes('excel') ||
    file.type.includes('spreadsheetml') ||
    file.type.includes('officedocument');

  if (!hasAllowedExt && !isImageMime && !isDocMime) {
    return `Format file "${file.name}" tidak didukung. Gunakan JPG, PNG, WEBP, PDF, DOC/DOCX, atau XLS/XLSX.`;
  }
  return null;
}

export interface PendingLocalWbsFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'DOCUMENT' | 'PHOTO';
  dataUrl: string;
}

export async function persistWbsFileAttachment(
  reportId: string,
  pending: PendingLocalWbsFile
): Promise<WBSEvidenceAttachment> {
  const nowIso = new Date().toISOString();

  if (pending.dataUrl.length <= INLINE_THRESHOLD_CHARS) {
    return {
      id: pending.id,
      kind: pending.kind,
      fileName: pending.fileName,
      mimeType: pending.mimeType,
      sizeBytes: pending.sizeBytes,
      inlineDataUrl: pending.dataUrl,
      uploadedAt: nowIso,
    };
  }

  // Split large base64 strings (up to ~2.7 MB for 2 MB binary files) into safe <500KB Firestore documents
  const chunks: string[] = [];
  for (let i = 0; i < pending.dataUrl.length; i += CHUNK_CHAR_SIZE) {
    chunks.push(pending.dataUrl.slice(i, i + CHUNK_CHAR_SIZE));
  }

  const chunkIds: string[] = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunkId = `${pending.id}_chunk_${idx}`;
    chunkIds.push(chunkId);
    try {
      await setDoc(doc(db, 'wbs_evidence_chunks', chunkId), {
        id: chunkId,
        reportId,
        attachmentId: pending.id,
        chunkIndex: idx,
        totalChunks: chunks.length,
        data: chunks[idx],
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `wbs_evidence_chunks/${chunkId}`);
    }
  }

  return {
    id: pending.id,
    kind: pending.kind,
    fileName: pending.fileName,
    mimeType: pending.mimeType,
    sizeBytes: pending.sizeBytes,
    chunkIds,
    uploadedAt: nowIso,
  };
}

export async function resolveWbsAttachmentDataUrl(
  attachment: WBSEvidenceAttachment
): Promise<string | null> {
  if (attachment.inlineDataUrl) return attachment.inlineDataUrl;
  if (!attachment.chunkIds || attachment.chunkIds.length === 0) return null;

  const parts: string[] = [];
  for (const chunkId of attachment.chunkIds) {
    try {
      const snap = await getDoc(doc(db, 'wbs_evidence_chunks', chunkId));
      if (!snap.exists()) {
        throw new Error(`Potongan lampiran (${chunkId}) tidak ditemukan.`);
      }
      const data = snap.data() as { data?: string };
      parts.push(data.data || '');
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `wbs_evidence_chunks/${chunkId}`);
    }
  }
  return parts.join('');
}
