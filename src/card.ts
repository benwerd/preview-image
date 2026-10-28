import { layoutToSvg, svgToPng, type SatoriElement } from "./render";

export type CardInput = { title: string; subtitle?: string; label?: string }; // already cleaned
export type Fit = { titleSize: number; subtitleSize: number; titleLines: number; titleClamp: number };

export const LAYOUT = {
  W: 1200, H: 630, MASTHEAD_H: 110, PAD_X: 90, BODY_PAD_TOP: 64, BODY_PAD_BOTTOM: 56, AVAIL_H: 400, GAP: 28,
  TITLE_LH: 1.12, SUB_LH: 1.45, TITLE_SIZES: [64, 60, 56, 52, 48, 44], TITLE_BIG: 76, SUB_DEFAULT: 30, SUB_MIN: 24, SUB_LINES: 2,
} as const;

const div = (style: Record<string, unknown>, children: unknown, key?: string): SatoriElement => ({
  type: "div", ...(key ? { key } : {}), props: { style: { display: "flex", ...style }, children },
});

export function cardElement(input: CardInput, fit: Fit, clamp: boolean): SatoriElement {
  const masthead = div(
    { flexDirection: "row", height: LAYOUT.MASTHEAD_H, backgroundColor: "#286c93", padding: `0 ${LAYOUT.PAD_X}px`, alignItems: "center", justifyContent: "space-between" },
    [
      div({ fontFamily: "Inter", fontWeight: 700, fontSize: 34, color: "#ffffff" }, "Ben Werdmuller"),
      ...(input.label ? [div({ fontFamily: "Merriweather", fontWeight: 400, fontSize: 24, color: "rgba(255,255,255,0.85)" }, input.label)] : []),
    ],
  );
  const title = div(
    { fontFamily: "Inter", fontWeight: 800, fontSize: fit.titleSize, lineHeight: LAYOUT.TITLE_LH, letterSpacing: "-0.02em", color: "#15171a", wordBreak: "break-word", ...(clamp ? { display: "block", lineClamp: fit.titleClamp } : {}) },
    input.title, "title",
  );
  const subtitle = input.subtitle
    ? [div({ fontFamily: "Merriweather", fontWeight: 400, fontSize: fit.subtitleSize, lineHeight: LAYOUT.SUB_LH, color: "#4a4f57", marginTop: LAYOUT.GAP, ...(clamp ? { display: "block", lineClamp: LAYOUT.SUB_LINES } : {}) }, input.subtitle, "subtitle")]
    : [];
  const body = div(
    { flexDirection: "column", flexGrow: 1, padding: `${LAYOUT.BODY_PAD_TOP}px ${LAYOUT.PAD_X}px ${LAYOUT.BODY_PAD_BOTTOM}px`, justifyContent: "center" },
    [title, ...subtitle],
  );
  return div({ flexDirection: "column", width: LAYOUT.W, height: LAYOUT.H, backgroundColor: "#ffffff" }, [masthead, body]);
}

/** Picks the largest title size whose measured layout fits the body; falls back to 44 with a line clamp. */
export async function fitCard(input: CardInput): Promise<Fit> {
  const hasSub = !!input.subtitle;
  const subtitleFor = (titleSize: number) =>
    Math.min(LAYOUT.SUB_DEFAULT, Math.max(LAYOUT.SUB_MIN, Math.round((titleSize * 30) / 64)));

  for (const titleSize of [LAYOUT.TITLE_BIG, ...LAYOUT.TITLE_SIZES]) {
    const subtitleSize = subtitleFor(titleSize);
    const h: Record<string, number> = {};
    const probe: Fit = { titleSize, subtitleSize, titleLines: 0, titleClamp: 0 };
    await layoutToSvg(cardElement(input, probe, false), (n) => {
      if (n.key === "title" || n.key === "subtitle") h[n.key] = n.height;
    });
    const titleHeight = h.title ?? 0;
    const titleLines = Math.round(titleHeight / (titleSize * LAYOUT.TITLE_LH));
    const subHeight = hasSub ? LAYOUT.GAP + Math.min(h.subtitle ?? 0, LAYOUT.SUB_LINES * subtitleSize * LAYOUT.SUB_LH) : 0;
    const fits = titleSize === LAYOUT.TITLE_BIG ? titleLines <= (hasSub ? 2 : 3) : titleHeight + subHeight <= LAYOUT.AVAIL_H;
    if (fits) return { titleSize, subtitleSize, titleLines, titleClamp: titleLines };
  }

  const titleSize = 44;
  const subtitleSize = subtitleFor(titleSize);
  const subReserve = hasSub ? LAYOUT.GAP + LAYOUT.SUB_LINES * subtitleSize * LAYOUT.SUB_LH : 0;
  const titleClamp = Math.floor((LAYOUT.AVAIL_H - subReserve) / (titleSize * LAYOUT.TITLE_LH));
  return { titleSize, subtitleSize, titleLines: titleClamp, titleClamp };
}

export async function renderCard(input: CardInput): Promise<Uint8Array> {
  const fit = await fitCard(input);
  return svgToPng(await layoutToSvg(cardElement(input, fit, true)));
}
