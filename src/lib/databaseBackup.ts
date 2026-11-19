import {
  collection,
  doc,
  getDocs,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

export interface BackupCollectionMeta {
  key: string;
  label: string;
  description: string;
}

export const BACKUP_COLLECTIONS: BackupCollectionMeta[] = [
  {
    key: 'users',
    label: 'Pengguna & Akun RBAC',
    description: 'Daftar akun, peran pengguna, status persetujuan, dan unit kerja',
  },
  {
    key: 'units',
    label: 'Master Unit & Pemilik Risiko',
    description: 'Unit kerja, bidang operasional, kepala unit, dan wilayah pelayanan',
  },
  {
    key: 'risk_registers',
    label: 'Register Risiko Korporat (5x5)',
    description: 'Identifikasi risiko, analisis akar masalah, skor inheren/residual & mitigasi',
  },
  {
    key: 'risk_profiles',
    label: 'Profil Risiko Korporat & Selera Risiko',
    description: 'Penetapan selera risiko, batas toleransi, dan evaluasi profil risiko Kepala SPI',
  },
  {
    key: 'risk_annual_reports',
    label: 'Laporan Tahunan Manajemen Risiko',
    description: 'Naskah laporan tahunan manajemen risiko 7 bab beserta pengesahan Kepala SPI',
  },
  {
    key: 'rcsa_assessments',
    label: 'Penilaian Risiko & Kontrol (RCSA)',
    description: 'Lembar penilaian mandiri unit kerja dan reviu efektivitas kontrol SPI',
  },
  {
    key: 'bpkp_assessments',
    label: 'Self Assessment SPIP Terpadu',
    description: 'Indikator kinerja BUMD & maturitas 5 unsur SPIP lintas tahun',
  },
  {
    key: 'rka_items',
    label: 'Input RKA Manual',
    description: 'Data Rencana Kerja & Anggaran, pagu, realisasi, dan prioritas strategis',
  },
  {
    key: 'rka_categories',
    label: 'Bidang / Kategori Program RKA',
    description: 'Daftar bidang atau kategori program RKA yang diinput manual Super User',
  },
  {
    key: 'audit_universe',
    label: 'Audit Universe (Semesta Audit)',
    description: 'Inventaris objek audit, faktor risiko GIAS/BPKP, siklus audit, dan dasar PKPT',
  },
  {
    key: 'pkpt',
    label: 'Penyusunan PKPT',
    description: 'Program Kerja Pengawasan Tahunan beserta skor prioritas risiko + RKA',
  },
  {
    key: 'spi_programs',
    label: 'Program Tahunan Kapabilitas SPI',
    description: 'Program kerja non-audit untuk penguatan kapabilitas internal SPI',
  },
  {
    key: 'audit_assignments',
    label: 'Surat Perintah Tugas (SPT)',
    description: 'Penugasan tim pemeriksa, dasar audit, ruang lingkup, dan jadwal',
  },
  {
    key: 'audit_programs',
    label: 'Program Kerja Audit (PKA)',
    description: 'Langkah kerja pemeriksaan, metode uji, sampel, dan pelaksana',
  },
  {
    key: 'work_papers',
    label: 'Kertas Kerja Audit (KKA)',
    description: 'Dokumentasi pengujian substantif, bukti, dan hasil reviu berjenjang',
  },
  {
    key: 'audit_reports',
    label: 'Laporan Hasil Audit (LHA)',
    description: 'Naskah LHA, ringkasan eksekutif, kesimpulan, dan status pengesahan',
  },
  {
    key: 'spi_periodic_reports',
    label: 'Laporan SPI Bulanan & Tahunan',
    description: 'Laporan berkala bulanan dan tahunan pelaksanaan pengawasan SPI',
  },
  {
    key: 'findings',
    label: 'Temuan Audit (5C)',
    description: 'Matriks temuan Condition, Criteria, Cause, Consequence & potensi kerugian',
  },
  {
    key: 'recommendations',
    label: 'Rekomendasi Audit',
    description: 'Daftar rekomendasi perbaikan, PIC unit kerja, target, dan status',
  },
  {
    key: 'follow_ups',
    label: 'Tindak Lanjut Rekomendasi',
    description: 'Laporan progres aksi unit kerja, tautan link bukti, dan verifikasi SPI',
  },
  {
    key: 'investigations',
    label: 'Audit Investigatif & Fraud',
    description: 'Catatan kasus rahasia, kronologi, modus, dan progres penelaahan',
  },
  {
    key: 'wbs_reports',
    label: 'WBS: Register Pengaduan',
    description: 'Laporan whistleblower publik/manual, tiket pelacakan, dan timeline progres',
  },
  {
    key: 'wbs_assignments',
    label: 'WBS: Surat Tugas Penanganan',
    description: 'Surat tugas rahasia penelaahan & audit investigatif pengaduan WBS',
  },
  {
    key: 'wbs_work_papers',
    label: 'WBS: Kertas Kerja Pemeriksaan',
    description: 'Dokumentasi pengujian bukti, klarifikasi, dan indikasi kerugian WBS',
  },
  {
    key: 'wbs_results',
    label: 'WBS: Laporan Hasil Pemeriksaan',
    description: 'Laporan hasil akhir WBS beserta status konversi otomatis ke Temuan 5C',
  },
  {
    key: 'wbs_evidence_chunks',
    label: 'WBS: Lampiran Bukti Permulaan',
    description: 'Potongan berkas dokumen/foto bukti permulaan WBS (maks. 2 MB)',
  },
  {
    key: 'regulations',
    label: 'Basis Data Peraturan & Hukum',
    description: 'Inventaris produk hukum, SOP, dan hasil review klausul kepatuhan',
  },
  {
    key: 'signatories',
    label: 'Pejabat Penandatangan & TTD Digital',
    description: 'Data jabatan, NIP, tanda tangan kanvas/upload, dan stempel QR',
  },
  {
    key: 'kpi_items',
    label: 'KPI & Kamus Cascading (5 Tingkat)',
    description: 'Master indikator KPI perusahaan, Direksi, Divisi, Unit, Individu & Kamus KPI',
  },
  {
    key: 'kpi_measurements',
    label: 'Pengukuran Realisasi KPI & Rencana Aksi',
    description: 'Realisasi periodik bulanan/triwulanan/tahunan, verifikasi SPI & rencana aksi',
  },
  {
    key: 'kpi_checklist',
    label: 'Checklist Kelengkapan Sistem KPI (17 Item)',
    description: 'Daftar periksa kesiapan komponen tata kelola dan implementasi sistem KPI',
  },
  {
    key: 'kpi_settings',
    label: 'Kebijakan Skoring & Ambang KPI',
    description: 'Aturan ceiling cap, gating mutu air, bobot perspektif, dan tata kelola KPI',
  },
  {
    key: 'app_settings',
    label: 'Logo, Identitas & Pengaturan Aplikasi',
    description: 'Konfigurasi nama aplikasi, nama instansi, alamat, dan logo kantor',
  },
];

export type BackupImportMode = 'MERGE' | 'REPLACE';

export interface DatabaseBackupPayload {
  metadata: {
    format: 'SPI_SMART_FIRESTORE_BACKUP';
    version: string;
    exportedAt: string;
    exportedBy: string;
    appName?: string;
    institutionName?: string;
    totalCollections: number;
    totalDocuments: number;
    collectionCounts: Record<string, number>;
  };
  collections: Record<string, Record<string, Record<string, unknown>>>;
}

export interface BackupProgressInfo {
  currentCollection: string;
  currentCollectionLabel: string;
  completedCollections: number;
  totalCollections: number;
  processedDocs: number;
}

export interface ExportDatabaseResult {
  filename: string;
  totalCollections: number;
  totalDocuments: number;
  collectionCounts: Record<string, number>;
  durationMs: number;
}

export interface ImportDatabaseResult {
  totalCollections: number;
  totalWrittenDocuments: number;
  totalDeletedDocuments: number;
  collectionCounts: Record<string, number>;
  durationMs: number;
}

function serializeFirestoreValue(val: unknown): unknown {
  if (val === undefined || val === null) return null;
  const t = typeof val;
  if (t !== 'object') return val;
  if (val instanceof Timestamp) {
    return { __firestoreTimestamp: val.toDate().toISOString() };
  }
  if (Array.isArray(val)) {
    const out = new Array(val.length);
    for (let i = 0; i < val.length; i++) {
      out[i] = serializeFirestoreValue(val[i]);
    }
    return out;
  }
  const obj = val as Record<string, unknown>;
  if (typeof obj.toDate === 'function' && typeof obj.seconds === 'number') {
    try {
      return { __firestoreTimestamp: (obj.toDate as () => Date)().toISOString() };
    } catch {
      return String(obj);
    }
  }
  const clean: Record<string, unknown> = {};
  for (const k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v !== undefined) {
        clean[k] = typeof v === 'object' && v !== null ? serializeFirestoreValue(v) : v;
      }
    }
  }
  return clean;
}

function deserializeFirestoreValue(val: unknown): unknown {
  if (val === undefined) return null;
  if (val === null) return null;
  if (Array.isArray(val)) {
    return val.map((item) => deserializeFirestoreValue(item));
  }
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (
      typeof obj.__firestoreTimestamp === 'string' &&
      Object.keys(obj).length === 1
    ) {
      const parsedDate = new Date(obj.__firestoreTimestamp);
      if (!isNaN(parsedDate.getTime())) {
        return Timestamp.fromDate(parsedDate);
      }
    }
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        clean[k] = deserializeFirestoreValue(v);
      }
    }
    return clean;
  }
  return val;
}

export async function exportDatabaseToJson(options: {
  selectedCollections: string[];
  exportedBy: string;
  appName?: string;
  institutionName?: string;
  onProgress?: (info: BackupProgressInfo) => void;
}): Promise<ExportDatabaseResult> {
  const startTime = performance.now();
  const { selectedCollections, exportedBy, appName, institutionName, onProgress } = options;
  const collectionsData: Record<string, Record<string, Record<string, unknown>>> = {};
  const collectionCounts: Record<string, number> = {};
  let completedCount = 0;
  let totalDocuments = 0;

  const metaMap = new Map(BACKUP_COLLECTIONS.map((c) => [c.key, c.label]));

  onProgress?.({
    currentCollection: selectedCollections[0] || '',
    currentCollectionLabel: `Mengambil ${selectedCollections.length} koleksi secara paralel...`,
    completedCollections: 0,
    totalCollections: selectedCollections.length,
    processedDocs: 0,
  });

  await Promise.all(
    selectedCollections.map(async (colKey) => {
      try {
        const snap = await getDocs(collection(db, colKey));
        const docsMap: Record<string, Record<string, unknown>> = {};
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i++) {
          const d = docs[i];
          docsMap[d.id] = serializeFirestoreValue(d.data()) as Record<string, unknown>;
        }
        collectionsData[colKey] = docsMap;
        collectionCounts[colKey] = docs.length;
        totalDocuments += docs.length;
        completedCount += 1;
        onProgress?.({
          currentCollection: colKey,
          currentCollectionLabel: metaMap.get(colKey) || colKey,
          completedCollections: completedCount,
          totalCollections: selectedCollections.length,
          processedDocs: totalDocuments,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, colKey);
      }
    })
  );

  onProgress?.({
    currentCollection: '',
    currentCollectionLabel: 'Mengemas file JSON...',
    completedCollections: selectedCollections.length,
    totalCollections: selectedCollections.length,
    processedDocs: totalDocuments,
  });

  const payload: DatabaseBackupPayload = {
    metadata: {
      format: 'SPI_SMART_FIRESTORE_BACKUP',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      exportedBy,
      appName: appName || 'SPI SMART',
      institutionName: institutionName || '',
      totalCollections: selectedCollections.length,
      totalDocuments,
      collectionCounts,
    },
    collections: collectionsData,
  };

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}`;
  const slug = (appName || 'SPI_SMART').replace(/[^a-zA-Z0-9]+/g, '_');
  const filename = `Backup_Database_${slug}_${stamp}.json`;

  const jsonString = JSON.stringify(payload);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  const durationMs = Math.max(1, Math.round(performance.now() - startTime));

  return {
    filename,
    totalCollections: selectedCollections.length,
    totalDocuments,
    collectionCounts,
    durationMs,
  };
}

export async function parseDatabaseBackupFile(file: File): Promise<DatabaseBackupPayload> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File bukan format JSON yang valid. Pastikan Anda memilih file backup .json.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Struktur file backup tidak valid.');
  }

  const candidate = parsed as Partial<DatabaseBackupPayload>;
  if (!candidate.collections || typeof candidate.collections !== 'object') {
    throw new Error('File JSON tidak memiliki objek "collections" yang valid.');
  }

  const recognizedKeys = new Set(BACKUP_COLLECTIONS.map((c) => c.key));
  const sanitizedCollections: Record<string, Record<string, Record<string, unknown>>> = {};
  const collectionCounts: Record<string, number> = {};
  let totalDocuments = 0;

  for (const [colKey, docsObj] of Object.entries(candidate.collections)) {
    if (!recognizedKeys.has(colKey)) continue;
    if (!docsObj || typeof docsObj !== 'object' || Array.isArray(docsObj)) continue;

    const validDocs: Record<string, Record<string, unknown>> = {};
    for (const [docId, docData] of Object.entries(docsObj)) {
      if (docId && docData && typeof docData === 'object' && !Array.isArray(docData)) {
        validDocs[docId] = docData as Record<string, unknown>;
      }
    }
    sanitizedCollections[colKey] = validDocs;
    const count = Object.keys(validDocs).length;
    collectionCounts[colKey] = count;
    totalDocuments += count;
  }

  const colKeys = Object.keys(sanitizedCollections);
  if (colKeys.length === 0) {
    throw new Error(
      'Tidak ditemukan koleksi database aplikasi yang dikenali di dalam file JSON ini.'
    );
  }

  return {
    metadata: {
      format: 'SPI_SMART_FIRESTORE_BACKUP',
      version: candidate.metadata?.version || '1.0',
      exportedAt: candidate.metadata?.exportedAt || '',
      exportedBy: candidate.metadata?.exportedBy || 'Tidak diketahui',
      appName: candidate.metadata?.appName || 'SPI SMART',
      institutionName: candidate.metadata?.institutionName || '',
      totalCollections: colKeys.length,
      totalDocuments,
      collectionCounts,
    },
    collections: sanitizedCollections,
  };
}

export async function importDatabaseFromBackup(options: {
  backup: DatabaseBackupPayload;
  selectedCollections: string[];
  mode: BackupImportMode;
  currentUserUid?: string;
  onProgress?: (info: BackupProgressInfo) => void;
}): Promise<ImportDatabaseResult> {
  const startTime = performance.now();
  const { backup, selectedCollections, mode, currentUserUid, onProgress } = options;

  let totalWrittenDocuments = 0;
  let totalDeletedDocuments = 0;
  let completedCollections = 0;
  const collectionCounts: Record<string, number> = {};
  const metaMap = new Map(BACKUP_COLLECTIONS.map((c) => [c.key, c.label]));

  const BATCH_LIMIT = 450;

  onProgress?.({
    currentCollection: selectedCollections[0] || '',
    currentCollectionLabel: `Memulihkan ${selectedCollections.length} koleksi secara paralel...`,
    completedCollections: 0,
    totalCollections: selectedCollections.length,
    processedDocs: 0,
  });

  await Promise.all(
    selectedCollections.map(async (colKey) => {
      const docsMap = backup.collections[colKey] || {};
      const entries = Object.entries(docsMap);

      if (mode === 'REPLACE') {
        try {
          const existingSnap = await getDocs(collection(db, colKey));
          const docsToDelete = existingSnap.docs.filter((d) => {
            if (colKey === 'users') {
              if (d.id === 'superman_root') return false;
              if (currentUserUid && d.id === currentUserUid) return false;
            }
            return true;
          });

          const deletePromises: Promise<void>[] = [];
          for (let idx = 0; idx < docsToDelete.length; idx += BATCH_LIMIT) {
            const chunk = docsToDelete.slice(idx, idx + BATCH_LIMIT);
            const batch = writeBatch(db);
            chunk.forEach((docSnap) => {
              batch.delete(docSnap.ref);
            });
            deletePromises.push(batch.commit());
            totalDeletedDocuments += chunk.length;
          }
          await Promise.all(deletePromises);
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, colKey);
        }
      }

      try {
        const writePromises: Promise<void>[] = [];
        for (let idx = 0; idx < entries.length; idx += BATCH_LIMIT) {
          const chunk = entries.slice(idx, idx + BATCH_LIMIT);
          const batch = writeBatch(db);
          chunk.forEach(([docId, rawData]) => {
            const restoredData = deserializeFirestoreValue(rawData) as Record<string, unknown>;
            const ref = doc(db, colKey, docId);
            if (mode === 'MERGE') {
              batch.set(ref, restoredData, { merge: true });
            } else {
              batch.set(ref, restoredData);
            }
          });
          writePromises.push(batch.commit());
          totalWrittenDocuments += chunk.length;
        }
        await Promise.all(writePromises);
        collectionCounts[colKey] = entries.length;
        completedCollections += 1;
        onProgress?.({
          currentCollection: colKey,
          currentCollectionLabel: metaMap.get(colKey) || colKey,
          completedCollections,
          totalCollections: selectedCollections.length,
          processedDocs: totalWrittenDocuments,
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, colKey);
      }
    })
  );

  onProgress?.({
    currentCollection: '',
    currentCollectionLabel: 'Impor database selesai.',
    completedCollections: selectedCollections.length,
    totalCollections: selectedCollections.length,
    processedDocs: totalWrittenDocuments,
  });

  const durationMs = Math.max(1, Math.round(performance.now() - startTime));

  return {
    totalCollections: selectedCollections.length,
    totalWrittenDocuments,
    totalDeletedDocuments,
    collectionCounts,
    durationMs,
  };
}
