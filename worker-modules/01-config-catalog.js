  // @DEPARTMENT: 01-config-catalog | 1. Konfiguration, Filmreihen & Genres
import { AsyncLocalStorage } from "node:async_hooks";

  // --- Per-Request Concurrency-Isolation (Cloudflare nodejs_als AsyncLocalStorage + sicherer Sandbox-Fallback) ---
  // Verhindert Race-Conditions bei parallelen Requests im selben V8-Isolate (D1-Batch-Buffer, Subrequest-Budget, Telemetrie, env/ctx).
  const __WORKER_REQUEST_ALS = (typeof AsyncLocalStorage === "function") ? new AsyncLocalStorage() : null;
  let __fallbackRequestContext = null;
  let __fallbackInvocationSubrequests = 0;
  let __fallbackSubrequestBudgetExhausted = false;
  let __fallbackTmdbRateLimitHitInBatch = false;

  function createWorkerRequestContext(init = {}) {
    return {
      env: init.env || null,
      ctx: init.ctx || null,
      origin: String(init.origin || ""),
      subrequests: 0,
      subrequestBudgetExhausted: false,
      tmdbRateLimitHitInBatch: false,
      d1WriteBuffer: null,
      d1WriteBufferStartedAt: 0,
      d1WriteBufferDepth: 0,
      telemetry: {
        requestStartMs: Date.now(),
        syncCpuAccumMs: 0,
        d1OpsCount: 0,
        jsonBytesParsed: 0,
        cacheHit: false,
        route: String(init.route || "")
      }
    };
  }

  function getActiveWorkerRequestContext() {
    if (__WORKER_REQUEST_ALS) {
      const store = __WORKER_REQUEST_ALS.getStore();
      if (store) return store;
    }
    return __fallbackRequestContext;
  }

  function runWithWorkerRequestContext(init, fn) {
    const reqCtx = createWorkerRequestContext(init);
    if (__WORKER_REQUEST_ALS) {
      return __WORKER_REQUEST_ALS.run(reqCtx, fn);
    }
    const prev = __fallbackRequestContext;
    __fallbackRequestContext = reqCtx;
    try {
      const res = fn();
      if (res && typeof res.finally === "function") {
        return res.finally(() => {
          if (__fallbackRequestContext === reqCtx) __fallbackRequestContext = prev;
        });
      }
      __fallbackRequestContext = prev;
      return res;
    } catch (err) {
      __fallbackRequestContext = prev;
      throw err;
    }
  }

  function getActiveWorkerEnv(explicitEnv = null) {
    if (explicitEnv) return explicitEnv;
    const reqCtx = getActiveWorkerRequestContext();
    if (reqCtx && reqCtx.env) return reqCtx.env;
    return typeof globalThis !== "undefined" ? (globalThis._activeWorkerEnv || null) : null;
  }

  function getActiveWorkerCtx(explicitCtx = null) {
    if (explicitCtx) return explicitCtx;
    const reqCtx = getActiveWorkerRequestContext();
    if (reqCtx && reqCtx.ctx) return reqCtx.ctx;
    return typeof globalThis !== "undefined" ? (globalThis._activeWorkerCtx || null) : null;
  }

  function getActiveWorkerOrigin() {
    const reqCtx = getActiveWorkerRequestContext();
    if (reqCtx && reqCtx.origin) return reqCtx.origin;
    return typeof globalThis !== "undefined" ? String(globalThis._activeWorkerOrigin || "") : "";
  }

  function getInvocationSubrequests() {
    const reqCtx = getActiveWorkerRequestContext();
    return reqCtx ? Number(reqCtx.subrequests || 0) : __fallbackInvocationSubrequests;
  }

  function incrementInvocationSubrequests(delta = 1) {
    const step = Number(delta || 1);
    const reqCtx = getActiveWorkerRequestContext();
    if (reqCtx) {
      reqCtx.subrequests = Number(reqCtx.subrequests || 0) + step;
      return reqCtx.subrequests;
    }
    __fallbackInvocationSubrequests += step;
    return __fallbackInvocationSubrequests;
  }

  function isSubrequestBudgetExhausted() {
    const reqCtx = getActiveWorkerRequestContext();
    return reqCtx ? Boolean(reqCtx.subrequestBudgetExhausted) : Boolean(__fallbackSubrequestBudgetExhausted);
  }

  function setSubrequestBudgetExhausted(flag) {
    const v = Boolean(flag);
    const reqCtx = getActiveWorkerRequestContext();
    if (reqCtx) {
      reqCtx.subrequestBudgetExhausted = v;
      return;
    }
    __fallbackSubrequestBudgetExhausted = v;
  }

  function isTmdbRateLimitHitInBatch() {
    const reqCtx = getActiveWorkerRequestContext();
    return reqCtx ? Boolean(reqCtx.tmdbRateLimitHitInBatch) : Boolean(__fallbackTmdbRateLimitHitInBatch);
  }

  function setTmdbRateLimitHitInBatch(flag) {
    const v = Boolean(flag);
    const reqCtx = getActiveWorkerRequestContext();
    if (reqCtx) {
      reqCtx.tmdbRateLimitHitInBatch = v;
      return;
    }
    __fallbackTmdbRateLimitHitInBatch = v;
  }

  function resetSubrequestBudget() {
    const reqCtx = getActiveWorkerRequestContext();
    if (reqCtx) {
      reqCtx.subrequests = 0;
      reqCtx.subrequestBudgetExhausted = false;
      reqCtx.tmdbRateLimitHitInBatch = false;
      return;
    }
    __fallbackInvocationSubrequests = 0;
    __fallbackSubrequestBudgetExhausted = false;
    __fallbackTmdbRateLimitHitInBatch = false;
  }

  function hasSubrequestBudget(limit = 36) {
    return getInvocationSubrequests() < limit;
  }

  /**
   * ============================================================================
   * Cloudflare Workers Script - Telegram Film & Serien Empfehlungs-Bot (v3.2)
   * ============================================================================
   *
   * 🔐 GEHEIMES ADMIN-PANEL & API-TRACKING HINT:
   * ----------------------------------------------------------------------------
   * Sende im Telegram-Chat mit dem Bot den versteckten Befehl:
   *   👉  /stats xyz
   *
   * Damit öffnest du das versteckte Admin-Dashboard. Dort siehst du:
   * - Alle getrackten TMDB API-Requests, Telegram Bot API-Calls, Übersetzungs-
   *   Aufrufe, Cloudflare KV Reads/Writes sowie Such-Statistiken.
   * - Einen Live-Vergleich deines aktuellen Verbrauchs mit den jeweiligen API-Limits.
   * - Direkte Umschalt-Buttons, um die API-Level-Tiers (aktuell alle auf "free")
   *   jederzeit im laufenden Betrieb auf "paid" (oder zurück auf "free") zu stellen!
   *
   * ✨ NEU IN V3.2 (SAUBERE MOBILE-FORMATIERUNG, CRASH-FIX & API-SPARMODUS):
   * - Bulletproof HTML-Rendering (verhindert kaputte Links durch Unterstriche im Bot-Namen)
   * - Arel Gram / Android Client Crash-Fix (keine inkompatiblen copy_text Buttons mehr)
   * - Saubere, kurze Trennlinien ohne Umbruch-Fehler auf Smartphones
   * - Anklickbarer Titel in der Detailansicht (öffnet Menü für Telegram-Suche, TMDB, Teilen & Kopieren)
   * - Kompakte Detailansicht: "Komplett lesen", Trailer (YT/Piped) & TMDB direkt im Text eingebunden
   * - Doppelte "Ähnliche Filme"-Logik: Ursprungsfilm ("Der Herr der Ringe") bleibt für weitere
   *   Alternativen erhalten + zusätzlicher Button für Alternativen zum aktuell angezeigten Film
   * - Eigener "🍿 Filmreihen stöbern" Button direkt im Hauptmenü (inkl. Suche & Zufalls-Reihe)
   * - Massiv reduzierte API- & KV-Aufrufe durch gebündelte TMDB-Abfragen (inkl. Videos) & Caching
   *
   * Benötigte Cloudflare Worker Umgebungsvariablen (Secrets / Bindings):
   * - TELEGRAM_BOT_TOKEN : Dein Telegram Bot Token von @BotFather
   * - TMDB_BEARER_TOKEN  : Dein TMDB Read Access Token (v4 auth Bearer)
   * - MOVIE_SAVED        : Cloudflare KV Namespace Binding (für Merkliste, Ordner, Filter & Stats)
   * ============================================================================
   */

  // @ANCHOR: CONFIG_TIERS
  // --- API Tiers Konfiguration (Standardmäßig alle auf "free" gesetzt) ---
  const API_TIERS = {
    tmdb: {
      free: {
        tierName: "FREE (Standard TMDB v3/v4)",
        requestsPerDay: 100000,
        requestsPer10Sec: 400,
        description: "Kostenloses TMDB Developer-Kontingent (~40 Req/Sek)"
      },
      paid: {
        tierName: "PAID (TMDB Commercial Enterprise)",
        requestsPerDay: 2500000,
        requestsPer10Sec: 2000,
        description: "Kommerzielles High-Volume Kontingent"
      }
    },
    cloudflare: {
      free: {
        tierName: "FREE (Workers, KV & D1 Free Plan)",
        requestsPerDay: 100000,
        kvReadsPerDay: 100000,
        kvWritesPerDay: 1000,
        d1ReadsPerDay: 5000000,
        d1WritesPerDay: 100000,
        description: "100k Worker-Req, 5 Mio. D1-Reads, 100k D1-Writes & 100k KV-Reads / Tag"
      },
      paid: {
        tierName: "PAID (Workers Paid $5/m)",
        requestsPerDay: 10000000,
        kvReadsPerDay: 10000000,
        kvWritesPerDay: 1000000,
        d1ReadsPerDay: 100000000,
        d1WritesPerDay: 50000000,
        description: "10 Mio. Worker-Req, 100 Mio. D1-Reads & 1 Mio. KV-Writes"
      }
    },
    telegram: {
      free: {
        tierName: "FREE (Standard Bot API)",
        requestsPerDay: 250000,
        requestsPerSec: 30,
        description: "Bis zu 30 Nachrichten/Sekunde kostenlos"
      },
      paid: {
        tierName: "PAID (Telegram Local Bot Server / High-Throughput)",
        requestsPerDay: 5000000,
        requestsPerSec: 150,
        description: "Erhöhtes Durchsatz-Limit über dedizierte Instanz"
      }
    },
    translator: {
      free: {
        tierName: "FREE (GTX / Clients5 / MyMemory Fallback)",
        requestsPerDay: 5000,
        description: "Kostenlose Multi-Engine Übersetzung (bis 5.000 Aufrufe/Tag)"
      },
      paid: {
        tierName: "PAID (Cloud Translation API Pro)",
        requestsPerDay: 500000,
        description: "Dediziertes kommerzielles Übersetzungs-Kontingent"
      }
    }
  };

  const DEFAULT_ACTIVE_TIERS = {
    tmdb: "free",
    cloudflare: "free",
    telegram: "free",
    translator: "free"
  };

  const ADMIN_SECRET_COMMAND = "/stats xyz";

  // Kurze, mobile-sichere Trennlinie (bricht auf keinem Smartphone um!)
  const SEP = "━━━━━━━━━━━━━━";

  // @ANCHOR: COLLECTIONS_UNIVERSES
  // Beliebte Filmreihen (TMDB Collection IDs) zum direkten Stöbern im Hauptmenü
  const FEATURED_COLLECTIONS = [
    { id: 119, name: "Der Herr der Ringe", icon: "💍" },
    { id: 1241, name: "Harry Potter", icon: "⚡" },
    { id: 10, name: "Star Wars", icon: "⚔️" },
    { id: 86311, name: "The Avengers (Marvel)", icon: "🛡️" },
    { id: 263, name: "The Dark Knight (Batman)", icon: "🦇" },
    { id: 645, name: "James Bond 007", icon: "🍸" },
    { id: 9485, name: "Fast & Furious", icon: "🏎️" },
    { id: 404609, name: "John Wick", icon: "✏️" },
    { id: 2344, name: "Matrix", icon: "🕶️" },
    { id: 295, name: "Fluch der Karibik", icon: "🏴‍☠️" },
    { id: 87359, name: "Mission: Impossible", icon: "💣" },
    { id: 328, name: "Jurassic Park / World", icon: "🦖" },
    { id: 726871, name: "Dune", icon: "🏜️" },
    { id: 121938, name: "Der Hobbit", icon: "🐉" },
    { id: 131635, name: "Die Tribute von Panem", icon: "🏹" },
    { id: 264, name: "Zurück in die Zukunft", icon: "⚡" },
    { id: 84, name: "Indiana Jones", icon: "🤠" },
    { id: 531241, name: "Spider-Man (MCU)", icon: "🕷️" },
    { id: 748, name: "X-Men", icon: "🧬" },
    { id: 8650, name: "Transformers", icon: "🤖" },
    { id: 1575, name: "Rocky", icon: "🥊" },
    { id: 8091, name: "Alien", icon: "👽" },
    { id: 528, name: "Terminator", icon: "🦾" },
    { id: 173710, name: "Planet der Affen", icon: "🦍" },
    { id: 10194, name: "Toy Story", icon: "🤠" },
    { id: 2150, name: "Shrek", icon: "🟢" },
    { id: 8354, name: "Ice Age", icon: "🦣" },
    { id: 656, name: "Saw", icon: "🪚" },
    { id: 2602, name: "Scream", icon: "👻" },
    { id: 304, name: "Ocean's", icon: "🎰" }
  ];

  // Filmuniversen (kombinieren mehrere Filmreihen & Spin-Offs zu einem kompletten Universum!)
  const CINEMATIC_UNIVERSES = [
    {
      id: "mcu",
      name: "Marvel Cinematic Universe (MCU)",
      icon: "🌌",
      description: "Avengers, Iron Man, Captain America, Thor, Guardians, Spider-Man, Doctor Strange, Black Panther & Deadpool",
      collectionIds: [86311, 131292, 131295, 131296, 284433, 531241, 422834, 618529, 529892, 448150],
      movieIds: [1724, 497698, 566525, 524434]
    },
    {
      id: "dcu",
      name: "DC Universe (DCEU & Dark Knight)",
      icon: "🦇",
      description: "The Dark Knight, Man of Steel, Justice League, Wonder Woman, Aquaman, Suicide Squad, Shazam, The Batman & Joker",
      collectionIds: [263, 209131, 468552, 531242, 573693, 724848],
      movieIds: [414906, 475557, 791373, 436270, 298618]
    },
    {
      id: "starwars",
      name: "Star Wars Universum (Komplett)",
      icon: "🪐",
      description: "Skywalker-Saga (Episoden I–IX) sowie Rogue One, Solo & The Clone Wars",
      collectionIds: [10],
      movieIds: [330459, 348350, 12180]
    },
    {
      id: "middleearth",
      name: "Mittelerde (Herr der Ringe & Hobbit)",
      icon: "💍",
      description: "Alle Teile von Der Herr der Ringe & Der Hobbit in Mittelerde",
      collectionIds: [119, 121938],
      movieIds: [839033]
    },
    {
      id: "wizarding",
      name: "Wizarding World (Harry Potter & Tierwesen)",
      icon: "⚡",
      description: "Alle 8 Harry-Potter-Filme sowie die Phantastische-Tierwesen-Reihe",
      collectionIds: [1241, 435259],
      movieIds: []
    },
    {
      id: "conjuring",
      name: "The Conjuring Universum",
      icon: "👻",
      description: "The Conjuring, Annabelle & The Nun im gemeinsamen Horror-Universum",
      collectionIds: [313086, 402074, 968052],
      movieIds: [480414]
    },
    {
      id: "monsterverse",
      name: "MonsterVerse (Godzilla & Kong)",
      icon: "🦖",
      description: "Godzilla, Kong: Skull Island, King of the Monsters, Godzilla vs. Kong & The New Empire",
      collectionIds: [535313],
      movieIds: [293167]
    },
    {
      id: "fastfurious",
      name: "Fast & Furious Universum",
      icon: "🏎️",
      description: "Die komplette Fast-&-Furious-Hauptreihe inklusive dem Spin-Off Hobbs & Shaw",
      collectionIds: [9485],
      movieIds: [384018]
    },
    {
      id: "alienpredator",
      name: "Alien & Predator Universum",
      icon: "👽",
      description: "Alle Alien-Filme, Predator-Filme sowie die Alien-vs.-Predator-Crossover",
      collectionIds: [8091, 399, 115762],
      movieIds: []
    },
    {
      id: "xmen",
      name: "X-Men, Wolverine & Deadpool Universum",
      icon: "🧬",
      description: "Alle X-Men-Kinofilme, die Wolverine/Logan-Trilogie sowie die Deadpool-Reihe",
      collectionIds: [748, 453993, 448150],
      movieIds: [340102]
    },
    {
      id: "rockycreed",
      name: "Rocky & Creed Universum",
      icon: "🥊",
      description: "Alle Rocky-Klassiker kombiniert mit der modernen Creed-Reihe",
      collectionIds: [1575, 553717],
      movieIds: []
    },
    {
      id: "johnwick",
      name: "John Wick Universum",
      icon: "✏️",
      description: "Alle John-Wick-Kapitel und Spin-Offs aus der Welt des Continental",
      collectionIds: [404609],
      movieIds: [541671]
    }
  ];

  // @ANCHOR: GENRES_SYNONYMS
  // --- Genre Definitionen (TMDB Offizielle IDs) ---
  const MOVIE_GENRES = {
    "Action": 28,
    "Abenteuer": 12,
    "Animation": 16,
    "Dokumentation": 99,
    "Drama": 18,
    "Familie": 10751,
    "Fantasy": 14,
    "Historie": 36,
    "Horror": 27,
    "Komödie": 35,
    "Kriegsfilm": 10752,
    "Krimi": 80,
    "Liebesfilm": 10749,
    "Musik": 10402,
    "Mystery": 9648,
    "Sci-Fi": 878,
    "Thriller": 53,
    "Western": 37,
  };

  const SERIES_GENRES = {
    "Action & Adventure": 10759,
    "Animation": 16,
    "Dokumentation": 99,
    "Drama": 18,
    "Familie": 10751,
    "Kids": 10762,
    "Komödie": 35,
    "Krimi": 80,
    "Mystery": 9648,
    "News": 10763,
    "Reality": 10764,
    "Sci-Fi & Fantasy": 10765,
    "Soap": 10766,
    "Talk": 10767,
    "War & Politics": 10768,
    "Western": 37,
  };

  const ALL_GENRE_ID_TO_NAME = {};
  for (const [n, id] of Object.entries(MOVIE_GENRES)) ALL_GENRE_ID_TO_NAME[id] = n;
  for (const [n, id] of Object.entries(SERIES_GENRES)) ALL_GENRE_ID_TO_NAME[id] = n;

  // --- Automatische Genre-Synonym-Umschreibung (z.B. Fantasie -> Fantasy, Komödie -> Comedy/Komödie) ---
  const GENRE_SYNONYM_MAP = {
    "fantasie": { canonicalMovie: "Fantasy", canonicalSeries: "Sci-Fi & Fantasy", searchRewrite: "Fantasy" },
    "fantasy": { canonicalMovie: "Fantasy", canonicalSeries: "Sci-Fi & Fantasy", searchRewrite: "Fantasy" },
    "komoedie": { canonicalMovie: "Komödie", canonicalSeries: "Komödie", searchRewrite: "Comedy" },
    "komodie": { canonicalMovie: "Komödie", canonicalSeries: "Komödie", searchRewrite: "Comedy" },
    "komödie": { canonicalMovie: "Komödie", canonicalSeries: "Komödie", searchRewrite: "Comedy" },
    "comedie": { canonicalMovie: "Komödie", canonicalSeries: "Komödie", searchRewrite: "Comedy" },
    "comedy": { canonicalMovie: "Komödie", canonicalSeries: "Komödie", searchRewrite: "Comedy" },
    "lustig": { canonicalMovie: "Komödie", canonicalSeries: "Komödie", searchRewrite: "Comedy" },
    "scifi": { canonicalMovie: "Sci-Fi", canonicalSeries: "Sci-Fi & Fantasy", searchRewrite: "Science Fiction" },
    "sciencefiction": { canonicalMovie: "Sci-Fi", canonicalSeries: "Sci-Fi & Fantasy", searchRewrite: "Science Fiction" },
    "sci-fi": { canonicalMovie: "Sci-Fi", canonicalSeries: "Sci-Fi & Fantasy", searchRewrite: "Science Fiction" },
    "zukunft": { canonicalMovie: "Sci-Fi", canonicalSeries: "Sci-Fi & Fantasy", searchRewrite: "Science Fiction" },
    "abenteuer": { canonicalMovie: "Abenteuer", canonicalSeries: "Action & Adventure", searchRewrite: "Adventure" },
    "adventure": { canonicalMovie: "Abenteuer", canonicalSeries: "Action & Adventure", searchRewrite: "Adventure" },
    "aktion": { canonicalMovie: "Action", canonicalSeries: "Action & Adventure", searchRewrite: "Action" },
    "action": { canonicalMovie: "Action", canonicalSeries: "Action & Adventure", searchRewrite: "Action" },
    "krimi": { canonicalMovie: "Krimi", canonicalSeries: "Krimi", searchRewrite: "Crime" },
    "crime": { canonicalMovie: "Krimi", canonicalSeries: "Krimi", searchRewrite: "Crime" },
    "liebe": { canonicalMovie: "Liebesfilm", canonicalSeries: "Drama", searchRewrite: "Romance" },
    "liebesfilm": { canonicalMovie: "Liebesfilm", canonicalSeries: "Drama", searchRewrite: "Romance" },
    "romantik": { canonicalMovie: "Liebesfilm", canonicalSeries: "Drama", searchRewrite: "Romance" },
    "romance": { canonicalMovie: "Liebesfilm", canonicalSeries: "Drama", searchRewrite: "Romance" },
    "grusel": { canonicalMovie: "Horror", canonicalSeries: "Mystery", searchRewrite: "Horror" },
    "horror": { canonicalMovie: "Horror", canonicalSeries: "Mystery", searchRewrite: "Horror" },
    "krieg": { canonicalMovie: "Kriegsfilm", canonicalSeries: "War & Politics", searchRewrite: "War" },
    "kriegsfilm": { canonicalMovie: "Kriegsfilm", canonicalSeries: "War & Politics", searchRewrite: "War" },
    "war": { canonicalMovie: "Kriegsfilm", canonicalSeries: "War & Politics", searchRewrite: "War" },
    "doku": { canonicalMovie: "Dokumentation", canonicalSeries: "Dokumentation", searchRewrite: "Documentary" },
    "dokumentation": { canonicalMovie: "Dokumentation", canonicalSeries: "Dokumentation", searchRewrite: "Documentary" },
    "documentary": { canonicalMovie: "Dokumentation", canonicalSeries: "Dokumentation", searchRewrite: "Documentary" },
    "zeichentrick": { canonicalMovie: "Animation", canonicalSeries: "Animation", searchRewrite: "Animation" },
    "anime": { canonicalMovie: "Animation", canonicalSeries: "Animation", searchRewrite: "Anime" },
    "animation": { canonicalMovie: "Animation", canonicalSeries: "Animation", searchRewrite: "Animation" },
    "geschichte": { canonicalMovie: "Historie", canonicalSeries: "Drama", searchRewrite: "History" },
    "historie": { canonicalMovie: "Historie", canonicalSeries: "Drama", searchRewrite: "History" },
    "history": { canonicalMovie: "Historie", canonicalSeries: "Drama", searchRewrite: "History" },
    "familie": { canonicalMovie: "Familie", canonicalSeries: "Familie", searchRewrite: "Family" },
    "family": { canonicalMovie: "Familie", canonicalSeries: "Familie", searchRewrite: "Family" },
    "kinder": { canonicalMovie: "Familie", canonicalSeries: "Kids", searchRewrite: "Kids" },
    "kids": { canonicalMovie: "Familie", canonicalSeries: "Kids", searchRewrite: "Kids" },
    "musik": { canonicalMovie: "Musik", canonicalSeries: "Talk", searchRewrite: "Music" },
    "music": { canonicalMovie: "Musik", canonicalSeries: "Talk", searchRewrite: "Music" },
    "thriller": { canonicalMovie: "Thriller", canonicalSeries: "Mystery", searchRewrite: "Thriller" },
    "mystery": { canonicalMovie: "Mystery", canonicalSeries: "Mystery", searchRewrite: "Mystery" },
    "drama": { canonicalMovie: "Drama", canonicalSeries: "Drama", searchRewrite: "Drama" },
    "western": { canonicalMovie: "Western", canonicalSeries: "Western", searchRewrite: "Western" }
  };

  const FSK_OPTIONS = ["FSK 0", "FSK 6", "FSK 12", "FSK 16", "FSK 18", "FSK Keine Angabe"];

  // Passende Emojis für jedes Genre (Bot & Mini-App)
  const GENRE_EMOJIS = {
    "Action": "💥",
    "Action & Adventure": "💥",
    "Abenteuer": "🧭",
    "Animation": "🎨",
    "Dokumentation": "📽️",
    "Drama": "🎭",
    "Familie": "👨‍👩‍👧‍👦",
    "Kids": "🧸",
    "Fantasy": "🧙‍♂️",
    "Sci-Fi & Fantasy": "🛸",
    "Historie": "🏛️",
    "Horror": "👻",
    "Komödie": "😂",
    "Kriegsfilm": "🪖",
    "War & Politics": "🪖",
    "Krimi": "🕵️",
    "Liebesfilm": "❤️",
    "Musik": "🎵",
    "Mystery": "🔍",
    "Sci-Fi": "🚀",
    "Thriller": "🔪",
    "Western": "🤠",
    "News": "📰",
    "Reality": "📹",
    "Soap": "💞",
    "Talk": "🎙️"
  };

  function getGenreEmoji(genreName) {
    return GENRE_EMOJIS[genreName] || "🎞️";
  }

  // Epochen / Jahres-Filterbereiche
  const ERA_OPTIONS = [
    { id: "pre_1990", label: "Vor 1990", min: 0, max: 1989 },
    { id: "1990_1999", label: "1990 – 1999", min: 1990, max: 1999 },
    { id: "2000_2009", label: "2000 – 2009", min: 2000, max: 2009 },
    { id: "2010_2019", label: "2010 – 2019", min: 2010, max: 2019 },
    { id: "2020_plus", label: "2020+", min: 2020, max: 9999 }
  ];

  // Filmstudios (TMDB Production Companies / Networks) für Include/Exclude-Filter
  const STUDIO_OPTIONS = [
    { id: "marvel", label: "Marvel Studios", icon: "🛡️", companyIds: [420, 19551, 7505], match: ["marvel"] },
    { id: "disney", label: "Walt Disney", icon: "🏰", companyIds: [2, 6125], match: ["walt disney", "disney"] },
    { id: "pixar", label: "Pixar", icon: "💡", companyIds: [3], match: ["pixar"] },
    { id: "warner", label: "Warner Bros.", icon: "🎬", companyIds: [174, 12], match: ["warner", "new line"] },
    { id: "dc", label: "DC Studios", icon: "🦇", companyIds: [9993, 128064, 429], match: ["dc entertainment", "dc films", "dc studios", "dc comics"] },
    { id: "universal", label: "Universal Pictures", icon: "🌍", companyIds: [33], match: ["universal"] },
    { id: "paramount", label: "Paramount", icon: "🏔️", companyIds: [4], match: ["paramount"] },
    { id: "sony", label: "Sony / Columbia", icon: "🗽", companyIds: [5, 34, 559], match: ["sony", "columbia", "tristar"] },
    { id: "fox", label: "20th Century Studios", icon: "🔦", companyIds: [25, 127928], match: ["20th century", "twentieth century"] },
    { id: "a24", label: "A24", icon: "🅰️", companyIds: [41077], match: ["a24"] },
    { id: "blumhouse", label: "Blumhouse", icon: "🏚️", companyIds: [3172], match: ["blumhouse"] },
    { id: "lionsgate", label: "Lionsgate", icon: "🦁", companyIds: [1632], match: ["lionsgate"] },
    { id: "dreamworks", label: "DreamWorks", icon: "🌙", companyIds: [7, 521], match: ["dreamworks"] },
    { id: "ghibli", label: "Studio Ghibli", icon: "🌱", companyIds: [10342], match: ["ghibli"] },
    { id: "lucasfilm", label: "Lucasfilm", icon: "⚔️", companyIds: [1], match: ["lucasfilm"] },
    { id: "mgm", label: "MGM", icon: "🐾", companyIds: [21], match: ["metro-goldwyn-mayer", "mgm"] }
  ];

  // Streaming-Plattformen (TMDB Watch Providers DE) für Include/Exclude-Filter & Direkt-Öffnen-Buttons
  const PLATFORM_OPTIONS = [
    { id: "netflix", label: "Netflix", shortLabel: "Netflix", icon: "🔴", bg: "rgba(229,9,20,0.22)", border: "#e50914", providerIds: [8], match: ["netflix"], buildUrl: (q) => `https://www.netflix.com/search?q=${encodeURIComponent(q)}` },
    { id: "disneyplus", label: "Disney+", shortLabel: "Disney+", icon: "✨", bg: "rgba(0,114,210,0.22)", border: "#38bdf8", providerIds: [337], match: ["disney plus", "disney+"], buildUrl: (q) => `https://www.disneyplus.com/de-de/browse/search?q=${encodeURIComponent(q)}` },
    { id: "prime", label: "Amazon Prime Video", shortLabel: "Prime Video", icon: "📦", bg: "rgba(0,168,225,0.22)", border: "#00a8e1", providerIds: [9, 119], match: ["amazon prime", "prime video", "amazon video"], buildUrl: (q) => `https://www.amazon.de/s?k=${encodeURIComponent(q)}&i=instant-video` },
    { id: "appletv", label: "Apple TV+", shortLabel: "Apple TV+", icon: "🍎", bg: "rgba(255,255,255,0.14)", border: "#a1a1aa", providerIds: [350, 2], match: ["apple tv"], buildUrl: (q) => `https://tv.apple.com/de/search?term=${encodeURIComponent(q)}` },
    { id: "wow", label: "Sky / WOW", shortLabel: "WOW", icon: "🌌", bg: "rgba(16,185,129,0.2)", border: "#10b981", providerIds: [30, 170, 130], match: ["wow", "sky"], buildUrl: (q) => `https://www.wowtv.de/suche?q=${encodeURIComponent(q)}` },
    { id: "paramountplus", label: "Paramount+", shortLabel: "Paramount+", icon: "⛰️", bg: "rgba(37,99,235,0.22)", border: "#3b82f6", providerIds: [531], match: ["paramount+"], buildUrl: (q) => `https://www.paramountplus.com/de/search/?q=${encodeURIComponent(q)}` },
    { id: "crunchyroll", label: "Crunchyroll", shortLabel: "Crunchyroll", icon: "🍥", bg: "rgba(249,115,22,0.22)", border: "#f97316", providerIds: [283], match: ["crunchyroll"], buildUrl: (q) => `https://www.crunchyroll.com/de/search?q=${encodeURIComponent(q)}` },
    { id: "rtlplus", label: "RTL+", shortLabel: "RTL+", icon: "📺", bg: "rgba(236,72,153,0.2)", border: "#ec4899", providerIds: [298], match: ["rtl+"], buildUrl: (q) => `https://plus.rtl.de/suche?term=${encodeURIComponent(q)}` },
    { id: "joyn", label: "Joyn", shortLabel: "Joyn", icon: "🎉", bg: "rgba(168,85,247,0.2)", border: "#a855f7", providerIds: [304, 421], match: ["joyn"], buildUrl: (q) => `https://www.joyn.de/suche?q=${encodeURIComponent(q)}` },
    { id: "magentatv", label: "MagentaTV", shortLabel: "MagentaTV", icon: "🩷", bg: "rgba(226,0,116,0.22)", border: "#e20074", providerIds: [178], match: ["magentatv", "magenta"], buildUrl: (q) => `https://web.magentatv.de/suche?q=${encodeURIComponent(q)}` },
    { id: "ard_zdf", label: "ARD / ZDF", shortLabel: "Mediathek", icon: "🇩🇪", bg: "rgba(59,130,246,0.2)", border: "#60a5fa", providerIds: [219, 537], match: ["ard", "zdf"], buildUrl: (q) => `https://www.ardmediathek.de/suche/${encodeURIComponent(q)}` },
    { id: "mubi", label: "MUBI", shortLabel: "MUBI", icon: "🎞️", bg: "rgba(99,102,241,0.2)", border: "#6366f1", providerIds: [11], match: ["mubi"], buildUrl: (q) => `https://mubi.com/de/search/films?query=${encodeURIComponent(q)}` }
  ];

  function matchPlatformKeyword(textLower, keyword) {
    if (!textLower || !keyword) return false;
    const kw = String(keyword).toLowerCase().trim();
    if (!kw) return false;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`(?:^|[^a-z0-9äöüß])${escaped}(?:$|[^a-z0-9äöüß])`, "i");
    return rx.test(textLower);
  }

  function cleanAndDedupeProviderNames(rawProvidersStr) {
    if (!rawProvidersStr || rawProvidersStr === "Keine Angabe" || rawProvidersStr === "Derzeit keine Flatrate bekannt") {
      return [];
    }
    const rawParts = String(rawProvidersStr)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const part of rawParts) {
      let cleaned = part
        .replace(/\s+(?:standard\s+with\s+ads|basic\s+with\s+ads|with\s+ads|amazon\s+channel|apple\s+tv\s+channel|plus\s+channel|channel)$/i, "")
        .trim();
      const low = cleaned.toLowerCase();
      for (const pl of PLATFORM_OPTIONS) {
        if (pl.match.some(m => matchPlatformKeyword(low, m)) || low === pl.label.toLowerCase()) {
          cleaned = pl.shortLabel || pl.label;
          break;
        }
      }
      const key = cleaned.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
    return out;
  }

  // Erzeugt direkte "In Netflix öffnen", "In Disney+ öffnen" usw. Buttons anhand der verfügbaren Watch-Provider
  function buildStreamingProviderButtons(details) {
    if (!details) return [];
    const cleanTitle = String(details.title || details.name || "").replace(/\s*\(\d{4}\)$/, "").trim();
    if (!cleanTitle) return [];

    // Bevorzuge Flatrate-Anbieter (details.providers), ansonsten fallback auf alle Provider
    const flatrateLower = String(details.providers || "").toLowerCase();
    const allLower = String(details.allProviders || details.providers || "").toLowerCase();
    const providerIds = Array.isArray(details.providerIds) ? details.providerIds.map(Number) : [];

    const matchedFlatrate = [];
    const matchedOther = [];

    for (const pl of PLATFORM_OPTIONS) {
      const nameHitFlat = flatrateLower && pl.match.some(m => matchPlatformKeyword(flatrateLower, m));
      const idHit = providerIds.some(id => pl.providerIds.includes(id));
      const nameHitAll = allLower && pl.match.some(m => matchPlatformKeyword(allLower, m));

      if (nameHitFlat || idHit || nameHitAll) {
        const entry = {
          id: pl.id,
          label: pl.label,
          shortLabel: pl.shortLabel || pl.label,
          icon: pl.icon || "📺",
          buttonText: `${pl.icon || "📺"} In ${pl.shortLabel || pl.label} öffnen`,
          url: pl.buildUrl(cleanTitle),
          bg: pl.bg || "rgba(229,9,20,0.2)",
          border: pl.border || "#e50914",
          isFlatrate: Boolean(nameHitFlat)
        };
        if (nameHitFlat) matchedFlatrate.push(entry);
        else matchedOther.push(entry);
      }
    }

    const combined = matchedFlatrate.length > 0 ? matchedFlatrate : matchedOther;
    return combined.slice(0, 3);
  }

  function cycleIncludeExcludeSetting(settings, incKey, excKey, itemId) {
    settings[incKey] = Array.isArray(settings[incKey]) ? settings[incKey] : [];
    settings[excKey] = Array.isArray(settings[excKey]) ? settings[excKey] : [];
    if (settings[incKey].includes(itemId)) {
      settings[incKey] = settings[incKey].filter(x => x !== itemId);
      if (!settings[excKey].includes(itemId)) settings[excKey].push(itemId);
      return "excluded";
    }
    if (settings[excKey].includes(itemId)) {
      settings[excKey] = settings[excKey].filter(x => x !== itemId);
      return "neutral";
    }
    settings[incKey].push(itemId);
    return "included";
  }

  function setDirectIncludeExcludeSetting(settings, incKey, excKey, itemId, targetMode) {
    settings[incKey] = Array.isArray(settings[incKey]) ? settings[incKey] : [];
    settings[excKey] = Array.isArray(settings[excKey]) ? settings[excKey] : [];
    const val = String(itemId);
    if (targetMode === "include") {
      if (settings[incKey].includes(val)) {
        settings[incKey] = settings[incKey].filter(x => x !== val);
        return "neutral";
      }
      settings[excKey] = settings[excKey].filter(x => x !== val);
      settings[incKey].push(val);
      return "included";
    }
    if (targetMode === "exclude") {
      if (settings[excKey].includes(val)) {
        settings[excKey] = settings[excKey].filter(x => x !== val);
        return "neutral";
      }
      settings[incKey] = settings[incKey].filter(x => x !== val);
      settings[excKey].push(val);
      return "excluded";
    }
    settings[incKey] = settings[incKey].filter(x => x !== val);
    settings[excKey] = settings[excKey].filter(x => x !== val);
    return "neutral";
  }

  function isItemReleased(item) {
    if (!item) return false;
    if (item.hasLocalStream || item.vipQuality || Number(item.latest_stream_at || 0) > 0) return true;
    const rawDate = String(item.release_date || item.first_air_date || item.releaseDate || "").trim();
    if (!rawDate || rawDate === "Keine Angabe" || rawDate === "K.A.") return false;
    const todayStr = new Date().toISOString().slice(0, 10);
    return rawDate <= todayStr;
  }

  function resolveGenreIdsFromNames(genreNames, targetMedia = "both") {
    const ids = new Set();
    if (!Array.isArray(genreNames)) return ids;
    for (const rawName of genreNames) {
      const name = String(rawName || "").trim();
      if (!name) continue;
      if (targetMedia !== "s" && MOVIE_GENRES[name]) ids.add(MOVIE_GENRES[name]);
      if (targetMedia !== "m" && SERIES_GENRES[name]) ids.add(SERIES_GENRES[name]);

      const norm = normalizeToken(name);
      const syn = GENRE_SYNONYM_MAP[norm] || GENRE_SYNONYM_MAP[name.toLowerCase()];
      if (syn) {
        if (targetMedia !== "s" && syn.canonicalMovie && MOVIE_GENRES[syn.canonicalMovie]) {
          ids.add(MOVIE_GENRES[syn.canonicalMovie]);
        }
        if (targetMedia !== "m" && syn.canonicalSeries && SERIES_GENRES[syn.canonicalSeries]) {
          ids.add(SERIES_GENRES[syn.canonicalSeries]);
        }
      }
      if (name === "Action & Adventure") {
        if (targetMedia !== "s") { ids.add(28); ids.add(12); }
        if (targetMedia !== "m") ids.add(10759);
      } else if (name === "Sci-Fi & Fantasy" || name === "Science Fiction" || name === "Sci-Fi") {
        if (targetMedia !== "s") ids.add(878);
        if (targetMedia !== "m") ids.add(10765);
      } else if (name === "War & Politics" || name === "Kriegsfilm") {
        if (targetMedia !== "s") ids.add(10752);
        if (targetMedia !== "m") ids.add(10768);
      }
    }
    return ids;
  }

  const PLATFORM_ID_ALIASES = {
    disney: "disneyplus",
    apple: "appletv",
    sky: "wow",
    paramount: "paramountplus",
    rtl: "rtlplus",
    magenta: "magentatv",
    ard: "ard_zdf",
    zdf: "ard_zdf"
  };

  function normalizePlatformId(pid) {
    const clean = String(pid || "").trim().toLowerCase();
    return PLATFORM_ID_ALIASES[clean] || clean;
  }

  const VALID_MOVIE_GENRE_IDS = new Set(Object.values(MOVIE_GENRES).map(Number));
  const VALID_SERIES_GENRE_IDS = new Set(Object.values(SERIES_GENRES).map(Number));

  // Verhindert ungültige TMDb /discover-Abfragen (z.B. Film-Genre-ID 28 an /discover/tv -> immer 0 Treffer!)
  function mapExplicitGenreIdForMedia(rawGenreId, isMovie = true) {
    const clean = String(rawGenreId || "").trim();
    if (!clean || clean === "all" || clean === "random_all") return [];
    const num = Number(clean);
    if (!Number.isFinite(num) || num <= 0) return [];
    if (isMovie) {
      if (VALID_MOVIE_GENRE_IDS.has(num)) return [num];
      if (num === 10759) return [28, 12]; // Action & Adventure -> Action | Abenteuer
      if (num === 10765) return [878, 14]; // Sci-Fi & Fantasy -> Sci-Fi | Fantasy
      if (num === 10768) return [10752]; // War & Politics -> Kriegsfilm
      if (num === 10762) return [10751, 16]; // Kids -> Familie | Animation
      return [];
    } else {
      if (VALID_SERIES_GENRE_IDS.has(num)) return [num];
      if (num === 28 || num === 12) return [10759]; // Action / Abenteuer -> Action & Adventure
      if (num === 878 || num === 14) return [10765]; // Sci-Fi / Fantasy -> Sci-Fi & Fantasy
      if (num === 10752) return [10768]; // Kriegsfilm -> War & Politics
      if (num === 27 || num === 53) return [9648]; // Horror / Thriller -> Mystery (nächste gültige TV-Genre-ID)
      if (num === 10749 || num === 36) return [18]; // Liebesfilm / Historie -> Drama
      return [];
    }
  }

  function buildTmdbStudioAndPlatformParams(userSettings, isMovie = true, explicitGenreId = "all") {
    let params = "";
    const todayStr = new Date().toISOString().slice(0, 10);
    const showUnreleased = Boolean(userSettings && userSettings.showUnreleased);
    const mappedExplicitGenreIds = mapExplicitGenreIdForMedia(explicitGenreId, isMovie);
    const explicitCompanyId = userSettings && userSettings.explicitCompanyId
      ? String(userSettings.explicitCompanyId).trim()
      : "";

    if (!userSettings || userSettings.filtersActive === false) {
      if (mappedExplicitGenreIds.length > 0) params += `&with_genres=${mappedExplicitGenreIds.join("|")}`;
      if (explicitCompanyId) params += `&with_companies=${encodeURIComponent(explicitCompanyId)}`;
      if (!showUnreleased) {
        params += isMovie ? `&primary_release_date.lte=${todayStr}` : `&first_air_date.lte=${todayStr}`;
      }
      return params;
    }

    const incStudios = Array.isArray(userSettings.includedStudios) ? userSettings.includedStudios : [];
    const excStudios = Array.isArray(userSettings.excludedStudios) ? userSettings.excludedStudios : [];
    const incPlatforms = Array.isArray(userSettings.includedPlatforms) ? userSettings.includedPlatforms.map(normalizePlatformId) : [];
    const excPlatforms = Array.isArray(userSettings.excludedPlatforms) ? userSettings.excludedPlatforms.map(normalizePlatformId) : [];
    const incGenres = Array.isArray(userSettings.includedGenres) ? userSettings.includedGenres : [];
    const excGenres = Array.isArray(userSettings.excludedGenres) ? userSettings.excludedGenres : [];
    const incEras = Array.isArray(userSettings.includedEras) ? userSettings.includedEras : [];
    const excEras = Array.isArray(userSettings.excludedEras) ? userSettings.excludedEras : [];
    const incFsk = Array.isArray(userSettings.includedFsk) ? userSettings.includedFsk : [];
    const excFsk = Array.isArray(userSettings.excludedFsk) ? userSettings.excludedFsk : [];

    const targetMedia = isMovie ? "m" : "s";
    const resolvedIncGenreIds = resolveGenreIdsFromNames(incGenres, targetMedia);
    for (const mgid of mappedExplicitGenreIds) resolvedIncGenreIds.add(mgid);
    if (resolvedIncGenreIds.size > 0) {
      params += `&with_genres=${Array.from(resolvedIncGenreIds).join("|")}`;
    }
    const resolvedExcGenreIds = resolveGenreIdsFromNames(excGenres, targetMedia);
    if (resolvedExcGenreIds.size > 0) {
      // TMDb v3: Pipe (|) = OR (jedes einzelne ausgeschlossene Genre blockieren; Komma wäre AND!)
      params += `&without_genres=${Array.from(resolvedExcGenreIds).join("|")}`;
    }
    if (incStudios.length > 0 || explicitCompanyId) {
      const ids = STUDIO_OPTIONS.filter(s => incStudios.includes(s.id)).flatMap(s => s.companyIds);
      if (explicitCompanyId) ids.push(explicitCompanyId);
      if (ids.length > 0) params += `&with_companies=${Array.from(new Set(ids)).join("|")}`;
    }
    if (excStudios.length > 0) {
      const ids = Array.from(new Set(STUDIO_OPTIONS.filter(s => excStudios.includes(s.id)).flatMap(s => s.companyIds)));
      // TMDb v3: Pipe (|) = OR (jedes Studio/Sub-Label einzeln ausschließen; Komma würde erfordern, dass ALLE IDs gleichzeitig im Film vorkommen!)
      if (ids.length > 0) params += `&without_companies=${ids.join("|")}`;
    }
    if (incPlatforms.length > 0 || excPlatforms.length > 0) {
      params += `&watch_region=DE`;
      if (incPlatforms.length > 0) {
        const ids = PLATFORM_OPTIONS.filter(p => incPlatforms.includes(p.id)).flatMap(p => p.providerIds);
        if (ids.length > 0) params += `&with_watch_providers=${ids.join("|")}`;
      }
      if (excPlatforms.length > 0) {
        const ids = PLATFORM_OPTIONS.filter(p => excPlatforms.includes(p.id)).flatMap(p => p.providerIds);
        if (ids.length > 0) params += `&without_watch_providers=${ids.join("|")}`;
      }
    }
    if (isMovie && (incFsk.length > 0 || excFsk.length > 0)) {
      const allFskMap = [
        { label: "FSK 0", cert: "0" },
        { label: "FSK 6", cert: "6" },
        { label: "FSK 12", cert: "12" },
        { label: "FSK 16", cert: "16" },
        { label: "FSK 18", cert: "18" }
      ];
      let allowedCerts = incFsk.length > 0
        ? allFskMap.filter(f => incFsk.includes(f.label)).map(f => f.cert)
        : allFskMap.map(f => f.cert);
      if (excFsk.length > 0) {
        const blocked = new Set(allFskMap.filter(f => excFsk.includes(f.label)).map(f => f.cert));
        allowedCerts = allowedCerts.filter(c => !blocked.has(c));
      }
      if (allowedCerts.length > 0 && allowedCerts.length < allFskMap.length) {
        params += `&certification_country=DE&certification=${allowedCerts.join("|")}`;
      }
      if (excFsk.includes("FSK 18")) {
        params += `&include_adult=false`;
      }
    }
    const activeEras = incEras.length > 0
      ? ERA_OPTIONS.filter(e => incEras.includes(e.id) && !excEras.includes(e.id))
      : (excEras.length > 0 ? ERA_OPTIONS.filter(e => !excEras.includes(e.id)) : []);
    if (activeEras.length > 0) {
      const minYr = Math.max(1900, Math.min(...activeEras.map(e => e.min)));
      const maxYr = Math.max(...activeEras.map(e => e.max));
      const minDate = `${minYr}-01-01`;
      const maxDate = (maxYr >= 9000 || (!showUnreleased && `${maxYr}-12-31` > todayStr)) ? todayStr : `${maxYr}-12-31`;
      params += isMovie
        ? `&primary_release_date.gte=${minDate}&primary_release_date.lte=${maxDate}`
        : `&first_air_date.gte=${minDate}&first_air_date.lte=${maxDate}`;
    } else if (!showUnreleased) {
      params += isMovie ? `&primary_release_date.lte=${todayStr}` : `&first_air_date.lte=${todayStr}`;
    }
    return params;
  }

  function matchesStudioAndPlatformFilter(details, userSettings) {
    if (!details || !userSettings || userSettings.filtersActive === false) return true;
    const incStudios = Array.isArray(userSettings.includedStudios) ? userSettings.includedStudios : [];
    const excStudios = Array.isArray(userSettings.excludedStudios) ? userSettings.excludedStudios : [];
    const incPlatforms = Array.isArray(userSettings.includedPlatforms) ? userSettings.includedPlatforms.map(normalizePlatformId) : [];
    const excPlatforms = Array.isArray(userSettings.excludedPlatforms) ? userSettings.excludedPlatforms.map(normalizePlatformId) : [];

    const hasStudioMeta = Array.isArray(details.studiosList) || Boolean(details.studios && details.studios !== "Keine Angabe");
    const studioIds = new Set((details.studiosList || []).map(s => Number(s.id)));
    const studioText = String(details.studios || "").toLowerCase();
    const matchStudioOpt = (opt) => {
      if (opt.companyIds.some(cid => studioIds.has(Number(cid)))) return true;
      return opt.match.some(m => studioText.includes(m));
    };

    if (excStudios.length > 0 && hasStudioMeta) {
      const isExc = STUDIO_OPTIONS.filter(s => excStudios.includes(s.id)).some(matchStudioOpt);
      if (isExc) return false;
    }
    if (incStudios.length > 0 && hasStudioMeta) {
      const isInc = STUDIO_OPTIONS.filter(s => incStudios.includes(s.id)).some(matchStudioOpt);
      if (!isInc) return false;
    }

    const hasProvMeta = Array.isArray(details.providerIds) || Boolean((details.allProviders || details.providers) && (details.allProviders || details.providers) !== "Derzeit keine Flatrate bekannt");
    const provIds = new Set((details.providerIds || []).map(Number));
    const provText = String(details.allProviders || details.providers || "").toLowerCase();
    const matchPlatformOpt = (opt) => {
      if (opt.providerIds.some(pid => provIds.has(Number(pid)))) return true;
      return opt.match.some(m => matchPlatformKeyword(provText, m));
    };

    if (excPlatforms.length > 0 && hasProvMeta) {
      const isExc = PLATFORM_OPTIONS.filter(p => excPlatforms.includes(p.id)).some(matchPlatformOpt);
      if (isExc) return false;
    }
    if (incPlatforms.length > 0 && hasProvMeta) {
      const isInc = PLATFORM_OPTIONS.filter(p => incPlatforms.includes(p.id)).some(matchPlatformOpt);
      if (!isInc) return false;
    }

    return true;
  }

  const PLACEHOLDER_POSTER = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&q=80";

  // @ANCHOR: CACHE_STATS
  // In-Memory Cache & State-Speicher (minimiert Cloudflare KV & TMDB API Calls drastisch!)
  // Im Browser-Simulator (AI Studio Vorschau) werden D1-/Playlist-/Import-Einträge automatisch über F5-Reloads hinweg persistiert.
  const SANDBOX_MEM_STORAGE_KEY = "__tma_sandbox_d1_memory_v1__";
  const memoryFallback = (() => {
    const map = new Map();
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    if (!isBrowserSandbox) {
      // Free-Plan RAM-Schutz (128MB Limit): Begrenze Isolate-Cache auf max. 1400 Einträge (verhindert Error 1102!)
      const MAX_WORKER_MEM_ENTRIES = 1400;
      const PROTECTED_KEYS = new Set([
        "TG_WEBHOOK_SECURITY_CONFIG_V1",
        "TG_VIDEO_COVER_MODE",
        "TG_WORKER_SPEED_PROFILE",
        "bot_username"
      ]);
      const origSetWorker = map.set.bind(map);
      map.set = (k, v) => {
        if (map.has(k)) {
          map.delete(k);
        } else if (map.size >= MAX_WORKER_MEM_ENTRIES) {
          let evicted = 0;
          for (const existingKey of map.keys()) {
            if (PROTECTED_KEYS.has(existingKey)) continue;
            map.delete(existingKey);
            evicted++;
            if (evicted >= 150) break;
          }
        }
        return origSetWorker(k, v);
      };
      return map;
    }

    const shouldPersistKey = (k) => {
      const s = String(k || "");
      return (
        s.startsWith("d1_") ||
        s.startsWith("user_") ||
        s.startsWith("folders_") ||
        s.startsWith("u_bundle_") ||
        s.startsWith("settings_") ||
        s.startsWith("json_import_") ||
        s.startsWith("tma_")
      ) && !s.endsWith("_ts") && !s.includes("_saved_ts_") && !s.includes("_lookup_cache");
    };

    try {
      const raw = localStorage.getItem(SANDBOX_MEM_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const [k, v] of parsed) {
            map.set(k, v);
          }
        }
      }
    } catch (e) {}

    let saveTimer = null;
    const scheduleSandboxPersist = () => {
      if (saveTimer) return;
      saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
          const entriesToSave = [];
          for (const [k, v] of map.entries()) {
            if (shouldPersistKey(k) && !(v instanceof Set) && !(v instanceof Map)) {
              entriesToSave.push([k, v]);
            }
          }
          localStorage.setItem(SANDBOX_MEM_STORAGE_KEY, JSON.stringify(entriesToSave));
        } catch (e) {}
      }, 250);
    };

    const origSet = map.set.bind(map);
    const origDelete = map.delete.bind(map);
    const origClear = map.clear.bind(map);
    map.set = (k, v) => {
      const res = origSet(k, v);
      if (shouldPersistKey(k)) scheduleSandboxPersist();
      return res;
    };
    map.delete = (k) => {
      const res = origDelete(k);
      if (shouldPersistKey(k)) scheduleSandboxPersist();
      return res;
    };
    map.clear = () => {
      origClear();
      try { localStorage.removeItem(SANDBOX_MEM_STORAGE_KEY); } catch (e) {}
    };
    return map;
  })();
  const tmdbCache = new Map();
  const tmdbMemoryCache = tmdbCache;
  const externalFallbackCache = (() => {
    const map = new Map();
    const MAX_EXT_CACHE_ENTRIES = 300;
    const origSet = map.set.bind(map);
    map.set = (k, v) => {
      if (map.has(k)) {
        map.delete(k);
      } else if (map.size >= MAX_EXT_CACHE_ENTRIES) {
        let evicted = 0;
        for (const oldKey of map.keys()) {
          map.delete(oldKey);
          evicted++;
          if (evicted >= 40) break;
        }
      }
      return origSet(k, v);
    };
    return map;
  })();

  // Globale String-Normalisierung für exakte und Teil-Vergleiche (verhindert ReferenceError in allen Worker- & Fallback-Scopes)
  function normalizeCompareString(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/½/g, " 1 2 ")
      .replace(/\b1\/2\b/g, " 1 2 ")
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(?:ii)\b/g, "2")
      .replace(/\b(?:iii)\b/g, "3")
      .replace(/\b(?:iv)\b/g, "4")
      .replace(/\b(?:v)\b/g, "5")
      .replace(/\b(?:vi)\b/g, "6")
      .replace(/\b(?:vii)\b/g, "7")
      .replace(/\b(?:viii)\b/g, "8")
      .replace(/\b(?:ix)\b/g, "9")
      .replace(/\b(?:x)\b/g, "10")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (typeof globalThis !== "undefined") {
    globalThis.normalizeCompareString = normalizeCompareString;
    globalThis.externalFallbackCache = externalFallbackCache;
    globalThis.__workerMemoryFallback = memoryFallback;
  }

  function getCachedTmdb(key) {
    const entry = tmdbCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) {
      tmdbCache.delete(key);
      return null;
    }
    return entry.val;
  }

  function setCachedTmdb(key, val, ttlMs = 1800000) {
    if (tmdbCache.size > 400) {
      const firstKey = tmdbCache.keys().next().value;
      if (firstKey) tmdbCache.delete(firstKey);
    }
    tmdbCache.set(key, { val, exp: Date.now() + ttlMs });
    return val;
  }

  // URL-Parameter inkl. Klammern ( ) sicher kodieren, damit Markdown-Links niemals bei "(Marvel)" o.ä. abbrechen!
  function safeEncodeParam(str) {
    return encodeURIComponent(String(str || ""))
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29")
      .replace(/'/g, "%27")
      .replace(/\*/g, "%2A");
  }

  // Kürzt überlange Ländernamen für saubere einzeilige Darstellung
  function shortenCountry(countryStr) {
    if (!countryStr || countryStr === "Keine Angabe") return "k.A.";
    const map = {
      "United States of America": "USA",
      "United Kingdom": "UK",
      "Germany": "Deutschland",
      "France": "Frankreich",
      "South Korea": "Südkorea",
      "Russian Federation": "Russland",
      "People's Republic of China": "China"
    };
    return map[countryStr] || countryStr;
  }

  // Prüft, ob es sich um eine Gruppe oder einen Kanal handelt ("✖️ Beenden" wird NUR dort angezeigt!)
  function registerChatType(chatObj) {
    if (chatObj && chatObj.id && chatObj.type) {
      memoryFallback.set(`chat_type_${chatObj.id}`, chatObj.type);
    }
  }

  function isGroupOrChannelChat(chatId) {
    const t = memoryFallback.get(`chat_type_${chatId}`);
    if (t) return t === "group" || t === "supergroup" || t === "channel";
    return Number(chatId) < 0;
  }

  function buildFooterRow(chatId, includeMainMenu = true) {
    const row = [];
    if (includeMainMenu) {
      row.push({ text: "🏠 Hauptmenü", callback_data: "main_menu" });
    }
    if (isGroupOrChannelChat(chatId)) {
      row.push({ text: "✖️ Beenden", callback_data: "close_bot_msg" });
    }
    return row;
  }

  // In-Memory Statistik-Puffer für das Admin-Panel (/stats xyz)
  const runtimeStats = {
    dayKey: new Date().toISOString().slice(0, 10),
    tmdbCalls: 0,
    telegramCalls: 0,
    translatorCalls: 0,
    kvReads: 0,
    kvWrites: 0,
    d1Reads: 0,
    d1Writes: 0,
    d1Hits: 0,
    searchQueries: 0,
    randomSearches: 0,
    similarSearches: 0,
    lastSearchTerms: []
  };

  function checkStatsDayRollover() {
    const today = new Date().toISOString().slice(0, 10);
    if (runtimeStats.dayKey !== today) {
      runtimeStats.dayKey = today;
      runtimeStats.tmdbCalls = 0;
      runtimeStats.telegramCalls = 0;
      runtimeStats.translatorCalls = 0;
      runtimeStats.kvReads = 0;
      runtimeStats.kvWrites = 0;
      runtimeStats.d1Reads = 0;
      runtimeStats.d1Writes = 0;
      runtimeStats.d1Hits = 0;
      runtimeStats.searchQueries = 0;
      runtimeStats.randomSearches = 0;
      runtimeStats.similarSearches = 0;
    }
  }

  function trackStat(metric, extraTerm = null) {
    checkStatsDayRollover();
    if (typeof runtimeStats[metric] === "number") {
      runtimeStats[metric] += 1;
    }
    if (extraTerm) {
      const clean = String(extraTerm).trim().slice(0, 40);
      if (clean) {
        runtimeStats.lastSearchTerms = [
          clean,
          ...runtimeStats.lastSearchTerms.filter(t => t !== clean)
        ].slice(0, 5);
      }
    }
  }

  const KV_EMPTY_SENTINEL = "__KV_NULL_SENTINEL__";
  const kvDirtyBuffer = new Map();

  function resolveKvBinding(env, bindingName = "MOVIE_SAVED") {
    if (!env) return null;
    if (bindingName === "MY_KV") {
      if (env.MY_KV && typeof env.MY_KV.get === "function") return env.MY_KV;
      if (env.MOVIE_SAVED && typeof env.MOVIE_SAVED.get === "function") return env.MOVIE_SAVED;
      if (env.KV && typeof env.KV.get === "function") return env.KV;
      return null;
    }
    if (env.MOVIE_SAVED && typeof env.MOVIE_SAVED.get === "function") return env.MOVIE_SAVED;
    if (env.KV && typeof env.KV.get === "function") return env.KV;
    if (env.MY_KV && typeof env.MY_KV.get === "function") return env.MY_KV;
    return null;
  }

  function stableJsonStringify(val) {
    if (val === null || val === undefined) return "null";
    if (typeof val !== "object") return JSON.stringify(val);
    if (Array.isArray(val)) return `[${val.map(stableJsonStringify).join(",")}]`;
    const keys = Object.keys(val).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableJsonStringify(val[k])}`).join(",")}}`;
  }

  function countKvSubrequest() {
    incrementInvocationSubrequests(1);
  }

  async function kvCachedGetRaw(env, key, bindingName = "MOVIE_SAVED", options = {}) {
    const cleanKey = String(key || "");
    if (!cleanKey) return null;
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const bypassMemoryCache = Boolean(options?.bypassMemoryCache);
    if (!bypassMemoryCache && kvDirtyBuffer.has(cleanKey)) {
      return kvDirtyBuffer.get(cleanKey).valueStr;
    }
    const cacheKey = `kv_raw_${cleanKey}`;
    const cacheTsKey = `kv_raw_ts_${cleanKey}`;
    const kv = resolveKvBinding(env, bindingName);
    const hasRealKv = Boolean(kv && typeof kv.get === "function");
    if (!bypassMemoryCache && memoryFallback.has(cacheKey)) {
      const cached = memoryFallback.get(cacheKey);
      if (isBrowserSandbox || !hasRealKv) {
        return cached === KV_EMPTY_SENTINEL ? null : cached;
      }
      const cachedAt = Number(memoryFallback.get(cacheTsKey) || 0);
      const defaultTtl = cached === KV_EMPTY_SENTINEL ? 5000 : 15000;
      const ttlMs = Number.isFinite(Number(options?.ttlMs)) ? Math.max(0, Number(options.ttlMs)) : defaultTtl;
      if (ttlMs > 0 && cachedAt > 0 && (Date.now() - cachedAt) < ttlMs) {
        return cached === KV_EMPTY_SENTINEL ? null : cached;
      }
    }
    try {
      if (hasRealKv) {
        trackStat("kvReads");
        countKvSubrequest();
        const raw = await kv.get(cleanKey);
        const now = Date.now();
        if (raw !== null && raw !== undefined) {
          const strVal = typeof raw === "string" ? raw : JSON.stringify(raw);
          memoryFallback.set(cacheKey, strVal);
          memoryFallback.set(cacheTsKey, now);
          memoryFallback.set(`kv_last_saved_${cleanKey}`, strVal);
          return strVal;
        }
        memoryFallback.set(cacheKey, KV_EMPTY_SENTINEL);
        memoryFallback.set(cacheTsKey, now);
        return null;
      }
    } catch (e) {}
    return null;
  }

  async function kvStageWrite(env, key, rawOrObj, options = {}) {
    const cleanKey = String(key || "");
    if (!cleanKey) return false;
    const valueStr = typeof rawOrObj === "string" ? rawOrObj : JSON.stringify(rawOrObj);
    const cacheKey = `kv_raw_${cleanKey}`;
    const cacheTsKey = `kv_raw_ts_${cleanKey}`;
    const lastSavedKey = `kv_last_saved_${cleanKey}`;
    memoryFallback.set(cacheKey, valueStr);
    memoryFallback.set(cacheTsKey, Date.now());

    const forceWrite = Boolean(options.forceKvWrite || options.flushNow);
    if (!forceWrite && memoryFallback.get(lastSavedKey) === valueStr) {
      kvDirtyBuffer.delete(cleanKey);
      return false;
    }

    const prev = kvDirtyBuffer.get(cleanKey);
    const now = Date.now();
    const nextEntry = {
      key: cleanKey,
      valueStr,
      bindingName: options.bindingName || prev?.bindingName || "MOVIE_SAVED",
      expirationTtl: options.expirationTtl || prev?.expirationTtl || null,
      periodicOnly: options.periodicOnly !== undefined ? Boolean(options.periodicOnly) : Boolean(prev?.periodicOnly),
      dirtyCount: (prev?.dirtyCount || 0) + 1,
      firstDirtiedAt: prev?.firstDirtiedAt || now,
      updatedAt: now
    };
    kvDirtyBuffer.set(cleanKey, nextEntry);

    if (options.flushNow === true) {
      await flushDirtyKvBatch(env, { keys: [cleanKey], force: true });
    }
    return true;
  }

  async function kvStageDelete(env, key, bindingName = "MOVIE_SAVED") {
    const cleanKey = String(key || "");
    if (!cleanKey) return;
    kvDirtyBuffer.delete(cleanKey);
    memoryFallback.set(`kv_raw_${cleanKey}`, KV_EMPTY_SENTINEL);
    memoryFallback.set(`kv_raw_ts_${cleanKey}`, Date.now());
    memoryFallback.delete(`kv_last_saved_${cleanKey}`);
    try {
      const kv = resolveKvBinding(env, bindingName);
      if (kv && typeof kv.delete === "function") {
        countKvSubrequest();
        await kv.delete(cleanKey).catch(() => {});
      }
    } catch (e) {}
  }

  async function flushDirtyKvBatch(env, options = {}) {
    if (!kvDirtyBuffer.size) return 0;
    const force = Boolean(options.force);
    const targetKeys = Array.isArray(options.keys) && options.keys.length > 0 ? new Set(options.keys.map(String)) : null;
    const now = Date.now();
    const entriesToFlush = [];

    for (const [k, entry] of kvDirtyBuffer.entries()) {
      if (targetKeys && !targetKeys.has(k)) continue;
      if (!force && entry.periodicOnly) {
        const ageMs = now - (entry.firstDirtiedAt || now);
        if ((entry.dirtyCount || 0) < 15 && ageMs < 45000) {
          continue;
        }
      }
      entriesToFlush.push(entry);
    }

    if (!entriesToFlush.length) return 0;

    let writtenCount = 0;
    await Promise.allSettled(entriesToFlush.map(async (entry) => {
      kvDirtyBuffer.delete(entry.key);
      const lastSavedKey = `kv_last_saved_${entry.key}`;
      if (!force && memoryFallback.get(lastSavedKey) === entry.valueStr) {
        return;
      }
      const kv = resolveKvBinding(env, entry.bindingName);
      if (!kv || typeof kv.put !== "function") return;
      const putOpts = entry.expirationTtl && Number(entry.expirationTtl) >= 60
        ? { expirationTtl: Number(entry.expirationTtl) }
        : undefined;
      try {
        trackStat("kvWrites");
        countKvSubrequest();
        if (putOpts) {
          await kv.put(entry.key, entry.valueStr, putOpts);
        } else {
          await kv.put(entry.key, entry.valueStr);
        }
        memoryFallback.set(lastSavedKey, entry.valueStr);
        writtenCount += 1;
      } catch (_kvPutErr) {
        if (!kvDirtyBuffer.has(entry.key)) {
          kvDirtyBuffer.set(entry.key, entry);
        }
      }
    }));

    return writtenCount;
  }

  async function getActiveTiers(env) {
    const isBrowserSandbox = typeof localStorage !== "undefined" && typeof window !== "undefined";
    const cachedTs = Number(memoryFallback.get("admin_active_tiers_ts") || 0);
    if (memoryFallback.has("admin_active_tiers") && (isBrowserSandbox || (Date.now() - cachedTs) < 60000)) {
      return memoryFallback.get("admin_active_tiers");
    }
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof getEntityFromD1 === "function") {
      try {
        const fromD1 = await getEntityFromD1(env, "admin_active_tiers", 3650 * 86400000, { ramTtlMs: 60000 });
        if (fromD1 && typeof fromD1 === "object") {
          const parsed = { ...DEFAULT_ACTIVE_TIERS, ...fromD1 };
          memoryFallback.set("admin_active_tiers", parsed);
          memoryFallback.set("admin_active_tiers_ts", Date.now());
          return parsed;
        }
      } catch (e) {}
    }
    try {
      const raw = await kvCachedGetRaw(env, "admin_active_tiers", "MOVIE_SAVED", { ttlMs: 60000 });
      if (raw) {
        const parsed = { ...DEFAULT_ACTIVE_TIERS, ...JSON.parse(raw) };
        memoryFallback.set("admin_active_tiers", parsed);
        memoryFallback.set("admin_active_tiers_ts", Date.now());
        if (hasD1 && typeof saveEntityToD1 === "function") {
          saveEntityToD1(env, "admin_active_tiers", "config", parsed).catch(() => {});
        }
        return parsed;
      }
    } catch (e) {}
    const fallbackTiers = { ...DEFAULT_ACTIVE_TIERS };
    memoryFallback.set("admin_active_tiers", fallbackTiers);
    memoryFallback.set("admin_active_tiers_ts", Date.now());
    return fallbackTiers;
  }

  async function saveActiveTiers(env, tiersObj) {
    const merged = { ...DEFAULT_ACTIVE_TIERS, ...tiersObj };
    memoryFallback.set("admin_active_tiers", merged);
    memoryFallback.set("admin_active_tiers_ts", Date.now());
    const hasD1 = typeof getRawD1Binding === "function" && Boolean(getRawD1Binding(env));
    if (hasD1 && typeof saveEntityToD1 === "function") {
      await saveEntityToD1(env, "admin_active_tiers", "config", merged);
      return merged;
    }
    await kvStageWrite(env, "admin_active_tiers", merged, { bindingName: "MOVIE_SAVED", flushNow: true });
    return merged;
  }
