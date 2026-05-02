/**
 * Extract text from .pptx (OOXML): slide body + speaker notes.
 * PPTX is a zip of XML; we read slideN.xml and notesSlideN.xml and collect <a:t> / <w:t> runs.
 */
import JSZip from "jszip";

function collectXmlTextNodes(xml: string): string {
  const parts: string[] = [];
  // DrawingML and WordprocessingML text runs
  const re = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) parts.push(m[1]);
  }
  const reW = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  while ((m = reW.exec(xml)) !== null) {
    if (m[1]) parts.push(m[1]);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export type ExtractPptxOptions = {
  /** Include speaker notes (BTEC / student work often there). Default true. */
  includeSpeakerNotes?: boolean;
};

export async function extractPptxText(
  buffer: Buffer,
  options: ExtractPptxOptions = {},
): Promise<string> {
  const includeNotes = options.includeSpeakerNotes !== false;
  const zip = await JSZip.loadAsync(buffer);
  const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
  const noteRe = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;

  const slides: { n: number; text: string }[] = [];
  const noteBlocks: { n: number; text: string }[] = [];

  for (const path of Object.keys(zip.files)) {
    if (zip.files[path].dir) continue;
    let match = path.match(slideRe);
    if (match) {
      const xml = await zip.files[path].async("string");
      const text = collectXmlTextNodes(xml);
      slides.push({ n: parseInt(match[1], 10), text });
      continue;
    }
    if (includeNotes) {
      match = path.match(noteRe);
      if (match) {
        const xml = await zip.files[path].async("string");
        const text = collectXmlTextNodes(xml);
        noteBlocks.push({ n: parseInt(match[1], 10), text });
      }
    }
  }

  slides.sort((a, b) => a.n - b.n);
  noteBlocks.sort((a, b) => a.n - b.n);

  const out: string[] = [];
  for (const s of slides) {
    out.push(`--- Slide ${s.n} ---`);
    if (s.text) out.push(s.text);
    if (includeNotes) {
      const note = noteBlocks.find((x) => x.n === s.n);
      if (note?.text) {
        out.push("[Speaker notes]");
        out.push(note.text);
      }
    }
    out.push("");
  }

  return out.join("\n").replace(/\0/g, " ").trim();
}
