import { z } from "zod";
import { createHash } from "node:crypto";

const language = z.string().regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/);
const selector = z.string().max(200).refine(
  (value) => value === "" || /^(?:[A-Za-z][\w-]*|#[\w-]+|\.[\w-]+)+(?:\s*(?:>|\s)\s*(?:[A-Za-z][\w-]*|#[\w-]+|\.[\w-]+)+)*$/.test(value),
  "Use a simple element, class, ID, descendant or child selector.",
);
const safeCss = z.string().trim().max(20000).refine((value) => !value.includes("<"), "CSS cannot contain '<'.");
const safeName = (max: number) => z.string().trim().min(1).max(max)
  .refine((value) => !/[<>\r\n\t\f\v]|%[0-9a-f]{2}| {2,}/i.test(value), "WordPress would alter this name.");
const languageRecord = (max: number, forbidden: RegExp) => z.record(language,
  z.string().trim().max(max).refine((value) => !forbidden.test(value), "Unsupported characters."),
).transform((record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== "")));
const customNames = z.record(language, safeName(80).or(z.literal("")))
  .transform((record) => Object.fromEntries(Object.entries(record).filter(([, value]) => value !== "")));

export const switcherInstanceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  name: safeName(100),
  enabled: z.boolean(),
  autoInject: z.boolean(),
  style: z.enum(["list", "dropdown"]),
  flagStyle: z.enum(["rectangle_mat", "rectangle_glossy", "circle_mat", "circle_glossy", "none"]),
  showLabel: z.boolean(),
  labelFormat: z.enum(["full_name", "iso_code"]),
  languageOrder: z.array(language).max(201),
  customCss: safeCss,
  position: z.enum(["inline", "fixed-bottom-right", "fixed-bottom-left", "fixed-top-right", "fixed-top-left"]),
  responsiveHide: z.enum(["none", "mobile", "desktop"]),
  responsiveBreakpoint: z.number().int().min(320).max(1920),
  customFlags: languageRecord(256, /["';{}<>\\]/),
  customNames,
  selector,
}).strict();

export const switcherConfigSchema = z.object({
  contractVersion: z.literal(1),
  instances: z.array(switcherInstanceSchema).min(1).max(20),
}).strict().superRefine((config, ctx) => {
  const ids = new Set<string>();
  for (const [index, instance] of config.instances.entries()) {
    if (ids.has(instance.id)) ctx.addIssue({ code: "custom", path: ["instances", index, "id"], message: "Duplicate switcher ID." });
    ids.add(instance.id);
    if (new Set(instance.languageOrder).size !== instance.languageOrder.length) ctx.addIssue({ code: "custom", path: ["instances", index, "languageOrder"], message: "Duplicate language." });
  }
  if (!ids.has("default")) ctx.addIssue({ code: "custom", path: ["instances"], message: "The default switcher is required." });
});

export type SwitcherConfig = z.infer<typeof switcherConfigSchema>;

export function validateSwitcherLanguages(config: SwitcherConfig, active: readonly string[]) {
  const languages = new Set(active.map((code) => code.toLowerCase()));
  return config.instances.every((instance) =>
    instance.languageOrder.every((code) => languages.has(code)) &&
    Object.keys(instance.customFlags).every((code) => languages.has(code)) &&
    Object.keys(instance.customNames).every((code) => languages.has(code))
  );
}

/** Prepare an older plugin mirror for editing after project languages changed. */
export function normalizeSwitcherConfigLanguages(config: SwitcherConfig, active: readonly string[]): SwitcherConfig {
  const available = new Set(active);
  const keepActive = (record: Record<string, string>) => Object.fromEntries(
    Object.entries(record).filter(([code]) => available.has(code)),
  );
  return {
    ...config,
    instances: config.instances.map((instance) => ({
      ...instance,
      languageOrder: [...instance.languageOrder.filter((code) => available.has(code)),
        ...active.filter((code) => !instance.languageOrder.includes(code))],
      customNames: keepActive(instance.customNames),
      customFlags: keepActive(instance.customFlags),
    })),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonicalize(child)]),
  );
  return value;
}

export function canonicalSwitcherConfig(config: SwitcherConfig): string {
  return JSON.stringify(canonicalize(config));
}

export function switcherConfigHash(config: SwitcherConfig): string {
  return createHash("sha256").update(canonicalSwitcherConfig(config)).digest("hex");
}

export function sameSwitcherConfig(a: unknown, b: unknown) {
  const parsedA = switcherConfigSchema.safeParse(a);
  const parsedB = switcherConfigSchema.safeParse(b);
  return parsedA.success && parsedB.success && canonicalSwitcherConfig(parsedA.data) === canonicalSwitcherConfig(parsedB.data);
}
