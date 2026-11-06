# TMDb-Suchkaskade & Nachbar-Post-Schutz (Feinschliff für >99% Trefferquote)

Dieser Plan ergänzt die drei fehlenden TMDb-Fallback-Stufen (**Untertitel-Cutter**, **Umlaut-Normalisierung `ae/oe/ue`** und **Doppelpunkt nach Römischen Zahlen**) sowie zwei harte Schutzmechanismen (**Jahres-Sperre gegen falsche Jahrzehnte** und **Collection-Header-/Detailtitel-Schutz**), um die letzten Fehlzuordnungen im Konflikt-Dashboard zu beseitigen.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle fünf Regeln aus deiner Analyse sind direkt als deterministische Stufen in der Server- und Client-Pipeline eingeplant:
> - **Kein Überschreiben detaillierter Dateinamen**: Besitzt ein Video bereits eine Fortsetzungs-Ziffer (`[1-9]`) oder einen Untertitel-Trenner (`-`, `–`, `:`) im Titel (z. B. *„Der König der Löwen 2 - Simbas Königreich“*), oder ist der Nachbar-Post ein Sammlungs-Header (*„teil 1 bis 3“*, *„1-3“*, *„Collection“*, *„Trilogie“*, *„Box“*), bleibt der eigene Dateinamen-Titel unangetastet; maximal die Beschreibung (`contextOverview`) wird übernommen.
> - **Harte Jahres-Sperre (`yearDiff > 2`)**: Weicht das Jahr des besten TMDb-Treffers um mehr als 2 Jahre vom Dateinamen-Jahr ab (z. B. *„Rotkäppchen (1954)“* vs. *„Die Rotkäppchen-Verschwörung (2005)“*), wird vorab noch geprüft, ob die Umlaut-Suche oder die Multi-API-Fallback-Kaskade (OMDb / Wikidata / Wikipedia DE) den exakten Jahrgang (`1954`) findet. Bleibt nur ein Treffer aus einem falschen Jahrzehnt übrig, wird dieser **zwingend** auf `status: "?"` (`needsReview: true`) gesetzt und niemals automatisch als `ok` durchgewunken.

---

## 1. Übersicht & Kernkonzept

- **Was umgesetzt wird**:
  1. **Doppelpunkt nach Römischen Zahlen (`Star Trek II` $\rightarrow$ `Star Trek II:`)**: Automatische Normalisierung von Titeln mit römischen Zahlen (`I` bis `X`) gefolgt von Leerzeichen und Großbuchstaben vor der TMDb-Suche.
  2. **Untertitel-Fallback (Bindestrich-/Doppelpunkt-Cutter)**: Schneidet bei 0 Treffern (oder wenn alle bisherigen Treffer am Jahres-Check scheitern) den deutschen Untertitel nach `-`, `–`, `—` oder `:` ab (z. B. *„Silk Road - Gebieter des Darknets“* $\rightarrow$ *„Silk Road“*) und sucht erneut mit und ohne Jahr.
  3. **Umlaut-Normalisierung (`ae`, `oe`, `ue` $\rightarrow$ `ä`, `ö`, `ü`)**: Wandelt ASCII-Umlaute wie in `Rotkaeppchen.1954.mp4` automatisch in echte deutsche Umlaute (`Rotkäppchen`) um, sobald der Original-String keine echten Umlaute enthält und keinen validen Treffer im Zieljahr liefert.
  4. **Harter Jahres-Schutz (`yearDiff > 2` $\rightarrow$ `status: "?"`)**: Verhindert, dass Filme mit > 2 Jahren Abweichung (z. B. 1954 vs. 2005) als `ok` gespeichert oder als sicherer Treffer gewertet werden.
  5. **Collection-Header- & Detailtitel-Schutz (`König der Löwen 2`)**: Schützt Einzel-Filme in `enrichVideoFromNeighborPost`, `enrichClientVideoFromNeighborPost` und `extractPreContext` davor, durch Trilogie-/Sammlungs-Posts (*„König der Löwen teil 1 bis 3“*) überschrieben zu werden.

---

## 2. Technische Architektur & Datenfluss

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. NACHBAR-POST & PRE-CONTEXT SCHUTZ (Backend & Client)                      │
│                                                                              │
│  Video: "Der König der Löwen 2 - Simbas Königreich (1998)"                   │
│  Nachbar (-2): "König der Löwen teil 1 bis 3"                                │
│    ├─ isCollectionHeader? (teil X bis Y / 1-3 / trilogie / collection / box) │
│    ├─ videoHasDetailedTitle? (enthält [1-9] oder "-" / "–" / ":")            │
│    └─ Falls JA: Titel NICHT überschreiben! Nur contextOverview übernehmen.   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. TMDB-SUCHKASKADE (searchTmdbCandidatesForImport & findOnTMDb*)            │
│                                                                              │
│  Stufe A: Römische Zahlen + Doppelpunkt                                      │
│    • /\b(I{1,3}|IV|V|VI{1,3}|IX|X)\s+([A-ZÄÖÜ])/g  ->  "$1: $2"              │
│    • "Star Trek II Der Zorn des Khan" -> "Star Trek II: Der Zorn des Khan"   │
│                                                                              │
│  Stufe B: Umlaut-Rekonstruktion (falls ae/oe/ue ohne ä/ö/üß)                 │
│    • "Rotkaeppchen" (1954) -> "Rotkäppchen" (1954)                           │
│    • Wird auch dann ausgeführt, wenn die ASCII-Suche nur falsche Jahrzehnte  │
│      (> 2 Jahre Abweichung) geliefert hat!                                   │
│                                                                              │
│  Stufe C: Untertitel-Cutter (Bindestrich / Doppelpunkt)                      │
│    • "Silk Road - Gebieter des Darknets" -> "Silk Road" (mit & ohne Jahr)    │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. HARTER JAHRES-SCHUTZ (Keine falschen Jahrzehnte!)                         │
│                                                                              │
│  • Prüfe: Math.abs(tmdbYear - parsed.year) > 2                               │
│  • Falls alle TMDb-Kandidaten > 2 Jahre abweichen (z.B. 1954 vs. 2005):      │
│      1. Prüfe Multi-API-Fallback (OMDb / Wikidata / Wikipedia DE) für 1954   │
│      2. Falls weiterhin > 2 Jahre Abweichung:                                │
│         -> Zwingend status = "?", contextError = true, needsReview = true    │
│         -> Niemals automatisch als status = "ok" durchwinken!                │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Wichtige Produkt- & Logik-Entscheidungen

1. **Warum `Rotkaeppchen (1954)` bisher `Die Rotkäppchen-Verschwörung (2005)` vorschlug**:
   - **Ursache**: Wenn die Suche ohne Umlaut (`Rotkaeppchen`) oder ohne Jahr bereits irgendeinen Treffer in `rawPool` legte (`rawPool.length > 0`), wurde die Umlaut-Suche (`Rotkäppchen`) übersprungen oder das 2005er-Ergebnis blieb als einziger Kandidat übrig. Zudem stufte `cleanMovieQuery` römische Zahlen wie `II` in `2` um und löschte die Zahl hinter `Star Trek`.
   - **Lösung**:
     1. Vor der Suche wird `romanColonTitle` (`Star Trek II: Der Zorn des Khan`) gebildet und vorrangig abgefragt; `cleanMovieQuery` löscht keine Nummern mehr hinter `Star Trek`.
     2. Die Umlaut-Normalisierung (`ae/oe/ue` $\rightarrow$ `ä/ö/ü`) läuft immer, sobald `/(?:ae|oe|ue)/i.test(cleanTitle) && !/[äöüß]/i.test(cleanTitle)` zutrifft und noch kein Kandidat mit passendem Jahr (`yearDiff <= 2`) gefunden wurde.
     3. Weicht der beste TMDb-Treffer um mehr als 2 Jahre vom Dateinamen-Jahr ab (`yearDiff > 2`), wird die Multi-API-Kaskade (OMDb/Wikidata/Wikipedia) nach dem exakten Jahrgang (`1954`) gefragt; bleibt es bei `yearDiff > 2`, wird der Eintrag strikt mit `status: "?"` (`needsReview: true`) als Konflikt markiert.

2. **Doppelter Schutz gegen Collection-Header (`König der Löwen teil 1 bis 3`)**:
   - Sowohl in `extractPreContext` / `extractClientPreContextFromMsg` (Vorab-Kontext) als auch in `enrichVideoFromNeighborPost` / `enrichClientVideoFromNeighborPost` (Nachbar-Posts `+1/-1/+2/-2`) werden Sammel-Überschriften (`teil 1 bis 3`, `1-3`, `collection`, `trilogie`, `box`) erkannt und blockiert, damit sie niemals den Einzeltitel eines Films überschreiben.
