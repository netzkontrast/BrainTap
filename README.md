# BrainTap

Planung für das Pub-Quiz am 3. November 2026 (Köln/Bonn, ca. 40 Personen, 6–10 Teams).

## Planungstool

- [`index.html`](index.html): Startseite der Planungssession.
- [`planung.html`](planung.html): Entscheidungen, Zeitplan & To-dos, Runden-Planer mit Ablauf, Technik-Checkliste, Teams, Antworterfassung und Scoreboard mit Beamer-Ansicht.

Die Planung wird im Browser gespeichert (localStorage) und lässt sich als JSON exportieren/importieren. Antworten der Teams liegen in einer lokalen SQLite-Datenbank (sql.js, in `vendor/sqljs`, gespeichert in IndexedDB) und lassen sich als `.sqlite` exportieren.

Lokal starten (SQLite braucht einen Webserver, `file://` reicht nicht):

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## Dokumente

- [Recherche: Schummelsicheres Pub-Quiz – Tools, Formate, Empfehlung](docs/recherche-schummelsicheres-pubquiz.md)
- [Recherche: Digitales Pub-Quiz selbst hosten – Open-Source-Optionen](docs/recherche-open-source-selbst-hosten.md)
