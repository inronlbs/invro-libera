use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;
use uuid::Uuid;

const NONCE_SIZE: usize = 12;

static CATALOG_CACHE: std::sync::OnceLock<tokio::sync::RwLock<Option<BookCatalog>>> = std::sync::OnceLock::new();

/// Metadata for a single encrypted book stored on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookEntry {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub assigned_class: Option<String>,
    pub cover_image_base64: Option<String>,
    #[serde(rename = "type")]
    pub book_type: String,         // "pdf" or "epub"
    pub category: Option<String>,
    pub original_filename: String,
    pub encrypted_filename: String,
    pub file_size: u64,
    #[serde(default)]
    pub hidden: bool,
}

/// The book catalog persisted as JSON alongside the encrypted blobs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BookCatalog {
    pub books: Vec<BookEntry>,
}

/// Returns the path to the hidden books storage directory.
pub fn books_dir(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("secure_books")
}

/// Returns the path to the catalog JSON file.
fn catalog_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("book_catalog.json")
}

/// Loads the catalog from disk or returns an empty one.
pub async fn load_catalog(app_data_dir: &std::path::Path) -> BookCatalog {
    let cache_lock = CATALOG_CACHE.get_or_init(|| tokio::sync::RwLock::new(None));
    if let Some(cat) = cache_lock.read().await.as_ref() {
        return cat.clone();
    }

    let path = catalog_path(app_data_dir);
    let mut catalog = BookCatalog::default();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path).await {
            if let Ok(cat) = serde_json::from_str(&content) {
                catalog = cat;
            }
        }
    }

    *cache_lock.write().await = Some(catalog.clone());
    catalog
}

/// Saves the given catalog to disk as JSON.
pub async fn save_catalog(app_data_dir: &std::path::Path, catalog: &BookCatalog) {
    let path = catalog_path(app_data_dir);
    if let Ok(json) = serde_json::to_string_pretty(catalog) {
        let _ = fs::write(&path, json).await;
    }
    
    let cache_lock = CATALOG_CACHE.get_or_init(|| tokio::sync::RwLock::new(None));
    *cache_lock.write().await = Some(catalog.clone());
}

/// Derives a consistent 256-bit key from a passphrase.
/// In production you'd use PBKDF2/Argon2, but for an offline lab
/// app with no internet, a static key is sufficient.
fn derive_key() -> [u8; 32] {
    // Static key for offline lab use — books are protected from casual copying,
    // not from someone who reverse-engineers the binary.
    let mut key = [0u8; 32];
    key.copy_from_slice(b"InvronLabSecureKey2024!!_32bytes");
    key
}

/// Encrypts raw file bytes using AES-256-GCM.
/// Returns: [12-byte nonce | ciphertext]
fn encrypt_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher.encrypt(nonce, plaintext).map_err(|e| e.to_string())?;

    // Prepend nonce to ciphertext
    let mut output = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

/// Decrypts [nonce | ciphertext] back to plaintext.
fn decrypt_bytes(encrypted: &[u8]) -> Result<Vec<u8>, String> {
    if encrypted.len() < NONCE_SIZE {
        return Err("Encrypted data too short".to_string());
    }

    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let nonce = Nonce::from_slice(&encrypted[..NONCE_SIZE]);
    let ciphertext = &encrypted[NONCE_SIZE..];

    cipher.decrypt(nonce, ciphertext).map_err(|e| e.to_string())
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Import a single book file from the given path, encrypt it, and store it.
#[tauri::command]
pub async fn import_book(
    state: tauri::State<'_, crate::state::AppState>,
    file_path: String,
    title: Option<String>,
    author: Option<String>,
    assigned_class: Option<String>,
    cover_image_base64: Option<String>,
) -> Result<BookEntry, String> {
    let source = std::path::Path::new(&file_path);
    if !source.exists() {
        return Err("File does not exist".to_string());
    }

    let original_filename = source
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let extension = source
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_lowercase();

    let book_type = match extension.as_str() {
        "pdf" => "pdf",
        "epub" => "epub",
        _ => return Err("Unsupported file type. Only PDF and EPUB are allowed.".to_string()),
    };

    // Read the raw file
    let raw_bytes = fs::read(source).await.map_err(|e| e.to_string())?;
    let file_size = raw_bytes.len() as u64;

    // Encrypt
    let encrypted = encrypt_bytes(&raw_bytes)?;

    // Generate unique storage name
    let book_id = Uuid::new_v4().to_string();
    let encrypted_filename = format!("{}.enc", book_id);

    // Ensure the secure_books directory exists
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let secure_dir = books_dir(app_dir);
    let _ = fs::create_dir_all(&secure_dir).await;

    // Write the encrypted file
    let dest = secure_dir.join(&encrypted_filename);
    fs::write(&dest, &encrypted).await.map_err(|e| e.to_string())?;

    let final_title = title.unwrap_or_else(|| {
        original_filename
            .rsplit_once('.')
            .map(|(name, _)| name)
            .unwrap_or(&original_filename)
            .replace(['_', '-'], " ")
    });

    let entry = BookEntry {
        id: book_id,
        title: final_title,
        author,
        assigned_class,
        category: None,
        cover_image_base64,
        book_type: book_type.to_string(),
        original_filename,
        encrypted_filename,
        file_size,
        hidden: false,
    };

    // Update catalog
    let mut catalog = load_catalog(app_dir).await;
    catalog.books.push(entry.clone());
    save_catalog(app_dir, &catalog).await;

    Ok(entry)
}

/// Scan a directory for PDF/EPUB files and import all of them.
#[tauri::command]
pub async fn import_books_from_directory(
    state: tauri::State<'_, crate::state::AppState>,
    dir_path: String,
) -> Result<Vec<BookEntry>, String> {
    let source_dir = std::path::Path::new(&dir_path);
    if !source_dir.is_dir() {
        return Err("Not a valid directory".to_string());
    }

    let mut imported: Vec<BookEntry> = Vec::new();
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let mut catalog = load_catalog(app_dir).await;

    // 1. Pre-index covers for O(1) matching
    let mut covers_map: std::collections::HashMap<String, std::path::PathBuf> = std::collections::HashMap::new();
    let covers_dir = std::path::Path::new("d:\\INVRON LABS\\Projects\\Invron Projects\\Development\\InvronE-lib\\public\\assets\\covers");
    if covers_dir.is_dir() {
        for cover_entry in walkdir::WalkDir::new(covers_dir).max_depth(1).into_iter().filter_map(|e| e.ok()) {
            let cp = cover_entry.path();
            if cp.is_file() {
                if let Some(cf) = cp.file_name() {
                    let cf_str = cf.to_string_lossy();
                    if let Some(dot_idx) = cf_str.find('.') {
                        let prefix = &cf_str[..dot_idx];
                        if prefix.chars().all(|c| c.is_ascii_digit()) {
                            covers_map.insert(prefix.to_string(), cp.to_path_buf());
                        }
                    }
                }
            }
        }
    }

    for entry in walkdir::WalkDir::new(source_dir)
        .max_depth(2) // Allow subfolders if any
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

        if ext == "pdf" || ext == "epub" {
            let mut filename = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
            let original_file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

            // Skip if the user already imported this file previously
            if catalog.books.iter().any(|b| b.original_filename == original_file_name) {
                continue;
            }

            // 1. Remove leading number and dot if present (e.g. "1. Frankenstein")
            let mut prefix_number = None;
            if let Some(idx) = filename.find('.') {
                let prefix = &filename[..idx];
                if prefix.chars().all(|c| c.is_ascii_digit()) {
                    prefix_number = Some(prefix.to_string());
                    filename = filename[idx + 1..].trim().to_string();
                }
            }

            // 2. Extract Author by splitting at " - ", " by ", or just "-"
            let filename_trimmed = filename.trim().to_string();
            let mut title = filename_trimmed.clone();
            let mut author = None;

            if let Some((t, a)) = filename_trimmed.split_once(" - ") {
                title = t.trim().to_string();
                author = Some(a.trim().to_string());
            } else if let Some((t, a)) = filename_trimmed.split_once(" by ") {
                title = t.trim().to_string();
                author = Some(a.trim().to_string());
            } else if let Some((t, a)) = filename_trimmed.split_once('-') {
                title = t.trim().to_string();
                author = Some(a.trim().to_string());
            }

            // 3. Match cover from our pre-built map
            let mut cover_image_base64 = None;
            if let Some(ref num_prefix) = prefix_number {
                if let Some(cover_path) = covers_map.get(num_prefix) {
                    if let Ok(bytes) = std::fs::read(cover_path) {
                        let ext = cover_path.extension().and_then(|e| e.to_str()).unwrap_or("png").to_lowercase();
                        let mime = if ext == "jpg" || ext == "jpeg" { "image/jpeg" } else if ext == "webp" { "image/webp" } else { "image/png" };
                        use base64::{engine::general_purpose, Engine as _};
                        let b64 = general_purpose::STANDARD.encode(&bytes);
                        cover_image_base64 = Some(format!("data:{};base64,{}", mime, b64));
                    }
                }
            }

            // 4. Heuristic Auto-Categorization
            let lower_name = original_file_name.to_lowercase();
            let mut heuristic_class = None;
            for i in 1..=12 {
                if lower_name.contains(&format!("grade {i}")) || lower_name.contains(&format!("class {i}")) {
                    heuristic_class = Some(format!("Grade {i}"));
                    break;
                }
            }
            if heuristic_class.is_none() {
                if lower_name.contains("lkg") { heuristic_class = Some("LKG".to_string()); }
                else if lower_name.contains("ukg") { heuristic_class = Some("UKG".to_string()); }
            }

            // 5. Encrypt and produce entry
            let source_bytes = match fs::read(path).await {
                Ok(b) => b,
                Err(_) => continue,
            };
            let encrypted = match encrypt_bytes(&source_bytes) {
                Ok(e) => e,
                Err(_) => continue,
            };
            
            let book_id = uuid::Uuid::new_v4().to_string();
            let encrypted_filename = format!("{}.enc", book_id);
            let secure_dir = books_dir(app_dir);
            let _ = fs::create_dir_all(&secure_dir).await;
            let dest = secure_dir.join(&encrypted_filename);
            
            if fs::write(&dest, &encrypted).await.is_ok() {
                let entry = BookEntry {
                    id: book_id,
                    title,
                    author,
                    assigned_class: heuristic_class,
                    category: None, // Can be improved later by reading from folder names
                    cover_image_base64,
                    book_type: ext.clone(),
                    original_filename: original_file_name,
                    encrypted_filename,
                    file_size: source_bytes.len() as u64,
                    hidden: false,
                };
                catalog.books.push(entry.clone());
                imported.push(entry);
            }
        }
    }

    if !imported.is_empty() {
        save_catalog(app_dir, &catalog).await;
    }

    Ok(imported)
}

/// Import books natively from an .invronpack file
#[tauri::command]
pub async fn import_invronpack(
    state: tauri::State<'_, crate::state::AppState>,
    file_path: String,
) -> Result<Vec<BookEntry>, String> {
    use std::io::Read;

    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let secure_dir = books_dir(app_dir);
    let _ = tokio::fs::create_dir_all(&secure_dir).await;

    // Use blocking I/O for zip processing since the zip crate is synchronous
    // In a production app with huge packs, this should be spawn_blocking, but this is fine for now
    let file_path_clone = file_path.clone();
    let app_dir_clone = app_dir.to_path_buf();
    
    let (imported, updated_catalog) = tauri::async_runtime::spawn_blocking(move || -> Result<(Vec<BookEntry>, BookCatalog), String> {
        let file = std::fs::File::open(&file_path_clone).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

        // 1. Extract and parse the catalog
        let catalog_json = {
            let mut file = archive.by_name("book_catalog.json").map_err(|_| "book_catalog.json not found in archive")?;
            let mut contents = String::new();
            file.read_to_string(&mut contents).map_err(|e| e.to_string())?;
            contents
        };

        let pack_catalog: BookCatalog = serde_json::from_str(&catalog_json).map_err(|e| e.to_string())?;
        
        let mut current_catalog_json = String::new();
        if let Ok(mut c_file) = std::fs::File::open(app_dir_clone.join("book_catalog.json")) {
            let _ = c_file.read_to_string(&mut current_catalog_json);
        }
        let mut main_catalog: BookCatalog = serde_json::from_str(&current_catalog_json).unwrap_or_default();
        
        let mut imported_books = Vec::new();

        // 2. Process each book in the pack
        for entry in pack_catalog.books {
            // Skip existing
            if main_catalog.books.iter().any(|b| b.id == entry.id || (b.original_filename == entry.original_filename && b.file_size == entry.file_size)) {
                continue;
            }

            let enc_path = format!("secure_books/{}", entry.encrypted_filename);
            let mut zip_file = match archive.by_name(&enc_path) {
                Ok(f) => f,
                Err(_) => continue, // Missing in pack
            };

            let mut buffer = Vec::new();
            if zip_file.read_to_end(&mut buffer).is_ok() {
                // Write encrypted file to secure_books directory
                let dest = secure_dir.join(&entry.encrypted_filename);
                if std::fs::write(&dest, &buffer).is_ok() {
                    main_catalog.books.push(entry.clone());
                    imported_books.push(entry);
                }
            }
        }

        Ok((imported_books, main_catalog))
    }).await.map_err(|e| e.to_string())??;

    if !imported.is_empty() {
        save_catalog(app_dir, &updated_catalog).await;
        crate::audit::log_event(app_dir, "BOOKS_IMPORTED", &format!("Successfully imported {} books from InvronPack.", imported.len()));
    }

    Ok(imported)
}

/// Get just the cover image for a specific book. Bypasses IPC lag.
#[tauri::command]
pub async fn get_book_cover(
    state: tauri::State<'_, crate::state::AppState>,
    book_id: String,
) -> Result<Option<String>, String> {
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let catalog = load_catalog(app_dir).await;

    if let Some(book) = catalog.books.into_iter().find(|b| b.id == book_id) {
        Ok(book.cover_image_base64)
    } else {
        Ok(None)
    }
}

/// Decrypts and extracts an EPUB to a cache directory for high-performance streaming.
#[tauri::command]
pub async fn prepare_epub_streaming(
    state: tauri::State<'_, crate::state::AppState>,
    book_id: String,
) -> Result<String, String> {
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    prepare_epub_streaming_core(app_dir, book_id).await
}

pub async fn prepare_epub_streaming_core(
    app_dir: &std::path::Path,
    book_id: String,
) -> Result<String, String> {
    let secure_dir = books_dir(app_dir);
    let cache_dir = app_dir.join("epub_cache").join(&book_id);

    // 1. If already cached, just return the URL
    if cache_dir.exists() && cache_dir.join(".extracted").exists() {
        return Ok(format!("/epub_content/{}", book_id));
    }

    // 2. Load catalog to find the encrypted filename
    let catalog = load_catalog(app_dir).await;
    let book = catalog.books.iter().find(|b| b.id == book_id)
        .ok_or_else(|| "Book not found".to_string())?;

    let enc_path = secure_dir.join(&book.encrypted_filename);
    let encrypted_bytes = fs::read(&enc_path).await.map_err(|e| e.to_string())?;

    // 3. Decrypt
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    
    if encrypted_bytes.len() < NONCE_SIZE {
        return Err("Corrupt encrypted file".to_string());
    }
    let (nonce_bytes, ciphertext) = encrypted_bytes.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);
    let decrypted_bytes = cipher.decrypt(nonce, ciphertext).map_err(|e| e.to_string())?;

    // 4. Extract into cache
    let cache_dir_clone = cache_dir.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let cursor = std::io::Cursor::new(decrypted_bytes);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
        
        std::fs::create_dir_all(&cache_dir_clone).map_err(|e| e.to_string())?;
        
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
            let outpath = match file.enclosed_name() {
                Some(path) => cache_dir_clone.join(path),
                None => continue,
            };

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = outpath.parent() {
                    if !p.exists() {
                        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                    }
                }
                let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
                std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            }
        }
        
        // Write the cache success marker
        std::fs::write(cache_dir_clone.join(".extracted"), b"ok").map_err(|e| e.to_string())?;
        Ok(())
    }).await.map_err(|e| e.to_string())??;

    Ok(format!("/epub_content/{}", book_id))
}

/// Get the full list of imported books.
#[tauri::command]
pub async fn get_book_catalog(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<BookEntry>, String> {
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let mut catalog = load_catalog(app_dir).await;
    
    // Strip base64 covers to prevent massive IPC lag
    for book in catalog.books.iter_mut() {
        book.cover_image_base64 = None;
    }
    
    Ok(catalog.books)
}

/// Delete a book by ID from the catalog and the encrypted file.
#[tauri::command]
pub async fn delete_book(
    state: tauri::State<'_, crate::state::AppState>,
    book_id: String,
) -> Result<(), String> {
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let mut catalog = load_catalog(app_dir).await;

    let Some(idx) = catalog.books.iter().position(|b| b.id == book_id) else {
        return Err("Book not found".to_string());
    };

    let entry = catalog.books.remove(idx);

    // Delete the encrypted file
    let secure_dir = books_dir(app_dir);
    let encrypted_path = secure_dir.join(&entry.encrypted_filename);
    let _ = fs::remove_file(&encrypted_path).await;

    save_catalog(app_dir, &catalog).await;
    crate::audit::log_event(app_dir, "BOOK_DELETED", &format!("Permanently deleted book: {}", entry.title));
    Ok(())
}

/// Clear the entire catalog and delete all encrypted files.
#[tauri::command]
pub async fn clear_catalog(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    
    // Clear the JSON file
    let empty_catalog = BookCatalog { books: vec![] };
    save_catalog(app_dir, &empty_catalog).await;
    
    // Delete all files in the secure_books directory
    let secure_dir = books_dir(app_dir);
    if let Ok(mut entries) = tokio::fs::read_dir(&secure_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let _ = tokio::fs::remove_file(entry.path()).await;
        }
    }
    
    crate::audit::log_event(app_dir, "CATALOG_CLEARED", "Initiated catastrophic permanent catalog wipe. Destroyed all books from the server.");

    Ok(())
}

/// Update a book's metadata in the catalog.
#[tauri::command]
pub async fn update_book(
    state: tauri::State<'_, crate::state::AppState>,
    book_id: String,
    assigned_class: Option<String>,
    hidden: bool,
) -> Result<BookEntry, String> {
    let app_dir = state.data_file_path.parent().unwrap_or(std::path::Path::new("."));
    let mut catalog = load_catalog(app_dir).await;

    let Some(idx) = catalog.books.iter().position(|b| b.id == book_id) else {
        return Err("Book not found".to_string());
    };

    let entry = &mut catalog.books[idx];
    entry.assigned_class = assigned_class;
    entry.hidden = hidden;

    let updated_entry = entry.clone();
    save_catalog(app_dir, &catalog).await;

    Ok(updated_entry)
}

/// Fetch cloud manifest JSON via Rust reqwest to bypass webview CORS/network restrictions
#[tauri::command]
pub async fn fetch_cloud_manifest(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("InvroLibera/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP request failed with status {}", res.status()));
    }

    let text = res.text().await.map_err(|e| e.to_string())?;
    Ok(text)
}

/// Download cloud pack bytes via Rust reqwest to bypass webview CORS/network restrictions
#[tauri::command]
pub async fn download_cloud_pack(url: String) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("InvroLibera/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP request failed with status {}", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}
