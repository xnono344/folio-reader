<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" alt="Folio app icon" />

# Folio

### Your PDFs, made comfortable to read.

A private, local-first desktop reader with reflow, themes, bookmarks, and on-device OCR.

![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111827)
![Rust](https://img.shields.io/badge/Rust-desktop-000000?style=flat-square&logo=rust&logoColor=white)
![Local first](https://img.shields.io/badge/privacy-local--first-22C55E?style=flat-square)

</div>

## Why Folio

Most PDF viewers are designed for documents, not long-form reading. Folio keeps the original page available while offering a calmer, responsive text view that adapts to your eyes and screen.

## Highlights

- Import PDFs into a private on-device library
- Reflow selectable text into a responsive reading layout
- Switch back to the original PDF page whenever fidelity matters
- Light, Paper, Dark, and OLED reading themes
- Adjust font, size, line height, colors, and reading width
- Search across your local library and within extracted text
- Save progress and bookmarks automatically
- Detect headings for a lightweight table of contents
- Recognize scanned pages with local Tesseract OCR
- Cache OCR results locally after the first pass

## Privacy by design

Imported files are copied unchanged into Folio's application-data `Library` directory. PDFs, reading preferences, progress, bookmarks, and OCR results stay on the device—there is no account or cloud service.

## Run locally

Install [Tauri's system prerequisites](https://v2.tauri.app/start/prerequisites/). Scanned PDF support also requires `pdftoppm` from Poppler and English data for Tesseract OCR. Then run:

```sh
npm install
npm run tauri dev
```

## Build and verify

```sh
npm run check
npm test
npm run build
npm run tauri build
```

## Stack

- Tauri 2 and Rust
- React 19 and TypeScript
- PDF.js for extraction and original-page rendering
- Tesseract OCR and Poppler for scanned documents
- Vite and Lucide icons

## Reading notes

Text layout and heading detection are heuristic because PDFs do not contain a dependable ebook structure. OCR quality depends on scan quality and the installed Tesseract language data.
