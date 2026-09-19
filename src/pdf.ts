import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { linesToBlocks, type Block, type Line } from "./text";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export async function openPdf(
  data: Uint8Array,
): Promise<{
  pdf: PDFDocumentProxy;
  blocks: Block[];
  textPages: number[];
}> {
  const pdf = await pdfjs.getDocument({ data }).promise;
  const blocks: Block[] = [];
  const textPages: number[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const fragments = content.items.filter(
      (
        item,
      ): item is typeof item & {
        str: string;
        transform: number[];
        height: number;
        width: number;
      } => "str" in item && !!item.str.trim(),
    );
    const rows: {
      y: number;
      size: number;
      parts: { x: number; text: string; width: number }[];
    }[] = [];
    for (const item of fragments) {
      const y = item.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2);
      if (!row) {
        row = { y, size: item.height || 12, parts: [] };
        rows.push(row);
      }
      row.size = Math.max(row.size, item.height || 12);
      row.parts.push({
        x: item.transform[4],
        text: item.str,
        width: item.width,
      });
    }
    const lines: Line[] = rows
      .sort((a, b) => b.y - a.y)
      .map((row) => {
        const parts = row.parts.sort((a, b) => a.x - b.x);
        let text = "";
        let end = -Infinity;
        for (const part of parts) {
          if (
            text &&
            part.x - end > row.size * 0.15 &&
            !text.endsWith(" ") &&
            !part.text.startsWith(" ")
          )
            text += " ";
          text += part.text;
          end = Math.max(end, part.x + part.width);
        }
        return { text, y: row.y, size: row.size };
      });
    const pageBlocks = linesToBlocks(lines, pageNumber);
    // A cover, running header, or page number can produce a tiny amount of
    // text in an otherwise scanned book. Count a page as readable only when
    // it has enough extracted text to represent real body content.
    const pageTextLength = pageBlocks.reduce(
      (total, block) => total + block.text.length,
      0,
    );
    if (pageTextLength >= 40) textPages.push(pageNumber);
    blocks.push(...pageBlocks);
    // Scanned books contain page images rather than PDF text. Avoid making the
    // reader inspect hundreds of empty text layers before local OCR takes over.
    if (pageNumber === Math.min(8, pdf.numPages) && !textPages.length) break;
  }
  return { pdf, blocks, textPages };
}
