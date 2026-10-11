//! Vault file operations. Every path the frontend can reach is built from a
//! vault root plus validated name segments, so nothing can escape the vault.

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, State};

const PDF_DIR: &str = "_pdfs";
const ASSET_DIR: &str = "_assets";
const TEMPLATE_DIR: &str = "_templates";
const META_DIR: &str = ".notely";
const HIGHLIGHT_DIR: &str = "highlights";
const CACHE_DIR: &str = "cache";
const REVIEW_FILE: &str = "review.json";
const HISTORY_DIR: &str = "history";
/// At most one automatic version of a note per this many milliseconds.
const SNAPSHOT_GAP_MS: u64 = 10 * 60 * 1000;
const MAX_VERSIONS: usize = 100;
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

#[derive(Default)]
pub struct VaultState {
    root: Mutex<Option<PathBuf>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Rejects anything that is not a plain, single file/folder name.
fn check_name(name: &str) -> Res<&str> {
    let bad = name.is_empty()
        || name != name.trim()
        || name == "."
        || name == ".."
        || name.starts_with('.')
        || name.ends_with('.')
        || name.chars().any(|c| {
            matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
        });
    if bad {
        Err(format!("Invalid name: \"{name}\""))
    } else {
        Ok(name)
    }
}

fn root(state: &State<VaultState>) -> Res<PathBuf> {
    state
        .root
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "No vault is open".to_string())
}

fn notebook_dir(state: &State<VaultState>, notebook: &str) -> Res<PathBuf> {
    let nb = check_name(notebook)?;
    if nb.starts_with('_') {
        return Err(format!("Invalid notebook name: \"{nb}\""));
    }
    Ok(root(state)?.join(nb))
}

fn note_path(state: &State<VaultState>, notebook: &str, note: &str) -> Res<PathBuf> {
    Ok(notebook_dir(state, notebook)?.join(format!("{}.md", check_name(note)?)))
}

fn canvas_path(state: &State<VaultState>, notebook: &str, canvas: &str) -> Res<PathBuf> {
    Ok(notebook_dir(state, notebook)?.join(format!("{}.canvas", check_name(canvas)?)))
}

fn pdf_path(state: &State<VaultState>, notebook: &str, pdf: &str) -> Res<PathBuf> {
    let name = check_name(pdf)?;
    if !name.to_lowercase().ends_with(".pdf") {
        return Err("Not a PDF".into());
    }
    Ok(notebook_dir(state, notebook)?.join(PDF_DIR).join(name))
}

fn highlight_path(state: &State<VaultState>, notebook: &str, pdf: &str) -> Res<PathBuf> {
    Ok(notebook_dir(state, notebook)?
        .join(META_DIR)
        .join(HIGHLIGHT_DIR)
        .join(format!("{}.json", check_name(pdf)?)))
}

/// Extracted-text cache for a PDF; safe to delete, rebuilt on demand.
fn text_cache_path(state: &State<VaultState>, notebook: &str, pdf: &str) -> Res<PathBuf> {
    Ok(notebook_dir(state, notebook)?
        .join(META_DIR)
        .join(CACHE_DIR)
        .join(format!("{}.text.json", check_name(pdf)?)))
}

fn image_ext(name: &str) -> Option<String> {
    let ext = Path::new(name).extension()?.to_str()?.to_lowercase();
    IMAGE_EXTS.contains(&ext.as_str()).then_some(ext)
}

/// An image in the notebook's `_assets` folder (referenced from notes as `_assets/<name>`).
fn asset_path(state: &State<VaultState>, notebook: &str, name: &str) -> Res<PathBuf> {
    let name = check_name(name)?;
    if image_ext(name).is_none() {
        return Err("Not a supported image".into());
    }
    Ok(notebook_dir(state, notebook)?.join(ASSET_DIR).join(name))
}

/// A Markdown-friendly asset name: no spaces (they break `![](path)`), unique in the folder.
fn unique_asset_name(dir: &Path, stem: &str, ext: &str) -> Res<String> {
    let clean: String = stem
        .trim()
        .trim_start_matches('.')
        .chars()
        .map(|c| if c.is_whitespace() { '-' } else { c })
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '(' | ')' | '[' | ']'))
        .collect();
    let stem = if clean.is_empty() { "image".to_string() } else { clean };
    let exists = |n: &str| dir.join(n).exists();
    let first = format!("{stem}.{ext}");
    let name = if !exists(&first) {
        first
    } else {
        (1..).map(|i| format!("{stem}-{i}.{ext}")).find(|n| !exists(n)).unwrap()
    };
    check_name(&name)?;
    Ok(name)
}

/// Decodes a percent-encoded header value (names are sent with `encodeURIComponent`).
fn header(request: &tauri::ipc::Request, key: &str) -> Res<String> {
    let raw = request
        .headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("Missing {key}"))?;
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(err)?;
            out.push(u8::from_str_radix(hex, 16).map_err(err)?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(err)
}

/// Writes through a temp file + rename so a crash never leaves a half-written note.
fn atomic_write(path: &Path, contents: &[u8]) -> Res<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = path.with_extension("notely-tmp");
    fs::write(&tmp, contents).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Returns `base`, or `base 1`, `base 2`, ... — the first that `exists` rejects.
fn unique_name(base: &str, ext: &str, exists: impl Fn(&str) -> bool) -> String {
    let first = format!("{base}{ext}");
    if !exists(&first) {
        return first;
    }
    (1..)
        .map(|i| format!("{base} {i}{ext}"))
        .find(|n| !exists(n))
        .unwrap()
}

#[derive(Serialize)]
pub struct FileMeta {
    name: String,
    modified: u64,
}

#[derive(Serialize)]
pub struct Notebook {
    name: String,
    notes: Vec<FileMeta>,
    pdfs: Vec<FileMeta>,
    canvases: Vec<FileMeta>,
}

fn list_files(dir: &Path, ext: &str) -> Vec<FileMeta> {
    let mut out: Vec<FileMeta> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let file = e.file_name().to_string_lossy().to_string();
            if !file.to_lowercase().ends_with(ext) {
                return None;
            }
            // Notes and canvases are named without their extension; PDFs keep theirs.
            let name = if ext == ".pdf" { file } else { file[..file.len() - ext.len()].to_string() };
            Some(FileMeta { name, modified: modified_ms(&meta) })
        })
        .collect();
    out.sort_by_key(|f| f.name.to_lowercase());
    out
}

// ---------- vault ----------

#[tauri::command]
pub fn open_vault(app: AppHandle, state: State<VaultState>, path: String) -> Res<()> {
    let root = PathBuf::from(path);
    fs::create_dir_all(&root).map_err(err)?;
    let root = root.canonicalize().map_err(err)?;

    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, notify::EventKind::Access(_)) {
                return;
            }
            // Only user-visible files matter: skip temp files and the app's own
            // `.notely/` data (highlights, caches, history), which it saves itself.
            let paths: Vec<String> = ev
                .paths
                .iter()
                .filter(|p| !p.components().any(|c| c.as_os_str() == META_DIR))
                .map(|p| p.to_string_lossy().to_string())
                .filter(|p| !p.ends_with(".notely-tmp"))
                .collect();
            if !paths.is_empty() {
                let _ = handle.emit("vault-changed", paths);
            }
        }
    })
    .map_err(err)?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(err)?;

    *state.root.lock().unwrap() = Some(root);
    *state.watcher.lock().unwrap() = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn list_vault(state: State<VaultState>) -> Res<Vec<Notebook>> {
    let root = root(&state)?;
    let mut books: Vec<Notebook> = fs::read_dir(&root)
        .map_err(err)?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') {
                return None;
            }
            let dir = e.path();
            Some(Notebook {
                notes: list_files(&dir, ".md"),
                pdfs: list_files(&dir.join(PDF_DIR), ".pdf"),
                canvases: list_files(&dir, ".canvas"),
                name,
            })
        })
        .collect();
    books.sort_by_key(|b| b.name.to_lowercase());
    Ok(books)
}

// ---------- notebooks ----------

#[tauri::command]
pub fn create_notebook(state: State<VaultState>, name: String) -> Res<String> {
    let root = root(&state)?;
    let base = check_name(&name)?.to_string();
    let final_name = unique_name(&base, "", |n| root.join(n).exists());
    fs::create_dir_all(notebook_dir(&state, &final_name)?).map_err(err)?;
    Ok(final_name)
}

#[tauri::command]
pub fn rename_notebook(state: State<VaultState>, old: String, new: String) -> Res<()> {
    let from = notebook_dir(&state, &old)?;
    let to = notebook_dir(&state, &new)?;
    if to.exists() && !old.eq_ignore_ascii_case(&new) {
        return Err(format!("A notebook named \"{new}\" already exists"));
    }
    fs::rename(from, to).map_err(err)
}

#[tauri::command]
pub fn delete_notebook(state: State<VaultState>, name: String) -> Res<()> {
    trash::delete(notebook_dir(&state, &name)?).map_err(err)
}

// ---------- notes ----------

#[tauri::command]
pub fn read_note(state: State<VaultState>, notebook: String, note: String) -> Res<String> {
    fs::read_to_string(note_path(&state, &notebook, &note)?).map_err(err)
}

#[tauri::command]
pub fn write_note(
    state: State<VaultState>,
    notebook: String,
    note: String,
    content: String,
) -> Res<()> {
    let path = note_path(&state, &notebook, &note)?;
    // Keep the version from before this burst of editing. A failure here must
    // never stop the note from saving.
    if let Ok(old) = fs::read_to_string(&path) {
        if let Ok(dir) = history_dir(&state, &notebook, &note) {
            let _ = snapshot_before_edit(&dir, &old, &content, now_ms());
        }
    }
    atomic_write(&path, content.as_bytes())
}

#[tauri::command]
pub fn create_note(
    state: State<VaultState>,
    notebook: String,
    name: String,
    content: Option<String>,
) -> Res<String> {
    let dir = notebook_dir(&state, &notebook)?;
    let base = check_name(&name)?.to_string();
    let file = unique_name(&base, ".md", |n| dir.join(n).exists());
    let final_name = file[..file.len() - 3].to_string();
    atomic_write(&dir.join(&file), content.unwrap_or_default().as_bytes())?;
    Ok(final_name)
}

#[tauri::command]
pub fn rename_note(state: State<VaultState>, notebook: String, old: String, new: String) -> Res<()> {
    let from = note_path(&state, &notebook, &old)?;
    let to = note_path(&state, &notebook, &new)?;
    if to.exists() && !old.eq_ignore_ascii_case(&new) {
        return Err(format!("A note named \"{new}\" already exists"));
    }
    fs::rename(from, to).map_err(err)?;
    // The note's history moves with it.
    let (h_from, h_to) = (history_dir(&state, &notebook, &old)?, history_dir(&state, &notebook, &new)?);
    if h_from.is_dir() && h_from != h_to {
        let _ = fs::rename(h_from, h_to);
    }
    Ok(())
}

// ---------- note version history ----------

fn history_dir(state: &State<VaultState>, notebook: &str, note: &str) -> Res<PathBuf> {
    Ok(notebook_dir(state, notebook)?.join(META_DIR).join(HISTORY_DIR).join(check_name(note)?))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Saved versions in a history folder, newest first: (time in ms, path).
fn versions_in(dir: &Path) -> Vec<(u64, PathBuf)> {
    let mut out: Vec<(u64, PathBuf)> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension()? != "md" {
                return None;
            }
            Some((p.file_stem()?.to_str()?.parse().ok()?, p))
        })
        .collect();
    out.sort_by_key(|v| std::cmp::Reverse(v.0));
    out
}

/// Stores `content` as a version (unless the newest version is identical) and
/// keeps at most `MAX_VERSIONS`.
fn snapshot(dir: &Path, content: &str, at: u64) -> Res<bool> {
    let existing = versions_in(dir);
    if let Some((_, newest)) = existing.first() {
        if fs::read_to_string(newest).map(|t| t == content).unwrap_or(false) {
            return Ok(false);
        }
    }
    fs::create_dir_all(dir).map_err(err)?;
    let mut t = at;
    while dir.join(format!("{t}.md")).exists() {
        t += 1;
    }
    atomic_write(&dir.join(format!("{t}.md")), content.as_bytes())?;
    for (_, old) in versions_in(dir).into_iter().skip(MAX_VERSIONS) {
        let _ = fs::remove_file(old);
    }
    Ok(true)
}

/// Before a save replaces `old` with `new`: keep `old` as a version unless one
/// was kept in the last `SNAPSHOT_GAP_MS`. So coming back to a note saves how
/// it looked before, and a long session leaves a checkpoint every 10 minutes —
/// without a version for every keystroke-driven save.
fn snapshot_before_edit(dir: &Path, old: &str, new: &str, now: u64) -> Res<bool> {
    if old == new || old.trim().is_empty() {
        return Ok(false);
    }
    let newest = versions_in(dir).first().map(|(t, _)| *t);
    if newest.is_some_and(|t| now.saturating_sub(t) < SNAPSHOT_GAP_MS) {
        return Ok(false);
    }
    snapshot(dir, old, now)
}

#[derive(Serialize)]
pub struct Version {
    /// Milliseconds since the epoch; also the version's id.
    time: u64,
    size: u64,
}

#[tauri::command]
pub fn list_versions(state: State<VaultState>, notebook: String, note: String) -> Res<Vec<Version>> {
    let dir = history_dir(&state, &notebook, &note)?;
    Ok(versions_in(&dir)
        .into_iter()
        .map(|(time, p)| Version { time, size: fs::metadata(p).map(|m| m.len()).unwrap_or(0) })
        .collect())
}

#[tauri::command]
pub fn read_version(state: State<VaultState>, notebook: String, note: String, time: u64) -> Res<String> {
    fs::read_to_string(history_dir(&state, &notebook, &note)?.join(format!("{time}.md"))).map_err(err)
}

/// Saves the note as it is now as a version (e.g. right before restoring an older one).
#[tauri::command]
pub fn snapshot_note(state: State<VaultState>, notebook: String, note: String) -> Res<bool> {
    let text = fs::read_to_string(note_path(&state, &notebook, &note)?).map_err(err)?;
    if text.trim().is_empty() {
        return Ok(false);
    }
    snapshot(&history_dir(&state, &notebook, &note)?, &text, now_ms())
}

#[tauri::command]
pub fn delete_note(state: State<VaultState>, notebook: String, note: String) -> Res<()> {
    trash::delete(note_path(&state, &notebook, &note)?).map_err(err)
}

// ---------- canvases ----------

#[tauri::command]
pub fn read_canvas(state: State<VaultState>, notebook: String, canvas: String) -> Res<String> {
    fs::read_to_string(canvas_path(&state, &notebook, &canvas)?).map_err(err)
}

#[tauri::command]
pub fn write_canvas(state: State<VaultState>, notebook: String, canvas: String, content: String) -> Res<()> {
    atomic_write(&canvas_path(&state, &notebook, &canvas)?, content.as_bytes())
}

#[tauri::command]
pub fn create_canvas(state: State<VaultState>, notebook: String, name: String, content: Option<String>) -> Res<String> {
    let dir = notebook_dir(&state, &notebook)?;
    let base = check_name(&name)?.to_string();
    let file = unique_name(&base, ".canvas", |n| dir.join(n).exists());
    let final_name = file[..file.len() - 7].to_string();
    let body = content.unwrap_or_else(|| "{\"nodes\":[],\"edges\":[]}\n".to_string());
    atomic_write(&dir.join(&file), body.as_bytes())?;
    Ok(final_name)
}

#[tauri::command]
pub fn rename_canvas(state: State<VaultState>, notebook: String, old: String, new: String) -> Res<()> {
    let from = canvas_path(&state, &notebook, &old)?;
    let to = canvas_path(&state, &notebook, &new)?;
    if to.exists() && !old.eq_ignore_ascii_case(&new) {
        return Err(format!("A canvas named \"{new}\" already exists"));
    }
    fs::rename(from, to).map_err(err)
}

#[tauri::command]
pub fn delete_canvas(state: State<VaultState>, notebook: String, canvas: String) -> Res<()> {
    trash::delete(canvas_path(&state, &notebook, &canvas)?).map_err(err)
}

// ---------- agent guide ----------

const GUIDE_MARKER: &str = "<!-- notely:generated";

/// Writes AGENTS.md at the vault root unless the user has written their own.
#[tauri::command]
pub fn write_agent_guide(state: State<VaultState>, content: String) -> Res<bool> {
    let path = root(&state)?.join("AGENTS.md");
    if let Ok(existing) = fs::read_to_string(&path) {
        if !existing.contains(GUIDE_MARKER) || existing == content {
            return Ok(false);
        }
    }
    atomic_write(&path, content.as_bytes())?;
    Ok(true)
}

// ---------- pdfs ----------

#[tauri::command]
pub fn import_pdf(state: State<VaultState>, notebook: String, source: String) -> Res<String> {
    let src = PathBuf::from(&source);
    let file = src
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .ok_or("Invalid source path")?;
    if !file.to_lowercase().ends_with(".pdf") {
        return Err("Only PDF files can be imported".into());
    }
    let stem = &file[..file.len() - 4];
    // Strip characters the vault would reject (e.g. leading dots).
    let stem = stem.trim().trim_start_matches('.').trim_end_matches('.');
    let stem = if stem.is_empty() { "Document" } else { stem };
    let dir = notebook_dir(&state, &notebook)?.join(PDF_DIR);
    fs::create_dir_all(&dir).map_err(err)?;
    let name = unique_name(stem, ".pdf", |n| dir.join(n).exists());
    check_name(&name)?;
    fs::copy(&src, dir.join(&name)).map_err(err)?;
    Ok(name)
}

#[tauri::command]
pub fn read_pdf(state: State<VaultState>, notebook: String, pdf: String) -> Res<tauri::ipc::Response> {
    let bytes = fs::read(pdf_path(&state, &notebook, &pdf)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Re-creates a deleted PDF from captured bytes (plus its highlights), for "undo delete".
#[tauri::command]
pub fn restore_pdf(
    state: State<VaultState>,
    notebook: String,
    pdf: String,
    bytes: Vec<u8>,
    highlights: Option<String>,
) -> Res<()> {
    atomic_write(&pdf_path(&state, &notebook, &pdf)?, &bytes)?;
    if let Some(h) = highlights {
        atomic_write(&highlight_path(&state, &notebook, &pdf)?, h.as_bytes())?;
    }
    Ok(())
}

#[tauri::command]
pub fn rename_pdf(state: State<VaultState>, notebook: String, old: String, new: String) -> Res<()> {
    let to = pdf_path(&state, &notebook, &new)?;
    if to.exists() && !old.eq_ignore_ascii_case(&new) {
        return Err(format!("A PDF named \"{new}\" already exists"));
    }
    fs::rename(pdf_path(&state, &notebook, &old)?, to).map_err(err)?;
    let hl_from = highlight_path(&state, &notebook, &old)?;
    if hl_from.exists() {
        fs::rename(hl_from, highlight_path(&state, &notebook, &new)?).map_err(err)?;
    }
    let _ = fs::remove_file(text_cache_path(&state, &notebook, &old)?);
    Ok(())
}

#[tauri::command]
pub fn delete_pdf(state: State<VaultState>, notebook: String, pdf: String) -> Res<()> {
    trash::delete(pdf_path(&state, &notebook, &pdf)?).map_err(err)?;
    let hl = highlight_path(&state, &notebook, &pdf)?;
    if hl.exists() {
        trash::delete(hl).map_err(err)?;
    }
    let _ = fs::remove_file(text_cache_path(&state, &notebook, &pdf)?);
    Ok(())
}

// ---------- image assets ----------

/// Saves image bytes (the raw request body) into `_assets/`. Headers carry the
/// notebook and the wanted file name; returns the unique name actually used.
#[tauri::command]
pub fn write_asset(state: State<VaultState>, request: tauri::ipc::Request) -> Res<String> {
    let notebook = header(&request, "x-notebook")?;
    let wanted = header(&request, "x-name")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw image bytes".into());
    };
    let ext = image_ext(&wanted).ok_or("Not a supported image")?;
    let stem = Path::new(&wanted).file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let dir = notebook_dir(&state, &notebook)?.join(ASSET_DIR);
    let name = unique_asset_name(&dir, stem, &ext)?;
    atomic_write(&dir.join(&name), bytes)?;
    Ok(name)
}

/// Copies an image file from disk (e.g. dropped from Explorer) into `_assets/`.
#[tauri::command]
pub fn import_asset(state: State<VaultState>, notebook: String, source: String) -> Res<String> {
    let src = PathBuf::from(&source);
    let file = src.file_name().and_then(|f| f.to_str()).ok_or("Invalid source path")?;
    let ext = image_ext(file).ok_or("Only images can be added to a note")?;
    let stem = Path::new(file).file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let dir = notebook_dir(&state, &notebook)?.join(ASSET_DIR);
    fs::create_dir_all(&dir).map_err(err)?;
    let name = unique_asset_name(&dir, stem, &ext)?;
    fs::copy(&src, dir.join(&name)).map_err(err)?;
    Ok(name)
}

#[tauri::command]
pub fn read_asset(state: State<VaultState>, notebook: String, name: String) -> Res<tauri::ipc::Response> {
    let bytes = fs::read(asset_path(&state, &notebook, &name)?).map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------- note templates (vault-wide, in `_templates/`) ----------

fn template_path(state: &State<VaultState>, name: &str) -> Res<PathBuf> {
    Ok(root(state)?.join(TEMPLATE_DIR).join(format!("{}.md", check_name(name)?)))
}

/// The templates, or `None` if the folder doesn't exist yet (so the app can seed starters).
#[tauri::command]
pub fn list_templates(state: State<VaultState>) -> Res<Option<Vec<FileMeta>>> {
    let dir = root(&state)?.join(TEMPLATE_DIR);
    if !dir.is_dir() {
        return Ok(None);
    }
    Ok(Some(list_files(&dir, ".md")))
}

#[tauri::command]
pub fn read_template(state: State<VaultState>, name: String) -> Res<String> {
    fs::read_to_string(template_path(&state, &name)?).map_err(err)
}

#[tauri::command]
pub fn write_template(state: State<VaultState>, name: String, content: String) -> Res<()> {
    atomic_write(&template_path(&state, &name)?, content.as_bytes())
}

// ---------- flashcard review state ----------

fn review_path(state: &State<VaultState>, notebook: &str) -> Res<PathBuf> {
    Ok(notebook_dir(state, notebook)?.join(META_DIR).join(REVIEW_FILE))
}

#[tauri::command]
pub fn read_review(state: State<VaultState>, notebook: String) -> Res<Option<String>> {
    let path = review_path(&state, &notebook)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(err)
}

#[tauri::command]
pub fn write_review(state: State<VaultState>, notebook: String, content: String) -> Res<()> {
    atomic_write(&review_path(&state, &notebook)?, content.as_bytes())
}

// ---------- highlights ----------

#[tauri::command]
pub fn read_highlights(state: State<VaultState>, notebook: String, pdf: String) -> Res<Option<String>> {
    let path = highlight_path(&state, &notebook, &pdf)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(err)
}

#[tauri::command]
pub fn write_highlights(
    state: State<VaultState>,
    notebook: String,
    pdf: String,
    content: String,
) -> Res<()> {
    atomic_write(&highlight_path(&state, &notebook, &pdf)?, content.as_bytes())
}

// ---------- pdf text cache ----------

#[tauri::command]
pub fn read_text_cache(state: State<VaultState>, notebook: String, pdf: String) -> Res<Option<String>> {
    let path = text_cache_path(&state, &notebook, &pdf)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(err)
}

#[tauri::command]
pub fn write_text_cache(
    state: State<VaultState>,
    notebook: String,
    pdf: String,
    content: String,
) -> Res<()> {
    atomic_write(&text_cache_path(&state, &notebook, &pdf)?, content.as_bytes())
}

// ---------- export ----------

/// Writes an export to a path the user picked in a save dialog.
#[tauri::command]
pub fn export_file(path: String, content: String) -> Res<()> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("Export path must be absolute".into());
    }
    fs::write(path, content).map_err(err)
}

/// Binary exports (e.g. a canvas as PNG): raw bytes, with the target path in a header.
#[tauri::command]
pub fn export_bytes(request: tauri::ipc::Request) -> Res<()> {
    let path = PathBuf::from(header(&request, "x-path")?);
    if !path.is_absolute() {
        return Err("Export path must be absolute".into());
    }
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw bytes".into());
    };
    fs::write(path, bytes).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal_and_reserved_chars() {
        for bad in ["..", ".", "", "a/b", "..\\..\\x", "c:", " a", "a ", ".hidden", "x?"] {
            assert!(check_name(bad).is_err(), "{bad:?} should be rejected");
        }
        for ok in ["Biology 101", "Cell structure", "paper (v2).pdf", "Ünïcode"] {
            assert!(check_name(ok).is_ok(), "{ok:?} should be accepted");
        }
    }

    #[test]
    fn unique_names_increment() {
        let taken = ["Untitled.md", "Untitled 1.md"];
        let n = unique_name("Untitled", ".md", |n| taken.contains(&n));
        assert_eq!(n, "Untitled 2.md");
    }

    #[test]
    fn asset_names_are_markdown_safe_and_unique() {
        let dir = std::env::temp_dir().join(format!("notely-asset-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        // Spaces and Markdown-breaking brackets are removed.
        assert_eq!(unique_asset_name(&dir, "My Screen (1)", "png").unwrap(), "My-Screen-1.png");
        fs::write(dir.join("shot.png"), b"x").unwrap();
        assert_eq!(unique_asset_name(&dir, "shot", "png").unwrap(), "shot-1.png");
        assert_eq!(unique_asset_name(&dir, "  ", "png").unwrap(), "image.png");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_keeps_one_version_per_gap() {
        let dir = std::env::temp_dir().join(format!("notely-history-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let t0 = 1_800_000_000_000u64;
        // First edit after a quiet spell keeps the old text.
        assert!(snapshot_before_edit(&dir, "v1", "v2", t0).unwrap());
        // Saves seconds later in the same session don't.
        assert!(!snapshot_before_edit(&dir, "v2", "v3", t0 + 5_000).unwrap());
        // Nothing to keep: unchanged or empty.
        assert!(!snapshot_before_edit(&dir, "same", "same", t0 + SNAPSHOT_GAP_MS * 3).unwrap());
        assert!(!snapshot_before_edit(&dir, "  ", "x", t0 + SNAPSHOT_GAP_MS * 3).unwrap());
        // After the gap, another version.
        assert!(snapshot_before_edit(&dir, "v3", "v4", t0 + SNAPSHOT_GAP_MS).unwrap());
        let v = versions_in(&dir);
        assert_eq!(v.len(), 2);
        assert_eq!(fs::read_to_string(&v[0].1).unwrap(), "v3"); // newest first
        assert_eq!(fs::read_to_string(&v[1].1).unwrap(), "v1");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn history_skips_duplicates_and_prunes() {
        let dir = std::env::temp_dir().join(format!("notely-history-prune-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert!(snapshot(&dir, "a", 1).unwrap());
        assert!(!snapshot(&dir, "a", 2).unwrap()); // same as newest
        for i in 0..(MAX_VERSIONS as u64 + 5) {
            snapshot(&dir, &format!("t{i}"), 10 + i).unwrap();
        }
        let v = versions_in(&dir);
        assert_eq!(v.len(), MAX_VERSIONS);
        assert_eq!(fs::read_to_string(&v[0].1).unwrap(), format!("t{}", MAX_VERSIONS + 4));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_images_are_assets() {
        assert_eq!(image_ext("a.PNG").as_deref(), Some("png"));
        assert_eq!(image_ext("a.webp").as_deref(), Some("webp"));
        assert!(image_ext("a.exe").is_none());
        assert!(image_ext("noext").is_none());
    }
}
