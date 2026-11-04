/**
 * Browser Stream-Slice Parser & Partitioner for >200 MB Telegram Desktop JSON Backups (result.json)
 *
 * Uses `File.slice(offset, offset + SLICE_BYTES)` in 2 MB increments so 200 MB - 2 GB+
 * files are scanned with constant RAM (~4-8 MB) without triggering V8 string-length limits
 * or Cloudflare Worker 100 MB HTTP body limits.
 */

import {
  DEFAULT_BATCH_CHUNK_SIZE,
  JsonBatchChunkObject,
  splitJsonBlobIntoBatchChunks,
  streamSplitJsonBlobWithStats,
} from './jsonStreamSplitter';

export interface PrecedingTelegramMessageContext {
  id: number | null;
  text: string;
  fileName: string;
}

export interface ExtractedBackupVideoEntry {
  index: number;
  messageId: number | null;
  filename: string;
  rawInput: string;
  rawText?: string;
  prevMessages?: PrecedingTelegramMessageContext[];
  cleanTitleGuess: string;
  isSeries: boolean;
  season: number | null;
  episode: number | null;
  year: number | null;
  quality: string;
  codec: string;
  part: string | null;
  telegram_file_id: string | null;
  file_size: number | null;
  duration_sec?: number | null;
  mime_type: string;
}

export interface BackupSplitChunk {
  chunkIndex: number; // 1-based
  totalChunks: number;
  fileName: string;
  entries: ExtractedBackupVideoEntry[];
  moviesCount: number;
  seriesCount: number;
  estimatedJsonBytes: number;
  importedStatus?: 'idle' | 'importing' | 'done' | 'error';
  importedSummary?: string;
}

export interface StreamSplitProgress {
  bytesRead: number;
  totalBytes: number;
  percent: number;
  rawObjectsScanned: number;
  videoEntriesMatched: number;
  skippedNonVideo: number;
  chunksCreated: number;
}

export interface StreamSplitResult {
  sourceFileName: string;
  sourceFileSizeBytes: number;
  chatName: string;
  chunkSize: number;
  rawObjectsScanned: number;
  videoEntriesMatched: number;
  skippedNonVideo: number;
  duplicatesRemoved: number;
  moviesCount: number;
  seriesCount: number;
  chunks: BackupSplitChunk[];
  durationMs: number;
}

const SLICE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB binary stream window

export function flattenTelegramText(textField: unknown): string {
  if (!textField) return '';
  if (typeof textField === 'string') return textField;
  if (Array.isArray(textField)) {
    return textField
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text || '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

export function quickParseFilenameMeta(rawName: string): {
  cleanTitleGuess: string;
  isSeries: boolean;
  season: number | null;
  episode: number | null;
  year: number | null;
  quality: string;
  codec: string;
  part: string | null;
} {
  const withoutExt = rawName.replace(/\.(mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|json)$/i, '');

  let quality = '1080p';
  const qualMatch = withoutExt.match(/\b(2160p|4k|uhd|1080p|fhd|720p|hd|480p|sd)\b/i);
  if (qualMatch) {
    const q = qualMatch[1].toUpperCase();
    if (q === '2160P' || q === '4K' || q === 'UHD') quality = '4K';
    else if (q === '1080P' || q === 'FHD') quality = '1080p';
    else if (q === '720P' || q === 'HD') quality = '720p';
    else if (q === '480P' || q === 'SD') quality = '480p';
  }

  let codec = 'x264';
  const codecMatch = withoutExt.match(/\b(x265|h\.?265|hevc|x264|h\.?264|avc|av1)\b/i);
  if (codecMatch) {
    const c = codecMatch[1].toLowerCase().replace(/\./g, '');
    if (c === 'x265' || c === 'h265' || c === 'hevc') codec = 'x265';
    else if (c === 'av1') codec = 'AV1';
  }

  let part: string | null = null;
  const partMatch = withoutExt.match(/\b(?:CD\s*\d+|Part\s*\d+|Teil\s*\d+)\b/i);
  if (partMatch) {
    part = partMatch[0].replace(/\s+/g, '').toUpperCase();
  }

  let isSeries = false;
  let season: number | null = null;
  let episode: number | null = null;
  let cutIndex = withoutExt.length;

  const seMatch =
    withoutExt.match(/\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i) ||
    withoutExt.match(/\bE(\d{1,3})[\s._-]*S(\d{1,2})\b/i) ||
    withoutExt.match(/\b(\d{1,2})x(\d{2,3})\b/i) ||
    withoutExt.match(/\b(?:Staffel|Season)\s*(\d{1,2})[\s._-]*(?:Folge|Episode|Ep\.?)\s*(\d{1,3})\b/i);

  if (seMatch) {
    isSeries = true;
    const isTwisted = /^E\d/i.test(seMatch[0]);
    season = parseInt(isTwisted ? seMatch[2] : seMatch[1], 10) || 1;
    episode = parseInt(isTwisted ? seMatch[1] : seMatch[2], 10) || 1;
    if (typeof seMatch.index === 'number') cutIndex = Math.min(cutIndex, seMatch.index);
  } else {
    const epOnly = withoutExt.match(/\b(?:Folge|Episode|Ep\.?)\s*(\d{1,3})\b/i);
    if (epOnly) {
      isSeries = true;
      season = 1;
      episode = parseInt(epOnly[1], 10) || 1;
      if (typeof epOnly.index === 'number') cutIndex = Math.min(cutIndex, epOnly.index);
    }
  }

  let year: number | null = null;
  const yrMatch = withoutExt.match(/(?<!\d{1,2}\.\d{1,2}\.)(?:^|[\s._(\[-])((?:19\d{2}|20[0-3]\d))(?=$|[\s._)\]-])/);
  if (yrMatch) {
    year = parseInt(yrMatch[1], 10);
    if (typeof yrMatch.index === 'number' && yrMatch.index > 1) {
      cutIndex = Math.min(cutIndex, yrMatch.index);
    }
  }

  let titleCandidate = withoutExt.slice(0, cutIndex);
  if (!titleCandidate.trim()) titleCandidate = withoutExt;

  const cleanTitleGuess =
    titleCandidate
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(
        /\b(2160p|4k|uhd|1080p|fhd|720p|hd|480p|bluray|bdrip|webrip|web-dl|remux|hdr|hdr10|dv|dolby|atmos|dts|german|deutsch|dl|multi|uncut|extended|x264|x265|h264|h265|hevc|avc|cd\d+|part\d+|teil\d+)\b/gi,
        ' '
      )
      .replace(/[._-]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim() || 'Unbekannt';

  return {
    cleanTitleGuess,
    isSeries,
    season,
    episode,
    year,
    quality,
    codec,
    part,
  };
}

export function tryExtractVideoCandidateFromMessageObj(
  obj: Record<string, unknown>,
  seqIndex: number,
  prevMessages: PrecedingTelegramMessageContext[] = []
): ExtractedBackupVideoEntry | null {
  if (obj.type && obj.type !== 'message') return null;

  const rawFileName = String(obj.file_name || obj.filename || obj.title || '').trim();
  const rawFilePath = String(obj.file || '').trim();
  const validFilePath =
    rawFilePath && !rawFilePath.startsWith('(File not included')
      ? rawFilePath.split('/').pop() || ''
      : '';

  if (/\.(rar|zip|7z|tar|gz|part\d*\.rar)$/i.test(rawFileName || validFilePath)) {
    return null;
  }

  const flatText = flattenTelegramText(obj.text || obj.caption || obj.text_entities);
  const firstLine = flatText
    .split(/\r?\n/)
    .map((l) => l.replace(/^[🎬📺🎞️🍿⭐️•\-▶️\d.)\s]+/, '').trim())
    .find((l) => l.length >= 2 && l.length <= 120 && !/^https?:\/\//i.test(l));

  const isVideoMsg =
    obj.media_type === 'video_file' ||
    /^video\//i.test(String(obj.mime_type || '')) ||
    /\.(?:mp4|mkv|avi|mov|m4v|webm|ts)$/i.test(rawFileName || validFilePath);

  const hasMediaReleaseHints =
    /\b(?:19\d{2}|20[0-3]\d|S\d{1,2}[\s._-]*E\d{1,3}|\d{1,2}x\d{2,3}|2160p|4K|1080p|720p|x264|x265|HEVC|BluRay|WEB-DL)\b/i.test(
      rawFileName || validFilePath || flatText
    );

  if (!isVideoMsg && !rawFileName && !validFilePath && !hasMediaReleaseHints) {
    return null;
  }

  // Gold Master Rule #2: Prefer firstLine of caption over truncated 60-char file_name
  let candidateName = firstLine || rawFileName || validFilePath || '';
  if (!candidateName || candidateName.length < 2) return null;

  const combinedContextText = [flatText, ...prevMessages.map((p) => p.text)].join('\n');

  const seInText =
    combinedContextText.match(
      /\b(S\d{1,2}[\s._-]*E\d{1,3}|E\d{1,3}[\s._-]*S\d{1,2}|\d{1,2}x\d{2,3}|(?:Staffel|Season)\s*\d{1,2}[\s._-]*(?:Folge|Episode)\s*\d{1,3})\b/i
    )?.[1] || null;
  const yrInText =
    combinedContextText.match(/(?<!\d{1,2}\.\d{1,2}\.)\b(19\d{2}|20[0-3]\d)\b/)?.[1] || null;
  const qualInText =
    (rawFileName + ' ' + flatText).match(/\b(2160p|4K|UHD|1080p|FHD|720p|HD|480p)\b/i)?.[1] ||
    null;

  if (
    seInText &&
    !/\b(?:S\d{1,2}[\s._-]*E\d{1,3}|E\d{1,3}[\s._-]*S\d{1,2}|\d{1,2}x\d{2,3})\b/i.test(
      candidateName
    )
  ) {
    candidateName += ` ${seInText}`;
  }
  if (yrInText && !/\b(?:19\d{2}|20[0-3]\d)\b/.test(candidateName)) {
    candidateName += ` (${yrInText})`;
  }
  if (qualInText && !/\b(?:2160p|4K|UHD|1080p|FHD|720p|HD|480p)\b/i.test(candidateName)) {
    candidateName += ` ${qualInText}`;
  }

  const meta = quickParseFilenameMeta(candidateName);

  return {
    index: seqIndex,
    messageId: typeof obj.id === 'number' ? obj.id : null,
    filename: rawFileName || validFilePath || candidateName,
    rawInput: candidateName,
    rawText: flatText ? flatText.slice(0, 600) : '',
    prevMessages: prevMessages.slice(-2),
    cleanTitleGuess: meta.cleanTitleGuess,
    isSeries: meta.isSeries,
    season: meta.season,
    episode: meta.episode,
    year: meta.year,
    quality: meta.quality,
    codec: meta.codec,
    part: meta.part,
    telegram_file_id:
      typeof obj.telegram_file_id === 'string'
        ? obj.telegram_file_id
        : typeof obj.file_id === 'string'
        ? obj.file_id
        : null,
    file_size: typeof obj.file_size === 'number' ? obj.file_size : null,
    duration_sec:
      typeof obj.duration_seconds === 'number'
        ? obj.duration_seconds
        : typeof obj.duration_sec === 'number'
        ? obj.duration_sec
        : null,
    mime_type: typeof obj.mime_type === 'string' ? obj.mime_type : 'video/mp4',
  };
}

export {
  DEFAULT_BATCH_CHUNK_SIZE,
  splitJsonBlobIntoBatchChunks,
  streamSplitJsonBlobWithStats,
};
export type { JsonBatchChunkObject };

/**
 * Streams a potentially huge (>200 MB) Telegram `result.json` or media array JSON file
 * in 2 MB Blob slices via `jsonStreamSplitter.ts`, extracts only video/media entries,
 * deduplicates them, and partitions them into batches of `chunkSize` (default 250).
 */
export async function streamSplitTelegramJsonFile(
  file: File,
  chunkSize: number = DEFAULT_BATCH_CHUNK_SIZE,
  onProgress?: (p: StreamSplitProgress) => void
): Promise<StreamSplitResult> {
  const output = await streamSplitJsonBlobWithStats(file, {
    chunkSize: chunkSize || DEFAULT_BATCH_CHUNK_SIZE,
    sliceSizeBytes: SLICE_SIZE_BYTES,
    videoOnly: true,
    deduplicate: true,
    onProgress: (prog) => {
      if (onProgress) {
        onProgress({
          bytesRead: prog.bytesRead,
          totalBytes: prog.totalBytes,
          percent: prog.percent,
          rawObjectsScanned: prog.rawObjectsScanned,
          videoEntriesMatched: prog.validItemsExtracted,
          skippedNonVideo: prog.skippedItems,
          chunksCreated: prog.chunksCreated,
        });
      }
    },
  });

  const allEntries = output.chunks.flatMap((c) => c.entries);
  return buildSplitResultFromEntries(
    output.sourceName,
    output.totalBytes,
    output.detectedChatName,
    output.chunkSize,
    output.rawObjectsScanned,
    output.skippedItems,
    output.duplicatesRemoved,
    allEntries,
    output.durationMs
  );
}

export function buildSplitResultFromEntries(
  sourceFileName: string,
  sourceFileSizeBytes: number,
  chatName: string,
  chunkSize: number,
  rawObjectsScanned: number,
  skippedNonVideo: number,
  duplicatesRemoved: number,
  matchedEntries: ExtractedBackupVideoEntry[],
  durationMs: number
): StreamSplitResult {
  const safeChunkSize = Math.max(10, Math.min(2000, chunkSize || 250));
  const totalChunks = Math.max(1, Math.ceil(matchedEntries.length / safeChunkSize));
  const baseCleanName = sourceFileName.replace(/\.json$/i, '');

  const chunks: BackupSplitChunk[] = [];
  let moviesCount = 0;
  let seriesCount = 0;

  for (const item of matchedEntries) {
    if (item.isSeries) seriesCount++;
    else moviesCount++;
  }

  for (let c = 0; c < totalChunks; c++) {
    const slice = matchedEntries.slice(c * safeChunkSize, (c + 1) * safeChunkSize);
    if (slice.length === 0) continue;
    const partNum = String(c + 1).padStart(3, '0');
    const cMovies = slice.filter((x) => !x.isSeries).length;
    const cSeries = slice.length - cMovies;
    const estimatedBytes = slice.length * 240;

    chunks.push({
      chunkIndex: c + 1,
      totalChunks,
      fileName: `${baseCleanName}_part_${partNum}.json`,
      entries: slice,
      moviesCount: cMovies,
      seriesCount: cSeries,
      estimatedJsonBytes: estimatedBytes,
      importedStatus: 'idle',
    });
  }

  return {
    sourceFileName,
    sourceFileSizeBytes,
    chatName,
    chunkSize: safeChunkSize,
    rawObjectsScanned,
    videoEntriesMatched: matchedEntries.length,
    skippedNonVideo,
    duplicatesRemoved,
    moviesCount,
    seriesCount,
    chunks,
    durationMs,
  };
}

/**
 * Generates a realistic simulated >200 MB Telegram Desktop Backup split result
 * (e.g., 248.4 MB source export with 42,500 raw chat messages filtered down to 620 clean video entries across 3 chunks of 250)
 * so users can test the Stream Splitter & Sequential Batch Importer immediately.
 */
export function generateSimulated200MbSplitResult(chunkSize: number = 250): StreamSplitResult {
  const sampleCatalog = [
    { base: 'Dune.Part.Two.2024.German.DL.2160p.UHD.BluRay.x265-cine', isSeries: false },
    { base: 'Oppenheimer.2023.German.DL.2160p.HDR.IMAX.BluRay.x265.CD1', isSeries: false },
    { base: 'Oppenheimer.2023.German.DL.2160p.HDR.IMAX.BluRay.x265.CD2', isSeries: false },
    { base: 'The.Batman.2022.German.DL.1080p.BluRay.x264', isSeries: false },
    { base: 'Interstellar.2014.German.DL.2160p.UHD.BluRay.x265', isSeries: false },
    { base: 'Inception.2010.German.DL.1080p.BluRay.x264', isSeries: false },
    { base: 'Blade.Runner.2049.2017.German.DL.2160p.HDR.WEB-DL.x265', isSeries: false },
    { base: 'Mad.Max.Fury.Road.2015.German.DL.2160p.UHD.BluRay.x265', isSeries: false },
    { base: 'Civil.War.2024.German.DL.1080p.BluRay.x265', isSeries: false },
    { base: 'Furiosa.A.Mad.Max.Saga.2024.German.DL.2160p.WEB-DL.x265', isSeries: false },
    { base: 'Alien.Romulus.2024.German.DL.2160p.HDR.WEB-DL.x265', isSeries: false },
    { base: 'Gladiator.II.2024.German.DL.2160p.UHD.BluRay.x265', isSeries: false },
    { base: 'Severance.S01E01.Good.News.About.Hell.1080p.ATVP.WEB-DL.x265', isSeries: true },
    { base: 'Severance.S01E02.Half.Loop.1080p.ATVP.WEB-DL.x265', isSeries: true },
    { base: 'Severance.S02E01.Hello.Ms.Cobel.2160p.ATVP.WEB-DL.x265', isSeries: true },
    { base: 'Fallout.S01E01.The.End.2160p.AMZN.WEB-DL.x265', isSeries: true },
    { base: 'Fallout.S01E02.The.Target.2160p.AMZN.WEB-DL.x265', isSeries: true },
    { base: 'Shogun.2024.S01E01.Anjin.2160p.DSNP.WEB-DL.x265', isSeries: true },
    { base: 'The.Penguin.S01E01.After.Hours.2160p.MAX.WEB-DL.x265', isSeries: true },
    { base: 'House.of.the.Dragon.S02E01.A.Son.for.a.Son.2160p.WEB-DL.x265', isSeries: true },
    { base: 'Breaking.Bad.S01E01.Pilot.1080p.BluRay.x264', isSeries: true },
    { base: 'Dark.S01E01.Geheimnisse.1080p.NF.WEB-DL.x265', isSeries: true },
    { base: 'The.Last.of.Us.S01E01.When.Youre.Lost.in.the.Darkness.2160p.x265', isSeries: true },
    { base: 'Silo.S02E01.The.Engineer.2160p.ATVP.WEB-DL.x265', isSeries: true },
  ];

  const totalEntries = 540; // Produces 3 chunks at default 250 video entries per chunk (250 + 250 + 40)
  const entries: ExtractedBackupVideoEntry[] = [];

  for (let i = 0; i < totalEntries; i++) {
    const template = sampleCatalog[i % sampleCatalog.length];
    const cycle = Math.floor(i / sampleCatalog.length);
    let rawName = template.base;
    if (cycle > 0) {
      if (template.isSeries) {
        const epNum = String((i % 12) + 1).padStart(2, '0');
        const seNum = String((cycle % 3) + 1).padStart(2, '0');
        rawName = rawName.replace(/S\d{2}E\d{2}/i, `S${seNum}E${epNum}`);
      } else {
        const quals = ['1080p', '2160p', '720p'];
        const q = quals[cycle % quals.length];
        rawName = `${rawName}.${q}`;
      }
    }
    const meta = quickParseFilenameMeta(rawName);
    entries.push({
      index: i + 1,
      messageId: 100000 + i * 7,
      filename: `${rawName}.mkv`,
      rawInput: `${rawName}.mkv`,
      cleanTitleGuess: meta.cleanTitleGuess,
      isSeries: meta.isSeries,
      season: meta.season,
      episode: meta.episode,
      year: meta.year,
      quality: meta.quality,
      codec: meta.codec,
      part: meta.part,
      telegram_file_id: `BAACAgIAAxkBAAI_${100000 + i}`,
      file_size: meta.quality === '4K' ? 8540000000 : 2140000000,
      mime_type: 'video/x-matroska',
    });
  }

  return buildSplitResultFromEntries(
    'result_telegram_archive_248MB.json',
    260_466_278, // 248.4 MB
    'Cinema & Serien HD Archiv',
    chunkSize,
    48_920,
    47_810,
    570,
    entries,
    640
  );
}
