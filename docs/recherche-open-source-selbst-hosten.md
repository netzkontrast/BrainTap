# Digitales Pub-Quiz selbst hosten: Open-Source-Optionen für den 3. November 2026 (Köln/Bonn, ~40 Personen, 6–10 Teams)

**Kurzfassung: Für den 3. November würde ich Razzia (früher Rahoot, MIT-Lizenz) als Docker-Container auf dem Laptop oder einem VPS nehmen, ein Gerät pro Team und die Fragen auf dem Beamer. Als Reserve gehört Crowdpurr Basic dazu, ein vollwertiger Plan B kostet nichts.** ClassQuiz kann mehr, ist für einen Kneipenabend aber unnötig schwer zu betreiben. Keines der beiden Open-Source-Tools hat einen echten Team-Modus. Die Frage nur auf dem Beamer und nicht auf dem Handy zu zeigen, gibt es bei Razzia bisher nur im Entwicklungszweig (v4.0). Ein Release ist noch nicht erschienen.

## TL;DR

- **Empfehlung:** Razzia 3.1.0 über `docker run`, mit Zeitlimits von 5–120 s pro Frage, Antwortsperre über einen „cooldown“ und Team-Namen als Nicknames. Wenn bis Mitte Oktober v4.0 mit dem „Answers only“-Modus erscheint, sollte man upgraden. ClassQuiz lohnt sich nur, wenn man die gehostete Instanz classquiz.de nutzt (Server in Deutschland). Selbst gehostet braucht es Postgres, Redis, Meilisearch, Caddy und HTTPS, das ist für einen Abend zu viel.
- **Schummelsicherheit** kommt vor allem aus dem Ablauf, nicht aus der Software. Dazu gehören: Fragen nur auf dem Beamer, kurze Zeitfenster, ein Gerät pro Team und Punkte nach Geschwindigkeit. Echte Buzzer-Runden lassen sich mit einem separaten Web-Buzzer wie Surge-Tech/jeopardy (Lockout 250–1000 ms) oder mit selbstgebauten ESP32-ESP-NOW-Buzzern ergänzen. Schätz- und Audio-Runden laufen am besten auf Papier und werden mit einem Scoreboard-Tool ausgewertet.
- **Kommerziell ist besser,** wenn kein Beamer kommt, wenn das Kneipen-WLAN Geräte untereinander isoliert und Michael keine Zeit zum Testen hat, oder wenn man eingebaute Team-Modi, Fragenpakete und Support will. Laut dem Crowdpurr-Hilfe-Center („Basic Plan Features Explained“) erlaubt Crowdpurr Basic kostenlos bis zu 20 Teilnehmer pro Spiel, was für 10 Team-Geräte reicht. SpeedQuizzing läuft bewusst im LAN, braucht aber eine App auf jedem Team-Handy und wird pro Abend mit Credits bezahlt.

## Key Findings

1. **Razzia ist das passendste Open-Source-Tool und wird aktiv gepflegt.** Das Repo hat rund 1.000 Sterne und ist MIT-lizenziert. Seit Januar 2026 gab es fast monatlich Releases:
   - 1.1.0 am 31. Januar 2026: Audio, Video und QR-Code
   - 1.2.0 am 14. März 2026: Umstieg auf Vite, nur noch ein Port
   - 2.0.0 am 22. April 2026: Editor, i18n und Streaks
   - 3.0.0 am 9. Mai 2026: Umbenennung in Razzia
   - 3.1.0 am 5. Juli 2026: Mehrfachauswahl, Reconnect, Maximalpunkte und Minuspunkte

   v4.0 befindet sich im `dev`-Zweig.
2. **Razzia zeigt die Frage bisher auch auf dem Handy.** Erst PR #231 (Commit c706e4b, „Closes #156“), gemergt am 25. September 2026 in `dev`, bringt einen Schalter „Answers only“ in den Spieleinstellungen, laut PR „off by default“. Ein „?“-Button „opens the question and its image or video in a popup“. Der Entwickler begründet die Funktion so: „With a projector in the room, showing the question again on every phone just takes space away from the answers.“ Diese Funktion ist der wichtigste Baustein für die Schummelsicherheit. Ob sie bis zum 3. November in einem Release steckt, ist offen.
3. **Keines der beiden Kahoot-ähnlichen Tools (Razzia, ClassQuiz) hat einen Team-Modus.** Der Workaround ist ein Gerät pro Team mit dem Teamnamen als Nickname. Bei ~10 Teams ist das sogar eher ein Vorteil: Es gibt weniger Geräte und weniger WLAN-Last.
4. **ClassQuiz kann mehr, bringt aber mehr Betriebsrisiko.** Es bietet 7 Fragetypen (ABCD, RANGE, VOTING, SLIDE, TEXT, ORDER, CHECK), eine deutsche Übersetzung, einen Kahoot-Import und einen Test mit bis zu 300 Spielern. Laut NLnet-Projektseite wird es aus dem NGI0 Commons Fund gefördert (Start 2025-04), finanziert von der Europäischen Kommission „under grant agreement No 101135429“. Dafür besteht der Stack aus FastAPI, SvelteKit, Postgres, Redis, Meilisearch und Caddy. Die Dokumentation sagt ausdrücklich: „ClassQuiz needs HTTPS/SSL to work properly!“ Außerdem empfiehlt der Autor, den neuesten Master-Commit zu verwenden und keine Release-Version. Issue #419, „Website on host and player freezes“, ist seit Dezember 2024 offen.
5. **Spezielle Pub-Quiz-Tools gibt es fast nur für Papier-Quizze.** Sie verwalten Teams, die Punkteeingabe durch Helfer und Scoreboards (z. B. PubQuizMaster, quasar-scoreboard). Live-Quiz-Tools mit Teams auf GitHub sind meist Schulprojekte und nicht einsatzreif.
6. **Buzzer-Lösungen gibt es reichlich.** Am einfachsten ist ein Web-Buzzer auf dem Handy. Am fairsten ist Hardware über ESP-NOW, weil sie unabhängig vom WLAN funktioniert. Razzia dokumentiert sogar ein WebSocket-Protokoll, mit dem man einen eigenen Client bauen kann, ausdrücklich „e.g. an ESP32 physical buzzer“.

## Details

### 1. Kahoot-Klone / Live-Quiz-Apps

#### Razzia (ehemals Rahoot) – github.com/Ralex91/Razzia
| Kriterium | Stand (Oktober 2026) |
|---|---|
| Lizenz / Sterne | MIT, ca. 1.000 Sterne, 50 Forks, 41 offene Issues |
| Aktivität | Release 3.1.0 am 5. Juli 2026. Commits im `dev`-Zweig bis Ende September 2026 (PR #203 am 23. September, #231 am 25. September, Medien-Upload #232 am 27. September) |
| Tech-Stack | TypeScript, React (Vite, TanStack Router), Socket.io-Server, Node ≥ 24, pnpm |
| Deployment | `docker run -d -p 3000:3000 -v ./config:/app/config ralex91/razzia:latest`, auch über ghcr.io. Docker-Compose-Datei liegt bei. Es gibt einen Proxmox-LXC-Script-Vorschlag aus der Community. Eine offizielle Demo-Instanz gibt es nicht |
| Konfiguration | `config/game.json` mit Manager-Passwort (das Standardpasswort wird blockiert). Quizze liegen als JSON in `config/quizz/`, ein Web-Editor ist seit 2.0 dabei |
| Zeitlimits | `time` 5–120 s pro Frage, `cooldown` 3–15 s (Zeit, bevor die Antworten freigegeben werden) |
| Punkte | Kahoot-Prinzip mit Rangliste, Podium und Streaks. Seit 3.1.0 lassen sich Maximalpunkte und eine optionale Strafe für falsche Antworten pro Frage einstellen |
| Fragetypen | Single- und Multiple-Choice (seit 3.1.0 mit den Modi Strict, Balanced und Lenient) sowie Reihenfolge. **Schätzfragen sind nur geplant (#130)** |
| Medien | Bild, Audio und Video über das `media`-Objekt, **bisher nur als URL**. Direkter Upload ist mit PR #232 in `dev` |
| Hauptbildschirm vs. Handy | Manager-Ansicht für den Beamer unter `/manager`. In 3.1.0 sehen die Spieler die Frage auch auf dem Handy. „Answers only“ gibt es nur in `dev` (PR #231) |
| Team-Modus | Nein. Workaround: ein Gerät pro Team |
| Sprache | i18next mit Sprachauswahl. Ob es eine deutsche Übersetzung gibt, sollte man vorher prüfen |
| Offline/LAN | Ja. Ein einziger Container, keine externen Dienste. Medien müssen aber im LAN erreichbar sein |
| DSGVO | Keine Accounts und kein Tracking. Es fallen nur Nicknames an, und Ergebnisse werden lokal im `config`-Ordner gespeichert |
| Bekannte Punkte | Fix in 3.0.1: Auth bei der Spielerstellung und Path Traversal. v4.0 bringt Breaking Changes: Das Manager-Passwort wandert in die Env-Variable `MANAGER_PASSWORD`, außerdem gibt es einen REST-Refactor. Raumsperre („room lock“) ist geplant. In `dev` sind Survey-Modus und Auto-Advance (3–600 s) bereits gemergt |
| Aufwand | Gering: 30–60 Minuten bis zum ersten Testspiel. Die Fragen als JSON zu schreiben ist der größere Teil |
| Eignung | **Hoch.** Für ~10 Team-Geräte gemacht („for smaller events“) |

**Einschätzung:** Razzia ist klein und hat wenige bewegliche Teile. Es läuft offline und hat seit 3.1.0 einen Reconnect („Players can now reconnect to an in-progress game from the join page using their saved PIN“), was in einer Kneipe mit wackligem WLAN entscheidend ist. Den `dev`-Zweig am Abend produktiv einzusetzen, halte ich für riskant, weil gerade die Client-Server-Kommunikation umgebaut wird. Besser: 3.1.0 nutzen und die Fragen auf den Handys bewusst mit kurzen Zeitfenstern entschärfen. Oder v4.0 nur dann einsetzen, wenn das Release bis etwa 20. Oktober erscheint und man es zweimal getestet hat.

#### ClassQuiz – github.com/mawoka-myblock/ClassQuiz
| Kriterium | Stand |
|---|---|
| Lizenz / Sterne | MPL-2.0, ca. 713 Sterne, 171 Forks, 1.836 Commits, 32 offene Issues, 41 offene PRs |
| Aktivität | Aktiv: Neue Issues stammen z. B. vom 6. August 2026 (#563: maximal 4 Antwortoptionen bei Multiple Choice/Voting). Formale Releases gibt es kaum, der Autor rät zum Master-Branch. Das exakte Datum des letzten Commits konnte ich nicht verifizieren |
| Tech-Stack | Backend FastAPI mit ormar und python-socketio, Frontend SvelteKit mit Tailwind. Dazu Postgres, Redis, Meilisearch und Caddy. Optional, und Closed Source: Mapbox, hCaptcha/ReCaptcha, Sentry |
| Deployment | `git clone`, dann `docker-compose.yml` und das Frontend-Dockerfile anpassen, dann `docker compose build && up`. Das Bauen dauert einige Minuten. **HTTPS ist Pflicht.** Gehostete Instanz: classquiz.de (Karlsruhe, netcup) |
| Fragetypen | ABCD, RANGE (Schätzbereich), VOTING, SLIDE, TEXT (Freitext), ORDER, CHECK |
| Medien | Bilder. YouTube und Musik kamen per Community-PR #401 hinzu, ob der Code gemergt ist, konnte ich nicht verifizieren |
| Hauptbildschirm vs. Handy | Die Admin-Ansicht ist für den Beamer gedacht. Ein Feature „Remote Control“ erlaubt es, das Admin-Display auf den Projektor zu spiegeln und das Quiz von einem zweiten Gerät aus zu steuern. **Ob die Frage auf den Handys erscheint, konnte ich nicht belegen.** Das sollte man vorab auf classquiz.de testen |
| Team-Modus | Nicht dokumentiert. Workaround: ein Gerät pro Team |
| Sprache | Deutsch und über 20 weitere Sprachen über Weblate |
| Offline/LAN | Möglich, aber mühsam: HTTPS im LAN braucht eine lokale CA, und Handys vertrauen der nicht ohne Weiteres |
| DSGVO | Gut. Self-Hosting ist möglich, die gehostete Version steht in Deutschland, es gibt kein Tracking |
| Bekannte Bugs | #419 (Host und Spieler frieren ein, offen seit Dezember 2024). Probleme beim mehrfachen Reconnect wurden in PR #401/#408 adressiert, der Merge ist unklar. Der Autor selbst schreibt: „I tend to add new features without polishing others“ |
| Aufwand | Mittel bis hoch beim Self-Hosting. Gering, wenn man classquiz.de nutzt |
| Eignung | Mittel. Funktional stark (RANGE für Schätzfragen!), betrieblich aber das riskanteste der Kandidaten |

#### Weitere Kahoot-artige Projekte (geprüft, meist nicht empfohlen)
| Projekt | Lizenz/Status | Kurzbewertung |
|---|---|---|
| surajcm/darkhold | ca. 49 Sterne. Java/Spring Boot 4, WebSocket/STOMP, Postgres/H2, Docker Compose | Bilder, YouTube und Zeitlimits pro Frage. Der Autor selbst schreibt aber: „work in progress and not ready for production use“ und „maintained by a single developer“. **Nicht für den 3. November** |
| david-04/quiz-mate | npm-Paket (`npm install quiz-mate`) | Sehr leicht, Daten nur im Speicher. Schließt der Host den Tab, wird das Quiz beendet, und die Spieler merken davon nichts. Zu fragil |
| sivasooryagiri/quizlive | React und Firebase | Hat einen Team-Modus (Punkte werden aggregiert), hängt aber an Firebase. Damit gibt es keinen echten Offline- oder LAN-Betrieb, und die DSGVO-Lage ist schlechter |
| xadminadam/OmegaQuiz | – | Drei Ansichten (Spieler-Handy, Host-Board für den Projektor, Admin-Panel), das ist konzeptionell passend. Reife unbekannt |
| mholzi/quizify | Home-Assistant-Add-on | TV als Spielbrett, Handys über QR-Code, 4.740 Fragen auf Englisch, Deutsch und Spanisch. Nur sinnvoll, wenn man Home Assistant hat |
| supabase-community/kahoot-alternative | Supabase | Demo-Projekt und an Supabase gebunden |
| Forks wie LTHhoot, Daividdi/rahoot_ldap, Razzmatazz | MIT-Forks von Rahoot/Razzia | Interessante Ideen (3D-Avatare, LDAP, Sprachlernen), aber Einzelpersonen-Forks. Upstream ist die bessere Wahl |

### 2. Pub-Quiz-/Trivia-Night-spezifische Tools
| Projekt | Stack | Was es kann | Eignung |
|---|---|---|---|
| budul100/PubQuizMaster | .NET 9, Blazor Server (SignalR), PostgreSQL | Für Papier-Quizze: Helfer bekommen per QR-Code eine Punkte-Station auf dem Handy, ohne Login. Team-Verwaltung mit Fuzzy-Matching wiederkehrender Teams, Rangliste mit geteilten Plätzen, Matrix Teams × Runden, Export der Tabelle in die PowerPoint-Präsentation | **Gut für Hybrid:** Papier-Runden wie Schätzen und Audio, ausgewertet von Helfern |
| k-sym/quasar-scoreboard | Vue/Quasar, localStorage | Von einem Kneipen-Quizmaster für den Beamer gebaut. Punkte pro Runde, Joker verdoppelt eine Runde, animiertes Sortieren | **Sehr einfach und offline.** Gutes Scoreboard für Papier-Runden |
| cssoc/Pub-Quiz-Scoreboard | jQuery | Live-Scoreboard und Popup-Ansicht pro Runde. Der Autor nennt es selbst „a bit hacky“ | Notlösung |
| voax/quizzer, AsherDeVries/pub-quiz | MERN mit WebSockets (Schulprojekte) | Team-App, Quizmaster-App, Scoreboard-App. Der Quizmaster bewertet Freitext-Antworten, 12 Fragen pro Runde | Konzeptionell das „richtige“ Pub-Quiz-Modell (Team-Gerät, Freitext, Scoreboard), aber nicht gepflegt |
| yanshufstudio/pub-quiz-trivia-night-automation-hub | Next.js, Prisma, Claude-API | Erzeugt Fragenpakete per KI und exportiert PDFs. Live-Spiel mit Team-Portal, separatem Host-Key und automatischer Bewertung per Exact Match mit Override. Lasttest mit 20 Teams vorhanden | Interessant, aber Polling alle ~3 s und die Bindung an eine KI-API sind kein Muss für einen Abend |

### 3. Buzzer-Systeme
**Web-Buzzer (Handy als Buzzer):**
- **Surge-Tech/jeopardy:** Node, Express und Socket.io, Docker/Fly.io. Getrennte Ansichten für Host-Panel, Board (TV) und Buzzer (Handy). Im Release v1.0.0: „first buzz wins, ties are impossible, with a configurable lockout (250/500/1000ms, or off)“. Außerdem wurden Race Conditions bei der Bewertung behoben, und es gibt Serverseitige Prüfung, ob der gewertete Spieler überhaupt berechtigt ist. **Der beste Kandidat für eine Buzzer-Finalrunde.**
- **payalmishra1809/buzzer-host:** Buzzer-Warteschlange pro Team mit Zeitabstand (z. B. „+0.18s“). Bei falscher Antwort wird das Team gesperrt und das nächste ist dran. Vibration und Ton. Klein und unbekannte Reife.
- **bufferapp/buzzer** (laut moetz.dev): ein einfacher Docker-Buzzer mit nur einem Raum. moetz.dev hat daraus eine Variante mit Lobbys in Ktor gebaut.
- **theGrue/jeopardy** und der Fork **andygrunwald/things-with-buzzers-jeopardy:** Jeopardy-Frontends für Hardware-Buzzer, offline lauffähig, Text, Audio und Video. Älter (Angular, Bower).

**ESP32/Arduino zum Selberbauen:**
- **tomio-codes/Quiz-buzz:** ESP32-C3-Teamknöpfe über ESP-NOW („bez Wi-Fi routeru“), USB-Empfänger und Python-Host mit Projektor-Anzeige. 2–4 Teams.
- **otakenz/wireless_buzzer_system:** 5 Buzzer mit XIAO ESP32-C3 und Arcade-Knöpfen. ESP-NOW mit Back-off bei gleichzeitigem Drücken, Desktop-GUI.
- **thematthewknot/jeopardy-buzzer:** XIAO ESP32-S3, Basis mit ARM/DISARM/LOCKOUT, protokolliert die Buzz-Reihenfolge und sendet Tastendrücke als USB-HID-Tastatur an den Präsentations-PC.
- **youmo86/ESP-Quiz-Buzzer:** 2–10 Clients, ESP32 als Access Point plus MQTT. Erst Phase 1.

**Fazit Buzzer:** Für 6–10 Teams sind ESP-NOW-Knöpfe fair und vom WLAN unabhängig. Hardware, Gehäuse und Akkus in vier Wochen für 10 Teams zu bauen, ist aber ein eigenes Projekt. Realistisch ist der Web-Buzzer für eine Bonusrunde. Wer basteln will, nimmt die Basis von tomio-codes oder thematthewknot und lässt sie per HID-Tastendruck mit dem Scoreboard sprechen.

### 4. Jeopardy-/Game-Show-Software
- **SIGame / SImulator / SIQuester** (github.com/VladimirKhil/SI, ca. 196 Sterne, C#): SImulator ist laut Repo eine „SIGame offline app for hosting a game with a single computer and projector“. SIQuester ist der Fragen-Editor. Releases 2026: SImulator 3.4.1–3.4.3 (April 2026), SIQuester 6.9.1 (26. Juli). Läuft unter Windows (win-x86). Das Issue „SIGame Teams“ (April 2026) ist offen, ebenso eines zu Self-Hosting. Gut für ein Jeopardy-Format mit Hardware-Buzzern (es gibt sogar das Bastelprojekt u2vr/SiGameIRL), als Haupttool für 10 Teams aber zu speziell. Die Community ist überwiegend russischsprachig.
- **Surge-Tech/jeopardy** (siehe oben): die modernste webbasierte Jeopardy-Variante mit Board-Editor (6 Kategorien × 5 Hinweise), Bild und Video.

### 5. Präsentationsbasierte Ansätze (reveal.js)
- **juwit/reveal-quiz** (6 Sterne): Quiz-Folien in Markdown, Timer (`useTimer`, Standard 60 s) und zufällige Antwortreihenfolge. Nur zur Anzeige, ohne Abgabe vom Handy.
- **christer-eriksson/reveal_countdown** (11 Sterne): Countdown pro Folie mit Tick- und „Time's up“-Sound.
- **jschildgen/reveal.js-poll-plugin** (27 Sterne): Frage auf der Folie, Abstimmung per Handy, Ergebnis als Balken auf der Folie (PHP und SQLite). Am ehesten „Fragen nur auf dem Beamer“, aber ohne Punkte nach Geschwindigkeit.
- **parmsam/quarto-quiz:** Multiple Choice in Quarto/RevealJS.

**Bewertung:** reveal.js mit Countdown plus Antwortzetteln oder einem Scoreboard ist die robusteste Variante überhaupt. Es gibt nichts, was im WLAN ausfallen kann. Schnelligkeitspunkte gibt es so aber nicht.

### Vergleichstabelle (Kernkandidaten)
| | Razzia 3.1 | ClassQuiz | Surge-Tech/jeopardy | PubQuizMaster | reveal.js + Countdown | Crowdpurr Basic | SpeedQuizzing Pro |
|---|---|---|---|---|---|---|---|
| Lizenz | MIT | MPL-2.0 | nicht geprüft | nicht geprüft | MIT (reveal.js) | proprietär | proprietär |
| Aktivität 2026 | sehr aktiv | aktiv | v1.0.0 | neu | stabil | SaaS | V5 (5.4.11) |
| Deployment | 1 Docker-Container | Compose-Stack, 5+ Dienste, HTTPS | Docker | .NET + Postgres | statische Dateien | gehostet | Windows/Mac-App, LAN |
| Team-Modus | nein (1 Gerät/Team) | nein (1 Gerät/Team) | Spieler/Teams am Buzzer | ja (Papier) | – | ja (Team-Modi) | ja (Teams teilen Gerät) |
| Frage nur auf Beamer | erst v4.0 („Answers only“) | unklar, testen | Board auf TV | – | ja | einstellbar prüfen | Desktop-App auf Projektor |
| Zeitlimit / Speed-Punkte | 5–120 s, Kahoot-Punkte | ja | Buzzer-Lockout | – | nur Anzeige | ja | ja (Speed ist Kernprinzip) |
| Schätzfragen | geplant (#130) | ja (RANGE) | – | Papier | Papier | nicht geprüft | ja (numerisch) |
| Medien | Bild/Audio/Video per URL | Bilder (+ evtl. YouTube) | Bild/Video | – | alles | Bilder/GIF/YouTube | ja |
| Offline/LAN | ja | mühsam (HTTPS) | ja | ja | ja | nein (Internet) | ja (LAN by design) |
| Deutsch | prüfen | ja | nein | ? | frei | Englisch | Englisch |
| Aufwand bis 3. November | gering | mittel bis hoch | gering | mittel | sehr gering | sehr gering | gering, kostet pro Abend |
| Eignung (~10 Teams) | **hoch** | mittel | Ergänzung | Ergänzung | Fallback | **hoch (Plan B)** | hoch |

## Recommendations

### Top 3
1. **Razzia als Hauptsystem.** Es ist am robustesten (ein Container, keine externen Dienste, Reconnect) und braucht den geringsten Aufwand. Zur Schummelsicherheit:
   - Zeitlimit 10–20 s und `cooldown` 3–5 s. So lesen alle die Frage zuerst auf dem Beamer, bevor Antworten möglich sind.
   - Es spielt nur ein Gerät pro Team, Nickname gleich Teamname. Fremde Geräte kickt man vor dem Start in der Lobby. Die Raumsperre kommt erst mit v4.0.
   - Minuspunkte für falsche Antworten aktivieren (3.1.0), damit sich Raten bei kurzen Fenstern nicht lohnt.
   - „Answers only“ nur nutzen, wenn v4.0 rechtzeitig als Release erscheint.
2. **Crowdpurr Basic als vorbereiteter Plan B.** Das ist kein Open Source, aber kostenlos. Laut dem Crowdpurr-Hilfeartikel „Basic Plan Features Explained“ (Stand 24. März 2026) erlaubt es bis zu 20 Teilnehmer und 15 Fragen pro Experience. Mehrere davon lassen sich verknüpfen: „you can create up to a three-round, 45-question trivia game experience for up to 20 participants for FREE!“ Team-Modi sind laut Anbieter auch im Basic-Plan enthalten. Die gleichen Fragen sollte man parallel dort anlegen. Fällt das LAN aus, laufen die Handys über mobile Daten weiter.
3. **Hybrid für Spezialrunden:** eine Schätz- und eine Audio-Runde auf Papier mit quasar-scoreboard (offline, Beamer) oder PubQuizMaster (Helfer erfassen Punkte am Handy). Optional ein Buzzer-Finale mit Surge-Tech/jeopardy. Das stärkt die Schummelsicherheit zusätzlich, denn bei Audio und Schätzfragen hilft Googeln kaum, wenn das Zeitfenster kurz ist.

**ClassQuiz nur dann,** wenn RANGE- und TEXT-Fragen wichtig sind. Dann die gehostete Instanz classquiz.de nehmen und nicht selbst hosten. Vorher ausprobieren, ob die Frage auf den Handys sichtbar ist.

### Zeitplan bis 3. November (bei Start am 1. Oktober)
- **Bis 10. Oktober:** Razzia per Docker starten und eine Testrunde mit 3–4 Handys (iOS und Android) spielen. Gleichzeitig die Kneipe fragen, ob ein Beamer verfügbar ist oder ein TV mit HDMI.
- **Bis 20. Oktober:** Fragen als JSON schreiben und Medien lokal ablegen. Prüfen, ob Razzia v4.0 erschienen ist. Crowdpurr-Fallback anlegen.
- **Bis 27. Oktober:** Generalprobe *in der Kneipe* mit deren WLAN. Wichtigster Test: Erreichen die Handys im Gäste-WLAN den Laptop?
- **2. November:** Container-Image und Quiz-Dateien einfrieren, kein `latest`-Pull mehr.

### Deployment: Laptop im LAN vs. VPS
| | Laptop als lokaler Server | VPS |
|---|---|---|
| Vorteile | Läuft ohne Internet, geringe Latenz, keine Daten bei Dritten | Unabhängig vom Kneipen-Netz. Die Handys können über mobile Daten spielen. HTTPS per Let's Encrypt ist einfach (für ClassQuiz zwingend) |
| Risiken | **Client Isolation im Gäste-WLAN:** Viele Router lassen Geräte im Gäste-Netz nicht miteinander sprechen. Dann erreicht kein Handy den Laptop. Außerdem: Energiesparmodus, Firewall | Abhängig vom Uplink der Kneipe und vom Mobilfunk im Raum (Kellerkneipe!) |
| Empfehlung | Einen **eigenen Travel-Router** mitbringen (eigene SSID, Laptop per Kabel) und vom Kneipen-WLAN unabhängig sein. 10 Team-Geräte schafft jeder kleine Router | Als **Zweitinstanz** mit identischer Quiz-Datei bereithalten. Bricht das LAN zusammen, wechselt man per QR-Code auf die VPS-URL |

**Hotspot-Backup:** Ein Handy-Hotspot trägt 10 Clients, aber nur sinnvoll in Kombination mit der VPS-Instanz. Für Laptop-im-LAN ist der eigene Router das bessere Backup. Medien-URLs müssen auf den lokalen Server zeigen, nicht auf externe Hoster, sonst fehlen die Bilder offline. Den Join-Link als QR-Code auf den Beamer und zusätzlich ausgedruckt auf die Tische legen.

### Wann kommerziell besser ist
- **Kein Beamer:** Dann müssen die Fragen ohnehin auf die Handys. Der Vorteil von „nur Hauptbildschirm“ entfällt, und Crowdpurr ist bequemer.
- **Keine Zeit für eine Generalprobe vor Ort:** Crowdpurr braucht nur Internet auf den Handys, das LAN-Risiko fällt weg.
- **Team-Modi, Fragenpakete und Profi-Gefühl gewünscht:** SpeedQuizzing ist für Kneipen gebaut. Auf der eigenen Startseite schreibt der Hersteller: „Since 2011, SpeedQuizzing has changed the way trivia and quizzes are hosted… Currently way in excess of 2000 events weekly“ (Eigenangabe). Es läuft „over a LAN rather than the Internet“, Teams teilen sich ein Gerät, und jede Pro-Aktivierung (3 Credits) enthält ein Quizpack mit über 70 Fragen. Nachteile: Jedes Team braucht die SpeedQuizzing-App. Bezahlt wird pro Abend mit Credits. Und die Angaben zur Hardware widersprechen sich: Die Download-Seite sagt, es „may work on your own WiFi“, die Shop-Seite (speedquizzing.com/shop) dagegen: „A Pocket Hub is required to host SpeedQuizzing Pro.“ Als Alternative zum Pocket Hub nennt der Shop „Ruckus Hardware“. Den Preis von ca. £21 aus der Anfrage konnte ich auf der offiziellen Preisseite nicht verifizieren. Vor dem Kauf klären.
- **Wiederkehrende Quiz-Reihe:** Ab der zweiten oder dritten Ausgabe lohnt sich der Open-Source-Aufbau. Für einen einmaligen Abend ist Crowdpurr Basic nüchtern betrachtet der geringste Aufwand.

## Caveats
- **Release-Stand v4.0:** Die Features „Answers only“, Survey-Modus und Auto-Advance sind laut GitHub nur in `dev` gemergt. Das letzte Release ist 3.1.0 vom 5. Juli 2026. Das Razzia-Issue #200 „Roadmap v4.0“ (eröffnet am 11. September 2026) kündigt Breaking Changes an: „the way the web client and the server talk to each other is being rewritten, which means breaking changes for existing deployments.“
- **Nicht verifiziert:** ob ClassQuiz die Frage auf den Handys zeigt, das Datum des letzten ClassQuiz-Commits, ob PR #401/#408 gemergt wurde, eine deutsche Übersetzung für Razzia, die Lizenzen von Surge-Tech/jeopardy und PubQuizMaster sowie der genaue SpeedQuizzing-Preis.
- **Crowdpurr-Limits:** Drittseiten nennen abweichende Werte. Ein Konkurrent spricht von nur 8 Teilnehmern, G2 nennt „20 participants, 10 questions, and 3 experiences“, Capterra „15 questions and 20 participants“. Die 15 Fragen entsprechen dem offiziellen Limit pro Experience. Ich stütze mich auf den Hilfeartikel von Crowdpurr selbst: 20 Teilnehmer, 15 Fragen pro Experience, bis zu 3 Runden mit zusammen 45 Fragen. Auch bei Crowdpurr verarbeitet ein US-Anbieter die Teilnehmerdaten. Für Nicknames ist das unkritisch, trotzdem sollte man es wissen.
- **Schummelsicherheit hat Grenzen:** Eine Frage auf dem Beamer lässt sich abfotografieren, und ein zweites Handy kann googeln. Wirksam sind Zeitfenster unter 20 s, Minuspunkte und Fragen, die sich schlecht googeln lassen (Bilder, Audio, Schätzen).
