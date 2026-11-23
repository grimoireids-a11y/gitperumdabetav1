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
  BarChart3,
  Filter,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ShieldCheck,
  GitBranch,
  Calendar,
  Clock,
  AlertCircle,
  MapPin,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { INITIAL_UNITS } from '../../data/initialData';
import {
  RKAItem,
  RKASubItem,
  RKAVerificationStatus,
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
  resolveExecutionMonth,
} from '../../lib/featureCatalog';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';

interface RKAModuleProps {
  onNavigateToPkptWithRka?: (rkaItem: RKAItem) => void;
}

const getTodayIsoDate = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDateId = (dateStr?: string): string => {
  if (!dateStr || !dateStr.trim()) return '-';
  const trimmed = dateStr.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(parsed);
  }
  return trimmed;
};

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
  const [subItems, setSubItems] = useState<RKASubItem[]>([]);
  const [pkptList, setPkptList] = useState<PKPT[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [masterCategories, setMasterCategories] = useState<RKACategoryItem[]>([]);
  const [hasLoadedCategories, setHasLoadedCategories] = useState(false);
  const [categoriesMetaInitialized, setCategoriesMetaInitialized] = useState<boolean | null>(null);

  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('ALL');
  const [selectedPriority, setSelectedPriority] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedPkptStatus, setSelectedPkptStatus] = useState<'ALL' | 'LINKED' | 'UNLINKED'>('ALL');
  const [selectedVerificationFilter, setSelectedVerificationFilter] = useState<string>('ALL');
  const [showMonthlyDashboard, setShowMonthlyDashboard] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedParentIds, setExpandedParentIds] = useState<Record<string, boolean>>({});

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RKAItem | null>(null);

  // Sync module filter with navbar activeYear change
  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  // Form states (Parent Pos Induk — tanpa waktu pelaksanaan & realisasi)
  const [formYear, setFormYear] = useState<number>(activeYear);
  const [formCode, setFormCode] = useState('');
  const [formUnitId, setFormUnitId] = useState('');
  const [formProgramName, setFormProgramName] = useState('');
  const [formCategory, setFormCategory] = useState<RKACategory>('Operasional & Produksi');
  const [isManualCategoryMode, setIsManualCategoryMode] = useState(false);
  const [formManualCategory, setFormManualCategory] = useState('');
  const [saveNewCategoryToMaster, setSaveNewCategoryToMaster] = useState(true);
  const [formBudgetAmount, setFormBudgetAmount] = useState<number>(100000000);
  const [formStrategicPriority, setFormStrategicPriority] = useState<'Tinggi' | 'Sedang' | 'Rendah'>('Tinggi');
  const [formPic, setFormPic] = useState('');
  const [formStatus, setFormStatus] = useState<RKAStatus>('Disetujui RKAP');
  const [formNotes, setFormNotes] = useState('');

  // Sub-Program Kerja & Realisasi modal states (Berjenjang)
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [subParentItem, setSubParentItem] = useState<RKAItem | null>(null);
  const [editingSubItem, setEditingSubItem] = useState<RKASubItem | null>(null);
  const [subFormCode, setSubFormCode] = useState('');
  const [subFormProgramName, setSubFormProgramName] = useState('');
  const [subFormExecutionMonth, setSubFormExecutionMonth] = useState<string>('Januari');
  const [subFormLocationUnitId, setSubFormLocationUnitId] = useState<string>('');
  const [subFormAllocatedBudget, setSubFormAllocatedBudget] = useState<number>(0);
  const [subFormRealizationAmount, setSubFormRealizationAmount] = useState<number>(0);
  const [subFormRealizationDate, setSubFormRealizationDate] = useState<string>('');
  const [subFormStatus, setSubFormStatus] = useState<RKAStatus>('Berjalan');
  const [subFormPic, setSubFormPic] = useState('');
  const [subFormNotes, setSubFormNotes] = useState('');
  const [subSaving, setSubSaving] = useState(false);

  // Verifikasi Bidang Keuangan modal states
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<
    | { mode: 'sub'; sub: RKASubItem; parent: RKAItem }
    | { mode: 'parent'; parent: RKAItem }
    | null
  >(null);
  const [verifyRealizationAmount, setVerifyRealizationAmount] = useState<number>(0);
  const [verifyRealizationDate, setVerifyRealizationDate] = useState<string>('');
  const [verifyStatus, setVerifyStatus] = useState<RKAVerificationStatus>('Terverifikasi Keuangan');
  const [verifyDate, setVerifyDate] = useState<string>(getTodayIsoDate());
  const [verifyBy, setVerifyBy] = useState<string>('');
  const [verifyNotes, setVerifyNotes] = useState<string>('');
  const [verifySaving, setVerifySaving] = useState(false);

  // Category CRUD modal states (Super User)
  const [newMasterCategoryName, setNewMasterCategoryName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [syncEditedCategoryToRka, setSyncEditedCategoryToRka] = useState(true);
  const [catSaving, setCatSaving] = useState(false);

  const isSuperUser = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);
  const canManage = hasRole(['KEPALA_SPI', 'AUDITOR', 'ADMIN_SISTEM']);
  const isBidangKeuangan = hasRole(['BIDANG_KEUANGAN']);
  const canManageSub = hasRole(['BIDANG_KEUANGAN', 'KEPALA_SPI', 'AUDITOR', 'ADMIN_SISTEM']);
  const canVerifyFinance = hasRole(['BIDANG_KEUANGAN', 'KEPALA_SPI', 'ADMIN_SISTEM']);

  useEffect(() => {
    const unsubRka = onSnapshot(collection(db, 'rka_items'), (snap) => {
      setRkaList(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RKAItem)));
    });
    const unsubSubRka = onSnapshot(collection(db, 'rka_sub_items'), (snap) => {
      setSubItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RKASubItem)));
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
      unsubSubRka();
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

  // Master Data Unit Pelayanan & Unit Kerja untuk pilihan Unit Lokasi Sub-Program
  const effectiveUnits = useMemo(() => {
    if (units.length > 0) return units;
    return INITIAL_UNITS.map((u) => ({
      id: u.code.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      ...u,
    }));
  }, [units]);

  const serviceLocationUnits = useMemo(
    () =>
      effectiveUnits
        .filter((u) => u.isActive !== false && u.category === 'UNIT_PELAYANAN')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [effectiveUnits]
  );

  const otherLocationUnits = useMemo(
    () =>
      effectiveUnits
        .filter((u) => u.isActive !== false && u.category !== 'UNIT_PELAYANAN')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [effectiveUnits]
  );

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
    setFormStrategicPriority('Tinggi');
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
    setFormStrategicPriority(item.strategicPriority || 'Sedang');
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

    const existingChildren = editingItem
      ? subItems.filter((s) => s.parentRkaId === editingItem.id)
      : [];
    const aggregatedChildRealization = existingChildren.reduce(
      (sum, c) => sum + (c.realizationAmount || 0),
      0
    );

    const payload: Record<string, unknown> = {
      year: validYear,
      code: formCode.trim().toUpperCase(),
      unitId: formUnitId,
      unitName,
      programName: formProgramName.trim(),
      category: chosenCategory,
      budgetAmount: Number(formBudgetAmount) || 0,
      realizationAmount:
        existingChildren.length > 0
          ? aggregatedChildRealization
          : editingItem?.realizationAmount ?? 0,
      realizationDate: editingItem?.realizationDate || '',
      strategicPriority: formStrategicPriority,
      executionMonth: editingItem?.executionMonth || '',
      ...(editingItem?.targetQuarter ? { targetQuarter: editingItem.targetQuarter } : {}),
      pic: formPic.trim() || unitName,
      notes: formNotes.trim(),
      status: formStatus,
      verificationStatus: editingItem?.verificationStatus || 'Menunggu Verifikasi',
      verifiedBy: editingItem?.verifiedBy || '',
      verifiedAt: editingItem?.verifiedAt || '',
      verificationNotes: editingItem?.verificationNotes || '',
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
        const batch = writeBatch(db);
        batch.update(doc(db, 'rka_items', editingItem.id), payload);
        if (existingChildren.length > 0 && formCode.trim().toUpperCase() !== editingItem.code) {
          existingChildren.forEach((child) => {
            batch.update(doc(db, 'rka_sub_items', child.id), {
              parentRkaCode: formCode.trim().toUpperCase(),
              year: validYear,
            });
          });
        }
        await batch.commit();
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
    const childList = subItems.filter((s) => s.parentRkaId === id);
    const msg =
      childList.length > 0
        ? `Hapus Pos Anggaran Induk ini beserta ${childList.length} Sub-Program Kerja turunannya?`
        : 'Hapus program RKA ini? Jika sudah tertaut ke PKPT, tautan referensi tetap aman namun item RKA ini dihapus.';
    if (!window.confirm(msg)) return;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'rka_items', id));
      childList.forEach((c) => {
        batch.delete(doc(db, 'rka_sub_items', c.id));
      });
      await batch.commit();
    } catch (err) {
      console.error('Error deleting RKA item:', err);
      handleFirestoreError(err, OperationType.DELETE, `rka_items/${id}`);
    }
  };

  // Compute parent summary update payload whenever sub-items change
  const buildParentSyncFields = (parent: RKAItem, nextChildren: RKASubItem[]) => {
    const nowIso = new Date().toISOString();
    if (nextChildren.length === 0) {
      return {
        realizationAmount: 0,
        realizationDate: '',
        verificationStatus: 'Menunggu Verifikasi' as RKAVerificationStatus,
        verifiedAt: '',
        verifiedBy: '',
        updatedAt: nowIso,
      };
    }

    const totalReal = nextChildren.reduce((sum, c) => sum + (c.realizationAmount || 0), 0);
    const realDates = nextChildren
      .map((c) => (c.realizationDate || '').trim())
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a));
    const latestRealDate = realDates[0] || '';

    const verifiedChildren = nextChildren.filter(
      (c) => c.verificationStatus === 'Terverifikasi Keuangan'
    );
    const revisionChildren = nextChildren.filter(
      (c) => c.verificationStatus === 'Perlu Revisi'
    );
    const verDates = verifiedChildren
      .map((c) => ({ date: (c.verifiedAt || '').trim(), by: c.verifiedBy || '' }))
      .filter((x) => Boolean(x.date))
      .sort((a, b) => b.date.localeCompare(a.date));

    let nextVerStatus: RKAVerificationStatus = 'Menunggu Verifikasi';
    if (verifiedChildren.length === nextChildren.length) {
      nextVerStatus = 'Terverifikasi Keuangan';
    } else if (revisionChildren.length > 0) {
      nextVerStatus = 'Perlu Revisi';
    }

    return {
      realizationAmount: totalReal,
      realizationDate: latestRealDate,
      verificationStatus: nextVerStatus,
      verifiedAt: verDates[0]?.date || '',
      verifiedBy: verDates[0]?.by || verifiedChildren[0]?.verifiedBy || parent.verifiedBy || '',
      updatedAt: nowIso,
    };
  };

  const openAddSubModal = (parent: RKAItem) => {
    const existing = subItems.filter((s) => s.parentRkaId === parent.id);
    const nextIdx = existing.length + 1;
    const allocatedSoFar = existing.reduce((s, c) => s + (c.allocatedBudget || 0), 0);
    const remaining = Math.max(0, (parent.budgetAmount || 0) - allocatedSoFar);
    const parentIsServiceUnit = serviceLocationUnits.some((u) => u.id === parent.unitId);

    setSubParentItem(parent);
    setEditingSubItem(null);
    setSubFormCode(`${parent.code}.${String(nextIdx).padStart(2, '0')}`);
    setSubFormProgramName('');
    setSubFormExecutionMonth(resolveExecutionMonth(parent));
    setSubFormLocationUnitId(parentIsServiceUnit ? parent.unitId : '');
    setSubFormAllocatedBudget(remaining > 0 ? remaining : 0);
    setSubFormRealizationAmount(0);
    setSubFormRealizationDate(getTodayIsoDate());
    setSubFormStatus('Berjalan');
    setSubFormPic(parent.pic || parent.unitName || '');
    setSubFormNotes('');
    setIsSubModalOpen(true);
  };

  const openEditSubModal = (parent: RKAItem, sub: RKASubItem) => {
    setSubParentItem(parent);
    setEditingSubItem(sub);
    setSubFormCode(sub.subCode);
    setSubFormProgramName(sub.programName);
    setSubFormExecutionMonth(
      sub.executionMonth && FISCAL_MONTHS.includes(sub.executionMonth as any)
        ? sub.executionMonth
        : resolveExecutionMonth(parent)
    );
    setSubFormLocationUnitId(sub.locationUnitId || '');
    setSubFormAllocatedBudget(sub.allocatedBudget || 0);
    setSubFormRealizationAmount(sub.realizationAmount || 0);
    setSubFormRealizationDate(sub.realizationDate || '');
    setSubFormStatus(sub.status || 'Berjalan');
    setSubFormPic(sub.pic || '');
    setSubFormNotes(sub.notes || '');
    setIsSubModalOpen(true);
  };

  const handleSaveSubItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subParentItem || !subFormCode.trim() || !subFormProgramName.trim()) return;
    if (serviceLocationUnits.length > 0 && !subFormLocationUnitId) {
      alert('Silakan pilih Unit Lokasi dari Master Data Unit Pelayanan terlebih dahulu.');
      return;
    }
    setSubSaving(true);
    const nowIso = new Date().toISOString();
    const subId = editingSubItem ? editingSubItem.id : `rka-sub-${Date.now()}`;
    const realAmt = Number(subFormRealizationAmount) || 0;
    const resolvedRealDate =
      subFormRealizationDate.trim() || (realAmt > 0 ? getTodayIsoDate() : '');
    const selectedLocUnit = effectiveUnits.find((u) => u.id === subFormLocationUnitId);
    const resolvedLocUnitName = (
      selectedLocUnit?.name ||
      (subFormLocationUnitId === editingSubItem?.locationUnitId
        ? editingSubItem?.locationUnitName
        : '') ||
      ''
    ).slice(0, 128);
    const resolvedLocName = (
      selectedLocUnit?.location ||
      (subFormLocationUnitId === editingSubItem?.locationUnitId
        ? editingSubItem?.locationName
        : '') ||
      ''
    ).slice(0, 128);

    const subPayload: RKASubItem = {
      id: subId,
      parentRkaId: subParentItem.id,
      parentRkaCode: subParentItem.code,
      year: subParentItem.year,
      subCode: subFormCode.trim().toUpperCase(),
      programName: subFormProgramName.trim(),
      executionMonth: subFormExecutionMonth,
      locationUnitId: (selectedLocUnit?.id || subFormLocationUnitId || '').slice(0, 64),
      locationUnitName: resolvedLocUnitName,
      locationName: resolvedLocName,
      allocatedBudget: Number(subFormAllocatedBudget) || 0,
      realizationAmount: realAmt,
      realizationDate: resolvedRealDate,
      pic: subFormPic.trim() || subParentItem.pic || subParentItem.unitName,
      notes: subFormNotes.trim(),
      status: subFormStatus,
      verificationStatus: editingSubItem?.verificationStatus || 'Menunggu Verifikasi',
      verifiedBy: editingSubItem?.verifiedBy || '',
      verifiedAt: editingSubItem?.verifiedAt || '',
      verificationNotes: editingSubItem?.verificationNotes || '',
      createdBy: editingSubItem?.createdBy || userProfile?.displayName || 'Bidang Keuangan',
      createdByRole: editingSubItem?.createdByRole || userProfile?.role || 'BIDANG_KEUANGAN',
      createdAt: editingSubItem?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      const siblingSubs = subItems.filter(
        (s) => s.parentRkaId === subParentItem.id && s.id !== subId
      );
      const nextChildren = [...siblingSubs, subPayload];
      const parentSync = buildParentSyncFields(subParentItem, nextChildren);

      const batch = writeBatch(db);
      batch.set(doc(db, 'rka_sub_items', subId), subPayload);
      batch.update(doc(db, 'rka_items', subParentItem.id), parentSync);
      await batch.commit();

      setExpandedParentIds((prev) => ({ ...prev, [subParentItem.id]: true }));
      setIsSubModalOpen(false);
    } catch (err) {
      console.error('Error saving RKA sub-program:', err);
      handleFirestoreError(err, OperationType.WRITE, `rka_sub_items/${subId}`);
      alert('Gagal menyimpan Sub-Program RKA.');
    } finally {
      setSubSaving(false);
    }
  };

  const handleDeleteSubItem = async (parent: RKAItem, sub: RKASubItem) => {
    if (!window.confirm(`Hapus sub-program "${sub.subCode} — ${sub.programName}"?`)) return;
    try {
      const remainingSubs = subItems.filter(
        (s) => s.parentRkaId === parent.id && s.id !== sub.id
      );
      const parentSync = buildParentSyncFields(parent, remainingSubs);
      const batch = writeBatch(db);
      batch.delete(doc(db, 'rka_sub_items', sub.id));
      batch.update(doc(db, 'rka_items', parent.id), parentSync);
      await batch.commit();
    } catch (err) {
      console.error('Error deleting RKA sub-program:', err);
      handleFirestoreError(err, OperationType.DELETE, `rka_sub_items/${sub.id}`);
    }
  };

  const openVerifySubModal = (parent: RKAItem, sub: RKASubItem) => {
    setVerifyTarget({ mode: 'sub', sub, parent });
    setVerifyRealizationAmount(sub.realizationAmount || 0);
    setVerifyRealizationDate(sub.realizationDate || (sub.realizationAmount > 0 ? getTodayIsoDate() : ''));
    setVerifyStatus(
      sub.verificationStatus === 'Terverifikasi Keuangan' || sub.verificationStatus === 'Perlu Revisi'
        ? sub.verificationStatus
        : 'Terverifikasi Keuangan'
    );
    setVerifyDate(sub.verifiedAt || getTodayIsoDate());
    setVerifyBy(
      sub.verifiedBy ||
        `${userProfile?.displayName || 'Petugas Keuangan'}${
          isBidangKeuangan ? ' (Bidang Keuangan)' : ''
        }`
    );
    setVerifyNotes(sub.verificationNotes || '');
    setIsVerifyModalOpen(true);
  };

  const openVerifyParentModal = (parent: RKAItem) => {
    setVerifyTarget({ mode: 'parent', parent });
    setVerifyRealizationAmount(parent.realizationAmount || 0);
    setVerifyRealizationDate(
      parent.realizationDate || ((parent.realizationAmount || 0) > 0 ? getTodayIsoDate() : '')
    );
    setVerifyStatus(
      parent.verificationStatus === 'Terverifikasi Keuangan' || parent.verificationStatus === 'Perlu Revisi'
        ? parent.verificationStatus
        : 'Terverifikasi Keuangan'
    );
    setVerifyDate(parent.verifiedAt || getTodayIsoDate());
    setVerifyBy(
      parent.verifiedBy ||
        `${userProfile?.displayName || 'Petugas Keuangan'}${
          isBidangKeuangan ? ' (Bidang Keuangan)' : ''
        }`
    );
    setVerifyNotes(parent.verificationNotes || '');
    setIsVerifyModalOpen(true);
  };

  const handleSaveVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyTarget) return;
    setVerifySaving(true);
    const nowIso = new Date().toISOString();
    const realAmt = Number(verifyRealizationAmount) || 0;
    const resolvedRealDate =
      verifyRealizationDate.trim() || (realAmt > 0 ? getTodayIsoDate() : '');
    const resolvedVerifyDate =
      verifyStatus === 'Menunggu Verifikasi' ? '' : verifyDate.trim() || getTodayIsoDate();
    const resolvedVerifier =
      verifyStatus === 'Menunggu Verifikasi'
        ? ''
        : verifyBy.trim() || userProfile?.displayName || 'Bidang Keuangan';

    try {
      if (verifyTarget.mode === 'sub') {
        const updatedSub: RKASubItem = {
          ...verifyTarget.sub,
          realizationAmount: realAmt,
          realizationDate: resolvedRealDate,
          verificationStatus: verifyStatus,
          verifiedAt: resolvedVerifyDate,
          verifiedBy: resolvedVerifier,
          verificationNotes: verifyNotes.trim(),
          updatedAt: nowIso,
        };
        const siblingSubs = subItems.filter(
          (s) => s.parentRkaId === verifyTarget.parent.id && s.id !== updatedSub.id
        );
        const nextChildren = [...siblingSubs, updatedSub];
        const parentSync = buildParentSyncFields(verifyTarget.parent, nextChildren);

        const batch = writeBatch(db);
        batch.update(doc(db, 'rka_sub_items', updatedSub.id), {
          realizationAmount: updatedSub.realizationAmount,
          realizationDate: updatedSub.realizationDate,
          verificationStatus: updatedSub.verificationStatus,
          verifiedAt: updatedSub.verifiedAt,
          verifiedBy: updatedSub.verifiedBy,
          verificationNotes: updatedSub.verificationNotes,
          updatedAt: nowIso,
        });
        batch.update(doc(db, 'rka_items', verifyTarget.parent.id), parentSync);
        await batch.commit();
      } else {
        await updateDoc(doc(db, 'rka_items', verifyTarget.parent.id), {
          realizationAmount: realAmt,
          realizationDate: resolvedRealDate,
          verificationStatus: verifyStatus,
          verifiedAt: resolvedVerifyDate,
          verifiedBy: resolvedVerifier,
          verificationNotes: verifyNotes.trim(),
          updatedAt: nowIso,
        });
      }
      setIsVerifyModalOpen(false);
    } catch (err) {
      console.error('Error saving verification:', err);
      handleFirestoreError(err, OperationType.UPDATE, 'rka_verification');
      alert('Gagal menyimpan verifikasi keuangan.');
    } finally {
      setVerifySaving(false);
    }
  };

  const linkedPkptMap = useMemo(() => {
    const map = new Map<string, PKPT>();
    pkptList.forEach((p) => {
      if (p.rkaId) map.set(p.rkaId, p);
    });
    return map;
  }, [pkptList]);

  // Group sub-items by parentRkaId and compute rollup metrics per parent RKA
  const subItemsByParentMap = useMemo(() => {
    const map = new Map<string, RKASubItem[]>();
    subItems.forEach((sub) => {
      const list = map.get(sub.parentRkaId) || [];
      list.push(sub);
      map.set(sub.parentRkaId, list);
    });
    map.forEach((list, key) => {
      list.sort((a, b) => (a.subCode || '').localeCompare(b.subCode || ''));
      map.set(key, list);
    });
    return map;
  }, [subItems]);

  const getParentSummary = (item: RKAItem) => {
    const children = subItemsByParentMap.get(item.id) || [];
    const hasChildren = children.length > 0;
    const totalAllocatedSub = children.reduce((s, c) => s + (c.allocatedBudget || 0), 0);
    const remainingCeiling = (item.budgetAmount || 0) - totalAllocatedSub;
    const isOverCeiling = hasChildren && totalAllocatedSub > (item.budgetAmount || 0);
    const effectiveRealization = hasChildren
      ? children.reduce((s, c) => s + (c.realizationAmount || 0), 0)
      : item.realizationAmount || 0;

    const verifiedCount = children.filter(
      (c) => c.verificationStatus === 'Terverifikasi Keuangan'
    ).length;
    const revisionCount = children.filter(
      (c) => c.verificationStatus === 'Perlu Revisi'
    ).length;

    let effectiveVerificationStatus: RKAVerificationStatus =
      item.verificationStatus || 'Menunggu Verifikasi';
    if (hasChildren) {
      if (verifiedCount === children.length) {
        effectiveVerificationStatus = 'Terverifikasi Keuangan';
      } else if (revisionCount > 0) {
        effectiveVerificationStatus = 'Perlu Revisi';
      } else {
        effectiveVerificationStatus = 'Menunggu Verifikasi';
      }
    }

    const latestRealizationDate = hasChildren
      ? children
          .map((c) => (c.realizationDate || '').trim())
          .filter(Boolean)
          .sort((a, b) => b.localeCompare(a))[0] ||
        item.realizationDate ||
        ''
      : item.realizationDate || '';

    const latestVerifiedEntry = hasChildren
      ? children
          .filter((c) => c.verificationStatus === 'Terverifikasi Keuangan' && (c.verifiedAt || '').trim())
          .sort((a, b) => (b.verifiedAt || '').localeCompare(a.verifiedAt || ''))[0]
      : null;

    const latestVerificationDate = hasChildren
      ? latestVerifiedEntry?.verifiedAt || item.verifiedAt || ''
      : item.verifiedAt || '';

    const latestVerifiedBy = hasChildren
      ? latestVerifiedEntry?.verifiedBy || item.verifiedBy || ''
      : item.verifiedBy || '';

    return {
      children,
      hasChildren,
      totalAllocatedSub,
      remainingCeiling,
      isOverCeiling,
      effectiveRealization,
      verifiedCount,
      revisionCount,
      effectiveVerificationStatus,
      latestRealizationDate,
      latestVerificationDate,
      latestVerifiedBy,
    };
  };

  const formatParentScheduleLabel = (item: RKAItem, children: RKASubItem[]): string => {
    if (children.length > 0) {
      const monthSet = new Set(
        children
          .map((c) => (c.executionMonth || '').trim())
          .filter((m) => FISCAL_MONTHS.includes(m as any))
      );
      const orderedMonths = FISCAL_MONTHS.filter((m) => monthSet.has(m));
      if (orderedMonths.length === 1) {
        return `${orderedMonths[0]} ${item.year}`;
      }
      if (orderedMonths.length === 2) {
        return `${orderedMonths[0]}, ${orderedMonths[1]} ${item.year}`;
      }
      if (orderedMonths.length > 2) {
        return `${orderedMonths[0].slice(0, 3)}–${orderedMonths[orderedMonths.length - 1].slice(0, 3)} ${item.year} (${orderedMonths.length} bln)`;
      }
    }
    if ((item.executionMonth && item.executionMonth.trim()) || item.targetQuarter) {
      return formatRkaExecutionSchedule(item);
    }
    return `TA ${item.year} · Menunggu Sub-Program`;
  };

  const currentCalendarMonth = FISCAL_MONTHS[new Date().getMonth()];

  // Items matching all filters except month (used for the 12-Month Dashboard comparison)
  const rkaForDashboard = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return rkaList.filter((r) => {
      const children = subItemsByParentMap.get(r.id) || [];
      const summary = getParentSummary(r);
      const matchYear = selectedYear === 0 || r.year === selectedYear;
      const matchCat = selectedCategory === 'ALL' || r.category === selectedCategory;
      const matchUnit =
        selectedUnitId === 'ALL' ||
        r.unitId === selectedUnitId ||
        children.some((c) => c.locationUnitId === selectedUnitId);
      const matchPriority = selectedPriority === 'ALL' || r.strategicPriority === selectedPriority;
      const matchStatus = selectedStatus === 'ALL' || r.status === selectedStatus;
      const isLinked = linkedPkptMap.has(r.id);
      const matchPkpt =
        selectedPkptStatus === 'ALL' ||
        (selectedPkptStatus === 'LINKED' && isLinked) ||
        (selectedPkptStatus === 'UNLINKED' && !isLinked);
      const matchVerification =
        selectedVerificationFilter === 'ALL' ||
        (selectedVerificationFilter === 'HAS_SUB' && summary.hasChildren) ||
        (selectedVerificationFilter !== 'HAS_SUB' &&
          summary.effectiveVerificationStatus === selectedVerificationFilter);
      const matchChildSearch = children.some(
        (c) =>
          c.subCode.toLowerCase().includes(q) ||
          c.programName.toLowerCase().includes(q) ||
          (c.pic || '').toLowerCase().includes(q) ||
          (c.locationUnitName || '').toLowerCase().includes(q) ||
          (c.locationName || '').toLowerCase().includes(q)
      );
      const matchSearch =
        !q ||
        r.programName.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.unitName.toLowerCase().includes(q) ||
        (r.pic || '').toLowerCase().includes(q) ||
        matchChildSearch;
      return (
        matchYear &&
        matchCat &&
        matchUnit &&
        matchPriority &&
        matchStatus &&
        matchPkpt &&
        matchVerification &&
        matchSearch
      );
    });
  }, [
    rkaList,
    subItemsByParentMap,
    selectedYear,
    selectedCategory,
    selectedUnitId,
    selectedPriority,
    selectedStatus,
    selectedPkptStatus,
    selectedVerificationFilter,
    searchTerm,
    linkedPkptMap,
  ]);

  const filteredRka = useMemo(() => {
    return rkaForDashboard
      .filter((r) => {
        if (selectedMonth === 'ALL') return true;
        const children = subItemsByParentMap.get(r.id) || [];
        if (children.length > 0) {
          return children.some((c) => c.executionMonth === selectedMonth);
        }
        if (Boolean(r.executionMonth?.trim() || r.targetQuarter)) {
          return resolveExecutionMonth(r) === selectedMonth;
        }
        return false;
      })
      .sort((a, b) => (b.budgetAmount || 0) - (a.budgetAmount || 0));
  }, [rkaForDashboard, selectedMonth, subItemsByParentMap]);

  const monthlyStats = useMemo(() => {
    const map = new Map<
      string,
      {
        month: string;
        shortMonth: string;
        count: number;
        budget: number;
        realization: number;
        highPriorityCount: number;
        linkedCount: number;
        absorptionPct: number;
      }
    >();

    FISCAL_MONTHS.forEach((m) => {
      map.set(m, {
        month: m,
        shortMonth: m.slice(0, 3),
        count: 0,
        budget: 0,
        realization: 0,
        highPriorityCount: 0,
        linkedCount: 0,
        absorptionPct: 0,
      });
    });

    let unscheduledParentCount = 0;

    rkaForDashboard.forEach((item) => {
      const summary = getParentSummary(item);
      if (summary.hasChildren) {
        const touchedMonths = new Set<string>();
        summary.children.forEach((sub) => {
          const m = resolveExecutionMonth({ executionMonth: sub.executionMonth });
          const entry = map.get(m);
          if (!entry) return;
          entry.budget += sub.allocatedBudget || 0;
          entry.realization += sub.realizationAmount || 0;
          touchedMonths.add(m);
        });
        touchedMonths.forEach((m) => {
          const entry = map.get(m);
          if (!entry) return;
          entry.count += 1;
          if (item.strategicPriority === 'Tinggi') entry.highPriorityCount += 1;
          if (linkedPkptMap.has(item.id)) entry.linkedCount += 1;
        });
      } else if (Boolean(item.executionMonth?.trim() || item.targetQuarter)) {
        const m = resolveExecutionMonth(item);
        const entry = map.get(m);
        if (!entry) return;
        entry.count += 1;
        entry.budget += item.budgetAmount || 0;
        entry.realization += summary.effectiveRealization;
        if (item.strategicPriority === 'Tinggi') entry.highPriorityCount += 1;
        if (linkedPkptMap.has(item.id)) entry.linkedCount += 1;
      } else {
        unscheduledParentCount += 1;
      }
    });

    const list = Array.from(map.values()).map((entry) => ({
      ...entry,
      absorptionPct:
        entry.budget > 0 ? Math.min(100, Math.round((entry.realization / entry.budget) * 100)) : 0,
    }));

    const maxBudget = list.reduce((mx, cur) => Math.max(mx, cur.budget), 0);
    const peakMonth = list.reduce(
      (best, cur) => (cur.budget > best.budget ? cur : best),
      list[0]
    );
    const activeMonthsCount = list.filter((m) => m.count > 0).length;

    return { list, maxBudget, peakMonth, activeMonthsCount, unscheduledParentCount };
  }, [rkaForDashboard, linkedPkptMap, subItemsByParentMap]);

  const yearTotalForContext = useMemo(
    () => rkaList.filter((r) => selectedYear === 0 || r.year === selectedYear).length,
    [rkaList, selectedYear]
  );

  const hasActiveFilters =
    selectedCategory !== 'ALL' ||
    selectedMonth !== 'ALL' ||
    selectedUnitId !== 'ALL' ||
    selectedPriority !== 'ALL' ||
    selectedStatus !== 'ALL' ||
    selectedPkptStatus !== 'ALL' ||
    selectedVerificationFilter !== 'ALL' ||
    searchTerm.trim() !== '';

  const resetAllFilters = () => {
    setSearchTerm('');
    setSelectedCategory('ALL');
    setSelectedMonth('ALL');
    setSelectedUnitId('ALL');
    setSelectedPriority('ALL');
    setSelectedStatus('ALL');
    setSelectedPkptStatus('ALL');
    setSelectedVerificationFilter('ALL');
  };

  const totalBudget = filteredRka.reduce((sum, r) => sum + (r.budgetAmount || 0), 0);
  const totalRealization = filteredRka.reduce(
    (sum, r) => sum + getParentSummary(r).effectiveRealization,
    0
  );
  const totalSubProgramsCount = filteredRka.reduce(
    (sum, r) => sum + getParentSummary(r).children.length,
    0
  );
  const verifiedProgramsCount = filteredRka.filter(
    (r) => getParentSummary(r).effectiveVerificationStatus === 'Terverifikasi Keuangan'
  ).length;
  const highPriorityCount = filteredRka.filter((r) => r.strategicPriority === 'Tinggi').length;
  const linkedToPkptCount = filteredRka.filter((r) => linkedPkptMap.has(r.id)).length;

  const allExpandableIds = useMemo(
    () => filteredRka.filter((r) => (subItemsByParentMap.get(r.id) || []).length > 0).map((r) => r.id),
    [filteredRka, subItemsByParentMap]
  );
  const areAllExpanded =
    allExpandableIds.length > 0 && allExpandableIds.every((id) => Boolean(expandedParentIds[id]));

  const toggleExpandAll = () => {
    if (areAllExpanded) {
      setExpandedParentIds({});
    } else {
      const next: Record<string, boolean> = {};
      allExpandableIds.forEach((id) => {
        next[id] = true;
      });
      setExpandedParentIds(next);
    }
  };

  const exportToExcel = () => {
    const rows: Record<string, unknown>[] = [];
    let rowIdx = 0;

    filteredRka.forEach((r) => {
      rowIdx += 1;
      const summary = getParentSummary(r);
      rows.push({
        No: rowIdx,
        Tingkat: 'Pos Anggaran Induk',
        Tahun: r.year,
        'Kode Induk': r.code,
        'Kode Program': r.code,
        'Unit Kerja / Pemilik Risiko': r.unitName,
        'Unit Lokasi (Unit Pelayanan)': '-',
        'Nama Program / Sub-Program': r.programName,
        'Bidang / Kategori': r.category,
        'Pagu / Alokasi Anggaran (Rp)': r.budgetAmount,
        'Realisasi (Rp)': summary.effectiveRealization,
        'Tanggal Realisasi': formatDateId(summary.latestRealizationDate),
        'Status Verifikasi Keuangan': summary.hasChildren
          ? `${summary.effectiveVerificationStatus} (${summary.verifiedCount}/${summary.children.length})`
          : summary.effectiveVerificationStatus,
        'Tanggal Verifikasi': formatDateId(summary.latestVerificationDate),
        'Diverifikasi Oleh': summary.latestVerifiedBy || '-',
        'Catatan Verifikasi': r.verificationNotes || '-',
        'Waktu Pelaksanaan': formatParentScheduleLabel(r, summary.children),
        'Prioritas Strategis': r.strategicPriority,
        'Bobot Materialitas RKA': calculateRkaWeightScore(r.budgetAmount, r.strategicPriority),
        Status: r.status,
        'Masuk PKPT': linkedPkptMap.has(r.id) ? 'Sudah Masuk PKPT' : 'Belum Dijadwalkan',
      });

      summary.children.forEach((sub) => {
        rowIdx += 1;
        rows.push({
          No: rowIdx,
          Tingkat: 'Sub-Program Kerja',
          Tahun: sub.year,
          'Kode Induk': r.code,
          'Kode Program': sub.subCode,
          'Unit Kerja / Pemilik Risiko': r.unitName,
          'Unit Lokasi (Unit Pelayanan)': sub.locationUnitName
            ? sub.locationName && !sub.locationUnitName.toLowerCase().includes(sub.locationName.toLowerCase())
              ? `${sub.locationUnitName} (${sub.locationName})`
              : sub.locationUnitName
            : '-',
          'Nama Program / Sub-Program': `   └ ${sub.programName}`,
          'Bidang / Kategori': r.category,
          'Pagu / Alokasi Anggaran (Rp)': sub.allocatedBudget,
          'Realisasi (Rp)': sub.realizationAmount || 0,
          'Tanggal Realisasi': formatDateId(sub.realizationDate),
          'Status Verifikasi Keuangan': sub.verificationStatus || 'Menunggu Verifikasi',
          'Tanggal Verifikasi': formatDateId(sub.verifiedAt),
          'Diverifikasi Oleh': sub.verifiedBy || '-',
          'Catatan Verifikasi': sub.verificationNotes || '-',
          'Waktu Pelaksanaan': `${sub.executionMonth} ${sub.year}`,
          'Prioritas Strategis': r.strategicPriority,
          'Bobot Materialitas RKA': '-',
          Status: sub.status,
          'Masuk PKPT': '-',
        });
      });
    });

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
            Input pos anggaran induk (pagu), rincian sub-program kerja bulanan, realisasi, serta verifikasi Bidang Keuangan sebagai basis bobot materialitas PKPT
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

      {/* Info Banner: Peran Bidang Keuangan & Hierarki RKA atau Integrasi PKPT */}
      {isBidangKeuangan ? (
        <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              Portal Pengisian Realisasi &amp; Verifikasi Anggaran Berjenjang (Bidang Keuangan)
            </p>
            <p className="text-[11px] text-emerald-900 leading-relaxed">
              Klik <strong>+ Sub-Program</strong> pada Pos Anggaran Induk (mis.{' '}
              <span className="font-mono font-semibold">RKA-2027-018</span>) untuk membuat rincian program kerja dan
              realisasi terhadap pagu induk tersebut, lalu klik <strong>Verifikasi</strong> untuk mencatat{' '}
              <strong>Tanggal Realisasi</strong>, <strong>Tanggal Verifikasi</strong>, dan status keabsahan keuangan.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-teal-50/70 border border-emerald-200 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-700" />
              Anggaran Berjenjang, Verifikasi Keuangan &amp; Integrasi PKPT
            </p>
            <p className="text-[11px] text-emerald-900 leading-relaxed">
              Setiap item RKA berlaku sebagai <strong>Pos Anggaran Induk</strong> yang dapat diturunkan menjadi beberapa{' '}
              <strong>Sub-Program Kerja &amp; Realisasi</strong> (diisi &amp; diverifikasi oleh peran{' '}
              <strong>Bidang Keuangan</strong>). Bobot Materialitas (0–100) otomatis terhubung ke prioritas{' '}
              <strong>PKPT Berbasis Risiko</strong>.
            </p>
          </div>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Pos Anggaran Induk &amp; Sub</span>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">
            {filteredRka.length}
            <span className="text-xs font-semibold text-slate-500 ml-1.5">
              · {totalSubProgramsCount} Sub-Program
            </span>
          </p>
          <span className="text-[10px] text-slate-400">
            Tahun {selectedYear === 0 ? 'Semua Tahun' : selectedYear}
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Total Pagu Anggaran Induk</span>
          <p className="text-xl font-extrabold text-emerald-800 mt-1 font-mono tabular-nums">
            Rp {totalBudget.toLocaleString('id-ID')}
          </p>
          <span className="text-[10px] text-slate-500 font-mono tabular-nums">
            Realisasi: Rp {totalRealization.toLocaleString('id-ID')} (
            {totalBudget > 0 ? Math.round((totalRealization / totalBudget) * 100) : 0}%)
          </span>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[11px] font-semibold text-slate-500">Verifikasi Bidang Keuangan</span>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">
            {verifiedProgramsCount} / {filteredRka.length}
          </p>
          <span className="text-[10px] text-slate-500">
            {highPriorityCount} pos prioritas tinggi
          </span>
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

      {/* Dashboard Bulanan (12 Bulan) */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>Dashboard Bulanan (Januari – Desember {selectedYear === 0 ? 'Semua Tahun' : selectedYear})</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Bulan Berjalan: <strong className="text-emerald-800">{currentCalendarMonth}</strong>
              {' · '}
              {monthlyStats.activeMonthsCount}/12 bulan terjadwal
              {monthlyStats.peakMonth && monthlyStats.peakMonth.budget > 0 && (
                <>
                  {' · '}
                  Pagu tertinggi:{' '}
                  <strong className="text-slate-800">
                    {monthlyStats.peakMonth.month} (Rp {monthlyStats.peakMonth.budget.toLocaleString('id-ID')})
                  </strong>
                </>
              )}
              {monthlyStats.unscheduledParentCount > 0 && (
                <>
                  {' · '}
                  <span className="text-amber-700 font-medium">
                    {monthlyStats.unscheduledParentCount} pos induk belum memiliki sub-program bulanan
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {selectedMonth !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedMonth('ALL')}
                className="px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Tampilkan Semua Bulan
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowMonthlyDashboard((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>{showMonthlyDashboard ? 'Tutup Grafik' : 'Buka Dashboard Bulan'}</span>
              {showMonthlyDashboard ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {showMonthlyDashboard && (
          <div className="p-5 space-y-5">
            {/* 12-Month Visual Comparison Bars */}
            <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <span className="text-[11px] font-semibold text-slate-600">
                  Distribusi Pagu Anggaran vs Realisasi per Bulan (klik bulan untuk memfilter list)
                </span>
                <div className="flex items-center gap-3 text-[11px] text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-200 border border-emerald-400" />
                    Pagu Anggaran
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-xs bg-emerald-700" />
                    Realisasi
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-6 sm:grid-cols-12 gap-2 items-end h-36 pt-3">
                {monthlyStats.list.map((m) => {
                  const budgetHeightPct =
                    monthlyStats.maxBudget > 0 && m.budget > 0
                      ? Math.max(8, Math.round((m.budget / monthlyStats.maxBudget) * 100))
                      : 4;
                  const realHeightPct =
                    monthlyStats.maxBudget > 0 && m.realization > 0
                      ? Math.max(6, Math.round((m.realization / monthlyStats.maxBudget) * 100))
                      : 0;
                  const isSelected = selectedMonth === m.month;
                  const isCurrent = m.month === currentCalendarMonth;

                  return (
                    <button
                      key={m.month}
                      type="button"
                      onClick={() => setSelectedMonth(isSelected ? 'ALL' : m.month)}
                      title={`${m.month}: ${m.count} program | Pagu Rp ${m.budget.toLocaleString('id-ID')} | Realisasi Rp ${m.realization.toLocaleString('id-ID')} (${m.absorptionPct}%)`}
                      className={`group flex flex-col items-center h-full justify-end rounded-lg p-1 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-100/80 ring-1 ring-emerald-600'
                          : isCurrent
                          ? 'bg-amber-50/70 ring-1 ring-amber-300'
                          : 'hover:bg-white'
                      }`}
                    >
                      <span className="text-[10px] font-mono font-semibold text-slate-500 mb-1 tabular-nums">
                        {m.count > 0 ? m.count : '-'}
                      </span>
                      <div className="w-full max-w-[26px] h-20 flex items-end justify-center gap-0.5">
                        <div
                          className={`w-1/2 rounded-t-xs transition-all ${
                            m.budget > 0
                              ? isSelected
                                ? 'bg-emerald-500'
                                : 'bg-emerald-200 group-hover:bg-emerald-300'
                              : 'bg-slate-200'
                          }`}
                          style={{ height: `${budgetHeightPct}%` }}
                        />
                        <div
                          className="w-1/2 rounded-t-xs bg-emerald-700 transition-all"
                          style={{ height: `${realHeightPct}%` }}
                        />
                      </div>
                      <span
                        className={`mt-1.5 text-[10px] font-bold ${
                          isSelected
                            ? 'text-emerald-900'
                            : isCurrent
                            ? 'text-amber-800'
                            : 'text-slate-600'
                        }`}
                      >
                        {m.shortMonth}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 12-Month Breakdown Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
              {monthlyStats.list.map((m) => {
                const isSelected = selectedMonth === m.month;
                const isCurrent = m.month === currentCalendarMonth;

                return (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => setSelectedMonth(isSelected ? 'ALL' : m.month)}
                    className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-50 border-emerald-600 ring-1 ring-emerald-600'
                        : isCurrent
                        ? 'bg-amber-50/50 border-amber-300 hover:border-amber-400'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-bold text-slate-900 truncate">{m.month}</span>
                      {isCurrent && (
                        <span className="text-[9px] font-bold text-amber-800 uppercase tracking-wide shrink-0">
                          Berjalan
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono font-bold text-emerald-800 mt-1 tabular-nums truncate">
                      Rp {m.budget.toLocaleString('id-ID')}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 tabular-nums">
                      <span>{m.count} program</span>
                      <span className="font-mono font-semibold text-slate-700">{m.absorptionPct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          m.absorptionPct >= 75
                            ? 'bg-emerald-600'
                            : m.absorptionPct > 0
                            ? 'bg-amber-500'
                            : 'bg-slate-200'
                        }`}
                        style={{ width: `${m.absorptionPct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Filter & Search Panel */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <Filter className="w-3.5 h-3.5 text-emerald-700" />
            <span>Filter Daftar Program &amp; Anggaran</span>
            <span className="text-[11px] font-normal text-slate-500 tabular-nums">
              (Menampilkan <strong className="text-slate-900">{filteredRka.length}</strong> dari{' '}
              {yearTotalForContext} item)
            </span>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Filter</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari kode, nama program, unit lokasi, PIC..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800 focus:bg-white focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
            className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            {yearOptions.map((yr) => (
              <option key={yr} value={yr}>
                Tahun {yr}
              </option>
            ))}
            <option value={0}>Semua Tahun</option>
          </select>

          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Bulan Berjalan (Jan – Des)</option>
            {FISCAL_MONTHS.map((m) => (
              <option key={m} value={m}>
                Bulan: {m}{m === currentCalendarMonth ? ' (Berjalan)' : ''}
              </option>
            ))}
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Bidang / Kategori</option>
            {categoryOptions.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={selectedUnitId}
            onChange={(e) => setSelectedUnitId(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Unit / Lokasi Pelayanan</option>
            {effectiveUnits.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>

          <select
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Prioritas Strategis</option>
            <option value="Tinggi">Prioritas Tinggi</option>
            <option value="Sedang">Prioritas Sedang</option>
            <option value="Rendah">Prioritas Rendah</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Status Pelaksanaan</option>
            <option value="Usulan">Usulan</option>
            <option value="Disetujui RKAP">Disetujui RKAP</option>
            <option value="Berjalan">Berjalan</option>
            <option value="Selesai">Selesai</option>
          </select>

          <select
            value={selectedPkptStatus}
            onChange={(e) => setSelectedPkptStatus(e.target.value as 'ALL' | 'LINKED' | 'UNLINKED')}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Status PKPT</option>
            <option value="LINKED">Sudah Masuk PKPT</option>
            <option value="UNLINKED">Belum Dijadwalkan di PKPT</option>
          </select>

          <select
            value={selectedVerificationFilter}
            onChange={(e) => setSelectedVerificationFilter(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Verifikasi Keuangan</option>
            <option value="Terverifikasi Keuangan">Terverifikasi Keuangan</option>
            <option value="Menunggu Verifikasi">Menunggu Verifikasi</option>
            <option value="Perlu Revisi">Perlu Revisi</option>
            <option value="HAS_SUB">Memiliki Sub-Program Berjenjang</option>
          </select>
        </div>
      </div>

      {/* Hierarchical RKA Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-700 font-semibold">
            <GitBranch className="w-3.5 h-3.5 text-emerald-700" />
            <span>Daftar Anggaran Berjenjang (Pos Induk &amp; Sub-Program Kerja)</span>
          </div>

          {allExpandableIds.length > 0 && (
            <button
              type="button"
              onClick={toggleExpandAll}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {areAllExpanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Tutup Semua Sub-Program</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Buka Semua Sub-Program ({totalSubProgramsCount})</span>
                </>
              )}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-3 px-4 w-44">Kode &amp; Pelaksanaan</th>
                <th className="py-3 px-4">Program Kerja &amp; Anggaran (Induk / Sub)</th>
                <th className="py-3 px-4">Unit / PIC</th>
                <th className="py-3 px-4 text-right">Pagu &amp; Alokasi</th>
                <th className="py-3 px-4 text-right">Realisasi &amp; Tgl</th>
                <th className="py-3 px-4 text-center">Verifikasi Keuangan</th>
                <th className="py-3 px-4 text-center">PKPT &amp; Bobot</th>
                <th className="py-3 px-4 text-center w-48">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredRka.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    Belum ada data RKA yang sesuai filter untuk tahun ini.
                  </td>
                </tr>
              ) : (
                filteredRka.map((item) => {
                  const weight = calculateRkaWeightScore(item.budgetAmount, item.strategicPriority);
                  const linkedPkpt = linkedPkptMap.get(item.id);
                  const summary = getParentSummary(item);
                  const isExpanded = Boolean(expandedParentIds[item.id]);
                  const parentAbsorptionPct =
                    (item.budgetAmount || 0) > 0
                      ? Math.round((summary.effectiveRealization / item.budgetAmount) * 100)
                      : 0;

                  return (
                    <React.Fragment key={item.id}>
                      {/* PARENT ROW (POS ANGGARAN INDUK) */}
                      <tr className="hover:bg-slate-50/80 transition-colors bg-white">
                        <td className="py-3 px-4 align-top">
                          <div className="flex items-start gap-1.5">
                            {summary.hasChildren ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedParentIds((prev) => ({
                                    ...prev,
                                    [item.id]: !prev[item.id],
                                  }))
                                }
                                className="mt-0.5 p-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 transition-colors cursor-pointer shrink-0"
                                title={isExpanded ? 'Tutup sub-program' : 'Lihat sub-program berjenjang'}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="w-5 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <span className="font-mono font-bold text-emerald-800 block whitespace-nowrap">
                                {item.code}
                              </span>
                              <span className="text-[11px] font-semibold text-slate-500 block">
                                {formatParentScheduleLabel(item, summary.children)}
                              </span>
                              {summary.hasChildren && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedParentIds((prev) => ({
                                      ...prev,
                                      [item.id]: !prev[item.id],
                                    }))
                                  }
                                  className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 hover:underline cursor-pointer whitespace-nowrap"
                                >
                                  <GitBranch className="w-3 h-3" />
                                  <span>{summary.children.length} Sub-Program</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 align-top">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Pos Induk
                            </span>
                            <span className="text-slate-300">·</span>
                            <span className="text-[11px] text-slate-500">{item.category}</span>
                          </div>
                          <p className="font-bold text-slate-900 mt-0.5">{item.programName}</p>
                          {item.notes && (
                            <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{item.notes}</p>
                          )}
                        </td>

                        <td className="py-3 px-4 align-top">
                          <p className="font-semibold text-slate-800">{item.unitName}</p>
                          <p className="text-[10px] text-slate-500">PIC: {item.pic || '-'}</p>
                        </td>

                        <td className="py-3 px-4 align-top text-right font-mono tabular-nums">
                          <p className="font-bold text-slate-900 whitespace-nowrap">
                            Rp {(item.budgetAmount || 0).toLocaleString('id-ID')}
                          </p>
                          {summary.hasChildren && (
                            <div className="mt-1 space-y-0.5 text-[10px]">
                              <p className="text-slate-600 whitespace-nowrap">
                                Sub-Alokasi: Rp {summary.totalAllocatedSub.toLocaleString('id-ID')}
                              </p>
                              <p
                                className={`font-semibold whitespace-nowrap ${
                                  summary.isOverCeiling ? 'text-rose-600' : 'text-emerald-700'
                                }`}
                              >
                                {summary.isOverCeiling
                                  ? `Melebihi pagu Rp ${Math.abs(summary.remainingCeiling).toLocaleString('id-ID')}`
                                  : `Sisa pagu: Rp ${summary.remainingCeiling.toLocaleString('id-ID')}`}
                              </p>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 align-top text-right font-mono tabular-nums">
                          <p className="font-bold text-emerald-800 whitespace-nowrap">
                            Rp {summary.effectiveRealization.toLocaleString('id-ID')}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Serapan {parentAbsorptionPct}%
                          </p>
                          <p className="text-[10px] text-slate-600 mt-0.5 whitespace-nowrap">
                            Tgl: {formatDateId(summary.latestRealizationDate)}
                          </p>
                        </td>

                        <td className="py-3 px-4 align-top text-center">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md whitespace-nowrap ${
                              summary.effectiveVerificationStatus === 'Terverifikasi Keuangan'
                                ? 'bg-emerald-100 text-emerald-800'
                                : summary.effectiveVerificationStatus === 'Perlu Revisi'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {summary.effectiveVerificationStatus === 'Terverifikasi Keuangan' ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : summary.effectiveVerificationStatus === 'Perlu Revisi' ? (
                              <AlertCircle className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            <span>
                              {summary.hasChildren
                                ? `${summary.verifiedCount}/${summary.children.length} Terverifikasi`
                                : summary.effectiveVerificationStatus}
                            </span>
                          </span>
                          <p className="text-[10px] font-mono text-slate-500 mt-1 tabular-nums whitespace-nowrap">
                            Tgl Verif: {formatDateId(summary.latestVerificationDate)}
                          </p>
                          {summary.latestVerifiedBy && (
                            <p className="text-[10px] text-slate-400 truncate max-w-[140px] mx-auto" title={summary.latestVerifiedBy}>
                              {summary.latestVerifiedBy}
                            </p>
                          )}
                        </td>

                        <td className="py-3 px-4 align-top text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span
                              className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md ${
                                item.strategicPriority === 'Tinggi'
                                  ? 'bg-rose-100 text-rose-800'
                                  : item.strategicPriority === 'Sedang'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {item.strategicPriority} · {weight}
                            </span>
                            {linkedPkpt ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700"
                                title={linkedPkpt.title}
                              >
                                <CheckCircle2 className="w-3 h-3" /> PKPT ({linkedPkpt.priorityScore})
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">Belum PKPT</span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 align-top text-center">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {canManageSub && (
                              <button
                                type="button"
                                onClick={() => openAddSubModal(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                title="Tambah Sub-Program Kerja & Realisasi di bawah Pos Induk ini"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Sub-Program</span>
                              </button>
                            )}

                            {canVerifyFinance && !summary.hasChildren && (
                              <button
                                type="button"
                                onClick={() => openVerifyParentModal(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                title="Isi Realisasi & Verifikasi Bidang Keuangan"
                              >
                                <ShieldCheck className="w-3 h-3" />
                                <span>Verifikasi</span>
                              </button>
                            )}

                            {onNavigateToPkptWithRka && !linkedPkpt && (
                              <button
                                onClick={() => onNavigateToPkptWithRka(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                title="Jadikan objek pengawasan dalam PKPT"
                              >
                                <CalendarCheck className="w-3 h-3 text-emerald-700" />
                                <span>PKPT</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}

                            {canManage && (
                              <>
                                <button
                                  onClick={() => openEditModal(item)}
                                  className="p-1 text-slate-500 hover:text-emerald-700 rounded-md transition-colors cursor-pointer"
                                  title="Edit Pos Induk RKA"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDelete(item.id)}
                                  className="p-1 text-slate-500 hover:text-rose-600 rounded-md transition-colors cursor-pointer"
                                  title="Hapus Pos Induk RKA"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* CHILD SUB-PROGRAM ROWS (BERJENJANG) */}
                      {isExpanded &&
                        summary.children.map((sub) => {
                          const subAbsPct =
                            sub.allocatedBudget > 0
                              ? Math.round(((sub.realizationAmount || 0) / sub.allocatedBudget) * 100)
                              : 0;
                          const shareOfParentPct =
                            (item.budgetAmount || 0) > 0
                              ? Math.round(((sub.allocatedBudget || 0) / item.budgetAmount) * 100)
                              : 0;
                          const canDeleteThisSub =
                            canManage ||
                            (isBidangKeuangan && sub.verificationStatus !== 'Terverifikasi Keuangan');

                          return (
                            <tr
                              key={sub.id}
                              className="bg-emerald-50/25 hover:bg-emerald-50/50 transition-colors border-t border-slate-100"
                            >
                              <td className="py-2.5 pl-8 pr-4 align-top">
                                <div className="flex items-start gap-1.5">
                                  <span className="text-emerald-600 font-mono font-bold select-none">
                                    └
                                  </span>
                                  <div>
                                    <span className="font-mono font-bold text-slate-800 block whitespace-nowrap">
                                      {sub.subCode}
                                    </span>
                                    <span className="text-[10px] font-medium text-slate-500">
                                      {sub.executionMonth} {sub.year}
                                    </span>
                                  </div>
                                </div>
                              </td>

                              <td className="py-2.5 px-4 align-top">
                                <div className="flex items-center gap-1.5 text-[10px] text-emerald-800 font-semibold">
                                  <span>Sub-Program dari {item.code}</span>
                                  <span className="text-slate-300">·</span>
                                  <span className="text-slate-500">{sub.status}</span>
                                </div>
                                <p className="font-semibold text-slate-900 mt-0.5">{sub.programName}</p>
                                {sub.notes && (
                                  <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{sub.notes}</p>
                                )}
                              </td>

                              <td className="py-2.5 px-4 align-top">
                                {sub.locationUnitName && (
                                  <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 mb-0.5">
                                    <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                                    <span>
                                      {sub.locationUnitName}
                                      {sub.locationName &&
                                      !sub.locationUnitName.toLowerCase().includes(sub.locationName.toLowerCase())
                                        ? ` (${sub.locationName})`
                                        : ''}
                                    </span>
                                  </p>
                                )}
                                <p className="text-[11px] font-medium text-slate-700">
                                  PIC: {sub.pic || item.pic || '-'}
                                </p>
                                {sub.createdBy && (
                                  <p className="text-[10px] text-slate-400">Input: {sub.createdBy}</p>
                                )}
                              </td>

                              <td className="py-2.5 px-4 align-top text-right font-mono tabular-nums">
                                <p className="font-semibold text-slate-900 whitespace-nowrap">
                                  Rp {(sub.allocatedBudget || 0).toLocaleString('id-ID')}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  {shareOfParentPct}% dari pagu induk
                                </p>
                              </td>

                              <td className="py-2.5 px-4 align-top text-right font-mono tabular-nums">
                                <p className="font-semibold text-emerald-800 whitespace-nowrap">
                                  Rp {(sub.realizationAmount || 0).toLocaleString('id-ID')}
                                </p>
                                <p className="text-[10px] text-slate-500">Serapan {subAbsPct}%</p>
                                <p className="text-[10px] text-slate-600 mt-0.5 whitespace-nowrap">
                                  Tgl: {formatDateId(sub.realizationDate)}
                                </p>
                              </td>

                              <td className="py-2.5 px-4 align-top text-center">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-md whitespace-nowrap ${
                                    sub.verificationStatus === 'Terverifikasi Keuangan'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : sub.verificationStatus === 'Perlu Revisi'
                                      ? 'bg-rose-100 text-rose-800'
                                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  }`}
                                >
                                  {sub.verificationStatus === 'Terverifikasi Keuangan' ? (
                                    <CheckCircle2 className="w-3 h-3" />
                                  ) : sub.verificationStatus === 'Perlu Revisi' ? (
                                    <AlertCircle className="w-3 h-3" />
                                  ) : (
                                    <Clock className="w-3 h-3" />
                                  )}
                                  <span>{sub.verificationStatus || 'Menunggu Verifikasi'}</span>
                                </span>
                                <p className="text-[10px] font-mono text-slate-500 mt-1 tabular-nums whitespace-nowrap">
                                  Tgl Verif: {formatDateId(sub.verifiedAt)}
                                </p>
                                {sub.verifiedBy && (
                                  <p className="text-[10px] text-slate-500 truncate max-w-[140px] mx-auto" title={sub.verifiedBy}>
                                    {sub.verifiedBy}
                                  </p>
                                )}
                                {sub.verificationNotes && (
                                  <p className="text-[10px] text-slate-400 italic truncate max-w-[150px] mx-auto" title={sub.verificationNotes}>
                                    &ldquo;{sub.verificationNotes}&rdquo;
                                  </p>
                                )}
                              </td>

                              <td className="py-2.5 px-4 align-top text-center text-[10px] text-slate-400">
                                Turunan Pos Induk
                              </td>

                              <td className="py-2.5 px-4 align-top text-center">
                                <div className="flex items-center justify-center gap-1 flex-wrap">
                                  {canVerifyFinance && (
                                    <button
                                      type="button"
                                      onClick={() => openVerifySubModal(item, sub)}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                      title="Verifikasi Realisasi & Tetapkan Tanggal Verifikasi (Bidang Keuangan)"
                                    >
                                      <ShieldCheck className="w-3 h-3" />
                                      <span>Verifikasi</span>
                                    </button>
                                  )}
                                  {canManageSub && (
                                    <button
                                      type="button"
                                      onClick={() => openEditSubModal(item, sub)}
                                      className="p-1 text-slate-500 hover:text-emerald-700 rounded-md transition-colors cursor-pointer"
                                      title="Edit Sub-Program & Realisasi"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {canDeleteThisSub && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSubItem(item, sub)}
                                      className="p-1 text-slate-500 hover:text-rose-600 rounded-md transition-colors cursor-pointer"
                                      title="Hapus Sub-Program"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </React.Fragment>
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
                {editingItem ? 'Edit Pos Anggaran Induk (RKA)' : 'Input Pos Anggaran Induk (RKA)'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-emerald-200 hover:text-white cursor-pointer">
                ✕
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <label className="block font-semibold text-slate-700 mb-1">Kode Rekening / Pos Induk RKA</label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="Contoh: RKA-2027-001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold uppercase"
                  />
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
                  <label className="block font-semibold text-slate-700 mb-1">Pagu Anggaran Induk (Rp)</label>
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
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Pos Induk</label>
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

              <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Waktu pelaksanaan bulanan, alokasi sub-program kerja, dan realisasi anggaran (+ tanggal &amp; verifikasi Bidang Keuangan) diisi pada Sub-Program Kerja setelah Pos Induk tersimpan.
              </p>

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
                  Simpan Pos Anggaran Induk
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Tambah / Edit Sub-Program Kerja & Realisasi (Berjenjang) */}
      {isSubModalOpen && subParentItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-amber-300" />
                  <span>
                    {editingSubItem ? 'Edit Sub-Program Kerja & Realisasi' : 'Tambah Sub-Program Kerja RKA'}
                  </span>
                </h3>
                <p className="text-[11px] text-emerald-200 mt-0.5">
                  Pos Induk: <span className="font-mono font-bold text-white">{subParentItem.code}</span> ·{' '}
                  {subParentItem.programName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSubModalOpen(false)}
                className="text-emerald-200 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSubItem} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              {(() => {
                const siblingAllocated = (subItemsByParentMap.get(subParentItem.id) || [])
                  .filter((s) => s.id !== editingSubItem?.id)
                  .reduce((sum, s) => sum + (s.allocatedBudget || 0), 0);
                const projectedTotal = siblingAllocated + (Number(subFormAllocatedBudget) || 0);
                const ceilingDiff = (subParentItem.budgetAmount || 0) - projectedTotal;

                return (
                  <div
                    className={`p-3 rounded-xl border text-[11px] grid grid-cols-3 gap-2 ${
                      ceilingDiff < 0
                        ? 'bg-rose-50 border-rose-300 text-rose-900'
                        : 'bg-slate-50 border-slate-200 text-slate-700'
                    }`}
                  >
                    <div>
                      <span className="text-slate-500 block">Pagu Induk</span>
                      <strong className="font-mono text-slate-900">
                        Rp {(subParentItem.budgetAmount || 0).toLocaleString('id-ID')}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Total Alokasi Sub</span>
                      <strong className="font-mono">Rp {projectedTotal.toLocaleString('id-ID')}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">
                        {ceilingDiff < 0 ? 'Kelebihan Pagu' : 'Sisa Pagu Induk'}
                      </span>
                      <strong
                        className={`font-mono ${
                          ceilingDiff < 0 ? 'text-rose-700' : 'text-emerald-800'
                        }`}
                      >
                        Rp {Math.abs(ceilingDiff).toLocaleString('id-ID')}
                      </strong>
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode Sub-Program</label>
                  <input
                    type="text"
                    required
                    value={subFormCode}
                    onChange={(e) => setSubFormCode(e.target.value)}
                    placeholder={`${subParentItem.code}.01`}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Waktu Pelaksanaan</label>
                  <select
                    value={subFormExecutionMonth}
                    onChange={(e) => setSubFormExecutionMonth(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    {FISCAL_MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {m} {subParentItem.year}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nama Sub-Program Kerja / Uraian Kegiatan
                </label>
                <input
                  type="text"
                  required
                  value={subFormProgramName}
                  onChange={(e) => setSubFormProgramName(e.target.value)}
                  placeholder="Contoh: Pengadaan Pipa HDPE Zona II & Pemasangan Aksesoris"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Unit Lokasi (Master Data Unit Pelayanan)</span>
                </label>
                <select
                  required={serviceLocationUnits.length > 0}
                  value={subFormLocationUnitId}
                  onChange={(e) => setSubFormLocationUnitId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-900"
                >
                  <option value="">-- Pilih Unit Lokasi Pelayanan --</option>
                  {editingSubItem?.locationUnitId &&
                    !effectiveUnits.some((u) => u.id === editingSubItem.locationUnitId) && (
                      <option value={editingSubItem.locationUnitId}>
                        {editingSubItem.locationUnitName || editingSubItem.locationUnitId}
                      </option>
                    )}
                  {serviceLocationUnits.length > 0 && (
                    <optgroup label="Master Data Unit Pelayanan">
                      {serviceLocationUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {u.location && !u.name.toLowerCase().includes(u.location.toLowerCase())
                            ? ` — ${u.location}`
                            : ''}{' '}
                          ({u.code})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherLocationUnits.length > 0 && (
                    <optgroup label="Kantor Pusat & Bidang Lainnya">
                      {otherLocationUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                          {u.location ? ` — ${u.location}` : ''} ({u.code})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                {(() => {
                  const chosen = effectiveUnits.find((u) => u.id === subFormLocationUnitId);
                  if (!chosen) return null;
                  return (
                    <p className="text-[10px] text-emerald-700 mt-1">
                      Wilayah / Lokasi: <strong>{chosen.location || chosen.name}</strong> · Kepala Unit:{' '}
                      {chosen.headName || '-'}
                    </p>
                  );
                })()}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Anggaran Sub-Program (Rp)
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={subFormAllocatedBudget}
                    onChange={(e) => setSubFormAllocatedBudget(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Realisasi (Rp)</label>
                  <input
                    type="number"
                    min={0}
                    value={subFormRealizationAmount}
                    onChange={(e) => setSubFormRealizationAmount(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-emerald-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tanggal Realisasi</label>
                  <input
                    type="date"
                    value={subFormRealizationDate}
                    onChange={(e) => setSubFormRealizationDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Pelaksanaan</label>
                  <select
                    value={subFormStatus}
                    onChange={(e) => setSubFormStatus(e.target.value as RKAStatus)}
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
                    value={subFormPic}
                    onChange={(e) => setSubFormPic(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keterangan / Bukti SPJ</label>
                <textarea
                  rows={2}
                  value={subFormNotes}
                  onChange={(e) => setSubFormNotes(e.target.value)}
                  placeholder="Nomor SPJ, nomor kontrak/SPK, atau keterangan realisasi keuangan..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsSubModalOpen(false)}
                  disabled={subSaving}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={subSaving}
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm cursor-pointer disabled:opacity-60"
                >
                  {subSaving ? 'Menyimpan...' : 'Simpan Sub-Program'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Verifikasi Realisasi Bidang Keuangan */}
      {isVerifyModalOpen && verifyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-300" />
                  <span>Verifikasi Realisasi Anggaran (Bidang Keuangan)</span>
                </h3>
                <p className="text-[11px] text-emerald-200 mt-0.5 font-mono">
                  {verifyTarget.mode === 'sub'
                    ? `${verifyTarget.sub.subCode} (Induk: ${verifyTarget.parent.code})`
                    : verifyTarget.parent.code}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsVerifyModalOpen(false)}
                className="text-emerald-200 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveVerification} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <p className="font-bold text-slate-900">
                  {verifyTarget.mode === 'sub'
                    ? verifyTarget.sub.programName
                    : verifyTarget.parent.programName}
                </p>
                {verifyTarget.mode === 'sub' && verifyTarget.sub.locationUnitName && (
                  <p className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span>{verifyTarget.sub.locationUnitName}</span>
                  </p>
                )}
                <p className="text-[11px] text-slate-600 font-mono">
                  Pagu / Alokasi: Rp{' '}
                  {(verifyTarget.mode === 'sub'
                    ? verifyTarget.sub.allocatedBudget
                    : verifyTarget.parent.budgetAmount
                  ).toLocaleString('id-ID')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Nilai Realisasi Terverifikasi (Rp)
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={verifyRealizationAmount}
                    onChange={(e) => setVerifyRealizationAmount(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-emerald-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Tanggal Realisasi</span>
                  </label>
                  <input
                    type="date"
                    value={verifyRealizationDate}
                    onChange={(e) => setVerifyRealizationDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Status Verifikasi Keuangan
                  </label>
                  <select
                    value={verifyStatus}
                    onChange={(e) => setVerifyStatus(e.target.value as RKAVerificationStatus)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-bold text-slate-900"
                  >
                    <option value="Terverifikasi Keuangan">Terverifikasi Keuangan (Sah)</option>
                    <option value="Perlu Revisi">Perlu Revisi / Lengkapi SPJ</option>
                    <option value="Menunggu Verifikasi">Menunggu Verifikasi</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Tanggal Verifikasi</span>
                  </label>
                  <input
                    type="date"
                    required={verifyStatus !== 'Menunggu Verifikasi'}
                    value={verifyDate}
                    onChange={(e) => setVerifyDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Petugas Verifikator (Bidang Keuangan)
                </label>
                <input
                  type="text"
                  required={verifyStatus !== 'Menunggu Verifikasi'}
                  value={verifyBy}
                  onChange={(e) => setVerifyBy(e.target.value)}
                  placeholder="Nama Pejabat / Staf Bidang Keuangan"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Catatan Pemeriksaan &amp; Verifikasi Keuangan
                </label>
                <textarea
                  rows={2}
                  value={verifyNotes}
                  onChange={(e) => setVerifyNotes(e.target.value)}
                  placeholder="Catatan kecocokan bukti kas, SP2D/SPJ, pajak, atau alasan revisi..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsVerifyModalOpen(false)}
                  disabled={verifySaving}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={verifySaving}
                  className="flex items-center gap-1.5 px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm cursor-pointer disabled:opacity-60"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>{verifySaving ? 'Menyimpan...' : 'Simpan Verifikasi'}</span>
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
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 grid grid-cols-4 gap-3">
                <div>
                  <p className="text-slate-500">Tahun Anggaran:</p>
                  <p className="font-bold text-slate-900">{selectedYear === 0 ? 'Semua Tahun' : selectedYear}</p>
                </div>
                <div>
                  <p className="text-slate-500">Pos Induk &amp; Sub-Program:</p>
                  <p className="font-bold text-emerald-800">
                    {filteredRka.length} Induk · {totalSubProgramsCount} Sub
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Total Pagu Anggaran:</p>
                  <p className="font-bold text-slate-900 font-mono">Rp {totalBudget.toLocaleString('id-ID')}</p>
                </div>
                <div>
                  <p className="text-slate-500">Total Realisasi (Terverifikasi):</p>
                  <p className="font-bold text-emerald-800 font-mono">
                    Rp {totalRealization.toLocaleString('id-ID')} ({verifiedProgramsCount}/{filteredRka.length})
                  </p>
                </div>
              </div>

              <table className="w-full text-left text-[10px] border-collapse border border-slate-300">
                <thead>
                  <tr className="bg-slate-100 font-bold text-slate-800">
                    <th className="p-2 border border-slate-300 w-8 text-center">No</th>
                    <th className="p-2 border border-slate-300">Kode &amp; Uraian Program (Pos Induk / Sub-Program)</th>
                    <th className="p-2 border border-slate-300">Waktu</th>
                    <th className="p-2 border border-slate-300">Unit / PIC</th>
                    <th className="p-2 border border-slate-300 text-right">Pagu / Alokasi (Rp)</th>
                    <th className="p-2 border border-slate-300 text-right">Realisasi &amp; Tgl Realisasi</th>
                    <th className="p-2 border border-slate-300 text-center">Verifikasi Keuangan &amp; Tgl Verifikasi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRka.map((r, i) => {
                    const summary = getParentSummary(r);
                    return (
                      <React.Fragment key={r.id}>
                        <tr className={summary.hasChildren ? 'bg-slate-50/90 font-semibold' : ''}>
                          <td className="p-2 border border-slate-300 text-center align-top">{i + 1}</td>
                          <td className="p-2 border border-slate-300 align-top">
                            <p className="font-bold text-slate-900">{r.programName}</p>
                            <p className="text-[9px] text-slate-600 font-mono">
                              {r.code} ({r.category}) · Bobot: {calculateRkaWeightScore(r.budgetAmount, r.strategicPriority)}
                            </p>
                          </td>
                          <td className="p-2 border border-slate-300 align-top">
                            {formatParentScheduleLabel(r, summary.children)}
                          </td>
                          <td className="p-2 border border-slate-300 align-top">
                            <p>{r.unitName}</p>
                            <p className="text-[9px] text-slate-500">PIC: {r.pic || '-'}</p>
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono font-bold align-top">
                            Rp {(r.budgetAmount || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono align-top">
                            <p className="font-bold text-slate-900">
                              Rp {summary.effectiveRealization.toLocaleString('id-ID')}
                            </p>
                            <p className="text-[9px] text-slate-600">
                              Tgl Realisasi: {formatDateId(summary.latestRealizationDate)}
                            </p>
                          </td>
                          <td className="p-2 border border-slate-300 text-center align-top">
                            <p className="font-bold text-slate-900">
                              {summary.hasChildren
                                ? `${summary.verifiedCount}/${summary.children.length} Terverifikasi`
                                : summary.effectiveVerificationStatus}
                            </p>
                            <p className="text-[9px] font-mono text-slate-600">
                              Tgl Verifikasi: {formatDateId(summary.latestVerificationDate)}
                            </p>
                            {summary.latestVerifiedBy && (
                              <p className="text-[9px] text-slate-500">{summary.latestVerifiedBy}</p>
                            )}
                          </td>
                        </tr>

                        {summary.children.map((sub, subIdx) => (
                          <tr key={sub.id} className="bg-white">
                            <td className="p-1.5 border border-slate-300 text-center text-slate-500 align-top">
                              {i + 1}.{subIdx + 1}
                            </td>
                            <td className="p-1.5 pl-5 border border-slate-300 align-top">
                              <p className="font-semibold text-slate-800">└ {sub.programName}</p>
                              <p className="text-[9px] text-slate-500 font-mono">
                                {sub.subCode} · {sub.status}
                              </p>
                            </td>
                            <td className="p-1.5 border border-slate-300 align-top">
                              {sub.executionMonth} {sub.year}
                            </td>
                            <td className="p-1.5 border border-slate-300 align-top text-slate-600">
                              {sub.locationUnitName && (
                                <p className="font-semibold text-slate-800">{sub.locationUnitName}</p>
                              )}
                              <p>PIC: {sub.pic || '-'}</p>
                            </td>
                            <td className="p-1.5 border border-slate-300 text-right font-mono align-top">
                              Rp {(sub.allocatedBudget || 0).toLocaleString('id-ID')}
                            </td>
                            <td className="p-1.5 border border-slate-300 text-right font-mono align-top">
                              <p className="font-semibold text-emerald-800">
                                Rp {(sub.realizationAmount || 0).toLocaleString('id-ID')}
                              </p>
                              <p className="text-[9px] text-slate-600">
                                Tgl: {formatDateId(sub.realizationDate)}
                              </p>
                            </td>
                            <td className="p-1.5 border border-slate-300 text-center align-top">
                              <p className="font-semibold text-slate-800">
                                {sub.verificationStatus || 'Menunggu Verifikasi'}
                              </p>
                              <p className="text-[9px] font-mono text-slate-600">
                                Tgl Verif: {formatDateId(sub.verifiedAt)}
                              </p>
                              {sub.verifiedBy && (
                                <p className="text-[9px] text-slate-500">{sub.verifiedBy}</p>
                              )}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
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
