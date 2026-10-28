import satori, { init as initSatori } from "satori/wasm";
import initYoga from "yoga-wasm-web";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import yogaWasm from "yoga-wasm-web/dist/yoga.wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import inter700 from "./fonts/inter-latin-700-normal.woff";
import inter800 from "./fonts/inter-latin-800-normal.woff";
import merriweather400 from "./fonts/merriweather-latin-400-normal.woff";

export type SatoriElement = { type: string; key?: string; props: Record<string, unknown> }; // key is on the element, as in React, not in props

export const FONTS: { name: string; weight: 400 | 700 | 800; data: ArrayBuffer }[] = [
  { name: "Inter", weight: 700, data: inter700 },
  { name: "Inter", weight: 800, data: inter800 },
  { name: "Merriweather", weight: 400, data: merriweather400 },
];

let enginesReady: Promise<void> | undefined;

/** Instantiates the satori layout engine (yoga) and resvg once; later calls reuse the same promise. */
export function ensureEngines(): Promise<void> {
  enginesReady ??= Promise.all([initYoga(yogaWasm).then(initSatori), initWasm(resvgWasm)]).then(() => undefined);
  return enginesReady;
}

export async function layoutToSvg(
  el: SatoriElement,
  onNode?: (n: { key?: string | number; height: number; width: number }) => void,
): Promise<string> {
  await ensureEngines();
  return satori(el as unknown as Parameters<typeof satori>[0], {
    width: 1200,
    height: 630,
    fonts: FONTS.map((f) => ({ ...f, style: "normal" as const })),
    onNodeDetected: onNode,
  });
}

export async function svgToPng(svg: string): Promise<Uint8Array> {
  await ensureEngines();
  const r = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  const img = r.render();
  try {
    return img.asPng();
  } finally {
    img.free();
    r.free();
  }
}
