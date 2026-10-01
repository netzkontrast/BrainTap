# BrainTap

Planung für das Pub-Quiz am 3. November 2026 (Köln/Bonn, ca. 40 Personen, 6–10 Teams).

## Planungstool

- [`index.html`](index.html): Startseite der Planungssession.
- [`planung.html`](planung.html): Entscheidungen, Zeitplan & To-dos, Runden-Planer mit Ablauf, Fragen-Bank (Status, KI-Test, Multiple Choice, Schätzfragen), Beamer-Präsentation mit Countdown, Razzia-Export, Druck von Antwortbögen und Moderationskarten, Kasse & Budget, Technik-Checkliste, Teams, Antworterfassung und Scoreboard mit Beamer-Ansicht.

Alles wird auf dem Server gespeichert: Vercel Functions unter `api/` schreiben in eine SQLite-Datenbank bei Turso (libSQL). Jede Aufgabe, Runde, Punktzahl und Antwort ist eine eigene Zeile. Konflikte entscheidet die Server-Revision, nicht die Geräteuhr: Jede Änderung nennt die Revision, auf der sie beruht; hat jemand die Zeile inzwischen geändert, wird sie abgelehnt, der Client übernimmt die Serverfassung und zeigt einen Hinweis. Rundensummen werden aus den erfassten Antworten berechnet. Jede Änderung trägt eine Server-Revision, den Namen der Person und die Uhrzeit: Clients laden nach dem ersten Abruf nur noch Änderungen (`/api/state?since=N`), die Übersicht zeigt „Letzte Änderungen“, und Gelöschtes lässt sich aus dem Papierkorb wiederherstellen (`/api/history`). Zugriff nur mit Anmeldung: gemeinsames Orga-Passwort und/oder Login über Auth0 (OpenID Connect, beschränkt auf eine E-Mail-Liste). Ohne Netz puffert der Browser Änderungen und schickt sie nach; ein Service Worker hält die Seite offline ladbar. Export als JSON oder `.sqlite`.

### Speed-Runde

Die digitale Speed-Runde läuft direkt in BrainTap auf Vercel, ohne Docker und ohne WebSockets:

- **Teams** öffnen auf einem Handy pro Team `speed.html` und geben ihren fünfstelligen Team-Code ein (Tischkarten druckt der Tab *Speed-Runde*). Ein Team-Gerät sieht nur die laufende Frage und die eigene Antwort; Planungsdaten bleiben gesperrt.
- **Orga** steuert im Tab *Speed-Runde*: Runde öffnen, Fragen nacheinander starten, Zeit stoppen, auflösen, beenden. Die Fragen kommen aus der Fragen-Bank der gewählten Runde (gleiche Nummerierung wie Beamer und Antwortbögen).
- **Server-Uhr**: `api/speed.js` setzt Start und Ende jeder Frage; verspätete Antworten werden abgelehnt. Multiple Choice und exakt passende Freitext-Antworten werden automatisch gewertet, alles andere per ✓/✗.
- **Scoreboard**: Antworten landen in derselben `answers`-Tabelle wie die Papierrunden und zählen sofort.
- **Beamer**: `speed.html?screen=1` (mit Orga-Anmeldung) zeigt Frage, Countdown und wie viele Teams geantwortet haben.

Die Geräte fragen den Stand jede Sekunde ab; Verbindungsabbrüche überstehen sie, weil der Spielstand in der Datenbank liegt und nicht im Speicher einer Funktion. Razzia selbst (Socket.IO mit Spielständen im Arbeitsspeicher) ließe sich auf Vercel nicht zuverlässig betreiben.

### Konfiguration (Vercel)

Alles läuft auf Vercel. Die Datenbank ist eine SQLite-Datei, die als privater **Vercel Blob** gespeichert wird; jeder Schreibvorgang ist eine Transaktion mit ETag-Prüfung und automatischer Wiederholung bei gleichzeitigen Zugriffen (`api/_snapshot.js`). Alternativ wird eine Turso-Datenbank genutzt, sobald `TURSO_DATABASE_URL` gesetzt ist.

| Variable | Zweck |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Wird gesetzt, wenn man im Projekt unter *Storage → Create → Blob* einen Blob Store anlegt und verbindet |
| `ORGA_PASSWORD` | Gemeinsames Passwort des Orga-Teams |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Optional statt Blob |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | Optional: Login über Auth0 (Regular Web Application, Callback-URL `https://<domain>/api/oidc-callback`). Die Namen der Auth0-Integration aus dem Vercel Marketplace (`AUTH0_ISSUER_BASE_URL`, `AUTH0_SECRET`) werden ebenfalls erkannt |
| `AUTH_ALLOWED_EMAILS` | Kommagetrennte E-Mail-Adressen, die sich per Auth0 anmelden dürfen (Pflicht für Auth0) |
| `AUTH_SECRET` | Zufälliger Schlüssel (≥ 32 Zeichen) zum Signieren der Sitzungen; nötig, wenn kein `ORGA_PASSWORD` gesetzt ist |

`/api/health` zeigt ohne Login, ob Speicher und Anmeldung eingerichtet sind. Ist Auth0 eingerichtet, zeigt die Anmeldeseite „Mit Auth0 anmelden“; ohne `ORGA_PASSWORD` entfällt das Passwortfeld.

### Einrichtung auf Vercel

1. *Storage → Create → Blob* (privat, Region `fra1`) und mit dem Projekt verbinden – setzt `BLOB_READ_WRITE_TOKEN`.
2. `AUTH_SECRET` als *Sensitive* Variable setzen (`openssl rand -hex 32`).
3. Anmeldung wählen:
   - Passwort: `ORGA_PASSWORD` setzen, und/oder
   - Auth0: *Integrations → Browse Marketplace → Auth0* installieren und mit dem Projekt verbinden (oder eine Regular Web Application in Auth0 anlegen und `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` selbst setzen). In der Auth0-Anwendung als *Allowed Callback URL* `https://braintap-theta.vercel.app/api/oidc-callback` eintragen, dann `AUTH_ALLOWED_EMAILS` setzen.
4. Neu deployen und `/api/health` prüfen.

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
