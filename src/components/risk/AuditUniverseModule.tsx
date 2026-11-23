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
  Compass,
  Plus,
  Edit2,
  Trash2,
  Download,
  Printer,
  Search,
  Sparkles,
  RefreshCw,
  BookOpen,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  CalendarCheck,
  ShieldCheck,
  Layers,
  X,
  ArrowRight,
  Clock,
  Wallet,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  AuditReport,
  AuditUniverseCategory,
  AuditUniverseItem,
  Finding,
  PKPT,
  RKAItem,
  RiskRegister,
  Unit,
  WBSReport,
} from '../../types/audit';
import { AUDIT_TYPES, INITIAL_UNITS } from '../../data/initialData';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { useAppBranding } from '../../context/AppBrandingContext';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';
import {
  AUDIT_UNIVERSE_CATEGORIES,
  AUDIT_UNIVERSE_GUIDELINES,
  AUDIT_UNIVERSE_WEIGHTS,
  buildStandardAuditUniverseCatalog,
  computeAuditUniverseCompositeScore,
  computeLiveMetricsForUnit,
  deriveRiskTierAndCycle,
  isEntityScheduledInPkpt,
  mapCompositeToUnitRiskScore25,
} from '../../lib/auditUniverseAnalytics';
import {
  formatPkptExecutionSchedule,
  formatQuarterAsCurrentMonth,
} from '../../lib/featureCatalog';

interface AuditUniverseModuleProps {
  onNavigateToPkptWithUniverse?: (item: AuditUniverseItem) => void;
}

const SCORE_LABELS: Record<number, string> = {
  1: '1 - Sangat Rendah',
  2: '2 - Rendah',
  3: '3 - Sedang',
  4: '4 - Tinggi',
  5: '5 - Sangat Tinggi / Kritis',
};

const TIER_BADGE_CLASSES: Record<string, string> = {
  'Sangat Tinggi (P1)': 'bg-rose-100 text-rose-800 border-rose-300',
  'Tinggi (P2)': 'bg-amber-100 text-amber-800 border-amber-300',
  'Sedang (P3)': 'bg-sky-100 text-sky-800 border-sky-300',
  'Rendah (P4)': 'bg-slate-100 text-slate-700 border-slate-300',
};

export const AuditUniverseModule: React.FC<AuditUniverseModuleProps> = ({
  onNavigateToPkptWithUniverse,
}) => {
  const { userProfile, hasRole } = useAuth();
  const { activeYear, availableYears, addCustomYear } = useFiscalYear();
  const { branding } = useAppBranding();

  const canEdit = hasRole(['KEPALA_SPI', 'ADMIN_SISTEM']);

  const [universeItems, setUniverseItems] = useState<AuditUniverseItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [risks, setRisks] = useState<RiskRegister[]>([]);
  const [rkaItems, setRkaItems] = useState<RKAItem[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [auditReports, setAuditReports] = useState<AuditReport[]>([]);
  const [wbsReports, setWbsReports] = useState<WBSReport[]>([]);
  const [pkptList, setPkptList] = useState<PKPT[]>([]);

  // Filters & UI states
  const [selectedYear, setSelectedYear] = useState<number>(activeYear);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [tierFilter, setTierFilter] = useState<string>('ALL');
  const [coverageFilter, setCoverageFilter] = useState<'ALL' | 'UNSCHEDULED' | 'SCHEDULED'>('ALL');
  const [showGuidelines, setShowGuidelines] = useState(false);

  // Selection & Async Operations
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSeedingCatalog, setIsSeedingCatalog] = useState(false);
  const [isSyncingScores, setIsSyncingScores] = useState(false);
  const [isGeneratingPkpt, setIsGeneratingPkpt] = useState(false);

  // Modals & Notifications
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AuditUniverseItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuditUniverseItem | null>(null);
  const [confirmBatchModalOpen, setConfirmBatchModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Form states
  const [formCode, setFormCode] = useState('');
  const [formYear, setFormYear] = useState<number>(activeYear);
  const [formEntityName, setFormEntityName] = useState('');
  const [formCategory, setFormCategory] = useState<AuditUniverseCategory>('Proses Bisnis Operasional');
  const [formUnitId, setFormUnitId] = useState('');
  const [formBusinessProcess, setFormBusinessProcess] = useState('');
  const [formRegulatoryBasis, setFormRegulatoryBasis] = useState('');
  const [formDefaultAuditType, setFormDefaultAuditType] = useState('Audit Operasional');
  const [formObjectiveTemplate, setFormObjectiveTemplate] = useState('');
  const [formScopeTemplate, setFormScopeTemplate] = useState('');
  const [formRiskFactorScore, setFormRiskFactorScore] = useState<number>(3);
  const [formMaterialityScore, setFormMaterialityScore] = useState<number>(3);
  const [formControlHistoryScore, setFormControlHistoryScore] = useState<number>(4);
  const [formComplianceImpactScore, setFormComplianceImpactScore] = useState<number>(4);
  const [formComplexityScore, setFormComplexityScore] = useState<number>(3);
  const [formRecommendedQuarter, setFormRecommendedQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q1');
  const [formEstimatedDays, setFormEstimatedDays] = useState<number>(10);
  const [formLastAuditYear, setFormLastAuditYear] = useState<string>('');
  const [formNotes, setFormNotes] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  useEffect(() => {
    const unsubUniverse = onSnapshot(
      collection(db, 'audit_universe'),
      (snap) => {
        setUniverseItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditUniverseItem)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'audit_universe')
    );

    const unsubUnits = onSnapshot(
      collection(db, 'units'),
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Unit));
        if (docs.length > 0) {
          setUnits(docs);
        } else {
          setUnits(
            INITIAL_UNITS.map((u, i) => ({
              id: `init-unit-${i + 1}`,
              ...u,
            }))
          );
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'units')
    );

    const unsubRisks = onSnapshot(
      collection(db, 'risk_registers'),
      (snap) => setRisks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskRegister))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'risk_registers')
    );

    const unsubRka = onSnapshot(
      collection(db, 'rka_items'),
      (snap) => setRkaItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RKAItem))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'rka_items')
    );

    const unsubFindings = onSnapshot(
      collection(db, 'findings'),
      (snap) => setFindings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Finding))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'findings')
    );

    const unsubReports = onSnapshot(
      collection(db, 'audit_reports'),
      (snap) => setAuditReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AuditReport))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'audit_reports')
    );

    const unsubWbs = onSnapshot(
      collection(db, 'wbs_reports'),
      (snap) => setWbsReports(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WBSReport))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'wbs_reports')
    );

    const unsubPkpt = onSnapshot(
      collection(db, 'pkpt'),
      (snap) => setPkptList(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PKPT))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'pkpt')
    );

    return () => {
      unsubUniverse();
      unsubUnits();
      unsubRisks();
      unsubRka();
      unsubFindings();
      unsubReports();
      unsubWbs();
      unsubPkpt();
    };
  }, []);

  const effectiveYear = selectedYear === 0 ? activeYear : selectedYear;

  const yearOptions = useMemo(() => {
    const docYears = universeItems.map((u) => u.year).filter((y) => typeof y === 'number' && y > 0);
    return Array.from(new Set([...availableYears, ...docYears])).sort((a, b) => b - a);
  }, [availableYears, universeItems]);

  // Live enriched metrics per item
  const enrichedItems = useMemo(() => {
    return universeItems
      .filter((item) => selectedYear === 0 || item.year === selectedYear)
      .map((item) => {
        const live = computeLiveMetricsForUnit({
          unitId: item.unitId,
          unitName: item.unitName,
          year: item.year || effectiveYear,
          risks,
          rkaItems,
          findings,
          auditReports,
          wbsReports,
          fallbackLastAuditYear: item.lastAuditYear,
        });
        const linkedPkpt = isEntityScheduledInPkpt(item, pkptList, item.year || effectiveYear);
        return {
          item,
          live,
          linkedPkpt,
        };
      })
      .sort((a, b) => (b.item.compositeScore || 0) - (a.item.compositeScore || 0));
  }, [universeItems, selectedYear, effectiveYear, risks, rkaItems, findings, auditReports, wbsReports, pkptList]);

  const filteredRows = useMemo(() => {
    return enrichedItems.filter(({ item, linkedPkpt }) => {
      const q = searchTerm.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.code.toLowerCase().includes(q) ||
        item.entityName.toLowerCase().includes(q) ||
        item.unitName.toLowerCase().includes(q) ||
        item.businessProcess.toLowerCase().includes(q) ||
        item.regulatoryBasis.toLowerCase().includes(q);
      const matchesCategory = categoryFilter === 'ALL' || item.category === categoryFilter;
      const matchesTier = tierFilter === 'ALL' || item.riskTier === tierFilter;
      const matchesCoverage =
        coverageFilter === 'ALL' ||
        (coverageFilter === 'SCHEDULED' && Boolean(linkedPkpt)) ||
        (coverageFilter === 'UNSCHEDULED' && !linkedPkpt);
      return matchesSearch && matchesCategory && matchesTier && matchesCoverage;
    });
  }, [enrichedItems, searchTerm, categoryFilter, tierFilter, coverageFilter]);

  // KPI Metrics
  const stats = useMemo(() => {
    const activeRows = enrichedItems.filter((r) => r.item.isActive !== false);
    const total = activeRows.length;
    const p1Count = activeRows.filter((r) => r.item.riskTier === 'Sangat Tinggi (P1)').length;
    const p2Count = activeRows.filter((r) => r.item.riskTier === 'Tinggi (P2)').length;
    const scheduledRows = activeRows.filter((r) => Boolean(r.linkedPkpt));
    const scheduledCount = scheduledRows.length;
    const coveragePct = total > 0 ? Math.round((scheduledCount / total) * 100) : 0;
    const totalUniverseMandays = activeRows.reduce((s, r) => s + (r.item.estimatedDays || 0), 0);
    const scheduledPkptMandays = scheduledRows.reduce(
      (s, r) => s + (r.linkedPkpt?.estimatedDays || r.item.estimatedDays || 0),
      0
    );
    const highAlertCount = activeRows.filter(
      (r) =>
        r.live.openFindingsCount > 0 ||
        r.live.openWbsCount > 0 ||
        !r.live.lastAuditYear ||
        (r.item.year || effectiveYear) - r.live.lastAuditYear >= 2
    ).length;

    return {
      total,
      p1Count,
      p2Count,
      scheduledCount,
      coveragePct,
      totalUniverseMandays,
      scheduledPkptMandays,
      highAlertCount,
    };
  }, [enrichedItems, effectiveYear]);

  // Batch target calculation: if user checked rows, use unscheduled checked rows; otherwise all unscheduled P1 & P2 rows
  const batchTargetRows = useMemo(() => {
    if (selectedIds.size > 0) {
      return enrichedItems.filter((r) => selectedIds.has(r.item.id) && !r.linkedPkpt);
    }
    return enrichedItems.filter(
      (r) =>
        !r.linkedPkpt &&
        r.item.isActive !== false &&
        (r.item.riskTier === 'Sangat Tinggi (P1)' || r.item.riskTier === 'Tinggi (P2)')
    );
  }, [enrichedItems, selectedIds]);

  // Live form preview calculation
  const liveFormDerived = useMemo(() => {
    const compositeScore = computeAuditUniverseCompositeScore({
      riskFactorScore: formRiskFactorScore,
      materialityScore: formMaterialityScore,
      controlHistoryScore: formControlHistoryScore,
      complianceImpactScore: formComplianceImpactScore,
      complexityScore: formComplexityScore,
    });
    const derived = deriveRiskTierAndCycle(compositeScore);
    return { compositeScore, ...derived };
  }, [
    formRiskFactorScore,
    formMaterialityScore,
    formControlHistoryScore,
    formComplianceImpactScore,
    formComplexityScore,
  ]);

  const handleGenerateStandardCatalog = async () => {
    if (!canEdit) return;
    setIsSeedingCatalog(true);
    try {
      const targetYear = effectiveYear;
      const existingCodes = new Set(
        universeItems.filter((u) => u.year === targetYear).map((u) => u.code.toUpperCase())
      );
      const activeUnitPool =
        units.length > 0
          ? units
          : INITIAL_UNITS.map((u, idx) => ({ id: `init-unit-${idx + 1}`, ...u }));

      const catalog = buildStandardAuditUniverseCatalog({
        year: targetYear,
        units: activeUnitPool,
        risks,
        rkaItems,
        findings,
        auditReports,
        wbsReports,
        existingCodes,
        createdBy: userProfile?.displayName || 'Kepala SPI',
      });

      if (catalog.length === 0) {
        showToast(
          'info',
          `Seluruh katalog standar Audit Universe (9 proses inti + cabang) untuk Tahun ${targetYear} sudah tersedia.`
        );
        return;
      }

      for (const item of catalog) {
        await setDoc(doc(db, 'audit_universe', item.id), item);
      }

      addCustomYear(targetYear);
      showToast(
        'success',
        `Berhasil menyusun ${catalog.length} entitas Audit Universe standar BUMD Air Minum untuk TA ${targetYear}.`
      );
    } catch (err) {
      console.error('Error seeding Audit Universe:', err);
      showToast('error', 'Gagal membuat katalog standar Audit Universe.');
    } finally {
      setIsSeedingCatalog(false);
    }
  };

  const handleSyncRealtimeScores = async () => {
    if (!canEdit) return;
    const itemsToSync = universeItems.filter((u) => selectedYear === 0 || u.year === selectedYear);
    if (itemsToSync.length === 0) {
      showToast('info', 'Belum ada entitas Audit Universe untuk disinkronkan.');
      return;
    }

    setIsSyncingScores(true);
    try {
      const nowIso = new Date().toISOString();
      for (const item of itemsToSync) {
        const live = computeLiveMetricsForUnit({
          unitId: item.unitId,
          unitName: item.unitName,
          year: item.year || effectiveYear,
          risks,
          rkaItems,
          findings,
          auditReports,
          wbsReports,
          fallbackLastAuditYear: item.lastAuditYear,
        });

        const hasRiskData = risks.some(
          (r) =>
            r.unitId === item.unitId ||
            (r.unitName && r.unitName.toLowerCase() === item.unitName.toLowerCase())
        );
        const hasRkaData = rkaItems.some(
          (r) =>
            r.unitId === item.unitId ||
            (r.unitName && r.unitName.toLowerCase() === item.unitName.toLowerCase())
        );

        const nextRiskFactor = hasRiskData ? live.riskFactorScore : item.riskFactorScore;
        const nextMateriality = hasRkaData ? live.materialityScore : item.materialityScore;
        const nextControlHistory = live.controlHistoryScore;

        const compositeScore = computeAuditUniverseCompositeScore({
          riskFactorScore: nextRiskFactor,
          materialityScore: nextMateriality,
          controlHistoryScore: nextControlHistory,
          complianceImpactScore: item.complianceImpactScore,
          complexityScore: item.complexityScore,
        });
        const derived = deriveRiskTierAndCycle(compositeScore);

        await updateDoc(doc(db, 'audit_universe', item.id), {
          riskFactorScore: nextRiskFactor,
          materialityScore: nextMateriality,
          controlHistoryScore: nextControlHistory,
          compositeScore,
          riskTier: derived.riskTier,
          recommendedFrequency: derived.recommendedFrequency,
          lastAuditYear: live.lastAuditYear ?? null,
          lastAuditDate: live.lastAuditDate ?? '',
          lastAuditOpinion: live.lastAuditOpinion ?? '',
          openFindingsCount: live.openFindingsCount,
          linkedRkaBudget: live.linkedRkaBudget,
          updatedAt: nowIso,
        });
      }
      showToast(
        'success',
        `Skor risiko & indikator real-time untuk ${itemsToSync.length} objek Audit Universe berhasil diperbarui.`
      );
    } catch (err) {
      console.error('Error syncing Audit Universe scores:', err);
      showToast('error', 'Gagal menyinkronkan skor Audit Universe.');
    } finally {
      setIsSyncingScores(false);
    }
  };

  const openAddModal = () => {
    const targetYr = effectiveYear;
    const defaultUnit = units[0];
    const nextNum = universeItems.filter((u) => u.year === targetYr).length + 1;
    const defaultCode = `AU-OBJ-${String(nextNum).padStart(2, '0')}`;

    setEditingItem(null);
    setFormCode(defaultCode);
    setFormYear(targetYr);
    setFormEntityName('');
    setFormCategory('Proses Bisnis Operasional');
    setFormUnitId(defaultUnit?.id || '');
    setFormBusinessProcess('');
    setFormRegulatoryBasis('GIAS 2024 Std 9.4; PP No. 54/2017; Permendagri No. 23/2024');
    setFormDefaultAuditType('Audit Operasional');
    setFormObjectiveTemplate('');
    setFormScopeTemplate('');

    if (defaultUnit) {
      const live = computeLiveMetricsForUnit({
        unitId: defaultUnit.id,
        unitName: defaultUnit.name,
        year: targetYr,
        risks,
        rkaItems,
        findings,
        auditReports,
        wbsReports,
      });
      setFormRiskFactorScore(live.riskFactorScore);
      setFormMaterialityScore(live.materialityScore);
      setFormControlHistoryScore(live.controlHistoryScore);
      setFormLastAuditYear(live.lastAuditYear ? String(live.lastAuditYear) : '');
    } else {
      setFormRiskFactorScore(3);
      setFormMaterialityScore(3);
      setFormControlHistoryScore(4);
      setFormLastAuditYear('');
    }
    setFormComplianceImpactScore(4);
    setFormComplexityScore(3);
    setFormRecommendedQuarter('Q2');
    setFormEstimatedDays(10);
    setFormNotes('');
    setFormIsActive(true);
    setIsModalOpen(true);
  };

  const openEditModal = (item: AuditUniverseItem) => {
    setEditingItem(item);
    setFormCode(item.code);
    setFormYear(item.year);
    setFormEntityName(item.entityName);
    setFormCategory(item.category);
    setFormUnitId(item.unitId);
    setFormBusinessProcess(item.businessProcess);
    setFormRegulatoryBasis(item.regulatoryBasis);
    setFormDefaultAuditType(item.defaultAuditType);
    setFormObjectiveTemplate(item.auditObjectiveTemplate);
    setFormScopeTemplate(item.auditScopeTemplate);
    setFormRiskFactorScore(item.riskFactorScore);
    setFormMaterialityScore(item.materialityScore);
    setFormControlHistoryScore(item.controlHistoryScore);
    setFormComplianceImpactScore(item.complianceImpactScore);
    setFormComplexityScore(item.complexityScore);
    setFormRecommendedQuarter(item.recommendedQuarter);
    setFormEstimatedDays(item.estimatedDays);
    setFormLastAuditYear(item.lastAuditYear ? String(item.lastAuditYear) : '');
    setFormNotes(item.notes || '');
    setFormIsActive(item.isActive !== false);
    setIsModalOpen(true);
  };

  const handleApplyLiveUnitMetricsToForm = () => {
    const selUnit = units.find((u) => u.id === formUnitId);
    if (!selUnit) return;
    const live = computeLiveMetricsForUnit({
      unitId: selUnit.id,
      unitName: selUnit.name,
      year: formYear,
      risks,
      rkaItems,
      findings,
      auditReports,
      wbsReports,
      fallbackLastAuditYear: formLastAuditYear ? parseInt(formLastAuditYear, 10) : undefined,
    });
    setFormRiskFactorScore(live.riskFactorScore);
    setFormMaterialityScore(live.materialityScore);
    setFormControlHistoryScore(live.controlHistoryScore);
    if (live.lastAuditYear) {
      setFormLastAuditYear(String(live.lastAuditYear));
    }
    const nextComposite = computeAuditUniverseCompositeScore({
      riskFactorScore: live.riskFactorScore,
      materialityScore: live.materialityScore,
      controlHistoryScore: live.controlHistoryScore,
      complianceImpactScore: formComplianceImpactScore,
      complexityScore: formComplexityScore,
    });
    const nextDerived = deriveRiskTierAndCycle(nextComposite);
    setFormEstimatedDays(nextDerived.estimatedDays);
    showToast('info', `Faktor risiko, materialitas RKA, & riwayat audit ${selUnit.name} diterapkan ke form.`);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!formCode.trim() || !formEntityName.trim()) {
      showToast('error', 'Kode objek dan nama entitas audit wajib diisi.');
      return;
    }

    const selUnit = units.find((u) => u.id === formUnitId);
    const unitName = selUnit?.name || 'Unit Kerja';
    const validYear = isNaN(formYear) ? effectiveYear : formYear;
    addCustomYear(validYear);

    const parsedLastYear = formLastAuditYear.trim() ? parseInt(formLastAuditYear.trim(), 10) : undefined;
    const live = computeLiveMetricsForUnit({
      unitId: formUnitId,
      unitName,
      year: validYear,
      risks,
      rkaItems,
      findings,
      auditReports,
      wbsReports,
      fallbackLastAuditYear: parsedLastYear && !isNaN(parsedLastYear) ? parsedLastYear : undefined,
    });

    const compositeScore = computeAuditUniverseCompositeScore({
      riskFactorScore: formRiskFactorScore,
      materialityScore: formMaterialityScore,
      controlHistoryScore: formControlHistoryScore,
      complianceImpactScore: formComplianceImpactScore,
      complexityScore: formComplexityScore,
    });
    const derived = deriveRiskTierAndCycle(compositeScore);
    const nowIso = new Date().toISOString();

    const payload: Omit<AuditUniverseItem, 'id'> = {
      code: formCode.trim().toUpperCase(),
      year: validYear,
      entityName: formEntityName.trim(),
      category: formCategory,
      unitId: formUnitId,
      unitName,
      businessProcess: formBusinessProcess.trim() || formCategory,
      regulatoryBasis: formRegulatoryBasis.trim() || 'GIAS 2024 Std 9.4',
      defaultAuditType: formDefaultAuditType,
      auditObjectiveTemplate:
        formObjectiveTemplate.trim() ||
        `Evaluasi kepatuhan, efektivitas pengendalian intern, dan pencapaian target pada ${formEntityName.trim()}.`,
      auditScopeTemplate:
        formScopeTemplate.trim() ||
        `Dokumen operasional, transaksi keuangan/RKA, dan catatan pengendalian pada ${unitName}.`,
      riskFactorScore: formRiskFactorScore,
      materialityScore: formMaterialityScore,
      controlHistoryScore: formControlHistoryScore,
      complianceImpactScore: formComplianceImpactScore,
      complexityScore: formComplexityScore,
      compositeScore,
      riskTier: derived.riskTier,
      recommendedFrequency: derived.recommendedFrequency,
      recommendedQuarter: formRecommendedQuarter,
      estimatedDays: formEstimatedDays > 0 ? formEstimatedDays : derived.estimatedDays,
      ...(parsedLastYear && !isNaN(parsedLastYear) ? { lastAuditYear: parsedLastYear } : {}),
      ...(live.lastAuditDate ? { lastAuditDate: live.lastAuditDate } : {}),
      ...(live.lastAuditOpinion ? { lastAuditOpinion: live.lastAuditOpinion } : {}),
      openFindingsCount: live.openFindingsCount,
      linkedRkaBudget: live.linkedRkaBudget,
      isActive: formIsActive,
      notes: formNotes.trim(),
      createdBy: editingItem?.createdBy || userProfile?.displayName || 'Kepala SPI',
      createdAt: editingItem?.createdAt || nowIso,
      updatedAt: nowIso,
    };

    try {
      if (editingItem) {
        await updateDoc(doc(db, 'audit_universe', editingItem.id), payload);
        showToast('success', `Entitas "${payload.entityName}" berhasil diperbarui.`);
      } else {
        const cleanCode = payload.code.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const id = `au-${cleanCode}-${Date.now().toString().slice(-5)}`;
        await setDoc(doc(db, 'audit_universe', id), { id, ...payload });
        showToast('success', `Entitas baru "${payload.entityName}" ditambahkan ke Audit Universe.`);
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error('Error saving Audit Universe:', err);
      showToast('error', 'Gagal menyimpan entitas Audit Universe.');
    }
  };

  const confirmDelete = async () => {
    if (!canEdit || !deleteTarget) return;
    try {
      await deleteDoc(doc(db, 'audit_universe', deleteTarget.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      showToast('success', `Entitas "${deleteTarget.entityName}" telah dihapus dari Audit Universe.`);
      setDeleteTarget(null);
    } catch (err) {
      console.error('Error deleting Audit Universe item:', err);
      showToast('error', 'Gagal menghapus entitas Audit Universe.');
    }
  };

  const handleBatchGeneratePkpt = async () => {
    if (!canEdit || batchTargetRows.length === 0) return;
    setIsGeneratingPkpt(true);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      for (let idx = 0; idx < batchTargetRows.length; idx++) {
        const { item } = batchTargetRows[idx];
        const derived = deriveRiskTierAndCycle(item.compositeScore);
        const pkptId = `pkpt-au-${Date.now()}-${idx}`;
        const pkptDoc: PKPT = {
          id: pkptId,
          year: item.year || effectiveYear,
          title: item.entityName,
          unitId: item.unitId,
          unitName: item.unitName,
          businessProcess: item.businessProcess,
          riskScore: mapCompositeToUnitRiskScore25(item.compositeScore),
          priorityScore: item.compositeScore,
          priorityRank: derived.priorityRank,
          auditType: item.defaultAuditType || 'Audit Operasional',
          objective: item.auditObjectiveTemplate,
          scope: item.auditScopeTemplate,
          estimatedDays: item.estimatedDays || derived.estimatedDays,
          quarter: item.recommendedQuarter || 'Q1',
          status: 'Rencana',
          approvalStatus: 'Disetujui',
          approvedBy: userProfile?.displayName || 'Kepala SPI',
          approvedAt: todayIso,
          auditUniverseId: item.id,
          auditUniverseCode: item.code,
          auditUniverseName: item.entityName,
        };
        await setDoc(doc(db, 'pkpt', pkptId), pkptDoc);
      }

      const count = batchTargetRows.length;
      setSelectedIds(new Set());
      setConfirmBatchModalOpen(false);
      showToast(
        'success',
        `${count} objek Audit Universe berhasil diturunkan menjadi rencana kerja PKPT Berbasis Risiko.`
      );
    } catch (err) {
      console.error('Error batch generating PKPT:', err);
      showToast('error', 'Gagal menurunkan Audit Universe ke PKPT.');
    } finally {
      setIsGeneratingPkpt(false);
    }
  };

  const toggleRowSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisibleUnscheduled = () => {
    const unscheduledIds = filteredRows.filter((r) => !r.linkedPkpt).map((r) => r.item.id);
    if (unscheduledIds.length === 0) return;
    const allSelected = unscheduledIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        unscheduledIds.forEach((id) => next.delete(id));
      } else {
        unscheduledIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const exportToExcel = () => {
    const rows = filteredRows.map(({ item, live, linkedPkpt }, idx) => ({
      No: idx + 1,
      Kode: item.code,
      Tahun: item.year,
      'Nama Entitas / Objek Audit': item.entityName,
      Kategori: item.category,
      'Unit Kerja / Pemilik Risiko': item.unitName,
      'Proses Bisnis': item.businessProcess,
      'Dasar Regulasi & Standar': item.regulatoryBasis,
      'Jenis Audit Default': item.defaultAuditType,
      'Faktor Risiko (30%)': item.riskFactorScore,
      'Materialitas RKA (25%)': item.materialityScore,
      'Riwayat Kontrol/Temuan (20%)': item.controlHistoryScore,
      'Kepatuhan & Layanan (15%)': item.complianceImpactScore,
      'Kompleksitas (10%)': item.complexityScore,
      'Skor Komposit (0-100)': item.compositeScore,
      'Peringkat Risiko': item.riskTier,
      'Siklus Audit Rekomendasi': item.recommendedFrequency,
      'Rekomendasi Bulan Berjalan': formatQuarterAsCurrentMonth(item.recommendedQuarter),
      'Estimasi Hari Kerja': item.estimatedDays,
      'Audit Terakhir': live.lastAuditYear || 'Belum Pernah',
      'Temuan 5C Terbuka': live.openFindingsCount,
      'Laporan WBS Aktif': live.openWbsCount,
      'Pagu RKA Unit (Rp)': live.linkedRkaBudget,
      'Status di PKPT': linkedPkpt
        ? `Terjadwal (${formatPkptExecutionSchedule(linkedPkpt)} · Skor ${linkedPkpt.priorityScore})`
        : 'Belum Masuk PKPT',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit_Universe');
    XLSX.writeFile(
      wb,
      `Audit_Universe_SPI_${selectedYear === 0 ? 'Semua_Tahun' : selectedYear}.xlsx`
    );
  };

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 max-w-md px-4 py-3 rounded-xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold animate-fade-in ${
            toast.type === 'success'
              ? 'bg-emerald-900 text-white border-emerald-700'
              : toast.type === 'error'
              ? 'bg-rose-900 text-white border-rose-700'
              : 'bg-slate-900 text-white border-slate-700'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => setToast(null)} className="text-white/70 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header & Action Toolbar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <Compass className="w-5 h-5 text-emerald-700" />
            Audit Universe (Peta Semesta Audit Berbasis Risiko)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Inventarisasi entitas audit, proses bisnis, RKA, sistem TI & kepatuhan sebagai fondasi PKPT Berbasis Risiko (GIAS 2024, PP 54/2017, Permendagri 23/2024 & BPKP)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowGuidelines((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
              showGuidelines
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-emerald-700" />
            <span>Pedoman & Metodologi</span>
            {showGuidelines ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors shadow-2xs"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-700" />
            <span>Cetak Audit Universe</span>
          </button>

          <button
            type="button"
            onClick={exportToExcel}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-emerald-700" />
            <span>Ekspor Excel</span>
          </button>

          {canEdit && (
            <>
              <button
                type="button"
                onClick={handleGenerateStandardCatalog}
                disabled={isSeedingCatalog}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors disabled:opacity-60"
                title="Buat otomatis 9 objek proses inti BUMD Air Minum + seluruh Unit Pelayanan Cabang"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>{isSeedingCatalog ? 'Menyusun...' : 'Generate Katalog Standar BUMD'}</span>
              </button>

              <button
                type="button"
                onClick={handleSyncRealtimeScores}
                disabled={isSyncingScores}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors disabled:opacity-60"
                title="Hitung ulang faktor risiko, materialitas RKA, & riwayat temuan/WBS terkini"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-amber-700 ${isSyncingScores ? 'animate-spin' : ''}`} />
                <span>{isSyncingScores ? 'Menyinkronkan...' : 'Sinkronkan Skor Real-Time'}</span>
              </button>

              <button
                type="button"
                onClick={openAddModal}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Objek Audit</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Collapsible Regulatory & Methodology Reference Panel */}
      {showGuidelines && (
        <div className="bg-gradient-to-br from-emerald-950 via-[#0d3824] to-slate-900 text-white p-5 rounded-2xl border border-emerald-800 shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-800/70 pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-amber-300 shrink-0" />
              <div>
                <h3 className="text-sm font-bold">
                  Landasan Regulasi & Metodologi Pembobotan Audit Universe
                </h3>
                <p className="text-[11px] text-emerald-200/80">
                  Disusun sesuai standar profesi audit intern (GIAS 2024), peraturan BUMD Air Minum, dan pedoman PKPT Berbasis Risiko BPKP
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 text-[10px] font-bold bg-emerald-800/80 border border-emerald-600/50 rounded-md text-amber-200 self-start">
              5-Factor Composite Risk Scoring (Skala 20–100)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {AUDIT_UNIVERSE_GUIDELINES.map((g) => (
              <div
                key={g.code}
                className="p-3.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-xs space-y-1.5"
              >
                <span className="inline-block px-2 py-0.5 text-[10px] font-bold bg-amber-400/20 text-amber-200 border border-amber-400/30 rounded-md">
                  {g.code}
                </span>
                <p className="text-xs font-bold text-white">{g.title}</p>
                <p className="text-[11px] text-emerald-100/90 leading-relaxed">{g.summary}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
            <div className="p-3.5 rounded-xl bg-black/25 border border-emerald-800/60 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Formula Skor Komposit (Skala Faktor 1–5)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-[11px]">
                <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                  <p className="font-bold text-amber-300">{Math.round(AUDIT_UNIVERSE_WEIGHTS.riskFactor * 100)}%</p>
                  <p className="text-emerald-100">Profil Risiko Residual</p>
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                  <p className="font-bold text-amber-300">{Math.round(AUDIT_UNIVERSE_WEIGHTS.materiality * 100)}%</p>
                  <p className="text-emerald-100">Materialitas / Pagu RKA</p>
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                  <p className="font-bold text-amber-300">{Math.round(AUDIT_UNIVERSE_WEIGHTS.controlHistory * 100)}%</p>
                  <p className="text-emerald-100">Jarak Audit & Temuan/WBS</p>
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                  <p className="font-bold text-amber-300">{Math.round(AUDIT_UNIVERSE_WEIGHTS.complianceImpact * 100)}%</p>
                  <p className="text-emerald-100">Dampak Regulasi & Publik</p>
                </div>
                <div className="p-2 rounded-lg bg-white/5 border border-white/10">
                  <p className="font-bold text-amber-300">{Math.round(AUDIT_UNIVERSE_WEIGHTS.complexity * 100)}%</p>
                  <p className="text-emerald-100">Kompleksitas Proses & TI</p>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-black/25 border border-emerald-800/60 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                Penentuan Siklus & Estimasi Hari Kerja (Pedoman BPKP)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="p-2 rounded-lg bg-rose-950/60 border border-rose-500/30">
                  <p className="font-bold text-rose-200">P1 (≥ 80)</p>
                  <p className="text-rose-100/90">Tahunan · ±14 HK</p>
                </div>
                <div className="p-2 rounded-lg bg-amber-950/60 border border-amber-500/30">
                  <p className="font-bold text-amber-200">P2 (60–79)</p>
                  <p className="text-amber-100/90">1–2 Tahun · ±12 HK</p>
                </div>
                <div className="p-2 rounded-lg bg-sky-950/60 border border-sky-500/30">
                  <p className="font-bold text-sky-200">P3 (40–59)</p>
                  <p className="text-sky-100/90">2–3 Tahun · ±10 HK</p>
                </div>
                <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-600/40">
                  <p className="font-bold text-slate-200">P4 (&lt; 40)</p>
                  <p className="text-slate-300">Pemantauan · ±7 HK</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <p className="text-[11px] font-semibold text-slate-500">Total Entitas Audit Universe</p>
          <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">{stats.total}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {selectedYear === 0 ? 'Lintas Tahun Anggaran' : `Tahun Anggaran ${selectedYear}`}
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-xs">
          <p className="text-[11px] font-semibold text-rose-700">Prioritas 1 (Wajib Tahunan)</p>
          <p className="text-2xl font-black text-rose-700 mt-1 tabular-nums">{stats.p1Count}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Ditambah {stats.p2Count} entitas Prioritas 2 (Tinggi)
          </p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-xs">
          <p className="text-[11px] font-semibold text-emerald-700">Cakupan Masuk PKPT</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-2xl font-black text-emerald-800 tabular-nums">{stats.scheduledCount}</p>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-200">
              {stats.coveragePct}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
            <div
              className="h-full bg-emerald-600 rounded-full transition-all"
              style={{ width: `${stats.coveragePct}%` }}
            />
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <p className="text-[11px] font-semibold text-slate-500">Kebutuhan vs Terjadwal Mandays</p>
          <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">
            {stats.scheduledPkptMandays}{' '}
            <span className="text-sm font-semibold text-slate-400">/ {stats.totalUniverseMandays} HK</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Estimasi hari kerja pemeriksaan</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-xs">
          <p className="text-[11px] font-semibold text-amber-800">Atensi Khusus (Temuan / Jarak Audit)</p>
          <p className="text-2xl font-black text-amber-700 mt-1 tabular-nums">{stats.highAlertCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Temuan 5C / WBS terbuka / &ge;2 thn</p>
        </div>
      </div>

      {/* Filter & Bulk Generation Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value, 10))}
            className="px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                Tahun {y}
              </option>
            ))}
            <option value={0}>Semua Tahun</option>
          </select>

          <div className="relative flex-1 min-w-[210px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Cari kode, objek, unit, regulasi..."
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Kategori ({AUDIT_UNIVERSE_CATEGORIES.length})</option>
            {AUDIT_UNIVERSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Peringkat Risiko</option>
            <option value="Sangat Tinggi (P1)">P1 - Sangat Tinggi (≥80)</option>
            <option value="Tinggi (P2)">P2 - Tinggi (60–79)</option>
            <option value="Sedang (P3)">P3 - Sedang (40–59)</option>
            <option value="Rendah (P4)">P4 - Rendah (&lt;40)</option>
          </select>

          <select
            value={coverageFilter}
            onChange={(e) => setCoverageFilter(e.target.value as any)}
            className="px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
          >
            <option value="ALL">Semua Status PKPT</option>
            <option value="UNSCHEDULED">Belum Masuk PKPT</option>
            <option value="SCHEDULED">Sudah Terjadwal di PKPT</option>
          </select>
        </div>

        {canEdit && batchTargetRows.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmBatchModalOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-800 hover:to-teal-800 rounded-lg shadow-xs transition-all shrink-0"
          >
            <CalendarCheck className="w-3.5 h-3.5 text-amber-300" />
            <span>
              {selectedIds.size > 0
                ? `Generate PKPT Terpilih (${batchTargetRows.length})`
                : `Generate PKPT Otomatis P1–P2 (${batchTargetRows.length})`}
            </span>
          </button>
        )}
      </div>

      {/* Audit Universe Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                {canEdit && (
                  <th className="py-3 px-3 w-10 text-center">
                    <input
                      type="checkbox"
                      onChange={toggleSelectAllVisibleUnscheduled}
                      checked={
                        filteredRows.some((r) => !r.linkedPkpt) &&
                        filteredRows
                          .filter((r) => !r.linkedPkpt)
                          .every((r) => selectedIds.has(r.item.id))
                      }
                      title="Pilih semua objek yang belum masuk PKPT"
                      className="rounded-xs border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                  </th>
                )}
                <th className="py-3 px-3 w-24">Kode</th>
                <th className="py-3 px-3 min-w-[240px]">Entitas Audit & Dasar Regulasi</th>
                <th className="py-3 px-3 min-w-[160px]">Pemilik Risiko / Unit</th>
                <th className="py-3 px-3 min-w-[170px]">Indikator Real-Time</th>
                <th className="py-3 px-3 text-center w-36">Skor Komposit & Tier</th>
                <th className="py-3 px-3 text-center w-36">Siklus & Estimasi</th>
                <th className="py-3 px-3 text-center w-36">Status PKPT</th>
                {canEdit && <th className="py-3 px-3 text-center w-44">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 9 : 7} className="py-10 text-center text-slate-500">
                    <div className="max-w-md mx-auto space-y-2">
                      <Layers className="w-8 h-8 text-slate-300 mx-auto" />
                      <p className="font-semibold text-slate-700">
                        {universeItems.length === 0
                          ? `Belum ada peta Audit Universe untuk Tahun ${effectiveYear}.`
                          : 'Tidak ada objek audit yang cocok dengan filter pencarian.'}
                      </p>
                      {canEdit && universeItems.length === 0 && (
                        <p className="text-[11px] text-slate-500">
                          Klik <strong>&ldquo;Generate Katalog Standar BUMD&rdquo;</strong> di kanan atas untuk membuat otomatis 9 proses bisnis inti BUMD Air Minum &amp; seluruh Unit Pelayanan sesuai GIAS 2024 dan Permendagri 23/2024.
                        </p>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map(({ item, live, linkedPkpt }) => {
                  const tierClass =
                    TIER_BADGE_CLASSES[item.riskTier] || 'bg-slate-100 text-slate-700 border-slate-300';
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        item.isActive === false ? 'opacity-60' : ''
                      }`}
                    >
                      {canEdit && (
                        <td className="py-3 px-3 text-center align-top">
                          <input
                            type="checkbox"
                            disabled={Boolean(linkedPkpt)}
                            checked={selectedIds.has(item.id)}
                            onChange={() => toggleRowSelection(item.id)}
                            title={
                              linkedPkpt
                                ? 'Sudah terjadwal dalam PKPT'
                                : 'Centang untuk generate ke PKPT'
                            }
                            className="rounded-xs border-slate-300 text-emerald-700 focus:ring-emerald-600 disabled:opacity-40"
                          />
                        </td>
                      )}

                      <td className="py-3 px-3 align-top">
                        <span className="inline-block px-2 py-0.5 text-[11px] font-mono font-bold bg-slate-100 text-slate-800 border border-slate-300 rounded-md">
                          {item.code}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-1 font-semibold">TA {item.year}</p>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xs">
                            {item.category}
                          </span>
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600 rounded-xs">
                            {item.defaultAuditType}
                          </span>
                        </div>
                        <p className="font-bold text-slate-900 mt-1 leading-snug">{item.entityName}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{item.businessProcess}</p>
                        <p className="text-[10px] text-emerald-800/90 mt-1 font-medium">
                          Dasar: {item.regulatoryBasis}
                        </p>
                      </td>

                      <td className="py-3 px-3 align-top">
                        <p className="font-semibold text-slate-800">{item.unitName}</p>
                        {live.linkedRkaBudget > 0 && (
                          <p className="text-[10px] text-slate-600 mt-1 flex items-center gap-1 font-mono">
                            <Wallet className="w-3 h-3 text-emerald-700 shrink-0" />
                            <span>Rp {live.linkedRkaBudget.toLocaleString('id-ID')}</span>
                          </p>
                        )}
                      </td>

                      <td className="py-3 px-3 align-top text-[11px] space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Max Risiko:</span>
                          <span className="font-mono font-bold text-slate-800">
                            {live.maxResidualRisk25}/25
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Audit Terakhir:</span>
                          <span className="font-semibold text-slate-800 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {live.lastAuditYear || 'Belum'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Temuan / WBS:</span>
                          <span
                            className={`font-bold ${
                              live.openFindingsCount + live.openWbsCount > 0
                                ? 'text-rose-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {live.openFindingsCount} 5C · {live.openWbsCount} WBS
                          </span>
                        </div>
                      </td>

                      <td className="py-3 px-3 text-center align-top">
                        <div className="text-base font-black font-mono text-slate-900">
                          {item.compositeScore}
                          <span className="text-[10px] font-normal text-slate-400">/100</span>
                        </div>
                        <span
                          className={`inline-block mt-1 px-2 py-0.5 text-[10px] font-bold border rounded-md ${tierClass}`}
                        >
                          {item.riskTier}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-center align-top">
                        <p className="font-semibold text-slate-800">{item.recommendedFrequency}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          <span className="font-bold text-emerald-800">{formatQuarterAsCurrentMonth(item.recommendedQuarter)}</span> ·{' '}
                          {item.estimatedDays} HK
                        </p>
                      </td>

                      <td className="py-3 px-3 text-center align-top">
                        {linkedPkpt ? (
                          <div className="inline-flex flex-col items-center px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900">
                            <span className="flex items-center gap-1 text-[10px] font-bold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                              Terjadwal PKPT
                            </span>
                            <span className="text-[10px] font-mono text-emerald-700 mt-0.5">
                              {formatPkptExecutionSchedule(linkedPkpt)} · Skor {linkedPkpt.priorityScore}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-block px-2 py-1 text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 rounded-md">
                            Belum Masuk PKPT
                          </span>
                        )}
                      </td>

                      {canEdit && (
                        <td className="py-3 px-3 text-center align-top">
                          <div className="flex items-center justify-center gap-1 flex-wrap">
                            {onNavigateToPkptWithUniverse && (
                              <button
                                type="button"
                                onClick={() => onNavigateToPkptWithUniverse(item)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-md transition-colors"
                                title="Buka penyusunan PKPT dengan praisi otomatis dari objek Audit Universe ini"
                              >
                                <ArrowRight className="w-3 h-3" />
                                <span>Susun PKPT</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openEditModal(item)}
                              className="p-1.5 text-slate-500 hover:text-emerald-700 rounded-md hover:bg-slate-100 transition-colors"
                              title="Ubah Entitas Audit Universe"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(item)}
                              className="p-1.5 text-slate-500 hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
                              title="Hapus Entitas Audit Universe"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isModalOpen && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl max-h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold">
                  {editingItem ? 'Ubah Objek Audit Universe' : 'Tambah Entitas Baru ke Audit Universe'}
                </h3>
                <p className="text-[11px] text-emerald-200/80">
                  Penilaian 5 faktor risiko komposit sesuai GIAS 2024 Std 9.4 &amp; Pedoman PKPT BPKP
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-emerald-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode Objek</label>
                  <input
                    type="text"
                    required
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value)}
                    placeholder="AU-KEU-01"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tahun Anggaran</label>
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
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Kategori Audit Universe</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as AuditUniverseCategory)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    {AUDIT_UNIVERSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nama Entitas / Objek yang Dapat Diaudit (Auditable Entity)</label>
                <input
                  type="text"
                  required
                  value={formEntityName}
                  onChange={(e) => setFormEntityName(e.target.value)}
                  placeholder="Contoh: Pengendalian Tingkat Kehilangan Air (NRW) & Kalibrasi Meter Induk"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700">Pemilik Risiko / Unit Kerja Terkait</label>
                    <button
                      type="button"
                      onClick={handleApplyLiveUnitMetricsToForm}
                      className="text-[10px] font-bold text-emerald-700 hover:underline flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Tarik Skor Live Unit</span>
                    </button>
                  </div>
                  <select
                    value={formUnitId}
                    onChange={(e) => setFormUnitId(e.target.value)}
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
                  <label className="block font-semibold text-slate-700 mb-1">Jenis Audit Default</label>
                  <select
                    value={formDefaultAuditType}
                    onChange={(e) => setFormDefaultAuditType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    {AUDIT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Proses Bisnis Utama</label>
                  <input
                    type="text"
                    required
                    value={formBusinessProcess}
                    onChange={(e) => setFormBusinessProcess(e.target.value)}
                    placeholder="Baca Meter, Billing, Penagihan..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Dasar Regulasi / Pedoman</label>
                  <input
                    type="text"
                    required
                    value={formRegulatoryBasis}
                    onChange={(e) => setFormRegulatoryBasis(e.target.value)}
                    placeholder="GIAS 2024 Std 9.4; PP 54/2017; Permendagri 23/2024"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* 5-Factor Scoring Panel */}
              <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 pb-2">
                  <span className="font-bold text-emerald-950">
                    Penilaian 5 Faktor Risiko Audit Universe (Skala 1–5)
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-emerald-900">
                      Skor Komposit:{' '}
                      <strong className="font-mono text-sm text-emerald-950">
                        {liveFormDerived.compositeScore}/100
                      </strong>
                    </span>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold border rounded-md ${
                        TIER_BADGE_CLASSES[liveFormDerived.riskTier] || 'bg-white'
                      }`}
                    >
                      {liveFormDerived.riskTier}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-white text-slate-800 border border-emerald-200 rounded-md">
                      {liveFormDerived.recommendedFrequency}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      1. Profil Risiko Residual (30%)
                    </label>
                    <select
                      value={formRiskFactorScore}
                      onChange={(e) => setFormRiskFactorScore(parseInt(e.target.value, 10))}
                      className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {SCORE_LABELS[n]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      2. Materialitas / Pagu RKA (25%)
                    </label>
                    <select
                      value={formMaterialityScore}
                      onChange={(e) => setFormMaterialityScore(parseInt(e.target.value, 10))}
                      className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {SCORE_LABELS[n]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      3. Jarak Audit &amp; Temuan/WBS (20%)
                    </label>
                    <select
                      value={formControlHistoryScore}
                      onChange={(e) => setFormControlHistoryScore(parseInt(e.target.value, 10))}
                      className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {SCORE_LABELS[n]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      4. Dampak Regulasi &amp; Layanan (15%)
                    </label>
                    <select
                      value={formComplianceImpactScore}
                      onChange={(e) => setFormComplianceImpactScore(parseInt(e.target.value, 10))}
                      className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {SCORE_LABELS[n]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      5. Kompleksitas Proses &amp; TI (10%)
                    </label>
                    <select
                      value={formComplexityScore}
                      onChange={(e) => setFormComplexityScore(parseInt(e.target.value, 10))}
                      className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {SCORE_LABELS[n]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Tahun Audit Terakhir (Opsional)
                    </label>
                    <input
                      type="number"
                      min={2015}
                      max={2099}
                      value={formLastAuditYear}
                      onChange={(e) => setFormLastAuditYear(e.target.value)}
                      placeholder="Misal: 2024"
                      className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Rekomendasi Bulan Berjalan</label>
                  <select
                    value={formRecommendedQuarter}
                    onChange={(e) => setFormRecommendedQuarter(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Q1">Bulan Berjalan · Tahap 1 (Jan–Mar)</option>
                    <option value="Q2">Bulan Berjalan · Tahap 2 (Apr–Jun)</option>
                    <option value="Q3">Bulan Berjalan · Tahap 3 (Jul–Sep)</option>
                    <option value="Q4">Bulan Berjalan · Tahap 4 (Okt–Des)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Estimasi Hari Kerja</label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={formEstimatedDays}
                    onChange={(e) => setFormEstimatedDays(parseInt(e.target.value, 10) || 10)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={formIsActive}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="rounded-xs border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span>Entitas Aktif dalam Populasi Audit</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Template Tujuan Pemeriksaan (untuk PKPT)</label>
                <textarea
                  rows={2}
                  value={formObjectiveTemplate}
                  onChange={(e) => setFormObjectiveTemplate(e.target.value)}
                  placeholder="Otomatis terisi ke PKPT saat objek ini dipilih..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Template Ruang Lingkup Pemeriksaan (untuk PKPT)</label>
                <textarea
                  rows={2}
                  value={formScopeTemplate}
                  onChange={(e) => setFormScopeTemplate(e.target.value)}
                  placeholder="Dokumen, periode, & unit yang diuji..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Catatan Kepala SPI / Pertimbangan Tambahan</label>
                <input
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Catatan perubahan sistem, mandat Dewan Pengawas, dll."
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
                  Simpan ke Audit Universe
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Batch PKPT Generation Confirmation Modal */}
      {confirmBatchModalOpen && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-amber-300" />
                Konfirmasi Generate PKPT Berbasis Risiko
              </h3>
              <button
                type="button"
                onClick={() => setConfirmBatchModalOpen(false)}
                className="text-emerald-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-slate-700">
              <p>
                Sistem akan menurunkan{' '}
                <strong className="text-emerald-800">{batchTargetRows.length} objek Audit Universe</strong>{' '}
                yang belum terjadwal menjadi rencana kerja <strong>PKPT Berbasis Risiko</strong> (status pengesahan{' '}
                <em>Disetujui Kepala SPI</em>):
              </p>
              <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                {batchTargetRows.map(({ item }) => (
                  <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">
                        [{item.code}] {item.entityName}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {item.unitName} · {formatQuarterAsCurrentMonth(item.recommendedQuarter)} · {item.estimatedDays} HK
                      </p>
                    </div>
                    <span className="font-mono font-bold text-emerald-800 shrink-0">
                      Skor {item.compositeScore}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setConfirmBatchModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={isGeneratingPkpt}
                  onClick={handleBatchGeneratePkpt}
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg shadow-sm disabled:opacity-60"
                >
                  {isGeneratingPkpt ? 'Menyusun PKPT...' : `Ya, Generate ${batchTargetRows.length} PKPT`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteTarget && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 bg-rose-900 text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-300" />
                Hapus Entitas Audit Universe
              </h3>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="text-rose-200 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs text-slate-700">
              <p>
                Anda yakin ingin menghapus objek audit{' '}
                <strong>
                  [{deleteTarget.code}] {deleteTarget.entityName}
                </strong>{' '}
                dari peta Audit Universe?
              </p>
              <p className="text-[11px] text-slate-500">
                Data PKPT yang sudah pernah dibuat tidak ikut terhapus.
              </p>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="px-4 py-2 font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-lg"
                >
                  Hapus Permanen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Official Print Preview Modal */}
      {isPrintModalOpen && (
        <DocumentPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          documentTitle="PETA SEMESTA AUDIT (AUDIT UNIVERSE) BERBASIS RISIKO"
          documentSubtitle={`Tahun Anggaran ${selectedYear === 0 ? 'Multi Tahun' : selectedYear} · ${
            branding.institutionName || 'Perumda Air Minum Tirta Saiyo'
          }`}
          documentNumber={`AU/SPI-PTS/${selectedYear === 0 ? activeYear : selectedYear}`}
          initialSignatory1Role="Kepala Satuan Pengawasan Intern"
          initialSignatory2Role="Direktur Perumda Air Minum Tirta Saiyo"
          defaultShowSignatory2={true}
        >
          {() => (
            <div className="space-y-4 text-xs font-serif leading-relaxed">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 grid grid-cols-4 gap-3 font-sans text-xs">
                <div>
                  <p className="text-slate-500">Total Objek Audit:</p>
                  <p className="font-bold text-slate-900">{filteredRows.length} Entitas</p>
                </div>
                <div>
                  <p className="text-slate-500">Prioritas 1 (Tahunan):</p>
                  <p className="font-bold text-rose-700">{stats.p1Count} Objek</p>
                </div>
                <div>
                  <p className="text-slate-500">Cakupan Masuk PKPT:</p>
                  <p className="font-bold text-emerald-800">
                    {stats.scheduledCount} Objek ({stats.coveragePct}%)
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Estimasi Kebutuhan HK:</p>
                  <p className="font-bold text-slate-800">{stats.totalUniverseMandays} Hari Kerja</p>
                </div>
              </div>

              <div className="p-2.5 bg-emerald-50/70 border border-emerald-200 rounded-lg font-sans text-[10px] text-emerald-950">
                <strong>Pedoman Penyusunan:</strong> Global Internal Audit Standards (GIAS 2024 Std 9.4), PP No. 54/2017 tentang BUMD, Permendagri No. 23/2024 tentang BUMD Air Minum, serta Pedoman PKPT Berbasis Risiko BPKP &amp; PP 60/2008 SPIP (Bobot 5 Faktor: Risiko 30%, Materialitas RKA 25%, Riwayat Kontrol &amp; Temuan 20%, Kepatuhan Layanan 15%, Kompleksitas 10%).
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-[10px] border-collapse border border-slate-300 font-sans">
                  <thead>
                    <tr className="bg-slate-100 font-bold text-slate-800">
                      <th className="p-1.5 border border-slate-300 text-center w-7">No</th>
                      <th className="p-1.5 border border-slate-300 w-20">Kode</th>
                      <th className="p-1.5 border border-slate-300">Entitas Audit &amp; Dasar Regulasi</th>
                      <th className="p-1.5 border border-slate-300 w-28">Unit Kerja</th>
                      <th className="p-1.5 border border-slate-300 text-center w-14">Skor</th>
                      <th className="p-1.5 border border-slate-300 text-center w-24">Tier &amp; Siklus</th>
                      <th className="p-1.5 border border-slate-300 text-center w-16">Jadwal</th>
                      <th className="p-1.5 border border-slate-300 text-center w-24">Status PKPT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(({ item, linkedPkpt }, idx) => (
                      <tr key={item.id}>
                        <td className="p-1.5 border border-slate-300 text-center font-bold">{idx + 1}</td>
                        <td className="p-1.5 border border-slate-300 font-mono font-bold">{item.code}</td>
                        <td className="p-1.5 border border-slate-300">
                          <p className="font-bold text-slate-900">{item.entityName}</p>
                          <p className="text-[9px] text-slate-600">{item.businessProcess}</p>
                          <p className="text-[9px] text-emerald-800">Dasar: {item.regulatoryBasis}</p>
                        </td>
                        <td className="p-1.5 border border-slate-300">{item.unitName}</td>
                        <td className="p-1.5 border border-slate-300 text-center font-mono font-bold">
                          {item.compositeScore}
                        </td>
                        <td className="p-1.5 border border-slate-300 text-center">
                          <p className="font-bold">{item.riskTier}</p>
                          <p className="text-[9px] text-slate-600">{item.recommendedFrequency}</p>
                        </td>
                        <td className="p-1.5 border border-slate-300 text-center">
                          {formatQuarterAsCurrentMonth(item.recommendedQuarter)} ({item.estimatedDays} HK)
                        </td>
                        <td className="p-1.5 border border-slate-300 text-center">
                          {linkedPkpt ? `Terjadwal (${formatPkptExecutionSchedule(linkedPkpt)})` : 'Belum'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
