use crate::storage::{self, LicenseState};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

const VALIDATE_URL: &str = "https://your-api-link/validate";

/// When `true`, **no HTTP request** is made — any non-empty key unlocks the app (for local testing).
/// Set to `false` and point `VALIDATE_URL` at your Vercel API before shipping.
const SKIP_REMOTE_LICENSE_VALIDATION: bool = true;

#[derive(Debug, Serialize)]
struct ValidateRequest<'a> {
    key: &'a str,
    machine_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ValidateResponse {
    valid: bool,
    #[serde(default)]
    expires_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LicenseStatusPayload {
    pub licensed: bool,
    pub expires_at: Option<String>,
    pub message: Option<String>,
}

fn parse_expires(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
        .or_else(|| s.parse::<DateTime<Utc>>().ok())
}

#[tauri::command]
pub async fn get_machine_id() -> Result<String, String> {
    machine_uid::get().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_license_status() -> Result<LicenseStatusPayload, String> {
    let key_opt = storage::load_license_key().map_err(|e| e.to_string())?;
    let state_opt = storage::load_license_state().map_err(|e| e.to_string())?;

    let Some(key) = key_opt else {
        return Ok(LicenseStatusPayload {
            licensed: false,
            expires_at: None,
            message: Some("No license key stored.".into()),
        });
    };

    let fp = storage::license_fingerprint(&key);

    if let Some(state) = state_opt {
        if state.license_key_fingerprint != fp {
            return Ok(LicenseStatusPayload {
                licensed: false,
                expires_at: None,
                message: Some("Stored license does not match key.".into()),
            });
        }
        if !state.valid {
            return Ok(LicenseStatusPayload {
                licensed: false,
                expires_at: state.expires_at.map(|d| d.to_rfc3339()),
                message: Some("License marked invalid.".into()),
            });
        }
        if let Some(exp) = state.expires_at {
            if exp < Utc::now() {
                return Ok(LicenseStatusPayload {
                    licensed: false,
                    expires_at: Some(exp.to_rfc3339()),
                    message: Some("License expired.".into()),
                });
            }
            return Ok(LicenseStatusPayload {
                licensed: true,
                expires_at: Some(exp.to_rfc3339()),
                message: None,
            });
        }
        return Ok(LicenseStatusPayload {
            licensed: true,
            expires_at: None,
            message: None,
        });
    }

    Ok(LicenseStatusPayload {
        licensed: false,
        expires_at: None,
        message: Some("Validate your license while online.".into()),
    })
}

fn unlock_locally_without_api(license_key: &str) -> Result<LicenseStatusPayload, String> {
    let trimmed = license_key.trim();
    if trimmed.is_empty() {
        return Err("Enter a license key.".into());
    }
    let expires_at = Utc::now() + Duration::days(365 * 10);
    let state = LicenseState {
        valid: true,
        expires_at: Some(expires_at),
        license_key_fingerprint: storage::license_fingerprint(trimmed),
    };
    storage::save_license_key(trimmed).map_err(|e| e.to_string())?;
    storage::save_license_state(&state).map_err(|e| e.to_string())?;
    Ok(LicenseStatusPayload {
        licensed: true,
        expires_at: Some(expires_at.to_rfc3339()),
        message: Some(
            "Remote validation skipped (SKIP_REMOTE_LICENSE_VALIDATION). Turn it off when Vercel is ready."
                .into(),
        ),
    })
}

#[tauri::command]
pub async fn validate_license(license_key: String) -> Result<LicenseStatusPayload, String> {
    if SKIP_REMOTE_LICENSE_VALIDATION {
        return unlock_locally_without_api(&license_key);
    }

    let machine_id = machine_uid::get().map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;

    let body = ValidateRequest {
        key: &license_key,
        machine_id: machine_id.clone(),
    };

    let res = client
        .post(VALIDATE_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("API error: HTTP {}", res.status()));
    }

    let parsed: ValidateResponse = res.json().await.map_err(|e| e.to_string())?;

    let expires_at = parsed
        .expires_at
        .as_deref()
        .and_then(parse_expires);

    let licensed = if !parsed.valid {
        false
    } else if let Some(exp) = expires_at {
        exp > Utc::now()
    } else {
        // `valid: true` with no (parsable) expiry — treat as non-expiring.
        true
    };

    let state = LicenseState {
        valid: licensed,
        expires_at,
        license_key_fingerprint: storage::license_fingerprint(&license_key),
    };

    storage::save_license_key(&license_key).map_err(|e| e.to_string())?;
    storage::save_license_state(&state).map_err(|e| e.to_string())?;

    Ok(LicenseStatusPayload {
        licensed,
        expires_at: expires_at.map(|d| d.to_rfc3339()),
        message: if licensed {
            None
        } else {
            Some("Server reported invalid or expired license.".into())
        },
    })
}
