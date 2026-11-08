// @ANCHOR: OMDB_CLIENT_UTILITY
// Utility for fetching OMDb metadata and upgrading Amazon/IMDb posters to high resolution (_V1_SX1000.jpg).
// Supports Admin toggle + API key persistence in localStorage and optional KV namespace sync.

import { checkDatabaseForExistingTitle, SimulatedKVNamespace } from './workerSandbox';

export interface OmdbConfig {
  enabled: boolean;
  apiKey: string;
  upgradeHighResPosters: boolean;
}

export interface OmdbMediaResult {
  id: string;
  imdb_id: string;
  title: string;
  name: string;
  release_date: string;
  first_air_date: string;
  overview: string;
  vote_average: number;
  poster_path: null;
  external_poster_url: string;
  external_backdrop_url: string;
  fallback_source: 'OMDb';
  media_type: 'movie' | 'tv';
  genre_names: string[];
  runtime_minutes?: number;
}

const OMDB_STORAGE_KEY = 'tma_omdb_admin_config_v1';
const DEFAULT_OMDB_KEY_FALLBACK = 'trilogy';

export function loadOmdbConfig(kvNamespace?: string): OmdbConfig {
  try {
    const scopedKey = kvNamespace ? `${OMDB_STORAGE_KEY}_${kvNamespace}` : OMDB_STORAGE_KEY;
    const raw = localStorage.getItem(scopedKey) || localStorage.getItem(OMDB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        enabled: parsed.enabled !== false,
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
        upgradeHighResPosters: parsed.upgradeHighResPosters !== false,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    enabled: true,
    apiKey: '',
    upgradeHighResPosters: true,
  };
}

export function saveOmdbConfig(
  partial: Partial<OmdbConfig>,
  kvNamespace?: string
): OmdbConfig {
  const current = loadOmdbConfig(kvNamespace);
  const updated: OmdbConfig = {
    enabled: partial.enabled !== undefined ? Boolean(partial.enabled) : current.enabled,
    apiKey: partial.apiKey !== undefined ? String(partial.apiKey).trim() : current.apiKey,
    upgradeHighResPosters:
      partial.upgradeHighResPosters !== undefined
        ? Boolean(partial.upgradeHighResPosters)
        : current.upgradeHighResPosters,
  };
  try {
    const scopedKey = kvNamespace ? `${OMDB_STORAGE_KEY}_${kvNamespace}` : OMDB_STORAGE_KEY;
    localStorage.setItem(scopedKey, JSON.stringify(updated));
    localStorage.setItem(OMDB_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore storage errors
  }
  return updated;
}

/**
 * Upgrades standard OMDb/Amazon CDN poster URLs (typically 300px `_V1_SX300.jpg`)
 * to high-resolution 1000px (`_V1_SX1000.jpg`).
 */
export function upgradeOmdbPosterToHighRes(posterUrl?: string | null, enableHighRes = true): string {
  if (!posterUrl || posterUrl === 'N/A' || !/^https?:\/\//i.test(posterUrl)) {
    return '';
  }
  const trimmed = posterUrl.trim();
  if (!enableHighRes) return trimmed;
  return trimmed
    .replace(/\._V1_.*?\.(jpg|jpeg|png)$/i, '._V1_SX1000.$1')
    .replace(/_V1_SX300/gi, '_V1_SX1000');
}

export async function verifyOmdbApiKey(apiKey: string): Promise<{
  ok: boolean;
  message: string;
  samplePosterUrl?: string;
}> {
  const effectiveKey = (apiKey || '').trim() || DEFAULT_OMDB_KEY_FALLBACK;
  try {
    const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(effectiveKey)}&i=tt0133093&plot=short`;
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status} (${res.statusText})` };
    }
    const data = await res.json();
    if (!data || data.Response !== 'True') {
      return {
        ok: false,
        message: data?.Error || 'Ungültiger OMDb API-Key oder Limit erreicht.',
      };
    }
    const hiRes = upgradeOmdbPosterToHighRes(data.Poster, true);
    return {
      ok: true,
      message: `OMDb Key aktiv (${data.Title}, High-Res Poster: ${hiRes ? '1000px OK' : 'N/A'})`,
      samplePosterUrl: hiRes,
    };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || 'Netzwerkfehler bei OMDb-Prüfung',
    };
  }
}

export interface FetchOmdbOptions {
  title?: string;
  year?: string | number | null;
  imdbId?: string | null;
  typeCode?: 'movie' | 'tv' | 'series';
  apiKey?: string;
  kvNamespace?: string;
}

const omdbMemoryCache = new Map<string, OmdbMediaResult | null>();

export async function fetchOmdbMetadataAndPoster(
  options: FetchOmdbOptions
): Promise<OmdbMediaResult | null> {
  const cfg = loadOmdbConfig(options.kvNamespace);
  if (!cfg.enabled) {
    return null;
  }

  const effectiveKey =
    (options.apiKey || '').trim() || cfg.apiKey || DEFAULT_OMDB_KEY_FALLBACK;
  const cleanTitle = (options.title || '')
    .replace(/\b(S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+|Episode\s*\d+)\b/gi, '')
    .replace(/[._-]+/g, ' ')
    .trim();
  const cleanImdb = (options.imdbId || '').trim();

  if (!cleanTitle && !cleanImdb) return null;

  const omdbType =
    options.typeCode === 'tv' || options.typeCode === 'series' ? 'series' : 'movie';
  const cacheKey = `${effectiveKey}::${cleanImdb || cleanTitle.toLowerCase()}::${options.year || ''}::${omdbType}`;

  if (omdbMemoryCache.has(cacheKey)) {
    return omdbMemoryCache.get(cacheKey) || null;
  }

  const queryAttempts: string[] = [];
  if (cleanImdb && /^tt\d+$/i.test(cleanImdb)) {
    queryAttempts.push(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(effectiveKey)}&i=${encodeURIComponent(cleanImdb)}&plot=full`
    );
  }
  if (cleanTitle) {
    if (options.year) {
      queryAttempts.push(
        `https://www.omdbapi.com/?apikey=${encodeURIComponent(effectiveKey)}&t=${encodeURIComponent(cleanTitle)}&y=${encodeURIComponent(String(options.year))}&type=${omdbType}&plot=full`
      );
    }
    queryAttempts.push(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(effectiveKey)}&t=${encodeURIComponent(cleanTitle)}&type=${omdbType}&plot=full`
    );
    queryAttempts.push(
      `https://www.omdbapi.com/?apikey=${encodeURIComponent(effectiveKey)}&s=${encodeURIComponent(cleanTitle)}&type=${omdbType}`
    );
  }

  for (const url of queryAttempts) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      let data = await res.json();

      if (data && data.Response === 'True' && Array.isArray(data.Search) && data.Search.length > 0) {
        const bestHit =
          data.Search.find((item: any) => item.Poster && item.Poster !== 'N/A') ||
          data.Search[0];
        if (bestHit?.imdbID) {
          const detailRes = await fetch(
            `https://www.omdbapi.com/?apikey=${encodeURIComponent(effectiveKey)}&i=${encodeURIComponent(bestHit.imdbID)}&plot=full`
          );
          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData && detailData.Response === 'True') {
              data = detailData;
            }
          }
        }
      }

      if (!data || data.Response !== 'True' || !data.Title) continue;

      const highResPoster = upgradeOmdbPosterToHighRes(
        data.Poster,
        cfg.upgradeHighResPosters
      );
      const yearMatch = String(data.Year || '').match(/\d{4}/);
      const releaseDate = yearMatch ? `${yearMatch[0]}-01-01` : '';
      const rating =
        data.imdbRating && data.imdbRating !== 'N/A'
          ? parseFloat(data.imdbRating) || 0
          : 0;
      const genres =
        data.Genre && data.Genre !== 'N/A'
          ? String(data.Genre)
              .split(',')
              .map((g) => g.trim())
              .filter(Boolean)
          : [];
      const runtimeMatch = String(data.Runtime || '').match(/(\d+)/);

      const result: OmdbMediaResult = {
        id: data.imdbID || `omdb_${Date.now()}`,
        imdb_id: data.imdbID || '',
        title: data.Title,
        name: data.Title,
        release_date: releaseDate,
        first_air_date: releaseDate,
        overview: data.Plot && data.Plot !== 'N/A' ? data.Plot : '',
        vote_average: rating,
        poster_path: null,
        external_poster_url: highResPoster,
        external_backdrop_url: highResPoster,
        fallback_source: 'OMDb',
        media_type: omdbType === 'series' ? 'tv' : 'movie',
        genre_names: genres,
        runtime_minutes: runtimeMatch ? parseInt(runtimeMatch[1], 10) : undefined,
      };

      omdbMemoryCache.set(cacheKey, result);
      return result;
    } catch {
      // continue to next attempt
    }
  }

  omdbMemoryCache.set(cacheKey, null);
  return null;
}

/**
 * Fallback enrichment in the client import service chain:
 * Enriches entries that lack a poster or metadata with OMDb metadata and high-res posters.
 * Caps concurrent requests to respect API rate limits.
 */
export async function enrichBatchEntriesWithOmdbFallback(
  entries: any[],
  options?: {
    kvNamespace?: string;
    kvInstance?: SimulatedKVNamespace;
    apiKey?: string;
    maxLookups?: number;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<{ entries: any[]; enrichedCount: number; d1PreMatchedCount: number }> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { entries: [], enrichedCount: 0, d1PreMatchedCount: 0 };
  }

  const cfg = loadOmdbConfig(options?.kvNamespace);
  const maxLookups = options?.maxLookups ?? 30;
  let lookupsDone = 0;
  let enrichedCount = 0;
  let d1PreMatchedCount = 0;

  const cloned = entries.map((e) => ({ ...e }));

  // First pass: check D1 locally with 85% stop-limit before triggering any external OMDb API calls
  for (let i = 0; i < cloned.length; i++) {
    const item = cloned[i];
    if (!item || typeof item !== 'object') continue;
    if (item.tmdb_id || item.tmdbId) {
      d1PreMatchedCount++;
      continue;
    }

    const rawTitle =
      item.clean_title ||
      item.cleanTitle ||
      item.series_title ||
      item.title ||
      item.name ||
      item.filename ||
      item.file_name ||
      item.rawInput ||
      '';
    if (!rawTitle || rawTitle.length < 2) continue;

    const isSeries =
      item.media_type === 'tv' ||
      item.type === 'series' ||
      Boolean(item.season_number || item.episode_number || item.season || item.episode) ||
      /\b(S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+)\b/i.test(rawTitle);

    const d1Hit = checkDatabaseForExistingTitle(rawTitle, {
      year: item.year || item.release_year || null,
      isSeries: isSeries ? true : undefined,
      kvNamespace: options?.kvInstance || null,
      stopConfidenceThreshold: 85,
    });

    if (d1Hit.matched && d1Hit.confidence >= 85 && d1Hit.tmdbId) {
      item.tmdb_id = d1Hit.tmdbId;
      item.tmdbId = d1Hit.tmdbId;
      item.typeCode = d1Hit.typeCode;
      item.type = d1Hit.typeCode === 's' ? 'series' : 'movie';
      item.isSeries = d1Hit.typeCode === 's';
      item.cleanTitle = d1Hit.title;
      if (!item.external_poster_url && d1Hit.posterUrl) {
        item.external_poster_url = d1Hit.posterUrl;
        item.posterUrl = d1Hit.posterUrl;
      }
      if (!item.overview && d1Hit.overview) {
        item.overview = d1Hit.overview;
      }
      item.preResolvedFromD1 = true;
      item.d1Confidence = d1Hit.confidence;
      d1PreMatchedCount++;
    }
  }

  if (!cfg.enabled) {
    return { entries: cloned, enrichedCount: 0, d1PreMatchedCount };
  }

  const candidates = cloned.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    if (entry.preResolvedFromD1 || entry.tmdb_id || entry.tmdbId) return false;
    const hasPoster = Boolean(
      entry.poster_path ||
        entry.external_poster_url ||
        entry.posterUrl ||
        entry.cover_url ||
        entry.cover
    );
    return !hasPoster;
  });

  const targetCount = Math.min(candidates.length, maxLookups);
  if (targetCount === 0) {
    return { entries: cloned, enrichedCount: 0, d1PreMatchedCount };
  }

  for (let i = 0; i < cloned.length; i++) {
    if (lookupsDone >= maxLookups) break;
    const item = cloned[i];
    if (item.preResolvedFromD1 || item.tmdb_id || item.tmdbId) continue;
    const hasPoster = Boolean(
      item.poster_path ||
        item.external_poster_url ||
        item.posterUrl ||
        item.cover_url ||
        item.cover
    );
    if (hasPoster) continue;

    const rawTitle =
      item.clean_title ||
      item.cleanTitle ||
      item.series_title ||
      item.title ||
      item.name ||
      item.filename ||
      item.file_name ||
      item.rawInput ||
      '';
    if (!rawTitle || rawTitle.length < 2) continue;

    const isSeries =
      item.media_type === 'tv' ||
      item.type === 'series' ||
      Boolean(item.season_number || item.episode_number || item.season || item.episode) ||
      /\b(S\d{1,2}E\d{1,3}|\d{1,2}x\d{1,3}|Staffel\s*\d+|Folge\s*\d+)\b/i.test(rawTitle);

    lookupsDone++;
    options?.onProgress?.(lookupsDone, targetCount);

    const omdbHit = await fetchOmdbMetadataAndPoster({
      title: rawTitle,
      year: item.year || item.release_year || null,
      imdbId: item.imdb_id || null,
      typeCode: isSeries ? 'tv' : 'movie',
      apiKey: options?.apiKey || cfg.apiKey,
      kvNamespace: options?.kvNamespace,
    });

    if (omdbHit) {
      if (omdbHit.external_poster_url) {
        item.external_poster_url = omdbHit.external_poster_url;
        item.posterUrl = omdbHit.external_poster_url;
      }
      if (!item.overview && omdbHit.overview) {
        item.overview = omdbHit.overview;
      }
      if (!item.vote_average && omdbHit.vote_average) {
        item.vote_average = omdbHit.vote_average;
      }
      if (!item.imdb_id && omdbHit.imdb_id) {
        item.imdb_id = omdbHit.imdb_id;
      }
      item.fallback_source = item.fallback_source || 'OMDb';
      enrichedCount++;
    }
  }

  return { entries: cloned, enrichedCount, d1PreMatchedCount };
}
