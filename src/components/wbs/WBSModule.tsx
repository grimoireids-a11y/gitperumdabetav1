import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileCheck2,
  FileText,
  Image as ImageIcon,
  Link2,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Printer,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Unlock,
  UserCheck,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { useAppBranding } from '../../context/AppBrandingContext';
import {
  Finding,
  FindingRiskLevel,
  Recommendation,
  Unit,
  WBSAssignment,
  WBSClarificationMessage,
  WBSEvidenceAttachment,
  WBSIdentityMode,
  WBSReport,
  WBSReportStatus,
  WBSResultReport,
  WBSTimelineEntry,
  WBSViolationCategory,
  WBSWorkPaper,
} from '../../types/audit';
import {
  WBS_ALLOWED_EXTENSIONS,
  WBS_MAX_FILE_SIZE_LABEL,
  WBS_VIOLATION_CATEGORIES,
  computeSlaDeadlineIso,
  formatBytes,
  generateWbsTicketNumber,
  persistWbsFileAttachment,
  PendingLocalWbsFile,
  readFileAsDataUrl,
  resolveWbsAttachmentDataUrl,
  validateWbsEvidenceFile,
} from '../../lib/wbsEvidenceHelper';
import { INITIAL_UNITS } from '../../data/initialData';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';
import { formatRupiahId } from '../../lib/riskAnalytics';

interface WBSModuleProps {
  onNavigateToFindings?: () => void;
}

type WbsSubTab = 'register' | 'assignment' | 'work_paper' | 'result';

const WBS_STATUS_OPTIONS: WBSReportStatus[] = [
  'Diterima',
  'Verifikasi & Penelaahan',
  'Surat Tugas Diterbitkan',
  'Dalam Pemeriksaan WBS',
  'Laporan Hasil Selesai',
  'Menjadi Temuan 5C',
  'Tidak Terbukti / Diarsipkan',
];

const getWbsStatusBadge = (status: WBSReportStatus) => {
  switch (status) {
    case 'Diterima':
      return 'bg-sky-100 text-sky-900 border-sky-200';
    case 'Verifikasi & Penelaahan':
      return 'bg-amber-100 text-amber-900 border-amber-300';
    case 'Surat Tugas Diterbitkan':
      return 'bg-indigo-100 text-indigo-900 border-indigo-200';
    case 'Dalam Pemeriksaan WBS':
      return 'bg-purple-100 text-purple-900 border-purple-200';
    case 'Menjadi Temuan 5C':
      return 'bg-rose-100 text-rose-900 border-rose-300';
    case 'Laporan Hasil Selesai':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

export const WBSModule: React.FC<WBSModuleProps> = ({ onNavigateToFindings }) => {
  const { userProfile, hasRole } = useAuth();
  const { activeYear, availableYears } = useFiscalYear();
  const { branding } = useAppBranding();

  const canManage = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);
  const isViewer = userProfile?.role === 'VIEWER';

  const [subTab, setSubTab] = useState<WbsSubTab>('register');
  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Firestore lists
  const [reports, setReports] = useState<WBSReport[]>([]);
  const [assignments, setAssignments] = useState<WBSAssignment[]>([]);
  const [workPapers, setWorkPapers] = useState<WBSWorkPaper[]>([]);
  const [results, setResults] = useState<WBSResultReport[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  // Detail & Triage modal state (Tab 1)
  const [activeReportForDetail, setActiveReportForDetail] = useState<WBSReport | null>(null);
  const [triageStatus, setTriageStatus] = useState<WBSReportStatus>('Verifikasi & Penelaahan');
  const [triageNotes, setTriageNotes] = useState('');
  const [triagePublicResponse, setTriagePublicResponse] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyLink, setReplyLink] = useState('');
  const [isSavingTriage, setIsSavingTriage] = useState(false);

  // Attachment Preview Modal state
  const [previewAttachment, setPreviewAttachment] = useState<{
    attachment: WBSEvidenceAttachment;
    dataUrl: string | null;
    loading: boolean;
    error?: string;
  } | null>(null);

  // Manual WBS Report Modal (Tab 1)
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manIdentityMode, setManIdentityMode] = useState<WBSIdentityMode>('IDENTITAS');
  const [manReporterName, setManReporterName] = useState('');
  const [manReporterPhone, setManReporterPhone] = useState('');
  const [manReporterEmail, setManReporterEmail] = useState('');
  const [manCategory, setManCategory] = useState<WBSViolationCategory>(WBS_VIOLATION_CATEGORIES[0]);
  const [manTitle, setManTitle] = useState('');
  const [manUnitId, setManUnitId] = useState('');
  const [manReportedParty, setManReportedParty] = useState('');
  const [manIncidentDate, setManIncidentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [manIncidentLocation, setManIncidentLocation] = useState('');
  const [manUrgency, setManUrgency] = useState<'Sedang' | 'Tinggi' | 'Kritis'>('Tinggi');
  const [manEstimatedLoss, setManEstimatedLoss] = useState<number>(0);
  const [manChronology, setManChronology] = useState('');
  const [manLinks, setManLinks] = useState<string[]>([]);
  const [manLinkInput, setManLinkInput] = useState('');
  const [manPendingFiles, setManPendingFiles] = useState<PendingLocalWbsFile[]>([]);
  const [manFileErr, setManFileErr] = useState<string | null>(null);
  const [isSavingManual, setIsSavingManual] = useState(false);

  // Assignment Modal (Tab 2)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [editingAssign, setEditingAssign] = useState<WBSAssignment | null>(null);
  const [asReportId, setAsReportId] = useState('');
  const [asLetterNumber, setAsLetterNumber] = useState('');
  const [asLetterDate, setAsLetterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [asBasis, setAsBasis] = useState('');
  const [asTitle, setAsTitle] = useState('');
  const [asType, setAsType] = useState<WBSAssignment['assignmentType']>('Penelaahan Awal WBS');
  const [asConfidentiality, setAsConfidentiality] = useState<'Rahasia' | 'Sangat Rahasia'>('Rahasia');
  const [asSupervisor, setAsSupervisor] = useState('');
  const [asTeamLeader, setAsTeamLeader] = useState('');
  const [asMembers, setAsMembers] = useState('');
  const [asObjective, setAsObjective] = useState('');
  const [asScope, setAsScope] = useState('');
  const [asStartDate, setAsStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [asEndDate, setAsEndDate] = useState(() =>
    new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  );
  const [asStatus, setAsStatus] = useState<WBSAssignment['status']>('Diterbitkan');

  // Work Paper Modal (Tab 3)
  const [isKkaModalOpen, setIsKkaModalOpen] = useState(false);
  const [editingKka, setEditingKka] = useState<WBSWorkPaper | null>(null);
  const [kkaAssignId, setKkaAssignId] = useState('');
  const [kkaNumber, setKkaNumber] = useState('');
  const [kkaTitle, setKkaTitle] = useState('');
  const [kkaProcedure, setKkaProcedure] = useState('');
  const [kkaEvidenceVerified, setKkaEvidenceVerified] = useState('');
  const [kkaInterviewSummary, setKkaInterviewSummary] = useState('');
  const [kkaTestResult, setKkaTestResult] = useState('');
  const [kkaIndicatedLoss, setKkaIndicatedLoss] = useState<number>(0);
  const [kkaAnalysis, setKkaAnalysis] = useState('');
  const [kkaConclusion, setKkaConclusion] = useState<WBSWorkPaper['conclusion']>('Terbukti (Indikasi Kuat)');
  const [kkaPreparer, setKkaPreparer] = useState('');
  const [kkaReviewerNotes, setKkaReviewerNotes] = useState('');
  const [kkaStatus, setKkaStatus] = useState<WBSWorkPaper['status']>('Draft');

  // Result Report & 5C Modal (Tab 4)
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [editingResult, setEditingResult] = useState<WBSResultReport | null>(null);
  const [resKkaId, setResKkaId] = useState('');
  const [resReportId, setResReportId] = useState('');
  const [resNumber, setResNumber] = useState('');
  const [resDate, setResDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [resTitle, setResTitle] = useState('');
  const [resExecSummary, setResExecSummary] = useState('');
  const [resFacts, setResFacts] = useState('');
  const [resProofConclusion, setResProofConclusion] =
    useState<WBSResultReport['proofConclusion']>('Terbukti - Menjadi Temuan 5C');
  const [resIsFinding, setResIsFinding] = useState(true);
  const [resRiskLevel, setResRiskLevel] = useState<FindingRiskLevel>('Tinggi');
  const [resCondition, setResCondition] = useState('');
  const [resCriteria, setResCriteria] = useState('');
  const [resCause, setResCause] = useState('');
  const [resConsequence, setResConsequence] = useState('');
  const [resPotentialLoss, setResPotentialLoss] = useState<number>(0);
  const [resAnalysis, setResAnalysis] = useState('');
  const [resRecText, setResRecText] = useState('');
  const [resRecPic, setResRecPic] = useState('');
  const [resRecTarget, setResRecTarget] = useState(() =>
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  );
  const [resRecIndicator, setResRecIndicator] = useState('');
  const [resStatus, setResStatus] = useState<WBSResultReport['status']>('Final / Disahkan Kepala SPI');

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<{
    collectionName: 'wbs_reports' | 'wbs_assignments' | 'wbs_work_papers' | 'wbs_results';
    id: string;
    label: string;
  } | null>(null);

  // Print Preview states
  const [printMode, setPrintMode] = useState<{
    kind: 'register' | 'assignment' | 'kka' | 'result';
    item?: WBSAssignment | WBSWorkPaper | WBSResultReport;
  } | null>(null);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  useEffect(() => {
    const unsubs = [
      onSnapshot(
        collection(db, 'wbs_reports'),
        (s) => {
          const data = s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSReport));
          data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          setReports(data);
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_reports')
      ),
      onSnapshot(
        collection(db, 'wbs_assignments'),
        (s) => {
          const data = s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSAssignment));
          data.sort((a, b) => (b.letterDate || b.createdAt || '').localeCompare(a.letterDate || a.createdAt || ''));
          setAssignments(data);
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_assignments')
      ),
      onSnapshot(
        collection(db, 'wbs_work_papers'),
        (s) => {
          const data = s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSWorkPaper));
          data.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
          setWorkPapers(data);
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_work_papers')
      ),
      onSnapshot(
        collection(db, 'wbs_results'),
        (s) => {
          const data = s.docs.map((d) => ({ id: d.id, ...d.data() } as WBSResultReport));
          data.sort((a, b) => (b.reportDate || b.createdAt || '').localeCompare(a.reportDate || a.createdAt || ''));
          setResults(data);
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'wbs_results')
      ),
      onSnapshot(
        collection(db, 'findings'),
        (s) => setFindings(s.docs.map((d) => ({ id: d.id, ...d.data() } as Finding))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'findings')
      ),
      onSnapshot(
        collection(db, 'recommendations'),
        (s) => setRecommendations(s.docs.map((d) => ({ id: d.id, ...d.data() } as Recommendation))),
        (e) => handleFirestoreError(e, OperationType.LIST, 'recommendations')
      ),
      onSnapshot(
        collection(db, 'units'),
        (s) => {
          if (s.empty) {
            setUnits(
              INITIAL_UNITS.map((u, idx) => ({ id: `unit-init-${idx + 1}`, ...u }))
            );
          } else {
            setUnits(s.docs.map((d) => ({ id: d.id, ...d.data() } as Unit)));
          }
        },
        (e) => handleFirestoreError(e, OperationType.LIST, 'units')
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Keep detail drawer in sync with live updates
  useEffect(() => {
    if (activeReportForDetail) {
      const updated = reports.find((r) => r.id === activeReportForDetail.id);
      if (updated) setActiveReportForDetail(updated);
    }
  }, [reports, activeReportForDetail?.id]);

  const showToast = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 5500);
  };

  const yearOptions = useMemo(() => {
    const docYears = reports.map((r) => r.year).filter((y) => typeof y === 'number' && y > 0);
    return Array.from(new Set([...availableYears, ...docYears])).sort((a, b) => b - a);
  }, [availableYears, reports]);

  const scopedReports = useMemo(() => {
    return reports.filter((r) => {
      const matchYear = selectedYear === 0 || r.year === selectedYear;
      const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        r.ticketNumber.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.reportedUnitName.toLowerCase().includes(q) ||
        r.reportedParty.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q);
      return matchYear && matchStatus && matchSearch;
    });
  }, [reports, selectedYear, statusFilter, searchQuery]);

  const scopedAssignments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return assignments.filter((a) => {
      const matchYear = selectedYear === 0 || a.year === selectedYear;
      const matchSearch =
        !q ||
        a.letterNumber.toLowerCase().includes(q) ||
        a.ticketNumber.toLowerCase().includes(q) ||
        a.assignmentTitle.toLowerCase().includes(q) ||
        a.unitName.toLowerCase().includes(q);
      return matchYear && matchSearch;
    });
  }, [assignments, selectedYear, searchQuery]);

  const scopedWorkPapers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return workPapers.filter((w) => {
      const matchYear = selectedYear === 0 || w.year === selectedYear;
      const matchSearch =
        !q ||
        w.kkaNumber.toLowerCase().includes(q) ||
        w.ticketNumber.toLowerCase().includes(q) ||
        w.title.toLowerCase().includes(q);
      return matchYear && matchSearch;
    });
  }, [workPapers, selectedYear, searchQuery]);

  const scopedResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return results.filter((r) => {
      const matchYear = selectedYear === 0 || r.year === selectedYear;
      const matchSearch =
        !q ||
        r.reportNumber.toLowerCase().includes(q) ||
        r.ticketNumber.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.unitName.toLowerCase().includes(q);
      return matchYear && matchSearch;
    });
  }, [results, selectedYear, searchQuery]);

  // KPIs
  const kpi = useMemo(() => {
    const yrReports = selectedYear === 0 ? reports : reports.filter((r) => r.year === selectedYear);
    const yrAssign = selectedYear === 0 ? assignments : assignments.filter((a) => a.year === selectedYear);
    const yrKka = selectedYear === 0 ? workPapers : workPapers.filter((w) => w.year === selectedYear);
    const yrRes = selectedYear === 0 ? results : results.filter((r) => r.year === selectedYear);

    const anonCount = yrReports.filter((r) => r.identityMode === 'ANONIM').length;
    const awaitingTriage = yrReports.filter(
      (r) => r.status === 'Diterima' || r.status === 'Verifikasi & Penelaahan'
    ).length;
    const kkaLocked = yrKka.filter((w) => w.isLocked || w.status === 'Disetujui & Dikunci').length;
    const convertedTo5C = yrRes.filter((r) => Boolean(r.syncedToFindingId)).length;

    return {
      totalReports: yrReports.length,
      anonCount,
      awaitingTriage,
      totalAssignments: yrAssign.length,
      totalKka: yrKka.length,
      kkaLocked,
      totalResults: yrRes.length,
      convertedTo5C,
    };
  }, [reports, assignments, workPapers, results, selectedYear]);

  // =========================================================================
  // ATTACHMENT VIEWER (resolves inline or chunked <= 2MB evidence)
  // =========================================================================
  const handleInspectAttachment = async (att: WBSEvidenceAttachment) => {
    if (att.kind === 'LINK' && att.linkUrl) {
      return;
    }
    setPreviewAttachment({ attachment: att, dataUrl: null, loading: true });
    try {
      const url = await resolveWbsAttachmentDataUrl(att);
      setPreviewAttachment({
        attachment: att,
        dataUrl: url,
        loading: false,
        error: url ? undefined : 'Konten berkas tidak tersedia.',
      });
    } catch (err) {
      setPreviewAttachment({
        attachment: att,
        dataUrl: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Gagal memuat lampiran.',
      });
    }
  };

  // =========================================================================
  // TAB 1: DETAIL, TRIAGE, TIMELINE & KLARIFIKASI
  // =========================================================================
  const openReportDetail = (rep: WBSReport) => {
    setActiveReportForDetail(rep);
    setTriageStatus(rep.status);
    setTriageNotes(rep.triageNotes || '');
    setTriagePublicResponse(rep.publicResponse || '');
    setReplyText('');
    setReplyLink('');
  };

  const handleSaveTriage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !activeReportForDetail) return;
    setIsSavingTriage(true);
    const nowIso = new Date().toISOString();
    const actor = userProfile?.displayName || 'Kepala SPI';

    const newTimeline = [...(activeReportForDetail.timeline || [])];
    if (
      triageStatus !== activeReportForDetail.status ||
      (triagePublicResponse.trim() && triagePublicResponse.trim() !== (activeReportForDetail.publicResponse || ''))
    ) {
      newTimeline.push({
        id: `tl-${Date.now()}`,
        timestamp: nowIso,
        stage: triageStatus,
        status: triageStatus,
        publicNote:
          triagePublicResponse.trim() ||
          `Status penanganan laporan diperbarui oleh SPI menjadi "${triageStatus}".`,
        actor,
      });
    }

    try {
      await updateDoc(doc(db, 'wbs_reports', activeReportForDetail.id), {
        status: triageStatus,
        triageNotes: triageNotes.trim(),
        publicResponse: triagePublicResponse.trim(),
        timeline: newTimeline,
        updatedAt: nowIso,
      });
      showToast('success', `Telaah tiket ${activeReportForDetail.ticketNumber} disimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `wbs_reports/${activeReportForDetail.id}`);
    } finally {
      setIsSavingTriage(false);
    }
  };

  const handleSendClarificationMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !activeReportForDetail || !replyText.trim()) return;
    const nowIso = new Date().toISOString();
    const msg: WBSClarificationMessage = {
      id: `msg-${Date.now()}`,
      sender: 'SPI',
      message: replyText.trim(),
      ...(replyLink.trim() ? { attachmentLink: replyLink.trim() } : {}),
      createdAt: nowIso,
    };
    const nextMessages = [...(activeReportForDetail.messages || []), msg];
    try {
      await updateDoc(doc(db, 'wbs_reports', activeReportForDetail.id), {
        messages: nextMessages,
        updatedAt: nowIso,
      });
      setReplyText('');
      setReplyLink('');
      showToast('success', 'Pesan klarifikasi SPI terkirim ke halaman lacak tiket.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `wbs_reports/${activeReportForDetail.id}`);
    }
  };

  // Manual WBS Report Entry
  const openManualModal = () => {
    if (!canManage) return;
    setManIdentityMode('IDENTITAS');
    setManReporterName('');
    setManReporterPhone('');
    setManReporterEmail('');
    setManCategory(WBS_VIOLATION_CATEGORIES[0]);
    setManTitle('');
    setManUnitId(units[0]?.id || '');
    setManReportedParty('');
    setManIncidentDate(new Date().toISOString().slice(0, 10));
    setManIncidentLocation('');
    setManUrgency('Tinggi');
    setManEstimatedLoss(0);
    setManChronology('');
    setManLinks([]);
    setManLinkInput('');
    setManPendingFiles([]);
    setManFileErr(null);
    setIsManualModalOpen(true);
  };

  const handleManualFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setManFileErr(null);
    const files = e.target.files;
    if (!files) return;
    const added: PendingLocalWbsFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const err = validateWbsEvidenceFile(f);
      if (err) {
        setManFileErr(err);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(f);
        added.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          fileName: f.name,
          mimeType: f.type || 'application/octet-stream',
          sizeBytes: f.size,
          kind: f.type.startsWith('image/') ? 'PHOTO' : 'DOCUMENT',
          dataUrl,
        });
      } catch {
        setManFileErr(`Gagal membaca file ${f.name}.`);
      }
    }
    setManPendingFiles((prev) => [...prev, ...added]);
    e.target.value = '';
  };

  const handleSaveManualReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setIsSavingManual(true);
    const now = new Date();
    const nowIso = now.toISOString();
    const y = selectedYear > 0 ? selectedYear : now.getFullYear();
    const m = now.getMonth() + 1;
    const reportId = `wbs-${Date.now()}`;
    const ticket = generateWbsTicketNumber(y);
    const unit = units.find((u) => u.id === manUnitId);

    try {
      const attachments: WBSEvidenceAttachment[] = manLinks.map((lnk, idx) => ({
        id: `lnk-${Date.now()}-${idx}`,
        kind: 'LINK',
        fileName: lnk,
        linkUrl: lnk,
        uploadedAt: nowIso,
      }));
      for (const pf of manPendingFiles) {
        const saved = await persistWbsFileAttachment(reportId, pf);
        attachments.push(saved);
      }

      const payload: WBSReport = {
        id: reportId,
        ticketNumber: ticket,
        year: y,
        month: m,
        identityMode: manIdentityMode,
        reporterName:
          manIdentityMode === 'ANONIM'
            ? 'Anonim (Dirahasiakan)'
            : manReporterName.trim() || 'Pelapor Internal',
        ...(manIdentityMode === 'IDENTITAS' && manReporterPhone.trim()
          ? { reporterPhone: manReporterPhone.trim() }
          : {}),
        ...(manIdentityMode === 'IDENTITAS' && manReporterEmail.trim()
          ? { reporterEmail: manReporterEmail.trim() }
          : {}),
        category: manCategory,
        title: manTitle.trim(),
        reportedUnitId: unit?.id || '',
        reportedUnitName: unit?.name || 'Lingkup Perumda',
        reportedParty: manReportedParty.trim(),
        incidentDate: manIncidentDate,
        incidentLocation: manIncidentLocation.trim(),
        chronology: manChronology.trim(),
        estimatedLoss: Number(manEstimatedLoss) || 0,
        urgencyLevel: manUrgency,
        attachments,
        status: 'Verifikasi & Penelaahan',
        slaDeadlineDate: computeSlaDeadlineIso(now, 7),
        publicResponse:
          'Laporan pengaduan telah diregister ke sistem WBS SPI dan sedang dalam telaah awal.',
        timeline: [
          {
            id: `tl-${Date.now()}`,
            timestamp: nowIso,
            stage: 'Register WBS',
            status: 'Verifikasi & Penelaahan',
            publicNote: `Diregister manual oleh SPI dengan nomor tiket ${ticket}.`,
            actor: userProfile?.displayName || 'Admin SPI',
          },
        ],
        messages: [],
        sourceChannel: 'Input Manual SPI',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await setDoc(doc(db, 'wbs_reports', reportId), payload);
      setIsManualModalOpen(false);
      showToast('success', `Pengaduan WBS berhasil diregister (${ticket}).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `wbs_reports/${reportId}`);
    } finally {
      setIsSavingManual(false);
    }
  };

  // =========================================================================
  // TAB 2: SURAT TUGAS PENANGANAN WBS
  // =========================================================================
  const openAssignmentModal = (prefillReport?: WBSReport, existing?: WBSAssignment) => {
    if (!canManage) return;
    if (existing) {
      setEditingAssign(existing);
      setAsReportId(existing.wbsReportId);
      setAsLetterNumber(existing.letterNumber);
      setAsLetterDate(existing.letterDate);
      setAsBasis(existing.basis);
      setAsTitle(existing.assignmentTitle);
      setAsType(existing.assignmentType);
      setAsConfidentiality(existing.confidentialityLevel);
      setAsSupervisor(existing.supervisor);
      setAsTeamLeader(existing.teamLeader);
      setAsMembers(existing.teamMembers);
      setAsObjective(existing.objective);
      setAsScope(existing.scope);
      setAsStartDate(existing.startDate);
      setAsEndDate(existing.endDate);
      setAsStatus(existing.status);
    } else {
      const target = prefillReport || reports[0];
      const yr = target?.year || (selectedYear > 0 ? selectedYear : new Date().getFullYear());
      const seq = String(assignments.length + 1).padStart(3, '0');
      setEditingAssign(null);
      setAsReportId(target?.id || '');
      setAsLetterNumber(`ST-WBS/${seq}/SPI/${yr}`);
      setAsLetterDate(new Date().toISOString().slice(0, 10));
      setAsBasis(
        target
          ? `Laporan Pengaduan WBS Nomor Tiket ${target.ticketNumber} tanggal ${target.createdAt.slice(0, 10)} kategori ${target.category}`
          : 'Disposisi Kepala SPI atas Pengaduan WBS'
      );
      setAsTitle(
        target
          ? `Penelaahan & Audit Investigatif WBS: ${target.title}`
          : 'Penanganan Pengaduan WBS'
      );
      setAsType('Penelaahan Awal WBS');
      setAsConfidentiality('Rahasia');
      setAsSupervisor('Kepala Satuan Pengawasan Intern');
      setAsTeamLeader(userProfile?.displayName || 'Ketua Tim Pemeriksa WBS');
      setAsMembers('Anggota Tim Pemeriksa SPI');
      setAsObjective(
        'Memverifikasi bukti permulaan, mengklarifikasi pihak terkait secara rahasia, dan menyimpulkan keterbuktian indikasi pelanggaran.'
      );
      setAsScope(
        target
          ? `Unit/Objek: ${target.reportedUnitName}; Terlapor: ${target.reportedParty}; Kejadian: ${target.incidentLocation || '-'}`
          : 'Sesuai lingkup pengaduan WBS.'
      );
      setAsStartDate(new Date().toISOString().slice(0, 10));
      setAsEndDate(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
      setAsStatus('Diterbitkan');
    }
    setIsAssignModalOpen(true);
  };

  const handleSelectReportForAssignment = (repId: string) => {
    setAsReportId(repId);
    const rep = reports.find((r) => r.id === repId);
    if (rep && !editingAssign) {
      setAsBasis(
        `Laporan Pengaduan WBS Nomor Tiket ${rep.ticketNumber} tanggal ${rep.createdAt.slice(0, 10)} kategori ${rep.category}`
      );
      setAsTitle(`Penelaahan & Audit Investigatif WBS: ${rep.title}`);
      setAsScope(
        `Unit/Objek: ${rep.reportedUnitName}; Terlapor: ${rep.reportedParty}; Lokasi: ${rep.incidentLocation || '-'}`
      );
    }
  };

  const handleSaveAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const linkedRep = reports.find((r) => r.id === asReportId);
    if (!linkedRep) {
      showToast('error', 'Pilih Nomor Tiket WBS terlebih dahulu.');
      return;
    }

    const nowIso = new Date().toISOString();
    const id = editingAssign?.id || `wbs-st-${Date.now()}`;
    const payload: WBSAssignment = {
      id,
      wbsReportId: linkedRep.id,
      ticketNumber: linkedRep.ticketNumber,
      year: linkedRep.year,
      letterNumber: asLetterNumber.trim(),
      letterDate: asLetterDate,
      basis: asBasis.trim(),
      assignmentTitle: asTitle.trim(),
      unitId: linkedRep.reportedUnitId || '',
      unitName: linkedRep.reportedUnitName,
      assignmentType: asType,
      confidentialityLevel: asConfidentiality,
      supervisor: asSupervisor.trim(),
      teamLeader: asTeamLeader.trim(),
      teamMembers: asMembers.trim(),
      objective: asObjective.trim(),
      scope: asScope.trim(),
      startDate: asStartDate,
      endDate: asEndDate,
      status: asStatus,
      createdBy: editingAssign?.createdBy || userProfile?.displayName || 'Kepala SPI',
      createdAt: editingAssign?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      await setDoc(doc(db, 'wbs_assignments', id), payload, { merge: true });

      // Update linked WBS report status & timeline
      const nextStatus: WBSReportStatus =
        linkedRep.status === 'Diterima' || linkedRep.status === 'Verifikasi & Penelaahan'
          ? 'Surat Tugas Diterbitkan'
          : linkedRep.status;

      const updatedTimeline: WBSTimelineEntry[] = [...(linkedRep.timeline || [])];
      if (!editingAssign || linkedRep.linkedAssignmentId !== id) {
        updatedTimeline.push({
          id: `tl-${Date.now()}`,
          timestamp: nowIso,
          stage: 'Surat Tugas Penanganan WBS',
          status: 'Surat Tugas Diterbitkan',
          publicNote: `Surat Tugas Penanganan WBS (${payload.letterNumber}) telah diterbitkan untuk menelaah pengaduan ini secara rahasia.`,
          actor: userProfile?.displayName || 'Kepala SPI',
        });
      }

      await updateDoc(doc(db, 'wbs_reports', linkedRep.id), {
        status: nextStatus,
        linkedAssignmentId: id,
        linkedAssignmentNumber: payload.letterNumber,
        publicResponse: `Tim Pemeriksa WBS telah ditugaskan melalui Surat Tugas ${payload.letterNumber}.`,
        timeline: updatedTimeline,
        updatedAt: nowIso,
      });

      setIsAssignModalOpen(false);
      showToast('success', `Surat Tugas WBS ${payload.letterNumber} berhasil disimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `wbs_assignments/${id}`);
    }
  };

  // =========================================================================
  // TAB 3: KERTAS KERJA WBS
  // =========================================================================
  const openKkaModal = (prefillAssign?: WBSAssignment, existing?: WBSWorkPaper) => {
    if (!canManage) return;
    if (existing) {
      setEditingKka(existing);
      setKkaAssignId(existing.wbsAssignmentId);
      setKkaNumber(existing.kkaNumber);
      setKkaTitle(existing.title);
      setKkaProcedure(existing.procedure);
      setKkaEvidenceVerified(existing.evidenceVerified);
      setKkaInterviewSummary(existing.interviewSummary);
      setKkaTestResult(existing.testResult);
      setKkaIndicatedLoss(existing.indicatedLoss || 0);
      setKkaAnalysis(existing.auditorAnalysis);
      setKkaConclusion(existing.conclusion);
      setKkaPreparer(existing.preparer);
      setKkaReviewerNotes(existing.reviewerNotes || '');
      setKkaStatus(existing.status);
    } else {
      const targetAssign = prefillAssign || assignments[0];
      const rep = reports.find((r) => r.id === targetAssign?.wbsReportId);
      const yr = targetAssign?.year || (selectedYear > 0 ? selectedYear : new Date().getFullYear());
      const seq = String(workPapers.length + 1).padStart(3, '0');
      setEditingKka(null);
      setKkaAssignId(targetAssign?.id || '');
      setKkaNumber(`KKA-WBS/${seq}/${yr}`);
      setKkaTitle(
        targetAssign
          ? `Kertas Kerja Pengujian WBS: ${rep?.title || targetAssign.assignmentTitle}`
          : 'Kertas Kerja Pemeriksaan WBS'
      );
      setKkaProcedure(
        '1. Verifikasi keabsahan bukti permulaan pelapor.\n2. Permintaan dokumen transaksi / rekaman pendukung unit terkait.\n3. Klarifikasi & konfirmasi tertutup pihak terkait.'
      );
      setKkaEvidenceVerified(
        rep?.attachments?.length
          ? `${rep.attachments.length} bukti permulaan pelapor telah diverifikasi (${rep.attachments.map((a) => a.fileName).join(', ')}).`
          : 'Bukti permulaan dan dokumen pembanding telah diuji.'
      );
      setKkaInterviewSummary('');
      setKkaTestResult('');
      setKkaIndicatedLoss(rep?.estimatedLoss || 0);
      setKkaAnalysis('');
      setKkaConclusion('Terbukti (Indikasi Kuat)');
      setKkaPreparer(targetAssign?.teamLeader || userProfile?.displayName || 'Pemeriksa WBS');
      setKkaReviewerNotes('');
      setKkaStatus('Draft');
    }
    setIsKkaModalOpen(true);
  };

  const handleSaveKka = async (e: React.FormEvent, lockImmediately = false) => {
    e.preventDefault();
    if (!canManage) return;
    const linkedAssign = assignments.find((a) => a.id === kkaAssignId);
    const linkedRep = reports.find((r) => r.id === linkedAssign?.wbsReportId);
    if (!linkedAssign || !linkedRep) {
      showToast('error', 'Pilih Surat Tugas Penanganan WBS terlebih dahulu.');
      return;
    }

    const nowIso = new Date().toISOString();
    const id = editingKka?.id || `wbs-kka-${Date.now()}`;
    const finalStatus: WBSWorkPaper['status'] = lockImmediately ? 'Disetujui & Dikunci' : kkaStatus;
    const isLocked = finalStatus === 'Disetujui & Dikunci';

    const payload: WBSWorkPaper = {
      id,
      wbsReportId: linkedRep.id,
      ticketNumber: linkedRep.ticketNumber,
      wbsAssignmentId: linkedAssign.id,
      wbsAssignmentNumber: linkedAssign.letterNumber,
      year: linkedAssign.year,
      kkaNumber: kkaNumber.trim(),
      title: kkaTitle.trim(),
      procedure: kkaProcedure.trim(),
      evidenceVerified: kkaEvidenceVerified.trim(),
      interviewSummary: kkaInterviewSummary.trim(),
      testResult: kkaTestResult.trim(),
      indicatedLoss: Number(kkaIndicatedLoss) || 0,
      auditorAnalysis: kkaAnalysis.trim(),
      conclusion: kkaConclusion,
      preparer: kkaPreparer.trim(),
      reviewer: isLocked ? userProfile?.displayName || 'Kepala SPI' : editingKka?.reviewer,
      reviewerNotes: kkaReviewerNotes.trim(),
      status: finalStatus,
      isLocked,
      createdAt: editingKka?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      await setDoc(doc(db, 'wbs_work_papers', id), payload, { merge: true });

      const nextRepStatus: WBSReportStatus =
        linkedRep.status === 'Diterima' ||
        linkedRep.status === 'Verifikasi & Penelaahan' ||
        linkedRep.status === 'Surat Tugas Diterbitkan'
          ? 'Dalam Pemeriksaan WBS'
          : linkedRep.status;

      const updatedTimeline = [...(linkedRep.timeline || [])];
      if (!editingKka || isLocked) {
        updatedTimeline.push({
          id: `tl-${Date.now()}`,
          timestamp: nowIso,
          stage: 'Kertas Kerja WBS',
          status: nextRepStatus,
          publicNote: isLocked
            ? `Kertas Kerja Pemeriksaan WBS (${payload.kkaNumber}) telah direviu dan disetujui Kepala SPI.`
            : `Tim Pemeriksa sedang melaksanakan pengujian dan penyusunan Kertas Kerja WBS (${payload.kkaNumber}).`,
          actor: userProfile?.displayName || 'Pemeriksa WBS',
        });
      }

      await updateDoc(doc(db, 'wbs_reports', linkedRep.id), {
        status: nextRepStatus,
        linkedWorkPaperId: id,
        timeline: updatedTimeline,
        updatedAt: nowIso,
      });

      setIsKkaModalOpen(false);
      showToast('success', `Kertas Kerja WBS ${payload.kkaNumber} disimpan.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `wbs_work_papers/${id}`);
    }
  };

  const handleToggleLockKka = async (kka: WBSWorkPaper) => {
    if (!canManage) return;
    const nextLocked = !kka.isLocked;
    try {
      await updateDoc(doc(db, 'wbs_work_papers', kka.id), {
        isLocked: nextLocked,
        status: nextLocked ? 'Disetujui & Dikunci' : 'Direviu',
        reviewer: userProfile?.displayName || 'Kepala SPI',
        updatedAt: new Date().toISOString(),
      });
      showToast(
        'success',
        nextLocked
          ? `KKA ${kka.kkaNumber} disetujui & dikunci.`
          : `Kunci KKA ${kka.kkaNumber} dibuka untuk revisi.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `wbs_work_papers/${kka.id}`);
    }
  };

  // =========================================================================
  // TAB 4: LAPORAN HASIL WBS (LHWBS) & OTOMATIS KE TEMUAN 5C
  // =========================================================================
  const openResultModal = (prefillKka?: WBSWorkPaper, existing?: WBSResultReport) => {
    if (!canManage) return;
    if (existing) {
      setEditingResult(existing);
      setResKkaId(existing.wbsWorkPaperId || '');
      setResReportId(existing.wbsReportId);
      setResNumber(existing.reportNumber);
      setResDate(existing.reportDate);
      setResTitle(existing.title);
      setResExecSummary(existing.executiveSummary);
      setResFacts(existing.examinationFacts);
      setResProofConclusion(existing.proofConclusion);
      setResIsFinding(existing.isFinding);
      setResRiskLevel(existing.riskLevel);
      setResCondition(existing.condition);
      setResCriteria(existing.criteria);
      setResCause(existing.cause);
      setResConsequence(existing.consequence);
      setResPotentialLoss(existing.potentialLoss || 0);
      setResAnalysis(existing.auditorAnalysis);
      setResRecText(existing.recommendationText);
      setResRecPic(existing.recommendationPic);
      setResRecTarget(existing.recommendationTargetDate);
      setResRecIndicator(existing.recommendationIndicator);
      setResStatus(existing.status);
    } else {
      const kka = prefillKka || workPapers[0];
      const rep =
        reports.find((r) => r.id === kka?.wbsReportId) ||
        reports[0];
      const yr = kka?.year || rep?.year || (selectedYear > 0 ? selectedYear : new Date().getFullYear());
      const seq = String(results.length + 1).padStart(3, '0');
      const isProv = !kka || kka.conclusion !== 'Tidak Terbukti';
      setEditingResult(null);
      setResKkaId(kka?.id || '');
      setResReportId(rep?.id || '');
      setResNumber(`LHWBS/${seq}/SPI/${yr}`);
      setResDate(new Date().toISOString().slice(0, 10));
      setResTitle(rep?.title || kka?.title || 'Laporan Hasil Pemeriksaan Pengaduan WBS');
      setResExecSummary(
        rep
          ? `Pemeriksaan WBS atas pengaduan tiket ${rep.ticketNumber} pada ${rep.reportedUnitName} terkait ${rep.category}.`
          : ''
      );
      setResFacts(kka?.testResult || rep?.chronology || '');
      setResProofConclusion(
        isProv ? 'Terbukti - Menjadi Temuan 5C' : 'Tidak Terbukti / Selesai'
      );
      setResIsFinding(isProv);
      setResRiskLevel(rep?.urgencyLevel === 'Kritis' ? 'Kritis' : 'Tinggi');
      setResCondition(kka?.testResult || rep?.chronology || '');
      setResCriteria(
        'Ketentuan SOP Operasional, Peraturan Direksi, dan Pedoman Tata Kelola Perusahaan yang Baik (GCG) Perumda.'
      );
      setResCause(
        'Lemahnya pengendalian berjenjang, ketidakpatuhan pelaksana terhadap SOP, serta belum optimalnya fungsi verifikasi atasan langsung.'
      );
      setResConsequence(
        `Menimbulkan potensi kerugian keuangan / penurunan integritas pelayanan sebesar ${formatRupiahId(kka?.indicatedLoss || rep?.estimatedLoss || 0)}.`
      );
      setResPotentialLoss(kka?.indicatedLoss || rep?.estimatedLoss || 0);
      setResAnalysis(kka?.auditorAnalysis || '');
      setResRecText(
        `Memerintahkan ${rep?.reportedUnitName || 'Pimpinan Unit Terkait'} untuk melakukan pemulihan kerugian/koreksi administratif, penjatuhan sanksi disiplin sesuai ketentuan kepegawaian, serta perbaikan pengendalian internal.`
      );
      setResRecPic(rep?.reportedUnitName || 'Direksi & Kepala Unit Terkait');
      setResRecTarget(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
      setResRecIndicator(
        'Tindak lanjut perbaikan SOP, pemulihan kerugian (jika ada), dan berita acara penyelesaian diverifikasi SPI 100%.'
      );
      setResStatus('Final / Disahkan Kepala SPI');
    }
    setIsResultModalOpen(true);
  };

  const syncResultToFindings5C = async (resultObj: WBSResultReport, linkedRep: WBSReport) => {
    if (!canManage) return null;
    if (resultObj.syncedToFindingId) {
      return {
        findingId: resultObj.syncedToFindingId,
        findingNumber: resultObj.syncedFindingNumber || '',
      };
    }

    const nowIso = new Date().toISOString();
    const yr = resultObj.year || new Date().getFullYear();
    const sameYearFindingsCount = findings.filter((f) => f.year === yr).length;
    const seq = sameYearFindingsCount + 1;
    const findingNumber = `TMN-${yr}-${String(seq).padStart(3, '0')}`;
    const findingId = `fnd-wbs-${Date.now()}`;

    const findingPayload: Finding = {
      id: findingId,
      assignmentId: resultObj.wbsAssignmentId || resultObj.wbsReportId,
      assignmentTitle: resultObj.wbsAssignmentNumber || resultObj.ticketNumber,
      year: yr,
      unitId: resultObj.unitId || 'unit-wbs',
      unitName: resultObj.unitName,
      findingNumber,
      title: resultObj.title,
      category: `WBS · ${resultObj.category}`,
      riskLevel: resultObj.riskLevel,
      condition: resultObj.condition || resultObj.examinationFacts,
      criteria: resultObj.criteria,
      cause: resultObj.cause,
      consequence: resultObj.consequence,
      potentialLoss: Number(resultObj.potentialLoss) || 0,
      auditorAnalysis:
        resultObj.auditorAnalysis ||
        `Temuan ini berasal dari hasil pemeriksaan pengaduan Whistleblowing System (WBS) tiket ${resultObj.ticketNumber} nomor laporan ${resultObj.reportNumber}.`,
      status: 'Disetujui',
      sourceType: 'WBS',
      wbsReportId: resultObj.wbsReportId,
      wbsTicketNumber: resultObj.ticketNumber,
      wbsResultId: resultObj.id,
      createdAt: nowIso,
    };

    const recId = `rec-wbs-${Date.now()}`;
    const recNumber = `REC-${yr}-${String(seq).padStart(3, '0')}.1`;
    const recPayload: Recommendation = {
      id: recId,
      findingId,
      findingNumber,
      findingTitle: resultObj.title,
      unitId: resultObj.unitId || 'unit-wbs',
      unitName: resultObj.unitName,
      recNumber,
      description:
        resultObj.recommendationText ||
        'Melakukan koreksi tata kelola dan pemulihan sesuai Laporan Hasil WBS.',
      pic: resultObj.recommendationPic || resultObj.unitName,
      targetDate: resultObj.recommendationTargetDate || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      successIndicator:
        resultObj.recommendationIndicator || 'Rekomendasi WBS selesai ditindaklanjuti dan diverifikasi SPI.',
      status: 'Belum Ditindaklanjuti',
    };

    await setDoc(doc(db, 'findings', findingId), findingPayload);
    await setDoc(doc(db, 'recommendations', recId), recPayload);

    await updateDoc(doc(db, 'wbs_results', resultObj.id), {
      syncedToFindingId: findingId,
      syncedFindingNumber: findingNumber,
      syncedRecommendationId: recId,
      syncedAt: nowIso,
      status: 'Final / Disahkan Kepala SPI',
      updatedAt: nowIso,
    });

    const updatedTimeline = [...(linkedRep.timeline || [])];
    updatedTimeline.push({
      id: `tl-${Date.now()}`,
      timestamp: nowIso,
      stage: 'Temuan 5C & Rekomendasi SPI',
      status: 'Menjadi Temuan 5C',
      publicNote: `Laporan Hasil WBS (${resultObj.reportNumber}) terbukti dan resmi dicatat sebagai Temuan Audit 5C (${findingNumber}) untuk dipantau tindak lanjutnya.`,
      actor: userProfile?.displayName || 'Kepala SPI',
    });

    await updateDoc(doc(db, 'wbs_reports', linkedRep.id), {
      status: 'Menjadi Temuan 5C',
      linkedResultId: resultObj.id,
      linkedFindingId: findingId,
      linkedFindingNumber: findingNumber,
      publicResponse: `Pengaduan WBS telah selesai diperiksa dan dikonversi menjadi Temuan Audit 5C resmi (${findingNumber}).`,
      timeline: updatedTimeline,
      updatedAt: nowIso,
    });

    return { findingId, findingNumber };
  };

  const handleSaveResult = async (e: React.FormEvent, autoSyncTo5C: boolean) => {
    e.preventDefault();
    if (!canManage) return;
    const kka = workPapers.find((w) => w.id === resKkaId);
    const linkedRep =
      reports.find((r) => r.id === (kka?.wbsReportId || resReportId));
    if (!linkedRep) {
      showToast('error', 'Pilih Referensi Tiket / KKA WBS terlebih dahulu.');
      return;
    }

    const nowIso = new Date().toISOString();
    const id = editingResult?.id || `wbs-lhwbs-${Date.now()}`;
    const willConvert = autoSyncTo5C && resIsFinding;

    const payload: WBSResultReport = {
      id,
      wbsReportId: linkedRep.id,
      ticketNumber: linkedRep.ticketNumber,
      wbsAssignmentId: kka?.wbsAssignmentId || linkedRep.linkedAssignmentId || '',
      wbsAssignmentNumber: kka?.wbsAssignmentNumber || linkedRep.linkedAssignmentNumber || '',
      wbsWorkPaperId: kka?.id || linkedRep.linkedWorkPaperId || '',
      year: linkedRep.year,
      reportNumber: resNumber.trim(),
      reportDate: resDate,
      title: resTitle.trim(),
      unitId: linkedRep.reportedUnitId || '',
      unitName: linkedRep.reportedUnitName,
      category: linkedRep.category,
      executiveSummary: resExecSummary.trim(),
      examinationFacts: resFacts.trim(),
      proofConclusion: resProofConclusion,
      isFinding: resIsFinding,
      riskLevel: resRiskLevel,
      condition: resCondition.trim(),
      criteria: resCriteria.trim(),
      cause: resCause.trim(),
      consequence: resConsequence.trim(),
      potentialLoss: Number(resPotentialLoss) || 0,
      auditorAnalysis: resAnalysis.trim(),
      recommendationText: resRecText.trim(),
      recommendationPic: resRecPic.trim(),
      recommendationTargetDate: resRecTarget,
      recommendationIndicator: resRecIndicator.trim(),
      status: willConvert ? 'Final / Disahkan Kepala SPI' : resStatus,
      ...(editingResult?.syncedToFindingId
        ? {
            syncedToFindingId: editingResult.syncedToFindingId,
            syncedFindingNumber: editingResult.syncedFindingNumber,
            syncedRecommendationId: editingResult.syncedRecommendationId,
            syncedAt: editingResult.syncedAt,
          }
        : {}),
      preparedBy: editingResult?.preparedBy || userProfile?.displayName || 'Pemeriksa WBS',
      approvedBy:
        willConvert || resStatus === 'Final / Disahkan Kepala SPI'
          ? userProfile?.displayName || 'Kepala SPI'
          : editingResult?.approvedBy,
      createdAt: editingResult?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      await setDoc(doc(db, 'wbs_results', id), payload, { merge: true });

      if (willConvert && !payload.syncedToFindingId) {
        const synced = await syncResultToFindings5C(payload, linkedRep);
        setIsResultModalOpen(false);
        showToast(
          'success',
          `LHWBS ${payload.reportNumber} disimpan & otomatis dikonversi menjadi Temuan 5C (${synced?.findingNumber}).`
        );
      } else {
        // Update linked report status if not yet Menjadi Temuan 5C
        let nextStatus = linkedRep.status;
        if (!linkedRep.linkedFindingId && payload.status === 'Final / Disahkan Kepala SPI') {
          nextStatus =
            payload.proofConclusion === 'Tidak Terbukti / Selesai'
              ? 'Tidak Terbukti / Diarsipkan'
              : 'Laporan Hasil Selesai';
        }
        const updatedTimeline = [...(linkedRep.timeline || [])];
        if (!editingResult) {
          updatedTimeline.push({
            id: `tl-${Date.now()}`,
            timestamp: nowIso,
            stage: 'Laporan Hasil WBS',
            status: nextStatus,
            publicNote: `Laporan Hasil Pemeriksaan WBS (${payload.reportNumber}) telah disusun dengan kesimpulan: ${payload.proofConclusion}.`,
            actor: userProfile?.displayName || 'Kepala SPI',
          });
        }
        await updateDoc(doc(db, 'wbs_reports', linkedRep.id), {
          status: nextStatus,
          linkedResultId: id,
          timeline: updatedTimeline,
          updatedAt: nowIso,
        });
        setIsResultModalOpen(false);
        showToast('success', `Laporan Hasil WBS ${payload.reportNumber} berhasil disimpan.`);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `wbs_results/${id}`);
    }
  };

  const handleQuickConvertExistingResult = async (resItem: WBSResultReport) => {
    if (!canManage || resItem.syncedToFindingId || !resItem.isFinding) return;
    const linkedRep = reports.find((r) => r.id === resItem.wbsReportId);
    if (!linkedRep) return;
    try {
      const synced = await syncResultToFindings5C(resItem, linkedRep);
      showToast(
        'success',
        `LHWBS ${resItem.reportNumber} otomatis masuk ke Matriks Temuan 5C (${synced?.findingNumber}).`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'findings');
    }
  };

  // Delete confirmation handler
  const handleConfirmDelete = async () => {
    if (!canManage || !deleteTarget) return;
    try {
      await deleteDoc(doc(db, deleteTarget.collectionName, deleteTarget.id));
      showToast('success', `Data "${deleteTarget.label}" berhasil dihapus.`);
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${deleteTarget.collectionName}/${deleteTarget.id}`);
    }
  };

  // Excel export for Register WBS
  const handleExportRegisterExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        scopedReports.map((r, idx) => ({
          No: idx + 1,
          'Nomor Tiket': r.ticketNumber,
          'Mode Identitas': r.identityMode,
          Pelapor: r.identityMode === 'ANONIM' ? 'Anonim (Dirahasiakan)' : r.reporterName,
          Kategori: r.category,
          'Judul Pengaduan': r.title,
          'Unit Terlapor': r.reportedUnitName,
          'Pihak Terlapor': r.reportedParty,
          Urgensi: r.urgencyLevel,
          'Estimasi Kerugian (Rp)': r.estimatedLoss || 0,
          'Jumlah Bukti': r.attachments?.length || 0,
          Status: r.status,
          'No. Surat Tugas WBS': r.linkedAssignmentNumber || '-',
          'No. Temuan 5C': r.linkedFindingNumber || '-',
          'Tanggal Lapor': r.createdAt.slice(0, 10),
        }))
      ),
      'Register WBS'
    );
    XLSX.writeFile(wb, `Register_WBS_SPI_${selectedYear || 'Semua'}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 mb-1">
              <Lock className="w-3.5 h-3.5" />
              <span>KANAL RAHASIA WHISTLEBLOWING SYSTEM (WBS) · TERINTEGRASI LAPORAN BULANAN/TAHUNAN &amp; TEMUAN 5C</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-emerald-700 shrink-0" />
              <span>Manajemen Pengaduan &amp; Audit Whistleblowing System (WBS)</span>
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Alur pengawasan terpadu dari Register Tiket Portal Publik, Penerbitan Surat Tugas Rahasia, Kertas Kerja Pemeriksaan WBS, hingga Laporan Hasil WBS yang terkonversi otomatis menjadi Temuan 5C.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
              className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-900"
              aria-label="Filter Tahun WBS"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  Tahun {y}
                </option>
              ))}
              <option value={0}>Semua Tahun</option>
            </select>

            <button
              type="button"
              onClick={handleExportRegisterExcel}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              <span>Excel Register</span>
            </button>

            <button
              type="button"
              onClick={() => setPrintMode({ kind: 'register' })}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-emerald-700" />
              <span>Cetak Register WBS</span>
            </button>
          </div>
        </div>

        {/* 4 Core Sub-Module Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
          {[
            {
              key: 'register' as WbsSubTab,
              label: '1. Register WBS',
              count: scopedReports.length,
              icon: FileText,
            },
            {
              key: 'assignment' as WbsSubTab,
              label: '2. Surat Tugas Penanganan WBS',
              count: scopedAssignments.length,
              icon: FileCheck2,
            },
            {
              key: 'work_paper' as WbsSubTab,
              label: '3. Kertas Kerja WBS',
              count: scopedWorkPapers.length,
              icon: BookOpen,
            },
            {
              key: 'result' as WbsSubTab,
              label: '4. Laporan Hasil WBS & Temuan 5C',
              count: scopedResults.length,
              icon: AlertTriangle,
            },
          ].map((t) => {
            const Icon = t.icon;
            const active = subTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setSubTab(t.key)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  active
                    ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? 'text-amber-300' : 'text-emerald-700'}`} />
                <span>{t.label}</span>
                <span
                  className={`px-1.5 py-0.5 text-[10px] rounded-md font-mono ${
                    active ? 'bg-emerald-900/60 text-white' : 'bg-white text-slate-700 border border-slate-200'
                  }`}
                >
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notice banner */}
      {notice && (
        <div
          className={`rounded-xl px-4 py-3 border text-xs font-semibold flex items-center justify-between gap-2 ${
            notice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice.text}</span>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="underline">
            Tutup
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Total Pengaduan WBS</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{kpi.totalReports}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {kpi.anonCount} Anonim · {kpi.totalReports - kpi.anonCount} Identitas
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Menunggu Telaah SPI</p>
          <p className="text-2xl font-bold text-amber-600 mt-1 tabular-nums">{kpi.awaitingTriage}</p>
          <p className="text-[11px] text-slate-500 mt-1">Target SLA telaah 7 hari</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Surat Tugas WBS</p>
          <p className="text-2xl font-bold text-indigo-700 mt-1 tabular-nums">{kpi.totalAssignments}</p>
          <p className="text-[11px] text-slate-500 mt-1">Penugasan bersifat rahasia</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500">Kertas Kerja WBS</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">{kpi.totalKka}</p>
          <p className="text-[11px] text-emerald-700 font-medium mt-1">
            {kpi.kkaLocked} Disetujui &amp; Dikunci
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 col-span-2 lg:col-span-1">
          <p className="text-xs font-medium text-slate-500">LHWBS &rarr; Temuan 5C</p>
          <p className="text-2xl font-bold text-rose-700 mt-1 tabular-nums">{kpi.convertedTo5C}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            Dari {kpi.totalResults} Laporan Hasil WBS
          </p>
        </div>
      </div>

      {/* Shared Search Bar & Tab-Specific Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nomor tiket, nomor surat, judul pengaduan, atau unit..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          {subTab === 'register' && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
            >
              <option value="ALL">Semua Status WBS</option>
              {WBS_STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          )}
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            {subTab === 'register' && (
              <button
                type="button"
                onClick={openManualModal}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Register Manual WBS</span>
              </button>
            )}
            {subTab === 'assignment' && (
              <button
                type="button"
                onClick={() => openAssignmentModal()}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Terbitkan Surat Tugas WBS</span>
              </button>
            )}
            {subTab === 'work_paper' && (
              <button
                type="button"
                onClick={() => openKkaModal()}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Buat Kertas Kerja WBS</span>
              </button>
            )}
            {subTab === 'result' && (
              <button
                type="button"
                onClick={() => openResultModal()}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Susun Laporan Hasil WBS</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: REGISTER WBS */}
      {/* ===================================================================== */}
      {subTab === 'register' && (
        <div className="space-y-3">
          {scopedReports.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              Belum ada pengaduan WBS yang tercatat pada filter periode ini. Pengaduan dari Portal Publik di halaman Login akan tampil otomatis di sini.
            </div>
          ) : (
            scopedReports.map((rep) => {
              const isOverdue =
                rep.slaDeadlineDate &&
                (rep.status === 'Diterima' || rep.status === 'Verifikasi & Penelaahan') &&
                new Date().toISOString().slice(0, 10) > rep.slaDeadlineDate;

              return (
                <div
                  key={rep.id}
                  className="bg-white border border-slate-200 hover:border-emerald-500 rounded-xl p-5 transition-colors space-y-3"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-mono font-bold px-2 py-0.5 bg-slate-900 text-amber-300 rounded-md">
                          {rep.ticketNumber}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md border font-semibold ${getWbsStatusBadge(
                            rep.status
                          )}`}
                        >
                          {rep.status}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold ${
                            rep.identityMode === 'ANONIM'
                              ? 'bg-slate-100 text-slate-700 border-slate-300'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          {rep.identityMode === 'ANONIM' ? (
                            <EyeOff className="w-3 h-3" />
                          ) : (
                            <UserCheck className="w-3 h-3" />
                          )}
                          <span>
                            {rep.identityMode === 'ANONIM' ? 'Anonim (Rahasia)' : `Identitas: ${rep.reporterName}`}
                          </span>
                        </span>
                        <span className="px-2 py-0.5 bg-amber-50 border border-amber-200 text-amber-900 rounded-md font-semibold">
                          Urgensi: {rep.urgencyLevel}
                        </span>
                        {rep.slaDeadlineDate && (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold ${
                              isOverdue
                                ? 'bg-rose-50 text-rose-800 border-rose-300'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            <span>
                              SLA Telaah: {rep.slaDeadlineDate} {isOverdue ? '(Lewat Batas)' : ''}
                            </span>
                          </span>
                        )}
                      </div>

                      <h3 className="text-sm font-bold text-slate-900">{rep.title}</h3>
                      <p className="text-xs text-slate-600">
                        Unit Terlapor: <span className="font-semibold text-slate-800">{rep.reportedUnitName}</span> ·
                        Terlapor: <span className="font-semibold text-slate-800">{rep.reportedParty}</span> ·
                        Kategori: <span>{rep.category}</span>
                      </p>
                      <p className="text-xs text-slate-600 line-clamp-2">{rep.chronology}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openReportDetail(rep)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-lg cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Telaah &amp; Bukti ({rep.attachments?.length || 0})</span>
                      </button>

                      {canManage && !rep.linkedAssignmentId && (
                        <button
                          type="button"
                          onClick={() => {
                            setSubTab('assignment');
                            openAssignmentModal(rep);
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer"
                        >
                          <span>Terbitkan ST WBS</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {canManage && (
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              collectionName: 'wbs_reports',
                              id: rep.id,
                              label: `${rep.ticketNumber} - ${rep.title}`,
                            })
                          }
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg border border-transparent hover:border-rose-200 cursor-pointer"
                          title="Hapus Pengaduan"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Linked document badges */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                    <div className="flex flex-wrap items-center gap-3">
                      <span>Masuk: {rep.createdAt.slice(0, 10)} ({rep.sourceChannel || 'Portal WBS Publik'})</span>
                      {rep.estimatedLoss ? (
                        <span className="font-mono font-semibold text-rose-700">
                          Indikasi Kerugian: {formatRupiahId(rep.estimatedLoss)}
                        </span>
                      ) : null}
                      {rep.messages && rep.messages.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-emerald-800 font-semibold">
                          <MessageSquare className="w-3 h-3" />
                          {rep.messages.length} Pesan Klarifikasi
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {rep.linkedAssignmentNumber && (
                        <span className="font-mono px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-md">
                          ST: {rep.linkedAssignmentNumber}
                        </span>
                      )}
                      {rep.linkedFindingNumber && (
                        <span className="font-mono px-2 py-0.5 bg-rose-50 text-rose-800 border border-rose-200 rounded-md font-bold">
                          Temuan 5C: {rep.linkedFindingNumber}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: SURAT TUGAS PENANGANAN WBS */}
      {/* ===================================================================== */}
      {subTab === 'assignment' && (
        <div className="space-y-3">
          {scopedAssignments.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              Belum ada Surat Tugas Penanganan WBS. Terbitkan dari tombol di kanan atas atau langsung dari tiket di Register WBS.
            </div>
          ) : (
            scopedAssignments.map((st) => (
              <div
                key={st.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 hover:border-emerald-500 transition-colors"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-mono font-bold px-2 py-0.5 bg-indigo-50 text-indigo-900 border border-indigo-200 rounded-md">
                        {st.letterNumber}
                      </span>
                      <span className="font-mono px-2 py-0.5 bg-slate-100 text-slate-800 border border-slate-200 rounded-md">
                        Tiket: {st.ticketNumber}
                      </span>
                      <span className="px-2 py-0.5 bg-rose-50 text-rose-800 border border-rose-200 rounded-md font-semibold">
                        {st.confidentialityLevel}
                      </span>
                      <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md font-semibold">
                        {st.status}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{st.assignmentTitle}</h3>
                    <p className="text-xs text-slate-600">
                      Unit: <span className="font-semibold text-slate-800">{st.unitName}</span> · Ketua Tim:{' '}
                      <span className="font-semibold text-slate-800">{st.teamLeader}</span> · Jadwal: {st.startDate} s.d.{' '}
                      {st.endDate}
                    </p>
                    <p className="text-xs text-slate-500">Dasar: {st.basis}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPrintMode({ kind: 'assignment', item: st })}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Cetak SPT WBS</span>
                    </button>

                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSubTab('work_paper');
                            openKkaModal(st);
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                        >
                          <span>Buat Kertas Kerja</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openAssignmentModal(undefined, st)}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                          title="Edit Surat Tugas"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              collectionName: 'wbs_assignments',
                              id: st.id,
                              label: st.letterNumber,
                            })
                          }
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                          title="Hapus Surat Tugas"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: KERTAS KERJA WBS */}
      {/* ===================================================================== */}
      {subTab === 'work_paper' && (
        <div className="space-y-3">
          {scopedWorkPapers.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              Belum ada Kertas Kerja Pemeriksaan WBS. Buat dari Surat Tugas Penanganan WBS atau tombol "Buat Kertas Kerja WBS".
            </div>
          ) : (
            scopedWorkPapers.map((kka) => (
              <div
                key={kka.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 hover:border-emerald-500 transition-colors"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-mono font-bold px-2 py-0.5 bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-md">
                        {kka.kkaNumber}
                      </span>
                      <span className="font-mono px-2 py-0.5 bg-slate-100 text-slate-800 border border-slate-200 rounded-md">
                        Tiket: {kka.ticketNumber}
                      </span>
                      {kka.wbsAssignmentNumber && (
                        <span className="font-mono px-2 py-0.5 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded-md">
                          ST: {kka.wbsAssignmentNumber}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-semibold ${
                          kka.isLocked
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                            : 'bg-amber-50 text-amber-900 border-amber-200'
                        }`}
                      >
                        {kka.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        <span>{kka.status}</span>
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900">{kka.title}</h3>
                    <p className="text-xs text-slate-600">
                      Kesimpulan Uji: <span className="font-semibold text-slate-900">{kka.conclusion}</span> · Indikasi Kerugian:{' '}
                      <span className="font-mono font-semibold text-rose-700">
                        {formatRupiahId(kka.indicatedLoss || 0)}
                      </span>{' '}
                      · Penyusun: {kka.preparer}
                    </p>
                    <p className="text-xs text-slate-600 line-clamp-2">{kka.testResult}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPrintMode({ kind: 'kka', item: kka })}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Cetak KKA WBS</span>
                    </button>

                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleLockKka(kka)}
                          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                            kka.isLocked
                              ? 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {kka.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                          <span>{kka.isLocked ? 'Buka Kunci' : 'Setujui & Kunci'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSubTab('result');
                            openResultModal(kka);
                          }}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                        >
                          <span>Buat Laporan Hasil</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>

                        {!kka.isLocked && (
                          <button
                            type="button"
                            onClick={() => openKkaModal(undefined, kka)}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                            title="Edit KKA WBS"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              collectionName: 'wbs_work_papers',
                              id: kka.id,
                              label: kka.kkaNumber,
                            })
                          }
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                          title="Hapus KKA WBS"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: LAPORAN HASIL WBS & OTOMATIS KE TEMUAN 5C */}
      {/* ===================================================================== */}
      {subTab === 'result' && (
        <div className="space-y-4">
          {scopedResults.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              Belum ada Laporan Hasil WBS (LHWBS). Susun LHWBS dari Kertas Kerja WBS untuk sekaligus mengkonversinya secara otomatis menjadi Temuan Audit 5C.
            </div>
          ) : (
            scopedResults.map((res) => (
              <div
                key={res.id}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 hover:border-emerald-500 transition-colors"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-mono font-bold px-2 py-0.5 bg-slate-900 text-white rounded-md">
                        {res.reportNumber}
                      </span>
                      <span className="font-mono px-2 py-0.5 bg-slate-100 text-slate-800 border border-slate-200 rounded-md">
                        Tiket: {res.ticketNumber}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md border font-semibold ${
                          res.proofConclusion === 'Terbukti - Menjadi Temuan 5C'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : res.proofConclusion === 'Terbukti - Pelanggaran Administratif/Disiplin'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {res.proofConclusion}
                      </span>
                      {res.syncedFindingNumber && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-md font-mono font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          Temuan 5C: {res.syncedFindingNumber}
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-bold text-slate-900">{res.title}</h3>
                    <p className="text-xs text-slate-600">
                      Unit: <span className="font-semibold text-slate-800">{res.unitName}</span> · Tanggal LHWBS:{' '}
                      {res.reportDate} · Risiko: <span className="font-semibold">{res.riskLevel}</span> · Potensi Kerugian:{' '}
                      <span className="font-mono font-bold text-rose-700">
                        {formatRupiahId(res.potentialLoss || 0)}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPrintMode({ kind: 'result', item: res })}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                    >
                      <Printer className="w-3.5 h-3.5 text-emerald-700" />
                      <span>Cetak LHWBS</span>
                    </button>

                    {res.syncedToFindingId && onNavigateToFindings && (
                      <button
                        type="button"
                        onClick={onNavigateToFindings}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg cursor-pointer"
                      >
                        <span>Lihat di Modul Temuan 5C</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {canManage && res.isFinding && !res.syncedToFindingId && (
                      <button
                        type="button"
                        onClick={() => handleQuickConvertExistingResult(res)}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-lg cursor-pointer"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Konversi Otomatis ke Temuan 5C</span>
                      </button>
                    )}

                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => openResultModal(undefined, res)}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                          title="Edit LHWBS"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDeleteTarget({
                              collectionName: 'wbs_results',
                              id: res.id,
                              label: res.reportNumber,
                            })
                          }
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                          title="Hapus LHWBS"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Condensed 5C summary inside card */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-[11px] text-slate-700">
                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200/70">
                    <span className="font-bold text-slate-900 block mb-0.5">Kondisi &amp; Kriteria:</span>
                    <p className="line-clamp-2">{res.condition}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200/70">
                    <span className="font-bold text-slate-900 block mb-0.5">Rekomendasi Perbaikan (5C):</span>
                    <p className="line-clamp-2">{res.recommendationText}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: DETAIL, BUKTI PERMULAAN, TRIAGE & KLARIFIKASI WBS */}
      {/* ===================================================================== */}
      {activeReportForDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs text-amber-300 font-mono font-bold">
                  <span>{activeReportForDetail.ticketNumber}</span>
                  <span>·</span>
                  <span>{activeReportForDetail.status}</span>
                </div>
                <h3 className="text-base font-bold mt-0.5">{activeReportForDetail.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveReportForDetail(null)}
                className="p-1.5 text-slate-300 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
              {/* Identity & Metadata Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <p className="font-bold text-slate-900 flex items-center gap-1.5">
                    {activeReportForDetail.identityMode === 'ANONIM' ? (
                      <EyeOff className="w-4 h-4 text-slate-600" />
                    ) : (
                      <UserCheck className="w-4 h-4 text-emerald-700" />
                    )}
                    <span>Identitas Pelapor ({activeReportForDetail.identityMode})</span>
                  </p>
                  {activeReportForDetail.identityMode === 'ANONIM' ? (
                    <p className="text-slate-600 italic">
                      Pelapor memilih mode Anonim. Identitas dirahasiakan oleh sistem WBS.
                    </p>
                  ) : (
                    <div className="space-y-0.5 text-slate-700">
                      <p>Nama: <span className="font-semibold text-slate-900">{activeReportForDetail.reporterName}</span></p>
                      <p>NIP/NIK: {activeReportForDetail.reporterIdentityNumber || '-'}</p>
                      <p>Telepon/WA: {activeReportForDetail.reporterPhone || '-'}</p>
                      <p>Email: {activeReportForDetail.reporterEmail || '-'}</p>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1 text-slate-700">
                  <p className="font-bold text-slate-900">Detail Insiden &amp; Terlapor</p>
                  <p>Kategori: <span className="font-semibold">{activeReportForDetail.category}</span></p>
                  <p>Unit Terlapor: <span className="font-semibold">{activeReportForDetail.reportedUnitName}</span></p>
                  <p>Pihak Terlapor: <span className="font-semibold">{activeReportForDetail.reportedParty}</span></p>
                  <p>Waktu &amp; Lokasi: {activeReportForDetail.incidentDate} · {activeReportForDetail.incidentLocation || '-'}</p>
                  <p>
                    Indikasi Kerugian:{' '}
                    <span className="font-mono font-bold text-rose-700">
                      {formatRupiahId(activeReportForDetail.estimatedLoss || 0)}
                    </span>
                  </p>
                </div>
              </div>

              {/* Chronology */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1.5">
                <p className="font-bold text-slate-900">Kronologi Dugaan Pelanggaran</p>
                <p className="text-slate-700 whitespace-pre-line leading-relaxed">
                  {activeReportForDetail.chronology}
                </p>
              </div>

              {/* Preliminary Evidence List */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Paperclip className="w-4 h-4 text-emerald-700" />
                  <span>Bukti Permulaan ({activeReportForDetail.attachments?.length || 0})</span>
                </p>
                {activeReportForDetail.evidenceSummaryNote && (
                  <p className="text-[11px] text-slate-600 italic">
                    Catatan Bukti: {activeReportForDetail.evidenceSummaryNote}
                  </p>
                )}
                {!activeReportForDetail.attachments || activeReportForDetail.attachments.length === 0 ? (
                  <p className="text-slate-500 italic">Tidak ada lampiran bukti permulaan.</p>
                ) : (
                  <div className="space-y-2">
                    {activeReportForDetail.attachments.map((att) => (
                      <div
                        key={att.id}
                        className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {att.kind === 'LINK' ? (
                            <Link2 className="w-4 h-4 text-sky-700 shrink-0" />
                          ) : att.kind === 'PHOTO' ? (
                            <ImageIcon className="w-4 h-4 text-emerald-700 shrink-0" />
                          ) : (
                            <File className="w-4 h-4 text-amber-700 shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-800 truncate">{att.fileName}</p>
                            <p className="text-[10px] text-slate-500">
                              {att.kind === 'LINK'
                                ? 'Tautan Eksternal'
                                : `${att.kind} · ${formatBytes(att.sizeBytes)}`}
                            </p>
                          </div>
                        </div>

                        {att.kind === 'LINK' && att.linkUrl ? (
                          <a
                            href={att.linkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-md font-semibold shrink-0"
                          >
                            <span>Buka Tautan</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleInspectAttachment(att)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-md font-semibold shrink-0 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Lihat / Unduh</span>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Triage & Status Update Form */}
              <form onSubmit={handleSaveTriage} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <p className="font-bold text-slate-900">Telaah SPI &amp; Pembaruan Progres untuk Pelapor</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Status Penanganan WBS</label>
                    <select
                      disabled={!canManage}
                      value={triageStatus}
                      onChange={(e) => setTriageStatus(e.target.value as WBSReportStatus)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50 disabled:opacity-60"
                    >
                      {WBS_STATUS_OPTIONS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">
                      Tanggapan Publik SPI (Terlihat di Lacak Tiket)
                    </label>
                    <input
                      type="text"
                      readOnly={!canManage}
                      value={triagePublicResponse}
                      onChange={(e) => setTriagePublicResponse(e.target.value)}
                      placeholder="Update resmi yang dapat dibaca pemilik nomor tiket..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Catatan Internal Telaah SPI (Rahasia)</label>
                  <textarea
                    rows={2}
                    readOnly={!canManage}
                    value={triageNotes}
                    onChange={(e) => setTriageNotes(e.target.value)}
                    placeholder="Hasil verifikasi awal bukti permulaan, rekomendasi penugasan..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-50"
                  />
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="submit"
                      disabled={isSavingTriage}
                      className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg cursor-pointer"
                    >
                      {isSavingTriage ? 'Menyimpan...' : 'Simpan Pembaruan Progres'}
                    </button>
                  </div>
                )}
              </form>

              {/* Two-Way Clarification Messaging */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageSquare className="w-4 h-4 text-emerald-700" />
                  <span>Komunikasi Klarifikasi Dua Arah dengan Pelapor</span>
                </p>

                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {!activeReportForDetail.messages || activeReportForDetail.messages.length === 0 ? (
                    <p className="text-slate-500 italic">Belum ada pesan klarifikasi.</p>
                  ) : (
                    activeReportForDetail.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`p-2.5 rounded-lg border ${
                          m.sender === 'SPI'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                            : 'bg-white border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] font-bold mb-1">
                          <span>{m.sender === 'SPI' ? 'TIM SPI (RESMI)' : 'PELAPOR WBS'}</span>
                          <span className="text-slate-500 font-normal">
                            {new Date(m.createdAt).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <p>{m.message}</p>
                        {m.attachmentLink && (
                          <a
                            href={m.attachmentLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 underline mt-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Lampiran Tautan
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {canManage && (
                  <form onSubmit={handleSendClarificationMessage} className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Kirim pertanyaan atau klarifikasi ke pelapor melalui tiket..."
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                    <input
                      type="url"
                      value={replyLink}
                      onChange={(e) => setReplyLink(e.target.value)}
                      placeholder="Link opsional"
                      className="sm:w-44 px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Kirim</span>
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: ATTACHMENT PREVIEWER */}
      {/* ===================================================================== */}
      {previewAttachment && (
        <div className="fixed inset-0 z-[60] bg-slate-900/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-bold truncate">{previewAttachment.attachment.fileName}</p>
                <p className="text-[10px] text-slate-300">
                  {previewAttachment.attachment.kind} · {formatBytes(previewAttachment.attachment.sizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {previewAttachment.dataUrl && (
                  <a
                    href={previewAttachment.dataUrl}
                    download={previewAttachment.attachment.fileName}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh Berkas</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewAttachment(null)}
                  className="p-1.5 text-slate-300 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-slate-100 flex items-center justify-center min-h-[340px]">
              {previewAttachment.loading ? (
                <p className="text-xs font-semibold text-slate-600">Memuat berkas bukti permulaan...</p>
              ) : previewAttachment.error ? (
                <p className="text-xs font-semibold text-rose-700">{previewAttachment.error}</p>
              ) : previewAttachment.dataUrl &&
                (previewAttachment.attachment.mimeType?.startsWith('image/') ||
                  previewAttachment.attachment.kind === 'PHOTO') ? (
                <img
                  src={previewAttachment.dataUrl}
                  alt={previewAttachment.attachment.fileName}
                  className="max-w-full max-h-[72vh] object-contain rounded-lg shadow-sm"
                />
              ) : previewAttachment.dataUrl &&
                previewAttachment.attachment.mimeType === 'application/pdf' ? (
                <iframe
                  title={previewAttachment.attachment.fileName}
                  src={previewAttachment.dataUrl}
                  className="w-full h-[70vh] rounded-lg border border-slate-300 bg-white"
                />
              ) : (
                <div className="text-center space-y-2 text-xs text-slate-700">
                  <File className="w-10 h-10 text-emerald-700 mx-auto" />
                  <p className="font-semibold">{previewAttachment.attachment.fileName}</p>
                  <p className="text-slate-500">
                    Pratinjau langsung tidak tersedia untuk format dokumen Office. Silakan klik tombol "Unduh Berkas".
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: REGISTER MANUAL PENGADUAN WBS */}
      {/* ===================================================================== */}
      {isManualModalOpen && canManage && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveManualReport}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 bg-emerald-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">Register Manual Pengaduan WBS</h3>
              <button type="button" onClick={() => setIsManualModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {(['IDENTITAS', 'ANONIM'] as WBSIdentityMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setManIdentityMode(mode)}
                    className={`py-2 px-3 rounded-lg border font-semibold cursor-pointer ${
                      manIdentityMode === mode
                        ? 'bg-emerald-50 border-emerald-600 text-emerald-900'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                  >
                    {mode === 'IDENTITAS' ? 'Dengan Identitas' : 'Anonim (Dirahasiakan)'}
                  </button>
                ))}
              </div>

              {manIdentityMode === 'IDENTITAS' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    required
                    type="text"
                    value={manReporterName}
                    onChange={(e) => setManReporterName(e.target.value)}
                    placeholder="Nama Pelapor *"
                    className="px-3 py-2 border border-slate-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={manReporterPhone}
                    onChange={(e) => setManReporterPhone(e.target.value)}
                    placeholder="No. HP / WhatsApp"
                    className="px-3 py-2 border border-slate-300 rounded-lg"
                  />
                  <input
                    type="email"
                    value={manReporterEmail}
                    onChange={(e) => setManReporterEmail(e.target.value)}
                    placeholder="Email (Opsional)"
                    className="px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kategori Pelanggaran</label>
                  <select
                    value={manCategory}
                    onChange={(e) => setManCategory(e.target.value as WBSViolationCategory)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {WBS_VIOLATION_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Unit Terlapor</label>
                  <select
                    value={manUnitId}
                    onChange={(e) => setManUnitId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <input
                required
                type="text"
                value={manTitle}
                onChange={(e) => setManTitle(e.target.value)}
                placeholder="Judul Ringkas Dugaan Pelanggaran *"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  required
                  type="text"
                  value={manReportedParty}
                  onChange={(e) => setManReportedParty(e.target.value)}
                  placeholder="Pihak Terlapor *"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="date"
                  value={manIncidentDate}
                  onChange={(e) => setManIncidentDate(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <select
                  value={manUrgency}
                  onChange={(e) => setManUrgency(e.target.value as 'Sedang' | 'Tinggi' | 'Kritis')}
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                >
                  <option value="Sedang">Urgensi: Sedang</option>
                  <option value="Tinggi">Urgensi: Tinggi</option>
                  <option value="Kritis">Urgensi: Kritis</option>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={manIncidentLocation}
                  onChange={(e) => setManIncidentLocation(e.target.value)}
                  placeholder="Lokasi Kejadian"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
                <input
                  type="number"
                  min={0}
                  value={manEstimatedLoss}
                  onChange={(e) => setManEstimatedLoss(Number(e.target.value))}
                  placeholder="Estimasi Kerugian (Rp)"
                  className="px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <textarea
                required
                rows={4}
                value={manChronology}
                onChange={(e) => setManChronology(e.target.value)}
                placeholder="Kronologi dugaan pelanggaran *"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />

              {/* Evidence */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                <p className="font-semibold text-slate-800">
                  Lampiran Bukti Permulaan (Link atau Dokumen/Foto Maks. {WBS_MAX_FILE_SIZE_LABEL})
                </p>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={manLinkInput}
                    onChange={(e) => setManLinkInput(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (manLinkInput.trim()) {
                        setManLinks((prev) => [...prev, manLinkInput.trim()]);
                        setManLinkInput('');
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-800 text-white rounded-lg font-semibold"
                  >
                    + Link
                  </button>
                </div>
                <input
                  type="file"
                  multiple
                  accept={WBS_ALLOWED_EXTENSIONS.join(',')}
                  onChange={handleManualFileChange}
                  className="block w-full text-[11px] text-slate-600"
                />
                {manFileErr && <p className="text-rose-700 font-semibold">{manFileErr}</p>}
                {(manLinks.length > 0 || manPendingFiles.length > 0) && (
                  <p className="text-[11px] text-emerald-800 font-semibold">
                    {manLinks.length} tautan &amp; {manPendingFiles.length} berkas siap disimpan.
                  </p>
                )}
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsManualModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={isSavingManual}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                {isSavingManual ? 'Menyimpan...' : 'Simpan Register WBS'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: SURAT TUGAS PENANGANAN WBS */}
      {/* ===================================================================== */}
      {isAssignModalOpen && canManage && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveAssignment}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 bg-indigo-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editingAssign ? 'Edit Surat Tugas Penanganan WBS' : 'Terbitkan Surat Tugas Penanganan WBS'}
              </h3>
              <button type="button" onClick={() => setIsAssignModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tiket Pengaduan WBS *</label>
                <select
                  required
                  value={asReportId}
                  onChange={(e) => handleSelectReportForAssignment(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                >
                  <option value="">-- Pilih Nomor Tiket WBS --</option>
                  {reports.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.ticketNumber} · {r.title} ({r.reportedUnitName})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nomor Surat Tugas *</label>
                  <input
                    required
                    type="text"
                    value={asLetterNumber}
                    onChange={(e) => setAsLetterNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Surat *</label>
                  <input
                    required
                    type="date"
                    value={asLetterDate}
                    onChange={(e) => setAsLetterDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Klasifikasi</label>
                  <select
                    value={asConfidentiality}
                    onChange={(e) => setAsConfidentiality(e.target.value as 'Rahasia' | 'Sangat Rahasia')}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Rahasia">Rahasia</option>
                    <option value="Sangat Rahasia">Sangat Rahasia</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Jenis Penugasan WBS</label>
                  <select
                    value={asType}
                    onChange={(e) => setAsType(e.target.value as WBSAssignment['assignmentType'])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Penelaahan Awal WBS">Penelaahan Awal WBS</option>
                    <option value="Klarifikasi & Verifikasi Lapangan WBS">
                      Klarifikasi &amp; Verifikasi Lapangan WBS
                    </option>
                    <option value="Audit Investigatif WBS">Audit Investigatif WBS</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Penugasan</label>
                  <select
                    value={asStatus}
                    onChange={(e) => setAsStatus(e.target.value as WBSAssignment['status'])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Diterbitkan">Diterbitkan</option>
                    <option value="Berlangsung">Berlangsung</option>
                    <option value="Selesai">Selesai</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Judul Penugasan *</label>
                <input
                  required
                  type="text"
                  value={asTitle}
                  onChange={(e) => setAsTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Dasar Penugasan</label>
                <input
                  required
                  type="text"
                  value={asBasis}
                  onChange={(e) => setAsBasis(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pengendali Mutu</label>
                  <input
                    required
                    type="text"
                    value={asSupervisor}
                    onChange={(e) => setAsSupervisor(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Ketua Tim *</label>
                  <input
                    required
                    type="text"
                    value={asTeamLeader}
                    onChange={(e) => setAsTeamLeader(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Anggota Tim</label>
                  <input
                    type="text"
                    value={asMembers}
                    onChange={(e) => setAsMembers(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Mulai</label>
                  <input
                    type="date"
                    value={asStartDate}
                    onChange={(e) => setAsStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Selesai</label>
                  <input
                    type="date"
                    value={asEndDate}
                    onChange={(e) => setAsEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Tujuan Pemeriksaan</label>
                <textarea
                  rows={2}
                  value={asObjective}
                  onChange={(e) => setAsObjective(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ruang Lingkup</label>
                <textarea
                  rows={2}
                  value={asScope}
                  onChange={(e) => setAsScope(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAssignModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg"
              >
                Simpan &amp; Terbitkan SPT WBS
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: KERTAS KERJA WBS */}
      {/* ===================================================================== */}
      {isKkaModalOpen && canManage && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={(e) => handleSaveKka(e, false)}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 bg-emerald-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editingKka ? 'Edit Kertas Kerja WBS' : 'Buat Kertas Kerja Pemeriksaan WBS'}
              </h3>
              <button type="button" onClick={() => setIsKkaModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Referensi Surat Tugas WBS *</label>
                  <select
                    required
                    value={kkaAssignId}
                    onChange={(e) => setKkaAssignId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  >
                    <option value="">-- Pilih Surat Tugas WBS --</option>
                    {assignments.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.letterNumber} ({a.ticketNumber})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nomor KKA WBS *</label>
                  <input
                    required
                    type="text"
                    value={kkaNumber}
                    onChange={(e) => setKkaNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Judul Pengujian Kertas Kerja *</label>
                <input
                  required
                  type="text"
                  value={kkaTitle}
                  onChange={(e) => setKkaTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Prosedur Pemeriksaan WBS</label>
                <textarea
                  rows={2}
                  value={kkaProcedure}
                  onChange={(e) => setKkaProcedure(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Verifikasi Bukti Permulaan &amp; Dokumen</label>
                <textarea
                  rows={2}
                  value={kkaEvidenceVerified}
                  onChange={(e) => setKkaEvidenceVerified(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ringkasan Klarifikasi / Wawancara Tertutup</label>
                <textarea
                  rows={2}
                  value={kkaInterviewSummary}
                  onChange={(e) => setKkaInterviewSummary(e.target.value)}
                  placeholder="Hasil wawancara terperiksa, saksi internal, dan konfirmasi dokumen..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Fakta &amp; Hasil Pengujian Substantif *</label>
                <textarea
                  required
                  rows={3}
                  value={kkaTestResult}
                  onChange={(e) => setKkaTestResult(e.target.value)}
                  placeholder="Uraikan fakta penyimpangan yang ditemukan secara objektif..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kesimpulan Pengujian</label>
                  <select
                    value={kkaConclusion}
                    onChange={(e) => setKkaConclusion(e.target.value as WBSWorkPaper['conclusion'])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Terbukti (Indikasi Kuat)">Terbukti (Indikasi Kuat)</option>
                    <option value="Terbukti Sebagian / Kelemahan SOP">Terbukti Sebagian / Kelemahan SOP</option>
                    <option value="Tidak Terbukti">Tidak Terbukti</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Indikasi Kerugian (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    value={kkaIndicatedLoss}
                    onChange={(e) => setKkaIndicatedLoss(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pemeriksa / Penyusun</label>
                  <input
                    required
                    type="text"
                    value={kkaPreparer}
                    onChange={(e) => setKkaPreparer(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Analisis Pemeriksa SPI</label>
                <textarea
                  rows={2}
                  value={kkaAnalysis}
                  onChange={(e) => setKkaAnalysis(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Kertas Kerja</label>
                  <select
                    value={kkaStatus}
                    onChange={(e) => setKkaStatus(e.target.value as WBSWorkPaper['status'])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Direviu">Direviu</option>
                    <option value="Disetujui & Dikunci">Disetujui &amp; Dikunci</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Catatan Reviu Kepala SPI</label>
                  <input
                    type="text"
                    value={kkaReviewerNotes}
                    onChange={(e) => setKkaReviewerNotes(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsKkaModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-bold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
              >
                Simpan Draft / Reviu
              </button>
              <button
                type="button"
                onClick={(e) => handleSaveKka(e, true)}
                className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Simpan, Setujui &amp; Kunci</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: LAPORAN HASIL WBS (LHWBS) & KONVERSI OTOMATIS TEMUAN 5C */}
      {/* ===================================================================== */}
      {isResultModalOpen && canManage && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={(e) => handleSaveResult(e, false)}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  {editingResult ? 'Edit Laporan Hasil WBS (LHWBS)' : 'Susun Laporan Hasil WBS (LHWBS)'}
                </h3>
                <p className="text-[11px] text-emerald-300">
                  Dapat langsung diterbitkan dan dikonversi otomatis menjadi Temuan Audit 5C &amp; Rekomendasi SPI.
                </p>
              </div>
              <button type="button" onClick={() => setIsResultModalOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Referensi Kertas Kerja WBS</label>
                  <select
                    value={resKkaId}
                    onChange={(e) => {
                      const k = workPapers.find((w) => w.id === e.target.value);
                      setResKkaId(e.target.value);
                      if (k) setResReportId(k.wbsReportId);
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  >
                    <option value="">-- Pilih KKA WBS (Opsional) --</option>
                    {workPapers.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.kkaNumber} ({k.ticketNumber})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tiket Pengaduan WBS *</label>
                  <select
                    required
                    value={resReportId}
                    onChange={(e) => setResReportId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  >
                    <option value="">-- Pilih Tiket WBS --</option>
                    {reports.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.ticketNumber} · {r.reportedUnitName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nomor LHWBS *</label>
                  <input
                    required
                    type="text"
                    value={resNumber}
                    onChange={(e) => setResNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal LHWBS *</label>
                  <input
                    required
                    type="date"
                    value={resDate}
                    onChange={(e) => setResDate(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status LHWBS</label>
                  <select
                    value={resStatus}
                    onChange={(e) => setResStatus(e.target.value as WBSResultReport['status'])}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Final / Disahkan Kepala SPI">Final / Disahkan Kepala SPI</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Judul Laporan Hasil / Temuan *</label>
                <input
                  required
                  type="text"
                  value={resTitle}
                  onChange={(e) => setResTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kesimpulan Pembuktian</label>
                  <select
                    value={resProofConclusion}
                    onChange={(e) => {
                      const val = e.target.value as WBSResultReport['proofConclusion'];
                      setResProofConclusion(val);
                      setResIsFinding(val !== 'Tidak Terbukti / Selesai');
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Terbukti - Menjadi Temuan 5C">Terbukti - Menjadi Temuan 5C</option>
                    <option value="Terbukti - Pelanggaran Administratif/Disiplin">
                      Terbukti - Pelanggaran Administratif/Disiplin
                    </option>
                    <option value="Tidak Terbukti / Selesai">Tidak Terbukti / Selesai</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tingkat Risiko Temuan</label>
                  <select
                    value={resRiskLevel}
                    onChange={(e) => setResRiskLevel(e.target.value as FindingRiskLevel)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Rendah">Rendah</option>
                    <option value="Sedang">Sedang</option>
                    <option value="Tinggi">Tinggi</option>
                    <option value="Kritis">Kritis</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Potensi Kerugian (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    value={resPotentialLoss}
                    onChange={(e) => setResPotentialLoss(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono"
                  />
                </div>

                <label className="sm:col-span-3 flex items-center gap-2 font-semibold text-emerald-900 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resIsFinding}
                    onChange={(e) => setResIsFinding(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-700"
                  />
                  <span>
                    Tetapkan sebagai Temuan Audit (5C) yang siap disinkronkan ke Matriks Temuan 5C &amp; Tindak Lanjut Rekomendasi
                  </span>
                </label>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ringkasan Eksekutif &amp; Fakta Pemeriksaan</label>
                <textarea
                  rows={2}
                  value={resExecSummary}
                  onChange={(e) => setResExecSummary(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-2"
                  placeholder="Ringkasan eksekutif pemeriksaan WBS..."
                />
                <textarea
                  rows={2}
                  value={resFacts}
                  onChange={(e) => setResFacts(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  placeholder="Uraian fakta hasil pemeriksaan..."
                />
              </div>

              {/* Structured 5C Attributes */}
              <div className="bg-emerald-50/50 border border-emerald-200 rounded-xl p-4 space-y-3">
                <p className="font-bold text-emerald-950 uppercase tracking-wider text-[11px]">
                  Atribut Terstruktur 5C (Condition, Criteria, Cause, Consequence, Corrective Action)
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">1. Condition (Kondisi / Fakta) *</label>
                    <textarea
                      required={resIsFinding}
                      rows={3}
                      value={resCondition}
                      onChange={(e) => setResCondition(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">2. Criteria (Kriteria / SOP / Aturan) *</label>
                    <textarea
                      required={resIsFinding}
                      rows={3}
                      value={resCriteria}
                      onChange={(e) => setResCriteria(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">3. Cause (Sebab / Akar Masalah) *</label>
                    <textarea
                      required={resIsFinding}
                      rows={3}
                      value={resCause}
                      onChange={(e) => setResCause(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">4. Consequence (Akibat / Dampak) *</label>
                    <textarea
                      required={resIsFinding}
                      rows={3}
                      value={resConsequence}
                      onChange={(e) => setResConsequence(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-emerald-200">
                  <label className="block font-semibold text-slate-800">
                    5. Corrective Action (Rekomendasi Perbaikan Otomatis ke TLR) *
                  </label>
                  <textarea
                    required={resIsFinding}
                    rows={2}
                    value={resRecText}
                    onChange={(e) => setResRecText(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={resRecPic}
                      onChange={(e) => setResRecPic(e.target.value)}
                      placeholder="PIC Tindak Lanjut"
                      className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    />
                    <input
                      type="date"
                      value={resRecTarget}
                      onChange={(e) => setResRecTarget(e.target.value)}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    />
                    <input
                      type="text"
                      value={resRecIndicator}
                      onChange={(e) => setResRecIndicator(e.target.value)}
                      placeholder="Indikator Keberhasilan"
                      className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] text-slate-500">
                {editingResult?.syncedFindingNumber
                  ? `Sudah tersinkron ke Temuan 5C: ${editingResult.syncedFindingNumber}`
                  : 'Gunakan tombol kanan untuk menyinkronkan LHWBS langsung ke Temuan 5C.'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsResultModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg"
                >
                  Simpan LHWBS
                </button>
                {resIsFinding && !editingResult?.syncedToFindingId && (
                  <button
                    type="button"
                    onClick={(e) => handleSaveResult(e, true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-lg cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Simpan &amp; Otomatis Masuk ke Temuan 5C</span>
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: KONFIRMASI HAPUS */}
      {/* ===================================================================== */}
      {deleteTarget && canManage && (
        <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Konfirmasi Hapus Data WBS</h3>
            <p className="text-xs text-slate-600">
              Apakah Anda yakin ingin menghapus <span className="font-semibold text-slate-900">{deleteTarget.label}</span>? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-lg"
              >
                Ya, Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PRINT PREVIEW MODAL (REGISTER / SPT WBS / KKA WBS / LHWBS) */}
      {/* ===================================================================== */}
      {printMode && (
        <DocumentPrintPreviewModal
          isOpen={Boolean(printMode)}
          onClose={() => setPrintMode(null)}
          documentTitle={
            printMode.kind === 'register'
              ? `REGISTER PENGADUAN WHISTLEBLOWING SYSTEM (WBS) TAHUN ${selectedYear || 'SEMUA'}`
              : printMode.kind === 'assignment'
              ? `SURAT PERINTAH TUGAS PENANGANAN WBS (RAHASIA)`
              : printMode.kind === 'kka'
              ? `KERTAS KERJA PEMERIKSAAN WBS (RAHASIA)`
              : `LAPORAN HASIL PEMERIKSAAN WBS (LHWBS)`
          }
          documentSubtitle={`${branding.institutionName || 'Perumda Air Minum Tirta Saiyo'} · Satuan Pengawasan Intern`}
          documentNumber={
            printMode.kind === 'register'
              ? `REG-WBS/SPI/${selectedYear || new Date().getFullYear()}`
              : printMode.kind === 'assignment'
              ? (printMode.item as WBSAssignment).letterNumber
              : printMode.kind === 'kka'
              ? (printMode.item as WBSWorkPaper).kkaNumber
              : (printMode.item as WBSResultReport).reportNumber
          }
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          defaultShowSignatory2={printMode.kind === 'result'}
        >
          {() => {
            if (printMode.kind === 'register') {
              return (
                <div className="space-y-4 text-xs text-slate-900">
                  <p>
                    Rekapitulasi Pengaduan Whistleblowing System (WBS) yang diterima dan ditindaklanjuti oleh Satuan Pengawasan Intern (SPI).
                  </p>
                  <table className="w-full border-collapse border border-slate-400 text-[11px]">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-400 p-2 text-left">No.</th>
                        <th className="border border-slate-400 p-2 text-left">No. Tiket</th>
                        <th className="border border-slate-400 p-2 text-left">Identitas</th>
                        <th className="border border-slate-400 p-2 text-left">Judul &amp; Unit</th>
                        <th className="border border-slate-400 p-2 text-left">Kategori</th>
                        <th className="border border-slate-400 p-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scopedReports.map((r, idx) => (
                        <tr key={r.id}>
                          <td className="border border-slate-400 p-2">{idx + 1}</td>
                          <td className="border border-slate-400 p-2 font-mono">{r.ticketNumber}</td>
                          <td className="border border-slate-400 p-2">
                            {r.identityMode === 'ANONIM' ? 'Anonim' : r.reporterName}
                          </td>
                          <td className="border border-slate-400 p-2">
                            <span className="font-semibold block">{r.title}</span>
                            <span>{r.reportedUnitName}</span>
                          </td>
                          <td className="border border-slate-400 p-2">{r.category}</td>
                          <td className="border border-slate-400 p-2">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            if (printMode.kind === 'assignment') {
              const st = printMode.item as WBSAssignment;
              return (
                <div className="space-y-4 text-xs text-slate-900 leading-relaxed">
                  <p className="font-bold text-rose-800 uppercase">
                    KLASIFIKASI DOKUMEN: {st.confidentialityLevel.toUpperCase()}
                  </p>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr>
                        <td className="w-36 font-bold py-1 align-top">Dasar</td>
                        <td className="py-1">: {st.basis}</td>
                      </tr>
                      <tr>
                        <td className="font-bold py-1 align-top">Nomor Tiket WBS</td>
                        <td className="py-1 font-mono">: {st.ticketNumber}</td>
                      </tr>
                      <tr>
                        <td className="font-bold py-1 align-top">Menugaskan</td>
                        <td className="py-1">
                          : Pengendali Mutu: {st.supervisor}
                          <br />
                          &nbsp;&nbsp;Ketua Tim: {st.teamLeader}
                          <br />
                          &nbsp;&nbsp;Anggota Tim: {st.teamMembers}
                        </td>
                      </tr>
                      <tr>
                        <td className="font-bold py-1 align-top">Untuk</td>
                        <td className="py-1">: {st.assignmentTitle} pada {st.unitName}</td>
                      </tr>
                      <tr>
                        <td className="font-bold py-1 align-top">Tujuan</td>
                        <td className="py-1">: {st.objective}</td>
                      </tr>
                      <tr>
                        <td className="font-bold py-1 align-top">Ruang Lingkup</td>
                        <td className="py-1">: {st.scope}</td>
                      </tr>
                      <tr>
                        <td className="font-bold py-1 align-top">Waktu Pelaksanaan</td>
                        <td className="py-1">: {st.startDate} s.d. {st.endDate}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p>
                    Demikian Surat Perintah Tugas Penanganan WBS ini diterbitkan untuk dilaksanakan dengan menjaga kerahasiaan pelapor dan integritas pemeriksaan.
                  </p>
                </div>
              );
            }

            if (printMode.kind === 'kka') {
              const kka = printMode.item as WBSWorkPaper;
              return (
                <div className="space-y-4 text-xs text-slate-900 leading-relaxed">
                  <p>
                    <strong>Nomor Tiket WBS:</strong> {kka.ticketNumber} · <strong>No. SPT WBS:</strong>{' '}
                    {kka.wbsAssignmentNumber || '-'} · <strong>Status:</strong> {kka.status}
                  </p>
                  <div>
                    <h4 className="font-bold border-b border-slate-400 pb-1 mb-1">1. Prosedur Pemeriksaan</h4>
                    <p className="whitespace-pre-line">{kka.procedure}</p>
                  </div>
                  <div>
                    <h4 className="font-bold border-b border-slate-400 pb-1 mb-1">2. Verifikasi Bukti Permulaan</h4>
                    <p className="whitespace-pre-line">{kka.evidenceVerified}</p>
                  </div>
                  <div>
                    <h4 className="font-bold border-b border-slate-400 pb-1 mb-1">3. Hasil Klarifikasi &amp; Pengujian</h4>
                    <p className="whitespace-pre-line mb-1">{kka.interviewSummary}</p>
                    <p className="whitespace-pre-line">{kka.testResult}</p>
                  </div>
                  <div>
                    <h4 className="font-bold border-b border-slate-400 pb-1 mb-1">4. Analisis &amp; Kesimpulan</h4>
                    <p>
                      <strong>Kesimpulan:</strong> {kka.conclusion} ·{' '}
                      <strong>Indikasi Kerugian:</strong> {formatRupiahId(kka.indicatedLoss || 0)}
                    </p>
                    <p className="whitespace-pre-line mt-1">{kka.auditorAnalysis}</p>
                  </div>
                </div>
              );
            }

            const res = printMode.item as WBSResultReport;
            return (
              <div className="space-y-4 text-xs text-slate-900 leading-relaxed">
                <p>
                  <strong>Nomor Tiket WBS:</strong> {res.ticketNumber} · <strong>Unit Kerja:</strong> {res.unitName} ·{' '}
                  <strong>Kesimpulan:</strong> {res.proofConclusion}
                  {res.syncedFindingNumber ? ` · Temuan 5C: ${res.syncedFindingNumber}` : ''}
                </p>
                <div>
                  <h4 className="font-bold border-b border-slate-400 pb-1 mb-1">I. Ringkasan Eksekutif &amp; Fakta Pemeriksaan</h4>
                  <p className="whitespace-pre-line mb-1">{res.executiveSummary}</p>
                  <p className="whitespace-pre-line">{res.examinationFacts}</p>
                </div>
                <div>
                  <h4 className="font-bold border-b border-slate-400 pb-1 mb-1">II. Rumusan Temuan Berstruktur 5C</h4>
                  <p><strong>1. Condition (Kondisi):</strong> {res.condition}</p>
                  <p><strong>2. Criteria (Kriteria):</strong> {res.criteria}</p>
                  <p><strong>3. Cause (Sebab):</strong> {res.cause}</p>
                  <p><strong>4. Consequence (Akibat):</strong> {res.consequence} (Potensi Kerugian: {formatRupiahId(res.potentialLoss || 0)})</p>
                  <p><strong>5. Corrective Action (Rekomendasi):</strong> {res.recommendationText} (PIC: {res.recommendationPic}; Target: {res.recommendationTargetDate})</p>
                </div>
              </div>
            );
          }}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
