# Story Design Manual – Modul 2A  
**Version 2.0 (mit Auswahlmöglichkeiten, Twist-Ebene & modularem Kodex)**  
Dieses Dokument definiert die generische, logische Struktur für Storys.  
Es ist KI-modellunabhängig und wird als lebendes Dokument gepflegt.  

---

## 1. Allgemeine Hinweise

### 1.1 Zweck
- Generischer Baukasten für Stories
- KI-unabhängig

### 1.2 Parsing-Regeln
@SECTION:ParsingRules

#### **Grundsätze** @REQUIRED
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

4. **Listen**
   - Syntax: `[A | B | C]`
   - Parser: split on `|`, trim whitespace
   - `|` darf in Werten nicht vorkommen

5. **Auto-Direktiven**
   - `@AUTO:<field_id> key=value …` auf eigener Zeile
   - Pflicht:
     - `mode`: `synth` (erfinden), `lookup` (reale Werke), `hybrid`
     - `from`: Eingabefelder
     - `k`: Anzahl Elemente
     - `output`: Typ (`works-real`, `works-generic`, `bullets`, `tags`)
     - `format`: Ausgabeformat (`list`, `json`, `text`)
   - Optionale Keys: `locale`, `seed`, `policy`

6. **Zeichenregeln**
   - Pfeile `->` oder Sonderzeichen sind nur Deko, Parser ignoriert sie
   - Zahlenbereiche: ASCII `3-5` statt `3–5`

7. **Eindeutigkeit**
   - Feld-IDs pro Sektion eindeutig
   - Duplikate → Warnung

---
# 2 Story-Builder
## 2.1 StoryFrame `@SECTION:StoryFrame`

### **MUSS** `@REQUIRED`
- **Titel (1 Satz, frei)**  `@FIELD:titel`
- **Pitch (1 Satz, frei)** `@FIELD:pitch`

- **Genre (Auswahl)**  `@FIELD:genre`
  
  [Abenteuer | Fantasy | Science-Fiction | Mystery | Krimi | Thriller | Horror | Drama | Liebesgeschichte | Komödie | Historisch | Western | Kriegsstory | Sport | Slice-of-Life | Familiengeschichte | Coming-of-Age | Politisches Drama | Justiz/Anwaltsstory | Medizin/Spital]

- **Tonalität (Auswahl)**  `@FIELD:tonalitaet`
  
  [Episch | Düster | Hoffnungsvoll | Humorvoll | Tragisch | Leichtfüßig | Spannend | Beklemmend | Gritty | Warmherzig | Melancholisch | Satirisch | Ominös | Inspirierend | Gelassen]

- **Zielgruppe (Auswahl)**  `@FIELD:zielgruppe`
  
  [Kinder | Mittelstufe | Teen | Young Adult | Erwachsene | All Ages]

- **Dauer / Umfang (Auswahl)**  `@FIELD:dauer_umfang`
  
  [Kurz (3-5 Szenen) | Mittel (3 Kapitel) | Lang (10 Kapitel) | Staffel/Endlos]


  
### *OPTIONAL* `@OPTIONAL`
- **Themenmotive (Liste)**  `@FIELD:themenmotive`
  
  [Freiheit vs. Kontrolle | Vertrauen vs. Misstrauen | Identität | Gerechtigkeit | Opfer | Verrat | Loyalität | Macht | Erlösung | Rache | Hoffnung vs. Verzweiflung | Tradition vs. Wandel | Schicksal vs. freier Wille | Wahrheit vs. Lüge | Liebe vs. Hass | Leben vs. Tod]

- **Tabus / No-Gos (Auswahl)**  `@FIELD:tabus`
  
  [Explizite Gewalt | Sexualisierte Inhalte | Kindeswohlgefährdung | Diskriminierung | Suizid | Religion | Politik | Terrorismus | Kriegsverherrlichung | Folter | Drogenmissbrauch | Alkohol-Glorifizierung | Glücksspiel | Vulgärsprache]

- **Inspirationsanker**  `@FIELD:inspirationsanker`
  
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



### *OPTIONAL* `@OPTIONAL`
- **Weltmotive / Symbolik**  `@FIELD:weltmotive`
  
  [Licht vs. Dunkelheit | Natur vs. Zivilisation | Ordnung vs. Chaos | Tradition vs. Fortschritt]

- **Kulturelle Besonderheiten**  `@FIELD:kulturelle_besonderheiten`
  
  [Religion | Politik | Gesellschaftsschichten | Rituale | Sprache | Kleidung]

- **Naturgesetze (Auswahl)**  `@FIELD:naturgesetze`
  
  [Normal | Verändert (ewige Nacht, toxische Luft) | Übernatürlich (sprechende Tiere, lebendige Elemente)]

- **Inspirationsanker**  `@FIELD:inspirationsanker`
  
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



### *OPTIONAL* @OPTIONAL
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



### *OPTIONAL* `@OPTIONAL`
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



### *OPTIONAL* `@OPTIONAL`
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



### *OPTIONAL* @OPTIONAL
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

### **MUSS** @REQUIRED
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



### *OPTIONAL* `@OPTIONAL`
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

### **MUSS** @REQUIRED
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



### *OPTIONAL* `@OPTIONAL`
- **Erweiterte Folgen**  `@FIELD:erweiterte_folgen`
   
  automatisch generiert: Mehrfachwirkungen, Symbolik, Ambivalenz, Narrative Flags  
  `@AUTO:erweiterte_folgen mode=synth from=direkte_folgen,konsequenzen k=3 output=bullets format=list`

- **Twist-Folgen (Allgemeine Muster)**  `@FIELD:twist_folgen_muster`
   
  [Verdeckte Wirkung | Unerwartete Belohnung | Kettenreaktion | Opfer = Gewinn | Täuschung]

- **Twist-Folgen (Generisch)**  `@FIELD:twist_folgen_generisch`
  
  automatisch generiert aus Genre + Themenmotive  
  `@AUTO:twist_folgen_generisch mode=synth from=genre,themenmotive k=2 output=bullets format=list`


---

## 3. Übergreifende Normen (Kodex)

### K1: Gewalt & Hass (altersabhängig)
- **ab 12:** keine explizite Gewalt/Gore, Kämpfe angedeutet, Hass nur abstrakt  
- **ab 16:** leichte Gewalt mit Blut möglich, psychologische Bedrohung, Hass abstrakt/symbolisch  
- **ab 18:** Gewalt explizit, aber nicht verherrlichend, keine sexualisierte Gewalt, Hass nur kritisch  

### K2: Altersfreigabe & Detailgrad
- **ab 12:** PG-13 → Gewalt abstrakt, kein Sex, Sprache jugendfrei  
- **ab 16:** PG-16 → moderate Gewalt, Sex angedeutet, moderate Schimpfwörter  
- **ab 18:** PG-18 → explizite Gewalt (nicht verherrlichend), Sex angedeutet (keine Pornografie), Sprache frei (außer Hard Bans)  

### K3: Entscheidungs-Filter
- Keine Option darf Hard Bans (z. B. Folter, Vergewaltigung, Suizid-Anleitung) erzwingen  
- Jede Entscheidung hat ≥ 1 ethisch vertretbare Option  

### K4: Magie/Tech-Budget
- Jede übernatürliche/technische Lösung hat Kosten  
- Keine Allmacht, keine deus-ex-machina Lösungen  

### K5: Bias-/Stereotypie-Limit
- Keine Ethnie/Religion/Orientierung als Negativ-Trope  
- Antagonisten über Motive, nicht Herkunft definieren  
- Machtgefälle-Beziehungen nicht romantisieren  

### K6: Kontinuität/Kausalität
- Twists nur, wenn kausal logisch  
- Entscheidungen behalten Wirkung, keine völlige Annulierung  

### K7: Sprache/Ton
- Alters- & plattformabhängig  
  - ab 12: keine Schimpfwörter  
  - ab 16: leichte Schimpfwörter, keine Slurs  
  - ab 18: starke Schimpfwörter möglich, aber keine diskriminierenden Slurs  
- Plattformregeln setzen ggf. strengere Grenzen  

### K8: Plattform-Safe
- Plattform-AGB haben Priorität  
- Twitch: kein Sex-Content, keine Drogen, kein „extreme gore“  
- TikTok: strengere Sprache/Gewalt-Filter  
- YouTube: mittlere Toleranz (zwischen Twitch & TikTok)  
- (Weitere Plattformmodule erweiterbar)  

---

## 4. Gültigkeit & Beispiele
- 5 universelle Themenfelder: Abenteuer/Quest · Konflikt/Machtspiel · Beziehung/Emotion · Überleben/Gefahr · Transformation/Erkenntnis
- Validierungsstories:  
  - **Herr der Ringe** (Abenteuer/Quest + Überleben)  
  - **Romeo & Julia** (Beziehung/Emotion + Konflikt)

---

## 5. Fazit
- Vollständiges, generisches Grundgerüst (Version 2.0)  
- Modularer Kodex mit Alters- und Plattformregeln → Flexibilität + Kontrolle  
- Twists integriert: über **Allgemeine Muster** oder **Generisch erzeugt**  
- Dokument ist lebendiges Manual → erweiterbar für spätere Versionen
