//! Secure local persistence: OS keychain first, AES-GCM encrypted file fallback.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::aead::rand_core::RngCore;
use rand::rngs::OsRng;
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "com.ram.youtube-downloader";
const KEYRING_USER_LICENSE: &str = "license_key";
const KEYRING_USER_STATE: &str = "license_state_v1";
const APP_PEPPER: &[u8] = b"ytdl-license-v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseState {
    pub valid: bool,
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    pub license_key_fingerprint: String,
}

fn machine_material() -> Vec<u8> {
    machine_uid::get()
        .unwrap_or_else(|_| "unknown-machine".into())
        .into_bytes()
}

fn derived_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(APP_PEPPER);
    hasher.update(&machine_material());
    hasher.finalize().into()
}

fn encrypted_store_path() -> Result<PathBuf> {
    let dir = dirs::data_local_dir()
        .context("no data_local_dir")?
        .join("YouTubeDownloader");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("license.enc"))
}

fn encrypt_json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let key = derived_key();
    let cipher = Aes256Gcm::new_from_slice(&key).context("aes key")?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plain = serde_json::to_vec(value)?;
    let mut ct = cipher
        .encrypt(nonce, plain.as_ref())
        .map_err(|e| anyhow::anyhow!("encrypt: {e}"))?;
    let mut out = Vec::with_capacity(12 + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.append(&mut ct);
    Ok(out)
}

fn decrypt_json<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T> {
    if bytes.len() < 13 {
        anyhow::bail!("truncated blob");
    }
    let (nonce, ct) = bytes.split_at(12);
    let key = derived_key();
    let cipher = Aes256Gcm::new_from_slice(&key).context("aes key")?;
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|e| anyhow::anyhow!("decrypt: {e}"))?;
    Ok(serde_json::from_slice(&plain)?)
}

pub fn save_license_key(key: &str) -> Result<()> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_LICENSE) {
        if entry.set_password(key).is_ok() {
            return Ok(());
        }
    }
    let path = encrypted_store_path()?;
    let wrapper = serde_json::json!({ "k": key });
    let bytes = encrypt_json(&wrapper)?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

pub fn load_license_key() -> Result<Option<String>> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_LICENSE) {
        if let Ok(s) = entry.get_password() {
            return Ok(Some(s));
        }
    }
    let path = encrypted_store_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    let v: serde_json::Value = decrypt_json(&bytes)?;
    Ok(v.get("k").and_then(|x| x.as_str()).map(String::from))
}

pub fn save_license_state(state: &LicenseState) -> Result<()> {
    let json = serde_json::to_string(state)?;
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_STATE) {
        if entry.set_password(&json).is_ok() {
            return Ok(());
        }
    }
    let path = encrypted_store_path()?.with_file_name("state.enc");
    let bytes = encrypt_json(state)?;
    std::fs::write(&path, bytes)?;
    Ok(())
}

pub fn load_license_state() -> Result<Option<LicenseState>> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER_STATE) {
        if let Ok(s) = entry.get_password() {
            return Ok(serde_json::from_str(&s).ok());
        }
    }
    let path = encrypted_store_path()?.with_file_name("state.enc");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path)?;
    Ok(decrypt_json(&bytes).ok())
}

pub fn license_fingerprint(key: &str) -> String {
    let mut h = Sha256::new();
    h.update(key.as_bytes());
    hex::encode(h.finalize())
}
