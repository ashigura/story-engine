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
*@SECTION:ParsingRules*

#### **Grundsätze** *@REQUIRED*
1. **Sektionen**
   - Beginn mit `*@SECTION:<id>*`
   - Ende beim nächsten `*@SECTION*` oder Dokumentende
   - `<id>` nur ASCII (keine Umlaute)

2. **Pflichtgrad**
   - `*@REQUIRED*` = Pflichtfelder
   - `*@OPTIONAL*` = optionale Felder
   - Gültig bis zum nächsten `*@REQUIRED*`, `*@OPTIONAL*` oder `*@SECTION*`

3. **Felder**
   - `*@FIELD:<id>*` markiert ein Feld
   - ASCII-IDs (z. B. `tonalitaet` statt `Tonalität`)
   - Werte folgen als Freitext oder in `[...]`-Listen

4. **Listen**
   - Syntax: `[A | B | C]`
   - Parser: split on `|`, trim whitespace
   - `|` darf in Werten nicht vorkommen

5. **Auto-Direktiven**
   - `*@AUTO:<field_id> key=value …*` auf eigener Zeile
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
## 2.1 StoryFrame
*@SECTION:StoryFrame*

### **MUSS** *@REQUIRED*
- **Titel (1 Satz, frei)**  *@FIELD:titel*
- **Pitch (1 Satz, frei)**  *@FIELD:pitch*

- **Genre (Auswahl)**  *@FIELD:genre*  
  [Abenteuer | Fantasy | Science-Fiction | Mystery | Krimi | Thriller | Horror | Drama | Liebesgeschichte | Komödie | Historisch | Western | Kriegsstory | Sport | Slice-of-Life | Familiengeschichte | Coming-of-Age | Politisches Drama | Justiz/Anwaltsstory | Medizin/Spital]

- **Tonalität (Auswahl)**  *@FIELD:tonalitaet*  
  [Episch | Düster | Hoffnungsvoll | Humorvoll | Tragisch | Leichtfüßig | Spannend | Beklemmend | Gritty | Warmherzig | Melancholisch | Satirisch | Ominös | Inspirierend | Gelassen]

- **Zielgruppe (Auswahl)**  *@FIELD:zielgruppe*  
  [Kinder | Mittelstufe | Teen | Young Adult | Erwachsene | All Ages]

- **Dauer / Umfang (Auswahl)**  *@FIELD:dauer_umfang*  
  [Kurz (3-5 Szenen) | Mittel (3 Kapitel) | Lang (10 Kapitel) | Staffel/Endlos]



### OPTIONAL *@OPTIONAL*
- **Themenmotive (Liste)**  *@FIELD:themenmotive*  
  [Freiheit vs. Kontrolle | Vertrauen vs. Misstrauen | Identität | Gerechtigkeit | Opfer | Verrat | Loyalität | Macht | Erlösung | Rache | Hoffnung vs. Verzweiflung | Tradition vs. Wandel | Schicksal vs. freier Wille | Wahrheit vs. Lüge | Liebe vs. Hass | Leben vs. Tod]

- **Tabus / No-Gos (Auswahl)**  *@FIELD:tabus*  
  [Explizite Gewalt | Sexualisierte Inhalte | Kindeswohlgefährdung | Diskriminierung | Suizid | Religion | Politik | Terrorismus | Kriegsverherrlichung | Folter | Drogenmissbrauch | Alkohol-Glorifizierung | Glücksspiel | Vulgärsprache]

- **Inspirationsanker**  *@FIELD:inspirationsanker*  
  automatisch generiert aus Genre + Themenmotive → liefert reale Werke als Vergleich  
  *@AUTO:inspirationsanker mode=lookup from=genre,themenmotive k=5 output=works-real format=list locale=de*

- **Darstellungsstil**  *@FIELD:darstellungsstil*  
  [Kurz & knapp | Detailliert | Kreativ/poetisch]


---

# (Weitere Kapitel 2.2 – 2.8, Kodex, Gültigkeit, Fazit würden in gleicher Weise angepasst folgen)
