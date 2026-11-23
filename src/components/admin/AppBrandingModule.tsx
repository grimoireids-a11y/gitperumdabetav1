import React, { useState, useEffect, useRef } from 'react';
import {
  Building2,
  Shield,
  Upload,
  RefreshCw,
  Save,
  Check,
  AlertCircle,
  Eye,
  Image,
  Globe,
  Mail,
  Phone,
  MapPin,
  Sparkles,
  Award,
  Layers,
  ArrowRight,
  SlidersHorizontal,
  Search,
  RotateCcw,
} from 'lucide-react';
import { useAppBranding, DEFAULT_BRANDING, AppBrandingConfig } from '../../context/AppBrandingContext';
import { useAuth } from '../../context/AuthContext';
import { APP_FEATURES, APP_SECTIONS } from '../../lib/featureCatalog';

export const AppBrandingModule: React.FC = () => {
  const { branding, updateBranding, resetBranding, canEditBranding } = useAppBranding();
  const { userProfile } = useAuth();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states initialized from current branding
  const [appName, setAppName] = useState(branding.appName);
  const [appTagline, setAppTagline] = useState(branding.appTagline);
  const [appFullName, setAppFullName] = useState(branding.appFullName || '');
  const [institutionName, setInstitutionName] = useState(branding.institutionName);
  const [shortInstitutionName, setShortInstitutionName] = useState(branding.shortInstitutionName);
  const [address, setAddress] = useState(branding.address || '');
  const [phone, setPhone] = useState(branding.phone || '');
  const [email, setEmail] = useState(branding.email || '');
  const [website, setWebsite] = useState(branding.website || '');
  const [logoType, setLogoType] = useState<'default' | 'image'>(branding.logoType);
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl || '');
  const [logoThemeColor, setLogoThemeColor] = useState(branding.logoThemeColor || '#10b981');

  const [activeSubTab, setActiveSubTab] = useState<'identity' | 'features'>('identity');
  const [featureNamesDraft, setFeatureNamesDraft] = useState<Record<string, string>>(branding.featureNames || {});
  const [featureTitlesDraft, setFeatureTitlesDraft] = useState<Record<string, string>>(branding.featureTitles || {});
  const [sectionNamesDraft, setSectionNamesDraft] = useState<Record<string, string>>(branding.sectionNames || {});
  const [featureSearch, setFeatureSearch] = useState('');

  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Keep state synced with current branding
  useEffect(() => {
    setAppName(branding.appName);
    setAppTagline(branding.appTagline);
    setAppFullName(branding.appFullName || '');
    setInstitutionName(branding.institutionName);
    setShortInstitutionName(branding.shortInstitutionName);
    setAddress(branding.address || '');
    setPhone(branding.phone || '');
    setEmail(branding.email || '');
    setWebsite(branding.website || '');
    setLogoType(branding.logoType);
    setLogoUrl(branding.logoUrl || '');
    setLogoThemeColor(branding.logoThemeColor || '#10b981');
    setFeatureNamesDraft(branding.featureNames || {});
    setFeatureTitlesDraft(branding.featureTitles || {});
    setSectionNamesDraft(branding.sectionNames || {});
  }, [branding]);

  // Handle Logo File Upload (PNG, JPG, SVG, WebP)
  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Berkas harus berupa gambar (PNG, JPG, SVG, atau WebP).');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage('Ukuran berkas logo maksimal 2 MB untuk performa optimal.');
      return;
    }

    setErrorMessage(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoUrl(reader.result);
        setLogoType('image');
        setSuccessMessage('Logo berhasil diunggah dan siap disimpan!');
      }
    };
    reader.onerror = () => {
      setErrorMessage('Gagal membaca berkas gambar.');
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditBranding) {
      setErrorMessage('Hanya Kepala SPI dan Administrator Sistem yang berwenang mengubah identitas kantor.');
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const payload: Partial<AppBrandingConfig> = {
        appName: appName.trim() || DEFAULT_BRANDING.appName,
        appTagline: appTagline.trim() || DEFAULT_BRANDING.appTagline,
        appFullName: appFullName.trim() || DEFAULT_BRANDING.appFullName,
        institutionName: institutionName.trim() || DEFAULT_BRANDING.institutionName,
        shortInstitutionName: shortInstitutionName.trim() || DEFAULT_BRANDING.shortInstitutionName,
        address: address.trim(),
        phone: phone.trim(),
        email: email.trim(),
        website: website.trim(),
        logoType,
        logoUrl: logoType === 'image' ? logoUrl : '',
        logoThemeColor,
      };

      await updateBranding(payload);
      setSuccessMessage('Identitas aplikasi, logo, dan nama kantor berhasil diperbarui secara menyeluruh!');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error(err);
      setErrorMessage('Terjadi kesalahan saat menyimpan pengaturan ke server.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!window.confirm('Apakah Anda yakin ingin mengembalikan logo, nama aplikasi, dan nama kantor ke pengaturan bawaan awal?')) {
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      await resetBranding();
      setSuccessMessage('Pengaturan identitas & nama fitur berhasil dikembalikan ke standar awal.');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error(err);
      setErrorMessage('Gagal mengembalikan pengaturan ke awal.');
    } finally {
      setSaving(false);
    }
  };

  const cleanRecordValues = (rec: Record<string, string>) => {
    const cleaned: Record<string, string> = {};
    Object.entries(rec).forEach(([k, v]) => {
      const trimmed = (v || '').trim();
      if (trimmed) cleaned[k] = trimmed;
    });
    return cleaned;
  };

  const handleSaveFeatureNames = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditBranding) {
      setErrorMessage('Hanya Kepala SPI dan Administrator Sistem yang berwenang mengubah nama fitur.');
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const cleanedFeatures = cleanRecordValues(featureNamesDraft);
      const cleanedTitles = cleanRecordValues(featureTitlesDraft);
      const cleanedSections = cleanRecordValues(sectionNamesDraft);
      await updateBranding({
        featureNames: cleanedFeatures,
        featureTitles: cleanedTitles,
        sectionNames: cleanedSections,
      });
      setSuccessMessage('Perubahan nama semua fitur dan kelompok menu berhasil disimpan & diterapkan secara real-time!');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error(err);
      setErrorMessage('Gagal menyimpan perubahan nama fitur ke server.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetAllFeatureNames = async () => {
    if (!window.confirm('Kembalikan seluruh nama fitur dan kelompok menu ke nama standar sistem? (Logo dan identitas kantor tidak berubah.)')) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await updateBranding({
        featureNames: {},
        featureTitles: {},
        sectionNames: {},
      });
      setFeatureNamesDraft({});
      setFeatureTitlesDraft({});
      setSectionNamesDraft({});
      setSuccessMessage('Seluruh nama fitur telah dikembalikan ke nama standar awal.');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error(err);
      setErrorMessage('Gagal mereset nama fitur.');
    } finally {
      setSaving(false);
    }
  };

  const customizedCount =
    Object.values(featureNamesDraft).filter((v) => v && v.trim()).length +
    Object.values(sectionNamesDraft).filter((v) => v && v.trim()).length;

  const colorPresets = [
    { label: 'Hijau Zamrud (Standar)', value: '#10b981' },
    { label: 'Teal Samudera', value: '#0d9488' },
    { label: 'Biru Tirta', value: '#0284c7' },
    { label: 'Biru Navy', value: '#1e3a8a' },
    { label: 'Emas Pasaman', value: '#d97706' },
    { label: 'Merah Marun', value: '#b91c1c' },
  ];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
              <Building2 className="w-5 h-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-800 text-emerald-100 px-2 py-0.5 rounded-md">
                  Hak Khusus Kepala SPI & Admin
                </span>
                <span className="text-xs text-slate-400">Sinkronisasi Real-Time</span>
              </div>
              <h2 className="text-lg font-black text-slate-900 tracking-tight mt-0.5">
                Pengaturan Logo, Nama Aplikasi, Nama Fitur & Identitas Kantor
              </h2>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2 max-w-2xl">
            Ubah logo instansi, nama sistem, nama resmi kantor/BUMD, serta sesuaikan nama seluruh fitur dan menu navigasi aplikasi sesuai tata kelola organisasi Anda.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={handleResetToDefault}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Kembalikan logo, nama kantor, dan nama fitur ke bawaan awal"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Reset Bawaan</span>
          </button>
        </div>
      </div>

      {/* Sub-Tab Switcher */}
      <div className="bg-white p-1.5 rounded-xl border border-slate-200 inline-flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setActiveSubTab('identity')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeSubTab === 'identity'
              ? 'bg-emerald-800 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Logo, Aplikasi & Identitas Kantor</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('features')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            activeSubTab === 'features'
              ? 'bg-emerald-800 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Ubah Nama Semua Fitur ({APP_FEATURES.length} Fitur)</span>
          {customizedCount > 0 && (
            <span
              className={`px-1.5 py-0.5 text-[10px] rounded-md font-mono ${
                activeSubTab === 'features' ? 'bg-amber-400 text-slate-900' : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {customizedCount} diubah
            </span>
          )}
        </button>
      </div>

      {/* Notifications */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 flex items-center gap-2 animate-in fade-in duration-200">
          <Check className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-900 flex items-center gap-2 animate-in fade-in duration-200">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          <span className="font-semibold">{errorMessage}</span>
        </div>
      )}

      {activeSubTab === 'features' && (
        <form onSubmit={handleSaveFeatureNames} className="space-y-5">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-emerald-700" />
                  Penyesuaian Nama Semua Fitur & Kelompok Menu (Super User)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Kosongkan kolom jika ingin memakai nama standar bawaan. Perubahan langsung memperbarui menu Sidebar, judul Navbar, dan navigasi untuk seluruh pengguna.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetAllFeatureNames}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Semua Nama Fitur</span>
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-xs whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Menyimpan...' : 'Simpan Nama Fitur'}</span>
                </button>
              </div>
            </div>

            <div className="relative max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={featureSearch}
                onChange={(e) => setFeatureSearch(e.target.value)}
                placeholder="Cari fitur berdasarkan nama standar atau nama kustom..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
            </div>

            <div className="space-y-5">
              {APP_SECTIONS.map((sec) => {
                const q = featureSearch.trim().toLowerCase();
                const sectionFeatures = APP_FEATURES.filter((f) => {
                  if (f.sectionKey !== sec.key) return false;
                  if (!q) return true;
                  const customName = (featureNamesDraft[f.id] || '').toLowerCase();
                  return (
                    f.defaultLabel.toLowerCase().includes(q) ||
                    f.defaultNavbarTitle.toLowerCase().includes(q) ||
                    f.description.toLowerCase().includes(q) ||
                    customName.includes(q) ||
                    sec.defaultTitle.toLowerCase().includes(q)
                  );
                });

                if (sectionFeatures.length === 0) return null;

                return (
                  <div key={sec.key} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                          Kelompok Menu: {sec.defaultTitle}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          ({sectionFeatures.length} fitur)
                        </span>
                      </div>

                      <div className="flex items-center gap-2 sm:w-80">
                        <input
                          type="text"
                          value={sectionNamesDraft[sec.key] || ''}
                          onChange={(e) =>
                            setSectionNamesDraft((prev) => ({ ...prev, [sec.key]: e.target.value }))
                          }
                          placeholder={`Nama kelompok (default: ${sec.defaultTitle})`}
                          className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                        />
                        {sectionNamesDraft[sec.key]?.trim() && (
                          <button
                            type="button"
                            onClick={() =>
                              setSectionNamesDraft((prev) => {
                                const next = { ...prev };
                                delete next[sec.key];
                                return next;
                              })
                            }
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md"
                            title="Reset nama kelompok ke bawaan"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {sectionFeatures.map((feat) => {
                        const customMenuVal = featureNamesDraft[feat.id] || '';
                        const customTitleVal = featureTitlesDraft[feat.id] || '';
                        const isModified = Boolean(customMenuVal.trim() || customTitleVal.trim());

                        return (
                          <div
                            key={feat.id}
                            className={`p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start ${
                              isModified ? 'bg-emerald-50/30' : 'bg-white'
                            }`}
                          >
                            <div className="lg:col-span-4 space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-900">
                                  {feat.defaultLabel}
                                </span>
                                {isModified && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-sm">
                                    Kustom
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 leading-snug">
                                {feat.description}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400">ID: {feat.id}</p>
                            </div>

                            <div className="lg:col-span-4">
                              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                Nama Fitur (Menu Sidebar)
                              </label>
                              <input
                                type="text"
                                value={customMenuVal}
                                onChange={(e) =>
                                  setFeatureNamesDraft((prev) => ({
                                    ...prev,
                                    [feat.id]: e.target.value,
                                  }))
                                }
                                placeholder={feat.defaultLabel}
                                className="w-full px-3 py-1.5 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                              />
                            </div>

                            <div className="lg:col-span-3">
                              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                Judul Header Halaman (Opsional)
                              </label>
                              <input
                                type="text"
                                value={customTitleVal}
                                onChange={(e) =>
                                  setFeatureTitlesDraft((prev) => ({
                                    ...prev,
                                    [feat.id]: e.target.value,
                                  }))
                                }
                                placeholder={customMenuVal.trim() || feat.defaultNavbarTitle}
                                className="w-full px-3 py-1.5 text-xs text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                              />
                            </div>

                            <div className="lg:col-span-1 flex lg:justify-end pt-5">
                              {isModified ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFeatureNamesDraft((prev) => {
                                      const next = { ...prev };
                                      delete next[feat.id];
                                      return next;
                                    });
                                    setFeatureTitlesDraft((prev) => {
                                      const next = { ...prev };
                                      delete next[feat.id];
                                      return next;
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-rose-700 bg-slate-100 hover:bg-rose-50 rounded-md cursor-pointer"
                                  title="Kembalikan nama fitur ini ke bawaan"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Reset</span>
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400">Standar</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-200">
            <span className="text-xs text-slate-500">
              Total fitur dapat dikustomisasi: <strong className="font-mono">{APP_FEATURES.length}</strong> fitur utama
            </span>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-emerald-800 to-teal-700 hover:from-emerald-900 hover:to-teal-800 rounded-xl shadow-md transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Semua Perubahan Nama Fitur'}</span>
            </button>
          </div>
        </form>
      )}

      {activeSubTab === 'identity' && (
      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Form Controls (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* SECTION 1: LOGO & LAMBANG INSTANSI */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Image className="w-4 h-4 text-emerald-700" />
                  1. Logo & Lambang Instansi
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tentukan lambang resmi yang muncul pada sudut atas aplikasi dan naskah dinas
                </p>
              </div>
            </div>

            {/* Logo Mode Selection */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setLogoType('default')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  logoType === 'default'
                    ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                  <Shield className="w-4 h-4 text-emerald-700" />
                  <span>Logo Default (Perisai SPI)</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Lambang perisai modern dengan aksen warna tema
                </p>
              </button>

              <button
                type="button"
                onClick={() => setLogoType('image')}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  logoType === 'image'
                    ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-500/20'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                  <Upload className="w-4 h-4 text-emerald-700" />
                  <span>Unggah Gambar / Logo Sendiri</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Gunakan file logo resmi kantor (PNG transparan disarankan)
                </p>
              </button>
            </div>

            {/* Custom Logo Upload & URL Box */}
            {logoType === 'image' && (
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleLogoFileChange}
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                />

                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <div className="w-16 h-16 rounded-xl bg-white border border-slate-200 flex items-center justify-center p-2 shrink-0 shadow-2xs">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Preview Logo"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Image className="w-8 h-8 text-slate-300" />
                    )}
                  </div>

                  <div className="space-y-1.5 flex-1 w-full">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Pilih Berkas Logo dari Komputer</span>
                    </button>
                    <p className="text-[10.5px] text-slate-500">
                      Format: PNG (transparan), JPG, SVG, WebP. Maksimal 2 MB.
                    </p>
                  </div>
                </div>

                {/* Direct Image URL input */}
                <div className="pt-2 border-t border-slate-200">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Atau Masukkan Tautan / URL Gambar Logo Web:
                  </label>
                  <input
                    type="url"
                    placeholder="https://example.com/logo-kantor.png"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                  />
                </div>
              </div>
            )}

            {/* Accent Theme Color */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Warna Aksen Lambang / Tema Logo:
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {colorPresets.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setLogoThemeColor(preset.value)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-all cursor-pointer ${
                      logoThemeColor === preset.value
                        ? 'border-slate-800 bg-slate-900 text-white font-bold'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-black/20"
                      style={{ backgroundColor: preset.value }}
                    />
                    <span className="text-[11px]">{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* SECTION 2: NAMA APLIKASI & TAGLINE */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-700" />
                2. Nama Aplikasi & Identitas Sistem
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Nama sistem yang muncul pada bilah judul, logo header, dan tab peramban
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Aplikasi (Singkat) *
                </label>
                <input
                  type="text"
                  required
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  placeholder="SPI SMART"
                  className="w-full px-3 py-2 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Ditampilkan pada sudut atas sidebar dan layar login (Contoh: SPI SMART, SIM-SPI, E-AUDIT).
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tagline / Badge Singkat
                </label>
                <input
                  type="text"
                  value={appTagline}
                  onChange={(e) => setAppTagline(e.target.value)}
                  placeholder="RBIA"
                  className="w-full px-3 py-2 text-xs font-bold text-amber-900 bg-amber-50/50 border border-amber-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  Badge kecil sebelah nama (Contoh: RBIA, BUMD, V2.0).
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Lengkap Sistem Informasi
              </label>
              <input
                type="text"
                value={appFullName}
                onChange={(e) => setAppFullName(e.target.value)}
                placeholder="Sistem Informasi Pengawasan Intern Berbasis Risiko (Risk-Based Internal Audit)"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
            </div>
          </div>

          {/* SECTION 3: NAMA KANTOR & IDENTITAS INSTANSI */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-700" />
                3. Nama Kantor & Instansi BUMD
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Identitas resmi badan usaha yang dicantumkan pada naskah dinas dan seluruh modul
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Resmi Kantor / Instansi Lengkap *
              </label>
              <input
                type="text"
                required
                value={institutionName}
                onChange={(e) => setInstitutionName(e.target.value)}
                placeholder="Perumda Air Minum Tirta Saiyo Kabupaten Pasaman"
                className="w-full px-3 py-2 text-xs font-bold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Digunakan pada judul dokumen LHA, KKA, SPT, naskah dinas cetak, dan dashboard.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nama Singkat / Sebutan Populer Kantor *
              </label>
              <input
                type="text"
                required
                value={shortInstitutionName}
                onChange={(e) => setShortInstitutionName(e.target.value)}
                placeholder="Perumda Tirta Saiyo Pasaman"
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                Ditampilkan pada subtitle sidebar dan navbar atas.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Alamat Kantor & Wilayah
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Lubuk Sikaping, Kabupaten Pasaman, Sumatera Barat"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nomor Telepon Kantor
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(0753) 20123"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Email Resmi Kantor / SPI
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="spi@tirtasaiyo.co.id"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Situs Web Resmi
                </label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="www.tirtasaiyo.co.id"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                />
              </div>
            </div>
          </div>

          {/* Submit Action */}
          <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
            <span className="text-xs text-slate-500">
              Perubahan langsung tersimpan ke server database Firestore
            </span>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-emerald-800 to-teal-700 hover:from-emerald-900 hover:to-teal-800 rounded-xl shadow-md transition-all cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Menyimpan Perubahan...' : 'Simpan Perubahan Identitas'}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Live Real-time Previews (5 Cols) */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-xs space-y-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5" />
              Pratinjau Langsung (Live Preview)
            </h3>
            <p className="text-[11px] text-slate-300">
              Berikut tampilan otomatis perubahan nama & logo pada komponen utama sistem
            </p>
          </div>

          {/* PREVIEW 1: SIDEBAR BRAND HEADER */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              1. Tampilan Header Sidebar (Menu Utama)
            </span>

            <div className="bg-gradient-to-b from-[#0a2f1c] via-[#0d3824] to-[#082416] p-4 rounded-xl text-white shadow-inner flex items-center gap-3">
              <div
                className="flex items-center justify-center w-11 h-11 rounded-xl shadow-md ring-2 ring-emerald-400/20 overflow-hidden shrink-0"
                style={{
                  backgroundColor: logoType === 'image' && logoUrl ? '#ffffff' : logoThemeColor,
                }}
              >
                {logoType === 'image' && logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="w-full h-full object-contain p-1 rounded-xl"
                  />
                ) : (
                  <Shield className="w-6 h-6 text-white" />
                )}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-black tracking-tight text-white truncate">
                    {appName || 'SPI SMART'}
                  </span>
                  {appTagline && (
                    <span className="px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-amber-300 uppercase bg-amber-950/60 border border-amber-600/30 rounded-xs">
                      {appTagline}
                    </span>
                  )}
                </div>
                <p className="text-xs font-medium text-emerald-300 truncate">
                  {shortInstitutionName || 'Perumda Tirta Saiyo'}
                </p>
              </div>
            </div>
          </div>

          {/* PREVIEW 2: NAVBAR HEADER */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              2. Tampilan Bilah Atas (Navbar)
            </span>

            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-900">
                  Pusat Kendali Pengawasan ({appName || 'SPI SMART'})
                </h4>
                <p className="text-[11px] text-slate-500 font-medium flex items-center gap-1 mt-0.5">
                  <Building2 className="w-3 h-3 text-emerald-600" />
                  <span className="truncate max-w-[240px]">
                    {institutionName || 'Perumda Air Minum Tirta Saiyo Kab. Pasaman'}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-1">
                <span className="w-6 h-6 rounded-full bg-emerald-800 text-white font-bold text-[10px] flex items-center justify-center">
                  SPI
                </span>
              </div>
            </div>
          </div>

          {/* PREVIEW 3: LOGIN CARD BANNER */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              3. Tampilan Halaman Masuk (Login Screen)
            </span>

            <div className="bg-gradient-to-b from-[#0a2f1c] to-[#0d3824] p-5 rounded-xl text-white text-center shadow-inner space-y-2">
              <div
                className="inline-flex items-center justify-center w-12 h-12 rounded-xl shadow-lg ring-4 ring-emerald-400/20 overflow-hidden"
                style={{
                  backgroundColor: logoType === 'image' && logoUrl ? '#ffffff' : logoThemeColor,
                }}
              >
                {logoType === 'image' && logoUrl ? (
                  <img
                    src={logoUrl}
                    alt="Logo"
                    className="w-full h-full object-contain p-1 rounded-xl"
                  />
                ) : (
                  <Shield className="w-7 h-7 text-white" />
                )}
              </div>

              <div>
                <h4 className="text-sm font-black tracking-tight text-white flex items-center justify-center gap-1">
                  <span>{appName || 'SPI SMART'}</span>
                  {appTagline && (
                    <span className="text-[9px] font-semibold text-amber-300 bg-amber-950/70 px-1.5 py-0.2 rounded-full border border-amber-600/30">
                      {appTagline}
                    </span>
                  )}
                </h4>
                <p className="text-[11px] text-emerald-200 font-semibold uppercase tracking-wider mt-0.5">
                  {shortInstitutionName || 'Perumda Air Minum Tirta Saiyo'}
                </p>
                <p className="text-[10px] text-emerald-400/80">
                  {address || 'Kabupaten Pasaman, Sumatera Barat'}
                </p>
              </div>
            </div>
          </div>

          {/* PREVIEW 4: KOP DOKUMEN CETAK RESMI */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              4. Header Dokumen Resmi Naskah Dinas
            </span>

            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-300/80 space-y-2 text-slate-900 font-serif">
              <div className="flex items-center gap-3 border-b-2 border-slate-900 pb-2">
                <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center p-1 shrink-0 overflow-hidden">
                  {logoType === 'image' && logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    <Shield className="w-6 h-6 text-emerald-800" />
                  )}
                </div>

                <div className="min-w-0 text-left font-sans">
                  <h5 className="text-[11px] font-black uppercase text-slate-900 leading-tight">
                    {institutionName || 'PERUMDA AIR MINUM TIRTA SAIYO KABUPATEN PASAMAN'}
                  </h5>
                  <p className="text-[9.5px] font-bold text-emerald-900 uppercase">
                    SATUAN PENGAWASAN INTERN (SPI)
                  </p>
                  <p className="text-[8.5px] text-slate-500">
                    {address || 'Lubuk Sikaping, Kabupaten Pasaman'} · Telp: {phone || '-'}
                  </p>
                </div>
              </div>
              <p className="text-[9.5px] text-slate-500 font-sans italic text-center">
                * Ruang kosong kop naskah dinas dapat disesuaikan pada opsi cetak dokumen.
              </p>
            </div>
          </div>
        </div>
      </form>
      )}
    </div>
  );
};
