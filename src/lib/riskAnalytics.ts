import {
  BPKPSelfAssessment,
  Finding,
  FollowUp,
  PKPT,
  Recommendation,
  RKAItem,
  RiskCause5M,
  RiskLevel,
  RiskRegister,
  Unit,
} from '../types/audit';
import { BPKP_RISK_CATEGORIES } from '../data/bpkpStandards';

export interface RCSAAnalyticsItem {
  id: string;
  unitId: string;
  unitName: string;
  year: number;
  activityTitle: string;
  identifiedRisk: string;
  controlRating: 'Efektif' | 'Sebagian' | 'Tidak Efektif';
  selfScore: number;
  spiAuditScore?: number;
  status: 'Diajukan' | 'Direviu SPI' | 'Disetujui';
}

export interface RiskLevelComparisonRow {
  level: string;
  scoreRange: string;
  inherentCount: number;
  inherentPct: number;
  residualCount: number;
  residualPct: number;
  delta: number;
}

export interface CategoryProfileRow {
  category: string;
  definition: string;
  riskCount: number;
  avgInherent: number;
  avgResidual: number;
  maxResidual: number;
  aboveAppetiteCount: number;
  dominantLevel: RiskLevel;
  effectiveControlCount: number;
}

export interface Cause5MProfileRow {
  causeCategory: string;
  riskCount: number;
  pct: number;
  avgResidual: number;
  aboveAppetiteCount: number;
}

export interface UnitRiskProfileRow {
  unitId: string;
  unitName: string;
  unitCode: string;
  unitCategory: string;
  headName: string;
  riskCount: number;
  avgInherent: number;
  avgResidual: number;
  maxResidual: number;
  aboveAppetiteCount: number;
  effectiveControlPct: number;
  mitigationCompletedCount: number;
  rcsaCount: number;
  rcsaAvgSelfScore: number;
  rcsaAvgSpiScore: number;
  findingsCount: number;
  potentialLoss: number;
  pkptCount: number;
}

export interface CorporateRiskAnalytics {
  year: number;
  appetiteThreshold: number;
  totalRisks: number;
  avgInherent: number;
  avgResidual: number;
  reductionRatePct: number;
  aboveAppetiteCount: number;
  aboveAppetitePct: number;
  aboveAppetiteRisks: RiskRegister[];
  criticalResidualCount: number;
  highResidualCount: number;
  mediumResidualCount: number;
  lowResidualCount: number;
  veryLowResidualCount: number;
  effectiveControlCount: number;
  partialControlCount: number;
  ineffectiveControlCount: number;
  effectiveControlRatePct: number;
  mitigationIdentifikasiCount: number;
  mitigationInProgressCount: number;
  mitigationCompletedCount: number;
  mitigationCompletionRatePct: number;
  spiCompliantCount: number;
  spiNeedsRevisionCount: number;
  spiPendingCount: number;
  inherentGrid: Record<string, RiskRegister[]>;
  residualGrid: Record<string, RiskRegister[]>;
  levelDistribution: RiskLevelComparisonRow[];
  categorySummaries: CategoryProfileRow[];
  cause5MSummaries: Cause5MProfileRow[];
  unitSummaries: UnitRiskProfileRow[];
  topRisks: RiskRegister[];
  filteredRcsa: RCSAAnalyticsItem[];
  filteredPkpt: PKPT[];
  filteredRka: RKAItem[];
  filteredFindings: Finding[];
  recommendationsSummary: {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    completionPct: number;
    followUpsApproved: number;
    followUpsSubmitted: number;
  };
  spipIntegration: {
    hasAssessment: boolean;
    year: number;
    kinerjaScore: number;
    kinerjaCategory: string;
    spipMaturityScore: number;
    spipMaturityLevel: string;
    riskElementAvgScore: number;
    riskSubElements: Array<{
      code: string;
      name: string;
      selfRating: number;
      spiReviewRating?: number;
      improvementPlan: string;
    }>;
  };
  rkaSummary: {
    totalPrograms: number;
    totalBudget: number;
    totalRealization: number;
    linkedPkptCount: number;
  };
  pkptSummary: {
    totalPlans: number;
    completedPlans: number;
    ongoingPlans: number;
    plannedPlans: number;
    realizationPct: number;
    avgPriorityScore: number;
  };
  findingsSummary: {
    totalFindings: number;
    criticalAndHighCount: number;
    totalPotentialLoss: number;
  };
}

export function normalizeBpkpRiskLevel(score: number): RiskLevel {
  if (score >= 20) return 'Sangat Tinggi';
  if (score >= 12) return 'Tinggi';
  if (score >= 5) return 'Sedang';
  if (score >= 3) return 'Rendah';
  return 'Sangat Rendah';
}

export function getEffectiveInherentScore(r: RiskRegister): number {
  const l = Math.min(5, Math.max(1, Number(r.likelihood) || 1));
  const i = Math.min(5, Math.max(1, Number(r.impact) || 1));
  return r.inherentScore && r.inherentScore > 0 ? r.inherentScore : l * i;
}

export function getEffectiveResidualScore(r: RiskRegister): number {
  const l = Math.min(5, Math.max(1, Number(r.residualLikelihood || r.likelihood) || 1));
  const i = Math.min(5, Math.max(1, Number(r.residualImpact || r.impact) || 1));
  return r.residualScore && r.residualScore > 0 ? r.residualScore : l * i;
}

export function formatRupiahId(val: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(val || 0);
}

export function buildCorporateRiskAnalytics(params: {
  year: number; // 0 = all years
  appetiteThreshold: number;
  risks: RiskRegister[];
  units: Unit[];
  rcsaList: RCSAAnalyticsItem[];
  bpkpList: BPKPSelfAssessment[];
  pkptList: PKPT[];
  rkaList: RKAItem[];
  findingsList: Finding[];
  recommendationsList: Recommendation[];
  followUpsList: FollowUp[];
}): CorporateRiskAnalytics {
  const {
    year,
    appetiteThreshold,
    risks,
    units,
    rcsaList,
    bpkpList,
    pkptList,
    rkaList,
    findingsList,
    recommendationsList,
    followUpsList,
  } = params;

  const filteredRisks = year === 0 ? risks : risks.filter((r) => r.year === year);
  const filteredRcsa = year === 0 ? rcsaList : rcsaList.filter((r) => r.year === year);
  const filteredPkpt = year === 0 ? pkptList : pkptList.filter((p) => p.year === year);
  const filteredRka = year === 0 ? rkaList : rkaList.filter((r) => r.year === year);
  const filteredFindings = year === 0 ? findingsList : findingsList.filter((f) => f.year === year);

  const totalRisks = filteredRisks.length;

  let sumInherent = 0;
  let sumResidual = 0;
  const aboveAppetiteRisks: RiskRegister[] = [];

  let criticalResidualCount = 0;
  let highResidualCount = 0;
  let mediumResidualCount = 0;
  let lowResidualCount = 0;
  let veryLowResidualCount = 0;

  let effectiveControlCount = 0;
  let partialControlCount = 0;
  let ineffectiveControlCount = 0;

  let mitigationIdentifikasiCount = 0;
  let mitigationInProgressCount = 0;
  let mitigationCompletedCount = 0;

  let spiCompliantCount = 0;
  let spiNeedsRevisionCount = 0;
  let spiPendingCount = 0;

  const inherentGrid: Record<string, RiskRegister[]> = {};
  const residualGrid: Record<string, RiskRegister[]> = {};
  for (let l = 1; l <= 5; l++) {
    for (let i = 1; i <= 5; i++) {
      inherentGrid[`${l}-${i}`] = [];
      residualGrid[`${l}-${i}`] = [];
    }
  }

  let inhVeryHigh = 0;
  let inhHigh = 0;
  let inhMed = 0;
  let inhLow = 0;
  let inhVeryLow = 0;

  filteredRisks.forEach((r) => {
    const inhL = Math.min(5, Math.max(1, Number(r.likelihood) || 1));
    const inhI = Math.min(5, Math.max(1, Number(r.impact) || 1));
    const resL = Math.min(5, Math.max(1, Number(r.residualLikelihood || r.likelihood) || 1));
    const resI = Math.min(5, Math.max(1, Number(r.residualImpact || r.impact) || 1));

    const inhScore = getEffectiveInherentScore(r);
    const resScore = getEffectiveResidualScore(r);

    sumInherent += inhScore;
    sumResidual += resScore;

    inherentGrid[`${inhL}-${inhI}`].push(r);
    residualGrid[`${resL}-${resI}`].push(r);

    if (resScore > appetiteThreshold) {
      aboveAppetiteRisks.push(r);
    }

    const inhLvl = normalizeBpkpRiskLevel(inhScore);
    if (inhLvl === 'Sangat Tinggi' || inhLvl === 'Ekstrem') inhVeryHigh++;
    else if (inhLvl === 'Tinggi') inhHigh++;
    else if (inhLvl === 'Sedang') inhMed++;
    else if (inhLvl === 'Rendah') inhLow++;
    else inhVeryLow++;

    const resLvl = normalizeBpkpRiskLevel(resScore);
    if (resLvl === 'Sangat Tinggi' || resLvl === 'Ekstrem') criticalResidualCount++;
    else if (resLvl === 'Tinggi') highResidualCount++;
    else if (resLvl === 'Sedang') mediumResidualCount++;
    else if (resLvl === 'Rendah') lowResidualCount++;
    else veryLowResidualCount++;

    if (r.controlEffectiveness === 'Efektif') effectiveControlCount++;
    else if (r.controlEffectiveness === 'Tidak Efektif') ineffectiveControlCount++;
    else partialControlCount++;

    if (r.status === 'Selesai') mitigationCompletedCount++;
    else if (r.status === 'Mitigasi') mitigationInProgressCount++;
    else mitigationIdentifikasiCount++;

    if (r.spiReviewStatus === 'Sesuai Kaidah') spiCompliantCount++;
    else if (r.spiReviewStatus === 'Perlu Perbaikan Kaidah') spiNeedsRevisionCount++;
    else spiPendingCount++;
  });

  const avgInherent = totalRisks > 0 ? Number((sumInherent / totalRisks).toFixed(2)) : 0;
  const avgResidual = totalRisks > 0 ? Number((sumResidual / totalRisks).toFixed(2)) : 0;
  const reductionRatePct =
    avgInherent > 0 ? Number((((avgInherent - avgResidual) / avgInherent) * 100).toFixed(1)) : 0;
  const aboveAppetiteCount = aboveAppetiteRisks.length;
  const aboveAppetitePct =
    totalRisks > 0 ? Number(((aboveAppetiteCount / totalRisks) * 100).toFixed(1)) : 0;
  const effectiveControlRatePct =
    totalRisks > 0 ? Number(((effectiveControlCount / totalRisks) * 100).toFixed(1)) : 0;
  const mitigationCompletionRatePct =
    totalRisks > 0 ? Number(((mitigationCompletedCount / totalRisks) * 100).toFixed(1)) : 0;

  const pct = (n: number) => (totalRisks > 0 ? Number(((n / totalRisks) * 100).toFixed(1)) : 0);

  const levelDistribution: RiskLevelComparisonRow[] = [
    {
      level: 'Sangat Tinggi / Ekstrem',
      scoreRange: '20 – 25',
      inherentCount: inhVeryHigh,
      inherentPct: pct(inhVeryHigh),
      residualCount: criticalResidualCount,
      residualPct: pct(criticalResidualCount),
      delta: criticalResidualCount - inhVeryHigh,
    },
    {
      level: 'Tinggi',
      scoreRange: '12 – 16',
      inherentCount: inhHigh,
      inherentPct: pct(inhHigh),
      residualCount: highResidualCount,
      residualPct: pct(highResidualCount),
      delta: highResidualCount - inhHigh,
    },
    {
      level: 'Sedang',
      scoreRange: '5 – 10',
      inherentCount: inhMed,
      inherentPct: pct(inhMed),
      residualCount: mediumResidualCount,
      residualPct: pct(mediumResidualCount),
      delta: mediumResidualCount - inhMed,
    },
    {
      level: 'Rendah',
      scoreRange: '3 – 4',
      inherentCount: inhLow,
      inherentPct: pct(inhLow),
      residualCount: lowResidualCount,
      residualPct: pct(lowResidualCount),
      delta: lowResidualCount - inhLow,
    },
    {
      level: 'Sangat Rendah',
      scoreRange: '1 – 2',
      inherentCount: inhVeryLow,
      inherentPct: pct(inhVeryLow),
      residualCount: veryLowResidualCount,
      residualPct: pct(veryLowResidualCount),
      delta: veryLowResidualCount - inhVeryLow,
    },
  ];

  // Category Summaries across BPKP 8 Categories + any extra custom categories
  const knownCategories = BPKP_RISK_CATEGORIES.map((c) => ({
    name: c.name,
    definition: c.definition,
  }));
  const extraCatNames = Array.from(
    new Set(
      filteredRisks
        .map((r) => r.category)
        .filter((cat) => cat && !knownCategories.some((k) => k.name === cat))
    )
  );
  const allCategories = [
    ...knownCategories,
    ...extraCatNames.map((name) => ({ name, definition: 'Kategori risiko tambahan operasional.' })),
  ];

  const categorySummaries: CategoryProfileRow[] = allCategories.map((cat) => {
    const items = filteredRisks.filter((r) => r.category === cat.name);
    const count = items.length;
    const catAvgInh =
      count > 0
        ? Number((items.reduce((s, x) => s + getEffectiveInherentScore(x), 0) / count).toFixed(2))
        : 0;
    const catAvgRes =
      count > 0
        ? Number((items.reduce((s, x) => s + getEffectiveResidualScore(x), 0) / count).toFixed(2))
        : 0;
    const maxRes =
      count > 0 ? Math.max(...items.map((x) => getEffectiveResidualScore(x))) : 0;
    const aboveCount = items.filter((x) => getEffectiveResidualScore(x) > appetiteThreshold).length;
    const effCount = items.filter((x) => x.controlEffectiveness === 'Efektif').length;
    return {
      category: cat.name,
      definition: cat.definition,
      riskCount: count,
      avgInherent: catAvgInh,
      avgResidual: catAvgRes,
      maxResidual: maxRes,
      aboveAppetiteCount: aboveCount,
      dominantLevel: count > 0 ? normalizeBpkpRiskLevel(Math.round(catAvgRes)) : 'Sangat Rendah',
      effectiveControlCount: effCount,
    };
  });

  // 5M Cause Summaries
  const cause5MKeys: RiskCause5M[] = [
    'MAN (SDM)',
    'MONEY (Keuangan)',
    'MATERIAL (Bahan)',
    'MACHINE (Peralatan & Bangunan)',
    'METHODE (Kebijakan & SOP)',
  ];
  const cause5MSummaries: Cause5MProfileRow[] = cause5MKeys.map((ck) => {
    const items = filteredRisks.filter((r) => r.causeCategory5M === ck);
    const count = items.length;
    return {
      causeCategory: ck,
      riskCount: count,
      pct: pct(count),
      avgResidual:
        count > 0
          ? Number((items.reduce((s, x) => s + getEffectiveResidualScore(x), 0) / count).toFixed(2))
          : 0,
      aboveAppetiteCount: items.filter((x) => getEffectiveResidualScore(x) > appetiteThreshold).length,
    };
  });
  const unspecified5M = filteredRisks.filter((r) => !r.causeCategory5M);
  if (unspecified5M.length > 0) {
    cause5MSummaries.push({
      causeCategory: 'Belum Diklasifikasi 5M',
      riskCount: unspecified5M.length,
      pct: pct(unspecified5M.length),
      avgResidual: Number(
        (
          unspecified5M.reduce((s, x) => s + getEffectiveResidualScore(x), 0) /
          unspecified5M.length
        ).toFixed(2)
      ),
      aboveAppetiteCount: unspecified5M.filter(
        (x) => getEffectiveResidualScore(x) > appetiteThreshold
      ).length,
    });
  }

  // Unit Summaries
  const unitMap = new Map<string, Unit>();
  units.forEach((u) => unitMap.set(u.id, u));
  filteredRisks.forEach((r) => {
    if (r.unitId && !unitMap.has(r.unitId)) {
      unitMap.set(r.unitId, {
        id: r.unitId,
        name: r.unitName || r.unitId,
        code: r.unitId.toUpperCase().slice(0, 8),
        category: 'UNIT_PELAYANAN',
        isActive: true,
      });
    }
  });

  const unitSummaries: UnitRiskProfileRow[] = Array.from(unitMap.values())
    .map((u) => {
      const uRisks = filteredRisks.filter(
        (r) => r.unitId === u.id || (!r.unitId && r.unitName === u.name)
      );
      const uRcsa = filteredRcsa.filter((r) => r.unitId === u.id || r.unitName === u.name);
      const uFindings = filteredFindings.filter((f) => f.unitId === u.id || f.unitName === u.name);
      const uPkpt = filteredPkpt.filter((p) => p.unitId === u.id || p.unitName === u.name);

      const count = uRisks.length;
      const uAvgInh =
        count > 0
          ? Number(
              (uRisks.reduce((s, x) => s + getEffectiveInherentScore(x), 0) / count).toFixed(2)
            )
          : 0;
      const uAvgRes =
        count > 0
          ? Number(
              (uRisks.reduce((s, x) => s + getEffectiveResidualScore(x), 0) / count).toFixed(2)
            )
          : 0;
      const uMaxRes =
        count > 0 ? Math.max(...uRisks.map((x) => getEffectiveResidualScore(x))) : 0;
      const uAbove = uRisks.filter((x) => getEffectiveResidualScore(x) > appetiteThreshold).length;
      const uEffCount = uRisks.filter((x) => x.controlEffectiveness === 'Efektif').length;
      const uMitDone = uRisks.filter((x) => x.status === 'Selesai').length;

      const rcsaAvgSelf =
        uRcsa.length > 0
          ? Number((uRcsa.reduce((s, x) => s + (x.selfScore || 0), 0) / uRcsa.length).toFixed(2))
          : 0;
      const spiScoredRcsa = uRcsa.filter((x) => typeof x.spiAuditScore === 'number');
      const rcsaAvgSpi =
        spiScoredRcsa.length > 0
          ? Number(
              (
                spiScoredRcsa.reduce((s, x) => s + (x.spiAuditScore || 0), 0) /
                spiScoredRcsa.length
              ).toFixed(2)
            )
          : 0;

      return {
        unitId: u.id,
        unitName: u.name,
        unitCode: u.code,
        unitCategory: u.category,
        headName: u.headName || '-',
        riskCount: count,
        avgInherent: uAvgInh,
        avgResidual: uAvgRes,
        maxResidual: uMaxRes,
        aboveAppetiteCount: uAbove,
        effectiveControlPct: count > 0 ? Math.round((uEffCount / count) * 100) : 0,
        mitigationCompletedCount: uMitDone,
        rcsaCount: uRcsa.length,
        rcsaAvgSelfScore: rcsaAvgSelf,
        rcsaAvgSpiScore: rcsaAvgSpi,
        findingsCount: uFindings.length,
        potentialLoss: uFindings.reduce((s, f) => s + (f.potentialLoss || 0), 0),
        pkptCount: uPkpt.length,
      };
    })
    .sort((a, b) => {
      if (b.maxResidual !== a.maxResidual) return b.maxResidual - a.maxResidual;
      if (b.avgResidual !== a.avgResidual) return b.avgResidual - a.avgResidual;
      return b.riskCount - a.riskCount;
    });

  // Top Risks sorted by Residual Desc -> Inherent Desc
  const topRisks = [...filteredRisks].sort((a, b) => {
    const resDiff = getEffectiveResidualScore(b) - getEffectiveResidualScore(a);
    if (resDiff !== 0) return resDiff;
    return getEffectiveInherentScore(b) - getEffectiveInherentScore(a);
  });

  // BPKP SPIP Integration (match year or latest available)
  const matchingBpkp =
    (year === 0
      ? [...bpkpList].sort((a, b) => b.year - a.year)[0]
      : bpkpList.find((b) => b.year === year)) ||
    [...bpkpList].sort((a, b) => b.year - a.year)[0];

  const riskElements = matchingBpkp
    ? (matchingBpkp.spipElements || []).filter((el) => el.elementNumber === 2)
    : [];
  const riskElementAvgScore =
    riskElements.length > 0
      ? Number(
          (
            riskElements.reduce((s, e) => s + (e.spiReviewRating ?? e.selfRating ?? 0), 0) /
            riskElements.length
          ).toFixed(2)
        )
      : 0;

  // Recommendations & Follow-Ups
  const findingIdsSet = new Set(filteredFindings.map((f) => f.id));
  const relevantRecs =
    year === 0
      ? recommendationsList
      : recommendationsList.filter((rec) => findingIdsSet.has(rec.findingId));
  const totalRecs = relevantRecs.length;
  const completedRecs = relevantRecs.filter((r) => r.status === 'Selesai').length;
  const inProgressRecs = relevantRecs.filter(
    (r) => r.status === 'Dalam Proses' || r.status === 'Menunggu Verifikasi'
  ).length;
  const notStartedRecs = relevantRecs.filter(
    (r) => r.status === 'Belum Ditindaklanjuti'
  ).length;
  const recIdsSet = new Set(relevantRecs.map((r) => r.id));
  const relevantFollowUps =
    year === 0
      ? followUpsList
      : followUpsList.filter((fu) => recIdsSet.has(fu.recommendationId));

  // RKA & PKPT Summary
  const totalBudget = filteredRka.reduce((s, item) => s + (item.budgetAmount || 0), 0);
  const totalRealization = filteredRka.reduce((s, item) => s + (item.realizationAmount || 0), 0);
  const linkedPkptCount = filteredPkpt.filter((p) => Boolean(p.rkaId)).length;

  const completedPkpt = filteredPkpt.filter((p) => p.status === 'Selesai').length;
  const ongoingPkpt = filteredPkpt.filter((p) => p.status === 'Berlangsung').length;
  const plannedPkpt = filteredPkpt.filter((p) => p.status === 'Rencana').length;
  const avgPriorityScore =
    filteredPkpt.length > 0
      ? Number(
          (
            filteredPkpt.reduce((s, p) => s + (p.priorityScore || p.riskScore || 0), 0) /
            filteredPkpt.length
          ).toFixed(2)
        )
      : 0;

  return {
    year,
    appetiteThreshold,
    totalRisks,
    avgInherent,
    avgResidual,
    reductionRatePct,
    aboveAppetiteCount,
    aboveAppetitePct,
    aboveAppetiteRisks,
    criticalResidualCount,
    highResidualCount,
    mediumResidualCount,
    lowResidualCount,
    veryLowResidualCount,
    effectiveControlCount,
    partialControlCount,
    ineffectiveControlCount,
    effectiveControlRatePct,
    mitigationIdentifikasiCount,
    mitigationInProgressCount,
    mitigationCompletedCount,
    mitigationCompletionRatePct,
    spiCompliantCount,
    spiNeedsRevisionCount,
    spiPendingCount,
    inherentGrid,
    residualGrid,
    levelDistribution,
    categorySummaries,
    cause5MSummaries,
    unitSummaries,
    topRisks,
    filteredRcsa,
    filteredPkpt,
    filteredRka,
    filteredFindings,
    recommendationsSummary: {
      total: totalRecs,
      completed: completedRecs,
      inProgress: inProgressRecs,
      notStarted: notStartedRecs,
      completionPct: totalRecs > 0 ? Math.round((completedRecs / totalRecs) * 100) : 0,
      followUpsApproved: relevantFollowUps.filter((f) => f.status === 'Disetujui').length,
      followUpsSubmitted: relevantFollowUps.filter((f) => f.status === 'Diajukan').length,
    },
    spipIntegration: {
      hasAssessment: Boolean(matchingBpkp),
      year: matchingBpkp?.year || year,
      kinerjaScore: matchingBpkp?.kinerjaScore || 0,
      kinerjaCategory: matchingBpkp?.kinerjaCategory || 'Belum Dinilai',
      spipMaturityScore: matchingBpkp?.spipMaturityScore || 0,
      spipMaturityLevel: matchingBpkp?.spipMaturityLevel || 'Belum Dinilai',
      riskElementAvgScore,
      riskSubElements: riskElements.map((e) => ({
        code: e.subElementCode,
        name: e.subElementName,
        selfRating: e.selfRating,
        spiReviewRating: e.spiReviewRating,
        improvementPlan: e.improvementPlan,
      })),
    },
    rkaSummary: {
      totalPrograms: filteredRka.length,
      totalBudget,
      totalRealization,
      linkedPkptCount,
    },
    pkptSummary: {
      totalPlans: filteredPkpt.length,
      completedPlans: completedPkpt,
      ongoingPlans: ongoingPkpt,
      plannedPlans: plannedPkpt,
      realizationPct:
        filteredPkpt.length > 0 ? Math.round((completedPkpt / filteredPkpt.length) * 100) : 0,
      avgPriorityScore,
    },
    findingsSummary: {
      totalFindings: filteredFindings.length,
      criticalAndHighCount: filteredFindings.filter(
        (f) => f.riskLevel === 'Kritis' || f.riskLevel === 'Tinggi'
      ).length,
      totalPotentialLoss: filteredFindings.reduce((s, f) => s + (f.potentialLoss || 0), 0),
    },
  };
}

export function generateDefaultAnnualReportNarratives(
  analytics: CorporateRiskAnalytics,
  institutionName: string,
  activeUnitsCount: number
) {
  const yearLabel = analytics.year === 0 ? 'Lintas Tahun' : `Tahun Buku ${analytics.year}`;
  const topCat = [...analytics.categorySummaries].sort((a, b) => b.avgResidual - a.avgResidual)[0];
  const topCause = [...analytics.cause5MSummaries].sort((a, b) => b.riskCount - a.riskCount)[0];
  const highestUnit = analytics.unitSummaries.find((u) => u.riskCount > 0);
  const top1Risk = analytics.topRisks[0];

  return {
    executiveSummaryNarrative:
      `Laporan Tahunan Manajemen Risiko ${institutionName} ${yearLabel} disusun oleh Satuan Pengawasan Intern (SPI) sebagai bentuk pertanggungjawaban tata kelola risiko korporat berdasarkan kerangka kerja ISO 31000:2018 dan Pedoman Pengawasan Intern Berbasis Risiko (SPIP Terpadu BPKP). Sepanjang periode pelaporan, tercatat ${analytics.totalRisks} peristiwa risiko korporat yang dipetakan dari seluruh unit kerja pemilik risiko.\n\n` +
      `Secara agregat, rata-rata skor risiko inheren tercatat sebesar ${analytics.avgInherent} (skala 25) dan berhasil diturunkan melalui pengendalian eksisting serta rencana perlakuan risiko menjadi rata-rata skor residual sebesar ${analytics.avgResidual} (tingkat reduksi eksposur risiko sebesar ${analytics.reductionRatePct}%). Namun demikian, masih terdapat ${analytics.aboveAppetiteCount} risiko (${analytics.aboveAppetitePct}%) dengan skor residual melampaui batas selera risiko korporat (>${analytics.appetiteThreshold}), termasuk ${analytics.criticalResidualCount} risiko berstatus Sangat Tinggi/Ekstrem dan ${analytics.highResidualCount} risiko berstatus Tinggi yang memerlukan pengawasan langsung Direksi dan pemantauan intensif SPI.`,

    contextAndGovernanceNarrative:
      `Penerapan Manajemen Risiko di ${institutionName} berlandaskan pada struktur tiga lini pertahanan (Three Lines Model). Lini Pertama dijalankan oleh ${activeUnitsCount} unit kerja pemilik risiko (Bidang Operasional, Keuangan, Umum, serta seluruh Unit Pelayanan Cabang), Lini Kedua diperkuat melalui koordinasi kepatuhan manajemen dan penilaian mandiri (RCSA), dan Lini Ketiga dijalankan secara independen oleh SPI.\n\n` +
      `Berdasarkan penetapan Kepala SPI bersama Direksi, ambang batas selera risiko (Risk Appetite Threshold) untuk ${yearLabel} ditetapkan pada skor residual maksimal ${analytics.appetiteThreshold} (zona Rendah hingga Sedang). Setiap risiko dengan skor residual di atas ${analytics.appetiteThreshold} dikategorikan melampaui batas toleransi sehingga wajib memiliki rencana mitigasi terukur dengan penanggung jawab (PIC) dan batas waktu penyelesaian yang ketat.`,

    categoryAndHeatmapAnalysis:
      `Pemetaan pada Matriks Risiko 5×5 memperlihatkan pergeseran profil risiko dari kondisi inheren menuju kondisi residual. Pada kategori SPIP, rata-rata skor residual tertinggi tercatat pada "${topCat?.category || 'Risiko Operasional'}" dengan rata-rata skor residual ${topCat?.avgResidual ?? 0} (${topCat?.riskCount ?? 0} peristiwa risiko, ${topCat?.aboveAppetiteCount ?? 0} di antaranya melewati selera risiko).\n\n` +
      `Ditinjau dari analisis akar masalah 5M (Man, Money, Material, Machine, Methode), faktor penyebab paling dominan adalah "${topCause?.causeCategory || 'MACHINE (Peralatan & Bangunan)'}" yang menyumbang ${topCause?.riskCount ?? 0} peristiwa risiko (${topCause?.pct ?? 0}% dari total portofolio risiko). Temuan pola akar masalah ini menegaskan perlunya perbaikan sistematis pada keandalan aset, ketertiban SOP, serta disiplin pengawasan operasional di lapangan.`,

    unitExposureAnalysis:
      `Evaluasi eksposur per Pemilik Risiko menunjukkan sebaran beban risiko yang bervariasi antar bidang dan unit pelayanan. Unit kerja dengan eksposur tertinggi pada ${yearLabel} adalah "${highestUnit?.unitName || '-'}" dengan ${highestUnit?.riskCount ?? 0} risiko teridentifikasi, skor residual puncak ${highestUnit?.maxResidual ?? 0}, dan ${highestUnit?.aboveAppetiteCount ?? 0} risiko di atas batas toleransi.\n\n` +
      `Pelaksanaan Penilaian Sendiri Risiko dan Pengendalian (RCSA) oleh unit kerja menghasilkan ${analytics.filteredRcsa.length} lembar penilaian mandiri yang diselaraskan dengan hasil telaah kualitas oleh SPI. Unit kerja dengan jumlah risiko residual tinggi dan efektivitas kontrol rendah menjadi prioritas utama pendampingan dan audit operasional.`,

    mitigationAndControlEvaluation:
      `Dari total ${analytics.totalRisks} risiko teridentifikasi, efektivitas pengendalian eksisting yang dinilai telah berjalan "Efektif" baru mencapai ${analytics.effectiveControlRatePct}% (${analytics.effectiveControlCount} risiko), sementara ${analytics.partialControlCount} risiko berstatus "Sebagian Efektif" dan ${analytics.ineffectiveControlCount} risiko masih "Tidak Efektif".\n\n` +
      `Dari sisi kualitas perumusan kaidah SPIP, sebanyak ${analytics.spiCompliantCount} risiko dinyatakan "Sesuai Kaidah", ${analytics.spiNeedsRevisionCount} risiko berstatus "Perlu Perbaikan Kaidah", dan ${analytics.spiPendingCount} risiko masih dalam proses telaah SPI. Adapun realisasi rencana mitigasi yang berstatus "Selesai" tercatat sebesar ${analytics.mitigationCompletionRatePct}% (${analytics.mitigationCompletedCount} dari ${analytics.totalRisks} risiko), dengan risiko utama yang menjadi perhatian puncak adalah: "${top1Risk?.event || 'Belum ada data peristiwa risiko'}".`,

    spipPkptIntegrationAnalysis:
      `Profil risiko tahunan terintegrasi langsung ke dalam siklus perencanaan anggaran (RKA), Program Kerja Pengawasan Tahunan (PKPT), serta evaluasi maturitas SPIP Terpadu BPKP. Pada ${yearLabel}, tercatat ${analytics.pkptSummary.totalPlans} penugasan PKPT berbasis risiko (realisasi selesai ${analytics.pkptSummary.realizationPct}%) dengan ${analytics.rkaSummary.linkedPkptCount} program terhubung ke data RKA senilai total pagu ${formatRupiahId(analytics.rkaSummary.totalBudget)}.\n\n` +
      `Pada hasil Self Assessment SPIP BPKP, skor maturitas SPIP tercatat sebesar ${analytics.spipIntegration.spipMaturityScore.toFixed(2)} (${analytics.spipIntegration.spipMaturityLevel}), dengan rata-rata skor Unsur 2 (Penilaian Risiko) sebesar ${analytics.spipIntegration.riskElementAvgScore.toFixed(2)}. Sebagai umpan balik risiko aktual, tercatat ${analytics.findingsSummary.totalFindings} temuan audit 5C dengan total potensi kerugian ${formatRupiahId(analytics.findingsSummary.totalPotentialLoss)} dan tingkat penyelesaian rekomendasi sebesar ${analytics.recommendationsSummary.completionPct}%.`,

    conclusionAndChallenges:
      `Kesimpulan Umum: Pengelolaan risiko korporat pada ${yearLabel} telah berjalan terstruktur dan memberikan dasar objektif bagi penentuan prioritas audit berbasis risiko (RBIA). Meskipun rata-rata skor risiko berhasil ditekan sebesar ${analytics.reductionRatePct}%, keberadaan ${analytics.aboveAppetiteCount} risiko di atas selera risiko dan efektivitas pengendalian eksisting sebesar ${analytics.effectiveControlRatePct}% masih menjadi ruang perbaikan krusial.\n\n` +
      `Tantangan Strategis: (1) Perlu percepatan penutupan mitigasi pada risiko berstatus Tinggi dan Sangat Tinggi/Ekstrem; (2) Masih terdapat unit kerja yang menganggap gejala/dampak sebagai peristiwa risiko sehingga perlu pembinaan kaidah 5M berkesinambungan; dan (3) Integrasi pengendalian pencegahan di lini pertama perlu diperketat guna menekan temuan berulang serta menjaga keandalan layanan kepada pelanggan.`,

    nextYearRoadmapNarrative:
      `Arah Kebijakan & Rencana Aksi Penguatan Manajemen Risiko Tahun ${
        (analytics.year || new Date().getFullYear()) + 1
      }:\n` +
      `1. Penajaman Risk Appetite & Risk Tolerance berbasis indikator kinerja utama (KPI) per bidang dan unit pelayanan cabang.\n` +
      `2. Pemantauan bulan berjalan wajib atas seluruh rencana aksi mitigasi risiko yang memiliki skor residual di atas ${analytics.appetiteThreshold} beserta verifikasi bukti dukung.\n` +
      `3. Penyelarasan penuh antara skor profil risiko unit, pagu RKA strategis, dan alokasi hari penugasan auditor di PKPT.\n` +
      `4. Peningkatan kapabilitas lini pertama melalui bimbingan teknis penyusunan Register Risiko & RCSA berstandar SPIP BPKP menuju level Maturitas SPIP minimal Level 4 (Terkelola & Terukur).`,
  };
}
