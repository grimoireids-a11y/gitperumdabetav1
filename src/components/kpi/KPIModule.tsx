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
  Target,
  GitBranch,
  BookOpen,
  ClipboardCheck,
  AlertTriangle,
  Sparkles,
  Plus,
  Edit2,
  Trash2,
  Printer,
  Search,
  CheckCircle2,
  ShieldCheck,
  TrendingUp,
  Sliders,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  FileText,
  Download,
  Award,
  Layers,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../../lib/firebase';
import {
  KPIItem,
  KPIMeasurement,
  KPIChecklistItem,
  KPISettings,
  KPIPerspective,
  KPIPolarity,
  KPIAccumulationType,
  KPILevel,
  KPICascadeMethod,
  KPIFrequency,
  KPIApprovalStatus,
  KPISPIVerificationStatus,
  KPIActionStatus,
  Unit,
  RKAItem,
  RiskRegister,
} from '../../types/audit';
import { INITIAL_UNITS } from '../../data/initialData';
import {
  KPI_PERSPECTIVE_META,
  KPI_PEDOMAN_REFINEMENTS,
  DEFAULT_KPI_CHECKLIST_ITEMS,
  createDefaultKPISettings,
  buildStandardKPIPack,
} from '../../data/kpiStandards';
import {
  calculateKPIAchievement,
  evaluateOverallPredicate,
  getFrequencyLabel,
  getLevelLabel,
  getPeriodLabel,
  getPolarityLabel,
  KPICalculationResult,
  resolveKpiPeriodMeasurement,
  roundNumber,
} from '../../lib/kpiAnalytics';
import { useAuth } from '../../context/AuthContext';
import { useFiscalYear } from '../../context/FiscalYearContext';
import { DocumentPrintPreviewModal } from '../common/DocumentPrintPreviewModal';

type KPISubTab =
  | 'dashboard'
  | 'dictionary'
  | 'cascading'
  | 'measurement'
  | 'evaluation'
  | 'pedoman';

export const KPIModule: React.FC = () => {
  const { userProfile } = useAuth();
  const { activeYear, availableYears, addCustomYear } = useFiscalYear();

  const [activeSubTab, setActiveSubTab] = useState<KPISubTab>('dashboard');
  const [selectedYear, setSelectedYear] = useState<number>(activeYear);

  useEffect(() => {
    setSelectedYear(activeYear);
  }, [activeYear]);

  // Firestore data
  const [kpiItems, setKpiItems] = useState<KPIItem[]>([]);
  const [measurements, setMeasurements] = useState<KPIMeasurement[]>([]);
  const [checklistItems, setChecklistItems] = useState<KPIChecklistItem[]>([]);
  const [settingsList, setSettingsList] = useState<KPISettings[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [rkaItems, setRkaItems] = useState<RKAItem[]>([]);
  const [risks, setRisks] = useState<RiskRegister[]>([]);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPerspective, setFilterPerspective] = useState<string>('ALL');
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [filterUnit, setFilterUnit] = useState<string>('ALL');

  // Period controls for Dashboard & Measurement
  const [periodType, setPeriodType] = useState<'Bulanan' | 'Triwulanan' | 'Tahunan'>('Bulanan');
  const [periodIndex, setPeriodIndex] = useState<number>(() => new Date().getMonth() + 1);
  const [contractLevelFilter, setContractLevelFilter] = useState<number>(1);
  const [expandedNodes, setExpandedNodes] = useState<Record<string, boolean>>({});
  const [expandedDictId, setExpandedDictId] = useState<string | null>(null);

  // Modals
  const [isKpiModalOpen, setIsKpiModalOpen] = useState(false);
  const [editingKpi, setEditingKpi] = useState<KPIItem | null>(null);
  const [isMeasureModalOpen, setIsMeasureModalOpen] = useState(false);
  const [targetKpiForMeasure, setTargetKpiForMeasure] = useState<KPIItem | null>(null);
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [targetMeasureForAction, setTargetMeasureForAction] = useState<{
    kpi: KPIItem;
    measurement?: KPIMeasurement;
  } | null>(null);
  const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
  const [targetMeasureForVerify, setTargetMeasureForVerify] = useState<{
    kpi: KPIItem;
    measurement: KPIMeasurement;
  } | null>(null);

  // Print modals
  const [printMode, setPrintMode] = useState<'REPORT' | 'CONTRACT' | 'PEDOMAN' | null>(null);

  // Busy flags
  const [isSeeding, setIsSeeding] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Form states for KPI Item
  const [fCode, setFCode] = useState('');
  const [fPerspective, setFPerspective] = useState<KPIPerspective>('Operasional');
  const [fObjective, setFObjective] = useState('');
  const [fName, setFName] = useState('');
  const [fIndicatorType, setFIndicatorType] = useState<'Lagging (Hasil)' | 'Leading (Penggerak)'>('Lagging (Hasil)');
  const [fLevel, setFLevel] = useState<KPILevel>(1);
  const [fParentId, setFParentId] = useState('');
  const [fCascadeMethod, setFCascadeMethod] = useState<KPICascadeMethod>('Direct (Identik)');
  const [fUnitName, setFUnitName] = useState('');
  const [fOwnerRole, setFOwnerRole] = useState('');
  const [fPicName, setFPicName] = useState('');
  const [fDefinition, setFDefinition] = useState('');
  const [fFormula, setFFormula] = useState('');
  const [fUnitMeasure, setFUnitMeasure] = useState('%');
  const [fPolarity, setFPolarity] = useState<KPIPolarity>('MAXIMIZE');
  const [fAccumulation, setFAccumulation] = useState<KPIAccumulationType>('AVERAGE');
  const [fBaseline, setFBaseline] = useState<number>(0);
  const [fTarget, setFTarget] = useState<number>(100);
  const [fRangeMin, setFRangeMin] = useState<number>(6.5);
  const [fRangeMax, setFRangeMax] = useState<number>(8.5);
  const [fZeroPenalty, setFZeroPenalty] = useState<number>(20);
  const [fWeight, setFWeight] = useState<number>(10);
  const [fCapMax, setFCapMax] = useState<number>(120);
  const [fFloorMin, setFFloorMin] = useState<number>(0);
  const [fIsGating, setFIsGating] = useState<boolean>(false);
  const [fGatingThreshold, setFGatingThreshold] = useState<number>(95);
  const [fDataSource, setFDataSource] = useState('');
  const [fFrequency, setFFrequency] = useState<KPIFrequency>('Bulanan');
  const [fEvidenceRequired, setFEvidenceRequired] = useState('');
  const [fTargetBasisNote, setFTargetBasisNote] = useState('');
  const [fLinkedRka, setFLinkedRka] = useState('');
  const [fLinkedRisk, setFLinkedRisk] = useState('');
  const [fApprovalStatus, setFApprovalStatus] = useState<KPIApprovalStatus>('Draft');
  const [fChangeReason, setFChangeReason] = useState('');

  // Form states for Measurement
  const [mRealization, setMRealization] = useState<number>(0);
  const [mEvidenceNote, setMEvidenceNote] = useState('');
  const [mEvidenceUrl, setMEvidenceUrl] = useState('');

  // Form states for Evaluation / Action Plan
  const [aRootCause, setARootCause] = useState('');
  const [aActionPlan, setAActionPlan] = useState('');
  const [aActionPic, setAActionPic] = useState('');
  const [aDeadline, setADeadline] = useState('');
  const [aBudget, setABudget] = useState<number>(0);
  const [aOutcome, setAOutcome] = useState('');
  const [aStatus, setAStatus] = useState<KPIActionStatus>('Dalam Proses');

  // Form states for SPI Verification
  const [vStatus, setVStatus] = useState<KPISPIVerificationStatus>('Terverifikasi SPI');
  const [vNote, setVNote] = useState('');

  // Policy settings form
  const [policyForm, setPolicyForm] = useState<KPISettings>(() =>
    createDefaultKPISettings(activeYear)
  );

  // Roles
  const role = userProfile?.role;
  const isFullAccess = role === 'KEPALA_SPI' || role === 'ADMIN_SISTEM';
  const isSpiAuditor = role === 'AUDITOR';
  const isExec = role === 'DIREKTUR' || role === 'DEWAN_PENGAWAS';
  const isAuditee = role === 'AUDITEE';
  const isViewer = role === 'VIEWER';

  const canManageStructure = isFullAccess;
  const canSubmitMeasurement = isFullAccess || isSpiAuditor || isAuditee || isExec;
  const canVerifySpi = isFullAccess || isSpiAuditor;

  useEffect(() => {
    const unsubKpi = onSnapshot(collection(db, 'kpi_items'), (snap) => {
      setKpiItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KPIItem)));
    });
    const unsubMeas = onSnapshot(collection(db, 'kpi_measurements'), (snap) => {
      setMeasurements(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KPIMeasurement)));
    });
    const unsubChk = onSnapshot(collection(db, 'kpi_checklist'), (snap) => {
      setChecklistItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KPIChecklistItem)));
    });
    const unsubSet = onSnapshot(collection(db, 'kpi_settings'), (snap) => {
      setSettingsList(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KPISettings)));
    });
    const unsubUnits = onSnapshot(collection(db, 'units'), (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Unit));
      if (docs.length > 0) setUnits(docs);
      else setUnits(INITIAL_UNITS.map((u, i) => ({ id: `init-unit-${i + 1}`, ...u })));
    });
    const unsubRka = onSnapshot(collection(db, 'rka_items'), (snap) => {
      setRkaItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RKAItem)));
    });
    const unsubRisks = onSnapshot(collection(db, 'risk_registers'), (snap) => {
      setRisks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskRegister)));
    });

    return () => {
      unsubKpi();
      unsubMeas();
      unsubChk();
      unsubSet();
      unsubUnits();
      unsubRka();
      unsubRisks();
    };
  }, []);

  const currentSettings = useMemo(() => {
    const found = settingsList.find((s) => s.year === selectedYear);
    return found || createDefaultKPISettings(selectedYear, userProfile?.displayName || 'Kepala SPI');
  }, [settingsList, selectedYear, userProfile?.displayName]);

  useEffect(() => {
    setPolicyForm(currentSettings);
  }, [currentSettings]);

  const yearOptions = useMemo(() => {
    const kpiYears = kpiItems.map((k) => k.year).filter((y) => y > 0);
    return Array.from(new Set([...availableYears, ...kpiYears])).sort((a, b) => b - a);
  }, [availableYears, kpiItems]);

  const yearKpis = useMemo(
    () =>
      kpiItems
        .filter((k) => k.year === selectedYear)
        .sort((a, b) => a.level - b.level || a.code.localeCompare(b.code)),
    [kpiItems, selectedYear]
  );

  // Scoped KPIs for Auditee (shows Corporate Level 1 for reference + unit-matched KPIs)
  const visibleKpis = useMemo(() => {
    if (isAuditee && userProfile?.unitName) {
      const uLower = userProfile.unitName.toLowerCase();
      return yearKpis.filter(
        (k) =>
          k.level === 1 ||
          k.unitName.toLowerCase().includes(uLower) ||
          k.picName.toLowerCase().includes(uLower) ||
          k.ownerRole.toLowerCase().includes(uLower)
      );
    }
    return yearKpis;
  }, [yearKpis, isAuditee, userProfile?.unitName]);

  const filteredKpis = useMemo(() => {
    return visibleKpis.filter((k) => {
      const q = searchTerm.toLowerCase();
      const matchesSearch =
        !q ||
        k.code.toLowerCase().includes(q) ||
        k.name.toLowerCase().includes(q) ||
        k.strategicObjective.toLowerCase().includes(q) ||
        k.unitName.toLowerCase().includes(q) ||
        k.ownerRole.toLowerCase().includes(q) ||
        k.picName.toLowerCase().includes(q);
      const matchesPersp = filterPerspective === 'ALL' || k.perspective === filterPerspective;
      const matchesLvl = filterLevel === 'ALL' || k.level === Number(filterLevel);
      const matchesUnit = filterUnit === 'ALL' || k.unitName === filterUnit;
      return matchesSearch && matchesPersp && matchesLvl && matchesUnit;
    });
  }, [visibleKpis, searchTerm, filterPerspective, filterLevel, filterUnit]);

  const distinctUnits = useMemo(() => {
    const set = new Set<string>();
    yearKpis.forEach((k) => {
      if (k.unitName) set.add(k.unitName);
    });
    return Array.from(set).sort();
  }, [yearKpis]);

  // Period measurements map for selected periodType & periodIndex
  const resolvedPeriodMap = useMemo(() => {
    const map = new Map<
      string,
      {
        exact?: KPIMeasurement;
        ytdValue?: number;
        calc?: KPICalculationResult;
        periodsReported: number;
      }
    >();
    yearKpis.forEach((kpi) => {
      const res = resolveKpiPeriodMeasurement(
        kpi,
        measurements,
        periodType,
        periodIndex,
        currentSettings
      );
      map.set(kpi.id, {
        exact: res.exactMeasurement,
        ytdValue: res.ytdRealizationValue,
        calc: res.ytdCalc,
        periodsReported: res.periodsReported,
      });
    });
    return map;
  }, [yearKpis, measurements, periodType, periodIndex, currentSettings]);

  // Corporate Level 1 Analytics
  const level1Kpis = useMemo(() => yearKpis.filter((k) => k.level === 1), [yearKpis]);

  const corporateScoreSummary = useMemo(() => {
    const totalConfiguredWeight = level1Kpis.reduce((s, k) => s + (k.weight || 0), 0);
    const achMap = new Map<string, KPICalculationResult>();
    let totalWeightedScore = 0;
    let measuredCount = 0;
    let verifiedCount = 0;
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;

    level1Kpis.forEach((k) => {
      const res = resolvedPeriodMap.get(k.id);
      if (res?.calc) {
        measuredCount += 1;
        achMap.set(k.id, res.calc);
        totalWeightedScore += res.calc.weightedScore;
        if (res.calc.trafficLight === 'HIJAU') greenCount += 1;
        else if (res.calc.trafficLight === 'KUNING') yellowCount += 1;
        else redCount += 1;
      }
      if (res?.exact?.spiVerificationStatus === 'Terverifikasi SPI') {
        verifiedCount += 1;
      }
    });

    const { effectiveScore, predicate } = evaluateOverallPredicate(
      totalWeightedScore,
      level1Kpis,
      achMap,
      currentSettings
    );

    const perspectiveSummaries = KPI_PERSPECTIVE_META.map((meta) => {
      const pKpis = level1Kpis.filter((k) => k.perspective === meta.key);
      const pWeight = pKpis.reduce((s, k) => s + (k.weight || 0), 0);
      let pMeasured = 0;
      let pWeightedSum = 0;
      let pAchSum = 0;
      pKpis.forEach((k) => {
        const c = achMap.get(k.id);
        if (c) {
          pMeasured += 1;
          pWeightedSum += c.weightedScore;
          pAchSum += c.cappedAchievementPct;
        }
      });
      const targetW =
        meta.key === 'Keuangan'
          ? currentSettings.perspectiveWeights.keuangan
          : meta.key === 'Pelanggan dan Pelayanan'
          ? currentSettings.perspectiveWeights.pelanggan
          : meta.key === 'Operasional'
          ? currentSettings.perspectiveWeights.operasional
          : meta.key === 'Proses Bisnis Internal'
          ? currentSettings.perspectiveWeights.prosesBisnis
          : currentSettings.perspectiveWeights.pembelajaran;

      return {
        perspective: meta.key,
        targetWeight: targetW,
        configuredWeight: roundNumber(pWeight, 2),
        kpiCount: pKpis.length,
        measuredCount: pMeasured,
        avgAchievementPct: pMeasured > 0 ? roundNumber(pAchSum / pMeasured, 2) : 0,
        weightedScore: roundNumber(pWeightedSum, 2),
        meta,
      };
    });

    return {
      totalConfiguredWeight: roundNumber(totalConfiguredWeight, 2),
      rawTotalWeightedScore: roundNumber(totalWeightedScore, 2),
      effectiveScore,
      predicate,
      measuredCount,
      verifiedCount,
      greenCount,
      yellowCount,
      redCount,
      perspectiveSummaries,
    };
  }, [level1Kpis, resolvedPeriodMap, currentSettings]);

  // Checklist for active year
  const yearChecklist = useMemo(() => {
    const existing = checklistItems
      .filter((c) => c.year === selectedYear)
      .sort((a, b) => a.itemNumber - b.itemNumber);
    if (existing.length > 0) return existing;
    return DEFAULT_KPI_CHECKLIST_ITEMS.map((d) => ({
      id: `chk-${selectedYear}-${d.itemNumber}`,
      year: selectedYear,
      itemNumber: d.itemNumber,
      componentName: d.componentName,
      pedomanRef: d.pedomanRef,
      requiredArtifact: d.requiredArtifact,
      status: d.status,
      evidenceLocation: '',
      notes: '',
      updatedBy: 'Sistem',
      updatedAt: '',
    }));
  }, [checklistItems, selectedYear]);

  const checklistReadinessPct = useMemo(() => {
    if (yearChecklist.length === 0) return 0;
    const score = yearChecklist.reduce((acc, item) => {
      if (item.status === 'Ada') return acc + 1;
      if (item.status === 'Sebagian') return acc + 0.5;
      return acc;
    }, 0);
    return Math.round((score / yearChecklist.length) * 100);
  }, [yearChecklist]);

  // Underperforming / Gap evaluations
  const gapEvaluationRows = useMemo(() => {
    const threshold = currentSettings.greenThresholdPct ?? 95;
    return visibleKpis
      .map((kpi) => {
        const res = resolvedPeriodMap.get(kpi.id);
        const exact = res?.exact;
        const calc = res?.calc;
        const needsAction =
          (calc && calc.cappedAchievementPct < threshold) ||
          Boolean(exact?.actionPlan && exact.actionPlan.trim().length > 0);
        return {
          kpi,
          measurement: exact,
          ytdValue: res?.ytdValue,
          calc,
          needsAction,
        };
      })
      .filter((row) => row.needsAction);
  }, [visibleKpis, resolvedPeriodMap, currentSettings.greenThresholdPct]);

  // Handlers
  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 4500);
  };

  const handleLoadStandardPack = async () => {
    if (!canManageStructure) return;
    setIsSeeding(true);
    try {
      const batch = writeBatch(db);
      const pack = buildStandardKPIPack(
        selectedYear,
        userProfile?.displayName || 'Kepala SPI'
      );
      const existingIds = new Set(kpiItems.map((k) => k.id));
      let addedCount = 0;

      pack.forEach((item) => {
        if (!existingIds.has(item.id)) {
          batch.set(doc(db, 'kpi_items', item.id), item);
          addedCount += 1;
        }
      });

      const settingsDocId = `kpi-settings-${selectedYear}`;
      if (!settingsList.some((s) => s.id === settingsDocId)) {
        batch.set(
          doc(db, 'kpi_settings', settingsDocId),
          createDefaultKPISettings(selectedYear, userProfile?.displayName || 'Kepala SPI')
        );
      }

      if (checklistItems.filter((c) => c.year === selectedYear).length === 0) {
        DEFAULT_KPI_CHECKLIST_ITEMS.forEach((d) => {
          const cid = `chk-${selectedYear}-${d.itemNumber}`;
          batch.set(doc(db, 'kpi_checklist', cid), {
            id: cid,
            year: selectedYear,
            itemNumber: d.itemNumber,
            componentName: d.componentName,
            pedomanRef: d.pedomanRef,
            requiredArtifact: d.requiredArtifact,
            status: d.status,
            evidenceLocation: '',
            notes: '',
            updatedBy: userProfile?.displayName || 'Kepala SPI',
            updatedAt: new Date().toISOString(),
          });
        });
      }

      await batch.commit();
      showToast(
        addedCount > 0
          ? `Berhasil memuat ${addedCount} indikator KPI & Cascading 5 Tingkat tahun ${selectedYear}.`
          : `Seluruh template KPI baku tahun ${selectedYear} sudah tersedia.`
      );
    } catch (err) {
      console.error('Error seeding KPI pack:', err);
      alert('Gagal memuat template KPI baku.');
    } finally {
      setIsSeeding(false);
    }
  };

  const openAddKpiModal = (parentKpi?: KPIItem) => {
    setEditingKpi(null);
    const nextNum = yearKpis.length + 1;
    if (parentKpi) {
      const nextLevel = Math.min(5, parentKpi.level + 1) as KPILevel;
      setFCode(`${parentKpi.code}-L${nextLevel}-${String(nextNum).padStart(2, '0')}`);
      setFPerspective(parentKpi.perspective);
      setFObjective(parentKpi.strategicObjective);
      setFName('');
      setFIndicatorType(nextLevel >= 4 ? 'Leading (Penggerak)' : parentKpi.indicatorType);
      setFLevel(nextLevel);
      setFParentId(parentKpi.id);
      setFCascadeMethod('Contributory (Kontribusi)');
      setFUnitName(units[0]?.name || parentKpi.unitName);
      setFOwnerRole(
        nextLevel === 2
          ? 'Direktur Terkait'
          : nextLevel === 3
          ? 'Kepala Bidang'
          : nextLevel === 4
          ? 'Kepala SubBidang/Unit'
          : 'Staf / Pelaksana Individu'
      );
      setFPicName('');
      setFDefinition('');
      setFFormula(parentKpi.formula);
      setFUnitMeasure(parentKpi.unitMeasurement);
      setFPolarity(parentKpi.polarity);
      setFAccumulation(parentKpi.accumulationType);
      setFBaseline(parentKpi.baselineValue);
      setFTarget(parentKpi.targetValue);
      setFRangeMin(parentKpi.rangeMin ?? 6.5);
      setFRangeMax(parentKpi.rangeMax ?? 8.5);
      setFZeroPenalty(parentKpi.zeroPenaltyStep ?? 20);
      setFWeight(25);
      setFCapMax(currentSettings.defaultCapMaxPct);
      setFFloorMin(currentSettings.defaultFloorMinPct);
      setFIsGating(false);
      setFGatingThreshold(95);
      setFDataSource(parentKpi.dataSource);
      setFFrequency('Bulanan');
      setFEvidenceRequired(parentKpi.evidenceRequired);
      setFTargetBasisNote('');
      setFLinkedRka(parentKpi.linkedRkaCode || '');
      setFLinkedRisk(parentKpi.linkedRiskCode || '');
      setFApprovalStatus('Draft');
      setFChangeReason('');
    } else {
      setFCode(`KPI-${selectedYear}-${String(nextNum).padStart(2, '0')}`);
      setFPerspective('Operasional');
      setFObjective('');
      setFName('');
      setFIndicatorType('Lagging (Hasil)');
      setFLevel(1);
      setFParentId('');
      setFCascadeMethod('Direct (Identik)');
      setFUnitName('Korporat (Perumda Air Minum)');
      setFOwnerRole('Direktur Utama');
      setFPicName('Direktur Utama');
      setFDefinition('');
      setFFormula('');
      setFUnitMeasure('%');
      setFPolarity('MAXIMIZE');
      setFAccumulation('AVERAGE');
      setFBaseline(0);
      setFTarget(100);
      setFRangeMin(6.5);
      setFRangeMax(8.5);
      setFZeroPenalty(20);
      setFWeight(10);
      setFCapMax(currentSettings.defaultCapMaxPct);
      setFFloorMin(currentSettings.defaultFloorMinPct);
      setFIsGating(false);
      setFGatingThreshold(95);
      setFDataSource('');
      setFFrequency('Bulanan');
      setFEvidenceRequired('');
      setFTargetBasisNote('');
      setFLinkedRka('');
      setFLinkedRisk('');
      setFApprovalStatus('Draft');
      setFChangeReason('');
    }
    setIsKpiModalOpen(true);
  };

  const openEditKpiModal = (k: KPIItem) => {
    setEditingKpi(k);
    setFCode(k.code);
    setFPerspective(k.perspective);
    setFObjective(k.strategicObjective);
    setFName(k.name);
    setFIndicatorType(k.indicatorType);
    setFLevel(k.level);
    setFParentId(k.parentKpiId || '');
    setFCascadeMethod(k.cascadeMethod);
    setFUnitName(k.unitName);
    setFOwnerRole(k.ownerRole);
    setFPicName(k.picName);
    setFDefinition(k.operationalDefinition);
    setFFormula(k.formula);
    setFUnitMeasure(k.unitMeasurement);
    setFPolarity(k.polarity);
    setFAccumulation(k.accumulationType);
    setFBaseline(k.baselineValue);
    setFTarget(k.targetValue);
    setFRangeMin(k.rangeMin ?? 6.5);
    setFRangeMax(k.rangeMax ?? 8.5);
    setFZeroPenalty(k.zeroPenaltyStep ?? 20);
    setFWeight(k.weight);
    setFCapMax(k.capMaxPct);
    setFFloorMin(k.floorMinPct);
    setFIsGating(Boolean(k.isGating));
    setFGatingThreshold(k.gatingThresholdPct ?? 95);
    setFDataSource(k.dataSource);
    setFFrequency(k.frequency);
    setFEvidenceRequired(k.evidenceRequired);
    setFTargetBasisNote(k.targetBasisNote || '');
    setFLinkedRka(k.linkedRkaCode || '');
    setFLinkedRisk(k.linkedRiskCode || '');
    setFApprovalStatus(k.approvalStatus);
    setFChangeReason(k.changeReason || '');
    setIsKpiModalOpen(true);
  };

  const handleSaveKpi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStructure) return;

    const parentObj = yearKpis.find((x) => x.id === fParentId);
    const now = new Date().toISOString();
    const id = editingKpi?.id || `kpi-${selectedYear}-${Date.now()}`;

    const payload: KPIItem = {
      id,
      code: fCode.trim(),
      year: selectedYear,
      perspective: fPerspective,
      strategicObjective: fObjective.trim(),
      name: fName.trim(),
      indicatorType: fIndicatorType,
      level: fLevel,
      ...(fLevel > 1 && parentObj ? { parentKpiId: parentObj.id, parentKpiCode: parentObj.code } : {}),
      cascadeMethod: fCascadeMethod,
      unitName: fUnitName.trim() || 'Korporat',
      ownerRole: fOwnerRole.trim(),
      picName: fPicName.trim() || fOwnerRole.trim(),
      operationalDefinition: fDefinition.trim(),
      formula: fFormula.trim(),
      unitMeasurement: fUnitMeasure.trim() || '%',
      polarity: fPolarity,
      accumulationType: fAccumulation,
      baselineValue: Number(fBaseline) || 0,
      targetValue: Number(fTarget) || 0,
      ...(fPolarity === 'STABILIZE'
        ? { rangeMin: Number(fRangeMin) || 0, rangeMax: Number(fRangeMax) || 0 }
        : {}),
      ...(fPolarity === 'ZERO_TARGET' ? { zeroPenaltyStep: Number(fZeroPenalty) || 20 } : {}),
      weight: Number(fWeight) || 0,
      capMaxPct: Number(fCapMax) || 120,
      floorMinPct: Number(fFloorMin) || 0,
      isGating: fIsGating,
      ...(fIsGating ? { gatingThresholdPct: Number(fGatingThreshold) || 95 } : {}),
      dataSource: fDataSource.trim(),
      frequency: fFrequency,
      evidenceRequired: fEvidenceRequired.trim(),
      targetBasisNote: fTargetBasisNote.trim(),
      linkedRkaCode: fLinkedRka.trim(),
      linkedRiskCode: fLinkedRisk.trim(),
      approvalStatus: fApprovalStatus,
      ...(fApprovalStatus === 'Disahkan Kontrak Kinerja'
        ? {
            approvedBy: editingKpi?.approvedBy || userProfile?.displayName || 'Kepala SPI / Direksi',
            approvedAt: editingKpi?.approvedAt || now,
          }
        : {}),
      changeReason: fChangeReason.trim(),
      createdBy: editingKpi?.createdBy || userProfile?.displayName || 'Kepala SPI',
      createdAt: editingKpi?.createdAt || now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'kpi_items', id), payload);
      setIsKpiModalOpen(false);
      showToast(editingKpi ? `KPI ${payload.code} berhasil diperbarui.` : `KPI ${payload.code} berhasil ditambahkan.`);
    } catch (err) {
      console.error('Error saving KPI:', err);
      alert('Gagal menyimpan indikator KPI.');
    }
  };

  const handleDeleteKpi = async (k: KPIItem) => {
    if (!canManageStructure) return;
    if (!window.confirm(`Hapus indikator KPI "${k.code} - ${k.name}"?`)) return;
    try {
      await deleteDoc(doc(db, 'kpi_items', k.id));
      showToast(`KPI ${k.code} dihapus.`);
    } catch (err) {
      console.error('Error deleting KPI:', err);
    }
  };

  const openMeasurementModal = (kpi: KPIItem) => {
    setTargetKpiForMeasure(kpi);
    const existing = resolvedPeriodMap.get(kpi.id)?.exact;
    setMRealization(existing?.realizationValue ?? kpi.baselineValue ?? 0);
    setMEvidenceNote(existing?.evidenceNote || '');
    setMEvidenceUrl(existing?.evidenceUrl || '');
    setIsMeasureModalOpen(true);
  };

  const handleSaveMeasurement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitMeasurement || !targetKpiForMeasure) return;
    const kpi = targetKpiForMeasure;
    const calc = calculateKPIAchievement(kpi, Number(mRealization), currentSettings);
    const existing = resolvedPeriodMap.get(kpi.id)?.exact;
    const measId = existing?.id || `meas-${kpi.id}-${periodType}-${periodIndex}`;
    const now = new Date().toISOString();

    let formattedUrl = mEvidenceUrl.trim();
    if (formattedUrl && !formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = 'https://' + formattedUrl;
    }

    const payload: KPIMeasurement = {
      ...(existing || {}),
      id: measId,
      kpiId: kpi.id,
      kpiCode: kpi.code,
      year: selectedYear,
      periodType,
      periodIndex,
      periodLabel: getPeriodLabel(periodType, periodIndex, selectedYear),
      realizationValue: Number(mRealization),
      rawAchievementPct: calc.rawAchievementPct,
      cappedAchievementPct: calc.cappedAchievementPct,
      weightedScore: calc.weightedScore,
      trafficLight: calc.trafficLight,
      evidenceNote: mEvidenceNote.trim(),
      evidenceUrl: formattedUrl || undefined,
      submittedBy: userProfile?.displayName || 'Unit Kerja',
      submittedAt: now,
      spiVerificationStatus: existing?.spiVerificationStatus || 'Belum Diverifikasi',
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'kpi_measurements', measId), payload);
      setIsMeasureModalOpen(false);
      showToast(`Realisasi ${kpi.code} (${payload.periodLabel}) berhasil disimpan.`);
    } catch (err) {
      console.error('Error saving KPI measurement:', err);
      alert('Gagal menyimpan realisasi KPI.');
    }
  };

  const openActionPlanModal = (kpi: KPIItem, existing?: KPIMeasurement) => {
    setTargetMeasureForAction({ kpi, measurement: existing });
    setARootCause(existing?.rootCauseAnalysis || '');
    setAActionPlan(existing?.actionPlan || '');
    setAActionPic(existing?.actionPic || kpi.picName || kpi.ownerRole);
    setADeadline(existing?.actionDeadline || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
    setABudget(existing?.actionBudget || 0);
    setAOutcome(existing?.actionExpectedOutcome || `Mencapai target ${kpi.targetValue} ${kpi.unitMeasurement}`);
    setAStatus(existing?.actionStatus || 'Dalam Proses');
    setIsActionModalOpen(true);
  };

  const handleSaveActionPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetMeasureForAction) return;
    const { kpi, measurement } = targetMeasureForAction;
    const now = new Date().toISOString();
    const measId = measurement?.id || `meas-${kpi.id}-${periodType}-${periodIndex}`;

    if (measurement) {
      await updateDoc(doc(db, 'kpi_measurements', measId), {
        rootCauseAnalysis: aRootCause.trim(),
        actionPlan: aActionPlan.trim(),
        actionPic: aActionPic.trim(),
        actionDeadline: aDeadline,
        actionBudget: Number(aBudget) || 0,
        actionExpectedOutcome: aOutcome.trim(),
        actionStatus: aStatus,
        updatedAt: now,
      });
    } else {
      const calc = calculateKPIAchievement(kpi, kpi.baselineValue, currentSettings);
      const newMeas: KPIMeasurement = {
        id: measId,
        kpiId: kpi.id,
        kpiCode: kpi.code,
        year: selectedYear,
        periodType,
        periodIndex,
        periodLabel: getPeriodLabel(periodType, periodIndex, selectedYear),
        realizationValue: kpi.baselineValue,
        rawAchievementPct: calc.rawAchievementPct,
        cappedAchievementPct: calc.cappedAchievementPct,
        weightedScore: calc.weightedScore,
        trafficLight: calc.trafficLight,
        submittedBy: userProfile?.displayName || 'PIC',
        submittedAt: now,
        spiVerificationStatus: 'Belum Diverifikasi',
        rootCauseAnalysis: aRootCause.trim(),
        actionPlan: aActionPlan.trim(),
        actionPic: aActionPic.trim(),
        actionDeadline: aDeadline,
        actionBudget: Number(aBudget) || 0,
        actionExpectedOutcome: aOutcome.trim(),
        actionStatus: aStatus,
        updatedAt: now,
      };
      await setDoc(doc(db, 'kpi_measurements', measId), newMeas);
    }

    setIsActionModalOpen(false);
    showToast(`Evaluasi & Rencana Aksi untuk ${kpi.code} disimpan.`);
  };

  const openVerifyModal = (kpi: KPIItem, measurement: KPIMeasurement) => {
    setTargetMeasureForVerify({ kpi, measurement });
    setVStatus(
      measurement.spiVerificationStatus === 'Belum Diverifikasi'
        ? 'Terverifikasi SPI'
        : measurement.spiVerificationStatus
    );
    setVNote(
      measurement.spiVerificationNote ||
        'Data realisasi dan dokumen bukti capaian telah direviu oleh SPI dan dinyatakan akurat.'
    );
    setIsVerifyModalOpen(true);
  };

  const handleSaveVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canVerifySpi || !targetMeasureForVerify) return;
    const { kpi, measurement } = targetMeasureForVerify;
    try {
      await updateDoc(doc(db, 'kpi_measurements', measurement.id), {
        spiVerificationStatus: vStatus,
        spiVerificationNote: vNote.trim(),
        verifiedBy: userProfile?.displayName || 'Auditor SPI',
        verifiedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setIsVerifyModalOpen(false);
      showToast(`Status verifikasi SPI untuk ${kpi.code} diperbarui.`);
    } catch (err) {
      console.error('Error verifying KPI measurement:', err);
      alert('Gagal menyimpan verifikasi SPI.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageStructure) return;
    const totalPW =
      policyForm.perspectiveWeights.keuangan +
      policyForm.perspectiveWeights.pelanggan +
      policyForm.perspectiveWeights.operasional +
      policyForm.perspectiveWeights.prosesBisnis +
      policyForm.perspectiveWeights.pembelajaran;
    if (totalPW !== 100) {
      alert(`Total bobot 5 perspektif harus tepat 100% (saat ini: ${totalPW}%).`);
      return;
    }

    const updated: KPISettings = {
      ...policyForm,
      id: `kpi-settings-${selectedYear}`,
      year: selectedYear,
      updatedBy: userProfile?.displayName || 'Kepala SPI',
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'kpi_settings', updated.id), updated);
    showToast(`Kebijakan skoring KPI tahun ${selectedYear} disimpan.`);
  };

  const handleUpdateChecklistStatus = async (
    item: KPIChecklistItem,
    status: KPIChecklistItem['status'],
    notes?: string,
    evidenceLocation?: string
  ) => {
    if (!canManageStructure) return;
    const id = item.id || `chk-${selectedYear}-${item.itemNumber}`;
    const payload: KPIChecklistItem = {
      ...item,
      id,
      year: selectedYear,
      status,
      notes: notes !== undefined ? notes : item.notes,
      evidenceLocation: evidenceLocation !== undefined ? evidenceLocation : item.evidenceLocation,
      updatedBy: userProfile?.displayName || 'Kepala SPI',
      updatedAt: new Date().toISOString(),
    };
    await setDoc(doc(db, 'kpi_checklist', id), payload);
  };

  const handleExportExcel = () => {
    if (isViewer) return;
    const rows = filteredKpis.map((k, idx) => {
      const res = resolvedPeriodMap.get(k.id);
      return {
        No: idx + 1,
        Kode: k.code,
        Tingkat: getLevelLabel(k.level),
        Perspektif: k.perspective,
        'Sasaran Strategis': k.strategicObjective,
        'Nama KPI': k.name,
        Polaritas: getPolarityLabel(k.polarity),
        Akumulasi: k.accumulationType,
        'Unit / Jabatan': `${k.unitName} (${k.ownerRole})`,
        Baseline: k.baselineValue,
        Target: k.targetValue,
        Satuan: k.unitMeasurement,
        'Bobot (%)': k.weight,
        'Realisasi YTD': res?.ytdValue ?? '-',
        'Capaian (%)': res?.calc ? res.calc.cappedAchievementPct : '-',
        'Nilai Tertimbang': res?.calc ? res.calc.weightedScore : '-',
        'Traffic Light': res?.calc ? res.calc.trafficLight : '-',
        'Verifikasi SPI': res?.exact?.spiVerificationStatus || 'Belum Diverifikasi',
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `KPI ${selectedYear}`);
    XLSX.writeFile(wb, `Matriks_KPI_Cascading_${selectedYear}.xlsx`);
  };

  // Cascading Tree Builder
  const childrenByParent = useMemo(() => {
    const map = new Map<string, KPIItem[]>();
    visibleKpis.forEach((k) => {
      if (k.parentKpiId) {
        const list = map.get(k.parentKpiId) || [];
        list.push(k);
        map.set(k.parentKpiId, list);
      }
    });
    return map;
  }, [visibleKpis]);

  const rootCascadeKpis = useMemo(() => {
    const visibleIds = new Set(visibleKpis.map((k) => k.id));
    return visibleKpis.filter((k) => !k.parentKpiId || !visibleIds.has(k.parentKpiId));
  }, [visibleKpis]);

  const renderTrafficText = (tl?: 'HIJAU' | 'KUNING' | 'MERAH') => {
    if (!tl) return <span className="text-slate-400">Belum Diukur</span>;
    if (tl === 'HIJAU') return <span className="font-semibold text-emerald-700">Hijau · Tercapai</span>;
    if (tl === 'KUNING') return <span className="font-semibold text-amber-700">Kuning · Perhatian</span>;
    return <span className="font-semibold text-rose-700">Merah · Kritis</span>;
  };

  const renderCascadeNode = (node: KPIItem, depth = 0): React.ReactNode => {
    const children = childrenByParent.get(node.id) || [];
    const hasChildren = children.length > 0;
    const isExpanded = expandedNodes[node.id] !== false;
    const res = resolvedPeriodMap.get(node.id);

    return (
      <div key={node.id} className={depth > 0 ? 'ml-6 pl-4 border-l border-slate-200 mt-2' : 'mt-3'}>
        <div className="bg-white border border-slate-200 rounded-lg p-3.5 hover:border-slate-300 transition-colors">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {hasChildren && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedNodes((prev) => ({ ...prev, [node.id]: !isExpanded }))
                    }
                    className="p-0.5 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
                    aria-label="Toggle turunan"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                )}
                <span className="font-mono font-semibold text-slate-800">{node.code}</span>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-emerald-800">{getLevelLabel(node.level)}</span>
                <span aria-hidden="true">·</span>
                <span>{node.cascadeMethod}</span>
                {node.isGating && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-rose-700">Wajib (Gating)</span>
                  </>
                )}
              </div>

              <h4 className="text-sm font-bold text-slate-900 leading-snug">{node.name}</h4>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                <span>
                  Pemilik: <strong className="text-slate-800">{node.ownerRole}</strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>{node.unitName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Target:{' '}
                  {node.polarity === 'STABILIZE'
                    ? `${node.rangeMin}–${node.rangeMax}`
                    : `${node.targetValue}`}{' '}
                  {node.unitMeasurement}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums font-semibold text-slate-800">
                  Bobot {node.weight}%
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <div className="text-right font-mono tabular-nums text-xs">
                <div className="font-bold text-slate-900">
                  {res?.calc ? `${res.calc.cappedAchievementPct}%` : '—'}
                </div>
                <div className="text-[11px] font-sans">{renderTrafficText(res?.calc?.trafficLight)}</div>
              </div>

              {canManageStructure && node.level < 5 && (
                <button
                  type="button"
                  onClick={() => openAddKpiModal(node)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Turunkan (L{node.level + 1})</span>
                </button>
              )}

              {canManageStructure && (
                <button
                  type="button"
                  onClick={() => openEditKpiModal(node)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md cursor-pointer"
                  title="Ubah indikator"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="space-y-1">{children.map((ch) => renderCascadeNode(ch, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-emerald-700" />
            <span>Sistem Manajemen KPI, Cascading 5 Tingkat & Kamus KPI BUMD Air Minum</span>
          </h2>
          <p className="text-xs text-slate-500">
            Selaras Pedoman Perumusan KPI Versi 2026 Disempurnakan · 5 Perspektif Balanced Scorecard · Verifikasi Kualitas Data SPI
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={selectedYear}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) {
                addCustomYear(v);
                setSelectedYear(v);
              }
            }}
            className="px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg text-slate-800"
          >
            {yearOptions.map((yr) => (
              <option key={yr} value={yr}>
                Tahun {yr}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setPrintMode('REPORT')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-emerald-700" />
            <span>Cetak Laporan KPI</span>
          </button>

          {!isViewer && (
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={filteredKpis.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-700" />
              <span>Ekspor Excel</span>
            </button>
          )}

          {canManageStructure && (
            <button
              type="button"
              onClick={() => openAddKpiModal()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah KPI Baru</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {statusMessage && (
        <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-900 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-lg overflow-x-auto">
        {(
          [
            { id: 'dashboard', label: 'Dashboard & Peta Strategi', icon: TrendingUp },
            { id: 'dictionary', label: 'Matriks & Kamus KPI', icon: BookOpen },
            { id: 'cascading', label: 'Cascading 5 Tingkat', icon: GitBranch },
            { id: 'measurement', label: 'Realisasi & Verifikasi SPI', icon: ClipboardCheck },
            { id: 'evaluation', label: 'Evaluasi & Rencana Aksi', icon: AlertTriangle },
            { id: 'pedoman', label: 'Penyempurnaan Pedoman & Checklist', icon: ShieldCheck },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                active
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-emerald-700' : 'text-slate-500'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Empty State Prompt when no KPIs in selectedYear */}
      {yearKpis.length === 0 && activeSubTab !== 'pedoman' && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4 max-w-2xl mx-auto">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center mx-auto">
            <Layers className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-slate-900">
              Belum Ada Matriks KPI Terdaftar untuk Tahun {selectedYear}
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Anda dapat memuat paket template baku <strong>23 Indikator KPI & Cascading 5 Tingkat BUMD Air Minum</strong> (mencakup seluruh 5 Perspektif dengan total bobot 100%, NRW, Collection Ratio, Kualitas Air Gating, Cakupan Pelayanan, serta Tindak Lanjut SPI) atau membuat indikator secara manual.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
            {canManageStructure && (
              <button
                type="button"
                disabled={isSeeding}
                onClick={handleLoadStandardPack}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" />
                <span>
                  {isSeeding
                    ? 'Memuat Template KPI...'
                    : `Muat Template Baku KPI & Cascading ${selectedYear}`}
                </span>
              </button>
            )}
            {canManageStructure && (
              <button
                type="button"
                onClick={() => openAddKpiModal()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Input Manual KPI Pertama</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 1: DASHBOARD & PETA STRATEGI                                  */}
      {/* ================================================================= */}
      {activeSubTab === 'dashboard' && yearKpis.length > 0 && (
        <div className="space-y-6">
          {/* Period Selector Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-700">Periode Penilaian:</span>
              <select
                value={periodType}
                onChange={(e) => {
                  const nextType = e.target.value as 'Bulanan' | 'Triwulanan' | 'Tahunan';
                  setPeriodType(nextType);
                  setPeriodIndex(nextType === 'Bulanan' ? new Date().getMonth() + 1 : 1);
                }}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-semibold text-slate-800"
              >
                <option value="Bulanan">Bulan Berjalan</option>
                <option value="Triwulanan">Bulan Berjalan (Periode 3 Bln)</option>
                <option value="Tahunan">Tahunan</option>
              </select>

              {periodType === 'Bulanan' && (
                <select
                  value={periodIndex}
                  onChange={(e) => setPeriodIndex(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-semibold text-slate-800"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {getPeriodLabel('Bulanan', m, selectedYear)}
                    </option>
                  ))}
                </select>
              )}

              {periodType === 'Triwulanan' && (
                <select
                  value={periodIndex}
                  onChange={(e) => setPeriodIndex(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-semibold text-slate-800"
                >
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      {getPeriodLabel('Triwulanan', q, selectedYear)}
                    </option>
                  ))}
                </select>
              )}

              <span className="text-slate-500">
                Cap Maks: <strong className="font-mono tabular-nums">{currentSettings.defaultCapMaxPct}%</strong> · Floor:{' '}
                <strong className="font-mono tabular-nums">{currentSettings.defaultFloorMinPct}%</strong>
              </span>
            </div>

            <div className="text-xs text-slate-600">
              Total Indikator Aktif:{' '}
              <strong className="font-mono tabular-nums text-slate-900">{yearKpis.length}</strong> (Tingkat 1 Perusahaan:{' '}
              <strong className="font-mono tabular-nums text-slate-900">{level1Kpis.length}</strong>)
            </div>
          </div>

          {/* 4-Column KPI Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <p className="text-xs font-medium text-slate-500">Skor Akhir Tertimbang Perusahaan</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
                  {corporateScoreSummary.measuredCount > 0
                    ? corporateScoreSummary.effectiveScore.toFixed(2)
                    : '0.00'}
                </span>
                <span className="text-xs font-bold text-emerald-800">
                  Predikat {corporateScoreSummary.predicate.code} ({corporateScoreSummary.predicate.label})
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                {corporateScoreSummary.measuredCount} dari {level1Kpis.length} KPI perusahaan telah diukur
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <p className="text-xs font-medium text-slate-500">Validasi Total Bobot KPI Perusahaan</p>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-2xl font-extrabold font-mono tabular-nums ${
                    corporateScoreSummary.totalConfiguredWeight === 100
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  {corporateScoreSummary.totalConfiguredWeight}%
                </span>
                <span className="text-xs font-semibold text-slate-600">
                  {corporateScoreSummary.totalConfiguredWeight === 100
                    ? 'Seimbang (100%)'
                    : 'Perlu Penyesuaian ke 100%'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Cakupan 5 Perspektif Balanced Scorecard BUMD
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <p className="text-xs font-medium text-slate-500">Distribusi Status Traffic Light</p>
              <div className="flex items-center gap-3 pt-0.5 font-mono tabular-nums text-sm font-bold">
                <span className="text-emerald-700">{corporateScoreSummary.greenCount} Hijau</span>
                <span className="text-slate-300">/</span>
                <span className="text-amber-600">{corporateScoreSummary.yellowCount} Kuning</span>
                <span className="text-slate-300">/</span>
                <span className="text-rose-700">{corporateScoreSummary.redCount} Merah</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Hijau ≥{currentSettings.greenThresholdPct}% · Kuning ≥{currentSettings.yellowThresholdPct}%
              </p>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <p className="text-xs font-medium text-slate-500">Asurans Kualitas Data SPI & Kesiapan</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold font-mono tabular-nums text-slate-900">
                  {corporateScoreSummary.verifiedCount}/{corporateScoreSummary.measuredCount || 0}
                </span>
                <span className="text-xs font-semibold text-slate-600">Terverifikasi SPI</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Kesiapan 17 Komponen Sistem KPI:{' '}
                <strong className="font-mono tabular-nums text-slate-800">{checklistReadinessPct}%</strong>
              </p>
            </div>
          </div>

          {/* Gating Warning if Water Quality / Mandatory KPI Failed */}
          {corporateScoreSummary.predicate.wasCappedByGating && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 space-y-1">
              <p className="font-bold">
                Peringatan Aturan Gating Baku Mutu (Bab IV 4.6 Disempurnakan):
              </p>
              <p>
                Skor tertimbang awal adalah{' '}
                <strong className="font-mono tabular-nums">{corporateScoreSummary.rawTotalWeightedScore}</strong>,
                namun ditahan menjadi <strong className="font-mono tabular-nums">{corporateScoreSummary.effectiveScore}</strong>{' '}
                karena indikator mandatori berikut berada di bawah ambang minimal:{' '}
                {corporateScoreSummary.predicate.failedGatingKpis.join('; ')}.
              </p>
            </div>
          )}

          {/* 5-Perspective Balanced Scorecard Breakdown */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Alokasi & Capaian 5 Perspektif Balanced Scorecard BUMD Air Minum
                </h3>
                <p className="text-xs text-slate-500">
                  Memperbaiki ketimpangan Tabel 5.1 pedoman awal agar seluruh 5 perspektif (termasuk Proses Bisnis Internal & Pembelajaran SDM) terukur.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                    <th className="py-2.5 pr-4">Perspektif KPI</th>
                    <th className="py-2.5 px-3 text-right">Target Bobot</th>
                    <th className="py-2.5 px-3 text-right">Bobot Aktual</th>
                    <th className="py-2.5 px-3 text-right">Jumlah KPI</th>
                    <th className="py-2.5 px-3 text-right">Rata-Rata Capaian</th>
                    <th className="py-2.5 pl-3 text-right">Kontribusi Skor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {corporateScoreSummary.perspectiveSummaries.map((row) => (
                    <tr key={row.perspective} className="hover:bg-slate-50/70">
                      <td className="py-3 pr-4">
                        <div className="font-bold text-slate-900">{row.perspective}</div>
                        <div className="text-[11px] text-slate-500">{row.meta.focusArea}</div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                        {row.targetWeight}%
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums font-bold ${
                          row.configuredWeight === row.targetWeight ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {row.configuredWeight}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                        {row.kpiCount} ({row.measuredCount} diukur)
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {row.measuredCount > 0 ? `${row.avgAchievementPct}%` : '—'}
                      </td>
                      <td className="py-3 pl-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                        {row.measuredCount > 0 ? row.weightedScore.toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Strategy Map */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Peta Strategi Perusahaan (Strategy Map) Tahun {selectedYear}
              </h3>
              <p className="text-xs text-slate-500">
                Penyelarasan sasaran strategis dari perspektif pembelajaran hingga dampak keuangan & layanan masyarakat.
              </p>
            </div>

            <div className="space-y-3">
              {KPI_PERSPECTIVE_META.map((meta) => {
                const pKpis = level1Kpis.filter((k) => k.perspective === meta.key);
                return (
                  <div key={meta.key} className="border border-slate-200 rounded-lg p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <span className="text-xs font-bold text-slate-900">{meta.key}</span>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500">
                        {pKpis.length} Sasaran/KPI Perusahaan
                      </span>
                    </div>
                    {pKpis.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">
                        Belum ada KPI Tingkat 1 pada perspektif ini.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {pKpis.map((k) => {
                          const res = resolvedPeriodMap.get(k.id);
                          return (
                            <div
                              key={k.id}
                              className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1"
                            >
                              <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                                <span className="font-semibold text-slate-700">{k.code}</span>
                                <span>Bobot {k.weight}%</span>
                              </div>
                              <p className="text-xs font-bold text-slate-900 leading-snug">
                                {k.strategicObjective}
                              </p>
                              <p className="text-[11px] text-slate-600">{k.name}</p>
                              <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500">
                                <span>
                                  Target: <strong className="font-mono tabular-nums text-slate-800">{k.targetValue} {k.unitMeasurement}</strong>
                                </span>
                                <span className="font-mono tabular-nums font-bold text-emerald-800">
                                  {res?.calc ? `${res.calc.cappedAchievementPct}%` : 'Belum diukur'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: MATRIKS & KAMUS KPI (KPI DICTIONARY)                       */}
      {/* ================================================================= */}
      {activeSubTab === 'dictionary' && yearKpis.length > 0 && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari kode, nama KPI, sasaran, atau PIC..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-1 focus:ring-emerald-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filterPerspective}
                onChange={(e) => setFilterPerspective(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
              >
                <option value="ALL">Semua Perspektif</option>
                {KPI_PERSPECTIVE_META.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.key}
                  </option>
                ))}
              </select>

              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
              >
                <option value="ALL">Semua Tingkat (1–5)</option>
                {[1, 2, 3, 4, 5].map((lv) => (
                  <option key={lv} value={lv}>
                    {getLevelLabel(lv as KPILevel)}
                  </option>
                ))}
              </select>

              <select
                value={filterUnit}
                onChange={(e) => setFilterUnit(e.target.value)}
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
              >
                <option value="ALL">Semua Unit / Direktorat</option>
                {distinctUnits.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* KPI Dictionary Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">Kode & Nama Indikator</th>
                    <th className="py-3 px-3">Perspektif & Tingkat</th>
                    <th className="py-3 px-3">Polaritas & YTD</th>
                    <th className="py-3 px-3 text-right">Baseline</th>
                    <th className="py-3 px-3 text-right">Target</th>
                    <th className="py-3 px-3 text-right">Bobot</th>
                    <th className="py-3 px-3">Pemilik / PIC</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredKpis.map((k) => {
                    const isOpen = expandedDictId === k.id;
                    return (
                      <React.Fragment key={k.id}>
                        <tr className="hover:bg-slate-50/70">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 text-[11px] text-slate-500">
                              <span className="font-mono font-semibold text-slate-800">{k.code}</span>
                              <span aria-hidden="true">·</span>
                              <span>{k.indicatorType}</span>
                              {k.isGating && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-semibold text-rose-700">Gating</span>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setExpandedDictId(isOpen ? null : k.id)}
                              className="font-bold text-slate-900 hover:text-emerald-800 text-left mt-0.5 cursor-pointer"
                            >
                              {k.name}
                            </button>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-slate-800">{k.perspective}</div>
                            <div className="text-[11px] text-slate-500">{getLevelLabel(k.level)}</div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-medium text-slate-800">{getPolarityLabel(k.polarity)}</div>
                            <div className="text-[11px] text-slate-500">YTD: {k.accumulationType}</div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-600">
                            {k.baselineValue} {k.unitMeasurement}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                            {k.polarity === 'STABILIZE'
                              ? `${k.rangeMin}–${k.rangeMax}`
                              : k.targetValue}{' '}
                            {k.unitMeasurement}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                            {k.weight}%
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-semibold text-slate-800">{k.ownerRole}</div>
                            <div className="text-[11px] text-slate-500">{k.unitName}</div>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setExpandedDictId(isOpen ? null : k.id)}
                                className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                              >
                                {isOpen ? 'Tutup Kamus' : 'Kamus'}
                              </button>
                              {canManageStructure && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEditKpiModal(k)}
                                    className="p-1.5 text-slate-500 hover:text-slate-900 rounded cursor-pointer"
                                    title="Edit KPI"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteKpi(k)}
                                    className="p-1.5 text-rose-500 hover:text-rose-700 rounded cursor-pointer"
                                    title="Hapus KPI"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={8} className="px-5 py-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                                <div>
                                  <span className="font-semibold text-slate-500 block">Sasaran Strategis:</span>
                                  <p className="text-slate-900 mt-0.5">{k.strategicObjective}</p>
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-500 block">Definisi Operasional:</span>
                                  <p className="text-slate-900 mt-0.5">{k.operationalDefinition}</p>
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-500 block">Formula Pengukuran:</span>
                                  <p className="font-mono text-[11px] text-emerald-900 mt-0.5">{k.formula}</p>
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-500 block">Sumber Data & Frekuensi:</span>
                                  <p className="text-slate-900 mt-0.5">
                                    {k.dataSource} ({getFrequencyLabel(k.frequency)})
                                  </p>
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-500 block">Bukti Capaian Wajib:</span>
                                  <p className="text-slate-900 mt-0.5">{k.evidenceRequired}</p>
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-500 block">
                                    Integrasi RKA / Risiko & Dasar Target:
                                  </span>
                                  <p className="text-slate-900 mt-0.5">
                                    RKA: {k.linkedRkaCode || '-'} · Risiko: {k.linkedRiskCode || '-'}
                                  </p>
                                  {k.targetBasisNote && (
                                    <p className="text-[11px] text-slate-600 mt-0.5">{k.targetBasisNote}</p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: CASCADING 5 TINGKAT & KONTRAK KINERJA                      */}
      {/* ================================================================= */}
      {activeSubTab === 'cascading' && yearKpis.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-slate-900">
                Pohon Penurunan KPI (Cascading 5 Tingkat Organisasi)
              </h3>
              <p className="text-xs text-slate-500">
                Tingkat 1 Perusahaan → 2 Direktur → 3 Bidang → 4 SubBidang/Unit → 5 Individu Pegawai.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={contractLevelFilter}
                onChange={(e) => setContractLevelFilter(Number(e.target.value))}
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg font-semibold text-slate-800"
              >
                {[1, 2, 3, 4, 5].map((lv) => (
                  <option key={lv} value={lv}>
                    Kontrak Kinerja: {getLevelLabel(lv as KPILevel)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setPrintMode('CONTRACT')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak Kontrak Kinerja</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">{rootCascadeKpis.map((root) => renderCascadeNode(root, 0))}</div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 4: PENGUKURAN REALISASI & VERIFIKASI KUALITAS DATA SPI        */}
      {/* ================================================================= */}
      {activeSubTab === 'measurement' && yearKpis.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-slate-700">Periode Input & Verifikasi:</span>
              <select
                value={periodType}
                onChange={(e) => {
                  const nextType = e.target.value as 'Bulanan' | 'Triwulanan' | 'Tahunan';
                  setPeriodType(nextType);
                  setPeriodIndex(nextType === 'Bulanan' ? new Date().getMonth() + 1 : 1);
                }}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-semibold text-slate-800"
              >
                <option value="Bulanan">Bulan Berjalan</option>
                <option value="Triwulanan">Bulan Berjalan (Periode 3 Bln)</option>
                <option value="Tahunan">Tahunan</option>
              </select>

              {periodType === 'Bulanan' && (
                <select
                  value={periodIndex}
                  onChange={(e) => setPeriodIndex(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-semibold text-slate-800"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {getPeriodLabel('Bulanan', m, selectedYear)}
                    </option>
                  ))}
                </select>
              )}

              {periodType === 'Triwulanan' && (
                <select
                  value={periodIndex}
                  onChange={(e) => setPeriodIndex(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md font-semibold text-slate-800"
                >
                  {[1, 2, 3, 4].map((q) => (
                    <option key={q} value={q}>
                      {getPeriodLabel('Triwulanan', q, selectedYear)}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={filterLevel}
                onChange={(e) => setFilterLevel(e.target.value)}
                className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-md text-slate-800"
              >
                <option value="ALL">Semua Tingkat</option>
                {[1, 2, 3, 4, 5].map((lv) => (
                  <option key={lv} value={lv}>
                    {getLevelLabel(lv as KPILevel)}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-xs text-slate-500">
              Menampilkan <strong className="font-mono tabular-nums text-slate-900">{filteredKpis.length}</strong> indikator
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-3 px-4">KPI & Pemilik</th>
                    <th className="py-3 px-3 text-right">Target</th>
                    <th className="py-3 px-3 text-right">Realisasi Periode / YTD</th>
                    <th className="py-3 px-3 text-right">Capaian (Cap)</th>
                    <th className="py-3 px-3 text-right">Nilai Tertimbang</th>
                    <th className="py-3 px-3">Status & Verifikasi SPI</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredKpis.map((k) => {
                    const res = resolvedPeriodMap.get(k.id);
                    const exact = res?.exact;
                    const calc = res?.calc;
                    return (
                      <tr key={k.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4">
                          <div className="text-[11px] text-slate-500">
                            <span className="font-mono font-semibold text-slate-800">{k.code}</span>
                            <span aria-hidden="true"> · </span>
                            <span>{getLevelLabel(k.level)}</span>
                          </div>
                          <div className="font-bold text-slate-900">{k.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {k.ownerRole} · {k.unitName}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          <div className="font-semibold text-slate-900">
                            {k.polarity === 'STABILIZE' ? `${k.rangeMin}–${k.rangeMax}` : k.targetValue}{' '}
                            {k.unitMeasurement}
                          </div>
                          <div className="text-[11px] text-slate-500">Bobot {k.weight}%</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {exact ? (
                            <>
                              <div className="font-bold text-slate-900">
                                {exact.realizationValue} {k.unitMeasurement}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                YTD ({k.accumulationType}): {res?.ytdValue}
                              </div>
                            </>
                          ) : res?.ytdValue !== undefined ? (
                            <div className="text-slate-600">
                              YTD: {res.ytdValue} {k.unitMeasurement}
                            </div>
                          ) : (
                            <span className="text-slate-400">Belum diinput</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                          {calc ? `${calc.cappedAchievementPct}%` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-emerald-800">
                          {calc ? calc.weightedScore.toFixed(2) : '—'}
                        </td>
                        <td className="py-3 px-3">
                          <div>{renderTrafficText(calc?.trafficLight)}</div>
                          {exact && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              SPI:{' '}
                              <span
                                className={
                                  exact.spiVerificationStatus === 'Terverifikasi SPI'
                                    ? 'font-semibold text-emerald-700'
                                    : exact.spiVerificationStatus === 'Perlu Klarifikasi'
                                    ? 'font-semibold text-rose-700'
                                    : 'text-slate-600'
                                }
                              >
                                {exact.spiVerificationStatus}
                              </span>
                            </div>
                          )}
                          {exact?.evidenceUrl && (
                            <a
                              href={exact.evidenceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:underline mt-0.5"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>Bukti</span>
                            </a>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {canSubmitMeasurement && (
                              <button
                                type="button"
                                onClick={() => openMeasurementModal(k)}
                                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                              >
                                {exact ? 'Ubah Realisasi' : 'Input Realisasi'}
                              </button>
                            )}
                            {canVerifySpi && exact && (
                              <button
                                type="button"
                                onClick={() => openVerifyModal(k, exact)}
                                className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer"
                              >
                                Verifikasi SPI
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 5: EVALUASI KESENJANGAN & RENCANA AKSI PERBAIKAN              */}
      {/* ================================================================= */}
      {activeSubTab === 'evaluation' && yearKpis.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Evaluasi Kesenjangan & Rencana Aksi Perbaikan (Bab VI 6.3 & VII 7.3)
              </h3>
              <p className="text-xs text-slate-500">
                Menampilkan indikator dengan capaian di bawah ambang Hijau (&lt;{currentSettings.greenThresholdPct}%) untuk periode{' '}
                <strong>{getPeriodLabel(periodType, periodIndex, selectedYear)}</strong>.
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums font-bold text-slate-800">
              {gapEvaluationRows.length} Indikator Perlu Evaluasi
            </span>
          </div>

          {gapEvaluationRows.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
              <p className="text-sm font-bold text-slate-900">
                Belum Ada Kesenjangan Kinerja Tercatat pada Periode Ini
              </p>
              <p className="text-xs text-slate-500">
                Seluruh indikator yang sudah diukur berada pada zona Hijau (≥{currentSettings.greenThresholdPct}%) atau belum ada pengukuran realisasi.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {gapEvaluationRows.map(({ kpi, measurement, ytdValue, calc }) => (
                <div
                  key={kpi.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-semibold text-slate-800">{kpi.code}</span>
                        <span aria-hidden="true">·</span>
                        <span>{kpi.ownerRole}</span>
                        <span aria-hidden="true">·</span>
                        <span>{renderTrafficText(calc?.trafficLight)}</span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900">{kpi.name}</h4>
                      <p className="text-xs text-slate-600 font-mono tabular-nums">
                        Target: {kpi.targetValue} {kpi.unitMeasurement} · Realisasi YTD: {ytdValue ?? '-'} {kpi.unitMeasurement} · Capaian:{' '}
                        <strong className="text-rose-700">{calc?.cappedAchievementPct ?? 0}%</strong>
                      </p>
                    </div>

                    {canSubmitMeasurement && (
                      <button
                        type="button"
                        onClick={() => openActionPlanModal(kpi, measurement)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>{measurement?.actionPlan ? 'Perbarui Rencana Aksi' : 'Susun Rencana Aksi'}</span>
                      </button>
                    )}
                  </div>

                  {measurement?.actionPlan ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-slate-100 text-xs">
                      <div>
                        <span className="font-semibold text-slate-500 block">Analisis Akar Masalah:</span>
                        <p className="text-slate-800 mt-0.5">{measurement.rootCauseAnalysis || '-'}</p>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 block">Rencana Aksi Perbaikan:</span>
                        <p className="text-slate-800 mt-0.5">{measurement.actionPlan}</p>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 block">PIC, Jadwal & Anggaran:</span>
                        <p className="text-slate-800 mt-0.5">
                          PIC: {measurement.actionPic} · Tenggat: {measurement.actionDeadline || '-'}
                        </p>
                        <p className="text-slate-600 font-mono tabular-nums mt-0.5">
                          Anggaran: Rp {(measurement.actionBudget || 0).toLocaleString('id-ID')} · Status:{' '}
                          <strong>{measurement.actionStatus || 'Dalam Proses'}</strong>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-amber-700 pt-2 border-t border-slate-100">
                      Belum ada dokumen analisis penyebab dan rencana aksi perbaikan (wajib diisi sesuai Bab VII 7.3).
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 6: PENYEMPURNAAN PEDOMAN & CHECKLIST 17 KOMPONEN              */}
      {/* ================================================================= */}
      {activeSubTab === 'pedoman' && (
        <div className="space-y-6">
          {/* A. Audit & Refinement Summary */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Hasil Telaah & Penyempurnaan Pedoman Perumusan KPI BUMD Air Minum (Versi 2026 Disempurnakan)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  8 celah metodologis, matematis, dan tata kelola dari draf pedoman awal telah diidentifikasi dan disempurnakan langsung ke dalam mesin kalkulasi aplikasi.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <a
                  href="/assets/aistudio/Contoh_Pedoman_Perumusan_KPI__Cascading_-_kamus__cb4e4e8c.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-600" />
                  <span>Lihat PDF Draf Awal</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPrintMode('PEDOMAN')}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak Pedoman Disempurnakan</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3 w-48">Bagian Pedoman</th>
                    <th className="py-2.5 px-3">Kekurangan pada Draf Awal</th>
                    <th className="py-2.5 px-3">Penyempurnaan Baku (Versi 2026)</th>
                    <th className="py-2.5 px-3">Implementasi Sistem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {KPI_PEDOMAN_REFINEMENTS.map((item) => (
                    <tr key={item.id} className="align-top hover:bg-slate-50/70">
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{item.gapTitle}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{item.section}</div>
                      </td>
                      <td className="py-3 px-3 text-rose-900 leading-relaxed">{item.draftIssue}</td>
                      <td className="py-3 px-3 text-emerald-950 leading-relaxed">{item.perfectedStandard}</td>
                      <td className="py-3 px-3 text-slate-700 leading-relaxed">{item.systemImplementation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* B. Scoring Policy Governance Settings */}
          <form
            onSubmit={handleSaveSettings}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-emerald-700" />
                  <span>Kebijakan Matematis & Ambang Penilaian KPI Tahun {selectedYear}</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Mengatur batas atas (ceiling cap), batas bawah (floor), ambang Traffic Light, dan aturan Gating baku mutu air.
                </p>
              </div>
              {canManageStructure && (
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  Simpan Kebijakan
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ceiling Cap (%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.defaultCapMaxPct}
                  onChange={(e) =>
                    setPolicyForm({ ...policyForm, defaultCapMaxPct: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Floor Min (%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.defaultFloorMinPct}
                  onChange={(e) =>
                    setPolicyForm({ ...policyForm, defaultFloorMinPct: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ambang Hijau (≥%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.greenThresholdPct}
                  onChange={(e) =>
                    setPolicyForm({ ...policyForm, greenThresholdPct: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Ambang Kuning (≥%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.yellowThresholdPct}
                  onChange={(e) =>
                    setPolicyForm({ ...policyForm, yellowThresholdPct: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Batas Gating Skor</label>
                <input
                  type="number"
                  step="0.01"
                  disabled={!canManageStructure}
                  value={policyForm.gatingMaxTotalScore}
                  onChange={(e) =>
                    setPolicyForm({ ...policyForm, gatingMaxTotalScore: Number(e.target.value) })
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManageStructure}
                    checked={policyForm.enforceGatingCap}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, enforceGatingCap: e.target.checked })
                    }
                    className="rounded border-slate-300 text-emerald-700"
                  />
                  <span>Aktifkan Gating Mutu</span>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs pt-2 border-t border-slate-100">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bobot Keuangan (%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.perspectiveWeights.keuangan}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      perspectiveWeights: {
                        ...policyForm.perspectiveWeights,
                        keuangan: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bobot Pelanggan (%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.perspectiveWeights.pelanggan}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      perspectiveWeights: {
                        ...policyForm.perspectiveWeights,
                        pelanggan: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Bobot Operasional (%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.perspectiveWeights.operasional}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      perspectiveWeights: {
                        ...policyForm.perspectiveWeights,
                        operasional: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Proses Internal (%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.perspectiveWeights.prosesBisnis}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      perspectiveWeights: {
                        ...policyForm.perspectiveWeights,
                        prosesBisnis: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pembelajaran (%)</label>
                <input
                  type="number"
                  disabled={!canManageStructure}
                  value={policyForm.perspectiveWeights.pembelajaran}
                  onChange={(e) =>
                    setPolicyForm({
                      ...policyForm,
                      perspectiveWeights: {
                        ...policyForm.perspectiveWeights,
                        pembelajaran: Number(e.target.value),
                      },
                    })
                  }
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
            </div>
          </form>

          {/* C. 17-Item Lampiran Checklist */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Lampiran: Checklist Kelengkapan 17 Komponen Sistem KPI BUMD Air Minum
                </h3>
                <p className="text-xs text-slate-500">
                  Pemantauan kesiapan implementasi sistem KPI sesuai Lampiran Pedoman (halaman 10).
                </p>
              </div>
              <div className="text-xs font-bold font-mono tabular-nums text-emerald-800">
                Tingkat Kesiapan Sistem: {checklistReadinessPct}%
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3 w-10 text-center">No</th>
                    <th className="py-2.5 px-3">Dokumen / Komponen Sistem KPI</th>
                    <th className="py-2.5 px-3 w-36">Status</th>
                    <th className="py-2.5 px-3">Keterangan / Bukti Dokumen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {yearChecklist.map((chk) => (
                    <tr key={chk.itemNumber} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums font-bold text-slate-700">
                        {chk.itemNumber}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{chk.componentName}</div>
                        <div className="text-[11px] text-slate-500">
                          {chk.pedomanRef} · {chk.requiredArtifact}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <select
                          disabled={!canManageStructure}
                          value={chk.status}
                          onChange={(e) =>
                            handleUpdateChecklistStatus(
                              chk,
                              e.target.value as KPIChecklistItem['status']
                            )
                          }
                          className={`w-full px-2.5 py-1.5 border rounded-md font-semibold text-xs ${
                            chk.status === 'Ada'
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                              : chk.status === 'Sebagian'
                              ? 'bg-amber-50 border-amber-300 text-amber-900'
                              : 'bg-rose-50 border-rose-300 text-rose-900'
                          }`}
                        >
                          <option value="Ada">Ada (Lengkap)</option>
                          <option value="Sebagian">Sebagian</option>
                          <option value="Tidak">Belum Ada</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          disabled={!canManageStructure}
                          defaultValue={chk.notes}
                          onBlur={(e) => {
                            if (e.target.value !== chk.notes) {
                              handleUpdateChecklistStatus(chk, chk.status, e.target.value);
                            }
                          }}
                          placeholder="Catat nomor dokumen atau keterangan verifikasi..."
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-xs"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: ADD / EDIT KPI & DICTIONARY                                */}
      {/* ================================================================= */}
      {isKpiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                {editingKpi ? `Ubah Indikator KPI (${editingKpi.code})` : 'Tambah Indikator & Kamus KPI Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setIsKpiModalOpen(false)}
                className="text-emerald-200 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveKpi} className="p-6 space-y-4 text-xs overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kode KPI</label>
                  <input
                    type="text"
                    required
                    value={fCode}
                    onChange={(e) => setFCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Perspektif KPI</label>
                  <select
                    value={fPerspective}
                    onChange={(e) => setFPerspective(e.target.value as KPIPerspective)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    {KPI_PERSPECTIVE_META.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.key}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tingkat Organisasi (Cascading)</label>
                  <select
                    value={fLevel}
                    onChange={(e) => setFLevel(Number(e.target.value) as KPILevel)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    {[1, 2, 3, 4, 5].map((lv) => (
                      <option key={lv} value={lv}>
                        {getLevelLabel(lv as KPILevel)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {fLevel > 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">KPI Induk (Parent Cascade)</label>
                    <select
                      value={fParentId}
                      onChange={(e) => setFParentId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                    >
                      <option value="">-- Pilih KPI Induk (Opsional) --</option>
                      {yearKpis
                        .filter((p) => p.level < fLevel)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            [L{p.level}] {p.code} — {p.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Metode Penurunan (Cascade Method)</label>
                    <select
                      value={fCascadeMethod}
                      onChange={(e) => setFCascadeMethod(e.target.value as KPICascadeMethod)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                    >
                      <option value="Direct (Identik)">Direct (Identik)</option>
                      <option value="Contributory (Kontribusi)">Contributory (Kontribusi)</option>
                      <option value="Driver (Pengungkit / Leading)">Driver (Pengungkit / Leading)</option>
                      <option value="Specific (Fungsional Unit)">Specific (Fungsional Unit)</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Sasaran Strategis</label>
                  <input
                    type="text"
                    required
                    value={fObjective}
                    onChange={(e) => setFObjective(e.target.value)}
                    placeholder="Contoh: Mengurangi kehilangan air (NRW)..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nama Indikator (KPI)</label>
                  <input
                    type="text"
                    required
                    value={fName}
                    onChange={(e) => setFName(e.target.value)}
                    placeholder="Nama indikator spesifik dan terukur..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Unit Kerja / Direktorat</label>
                  <input
                    type="text"
                    required
                    list="kpi-units-datalist"
                    value={fUnitName}
                    onChange={(e) => setFUnitName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                  <datalist id="kpi-units-datalist">
                    <option value="Korporat (Perumda Air Minum)" />
                    <option value="Direktorat Utama" />
                    <option value="Direktorat Umum & Keuangan" />
                    <option value="Direktorat Teknik" />
                    {units.map((u) => (
                      <option key={u.id} value={u.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Jabatan Pemilik KPI</label>
                  <input
                    type="text"
                    required
                    value={fOwnerRole}
                    onChange={(e) => setFOwnerRole(e.target.value)}
                    placeholder="Contoh: Direktur Teknik / Kepala Bagian Distribusi"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nama PIC</label>
                  <input
                    type="text"
                    required
                    value={fPicName}
                    onChange={(e) => setFPicName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Polaritas Rumus</label>
                  <select
                    value={fPolarity}
                    onChange={(e) => setFPolarity(e.target.value as KPIPolarity)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="MAXIMIZE">Semakin Tinggi Semakin Baik</option>
                    <option value="MINIMIZE">Semakin Rendah Semakin Baik</option>
                    <option value="STABILIZE">Rentang Optimal (Band)</option>
                    <option value="ZERO_TARGET">Target Nol (Zero Defect)</option>
                    <option value="MILESTONE">Kualitatif / Milestone</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Akumulasi YTD</label>
                  <select
                    value={fAccumulation}
                    onChange={(e) => setFAccumulation(e.target.value as KPIAccumulationType)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="AVERAGE">AVERAGE (Rata-Rata)</option>
                    <option value="CUMULATIVE">CUMULATIVE (Penjumlahan)</option>
                    <option value="LAST_VALUE">LAST_VALUE (Posisi Terakhir)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tipe Indikator</label>
                  <select
                    value={fIndicatorType}
                    onChange={(e) =>
                      setFIndicatorType(e.target.value as 'Lagging (Hasil)' | 'Leading (Penggerak)')
                    }
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="Lagging (Hasil)">Lagging (Hasil)</option>
                    <option value="Leading (Penggerak)">Leading (Penggerak)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Satuan</label>
                  <input
                    type="text"
                    required
                    value={fUnitMeasure}
                    onChange={(e) => setFUnitMeasure(e.target.value)}
                    placeholder="%, Rp, Jam/Hari, pH, Kasus..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Baseline</label>
                  <input
                    type="number"
                    step="any"
                    value={fBaseline}
                    onChange={(e) => setFBaseline(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Target</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={fTarget}
                    onChange={(e) => setFTarget(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bobot (%)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={fWeight}
                    onChange={(e) => setFWeight(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums font-bold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cap Maks (%)</label>
                  <input
                    type="number"
                    value={fCapMax}
                    onChange={(e) => setFCapMax(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono tabular-nums"
                  />
                </div>
              </div>

              {fPolarity === 'STABILIZE' && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Batas Bawah Optimal</label>
                    <input
                      type="number"
                      step="any"
                      value={fRangeMin}
                      onChange={(e) => setFRangeMin(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Batas Atas Optimal</label>
                    <input
                      type="number"
                      step="any"
                      value={fRangeMax}
                      onChange={(e) => setFRangeMax(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>
              )}

              {fPolarity === 'ZERO_TARGET' && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Pengurangan Skor (%) Per 1 Kejadian Pelanggaran
                  </label>
                  <input
                    type="number"
                    value={fZeroPenalty}
                    onChange={(e) => setFZeroPenalty(Number(e.target.value))}
                    className="w-40 px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Definisi Operasional</label>
                  <textarea
                    rows={2}
                    required
                    value={fDefinition}
                    onChange={(e) => setFDefinition(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Formula Perhitungan</label>
                  <textarea
                    rows={2}
                    required
                    value={fFormula}
                    onChange={(e) => setFFormula(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-[11px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Sumber Data</label>
                  <input
                    type="text"
                    required
                    value={fDataSource}
                    onChange={(e) => setFDataSource(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Frekuensi Pengukuran</label>
                  <select
                    value={fFrequency}
                    onChange={(e) => setFFrequency(e.target.value as KPIFrequency)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="Bulanan">Bulanan</option>
                    <option value="Triwulanan">Bulan Berjalan</option>
                    <option value="Semesteran">Semesteran</option>
                    <option value="Tahunan">Tahunan</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Bukti Capaian Wajib</label>
                  <input
                    type="text"
                    required
                    value={fEvidenceRequired}
                    onChange={(e) => setFEvidenceRequired(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Referensi Program RKA</label>
                  <input
                    type="text"
                    list="kpi-rka-datalist"
                    value={fLinkedRka}
                    onChange={(e) => setFLinkedRka(e.target.value)}
                    placeholder="Kode RKA..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                  <datalist id="kpi-rka-datalist">
                    {rkaItems
                      .filter((r) => r.year === selectedYear)
                      .map((r) => (
                        <option key={r.id} value={r.code}>
                          {r.programName}
                        </option>
                      ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Referensi Kode Risiko SPI</label>
                  <input
                    type="text"
                    list="kpi-risk-datalist"
                    value={fLinkedRisk}
                    onChange={(e) => setFLinkedRisk(e.target.value)}
                    placeholder="Kode Risiko..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                  <datalist id="kpi-risk-datalist">
                    {risks
                      .filter((rk) => rk.year === selectedYear)
                      .map((rk) => (
                        <option key={rk.id} value={rk.code}>
                          {rk.event}
                        </option>
                      ))}
                  </datalist>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Pengesahan</label>
                  <select
                    value={fApprovalStatus}
                    onChange={(e) => setFApprovalStatus(e.target.value as KPIApprovalStatus)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Diajukan">Diajukan</option>
                    <option value="Disahkan Kontrak Kinerja">Disahkan Kontrak Kinerja</option>
                    <option value="Direvisi">Direvisi</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fIsGating}
                    onChange={(e) => setFIsGating(e.target.checked)}
                    className="rounded border-slate-300 text-rose-600"
                  />
                  <span>Jadikan Indikator Gating (Kepatuhan Mandatori / Tidak Boleh Dikompromikan)</span>
                </label>
                {fIsGating && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-600">Ambang Minimal (%):</span>
                    <input
                      type="number"
                      value={fGatingThreshold}
                      onChange={(e) => setFGatingThreshold(Number(e.target.value))}
                      className="w-20 px-2 py-1 bg-white border border-slate-300 rounded font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsKpiModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  Simpan KPI & Kamus
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: INPUT REALISASI PERIODE                                    */}
      {/* ================================================================= */}
      {isMeasureModalOpen && targetKpiForMeasure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                Input Realisasi KPI · {getPeriodLabel(periodType, periodIndex, selectedYear)}
              </h3>
              <button
                type="button"
                onClick={() => setIsMeasureModalOpen(false)}
                className="text-emerald-200 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveMeasurement} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                <div className="font-mono font-bold text-slate-800">{targetKpiForMeasure.code}</div>
                <div className="font-bold text-slate-900">{targetKpiForMeasure.name}</div>
                <div className="text-[11px] text-slate-600">
                  Target: {targetKpiForMeasure.targetValue} {targetKpiForMeasure.unitMeasurement} · Polaritas:{' '}
                  {getPolarityLabel(targetKpiForMeasure.polarity)}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Nilai Realisasi ({targetKpiForMeasure.unitMeasurement})
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={mRealization}
                  onChange={(e) => setMRealization(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-sm font-bold"
                />
                {(() => {
                  const preview = calculateKPIAchievement(
                    targetKpiForMeasure,
                    Number(mRealization),
                    currentSettings
                  );
                  return (
                    <div className="mt-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] space-y-0.5">
                      <div>
                        Pratinjau Capaian:{' '}
                        <strong className="font-mono tabular-nums">{preview.cappedAchievementPct}%</strong> · Skor Tertimbang:{' '}
                        <strong className="font-mono tabular-nums">{preview.weightedScore}</strong>
                      </div>
                      <div className="text-slate-600">{preview.formulaNote}</div>
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Catatan / Penjelasan Bukti Capaian
                </label>
                <textarea
                  rows={2}
                  value={mEvidenceNote}
                  onChange={(e) => setMEvidenceNote(e.target.value)}
                  placeholder={`Bukti wajib: ${targetKpiForMeasure.evidenceRequired}`}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Tautan Dokumen Pendukung (Opsional)
                </label>
                <input
                  type="text"
                  value={mEvidenceUrl}
                  onChange={(e) => setMEvidenceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsMeasureModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  Simpan Realisasi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: EVALUASI KESENJANGAN & RENCANA AKSI PERBAIKAN              */}
      {/* ================================================================= */}
      {isActionModalOpen && targetMeasureForAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold">
                Evaluasi Kesenjangan & Rencana Aksi ({targetMeasureForAction.kpi.code})
              </h3>
              <button
                type="button"
                onClick={() => setIsActionModalOpen(false)}
                className="text-emerald-200 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveActionPlan} className="p-6 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Analisis Penyebab Ketidaktercapaian (Root Cause)
                </label>
                <textarea
                  rows={2}
                  required
                  value={aRootCause}
                  onChange={(e) => setARootCause(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Kegiatan Perbaikan (Action Plan)
                </label>
                <textarea
                  rows={2}
                  required
                  value={aActionPlan}
                  onChange={(e) => setAActionPlan(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Penanggung Jawab</label>
                  <input
                    type="text"
                    required
                    value={aActionPic}
                    onChange={(e) => setAActionPic(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Jadwal Target</label>
                  <input
                    type="date"
                    required
                    value={aDeadline}
                    onChange={(e) => setADeadline(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kebutuhan Anggaran (Rp)</label>
                  <input
                    type="number"
                    value={aBudget}
                    onChange={(e) => setABudget(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Status Tindak Lanjut</label>
                  <select
                    value={aStatus}
                    onChange={(e) => setAStatus(e.target.value as KPIActionStatus)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Belum Dimulai">Belum Dimulai</option>
                    <option value="Dalam Proses">Dalam Proses</option>
                    <option value="Selesai">Selesai</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsActionModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  Simpan Rencana Aksi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: VERIFIKASI KUALITAS DATA KPI OLEH SPI                      */}
      {/* ================================================================= */}
      {isVerifyModalOpen && targetMeasureForVerify && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-[#0d3824] to-[#105234] text-white flex items-center justify-between">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-300" />
                <span>Verifikasi Kualitas Data KPI (SPI)</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsVerifyModalOpen(false)}
                className="text-emerald-200 hover:text-white font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveVerification} className="p-6 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                <div className="font-bold text-slate-900">{targetMeasureForVerify.kpi.name}</div>
                <div className="font-mono text-slate-600">
                  Realisasi: {targetMeasureForVerify.measurement.realizationValue}{' '}
                  {targetMeasureForVerify.kpi.unitMeasurement} (
                  {targetMeasureForVerify.measurement.periodLabel})
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Keputusan Verifikasi SPI</label>
                <select
                  value={vStatus}
                  onChange={(e) => setVStatus(e.target.value as KPISPIVerificationStatus)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg font-semibold"
                >
                  <option value="Terverifikasi SPI">Terverifikasi SPI (Data Akurat & Memadai)</option>
                  <option value="Perlu Klarifikasi">Perlu Klarifikasi / Bukti Tambahan</option>
                  <option value="Belum Diverifikasi">Belum Diverifikasi</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Catatan Uji Kualitas Data SPI</label>
                <textarea
                  rows={3}
                  required
                  value={vNote}
                  onChange={(e) => setVNote(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsVerifyModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                >
                  Simpan Verifikasi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* OFFICIAL PRINT MODALS (REPORT / CONTRACT / PERFECTED PEDOMAN)     */}
      {/* ================================================================= */}
      {printMode && (
        <DocumentPrintPreviewModal
          isOpen={Boolean(printMode)}
          onClose={() => setPrintMode(null)}
          documentTitle={
            printMode === 'CONTRACT'
              ? `KONTRAK KINERJA (${getLevelLabel(contractLevelFilter as KPILevel).toUpperCase()})`
              : printMode === 'PEDOMAN'
              ? 'PEDOMAN PERUMUSAN & PENERAPAN KPI BUMD AIR MINUM (VERSI 2026 DISEMPURNAKAN)'
              : 'LAPORAN PENCAPAIAN KEY PERFORMANCE INDICATORS (KPI)'
          }
          documentSubtitle={`Periode ${getPeriodLabel(periodType, periodIndex, selectedYear)} · Tahun Anggaran ${selectedYear}`}
          documentNumber={`KPI/${printMode}/${selectedYear}`}
          initialSignatory1Role="Direktur Utama"
          initialSignatory2Role="Kepala Satuan Pengawasan Intern"
          defaultShowSignatory2={true}
        >
          {() => {
            if (printMode === 'CONTRACT') {
              const contractRows = yearKpis.filter((k) => k.level === contractLevelFilter);
              return (
                <div className="space-y-5 text-xs font-serif leading-relaxed">
                  <p className="font-sans text-slate-700">
                    Dokumen kesepakatan indikator kinerja utama (Kontrak Kinerja) untuk{' '}
                    <strong>{getLevelLabel(contractLevelFilter as KPILevel)}</strong> Tahun Anggaran{' '}
                    <strong>{selectedYear}</strong>:
                  </p>
                  <table className="w-full text-left text-[11px] border-collapse border border-slate-300 font-sans">
                    <thead>
                      <tr className="bg-slate-100 font-bold text-slate-800">
                        <th className="p-2 border border-slate-300 w-8 text-center">No</th>
                        <th className="p-2 border border-slate-300">Kode & Indikator KPI</th>
                        <th className="p-2 border border-slate-300">Perspektif & Metode</th>
                        <th className="p-2 border border-slate-300 text-right">Baseline</th>
                        <th className="p-2 border border-slate-300 text-right">Target</th>
                        <th className="p-2 border border-slate-300 text-right">Bobot</th>
                        <th className="p-2 border border-slate-300">Pemilik / PIC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contractRows.map((k, idx) => (
                        <tr key={k.id}>
                          <td className="p-2 border border-slate-300 text-center font-bold">{idx + 1}</td>
                          <td className="p-2 border border-slate-300">
                            <div className="font-mono font-bold text-[10px]">{k.code}</div>
                            <div className="font-semibold">{k.name}</div>
                          </td>
                          <td className="p-2 border border-slate-300">
                            <div>{k.perspective}</div>
                            <div className="text-[10px] text-slate-600">{k.cascadeMethod}</div>
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono">
                            {k.baselineValue} {k.unitMeasurement}
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono font-bold">
                            {k.targetValue} {k.unitMeasurement}
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono font-bold">
                            {k.weight}%
                          </td>
                          <td className="p-2 border border-slate-300">{k.ownerRole}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            if (printMode === 'PEDOMAN') {
              return (
                <div className="space-y-5 text-xs font-serif leading-relaxed">
                  <p>
                    Dokumen ini merupakan penyempurnaan resmi atas rancangan{' '}
                    <strong>Pedoman Perumusan dan Penerapan KPI BUMD Air Minum Versi 2026</strong>{' '}
                    yang melengkapi celah rumus matematis, keseimbangan 5 perspektif, batas capaian, aturan gating baku mutu air, metode akumulasi YTD, serta asurans kualitas data oleh SPI.
                  </p>
                  <h4 className="font-bold font-sans text-slate-900 uppercase border-b border-slate-300 pb-1">
                    Matriks Penyempurnaan Metodologi KPI:
                  </h4>
                  <table className="w-full text-left text-[11px] border-collapse border border-slate-300 font-sans">
                    <thead>
                      <tr className="bg-slate-100 font-bold text-slate-800">
                        <th className="p-2 border border-slate-300">Bagian</th>
                        <th className="p-2 border border-slate-300">Celah Draf Awal</th>
                        <th className="p-2 border border-slate-300">Standar Disempurnakan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KPI_PEDOMAN_REFINEMENTS.map((r) => (
                        <tr key={r.id} className="align-top">
                          <td className="p-2 border border-slate-300 font-semibold">{r.gapTitle}</td>
                          <td className="p-2 border border-slate-300">{r.draftIssue}</td>
                          <td className="p-2 border border-slate-300">{r.perfectedStandard}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            return (
              <div className="space-y-5 text-xs font-serif leading-relaxed">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 grid grid-cols-3 gap-3 font-sans text-xs">
                  <div>
                    <p className="text-slate-500">Skor Akhir Tertimbang:</p>
                    <p className="font-bold text-slate-900 font-mono">
                      {corporateScoreSummary.effectiveScore.toFixed(2)} ({corporateScoreSummary.predicate.code} · {corporateScoreSummary.predicate.label})
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Total Bobot Tingkat 1:</p>
                    <p className="font-bold text-emerald-800 font-mono">
                      {corporateScoreSummary.totalConfiguredWeight}%
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Status Verifikasi SPI:</p>
                    <p className="font-bold text-slate-900 font-mono">
                      {corporateScoreSummary.verifiedCount}/{corporateScoreSummary.measuredCount} Terverifikasi
                    </p>
                  </div>
                </div>

                <table className="w-full text-left text-[11px] border-collapse border border-slate-300 font-sans">
                  <thead>
                    <tr className="bg-slate-100 font-bold text-slate-800">
                      <th className="p-2 border border-slate-300">Kode & KPI Perusahaan</th>
                      <th className="p-2 border border-slate-300 text-right">Target</th>
                      <th className="p-2 border border-slate-300 text-right">Realisasi</th>
                      <th className="p-2 border border-slate-300 text-right">Capaian</th>
                      <th className="p-2 border border-slate-300 text-right">Bobot</th>
                      <th className="p-2 border border-slate-300 text-right">Skor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {level1Kpis.map((k) => {
                      const res = resolvedPeriodMap.get(k.id);
                      return (
                        <tr key={k.id}>
                          <td className="p-2 border border-slate-300">
                            <span className="font-mono font-bold">{k.code}</span> · {k.name}
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono">
                            {k.targetValue} {k.unitMeasurement}
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono">
                            {res?.ytdValue ?? '-'} {k.unitMeasurement}
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono font-bold">
                            {res?.calc ? `${res.calc.cappedAchievementPct}%` : '-'}
                          </td>
                          <td className="p-2 border border-slate-300 text-right font-mono">{k.weight}%</td>
                          <td className="p-2 border border-slate-300 text-right font-mono font-bold">
                            {res?.calc ? res.calc.weightedScore.toFixed(2) : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }}
        </DocumentPrintPreviewModal>
      )}
    </div>
  );
};
