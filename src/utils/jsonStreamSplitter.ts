/**
 * Blob-based JSON Stream Reader & Batch Chunk Splitter
 *
 * Reads large JSON files (>200 MB Telegram Desktop `result.json` exports or media arrays)
 * incrementally via `Blob.slice()` / `ReadableStream` without loading the entire file into memory.
 * Splits extracted items into chunks of 250 items each and returns them as an array of
 * JSON batch objects ready for the sequential batch import process (`/api/import-json`).
 */

import {
  ExtractedBackupVideoEntry,
  PrecedingTelegramMessageContext,
  flattenTelegramText,
  quickParseFilenameMeta,
  tryExtractVideoCandidateFromMessageObj,
} from './jsonBackupSplitter';

export const DEFAULT_BATCH_CHUNK_SIZE = 250;
export const DEFAULT_BLOB_SLICE_BYTES = 2 * 1024 * 1024; // 2 MB per slice

export interface JsonStreamReaderProgress {
  bytesRead: number;
  totalBytes: number;
  percent: number;
  rawObjectsScanned: number;
  validItemsExtracted: number;
  skippedItems: number;
  duplicatesRemoved: number;
  chunksCreated: number;
}

export interface JsonBatchChunkEntry {
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
  mime_type: string;
}

export interface JsonBatchChunkObject {
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  fileName: string;
  playlistName: string;
  moviesCount: number;
  seriesCount: number;
  estimatedJsonBytes: number;
  entries: ExtractedBackupVideoEntry[];
  messages: Array<{
    id: number;
    type: 'message';
    file_name: string;
    media_type: 'video_file';
    mime_type: string;
    file_size: number | null;
    duration_seconds?: number | null;
    telegram_file_id: string | null;
    text: string;
    _prevMessages?: PrecedingTelegramMessageContext[];
  }>;
}

export interface JsonStreamReaderOptions {
  /** Number of items per batch chunk (defaults to 250) */
  chunkSize?: number;
  /** Size in bytes of each Blob.slice() read operation (defaults to 2 MB) */
  sliceSizeBytes?: number;
  /** Filter only video/media candidates or keep all parsed JSON objects */
  videoOnly?: boolean;
  /** Deduplicate entries by normalized title + season/episode + quality + part */
  deduplicate?: boolean;
  /** Optional progress callback invoked after each Blob slice is processed */
  onProgress?: (progress: JsonStreamReaderProgress) => void;
  /** Optional callback invoked immediately when a full 250-item chunk is assembled */
  onChunkReady?: (chunk: JsonBatchChunkObject) => void;
}

export interface JsonStreamSplitOutput {
  sourceName: string;
  totalBytes: number;
  detectedChatName: string;
  chunkSize: number;
  rawObjectsScanned: number;
  validItemsExtracted: number;
  skippedItems: number;
  duplicatesRemoved: number;
  durationMs: number;
  chunks: JsonBatchChunkObject[];
}

/**
 * Low-level Blob-based stream reader that slices a `Blob` or `File` in 2 MB increments
 * (with UTF-8 multi-byte boundary safety via `TextDecoder` stream mode) and yields
 * top-level JSON objects from root arrays `[...]` or nested `{ "messages": [...] }` structures.
 */
export async function streamReadJsonBlobObjects(
  blob: Blob,
  options: {
    sliceSizeBytes?: number;
    onHeaderSample?: (headerText: string) => void;
    onObjectParsed: (obj: Record<string, unknown>, rawIndex: number) => void;
    onInvalidObject?: () => void;
    onSliceProcessed?: (bytesRead: number, totalBytes: number, rawObjectsScanned: number) => void;
  }
): Promise<{ rawObjectsScanned: number; totalBytes: number }> {
  const sliceSizeBytes = options.sliceSizeBytes ?? DEFAULT_BLOB_SLICE_BYTES;
  const totalBytes = blob.size;
  const decoder = new TextDecoder('utf-8');

  let offset = 0;
  let rawObjectsScanned = 0;

  // Incremental JSON object boundary state machine
  let insideArray = false;
  let braceDepth = 0;
  let inString = false;
  let isEscaped = false;
  let currentObjectChars = '';

  while (offset < totalBytes) {
    const sliceEnd = Math.min(totalBytes, offset + sliceSizeBytes);
    const isLastSlice = sliceEnd >= totalBytes;
    const blobSlice = blob.slice(offset, sliceEnd);
    const arrayBuffer = await blobSlice.arrayBuffer();

    // Decode with `{ stream: !isLastSlice }` so multi-byte UTF-8 characters split across
    // 2 MB slice boundaries are never corrupted.
    const textChunk = decoder.decode(arrayBuffer, { stream: !isLastSlice });

    if (offset === 0 && options.onHeaderSample) {
      options.onHeaderSample(textChunk.slice(0, 2048));
    }

    for (let i = 0; i < textChunk.length; i++) {
      const ch = textChunk[i];

      if (!insideArray) {
        if (ch === '[') {
          insideArray = true;
        }
        continue;
      }

      if (braceDepth > 0) {
        currentObjectChars += ch;
      }

      if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (ch === '\\') {
          isEscaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        if (braceDepth === 0) {
          currentObjectChars = '{';
        }
        braceDepth++;
      } else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0 && currentObjectChars) {
          rawObjectsScanned++;
          try {
            const parsedObj = JSON.parse(currentObjectChars) as Record<string, unknown>;
            options.onObjectParsed(parsedObj, rawObjectsScanned);
          } catch {
            if (options.onInvalidObject) {
              options.onInvalidObject();
            }
          }
          currentObjectChars = '';
        }
      }
    }

    offset = sliceEnd;
    if (options.onSliceProcessed) {
      options.onSliceProcessed(offset, totalBytes, rawObjectsScanned);
    }

    // Yield to the browser event loop so UI progress indicators remain responsive
    await new Promise((resolve) => setTimeout(resolve, 4));
  }

  return { rawObjectsScanned, totalBytes };
}

/**
 * Fallback coercion for generic JSON objects when `videoOnly: false` is specified.
 */
function coerceGenericJsonItemToEntry(
  obj: Record<string, unknown>,
  index: number,
  prevMessages: PrecedingTelegramMessageContext[] = []
): ExtractedBackupVideoEntry | null {
  const videoCandidate = tryExtractVideoCandidateFromMessageObj(obj, index, prevMessages);
  if (videoCandidate) return videoCandidate;

  const fallbackName =
    (typeof obj.title === 'string' && obj.title.trim()) ||
    (typeof obj.name === 'string' && obj.name.trim()) ||
    (typeof obj.filename === 'string' && obj.filename.trim()) ||
    (typeof obj.file_name === 'string' && obj.file_name.trim()) ||
    '';

  if (!fallbackName) return null;

  const meta = quickParseFilenameMeta(fallbackName);
  return {
    index,
    messageId: typeof obj.id === 'number' ? obj.id : null,
    filename: fallbackName,
    rawInput: fallbackName,
    rawText: '',
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
    mime_type: typeof obj.mime_type === 'string' ? obj.mime_type : 'video/mp4',
  };
}

/**
 * Builds a single JSON batch object for a chunk of up to 250 items.
 */
export function createJsonBatchChunkObject(
  entries: ExtractedBackupVideoEntry[],
  chunkIndex: number,
  totalChunks: number,
  chunkSize: number,
  baseCleanName: string,
  playlistName: string
): JsonBatchChunkObject {
  const partNum = String(chunkIndex).padStart(3, '0');
  const moviesCount = entries.filter((e) => !e.isSeries).length;
  const seriesCount = entries.length - moviesCount;
  const estimatedJsonBytes = entries.length * 240;

  return {
    chunkIndex,
    totalChunks,
    chunkSize,
    fileName: `${baseCleanName}_part_${partNum}.json`,
    playlistName,
    moviesCount,
    seriesCount,
    estimatedJsonBytes,
    entries,
    messages: entries.map((item) => ({
      id: item.messageId ?? item.index,
      type: 'message',
      file_name: item.filename,
      media_type: 'video_file',
      mime_type: item.mime_type,
      file_size: item.file_size,
      duration_seconds: item.duration_sec ?? null,
      telegram_file_id: item.telegram_file_id,
      text: item.rawText || item.rawInput,
      _prevMessages: item.prevMessages || [],
    })),
  };
}

/**
 * Primary Blob-based stream splitter utility:
 * Accepts a large JSON `File` or `Blob`, reads it via `Blob.slice()` stream chunks,
 * splits the extracted items into chunks of `250` items each (by default), and returns
 * them as an array of `JsonBatchChunkObject` JSON objects for the batch import process.
 */
export async function splitJsonBlobIntoBatchChunks(
  fileOrBlob: File | Blob,
  options: JsonStreamReaderOptions = {}
): Promise<JsonBatchChunkObject[]> {
  const detailed = await streamSplitJsonBlobWithStats(fileOrBlob, options);
  return detailed.chunks;
}

/**
 * Full Blob-based stream splitter with detailed scan telemetry and array of 250-item
 * JSON batch objects.
 */
export async function streamSplitJsonBlobWithStats(
  fileOrBlob: File | Blob,
  options: JsonStreamReaderOptions = {}
): Promise<JsonStreamSplitOutput> {
  const startTime = Date.now();
  const safeChunkSize = Math.max(
    10,
    Math.min(2000, options.chunkSize ?? DEFAULT_BATCH_CHUNK_SIZE)
  );
  const videoOnly = options.videoOnly ?? true;
  const deduplicate = options.deduplicate ?? true;

  const sourceName =
    'name' in fileOrBlob && typeof fileOrBlob.name === 'string' && fileOrBlob.name
      ? fileOrBlob.name
      : 'telegram_backup.json';
  const baseCleanName = sourceName.replace(/\.json$/i, '');
  let detectedChatName = baseCleanName;

  const matchedEntries: ExtractedBackupVideoEntry[] = [];
  const rollingPrevBuffer: PrecedingTelegramMessageContext[] = [];
  const seenKeys = new Set<string>();
  let skippedItems = 0;
  let duplicatesRemoved = 0;

  const { rawObjectsScanned, totalBytes } = await streamReadJsonBlobObjects(fileOrBlob, {
    sliceSizeBytes: options.sliceSizeBytes ?? DEFAULT_BLOB_SLICE_BYTES,
    onHeaderSample: (headerSample) => {
      const nameMatch = headerSample.match(/"name"\s*:\s*"([^"]+)"/);
      if (nameMatch && nameMatch[1]) {
        detectedChatName = nameMatch[1].trim();
      }
    },
    onObjectParsed: (parsedObj) => {
      const prevSnapshot = rollingPrevBuffer.slice(-2);
      const flatTxt = flattenTelegramText(
        parsedObj.text || parsedObj.caption || parsedObj.text_entities
      ).slice(0, 350);
      const fn = String(parsedObj.file_name || parsedObj.filename || '').slice(0, 120);
      if (flatTxt || fn) {
        rollingPrevBuffer.push({
          id: typeof parsedObj.id === 'number' ? parsedObj.id : null,
          text: flatTxt,
          fileName: fn,
        });
        if (rollingPrevBuffer.length > 3) {
          rollingPrevBuffer.shift();
        }
      }

      const candidate = videoOnly
        ? tryExtractVideoCandidateFromMessageObj(
            parsedObj,
            matchedEntries.length + 1,
            prevSnapshot
          )
        : coerceGenericJsonItemToEntry(parsedObj, matchedEntries.length + 1, prevSnapshot);

      if (!candidate) {
        skippedItems++;
        return;
      }

      if (deduplicate) {
        // Exaktes Duplikat ohne Telegram file_id NUR bei gleicher Dateigröße + Dauer + Dateiname filtern
        const fileIdKey = candidate.telegram_file_id ? `fid:${candidate.telegram_file_id}` : '';
        const hasFileMetrics = (candidate.file_size && candidate.file_size > 0) || (candidate.duration_sec && candidate.duration_sec > 0);
        const dedupKey = fileIdKey
          ? fileIdKey
          : hasFileMetrics
          ? `file|${candidate.filename.trim().toLowerCase()}|sz:${candidate.file_size || 0}|dur:${candidate.duration_sec || 0}`
          : `${candidate.cleanTitleGuess.toLowerCase()}|${
              candidate.isSeries ? `s${candidate.season}e${candidate.episode}` : 'm'
            }|${candidate.quality}|${candidate.codec || ''}|${candidate.part || ''}|${candidate.rawInput.trim().toLowerCase()}`;

        if (seenKeys.has(dedupKey)) {
          duplicatesRemoved++;
          return;
        }
        seenKeys.add(dedupKey);
      }

      matchedEntries.push(candidate);
    },
    onInvalidObject: () => {
      skippedItems++;
    },
    onSliceProcessed: (bytesRead, total, scanned) => {
      if (options.onProgress) {
        options.onProgress({
          bytesRead,
          totalBytes: total,
          percent: total > 0 ? Math.min(100, Math.round((bytesRead / total) * 100)) : 100,
          rawObjectsScanned: scanned,
          validItemsExtracted: matchedEntries.length,
          skippedItems,
          duplicatesRemoved,
          chunksCreated: Math.ceil(matchedEntries.length / safeChunkSize),
        });
      }
    },
  });

  const totalChunks = Math.max(1, Math.ceil(matchedEntries.length / safeChunkSize));
  const chunks: JsonBatchChunkObject[] = [];

  for (let c = 0; c < totalChunks; c++) {
    const slice = matchedEntries.slice(c * safeChunkSize, (c + 1) * safeChunkSize);
    if (slice.length === 0) continue;

    const batchChunk = createJsonBatchChunkObject(
      slice,
      c + 1,
      totalChunks,
      safeChunkSize,
      baseCleanName,
      detectedChatName
    );
    chunks.push(batchChunk);

    if (options.onChunkReady) {
      options.onChunkReady(batchChunk);
    }
  }

  return {
    sourceName,
    totalBytes,
    detectedChatName,
    chunkSize: safeChunkSize,
    rawObjectsScanned,
    validItemsExtracted: matchedEntries.length,
    skippedItems,
    duplicatesRemoved,
    durationMs: Date.now() - startTime,
    chunks,
  };
}
