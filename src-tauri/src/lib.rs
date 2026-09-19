use std::{fs, io::{Read, Write}, path::{Component, Path, PathBuf}, process::{Command, Stdio}, time::UNIX_EPOCH};
use tauri::{ipc::Response, Manager};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BookFile { name: String, size: u64, modified: u64 }

fn library(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("Library");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn valid_pdf(path: &Path) -> Result<(), String> {
    if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("pdf")) { return Err("Only PDF files can be imported".into()); }
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut header = [0; 5];
    file.read_exact(&mut header).map_err(|_| "This PDF is empty or incomplete".to_string())?;
    if &header != b"%PDF-" { return Err("This file is not a valid PDF".into()); }
    Ok(())
}

fn safe_name(name: &str) -> Result<&str, String> {
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() || !name.to_ascii_lowercase().ends_with(".pdf") {
        return Err("Invalid book name".into());
    }
    Ok(name)
}

fn book_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let path = library(app)?.join(safe_name(name)?);
    if fs::symlink_metadata(&path).map_err(|e| e.to_string())?.file_type().is_symlink() {
        return Err("Symbolic links are not supported in the Library".into());
    }
    valid_pdf(&path)?;
    Ok(path)
}

fn render_pdf_page(book: &Path, page: u32, resolution: &str) -> Result<Vec<u8>, String> {
    if page == 0 || page > 10000 { return Err("Invalid page number".into()); }
    let rendered = Command::new("pdftoppm")
        .args(["-f", &page.to_string(), "-l", &page.to_string(), "-r", resolution, "-png", "-singlefile"])
        .arg(book).output()
        .map_err(|_| "PDF pages need the local pdftoppm tool".to_string())?;
    if !rendered.status.success() || rendered.stdout.is_empty() {
        return Err("Could not render this PDF page".into());
    }
    Ok(rendered.stdout)
}

#[tauri::command]
fn library_path(app: tauri::AppHandle) -> Result<String, String> { Ok(library(&app)?.to_string_lossy().into_owned()) }

#[tauri::command]
fn list_books(app: tauri::AppHandle) -> Result<Vec<BookFile>, String> {
    let mut books = Vec::new();
    for entry in fs::read_dir(library(&app)?).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() || entry.file_type().map_err(|e| e.to_string())?.is_symlink() || !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("pdf")) { continue; }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        books.push(BookFile { name: entry.file_name().to_string_lossy().into_owned(), size: meta.len(), modified: meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs()) });
    }
    books.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    Ok(books)
}

#[tauri::command]
fn import_books(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<String>, String> {
    let dir = library(&app)?;
    let mut imported = Vec::new();
    for raw in paths {
        let source = Path::new(&raw);
        valid_pdf(source)?;
        let name = source.file_name().ok_or("Invalid file name")?.to_string_lossy();
        let stem = source.file_stem().ok_or("Invalid file name")?.to_string_lossy();
        let mut dest = dir.join(name.as_ref());
        let mut n = 2;
        while dest.exists() { dest = dir.join(format!("{stem} ({n}).pdf")); n += 1; }
        fs::copy(source, &dest).map_err(|e| e.to_string())?;
        imported.push(dest.file_name().unwrap().to_string_lossy().into_owned());
    }
    Ok(imported)
}

#[tauri::command]
fn read_book(app: tauri::AppHandle, name: String) -> Result<Response, String> {
    let path = book_path(&app, &name)?;
    fs::read(path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
async fn render_page(app: tauri::AppHandle, name: String, page: u32) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = book_path(&app, &name)?;
        render_pdf_page(&path, page, "140").map(Response::new)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn ocr_page(app: tauri::AppHandle, name: String, page: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let book = book_path(&app, &name)?;
        let meta = fs::metadata(&book).map_err(|e| e.to_string())?;
        let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
        let cache_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("OCR").join(&name);
        fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        let cache = cache_dir.join(format!("{page}-{}-{modified}.txt", meta.len()));
        if let Ok(text) = fs::read_to_string(&cache) { return Ok(text); }

        let rendered = render_pdf_page(&book, page, "160")?;
        let mut child = Command::new("tesseract")
            .args(["stdin", "stdout", "-l", "eng"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().map_err(|_| "Scanned books need the local tesseract tool".to_string())?;
        child.stdin.take().ok_or("Could not start text recognition")?
            .write_all(&rendered).map_err(|e| e.to_string())?;
        let result = child.wait_with_output().map_err(|e| e.to_string())?;
        if !result.status.success() { return Err("Text recognition failed for this page".into()); }
        let text = String::from_utf8_lossy(&result.stdout).trim().to_string();
        let temporary = cache.with_extension("txt.tmp");
        fs::write(&temporary, &text).map_err(|e| e.to_string())?;
        fs::rename(&temporary, &cache).map_err(|e| e.to_string())?;
        Ok(text)
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![library_path, list_books, import_books, read_book, render_page, ocr_page])
        .run(tauri::generate_context!())
        .expect("failed to run Folio");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn book_names_cannot_escape_library() {
        assert!(safe_name("book.pdf").is_ok());
        assert!(safe_name("../book.pdf").is_err());
        assert!(safe_name("folder/book.pdf").is_err());
        assert!(safe_name("book.txt").is_err());
    }
}
