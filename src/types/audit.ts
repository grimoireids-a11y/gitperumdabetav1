export type UserRole =
  | 'KEPALA_SPI'
  | 'AUDITOR'
  | 'AUDITOR_EKSTERNAL'
  | 'BIDANG_KEUANGAN'
  | 'DIREKTUR'
  | 'DEWAN_PENGAWAS'
  | 'AUDITEE'
  | 'ADMIN_SISTEM'
  | 'VIEWER';

export interface UserProfile {
  uid: string;
  email: string;
  username?: string;
  password?: string;
  displayName: string;
  role: UserRole;
  unitId?: string;
  unitName?: string;
  nip?: string;
  phone?: string;
  isActive: boolean;
  approvalStatus?: 'APPROVED' | 'PENDING' | 'REJECTED';
  createdAt: string;
}

export type UnitCategory = 'PIMPINAN' | 'PENGAWASAN' | 'BIDANG' | 'UNIT_PELAYANAN';

export interface Unit {
  id: string;
  name: string;
  code: string;
  category: UnitCategory;
  headName?: string;
  location?: string;
  isActive: boolean;
}

export type RiskLevel = 'Sangat Rendah' | 'Rendah' | 'Sedang' | 'Tinggi' | 'Sangat Tinggi' | 'Ekstrem';
export type ControlEffectiveness = 'Efektif' | 'Sebagian Efektif' | 'Tidak Efektif';
export type RiskTreatmentOption = 'Mengurangi (Reduce)' | 'Menghindari (Avoid)' | 'Memindahkan (Transfer)' | 'Menerima (Accept)';
export type RiskCause5M = 'MAN (SDM)' | 'MONEY (Keuangan)' | 'MATERIAL (Bahan)' | 'MACHINE (Peralatan & Bangunan)' | 'METHODE (Kebijakan & SOP)';
export type RiskDimension = 'Dimensi Waktu' | 'Dimensi Kualitas' | 'Dimensi Keselamatan/Keamanan';
export type RiskImpactArea = 'Beban Keuangan (Finansial)' | 'Penurunan Reputasi' | 'Penundaan Layanan (SOP)' | 'Dampak K3 / Keselamatan' | 'Dampak Lingkungan' | 'Tuntutan Hukum';

export interface RiskRegister {
  id: string;
  code: string;
  year: number;
  unitId: string;
  unitName: string;
  objective?: string;           // Sasaran/Tujuan unit kerja (Kaidah SPIP)
  businessProcess: string;
  category: string;             // 8 Kategori Risiko SPIP
  dimension?: RiskDimension;    // 3 Dimensi SPIP (Waktu, Kualitas, Keselamatan/Keamanan)
  causeCategory5M?: RiskCause5M;// Akar Masalah 5M (MAN, MONEY, MATERIAL, MACHINE, METHODE)
  cause: string;
  event: string;                // Peristiwa Risiko (Kaidah SPIP: penghambat tujuan, bukan penyebab/dampak)
  impactArea?: RiskImpactArea;  // Area Dampak Risiko
  impactDesc: string;
  existingControl: string;
  likelihood: number;           // 1 - 5 (Kriteria Frekuensi/Persentase SPIP)
  impact: number;               // 1 - 5 (Kriteria Kerugian/Penundaan Layanan SPIP)
  inherentScore: number;        // likelihood * impact (1 - 25)
  inherentLevel: RiskLevel;
  controlEffectiveness: ControlEffectiveness;
  residualLikelihood: number;
  residualImpact: number;
  residualScore: number;
  residualLevel: RiskLevel;
  treatmentOption?: RiskTreatmentOption; // Mengurangi / Menghindari / Memindahkan / Menerima
  mitigationPlan: string;
  pic: string;
  targetDate: string;
  status: 'Identifikasi' | 'Mitigasi' | 'Selesai';
  // Peran Evaluasi SPI (Evaluasi atas Proses Manajemen Risiko Korporat)
  spiReviewStatus?: 'Diusulkan Auditee' | 'Sesuai Kaidah' | 'Perlu Perbaikan Kaidah';
  spiReviewNotes?: string;
  spiEvaluatedBy?: string;
  spiEvaluatedAt?: string;
  createdBy: string;
  createdAt?: string;
}

export type RKACategory = string;

export const DEFAULT_RKA_CATEGORIES = [
  'Operasional & Produksi',
  'Distribusi & Pemeliharaan',
  'Investasi & Infrastruktur',
  'Administrasi & Umum',
  'Keuangan & Penagihan',
  'Pengembangan SDM & Tata Kelola',
] as const;

export interface RKACategoryItem {
  id: string;
  name: string;
  order?: number;
  isDefaultSeed?: boolean;
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export type RKAStatus = 'Usulan' | 'Disetujui RKAP' | 'Berjalan' | 'Selesai';

export type RKAVerificationStatus =
  | 'Menunggu Verifikasi'
  | 'Terverifikasi Keuangan'
  | 'Perlu Revisi';

export interface RKAItem {
  id: string;
  year: number;
  code: string;
  unitId: string;
  unitName: string;
  programName: string;
  category: RKACategory;
  budgetAmount: number;
  realizationAmount?: number;
  realizationDate?: string;
  strategicPriority: 'Tinggi' | 'Sedang' | 'Rendah';
  executionMonth?: string;
  targetQuarter?: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  pic: string;
  notes?: string;
  status: RKAStatus;
  verificationStatus?: RKAVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationNotes?: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RKASubItem {
  id: string;
  parentRkaId: string;
  parentRkaCode: string;
  year: number;
  subCode: string;
  programName: string;
  executionMonth: string;
  allocatedBudget: number;
  realizationAmount: number;
  realizationDate?: string;
  pic: string;
  notes?: string;
  status: RKAStatus;
  verificationStatus: RKAVerificationStatus;
  verifiedBy?: string;
  verifiedAt?: string;
  verificationNotes?: string;
  createdBy?: string;
  createdByRole?: UserRole;
  createdAt?: string;
  updatedAt?: string;
}

export interface PKPT {
  id: string;
  year: number;
  title: string;
  unitId: string;
  unitName: string;
  businessProcess: string;
  riskScore: number;
  priorityScore: number;
  priorityRank?: string;
  auditType: string;
  objective: string;
  scope: string;
  estimatedDays: number;
  executionMonth?: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  status: 'Rencana' | 'Berlangsung' | 'Selesai';
  approvalStatus: 'Draft' | 'Disetujui' | 'Ditolak';
  approvedBy?: string;
  approvedAt?: string;
  manualOverrideReason?: string;
  // Integrasi RKA (Rencana Kerja dan Anggaran)
  rkaId?: string;
  rkaCode?: string;
  rkaProgramName?: string;
  rkaBudget?: number;
  rkaWeightScore?: number;
  // Integrasi Audit Universe
  auditUniverseId?: string;
  auditUniverseCode?: string;
  auditUniverseName?: string;
}

export type AuditUniverseCategory =
  | 'Unit Pelayanan / Cabang'
  | 'Proses Bisnis Operasional'
  | 'Fungsi Keuangan & Aset'
  | 'Proyek / Investasi RKA'
  | 'Sistem TI & Data'
  | 'Tata Kelola & Kepatuhan';

export type AuditCycleFrequency =
  | 'Tahunan (1 Tahun)'
  | 'Dua Tahunan (2 Tahun)'
  | 'Tiga Tahunan (3 Tahun)'
  | 'Tematik / Ad-Hoc';

export type AuditUniverseRiskTier =
  | 'Sangat Tinggi (P1)'
  | 'Tinggi (P2)'
  | 'Sedang (P3)'
  | 'Rendah (P4)';

export interface AuditUniverseItem {
  id: string;
  code: string;
  year: number;
  entityName: string;
  category: AuditUniverseCategory;
  unitId: string;
  unitName: string;
  businessProcess: string;
  regulatoryBasis: string;
  defaultAuditType: string;
  auditObjectiveTemplate: string;
  auditScopeTemplate: string;
  // 5-Factor Risk-Based Audit Scoring (scale 1 - 5)
  riskFactorScore: number;        // 30%: Residual Risk Profile
  materialityScore: number;       // 25%: RKA / Financial Materiality
  controlHistoryScore: number;    // 20%: Time Since Last Audit + Open 5C/WBS
  complianceImpactScore: number;  // 15%: Regulatory & Public Service Impact
  complexityScore: number;        // 10%: Process/IT/Change Complexity
  compositeScore: number;         // 0 - 100 weighted composite score
  riskTier: AuditUniverseRiskTier;
  recommendedFrequency: AuditCycleFrequency;
  recommendedQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  estimatedDays: number;
  lastAuditYear?: number;
  lastAuditDate?: string;
  lastAuditOpinion?: string;
  openFindingsCount?: number;
  linkedRkaBudget?: number;
  isActive: boolean;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SPIProgram {
  id: string;
  year: number;
  activityName: string;
  target: string;
  executionMonth?: string;
  schedule: string;
  pic: string;
  budget: number;
  kpi: string;
  realization: string;
  status: 'Belum Dimulai' | 'Dalam Proses' | 'Terealisasi';
}

export interface AuditAssignment {
  id: string;
  letterNumber: string;
  letterDate: string;
  basis: string;
  objectName: string;
  unitId: string;
  unitName: string;
  auditType: string;
  supervisor: string;
  teamLeader: string;
  teamMembers: string;
  objective: string;
  scope: string;
  startDate: string;
  endDate: string;
  status: 'Diterbitkan' | 'Berlangsung' | 'Selesai';
}

export interface AuditProgramStep {
  id: string;
  assignmentId: string;
  stepNumber: number;
  testObjective: string;
  testRisk: string;
  testControl: string;
  procedure: string;
  requiredDocs: string;
  testMethod: string;
  sampleSize: string;
  auditor: string;
  workPaperRef: string;
  status: 'Belum Dilaksanakan' | 'Sedang Berjalan' | 'Selesai';
}

export type KKAStatus = 'Draft' | 'Submitted' | 'Reviewed' | 'Approved';

export interface WorkPaper {
  id: string;
  assignmentId: string;
  assignmentTitle?: string;
  kkaNumber: string;
  title: string;
  auditProgramRef?: string;
  objective: string;
  auditBasis: string;
  procedure: string;
  testedData: string;
  sampleSize: string;
  testResult: string;
  evidenceRef: string;
  analysis: string;
  conclusion: string;
  crossRefs: string;
  preparer: string;
  reviewer?: string;
  status: KKAStatus;
  isLocked: boolean;
  reviewerNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type FindingRiskLevel = 'Rendah' | 'Sedang' | 'Tinggi' | 'Kritis';
export type FindingStatus = 'Draft' | 'Disetujui' | 'Tindak Lanjut' | 'Selesai';

export interface Finding {
  id: string;
  findingNumber: string;
  year: number;
  assignmentId: string;
  assignmentTitle?: string;
  unitId: string;
  unitName: string;
  title: string;
  category: string;
  riskLevel: FindingRiskLevel;
  condition: string;
  criteria: string;
  cause: string;
  consequence: string;
  potentialLoss: number;
  auditorAnalysis: string;
  auditeeResponse?: string;
  status: FindingStatus;
  sourceType?: 'AUDIT_REGULER' | 'WBS' | 'LHA' | 'AUDITOR_EKSTERNAL';
  externalAuditorAgency?: string;
  createdBy?: string;
  createdByUid?: string;
  createdByRole?: UserRole;
  wbsReportId?: string;
  wbsTicketNumber?: string;
  wbsResultId?: string;
  createdAt: string;
}

export type RecommendationStatus =
  | 'Belum Ditindaklanjuti'
  | 'Dalam Proses'
  | 'Menunggu Verifikasi'
  | 'Selesai'
  | 'Tidak Dapat Ditindaklanjuti';

export interface Recommendation {
  id: string;
  findingId: string;
  findingNumber?: string;
  findingTitle?: string;
  unitId?: string;
  unitName?: string;
  sourceType?: 'AUDIT_REGULER' | 'WBS' | 'LHA' | 'AUDITOR_EKSTERNAL';
  createdByUid?: string;
  recNumber: string;
  description: string;
  pic: string;
  targetDate: string;
  successIndicator: string;
  status: RecommendationStatus;
}

export interface FollowUp {
  id: string;
  recommendationId: string;
  unitId: string;
  unitName?: string;
  responseNotes: string;
  actionSteps?: string;
  progressPercent?: number;
  actionDate?: string;
  picName?: string;
  evidenceFileName?: string;
  evidenceFileUrl?: string; // Tautan / link bukti aksi unit kerja
  evidenceDriveFileId?: string; // Opsional (kompatibilitas data lama)
  evidenceFolderUrl?: string; // Opsional (kompatibilitas data lama)
  evidenceDataUrl?: string; // Data URL lokal (opsional/kompatibilitas data lama)
  submittedBy: string;
  submittedAt: string;
  verificationNotes?: string;
  verifier?: string;
  verifiedAt?: string;
  status: 'Diajukan' | 'Disetujui' | 'Ditolak';
}

export interface Investigation {
  id: string;
  caseNumber: string;
  title: string;
  source: string;
  receiptDate: string;
  unitId: string;
  unitName: string;
  suspectedModus: string;
  estimatedLoss: number;
  riskLevel: 'Sedang' | 'Tinggi' | 'Kritis';
  chronology: string;
  initialAnalysis: string;
  decision: string;
  status: 'Registrasi' | 'Penelaahan' | 'Audit Investigatif' | 'Laporan Akhir' | 'Selesai';
  isConfidential: boolean;
  leadInvestigator: string;
  createdAt: string;
}

export interface Regulation {
  id: string;
  title: string;
  regNumber: string;
  year: number;
  category: 'UU/PP/Permen' | 'Perdir' | 'SOP' | 'SK Direksi' | 'Standar Audit' | 'Perjanjian/Kontrak';
  about: string;
  riskArticles: string;
  recommendation: string;
  status: 'Berlaku' | 'Dalam Review' | 'Dicabut';
}

export interface OfficialSignatory {
  id: string;
  name: string;      // 1. Nama
  nip: string;       // 2. NIP
  position: string;  // 3. Jabatan
  department?: string;
  order?: number;
  isActive?: boolean;
  digitalSignatureUrl?: string; // Data URL Base64 tanda tangan (gambar / canvas)
  signatureType?: 'canvas' | 'upload' | 'qr';
  signatureToken?: string;      // Kode / Hash verifikasi naskah dinas resmi
  signatureDate?: string;
}

export interface DocumentSignatureConfig {
  location: string;
  date: string;
  signatory1: OfficialSignatory;
  signatory2?: OfficialSignatory;
  signatory3?: OfficialSignatory;
  showSignatory2?: boolean;
  showSignatory3?: boolean;
  signatory1RoleLabel?: string;
  signatory2RoleLabel?: string;
  signatory3RoleLabel?: string;
}

export type AuditOpinion =
  | 'Sangat Baik (Tanpa Catatan)'
  | 'Efektif (Dengan Catatan Minor)'
  | 'Cukup Efektif (Perlu Perbaikan Signifikan)'
  | 'Kurang Efektif (Kelemahan Kritis)'
  | 'Tidak Efektif (Gagal Sistem)';

export type AuditReportStatus =
  | 'Draft'
  | 'Review Pengendali Teknis'
  | 'Persetujuan Kepala SPI'
  | 'Final / Diterbitkan ke Direktur';

export interface AuditReport {
  id: string;
  reportNumber: string;
  reportDate: string;
  assignmentId: string;
  assignmentNumber?: string;
  auditTitle: string;
  unitId: string;
  unitName: string;
  auditPeriod: string;
  auditType: string;
  supervisor: string;
  teamLeader: string;
  teamMembers: string;

  executiveSummary: string;
  backgroundAndBasis: string;
  auditScope: string;
  generalOverview: string;
  internalControlEvaluation: string;
  keyFindingsSummary: string;
  auditOpinion: AuditOpinion;
  overallConclusion: string;
  strategicRecommendations: string;
  managementCommitment: string;

  status: AuditReportStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  syncedToFindings?: boolean;
  syncedFindingsCount?: number;
  syncedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type BPKPKinerjaAspect = 'KEUANGAN' | 'PELAYANAN' | 'OPERASIONAL' | 'SDM';

export type BPKPKategoriKinerja =
  | 'SEHAT - BAIK SEKALI'
  | 'SEHAT - BAIK'
  | 'SEHAT - CUKUP'
  | 'KURANG SEHAT'
  | 'SAKIT';

export type SPIPMaturityLevel =
  | 'Level 1 - Rintisan'
  | 'Level 2 - Berkembang'
  | 'Level 3 - Terdefinisi'
  | 'Level 4 - Terkelola & Terukur'
  | 'Level 5 - Optimum';

export interface BPKPIndicatorAssessment {
  id: string;
  aspect: BPKPKinerjaAspect;
  code: string;
  name: string;
  formulaDesc: string;
  weight: number;
  targetValue: number;
  actualValue: number;
  unitMeasurement: string;
  score: number; // 1 to 5
  weightedScore: number;
  evidenceRef: string;
  notes: string;
  spiVerificationNotes?: string;
}

export interface SPIPElementAssessment {
  id: string;
  elementNumber: number; // 1 to 5
  elementName: string; // Lingkungan Pengendalian, Penilaian Risiko, Kegiatan Pengendalian, Informasi & Komunikasi, Pemantauan
  subElementCode: string;
  subElementName: string;
  bpkpCriteria: string;
  selfRating: number; // 1 to 5
  evidenceRef: string;
  improvementPlan: string;
  spiReviewRating?: number;
  spiVerificationNotes?: string;
}

export interface BPKPSelfAssessment {
  id: string;
  year: number;
  assessmentTitle: string;
  assessmentDate: string;
  evaluatorName: string;
  evaluatorRole: string;
  status: 'Draft' | 'Verifikasi SPI' | 'Disetujui Direktur' | 'Final Terverifikasi';
  // Kinerja SPIP Metrics
  kinerjaScore: number; // 1.00 - 5.00
  kinerjaCategory: BPKPKategoriKinerja;
  aspectScores: {
    keuangan: number;
    pelayanan: number;
    operasional: number;
    sdm: number;
  };
  indicators: BPKPIndicatorAssessment[];
  // SPIP Maturity Metrics
  spipMaturityScore: number; // 1.00 - 5.00
  spipMaturityLevel: SPIPMaturityLevel;
  spipElements: SPIPElementAssessment[];
  // AI Diagnostic & Recommendations
  aiExecutiveSummary?: string;
  aiStrategicRecommendations?: string;
  // Verification & Approval
  verifiedBy?: string;
  verifiedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type RiskProfileStatus = 'Draft' | 'Ditetapkan Kepala SPI' | 'Disetujui Direksi';

export interface RiskProfileConfig {
  id: string;
  year: number;
  appetiteThreshold: number;
  extremeToleranceCount: number;
  targetControlEffectivenessPct: number;
  targetMitigationCompletionPct: number;
  appetiteStatement: string;
  priorityFocusNote: string;
  kepalaSpiConclusion: string;
  strategicDirection: string;
  priorityRiskIds: string[];
  status: RiskProfileStatus;
  snapshotMetrics?: {
    totalRisks: number;
    avgInherent: number;
    avgResidual: number;
    reductionPct: number;
    aboveAppetiteCount: number;
    effectiveControlPct: number;
    spipRiskMaturity: number;
    snapshotAt: string;
  };
  updatedBy: string;
  updatedAt: string;
}

export type RiskAnnualReportStatus =
  | 'Draft'
  | 'Final / Disahkan Kepala SPI'
  | 'Disampaikan ke Direksi & Dewas';

export interface RiskAnnualReport {
  id: string;
  year: number;
  reportNumber: string;
  reportTitle: string;
  reportDate: string;
  preparedBy: string;
  recipient: string;
  appetiteThreshold: number;
  executiveSummaryNarrative: string;
  contextAndGovernanceNarrative: string;
  categoryAndHeatmapAnalysis: string;
  unitExposureAnalysis: string;
  mitigationAndControlEvaluation: string;
  spipPkptIntegrationAnalysis: string;
  conclusionAndChallenges: string;
  nextYearRoadmapNarrative: string;
  status: RiskAnnualReportStatus;
  approvedBy?: string;
  approvedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type SPIPeriodicType = 'BULANAN' | 'TAHUNAN';

export type SPIPeriodicReportStatus =
  | 'Draft'
  | 'Review Kepala SPI'
  | 'Disahkan & Disampaikan ke Direksi';

export interface SPIPeriodicReport {
  id: string;
  periodType: SPIPeriodicType;
  year: number;
  month?: number; // 1-12 for BULANAN
  reportNumber: string;
  reportTitle: string;
  reportDate: string;
  preparedBy: string;
  recipient: string;
  executiveSummary: string;
  pkptAndProgramRealization: string;
  auditExecutionSummary: string;
  findingsAndFollowUpSummary: string;
  investigationAndComplianceSummary: string;
  constraintsAndRecommendations: string;
  nextPeriodPlan: string;
  status: SPIPeriodicReportStatus;
  approvedBy?: string;
  approvedAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// =========================================================================
// WHISTLEBLOWING SYSTEM (WBS) TYPES
// =========================================================================

export type WBSIdentityMode = 'IDENTITAS' | 'ANONIM';

export type WBSReportStatus =
  | 'Diterima'
  | 'Verifikasi & Penelaahan'
  | 'Surat Tugas Diterbitkan'
  | 'Dalam Pemeriksaan WBS'
  | 'Laporan Hasil Selesai'
  | 'Menjadi Temuan 5C'
  | 'Tidak Terbukti / Diarsipkan';

export type WBSViolationCategory =
  | 'Korupsi, Suap & Gratifikasi'
  | 'Penggelapan Kas / Aset'
  | 'Rekayasa Penagihan & Meter Air'
  | 'Penyalahgunaan Wewenang & Nepotisme'
  | 'Kecurangan Pengadaan Barang/Jasa'
  | 'Pelanggaran SOP & Kode Etik'
  | 'Lainnya';

export interface WBSEvidenceAttachment {
  id: string;
  kind: 'LINK' | 'DOCUMENT' | 'PHOTO';
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  linkUrl?: string;
  inlineDataUrl?: string;
  chunkIds?: string[];
  uploadedAt: string;
}

export interface WBSTimelineEntry {
  id: string;
  timestamp: string;
  stage: string;
  status: string;
  publicNote: string;
  actor: string;
}

export interface WBSClarificationMessage {
  id: string;
  sender: 'PELAPOR' | 'SPI';
  message: string;
  attachmentLink?: string;
  createdAt: string;
}

export interface WBSReport {
  id: string;
  ticketNumber: string;
  year: number;
  month: number;
  identityMode: WBSIdentityMode;
  reporterName: string;
  reporterIdentityNumber?: string;
  reporterPhone?: string;
  reporterEmail?: string;
  category: WBSViolationCategory;
  title: string;
  reportedUnitId?: string;
  reportedUnitName: string;
  reportedParty: string;
  incidentDate: string;
  incidentLocation: string;
  chronology: string;
  estimatedLoss?: number;
  urgencyLevel: 'Sedang' | 'Tinggi' | 'Kritis';
  attachments: WBSEvidenceAttachment[];
  evidenceSummaryNote?: string;
  status: WBSReportStatus;
  triageNotes?: string;
  publicResponse?: string;
  slaDeadlineDate?: string;
  linkedAssignmentId?: string;
  linkedAssignmentNumber?: string;
  linkedWorkPaperId?: string;
  linkedResultId?: string;
  linkedFindingId?: string;
  linkedFindingNumber?: string;
  timeline: WBSTimelineEntry[];
  messages?: WBSClarificationMessage[];
  sourceChannel?: 'Portal WBS Publik' | 'Input Manual SPI';
  createdAt: string;
  updatedAt: string;
}

export interface WBSAssignment {
  id: string;
  wbsReportId: string;
  ticketNumber: string;
  year: number;
  letterNumber: string;
  letterDate: string;
  basis: string;
  assignmentTitle: string;
  unitId?: string;
  unitName: string;
  assignmentType:
    | 'Penelaahan Awal WBS'
    | 'Audit Investigatif WBS'
    | 'Klarifikasi & Verifikasi Lapangan WBS';
  confidentialityLevel: 'Rahasia' | 'Sangat Rahasia';
  supervisor: string;
  teamLeader: string;
  teamMembers: string;
  objective: string;
  scope: string;
  startDate: string;
  endDate: string;
  status: 'Diterbitkan' | 'Berlangsung' | 'Selesai';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WBSWorkPaper {
  id: string;
  wbsReportId: string;
  ticketNumber: string;
  wbsAssignmentId: string;
  wbsAssignmentNumber?: string;
  year: number;
  kkaNumber: string;
  title: string;
  procedure: string;
  evidenceVerified: string;
  interviewSummary: string;
  testResult: string;
  indicatedLoss: number;
  auditorAnalysis: string;
  conclusion:
    | 'Terbukti (Indikasi Kuat)'
    | 'Terbukti Sebagian / Kelemahan SOP'
    | 'Tidak Terbukti';
  preparer: string;
  reviewer?: string;
  reviewerNotes?: string;
  status: 'Draft' | 'Direviu' | 'Disetujui & Dikunci';
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WBSResultReport {
  id: string;
  wbsReportId: string;
  ticketNumber: string;
  wbsAssignmentId?: string;
  wbsAssignmentNumber?: string;
  wbsWorkPaperId?: string;
  year: number;
  reportNumber: string;
  reportDate: string;
  title: string;
  unitId: string;
  unitName: string;
  category: string;
  executiveSummary: string;
  examinationFacts: string;
  proofConclusion:
    | 'Terbukti - Menjadi Temuan 5C'
    | 'Terbukti - Pelanggaran Administratif/Disiplin'
    | 'Tidak Terbukti / Selesai';
  isFinding: boolean;
  riskLevel: FindingRiskLevel;
  condition: string;
  criteria: string;
  cause: string;
  consequence: string;
  potentialLoss: number;
  auditorAnalysis: string;
  recommendationText: string;
  recommendationPic: string;
  recommendationTargetDate: string;
  recommendationIndicator: string;
  status: 'Draft' | 'Final / Disahkan Kepala SPI';
  syncedToFindingId?: string;
  syncedFindingNumber?: string;
  syncedRecommendationId?: string;
  syncedAt?: string;
  preparedBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

// =========================================================================
// KEY PERFORMANCE INDICATORS (KPI) & CASCADING KINERJA BUMD AIR MINUM
// =========================================================================

export type KPIPerspective =
  | 'Keuangan'
  | 'Pelanggan dan Pelayanan'
  | 'Operasional'
  | 'Proses Bisnis Internal'
  | 'Pembelajaran dan Pertumbuhan';

export type KPIPolarity =
  | 'MAXIMIZE'     // Semakin tinggi semakin baik
  | 'MINIMIZE'     // Semakin rendah semakin baik (aman dari div-by-zero)
  | 'STABILIZE'    // Rentang optimal (min - max)
  | 'ZERO_TARGET'  // Target nol / zero-defect dengan penalti terukur
  | 'MILESTONE';   // Kualitatif / Skala maturitas / Tahapan milestone

export type KPIAccumulationType =
  | 'CUMULATIVE'   // Akumulasi / Penjumlahan sepanjang tahun berjalan
  | 'AVERAGE'      // Rata-rata capaian periode berjalan
  | 'LAST_VALUE';  // Nilai posisi terakhir (snapshot)

export type KPILevel =
  | 1 // KPI Perusahaan
  | 2 // KPI Direktur
  | 3 // KPI Bidang
  | 4 // KPI SubBidang/Unit
  | 5; // KPI Individu Pegawai

export type KPICascadeMethod =
  | 'Direct (Identik)'
  | 'Contributory (Kontribusi)'
  | 'Driver (Pengungkit / Leading)'
  | 'Specific (Fungsional Unit)';

export type KPIFrequency = 'Bulanan' | 'Triwulanan' | 'Semesteran' | 'Tahunan';

export type KPIApprovalStatus = 'Draft' | 'Diajukan' | 'Disahkan Kontrak Kinerja' | 'Direvisi';

export type KPISPIVerificationStatus = 'Belum Diverifikasi' | 'Terverifikasi SPI' | 'Perlu Klarifikasi';

export type KPIActionStatus = 'Belum Dimulai' | 'Dalam Proses' | 'Selesai';

export interface KPIItem {
  id: string;
  code: string;
  year: number;
  perspective: KPIPerspective;
  strategicObjective: string;
  name: string;
  indicatorType: 'Lagging (Hasil)' | 'Leading (Penggerak)';
  level: KPILevel;
  parentKpiId?: string;
  parentKpiCode?: string;
  cascadeMethod: KPICascadeMethod;
  unitId?: string;
  unitName: string;
  ownerRole: string; // Contoh: Direktur Utama, Direktur Teknik, Kabag Distribusi, Kasubag Pemeliharaan, Teknisi
  picName: string;
  // Kamus KPI (KPI Dictionary)
  operationalDefinition: string;
  formula: string;
  unitMeasurement: string; // %, Rp, Jam/Hari, m3, Skor, Kasus, kWh/m3
  polarity: KPIPolarity;
  accumulationType: KPIAccumulationType;
  baselineValue: number;
  targetValue: number;
  rangeMin?: number; // Khusus polaritas STABILIZE
  rangeMax?: number; // Khusus polaritas STABILIZE
  zeroPenaltyStep?: number; // Khusus polaritas ZERO_TARGET (pengurangan % per kejadian)
  weight: number; // % bobot pada tingkat/pemilik terkait
  capMaxPct: number; // Batas atas capaian (umumnya 110% atau 120%)
  floorMinPct: number; // Batas bawah capaian (umumnya 0%)
  isGating?: boolean; // Indikator wajib (contoh: Baku Mutu Kualitas Air) yang tidak boleh dikompromikan
  gatingThresholdPct?: number; // Batas minimal capaian agar predikat organisasi tidak ditahan
  dataSource: string;
  frequency: KPIFrequency;
  evidenceRequired: string;
  targetBasisNote?: string; // Analisis dasar penetapan target (tren 3 thn, Renbis, RKA, regulasi)
  // Integrasi Renbis / RKA / Risiko SPI
  linkedRkaCode?: string;
  linkedRiskCode?: string;
  approvalStatus: KPIApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  changeReason?: string; // Catatan tata kelola perubahan KPI (Bab VIII 8.3)
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface KPIMeasurement {
  id: string;
  kpiId: string;
  kpiCode: string;
  year: number;
  periodType: 'Bulanan' | 'Triwulanan' | 'Tahunan';
  periodIndex: number; // 1..12 untuk Bulanan, 1..4 untuk Triwulanan, 1 untuk Tahunan
  periodLabel: string; // e.g., "Jan 2026", "Q1 2026", "Tahunan 2026"
  realizationValue: number;
  rawAchievementPct: number;
  cappedAchievementPct: number;
  weightedScore: number;
  trafficLight: 'HIJAU' | 'KUNING' | 'MERAH';
  evidenceNote?: string;
  evidenceUrl?: string;
  submittedBy: string;
  submittedAt: string;
  // Pengendalian Kualitas Data oleh SPI (Bab VII 7.2)
  spiVerificationStatus: KPISPIVerificationStatus;
  spiVerificationNote?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  // Evaluasi Kesenjangan & Rencana Aksi (Bab VI 6.3 & VII 7.3)
  rootCauseAnalysis?: string;
  actionPlan?: string;
  actionPic?: string;
  actionDeadline?: string;
  actionBudget?: number;
  actionExpectedOutcome?: string;
  actionStatus?: KPIActionStatus;
  updatedAt: string;
}

export interface KPIChecklistItem {
  id: string;
  year: number;
  itemNumber: number; // 1..17
  componentName: string;
  pedomanRef: string;
  requiredArtifact: string;
  status: 'Ada' | 'Sebagian' | 'Tidak';
  evidenceLocation: string;
  notes: string;
  updatedBy: string;
  updatedAt: string;
}

export interface KPISettings {
  id: string; // kpi-settings-{year}
  year: number;
  defaultCapMaxPct: number; // e.g., 120
  defaultFloorMinPct: number; // e.g., 0
  roundingDecimals: number; // e.g., 2
  greenThresholdPct: number; // >= 95
  yellowThresholdPct: number; // >= 80
  enforceGatingCap: boolean; // Jika KPI Gating gagal, predikat maksimal tertahan
  gatingMaxTotalScore: number; // e.g., 84.99
  perspectiveWeights: {
    keuangan: number;
    pelanggan: number;
    operasional: number;
    prosesBisnis: number;
    pembelajaran: number;
  };
  governanceNote: string;
  updatedBy: string;
  updatedAt: string;
}

