import { z } from "zod";
import { sanitizeSvg } from "./svg.js";
import { validatePng } from "./png.js";

export const iconName = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const label = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const unit = z.number().min(0).max(1);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const fill = z.union([color, z.strictObject({ top: color, bottom: color })]);
const svg = z
  .string()
  .min(1)
  .max(262144)
  .superRefine((value, context) => {
    try {
      sanitizeSvg(value);
    } catch {
      context.addIssue({
        code: "custom",
        message:
          "Use static SVG geometry with local gradients; external content and active elements are not supported.",
      });
    }
  });
const png = z
  .string()
  .min(4)
  .max(1398104)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .transform((value, ctx) => {
    try {
      const clean = validatePng(Buffer.from(value, "base64"));
      if (clean.length > 1048576) throw new Error("size");
      return clean.toString("base64");
    } catch {
      ctx.addIssue({
        code: "custom",
        message:
          "Use a valid static PNG, at most 1 MiB and 1024 pixels per side.",
      });
      return z.NEVER;
    }
  });
export const layerSpec = z
  .strictObject({
    name: label,
    svg: svg.optional(),
    pngBase64: png.optional(),
    darkSvg: svg.optional(),
    darkPngBase64: png.optional(),
    glass: z.boolean().default(false),
    opacity: unit.default(1),
    scale: z.number().min(0.01).max(4).default(1),
    x: z.number().min(-1024).max(1024).default(0),
    y: z.number().min(-1024).max(1024).default(0),
  })
  .superRefine((layer, ctx) => {
    if (
      Number(!!layer.svg) + Number(!!layer.pngBase64) !== 1 ||
      Number(!!layer.darkSvg) + Number(!!layer.darkPngBase64) > 1
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Supply exactly one of svg or pngBase64, and at most one dark artwork source.",
      });
  });
export const groupSpec = z.strictObject({
  name: label,
  layers: z.array(layerSpec).min(1).max(32),
  specular: z.boolean().default(false),
  blur: unit.default(0),
  translucency: unit.default(0),
  shadow: z.enum(["none", "neutral", "chromatic"]).default("none"),
  shadowOpacity: unit.default(0),
  lighting: z.enum(["combined", "individual"]).default("combined"),
});
export const iconSpec = z
  .strictObject({
    background: fill,
    darkBackground: fill.optional(),
    platform: z.enum(["iOS", "macOS"]).default("iOS"),
    groups: z.array(groupSpec).min(1).max(4),
  })
  .superRefine((spec, ctx) => {
    if (Buffer.byteLength(JSON.stringify(spec)) + 1 > 2 * 1024 * 1024)
      ctx.addIssue({
        code: "custom",
        message: "The icon must fit within 2 MiB.",
      });
    if (
      spec.groups.reduce(
        (sum, g) =>
          sum +
          g.layers.reduce(
            (n, l) => n + (l.darkSvg || l.darkPngBase64 ? 2 : 1),
            0,
          ),
        0,
      ) > 64
    )
      ctx.addIssue({
        code: "custom",
        message: "Use at most 64 artwork assets.",
      });
  });
export type IconSpec = z.infer<typeof iconSpec>;
const nativeColor = (hex: string) =>
  "display-p3:" +
  [1, 3, 5]
    .map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5))
    .join(",") +
  ",1.00000";
function nativeFill(value: z.infer<typeof fill>) {
  return typeof value === "string"
    ? { solid: nativeColor(value) }
    : {
        "linear-gradient": [nativeColor(value.top), nativeColor(value.bottom)],
        orientation: { start: { x: 0, y: 0 }, stop: { x: 0, y: 1 } },
      };
}
function nativeLayer(
  layer: IconSpec["groups"][number]["layers"][number],
  g: number,
  l: number,
  dark = false,
) {
  return {
    name: layer.name + (dark ? " Dark" : ""),
    "image-name": assetName(layer, g, l, dark),
    glass: layer.glass,
    position: {
      scale: layer.scale,
      "translation-in-points": [layer.x, layer.y],
    },
    "opacity-specializations": [
      { value: dark ? 0 : layer.opacity },
      ...(layer.darkSvg || layer.darkPngBase64
        ? [{ appearance: "dark", value: dark ? layer.opacity : 0 }]
        : []),
    ],
  };
}
export function toDocument(spec: IconSpec) {
  return {
    "color-space-for-untagged-svg-colors": "display-p3",
    "fill-specializations": [
      { value: nativeFill(spec.background) },
      ...(spec.darkBackground
        ? [{ appearance: "dark", value: nativeFill(spec.darkBackground) }]
        : []),
    ],
    groups: spec.groups.map((g, gi) => ({
      name: g.name,
      layers: g.layers.flatMap((l, li) =>
        l.darkSvg || l.darkPngBase64
          ? [nativeLayer(l, gi, li, true), nativeLayer(l, gi, li)]
          : [nativeLayer(l, gi, li)],
      ),
      "blur-material": g.blur || null,
      lighting: g.lighting,
      shadow: {
        kind: g.shadow === "chromatic" ? "layer-color" : g.shadow,
        opacity: g.shadowOpacity,
      },
      specular: g.specular,
      translucency: { enabled: g.translucency > 0, value: g.translucency },
    })),
    "supported-platforms": { squares: [spec.platform] },
  };
}
function assetName(
  layer: IconSpec["groups"][number]["layers"][number],
  g: number,
  l: number,
  dark = false,
) {
  const isPng = dark ? !!layer.darkPngBase64 : !!layer.pngBase64;
  return `g${g}-l${l}${dark ? "-dark" : ""}.${isPng ? "png" : "svg"}`;
}
export function assetsFor(spec: IconSpec): Record<string, string | Buffer> {
  const entries: [string, string | Buffer][] = [];
  for (const [gi, group] of spec.groups.entries())
    for (const [li, layer] of group.layers.entries()) {
      entries.push([
        assetName(layer, gi, li),
        layer.svg ?? Buffer.from(layer.pngBase64!, "base64"),
      ]);
      if (layer.darkSvg || layer.darkPngBase64)
        entries.push([
          assetName(layer, gi, li, true),
          layer.darkSvg ?? Buffer.from(layer.darkPngBase64!, "base64"),
        ]);
    }
  return Object.fromEntries(entries);
}
