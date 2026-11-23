import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import {
  BookOpen,
  Plus,
  Edit2,
  Trash2,
  Printer,
  Search,
  Filter,
  RotateCcw,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { db } from '../../lib/firebase';
import { SPIProgram } from '../../types/audit';
import { useAuth } from '../../context/AuthContext';
import { useAppBranding } from '../../context/AppBrandingContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { FISCAL_MONTHS, FiscalMonthName } from '../../lib/featureCatalog';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';

function resolveProgramMonth(p: SPIProgram): FiscalMonthName {
  if (p.executionMonth) {
    const exact = FISCAL_MONTHS.find((m) => m.toLowerCase() === p.executionMonth!.trim().toLowerCase());
    if (exact) return exact;
  }
  const sched = (p.schedule || '').toLowerCase();
  const matched = FISCAL_MONTHS.find((m) => sched.includes(m.toLowerCase()));
  if (matched) return matched;
  if (sched.includes('q2') || sched.includes('ii')) return 'April';
  if (sched.includes('q3') || sched.includes('iii')) return 'Juli';
  if (sched.includes('q4') || sched.includes('iv')) return 'Oktober';
  return 'Januari';
}

export const SPIProgramsModule: React.FC = () => {
  const { hasRole } = useAuth();
  const { getFeatureLabel } = useAppBranding();
  const { activeYear, availableYears, addCustomYear } = useFiscalYear();

  const [programs, setPrograms] = useState<SPIProgram[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [showMonthlyDashboard, setShowMonthlyDashboard] = useState<boolean>(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [editingProg, setEditingProg] = useState<SPIProgram | null>(null);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  // Form states
  const [formYear, setFormYear] = useState<number>(activeYear);
  const [formActivityName, setFormActivityName] = useState('');
  const [formTarget, setFormTarget] = useState('');
  const [formExecutionMonth, setFormExecutionMonth] = useState<string>('Januari');
  const [formSchedule, setFormSchedule] = useState('');
  const [formPic, setFormPic] = useState('Anggota SPI');
  const [formBudget, setFormBudget] = useState<number>(0);
  const [formKpi, setFormKpi] = useState('');
  const [formRealization, setFormRealization] = useState('');
  const [formStatus, setFormStatus] = useState<'Belum Dimulai' | 'Dalam Proses' | 'Terealisasi'>('Belum Dimulai');

  const canManage = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'spi_programs'), (snap) => {
      setPrograms(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SPIProgram)));
    });
    return () => unsub();
  }, []);

  const yearOptions = React.useMemo(() => {
    const docYears = programs.map((p) => p.year).filter((y) => typeof y === 'number' && y > 0);
    return Array.from(new Set([...availableYears, ...docYears])).sort((a, b) => b - a);
  }, [availableYears, programs]);

  const openAddModal = () => {
    setEditingProg(null);
    setFormYear(selectedYear === 0 ? activeYear : selectedYear);
    setFormActivityName('');
    setFormTarget('');
    const curMonth = FISCAL_MONTHS[new Date().getMonth()];
    setFormExecutionMonth(curMonth);
    setFormSchedule(`Bulan Berjalan (${curMonth})`);
    setFormPic('Tim SPI');
    setFormBudget(15000000);
    setFormKpi('Tersusun dokumen resmi disahkan Direktur Utama');
    setFormRealization('');
    setFormStatus('Belum Dimulai');
    setIsModalOpen(true);
  };

  const openEditModal = (p: SPIProgram) => {
    setEditingProg(p);
    setFormYear(p.year);
    setFormActivityName(p.activityName);
    setFormTarget(p.target);
    setFormExecutionMonth(resolveProgramMonth(p));
    setFormSchedule(p.schedule);
    setFormPic(p.pic);
    setFormBudget(p.budget);
    setFormKpi(p.kpi);
    setFormRealization(p.realization);
    setFormStatus(p.status);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const validYear = isNaN(formYear) ? activeYear : formYear;
    addCustomYear(validYear);
    const data: Omit<SPIProgram, 'id'> = {
      year: validYear,
      activityName: formActivityName,
      target: formTarget,
      executionMonth: formExecutionMonth,
      schedule: formSchedule.trim() || `Bulan Berjalan (${formExecutionMonth})`,
      pic: formPic,
      budget: formBudget,
      kpi: formKpi,
      realization: formRealization,
      status: formStatus,
    };

    try {
      if (editingProg) {
        await updateDoc(doc(db, 'spi_programs', editingProg.id), data);
      } else {
        const id = 'prog-' + Date.now();
        await setDoc(doc(db, 'spi_programs', id), { id, ...data });
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error saving SPI program:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Hapus kegiatan program tahunan SPI ini?')) return;
    try {
      await deleteDoc(doc(db, 'spi_programs', id));
    } catch (err) {
      console.error('Error deleting SPI program:', err);
    }
  };

  const currentCalendarMonth = FISCAL_MONTHS[new Date().getMonth()];

  const dashboardPrograms = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return programs.filter((p) => {
      const matchYear = selectedYear === 0 || p.year === selectedYear;
      const matchStatus = selectedStatus === 'ALL' || p.status === selectedStatus;
      const matchSearch =
        !q ||
        p.activityName.toLowerCase().includes(q) ||
        (p.target || '').toLowerCase().includes(q) ||
        (p.pic || '').toLowerCase().includes(q) ||
        (p.kpi || '').toLowerCase().includes(q);
      return matchYear && matchStatus && matchSearch;
    });
  }, [programs, selectedYear, selectedStatus, searchTerm]);

  const filteredPrograms = useMemo(() => {
    return dashboardPrograms.filter((p) => {
      if (selectedMonth === 'ALL') return true;
      return resolveProgramMonth(p) === selectedMonth;
    });
  }, [dashboardPrograms, selectedMonth]);

  const monthlyBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { month: string; shortMonth: string; count: number; budget: number; realizedCount: number }
    >();
    FISCAL_MONTHS.forEach((m) => {
      map.set(m, { month: m, shortMonth: m.slice(0, 3), count: 0, budget: 0, realizedCount: 0 });
    });
    dashboardPrograms.forEach((p) => {
      const m = resolveProgramMonth(p);
      const entry = map.get(m);
      if (!entry) return;
      entry.count += 1;
      entry.budget += p.budget || 0;
      if (p.status === 'Terealisasi') entry.realizedCount += 1;
    });
    const list = Array.from(map.values());
    const maxBudget = list.reduce((mx, c) => Math.max(mx, c.budget), 0);
    return { list, maxBudget };
  }, [dashboardPrograms]);

  const hasActiveFilters =
    selectedMonth !== 'ALL' || selectedStatus !== 'ALL' || searchTerm.trim() !== '';

  const resetFilters = () => {
    setSearchTerm('');
    setSelectedMonth('ALL');
    setSelectedStatus('ALL');
  };

  const totalBudget = filteredPrograms.reduce((acc, curr) => acc + (curr.budget || 0), 0);
  const terealisasiCount = filteredPrograms.filter((p) => p.status === 'Terealisasi').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-emerald-700" />
            <span>{getFeatureLabel('spi_programs', 'Program Kerja Tahunan Kapabilitas SPI (Non-Audit)')}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Penyusunan Audit Charter, sertifikasi kompetensi auditor, sosialisasi GCG, reviu SOP, dan koordinasi stakeholder pengawasan
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800"
          >
            {yearOptions.map((yr) => (
              <option key={yr} value={yr}>
                Tahun {yr}
              </option>
            ))}
            <option value={0}>Semua Tahun</option>
          </select>

          <button
            onClick={() => setIsPrintModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
            title="Tinjau dan cetak dokumen program tahunan kapabilitas SPI dengan pengesahan jabatan"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-700" />
            <span>Cetak Program SPI</span>
          </button>

          {canManage && (
            <button
              onClick={openAddModal}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Kegiatan</span>
            </button>
          )}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Total Kegiatan</span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">{filteredPrograms.length}</p>
          <span className="text-[10px] text-slate-400">
            Periode ({selectedYear === 0 ? 'Semua Tahun' : `TA ${selectedYear}`})
          </span>
        </div>
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Terealisasi Penuh</span>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">{terealisasiCount}</p>
          <span className="text-[10px] text-emerald-600 font-medium">
            {filteredPrograms.length > 0 ? Math.round((terealisasiCount / filteredPrograms.length) * 100) : 0}% Capaian Target
          </span>
        </div>
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Total Anggaran</span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 font-mono tabular-nums">
            Rp {totalBudget.toLocaleString('id-ID')}
          </p>
          <span className="text-[10px] text-slate-400">Alokasi Anggaran Terfilter</span>
        </div>
      </div>

      {/* Dashboard Bulanan (12 Bulan) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-700" />
              <span>Dashboard Bulanan (Januari – Desember {selectedYear === 0 ? 'Semua Tahun' : selectedYear})</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Bulan Berjalan: <strong className="text-emerald-800">{currentCalendarMonth}</strong> · Klik kartu bulan untuk memfilter list di bawah
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowMonthlyDashboard((prev) => !prev)}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer"
          >
            <span>{showMonthlyDashboard ? 'Tutup' : 'Tampilkan'}</span>
            {showMonthlyDashboard ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {showMonthlyDashboard && (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {monthlyBreakdown.list.map((m) => {
              const isSelected = selectedMonth === m.month;
              const isCurrent = m.month === currentCalendarMonth;
              const pctWidth =
                monthlyBreakdown.maxBudget > 0 && m.budget > 0
                  ? Math.max(8, Math.round((m.budget / monthlyBreakdown.maxBudget) * 100))
                  : 0;
              return (
                <button
                  key={m.month}
                  type="button"
                  onClick={() => setSelectedMonth(isSelected ? 'ALL' : m.month)}
                  className={`text-left p-2.5 rounded-xl border transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-50 border-emerald-600 ring-1 ring-emerald-600'
                      : isCurrent
                      ? 'bg-amber-50/50 border-amber-300'
                      : 'bg-white border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-slate-900">{m.month}</span>
                    {isCurrent && (
                      <span className="text-[9px] font-bold text-amber-800 uppercase">Berjalan</span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono font-bold text-emerald-800 mt-1 tabular-nums truncate">
                    Rp {m.budget.toLocaleString('id-ID')}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                    {m.count} kegiatan · {m.realizedCount} selesai
                  </p>
                  <div className="mt-1.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${pctWidth}%` }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari kegiatan, target, PIC, atau KPI..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <Filter className="w-3.5 h-3.5 text-emerald-700" />
          </div>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Bulan Berjalan</option>
            {FISCAL_MONTHS.map((m) => (
              <option key={m} value={m}>
                Bulan: {m}{m === currentCalendarMonth ? ' (Berjalan)' : ''}
              </option>
            ))}
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Status</option>
            <option value="Belum Dimulai">Belum Dimulai</option>
            <option value="Dalam Proses">Dalam Proses</option>
            <option value="Terealisasi">Terealisasi</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Filter</span>
          </button>
        )}
      </div>

      {/* Program Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-3 px-4 w-12 text-center">No</th>
                <th className="py-3 px-4">Nama Kegiatan Kapabilitas & Tata Kelola</th>
                <th className="py-3 px-4">Target & Indikator Kinerja (KPI)</th>
                <th className="py-3 px-4">Jadwal & PIC</th>
                <th className="py-3 px-4 text-right">Anggaran</th>
                <th className="py-3 px-4 text-center">Status</th>
                {canManage && <th className="py-3 px-4 text-center w-24">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredPrograms.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="py-8 text-center text-slate-400">
                    Belum ada program kerja tahunan SPI non-audit yang didaftarkan pada tahun ini.
                  </td>
                </tr>
              ) : (
                filteredPrograms.map((p, idx) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-4 text-center text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="py-3 px-4">
                      <p className="font-bold text-slate-900">{p.activityName}</p>
                      {p.realization && (
                        <p className="text-[11px] text-emerald-700 mt-0.5">Realisasi: {p.realization}</p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-slate-800 font-medium">{p.target}</p>
                      <span className="text-[10px] text-slate-500">KPI: {p.kpi}</span>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{p.schedule}</p>
                      <span className="text-[10px] text-slate-500">PIC: {p.pic}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                      Rp {p.budget?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded-md ${
                          p.status === 'Terealisasi'
                            ? 'bg-emerald-100 text-emerald-800'
                            : p.status === 'Dalam Proses'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    {canManage && (
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEditModal(p)}
                            className="p-1 text-slate-500 hover:text-emerald-700 rounded-md transition-colors"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(p.id)}
                            className="p-1 text-slate-500 hover:text-rose-600 rounded-md transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add / Edit SPI Program */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editingProg ? 'Ubah Program SPI Non-Audit' : 'Tambah Program Kapabilitas SPI'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-emerald-200 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Nama Kegiatan</label>
                  <input
                    type="text"
                    required
                    value={formActivityName}
                    onChange={(e) => setFormActivityName(e.target.value)}
                    placeholder="Contoh: Pembaruan Piagam Audit (Audit Charter) & Sosialisasi GCG"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tahun Program</label>
                  <input
                    type="number"
                    min={2020}
                    max={2100}
                    required
                    value={formYear}
                    onChange={(e) => setFormYear(parseInt(e.target.value, 10) || activeYear)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Target Kegiatan</label>
                <textarea
                  rows={2}
                  required
                  value={formTarget}
                  onChange={(e) => setFormTarget(e.target.value)}
                  placeholder="Target keluaran kegiatan..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bulan Pelaksanaan</label>
                  <select
                    value={formExecutionMonth}
                    onChange={(e) => {
                      const nextMonth = e.target.value;
                      setFormExecutionMonth(nextMonth);
                      if (!formSchedule || formSchedule.startsWith('Bulan Berjalan')) {
                        setFormSchedule(`Bulan Berjalan (${nextMonth})`);
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    {FISCAL_MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Keterangan Jadwal</label>
                  <input
                    type="text"
                    required
                    value={formSchedule}
                    onChange={(e) => setFormSchedule(e.target.value)}
                    placeholder="Contoh: Bulan Berjalan (Mei)"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">PIC Pelaksana</label>
                  <input
                    type="text"
                    required
                    value={formPic}
                    onChange={(e) => setFormPic(e.target.value)}
                    placeholder="Nama auditor / tim"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Anggaran Biaya (Rp)</label>
                  <input
                    type="number"
                    value={formBudget}
                    onChange={(e) => setFormBudget(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Progres</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Belum Dimulai">Belum Dimulai</option>
                    <option value="Dalam Proses">Dalam Proses</option>
                    <option value="Terealisasi">Terealisasi</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Indikator Kinerja (KPI)</label>
                <input
                  type="text"
                  value={formKpi}
                  onChange={(e) => setFormKpi(e.target.value)}
                  placeholder="Kriteria keberhasilan..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keterangan Realisasi</label>
                <input
                  type="text"
                  value={formRealization}
                  onChange={(e) => setFormRealization(e.target.value)}
                  placeholder="Catatan hasil pelaksanaan..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm"
                >
                  Simpan Program
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Official Print Modal with Fitur Jabatan */}
      {isPrintModalOpen && (
        <DocumentPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          documentTitle="PROGRAM KERJA TAHUNAN PENGEMBANGAN KAPABILITAS SPI"
          documentSubtitle={`Perumda Air Minum Tirta Saiyo Kabupaten Pasaman - Tahun ${selectedYear === 0 ? 'Multi Tahun' : selectedYear}`}
          documentNumber={`PRG-SPI/PTS/${selectedYear === 0 ? activeYear : selectedYear}`}
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
          defaultShowSignatory2={true}
        >
          {() => (
            <div className="space-y-5 text-xs font-serif leading-relaxed">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 grid grid-cols-3 gap-3 font-sans text-xs">
                <div>
                  <p className="text-slate-500">Tahun Program:</p>
                  <p className="font-bold text-slate-900">{selectedYear === 0 ? 'Semua Tahun' : selectedYear}</p>
                </div>
                <div>
                  <p className="text-slate-500">Total Kegiatan Non-Audit:</p>
                  <p className="font-bold text-emerald-800">{filteredPrograms.length} Kegiatan</p>
                </div>
                <div>
                  <p className="text-slate-500">Total Anggaran Pengembangan:</p>
                  <p className="font-bold text-slate-900 font-mono">Rp {totalBudget.toLocaleString('id-ID')}</p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-bold text-slate-900 font-sans uppercase tracking-wider text-xs border-b border-slate-300 pb-1">
                  Matriks Kegiatan Penguatan Kapabilitas & Pengawasan BUMD:
                </h4>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px] border-collapse border border-slate-300 font-sans">
                    <thead>
                      <tr className="bg-slate-100 font-bold text-slate-800 border-b border-slate-300">
                        <th className="p-2 border border-slate-300 w-8 text-center">No</th>
                        <th className="p-2 border border-slate-300">Nama Kegiatan SPI</th>
                        <th className="p-2 border border-slate-300">Sasaran / Output</th>
                        <th className="p-2 border border-slate-300 w-24">Jadwal</th>
                        <th className="p-2 border border-slate-300 w-24 text-right">Anggaran</th>
                        <th className="p-2 border border-slate-300 w-24 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredPrograms.map((p, idx) => (
                        <tr key={p.id}>
                          <td className="p-2 border border-slate-300 text-center font-bold">{idx + 1}</td>
                          <td className="p-2 border border-slate-300 font-bold text-slate-900">{p.activityName}</td>
                          <td className="p-2 border border-slate-300">{p.target}</td>
                          <td className="p-2 border border-slate-300">{p.schedule}</td>
                          <td className="p-2 border border-slate-300 text-right font-mono font-semibold">
                            Rp {p.budget.toLocaleString('id-ID')}
                          </td>
                          <td className="p-2 border border-slate-300 text-center font-semibold">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                p.status === 'Terealisasi'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : p.status === 'Dalam Proses'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
