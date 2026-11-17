import React, { useState, useEffect, useRef } from 'react';
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ShieldAlert,
  UserCheck,
  EyeOff,
  Link2,
  UploadCloud,
  FileText,
  Image as ImageIcon,
  Trash2,
  Send,
  Search,
  CheckCircle2,
  Copy,
  Check,
  Clock,
  AlertCircle,
  Lock,
  Printer,
  MessageSquare,
  Plus,
  Loader2,
  Download,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  WBSIdentityMode,
  WBSReport,
  WBSReportStatus,
  WBSViolationCategory,
  WBSEvidenceAttachment,
  Unit,
} from '../../types/audit';
import { INITIAL_UNITS } from '../../data/initialData';
import {
  PendingLocalWbsFile,
  WBS_MAX_FILE_SIZE_LABEL,
  WBS_VIOLATION_CATEGORIES,
  computeSlaDeadlineIso,
  formatBytes,
  generateWbsTicketNumber,
  persistWbsFileAttachment,
  readFileAsDataUrl,
  validateWbsEvidenceFile,
} from '../../lib/wbsEvidenceHelper';

interface WBSPublicPortalProps {
  initialMode?: 'submit' | 'track';
  institutionName?: string;
}

const WBS_PROGRESS_STAGES = [
  { key: 'Diterima', label: 'Diterima' },
  { key: 'Verifikasi & Penelaahan', label: 'Penelaahan' },
  { key: 'Surat Tugas Diterbitkan', label: 'Surat Tugas' },
  { key: 'Dalam Pemeriksaan WBS', label: 'Pemeriksaan' },
  { key: 'Laporan Hasil Selesai', label: 'Hasil WBS' },
  { key: 'Selesai', label: 'Tindak Lanjut' },
];

function getStageIndex(status: WBSReportStatus): number {
  switch (status) {
    case 'Diterima':
      return 0;
    case 'Verifikasi & Penelaahan':
      return 1;
    case 'Surat Tugas Diterbitkan':
      return 2;
    case 'Dalam Pemeriksaan WBS':
      return 3;
    case 'Laporan Hasil Selesai':
      return 4;
    case 'Menjadi Temuan 5C':
    case 'Tidak Terbukti / Diarsipkan':
      return 5;
    default:
      return 0;
  }
}

export const WBSPublicPortal: React.FC<WBSPublicPortalProps> = ({
  initialMode = 'submit',
  institutionName = 'Perumda Air Minum Tirta Saiyo',
}) => {
  const [portalMode, setPortalMode] = useState<'submit' | 'track'>(initialMode);
  const [unitsList, setUnitsList] = useState<string[]>(() =>
    INITIAL_UNITS.map((u) => u.name)
  );

  // Submit Form State
  const [identityMode, setIdentityMode] = useState<WBSIdentityMode>('ANONIM');
  const [reporterName, setReporterName] = useState('');
  const [reporterIdentityNumber, setReporterIdentityNumber] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');
  const [reporterEmail, setReporterEmail] = useState('');
  const [category, setCategory] = useState<WBSViolationCategory>('Korupsi, Suap & Gratifikasi');
  const [title, setTitle] = useState('');
  const [reportedUnitName, setReportedUnitName] = useState(INITIAL_UNITS[5]?.name || 'Bidang Umum dan Keuangan');
  const [reportedParty, setReportedParty] = useState('');
  const [incidentDate, setIncidentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [incidentLocation, setIncidentLocation] = useState('');
  const [chronology, setChronology] = useState('');
  const [estimatedLossInput, setEstimatedLossInput] = useState('');
  const [evidenceSummaryNote, setEvidenceSummaryNote] = useState('');

  // Preliminary Evidence (Links + Files <= 2MB)
  const [linkUrlDraft, setLinkUrlDraft] = useState('');
  const [linkTitleDraft, setLinkTitleDraft] = useState('');
  const [evidenceLinks, setEvidenceLinks] = useState<Array<{ id: string; title: string; url: string }>>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingLocalWbsFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [createdReport, setCreatedReport] = useState<WBSReport | null>(null);
  const [copiedTicket, setCopiedTicket] = useState(false);

  // Track Ticket State
  const [trackTicketInput, setTrackTicketInput] = useState('');
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackError, setTrackError] = useState('');
  const [trackedReport, setTrackedReport] = useState<WBSReport | null>(null);
  const [followUpMsg, setFollowUpMsg] = useState('');
  const [followUpLink, setFollowUpLink] = useState('');
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const [followUpSuccess, setFollowUpSuccess] = useState('');

  useEffect(() => {
    setPortalMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    getDocs(collection(db, 'units'))
      .then((snap) => {
        if (!snap.empty) {
          const names = snap.docs
            .map((d) => (d.data() as Unit).name)
            .filter(Boolean);
          if (names.length > 0) setUnitsList(names);
        }
      })
      .catch(() => {
        // Fallback to INITIAL_UNITS silently on unauthenticated portal
      });
  }, []);

  const handleAddLink = () => {
    setFormError('');
    const raw = linkUrlDraft.trim();
    if (!raw) return;
    const normalized = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    setEvidenceLinks((prev) => [
      ...prev,
      {
        id: 'lnk-' + Date.now(),
        title: linkTitleDraft.trim() || normalized,
        url: normalized,
      },
    ]);
    setLinkUrlDraft('');
    setLinkTitleDraft('');
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormError('');
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (pendingFiles.length + files.length > 3) {
      setFormError('Maksimal 3 file dokumen/foto yang dapat dilampirkan per pengaduan.');
      e.target.value = '';
      return;
    }

    const nextPending: PendingLocalWbsFile[] = [];
    for (const f of files) {
      const errMsg = validateWbsEvidenceFile(f);
      if (errMsg) {
        setFormError(errMsg);
        e.target.value = '';
        return;
      }
      const dataUrl = await readFileAsDataUrl(f);
      const isPhoto = f.type.startsWith('image/');
      nextPending.push({
        id: 'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        fileName: f.name,
        mimeType: f.type || 'application/octet-stream',
        sizeBytes: f.size,
        kind: isPhoto ? 'PHOTO' : 'DOCUMENT',
        dataUrl,
      });
    }

    setPendingFiles((prev) => [...prev, ...nextPending]);
    e.target.value = '';
  };

  const handleSubmitWbs = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (identityMode === 'IDENTITAS' && !reporterName.trim()) {
      setFormError('Nama lengkap pelapor wajib diisi jika memilih opsi Dengan Identitas.');
      return;
    }
    if (!title.trim() || !reportedParty.trim() || !chronology.trim()) {
      setFormError('Pokok pengaduan, pihak terlapor, dan kronologi kejadian wajib diisi.');
      return;
    }

    setSubmitting(true);
    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const reportId = 'wbs-' + Date.now();
      const ticketNumber = generateWbsTicketNumber(year);

      const attachments: WBSEvidenceAttachment[] = [];

      // Persist links
      for (const lnk of evidenceLinks) {
        attachments.push({
          id: lnk.id,
          kind: 'LINK',
          fileName: lnk.title,
          linkUrl: lnk.url,
          uploadedAt: nowIso,
        });
      }

      // Persist pending files (<= 2 MB each, chunked safely if > 350 KB)
      for (const pf of pendingFiles) {
        const persisted = await persistWbsFileAttachment(reportId, pf);
        attachments.push(persisted);
      }

      const parsedLoss = estimatedLossInput
        ? Number(estimatedLossInput.replace(/[^0-9]/g, '')) || 0
        : 0;

      const urgencyLevel: WBSReport['urgencyLevel'] =
        parsedLoss >= 50_000_000 || category === 'Korupsi, Suap & Gratifikasi'
          ? 'Kritis'
          : parsedLoss >= 10_000_000
          ? 'Tinggi'
          : 'Sedang';

      const newReport: WBSReport = {
        id: reportId,
        ticketNumber,
        year,
        month,
        identityMode,
        reporterName: identityMode === 'ANONIM' ? 'Anonim (Dirahasiakan)' : reporterName.trim(),
        ...(identityMode === 'IDENTITAS' && reporterIdentityNumber.trim()
          ? { reporterIdentityNumber: reporterIdentityNumber.trim() }
          : {}),
        ...(identityMode === 'IDENTITAS' && reporterPhone.trim()
          ? { reporterPhone: reporterPhone.trim() }
          : {}),
        ...(identityMode === 'IDENTITAS' && reporterEmail.trim()
          ? { reporterEmail: reporterEmail.trim() }
          : {}),
        category,
        title: title.trim(),
        reportedUnitName,
        reportedParty: reportedParty.trim(),
        incidentDate,
        incidentLocation: incidentLocation.trim() || reportedUnitName,
        chronology: chronology.trim(),
        estimatedLoss: parsedLoss,
        urgencyLevel,
        attachments,
        evidenceSummaryNote: evidenceSummaryNote.trim(),
        status: 'Diterima',
        slaDeadlineDate: computeSlaDeadlineIso(now, 7),
        publicResponse:
          'Laporan pengaduan Anda telah diterima secara resmi oleh sistem Whistleblowing SPI dan sedang menunggu verifikasi serta penelaahan awal.',
        timeline: [
          {
            id: 'tl-' + Date.now(),
            timestamp: nowIso,
            stage: 'Registrasi Pengaduan',
            status: 'Diterima',
            publicNote: `Pengaduan diterima melalui Portal WBS (${
              identityMode === 'ANONIM' ? 'Mode Anonim' : 'Dengan Identitas'
            }) dengan ${attachments.length} lampiran bukti permulaan.`,
            actor: 'Portal WBS SPI',
          },
        ],
        messages: [],
        sourceChannel: 'Portal WBS Publik',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      try {
        await setDoc(doc(db, 'wbs_reports', reportId), newReport);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `wbs_reports/${reportId}`);
      }

      setCreatedReport(newReport);
      setTrackTicketInput(ticketNumber);
      // Reset form fields
      setTitle('');
      setReportedParty('');
      setIncidentLocation('');
      setChronology('');
      setEstimatedLossInput('');
      setEvidenceSummaryNote('');
      setEvidenceLinks([]);
      setPendingFiles([]);
    } catch (err) {
      console.error('Error submitting WBS report:', err);
      setFormError(
        err instanceof Error
          ? err.message
          : 'Gagal mengirimkan laporan WBS. Periksa koneksi internet Anda.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyTicket = (ticket: string) => {
    navigator.clipboard?.writeText(ticket);
    setCopiedTicket(true);
    setTimeout(() => setCopiedTicket(false), 2500);
  };

  const handleDownloadTicketReceipt = (report: WBSReport) => {
    const content = [
      '====================================================================',
      'TANDA TERIMA PENGADUAN WHISTLEBLOWING SYSTEM (WBS)',
      `Satuan Pengawasan Intern (SPI) - ${institutionName}`,
      '====================================================================',
      `Nomor Tiket Pelacakan : ${report.ticketNumber}`,
      `Tanggal & Waktu Masuk : ${new Date(report.createdAt).toLocaleString('id-ID')}`,
      `Mode Identitas        : ${report.identityMode === 'ANONIM' ? 'ANONIM (Identitas Dirahasiakan)' : `Dengan Identitas (${report.reporterName})`}`,
      `Kategori Pelanggaran  : ${report.category}`,
      `Pokok Pengaduan       : ${report.title}`,
      `Unit Terlapor         : ${report.reportedUnitName}`,
      `Status Saat Ini       : ${report.status}`,
      `Target SLA Telaah     : ${report.slaDeadlineDate || '-'}`,
      '====================================================================',
      'SIMPAN NOMOR TIKET INI DENGAN AMAN.',
      'Gunakan Nomor Tiket di halaman Login -> Tab "Lacak Tiket WBS"',
      'untuk memantau progres penanganan laporan oleh Tim SPI.',
      '====================================================================',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Tiket_WBS_${report.ticketNumber}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const lookupTicket = async (ticketRaw: string) => {
    const normalized = ticketRaw.trim().toUpperCase();
    if (!normalized) {
      setTrackError('Masukkan nomor tiket WBS Anda (contoh: WBS-2026-123456).');
      return;
    }

    setTrackingLoading(true);
    setTrackError('');
    setTrackedReport(null);
    setFollowUpSuccess('');
    try {
      const q = query(
        collection(db, 'wbs_reports'),
        where('ticketNumber', '==', normalized)
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setTrackError(
          `Nomor tiket "${normalized}" tidak ditemukan. Periksa kembali penulisan nomor tiket Anda.`
        );
      } else {
        const docData = snap.docs[0].data() as WBSReport;
        setTrackedReport({ ...docData, id: snap.docs[0].id });
      }
    } catch (err) {
      console.error('Error tracking WBS ticket:', err);
      setTrackError('Gagal melacak tiket dari database. Silakan coba lagi.');
    } finally {
      setTrackingLoading(false);
    }
  };

  const handleTrackSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookupTicket(trackTicketInput);
  };

  const handleSendClarification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackedReport || !followUpMsg.trim()) return;
    setSendingFollowUp(true);
    setFollowUpSuccess('');
    try {
      const nowIso = new Date().toISOString();
      const newMsg = {
        id: 'msg-' + Date.now(),
        sender: 'PELAPOR' as const,
        message: followUpMsg.trim(),
        ...(followUpLink.trim()
          ? {
              attachmentLink: followUpLink.trim().startsWith('http')
                ? followUpLink.trim()
                : `https://${followUpLink.trim()}`,
            }
          : {}),
        createdAt: nowIso,
      };
      const updatedMessages = [...(trackedReport.messages || []), newMsg];
      const updatedTimeline = [
        ...(trackedReport.timeline || []),
        {
          id: 'tl-' + Date.now(),
          timestamp: nowIso,
          stage: 'Keterangan Tambahan Pelapor',
          status: trackedReport.status,
          publicNote: 'Pelapor mengirimkan keterangan/klarifikasi tambahan untuk ditelaah SPI.',
          actor: 'Pelapor (Via Tiket)',
        },
      ];

      await updateDoc(doc(db, 'wbs_reports', trackedReport.id), {
        messages: updatedMessages,
        timeline: updatedTimeline,
        updatedAt: nowIso,
      });

      setTrackedReport({
        ...trackedReport,
        messages: updatedMessages,
        timeline: updatedTimeline,
        updatedAt: nowIso,
      });
      setFollowUpMsg('');
      setFollowUpLink('');
      setFollowUpSuccess('Keterangan tambahan berhasil dikirimkan ke Tim SPI.');
    } catch (err) {
      console.error('Error sending clarification:', err);
      setTrackError('Gagal mengirimkan keterangan tambahan.');
    } finally {
      setSendingFollowUp(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Segmented Switcher: Lapor Sekarang vs Lacak Progres */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
            <span>Portal Whistleblowing System (WBS)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kanal pelaporan dugaan pelanggaran/fraud secara aman, terenkripsi &amp; dilindungi SPI
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg shrink-0">
          <button
            type="button"
            onClick={() => {
              setPortalMode('submit');
              setFormError('');
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
              portalMode === 'submit'
                ? 'bg-emerald-700 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Buat Pengaduan
          </button>
          <button
            type="button"
            onClick={() => {
              setPortalMode('track');
              setTrackError('');
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors cursor-pointer ${
              portalMode === 'track'
                ? 'bg-emerald-700 text-white shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Lacak Tiket WBS
          </button>
        </div>
      </div>

      {/* MODE 1: BUAT PENGADUAN / RECEIPT */}
      {portalMode === 'submit' && createdReport && (
        <div className="p-6 bg-emerald-50 border-2 border-emerald-400 rounded-2xl space-y-4 text-center">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              Laporan WBS Berhasil Diterima
            </p>
            <h3 className="text-lg font-extrabold text-slate-900 mt-1">
              Simpan Nomor Tiket Pelacakan Anda
            </h3>
            <p className="text-xs text-slate-600 mt-1 max-w-md mx-auto">
              Gunakan nomor tiket di bawah ini pada tab <strong>Lacak Tiket WBS</strong> untuk memantau setiap tahapan penanganan oleh SPI.
            </p>
          </div>

          <div className="inline-flex flex-col sm:flex-row items-center gap-3 px-6 py-4 bg-white border-2 border-emerald-600 rounded-xl shadow-sm">
            <span className="text-2xl font-black font-mono tracking-wider text-emerald-900">
              {createdReport.ticketNumber}
            </span>
            <button
              type="button"
              onClick={() => handleCopyTicket(createdReport.ticketNumber)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-900 bg-emerald-100 hover:bg-emerald-200 rounded-lg cursor-pointer"
            >
              {copiedTicket ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedTicket ? 'Tersalin!' : 'Salin Tiket'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-left text-xs bg-white p-3.5 rounded-xl border border-emerald-200">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Mode Identitas</span>
              <span className="font-bold text-slate-900">
                {createdReport.identityMode === 'ANONIM' ? 'Anonim (Rahasia)' : createdReport.reporterName}
              </span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Status Awal</span>
              <span className="font-bold text-emerald-700">{createdReport.status}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase block">Target SLA Penelaahan</span>
              <span className="font-bold text-slate-900">{createdReport.slaDeadlineDate}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => handleDownloadTicketReceipt(createdReport)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              <span>Unduh Tanda Terima (.txt)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const t = createdReport.ticketNumber;
                setCreatedReport(null);
                setPortalMode('track');
                setTrackTicketInput(t);
                lookupTicket(t);
              }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Lacak Progres Tiket Ini Sekarang</span>
            </button>

            <button
              type="button"
              onClick={() => setCreatedReport(null)}
              className="px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
            >
              Buat Laporan Baru Lainnya
            </button>
          </div>
        </div>
      )}

      {portalMode === 'submit' && !createdReport && (
        <form onSubmit={handleSubmitWbs} className="space-y-4 text-xs">
          {/* Jaminan Kerahasiaan */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-amber-950">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed">
              <strong>Jaminan Kerahasiaan &amp; Perlindungan Pelapor:</strong> Seluruh laporan WBS dikelola secara independen dan rahasia oleh Kepala SPI. Pelapor dilindungi dari segala bentuk pembalasan (*non-retaliation*).
            </p>
          </div>

          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg flex items-start gap-2 text-rose-900 font-semibold">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* PILIHAN 2 OPSI IDENTITAS PELAPOR */}
          <div className="space-y-2">
            <label className="block font-bold text-slate-800">
              1. Pilihan Identitas Pelapor <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setIdentityMode('ANONIM')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  identityMode === 'ANONIM'
                    ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500/20'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <EyeOff
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    identityMode === 'ANONIM' ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                />
                <div>
                  <span className="font-extrabold text-slate-900 block">
                    Anonim (Identitas Dirahasiakan)
                  </span>
                  <span className="text-[10.5px] text-slate-500 leading-tight block mt-0.5">
                    Tidak perlu mengisi nama/kontak. Pantau progres dengan Nomor Tiket.
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setIdentityMode('IDENTITAS')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  identityMode === 'IDENTITAS'
                    ? 'bg-emerald-50 border-emerald-600 ring-2 ring-emerald-500/20'
                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <UserCheck
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    identityMode === 'IDENTITAS' ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                />
                <div>
                  <span className="font-extrabold text-slate-900 block">
                    Dengan Identitas Terlindungi
                  </span>
                  <span className="text-[10.5px] text-slate-500 leading-tight block mt-0.5">
                    Memudahkan SPI melakukan konfirmasi resmi dengan kerahasiaan terjaga.
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* Detail Identitas jika memilih IDENTITAS */}
          {identityMode === 'IDENTITAS' && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Lengkap Pelapor <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required={identityMode === 'IDENTITAS'}
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  placeholder="Nama lengkap Anda..."
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-medium"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  NIP / Status / Hubungan (Opsional)
                </label>
                <input
                  type="text"
                  value={reporterIdentityNumber}
                  onChange={(e) => setReporterIdentityNumber(e.target.value)}
                  placeholder="Contoh: Pegawai / Pelanggan / Mitra"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  No. HP / WhatsApp (Opsional)
                </label>
                <input
                  type="text"
                  value={reporterPhone}
                  onChange={(e) => setReporterPhone(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Email Kontak (Opsional)
                </label>
                <input
                  type="email"
                  value={reporterEmail}
                  onChange={(e) => setReporterEmail(e.target.value)}
                  placeholder="email@domain.com"
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          )}

          {/* Informasi Substansi Pengaduan */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                2. Kategori Dugaan Pelanggaran <span className="text-rose-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as WBSViolationCategory)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
              >
                {WBS_VIOLATION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Unit Kerja / Wilayah Terkait <span className="text-rose-500">*</span>
              </label>
              <select
                value={reportedUnitName}
                onChange={(e) => setReportedUnitName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-medium"
              >
                {unitsList.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Judul / Pokok Pengaduan <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ringkasan singkat dugaan penyimpangan yang dilaporkan..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className="block font-semibold text-slate-700 mb-1">
                Pihak Terlapor (Nama/Jabatan) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={reportedParty}
                onChange={(e) => setReportedParty(e.target.value)}
                placeholder="Nama / Jabatan oknum..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Tanggal Kejadian
              </label>
              <input
                type="date"
                value={incidentDate}
                onChange={(e) => setIncidentDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Perkiraan Kerugian (Rp, Opsional)
              </label>
              <input
                type="text"
                value={estimatedLossInput}
                onChange={(e) => setEstimatedLossInput(e.target.value)}
                placeholder="Contoh: 15000000"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Lokasi Spesifik Kejadian
            </label>
            <input
              type="text"
              value={incidentLocation}
              onChange={(e) => setIncidentLocation(e.target.value)}
              placeholder="Contoh: Loket Pembayaran Cabang / Gudang / Lokasi Proyek..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Uraian Kronologi Kejadian (Apa, Siapa, Kapan, Di Mana, Bagaimana) <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              required
              value={chronology}
              onChange={(e) => setChronology(e.target.value)}
              placeholder="Jelaskan kronologi kejadian, modus penyimpangan, saksi/dokumen terkait secara jelas..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg leading-relaxed"
            />
          </div>

          {/* BUKTI PERMULAAN: LINK, DOKUMEN ATAU FOTO MAX 2 MB */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-bold text-slate-900">
                3. Lampiran Bukti Permulaan (Link, Dokumen, atau Foto Maks. {WBS_MAX_FILE_SIZE_LABEL})
              </span>
              <span className="text-[10.5px] font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded">
                Batas file: Maks. {WBS_MAX_FILE_SIZE_LABEL}/file
              </span>
            </div>

            {/* Tambah Link Bukti */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <div className="sm:col-span-4">
                <input
                  type="text"
                  value={linkTitleDraft}
                  onChange={(e) => setLinkTitleDraft(e.target.value)}
                  placeholder="Label bukti link (opsional)"
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-6 relative">
                <Link2 className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={linkUrlDraft}
                  onChange={(e) => setLinkUrlDraft(e.target.value)}
                  placeholder="https://drive.google.com/... (Tautan bukti)"
                  className="w-full pl-8 pr-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddLink}
                  className="w-full flex items-center justify-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Link</span>
                </button>
              </div>
            </div>

            {/* Upload Dokumen atau Foto Maks 2 MB */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,image/*"
                onChange={handleFilePick}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full p-3.5 border-2 border-dashed border-emerald-400/70 hover:border-emerald-600 bg-white hover:bg-emerald-50/40 rounded-xl flex flex-col items-center justify-center gap-1 text-center transition-colors cursor-pointer"
              >
                <UploadCloud className="w-6 h-6 text-emerald-700" />
                <span className="font-bold text-slate-800">
                  Klik untuk Upload Foto atau Dokumen Bukti (Maks. {WBS_MAX_FILE_SIZE_LABEL})
                </span>
                <span className="text-[10.5px] text-slate-500">
                  Format: JPG, PNG, WEBP, PDF, DOC/DOCX, XLS/XLSX (maksimal 3 file)
                </span>
              </button>
            </div>

            {/* Daftar Bukti Terlampir */}
            {(evidenceLinks.length > 0 || pendingFiles.length > 0) && (
              <div className="space-y-1.5 pt-1">
                {evidenceLinks.map((lnk) => (
                  <div
                    key={lnk.id}
                    className="flex items-center justify-between gap-2 p-2 bg-white border border-slate-200 rounded-lg"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Link2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="font-semibold text-slate-800 truncate">{lnk.title}</span>
                      <span className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]">
                        {lnk.url}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setEvidenceLinks((prev) => prev.filter((item) => item.id !== lnk.id))
                      }
                      className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                      title="Hapus link"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {pendingFiles.map((pf) => (
                  <div
                    key={pf.id}
                    className="flex items-center justify-between gap-2 p-2 bg-white border border-emerald-200 rounded-lg"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {pf.kind === 'PHOTO' ? (
                        <ImageIcon className="w-4 h-4 text-emerald-700 shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-amber-700 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-800 truncate">{pf.fileName}</span>
                      <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">
                        {formatBytes(pf.sizeBytes)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingFiles((prev) => prev.filter((item) => item.id !== pf.id))
                      }
                      className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                      title="Hapus file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              type="text"
              value={evidenceSummaryNote}
              onChange={(e) => setEvidenceSummaryNote(e.target.value)}
              placeholder="Catatan tambahan mengenai bukti permulaan (opsional)..."
              className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 text-xs font-extrabold text-white bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 rounded-xl shadow-md transition-all disabled:opacity-60 cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Mengirimkan &amp; Menerbitkan Tiket WBS...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Lapor Sekarang &amp; Dapatkan Nomor Tiket</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* MODE 2: LACAK TIKET WBS */}
      {portalMode === 'track' && (
        <div className="space-y-4 text-xs">
          <form onSubmit={handleTrackSubmit} className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={trackTicketInput}
                onChange={(e) => setTrackTicketInput(e.target.value)}
                placeholder="Masukkan Nomor Tiket WBS Anda (contoh: WBS-2026-123456)"
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold uppercase text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <button
              type="submit"
              disabled={trackingLoading}
              className="flex items-center justify-center gap-1.5 px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs disabled:opacity-60 cursor-pointer shrink-0"
            >
              {trackingLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>Lacak Progres</span>
            </button>
          </form>

          {trackError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-rose-800 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{trackError}</span>
            </div>
          )}

          {trackedReport && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
              {/* Ticket Header Summary */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm text-emerald-900 bg-emerald-100 px-2.5 py-0.5 rounded-md border border-emerald-300">
                      {trackedReport.ticketNumber}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-500">
                      Masuk: {new Date(trackedReport.createdAt).toLocaleDateString('id-ID')}
                    </span>
                  </div>
                  <h3 className="text-sm font-extrabold text-slate-900 mt-1.5">
                    {trackedReport.title}
                  </h3>
                  <p className="text-[11px] text-slate-600">
                    Kategori: <strong>{trackedReport.category}</strong> · Unit Terkait:{' '}
                    <strong>{trackedReport.reportedUnitName}</strong>
                  </p>
                </div>

                <div className="text-right space-y-1">
                  <span className="inline-block px-2.5 py-1 text-[11px] font-extrabold rounded-lg bg-amber-100 text-amber-900 border border-amber-300">
                    {trackedReport.status}
                  </span>
                  {trackedReport.slaDeadlineDate && (
                    <p className="text-[10px] text-slate-500 flex items-center justify-end gap-1">
                      <Clock className="w-3 h-3" />
                      <span>Target Telaah: {trackedReport.slaDeadlineDate}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* 6-Step Progress Stepper */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {WBS_PROGRESS_STAGES.map((stage, idx) => {
                  const activeIdx = getStageIndex(trackedReport.status);
                  const isDone = idx <= activeIdx;
                  const isCurrent = idx === activeIdx;
                  return (
                    <div
                      key={stage.key}
                      className={`p-2 rounded-lg border text-center transition-all ${
                        isCurrent
                          ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                          : isDone
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                          : 'bg-white text-slate-400 border-slate-200'
                      }`}
                    >
                      <span className="text-[10px] font-black block">{idx + 1}</span>
                      <span className="text-[10.5px] font-bold leading-tight block">
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Info Dokumen Terkait (No. Surat Tugas / Temuan 5C) */}
              {(trackedReport.linkedAssignmentNumber ||
                trackedReport.linkedFindingNumber ||
                trackedReport.publicResponse) && (
                <div className="p-3 bg-white border border-emerald-200 rounded-xl space-y-1.5">
                  <span className="text-[11px] font-extrabold text-emerald-900 uppercase tracking-wider block">
                    Pembaruan Resmi dari Tim SPI:
                  </span>
                  {trackedReport.publicResponse && (
                    <p className="text-slate-700 leading-relaxed">{trackedReport.publicResponse}</p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                    {trackedReport.linkedAssignmentNumber && (
                      <span className="px-2 py-0.5 bg-blue-50 border border-blue-200 text-blue-900 rounded font-mono font-bold">
                        Surat Tugas WBS: {trackedReport.linkedAssignmentNumber}
                      </span>
                    )}
                    {trackedReport.linkedFindingNumber && (
                      <span className="px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-900 rounded font-mono font-bold">
                        Tercatat Menjadi Temuan 5C: {trackedReport.linkedFindingNumber}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Timeline Riwayat */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-800">Riwayat Progres Penanganan:</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {[...(trackedReport.timeline || [])]
                    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                    .map((tl) => (
                      <div
                        key={tl.id}
                        className="p-2.5 bg-white border-l-4 border-emerald-600 rounded-r-lg border border-slate-200 space-y-0.5"
                      >
                        <div className="flex items-center justify-between text-[10.5px]">
                          <span className="font-extrabold text-emerald-900">{tl.stage}</span>
                          <span className="text-slate-400 font-mono">
                            {new Date(tl.timestamp).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <p className="text-slate-700 text-[11px]">{tl.publicNote}</p>
                      </div>
                    ))}
                </div>
              </div>

              {/* Komunikasi Dua Arah Rahasia */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2.5">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Kanal Komunikasi &amp; Informasi Susulan</span>
                </h4>

                {trackedReport.messages && trackedReport.messages.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200">
                    {trackedReport.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`p-2 rounded-lg text-[11px] ${
                          m.sender === 'SPI'
                            ? 'bg-emerald-50 border border-emerald-200 text-emerald-950'
                            : 'bg-white border border-slate-200 text-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold text-[10px] mb-0.5">
                          <span>{m.sender === 'SPI' ? 'Tim Pemeriksa SPI' : 'Pelapor (Anda)'}</span>
                          <span className="text-slate-400 font-mono">
                            {new Date(m.createdAt).toLocaleString('id-ID')}
                          </span>
                        </div>
                        <p>{m.message}</p>
                        {m.attachmentLink && (
                          <a
                            href={m.attachmentLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-700 underline text-[10px] inline-block mt-0.5"
                          >
                            Buka Tautan Bukti Susulan
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {followUpSuccess && (
                  <p className="text-[11px] font-bold text-emerald-700">{followUpSuccess}</p>
                )}

                <form onSubmit={handleSendClarification} className="space-y-2">
                  <textarea
                    rows={2}
                    value={followUpMsg}
                    onChange={(e) => setFollowUpMsg(e.target.value)}
                    placeholder="Kirimkan keterangan tambahan atau klarifikasi kepada Tim SPI..."
                    className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={followUpLink}
                      onChange={(e) => setFollowUpLink(e.target.value)}
                      placeholder="Link bukti susulan (opsional, https://...)"
                      className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                    />
                    <button
                      type="submit"
                      disabled={sendingFollowUp || !followUpMsg.trim()}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg disabled:opacity-50 cursor-pointer shrink-0"
                    >
                      {sendingFollowUp ? 'Mengirim...' : 'Kirim Pesan'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
