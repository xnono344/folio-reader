import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  LibraryBig,
  List,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf } from "./pdf";
import { ocrToParagraphs, type Block } from "./text";

type BookFile = { name: string; size: number; modified: number };
type Progress = {
  block: number;
  page: number;
  updated: number;
  mode?: "read" | "pdf";
};
type Saved = Record<string, Progress>;
type ReaderSettings = {
  preset: string;
  background: string;
  text: string;
  font: string;
  size: number;
  lineHeight: number;
  width: number;
};
const presets: Record<string, Pick<ReaderSettings, "background" | "text">> = {
  Light: { background: "#ffffff", text: "#22252b" },
  Paper: { background: "#f4f0e6", text: "#343126" },
  Dark: { background: "#171918", text: "#f5f5f2" },
  OLED: { background: "#080909", text: "#efefec" },
};
const defaults: ReaderSettings = {
  preset: "Dark",
  ...presets.Dark,
  font: "Georgia",
  size: 19,
  lineHeight: 1.75,
  width: 680,
};
const getStored = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
};
const titleOf = (name: string) =>
  name
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const palette = [
  "#344e61",
  "#8b695a",
  "#4c6459",
  "#777187",
  "#9a784d",
  "#62627a",
];
const coverColor = (name: string) =>
  palette[
    [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) %
      palette.length
  ];

function OriginalPdf({
  book,
  pdf,
  page,
  setPage,
}: {
  book: BookFile;
  pdf: PDFDocumentProxy;
  page: number;
  setPage: (page: number) => void;
}) {
  const [image, setImage] = useState("");
  const [renderError, setRenderError] = useState("");
  useEffect(() => {
    let active = true;
    let url = "";
    setImage("");
    setRenderError("");
    invoke<ArrayBuffer>("render_page", { name: book.name, page })
      .then((bytes) => {
        const next = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        if (!active) return URL.revokeObjectURL(next);
        url = next;
        setImage(next);
      })
      .catch((cause) => { if (active) setRenderError(String(cause)); });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [book.name, page]);
  return (
    <div className="pdf-view">
      <div className="pdf-stage">
        {image ? <img src={image} alt={`Original PDF page ${page}`} /> :
          <p>{renderError || `Loading page ${page}…`}</p>}
      </div>
      <div className="pdf-nav">
        <button
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          Page {page} of {pdf.numPages}
        </span>
        <button
          aria-label="Next page"
          disabled={page >= pdf.numPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

function Reader({
  book,
  pdf,
  blocks,
  textPages,
  title,
  settings,
  setSettings,
  onClose,
}: {
  book: BookFile;
  pdf: PDFDocumentProxy;
  blocks: Block[];
  textPages: number[];
  title: string;
  settings: ReaderSettings;
  setSettings: (settings: ReaderSettings) => void;
  onClose: () => void;
}) {
  const saved = getStored<Saved>("folio:progress", {})[book.name];
  const needsOcr = textPages.length < Math.max(1, Math.ceil(pdf.numPages * 0.5));
  const [mode, setMode] = useState<"read" | "pdf">("read");
  const [panel, setPanel] = useState<
    "contents" | "settings" | "bookmarks" | null
  >(null);
  const [progress, setProgress] = useState<Progress>(
    () => saved || { block: 0, page: 1, updated: Date.now(), mode: "read" },
  );
  const [bookmarks, setBookmarks] = useState<number[]>(
    () =>
      getStored<Record<string, number[]>>("folio:bookmarks", {})[book.name] ||
      [],
  );
  const [pdfPage, setPdfPage] = useState(progress.page);
  const [ocrPage, setOcrPage] = useState(
    Math.min(pdf.numPages, Math.max(1, progress.page)),
  );
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const headings = blocks
    .map((block, index) => ({ ...block, index }))
    .filter((block) => block.kind === "heading");
  const current = Math.min(progress.block, Math.max(0, blocks.length - 1));
  const bookmarkSpot = needsOcr ? -ocrPage : current;
  const percent = needsOcr
    ? Math.round(((mode === "read" ? ocrPage : pdfPage) / pdf.numPages) * 100)
    : blocks.length
    ? Math.round(((current + 1) / blocks.length) * 100)
    : Math.round((pdfPage / pdf.numPages) * 100);
  const ocrBlocks = ocrToParagraphs(ocrText || "");
  const jump = (index: number) => {
    if (needsOcr) {
      setOcrPage(index < 0 ? -index : 1);
      setMode("read");
      setPanel(null);
      return;
    }
    setMode("read");
    setPanel(null);
    requestAnimationFrame(() =>
      document
        .getElementById(`block-${index}`)
        ?.scrollIntoView({ block: "start" }),
    );
  };
  const switchToReflow = () => {
    if (needsOcr) {
      setOcrPage(pdfPage);
      setMode("read");
      return;
    }
    const index = blocks.findIndex((block) => block.page >= pdfPage);
    jump(index < 0 ? 0 : index);
  };
  useEffect(() => {
    if (!needsOcr || mode !== "read") return;
    let active = true;
    setOcrText(null);
    setOcrError("");
    scroller.current?.scrollTo(0, 0);
    invoke<string>("ocr_page", { name: book.name, page: ocrPage })
      .then((text) => {
        if (active) setOcrText(text);
      })
      .catch((cause) => {
        if (active) {
          setOcrError(String(cause));
          setOcrText("");
        }
      });
    return () => { active = false; };
  }, [book.name, mode, needsOcr, ocrPage]);
  useEffect(() => {
    if (!needsOcr || mode !== "read") return;
    const next: Progress = { block: 0, page: ocrPage, updated: Date.now(), mode: "read" };
    setProgress(next);
    const all = getStored<Saved>("folio:progress", {});
    all[book.name] = next;
    localStorage.setItem("folio:progress", JSON.stringify(all));
  }, [book.name, mode, needsOcr, ocrPage]);
  useEffect(() => {
    if (mode === "read" && !needsOcr) {
      const id = window.setTimeout(
        () =>
          document
            .getElementById(`block-${progress.block}`)
            ?.scrollIntoView({ block: "start" }),
        80,
      );
      return () => clearTimeout(id);
    }
  }, []);
  useEffect(() => {
    if (mode === "pdf") {
      const next: Progress = {
        block: progress.block,
        page: pdfPage,
        updated: Date.now(),
        mode: "pdf",
      };
      const all = getStored<Saved>("folio:progress", {});
      all[book.name] = next;
      localStorage.setItem("folio:progress", JSON.stringify(all));
    }
  }, [pdfPage, mode]);
  const onScroll = () => {
    if (!scroller.current || mode !== "read" || needsOcr) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const top = scroller.current!.getBoundingClientRect().top + 100;
      const elements =
        scroller.current!.querySelectorAll<HTMLElement>("[data-block]");
      let index = 0;
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= top)
          index = Number(element.dataset.block);
        else break;
      }
      const next: Progress = {
        block: index,
        page: blocks[index]?.page || 1,
        updated: Date.now(),
        mode: "read",
      };
      setProgress(next);
      const all = getStored<Saved>("folio:progress", {});
      all[book.name] = next;
      localStorage.setItem("folio:progress", JSON.stringify(all));
    }, 180);
  };
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  const toggleBookmark = () => {
    const next = bookmarks.includes(bookmarkSpot)
      ? bookmarks.filter((value) => value !== bookmarkSpot)
      : [...bookmarks, bookmarkSpot].sort((a, b) => a - b);
    setBookmarks(next);
    const all = getStored<Record<string, number[]>>("folio:bookmarks", {});
    all[book.name] = next;
    localStorage.setItem("folio:bookmarks", JSON.stringify(all));
  };
  const applyPreset = (preset: string) => {
    setSettings({ ...settings, ...presets[preset], preset });
    if (mode === "pdf") switchToReflow();
  };
  const customize = (changes: Partial<ReaderSettings>) => {
    setSettings({ ...settings, ...changes, preset: "Custom" });
    if (mode === "pdf") switchToReflow();
  };
  return (
    <div
      className="reader"
      style={
        {
          "--reading-paper": settings.background,
          "--reading-ink": settings.text,
          "--reading-width": `${settings.width}px`,
          "--reading-size": `${settings.size}px`,
          "--reading-leading": settings.lineHeight,
          "--reading-font": settings.font,
        } as React.CSSProperties
      }
    >
      <header className="reader-header">
        <button
          className="icon-button back"
          onClick={onClose}
          aria-label="Back to library"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="reader-title">
          <strong>{title}</strong>
          <span>
            {mode === "read"
              ? `Page ${needsOcr ? ocrPage : blocks[current]?.page || 1} of ${pdf.numPages}`
              : `Original PDF · Page ${pdfPage} of ${pdf.numPages}`}
          </span>
        </div>
        <div className="reader-actions">
          <div className="view-switch">
            <button
              className={mode === "read" ? "active" : ""}
              title="Read text with your chosen colors and font"
              onClick={switchToReflow}
            >
              <BookOpen size={16} /> Reflow
            </button>
            <button
              className={mode === "pdf" ? "active" : ""}
              onClick={() => {
                setPdfPage(needsOcr ? ocrPage : blocks[current]?.page || pdfPage);
                setMode("pdf");
                setPanel(null);
              }}
            >
              <FileText size={16} /> Original PDF
            </button>
          </div>
          <button
            className={`icon-button ${bookmarks.includes(bookmarkSpot) && mode === "read" ? "marked" : ""}`}
            onClick={toggleBookmark}
            disabled={mode !== "read"}
            title="Bookmark this spot"
            aria-label="Bookmark this spot"
          >
            <Bookmark
              size={19}
              fill={
                bookmarks.includes(bookmarkSpot) && mode === "read"
                  ? "currentColor"
                  : "none"
              }
            />
          </button>
          <button
            className={`icon-button ${panel ? "selected" : ""}`}
            onClick={() => setPanel(panel === "settings" ? null : "settings")}
            aria-label="Reading settings"
          >
            <Settings2 size={19} />
          </button>
        </div>
      </header>
      <div className="reader-body">
        <aside className="reader-rail">
          <button
            className={panel === "contents" ? "selected" : ""}
            onClick={() => setPanel(panel === "contents" ? null : "contents")}
            title="Table of contents"
            aria-label="Table of contents"
          >
            <List size={20} />
          </button>
          <button
            className={panel === "bookmarks" ? "selected" : ""}
            onClick={() => setPanel(panel === "bookmarks" ? null : "bookmarks")}
            title="Bookmarks"
            aria-label="Bookmarks"
          >
            <Bookmark size={19} />
          </button>
          <span className="rail-page">
            {mode === "read" ? needsOcr ? ocrPage : blocks[current]?.page || 1 : pdfPage}
          </span>
        </aside>
        {mode === "read" ? (
          <div className={`reading-scroll ${needsOcr ? "ocr-scroll" : ""}`} ref={scroller} onScroll={onScroll}>
            <article className="reading-content">
              <div className="chapter-opening">
                <div className="chapter-rule" />
                <span>{title}</span>
              </div>
              {needsOcr ? (
                ocrText === null ? (
                  <p className="reading-status">Reading text from page {ocrPage}…</p>
                ) : ocrBlocks.length ? (
                  ocrBlocks.map((text, index) => (
                    <div className="reading-block" key={`${ocrPage}-${index}`}>
                      <p>{text}</p>
                    </div>
                  ))
                ) : (
                  <div className="reading-status">
                    <p>{ocrError || "No text was found on this page."}</p>
                    <button onClick={() => { setPdfPage(ocrPage); setMode("pdf"); }}>
                      View original page
                    </button>
                  </div>
                )
              ) : blocks.map((block, index) => (
                <div
                  id={`block-${index}`}
                  data-block={index}
                  key={index}
                  className={`reading-block ${block.kind}`}
                >
                  {block.kind === "heading" ? (
                    <h2>{block.text}</h2>
                  ) : (
                    <p>{block.text}</p>
                  )}
                  {index === 0 || block.page !== blocks[index - 1].page ? (
                    <small className="page-reference">p. {block.page}</small>
                  ) : null}
                </div>
              ))}
            </article>
            {needsOcr && (
              <div className="reflow-nav">
                <button disabled={ocrPage <= 1} onClick={() => setOcrPage(ocrPage - 1)}>
                  <ChevronLeft size={18} /> Previous
                </button>
                <span>Page {ocrPage} of {pdf.numPages}</span>
                <button disabled={ocrPage >= pdf.numPages} onClick={() => setOcrPage(ocrPage + 1)}>
                  Next <ChevronRight size={18} />
                </button>
              </div>
            )}
          </div>
        ) : (
          <OriginalPdf book={book} pdf={pdf} page={pdfPage} setPage={setPdfPage} />
        )}
        {panel && (
          <div className="side-panel">
            <div className="panel-head">
              <h3>
                {panel === "settings"
                  ? "Reading settings"
                  : panel === "contents"
                    ? "Contents"
                    : "Bookmarks"}
              </h3>
              <button
                className="icon-button"
                onClick={() => setPanel(null)}
                aria-label="Close panel"
              >
                <X size={18} />
              </button>
            </div>
            {panel === "settings" ? (
              <div className="panel-content">
                <span className="field-label">Appearance</span>
                <div className="presets">
                  {Object.entries(presets).map(([name, colors]) => (
                    <button
                      key={name}
                      className={`preset ${settings.preset === name ? "active" : ""}`}
                      onClick={() => applyPreset(name)}
                    >
                      <span
                        className="preset-swatch"
                        style={{
                          background: colors.background,
                          color: colors.text,
                        }}
                      >
                        Aa
                      </span>
                      <span>{name}</span>
                    </button>
                  ))}
                </div>
                <div className="setting-row">
                  <label htmlFor="background">Paper color</label>
                  <input
                    id="background"
                    type="color"
                    value={settings.background}
                    onChange={(event) =>
                      customize({ background: event.target.value })
                    }
                  />
                </div>
                <div className="setting-row">
                  <label htmlFor="text">Text color</label>
                  <input
                    id="text"
                    type="color"
                    value={settings.text}
                    onChange={(event) =>
                      customize({ text: event.target.value })
                    }
                  />
                </div>
                <div className="setting-divider" />
                <label className="field-label" htmlFor="font">
                  Typography
                </label>
                <select
                  id="font"
                  value={settings.font}
                  onChange={(event) => customize({ font: event.target.value })}
                >
                  <option value="Georgia">Georgia</option>
                  <option value="Palatino Linotype">Palatino</option>
                  <option value="Baskerville">Baskerville</option>
                  <option value="Arial">Arial</option>
                  <option value="Verdana">Verdana</option>
                </select>
                <Range
                  label="Font size"
                  value={settings.size}
                  min={14}
                  max={30}
                  display={`${settings.size}px`}
                  onChange={(size) => customize({ size })}
                />
                <Range
                  label="Line height"
                  value={settings.lineHeight}
                  min={1.3}
                  max={2.2}
                  step={0.05}
                  display={settings.lineHeight.toFixed(2)}
                  onChange={(lineHeight) => customize({ lineHeight })}
                />
                <Range
                  label="Reading width"
                  value={settings.width}
                  min={480}
                  max={900}
                  step={10}
                  display={`${settings.width}px`}
                  onChange={(width) => customize({ width })}
                />
                <button
                  className="reset-button"
                  onClick={() => {
                    setSettings(defaults);
                    if (mode === "pdf") switchToReflow();
                  }}
                >
                  Reset to defaults
                </button>
              </div>
            ) : panel === "contents" ? (
              <div className="panel-content">
                <p className="panel-hint">Headings detected in this PDF</p>
                {headings.length ? (
                  headings.map((item) => (
                    <button
                      key={item.index}
                      className="nav-row"
                      onClick={() => jump(item.index)}
                    >
                      <span>{item.text}</span>
                      <small>{item.page}</small>
                    </button>
                  ))
                ) : (
                  <p className="empty-panel">
                    No headings were detected in this book.
                  </p>
                )}
              </div>
            ) : (
              <div className="panel-content">
                <p className="panel-hint">Saved places in this book</p>
                {bookmarks.length ? (
                  bookmarks.map((index) => (
                    <button
                      key={index}
                      className="nav-row"
                      onClick={() => jump(index)}
                    >
                      <span>
                        {index < 0 ? `Page ${-index}` : blocks[index]?.text.slice(0, 64) || "Saved place"}
                        {index >= 0 && (blocks[index]?.text.length || 0) > 64 ? "…" : ""}
                      </span>
                      <small>p. {index < 0 ? -index : blocks[index]?.page || 1}</small>
                    </button>
                  ))
                ) : (
                  <p className="empty-panel">
                    No bookmarks yet. Use the bookmark button while reading.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <footer className="reader-footer">
        <span>
          {mode === "read"
            ? `${percent}% completed`
            : `Page ${pdfPage} of ${pdf.numPages}`}
        </span>
        <div className="progress-track">
          <div style={{ width: `${percent}%` }} />
        </div>
        <span>
          {mode === "read"
            ? needsOcr ? `${pdf.numPages - ocrPage} pages left` : `${blocks.length - current - 1} passages left`
            : "Original pages"}
        </span>
      </footer>
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="range-setting">
      <div>
        <label>{label}</label>
        <span>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </div>
  );
}

export default function App() {
  const [books, setBooks] = useState<BookFile[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<BookFile | null>(null);
  const [document, setDocument] = useState<{
    pdf: PDFDocumentProxy;
    blocks: Block[];
    textPages: number[];
    title: string;
  } | null>(null);
  const [settings, setSettings] = useState<ReaderSettings>(() =>
    getStored("folio:settings:v2", defaults),
  );
  const [libraryPath, setLibraryPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progressMap, setProgressMap] = useState<Saved>(() =>
    getStored("folio:progress", {}),
  );
  const refresh = useCallback(async () => {
    try {
      setBooks(await invoke<BookFile[]>("list_books"));
      setProgressMap(getStored("folio:progress", {}));
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  useEffect(() => {
    refresh();
    invoke<string>("library_path")
      .then(setLibraryPath)
      .catch((cause) => setError(String(cause)));
    const interval = window.setInterval(refresh, 4000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem("folio:settings:v2", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") setDragging(true);
        else if (event.payload.type === "leave") setDragging(false);
        else if (event.payload.type === "drop") {
          setDragging(false);
          importPaths(event.payload.paths);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);
  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true);
    setError("");
    try {
      const imported = await invoke<string[]>("import_books", { paths });
      await refresh();
      if (imported.length === 1) {
        const list = await invoke<BookFile[]>("list_books");
        const book = list.find((item) => item.name === imported[0]);
        if (book) await openBook(book);
      }
    } catch (cause) {
      setError(String(cause));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const chooseFiles = async () => {
    try {
      const picked = await open({
        multiple: true,
        filters: [{ name: "PDF books", extensions: ["pdf"] }],
      });
      if (picked) await importPaths(Array.isArray(picked) ? picked : [picked]);
    } catch (cause) {
      setError(String(cause));
    }
  };
  const openBook = async (book: BookFile) => {
    setBusy(true);
    setError("");
    setSelected(book);
    setDocument(null);
    localStorage.setItem("folio:last", book.name);
    try {
      const data = await invoke<ArrayBuffer>("read_book", { name: book.name });
      const result = await openPdf(new Uint8Array(data));
      setDocument({ ...result, title: titleOf(book.name) });
    } catch (cause) {
      setError(`Could not open “${book.name}”: ${String(cause)}`);
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };
  const closeBook = () => {
    void document?.pdf.cleanup().catch(() => undefined);
    setSelected(null);
    setDocument(null);
    refresh();
  };
  const filtered = books.filter((book) =>
    `${book.name} ${titleOf(book.name)}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const last = books.find(
    (book) => book.name === localStorage.getItem("folio:last"),
  );
  if (selected && document)
    return (
      <>
        <Reader
          key={selected.name}
          book={selected}
          {...document}
          settings={settings}
          setSettings={setSettings}
          onClose={closeBook}
        />
        {error && (
          <div className="toast" role="alert">
            {error}
            <button onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <BookOpen size={24} strokeWidth={1.8} />
          </div>
          <span>
            folio<span className="brand-dot">.</span>
          </span>
        </div>
        <nav>
          <button className="nav-active">
            <LibraryBig size={19} /> My library
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="quiet-card">
            <div>
              <BookOpen size={18} />
              <span>Your space to read</span>
            </div>
            <p>Keep every book close. Pick up exactly where you left off.</p>
          </div>
          <div className="library-location">
            <FolderOpen size={16} />
            <span title={libraryPath}>
              {libraryPath ? "Local Library folder" : "Loading Library…"}
            </span>
          </div>
        </div>
      </aside>
      <main className="library-main">
        <div className="topbar">
          <span>My library</span>
          <div className="topbar-right">
            <span className="local-pill">
              <span /> Stored on this device
            </span>
            <div className="avatar">F</div>
          </div>
        </div>
        <div className="library-content">
          <div className="hero-copy">
            <p className="eyebrow">YOUR PERSONAL COLLECTION</p>
            <h1>
              A quieter place
              <br />
              for your books<span>.</span>
            </h1>
            <p>Every book, every page, right where you left it.</p>
          </div>
          {last && (
            <button className="continue-card" onClick={() => openBook(last)}>
              <span className="continue-icon">
                <BookOpen size={21} />
              </span>
              <span className="continue-copy">
                <small>CONTINUE READING</small>
                <strong>{titleOf(last.name)}</strong>
                <span>
                  Page {progressMap[last.name]?.page || 1} · Pick up where you
                  left off
                </span>
              </span>
              <span className="continue-arrow">
                <ArrowRight size={20} />
              </span>
            </button>
          )}
          <div className="library-heading">
            <div>
              <h2>
                Your books <span>{books.length}</span>
              </h2>
              <p>Thoughtfully collected, always within reach.</p>
            </div>
            <button
              className="primary-button"
              onClick={chooseFiles}
              disabled={busy}
            >
              <Plus size={18} /> Add books
            </button>
          </div>
          <div className="library-tools">
            <div className="search-box">
              <Search size={19} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your library"
                aria-label="Search books"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear search">
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="book-count">
              {filtered.length} {filtered.length === 1 ? "book" : "books"}
            </div>
          </div>
          {!books.length ? (
            <div className="empty-library">
              <div className="empty-illustration">
                <BookOpen size={46} strokeWidth={1.4} />
              </div>
              <h3>Your library starts here</h3>
              <p>
                Drop a PDF anywhere or choose a file to add your first book.
              </p>
              <button onClick={chooseFiles}>
                <Plus size={17} /> Import a PDF
              </button>
            </div>
          ) : filtered.length ? (
            <div className="book-grid">
              {filtered.map((book) => (
                <button
                  className="book-card"
                  key={book.name}
                  onClick={() => openBook(book)}
                >
                  <div
                    className="book-cover"
                    style={{ backgroundColor: coverColor(book.name) }}
                  >
                    <div className="cover-top">folio collection</div>
                    <div className="cover-title">{titleOf(book.name)}</div>
                    <div className="cover-bottom">
                      <span className="cover-line" />
                      <span>PDF</span>
                    </div>
                  </div>
                  <div className="book-meta">
                    <strong>{titleOf(book.name)}</strong>
                    <span>
                      {progressMap[book.name]
                        ? `${Math.max(1, progressMap[book.name].page)} pages in`
                        : "Not started"}{" "}
                      <span className="meta-dot">·</span>{" "}
                      {(book.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="no-results">
              <Search size={26} />
              <h3>No books found</h3>
              <p>Try a different title or filename.</p>
            </div>
          )}
        </div>
      </main>
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Plus size={36} />
            <h2>Drop to add to your library</h2>
            <p>PDF books only</p>
          </div>
        </div>
      )}
      {busy && <div className="busy-bar" />}
      {selected && !document && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>Preparing your book…</p>
          <small>Finding text and chapters</small>
        </div>
      )}
      {error && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
