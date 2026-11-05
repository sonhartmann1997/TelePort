# UX- & Streaming-UI Ausbau (Runde 2): Aufgeräumte Poster-Karten, Kompaktes Detail-Modal & Visuelle Merkliste

Dieses Update verfeinert die zentralen Nutzer-Berührungspunkte der Streaming-Oberfläche (Katalog-Karten, Detail-Ansicht und persönliche Merkliste), damit Film- und Serien-Cover wieder im Mittelpunkt stehen und alle Werkzeuge für Nutzer, VIPs und Administratoren klar gegliedert und sofort erreichbar sind.

## User Review & Critical Decisions

> [!IMPORTANT]
> Alle Entscheidungen basieren direkt auf deiner Auswahl aus den Rückfragen. Es gehen **keinerlei Funktionen** verloren – sämtliche Schnell-Aktionen, Admin-Werkzeuge und Merklisten-Optionen bleiben vollständig erhalten.

- **Bestätigte Entscheidung 1 (Poster-Karten im Hauptkatalog)**: Auf den Cover-Bildern sind dauerhaft nur das Lesezeichen (`🔖` / `✓`) und der dezente grüne VIP-Punkt sichtbar (plus Top-10-Rang im Trending-Modus). Die Zusatz-Buttons (`ℹ️ Details` und `▶ Trailer`) erscheinen sanft erst bei Maus-Hover oder Tastatur-/TV-Fokus, damit die Poster auf Smartphones und kleineren Bildschirmen nicht mehr verdeckt werden.
- **Bestätigte Entscheidung 2 (Detail-Modal Aktionsleiste & Admin-Leiste)**: Die Aktionsbuttons unterhalb der Tabs werden in zwei saubere Ebenen getrennt:
  1. **Primäre Nutzer-Leiste**: *Merkliste*, *Ähnliche Titel*, Streaming-Anbieter-Links, *Fehler melden* (für VIP/Admin) und *Mehr ▾* (Teilen, Bot-Link, Telegraph, Original-Poster/Szenenbild).
  2. **Eigene kompakte Admin-Leiste** (nur für eingeloggte Administratoren sichtbar): Dezente, klar abgegrenzte Werkzeugzeile für *🖼️ Cover ändern* und *🔄 Titel/Serie neu zuordnen (Remap)*.
- **Bestätigte Entscheidung 3 (Kompaktes Versandziel im Detail-Modal)**: Die Box *„Versandziel (Privat-Chat / Gruppe / Eigener Bot)“* oberhalb der Streams und Episoden startet standardmäßig als schlanke, einzeilige Status-Leiste (z. B. `📤 Versandziel: Privat-Chat (Bot-DM) • Ändern ▾`) und klappt die Konfigurationsfelder erst bei Klick auf.
- **Bestätigte Entscheidung 4 (Merkliste mit Poster-Grid & Listen-Umschalter)**: In der Merkliste wird ein Ansicht-Umschalter (`🖼️ Poster-Grid` | `📋 Kompakt-Liste`) ergänzt. Nutzer können ihre gespeicherten Filme, Serien und Playlisten wahlweise als visuelles Poster-Raster (wie im Hauptkatalog) oder als detaillierte Liste mit aufklappbaren Serien-Folgen durchsuchen.

---

## 1. Overview & Core Concept

- **Was wird verbessert**:
  1. **Freier Blick auf alle Film- & Serien-Poster**: Keine überladenen Button-Stapel mehr auf kleinen Cover-Karten, während Hover/Fokus am Desktop/Smart-TV weiterhin direkten Zugriff auf Instant-Trailer und Details bietet.
  2. **Sofortige Orientierung im Detail-Modal**: Durch die Trennung von Nutzer-Aktionen und Admin-Werkzeugen sowie das einklappbare Versandziel rücken Episodenliste und Stream-Buttons deutlich weiter nach oben in den sichtbaren Bereich.
  3. **Visuelles Stöbern in der eigenen Merkliste**: Gespeicherte Titel und eigene Playlisten lassen sich jetzt wahlweise als echtes Streaming-Poster-Grid oder als kompakte Verwaltungsliste darstellen.
- **Zielgruppe**: Reguläre Nutzer, VIP-Streaming-Mitglieder und Administratoren auf Smartphone (Telegram Mini App), Desktop und Smart-TV.
- **Mehrwert**: Deutlich ruhigeres, hochwertiges Erscheinungsbild mit kürzeren Klickwegen und besserer Übersicht auf allen Bildschirmgrößen.

---

## 2. User Experience & Visual Design

- **Wichtige Nutzer-Abläufe (User Flows)**:
  1. **Stöbern im Katalog**: Der Nutzer sieht im Grid die vollständigen Film- und Serienposter mit Titel, Bewertung und Jahr. Ein Tipp auf `🔖` speichert den Titel sofort; ein Tipp auf das Poster öffnet das Detail-Modal; bei Hover/Fokus blenden sich `ℹ️ Details` und `▶ Trailer` sanft ein.
  2. **Streamen & Verwalten im Detail-Modal**: Direkt unter den Tabs (*Staffeln & Episoden / Streams*, *Versionen*, *Details & Trailer*) befindet sich die aufgeräumte Nutzer-Aktionsleiste. Darunter erscheint für Admins eine kompakte Admin-Toolbar. Im Stream-Tab zeigt eine einzeilige Status-Bar das aktuelle Telegram-Versandziel und lässt sich bei Bedarf mit einem Klick aufklappen.
  3. **Merkliste nutzen**: Über den neuen Umschalter oben rechts in der Filterleiste der Merkliste wechselt der Nutzer verzögerungsfrei zwischen der **Poster-Grid-Ansicht** (große Cover, Schnell-Löschen-Button, Folgen-Badge bei Serien) und der **Listen-Ansicht** (kompakte Zeilen mit aufklappbarem Episoden-Drawer).
- **Visuelle Identität & Theme**:
  - *Ästhetische Richtung*: Modernes, ruhiges Streaming-Interface (Obsidian & Glas) mit strikter 60-30-10 Farbverteilung.
  - *Farbpalette & Kontraste*: Dunkle Tiefenebenen (`--bg: #0b0d13`, `--surface: #12151e`, `--card: #181c28`), feine `1px`-Rahmen (`rgba(255, 255, 255, 0.08)`) und gezielte Akzentfarben nur für aktive Zustände und primäre Aktionen (`--accent: #e50914`, VIP-Smaragd `#10b981`, Admin-Violett `#8b5cf6`).
  - *Typografie & Zahlen*: Klare Hierarchie mit `tabular-nums` für Bewertungen, Jahreszahlen, Episoden-Codes (`S01E01`) und Dateigrößen.
- **Interaktives Feedback & Motion**:
  - Sanfte `opacity`- und `transform`-Übergänge (`160ms cubic-bezier(0.16, 1, 0.3, 1)`) für die Hover-/Fokus-Buttons auf den Poster-Karten.
  - Persistente Speicherung der gewählten Merklisten-Ansicht (`grid` vs. `list`) in `localStorage`, damit die bevorzugte Ansicht beim nächsten Öffnen erhalten bleibt.

---

## 3. Key Product Decisions & Trade-Offs

- **Entscheidung 1: Hover-/Fokus-Steuerung auf Poster-Karten statt dauerhafter Überlagerung**
  - *Gewählter Ansatz*: Dauerhaft nur `🔖` (oben rechts) und VIP-Punkt/Rang (oben links); `ℹ️ Details` und `▶ Trailer` erscheinen bei `:hover` und `:focus-within`.
  - *Warum*: Auf Smartphones führt ein Tipp auf die Karte ohnehin direkt ins Detail-Modal (inkl. Trailer), während auf Desktop und Smart-TV der Hover- bzw. D-Pad-Fokus die Schnell-Buttons sofort einblendet.
- **Entscheidung 2: Eigene kompakte Admin-Leiste im Detail-Modal**
  - *Gewählter Ansatz*: Eine dezente zweite Zeile mit feinem Rahmen und Label `👑 Admin-Werkzeuge:` für *🖼️ Cover ändern* und *🔄 Neu zuordnen*.
  - *Warum*: Verhindert, dass die primäre Aktionsleiste umbricht, und gruppiert administrative Eingriffe logisch an einem festen Platz.
- **Entscheidung 3: Einzeilige Versandziel-Kompaktleiste als Standard**
  - *Gewählter Ansatz*: Standardmäßig eingeklappte Zusammenfassung des aktiven Versandziels (Bot-DM, Gruppe oder eigener Bot) mit direktem Button `⚙️ Ziel ändern ▾`.
  - *Warum*: Da das Versandziel meist einmal eingestellt wird, spart die eingeklappte Darstellung im Detail-Modal rund 120 Pixel vertikale Höhe für Episoden und Streams.

---

## 4. Technical Architecture & Data Strategy

### Architektur- & Komponenten-Diagramm

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Streaming & TMA Frontend State                       │
│  state.wlViewMode ('grid' | 'list')  •  modalDeliveryConfigExpanded     │
└───────────────┬─────────────────────────────┬───────────────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────────┐ ┌───────────────────────────────────────┐
│   Katalog & Merklisten-View   │ │       Detail-Modal (openDetails)      │
├───────────────────────────────┤ ├───────────────────────────────────────┤
│ • Poster-Karten:              │ │ • Primäre Nutzer-Aktionsleiste        │
│   - Dauerhaft: 🔖 + VIP-Dot   │ │   (Merkliste, Ähnliche, Melden, Mehr) │
│   - Hover/Fokus: ℹ️ + ▶       │ │ • Separate kompakte Admin-Leiste      │
│ • Merklisten-Umschalter:      │ │   (👑 Cover ändern, Neu zuordnen)     │
│   - 📋 Listen-Ansicht (Drawer)│ │ • Kompakter Versandziel-Header        │
│   - 🖼️ Poster-Grid-Ansicht    │ │   (Einzeilig + Aufklapp-Konfigurator) │
└───────────────────────────────┘ └───────────────────────────────────────┘
```

### Interaktive Zustands- & Event-Zuordnung

1. **Poster-Karten CSS & Interaktion**:
   - `.card-quick-info` und `.card-quick-trailer` erhalten standardmäßig `opacity: 0; pointer-events: none; transform: translateY(4px)` und wechseln bei `.card:hover`, `.card:focus-within` sowie `.card.spatial-focus` auf `opacity: 1; pointer-events: auto; transform: translateY(0)`.
   - `.card-quick-save` (`🔖` / `✓`) und `.card-vip-dot` bleiben permanent sichtbar.
2. **Detail-Modal Aktions- & Admin-Leiste (`openDetails`)**:
   - Trennung der bisherigen Button-Reihe in `.modal-user-actions-bar` und (falls `isAdminUser === true`) `.modal-admin-toolbar`.
   - `buildModalDeliveryTargetSelectorHtml()` rendert im eingeklappten Zustand (`modalDeliveryConfigExpanded === false`) eine schlanke Status-Zeile mit aktivem Ziel-Badge und Toggle-Button; nur bei `modalDeliveryConfigExpanded === true` (oder wenn im Gruppen-Modus noch keine Gruppen-ID hinterlegt ist) wird das volle Konfigurations-Panel ausgeklappt.
3. **Merklisten-Ansicht (`setWishlistViewMode`, `renderWishlistListItemsMountOnly`)**:
   - Neuer State `state.wlViewMode = localStorage.getItem("tma_wl_view_mode") || "grid"` (bzw. `"list"`).
   - Umschalter-Buttons `🖼️ Poster-Grid` und `📋 Liste` in der Schnellfilter-Leiste der Merkliste.
   - Im Modus `grid` werden die gefilterten Merklisten-Einträge als `.carousel`-Poster-Karten (inkl. Folgen-Zähler-Badge bei Serien, Qualitäts-Info und `🗑️`-Schnelllösch-Button) gerendert; im Modus `list` bleibt die bisherige Listen-Ansicht inklusive ausklappbarem Episoden-Drawer unverändert verfügbar.
