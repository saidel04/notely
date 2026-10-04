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
const META_DIR: &str = ".notely";
const HIGHLIGHT_DIR: &str = "highlights";
const CACHE_DIR: &str = "cache";

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
            let paths: Vec<String> = ev
                .paths
                .iter()
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
    atomic_write(&note_path(&state, &notebook, &note)?, content.as_bytes())
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
    fs::rename(from, to).map_err(err)
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
}
