# Story Design Manual – Modul 2A  
**Version 2.0 (mit Auswahlmöglichkeiten, Twist-Ebene & modularem Kodex)**  
Dieses Dokument definiert die generische, logische Struktur für Storys.  
Es ist KI-modellunabhängig und wird als lebendes Dokument gepflegt.  

---

## 1. Allgemeine Hinweise @CHAPTER:1

### 1.1 Zweck
- Generischer Baukasten für Stories
- KI-unabhängig

### 1.2 Parsing-Regeln
`@SECTION:ParsingRules`

#### **Grundsätze** `@REQUIRED`
1. **Sektionen**
   - Beginn mit `@SECTION:<id>`
   - Ende beim nächsten `@SECTION` oder Dokumentende
   - `<id>` nur ASCII (keine Umlaute)

2. **Pflichtgrad**
   - `@REQUIRED` = Pflichtfelder
   - `@OPTIONAL` = optionale Felder
   - Gültig bis zum nächsten `@REQUIRED`, `@OPTIONAL` oder `@SECTION`

3. **Felder**
   - `@FIELD:<id>` markiert ein Feld
   - ASCII-IDs (z. B. `tonalitaet` statt `Tonalität`)
   - Werte folgen als Freitext oder in `[...]`-Listen
   - **Hinweis:** Tags können zur Lesbarkeit in Backticks stehen; der Parser ignoriert Backticks.

4. **Listen**
   - Syntax: `[A | B | C]`
   - Parser: split on `|`, trim whitespace
   - `|` darf in Werten nicht vorkommen
   - Zeilenumbruch nach einem `@FIELD:` ist erlaubt: die **nächste** Zeile muss mit `[` beginnen und mit `]` enden (Mehrzeilenlisten unterstützt).

5. **Auto-Direktiven**
   - `@AUTO:<field_id> key=value …` auf **eigener Zeile**
   - **Pflichtkeys:**  
     - `mode`: `synth` (erfinden), `lookup` (reale Werke), `hybrid`  
     - `from`: kommagetrennte Eingabefelder (z. B. `genre,themenmotive`)  
     - `k`: Anzahl Elemente  
     - `output`: `works-real` | `works-generic` | `bullets` | `tags` | `number` | `json` | `text`  
     - `format`: `list` | `json` | `text`
   - **Optionale Keys:** `seed`, `policy`
   - **Zeichensetzung:** nur ASCII; Zahlenbereiche als `3-5`.

6. **Zeichenregeln**
   - Pfeile `->`/Dekozeichen sind zulässig; Parser ignoriert sie
   - Zahlenbereiche: ASCII `3-5` statt `3–5`

7. **Eindeutigkeit**
   - Feld-IDs pro Sektion eindeutig
   - Duplikate → Warnung

---

#### Operatoren
- `@FORBID: <Begriff>` → strikt verboten (Hard Ban)
- `@ALLOW_ONLY: <feld> = {wert1, wert2, ...}` → Whitelist (nur diese Werte erlaubt)
- `@ALLOW: <feld> = <wert>` → Wert ist explizit erlaubt (sofern nicht durch Whitelist/FORBID ausgeschlossen)
- `@SET: <key> = <value>` → setzt ein Kontext-Flag (z. B. `freigabe = PG-16`)
- `@CONTEXT: <aspekt> = {vorgabe1, ...}` → inhaltliche/tonale Leitplanke (weich, prüfbar)
- `@GUIDE: <hinweis>` → stilistische Leitlinie (weich, nicht hart prüfbar)
- `@LENGTH: <feld> = <value>` → Begrenzt die Länge eines Feldes
- `@TEXT_LENGTH: <feld> = <value>` → Begrenzt die Anzahl der Wörter eines Textes. 

**Bedingungen:**  
- Regeln können Felder konditionieren, z. B.:  
  `@RULE: if @FIELD:age=16 then @ALLOW: ...`  
- Vergleich nur gegen **exakte** Feldwerte der Definitionen aus dem Manual (z. B. `age ∈ {12,16,18}`).

---

#### Priorität & Aggregation
- **Priorität (von stark nach schwach):**  
  `FORBID` ➜ `ALLOW_ONLY` ➜ `ALLOW` ➜ `SET` ➜ `CONTEXT/GUIDE`
- **Aggregation über alle Kapitel (inkl. Plattform-Regeln):**  
  Effektiv erlaubt = **Schnittmenge** aller Erlaubnisse; alles per `FORBID` ist **immer** ausgeschlossen.  
  `ALLOW_ONLY` verengt die erlaubte Menge; mehrere `ALLOW_ONLY` bilden die **Schnittmenge** ihrer Mengen.

---

#### Wildcards & Token-Gleichheit
- `*` (Stern) als **Wildcard** steht für „alle Werte der zugehörigen Auswahlliste“ eines Feldes.
- **Token-Gleichheit:** Feldwerte müssen **1:1** zu den in den Listen (z. B. in 2.1) definierten Einträgen passen (Groß-/Kleinschreibung, Umlaute, Wortlaut). Abweichende Schreibweisen gelten als **nicht gematcht**.

---

#### Auswertungsreihenfolge (Pipeline)
1) **Felder lesen** (`@FIELD:*`)  
2) **AUTO ausführen** (`@AUTO:*`) und resultierende Felder/Listen auffüllen
3) **Längenregeln** (@LENGTH:*`, @TEXT_LENGTH:*`) prüfen und überlange Feldinhalte kürzen oder kennzeichnen“
4) **Kodex anwenden** (`@RULES:K*`) mit Bedingungen (`if @FIELD:...`)  
5) **Konfliktlösung** nach Priorität & Aggregation (siehe oben)  
6) **Weiche Vorgaben** (`@CONTEXT`/`@GUIDE`) als Stil-/Prüfhinweise beilegen

---

#### Fehlerbehandlung (Parser)
- **Unbekanntes Feld** in `@AUTO: from=...` oder in `@RULE`: Warnung + Regel wird ignoriert.
- **Wert nicht in Liste** bei `ALLOW/ALLOW_ONLY`: Warnung + Wert wird verworfen.
- **Widerspruch** (z. B. `ALLOW` eines per `FORBID` gebannten Werts): `FORBID` gewinnt; Log schreibt Konflikt.

### 1.3. Gültigkeit & Beispiele
- 5 universelle Themenfelder: Abenteuer/Quest · Konflikt/Machtspiel · Beziehung/Emotion · Überleben/Gefahr · Transformation/Erkenntnis
- Validierungsstories:  
  - **Herr der Ringe** (Abenteuer/Quest + Überleben)  
  - **Romeo & Julia** (Beziehung/Emotion + Konflikt)


---
# 2 Storyframe-Builder @CHAPTER:2
## 2.1 StoryFrame `@SECTION:StoryFrame`

### **MUSS** `@REQUIRED`
- **Titel (1 Satz, frei)**  `@FIELD:titel`
- **Pitch (1 Satz, frei)** `@FIELD:pitch`
- **Sprache (Auswahl)**  `@FIELD:sprache`
  
  [deutsch | englisch]
  
- **Alter (Auswahl)**  `@FIELD:age`
  
  [12 | 16 | 18]

- **Plattform (Auswahl)**  `@FIELD:platform`
  [twitch | tiktok | youtube | other]

- **Genre (Auswahl)**  `@FIELD:genre`
  
  [Abenteuer | Fantasy | Science-Fiction | Mystery | Krimi | Thriller | Horror | Drama | Liebesgeschichte | Komödie | Historisch | Western | Kriegsstory | Sport | Slice-of-Life | Familiengeschichte | Coming-of-Age | Politisches Drama | Justiz/Anwaltsstory | Medizin/Spital]

- **Tonalität (Auswahl)**  `@FIELD:tonalitaet`
  
  [Episch | Düster | Hoffnungsvoll | Humorvoll | Tragisch | Leichtfüßig | Spannend | Beklemmend | Gritty | Warmherzig | Melancholisch | Satirisch | Ominös | Inspirierend | Gelassen]

- **Zielgruppe (Auswahl)**  `@FIELD:zielgruppe`
  
  [Kinder | Mittelstufe | Teen | Young Adult | Erwachsene | All Ages]

- **Dauer / Umfang (Auswahl)**  `@FIELD:dauer_umfang`
  
  [Kurz (3-5 Szenen) | Mittel (3 Kapitel) | Lang (10 Kapitel) | Staffel/Endlos]


  
### OPTIONAL `@OPTIONAL`
- **Themenmotive (Liste)**  `@FIELD:themenmotive`
  
  [Freiheit vs. Kontrolle | Vertrauen vs. Misstrauen | Identität | Gerechtigkeit | Opfer | Verrat | Loyalität | Macht | Erlösung | Rache | Hoffnung vs. Verzweiflung | Tradition vs. Wandel | Schicksal vs. freier Wille | Wahrheit vs. Lüge | Liebe vs. Hass | Leben vs. Tod]

- **Tabus / No-Gos (Auswahl)**  `@FIELD:tabus`
  
  [Explizite Gewalt | Sexualisierte Inhalte | Kindeswohlgefährdung | Diskriminierung | Suizid | Religion | Politik | Terrorismus | Kriegsverherrlichung | Folter | Drogenmissbrauch | Alkohol-Glorifizierung | Glücksspiel | Vulgärsprache]

- **Inspirationsanker**  `@FIELD:inspirationsanker_frame`
  
  automatisch generiert aus Genre + Themenmotive → liefert reale Werke als Vergleich  
  `@AUTO:inspirationsanker mode=lookup from=genre,themenmotive k=5 output=works-real format=list`

- **Darstellungsstil**  `@FIELD:darstellungsstil`
  
  [Kurz & knapp | Detailliert | Kreativ/poetisch]

---

## 2.2 Canon/World
`@SECTION:CanonWorld`

### **MUSS** `@REQUIRED`
- **Epoche / Setting (Auswahl)**  `@FIELD:epoche_setting`
  
  [Antike | Mittelalter | Frühe Neuzeit | Moderne (20. Jh.) | Gegenwart | Zukunft (Sci-Fi) | Alternative Realität | Fantasiewelt]

- **Technologie-/Magie-Level (Auswahl)**  `@FIELD:tech_magie_level`
  
  [Realistisch | Magisch (selten) | Magisch (häufig) | Hochtechnologisch | Mischform]

- **Weltregeln**  `@FIELD:weltregeln`
  
  automatisch generiert abhängig von Setting + Technologie/Magie-Level (5-7 Bulletpoints)  
  `@AUTO:weltregeln mode=synth from=epoche_setting,tech_magie_level k=7 output=bullets format=list`

- **Werteordnung / Tabus (Auswahl)**  `@FIELD:werteordnung`
  
  [Ehre > Leben | Familie > Individuum | Macht > Moral | Freiheit > Sicherheit | Religion > Staat | Schicksal > freier Wille]



### OPTIONAL `@OPTIONAL`
- **Weltmotive / Symbolik**  `@FIELD:weltmotive`
  
  [Licht vs. Dunkelheit | Natur vs. Zivilisation | Ordnung vs. Chaos | Tradition vs. Fortschritt]

- **Kulturelle Besonderheiten**  `@FIELD:kulturelle_besonderheiten`
  
  [Religion | Politik | Gesellschaftsschichten | Rituale | Sprache | Kleidung]

- **Naturgesetze (Auswahl)**  `@FIELD:naturgesetze`
  
  [Normal | Verändert (ewige Nacht, toxische Luft) | Übernatürlich (sprechende Tiere, lebendige Elemente)]

- **Inspirationsanker**  `@FIELD:inspirationsanker_canon`
  
  automatisch generiert aus Setting + Tech/Magie-Level + Motiven → liefert reale Werke als Vergleich  
  `@AUTO:inspirationsanker mode=lookup from=epoche_setting,tech_magie_level,weltmotive k=5 output=works-real format=list`


---

## 2.3 Cast
`@SECTION:Cast`

### **MUSS** `@REQUIRED`
- **Protagonist – Ziel**  `@FIELD:protagonist_ziel`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:protagonist_ziel mode=synth from=genre,themenmotive k=1 output=text format=text`

- **Protagonist – Need**  `@FIELD:protagonist_need`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:protagonist_need mode=synth from=genre,themenmotive k=1 output=text format=text`

- **Protagonist – Schwäche**  `@FIELD:protagonist_schwaeche`
   
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:protagonist_schwaeche mode=synth from=genre,themenmotive k=1 output=text format=text`

- **Antagonist – Gegenziel**  `@FIELD:antagonist_gegenziel`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:antagonist_gegenziel mode=synth from=genre,themenmotive k=1 output=text format=text`

- **Antagonist – Bedrohung**  `@FIELD:antagonist_bedrohung`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:antagonist_bedrohung mode=synth from=genre,themenmotive k=1 output=text format=text`

- **Antagonist – Limit**  `@FIELD:antagonist_limit`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:antagonist_limit mode=synth from=genre,themenmotive k=1 output=text format=text`

- **Beziehung Prota ↔ Anta – Kernkonflikt (1-2 Sätze)**  `@FIELD:konflikt`
    
  automatisch generiert aus Protagonist- und Antagonist-Feldern  
  `@AUTO:konflikt mode=synth from=protagonist_ziel,protagonist_need,protagonist_schwaeche,antagonist_gegenziel,antagonist_bedrohung,antagonist_limit k=1 output=text format=text`



### OPTIONAL @OPTIONAL
- **Nebenfiguren (Archetypen zur Auswahl)**  `@FIELD:nebenfiguren`
  
  [Mentor | Unterstützer | Rival | Trickster/Narr | Neutraler Beobachter | Katalysator | Anführer | Verführer | Opfer | Schiedsrichter | Rebell | Wächter | Visionär | Gefallener Held | Schatten-Doppelgänger | Kind/Unschuld | Gestaltwandler | Herold]

- **Nebenarcs**  `@FIELD:nebenarcs`
  
  automatisch generiert aus Archetypen  
  `@AUTO:nebenarcs mode=synth from=nebenfiguren k=3 output=bullets format=list`

- **Beziehungsnetz (Matrix: Vertrauen, Rivalität, Abhängigkeit, Loyalität, Verrat)**  `@FIELD:beziehungsnetz`
    
  automatisch generiert aus Protagonist-, Antagonist- und Nebenfiguren-Feldern  
  `@AUTO:beziehungsnetz mode=synth from=protagonist_ziel,protagonist_need,protagonist_schwaeche,antagonist_gegenziel,antagonist_bedrohung,antagonist_limit,nebenfiguren k=1 output=json format=json`


---

## 2.4 Arcs
`@SECTION:Arcs`

### **MUSS** `@REQUIRED`
- **Hauptarc – Verlauf**  `@FIELD:hauptarc`
   
  automatisch generiert: Startzustand → Wendepunkte → Finale  
  `@AUTO:hauptarc mode=synth from=genre,themenmotive,protagonist_ziel,antagonist_gegenziel k=1 output=bullets format=list`



### OPTIONAL `@OPTIONAL`
- **Nebenarcs**  `@FIELD:nebenarcs`
  
  automatisch generiert: Beziehung, Figurenentwicklung, Nebenquest  
 `@AUTO:nebenarcs mode=synth from=nebenfiguren,beziehungsnetz k=3 output=bullets format=list`

- **Parallelarcs**  `@FIELD:parallelarcs`
   
  automatisch generiert: parallele Handlungsstränge  
  `@AUTO:parallelarcs mode=synth from=hauptarc,nebenarcs k=2 output=bullets format=list`

- **Thematische Arcs (Auswahl)**  `@FIELD:thematische_arcs`
  
  [Vertrauen vs. Misstrauen | Freiheit vs. Kontrolle | Liebe vs. Hass | Leben vs. Tod | Wahrheit vs. Lüge | Tradition vs. Wandel | Opfer vs. Egoismus | Gerechtigkeit vs. Korruption | Mensch vs. Natur | Individuum vs. Gesellschaft | Schicksal vs. freier Wille]

- **Twist-Arcs (Allgemeine Muster)**  `@FIELD:twist_arcs_muster`
   
  [Antagonist wird Verbündeter | Verbündeter als Verräter | Opfer war Täter | Held ist Teil des Problems | Mentor mit eigener Agenda | „Alles nur ein Test“ | Doppelte Täuschung | Identitätstausch | Verborgene Herkunft | Vergessene Erinnerung | Prophezeiung falsch | Bösewicht als Spiegelbild | Ziel entpuppt sich als Fluch]

- **Twist-Arcs (Generisch)**  `@FIELD:twist_arcs_generisch`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:twist_arcs_generisch mode=synth from=genre,themenmotive k=3 output=bullets format=list`

- **Spiegelarcs**  `@FIELD:spiegelarcs`
  
  automatisch generiert: Figuren entwickeln sich gegensätzlich  
  `@AUTO:spiegelarcs mode=synth from=protagonist_ziel,antagonist_gegenziel k=1 output=bullets format=list`


---

## 2.5 Chapters
`@SECTION:Chapters`

### **MUSS** `@REQUIRED`
- **Kapitelanzahl**  `@FIELD:kapitelanzahl`
  
  mindestens 3 Kapitel (Anfang – Mitte – Ende)  
  `@AUTO:kapitelanzahl mode=synth from=hauptarc k=1 output=number format=text`

- **Kapitelstruktur**  `@FIELD:kapitelstruktur`
  
  jedes Kapitel enthält Ziel, Hauptkonflikt, Cliffhanger  
  `@AUTO:kapitelstruktur mode=synth from=hauptarc,protagonist_ziel,antagonist_gegenziel k=3 output=bullets format=list`



### OPTIONAL `@OPTIONAL`
- **Rhythmus / Pacing (Auswahl)**  `@FIELD:rhythmus_pacing`
  
  [Ruhe → Spannung → Auflösung | Exposition → Konflikt → Eskalation | Wechsel Action/Ruhe | Steigende Intensität | Zirkulär (Beginn = Ende)]

- **Kapitel-Labels**  `@FIELD:kapitel_labels`
  
  [Nummeriert | Thematisch | Symbolisch]

- **Parallele Kapitelstränge**  `@FIELD:kapitelstraenge`
  
  automatisch generiert, wenn parallele Handlungsbögen existieren  
  `@AUTO:kapitelstraenge mode=synth from=parallelarcs k=2 output=bullets format=list`

- **Thematische Kapitel-Bögen (Auswahl)**  `@FIELD:kapitel_boegen`
   
  [Einführung → Konfrontation → Entscheidung | Hoffnung → Verrat → Opfer | Aufstieg → Krise → Transformation | Harmonie → Konflikt → Zerstörung | Ordnung → Chaos → neue Ordnung]

- **Twist-Kapitel (Allgemeine Muster)**  `@FIELD:twist_kapitel_muster`
   
  [Perspektivwechsel | Verlust wichtiger Figur | Enthüllung falscher Infos | Rückblende mit neuer Bedeutung | abruptes Ende in scheinbar gelöster Szene]

- **Twist-Kapitel (Generisch)**  `@FIELD:twist_kapitel_generisch`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:twist_kapitel_generisch mode=synth from=genre,themenmotive k=2 output=bullets format=list`


---

## 2.6 Scenes
`@SECTION:Scenes`

### **MUSS** `@REQUIRED`
- **Ort & Timebox**  `@FIELD:ort_timebox`
  
  automatisch generiert: Szene erhält einen Ort und eine Zeitspanne  
  `@AUTO:ort_timebox mode=synth from=kapitelstruktur,epoche_setting k=1 output=text format=text`

- **Intent**  `@FIELD:intent`
  
  automatisch generiert: Absicht/Ziel der Szene  
  `@AUTO:intent mode=synth from=hauptarc,kapitelstruktur k=1 output=text format=text`

- **Konflikt / Hindernis**  `@FIELD:konflikt_hindernis`
  
  automatisch generiert: Konflikt oder Hindernis für die Figuren  
  `@AUTO:konflikt_hindernis mode=synth from=protagonist_ziel,antagonist_gegenziel,kapitelstruktur k=1 output=text format=text`

- **Stakes (Auswahl)**  `@FIELD:stakes`
  
  [Leben/Gefahr | Beziehung/Vertrauen | Ressourcen | Moral/Integrität]

- **Hook / Mini-Cliff**  `@FIELD:hook`
  
  automatisch generiert: Spannungsanker am Szenenende  
  `@AUTO:hook mode=synth from=konflikt_hindernis,stakes k=1 output=text format=text`



### OPTIONAL `@OPTIONAL`
- **Figureneinführung/-entwicklung**  `@FIELD:figurenentwicklung`
  
  automatisch generiert: Einführung oder Entwicklung einer Figur  
  `@AUTO:figurenentwicklung mode=synth from=protagonist_ziel,nebenfiguren,kapitelstruktur k=1 output=text format=text`

- **Emotionale Farbe (Auswahl)**  `@FIELD:emotionale_farbe`
  
  [Humorvoll | Romantisch | Bedrohlich | Tragisch | Hoffnungsvoll | Spannend | Düster | Inspirierend]

- **Symbolik / Leitmotiv**  `@FIELD:symbolik`
   
  automatisch generiert: symbolische Elemente passend zur Szene  
  `@AUTO:symbolik mode=synth from=themenmotive,weltmotive k=1 output=text format=text`

- **Foreshadowing**  `@FIELD:foreshadowing`
  
  automatisch generiert: Andeutung auf spätere Ereignisse  
  `@AUTO:foreshadowing mode=synth from=hauptarc,kapitelstruktur k=1 output=text format=text`

- **Parallelität**  `@FIELD:parallelitaet`
  
  automatisch generiert: Parallele Szenenstränge  
  `@AUTO:parallelitaet mode=synth from=parallelarcs,kapitelstraenge k=1 output=bullets format=list`

- **Twist-Szenen (Allgemeine Muster)**  `@FIELD:twist_szenen_muster`
  
  [Sicherheit → Gefahr | Verrat | Vertrauter Ort bedrohlich | Retter = Bedrohung | Naturereignis bricht Konflikt | Perspektivwechsel]

- **Twist-Szenen (Generisch)**  `@FIELD:twist_szenen_generisch`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:twist_szenen_generisch mode=synth from=genre,themenmotive k=2 output=bullets format=list`


---

## 2.7 DecisionPoints
`@SECTION:DecisionPoints`

### **MUSS** `@REQUIRED`
- **Optionenanzahl**  `@FIELD:optionenanzahl`
  
  automatisch generiert: 2–4 valide Optionen  
  `@AUTO:optionenanzahl mode=synth from=konflikt_hindernis,stakes k=1 output=number format=text`

- **Optionsvielfalt**  `@FIELD:optionsvielfalt`
  
  automatisch generiert: Optionen spiegeln unterschiedliche Werte (z. B. Risiko vs. Sicherheit, Moral vs. Pragmatik, Nähe vs. Distanz, Egoismus vs. Opfer, Tradition vs. Wandel, Wahrheit vs. Lüge)  
  `@AUTO:optionsvielfalt mode=synth from=themenmotive,konflikt_hindernis k=3 output=bullets format=list`

- **Konsequenzen**  `@FIELD:konsequenzen`
  
  automatisch generiert: jede Option hat klare Konsequenzen  
  `@AUTO:konsequenzen mode=synth from=optionsvielfalt,stakes k=3 output=bullets format=list`

- **Relevanz**  `@FIELD:relevanz`
  
  automatisch generiert: Entscheidung verändert den State  
  `@AUTO:relevanz mode=synth from=optionsvielfalt,konsequenzen k=1 output=text format=text`



### OPTIONAL `@OPTIONAL`
- **Entscheidungsarten (Auswahl)**  `@FIELD:entscheidungsarten`
  
  [Strategisch | Moralisch | Beziehungsorientiert | Ressourcenorientiert | Emotional]

- **Twist-Entscheidungen (Allgemeine Muster)**  `@FIELD:twist_entscheidungen_muster`
   
  [Verdeckte Konsequenz | Doppelte Bedeutung | Falsche Sicherheit | Verzögerte Wirkung | Entscheidung unter Unsicherheit]

- **Twist-Entscheidungen (Generisch)**  `@FIELD:twist_entscheidungen_generisch`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:twist_entscheidungen_generisch mode=synth from=genre,themenmotive k=2 output=bullets format=list`


---

## 2.8 Outcomes
`@SECTION:Outcomes`

### **MUSS** `@REQUIRED`
- **Direkte Folgen (Kurztext 1–2 Sätze)**  `@FIELD:direkte_folgen`
  
  automatisch generiert für jede Entscheidung  
  `@AUTO:direkte_folgen mode=synth from=konsequenzen,relevanz k=1 output=text format=text`

- **State-Veränderung (Auswahl)**  `@FIELD:state_veraenderung`
  
  [Vertrauen ± | Beziehung ± | Ressourcen ± | Gesundheit ± | Hinweis/Spur ± | Bekanntheit ±]

- **Kausalität**  `@FIELD:kausalitaet`
  
  automatisch generiert: logische Verknüpfung zwischen Entscheidung und Folge  
  `@AUTO:kausalitaet mode=synth from=konsequenzen,state_veraenderung k=1 output=text format=text`

- **Fortführbarkeit**  `@FIELD:fortfuehrbarkeit`
  
  automatisch generiert: wie lässt sich die Story nach dieser Folge fortsetzen  
  `@AUTO:fortfuehrbarkeit mode=synth from=direkte_folgen,kausalitaet k=1 output=text format=text`



### OPTIONAL `@OPTIONAL`
- **Erweiterte Folgen**  `@FIELD:erweiterte_folgen`
   
  automatisch generiert: Mehrfachwirkungen, Symbolik, Ambivalenz, Narrative Flags  
  `@AUTO:erweiterte_folgen mode=synth from=direkte_folgen,konsequenzen k=3 output=bullets format=list`

- **Twist-Folgen (Allgemeine Muster)**  `@FIELD:twist_folgen_muster`
   
  [Verdeckte Wirkung | Unerwartete Belohnung | Kettenreaktion | Opfer = Gewinn | Täuschung]

- **Twist-Folgen (Generisch)**  `@FIELD:twist_folgen_generisch`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:twist_folgen_generisch mode=synth from=genre,themenmotive k=2 output=bullets format=list`


---

# 3. Übergreifende Normen (Kodex) @CHAPTER:3

# K1 Gewalt & Hass `@RULES:K1`

## Regeln für age = 12
- `@RULE: if @FIELD:age=12 then @FORBID: explizite Gewalt/Gore`
- `@RULE: if @FIELD:age=12 then @ALLOW: Kämpfe = angedeutet`
- `@RULE: if @FIELD:age=12 then @ALLOW_ONLY: Hass = {abstrakt}`

## Regeln für age = 16
- `@RULE: if @FIELD:age=16 then @ALLOW: leichte Gewalt mit Blut`
- `@RULE: if @FIELD:age=16 then @ALLOW: psychologische Bedrohung`
- `@RULE: if @FIELD:age=16 then @ALLOW_ONLY: Hass = {abstrakt, symbolisch}`

## Regeln für age = 18
- `@RULE: if @FIELD:age=18 then @ALLOW: Gewalt = explizit`
- `@RULE: if @FIELD:age=18 then @FORBID: Gewaltverherrlichung`
- `@RULE: if @FIELD:age=18 then @FORBID: sexualisierte Gewalt`
- `@RULE: if @FIELD:age=18 then @CONTEXT: Hass = {kritisch, verurteilend}`


# K2 Altersfreigabe & Detailgrad `@RULES:K2`

## Regeln für age = 12
- `@RULE: if @FIELD:age=12 then @SET: freigabe = PG-13`
- `@RULE: if @FIELD:age=12 then @ALLOW_ONLY: Gewalt = {abstrakt}`
- `@RULE: if @FIELD:age=12 then @FORBID: Sex`
- `@RULE: if @FIELD:age=12 then @ALLOW_ONLY: Sprache = {jugendfrei}`

## Regeln für age = 16
- `@RULE: if @FIELD:age=16 then @SET: freigabe = PG-16`
- `@RULE: if @FIELD:age=16 then @ALLOW: Gewalt = moderat`
- `@RULE: if @FIELD:age=16 then @ALLOW: Sex = angedeutet`
- `@RULE: if @FIELD:age=16 then @ALLOW: Sprache = moderate Schimpfwörter`

## Regeln für age = 18
- `@RULE: if @FIELD:age=18 then @SET: freigabe = PG-18`
- `@RULE: if @FIELD:age=18 then @ALLOW: Gewalt = explizit`
- `@RULE: if @FIELD:age=18 then @FORBID: Gewaltverherrlichung`
- `@RULE: if @FIELD:age=18 then @ALLOW: Sex = angedeutet`  # keine Pornografie
- `@RULE: if @FIELD:age=18 then @ALLOW: Sprache = frei`    # außer Hard Bans


# K3 Entscheidungs-Filter `@RULES:K3`
- `@RULE: Keine Option darf Hard Bans (z. B. Folter, Vergewaltigung, Suizid-Anleitung) erzwingen`
- `@RULE: Jede Entscheidung muss >= 1 ethisch vertretbare Option haben`


# K4 Magie/Tech-Budget `@RULES:K4`
- `@RULE: Jede übernatürliche/technische Lösung hat Kosten`
- `@RULE: Keine Allmacht, keine deus-ex-machina Lösungen`


# K5 Bias-/Stereotypie-Limit `@RULES:K5`
- `@RULE: Keine Ethnie/Religion/Orientierung als Negativ-Trope`
- `@RULE: Antagonisten über Motive, nicht über Herkunft definieren`
- `@RULE: Machtgefälle-Beziehungen nicht romantisieren`


# K6 Kontinuität/Kausalität `@RULES:K6`
- `@RULE: Twists nur, wenn kausal logisch`
- `@RULE: Entscheidungen behalten Wirkung, keine völlige Annulierung`


# K7 Sprache/Ton `@RULES:K7`

## Regeln für age = 12
- `@RULE: if @FIELD:age=12 then @FORBID: Schimpfwörter`

## Regeln für age = 16
- `@RULE: if @FIELD:age=16 then @ALLOW: leichte Schimpfwörter`
- `@RULE: if @FIELD:age=16 then @FORBID: Slurs`

## Regeln für age = 18
- `@RULE: if @FIELD:age=18 then @ALLOW: starke Schimpfwörter`
- `@RULE: if @FIELD:age=18 then @FORBID: diskriminierende Slurs`

### Plattformabhängig
- `@RULE: Plattformregeln setzen ggf. strengere Grenzen`


# K8 Plattform-Safe `@RULES:K8`
- `@RULE: Plattform-AGB haben Priorität`
- `@RULE: if @FIELD:platform=twitch then @FORBID: Sex-Content`
- `@RULE: if @FIELD:platform=twitch then @FORBID: Drogen`
- `@RULE: if @FIELD:platform=twitch then @FORBID: extreme Gore`
- `@RULE: if @FIELD:platform=tiktok then @FORBID: strengere Sprache/Gewalt`
- `@RULE: if @FIELD:platform=youtube then @ALLOW: mittlere Toleranz (zwischen Twitch & TikTok)`
- `@RULE: (Weitere Plattformmodule erweiterbar)`

---

# K9 Genre-Limit und Kombinationsverbote `@RULES:K9`

- `@RULE: if count(@FIELD:genre) > 3 then @FORBID: genre`

- `@RULE: if @FIELD:genre[0]=Abenteuer then @FORBID:genre[1]=Justiz/Anwaltsstory`
- `@RULE: if @FIELD:genre[0]=Justiz/Anwaltsstory then @FORBID:genre[1]=Abenteuer`

- `@RULE: if @FIELD:genre[0]=Abenteuer then @FORBID:genre[1]=Medizin/Spital`
- `@RULE: if @FIELD:genre[0]=Medizin/Spital then @FORBID:genre[1]=Abenteuer`

- `@RULE: if @FIELD:genre[0]=Fantasy then @FORBID:genre[1]=Justiz/Anwaltsstory`
- `@RULE: if @FIELD:genre[0]=Justiz/Anwaltsstory then @FORBID:genre[1]=Fantasy`

- `@RULE: if @FIELD:genre[0]=Fantasy then @FORBID:genre[1]=Medizin/Spital`
- `@RULE: if @FIELD:genre[0]=Medizin/Spital then @FORBID:genre[1]=Fantasy`

- `@RULE: if @FIELD:genre[0]=Fantasy then @FORBID:genre[1]=Politisches Drama`
- `@RULE: if @FIELD:genre[0]=Politisches Drama then @FORBID:genre[1]=Fantasy`

- `@RULE: if @FIELD:genre[0]=Horror then @FORBID:genre[1]=Sport`
- `@RULE: if @FIELD:genre[0]=Sport then @FORBID:genre[1]=Horror`

- `@RULE: if @FIELD:genre[0]=Horror then @FORBID:genre[1]=Western`
- `@RULE: if @FIELD:genre[0]=Western then @FORBID:genre[1]=Horror`

- `@RULE: if @FIELD:genre[0]=Komödie then @FORBID:genre[1]=Justiz/Anwaltsstory`
- `@RULE: if @FIELD:genre[0]=Justiz/Anwaltsstory then @FORBID:genre[1]=Komödie`

- `@RULE: if @FIELD:genre[0]=Komödie then @FORBID:genre[1]=Kriegsstory`
- `@RULE: if @FIELD:genre[0]=Kriegsstory then @FORBID:genre[1]=Komödie`

- `@RULE: if @FIELD:genre[0]=Komödie then @FORBID:genre[1]=Medizin/Spital`
- `@RULE: if @FIELD:genre[0]=Medizin/Spital then @FORBID:genre[1]=Komödie`

- `@RULE: if @FIELD:genre[0]=Komödie then @FORBID:genre[1]=Politisches Drama`
- `@RULE: if @FIELD:genre[0]=Politisches Drama then @FORBID:genre[1]=Komödie`

- `@RULE: if @FIELD:genre[0]=Liebesgeschichte then @FORBID:genre[1]=Kriegsstory`
- `@RULE: if @FIELD:genre[0]=Kriegsstory then @FORBID:genre[1]=Liebesgeschichte`

- `@RULE: if @FIELD:genre[0]=Liebesgeschichte then @FORBID:genre[1]=Sport`
- `@RULE: if @FIELD:genre[0]=Sport then @FORBID:genre[1]=Liebesgeschichte`

- `@RULE: if @FIELD:genre[0]=Western then @FORBID:genre[1]=Medizin/Spital`
- `@RULE: if @FIELD:genre[0]=Medizin/Spital then @FORBID:genre[1]=Western`

- `@RULE: if @FIELD:genre[0]=Fantasy then @FORBID:genre[1]=Kriegsstory`
- `@RULE: if @FIELD:genre[0]=Kriegsstory then @FORBID:genre[1]=Fantasy`

- `@RULE: if @FIELD:genre[0]=Horror then @FORBID:genre[1]=Justiz/Anwaltsstory`
- `@RULE: if @FIELD:genre[0]=Justiz/Anwaltsstory then @FORBID:genre[1]=Horror`

- `@RULE: if @FIELD:genre[0]=Horror then @FORBID:genre[1]=Politisches Drama`
- `@RULE: if @FIELD:genre[0]=Politisches Drama then @FORBID:genre[1]=Horror`

- `@RULE: if @FIELD:genre[0]=Kriegsstory then @FORBID:genre[1]=Medizin/Spital`
- `@RULE: if @FIELD:genre[0]=Medizin/Spital then @FORBID:genre[1]=Kriegsstory`

- `@RULE: if @FIELD:genre[0]=Sport then @FORBID:genre[1]=Medizin/Spital`
- `@RULE: if @FIELD:genre[0]=Medizin/Spital then @FORBID:genre[1]=Sport`

---

# 4. Story-Algorithmus Builder @CHAPTER:4

## 4.1 Baustein 1 – Einleitung / Hook @SECTION:Hook

### **MUSS** `@REQUIRED`
- **Hook (1 Satz, frei)** `@FIELD:hook`
- **Setup – Alltag des Protagonisten** `@FIELD:setup`  
  automatisch generiert aus Cast- und Canon-Feldern  
  `@AUTO:setup mode=synth from=protagonist_ziel,protagonist_need,protagonist_schwaeche,epoche_setting k=1 output=text format=text`
- **Zuschauerfrage (frei)** `@FIELD:zuschauerfrage`  
  `@TEXT_LENGTH: zuschauerfrage = 12`  
  `@GUIDE: Zuschauerfrage offen formulieren; keine Lösung vorwegnehmen.`

### OPTIONAL `@OPTIONAL`
- **Hook-Stil (Auswahl)** `@FIELD:hook_stil`  
  [Überraschend | Fragend | Bildhaft | Aktion | Zitat | Humor]
- **Hook-Inspiration (Liste)** `@FIELD:hook_inspiration`  
  automatisch generiert aus Genre, Tonalität und Themenmotive  
  `@AUTO:hook_inspiration mode=lookup from=genre,tonalitaet,themenmotive k=3 output=bullets format=list`

---

## 4.2 Baustein 2 – Charaktere & Setting @SECTION:CharactersSetting

### **MUSS** `@REQUIRED`
- **Protagonisten-Vorstellung (1–2 Sätze)** `@FIELD:char_intro`  
  automatisch generiert aus Cast-Feldern  
  `@AUTO:char_intro mode=synth from=protagonist_ziel,protagonist_need,protagonist_schwaeche k=1 output=text format=text`
- **Antagonisten-Vorstellung (1–2 Sätze)** `@FIELD:antagonist_intro`  
  automatisch generiert aus Cast-Feldern  
  `@AUTO:antagonist_intro mode=synth from=antagonist_gegenziel,antagonist_bedrohung,antagonist_limit k=1 output=text format=text`
- **Orts- und Zeitrahmen (1 Satz)** `@FIELD:setting_description`  
  automatisch generiert aus Canon/World  
  `@AUTO:setting_description mode=synth from=epoche_setting,tech_magie_level,weltregeln k=1 output=text format=text`

### OPTIONAL `@OPTIONAL`
- **Nebenfiguren (Liste)** `@FIELD:side_characters`  
  automatisch generiert oder manuell ergänzbar  
  `@AUTO:side_characters mode=synth from=genre,themenmotive k=3 output=bullets format=list`
- **Setting-Details (Liste)** `@FIELD:setting_details`  
  automatisch generiert aus Canon/World  
  `@AUTO:setting_details mode=synth from=epoche_setting,tech_magie_level,weltmotive k=3 output=bullets format=list`

`@GUIDE: Beschreibungen sollen klar sein und neugierig machen, ohne spätere Wendungen vorwegzunehmen.`

---

## 4.3 Baustein 3 – Konflikt / Auslöser @SECTION:Conflict

### **MUSS** `@REQUIRED`
- **Auslöser (1–2 Sätze)** `@FIELD:ausloeser`  
  automatisch generiert aus Cast-Konflikt und Storyframe  
  `@AUTO:ausloeser mode=synth from=konflikt,protagonist_ziel,antagonist_gegenziel k=1 output=text format=text`
- **Zentrale Bedrohung oder Zielkonflikt (1 Satz)** `@FIELD:hauptkonflikt`  
  automatisch generiert aus Cast-Feldern  
  `@AUTO:hauptkonflikt mode=synth from=konflikt,antagonist_bedrohung,antagonist_limit k=1 output=text format=text`
- **Einsatz / Stakes (1 Satz)** `@FIELD:stakes`  
  automatisch generiert aus Protagonist-Ziel, Need und Weltregeln  
  `@AUTO:stakes mode=synth from=protagonist_ziel,protagonist_need,weltregeln k=1 output=text format=text`

### OPTIONAL `@OPTIONAL`
- **Foreshadowing-Elemente (Liste)** `@FIELD:foreshadowing`  
  automatisch generiert aus Genre und Themenmotive  
  `@AUTO:foreshadowing mode=synth from=genre,themenmotive k=2 output=bullets format=list`

`@GUIDE: Der Auslöser sollte klar den normalen Alltag beenden und die Handlung in Gang setzen, ohne den gesamten Plot vorwegzunehmen.`

---

## 4.4 Baustein 4 – Steigende Aktion / Twists @SECTION:RisingAction

### **MUSS** `@REQUIRED`
- **Steigende Handlung (Bullets)** `@FIELD:rising_action`  
  automatisch generiert aus Haupt- und Nebenarcs  
  `@AUTO:rising_action mode=synth from=hauptarc,nebenarcs,konflikt k=3 output=bullets format=list`
- **Twists / Wendepunkte (Liste)** `@FIELD:twist_points`  
  automatisch generiert aus Twist-Arcs (Muster + generisch) und Konflikt  
  `@AUTO:twist_points mode=synth from=twist_arcs_muster,twist_arcs_generisch,konflikt k=2 output=bullets format=list`
- **Eskalationslevel (Zahl)** `@FIELD:escalation_level`  
  automatisch bestimmt anhand der Anzahl und Intensität der Konflikte  
  `@AUTO:escalation_level mode=number from=rising_action,twist_points k=1 output=number format=number`

### OPTIONAL `@OPTIONAL`
- **Entscheidungspunkte (Liste)** `@FIELD:choice_points`  
  automatisch generiert aus den Twist-Arcs und Zuschauerbeteiligung  
  `@AUTO:choice_points mode=synth from=twist_arcs_generisch,genre k=2 output=bullets format=list`
- **Twist-Teaser (optional)** `@FIELD:twist_teaser`  
  automatisch generiert aus Genre und Themenmotive, um Neugier zu wecken  
  `@AUTO:twist_teaser mode=lookup from=genre,themenmotive k=2 output=text format=text`

`@GUIDE: Die steigende Handlung soll die Spannung kontinuierlich erhöhen; jeder Twist sollte logisch auf zuvor etablierten Konflikten aufbauen, ohne deus-ex-machina-Lösungen.`

---

## 4.5 Baustein 5 – Klimax / Höhepunkt @SECTION:Climax

### **MUSS** `@REQUIRED`
- **Klimax-Szene (1–2 Sätze)** `@FIELD:climax_scene`  
  automatisch generiert aus Hauptarc, Stakes und Twist-Punkten  
  `@AUTO:climax_scene mode=synth from=hauptarc,stakes,twist_points k=1 output=text format=text`
- **Entscheidender Schlag / Finale Konfrontation** `@FIELD:finale_konfrontation`  
  automatisch generiert aus Konflikt und Antagonisten-Feldern  
  `@AUTO:finale_konfrontation mode=synth from=konflikt,antagonist_bedrohung,antagonist_limit k=1 output=text format=text`
- **Ergebnis / Auflösung des Konflikts** `@FIELD:conflict_resolution`  
  automatisch generiert aus Klimax-Szene und Zielen von Protagonist und Antagonist  
  `@AUTO:conflict_resolution mode=synth from=climax_scene,protagonist_ziel,antagonist_gegenziel k=1 output=text format=text`

### OPTIONAL `@OPTIONAL`
- **Letzter Twist (optional)** `@FIELD:last_twist`  
  automatisch generiert aus Twist-Arcs und Stakes  
  `@AUTO:last_twist mode=synth from=twist_arcs_generisch,stakes k=1 output=text format=text`

`@GUIDE: Die Klimax-Szene sollte den höchsten Spannungszustand der Story darstellen; sie muss aus der bisher aufgebauten Handlung hervorgehen und den Konflikt klar entscheiden.`

---

## 4.6 Baustein 6 – Auflösung / Denouement @SECTION:Resolution

### **MUSS** `@REQUIRED`
- **Auflösungs-Szene (1–2 Sätze)** `@FIELD:resolution_scene`  
  automatisch generiert aus der Konfliktauflösung und dem Hauptarc  
  `@AUTO:resolution_scene mode=synth from=conflict_resolution,hauptarc k=1 output=text format=text`
- **Endzustand der Figuren (1 Satz)** `@FIELD:end_state`  
  automatisch generiert aus Protagonisten-Zielen, Antagonisten-Limit und Stakes  
  `@AUTO:end_state mode=synth from=protagonist_ziel,antagonist_limit,stakes k=1 output=text format=text`

### OPTIONAL `@OPTIONAL`
- **Epilog / Ausblick** `@FIELD:epilog`  
  automatisch generiert aus Genre und Themenmotive, optional mit Cliffhanger  
  `@AUTO:epilog mode=synth from=genre,themenmotive k=1 output=text format=text`
- **Letztes Bild / Symbol** `@FIELD:closing_image`  
  automatisch generiert aus Setting-Motiven oder dem Leitmotiv der Story  
  `@AUTO:closing_image mode=lookup from=weltmotive,themenmotive k=1 output=text format=text`

`@GUIDE: Die Auflösung sollte offene Fragen beantworten oder bewusst offen lassen, je nach Genre; sie bildet den emotionalen Schlusspunkt der Geschichte.`



---

#5. Story-Aufbau & Variabilität @CHAPTER:5

##5.1 Rahmen & Pflichtbeats @SECTION:StructureFrame

### **MUSS** `@REQUIRED`
- **Stabiles Fundament** `@FIELD:foundation = [hook, setup, konflikt]`
- **Pflichtbeats (pro Story; 1–2 empfohlen)** `@FIELD:mandatory_beats`
  Auswahl (Mehrfachwahl erlaubt):  
  [Protagonist verlässt Heimat | Mentor fällt aus | Auftrag wird erteilt | Einladung in neue Welt | Verrat durch Vertrauensperson]

- **Verknüpfung zu Kap. 2/4**  
  `@AUTO:foundation mode=assert from=4.1,4.2,4.3 k=3 output=flag format=bool`

### Regeln `@RULES:StructureFrame`
- `@RULE: if not all(foundation in StoryState) then @FORCE:generate:foundation`
- `@RULE: each @FIELD:mandatory_beats must be inserted before @FIELD:rising_action`
- `@RULE: if count(@FIELD:mandatory_beats) = 0 then @FORBID:rising_action`

---

##5.2 Generische Slots @SECTION:GenericSlots

### **MUSS** `@REQUIRED`
- **Twist-Slots** `@FIELD:twist_slots = {min:1, max:3}`
- **Nebenfiguren-Slots** `@FIELD:sidechar_slots = {min:1, max:3}`
- **Flavor/Micro-Events** `@FIELD:flavor_slots = {min:1, max:2}`

- **Twist-Katalog (generisch)** `@FIELD:twist_catalog`
  Auswahl (Mehrfachwahl erlaubt):  
  [Verrat | Falscher Verdacht | Verdeckter Antagonist | Innere Sabotage | Unerwartete Hilfe | Zeitdruck plötzlich erhöht | Ressourcen fallen aus]

- **Surprise-Branch-Rate** `@FIELD:surprise_branch_rate = 0.10`  # 10%

### OPTIONAL `@OPTIONAL`
- **Sidekick-Funktionen (Gewichtung)** `@FIELD:sidekick_roles`
  Auswahl (Mehrfachwahl + Gewichtung):  
  [Humor | Welterklärung | Plot-Hilfe | Moralischer Kompass]

### Verknüpfung/Generierung
- `@AUTO:twist_points mode=synth from=genre,konflikt,twist_catalog k=twist_slots.max output=bullets format=list`
- `@AUTO:side_characters mode=synth from=cast_seed,genre,sidekick_roles k=sidechar_slots.max output=bullets format=list`
- `@AUTO:flavor_events mode=synth from=genre,setting_details chance=low k=flavor_slots.max output=bullets format=list`

### Regeln `@RULES:GenericSlots`
- `@RULE: if count(@FIELD:twist_points) < @FIELD:twist_slots.min then @FORCE:generate:twist_points`
- `@RULE: if count(@FIELD:side_characters) < @FIELD:sidechar_slots.min then @FORCE:generate:side_characters`
- `@RULE: if count(@FIELD:flavor_events) < @FIELD:flavor_slots.min then @FORCE:generate:flavor_events`
- `@RULE: if random() < @FIELD:surprise_branch_rate and @FIELD:escalation_level <= 3 then @ALLOW:surprise_branch`

---

##5.3 Stakes & Weltregeln @SECTION:StakesWorld

### **MUSS** `@REQUIRED`
- **Globale Stakes** `@FIELD:stakes_global`
- **Persönliche Stakes** `@FIELD:stakes_personal`
- **Weltregel-Ereignis (mind. 1×)** `@FIELD:worldrule_event`

### Verknüpfung/Generierung
- `@AUTO:stakes_global mode=synth from=weltregeln,konflikt k=1 output=text format=text`
- `@AUTO:stakes_personal mode=synth from=protagonist_ziel,protagonist_need k=1 output=text format=text`
- `@AUTO:worldrule_event mode=lookup from=weltregeln,weltmotive k=1 output=text format=text`

### Regeln `@RULES:StakesWorld`
- `@RULE: if not (@FIELD:stakes_global and @FIELD:stakes_personal) then @FORBID:resolution_scene`
- `@RULE: if count(@FIELD:worldrule_event) < 1 then @FORCE:generate:worldrule_event`

---

##5.4 Auflösungsprüfung & Outcomes @SECTION:ResolutionCheck

### **MUSS** `@REQUIRED`
- **Struktur-Checklist** `@FIELD:structure_required = [hook, setup, konflikt, rising_action, climax, resolution]`
- **Outcome-Modus** `@FIELD:outcome_mode`
  Auswahl (genau 1): [Positiv | Negativ | Ambiguös]
- **Dark-Path erlaubt** `@FIELD:dark_path_possible = true`

### Verknüpfung/Validierung
- `@AUTO:structure_scan mode=assert from=4.1,4.2,4.3,4.4,4.5,4.6 k=6 output=flag format=bool`

### Regeln `@RULES:ResolutionCheck`
- `@RULE: if not all(@FIELD:structure_required in StoryState) then @FORBID:resolution_scene`
- `@RULE: if @FIELD:dark_path_possible = true then @ALLOW:negative_or_ambiguous_outcome`
- `@RULE: if @FIELD:outcome_mode = Ambiguös then @FORCE:closing_image`  # klares Schlussbild trotz Ambiguität

---

##5.5 Längen & Benennungen (global anwendbar) @SECTION:GlobalLengths

### **MUSS** `@REQUIRED`
- `@TEXT_LENGTH: hook = 25`
- `@TEXT_LENGTH: zuschauerfrage = 12`
- `@LENGTH: protagonist_name = 30`

### Regeln `@RULES:GlobalLengths`
- `@RULE: apply LENGTH/TEXT_LENGTH before K-Kodex evaluation`

---

# 6. Story-Visuals Builder @CHAPTER:5
