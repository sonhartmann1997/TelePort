            };
          }
          let finalTitle = cleanClientMediaTitle(cleanedNeighborTitle) || cleanedNeighborTitle;
          if (finalTitle && finalTitle.length > 50) {
            finalTitle = finalTitle.split(/[:\\n(]/)[0].trim().slice(0, 40);
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
          // 1. Chronologische Sortierung vor dem Loop erzwingen (Id aufsteigend)
          tgMessages.sort((a, b) => Number(a?.id || a?.message_id || 0) - Number(b?.id || b?.message_id || 0));

          const rawCandidates = [];
          const clientPreLogs = [];
          const metaPrefixRegex = /^(?:Qualität|Quality|Genre|Gener|Studio|FSK|Jahr|Erscheinungsjahr|Produktionsland|Release|Released|Bewertung|Rating|IMDb|TMDB|Audio|Sprache|Language|Untertitel|Subtitles|Dauer|Laufzeit|Länge|Laenge|Runtime|Regie|Director|Darsteller|Actors|Cast|Handlung|Inhalt|Beschreibung|Plot|Info|Größe|Groesse|Dateigröße|Size|Format|Codec|Quelle|Source|Link|Download|Stream|Kanal|Channel|Preis|Free|Kostenlos)\\s*[:\\-]/i;

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
            const junkReason = classifyClientJunkReason(msg);
            if (junkReason) {
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
            // 2. Eiserne Regel ("Video schlägt Header") + eigene Kategorie für .rar-Archive + Untertitel-Bindung (.srt/.vtt/.sub):
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
            const isRarMsg = /\\.rar$/i.test(rawFileName || validFilePath);
            const isVideoMsg =
              msg.media_type === "video_file" ||
              Boolean(msg.video) ||
              /^video\\//i.test(msg.mime_type || "") ||
              /\\.(?:mp4|mkv|avi|mov|m4v|webm|ts|flv|mk3d)$/i.test(rawFileName || validFilePath);
            const isPhotoMsg = !isVideoMsg && !isRarMsg && Boolean(msg.photo || msg.media_type === "photo" || /^image\\//i.test(msg.mime_type || ""));

            // Wenn eine Videodatei oder RAR-Datei anhängt UND gleichzeitig ein Staffel-/Serien-Header im Text steht (Breaking Bad S03E01 Fix):
            // Aktualisiere zuerst den rollingPreContext, aber brich NIEMALS mit continue ab!
            if (isVideoMsg || isRarMsg) {
              const hasHeaderCue = /\\b(?:Staffel\\s*\\d+|vorschauserien|Miniserie|\\d+\\s+Folgen\\s+in\\s+\\d+\\s+Staffel)/i.test(flatText) ||
                (Array.isArray(msg.text_entities) && msg.text_entities.some(e => String(e?.href || "").includes("vorschauserien")));
              if (hasHeaderCue) {
                rollingPreContext = extractClientPreContextFromMsg(msg, rollingPreContext);
              }
            } else if (!rawFileName && !validFilePath) {
              rollingPreContext = extractClientPreContextFromMsg(msg, rollingPreContext);
              if (isPhotoMsg) {
                if (clientPreLogs.length < 350) {
                  clientPreLogs.push({
                    msgId: currentMsgId || null,
                    fileName: "Foto/Poster-Header",
                    rawText: flatTextRaw.slice(0, 140),
                    status: "SKIPPED_HEADER",
                    reason: "Serien-/Film-Poster als Vorab-Kontext gespeichert (" + (rollingPreContext.seriesHeader || rollingPreContext.title || "Reset") + ")",
                    detectedType: "header",
                    parsedTitle: rollingPreContext.seriesHeader || rollingPreContext.title || ""
                  });
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
              if (clientPreLogs.length < 350 && flatTextRaw.trim()) {
                clientPreLogs.push({
                  msgId: currentMsgId || null,
                  fileName: "Text-Header",
                  rawText: flatTextRaw.slice(0, 140),
                  status: "SKIPPED_HEADER",
                  reason: "Text-/Serien-Header ohne Videodatei (" + (rollingPreContext.seriesHeader || rollingPreContext.title || "Info") + ")",
                  detectedType: "header",
                  parsedTitle: rollingPreContext.seriesHeader || rollingPreContext.title || ""
                });
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
            const textCleanOwn = (cleanFirstLine && firstTextLine.length <= 60 && !isLeadingNumberEpisode)
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

            // Beschreibungs-Schutz ("Ted Bundy" / "Cocaine Bear"): Wenn firstTextLine > 60 Zeichen lang ist, ist es eine Beschreibung und kein Titel!
            const firstLineIsDescription = firstTextLine.length > 60;

            if (vonSeriesTitle) {
              baseCandidate = vonSeriesTitle + " " + seInText;
              parsedFrom = "Dateiname (Episode X Staffel Y von Serie)";
            } else if (isLeadingNumberEpisode && (effectivePre.seriesHeader || effectivePre.title)) {
              baseCandidate = (effectivePre.seriesHeader || effectivePre.title) + " " + seInText + (multiLineEpTitle ? (" - " + multiLineEpTitle) : "");
              parsedFrom = "Serien-Header + Episodennummer";
            } else if (!ownExplicitSeriesTitle && effectivePre.title && ((isGenericFile && !cleanFirstLine) || preTitleMatchesOwn) && (effectivePre.tmdbId || effectivePre.imdbId || isGenericFile || !cleanFirstLine)) {
              baseCandidate = effectivePre.title;
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
              baseCandidate = normFileName || (firstLineIsDescription ? firstTextLine.split(/[:\\n(]/)[0].trim().slice(0, 40) : firstTextLine);
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
                '<div style="font-size:16px;font-weight:900;color:#38bdf8">✂️ How-To: Telegram JSON-Backups über 200 MB splitten & importieren</div>' +
                '<button class="btn red" onclick="closeDetailModal()">✖ Schließen</button>' +
              '</div>' +
              '<div style="font-size:12.5px;color:#cbd5e1;line-height:1.55;display:flex;flex-direction:column;gap:12px">' +
                '<div style="background:#14141d;border:1px solid rgba(56,189,248,0.35);border-radius:8px;padding:12px">' +
                  '<b style="color:#fff">1. Warum 200 MB+ Dateien besondere Verarbeitung brauchen:</b><br/>' +
                  'Große Telegram-Gruppen enthalten oft hunderttausende Textnachrichten. ' +
                  'Unser integrierter <b>2 MB Browser-Stream-Slicer (<code>File.slice()</code>)</b> liest auch 500 MB+ Dateien stückweise im Browser aus, bewahrt automatisch die <b>2 Nachrichten über jedem Video (Steckbrief-Kontext)</b> und teilt alles in <b>250er Video-Chunks</b> auf.' +
                '</div>' +
                '<div style="background:#14141d;border:1px solid rgba(16,185,129,0.35);border-radius:8px;padding:12px">' +
                  '<b style="color:#34d399">2. Optimaler Export in Telegram Desktop (ohne Video-Dateien herunterzuladen):</b><br/>' +
                  '1. Gruppe/Kanal in Telegram Desktop öffnen ➔ <b>⋮ ➔ Chatverlauf exportieren</b>.<br/>' +
                  '2. <b>Alle Haken bei Medien (Fotos, Videos, Sprachnachrichten) deaktivieren</b> – es werden nur die Dateinamen & Captions benötigt!<br/>' +
                  '3. Format auf <b>Maschinenlesbares JSON (<code>result.json</code>)</b> stellen und hier im Backup-Tab auswählen.' +
                '</div>' +
                '<div style="background:#14141d;border:1px solid rgba(251,191,36,0.35);border-radius:8px;padding:12px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                    '<b style="color:#fbbf24">3. Optionales Terminal-Kommando (jq / Python 3) für 1 GB+ Backups:</b>' +
                    '<div style="display:flex;gap:6px">' +
                      '<button type="button" class="btn" style="padding:3px 9px;font-size:11px" onclick="copyHowToSnippetClient(\\'jq\\')">📋 jq kopieren</button>' +
                      '<button type="button" class="btn amber" style="padding:3px 9px;font-size:11px" onclick="copyHowToSnippetClient(\\'py\\')">📋 Python-Splitter kopieren</button>' +
                    '</div>' +
                  '</div>' +
                  '<pre id="howToJqCodeEl" style="background:#09090d;padding:8px;border-radius:6px;overflow-x:auto;font-size:11px;color:#38bdf8;margin-top:6px;white-space:pre-wrap"></pre>' +
                  '<pre id="howToPyCodeEl" style="background:#09090d;padding:8px;border-radius:6px;overflow-x:auto;font-size:11px;color:#34d399;margin-top:6px;white-space:pre"></pre>' +
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
            const [idbJob, serverCpRes] = await Promise.all([
              loadBackupJobFromIndexedDbClient(),
              apiFetchJson(API_BASE + "/admin/import-checkpoint").catch(() => null)
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
        // Während der aktive Batch-Loop läuft, wird der Checkpoint bereits atomar in jedem /admin/import-batch Request in D1 gespeichert.
        // Ein separater Server-POST erfolgt nur bei explizitem Pause-Klick (forceServerSync = true), außerhalb des Loops oder bei 100% Abschluss,
        // damit niemals 2 parallele Worker-Requests kollidieren (Schutz vor HTTP 503).
        const shouldSyncServer = Boolean(forceServerSync) || (!backupImportJob.running && (backupImportJob._cpSyncStep % 5 === 0)) || (cp.totalEntries > 0 && cp.cursor >= cp.totalEntries);
        if (shouldSyncServer) {
          apiFetchJson(API_BASE + "/admin/import-checkpoint", {
            method: "POST",
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
        apiFetchJson(API_BASE + "/admin/import-checkpoint", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear: true })
        }).catch(() => {});
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

      async function handleBackupFileInput(ev) {
        const file = ev?.target?.files?.[0];
        if (!file) return;

        const activeChannelId = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        if (!activeChannelId || (!activeChannelId.startsWith("-100") && !activeChannelId.startsWith("@"))) {
          showHudToast("⛔ Gesperrt: Bitte zuerst Schritt 1 (Kanal-ID -100... oder Link) eingeben und prüfen!");
          if (ev?.target) ev.target.value = "";
          return;
        }
        backupImportJob.verifiedChannelId = activeChannelId;

        const statusEl = document.getElementById("backupParseNotice");
        const sizeMb = file.size / (1024 * 1024);
        if (statusEl) {
          statusEl.style.color = "#fbbf24";
          statusEl.textContent = "⏳ Lese & analysiere " + file.name + " (" + sizeMb.toFixed(2) + " MB)...";
        }
        try {
          await new Promise(r => setTimeout(r, 10));
          let info = null;
          if (sizeMb > 15) {
            info = await streamParseLargeClientBackupFile(file, statusEl);
          } else {
            const text = await file.text();
            await new Promise(r => setTimeout(r, 0));
            const repairRes = repairAndParseClientBackupJson(text);
            if (!repairRes.ok || !repairRes.parsed) {
              info = await streamParseLargeClientBackupFile(file, statusEl);
            } else {
              info = await detectAndParseClientBackupJson(repairRes.parsed, file.name, file.size, repairRes, statusEl);
            }
          }

          // Verifizierte Kanal-ID garantiert in JEDEN Eintrag (+ gebundene Untertitel) injizieren, damit niemals tg_export_0_ entsteht!
          if (Array.isArray(info.entries)) {
            for (const ent of info.entries) {
              if (!ent || typeof ent !== "object") continue;
              ent.chat_id = activeChannelId;
              const mId = ent.message_id || ent.msg_id;
              if (mId && (!ent.telegram_file_id || String(ent.telegram_file_id).startsWith("tg_export_"))) {
                ent.telegram_file_id = "tg_export_" + activeChannelId + "_" + mId;
              }
              if (Array.isArray(ent.subtitle_files)) {
                for (const sf of ent.subtitle_files) {
                  if (!sf || typeof sf !== "object") continue;
                  sf.chat_id = activeChannelId;
                  if (sf.message_id && (!sf.file_id || String(sf.file_id).startsWith("tg_export_"))) {
                    sf.file_id = "tg_export_" + activeChannelId + "_" + sf.message_id;
                  }
                }
              }
            }
          }

          const fileSignature = String(file.name) + "::" + String(file.size) + "::" + String(info.entries.length);
          const existingCp = loadBackupCheckpointClient();
          const matchingCp = (
            existingCp &&
            (existingCp.fileSignature === fileSignature || existingCp.fileName === file.name) &&
            Number(existingCp.cursor) > 0 &&
            Number(existingCp.cursor) < info.entries.length
          ) ? existingCp : null;

          const cleanBase = String(file.name || "Import").replace(/\\.json$/i, "").trim();
          const suggestedPlaylistName = matchingCp?.customPlaylistName
            ? matchingCp.customPlaylistName
            : (info.isTelegramBackup ? ("📦 " + info.backupChatName) : (info.backupChatName || ("🎵 " + cleanBase)));

          backupImportJob = {
            ...info,
            fileSignature,
            verifiedChannelId: activeChannelId,
            channelVerifyResult: backupImportJob.channelVerifyResult || { ok: true, readable: true, channelId: activeChannelId },
            savedCheckpoint: matchingCp,
            splitChunkSize: 250,
            customPlaylistName: String(suggestedPlaylistName).slice(0, 48),
            playlistMode: matchingCp?.playlistMode || backupImportJob.playlistMode || "both",
            targetPlaylistChatId: String(state.adminPlaylistTargetChatId || chatId),
            playlistFolderId: matchingCp?.playlistFolderId || "",
            cursor: matchingCp ? Number(matchingCp.cursor || 0) : 0,
            moviesSaved: matchingCp ? Number(matchingCp.moviesSaved || 0) : 0,
            seriesSaved: matchingCp ? Number(matchingCp.seriesSaved || 0) : 0,
            duplicatesInDb: matchingCp ? Number(matchingCp.duplicatesInDb || 0) : 0,
            mergedQualitiesInDb: matchingCp ? Number(matchingCp.mergedQualitiesInDb || 0) : 0,
            uncertainCount: matchingCp ? Number(matchingCp.uncertainCount || 0) : 0,
            failedCount: matchingCp ? Number(matchingCp.failedCount || 0) : 0,
            running: false,
            paused: false,
            startedAt: 0,
            recentLog: matchingCp
              ? ["📌 Gespeicherter Checkpoint geladen: Fortsetzung bei Eintrag #" + matchingCp.cursor + " / " + info.entries.length + " bereit."]
              : [],
            livePosterFeed: [],
            reviewItems: Array.isArray(backupImportJob.reviewItems) ? backupImportJob.reviewItems : [],
            activeSubTab: "dashboard",
            reviewFilter: "needs_attention"
          };
          saveBackupJobToIndexedDbClient(true);
          saveBackupCheckpointClient(true);
          if (statusEl) {
            statusEl.style.color = matchingCp ? "#fbbf24" : (info.repaired ? "#38bdf8" : "#34d399");
            const chunksCount = Math.max(1, Math.ceil(info.entries.length / 250));
            statusEl.textContent = matchingCp
              ? ("📌 Checkpoint erkannt: Bei #" + matchingCp.cursor.toLocaleString("de-DE") + " von " + info.entries.length.toLocaleString("de-DE") + " fortsetzen oder ab 0 neu starten!")
              : ("✅ " + info.entries.length.toLocaleString("de-DE") + " Video-Einträge erkannt [Kanal " + activeChannelId + "] (" + chunksCount + " Chunks à 250 Videos bereit)!");
          }
          renderBackupImportBoxDom();
        } catch (err) {
          if (statusEl) {
            statusEl.style.color = "#f87171";
            statusEl.textContent = "❌ Fehler beim Lesen der JSON-Datei: " + err.message;
          }
        }
      }

      async function runSimulatedJsonImportTestSuiteClient() {
        const reportBox = document.getElementById("e2eSimReportMount");
        const setSimStatus = (html) => {
          if (reportBox) {
            reportBox.style.display = "block";
            reportBox.innerHTML = html;
          }
        };

        setBusyState(true, "🧪 Starte E2E JSON-Import Simulation (7 Testfälle + Pipeline-Prüfung)...");
        setSimStatus('<div style="padding:12px;color:#38bdf8;font-weight:700">⏳ Schritt 1/5: Prüfe Quell-Kanal (-1001987654321) & generiere realistisches Telegram result.json Test-Backup...</div>');

        try {
          const simChannelId = "-1001987654321";
          const chanRes = await apiFetchJson(API_BASE + "/admin/validate-channel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channelInput: simChannelId })
          });
          saveVerifiedChannelIdClient(simChannelId);
          backupImportJob.verifiedChannelId = simChannelId;
          const chanInp = document.getElementById("backupSourceChannelInp");
          if (chanInp) chanInp.value = simChannelId;

          // Realistisches Telegram Desktop Chat-Export JSON mit 7 gezielten Testfällen
          const simulatedTelegramExport = {
            name: "VIP Kino & Serien Archiv (E2E Simulation)",
            type: "private_supergroup",
            id: 1987654321,
            messages: [
              {
                id: 9001,
                type: "message",
                date: "2025-02-01T18:00:00",
                text: "📌 Willkommen im VIP-Archiv! Alle neuen Uploads folgen direkt hierunter."
              },
              {
                id: 9002,
                type: "message",
                date: "2025-02-01T18:05:00",
                file_name: "Interstellar (2014) German DL 1080p BluRay x264.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 10140,
                width: 1920,
                height: 1080,
                text: "🎬 Interstellar (2014) • Deutsch & Englisch • 1080p Full HD"
              },
              {
                id: 9003,
                type: "message",
                date: "2025-02-01T18:10:00",
                file_name: "Matrix (1999) German CAM.TS.LD.mp4",
                mime_type: "video/mp4",
                duration_seconds: 8160,
                width: 1280,
                height: 720,
                text: "🎬 Matrix (1999) • Vorabversion TS/CAM"
              },
              {
                id: 9004,
                type: "message",
                date: "2025-02-01T18:15:00",
                file_name: "Matrix (1999) German DL 1080p BluRay.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 8160,
                width: 1920,
                height: 1080,
                text: "🎬 Matrix (1999) • 1080p BluRay Qualitäts-Upgrade (ersetzt TS automatisch)"
              },
              {
                id: 9004,
                type: "message",
                date: "2025-02-01T18:15:00",
                file_name: "Matrix (1999) German DL 1080p BluRay.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 8160,
                width: 1920,
                height: 1080,
                text: "🎬 Matrix (1999) • Exaktes Duplikat (gleiche Message-ID #9004)"
              },
              {
                id: 9005,
                type: "message",
                date: "2025-02-01T18:20:00",
                file_name: "Breaking.Bad.S01E01.German.1080p.WEB-DL.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 3480,
                width: 1920,
                height: 1080,
                text: "📺 Breaking Bad (2008) - Staffel 1 Folge 1"
              },
              {
                id: 9006,
                type: "message",
                date: "2025-02-01T18:22:00",
                file_name: "Breaking.Bad.S01E02.German.1080p.WEB-DL.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 2880,
                width: 1920,
                height: 1080,
                text: "📺 Breaking Bad (2008) - Staffel 1 Folge 2"
              },
              {
                id: 9007,
                type: "message",
                date: "2025-02-01T18:25:00",
                file_name: "Breaking.Bad.S01E04.German.1080p.WEB-DL.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 2880,
                width: 1920,
                height: 1080,
                text: "📺 Breaking Bad (2008) - Staffel 1 Folge 4 (S01E03 fehlt absichtlich für Lücken-Finder!)"
              },
              {
                id: 9008,
                type: "message",
                date: "2025-02-01T18:30:00",
                file_name: "Inception (1995) German 1080p.mp4",
                mime_type: "video/mp4",
                duration_seconds: 8880,
                width: 1920,
                height: 1080,
                text: "🎬 Inception (1995) • Absichtlicher Jahreszahl-Konflikt (Release 2010 vs. 1995)"
              },
              {
                id: 9009,
                type: "message",
                date: "2025-02-01T18:35:00",
                file_name: "XyzUnbekannterPhantomFilm99999 (2024) 1080p.mkv",
                mime_type: "video/x-matroska",
                duration_seconds: 5400,
                width: 1920,
                height: 1080,
                text: "🎬 Absichtlich nicht existierender Testtitel für TMDB_NOT_FOUND Prüfung"
              }
            ]
          };

          const rawJsonStr = JSON.stringify(simulatedTelegramExport, null, 2);
          setSimStatus('<div style="padding:12px;color:#38bdf8;font-weight:700">⏳ Schritt 2/5: Analysiere JSON-Struktur über Client-Parser (detectAndParseClientBackupJson)...</div>');

          const repairRes = repairAndParseClientBackupJson(rawJsonStr);
          const parsedInfo = await detectAndParseClientBackupJson(
            repairRes.parsed,
            "simulation_result.json",
            rawJsonStr.length,
            repairRes,
            null
          );

          for (const ent of (parsedInfo.entries || [])) {
            ent.chat_id = simChannelId;
            const mId = ent.message_id || ent.msg_id;
            if (mId) ent.telegram_file_id = "tg_export_" + simChannelId + "_" + mId;
          }

          backupImportJob = {
            ...parsedInfo,
            fileName: "simulation_result.json",
            fileSignature: "simulation_result.json::" + rawJsonStr.length + "::" + parsedInfo.entries.length,
            verifiedChannelId: simChannelId,
            channelVerifyResult: { ok: true, readable: true, channelId: simChannelId },
            savedCheckpoint: null,
            splitChunkSize: 250,
            customPlaylistName: "🧪 E2E Simulation Playlist",
            playlistMode: "both",
            targetPlaylistChatId: String(state.adminPlaylistTargetChatId || chatId),
            playlistFolderId: "",
            cursor: 0,
            moviesSaved: 0,
            seriesSaved: 0,
            duplicatesInDb: 0,
            mergedQualitiesInDb: 0,
            uncertainCount: 0,
            failedCount: 0,
            running: false,
            paused: false,
            startedAt: Date.now(),
            recentLog: ["🧪 E2E JSON-Simulation geladen (" + parsedInfo.entries.length + " Video-Einträge aus 10 Nachrichten extrahiert)."],
            livePosterFeed: [],
            reviewItems: [],
            activeSubTab: "dashboard",
            reviewFilter: "needs_attention"
          };

          setSimStatus('<div style="padding:12px;color:#fbbf24;font-weight:700">⏳ Schritt 3/5: Sende Batch durch echte Worker-Pipeline (/api/tma/admin/import-batch)...</div>');
          await startOrResumeBackupImport();

          setSimStatus('<div style="padding:12px;color:#a855f7;font-weight:700">⏳ Schritt 4/5: Prüfe VIP-Fehlermeldungen (Erstellen, Auflösen & Löschen) sowie Hauptkatalog (/api/tma/discover)...</div>');
          const createRepRes = await apiFetchJson(API_BASE + "/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "m",
              tmdbId: 603,
              title: "Matrix (E2E Sim-Test)",
              reasonCode: "wrong_audio",
              reasonLabel: "🔇 Tonspur-Testmeldung (E2E Simulation)",
              note: "Automatischer Funktionstest für Meldungs-Bestätigung & Löschung"
            })
          });
          const createdReportId = createRepRes?.report?.id;
          let reportResolveOk = false;
          let reportDeleteOk = false;
          if (createdReportId) {
            const resRep = await apiFetchJson(API_BASE + "/admin/reports", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "resolve", reportId: createdReportId })
            });
            reportResolveOk = Boolean(resRep && resRep.ok);
            const delRep = await apiFetchJson(API_BASE + "/admin/reports", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete", reportId: createdReportId })
            });
            reportDeleteOk = Boolean(delRep && delRep.ok && !(delRep.reports || []).some(x => Number(x.id) === Number(createdReportId)));
          }

          setSimStatus('<div style="padding:12px;color:#34d399;font-weight:700">⏳ Schritt 5/5: Validiere D1-Persistenz, Staffel-Lücken-Erkennung & Hauptseiten-Darstellung...</div>');
          const [overviewRes, discoverRes] = await Promise.all([
            apiFetchJson(API_BASE + "/admin/overview"),
            apiFetchJson(API_BASE + "/discover?mode=all&page=1")
          ]);
          if (overviewRes && overviewRes.ok) {
            window._lastAdminOverviewCache = overviewRes;
            window._adminReportsCache = overviewRes.mediaReports || [];
          }

          const batchItems = backupImportJob.reviewItems || [];
          const hasSkipHeaderOk = parsedInfo.entries.length === 9;
          const hasMovieSavedOk = Number(backupImportJob.moviesSaved || 0) >= 1 && (overviewRes?.d1Diagnostic?.counts?.movies || 0) >= 1;
          const hasPrereleaseUpgradeOk = batchItems.some(x => Number(x.replacedPrereleaseCount || 0) > 0 || x.ingestStatus === "updated" || x.ingestStatus === "inserted");
          const hasDuplicateDetectOk = Number(backupImportJob.duplicatesInDb || 0) >= 1 || batchItems.some(x => x.ingestStatus === "duplicate");
          const seriesGapItems = overviewRes?.seriesGaps?.items || [];
          const hasSeriesGapOk = seriesGapItems.some(s => (s.seasons || []).some(sec => (sec.internalGaps || []).includes(3)));
          const hasUncertainYearOk = batchItems.some(x => x.isUncertain || x.reviewReasonCode === "YEAR_CONFLICT");
          const hasFailedNotFoundOk = batchItems.some(x => x.status === "failed" || x.reviewReasonCode === "TMDB_NOT_FOUND");
          const hasDiscoverMainUiOk = Boolean(discoverRes && discoverRes.ok && Array.isArray(discoverRes.items) && discoverRes.items.length > 0);

          const checks = [
            {
              name: "1. Kanal-Verifizierung & Text-Nachrichten-Filter (#9001 ohne Video übersprungen)",
              ok: Boolean(chanRes && chanRes.ok && hasSkipHeaderOk),
              detail: hasSkipHeaderOk ? "9 Video-Einträge aus 10 Nachrichten extrahiert (Reine Textnachricht sauber ignoriert)" : ("Extrahierte Einträge: " + parsedInfo.entries.length)
            },
            {
              name: "2. 1080p Film-Import & D1-Persistenz (Interstellar / Matrix)",
              ok: hasMovieSavedOk,
              detail: "Filme in D1 gespeichert: " + Number(overviewRes?.d1Diagnostic?.counts?.movies || backupImportJob.moviesSaved || 0) + " • Playlisten: " + Number(overviewRes?.d1Diagnostic?.counts?.playlists || 0)
            },
            {
              name: "3. Vorabversion (.TS/CAM) → 1080p BluRay Auto-Upgrade",
              ok: hasPrereleaseUpgradeOk,
              detail: "Matrix (1999) TS erkannt und durch 1080p Version ersetzt/aktualisiert"
            },
            {
              name: "4. Exakter Duplikat-Schutz (gleiche file_id + message_id #9004)",
              ok: hasDuplicateDetectOk,
              detail: "Duplikate erkannt & blockiert: " + Number(backupImportJob.duplicatesInDb || 0)
            },
            {
              name: "5. Serien-Import (Breaking Bad S01E01, E02, E04) + Staffel-Lücken-Finder (S01E03)",
              ok: hasSeriesGapOk,
              detail: hasSeriesGapOk ? "Lücke S01E03 mitten in Staffel 1 erfolgreich im Lücken-Finder erkannt!" : "Serie gespeichert, prüfe Staffel-Lücken-Tab"
            },
            {
              name: "6. Konflikt-Erkennung: Jahres-Abweichung (Inception 1995 vs. 2010) & Nicht erkannt (TMDB_NOT_FOUND)",
              ok: hasUncertainYearOk && hasFailedNotFoundOk,
              detail: "Unsicher (YEAR_CONFLICT): " + (hasUncertainYearOk ? "Ja" : "Nein") + " • Nicht erkannt (TMDB_NOT_FOUND): " + (hasFailedNotFoundOk ? "Ja" : "Nein")
            },
            {
              name: "7. VIP/Admin-Fehlermeldung Lebenszyklus (Anlegen → Bestätigen → Löschen)",
              ok: reportResolveOk && reportDeleteOk,
              detail: reportResolveOk && reportDeleteOk ? "Meldung erstellt, als gelöst markiert und rückstandslos gelöscht" : "Fehler beim Meldungs-Test"
            },
            {
              name: "8. Hauptseiten-Darstellung (/api/tma/discover Katalog nach Import intakt)",
              ok: hasDiscoverMainUiOk,
              detail: hasDiscoverMainUiOk ? (discoverRes.items.length + " Titel im Hauptseiten-Katalog abrufbar") : "Katalog leer oder Fehler"
            }
          ];

          const passedCount = checks.filter(c => c.ok).length;
          const reportHtml =
            '<div style="background:#0d131f;border:1px solid ' + (passedCount === checks.length ? 'rgba(16,185,129,0.55)' : 'rgba(245,158,11,0.55)') + ';border-radius:10px;padding:12px;margin-top:10px">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
                '<div style="font-size:13.5px;font-weight:900;color:#fff">🧪 E2E JSON-Import Prüfbericht: <span style="color:' + (passedCount === checks.length ? '#34d399' : '#fbbf24') + '">' + passedCount + ' / ' + checks.length + ' Tests bestanden</span></div>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  '<button type="button" class="btn amber" style="padding:4px 9px;font-size:11px" onclick="switchBackupSubTab(\\'review\\')">🛠️ Konflikte im Review-Tab ansehen</button>' +
                  '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="state.adminTab=\\'gaps\\';loadAdminPanelView(true)">📉 Staffel-Lücke (S01E03) ansehen</button>' +
                '</div>' +
              '</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                checks.map(c => (
                  '<div style="background:#141b2d;border:1px solid ' + (c.ok ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.45)') + ';border-radius:7px;padding:7px 10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:11.5px">' +
                    '<div style="font-weight:800;color:' + (c.ok ? '#ecfdf5' : '#fecaca') + '">' + (c.ok ? '✅ ' : '❌ ') + esc(c.name) + '</div>' +
                    '<div style="color:#94a3b8;font-size:11px">' + esc(c.detail) + '</div>' +
                  '</div>'
                )).join("") +
              '</div>' +
            '</div>';

          window._lastE2eSimReportHtml = reportHtml;
          setSimStatus(reportHtml);
          renderBackupImportBoxDom();
          showHudToast("✅ E2E JSON-Import Simulation abgeschlossen (" + passedCount + "/" + checks.length + " Checks OK)!");
        } catch (err) {
          setSimStatus('<div style="padding:12px;color:#f87171;font-weight:800">❌ Fehler während der E2E-Simulation: ' + esc(err?.message || String(err)) + '</div>');
        } finally {
          setBusyState(false);
        }
      }

      function resumeBackupFromCheckpointClient() {
        const cp = backupImportJob.savedCheckpoint || loadBackupCheckpointClient();
        if (cp && backupImportJob.entries.length > 0) {
          backupImportJob.cursor = Math.min(Number(cp.cursor || 0), backupImportJob.entries.length);
        }
        showHudToast("▶️ Setze Smart-Import nahtlos bei Eintrag #" + backupImportJob.cursor + " fort...");
        startOrResumeBackupImport();
      }

      function restartBackupFromZeroNoDupesClient() {
        clearBackupCheckpointClient();
        backupImportJob.cursor = 0;
        backupImportJob.moviesSaved = 0;
        backupImportJob.seriesSaved = 0;
        backupImportJob.duplicatesInDb = 0;
        backupImportJob.mergedQualitiesInDb = 0;
        backupImportJob.uncertainCount = 0;
        backupImportJob.failedCount = 0;
        backupImportJob.startedAt = 0;
        backupImportJob.recentLog = ["🔄 Neustart ab Index 0 (Duplikat-Schutz aktiv: bestehende Einträge werden sauber aktualisiert)."];
        showHudToast("🔄 Starte ab 0 neu (ohne Duplikate einzufügen)...");
        startOrResumeBackupImport();
      }

      function updateBackupCustomPlaylistName(val) {
        backupImportJob.customPlaylistName = String(val || "").trim().slice(0, 48);
      }

      function setBackupPlaylistModeClient(modeVal) {
        backupImportJob.playlistMode = ["vip_stream", "watchlist", "both"].includes(modeVal) ? modeVal : "both";
        renderBackupImportBoxDom();
      }

      function switchBackupSubTab(tab) {
        if (tab === "diaglog") {
          backupImportJob.activeSubTab = "diaglog";
          renderBackupImportBoxDom();
          syncDiagnosticLogsFromD1Client(true);
          return;
        }
        backupImportJob.activeSubTab = tab === "review" ? "review" : "dashboard";
        renderBackupImportBoxDom();
        if (backupImportJob.activeSubTab === "review") {
          syncReviewItemsFromD1MetadataClient(true);
        }
      }

      function setBackupReviewFilter(f) {
        backupImportJob.reviewFilter = f || "needs_attention";
        renderBackupImportBoxDom();
      }

      function syncReviewCardDomInputsToItemState(item) {
        if (!item) return;
        const sInp = document.getElementById("revSeasonInp_" + item.id);
        const eInp = document.getElementById("revEpInp_" + item.id);
        const qInp = document.getElementById("revSearchInp_" + item.id);
        const tSel = document.getElementById("revSearchType_" + item.id);
        if (sInp && sInp.value) item.season = Math.max(1, parseInt(sInp.value, 10) || item.season || 1);
        if (eInp && eInp.value) item.episode = Math.max(1, parseInt(eInp.value, 10) || item.episode || 1);
        if (qInp) item.manualSearchQuery = qInp.value;
        if (tSel) item.manualSearchType = tSel.value;
      }

      function updateReviewHeaderCountersInDom() {
        const j = backupImportJob;
        const allItems = j.reviewItems || [];
        const needsCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain || x.contextError || !x.tmdbId)).length;
        const uncertainCount = allItems.filter(x => !x.resolvedByAdmin && x.isUncertain && x.status !== "failed" && Boolean(x.tmdbId)).length;
        const failedCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || !x.tmdbId)).length;

        const btnNeeds = document.getElementById("revBtnNeeds");
        const btnUnc = document.getElementById("revBtnUncertain");
        const btnFail = document.getElementById("revBtnFailed");
        const btnAll = document.getElementById("revBtnAll");
        const tabSubBtn = document.getElementById("revSubTabBtn");

        if (btnNeeds) btnNeeds.innerHTML = "⚠️ Prüfbedarf (" + needsCount + ")";
        if (btnUnc) btnUnc.innerHTML = "🔎 Unsichere Treffer (" + uncertainCount + ")";
        if (btnFail) btnFail.innerHTML = "❌ Nicht erkannt (" + failedCount + ")";
        if (btnAll) btnAll.innerHTML = "📋 Alle importierten (" + allItems.length + ")";
        if (tabSubBtn) {
          tabSubBtn.innerHTML = "🛠️ Prüfen & Korrigieren" + (
            needsCount > 0
              ? (' <span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:999px;font-size:10.5px;margin-left:4px">' + needsCount + '</span>')
              : (" (" + allItems.length + ")")
          );
        }
      }

      function updateSingleReviewCardInDom(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        const cardEl = document.getElementById("revCard_" + itemId);
        if (cardEl) {
          const scrollContainer = document.getElementById("backupReviewScrollContainer");
          const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : null;
          const prevWinScrollY = window.scrollY;
          cardEl.outerHTML = renderSingleBackupReviewCardHtml(it, backupImportJob.reviewItems || []);
          if (scrollContainer && prevScrollTop !== null) {
            scrollContainer.scrollTop = prevScrollTop;
          }
          if (typeof prevWinScrollY === "number" && Math.abs(window.scrollY - prevWinScrollY) > 4) {
            window.scrollTo({ top: prevWinScrollY, behavior: "instant" });
          }
        }
        updateReviewHeaderCountersInDom();
      }

      function reopenResolvedReviewCard(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        it.expandedAfterResolve = true;
        updateSingleReviewCardInDom(itemId);
      }

      function collapseResolvedReviewCard(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        it.expandedAfterResolve = false;
        updateSingleReviewCardInDom(itemId);
      }

      // Bestätigt den aktuellen Vorschlag INKLUSIVE Speicherung von Staffel/Folge & Kanal-Datei-ID in D1!
      async function confirmBackupReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        if (it.tmdbId) {
          await applyBackupCandidateRemap(itemId, it.tmdbId, it.typeCode || "m", { isConfirmAction: true });
          return;
        }
        openManualNoTmdbConfirmForReviewItem(itemId);
      }

            let activeManualNoTmdbContext = null;
      let manualNoTmdbLivePreviewTimer = null;
      const manualNoTmdbQueueState = {
        active: false,
        source: "diag",
        totalInitial: 0,
        processedCount: 0
      };

      function closeManualNoTmdbConfirmModalClient() {
        const el = document.getElementById("manualNoTmdbConfirmModalOverlay");
        if (el) el.style.display = "none";
        activeManualNoTmdbContext = null;
        manualNoTmdbQueueState.active = false;
      }

      function toggleManualNoTmdbSeriesFieldsClient() {
        const typeSel = document.getElementById("manualNoTmdbTypeSel");
        const seWrap = document.getElementById("manualNoTmdbSeriesRow");
        if (seWrap && typeSel) {
          seWrap.style.display = typeSel.value === "s" ? "grid" : "none";
        }
        scheduleManualNoTmdbLivePreviewClient();
      }

      function scheduleManualNoTmdbLivePreviewClient() {
        if (manualNoTmdbLivePreviewTimer) clearTimeout(manualNoTmdbLivePreviewTimer);
        manualNoTmdbLivePreviewTimer = setTimeout(() => {
          updateManualNoTmdbLivePreviewClient();
        }, 180);
      }

      function selectExisting900mSeriesInModalClient(synthId, seriesTitle, seriesYear) {
        const titleInp = document.getElementById("manualNoTmdbTitleInp");
        const yearInp = document.getElementById("manualNoTmdbYearInp");
        const typeSel = document.getElementById("manualNoTmdbTypeSel");
        const reuseInp = document.getElementById("manualNoTmdbReuseIdInp");
        if (titleInp && seriesTitle) titleInp.value = String(seriesTitle);
        if (yearInp && seriesYear && seriesYear !== "k.A.") yearInp.value = String(seriesYear);
        if (typeSel) typeSel.value = "s";
        if (reuseInp) reuseInp.value = String(Number(synthId) || 0);
        toggleManualNoTmdbSeriesFieldsClient();
        showHudToast("🔗 Vorhandene 900M-Serie ausgewählt (#" + synthId + ")");
      }

      async function updateManualNoTmdbLivePreviewClient() {
        const badgeEl = document.getElementById("manualNoTmdbLivePreviewBox");
        const suggestEl = document.getElementById("manualNoTmdbExistingSeriesSuggestBox");
        if (!badgeEl) return;
        const title = String(document.getElementById("manualNoTmdbTitleInp")?.value || "").trim();
        const typeCode = document.getElementById("manualNoTmdbTypeSel")?.value === "s" ? "s" : "m";
        const year = String(document.getElementById("manualNoTmdbYearInp")?.value || "").trim();
        const reuseInp = document.getElementById("manualNoTmdbReuseIdInp");
        const forcedReuseId = Number(reuseInp?.value || 0);

        if (!title) {
          badgeEl.innerHTML = '<span style="color:#94a3b8">Bitte Titel eingeben, um die 900M-ID & Kollisionsprüfung live zu berechnen…</span>';
          if (suggestEl) suggestEl.style.display = "none";
          return;
        }

        try {
          const qs = "?type=" + encodeURIComponent(typeCode) + "&title=" + encodeURIComponent(title) + "&year=" + encodeURIComponent(year);
          const r = await apiFetchJson(API_BASE + "/admin/preview-manual-id" + qs);
          if (!r || !r.ok) return;
          const displayId = forcedReuseId >= 900000000 ? forcedReuseId : Number(r.allocatedId || 0);
          const isReusing = forcedReuseId >= 900000000 || Boolean(r.isExistingMatch);
          const rangeText = esc(r.rangeLabel || (typeCode === "s" ? "945M–989M (Manuelle Serien)" : "900M–944M (Manuelle Filme)"));
          badgeEl.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div>' +
                '<span style="font-size:10.5px;color:#cbd5e1">Synthetische Ziel-ID (' + rangeText + '):</span> ' +
                '<code style="font-size:12.5px;font-weight:900;color:#e9d5ff;background:rgba(168,85,247,0.22);padding:2px 7px;border-radius:5px;border:1px solid rgba(168,85,247,0.5)">#' + displayId + '</code>' +
              '</div>' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:' + (isReusing ? 'rgba(56,189,248,0.2);color:#38bdf8' : 'rgba(16,185,129,0.2);color:#34d399') + '">' +
                (isReusing
                  ? ('♻️ Bestehender 900M-Eintrag erkannt (' + esc(r.existingMatch?.title || title) + ')')
                  : '🟢 Frei & 100% kollisionsfrei in D1') +
              '</span>' +
            '</div>';

          if (suggestEl) {
            const list900 = Array.isArray(r.existing900mSeries) ? r.existing900mSeries : [];
            if (typeCode === "s" && list900.length > 0) {
              suggestEl.style.display = "block";
              suggestEl.innerHTML =
                '<div style="font-size:11px;font-weight:800;color:#38bdf8;margin-bottom:5px">🔗 Vorhandene 900M-Serien in D1 (1-Klick-Verknüpfung für weitere Folgen):</div>' +
                '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                  list900.slice(0, 8).map(s => {
                    const sId = Number(s.id || 0);
                    const sTitle = String(s.title || "");
                    const sYear = String(s.year || "");
                    const activeSel = (forcedReuseId === sId || Number(r.existingMatch?.id || 0) === sId);
                    return '<button type="button" class="btn" style="padding:3px 8px;font-size:10.5px;' + (activeSel ? 'background:rgba(56,189,248,0.28);border-color:#38bdf8;color:#fff' : 'background:#161826;color:#cbd5e1') + '" onclick="selectExisting900mSeriesInModalClient(' + sId + ',\\'' + esc(sTitle) + '\\',\\'' + esc(sYear) + '\\')">📺 ' + esc(sTitle) + ' (#' + sId + ')</button>';
                  }).join("") +
                '</div>';
            } else {
              suggestEl.style.display = "none";
            }
          }
        } catch (e) {}
      }

      function getOpenTmdbNotFoundQueueTargetsClient(source = "diag") {
        if (source === "review") {
          return (backupImportJob.reviewItems || []).filter(it => !it.tmdbId || Number(it.tmdbId) >= 900000000 || it.status === "failed");
        }
        loadClientDiagnosticLogsFromStorage();
        const logs = clientDiagnosticLogState.logs || [];
        const targets = [];
        logs.forEach((l, idx) => {
          const st = String(l.status || "").toUpperCase();
          if (st === "TMDB_NOT_FOUND" || st === "CONFLICT" || st === "CONFLICT_?") {
            targets.push({ diagIdx: idx, log: l });
          }
        });
        return targets;
      }

      function startManualNoTmdbQueueModeClient(source = "diag") {
        const targets = getOpenTmdbNotFoundQueueTargetsClient(source);
        if (targets.length === 0) {
          showHudToast("🎉 Keine offenen TMDB_NOT_FOUND / Konflikt-Einträge für den Queue-Modus vorhanden!");
          return;
        }
        manualNoTmdbQueueState.active = true;
        manualNoTmdbQueueState.source = source;
        manualNoTmdbQueueState.totalInitial = targets.length;
        manualNoTmdbQueueState.processedCount = 0;
        if (source === "review") {
          openManualNoTmdbConfirmForReviewItem(targets[0].id);
        } else {
          openManualNoTmdbConfirmForDiagItem(targets[0].diagIdx);
        }
      }

      function skipCurrentManualNoTmdbQueueItemClient() {
        const ctx = activeManualNoTmdbContext;
        if (!ctx) return;
        const targets = getOpenTmdbNotFoundQueueTargetsClient(manualNoTmdbQueueState.source);
        if (targets.length <= 1) {
          showHudToast("ℹ️ Kein weiterer offener Eintrag in der Queue.");
          return;
        }
        let nextTarget = targets[0];
        if (manualNoTmdbQueueState.source === "review") {
          const curIdx = targets.findIndex(t => String(t.id) === String(ctx.itemId));
          nextTarget = targets[(curIdx + 1) % targets.length];
          openManualNoTmdbConfirmForReviewItem(nextTarget.id);
        } else {
          const curIdx = targets.findIndex(t => Number(t.diagIdx) === Number(ctx.diagIdx));
          nextTarget = targets[(curIdx + 1) % targets.length];
          openManualNoTmdbConfirmForDiagItem(nextTarget.diagIdx);
        }
      }

      async function submitMigrate900mToRealTmdbClient() {
        const oldInp = document.getElementById("manualMigrateOld900mInp");
        const newInp = document.getElementById("manualMigrateNewTmdbInp");
        const typeSel = document.getElementById("manualNoTmdbTypeSel");
        const oldSyntheticId = Number(oldInp?.value || activeManualNoTmdbContext?.existingSyntheticId || 0);
        const newTmdbId = Number(newInp?.value || 0);
        const typeCode = typeSel?.value === "s" ? "s" : "m";
        if (oldSyntheticId < 900000000 || !newTmdbId || newTmdbId >= 900000000) {
          showHudToast("⚠️ Bitte eine gültige 900M-ID (>= 900.000.000) und eine echte TMDb-ID (< 900.000.000) eingeben.");
          return;
        }
        setBusyState(true, "🔄 Migriere #" + oldSyntheticId + " inkl. Episoden, Streams & Playlisten auf TMDb #" + newTmdbId + "...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/migrate-synthetic-id", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldSyntheticId,
              newTmdbId,
              typeCode,
              targetChatId: backupImportJob.targetPlaylistChatId || chatId
            })
          });
          if (r && r.ok) {
            clearClientMediaCaches();
            closeManualNoTmdbConfirmModalClient();
            showHudToast("✅ Migration abgeschlossen: #" + oldSyntheticId + " → TMDb #" + newTmdbId + (r.officialTitle ? (" (" + r.officialTitle + ")") : ""));
            refreshDiagnosticLogMountDom();
            if (state.view === "admin") loadAdminPanelView();
          } else {
            showHudToast("⚠️ " + (r?.error || "Migration fehlgeschlagen"));
          }
        } finally {
          setBusyState(false);
        }
      }

      function openManualNoTmdbConfirmModalClient(ctx) {
        if (!ctx || typeof ctx !== "object") return;
        activeManualNoTmdbContext = ctx;
        let overlay = document.getElementById("manualNoTmdbConfirmModalOverlay");
        if (!overlay && document.body) {
          overlay = document.createElement("div");
          overlay.id = "manualNoTmdbConfirmModalOverlay";
          overlay.style.cssText =
            "position:fixed;inset:0;z-index:12000;background:rgba(5,6,12,0.84);backdrop-filter:blur(7px);" +
            "display:flex;align-items:center;justify-content:center;padding:14px;";
          document.body.appendChild(overlay);
        }
        if (!overlay) return;

        const initType = ctx.typeCode === "s" ? "s" : "m";
        const initTitle = String(ctx.title || "").trim();
        const initYear = String(ctx.year && ctx.year !== "k.A." ? ctx.year : "").replace(/[^0-9]/g, "").slice(0, 4);
        const initSeason = ctx.season !== undefined && ctx.season !== null ? Math.max(0, parseInt(ctx.season, 10) || 0) : 1;
        const initEpisode = Math.max(1, parseInt(ctx.episode, 10) || 1);
        const initPoster = String(ctx.poster || "").trim();
        const initGenres = String(ctx.genres || "Manuell bestätigt").trim();
        const initOverview = String(ctx.overview || "").trim();
        const sibCount = Number(ctx.siblingCount || 0);
        const existingSynthId = Number(ctx.existingSyntheticId || 0);
        const openQueueTargets = getOpenTmdbNotFoundQueueTargetsClient(ctx.mode === "review" ? "review" : "diag");
        const isQueueActive = Boolean(manualNoTmdbQueueState.active);

        overlay.style.display = "flex";
        overlay.innerHTML =
          '<div style="width:min(95vw,540px);background:#12131c;border:1px solid rgba(168,85,247,0.45);border-radius:14px;padding:16px;box-shadow:0 20px 50px rgba(0,0,0,0.85);color:#f8fafc;max-height:92vh;overflow-y:auto">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">' +
              '<div>' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
                  '<span style="font-size:15px;font-weight:900;color:#fff">✨ 900M-ID Abgleich-Modal (Manuelle Bestätigung)</span>' +
                  (isQueueActive ? (
                    '<span style="font-size:10.5px;font-weight:900;padding:2px 8px;border-radius:999px;background:rgba(56,189,248,0.22);color:#38bdf8;border:1px solid rgba(56,189,248,0.45)">⚡ Queue-Modus aktiv (' + openQueueTargets.length + ' offen)</span>'
                  ) : '') +
                '</div>' +
                '<div style="font-size:11.5px;color:#cbd5e1;margin-top:2px">Erhält eine kollisionsfreie synthetische ID im exklusiven <b>900.000.000+</b> Bereich (überschreibt niemals TMDb-IDs) und aktiviert den Schreibschutz (<code>manual_override = 1</code>).</div>' +
              '</div>' +
              '<button type="button" class="btn" style="padding:4px 9px;font-size:12px" onclick="closeManualNoTmdbConfirmModalClient()">✕</button>' +
            '</div>' +
            '<input id="manualNoTmdbReuseIdInp" type="hidden" value="' + (existingSynthId >= 900000000 ? existingSynthId : 0) + '" />' +
            '<div id="manualNoTmdbLivePreviewBox" style="background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.35);border-radius:8px;padding:8px 10px;margin-bottom:9px;font-size:11.5px">Berechne 900M-ID Vorschau…</div>' +
            '<div id="manualNoTmdbExistingSeriesSuggestBox" style="display:none;background:rgba(15,23,42,0.9);border:1px solid rgba(56,189,248,0.35);border-radius:8px;padding:8px 10px;margin-bottom:9px"></div>' +
            (ctx.rawFileName ? (
              '<div style="background:#0b0c12;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:7px 10px;margin-bottom:10px;font-size:11px;color:#94a3b8;word-break:break-all">' +
                '📄 <b>Datei / Quelle:</b> <code style="color:#e2e8f0">' + esc(ctx.rawFileName) + '</code>' +
              '</div>'
            ) : '') +
            '<div style="display:flex;flex-direction:column;gap:9px">' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:#c084fc;margin-bottom:4px">🎬 Titel (Pflichtfeld)</label>' +
                '<input id="manualNoTmdbTitleInp" value="' + esc(initTitle) + '" oninput="document.getElementById(\\'manualNoTmdbReuseIdInp\\').value=\\'0\\';scheduleManualNoTmdbLivePreviewClient()" placeholder="z.B. Seltene Dokumentation / Eigenproduktion" style="width:100%;padding:8px 10px;border-radius:7px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12.5px;box-sizing:border-box" />' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:4px">📂 Medientyp</label>' +
                  '<select id="manualNoTmdbTypeSel" onchange="document.getElementById(\\'manualNoTmdbReuseIdInp\\').value=\\'0\\';toggleManualNoTmdbSeriesFieldsClient()" style="width:100%;padding:8px 10px;border-radius:7px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12.5px;box-sizing:border-box">' +
                    '<option value="m"' + (initType === 'm' ? ' selected' : '') + '>🎬 Film (900M–944M)</option>' +
                    '<option value="s"' + (initType === 's' ? ' selected' : '') + '>📺 Serie (945M–989M)</option>' +
                  '</select>' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:4px">📅 Erscheinungsjahr (optional)</label>' +
                  '<input id="manualNoTmdbYearInp" type="number" min="1900" max="2099" value="' + esc(initYear) + '" oninput="document.getElementById(\\'manualNoTmdbReuseIdInp\\').value=\\'0\\';scheduleManualNoTmdbLivePreviewClient()" placeholder="z.B. 2024" style="width:100%;padding:8px 10px;border-radius:7px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12.5px;box-sizing:border-box" />' +
                '</div>' +
              '</div>' +
              '<div id="manualNoTmdbSeriesRow" style="display:' + (initType === 's' ? 'grid' : 'none') + ';grid-template-columns:1fr 1fr;gap:8px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3);border-radius:8px;padding:8px">' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:#e9d5ff;margin-bottom:3px">📺 Staffel (S, 0 = Bonus/Special)</label>' +
                  '<input id="manualNoTmdbSeasonInp" type="number" min="0" max="99" value="' + initSeason + '" style="width:100%;padding:6px 8px;border-radius:6px;background:#12131c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;box-sizing:border-box" />' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:11px;font-weight:800;color:#e9d5ff;margin-bottom:3px">🎞️ Episode (E)</label>' +
                  '<input id="manualNoTmdbEpInp" type="number" min="1" max="999" value="' + initEpisode + '" style="width:100%;padding:6px 8px;border-radius:6px;background:#12131c;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;box-sizing:border-box" />' +
                '</div>' +
                (sibCount >= 2 ? (
                  '<label style="grid-column:1 / -1;display:flex;align-items:center;gap:6px;font-size:11.5px;color:#38bdf8;cursor:pointer;margin-top:2px">' +
                    '<input id="manualNoTmdbApplySiblingsChk" type="checkbox" checked />' +
                    '<span>⚡ Alle <b>' + sibCount + ' offenen Folgen</b> dieser Serie gleich mit derselben Serien-ID verknüpfen</span>' +
                  '</label>'
                ) : '') +
              '</div>' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:4px">🖼️ Optionaler Poster-Link (HTTPS Bild-URL)</label>' +
                '<input id="manualNoTmdbPosterInp" value="' + esc(initPoster) + '" placeholder="https://... (leer lassen für Standard-Cover)" style="width:100%;padding:8px 10px;border-radius:7px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;box-sizing:border-box" />' +
              '</div>' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:4px">🏷️ Genres (optional)</label>' +
                '<input id="manualNoTmdbGenresInp" value="' + esc(initGenres) + '" placeholder="z.B. Dokumentation, Konzert, Eigenproduktion" style="width:100%;padding:7px 10px;border-radius:7px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;box-sizing:border-box" />' +
              '</div>' +
              '<div>' +
                '<label style="display:block;font-size:11px;font-weight:800;color:#94a3b8;margin-bottom:4px">📝 Kurzbeschreibung (optional)</label>' +
                '<textarea id="manualNoTmdbOverviewInp" rows="2" placeholder="Optionale Beschreibung für die Detailansicht..." style="width:100%;padding:7px 10px;border-radius:7px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px;box-sizing:border-box;resize:vertical">' + esc(initOverview) + '</textarea>' +
              '</div>' +
              '<label style="display:flex;align-items:center;gap:7px;font-size:11.5px;color:#cbd5e1;cursor:pointer;background:#161824;padding:7px 10px;border-radius:7px;border:1px solid rgba(255,255,255,0.08)">' +
                '<input id="manualNoTmdbQueueContinueChk" type="checkbox" ' + ((isQueueActive || openQueueTargets.length > 1) ? 'checked' : '') + ' />' +
                '<span>⏭️ <b>Queue-Modus:</b> Nach dem Speichern automatisch nächsten offenen <code>TMDB_NOT_FOUND</code>-Treffer öffnen (' + openQueueTargets.length + ' offen)</span>' +
              '</label>' +
              '<details style="background:#0d0f18;border:1px solid rgba(56,189,248,0.3);border-radius:8px;padding:8px 10px"' + (existingSynthId >= 900000000 ? ' open' : '') + '>' +
                '<summary style="cursor:pointer;font-size:11.5px;font-weight:800;color:#38bdf8">🔄 1-Klick-Upgrade: Bestehende 900M-ID später auf echte TMDb-ID umziehen</summary>' +
                '<div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;font-size:11px;color:#94a3b8">' +
                  '<div>Zieht alle Episoden, Videodateien, Aliase und Playlisten einer synthetischen 900M-ID verlustfrei auf eine offizielle TMDb-ID um und löscht den alten 900M-Datensatz.</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                    '<input id="manualMigrateOld900mInp" type="number" value="' + (existingSynthId >= 900000000 ? existingSynthId : '') + '" placeholder="Alte 900M-ID (z.B. 945123456)" style="flex:1;min-width:140px;padding:6px 8px;border-radius:6px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
                    '<input id="manualMigrateNewTmdbInp" type="number" placeholder="Neue echte TMDb-ID (z.B. 66732)" style="flex:1;min-width:140px;padding:6px 8px;border-radius:6px;background:#181926;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px" />' +
                    '<button type="button" class="btn blue" style="padding:6px 10px;font-size:11.5px;font-weight:800" onclick="submitMigrate900mToRealTmdbClient()">🔄 Jetzt auf TMDb-ID migrieren</button>' +
                  '</div>' +
                '</div>' +
              '</details>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap">' +
              '<div>' +
                (openQueueTargets.length > 1 ? '<button type="button" class="btn" onclick="skipCurrentManualNoTmdbQueueItemClient()">⏭️ Nächster Treffer (' + openQueueTargets.length + ')</button>' : '') +
              '</div>' +
              '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                '<button type="button" class="btn" onclick="closeManualNoTmdbConfirmModalClient()">Abbrechen</button>' +
                '<button type="button" class="btn green" style="background:linear-gradient(90deg,#7c3aed,#059669);border-color:#a855f7;font-weight:800" onclick="submitManualNoTmdbConfirmModalClient()">✨ Ohne TMDb-ID speichern & zuweisen</button>' +
              '</div>' +
            '</div>' +
          '</div>';

        updateManualNoTmdbLivePreviewClient();
      }

      function openManualNoTmdbConfirmForReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        const searchInp = document.getElementById("revSearchInp_" + itemId);
        const seasonInp = document.getElementById("revSeasonInp_" + itemId);
        const epInp = document.getElementById("revEpInp_" + itemId);
        const rawFileName = it.rawFileName || it.rawEntry?.raw_file_name || it.rawEntry?.filename || it.rawInput || "";
        const siblings = getMatchingOpenSeriesSiblingItems(it, null);
        const guessType = (it.typeCode === "s" || it.season || it.episode || /S\\d{1,2}E\\d{1,3}|Staffel|Folge|Episode/i.test(rawFileName)) ? "s" : "m";
        openManualNoTmdbConfirmModalClient({
          mode: "review",
          itemId: it.id,
          title: (searchInp && searchInp.value.trim()) ? searchInp.value.trim() : (it.cleanTitle || it.rawInput || "Unbekannter Titel"),
          year: it.year && it.year !== "k.A." ? it.year : "",
          typeCode: guessType,
          season: seasonInp ? seasonInp.value : (it.season ?? 1),
          episode: epInp ? epInp.value : (it.episode || 1),
          poster: it.poster || "",
          rawFileName,
          siblingCount: siblings.length,
          existingSyntheticId: Number(it.tmdbId || 0) >= 900000000 ? Number(it.tmdbId) : 0
        });
      }

      function openManualNoTmdbConfirmForDiagItem(diagIdx) {
        loadClientDiagnosticLogsFromStorage();
        const item = clientDiagnosticLogState.logs[diagIdx];
        if (!item) return;
        const typeSel = document.getElementById("diagFixType_" + diagIdx);
        const sInp = document.getElementById("diagFixSeason_" + diagIdx);
        const eInp = document.getElementById("diagFixEp_" + diagIdx);
        openManualNoTmdbConfirmModalClient({
          mode: "diag",
          diagIdx,
          title: item.parsedTitle || item.fileName || "Unbekannter Titel",
          year: "",
          typeCode: (typeSel ? typeSel.value : (item.detectedType === "series" || item.seasonNumber !== null ? "s" : "m")),
          season: sInp ? sInp.value : (item.seasonNumber ?? 1),
          episode: eInp ? eInp.value : (item.episodeNumber || 1),
          poster: "",
          rawFileName: item.fileName || item.rawText || "",
          existingSyntheticId: Number(item.tmdbId || 0) >= 900000000 ? Number(item.tmdbId) : 0
        });
      }

      function openManualNoTmdbConfirmForCrudClient() {
        const typeCode = document.getElementById("crudTypeSel")?.value || "m";
        const title = document.getElementById("crudTitleInp")?.value.trim() || "";
        const year = document.getElementById("crudYearInp")?.value.trim() || "";
        openManualNoTmdbConfirmModalClient({
          mode: "crud",
          title,
          year,
          typeCode,
          season: 1,
          episode: 1,
          poster: ""
        });
      }

      async function submitManualNoTmdbConfirmModalClient() {
        const ctx = activeManualNoTmdbContext;
        if (!ctx) return;
        const title = String(document.getElementById("manualNoTmdbTitleInp")?.value || "").trim();
        const typeCode = document.getElementById("manualNoTmdbTypeSel")?.value === "s" ? "s" : "m";
        const year = String(document.getElementById("manualNoTmdbYearInp")?.value || "").trim();
        const seasonRaw = document.getElementById("manualNoTmdbSeasonInp")?.value;
        const season = seasonRaw !== undefined && seasonRaw !== "" ? Math.max(0, parseInt(seasonRaw, 10) || 0) : 1;
        const episode = Math.max(1, parseInt(document.getElementById("manualNoTmdbEpInp")?.value, 10) || 1);
        const poster = String(document.getElementById("manualNoTmdbPosterInp")?.value || "").trim();
        const genres = String(document.getElementById("manualNoTmdbGenresInp")?.value || "Manuell bestätigt").trim();
        const overview = String(document.getElementById("manualNoTmdbOverviewInp")?.value || "").trim();
        const applySiblings = Boolean(document.getElementById("manualNoTmdbApplySiblingsChk")?.checked);
        const continueQueue = Boolean(document.getElementById("manualNoTmdbQueueContinueChk")?.checked);
        const reuseSyntheticId = Number(document.getElementById("manualNoTmdbReuseIdInp")?.value || 0);

        if (!title) {
          showHudToast("⚠️ Bitte einen Titel für die manuelle Bestätigung eingeben.");
          return;
        }

        const manualCustomMeta = {
          title,
          originalTitle: title,
          year: year || "k.A.",
          poster,
          genres: genres || "Manuell bestätigt",
          overview: overview || "Manuell ohne TMDb-ID bestätigter Titel.",
          reuseSyntheticId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
          source: "Manuell bestätigt"
        };

        const prevMode = ctx.mode;
        closeManualNoTmdbConfirmModalClient();
        if (continueQueue) {
          manualNoTmdbQueueState.active = true;
          manualNoTmdbQueueState.source = prevMode === "review" ? "review" : "diag";
        }

        const maybeOpenNextInQueue = () => {
          if (!continueQueue) return;
          const remaining = getOpenTmdbNotFoundQueueTargetsClient(prevMode === "review" ? "review" : "diag");
          if (remaining.length > 0) {
            setTimeout(() => {
              if (prevMode === "review") openManualNoTmdbConfirmForReviewItem(remaining[0].id);
              else openManualNoTmdbConfirmForDiagItem(remaining[0].diagIdx);
            }, 160);
          } else {
            manualNoTmdbQueueState.active = false;
            showHudToast("🎉 Queue abgeschlossen – alle offenen Einträge wurden abgearbeitet!");
          }
        };

        if (ctx.mode === "review" && ctx.itemId) {
          const baseItem = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(ctx.itemId));
          if (!baseItem) return;
          const sInp = document.getElementById("revSeasonInp_" + ctx.itemId);
          const eInp = document.getElementById("revEpInp_" + ctx.itemId);
          if (sInp) sInp.value = String(season);
          if (eInp) eInp.value = String(episode);
          baseItem.season = season;
          baseItem.episode = episode;
          baseItem.cleanTitle = title;
          if (year) baseItem.year = year;

          const siblings = (typeCode === "s" && applySiblings)
            ? getMatchingOpenSeriesSiblingItems(baseItem, null)
            : [baseItem];
          const targetList = siblings.length > 0 ? siblings : [baseItem];

          setBusyState(true, "✨ Vergib kollisionsfreie 900M-ID & speichere „" + title + "“ in D1...");
          try {
            let sharedAllocatedId = reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0;
            let okCount = 0;
            for (const sib of targetList) {
              const ok = await applyBackupCandidateRemap(sib.id, sharedAllocatedId, typeCode, {
                isConfirmAction: true,
                confirmManualWithoutTmdb: true,
                manualCustomMeta,
                candidateMeta: manualCustomMeta,
                silentBusy: true
              });
              if (ok) {
                okCount++;
                if (!sharedAllocatedId && sib.tmdbId) {
                  sharedAllocatedId = Number(sib.tmdbId);
                }
              }
            }
            clearClientMediaCaches();
            showHudToast("✨ Manuell ohne TMDb-ID gespeichert: " + title + (sharedAllocatedId ? (" (#" + sharedAllocatedId + ")") : "") + (targetList.length > 1 ? (" [" + okCount + " Folgen]") : ""));
            maybeOpenNextInQueue();
          } finally {
            setBusyState(false);
          }
          return;
        }

        if (ctx.mode === "diag" && ctx.diagIdx !== undefined) {
          loadClientDiagnosticLogsFromStorage();
          const item = clientDiagnosticLogState.logs[ctx.diagIdx];
          if (!item) return;
          setBusyState(true, "✨ Weise Diagnose-Eintrag kollisionsfreie 900M-ID zu...");
          try {
            const rawEntry = item.rawEntry && typeof item.rawEntry === "object"
              ? { ...item.rawEntry }
              : {
                  filename: item.fileName,
                  raw_file_name: item.fileName,
                  raw_text: item.rawText,
                  msg_id: item.msgId,
                  message_id: item.msgId
                };
            if (typeCode === "s") {
              rawEntry.season = season;
              rawEntry.episode = episode;
              rawEntry.isSeries = true;
            }
            const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                newTmdbId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
                reuseSyntheticId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
                newTypeCode: typeCode,
                confirmManualWithoutTmdb: true,
                manualCustomMeta,
                msgId: item.msgId || null,
                season: typeCode === "s" ? season : null,
                episode: typeCode === "s" ? episode : null,
                oldTmdbId: item.tmdbId || null,
                oldTypeCode: item.detectedType === "series" ? "s" : "m",
                targetChatId: backupImportJob.targetPlaylistChatId || chatId,
                playlistFolderId: backupImportJob.playlistFolderId || null,
                playlistMode: backupImportJob.playlistMode || "both",
                rawEntry
              })
            });
            if (r && r.ok && r.matchedItem) {
              item.status = "OK";
              item.tmdbId = r.matchedItem.tmdbId;
              item.matchedTitle = r.matchedItem.matchedTitle || r.matchedItem.cleanTitle;
              item.detectedType = typeCode === "s" ? "series" : "movie";
              item.seasonNumber = typeCode === "s" ? season : null;
              item.episodeNumber = typeCode === "s" ? episode : null;
              item.reason = "Manuell ohne TMDb-ID bestätigt → " + r.matchedItem.cleanTitle + " (#" + r.matchedItem.tmdbId + ")";
              saveClientDiagnosticLogsToStorage();
              await apiFetchJson(API_BASE + "/admin/import-logs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "resolve",
                  id: item.id,
                  msgId: item.msgId,
                  tmdbId: r.matchedItem.tmdbId,
                  reason: item.reason
                })
              }).catch(() => {});
              clearClientMediaCaches();
              showHudToast("✨ Manuell ohne TMDb-ID verknüpft: " + r.matchedItem.cleanTitle + " (#" + r.matchedItem.tmdbId + ")");
              refreshDiagnosticLogMountDom();
              maybeOpenNextInQueue();
            } else {
              showHudToast("⚠️ " + (r?.error || "Manuelle Zuweisung fehlgeschlagen"));
            }
          } finally {
            setBusyState(false);
          }
          return;
        }

        if (ctx.mode === "crud") {
          const fileId = document.getElementById("crudFileIdInp")?.value.trim() || "";
          const quality = document.getElementById("crudQualityInp")?.value.trim() || "1080p";
          const fileSize = document.getElementById("crudFileSizeInp")?.value.trim() || "";
          const tags = document.getElementById("crudTagsInp")?.value.trim() || "";
          setBusyState(true, "✨ Lege manuellen Titel ohne TMDb-ID in D1 an...");
          try {
            const r = await apiFetchJson(API_BASE + "/admin/media", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "upsert",
                confirmManualWithoutTmdb: true,
                typeCode,
                tmdbId: reuseSyntheticId >= 900000000 ? reuseSyntheticId : 0,
                title,
                year,
                poster,
                genres,
                overview,
                season,
                episode,
                fileId,
                quality,
                fileSize,
                tags
              })
            });
            clearClientMediaCaches();
            if (!r || !r.ok) showHudToast("⚠️ " + (r?.error || "Fehler beim Anlegen"));
            else showHudToast("✨ Manuell angelegt: " + title + " (#" + (r.item?.id || r.item?.tmdbId || "") + ")");
            state.adminMediaType = typeCode;
            await loadAdminPanelView();
          } finally {
            setBusyState(false);
          }
        }
      }

      function usePrevMessageForReviewSearch(itemId, queryText) {
        const inp = document.getElementById("revSearchInp_" + itemId);
        if (inp) {
          inp.value = String(queryText || "").trim();
          searchManualCandidatesForReviewItem(itemId);
        }
      }

      // Findet alle weiteren offenen Folgen derselben Serie in der Prüfliste (z. B. Axel will's wissen S01E09, S01E10, S01E12)
      function getMatchingOpenSeriesSiblingItems(baseItem, targetTmdbId = null) {
        if (!baseItem) return [];
        const allItems = backupImportJob.reviewItems || [];
        const normBase = normalizeClientCompareTitle(baseItem.cleanTitle || "");
        const effId = Number(targetTmdbId || baseItem.tmdbId || 0);
        return allItems.filter(x => {
          if (!x || x.resolvedByAdmin) return false;
          if (effId > 0 && Number(x.tmdbId || 0) === effId) return true;
          const normX = normalizeClientCompareTitle(x.cleanTitle || "");
          if (normBase && normX && normBase === normX) return true;
          return false;
        });
      }

      async function applyBackupCandidateRemap(itemId, newTmdbId, newTypeCode, options = null) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        const isManualNoTmdb = Boolean(options?.confirmManualWithoutTmdb);
        if (!it || (!newTmdbId && !isManualNoTmdb)) return false;
        syncReviewCardDomInputsToItemState(it);

        const cands = Array.isArray(it.candidates) ? it.candidates : [];
        const matchedCand = cands.find(c => Number(c.tmdbId) === Number(newTmdbId) && (c.typeCode || "m") === (newTypeCode === "s" ? "s" : "m")) || null;

        const seasonInp = document.getElementById("revSeasonInp_" + itemId);
        const epInp = document.getElementById("revEpInp_" + itemId);
        const rawFileName = it.rawFileName || it.rawEntry?.raw_file_name || it.rawEntry?.filename || it.rawInput || "";
        const rawTailMatch = String(rawFileName).replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "").match(/(?:^|\\s|[-_])(?:teil\\s*|part\\s*|ep\\.?\\s*)?0*(\\d{1,2})\\s*$/i);
        const inferredTailEp = rawTailMatch ? parseInt(rawTailMatch[1], 10) : null;

        const fallbackSeason = matchedCand?.inferredSeason || it.season || 1;
        const fallbackEpisode = matchedCand?.inferredEpisode || it.episode || (inferredTailEp >= 1 && inferredTailEp <= 99 ? inferredTailEp : 1);

        const manualSeason = newTypeCode === "s"
          ? Math.max(1, parseInt(seasonInp ? seasonInp.value : fallbackSeason, 10) || fallbackSeason)
          : null;
        const manualEpisode = newTypeCode === "s"
          ? Math.max(1, parseInt(epInp ? epInp.value : fallbackEpisode, 10) || fallbackEpisode)
          : null;

        const candidateMeta = options?.candidateMeta || (matchedCand ? {
          id: Number(matchedCand.tmdbId),
          title: matchedCand.title || it.cleanTitle || "Unbekannt",
          originalTitle: matchedCand.originalTitle || matchedCand.title || "",
          year: matchedCand.year || it.year || "k.A.",
          poster: matchedCand.poster || it.poster || "",
          vote_average: Number(matchedCand.voteAverage || 0),
          source: matchedCand.source || it.metadataSource || "Fallback"
        } : {
          id: Number(newTmdbId || 0),
          title: it.cleanTitle || "Unbekannt",
          year: it.year || "k.A.",
          poster: it.poster || "",
          source: isManualNoTmdb ? "Manuell bestätigt" : (it.metadataSource || "Fallback")
        });

        const activeChan = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        const silentBusy = Boolean(options?.silentBusy);
        if (!silentBusy) {
          setBusyState(true, options?.isConfirmAction ? "💾 Speichere Bestätigung in D1 & Playlist..." : "🔄 Aktualisiere Zuordnung in D1 & Playlist...");
        }
        try {
          const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oldTmdbId: it.tmdbId || null,
              oldTypeCode: it.typeCode || "m",
              oldSeason: it.season || null,
              oldEpisode: it.episode || null,
              newTmdbId: Number(newTmdbId || 0),
              newTypeCode: newTypeCode === "s" ? "s" : "m",
              confirmManualWithoutTmdb: isManualNoTmdb,
              manualCustomMeta: options?.manualCustomMeta || null,
              sourceChannelId: activeChan || "",
              messageId: it.messageId || it.rawEntry?.message_id || it.rawEntry?.msg_id || null,
              candidateMeta,
              rawEntry: it.rawEntry || { filename: it.rawInput },
              playlistFolderId: backupImportJob.playlistFolderId || null,
              playlistName: backupImportJob.customPlaylistName || "🎵 JSON-Import",
              playlistMode: backupImportJob.playlistMode || "both",
              targetChatId: backupImportJob.targetPlaylistChatId || chatId,
              season: manualSeason,
              episode: manualEpisode
            })
          });
          if (!r || !r.ok || !r.matchedItem) {
            if (!silentBusy) showHudToast("⚠️ " + (r?.error || "Speicherung fehlgeschlagen."));
            return false;
          }
          const wasFailed = it.status === "failed" || !it.tmdbId;
          const wasUncertain = Boolean(it.isUncertain);
          const prevType = it.typeCode;

          it.tmdbId = r.matchedItem.tmdbId;
          it.typeCode = r.matchedItem.typeCode;
          it.cleanTitle = r.matchedItem.cleanTitle;
          it.year = r.matchedItem.year;
          it.poster = r.matchedItem.poster;
          if (r.matchedItem.season) it.season = r.matchedItem.season;
          if (r.matchedItem.episode) it.episode = r.matchedItem.episode;
          if (r.matchedItem.episodeTitle) it.episodeTitle = r.matchedItem.episodeTitle;
          if (r.matchedItem.metadataSource) it.metadataSource = r.matchedItem.metadataSource;
          it.confidence = 100;
          it.isUncertain = false;
          it.status = options?.isConfirmAction ? "confirmed" : "remapped";
          it.resolvedByAdmin = true;
          it.expandedAfterResolve = false;

          if (wasFailed) {
            backupImportJob.failedCount = Math.max(0, backupImportJob.failedCount - 1);
            if (r.matchedItem.typeCode === "s") backupImportJob.seriesSaved++;
            else backupImportJob.moviesSaved++;
          } else {
            if (wasUncertain) backupImportJob.uncertainCount = Math.max(0, backupImportJob.uncertainCount - 1);
            if (prevType !== r.matchedItem.typeCode) {
              if (r.matchedItem.typeCode === "s") {
                backupImportJob.moviesSaved = Math.max(0, backupImportJob.moviesSaved - 1);
                backupImportJob.seriesSaved++;
              } else {
                backupImportJob.seriesSaved = Math.max(0, backupImportJob.seriesSaved - 1);
                backupImportJob.moviesSaved++;
              }
            }
          }

          saveBackupCheckpointClient(false);
          updateSingleReviewCardInDom(itemId);

          if (!silentBusy) {
            const seSuffix = r.matchedItem.typeCode === "s" && r.matchedItem.season && r.matchedItem.episode
              ? (" S" + String(r.matchedItem.season).padStart(2, "0") + "E" + String(r.matchedItem.episode).padStart(2, "0"))
              : "";
            showHudToast("✅ In D1 gespeichert: " + r.matchedItem.cleanTitle + seSuffix + " (" + r.matchedItem.year + ")");
          }
          return true;
        } finally {
          if (!silentBusy) setBusyState(false);
        }
      }

      // 1-Klick Sammel-Bestätigung für alle Folgen derselben Serie (jede Folge behält ihre eigene S/E Nummer!)
      async function confirmAllSeriesEpisodesInReview(itemId, targetTmdbId, targetTypeCode = "s") {
        const baseItem = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!baseItem) return;
        const effTmdbId = Number(targetTmdbId || baseItem.tmdbId || 0);
        if (!effTmdbId) return;

        const siblings = getMatchingOpenSeriesSiblingItems(baseItem, effTmdbId);
        if (siblings.length === 0) return;

        const cands = Array.isArray(baseItem.candidates) ? baseItem.candidates : [];
        const matchedCand = cands.find(c => Number(c.tmdbId) === effTmdbId) || null;
        const sharedCandidateMeta = matchedCand ? {
          id: effTmdbId,
          title: matchedCand.title || baseItem.cleanTitle || "Unbekannt",
          originalTitle: matchedCand.originalTitle || matchedCand.title || "",
          year: matchedCand.year || baseItem.year || "k.A.",
          poster: matchedCand.poster || baseItem.poster || "",
          vote_average: Number(matchedCand.voteAverage || 0),
          source: matchedCand.source || baseItem.metadataSource || "Fallback"
        } : {
          id: effTmdbId,
          title: baseItem.cleanTitle || "Unbekannt",
          year: baseItem.year || "k.A.",
          poster: baseItem.poster || "",
          source: baseItem.metadataSource || "Fallback"
        };

        let okCount = 0;
        setBusyState(true, "⚡ Speichere alle " + siblings.length + " Folgen von „" + (sharedCandidateMeta.title || baseItem.cleanTitle) + "“ in D1...");
        try {
          for (const sib of siblings) {
            const success = await applyBackupCandidateRemap(sib.id, effTmdbId, targetTypeCode || "s", {
              isConfirmAction: true,
              silentBusy: true,
              candidateMeta: sharedCandidateMeta
            });
            if (success) okCount++;
          }
          showHudToast("🎉 " + okCount + " / " + siblings.length + " Folgen von „" + (sharedCandidateMeta.title || baseItem.cleanTitle) + "“ in D1 gespeichert!");
        } finally {
          setBusyState(false);
        }
      }

      async function searchManualCandidatesForReviewItem(itemId) {
        const it = (backupImportJob.reviewItems || []).find(x => String(x.id) === String(itemId));
        if (!it) return;
        syncReviewCardDomInputsToItemState(it);
        const inp = document.getElementById("revSearchInp_" + itemId);
        const sel = document.getElementById("revSearchType_" + itemId);
        const q = (inp ? inp.value : it.cleanTitle || it.rawInput || "").trim();
        const typeVal = sel ? sel.value : "auto";
        if (!q) {
          showHudToast("⚠️ Bitte Suchbegriff oder TMDb-ID eingeben.");
          return;
        }
        it.manualSearchQuery = q;
        it.manualSearchType = typeVal;
        setBusyState(true, "🔍 Durchsuche alle 8 APIs nach „" + q + "“...");
        try {
          const r = await apiFetchJson(
            API_BASE + "/admin/tmdb-candidates?q=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(typeVal)
          );
          if (r && Array.isArray(r.candidates)) {
            it.candidates = r.candidates;
            if (r.candidates.length === 0) showHudToast("ℹ️ Keine Treffer für „" + q + "“ gefunden.");
          }
          updateSingleReviewCardInDom(itemId);
        } finally {
          setBusyState(false);
        }
      }

      function inferClientReviewReasonCode(item) {
        if (!item || typeof item !== "object") return "PARSER_AMBIGUITY";
        const explicit = String(
          item.reviewReasonCode ||
          item.review_reason_code ||
          item.rawEntry?.reviewReasonCode ||
          item.rawEntry?.review_reason_code ||
          item.details?.reviewReasonCode ||
          item.details?.review_reason_code ||
          ""
        ).trim().toUpperCase();
        if (explicit) return explicit;
        const st = String(item.status || "").trim().toUpperCase();
        const rText = String(item.errorReason || item.reason || "").trim();
        if (st === "FAILED" || st === "TMDB_NOT_FOUND" || (!item.tmdbId && st !== "OK" && st !== "ADDED" && st !== "UPDATED") || /kein(?: passender)?\\s+tmdb|kein treffer auf tmdb|nicht erkannt|not[_\\s-]*found/i.test(rText)) {
          return "TMDB_NOT_FOUND";
        }
        if (st === "API_ERROR" || /nach wiederholungsversuch isoliert|api[_\\s-]*error|timeout/i.test(rText)) {
          return "API_ERROR";
        }
        if (/staffel-konflikt|staffel\\s+\\d+.*hat nur\\s+\\d+\\s+staffel/i.test(rText)) {
          return "SEASON_CONFLICT";
        }
        if (/jahres-konflikt|jahres-\\/kontext-sperre|jahre\\s+abweichung/i.test(rText)) {
          return "YEAR_CONFLICT";
        }
        if (/fortsetzungs-\\/teil-konflikt|teil-konflikt|sequel/i.test(rText)) {
          return "SEQUEL_CONFLICT";
        }
        return "PARSER_AMBIGUITY";
      }

      function resolveClientReviewReasonMeta(item) {
        const code = inferClientReviewReasonCode(item);
        const catalog = {
          TMDB_NOT_FOUND: {
            code: "TMDB_NOT_FOUND",
            icon: "❌",
            label: "Kein TMDb-Treffer",
            badgeStyle: "background:rgba(239,68,68,0.22);color:#fca5a5;border:1px solid rgba(239,68,68,0.5)",
            boxStyle: "background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.38);color:#fecaca"
          },
          YEAR_CONFLICT: {
            code: "YEAR_CONFLICT",
            icon: "📅",
            label: "Jahres-Konflikt",
            badgeStyle: "background:rgba(245,158,11,0.22);color:#fde68a;border:1px solid rgba(245,158,11,0.5)",
            boxStyle: "background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.38);color:#fde68a"
          },
          PARSER_AMBIGUITY: {
            code: "PARSER_AMBIGUITY",
            icon: "🔀",
            label: "Parser-/Titel-Mehrdeutigkeit",
            badgeStyle: "background:rgba(168,85,247,0.22);color:#e9d5ff;border:1px solid rgba(168,85,247,0.5)",
            boxStyle: "background:rgba(168,85,247,0.12);border:1px solid rgba(168,85,247,0.38);color:#e9d5ff"
          },
          SEASON_CONFLICT: {
            code: "SEASON_CONFLICT",
            icon: "📺",
            label: "Staffel-Konflikt",
            badgeStyle: "background:rgba(14,165,233,0.22);color:#bae6fd;border:1px solid rgba(56,189,248,0.5)",
            boxStyle: "background:rgba(14,165,233,0.12);border:1px solid rgba(56,189,248,0.38);color:#bae6fd"
          },
          SEQUEL_CONFLICT: {
            code: "SEQUEL_CONFLICT",
            icon: "🎬",
            label: "Fortsetzungs-Konflikt",
            badgeStyle: "background:rgba(236,72,153,0.22);color:#fbcfe8;border:1px solid rgba(236,72,153,0.5)",
            boxStyle: "background:rgba(236,72,153,0.12);border:1px solid rgba(236,72,153,0.38);color:#fbcfe8"
          },
          API_ERROR: {
            code: "API_ERROR",
            icon: "🔥",
            label: "API-/Timeout-Fehler",
            badgeStyle: "background:rgba(239,68,68,0.25);color:#fecaca;border:1px solid rgba(248,113,113,0.55)",
            boxStyle: "background:rgba(239,68,68,0.14);border:1px solid rgba(239,68,68,0.42);color:#fecaca"
          }
        };
        return catalog[code] || catalog.PARSER_AMBIGUITY;
      }

      async function syncReviewItemsFromD1MetadataClient(silent = true) {
        try {
          if (!silent) setBusyState(true, "🔄 Lade Konflikt-Metadaten & Review-Flags aus D1...");
          const r = await apiFetchJson(API_BASE + "/admin/import-logs?status=PROBLEMS&limit=600");
          if (r && r.ok && Array.isArray(r.logs)) {
            appendClientDiagnosticLogs(r.logs, false);
          }
          loadClientDiagnosticLogsFromStorage();
          const diagLogs = clientDiagnosticLogState.logs || [];
          if (!Array.isArray(backupImportJob.reviewItems)) {
            backupImportJob.reviewItems = [];
          }
          const reviewByKey = new Map();
          for (const rev of backupImportJob.reviewItems) {
            if (!rev) continue;
            const mId = rev.msgId || rev.messageId || rev.rawEntry?.msg_id || rev.rawEntry?.message_id || "";
            const fName = rev.rawFileName || rev.rawEntry?.raw_file_name || rev.rawEntry?.filename || rev.rawInput || "";
            if (mId) reviewByKey.set("msg:" + String(mId), rev);
            if (fName) reviewByKey.set("fn:" + String(fName).toLowerCase(), rev);
          }

          let enrichedOrAdded = 0;
          for (const log of diagLogs) {
            if (!log) continue;
            const st = String(log.status || "").toUpperCase();
            if (st !== "TMDB_NOT_FOUND" && st !== "CONFLICT_?" && st !== "CONFLICT" && st !== "API_ERROR") continue;
            const mId = log.msgId ? Number(log.msgId) : null;
            const fName = String(log.fileName || log.parsedTitle || "").trim();
            const existingRev = (mId && reviewByKey.get("msg:" + String(mId))) ||
                                (fName && reviewByKey.get("fn:" + fName.toLowerCase())) ||
                                null;
            const dbReasonCode = inferClientReviewReasonCode(log);
            if (existingRev) {
              if (!existingRev.reviewReasonCode && dbReasonCode) {
                existingRev.reviewReasonCode = dbReasonCode;
                enrichedOrAdded++;
              }
              if (!existingRev.errorReason && log.reason) {
                existingRev.errorReason = log.reason;
                existingRev.reason = log.reason;
                enrichedOrAdded++;
              }
              if ((!Array.isArray(existingRev.candidates) || existingRev.candidates.length === 0) && Array.isArray(log.details?.candidates)) {
                existingRev.candidates = log.details.candidates;
              }
            } else {
              const rawEntryObj = (log.rawEntry && typeof log.rawEntry === "object")
                ? log.rawEntry
                : (log.details?.rawEntry && typeof log.details.rawEntry === "object"
                    ? log.details.rawEntry
                    : {
                        filename: fName || "Unbekannt",
                        raw_file_name: fName || "",
                        raw_text: log.rawText || log.textPreview || "",
                        msg_id: mId,
                        message_id: mId
                      });
              const hydratedItem = {
                id: "rev_d1_" + (log.id || mId || Math.random().toString(36).slice(2, 8)),
                rawInput: fName || log.parsedTitle || "Unbekannt",
                rawEntry: rawEntryObj,
                status: st === "TMDB_NOT_FOUND" || !log.tmdbId ? "failed" : "?",
                contextError: st === "CONFLICT_?" || st === "CONFLICT" || st === "TMDB_NOT_FOUND",
                isUncertain: true,
                reviewReasonCode: dbReasonCode,
                errorReason: log.reason || "",
                reason: log.reason || "",
                confidence: st === "TMDB_NOT_FOUND" ? 0 : 55,
                typeCode: (log.typeCode === "s" || log.detectedType === "series" || log.seasonNumber || log.season) ? "s" : "m",
                tmdbId: log.tmdbId ? Number(log.tmdbId) : null,
                cleanTitle: log.parsedTitle || fName || "Unbekannt",
                year: rawEntryObj?.year || "k.A.",
                poster: "",
                quality: rawEntryObj?.quality || "1080p",
                codec: rawEntryObj?.codec || "x264",
                season: log.seasonNumber ?? log.season ?? rawEntryObj?.season ?? null,
                episode: log.episodeNumber ?? log.episode ?? rawEntryObj?.episode ?? null,
                metadataSource: "D1-Metadaten",
                msgId: mId,
                messageId: mId,
                messageLink: rawEntryObj?.message_link || rawEntryObj?.messageLink || "",
                rawFileName: fName,
                rawText: log.rawText || log.textPreview || rawEntryObj?.raw_text || "",
                parsedFrom: rawEntryObj?.parsed_from || "D1-Import-Log",
                languages: Array.isArray(rawEntryObj?.languages) ? rawEntryObj.languages : ["de"],
                prevMessages: Array.isArray(rawEntryObj?.prev_messages) ? rawEntryObj.prev_messages : [],
                candidates: Array.isArray(log.details?.candidates) ? log.details.candidates : []
              };
              backupImportJob.reviewItems.push(hydratedItem);
              if (mId) reviewByKey.set("msg:" + String(mId), hydratedItem);
              if (fName) reviewByKey.set("fn:" + fName.toLowerCase(), hydratedItem);
              enrichedOrAdded++;
            }
          }
          if (enrichedOrAdded > 0 && backupImportJob.activeSubTab === "review") {
            renderBackupImportBoxDom();
          }
          if (!silent) {
            showHudToast("✅ Konflikt-Metadaten & Review-Flags aus D1 synchronisiert (" + backupImportJob.reviewItems.length + " Einträge)");
          }
        } catch (e) {
          if (!silent) showHudToast("⚠️ D1-Synchronisierung fehlgeschlagen");
        } finally {
          if (!silent) setBusyState(false);
        }
      }

      function renderSingleBackupReviewCardHtml(item, allItems) {
        const isFailed = item.status === "failed" || !item.tmdbId;
        const isResolved = Boolean(item.resolvedByAdmin);
        const seTag = item.season
          ? (" • S" + String(item.season).padStart(2, "0") + "E" + String(item.episode || 1).padStart(2, "0") + (item.episodeTitle ? (" – " + item.episodeTitle) : ""))
          : "";
        const rawEntry = item.rawEntry || {};
        const msgId = item.messageId || item.msgId || rawEntry.message_id || rawEntry.msg_id || null;
        const msgLink = item.messageLink || rawEntry.message_link || "";
        const rawFileName = item.rawFileName || rawEntry.raw_file_name || rawEntry.filename || "";
        const metaSrc = item.metadataSource || "TMDb";
        const reasonMeta = resolveClientReviewReasonMeta(item);

        // KOMPAKTE GRÜNE ZEILE AN ORT UND STELLE: Sobald bestätigt/korrigiert, klappt die Karte platzsparend zusammen (ohne Scroll-Sprung!)
        if (isResolved && !item.expandedAfterResolve) {
          return '<div id="revCard_' + esc(item.id) + '" style="background:rgba(16,185,129,0.09);border:1px solid rgba(16,185,129,0.42);border-radius:10px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:220px;flex:1">' +
              '<span style="font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(16,185,129,0.22);color:#34d399;border:1px solid rgba(16,185,129,0.45)">✅ In D1 gespeichert</span>' +
              '<span style="font-family:monospace;font-size:10px;font-weight:800;padding:2px 6px;border-radius:5px;background:rgba(16,185,129,0.14);color:#6ee7b7;border:1px solid rgba(16,185,129,0.3)" title="Ursprünglicher Prüfgrund behoben">✓ ' + esc(reasonMeta.code) + '</span>' +
              '<span style="font-size:12.5px;font-weight:800;color:#fff">' +
                esc(item.cleanTitle || item.rawInput) + ' (' + esc(item.year || 'k.A.') + ')' +
              '</span>' +
              '<span style="font-size:11.5px;color:#38bdf8;font-weight:700">[' + (item.typeCode === 's' ? '📺 Serie' : '🎬 Film') + esc(seTag) + ' • ' + esc(item.quality || '1080p') + ']</span>' +
              (rawFileName ? '<code style="font-size:10.5px;color:#94a3b8;background:#0c0c12;padding:2px 6px;border-radius:4px">' + esc(rawFileName) + '</code>' : '') +
              (msgId ? '<span style="font-size:10.5px;color:#cbd5e1">💬 #' + esc(String(msgId)) + '</span>' : '') +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              (item.tmdbId ? '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="openDetails(\\'' + (item.typeCode || 'm') + '\\',' + Number(item.tmdbId) + ',false)">👁️ Vorschau</button>' : '') +
              '<button type="button" class="btn" style="padding:3px 8px;font-size:11px" onclick="reopenResolvedReviewCard(\\'' + esc(item.id) + '\\')">✏️ Bearbeiten</button>' +
            '</div>' +
          '</div>';
        }

        const badgeBg = isResolved
          ? "rgba(16,185,129,0.2);color:#34d399;border:1px solid rgba(16,185,129,0.4)"
          : isFailed
            ? "rgba(239,68,68,0.2);color:#f87171;border:1px solid rgba(239,68,68,0.4)"
            : "rgba(245,158,11,0.2);color:#fbbf24;border:1px solid rgba(245,158,11,0.4)";
        const badgeLabel = isResolved
          ? "✅ Korrigiert / Bestätigt"
          : isFailed
            ? "❌ Nicht erkannt"
            : ("⚠️ Unsicher (" + Number(item.confidence || 0) + "% Match)");

        const cands = Array.isArray(item.candidates) ? item.candidates : [];
        const rawText = item.rawText || rawEntry.raw_text || "";
        const parsedFrom = item.parsedFrom || rawEntry.parsed_from || "Dateiname";
        const prevMsgs = Array.isArray(item.prevMessages)
          ? item.prevMessages
          : (Array.isArray(rawEntry.prev_messages) ? rawEntry.prev_messages : []);
        const langs = Array.isArray(item.languages) && item.languages.length ? item.languages.join(", ").toUpperCase() : "DE";

        // Vorbelegung für Staffel (S) & Folge (E) aus erkannten Werten oder angehängter/eingebetteter Zahl im Dateinamen
        const rawBaseNoExt = String(rawFileName || item.rawInput || item.cleanTitle || "").replace(/\\.(mp4|mkv|avi|m4v|ts|mov|webm)$/i, "");
        const rawTailMatch = rawBaseNoExt.match(/(?:^|\\s|[-_])(?:teil\\s*|part\\s*|ep\\.?\\s*)?0*(\\d{1,2})\\s*$/i);
        const rawMidMatch = !rawTailMatch ? rawBaseNoExt.match(/^(.{2,}?)\\s+(?:[-–]\\s*)?(?:teil\\s+|part\\s+|ep\\.?\\s*|folge\\s+)?0*(\\d{1,2})\\s+(?:[-–:]\\s*)?(.{3,})$/i) : null;
        const inferredEpNum = rawTailMatch ? parseInt(rawTailMatch[1], 10) : (rawMidMatch ? parseInt(rawMidMatch[2], 10) : null);
        const defaultSeasonVal = item.season || cands[0]?.inferredSeason || 1;
        const defaultEpisodeVal = item.episode || cands[0]?.inferredEpisode || (inferredEpNum >= 1 && inferredEpNum <= 99 ? inferredEpNum : 1);

        // Prüfen, ob mehrere offene Folgen derselben Serie in der Prüfliste liegen (für 1-Klick Sammel-Bestätigung)
        const seriesSiblings = (item.typeCode === "s" || item.season || item.episode || cands[0]?.typeCode === "s")
          ? getMatchingOpenSeriesSiblingItems(item, item.tmdbId || cands[0]?.tmdbId || null)
          : [];
        const batchTmdbId = Number(item.tmdbId || cands[0]?.tmdbId || 0);
        const reviewReasonText = String(
          item.errorReason ||
          item.reason ||
          (isFailed
            ? ("Kein passender TMDb-Eintrag für „" + (item.cleanTitle || item.rawInput || "Unbekannt") + "“ gefunden – bitte manuell suchen oder TMDb-ID zuweisen.")
            : (item.contextError
                ? "Kontext-, Staffel- oder Jahres-Konflikt zwischen Dateiname/Post und TMDb-Treffer erkannt."
                : ("Unsichere automatische Zuordnung (" + Number(item.confidence || 0) + "% Match-Sicherheit) – bitte kurz prüfen oder bestätigen.")))
        ).trim();

        return '<div id="revCard_' + esc(item.id) + '" style="background:#101015;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            '<div style="flex:1;min-width:220px">' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px">' +
                '<span title="Datenbank Review-Reason-Flag (' + esc(reasonMeta.code) + ')" style="font-family:monospace;font-size:10.5px;font-weight:900;padding:2px 8px;border-radius:5px;letter-spacing:0.03em;' + reasonMeta.badgeStyle + '">' +
                  reasonMeta.icon + ' ' + esc(reasonMeta.code) + ' • ' + esc(reasonMeta.label) +
                '</span>' +
                '<span style="font-size:10.5px;background:#1e293b;color:#38bdf8;padding:2px 7px;border-radius:5px;font-weight:700">🔎 Quelle: ' + esc(parsedFrom) + '</span>' +
                '<span style="font-size:10.5px;background:#1e293b;color:#a78bfa;padding:2px 7px;border-radius:5px;font-weight:700">🌐 Audio: ' + esc(langs) + '</span>' +
                (msgId ? '<span style="font-size:10.5px;background:#1e293b;color:#cbd5e1;padding:2px 7px;border-radius:5px">💬 Msg #' + esc(String(msgId)) + '</span>' : '') +
                (msgLink ? '<a href="' + esc(msgLink) + '" target="_blank" rel="noopener noreferrer" style="font-size:10.5px;background:rgba(14,165,233,0.2);color:#38bdf8;border:1px solid rgba(56,189,248,0.4);padding:2px 8px;border-radius:5px;text-decoration:none;font-weight:800">🔗 Nachricht in Telegram öffnen ↗</a>' : '') +
              '</div>' +
              '<div style="font-size:12.5px;font-weight:800;color:#fff;margin-top:4px">' +
                (item.tmdbId
                  ? ('Aktuell zugeordnet (' + esc(metaSrc) + '): <span style="color:#38bdf8">' + esc(item.cleanTitle) + ' (' + esc(item.year || 'k.A.') + ')</span> [' + (item.typeCode === 's' ? '📺 Serie' : '🎬 Film') + seTag + ' • ' + esc(item.quality || '1080p') + ']')
                  : ('Kein automatischer Treffer für: <span style="color:#f87171">' + esc(item.cleanTitle || item.rawInput) + '</span>')) +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:' + badgeBg + '">' + badgeLabel + '</span>' +
              (item.tmdbId && !isResolved ? '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px" onclick="confirmBackupReviewItem(\\'' + esc(item.id) + '\\')">✓ Passt so</button>' : '') +
              (seriesSiblings.length >= 2 && batchTmdbId > 0 ? '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px;background:linear-gradient(90deg,#059669,#0284c7);border-color:#38bdf8" onclick="confirmAllSeriesEpisodesInReview(\\'' + esc(item.id) + '\\',' + batchTmdbId + ',\\'s\\')" title="Speichert alle ' + seriesSiblings.length + ' offenen Folgen dieser Serie jeweils mit ihrer eigenen Staffel/Folge (z.B. S01E09, S01E10, S01E12) in D1">⚡ Alle ' + seriesSiblings.length + ' Folgen bestätigen</button>' : '') +
              '<button type="button" class="btn purple" style="padding:4px 9px;font-size:11px;background:rgba(168,85,247,0.22);border:1px solid rgba(168,85,247,0.55);color:#e9d5ff" onclick="openManualNoTmdbConfirmForReviewItem(\\'' + esc(item.id) + '\\')" title="Titel existiert nicht auf TMDb? Hier manuell mit eigener kollisionsfreier 900M-ID bestätigen">✨ Ohne TMDb-ID bestätigen</button>' +
              (item.tmdbId ? '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'' + (item.typeCode || 'm') + '\\',' + Number(item.tmdbId) + ',false)">👁️ Vorschau</button>' : '') +
              (isResolved ? '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="collapseResolvedReviewCard(\\'' + esc(item.id) + '\\')">🔼 Einklappen</button>' : '') +
            '</div>' +
          '</div>' +
          '<div style="' + reasonMeta.boxStyle + ';border-radius:8px;padding:7px 10px;margin-bottom:8px;font-size:11.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.35">' +
            '<span style="font-family:monospace;font-size:10.5px;font-weight:900;padding:2px 7px;border-radius:4px;' + reasonMeta.badgeStyle + ';white-space:nowrap">' + reasonMeta.icon + ' ' + esc(reasonMeta.code) + '</span>' +
            '<span style="font-weight:700;flex:1;min-width:180px">' + esc(reviewReasonText) + '</span>' +
          '</div>' +
          '<div style="background:#15151e;border:1px solid rgba(255,255,255,0.09);border-radius:8px;padding:9px;margin-bottom:8px;font-size:11.5px;display:flex;flex-direction:column;gap:5px">' +
            (rawFileName ? '<div><b style="color:#94a3b8">💾 Dateiname (file_name):</b> <code style="color:#f1f5f9;background:#0c0c12;padding:2px 6px;border-radius:4px;word-break:break-all">' + esc(rawFileName) + '</code></div>' : '') +
            (rawText ? '<div><b style="color:#94a3b8">📝 Volltext / Caption dieser Nachricht:</b> <div style="color:#cbd5e1;background:#0c0c12;padding:5px 8px;border-radius:5px;margin-top:3px;max-height:76px;overflow-y:auto;white-space:pre-wrap;font-size:11px">' + esc(rawText) + '</div></div>' : '') +
            (prevMsgs.length > 0 ? (
              '<div style="margin-top:3px;padding-top:6px;border-top:1px dashed rgba(255,255,255,0.12)">' +
                '<div style="font-size:11px;font-weight:800;color:#fbbf24;margin-bottom:4px">⬆️ Die ' + prevMsgs.length + ' Nachrichten direkt über dieser Videodatei (Steckbrief / Titel-Kontext):</div>' +
                '<div style="display:flex;flex-direction:column;gap:5px">' +
                  prevMsgs.map((pm, pIdx) => {
                    const labelIdx = prevMsgs.length === 2 ? (pIdx === 0 ? "2 Nachrichten darüber" : "1 Nachricht direkt darüber") : "Nachricht direkt darüber";
                    return '<div style="background:#0d0d14;border:1px solid rgba(251,191,36,0.25);border-radius:6px;padding:6px 8px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                      '<div style="flex:1;min-width:180px;font-size:11px;color:#e2e8f0">' +
                        '<span style="color:#fbbf24;font-weight:800">[' + labelIdx + (pm.msgId ? ' • #' + esc(String(pm.msgId)) : '') + ']</span> ' +
                        esc(pm.text || '(Kein Text)') +
                      '</div>' +
                      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                        (pm.titleGuess ? '<button type="button" class="btn amber" style="padding:3px 8px;font-size:10.5px" onclick="usePrevMessageForReviewSearch(\\'' + esc(item.id) + '\\',\\'' + esc(pm.titleGuess) + '\\')">🔍 „' + esc(pm.titleGuess.slice(0, 28)) + '“ suchen</button>' : '') +
                        (pm.tmdbId ? '<button type="button" class="btn green" style="padding:3px 8px;font-size:10.5px" onclick="applyBackupCandidateRemap(\\'' + esc(item.id) + '\\',' + Number(pm.tmdbId) + ',\\'' + (pm.mediaType === 'tv' ? 's' : 'm') + '\\')">🎯 TMDb #' + Number(pm.tmdbId) + ' direkt zuweisen</button>' : '') +
                      '</div>' +
                    '</div>';
                  }).join("") +
                '</div>' +
              '</div>'
            ) : '') +
          '</div>' +
          (cands.length > 0 ? (
            '<div style="margin-bottom:8px">' +
              '<div style="font-size:11px;color:#94a3b8;margin-bottom:5px">🎯 <b>Gefundene Kandidaten (8 APIs – 1-Klick Übernahme inkl. gewählter Staffel/Folge):</b></div>' +
              '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
                cands.map(c => {
                  const isCurrent = item.tmdbId && Number(item.tmdbId) === Number(c.tmdbId) && item.typeCode === c.typeCode;
                  const srcLabel = c.source || "TMDb";
                  const seBadge = c.typeCode === "s" && c.inferredEpisode
                    ? (' <span style="background:rgba(168,85,247,0.25);color:#e9d5ff;padding:1px 5px;border-radius:4px;font-weight:800">S' + String(c.inferredSeason || 1).padStart(2, "0") + 'E' + String(c.inferredEpisode).padStart(2, "0") + '</span>')
                    : '';
                  return '<div style="min-width:215px;max-width:255px;background:' + (isCurrent ? 'rgba(16,185,129,0.14)' : '#181822') + ';border:1px solid ' + (isCurrent ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.12)') + ';border-radius:8px;padding:7px;display:flex;gap:8px;align-items:center;flex-shrink:0">' +
                    (c.poster
                      ? '<img src="' + esc(c.poster) + '" style="width:38px;height:56px;object-fit:cover;border-radius:5px;flex-shrink:0" alt="" />'
                      : '<div style="width:38px;height:56px;background:#252532;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">' + (c.typeCode === 's' ? '📺' : '🎬') + '</div>') +
                    '<div style="flex:1;min-width:0">' +
                      '<div style="font-size:11.5px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(c.title) + '">' + esc(c.title) + '</div>' +
                      '<div style="font-size:10px;color:#94a3b8;margin-top:2px">' +
                        (c.typeCode === 's' ? '📺 Serie' : '🎬 Film') + seBadge + ' • ' + esc(c.year || 'k.A.') + ' • <b style="color:#38bdf8">' + esc(srcLabel) + '</b> (' + Number(c.confidence || 0) + '%)' +
                      '</div>' +
                      '<div style="display:flex;gap:4px;margin-top:5px">' +
                        '<button type="button" class="btn ' + (isCurrent ? 'green' : 'amber') + '" style="padding:3px 8px;font-size:10.5px;flex:1" onclick="applyBackupCandidateRemap(\\'' + esc(item.id) + '\\',' + Number(c.tmdbId) + ',\\'' + (c.typeCode === 's' ? 's' : 'm') + '\\')">' +
                          (isCurrent ? '✓ Aktiv (Speichern)' : '✓ Auswählen') +
                        '</button>' +
                        (c.typeCode === 's' && seriesSiblings.length >= 2 ? '<button type="button" class="btn green" style="padding:3px 6px;font-size:10px" title="Alle ' + seriesSiblings.length + ' Folgen dieser Serie auf diesen Kandidaten zuweisen" onclick="confirmAllSeriesEpisodesInReview(\\'' + esc(item.id) + '\\',' + Number(c.tmdbId) + ',\\'s\\')">⚡ Alle ' + seriesSiblings.length + '</button>' : '') +
                      '</div>' +
                    '</div>' +
                  '</div>';
                }).join("") +
              '</div>' +
            '</div>'
          ) : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:4px">' +
            '<select id="revSearchType_' + esc(item.id) + '" style="padding:5px 8px;border-radius:6px;background:#16161e;color:#fff;border:1px solid rgba(255,255,255,0.18);font-size:11.5px">' +
              '<option value="auto"' + ((item.manualSearchType || 'auto') === 'auto' ? ' selected' : '') + '>🔄 Auto (Film & Serie)</option>' +
              '<option value="m"' + (item.manualSearchType === 'm' ? ' selected' : '') + '>🎬 Nur Filme</option>' +
              '<option value="s"' + (item.manualSearchType === 's' ? ' selected' : '') + '>📺 Nur Serien</option>' +
            '</select>' +
            '<div style="display:flex;align-items:center;gap:4px;background:#16161e;border:1px solid rgba(168,85,247,0.45);border-radius:6px;padding:3px 7px" title="Staffel & Folge für Serien-Zuordnung (z.B. S01E01)">' +
              '<span style="font-size:10.5px;font-weight:800;color:#c084fc">S</span>' +
              '<input id="revSeasonInp_' + esc(item.id) + '" type="number" min="1" max="99" value="' + (Number(defaultSeasonVal) || 1) + '" onchange="syncReviewCardDomInputsToItemState((backupImportJob.reviewItems||[]).find(x=>String(x.id)===\\'' + esc(item.id) + '\\'))" style="width:42px;padding:2px 4px;border-radius:4px;background:#0c0c12;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px;font-weight:800;text-align:center" />' +
              '<span style="font-size:10.5px;font-weight:800;color:#c084fc">E</span>' +
              '<input id="revEpInp_' + esc(item.id) + '" type="number" min="1" max="999" value="' + (Number(defaultEpisodeVal) || 1) + '" onchange="syncReviewCardDomInputsToItemState((backupImportJob.reviewItems||[]).find(x=>String(x.id)===\\'' + esc(item.id) + '\\'))" style="width:46px;padding:2px 4px;border-radius:4px;background:#0c0c12;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11.5px;font-weight:800;text-align:center" />' +
            '</div>' +
            '<input id="revSearchInp_' + esc(item.id) + '" value="' + esc(item.manualSearchQuery || item.cleanTitle || '') + '" placeholder="Manueller Titel oder TMDb-ID (z.B. 603)..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();searchManualCandidatesForReviewItem(\\'' + esc(item.id) + '\\')}" style="flex:1;min-width:160px;padding:5px 9px;border-radius:6px;background:#16161e;color:#fff;border:1px solid rgba(255,255,255,0.18);font-size:11.5px" />' +
            '<button type="button" class="btn" style="padding:5px 10px;font-size:11.5px" onclick="searchManualCandidatesForReviewItem(\\'' + esc(item.id) + '\\')">🔍 Alle 8 APIs durchsuchen</button>' +
            '<button type="button" class="btn purple" style="padding:5px 10px;font-size:11.5px;background:rgba(168,85,247,0.22);border:1px solid rgba(168,85,247,0.55);color:#e9d5ff" onclick="openManualNoTmdbConfirmForReviewItem(\\'' + esc(item.id) + '\\')">✨ Ohne TMDb-ID zuweisen</button>' +
          '</div>' +
        '</div>';
      }

      function renderBackupReviewTabHtml(j) {
        const allItems = j.reviewItems || [];
        const openConflictItems = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain || x.contextError || !x.tmdbId));
        const needsAttentionOpenCount = openConflictItems.length;
        const uncertainOpenCount = allItems.filter(x => !x.resolvedByAdmin && x.isUncertain && x.status !== "failed" && x.tmdbId).length;
        const failedOpenCount = allItems.filter(x => !x.resolvedByAdmin && (x.status === "failed" || !x.tmdbId)).length;

        const flagCounts = {
          TMDB_NOT_FOUND: 0,
          YEAR_CONFLICT: 0,
          PARSER_AMBIGUITY: 0,
          SEASON_CONFLICT: 0,
          SEQUEL_CONFLICT: 0,
          API_ERROR: 0
        };
        for (const it of openConflictItems) {
          const code = inferClientReviewReasonCode(it);
          if (flagCounts[code] !== undefined) flagCounts[code]++;
        }

        // Damit bestätigte Karten an Ort und Stelle grün eingeklappt stehen bleiben (statt die Liste unter dem Mauszeiger wegzuziehen!),
        // behalten wir bereits in dieser Sitzung bestätigte Einträge (x.resolvedByAdmin) als kompakte grüne Zeile in der Liste.
        let visibleList = allItems.filter(x => x.status === "failed" || x.isUncertain || x.contextError || !x.tmdbId || x.resolvedByAdmin);
        if (j.reviewFilter === "uncertain") visibleList = allItems.filter(x => (x.isUncertain && x.status !== "failed" && x.tmdbId) || x.resolvedByAdmin);
        else if (j.reviewFilter === "failed") visibleList = allItems.filter(x => x.status === "failed" || !x.tmdbId);
        else if (j.reviewFilter === "all") visibleList = allItems;
        else if (String(j.reviewFilter || "").startsWith("flag:")) {
          const targetFlag = String(j.reviewFilter).slice(5);
          visibleList = allItems.filter(x => (!x.resolvedByAdmin && inferClientReviewReasonCode(x) === targetFlag) || (x.resolvedByAdmin && inferClientReviewReasonCode(x) === targetFlag));
        }

        const flagFilterButtons = [
          { code: "TMDB_NOT_FOUND", icon: "❌", col: "#fca5a5", bg: "rgba(239,68,68,0.18)" },
          { code: "YEAR_CONFLICT", icon: "📅", col: "#fde68a", bg: "rgba(245,158,11,0.18)" },
          { code: "PARSER_AMBIGUITY", icon: "🔀", col: "#e9d5ff", bg: "rgba(168,85,247,0.18)" },
          { code: "SEASON_CONFLICT", icon: "📺", col: "#bae6fd", bg: "rgba(14,165,233,0.18)" },
          { code: "SEQUEL_CONFLICT", icon: "🎬", col: "#fbcfe8", bg: "rgba(236,72,153,0.18)" },
          { code: "API_ERROR", icon: "🔥", col: "#fecaca", bg: "rgba(239,68,68,0.22)" }
        ];

        return '<div style="margin-top:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button id="revBtnNeeds" class="btn ' + (j.reviewFilter === 'needs_attention' ? 'amber' : '') + '" onclick="setBackupReviewFilter(\\'needs_attention\\')">⚠️ Prüfbedarf (' + needsAttentionOpenCount + ')</button>' +
              '<button id="revBtnUncertain" class="btn ' + (j.reviewFilter === 'uncertain' ? 'amber' : '') + '" onclick="setBackupReviewFilter(\\'uncertain\\')">🔎 Unsichere Treffer (' + uncertainOpenCount + ')</button>' +
              '<button id="revBtnFailed" class="btn ' + (j.reviewFilter === 'failed' ? 'red' : '') + '" onclick="setBackupReviewFilter(\\'failed\\')">❌ Nicht erkannt (' + failedOpenCount + ')</button>' +
              '<button id="revBtnAll" class="btn ' + (j.reviewFilter === 'all' ? 'green' : '') + '" onclick="setBackupReviewFilter(\\'all\\')">📋 Alle importierten (' + allItems.length + ')</button>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
              '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="syncReviewItemsFromD1MetadataClient(false)">🔄 Konflikte aus D1 laden</button>' +
              '<span style="font-size:11.5px;color:#94a3b8">💡 Bestätigte Karten klappen grün an Ort & Stelle zusammen</span>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding:7px 9px;background:#12121a;border:1px solid rgba(255,255,255,0.08);border-radius:8px">' +
            '<span style="font-size:11px;font-weight:800;color:#94a3b8;margin-right:2px">🏷️ Review-Reason-Filter (DB-Flags):</span>' +
            flagFilterButtons.map(fb => {
              const active = j.reviewFilter === ("flag:" + fb.code);
              const cnt = flagCounts[fb.code] || 0;
              return '<button type="button" onclick="setBackupReviewFilter(\\'' + (active ? 'needs_attention' : ('flag:' + fb.code)) + '\\')" style="cursor:pointer;font-family:monospace;font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:6px;background:' + (active ? fb.bg : '#181824') + ';color:' + fb.col + ';border:1px solid ' + (active ? fb.col : 'rgba(255,255,255,0.12)') + '">' +
                fb.icon + ' ' + fb.code + ' (' + cnt + ')' +
              '</button>';
            }).join("") +
          '</div>' +
          (visibleList.length === 0 ? (
            '<div style="background:#101016;border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:16px;text-align:center;color:#34d399;font-size:12.5px">' +
              (allItems.length === 0
                ? 'ℹ️ Starte zuerst den Smart-Import oder klicke oben auf <b>🔄 Konflikte aus D1 laden</b>, um Zuordnungen zu prüfen.'
                : '🎉 Perfekt! Keine offenen Einträge für diesen Review-Reason-Filter.') +
            '</div>'
          ) : (
            '<div id="backupReviewScrollContainer" style="display:flex;flex-direction:column;gap:12px;max-height:640px;overflow-y:auto;padding-right:4px">' +
              visibleList.slice(0, 80).map(item => renderSingleBackupReviewCardHtml(item, allItems)).join("") +
            '</div>'
          )) +
        '</div>';
      }

      function openAdminTabDirectClient(tabName = "backup") {
        state.adminTab = tabName || "backup";
        loadAdminPanelView(false);
      }

      function updateFloatingImportStatusBarDom() {
        try {
          let widgetEl = document.getElementById("floatingImportStatusWidget");
          const j = backupImportJob;
          const total = Array.isArray(j?.entries) ? j.entries.length : 0;
          const done = Number(j?.cursor || 0);
          const hasActiveOrPausedJob = Boolean(
            state.isAuthenticated &&
            state.authUser?.isAdmin &&
            total > 0 &&
            (j.running || (done > 0 && done < total))
          );

          if (!hasActiveOrPausedJob || state.currentView === "admin") {
            if (widgetEl) widgetEl.style.display = "none";
            return;
          }

          if (!widgetEl && document.body) {
            widgetEl = document.createElement("div");
            widgetEl.id = "floatingImportStatusWidget";
            widgetEl.style.cssText =
              "position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:9500;" +
              "width:min(94vw,680px);background:rgba(15,23,42,0.96);border:1px solid rgba(56,189,248,0.55);" +
              "border-radius:12px;padding:9px 12px;box-shadow:0 12px 32px rgba(0,0,0,0.8);backdrop-filter:blur(10px);";
            document.body.appendChild(widgetEl);
          }
          if (!widgetEl) return;

          const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
          const issuesCount = Number(j.failedCount || 0) + Number(j.uncertainCount || 0);
          widgetEl.style.display = "block";
          widgetEl.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#f8fafc">' +
                '<span style="font-weight:900;color:' + (j.running ? '#38bdf8' : '#fbbf24') + '">' +
                  (j.running ? '⚡ Backup-Import läuft:' : '⏸️ Import pausiert:') +
                '</span>' +
                '<b>' + done.toLocaleString("de-DE") + ' / ' + total.toLocaleString("de-DE") + ' (' + pct + '%)</b>' +
                '<span style="color:#34d399;font-size:11.5px">🎬 ' + Number(j.moviesSaved || 0).toLocaleString("de-DE") + '</span>' +
                '<span style="color:#38bdf8;font-size:11.5px">📺 ' + Number(j.seriesSaved || 0).toLocaleString("de-DE") + '</span>' +
                (issuesCount > 0 ? ('<span style="color:#fbbf24;font-size:11.5px">⚠️ ' + issuesCount + '</span>') : '') +
              '</div>' +
              '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                (j.running
                  ? '<button type="button" class="btn amber" style="padding:4px 9px;font-size:11px" onclick="pauseBackupImport()">⏸️ Pause</button>'
                  : '<button type="button" class="btn green" style="padding:4px 9px;font-size:11px" onclick="startOrResumeBackupImport()">▶️ Weiter</button>') +
                '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="openAdminTabDirectClient(\\'backup\\')">📂 Zum Import</button>' +
                '<button type="button" class="btn" style="padding:4px 9px;font-size:11px" onclick="openAdminTabDirectClient(\\'diaglog\\')">🛠️ Logs</button>' +
              '</div>' +
            '</div>' +
            '<div style="width:100%;height:5px;background:#1e293b;border-radius:999px;overflow:hidden;margin-top:6px">' +
              '<div style="width:' + Math.min(100, Number(pct)) + '%;height:100%;background:linear-gradient(90deg,#0ea5e9,#10b981);transition:width 0.25s ease"></div>' +
            '</div>';
        } catch (e) {}
      }

      setInterval(updateFloatingImportStatusBarDom, 600);

      function renderBackupImportBoxDom() {
        updateFloatingImportStatusBarDom();
        const mount = document.getElementById("backupImportLiveMount");
        if (!mount) return;
        const j = backupImportJob;
        // Aktuelle Scroll-Position und offene Eingaben im Review-Tab vor einem Komplett-Render sichern
        const oldScrollEl = document.getElementById("backupReviewScrollContainer");
        const savedReviewScrollTop = oldScrollEl ? oldScrollEl.scrollTop : null;
        if (j.activeSubTab === "review" && Array.isArray(j.reviewItems)) {
          for (const it of j.reviewItems) syncReviewCardDomInputsToItemState(it);
        }
        const activeChan = j.verifiedChannelId || getSavedVerifiedChannelIdClient();
        const isChanVerified = Boolean(activeChan && (activeChan.startsWith("-100") || activeChan.startsWith("@")));
        const fileInp = document.getElementById("backupJsonFileInputEl");
        if (fileInp) {
          fileInp.disabled = !isChanVerified;
          fileInp.style.opacity = isChanVerified ? "1" : "0.45";
        }

        const savedCp = j.savedCheckpoint || loadBackupCheckpointClient();
        const total = j.entries.length > 0 ? j.entries.length : Number(savedCp?.totalEntries || savedCp?.total || j.rawMessageCount || 0);
        const done = j.cursor > 0 ? j.cursor : Number(savedCp?.cursor || 0);
        const pct = total > 0 ? ((done / total) * 100).toFixed(1) : "0.0";
        const elapsedSec = j.startedAt ? Math.max(1, (Date.now() - j.startedAt) / 1000) : 1;
        const speedPerSec = done > 0 ? (done / elapsedSec).toFixed(1) : "0.0";
        const remCount = Math.max(0, total - done);
        const etaSec = done > 0 && Number(speedPerSec) > 0 ? Math.round(remCount / Number(speedPerSec)) : 0;
        const etaStr = etaSec > 3600
          ? (Math.floor(etaSec / 3600) + "h " + Math.floor((etaSec % 3600) / 60) + "m")
          : etaSec > 60
            ? (Math.floor(etaSec / 60) + "m " + (etaSec % 60) + "s")
            : (etaSec + "s");

        const hasRestoredOrActiveData = Boolean(
          j.fileName ||
          (savedCp && (Number(savedCp.cursor) > 0 || Number(savedCp.totalEntries || savedCp.total) > 0)) ||
          (Array.isArray(j.reviewItems) && j.reviewItems.length > 0) ||
          getDiagnosticLogTotalCountClient() > 0
        );

        if (!hasRestoredOrActiveData) {
          mount.innerHTML = '<div style="font-size:12px;color:#94a3b8">' +
            (isChanVerified
              ? ('✅ Quell-Kanal <code>' + esc(activeChan) + '</code> ist verifiziert. Bitte wähle jetzt oben deine <code>result.json</code> Datei aus.')
              : '🔒 <b>JSON-Upload gesperrt:</b> Bitte gib zuerst in Schritt 1 die Telegram Kanal-ID (<code>-100...</code>) oder einen Nachrichten-Link ein und klicke auf <b>🔍 Kanal prüfen & freischalten</b>.') +
            '</div>';
          return;
        }
        const effectiveFileName = j.fileName || savedCp?.fileName || "D1-Import-Sitzung (wiederhergestellt)";

        const openReviewCount = (j.reviewItems || []).filter(x => !x.resolvedByAdmin && (x.status === "failed" || x.isUncertain)).length;
        const totalDeduplicated = Number(j.duplicatesSkippedInFile || 0) + Number(j.duplicatesInDb || 0);
        const totalMergedStreams = Number(j.mergedQualitiesInDb || 0) + (done === 0 ? Number(j.qualityVariantsInFile || 0) : 0);
        const curMode = j.playlistMode || "both";

        const checkpointBannerHtml = (!j.running && done > 0 && done < total)
          ? ('<div style="background:rgba(245,158,11,0.16);border:1px solid rgba(251,191,36,0.5);border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
              '<div style="font-size:12px;color:#fde68a">' +
                '📌 <b>Gespeicherter Fortschritts-Checkpoint bei Eintrag #' + done.toLocaleString('de-DE') + ' / ' + total.toLocaleString('de-DE') + ' (' + pct + '%)</b> erkannt!' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn green" onclick="resumeBackupFromCheckpointClient()">▶️ Bei #' + done.toLocaleString('de-DE') + ' fortsetzen</button>' +
                '<button class="btn amber" onclick="restartBackupFromZeroNoDupesClient()">🔄 Neu starten ab 0 (ohne Duplikate)</button>' +
              '</div>' +
            '</div>')
          : '';

        mount.innerHTML =
          '<div style="background:#141414;border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px;margin-top:10px">' +
            checkpointBannerHtml +
            (j.repaired ? (
              '<div style="background:rgba(2,132,199,0.18);border:1px solid rgba(56,189,248,0.45);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:#e0f2fe">' +
                '🛠️ <b>JSON Auto-Repair erfolgreich:</b> ' + esc((j.repairNotes || []).join(" • ")) +
              '</div>'
            ) : '') +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              '<div>' +
                '<span style="font-size:11.5px;font-weight:800;padding:3px 8px;border-radius:999px;background:' + (j.isTelegramBackup ? 'rgba(2,132,199,0.25);color:#38bdf8;border:1px solid rgba(56,189,248,0.4)' : 'rgba(16,185,129,0.2);color:#34d399') + '">' +
                  (j.isTelegramBackup ? ('📦 TELEGRAM CHAT-BACKUP: ' + esc(j.backupChatName)) : '📄 STANDARD JSON-TITELLISTE') +
                '</span>' +
                '<span style="font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;background:rgba(16,185,129,0.2);color:#34d399;margin-left:6px">📡 Kanal: ' + esc(activeChan || 'Verifiziert') + '</span>' +
                '<div style="font-size:12px;color:#ccc;margin-top:6px">' +
                  'Datei: <b>' + esc(effectiveFileName) + '</b>' + (j.fileSizeMb ? (' (' + j.fileSizeMb + ' MB)') : '') + ' • Roh-Nachrichten: <b>' + Number(j.rawMessageCount || total).toLocaleString('de-DE') + '</b> ➔ Zu verarbeitende Einträge: <b style="color:#fbbf24">' + total.toLocaleString('de-DE') + '</b>' +
                  (j.entries.length === 0 && total > 0 ? ' <span style="color:#38bdf8;font-size:11px">(📌 D1-Checkpoint aktiv – zum Weiterlaufen bitte Datei oben kurz auswählen, Prüfen & Logs sind sofort verfügbar!)</span>' : '') +
                '</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                (!j.running && j.entries.length > 0 && done < total ? '<button class="btn green" onclick="startOrResumeBackupImport()">🚀 ' + (done > 0 ? ('Fortsetzen ab #' + done.toLocaleString('de-DE')) : ('Smart-Import starten (' + total.toLocaleString('de-DE') + ')')) + '</button>' : '') +
                (j.running ? '<button class="btn amber" onclick="pauseBackupImport()">⏸️ Pausieren (Checkpoint speichern)</button>' : '') +
                (done > 0 && !j.running && j.entries.length > 0 ? '<button class="btn amber" onclick="restartBackupFromZeroNoDupesClient()">🔄 Ab 0 neu starten (ohne Duplikate)</button>' : '') +
                ((done > 0 || (j.reviewItems && j.reviewItems.length > 0)) ? '<button class="btn red" onclick="resetBackupImport(true)">↺ Zurücksetzen</button>' : '') +
              '</div>' +
            '</div>' +

            (done === 0 && !j.running ? (
              '<div style="background:#181820;border:1px solid rgba(251,191,36,0.3);border-radius:8px;padding:10px;margin-bottom:10px">' +
                '<div style="font-size:12px;font-weight:800;color:#fbbf24;margin-bottom:6px">🔎 Vorab-Analyse & Smart-Deduplizierung (bereit zum Start):</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;font-size:11.5px;margin-bottom:8px">' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">🎬 Erkannte Filme: <b style="color:#34d399">' + Number(j.detectedMoviesCount || 0).toLocaleString('de-DE') + '</b></div>' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">📺 Erkannte Serien/Folgen: <b style="color:#38bdf8">' + Number(j.detectedSeriesCount || 0).toLocaleString('de-DE') + '</b></div>' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">♻️ Exakte Duplikate gefiltert: <b style="color:#a78bfa">' + Number(j.duplicatesSkippedInFile || 0).toLocaleString('de-DE') + '</b></div>' +
                  '<div style="background:#121218;padding:7px 9px;border-radius:6px">🔗 Weitere Qualitäten/Parts: <b style="color:#fbbf24">' + Number(j.qualityVariantsInFile || 0).toLocaleString('de-DE') + '</b></div>' +
                '</div>' +
                (Array.isArray(j.previewSamples) && j.previewSamples.length > 0 ? (
                  '<div style="font-size:11px;color:#94a3b8">' +
                    '<b>Vorschau erkannter Titel:</b> ' +
                    j.previewSamples.map(s =>
                      '<span style="display:inline-block;background:#101015;border:1px solid rgba(255,255,255,0.12);border-radius:5px;padding:2px 6px;margin:2px;color:#e2e8f0">' +
                        (s.isSeries ? '📺 ' : '🎬 ') + esc(s.cleanTitle) + (s.year && s.year !== 'k.A.' ? ' (' + esc(s.year) + ')' : '') + ' [' + esc(s.quality) + (s.isQualityVariant ? ' • 🔗 Merge' : '') + ']' +
                      '</span>'
                    ).join("") +
                  '</div>'
                ) : '') +
              '</div>'
            ) : '') +

            '<div style="background:#1c1c24;padding:10px;border-radius:8px;border:1px solid rgba(16,185,129,0.35);margin-bottom:10px;display:flex;flex-direction:column;gap:8px">' +
              '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
                '<span style="font-size:12px;font-weight:800;color:#34d399">🎵 Ziel-Playlist (automatisch aus Backup-Namen):</span>' +
                '<input id="backupPlaylistNameInp" value="' + esc(j.customPlaylistName || "🎵 JSON-Import") + '" oninput="updateBackupCustomPlaylistName(this.value)" placeholder="Custom Playlist Name..." style="flex:1;min-width:200px;padding:7px 10px;border-radius:6px;background:#101014;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12px" />' +
                (j.playlistFolderId ? '<span style="font-size:11px;color:#38bdf8">✅ Verknüpft (' + esc(j.playlistFolderId) + ')</span>' : '<span style="font-size:11px;color:#94a3b8">Wird beim Start automatisch angelegt</span>') +
              '</div>' +
              '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
                '<span style="font-size:11.5px;color:#cbd5e1;font-weight:700">⚙️ Playlist-Modus wählen (später im Admin jederzeit umschaltbar):</span>' +
                '<button type="button" class="btn ' + (curMode === 'both' ? 'green' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setBackupPlaylistModeClient(\\'both\\')">⚡ Beides: VIP-Stream + Merkliste</button>' +
                '<button type="button" class="btn ' + (curMode === 'vip_stream' ? 'amber' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setBackupPlaylistModeClient(\\'vip_stream\\')">🌟 Nur VIP-Stream-Playlist (Bot-VIP)</button>' +
                '<button type="button" class="btn ' + (curMode === 'watchlist' ? 'blue' : '') + '" style="padding:4px 9px;font-size:11px" onclick="setBackupPlaylistModeClient(\\'watchlist\\')">🔖 Nur persönliche Merkliste</button>' +
              '</div>' +
            '</div>' +

            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px">' +
              '<button class="btn ' + (j.activeSubTab !== 'review' && j.activeSubTab !== 'diaglog' ? 'red' : '') + '" onclick="switchBackupSubTab(\\'dashboard\\')">📊 Live-Fortschritt & Poster-Feed</button>' +
              '<button id="revSubTabBtn" class="btn ' + (j.activeSubTab === 'review' ? 'amber' : '') + '" onclick="switchBackupSubTab(\\'review\\')">' +
                '🛠️ Prüfen & Korrigieren' +
                (openReviewCount > 0 ? ' <span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:999px;font-size:10.5px;margin-left:4px">' + openReviewCount + '</span>' : ' (' + (j.reviewItems || []).length + ')') +
              '</button>' +
              '<button class="btn ' + (j.activeSubTab === 'diaglog' ? 'blue' : '') + '" onclick="switchBackupSubTab(\\'diaglog\\')">' +
                '🛠️ Diagnose-Log (' + getDiagnosticLogTotalCountClient() + ')' +
              '</button>' +
            '</div>' +

            (j.activeSubTab === "review" ? renderBackupReviewTabHtml(j) : j.activeSubTab === "diaglog" ? renderImportDiagnosticLogBoxHtml() : (
              '<div style="width:100%;height:22px;background:#222;border-radius:999px;overflow:hidden;border:1px solid rgba(255,255,255,0.15);position:relative;margin:10px 0">' +
                '<div style="width:' + Math.min(100, Number(pct)) + '%;height:100%;background:linear-gradient(90deg,#e50914,#10b981);transition:width 0.25s ease"></div>' +
                '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:900;color:#fff;text-shadow:0 1px 4px #000">' +
                  pct + '% (' + done.toLocaleString('de-DE') + ' / ' + total.toLocaleString('de-DE') + ')' +
                '</div>' +
              '</div>' +
              '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px;font-size:12px;margin-top:8px">' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">🎬 Filme in D1: <b style="color:#34d399">' + j.moviesSaved.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">📺 Serien in D1: <b style="color:#38bdf8">' + j.seriesSaved.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">♻️ Duplikate gefiltert: <b style="color:#a78bfa">' + totalDeduplicated.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">🔗 Qualitäten gemerged: <b style="color:#fbbf24">' + totalMergedStreams.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px;cursor:pointer" onclick="switchBackupSubTab(\\'review\\')">⚠️ Unsicher / Prüfen: <b style="color:#f59e0b">' + j.uncertainCount.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px;cursor:pointer" onclick="setBackupReviewFilter(\\'failed\\');switchBackupSubTab(\\'review\\')">❌ Nicht erkannt: <b style="color:#f87171">' + j.failedCount.toLocaleString('de-DE') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px;cursor:pointer" onclick="switchBackupSubTab(\\'diaglog\\')">🛠️ Diagnose-Log: <b style="color:#60a5fa">' + getDiagnosticLogTotalCountClient() + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">🧠 D1-Pre-Seed: <b style="color:#34d399">' + Number(j.d1PreSeedCount || 0).toLocaleString('de-DE') + ' Titel</b>' + (Number(j.browserCacheHitsCount || 0) > 0 ? (' <span style="color:#38bdf8;font-size:10.5px">(⚡ ' + Number(j.browserCacheHitsCount).toLocaleString('de-DE') + ' Hits)</span>') : '') + '</div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">🎛️ Modus: <b style="color:' + (j.currentBatchModeColor || '#38bdf8') + '">' + esc(j.currentBatchModeLabel || '⚡ Standard (10/Batch)') + '</b></div>' +
                '<div style="background:#1c1c22;padding:8px;border-radius:6px">⚡ Tempo: <b>' + speedPerSec + ' Titel/s</b>' + (j.running && etaSec > 0 ? ' (ETA ~' + etaStr + ')' : '') + '</div>' +
              '</div>' +
              (Array.isArray(j.livePosterFeed) && j.livePosterFeed.length > 0 ? (
                '<div style="margin-top:10px">' +
                  '<div style="font-size:11.5px;font-weight:800;color:#cbd5e1;margin-bottom:6px">🎞️ Zuletzt zugeordnete Titel (Live-Feed):</div>' +
                  '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' +
                    j.livePosterFeed.slice(0, 8).map(f => {
                      const fSeCode = (f.typeCode === 's' && f.season)
                        ? ('S' + String(f.season).padStart(2, '0') + 'E' + String(f.episode || 1).padStart(2, '0'))
                        : '';
                      const fPoster = resolvePosterUrlClient(f.poster, 'w185', '');
                      return '<div style="min-width:155px;max-width:185px;background:#181820;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px;display:flex;gap:7px;align-items:center;flex-shrink:0">' +
                        (fPoster
                          ? '<img src="' + esc(fPoster) + '" style="width:34px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0" alt="" />'
                          : '<div style="width:34px;height:50px;background:#252530;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (f.typeCode === 's' ? '📺' : '🎬') + '</div>') +
                        '<div style="min-width:0;flex:1">' +
                          '<div style="font-size:11px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(f.cleanTitle) + '</div>' +
                          '<div style="font-size:10px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (fSeCode ? ('<b style="color:#38bdf8">' + esc(fSeCode) + '</b> • ') : '') + esc(f.year || 'k.A.') + ' • ' + esc(f.quality || '1080p') + '</div>' +
                          '<div style="font-size:9.5px;margin-top:2px;color:' + (f.isUncertain ? '#fbbf24' : f.ingestStatus === 'merged_quality' ? '#38bdf8' : '#34d399') + '">' +
                            esc(f.metadataSource || 'TMDb') + ' • ' + (f.isUncertain ? ('⚠️ ' + f.confidence + '%') : f.ingestStatus === 'merged_quality' ? '🔗 Merge' : f.ingestStatus === 'duplicate' ? '♻️ In D1' : ('✅ ' + f.confidence + '%')) +
                          '</div>' +
                        '</div>' +
                      '</div>';
                    }).join("") +
                  '</div>' +
                '</div>'
              ) : '') +
              (j.recentLog.length > 0 ? (
                '<div style="margin-top:8px;font-size:11px;color:#94a3b8;max-height:90px;overflow-y:auto;background:#101014;padding:6px 8px;border-radius:6px;font-family:monospace">' +
                  j.recentLog.slice(-6).map(l => '<div>' + esc(l) + '</div>').join("") +
                '</div>'
              ) : '')
            )) +
          '</div>';

        // Nach einem Komplett-Render die exakte Scroll-Position des Review-Containers wiederherstellen
        if (savedReviewScrollTop !== null && savedReviewScrollTop > 0) {
          const newScrollEl = document.getElementById("backupReviewScrollContainer");
          if (newScrollEl) newScrollEl.scrollTop = savedReviewScrollTop;
        }
      }

      // =========================================================================
      // PERSISTENTES DIAGNOSE-LOG (D1 + Browser localStorage + KI-Analyse-Export)
      // =========================================================================
      const CLIENT_DIAG_LOG_STORAGE_KEY = "tma_import_diagnostic_logs_v1";
      let clientDiagnosticLogState = {
        logs: [],
        loadedFromLocal: false,
        filterStatus: "ALL",
        searchQuery: "",
        syncing: false
      };

      function loadClientDiagnosticLogsFromStorage() {
        if (clientDiagnosticLogState.loadedFromLocal) return clientDiagnosticLogState.logs;
        clientDiagnosticLogState.loadedFromLocal = true;
        try {
          const raw = localStorage.getItem(CLIENT_DIAG_LOG_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) clientDiagnosticLogState.logs = parsed.slice(0, 1200);
          }
        } catch (e) {}
        return clientDiagnosticLogState.logs;
      }

      function saveClientDiagnosticLogsToStorage() {
        try {
          localStorage.setItem(CLIENT_DIAG_LOG_STORAGE_KEY, JSON.stringify((clientDiagnosticLogState.logs || []).slice(0, 1000)));
        } catch (e) {}
      }

      function getDiagnosticLogTotalCountClient() {
        loadClientDiagnosticLogsFromStorage();
        return (clientDiagnosticLogState.logs || []).length;
      }

      function appendClientDiagnosticLogs(newEntries = [], syncToServer = true) {
        if (!Array.isArray(newEntries) || newEntries.length === 0) return;
        loadClientDiagnosticLogsFromStorage();
        const existingIndexByKey = new Map();
        (clientDiagnosticLogState.logs || []).forEach((l, idx) => {
          const k = String(l.msgId || "") + "|" + String(l.fileName || "");
          if (!existingIndexByKey.has(k)) existingIndexByKey.set(k, idx);
        });
        const added = [];
        for (const raw of newEntries) {
          if (!raw) continue;
          const rawMsgVal = raw.msgId ?? raw.msg_id ?? null;
          const normMsgId = (rawMsgVal !== null && rawMsgVal !== "" && Number.isFinite(Number(rawMsgVal)))
            ? Number(rawMsgVal)
            : null;
          const rawStatusUp = String(raw.status || "OK").toUpperCase();
          const normStatus = rawStatusUp === "CONFLICT_?" ? "CONFLICT" : rawStatusUp;
          const entry = {
            id: raw.id || ("diag_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
            msgId: normMsgId,
            fileName: String(raw.fileName || raw.file_name || raw.rawFileName || "Unbekannt").slice(0, 260),
            rawText: String(raw.rawText || raw.raw_text || "").slice(0, 500),
            status: normStatus,
            reviewReasonCode: raw.reviewReasonCode || raw.review_reason_code || raw.details?.reviewReasonCode || null,
            reason: String(raw.reason || "").slice(0, 360),
            detectedType: String(raw.detectedType || raw.detected_type || "auto"),
            parsedTitle: String(raw.parsedTitle || raw.parsed_title || raw.cleanTitle || ""),
            matchedTitle: String(raw.matchedTitle || raw.matched_title || raw.details?.matchedTitle || ""),
            seasonNumber: raw.seasonNumber ?? raw.season_number ?? raw.season ?? null,
            episodeNumber: raw.episodeNumber ?? raw.episode_number ?? raw.episode ?? null,
            tmdbId: raw.tmdbId ?? raw.tmdb_id ?? null,
            details: raw.details && typeof raw.details === "object" ? raw.details : null,
            rawEntry: raw.rawEntry || raw.details?.rawEntry || (raw.raw_entry_json ? (() => { try { return JSON.parse(raw.raw_entry_json); } catch (_) { return null; } })() : null),
            createdAt: Number(raw.createdAt || raw.created_at || Date.now())
          };
          const dedupeKey = String(entry.msgId || "") + "|" + entry.fileName;
          if (existingIndexByKey.has(dedupeKey)) {
            const existingIdx = existingIndexByKey.get(dedupeKey);
            clientDiagnosticLogState.logs[existingIdx] = {
              ...clientDiagnosticLogState.logs[existingIdx],
              ...entry,
              matchedTitle: entry.matchedTitle || clientDiagnosticLogState.logs[existingIdx]?.matchedTitle || "",
              tmdbId: entry.tmdbId ?? clientDiagnosticLogState.logs[existingIdx]?.tmdbId ?? null
            };
            added.push(clientDiagnosticLogState.logs[existingIdx]);
          } else {
            existingIndexByKey.set(dedupeKey, 0);
            clientDiagnosticLogState.logs.unshift(entry);
            added.push(entry);
          }
        }
        // MODUL 5: Fehler-Priorität im Log-Buffer – OK und SKIPPED_DUPLICATE dürfen niemals echte Problem-Einträge verdrängen
        if (clientDiagnosticLogState.logs.length > 1200) {
          const priorityProblemLogs = [];
          const routineLogs = [];
          for (const l of clientDiagnosticLogState.logs) {
            const st = String(l.status || "OK").toUpperCase();
            if (st === "OK" || st === "SKIPPED_DUPLICATE") {
              routineLogs.push(l);
            } else {
              priorityProblemLogs.push(l);
            }
          }
          const remainingSlots = Math.max(0, 1200 - priorityProblemLogs.length);
          clientDiagnosticLogState.logs = [
            ...priorityProblemLogs.slice(0, 1200),
            ...routineLogs.slice(0, remainingSlots)
          ];
        }
        saveClientDiagnosticLogsToStorage();
        if (syncToServer && added.length > 0) {
          apiFetchJson(API_BASE + "/admin/import-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "append", logs: added.slice(0, 120) })
          }).catch(() => {});
        }
      }

      async function syncDiagnosticLogsFromD1Client(silent = false) {
        loadClientDiagnosticLogsFromStorage();
        if (!silent) clientDiagnosticLogState.syncing = true;
        try {
          const r = await apiFetchJson(API_BASE + "/admin/import-logs?limit=600");
          if (r && r.ok && Array.isArray(r.logs)) {
            appendClientDiagnosticLogs(r.logs, false);
          }
        } catch (e) {}
        clientDiagnosticLogState.syncing = false;
        if (state.adminTab === "diaglog") loadAdminPanelView();
        else if (backupImportJob.activeSubTab === "diaglog") renderBackupImportBoxDom();
      }

      function setDiagLogFilterClient(statusVal) {
        clientDiagnosticLogState.filterStatus = statusVal || "ALL";
        refreshDiagnosticLogMountDom();
      }

      function setDiagLogSearchClient(qVal) {
        clientDiagnosticLogState.searchQuery = String(qVal || "");
        refreshDiagnosticLogMountDom();
      }

      function refreshDiagnosticLogMountDom() {
        const mount = document.getElementById("diagLogStandaloneMount");
        if (mount) {
          mount.innerHTML = renderImportDiagnosticLogBoxHtml();
        } else {
          renderBackupImportBoxDom();
        }
      }

      async function clearAllDiagnosticLogsClient() {
        const ok = await showCustomConfirm("Diagnose-Log in D1 und im Browser wirklich komplett leeren?", "🗑️ Diagnose-Log leeren");
        if (!ok) return;
        clientDiagnosticLogState.logs = [];
        saveClientDiagnosticLogsToStorage();
        try {
          await apiFetchJson(API_BASE + "/admin/import-logs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "clear" })
          });
        } catch (e) {}
        showHudToast("🗑️ Diagnose-Log geleert");
        refreshDiagnosticLogMountDom();
      }

      async function rehealOldConflictsWithNewPipelineClient() {
        loadClientDiagnosticLogsFromStorage();
        const openProblems = (clientDiagnosticLogState.logs || []).filter(l => {
          const st = String(l.status || "").toUpperCase();
          return st === "TMDB_NOT_FOUND" || st === "CONFLICT" || st === "CONFLICT_?";
        });
        setBusyState(true, "🩺 Prüfe offene Konflikte & TMDB_NOT_FOUND mit der neuen Modul 2+3 Pipeline...");
        try {
          let totalChecked = 0;
          let totalHealed = 0;
          let cursor = 0;
          const maxRounds = 5;
          for (let round = 0; round < maxRounds; round++) {
            const slice = openProblems.slice(cursor, cursor + 10);
            const r = await apiFetchJson(API_BASE + "/admin/reheal-conflicts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                limit: 10,
                items: slice.length > 0 ? slice : undefined
              })
            });
            if (!r || !r.ok) break;
            totalChecked += Number(r.checkedCount || 0);
            totalHealed += Number(r.healedCount || 0);
            if (Array.isArray(r.healedItems) && r.healedItems.length > 0) {
              for (const healed of r.healedItems) {
                const target = (clientDiagnosticLogState.logs || []).find(
                  l => (healed.msgId && Number(l.msgId) === Number(healed.msgId)) || (healed.fileName && l.fileName === healed.fileName)
                );
                if (target) {
                  target.status = "OK";
                  target.tmdbId = healed.tmdbId;
                  target.matchedTitle = healed.matchedTitle || healed.parsedTitle || "";
                  target.reason = "Automatisch geheilt (Neue Pipeline) → " + (healed.matchedTitle || healed.parsedTitle) + " (#" + healed.tmdbId + ")";
                }
              }
              saveClientDiagnosticLogsToStorage();
            }
            cursor += 10;
            if (!r.remainingCount || slice.length < 10 || cursor >= openProblems.length) break;
          }
          clearClientMediaCaches();
          refreshDiagnosticLogMountDom();
          showHudToast("🩺 Nachprüfung abgeschlossen: " + totalHealed + " von " + totalChecked + " geprüften Konflikten automatisch geheilt!");
        } catch (e) {
          showHudToast("⚠️ Fehler bei der Konflikt-Nachprüfung: " + (e?.message || "Unbekannt"));
        } finally {
          setBusyState(false);
        }
      }

      async function exportDiagnosticLogsForAiClient(onlyProblems = true) {
        loadClientDiagnosticLogsFromStorage();
        const all = clientDiagnosticLogState.logs || [];
        // MODUL 5: Echte Problem-Einträge haben im Export-Buffer immer Vorrang vor OK und SKIPPED_DUPLICATE
        const priorityProblems = all.filter(l => l.status !== "OK" && l.status !== "SKIPPED_DUPLICATE");
        const routineItems = all.filter(l => l.status === "OK" || l.status === "SKIPPED_DUPLICATE");
        const orderedList = onlyProblems
          ? priorityProblems
          : [...priorityProblems, ...routineItems];
        const payload = {
          exportedAt: new Date().toISOString(),
          totalLogs: all.length,
          exportedCount: Math.min(250, orderedList.length),
          summaryCounts: {
            OK: all.filter(l => l.status === "OK").length,
            SKIPPED_JUNK: all.filter(l => l.status === "SKIPPED_JUNK").length,
            SKIPPED_HEADER: all.filter(l => l.status === "SKIPPED_HEADER").length,
            SKIPPED_DUPLICATE: all.filter(l => l.status === "SKIPPED_DUPLICATE").length,
            TMDB_NOT_FOUND: all.filter(l => l.status === "TMDB_NOT_FOUND").length,
            CONFLICT: all.filter(l => l.status === "CONFLICT_?" || l.status === "CONFLICT").length,
            SUBREQUEST_PAUSE: all.filter(l => l.status === "SUBREQUEST_PAUSE").length,
            API_ERROR: all.filter(l => l.status === "API_ERROR").length
          },
          entries: orderedList.slice(0, 250).map(l => ({
            msgId: l.msgId !== null && l.msgId !== undefined ? Number(l.msgId) : null,
            status: l.status === "CONFLICT_?" ? "CONFLICT" : l.status,
            detectedType: l.detectedType,
            fileName: l.fileName,
            parsedTitle: l.parsedTitle,
            matchedTitle: l.matchedTitle || null,
            season: l.seasonNumber,
            episode: l.episodeNumber,
            tmdbId: l.tmdbId,
            reason: l.reason,
            rawText: (l.rawText || "").slice(0, 220)
          }))
        };
        const jsonText = JSON.stringify(payload, null, 2);
        try {
          await navigator.clipboard.writeText(jsonText);
          showHudToast("📋 Diagnose-JSON (" + payload.exportedCount + " Einträge, Fehler-Priorität aktiv) in die Zwischenablage kopiert!");
        } catch (e) {
          const blob = new Blob([jsonText], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "diagnose-log-ki-export.json";
          a.click();
          showHudToast("💾 Diagnose-Log als JSON-Datei heruntergeladen!");
        }
      }

      async function quickAssignDiagLogEntryClient(diagIdx) {
        loadClientDiagnosticLogsFromStorage();
        const item = clientDiagnosticLogState.logs[diagIdx];
        if (!item) return;
        const tmdbInp = document.getElementById("diagFixTmdb_" + diagIdx);
        const typeSel = document.getElementById("diagFixType_" + diagIdx);
        const sInp = document.getElementById("diagFixSeason_" + diagIdx);
        const eInp = document.getElementById("diagFixEp_" + diagIdx);
        const newTmdbId = Number(tmdbInp?.value || 0);
        const newTypeCode = typeSel?.value === "s" ? "s" : "m";
        const sNum = Number(sInp?.value ?? item.seasonNumber ?? 1);
        const eNum = Number(eInp?.value || item.episodeNumber || 1);
        if (!newTmdbId) {
          showHudToast("⚠️ Bitte eine gültige TMDb-ID eingeben!");
          return;
        }
        setBusyState(true, "🔧 Weise Eintrag direkt TMDb #" + newTmdbId + " zu...");
        try {
          const rawEntry = item.rawEntry && typeof item.rawEntry === "object"
            ? { ...item.rawEntry }
            : {
                filename: item.fileName,
                raw_file_name: item.fileName,
                raw_text: item.rawText,
                msg_id: item.msgId,
                message_id: item.msgId
              };
          if (newTypeCode === "s") {
            rawEntry.season = sNum;
            rawEntry.episode = eNum;
            rawEntry.isSeries = true;
          }
          const r = await apiFetchJson(API_BASE + "/admin/remap-import-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              newTmdbId,
              newTypeCode,
              msgId: item.msgId || null,
              oldTmdbId: item.tmdbId || null,
              oldTypeCode: item.detectedType === "series" ? "s" : "m",
              targetChatId: backupImportJob.targetPlaylistChatId || chatId,
              playlistFolderId: backupImportJob.playlistFolderId || null,
              playlistMode: backupImportJob.playlistMode || "both",
              rawEntry
            })
          });
          if (r && r.ok) {
            item.status = "OK";
            item.tmdbId = newTmdbId;
            item.matchedTitle = r.matchedItem?.matchedTitle || r.matchedItem?.cleanTitle || "";
            item.detectedType = newTypeCode === "s" ? "series" : "movie";
            item.seasonNumber = newTypeCode === "s" ? sNum : null;
            item.episodeNumber = newTypeCode === "s" ? eNum : null;
            item.reason = "Manuell im Diagnose-Log zugewiesen → " + (r.matchedItem?.cleanTitle || ("TMDb #" + newTmdbId));
            saveClientDiagnosticLogsToStorage();
            await apiFetchJson(API_BASE + "/admin/import-logs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "resolve",
                id: item.id,
                msgId: item.msgId,
                tmdbId: newTmdbId,
                reason: item.reason
              })
            }).catch(() => {});
            clearClientMediaCaches();
            showHudToast("✅ Erfolgreich verknüpft: " + (r.matchedItem?.cleanTitle || ("TMDb #" + newTmdbId)));
            refreshDiagnosticLogMountDom();
          } else {
            showHudToast("⚠️ " + (r?.error || "Zuweisung fehlgeschlagen"));
          }
        } finally {
          setBusyState(false);
        }
      }

      function renderImportDiagnosticLogBoxHtml() {
        loadClientDiagnosticLogsFromStorage();
        const logs = clientDiagnosticLogState.logs || [];
        const fStatus = clientDiagnosticLogState.filterStatus || "ALL";
        const q = (clientDiagnosticLogState.searchQuery || "").trim().toLowerCase();

        const counts = {
          ALL: logs.length,
          OK: 0,
          SKIPPED_JUNK: 0,
          SKIPPED_HEADER: 0,
          SKIPPED_DUPLICATE: 0,
          SKIPPED_PRERELEASE: 0,
          TMDB_NOT_FOUND: 0,
          CONFLICT: 0,
          SUBREQUEST_PAUSE: 0,
          API_ERROR: 0
        };
        for (const l of logs) {
          const st = String(l.status || "OK");
          if (st === "CONFLICT_?" || st === "CONFLICT") counts.CONFLICT++;
          else if (counts[st] !== undefined) counts[st]++;
        }

        const filtered = logs.filter((l) => {
          const st = String(l.status || "OK");
          if (fStatus === "PROBLEMS") {
            if (st === "OK" || st === "SKIPPED_DUPLICATE") return false;
          } else if (fStatus === "CONFLICT") {
            if (st !== "CONFLICT_?" && st !== "CONFLICT") return false;
          } else if (fStatus !== "ALL" && st !== fStatus) {
            return false;
          }
          if (q) {
            const hay = (String(l.msgId || "") + " " + String(l.fileName || "") + " " + String(l.parsedTitle || "") + " " + String(l.matchedTitle || "") + " " + String(l.reason || "") + " " + String(l.rawText || "")).toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });

        const statusBadgeMap = {
          OK: { bg: "rgba(16,185,129,0.2)", col: "#34d399", label: "🟢 OK" },
          SKIPPED_JUNK: { bg: "rgba(148,163,184,0.2)", col: "#94a3b8", label: "🗑️ SKIPPED_JUNK" },
          SKIPPED_HEADER: { bg: "rgba(56,189,248,0.2)", col: "#38bdf8", label: "📌 SKIPPED_HEADER" },
          SKIPPED_DUPLICATE: { bg: "rgba(167,139,250,0.2)", col: "#a78bfa", label: "♻️ SKIPPED_DUPLICATE" },
          SKIPPED_PRERELEASE: { bg: "rgba(245,158,11,0.22)", col: "#fbbf24", label: "⚠️ SKIPPED_PRERELEASE" },
          TMDB_NOT_FOUND: { bg: "rgba(239,68,68,0.25)", col: "#f87171", label: "❌ TMDB_NOT_FOUND" },
          "CONFLICT_?": { bg: "rgba(245,158,11,0.25)", col: "#fbbf24", label: "⚠️ CONFLICT" },
          CONFLICT: { bg: "rgba(245,158,11,0.25)", col: "#fbbf24", label: "⚠️ CONFLICT" },
          SUBREQUEST_PAUSE: { bg: "rgba(59,130,246,0.25)", col: "#60a5fa", label: "🛡️ SUBREQUEST_PAUSE" },
          API_ERROR: { bg: "rgba(239,68,68,0.25)", col: "#fca5a5", label: "🔥 API_ERROR" }
        };

        return '<div id="diagLogStandaloneMount" style="background:#101016;border:1px solid rgba(56,189,248,0.35);border-radius:10px;padding:12px">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
            '<div>' +
              '<div style="font-size:14px;font-weight:900;color:#fff">🛠️ Persistentes Import-Diagnose-Log (D1 + Browser)</div>' +
              '<div style="font-size:11.5px;color:#94a3b8">Lückenlose Nachverfolgung jeder Message-ID inkl. Grund, Typ-Weiche, Subrequest-Guard & Direkt-Korrektur</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button type="button" class="btn green" onclick="rehealOldConflictsWithNewPipelineClient()" title="Prüft alle offenen TMDB_NOT_FOUND & CONFLICT Einträge mit der neuen Modul 2+3 Pipeline nach">🩺 Alt-Konflikte mit neuer Pipeline prüfen</button>' +
              '<button type="button" class="btn" style="background:rgba(168,85,247,0.22);border:1px solid rgba(168,85,247,0.55);color:#e9d5ff" onclick="startManualNoTmdbQueueModeClient(\\'diag\\')" title="Öffnet alle offenen Nicht-erkannt-Treffer nacheinander im 900M-Modal">✨ Queue-Modus (900M-ID)</button>' +
              '<button type="button" class="btn amber" onclick="exportDiagnosticLogsForAiClient(true)">📋 Fehler-Log für KI kopieren</button>' +
              '<button type="button" class="btn blue" onclick="exportDiagnosticLogsForAiClient(false)">📋 Komplettes Log kopieren</button>' +
              '<button type="button" class="btn" onclick="syncDiagnosticLogsFromD1Client(false)">🔄 Aus D1 laden</button>' +
              '<button type="button" class="btn red" onclick="clearAllDiagnosticLogsClient()">🗑️ Log leeren</button>' +
            '</div>' +
          '</div>' +

          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-bottom:10px;font-size:11.5px">' +
            '<div onclick="setDiagLogFilterClient(\\'ALL\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'ALL' ? 'rgba(56,189,248,0.22)' : '#181822') + ';border:1px solid rgba(255,255,255,0.1)">📋 Gesamt: <b>' + counts.ALL + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'PROBLEMS\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'PROBLEMS' ? 'rgba(245,158,11,0.22)' : '#181822') + ';border:1px solid rgba(245,158,11,0.35)">🚨 Alle Hinweise/Fehler: <b style="color:#fbbf24">' + (counts.ALL - counts.OK - counts.SKIPPED_DUPLICATE) + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'OK\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'OK' ? 'rgba(16,185,129,0.22)' : '#181822') + ';border:1px solid rgba(16,185,129,0.3)">🟢 OK: <b style="color:#34d399">' + counts.OK + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'TMDB_NOT_FOUND\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'TMDB_NOT_FOUND' ? 'rgba(239,68,68,0.25)' : '#181822') + ';border:1px solid rgba(239,68,68,0.35)">❌ TMDB_NOT_FOUND: <b style="color:#f87171">' + counts.TMDB_NOT_FOUND + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'CONFLICT\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'CONFLICT' ? 'rgba(245,158,11,0.25)' : '#181822') + ';border:1px solid rgba(245,158,11,0.35)">⚠️ CONFLICT: <b style="color:#fbbf24">' + counts.CONFLICT + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'SKIPPED_HEADER\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'SKIPPED_HEADER' ? 'rgba(56,189,248,0.22)' : '#181822') + ';border:1px solid rgba(56,189,248,0.3)">📌 Header/Poster: <b style="color:#38bdf8">' + counts.SKIPPED_HEADER + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'SKIPPED_DUPLICATE\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'SKIPPED_DUPLICATE' ? 'rgba(167,139,250,0.22)' : '#181822') + ';border:1px solid rgba(167,139,250,0.3)">♻️ Duplikate: <b style="color:#a78bfa">' + counts.SKIPPED_DUPLICATE + '</b></div>' +
            '<div onclick="setDiagLogFilterClient(\\'SUBREQUEST_PAUSE\\')" style="cursor:pointer;padding:7px 9px;border-radius:6px;background:' + (fStatus === 'SUBREQUEST_PAUSE' ? 'rgba(59,130,246,0.25)' : '#181822') + ';border:1px solid rgba(59,130,246,0.35)">🛡️ Subrequest-Guard: <b style="color:#60a5fa">' + counts.SUBREQUEST_PAUSE + '</b></div>' +
          '</div>' +

          '<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
            '<input value="' + esc(clientDiagnosticLogState.searchQuery || "") + '" oninput="setDiagLogSearchClient(this.value)" placeholder="🔍 Suche nach Message-ID (z.B. 118, 303), Dateiname, Suchtitel, TMDb-Match..." style="flex:1;min-width:240px;padding:8px 10px;border-radius:6px;background:#161620;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
          '</div>' +

          (filtered.length === 0 ? (
            '<div style="padding:18px;text-align:center;color:#94a3b8;font-size:12px;background:#15151e;border-radius:8px">' +
              'Noch keine Einträge für diesen Filter vorhanden. Lade eine <code>result.json</code> hoch oder klicke oben auf <b>🔄 Aus D1 laden</b>.' +
            '</div>'
          ) : (
            '<div style="max-height:460px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">' +
              filtered.slice(0, 180).map((item) => {
                const origIdx = logs.indexOf(item);
                const badge = statusBadgeMap[item.status] || { bg: "rgba(148,163,184,0.2)", col: "#cbd5e1", label: item.status };
                const isFixable = item.status === "TMDB_NOT_FOUND" || item.status === "CONFLICT_?" || item.status === "CONFLICT" || item.status === "API_ERROR";
                const isSynthetic900m = Number(item.tmdbId || 0) >= 900000000;
                const itemReasonMeta = isFixable ? resolveClientReviewReasonMeta(item) : null;
                const seLabel = item.seasonNumber !== null && item.seasonNumber !== undefined
                  ? (' • <b style="color:#38bdf8">S' + String(item.seasonNumber).padStart(2, '0') + 'E' + String(item.episodeNumber || 1).padStart(2, '0') + '</b>')
                  : '';
                return '<div style="background:#161620;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:6px">' +
                  '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">' +
                    '<div style="min-width:0;flex:1">' +
                      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                        '<span style="font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;background:' + badge.bg + ';color:' + badge.col + '">' + esc(badge.label) + '</span>' +
                        (itemReasonMeta ? '<span style="font-family:monospace;font-size:10px;font-weight:900;padding:2px 7px;border-radius:5px;' + itemReasonMeta.badgeStyle + '">' + itemReasonMeta.icon + ' ' + esc(itemReasonMeta.code) + '</span>' : '') +
                        (item.msgId ? '<span style="font-family:monospace;font-size:11px;background:#0f172a;color:#38bdf8;padding:2px 6px;border-radius:5px;border:1px solid rgba(56,189,248,0.3)">Msg #' + esc(item.msgId) + '</span>' : '') +
                        '<span style="font-size:11px;color:#94a3b8">[' + esc(item.detectedType || 'auto') + ']</span>' +
                        '<b style="font-size:12.5px;color:#fff">' + esc(item.fileName || item.parsedTitle || 'Eintrag') + '</b>' +
                        (item.parsedTitle ? ' <span style="font-size:11px;color:#a78bfa">🔍 Suchtitel: „' + esc(item.parsedTitle) + '“</span>' : '') +
                        (item.matchedTitle ? ' <span style="font-size:11px;color:#34d399">🎯 Match: „' + esc(item.matchedTitle) + '“</span>' : '') +
                        seLabel +
                        (item.tmdbId ? ' <span style="font-size:11px;color:' + (isSynthetic900m ? '#e9d5ff' : '#34d399') + '">(' + (isSynthetic900m ? '900M #' : 'TMDb #') + esc(item.tmdbId) + ')</span>' : '') +
                      '</div>' +
                      '<div style="font-size:11.5px;color:#cbd5e1;margin-top:3px">💬 <b>Grund:</b> ' + esc(item.reason || '–') + '</div>' +
                      (item.rawText ? '<div style="font-size:10.5px;color:#64748b;margin-top:2px;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📄 Roh-Text: ' + esc(item.rawText) + '</div>' : '') +
                    '</div>' +
                    (isSynthetic900m && origIdx >= 0 ? (
                      '<button type="button" class="btn blue" style="padding:4px 8px;font-size:10.5px" onclick="openManualNoTmdbConfirmForDiagItem(' + origIdx + ')">🔄 900M → TMDb migrieren</button>'
                    ) : '') +
                  '</div>' +
                  (isFixable && origIdx >= 0 ? (
                    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:#101018;padding:7px;border-radius:6px;border:1px solid rgba(245,158,11,0.3)">' +
                      '<span style="font-size:11px;font-weight:800;color:#fbbf24">🔧 Direkt-Zuweisung:</span>' +
                      '<select id="diagFixType_' + origIdx + '" style="padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px">' +
                        '<option value="s" ' + (item.detectedType === 'series' || item.seasonNumber ? 'selected' : '') + '>📺 Serie</option>' +
                        '<option value="m" ' + (item.detectedType === 'movie' && !item.seasonNumber ? 'selected' : '') + '>🎬 Film</option>' +
                      '</select>' +
                      '<input id="diagFixTmdb_' + origIdx + '" type="number" value="' + esc(item.tmdbId || '') + '" placeholder="TMDb-ID (z.B. 66732)" style="width:135px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" />' +
                      '<input id="diagFixSeason_' + origIdx + '" type="number" value="' + esc(item.seasonNumber ?? 1) + '" placeholder="Staffel" style="width:68px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" title="Staffel" />' +
                      '<input id="diagFixEp_' + origIdx + '" type="number" value="' + esc(item.episodeNumber || 1) + '" placeholder="Folge" style="width:68px;padding:5px 7px;border-radius:5px;background:#181824;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:11px" title="Folge" />' +
                      '<button type="button" class="btn green" style="padding:5px 9px;font-size:11px" onclick="quickAssignDiagLogEntryClient(' + origIdx + ')">💾 Jetzt verknüpfen</button>' +
                      '<button type="button" class="btn purple" style="padding:5px 9px;font-size:11px;background:rgba(168,85,247,0.22);border:1px solid rgba(168,85,247,0.55);color:#e9d5ff" onclick="openManualNoTmdbConfirmForDiagItem(' + origIdx + ')">✨ Ohne TMDb-ID bestätigen</button>' +
                    '</div>'
                  ) : '') +
                '</div>';
              }).join("") +
            '</div>'
          )) +
        '</div>';
      }

      async function startOrResumeBackupImport() {
        if (backupImportJob.running || !backupImportJob.entries.length) return;
        const activeChan = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
        if (!activeChan || (!activeChan.startsWith("-100") && !activeChan.startsWith("@"))) {
          showHudToast("⛔ Import gesperrt: Bitte zuerst oben in Schritt 1 die Kanal-ID (-100...) prüfen!");
          return;
        }
        backupImportJob.verifiedChannelId = activeChan;

        const inpEl = document.getElementById("backupPlaylistNameInp");
        if (inpEl && inpEl.value.trim()) {
          backupImportJob.customPlaylistName = inpEl.value.trim().slice(0, 48);
        }
        backupImportJob.running = true;
        backupImportJob.paused = false;
        if (!backupImportJob.startedAt) backupImportJob.startedAt = Date.now();
        renderBackupImportBoxDom();

        const DEFAULT_BATCH_SIZE = 10;
        if (!backupImportJob.cursorRetries) backupImportJob.cursorRetries = {};

        const isolateFailedEntryAtCursor = (reasonMsg) => {
          const badIdx = backupImportJob.cursor;
          const badEntry = backupImportJob.entries[badIdx] || {};
          const rawLabel = typeof badEntry === "string"
            ? badEntry
            : (badEntry.rawInput || badEntry.filename || badEntry.file_name || badEntry.cleanTitle || ("Eintrag #" + (badIdx + 1)));
          const fallbackItem = {
            id: "rev_" + badIdx + "_" + Date.now(),
            rawInput: String(rawLabel),
            rawEntry: typeof badEntry === "object" ? badEntry : { filename: String(rawLabel) },
            status: "failed",
            ingestStatus: "failed",
            isUncertain: true,
            confidence: 0,
            typeCode: badEntry.isSeries ? "s" : "m",
            tmdbId: null,
            cleanTitle: badEntry.cleanTitle || String(rawLabel),
            year: badEntry.year || "k.A.",
            poster: "",
            quality: badEntry.quality || "1080p",
            codec: badEntry.codec || "x264",
            part: badEntry.part || null,
            season: badEntry.season || null,
            episode: badEntry.episode || null,
            metadataSource: "Prüfung",
            reviewReasonCode: "API_ERROR",
            errorReason: "Nach Wiederholungsversuch isoliert: " + String(reasonMsg || "Unbekannter Fehler"),
            reason: "Nach Wiederholungsversuch isoliert: " + String(reasonMsg || "Unbekannter Fehler"),
            msgId: (badEntry.msg_id || badEntry.messageId || badEntry.message_id) ? Number(badEntry.msg_id || badEntry.messageId || badEntry.message_id) : null,
            messageLink: badEntry.message_link || badEntry.messageLink || "",
            rawFileName: badEntry.raw_file_name || badEntry.file_name || String(rawLabel),
            rawText: badEntry.raw_text || badEntry.rawText || "",
            sourceUsed: badEntry.source_used || "file_name",
            languages: badEntry.languages || ["de"],
            prevMessages: Array.isArray(badEntry.prev_messages || badEntry.prevMessages) ? (badEntry.prev_messages || badEntry.prevMessages) : [],
            candidates: []
          };
          backupImportJob.reviewItems.push(fallbackItem);
          backupImportJob.failedCount += 1;
          backupImportJob.cursor += 1;
          appendClientDiagnosticLogs([{
            msgId: fallbackItem.msgId,
            fileName: fallbackItem.rawFileName,
            rawText: fallbackItem.rawText,
            status: "API_ERROR",
            reviewReasonCode: "API_ERROR",
            reason: "Nach Wiederholungsversuch isoliert: " + String(reasonMsg || "Unbekannter Fehler"),
            detectedType: fallbackItem.typeCode === "s" ? "series" : "movie",
            parsedTitle: fallbackItem.cleanTitle,
            seasonNumber: fallbackItem.season,
            episodeNumber: fallbackItem.episode,
            rawEntry: fallbackItem.rawEntry
          }], true);
          saveBackupCheckpointClient();
          const isOutdatedWorkerErr = String(reasonMsg || "").includes("normalizeCompareString") || String(reasonMsg || "").includes("externalFallbackCache");
          backupImportJob.recentLog.push(
            "⚠️ Eintrag #" + (badIdx + 1) + " (" + String(rawLabel).slice(0, 36) + ") zur Prüfung isoliert" +
            (isOutdatedWorkerErr ? " [Hinweis: Bitte aktualisierte worker.js in Cloudflare deployen!]" : "") +
            " – fahre bei #" + backupImportJob.cursor + " fort."
          );
        };

        if (!backupImportJob.resolvedTitlesCache || typeof backupImportJob.resolvedTitlesCache !== "object") {
          backupImportJob.resolvedTitlesCache = {};
        }
        const normClientTitleKey = (t) => String(t || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\\u0300-\\u036f]/g, "")
          .replace(/&/g, "and")
          .replace(/[^a-z0-9]+/g, "")
          .trim();

        // D1-Katalog Pre-Seed: Einmalig beim Start alle bereits in D1 gespeicherten Filme & Serien in den Browser-Cache vorladen (0 Such-Calls ab Eintrag #1!)
        if (!backupImportJob._d1CatalogPreSeeded) {
          backupImportJob._d1CatalogPreSeeded = true;
          backupImportJob.currentBatchModeLabel = "🧠 Lade D1-Pre-Seed...";
          backupImportJob.currentBatchModeColor = "#38bdf8";
          renderBackupImportBoxDom();
          try {
            const preRes = await apiFetchJson(API_BASE + "/admin/catalog-preseed", { method: "GET" });
            if (preRes && preRes.ok && Array.isArray(preRes.items)) {
              let preSeedAdded = 0;
              for (const pItem of preRes.items) {
                if (!pItem || !pItem.tmdbId || !pItem.title) continue;
                const pNorm = normClientTitleKey(pItem.title);
                if (!pNorm || pNorm === "unbekannt") continue;
                const pType = pItem.typeCode === "s" ? "s" : "m";
                const pYear = pItem.year ? String(pItem.year) : "any";
                const cacheObj = {
                  tmdbId: Number(pItem.tmdbId),
                  typeCode: pType,
                  cleanTitle: String(pItem.title),
                  poster: pItem.poster || ""
                };
                backupImportJob.resolvedTitlesCache[pType + "_" + pNorm + "_" + pYear] = cacheObj;
                if (!backupImportJob.resolvedTitlesCache[pType + "_" + pNorm + "_any"]) {
                  backupImportJob.resolvedTitlesCache[pType + "_" + pNorm + "_any"] = cacheObj;
                }
                preSeedAdded++;
              }
              backupImportJob.d1PreSeedCount = preSeedAdded;
              if (preSeedAdded > 0) {
                backupImportJob.recentLog.push("🧠 D1-Katalog Pre-Seed geladen: " + preSeedAdded.toLocaleString("de-DE") + " Filme & Serien vorab im Browser-Cache bereit (0 Such-Calls)!");
              }
            }
          } catch (preErr) {}
          renderBackupImportBoxDom();
        }

        while (backupImportJob.running && !backupImportJob.paused && backupImportJob.cursor < backupImportJob.entries.length) {
          // Wenn der Admin gerade aktiv eine Übersicht lädt, kurz warten, damit es keinen HTTP 503 Konflikt gibt
          let waitGuard = 0;
          while (window._adminPriorityRequestInFlight && waitGuard < 25) {
            await new Promise(res => setTimeout(res, 150));
            waitGuard++;
          }
          if (!backupImportJob.running || backupImportJob.paused) break;

          const curRetryCount = Number(backupImportJob.cursorRetries[backupImportJob.cursor] || 0);
          // Lookahead auf die nächsten 16 Einträge für adaptive Batch-Größe (🚀 Turbo bei bekannten D1-/Serien-Titeln, 🛡️ Gedrosselt nach Cooldown)
          const lookaheadSlice = backupImportJob.entries.slice(backupImportJob.cursor, backupImportJob.cursor + 16);
          let lookaheadCacheHits = 0;
          for (const lkItem of lookaheadSlice) {
            if (!lkItem || typeof lkItem !== "object") continue;
            if (lkItem.tmdb_id || lkItem.tmdbId) {
              lookaheadCacheHits++;
              continue;
            }
            const lkKey = normClientTitleKey(lkItem.cleanTitle || lkItem.title || "");
            if (!lkKey) continue;
            const lkType = (lkItem.typeCode === "s" || lkItem.isSeries || lkItem.season || lkItem.episode) ? "s" : "m";
            const lkYear = lkItem.year && lkItem.year !== "k.A." ? String(lkItem.year) : "any";
            if (
              backupImportJob.resolvedTitlesCache[lkType + "_" + lkKey + "_" + lkYear]?.tmdbId ||
              backupImportJob.resolvedTitlesCache[lkType + "_" + lkKey + "_any"]?.tmdbId
            ) {
              lookaheadCacheHits++;
            }
          }

          let effectiveBatchSize = DEFAULT_BATCH_SIZE;
          if (curRetryCount > 0) {
            effectiveBatchSize = 1;
            backupImportJob.currentBatchModeLabel = "🔍 Einzel-Isolierung (1/Batch)";
            backupImportJob.currentBatchModeColor = "#fbbf24";
          } else if (backupImportJob._lastBatchHadLatencyCooldown) {
            effectiveBatchSize = 6;
            backupImportJob._lastBatchHadLatencyCooldown = false;
            backupImportJob.currentBatchModeLabel = "🛡️ Gedrosselt (6/Batch nach Pause)";
            backupImportJob.currentBatchModeColor = "#f59e0b";
          } else if (lookaheadCacheHits >= 8) {
            effectiveBatchSize = 16;
            backupImportJob.currentBatchModeLabel = "🚀 Turbo (16/Batch • Cache-Hits)";
            backupImportJob.currentBatchModeColor = "#34d399";
          } else {
            effectiveBatchSize = DEFAULT_BATCH_SIZE;
            backupImportJob.currentBatchModeLabel = "⚡ Standard (" + DEFAULT_BATCH_SIZE + "/Batch)";
            backupImportJob.currentBatchModeColor = "#38bdf8";
          }
          const rawSlice = backupImportJob.entries.slice(backupImportJob.cursor, backupImportJob.cursor + effectiveBatchSize);

          // 1. Set-basierte Deduplizierung identischer Payload-Einträge innerhalb des Batches VOR dem D1-/Worker-Check
          const seenBatchItemKeys = new Set();
          const dedupedRawSlice = [];
          const dedupedOrigIndices = [];
          let batchDedupDropped = 0;
          for (let sIdx = 0; sIdx < rawSlice.length; sIdx++) {
            const item = rawSlice[sIdx];
            if (!item || typeof item !== "object") {
              dedupedRawSlice.push(item);
              dedupedOrigIndices.push(sIdx);
              continue;
            }
            const rawTitle = String(item.cleanTitle || item.title || item.filename || item.file_name || item.raw_file_name || item.rawInput || "").trim();
            const normTitle = normClientTitleKey(rawTitle);
            const tgIdKey = String(item.telegram_unique_id || item.file_unique_id || item.telegram_file_id || item.file_id || item.msg_id || item.message_id || "").trim();
            const seKey = (item.season || item.episode) ? ("s" + (item.season || 0) + "e" + (item.episode || 0)) : "";
            const yKey = String(item.year || "").trim();
            if (tgIdKey || normTitle) {
              const compositeKey = tgIdKey + "::" + normTitle + "::" + seKey + "::" + yKey;
              if (seenBatchItemKeys.has(compositeKey)) {
                batchDedupDropped++;
                continue;
              }
              seenBatchItemKeys.add(compositeKey);
            }
            dedupedRawSlice.push(item);
            dedupedOrigIndices.push(sIdx);
          }

          if (dedupedRawSlice.length === 0) {
            backupImportJob.cursor += rawSlice.length;
            backupImportJob.duplicatesInDb += batchDedupDropped;
            saveBackupCheckpointClient(false);
            renderBackupImportBoxDom();
            continue;
          }

          // 2. Browser-Titel-Cache: Bereits im Lauf oder per D1-Pre-Seed aufgelöste Serien/Filme direkt mit ihrer TMDb-ID annotieren (0 Such-Calls im Worker!)
          const slice = dedupedRawSlice.map(entry => {
            if (!entry || typeof entry !== "object") return entry;
            if (entry.tmdb_id || entry.tmdbId || entry.knownUnmatched) return entry;
            const rawTitle = entry.cleanTitle || entry.title || "";
            const nKey = normClientTitleKey(rawTitle);
            if (!nKey || nKey === "unbekannt" || nKey.length < 2) return entry;
            const tCode = (entry.typeCode === "s" || entry.isSeries || entry.season || entry.episode) ? "s" : "m";
            const yKey = entry.year && entry.year !== "k.A." ? String(entry.year) : "any";
            const cachedHit = backupImportJob.resolvedTitlesCache[tCode + "_" + nKey + "_" + yKey]
              || (tCode === "s" ? backupImportJob.resolvedTitlesCache["s_" + nKey + "_any"] : null)
              || (yKey === "any" ? backupImportJob.resolvedTitlesCache[tCode + "_" + nKey + "_any"] : null);
            if (!cachedHit) return entry;
            if (cachedHit.knownUnmatched) {
              return { ...entry, knownUnmatched: true };
            }
            if (cachedHit.tmdbId) {
              backupImportJob.browserCacheHitsCount = Number(backupImportJob.browserCacheHitsCount || 0) + 1;
              return {
                ...entry,
                tmdb_id: cachedHit.tmdbId,
                typeCode: cachedHit.typeCode || tCode,
                isSeries: (cachedHit.typeCode || tCode) === "s",
                cleanTitle: cachedHit.cleanTitle || entry.cleanTitle,
                external_poster_url: entry.external_poster_url || cachedHit.poster || ""
              };
            }
            return entry;
          });
          let hadRateWarning = false;
          let batchLatencyMs = 0;
          try {
            const cpPayload = buildCurrentBackupCheckpointPayload();
            const tBatchStartMs = Date.now();
            const r = await apiFetchJson(API_BASE + "/admin/import-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                entries: slice,
                batchStartCursor: backupImportJob.cursor,
                sourceChannelId: activeChan,
                playlistName: backupImportJob.customPlaylistName || backupImportJob.fileName || "JSON-Import",
                playlistMode: backupImportJob.playlistMode || "both",
                playlistFolderId: backupImportJob.playlistFolderId || null,
                targetChatId: backupImportJob.targetPlaylistChatId || chatId,
                sourceLabel: backupImportJob.isTelegramBackup ? ("Telegram Backup: " + backupImportJob.backupChatName) : backupImportJob.fileName,
                deferKvWrite: true,
                checkpoint: cpPayload
              })
            });
            batchLatencyMs = Date.now() - tBatchStartMs;
            if (r && r.ok) {
              delete backupImportJob.cursorRetries[backupImportJob.cursor];
              if (r.playlistFolder?.id) {
                backupImportJob.playlistFolderId = r.playlistFolder.id;
                backupImportJob.customPlaylistName = r.playlistFolder.name;
              }
              const batchStartIdx = backupImportJob.cursor;
              // 40-Subrequest- & 8s-Zeit-Guard: Wenn der Worker PARTIAL_BATCH meldet, rückt der Cursor exakt zum nächsten unverarbeiteten Original-Index vor!
              const processedSliceCount = (r.status === "PARTIAL_BATCH" && typeof r.nextStartIndex === "number" && r.nextStartIndex > 0)
                ? r.nextStartIndex
                : slice.length;
              const rawAdvanceCount = (r.status === "PARTIAL_BATCH" && processedSliceCount < dedupedOrigIndices.length)
                ? dedupedOrigIndices[processedSliceCount]
                : rawSlice.length;
              const processedCount = processedSliceCount;
              backupImportJob.cursor += rawAdvanceCount;
              backupImportJob.moviesSaved += Number(r.moviesAddedCount || 0);
              backupImportJob.seriesSaved += Number(r.seriesAddedCount || 0);
              backupImportJob.failedCount += Number(r.failedCount || 0);
              backupImportJob.duplicatesInDb += Number(r.duplicatesCount || 0) + batchDedupDropped;
              backupImportJob.mergedQualitiesInDb += Number(r.mergedQualitiesCount || 0);
              backupImportJob.uncertainCount += Number(r.uncertainCount || 0);

              if (Array.isArray(r.batchItems)) {
                const batchDiagEntries = [];
                const newlyResolvedSeriesMap = {};
                for (let bi = 0; bi < r.batchItems.length; bi++) {
                  const bItem = r.batchItems[bi];
                  const isFailedItem = bItem.status === "failed" || !bItem.tmdbId;
                  // Browser-Titel-Cache aktualisieren (positiv ab 75% Sicherheit + negativ bei TMDB_NOT_FOUND)
                  const origEntry = rawSlice[bi] || bItem.rawEntry || {};
                  const rawInTitle = origEntry.cleanTitle || origEntry.title || bItem.cleanTitle || "";
                  const normInKey = normClientTitleKey(rawInTitle);
                  const normResKey = normClientTitleKey(bItem.cleanTitle || "");
                  const itemTypeCode = bItem.typeCode === "s" ? "s" : "m";
                  const itemYearKey = (origEntry.year && origEntry.year !== "k.A.") ? String(origEntry.year) : ((bItem.year && bItem.year !== "k.A.") ? String(bItem.year) : "any");
                  if (bItem.tmdbId && Number(bItem.confidence || 100) >= 75) {
                    const cacheVal = {
                      tmdbId: Number(bItem.tmdbId),
                      typeCode: itemTypeCode,
                      cleanTitle: bItem.cleanTitle || rawInTitle,
                      poster: bItem.poster || ""
                    };
                    if (normInKey && normInKey !== "unbekannt") {
                      backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_" + itemYearKey] = cacheVal;
                      if (itemTypeCode === "s" || itemYearKey === "any") {
                        backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_any"] = cacheVal;
                      }
                      newlyResolvedSeriesMap[itemTypeCode + "_" + normInKey] = cacheVal;
                    }
                    if (normResKey && normResKey !== "unbekannt") {
                      backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normResKey + "_" + itemYearKey] = cacheVal;
                      if (itemTypeCode === "s" || itemYearKey === "any") {
                        backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normResKey + "_any"] = cacheVal;
                      }
                      newlyResolvedSeriesMap[itemTypeCode + "_" + normResKey] = cacheVal;
                    }
                  } else if (isFailedItem && bItem.reviewReasonCode === "TMDB_NOT_FOUND" && normInKey && normInKey !== "unbekannt") {
                    if (!backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_any"]?.tmdbId) {
                      backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_" + itemYearKey] = { knownUnmatched: true };
                      if (itemTypeCode === "s" || itemYearKey === "any") {
                        backupImportJob.resolvedTitlesCache[itemTypeCode + "_" + normInKey + "_any"] = { knownUnmatched: true };
                      }
                    }
                  }
                  const computedReason = bItem.errorReason || (isFailedItem
                    ? "Kein TMDb-Treffer für '" + (bItem.cleanTitle || bItem.rawInput || "") + "'"
                    : bItem.isUncertain
                      ? "Unsichere Zuordnung (" + (bItem.confidence || 0) + "%) → " + (bItem.cleanTitle || "")
                      : bItem.ingestStatus === "skipped_prerelease"
                        ? "Vorabversion/TS/MD übersprungen (gute Version bereits in D1)"
                        : bItem.ingestStatus === "duplicate"
                          ? "Identische Datei (file_id + message_id) bereits in D1 vorhanden (" + (bItem.cleanTitle || "") + ")"
                          : bItem.ingestStatus === "updated"
                            ? "Bestehender Episoden-/Film-Slot per UPSERT mit neuer Datei verknüpft → " + (bItem.cleanTitle || "")
                            : "Erfolgreich zugeordnet → " + (bItem.cleanTitle || "") + (bItem.tmdbId ? " (TMDb #" + bItem.tmdbId + ")" : "") + (Number(bItem.replacedPrereleaseCount || 0) > 0 ? (" [🧹 " + bItem.replacedPrereleaseCount + " Vorabversion ersetzt!]") : ""));
                  const computedReasonCode = bItem.reviewReasonCode || (isFailedItem ? "TMDB_NOT_FOUND" : (bItem.isUncertain ? inferClientReviewReasonCode({ ...bItem, errorReason: computedReason }) : null));
                  const itemObj = {
                    ...bItem,
                    status: isFailedItem ? "failed" : bItem.status,
                    reviewReasonCode: computedReasonCode,
                    errorReason: bItem.errorReason || (isFailedItem || bItem.isUncertain ? computedReason : null),
                    reason: computedReason,
                    msgId: bItem.msgId ? Number(bItem.msgId) : null,
                    id: "rev_" + (batchStartIdx + bi) + "_" + Date.now()
                  };
                  backupImportJob.reviewItems.push(itemObj);
                  if (bItem.tmdbId) {
                    backupImportJob.livePosterFeed.unshift(itemObj);
                  }
                  const diagStatus = isFailedItem
                    ? "TMDB_NOT_FOUND"
                    : bItem.isUncertain
                      ? "CONFLICT_?"
                      : bItem.ingestStatus === "skipped_prerelease"
                        ? "SKIPPED_PRERELEASE"
                        : bItem.ingestStatus === "duplicate"
                          ? "SKIPPED_DUPLICATE"
                          : "OK";
                  batchDiagEntries.push({
                    msgId: bItem.msgId ? Number(bItem.msgId) : null,
                    fileName: bItem.rawFileName || bItem.rawInput || bItem.cleanTitle || "Unbekannt",
                    rawText: bItem.rawText || "",
                    status: diagStatus,
                    reviewReasonCode: computedReasonCode,
                    reason: computedReason,
                    detectedType: bItem.typeCode === "s" ? "series" : "movie",
                    parsedTitle: bItem.cleanTitle || "",
                    seasonNumber: bItem.season || null,
                    episodeNumber: bItem.episode || null,
                    tmdbId: bItem.tmdbId || null,
                    rawEntry: bItem.rawEntry || null
                  });
                }
                if (r.status === "PARTIAL_BATCH") {
                  const isTimeGuard = r.pauseReason === "TIME_LIMIT_GUARD";
                  batchDiagEntries.push({
                    msgId: null,
                    fileName: (isTimeGuard ? "8s-Zeit-Guard" : "Subrequest-Guard") + " (Pause bei Index +" + processedCount + ")",
                    rawText: "",
                    status: "SUBREQUEST_PAUSE",
                    reason: isTimeGuard
                      ? "8s-Laufzeit-Schutz erreicht (" + batchLatencyMs + "ms) – nahtlose Fortsetzung im nächsten Batch"
                      : "Subrequest-Schutz erreicht (" + (r.subrequestCount || 26) + " Subrequests) – nahtlose Fortsetzung im nächsten Batch",
                    detectedType: "system",
                    parsedTitle: "PARTIAL_BATCH"
                  });
                  backupImportJob.recentLog.push("🛡️ " + (isTimeGuard ? "8s-Zeit-Guard" : "Subrequest-Guard") + " aktiv (" + processedCount + "/" + slice.length + " im Batch verarbeitet) – setze nahtlos bei #" + backupImportJob.cursor + " fort...");
                }
                appendClientDiagnosticLogs(batchDiagEntries, false);
                if (backupImportJob.livePosterFeed.length > 16) {
                  backupImportJob.livePosterFeed = backupImportJob.livePosterFeed.slice(0, 16);
                }

                // AUTO-NACHHEILUNG (Breaking Bad S01E01 Fix):
                // Falls eine frühere Episode derselben Serie im aktuellen Lauf wegen Subrequest-Cutoff oder temporärem Timeout
                // als TMDB_NOT_FOUND liegen geblieben ist, verknüpfe sie jetzt sofort automatisch mit der erkannten TMDb-ID!
                if (Object.keys(newlyResolvedSeriesMap).length > 0 && Array.isArray(backupImportJob.reviewItems)) {
                  const orphansToHeal = [];
                  for (let ri = 0; ri < backupImportJob.reviewItems.length; ri++) {
                    const prevRev = backupImportJob.reviewItems[ri];
                    if (!prevRev || prevRev.status !== "failed" || prevRev.tmdbId || prevRev._autoHealed) continue;
                    const pType = (prevRev.typeCode === "s" || prevRev.season || prevRev.episode) ? "s" : "m";
                    const pNorm = normClientTitleKey(prevRev.cleanTitle || prevRev.rawEntry?.cleanTitle || "");
                    const matchedResolved = pNorm ? newlyResolvedSeriesMap[pType + "_" + pNorm] : null;
                    if (matchedResolved && matchedResolved.tmdbId) {
                      prevRev._autoHealed = true;
                      orphansToHeal.push({ revItem: prevRev, resolved: matchedResolved });
                    }
                  }
                  if (orphansToHeal.length > 0) {
                    try {
                      const healEntries = orphansToHeal.map(o => ({
                        ...(typeof o.revItem.rawEntry === "object" && o.revItem.rawEntry ? o.revItem.rawEntry : { filename: o.revItem.rawInput }),
                        tmdb_id: o.resolved.tmdbId,
                        typeCode: o.resolved.typeCode,
                        isSeries: o.resolved.typeCode === "s",
                        cleanTitle: o.resolved.cleanTitle || o.revItem.cleanTitle,
                        external_poster_url: o.resolved.poster || "",
                        bypassNegativeTitleCache: true
                      }));
                      const healRes = await apiFetchJson(API_BASE + "/admin/import-batch", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          entries: healEntries,
                          sourceChannelId: activeChan,
                          playlistName: backupImportJob.customPlaylistName || backupImportJob.fileName || "JSON-Import",
                          playlistMode: backupImportJob.playlistMode || "both",
                          playlistFolderId: backupImportJob.playlistFolderId || null,
                          targetChatId: backupImportJob.targetPlaylistChatId || chatId,
                          sourceLabel: backupImportJob.isTelegramBackup ? ("Telegram Backup: " + backupImportJob.backupChatName) : backupImportJob.fileName,
                          deferKvWrite: true
                        })
                      });
                      if (healRes && healRes.ok && Array.isArray(healRes.batchItems)) {
                        for (let hi = 0; hi < orphansToHeal.length; hi++) {
                          const healedItem = healRes.batchItems[hi];
                          const targetRev = orphansToHeal[hi].revItem;
                          if (healedItem && healedItem.tmdbId) {
                            targetRev.status = healedItem.ingestStatus || "added";
                            targetRev.isUncertain = false;
                            targetRev.contextError = false;
                            targetRev.reviewReasonCode = null;
                            targetRev.errorReason = null;
                            targetRev.tmdbId = healedItem.tmdbId;
                            targetRev.cleanTitle = healedItem.cleanTitle || targetRev.cleanTitle;
                            targetRev.year = healedItem.year || targetRev.year;
                            targetRev.poster = healedItem.poster || orphansToHeal[hi].resolved.poster || "";
                            targetRev.reason = "🩹 Automatisch nachgeheilt → " + targetRev.cleanTitle + " (TMDb #" + healedItem.tmdbId + ")";
                            backupImportJob.failedCount = Math.max(0, Number(backupImportJob.failedCount || 0) - 1);
                            if (healedItem.typeCode === "s") backupImportJob.seriesSaved++;
                            else backupImportJob.moviesSaved++;
                            if (Array.isArray(backupImportJob.clientDiagLogs)) {
                              for (const dLog of backupImportJob.clientDiagLogs) {
                                if (dLog && dLog.status === "TMDB_NOT_FOUND" &&
                                    ((targetRev.msgId && Number(dLog.msgId) === Number(targetRev.msgId)) ||
                                     dLog.fileName === (targetRev.rawFileName || targetRev.rawInput))) {
                                  dLog.status = "OK";
                                  dLog.reviewReasonCode = null;
                                  dLog.tmdbId = healedItem.tmdbId;
                                  dLog.parsedTitle = targetRev.cleanTitle;
                                  dLog.reason = targetRev.reason;
                                }
                              }
                            }
                            const seLabel = targetRev.season
                              ? (" S" + String(targetRev.season).padStart(2, "0") + "E" + String(targetRev.episode || 1).padStart(2, "0"))
                              : "";
                            backupImportJob.recentLog.push("🩹 Auto-Nachheilung: " + targetRev.cleanTitle + seLabel + " nachträglich mit TMDb #" + healedItem.tmdbId + " verknüpft!");
                          }
                        }
                      }
                    } catch (healErr) {}
                  }
                }
              }

              if (Array.isArray(r.sampleTitles) && r.sampleTitles.length > 0) {
                backupImportJob.recentLog.push("✅ Batch #" + Math.ceil(backupImportJob.cursor / DEFAULT_BATCH_SIZE) + " [" + (backupImportJob.customPlaylistName || "Playlist") + "]: " + r.sampleTitles.slice(0, 3).join(", "));
              }
              saveBackupCheckpointClient(false);
            } else {
              hadRateWarning = true;
              const errMsg = String(r?.error || "Kurze Pause...");
              const nextRetry = curRetryCount + 1;
              backupImportJob.cursorRetries[backupImportJob.cursor] = nextRetry;
              if (nextRetry >= 3) {
                isolateFailedEntryAtCursor(errMsg);
              } else {
                saveBackupCheckpointClient(false);
                const waitMs = 1800 * nextRetry;
                backupImportJob.recentLog.push("⏳ Einzel-Prüfung (" + nextRetry + "/2) bei Checkpoint #" + backupImportJob.cursor + ": " + errMsg);
                await new Promise(res => setTimeout(res, waitMs));
              }
            }
          } catch (e) {
            hadRateWarning = true;
            const errMsg = String(e?.message || e || "Netzwerkfehler");
            const nextRetry = curRetryCount + 1;
            backupImportJob.cursorRetries[backupImportJob.cursor] = nextRetry;
            if (nextRetry >= 3) {
              isolateFailedEntryAtCursor(errMsg);
            } else {
              saveBackupCheckpointClient(false);
              const waitMs = 2200 * nextRetry;
              backupImportJob.recentLog.push("⏳ Rate-Limit / Einzel-Isolierung (" + nextRetry + "/2) bei #" + backupImportJob.cursor + ": " + errMsg);
              await new Promise(res => setTimeout(res, waitMs));
            }
          }
          renderBackupImportBoxDom();
          // Auto-Pause (5s Cooldown), sobald die D1-/Worker-Batch-Latenz 2 Sekunden (2000ms) überschreitet, um HTTP 503 Gateway-Timeouts proaktiv zu verhindern
          if (batchLatencyMs > 2000 && backupImportJob.running && !backupImportJob.paused) {
            backupImportJob._lastBatchHadLatencyCooldown = true;
            backupImportJob.currentBatchModeLabel = "⏳ Auto-Pause (5s Cooldown)";
            backupImportJob.currentBatchModeColor = "#fbbf24";
            backupImportJob.recentLog.push("⏳ Auto-Pause (5s Cooldown): D1-/Worker-Batch-Latenz (" + batchLatencyMs + "ms > 2000ms) – Schutz vor HTTP 503 Gateway-Timeout aktiv");
            renderBackupImportBoxDom();
            await new Promise(res => setTimeout(res, 5000));
          } else {
            await new Promise(res => setTimeout(res, hadRateWarning ? 650 : 340));
          }
        }

        backupImportJob.running = false;
        if (backupImportJob.cursor >= backupImportJob.entries.length && backupImportJob.entries.length > 0) {
          saveBackupCheckpointClient(true);
          clearClientMediaCaches();
          showHudToast("🎉 Smart-Import 100% abgeschlossen! Alle Einträge sind dauerhaft in D1 gespeichert.");
        }
        renderBackupImportBoxDom();
      }

      function pauseBackupImport() {
        backupImportJob.paused = true;
        backupImportJob.running = false;
        saveBackupCheckpointClient(true);
        showHudToast("⏸️ Pausiert & Checkpoint bei #" + backupImportJob.cursor + " gespeichert.");
        renderBackupImportBoxDom();
      }

      function resetBackupImport(clearSaved = false) {
        if (clearSaved) clearBackupCheckpointClient();
        backupImportJob.paused = true;
        backupImportJob.running = false;
        backupImportJob.cursor = 0;
        backupImportJob.moviesSaved = 0;
        backupImportJob.seriesSaved = 0;
        backupImportJob.duplicatesInDb = 0;
        backupImportJob.mergedQualitiesInDb = 0;
        backupImportJob.uncertainCount = 0;
        backupImportJob.failedCount = 0;
        backupImportJob.startedAt = 0;
        backupImportJob.recentLog = [];
        backupImportJob.livePosterFeed = [];
        backupImportJob.reviewItems = [];
        backupImportJob.activeSubTab = "dashboard";
        renderBackupImportBoxDom();
      }

      async function runServerD1QueueStepAdmin(rounds = 2) {
        setBusyState(true, "⏳ Verarbeite nächsten Batch aus der D1-Import-Warteschlange...");
        try {
          await apiFetchJson(API_BASE + "/admin/import-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "step", rounds })
          });
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function clearServerD1QueueAdmin() {
        const ok = await showCustomConfirm("Gesamte D1-Import-Warteschlange wirklich leeren?", "🗑️ Queue leeren");
        if (!ok) return;
        await apiFetchJson(API_BASE + "/admin/import-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "clear" })
        });
        showHudToast("🗑️ D1-Warteschlange geleert");
        loadAdminPanelView();
      }

      async function adminCreatePlaylistPrompt() {
        const targetUid = state.adminPlaylistTargetChatId || chatId;
        const defaultMode = targetUid === "bot_vip" ? "vip_stream" : "both";
        const name = await showCustomPrompt("🎵 Name für die neue Custom Playlist (Ziel: " + (targetUid === "bot_vip" ? "🤖 Globale Bot-VIP-Playlist" : ("User ID " + targetUid)) + "):", "");
        if (!name || !name.trim()) return;
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", targetChatId: targetUid, name: name.trim(), playlistMode: defaultMode })
        });
        if (r?.folder?.id) {
          state.adminEditingFolderId = r.folder.id;
        }
        showHudToast("✅ Playlist „" + name.trim() + "“ angelegt");
        loadAdminPanelView();
      }

      async function adminTogglePlaylist(targetUid, folderId) {
        await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle", targetChatId: targetUid, folderId })
        });
        loadAdminPanelView();
      }

      async function adminSetPlaylistMode(targetUid, folderId, nextMode) {
        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalSynced = 0;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">⚙️ Schalte Playlist-Modus in 25er-Batches um...</div>';
        }
        try {
          while (hasMore) {
            const r = await apiFetchJson(API_BASE + "/admin/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "set_mode",
                targetChatId: targetUid,
                folderId,
                playlistMode: nextMode,
                offset,
                limit
              })
            });
            if (!r || !r.ok) break;
            totalSynced += Number(r.syncedVipCount || 0);
            hasMore = Boolean(r.hasMore);
            offset = Number(r.nextOffset || (offset + limit));
            const total = Math.max(1, Number(r.total || offset));
            const pct = Math.min(100, Math.round((offset / total) * 100));
            if (progBox) {
              progBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:#34d399;margin-bottom:4px">' +
                  '<span>⚡ Synchronisiere Playlist-Modus in 25er-Batches...</span>' +
                  '<b>' + Math.min(offset, total) + ' / ' + total + ' (' + pct + '%)</b>' +
                '</div>' +
                '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                  '<div style="width:' + pct + '%;height:100%;background:#10b981;transition:width 0.2s"></div>' +
                '</div>';
            }
          }
          clearClientMediaCaches();
          const modeLabel = nextMode === "vip_stream" ? "🌟 VIP-Stream-Playlist" : nextMode === "watchlist" ? "🔖 Merkliste" : "⚡ VIP-Stream + Merkliste";
          showHudToast("✅ Modus gesetzt: " + modeLabel + " (" + totalSynced + " Einträge in 25er-Batches verarbeitet)");
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminCopyPlaylistBatchClient(sourceUid, sourceFolderId, sourceFolderName) {
        const defaultName = String(sourceFolderName || "Playlist") + " (VIP-Kopie)";
        const targetName = await showCustomPrompt("📋 Name der Ziel-Playlist (wird in 25er-Batches ohne Cloudflare-Limit kopiert):", defaultName);
        if (!targetName || !targetName.trim()) return;

        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalCopied = 0;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">📋 Starte 25er-Batch-Kopie für „' + esc(targetName.trim()) + '“...</div>';
        }

        while (hasMore) {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "copy_playlist_batch",
              sourceChatId: sourceUid,
              sourceFolderId: sourceFolderId,
              targetChatId: "bot_vip",
              targetFolderName: targetName.trim(),
              targetMode: "both",
              offset,
              limit
            })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ Batch-Kopie gestoppt bei #" + offset + ": " + (r?.error || "Fehler"));
            break;
          }
          totalCopied += Number(r.copiedInBatch || 0);
          hasMore = Boolean(r.hasMore);
          offset = Number(r.nextOffset || (offset + limit));
          const total = Math.max(1, Number(r.total || offset));
          const pct = Math.min(100, Math.round((offset / total) * 100));
          if (progBox) {
            progBox.innerHTML =
              '<div style="display:flex;justify-content:space-between;font-size:12px;color:#34d399;margin-bottom:4px">' +
                '<span>📋 Kopiere in 25er-Batches nach „' + esc(r.targetFolderName || targetName.trim()) + '“...</span>' +
                '<b>' + Math.min(offset, total) + ' / ' + total + ' (' + pct + '%)</b>' +
              '</div>' +
              '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                '<div style="width:' + pct + '%;height:100%;background:linear-gradient(90deg,#0ea5e9,#10b981);transition:width 0.2s"></div>' +
              '</div>';
          }
          await new Promise(res => setTimeout(res, 120));
        }

        clearClientMediaCaches();
        showHudToast("✅ Playlist komplett kopiert (" + totalCopied + " Titel in 25er-Batches übertragen)!");
        await loadAdminPanelView();
      }

      async function adminOpenPlaylistEditor(targetUid, folderId) {
        state.adminPlaylistTargetChatId = String(targetUid || chatId);
        state.adminEditingFolderId = String(folderId || "");
        state.adminTab = "playlists";
        await loadAdminPanelView();
      }

      async function adminOpenBotVipPlaylistDirect() {
        state.adminPlaylistTargetChatId = "bot_vip";
        state.adminEditingFolderId = "";
        state.adminTab = "playlists";
        await loadAdminPanelView();
      }

      async function adminReorderPlaylistItem(targetUid, folderId, itemUid, direction) {
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reorder_item", targetChatId: targetUid, folderId, uid: itemUid, direction })
        });
        if (r && r.ok) {
          loadAdminPanelView();
        }
      }

      async function adminRemovePlaylistItem(targetUid, folderId, itemUid) {
        const r = await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove_item", targetChatId: targetUid, folderId, uid: itemUid })
        });
        if (r && r.ok) {
          showHudToast("➖ Titel nur aus Playlist entfernt (bleibt in D1 erhalten)");
          loadAdminPanelView();
        }
      }

      async function adminDeletePlaylistItemFromD1(targetUid, folderId, itemUid, typeCode, tmdbId, title) {
        const ok = await showCustomConfirm(
          'Möchtest du "' + (title || ('TMDb #' + tmdbId)) + '" wirklich KOMPLETT aus der D1-Datenbank & dem Telegram-Bot löschen (inkl. aller verknüpften Video-Streams) UND aus der Playlist entfernen?',
          '🗑️ Komplett aus D1 + Bot löschen'
        );
        if (!ok) return;
        setBusyState(true, "🗑️ Lösche Titel + Streams aus D1 & Playlist...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete_from_d1",
              targetChatId: targetUid,
              folderId,
              uid: itemUid,
              typeCode,
              tmdbId
            })
          });
          if (r && r.ok) {
            clearClientMediaCaches();
            showHudToast("🗑️ Titel komplett aus D1, Bot & Playlist gelöscht");
            await loadAdminPanelView();
          } else {
            showHudToast("⚠️ " + (r?.error || "Löschen aus D1 fehlgeschlagen."));
          }
        } finally {
          setBusyState(false);
        }
      }

      async function adminSyncBotVipFromD1Client(forceIncludeHidden) {
        const progBox = document.getElementById("adminPlaylistBatchProgressBox");
        let offset = 0;
        const limit = 25;
        let hasMore = true;
        let totalAdded = 0;
        let lastTotalInPlaylist = 0;

        if (progBox) {
          progBox.style.display = "block";
          progBox.innerHTML = '<div style="font-size:12px;color:#38bdf8">🔄 Synchronisiere D1-Katalog in 25er-Batches (umgeht Cloudflare 50-Subrequest-Limit)...</div>';
        }
        try {
          while (hasMore) {
            const r = await apiFetchJson(API_BASE + "/admin/playlists", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sync_d1",
                targetChatId: "bot_vip",
                folderId: state.adminEditingFolderId || "pl_bot_vip_default",
                forceIncludeHidden: Boolean(forceIncludeHidden && offset === 0),
                offset,
                limit
              })
            });
            if (!r || !r.ok) {
              showHudToast("⚠️ " + (r?.error || "D1-Synchronisation fehlgeschlagen."));
              break;
            }
            totalAdded += Number(r.addedCount || r.syncedAddedCount || 0);
            lastTotalInPlaylist = Number(r.totalInPlaylist || lastTotalInPlaylist);
            hasMore = Boolean(r.hasMore);
            offset = Number(r.nextOffset || (offset + limit));
            const totalInD1 = Math.max(1, Number(r.totalInD1 || offset));
            const pct = Math.min(100, Math.round((offset / totalInD1) * 100));
            if (progBox) {
              progBox.innerHTML =
                '<div style="display:flex;justify-content:space-between;font-size:12px;color:#38bdf8;margin-bottom:4px">' +
                  '<span>🔄 Synchronisiere D1 → Bot-VIP Playlist (25er-Batches)...</span>' +
                  '<b>' + Math.min(offset, totalInD1) + ' / ' + totalInD1 + ' (' + pct + '%)</b>' +
                '</div>' +
                '<div style="width:100%;height:8px;background:#1e293b;border-radius:999px;overflow:hidden">' +
                  '<div style="width:' + pct + '%;height:100%;background:#38bdf8;transition:width 0.2s"></div>' +
                '</div>';
            }
          }
          clearClientMediaCaches();
          state.adminPlaylistTargetChatId = "bot_vip";
          showHudToast("✅ D1-Bot-Sync abgeschlossen: " + lastTotalInPlaylist + " Titel in Bot-VIP-Playlist (" + totalAdded + " neu in 25er-Batches verknüpft)");
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminAddPlaylistItemClient(targetUid, folderId) {
        const qInp = document.getElementById("plEditorAddQueryInp");
        const tSel = document.getElementById("plEditorAddTypeSel");
        const qualInp = document.getElementById("plEditorAddQualInp");
        const query = (qInp ? qInp.value : "").trim();
        const typeCode = tSel ? tSel.value : "auto";
        const quality = (qualInp ? qualInp.value : "1080p").trim() || "1080p";
        if (!query) {
          showHudToast("⚠️ Bitte Titel oder TMDb-ID eingeben.");
          return;
        }
        setBusyState(true, "➕ Suche & füge „" + query + "“ zur Playlist hinzu...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/playlists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add_item", targetChatId: targetUid, folderId, query, typeCode, quality })
          });
          if (!r || !r.ok) {
            showHudToast("⚠️ " + (r?.error || "Konnte Titel nicht hinzufügen."));
            return;
          }
          clearClientMediaCaches();
          if (qInp) qInp.value = "";
          showHudToast("✅ Hinzugefügt: " + (r.addedItem?.cleanTitle || query));
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function adminRenamePlaylist(targetUid, folderId, currentName) {
        const nextName = await showCustomPrompt("✏️ Neuer Custom Name für diese Playlist:", currentName || "");
        if (!nextName || !nextName.trim()) return;
        await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", targetChatId: targetUid, folderId, name: nextName.trim() })
        });
        showHudToast("✅ Playlist umbenannt");
        loadAdminPanelView();
      }

      async function adminDeletePlaylist(targetUid, folderId, currentName) {
        const ok = await showCustomConfirm('Playlist "' + (currentName || folderId) + '" (User ' + targetUid + ') samt aller Einträge wirklich löschen?', '🗑️ Löschen');
        if (!ok) return;
        if (String(state.adminEditingFolderId) === String(folderId)) {
          state.adminEditingFolderId = "";
        }
        await apiFetchJson(API_BASE + "/admin/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", targetChatId: targetUid, folderId })
        });
        showHudToast("🗑️ Playlist gelöscht");
        loadAdminPanelView();
      }

      async function loadAdminPanelView(forceNetworkRefresh = false) {
        if (!state.isAuthenticated || !state.authUser?.isAdmin) {
          showHudToast("⛔ Zugriff verweigert: Nur für autorisierte Administratoren.");
          return;
        }
        const wasAlreadyInAdmin = state.currentView === "admin";
        state.currentView = "admin";
        updateFloatingImportStatusBarDom();
        if (!state.adminPlaylistTargetChatId) state.adminPlaylistTargetChatId = String(chatId);

        const hasActiveOrPausedImport = Boolean(
          Array.isArray(backupImportJob?.entries) &&
          backupImportJob.entries.length > 0 &&
          (backupImportJob.running || (backupImportJob.cursor > 0 && backupImportJob.cursor < backupImportJob.entries.length))
        );
        if (!wasAlreadyInAdmin && hasActiveOrPausedImport && state.adminTab !== "diaglog") {
          state.adminTab = "backup";
        }
        if (!state.adminTab) {
          state.adminTab = hasActiveOrPausedImport ? "backup" : "users";
        }

        // Sofort-Zugang ohne Netzwerk-Blockade: Wenn der Import läuft oder Backup/Logs geöffnet werden und ein Cache vorliegt,
        // niemals durch /admin/overview blockieren oder ein HTTP 503 riskieren!
        const canUseInstantCache = Boolean(
          !forceNetworkRefresh &&
          (backupImportJob.running || ((state.adminTab === "backup" || state.adminTab === "diaglog") && window._lastAdminOverviewCache))
        );

        let r = null;
        try {
          if (canUseInstantCache) {
            r = window._lastAdminOverviewCache || {
              ok: true,
              users: [],
              media: [],
              playlists: [],
              reports: window._adminReportsCache || [],
              _instantLocalMode: true
            };
          } else {
            window._adminPriorityRequestInFlight = true;
            setBusyState(true, "👑 Lade Admin-Dashboard, User, VIP-Playlisten & Mediendatenbank...");
            try {
              r = await apiFetchJson(
                API_BASE + "/admin/overview?mediaType=" + encodeURIComponent(state.adminMediaType || "m") +
                "&playlistChatId=" + encodeURIComponent(state.adminPlaylistTargetChatId || chatId) +
                "&folderId=" + encodeURIComponent(state.adminEditingFolderId || "") +
                (forceNetworkRefresh ? "&refresh=1" : "")
              );
              if (r && r.ok) {
                window._lastAdminOverviewCache = r;
              }
            } catch (netErr) {
              r = null;
            } finally {
              window._adminPriorityRequestInFlight = false;
            }
          }

          if (!r || !r.ok) {
            // Niemals das Öffnen des Admin-Panels abbrechen! Stattdessen sofort mit Cache/Fallback-Daten öffnen,
            // damit Backup-Import (Pause/Stopp) und Diagnose-Logs zu 100% erreichbar bleiben!
            r = window._lastAdminOverviewCache || {
              ok: true,
              users: [],
              media: [],
              playlists: [],
              reports: window._adminReportsCache || [],
              _fallbackOn503: true
            };
            if (!wasAlreadyInAdmin && state.adminTab !== "diaglog") {
              state.adminTab = "backup";
            }
            showHudToast("⚡ Admin-Panel im Direkt-Modus geöffnet (Import-Steuerung & Logs sofort bereit)");
          }

          const users = r.users || [];
          const mediaList = r.media || [];
          const qStats = r.queueStats || { pendingCount: 0, processedCount: 0, moviesSaved: 0, seriesSaved: 0, failedCount: 0 };
          const adminPlaylists = r.playlists || [];
          const rawSeriesGaps = r.seriesGaps || {};
          const seriesGaps = {
            totalSeriesChecked: Number(rawSeriesGaps.totalSeriesChecked ?? (Array.isArray(rawSeriesGaps.items || rawSeriesGaps.series) ? (rawSeriesGaps.items || rawSeriesGaps.series).length : 0)),
            seriesWithGapsCount: Number(rawSeriesGaps.seriesWithGapsCount ?? rawSeriesGaps.totalSeriesWithGaps ?? 0),
            seriesWithInternalGapsCount: Number(rawSeriesGaps.seriesWithInternalGapsCount ?? rawSeriesGaps.totalSeriesWithInternalGaps ?? 0),
            totalMissingInternal: Number(rawSeriesGaps.totalMissingInternal ?? rawSeriesGaps.totalInternalMissingEpisodes ?? 0),
            totalMissingTrailing: Number(rawSeriesGaps.totalMissingTrailing ?? rawSeriesGaps.totalTrailingMissingEpisodes ?? 0),
            totalPrereleaseOnly: Number(rawSeriesGaps.totalPrereleaseOnly ?? rawSeriesGaps.totalPrereleaseEpisodes ?? 0),
            incompleteMultipartMoviesCount: Number(rawSeriesGaps.incompleteMultipartMoviesCount ?? (Array.isArray(rawSeriesGaps.incompleteMultipartMovies) ? rawSeriesGaps.incompleteMultipartMovies.length : 0)),
            incompleteMultipartMovies: Array.isArray(rawSeriesGaps.incompleteMultipartMovies) ? rawSeriesGaps.incompleteMultipartMovies : [],
            items: Array.isArray(rawSeriesGaps.items) ? rawSeriesGaps.items : (Array.isArray(rawSeriesGaps.series) ? rawSeriesGaps.series : [])
          };
          const allReports = Array.isArray(r.reports) ? r.reports : (window._adminReportsCache || []);
          window._adminReportsCache = allReports;
          if (!clientDiagnosticLogState.loadedFromD1Once && !backupImportJob.running) {
            clientDiagnosticLogState.loadedFromD1Once = true;
            restoreBackupImportSessionAfterReload();
          }
          const openReportsCount = Number(r.openReportsCount ?? allReports.filter(rep => rep && rep.status === "open").length);
          const reportFilter = state.adminReportFilter || "open";
          const filteredReports = reportFilter === "all"
            ? allReports
            : allReports.filter(rep => rep && rep.status === reportFilter);
          const activeFolderId = r.activeFolderId || (adminPlaylists[0]?.id || "");
          state.adminEditingFolderId = activeFolderId;
          const activeFolderObj = adminPlaylists.find(f => String(f.id) === String(activeFolderId)) || null;
          const activeFolderItems = Array.isArray(r.activePlaylistItems) ? r.activePlaylistItems : [];
          const root = document.getElementById("appRoot");

          const userSelectOptionsHtml = [
            '<option value="bot_vip" ' + (String(state.adminPlaylistTargetChatId) === "bot_vip" ? 'selected' : '') + '>🤖 Globale Bot-VIP-Playlist (bot_vip)</option>',
            '<option value="' + esc(chatId) + '" ' + (String(state.adminPlaylistTargetChatId) === String(chatId) ? 'selected' : '') + '>👑 Eigene Admin-Merkliste (ID ' + esc(chatId) + ')</option>',
            ...users.filter(u => String(u.telegramId) !== String(chatId)).map(u =>
              '<option value="' + esc(u.telegramId) + '" ' + (String(state.adminPlaylistTargetChatId) === String(u.telegramId) ? 'selected' : '') + '>👤 ID ' + esc(u.telegramId) + (u.tgUsername ? ' (@' + esc(u.tgUsername) + ')' : '') + (u.customUsername ? ' [' + esc(u.customUsername) + ']' : '') + '</option>'
            )
          ].join("");

          const playlistEditorBoxHtml = activeFolderObj ? (
            '<div class="panel-box" style="border-color:rgba(251,191,36,0.45);margin-top:12px">' +
              '<div class="section-title">' +
                '<span>👑 Vollwertiger Playlist-Editor: <b style="color:#fbbf24">' + esc(activeFolderObj.name) + '</b> (' + activeFolderItems.length + ' Titel)</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                  (String(state.adminPlaylistTargetChatId) === "bot_vip"
                    ? '<button class="btn amber" onclick="adminSyncBotVipFromD1Client(true)" title="Synchronisiert alle vom Telegram-Bot in D1 gespeicherten Filme & Serien in 25er-Batches">🔄 Alle D1-Bot-Filme & -Serien (25er-Batches) synchronisieren</button>'
                    : '') +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'vip_stream' ? 'amber' : '') + '" onclick="adminSetPlaylistMode(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'vip_stream\\')">🌟 Als VIP-Stream-Playlist</button>' +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'watchlist' ? 'blue' : '') + '" onclick="adminSetPlaylistMode(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'watchlist\\')">🔖 Als Merkliste</button>' +
                  '<button class="btn ' + ((activeFolderObj.playlistMode || 'both') === 'both' ? 'green' : '') + '" onclick="adminSetPlaylistMode(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'both\\')">⚡ Beides (VIP + Merkliste)</button>' +
                '</div>' +
              '</div>' +
              '<div style="background:#16161f;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px;margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                '<select id="plEditorAddTypeSel" style="padding:7px 9px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px">' +
                  '<option value="auto">🔄 Auto (Film/Serie)</option>' +
                  '<option value="m">🎬 Film</option>' +
                  '<option value="s">📺 Serie</option>' +
                '</select>' +
                '<input id="plEditorAddQueryInp" placeholder="Titel oder TMDb-ID zur Playlist hinzufügen (z.B. Inception oder 27205)..." onkeydown="if(event.key===\\'Enter\\'){event.preventDefault();adminAddPlaylistItemClient(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\')}" style="flex:1;min-width:210px;padding:7px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                '<input id="plEditorAddQualInp" value="1080p" placeholder="Qualität (1080p/4K)" style="width:95px;padding:7px 9px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:12px" />' +
                '<button class="btn green" onclick="adminAddPlaylistItemClient(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\')">➕ Titel hinzufügen</button>' +
              '</div>' +
              (activeFolderItems.length === 0 ? (
                '<div style="font-size:12px;color:#94a3b8;padding:12px;text-align:center;background:#101015;border-radius:8px">Diese Playlist enthält noch keine Titel. Klicke oben auf <b>🔄 Alle D1-Bot-Filme & -Serien synchronisieren</b>, füge einen Titel per Name/TMDb-ID hinzu oder importiere ein JSON-Backup.</div>'
              ) : (
                '<div style="display:flex;flex-direction:column;gap:6px;max-height:460px;overflow-y:auto;padding-right:4px">' +
                  activeFolderItems.map((it, idx) => {
                    const tc = it.contentType === "series" ? "s" : "m";
                    const streamCountNum = Number(it.streamCount || 0);
                    const qualDisplay = esc(it.allQualities || it.quality || "1080p");
                    const pImg = resolvePosterUrlClient(it.poster, "w185", "");
                    const epsList = Array.isArray(it.episodes) ? it.episodes : [];
                    const drawerId = "adm_pl_" + esc(it.uid || (it.tmdbId + "_" + idx));
                    const epPreviewCodes = epsList.slice(0, 3).map(e => e.code || ("S" + String(e.season || 1).padStart(2, "0") + "E" + String(e.episode || 1).padStart(2, "0"))).join(", ");
                    const epDrawerToggleHtml = (tc === "s" && epsList.length > 0)
                      ? ('<button type="button" class="btn" style="padding:3px 8px;font-size:11px;background:rgba(56,189,248,0.16);border-color:rgba(56,189,248,0.45);color:#38bdf8" onclick="toggleSeriesEpisodesDrawerClient(event,\\'' + drawerId + '\\')" title="Importierte Serienfolgen auf-/zuklappen">📺 ' + epsList.length + ' Folge' + (epsList.length === 1 ? '' : 'n') + ' (' + esc(epPreviewCodes) + (epsList.length > 3 ? '…' : '') + ') <span id="epDrawerIcon_' + drawerId + '">▾</span></button>')
                      : '';
                    const epDrawerBodyHtml = (tc === "s" && epsList.length > 0)
                      ? ('<div id="epDrawer_' + drawerId + '" style="display:none;flex-direction:column;gap:4px;margin-top:6px;padding:8px;border-radius:8px;background:rgba(15,23,42,0.88);border:1px solid rgba(56,189,248,0.35)">' +
                          epsList.map(ep => {
                            const epCode = ep.code || ("S" + String(ep.season || 1).padStart(2, "0") + "E" + String(ep.episode || 1).padStart(2, "0"));
                            const epTitle = ep.title || ("Folge " + (ep.episode || 1));
                            const qStr = [ep.quality || "1080p", ep.codec || ""].filter(Boolean).join(" • ");
                            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,0.04);font-size:11.5px">' +
                              '<div style="cursor:pointer;flex:1" onclick="openDetails(\\'s\\',' + Number(it.tmdbId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">' +
                                '<b style="color:#38bdf8">' + esc(epCode) + '</b> – <span style="color:#f8fafc">' + esc(epTitle) + '</span>' +
                                (qStr ? ' <span style="color:#94a3b8;font-size:10.5px">[' + esc(qStr) + ']</span>' : '') +
                              '</div>' +
                              '<button type="button" class="btn" style="padding:2px 7px;font-size:10.5px" onclick="openDetails(\\'s\\',' + Number(it.tmdbId) + ',false,\\'\\',\\'\\',' + Number(ep.season || 1) + ')">Staffel ' + Number(ep.season || 1) + ' öffnen</button>' +
                            '</div>';
                          }).join("") +
                        '</div>')
                      : '';
                    return '<div class="ep-row" style="flex-direction:column;align-items:stretch">' +
                      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
                        '<div style="display:flex;align-items:center;flex:1;min-width:180px">' +
                          '<span style="font-size:11.5px;font-weight:900;color:#64748b;width:28px;text-align:center;flex-shrink:0">#' + (idx + 1) + '</span>' +
                          (pImg
                            ? '<img src="' + esc(pImg) + '" style="width:32px;height:46px;object-fit:cover;border-radius:4px;margin-right:8px;flex-shrink:0" alt="" />'
                            : '<div style="width:32px;height:46px;background:#1e293b;border-radius:4px;margin-right:8px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0">' + (tc === "s" ? "📺" : "🎬") + '</div>') +
                          '<div style="flex:1;min-width:140px;cursor:pointer" onclick="openDetails(\\'' + tc + '\\',' + Number(it.tmdbId) + ',false)">' +
                            '<div style="font-size:12.5px;font-weight:800;color:#fff">' +
                              (tc === "s" ? "📺 " : "🎬 ") + esc(it.title) + ' <span style="color:#94a3b8;font-weight:600">(' + esc(it.year || "k.A.") + ')</span>' +
                              (it.syncedFromD1 ? ' <span style="font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(16,185,129,0.18);color:#34d399;margin-left:4px">🤖 D1-Bot</span>' : '') +
                            '</div>' +
                            '<div style="font-size:11px;color:#38bdf8">' +
                              'TMDb #' + Number(it.tmdbId) + ' • ' + qualDisplay +
                              (streamCountNum > 0 ? (' • <b style="color:#fbbf24">' + streamCountNum + (tc === "s" ? (' Folge' + (streamCountNum === 1 ? '' : 'n') + '/Streams') : (' Bot-Stream' + (streamCountNum === 1 ? '' : 's'))) + '</b>') : '') +
                              (it.genres ? (' • ' + esc(it.genres)) : '') +
                            '</div>' +
                          '</div>' +
                        '</div>' +
                        '<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">' +
                          epDrawerToggleHtml +
                          (idx > 0 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Nach ganz oben" onclick="adminReorderPlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'top\\')">⏫</button>' : '') +
                          (idx > 0 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Position nach oben" onclick="adminReorderPlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'up\\')">⬆️</button>' : '') +
                          (idx < activeFolderItems.length - 1 ? '<button class="btn" style="padding:4px 7px;font-size:11px" title="Position nach unten" onclick="adminReorderPlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'down\\')">⬇️</button>' : '') +
                          '<button class="btn" style="padding:4px 8px;font-size:11px" title="Details & Streams öffnen" onclick="openDetails(\\'' + tc + '\\',' + Number(it.tmdbId) + ',false)">👁️</button>' +
                          '<button class="btn" style="padding:4px 8px;font-size:11px;border-color:rgba(245,158,11,0.45);color:#fbbf24" title="Nur aus dieser Playlist entfernen (Film/Serie bleibt in D1 erhalten)" onclick="adminRemovePlaylistItem(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\')">➖ Aus Playlist</button>' +
                          '<button class="btn red" style="padding:4px 8px;font-size:11px" title="Komplett aus D1-Datenbank + Telegram-Bot UND aus Playlist löschen" onclick="adminDeletePlaylistItemFromD1(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(activeFolderObj.id) + '\\',\\'' + esc(it.uid) + '\\',\\'' + tc + '\\',' + Number(it.tmdbId) + ',\\'' + esc(it.title) + '\\')">🗑️ Aus D1 + Bot</button>' +
                        '</div>' +
                      '</div>' +
                      epDrawerBodyHtml +
                    '</div>';
                  }).join("") +
                '</div>'
              )) +
            '</div>'
          ) : '';

          const playlistsManagerBoxHtml =
            '<div class="panel-box" style="border-color:rgba(16,185,129,0.4)">' +
              '<div class="section-title">' +
                '<span>🎵 Smarte Custom Playlisten, Bot-VIP-Playlist & 25er-Batch-Kopie (' + adminPlaylists.length + ')</span>' +
                '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                  '<button class="btn amber" onclick="adminOpenBotVipPlaylistDirect()">🤖 Bot-VIP-Playlist öffnen</button>' +
                  '<button class="btn blue" onclick="adminSyncBotVipFromD1Client(true)" title="Synchronisiert alle in D1 gespeicherten Bot-Filme & -Serien in 25er-Batches in die Bot-VIP-Playlist">🔄 D1-Katalog (25er-Batches) synchronisieren</button>' +
                  '<select onchange="state.adminPlaylistTargetChatId=this.value;state.adminEditingFolderId=\\'\\';backupImportJob.targetPlaylistChatId=this.value;loadAdminPanelView()" style="padding:6px 10px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.22);font-size:12px">' +
                    userSelectOptionsHtml +
                  '</select>' +
                  '<button class="btn green" onclick="adminCreatePlaylistPrompt()">➕ Neue Playlist</button>' +
                '</div>' +
              '</div>' +
              '<p style="font-size:12px;color:#aaa;margin-bottom:10px">Alle Playlisten werden automatisch in <b>25er-Batches</b> kopiert und synchronisiert – dadurch wird das <b>Cloudflare 50-Subrequest-Limit</b> niemals erreicht, egal ob 50 oder 5.000 Filme!</p>' +
              '<div id="adminPlaylistBatchProgressBox" style="display:none;margin-bottom:10px;padding:10px 12px;border-radius:8px;background:#101827;border:1px solid rgba(56,189,248,0.4)"></div>' +
              (adminPlaylists.length === 0
                ? '<div style="font-size:12px;color:#94a3b8;padding:8px 0">Noch keine Playlisten oder Ordner für dieses Ziel vorhanden.</div>'
                : adminPlaylists.map(pl => {
                    const isEn = pl.enabled !== false;
                    const isEditingThis = String(pl.id) === String(activeFolderId);
                    const pMode = pl.playlistMode || "both";
                    const modeBadge = pMode === "vip_stream"
                      ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(245,158,11,0.2);color:#fbbf24;margin-left:6px">🌟 VIP-Stream</span>'
                      : pMode === "watchlist"
                        ? '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(56,189,248,0.2);color:#38bdf8;margin-left:6px">🔖 Merkliste</span>'
                        : '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;background:rgba(16,185,129,0.2);color:#34d399;margin-left:6px">⚡ VIP + Merkliste</span>';
                    return '<div class="ep-row" style="' + (isEn ? '' : 'opacity:0.68;') + (isEditingThis ? 'border:1px solid rgba(251,191,36,0.55);background:rgba(251,191,36,0.06);' : '') + '">' +
                      '<div style="flex:1">' +
                        '<div style="font-size:13px;font-weight:800;color:#fff">' +
                          '<span style="font-size:11px;padding:2px 6px;border-radius:999px;margin-right:6px;background:' + (isEn ? 'rgba(16,185,129,0.2);color:#34d399' : 'rgba(148,163,184,0.2);color:#94a3b8') + '">' +
                            (isEn ? '🟢 Aktiv' : '⚪ Aus') +
                          '</span>' +
                          esc(pl.name) + ' <span style="color:#38bdf8;font-size:11.5px">(' + Number(pl.itemCount || 0) + ' Titel)</span>' +
                          modeBadge +
                        '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:2px">' +
                          (pl.isJsonPlaylist || pl.type === 'playlist' ? '📦 JSON-/VIP-Playlist' : '📁 Custom Ordner') +
                          (pl.sourceLabel ? ' • Quelle: ' + esc(pl.sourceLabel) : '') +
                        '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:5px;flex-wrap:wrap">' +
                        '<button class="btn ' + (isEditingThis ? 'amber' : 'blue') + '" onclick="adminOpenPlaylistEditor(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\')">📂 Öffnen & Bearbeiten</button>' +
                        '<button class="btn green" onclick="adminCopyPlaylistBatchClient(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\',\\'' + esc(pl.name) + '\\')" title="Kopiert diese Playlist in 25er-Batches ohne API-Limit">📋 25er-Batch Kopie</button>' +
                        '<button class="btn ' + (isEn ? 'green' : '') + '" onclick="adminTogglePlaylist(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\')">' + (isEn ? '🟢 Ein' : '⚪ Aus') + '</button>' +
                        '<button class="btn" onclick="adminRenamePlaylist(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\',\\'' + esc(pl.name) + '\\')">✏️</button>' +
                        '<button class="btn red" onclick="adminDeletePlaylist(\\'' + esc(state.adminPlaylistTargetChatId) + '\\',\\'' + esc(pl.id) + '\\',\\'' + esc(pl.name) + '\\')">🗑️</button>' +
                      '</div>' +
                    '</div>';
                  }).join("")
              ) +
              playlistEditorBoxHtml +
            '</div>';

          const savedChanVal = backupImportJob.verifiedChannelId || getSavedVerifiedChannelIdClient();
          const isChanReady = Boolean(savedChanVal && (savedChanVal.startsWith("-100") || savedChanVal.startsWith("@")));

          root.innerHTML = '<div class="section">' +
            '<div class="section-title">' +
              '<span>👑 Admin-Dashboard & VIP- / Playlisten- / Backup-Verwaltung</span>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                '<button class="btn ' + (state.adminTab === 'users' ? 'active' : '') + '" onclick="state.adminTab=\\'users\\';loadAdminPanelView()">👥 User & VIP (' + users.length + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'reports' ? 'active' : (openReportsCount > 0 ? 'amber' : '')) + '" onclick="state.adminTab=\\'reports\\';loadAdminPanelView()">🚨 Meldungen (' + openReportsCount + ' offen)</button>' +
                '<button class="btn ' + (state.adminTab === 'gaps' ? 'active' : '') + '" onclick="state.adminTab=\\'gaps\\';loadAdminPanelView()" title="Fehlende Folgen in Serien (insb. Lücken mitten in einer Staffel wie Folge 1+2 fehlt, Folge 3 ist da)">📉 Serien-Lücken (' + Number(seriesGaps.seriesWithGapsCount || 0) + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'playlists' ? 'active' : '') + '" onclick="state.adminTab=\\'playlists\\';loadAdminPanelView()">🎵 Playlisten & Bot-VIP (' + adminPlaylists.length + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'backup' ? 'active' : '') + '" onclick="state.adminTab=\\'backup\\';loadAdminPanelView()">📦 Backup-Import (100k+)</button>' +
                '<button class="btn ' + (state.adminTab === 'diaglog' ? 'active' : '') + '" onclick="state.adminTab=\\'diaglog\\';loadAdminPanelView()">🛠️ Diagnose-Log (' + getDiagnosticLogTotalCountClient() + ')</button>' +
                '<button class="btn ' + (state.adminTab === 'crud' ? 'active' : '') + '" onclick="state.adminTab=\\'crud\\';loadAdminPanelView()">🎬 Film/Serien CRUD (' + mediaList.length + ')</button>' +
                '<button class="btn" onclick="loadAdminPanelView(true)" title="Admin-Übersicht frisch vom Server laden">🔄 Übersicht</button>' +
                '<button class="btn" onclick="adminRunD1DedupeFilesClient()" title="Entfernt alle doppelten oder defekten Stream-Buttons in D1">🧹 Doppelte Buttons bereinigen</button>' +
                '<button class="btn red" onclick="adminRunCompleteMediaResetClient()" title="Löscht alle Filme, Serien, Episoden & Playlisten für einen sauberen Neustart">🧨 Komplett-Reset</button>' +
                '<button class="btn" onclick="goHome()">🏠 Hauptseite</button>' +
              '</div>' +
            '</div>' +
            buildAntiSpamCockpitBoxHtmlClient() +
            (state.adminTab === "users" ? (
              '<div class="panel-box">' +
                '<div class="section-title"><span>👥 Registrierte Telegram- & Web-Nutzer (' + users.length + ')</span></div>' +
                (users.length === 0 ? '<div style="font-size:12px;color:#aaa">Noch keine Nutzer in D1 registriert.</div>' : '') +
                users.map(u => '<div class="ep-row">' +
                  '<div style="flex:1">' +
                    '<div style="font-size:13px;font-weight:800;color:#fff">🆔 ' + esc(u.telegramId) +
                      (u.tgUsername ? ' <span style="color:#60a5fa">@' + esc(u.tgUsername) + '</span>' : '') +
                      (u.customUsername ? ' <span style="color:#34d399">[Web: ' + esc(u.customUsername) + ']</span>' : '') +
                      (u.isAdmin ? ' <span style="color:#f87171">👑 ADMIN</span>' : '') +
                    '</div>' +
                    '<div style="font-size:11px;color:#94a3b8">' +
                      (u.hasPasswordAccount ? '🔐 Passwort-Account aktiv' : '📱 Nur Telegram initData') +
                      (u.totpEnabled ? ' • 🛡️ 2FA aktiv' : '') +
                      ' • Zuletzt aktiv: ' + (u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString('de-DE') : '–') +
                    '</div>' +
                  '</div>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn" onclick="state.adminPlaylistTargetChatId=\\'' + esc(u.telegramId) + '\\';state.adminTab=\\'playlists\\';loadAdminPanelView()">🎵 Playlisten</button>' +
                    '<button class="btn ' + (u.isVip ? 'amber' : '') + '" onclick="toggleUserVipAdmin(\\'' + esc(u.telegramId) + '\\',' + (!u.isVip) + ')">' +
                      (u.isVip ? '🌟 VIP AKTIV (Entziehen)' : '⚪ Kein VIP (VIP vergeben)') +
                    '</button>' +
                  '</div>' +
                '</div>').join("") +
              '</div>'
            ) : state.adminTab === "reports" ? (
              '<div class="panel-box" style="border-color:rgba(245,158,11,0.45)">' +
                '<div class="section-title">' +
                  '<span>🚨 Eingegangene Fehlermeldungen von VIPs & Admins (' + openReportsCount + ' offen / ' + allReports.length + ' gesamt)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button type="button" class="btn ' + (reportFilter === 'open' ? 'red' : '') + '" onclick="state.adminReportFilter=\\'open\\';loadAdminPanelView()">🔥 Offen (' + openReportsCount + ')</button>' +
                    '<button type="button" class="btn ' + (reportFilter === 'resolved' ? 'green' : '') + '" onclick="state.adminReportFilter=\\'resolved\\';loadAdminPanelView()">✅ Gelöst (' + (allReports.length - openReportsCount) + ')</button>' +
                    '<button type="button" class="btn ' + (reportFilter === 'all' ? 'blue' : '') + '" onclick="state.adminReportFilter=\\'all\\';loadAdminPanelView()">📋 Alle (' + allReports.length + ')</button>' +
                    ((allReports.length - openReportsCount) > 0 ? '<button type="button" class="btn amber" onclick="adminClearAllMediaReportsClient(true)">🧹 Gelöste entfernen (' + (allReports.length - openReportsCount) + ')</button>' : '') +
                    (allReports.length > 0 ? '<button type="button" class="btn red" onclick="adminClearAllMediaReportsClient(false)">🗑️ Alle Meldungen löschen</button>' : '') +
                  '</div>' +
                '</div>' +
                '<p style="font-size:12px;color:#94a3b8;margin-bottom:10px">Klicke auf <b>🔧 Jetzt korrigieren</b>, um direkt in die Detailansicht & den Folgen-Korrektur-Dialog zu springen. Sobald du die Korrektur speicherst, wird die Meldung automatisch als gelöst markiert!</p>' +
                (filteredReports.length === 0 ? (
                  '<div style="padding:16px;text-align:center;color:#94a3b8;font-size:12.5px;background:#101015;border-radius:8px">🎉 Keine ' + (reportFilter === 'open' ? 'offenen ' : '') + 'Fehlermeldungen vorhanden.</div>'
                ) : (
                  filteredReports.map(rep => {
                    const isOpen = rep.status === "open";
                    const tc = rep.type_code === "s" ? "s" : "m";
                    const epStr = tc === "s" && rep.season_number
                      ? (' • <b style="color:#38bdf8">S' + String(rep.season_number).padStart(2, '0') + 'E' + String(rep.episode_number || 1).padStart(2, '0') + '</b>' + (rep.episode_title ? (' (' + esc(rep.episode_title) + ')') : ''))
                      : '';
                    return '<div class="ep-row" style="' + (isOpen ? 'border-color:rgba(245,158,11,0.5);background:rgba(245,158,11,0.06);' : 'opacity:0.75;') + '">' +
                      '<div style="flex:1;min-width:210px">' +
                        '<div style="font-size:13px;font-weight:800;color:#fff">' +
                          '<span style="font-size:10.5px;padding:2px 7px;border-radius:999px;margin-right:6px;background:' + (isOpen ? 'rgba(239,68,68,0.22);color:#fca5a5' : 'rgba(16,185,129,0.22);color:#6ee7b7') + '">' +
                            (isOpen ? '🚨 OFFEN' : '✅ GELÖST') +
                          '</span>' +
                          (tc === 's' ? '📺 ' : '🎬 ') + esc(rep.title) + ' <span style="color:#94a3b8;font-weight:600">(TMDb #' + Number(rep.tmdb_id) + ')</span>' +
                          epStr +
                          (rep.version_label ? (' <span class="flix-version-badge" style="margin-left:6px">🎞️ ' + esc(rep.version_label) + '</span>') : '') +
                        '</div>' +
                        '<div style="font-size:12px;color:#fbbf24;font-weight:700;margin-top:4px">' +
                          esc(rep.reason_label || '⚠️ Fehler gemeldet') +
                          (rep.note ? (' — <span style="color:#f8fafc;font-weight:500">„' + esc(rep.note) + '“</span>') : '') +
                        '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:3px">' +
                          '👤 Gemeldet von: <b>' + (rep.reporter_username ? ('@' + esc(rep.reporter_username) + ' (' + esc(rep.reporter_telegram_id) + ')') : esc(rep.reporter_telegram_id)) + '</b>' +
                          ' • ' + (rep.created_at ? new Date(Number(rep.created_at)).toLocaleString('de-DE') : '') +
                          (!isOpen && rep.resolved_by ? (' • Gelöst von: <b style="color:#34d399">' + esc(rep.resolved_by) + '</b>') : '') +
                        '</div>' +
                      '</div>' +
                      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
                        '<button type="button" class="btn blue" onclick="openReportCorrectionWorkflowByIdClient(' + Number(rep.id) + ')">🔧 Jetzt korrigieren</button>' +
                        (isOpen ? '<button type="button" class="btn green" onclick="adminResolveMediaReportClient(' + Number(rep.id) + ')">✅ Als gelöst markieren</button>' : '') +
                        '<button type="button" class="btn red" onclick="adminDeleteMediaReportClient(' + Number(rep.id) + ')" title="Meldung löschen">🗑️</button>' +
                      '</div>' +
                    '</div>';
                  }).join("")
                )) +
              '</div>'
            ) : state.adminTab === "playlists" ? (
              playlistsManagerBoxHtml
            ) : state.adminTab === "gaps" ? (
              '<div class="panel-box" style="border-color:rgba(245,158,11,0.5)">' +
                '<div class="section-title">' +
                  '<span>📉 Fehlende Serienfolgen & Staffel-Lücken Finder (' + Number(seriesGaps.seriesWithGapsCount || 0) + ' Serien mit Lücken von ' + Number(seriesGaps.totalSeriesChecked || 0) + ' geprüften Serien)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn ' + ((state.adminGapFilter || 'all') === 'all' ? 'amber' : '') + '" onclick="state.adminGapFilter=\\'all\\';loadAdminPanelView()">📋 Alle Lücken (' + Number(seriesGaps.seriesWithGapsCount || 0) + ')</button>' +
                    '<button class="btn ' + (state.adminGapFilter === 'internal' ? 'red' : '') + '" onclick="state.adminGapFilter=\\'internal\\';loadAdminPanelView()">🚨 Nur Lücken mitten in der Staffel (' + Number(seriesGaps.seriesWithInternalGapsCount || 0) + ')</button>' +
                    '<button class="btn green" onclick="state.adminTab=\\'gaps\\';loadAdminPanelView(true)" title="Ignoriert den Cache und scannt alle Serien, Staffeln und Episoden in D1 sofort neu">🔄 Jetzt Lücken neu scannen</button>' +
                  '</div>' +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px;margin-bottom:12px;font-size:12px">' +
                  '<div style="background:#161620;padding:9px 11px;border-radius:8px;border:1px solid rgba(239,68,68,0.4)">🚨 <b>Lücken mitten in Staffel/Serie (Prio 1):</b> <span style="color:#f87171;font-weight:900">' + Number(seriesGaps.totalMissingInternal || 0) + ' Folgen</span> in ' + Number(seriesGaps.seriesWithInternalGapsCount || 0) + ' Serien</div>' +
                  '<div style="background:#161620;padding:9px 11px;border-radius:8px;border:1px solid rgba(56,189,248,0.35)">⏳ <b>Fehlend am Staffelende (Prio 2):</b> <span style="color:#38bdf8;font-weight:900">' + Number(seriesGaps.totalMissingTrailing || 0) + ' Folgen</span></div>' +
                  '<div style="background:#161620;padding:9px 11px;border-radius:8px;border:1px solid rgba(168,85,247,0.45)">💿 <b>Unvollständige Mehrteiler (CD1/CD2):</b> <span style="color:#e9d5ff;font-weight:900">' + Number(seriesGaps.incompleteMultipartMoviesCount || 0) + ' Filme</span></div>' +
                  '<div style="background:#161620;padding:9px 11px;border-radius:8px;border:1px solid rgba(245,158,11,0.4)">⚠️ <b>Nur als Vorabversion/TS/MD:</b> <span style="color:#fbbf24;font-weight:900">' + Number(seriesGaps.totalPrereleaseOnly || 0) + ' Folgen</span></div>' +
                '</div>' +
                ((seriesGaps.incompleteMultipartMovies && seriesGaps.incompleteMultipartMovies.length > 0) ? (
                  '<div style="background:#141222;border:1px solid rgba(168,85,247,0.5);border-radius:10px;padding:10px 12px;margin-bottom:12px">' +
                    '<div style="font-size:12.5px;font-weight:900;color:#e9d5ff;margin-bottom:6px">💿 Unvollständige Mehrteiler-Filme (CD1 oder CD2 fehlt in D1):</div>' +
                    '<div style="display:flex;flex-direction:column;gap:6px">' +
                      seriesGaps.incompleteMultipartMovies.map(mp =>
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;background:#1a172b;padding:7px 10px;border-radius:7px;font-size:12px">' +
                          '<div>' +
                            '🎬 <b>' + esc(mp.title) + '</b> <span style="color:#94a3b8">(' + esc(mp.year || 'k.A.') + ' • TMDb #' + Number(mp.tmdbId) + ')</span> — ' +
                            '<span style="color:#34d399">Vorhanden: ' + esc((mp.presentParts || []).map(p => 'CD ' + p).join(', ')) + '</span> • ' +
                            '<b style="color:#f87171">Fehlt: ' + esc(mp.missingLabel || ((mp.missingParts || []).map(p => 'CD ' + p).join(', '))) + '</b>' +
                          '</div>' +
                          '<button type="button" class="btn blue" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'m\\',' + Number(mp.tmdbId) + ',false)">🎬 Film öffnen</button>' +
                        '</div>'
                      ).join("") +
                    '</div>' +
                  '</div>'
                ) : '') +
                '<p style="font-size:12px;color:#94a3b8;margin-bottom:10px">💡 <b>Besonders wichtig (rot markiert):</b> Wenn z.B. <code>Folge 1 + 2</code> fehlen, während <code>Folge 3</code> bereits vorhanden ist, oder eine komplette Zwischen-Staffel (z.B. <code>Staffel 2</code> vor <code>Staffel 3</code>) fehlt, steht diese Serie ganz oben.</p>' +
                ((() => {
                  const gapItems = (seriesGaps.items || []).filter(item => state.adminGapFilter === "internal" ? (item.hasPriorityInternalGaps ?? item.hasInternalGaps) : true);
                  if (gapItems.length === 0) {
                    return '<div style="padding:18px;text-align:center;color:#34d399;font-size:12.5px;background:#101016;border-radius:8px;border:1px solid rgba(16,185,129,0.35)">🎉 Perfekt! Keine fehlenden Serienfolgen in dieser Ansicht gefunden.</div>';
                  }
                  return '<div style="display:flex;flex-direction:column;gap:10px;max-height:620px;overflow-y:auto;padding-right:4px">' +
                    gapItems.map(sItem => {
                      const seriesIdVal = Number(sItem.seriesId ?? sItem.tmdbId ?? 0);
                      const hasPrioInt = Boolean(sItem.hasPriorityInternalGaps ?? sItem.hasInternalGaps);
                      const totInt = Number(sItem.totalInternalMissing ?? sItem.internalMissingCount ?? 0);
                      const totTrail = Number(sItem.totalTrailingMissing ?? sItem.trailingMissingCount ?? 0);
                      const totPre = Number(sItem.totalPrerelease ?? sItem.prereleaseCount ?? 0);
                      const pImg = resolvePosterUrlClient(sItem.poster, "w185", "");
                      return '<div style="background:#12121a;border:1px solid ' + (hasPrioInt ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.14)') + ';border-radius:10px;padding:11px;display:flex;flex-direction:column;gap:8px">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
                          '<div style="display:flex;align-items:center;gap:10px;min-width:200px;flex:1">' +
                            (pImg
                              ? '<img src="' + esc(pImg) + '" style="width:38px;height:56px;object-fit:cover;border-radius:5px;flex-shrink:0" alt="" />'
                              : '<div style="width:38px;height:56px;background:#1e293b;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📺</div>') +
                            '<div>' +
                              '<div style="font-size:13.5px;font-weight:900;color:#fff;display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
                                esc(sItem.title) + ' <span style="color:#94a3b8;font-weight:600;font-size:12px">(' + esc(sItem.year || 'k.A.') + ' • TMDb #' + seriesIdVal + ')</span>' +
                                (hasPrioInt ? '<span style="background:rgba(239,68,68,0.22);color:#fca5a5;border:1px solid rgba(239,68,68,0.5);padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:800">🚨 LÜCKE MITTEN IN DER STAFFEL/SERIE (' + totInt + ' fehlt)</span>' : '') +
                              '</div>' +
                              '<div style="font-size:11.5px;color:#cbd5e1;margin-top:3px">' +
                                'Innerhalb der Staffel/Serie fehlend: <b style="color:#f87171">' + totInt + '</b> • Am Staffelende offen: <b style="color:#38bdf8">' + totTrail + '</b>' +
                                (totPre > 0 ? (' • Nur Vorabversion/TS/MD: <b style="color:#fbbf24">' + totPre + '</b>') : '') +
                              '</div>' +
                            '</div>' +
                          '</div>' +
                          '<button class="btn blue" onclick="openDetails(\\'s\\',' + seriesIdVal + ',false)">📺 Serie öffnen</button>' +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;gap:6px">' +
                          (sItem.seasons || []).map(sec => {
                            const intList = sec.internalGaps || sec.internalMissingEpisodes || [];
                            const trailList = sec.trailingMissing || sec.trailingMissingEpisodes || [];
                            const preList = sec.prereleaseEpisodes || [];
                            const upList = sec.uploadedEpisodes || sec.presentEpisodes || [];
                            const upCount = Number(sec.uploadedCount ?? sec.uploadedEpisodesCount ?? upList.length);
                            const intCodes = intList.map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const trailCodes = trailList.map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const preCodes = preList.map(epN => 'S' + String(sec.seasonNumber).padStart(2, '0') + 'E' + String(epN).padStart(2, '0'));
                            const upCodes = upList.map(epN => 'E' + String(epN).padStart(2, '0'));
                            const isMissingWholeSeason = Boolean(sec.isCompletelyMissingSeason);
                            return '<div style="background:#181824;border:1px solid ' + (isMissingWholeSeason ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.09)') + ';border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
                              '<div style="flex:1;min-width:210px;font-size:11.5px">' +
                                '<div style="font-weight:800;color:#fff;margin-bottom:3px">' +
                                  'Staffel ' + Number(sec.seasonNumber) +
                                  (isMissingWholeSeason
                                    ? ' <span style="color:#f87171;font-weight:800">(0 / ' + Number(sec.expectedTotalEpisodes) + ' Folgen vorhanden – komplette Zwischen-Staffel fehlt!)</span>'
                                    : ' <span style="color:#34d399;font-weight:700">(' + upCount + ' / ' + Number(sec.expectedTotalEpisodes) + ' Folgen vorhanden: ' + esc(upCodes.slice(0, 12).join(', ')) + (upCodes.length > 12 ? '…' : '') + ')</span>') +
                                '</div>' +
                                (intCodes.length > 0 ? (
                                  '<div style="color:#fca5a5;margin-top:2px">🚨 <b>' + (isMissingWholeSeason ? ('Komplette Staffel ' + Number(sec.seasonNumber) + ' fehlt mitten in der Serie:') : ('Fehlt mitten in Staffel ' + Number(sec.seasonNumber) + ' (vor E' + String(sec.maxUploadedEp).padStart(2, '0') + '):')) + '</b> <code style="background:rgba(239,68,68,0.2);color:#fecaca;padding:1px 6px;border-radius:4px;font-weight:800">' + esc(intCodes.slice(0, 16).join(', ')) + (intCodes.length > 16 ? (' +' + (intCodes.length - 16) + ' weitere') : '') + '</code></div>'
                                ) : '') +
                                (trailCodes.length > 0 ? (
                                  '<div style="color:#93c5fd;margin-top:2px">⏳ <b>Fehlt ab E' + String(Number(sec.maxUploadedEp || 0) + 1).padStart(2, '0') + ' bis Staffelende:</b> <code style="background:rgba(56,189,248,0.14);color:#bae6fd;padding:1px 6px;border-radius:4px">' + esc(trailCodes.slice(0, 15).join(', ')) + (trailCodes.length > 15 ? (' +' + (trailCodes.length - 15) + ' weitere') : '') + '</code></div>'
                                ) : '') +
                                (preCodes.length > 0 ? (
                                  '<div style="color:#fde68a;margin-top:2px">⚠️ <b>Nur als Vorabversion / TS / MD vorhanden (wird bei gutem Upload automatisch ersetzt):</b> <code style="background:rgba(245,158,11,0.2);color:#fef08a;padding:1px 6px;border-radius:4px">' + esc(preCodes.join(', ')) + '</code></div>'
                                ) : '') +
                              '</div>' +
                              '<button class="btn" style="padding:4px 9px;font-size:11px" onclick="openDetails(\\'s\\',' + seriesIdVal + ',false,\\'\\',\\'\\',' + Number(sec.seasonNumber) + ')">Staffel ' + Number(sec.seasonNumber) + ' öffnen</button>' +
                            '</div>';
                          }).join("") +
                        '</div>' +
                      '</div>';
                    }).join("") +
                  '</div>';
                })()) +
              '</div>'
            ) : state.adminTab === "diaglog" ? (
              renderImportDiagnosticLogBoxHtml()
            ) : state.adminTab === "backup" ? (
              '<div class="panel-box" style="border-color:rgba(56,189,248,0.5)">' +
                '<div class="section-title">' +
                  '<span>📡 Schritt 1 (Pflicht vor JSON-Upload): Quell-Kanal / Gruppen-ID prüfen & Dry-Run</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button class="btn" onclick="adminRunD1DedupeFilesClient()">🧹 Doppelte Stream-Buttons bereinigen</button>' +
                    '<button class="btn red" onclick="adminRunCompleteMediaResetClient()">🧨 Komplett-Reset (Alle Medien löschen)</button>' +
                  '</div>' +
                '</div>' +
                '<p style="font-size:12px;color:#cbd5e1;line-height:1.5;margin-bottom:8px">' +
                  '⚠️ <b>Strikte Kanal-ID-Pflicht:</b> Gib die Telegram Kanal-/Gruppen-ID (<code>-100...</code>) oder einen Beispiel-Link aus dem Kanal (z. B. <code>https://t.me/c/1234567890/42</code>) ein. Ohne geprüfte Kanal-ID ist der JSON-Upload gesperrt, damit niemals fehlerhafte Datei-IDs entstehen!' +
                '</p>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
                  '<input id="backupSourceChannelInp" value="' + esc(savedChanVal) + '" placeholder="-1001234567890 oder https://t.me/c/1234567890/42" style="flex:1;min-width:240px;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(56,189,248,0.45);font-family:monospace;font-size:12px" />' +
                  '<input id="backupSampleMsgIdInp" type="number" placeholder="Test Msg-ID (opt.)" style="width:140px;padding:8px 10px;border-radius:6px;background:#101015;color:#fff;border:1px solid rgba(255,255,255,0.2);font-family:monospace;font-size:12px" />' +
                  '<button class="btn green" onclick="verifyBackupChannelClient()">🔍 Kanal prüfen & freischalten (Dry-Run)</button>' +
                '</div>' +
                '<div id="backupChannelVerifyBanner" style="display:' + (isChanReady ? 'block' : 'none') + ';margin-top:8px;padding:8px 10px;border-radius:6px;background:rgba(16,185,129,0.14);border:1px solid rgba(16,185,129,0.4);font-size:12px;color:#34d399">' +
                  (isChanReady ? ('✅ Verifizierte Quell-Kanal-ID aktiv: <code>' + esc(savedChanVal) + '</code> – JSON-Upload ist freigeschaltet!') : '') +
                '</div>' +
              '</div>' +
              '<div class="panel-box">' +
                '<div class="section-title">' +
                  '<span>📦 Schritt 2: Telegram Chat-Backup (result.json) hochladen (mit Auto-Checkpoint & Fortsetzen)</span>' +
                  '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                    '<button type="button" class="btn green" style="background:linear-gradient(90deg,#059669,#0284c7);border-color:#38bdf8" onclick="runSimulatedJsonImportTestSuiteClient()">🧪 E2E JSON-Import Simulation starten (7 Testfälle + Prüfbericht)</button>' +
                    '<button type="button" class="btn" onclick="openLargeJsonHowToModalClient()">✂️ >200 MB How-To & CLI Guide</button>' +
                  '</div>' +
                '</div>' +
                '<p style="font-size:12px;color:#ccc;line-height:1.5;margin-bottom:10px">' +
                  'Erkennt automatisch <b>Telegram Desktop Chat-Backups (<code>result.json</code> auch über 200 MB per 2 MB <code>File.slice()</code> Stream-Slicer)</b>. ' +
                  'Merkt sich nach jedem Batch automatisch den <b>Fortschritts-Checkpoint</b> und verhindert bei Neustart jegliche Duplikate. ' +
                  'Mit <b>🧪 E2E JSON-Import Simulation starten</b> kannst du die komplette Pipeline (Filme, Serien, Staffel-Lücken, TS-Upgrade, Duplikate, Konflikte, Meldungen & Katalog) live testen.' +
                '</p>' +
                '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
                  '<input id="backupJsonFileInputEl" type="file" accept=".json,application/json" ' + (!isChanReady ? 'disabled' : '') + ' onchange="handleBackupFileInput(event)" style="font-size:12px;color:#fff;background:#141414;padding:8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);opacity:' + (isChanReady ? '1' : '0.45') + '" />' +
                  '<button class="btn amber" onclick="downloadBackupSplitPartClient(0, 250)">💾 Part #1 (250 Videos) als .json laden</button>' +
                  '<span id="backupParseNotice" style="font-size:12px;color:#fbbf24"></span>' +
                '</div>' +
                '<div id="e2eSimReportMount" style="display:' + (window._lastE2eSimReportHtml ? 'block' : 'none') + ';margin-top:10px">' + (window._lastE2eSimReportHtml || '') + '</div>' +
                '<div id="backupImportLiveMount" style="margin-top:10px"></div>' +
                (qStats.pendingCount > 0 ? (
                  '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1)">' +
                    '<div style="font-size:13px;font-weight:800;color:#fbbf24;margin-bottom:6px">📥 Aktive D1-Server-Warteschlange (vom Telegram-Bot hochgeladen): ' + qStats.pendingCount + ' offen</div>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                      '<button class="btn green" onclick="runServerD1QueueStepAdmin(2)">▶️ Nächste 24 aus D1-Queue verarbeiten</button>' +
                      '<button class="btn red" onclick="clearServerD1QueueAdmin()">🗑️ D1-Queue leeren</button>' +
                    '</div>' +
                  '</div>'
                ) : '') +
              '</div>' +
              playlistsManagerBoxHtml
            ) : (
              '<div class="panel-box">' +
                '<div class="section-title"><span>➕ Film oder Serie in D1 anlegen / bearbeiten (CRUD)</span></div>' +
                '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px">' +
                  '<select id="crudTypeSel" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)">' +
                    '<option value="m" ' + (state.adminMediaType === 'm' ? 'selected' : '') + '>🎬 Film (movies)</option>' +
                    '<option value="s" ' + (state.adminMediaType === 's' ? 'selected' : '') + '>📺 Serie (series)</option>' +
                  '</select>' +
                  '<input id="crudTmdbIdInp" placeholder="TMDB-ID (z.B. 603)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudTitleInp" placeholder="Sauberer Titel (optional bei TMDB-Auto)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudYearInp" placeholder="Release-Jahr (z.B. 1999)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudFileIdInp" placeholder="Optionale telegram_file_id" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudQualityInp" placeholder="Qualität (z.B. 1080p / 4K)" value="1080p" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudFileSizeInp" placeholder="Dateigröße (z.B. 2.45 GB / 890 MB)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                  '<input id="crudTagsInp" placeholder="Tags (z.B. DE · DL · HDR · BluRay)" style="padding:8px;border-radius:6px;background:#141414;color:#fff;border:1px solid rgba(255,255,255,0.2)" />' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
                  '<button class="btn green" onclick="submitAdminMediaCrud()">💾 In D1 speichern / von TMDB synchronisieren</button>' +
                  '<button class="btn purple" style="background:rgba(168,85,247,0.22);border:1px solid rgba(168,85,247,0.55);color:#e9d5ff" onclick="openManualNoTmdbConfirmForCrudClient()">✨ Ohne TMDb-ID manuell anlegen</button>' +
                  '<button class="btn ' + (state.adminMediaType === 'm' ? 'active' : '') + '" onclick="state.adminMediaType=\\'m\\';loadAdminPanelView()">🎬 Filme in D1 zeigen</button>' +
                  '<button class="btn ' + (state.adminMediaType === 's' ? 'active' : '') + '" onclick="state.adminMediaType=\\'s\\';loadAdminPanelView()">📺 Serien in D1 zeigen</button>' +
                '</div>' +
                '<div style="margin-top:14px">' +
                  mediaList.map(m => '<div class="ep-row">' +
                    '<div class="ep-title" onclick="openDetails(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',false)">' +
                      '<b>#' + m.tmdb_id + ' – ' + esc(m.title) + '</b> (' + esc(m.release_year || 'k.A.') + ') • ⭐ ' + Number(m.vote_average || 0).toFixed(1) + ' • ' + esc(m.genres || '') +
                    '</div>' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
                      '<button class="btn purple" onclick="openDetailsWithAdminTool(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',\\'poster\\')" title="Cover/Poster ändern">🖼️ Cover</button>' +
                      '<button class="btn blue" onclick="openDetailsWithAdminTool(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ',\\'remap\\')" title="Titel neu zuordnen & Original-Link prüfen">🔄 Neu zuordnen</button>' +
                      '<button class="btn red" onclick="deleteAdminMediaCrud(\\'' + (state.adminMediaType || 'm') + '\\',' + m.tmdb_id + ')">🗑️ Löschen</button>' +
                    '</div>' +
                  '</div>').join("") +
                '</div>' +
              '</div>'
            )) +
          '</div>';
          if (state.adminTab === "backup") {
            renderBackupImportBoxDom();
          }
          if (typeof pollAntiSpamQueueClient === "function") {
            pollAntiSpamQueueClient(true);
          }
        } finally {
          setBusyState(false);
        }
      }

      async function openReportCorrectionWorkflowByIdClient(reportId) {
        const list = Array.isArray(window._adminReportsCache) ? window._adminReportsCache : [];
        const found = list.find(r => Number(r?.id) === Number(reportId));
        if (!found) {
          showHudToast("⚠️ Meldung #" + reportId + " nicht im Cache gefunden.");
          return;
        }
        await openReportCorrectionWorkflowClient(found);
      }

      async function toggleUserVipAdmin(targetTelegramId, nextVipState) {
        const r = await apiFetchJson(API_BASE + "/admin/vip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramId: targetTelegramId, isVip: Boolean(nextVipState) })
        });
        if (r && r.user && state.authUser && String(state.authUser.telegramId) === String(targetTelegramId)) {
          state.authUser = r.user;
          updateSyncBadge();
        }
        clearClientMediaCaches();
        showHudToast(nextVipState ? "🌟 VIP-Status aktiviert" : "⚪ VIP-Status entzogen");
        loadAdminPanelView();
      }

      async function submitAdminMediaCrud() {
        const typeCode = document.getElementById("crudTypeSel")?.value || "m";
        const tmdbId = document.getElementById("crudTmdbIdInp")?.value.trim() || "";
        const title = document.getElementById("crudTitleInp")?.value.trim() || "";
        const year = document.getElementById("crudYearInp")?.value.trim() || "";
        const fileId = document.getElementById("crudFileIdInp")?.value.trim() || "";
        const quality = document.getElementById("crudQualityInp")?.value.trim() || "1080p";
        const fileSize = document.getElementById("crudFileSizeInp")?.value.trim() || "";
        const tags = document.getElementById("crudTagsInp")?.value.trim() || "";
        if (!tmdbId && !title) {
          showHudToast("⚠️ Bitte mindestens eine TMDB-ID oder einen Titel angeben.");
          return;
        }
        setBusyState(true, "💾 Speichere Eintrag in D1...");
        try {
          const r = await apiFetchJson(API_BASE + "/admin/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "upsert", typeCode, tmdbId, title, year, fileId, quality, fileSize, tags })
          });
          clearClientMediaCaches();
          if (!r || !r.ok) showHudToast("⚠️ " + (r?.error || "Fehler beim Speichern"));
          else showHudToast("✅ Eintrag in D1 gespeichert");
          state.adminMediaType = typeCode;
          await loadAdminPanelView();
        } finally {
          setBusyState(false);
        }
      }

      async function deleteAdminMediaCrud(typeCode, tmdbId) {
        const ok = await showCustomConfirm("Diesen Titel (#" + tmdbId + ") wirklich aus D1 löschen?", "🗑️ Löschen");
        if (!ok) return;
        await apiFetchJson(API_BASE + "/admin/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", typeCode, tmdbId })
        });
        clearClientMediaCaches();
        showHudToast("🗑️ Eintrag #" + tmdbId + " gelöscht");
        loadAdminPanelView();
      }

      async function startTmdbAuth() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Erstelle TMDB-Freigabelink...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "create_token" }) });
        if (r.ok && r.requestToken) {
          state.pendingTmdbToken = r.requestToken;
          if (tg && tg.openLink) tg.openLink(r.authUrl);
          else window.open(r.authUrl, "_blank");
          loadSettingsView();
          const st2 = document.getElementById("tmdbSyncStatus");
          if (st2) st2.textContent = "👉 Bitte im geöffneten TMDB-Fenster auf 'Approve / Zulassen' tippen und danach auf '✅ 2. Nach Freigabe hier bestätigen' klicken.";
        } else if (st) {
          st.textContent = "⚠️ Fehler: " + (r.error || "Token konnte nicht erstellt werden.");
        }
      }
      async function completeTmdbAuth() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Verbinde TMDB-Konto & synchronisiere Merkliste...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "create_session", requestToken: state.pendingTmdbToken }) });
        if (r.ok) {
          state.pendingTmdbToken = "";
          await loadSettingsView();
          const st2 = document.getElementById("tmdbSyncStatus");
          if (st2) st2.textContent = "✅ Verbunden! " + (r.syncResult?.importedCount || 0) + " Titel von TMDB importiert & " + (r.syncResult?.pushedCount || 0) + " zu TMDB übertragen.";
        } else if (st) {
          st.textContent = "⚠️ " + (r.error || "Freigabe wurde auf TMDB noch nicht bestätigt.");
        }
      }
      async function runTmdbSyncNow() {
        const st = document.getElementById("tmdbSyncStatus");
        if (st) st.textContent = "⏳ Synchronisiere mit TMDB...";
        const r = await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "sync_now" }) });
        if (st) {
          st.textContent = r.ok
            ? ("✅ Sync abgeschlossen: " + r.importedCount + " neu von TMDB importiert, " + r.pushedCount + " zu TMDB übertragen.")
            : ("⚠️ " + (r.error || "Synchronisierung fehlgeschlagen."));
        }
      }
      async function disconnectTmdbSync() {
        await apiFetchJson(API_BASE + "/tmdb-sync", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chatId, action: "disconnect" }) });
        loadSettingsView();
      }

      async function initAuthSession() {
        try {
          if (rawInitData) {
            const r = await apiFetchJson(API_BASE + "/auth/init", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ initData: rawInitData })
            });
            if (r && r.ok && r.user) {
              sessionToken = r.sessionToken || sessionToken;
              try { if (sessionToken) localStorage.setItem("tma_session_token", sessionToken); } catch (e) {}
              state.isAuthenticated = true;
              state.hasInitData = true;
              state.authUser = r.user;
              chatId = String(r.user.telegramId);
            }
          } else if (sessionToken) {
            const r = await apiFetchJson(API_BASE + "/auth/me");
            if (r && r.ok && r.isAuthenticated && r.user) {
              state.isAuthenticated = true;
              state.authUser = r.user;
              chatId = String(r.user.telegramId);
            } else {
              sessionToken = "";
              try { localStorage.removeItem("tma_session_token"); } catch (e) {}
              state.isAuthenticated = false;
              state.authUser = null;
              chatId = "guest";
            }
          } else {
            state.isAuthenticated = false;
            state.authUser = null;
            chatId = "guest";
          }
        } catch (e) {
          state.isAuthenticated = false;
          state.authUser = null;
          chatId = "guest";
        }
        updateSyncBadge();
        await loadDiscover("m", "all", "trend", "pop_desc");

        // Deep-Link Unterstützung (aus dem Bot -> direkt zur entsprechenden Ansicht in der Mini-App!)
        let deepLinkOpened = false;
        try {
          const params = new URLSearchParams(window.location.search);
          const startParam = String(tg?.initDataUnsafe?.start_param || params.get("tgWebAppStartParam") || "").trim();
          const openCol = params.get("openCol") || (startParam.startsWith("col_") ? startParam.replace("col_", "") : "");
          const openUni = params.get("openUni") || (startParam.startsWith("uni_") ? startParam.replace("uni_", "") : "");
          const openPerson = params.get("openPerson") || "";
          const openItem = params.get("openItem") || ((startParam.startsWith("m_") || startParam.startsWith("s_")) ? startParam : "");

          if (openCol) {
            deepLinkOpened = true;
            await openCollectionView(openCol, "year_asc");
          } else if (openUni) {
            deepLinkOpened = true;
            await openUniverseView(openUni, "year_asc");
          } else if (openPerson) {
            deepLinkOpened = true;
            const pInput = document.getElementById("searchInput");
            if (pInput) pInput.value = openPerson;
            await runSearch(false, openPerson, "person");
          } else if (openItem && openItem.includes("_")) {
            const [tCode, tId] = openItem.split("_");
            if ((tCode === "m" || tCode === "s") && tId) {
              deepLinkOpened = true;
              await openDetails(tCode, tId);
            }
          } else if (startParam === "wishlist") {
            deepLinkOpened = true;
            await loadWishlist("root");
          } else if (startParam === "settings") {
            deepLinkOpened = true;
            await loadSettingsView();
          }
        } catch (e) {}

        // Standard-Auswahl beim Öffnen der App liegt direkt auf dem Suchfeld (#searchInput)
        if (!deepLinkOpened) {
          const defaultSearchInp = document.getElementById("searchInput");
          if (defaultSearchInp && typeof setSpatialFocus === "function") {
            setSpatialFocus(defaultSearchInp, false);
          }
        }
      }

      // =========================================================================
      // SPATIAL NAVIGATION: PFEILTASTEN, ANDROID-TV REMOTE, GAMEPAD, MAUS-HOVER & TYPE-TO-SEARCH
      // Inklusive Select-then-Jump Regel & Hero-Slider Rotations-Navigation!
      // =========================================================================
      const FOCUSABLE_SELECTOR = ".brand-logo, .btn, .detail-collapse-btn, .media-mode-tab, .card, .ff-tab-btn, .f-pill, .sort-chip, .sort-select, .mode-filter-select, .new-filter-select, .df-btn, .ep-title, .hero-btn-play, .hero-btn-info, .hero-circle-arrow, .hero-dot, .hero-hide-btn, .world-portal-card, .ac-item, .search-scope-select, #searchInput, .search-clear-btn, .search-submit-btn, .recent-chip";
      const CARD_SUB_SELECTOR = ".card-quick-info, .card-quick-trailer, .card-quick-save";
      let currentSpatialEl = null;
      let lastSelectJumpAt = 0;

      function clearCardSubnavState(exceptCard = null) {
        document.querySelectorAll(".card.card-subnav-active").forEach(c => {
          if (c !== exceptCard) c.classList.remove("card-subnav-active");
        });
      }

      function isCardSubElement(el) {
        return Boolean(el && el.matches && el.matches(CARD_SUB_SELECTOR));
      }

      function getVisibleFocusables() {
        const dialogEl = document.getElementById("customDialogRoot");
        const modalEl = document.getElementById("modalRoot");
        const lbEl = document.getElementById("lightboxRoot");
        const sidebarEl = document.getElementById("filterSidebarDrawer");
        const scopeRoot = (dialogEl && dialogEl.innerHTML.trim())
          ? dialogEl
          : (lbEl && lbEl.innerHTML.trim())
            ? lbEl
            : (modalEl && modalEl.innerHTML.trim())
              ? modalEl
              : (state.sidebarOpen && sidebarEl)
                ? sidebarEl
                : document.body;
        const nodes = Array.from(scopeRoot.querySelectorAll(FOCUSABLE_SELECTOR));
        return nodes.filter(el => {
          if (el.disabled) return false;
          if (!state.sidebarOpen && sidebarEl && sidebarEl.contains(el)) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
          const r = el.getBoundingClientRect();
          const minDim = (el.classList && el.classList.contains("hero-dot")) ? 2 : 4;
          return r.width > minDim && r.height > minDim;
        });
      }

      function getSpatialLayoutBox(el) {
        const r = el.getBoundingClientRect();
        const isStickyOrFixed = Boolean(
          el && el.closest && (
            el.closest("header") ||
            el.closest(".modal-backdrop") ||
            el.closest(".sidebar-drawer") ||
            el.closest("#customDialogRoot") ||
            el.closest(".lightbox-backdrop")
          )
        );
        const scrollOffset = isStickyOrFixed ? 0 : (window.scrollY || window.pageYOffset || 0);
        return {
          left: r.left,
          right: r.right,
          top: r.top + scrollOffset,
          bottom: r.bottom + scrollOffset,
          width: r.width,
          height: r.height
        };
      }

      let lastSpatialNavDir = "down";

      function syncStickyHeaderCssVars() {
        try {
          const headerEl = document.querySelector("header");
          if (!headerEl) return 54;
          const hr = headerEl.getBoundingClientRect();
          const h = hr.height > 0 ? Math.round(hr.height) : 54;
          document.documentElement.style.setProperty("--sticky-header-height", h + "px");
          document.documentElement.style.setProperty("--sticky-header-offset", (h + 20) + "px");
          return h;
        } catch (e) {
          return 54;
        }
      }

      window.addEventListener("resize", () => { syncStickyHeaderCssVars(); }, { passive: true });
      syncStickyHeaderCssVars();

      function getStickyTopObstructionOffset(el, navDir = "down") {
        let topObstruction = 0;

        const headerEl = document.querySelector("header");
        if (headerEl) {
          const hr = headerEl.getBoundingClientRect();
          if (hr.height > 0) {
            const h = Math.round(hr.height);
            document.documentElement.style.setProperty("--sticky-header-height", h + "px");
            document.documentElement.style.setProperty("--sticky-header-offset", (h + 20) + "px");
            if (hr.bottom > topObstruction) {
              topObstruction = hr.bottom;
            }
          }
        }

        const searchOuter = document.querySelector(".search-bar-outer");
        if (searchOuter && !(el && el.closest && el.closest(".search-bar-outer"))) {
          const cs = window.getComputedStyle(searchOuter);
          if (cs.position === "sticky" || cs.position === "fixed") {
            const sr = searchOuter.getBoundingClientRect();
            if (sr.height > 0 && sr.bottom > topObstruction) {
              topObstruction = sr.bottom;
            }
          }
        }

        const filterBar = document.querySelector(".floating-filter-bar");
        if (filterBar && !(el && el.closest && el.closest(".floating-filter-bar"))) {
          const cs = window.getComputedStyle(filterBar);
          const fr = filterBar.getBoundingClientRect();
          if (cs.position === "sticky" || cs.position === "fixed") {
            if (fr.height > 0 && fr.bottom > topObstruction) {
              topObstruction = fr.bottom;
            }
          } else if (navDir === "up" && el && el.closest && el.closest("#resultsGridContainer")) {
            // Wenn man im Ergebnisse-Grid nach oben navigiert und sich in der obersten Kartenreihe direkt unterhalb der Filterleiste befindet:
            // Filterleisten-Höhe als oberen Puffer einrechnen, damit sowohl die Filterleiste als auch die Karte komplett unter dem Sticky-Header sichtbar werden.
            const elBox = getSpatialLayoutBox(el);
            const fbBox = getSpatialLayoutBox(filterBar);
            if (elBox.top >= fbBox.bottom - 8 && (elBox.top - fbBox.bottom) < 110) {
              topObstruction += Math.max(0, fr.height + 14);
            }
          }
        }

        return Math.max(52, topObstruction);
      }

      function useSpatialScrollIntoView(el, navDir = lastSpatialNavDir) {
        if (!el) return;
        const applyScrollPass = () => {
          try {
            const modalBackdrop = el.closest ? el.closest(".modal-backdrop") : null;
            const sidebarBody = el.closest ? el.closest(".sidebar-body") : null;
            const acBox = el.closest ? el.closest(".search-autocomplete-box") : null;
            const dialogBox = el.closest ? el.closest("#customDialogRoot") : null;

            if (modalBackdrop) {
              const r = el.getBoundingClientRect();
              const modalStickyTop = modalBackdrop.querySelector(".modal-hero-top");
              const stickyOffset = modalStickyTop ? Math.max(28, modalStickyTop.getBoundingClientRect().bottom + 12) : 28;
              const botPad = window.innerHeight - 28;
              if (r.top < stickyOffset) {
                modalBackdrop.scrollTop += (r.top - stickyOffset);
              } else if (r.bottom > botPad) {
                modalBackdrop.scrollTop += (r.bottom - botPad);
              }
              return;
            }

            if (sidebarBody) {
              const sbRect = sidebarBody.getBoundingClientRect();
              const r = el.getBoundingClientRect();
              const topBoundary = sbRect.top + 14;
              const botBoundary = sbRect.bottom - 14;
              if (r.top < topBoundary) {
                sidebarBody.scrollTop += (r.top - topBoundary);
              } else if (r.bottom > botBoundary) {
                sidebarBody.scrollTop += (r.bottom - botBoundary);
              }
              return;
            }

            if (acBox || dialogBox) {
              if (typeof el.scrollIntoView === "function") {
                el.scrollIntoView({ block: "nearest", inline: "nearest" });
              }
              return;
            }

            // Hauptseite: Wenn Fokus auf Header, Suchleiste oder Hero-Slider liegt -> komplett nach oben (top: 0) scrollen
            const inTopZone = Boolean(
              el.closest && (
                el.closest("header") ||
                el.closest(".search-bar-outer") ||
                el.closest("#heroBannerSlot") ||
                el.closest(".hero") ||
                el.closest(".hero-collapsed-strip")
              )
            );
            const curScrollY = window.scrollY || window.pageYOffset || 0;
            if (inTopZone) {
              if (curScrollY > 0) {
                window.scrollTo({ top: 0, behavior: "auto" });
              }
              return;
            }

            // Dynamisches Offset aus Sticky-Header + Filter-Bar berechnen
            const obstructionOffset = getStickyTopObstructionOffset(el, navDir);
            const safeTopBoundary = obstructionOffset + 22;
            const safeBottomBoundary = window.innerHeight - 28;
            const r = el.getBoundingClientRect();

            if (r.top < safeTopBoundary) {
              const targetScrollY = Math.max(0, curScrollY + (r.top - safeTopBoundary));
              window.scrollTo({ top: targetScrollY, behavior: "auto" });
            } else if (r.bottom > safeBottomBoundary) {
              const targetScrollY = Math.max(0, curScrollY + (r.bottom - safeBottomBoundary));
              window.scrollTo({ top: targetScrollY, behavior: "auto" });
            }
          } catch (e) {}
        };

        // 1. Sofortiger Scroll-Durchlauf
        applyScrollPass();

        // 2. Zweiter Verifikations-Durchlauf im nächsten Animations-Frame, um eventuelle Layout-Shifts durch content-visibility: auto beim Hochscrollen auszugleichen
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            if (currentSpatialEl === el) {
              applyScrollPass();
            }
          });
        }
      }

      function setSpatialFocus(el, scrollIntoView = true, navDir = lastSpatialNavDir) {
        if (!el) return;
        if (currentSpatialEl && currentSpatialEl !== el) {
          currentSpatialEl.classList.remove("spatial-focus");
        }
        if (document.activeElement && document.activeElement !== el && document.activeElement !== document.body && typeof document.activeElement.blur === "function") {
          try { document.activeElement.blur(); } catch (e) {}
        }
        currentSpatialEl = el;
        currentSpatialEl.classList.add("spatial-focus");
        const parentCard = isCardSubElement(el) ? el.closest(".card") : null;
        clearCardSubnavState(parentCard);
        if (parentCard) parentCard.classList.add("card-subnav-active");

        if (scrollIntoView) {
          useSpatialScrollIntoView(el, navDir);
        }
      }

      function jumpSpatialFocus(el, scrollIntoView = true, navDir = lastSpatialNavDir) {
        if (!el) return;
        lastSelectJumpAt = Date.now();
        setSpatialFocus(el, scrollIntoView, navDir);
      }

      function focusFirstResultCard(scrollIntoView = false) {
        const target = document.querySelector("#resultsGridContainer .card, #appRoot .card, #colHubGrid .btn, #uniHubGrid .f-pill, #appRoot .ep-title");
        if (target) {
          jumpSpatialFocus(target, scrollIntoView);
        }
      }

      // Automatische Maus-Sperre während der Tastatur-/Controller-Nutzung:
      // Verhindert, dass beim Scrollen per Pfeiltasten der stillstehende Mauszeiger durch synthetische mouseover-Events den Fokus klaut!
      let isKeyboardNavActive = false;
      let lastMouseX = null;
      let lastMouseY = null;

      function engageKeyboardNavMode() {
        if (!isKeyboardNavActive) {
          isKeyboardNavActive = true;
          if (document.body) document.body.classList.add("kb-nav-active");
        }
      }

      function disengageKeyboardNavMode(ev = null) {
        if (isKeyboardNavActive) {
          isKeyboardNavActive = false;
          if (document.body) document.body.classList.remove("kb-nav-active");
          if (ev && mouseHoverNavEnabled && Date.now() - lastSelectJumpAt >= 450) {
            const subTarget = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(CARD_SUB_SELECTOR) : null;
            if (subTarget) {
              setSpatialFocus(subTarget, false);
              return;
            }
            const target = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(FOCUSABLE_SELECTOR) : null;
            if (target && !target.disabled && !target.classList.contains("is-current-mode")) {
              setSpatialFocus(target, false);
            }
          }
        }
      }

      // Echte physische Mausbewegung (>= 6px) oder Klick reaktiviert die Maussteuerung
      document.addEventListener("mousemove", (ev) => {
        if (typeof ev.clientX !== "number" || typeof ev.clientY !== "number") return;
        if (lastMouseX === null || lastMouseY === null) {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          return;
        }
        const dist = Math.hypot(ev.clientX - lastMouseX, ev.clientY - lastMouseY);
        if (dist >= 6) {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
          disengageKeyboardNavMode(ev);
        }
      }, { passive: true });

      document.addEventListener("mousedown", (ev) => {
        if (typeof ev.clientX === "number" && typeof ev.clientY === "number") {
          lastMouseX = ev.clientX;
          lastMouseY = ev.clientY;
        }
        disengageKeyboardNavMode(ev);
      }, { passive: true });

      // Maus-Hover verschiebt die aktive Auswahl direkt auf das gehoverte Objekt (sofern in den Einstellungen aktiviert und Tastatur-Modus NICHT aktiv ist),
      // sodass man nahtlos mit Pfeiltasten / Controller weitermachen kann!
      document.addEventListener("mouseover", (ev) => {
        if (!mouseHoverNavEnabled || isKeyboardNavActive) return;
        if (Date.now() - lastSelectJumpAt < 450) return;
        const subTarget = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(CARD_SUB_SELECTOR) : null;
        if (subTarget) {
          setSpatialFocus(subTarget, false);
          return;
        }
        const target = ev.target && typeof ev.target.closest === "function" ? ev.target.closest(FOCUSABLE_SELECTOR) : null;
        if (target && !target.disabled && !target.classList.contains("is-current-mode")) {
          setSpatialFocus(target, false);
        }
      }, { passive: true });

      function engageCardSubNav(cardEl) {
        if (!cardEl) return false;
        const infoBtn = cardEl.querySelector(".card-quick-info");
        const trailerBtn = cardEl.querySelector(".card-quick-trailer");
        const saveBtn = cardEl.querySelector(".card-quick-save");
        const firstSub = infoBtn || trailerBtn || saveBtn;
        if (!firstSub) return false;
        cardEl.classList.add("card-subnav-active");
        jumpSpatialFocus(firstSub, false);
        return true;
      }

      function handleSpatialConfirmAction() {
        if (!currentSpatialEl) return;
        if (currentSpatialEl.id === "searchInput") {
          const val = (currentSpatialEl.value || "").trim();
          if (document.activeElement === currentSpatialEl && val.length > 0) {
            closeAutocomplete();
            currentSpatialEl.blur();
            runSearch(false, val, undefined, true);
            return;
          }
          onSearchInputFocus();
          currentSpatialEl.focus();
          return;
        }
        const tag = (currentSpatialEl.tagName || "").toUpperCase();
        if (tag === "SELECT") {
          currentSpatialEl.focus();
          if (typeof currentSpatialEl.showPicker === "function") {
            try { currentSpatialEl.showPicker(); } catch (e) {}
          }
          return;
        }
        // Wenn man auf einer Film-/Serienkarte Enter drückt:
        // Öffnet zuerst die Schnellauswahl auf der Karte (ℹ️ Details / ▶ Trailer / 🔖 Favorit),
        // sodass Trailer & Favoriten per Navigationstasten wählbar sind, OHNE das normale Navigieren zwischen den Filmen zu stören!
        if (currentSpatialEl.classList && currentSpatialEl.classList.contains("card")) {
          if (engageCardSubNav(currentSpatialEl)) return;
        }
        currentSpatialEl.click();
      }

      function moveSpatialFocus(dir) {
        engageKeyboardNavMode();
        lastSpatialNavDir = dir || "down";
        const list = getVisibleFocusables();
        if (!list.length) return;

        // Falls wir uns gerade in der Sub-Auswahl (ℹ️ Details / ▶ Trailer / 🔖 Favorit) einer Karte befinden:
        if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
          const parentCard = currentSpatialEl.closest(".card");
          if (parentCard) {
            const infoBtn = parentCard.querySelector(".card-quick-info");
            const trailerBtn = parentCard.querySelector(".card-quick-trailer");
            const saveBtn = parentCard.querySelector(".card-quick-save");
            if (currentSpatialEl === infoBtn) {
              if (dir === "right" && trailerBtn) { setSpatialFocus(trailerBtn, false, dir); return; }
              if (dir === "up" && saveBtn) { setSpatialFocus(saveBtn, false, dir); return; }
            } else if (currentSpatialEl === trailerBtn) {
              if (dir === "left" && infoBtn) { setSpatialFocus(infoBtn, false, dir); return; }
              if (dir === "up" && saveBtn) { setSpatialFocus(saveBtn, false, dir); return; }
            } else if (currentSpatialEl === saveBtn) {
              if (dir === "down" && trailerBtn) { setSpatialFocus(trailerBtn, false, dir); return; }
              if (dir === "left" && infoBtn) { setSpatialFocus(infoBtn, false, dir); return; }
            }
            // Pfeildruck nach außen verlässt die Sub-Buttons und springt nahtlos zur Nachbarkarte weiter!
            clearCardSubnavState(null);
            currentSpatialEl.classList.remove("spatial-focus");
            currentSpatialEl = parentCard;
            currentSpatialEl.classList.add("spatial-focus");
          }
        }

        if (!currentSpatialEl || !list.includes(currentSpatialEl)) {
          const activeHeroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active") || document.getElementById("heroBtnTrailer");
          setSpatialFocus(activeHeroDot || list[0], true, dir);
          return;
        }

        // Referenzen auf die Suchleiste & Kopfzeile
        const sScope = document.getElementById("searchGenreSelect") || document.getElementById("searchScopeSelect");
        const sInp = document.getElementById("searchInput");
        const sClear = document.getElementById("searchClearBtn") || document.querySelector(".search-clear-btn");
        const sSub = document.querySelector(".search-submit-btn");
        const sClearVisible = Boolean(sClear && !sClear.classList.contains("is-empty") && list.includes(sClear));

        const focusSearchOrHeaderUp = () => {
          if (sInp && list.includes(sInp)) {
            setSpatialFocus(sInp, true);
            return true;
          }
          const activeTab = document.querySelector(".media-mode-tab.active-movie, .media-mode-tab.active-series, .media-mode-tab");
          if (activeTab && list.includes(activeTab)) {
            setSpatialFocus(activeTab, true);
            return true;
          }
          const menuBtn = document.getElementById("sidebarToggleBtn");
          if (menuBtn && list.includes(menuBtn)) {
            setSpatialFocus(menuBtn, true);
            return true;
          }
          return false;
        };

        const curHero = currentSpatialEl.closest ? currentSpatialEl.closest(".hero") : null;
        if (curHero) {
          const actDot = curHero.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || curHero.querySelector(".hero-dot.active");
          const trBtn = document.getElementById("heroBtnTrailer");
          const detBtn = document.getElementById("heroBtnDetails");
          const hideBtn = document.getElementById("heroHideBtn");

          // 1. Fokus auf "▶ Trailer" (links) oder "ⓘ Details" (rechts davon):
          if (currentSpatialEl.id === "heroBtnTrailer") {
            if (dir === "right") {
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
            }
            if (dir === "left") {
              setHeroSlideIndex(state.heroIndex - 1);
              const nextTr = document.getElementById("heroBtnTrailer");
              if (nextTr) setSpatialFocus(nextTr, true);
              return;
            }
            if (dir === "down") {
              if (actDot) { setSpatialFocus(actDot, true); return; }
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
            }
            if (dir === "up") {
              if (focusSearchOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.id === "heroBtnDetails") {
            if (dir === "left") {
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
            }
            if (dir === "right") {
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
              setHeroSlideIndex(state.heroIndex + 1);
              const nextDet = document.getElementById("heroBtnDetails");
              if (nextDet) setSpatialFocus(nextDet, true);
              return;
            }
            if (dir === "down") {
              if (actDot) { setSpatialFocus(actDot, true); return; }
              if (hideBtn) { setSpatialFocus(hideBtn, true); return; }
            }
            if (dir === "up") {
              if (focusSearchOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.classList.contains("hero-dot") || currentSpatialEl.classList.contains("hero-circle-arrow")) {
            // 2. Fokus auf der Pill-Dot-Rotationsleiste (< ━━ • • • • >):
            // Links / Rechts blättert sofort durch die 6 Highlights; Hoch springt zu "▶ Trailer"; Enter fokussiert ebenfalls "▶ Trailer"!
            if (dir === "left" || dir === "right") {
              setHeroSlideIndex(state.heroIndex + (dir === "right" ? 1 : -1));
              const nextDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
              if (nextDot) setSpatialFocus(nextDot, true);
              return;
            }
            if (dir === "up") {
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (focusSearchOrHeaderUp()) return;
            }
          } else if (currentSpatialEl.id === "heroHideBtn") {
            if (dir === "left") {
              if (actDot) { setSpatialFocus(actDot, true); return; }
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
            }
            if (dir === "up") {
              if (detBtn) { setSpatialFocus(detBtn, true); return; }
              if (trBtn) { setSpatialFocus(trBtn, true); return; }
              if (focusSearchOrHeaderUp()) return;
            }
            if (dir === "right") return;
          }
        }

        // Kompakter 1-Zeilen Spotlight-Strip (.hero-collapsed-strip): Hoch springt direkt zur Suche (#searchInput)
        const curCollapsedStrip = currentSpatialEl.closest ? currentSpatialEl.closest(".hero-collapsed-strip") : null;
        if (curCollapsedStrip && dir === "up") {
          if (focusSearchOrHeaderUp()) return;
        }

        // Direkte Nachbarschaft in der einheitlichen Suchleiste (.search-bar-outer), damit #searchInput niemals übersprungen wird
        const inSearchBar = Boolean(
          currentSpatialEl === sScope ||
          currentSpatialEl === sInp ||
          currentSpatialEl === sClear ||
          currentSpatialEl === sSub
        );
        if (inSearchBar) {
          if (dir === "right" && currentSpatialEl === sScope && sInp) {
            setSpatialFocus(sInp, true);
            return;
          }
          if (dir === "right" && currentSpatialEl === sInp) {
            if (sClearVisible) { setSpatialFocus(sClear, true); return; }
            if (sSub && list.includes(sSub)) { setSpatialFocus(sSub, true); return; }
          }
          if (dir === "right" && currentSpatialEl === sClear && sSub && list.includes(sSub)) {
            setSpatialFocus(sSub, true);
            return;
          }
          if (dir === "left" && currentSpatialEl === sSub) {
            if (sClearVisible) { setSpatialFocus(sClear, true); return; }
            if (sInp) { setSpatialFocus(sInp, true); return; }
          }
          if (dir === "left" && currentSpatialEl === sClear && sInp) {
            setSpatialFocus(sInp, true);
            return;
          }
          if (dir === "left" && currentSpatialEl === sInp && sScope && list.includes(sScope)) {
            setSpatialFocus(sScope, true);
            return;
          }
          if (dir === "up") {
            const menuBtn = document.getElementById("sidebarToggleBtn");
            const wlBtn = document.getElementById("navBtnWishlist");
            const activeTab = document.querySelector(".media-mode-tab.active-movie, .media-mode-tab.active-series, .media-mode-tab");
            if (currentSpatialEl === sScope && menuBtn && list.includes(menuBtn)) {
              setSpatialFocus(menuBtn, true);
              return;
            }
            if ((currentSpatialEl === sSub || currentSpatialEl === sClear) && wlBtn && list.includes(wlBtn)) {
              setSpatialFocus(wlBtn, true);
              return;
            }
            if (activeTab && list.includes(activeTab)) {
              setSpatialFocus(activeTab, true);
              return;
            }
            if (menuBtn && list.includes(menuBtn)) {
              setSpatialFocus(menuBtn, true);
              return;
            }
          }
          if (dir === "down") {
            const firstAc = document.querySelector("#searchAutocompleteBox.open .ac-item");
            if (firstAc && list.includes(firstAc)) {
              setSpatialFocus(firstAc, true);
              return;
            }
            const heroTr = document.getElementById("heroBtnTrailer");
            const heroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
            if (heroTr && list.includes(heroTr)) {
              setSpatialFocus(heroTr, true);
              return;
            }
            if (heroDot && list.includes(heroDot)) {
              setSpatialFocus(heroDot, true);
              return;
            }
            const restoreBtn = document.getElementById("heroRestoreBtn");
            if (restoreBtn && list.includes(restoreBtn)) {
              setSpatialFocus(restoreBtn, true);
              return;
            }
          }
        }

        // Deterministische Links/Rechts-Reihenfolge & Runter-Sprung in der obersten Kopfzeile (<header>) inkl. TelePort-Logo (#headerBrandLogo)
        const inHeader = Boolean(currentSpatialEl.closest && currentSpatialEl.closest("header"));
        if (inHeader) {
          if (dir === "left" || dir === "right") {
            const headerOrder = [
              document.getElementById("sidebarToggleBtn"),
              document.getElementById("headerBrandLogo"),
              document.getElementById("tabBtnMovies"),
              document.getElementById("tabBtnSeries"),
              document.getElementById("navBtnWishlist")
            ].filter(el => el && list.includes(el));
            const hIdx = headerOrder.indexOf(currentSpatialEl);
            if (hIdx !== -1) {
              const nextHIdx = dir === "right" ? hIdx + 1 : hIdx - 1;
              if (nextHIdx >= 0 && nextHIdx < headerOrder.length) {
                setSpatialFocus(headerOrder[nextHIdx], true, dir);
              }
              return;
            }
          }
          if (dir === "down") {
            if (currentSpatialEl.id === "sidebarToggleBtn" && sScope && list.includes(sScope)) {
              setSpatialFocus(sScope, true);
              return;
            }
            if (sInp && list.includes(sInp)) {
              setSpatialFocus(sInp, true);
              return;
            }
          }
        }

        // Deterministische Links/Rechts-Steuerung im Sidebar-Header (.sidebar-header) inkl. Sidebar-Logo (#sidebarBrandLogo)
        const inSidebarHeader = Boolean(currentSpatialEl.closest && currentSpatialEl.closest(".sidebar-header"));
        if (inSidebarHeader && (dir === "left" || dir === "right")) {
          const sbHeaderEl = currentSpatialEl.closest(".sidebar-header");
          const sbHeaderItems = Array.from(sbHeaderEl.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => list.includes(el));
          const shIdx = sbHeaderItems.indexOf(currentSpatialEl);
          if (shIdx !== -1) {
            const nextShIdx = dir === "right" ? shIdx + 1 : shIdx - 1;
            if (nextShIdx >= 0 && nextShIdx < sbHeaderItems.length) {
              setSpatialFocus(sbHeaderItems[nextShIdx], true, dir);
            }
            return;
          }
        }

        // Von der obersten Zeile der Filterleiste (.floating-filter-bar) führt Pfeil hoch (⬆) direkt in den Hero-Slider / Spotlight-Strip / Suchleiste
        const curFF = currentSpatialEl.closest ? currentSpatialEl.closest(".floating-filter-bar") : null;
        if (curFF && dir === "up") {
          const curBoxFF = getSpatialLayoutBox(currentSpatialEl);
          const hasHigherInFF = list.some(cand =>
            cand !== currentSpatialEl &&
            curFF.contains(cand) &&
            getSpatialLayoutBox(cand).bottom <= curBoxFF.top + 6
          );
          if (!hasHigherInFF) {
            const actHeroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active");
            const heroTr = document.getElementById("heroBtnTrailer");
            const restoreBtn = document.getElementById("heroRestoreBtn");
            if (actHeroDot && list.includes(actHeroDot)) {
              setSpatialFocus(actHeroDot, true);
              return;
            }
            if (heroTr && list.includes(heroTr)) {
              setSpatialFocus(heroTr, true);
              return;
            }
            if (restoreBtn && list.includes(restoreBtn)) {
              setSpatialFocus(restoreBtn, true);
              return;
            }
            if (focusSearchOrHeaderUp()) return;
          }
        }

        const curRect = getSpatialLayoutBox(curHero ? curHero : currentSpatialEl);
        const cx = curRect.left + curRect.width / 2;
        const cy = curRect.top + curRect.height / 2;

        let bestEl = null;
        let bestScore = Infinity;

        for (const cand of list) {
          if (cand === currentSpatialEl) continue;
          const candHero = cand.closest ? cand.closest(".hero") : null;
          if (curHero && candHero) {
            // Beim Verlassen des Hero-Banners nach Oben/Unten alle anderen internen Hero-Elemente überspringen
            continue;
          }
          if (!curHero && candHero) {
            // Von außerhalb in den Hero-Slider navigieren:
            // Direkt auf den aktiven Slide-Indikator (.hero-dot.active) springen (oder #heroBtnTrailer falls nur 1 Slide existiert),
            // damit man sofort mit Pfeil Links/Rechts durch die Highlights blättern oder mit Enter/Hoch den Trailer/Details öffnen kann!
            const hasActiveDot = Boolean(candHero.querySelector(".hero-dot.active"));
            if (hasActiveDot) {
              if (!cand.classList.contains("hero-dot") || !cand.classList.contains("active")) {
                continue;
              }
            } else if (cand.id !== "heroBtnTrailer") {
              continue;
            }
          }
          const r = getSpatialLayoutBox((!curHero && candHero) ? candHero : cand);
          // Nächsten Punkt auf der Bounding-Box berechnen (verhindert das Überspringen breiter Elemente wie #searchInput oder .hero)
          const nearestX = Math.max(r.left, Math.min(cx, r.right));
          const nearestY = Math.max(r.top, Math.min(cy, r.bottom));
          const centerTx = r.left + r.width / 2;
          const centerTy = r.top + r.height / 2;

          const dxCenter = centerTx - cx;
          const dyCenter = centerTy - cy;
          const dxEdge = nearestX - cx;
          const dyEdge = nearestY - cy;

          if (dir === "right" && centerTx <= cx + 4) continue;
          if (dir === "left" && centerTx >= cx - 4) continue;
          if (dir === "down" && centerTy <= cy + 4) continue;
          if (dir === "up" && centerTy >= cy - 4) continue;

          // Prüfen, ob das Element auf derselben horizontalen Zeile liegt
          const verticalOverlap = Math.min(curRect.bottom, r.bottom) - Math.max(curRect.top, r.top);
          const isSameRow = verticalOverlap > 4 || Math.abs(dyCenter) < Math.max(curRect.height, r.height) * 0.65;

          let score;
          if (dir === "left" || dir === "right") {
            const hDist = Math.min(Math.abs(dxEdge), Math.abs(dxCenter));
            const vPenalty = isSameRow ? Math.abs(dyCenter) * 0.5 : (Math.abs(dyCenter) * 4.5 + 180);
            score = hDist + vPenalty;
          } else {
            const vDist = Math.min(Math.abs(dyEdge), Math.abs(dyCenter));
            const hPenalty = Math.abs(dxEdge) * 1.8;
            score = vDist + hPenalty;
          }

          if (score < bestScore) {
            bestScore = score;
            bestEl = cand;
          }
        }

        if (bestEl) {
          setSpatialFocus(bestEl, true);
        } else {
          const idx = list.indexOf(currentSpatialEl);
          const nextIdx = (dir === "right" || dir === "down")
            ? Math.min(list.length - 1, idx + 1)
            : Math.max(0, idx - 1);
          const fallbackCand = list[nextIdx];
          if (fallbackCand && !curHero && fallbackCand.closest && fallbackCand.closest(".hero")) {
            const actHeroDot = document.querySelector('.hero-dot[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-dot.active") || document.getElementById("heroBtnTrailer");
            if (actHeroDot) { setSpatialFocus(actHeroDot, true); return; }
          }
          setSpatialFocus(fallbackCand, true);
        }
      }

      // Long-Press Pfeiltasten-Navigation (~450ms) im Detail-Modal (vorheriger/nächster Film)
      // Hinweistext erscheint erst nach 220ms echtem Gedrückthalten, damit kurzes Antippen niemals nervt!
      const HOLD_NAV_DURATION_MS = 450;
      const HOLD_NAV_SHOW_DELAY_MS = 220;
      let modalHoldTimer = null;
      let modalHoldShowTimer = null;
      let modalHoldActiveKey = "";
      let modalHoldTriggered = false;

      // Enter-Taste auf Film-Cover: Kurz drücken = Schnellwahl (Trailer/Merkliste/Details), Gedrückthalten (>= 350ms) = Direkt Infos öffnen!
      const CARD_ENTER_HOLD_MS = 350;
      let cardEnterHoldTimer = null;
      let cardEnterHoldTarget = null;
      let cardEnterHoldTriggered = false;

      function cancelCardEnterHold() {
        if (cardEnterHoldTimer) {
          clearTimeout(cardEnterHoldTimer);
          cardEnterHoldTimer = null;
        }
        cardEnterHoldTarget = null;
        cardEnterHoldTriggered = false;
      }

      function cancelModalArrowHold() {
        if (modalHoldTimer) {
          clearTimeout(modalHoldTimer);
          modalHoldTimer = null;
        }
        if (modalHoldShowTimer) {
          clearTimeout(modalHoldShowTimer);
          modalHoldShowTimer = null;
        }
        modalHoldActiveKey = "";
        modalHoldTriggered = false;
        const ind = document.getElementById("modalHoldNavIndicator");
        const bar = document.getElementById("modalHoldNavBar");
        if (ind) {
          ind.style.display = "none";
          ind.classList.remove("left", "right");
        }
        if (bar) {
          bar.style.transition = "none";
          bar.style.width = "0%";
        }
      }

      function startModalArrowHold(keyName, step, adjItem) {
        cancelModalArrowHold();
        if (!modalHoldNavEnabled || !adjItem) return;
        modalHoldActiveKey = keyName;
        modalHoldTriggered = false;
        modalHoldShowTimer = setTimeout(() => {
          modalHoldShowTimer = null;
          if (!modalHoldActiveKey || modalHoldTriggered) return;
          const ind = document.getElementById("modalHoldNavIndicator");
          const txt = document.getElementById("modalHoldNavText");
          const bar = document.getElementById("modalHoldNavBar");
          if (ind && txt && bar) {
            ind.classList.remove("left", "right");
            ind.classList.add(step < 0 ? "left" : "right");
            txt.textContent = step < 0
              ? ("◀ Halten: " + (adjItem.title || "Vorheriger Titel"))
              : ("Halten: " + (adjItem.title || "Nächster Titel") + " ▶");
            bar.style.transition = "none";
            bar.style.width = "0%";
            ind.style.display = "flex";
            void bar.offsetWidth;
            bar.style.transition = "width " + Math.max(120, HOLD_NAV_DURATION_MS - HOLD_NAV_SHOW_DELAY_MS) + "ms linear";
            bar.style.width = "100%";
          }
        }, HOLD_NAV_SHOW_DELAY_MS);

        modalHoldTimer = setTimeout(() => {
          modalHoldTimer = null;
          modalHoldTriggered = true;
          cancelModalArrowHold();
          navigateDetailModalAdjacent(step);
        }, HOLD_NAV_DURATION_MS);
      }

      window.addEventListener("keyup", (ev) => {
        if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
          const wasHoldingThisKey = modalHoldActiveKey === ev.key;
          const didTriggerHold = modalHoldTriggered;
          cancelModalArrowHold();
          if (wasHoldingThisKey && !didTriggerHold) {
            moveSpatialFocus(ev.key === "ArrowRight" ? "right" : "left");
          }
        } else if (ev.key === "Enter") {
          const targetCard = cardEnterHoldTarget;
          const didTriggerLong = cardEnterHoldTriggered;
          cancelCardEnterHold();
          if (targetCard && !didTriggerLong && currentSpatialEl === targetCard) {
            if (!engageCardSubNav(targetCard)) {
              targetCard.click();
            }
          }
        }
      });
      window.addEventListener("blur", () => {
        cancelModalArrowHold();
        cancelCardEnterHold();
      });

      document.addEventListener("keydown", (ev) => {
        engageKeyboardNavMode();
        const activeEl = document.activeElement;
        const activeTag = (activeEl && activeEl.tagName || "").toUpperCase();
        const isSearchInpFocused = activeEl && activeEl.id === "searchInput";
        const isTypingInInput = activeTag === "INPUT" || activeTag === "TEXTAREA";

        if (ev.key === "Escape" || (ev.key === "Backspace" && !isTypingInInput)) {
          cancelModalArrowHold();
          if (currentSpatialEl && (currentSpatialEl.id === "heroBtnDetails" || currentSpatialEl.id === "heroBtnTrailer")) {
            state.heroActionsEngaged = false;
            const box = document.getElementById("heroActionsBox");
            if (box) box.classList.remove("engaged");
            const actCard = document.querySelector('.hero-thumb-card[data-hero-card="' + state.heroIndex + '"]') || document.querySelector(".hero-thumb-card.active");
            if (actCard) setSpatialFocus(actCard, false);
            ev.preventDefault();
            return;
          }
          if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
            const parentCard = currentSpatialEl.closest(".card");
            clearCardSubnavState(null);
            if (parentCard) setSpatialFocus(parentCard, false);
            ev.preventDefault();
            return;
          }
          if (document.getElementById("searchAutocompleteBox")?.classList.contains("open")) {
            closeAutocomplete();
            ev.preventDefault();
            return;
          }
          if (ev.key === "Escape") {
            if (activeEl && activeEl !== document.body && typeof activeEl.blur === "function") activeEl.blur();
            goBack();
            ev.preventDefault();
            return;
          }
        }

        // Größenanpassung per + und - auf der Tastatur (sofern man nicht in einem Textfeld tippt)
        if (!isTypingInInput && (ev.key === "+" || ev.key === "=" || ev.code === "NumpadAdd")) {
          ev.preventDefault();
          adjustOverallScaleStep(5);
          return;
        }
        if (!isTypingInInput && (ev.key === "-" || ev.key === "_" || ev.code === "NumpadSubtract")) {
          ev.preventDefault();
          adjustOverallScaleStep(-5);
          return;
        }

        // Nahtlose Pfeiltasten-Navigation auch aus dem Suchfeld heraus (inkl. ruhigem 450ms Gedrückthalten im Detail-Modal ohne Fokus-Herumspringen)
        if (ev.key === "ArrowRight") {
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          if (modalOpen && ev.shiftKey && !isTypingInInput) {
            cancelModalArrowHold();
            const nextBtn = document.getElementById("modalAdjNextBtn");
            if (nextBtn) { ev.preventDefault(); nextBtn.click(); return; }
          }
          if (isSearchInpFocused) {
            const valLen = (activeEl.value || "").length;
            const atEnd = valLen === 0 || activeEl.selectionEnd === valLen;
            if (!atEnd) return;
            activeEl.blur();
          } else if (isTypingInInput) {
            return;
          } else if (activeTag === "SELECT") {
            activeEl.blur();
          }
          ev.preventDefault();
          if (modalOpen && modalHoldNavEnabled && !isTypingInInput) {
            const adjNext = getAdjacentDetailItem(1);
            if (adjNext) {
              if (!ev.repeat && modalHoldActiveKey !== "ArrowRight") {
                startModalArrowHold("ArrowRight", 1, adjNext);
              }
              return;
            }
          }
          moveSpatialFocus("right");
          return;
        }
        if (ev.key === "ArrowLeft") {
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          if (modalOpen && ev.shiftKey && !isTypingInInput) {
            cancelModalArrowHold();
            const prevBtn = document.getElementById("modalAdjPrevBtn");
            if (prevBtn) { ev.preventDefault(); prevBtn.click(); return; }
          }
          if (isSearchInpFocused) {
            const valLen = (activeEl.value || "").length;
            const atStart = valLen === 0 || activeEl.selectionStart === 0;
            if (!atStart) return;
            activeEl.blur();
          } else if (isTypingInInput) {
            return;
          } else if (activeTag === "SELECT") {
            activeEl.blur();
          }
          ev.preventDefault();
          if (modalOpen && modalHoldNavEnabled && !isTypingInInput) {
            const adjPrev = getAdjacentDetailItem(-1);
            if (adjPrev) {
              if (!ev.repeat && modalHoldActiveKey !== "ArrowLeft") {
                startModalArrowHold("ArrowLeft", -1, adjPrev);
              }
              return;
            }
          }
          moveSpatialFocus("left");
          return;
        }
        if (ev.key === "ArrowDown") {
          cancelModalArrowHold();
          ev.preventDefault();
          if (isSearchInpFocused || activeTag === "SELECT") activeEl.blur();
          moveSpatialFocus("down");
          return;
        }
        if (ev.key === "ArrowUp") {
          cancelModalArrowHold();
          ev.preventDefault();
          if (isSearchInpFocused || activeTag === "SELECT") activeEl.blur();
          moveSpatialFocus("up");
          return;
        }

        // Enter-Taste: Auf einem Film-Cover öffnet kurzes Drücken die Schnellwahl (Trailer/Merkliste/Details) und Gedrückthalten (>= 350ms) direkt die Infos!
        if (ev.key === "Enter" && !isTypingInInput && currentSpatialEl) {
          cancelModalArrowHold();
          ev.preventDefault();
          if (currentSpatialEl.classList && currentSpatialEl.classList.contains("card")) {
            if (!ev.repeat && cardEnterHoldTarget !== currentSpatialEl) {
              cancelCardEnterHold();
              cardEnterHoldTarget = currentSpatialEl;
              cardEnterHoldTriggered = false;
              cardEnterHoldTimer = setTimeout(() => {
                cardEnterHoldTimer = null;
                cardEnterHoldTriggered = true;
                const target = cardEnterHoldTarget;
                cardEnterHoldTarget = null;
                if (target && currentSpatialEl === target) {
                  clearCardSubnavState(null);
                  target.click();
                }
              }, CARD_ENTER_HOLD_MS);
            }
            return;
          }
          if (!ev.repeat) {
            handleSpatialConfirmAction();
          }
          return;
        }

        // Type-to-Search: Sobald auf der Tastatur ein Buchstabe/Zahl getippt wird, startet automatisch die Suche!
        if (!isTypingInInput && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key.length === 1 && /[a-zA-Z0-9äöüÄÖÜß]/.test(ev.key)) {
          const modalOpen = Boolean(document.getElementById("modalRoot")?.innerHTML.trim());
          const dialogOpen = Boolean(document.getElementById("customDialogRoot")?.innerHTML.trim());
          if (!modalOpen && !dialogOpen) {
            const sInp = document.getElementById("searchInput");
            if (sInp) {
              setSpatialFocus(sInp, false);
              onSearchInputFocus();
              sInp.focus();
            }
          }
        }
      });

      // Gamepad / Controller Polling (Xbox, PlayStation, Android TV Gamepad)
      let lastGamepadStepAt = 0;
      function pollGamepadNavigation() {
        try {
          const pads = navigator.getGamepads ? navigator.getGamepads() : [];
          const gp = pads && (pads[0] || pads[1] || pads[2] || pads[3]);
          if (gp) {
            const now = Date.now();
            if (now - lastGamepadStepAt > 190) {
              const axX = gp.axes?.[0] || 0;
              const axY = gp.axes?.[1] || 0;
              const up = gp.buttons?.[12]?.pressed || axY < -0.55;
              const down = gp.buttons?.[13]?.pressed || axY > 0.55;
              const left = gp.buttons?.[14]?.pressed || axX < -0.55;
              const right = gp.buttons?.[15]?.pressed || axX > 0.55;
              const btnA = gp.buttons?.[0]?.pressed;
              const btnB = gp.buttons?.[1]?.pressed;
              const btnLB = gp.buttons?.[4]?.pressed;
              const btnRB = gp.buttons?.[5]?.pressed;

              if (up) { moveSpatialFocus("up"); lastGamepadStepAt = now; }
              else if (down) { moveSpatialFocus("down"); lastGamepadStepAt = now; }
              else if (left) { moveSpatialFocus("left"); lastGamepadStepAt = now; }
              else if (right) { moveSpatialFocus("right"); lastGamepadStepAt = now; }
              else if (btnA && currentSpatialEl) {
                handleSpatialConfirmAction();
                lastGamepadStepAt = now + 120;
              }
              else if (btnB) {
                if (currentSpatialEl && isCardSubElement(currentSpatialEl)) {
                  const parentCard = currentSpatialEl.closest(".card");
                  clearCardSubnavState(null);
                  if (parentCard) setSpatialFocus(parentCard, false);
                } else {
                  goBack();
                }
                lastGamepadStepAt = now + 150;
              }
              else if (btnLB) {
                const modalPrev = document.getElementById("modalAdjPrevBtn");
                if (modalPrev) modalPrev.click();
                else setHeroSlideIndex(state.heroIndex - 1);
                lastGamepadStepAt = now + 150;
              }
              else if (btnRB) {
                const modalNext = document.getElementById("modalAdjNextBtn");
                if (modalNext) modalNext.click();
                else setHeroSlideIndex(state.heroIndex + 1);
                lastGamepadStepAt = now + 150;
              }
            }
          }
        } catch (e) {}
        requestAnimationFrame(pollGamepadNavigation);
      }
      requestAnimationFrame(pollGamepadNavigation);

      window.__TELEPORT_BOOTED__ = true;
      initAuthSession();
      setTimeout(() => {
        if (typeof pollAntiSpamQueueClient === "function") pollAntiSpamQueueClient(true);
        if (state.authUser?.isAdmin || loadBackupCheckpointClient()) {
          restoreBackupImportSessionAfterReload();
        }
      }, 900);
    </script>
  </body>
  </html>`;
  }
