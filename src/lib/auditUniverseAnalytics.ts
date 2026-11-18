import {
  AuditCycleFrequency,
  AuditReport,
  AuditUniverseCategory,
  AuditUniverseItem,
  AuditUniverseRiskTier,
  Finding,
  PKPT,
  RKAItem,
  RiskRegister,
  Unit,
  WBSReport,
} from '../types/audit';

export const AUDIT_UNIVERSE_CATEGORIES: AuditUniverseCategory[] = [
  'Unit Pelayanan / Cabang',
  'Proses Bisnis Operasional',
  'Fungsi Keuangan & Aset',
  'Proyek / Investasi RKA',
  'Sistem TI & Data',
  'Tata Kelola & Kepatuhan',
];

export const AUDIT_CYCLE_OPTIONS: AuditCycleFrequency[] = [
  'Tahunan (1 Tahun)',
  'Dua Tahunan (2 Tahun)',
  'Tiga Tahunan (3 Tahun)',
  'Tematik / Ad-Hoc',
];

export const AUDIT_UNIVERSE_WEIGHTS = {
  riskFactor: 0.30,       // 30% Profil Risiko Residual (Risk Register / RCSA)
  materiality: 0.25,      // 25% Materialitas Keuangan / Pagu RKA
  controlHistory: 0.20,   // 20% Jarak Audit Terakhir & Temuan 5C / WBS Terbuka
  complianceImpact: 0.15, // 15% Dampak Kepatuhan Regulasi & Pelayanan Publik
  complexity: 0.10,       // 10% Kompleksitas Operasional / Sistem TI / Perubahan
} as const;

export const AUDIT_UNIVERSE_GUIDELINES = [
  {
    code: 'GIAS 2024 · Standar 9.4',
    title: 'Global Internal Audit Standards (Domain IV)',
    summary:
      'Kepala SPI wajib menyusun rencana audit berbasis risiko yang bersumber dari Audit Universe komprehensif (unit, proses, proyek, TI, dan kepatuhan), ditinjau minimal setahun sekali.',
  },
  {
    code: 'PP No. 54 Tahun 2017',
    title: 'Tata Kelola & Pengawasan Intern BUMD',
    summary:
      'Pasal 66, 91, dan 108 mengamanatkan SPI mengawasi pelaksanaan RKAP/RBA, keandalan pelaporan keuangan, pengamanan aset daerah, serta kepatuhan hukum di seluruh lini BUMD.',
  },
  {
    code: 'Permendagri No. 23 Tahun 2024',
    title: 'Pengelolaan BUMD Air Minum',
    summary:
      'Menekankan pengendalian Tingkat Kehilangan Air (NRW), ketepatan baca meter & penagihan, penetapan tarif, serta efisiensi unit pelayanan air minum.',
  },
  {
    code: 'PP 60/2008 & Pedoman BPKP',
    title: 'PKPT Berbasis Risiko (Risk-Based Audit Plan)',
    summary:
      'Menetapkan siklus pengawasan berdasarkan skor komposit 5 faktor: P1 Sangat Tinggi (≥80: Tahunan), P2 Tinggi (60-79: 1-2 Tahun), P3 Sedang (40-59: 2-3 Tahun), P4 Rendah (<40: ≥3 Tahun).',
  },
] as const;

export function clampScore1To5(val: number): number {
  if (!Number.isFinite(val)) return 3;
  return Math.min(5, Math.max(1, Math.round(val)));
}

export function computeAuditUniverseCompositeScore(scores: {
  riskFactorScore: number;
  materialityScore: number;
  controlHistoryScore: number;
  complianceImpactScore: number;
  complexityScore: number;
}): number {
  const weighted =
    clampScore1To5(scores.riskFactorScore) * AUDIT_UNIVERSE_WEIGHTS.riskFactor +
    clampScore1To5(scores.materialityScore) * AUDIT_UNIVERSE_WEIGHTS.materiality +
    clampScore1To5(scores.controlHistoryScore) * AUDIT_UNIVERSE_WEIGHTS.controlHistory +
    clampScore1To5(scores.complianceImpactScore) * AUDIT_UNIVERSE_WEIGHTS.complianceImpact +
    clampScore1To5(scores.complexityScore) * AUDIT_UNIVERSE_WEIGHTS.complexity;

  return Math.min(100, Math.max(20, Math.round((weighted / 5) * 100)));
}

export function deriveRiskTierAndCycle(compositeScore: number): {
  riskTier: AuditUniverseRiskTier;
  recommendedFrequency: AuditCycleFrequency;
  estimatedDays: number;
  priorityRank: string;
} {
  if (compositeScore >= 80) {
    return {
      riskTier: 'Sangat Tinggi (P1)',
      recommendedFrequency: 'Tahunan (1 Tahun)',
      estimatedDays: 14,
      priorityRank: 'Prioritas 1 (Krusial)',
    };
  }
  if (compositeScore >= 60) {
    return {
      riskTier: 'Tinggi (P2)',
      recommendedFrequency: 'Dua Tahunan (2 Tahun)',
      estimatedDays: 12,
      priorityRank: 'Prioritas 2',
    };
  }
  if (compositeScore >= 40) {
    return {
      riskTier: 'Sedang (P3)',
      recommendedFrequency: 'Tiga Tahunan (3 Tahun)',
      estimatedDays: 10,
      priorityRank: 'Prioritas 3',
    };
  }
  return {
    riskTier: 'Rendah (P4)',
    recommendedFrequency: 'Tiga Tahunan (3 Tahun)',
    estimatedDays: 7,
    priorityRank: 'Prioritas 4 (Pemantauan)',
  };
}

export function mapRiskScoreTo1To5(maxResidualScore: number): number {
  if (maxResidualScore >= 20) return 5;
  if (maxResidualScore >= 15) return 4;
  if (maxResidualScore >= 10) return 3;
  if (maxResidualScore >= 5) return 2;
  return 1;
}

export function mapBudgetToMateriality1To5(totalBudget: number): number {
  if (totalBudget >= 1_000_000_000) return 5;
  if (totalBudget >= 500_000_000) return 4;
  if (totalBudget >= 200_000_000) return 3;
  if (totalBudget >= 50_000_000) return 2;
  return 1;
}

export function computeControlHistoryFactor(params: {
  year: number;
  lastAuditYear?: number;
  openFindingsCount: number;
  openWbsCount: number;
}): number {
  const { year, lastAuditYear, openFindingsCount, openWbsCount } = params;
  let base = 4;
  if (!lastAuditYear) {
    base = 5;
  } else {
    const gap = Math.max(0, year - lastAuditYear);
    if (gap >= 3) base = 5;
    else if (gap === 2) base = 4;
    else if (gap === 1) base = 3;
    else base = 2;
  }
  if (openFindingsCount >= 2 || openWbsCount >= 1) {
    base = Math.min(5, base + 1);
  }
  return base;
}

export function mapCompositeToUnitRiskScore25(compositeScore: number): number {
  return Math.min(25, Math.max(1, Math.round((compositeScore / 100) * 25)));
}

export interface LiveUniverseMetrics {
  maxResidualRisk25: number;
  riskFactorScore: number;
  linkedRkaBudget: number;
  materialityScore: number;
  lastAuditYear?: number;
  lastAuditDate?: string;
  lastAuditOpinion?: string;
  openFindingsCount: number;
  openWbsCount: number;
  controlHistoryScore: number;
}

export function computeLiveMetricsForUnit(params: {
  unitId: string;
  unitName: string;
  year: number;
  risks: RiskRegister[];
  rkaItems: RKAItem[];
  findings: Finding[];
  auditReports: AuditReport[];
  wbsReports: WBSReport[];
  fallbackLastAuditYear?: number;
}): LiveUniverseMetrics {
  const {
    unitId,
    unitName,
    year,
    risks,
    rkaItems,
    findings,
    auditReports,
    wbsReports,
    fallbackLastAuditYear,
  } = params;

  const matchUnit = (uId?: string, uName?: string) =>
    (unitId && uId === unitId) ||
    (unitName && uName && uName.toLowerCase() === unitName.toLowerCase());

  // 1. Risk Factor (30%)
  const unitRisksYear = risks.filter((r) => matchUnit(r.unitId, r.unitName) && r.year === year);
  const unitRisks = unitRisksYear.length > 0 ? unitRisksYear : risks.filter((r) => matchUnit(r.unitId, r.unitName));
  const maxResidualRisk25 =
    unitRisks.length > 0
      ? Math.max(...unitRisks.map((r) => r.residualScore || r.inherentScore || 12))
      : 12;
  const riskFactorScore = mapRiskScoreTo1To5(maxResidualRisk25);

  // 2. Financial Materiality / RKA (25%)
  const unitRkaYear = rkaItems.filter((r) => matchUnit(r.unitId, r.unitName) && r.year === year);
  const unitRka = unitRkaYear.length > 0 ? unitRkaYear : rkaItems.filter((r) => matchUnit(r.unitId, r.unitName));
  const linkedRkaBudget = unitRka.reduce((sum, r) => sum + (r.budgetAmount || 0), 0);
  const materialityScore = unitRka.length > 0 ? mapBudgetToMateriality1To5(linkedRkaBudget) : 3;

  // 3. Audit History & Open Findings / WBS (20%)
  const unitReports = auditReports
    .filter((lha) => matchUnit(lha.unitId, lha.unitName))
    .sort((a, b) => (b.reportDate || b.createdAt || '').localeCompare(a.reportDate || a.createdAt || ''));

  const latestLha = unitReports[0];
  let lastAuditYear = fallbackLastAuditYear;
  let lastAuditDate: string | undefined;
  let lastAuditOpinion: string | undefined;
  if (latestLha) {
    const rawDate = latestLha.reportDate || latestLha.createdAt;
    const yrMatch = rawDate?.match(/^(\d{4})/);
    if (yrMatch) {
      lastAuditYear = parseInt(yrMatch[1], 10);
    }
    lastAuditDate = rawDate?.slice(0, 10);
    lastAuditOpinion = latestLha.auditOpinion;
  }

  const openFindingsCount = findings.filter(
    (f) => matchUnit(f.unitId, f.unitName) && f.status !== 'Selesai'
  ).length;

  const openWbsCount = wbsReports.filter(
    (w) =>
      matchUnit(w.reportedUnitId, w.reportedUnitName) &&
      w.status !== 'Tidak Terbukti / Diarsipkan' &&
      w.status !== 'Laporan Hasil Selesai' &&
      w.status !== 'Menjadi Temuan 5C'
  ).length;

  const controlHistoryScore = computeControlHistoryFactor({
    year,
    lastAuditYear,
    openFindingsCount,
    openWbsCount,
  });

  return {
    maxResidualRisk25,
    riskFactorScore,
    linkedRkaBudget,
    materialityScore,
    lastAuditYear,
    lastAuditDate,
    lastAuditOpinion,
    openFindingsCount,
    openWbsCount,
    controlHistoryScore,
  };
}

interface CoreProcessBlueprint {
  code: string;
  entityName: string;
  category: AuditUniverseCategory;
  unitKeywords: string[];
  businessProcess: string;
  regulatoryBasis: string;
  defaultAuditType: string;
  objectiveTemplate: string;
  scopeTemplate: string;
  complianceImpactScore: number;
  complexityScore: number;
  recommendedQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  defaultRiskFallback: number;
  defaultMaterialityFallback: number;
}

const CORE_BUMD_PROCESS_BLUEPRINTS: CoreProcessBlueprint[] = [
  {
    code: 'AU-KEU-01',
    entityName: 'Pengelolaan Kas, Bank & Penerimaan Pendapatan Rekening Air',
    category: 'Fungsi Keuangan & Aset',
    unitKeywords: ['umum', 'keuangan'],
    businessProcess: 'Penerimaan Kas, Rekonsiliasi Bank & Pengendalian Kas Kecil',
    regulatoryBasis: 'PP No. 54/2017 Pasal 91; SAK EP; GIAS 2024 Std 9.4',
    defaultAuditType: 'Audit Kas dan Bank',
    objectiveTemplate:
      'Memastikan seluruh penerimaan rekening air dan non-air disetor tepat waktu, bebas dari penggelapan kas (lapping), serta rekonsiliasi bank akurat.',
    scopeTemplate:
      'Bukti kas masuk/keluar, rekening koran bank, kas opname mendadak loket pembayaran & mitra PPOB.',
    complianceImpactScore: 5,
    complexityScore: 4,
    recommendedQuarter: 'Q1',
    defaultRiskFallback: 5,
    defaultMaterialityFallback: 5,
  },
  {
    code: 'AU-HLG-02',
    entityName: 'Siklus Pembacaan Meter, Penagihan & Pengendalian Piutang Pelanggan',
    category: 'Proses Bisnis Operasional',
    unitKeywords: ['hubungan langganan', 'langganan'],
    businessProcess: 'Baca Meter Pelanggan, Billing, Penagihan & Penanganan Tunggakan',
    regulatoryBasis: 'Permendagri No. 23/2024 Pasal 22; Perdir Penagihan; Pedoman BPKP',
    defaultAuditType: 'Audit Piutang Pelanggan',
    objectiveTemplate:
      'Memastikan akurasi pembacaan meter pelanggan, pencegahan rekayasa tarif/tagihan, serta efektivitas penagihan dan penyisihan piutang.',
    scopeTemplate:
      'Data billing pelanggan, foto baca meter, daftar piutang macet >3 bulan, dan pemutusan/penyambungan kembali.',
    complianceImpactScore: 5,
    complexityScore: 4,
    recommendedQuarter: 'Q1',
    defaultRiskFallback: 4,
    defaultMaterialityFallback: 5,
  },
  {
    code: 'AU-TEK-03',
    entityName: 'Pengendalian Tingkat Kehilangan Air (NRW) & Efisiensi Distribusi',
    category: 'Proses Bisnis Operasional',
    unitKeywords: ['teknik'],
    businessProcess: 'Transmisi, Distribusi, Kalibrasi Meter Induk & Penanganan Kebocoran',
    regulatoryBasis: 'Permendagri No. 23/2024 Pasal 14; PP No. 54/2017; KPI Teknis BPKP',
    defaultAuditType: 'Audit Teknik dan Distribusi',
    objectiveTemplate:
      'Mengevaluasi efektivitas program penurunan NRW (Non-Revenue Water), akurasi meter induk, dan respon perbaikan kebocoran jaringan.',
    scopeTemplate:
      'Neraca air (water balance), log perbaikan kebocoran pipa, akurasi meter induk produksi/zona, serta kehilangan non-fisik/ilegal.',
    complianceImpactScore: 5,
    complexityScore: 5,
    recommendedQuarter: 'Q2',
    defaultRiskFallback: 5,
    defaultMaterialityFallback: 4,
  },
  {
    code: 'AU-PBJ-04',
    entityName: 'Pengadaan Barang/Jasa, Kontrak Fisik & Belanja Modal RKA',
    category: 'Proyek / Investasi RKA',
    unitKeywords: ['teknik', 'umum'],
    businessProcess: 'Perencanaan HPS, Pemilihan Penyedia, Pelaksanaan Kontrak & BAST',
    regulatoryBasis: 'PP No. 54/2017; Perpres Pengadaan Barang/Jasa; GIAS 2024',
    defaultAuditType: 'Audit Pengadaan Barang/Jasa',
    objectiveTemplate:
      'Memastikan proses pengadaan barang/jasa transparan, bebas benturan kepentingan/mark-up, serta volume fisik pekerjaan sesuai kontrak.',
    scopeTemplate:
      'Paket pengadaan pipa/kimia/pompa/konstruksi bernilai material, HPS, kontrak adendum, dan berita acara serah terima.',
    complianceImpactScore: 5,
    complexityScore: 4,
    recommendedQuarter: 'Q2',
    defaultRiskFallback: 5,
    defaultMaterialityFallback: 5,
  },
  {
    code: 'AU-PRD-05',
    entityName: 'Operasional Instalasi Pengolahan Air (IPA), Bahan Kimia & Kualitas Air (K3)',
    category: 'Proses Bisnis Operasional',
    unitKeywords: ['teknik'],
    businessProcess: 'Produksi Air Bersih, Penggunaan Bahan Kimia/Listrik & Uji Kualitas Air',
    regulatoryBasis: 'Permendagri No. 23/2024; Permenkes Kualitas Air Minum; PP 60/2008 SPIP',
    defaultAuditType: 'Audit Operasional',
    objectiveTemplate:
      'Menjamin efisiensi pemakaian bahan kimia koagulan & energi pompa serta kepatuhan standar baku mutu kualitas air minum.',
    scopeTemplate:
      'Laporan harian produksi IPA, pemakaian tawas/kaporit, uji laboratorium berkala, dan pemeliharaan pompa.',
    complianceImpactScore: 5,
    complexityScore: 4,
    recommendedQuarter: 'Q3',
    defaultRiskFallback: 4,
    defaultMaterialityFallback: 4,
  },
  {
    code: 'AU-AST-06',
    entityName: 'Manajemen Aset Tetap, Persediaan Pipa & Gudang Material',
    category: 'Fungsi Keuangan & Aset',
    unitKeywords: ['umum', 'keuangan'],
    businessProcess: 'Pencatatan Kartu Stok, Pengeluaran Material Perbaikan & Inventarisasi Aset',
    regulatoryBasis: 'PP No. 54/2017 Pengamanan Aset; Permendagri 118/2018; SPIP Unsur 3',
    defaultAuditType: 'Audit Persediaan dan Gudang',
    objectiveTemplate:
      'Memastikan keberadaan fisik persediaan material pipa/meteran sesuai catatan akuntansi dan pengamanan aset perusahaan.',
    scopeTemplate:
      'Stock opname gudang pusat dan unit, bukti permintaan material (SPB), serta sertifikat/pencatatan aset tetap.',
    complianceImpactScore: 4,
    complexityScore: 3,
    recommendedQuarter: 'Q3',
    defaultRiskFallback: 4,
    defaultMaterialityFallback: 4,
  },
  {
    code: 'AU-SDM-07',
    entityName: 'Pengelolaan SDM, Penggajian, Tunjangan Lembur & Disiplin Pegawai',
    category: 'Tata Kelola & Kepatuhan',
    unitKeywords: ['umum'],
    businessProcess: 'Rekrutmen, Absensi, Penggajian, Lembur & Kepatuhan Disiplin Kerja',
    regulatoryBasis: 'Perdir Kepegawaian; PP No. 54/2017; UU Ketenagakerjaan',
    defaultAuditType: 'Audit Kepegawaian',
    objectiveTemplate:
      'Memastikan pembayaran gaji, lembur, dan tunjangan sesuai daftar hadir riil, SK penempatan, serta struktur skala upah.',
    scopeTemplate:
      'Rekap absensi biometrik, SPKL lembur, payroll bulanan, dan evaluasi beban biaya SDM terhadap pendapatan.',
    complianceImpactScore: 4,
    complexityScore: 3,
    recommendedQuarter: 'Q3',
    defaultRiskFallback: 3,
    defaultMaterialityFallback: 4,
  },
  {
    code: 'AU-TI-08',
    entityName: 'Keandalan Sistem Informasi Billing, Aplikasi Keuangan & Keamanan Data',
    category: 'Sistem TI & Data',
    unitKeywords: ['hubungan langganan', 'umum'],
    businessProcess: 'Hak Akses Aplikasi Billing, Log Perubahan Tagihan & Backup Basis Data',
    regulatoryBasis: 'GIAS 2024 Teknologi & Siber; PP 60/2008 SPIP; ISO 31000',
    defaultAuditType: 'Audit Teknologi Informasi',
    objectiveTemplate:
      'Menilai pengendalian akses pengguna (user privilege), jejak audit perubahan tagihan/koreksi rekening, dan kesiapan pemulihan bencana data.',
    scopeTemplate:
      'Matriks hak akses aplikasi billing & kasir, audit log koreksi rekening, serta pengujian backup sistem.',
    complianceImpactScore: 4,
    complexityScore: 5,
    recommendedQuarter: 'Q4',
    defaultRiskFallback: 4,
    defaultMaterialityFallback: 3,
  },
  {
    code: 'AU-GCG-09',
    entityName: 'Tata Kelola Perusahaan (GCG), Kepatuhan Hukum & Tindak Lanjut SPIP/BPKP',
    category: 'Tata Kelola & Kepatuhan',
    unitKeywords: ['direksi', 'sekretariat', 'spi'],
    businessProcess: 'Kepatuhan Regulasi, Pelaksanaan Kontrak Kinerja & Maturitas SPIP',
    regulatoryBasis: 'PP No. 54/2017 Pasal 66 & 108; Permendagri 23/2024; Pedoman BPKP',
    defaultAuditType: 'Audit Kepatuhan',
    objectiveTemplate:
      'Mengevaluasi kesesuaian kebijakan Direksi terhadap regulasi BUMD, tindak lanjut hasil pemeriksaan eksternal/SPI, serta maturitas SPIP.',
    scopeTemplate:
      'Peraturan Direksi/SOP baru, perjanjian kerja sama pihak ketiga, serta pemenuhan parameter evaluasi kinerja BPKP.',
    complianceImpactScore: 5,
    complexityScore: 3,
    recommendedQuarter: 'Q4',
    defaultRiskFallback: 3,
    defaultMaterialityFallback: 3,
  },
];

export function buildStandardAuditUniverseCatalog(params: {
  year: number;
  units: Unit[];
  risks: RiskRegister[];
  rkaItems: RKAItem[];
  findings: Finding[];
  auditReports: AuditReport[];
  wbsReports: WBSReport[];
  existingCodes: Set<string>;
  createdBy: string;
}): AuditUniverseItem[] {
  const {
    year,
    units,
    risks,
    rkaItems,
    findings,
    auditReports,
    wbsReports,
    existingCodes,
    createdBy,
  } = params;

  const nowIso = new Date().toISOString();
  const createdItems: AuditUniverseItem[] = [];

  const findMatchingUnit = (keywords: string[]): Unit | undefined => {
    for (const kw of keywords) {
      const hit = units.find((u) => u.name.toLowerCase().includes(kw.toLowerCase()));
      if (hit) return hit;
    }
    return units[0];
  };

  // 1. Core Functional / Cross-Department BUMD Air Minum Processes
  CORE_BUMD_PROCESS_BLUEPRINTS.forEach((bp, idx) => {
    if (existingCodes.has(bp.code)) return;
    const matchedUnit = findMatchingUnit(bp.unitKeywords);
    const unitId = matchedUnit?.id || 'unit-pusat';
    const unitName = matchedUnit?.name || 'Kantor Pusat Perumda';

    const live = computeLiveMetricsForUnit({
      unitId,
      unitName,
      year,
      risks,
      rkaItems,
      findings,
      auditReports,
      wbsReports,
    });

    const riskFactorScore = risks.some((r) => r.unitId === unitId)
      ? live.riskFactorScore
      : bp.defaultRiskFallback;
    const materialityScore = rkaItems.some((r) => r.unitId === unitId)
      ? live.materialityScore
      : bp.defaultMaterialityFallback;

    const compositeScore = computeAuditUniverseCompositeScore({
      riskFactorScore,
      materialityScore,
      controlHistoryScore: live.controlHistoryScore,
      complianceImpactScore: bp.complianceImpactScore,
      complexityScore: bp.complexityScore,
    });
    const derived = deriveRiskTierAndCycle(compositeScore);

    createdItems.push({
      id: `au-${bp.code.toLowerCase()}-${year}-${idx + 1}`,
      code: bp.code,
      year,
      entityName: bp.entityName,
      category: bp.category,
      unitId,
      unitName,
      businessProcess: bp.businessProcess,
      regulatoryBasis: bp.regulatoryBasis,
      defaultAuditType: bp.defaultAuditType,
      auditObjectiveTemplate: bp.objectiveTemplate,
      auditScopeTemplate: bp.scopeTemplate,
      riskFactorScore,
      materialityScore,
      controlHistoryScore: live.controlHistoryScore,
      complianceImpactScore: bp.complianceImpactScore,
      complexityScore: bp.complexityScore,
      compositeScore,
      riskTier: derived.riskTier,
      recommendedFrequency: derived.recommendedFrequency,
      recommendedQuarter: bp.recommendedQuarter,
      estimatedDays: derived.estimatedDays,
      lastAuditYear: live.lastAuditYear,
      lastAuditDate: live.lastAuditDate,
      lastAuditOpinion: live.lastAuditOpinion,
      openFindingsCount: live.openFindingsCount,
      linkedRkaBudget: live.linkedRkaBudget,
      isActive: true,
      notes: 'Objek Audit Standar BUMD Air Minum berdasarkan GIAS 2024, PP 54/2017 & Permendagri 23/2024.',
      createdBy,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  // 2. Service Branch Units (UNIT_PELAYANAN) from Master Units
  const serviceUnits = units.filter((u) => u.category === 'UNIT_PELAYANAN' && u.isActive);
  serviceUnits.forEach((u, idx) => {
    const code = `AU-${(u.code || `UP-${idx + 1}`).toUpperCase()}`;
    if (existingCodes.has(code)) return;

    const live = computeLiveMetricsForUnit({
      unitId: u.id,
      unitName: u.name,
      year,
      risks,
      rkaItems,
      findings,
      auditReports,
      wbsReports,
    });

    const quarterRotation: Array<'Q1' | 'Q2' | 'Q3' | 'Q4'> = ['Q1', 'Q2', 'Q3', 'Q4'];
    const recommendedQuarter = quarterRotation[idx % 4];
    const complianceImpactScore = 4;
    const complexityScore = 3;

    const compositeScore = computeAuditUniverseCompositeScore({
      riskFactorScore: live.riskFactorScore,
      materialityScore: live.materialityScore,
      controlHistoryScore: live.controlHistoryScore,
      complianceImpactScore,
      complexityScore,
    });
    const derived = deriveRiskTierAndCycle(compositeScore);

    createdItems.push({
      id: `au-${(u.code || `up-${idx + 1}`).toLowerCase().replace(/[^a-z0-9]/g, '-')}-${year}`,
      code,
      year,
      entityName: `Audit Kinerja & Operasional Cabang: ${u.name}`,
      category: 'Unit Pelayanan / Cabang',
      unitId: u.id,
      unitName: u.name,
      businessProcess: 'Baca Meter, Penagihan Rekening Air, Kas Loket, Sambungan Baru & NRW Cabang',
      regulatoryBasis: 'Permendagri No. 23/2024; PP No. 54/2017; Pedoman Pengawasan Cabang SPI',
      defaultAuditType: 'Audit Pelayanan Pelanggan',
      auditObjectiveTemplate: `Menilai ketertiban administrasi kas loket, akurasi baca meter, pencapaian penagihan, serta penanganan pengaduan pelanggan pada ${u.name}.`,
      auditScopeTemplate: `Operasional pelayanan pelanggan, kas penerimaan harian, piutang pelanggan, stok meteran air & berita acara sambungan baru pada ${u.name}.`,
      riskFactorScore: live.riskFactorScore,
      materialityScore: live.materialityScore,
      controlHistoryScore: live.controlHistoryScore,
      complianceImpactScore,
      complexityScore,
      compositeScore,
      riskTier: derived.riskTier,
      recommendedFrequency: derived.recommendedFrequency,
      recommendedQuarter,
      estimatedDays: Math.min(10, derived.estimatedDays),
      lastAuditYear: live.lastAuditYear,
      lastAuditDate: live.lastAuditDate,
      lastAuditOpinion: live.lastAuditOpinion,
      openFindingsCount: live.openFindingsCount,
      linkedRkaBudget: live.linkedRkaBudget,
      isActive: true,
      notes: `Wilayah pelayanan: ${u.location || 'Kabupaten Pasaman'}. Penanggung jawab: ${u.headName || 'Kepala Unit'}.`,
      createdBy,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  return createdItems;
}

export function isEntityScheduledInPkpt(
  entity: AuditUniverseItem,
  pkptList: PKPT[],
  year: number
): PKPT | undefined {
  return pkptList.find(
    (p) =>
      p.year === year &&
      (p.auditUniverseId === entity.id ||
        (p.auditUniverseCode && p.auditUniverseCode === entity.code) ||
        p.title.toLowerCase().includes(entity.entityName.toLowerCase()))
  );
}
