import {
  KPIItem,
  KPIMeasurement,
  KPIPerspective,
  KPIPolarity,
  KPISettings,
  KPILevel,
} from '../types/audit';

export interface KPICalculationResult {
  rawAchievementPct: number;
  cappedAchievementPct: number;
  weightedScore: number;
  trafficLight: 'HIJAU' | 'KUNING' | 'MERAH';
  formulaNote: string;
}

export interface KPIPredicateInfo {
  code: 'A+' | 'A' | 'B' | 'C' | 'D';
  label: string;
  description: string;
  wasCappedByGating: boolean;
  failedGatingKpis: string[];
}

export interface PerspectiveScoreSummary {
  perspective: KPIPerspective;
  targetWeight: number;
  configuredWeight: number;
  kpiCount: number;
  measuredCount: number;
  avgAchievementPct: number;
  weightedScore: number;
}

export function roundNumber(val: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

export function getPolarityLabel(polarity: KPIPolarity): string {
  switch (polarity) {
    case 'MAXIMIZE':
      return 'Semakin Tinggi Semakin Baik';
    case 'MINIMIZE':
      return 'Semakin Rendah Semakin Baik';
    case 'STABILIZE':
      return 'Rentang Optimal (Band)';
    case 'ZERO_TARGET':
      return 'Target Nol (Zero Defect)';
    case 'MILESTONE':
      return 'Kualitatif / Milestone';
    default:
      return polarity;
  }
}

export function getLevelLabel(level: KPILevel): string {
  switch (level) {
    case 1:
      return 'Tingkat 1 : KPI Perusahaan';
    case 2:
      return 'Tingkat 2 : KPI Direktur';
    case 3:
      return 'Tingkat 3 : KPI Bidang';
    case 4:
      return 'Tingkat 4 : KPI SubBidang/Unit';
    case 5:
      return 'Tingkat 5 : KPI Individu Pegawai';
    default:
      return `Tingkat ${level}`;
  }
}

export function calculateKPIAchievement(
  kpi: Pick<
    KPIItem,
    | 'polarity'
    | 'targetValue'
    | 'rangeMin'
    | 'rangeMax'
    | 'zeroPenaltyStep'
    | 'weight'
    | 'capMaxPct'
    | 'floorMinPct'
  >,
  realizationValue: number,
  settings?: Partial<KPISettings>
): KPICalculationResult {
  const capMax = kpi.capMaxPct > 0 ? kpi.capMaxPct : settings?.defaultCapMaxPct ?? 120;
  const floorMin = kpi.floorMinPct >= 0 ? kpi.floorMinPct : settings?.defaultFloorMinPct ?? 0;
  const decimals = settings?.roundingDecimals ?? 2;
  const greenMin = settings?.greenThresholdPct ?? 95;
  const yellowMin = settings?.yellowThresholdPct ?? 80;

  let raw = 0;
  let formulaNote = '';

  switch (kpi.polarity) {
    case 'MAXIMIZE': {
      if (kpi.targetValue > 0) {
        raw = (realizationValue / kpi.targetValue) * 100;
        formulaNote = `Realisasi (${realizationValue}) / Target (${kpi.targetValue}) × 100%`;
      } else if (kpi.targetValue === 0) {
        raw = realizationValue >= 0 ? 100 : 0;
        formulaNote = 'Target 0 terpenuhi';
      } else {
        raw = 0;
        formulaNote = 'Target tidak valid';
      }
      break;
    }

    case 'MINIMIZE': {
      // Aman dari division-by-zero jika realisasi <= 0
      if (realizationValue <= 0) {
        raw = kpi.targetValue >= 0 ? capMax : floorMin;
        formulaNote = `Realisasi ≤ 0 (optimal maksimal, dibatasi ${capMax}%)`;
      } else if (kpi.targetValue <= 0) {
        raw = realizationValue === 0 ? 100 : Math.max(floorMin, 100 - realizationValue * 20);
        formulaNote = 'Target ≤ 0 menggunakan penalti deviasi';
      } else {
        raw = (kpi.targetValue / realizationValue) * 100;
        formulaNote = `Target (${kpi.targetValue}) / Realisasi (${realizationValue}) × 100%`;
      }
      break;
    }

    case 'ZERO_TARGET': {
      const step = kpi.zeroPenaltyStep && kpi.zeroPenaltyStep > 0 ? kpi.zeroPenaltyStep : 20;
      if (realizationValue <= 0) {
        raw = 100;
        formulaNote = 'Zero-Defect tercapai (0 kejadian = 100%)';
      } else {
        raw = Math.max(floorMin, 100 - realizationValue * step);
        formulaNote = `100% - (${realizationValue} kejadian × penalti ${step}%)`;
      }
      break;
    }

    case 'STABILIZE': {
      const minBand = kpi.rangeMin ?? kpi.targetValue * 0.9;
      const maxBand = kpi.rangeMax ?? kpi.targetValue * 1.1;
      if (realizationValue >= minBand && realizationValue <= maxBand) {
        raw = 100;
        formulaNote = `Berada dalam rentang optimal [${minBand} – ${maxBand}] = 100%`;
      } else if (realizationValue < minBand) {
        raw = minBand > 0 ? Math.max(floorMin, (realizationValue / minBand) * 100) : floorMin;
        formulaNote = `Di bawah batas bawah (${realizationValue} < ${minBand})`;
      } else {
        raw = realizationValue > 0 ? Math.max(floorMin, (maxBand / realizationValue) * 100) : floorMin;
        formulaNote = `Melampaui batas atas (${maxBand} / ${realizationValue} × 100%)`;
      }
      break;
    }

    case 'MILESTONE': {
      if (kpi.targetValue > 0) {
        raw = (realizationValue / kpi.targetValue) * 100;
        formulaNote = `Skor/Progres (${realizationValue}) / Target (${kpi.targetValue}) × 100%`;
      } else {
        raw = 0;
        formulaNote = 'Target milestone belum ditetapkan';
      }
      break;
    }
  }

  const rawRounded = roundNumber(Math.max(0, raw), decimals);
  const capped = roundNumber(Math.min(capMax, Math.max(floorMin, raw)), decimals);
  const weightedScore = roundNumber((capped * (kpi.weight || 0)) / 100, decimals);

  const trafficLight: 'HIJAU' | 'KUNING' | 'MERAH' =
    capped >= greenMin ? 'HIJAU' : capped >= yellowMin ? 'KUNING' : 'MERAH';

  return {
    rawAchievementPct: rawRounded,
    cappedAchievementPct: capped,
    weightedScore,
    trafficLight,
    formulaNote,
  };
}

export function getFrequencyLabel(frequency?: string): string {
  if (frequency === 'Triwulanan') return 'Bulan Berjalan';
  return frequency || 'Bulanan';
}

export function getPeriodLabel(
  periodType: 'Bulanan' | 'Triwulanan' | 'Tahunan',
  periodIndex: number,
  year: number
): string {
  if (periodType === 'Tahunan') return `Tahunan ${year}`;
  if (periodType === 'Triwulanan') {
    const spans = ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Okt–Des'];
    const span = spans[Math.max(0, Math.min(3, periodIndex - 1))];
    return `Bulan Berjalan (${span} ${year})`;
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Agu',
    'Sep',
    'Okt',
    'Nov',
    'Des',
  ];
  return `${months[Math.max(0, Math.min(11, periodIndex - 1))]} ${year}`;
}

/**
 * Menghitung realisasi Year-to-Date (YTD) atau nilai periode terpilih
 * sesuai tipe akumulasi masing-masing KPI (CUMULATIVE, AVERAGE, LAST_VALUE).
 */
export function resolveKpiPeriodMeasurement(
  kpi: KPIItem,
  measurements: KPIMeasurement[],
  periodType: 'Bulanan' | 'Triwulanan' | 'Tahunan',
  periodIndex: number,
  settings?: Partial<KPISettings>
): {
  exactMeasurement?: KPIMeasurement;
  ytdRealizationValue?: number;
  ytdCalc?: KPICalculationResult;
  periodsReported: number;
} {
  const matching = measurements
    .filter((m) => m.kpiId === kpi.id && m.year === kpi.year && m.periodType === periodType)
    .sort((a, b) => a.periodIndex - b.periodIndex);

  const exact = matching.find((m) => m.periodIndex === periodIndex);
  const upToPeriod = matching.filter((m) => m.periodIndex <= periodIndex);

  if (upToPeriod.length === 0) {
    return { exactMeasurement: exact, periodsReported: 0 };
  }

  let ytdVal = upToPeriod[upToPeriod.length - 1].realizationValue;
  if (kpi.accumulationType === 'CUMULATIVE') {
    ytdVal = upToPeriod.reduce((sum, item) => sum + (item.realizationValue || 0), 0);
  } else if (kpi.accumulationType === 'AVERAGE') {
    ytdVal =
      upToPeriod.reduce((sum, item) => sum + (item.realizationValue || 0), 0) /
      upToPeriod.length;
  }

  const roundedYtdVal = roundNumber(ytdVal, settings?.roundingDecimals ?? 2);
  const ytdCalc = calculateKPIAchievement(kpi, roundedYtdVal, settings);

  return {
    exactMeasurement: exact,
    ytdRealizationValue: roundedYtdVal,
    ytdCalc,
    periodsReported: upToPeriod.length,
  };
}

export function evaluateOverallPredicate(
  totalWeightedScore: number,
  kpis: KPIItem[],
  resolvedAchievements: Map<string, KPICalculationResult>,
  settings?: Partial<KPISettings>
): { effectiveScore: number; predicate: KPIPredicateInfo } {
  const enforceGating = settings?.enforceGatingCap ?? true;
  const gatingCapScore = settings?.gatingMaxTotalScore ?? 84.99;

  const failedGatingKpis: string[] = [];
  if (enforceGating) {
    kpis.forEach((k) => {
      if (!k.isGating) return;
      const calc = resolvedAchievements.get(k.id);
      if (!calc) return;
      const minThreshold = k.gatingThresholdPct ?? 95;
      if (calc.cappedAchievementPct < minThreshold) {
        failedGatingKpis.push(`${k.code} ${k.name} (${calc.cappedAchievementPct}% < ${minThreshold}%)`);
      }
    });
  }

  const wasCappedByGating = failedGatingKpis.length > 0 && totalWeightedScore > gatingCapScore;
  const effectiveScore = wasCappedByGating
    ? roundNumber(gatingCapScore, settings?.roundingDecimals ?? 2)
    : roundNumber(totalWeightedScore, settings?.roundingDecimals ?? 2);

  let code: KPIPredicateInfo['code'] = 'D';
  let label = 'Kurang';
  let description = 'Capaian kinerja belum memenuhi standar minimal. Wajib evaluasi & rencana aksi menyeluruh.';

  if (effectiveScore >= 105) {
    code = 'A+';
    label = 'Istimewa';
    description = 'Melampaui target strategis secara merata dengan kepatuhan mutu dan tata kelola terjaga.';
  } else if (effectiveScore >= 95) {
    code = 'A';
    label = 'Sangat Baik';
    description = 'Sasaran strategis tercapai optimal sesuai target Rencana Bisnis dan RKA.';
  } else if (effectiveScore >= 85) {
    code = 'B';
    label = 'Baik';
    description = 'Kinerja berjalan baik, namun terdapat beberapa indikator yang memerlukan akselerasi.';
  } else if (effectiveScore >= 75) {
    code = 'C';
    label = 'Cukup';
    description = 'Pencapaian masih di bawah target optimal dan memerlukan tindakan korektif terstruktur.';
  }

  return {
    effectiveScore,
    predicate: {
      code,
      label,
      description,
      wasCappedByGating,
      failedGatingKpis,
    },
  };
}
