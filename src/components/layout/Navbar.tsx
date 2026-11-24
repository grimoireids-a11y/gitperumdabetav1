import React, { useState, useEffect } from 'react';
import {
  Menu,
  Calendar,
  Building,
  Sparkles,
  KeyRound,
  Bell,
  Palette,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuth } from '../../context/AuthContext';
import { ActiveTab } from './Sidebar';
import { ProfileModal } from '../profile/ProfileModal';
import { useAppBranding } from '../../context/AppBrandingContext';
import { useFiscalYear } from '../../context/FiscalYearContext';

interface NavbarProps {
  activeTab: ActiveTab;
  onOpenMobileMenu: () => void;
  isDesktopSidebarHidden?: boolean;
  onToggleDesktopSidebar?: () => void;
  onOpenAiAssistant?: () => void;
  onOpenManualBook?: () => void;
  onNavigateToTab?: (tab: ActiveTab) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onOpenMobileMenu,
  isDesktopSidebarHidden = false,
  onToggleDesktopSidebar,
  onOpenAiAssistant,
  onOpenManualBook,
  onNavigateToTab,
}) => {
  const { userProfile } = useAuth();
  const { branding, getFeatureTitle } = useAppBranding();
  const { activeYear, setActiveYear, availableYears, addCustomYear } = useFiscalYear();
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);

  useEffect(() => {
    if (userProfile?.role === 'KEPALA_SPI' || userProfile?.role === 'ADMIN_SISTEM') {
      const q = query(collection(db, 'users'), where('approvalStatus', '==', 'PENDING'));
      const unsub = onSnapshot(q, (snap) => {
        setPendingApprovalsCount(snap.docs.length);
      });
      return () => unsub();
    }
  }, [userProfile?.role]);

  const getTabTitle = (tab: ActiveTab) => {
    switch (tab) {
      case 'dashboard':
        return getFeatureTitle('dashboard', 'Pusat Kendali Pengawasan (Dashboard SPI)');
      case 'risk_universe':
        return getFeatureTitle('risk_universe', 'Pemilik Risiko & Struktur Proses BUMD');
      case 'audit_universe':
        return getFeatureTitle('audit_universe', 'Audit Universe & Pemetaan Objek Audit (Berbasis Risiko)');
      case 'risk_register':
        return getFeatureTitle('risk_register', 'Register Risiko Korporat (Matriks 5x5)');
      case 'risk_profile':
        return getFeatureTitle('risk_profile', 'Profil Risiko Korporat & Selera Risiko (Khusus Kepala SPI / Super User)');
      case 'risk_annual_report':
        return getFeatureTitle('risk_annual_report', 'Laporan Tahunan Manajemen Risiko (Khusus Kepala SPI / Super User)');
      case 'rcsa':
        return getFeatureTitle('rcsa', 'Penilaian Sendiri Risiko Unit (RCSA)');
      case 'bpkp_assessment':
        return getFeatureTitle('bpkp_assessment', 'Self Assessment Kinerja & Maturitas SPIP Terpadu');
      case 'kpi_management':
        return getFeatureTitle('kpi_management', 'Sistem Manajemen KPI, Cascading 5 Tingkat & Kamus Kinerja');
      case 'rka':
        return getFeatureTitle('rka', 'Rencana Kerja dan Anggaran (Input Manual RKA)');
      case 'finance':
        return getFeatureTitle('finance', 'Modul Manajemen Keuangan Terpadu (Integrasi RKA & Akuntansi)');
      case 'pkpt':
        return getFeatureTitle('pkpt', 'Penyusunan Program Kerja Pengawasan Tahunan (PKPT)');
      case 'spi_programs':
        return getFeatureTitle('spi_programs', 'Program Kerja Tahunan Kapabilitas SPI');
      case 'audit_assignments':
        return getFeatureTitle('audit_assignments', 'Penugasan & Penerbitan Surat Tugas Audit');
      case 'audit_program':
        return getFeatureTitle('audit_program', 'Program Kerja Pemeriksaan (PKA)');
      case 'work_papers':
        return getFeatureTitle('work_papers', 'Kertas Kerja Audit (KKA) & Pengujian Substantif');
      case 'audit_reports':
        return getFeatureTitle('audit_reports', 'Laporan Hasil Audit (LHA) & Pengawasan SPI (Asistensi AI)');
      case 'spi_periodic_reports':
        return getFeatureTitle('spi_periodic_reports', 'Laporan Pengawasan SPI (Bulanan & Tahunan)');
      case 'findings':
        return getFeatureTitle('findings', 'Matriks Temuan Audit 5C & Potensi Kerugian');
      case 'follow_ups':
        return getFeatureTitle('follow_ups', 'Pemantauan & Verifikasi Tindak Lanjut Rekomendasi');
      case 'wbs_management':
        return getFeatureTitle('wbs_management', 'Manajemen Whistleblowing System (WBS) & Konversi Temuan 5C');
      case 'investigations':
        return getFeatureTitle('investigations', 'Audit Investigatif & Penanganan Indikasi Fraud');
      case 'regulations':
        return getFeatureTitle('regulations', 'Basis Data Peraturan & Review Kepatuhan Hukum');
      case 'user_management':
        return getFeatureTitle('user_management', 'Manajemen Pengguna & Otorisasi RBAC');
      case 'master_units':
        return getFeatureTitle('master_units', 'Master Data Unit Kerja & Wilayah Pelayanan');
      case 'signatories':
        return getFeatureTitle('signatories', 'Fitur Jabatan & Pejabat Penandatangan Dokumen');
      case 'app_branding':
        return getFeatureTitle('app_branding', 'Pengaturan Logo, Nama Aplikasi, Fitur & Identitas Kantor');
      default:
        return `Sistem Informasi ${branding.appName || 'SPI SMART'}`;
    }
  };

  const today = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const canEditBranding = userProfile?.role === 'KEPALA_SPI' || userProfile?.role === 'ADMIN_SISTEM';
  const isViewer = userProfile?.role === 'VIEWER';

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 sm:px-6 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="p-2 text-slate-600 rounded-lg lg:hidden hover:bg-slate-100 focus:outline-hidden cursor-pointer shrink-0"
            aria-label="Buka menu navigasi"
            title="Tampilkan Menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {onToggleDesktopSidebar && (
            <button
              type="button"
              onClick={onToggleDesktopSidebar}
              className={`hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isDesktopSidebarHidden
                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300 shadow-2xs'
                  : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200'
              }`}
              title={isDesktopSidebarHidden ? 'Tampilkan Sidebar Menu' : 'Sembunyikan Sidebar Menu'}
              aria-label={isDesktopSidebarHidden ? 'Tampilkan Sidebar Menu' : 'Sembunyikan Sidebar Menu'}
            >
              {isDesktopSidebarHidden ? (
                <>
                  <PanelLeftOpen className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Tampilkan Menu</span>
                </>
              ) : (
                <>
                  <PanelLeftClose className="w-4 h-4 text-slate-600 shrink-0" />
                  <span className="hidden xl:inline">Sembunyikan Menu</span>
                </>
              )}
            </button>
          )}

          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate tracking-tight">
              {getTabTitle(activeTab)}
            </h1>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-medium">
              <span className="flex items-center gap-1 truncate max-w-md">
                <Building className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">{branding.institutionName || 'Perumda Air Minum Tirta Saiyo Kab. Pasaman'}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {/* Pending Registrations Notification for Kepala SPI */}
          {(userProfile?.role === 'KEPALA_SPI' || userProfile?.role === 'ADMIN_SISTEM') && pendingApprovalsCount > 0 && (
            <button
              onClick={() => onNavigateToTab && onNavigateToTab('user_management')}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors animate-pulse"
              title={`${pendingApprovalsCount} pengguna baru menunggu persetujuan Kepala SPI`}
            >
              <Bell className="w-3.5 h-3.5 text-amber-600" />
              <span>{pendingApprovalsCount} Baru</span>
            </button>
          )}

          {/* Global Tahun Anggaran Selector (Multi-Year Support) */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-emerald-50/90 rounded-lg border border-emerald-200/90">
            <Calendar className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
            <span className="hidden lg:inline text-[11px] font-semibold text-emerald-900">Tahun:</span>
            <select
              value={activeYear}
              onChange={(e) => {
                if (e.target.value === 'ADD_CUSTOM') {
                  const input = window.prompt('Masukkan Tahun Anggaran baru (contoh: 2028, 2029, 2030):', String(activeYear + 1));
                  if (input) {
                    const parsed = parseInt(input.trim(), 10);
                    if (!isNaN(parsed) && parsed >= 2000 && parsed <= 2100) {
                      addCustomYear(parsed);
                    }
                  }
                } else {
                  setActiveYear(parseInt(e.target.value, 10));
                }
              }}
              className="bg-transparent text-xs font-extrabold text-emerald-900 focus:outline-hidden cursor-pointer pr-1"
              title="Pilih Tahun Anggaran Aktif (mendukung tahun-tahun berikutnya)"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
              <option value="ADD_CUSTOM">+ Tambah Tahun Lain...</option>
            </select>
          </div>

          {/* Tanggal Hari Ini */}
          <div className="hidden xl:flex items-center gap-1.5 px-3 py-1 text-xs text-slate-600 bg-slate-100/80 rounded-md border border-slate-200/60 font-medium">
            <span>{today}</span>
          </div>

          {/* Quick Branding Settings Trigger for Kepala SPI / Admin */}
          {canEditBranding && onNavigateToTab && (
            <button
              onClick={() => onNavigateToTab('app_branding')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all shadow-2xs ${
                activeTab === 'app_branding'
                  ? 'bg-emerald-800 text-white border-emerald-900 ring-2 ring-emerald-500/30'
                  : 'bg-white hover:bg-emerald-50 text-emerald-950 border-emerald-300'
              }`}
              title="Ganti Logo, Nama Aplikasi, Nama Fitur & Identitas Kantor (Khusus Kepala SPI & Admin)"
            >
              <Palette className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Identitas & Fitur</span>
            </button>
          )}

          {/* Manual Book (PDF) Quick Trigger for All Users */}
          {onOpenManualBook && (
            <button
              onClick={onOpenManualBook}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors shadow-2xs cursor-pointer"
              title="Buka Manual Book Lengkap & Unduh PDF"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-700" />
              <span className="hidden sm:inline">Manual PDF</span>
            </button>
          )}

          {/* AI Assistant Quick Trigger */}
          {onOpenAiAssistant && (
            <button
              onClick={onOpenAiAssistant}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-300/80 rounded-lg transition-colors shadow-2xs"
              title="Buka Asisten AI SPI (Gemini 3.8 Flash)"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Asisten AI SPI</span>
            </button>
          )}

          {/* User Profile & Password Change Trigger (hidden interaction for VIEWER) */}
          {isViewer ? (
            <div className="flex items-center gap-2 pl-2 pr-1 py-1 border-l border-slate-200 text-left">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 text-white flex items-center justify-center font-bold text-xs ring-1 ring-slate-400/40">
                {userProfile?.displayName ? userProfile.displayName.charAt(0).toUpperCase() : 'V'}
              </div>
              <div className="hidden xl:block text-left text-xs leading-tight">
                <p className="font-semibold text-slate-900 truncate max-w-[120px]">
                  {userProfile?.displayName || 'Viewer'}
                </p>
                <p className="text-[10px] text-slate-500 truncate">VIEWER (Lihat & Cetak)</p>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsProfileModalOpen(true)}
              className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl hover:bg-slate-100/80 transition-colors border-l border-slate-200 text-left group"
              title="Klik untuk membuka pengaturan akun & ganti sandi"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-800 to-teal-600 text-white flex items-center justify-center font-bold text-xs ring-1 ring-emerald-600/30 group-hover:ring-emerald-600 transition-all">
                {userProfile?.displayName ? userProfile.displayName.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="hidden xl:block text-left text-xs leading-tight">
                <p className="font-semibold text-slate-900 truncate max-w-[120px] flex items-center gap-1">
                  <span>{userProfile?.displayName || 'Pengguna'}</span>
                  <KeyRound className="w-3 h-3 text-slate-400 group-hover:text-emerald-700 opacity-60" />
                </p>
                <p className="text-[10px] text-slate-500 truncate">{userProfile?.role}</p>
              </div>
            </button>
          )}
        </div>
      </header>

      {/* Modal Profile / Ganti Sandi */}
      {!isViewer && (
        <ProfileModal
          isOpen={isProfileModalOpen}
          onClose={() => setIsProfileModalOpen(false)}
        />
      )}
    </>
  );
};
