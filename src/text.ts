export type Line = { text: string; y: number; size: number };
export type Block = {
  text: string;
  page: number;
  kind: "paragraph" | "heading";
};

export function ocrToParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) =>
      part
        .replace(/-\s*\n(?=\p{Ll})/gu, "")
        .replace(/\s*\n\s*/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

export function linesToBlocks(lines: Line[], page: number): Block[] {
  if (!lines.length) return [];
  const sizes = lines.map((line) => line.size).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor((sizes.length - 1) / 2)] || 12;
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let previous: Line | undefined;
  const flush = () => {
    if (paragraph.length)
      blocks.push({
        text: paragraph
          .join(" ")
          .replace(/-\s+(?=\p{Ll})/gu, "")
          .replace(/\s+/g, " ")
          .trim(),
        page,
        kind: "paragraph",
      });
    paragraph = [];
  };
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const heading = line.size > bodySize * 1.22 && text.length < 110;
    const gap = previous ? previous.y - line.y : 0;
    if (heading || (previous && gap > bodySize * 1.65)) flush();
    if (heading) blocks.push({ text, page, kind: "heading" });
    else paragraph.push(text);
    previous = line;
  }
  flush();
  return blocks.filter((block) => block.text);
}
