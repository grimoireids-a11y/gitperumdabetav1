import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  ALLOWED_SUPER_USER_ROLES,
  FISCAL_MONTH_NAMES,
  ReportAccountingDiagnostics,
  buildFinanceReportParsePrompt,
  buildFinanceReportVerificationPrompt,
  computeReportAccountingDiagnostics,
  extractJsonFromModelText,
  FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION,
  normalizeParsedFinanceReport,
} from './financeUploadNormalizer';

export const MAX_FIN_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export const ALLOWED_FINANCE_REPORT_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

function deriveTokenKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(`pdam-fin-upload:${secret}`).digest();
}

function encryptUploadUrl(uploadUrl: string, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveTokenKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(uploadUrl, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function decryptUploadUrl(token: string, secret: string): string {
  const raw = Buffer.from(token, 'base64url');
  if (raw.length < 29) {
    throw new Error('Token sesi unggahan tidak valid.');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveTokenKey(secret), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  if (!decrypted.startsWith('https://generativelanguage.googleapis.com/upload/')) {
    throw new Error('URL sesi unggahan tidak valid.');
  }
  return decrypted;
}

export interface FinanceParseRouteResult {
  status: number;
  json: Record<string, any>;
}

export async function handleParseFinanceReportAction(
  body: any,
  aiClient?: GoogleGenAI
): Promise<FinanceParseRouteResult> {
  let uploadedGeminiFileNameToDelete: string | null = null;
  let activeAiClient: GoogleGenAI | null = aiClient || null;

  try {
    const {
      action = 'parse',
      actorRole,
      actorName = 'Super User',
      targetYear,
      targetMonth,
      fileName = 'laporan-keuangan',
      mimeType = 'application/pdf',
      fileSize = 0,
      sessionToken,
      chunkBase64,
      offset = 0,
      isFinalChunk = false,
      geminiFileUri,
      geminiFileName,
      fileBase64,
      spreadsheetText,
    } = body || {};

    if (!ALLOWED_SUPER_USER_ROLES.includes(String(actorRole || '') as any)) {
      return {
        status: 403,
        json: {
          error:
            'Akses ditolak. Fitur upload dan pembacaan laporan bulanan hanya tersedia untuk Super User (Kepala SPI / Admin Sistem).',
        },
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return {
        status: 503,
        json: {
          error:
            'GEMINI_API_KEY belum dikonfigurasi pada server. Pembacaan otomatis PDF/Gambar membutuhkan kunci Gemini API aktif pada environment server, atau gunakan template Excel terstruktur.',
        },
      };
    }

    if (!activeAiClient) {
      activeAiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }

    const safeMime = String(mimeType || '').toLowerCase();

    // =========================================================================
    // ACTION 1: START STATELESS GEMINI RESUMABLE UPLOAD SESSION
    // =========================================================================
    if (action === 'upload_start') {
      if (!ALLOWED_FINANCE_REPORT_MIMES.has(safeMime)) {
        return {
          status: 400,
          json: { error: `Format file "${safeMime}" tidak didukung.` },
        };
      }
      const totalBytes = Number(fileSize);
      if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
        return { status: 400, json: { error: 'Ukuran file tidak valid.' } };
      }
      if (totalBytes > MAX_FIN_UPLOAD_BYTES) {
        return {
          status: 413,
          json: { error: 'Ukuran file melebihi batas maksimum 50 MB.' },
        };
      }

      const startRes = await fetch(
        'https://generativelanguage.googleapis.com/upload/v1beta/files',
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(Math.floor(totalBytes)),
            'X-Goog-Upload-Header-Content-Type': safeMime,
            'Content-Type': 'application/json',
            'User-Agent': 'aistudio-build',
          },
          body: JSON.stringify({
            file: {
              display_name: String(fileName || 'laporan-keuangan').slice(0, 120),
            },
          }),
        }
      );

      if (!startRes.ok) {
        const errText = await startRes.text().catch(() => '');
        return {
          status: startRes.status,
          json: {
            error: `Gagal memulai sesi unggahan dokumen (${startRes.status}): ${errText.slice(0, 180)}`,
          },
        };
      }

      const uploadUrl = startRes.headers.get('x-goog-upload-url');
      if (!uploadUrl || !uploadUrl.startsWith('https://generativelanguage.googleapis.com/upload/')) {
        return {
          status: 502,
          json: { error: 'Server penyimpanan tidak mengembalikan URL unggahan yang valid.' },
        };
      }

      const token = encryptUploadUrl(uploadUrl, apiKey);
      return {
        status: 200,
        json: { sessionToken: token },
      };
    }

    // =========================================================================
    // ACTION 2: UPLOAD A SINGLE <= 1 MB CHUNK STATELESSLY TO GEMINI FILES API
    // =========================================================================
    if (action === 'upload_chunk') {
      if (typeof sessionToken !== 'string' || !sessionToken) {
        return { status: 400, json: { error: 'Token sesi unggahan tidak ditemukan.' } };
      }
      if (typeof chunkBase64 !== 'string' || !chunkBase64) {
        return { status: 400, json: { error: 'Data potongan file kosong.' } };
      }

      const uploadUrl = decryptUploadUrl(sessionToken, apiKey);
      const chunkBuf = Buffer.from(chunkBase64, 'base64');
      if (chunkBuf.length === 0) {
        return { status: 400, json: { error: 'Potongan file biner kosong.' } };
      }
      if (chunkBuf.length > 2 * 1024 * 1024) {
        return { status: 413, json: { error: 'Ukuran potongan melebihi 2 MB.' } };
      }

      const numericOffset = Number(offset);
      if (!Number.isInteger(numericOffset) || numericOffset < 0) {
        return { status: 400, json: { error: 'Offset unggahan tidak valid.' } };
      }

      const command = isFinalChunk ? 'upload, finalize' : 'upload';
      const chunkRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Length': String(chunkBuf.length),
          'X-Goog-Upload-Offset': String(numericOffset),
          'X-Goog-Upload-Command': command,
          'User-Agent': 'aistudio-build',
        },
        body: new Uint8Array(chunkBuf),
      });

      if (!chunkRes.ok) {
        const errText = await chunkRes.text().catch(() => '');
        return {
          status: chunkRes.status,
          json: {
            error: `Gagal meneruskan potongan file ke server (${chunkRes.status}): ${errText.slice(0, 180)}`,
          },
        };
      }

      if (!isFinalChunk) {
        return {
          status: 200,
          json: { ok: true, receivedBytes: chunkBuf.length },
        };
      }

      const finalizedJson: any = await chunkRes.json().catch(() => ({}));
      const fileMeta = finalizedJson?.file || finalizedJson;
      if (!fileMeta?.uri || !fileMeta?.name) {
        return {
          status: 502,
          json: { error: 'Unggahan selesai, tetapi metadata file tidak diterima.' },
        };
      }

      return {
        status: 200,
        json: {
          ok: true,
          finalized: true,
          geminiFileUri: fileMeta.uri,
          geminiFileName: fileMeta.name,
          geminiMimeType: fileMeta.mimeType || safeMime,
        },
      };
    }

    // =========================================================================
    // ACTION 3: PARSE REPORT (FROM geminiFileUri, fileBase64, OR spreadsheetText)
    // =========================================================================
    const parsedYear = Number(targetYear);
    if (!Number.isInteger(parsedYear) || parsedYear < 2020 || parsedYear > 2100) {
      return {
        status: 400,
        json: { error: 'Tahun target tidak valid (harus 2020-2100).' },
      };
    }

    const validMonth = FISCAL_MONTH_NAMES.find(
      (m) => m.toLowerCase() === String(targetMonth || '').trim().toLowerCase()
    );
    if (!validMonth) {
      return {
        status: 400,
        json: { error: 'Bulan target wajib dipilih (Januari - Desember).' },
      };
    }

    if (!ALLOWED_FINANCE_REPORT_MIMES.has(safeMime)) {
      return {
        status: 400,
        json: { error: `Format file "${safeMime}" tidak didukung.` },
      };
    }

    if (!geminiFileUri && !fileBase64 && !spreadsheetText) {
      return {
        status: 400,
        json: { error: 'Konten file laporan kosong atau belum dipilih.' },
      };
    }

    if (typeof geminiFileName === 'string' && geminiFileName.startsWith('files/')) {
      uploadedGeminiFileNameToDelete = geminiFileName;
    }

    const promptText = buildFinanceReportParsePrompt({
      targetYear: parsedYear,
      targetMonth: validMonth,
      fileName: String(fileName).slice(0, 200),
      spreadsheetText:
        typeof spreadsheetText === 'string' ? spreadsheetText.slice(0, 450_000) : undefined,
    });

    const parts: any[] = [{ text: promptText }];

    if (typeof geminiFileUri === 'string' && geminiFileUri.length > 0) {
      if (!geminiFileUri.startsWith('https://generativelanguage.googleapis.com/')) {
        return { status: 400, json: { error: 'URI file dokumen tidak valid.' } };
      }

      if (uploadedGeminiFileNameToDelete) {
        let fileInfo = await activeAiClient.files.get({ name: uploadedGeminiFileNameToDelete });
        let attempts = 0;
        while (fileInfo.state === 'PROCESSING' && attempts < 15) {
          await new Promise((r) => setTimeout(r, 2000));
          fileInfo = await activeAiClient.files.get({ name: uploadedGeminiFileNameToDelete });
          attempts++;
        }
        if (fileInfo.state === 'FAILED') {
          throw new Error('Dokumen gagal diproses di layanan pembacaan file (status FAILED).');
        }
      }

      parts.push({
        fileData: {
          fileUri: geminiFileUri,
          mimeType: safeMime,
        },
      });
    } else if (
      typeof fileBase64 === 'string' &&
      fileBase64.length > 0 &&
      (safeMime === 'application/pdf' || safeMime.startsWith('image/'))
    ) {
      const cleanBase64 = fileBase64.replace(/^data:[^;]+;base64,/, '');
      const buf = Buffer.from(cleanBase64, 'base64');
      if (buf.length > MAX_FIN_UPLOAD_BYTES) {
        return {
          status: 413,
          json: { error: 'Ukuran file melebihi batas maksimum 50 MB.' },
        };
      }
      parts.push({
        inlineData: {
          mimeType: safeMime,
          data: cleanBase64,
        },
      });
    }

    const pass1StartedAt = Date.now();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              'Waktu pembacaan AI habis (>120 detik). Jika PDF hasil scan sangat besar, coba kompres atau bagi per beberapa halaman.'
            )
          ),
        120_000
      )
    );

    const geminiPromise = activeAiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      },
    });

    const response: any = await Promise.race([geminiPromise, timeoutPromise]);
    const rawText = response?.text || '';
    if (!rawText.trim()) {
      return {
        status: 502,
        json: {
          error:
            'Model tidak mengembalikan hasil pembacaan laporan. Pastikan file dapat dibaca (bukan terenkripsi password).',
        },
      };
    }

    const rawJson1 = extractJsonFromModelText(rawText);
    const normalized1 = normalizeParsedFinanceReport({
      raw: rawJson1,
      targetYear: parsedYear,
      targetMonth: validMonth,
      actorName: String(actorName),
      parserSource: 'gemini-4-hydrogen',
    });
    const diag1: ReportAccountingDiagnostics = computeReportAccountingDiagnostics(normalized1);

    let bestNormalized = normalized1;
    let bestDiag = diag1;
    let passCount = 1;

    // Pass 2: Automatic AI Self-Verification & Correction if Pass 1 COA is sparse or Neraca is unbalanced
    const needsVerificationPass =
      (diag1.coaCount < 6 || (diag1.totalAssets > 0 && !diag1.isBalanced)) &&
      Date.now() - pass1StartedAt < 75_000;

    if (needsVerificationPass) {
      try {
        const verificationPrompt = buildFinanceReportVerificationPrompt({
          targetYear: parsedYear,
          targetMonth: validMonth,
          fileName: String(fileName).slice(0, 200),
          previousRawJson: rawJson1,
          diagnostics: diag1,
          spreadsheetText:
            typeof spreadsheetText === 'string' ? spreadsheetText.slice(0, 120_000) : undefined,
        });
        const verifyParts = [{ text: verificationPrompt }, ...parts.slice(1)];

        const verifyTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Verification timeout')), 75_000)
        );
        const verifyPromise = activeAiClient.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: [{ role: 'user', parts: verifyParts }],
          config: {
            systemInstruction: FINANCE_REPORT_PARSE_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          },
        });

        const verifyRes: any = await Promise.race([verifyPromise, verifyTimeout]);
        const verifyText = verifyRes?.text || '';
        if (verifyText.trim()) {
          const rawJson2 = extractJsonFromModelText(verifyText);
          const normalized2 = normalizeParsedFinanceReport({
            raw: rawJson2,
            targetYear: parsedYear,
            targetMonth: validMonth,
            actorName: String(actorName),
            parserSource: 'gemini-4-hydrogen',
          });
          const diag2 = computeReportAccountingDiagnostics(normalized2);
          passCount = 2;

          const improved =
            (diag2.coaCount >= diag1.coaCount && diag2.neracaDiff < diag1.neracaDiff) ||
            (diag1.coaCount < 6 && diag2.coaCount > diag1.coaCount);

          if (improved) {
            bestNormalized = {
              ...normalized2,
              parserNotes: [
                ...(normalized2.parserNotes || []),
                `[Audit AI 2-Pass] Pemeriksaan ulang otomatis memperbaiki ekstraksi (${diag2.coaCount} akun COA, selisih Neraca berkurang dari Rp ${Math.round(
                  diag1.neracaDiff
                ).toLocaleString('id-ID')} menjadi Rp ${Math.round(diag2.neracaDiff).toLocaleString(
                  'id-ID'
                )}).`,
              ],
            };
            bestDiag = diag2;
          } else {
            bestNormalized = {
              ...normalized1,
              parserNotes: [
                ...(normalized1.parserNotes || []),
                `[Audit AI 2-Pass] Verifikasi silang selesai (${diag1.coaCount} akun COA diperiksa).`,
              ],
            };
          }
        }
      } catch (verifyErr) {
        console.warn('Pass 2 AI verification skipped due to non-fatal error:', verifyErr);
      }
    }

    return {
      status: 200,
      json: {
        data: bestNormalized,
        verification: {
          passCount,
          isBalanced: bestDiag.isBalanced,
          neracaDiff: bestDiag.neracaDiff,
          coaCount: bestDiag.coaCount,
        },
      },
    };
  } catch (err: any) {
    console.error('Error in handleParseFinanceReportAction:', err);
    return {
      status: 500,
      json: {
        error: err?.message || 'Gagal membaca dokumen laporan keuangan secara otomatis.',
      },
    };
  } finally {
    if (uploadedGeminiFileNameToDelete && activeAiClient) {
      activeAiClient.files.delete({ name: uploadedGeminiFileNameToDelete }).catch(() => undefined);
    }
  }
}
