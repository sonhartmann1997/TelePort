# Professionelles Redesign der Detailansicht (Apple TV+ / Netflix Standard)

Dieses Update verwandelt das Detail-Modal von einer unruhigen „Baukasten-Ansicht“ mit bunten Kästchen und doppelten Rahmen in eine ruhige, hochwertige Streaming-Detailseite nach dem Vorbild von Apple TV+ und Netflix – bei 100 % Erhalt aller Funktionen für Nutzer, VIPs und Administratoren.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle vier Gestaltungsentscheidungen setzen exakt deine Auswahl aus den Rückfragen um. Sämtliche Klick-Funktionen (Filterung nach FSK/Land/Genre/Jahr, Telegraph-Episodenguide, Versions-Switcher, Admin-Cover/Remap/Folgen-Korrektur, Einzel- & Staffel-Versand) bleiben vollständig erhalten.

- **Bestätigte Entscheidung 1 (Edle Metadaten- & Genre-Zeile statt Pill-Boxen)**: Die 9 grauen und grünen Kästchen unter dem Titel weichen einer klaren, einzeiligen Typografie-Leiste mit feinen Trennpunkten (`★ 7.6  ·  FSK 16  ·  45 Min.  ·  Südkorea  ·  1 Staffel (8 Folgen)  ·  Beendet`) sowie einer dezenten zweiten Zeile für die klickbaren Genres (`Drama  ·  Sci-Fi & Fantasy  ·  Mystery`).
- **Bestätigte Entscheidung 2 (Einzeilige Aktionsleiste ohne Regenbogen-Farben)**:
  - **Links (Hauptaktionen)**: Streaming-Anbieter-Button (als einziger farbiger Primär-Akzent) sowie *Merkliste* und *Ähnliche Titel* im ruhigen, einheitlichen Glas-Design.
  - **Rechts (Kompakte Werkzeug- & Admin-Icons)**: Dezente, einfarbige Glas-Buttons für *🖼️ Cover*, *🔄 Zuordnen*, *⚠️ Melden* und *⋯ Mehr*, sodass kein mehrzeiliger bunter Button-Umbruch mehr entsteht.
- **Bestätigte Entscheidung 3 (Kein doppelter Rahmen & kein Hilfetext über den Episoden)**: Die doppelt umrandete rote/blaue Box (*„Wohin soll die Datei gesendet werden?“*) und der lange zweizeilige Erklärtext über den Folgen entfallen komplett. Die Versandziel-Auswahl (`📤 Privat-Chat ▾` + `⚙️`) sitzt platzsparend direkt in der Staffel- bzw. Stream-Kopfzeile.
- **Bestätigte Entscheidung 4 (Edle Episoden-Zeilen)**:
  - **Links**: Kompaktes Episoden-Badge (`E01` in `tabular-nums`) + klarer **weißer Episodentitel** (statt grellem Hellblau).
  - **Rechts**: Aufgeräumter Stream-Button (`▶ 720p · 303 MB · DE`) und dezente Ghost-Icons (`✏️`, `⚠️`, `🔖`), die im Ruhezustand zurückhaltend sind und erst bei Hover/Fokus voll hervortreten.

---

## 1. Overview & Core Concept

- **Was das Redesign löst**:
  1. **Ruhe im Kopfbereich**: Das Auge erfasst sofort Titel, Bewertung, FSK, Laufzeit und Handlung, ohne von 9 verschiedenfarbigen Rahmen-Pills abgelenkt zu werden.
  2. **Klare Aktions-Hierarchie**: Statt 7 konkurrierender Signalfarben gibt es pro Bereich genau einen visuellen Anker.
  3. **Mehr Platz für Episoden & Streams**: Durch den Wegfall der verschachtelten Versandziel-Boxen und des Erklärtexts rücken die Episoden um rund 140 Pixel nach oben.
  4. **Professionelle Episoden-Liste**: Jede Folge liest sich ruhig und aufgeräumt wie in einer nativen Smart-TV- oder Apple-TV-App.

---

## 2. User Experience & Visual Design

- **Visueller Aufbau des neuen Detail-Modals**:
  1. **Cinematic Hero Header**:
     - Oben links dezentes Medien-Tag (`SERIE` / `FILM`) + Versions-Hinweis; oben rechts dezente Glas-Buttons für `◀` / `▶` / `✕`.
     - Unten links das scharfe Poster mit sanftem Schatten; rechts daneben der große Titel mit Jahreszahl, darunter die **einzeilige Metadaten-Zeile mit `·`-Trennpunkten**, die **klickbare Genre-Textzeile** und der kompakte Handlungs-Teaser.
  2. **Navigationstabs**:
     - Klare Unterstreichungs-Tabs (*Staffeln & Episoden*, *Versionen*, *Details & Trailer*).
  3. **Einzeilige Aktions- & Werkzeugleiste**:
     - Links: Primärer Anbieter-Button (falls vorhanden) + ruhige Glas-Buttons für *Merkliste* und *Ähnliche Titel*.
     - Rechts: Kompakte, einheitliche Werkzeug-Gruppe (`🖼️ Cover`, `🔄 Remap`, `⚠️ Melden`, `⋯ Mehr ▾`).
  4. **Integrierte Staffel- & Versandziel-Kopfzeile**:
     - Links die Staffel-Tabs (`Staffel 1 · 8`), rechts daneben der kompakte Versandziel-Umschalter (`📤 Privat`, `👥 Gruppe`, `🤖 Bot`, `⚙️`) und der Staffel-Sammelversand (`📦 Ganze Staffel`).
  5. **Edle Episoden-Zeilen (`.ep-row`)**:
     - Ruhige dunkle Oberfläche (`rgba(255, 255, 255, 0.025)`) mit feiner `1px`-Trennlinie.
     - Links: `S01E01`-Badge in Monospace + weißer Episodentitel.
     - Rechts: Eleganter Stream-Button + dezente Ghost-Icons (`✏️`, `⚠️`, `🔖`), die erst bei Zeilen-Hover/Fokus hervortreten.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Unboxed Typografie mit Trennpunkten statt Pill-Kapseln**
  - *Gewählter Ansatz*: `.modal-meta-inline` und `.modal-genre-inline` mit `·`-Separatoren; klickbare Elemente (FSK, Land, Genres) erhalten einen feinen Hover-Effekt statt einer farbigen Box.
  - *Warum*: Entspricht exakt dem Industriestandard führender Streaming-Plattformen und beseitigt die „Tag-Wolke“ im Kopfbereich.
- **Entscheidung 2: Direkte Integration des Versandziels in die Staffel-/Stream-Zeile**
  - *Gewählter Ansatz*: Einzeilige, flache Steuerleiste ohne verschachtelte `modal-sub-box`-Rahmen; das Konfigurations-Panel für Gruppen-ID / Bot-Token klappt nur bei Klick auf `⚙️` direkt darunter auf.
  - *Warum*: Verhindert „Box-in-Box“-Rahmen und spart wertvollen vertikalen Platz.
- **Entscheidung 3: Ghost-Action-Icons in den Episoden-Zeilen**
  - *Gewählter Ansatz*: `✏️`, `⚠️` und `🔖` sitzen rechts neben dem Stream-Button ohne schweren Kastenrahmen (`opacity: 0.55`) und leuchten bei Hover/Fokus der Zeile voll auf.
  - *Warum*: Reduziert bei einer Staffel mit 10–24 Folgen rund 30–70 überflüssige Button-Rahmen im Sichtfeld, während jede Funktion mit einem Klick erreichbar bleibt.

---

## 4. Technical Architecture & Data Strategy

### Layout- & Komponenten-Hierarchie im Detail-Modal

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         Detail-Modal (.modal)                             │
├───────────────────────────────────────────────────────────────────────────┤
│ 1. HERO HEADER (.modal-hero-banner)                                       │
│    ┌──────────┐  The Silent Sea (2021)                                    │
│    │  POSTER  │  ★ 7.6 · FSK 16 · 45 Min. · Südkorea · 1 St. (8 Flg.)     │
│    │  (2:3)   │  Drama · Sci-Fi & Fantasy · Mystery                       │
│    └──────────┘  Während einer gefährlichen 24-Stunden-Mission...         │
├───────────────────────────────────────────────────────────────────────────┤
│ 2. TABS (.flix-tabs-bar)                                                  │
│    [ Staffeln & Episoden ]    [ Versionen (1) ]    [ Details & Trailer ]  │
├───────────────────────────────────────────────────────────────────────────┤
│ 3. AKTIONEN (.modal-actions-row)                                          │
│    Links:  [ ▶ In Netflix öffnen ] [ 🔖 Merkliste ] [ ✨ Ähnliche ]        │
│    Rechts: [ 🖼️ Cover ] [ 🔄 Zuordnen ] [ ⚠️ ] [ ⋯ Mehr ▾ ]               │
├───────────────────────────────────────────────────────────────────────────┤
│ 4. STAFFEL- & VERSAND-LEISTE (.season-toolbar-row)                        │
│    Links:  [ Staffel 1 (8) ]                                              │
│    Rechts: 📤 [Privat|Gruppe|Bot|⚙️]  [ 📦 Staffel senden (8) ]           │
├───────────────────────────────────────────────────────────────────────────┤
│ 5. EPISODEN-LISTE (.ep-row)                                               │
│    [E01]  Die Forschungsstation auf dem Mond   [ ▶ 720p · 303 MB ] ✏️ ⚠️ 🔖 │
│    [E02]  Drei Lager                           [ ▶ 720p · 532 MB ] ✏️ ⚠️ 🔖 │
└───────────────────────────────────────────────────────────────────────────┘
```

### Interaktive Zustands- & Event-Zuordnung

1. **Hero-Metadaten & Genres (`openDetails`)**:
   - Aufbau eines Arrays aus Bewertung (`★ 7.6`), FSK (`FSK 16` mit `filterByCategoryFromModal('fsk', ...)`), Laufzeit, Land (mit `runSearch`), Staffel-/Folgenanzahl und Status, verbunden durch `<span class="modal-meta-dot">·</span>`.
   - Genres werden als `<button class="modal-genre-link">` mit `·`-Trennpunkten gerendert und lösen weiterhin die Genre-Filterung aus.
2. **Aktionsleiste & Admin-Tools (`openDetails`)**:
   - Alle sekundären und administrativen Buttons nutzen dezente Glas-Klassen (`.btn-glass-quiet` / `.btn-icon-quiet`), sodass nur der primäre Anbieter-/Stream-Button farbig hervortritt.
3. **Integrierte Versandziel-Steuerung (`buildModalDeliveryTargetSelectorHtml` & `loadSeason`)**:
   - Für Serien wird der kompakte Versandziel-Umschalter direkt in die Staffel-Kopfzeile (`#seasonBox`) eingebunden; für Filme steht er als schlanke Kopfzeile über den Film-Dateien – komplett ohne verschachtelte rote Außenbox.
4. **Episoden-Zeilen (`loadSeason`) & Sofort-Reload im Simulator**:
   - `.ep-row` trennt `S01E01` in ein kompaktes Monospace-Badge (`.ep-code-badge`) und den weißen Titel (`.ep-name-text`).
   - Zudem wird der Reload-Button im Simulator so erweitert, dass er `/worker.js` frisch lädt, damit alle Änderungen sofort ohne Browser-Hard-Refresh sichtbar sind.
