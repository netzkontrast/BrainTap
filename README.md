# BrainTap

Planung für das Pub-Quiz am 3. November 2026 (Köln/Bonn, ca. 40 Personen, 6–10 Teams).

## Planungstool

- [`index.html`](index.html): Startseite der Planungssession.
- [`planung.html`](planung.html): Entscheidungen, Zeitplan & To-dos, Runden-Planer mit Ablauf, Fragen-Bank (Status, KI-Test, Multiple Choice, Schätzfragen), Beamer-Präsentation mit Countdown, Razzia-Export, Druck von Antwortbögen und Moderationskarten, Kasse & Budget, Technik-Checkliste, Teams, Antworterfassung und Scoreboard mit Beamer-Ansicht.

Alles wird auf dem Server gespeichert: Vercel Functions unter `api/` schreiben in eine SQLite-Datenbank bei Turso (libSQL). Jede Aufgabe, Runde, Punktzahl und Antwort ist eine eigene Zeile. Konflikte entscheidet die Server-Revision, nicht die Geräteuhr: Jede Änderung nennt die Revision, auf der sie beruht; hat jemand die Zeile inzwischen geändert, wird sie abgelehnt, der Client übernimmt die Serverfassung und zeigt einen Hinweis. Rundensummen werden aus den erfassten Antworten berechnet. Jede Änderung trägt eine Server-Revision, den Namen der Person und die Uhrzeit: Clients laden nach dem ersten Abruf nur noch Änderungen (`/api/state?since=N`), die Übersicht zeigt „Letzte Änderungen“, und Gelöschtes lässt sich aus dem Papierkorb wiederherstellen (`/api/history`). Zugriff nur mit dem gemeinsamen Orga-Passwort. Ohne Netz puffert der Browser Änderungen und schickt sie nach; ein Service Worker hält die Seite offline ladbar. Export als JSON oder `.sqlite`.

### Konfiguration (Vercel)

Alles läuft auf Vercel. Die Datenbank ist eine SQLite-Datei, die als privater **Vercel Blob** gespeichert wird; jeder Schreibvorgang ist eine Transaktion mit ETag-Prüfung und automatischer Wiederholung bei gleichzeitigen Zugriffen (`api/_snapshot.js`). Alternativ wird eine Turso-Datenbank genutzt, sobald `TURSO_DATABASE_URL` gesetzt ist.

| Variable | Zweck |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Wird gesetzt, wenn man im Projekt unter *Storage → Create → Blob* einen Blob Store anlegt und verbindet |
| `ORGA_PASSWORD` | Gemeinsames Passwort des Orga-Teams |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Optional statt Blob |

`/api/health` zeigt ohne Login, ob Speicher und Passwort eingerichtet sind.

### Lokal starten

```bash
npm install
npm run dev     # http://localhost:3000, Passwort "quiz", Datenbank braintap.local.db
npm test        # API-Tests
npm run test:e2e   # Browser-Regressionstests (Playwright; CHROMIUM_PATH setzen, falls kein Playwright-Browser installiert ist)
```

## Dokumente

- [Recherche: Schummelsicheres Pub-Quiz – Tools, Formate, Empfehlung](docs/recherche-schummelsicheres-pubquiz.md)
- [Recherche: Digitales Pub-Quiz selbst hosten – Open-Source-Optionen](docs/recherche-open-source-selbst-hosten.md)
