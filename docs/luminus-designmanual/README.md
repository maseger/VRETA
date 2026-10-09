# Luminus designboard

`index.html` är en fristående sida (öppna i webbläsaren) med Luminusprofilens visuella identitet. Version 6.

- **Identitet:** nuläge och moderniserad version 2 med logotyp, de åtta arketyperna som kronblad (med egna färgnamn), färg, typografi, Luminuskompassen och bildspråk.
- **Luminuskompassen:** alla tjugo karaktärer på en karta. Fyra kvadranter är elementen och åtta oktanter är arketyperna. Åtta tårtbitar ligger två och två vid väderstrecken, och tolv bitar ligger i tre lager (inre, mellersta, yttre) längs diagonalerna. Rakt mitt emot ligger motpolen, och alla tio komplementpar hamnar så. Sektionen har en interaktiv karta, placeringstabell, regler för färg, form och linjering samt personliga exempel på alla tre nivåer.
- **Karaktärsporträtt:** tjugo karaktärer med målade porträtt i en kvinnlig och en manlig serie, som profilbilder i karaktärsåterkopplingen. 35 av 40 bilder finns, och de fem som saknas visas som färgskiva med initial (se `assets/portratt/kallor.md`). Sektionen Porträtt beskriver urval, beskärning, ring och medalj, fem storlekar, hur serien väljs efter profilens kön och hur porträtten används i gränssnittet. Porträtten föreställer karaktärerna och inte personen, och visas alltid med karaktärens namn.
- **Tillämpningar:** Instagram-mallar, dokument, presentationsmaterial, böcker och manualer, profilrapport för individ (tre nivåer, med fiktiva exempelprofiler), Möt dig själv och Kompasskortet samt identitetsspecifikation för webbplatsen. Språkprincipen "du har, du är inte" gäller i alla.
- **Typsnitt:** Fraunces och DM Sans (Google Fonts, SIL Open Font License).
- `assets/luminus-logo-nuvarande.png` är logotypen som den ser ut i artikeln "Luminus profile 20 characters" (2024), utdragen som referens.
- Hexvärden för nuläget är uppmätta ur PDF- och bildfiler. Version 2 är ett designförslag. Färgtilldelningen mellan arketyper och kronblad följer kompassens oktanter.

## Kompassen som filer

`assets/luminus-kompass*.svg` och `.png` är kompassen som ren vektorgrafik och som bild (SVG går att lägga in i PowerPoint, Keynote och Canva).

| Fil | Innehåll |
| --- | --- |
| `luminus-kompass` | Strukturkartan med ring, väderstreck, stilfamiljer och element |
| `luminus-kompass-karaktarer-exempel` | Karaktärsnivå, exempel Elin Ahlström: placering 1–20, fem starkaste och två svagaste markerade |
| `luminus-kompass-arketyper-exempel` | Arketypnivå, exempel Maja Lind: placering 1–8 |
| `luminus-kompass-element-exempel` | Elementnivå, exempel Jonas Ek: placering 1–4 |

Underlaget är avmätt ur Luminus egna diagram ("Characters in the Luminus System" sidorna 2 och 5, samt kompasssidan i den individuella profilen): bitarnas placering, lagrens gränser (44 och 75 procent av radien) och arketypernas lägen. Färgerna, medaljerna på element- och arketypnivå (två starkaste och en svagaste) och reglerna för linjering och när namn byts mot siffror är förslag.

## Exempelåterkoppling

`aterkoppling.html` samlar exempelåterkopplingar för tre påhittade personer på tre nivåer: Jonas Ek (element), Maja Lind (arketyper) och Elin Ahlström (karaktärer). Varje nivå är självständig och hänvisar bara till sina egna delar. Alla tre börjar med kompassen på sin nivå, och karaktärsnivån följer profilens utfallsform: rangordning 1–20 med ordförande, fyra rådgivare och två skuggor, tio polaritetspar visade som staplar mot varandra, och ett stilbibliotek med tolv stilar (kommunikation, konflikt, beslut, samarbete, problemlösning, genomförande, förändring, stress, drivkraft, lärande samt de nya riskstil och återkopplingsstil). Näst sista kapitlet på varje nivå är Möt dig själv. Karaktärsnivån använder de målade porträtten som profilbilder: Elin är en kvinna i exemplet och får den kvinnliga serien, och en växlare i inledningen låter dig förhandsgranska den manliga.

### Stilarna och vad de bygger på

Varje stilkapitel, på alla tre nivåer, öppnar med stilmodellen: stilarna bygger på våra antaganden, vår personlighet och våra drivkrafter, och kommer i sin tur till uttryck i personlig gestaltning och beteenden, ibland i så kallade mikrobeteenden. Kapitlen listar också mikrobeteenden att lägga märke till per stil. De är illustrationer och ingen mätning. Designboarden beskriver modellen som komponent och som skrivregel i sektionen Språk.

## Möt dig själv och Kompasskortet

Näst sista sidan i varje profil, på alla tre nivåer, har två delar. Först ett porträtt i jag-form där personen får möta sig själv som berättar om sig. Sedan Kompasskortet: samma profil som ett kort att ha med sig och navigera i. Kortet har namn och nivå, en mening som börjar med "Jag har", personens kompass, rader av formen "När jag behöver … då använder jag …" (först det man har närmast, sedan det man kan låna), en fälla att se upp med, en fråga att ställa sig själv och en fot med "Läget, inte ödet". På skärmen går det att trycka på en rad så att biten lyser upp på kompassen. Elementnivån har fyra rader, arketypnivån sex och karaktärsnivån sju, och bara karaktärsnivån har porträtt. Texterna är mina förslag, hämtade ur exempelåterkopplingarna, och boarden beskriver komponenten och reglerna.

| Fil | Innehåll |
| --- | --- |
| `kompasskort-element-jonas.png` | Kompasskortet på elementnivå, exempel Jonas Ek (kortet är 480 px brett och bilden är 2×) |
| `kompasskort-arketyp-maja.png` | Kompasskortet på arketypnivå, exempel Maja Lind |
| `kompasskort-karaktar-elin.png` | Kompasskortet på karaktärsnivå, exempel Elin Ahlström, med kvinnlig porträttserie |

## Karaktärsporträtt

Karaktärsåterkopplingen använder ett målat porträtt per karaktär som profilbild, med ring i karaktärens färg och en medalj som visar placeringen. Det finns en kvinnlig och en manlig serie, och serien följer personens kön: en kvinna får den kvinnliga serien i hela sin återkoppling och en man den manliga. Porträtten föreställer karaktärerna och inte personen, och visas därför alltid med karaktärens namn. Element- och arketypnivån har inga ansikten utan färgskivor och kronblad. Porträtten är ägarens egna bilder ur Drive-mappen "Luminus The Characters, Illustration", beskurna till kvadrater, och `assets/portratt/kallor.md` visar vilken källfil varje bild kommer från och vilka som saknas.

| Fil | Innehåll |
| --- | --- |
| `portratt/<karaktär>-kvinnlig.webp`, `portratt/<karaktär>-manlig.webp` | Porträtten, 288 × 288 px WebP |
| `portratt/kallor.md` | Källfil per porträtt, tveksamma bilder och de fem som saknas |
| `luminus-karaktarsportratt.png` | Galleri med båda serierna, kvinnlig till vänster och manlig till höger |

Bilder som saknas: Prince (kvinnlig), Empress (manlig), Warrior (manlig), Adventurer (kvinnlig) och Trustee (kvinnlig). Tre av dem finns bara som originalfiler över 7 MB som inte gick att hämta ur Drive, och för de övriga två har biblioteket ingen egen bild.
