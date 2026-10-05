#!/usr/bin/env python3
"""Rekey the existing release catalogs after the English-source change (#366).

No translation service is used. Every new original has one explicit old-original
mapping; all non-German translations are copied from that original's catalog.
Unsupported context/plural forms and missing mappings fail closed.
"""

import ast
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
LANG = ROOT / "wordpress-plugin/deepglot/languages"
BASE = "4dff0de2bb75543920c1eb86ccd9034a67914bb7"
MAPPING = json.loads((ROOT / "scripts/i18n-wordpress-english-map.json").read_text())
INVERSE = {english: old for old, english in MAPPING.items()}
NEW_STRINGS = {
    "Select highlighted text on the page.": ("Wähle einen markierten Text auf der Seite.", "Välj den markerade texten på sidan."),
    "Original": ("Original", "Original"),
    "Translation": ("Übersetzung", "Översättning"),
    "Close": ("Schließen", "Stäng"),
    "Save": ("Speichern", "Spara"),
    "Saving…": ("Wird gespeichert …", "Sparar…"),
    "Could not save the translation.": ("Die Übersetzung konnte nicht gespeichert werden.", "Det gick inte att spara översättningen."),
    "Saved.": ("Gespeichert.", "Sparat."),
    "Invalid editor token.": ("Ungültiger Editor-Token.", "Ogiltig redigerartoken."),
    "Visual Editor is active. Click highlighted text to edit it.": ("Der visuelle Editor ist aktiv. Klicke auf einen markierten Text, um ihn zu bearbeiten.", "Den visuella redigeraren är aktiv. Klicka på den markerade texten för att redigera den."),
    "Could not start the Visual Editor.": ("Der visuelle Editor konnte nicht gestartet werden.", "Det gick inte att starta den visuella redigeraren."),
    "🇺🇸 or https://example.com/flag.svg": ("🇺🇸 oder https://example.com/flag.svg", "🇺🇸 eller https://example.com/flag.svg"),
    "%s: 🇦🇹 or https://…": ("%s: 🇦🇹 oder https://…", "%s: 🇦🇹 eller https://…"),
}
FORMAL_NEW = {
    "Select highlighted text on the page.": "Wählen Sie einen markierten Text auf der Seite.",
    "Visual Editor is active. Click highlighted text to edit it.": "Der visuelle Editor ist aktiv. Klicken Sie auf einen markierten Text, um ihn zu bearbeiten.",
}
SV_FINAL_OVERRIDES = {
    "Translates WordPress content with Deepglot and a compatible translation API.": "Översätter WordPress-innehåll med Deepglot och ett kompatibelt översättnings-API.",
    "Active – pages are translated from %1$s to %2$s at /%3$s/your-page/": "Aktiv – sidor översätts från %1$s till %2$s på /%3$s/your-page/",
    "Path prefix (/en/my-page)": "Sökvägsprefix (/en/my-page)",
    'Full name ("English")': 'Fullständigt namn (”engelska”)',
    'ISO code ("EN")': 'ISO-kod (”EN”)',
    "Default: 768 px. Below this width, a device is treated as mobile.": "Standardvärde: 768 px. Under den bredden räknas enheten som mobil.",
}

if len(INVERSE) != len(MAPPING):
    raise SystemExit("English originals collide; use distinct context or copy.")


def parse_po(content):
    entries = {}
    for chunk in re.split(r"\n\s*\n", content.strip()):
        fields = {}
        active = None
        comments = []
        for line in chunk.splitlines():
            if line.startswith("#"):
                comments.append(line)
                continue
            match = re.match(r'^(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?)\s+(".*")$', line)
            if match:
                active = match.group(1)
                fields[active] = ast.literal_eval(match.group(2))
            elif line.startswith('"') and active:
                fields[active] += ast.literal_eval(line)
        if "msgid" in fields:
            if "msgctxt" in fields or "msgid_plural" in fields or any(k.startswith("msgstr[") for k in fields):
                raise ValueError("Context or plural requires explicit migration: " + fields["msgid"])
            key = fields["msgid"]
            if key in entries:
                raise ValueError("Duplicate original: " + key)
            entries[key] = (fields.get("msgstr", ""), comments)
    return entries


def old_catalog(locale):
    name = f"wordpress-plugin/deepglot/languages/deepglot-{locale}.po"
    return parse_po(subprocess.check_output(["git", "show", f"{BASE}:{name}"], cwd=ROOT, text=True))


def quote(value):
    return json.dumps(value, ensure_ascii=False)


def header(locale):
    return "\n".join([
        'msgid ""', 'msgstr ""',
        quote("Project-Id-Version: Deepglot 0.12.11\n"),
        quote("Report-Msgid-Bugs-To: https://deepglot.ai\n"),
        quote("POT-Creation-Date: 2026-10-05 00:00+0000\n"),
        quote("PO-Revision-Date: 2026-10-05 00:00+0000\n"),
        quote(("Last-Translator: Deepglot AI Swedish review\n" if locale == "sv_SE" else "Last-Translator: Deepglot offline catalog migration\n")),
        quote("Language-Team: Deepglot\n"),
        quote(f"Language: {locale}\n"),
        quote("MIME-Version: 1.0\n"),
        quote("Content-Type: text/plain; charset=UTF-8\n"),
        quote("Content-Transfer-Encoding: 8bit\n"),
        quote("Plural-Forms: nplurals=2; plural=(n != 1);\n"),
        quote("X-Generator: Deepglot offline catalog migration\n"),
    ])


pot = parse_po((LANG / "deepglot.pot").read_text())
pot.pop("")
if set(pot) != set(INVERSE) | set(NEW_STRINGS):
    raise SystemExit(f"POT/mapping mismatch: added={set(pot)-set(INVERSE)-set(NEW_STRINGS)}, removed={(set(INVERSE)|set(NEW_STRINGS))-set(pot)}")

po_paths = sorted(set(LANG.glob("deepglot-*.po")) | {LANG / "deepglot-de_DE_formal.po"})
for po_path in po_paths:
    locale = po_path.stem.removeprefix("deepglot-")
    old = old_catalog(locale) if locale != "de_DE_formal" else parse_po(
        (ROOT / "scripts/fixtures/issue-366-de-DE-formal-official-old.po").read_text()
    )
    if locale == "sv_SE":
        old = parse_po((ROOT / "scripts/fixtures/issue-366-sv-reviewed-old.po").read_text())
    chunks = [header(locale)]
    for english, (_, comments) in pot.items():
        if english in NEW_STRINGS:
            german, swedish = NEW_STRINGS[english]
            translated = (FORMAL_NEW.get(english, german) if locale == "de_DE_formal" else
                          german if locale == "de_DE" else swedish if locale == "sv_SE" else
                          english if locale == "en_US" else "")
        else:
            previous = INVERSE[english]
            if locale == "de_DE_formal":
                translated = old.get(previous, (previous, []))[0] or previous
            elif previous not in old or not old[previous][0]:
                raise SystemExit(f"Missing previous translation: {locale}: {previous}")
            else:
                translated = previous if locale == "de_DE" else english if locale == "en_US" else old[previous][0]
        if locale == "sv_SE":
            translated = SV_FINAL_OVERRIDES.get(english, translated)
        chunks.append("\n".join([*comments, "msgid " + quote(english), "msgstr " + quote(translated)]))
    po_path.write_text("\n\n".join(chunks) + "\n")
    subprocess.run(["msgfmt", "--check", "-o", str(po_path.with_suffix(".mo")), str(po_path)], check=True)
    print(locale, len(pot))
