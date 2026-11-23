import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  Wallet,
  Plus,
  Edit2,
  Trash2,
  Download,
  Search,
  Printer,
  CalendarCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Tags,
  Check,
  X,
  RotateCcw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import {
  RKAItem,
  RKACategory,
  RKACategoryItem,
  RKAStatus,
  Unit,
  PKPT,
  DEFAULT_RKA_CATEGORIES,
} from '../../types/audit';
import { useAuth } from '../../context/AuthContext';
import { useAppBranding } from '../../context/AppBrandingContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import {
  FISCAL_MONTHS,
  formatRkaExecutionSchedule,
  getDefaultMonthForQuarter,
  getQuarterFromMonth,
} from '../../lib/featureCatalog';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';

interface RKAModuleProps {
  onNavigateToPkptWithRka?: (rkaItem: RKAItem) => void;
}

export const calculateRkaWeightScore = (
  budgetAmount: number,
  strategicPriority: 'Tinggi' | 'Sedang' | 'Rendah'
): number => {
  const priorityBase =
    strategicPriority === 'Tinggi' ? 55 : strategicPriority === 'Sedang' ? 35 : 20;
  let budgetBonus = 0;
  if (budgetAmount >= 1_000_000_000) budgetBonus = 45;
  else if (budgetAmount >= 500_000_000) budgetBonus = 35;
  else if (budgetAmount >= 100_000_000) budgetBonus = 25;
  else if (budgetAmount >= 25_000_000) budgetBonus = 15;
  else if (budgetAmount > 0) budgetBonus = 8;
  return Math.min(100, priorityBase + budgetBonus);
};

export const RKAModule: React.FC<RKAModuleProps> = ({ onNavigateToPkptWithRka }) => {
  const { userProfile, hasRole } = useAuth();
  const { getFeatureLabel } = useAppBranding();
  const { activeYear, availableYears, addCustomYear } = useFiscalYear();

  const [rkaList, setRkaList] = useState<RKAItem[]>([]);
  const [pkptList, setPkptList] = useState<PKPT[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [masterCategories, setMasterCategories] = useState<RKACategoryItem[]>([]);
  const [hasLoadedCategories, setHasLoadedCategories] = useState(false);
  const [categoriesMetaInitialized, setCategoriesMetaInitialized] = useState<boolean | null>(null);

  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RKAItem | null>(null);

  // Sync module filter with navbar activeYear change
  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  // Form states
  const [formYear, setFormYear] = useState<number>(activeYear);
  const [formCode, setFormCode] = useState('');
  const [formUnitId, setFormUnitId] = useState('');
  const [formProgramName, setFormProgramName] = useState('');
  const [formCategory, setFormCategory] = useState<RKACategory>('Operasional & Produksi');
  const [isManualCategoryMode, setIsManualCategoryMode] = useState(false);
  const [formManualCategory, setFormManualCategory] = useState('');
  const [saveNewCategoryToMaster, setSaveNewCategoryToMaster] = useState(true);
  const [formBudgetAmount, setFormBudgetAmount] = useState<number>(100000000);
  const [formRealizationAmount, setFormRealizationAmount] = useState<number>(0);
  const [formStrategicPriority, setFormStrategicPriority] = useState<'Tinggi' | 'Sedang' | 'Rendah'>('Tinggi');
  const [formExecutionMonth, setFormExecutionMonth] = useState<string>('Januari');
  const [formPic, setFormPic] = useState('');
  const [formStatus, setFormStatus] = useState<RKAStatus>('Disetujui RKAP');
  const [formNotes, setFormNotes] = useState('');

  // Category CRUD modal states (Super User)
  const [newMasterCategoryName, setNewMasterCategoryName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [syncEditedCategoryToRka, setSyncEditedCategoryToRka] = useState(true);
  const [catSaving, setCatSaving] = useState(false);

  const isSuperUser = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);
  const canManage = hasRole(['KEPALA_SPI', 'AUDITOR', 'ADMIN_SISTEM']);

  useEffect(() => {
    const unsubRka = onSnapshot(collection(db, 'rka_items'), (snap) => {
      setRkaList(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RKAItem)));
    });
    const unsubPkpt = onSnapshot(collection(db, 'pkpt'), (snap) => {
      setPkptList(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PKPT)));
    });
    const unsubUnits = onSnapshot(collection(db, 'units'), (snap) => {
      setUnits(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Unit)));
    });
    const unsubCats = onSnapshot(collection(db, 'rka_categories'), (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RKACategoryItem))
        .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name));
      setMasterCategories(list);
      setHasLoadedCategories(true);
    });
    const unsubMeta = onSnapshot(doc(db, 'app_settings', 'rka_categories_meta'), (snap) => {
      if (snap.exists()) {
        setCategoriesMetaInitialized(Boolean(snap.data()?.initialized));
      } else {
        setCategoriesMetaInitialized(false);
      }
    });

    return () => {
      unsubRka();
      unsubPkpt();
      unsubUnits();
      unsubCats();
      unsubMeta();
    };
  }, []);

  // Auto-seed default RKA categories into Firestore once so Super User can freely Edit / Delete / Add all items
  useEffect(() => {
    if (!hasLoadedCategories || categoriesMetaInitialized !== false || !canManage) return;

    let cancelled = false;
    const seedDefaultsOnce = async () => {
      try {
        const batch = writeBatch(db);
        const existingLower = new Set(masterCategories.map((c) => c.name.trim().toLowerCase()));
        let addedAny = false;

        DEFAULT_RKA_CATEGORIES.forEach((defName, idx) => {
          if (!existingLower.has(defName.toLowerCase())) {
            const catId = `rka-cat-def-${idx + 1}`;
            batch.set(doc(db, 'rka_categories', catId), {
              id: catId,
              name: defName,
              order: idx + 1,
              isDefaultSeed: true,
              createdBy: 'Sistem (Standar RKA)',
              createdAt: new Date().toISOString(),
            });
            addedAny = true;
          }
        });

        batch.set(
          doc(db, 'app_settings', 'rka_categories_meta'),
          {
            initialized: true,
            seededDefaultsCount: addedAny ? DEFAULT_RKA_CATEGORIES.length : 0,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );

        if (!cancelled) {
          await batch.commit();
        }
      } catch (err) {
        console.error('Error seeding default RKA categories:', err);
      }
    };

    seedDefaultsOnce();
    return () => {
      cancelled = true;
    };
  }, [hasLoadedCategories, categoriesMetaInitialized, canManage, masterCategories]);

  const categoryOptions = useMemo(() => {
    if (masterCategories.length > 0 || categoriesMetaInitialized) {
      return Array.from(
        new Set(masterCategories.map((c) => (c.name || '').trim()).filter(Boolean))
      );
    }
    return [...DEFAULT_RKA_CATEGORIES];
  }, [masterCategories, categoriesMetaInitialized]);

  // Usage count per category name for display in Category Manager
  const categoryUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    rkaList.forEach((item) => {
      const key = (item.category || '').trim().toLowerCase();
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [rkaList]);

  const yearOptions = useMemo(() => {
    const docYears = rkaList.map((r) => r.year).filter((y) => typeof y === 'number' && y > 0);
    return Array.from(new Set([...availableYears, ...docYears])).sort((a, b) => b - a);
  }, [availableYears, rkaList]);

  const openAddModal = () => {
    const targetYr = selectedYear === 0 ? activeYear : selectedYear;
    const seq = rkaList.filter((r) => r.year === targetYr).length + 1;
    setEditingItem(null);
    setFormYear(targetYr);
    setFormCode(`RKA-${targetYr}-${String(seq).padStart(3, '0')}`);
    setFormUnitId(units[0]?.id || '');
    setFormProgramName('');
    setFormCategory(categoryOptions[0] || '');
    setIsManualCategoryMode(categoryOptions.length === 0);
    setFormManualCategory('');
    setSaveNewCategoryToMaster(true);
    setFormBudgetAmount(150000000);
    setFormRealizationAmount(0);
    setFormStrategicPriority('Tinggi');
    setFormExecutionMonth('Januari');
    setFormPic(units[0]?.headName || units[0]?.name || 'Kepala Unit Kerja');
    setFormStatus('Disetujui RKAP');
    setFormNotes('');
    setIsModalOpen(true);
  };

  const openEditModal = (item: RKAItem) => {
    setEditingItem(item);
    setFormYear(item.year);
    setFormCode(item.code);
    setFormUnitId(item.unitId);
    setFormProgramName(item.programName);
    setFormCategory(item.category);
    setIsManualCategoryMode(false);
    setFormManualCategory('');
    setSaveNewCategoryToMaster(true);
    setFormBudgetAmount(item.budgetAmount || 0);
    setFormRealizationAmount(item.realizationAmount || 0);
    setFormStrategicPriority(item.strategicPriority || 'Sedang');
    setFormExecutionMonth(
      item.executionMonth && FISCAL_MONTHS.includes(item.executionMonth as any)
        ? item.executionMonth
        : getDefaultMonthForQuarter(item.targetQuarter)
    );
    setFormPic(item.pic || '');
    setFormStatus(item.status || 'Disetujui RKAP');
    setFormNotes(item.notes || '');
    setIsModalOpen(true);
  };

  const handleAddMasterCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperUser) return;
    const cleanName = newMasterCategoryName.trim();
    if (!cleanName) return;
    const alreadyExists = masterCategories.some(
      (c) => c.name.trim().toLowerCase() === cleanName.toLowerCase()
    );
    if (alreadyExists) {
      alert('Bidang / kategori program ini sudah tersedia dalam daftar.');
      return;
    }

    setCatSaving(true);
    try {
      const catId = 'rka-cat-' + Date.now();
      const nextOrder =
        masterCategories.reduce((max, c) => Math.max(max, c.order ?? 0), 0) + 1;
      await setDoc(doc(db, 'rka_categories', catId), {
        id: catId,
        name: cleanName,
        order: nextOrder,
        isDefaultSeed: false,
        createdBy: userProfile?.displayName || 'Super User',
        createdAt: new Date().toISOString(),
      });
      await setDoc(
        doc(db, 'app_settings', 'rka_categories_meta'),
        { initialized: true, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setNewMasterCategoryName('');
    } catch (err) {
      console.error('Error adding RKA category:', err);
      alert('Gagal menambahkan bidang / kategori baru.');
    } finally {
      setCatSaving(false);
    }
  };

  const startEditCategory = (cat: RKACategoryItem) => {
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
  };

  const handleSaveEditCategory = async (cat: RKACategoryItem) => {
    if (!isSuperUser) return;
    const newName = editingCatName.trim();
    if (!newName) {
      alert('Nama Bidang / Kategori Program tidak boleh kosong.');
      return;
    }
    if (newName === cat.name.trim()) {
      setEditingCatId(null);
      setEditingCatName('');
      return;
    }
    const duplicate = masterCategories.some(
      (c) => c.id !== cat.id && c.name.trim().toLowerCase() === newName.toLowerCase()
    );
    if (duplicate) {
      alert(`Bidang / kategori "${newName}" sudah terdaftar.`);
      return;
    }

    setCatSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const batch = writeBatch(db);
      batch.update(doc(db, 'rka_categories', cat.id), {
        name: newName,
        updatedBy: userProfile?.displayName || 'Super User',
        updatedAt: nowIso,
      });

      if (syncEditedCategoryToRka) {
        rkaList.forEach((item) => {
          if ((item.category || '').trim().toLowerCase() === cat.name.trim().toLowerCase()) {
            batch.update(doc(db, 'rka_items', item.id), {
              category: newName,
              updatedAt: nowIso,
            });
          }
        });
      }

      await batch.commit();
      if (selectedCategory === cat.name) {
        setSelectedCategory(newName);
      }
      if (formCategory === cat.name) {
        setFormCategory(newName);
      }
      setEditingCatId(null);
      setEditingCatName('');
    } catch (err) {
      console.error('Error updating RKA category:', err);
      alert('Gagal memperbarui nama bidang / kategori.');
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteMasterCategory = async (cat: RKACategoryItem) => {
    if (!isSuperUser) return;
    const usedCount = categoryUsageCounts.get(cat.name.trim().toLowerCase()) || 0;
    const confirmMsg =
      usedCount > 0
        ? `Hapus bidang / kategori "${cat.name}" dari daftar pilihan?\n(${usedCount} program RKA yang sudah ada tetap menyimpan label lamanya hingga Anda mengubahnya.)`
        : `Hapus bidang / kategori "${cat.name}" dari daftar pilihan?`;
    if (!window.confirm(confirmMsg)) {
      return;
    }

    setCatSaving(true);
    try {
      await deleteDoc(doc(db, 'rka_categories', cat.id));
      await setDoc(
        doc(db, 'app_settings', 'rka_categories_meta'),
        { initialized: true, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      if (selectedCategory === cat.name) {
        setSelectedCategory('ALL');
      }
      if (formCategory === cat.name) {
        const remaining = masterCategories.filter((c) => c.id !== cat.id);
        setFormCategory(remaining[0]?.name || '');
      }
    } catch (err) {
      console.error('Error deleting RKA category:', err);
      alert('Gagal menghapus bidang / kategori.');
    } finally {
      setCatSaving(false);
    }
  };

  const handleRestoreDefaultCategories = async () => {
    if (!isSuperUser) return;
    const existingLower = new Set(masterCategories.map((c) => c.name.trim().toLowerCase()));
    const missing = DEFAULT_RKA_CATEGORIES.filter((d) => !existingLower.has(d.toLowerCase()));
    if (missing.length === 0) {
      alert('Seluruh 6 Bidang / Kategori Program standar sudah tersedia dalam daftar.');
      return;
    }

    setCatSaving(true);
    try {
      const batch = writeBatch(db);
      let maxOrder = masterCategories.reduce((max, c) => Math.max(max, c.order ?? 0), 0);
      missing.forEach((name) => {
        maxOrder += 1;
        const catId = `rka-cat-restore-${Date.now()}-${maxOrder}`;
        batch.set(doc(db, 'rka_categories', catId), {
          id: catId,
          name,
          order: maxOrder,
          isDefaultSeed: true,
          createdBy: userProfile?.displayName || 'Super User',
          createdAt: new Date().toISOString(),
        });
      });
      await batch.commit();
    } catch (err) {
      console.error('Error restoring default RKA categories:', err);
      alert('Gagal memulihkan daftar bidang standar.');
    } finally {
      setCatSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProgramName.trim() || !formCode.trim()) return;

    const chosenCategory = (
      isSuperUser && isManualCategoryMode ? formManualCategory : formCategory
    ).trim();

    if (!chosenCategory) {
      alert('Silakan pilih atau ketik Bidang / Kategori Program terlebih dahulu.');
      return;
    }

    const selUnit = units.find((u) => u.id === formUnitId);
    const unitName = selUnit ? selUnit.name : 'Unit Kerja Tirta Saiyo';
    const validYear = isNaN(formYear) ? activeYear : formYear;
    addCustomYear(validYear);

    const resolvedMonth = FISCAL_MONTHS.includes(formExecutionMonth as any)
      ? formExecutionMonth
      : 'Januari';
    const derivedQuarter = getQuarterFromMonth(resolvedMonth, 'Q1');

    const payload: Omit<RKAItem, 'id'> = {
      year: validYear,
      code: formCode.trim().toUpperCase(),
      unitId: formUnitId,
      unitName,
      programName: formProgramName.trim(),
      category: chosenCategory,
      budgetAmount: Number(formBudgetAmount) || 0,
      realizationAmount: Number(formRealizationAmount) || 0,
      strategicPriority: formStrategicPriority,
      executionMonth: resolvedMonth,
      targetQuarter: derivedQuarter,
      pic: formPic.trim() || unitName,
      notes: formNotes.trim(),
      status: formStatus,
      createdBy: editingItem?.createdBy || userProfile?.displayName || 'SPI',
      createdAt: editingItem?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      // Save custom category to master list if Super User typed a new one
      if (
        isSuperUser &&
        isManualCategoryMode &&
        saveNewCategoryToMaster &&
        !masterCategories.some((c) => c.name.trim().toLowerCase() === chosenCategory.toLowerCase())
      ) {
        const catId = 'rka-cat-' + Date.now();
        const nextOrder =
          masterCategories.reduce((max, c) => Math.max(max, c.order ?? 0), 0) + 1;
        await setDoc(doc(db, 'rka_categories', catId), {
          id: catId,
          name: chosenCategory,
          order: nextOrder,
          isDefaultSeed: false,
          createdBy: userProfile?.displayName || 'Super User',
          createdAt: new Date().toISOString(),
        });
      }

      if (editingItem) {
        await updateDoc(doc(db, 'rka_items', editingItem.id), payload);
      } else {
        const id = 'rka-' + Date.now();
        await setDoc(doc(db, 'rka_items', id), { id, ...payload });
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error saving RKA item:', err);
      alert('Gagal menyimpan data RKA.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Hapus program RKA ini? Jika sudah tertaut ke PKPT, tautan referensi tetap aman namun item RKA ini dihapus.')) return;
    try {
      await deleteDoc(doc(db, 'rka_items', id));
    } catch (err) {
      console.error('Error deleting RKA item:', err);
    }
  };

  const filteredRka = useMemo(() => {
    return rkaList
      .filter((r) => {
        const matchYear = selectedYear === 0 || r.year === selectedYear;
        const matchCat = selectedCategory === 'ALL' || r.category === selectedCategory;
        const q = searchTerm.toLowerCase();
        const matchSearch =
          !q ||
          r.programName.toLowerCase().includes(q) ||
          r.code.toLowerCase().includes(q) ||
          r.unitName.toLowerCase().includes(q);
        return matchYear && matchCat && matchSearch;
      })
      .sort((a, b) => (b.budgetAmount || 0) - (a.budgetAmount || 0));
  }, [rkaList, selectedYear, selectedCategory, searchTerm]);

  const linkedPkptMap = useMemo(() => {
    const map = new Map<string, PKPT>();
    pkptList.forEach((p) => {
      if (p.rkaId) map.set(p.rkaId, p);
    });
    return map;
  }, [pkptList]);

  const totalBudget = filteredRka.reduce((sum, r) => sum + (r.budgetAmount || 0), 0);
  const totalRealization = filteredRka.reduce((sum, r) => sum + (r.realizationAmount || 0), 0);
  const highPriorityCount = filteredRka.filter((r) => r.strategicPriority === 'Tinggi').length;
  const linkedToPkptCount = filteredRka.filter((r) => linkedPkptMap.has(r.id)).length;

  const exportToExcel = () => {
    const rows = filteredRka.map((r, idx) => ({
      No: idx + 1,
      Tahun: r.year,
      'Kode RKA': r.code,
      'Unit Kerja / Pemilik Risiko': r.unitName,
      'Nama Program / Kegiatan RKA': r.programName,
      'Bidang / Kategori': r.category,
      'Pagu Anggaran (Rp)': r.budgetAmount,
      'Realisasi (Rp)': r.realizationAmount || 0,
      'Prioritas Strategis': r.strategicPriority,
      'Bobot Materialitas RKA': calculateRkaWeightScore(r.budgetAmount, r.strategicPriority),
      'Waktu Pelaksanaan': formatRkaExecutionSchedule(r),
      Status: r.status,
      'Masuk PKPT': linkedPkptMap.has(r.id) ? 'Sudah Masuk PKPT' : 'Belum Dijadwalkan',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'RKA');
    XLSX.writeFile(wb, `RKA_Tirta_Saiyo_${selectedYear === 0 ? 'Semua' : selectedYear}.xlsx`);
  };

  // Ensure editing category stays visible in dropdown even if deleted from master later
  const modalCategoryOptions = useMemo(() => {
    if (
      editingItem &&
      editingItem.category &&
      !categoryOptions.some(
        (c) => c.toLowerCase() === editingItem.category.trim().toLowerCase()
      )
    ) {
      return [...categoryOptions, editingItem.category.trim()];
    }
    return categoryOptions;
  }, [categoryOptions, editingItem]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-700" />
            <span>{getFeatureLabel('rka', 'Rencana Kerja dan Anggaran (RKA Manual) & Pengaruh PKPT')}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Input manual program kerja, waktu pelaksanaan bulanan, dan pagu anggaran per unit kerja sebagai basis bobot materialitas penyusunan prioritas PKPT
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setIsPrintModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors shadow-2xs whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-700" />
            <span>Cetak RKA</span>
          </button>

          <button
            onClick={exportToExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-700" />
            <span>Ekspor Excel</span>
          </button>

          {isSuperUser && (
            <button
              onClick={() => setIsCategoryModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              title="Tambah, edit, atau hapus daftar Bidang / Kategori Program RKA"
            >
              <Tags className="w-3.5 h-3.5 text-emerald-700" />
              <span>Kelola Bidang / Kategori</span>
            </button>
          )}

          {canManage && (
            <button
              onClick={openAddModal}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Input RKA Manual</span>
            </button>
          )}
        </div>
      </div>

      {/* Info Banner: Bagaimana RKA Mempengaruhi PKPT */}
      <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50/70 border border-emerald-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-emerald-700" />
            Integrasi Otomatis RKA ke Penyusunan PKPT Berbasis Risiko
          </p>
          <p className="text-[11px] text-emerald-900 leading-relaxed">
            Setiap item RKA yang diinput menghasilkan <strong>Skor Materialitas Anggaran & Prioritas Strategis (0–100)</strong>. Saat menyusun PKPT, skor prioritas audit dihitung dari gabungan{' '}
            <strong>60% Profil Risiko Unit + 40% Bobot Materialitas RKA</strong>, atau klik <strong>“Ke PKPT”</strong> langsung pada baris program RKA.
          </p>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Total Program RKA</span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">{filteredRka.length}</p>
          <span className="text-[10px] text-slate-400">
            Tahun {selectedYear === 0 ? 'Semua Tahun' : selectedYear}
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Total Pagu Anggaran RKA</span>
          <p className="text-xl font-extrabold text-emerald-800 mt-1 tabular-nums">
            Rp {totalBudget.toLocaleString('id-ID')}
          </p>
          <span className="text-[10px] text-slate-400">
            Realisasi: Rp {totalRealization.toLocaleString('id-ID')}
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">RKA Prioritas Tinggi</span>
          <p className="text-2xl font-extrabold text-amber-600 mt-1 tabular-nums">{highPriorityCount}</p>
          <span className="text-[10px] text-amber-700 font-medium">Wajib menjadi perhatian audit SPI</span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Cakupan RKA Masuk PKPT</span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">
            {linkedToPkptCount} / {filteredRka.length}
          </p>
          <span className="text-[10px] text-emerald-700 font-semibold">
            {filteredRka.length > 0 ? Math.round((linkedToPkptCount / filteredRka.length) * 100) : 0}% Terjadwal di PKPT
          </span>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Cari kode RKA, program, atau unit..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
          />
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

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Bidang / Kategori RKA</option>
            {categoryOptions.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* RKA Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-3 px-4 w-36">Kode & Pelaksanaan</th>
                <th className="py-3 px-4">Program Kerja & Anggaran (RKA)</th>
                <th className="py-3 px-4">Pemilik Risiko / Unit</th>
                <th className="py-3 px-4 text-right">Pagu Anggaran</th>
                <th className="py-3 px-4 text-center">Prioritas & Bobot</th>
                <th className="py-3 px-4 text-center">Pengaruh ke PKPT</th>
                <th className="py-3 px-4 text-center w-44">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredRka.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    Belum ada data RKA yang diinput untuk tahun ini. Klik tombol &ldquo;Input RKA Manual&rdquo; untuk menambahkan program anggaran.
                  </td>
                </tr>
              ) : (
                filteredRka.map((item) => {
                  const weight = calculateRkaWeightScore(item.budgetAmount, item.strategicPriority);
                  const linkedPkpt = linkedPkptMap.get(item.id);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 align-top">
                        <span className="font-mono font-bold text-emerald-800 block">{item.code}</span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {formatRkaExecutionSchedule(item)}
                        </span>
                      </td>

                      <td className="py-3 px-4 align-top">
                        <p className="font-bold text-slate-900">{item.programName}</p>
                        <p className="text-[11px] text-slate-500">{item.category}</p>
                        {item.notes && (
                          <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{item.notes}</p>
                        )}
                      </td>

                      <td className="py-3 px-4 align-top">
                        <p className="font-semibold text-slate-800">{item.unitName}</p>
                        <p className="text-[10px] text-slate-500">PIC: {item.pic || '-'}</p>
                      </td>

                      <td className="py-3 px-4 align-top text-right font-mono">
                        <p className="font-bold text-slate-900">
                          Rp {(item.budgetAmount || 0).toLocaleString('id-ID')}
                        </p>
                        {item.realizationAmount ? (
                          <p className="text-[10px] text-emerald-700">
                            Real: Rp {item.realizationAmount.toLocaleString('id-ID')}
                          </p>
                        ) : null}
                      </td>

                      <td className="py-3 px-4 align-top text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md ${
                            item.strategicPriority === 'Tinggi'
                              ? 'bg-rose-100 text-rose-800'
                              : item.strategicPriority === 'Sedang'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {item.strategicPriority}
                        </span>
                        <p className="text-[10px] text-slate-500 font-mono mt-1">
                          Bobot: <strong>{weight}</strong>/100
                        </p>
                      </td>

                      <td className="py-3 px-4 align-top text-center">
                        {linkedPkpt ? (
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-md">
                              <CheckCircle2 className="w-3 h-3" /> Masuk PKPT
                            </span>
                            <span className="text-[10px] text-slate-500 max-w-[140px] truncate" title={linkedPkpt.title}>
                              Skor PKPT: {linkedPkpt.priorityScore}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-md">
                            <AlertTriangle className="w-3 h-3" /> Belum di PKPT
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 align-top text-center">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          {onNavigateToPkptWithRka && !linkedPkpt && (
                            <button
                              onClick={() => onNavigateToPkptWithRka(item)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-md transition-colors cursor-pointer"
                              title="Jadikan objek pengawasan dalam PKPT"
                            >
                              <CalendarCheck className="w-3 h-3" />
                              <span>Ke PKPT</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}

                          {canManage && (
                            <>
                              <button
                                onClick={() => openEditModal(item)}
                                className="p-1 text-slate-500 hover:text-emerald-700 rounded-md transition-colors cursor-pointer"
                                title="Edit RKA"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(item.id)}
                                className="p-1 text-slate-500 hover:text-rose-600 rounded-md transition-colors cursor-pointer"
                                title="Hapus RKA"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add / Edit RKA */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editingItem ? 'Edit Item Program & Anggaran (RKA)' : 'Input Manual Rencana Kerja dan Anggaran (RKA)'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-emerald-200 hover:text-white cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tahun Anggaran</label>
                  <input
                    type="number"
                    required
                    min={2020}
                    max={2100}
                    value={formYear}
                    onChange={(e) => setFormYear(parseInt(e.target.value, 10) || activeYear)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode Rekening / Program RKA</label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="Contoh: RKA-2027-001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Waktu Pelaksanaan</label>
                  <select
                    value={formExecutionMonth}
                    onChange={(e) => setFormExecutionMonth(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    {FISCAL_MONTHS.map((month) => (
                      <option key={month} value={month}>
                        {month} {isNaN(formYear) ? activeYear : formYear}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Program / Kegiatan RKA</label>
                <input
                  type="text"
                  required
                  value={formProgramName}
                  onChange={(e) => setFormProgramName(e.target.value)}
                  placeholder="Contoh: Rehabilitasi Jaringan Pipa Distribusi & Penggantian Water Meter Pelanggan"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pemilik Risiko / Unit Kerja Pelaksana</label>
                  <select
                    value={formUnitId}
                    onChange={(e) => {
                      const uid = e.target.value;
                      setFormUnitId(uid);
                      const found = units.find((u) => u.id === uid);
                      if (found) setFormPic(found.headName || found.name);
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block font-semibold text-slate-700">Bidang / Kategori Program</label>
                    {isSuperUser && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsCategoryModalOpen(true)}
                          className="text-[11px] font-semibold text-slate-600 hover:text-emerald-800 underline cursor-pointer"
                          title="Tambah, edit, atau hapus daftar Bidang / Kategori"
                        >
                          Kelola Daftar
                        </button>
                        <span className="text-slate-300">·</span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextMode = !isManualCategoryMode;
                            setIsManualCategoryMode(nextMode);
                            if (nextMode && !formManualCategory) {
                              setFormManualCategory('');
                            }
                          }}
                          className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
                        >
                          {isManualCategoryMode ? 'Pilih dari Daftar' : '+ Input Manual'}
                        </button>
                      </div>
                    )}
                  </div>

                  {isSuperUser && isManualCategoryMode ? (
                    <div className="space-y-1.5">
                      <input
                        type="text"
                        required
                        value={formManualCategory}
                        onChange={(e) => setFormManualCategory(e.target.value)}
                        placeholder="Ketik bidang / kategori program manual..."
                        className="w-full px-3 py-2 bg-emerald-50/70 border border-emerald-400 rounded-lg font-semibold text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                      />
                      <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={saveNewCategoryToMaster}
                          onChange={(e) => setSaveNewCategoryToMaster(e.target.checked)}
                          className="rounded-xs text-emerald-700 focus:ring-emerald-600"
                        />
                        <span>Simpan bidang ini ke daftar pilihan RKA</span>
                      </label>
                    </div>
                  ) : (
                    <select
                      value={formCategory}
                      onChange={(e) => {
                        if (e.target.value === '__MANUAL__') {
                          setIsManualCategoryMode(true);
                          setFormManualCategory('');
                        } else {
                          setFormCategory(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                    >
                      {modalCategoryOptions.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                      {isSuperUser && (
                        <option value="__MANUAL__">+ Input Bidang / Kategori Manual...</option>
                      )}
                    </select>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pagu Anggaran RKA (Rp)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={formBudgetAmount}
                    onChange={(e) => setFormBudgetAmount(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-emerald-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Realisasi Anggaran s.d. Saat Ini (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    value={formRealizationAmount}
                    onChange={(e) => setFormRealizationAmount(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Prioritas Strategis</label>
                  <select
                    value={formStrategicPriority}
                    onChange={(e) => setFormStrategicPriority(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Tinggi">Tinggi (Program Utama)</option>
                    <option value="Sedang">Sedang</option>
                    <option value="Rendah">Rendah</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status RKA</label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as RKAStatus)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Usulan">Usulan</option>
                    <option value="Disetujui RKAP">Disetujui RKAP</option>
                    <option value="Berjalan">Berjalan</option>
                    <option value="Selesai">Selesai</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Penanggung Jawab (PIC)</label>
                  <input
                    type="text"
                    value={formPic}
                    onChange={(e) => setFormPic(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between">
                <span className="text-[11px] font-semibold text-emerald-900">
                  Estimasi Bobot Pengaruh Materialitas RKA terhadap Prioritas PKPT:
                </span>
                <span className="text-sm font-black font-mono text-emerald-800">
                  {calculateRkaWeightScore(formBudgetAmount, formStrategicPriority)} / 100
                </span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Catatan / Keterangan Anggaran</label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Rincian sumber dana, volume pekerjaan, atau catatan evaluasi SPI..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm cursor-pointer"
                >
                  Simpan Data RKA
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Modal */}
      {isPrintModalOpen && (
        <DocumentPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          documentTitle="REKAPITULASI RENCANA KERJA DAN ANGGARAN (RKA)"
          documentSubtitle={`Tahun Anggaran ${selectedYear === 0 ? 'Multi Tahun' : selectedYear}`}
          documentNumber={`RKA/PTS/${selectedYear === 0 ? activeYear : selectedYear}`}
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
          defaultShowSignatory2={true}
        >
          {() => (
            <div className="space-y-4 text-xs font-sans">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-slate-500">Tahun Anggaran:</p>
                  <p className="font-bold text-slate-900">{selectedYear === 0 ? 'Semua Tahun' : selectedYear}</p>
                </div>
                <div>
                  <p className="text-slate-500">Jumlah Program RKA:</p>
                  <p className="font-bold text-emerald-800">{filteredRka.length} Program</p>
                </div>
                <div>
                  <p className="text-slate-500">Total Pagu Anggaran:</p>
                  <p className="font-bold text-slate-900 font-mono">Rp {totalBudget.toLocaleString('id-ID')}</p>
                </div>
              </div>

              <table className="w-full text-left text-[11px] border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 font-bold text-slate-800">
                    <th className="p-2 border border-slate-300 w-8 text-center">No</th>
                    <th className="p-2 border border-slate-300">Kode & Program RKA</th>
                    <th className="p-2 border border-slate-300">Waktu Pelaksanaan</th>
                    <th className="p-2 border border-slate-300">Pemilik Risiko / Unit</th>
                    <th className="p-2 border border-slate-300 text-right">Pagu Anggaran</th>
                    <th className="p-2 border border-slate-300 text-center">Prioritas</th>
                    <th className="p-2 border border-slate-300 text-center">Bobot RKA</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRka.map((r, i) => (
                    <tr key={r.id}>
                      <td className="p-2 border border-slate-300 text-center">{i + 1}</td>
                      <td className="p-2 border border-slate-300">
                        <p className="font-bold text-slate-900">{r.programName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{r.code} ({r.category})</p>
                      </td>
                      <td className="p-2 border border-slate-300">{formatRkaExecutionSchedule(r)}</td>
                      <td className="p-2 border border-slate-300">{r.unitName}</td>
                      <td className="p-2 border border-slate-300 text-right font-mono font-semibold">
                        Rp {(r.budgetAmount || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="p-2 border border-slate-300 text-center">{r.strategicPriority}</td>
                      <td className="p-2 border border-slate-300 text-center font-mono font-bold">
                        {calculateRkaWeightScore(r.budgetAmount, r.strategicPriority)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DocumentPrintPreviewModal>
      )}

      {/* Modal Kelola Bidang / Kategori Program (Full CRUD Super User) */}
      {isCategoryModalOpen && isSuperUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Tags className="w-4 h-4 text-amber-300" />
                <span>Kelola Bidang / Kategori Program RKA (Super User)</span>
              </h3>
              <button
                onClick={() => {
                  setIsCategoryModalOpen(false);
                  setEditingCatId(null);
                }}
                className="text-emerald-200 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 text-xs overflow-y-auto flex-1">
              {/* Tambah Bidang Baru */}
              <form onSubmit={handleAddMasterCategory} className="space-y-2">
                <label className="block font-semibold text-slate-700">
                  Tambah Bidang / Kategori Program Baru
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    required
                    value={newMasterCategoryName}
                    onChange={(e) => setNewMasterCategoryName(e.target.value)}
                    placeholder="Contoh: Digitalisasi Layanan & IT, Pengadaan Meter Induk..."
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                  />
                  <button
                    type="submit"
                    disabled={catSaving}
                    className="px-3.5 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shrink-0 cursor-pointer disabled:opacity-60"
                  >
                    + Tambah
                  </button>
                </div>
              </form>

              {/* Opsi Sinkronisasi Rename */}
              <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={syncEditedCategoryToRka}
                    onChange={(e) => setSyncEditedCategoryToRka(e.target.checked)}
                    className="rounded-xs text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>Saat mengubah (Edit) nama bidang, perbarui juga data RKA yang memakai bidang tersebut</span>
                </label>
              </div>

              {/* Daftar Lengkap Bidang (Bisa Edit & Hapus Semua) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-slate-700">
                    Daftar Seluruh Bidang / Kategori Program ({masterCategories.length})
                  </p>
                  <button
                    type="button"
                    onClick={handleRestoreDefaultCategories}
                    disabled={catSaving}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
                    title="Tambahkan kembali bidang standar awal yang terhapus"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Pulihkan Standar</span>
                  </button>
                </div>

                {masterCategories.length === 0 ? (
                  <p className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-center">
                    Belum ada Bidang / Kategori Program. Tambahkan melalui formulir di atas atau klik &ldquo;Pulihkan Standar&rdquo;.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {masterCategories.map((cat) => {
                      const isEditing = editingCatId === cat.id;
                      const usageCount = categoryUsageCounts.get(cat.name.trim().toLowerCase()) || 0;

                      return (
                        <li
                          key={cat.id}
                          className="px-3.5 py-2.5 bg-white flex items-center justify-between gap-2 hover:bg-slate-50/70"
                        >
                          {isEditing ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                type="text"
                                value={editingCatName}
                                onChange={(e) => setEditingCatName(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveEditCategory(cat);
                                  } else if (e.key === 'Escape') {
                                    setEditingCatId(null);
                                  }
                                }}
                                className="flex-1 px-2.5 py-1.5 text-xs font-semibold bg-emerald-50/60 border border-emerald-400 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveEditCategory(cat)}
                                disabled={catSaving}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer"
                                title="Simpan perubahan nama bidang"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Simpan</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCatId(null)}
                                className="p-1.5 text-slate-500 hover:text-slate-800 bg-slate-100 rounded-md cursor-pointer"
                                title="Batal edit"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="min-w-0 flex-1">
                                <p className="font-semibold text-slate-800 truncate">{cat.name}</p>
                                <p className="text-[10px] text-slate-400">
                                  Dipakai oleh <strong className="font-mono text-slate-600">{usageCount}</strong> program RKA ·{' '}
                                  {cat.updatedBy
                                    ? `Diubah oleh ${cat.updatedBy}`
                                    : `Sumber: ${cat.createdBy || 'Super User'}`}
                                </p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => startEditCategory(cat)}
                                  disabled={catSaving}
                                  className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors cursor-pointer"
                                  title="Edit nama bidang / kategori"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteMasterCategory(cat)}
                                  disabled={catSaving}
                                  className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                                  title="Hapus bidang / kategori"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => {
                  setIsCategoryModalOpen(false);
                  setEditingCatId(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
