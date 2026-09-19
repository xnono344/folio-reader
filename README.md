# Folio

A local-first desktop PDF reader built with Tauri, React, and PDF.js. Imported PDFs are copied unchanged to the app's `Library` folder inside its application data directory. Reading preferences, progress, bookmarks, and OCR results stay on the device.

Folio provides a responsive text view with paper color, text color, font, size, line height, and reading width controls. The original PDF page view remains available. Scanned books are recognized one page at a time with local OCR and cached after their first opening.

## Run

Install [Tauri's system prerequisites](https://v2.tauri.app/start/prerequisites/). Scanned PDF support also requires `pdftoppm` from Poppler and English data for Tesseract OCR. Then run:

```sh
npm install
npm run tauri dev
```

Build a desktop package with `npm run tauri build`. Run frontend checks with `npm run build` and `npm test`.

Text layout and heading detection are heuristic because PDFs do not contain a dependable ebook structure. OCR quality depends on scan quality and the installed Tesseract language data.
