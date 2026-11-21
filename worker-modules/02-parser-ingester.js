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
    "9 1/2 wochen": "9½ Wochen",
    "e.t.": "E.T. – Der Außerirdische",
    "e.t": "E.T. – Der Außerirdische",
    "e t": "E.T. – Der Außerirdische",
    "et": "E.T. – Der Außerirdische",
    "e.t. der ausserirdische": "E.T. – Der Außerirdische",
    "e.t. der außerirdische": "E.T. – Der Außerirdische",
    "et der ausserirdische": "E.T. – Der Außerirdische",
    "et der außerirdische": "E.T. – Der Außerirdische",
    "e.t. - der ausserirdische": "E.T. – Der Außerirdische",
    "e.t. - der außerirdische": "E.T. – Der Außerirdische",
    "e.t. – der außerirdische": "E.T. – Der Außerirdische",
    "e.t. the extra-terrestrial": "E.T. – Der Außerirdische",
    "et the extra terrestrial": "E.T. – Der Außerirdische"
  };

  // .rar / .zip / .7z / .iso / .tar / .gz sowie Split-Archive (.part1.rar, .r00-.r99, .z01-.z99, .7z.001, .zip.001) sind erlaubt und werden als Zusatz-Downloads (type: "archive", isDownloadOnly: true) gespeichert!
  // Untertitel (.srt, .vtt, .sub, .ass, .ssa) werden NICHT als Junk verworfen, sondern automatisch an das zugehörige Video gebunden!
  const SUBTITLE_EXTENSIONS = /\.(?:srt|vtt|sub|ass|ssa)$/i;
  const ARCHIVE_EXTENSIONS  = /\.(?:rar|zip|7z|iso|tar|gz|r\d{2,3}|z\d{2,3}|\b(?:7z|zip|rar|tar)\.0*\d{1,3})$/i;
  const SPLIT_ARCHIVE_PATTERN = /(?:\.part0*\d{1,3}\.(?:rar|zip|7z)|\.(?:7z|zip|rar|tar)\.0*\d{1,3}|\.(?:r\d{2,3}|z\d{2,3}))\b/i;

  function isArchiveFilenameOrText(fileName = "", rawText = "") {
    const fn = String(fileName || "").trim();
    const combined = `${fn} ${rawText || ""}`.trim();
    return ARCHIVE_EXTENSIONS.test(fn) || SPLIT_ARCHIVE_PATTERN.test(fn) || SPLIT_ARCHIVE_PATTERN.test(combined);
  }

  function detectArchiveCodecAndPart(fileName = "", rawText = "") {
    const fn = String(fileName || "").trim();
    const combined = `${fn} ${rawText || ""}`.trim();
    let archCodec = "RAR";
    if (/\.(?:7z|7z\.0*\d{1,3})$/i.test(fn)) archCodec = "7Z";
    else if (/\.(?:zip|zip\.0*\d{1,3}|z\d{2,3})$/i.test(fn)) archCodec = "ZIP";
    else if (/\.iso$/i.test(fn)) archCodec = "ISO";
    else if (/\.(?:tar|gz|tar\.gz|tar\.0*\d{1,3})$/i.test(fn)) archCodec = "TAR";
    else if (/\.(?:rar|r\d{2,3})$/i.test(fn)) archCodec = "RAR";

    // 1. .part01.rar / Part 1
    const partMatch = combined.match(/(?:\.part|\bpart)[\s._-]*0*([1-9]\d{0,2})\b/i);
    if (partMatch) {
      const pNum = parseInt(partMatch[1], 10);
      return { codec: archCodec, isSplit: true, partNumber: pNum, partLabel: `${archCodec}-PART${pNum}` };
    }
    // 2. .7z.001 / .zip.002 / .rar.001
    const dotNumMatch = fn.match(/\.(?:7z|zip|rar|tar)\.0*([1-9]\d{0,2})$/i);
    if (dotNumMatch) {
      const pNum = parseInt(dotNumMatch[1], 10);
      return { codec: archCodec, isSplit: true, partNumber: pNum, partLabel: `${archCodec}-PART${pNum}` };
    }
    // 3. .r00, .r01 .. .r99 (r00 = Part 1 oder Teil nach .rar, wir nummerieren r00 -> 1, r01 -> 2 bzw. Label R00/R01)
    const rSplitMatch = fn.match(/\.r(\d{2,3})$/i);
    if (rSplitMatch) {
      const rawNum = parseInt(rSplitMatch[1], 10);
      const pNum = rawNum + 1;
      return { codec: "RAR", isSplit: true, partNumber: pNum, partLabel: `RAR-PART${pNum} (.r${rSplitMatch[1]})` };
    }
    // 4. .z01, .z02 .. .z99
    const zSplitMatch = fn.match(/\.z0*([1-9]\d{0,2})$/i);
    if (zSplitMatch) {
      const pNum = parseInt(zSplitMatch[1], 10);
      return { codec: "ZIP", isSplit: true, partNumber: pNum, partLabel: `ZIP-PART${pNum}` };
    }
    return { codec: archCodec, isSplit: false, partNumber: 1, partLabel: archCodec };
  }
  const BLOCKED_EXTENSIONS  = /\.(webp|tgs|webm|gif|mp3|ogg|wav|flac|m4a|idx|apk|exe|msi|dmg|pdf|epub|txt|nfo|jpg|jpeg|png)$/i;
  const BLOCKED_FILENAMES   = /^(?:sticker|animatedsticker|giphy|tenor|video_?\d*)\.(?:webp|tgs|webm|mp4|gif)$/i;
  const TRAILER_KEYWORD_REGEX = /(?:^|[\s._\-(\[])(?:kinotrailer|official\s+trailer|offizieller\s+trailer|teaser\s+trailer|trailer\s+(?:german|deutsch|englisch|english|hd|full\s*hd|1080p|720p|4k)|trailer|teaser|coming\s+soon|zwiastun|vorschau)(?=$|[\s._\-)\]:])/i;
  const LANGUAGE_COURSE_JUNK_REGEX = /(?:amoozesh|learn_german|sprachkurs|vokabeln|tutorial)/i;

  function extractRawMessageText(msg) {
    if (!msg || typeof msg !== "object") return "";
    if (typeof flattenTelegramExportText === "function") {
      const flat = flattenTelegramExportText(msg.caption ?? msg.text ?? msg.text_entities);
      if (flat) return String(flat).trim();
    }
    const raw = msg.caption ?? msg.text ?? msg.text_entities ?? "";
    if (typeof raw === "string") return raw.trim();
    if (Array.isArray(raw)) {
      return raw.map(part => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return String(part.text || "");
        return "";
      }).join("").trim();
    }
    return "";
  }

  function isLanguageCourseOrTutorialJunk(msg) {
    if (!msg || typeof msg !== "object") return false;
    const rawPath = String(msg.file || "").trim();
    const validPath = rawPath && !rawPath.startsWith("(File not included") ? rawPath.split("/").pop() : "";
    const fileName = String(msg.video?.file_name || msg.document?.file_name || msg.file_name || validPath || "").trim();
    const rawText = extractRawMessageText(msg);
    return LANGUAGE_COURSE_JUNK_REGEX.test(fileName) || LANGUAGE_COURSE_JUNK_REGEX.test(rawText);
  }

  function extractSubtitleAttachmentFromMsg(msg, chatMeta = {}) {
    if (!msg || typeof msg !== "object") return null;
    const rawPath = String(msg.file || "").trim();
    const validPath = rawPath && !rawPath.startsWith("(File not included") ? rawPath.split("/").pop() : "";
    const fileName = String(msg.document?.file_name || msg.file_name || validPath || "").trim();
    if (!fileName || !SUBTITLE_EXTENSIONS.test(fileName)) return null;
    const msgId = Number(msg.id || msg.message_id || 0) || null;
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
    const isRarArchive  = isArchiveFilenameOrText(fileName, extractRawMessageText(msg));
    const isSubtitleFile = SUBTITLE_EXTENSIONS.test(fileName);

    // 0. Sprachlern-Videos & Tutorials direkt im Gatekeeper als Junk herausfiltern (MODUL 1.4)
    if (isLanguageCourseOrTutorialJunk(msg)) {
      return true;
    }

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
    const rawCaptionPreview = extractRawMessageText(msg).slice(0, 220);
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

    // 5. Reine Chat-Kommentare / Lacher ohne Datei und ohne Foto-Poster (z.B. "Hahahahah Bruder") als Junk verwerfen
    const isVideoOrDoc = Boolean(msg.video || msg.document || mediaType === "video_file" || fileName);
    if (!isVideoOrDoc && !isPhotoHeader && rawCaptionPreview) {
      const cleanPreview = rawCaptionPreview.trim();
      if (cleanPreview.length <= 60 && /(?:^|\b)(?:hahaha+|hihi+|lol+|rofl|haha+\s+bruder|bruder\b|danke\s+dir|vielen\s+dank)(?:\b|$)/i.test(cleanPreview)) {
        return true;
      }
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
        // 1b. Reine Metadaten-Zeilen ("Size: 295 MB", "Erstausstrahlung: April 2025", "Studio:", "Gener:", "+18", "Ab 16 Jahren") niemals als Filmtitel werten!
        if (/^(?:size|größe|groesse|dateigröße|qualität|qualitaet|quality|format|codec|audio|dauer|laufzeit|runtime|länge|laenge|sprache|language|untertitel|subtitles|genre|gener|fsk|studio|director|regie|darsteller|actors|cast|released|release|erstausstrahlung|ausstrahlung|premiere|kinostart|tv-start|starttermin|start|erscheinungsjahr|produktionsjahr|produktionsland|handlungsjahr|imdb|tmdb|rating|bewertung|quelle|source|kanal|channel|preis|free|kostenlos|uncensored)\s*[:=-]/i.test(l)) {
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

  function extractPartInfo(rawText = "", rawFileName = "", isSeriesHint = false) {
    const fnStr = String(rawFileName || "").trim();
    const combined = `${fnStr} ${rawText || ""}`;
    const isArchive = isArchiveFilenameOrText(fnStr, rawText);

    // MODUL 2: Mehrteilige oder einzelne Archive (.rar/.zip/.7z/.iso/.tar/.gz/.part1.rar/.r00/.z01/.7z.001) als Download-Dateien (type: "archive", isDownloadOnly: true)
    if (isArchive) {
      const archMeta = detectArchiveCodecAndPart(fnStr, rawText);
      return {
        isSplit: archMeta.isSplit,
        isArchive: true,
        isDownloadOnly: true,
        type: "archive",
        isExplicitMultiPartMovie: false,
        part: archMeta.partNumber,
        partNumber: archMeta.partNumber,
        partType: archMeta.codec,
        partLabel: archMeta.partLabel
      };
    }

    // MODUL 5.1: Bei Serien ist part_number IMMER 1!
    if (isSeriesHint) {
      return { isSplit: false, isArchive: false, isDownloadOnly: false, type: "video", isExplicitMultiPartMovie: false, part: 1, partNumber: 1, partType: null, partLabel: null };
    }

    // 1. Explizite CD/Disc/Disk/Split Marker MIT Ziffer 1..4 (MODUL 5.1):
    // WICHTIG: Niemals bei Scene-Präfixen ohne Zahl wie "cd-salazarsrache.mp4" auslösen!
    const explicitCdMatch = combined.match(/\b(cd|disc|disk|dvd|split)[\s._-]*0*([1-4])\b(?![\s._-]*(?:bis|-|–)\s*\d)/i)
                         || combined.match(/AC3\.?(cd)0*([1-4])\b/i);
    if (explicitCdMatch) {
      const pNum = parseInt(explicitCdMatch[2], 10);
      return { isSplit: true, isArchive: false, isDownloadOnly: false, type: "video", isExplicitMultiPartMovie: true, part: pNum, partNumber: pNum, partType: "CD", partLabel: `CD ${pNum}` };
    }

    // 2. 3-stelliger Split-Suffix am Ende: -(00[1-4]).(mkv|mp4|avi) ("Berlin Alexanderplatz (2020)-003.mkv")
    const splitNumMatch = fnStr.match(/-(00[1-4])(?:\.(?:mp4|mkv|avi|m4v|mk3d|flv|ts|mov|wmv))+$/i);
    if (splitNumMatch) {
      const pNum = parseInt(splitNumMatch[1], 10);
      return { isSplit: true, isArchive: false, isDownloadOnly: false, type: "video", isExplicitMultiPartMovie: true, part: pNum, partNumber: pNum, partType: "CD", partLabel: `CD ${pNum}` };
    }

    // 3. Impliziter Mehrteiler direkt vor Jahresklammer: "01 (1997)" / "02 (1997)" ("The Postman 01 (1997)")
    const implicitZeroBeforeYear = combined.match(/\b0([1-4])[\s._-]*[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\b\s+)?(?:19[2-9]\d|20[0-2]\d)\s*[\)\]]/i);
    if (implicitZeroBeforeYear) {
      const pNum = parseInt(implicitZeroBeforeYear[1], 10);
      return { isSplit: true, isArchive: false, isDownloadOnly: false, type: "video", isExplicitMultiPartMovie: true, part: pNum, partNumber: pNum, partType: "CD", partLabel: `CD ${pNum}` };
    }

    // 4. MODUL 5.1 ("Teil 2" vs. "-CD2"):
    // Steht "Part [1-4]" / "Teil [1-4]" / "Film [1-4]" NACH der Jahreszahl ("Hogfather - 2006 - Part 2.mp4"), ist es ein Datei-Split (part_number = 1..4)!
    // Steht "Teil 2" VOR der Jahreszahl ("Mockingjay Teil 2 (2015)"), gehört es zum Filmtitel (part_number bleibt 1)!
    const partAfterYearMatch = combined.match(/\b(?:19[2-9]\d|20[0-2]\d)\b[\)\]]?[\s._\-–—:]+(?:part|teil|pt|film)[\s._-]*0*([1-4])\b(?![\s._-]*(?:bis|-|–)\s*\d)/i);
    if (partAfterYearMatch) {
      const pNum = parseInt(partAfterYearMatch[1], 10);
      return { isSplit: true, isArchive: false, isDownloadOnly: false, type: "video", isExplicitMultiPartMovie: true, part: pNum, partNumber: pNum, partType: "CD", partLabel: `CD ${pNum}` };
    }

    return { isSplit: false, isArchive: false, isDownloadOnly: false, type: "video", isExplicitMultiPartMovie: false, part: 1, partNumber: 1, partType: null, partLabel: null };
  }

  const BONUS_SPECIAL_REGEX = /\b(bonus|special(?!\s*edition|\s*cut)|making[\s._-]*of|outtakes|extras|behind[\s._-]*the[\s._-]*scenes)\b/i;

  const EDITION_RULES = [
    { label: "Director's Cut",      regex: /\b(?:director'?s?[\s._-]*cut|director’s[\s._-]*cut|dc)\b/gi },
    { label: "Extended Cut",        regex: /\b(?:extended[\s._-]*(?:cut|version|edition|fassung)|langfassung)\b/gi },
    { label: "Collector's Edition", regex: /\b(?:collector'?s?[\s._-]*(?:edition|cut)|collector’s[\s._-]*(?:edition|cut))\b/gi },
    { label: "Special Edition",     regex: /\b(?:special[\s._-]*(?:edition|cut|version))\b/gi },
    { label: "Ultimate Edition",    regex: /\b(?:ultimate[\s._-]*(?:hunter[\s._-]*)?(?:edition|cut|version))\b/gi },
    { label: "Final Cut",           regex: /\b(?:final[\s._-]*cut)\b/gi },
    { label: "Kinofassung",         regex: /\b(?:theatrical(?:[\s._-]*cut|[\s._-]*version)?|kinofassung)\b/gi },
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
    const editionsList = Array.from(editions);
    return {
      cleaned,
      editions: editionsList,
      editionLabel: editionsList[0] || null
    };
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

  // Erweiterter Cleaner-Regex mit Umlaut-sicheren Wortgrenzen (schützt "Geisterjäger", "Jäger", "Bürger", "Body Cam", "Pines", "Fences", "World Wide Web" & "Grundkurs Spanish"):
  const TECH_JUNK_REGEX = /(?<![A-Za-zÄÖÜäöüß0-9])(1080p|720p|2160p|480p|4k|uhd|h265|h264|x264|x265|264|265|hevc|av1|xvid(?:-[a-z0-9]{2,12})?|divx|10bit|de-en|en-de|de-fr|fr-de|de-es|es-de|de-it|it-de|de-tr|tr-de|de-ru|ru-de|de-ja|de-jp|german|deutsch|germany|deu|ger|englisch|english|eng|französisch|franzoesisch|french|fra|fre|vff|vf|(?<!grundkurs\s+)(?:spanisch|spanish)|spa|esp|castellano|latino|italienisch|italian|ita|türkisch|tuerkisch|turkish|tur|russisch|russian|rus|japanisch|japanese|jap|jpn|koreanisch|korean|kor|dl|dual[\s._-]*audio|dual|multi|multilang|(?<!world\s+wide\s+)web|web-dl|webrip|webr|bluray|bdrip|brrip|dvdrip|dvdscr|hdrip|remux|fullhd|fhd|microhd(?:\s*720|\s*1080)?|hd|sd|dt__ov|dt[\s._-]*ov|ov|omu|omeu|oton|originalton|gerdub|engdub|japdub|dubbed|gersub|engsub|softsub|hardsub|subbed|forced|germanforced|extended[\s._-]*cut|extendet[\s._-]*cut|extendet|director'?s?[\s._-]*cut|theatrical[\s._-]*cut|ultimate[\s._-]*cut|final[\s._-]*cut|special[\s._-]*(?:cut|edition)|collector'?s?[\s._-]*edition|extended[\s._-]*(?:edition|version)|uncut[\s._-]*(?:edition|version)?|unrated[\s._-]*(?:cut|edition|version)?|farbfassung|langfassung|kinofassung|fernsehfassung|schnittfassung|remastered|restored|uncut|unrated|extended|recut|ac3md|ac3d|ac3|eac3|dts|dd5\.?1|5\.1|7\.1|aac|6ch|proper|repack|limited|doku|camrip|cam-rip|hdcam|hd-cam|ts-cam|mp4|mkv|avi|m4v|flv|mk3d|rar|zip|7z|iso|archemovie|gutfilm|filmwelt|weltderfilme|sauerkraut|wayne|wvf|dollhead|empir|tvnation|contribution|vivo|watch)(?![A-Za-zÄÖÜäöüß0-9])/gi;

  // Volle Datumsangaben (DD.MM.YYYY wie 21.07.2012 oder 01.12.2018) erkennen & schützen (Regel 6 / Fall 17)
  const FULL_DATE_REGEX = /\b\d{1,2}\.\d{1,2}\.(?:19\d{2}|20\d{2}|\d{2})\b/g;

  // Ignoriert Jahreszahlen, denen direkt ein Tag.Monat. (z.B. 21.07.2012) vorausgeht, und erkennt Länder-Präfixe wie (DDR 1976), (BRD 1980), (USA 2005)
  const YEAR_REGEX = /(?<!\d{1,2}[./-]\d{1,2}[./-])(?:[(\[\-\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(18\d{2}|19\d{2}|20[0-3]\d)(?![./-]\d|\d)(?:[)\]\s._\-·‧]|$)/i;

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

  function enforceRomanNumeralColon(rawTitle) {
    if (!rawTitle) return "";
    return String(rawTitle).replace(/\b(I{1,3}|IV|V|VI{1,3}|IX|X)\s+([A-ZÄÖÜ])/g, "$1: $2");
  }

  function cleanMovieQuery(rawTitle) {
    if (!rawTitle) return "";
    // Zuerst Doppelpunkt nach römischen Zahlen erzwingen ("Star Trek II Der Zorn" -> "Star Trek II: Der Zorn")
    const withRomanColon = enforceRomanNumeralColon(String(rawTitle));
    let s = ` ${withRomanColon.toLowerCase()} `;

    // 1. Römische Zahlen in arabische Ziffern umwandeln (z.B. "viii" -> "8") als Alternativ-Query
    for (const [roman, arabic] of Object.entries(ROMAN_NUMERALS)) {
      s = s.replace(new RegExp(roman, "g"), arabic);
    }
    s = s.trim();

    // 2. Bindestriche und Doppelpunkte vereinheitlichen
    s = s.replace(/[-–—]/g, ":");

    return s
      .replace(/\s+/g, " ")
      .trim();
  }

  // Regel 1: Vorab-Normalisierung aller Episoden-Schreibweisen & Leerzeichen-Reduzierung in normalizeText()
  function normalizeText(str) {
    if (!str) return "";
    // MODUL 4.1: Zwingend .normalize("NFC") ganz am Anfang ausführen (wandelt u\u0308 -> ü für "Ein Rezept für die Liebe" um!)
    let s = String(str)
      .normalize("NFC")
      .replace(/%26/gi, "&")
      .replace(/%20/g, " ");

    for (let i = 0; i < 10; i++) {
      s = s.replace(PERSIAN_DIGITS[i], String(i)).replace(ARABIC_DIGITS[i], String(i));
    }

    // Hochgestellte Qualitäts-Tags wie "ᴴᴰ" (\u1D34\u1D30) oder "⁴ᴷ" vor NFKD in " HD " / " 4K " umwandeln
    s = s.replace(/\u1D34\u1D30/g, " HD ").replace(/\u2074\u1D37/g, " 4K ");

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

  // MODUL 4.1: Globale Umlaut-Normalisierung mit /g für alle Wörter im String ("Vier Faeuste fuer ein Halleluja" -> "Vier Fäuste für ein Halleluja")
  const NON_UMLAUT_AE_OE_UE_WORDS = /^(?:abenteuer\w*|feuer\w*|steuer\w*|ungeheuer\w*|teuer\w*|heute|leute\w*|freund\w*|neu(?:e|en|er|es|em)?|treu(?:e|en|er|es)?|reu(?:e|en)?|blau(?:e|en|er|es)?|mauer\w*|trauer\w*|dauer\w*|schau(?:en|er)?|bau(?:en|er|ern)?|vertrau(?:en|er)?|frau(?:en)?|grau(?:en|er|es)?|klau(?:en)?|brau(?:en|er)?|au(?:e|en)|duell\w*|aktuell\w*|virtuell\w*|manuell\w*|eventuell\w*|visuell\w*|sexuell\w*|rituell\w*|individuell\w*|intellektuell\w*|spirituell\w*|statue\w*|michael\w*|raphael\w*|israel\w*|maelstrom|aero\w*|poesie|poet\w*|noel|joel|coen|boeing|phoenix|goethe\w*|soest|true|blue\w*|clue\w*|due|sue|avenue\w*|rescue\w*|value\w*|issue\w*|rogue\w*|vogue|league\w*|colleague\w*|dialogue\w*|prologue\w*|epilogue\w*|catalogue\w*|fatigue|intrigue\w*|plague\w*|vague\w*|morgue|tongue\w*|queue\w*|fuel\w*|cruel\w*|duel\w*|jewel\w*|sequel\w*|prequel\w*|queen\w*|queer\w*|quest\w*|guest\w*|guess\w*|guard\w*|guarantee\w*|guilt\w*|guitar\w*|guide\w*|guise|guillotine)$/i;

  function normalizeGermanAsciiUmlauts(str) {
    if (!str) return "";
    return String(str).replace(/\b([A-Za-zÄÖÜäöüß]+)\b/g, (word) => {
      if (!/(?:ae|oe|ue)/i.test(word)) return word;
      if (NON_UMLAUT_AE_OE_UE_WORDS.test(word)) return word;
      // Schütze "qu" (wie Quelle, quer) vor qü
      return word
        .replace(/ae/g, "ä")
        .replace(/oe/g, "ö")
        .replace(/(?<![qQ])ue/g, "ü")
        .replace(/Ae/g, "Ä")
        .replace(/Oe/g, "Ö")
        .replace(/Ue/g, "Ü")
        .replace(/AE/g, "Ä")
        .replace(/OE/g, "Ö")
        .replace(/(?<![qQ])UE/g, "Ü");
    });
  }

  const OFFICIAL_HYPHEN_TITLE_WHITELIST = /^(?:x-men|a-team|k-pax|g-force|u-571|k-19|t-rex|v-wars|wall-e|spider-man|ant-man|kick-ass|non-stop|hi-hi)\b/i;

  function stripSceneGroupPrefix(str) {
    if (!str) return "";
    const trimmed = String(str).trim();
    if (/^[a-z]{2,6}-[a-z0-9._-]+/.test(trimmed) && !OFFICIAL_HYPHEN_TITLE_WHITELIST.test(trimmed)) {
      return trimmed.replace(/^[a-z]{2,6}-/, "");
    }
    return trimmed;
  }

  function splitParenthesizedAltTitle(str) {
    if (!str) return { primaryTitle: "", altTitle: null };
    const m = String(str).trim().match(/^(.{2,}?)\s*\(([A-Za-zÄÖÜäöüß][^()]{3,80})\)\s*$/);
    if (!m) return { primaryTitle: String(str).trim(), altTitle: null };
    const primary = m[1].trim();
    const inside = m[2].trim();
    // Nicht trennen bei Jahreszahlen, Ländern, Editionen oder technischen Tags
    if (/^(?:19\d{2}|20\d{2}|DDR|BRD|USA|UK|DE|FR|IT|ES|AT|CH|OV|OmU|Uncut|Unrated|Extended|Director|Theatrical|Kinofassung|Langfassung|Cut|Edition|Version|Fassung|3D|4K|HD|UHD|IMAX|Teil\s*\d+|Part\s*\d+)\b/i.test(inside)) {
      return { primaryTitle: String(str).trim(), altTitle: null };
    }
    return { primaryTitle: primary, altTitle: inside };
  }

  // MODUL 5.3: Harter Cut-Off nach der Jahreszahl (auch ohne Leerzeichen wie "2012SiFi", "1998Action", "2002 Patrick Stewart 465 MB")
  const HARD_YEAR_CUTOFF_REGEX = /^(.*?)(?:[\s._\-(\[]+)(19[2-9]\d|20[0-2]\d)(?=[\s._\-)\]]|(?:SiFi|SciFi|Sci-Fi|Action|Comedy|Komödie|Komoedie|Drama|Crime|Krimi|Thriller|Horror|Abenteuer|Adventure|Krieg|Geschichte|History|Fantasy|Animation|Familie|Romantik|Romance|Mystery|Western|Musik|Doku|Dokumentation|HD|FullHD|FHD|UHD|4K|1080p|720p|480p|German|Deutsch|DE|EN|AC3|AC3MD|DTS|x264|x265|XviD|DivX|mp4|mkv|avi|rar|zip|$))/i;

  function applyHardYearCutoff(rawString) {
    if (!rawString) return { titleBeforeYear: "", year: null, hadYearCutoff: false };
    // Entferne alleinstehendes " von" direkt vor einer Jahreszahl ("Die Studentin von 1988" -> "Die Studentin 1988")
    const s = String(rawString)
      .replace(FULL_DATE_REGEX, " ")
      .replace(/\s+von(?=\s+(?:19[2-9]\d|20[0-2]\d)\b)/gi, " ");
    // 1. Prüfe zuerst auf eingeklammerte Jahreszahl mit zwingender öffnender Klammer [(\[] und \b Wortgrenzen (schützt "The Place Beyond the Pines (2012)"!)
    const parenMatch = s.match(/^(.*?)\s*[\(\[]\s*(?:\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\b\s+)?(19[2-9]\d|20[0-2]\d)(?:\s*[-–—/bis]+\s*(?:19[2-9]\d|20[0-2]\d|heute|present)?)?\s*[\)\]](.*)$/i);
    if (parenMatch && parenMatch[1] && parenMatch[1].trim().length >= 2) {
      return {
        titleBeforeYear: parenMatch[1].trim(),
        year: parseInt(parenMatch[2], 10),
        hadYearCutoff: true
      };
    }
    const yearCutMatch = s.match(HARD_YEAR_CUTOFF_REGEX);
    if (yearCutMatch && yearCutMatch[1] && yearCutMatch[1].trim().length >= 2) {
      return {
        titleBeforeYear: yearCutMatch[1].trim(),
        year: parseInt(yearCutMatch[2], 10),
        hadYearCutoff: true
      };
    }
    return { titleBeforeYear: s, year: null, hadYearCutoff: false };
  }

  // MODUL 5.3: Erkennt überlange Beschreibungstexte ("Cocaine Bear"-Schutz) anhand von Wortanzahl (> 15 Wörter) oder > 120 Zeichen statt 40-Zeichen-Abschnitt!
  function isLikelyPlotDescription(str) {
    const s = String(str || "").trim();
    if (!s) return false;
    if (s.length > 120) return true;
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 15) return true;
    if (/[.!?]\s+[A-ZÄÖÜ]/.test(s) && words.length > 9) return true;
    return false;
  }

  function cleanMediaTitle(raw) {
    if (!raw) return "";
    // MODUL 4.1, 4.2 & 4.4: Zuerst NFC + Kanal-Präfixe (@German_Vid, @ GERMAN MOVIES_) + Scene-Group-Kürzel (cyd-, cd-, nge-, inkl-) VOR der _-Umwandlung entfernen!
    let preCleaned = String(raw).normalize("NFC").trim();
    preCleaned = preCleaned
      .replace(/^@\s*(?:german[\s._-]*(?:movies?|vid(?:eo)?s?|filme?|cinema|kinofilme?)|[\w.-]+)[\s_:\-]*/gi, "")
      .replace(/^@\s*movies\b[\s_:\-]*/gi, "")
      .replace(/\b(?:german[\s._-]+(?:movies?|vid(?:eo)?s?|filme?)|@[\w.-]+)\b/gi, " ");
    preCleaned = stripSceneGroupPrefix(preCleaned);

    // Echte Zweiteiler-Kinofilme ("Twilight Saga (4.1) - Breaking Dawn..." / "Twilight_Saga_01..03"):
    if (/twilight[\s._-]*saga/i.test(preCleaned)) {
      const twPartMatch = preCleaned.match(/\b4\.?([12])\b/);
      preCleaned = preCleaned.replace(/^(?:the[\s._-]+)?twilight[\s._-]*saga[\s._()-]*(?:0?[1-3]|4\.?[12]|complete)?[\s._\-:)]*/i, "");
      if (twPartMatch && !/teil\s*[12]/i.test(preCleaned)) {
        preCleaned = `${preCleaned} - Teil ${twPartMatch[1]}`;
      }
    }

    let s = normalizeText(preCleaned);

    // Mehrfache Dateiendungen (wie .mkv.mp4, .part1.rar, .7z.001, .r00-.r99, .z01, .rar, .zip, .7z, .iso) sowie .flv, .mk3d und .DOKU entfernen
    s = s.replace(/(?:\.part0*\d{1,3})?(?:\.(?:7z|zip|rar|tar)\.0*\d{1,3}|\.(?:mp4|mkv|avi|m4v|ts|mov|wmv|flv|mk3d|webm|rar|zip|7z|iso|tar|gz|r\d{2,3}|z\d{2,3}|json))+$/i, "")
         .replace(/\.doku\b/gi, " ")
         .replace(/󠄿/g, "")
         .replace(/_/g, " ");
    // Volle Datumsangaben wie (21.07.2012) oder 01.12.2018 sofort entfernen
    s = s.replace(/\(\s*\d{1,2}\.\d{1,2}\.(?:19\d{2}|20\d{2}|\d{2})\s*\)/g, " ");
    s = s.replace(FULL_DATE_REGEX, " ");

    // MODUL 5.1: Führende 01/02/03/04 direkt vor einer Jahresklammer (z.B. "The Postman 01 (1997)") vor dem Jahres-Cut-Off entfernen
    s = s.replace(/\b0[1-4](?=\s*[\(\[]\s*(?:\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\b\s+)?(?:19[2-9]\d|20[0-2]\d)\s*[\)\]])/gi, " ");

    // MODUL 5.3: Harter Cut-Off nach der Jahreszahl (schneidet alles rechts neben (YYYY) ab, lässt aber "Teil 2" VOR (2015) unberührt!)
    const yearCutoffRes = applyHardYearCutoff(s);
    if (yearCutoffRes.hadYearCutoff && yearCutoffRes.titleBeforeYear) {
      s = yearCutoffRes.titleBeforeYear;
    }

    // Jahres-Spannen wie "(2003 - 2006)" sowie einzelne Jahresklammern restlos entfernen
    s = s.replace(/[\(\[]?\s*(?:\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\b\s+)?(?:19[2-9]\d|20[0-2]\d)\s*[-–—/bis]+\s*(?:19[2-9]\d|20[0-2]\d|heute|present)\s*[\)\]]?/gi, " ");
    s = s.replace(/[\(\[]\s*(?:\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\b\s+)?(?:19[2-9]\d|20[0-2]\d)\s*[-–—]?\s*[\)\]]/gi, " ");

    // Scene-Audio & Release-Group-Kombinationen (z. B. "AC3D.5.1", "BDRiP.XViD-HaN") vor dem Punkt-Splitter bereinigen
    s = s.replace(/\b(?:AC3MD|AC3D?|EAC3|AAC|DTS|DDP?)[\s._-]*(?:5\.1|7\.1|2\.0)?\b/gi, " ");
    s = s.replace(/\b(?:XViD|DivX|x264|x265|H\.?264|H\.?265|HEVC|BDRiP|BRRiP|DVDRiP|WEBRiP|WEBR|WEB-DL)-[A-Za-z0-9]{2,12}\b/gi, " ");
    if (((s.match(/\./g) || []).length >= 2 || /[A-Za-zÄÖÜäöüß]{2,}\.[A-Za-zÄÖÜäöüß0-9]{2,}/.test(s)) && !/^(?:e\.t\.?|a\.d\.?|o\.c\.?|l\.a\.?|k\.o\.?|s\.h\.i\.e\.l\.d\.?)$/i.test(s.trim())) {
      s = s.replace(/(?<=[A-Za-zÄÖÜäöüß0-9]{2})\.(?=[A-Za-zÄÖÜäöüß0-9])/g, " ")
           .replace(/(?<=[A-Za-zÄÖÜäöüß0-9])\.(?=[A-Za-zÄÖÜäöüß0-9]{2})/g, " ");
    }

    // Flaggen, Deko-Klammern 《》«»⟨⟩, führende Deko-Emojis & Inline-Emojis restlos entfernen
    s = s.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "");
    s = s.replace(/[《》«»⟨⟩]/g, " ");
    s = s.replace(/^[🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎➡️▶️🍿⭐️❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️\s]+/gu, "");
    s = s.replace(/[↩️🔠🔢⤴️⬅️➡️🎦]+.*$/gu, "");
    s = s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎🩸❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️]/gu, " ");

    // @Mentions und bekannte Kanal-/Qualitäts-Hashtags entfernen
    s = s.replace(/@[A-Za-z0-9_.-]+/g, "");
    s = s.replace(/#(?:gutfilm|archemovie|filmwelt|weltderfilme|sauerkraut|hd|fullhd|fhd|uhd|4k|1080p|720p|480p|deutsch|german|kino|serie|serien|film|filme|neu|new|stream|download|vip|ov|omu|horror|action|comedy|thriller|drama|scifi|sifi|fantasy|anime)\b/gi, " ");
    s = s.replace(/#(?=[A-Za-zÄÖÜäöüß0-9])/g, " ");
    s = s.replace(/s[\._]to\s*-?\s*Serien.*/i, "").replace(/Sto\s*-\s*Serien.*/i, "");
    s = s.replace(/serien[\._](?:life|show).*/i, "").replace(/HD\s*Filme\s*Serien.*/i, "");
    s = s.replace(/^(?:Title|Titel)\s*:\s*/i, "").replace(/^(?:vs-|cd-|spy-|d-|4sf-|arc-|tvp-)/i, "");
    // Studio-Präfixe am Anfang entfernen
    s = s.replace(/^(?:disney'?s|disneys|marvel'?s|marvels|pixar'?s|pixars)\s+/i, "");
    // Führende S01E01 / E01S01 / 1x01 Präfixe sowie defekte S05E0Fragmente entfernen
    s = s.replace(/^(?:s\d{1,2}\s*e\d{1,3}(?:-e\d{1,3})?|e\d{1,3}\s*s\d{1,2}|\d{1,2}x\d{2,3})\b[\s._\-–:]*/i, "");
    s = s.replace(/\bS\d{1,2}\s*E\d{0,3}(?:-E\d{1,3})?(?=[A-Za-z]|\b)/gi, " ");
    s = s.replace(/\b\d{3,4}\s*[x×]\s*\d{3,4}\b/g, "");

    // Getrennte Sub/Dub-Kombinationen & echte CD/Disc/Split-Marker VOR den Einzelwörtern löschen.
    // WICHTIG (MODUL 5.1): Wenn "Teil 2" oder "Part 2" VOR der Jahreszahl stand (yearCutoffRes.hadYearCutoff === true, wie "Mockingjay Teil 2 (2015)"),
    // darf "Teil 2" / "Part 2" NIEMALS gelöscht werden!
    s = s.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:ger|deu|de|eng|en|jap|jpn)(?:[\s._-]+(?:ger|deu|de|eng|en|jap|jpn))?[\s._-]+(?:sub|subs|subbed|dub|dubbed)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
    s = s.replace(/AC3\.?CD0*[1-9]/gi, " ");
    s = s.replace(/(?:^|[\s._\-(])(?:cd|disc|disk|dvd|split)[\s._-]*0*([1-9]\d?)(?:$|[\s._\-)])/gi, " ");
    if (!yearCutoffRes.hadYearCutoff) {
      s = s.replace(/(?:^|[\s._\-(])(?:part|pt)[\s._-]*0*([1-9]\d?)(?:$|[\s._\-)])/gi, " ");
    }
    // Nur echte Split-Archiv-Endungen (.001 bis .004 am Ende) entfernen, NIEMALS "007" in "James Bond 007"!
    s = s.replace(/(?:[-_.]|\s)00[1-4]\s*$/gi, " ");

    // MODUL 5.2: Editionen (Extended Cut, Director's Cut, Collector's Edition, DC etc.) & Tech-Junk entfernen
    s = extractAndStripEditions(s).cleaned;
    s = s.replace(EDITION_CUT_REGEX, " ");
    s = s.replace(TECH_JUNK_REGEX, " ");
    s = s.replace(/[\(\[]\s*(?:the\s+)?(?:cut|dc|edition|version|fassung)\s*[\)\]]/gi, " ");
    s = s.replace(/^(.{2,}?)\s+(?:[-–:]\s*)?(?:the\s+)?(?:cut|dc|edition|version|fassung|redux)\s*$/i, "$1");
    s = s.replace(/\s*[-–:]\s*(?:the|der|die|das)\s*$/i, "");
    // MODUL 4.3: Strenge Wortgrenzen \b bei Sprachkürzeln (nur in Klammern oder am Wortende mit Trennzeichen, niemals Endungen von "Pines" oder "Fences" abschneiden!)
    s = s.replace(/[\(\[]\s*\b(?:DE|De|de|EN|en|FR|fr|ES|es|IT|it|TR|RU|JA|KO|DDR|BRD|GER|ITA)\b\s*[\)\]]/g, " ");
    s = s.replace(/(?:[-_]\s*|\s+)\b(?:DE|De|EN|FR|ES|IT|TR|RU|JA|KO|DDR|BRD|GER|ITA)\b(?=\s*$)/g, " ");

    // Nur echte Katalognummern mit Punkt ("3559. ", "01. ") oder Null-Präfix mit Bindestrich ("01 - ") am Anfang entfernen
    s = s.replace(/^(?:\d{1,4}\.\s+|0\d\s*[-–]\s+)/, "").replace(/-\d{3}$/, "");
    // Leere oder nur aus Bindestrichen/Satzzeichen bestehende Klammern wie "( - )" restlos entfernen
    s = s.replace(/[\(\[]\s*[-–—/:.,;]*\s*[\)\]]/g, " ");
    s = s.replace(/\s+/g, " ").replace(/^[\s\-–·‧:.,#"=|⎪&]+|[\s\-–·‧:.,#"=|⎪&]+$/g, "");

    // MODUL 4.1: Globale Umlaut-Normalisierung ("Vier Faeuste fuer ein Halleluja" -> "Vier Fäuste für ein Halleluja")
    s = normalizeGermanAsciiUmlauts(s);

    // Unmittelbar verdoppelte Titelwörter bereinigen (z. B. "Sliders S05E0Sliders" -> "Sliders")
    s = s.replace(/\b([A-Za-zÄÖÜäöüß]{3,})\s+\1\b/gi, "$1");

    // Unbalancierte Klammern bereinigen
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
        const firstWithoutRanges = firstLine
          .replace(/[\(\[]?\s*(?:19[2-9]\d|20[0-2]\d)\s*[-–—/bis]+\s*(?:19[2-9]\d|20[0-2]\d|heute|present)\s*[\)\]]?/gi, " ")
          .replace(/Staffel\s*\d+.*/i, "")
          .replace(/\bS\d{1,2}E\d{1,3}\b.*/i, "")
          .replace(YEAR_REGEX, " ");
        const headerClean = cleanMediaTitle(firstWithoutRanges);
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
        // oder "(USA 2023) HD 264" nach Titel + Jahreszahl suchen, SOWIE jahreslose Poster-Header ("DRAGON 🐉 BALL DAIMA", "HIGH POTENTIAL", "The Wire", "Fargo", "Creed 3 Rockys Legacy", "„Cocaine Bear“") erkennen!
        // WICHTIG: Collection-Header ("König der Löwen teil 1 bis 3", "Trilogie", "Collection") niemals als Einzeltitel im PreContext speichern!
        const isCollectionHeaderLine = /(?:teil\s*\d+\s*(?:bis|-|–)\s*\d+|\b\d+\s*-\s*\d+\b|collection|trilogie|trilogy|quadrilogie|box)/i.test(firstLine);
        if (!isCollectionHeaderLine) {
          const headSlice = firstLine.slice(0, 110);
          const cutoffCheck = applyHardYearCutoff(headSlice);
          const ym = (` ${headSlice} `).match(YEAR_REGEX);
          if (cutoffCheck.hadYearCutoff && cutoffCheck.titleBeforeYear) {
            nextContext.year = cutoffCheck.year;
            nextContext.title = cleanMediaTitle(cutoffCheck.titleBeforeYear);
          } else if (ym && ym.index >= 2) {
            nextContext.year = parseInt(ym[1], 10);
            nextContext.title = cleanMediaTitle(headSlice.slice(0, Math.max(0, ym.index - 1)));
          } else {
            // Jahresloser Foto-/Text-Header:
            // 1. Falls die erste Zeile ein langer Beschreibungssatz mit einem Titel in Anführungszeichen ist (z.B. „Cocaine Bear“ in msgId 3436):
            const wordsInFirstLine = firstLine.trim().split(/\s+/).filter(Boolean);
            const quotedTitleMatch = (firstLine.length > 65 || wordsInFirstLine.length > 8)
              ? text.match(/[„"«»”"]([^„"«»”"\n]{2,55})[“"«»”"]/)
              : null;
            if (quotedTitleMatch && quotedTitleMatch[1]) {
              const qClean = cleanMediaTitle(quotedTitleMatch[1]);
              if (qClean && qClean.length >= 2 && !/^(?:film|filme|serie|serien|kinofilm|spielfilm|deutsch|german|hd|uhd|4k|\+?18\+?)$/i.test(qClean)) {
                nextContext.title = qClean;
              }
            } else if (firstLine.length >= 2 && firstLine.length <= 65 && wordsInFirstLine.length <= 8) {
              // 2. Kurze, saubere Titelzeile ohne Jahreszahl (z.B. "DRAGON 🐉 BALL DAIMA", "𝗛𝗜𝗚𝗛 𝗣𝗢𝗧𝗘𝗡𝗧𝗜𝗔𝗟 ᴴᴰ", "The Wire", "Fargo", "Prison Break", "Creed 3 Rockys Legacy")
              const noYearClean = cleanMediaTitle(firstLine);
              const isGenericWord = /^(?:film|filme|serie|serien|video|deutsch|german|hd|fullhd|uhd|4k|neu|new|kino|stream|action|horror|comedy|drama|thriller|scifi|fantasy|ab\s+\d+\s+jahren|\+?18\+?)$/i.test(noYearClean);
              if (noYearClean && noYearClean.length >= 2 && !isGenericWord) {
                nextContext.title = noYearClean;
              }
            }
          }
        }
      }
    }

    return nextContext;
  }

  function extractPlainText(msg) {
    if (!msg || typeof msg !== "object") return "";
    return normalizeText(flattenTelegramExportText(msg.caption || msg.text || msg.text_entities)).trim();
  }

  function enrichVideoFromNeighborPost(messages, currentIndex, parsedVideo) {
    if (!parsedVideo || !Array.isArray(messages)) return parsedVideo;
    const rawCurrentTitle = String(parsedVideo.title || parsedVideo.cleanTitle || "").trim();
    if (!rawCurrentTitle) return parsedVideo;

    // MODUL 2.1 Nachbar-Pairing für Multi-Part-Filme (CD2 / Part > 1):
    // Wenn ein Film part > 1 hat und die direkt benachbarte Nachricht (i - 1 oder i + 1) denselben bereinigten Basis-Titel hat, übernimm deren tmdbId / Jahr!
    const currentPartNum = Number(parsedVideo.partNumber || parsedVideo.partInfo?.part || 1);
    const currentNormBase = normalizeCompareString(rawCurrentTitle);
    if (currentPartNum > 1 && currentNormBase) {
      for (const adjOffset of [-1, 1]) {
        const adjMsg = messages[currentIndex + adjOffset];
        if (!adjMsg || typeof adjMsg !== "object") continue;
        const adjParsed = adjMsg._parsedItem || parseTelegramMessage(adjMsg, {});
        if (adjParsed && adjParsed.mediaType === "movie") {
          const adjNormBase = normalizeCompareString(adjParsed.title || adjParsed.cleanTitle || "");
          if (adjNormBase && adjNormBase === currentNormBase) {
            if (!parsedVideo.tmdbId && (adjParsed.tmdbId || adjMsg._resolvedTmdbId)) {
              parsedVideo.tmdbId = Number(adjParsed.tmdbId || adjMsg._resolvedTmdbId);
            }
            if (!parsedVideo.year && adjParsed.year) {
              parsedVideo.year = Number(adjParsed.year);
            }
          }
        }
      }
    }

    // MODUL 3.4: Kein Nachbar-Übergriff (-1/+1), wenn das Video bereits einen eigenen klaren Titel UND ein eigenes Jahr im Dateinamen oder in der Caption besitzt!
    // (Schützt z.B. "Star_Trek_Der_Aufstand_1998" und "The_Watch_Nachbarn_der_3_Art_2012" vor Überschreibung durch benachbarte Info-Posts!)
    if (rawCurrentTitle.length >= 3 && parsedVideo.year) {
      return parsedVideo;
    }

    const baseWord = rawCurrentTitle
      .toLowerCase()
      .replace(/^(?:der|die|das|the|a|disneys|disney's|marvels|marvel's|pixars|pixar's)\s+/i, "")
      .split(/[\s:,\-–]+/)[0]; // z.B. "arielle"

    if (!baseWord || (baseWord.length < 3 && baseWord !== "et" && baseWord !== "es")) return parsedVideo;

    // Prüfe zuerst den Post direkt DARUNTER (+1), dann darüber (-1), dann +2 / -2
    for (const offset of [1, -1, 2, -2]) {
      const neighbor = messages[currentIndex + offset];
      if (!neighbor || typeof neighbor !== "object") continue;
      const nbFile = String(neighbor.video?.file_name || neighbor.document?.file_name || neighbor.file_name || neighbor.file || "").trim();
      const nbIsVideoOrArchive = Boolean(
        neighbor.media_type === "video_file" ||
        neighbor.video ||
        (neighbor.document?.mime_type && String(neighbor.document.mime_type).startsWith("video/")) ||
        (neighbor.mime_type && String(neighbor.mime_type).startsWith("video/")) ||
        /\.(mp4|mkv|avi|m4v|mov|webm|ts|flv|mk3d|rar|srt|vtt|sub|ass|ssa)$/i.test(nbFile)
      );
      if (nbIsVideoOrArchive) continue;

      const rawText = extractPlainText(neighbor);
      const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      const firstLine = lines[0]
        .replace(/^[🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎➡️▶️🍿⭐️❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️\s]+/gu, "")
        .replace(/^(?:disney'?s|disneys|marvel'?s|marvels|pixar'?s|pixars)\s+/i, "")
        .trim();

      // Sicherheits-Check: Die erste Zeile des Nachbarn MUSS das Basiswort ("arielle") enthalten!
      // Dadurch wird "Tin & Tina 2023" (-1) sofort ausgeschlossen!
      if (!firstLine.toLowerCase().includes(baseWord)) continue;

      const yearMatch = rawText.match(/\b(19[2-9]\d|20[0-2]\d)\b/);
      const neighborYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

      if (parsedVideo.year && neighborYear && Number(parsedVideo.year) !== neighborYear) continue;

      // Collection-Header & Detailtitel-Schutz ("Der König der Löwen 2 - Simbas Königreich (1998)" vs. "König der Löwen teil 1 bis 3"):
      const neighborTitleLower = firstLine.toLowerCase();
      const isCollectionHeader = /(?:teil\s*\d+\s*(?:bis|-|–)\s*\d+|\d+\s*-\s*\d+|collection|trilogie|trilogy|quadrilogie|box)/i.test(neighborTitleLower);
      const videoHasDetailedTitle = Boolean(rawCurrentTitle && (/[1-9]/.test(rawCurrentTitle) || rawCurrentTitle.includes("-") || rawCurrentTitle.includes("–") || rawCurrentTitle.includes(":")));

      if (isCollectionHeader || videoHasDetailedTitle) {
        return {
          ...parsedVideo,
          contextOverview: lines.slice(1).join(" ").trim() || parsedVideo.contextOverview || ""
        };
      }

      // Beschreibungs-Schutz ("Cocaine Bear" / "Ted Bundy", MODUL 2.5: > 120 Zeichen oder > 15 Wörter):
      if (isLikelyPlotDescription(firstLine)) {
        const shortHead = firstLine.split(/[:\n(]/)[0].trim();
        const candidateShort = (shortHead.length >= 3 && !isLikelyPlotDescription(shortHead) && shortHead.toLowerCase().includes(baseWord))
          ? (cleanMediaTitle(shortHead.replace(/\s*[\(\[]?\b(19[2-9]\d|20[0-2]\d)\b[\)\]]?\s*$/, "")) || parsedVideo.title)
          : (parsedVideo.cleanTitle || parsedVideo.title);
        return {
          ...parsedVideo,
          title: candidateShort,
          cleanTitle: candidateShort,
          year: parsedVideo.year || neighborYear,
          contextOverview: rawText.trim() || parsedVideo.contextOverview || ""
        };
      }

      const rawEnrichedTitle = firstLine
        .replace(/\s*[\(\[]?\b(19[2-9]\d|20[0-2]\d)\b[\)\]]?\s*$/, "")
        .trim();
      let cleanedTitle = cleanMediaTitle(rawEnrichedTitle) || rawEnrichedTitle;
      let contextOverview = lines.slice(1).join(" ").trim();
      if (cleanedTitle && isLikelyPlotDescription(cleanedTitle)) {
        contextOverview = `${cleanedTitle} ${contextOverview}`.trim();
        cleanedTitle = parsedVideo.cleanTitle && !isLikelyPlotDescription(parsedVideo.cleanTitle)
          ? parsedVideo.cleanTitle
          : cleanedTitle.split(/[:\n(]/)[0].trim().slice(0, 120);
      }

      return {
        ...parsedVideo,
        title: cleanedTitle || parsedVideo.title,
        cleanTitle: cleanedTitle || parsedVideo.cleanTitle || parsedVideo.title,
        year: parsedVideo.year || neighborYear,
        contextOverview: contextOverview || parsedVideo.contextOverview || ""
      };
    }

    return parsedVideo;
  }

  function parseTelegramMessage(msg, prevContext = {}) {
    if (!msg || typeof msg !== "object") return null;
    if (isJunkOrSticker(msg)) return null;

    const rawFilePath = String(msg.file || "").trim();
    const validFilePath = rawFilePath && !rawFilePath.startsWith("(File not included")
      ? rawFilePath.split("/").pop()
      : "";
    const rawFileName = String(msg.video?.file_name || msg.document?.file_name || msg.file_name || validFilePath || "").trim();
    // MODUL 2: Archive (.rar/.zip/.7z/.iso/.tar/.gz/.part1.rar/.r00/.z01/.7z.001) als Download-Dateien durchlassen!
    const isArchive = isArchiveFilenameOrText(rawFileName, extractRawMessageText(msg));
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

    const rawText = extractRawMessageText(msg);
    const durationSec = Number(msg.video?.duration || msg.duration_seconds || msg.duration || 0) || null;
    const videoWidth  = Number(msg.video?.width  || msg.width  || 0) || null;
    const videoHeight = Number(msg.video?.height || msg.height || 0) || null;
    const quality     = detectVideoQuality(msg, rawText, rawFileName);
    const entities = extractEntitiesFromExportMsg(msg);

    // MODUL 2.3: Film-Editionen VOR der Bereinigung extrahieren und editionLabel sichern
    const editionInfo = extractAndStripEditions(`${rawText || ""} ${rawFileName || ""}`);
    const editionLabel = editionInfo.editionLabel || null;

    const langInfo = detectLanguages(rawText, rawFileName);
    const languages = langInfo.languages;
    const subtitles = langInfo.subtitles;
    // MODUL 5.1: Multi-Part-Filme (CD1/CD2 & führende 01/02 vor Jahreszahlen) VOR der Serien-Weiche erkennen!
    let partInfo = extractPartInfo(rawText, rawFileName, false);
    const isBonusClip = BONUS_SPECIAL_REGEX.test(`${rawFileName || ""} ${rawText || ""}`);

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

    // "Episode 6 Staffel 2 von Little Britain.mp4" Context-Bleeding-Fix:
    const rawFnForVon = String(rawFileName || "").replace(/_/g, " ");
    const rawTxtForVon = String(rawTextWithoutPlot || "").replace(/_/g, " ");
    const vonPattern = /(?:(?:Episode|Folge)\s*0*(\d{1,3})(?:[\s.\-&]+0*(\d{1,3}))?\s*(?:(?:\(?Staffel|\(?Season)\s*0*(\d{1,2})\)?\s*)?|(?:Staffel|Season)\s*0*(\d{1,2})\s*(?:Episode|Folge)\s*0*(\d{1,3})\s*|\bS0*(\d{1,2})E0*(\d{1,3})(?:-E0*(\d{1,3}))?\s+)von\s+(.+?)(?:\s*\(\d{1,3}\))?(?:\.(?:mp4|mkv|avi|mov|m4v|webm|ts)|[\s._]*(?:s[_. ]?to(?:[_. ]*Serien)?|_sto_Serien|Sto[\s_-]*Serien|HD|Online|❤)|\r?\n|$)/i;
    const earlyVonMatch = rawFnForVon.match(vonPattern) || fileName.match(vonPattern) || rawTxtForVon.match(vonPattern);
    let explicitVonSeriesTitle = "";
    let explicitVonSeason = null;
    let explicitVonEpisode = null;
    let explicitVonEpisodeEnd = null;
    if (earlyVonMatch) {
      explicitVonEpisode = parseInt(earlyVonMatch[1] || earlyVonMatch[5] || earlyVonMatch[7] || "1", 10);
      if (earlyVonMatch[2] || earlyVonMatch[8]) {
        explicitVonEpisodeEnd = parseInt(earlyVonMatch[2] || earlyVonMatch[8], 10);
      }
      explicitVonSeason = parseInt(earlyVonMatch[3] || earlyVonMatch[4] || earlyVonMatch[6] || "1", 10);
      explicitVonSeriesTitle = cleanMediaTitle(String(earlyVonMatch[9] || "").replace(/_/g, " ").trim());
      if (explicitVonSeriesTitle) {
        if (prevContext && typeof prevContext === "object") {
          prevContext.seriesHeader = explicitVonSeriesTitle;
          prevContext.season = explicitVonSeason;
          delete prevContext.tmdbId;
          delete prevContext.imdbId;
          delete prevContext.title;
        }
        activeContext = {
          seriesHeader: explicitVonSeriesTitle,
          season: explicitVonSeason,
          isSeriesHeader: true,
          lastMessageId: currentMsgId
        };
      }
    }

    const prelimTextSe = extractSePartsFromSource(line1 || text);
    const prelimFileSe = !isGenericFile ? extractSePartsFromSource(fileName) : null;
    const ownSeriesNameInMsg = explicitVonSeriesTitle || pickBestSeriesTitleCandidate(
      prelimTextSe ? (prelimTextSe.before || (prelimTextSe.index === 0 ? prelimTextSe.after : "")) : "",
      prelimFileSe ? (prelimFileSe.before || (prelimFileSe.index === 0 ? prelimFileSe.after : "")) : "",
      ""
    );
    const contextKnownName = activeContext.seriesHeader || activeContext.title || "";
    if (ownSeriesNameInMsg && contextKnownName) {
      const ownNorm = normalizeCompareString(ownSeriesNameInMsg);
      const ctxNorm = normalizeCompareString(contextKnownName);
      if (ownNorm && ctxNorm && ownNorm !== ctxNorm) {
        activeContext = explicitVonSeriesTitle
          ? { seriesHeader: explicitVonSeriesTitle, season: explicitVonSeason || 1, isSeriesHeader: true, lastMessageId: currentMsgId }
          : {};
      }
    } else if (ownSeriesNameInMsg && (activeContext.tmdbId || activeContext.imdbId) && !contextKnownName) {
      activeContext = {};
    }

    let tmdbId = activeContext.tmdbId || null;
    let imdbId = activeContext.imdbId || null;
    let mediaType = explicitVonSeriesTitle ? "tv" : (activeContext.mediaType || "movie");
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
    const EARLY_PAREN_YEAR_REGEX = /[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(18\d{2}|19\d{2}|20[0-3]\d)\s*[\)\]]/i;
    const EARLY_EXPLICIT_SERIES_MARKER = /(?:^|[\s._\-(🔸🔶#])(?:S\d{1,2}[\s._-]*E\d{1,3}|E\d{1,3}[\s._-]*S\d{1,2}|\d{1,2}x\d{2,3}|Staffel\s*\d{1,2}|Season\s*\d{1,2}|Folge\s*\d{1,3}|Episode\s*\d{1,3}|Ep\.?\s*\d{1,3})\b/i;
    const hasOwnParenYear = Boolean(
      inlineExplicitYear ||
      EARLY_PAREN_YEAR_REGEX.test(text.replace(FULL_DATE_REGEX, " ")) ||
      EARLY_PAREN_YEAR_REGEX.test(fileName.replace(FULL_DATE_REGEX, " "))
    );
    const hasOwnSeriesMarkerInMsg = Boolean(
      explicitTvUrlHit ||
      explicitVonSeriesTitle ||
      EARLY_EXPLICIT_SERIES_MARKER.test(text) ||
      EARLY_EXPLICIT_SERIES_MARKER.test(fileName)
    );
    // MODUL 2.1: Explizite Multi-Part-Filme (CD1/CD2 oder 01/02 vor Jahresklammer) ohne SxxExx sind IMMER Filme!
    const forceMovieByMultiPart = Boolean(partInfo.isExplicitMultiPartMovie && !hasOwnSeriesMarkerInMsg);

    // Eiserne Weichen-Regel: Jahreszahl in Klammern (z.B. "Iron Man 3 (2013)") oder Multi-Part-Marker OHNE Serien-Marker ist zu 100% ein Film!
    if ((hasOwnParenYear || forceMovieByMultiPart) && !hasOwnSeriesMarkerInMsg) {
      mediaType = "movie";
      if (activeContext.mediaType === "tv" && !explicitMovUrlHit) {
        tmdbId = null;
        imdbId = null;
      }
    }

    // activeContext.title nur heranziehen, wenn der Dateiname generisch ist oder das Basiswort übereinstimmt
    const ownVideoTitleCandidate = cleanMediaTitle(((line1 && !isLikelyPlotDescription(line1) ? line1 : "") || (!isGenericFile ? fileName : "")).replace(YEAR_REGEX, " "));
    const ownBaseWord = ownVideoTitleCandidate
      .toLowerCase()
      .replace(/^(?:der|die|das|the|a|disneys|disney's|marvels|marvel's|pixars|pixar's)\s+/i, "")
      .split(/[\s:,\-–]+/)[0] || "";
    const ctxTitleLower = String(activeContext.title || "").toLowerCase();
    const preContextMatchesOwnTitle = !ownBaseWord || ownBaseWord.length < 2 || ctxTitleLower.includes(ownBaseWord);

    if (!preContextMatchesOwnTitle && !hasOwnSeriesMarkerInMsg && activeContext.title && !activeContext.seriesHeader) {
      tmdbId = explicitMovUrlHit || explicitTvUrlHit ? tmdbId : null;
      imdbId = null;
    }

    const usePreContextTitle = Boolean(
      !inlineExplicitTitle &&
      !ownSeriesNameInMsg &&
      !((hasOwnParenYear || forceMovieByMultiPart) && !hasOwnSeriesMarkerInMsg && activeContext.mediaType === "tv") &&
      activeContext.title &&
      !isLikelyPlotDescription(activeContext.title) &&
      preContextMatchesOwnTitle &&
      (
        activeContext.tmdbId ||
        activeContext.imdbId ||
        isGenericFile ||
        (!line1 && isGenericFile) ||
        cleanMediaTitle(line1).toLowerCase().startsWith(activeContext.title.toLowerCase().slice(0, 6))
      )
    );

    const explicitTitle = inlineExplicitTitle || (usePreContextTitle ? activeContext.title : null);
    const originalTitle = text.match(/Originaltitel:\s*([^\n]+)/i)?.[1]?.trim() || (usePreContextTitle ? activeContext.originalTitle : null);
    const explicitYear  = inlineExplicitYear || (usePreContextTitle ? activeContext.year : null);

    // MODUL 2.4 & 2.5: Jahres-Cut-Off zuerst ausführen, danach Beschreibungs-Schutz (> 15 Wörter oder > 120 Zeichen statt 40/50 Zeichen!)
    const line1YearCut = applyHardYearCutoff(line1);
    const fileYearCut = !isGenericFile ? applyHardYearCutoff(fileName) : { titleBeforeYear: "", year: null, hadYearCutoff: false };
    const effectiveLine1ForTitle = line1YearCut.hadYearCutoff ? line1YearCut.titleBeforeYear : line1;

    let extractedContextOverview = lines.length > 1 ? lines.slice(1).join(" ").trim() : "";
    let sourceUsed = "file_name";
    let primarySource = fileName;
    if (explicitTitle && !isLikelyPlotDescription(explicitTitle)) {
      primarySource = explicitTitle;
      sourceUsed = usePreContextTitle ? "pre_context_title" : "explicit_title";
    } else if (effectiveLine1ForTitle && effectiveLine1ForTitle.length >= 2 && !isLikelyPlotDescription(effectiveLine1ForTitle) && !/^(?:Qualität|Größe|Groesse|Size|Format|Dauer|Laufzeit|Länge|Sprache|Language|Genre|Gener|Studio|Director|Regie|Darsteller|Actors|Cast|Released|Release|FSK|IMDb|Rating|Preis|Free)\s*[:=-]/i.test(effectiveLine1ForTitle) && !/^(?:\+?\s*1[268]\s*\+?|Ab\s+\d+\s+Jahren)/i.test(effectiveLine1ForTitle)) {
      primarySource = line1YearCut.hadYearCutoff ? `${line1YearCut.titleBeforeYear} (${line1YearCut.year})` : line1;
      sourceUsed = "caption_line1";
    } else if (line1 && isLikelyPlotDescription(effectiveLine1ForTitle)) {
      extractedContextOverview = lines.join(" ").trim();
      if (!isGenericFile && fileName) {
        primarySource = fileName;
        sourceUsed = "file_name";
      } else if (line1YearCut.hadYearCutoff && line1YearCut.titleBeforeYear) {
        primarySource = `${line1YearCut.titleBeforeYear} (${line1YearCut.year})`;
        sourceUsed = "caption_line1_shortened";
      } else {
        primarySource = line1.split(/[:\n(]/)[0].trim().slice(0, 120);
        sourceUsed = "caption_line1_shortened";
      }
    } else if (isGenericFile && line1) {
      primarySource = line1.slice(0, 120);
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
    if (!forceMovieByMultiPart) {
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
    }

    // Regel 7: Alle Serien- & Episoden-Muster (werden übersprungen, wenn forceMovieByMultiPart = true, damit CD1/CD2 oder "The Postman 01 (1997)" niemals als Serie gilt!)
    const hashStaffelMatch = !forceMovieByMultiPart && (primarySource.match(/^(.+?)[_\s]*#[_\s]*(?:Staffel[_\s]*(\d{1,2})[_\s,.\-]*(?:Folge|Episode)[_\s]*(\d{1,3})|S(\d{1,2})E(\d{1,3}))[_\s]*(?:[#\-–]+[_\s]*)(.+)$/i)
                          || fileName.match(/^(.+?)[_\s]*#[_\s]*(?:Staffel[_\s]*(\d{1,2})[_\s,.\-]*(?:Folge|Episode)[_\s]*(\d{1,3})|S(\d{1,2})E(\d{1,3}))[_\s]*(?:[#\-–]+[_\s]*)(.+)$/i));
    const epStaffelVon = !forceMovieByMultiPart && (primarySource.match(/^(?:Episode|Folge)[_\s.]*(\d{1,3})(?:[_\s.\-&]+(\d{1,3}))?[_\s.\-]*(?:(?:\(?Staffel[_\s.]*(\d{1,2})\)?)[_\s.\-]*(?:von[_\s.]+)?|(?:von[_\s.]+))(.+?)(?:[_\s.]*\(\d{1,3}\))?(?:[_\s.]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|\.(?:mp4|mkv)|$)/i)
                       || fileName.match(/^(?:Episode|Folge)[_\s.]*(\d{1,3})(?:[_\s.\-&]+(\d{1,3}))?[_\s.\-]*(?:(?:\(?Staffel[_\s.]*(\d{1,2})\)?)[_\s.\-]*(?:von[_\s.]+)?|(?:von[_\s.]+))(.+?)(?:[_\s.]*\(\d{1,3}\))?(?:[_\s.]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|\.(?:mp4|mkv)|$)/i));
    const textSeParts = !forceMovieByMultiPart ? extractSePartsFromSource(primarySource) : null;
    const fileSeParts = (!forceMovieByMultiPart && !isGenericFile) ? extractSePartsFromSource(fileName) : null;
    const seriesFolge = !forceMovieByMultiPart && (primarySource.match(/^(.+?)[_\s.\-·‧]+(?:Staffel[_\s.]*(\d{1,2})[_\s.\-·‧]+)?(?:Folge|Episode)[_\s.]*(\d{1,3})\b[_\s.\-·‧:]*(.*)$/i)
                     || fileName.match(/^(.+?)[_\s.\-·‧]+(?:Staffel[_\s.]*(\d{1,2})[_\s.\-·‧]+)?(?:Folge|Episode)[_\s.]*(\d{1,3})\b[_\s.\-·‧:]*(.*)$/i));
    const leadingFolgeOnly = !forceMovieByMultiPart && (primarySource.match(/^(?:Folge|Episode)[_\s.]*(\d{1,3})\b(.*)$/i)
                           || fileName.match(/^(?:Folge|Episode)[_\s.]*(\d{1,3})\b(.*)$/i));

    // Datum vor Jahres-Extraktion entfernen, damit (21.07.2012) oder (01.12.2018) niemals als Jahr 2012/2018 erkannt wird (Fall 17)
    const PAREN_YEAR_REGEX = /[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\s+)?(18\d{2}|19\d{2}|20[0-3]\d)\s*[\)\]]/i;
    const dateSafePrimary = ` ${primarySource.replace(FULL_DATE_REGEX, " ")} `;
    const dateSafeFile = ` ${fileName.replace(FULL_DATE_REGEX, " ")} `;
    const dateSafeLine1 = ` ${line1.replace(FULL_DATE_REGEX, " ")} `;
    const parenYearMatch = dateSafePrimary.match(PAREN_YEAR_REGEX) || dateSafeLine1.match(PAREN_YEAR_REGEX) || dateSafeFile.match(PAREN_YEAR_REGEX);
    const yearMatch = parenYearMatch || dateSafePrimary.match(YEAR_REGEX) || dateSafeLine1.match(YEAR_REGEX) || dateSafeFile.match(YEAR_REGEX) ||
      (line1YearCut.year ? [String(line1YearCut.year), String(line1YearCut.year)] : null) ||
      (fileYearCut.year ? [String(fileYearCut.year), String(fileYearCut.year)] : null);

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

      if (fileSeParts && fileSeParts.episode && fileSeParts.episode !== episode) {
        episode = fileSeParts.episode;
        if (fileSeParts.season) season = fileSeParts.season;
        episodeEnd = fileSeParts.episodeEnd || null;
      } else if (episodeEnd && (episodeEnd - episode >= 2) && fileSeParts && !fileSeParts.episodeEnd) {
        episode = fileSeParts.episode;
        episodeEnd = null;
      }

      const beforeText = cleanMediaTitle(line1.replace(/Staffel\s*\d+.*/i, "").replace(YEAR_REGEX, " "));
      const beforeFile = fileSeParts ? (fileSeParts.before || (!fileSeParts.before && fileSeParts.after && !beforeText ? fileSeParts.after : "")) : "";
      seriesTitle = pickBestSeriesTitleCandidate(beforeText, beforeFile, activeContext.seriesHeader);

      let tailEp = cleanMediaTitle(multiLineSeHit.lineText.slice((m.index || 0) + m[0].length));
      if (!tailEp && lines[multiLineSeHit.lineIndex + 1]) {
        const nextLine = lines[multiLineSeHit.lineIndex + 1];
        if (nextLine.length <= 80 && !/^(?:\(|Regie:|Darsteller:|Bildqualität:|Tonqualität:|Plot:|Beschreibung:|Rating:|https?:|@)/i.test(nextLine)) {
          tailEp = cleanMediaTitle(nextLine);
        }
      }
      if (!tailEp && fileSeParts && fileSeParts.after && normalizeCompareString(fileSeParts.after) !== normalizeCompareString(seriesTitle)) {
        tailEp = fileSeParts.after;
      }
      episodeTitle = tailEp;
    } else if (explicitVonSeriesTitle && !forceMovieByMultiPart) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      episode = explicitVonEpisode || 1;
      episodeEnd = explicitVonEpisodeEnd || null;
      season = explicitVonSeason || inlineStaffelNum || 1;
      seriesTitle = explicitVonSeriesTitle;
    } else if (epStaffelVon) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      episode = parseInt(epStaffelVon[1], 10);
      if (epStaffelVon[2]) episodeEnd = parseInt(epStaffelVon[2], 10);
      season = epStaffelVon[3] ? parseInt(epStaffelVon[3], 10) : (inlineStaffelNum || 1);
      seriesTitle = cleanMediaTitle(epStaffelVon[4]);
      if (seriesTitle && prevContext && typeof prevContext === "object") {
        prevContext.seriesHeader = seriesTitle;
      }
    } else if (textSeParts || fileSeParts) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      const mainSe = (fileSeParts && fileSeParts.episode && (!textSeParts || fileSeParts.episode !== textSeParts.episode))
        ? fileSeParts
        : (textSeParts || fileSeParts);
      season = mainSe.season || fileSeParts?.season || textSeParts?.season || 1;
      episode = mainSe.episode;
      episodeEnd = mainSe.episodeEnd;

      let beforeText = textSeParts ? textSeParts.before : "";
      let afterText  = textSeParts ? textSeParts.after  : "";
      let beforeFile = fileSeParts ? fileSeParts.before : "";
      let afterFile  = fileSeParts ? fileSeParts.after  : "";

      if (beforeText && beforeFile && !afterText && beforeText.toLowerCase().startsWith(beforeFile.toLowerCase()) && beforeText.length > beforeFile.length + 3) {
        afterText = cleanMediaTitle(beforeText.slice(beforeFile.length));
        beforeText = beforeFile;
      }

      const combinedBefore = pickBestSeriesTitleCandidate(beforeText, beforeFile, "");
      if (combinedBefore) {
        seriesTitle = combinedBefore;
        if (afterText && afterFile) {
          episodeTitle = afterText.length >= afterFile.length ? afterText : afterFile;
        } else {
          episodeTitle = afterText || afterFile || "";
        }
      } else {
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
      season = (fileSeParts && fileSeParts.season) ? fileSeParts.season : (seriesFolge[2] ? parseInt(seriesFolge[2], 10) : (inlineStaffelNum || 1));
      episode = (fileSeParts && fileSeParts.episode) ? fileSeParts.episode : parseInt(seriesFolge[3], 10);
      episodeTitle = cleanMediaTitle(seriesFolge[4]);
      const jacobMatch = seriesTitle.match(/^(Jacob\s*2[\s/_]*2)\s+(und\s+.+)$/i);
      if (jacobMatch) {
        episodeTitle = cleanMediaTitle(`Jacob 2/2 ${jacobMatch[2]}`);
        seriesTitle = "Jacob 2/2";
      }
    } else if (leadingFolgeOnly) {
      mediaType = "tv";
      hasExplicitEpisodeMarker = true;
      season = (fileSeParts && fileSeParts.season) ? fileSeParts.season : (inlineStaffelNum || 1);
      episode = (fileSeParts && fileSeParts.episode) ? fileSeParts.episode : parseInt(leadingFolgeOnly[1], 10);
      const remClean = cleanMediaTitle(leadingFolgeOnly[2].replace(YEAR_REGEX, " "));
      seriesTitle = activeContext.seriesHeader || remClean || "Unbekannt";
      if (activeContext.seriesHeader && remClean && normalizeCompareString(remClean) !== normalizeCompareString(activeContext.seriesHeader)) {
        episodeTitle = remClean;
      }
    } else if (
      !partInfo.isSplit &&
      !forceMovieByMultiPart &&
      !hasOwnParenYear &&
      (!durationSec || durationSec < 4200) &&
      (
        /^\d{2,3}[\s\-]+([A-Za-zÄÖÜäöüß].{2,})/.test(fileName.replace(/\.(?:mp4|mkv|avi|mov|m4v|webm|ts)$/i, "").trim()) ||
        /^\d{2,3}[\s\-]+([A-Za-zÄÖÜäöüß].{2,})/.test(primarySource.trim())
      )
    ) {
      const rawLeadSrc = /^\d{2,3}[\s\-]+([A-Za-zÄÖÜäöüß].{2,})/.test(fileName.replace(/\.(?:mp4|mkv|avi|mov|m4v|webm|ts)$/i, "").trim())
        ? fileName.replace(/\.(?:mp4|mkv|avi|mov|m4v|webm|ts)$/i, "").trim()
        : primarySource.trim();
      const leadMatch = rawLeadSrc.match(/^0*(\d{1,3})[\s\-]+(.+)$/);
      const epNumVal = leadMatch ? parseInt(leadMatch[1], 10) : 0;
      const afterNumTitle = leadMatch ? cleanMediaTitle(leadMatch[2].replace(YEAR_REGEX, " ")) : "";
      const fallbackSeriesFromCtx = activeContext.seriesHeader || prevContext?.seriesHeader || activeContext.title || prevContext?.title || "";
      if (epNumVal >= 1 && epNumVal <= 300 && (fallbackSeriesFromCtx || afterNumTitle)) {
        mediaType = "tv";
        hasExplicitEpisodeMarker = true;
        episode = epNumVal;
        season = inlineStaffelNum || activeContext.season || prevContext?.season || 1;
        seriesTitle = fallbackSeriesFromCtx || afterNumTitle;
        episodeTitle = fallbackSeriesFromCtx ? afterNumTitle : "";
        sourceUsed = "leading_episode_number";
      }
    } else if (
      activeContext.seriesHeader &&
      !partInfo.isSplit &&
      !forceMovieByMultiPart &&
      !hasOwnParenYear &&
      (!durationSec || durationSec < 4200)
    ) {
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

    const MOVIE_FRANCHISE_GUARD = /^(?:deep\s+blue\s+sea|deep\s+blue|mad\s+max|sharknado|sector|ghettogangz|burg\s+schreckenstein|fifty\s+shades|jumanji|machete|crank|mechanic|tremors|lake\s+placid|anaconda|piranha|death\s+race|sniper|marine|jarhead|scorpion\s+king|mumie|mummy|vermächtnis|percy\s+jackson|schlümpfe|smurfs|ralph\s+reichts|zoomania|pets|sing|rio|jagdfieber|paddington|ted|kill\s+bill|sin\s+city|300|kick[\s-]*ass|johnny\s+english|austin\s+powers|universal\s+soldier|bloodsport|kickboxer|never\s+back\s+down|boyka|fack\s+ju|ostwind|bibi|conni|vorstadtkrokodile|wilde\s+kerle|fünf\s+freunde|tkkg|drei\s+fragezeichen|rush\s+hour|taken|punisher|blade|ong\s+bak|raid|goal|hooligans|manta|troll|nun|sinister|freitag\s+der|nightmare|saw|spider[\s-]*man|iron\s+man|ninja\s+turtles|teenage\s+mutant\s+ninja\s+turtles|james\s+bond|007|shrek|kingsman|pirates\s+of\s+the\s+caribbean|fluch\s+der\s+karibik|wonder\s+woman|venom|underworld|final\s+destination|insidious|paranormal\s+activity|jurassic\s+park|jurassic\s+world|indiana\s+jones|star\s+wars|star\s+trek|harry\s+potter|fast\s+and\s+furious|the\s+fast\s+and\s+the\s+furious|transporter|russian\s+transporter|bourne|mission\s+impossible|scary\s+movie|american\s+pie|step\s+up|ip\s+man|undisputed|scream|halloween|hellraiser|chucky|annabelle|avengers|captain\s+america|thor|guardians\s+of\s+the\s+galaxy|deadpool|x[\s-]*men|matrix|john\s+wick|equalizer|expendables|rambo|rocky|creed|alien|predator|terminator|robocop|die\s+hard|stirb\s+langsam|lethal\s+weapon|beverly\s+hills\s+cop|bad\s+boys|men\s+in\s+black|ghostbusters|back\s+to\s+the\s+future|zurück\s+in\s+die\s+zukunft|lord\s+of\s+the\s+rings|herr\s+der\s+ringe|hobbit|narnia|twilight|hunger\s+games|tribute\s+von\s+panem|maze\s+runner|divergent|resident\s+evil|silent\s+hill|conjuring|purge|quiet\s+place|hangover|oceans|now\s+you\s+see\s+me|unfassbaren|hotel\s+transsilvanien|hotel\s+transylvania|ice\s+age|madagascar|ich\s+einfach\s+unverbesserlich|despicable\s+me|minions|toy\s+story|cars|planes|kung\s+fu\s+panda|drachenzähmen|how\s+to\s+train\s+your\s+dragon|frozen|eiskönigin)\b/i;

    if (
      mediaType !== "tv" &&
      !tmdbId &&
      !partInfo.isSplit &&
      !forceMovieByMultiPart &&
      !hasOwnParenYear &&
      (!durationSec || durationSec < 4200)
    ) {
      const cleanedCand = cleanMediaTitle(primarySource.replace(YEAR_REGEX, " "));
      const normHeader = activeContext.seriesHeader ? normalizeCompareString(activeContext.seriesHeader) : "";
      const midEp = cleanedCand.match(/^(.{3,}?)\s+(?<!\d)0?([1-9]\d?)\s+([A-ZÄÖÜa-zäöü].{3,})$/);
      if (midEp && !/^(?:Teil|Part|CD|Disc|DVD|bd|4k|uhd|1080p|720p)\b/i.test(midEp[3]) && !/\b007\b/.test(cleanedCand) && !MOVIE_FRANCHISE_GUARD.test(midEp[1].trim()) && !MOVIE_FRANCHISE_GUARD.test(cleanedCand)) {
        const candBaseNorm = normalizeCompareString(midEp[1]);
        const headerMatches = Boolean(normHeader && candBaseNorm && (candBaseNorm.startsWith(normHeader.slice(0, 6)) || normHeader.startsWith(candBaseNorm.slice(0, 6))));
        const isKnownClassicNumberedSeries = /^(?:pippi\s+langstrumpf|zur\s+see|spuk\s+im\s+hochhaus|spuk\s+unterm\s+riesenrad|spuk\s+von\s+draußen|spuk\s+von\s+draussen|black\s+box|das\s+schloss\s+im\s+nebel|gormenghast|archiv\s+des\s+todes|front\s+ohne\s+gnade|feuerdrachen|gefährliche\s+fahndung|treffpunkt\s+flughafen|rote\s+bergsteiger|the\s+chosen)\b/i.test(midEp[1].trim());
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
        const tailEpMatch = cleanedCand.match(/^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9\s._\-]{2,}?)\s+0*([1-9]\d?)$/);
        if (tailEpMatch && !/\b(?:Teil|Part|CD|Disc|DVD|4K|3D|007)\s*$/i.test(tailEpMatch[1]) && !MOVIE_FRANCHISE_GUARD.test(tailEpMatch[1].trim()) && !MOVIE_FRANCHISE_GUARD.test(cleanedCand)) {
          const candBaseNorm = normalizeCompareString(tailEpMatch[1]);
          const headerMatches = Boolean(normHeader && candBaseNorm && (candBaseNorm.startsWith(normHeader.slice(0, 6)) || normHeader.startsWith(candBaseNorm.slice(0, 6))));
          const isKnownClassicNumberedSeries = /^(?:pippi\s+langstrumpf|zur\s+see|spuk\s+im\s+hochhaus|spuk\s+unterm\s+riesenrad|spuk\s+von\s+draußen|spuk\s+von\s+draussen|black\s+box|das\s+schloss\s+im\s+nebel|gormenghast|archiv\s+des\s+todes|front\s+ohne\s+gnade|feuerdrachen|gefährliche\s+fahndung|treffpunkt\s+flughafen|rote\s+bergsteiger|the\s+chosen)\b/i.test(tailEpMatch[1].trim());
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

    // Eiserne Weichen-Regel ("Iron Man 3 (2013)", "The Postman 01 (1997)", "Bedtime Stories (2008)-cd1.avi"):
    if (
      forceMovieByMultiPart ||
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

    // MODUL 2.2: Bonus- & Special-Clips ("The Chosen - 1 - Bonus.mkv"):
    // Darf NIEMALS als reguläre Episode (season >= 1, episode >= 1) gespeichert werden! Setze season = 0 (Specials) & isBonus = true, damit S01E01 niemals überschrieben wird!
    if (isBonusClip && mediaType === "tv") {
      season = 0;
    }

    let year = explicitYear
      ? parseInt(explicitYear, 10)
      : (yearMatch ? parseInt(yearMatch[1], 10) : (line1YearCut.year || fileYearCut.year || null));
    if (!year && mediaType === "tv" && activeContext.year && activeContext.seriesHeader && seriesTitle &&
        normalizeCompareString(seriesTitle) === normalizeCompareString(activeContext.seriesHeader)) {
      year = Number(activeContext.year);
    }

    // MODUL 5.1: Bei Serien ist part_number für Video-Streams IMMER 1 (bei mehrteiligen Serien-Archiven bleibt die Archiv-Part-Nummer für den Sammel-/Einzel-Download erhalten!)
    if (mediaType === "tv" && !isArchive) {
      partInfo = {
        isSplit: false,
        isArchive: false,
        isDownloadOnly: false,
        type: "video",
        isExplicitMultiPartMovie: false,
        part: 1,
        partNumber: 1,
        partType: null,
        partLabel: null
      };
    }

    let rawTitle = seriesTitle || explicitTitle || primarySource;
    if (!seriesTitle && !explicitTitle) {
      const cutoffCheck = applyHardYearCutoff(rawTitle);
      if (cutoffCheck.hadYearCutoff && cutoffCheck.titleBeforeYear) {
        rawTitle = cutoffCheck.titleBeforeYear;
        if (!year && cutoffCheck.year) year = cutoffCheck.year;
      } else if (yearMatch && typeof yearMatch.index === "number" && yearMatch.index >= 2) {
        const matchedSource = parenYearMatch
          ? (dateSafePrimary.match(PAREN_YEAR_REGEX) ? dateSafePrimary : (dateSafeLine1.match(PAREN_YEAR_REGEX) ? dateSafeLine1 : dateSafeFile))
          : (dateSafePrimary.match(YEAR_REGEX) ? dateSafePrimary : (dateSafeLine1.match(YEAR_REGEX) ? dateSafeLine1 : dateSafeFile));
        rawTitle = matchedSource.slice(0, yearMatch.index).trim();
      }
    }

    // MODUL 4 (Zweit-Titel in Klammern): z.B. "Little Italy (Ein Rezept für die Liebe)" oder "Freunde mit gewissen Vorzügen (Friends With Benefits)"
    const rawSplitCheck = splitParenthesizedAltTitle(rawTitle);
    const fileSplitCheck = !isGenericFile && fileName ? splitParenthesizedAltTitle(fileYearCut.hadYearCutoff ? fileYearCut.titleBeforeYear : fileName) : { primaryTitle: "", altTitle: null };
    const line1SplitCheck = line1 ? splitParenthesizedAltTitle(line1YearCut.hadYearCutoff ? line1YearCut.titleBeforeYear : line1) : { primaryTitle: "", altTitle: null };
    if (rawSplitCheck.altTitle) {
      rawTitle = rawSplitCheck.primaryTitle;
    }
    const resolvedAltTitle = originalTitle || rawSplitCheck.altTitle || fileSplitCheck.altTitle || line1SplitCheck.altTitle || null;

    if (year) {
      const strippedYearTitle = cleanMediaTitle(rawTitle.replace(new RegExp(`\\b${year}\\b`, "g"), " "), { hadYearCutoff: true });
      if (strippedYearTitle.length >= 2) rawTitle = strippedYearTitle;
    }
    rawTitle = rawTitle.replace(/[\(\[]\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\b\s+)?(?:19[2-9]\d|20[0-2]\d)\s*[\)\]]?/gi, "");
    rawTitle = rawTitle.replace(/\s*(?:Plot|Beschreibung)\s*:.*$/i, "");

    // MODUL 3.3 Dual-Source-Fallback Vorbereitung: Bereinige sowohl Text-Titel als auch Dateinamen-Titel separat
    const cleanTitleFromFile = !isGenericFile && fileName
      ? cleanMediaTitle((fileSplitCheck.primaryTitle || (fileYearCut.hadYearCutoff ? fileYearCut.titleBeforeYear : fileName)).replace(year ? new RegExp(`\\b${year}\\b`, "g") : /$^/, " "), { hadYearCutoff: fileYearCut.hadYearCutoff })
      : "";
    const cleanTitleFromText = line1
      ? cleanMediaTitle((line1SplitCheck.primaryTitle || (line1YearCut.hadYearCutoff ? line1YearCut.titleBeforeYear : line1)).replace(year ? new RegExp(`\\b${year}\\b`, "g") : /$^/, " "), { hadYearCutoff: line1YearCut.hadYearCutoff })
      : "";

    let cleanTitle = cleanMediaTitle(rawTitle, { hadYearCutoff: Boolean(year) }) || cleanTitleFromFile || cleanTitleFromText;
    if (!cleanTitle) return null;

    // MODUL 5.3: Kein 40/50-Zeichen-Abschneider mitten im Wort ("Star Wars Episode V - Das Imperium schlägt zurück"-Fix)!
    // Limit auf 120 Zeichen erhöht; überlange Beschreibungstexte ("Cocaine Bear"-Schutz) werden über > 15 Wörter oder > 120 Zeichen erkannt!
    if (isLikelyPlotDescription(cleanTitle)) {
      if (!extractedContextOverview) extractedContextOverview = cleanTitle;
      if (cleanTitleFromFile && cleanTitleFromFile.length >= 2 && !isLikelyPlotDescription(cleanTitleFromFile)) {
        cleanTitle = cleanTitleFromFile;
      } else {
        cleanTitle = cleanMediaTitle(cleanTitle.split(/[:\n(]/)[0].trim().slice(0, 120)) || cleanTitle.slice(0, 120).trim();
      }
    }

    if (episodeTitle && year) {
      episodeTitle = cleanMediaTitle(episodeTitle.replace(new RegExp(`\\b${year}\\b`, "g"), " "));
    }
    if (episodeTitle && normalizeCompareString(episodeTitle) === normalizeCompareString(cleanTitle)) {
      episodeTitle = "";
    }

    return {
      msgId: currentMsgId > 0 ? currentMsgId : null,
      message_id: currentMsgId > 0 ? currentMsgId : null,
      mediaType,
      type: isArchive ? "archive" : (mediaType === "tv" ? "series" : "movie"),
      isArchive,
      isDownloadOnly: Boolean(isArchive),
      isBonus: isBonusClip,
      tmdbId,
      imdbId,
      title: cleanTitle,
      titleFromText: cleanTitleFromText && !isLikelyPlotDescription(cleanTitleFromText) ? cleanTitleFromText : "",
      titleFromFileName: cleanTitleFromFile && !isLikelyPlotDescription(cleanTitleFromFile) ? cleanTitleFromFile : "",
      originalTitle: resolvedAltTitle ? cleanMediaTitle(resolvedAltTitle) || resolvedAltTitle : null,
      year,
      season,
      episode,
      episodeEnd,
      episodeTitle,
      contextOverview: extractedContextOverview || "",
      quality,
      width: videoWidth,
      height: videoHeight,
      languages,
      subtitles,
      editions: editionInfo.editions,
      editionLabel,
      part: mediaType === "tv" ? 1 : (partInfo.part || 1),
      partNumber: mediaType === "tv" ? 1 : (partInfo.partNumber || partInfo.part || 1),
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
      const rawMsgIdVal = Number(item.message_id || item.msg_id || item.id || 0);
      const msgId = rawMsgIdVal > 0 ? rawMsgIdVal : null;
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
    const isArchiveFile = isArchiveFilenameOrText(raw, rawCaptionText);
    const archMeta = isArchiveFile ? detectArchiveCodecAndPart(raw, rawCaptionText) : null;
    const extractedTagsList = extractMediaReleaseTags(rawCaptionText || raw, raw, durationSec);
    const langInfo = detectLanguages(rawCaptionText, raw);
    const languages = langInfo.languages;
    const subtitles = langInfo.subtitles;
    const editionInfo = extractAndStripEditions(combinedRaw);
    const partInfo = extractPartInfo(rawCaptionText, raw, false);
    const sizeInTextMatch = combinedRaw.match(/\b(\d{1,4}(?:[.,]\d{1,2})?\s*(?:GB|GiB|MB|MiB))\b/i);
    const parsedFileSize = sizeInTextMatch ? parseHumanFileSizeToBytes(sizeInTextMatch[1]) : null;

    // 1. Mehrfache Dateiendungen inkl. Split-Archiv-Endungen entfernen & Text normalisieren (Regel 1 & 4)
    const normalizedRaw = normalizeText(raw);
    const withoutExt = normalizedRaw.replace(/(?:\.part0*\d{1,3})?(?:\.(?:7z|zip|rar|tar)\.0*\d{1,3}|\.(?:mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mk3d|rar|zip|7z|iso|tar|gz|r\d{2,3}|z\d{2,3}|json))+$/i, "");

    // 2. Echte Video-Auflösung via detectVideoQuality (Pixelmaße width/height zuerst, danach Text/Dateiname, niemals blind "1080p" raten!)
    const quality = detectVideoQuality(mediaDimensions || {}, rawCaptionText, raw);

    // 3. Codec extrahieren (x264, x265/HEVC, AV1 oder RAR/ZIP/7Z/ISO/TAR für Archive)
    let codec = isArchiveFile ? (archMeta?.codec || "RAR") : "x264";
    const codecMatch = !isArchiveFile ? combinedRaw.match(/\b(x265|h\.?265|hevc|x264|h\.?264|avc|av1|xvid)\b/i) : null;
    if (codecMatch) {
      const cRaw = codecMatch[1].toLowerCase().replace(/\./g, "");
      if (cRaw === "x265" || cRaw === "h265" || cRaw === "hevc") codec = "x265";
      else if (cRaw === "x264" || cRaw === "h264" || cRaw === "avc") codec = "x264";
      else if (cRaw === "av1") codec = "AV1";
      else codec = codecMatch[1];
    }

    // 4. Part extrahieren (CD1, CD2, Disc 1, DVD 2, Part 1, -001/-002, RAR-PART1..99)
    let part = partInfo ? partInfo.partLabel : null;

    // 5. Nutze Gold-Master parseTelegramMessage Logik für Serien/Episoden, Cross-Check & Datums-Schutz
    const gmParsed = parseTelegramMessage({
      file_name: raw,
      text: rawCaptionText || raw,
      duration_seconds: durationSec,
      width: mediaDimensions?.width || mediaDimensions?.video?.width || null,
      height: mediaDimensions?.height || mediaDimensions?.video?.height || null,
      media_type: isArchiveFile ? "document" : "video_file"
    }, preContext || {});

    if (gmParsed && gmParsed.title && gmParsed.title !== "Unbekannt") {
      const isTvSeries = gmParsed.mediaType === "tv";
      const isArc = Boolean(gmParsed.isArchive || isArchiveFile);
      const resolvedPart = (isTvSeries && !isArc) ? null : ((gmParsed.partInfo && gmParsed.partInfo.partLabel) || part || null);
      return {
        raw,
        cleanTitle: gmParsed.title,
        titleFromText: gmParsed.titleFromText || "",
        titleFromFileName: gmParsed.titleFromFileName || "",
        originalTitle: gmParsed.originalTitle || null,
        year: gmParsed.year || null,
        isSeries: isTvSeries,
        type: isArc ? "archive" : (isTvSeries ? "series" : "movie"),
        isArchive: isArc,
        isDownloadOnly: isArc,
        isBonus: Boolean(gmParsed.isBonus),
        season: gmParsed.season !== undefined && gmParsed.season !== null ? gmParsed.season : null,
        episode: gmParsed.episode || null,
        episodeEnd: gmParsed.episodeEnd || null,
        episodeTitle: gmParsed.episodeTitle || "",
        tmdbId: gmParsed.tmdbId || null,
        imdbId: gmParsed.imdbId || null,
        quality: gmParsed.quality !== undefined ? gmParsed.quality : quality,
        width: gmParsed.width || null,
        height: gmParsed.height || null,
        codec: isArc ? (archMeta?.codec || gmParsed.partInfo?.partType || "RAR") : codec,
        part: resolvedPart,
        partNumber: (isTvSeries && !isArc) ? 1 : (gmParsed.partNumber || gmParsed.partInfo?.part || partInfo?.part || 1),
        partInfo: gmParsed.partInfo || partInfo || null,
        editions: gmParsed.editions || editionInfo.editions || [],
        editionLabel: gmParsed.editionLabel || editionInfo.editionLabel || null,
        tags: extractedTagsList.join(" · "),
        languages,
        subtitles,
        contextOverview: gmParsed.contextOverview || "",
        sourceUsed: gmParsed.sourceUsed || "file_name",
        parsedFileSize
      };
    }

    // Fallback falls gmParsed keinen Treffer ergab
    let isSeries = false;
    let season = null;
    let episode = null;
    let cutIndex = withoutExt.length;
    const isBonusFallback = BONUS_SPECIAL_REGEX.test(`${raw || ""} ${rawCaptionText || ""}`);

    const seRegex = /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i;
    const folgeOnlyRegex = /\b(?:Folge|Episode|Ep\.?)\s*(\d{1,3})\b/i;

    if (!partInfo?.isExplicitMultiPartMovie) {
      const seMatch = withoutExt.match(seRegex);
      if (seMatch) {
        isSeries = true;
        season = isBonusFallback ? 0 : (parseInt(seMatch[1], 10) || 1);
        episode = parseInt(seMatch[2], 10) || 1;
        if (typeof seMatch.index === "number" && seMatch.index > 1) cutIndex = Math.min(cutIndex, seMatch.index);
      } else {
        const mf = withoutExt.match(folgeOnlyRegex);
        if (mf) {
          isSeries = true;
          season = isBonusFallback ? 0 : 1;
          episode = parseInt(mf[1], 10) || 1;
          if (typeof mf.index === "number" && mf.index > 1) cutIndex = Math.min(cutIndex, mf.index);
        }
      }
    }

    let year = null;
    const yearCutoffRes = applyHardYearCutoff(withoutExt);
    if (yearCutoffRes.hadYearCutoff) {
      year = yearCutoffRes.year;
      cutIndex = Math.min(cutIndex, yearCutoffRes.titleBeforeYear.length);
    } else {
      const paddedWithoutExt = ` ${withoutExt} `;
      const yearMatch = paddedWithoutExt.match(YEAR_REGEX);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
        if (typeof yearMatch.index === "number" && yearMatch.index >= 2) {
          cutIndex = Math.min(cutIndex, yearMatch.index - 1);
        }
      }
    }

    let titleCandidate = yearCutoffRes.hadYearCutoff ? yearCutoffRes.titleBeforeYear : withoutExt.slice(0, cutIndex);
    if (!titleCandidate.trim()) titleCandidate = withoutExt;
    const fallbackSplit = splitParenthesizedAltTitle(titleCandidate);
    const cleanTitle = cleanMediaTitle(fallbackSplit.primaryTitle || titleCandidate, { hadYearCutoff: yearCutoffRes.hadYearCutoff }) || cleanMediaTitle(withoutExt) || "Unbekannt";

    return {
      raw,
      cleanTitle,
      titleFromText: "",
      titleFromFileName: cleanTitle,
      originalTitle: fallbackSplit.altTitle ? cleanMediaTitle(fallbackSplit.altTitle) : null,
      year,
      isSeries,
      type: isArchiveFile ? "archive" : (isSeries ? "series" : "movie"),
      isArchive: isArchiveFile,
      isDownloadOnly: isArchiveFile,
      isBonus: isBonusFallback,
      season,
      episode,
      episodeEnd: null,
      episodeTitle: "",
      quality,
      codec,
      part: isSeries ? null : part,
      partNumber: isSeries ? 1 : (partInfo?.part || 1),
      partInfo: partInfo || null,
      editions: editionInfo.editions || [],
      editionLabel: editionInfo.editionLabel || null,
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

  // Prüft die sichtbare Textlänge nach HTML-Parsing (Telegram-Limit: 4096 für Nachrichten, 1024 für Captions)
  // und schneidet NIEMALS mitten durch offene HTML-Tags (<a href=...>, <b>, <blockquote>)!
  function prepareTelegramHtmlPayload(rawMarkdown, maxVisibleLen = 4090) {
    const rawStr = String(rawMarkdown || "");
    const html = mdToHtml(rawStr);
    const visibleLen = html.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, "x").length;
    if (visibleLen <= maxVisibleLen) {
      return { text: html, parse_mode: "HTML" };
    }
    const plain = unescapeMdChars(rawStr.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")).replace(/[*_`]/g, "");
    const safeLimit = Math.max(20, Number(maxVisibleLen) || 4090);
    return {
      text: plain.length > safeLimit ? (plain.slice(0, safeLimit - 3) + "…") : plain,
      parse_mode: undefined
    };
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

  function scheduleBackgroundWork(promiseOrFn) {
    try {
      const p = typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;
      if (!p || typeof p.then !== "function") return;
      const safeP = p.catch(() => {});
      const activeCtx = typeof globalThis !== "undefined" ? globalThis._activeWorkerCtx : null;
      if (activeCtx && typeof activeCtx.waitUntil === "function") {
        activeCtx.waitUntil(safeP);
      }
    } catch (_e) {}
  }

  function buildEdgeCacheKeyRequest(rawUrl) {
    try {
      const u = new URL(String(rawUrl || ""));
      // Geheimnisse (api_key, session_id) niemals im öffentlichen Edge-Cache-Key speichern
      u.searchParams.delete("api_key");
      u.searchParams.delete("session_id");
      return new Request(u.toString(), { method: "GET" });
    } catch (_e) {
      return null;
    }
  }

  function hasTmdbCredentials(env) {
    const activeEnv = env || (typeof globalThis !== "undefined" ? globalThis._activeWorkerEnv : null);
    return Boolean(
      String(activeEnv?.TMDB_BEARER_TOKEN || activeEnv?.TMDB_API_KEY || activeEnv?.TMDB_KEY || "").trim()
    );
  }

  // Synthetische Fallback-IDs (OMDb 100M+, TVMaze 200M+, Wikidata 500M+, Manuell 900M+, >= 8M) existieren NICHT bei TMDb!
  function isRealTmdbId(rawId) {
    const num = Number(rawId);
    return Number.isInteger(num) && num > 0 && num < 8000000;
  }

  function resolveExternalEdgeCacheTtl(rawUrl) {
    const u = String(rawUrl || "");
    if (u.includes("www.youtube.com/oembed") || u.includes("api.kinocheck.com")) {
      return 86400; // 24 Stunden
    }
    if (u.includes("api.themoviedb.org/3/")) {
      // Private/einmalige Auth- & Account-Endpunkte (request_token, session_id, watchlist, favorite) NIEMALS im Edge-Cache speichern!
      if (u.includes("/authentication/") || u.includes("/account") || u.includes("session_id=")) {
        return 0;
      }
      if (u.includes("/discover/") || u.includes("/trending/") || u.includes("/search/")) {
        return 900; // 15 Minuten
      }
      if (u.includes("/images") || u.includes("/videos") || u.includes("/movie/") || u.includes("/tv/") || u.includes("/collection/") || u.includes("/person/")) {
        return 43200; // 12 Stunden
      }
      return 1800; // 30 Minuten
    }
    return 0;
  }

  // --- Fetch mit Timeout, Edge-Cache (caches.default), Subrequest-Circuit-Breaker & TMDb Auth-Normalisierung ---
  async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let targetUrl = String(url || "");
      let effectiveOptions = { ...options };
      const method = String(effectiveOptions.method || "GET").toUpperCase();
      const edgeCacheTtl = method === "GET" && !effectiveOptions._skipEdgeCache
        ? resolveExternalEdgeCacheTtl(targetUrl)
        : 0;
      const edgeCacheApi = (edgeCacheTtl > 0 && typeof caches !== "undefined" && caches && caches.default)
        ? caches.default
        : null;
      const edgeCacheKey = edgeCacheApi ? buildEdgeCacheKeyRequest(targetUrl) : null;

      // 1. Cloudflare Edge Cache (0ms externe Latenz, 0 TMDb-Subrequests!)
      if (edgeCacheApi && edgeCacheKey) {
        try {
          const cachedEdgeRes = await edgeCacheApi.match(edgeCacheKey);
          if (cachedEdgeRes && cachedEdgeRes.ok) {
            clearTimeout(id);
            if (typeof activeWorkerTelemetry === "object" && activeWorkerTelemetry) {
              activeWorkerTelemetry.cacheHit = true;
            }
            return cachedEdgeRes;
          }
        } catch (_cacheErr) {}
      }

      // 2. Harter Subrequest-Circuit-Breaker für Cloudflare Free Plan (50 Subrequests Limit)
      const hardSubrequestCap = effectiveOptions._criticalSubrequest ? 47 : 42;
      if (typeof currentInvocationSubrequests === "number" && currentInvocationSubrequests >= hardSubrequestCap) {
        clearTimeout(id);
        if (typeof subrequestBudgetExhausted !== "undefined") {
          subrequestBudgetExhausted = true;
        }
        return new Response(JSON.stringify({ ok: false, budget_exhausted: true }), {
          status: 429,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }

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
        } else {
          // Weder Bearer-Token noch 32-stelliger Key vorhanden: Ungültige Header entfernen
          delete hdrs.Authorization;
          delete hdrs.authorization;
          // Wenn in der URL auch kein api_key= existiert, bricht der Aufruf direkt ab, um Cloudflare-Subrequests zu schonen
          if (!targetUrl.includes("api_key=")) {
            clearTimeout(id);
            return new Response(JSON.stringify({ status_code: 7, status_message: "Kein TMDb API-Key / Bearer-Token konfiguriert." }), {
              status: 401,
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
          }
        }
        effectiveOptions.headers = hdrs;
      }
      if (!options?._countedSubrequest && typeof currentInvocationSubrequests === "number") {
        currentInvocationSubrequests++;
      }
      const res = await fetch(targetUrl, { ...effectiveOptions, signal: controller.signal });
      clearTimeout(id);

      // Erfolgreiche GET-Antworten asynchron im Cloudflare Edge Cache sichern (blockiert nicht die Antwort)
      if (edgeCacheApi && edgeCacheKey && res && res.ok && edgeCacheTtl > 0) {
        try {
          const resClone = res.clone();
          const cacheHeaders = new Headers(resClone.headers);
          cacheHeaders.set("Cache-Control", `public, max-age=${edgeCacheTtl}`);
          cacheHeaders.delete("Set-Cookie");
          const cacheableRes = new Response(resClone.body, {
            status: resClone.status,
            statusText: resClone.statusText,
            headers: cacheHeaders
          });
          scheduleBackgroundWork(() => edgeCacheApi.put(edgeCacheKey, cacheableRes));
        } catch (_putErr) {}
      }
      return res;
    } catch (err) {
      clearTimeout(id);
      throw err;
    }
  }

  // Kürzt callback_data sicher auf max. 64 UTF-8-Bytes (hartes Telegram Bot API Limit -> verhindert 400 BUTTON_DATA_INVALID!)
  function clampTelegramCallbackData(rawData) {
    const str = String(rawData || "");
    if (!str) return "wl_noop";
    try {
      const enc = new TextEncoder();
      if (enc.encode(str).length <= 64) return str;
      let out = "";
      let usedBytes = 0;
      for (const ch of str) {
        const bLen = enc.encode(ch).length;
        if (usedBytes + bLen > 64) break;
        out += ch;
        usedBytes += bLen;
      }
      return out || "wl_noop";
    } catch (_e) {
      return str.slice(0, 60);
    }
  }

  // Normalisiert Reply-Markup inkl. nativer Telegram Bot API 8.0+ copy_text Buttons (CopyTextButton) & 64-Byte callback_data Schutz
  function sanitizeReplyMarkup(replyMarkup) {
    if (!replyMarkup || !Array.isArray(replyMarkup.inline_keyboard)) return replyMarkup;
    return {
      inline_keyboard: replyMarkup.inline_keyboard.map(row =>
        (Array.isArray(row) ? row : []).map(btn => {
          if (btn && btn.copy_text) {
            const rawCopyText = typeof btn.copy_text === "object" && btn.copy_text !== null
              ? String(btn.copy_text.text || "").trim()
              : String(btn.copy_text || "").trim();
            if (rawCopyText) {
              return {
                text: String(btn.text || "📋 Kopieren"),
                copy_text: { text: rawCopyText.slice(0, 256) }
              };
            }
            return { text: btn.text, callback_data: "info_copy_fallback" };
          }
          if (btn && typeof btn.callback_data === "string") {
            const safeCb = clampTelegramCallbackData(btn.callback_data);
            if (safeCb !== btn.callback_data) {
              return { ...btn, callback_data: safeCb };
            }
          }
          return btn;
        })
      )
    };
  }

