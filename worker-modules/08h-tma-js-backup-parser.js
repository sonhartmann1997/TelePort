      /* @TMA_LAZY_ADMIN_JS_START */
      // =========================================================================
      // ADMIN-PANEL: USER-LISTE, VIP-STATUS TOGGLE, SMART PLAYLIST MANAGER, FILM-CRUD & 100K+ BACKUP-IMPORTER
      // =========================================================================
      let backupImportJob = {
        fileName: "",
        fileSizeMb: "0",
        isTelegramBackup: false,
        backupChatName: "",
        backupChatId: "",
        backupChatUsername: "",
        rawMessageCount: 0,
        repaired: false,
        repairNotes: [],
        detectedMoviesCount: 0,
        detectedSeriesCount: 0,
        duplicatesSkippedInFile: 0,
        qualityVariantsInFile: 0,
        previewSamples: [],
        customPlaylistName: "",
        playlistMode: "both",
        targetPlaylistChatId: "",
        playlistFolderId: "",
        entries: [],
        cursor: 0,
        moviesSaved: 0,
        seriesSaved: 0,
        duplicatesInDb: 0,
        mergedQualitiesInDb: 0,
        uncertainCount: 0,
        failedCount: 0,
        running: false,
        paused: false,
        startedAt: 0,
        recentLog: [],
        livePosterFeed: [],
        reviewItems: [],
        activeSubTab: "dashboard",
        reviewFilter: "needs_attention"
      };

      function flattenClientTgText(tf) {
        if (!tf) return "";
        if (typeof tf === "string") return tf.trim();
        if (Array.isArray(tf)) {
          return tf.map(p => typeof p === "string" ? p : (p && typeof p.text === "string" ? p.text : "")).join("").trim();
        }
        return "";
      }

      function normalizeClientCompareTitle(str) {
        return String(str || "")
          .toLowerCase()
          .replace(/ä/g, "ae")
          .replace(/ö/g, "oe")
          .replace(/ü/g, "ue")
          .replace(/ß/g, "ss")
          .replace(/[^a-z0-9\\s]/g, " ")
          .replace(/\\b(?:der|die|das|the|a|an|ein|eine)\\b/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
      }

      const CLIENT_SERIES_ALIASES = {
        "ahs": "American Horror Story",
        "adtdwv": "Als die Tiere den Wald verließen",
        "gzsz": "Gute Zeiten, schlechte Zeiten",
        "dsds": "Deutschland sucht den Superstar",
        "gntm": "Germany's Next Topmodel",
        "jacob 2 2": "Jacob 2/2",
        "ps profis": "Die PS-Profis",
        "die ps profis": "Die PS-Profis",
        "axel wills wissen": "Axel! will's wissen",
        "axel will's wissen": "Axel! will's wissen",
        "axel! wills wissen": "Axel! will's wissen",
        "maxe baumann": "Maxe Baumann",
        "buffy": "Buffy the Vampire Slayer",
        "himym": "How I Met Your Mother",
        "got": "Game of Thrones",
        "twd": "The Walking Dead",
        "tbbt": "The Big Bang Theory",
        "haus des geldes": "Money Heist",
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
        "e.t. - der ausserirdische": "E.T. – Der Außerirdische",
        "e.t. - der außerirdische": "E.T. – Der Außerirdische",
        "et der ausserirdische": "E.T. – Der Außerirdische",
        "et der außerirdische": "E.T. – Der Außerirdische"
      };

      function detectClientVideoQuality(msg, rawText, rawFileName) {
        const w = Number(msg?.width || msg?.video?.width || 0);
        const h = Number(msg?.height || msg?.video?.height || 0);
        if (w > 0 || h > 0) {
          if (w >= 3800 || h >= 2100) return "2160p";
          if (w >= 1900 || h >= 1000) return "1080p";
          if (w >= 1200 || h >= 700)  return "720p";
          if (w >= 600  || h >= 340)  return "480p";
          return "360p";
        }
        const combined = ((rawText || "") + " " + (rawFileName || "")).toLowerCase();
        if (/\\b(2160p|4k|uhd)\\b/.test(combined)) return "2160p";
        if (/\\b(1080p|fhd|fullhd)\\b/.test(combined)) return "1080p";
        if (/\\b(720p|hd)\\b/.test(combined)) return "720p";
        if (/\\b(480p|576p|sd|dvdrip)\\b/.test(combined)) return "480p";
        return null;
      }

      function getCleanClientContentLines(normalizedText) {
        return String(normalizedText || "")
          .split(/\\r?\\n/)
          .map(l => l.trim())
          .filter(l => {
            if (!l) return false;
            if (/^(?:weitergeleitet|forwarded|kanal|channel|quelle|source|join|abonniert|size|größe|groesse|dateigröße|runtime|laufzeit|dauer|länge|laenge|erscheinungsjahr|produktionsjahr|produktionsland|handlungsjahr|erstausstrahlung|ausstrahlung|premiere|kinostart|tv-start|starttermin|start|genre|gener|studio|regie|director|darsteller|actors|cast|fsk|imdb|tmdb|rating|bewertung|audio|format|codec|qualität|qualitaet|quality|sprache|language|untertitel|subtitles|released|release|preis|free|kostenlos|uncensored)\\b/i.test(l)) return false;
            if (/^(?:[🔞➕+\\s]*(?:12|16|18)\\+?|ab\\s+\\d+\\s+jahren|fsk\\s*\\d+|\\d+(?:[.,]\\d+)?\\s*(?:mb|gb|tb|min|minuten))$/i.test(l)) return false;
            const stripped = l
              .replace(/https?:\\/\\/\\S+/gi, "")
              .replace(/[@#][A-Za-z0-9_äöüÄÖÜß]+/g, "")
              .replace(/[\\u{1F1E6}-\\u{1F1FF}]{2}/gu, "")
              .replace(/[^A-Za-z0-9äöüÄÖÜß]/g, "");
            return stripped.length >= 2 && !/^(?:18|16|12|fsk18|fsk16|fsk12|hd|uhd|4k)$/i.test(stripped);
          });
      }

      function classifyClientJunkReason(msg) {
        if (!msg || typeof msg !== "object") return "🎭 Ungültige Nachricht übersprungen";
        if (msg.type && msg.type !== "message") return "🎭 Service-Nachricht übersprungen";
        const mType = String(msg.media_type || "").toLowerCase();
        if (mType === "sticker" || mType === "animation" || mType === "voice_message" || mType === "audio_file" || mType === "video_message") {
          return "🎭 Sticker / Animation / Sprachnachricht übersprungen";
        }
        const fName = String(msg.file_name || msg.file || "").toLowerCase().trim();
        if (fName === "sticker.webp" || fName.endsWith(".webp") || fName.endsWith(".tgs") || fName.endsWith(".gif.mp4") || fName.endsWith(".gif")) {
          return "🎭 Sticker / GIF-Animation übersprungen";
        }
        // MODUL 2: Alle Archive (.rar, .zip, .7z, .iso, .tar, .gz) sind als Zusatz-Downloads erlaubt!
        if (/\\.(?:rar|zip|7z|iso|tar|gz)$/i.test(fName)) {
          return null;
        }
        // Untertitel (.srt, .vtt, .sub, .ass, .ssa) werden NICHT als Junk verworfen, sondern an das darüberliegende Video gebunden!
        if (/\\.(?:srt|vtt|sub|ass|ssa)$/i.test(fName)) {
          return null;
        }
        if (/\\.(?:idx|mp3|m4a|flac|ogg|wav|opus|aac|apk|exe|msi|dmg|pdf|epub|mobi|txt|nfo|jpg|jpeg|png)$/i.test(fName)) {
          return "📄 Dokument / PDF / Audio / Bilddatei übersprungen";
        }
        const dur = Number(msg.duration_seconds || msg.duration || 0);
        const isVid = mType === "video_file" || /^video\\//i.test(msg.mime_type || "") || /\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d)$/i.test(fName);
        const rawCap = flattenClientTgText(msg.text || msg.caption).slice(0, 220);
        const hasTrailerKeyword = /(?:^|[\\s._\\-(\\[])(?:kinotrailer|official\\s+trailer|offizieller\\s+trailer|teaser\\s+trailer|trailer\\s+(?:german|deutsch|englisch|english|hd|full\\s*hd|1080p|720p|4k)|trailer|teaser|coming\\s+soon|zwiastun|vorschau)(?=$|[\\s._\\-)\\]:])/i.test(fName) ||
          /^(?:trailer|teaser|coming\\s+soon)\\b/i.test(rawCap) ||
          /\\b(?:official\\s+trailer|offizieller\\s+trailer|kinotrailer|teaser\\s+trailer|trailer\\s+(?:german|deutsch)|(?:\\(|\\[)\\s*trailer\\b|coming\\s+soon)\\b/i.test(rawCap);
        if (hasTrailerKeyword && (!dur || dur < 900)) {
          return "🎬 Trailer / Teaser / Coming Soon übersprungen";
        }
        // Videos ohne "Trailer" im Namen sind ab 60 Sekunden erlaubt (rettet Star Wars: Die Mächte des Schicksals & One Piece Strohhut Theater!)
        if (isVid && dur > 0 && dur < 60) {
          return "🎭 Kurzclip (< 60s) übersprungen";
        }
        const isPhoto = Boolean(msg.photo || mType === "photo" || /^image\\//i.test(msg.mime_type || ""));
        if (!isVid && !isPhoto && !fName && rawCap) {
          const cleanCap = rawCap.trim();
          if (cleanCap.length <= 60 && /(?:^|\\b)(?:hahaha+|hihi+|lol+|rofl|haha+\\s+bruder|bruder\\b|danke\\s+dir|vielen\\s+dank)(?:\\b|$)/i.test(cleanCap)) {
            return "💬 Chat-Kommentar übersprungen";
          }
        }
        return null;
      }

      function isClientJunkOrSticker(msg) {
        return Boolean(classifyClientJunkReason(msg));
      }

      const CLIENT_OFFICIAL_HYPHEN_TITLE_PREFIXES = new Set([
        "x-men", "a-team", "k-pax", "g-force", "u-571", "k-19", "t-rex", "v-wars",
        "wall-e", "spider-man", "ant-man", "kick-ass", "non-stop", "hi-hi"
      ]);

      function stripClientSceneGroupPrefix(str) {
        if (!str) return "";
        const s = String(str).trim();
        const m = s.match(/^([a-z]{2,6})-([a-z0-9._-]+)$/i);
        if (!m) return s;
        const prefix = m[1].toLowerCase();
        const restFirstToken = m[2].split(/[._-]/)[0].toLowerCase();
        const hyphenCandidate = prefix + "-" + restFirstToken;
        if (CLIENT_OFFICIAL_HYPHEN_TITLE_PREFIXES.has(hyphenCandidate)) return s;
        if (
          /^[a-z]{2,6}-[a-z0-9._-]+$/.test(s) ||
          /^(?:cyd|cd|nge|inkl|vs|spy|4sf|arc|tvp|itg|sot|wdc|fgt|rarbg|yts|psa|evo|ntb|play|flt|skidrow|codex|rune)$/i.test(prefix)
        ) {
          return m[2];
        }
        return s;
      }

      function normalizeClientGermanAsciiUmlauts(str) {
        if (!str) return "";
        return String(str).replace(/\\b([A-Za-zÄÖÜäöüß]+)\\b/g, (word) => {
          const low = word.toLowerCase();
          if (!/(?:ae|oe|ue)/.test(low)) return word;
          if (
            /(?:blue|true|clue|glue|flue|due|sue|cue|issue|value|statue|rescue|continue|avenue|league|colleague|rogue|vogue|plague|vague|intrig|fatig|unigue|unique|opaque|baroque|utorrent|duell|aktuell|eventuell|individuell|virtuell|visuell|sexuell|manuell|rituell|intellektuell|spirituell|konzeptuell|graduell|punktuell|textuell|kontextuell|sensuell|habituel|cruel|fuel|duel|feud|zeus|museum|kolosseum|linoleum|petroleum|jubileum|mausoleum|atheist|poet|poesie|noel|joel|israel|michael|raphael|gabriel|samuel|emanuel|manuel|daniel|nathaniel|gael|aerob|aero|maestro|paella|caesar|daemon|phoenix|boeing|cohen|koexist|koeduk|kooper|koordin|koalition|koeffizient|bauern|mauer|trauer|schauer|dauer|lauer|sauer|knauer|hauer|power|tower|shower|flower|abenteuer|ungeheuer|feuer|steuer|teuer|heuer|scheuer|neuer|treue|reue|freuen|freude|freund|feind|euer|eure|euern|eurem|euren|neuen|neue|neuer|neues|neuem|blauen|blaue|blauer|blaues|blauem|grauen|graue|grauer|graues|grauem|schlauen|schlaue|schlauer|frau|frauen|bauen|schauen|hauen|kauen|trauen|vertrauen|brauen|klauen|tauen|stauen|verdauen|genaue|genauen|genauer|genaues|zuschauer)$/i.test(low)
          ) {
            return word;
          }
          if (
            /(?:faeust|faeus|fuer|fues|fuell|fuenf|fuehr|fuehl|furcht|brued|mued|sued|suend|gruen|gruend|glueck|zurueck|stueck|drueck|brueck|rueck|lueg|flueg|pflueg|zueg|anzueg|aufzueg|auszueg|umzueg|vorzueg|kuehl|kuehn|kuech|kuest|kuenst|kuend|kuenft|koenig|koenn|koerp|voegel|moeg|moecht|moerd|hoell|hoer|gehoer|stoer|zerstoer|schwoer|empfohl|woelf|zwoelf|loew|loes|loeffel|oeffn|oel|schluessel|schuessel|kuesse|kuess|muess|muesst|fluesse|fluess|nuesse|nuess|gruss|gruess|fuess|suess|buess|wuest|wuesst|duester|fluester|ruest|geruest|bruest|geluest|hueft|huegel|huebsch|huette|huet|schuetz|stuetz|nuetz|pfuetz|muetz|schueler|spuel|wuehl|kuehl|gefuehl|schwuere|schwuel|bluet|bluete|guet|guelt|huend|buend|muend|stuend|gruend|zuend|kuend|suend|wuensch|muench|muenz|kuerz|stuerz|wuerz|schuerz|fuerst|duerf|beduerf|wuerf|entwuerf|wuerd|wuerdig|wuerg|buerg|buero|tuer|tueren|tuerk|natuerlich|spuer|schnuer|schuer|geschwuer|gebuehr|verfuehr|entfuehr|auffuehr|ausfuehr|durchfuehr|einfuehr|beruehr|ruehr|jaeger|kaefer|kaefig|kaempf|kaese|kaelt|waerm|waehl|zaehl|itaet|paedagog|aehnlich|aendern|aerger|aermel|aerzt|aeuss|baecker|baer|baender|baend|blaetter|braeut|daemmer|daempf|daem|draeng|faehig|faehr|faell|faelsch|faerb|gaert|gaest|gefaehr|gefaeng|gefaess|gebaerd|gebaeu|gemaeld|gepaeck|gespraech|getraenk|gewaehr|gewaess|glaeser|glaeub|graeb|graef|haeft|haelft|haals|haeng|haert|haesslich|haeuf|haeus|haelt|jaehrlich|kaemm|klaer|klaeng|kraeft|kraeh|laechel|laehm|laend|laeng|laerm|laess|laeuf|maecht|maedchen|maerchen|maerz|maessig|maenn|maeus|naechst|naecht|naeh|naehr|naegel|itaet|plaene|plaetz|praeg|praesident|raech|raeum|raetsel|saenger|saeug|saeul|schaed|schaef|schael|schaem|schaer|schaetz|schlaef|schlaeg|schlaeuch|schwaech|schwaerz|schwaeger|spaet|staedt|staend|staerk|staett|straehn|taet|taeter|taeusch|traog|traeg|traenen|traeum|vaeter|verraet|waecht|waend|waesch|zaehn|zaert)/i.test(low)
          ) {
            return word
              .replace(/ae/g, "ä").replace(/oe/g, "ö").replace(/ue/g, "ü")
              .replace(/Ae/g, "Ä").replace(/Oe/g, "Ö").replace(/Ue/g, "Ü")
              .replace(/AE/g, "Ä").replace(/OE/g, "Ö").replace(/UE/g, "Ü");
          }
          return word;
        });
      }

      function extractClientEditionInfo(rawStr) {
        if (!rawStr) return { cleanStr: "", editionLabel: null };
        let editionLabel = null;
        const s = String(rawStr).replace(
          /\\b(super[\\s._-]*duper[\\s._-]*cut|extended[\\s._-]*director'?s?[\\s._-]*cut|director'?s?[\\s._-]*cut|extended[\\s._-]*(?:cut|edition|version)|special[\\s._-]*(?:edition|cut)|ultimate[\\s._-]*(?:cut|edition)|theatrical[\\s._-]*cut|final[\\s._-]*cut|unrated[\\s._-]*(?:cut|edition)?|uncut[\\s._-]*(?:edition|version)?|dc)\\b/gi,
          (match) => {
            if (!editionLabel) {
              const low = match.toLowerCase();
              if (low === "dc" || low.includes("director")) editionLabel = "Director's Cut";
              else if (low.includes("extended")) editionLabel = "Extended Edition";
              else if (low.includes("special")) editionLabel = "Special Edition";
              else if (low.includes("ultimate")) editionLabel = "Ultimate Cut";
              else if (low.includes("unrated")) editionLabel = "Unrated";
              else if (low.includes("uncut")) editionLabel = "Uncut";
              else editionLabel = match.trim();
            }
            return " ";
          }
        );
        return { cleanStr: s, editionLabel };
      }

      function splitClientParenthesizedAltTitle(titleStr) {
        if (!titleStr) return { primaryTitle: "", altTitle: null };
        const s = String(titleStr).trim();
        const m = s.match(/^(.{2,}?)\\s*\\(([^()]{3,80})\\)\\s*$/);
        if (!m) return { primaryTitle: s, altTitle: null };
        const left = m[1].trim();
        const inside = m[2].trim();
        if (
          /^(?:19\\d{2}|20\\d{2}|de|en|fr|es|it|ger|eng|ddr|brd|usa|uk|cut|dc|uncut|unrated|extended|4k|uhd|hd|1080p|720p|ova|ona|tv|movie|film|serie|teil\\s*\\d+|part\\s*\\d+|cd\\s*\\d+)$/i.test(inside)
        ) {
          return { primaryTitle: s, altTitle: null };
        }
        return { primaryTitle: left, altTitle: inside };
      }

      function extractClientPartInfo(rawText, rawFileName, durationSec = 0) {
        const rawFnStr = String(rawFileName || "").trim();
        const combinedRaw = (rawFnStr + " " + String(rawText || "")).trim();
        const isArchive = /\\.(?:rar|zip|7z|iso|tar|gz|r\\d{2}|z\\d{2})$|\\.(?:7z|zip|rar)\\.\\d{3}$/i.test(rawFnStr) ||
          /(?:\\.part\\d+\\.rar|\\.(?:7z|zip|rar)\\.\\d{3}|\\.[rz]\\d{2})\\b/i.test(combinedRaw);
        if (isArchive) {
          let archType = "RAR";
          if (/\\.(?:zip|z\\d{2})(?:\\.\\d{3})?$/i.test(rawFnStr)) archType = "ZIP";
          else if (/\\.7z(?:\\.\\d{3})?$/i.test(rawFnStr)) archType = "7Z";
          else if (/\\.iso$/i.test(rawFnStr)) archType = "ISO";
          else if (/\\.(?:tar|gz)$/i.test(rawFnStr)) archType = "TAR";
          const rarPartMatch = combinedRaw.match(/(?:\\.part|\\bpart)[\\s._-]*0*([1-9]\\d?)\\b/i);
          if (rarPartMatch) {
            const num = parseInt(rarPartMatch[1], 10);
            return { isMultiPart: true, isArchive: true, isDownloadOnly: true, partNumber: num, partType: archType, partLabel: archType + "-PART" + num };
          }
          const splitExtNumMatch = rawFnStr.match(/\\.(?:7z|zip|rar)\\.0*([1-9]\\d{0,2})$/i);
          if (splitExtNumMatch) {
            const num = parseInt(splitExtNumMatch[1], 10);
            return { isMultiPart: true, isArchive: true, isDownloadOnly: true, partNumber: num, partType: archType, partLabel: archType + "-PART" + num };
          }
          const rVolMatch = rawFnStr.match(/\\.r0*(\\d{1,2})$/i);
          if (rVolMatch) {
            const num = parseInt(rVolMatch[1], 10) + 2;
            return { isMultiPart: true, isArchive: true, isDownloadOnly: true, partNumber: num, partType: "RAR", partLabel: "RAR-PART" + num };
          }
          const zVolMatch = rawFnStr.match(/\\.z0*([1-9]\\d?)$/i);
          if (zVolMatch) {
            const num = parseInt(zVolMatch[1], 10);
            return { isMultiPart: true, isArchive: true, isDownloadOnly: true, partNumber: num, partType: "ZIP", partLabel: "ZIP-PART" + num };
          }
          return { isMultiPart: false, isArchive: true, isDownloadOnly: true, partNumber: 1, partType: archType, partLabel: archType };
        }
        const fn = rawFnStr.replace(/(?:\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d))+$/i, "");
        const combined = (fn + " " + String(rawText || "")).trim();
        const cdMatch = combined.match(/\\b(CD|Disc|Disk|DVD|Split)[\\s._-]*0*([1-4])\\b/i);
        if (cdMatch) {
          const num = parseInt(cdMatch[2], 10);
          return { isMultiPart: true, isArchive: false, isDownloadOnly: false, partNumber: num, partType: "CD", partLabel: "CD " + num };
        }
        const splitMatch = fn.match(/-(00[1-4])$/);
        if (splitMatch) {
          const num = parseInt(splitMatch[1], 10);
          return { isMultiPart: true, isArchive: false, isDownloadOnly: false, partNumber: num, partType: "CD", partLabel: "CD " + num };
        }
        // "01 (YYYY)" / "02 (YYYY)" direkt vor Jahreszahl ("The Postman 01 (1997)")
        const preYearSplitMatch = combined.match(/\\b0([1-4])\\s*\\(\\s*(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?:19[2-9]\\d|20[0-2]\\d)\\s*\\)/i);
        if (preYearSplitMatch) {
          const num = parseInt(preYearSplitMatch[1], 10);
          return { isMultiPart: true, isArchive: false, isDownloadOnly: false, partNumber: num, partType: "CD", partLabel: "CD " + num };
        }
        // MODUL 5: Part/Teil NACH der Jahreszahl ("Hogfather - 2006 - Part 2.mp4") -> echter Datei-Split (CD)
        const postYearPartMatch = combined.match(/\\b(?:19[2-9]\\d|20[0-2]\\d)\\b[\\s._\\-()\\[\\]]+(?:Part|Teil|Film)[\\s._-]*0*([1-4])\\b/i);
        if (postYearPartMatch) {
          const num = parseInt(postYearPartMatch[1], 10);
          return { isMultiPart: true, isArchive: false, isDownloadOnly: false, partNumber: num, partType: "CD", partLabel: "CD " + num };
        }
        return null;
      }

      function normalizeClientEpisodeText(str) {
        if (!str) return "";
        // MODUL 4.1: NFC-Normalisierung ganz am Anfang erzwingen ("u\\u0308" -> "ü" in "Ein Rezept für die Liebe")
        let s = String(str)
          .normalize("NFC")
          .replace(/%26/gi, "&")
          .replace(/%20/g, " ")
          .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
          .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
          .replace(/\\u1D34\\u1D30/g, " HD ")
          .replace(/\\u2074\\u1D37/g, " 4K ");
        // MODUL 4.2: Kanal-Tags & Uploader-Wasserzeichen VOR der _-Ersetzung entfernen (@German_Vid, @ GERMAN MOVIES_, @movies)
        s = s
          .replace(/^@\\s*(?:german[\\s._-]*(?:movies?|vid(?:eo)?s?)|[\\w.-]+)[\\s_:\\-]*/gi, " ")
          .replace(/^@\\s*movies\\s+/gi, " ")
          .replace(/\\b(?:german[\\s._-]+(?:movies?|vid(?:eo)?s?)|@[\\w.-]+)\\b/gi, " ");
        s = Array.from(s).map(ch => {
          return (ch.charCodeAt(0) > 127 && !"äöüÄÖÜßéèêàáâóòôúùûíìîçñøåÆØÅ–—„“”’´‧·".includes(ch))
            ? ch.normalize("NFKD")
            : ch;
        }).join("").normalize("NFC");
        s = s.replace(/[\\p{Script=Arabic}\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF،؛؟]+/gu, " ")
          .replace(/󠄿/g, "")
          .replace(/_/g, " ")
          .replace(/[\\u00A0 \\t]+/g, " ");
        // MODUL 4.1: Globale Umlaut-Konvertierung (/g) für "Vier Faeuste fuer ein Halleluja"
        s = normalizeClientGermanAsciiUmlauts(s);
        // Senkrechte Striche als römische Zahlen am Wortende umwandeln ("Creed |||" -> "Creed III")
        s = s.replace(/(?<=[A-Za-zÄÖÜäöüß])\\s+(\\|{2,3})(?=$|[\\s)\\]._-])/g, (_, pipes) => pipes.length === 3 ? " III" : " II");
        // Regel 1: Episoden-Muster in S01E01 umwandeln
        s = s.replace(/\\b(?:Staffel|Season)\\s*0*(\\d{1,2})\\s*(?:[-–,·‧:|\\/]|\\s)+\\s*(?:Folge|Episode|Ep\\.?|Teil|Part)\\s*0*(\\d{1,3})(?!\\s*[-–]\\s*\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/\\bS0*(\\d{1,2})\\s*[-–]\\s*E0*(\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/\\bS0*(\\d{1,2})\\s+E0*(\\d{1,3})\\b/gi, (_, st, ep) => "S" + String(st).padStart(2, "0") + "E" + String(ep).padStart(2, "0"));
        s = s.replace(/(?<![\\d.])\\b0*(\\d{1,2})x0*(\\d{2,3})\\b(?![\\d.])/gi, (_, st, ep) => {
          const stNum = parseInt(st, 10);
          const epNum = parseInt(ep, 10);
          if (stNum >= 1 && stNum <= 40 && epNum >= 1 && epNum <= 250) {
            return "S" + String(stNum).padStart(2, "0") + "E" + String(epNum).padStart(2, "0");
          }
          return _;
        });
        // Mittelpunkt-Episodenschema: "Maxe Baumann · 01 Ferien ohne Ende" -> "Maxe Baumann S01E01 Ferien ohne Ende"
        s = s.replace(/([A-Za-zÄÖÜäöüß]{2,})\\s+[·‧•]\\s+0*(\\d{1,2})\\s+([A-Za-zÄÖÜäöüß])/g, (_, name, ep, nextChar) => {
          return name + " S01E" + String(ep).padStart(2, "0") + " " + nextChar;
        });
        // "Strohhut Theater 1 - Chopper Man" -> "Strohhut Theater S01E01 - Chopper Man" & "Folgen 1 - 10" -> "S01E01-E10"
        s = s.replace(/\\b(Strohhut[\\s._-]+Theater)[\\s._-]+0*([1-9]\\d?)\\b/gi, (_, name, ep) => {
          return name + " S01E" + String(parseInt(ep, 10)).padStart(2, "0");
        });
        s = s.replace(/\\b(?:Folgen|Folge|Episoden|Episodes)[\\s._-]*0*(\\d{1,3})\\s*[-–]\\s*0*(\\d{1,3})\\b/gi, (_, ep1, ep2) => {
          return "S01E" + String(parseInt(ep1, 10)).padStart(2, "0") + "-E" + String(parseInt(ep2, 10)).padStart(2, "0");
        });
        return s;
      }

      function isLikelyClientPlotDescription(str) {
        const s = String(str || "").trim();
        if (!s) return false;
        if (s.length > 120) return true;
        const words = s.split(/\\s+/).filter(Boolean);
        if (words.length > 15) return true;
        if (/[.!?]\\s+[A-ZÄÖÜ]/.test(s) && words.length > 9) return true;
        return false;
      }

      function applyClientHardYearCutoff(rawString) {
        if (!rawString) return { titleBeforeYear: "", year: null, hadYearCutoff: false };
        const s = String(rawString).replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
        const parenMatch = s.match(/^(.*?)\\s*[\\(\\[]\\s*(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(19[2-9]\\d|20[0-2]\\d)(?:\\s*[-–—/bis]+\\s*(?:19[2-9]\\d|20[0-2]\\d|heute|present)?)?\\s*[\\)\\]](.*)$/i);
        if (parenMatch && parenMatch[1] && parenMatch[1].trim().length >= 2) {
          return { titleBeforeYear: parenMatch[1].trim(), year: parseInt(parenMatch[2], 10), hadYearCutoff: true };
        }
        const yearCutMatch = s.match(/^(.*?)(?:[\\s._\\-(\\[\\]]+)(19[2-9]\\d|20[0-2]\\d)(?=[\\s._\\-\\)\\]]|(?:SiFi|SciFi|Sci-Fi|Action|Comedy|Komödie|Komoedie|Drama|Crime|Krimi|Thriller|Horror|Abenteuer|Adventure|Krieg|Geschichte|History|Fantasy|Animation|Familie|Romantik|Romance|Mystery|Western|Musik|Doku|Dokumentation|HD|FullHD|FHD|UHD|4K|1080p|720p|480p|German|Deutsch|DE|EN|AC3|DTS|x264|x265|264|265|XviD|DivX|mp4|mkv|avi|$))/i);
        if (yearCutMatch && yearCutMatch[1] && yearCutMatch[1].trim().length >= 2) {
          return { titleBeforeYear: yearCutMatch[1].trim(), year: parseInt(yearCutMatch[2], 10), hadYearCutoff: true };
        }
        return { titleBeforeYear: s, year: null, hadYearCutoff: false };
      }

      function cleanClientMediaTitle(raw, opts = {}) {
        if (!raw) return "";
        const rawTrimmed = String(raw)
          .normalize("NFC")
          .replace(/(?:\\.part0*\\d{1,3}\\.rar|\\.(?:7z|zip|rar)\\.0*\\d{1,3}|\\.[rz]\\d{2,3}|\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d|rar|zip|7z|iso|tar|gz|json))+$/i, "")
          .trim();
        const sceneCleaned = stripClientSceneGroupPrefix(rawTrimmed);
        let t = normalizeClientEpisodeText(sceneCleaned)
          .replace(/(?:\\.part0*\\d{1,3}\\.rar|\\.(?:7z|zip|rar)\\.0*\\d{1,3}|\\.[rz]\\d{2,3}|\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d|rar|zip|7z|iso|tar|gz|json))+$/i, "");
        // Twilight Saga (4.1) / (4.2) Spezial-Regel: eigene Kinofilme ("Breaking Dawn - Teil 1" / "Teil 2")
        if (/twilight/i.test(t) && /breaking[\\s._-]*dawn/i.test(t)) {
          t = t.replace(/^(?:the\\s+)?twilight[\\s._-]*saga[\\s._()-]*(?:0?[1-5]|complete)?[\\s._\\-:)]*/i, "");
          t = t.replace(/[\\s._()-]*\\b4\\.?1\\b[\\s._()-]*/g, " - Teil 1 ");
          t = t.replace(/[\\s._()-]*\\b4\\.?2\\b[\\s._()-]*/g, " - Teil 2 ");
        } else if (/^(?:the\\s+)?twilight[\\s._-]*saga[\\s._-]*0*[1-3]\\b/i.test(t)) {
          t = t.replace(/^(?:the\\s+)?twilight[\\s._-]*saga[\\s._-]*0*[1-3][\\s._\\-:]*/i, "");
        }
        t = t.replace(/\\(\\s*\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\s*\\)/g, " ");
        t = t.replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
        t = t.replace(/\\b0[1-4](?=\\s*[\\(\\[]\\s*(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(?:19[2-9]\\d|20[0-2]\\d)\\s*[\\)\\]])/gi, " ");
        const cutoffRes = applyClientHardYearCutoff(t);
        const hadYearCutoff = Boolean(opts.hadYearCutoff || cutoffRes.hadYearCutoff);
        if (cutoffRes.hadYearCutoff && cutoffRes.titleBeforeYear) {
          t = cutoffRes.titleBeforeYear;
        }
        t = t.replace(/[\\(\\[]?\\s*(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(?:19[2-9]\\d|20[0-2]\\d)\\s*[-–—/bis]+\\s*(?:19[2-9]\\d|20[0-2]\\d|heute|present)\\s*[\\)\\]]?/gi, " ");
        t = t.replace(/[\\(\\[]\\s*(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(?:19[2-9]\\d|20[0-2]\\d)\\s*[-–—]?\\s*[\\)\\]]/gi, " ");
        t = t.replace(/\\b(?:AC3D?|EAC3|AAC|DTS|DDP?)[\\s._-]*(?:5\\.1|7\\.1|2\\.0)\\b/gi, " ");
        t = t.replace(/\\b(?:XViD|DivX|x264|x265|H\\.?264|H\\.?265|HEVC|BDRiP|BRRiP|DVDRiP|WEBRiP|WEB-DL)-[A-Za-z0-9]{2,12}\\b/gi, " ");
        if (((t.match(/\\./g) || []).length >= 2 || /[A-Za-zÄÖÜäöüß]{2,}\\.[A-Za-zÄÖÜäöüß0-9]{2,}/.test(t)) && !/^(?:e\\.t\\.?|a\\.d\\.?|o\\.c\\.?|l\\.a\\.?|k\\.o\\.?|s\\.h\\.i\\.e\\.l\\.d\\.?)$/i.test(t.trim())) {
          t = t.replace(/(?<=[A-Za-zÄÖÜäöüß0-9]{2})\\.(?=[A-Za-zÄÖÜäöüß0-9])/g, " ")
               .replace(/(?<=[A-Za-zÄÖÜäöüß0-9])\\.(?=[A-Za-zÄÖÜäöüß0-9]{2})/g, " ");
        }
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:ger|deu|german|deutsch|eng|english|englisch|jap|jpn|fr|fra|es|spa|it|ita|tr|tur|ru|rus)[\\s._-]+(?:ger|deu|eng|jap|jpn|fr|es|it|tr|ru)[\\s._-]+(?:sub|subs|dub|dubbed)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:ger|deu|german|deutsch|eng|english|englisch|jap|jpn|japanisch|fr|fra|es|spa|it|ita|tr|tur|ru|rus)[\\s._-]+(?:sub|subs|ut|untertitel|dub|dubbed|forced)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/(?:AC3|AAC|DTS|DD5\\.?1)?[\\s._-]*(?:CD|Disc|Disk|DVD|Split)[\\s._-]*0*[1-9]\\b/gi, " ");
        // MODUL 5.1: Wenn "Teil 2" oder "Part 2" VOR der Jahreszahl stand (hadYearCutoff === true, z.B. "Mockingjay Teil 2 (2015)"),
        // gehört es zwingend zum Filmtitel und darf NIEMALS weggeschnitten werden!
        if (!hadYearCutoff) {
          t = t.replace(/(?:^|[\\s._\\-(])(?:Part|Pt)[\\s._-]*0*([1-9]\\d?)(?:$|[\\s._\\-)])/gi, " ");
        }
        // Nur echte Split-Archiv-Endungen (-001 bis -004 am Ende) entfernen, NIEMALS "007" in "James Bond 007"!
        t = t.replace(/(?:[-_.]|\\s)00[1-4]\\s*$/gi, " ");
        t = t.replace(/[\\u{1F1E6}-\\u{1F1FF}]{2}/gu, "");
        t = t.replace(/[《》«»⟨⟩]/g, " ");
        t = t.replace(/^[🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎➡️▶️🍿⭐️❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️\\s]+/gu, "");
        t = t.replace(/[↩️🔠🔢⤴️⬅️➡️🎦]+.*$/gu, "");
        t = t.replace(/[\\p{Emoji_Presentation}\\p{Extended_Pictographic}🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎🩸❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️]/gu, " ");
        t = t.replace(/@[A-Za-z0-9_.-]+/g, "");
        t = t.replace(/#(?:gutfilm|archemovie|filmwelt|weltderfilme|sauerkraut|hd|fullhd|fhd|uhd|4k|1080p|720p|480p|deutsch|german|kino|serie|serien|film|filme|neu|new|stream|download|vip|ov|omu|horror|action|comedy|thriller|drama|scifi|sifi|fantasy|anime)\\b/gi, " ");
        t = t.replace(/#(?=[A-Za-zÄÖÜäöüß0-9])/g, " ");
        t = t.replace(/s[\\._]to\\s*-?\\s*Serien.*/i, "").replace(/Sto\\s*-\\s*Serien.*/i, "");
        t = t.replace(/serien[\\._](?:life|show).*/i, "").replace(/HD\\s*Filme\\s*Serien.*/i, "");
        t = t.replace(/^(?:Title|Titel)\\s*:\\s*/i, "").replace(/^(?:vs-|cyd-|cd-|nge-|inkl-|spy-|d-|4sf-|arc-|tvp-)/i, "");
        t = t.replace(/^(?:disney'?s|disneys|marvel'?s|marvels|pixar'?s|pixars)\\s+/i, "");
        t = t.replace(/^(?:s\\d{1,2}[\\s._-]*e\\d{1,3}|e\\d{1,3}[\\s._-]*s\\d{1,2}|\\d{1,2}x\\d{1,3})\\b[\\s._\\-–:]*/i, "");
        t = t.replace(/\\bS\\d{1,2}\\s*E\\d{0,3}(?=[A-Za-z]|\\b)/gi, " ");
        t = t.replace(/\\b\\d{3,4}\\s*[x×]\\s*\\d{3,4}\\b/g, "");
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(?:super[\\s._-]*duper[\\s._-]*cut|extended[\\s._-]*director'?s?[\\s._-]*cut|(?:extended|director'?s?|director’s|theatrical|ultimate|final|special|unrated|uncut|recut|producer'?s?|television|tv|fan|snyder|remastered|restored|collector'?s?|collector’s|anniversary|limited|deluxe|diamond|platinum|imax|open[\\s._-]*matte|international|rough|workprint)[\\s._-]*(?:cut|edition|version|fassung|ed\\.?)|(?:kino|lang|kurz|fernseh|tv|schnitt|rohschnitt|farb|original|alternativ|jubiläums|jubilaeums|directors|extended|uncut|unrated)[\\s._-]*(?:fassung|version|edition|cut)|(?:4k[\\s._-]*)?(?:digitally[\\s._-]*)?(?:remastered|restored)|mastered[\\s._-]*in[\\s._-]*4k|open[\\s._-]*matte|3d|hsbs|sbs|hou)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/(?<![A-Za-zÄÖÜäöüß0-9])(1080p|720p|2160p|480p|4k|uhd|h265|h264|x264|x265|264|265|hevc|av1|xvid(?:-[a-z0-9]{2,12})?|divx|10bit|de-en|en-de|de-fr|fr-de|de-es|es-de|de-it|it-de|de-tr|tr-de|de-ru|ru-de|de-ja|de-jp|german|deutsch|germany|deu|ger|englisch|english|eng|französisch|franzoesisch|french|fra|fre|vff|vf|(?<!grundkurs\\s+)(?:spanisch|spanish)|spa|esp|castellano|latino|italienisch|italian|ita|türkisch|tuerkisch|turkish|tur|russisch|russian|rus|japanisch|japanese|jap|jpn|koreanisch|korean|kor|dl|dual[\\s._-]*audio|dual|multi|multilang|(?<!world\\s+wide\\s+)web|web-dl|webrip|bluray|bdrip|brrip|dvdrip|dvdscr|hdrip|remux|fullhd|fhd|microhd(?:\\s*720|\\s*1080)?|hd|sd|dt__ov|dt[\\s._-]*ov|ov|omu|omeu|oton|originalton|gerdub|engdub|japdub|gersub|engsub|softsub|hardsub|subbed|forced|germanforced|extended[\\s._-]*cut|director'?s?[\\s._-]*cut|theatrical[\\s._-]*cut|ultimate[\\s._-]*cut|final[\\s._-]*cut|special[\\s._-]*(?:cut|edition)|collector'?s?[\\s._-]*edition|extended[\\s._-]*(?:edition|version)|uncut[\\s._-]*(?:edition|version)?|unrated[\\s._-]*(?:cut|edition|version)?|farbfassung|langfassung|kinofassung|fernsehfassung|schnittfassung|remastered|restored|uncut|unrated|extended|recut|ac3d|ac3|eac3|dts|dd5\\.?1|5\\.1|7\\.1|aac|6ch|proper|repack|limited|mp4|mkv|avi|m4v|flv|mk3d|rar|zip|7z|iso|tar|gz|archemovie|gutfilm|filmwelt|weltderfilme|sauerkraut|wayne|wvf|dollhead|empir|tvnation|contribution|vivo|watch|camrip|cam-rip|hdcam|hd-cam|ts-cam)(?![A-Za-zÄÖÜäöüß0-9])/gi, " ");
        t = t.replace(/[\\(\\[]\\s*(?:the\\s+)?(?:cut|dc|edition|version|fassung)\\s*[\\)\\]]/gi, " ");
        t = t.replace(/[\\(\\[]\\s*\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s*[\\)\\]]/gi, " ");
        t = t.replace(/^(.{2,}?)\\s+(?:[-–:]\\s*)?(?:the\\s+)?(?:cut|dc|edition|version|fassung|redux)\\s*$/i, "$1");
        t = t.replace(/\\s*[-–:]\\s*(?:the|der|die|das)\\s*$/i, "");
        // MODUL 4.3: Strikte Wortgrenzen \\b bei Sprachkürzeln (verhindert "Pin" statt "Pines" und "Fenc" statt "Fences")
        t = t.replace(/[\\(\\[]\\s*\\b(?:DE|De|de|EN|FR|ES|IT|TR|RU|JA|KO|DDR|BRD)\\b\\s*[\\)\\]]/g, " ");
        t = t.replace(/(?:[-_]\\s*|\\s+)\\b(?:DE|De|EN|FR|ES|IT|TR|RU|JA|KO|DDR|BRD)\\b(?=\\s*$)/g, " ");
        t = t.replace(/^(?:\\d{1,4}\\.\\s+|0\\d\\s*[-–]\\s+)/, "").replace(/-\\d{3}$/, "");
        t = t.replace(/[\\(\\[]\\s*[-–—/:.,;]*\\s*[\\)\\]]/g, " ");
        t = t.replace(/\\s+/g, " ").replace(/^[\\s\\-–·‧:.,#"=|⎪&]+|[\\s\\-–·‧:.,#"=|⎪&]+$/g, "");
        if (/^(?:[A-Za-zÄÖÜäöüß]\\s+){3,}[A-Za-zÄÖÜäöüß]$/.test(t)) {
          t = t.replace(/\\s+/g, "");
        }
        t = t.replace(/\\b([A-Za-zÄÖÜäöüß]{3,})\\s+\\1\\b/gi, "$1");
        const openParens = (t.match(/\\(/g) || []).length;
        const closeParens = (t.match(/\\)/g) || []).length;
        if (openParens > closeParens) t = t.replace(/\\(/g, "");
        if (closeParens > openParens) t = t.replace(/\\)/g, "");
        t = t.replace(/\\s+/g, " ").trim();
        if (!/[A-Za-zÄÖÜäöüß0-9]/.test(t)) return "";
        if (/^(?:video|vmp4|new+|file|clip|movie|stream)$/i.test(t)) return "";
        const lower = t.toLowerCase();
        if (CLIENT_SERIES_ALIASES[lower]) return CLIENT_SERIES_ALIASES[lower];
        const prefixKey = lower.split(/\\s*[-–]\\s*/)[0];
        if (CLIENT_SERIES_ALIASES[prefixKey]) return CLIENT_SERIES_ALIASES[prefixKey];
        return t.slice(0, 120).trim();
      }

      function parseClientMediaPreview(rawFilenameOrTitle, durationSec = 0, msgObj = null) {
        const raw = String(rawFilenameOrTitle || "").normalize("NFC").trim();
        const rawCapText = msgObj && typeof msgObj === "object" ? String(msgObj.raw_text || msgObj.text || msgObj.caption || "").normalize("NFC") : "";
        const rawFileNameField = String(msgObj?.raw_file_name || msgObj?.file_name || "");
        const isArchive = /\\.(?:rar|zip|7z|iso|tar|gz|r\\d{2}|z\\d{2})$|\\.(?:7z|zip|rar)\\.\\d{3}$/i.test(raw) ||
          /\\.(?:rar|zip|7z|iso|tar|gz|r\\d{2}|z\\d{2})$|\\.(?:7z|zip|rar)\\.\\d{3}$/i.test(rawFileNameField) ||
          /(?:\\.part\\d+\\.rar|\\.(?:7z|zip|rar)\\.\\d{3}|\\.[rz]\\d{2})\\b/i.test(raw + " " + rawCapText);
        const strippedExtRaw = raw.replace(/(?:\\.part0*\\d{1,3}\\.rar|\\.(?:7z|zip|rar)\\.0*\\d{1,3}|\\.[rz]\\d{2,3}|\\.(?:mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mk3d|rar|zip|7z|iso|tar|gz|json))+$/i, "");
        const sceneCleanRaw = stripClientSceneGroupPrefix(strippedExtRaw);
        const editionRes = extractClientEditionInfo(sceneCleanRaw);
        let withoutExt = normalizeClientEpisodeText(editionRes.cleanStr).replace(/(?:\\.part0*\\d{1,3}\\.rar|\\.(?:7z|zip|rar)\\.0*\\d{1,3}|\\.[rz]\\d{2,3}|\\.(?:mp4|mkv|avi|mov|webm|m4v|ts|flv|wmv|mk3d|rar|zip|7z|iso|tar|gz|json))+$/i, "");
        withoutExt = withoutExt.replace(/\\(\\s*\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\s*\\)/g, " ").replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
        let quality = detectClientVideoQuality(msgObj, withoutExt, raw);
        const pInfo = extractClientPartInfo(rawCapText || raw, String(msgObj?.raw_file_name || msgObj?.file_name || raw), durationSec);
        let codec = isArchive ? (pInfo?.partType || "RAR") : "x264";
        const cm = !isArchive ? withoutExt.match(/\\b(x265|h\\.?265|hevc|x264|h\\.?264|avc|av1)\\b/i) : null;
        if (cm) {
          const cLow = cm[1].toLowerCase().replace(/\\./g, "");
          codec = (cLow === "x265" || cLow === "h265" || cLow === "hevc") ? "x265" : (cLow === "av1" ? "AV1" : "x264");
        }
        let part = pInfo ? pInfo.partLabel : null;

        let isSeries = false;
        let season = null;
        let episode = null;
        let episodeTitle = "";
        let explicitTitle = null;

        const hashStaffelFull = withoutExt.match(/^(.+?)[_\\s]*#[_\\s]*S(\\d{1,2})E(\\d{1,3})[_\\s]*(?:[#\\-–]+[_\\s]*)(.+)$/i) ||
                                withoutExt.match(/^(.+?)[_\\s]*#[_\\s]*Staffel[_\\s]*(\\d{1,2})[_\\s,.\\-]*(?:Folge|Episode)[_\\s]*(\\d{1,3})[_\\s]*(?:[#\\-–]+[_\\s]*)(.+)$/i);
        const archeMatch = withoutExt.match(/^S(\\d{1,2})E(\\d{1,3})\\s*[-–]\\s*@\\w+\\s*[-–]\\s*(.+)$/i);
        const hashStaffelMatch = withoutExt.match(/^#?\\s*S(\\d{1,2})E(\\d{1,3})\\s*[-–]\\s*(.+)$/i);
        const epStaffelVonMatch = raw.match(/(?:Episode|Folge)[\\s._]*(\\d+)(?:[\\s._\\-&]+\\d+)?[\\s._\\-]*(?:Staffel|Season)[\\s._]*(\\d+)[\\s._\\-]*von[\\s._]+(.+?)(?:\\.mp4|\\.mkv|\\.avi|s_to_Serien|_sto_Serien|[\\s._]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|$)/i) ||
                                  withoutExt.match(/(?:Episode|Folge)[\\s._]*(\\d{1,3})(?:[\\s._\\-&]+\\d{1,3})?[\\s._\\-]*(?:(?:\\(?Staffel[\\s._]*(\\d{1,2})\\)?)[\\s._\\-]*(?:von[\\s._]+)?|(?:von[\\s._]+))(.+?)(?:[\\s._]*\\(\\d{1,3}\\))?(?:s_to_Serien|_sto_Serien|[\\s._]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|$)/i);
        const rawFileOnly = msgObj && typeof msgObj === "object"
          ? normalizeClientEpisodeText(String(msgObj.raw_file_name || msgObj.file_name || "").trim())
          : "";
        const fileExplicitSeMatch = rawFileOnly
          ? (rawFileOnly.match(/\\bS(\\d{1,2})[\\s._-]*E(\\d{1,3})(?:[-–]E?(\\d{1,3}))?\\b/i) ||
             rawFileOnly.match(/(?:Episode|Folge)[\\s._]*(\\d+)(?:[\\s._\\-&]+\\d+)?[\\s._\\-]*(?:Staffel|Season)[\\s._]*(\\d+)/i))
          : null;
        const seMatch = withoutExt.match(/\\bS(\\d{1,2})[\\s._-]*E(\\d{1,3})(?:[-–]E?(\\d{1,3}))?\\b/i);

        let cutIdx = withoutExt.length;
        if (hashStaffelFull) {
          isSeries = true;
          season = parseInt(hashStaffelFull[2], 10) || 1;
          episode = parseInt(hashStaffelFull[3], 10) || 1;
          episodeTitle = cleanClientMediaTitle(hashStaffelFull[1]);
          explicitTitle = hashStaffelFull[4];
        } else if (archeMatch) {
          isSeries = true;
          season = parseInt(archeMatch[1], 10) || 1;
          episode = parseInt(archeMatch[2], 10) || 1;
          explicitTitle = archeMatch[3];
        } else if (hashStaffelMatch) {
          isSeries = true;
          season = parseInt(hashStaffelMatch[1], 10) || 1;
          episode = parseInt(hashStaffelMatch[2], 10) || 1;
          explicitTitle = hashStaffelMatch[3];
        } else if (epStaffelVonMatch) {
          isSeries = true;
          episode = parseInt(epStaffelVonMatch[1], 10) || 1;
          season = epStaffelVonMatch[2] ? parseInt(epStaffelVonMatch[2], 10) : 1;
          explicitTitle = epStaffelVonMatch[3].replace(/_/g, " ").trim();
          if (msgObj && typeof msgObj === "object" && msgObj.pre_context) {
            msgObj.pre_context.seriesHeader = cleanClientMediaTitle(explicitTitle) || explicitTitle;
          }
        } else if (seMatch) {
          isSeries = true;
          season = parseInt(seMatch[1], 10) || 1;
          episode = parseInt(seMatch[2], 10) || 1;
          const afterRaw = withoutExt.slice(seMatch.index + seMatch[0].length).replace(/^[\\s._\\-–:·‧|⎪=]+/, "");
          if (seMatch.index === 0) {
            withoutExt = afterRaw;
            cutIdx = withoutExt.length;
            explicitTitle = afterRaw;
          } else {
            if (afterRaw) {
              const eqMatch = afterRaw.match(/^=\\s*([^=]+?)\\s*=/);
              episodeTitle = cleanClientMediaTitle(eqMatch ? eqMatch[1] : afterRaw);
            }
            if (typeof seMatch.index === "number" && seMatch.index > 1) {
              cutIdx = Math.min(cutIdx, seMatch.index);
            }
          }
        } else {
          const epOnly = withoutExt.match(/\\b(?:Folge|Episode|Ep\\.?)\\s*0*(\\d{1,3})\\b/i);

          if (epOnly) {
            isSeries = true;
            season = 1;
            episode = parseInt(epOnly[1], 10) || 1;
            if (typeof epOnly.index === "number" && epOnly.index > 1) cutIdx = Math.min(cutIdx, epOnly.index);
          } else if (!pInfo?.isMultiPart && !/[\\(\\[]\\s*(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(19[2-9]\\d|20[0-2]\\d)\\s*[\\)\\]]/i.test(withoutExt) && (durationSec <= 0 || durationSec <= 4200)) {
            const leadEpNumMatch = withoutExt.match(/^(?:0*(\\d{2,3}))[\\s\\-]+([A-Za-zÄÖÜäöüß].{2,})$/);
            const numberedMovieGuardRe = /^(?:12\\s+angry\\s+men|12\\s+years\\s+a\\s+slave|12\\s+monkeys|13\\s+hours|13\\s+assassins|13\\s+going\\s+on\\s+30|13\\s+geister|13\\s+ghosts|13\\s+sins|16\\s+blocks|17\\s+again|21\\s+jump\\s+street|22\\s+jump\\s+street|24\\s+hour\\s+party|27\\s+dresses|28\\s+days|28\\s+weeks|28\\s+years|30\\s+days\\s+of\\s+night|40\\s+year\\s+old|47\\s+ronin|47\\s+meters|50\\s+first\\s+dates|50\\s+shades|65\\s+million|88\\s+minutes|96\\s+hours|99\\s+homes|100\\s+things|100\\s+dinge|101\\s+dalmat|102\\s+dalmat|127\\s+hours|300\\s+rise|500\\s+days)\\b/i;
            const leadEpVal = leadEpNumMatch ? parseInt(leadEpNumMatch[1], 10) : 0;
            if (leadEpNumMatch && leadEpVal >= 1 && leadEpVal <= 399 && !numberedMovieGuardRe.test(withoutExt) && !/\\b(?:19[2-9]\\d|20[0-2]\\d)\\b/.test(withoutExt)) {
              isSeries = true;
              season = Number(msgObj?.pre_context?.season || 1);
              episode = leadEpVal;
              episodeTitle = cleanClientMediaTitle(leadEpNumMatch[2]);
              explicitTitle = (msgObj?.pre_context?.seriesHeader || msgObj?.pre_context?.title || episodeTitle);
            }
            const strippedTrailingQual = !isSeries ? withoutExt
              .replace(/[\\(\\[]\\s*(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(19[2-9]\\d|20[0-2]\\d)\\s*[\\)\\]]/gi, " ")
              .replace(/\\b(?:1080p|720p|2160p|480p|4k|uhd|x264|x265|h264|h265|hevc|ger|deu|german|deutsch|web-dl|webrip|bluray|hd|mp4|mkv|avi)\\b/gi, " ")
              .replace(/\\s+/g, " ")
              .trim() : "";
            const franchiseGuardRe = /^(?:iron man|thor|avengers|matrix|john wick|shrek|toy story|cars|fast|furious|hangover|rambo|rocky|creed|mad max|spider man|batman|superman|deadpool|guardians|men in black|rush hour|bad boys|oceans|expendables|transporter|taken|equalizer|punisher|blade|underworld|resident evil|alien|predator|terminator|jurassic|indiana jones|star wars|harry potter|herr der ringe|hobbit|fluch der karibik|mission impossible|james bond|bourne|twilight|tribute von panem|maze runner|divergent|pitch perfect|step up|scary movie|american pie|final destination|saw|scream|conjuring|insidious|paranormal|purge|halloween|freitag der|nightmare|hellraiser|chucky|annabelle|nun|sinister|troll|ip man|ong bak|raid|undisputed|goal|hooligans|manta|fack ju|ostwind|bibi|conni|schule der magischen|vorstadtkrokodile|wilde kerle|fünf freunde|tkkg|drei fragezeichen|deep blue sea|deep blue|sharknado|sector|ghettogangz|banlieue|burg schreckenstein|fifty shades|jumanji|hotel transsilvanien|ich einfach unverbesserlich|minions|ice age|madagascar|kung fu panda|drachenzähmen|rio|sing|pets|zoomania|vaiana|frozen|eiskönigin|ralph reichts|incredibles|unglaublichen|findet nemo|findet dorie|monster ag|monster uni|wall e|oben|coco|soul|luca|encanto)\\b/i;
            const isKnownClassicSeriesRe = /^(?:pippi langstrumpf|zur see|spuk im hochhaus|spuk unterm riesenrad|spuk von draußen|black box|das schloss im nebel|gormenghast|archiv des todes|front ohne gnade|feuerdrachen|gefährliche fahndung|treffpunkt flughafen|rote bergsteiger)\\b/i;
            const ctxSeriesHeader = msgObj && msgObj.pre_context && msgObj.pre_context.seriesHeader
              ? normalizeClientCompareTitle(msgObj.pre_context.seriesHeader)
              : "";
            const midNumMatch = strippedTrailingQual.match(/^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9\\s._\\-]{2,40}?)\\s+0*([1-9]|[1-9]\\d)\\s+([A-Za-zÄÖÜäöüß].{3,})$/);
            const trailingNumMatch = !midNumMatch ? strippedTrailingQual.match(/^([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9\\s._\\-]{2,40}?)\\s+0*([1-9]|1\\d|2[0-9]|30)\\s*$/) : null;
            if (midNumMatch && !/^(?:part|teil|cd|disc|dvd|hd|uhd|4k|1080p|720p|german|deutsch)\\b/i.test(midNumMatch[3])) {
              const candBase = cleanClientMediaTitle(midNumMatch[1]);
              const normCand = normalizeClientCompareTitle(candBase);
              const matchesCtxSeries = Boolean(ctxSeriesHeader && normCand && (normCand === ctxSeriesHeader || normCand.startsWith(ctxSeriesHeader + " ")));
              if (candBase && candBase.length >= 3 && !franchiseGuardRe.test(candBase) && (matchesCtxSeries || isKnownClassicSeriesRe.test(candBase))) {
                isSeries = true;
                season = 1;
                episode = parseInt(midNumMatch[2], 10) || 1;
                episodeTitle = cleanClientMediaTitle(midNumMatch[3]);
                explicitTitle = candBase;
              }
            } else if (trailingNumMatch && !/\\b(?:part|teil|cd|disc|dvd)\\b/i.test(strippedTrailingQual)) {
              const candBase = cleanClientMediaTitle(trailingNumMatch[1]);
              const normCand = normalizeClientCompareTitle(candBase);
              const matchesCtxSeries = Boolean(ctxSeriesHeader && normCand && (normCand === ctxSeriesHeader || normCand.startsWith(ctxSeriesHeader + " ")));
              if (candBase && candBase.length >= 3 && !franchiseGuardRe.test(candBase) && (matchesCtxSeries || isKnownClassicSeriesRe.test(candBase))) {
                isSeries = true;
                season = 1;
                episode = parseInt(trailingNumMatch[2], 10) || 1;
                explicitTitle = candBase;
              }
            }
          }
        }
        // Dateiname hat Vorrang vor Caption-Tippfehlern (z.B. "Queen of the South S01E13.mp4" vs Caption "S01E3")
        if (fileExplicitSeMatch) {
          const isEpStaffelOrder = /^(?:Episode|Folge)/i.test(fileExplicitSeMatch[0]);
          const fSeason = parseInt(isEpStaffelOrder ? fileExplicitSeMatch[2] : fileExplicitSeMatch[1], 10) || 1;
          const fEpisode = parseInt(isEpStaffelOrder ? fileExplicitSeMatch[1] : fileExplicitSeMatch[2], 10) || 1;
          if (!isSeries || episode !== fEpisode || !season) {
            isSeries = true;
            season = fSeason;
            episode = fEpisode;
          }
        }

        // Keine CD-Buttons bei Serien ("The Walking Dead"-Fix): part ist bei Serien immer null (part_number = 1)
        if (isSeries && !isArchive) {
          part = null;
        }

        let year = null;
        let hadYearCutoff = false;
        const parenYm = (" " + withoutExt + " ").match(/[\\(\\[]\\s*(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(19[2-9]\\d|20[0-2]\\d)\\s*[\\)\\]]/i);
        const ym = parenYm || (" " + withoutExt + " ").match(/(?:[\\(\\[\\-\\s_.·‧])(?:\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\b\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![./-]\\d|\\d)(?:[\\)\\]\\s._\\-·‧]|$)/i);
        if (ym) {
          year = parseInt(ym[1], 10);
          hadYearCutoff = true;
          if (!explicitTitle && typeof ym.index === "number" && ym.index >= 2) cutIdx = Math.min(cutIdx, ym.index - 1);
        }

        let titleCand = explicitTitle ? explicitTitle : (withoutExt.slice(0, cutIdx).trim() || withoutExt);
        if (year) {
          titleCand = titleCand
            .replace(new RegExp("[(\\\\[]\\\\s*(?:\\\\b(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\\\b\\\\s+)?" + year + "\\\\s*[)\\\\]]", "gi"), " ")
            .replace(new RegExp("\\\\b" + year + "\\\\b", "g"), " ");
        }
        let cleanTitle = cleanClientMediaTitle(titleCand, { hadYearCutoff }) || "Unbekannt";
        const altSplit = splitClientParenthesizedAltTitle(cleanTitle);
        let altTitle = null;
        if (altSplit.altTitle && altSplit.primaryTitle) {
          cleanTitle = altSplit.primaryTitle;
          altTitle = altSplit.altTitle;
        }
        if (cleanTitle && isLikelyClientPlotDescription(cleanTitle)) {
          cleanTitle = cleanTitle.split(/[:\\n(]/)[0].trim();
        }
        const jacobMatch = cleanTitle.match(/^(Jacob\\s*2[\\s/_]*2)\\s+(und\\s+.+)$/i);
        if (jacobMatch) cleanTitle = "Jacob 2/2";

        return {
          cleanTitle,
          altTitle,
          editionLabel: editionRes.editionLabel || null,
          year,
          isSeries,
          isArchive,
          isDownloadOnly: isArchive,
          type: isArchive ? "archive" : (isSeries ? "series" : "movie"),
          season,
          episode,
          episodeTitle,
          quality,
          codec,
          part
        };
      }

      function repairAndParseClientBackupJson(rawText) {
        const repairNotes = [];
        let text = String(rawText || "").replace(/^\\uFEFF/, "").replace(/\\0/g, "").trim();
        if (!text) return { ok: false, parsed: null, repaired: false, repairNotes: ["Datei ist leer"] };

        // Stufe 1: Direktes JSON.parse
        try {
          return { ok: true, parsed: JSON.parse(text), repaired: false, repairNotes: [] };
        } catch (firstErr) {
          let cleaned = text;
          const firstBracket = cleaned.search(/[\\{\\[]/);
          const lastBrace = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
          if (firstBracket > 0 || (lastBrace !== -1 && lastBrace < cleaned.length - 1)) {
            cleaned = cleaned.slice(Math.max(0, firstBracket), lastBrace !== -1 ? lastBrace + 1 : cleaned.length);
            repairNotes.push("Überflüssiger Text vor/nach JSON entfernt");
          }
          const noTrailingCommas = cleaned.replace(/,\\s*([\\}\\]])/g, "$1");
          if (noTrailingCommas !== cleaned) {
            repairNotes.push("Trailing Commas korrigiert");
          }
          try {
            return { ok: true, parsed: JSON.parse(noTrailingCommas), repaired: true, repairNotes };
          } catch (e2) {}

          // Stufe 2: Multi-Block / Concatenated JSON Splitter
          const blocks = [];
          let depth = 0;
          let startIdx = -1;
          let inStr = false;
          let escNext = false;
          for (let i = 0; i < noTrailingCommas.length; i++) {
            const ch = noTrailingCommas[i];
            if (escNext) { escNext = false; continue; }
            if (ch === "\\\\" && inStr) { escNext = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (!inStr) {
              if (ch === "{" || ch === "[") {
                if (depth === 0) startIdx = i;
                depth++;
              } else if (ch === "}" || ch === "]") {
                depth--;
                if (depth === 0 && startIdx !== -1) {
                  const blockStr = noTrailingCommas.slice(startIdx, i + 1);
                  try { blocks.push(JSON.parse(blockStr)); } catch (eb) {}
                  startIdx = -1;
                } else if (depth < 0) {
                  depth = 0;
                  startIdx = -1;
                }
              }
            }
          }

          if (blocks.length > 0) {
            repairNotes.push("Mehrteilige JSON-Blöcke (" + blocks.length + " Segmente) zusammengeführt");
            if (blocks.length === 1) {
              return { ok: true, parsed: blocks[0], repaired: true, repairNotes };
            }
            const combinedMessages = [];
            const combinedItems = [];
            let combinedChatName = "";
            for (const blk of blocks) {
              if (Array.isArray(blk?.messages)) {
                if (!combinedChatName && (blk.name || blk.title)) combinedChatName = String(blk.name || blk.title);
                for (const m of blk.messages) combinedMessages.push(m);
              } else if (Array.isArray(blk?.chats?.list)) {
                for (const ch of blk.chats.list) {
                  if (!combinedChatName && ch?.name) combinedChatName = String(ch.name);
                  if (Array.isArray(ch?.messages)) {
                    for (const m of ch.messages) combinedMessages.push(m);
                  }
                }
              } else if (Array.isArray(blk)) {
                for (const item of blk) {
                  if (item && (item.type === "message" || item.file_name || item.text || item.media_type)) combinedMessages.push(item);
                  else combinedItems.push(item);
                }
              } else if (blk && typeof blk === "object") {
                if (blk.type === "message" || blk.file_name || (blk.id && blk.text)) combinedMessages.push(blk);
                else combinedItems.push(blk);
              }
            }
            if (combinedMessages.length > 0) {
              return { ok: true, parsed: { name: combinedChatName || "Telegram Export (Repariert)", messages: combinedMessages }, repaired: true, repairNotes };
            }
            return { ok: true, parsed: combinedItems, repaired: true, repairNotes };
          }

          // Stufe 3: NDJSON / Zeilenweises JSON
          const lines = text.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
          const lineObjs = [];
          for (const line of lines) {
            const cleanLine = line.replace(/,$/, "").trim();
            if ((cleanLine.startsWith("{") && cleanLine.endsWith("}")) || (cleanLine.startsWith("[") && cleanLine.endsWith("]"))) {
              try {
                const o = JSON.parse(cleanLine);
                if (Array.isArray(o)) lineObjs.push(...o);
                else lineObjs.push(o);
              } catch (el) {}
            }
          }
          if (lineObjs.length > 0) {
            repairNotes.push("Zeilenweises JSON / NDJSON (" + lineObjs.length + " Zeilen) repariert");
            const looksLikeTg = lineObjs.some(o => o && (o.type === "message" || o.file_name || o.media_type || o.text));
            return {
              ok: true,
              parsed: looksLikeTg ? { name: "Telegram Export (NDJSON)", messages: lineObjs } : lineObjs,
              repaired: true,
              repairNotes
            };
          }

          // Stufe 4: Notfall-Objekt-Scanner für abgeschnittene result.json Dateien
          const nameMatch = text.match(/"name"\\s*:\\s*"([^"]+)"/);
          const recoveredChatName = nameMatch ? nameMatch[1] : "Repariertes Telegram-Backup";
          const recoveredMsgs = [];
          const msgRegex = /\\{[^{}]*"(?:file_name|file|text|title|filename|media_type)"[^{}]*\\}/g;
          let mMatch;
          while ((mMatch = msgRegex.exec(noTrailingCommas)) !== null) {
            try { recoveredMsgs.push(JSON.parse(mMatch[0])); } catch (em) {}
          }
          if (recoveredMsgs.length > 0) {
            repairNotes.push("Beschädigte JSON-Struktur repariert (" + recoveredMsgs.length + " Nachrichten rekonstruiert)");
            return { ok: true, parsed: { name: recoveredChatName, messages: recoveredMsgs }, repaired: true, repairNotes };
          }

          return { ok: false, parsed: null, repaired: false, repairNotes: [firstErr.message] };
        }
      }

      async function deduplicateAndClassifyClientEntries(rawCandidates, statusEl = null) {
        const entries = [];
        const seenExactKeys = new Set();
        const seenFileIds = new Set();
        const seenWorkKeys = new Set();
        let duplicatesSkippedInFile = 0;
        let qualityVariantsInFile = 0;
        let detectedMoviesCount = 0;
        let detectedSeriesCount = 0;
        const previewSamples = [];
        const totalRaw = rawCandidates.length;

        for (let i = 0; i < totalRaw; i++) {
          if (i > 0 && i % 400 === 0) {
            if (statusEl) {
              const pct = Math.min(100, Math.round((i / totalRaw) * 100));
              statusEl.textContent =
                "⏳ Gruppiere & prüfe Duplikate: " +
                i.toLocaleString("de-DE") + " / " + totalRaw.toLocaleString("de-DE") +
                " (" + pct + "%)...";
            }
            await new Promise(r => setTimeout(r, 0));
          }
          const item = rawCandidates[i];
          if (!item) continue;
          const rawStr = typeof item === "string"
            ? item
            : String(item.filename || item.file_name || item.title || item.name || "").trim();
          if (!rawStr || rawStr.length < 2) continue;

          // MODUL 2: Alle Archive (.rar, .zip, .7z, .iso, .tar, .gz) sind als Zusatz-Downloads erlaubt!
          if (/\\.(exe|apk|pdf|txt|nfo|srt|sub|webp|tgs|gif|mp3|m4a|flac|ogg|wav)$/i.test(rawStr) || /\\.gif\\.mp4$/i.test(rawStr)) {
            continue;
          }

          const durationSec = (typeof item === "object" && item !== null)
            ? Number(item.duration_sec || item.duration_seconds || item.duration || 0)
            : 0;
          const parsed = parseClientMediaPreview(rawStr, durationSec, typeof item === "object" ? item : null);
          if (typeof item === "object" && item !== null) {
            if (item.cleanTitle && item.cleanTitle !== "Unbekannt") {
              parsed.cleanTitle = item.neighborEnriched
                ? String(item.cleanTitle).trim()
                : (cleanClientMediaTitle(String(item.cleanTitle)) || String(item.cleanTitle));
            }
            if (item.type === "series" || item.type === "tv" || item.isSeries || item.season || item.episode) {
              parsed.isSeries = true;
              parsed.season = Number(item.season || parsed.season || 1);
              parsed.episode = Number(item.episode || parsed.episode || 1);
            }
            if (item.episodeTitle) parsed.episodeTitle = String(item.episodeTitle);
            if (item.year) parsed.year = Number(item.year);
            if (item.width || item.height) {
              parsed.quality = detectClientVideoQuality(item, item.raw_text || "", rawStr);
            } else if (item.quality !== undefined) {
              parsed.quality = item.quality ? String(item.quality) : null;
            }
            if (item.part && !parsed.isSeries) parsed.part = String(item.part);
            if (item.codec) parsed.codec = String(item.codec);
            if (item.isArchive || item.isDownloadOnly || item.type === "archive") {
              parsed.isArchive = true;
              parsed.isDownloadOnly = true;
              parsed.type = "archive";
            }
          }

          const normTitle = normalizeClientCompareTitle(parsed.cleanTitle);
          if (!normTitle || normTitle === "unbekannt") continue;

          const fileId = (typeof item === "object" && (item.telegram_file_id || item.file_id || item.fileId))
            ? String(item.telegram_file_id || item.file_id || item.fileId)
            : "";
          if (fileId && seenFileIds.has(fileId)) {
            duplicatesSkippedInFile++;
            continue;
          }

          const fileSizeBytes = (typeof item === "object" && item !== null)
            ? Number(item.file_size || item.fileSize || 0)
            : 0;
          const widthVal = (typeof item === "object" && item !== null) ? Number(item.width || 0) : 0;
          const heightVal = (typeof item === "object" && item !== null) ? Number(item.height || 0) : 0;
          const fileUniqueId = (typeof item === "object" && (item.file_unique_id || item.telegram_unique_id))
            ? String(item.file_unique_id || item.telegram_unique_id)
            : "";
          // MODUL 3: Eindeutiger fileFingerprint verhindert den null === null Bug bei JSON-Imports
          const fileFingerprint = fileUniqueId || fileId || ((fileSizeBytes || 0) + "_" + (durationSec || 0) + "_" + (widthVal || 0) + "x" + (heightVal || 0));
          const rawFileNameKey = (typeof item === "object" && item !== null)
            ? String(item.raw_file_name || item.file_name || item.rawInput || rawStr).trim().toLowerCase()
            : rawStr.trim().toLowerCase();
          const partSuffix = parsed.isSeries ? "" : String(parsed.part || "").toUpperCase();

          const workKey = normTitle + "|" + (parsed.year || "") + "|" + (parsed.isSeries ? ("s_" + (parsed.season || 1) + "_" + (parsed.episode || 1)) : "m");
          const exactKey = workKey + "|part:" + partSuffix + "|fp:" + fileFingerprint + "|fn:" + rawFileNameKey;

          if (seenExactKeys.has(exactKey)) {
            duplicatesSkippedInFile++;
            continue;
          }
          seenExactKeys.add(exactKey);
          if (fileId) seenFileIds.add(fileId);

          const isQualityVariant = seenWorkKeys.has(workKey);
          if (isQualityVariant) {
            qualityVariantsInFile++;
          } else {
            seenWorkKeys.add(workKey);
            if (parsed.isSeries) detectedSeriesCount++;
            else detectedMoviesCount++;
          }

          const isArchFlag = Boolean(parsed.isArchive || item?.isArchive || item?.isDownloadOnly || item?.type === "archive");
          const entryObj = typeof item === "object" && item !== null
            ? {
                ...item,
                filename: rawStr,
                rawInput: item.rawInput || rawStr,
                cleanTitle: parsed.cleanTitle,
                originalTitle: parsed.altTitle || item.originalTitle || null,
                edition: parsed.editionLabel || item.edition || null,
                year: parsed.year,
                isSeries: parsed.isSeries,
                isArchive: isArchFlag,
                isDownloadOnly: isArchFlag,
                type: isArchFlag ? "archive" : (parsed.isSeries ? "series" : "movie"),
                season: parsed.season,
                episode: parsed.episode,
                episodeTitle: parsed.episodeTitle || item.episodeTitle || "",
                quality: parsed.quality,
                codec: parsed.codec,
                part: parsed.isSeries && !isArchFlag ? null : parsed.part,
                fileFingerprint,
                tags: isArchFlag ? "📦 Archiv-Download" : (parsed.editionLabel || item.tags || ""),
                contextOverview: item.contextOverview || "",
                neighborEnriched: Boolean(item.neighborEnriched),
                isQualityVariant
              }
            : {
                filename: rawStr,
                rawInput: rawStr,
                cleanTitle: parsed.cleanTitle,
                originalTitle: parsed.altTitle || null,
                edition: parsed.editionLabel || null,
                year: parsed.year,
                isSeries: parsed.isSeries,
                isArchive: isArchFlag,
                isDownloadOnly: isArchFlag,
                type: isArchFlag ? "archive" : (parsed.isSeries ? "series" : "movie"),
                season: parsed.season,
                episode: parsed.episode,
                episodeTitle: parsed.episodeTitle || "",
                quality: parsed.quality,
                codec: parsed.codec,
                part: parsed.isSeries && !isArchFlag ? null : parsed.part,
                fileFingerprint,
                tags: isArchFlag ? "📦 Archiv-Download" : (parsed.editionLabel || ""),
                contextOverview: "",
                neighborEnriched: false,
                isQualityVariant
              };

          entries.push(entryObj);
          if (previewSamples.length < 8) {
            previewSamples.push({
              cleanTitle: parsed.cleanTitle,
              year: parsed.year || "k.A.",
              isSeries: parsed.isSeries,
              season: parsed.season,
              episode: parsed.episode,
              quality: parsed.isArchive ? "📦 RAR" : (parsed.quality || "Auto"),
              isQualityVariant
            });
          }
        }

        return {
          entries,
          duplicatesSkippedInFile,
          qualityVariantsInFile,
          detectedMoviesCount,
          detectedSeriesCount,
          previewSamples
        };
      }

      function buildClientPrevMsgSummary(m) {
        if (!m || typeof m !== "object") return null;
        const txt = flattenClientTgText(m.text || m.caption || m.text_entities);
        const fName = String(m.file_name || "").trim();
        const combined = [txt, fName].filter(Boolean).join(" | ").slice(0, 320);
        if (!combined && !m.photo) return null;
        let tmdbId = null;
        let mediaType = null;
        const tmdbMatch = combined.match(/themoviedb\\.org\\/(movie|tv)\\/(\\d+)/i);
        if (tmdbMatch) {
          mediaType = tmdbMatch[1].toLowerCase() === "tv" ? "tv" : "movie";
          tmdbId = parseInt(tmdbMatch[2], 10);
        }
        const firstLine = (txt.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean)[0] || fName || "").slice(0, 120);
        const parsedGuess = parseClientMediaPreview(firstLine, 0, m);
        return {
          msgId: m.id || null,
          date: m.date || null,
          hasPhoto: Boolean(m.photo),
          text: combined || (m.photo ? "[Poster / Bild-Nachricht]" : ""),
          titleGuess: parsedGuess.cleanTitle && parsedGuess.cleanTitle !== "Unbekannt" ? parsedGuess.cleanTitle : "",
          yearGuess: parsedGuess.year || null,
          tmdbId,
          mediaType
        };
      }

      function extractClientPreContextFromMsg(msg, currentPre) {
        if (isClientJunkOrSticker(msg)) return currentPre || {};
        const isPhoto = Boolean(msg.photo || msg.media_type === "photo" || /^image\\//i.test(msg.mime_type || ""));
        const txt = normalizeClientEpisodeText(flattenClientTgText(msg.text || msg.caption || msg.text_entities));
        const hasLinks = Array.isArray(msg.text_entities) && msg.text_entities.some(e => e && (e.href || e.url || e.type === "link"));
        // Fall 1 (Frontier ID 111): Leeres Foto setzt den vorherigen Serien-/Film-Kontext zurück!
        if (isPhoto && !txt && !hasLinks) {
          return { lastMessageId: Number(msg.id || 0) };
        }
        const ctx = (isPhoto && txt)
          ? { lastMessageId: Number(msg.id || 0) }
          : (currentPre ? { ...currentPre, lastMessageId: Number(msg.id || currentPre.lastMessageId || 0) } : { lastMessageId: Number(msg.id || 0) });
        if (!txt && !hasLinks) return ctx;

        if (Array.isArray(msg.text_entities)) {
          for (const ent of msg.text_entities) {
            const href = ent.href || (ent.type === "link" ? ent.text : "") || "";
            const tm = String(href).match(/themoviedb\\.org\\/(movie|tv)\\/(\\d+)/i);
            if (tm) {
              ctx.mediaType = tm[1].toLowerCase() === "tv" ? "tv" : "movie";
              ctx.tmdbId = parseInt(tm[2], 10);
              if (ctx.mediaType === "movie") delete ctx.seriesHeader;
            }
            const im = String(href).match(/imdb\\.com\\/title\\/(tt\\d+)/i);
            if (im) ctx.imdbId = im[1];
            if (String(href).includes("vorschauserien")) ctx.isSeriesHeader = true;
          }
        }
        const rawTm = txt.match(/themoviedb\\.org\\/(movie|tv)\\/(\\d+)/i);
        if (rawTm && !ctx.tmdbId) {
          ctx.mediaType = rawTm[1].toLowerCase() === "tv" ? "tv" : "movie";
          ctx.tmdbId = parseInt(rawTm[2], 10);
        }
        const rawIm = txt.match(/imdb\\.com\\/title\\/(tt\\d+)/i);
        if (rawIm && !ctx.imdbId) ctx.imdbId = rawIm[1];

        const seasonHeaderMatch = txt.match(/\\bStaffel[\\s._-]*0*(\\d{1,2})\\b/i);
        if (seasonHeaderMatch) {
          ctx.season = parseInt(seasonHeaderMatch[1], 10) || 1;
          ctx.isSeriesHeader = true;
        }

        const tMatch = txt.match(/(?:🎬\\s*)?(?:Titel|Title|Film|Serie)\\s*:\\s*([^\\n]+)/i);
        if (tMatch) {
          ctx.title = cleanClientMediaTitle(tMatch[1]);
          if (!seasonHeaderMatch && !ctx.isSeriesHeader) {
            delete ctx.seriesHeader;
          }
        }
        const oMatch = txt.match(/Originaltitel\\s*:\\s*([^\\n]+)/i);
        if (oMatch) ctx.originalTitle = cleanClientMediaTitle(oMatch[1]);
        const yMatch = txt.match(/(?:Erscheinungsjahr|Jahr|Release)\\s*:\\s*.*?(19\\d{2}|20[0-2]\\d)/i);
        if (yMatch) ctx.year = parseInt(yMatch[1], 10);

        const lines = getCleanClientContentLines(txt);
        // Video schlägt Header (Breaking Bad S03E01 Fix): Auch wenn msg.media_type === "video_file", Serien-/Staffel-Header in den Kontext übernehmen!
        if (lines.length >= 1 && !tMatch) {
          const firstLine = lines[0];
          const isYoutubeOrUrlOnly = /^(?:https?:\\/\\/|www\\.|youtu\\.be\\/|youtube\\.com\\/)/i.test(firstLine.trim()) || /(?:youtu\\.be\\/|youtube\\.com\\/watch)/i.test(firstLine);
          if (isYoutubeOrUrlOnly) {
            return ctx;
          }
          if (/\\b\\d+\\s+Folgen\\s+in\\s+\\d+\\s+Staffel/i.test(firstLine) && ctx.seriesHeader) {
            return ctx;
          }
          if (ctx.isSeriesHeader || /\\b(?:Staffel\\s+\\d+|Miniserie|\\d+\\/\\d+\\s*Folgen|\\d+\\s*Staffeln\\s*\\/\\s*\\d+\\s*Folgen|\\d+\\s+Folgen\\s+in\\s+\\d+\\s+Staffel)/i.test(txt)) {
            const ymHeader = (" " + txt.slice(0, 120) + " ").match(/(?:[(\\[\\-\\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![./-]\\d|\\d)(?:[)\\]\\s._\\-·‧]|$)/i);
            if (ymHeader && !ctx.year) ctx.year = parseInt(ymHeader[1], 10);
            const firstWithoutRanges = firstLine
              .replace(/[\\(\\[]?\\s*(?:19[2-9]\\d|20[0-2]\\d)\\s*[-–—/bis]+\\s*(?:19[2-9]\\d|20[0-2]\\d|heute|present)\\s*[\\)\\]]?/gi, " ")
              .replace(/Staffel\\s*\\d+.*/i, "")
              .replace(/\\bS\\d{1,2}E\\d{1,3}\\b.*/i, "")
              .replace(/\\b(19[2-9]\\d|20[0-2]\\d)\\b/g, " ");
            const hClean = cleanClientMediaTitle(firstWithoutRanges);
            if (hClean && !/^(?:film|filme|serie|serien|kinofilm|spielfilm|deutsch|german|hd|uhd|4k|\\+?18\\+?)$/i.test(hClean)) {
              ctx.seriesHeader = hClean;
              ctx.isSeriesHeader = true;
              delete ctx.title;
              delete ctx.tmdbId;
            }
          } else if (!msg.file_name && msg.media_type !== "video_file") {
            const isCollectionHeaderLine = /(?:teil\\s*\\d+\\s*(?:bis|-|–)\\s*\\d+|\\b\\d+\\s*-\\s*\\d+\\b|collection|trilogie|trilogy|quadrilogie|box)/i.test(firstLine);
            if (!isCollectionHeaderLine) {
              const headSlice = firstLine.slice(0, 110);
              const cutoffCheck = applyClientHardYearCutoff(headSlice);
              const ym = (" " + headSlice + " ").match(/(?:[(\\[\\-\\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![./-]\\d|\\d)(?:[)\\]\\s._\\-·‧]|$)/i);
              if (cutoffCheck.hadYearCutoff && cutoffCheck.titleBeforeYear) {
                ctx.year = cutoffCheck.year;
                const tGuess = cleanClientMediaTitle(cutoffCheck.titleBeforeYear);
                if (tGuess && !/^(?:film|filme|serie|serien|kinofilm|spielfilm|deutsch|german|hd|uhd|4k|\\+?18\\+?)$/i.test(tGuess)) {
                  ctx.title = tGuess;
                  if (ctx.isSeriesHeader) ctx.seriesHeader = tGuess;
                  else delete ctx.seriesHeader;
                }
              } else if (ym && ym.index >= 2) {
                ctx.year = parseInt(ym[1], 10);
                const tGuess = cleanClientMediaTitle(headSlice.slice(0, Math.max(0, ym.index - 1)));
                if (tGuess && !/^(?:film|filme|serie|serien|kinofilm|spielfilm|deutsch|german|hd|uhd|4k|\\+?18\\+?)$/i.test(tGuess)) {
                  ctx.title = tGuess;
                  if (ctx.isSeriesHeader) {
                    ctx.seriesHeader = tGuess;
                  } else {
                    delete ctx.seriesHeader;
                  }
                }
              } else {
                // Jahresloser Foto-/Text-Header:
                // 1. Falls die erste Zeile ein langer Beschreibungssatz mit einem Titel in Anführungszeichen ist (z.B. „Cocaine Bear“ in msgId 3436):
                const wordsInFirstLine = firstLine.trim().split(/\\s+/).filter(Boolean);
                const quotedTitleMatch = (firstLine.length > 65 || wordsInFirstLine.length > 8)
                  ? txt.match(/[„"«»”"]([^„"«»”"\\n]{2,55})[“"«»”"]/)
                  : null;
                if (quotedTitleMatch && quotedTitleMatch[1]) {
                  const qClean = cleanClientMediaTitle(quotedTitleMatch[1]);
                  if (qClean && qClean.length >= 2 && !/^(?:film|filme|serie|serien|kinofilm|spielfilm|deutsch|german|hd|uhd|4k|\\+?18\\+?)$/i.test(qClean)) {
                    ctx.title = qClean;
                    delete ctx.seriesHeader;
                  }
                } else if (firstLine.length >= 2 && firstLine.length <= 65 && wordsInFirstLine.length <= 8) {
                  // 2. Kurze, saubere Titelzeile ohne Jahreszahl (z.B. "DRAGON 🐉 BALL DAIMA", "𝗛𝗜𝗚𝗛 𝗣𝗢𝗧𝗘𝗡𝗧𝗜𝗔𝗟 ᴴᴰ", "The Wire", "Fargo", "Prison Break", "Creed 3 Rockys Legacy")
                  const noYearClean = cleanClientMediaTitle(firstLine);
                  if (noYearClean && noYearClean.length >= 2 && !/^(?:film|filme|serie|serien|kinofilm|spielfilm|video|deutsch|german|hd|fullhd|uhd|4k|neu|new|kino|stream|action|horror|comedy|drama|thriller|scifi|fantasy|ab\\s+\\d+\\s+jahren|\\+?18\\+?)$/i.test(noYearClean)) {
                    ctx.title = noYearClean;
                  }
                }
              }
            }
          }
        }
        return ctx;
      }

      // Stufe 1 (Arielle 2023 & Kurztitel): Nachbar-Post (+1 / -1 / +2 / -2) auf passenden Voll-Titel & Beschreibungstext prüfen
      function enrichClientVideoFromNeighborPost(messages, currentIndex, parsedVideo) {
        if (!parsedVideo || !parsedVideo.title) return parsedVideo;

        const baseWord = String(parsedVideo.title)
          .toLowerCase()
          .replace(/^(?:der|die|das|the|a|disneys|disney's|marvels|marvel's|pixars|pixar's)\\s+/i, "")
          .split(/[\\s:,\\-–_.]+/)[0];

        if (!baseWord || baseWord.length < 3) return parsedVideo;

        // Prüfe zuerst den Post direkt DARUNTER (+1), dann darüber (-1), dann +2 / -2
        for (const offset of [1, -1, 2, -2]) {
          const neighbor = messages[currentIndex + offset];
          if (!neighbor || neighbor.media_type === "video_file" || neighbor.video) continue;
          const nFile = String(neighbor.file_name || neighbor.file || "").toLowerCase();
          if (/\\.(?:mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mk3d|rar|srt|vtt|sub|ass|ssa)$/i.test(nFile)) continue;

          const rawText = flattenClientTgText(neighbor.text || neighbor.caption || neighbor.text_entities);
          const lines = rawText.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
          if (lines.length === 0) continue;

          const firstLine = lines[0]
            .replace(/^[🟢🔵🟡🔴🟣🟠⚫⚪🎬🎞️📺🍭✨🔸🔶💎➡️▶️🍿⭐️❖➠✔️🔞👉👈👇👆⬇️⬆️🔥💥⚡🌟🎭🎧🔊💿📀📽️🎥❤️♥️\\s]+/gu, "")
            .replace(/^(?:(?:🎬\\s*)?(?:Titel|Title|Film)\\s*:\\s*)?(?:disney'?s|disneys|marvel'?s|marvels|pixar'?s|pixars)\\s+/i, "")
            .replace(/^(?:🎬\\s*)?(?:Titel|Title|Film)\\s*:\\s*/i, "")
            .trim();

          // Sicherheits-Check: Die erste Zeile des Nachbarn MUSS das Basiswort ("arielle") enthalten!
          // Dadurch wird "Tin & Tina 2023" (-1) sofort ausgeschlossen!
          if (!firstLine.toLowerCase().includes(baseWord)) continue;

          const yearMatch = rawText.match(/\\b(19[2-9]\\d|20[0-2]\\d)\\b/);
          const neighborYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

          if (parsedVideo.year && neighborYear && Number(parsedVideo.year) !== neighborYear) continue;

          // Collection-Header & Detailtitel-Schutz ("Der König der Löwen 2 - Simbas Königreich (1998)" vs. "König der Löwen teil 1 bis 3"):
          // 1. Wenn der Titel des Nachbar-Posts Wörter wie "teil 1 bis 3", "1-3", "collection", "trilogie" oder "box" enthält, darf er NIEMALS parsedVideo.title überschreiben!
          // 2. Wenn das aktuelle Video bereits einen eigenen ausführlichen Titel mit Fortsetzungs-Nummer ([1-9]) oder Bindestrich ("-") besitzt,
          //    ist der eigene Titel hochwertiger als jeder Nachbar-Post und darf nicht überschrieben werden!
          const neighborTitleLower = firstLine.toLowerCase();
          const isCollectionHeader = /(?:teil\\s*\\d+\\s*(?:bis|-|–)\\s*\\d+|\\d+\\s*-\\s*\\d+|collection|trilogie|trilogy|quadrilogie|box)/i.test(neighborTitleLower);
          const videoHasDetailedTitle = Boolean(parsedVideo.title && (/[1-9]/.test(parsedVideo.title) || parsedVideo.title.includes("-") || parsedVideo.title.includes("–") || parsedVideo.title.includes(":")));

          if (isCollectionHeader || videoHasDetailedTitle) {
            return {
              ...parsedVideo,
              contextOverview: lines.slice(1).join(" ").trim() || parsedVideo.contextOverview || ""
            };
          }

          const cleanedNeighborTitle = firstLine
            .replace(/\\s*[(\\[\\-–]*\\s*\\b(19[2-9]\\d|20[0-2]\\d)\\b\\s*[)\\]]*\\s*$/, "")
            .trim();
          // "Cocaine Bear"- & "Ted Bundy"-Schutz (MODUL 2.5):
          // Nur echte Beschreibungssätze (> 120 Zeichen oder > 15 Wörter) als Beschreibung behandeln, niemals gültige Titel mitten im Wort abschneiden!
          if (isLikelyClientPlotDescription(cleanedNeighborTitle)) {
            return {
              ...parsedVideo,
              year: parsedVideo.year || neighborYear,
              contextOverview: rawText.trim(),

              neighborEnriched: true,
              neighborOffset: offset

            };
          }
          let finalTitle = cleanClientMediaTitle(cleanedNeighborTitle) || cleanedNeighborTitle;
          if (finalTitle && isLikelyClientPlotDescription(finalTitle)) {
            finalTitle = finalTitle.split(/[:\\n(]/)[0].trim();
          }

          return {
            ...parsedVideo,
            title: finalTitle || parsedVideo.title,
            year: parsedVideo.year || neighborYear,
            contextOverview: lines.slice(1).join(" ").trim(),
            neighborEnriched: true,
            neighborOffset: offset
          };
        }

        return parsedVideo;
      }

      async function detectAndParseClientBackupJson(parsedJson, fileName = "result.json", fileSizeBytes = 0, repairMeta = null, statusEl = null) {
        let tgMessages = null;
        let backupChatName = "";
        let backupChatId = "";
        let backupChatUsername = "";
        if (Array.isArray(parsedJson?.messages)) {
          tgMessages = parsedJson.messages;
          backupChatName = String(parsedJson.name || parsedJson.title || ("Chat #" + (parsedJson.id || "Backup")));
          if (parsedJson.id) backupChatId = String(parsedJson.id);
          if (parsedJson.username) backupChatUsername = String(parsedJson.username);
        } else if (Array.isArray(parsedJson?.chats?.list)) {
          tgMessages = [];
          for (const ch of parsedJson.chats.list) {
            if (Array.isArray(ch?.messages)) {
              if (!backupChatName && ch.name) backupChatName = ch.name;
              if (!backupChatId && ch.id) backupChatId = String(ch.id);
              if (!backupChatUsername && ch.username) backupChatUsername = String(ch.username);
              for (const m of ch.messages) tgMessages.push(m);
            }
          }
          if (!backupChatName) backupChatName = "Telegram Multi-Chat Export";
        }

        if (Array.isArray(tgMessages)) {
          await new Promise(r => setTimeout(r, 0));
          // MODUL 1.1: Chronologische Sortierung vor dem Loop erzwingen (msg.id aufsteigend) + Deduplizierung via processedMsgIds
          tgMessages.sort((a, b) => Number(a?.id || a?.message_id || 0) - Number(b?.id || b?.message_id || 0));
          const processedMsgIds = new Set();

          const rawCandidates = [];
          const clientPreLogs = [];
          const metaPrefixRegex = /^(?:Qualität|Qualitaet|Quality|Genre|Gener|Studio|FSK|Jahr|Erscheinungsjahr|Produktionsjahr|Produktionsland|Handlungsjahr|Release|Released|Erstausstrahlung|Ausstrahlung|Premiere|Kinostart|TV-Start|Starttermin|Start|Bewertung|Rating|IMDb|TMDB|Audio|Sprache|Language|Untertitel|Subtitles|Dauer|Laufzeit|Länge|Laenge|Runtime|Regie|Director|Darsteller|Actors|Cast|Handlung|Inhalt|Beschreibung|Plot|Info|Größe|Groesse|Dateigröße|Size|Format|Codec|Quelle|Source|Link|Download|Stream|Kanal|Channel|Preis|Free|Kostenlos)\\s*[:=\\-]/i;

          let rollingPreContext = {};
          const totalMsgs = tgMessages.length;

          for (let i = 0; i < totalMsgs; i++) {
            if (i > 0 && i % 400 === 0) {
              if (statusEl) {
                const pct = Math.min(100, Math.round((i / totalMsgs) * 100));
                statusEl.textContent =
                  "⏳ Lese & analysiere Nachricht " +
                  i.toLocaleString("de-DE") + " / " + totalMsgs.toLocaleString("de-DE") +
                  " (" + pct + "% • " + rawCandidates.length.toLocaleString("de-DE") + " Videos gefunden)...";
              }
              await new Promise(r => setTimeout(r, 0));
            }
            const msg = tgMessages[i];
            if (!msg || (msg.type && msg.type !== "message")) continue;
            const currentMsgId = Number(msg.id || msg.message_id || 0);
            if (currentMsgId > 0) {
              if (processedMsgIds.has(currentMsgId)) continue;
              processedMsgIds.add(currentMsgId);
            }
            const junkReason = classifyClientJunkReason(msg);
            if (junkReason) {
              if (clientDiagnosticLogState?.summaryCounts) {
                clientDiagnosticLogState.summaryCounts.SKIPPED_JUNK = (clientDiagnosticLogState.summaryCounts.SKIPPED_JUNK || 0) + 1;
              }
              if (clientPreLogs.length < 350) {
                clientPreLogs.push({
                  msgId: currentMsgId || null,
                  fileName: String(msg.file_name || msg.media_type || "Sticker/Junk"),
                  rawText: flattenClientTgText(msg.text || msg.caption).slice(0, 140),
                  status: "SKIPPED_JUNK",
                  reason: junkReason,
                  detectedType: "junk",
                  parsedTitle: ""
                });
              }
              continue;
            }
            if (rollingPreContext.lastMessageId && currentMsgId > 0 && Math.abs(currentMsgId - rollingPreContext.lastMessageId) > 25) {
              rollingPreContext = {};
            }

            const rawFileName = String(msg.file_name || "").trim();
            const rawFilePath = String(msg.file || "").trim();
            const validFilePath = rawFilePath && !rawFilePath.startsWith("(File not included")
              ? rawFilePath.split("/").pop()
              : "";

            const flatTextRaw = flattenClientTgText(msg.text || msg.caption || msg.text_entities);
            const flatText = normalizeClientEpisodeText(flatTextRaw);
            const normFileName = normalizeClientEpisodeText(rawFileName || validFilePath);
            // 2. Eiserne Regel ("Video schlägt Header") + MODUL 2 Archive (.rar/.zip/.7z/.iso/.tar/.gz) + Untertitel-Bindung (.srt/.vtt/.sub):
            const isSubMsg = /\\.(?:srt|vtt|sub|ass|ssa)$/i.test(rawFileName || validFilePath);
            if (isSubMsg) {
              const targetVideo = rawCandidates.length > 0 ? rawCandidates[rawCandidates.length - 1] : null;
              if (targetVideo) {
                if (!Array.isArray(targetVideo.subtitle_files)) targetVideo.subtitle_files = [];
                const subMsgId = msg.id || msg.message_id || null;
                const subFid = msg.telegram_file_id || msg.file_id || (backupChatId && subMsgId ? ("tg_export_" + backupChatId + "_" + subMsgId) : null);
                const subLangMatch = (rawFileName || validFilePath || flatTextRaw).match(/\\b(de|ger|german|deutsch|en|eng|english|forced)\\b/i);
                targetVideo.subtitle_files.push({
                  file_id: subFid,
                  file_name: rawFileName || validFilePath || "subtitle.srt",
                  lang: subLangMatch ? subLangMatch[1].toUpperCase() : "UT",
                  message_id: subMsgId,
                  chat_id: backupChatId || null
                });
              }
              continue;
            }
            const isRarMsg = /\\.(?:rar|zip|7z|iso|tar|gz)$/i.test(rawFileName || validFilePath);
            const isVideoMsg =
              msg.media_type === "video_file" ||
              Boolean(msg.video) ||
              /^video\\//i.test(msg.mime_type || "") ||
              /\\.(?:mp4|mkv|avi|mov|m4v|webm|ts|flv|mk3d)$/i.test(rawFileName || validFilePath);
            const isPhotoMsg = !isVideoMsg && !isRarMsg && Boolean(msg.photo || msg.media_type === "photo" || /^image\\//i.test(msg.mime_type || ""));

            // Wenn eine Videodatei oder Archiv-Datei anhängt UND gleichzeitig ein Staffel-/Serien-Header im Text steht (Breaking Bad S03E01 Fix):
            // Aktualisiere zuerst den rollingPreContext, aber brich NIEMALS mit continue ab!
            if (isVideoMsg || isRarMsg) {
              const hasHeaderCue = /\\b(?:Staffel\\s*\\d+|vorschauserien|Miniserie|\\d+\\s+Folgen\\s+in\\s+\\d+\\s+Staffel)/i.test(flatText) ||
                (Array.isArray(msg.text_entities) && msg.text_entities.some(e => String(e?.href || "").includes("vorschauserien")));
              if (hasHeaderCue) {
                rollingPreContext = extractClientPreContextFromMsg(msg, rollingPreContext);
              }
            } else if (!rawFileName && !validFilePath) {
              const prevCtxBeforeMsg = { ...rollingPreContext };
              rollingPreContext = extractClientPreContextFromMsg(msg, prevCtxBeforeMsg);
              if (isPhotoMsg) {
                if (clientDiagnosticLogState?.summaryCounts) {
                  clientDiagnosticLogState.summaryCounts.SKIPPED_HEADER = (clientDiagnosticLogState.summaryCounts.SKIPPED_HEADER || 0) + 1;
                }
                continue;
              }
            }

            const prevMessages = [];
            if (Array.isArray(msg._prevMessages) && msg._prevMessages.length > 0) {
              for (const pm of msg._prevMessages.slice(-2)) {
                const s = buildClientPrevMsgSummary(pm);
                if (s) prevMessages.push(s);
              }
            } else {
              for (const prevOffset of [2, 1]) {
                if (i - prevOffset >= 0) {
                  const s = buildClientPrevMsgSummary(tgMessages[i - prevOffset]);
                  if (s) prevMessages.push(s);
                }
              }
            }

            let effectivePre = { ...rollingPreContext };
            const cleanChatId = String(backupChatId || "").replace(/^-100/, "").replace(/^-/, "");
            const rawMsgIdVal = msg.id ?? msg.message_id ?? null;
            const msgId = (rawMsgIdVal !== null && rawMsgIdVal !== "" && Number.isFinite(Number(rawMsgIdVal)))
              ? Number(rawMsgIdVal)
              : rawMsgIdVal;
            const messageLink = msgId
              ? (backupChatUsername
                  ? ("https://t.me/" + backupChatUsername + "/" + msgId)
                  : (cleanChatId && /^\\d+$/.test(cleanChatId) ? ("https://t.me/c/" + cleanChatId + "/" + msgId) : ""))
              : "";

            const lines = getCleanClientContentLines(flatText)
              .map(l => l.replace(/\\b(?:Beschreibung|Handlung|Inhalt|Plot|Story)\\s*:.*/i, "").trim())
              .filter(l => {
                if (l.length < 2 || /^https?:\\/\\//i.test(l) || /^[@#][^\\s]+$/.test(l) || /^❖\\s*@/.test(l) || /^(?:➠|✔️|🔞|قیمت)/.test(l)) return false;
                return true;
              });
            const contentLines = lines.filter(l => !metaPrefixRegex.test(l));
            const firstTextLine = contentLines[0] || "";

            const safeTextForYear = flatText.replace(/\\b\\d{1,2}\\.\\d{1,2}\\.(?:19\\d{2}|20\\d{2}|\\d{2})\\b/g, " ");
            const yearInText = (" " + safeTextForYear + " ").match(/(?:[(\\[\\-\\s_.·‧])(?:(?:DDR|BRD|USA|UK|DE|FR|IT|ES)\\s+)?(?<!\\d{1,2}[./-]\\d{1,2}[./-])(19[2-9]\\d|20[0-2]\\d)(?![./-]\\d|\\d)(?:[)\\]\\s._\\-·‧]|$)/i)?.[1] || effectivePre.year || null;
            const seInFileRaw = normFileName ? normFileName.match(/\\bS(\\d{1,2})[\\s._-]*E(\\d{1,3})(?:[-–]E?(\\d{1,3}))?\\b/i) : null;
            const seInFile = seInFileRaw
              ? ("S" + String(parseInt(seInFileRaw[1], 10) || 1).padStart(2, "0") + "E" + String(parseInt(seInFileRaw[2], 10) || 1).padStart(2, "0"))
              : null;
            let seInText = seInFile || flatText.match(/\\b(S\\d{1,2}[\\s._-]*E\\d{1,3}(?:[-–]E?\\d{1,3})?|(?:Folge|Episode)\\s*0*\\d{1,3})\\b/i)?.[1] || null;
            if (!seInFile && seInText && /^(?:Folge|Episode)/i.test(seInText)) {
              const epDigits = seInText.match(/(\\d{1,3})/)?.[1] || "1";
              const ctxSeason = effectivePre.season || 1;
              seInText = "S" + String(ctxSeason).padStart(2, "0") + "E" + String(epDigits).padStart(2, "0");
            }
            const detectedQual = detectClientVideoQuality(msg, flatText, rawFileName);

            if (!rawFileName && !validFilePath && !isVideoMsg && !isRarMsg && !isPhotoMsg && contentLines.length >= 2 && !/\\b\\d+\\s*Folgen\\s+in\\s+\\d+\\s*Staffel/i.test(flatText)) {
              const multiLinesWithMedia = contentLines.filter(l =>
                l.length <= 110 && /\\b(?:19\\d{2}|20[0-2]\\d|S\\d{1,2}E\\d{1,3}|1080p|720p|2160p|4K|x264|x265|BluRay|WEB-DL)\\b/i.test(l)
              );
              if (multiLinesWithMedia.length >= 2) {
                for (const lineStr of multiLinesWithMedia) {
                  rawCandidates.push({
                    filename: lineStr,
                    rawInput: lineStr,
                    raw_file_name: "",
                    raw_text: flatTextRaw.slice(0, 500),
                    parsed_from: "Text-Liste",
                    message_id: msgId,
                    chat_id: backupChatId || null,
                    message_link: messageLink,
                    prev_messages: prevMessages,
                    pre_context: effectivePre,
                    telegram_file_id: null,
                    file_size: null,
                    mime_type: "video/mp4"
                  });
                }
                continue;
              }
            }

            if (!isVideoMsg && !isRarMsg && !rawFileName && !validFilePath) {
              if (flatTextRaw.trim() && clientDiagnosticLogState?.summaryCounts) {
                clientDiagnosticLogState.summaryCounts.SKIPPED_HEADER = (clientDiagnosticLogState.summaryCounts.SKIPPED_HEADER || 0) + 1;
              }
              continue;
            }

            const isGenericFile = !(rawFileName || validFilePath) || /^(?:video|new+|vmp4|\\d+|d-[a-z0-9-]+)\\.(mp4|mkv|avi|m4v|ts)$/i.test((rawFileName || validFilePath).trim());
            const cleanFirstLine = cleanClientMediaTitle(firstTextLine.replace(/\\bStaffel\\s*\\d+.*/i, ""));
            if (isGenericFile && !cleanFirstLine && !effectivePre.title && !effectivePre.seriesHeader && !effectivePre.tmdbId) {
              continue;
            }

            // Regel 3: Mehrzeilige Serien-Posts (Zeilen 2 bis 12 nach S01E01 oder Folge X durchsuchen - Breaking Bad S03E01 Fix!)
            let multiLineSeLine = "";
            let multiLineEpTitle = "";
            for (let li = 1; li < Math.min(contentLines.length, 12); li++) {
              const mLine = contentLines[li].match(/\\b(S\\d{1,2}[\\s._-]*E\\d{1,3}(?:[-–]E?\\d{1,3})?|(?:Folge|Episode)\\s*0*\\d{1,3})\\b/i);
              if (mLine) {
                let rawCode = mLine[1];
                if (/^(?:Folge|Episode)/i.test(rawCode)) {
                  const epD = rawCode.match(/(\\d{1,3})/)?.[1] || "1";
                  rawCode = "S" + String(effectivePre.season || 1).padStart(2, "0") + "E" + String(epD).padStart(2, "0");
                }
                multiLineSeLine = rawCode;
                const afterInLine = cleanClientMediaTitle(contentLines[li].slice(mLine.index + mLine[0].length));
                const nextLine = contentLines[li + 1] ? cleanClientMediaTitle(contentLines[li + 1]) : "";
                multiLineEpTitle = afterInLine || nextLine || "";
                break;
              }
            }

            // "Episode 6 Staffel 2 von Little Britain.mp4" Context-Bleeding Fix:
            // Extrahiere den Seriennamen hinter "von" VOR jedem Fallback auf effectivePre und überschreibe sofort den alten Kontext!
            const rawVonSource = String(rawFileName || validFilePath || normFileName || firstTextLine || "");
            const vonMatch = rawVonSource.match(/(?:Episode|Folge)[\\s._]*(\\d+)(?:[\\s._\\-&]+\\d+)?[\\s._\\-]*(?:Staffel|Season)[\\s._]*(\\d+)[\\s._\\-]*von[\\s._]+(.+?)(?:\\.mp4|\\.mkv|\\.avi|s_to_Serien|_sto_Serien|[\\s._]+(?:s[_. ]to|Sto|serien|HD|Online|❤)|$)/i);
            let vonSeriesTitle = "";
            if (vonMatch) {
              const epFromVon = parseInt(vonMatch[1], 10) || 1;
              const seFromVon = parseInt(vonMatch[2], 10) || 1;
              vonSeriesTitle = cleanClientMediaTitle(vonMatch[3].replace(/_/g, " ").trim()) || vonMatch[3].replace(/_/g, " ").trim();
              seInText = "S" + String(seFromVon).padStart(2, "0") + "E" + String(epFromVon).padStart(2, "0");
              if (vonSeriesTitle) {
                rollingPreContext = {
                  seriesHeader: vonSeriesTitle,
                  season: seFromVon,
                  isSeriesHeader: true,
                  lastMessageId: currentMsgId
                };
                effectivePre = { ...rollingPreContext };
              }
            }

            // Anführende 2- oder 3-stellige Zahl als Folge erkennen ("05 Ein Star ist geboren", "13 Hochzeitspläne")
            const leadEpCandidateStr = String(normFileName || firstTextLine || "").trim();
            const leadEpMatch = (!seInText && !multiLineSeLine && !vonMatch && (Number(msg.duration_seconds || 0) <= 0 || Number(msg.duration_seconds || 0) < 4200))
              ? leadEpCandidateStr.match(/^(?:0*(\\d{2,3}))[\\s\\-]+([A-Za-zÄÖÜäöüß].{2,})$/)
              : null;
            const numberedMovieGuardClientRe = /^(?:12\\s+angry\\s+men|12\\s+years\\s+a\\s+slave|12\\s+monkeys|13\\s+hours|13\\s+assassins|13\\s+going\\s+on\\s+30|13\\s+geister|13\\s+ghosts|13\\s+sins|16\\s+blocks|17\\s+again|21\\s+jump\\s+street|22\\s+jump\\s+street|24\\s+hour\\s+party|27\\s+dresses|28\\s+days|28\\s+weeks|28\\s+years|30\\s+days\\s+of\\s+night|40\\s+year\\s+old|47\\s+ronin|47\\s+meters|50\\s+first\\s+dates|50\\s+shades|65\\s+million|88\\s+minutes|96\\s+hours|99\\s+homes|100\\s+things|100\\s+dinge|101\\s+dalmat|102\\s+dalmat|127\\s+hours|300\\s+rise|500\\s+days)\\b/i;
            let isLeadingNumberEpisode = false;
            if (leadEpMatch && !numberedMovieGuardClientRe.test(leadEpCandidateStr) && !/\\b(?:19[2-9]\\d|20[0-2]\\d)\\b/.test(leadEpCandidateStr)) {
              const epVal = parseInt(leadEpMatch[1], 10);
              if (epVal >= 1 && epVal <= 399) {
                isLeadingNumberEpisode = true;
                const ctxSeason = effectivePre.season || rollingPreContext.season || 1;
                seInText = "S" + String(ctxSeason).padStart(2, "0") + "E" + String(epVal).padStart(2, "0");
                multiLineEpTitle = cleanClientMediaTitle(leadEpMatch[2]);
                if (rollingPreContext.seriesHeader) {
                  rollingPreContext.lastMessageId = currentMsgId;
                }
              }
            }

            // Schutzregel ("The Rookie S01E11" / "E01S01 Frontier 2016" / "Episode 6 Staffel 2 von Little Britain"):
            // Wenn die Datei oder Caption bereits einen EIGENEN Seriennamen mitbringt, darf dieser NIEMALS vom effectivePre der vorherigen Serie überschrieben werden!
            const fileCleanOwn = vonSeriesTitle
              ? vonSeriesTitle
              : (!isGenericFile && !isLeadingNumberEpisode ? cleanClientMediaTitle(( normFileName || "" ).replace(/\\bS\\d{1,2}[\\s._-]*E\\d{1,3}.*$/i, "")) : "");
            const textCleanOwn = (cleanFirstLine && !isLikelyClientPlotDescription(firstTextLine) && !isLeadingNumberEpisode)
              ? cleanClientMediaTitle(firstTextLine.replace(/\\bS\\d{1,2}[\\s._-]*E\\d{1,3}.*$/i, "").replace(/\\bStaffel\\s*\\d+.*/i, ""))
              : "";
            const ownExplicitSeriesTitle = vonSeriesTitle || ((textCleanOwn && textCleanOwn.length >= 2) ? textCleanOwn : ((fileCleanOwn && fileCleanOwn.length >= 2) ? fileCleanOwn : ""));

            const normOwnSeries = normalizeClientCompareTitle(ownExplicitSeriesTitle);
            const normHeaderSeries = effectivePre.seriesHeader ? normalizeClientCompareTitle(effectivePre.seriesHeader) : "";
            const isSameSeriesWithEpSuffix = Boolean(
              normOwnSeries &&
              normHeaderSeries &&
              (normOwnSeries === normHeaderSeries || /^(.+?)\\s+0*\\d{1,2}(?:\\s+.+)?$/.exec(normOwnSeries)?.[1] === normHeaderSeries)
            );

            if (ownExplicitSeriesTitle && effectivePre.seriesHeader && !isSameSeriesWithEpSuffix) {
              const hasExplicitEpCue = Boolean(vonSeriesTitle || seInText || multiLineSeLine || /^(?:pippi langstrumpf|zur see|spuk im hochhaus|spuk unterm riesenrad|spuk von draußen|black box)\\b/i.test(ownExplicitSeriesTitle));
              effectivePre = { lastMessageId: currentMsgId };
              if (hasExplicitEpCue) {
                const strippedNewHeader = cleanClientMediaTitle(ownExplicitSeriesTitle.replace(/\\s+0*([1-9]\\d?)(?:\\s+.+)?$/, "")) || ownExplicitSeriesTitle;
                rollingPreContext = { seriesHeader: strippedNewHeader, isSeriesHeader: true, lastMessageId: currentMsgId };
                effectivePre = { ...rollingPreContext };
              } else {
                rollingPreContext = { lastMessageId: currentMsgId };
              }
            }

            let baseCandidate = "";
            let parsedFrom = isRarMsg ? "RAR-Archiv" : "Dateiname";
            const ownVideoTitleCandidate = cleanFirstLine || fileCleanOwn || "";
            const ownBaseWord = ownVideoTitleCandidate
              .toLowerCase()
              .replace(/^(?:der|die|das|the|a|disneys|disney's|marvels|marvel's|pixars|pixar's)\\s+/i, "")
              .split(/[\\s:,\\-–_.]+/)[0];
            const preTitleMatchesOwn = !ownBaseWord || ownBaseWord.length < 3 ||
              (effectivePre.title && String(effectivePre.title).toLowerCase().includes(ownBaseWord));

            // Beschreibungs-Schutz ("Ted Bundy" / "Cocaine Bear" MODUL 2.5): Nur echte Beschreibungssätze (> 120 Zeichen oder > 15 Wörter) als Beschreibung werten!
            const firstLineIsDescription = isLikelyClientPlotDescription(firstTextLine);

            if (vonSeriesTitle) {
              baseCandidate = vonSeriesTitle + " " + seInText;
              parsedFrom = "Dateiname (Episode X Staffel Y von Serie)";
            } else if (isLeadingNumberEpisode && (effectivePre.seriesHeader || effectivePre.title)) {
              baseCandidate = (effectivePre.seriesHeader || effectivePre.title) + " " + seInText + (multiLineEpTitle ? (" - " + multiLineEpTitle) : "");
              parsedFrom = "Serien-Header + Episodennummer";
            } else if (!ownExplicitSeriesTitle && effectivePre.title && ((isGenericFile && !cleanFirstLine) || preTitleMatchesOwn) && (effectivePre.tmdbId || effectivePre.imdbId || isGenericFile || !cleanFirstLine)) {
              baseCandidate = effectivePre.title + (seInText ? (" " + seInText) : "");
              parsedFrom = "Vorab-Steckbrief (Nachricht darüber)";
            } else if (!ownExplicitSeriesTitle && effectivePre.seriesHeader && (isGenericFile || !cleanFirstLine)) {
              baseCandidate = effectivePre.seriesHeader + (seInText ? (" " + seInText) : "");
              parsedFrom = "Serien-Header (Nachricht darüber)";
            } else if (multiLineSeLine && cleanFirstLine && !firstLineIsDescription) {
              baseCandidate = cleanFirstLine + " " + (seInFile || multiLineSeLine) + (multiLineEpTitle ? (" - " + multiLineEpTitle) : "");
              parsedFrom = "Caption Zeile 1";
            } else if (cleanFirstLine && firstTextLine.length >= 2 && !firstLineIsDescription) {
              // Regel 2: Cross-Check Text <-> Dateiname (z. B. D O P E T H I E F im Text vs Dope.Thief im Dateinamen)
              const rawSpaced = /^(?:[A-Za-zÄÖÜäöüß]\\s+){3,}[A-Za-zÄÖÜäöüß]/.test(firstTextLine);
              if (rawSpaced && normFileName && !isGenericFile) {
                baseCandidate = normFileName;
                parsedFrom = "Dateiname (Cross-Check)";
              } else {
                // Dateiname hat Vorrang vor Caption-Tippfehlern (ID 911: "Queen of the South S01E13.mp4" vs Caption "Queen of the South S01E3")
                baseCandidate = seInFile
                  ? firstTextLine.replace(/\\bS\\d{1,2}[\\s._-]*E\\d{1,3}(?:[-–]E?\\d{1,3})?\\b/i, seInFile)
                  : firstTextLine;
                parsedFrom = isRarMsg ? "RAR-Archiv (Caption)" : "Caption Zeile 1";
              }
            } else {
              baseCandidate = normFileName || (firstLineIsDescription ? firstTextLine.split(/[:\\n(]/)[0].trim() : firstTextLine);
              parsedFrom = isRarMsg ? "RAR-Archiv" : (rawFileName ? "Dateiname" : "Caption");
            }

            if (!baseCandidate || baseCandidate.length < 2) continue;
            if (/^(?:trailer|coming soon)\\b/i.test(baseCandidate) || /\\b(official trailer|kinotrailer|coming\\s+soon)\\b/i.test(flatText.slice(0, 80))) {
              if (clientPreLogs.length < 350) {
                clientPreLogs.push({
                  msgId: currentMsgId ? Number(currentMsgId) : null,
                  fileName: rawFileName || baseCandidate,
                  rawText: flatTextRaw.slice(0, 140),
                  status: "SKIPPED_JUNK",
                  reason: "🎬 Trailer / Coming Soon übersprungen",
                  detectedType: "junk",
                  parsedTitle: baseCandidate
                });
              }
              continue;
            }

            let enrichedName = seInFile
              ? baseCandidate.replace(/\\bS\\d{1,2}[\\s._-]*E\\d{1,3}(?:[-–]E?\\d{1,3})?\\b/i, seInFile)
              : baseCandidate;
            if (seInText && !/\\b(?:S\\d{1,2}[\\s._-]*E\\d{1,3}|Folge\\s*\\d+|Episode\\s*\\d+)\\b/i.test(enrichedName)) {
              enrichedName += " " + seInText;
            }
            if (yearInText && !/\\b(?:19\\d{2}|20[0-2]\\d)\\b/.test(enrichedName)) {
              enrichedName += " (" + yearInText + ")";
            }
            if (detectedQual && !/\\b(?:2160p|4K|UHD|1080p|FHD|720p|HD|480p|360p)\\b/i.test(enrichedName)) {
              enrichedName += " " + detectedQual;
            }

            // Stufe 1 (Arielle 2023): Nachbar-Post (+1 / -1 / +2 / -2) auf passenden Voll-Titel & Beschreibungstext prüfen
            let neighborEnrichedTitle = null;
            let neighborEnrichedYear = null;
            let neighborContextOverview = "";
            if (!seInText && !multiLineSeLine && effectivePre.mediaType !== "tv" && !effectivePre.seriesHeader) {
              const prelimParsed = parseClientMediaPreview(enrichedName, Number(msg.duration_seconds || 0), msg);
              if (!prelimParsed.isSeries && prelimParsed.cleanTitle && prelimParsed.cleanTitle !== "Unbekannt") {
                const enrichedNeighbor = enrichClientVideoFromNeighborPost(tgMessages, i, {
                  title: prelimParsed.cleanTitle,
                  year: prelimParsed.year || yearInText || null
                });
                if (enrichedNeighbor && (enrichedNeighbor.contextOverview || enrichedNeighbor.title !== prelimParsed.cleanTitle)) {
                  neighborEnrichedTitle = enrichedNeighbor.title;
                  neighborEnrichedYear = enrichedNeighbor.year || prelimParsed.year || null;
                  neighborContextOverview = enrichedNeighbor.contextOverview || "";
                  parsedFrom = parsedFrom + " + Nachbar-Post";
                }
              }
            }

            const rarPartObj = isRarMsg ? extractClientPartInfo(flatTextRaw, rawFileName || validFilePath, 0) : null;
            rawCandidates.push({
              filename: enrichedName,
              rawInput: rawFileName || validFilePath || firstTextLine || enrichedName,
              raw_file_name: rawFileName || validFilePath || "",
              raw_text: flatTextRaw.slice(0, 600),
              parsed_from: parsedFrom,
              cleanTitle: neighborEnrichedTitle || undefined,
              year: neighborEnrichedYear || undefined,
              contextOverview: neighborContextOverview || undefined,
              neighborEnriched: Boolean(neighborEnrichedTitle || neighborContextOverview),
              tmdb_id: effectivePre.tmdbId || null,
              imdb_id: effectivePre.imdbId || null,
              type: effectivePre.mediaType === "tv" ? "series" : (effectivePre.mediaType === "movie" ? "movie" : undefined),
              quality: detectedQual,
              codec: isRarMsg ? "RAR" : undefined,
              part: rarPartObj ? rarPartObj.partLabel : undefined,
              isArchive: isRarMsg,
              tags: isRarMsg ? "📦 RAR-Archiv" : undefined,
              width: Number(msg.width || msg.video?.width || 0) || null,
              height: Number(msg.height || msg.video?.height || 0) || null,
              duration_sec: Number(msg.duration_seconds || 0),
              message_id: msgId,
              msg_id: msgId,
              chat_id: backupChatId || null,
              chat_username: backupChatUsername || null,
              message_link: messageLink,
              prev_messages: prevMessages,
              pre_context: { ...effectivePre },
              telegram_file_id: msg.telegram_file_id || msg.file_id || null,
              file_size: msg.file_size || null,
              mime_type: isRarMsg ? "application/x-rar" : (msg.mime_type || "video/mp4")
            });

            // Film-Steckbrief nach dem zugehörigen Video verbrauchen (Fall 16: IDs 108709-108715)
            delete rollingPreContext.tmdbId;
            delete rollingPreContext.imdbId;
            delete rollingPreContext.title;
            delete rollingPreContext.originalTitle;
            if (!rollingPreContext.seriesHeader) {
              delete rollingPreContext.year;
              delete rollingPreContext.mediaType;
            }
            if ((parsedFrom === "Caption Zeile 1" || parsedFrom === "Dateiname (Cross-Check)") && (seInText || multiLineSeLine) && cleanFirstLine) {
              const sHead = cleanClientMediaTitle(firstTextLine.replace(/\\b(?:S\\d{1,2}[\\s._-]*E\\d{1,3}|Staffel\\s*\\d+.*)\\b/i, ""));
              if (sHead && sHead.length >= 2) {
                if (rollingPreContext.seriesHeader !== sHead) delete rollingPreContext.year;
                rollingPreContext.seriesHeader = sHead;
                rollingPreContext.lastMessageId = Number(msgId || 0);
              }
            }
          }

          const classified = await deduplicateAndClassifyClientEntries(rawCandidates, statusEl);
          if (typeof appendClientDiagnosticLogs === "function" && clientPreLogs.length > 0) {
            appendClientDiagnosticLogs(clientPreLogs);
          }

          return {
            fileName,
            fileSizeMb: (fileSizeBytes / (1024 * 1024)).toFixed(2),
            isTelegramBackup: true,
            backupChatName,
            backupChatId,
            backupChatUsername,
            rawMessageCount: tgMessages.length,
            repaired: Boolean(repairMeta?.repaired),
            repairNotes: repairMeta?.repairNotes || [],
            ...classified
          };
        }

        const rawList = Array.isArray(parsedJson)
          ? parsedJson
          : Array.isArray(parsedJson?.items)
            ? parsedJson.items
            : Array.isArray(parsedJson?.titles)
              ? parsedJson.titles
              : Array.isArray(parsedJson?.movies)
                ? parsedJson.movies
                : [parsedJson];

        const classified = await deduplicateAndClassifyClientEntries(rawList, statusEl);

        return {
          fileName,
          fileSizeMb: (fileSizeBytes / (1024 * 1024)).toFixed(2),
          isTelegramBackup: false,
          backupChatName: String(parsedJson?.playlistName || parsedJson?.name || ""),
          backupChatId: "",
          backupChatUsername: "",
          rawMessageCount: rawList.length,
          repaired: Boolean(repairMeta?.repaired),
          repairNotes: repairMeta?.repairNotes || [],
          ...classified
        };
      }

      // >200 MB Stream-Slice Reader (liest 200 MB - 2 GB+ result.json Dateien in 2 MB File.slice() Blöcken UND bewahrt die 2 Nachrichten über jedem Video!)
      async function streamParseLargeClientBackupFile(file, statusEl) {
        const SLICE_BYTES = 2 * 1024 * 1024;
        const totalBytes = file.size;
        let offset = 0;
        let backupChatName = file.name.replace(/\\.json$/i, "");
        let backupChatId = "";
        let rawMsgCount = 0;
        const extractedMessages = [];
        const recentWindowMsgs = [];

        let insideArray = false;
        let braceDepth = 0;
        let inString = false;
        let isEscaped = false;
        let currentObjStr = "";
        let postVideoFollowRemaining = 0;

        while (offset < totalBytes) {
          const end = Math.min(totalBytes, offset + SLICE_BYTES);
          const chunkText = await file.slice(offset, end).text();

          if (offset === 0) {
            const headerSlice = chunkText.slice(0, 2048);
            const nameMatch = headerSlice.match(/"name"\\s*:\\s*"([^"]+)"/);
            if (nameMatch && nameMatch[1]) backupChatName = nameMatch[1].trim();
            const idMatch = headerSlice.match(/"id"\\s*:\\s*(\\d+)/);
            if (idMatch && idMatch[1]) backupChatId = idMatch[1].trim();
          }

          for (let i = 0; i < chunkText.length; i++) {
            const ch = chunkText[i];
            if (!insideArray) {
              if (ch === "[") insideArray = true;
              continue;
            }
            if (braceDepth > 0) currentObjStr += ch;
            if (inString) {
              if (isEscaped) isEscaped = false;
              else if (ch === "\\\\") isEscaped = true;
              else if (ch === '"') inString = false;
              continue;
            }
            if (ch === '"') {
              inString = true;
              continue;
            }
            if (ch === "{") {
              if (braceDepth === 0) currentObjStr = "{";
              braceDepth++;
            } else if (ch === "}") {
              braceDepth--;
              if (braceDepth === 0 && currentObjStr) {
                rawMsgCount++;
                const isCandidateVideo =
                  currentObjStr.includes("video") ||
                  currentObjStr.includes("file_name") ||
                  currentObjStr.includes(".mkv") ||
                  currentObjStr.includes(".mp4") ||
                  currentObjStr.includes(".avi") ||
                  currentObjStr.includes("1080p") ||
                  currentObjStr.includes("2160p") ||
                  currentObjStr.includes("720p") ||
                  currentObjStr.includes("4K");

                try {
                  const parsedMsgObj = JSON.parse(currentObjStr);
                  if (isCandidateVideo) {
                    parsedMsgObj._prevMessages = recentWindowMsgs.slice(-2);
                    extractedMessages.push(parsedMsgObj);
                    postVideoFollowRemaining = 2;
                  } else if (postVideoFollowRemaining > 0) {
                    extractedMessages.push(parsedMsgObj);
                    postVideoFollowRemaining--;
                  }
                  recentWindowMsgs.push({
                    id: parsedMsgObj.id,
                    date: parsedMsgObj.date,
                    photo: parsedMsgObj.photo,
                    file_name: parsedMsgObj.file_name,
                    text: parsedMsgObj.text,
                    caption: parsedMsgObj.caption,
                    text_entities: parsedMsgObj.text_entities
                  });
                  if (recentWindowMsgs.length > 4) recentWindowMsgs.shift();
                } catch (e) {}
                currentObjStr = "";
              }
            }
          }

          offset = end;
          if (statusEl) {
            const pct = Math.min(100, Math.round((offset / totalBytes) * 100));
            statusEl.textContent =
              "✂️ Stream-Slicer (" + pct + "%): " +
              (offset / (1024 * 1024)).toFixed(1) + " / " + (totalBytes / (1024 * 1024)).toFixed(1) +
              " MB • " + extractedMessages.length.toLocaleString("de-DE") + " Video-Einträge (inkl. Nachbar-Kontext) gefiltert...";
          }
          await new Promise(r => setTimeout(r, 4));
        }

        const syntheticParsed = { id: backupChatId || undefined, name: backupChatName, messages: extractedMessages };
        const info = await detectAndParseClientBackupJson(syntheticParsed, file.name, file.size, {
          repaired: true,
          repairNotes: [
            "2 MB Stream-Slicer für Großdatei (" + (totalBytes / (1024 * 1024)).toFixed(1) + " MB): " +
            rawMsgCount.toLocaleString("de-DE") + " Roh-Nachrichten gescannt, inkl. 2-Nachrichten-Kontext über jedem Video"
          ]
        }, statusEl);
        info.rawMessageCount = rawMsgCount;
        return info;
      }

      function downloadBackupSplitPartClient(partIndexZeroBased, chunkSize = 250) {
        const entries = backupImportJob?.entries || [];
        if (!entries.length) return;
        const safeSize = Math.max(25, Number(chunkSize) || 250);
        const slice = entries.slice(partIndexZeroBased * safeSize, (partIndexZeroBased + 1) * safeSize);
        if (!slice.length) return;
        const totalParts = Math.ceil(entries.length / safeSize);
        const partNum = String(partIndexZeroBased + 1).padStart(3, "0");
        const baseName = String(backupImportJob.fileName || "result").replace(/\\.json$/i, "");
        const payload = {
          name: (backupImportJob.customPlaylistName || baseName) + " (Part " + (partIndexZeroBased + 1) + "/" + totalParts + ")",
          id: backupImportJob.backupChatId || undefined,
          partIndex: partIndexZeroBased + 1,
          totalParts,
          chunkSize: safeSize,
          messages: slice.map((item, idx) => ({
            id: item.message_id || (idx + 1),
            type: "message",
            file_name: item.filename || item.rawInput,
            text: item.raw_text || "",
            media_type: "video_file",
            mime_type: item.mime_type || "video/mp4",
            file_size: item.file_size || null,
            telegram_file_id: item.telegram_file_id || null,
            _prevMessages: item.prev_messages || []
          }))
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = baseName + "_part_" + partNum + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showHudToast("💾 " + baseName + "_part_" + partNum + ".json (" + slice.length + " Videos) heruntergeladen");
      }

      function getHowToCliSnippetsClient() {
        const dq = String.fromCharCode(34);
        const bs = String.fromCharCode(92);
        const jqCmd =
          "jq '{name: .name, id: .id, messages: [.messages[] | select(.media_type == " +
          dq + "video_file" + dq +
          " or (.file_name // " + dq + dq + " | test(" +
          dq + bs + bs + ".(mp4|mkv|avi|mov)$" + dq + "; " + dq + "i" + dq +
          "))) ]}' result.json > result_videos_only.json";
        const pyCmd = [
          "import json",
          "with open('result.json', 'r', encoding='utf-8') as f:",
          "    data = json.load(f)",
          "msgs = data.get('messages', [])",
          "out = []",
          "for i, m in enumerate(msgs):",
          "    fn = str(m.get('file_name') or '').lower()",
          "    if m.get('media_type') == 'video_file' or fn.endswith(('.mp4', '.mkv', '.avi')):",
          "        m['_prevMessages'] = msgs[max(0, i-2):i]",
          "        out.append(m)",
          "for idx in range(0, len(out), 250):",
          "    part = {'name': data.get('name', 'Export'), 'id': data.get('id'), 'messages': out[idx:idx+250]}",
          "    with open(f'result_part_{idx//250+1:03d}.json', 'w', encoding='utf-8') as pf:",
          "        json.dump(part, pf, ensure_ascii=False, indent=2)"
        ].join("\\n");
        return { jqCmd, pyCmd };
      }

      function copyHowToSnippetClient(which) {
        const snippets = getHowToCliSnippetsClient();
        const textToCopy = which === "py" ? snippets.pyCmd : snippets.jqCmd;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          navigator.clipboard.writeText(textToCopy).then(() => {
            showHudToast("📋 " + (which === "py" ? "Python 3 Splitter-Skript" : "jq-Kommando") + " in die Zwischenablage kopiert!");
          }).catch(() => {});
        }
      }

      function openLargeJsonHowToModalClient() {
        const modal = document.getElementById("modalRoot");
        if (!modal) return;
        modal.innerHTML =
          '<div class="modal-backdrop" onclick="if(event.target===this)closeDetailModal()">' +
            '<div class="modal" style="max-width:740px;padding:18px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">' +
                '<div style="font-size:16px;font-weight:900;color:#0284c7">✂️ How-To: Telegram JSON-Backups über 200 MB splitten & importieren</div>' +
                '<button class="btn close-slate" onclick="closeDetailModal()">✖ Schließen</button>' +
              '</div>' +
              '<div style="font-size:12.5px;color:var(--text);line-height:1.55;display:flex;flex-direction:column;gap:12px">' +
                '<div class="admin-sub-box" style="border-color:rgba(14,165,233,0.35);padding:12px">' +
                  '<b style="color:var(--text)">1. Warum 200 MB+ Dateien besondere Verarbeitung brauchen:</b><br/>' +
                  'Große Telegram-Gruppen enthalten oft hunderttausende Textnachrichten. ' +
                  'Unser integrierter <b>2 MB Browser-Stream-Slicer (<code>File.slice()</code>)</b> liest auch 500 MB+ Dateien stückweise im Browser aus, bewahrt automatisch die <b>2 Nachrichten über jedem Video (Steckbrief-Kontext)</b> und teilt alles in <b>250er Video-Chunks</b> auf.' +
                '</div>' +
                '<div class="admin-sub-box" style="border-color:rgba(16,185,129,0.35);padding:12px">' +
                  '<b style="color:#10b981">2. Optimaler Export in Telegram Desktop (ohne Video-Dateien herunterzuladen):</b><br/>' +
                  '1. Gruppe/Kanal in Telegram Desktop öffnen ➔ <b>⋮ ➔ Chatverlauf exportieren</b>.<br/>' +
                  '2. <b>Alle Haken bei Medien (Fotos, Videos, Sprachnachrichten) deaktivieren</b> – es werden nur die Dateinamen & Captions benötigt!<br/>' +
                  '3. Format auf <b>Maschinenlesbares JSON (<code>result.json</code>)</b> stellen und hier im Backup-Tab auswählen.' +
                '</div>' +
                '<div class="admin-sub-box" style="border-color:rgba(245,158,11,0.35);padding:12px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                    '<b style="color:#f59e0b">3. Optionales Terminal-Kommando (jq / Python 3) für 1 GB+ Backups:</b>' +
                    '<div style="display:flex;gap:6px">' +
                      '<button type="button" class="btn" style="padding:3px 9px;font-size:11px" onclick="copyHowToSnippetClient(\\'jq\\')">📋 jq kopieren</button>' +
                      '<button type="button" class="btn amber" style="padding:3px 9px;font-size:11px" onclick="copyHowToSnippetClient(\\'py\\')">📋 Python-Splitter kopieren</button>' +
                    '</div>' +
                  '</div>' +
                  '<pre id="howToJqCodeEl" class="admin-code-pill" style="padding:8px;border-radius:6px;overflow-x:auto;font-size:11px;color:#0284c7;margin-top:6px;white-space:pre-wrap"></pre>' +
                  '<pre id="howToPyCodeEl" class="admin-code-pill" style="padding:8px;border-radius:6px;overflow-x:auto;font-size:11px;color:#10b981;margin-top:6px;white-space:pre"></pre>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>';
        const snippets = getHowToCliSnippetsClient();
        const jqEl = document.getElementById("howToJqCodeEl");
        const pyEl = document.getElementById("howToPyCodeEl");
        if (jqEl) jqEl.textContent = snippets.jqCmd;
        if (pyEl) pyEl.textContent = snippets.pyCmd;
      }

      const BACKUP_CHECKPOINT_STORAGE_KEY = "tma_backup_import_checkpoint_v1";
      const BACKUP_IDB_NAME = "tma_backup_job_idb_v1";
      const BACKUP_IDB_STORE = "backup_jobs";
      const BACKUP_IDB_KEY = "active_job";
      let _backupIdbPromise = null;
      let _backupIdbSaveTimer = null;
      let _backupSessionRestorePromise = null;

      function openBackupJobIndexedDbClient() {
        if (typeof indexedDB === "undefined") return Promise.resolve(null);
        if (_backupIdbPromise) return _backupIdbPromise;
        _backupIdbPromise = new Promise((resolve) => {
          try {
            const req = indexedDB.open(BACKUP_IDB_NAME, 1);
            req.onupgradeneeded = (ev) => {
              try {
                const db = ev.target.result;
                if (!db.objectStoreNames.contains(BACKUP_IDB_STORE)) {
                  db.createObjectStore(BACKUP_IDB_STORE);
                }
              } catch (e) {}
            };
            req.onsuccess = (ev) => resolve(ev.target.result || null);
            req.onerror = () => {
              _backupIdbPromise = null;
              resolve(null);
            };
          } catch (e) {
            _backupIdbPromise = null;
            resolve(null);
          }
        });
        return _backupIdbPromise;
      }

      async function saveBackupJobToIndexedDbClient(immediate = false) {
        if (!backupImportJob || (!backupImportJob.fileName && (!Array.isArray(backupImportJob.entries) || backupImportJob.entries.length === 0))) {
          return;
        }
        const doSave = async () => {
          try {
            const db = await openBackupJobIndexedDbClient();
            if (!db) return;
            const snapshot = {
              fileName: backupImportJob.fileName || "",
              fileSizeMb: backupImportJob.fileSizeMb || "0.00",
              fileSignature: backupImportJob.fileSignature || "",
              isTelegramBackup: Boolean(backupImportJob.isTelegramBackup),
              backupChatName: backupImportJob.backupChatName || "",
              backupChatId: backupImportJob.backupChatId || "",
              verifiedChannelId: backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient(),
              rawMessageCount: Number(backupImportJob.rawMessageCount || 0),
              detectedMoviesCount: Number(backupImportJob.detectedMoviesCount || 0),
              detectedSeriesCount: Number(backupImportJob.detectedSeriesCount || 0),
              duplicatesSkippedInFile: Number(backupImportJob.duplicatesSkippedInFile || 0),
              qualityVariantsInFile: Number(backupImportJob.qualityVariantsInFile || 0),
              previewSamples: Array.isArray(backupImportJob.previewSamples) ? backupImportJob.previewSamples.slice(0, 12) : [],
              entries: Array.isArray(backupImportJob.entries) ? backupImportJob.entries : [],
              customPlaylistName: backupImportJob.customPlaylistName || "",
              playlistMode: backupImportJob.playlistMode || "both",
              targetPlaylistChatId: backupImportJob.targetPlaylistChatId || String(chatId || ""),
              playlistFolderId: backupImportJob.playlistFolderId || "",
              cursor: Number(backupImportJob.cursor || 0),
              moviesSaved: Number(backupImportJob.moviesSaved || 0),
              seriesSaved: Number(backupImportJob.seriesSaved || 0),
              duplicatesInDb: Number(backupImportJob.duplicatesInDb || 0),
              mergedQualitiesInDb: Number(backupImportJob.mergedQualitiesInDb || 0),
              uncertainCount: Number(backupImportJob.uncertainCount || 0),
              failedCount: Number(backupImportJob.failedCount || 0),
              recentLog: Array.isArray(backupImportJob.recentLog) ? backupImportJob.recentLog.slice(-40) : [],
              livePosterFeed: Array.isArray(backupImportJob.livePosterFeed) ? backupImportJob.livePosterFeed.slice(0, 16) : [],
              reviewItems: Array.isArray(backupImportJob.reviewItems) ? backupImportJob.reviewItems.slice(-1500) : [],
              activeSubTab: backupImportJob.activeSubTab || "dashboard",
              reviewFilter: backupImportJob.reviewFilter || "needs_attention",
              updatedAt: Date.now()
            };
            await new Promise((resolve) => {
              try {
                const tx = db.transaction(BACKUP_IDB_STORE, "readwrite");
                const store = tx.objectStore(BACKUP_IDB_STORE);
                store.put(snapshot, BACKUP_IDB_KEY);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
              } catch (e) {
                resolve(false);
              }
            });
          } catch (e) {}
        };
        if (immediate) {
          if (_backupIdbSaveTimer) {
            clearTimeout(_backupIdbSaveTimer);
            _backupIdbSaveTimer = null;
          }
          await doSave();
        } else if (!_backupIdbSaveTimer) {
          _backupIdbSaveTimer = setTimeout(() => {
            _backupIdbSaveTimer = null;
            doSave();
          }, 1200);
        }
      }

      async function loadBackupJobFromIndexedDbClient() {
        try {
          const db = await openBackupJobIndexedDbClient();
          if (!db) return null;
          return await new Promise((resolve) => {
            try {
              const tx = db.transaction(BACKUP_IDB_STORE, "readonly");
              const store = tx.objectStore(BACKUP_IDB_STORE);
              const getReq = store.get(BACKUP_IDB_KEY);
              getReq.onsuccess = () => resolve(getReq.result || null);
              getReq.onerror = () => resolve(null);
            } catch (e) {
              resolve(null);
            }
          });
        } catch (e) {
          return null;
        }
      }

      async function clearBackupJobFromIndexedDbClient() {
        if (_backupIdbSaveTimer) {
          clearTimeout(_backupIdbSaveTimer);
          _backupIdbSaveTimer = null;
        }
        try {
          const db = await openBackupJobIndexedDbClient();
          if (!db) return;
          await new Promise((resolve) => {
            try {
              const tx = db.transaction(BACKUP_IDB_STORE, "readwrite");
              tx.objectStore(BACKUP_IDB_STORE).delete(BACKUP_IDB_KEY);
              tx.oncomplete = () => resolve(true);
              tx.onerror = () => resolve(false);
            } catch (e) {
              resolve(false);
            }
          });
        } catch (e) {}
      }

      async function restoreBackupImportSessionAfterReload() {
        if (_backupSessionRestorePromise) return _backupSessionRestorePromise;
        _backupSessionRestorePromise = (async () => {
          try {
            const canFetchAdminCheckpoint = Boolean(state.isAuthenticated && state.authUser?.isAdmin);
            const [idbJob, serverCpRes] = await Promise.all([
              loadBackupJobFromIndexedDbClient(),
              canFetchAdminCheckpoint
                ? apiFetchJson(API_BASE + "/admin/import-checkpoint").catch(() => null)
                : Promise.resolve(null)
            ]);
            const serverCp = (serverCpRes && serverCpRes.ok && serverCpRes.checkpoint) ? serverCpRes.checkpoint : null;
            const localCp = loadBackupCheckpointClient();
            const bestCp = (serverCp && Number(serverCp.cursor || 0) >= Number(localCp?.cursor || 0))
              ? serverCp
              : (localCp || serverCp);

            if (bestCp) {
              const normCp = {
                ...bestCp,
                cursor: Number(bestCp.cursor || 0),
                totalEntries: Number(bestCp.totalEntries || bestCp.total || idbJob?.entries?.length || 0),
                moviesSaved: Number(bestCp.moviesSaved || bestCp.savedMovies || 0),
                seriesSaved: Number(bestCp.seriesSaved || bestCp.savedEpisodes || 0),
                duplicatesInDb: Number(bestCp.duplicatesInDb || bestCp.skipped || 0),
                uncertainCount: Number(bestCp.uncertainCount || bestCp.conflicts || 0),
                failedCount: Number(bestCp.failedCount || bestCp.errors || 0),
                customPlaylistName: bestCp.customPlaylistName || bestCp.playlistName || "",
                playlistFolderId: bestCp.playlistFolderId || "",
                playlistMode: bestCp.playlistMode || "both",
                targetPlaylistChatId: bestCp.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId,
                verifiedChannelId: bestCp.verifiedChannelId || getSavedVerifiedChannelIdClient()
              };
              backupImportJob.savedCheckpoint = normCp;
              try {
                localStorage.setItem(BACKUP_CHECKPOINT_STORAGE_KEY, JSON.stringify(normCp));
              } catch (e) {}
            }

            if (idbJob && (!backupImportJob.entries || backupImportJob.entries.length === 0)) {
              const cpToApply = backupImportJob.savedCheckpoint;
              const sameFile = !cpToApply || !cpToApply.fileName || cpToApply.fileName === idbJob.fileName;
              backupImportJob = {
                ...backupImportJob,
                ...idbJob,
                running: false,
                paused: true,
                cursor: (sameFile && cpToApply) ? Math.max(Number(idbJob.cursor || 0), Number(cpToApply.cursor || 0)) : Number(idbJob.cursor || 0),
                moviesSaved: (sameFile && cpToApply) ? Math.max(Number(idbJob.moviesSaved || 0), Number(cpToApply.moviesSaved || 0)) : Number(idbJob.moviesSaved || 0),
                seriesSaved: (sameFile && cpToApply) ? Math.max(Number(idbJob.seriesSaved || 0), Number(cpToApply.seriesSaved || 0)) : Number(idbJob.seriesSaved || 0),
                duplicatesInDb: (sameFile && cpToApply) ? Math.max(Number(idbJob.duplicatesInDb || 0), Number(cpToApply.duplicatesInDb || 0)) : Number(idbJob.duplicatesInDb || 0),
                uncertainCount: (sameFile && cpToApply) ? Math.max(Number(idbJob.uncertainCount || 0), Number(cpToApply.uncertainCount || 0)) : Number(idbJob.uncertainCount || 0),
                failedCount: (sameFile && cpToApply) ? Math.max(Number(idbJob.failedCount || 0), Number(cpToApply.failedCount || 0)) : Number(idbJob.failedCount || 0),
                playlistFolderId: idbJob.playlistFolderId || cpToApply?.playlistFolderId || "",
                playlistMode: idbJob.playlistMode || cpToApply?.playlistMode || "both",
                targetPlaylistChatId: idbJob.targetPlaylistChatId || cpToApply?.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId,
                customPlaylistName: idbJob.customPlaylistName || cpToApply?.customPlaylistName || "🎵 JSON-Import",
                verifiedChannelId: idbJob.verifiedChannelId || cpToApply?.verifiedChannelId || getSavedVerifiedChannelIdClient()
              };
            } else if (backupImportJob.savedCheckpoint && !backupImportJob.fileName) {
              const cp = backupImportJob.savedCheckpoint;
              backupImportJob.fileName = cp.fileName || "result.json";
              backupImportJob.cursor = Number(cp.cursor || 0);
              backupImportJob.rawMessageCount = Number(cp.totalEntries || cp.total || 0);
              backupImportJob.moviesSaved = Number(cp.moviesSaved || 0);
              backupImportJob.seriesSaved = Number(cp.seriesSaved || 0);
              backupImportJob.duplicatesInDb = Number(cp.duplicatesInDb || 0);
              backupImportJob.uncertainCount = Number(cp.uncertainCount || 0);
              backupImportJob.failedCount = Number(cp.failedCount || 0);
              backupImportJob.customPlaylistName = cp.customPlaylistName || "🎵 JSON-Import";
              backupImportJob.playlistFolderId = cp.playlistFolderId || "";
              backupImportJob.playlistMode = cp.playlistMode || "both";
              backupImportJob.targetPlaylistChatId = cp.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId;
              if (cp.verifiedChannelId) backupImportJob.verifiedChannelId = cp.verifiedChannelId;
            }

            // Lade persistente Prüf-Karten & Diagnose-Logs aus D1 nach Seiten-Reload (F5)
            await Promise.all([
              typeof syncDiagnosticLogsFromD1Client === "function" ? syncDiagnosticLogsFromD1Client(true) : Promise.resolve(),
              typeof syncReviewItemsFromD1MetadataClient === "function" ? syncReviewItemsFromD1MetadataClient(true) : Promise.resolve()
            ]);
            renderBackupImportBoxDom();
          } catch (e) {}
        })();
        return _backupSessionRestorePromise;
      }

      function getSavedVerifiedChannelIdClient() {
        try {
          return localStorage.getItem("tma_verified_channel_id") || "";
        } catch (e) {
          return "";
        }
      }

      function saveVerifiedChannelIdClient(channelId) {
        try {
          const clean = String(channelId || "").trim();
          if (clean) localStorage.setItem("tma_verified_channel_id", clean);
          else localStorage.removeItem("tma_verified_channel_id");
        } catch (e) {}
      }

      function parseClientTelegramChannelOrLink(rawVal) {
        const s = String(rawVal || "").trim();
        if (!s) return { channelId: "", sampleMessageId: null };
        const priv = s.match(/t\\.me\\/c\\/(\\d{5,})(?:\\/(\\d+))?(?:\\/(\\d+))?/i);
        if (priv) {
          const mId = priv[3] ? parseInt(priv[3], 10) : (priv[2] ? parseInt(priv[2], 10) : null);
          return { channelId: "-100" + priv[1], sampleMessageId: mId || null };
        }
        const pub = s.match(/t\\.me\\/([a-zA-Z0-9_]{4,})(?:\\/(\\d+))?/i);
        if (pub && pub[1].toLowerCase() !== "c") {
          return { channelId: "@" + pub[1], sampleMessageId: pub[2] ? parseInt(pub[2], 10) : null };
        }
        const num = s.match(/^(-?\\d{5,})$/);
        if (num) {
          let d = num[1];
          if (!d.startsWith("-")) d = "-100" + d.replace(/^100/, "");
          else if (!d.startsWith("-100")) d = "-100" + d.slice(1);
          return { channelId: d, sampleMessageId: null };
        }
        return { channelId: s, sampleMessageId: null };
      }

      function loadBackupCheckpointClient() {
        try {
          const raw = localStorage.getItem(BACKUP_CHECKPOINT_STORAGE_KEY);
          if (!raw) return null;
          const cp = JSON.parse(raw);
          if (cp && typeof cp === "object" && (Number(cp.cursor) > 0 || Number(cp.totalEntries || cp.total) > 0)) {
            return cp;
          }
        } catch (e) {}
        return null;
      }

      function buildCurrentBackupCheckpointPayload() {
        const totalNum = (Array.isArray(backupImportJob.entries) && backupImportJob.entries.length > 0)
          ? backupImportJob.entries.length
          : Number(backupImportJob.savedCheckpoint?.totalEntries || backupImportJob.savedCheckpoint?.total || backupImportJob.rawMessageCount || 0);
        return {
          fileSignature: backupImportJob.fileSignature || ((backupImportJob.fileName || "result.json") + "::" + totalNum),
          fileName: backupImportJob.fileName || "result.json",
          cursor: Number(backupImportJob.cursor || 0),
          total: totalNum,
          totalEntries: totalNum,
          verifiedChannelId: backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient(),
          playlistName: backupImportJob.customPlaylistName || "",
          customPlaylistName: backupImportJob.customPlaylistName || "",
          playlistFolderId: backupImportJob.playlistFolderId || "",
          playlistMode: backupImportJob.playlistMode || "both",
          targetPlaylistChatId: backupImportJob.targetPlaylistChatId || state.adminPlaylistTargetChatId || chatId,
          savedMovies: Number(backupImportJob.moviesSaved || 0),
          moviesSaved: Number(backupImportJob.moviesSaved || 0),
          savedEpisodes: Number(backupImportJob.seriesSaved || 0),
          seriesSaved: Number(backupImportJob.seriesSaved || 0),
          skipped: Number(backupImportJob.duplicatesInDb || 0),
          duplicatesInDb: Number(backupImportJob.duplicatesInDb || 0),
          mergedQualitiesInDb: Number(backupImportJob.mergedQualitiesInDb || 0),
          conflicts: Number(backupImportJob.uncertainCount || 0),
          uncertainCount: Number(backupImportJob.uncertainCount || 0),
          errors: Number(backupImportJob.failedCount || 0),
          failedCount: Number(backupImportJob.failedCount || 0),
          updatedAt: Date.now()
        };
      }

      function saveBackupCheckpointClient(forceServerSync = false) {
        const cp = buildCurrentBackupCheckpointPayload();
        backupImportJob.savedCheckpoint = cp;
        try {
          localStorage.setItem(BACKUP_CHECKPOINT_STORAGE_KEY, JSON.stringify(cp));
        } catch (e) {}
        saveBackupJobToIndexedDbClient(Boolean(forceServerSync));
        backupImportJob._cpSyncStep = Number(backupImportJob._cpSyncStep || 0) + 1;
        // Während der aktive Batch-Loop läuft, bei Auth-Abbruch oder während eines 503-Cooldowns NIEMALS einen separaten Server-POST feuern!
        const inCooldown = typeof getClientWorkerCircuitState === "function" && getClientWorkerCircuitState().cooldownUntil > Date.now();
        const isAuthedAdmin = Boolean(state.isAuthenticated && state.authUser?.isAdmin);
        const shouldSyncServer = Boolean(
          isAuthedAdmin &&
          !backupImportJob.running &&
          !backupImportJob.authAbortError &&
          !inCooldown &&
          (forceServerSync || (cp.totalEntries > 0 && cp.cursor >= cp.totalEntries))
        );
        if (shouldSyncServer) {
          apiFetchJson(API_BASE + "/admin/import-checkpoint", {
            method: "POST",
            noRetry: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkpoint: cp })
          }).catch(() => {});
        }
      }

      function clearBackupCheckpointClient() {
        backupImportJob.savedCheckpoint = null;
        try {
          localStorage.removeItem(BACKUP_CHECKPOINT_STORAGE_KEY);
        } catch (e) {}
        clearBackupJobFromIndexedDbClient();
        if (state.isAuthenticated && state.authUser?.isAdmin) {
          apiFetchJson(API_BASE + "/admin/import-checkpoint", {
            method: "POST",
            noRetry: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clear: true })
          }).catch(() => {});
        }
      }

      async function verifyBackupChannelClient() {
        const inp = document.getElementById("backupSourceChannelInp");
        const msgInp = document.getElementById("backupSampleMsgIdInp");
        const statusBanner = document.getElementById("backupChannelVerifyBanner");
        const rawInput = (inp ? inp.value : backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient()).trim();
        if (!rawInput) {
          showHudToast("⚠️ Bitte zuerst Kanal-ID (-100...) oder Beispiel-Nachrichtenlink eingeben!");
          return;
        }
        const parsed = parseClientTelegramChannelOrLink(rawInput);
        let sampleMessageId = msgInp && msgInp.value ? parseInt(msgInp.value, 10) : parsed.sampleMessageId;
        if (!sampleMessageId && Array.isArray(backupImportJob.entries) && backupImportJob.entries.length > 0) {
          const firstWithMsg = backupImportJob.entries.find(e => e && (e.message_id || e.msg_id));
          if (firstWithMsg) sampleMessageId = Number(firstWithMsg.message_id || firstWithMsg.msg_id);
        }

        if (statusBanner) {
          statusBanner.style.display = "block";
          statusBanner.style.color = "#38bdf8";
          statusBanner.innerHTML = "⏳ Prüfe Kanal-Lesbarkeit & Dry-Run Berechtigungen für <code>" + esc(parsed.channelId || rawInput) + "</code>...";
        }

        try {
          const r = await apiFetchJson(API_BASE + "/admin/validate-channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelInput: rawInput, sampleMessageId: sampleMessageId || null })
          });
          backupImportJob.channelVerifyResult = r;
          if (r && r.ok && r.readable && r.channelId) {
            backupImportJob.verifiedChannelId = String(r.channelId);
            backupImportJob.backupChatId = String(r.channelId);
            try {
              localStorage.setItem("tma_verified_channel_id", String(r.channelId));
              localStorage.setItem("tma_verified_channel_input", rawInput);
            } catch (e) {}

            // Falls bereits eine JSON-Datei geparst wurde, verifizierte Kanal-ID sofort in alle Einträge (+ gebundene Untertitel) injizieren!
            if (Array.isArray(backupImportJob.entries) && backupImportJob.entries.length > 0) {
              for (const ent of backupImportJob.entries) {
                if (!ent || typeof ent !== "object") continue;
                ent.chat_id = String(r.channelId);
                const mId = ent.message_id || ent.msg_id;
                if (mId && (!ent.telegram_file_id || String(ent.telegram_file_id).startsWith("tg_export_"))) {
                  ent.telegram_file_id = "tg_export_" + r.channelId + "_" + mId;
                }
                if (Array.isArray(ent.subtitle_files)) {
                  for (const sf of ent.subtitle_files) {
                    if (!sf || typeof sf !== "object") continue;
                    sf.chat_id = String(r.channelId);
                    if (sf.message_id && (!sf.file_id || String(sf.file_id).startsWith("tg_export_"))) {
                      sf.file_id = "tg_export_" + r.channelId + "_" + sf.message_id;
                    }
                  }
                }
              }
            }

            if (statusBanner) {
              statusBanner.style.display = "block";
              statusBanner.style.color = "#34d399";
              statusBanner.innerHTML = "✅ <b>" + esc(r.diagnosticSummary || ("Kanal " + r.channelId + " verifiziert & freigeschaltet!")) + "</b>";
            }
            const fileInp = document.getElementById("backupJsonFileInputEl");
            if (fileInp) {
              fileInp.disabled = false;
              fileInp.style.opacity = "1";
            }
            showHudToast("✅ Kanal verifiziert: " + r.channelId + " – JSON-Upload ist freigeschaltet!");
            renderBackupImportBoxDom();
          } else {
            backupImportJob.verifiedChannelId = "";
            if (statusBanner) {
              statusBanner.style.display = "block";
              statusBanner.style.color = "#f87171";
              statusBanner.innerHTML = "❌ <b>" + esc(r?.diagnosticSummary || r?.error || "Kanal nicht lesbar. Ist der Bot Admin im Kanal?") + "</b>";
            }
            showHudToast("❌ Kanal-Prüfung fehlgeschlagen: " + (r?.error || "Kein Zugriff"));
            renderBackupImportBoxDom();
          }
        } catch (err) {
          if (statusBanner) {
            statusBanner.style.display = "block";
            statusBanner.style.color = "#f87171";
            statusBanner.innerHTML = "❌ Fehler bei der Kanal-Validierung: " + esc(err.message);
          }
        }
      }

      async function adminRunD1DedupeFilesClient() {
        setBusyState(true, "🧹 Bereinige doppelte & defekte Stream-Buttons in D1...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/d1-diagnostics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "dedupe_files",
              fallbackChannelId: backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient()
            })
          });
          clearClientMediaCaches();
          if (r && r.ok) {
            showHudToast("✅ Bereinigt: " + Number(r.removedBrokenRows || 0) + " defekte + " + Number(r.removedDuplicateRows || 0) + " doppelte Stream-Buttons entfernt!");
            await loadAdminPanelView();
          } else {
            showHudToast("⚠️ " + (r?.error || "Bereinigung fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function adminRunCompleteMediaResetClient() {
        const ok = await showCustomConfirm(
          "🧨 KOMPLETT-RESET BESTÄTIGEN:\\n\\nMöchtest du wirklich ALLE Filme, Serien, Episoden, Datei-IDs, Fehlermeldungen, Diagnose-Logs, Caches und Playlisten in D1 & KV restlos löschen?\\n\\n(Deine Benutzerkonten, VIP-Status, 2FA und Admin-Rechte bleiben vollständig erhalten!)",
          "🧨 Ja, alles sauber zurücksetzen"
        );
        if (!ok) return;
        setBusyState(true, "🧨 Führe Komplett-Reset aller Medien, Fehlermeldungen & Playlisten in D1 + KV durch...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/d1-diagnostics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "reset_all_media" })
          });
          clearBackupCheckpointClient();
          clearClientMediaCaches();
          resetBackupImport(true);
          backupImportJob.fileName = "";
          backupImportJob.entries = [];
          backupImportJob.reviewItems = [];
          backupImportJob.livePosterFeed = [];
          window._adminReportsCache = [];
          window._lastAdminOverviewCache = null;
          if (typeof clientDiagnosticLogState === "object" && clientDiagnosticLogState) {
            clientDiagnosticLogState.logs = [];
            if (typeof saveClientDiagnosticLogsToStorage === "function") {
              saveClientDiagnosticLogsToStorage();
            }
          }
          if (r && r.ok) {
            showHudToast("✅ Komplett-Reset abgeschlossen! Datenbank, Meldungen & Playlisten sind komplett sauber.");
            await loadAdminPanelView(true);
          } else {
            showHudToast("⚠️ " + (r?.error || "Reset fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }
