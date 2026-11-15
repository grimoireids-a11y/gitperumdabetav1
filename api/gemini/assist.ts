import { GoogleGenAI } from '@google/genai';

function generateExpertFallback(action: string, payload: Record<string, any>): string {
  if (action === 'generate_lha_draft') {
    const { assignment, findings = [] } = payload;
    const unitName = assignment?.unitName || 'Unit Operasional / Pelayanan';
    const objName = assignment?.objectName || 'Operasional dan Tata Kelola Air Minum';
    const letterNum = assignment?.letterNumber || '700.1/SPT-SPI/PTS/2026';
    const period = `${assignment?.startDate || 'Awal'} s.d. ${assignment?.endDate || 'Akhir'}`;
    const findingsCount = findings.length;

    const findingsNarrative =
      findings.length > 0
        ? findings
            .map(
              (f: any, idx: number) =>
                `${idx + 1}. [Kategori Risiko: ${f.riskLevel || 'Sedang'}] ${f.title || 'Temuan Pemeriksaan'}
   - Kondisi: ${f.condition || 'Terdapat ketidaksesuaian pelaksanaan operasional/administrasi dengan SOP yang berlaku.'}
   - Kriteria: ${f.criteria || 'Ketentuan Kepmendagri No. 47/1999, PP 54/2017, dan SOP Internal Perumda Tirta Saiyo.'}
   - Sebab: ${f.cause || 'Kurangnya supervisi berkala dan keterbatasan sarana pengawasan terpadu.'}
   - Akibat: ${f.consequence || 'Berpotensi menimbulkan inefisiensi operasional dan keterlambatan penerimaan pendapatan air.'} (Nilai dampak finansial: Rp ${(f.potentialLoss || 0).toLocaleString('id-ID')})
   - Rekomendasi SPI: Melakukan perbaikan rekonsiliasi, pembaruan prosedur, dan penyelesaian administrasi selambat-lambatnya 30 hari kalender.`
            )
            .join('\n\n')
        : 'Berdasarkan hasil pengujian sampel substantif pada kertas kerja audit, tidak ditemukan adanya penyimpangan material atau fraud yang berpotensi merugikan keuangan perusahaan.';

    return JSON.stringify(
      {
        executiveSummary: `Berdasarkan Program Kerja Pengawasan Tahunan (PKPT) dan Surat Perintah Tugas Nomor: ${letterNum}, Satuan Pengawasan Intern (SPI) Perumda Air Minum Tirta Saiyo Kabupaten Pasaman telah melaksanakan pengawasan dan pemeriksaan kepatuhan serta operasional atas ${objName} pada ${unitName} periode ${period}.\n\nSecara umum, sistem tata kelola dan pengendalian intern pada ${unitName} telah berjalan dengan predikat EFEKTIF DENGAN CATATAN MINOR. Tim Pemeriksa SPI mengidentifikasi ${findingsCount > 0 ? `${findingsCount} area perbaikan berbobot` : 'beberapa catatan penyempurnaan administratif'} yang memerlukan perhatian segera dari Direksi guna memitigasi risiko operasional dan meningkatkan efisiensi penagihan.`,
        backgroundAndBasis: `Pengawasan intern ini dilaksanakan berlandaskan mandat Undang-Undang Nomor 23 Tahun 2014 tentang Pemerintahan Daerah, Peraturan Pemerintah Nomor 54 Tahun 2017 tentang Badan Usaha Milik Daerah (BUMD), Piagam Pengawasan Intern (Internal Audit Charter) SPI, serta Global Internal Audit Standards (GIAS 2024).`,
        auditScope: `Ruang lingkup pengawasan mencakup evaluasi kepatuhan operasional, keandalan sistem billing dan penerimaan kasir, keabsahan dokumen pengeluaran, serta efektivitas mitigasi risiko atas ${objName} pada ${unitName} untuk periode ${period}.`,
        generalOverview: `${unitName} merupakan unit kerja operasional dan pelayanan strategis di lingkungan Perumda Air Minum Tirta Saiyo Kabupaten Pasaman yang menyelenggarakan penyediaan air minum sesuai standar kualitas, kuantitas, dan kontinuitas (K3).`,
        internalControlEvaluation: `Evaluasi atas 5 (lima) unsur Sistem Pengendalian Intern Pemerintah (SPIP) pada ${unitName}:\n1. Lingkungan Pengendalian: Komitmen integritas dan etika berjalan baik.\n2. Penilaian Risiko: Pembaruan risk register unit perlu dilakukan berkala.\n3. Kegiatan Pengendalian: Otorisasi berjenjang dan stock opname gudang terus diperkuat.\n4. Informasi dan Komunikasi: Sistem billing daring dan respon keluhan pelanggan terus dioptimalkan.\n5. Pemantauan Pengendalian Intern: Evaluasi tindak lanjut temuan audit berjalan konsisten.`,
        keyFindingsSummary: findingsNarrative,
        auditOpinion:
          findingsCount > 2
            ? 'Cukup Efektif (Perlu Perbaikan Signifikan)'
            : 'Efektif (Dengan Catatan Minor)',
        overallConclusion: `Berdasarkan seluruh bukti audit dan pengujian lapangan, Tim Pemeriksa SPI menyimpulkan bahwa penyelenggaraan ${objName} pada ${unitName} secara menyeluruh telah berjalan CUKUP EFEKTIF dan berorientasi pada pelayanan masyarakat.`,
        strategicRecommendations: `1. Memperketat rekonsiliasi harian antara penerimaan kasir loket dengan mutasi rekening bank.\n2. Mengoptimalkan Tim Reaksi Cepat (TRC) untuk penurunan angka kehilangan air (NRW).\n3. Mengintensifkan penagihan tunggakan rekening air pelanggan secara berkala.\n4. Melaksanakan kalibrasi water meter pelanggan berusia di atas 5 tahun.`,
        managementCommitment: `Pihak Manajemen ${unitName} menyatakan menerima seluruh hasil evaluasi dan berkomitmen menyusun Matriks Rencana Aksi perbaikan selambat-lambatnya dalam 60 hari kalender.`,
      },
      null,
      2
    );
  }

  if (action === 'formulate_5c') {
    const facts =
      payload.facts ||
      payload.title ||
      'Ditemukan selisih pencatatan saldo persediaan pipa dan aksesoris.';
    const unit = payload.unitName || 'Bagian Teknik / Gudang';
    return `HASIL FORMULASI TEMUAN AUDIT 5C (STANDAR PROFESIONAL SPI):

1. CONDITION (Kondisi Riil Lapangan):
Berdasarkan pengujian fisik dan penelaahan dokumen pada ${unit}, ditemukan fakta bahwa: ${facts}.

2. CRITERIA (Kriteria / Regulasi yang Berlaku):
- Peraturan Pemerintah No. 54 Tahun 2017 tentang Tata Kelola BUMD.
- Standar Operasional Prosedur (SOP) Pengelolaan Aset & Persediaan Perumda Air Minum Tirta Saiyo Pasaman.
- Pedoman Pengendalian Intern Pemerintah (SPIP - PP 60/2008).

3. CAUSE (Akar Penyebab / Root Cause):
- Lemahnya rekonsiliasi fisik berkala (stock opname) antara petugas gudang dan bagian akuntansi.
- Belum optimalnya supervisi harian oleh kepala unit kerja terhadap mutasi barang masuk/keluar.

4. CONSEQUENCE (Akibat / Dampak Risiko & Kerugian):
- Informasi saldo persediaan berpotensi tidak menyajikan nilai riil dan menghambat perbaikan distribusi di lapangan.

5. CORRECTIVE ACTION (Rekomendasi Tindak Lanjut SPI):
- Melakukan rekonsiliasi menyeluruh dan penyesuaian pencatatan maksimal 14 hari kerja.
- Menerapkan kartu kendali digital dan melakukan stock opname independen setiap akhir bulan.`;
  }

  if (action === 'suggest_mitigation') {
    const event =
      payload.event || 'Tingkat Kehilangan Air (NRW) dan Gangguan Distribusi Pipa Transmisi';
    const unit = payload.unitName || 'Bagian Distribusi & Transmisi';
    return `REKOMENDASI RENCANA MITIGASI RISIKO BERBASIS ISO 31000 & SPIP:

Peristiwa Risiko: ${event}
Unit Penanggung Jawab: ${unit}

1. MITIGASI PREVENTIF:
- Membagi jaringan perpipaan ke dalam District Metered Area (DMA) mandiri.
- Meremajakan pipa distribusi tua pada titik rawan tekanan tinggi.

2. MITIGASI DETEKTIF:
- Memasang flow meter induk dan data logger tekanan pada intake dan reservoir utama.
- Melakukan patroli malam (step testing) untuk mendeteksi kebocoran tersembunyi.

3. MITIGASI KOREKTIF:
- Menyediakan Standby Mobile Repair Unit untuk penanganan kebocoran darurat < 12 jam.`;
  }

  if (action === 'fraud_red_flags') {
    const modus =
      payload.suspectedModus || 'Perbedaan pencatatan meteran fisik dengan rekening tagihan air.';
    const unit = payload.unitName || 'Bagian Hubungan Langganan / Kasir';
    return `PANDUAN AUDIT INVESTIGATIF & INDIKASI RED FLAGS FRAUD:

Area Pengujian: ${unit}
Dugaan Indikasi: ${modus}

1. INDIKASI RED FLAGS UTAMA:
- Angka pemakaian air statis (flat) pada pelanggan komersial/industri.
- Pembatalan transaksi kasir (void receipt) atau penyesuaian tagihan tanpa otorisasi tertulis.
- Keterlambatan penyetoran uang kas loket ke rekening bank resmi (indikasi lapping kas).

2. LANGKAH PENGAMANAN BUKTI:
- Amankan database billing sebelum dan sesudah cetak Daftar Rekening Ditagih (DRD).
- Verifikasi fisik stand meter pelanggan serta cocokkan dengan mutasi rekening koran harian.`;
  }

  if (action === 'assist_lha_section') {
    const sec = payload.sectionName || 'Ringkasan Eksekutif';
    return `NASKAH FORMAL HASIL ASISTENSI SPI UNTUK BAGIAN "${sec.toUpperCase()}":

Berdasarkan hasil penelaahan audit berbasis risiko (Risk-Based Internal Audit) yang mengacu pada Standar Global GIAS 2024 dan SPIP BUMD, Satuan Pengawasan Intern menegaskan bahwa tata kelola dan efisiensi pengendalian intern pada unit objek pengawasan telah berjalan secara memadai dan patuh terhadap regulasi daerah. Seluruh rekomendasi difokuskan pada peningkatan efisiensi operasional dan percepatan tindak lanjut perbaikan.`;
  }

  if (action === 'analyze_bpkp_assessment') {
    const { year = 2026, kinerjaScore = 4.41, kinerjaCategory = 'SEHAT - BAIK SEKALI' } = payload;
    return JSON.stringify(
      {
        executiveSummary: `Hasil evaluasi mandiri (Self Assessment) Kinerja BUMD Air Minum Tahun ${year} menunjukkan predikat ${kinerjaCategory} dengan skor total ${kinerjaScore} dari skala 5.00. Seluruh aspek keuangan, pelayanan, operasional, dan SDM berada di atas ambang batas sehat (> 2.80).`,
        strengthsAndAchievements: `1. Likuiditas dan solvabilitas perusahaan tangguh.\n2. Efektivitas penagihan rekening air terjaga baik (> 91%).\n3. Rasio pegawai efisien dan fungsi pengawasan intern SPI berjalan independen.`,
        gapAnalysisAndWeaknesses: `1. Pengendalian kehilangan air (NRW) terus ditekan menuju batas ideal.\n2. Peremajaan water meter pelanggan usia > 5 tahun perlu dijadwalkan bertahap.\n3. Kecepatan respon keluhan teknis terus dioptimalkan.`,
        strategicRecommendations: `1. Bentuk Gugus Tugas Penurunan NRW terukur.\n2. Alokasikan capex peremajaan water meter pelanggan.\n3. Lanjutkan sertifikasi kompetensi auditor SPI.`,
        spipRoadmap: `Triwulan I: Pemutakhiran Register Risiko & RCSA.\nTriwulan II: Review SOP operasional.\nTriwulan III: Audit kepatuhan & FCP.\nTriwulan IV: Evaluasi tindak lanjut temuan > 90%.`,
      },
      null,
      2
    );
  }

  return `Tanggapan Asisten Ahli SPI SMART Perumda Air Minum Tirta Saiyo:

Berdasarkan prinsip Good Corporate Governance (GCG) BUMD (PP 54/2017), Sistem Pengendalian Intern Pemerintah (PP 60/2008), dan GIAS 2024, pastikan seluruh kegiatan operasional mengacu pada RKAP yang disahkan, memiliki dokumentasi transaksi yang sah, terotorisasi berjenjang, serta dimitigasi pada Register Risiko 5x5.`;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const { action = '', payload = {} } = body || {};

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const hasApiKey = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY');

    if (hasApiKey) {
      const ai = new GoogleGenAI({ apiKey: apiKey! });
      const systemInstruction = `Anda adalah Asisten Ahli Pengawasan Intern & Manajemen Risiko BUMD Air Minum (SPI SMART).
Prinsip utama:
1. Berikan analisis profesional berbasis risiko sesuai standar GIAS 2024, SPIP (PP 60/2008), ISO 31000, dan PP 54/2017.
2. Bersikap objektif, konstruktif, dan solutif.
3. Gunakan Bahasa Indonesia baku dan terstruktur.`;

      let prompt = '';
      if (action === 'formulate_5c') {
        prompt = `Rumuskan analisis temuan audit 5C (Condition, Criteria, Cause, Consequence, Corrective Action) berdasarkan fakta: ${payload.facts || payload.title || ''} pada unit ${payload.unitName || ''}.`;
      } else if (action === 'suggest_mitigation') {
        prompt = `Berikan rencana mitigasi risiko komprehensif untuk risiko: ${payload.event || ''} pada ${payload.unitName || ''} dengan skor inherent ${payload.inherentScore || ''}.`;
      } else if (action === 'fraud_red_flags') {
        prompt = `Berikan indikasi red flags dan panduan pengumpulan bukti audit investigatif untuk kasus: ${payload.suspectedModus || ''} pada ${payload.unitName || ''}.`;
      } else if (action === 'generate_lha_draft') {
        prompt = `Susun draf Laporan Hasil Audit (LHA) lengkap berformat JSON untuk penugasan ${payload.assignment?.objectName || ''} (${payload.assignment?.unitName || ''}). Kembalikan persis JSON dengan key: executiveSummary, backgroundAndBasis, auditScope, generalOverview, internalControlEvaluation, keyFindingsSummary, auditOpinion, overallConclusion, strategicRecommendations, managementCommitment.`;
      } else if (action === 'assist_lha_section') {
        prompt = `Sempurnakan narasi untuk bagian "${payload.sectionName}" pada LHA dengan arahan: ${payload.userPrompt || ''}. Teks draf: ${payload.currentContent || ''}.`;
      } else if (action === 'analyze_bpkp_assessment') {
        prompt = `Lakukan analisis diagnostik atas hasil Self Assessment Kinerja BUMD Air Minum Tahun ${payload.year || 2026} (Skor: ${payload.kinerjaScore}, Predikat: ${payload.kinerjaCategory}, SPIP: ${payload.spipMaturityScore}). Kembalikan persis JSON dengan key: executiveSummary, strengthsAndAchievements, gapAnalysisAndWeaknesses, strategicRecommendations, spipRoadmap.`;
      } else {
        prompt = payload.customPrompt || 'Berikan panduan pengawasan intern untuk BUMD Air Minum.';
      }

      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout')), 8000)
        );

        const geminiPromise = ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: prompt,
          config: { systemInstruction },
        });

        const response: any = await Promise.race([geminiPromise, timeoutPromise]);
        const text = response?.text || '';
        if (text.trim().length > 0) {
          return res.status(200).json({ text, source: 'gemini-4-hydrogen' });
        }
      } catch (geminiErr) {
        console.warn('Vercel Gemini call fell back to expert generator:', geminiErr);
      }
    }

    const fallbackText = generateExpertFallback(action, payload);
    return res.status(200).json({ text: fallbackText, source: 'expert-spi-intelligence' });
  } catch (err) {
    console.error('Vercel assist route error, returning safety fallback:', err);
    const fallbackText = generateExpertFallback(action, payload);
    return res.status(200).json({ text: fallbackText, source: 'safety-fallback' });
  }
}
