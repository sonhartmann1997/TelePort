  // @DEPARTMENT: 02-parser-ingester | 2. Erkennungs-Weiche, Regex-Parser & JSON-Ingester
  // @ANCHOR: PARSER_SWITCH
  // ============================================================================
  // 1. ERKENNUNGS-WEICHE, REGEX-PARSING & METADATEN-BEREINIGUNG (PROJEKT 1 - SCHRITT 1)
  // - Prüft eingehende Videodateien & JSON-Einträge per Regex auf Serien-Muster
  //   (S01E01, 1x01, Staffel 1 Folge 1, Folge 1, Episode 1)
  // - Extrahiert Qualitäten (720p, 1080p, 4K), Codecs (x264, x265) und Parts (CD1, CD2)
  // - Bereinigt den rohen Dateinamen restlos: In D1, Bot & Mini-App werden
  //   ausnahmslos saubere TMDb-Titel, Poster & Metadaten verwendet!
  // ============================================================================
  const MAX_JSON_INGEST_LIMIT = 25; // Gesundes Maximallimit pro .json Upload zum Schutz der TMDb/Worker Limits
  const JSON_INGEST_CONCURRENCY = 2; // Max. 2 parallele Lookups pro Batch-Schritt (Subrequest-Schutz)
  const JSON_INGEST_DELAY_MS = 380;  // Pause zwischen Batches zum strikten Einhalten der API-Limits

  // ============================================================================
  // GOLD MASTER 10-REGELN KONSTANTEN, ALIAS-MAP, EDITIONEN, PARTS & GATEKEEPER
  // ============================================================================
  const SERIES_ALIASES = {
    "ahs": "American Horror Story",
    "adtdwv": "Als die Tiere den Wald verließen",
    "gzsz": "Gute Zeiten, schlechte Zeiten",
    "dsds": "Deutschland sucht den Superstar",
    "gntm": "Germany's Next Topmodel",
    "jacob 2 2": "Jacob 2/2",
    "ps profis": "Die PS-Profis",
    "die ps profis": "Die PS-Profis",
    "better call saul": "Better Call Saul",
    "hardcore pawn - das härteste pfandhaus detroits": "Hardcore Pawn",
    "hardcore pawn": "Hardcore Pawn",
    "axel wills wissen": "Axel! will's wissen",
    "axel will's wissen": "Axel! will's wissen",
    "axel! wills wissen": "Axel! will's wissen",
    "axel! will's wissen": "Axel! will's wissen",
    "stawaepideauskywa1080": "Star Wars: Der Aufstieg Skywalkers",
    "stawaepideauskywa": "Star Wars: Der Aufstieg Skywalkers",
    "pso bw bd": "Black Widow",
    "pso-bw bd": "Black Widow",
    "pso bw": "Black Widow",
    "saw 1": "Saw",
    "saw 1 - wessen blut wird fliessen": "Saw",
    "saw 1 - wessen blut wird fließen": "Saw",
    "saw 7": "Saw 3D - Vollendung",
    "saw 7 - vollendung": "Saw 3D - Vollendung",
    "saw 7 vollendung": "Saw 3D - Vollendung",
    "kingsman 3 the beginning": "The King's Man: The Beginning",
    "kingsman 3 - the beginning": "The King's Man: The Beginning",
    "kingsman 3": "The King's Man: The Beginning",
    "pirates of the caribbean 3": "Pirates of the Caribbean - Am Ende der Welt",
    "pirates of the caribbean 4": "Pirates of the Caribbean - Fremde Gezeiten",
    "fluch der karibik 3": "Pirates of the Caribbean - Am Ende der Welt",
    "fluch der karibik 4": "Pirates of the Caribbean - Fremde Gezeiten",
    "professor t": "Professor T.",
    "9 1 2 wochen": "9½ Wochen",
    "9 1/2 wochen": "9½ Wochen"
  };

  // .rar / .partXX.rar Archive sind erlaubt und erhalten eine eigene Kategorie/Version ("📦 RAR-Archiv")
  // Untertitel (.srt, .vtt, .sub, .ass, .ssa) werden NICHT als Junk verworfen, sondern automatisch an das zugehörige Video gebunden!
  const SUBTITLE_EXTENSIONS = /\.(?:srt|vtt|sub|ass|ssa)$/i;
  const BLOCKED_EXTENSIONS = /\.(webp|tgs|webm|gif|mp3|ogg|wav|flac|m4a|idx|apk|exe|msi|dmg|pdf|epub|txt|nfo|jpg|jpeg|png|zip|7z|tar|gz)$/i;
  const BLOCKED_FILENAMES  = /^(?:sticker|animatedsticker|giphy|tenor|video_?\d*)\.(?:webp|tgs|webm|mp4|gif)$/i;
  const TRAILER_KEYWORD_REGEX = /(?:^|[\s._\-(\[])(?:kinotrailer|official\s+trailer|offizieller\s+trailer|teaser\s+trailer|trailer\s+(?:german|deutsch|englisch|english|hd|full\s*hd|1080p|720p|4k)|trailer|teaser|coming\s+soon|zwiastun|vorschau)(?=$|[\s._\-)\]:])/i;

  function extractSubtitleAttachmentFromMsg(msg, chatMeta = {}) {
    if (!msg || typeof msg !== "object") return null;
    const rawPath = String(msg.file || "").trim();
    const validPath = rawPath && !rawPath.startsWith("(File not included") ? rawPath.split("/").pop() : "";
    const fileName = String(msg.document?.file_name || msg.file_name || validPath || "").trim();
    if (!fileName || !SUBTITLE_EXTENSIONS.test(fileName)) return null;
    const msgId = msg.id || msg.message_id || null;
    const rawChan = String(chatMeta?.id || msg.chat?.id || "vip").replace(/^-100/, "").replace(/^-/, "");
    const fid = msg.document?.file_id || msg.telegram_file_id || msg.file_id || (msgId ? `tg_export_${rawChan}_${msgId}` : null);
    if (!fid) return null;
    const langMatch = fileName.match(/\b(de|ger|german|deutsch|en|eng|english|forced)\b/i);
    const lang = langMatch ? langMatch[1].toLowerCase() : "de";
    return {
      telegram_file_id: String(fid),
      file_name: fileName,
      lang,
      message_id: msgId,
      reply_to_message_id: msg.reply_to_message_id || msg.reply_to_message?.message_id || null
    };
  }

  function isJunkOrSticker(msg) {
    if (!msg || typeof msg !== "object") return true;

    const mediaType = String(msg.media_type || "").toLowerCase();
    const mimeType  = String(msg.video?.mime_type || msg.document?.mime_type || msg.mime_type || "").toLowerCase();
    const rawPath   = String(msg.file || "").trim();
    const validPath = rawPath && !rawPath.startsWith("(File not included") ? rawPath.split("/").pop() : "";
    const fileName  = String(msg.video?.file_name || msg.document?.file_name || msg.file_name || validPath || "").trim();
    const duration  = msg.video?.duration ?? msg.duration_seconds ?? msg.duration ?? null;
    const isPhotoHeader = Boolean(msg.photo && !msg.sticker && mediaType !== "sticker" && !mimeType.includes("webp"));
    const isRarArchive  = /\.rar$/i.test(fileName);
    const isSubtitleFile = SUBTITLE_EXTENSIONS.test(fileName);

    // 1. Sticker, GIF-Animationen, Sprachnachrichten & Audio sofort blockieren (Live-Bot & JSON-Backup)
    if (
      msg.sticker ||
      msg.animation ||
      msg.voice ||
      msg.audio ||
      msg.video_note ||
      ["sticker", "animation", "voice_message", "audio_file", "video_message"].includes(mediaType)
    ) {
      return true;
    }

    // 2. sticker.webp, .gif.mp4 & Programme (.apk/.exe) blockieren (.rar und .srt/.sub/.vtt sind erlaubt!)
    if (
      (!isRarArchive && !isSubtitleFile && fileName && BLOCKED_EXTENSIONS.test(fileName)) ||
      (fileName && BLOCKED_FILENAMES.test(fileName)) ||
      /\.gif\.mp4$/i.test(fileName) ||
      mimeType.includes("webp") ||
      mimeType.includes("tgsticker") ||
      mimeType.startsWith("audio/") ||
      (!isPhotoHeader && mimeType.startsWith("image/"))
    ) {
      return true;
    }

    // 3. Explizite Trailer / Teaser / Coming Soon aussortieren (außer es ist ein voller Hauptfilm >= 900s)
    const rawCaptionPreview = String(typeof msg.text === "string" ? msg.text : (typeof msg.caption === "string" ? msg.caption : "")).slice(0, 220);
    if (
      (TRAILER_KEYWORD_REGEX.test(fileName) ||
       /^(?:trailer|teaser|coming\s+soon)\b/i.test(rawCaptionPreview) ||
       /\b(?:official\s+trailer|offizieller\s+trailer|kinotrailer|teaser\s+trailer|trailer\s+(?:german|deutsch)|(?:\(|\[)\s*trailer\b|coming\s+soon)\b/i.test(rawCaptionPreview)) &&
      (duration === null || Number(duration) < 900)
    ) {
      return true;
    }

    // 4. Kurz-Clips unter 60 Sek. aussortieren (Videos ohne "Trailer" im Namen sind ab 60s erlaubt, z.B. Star Wars: Die Mächte des Schicksals & One Piece Strohhut Theater!)
    if (duration !== null && Number(duration) > 0 && Number(duration) < 60) {
      return true;
    }

    return false;
  }

  /**
   * Ermittelt die echte Video-Auflösung primär anhand der Pixelmaße (width/height)
   * aus dem Telegram-Nachrichtenobjekt und erst sekundär über Dateiname/Text.
   * Berücksichtigt 21:9 Kinoformat (z.B. 1920x800 = 1080p, 1280x536 = 720p).
   */
  function detectVideoQuality(msg, rawText = "", rawFileName = "") {
    const width  = Number(msg?.video?.width  || msg?.width  || 0);
    const height = Number(msg?.video?.height || msg?.height || 0);

    // 1. Echte Pixel-Dimensionen aus dem Telegram-Objekt (Kinoformat 21:9 berücksichtigt!)
    if (width > 0 || height > 0) {
      if (width >= 3800 || height >= 2100) return "2160p";
      if (width >= 1900 || height >= 1000) return "1080p";
      if (width >= 1200 || height >= 700)  return "720p";
      if (width >= 600  || height >= 340)  return "480p";
      return "360p";
    }

    // 2. Fallback: Text & Dateiname prüfen (nur wenn keine Pixelmaße vorhanden sind)
    const combined = `${rawFileName || ""} ${rawText || ""}`;
    if (/\b(?:2160p|4k|uhd)\b/i.test(combined))          return "2160p";
    if (/\b(?:1080p|full\s*hd|fhd)\b/i.test(combined))   return "1080p";
    if (/\b(?:720p|hd)\b/i.test(combined))               return "720p";
    if (/\b(?:480p|576p|sd|dvdrip)\b/i.test(combined))   return "480p";

    // 3. Niemals blind "1080p" raten!
    return null;
  }

  /**
   * Filtert Weiterleitungs-Header, Kanal-Werbung, reine @Mentions, #Hashtags, Links & Emojis heraus,
   * damit niemals ein Kanalname oder Promo-Banner als Filmtitel oder Episodentitel geparst wird.
   */
  function getCleanContentLines(normalizedText) {
    return String(normalizedText || "")
      .split("\n")
      .map(l => l.trim())
      .filter(l => {
        if (!l) return false;
        // 1. Weiterleitungs-Header & Kanal-Werbung ignorieren
        if (/^(?:weitergeleitet\s+aus|forwarded\s+from|abonniere\s+den\s+kanal|jetzt\s+abonnieren|hier\s+anschauen|mehr\s+\w+\s+bei)/i.test(l)) {
          return false;
        }
        if (/^❖\s*@/.test(l) || /^(?:➠|✔️|🔞|قیمت)/.test(l)) {
          return false;
        }
        // 1b. Reine Metadaten-Zeilen ("Size: 295 MB", "Studio:", "Gener:", "+18", "Ab 16 Jahren") niemals als Filmtitel werten!
        if (/^(?:size|größe|groesse|qualität|qualitaet|quality|format|dauer|laufzeit|runtime|länge|laenge|sprache|language|genre|gener|fsk|studio|director|regie|darsteller|actors|cast|released|release|imdb|rating|preis|free|uncensored)\s*[:=-]/i.test(l)) {
          return false;
        }
        if (/^(?:\+?\s*1[268]\s*\+?|ab\s+\d{1,2}\s+jahren.*|fsk\s*\d{1,2}|\d+(?:[.,]\d+)?\s*(?:mb|gb|tb))\s*$/i.test(l)) {
          return false;
        }
        // 2. Reine @Mentions, #Hashtags, Links & Emojis abziehen – bleibt danach < 2 Zeichen übrig, Zeile verwerfen!
        const stripped = l
          .replace(/https?:\/\/\S+/gi, "")
          .replace(/[@#][A-Za-z0-9_äöüÄÖÜß]+/g, "")
          .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
          .replace(/[0-9#*]\uFE0F?\u20E3|[\p{Emoji_Presentation}\p{Extended_Pictographic}•·‧▪▫❖➠✔️👉👈👇👆⬇️⬆️]/gu, "")
          .replace(/^\+?\s*1[268]\s*\+?$/g, "")
          .replace(/[^A-Za-z0-9äöüÄÖÜß]+/g, "")
          .trim();
        return stripped.length >= 2;
      });
  }

  function extractPartInfo(rawText = "", rawFileName = "") {
    const combined = `${rawFileName || ""} ${rawText || ""}`;
    const isRar = /\.rar$/i.test(String(rawFileName || "").trim()) || /\.part\d+\.rar\b/i.test(combined);

    // 0. Mehrteilige oder einzelne RAR-Archive (eigene Kategorie/Version "📦 RAR-Archiv", z.B. part1.rar .. part20.rar)
    if (isRar) {
      const rarPartMatch = combined.match(/(?:\.part|\bpart)[\s._-]*0*([1-9]\d?)\b/i);
      if (rarPartMatch) {
        const pNum = parseInt(rarPartMatch[1], 10);
        return { isSplit: true, isArchive: true, part: pNum, partType: "RAR", partLabel: `RAR-PART${pNum}` };
      }
      return { isSplit: false, isArchive: true, part: 1, partType: "RAR", partLabel: "RAR" };
    }

    // 1. Eindeutige Datei-Splits: CD1, CD 2, CD01, Disc 1, DVD 2, Part 1, oder -001 / -002 am Dateiende -> einheitlich "CD 1", "CD 2"...
    const cdMatch = combined.match(/(?:^|[\s._\-(])(cd|disc|disk|dvd|part|split)[\s._-]*0*([1-9])(?:$|[\s._\-)])/i)
                 || combined.match(/AC3\.?(cd)0*([1-9])\b/i);
    if (cdMatch) {
      const pNum = parseInt(cdMatch[2], 10);
      return { isSplit: true, isArchive: false, part: pNum, partType: "CD", partLabel: `CD ${pNum}` };
    }

    const splitNumMatch = String(rawFileName || "").match(/-00([1-9])(?:\.(?:mp4|mkv|avi|m4v|mk3d|flv|ts|mov|wmv))+$/i);
    if (splitNumMatch) {
      const pNum = parseInt(splitNumMatch[1], 10);
      return { isSplit: true, isArchive: false, part: pNum, partType: "CD", partLabel: `CD ${pNum}` };
    }

    return { isSplit: false, isArchive: false, part: 1, partType: null, partLabel: null };
  }

  const EDITION_RULES = [
    { label: "Extended Cut",        regex: /\b(?:extended[\s._-]*(?:cut|version|edition|fassung)|langfassung)\b/gi },
    { label: "Director's Cut",      regex: /\b(?:director'?s?[\s._-]*cut|director’s[\s._-]*cut)\b/gi },
    { label: "Collector's Edition", regex: /\b(?:collector'?s?[\s._-]*(?:edition|cut)|collector’s[\s._-]*(?:edition|cut))\b/gi },
    { label: "Special Edition",     regex: /\b(?:special[\s._-]*(?:edition|cut|version))\b/gi },
    { label: "Ultimate Edition",    regex: /\b(?:ultimate[\s._-]*(?:hunter[\s._-]*)?(?:edition|cut|version))\b/gi },
    { label: "Final Cut",           regex: /\b(?:final[\s._-]*cut)\b/gi },
    { label: "Theatrical Cut",      regex: /\b(?:theatrical(?:[\s._-]*cut|[\s._-]*version)?|kinofassung)\b/gi },
    { label: "Uncut",               regex: /\b(?:uncut(?:[\s._-]*(?:edition|version|fassung))?|ungeschnitten)\b/gi },
    { label: "Unrated",             regex: /\b(?:unrated(?:[\s._-]*(?:cut|edition|version))?)\b/gi },
    { label: "Remastered",          regex: /\b(?:(?:4k[\s._-]*)?(?:digitally[\s._-]*)?(?:remastered|restored)|mastered[\s._-]*in[\s._-]*4k)\b/gi },
    { label: "IMAX",                regex: /\b(?:imax(?:[\s._-]*(?:edition|version|enhanced))?|open[\s._-]*matte)\b/gi },
    { label: "3D",                  regex: /\b(?:3d)\b/gi },
    { label: "Extended",            regex: /\b(?:extended|super[\s._-]*duper[\s._-]*cut|snyder[\s._-]*cut)\b/gi }
  ];

  function extractAndStripEditions(str = "") {
    let cleaned = String(str || "");
    const editions = new Set();

    for (const rule of EDITION_RULES) {
      rule.regex.lastIndex = 0;
      if (rule.regex.test(cleaned)) {
        editions.add(rule.label);
        rule.regex.lastIndex = 0;
        cleaned = cleaned.replace(rule.regex, " ");
      }
    }
    return { cleaned, editions: Array.from(editions) };
  }

  const COUNTRY_TO_LANG = {
    DE: "de", AT: "de", CH: "de",
    US: "en", GB: "en", UK: "en", AU: "en", CA: "en",
    FR: "fr", ES: "es", MX: "es", IT: "it", TR: "tr", RU: "ru",
    JP: "ja", KR: "ko", CN: "zh", TW: "zh", HK: "zh",
    IN: "hi", IR: "fa", SA: "ar", EG: "ar",
    NL: "nl", PL: "pl", PT: "pt", BR: "pt", SE: "sv",
    DK: "da", NO: "no", FI: "fi", GR: "el", CZ: "cs", HU: "hu", RO: "ro", UA: "uk"
  };

  // Mappt ausgeschriebene Wörter, Hashtags und ISO-Kürzel auf saubere Sprachcodes
  const LANGUAGE_TAG_RULES = [
    { regex: /(?:^|[\s(\[#._:-])(?:de[\s._-]*en|en[\s._-]*de|dl|dual[\s._-]*audio|dual)(?=$|[\s)\]#._,-])/i, langs: ["de", "en"] },
    { regex: /(?:^|[\s(\[#._:-])(?:de[\s._-]*fr|fr[\s._-]*de)(?=$|[\s)\]#._,-])/i, langs: ["de", "fr"] },
    { regex: /(?:^|[\s(\[#._:-])(?:de[\s._-]*es|es[\s._-]*de)(?=$|[\s)\]#._,-])/i, langs: ["de", "es"] },
    { regex: /(?:^|[\s(\[#._:-])(?:de[\s._-]*it|it[\s._-]*de)(?=$|[\s)\]#._,-])/i, langs: ["de", "it"] },
    { regex: /(?:^|[\s(\[#._:-])(?:de[\s._-]*tr|tr[\s._-]*de)(?=$|[\s)\]#._,-])/i, langs: ["de", "tr"] },
    { regex: /(?:^|[\s(\[#._:-])(?:de[\s._-]*ru|ru[\s._-]*de)(?=$|[\s)\]#._,-])/i, langs: ["de", "ru"] },
    { regex: /(?:^|[\s(\[#._:-])(?:de[\s._-]*ja|de[\s._-]*jp|gerdub)(?=$|[\s)\]#._,-])/i, langs: ["de"] },
    { regex: /(?:^|[\s(\[#._:-])(?:dt[\s._-]*ov)(?=$|[\s)\]#._,-])/i, langs: ["de", "ov"] },
    { regex: /(?:^|[\s(\[#._:-])(?:deutsch|german|germany|deu|ger)(?=$|[\s)\]#._,-])|(?:[#(\[_-]\s*de(?=$|[\s)\]#._,-]))/i, langs: ["de"] },
    { regex: /(?:^|[\s(\[#._:-])DE(?=$|[\s)\]#._,-])/, langs: ["de"] },
    { regex: /(?:^|[\s(\[#._:-])(?:englisch|english|eng|engdub)(?=$|[\s)\]#._,-])|(?:[#(\[_-]\s*en(?=$|[\s)\]#._,-]))/i, langs: ["en"] },
    { regex: /(?:^|[\s(\[#._:-])EN(?=$|[\s)\]#._,-])/, langs: ["en"] },
    { regex: /(?:^|[\s(\[#._:-])(?:französisch|franzoesisch|french|fra|fre|vff|vf)(?=$|[\s)\]#._,-])|(?:[#(\[_-]\s*fr(?=$|[\s)\]#._,-]))/i, langs: ["fr"] },
    { regex: /(?:^|[\s(\[#._:-])FR(?=$|[\s)\]#._,-])/, langs: ["fr"] },
    { regex: /(?:^|[\s(\[#._:-])(?:spanisch|spanish|spa|esp|castellano|latino)(?=$|[\s)\]#._,-])|(?:[#(\[_-]\s*es(?=$|[\s)\]#._,-]))/i, langs: ["es"] },
    { regex: /(?:^|[\s(\[#._:-])ES(?=$|[\s)\]#._,-])/, langs: ["es"] },
    { regex: /(?:^|[\s(\[#._:-])(?:italienisch|italian|ita)(?=$|[\s)\]#._,-])|(?:[#(\[_-]\s*it(?=$|[\s)\]#._,-]))/i, langs: ["it"] },
    { regex: /(?:^|[\s(\[#._:-])IT(?=$|[\s)\]#._,-])/, langs: ["it"] },
    { regex: /(?:^|[\s(\[#._:-])(?:türkisch|tuerkisch|turkish|tur)(?=$|[\s)\]#._,-])|(?:[#(\[_-]\s*tr(?=$|[\s)\]#._,-]))/i, langs: ["tr"] },
    { regex: /(?:^|[\s(\[#._:-])TR(?=$|[\s)\]#._,-])/, langs: ["tr"] },
    { regex: /(?:^|[\s(\[#._:-])(?:russisch|russian|rus)(?=$|[\s)\]#._,-])|(?:[#(\[_-]\s*ru(?=$|[\s)\]#._,-]))/i, langs: ["ru"] },
    { regex: /(?:^|[\s(\[#._:-])RU(?=$|[\s)\]#._,-])/, langs: ["ru"] },
    { regex: /(?:^|[\s(\[#._:-])(?:japanisch|japanese|jap|jpn|japdub)(?=$|[\s)\]#._,-])/i, langs: ["ja"] },
    { regex: /(?:^|[\s(\[#._:-])(?:koreanisch|korean|kor)(?=$|[\s)\]#._,-])/i, langs: ["ko"] },
    { regex: /(?:^|[\s(\[#._:-])(?:hindi|hin)(?=$|[\s)\]#._,-])/i, langs: ["hi"] },
    { regex: /(?:^|[\s(\[#._:-])(?:arabisch|arabic|ara)(?=$|[\s)\]#._,-])/i, langs: ["ar"] },
    { regex: /(?:^|[\s(\[#._:-])(?:persisch|farsi|per)(?=$|[\s)\]#._,-])/i, langs: ["fa"] },
    { regex: /(?:^|[\s(\[#._:-])(?:multi|multilang)(?=$|[\s)\]#._,-])/i, langs: ["multi"] },
    { regex: /(?:^|[\s(\[#._:-])(?:ov|omu|omeu|oton|originalton)(?=$|[\s)\]#._,-])/i, langs: ["ov"] }
  ];

  const PERSIAN_DIGITS = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const ARABIC_DIGITS  = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];

  // Erweitertes Edition-/Cut-Pattern (muss vor Einzelwörtern greifen, damit aus "Extended Cut" niemals "Cut" übrig bleibt!)
  const EDITION_CUT_REGEX = /(?<![A-Za-zÄÖÜäöüß0-9])(?:super[\s._-]*duper[\s._-]*cut|extended[\s._-]*director'?s?[\s._-]*cut|(?:extended|director'?s?|director’s|theatrical|ultimate|final|special|unrated|uncut|recut|producer'?s?|television|tv|fan|snyder|remastered|restored|collector'?s?|collector’s|anniversary|limited|deluxe|diamond|platinum|imax|open[\s._-]*matte|international|rough|workprint)[\s._-]*(?:cut|edition|version|fassung|ed\.?)|(?:kino|lang|kurz|fernseh|tv|schnitt|rohschnitt|farb|original|alternativ|jubiläums|jubilaeums|directors|extended|uncut|unrated)[\s._-]*(?:fassung|version|edition|cut)|(?:4k[\s._-]*)?(?:digitally[\s._-]*)?(?:remastered|restored)|mastered[\s._-]*in[\s._-]*4k|open[\s._-]*matte)(?![A-Za-zÄÖÜäöüß0-9])/gi;

  // Erweiterter Cleaner-Regex mit Umlaut-sicheren Wortgrenzen (schützt "Geisterjäger", "Jäger", "Bürger", "World Wide Web" & "Grundkurs Spanish"):
  const TECH_JUNK_REGEX = /(?<![A-Za-zÄÖÜäöüß0-9])(1080p|720p|2160p|480p|4k|uhd|h265|h264|x264|x265|hevc|av1|10bit|de-en|en-de|de-fr|fr-de|de-es|es-de|de-it|it-de|de-tr|tr-de|de-ru|ru-de|de-ja|de-jp|german|deutsch|germany|deu|ger|englisch|english|eng|französisch|franzoesisch|french|fra|fre|vff|vf|(?<!grundkurs\s+)(?:spanisch|spanish)|spa|esp|castellano|latino|italienisch|italian|ita|türkisch|tuerkisch|turkish|tur|russisch|russian|rus|japanisch|japanese|jap|jpn|koreanisch|korean|kor|dl|dual[\s._-]*audio|dual|multi|multilang|(?<!world\s+wide\s+)web|web-dl|webrip|bluray|bdrip|dvdrip|remux|fullhd|fhd|microhd(?:\s*720|\s*1080)?|hd|sd|dt__ov|dt[\s._-]*ov|ov|omu|omeu|oton|originalton|gerdub|engdub|japdub|gersub|engsub|softsub|hardsub|subbed|forced|germanforced|extended[\s._-]*cut|director'?s?[\s._-]*cut|theatrical[\s._-]*cut|ultimate[\s._-]*cut|final[\s._-]*cut|special[\s._-]*(?:cut|edition)|collector'?s?[\s._-]*edition|extended[\s._-]*(?:edition|version)|uncut[\s._-]*(?:edition|version)?|unrated[\s._-]*(?:cut|edition|version)?|farbfassung|langfassung|kinofassung|fernsehfassung|schnittfassung|remastered|restored|uncut|unrated|extended|recut|ac3|aac|6ch|limited|mp4|mkv|avi|m4v|flv|mk3d|archemovie|gutfilm|filmwelt|weltderfilme|sauerkraut|wayne|wvf|dollhead|empir|tvnation|contribution|vivo|watch)(?![A-Za-zÄÖÜäöüß0-9])/gi;

  // Volle Datumsangaben (DD.MM.YYYY wie 21.07.2012 oder 01.12.2018) erkennen & schützen (Regel 6 / Fall 17)
  const FULL_DATE_REGEX = /\b\d{1,2}\.\d{1,2}\.(?:19\d{2}|20\d{2}|\d{2})\b/g;

  // Ignoriert Jahreszahlen, denen direkt ein Tag.Monat. (z.B. 21.07.2012) vorausgeht, und erkennt Länder-Präfixe wie (DDR 1976), (BRD 1980), (USA 2005)
  const YEAR_REGEX = /(?<!\d{1,2}[./-]\d{1,2}[./-])(?:[(\[\-\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(19[2-9]\d|20[0-2]\d)(?![./-]\d|\d)(?:[)\]\s._\-·‧]|$)/i;

  function detectLanguages(rawText = "", rawFileName = "") {
    const combined = `${rawText || ""}\n${rawFileName || ""}`;
    const langs = new Set();
    const subtitles = new Set();

    // 1. Länderflaggen-Emojis auslesen (z.B. 🇩🇪, 🇺🇸, 🇬🇧, 🇫🇷, 🇹🇷)
    const flagRegex = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
    const flags = combined.match(flagRegex) || [];
    for (const flag of flags) {
      const chars = Array.from(flag);
      const countryCode = chars
        .map(c => String.fromCharCode(c.codePointAt(0) - 0x1F1E6 + 65))
        .join("");
      const lang = COUNTRY_TO_LANG[countryCode] || countryCode.toLowerCase();
      langs.add(lang);
    }

    // 2. Getrennte Sub/Dub-Kombinationen mit Leerzeichen oder Punkten (z.B. "Ger Sub", "Ger.Eng.Sub", "Eng Dub")
    if (/\b(?:ger|deu|de)[\s._-]*eng[\s._-]*sub(?:s|titled)?\b/i.test(combined)) {
      subtitles.add("de");
      subtitles.add("en");
    }
    if (/\b(?:ger|deu|de)[\s._-]*sub(?:s|titled)?\b/i.test(combined)) subtitles.add("de");
    if (/\b(?:eng|en)[\s._-]*sub(?:s|titled)?\b/i.test(combined)) subtitles.add("en");
    if (/\b(?:ger|deu|de)[\s._-]*dub(?:bed)?\b/i.test(combined)) langs.add("de");
    if (/\b(?:eng|en)[\s._-]*dub(?:bed)?\b/i.test(combined)) langs.add("en");
    if (/\b(?:jap|jpn)[\s._-]*dub(?:bed)?\b/i.test(combined)) langs.add("ja");

    // 3. Sprach-Tags, Ländernamen & Hashtags prüfen
    for (const rule of LANGUAGE_TAG_RULES) {
      if (rule.regex.test(combined)) {
        for (const l of rule.langs) langs.add(l);
      }
    }

    // 4. Weitere Untertitel-Hinweise erkennen (SoftSub, GerSub, Forced, OmU)
    if (/(?:^|[\s(\[#._:-])(?:gersub|deutsche\s*untertitel)(?=$|[\s)\]#._,-])/i.test(combined)) subtitles.add("de");
    if (/(?:^|[\s(\[#._:-])(?:engsub|omeu)(?=$|[\s)\]#._,-])/i.test(combined)) subtitles.add("en");
    if (/(?:^|[\s(\[#._:-])(?:softsub|hardsub|subbed|omu|sub)(?=$|[\s)\]#._,-])/i.test(combined)) subtitles.add("sub");
    if (/(?:^|[\s(\[#._:-])(?:forced|germanforced)(?=$|[\s)\]#._,-])/i.test(combined)) subtitles.add("forced");

    // 5. Fallback: Standardmäßig ist alles auf Deutsch
    if (langs.size === 0) {
      langs.add("de");
    }

    return {
      languages: Array.from(langs),
      subtitles: Array.from(subtitles)
    };
  }

  // ============================================================================
  // SPEZIAL-BEREINIGUNG FÜR FILMREIHEN & RÖMISCHE ZAHLEN (z.B. Star Trek VIII)
  // ============================================================================
  const ROMAN_NUMERALS = {
    " i ": " 1 ", " ii ": " 2 ", " iii ": " 3 ", " iv ": " 4 ", " v ": " 5 ",
    " vi ": " 6 ", " vii ": " 7 ", " viii ": " 8 ", " ix ": " 9 ", " x ": " 10 ",
    " - viii -": " - 8 -"
  };

  function cleanMovieQuery(rawTitle) {
    if (!rawTitle) return "";
    let s = ` ${String(rawTitle).toLowerCase()} `;

    // 1. Römische Zahlen in arabische Ziffern umwandeln (z.B. "viii" -> "8")
    for (const [roman, arabic] of Object.entries(ROMAN_NUMERALS)) {
      s = s.replace(new RegExp(roman, "g"), arabic);
    }
    s = s.trim();

    // 2. Bekannte "Star Trek"-Sonderfälle glattbügeln
    // "Star Trek 8 Der Aufstand" -> "Star Trek Der Aufstand" oder direkt "Star Trek Der Aufstand"
    if (s.includes("star trek")) {
      // Entferne die Nummer hinter Star Trek, damit TMDb den Film über den Untertitel findet
      s = s.replace(/star\s*trek\s*\d+\b/i, "star trek");
    }

    // 3. Bindestriche und Doppelpunkte vereinheitlichen
    s = s.replace(/[-–—]/g, ":");

    return s
      .replace(/\s+/g, " ")
      .trim();
  }

  // Regel 1: Vorab-Normalisierung aller Episoden-Schreibweisen & Leerzeichen-Reduzierung in normalizeText()
  function normalizeText(str) {
    if (!str) return "";
    let s = String(str)
      .replace(/%26/gi, "&")
      .replace(/%20/g, " ");

    for (let i = 0; i < 10; i++) {
      s = s.replace(PERSIAN_DIGITS[i], String(i)).replace(ARABIC_DIGITS[i], String(i));
    }

    s = Array.from(s).map(ch => {
      return (ch.charCodeAt(0) > 127 && !"äöüÄÖÜßéèêàáâóòôúùûíìîçñøåÆØÅ–—„“”’´‧·".includes(ch))
        ? ch.normalize("NFKD")
        : ch;
    }).join("");

    // Entferne alle arabischen/persischen Schriftzeichen inkl. Kombinationszeichen (U+0600..U+06FF etc.)
    s = s.replace(/[\p{Script=Arabic}\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF،؛؟]+/gu, " ");

    // 1. Mehrfache Leerzeichen/Tabs/NBSP auf ein einzelnes Leerzeichen reduzieren (löst das 80-Leerzeichen-Problem bei "What's up, Dad?")
    s = s.replace(/[\u00A0 \t]+/g, " ");

    // 1b. Senkrechte Striche als römische Zahlen am Wortende umwandeln (z.B. "Creed |||" -> "Creed III", "Creed ||" -> "Creed II")
    s = s.replace(/(?<=[A-Za-zÄÖÜäöüß])\s+(\|{2,3})(?=$|[\s)\]._-])/g, (_, pipes) => pipes.length === 3 ? " III" : " II");

    // 2. Alle abweichenden Episoden-Formate direkt in S01E01 umwandeln:
    // a) "Staffel 1 - Episode 1" / "Staffel 1, Folge 1" -> "S01E01" (auch mit Unterstrichen wie bei PS Profis)
    s = s.replace(/(?:^|(?<=[\s._\-(#]))(?:Staffel|Season)[\s._-]*(\d{1,2})[\s.,_\-–·‧]*(?:Folge|Episode|Ep\.?)[\s._-]*(\d{1,3})(?:\s*[-–+&/]\s*(\d{1,3}))?(?=$|[\s._\-)#])/gi, (_, st, ep, ep2) => {
      const sPad = String(parseInt(st, 10)).padStart(2, "0");
      const ePad = String(parseInt(ep, 10)).padStart(2, "0");
      const e2Pad = ep2 ? `-E${String(parseInt(ep2, 10)).padStart(2, "0")}` : "";
      return `S${sPad}E${ePad}${e2Pad}`;
    });

    // b) "S01 - E01" / "S01 E01" / "S01_E01" / "S01 E16 & 17" / "S01e16e17" -> "S01E01" bzw. "S01E16-E17"
    s = s.replace(/(?:^|(?<=[\s._\-(]))S(\d{1,2})[\s._\-–]*E(\d{1,3})(?:(?:\s*[&+/]\s*|\s*[-–]\s*E?|[eE])(\d{1,3}))?(?=$|[\s._\-)|⎪])/gi, (_, st, ep, ep2) => {
      const sPad = String(parseInt(st, 10)).padStart(2, "0");
      const ePad = String(parseInt(ep, 10)).padStart(2, "0");
      const e2Pad = ep2 ? `-E${String(parseInt(ep2, 10)).padStart(2, "0")}` : "";
      return `S${sPad}E${ePad}${e2Pad}`;
    });

    // c) "1x01" / "01x09" -> "S01E01" / "S01E09" (nicht bei Auflösungen wie 1920x1080)
    s = s.replace(/(?:^|(?<=[\s._\-(]))0*(\d{1,2})x(\d{2,3})(?=$|[\s._\-)])/gi, (m, st, ep) => {
      const sNum = parseInt(st, 10);
      const eNum = parseInt(ep, 10);
      if (sNum >= 1 && sNum <= 50 && eNum < 200) {
        return `S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
      }
      return m;
    });

    // d) "E01S01" / "E01S02" -> strikt umkehren in "S$2E$1" (E01 = Episode 1, S02 = Staffel 2; z.B. "E01S01 Frontier 2016" -> "S01E01 Frontier 2016", "E01S02" -> "S02E01")
    s = s.replace(/(?:^|(?<=[\s._\-(]))E0*(\d{1,3})[\s._-]*S0*(\d{1,2})(?=$|[\s._\-)])/gi, (_, epStr, seStr) => {
      const sNum = parseInt(seStr, 10) || 1;
      const eNum = parseInt(epStr, 10) || 1;
      return `S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
    });

    // e) "Maxe Baumann · 01 Ferien ohne Ende" -> "Maxe Baumann S01E01 Ferien ohne Ende"
    s = s.replace(/^(.+?)\s+[·‧]\s*0*([1-9]\d?)\s+(.+)$/gm, (_, sName, epNum, epTitle) => {
      return `${sName} S01E${String(parseInt(epNum, 10)).padStart(2, "0")} ${epTitle}`;
    });

    // f) "Strohhut Theater 1 - Chopper Man" -> "Strohhut Theater S01E01 - Chopper Man" & "Folgen 1 - 10" -> "S01E01-E10"
    s = s.replace(/\b(Strohhut[\s._-]+Theater)[\s._-]+0*([1-9]\d?)\b/gi, (_, sName, epNum) => {
      return `${sName} S01E${String(parseInt(epNum, 10)).padStart(2, "0")}`;
    });
    s = s.replace(/\b(?:Folgen|Folge|Episoden|Episodes)[\s._-]*0*(\d{1,3})\s*[-–]\s*0*(\d{1,3})\b/gi, (_, ep1, ep2) => {
      return `S01E${String(parseInt(ep1, 10)).padStart(2, "0")}-E${String(parseInt(ep2, 10)).padStart(2, "0")}`;
    });

    return s;
  }

  function cleanMediaTitle(raw) {
    if (!raw) return "";
    let s = normalizeText(raw);

    // Mehrfache Dateiendungen (wie .mkv.mp4, .part1.rar, .rar) sowie .flv und .mk3d entfernen
    s = s.replace(/(?:\.part0*\d{1,2})?(?:\.(?:mp4|mkv|avi|m4v|ts|mov|wmv|flv|mk3d|webm|rar|json))+$/i, "").replace(/󠄿/g, "").replace(/_/g, " ");
    // Volle Datumsangaben wie (21.07.2012) oder 01.12.2018 sowie Länder-Jahresklammern wie (DDR 1976) sofort entfernen
    s = s.replace(/\(\s*\d{1,2}\.\d{1,2}\.(?:19\d{2}|20\d{2}|\d{2})\s*\)/g, " ");
    s = s.replace(/[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(?:19[2-9]\d|20[0-2]\d)\s*[\)\]]/gi, " ");
    s = s.replace(FULL_DATE_REGEX, " ");

    if (!s.includes(" ") && ((s.match(/\./g) || []).length >= 2 || /[A-Za-zÄÖÜäöüß]{2,}\.[A-Za-zÄÖÜäöüß]{2,}/.test(s))) {
      s = s.replace(/\./g, " ");
    }

    // Flaggen, Deko-Klammern 《》«»⟨⟩, führende Deko-Emojis & Inline-Emojis (wie 🐉 in "DRAGON 🐉 BALL DAIMA") restlos entfernen
    s = s.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "");
    s = s.replace(/[《》«»⟨⟩]/g, " ");
    s = s.replace(/^[🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎➡️▶️🍿⭐️❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️\s]+/gu, "");
    s = s.replace(/[↩️🔠🔢⤴️⬅️➡️🎦]+.*$/gu, "");
    s = s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎🩸❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️]/gu, " ");

    // @Mentions und bekannte Kanal-/Qualitäts-Hashtags entfernen, aber Titelwörter mit führendem '#' (wie "#Murder Mystery" oder "#Rim of the World") schützen!
    s = s.replace(/@[A-Za-z0-9_]+/g, "");
    s = s.replace(/#(?:gutfilm|archemovie|filmwelt|weltderfilme|sauerkraut|hd|fullhd|fhd|uhd|4k|1080p|720p|480p|deutsch|german|kino|serie|serien|film|filme|neu|new|stream|download|vip|ov|omu|horror|action|comedy|thriller|drama|scifi|fantasy|anime)\b/gi, " ");
    s = s.replace(/#(?=[A-Za-zÄÖÜäöüß0-9])/g, " ");
    s = s.replace(/s[\._]to\s*-?\s*Serien.*/i, "").replace(/Sto\s*-\s*Serien.*/i, "");
    s = s.replace(/serien[\._](?:life|show).*/i, "").replace(/HD\s*Filme\s*Serien.*/i, "");
    s = s.replace(/^(?:Title|Titel)\s*:\s*/i, "").replace(/^(?:vs-|cd-|spy-|d-|4sf-|arc-|tvp-)/i, "");
    // Führende S01E01 / E01S01 / 1x01 Präfixe sowie defekte S05E0Fragmente entfernen (Fall 1, Fall 4)
    s = s.replace(/^(?:s\d{1,2}\s*e\d{1,3}(?:-e\d{1,3})?|e\d{1,3}\s*s\d{1,2}|\d{1,2}x\d{2,3})\b[\s._\-–:]*/i, "");
    s = s.replace(/\bS\d{1,2}\s*E\d{0,3}(?:-E\d{1,3})?(?=[A-Za-z]|\b)/gi, " ");
    s = s.replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/g, "");

    // Getrennte Sub/Dub-Kombinationen & CD/Part-Marker (inkl. part01..part25 bei RAR-Archiven) VOR den Einzelwörtern löschen:
    s = s.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:ger|deu|de|eng|en|jap|jpn)(?:[\s._-]+(?:ger|deu|de|eng|en|jap|jpn))?[\s._-]+(?:sub|subs|subbed|dub|dubbed)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
    s = s.replace(/AC3\.?CD0*[1-9]/gi, " "); // Spezialfix für "Klasse84AC3.CD01"
    s = s.replace(/(?:^|[\s._\-(])(?:cd|disc|disk|dvd|part|split)[\s._-]*0*([1-9]\d?)(?:$|[\s._\-)])/gi, " ");
    s = s.replace(/(?:[-_.]|\s)00[1-9]\b/gi, " ");

    // Editionen (Extended Cut, Director's Cut, Collector's Edition etc.) & Tech-Junk entfernen
    s = extractAndStripEditions(s).cleaned;
    s = s.replace(EDITION_CUT_REGEX, " ");
    s = s.replace(TECH_JUNK_REGEX, " ");
    // Falls durch vorherige Bereinigung oder Schreibweisen wie "Underworld - Cut" / "Underworld (Cut)" / "Blade Runner - The Final Cut" noch ein angehängtes "Cut" / "Edition" oder "- The" übrig blieb:
    s = s.replace(/[\(\[]\s*(?:the\s+)?(?:cut|dc|edition|version|fassung)\s*[\)\]]/gi, " ");
    s = s.replace(/^(.{2,}?)\s+(?:[-–:]\s*)?(?:the\s+)?(?:cut|edition|version|fassung|redux)\s*$/i, "$1");
    s = s.replace(/\s*[-–:]\s*(?:the|der|die|das)\s*$/i, "");
    // Alleinstehende großgeschriebene 2-Buchstaben-Sprachkürzel am Ende oder in Klammern entfernen (z. B. "Es ist nur eine Phase, Hase (2021) DE #gutFilm.mp4")
    s = s.replace(/(?:[\(\[_-]\s*(?:DE|EN|FR|ES|IT|TR|RU|JA|KO|DDR|BRD)\s*[\)\]]?|\s+(?:DE|EN|FR|ES|IT|TR|RU|JA|KO)(?=\s*$))/g, " ");

    // Nur echte Katalognummern mit Punkt ("3559. ", "01. ") oder Null-Präfix mit Bindestrich ("01 - ") am Anfang entfernen,
    // NIEMALS Serientitel wie "7 vs. Wild", "4400 - S2E01", "101 Dalmatiner" oder "6000 Euro"! (Fall 12, 13, 14, 18)
    s = s.replace(/^(?:\d{1,4}\.\s+|0\d\s*[-–]\s+)/, "").replace(/-\d{3}$/, "");
    s = s.replace(/\(\s*\)|\[\s*\]/g, "");
    s = s.replace(/\s+/g, " ").replace(/^[\s\-–·‧:.,#"=|⎪&]+|[\s\-–·‧:.,#"=|⎪&]+$/g, "");

    // Unmittelbar verdoppelte Titelwörter bereinigen (z. B. "Sliders S05E0Sliders" -> "Sliders")
    s = s.replace(/\b([A-Za-zÄÖÜäöüß]{3,})\s+\1\b/gi, "$1");

    // Unbalancierte Klammern bereinigen (Fall 14)
    const openCount  = (s.match(/\(/g) || []).length;
    const closeCount = (s.match(/\)/g) || []).length;
    if (openCount > closeCount) s = s.replace(/\(/g, "");
    if (closeCount > openCount) s = s.replace(/\)/g, "");

    s = s.replace(/\s+/g, " ").trim();
    if (!/[A-Za-zÄÖÜäöüß0-9]/.test(s)) return "";
    if (/^(?:video|vmp4|new+|file|clip|movie|stream)$/i.test(s)) return "";

    const lower = s.toLowerCase().replace(/[’´`]/g, "'");
    if (SERIES_ALIASES[lower]) return SERIES_ALIASES[lower];
    const prefixKey = lower.split(/\s*[-–]\s*/)[0];
    if (SERIES_ALIASES[prefixKey]) return SERIES_ALIASES[prefixKey];

    return s.trim();
  }

  function isSpacedLetterTitle(str) {
    const s = String(str || "").trim();
    if (!s) return false;
    return /^(?:[A-Za-zÄÖÜäöüß]\s+){2,}[A-Za-zÄÖÜäöüß](?:\s+[A-Za-zÄÖÜäöüß])*$/.test(s);
  }

  function pickBestSeriesTitleCandidate(fromText, fromFile, fromHeader = "") {
    const t = String(fromText || "").trim();
    const f = String(fromFile || "").trim();
    const h = String(fromHeader || "").trim();
    if (t && f) {
      // Regel 2: Wenn Text gesperrt geschrieben ist ("D O P E T H I E F"), bevorzuge sauberen Dateinamen ("Dope Thief")
      if (isSpacedLetterTitle(t) && !isSpacedLetterTitle(f)) return f;
      // Wenn Text komplett in GROSSBUCHSTABEN steht ("BATTLESTAR GALACTICA") und Dateiname normale Groß-/Kleinschreibung hat
      if (t.length > 4 && t === t.toUpperCase() && f !== f.toUpperCase() && normalizeCompareString(t) === normalizeCompareString(f)) {
        return f;
      }
      return t;
    }
    if (t && isSpacedLetterTitle(t)) {
      return f || h || t.replace(/\s+/g, "");
    }
    return t || f || h || "";
  }

  function extractSePartsFromSource(srcStr) {
    if (!srcStr) return null;
    const m = String(srcStr).match(/(?:^|[\s._\-(])S(\d{1,2})[\s._-]*E(\d{1,3})(?:[\s._\-+&|/]*(?:S\d{1,2}[\s._-]*)?E?(\d{1,3}))?(?:$|[\s._\-)|⎪])/i);
    if (!m) return null;
    const season = parseInt(m[1], 10);
    const episode = parseInt(m[2], 10);
    const episodeEnd = m[3] ? parseInt(m[3], 10) : null;
    const rawBefore = srcStr.slice(0, m.index).replace(YEAR_REGEX, " ");
    const rawAfter = srcStr.slice(m.index + m[0].length)
      .replace(/Staffel\s*\d+.*/i, "")
      .replace(/^(?:[\s_\-–·‧:⎪]*)(?:Episode|Folge|Ep\.?)\s*\d{1,3}\b/i, "")
      .replace(/[\s_\-–·‧:]+(?:Episode|Folge|Ep\.?)\s*\d{1,3}\s*$/i, "")
      .replace(YEAR_REGEX, " ");
    return {
      season,
      episode,
      episodeEnd,
      before: cleanMediaTitle(rawBefore),
      after: cleanMediaTitle(rawAfter),
      rawMatch: m[0],
      index: m.index
    };
  }

  function extractEntitiesFromExportMsg(msg) {
    const list = [];
    const rawEnts = msg?.caption_entities || msg?.entities || msg?.text_entities || [];
    if (Array.isArray(rawEnts)) {
      for (const e of rawEnts) {
        if (e && typeof e === "object") {
          if (e.url || e.href) list.push({ url: String(e.url || e.href) });
          else if (e.type === "link" && typeof e.text === "string") list.push({ url: e.text });
        }
      }
    }
    if (Array.isArray(msg?.text)) {
      for (const part of msg.text) {
        if (part && typeof part === "object" && (part.href || part.url)) {
          list.push({ url: String(part.href || part.url) });
        }
      }
    }
    const flatStr = typeof msg?.text === "string" ? msg.text : (typeof msg?.caption === "string" ? msg.caption : "");
    const urlMatches = flatStr.match(/https?:\/\/[^\s)>\]]+/gi) || [];
    for (const u of urlMatches) list.push({ url: u });
    return list;
  }

  function extractPreContext(msg, existingContext = {}) {
    if (!msg || typeof msg !== "object") return existingContext;
    // Gatekeeper: sticker.webp, GIFs, Audio & Fremddateien komplett ignorieren, damit der Serien-Kontext nicht überschrieben wird!
    if (isJunkOrSticker(msg)) return existingContext;

    const currentMsgId = Number(msg.message_id || msg.id || 0);
    const rawText = flattenTelegramExportText(msg.caption || msg.text || msg.text_entities);
    const entities = extractEntitiesFromExportMsg(msg);
    const text = normalizeText(rawText).trim();
    const isPhoto = Boolean(msg.photo || msg.media_type === "photo" || /^image\//i.test(msg.mime_type || ""));

    // Fall 1 (Frontier-Fix ID 111) & Fall 16 (IDs 108709, 108712):
    // Ein leeres Poster-Foto ohne Text und ohne Links setzt den vorherigen Serien-/Film-Kontext zwingend zurück!
    if (isPhoto && !text && entities.length === 0) {
      return { lastMessageId: currentMsgId };
    }

    // Wenn ein neues Foto-Poster mit eigenem Text kommt, alten Kontext sauber ersetzen
    const baseContext = (isPhoto && text)
      ? { lastMessageId: currentMsgId }
      : { ...existingContext, lastMessageId: currentMsgId || existingContext.lastMessageId || 0 };

    const nextContext = { ...baseContext };

    for (const ent of entities) {
      if (ent.url) {
        const movMatch = ent.url.match(/themoviedb\.org\/movie\/(\d+)/i);
        const tvMatch  = ent.url.match(/themoviedb\.org\/tv\/(\d+)/i);
        const imdbMatch = ent.url.match(/imdb\.com\/title\/(tt\d+)/i);
        if (movMatch) {
          nextContext.tmdbId = parseInt(movMatch[1], 10);
          nextContext.mediaType = "movie";
          delete nextContext.seriesHeader;
          delete nextContext.isSeriesHeader;
        }
        if (tvMatch) {
          nextContext.tmdbId = parseInt(tvMatch[1], 10);
          nextContext.mediaType = "tv";
        }
        if (imdbMatch) { nextContext.imdbId = imdbMatch[1]; }
        if (ent.url.includes("vorschauserien")) nextContext.isSeriesHeader = true;
      }
    }

    const explicitTitle = text.match(/(?:Titel|Title):\s*([^\n]+)/i)?.[1]?.trim();
    const originalTitle = text.match(/Originaltitel:\s*([^\n]+)/i)?.[1]?.trim();
    const explicitYear  = text.match(/(?:Erscheinungsjahr|Jahr|Release):\s*(\d{4})/i)?.[1];
    const staffelHeaderMatch = text.match(/\b(?:Staffel|Season)\s*0*(\d{1,2})\b/i);

    if (explicitTitle) {
      nextContext.title = cleanMediaTitle(explicitTitle);
      if (!staffelHeaderMatch && !nextContext.isSeriesHeader) {
        delete nextContext.seriesHeader;
      }
    }
    if (originalTitle) nextContext.originalTitle = cleanMediaTitle(originalTitle);
    if (explicitYear)  nextContext.year = parseInt(explicitYear, 10);
    if (staffelHeaderMatch) nextContext.season = parseInt(staffelHeaderMatch[1], 10);

    const cleanLines = getCleanContentLines(text);
    const firstLine = cleanLines[0] || "";
    const isYoutubeOrUrlOnly = /^(?:https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)/i.test(firstLine.trim()) || /(?:youtu\.be\/|youtube\.com\/watch)/i.test(firstLine);
    // Ignoriere reine Genre-/Folgenanzahl-Zeilen wie "Comedy - 123 Folgen (5 Staffeln) (2003 - 2007)" (ID 4211) sowie reine YouTube-Links (ID 11723) als Titel
    const isGenreStatsLine = /^(?:Comedy|Drama|Action|Thriller|Horror|Sci-Fi|Science\s*Fiction|Fantasy|Animation|Zeichentrick|Krimi|Doku|Dokumentation|Abenteuer|Familie|Romantik)\s*[-–·‧:]\s*\d+\s*Folgen/i.test(firstLine);

    if (firstLine && !explicitTitle && !isGenreStatsLine && !isYoutubeOrUrlOnly) {
      if (nextContext.isSeriesHeader || /\b(?:Staffel\s+\d+|Miniserie|\d+\/\d+\s*Folgen|\d+\s*Staffeln\s*\/\s*\d+\s*Folgen|\d+\s+Folgen\s+in\s+\d+\s+Staffel)/i.test(text)) {
        const ymHeader = (` ${text.slice(0, 120)} `).match(YEAR_REGEX);
        if (ymHeader && !nextContext.year) nextContext.year = parseInt(ymHeader[1], 10);
        const headerClean = cleanMediaTitle(firstLine.replace(/Staffel\s*\d+.*/i, "").replace(/\bS\d{1,2}E\d{1,3}\b.*/i, "").replace(YEAR_REGEX, " "));
        const isGenericHeaderWord = /^(?:film|filme|serie|serien|video|deutsch|german|hd|fullhd|neu|new|kino|stream|action|horror|comedy|drama|thriller|scifi|fantasy|ab\s+\d+\s+jahren|\+?18\+?)$/i.test(headerClean);
        if (headerClean && !isGenericHeaderWord) {
          if (nextContext.seriesHeader && normalizeCompareString(nextContext.seriesHeader) !== normalizeCompareString(headerClean)) {
            if (!staffelHeaderMatch) delete nextContext.season;
          }
          nextContext.seriesHeader = headerClean;
          nextContext.isSeriesHeader = true;
          delete nextContext.title;
          delete nextContext.tmdbId;
        }
      } else {
        // Auch bei längeren Einzeilern mit Handlungsbeschreibung (wie ID 108858 "My Big Fat Greek Wedding – Hochzeit auf Griechisch 2002 Mit dreißig Jahren...")
        // innerhalb der ersten 90 Zeichen nach Titel + Jahreszahl suchen
        const headSlice = firstLine.slice(0, 90);
        const ym = (` ${headSlice} `).match(YEAR_REGEX);
        if (ym && ym.index > 2) {
          nextContext.year = parseInt(ym[1], 10);
          nextContext.title = cleanMediaTitle(headSlice.slice(0, Math.max(0, ym.index - 1)));
        }
      }
    }

    return nextContext;
  }

  function parseTelegramMessage(msg, prevContext = {}) {
    if (!msg || typeof msg !== "object") return null;
    if (isJunkOrSticker(msg)) return null;

    const rawFilePath = String(msg.file || "").trim();
    const validFilePath = rawFilePath && !rawFilePath.startsWith("(File not included")
      ? rawFilePath.split("/").pop()
      : "";
    const rawFileName = String(msg.video?.file_name || msg.document?.file_name || msg.file_name || validFilePath || "").trim();
    const isArchive = /\.rar$/i.test(rawFileName);
    const isVideo = Boolean(
      msg.video ||
      msg.media_type === "video_file" ||
      (msg.document?.mime_type && msg.document.mime_type.startsWith("video/")) ||
      (msg.mime_type && String(msg.mime_type).startsWith("video/")) ||
      /\.(mp4|mkv|avi|m4v|mov|webm|ts|flv|mk3d)$/i.test(rawFileName)
    );

    if (!isVideo && !isArchive) return null;

    const currentMsgId = Number(msg.message_id || msg.id || 0);
    const isContextFresh = prevContext && prevContext.lastMessageId && currentMsgId > 0
      ? (Math.abs(currentMsgId - prevContext.lastMessageId) <= 25)
      : Boolean(prevContext && (prevContext.tmdbId || prevContext.title || prevContext.seriesHeader));
    let activeContext = isContextFresh ? { ...prevContext } : {};

    const rawText = flattenTelegramExportText(msg.caption || msg.text || msg.text_entities);
    const durationSec = Number(msg.video?.duration || msg.duration_seconds || msg.duration || 0) || null;
    const videoWidth  = Number(msg.video?.width  || msg.width  || 0) || null;
    const videoHeight = Number(msg.video?.height || msg.height || 0) || null;
    const quality     = detectVideoQuality(msg, rawText, rawFileName);
    const entities = extractEntitiesFromExportMsg(msg);

    // Nur .zip/.7z/.tar/.gz blockieren; .rar/.partXX.rar Archive werden als eigene Kategorie/Version ("📦 RAR-Archiv") importiert!
    if (/\.(zip|7z|tar|gz)$/i.test(rawFileName)) return null;

    const langInfo = detectLanguages(rawText, rawFileName);
    const languages = langInfo.languages;
    const subtitles = langInfo.subtitles;
    const partInfo = extractPartInfo(rawText, rawFileName);
    const editionInfo = extractAndStripEditions(`${rawText || ""} ${rawFileName || ""}`);

    // Regel 4: Entferne "Plot:" und "Beschreibung:" direkt vor dem Zeilen-Check (wichtig für "The Cell (2000) Plot: ...")
    const rawTextWithoutPlot = String(rawText || "")
      .replace(/\s*(?:Plot|Beschreibung)\s*:[\s\S]*$/i, "")
      .replace(/\s*Rating:\s*\d+(?:\.\d+)?.*$/i, "");
    const text = normalizeText(rawTextWithoutPlot);
    const fileName = normalizeText(rawFileName);

    if (/^(?:trailer|coming soon)\b/i.test(fileName) || /\b(?:official trailer|kinotrailer|coming soon)\b/i.test(text.slice(0, 80))) {
      return null;
    }

    // Zeilen über getCleanContentLines aufbereiten (filtert Kanal-Werbung, Weiterleitungen, reine @Mentions, #Hashtags, Links & Emojis)
    const lines = getCleanContentLines(text);
    const line1 = lines[0] || "";
    const line2 = lines[1] || "";

    const isGenericFile = !fileName || /^(?:video|new+|vmp4|\d+|d-[a-z0-9-]+)\.(mp4|mkv|avi|m4v)$/i.test(fileName.trim());

    // THE ROOKIE S01E11 & E01S01 FRONTIER KONTEXT-SCHUTZ:
    // Wenn eine Videodatei ihren eigenen Seriennamen im Text/Dateinamen hat (z.B. "The Rookie S01E11" oder "E01S01 Frontier 2016"),
    // darf dieser NIEMALS vom prevContext (tmdbId, title, seriesHeader) einer vorherigen Serie/Films überschrieben werden!
    const prelimTextSe = extractSePartsFromSource(line1 || text);
    const prelimFileSe = !isGenericFile ? extractSePartsFromSource(fileName) : null;
    const ownSeriesNameInMsg = pickBestSeriesTitleCandidate(
      prelimTextSe ? (prelimTextSe.before || (prelimTextSe.index === 0 ? prelimTextSe.after : "")) : "",
      prelimFileSe ? (prelimFileSe.before || (prelimFileSe.index === 0 ? prelimFileSe.after : "")) : "",
      ""
    );
    const contextKnownName = activeContext.seriesHeader || activeContext.title || "";
    if (ownSeriesNameInMsg && contextKnownName) {
      const ownNorm = normalizeCompareString(ownSeriesNameInMsg);
      const ctxNorm = normalizeCompareString(contextKnownName);
      if (ownNorm && ctxNorm && !ownNorm.startsWith(ctxNorm.slice(0, 5)) && !ctxNorm.startsWith(ownNorm.slice(0, 5))) {
        activeContext = {};
      }
    } else if (ownSeriesNameInMsg && (activeContext.tmdbId || activeContext.imdbId) && !contextKnownName) {
      activeContext = {};
    }

    let tmdbId = activeContext.tmdbId || null;
    let imdbId = activeContext.imdbId || null;
    let mediaType = activeContext.mediaType || "movie";
    let explicitMovUrlHit = false;
    let explicitTvUrlHit = false;
    for (const ent of entities) {
      if (ent.url) {
        const movMatch = ent.url.match(/themoviedb\.org\/movie\/(\d+)/i);
        const tvMatch  = ent.url.match(/themoviedb\.org\/tv\/(\d+)/i);
        const imMatch  = ent.url.match(/imdb\.com\/title\/(tt\d+)/i);
        if (movMatch) { tmdbId = parseInt(movMatch[1], 10); mediaType = "movie"; explicitMovUrlHit = true; }
        if (tvMatch)  { tmdbId = parseInt(tvMatch[1], 10);  mediaType = "tv"; explicitTvUrlHit = true; }
        if (imMatch)  { imdbId = imMatch[1]; }
      }
    }

    const inlineExplicitTitle = text.match(/(?:Titel|Title):\s*([^\n]+)/i)?.[1]?.trim() || null;
    const inlineExplicitYear  = text.match(/(?:Erscheinungsjahr|Jahr|Release):\s*(\d{4})/i)?.[1] || null;
    const EARLY_PAREN_YEAR_REGEX = /[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(19[2-9]\d|20[0-2]\d)\s*[\)\]]/i;
    const EARLY_EXPLICIT_SERIES_MARKER = /(?:^|[\s._\-(🔸🔶#])(?:S\d{1,2}[\s._-]*E\d{1,3}|E\d{1,3}[\s._-]*S\d{1,2}|\d{1,2}x\d{2,3}|Staffel\s*\d{1,2}|Season\s*\d{1,2}|Folge\s*\d{1,3}|Episode\s*\d{1,3}|Ep\.?\s*\d{1,3})\b/i;
    const hasOwnParenYear = Boolean(
      inlineExplicitYear ||
      EARLY_PAREN_YEAR_REGEX.test(text.replace(FULL_DATE_REGEX, " ")) ||
      EARLY_PAREN_YEAR_REGEX.test(fileName.replace(FULL_DATE_REGEX, " "))
    );
    const hasOwnSeriesMarkerInMsg = Boolean(
      explicitTvUrlHit ||
      EARLY_EXPLICIT_SERIES_MARKER.test(text) ||
      EARLY_EXPLICIT_SERIES_MARKER.test(fileName)
    );
    // Eiserne Weichen-Regel: Jahreszahl in Klammern (z.B. "Iron Man 3 (2013)") OHNE Serien-Marker ist zu 100% ein Film!
    // Verhindert, dass ein vorangegangener Serien-Kontext (activeContext) einen darauffolgenden Spielfilm mit Jahreszahl zur Serie macht.
    if (hasOwnParenYear && !hasOwnSeriesMarkerInMsg) {
      mediaType = "movie";
      if (activeContext.mediaType === "tv" && !explicitMovUrlHit) {
        tmdbId = null;
        imdbId = null;
      }
    }

    // activeContext.title nur heranziehen, wenn ein TMDb/IMDb-Steckbrief vorliegt, der Dateiname generisch ist oder der Titel übereinstimmt
    const usePreContextTitle = Boolean(
      !inlineExplicitTitle &&
      !ownSeriesNameInMsg &&
      !(hasOwnParenYear && !hasOwnSeriesMarkerInMsg && activeContext.mediaType === "tv") &&
      activeContext.title &&
      (
        activeContext.tmdbId ||
        activeContext.imdbId ||
        isGenericFile ||
        !line1 ||
        cleanMediaTitle(line1).toLowerCase().startsWith(activeContext.title.toLowerCase().slice(0, 6))
      )
    );

    const explicitTitle = inlineExplicitTitle || (usePreContextTitle ? activeContext.title : null);
    const originalTitle = text.match(/Originaltitel:\s*([^\n]+)/i)?.[1]?.trim() || (usePreContextTitle ? activeContext.originalTitle : null);
    const explicitYear  = inlineExplicitYear || (usePreContextTitle ? activeContext.year : null);

    // Regel 2 / Fall 15: 60-Zeichen-Abschneidung bei file_name umgehen -> line1 hat Vorrang
    let sourceUsed = "file_name";
    let primarySource = fileName;
    if (explicitTitle) {
      primarySource = explicitTitle;
      sourceUsed = usePreContextTitle ? "pre_context_title" : "explicit_title";
    } else if (line1 && line1.length >= 2 && line1.length <= 160 && !/^(?:Qualität|Größe|Groesse|Size|Format|Dauer|Laufzeit|Länge|Sprache|Language|Genre|Gener|Studio|Director|Regie|Darsteller|Actors|Cast|Released|Release|FSK|IMDb|Rating|Preis|Free)\s*[:=-]/i.test(line1) && !/^(?:\+?\s*1[268]\s*\+?|Ab\s+\d+\s+Jahren)/i.test(line1)) {
      primarySource = line1;
      sourceUsed = "caption_line1";
    } else if (isGenericFile && line1) {
      primarySource = line1;
      sourceUsed = "caption_line1";
    } else if (isGenericFile && !activeContext.seriesHeader && !tmdbId) {
      return null;
    }
    if (tmdbId && activeContext.tmdbId === tmdbId) {
      sourceUsed = "pre_context_tmdb";
    }

    let season = null, episode = null, episodeEnd = null, seriesTitle = null, episodeTitle = "";
    let hasExplicitEpisodeMarker = false;
    const inlineStaffelNum = text.match(/\b(?:Staffel|Season)\s*0*(\d{1,2})\b/i)?.[1]
      ? parseInt(text.match(/\b(?:Staffel|Season)\s*0*(\d{1,2})\b/i)[1], 10)
      : (activeContext.season || null);

    // Regel 3 + Breaking Bad S03E01 Fix: Prüfe bis zu 12 Zeilen nach S01E01 oder "Folge 1" / "Episode 1"
    let multiLineSeHit = null;
    for (let idx = 1; idx < Math.min(lines.length, 12); idx++) {
      const mLine = lines[idx].match(/(?:^|[\s._\-(🔸🔶])S(\d{1,2})[\s._-]*E(\d{1,3})(?:[\s._\-+&|/]*E?(\d{1,3}))?(?:$|[\s._\-)|⎪🔸🔶])/i);
      if (mLine) {
        multiLineSeHit = { lineIndex: idx, match: mLine, lineText: lines[idx] };
        break;
      }
      const mFolgeLine = lines[idx].match(/(?:^|[\s._\-(🔸🔶])(?:Staffel\s*0*(\d{1,2})[\s._\-·‧,]*)?(?:Folge|Episode)\s*0*(\d{1,3})\b/i);
      if (mFolgeLine) {
        const sVal = mFolgeLine[1] ? parseInt(mFolgeLine[1], 10) : (inlineStaffelNum || 1);
        const eVal = parseInt(mFolgeLine[2], 10);
        const synthMatch = [`S${String(sVal).padStart(2, "0")}E${String(eVal).padStart(2, "0")}`, String(sVal), String(eVal), null];
        synthMatch.index = mFolgeLine.index || 0;
        multiLineSeHit = { lineIndex: idx, match: synthMatch, lineText: lines[idx] };
        break;
      }
    }

    // Regel 7: Alle Serien- & Episoden-Muster (inkl. Raute-Schema, Mehrzeiler, Cross-Check Text <-> Dateiname)
    const hashStaffelMatch = primarySource.match(/^(.+?)[_\s]*#[_\s]*(?:Staffel[_\s]*(\d{1,2})[_\s,.\-]*(?:Folge|Episode)[_\s]*(\d{1,3})|S(\d{1,2})E(\d{1,3}))[_\s]*(?:[#\-–]+[_\s]*)(.+)$/i)
                          || fileName.match(/^(.+?)[_\s]*#[_\s]*(?:Staffel[_\s]*(\d{1,2})[_\s,.\-]*(?:Folge|Episode)[_\s]*(\d{1,3})|S(\d{1,2})E(\d{1,3}))[_\s]*(?:[#\-–]+[_\s]*)(.+)$/i);
    const epStaffelVon = (primarySource.match(/^(?:Episode|Folge)[_\s.]*(\d{1,3})(?:[_\s.\-&]+(\d{1,3}))?[_\s.\-]*(?:(?:\(?Staffel[_\s.]*(\d{1,2})\)?)[_\s.\-]*(?:von[_\s.]+)?|(?:von[_\s.]+))(.+?)(?:[_\s.]*\(\d{1,3}\))?(?:[_\s.]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|\.(?:mp4|mkv)|$)/i)
                       || fileName.match(/^(?:Episode|Folge)[_\s.]*(\d{1,3})(?:[_\s.\-&]+(\d{1,3}))?[_\s.\-]*(?:(?:\(?Staffel[_\s.]*(\d{1,2})\)?)[_\s.\-]*(?:von[_\s.]+)?|(?:von[_\s.]+))(.+?)(?:[_\s.]*\(\d{1,3}\))?(?:[_\s.]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|\.(?:mp4|mkv)|$)/i));
    const textSeParts = extractSePartsFromSource(primarySource);
    const fileSeParts = !isGenericFile ? extractSePartsFromSource(fileName) : null;
    const seriesFolge = primarySource.match(/^(.+?)[_\s.\-·‧]+(?:Staffel[_\s.]*(\d{1,2})[_\s.\-·‧]+)?(?:Folge|Episode)[_\s.]*(\d{1,3})\b[_\s.\-·‧:]*(.*)$/i)
                     || fileName.match(/^(.+?)[_\s.\-·‧]+(?:Staffel[_\s.]*(\d{1,2})[_\s.\-·‧]+)?(?:Folge|Episode)[_\s.]*(\d{1,3})\b[_\s.\-·‧:]*(.*)$/i);
    const leadingFolgeOnly = (primarySource.match(/^(?:Folge|Episode)[_\s.]*(\d{1,3})\b(.*)$/i)
                           || fileName.match(/^(?:Folge|Episode)[_\s.]*(\d{1,3})\b(.*)$/i));

    // Datum vor Jahres-Extraktion entfernen, damit (21.07.2012) oder (01.12.2018) niemals als Jahr 2012/2018 erkannt wird (Fall 17)
    // Wichtig ("Wonder Woman 1984 (2020)" & "Iron Man 3 (2013)"-Fix): Zuerst nach einer eingeklammerten Jahreszahl (YYYY) suchen!
    const PAREN_YEAR_REGEX = /[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(19[2-9]\d|20[0-2]\d)\s*[\)\]]/i;
    const dateSafePrimary = ` ${primarySource.replace(FULL_DATE_REGEX, " ")} `;
    const dateSafeFile = ` ${fileName.replace(FULL_DATE_REGEX, " ")} `;
    const dateSafeLine1 = ` ${line1.replace(FULL_DATE_REGEX, " ")} `;
    const parenYearMatch = dateSafePrimary.match(PAREN_YEAR_REGEX) || dateSafeLine1.match(PAREN_YEAR_REGEX) || dateSafeFile.match(PAREN_YEAR_REGEX);
    const yearMatch = parenYearMatch || dateSafePrimary.match(YEAR_REGEX) || dateSafeLine1.match(YEAR_REGEX) || dateSafeFile.match(YEAR_REGEX);
    const hasAnyYearInMsg = Boolean(explicitYear || parenYearMatch || yearMatch || hasOwnParenYear);

    if (hashStaffelMatch) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      episodeTitle = cleanMediaTitle(hashStaffelMatch[1]);
      season = parseInt(hashStaffelMatch[2] || hashStaffelMatch[4], 10);
      episode = parseInt(hashStaffelMatch[3] || hashStaffelMatch[5], 10);
      seriesTitle = cleanMediaTitle(hashStaffelMatch[6]);
    } else if (multiLineSeHit) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      const m = multiLineSeHit.match;
      season = parseInt(m[1], 10);
      episode = parseInt(m[2], 10);
      if (m[3]) episodeEnd = parseInt(m[3], 10);

      // Schutz für Batch-Überschriften auf Einzelfolgen (z. B. ID 45807 Hardcore Pawn "Staffel 5 Folge 19 - 26" bei Datei "S05E19")
      if (episodeEnd && (episodeEnd - episode >= 2) && fileSeParts && !fileSeParts.episodeEnd) {
        episode = fileSeParts.episode;
        episodeEnd = null;
      }

      const beforeText = cleanMediaTitle(line1.replace(/Staffel\s*\d+.*/i, "").replace(YEAR_REGEX, " "));
      const beforeFile = fileSeParts ? (fileSeParts.before || (!fileSeParts.before && fileSeParts.after && !beforeText ? fileSeParts.after : "")) : "";
      seriesTitle = pickBestSeriesTitleCandidate(beforeText, beforeFile, activeContext.seriesHeader);

      // Regel 3: Text hinter S01E01 (z.B. hinter "⎪" oder "-") oder in der Folgezeile (z.B. "Community\nS01-E01\nZurück aufs College !") ist Episodentitel
      let tailEp = cleanMediaTitle(multiLineSeHit.lineText.slice((m.index || 0) + m[0].length));
      if (!tailEp && lines[multiLineSeHit.lineIndex + 1]) {
        const nextLine = lines[multiLineSeHit.lineIndex + 1];
        if (nextLine.length <= 80 && !/^(?:\(|Regie:|Darsteller:|Bildqualität:|Tonqualität:|Plot:|Beschreibung:|Rating:|https?:|@)/i.test(nextLine)) {
          tailEp = cleanMediaTitle(nextLine);
        }
      }
      // Regel 2 Cross-Check: Wenn im mehrzeiligen Text kein Episodentitel steht (wie bei "A.D. Rebellen und Märtyrer" 🔶 S01E01 🔶), aus dem Dateinamen holen!
      if (!tailEp && fileSeParts && fileSeParts.after && normalizeCompareString(fileSeParts.after) !== normalizeCompareString(seriesTitle)) {
        tailEp = fileSeParts.after;
      }
      episodeTitle = tailEp;
    } else if (epStaffelVon) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      episode = parseInt(epStaffelVon[1], 10);
      if (epStaffelVon[2]) episodeEnd = parseInt(epStaffelVon[2], 10);
      season = epStaffelVon[3] ? parseInt(epStaffelVon[3], 10) : (inlineStaffelNum || 1);
      seriesTitle = cleanMediaTitle(epStaffelVon[4]);
    } else if (textSeParts || fileSeParts) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      const mainSe = textSeParts || fileSeParts;
      season = mainSe.season;
      episode = mainSe.episode;
      episodeEnd = mainSe.episodeEnd;

      // Regel 2 Cross-Check zwischen Text und Dateiname:
      // Wenn in einer Quelle vor SxxExx der Serienname leer ist (z.B. Datei "S01E01 - Lust auf Unabhängigkeit.mp4"),
      // prüfe zwingend die jeweils andere Quelle (Text "What's up, Dad? - S01E01 =Lust auf Unabhängigkeit="), BEVOR auf after oder prevContext zurückgefallen wird!
      let beforeText = textSeParts ? textSeParts.before : "";
      let afterText  = textSeParts ? textSeParts.after  : "";
      let beforeFile = fileSeParts ? fileSeParts.before : "";
      let afterFile  = fileSeParts ? fileSeParts.after  : "";

      // Fall 6 (ID 7068 "Unser Kosmos"): Punkt-getrennter Szene-Name mit Episodentitel vor S01E01 in der Caption
      if (beforeText && beforeFile && !afterText && beforeText.toLowerCase().startsWith(beforeFile.toLowerCase()) && beforeText.length > beforeFile.length + 3) {
        afterText = cleanMediaTitle(beforeText.slice(beforeFile.length));
        beforeText = beforeFile;
      }

      const combinedBefore = pickBestSeriesTitleCandidate(beforeText, beforeFile, "");
      if (combinedBefore) {
        seriesTitle = combinedBefore;
        // Längeren/vollständigeren Episodentitel bevorzugen (wichtig bei 60-Zeichen-Abschneidung im Dateinamen wie "My Hero Academia Vigilantes")
        if (afterText && afterFile) {
          episodeTitle = afterText.length >= afterFile.length ? afterText : afterFile;
        } else {
          episodeTitle = afterText || afterFile || "";
        }
      } else {
        // E01S01 Frontier 2016 Fix: Wenn vor S01E01 nichts steht, hat ein expliziter Serienname hinter S01E01 (z.B. "Frontier 2016")
        // Vorrang, sofern kein passender seriesHeader vorliegt oder im String ein Jahr steht!
        const afterCandidate = afterText || afterFile || "";
        const hasYearInSource = YEAR_REGEX.test(` ${primarySource} `) || YEAR_REGEX.test(` ${fileName} `);
        if (afterCandidate && (hasYearInSource || !activeContext.seriesHeader)) {
          seriesTitle = afterCandidate;
          episodeTitle = "";
        } else {
          seriesTitle = activeContext.seriesHeader || afterCandidate || "";
          episodeTitle = (activeContext.seriesHeader && afterCandidate) ? afterCandidate : "";
        }
      }
    } else if (seriesFolge) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      seriesTitle = cleanMediaTitle(seriesFolge[1].replace(/Staffel\s*\d+.*/i, "").replace(YEAR_REGEX, " "));
      season = seriesFolge[2] ? parseInt(seriesFolge[2], 10) : (inlineStaffelNum || 1);
      episode = parseInt(seriesFolge[3], 10);
      episodeTitle = cleanMediaTitle(seriesFolge[4]);
      // Fall 7 (IDs 12794-12795): "01 - Jacob_2_2_und_der_Kapuzen_Reisszahn_Episode_1.mp4" -> Serie "Jacob 2/2"
      const jacobMatch = seriesTitle.match(/^(Jacob\s*2[\s/_]*2)\s+(und\s+.+)$/i);
      if (jacobMatch) {
        episodeTitle = cleanMediaTitle(`Jacob 2/2 ${jacobMatch[2]}`);
        seriesTitle = "Jacob 2/2";
      }
    } else if (leadingFolgeOnly) {
      // Fall 17 (ID 131141) & Breaking Bad S03 Folge 1-4: "Folge 1" / "Folge 15 - @ArcheMovie"
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      season = inlineStaffelNum || 1;
      episode = parseInt(leadingFolgeOnly[1], 10);
      const remClean = cleanMediaTitle(leadingFolgeOnly[2].replace(YEAR_REGEX, " "));
      seriesTitle = activeContext.seriesHeader || remClean || "Unbekannt";
      if (activeContext.seriesHeader && remClean && normalizeCompareString(remClean) !== normalizeCompareString(activeContext.seriesHeader)) {
        episodeTitle = remClean;
      }
    } else if (
      activeContext.seriesHeader &&
      !partInfo.isSplit &&
      !hasOwnParenYear &&
      (!durationSec || durationSec < 4200)
    ) {
      // Regel 4 & Regel 8: "Endziffer / Mittelziffer = Episode"-Weiche bei aktivem Serien-Header:
      const cleanedLine = cleanMediaTitle((line1 || fileName || primarySource).replace(YEAR_REGEX, " "));
      const headerLow = activeContext.seriesHeader.toLowerCase();
      const lineLow = cleanedLine.toLowerCase();
      const normHeader = normalizeCompareString(activeContext.seriesHeader);
      const normLine = normalizeCompareString(cleanedLine);
      if (lineLow.startsWith(headerLow.slice(0, 6)) || (normHeader && normLine.startsWith(normHeader.slice(0, 6)))) {
        const rem = cleanedLine.slice(activeContext.seriesHeader.length).trim();
        const numMatch = rem.match(/^[-–·‧:\s]*0*([1-9]\d?)\b\s*(.*)$/);
        if (numMatch) {
          mediaType = "tv";
          seriesTitle = activeContext.seriesHeader;
          season = inlineStaffelNum || activeContext.season || 1;
          episode = parseInt(numMatch[1], 10);
          episodeTitle = cleanMediaTitle(numMatch[2]);
          hasExplicitEpisodeMarker = true;
          sourceUsed = "runtime_series_switch";
        }
      } else {
        // Auch wenn Wortstellung im Dateinamen gedreht ist (z. B. ID 106-110 "Gormenghast - Das Schloß im Nebel" -> "Das Schloss im Nebel - Die Legende von Gormenghast 1")
        const trailingNum = cleanedLine.match(/^(.{3,}?)\s+0*([1-9]\d?)$/);
        if (trailingNum) {
          const headerWords = headerLow.split(/[^a-zäöüß0-9]+/).filter(w => w.length >= 4);
          if (headerWords.some(w => lineLow.includes(w))) {
            mediaType = "tv";
            seriesTitle = activeContext.seriesHeader;
            season = inlineStaffelNum || activeContext.season || 1;
            episode = parseInt(trailingNum[2], 10);
            hasExplicitEpisodeMarker = true;
            sourceUsed = "runtime_series_switch";
          }
        }
      }
    }

    // Eingebettete Folgennummer + Episodentitel (z.B. "Pippi Langstrumpf 1 Pippi zieht in die Villa Kunterbunt", "Zur See 1 Die Bewährung")
    // ODER einfache Endziffern (z.B. "Black Box 1", "Spuk im Hochhaus 1", "Spuk unterm Riesenrad 1"):
    const MOVIE_FRANCHISE_GUARD = /^(?:deep\s+blue\s+sea|deep\s+blue|mad\s+max|sharknado|sector|ghettogangz|burg\s+schreckenstein|fifty\s+shades|jumanji|machete|crank|mechanic|tremors|lake\s+placid|anaconda|piranha|death\s+race|sniper|marine|jarhead|scorpion\s+king|mumie|mummy|vermächtnis|percy\s+jackson|schlümpfe|smurfs|ralph\s+reichts|zoomania|pets|sing|rio|jagdfieber|paddington|ted|kill\s+bill|sin\s+city|300|kick[\s-]*ass|johnny\s+english|austin\s+powers|universal\s+soldier|bloodsport|kickboxer|never\s+back\s+down|boyka|fack\s+ju|ostwind|bibi|conni|vorstadtkrokodile|wilde\s+kerle|fünf\s+freunde|tkkg|drei\s+fragezeichen|rush\s+hour|taken|punisher|blade|ong\s+bak|raid|goal|hooligans|manta|troll|nun|sinister|freitag\s+der|nightmare|saw|spider[\s-]*man|iron\s+man|ninja\s+turtles|teenage\s+mutant\s+ninja\s+turtles|james\s+bond|007|shrek|kingsman|pirates\s+of\s+the\s+caribbean|fluch\s+der\s+karibik|wonder\s+woman|venom|underworld|final\s+destination|insidious|paranormal\s+activity|jurassic\s+park|jurassic\s+world|indiana\s+jones|star\s+wars|star\s+trek|harry\s+potter|fast\s+and\s+furious|the\s+fast\s+and\s+the\s+furious|transporter|russian\s+transporter|bourne|mission\s+impossible|scary\s+movie|american\s+pie|step\s+up|ip\s+man|undisputed|scream|halloween|hellraiser|chucky|annabelle|avengers|captain\s+america|thor|guardians\s+of\s+the\s+galaxy|deadpool|x[\s-]*men|matrix|john\s+wick|equalizer|expendables|rambo|rocky|creed|alien|predator|terminator|robocop|die\s+hard|stirb\s+langsam|lethal\s+weapon|beverly\s+hills\s+cop|bad\s+boys|men\s+in\s+black|ghostbusters|back\s+to\s+the\s+future|zurück\s+in\s+die\s+zukunft|lord\s+of\s+the\s+rings|herr\s+der\s+ringe|hobbit|narnia|twilight|hunger\s+games|tribute\s+von\s+panem|maze\s+runner|divergent|resident\s+evil|silent\s+hill|conjuring|purge|quiet\s+place|hangover|oceans|now\s+you\s+see\s+me|unfassbaren|hotel\s+transsilvanien|hotel\s+transylvania|ice\s+age|madagascar|ich\s+einfach\s+unverbesserlich|despicable\s+me|minions|toy\s+story|cars|planes|kung\s+fu\s+panda|drachenzähmen|how\s+to\s+train\s+your\s+dragon|frozen|eiskönigin)\b/i;
    // Wichtig ("Deep Blue Sea 3 (2020)-001.mkv"-Fix):
    // 1. Mehrteilige Video-Splits (partInfo.isSplit, z.B. -001.mkv .. -005.mkv, CD 1..5) ohne explizites SxxExx/Staffel/Folge sind IMMER Filme!
    // 2. Steht im Originaltext/Dateinamen eine Jahreszahl in Klammern (hasOwnParenYear, z.B. "(2020)"), ist eine Zahl vor (2020) eine Film-Fortsetzungsnummer und NIEMALS eine Serien-Folge!
    if (
      mediaType !== "tv" &&
      !tmdbId &&
      !partInfo.isSplit &&
      !hasOwnParenYear &&
      (!durationSec || durationSec < 4200)
    ) {
      const cleanedCand = cleanMediaTitle(primarySource.replace(YEAR_REGEX, " "));
      const normHeader = activeContext.seriesHeader ? normalizeCompareString(activeContext.seriesHeader) : "";
      const midEp = cleanedCand.match(/^(.{3,}?)\s+(?<!\d)0?([1-9]\d?)\s+([A-ZÄÖÜa-zäöü].{3,})$/);
      if (midEp && !/^(?:Teil|Part|CD|Disc|DVD|bd|4k|uhd|1080p|720p)\b/i.test(midEp[3]) && !/\b007\b/.test(cleanedCand) && !MOVIE_FRANCHISE_GUARD.test(midEp[1].trim()) && !MOVIE_FRANCHISE_GUARD.test(cleanedCand)) {
        const candBaseNorm = normalizeCompareString(midEp[1]);
        const headerMatches = Boolean(normHeader && candBaseNorm && (candBaseNorm.startsWith(normHeader.slice(0, 6)) || normHeader.startsWith(candBaseNorm.slice(0, 6))));
        const isKnownClassicNumberedSeries = /^(?:pippi\s+langstrumpf|zur\s+see|spuk\s+im\s+hochhaus|spuk\s+unterm\s+riesenrad|spuk\s+von\s+draußen|spuk\s+von\s+draussen|black\s+box|das\s+schloss\s+im\s+nebel|gormenghast|archiv\s+des\s+todes|front\s+ohne\s+gnade|feuerdrachen|gefährliche\s+fahndung|treffpunkt\s+flughafen|rote\s+bergsteiger)\b/i.test(midEp[1].trim());
        const epNumVal = parseInt(midEp[2], 10);
        if ((headerMatches || isKnownClassicNumberedSeries) && epNumVal >= 1 && epNumVal <= 99) {
          mediaType = "tv";
          seriesTitle = (headerMatches && activeContext.seriesHeader) ? activeContext.seriesHeader : cleanMediaTitle(midEp[1]);
          season = inlineStaffelNum || activeContext.season || 1;
          episode = epNumVal;
          episodeTitle = cleanMediaTitle(midEp[3]);
          hasExplicitEpisodeMarker = true;
        }
      } else {
        // Einfache Endziffern (z. B. "Black Box 1", "Spuk im Hochhaus 1", "Spuk unterm Riesenrad 1"):
        const tailEpMatch = cleanedCand.match(/^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9\s._\-]{2,}?)\s+0*([1-9]\d?)$/);
        if (tailEpMatch && !/\b(?:Teil|Part|CD|Disc|DVD|4K|3D|007)\s*$/i.test(tailEpMatch[1]) && !MOVIE_FRANCHISE_GUARD.test(tailEpMatch[1].trim()) && !MOVIE_FRANCHISE_GUARD.test(cleanedCand)) {
          const candBaseNorm = normalizeCompareString(tailEpMatch[1]);
          const headerMatches = Boolean(normHeader && candBaseNorm && (candBaseNorm.startsWith(normHeader.slice(0, 6)) || normHeader.startsWith(candBaseNorm.slice(0, 6))));
          const isKnownClassicNumberedSeries = /^(?:pippi\s+langstrumpf|zur\s+see|spuk\s+im\s+hochhaus|spuk\s+unterm\s+riesenrad|spuk\s+von\s+draußen|spuk\s+von\s+draussen|black\s+box|das\s+schloss\s+im\s+nebel|gormenghast|archiv\s+des\s+todes|front\s+ohne\s+gnade|feuerdrachen|gefährliche\s+fahndung|treffpunkt\s+flughafen|rote\s+bergsteiger)\b/i.test(tailEpMatch[1].trim());
          const epNumVal = parseInt(tailEpMatch[2], 10);
          if ((headerMatches || isKnownClassicNumberedSeries) && epNumVal >= 1 && epNumVal <= 30) {
            mediaType = "tv";
            seriesTitle = (headerMatches && activeContext.seriesHeader) ? activeContext.seriesHeader : cleanMediaTitle(tailEpMatch[1]);
            season = inlineStaffelNum || activeContext.season || 1;
            episode = epNumVal;
            hasExplicitEpisodeMarker = true;
          }
        }
      }
    }

    // Eiserne Weichen-Regel ("Iron Man 3 (2013)" & "The Cell 2 (2009)"-Fix):
    // 1. Wenn eine EIGENE Jahreszahl in Klammern (YYYY) im Post steht UND kein expliziter Serien-Marker vorliegt -> FILM!
    // 2. Ein Video OHNE expliziten Episoden-Marker darf bei duration >= 4200 Sek. niemals als TV-Episode gelten!
    if (
      (hasOwnParenYear && !hasExplicitEpisodeMarker && !explicitTvUrlHit) ||
      (mediaType === "tv" && !hasExplicitEpisodeMarker && !tmdbId && durationSec && durationSec >= 4200)
    ) {
      mediaType = "movie";
      season = null;
      episode = null;
      episodeEnd = null;
      seriesTitle = null;
      episodeTitle = "";
    }

    let year = explicitYear ? parseInt(explicitYear, 10) : (yearMatch ? parseInt(yearMatch[1], 10) : null);
    if (!year && mediaType === "tv" && activeContext.year && activeContext.seriesHeader && seriesTitle &&
        normalizeCompareString(seriesTitle).slice(0, 6) === normalizeCompareString(activeContext.seriesHeader).slice(0, 6)) {
      year = Number(activeContext.year);
    }

    let rawTitle = seriesTitle || explicitTitle || primarySource;
    if (!seriesTitle && !explicitTitle && yearMatch && yearMatch.index > 2) {
      const matchedSource = parenYearMatch
        ? (dateSafePrimary.match(PAREN_YEAR_REGEX) ? dateSafePrimary : (dateSafeLine1.match(PAREN_YEAR_REGEX) ? dateSafeLine1 : dateSafeFile))
        : (dateSafePrimary.match(YEAR_REGEX) ? dateSafePrimary : (dateSafeLine1.match(YEAR_REGEX) ? dateSafeLine1 : dateSafeFile));
      rawTitle = matchedSource.slice(0, yearMatch.index).trim();
    }
    if (year) {
      const strippedYearTitle = cleanMediaTitle(rawTitle.replace(new RegExp(`\\b${year}\\b`, "g"), " "));
      if (strippedYearTitle.length >= 2) rawTitle = strippedYearTitle;
    }
    rawTitle = rawTitle.replace(/[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(?:19[2-9]\d|20[0-2]\d)\s*[\)\]]?/gi, "");
    rawTitle = rawTitle.replace(/\s*(?:Plot|Beschreibung)\s*:.*$/i, "");
    const cleanTitle = cleanMediaTitle(rawTitle) || cleanMediaTitle(fileName) || cleanMediaTitle(line1);
    if (!cleanTitle) return null;

    if (episodeTitle && year) {
      episodeTitle = cleanMediaTitle(episodeTitle.replace(new RegExp(`\\b${year}\\b`, "g"), " "));
    }
    if (episodeTitle && normalizeCompareString(episodeTitle) === normalizeCompareString(cleanTitle)) {
      episodeTitle = "";
    }

    return {
      mediaType,
      isArchive,
      tmdbId,
      imdbId,
      title: cleanTitle,
      originalTitle,
      year,
      season,
      episode,
      episodeEnd,
      episodeTitle,
      quality,
      width: videoWidth,
      height: videoHeight,
      languages,
      subtitles,
      editions: editionInfo.editions,
      partInfo,
      durationSec,
      sourceUsed,
      rawFileName,
      rawText
    };
  }

  // Regel 5: Sauberes Gruppieren der Serien-Episoden & Multi-Part-Filme
  function groupSeriesAndMoviesFromEntries(entries = []) {
    const series = {};
    const moviesMap = {};

    for (const item of entries) {
      if (!item) continue;
      const isTv = Boolean(item.isSeries || item.mediaType === "tv" || item.type === "series" || item.type === "tv");
      const title = String(item.cleanTitle || item.title || "Unbekannt").trim();
      const msgId = item.message_id || item.msg_id || item.id || null;
      const fName = item.raw_file_name || item.rawFileName || item.file_name || item.filename || null;

      if (isTv) {
        const seriesKey = item.tmdb_id ? `tmdb_${item.tmdb_id}` : normalizeCompareString(title).replace(/\s+/g, "");
        if (!seriesKey) continue;
        if (!series[seriesKey]) {
          series[seriesKey] = {
            title,
            year: item.year || null,
            mediaType: "tv",
            tmdbId: item.tmdb_id || item.tmdbId || null,
            seasons: {}
          };
        } else if (!series[seriesKey].year && item.year) {
          series[seriesKey].year = item.year;
        }
        const sNum = String(item.season || 1);
        const eStart = Number(item.episode || 1);
        const eEnd = item.episodeEnd && Number(item.episodeEnd) >= eStart ? Number(item.episodeEnd) : eStart;
        if (!series[seriesKey].seasons[sNum]) {
          series[seriesKey].seasons[sNum] = {};
        }
        for (let eNum = eStart; eNum <= eEnd; eNum++) {
          const epKey = String(eNum);
          const existingEp = series[seriesKey].seasons[sNum][epKey];
          if (!existingEp) {
            series[seriesKey].seasons[sNum][epKey] = {
              e: eNum,
              title: item.episodeTitle || "",
              message_id: msgId,
              ids: msgId ? [msgId] : [],
              file_name: fName
            };
          } else {
            if (!existingEp.title && item.episodeTitle) existingEp.title = item.episodeTitle;
            if (msgId && !existingEp.ids.includes(msgId)) existingEp.ids.push(msgId);
          }
        }
      } else {
        const movieKey = item.tmdb_id ? `tmdb_${item.tmdb_id}` : `${normalizeCompareString(title).replace(/\s+/g, "")}_${item.year || ""}`;
        if (!movieKey) continue;
        const pInfo = item.partInfo || extractPartInfo(item.raw_text || "", fName || "", item.duration_sec || 0) || {};
        if (!moviesMap[movieKey]) {
          moviesMap[movieKey] = {
            title,
            year: item.year || null,
            mediaType: "movie",
            tmdbId: item.tmdb_id || item.tmdbId || null,
            message_id: msgId,
            editions: item.editions || [],
            parts: []
          };
        }
        moviesMap[movieKey].parts.push({
          part: pInfo.part || pInfo.partNumber || 1,
          partType: pInfo.partType || null,
          isSplit: Boolean(pInfo.isSplit || pInfo.isMultiPart),
          messageId: msgId,
          file_name: fName
        });
        moviesMap[movieKey].parts.sort((a, b) => a.part - b.part);
      }
    }

    return { series, movies: Object.values(moviesMap), moviesMap };
  }

  // Wandelt menschliche Größenangaben (z.B. "2.45 GB", "890 MB", "1,8 GB" oder Bytes) zuverlässig in Bytes (Integer) um
  function parseHumanFileSizeToBytes(rawInput) {
    if (rawInput === null || rawInput === undefined || rawInput === "") return null;
    if (typeof rawInput === "number" && Number.isFinite(rawInput) && rawInput > 0) {
      return Math.round(rawInput);
    }
    const str = String(rawInput).trim();
    if (!str) return null;
    if (/^\d+$/.test(str)) {
      const n = Number(str);
      return n > 0 ? Math.round(n) : null;
    }
    const m = str.match(/(\d+(?:[.,]\d+)?)\s*(tb|tib|gb|gib|mb|mib|kb|kib|b)?/i);
    if (!m) return null;
    const val = parseFloat(m[1].replace(",", "."));
    if (!Number.isFinite(val) || val <= 0) return null;
    const unit = (m[2] || "mb").toLowerCase();
    if (unit.startsWith("t")) return Math.round(val * 1024 * 1024 * 1024 * 1024);
    if (unit.startsWith("g")) return Math.round(val * 1024 * 1024 * 1024);
    if (unit.startsWith("m")) return Math.round(val * 1024 * 1024);
    if (unit.startsWith("k")) return Math.round(val * 1024);
    return Math.round(val);
  }

  function formatFileSizeBytes(bytes) {
    const num = Number(bytes || 0);
    if (!Number.isFinite(num) || num <= 0) return "";
    const mb = num / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }

  // Prüft auf extrem schlechte Vorab-Qualitäten (#vorabversion, TS/TeleSync, CAM, MD/Mic-Dub), die nur als Notfall gespeichert
  // und automatisch gelöscht werden, sobald eine reguläre Version vorhanden ist.
  function isPrereleaseOrMicDub(rawText = "", rawFileName = "", tags = "") {
    const fnWithoutExt = String(rawFileName || "").replace(/\.(?:mp4|mkv|avi|mov|m4v|webm|ts|flv|wmv|mk3d|rar|srt|vtt|sub)$/i, "");
    const combined = `${String(rawText || "")} ${fnWithoutExt} ${String(tags || "")}`;
    if (!combined.trim()) return false;
    return /#vorabversion|\bvorab[\s._-]*version\b|⚠️\s*vorabversion|\b(?:hd)?ts\b|\btelesync\b|\b(?:hd)?cam(?:rip)?\b|\bmic[\s._-]*dub(?:bed)?\b|\bline[\s._-]*dub(?:bed)?\b|\bmd\b|\bdvdscr\b|\bscreener\b|\bworkprint\b/i.test(combined);
  }

  // Extrahiert Audio-, Sprach-, HDR-, Edition- & Release-Tags (inkl. Länderflaggen via detectLanguages)
  function extractMediaReleaseTags(rawText, rawFileName = "", durationSec = null) {
    const s = String(rawText || "");
    const fn = String(rawFileName || "");
    if (!s && !fn) return [];
    const combined = `${s} ${fn}`.trim();
    const tags = [];
    const addTag = (t) => { if (t && !tags.includes(t)) tags.push(t); };

    if (/\.rar$/i.test(fn) || /\.part\d+\.rar\b/i.test(combined)) {
      addTag("📦 RAR-Archiv");
    }
    if (isPrereleaseOrMicDub(s, fn)) {
      addTag("⚠️ Vorabversion");
    }

    const detectedLangInfo = detectLanguages(s, fn);
    const detectedLangs = detectedLangInfo.languages || ["de"];
    const detectedSubs = detectedLangInfo.subtitles || [];
    if (detectedLangs.length > 1) addTag("DL");
    for (const lg of detectedLangs) {
      addTag(lg.toUpperCase());
    }
    for (const sb of detectedSubs) {
      addTag(sb === "sub" ? "SUB" : sb === "forced" ? "FORCED" : `${sb.toUpperCase()}-SUB`);
    }

    if (/\b(?:dual[\s._-]*audio|dl|german[\s._-]*dl|deutsch.*englisch)\b/i.test(combined)) addTag("DL");
    if (/\b(?:dolby[\s._-]*vision|dovi|\bdv\b)\b/i.test(combined)) addTag("DV");
    if (/\bhdr10\+?\b/i.test(combined)) addTag("HDR10");
    else if (/\bhdr\b/i.test(combined)) addTag("HDR");

    if (/\b(?:remux)\b/i.test(combined)) addTag("Remux");
    else if (/\b(?:bluray|blu[\s._-]*ray|bdrip|brrip)\b/i.test(combined)) addTag("BluRay");
    else if (/\b(?:web[\s._-]*dl|webdl)\b/i.test(combined)) addTag("WEB-DL");
    else if (/\b(?:webrip|web[\s._-]*rip)\b/i.test(combined)) addTag("WEBRip");

    if (/\b(?:atmos)\b/i.test(combined)) addTag("Atmos");
    if (/\b7\.1\b/.test(combined)) addTag("7.1");
    else if (/\b5\.1\b/.test(combined)) addTag("5.1");
    if (/\b(?:dts[\s._-]*hd|dts|truehd)\b/i.test(combined)) addTag("DTS");

    const editionInfo = extractAndStripEditions(combined);
    for (const ed of editionInfo.editions) {
      addTag(ed);
    }

    const partInfo = extractPartInfo(s, fn, durationSec);
    if (partInfo && partInfo.partLabel) {
      addTag(partInfo.partLabel);
    }

    return tags.slice(0, 8);
  }

  function parseMediaFilename(rawFilenameOrTitle, rawCaptionText = "", preContext = null, durationSec = null, mediaDimensions = null) {
    const raw = String(rawFilenameOrTitle || "").trim();
    if (!raw && !rawCaptionText && !preContext) {
      return {
        raw: "",
        cleanTitle: "",
        originalTitle: null,
        year: null,
        isSeries: false,
        season: null,
        episode: null,
        episodeEnd: null,
        episodeTitle: "",
        quality: null,
        codec: "x264",
        part: null,
        partInfo: null,
        editions: [],
        tags: "",
        languages: ["de"],
        subtitles: [],
        parsedFileSize: null
      };
    }

    const combinedRaw = `${raw} ${rawCaptionText || ""}`.trim();
    const isRarArchive = /\.rar$/i.test(raw) || /\.part\d+\.rar\b/i.test(combinedRaw);
    const extractedTagsList = extractMediaReleaseTags(rawCaptionText || raw, raw, durationSec);
    const langInfo = detectLanguages(rawCaptionText, raw);
    const languages = langInfo.languages;
    const subtitles = langInfo.subtitles;
    const editionInfo = extractAndStripEditions(combinedRaw);
    const partInfo = extractPartInfo(rawCaptionText, raw, durationSec);
    const sizeInTextMatch = combinedRaw.match(/\b(\d{1,4}(?:[.,]\d{1,2})?\s*(?:GB|GiB|MB|MiB))\b/i);
    const parsedFileSize = sizeInTextMatch ? parseHumanFileSizeToBytes(sizeInTextMatch[1]) : null;

    // 1. Mehrfache Dateiendungen entfernen & Text normalisieren (Regel 1 & 4)
    const normalizedRaw = normalizeText(raw);
    const withoutExt = normalizedRaw.replace(/(?:\.part0*\d{1,2})?(?:\.(?:mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mk3d|rar|json))+$/i, "");

    // 2. Echte Video-Auflösung via detectVideoQuality (Pixelmaße width/height zuerst, danach Text/Dateiname, niemals blind "1080p" raten!)
    const quality = detectVideoQuality(mediaDimensions || {}, rawCaptionText, raw);

    // 3. Codec extrahieren (x264, x265/HEVC, AV1 oder RAR für Archive)
    let codec = isRarArchive ? "RAR" : "x264";
    const codecMatch = !isRarArchive ? combinedRaw.match(/\b(x265|h\.?265|hevc|x264|h\.?264|avc|av1|xvid)\b/i) : null;
    if (codecMatch) {
      const cRaw = codecMatch[1].toLowerCase().replace(/\./g, "");
      if (cRaw === "x265" || cRaw === "h265" || cRaw === "hevc") codec = "x265";
      else if (cRaw === "x264" || cRaw === "h264" || cRaw === "avc") codec = "x264";
      else if (cRaw === "av1") codec = "AV1";
      else codec = codecMatch[1];
    }

    // 4. Part extrahieren (CD1, CD2, Disc 1, DVD 2, Part 1, -001/-002, RAR-PART1..20)
    let part = partInfo ? partInfo.partLabel : null;

    // 5. Nutze Gold-Master parseTelegramMessage Logik für Serien/Episoden, Cross-Check & Datums-Schutz
    const gmParsed = parseTelegramMessage({
      file_name: raw,
      text: rawCaptionText || raw,
      duration_seconds: durationSec,
      width: mediaDimensions?.width || mediaDimensions?.video?.width || null,
      height: mediaDimensions?.height || mediaDimensions?.video?.height || null,
      media_type: isRarArchive ? "document" : "video_file"
    }, preContext || {});

    if (gmParsed && gmParsed.title && gmParsed.title !== "Unbekannt") {
      const resolvedPart = (gmParsed.partInfo && gmParsed.partInfo.partLabel) || part || null;
      return {
        raw,
        cleanTitle: gmParsed.title,
        originalTitle: gmParsed.originalTitle || null,
        year: gmParsed.year || null,
        isSeries: gmParsed.mediaType === "tv",
        isArchive: Boolean(gmParsed.isArchive || isRarArchive),
        season: gmParsed.season || null,
        episode: gmParsed.episode || null,
        episodeEnd: gmParsed.episodeEnd || null,
        episodeTitle: gmParsed.episodeTitle || "",
        tmdbId: gmParsed.tmdbId || null,
        imdbId: gmParsed.imdbId || null,
        quality: gmParsed.quality !== undefined ? gmParsed.quality : quality,
        width: gmParsed.width || null,
        height: gmParsed.height || null,
        codec: gmParsed.isArchive || isRarArchive ? "RAR" : codec,
        part: resolvedPart,
        partInfo: gmParsed.partInfo || partInfo || null,
        editions: gmParsed.editions || editionInfo.editions || [],
        tags: extractedTagsList.join(" · "),
        languages,
        subtitles,
        sourceUsed: gmParsed.sourceUsed || "file_name",
        parsedFileSize
      };
    }

    // Fallback falls gmParsed keinen Treffer ergab
    let isSeries = false;
    let season = null;
    let episode = null;
    let cutIndex = withoutExt.length;

    const seRegex = /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i;
    const folgeOnlyRegex = /\b(?:Folge|Episode|Ep\.?)\s*(\d{1,3})\b/i;

    const seMatch = withoutExt.match(seRegex);
    if (seMatch) {
      isSeries = true;
      season = parseInt(seMatch[1], 10) || 1;
      episode = parseInt(seMatch[2], 10) || 1;
      if (typeof seMatch.index === "number" && seMatch.index > 1) cutIndex = Math.min(cutIndex, seMatch.index);
    } else {
      const mf = withoutExt.match(folgeOnlyRegex);
      if (mf) {
        isSeries = true;
        season = 1;
        episode = parseInt(mf[1], 10) || 1;
        if (typeof mf.index === "number" && mf.index > 1) cutIndex = Math.min(cutIndex, mf.index);
      }
    }

    let year = null;
    const paddedWithoutExt = ` ${withoutExt} `;
    const yearMatch = paddedWithoutExt.match(YEAR_REGEX);
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
      if (typeof yearMatch.index === "number" && yearMatch.index > 2) {
        cutIndex = Math.min(cutIndex, yearMatch.index - 1);
      }
    }

    let titleCandidate = withoutExt.slice(0, cutIndex);
    if (!titleCandidate.trim()) titleCandidate = withoutExt;
    const cleanTitle = cleanMediaTitle(titleCandidate) || cleanMediaTitle(withoutExt) || "Unbekannt";

    return {
      raw,
      cleanTitle,
      originalTitle: null,
      year,
      isSeries,
      season,
      episode,
      episodeEnd: null,
      episodeTitle: "",
      quality,
      codec,
      part,
      partInfo: partInfo || null,
      editions: editionInfo.editions || [],
      tags: extractedTagsList.join(" · "),
      languages,
      subtitles,
      sourceUsed: "file_name",
      parsedFileSize
    };
  }

  // --- Markdown & HTML Konverter (100% Schutz gegen kaputte Links, Klammern & Unterstriche!) ---
  function escapeMd(text) {
    if (!text) return "";
    return String(text).replace(/([_*`\[\]])/g, "\\$1");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function unescapeMdChars(str) {
    return String(str || "").replace(/\\([_*`\[\]])/g, "$1");
  }

  // Wandelt Bot-Markdown sicher in Telegram-HTML um (nutzt Steuerzeichen \x01..\x02 ohne Unterstriche!)
  function mdToHtml(rawText) {
    if (!rawText) return "";
    const tokens = [];
    const pushToken = (html) => {
      const id = `\x01TGH${tokens.length}\x02`;
      tokens.push(html);
      return id;
    };

    let s = String(rawText);

    // 1. Mehrzeilige Blöcke ```...``` als elegante Telegram-Blockquote (ohne "copy"-Code-Header!)
    s = s.replace(/```\n?([\s\S]*?)\n?```/g, (_, code) => {
      return pushToken(`<blockquote>${escapeHtml(unescapeMdChars(code))}</blockquote>`);
    });

    // 2. Inline-Code `...` (zum direkten Antippen & Kopieren in die Zwischenablage)
    s = s.replace(/`([^`\n]+)`/g, (_, code) => {
      return pushToken(`<code>${escapeHtml(unescapeMdChars(code))}</code>`);
    });

    // 3. Fette Links *[Label](url)* (unterstützt auch verschachtelte Klammern in URLs!)
    s = s.replace(/\*\[((?:\\.|[^\]])+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)\*/g, (_, label, url) => {
      const cleanLabel = escapeHtml(unescapeMdChars(label));
      const safeUrl = escapeHtml(String(url).replace(/"/g, "%22"));
      return pushToken(`<b><a href="${safeUrl}">${cleanLabel}</a></b>`);
    });

    // 4. Normale Links [Label](url) (unterstützt auch verschachtelte Klammern in URLs!)
    s = s.replace(/\[((?:\\.|[^\]])+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (_, label, url) => {
      const cleanLabel = escapeHtml(unescapeMdChars(label));
      const safeUrl = escapeHtml(String(url).replace(/"/g, "%22"));
      return pushToken(`<a href="${safeUrl}">${cleanLabel}</a>`);
    });

    // 5. Escapete Sonderzeichen sichern
    s = s.replace(/\\([_*`\[\]])/g, (_, ch) => pushToken(escapeHtml(ch)));

    // 6. HTML-Entities im restlichen Text escapen
    s = escapeHtml(s);

    // 7. *fett* und _kursiv_ als Tokens kapseln (verhindert überlappende <b><i>...</b></i> Tags!)
    s = s.replace(/\*([^*\n]+)\*/g, (_, inner) => {
      const withItalic = inner.replace(/_([^_\n]+)_/g, "<i>$1</i>");
      return pushToken(`<b>${withItalic}</b>`);
    });
    s = s.replace(/_([^_\n]+)_/g, (_, inner) => pushToken(`<i>${inner}</i>`));

    // 8. Tokens rekursiv zurücksetzen
    let guard = 0;
    while (s.includes("\x01TGH") && guard < 10) {
      s = s.replace(/\x01TGH(\d+)\x02/g, (_, idx) => tokens[Number(idx)] || "");
      guard++;
    }
    return s;
  }

  function normalizeToken(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  // Schreibt Begriffe wie "Fantasie" -> "Fantasy", "Komödie" -> "Comedy" automatisch um
  function rewriteQueryWithSynonyms(rawQuery) {
    if (!rawQuery) return { query: "", rewrittenFrom: null, matchedGenre: null };
    const words = String(rawQuery).trim().split(/\s+/);
    let wasRewritten = false;
    let matchedGenreInfo = null;

    const rewrittenWords = words.map(w => {
      const norm = normalizeToken(w);
      const syn = GENRE_SYNONYM_MAP[norm] || GENRE_SYNONYM_MAP[w.toLowerCase()];
      if (syn) {
        if (w.toLowerCase() === "fantasie") {
          wasRewritten = true;
          matchedGenreInfo = syn;
          return "Fantasy";
        }
        if (["komödie", "komoedie", "komodie", "comedie"].includes(w.toLowerCase())) {
          wasRewritten = true;
          matchedGenreInfo = syn;
          return "Comedy";
        }
        if (["scifi", "sciencefiction"].includes(norm)) {
          wasRewritten = true;
          matchedGenreInfo = syn;
          return "Sci-Fi";
        }
        if (["aktion"].includes(norm)) {
          wasRewritten = true;
          matchedGenreInfo = syn;
          return "Action";
        }
        matchedGenreInfo = syn;
      }
      return w;
    });

    const finalQuery = rewrittenWords.join(" ");
    return {
      query: finalQuery,
      rewrittenFrom: wasRewritten && finalQuery.toLowerCase() !== rawQuery.trim().toLowerCase() ? rawQuery.trim() : null,
      matchedGenre: matchedGenreInfo
    };
  }

  function resolveGenreByTerm(rawGenreTerm, explicitType = null) {
    const norm = normalizeToken(rawGenreTerm);
    if (!norm) return null;

    const syn = GENRE_SYNONYM_MAP[norm] || GENRE_SYNONYM_MAP[String(rawGenreTerm).toLowerCase()];
    if (syn) {
      if (explicitType === "m") {
        const id = MOVIE_GENRES[syn.canonicalMovie];
        if (id) return { typeCode: "m", genreId: String(id), genreName: syn.canonicalMovie };
      } else if (explicitType === "s") {
        const id = SERIES_GENRES[syn.canonicalSeries];
        if (id) return { typeCode: "s", genreId: String(id), genreName: syn.canonicalSeries };
      } else {
        const pickMovie = Math.random() < 0.5;
        const gName = pickMovie ? syn.canonicalMovie : syn.canonicalSeries;
        const gId = pickMovie ? MOVIE_GENRES[gName] : SERIES_GENRES[gName];
        if (gId) return { typeCode: pickMovie ? "m" : "s", genreId: String(gId), genreName: gName };
      }
    }

    const matchInMap = (mapObj) => {
      for (const [name, id] of Object.entries(mapObj)) {
        const nName = normalizeToken(name);
        if (nName === norm || nName.includes(norm) || norm.includes(nName)) {
          return { id: String(id), name };
        }
      }
      return null;
    };

    if (explicitType === "m") {
      const m = matchInMap(MOVIE_GENRES);
      return m ? { typeCode: "m", genreId: m.id, genreName: m.name } : null;
    }
    if (explicitType === "s") {
      const s = matchInMap(SERIES_GENRES);
      return s ? { typeCode: "s", genreId: s.id, genreName: s.name } : null;
    }

    const mMatch = matchInMap(MOVIE_GENRES);
    const sMatch = matchInMap(SERIES_GENRES);
    if (mMatch && sMatch) {
      const pickM = Math.random() < 0.5;
      return {
        typeCode: pickM ? "m" : "s",
        genreId: pickM ? mMatch.id : sMatch.id,
        genreName: pickM ? mMatch.name : sMatch.name
      };
    }
    if (mMatch) return { typeCode: "m", genreId: mMatch.id, genreName: mMatch.name };
    if (sMatch) return { typeCode: "s", genreId: sMatch.id, genreName: sMatch.name };
    return null;
  }

  function formatClickableList(rawString) {
    if (!rawString || rawString === "Keine Angabe") return "Keine Angabe";
    return rawString
      .split(",")
      .map(item => {
        const trimmed = item.trim();
        const escaped = escapeMd(trimmed);
        return `[${escaped}](tg://search?query=${safeEncodeParam(trimmed)})`;
      })
      .join(", ");
  }

  function formatGenreLinks(genresList, fallbackStr, botUsername, typeCode, itemId) {
    if (Array.isArray(genresList) && genresList.length > 0) {
      return genresList.slice(0, 3).map(g => {
        if (g.id && g.name) {
          memoryFallback.set(`genre_name_${g.id}`, g.name);
        }
        const escaped = escapeMd(g.name);
        if (botUsername && g.id) {
          return `[${escaped}](https://t.me/${botUsername}?start=gen_${g.id}_${typeCode}_${itemId})`;
        }
        return `[${escaped}](tg://search?query=${safeEncodeParam(g.name)})`;
      }).join(", ");
    }
    return formatClickableList(fallbackStr);
  }

  // Erstellt einen klickbaren Bot-TextLink (versteckt /start automatisch beim Antippen)
  function makeBotLink(botUsername, startPayload, fallbackUrl = "https://www.themoviedb.org/?language=de-DE") {
    if (botUsername) {
      return `https://t.me/${botUsername}?start=${startPayload}`;
    }
    return fallbackUrl;
  }

  // --- Fetch mit Timeout + universeller TMDb v3 (api_key) & v4 (Bearer JWT) Auth-Normalisierung ---
  async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let targetUrl = String(url || "");
      let effectiveOptions = { ...options };
      if (targetUrl.includes("api.themoviedb.org")) {
        trackStat("tmdbCalls");
        const hdrs = { ...(options?.headers || {}) };
        let rawToken = String(hdrs.Authorization || hdrs.authorization || "")
          .replace(/^Bearer\s+/i, "")
          .replace(/^["']+|["']+$/g, "")
          .trim();
        if (!rawToken || rawToken === "undefined" || rawToken === "null") {
          const activeEnv = typeof globalThis !== "undefined" ? globalThis._activeWorkerEnv : null;
          rawToken = String(
            activeEnv?.TMDB_BEARER_TOKEN ||
            activeEnv?.TMDB_API_KEY ||
            activeEnv?.TMDB_KEY ||
            ""
          ).replace(/^Bearer\s+/i, "").replace(/^["']+|["']+$/g, "").trim();
        }
        if (rawToken && /^[a-f0-9]{32}$/i.test(rawToken)) {
          // 32-stelliger TMDb v3 API-Key erkannt -> als ?api_key=... Query-Parameter übergeben und ungültigen Bearer-Header entfernen
          delete hdrs.Authorization;
          delete hdrs.authorization;
          if (!targetUrl.includes("api_key=")) {
            targetUrl += (targetUrl.includes("?") ? "&" : "?") + `api_key=${encodeURIComponent(rawToken)}`;
          }
        } else if (rawToken && rawToken !== "undefined" && rawToken !== "null") {
          hdrs.Authorization = `Bearer ${rawToken}`;
        }
        effectiveOptions.headers = hdrs;
      }
      const res = await fetch(targetUrl, { ...effectiveOptions, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  // Entfernt inkompatible copy_text Buttons (verhindert Abstürze in Clients wie Arel Gram!)
  function sanitizeReplyMarkup(replyMarkup) {
    if (!replyMarkup || !Array.isArray(replyMarkup.inline_keyboard)) return replyMarkup;
    return {
      inline_keyboard: replyMarkup.inline_keyboard.map(row =>
        row.map(btn => {
          if (btn.copy_text) {
            return { text: btn.text, callback_data: "info_copy_fallback" };
          }
          return btn;
        })
      )
    };
  }
