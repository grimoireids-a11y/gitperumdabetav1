import { GoogleGenAI } from '@google/genai';
import {
  ALLOWED_SUPER_USER_ROLES,
  FISCAL_MONTH_NAMES,
  buildFinanceReportParsePrompt,
  extractJsonFromModelText,
  FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION,
  normalizeParsedFinanceReport,
} from '../../src/lib/financeUploadNormalizer';

const ALLOWED_REPORT_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

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

  try {
    const {
      actorRole,
      actorName = 'Super User',
      targetYear,
      targetMonth,
      fileName = 'laporan-keuangan',
      mimeType = 'application/pdf',
      fileBase64,
      spreadsheetText,
    } = body || {};

    if (!ALLOWED_SUPER_USER_ROLES.includes(String(actorRole || '') as any)) {
      return res.status(403).json({
        error:
          'Akses ditolak. Fitur upload dan pembacaan laporan bulanan hanya tersedia untuk Super User (Kepala SPI / Admin Sistem).',
      });
    }

    const parsedYear = Number(targetYear);
    if (!Number.isInteger(parsedYear) || parsedYear < 2020 || parsedYear > 2100) {
      return res.status(400).json({ error: 'Tahun target tidak valid (harus 2020-2100).' });
    }

    const validMonth = FISCAL_MONTH_NAMES.find(
      (m) => m.toLowerCase() === String(targetMonth || '').trim().toLowerCase()
    );
    if (!validMonth) {
      return res.status(400).json({ error: 'Bulan target wajib dipilih (Januari - Desember).' });
    }

    const safeMime = String(mimeType || '').toLowerCase();
    if (!ALLOWED_REPORT_MIMES.has(safeMime)) {
      return res.status(400).json({ error: `Format file "${safeMime}" tidak didukung.` });
    }

    if (!fileBase64 && !spreadsheetText) {
      return res.status(400).json({ error: 'Konten file laporan kosong atau belum dipilih.' });
    }

    if (typeof fileBase64 === 'string' && fileBase64.length > 72_000_000) {
      return res.status(413).json({ error: 'Ukuran file melebihi batas maksimum 50 MB.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return res.status(503).json({
        error:
          'GEMINI_API_KEY belum dikonfigurasi pada server. Pembacaan otomatis PDF/Gambar membutuhkan kunci Gemini API aktif pada environment server, atau gunakan template Excel terstruktur.',
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    const promptText = buildFinanceReportParsePrompt({
      targetYear: parsedYear,
      targetMonth: validMonth,
      fileName: String(fileName).slice(0, 200),
      spreadsheetText:
        typeof spreadsheetText === 'string' ? spreadsheetText.slice(0, 450_000) : undefined,
    });

    const parts: any[] = [{ text: promptText }];
    let uploadedGeminiFileName: string | null = null;

    try {
      if (
        typeof fileBase64 === 'string' &&
        fileBase64.length > 0 &&
        (safeMime === 'application/pdf' || safeMime.startsWith('image/'))
      ) {
        const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
        if (cleanBase64.length <= 24_000_000) {
          parts.push({
            inlineData: {
              mimeType: safeMime,
              data: cleanBase64,
            },
          });
        } else {
          const binaryBuffer = Buffer.from(cleanBase64, 'base64');
          const fileBlob = new Blob([binaryBuffer], { type: safeMime });
          const uploadedFile = await ai.files.upload({
            file: fileBlob,
            config: {
              mimeType: safeMime,
              displayName: String(fileName).slice(0, 120),
            },
          });
          uploadedGeminiFileName = uploadedFile.name || null;
          if (!uploadedFile.uri) {
            throw new Error('Gagal mengunggah file besar ke layanan pembacaan dokumen.');
          }
          parts.push({
            fileData: {
              fileUri: uploadedFile.uri,
              mimeType: uploadedFile.mimeType || safeMime,
            },
          });
        }
      }

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                'Waktu pembacaan AI habis (>90 detik). Coba perkecil ukuran file atau gunakan template Excel.'
              )
            ),
          90_000
        )
      );

      const geminiPromise = ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
        },
      });

      const response: any = await Promise.race([geminiPromise, timeoutPromise]);
      const rawText = response?.text || '';
      if (!rawText.trim()) {
        return res.status(502).json({
          error:
            'Model tidak mengembalikan hasil pembacaan laporan. Pastikan file dapat dibaca (bukan terenkripsi password).',
        });
      }

      const rawJson = extractJsonFromModelText(rawText);
      const normalized = normalizeParsedFinanceReport({
        raw: rawJson,
        targetYear: parsedYear,
        targetMonth: validMonth,
        actorName: String(actorName),
        parserSource: 'gemini-4-hydrogen',
      });

      return res.status(200).json({ data: normalized });
    } finally {
      if (uploadedGeminiFileName) {
        ai.files.delete({ name: uploadedGeminiFileName }).catch(() => undefined);
      }
    }
  } catch (err: any) {
    console.error('Vercel parse-finance-report error:', err);
    return res.status(500).json({
      error: err?.message || 'Gagal membaca dokumen laporan keuangan secara otomatis.',
    });
  }
}
