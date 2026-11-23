export type AppFeatureId =
  | 'dashboard'
  | 'risk_universe'
  | 'audit_universe'
  | 'risk_register'
  | 'risk_profile'
  | 'risk_annual_report'
  | 'rcsa'
  | 'bpkp_assessment'
  | 'kpi_management'
  | 'rka'
  | 'pkpt'
  | 'spi_programs'
  | 'audit_assignments'
  | 'audit_program'
  | 'work_papers'
  | 'audit_reports'
  | 'spi_periodic_reports'
  | 'findings'
  | 'follow_ups'
  | 'wbs_management'
  | 'investigations'
  | 'regulations'
  | 'user_management'
  | 'master_units'
  | 'signatories'
  | 'app_branding';

export interface AppSectionCatalogItem {
  key: string;
  defaultTitle: string;
}

export interface AppFeatureCatalogItem {
  id: AppFeatureId;
  sectionKey: string;
  defaultLabel: string;
  defaultNavbarTitle: string;
  description: string;
}

export const APP_SECTIONS: AppSectionCatalogItem[] = [
  { key: 'pusat_komando', defaultTitle: 'Pusat Komando' },
  { key: 'perencanaan_risiko', defaultTitle: 'Perencanaan Berbasis Risiko' },
  { key: 'pelaksanaan_audit', defaultTitle: 'Pelaksanaan Audit' },
  { key: 'temuan_tl', defaultTitle: 'Temuan & Tindak Lanjut' },
  { key: 'investigasi_regulasi', defaultTitle: 'Investigasi & Regulasi' },
  { key: 'tata_kelola', defaultTitle: 'Tata Kelola Sistem' },
];

export const APP_FEATURES: AppFeatureCatalogItem[] = [
  {
    id: 'dashboard',
    sectionKey: 'pusat_komando',
    defaultLabel: 'Dashboard Pengawasan',
    defaultNavbarTitle: 'Pusat Kendali Pengawasan (Dashboard SPI)',
    description: 'Ringkasan metrik pengawasan, peta risiko 5x5, realisasi PKPT, dan tindak lanjut.',
  },
  {
    id: 'risk_universe',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Pemilik Risiko',
    defaultNavbarTitle: 'Pemilik Risiko & Struktur Proses BUMD',
    description: 'Pemetaan pemilik risiko, unit kerja, dan proses bisnis perusahaan.',
  },
  {
    id: 'risk_register',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Register Risiko 5x5',
    defaultNavbarTitle: 'Register Risiko Korporat (Matriks 5x5)',
    description: 'Identifikasi, penilaian risiko inheren/residual 5x5, dan rencana mitigasi.',
  },
  {
    id: 'risk_profile',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Profil Risiko Korporat',
    defaultNavbarTitle: 'Profil Risiko Korporat & Selera Risiko (Khusus Kepala SPI / Super User)',
    description: 'Penetapan selera risiko, batas toleransi, dan top risks korporat.',
  },
  {
    id: 'risk_annual_report',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Laporan Tahunan Risiko',
    defaultNavbarTitle: 'Laporan Tahunan Manajemen Risiko (Khusus Kepala SPI / Super User)',
    description: 'Penyusunan dan cetak laporan tahunan manajemen risiko terstruktur 7 bab.',
  },
  {
    id: 'rcsa',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Penilaian RCSA Unit',
    defaultNavbarTitle: 'Penilaian Sendiri Risiko Unit (RCSA)',
    description: 'Risk and Control Self Assessment oleh unit kerja dan reviu SPI.',
  },
  {
    id: 'bpkp_assessment',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Self Assessment SPIP',
    defaultNavbarTitle: 'Self Assessment Kinerja & Maturitas SPIP Terpadu',
    description: 'Evaluasi kinerja BUMD Air Minum & tingkat maturitas SPIP Terpadu.',
  },
  {
    id: 'kpi_management',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'KPI & Cascading Kinerja',
    defaultNavbarTitle: 'Sistem Manajemen KPI, Cascading 5 Tingkat & Kamus Kinerja',
    description: 'Kamus KPI, penurunan 5 tingkat organisasi, realisasi, verifikasi SPI & rencana aksi.',
  },
  {
    id: 'rka',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Input RKA Manual',
    defaultNavbarTitle: 'Rencana Kerja dan Anggaran (Input Manual RKA)',
    description: 'Input manual RKA, bidang program, waktu pelaksanaan, pagu & bobot materialitas PKPT.',
  },
  {
    id: 'audit_universe',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Audit Universe (Peta Objek)',
    defaultNavbarTitle: 'Audit Universe & Pemetaan Objek Audit (Berbasis Risiko)',
    description: 'Inventaris semesta audit dan skoring faktor risiko untuk penyusunan PKPT.',
  },
  {
    id: 'pkpt',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Penyusunan PKPT',
    defaultNavbarTitle: 'Penyusunan Program Kerja Pengawasan Tahunan (PKPT)',
    description: 'Penjadwalan prioritas audit tahunan berbasis risiko dan RKA.',
  },
  {
    id: 'spi_programs',
    sectionKey: 'perencanaan_risiko',
    defaultLabel: 'Program Tahunan SPI',
    defaultNavbarTitle: 'Program Kerja Tahunan Kapabilitas SPI',
    description: 'Program kerja penguatan kapabilitas internal, pelatihan, dan non-audit SPI.',
  },
  {
    id: 'audit_assignments',
    sectionKey: 'pelaksanaan_audit',
    defaultLabel: 'Surat Tugas & Tim',
    defaultNavbarTitle: 'Penugasan & Penerbitan Surat Tugas Audit',
    description: 'Penerbitan Surat Perintah Tugas (SPT), penunjukan tim auditor, dan jadwal.',
  },
  {
    id: 'audit_program',
    sectionKey: 'pelaksanaan_audit',
    defaultLabel: 'Program Audit (PKA)',
    defaultNavbarTitle: 'Program Kerja Pemeriksaan (PKA)',
    description: 'Langkah kerja audit, prosedur pengujian, sampel, dan pembagian tugas.',
  },
  {
    id: 'work_papers',
    sectionKey: 'pelaksanaan_audit',
    defaultLabel: 'Kertas Kerja Audit (KKA)',
    defaultNavbarTitle: 'Kertas Kerja Audit (KKA) & Pengujian Substantif',
    description: 'Dokumentasi pengujian, bukti audit, reviu berjenjang, dan penguncian KKA.',
  },
  {
    id: 'audit_reports',
    sectionKey: 'pelaksanaan_audit',
    defaultLabel: 'Laporan Hasil Audit (LHA)',
    defaultNavbarTitle: 'Laporan Hasil Audit (LHA) & Pengawasan SPI (Asistensi AI)',
    description: 'Penyusunan dan cetak naskah resmi Laporan Hasil Audit.',
  },
  {
    id: 'spi_periodic_reports',
    sectionKey: 'pelaksanaan_audit',
    defaultLabel: 'Laporan SPI (Bulanan/Tahunan)',
    defaultNavbarTitle: 'Laporan Pengawasan SPI (Bulanan & Tahunan)',
    description: 'Laporan berkala bulanan dan tahunan aktivitas pengawasan SPI & WBS.',
  },
  {
    id: 'findings',
    sectionKey: 'temuan_tl',
    defaultLabel: 'Temuan Audit (5C)',
    defaultNavbarTitle: 'Matriks Temuan Audit 5C & Potensi Kerugian',
    description: 'Inventarisasi temuan kondisi, kriteria, sebab, akibat & rekomendasi perbaikan.',
  },
  {
    id: 'follow_ups',
    sectionKey: 'temuan_tl',
    defaultLabel: 'Tindak Lanjut Rekomendasi',
    defaultNavbarTitle: 'Pemantauan & Verifikasi Tindak Lanjut Rekomendasi',
    description: 'Pelaporan progres tindak lanjut unit kerja dan verifikasi status penyelesaian.',
  },
  {
    id: 'wbs_management',
    sectionKey: 'investigasi_regulasi',
    defaultLabel: 'Manajemen WBS (Whistleblowing)',
    defaultNavbarTitle: 'Manajemen Whistleblowing System (WBS) & Konversi Temuan 5C',
    description: 'Register pengaduan WBS, surat tugas WBS, kertas kerja WBS & laporan hasil.',
  },
  {
    id: 'investigations',
    sectionKey: 'investigasi_regulasi',
    defaultLabel: 'Audit Investigatif & Fraud',
    defaultNavbarTitle: 'Audit Investigatif & Penanganan Indikasi Fraud',
    description: 'Penanganan khusus kasus indikasi kecurangan dan audit tujuan tertentu.',
  },
  {
    id: 'regulations',
    sectionKey: 'investigasi_regulasi',
    defaultLabel: 'Review Produk Hukum',
    defaultNavbarTitle: 'Basis Data Peraturan & Review Kepatuhan Hukum',
    description: 'Katalog regulasi eksternal, Perdir, SOP, dan catatan review kepatuhan.',
  },
  {
    id: 'app_branding',
    sectionKey: 'tata_kelola',
    defaultLabel: 'Logo & Identitas Kantor',
    defaultNavbarTitle: 'Pengaturan Logo, Nama Aplikasi, Fitur & Identitas Kantor',
    description: 'Pengaturan logo, identitas instansi, serta penyesuaian nama semua fitur sistem.',
  },
  {
    id: 'user_management',
    sectionKey: 'tata_kelola',
    defaultLabel: 'Manajemen Pengguna',
    defaultNavbarTitle: 'Manajemen Pengguna & Otorisasi RBAC',
    description: 'Persetujuan registrasi, pengaturan akun pengguna, dan kontrol hak akses peran.',
  },
  {
    id: 'master_units',
    sectionKey: 'tata_kelola',
    defaultLabel: 'Master Unit & Wilayah',
    defaultNavbarTitle: 'Master Data Unit Kerja & Wilayah Pelayanan',
    description: 'Pengelolaan unit kerja operasional, bidang, dan kantor cabang pelayanan.',
  },
  {
    id: 'signatories',
    sectionKey: 'tata_kelola',
    defaultLabel: 'Fitur Jabatan & TTD',
    defaultNavbarTitle: 'Fitur Jabatan & Pejabat Penandatangan Dokumen',
    description: 'Pengelolaan data pejabat penandatangan resmi dan tanda tangan digital.',
  },
];

export const FEATURE_CATALOG_MAP: Record<AppFeatureId, AppFeatureCatalogItem> = APP_FEATURES.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<AppFeatureId, AppFeatureCatalogItem>
);

export const FISCAL_MONTHS = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

export type FiscalMonthName = (typeof FISCAL_MONTHS)[number];

export function getQuarterFromMonth(
  month?: string,
  fallback: 'Q1' | 'Q2' | 'Q3' | 'Q4' = 'Q1'
): 'Q1' | 'Q2' | 'Q3' | 'Q4' {
  if (!month) return fallback;
  const idx = FISCAL_MONTHS.findIndex(
    (m) => m.toLowerCase() === month.trim().toLowerCase()
  );
  if (idx === -1) return fallback;
  if (idx <= 2) return 'Q1';
  if (idx <= 5) return 'Q2';
  if (idx <= 8) return 'Q3';
  return 'Q4';
}

export function getDefaultMonthForQuarter(quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4'): FiscalMonthName {
  switch (quarter) {
    case 'Q2':
      return 'April';
    case 'Q3':
      return 'Juli';
    case 'Q4':
      return 'Oktober';
    case 'Q1':
    default:
      return 'Januari';
  }
}

export function formatQuarterAsCurrentMonth(quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4'): string {
  switch (quarter) {
    case 'Q2':
      return 'Bulan Berjalan (Apr–Jun)';
    case 'Q3':
      return 'Bulan Berjalan (Jul–Sep)';
    case 'Q4':
      return 'Bulan Berjalan (Okt–Des)';
    case 'Q1':
    default:
      return 'Bulan Berjalan (Jan–Mar)';
  }
}

export function resolveExecutionMonth(item: {
  executionMonth?: string;
  targetQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
}): FiscalMonthName {
  if (item.executionMonth) {
    const found = FISCAL_MONTHS.find(
      (m) => m.toLowerCase() === item.executionMonth!.trim().toLowerCase()
    );
    if (found) return found;
  }
  return getDefaultMonthForQuarter(item.targetQuarter || item.quarter);
}

export function formatRkaExecutionSchedule(item: {
  year: number;
  executionMonth?: string;
  targetQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
}): string {
  if (item.executionMonth && item.executionMonth.trim()) {
    return `${item.executionMonth.trim()} ${item.year}`;
  }
  if (item.targetQuarter) {
    return `${getDefaultMonthForQuarter(item.targetQuarter)} ${item.year}`;
  }
  return `TA ${item.year}`;
}

export function formatPkptExecutionSchedule(item: {
  year?: number;
  executionMonth?: string;
  quarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
}): string {
  if (item.executionMonth && item.executionMonth.trim()) {
    return item.year ? `${item.executionMonth.trim()} ${item.year}` : item.executionMonth.trim();
  }
  if (item.quarter) {
    return formatQuarterAsCurrentMonth(item.quarter);
  }
  return 'Bulan Berjalan';
}
