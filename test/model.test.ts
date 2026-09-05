import { describe, it, expect } from "vitest";
import { iconSpec, toDocument } from "@/model";
import { sanitizeSvg } from "@/svg";
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><circle cx="512" cy="512" r="300" fill="#fff"/></svg>';
export const fixture = {
  background: "#102030",
  darkBackground: "#050607",
  groups: [{ name: "Mark", layers: [{ name: "Disc", svg }] }],
};
describe("icon model", () => {
  it("creates native material and appearance settings", () => {
    const s = iconSpec.parse(fixture);
    const d = toDocument(s);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]?.layers[0]?.["image-name"]).toBe("g0-l0.svg");
    expect(d["fill-specializations"]).toHaveLength(2);
  });
  it("bounds geometry, groups and unknown fields", () => {
    expect(() => iconSpec.parse({ ...fixture, extra: true })).toThrow();
    expect(() =>
      iconSpec.parse({ ...fixture, groups: Array(5).fill(fixture.groups[0]) }),
    ).toThrow();
    expect(() =>
      iconSpec.parse({ ...fixture, background: "url(https://bad)" }),
    ).toThrow();
  });
});
describe("SVG boundary", () => {
  it("keeps independent vector geometry and gradients", () =>
    expect(sanitizeSvg(svg)).toBe(svg));
  it.each([
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///secret">]><svg/>',
    "<svg><script>alert(1)</script></svg>",
    '<svg><image href="https://example.org/x"/></svg>',
    '<svg onload="x"/>',
    "<svg><style>*{fill:url(https://x)}</style></svg>",
    '<svg><path fill="url(file:///x)"/></svg>',
    "<svg><foreignObject/></svg>",
    "<svg><g></svg>",
    '<svg><use href="&#104;ttps://x"/></svg>',
    '<svg xmlns:x="evil"><x:path/></svg>',
    '<svg><path style="fill:red"/></svg>',
  ])("rejects unsafe XML %s", (x) => expect(() => sanitizeSvg(x)).toThrow());
  it("rejects oversize and too complex input", () => {
    expect(() => sanitizeSvg(" ".repeat(262145))).toThrow();
    expect(() =>
      sanitizeSvg("<svg>" + "<g>".repeat(34) + "</g>".repeat(34) + "</svg>"),
    ).toThrow();
  });
});

it("supports material controls, gradients, placement and alternate PNG artwork", async () => {
  const { PNG } = await import("pngjs");
  const { assetsFor } = await import("@/model");
  const png = new PNG({ width: 1, height: 1 });
  png.data.fill(255);
  const data = PNG.sync.write(png).toString("base64");
  const spec = iconSpec.parse({
    background: { top: "#334455", bottom: "#112233" },
    darkBackground: "#000000",
    platform: "macOS",
    groups: [
      {
        name: "Glass",
        blur: 0.2,
        translucency: 0.1,
        specular: true,
        shadow: "chromatic",
        shadowOpacity: 0.3,
        lighting: "individual",
        layers: [
          {
            name: "Tile",
            pngBase64: data,
            darkPngBase64: data,
            scale: 0.8,
            x: 10,
            y: -10,
            opacity: 0.5,
            glass: true,
          },
        ],
      },
    ],
  });
  const doc = toDocument(spec);
  expect(doc.groups[0]?.shadow.kind).toBe("layer-color");
  expect(doc.groups[0]?.layers[0]?.["image-name"]).toBe("g0-l0-dark.png");
  expect(doc.groups[0]?.layers[1]?.["opacity-specializations"]).toEqual([
    { value: 0.5 },
    { appearance: "dark", value: 0 },
  ]);
  expect(Object.values(assetsFor(spec)).every(Buffer.isBuffer)).toBe(true);
});
it("rejects invalid and ambiguous PNG layers", () => {
  for (const artwork of [
    { pngBase64: "AAAA" },
    { svg: "<svg/>", pngBase64: "AAAA" },
    {},
  ])
    expect(() =>
      iconSpec.parse({
        background: "#000000",
        groups: [{ name: "Test", layers: [{ name: "Test", ...artwork }] }],
      }),
    ).toThrow();
});
it("enforces total document byte and asset limits", () => {
  const layer = {
    name: "Asset",
    svg: "<svg><desc>" + "x".repeat(250000) + "</desc></svg>",
    darkSvg: "<svg/>",
  };
  expect(() =>
    iconSpec.parse({
      background: "#000000",
      groups: [{ name: "Test", layers: Array(9).fill(layer) }],
    }),
  ).toThrow();
  expect(() =>
    iconSpec.parse({
      background: "#000000",
      groups: [
        {
          name: "A",
          layers: Array(32).fill({
            name: "A",
            svg: "<svg/>",
            darkSvg: "<svg/>",
          }),
        },
        { name: "B", layers: [{ name: "B", svg: "<svg/>" }] },
      ],
    }),
  ).toThrow();
});
