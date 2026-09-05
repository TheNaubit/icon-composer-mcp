import { SaxesParser } from "saxes";

const tags = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "title",
  "desc",
]);
const attrs = new Set([
  "xmlns",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "opacity",
  "transform",
  "id",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "clip-path",
  "clip-rule",
  "mask",
  "maskUnits",
  "maskContentUnits",
  "preserveAspectRatio",
]);
const reference = /^url\(#[A-Za-z][\w-]*\)$/;

/** Accept a deliberately small, static SVG language; never repair unsafe input. */
export function sanitizeSvg(source: string): string {
  if (
    Buffer.byteLength(source) > 262144 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(source)
  )
    throw new Error("SVG exceeds the input limits.");
  let depth = 0;
  let count = 0;
  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", () => {
    throw new Error("SVG must be well-formed XML.");
  });
  parser.on("doctype", () => {
    throw new Error("SVG declarations are not supported.");
  });
  parser.on("processinginstruction", () => {
    throw new Error("SVG processing instructions are not supported.");
  });
  parser.on("opentag", (tag) => {
    depth++;
    count++;
    if (
      depth > 32 ||
      count > 4096 ||
      !tags.has(tag.name) ||
      (depth === 1 && tag.name !== "svg")
    )
      throw new Error("Unsupported SVG element or complexity.");
    for (const [key, value] of Object.entries(tag.attributes)) {
      const val = String(value);
      if (
        !attrs.has(key) ||
        val.length > 65536 ||
        /[\\\u0000-\u001f]/.test(val)
      )
        throw new Error("Unsupported SVG attribute.");
      if (key === "xmlns") {
        if (val !== "http://www.w3.org/2000/svg")
          throw new Error("Unsupported SVG namespace.");
        continue;
      }
      if (/url\s*\(/i.test(val) && !reference.test(val))
        throw new Error("Only local SVG fragment references are supported.");
      if (/(?:https?:|file:|data:|javascript:|\/\/|@import)/i.test(val))
        throw new Error("External SVG references are not supported.");
    }
  });
  parser.on("closetag", () => {
    depth--;
  });
  parser.write(source).close();
  if (count === 0) throw new Error("SVG must contain an svg element.");
  return source;
}
