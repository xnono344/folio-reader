import test from 'node:test';
import assert from 'node:assert/strict';
import { linesToBlocks, ocrToParagraphs } from '../src/text.ts';

test('keeps page references and separates headings from prose', () => {
  const blocks = linesToBlocks([
    { text: 'Chapter One', y: 700, size: 24 },
    { text: 'A sentence in the first paragraph.', y: 660, size: 12 },
    { text: 'Another sentence follows.', y: 644, size: 12 },
    { text: 'A new paragraph starts.', y: 605, size: 12 },
  ], 3);
  assert.deepEqual(blocks, [
    { text: 'Chapter One', page: 3, kind: 'heading' },
    { text: 'A sentence in the first paragraph. Another sentence follows.', page: 3, kind: 'paragraph' },
    { text: 'A new paragraph starts.', page: 3, kind: 'paragraph' },
  ]);
});

test('joins a word split across two lines', () => {
  assert.equal(linesToBlocks([{ text: 'read-', y: 20, size: 12 }, { text: 'able book', y: 5, size: 12 }], 1)[0].text, 'readable book');
});

test('turns scanned page OCR into readable paragraphs', () => {
  assert.deepEqual(ocrToParagraphs('A read-\nable sentence.\nAnother line.\n\nA new paragraph.'), [
    'A readable sentence. Another line.',
    'A new paragraph.',
  ]);
});
