// Sanitising for Ghost titles and excerpts before they are rendered with the
// bundled fonts, which only cover Latin-1 plus typographic punctuation.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

// Code point ranges covered by the bundled fonts. Do not widen without
// checking the font files.
const SUPPORTED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x00ff],
  [0x0152, 0x0153],
  [0x2010, 0x2027],
  [0x2030, 0x203a],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
];

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function isSupportedCodePoint(cp: number): boolean {
  return SUPPORTED_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function decodeEntities(input: string): string {
  return input.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isNaN(codePoint) || codePoint > 0x10ffff) return match;
      return String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

export function stripUnsupported(input: string): { text: string; stripped: string[] } {
  const stripped: string[] = [];
  let kept = "";
  for (const { segment } of graphemes.segment(input)) {
    const supported = [...segment].every((ch) => isSupportedCodePoint(ch.codePointAt(0)!));
    if (supported) {
      kept += segment;
    } else {
      stripped.push(segment);
    }
  }
  if (stripped.length === 0) {
    return { text: input, stripped };
  }
  return { text: kept.replace(/ {2,}/g, " ").trim(), stripped };
}

export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  const withoutTags = input.replace(/<[^>]*>/g, "");
  const decoded = decodeEntities(withoutTags);
  // Collapse whitespace before stripping so newlines become spaces rather than
  // being removed and joining adjacent words.
  const spaced = decoded.replace(/\s+/g, " ");
  return stripUnsupported(spaced).text.trim();
}
