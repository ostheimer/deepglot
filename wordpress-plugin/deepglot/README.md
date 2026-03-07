# Deepglot WordPress Plugin

Dieses Verzeichnis enthaelt das erste MVP-Grundgeruest fuer das Deepglot-WordPress-Plugin.

## Autor

Andreas Ostheimer  
https://www.ostheimer.at

## Autor

Andreas Ostheimer  
https://www.ostheimer.at

## Enthalten in diesem Stand

- Plugin-Bootstrap mit WordPress-Header
- einfacher PSR-4-artiger Autoloader
- kleiner Service-Container
- Admin-Seite unter `Einstellungen -> Deepglot`
- konfigurierbarer API-Client fuer die Deepglot-API
- erste Frontend-Integration per Output Buffer
- testbare URL-Sprachlogik fuer Sprachpraefixe wie `/en/about/`

## Verzeichnisstruktur

```text
wordpress-plugin/deepglot/
├── deepglot.php
├── bootstrap.php
├── includes/
│   ├── Admin/
│   ├── Api/
│   ├── Config/
│   ├── Frontend/
│   └── Support/
└── tests/
```

## Installation in WordPress

1. Ordner `wordpress-plugin/deepglot` als ZIP paketieren.
2. In WordPress unter `Plugins -> Installieren -> Plugin hochladen` importieren.
3. Plugin aktivieren.
4. Unter `Einstellungen -> Deepglot` API-Basis-URL, API-Key und Sprachen konfigurieren.

## Aktueller Funktionsumfang

Der Stand ist bewusst ein Grundgeruest:

- Die Admin-Konfiguration ist bereits nutzbar.
- Der API-Client ist vorbereitet und kann direkt an `POST /api/translate` gekoppelt werden.
- Das Frontend startet bei aktivierter Zielsprache bereits den Output Buffer.
- Die eigentliche HTML-Extraktion, Uebersetzung, Cache-Tabelle und Link-Ersetzung folgen in den naechsten Schritten.

## Test

Falls PHP lokal verfuegbar ist:

```bash
php wordpress-plugin/deepglot/tests/UrlLanguageResolverTest.php
```

## Naechste Plugin-Schritte

1. Request-URL-/Spracherkennung direkt in das Frontend integrieren
2. HTML-Parser und String-Extraktion anbinden
3. API-Client fuer echte Uebersetzungsrequests verwenden
4. lokalen WordPress-Cache und Link-Replacement ergaenzen
