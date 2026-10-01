# BrainTap

Planung für das Pub-Quiz am 3. November 2026 (Köln/Bonn, ca. 40 Personen, 6–10 Teams).

## Planungstool

- [`index.html`](index.html): Startseite der Planungssession.
- [`planung.html`](planung.html): Entscheidungen, Zeitplan & To-dos, Runden-Planer mit Ablauf, Fragen-Bank (Status, KI-Test, Multiple Choice), Razzia-Export, Druck von Antwortbögen und Moderationskarten, Technik-Checkliste, Teams, Antworterfassung und Scoreboard mit Beamer-Ansicht.

Alles wird auf dem Server gespeichert: Vercel Functions unter `api/` schreiben in eine SQLite-Datenbank bei Turso (libSQL). Jede Aufgabe, Runde, Punktzahl und Antwort ist eine eigene Zeile; bei gleichzeitigen Änderungen gewinnt pro Zeile die neuere. Zugriff nur mit dem gemeinsamen Orga-Passwort. Ohne Netz puffert der Browser Änderungen und schickt sie nach; ein Service Worker hält die Seite offline ladbar. Export als JSON oder `.sqlite`.

### Konfiguration (Vercel)

| Variable | Zweck |
|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Turso-Datenbank (setzt die Vercel-Marketplace-Integration automatisch) |
| `ORGA_PASSWORD` | Gemeinsames Passwort des Orga-Teams |

### Lokal starten

```bash
npm install
npm run dev     # http://localhost:3000, Passwort "quiz", Datenbank braintap.local.db
npm test        # API-Tests
```

## Dokumente

- [Recherche: Schummelsicheres Pub-Quiz – Tools, Formate, Empfehlung](docs/recherche-schummelsicheres-pubquiz.md)
- [Recherche: Digitales Pub-Quiz selbst hosten – Open-Source-Optionen](docs/recherche-open-source-selbst-hosten.md)
