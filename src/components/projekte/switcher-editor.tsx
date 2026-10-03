"use client";

import { useState } from "react";
import type { SwitcherConfig } from "@/lib/switcher-contract";
import { getLanguageName } from "@/lib/language-names";
import type { SiteLocale } from "@/lib/site-locale";
import { uiText } from "@/lib/static-copy";

type Props = {
  projectId: string;
  locale: SiteLocale;
  initialOwner: string;
  initialRevision: number;
  initialConfig: SwitcherConfig | null;
  pluginSyncedAt: string | null;
  pluginRevision: number | null;
  conflict: boolean;
  languages: string[];
  wpSettingsUrl: string | null;
};

export function SwitcherEditor(props: Props) {
  const [owner, setOwner] = useState(props.initialOwner);
  const [revision, setRevision] = useState(props.initialRevision);
  const [config, setConfig] = useState<SwitcherConfig | null>(props.initialConfig);
  const [selected, setSelected] = useState("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const t = (en: string, de: string) => uiText(props.locale, en, de);
  const instance = config?.instances.find((item) => item.id === selected) ?? config?.instances[0];
  const update = (patch: Partial<NonNullable<typeof instance>>) => {
    if (!config || !instance) return;
    setConfig({ ...config, instances: config.instances.map((item) => item.id === instance.id ? { ...item, ...patch } : item) });
  };
  const moveLanguage = (code: string, direction: -1 | 1) => {
    if (!instance) return;
    const order = [...instance.languageOrder];
    const from = order.indexOf(code);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    update({ languageOrder: order });
  };
  const save = async (action: "save" | "returnToWordPress") => {
    if (action === "save" && !config) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${props.projectId}/switcher`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "save"
          ? { action, expectedRevision: revision, expectedPluginSyncedAt: props.pluginSyncedAt, config }
          : { action, expectedRevision: revision }),
      });
      if (!response.ok) {
        setError(response.status === 409
          ? t("Settings changed since you opened this page. Reload before saving.", "Die Einstellungen wurden seit dem Öffnen geändert. Bitte vor dem Speichern neu laden.")
          : t("The switcher settings could not be saved. Check the fields and try again.", "Die Sprachauswahl konnte nicht gespeichert werden. Bitte prüfe die Felder."));
        return;
      }
      const result = await response.json();
      setRevision(result.revision);
      setOwner(action === "save" ? "saas" : "wordpress");
      if (action === "returnToWordPress") setConfig(null);
      setMessage(action === "save"
        ? t("Saved. WordPress will apply the changes on its next sync.", "Gespeichert. WordPress übernimmt die Änderungen beim nächsten Abgleich.")
        : t("You can now manage the switcher in WordPress.", "Du kannst die Sprachauswahl jetzt in WordPress verwalten."));
    } catch {
      setError(t("Connection failed. Please try again.", "Verbindung fehlgeschlagen. Bitte erneut versuchen."));
    } finally { setBusy(false); }
  };

  if (!config || !instance) return <section className="rounded-xl border bg-white p-6" role="status">
    {message ? <p className="mb-2">{message}</p> : null}
    <p>{t("WordPress switcher settings have not been synced yet. Sync the current plugin before editing here.", "Die WordPress-Einstellungen für die Sprachauswahl wurden noch nicht abgeglichen. Gleiche zuerst das aktuelle Plugin ab.")}</p>
    {props.wpSettingsUrl ? <a className="mt-2 inline-block underline" href={props.wpSettingsUrl} target="_blank" rel="noopener noreferrer">
      {t("Open WordPress switcher editor", "WordPress-Editor für Sprachauswahl öffnen")}
    </a> : null}
  </section>;

  const mirrorOld = !props.pluginSyncedAt || Date.now() - new Date(props.pluginSyncedAt).getTime() > 15 * 60 * 1000;
  const stale = owner === "saas" && props.pluginRevision !== revision;
  return <div className="space-y-5">
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <strong>{owner === "saas" ? t("Dashboard manages the switcher", "Dashboard verwaltet die Sprachauswahl") : t("WordPress manages the switcher", "WordPress verwaltet die Sprachauswahl")}</strong>
      <p className="mt-1">{owner === "saas"
        ? t("WordPress remains available. A local edit is kept and reported as a conflict until you resolve ownership.", "WordPress bleibt bedienbar. Eine lokale Änderung bleibt erhalten und wird als Konflikt gemeldet, bis die Zuständigkeit geklärt ist.")
        : t("Saving here explicitly adopts the last reported WordPress configuration.", "Speichern übernimmt ausdrücklich die zuletzt gemeldete WordPress-Konfiguration.")}</p>
      {props.wpSettingsUrl ? <a className="underline" href={props.wpSettingsUrl} target="_blank" rel="noopener noreferrer">{t("Open WordPress switcher editor", "WordPress-Editor für Sprachauswahl öffnen")}</a> : null}
    </div>
    {props.conflict && owner === "saas" ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("WordPress reports local changes that differ from the dashboard version. They were preserved. Review them in WordPress or return ownership there.", "WordPress meldet lokale Änderungen gegenüber der Dashboard-Version. Sie wurden erhalten. Prüfe sie in WordPress oder gib die Zuständigkeit dorthin zurück.")}</div> : null}
    {stale ? <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("WordPress has not confirmed these changes yet.", "WordPress hat diese Änderungen noch nicht bestätigt.")}</div> : null}
    {mirrorOld ? <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("WordPress settings have not been synced in over 15 minutes. Check the plugin connection before using these values.", "Die WordPress-Einstellungen wurden seit über 15 Minuten nicht abgeglichen. Prüfe die Plugin-Verbindung, bevor du diese Werte verwendest.")}</div> : null}
    {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</div> : null}
    {message ? <div role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm text-green-900">{message}</div> : null}
    <section className="rounded-xl border bg-white p-6 space-y-5" aria-labelledby="switcher-appearance-title">
      <h3 id="switcher-appearance-title" className="text-lg font-semibold">{t("Appearance and placement", "Darstellung und Platzierung")}</h3>
      <label className="block text-sm font-medium">{t("Switcher", "Sprachauswahl")}
        <select className="mt-1 w-full rounded border p-2" value={instance.id} onChange={(event) => setSelected(event.target.value)}>
          {config.instances.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">{t("Name", "Name")}
        <input className="mt-1 w-full rounded border p-2" maxLength={100} value={instance.name} onChange={(event) => update({ name: event.target.value })} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {([
          ["enabled", "Enable switcher", "Sprachauswahl aktivieren"],
          ["autoInject", "Place automatically", "Automatisch platzieren"],
          ["showLabel", "Show language name", "Sprachname anzeigen"],
        ] as const).map(([key, en, de]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={instance[key]} onChange={(event) => update({ [key]: event.target.checked })} />{t(en, de)}</label>)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">{t("Display", "Darstellung")}<select className="mt-1 w-full rounded border p-2" value={instance.style} onChange={(event) => update({ style: event.target.value as "list" | "dropdown" })}><option value="list">{t("List", "Liste")}</option><option value="dropdown">Dropdown</option></select></label>
        <label className="text-sm font-medium">{t("Language label", "Sprachbezeichnung")}<select className="mt-1 w-full rounded border p-2" value={instance.labelFormat} onChange={(event) => update({ labelFormat: event.target.value as "full_name" | "iso_code" })}><option value="full_name">{t("Full name", "Vollständiger Name")}</option><option value="iso_code">{t("Language code", "Sprachcode")}</option></select></label>
        <label className="text-sm font-medium">{t("Flag style", "Flaggenstil")}<select className="mt-1 w-full rounded border p-2" value={instance.flagStyle} onChange={(event) => update({ flagStyle: event.target.value as typeof instance.flagStyle })}><option value="rectangle_mat">{t("Rectangle mat", "Rechteck matt")}</option><option value="rectangle_glossy">{t("Rectangle glossy", "Rechteck glänzend")}</option><option value="circle_mat">{t("Circle mat", "Kreis matt")}</option><option value="circle_glossy">{t("Circle glossy", "Kreis glänzend")}</option><option value="none">{t("No flags", "Keine Flaggen")}</option></select></label>
        <label className="text-sm font-medium">{t("Position", "Position")}<select className="mt-1 w-full rounded border p-2" value={instance.position} onChange={(event) => update({ position: event.target.value as typeof instance.position })}><option value="inline">{t("Within page", "In der Seite")}</option><option value="fixed-bottom-right">↘ {t("Bottom right", "Unten rechts")}</option><option value="fixed-bottom-left">↙ {t("Bottom left", "Unten links")}</option><option value="fixed-top-right">↗ {t("Top right", "Oben rechts")}</option><option value="fixed-top-left">↖ {t("Top left", "Oben links")}</option></select></label>
      </div>
      <label className="block text-sm font-medium">{t("CSS selector for automatic placement", "CSS-Selektor für automatische Platzierung")}
        <input className="mt-1 w-full rounded border p-2 font-mono" maxLength={200} value={instance.selector} onChange={(event) => update({ selector: event.target.value })} placeholder="#site-header > nav.primary" />
        <span className="mt-1 block text-xs text-gray-500">{t("Use the visual picker in WordPress to find an element on the site.", "Wähle ein Element auf der Website mit dem visuellen Editor in WordPress aus.")}</span>
      </label>
      <label className="block text-sm font-medium">{t("Custom CSS", "Eigenes CSS")}
        <textarea className="mt-1 min-h-32 w-full rounded border p-2 font-mono" maxLength={20000} value={instance.customCss} onChange={(event) => update({ customCss: event.target.value })} />
      </label>
    </section>
    <section className="rounded-xl border bg-white p-6 space-y-4" aria-labelledby="switcher-languages-title">
      <h3 id="switcher-languages-title" className="text-lg font-semibold">{t("Languages", "Sprachen")}</h3>
      <p className="text-sm text-gray-600">{t("Move languages with the buttons. A blank name or flag uses the plugin default.", "Verschiebe Sprachen mit den Schaltflächen. Ein leerer Name oder eine leere Flagge verwendet den Plugin-Standard.")}</p>
      {instance.languageOrder.filter((code) => props.languages.includes(code)).map((code, index) => <div key={code} className="grid gap-2 rounded border p-3 sm:grid-cols-[auto_1fr_1fr]">
        <div className="flex items-center gap-1"><strong className="mr-2 text-sm">{getLanguageName(code, props.locale)} ({code.toUpperCase()})</strong>
          <button type="button" className="rounded border px-2" disabled={index === 0} aria-label={t(`Move ${code} up`, `${code} nach oben verschieben`)} onClick={() => moveLanguage(code, -1)}>↑</button>
          <button type="button" className="rounded border px-2" disabled={index === instance.languageOrder.length - 1} aria-label={t(`Move ${code} down`, `${code} nach unten verschieben`)} onClick={() => moveLanguage(code, 1)}>↓</button>
        </div>
        <label className="text-sm">{t("Custom name", "Eigener Name")}<input className="mt-1 w-full rounded border p-2" maxLength={80} value={instance.customNames[code] ?? ""} onChange={(event) => update({ customNames: { ...instance.customNames, [code]: event.target.value } })} /></label>
        <label className="text-sm">{t("Custom flag (emoji or URL)", "Eigene Flagge (Emoji oder URL)")}<input className="mt-1 w-full rounded border p-2" maxLength={256} value={instance.customFlags[code] ?? ""} onChange={(event) => update({ customFlags: { ...instance.customFlags, [code]: event.target.value } })} /></label>
      </div>)}
    </section>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={() => save("save")}>{owner === "saas" ? t("Save changes", "Änderungen speichern") : t("Adopt in dashboard and save", "Im Dashboard übernehmen und speichern")}</button>
      {owner === "saas" ? <button type="button" className="rounded border px-4 py-2 disabled:opacity-50" disabled={busy} onClick={() => save("returnToWordPress")}>{t("Return control to WordPress", "Steuerung an WordPress zurückgeben")}</button> : null}
    </div>
  </div>;
}
