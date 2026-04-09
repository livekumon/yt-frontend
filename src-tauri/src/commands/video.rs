use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandEvent, Output};
use tauri_plugin_shell::ShellExt;

fn yt_dlp_cli_failure(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts: Vec<&str> = Vec::new();
    if !stderr.is_empty() {
        parts.push(stderr.as_str());
    }
    if !stdout.is_empty() {
        parts.push(stdout.as_str());
    }
    if parts.is_empty() {
        return "yt-dlp produced no output. Install a real yt-dlp binary: copy the official build next to the app (see src-tauri/binaries/README.md) and rebuild.".into();
    }
    parts.join("\n")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFormatRow {
    pub format_id: String,
    pub ext: String,
    pub resolution_label: String,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    pub filesize_label: String,
    pub vcodec: String,
    pub acodec: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFormatRow {
    pub format_id: String,
    pub ext: String,
    pub label: String,
    pub filesize_label: String,
    pub acodec: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfoPayload {
    pub title: String,
    pub duration_seconds: Option<f64>,
    pub video_formats: Vec<VideoFormatRow>,
    pub audio_formats: Vec<AudioFormatRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgressPayload {
    pub percent: Option<f32>,
    pub line: String,
}

fn ffmpeg_bin_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    exe.parent()
        .map(PathBuf::from)
        .ok_or_else(|| "executable has no parent directory".into())
}

fn format_size(n: Option<u64>) -> String {
    match n {
        None => "—".into(),
        Some(b) if b < 1024 => format!("{b} B"),
        Some(b) if b < 1024 * 1024 => format!("{:.1} KiB", b as f64 / 1024.0),
        Some(b) if b < 1024_u64.pow(3) => format!("{:.1} MiB", b as f64 / 1024_f64.powi(2)),
        Some(b) => format!("{:.2} GiB", b as f64 / 1024_f64.powi(3)),
    }
}

fn pick_video_formats(value: &serde_json::Value) -> Vec<VideoFormatRow> {
    let Some(formats) = value.get("formats").and_then(|f| f.as_array()) else {
        return vec![];
    };

    let mut rows: Vec<VideoFormatRow> = formats
        .iter()
        .filter_map(|f| {
            let format_id = f.get("format_id")?.as_str()?.to_string();
            let ext = f
                .get("ext")
                .and_then(|x| x.as_str())
                .unwrap_or("?")
                .to_string();
            let height = f.get("height").and_then(|x| x.as_u64()).map(|h| h as u32);
            let width = f.get("width").and_then(|x| x.as_u64()).map(|w| w as u32);
            let fps = f
                .get("fps")
                .and_then(|x| x.as_f64())
                .map(|x| x as f32);
            let vcodec = f
                .get("vcodec")
                .and_then(|x| x.as_str())
                .unwrap_or("none")
                .to_string();
            let acodec = f
                .get("acodec")
                .and_then(|x| x.as_str())
                .unwrap_or("none")
                .to_string();

            if vcodec == "none" {
                return None;
            }

            let filesize = f
                .get("filesize")
                .and_then(|x| x.as_u64())
                .or_else(|| f.get("filesize_approx").and_then(|x| x.as_u64()));

            let resolution_label = match (width, height) {
                (_, Some(h)) if h >= 2160 => format!("{h}p (4K)"),
                (_, Some(h)) if h >= 1440 => format!("{h}p (1440p)"),
                (_, Some(h)) if h >= 1080 => format!("{h}p (1080p)"),
                (_, Some(h)) if h >= 720 => format!("{h}p (720p)"),
                (_, Some(h)) => format!("{h}p"),
                _ => "unknown".into(),
            };

            let note = if acodec != "none" {
                "includes audio".into()
            } else {
                "video only".into()
            };

            Some(VideoFormatRow {
                format_id,
                ext,
                resolution_label,
                height,
                fps,
                filesize_label: format_size(filesize),
                vcodec,
                acodec,
                note,
            })
        })
        .collect();

    rows.sort_by(|a, b| {
        b.height
            .unwrap_or(0)
            .cmp(&a.height.unwrap_or(0))
            .then_with(|| b.fps.unwrap_or(0.0).partial_cmp(&a.fps.unwrap_or(0.0)).unwrap())
    });

    rows.dedup_by(|a, b| a.format_id == b.format_id);
    rows
}

fn pick_audio_formats(value: &serde_json::Value) -> Vec<AudioFormatRow> {
    let Some(formats) = value.get("formats").and_then(|f| f.as_array()) else {
        return vec![];
    };

    let mut rows: Vec<(AudioFormatRow, f64)> = formats
        .iter()
        .filter_map(|f| {
            let format_id = f.get("format_id")?.as_str()?.to_string();
            let ext = f
                .get("ext")
                .and_then(|x| x.as_str())
                .unwrap_or("?")
                .to_string();
            let vcodec = f
                .get("vcodec")
                .and_then(|x| x.as_str())
                .unwrap_or("none")
                .to_string();
            let acodec = f
                .get("acodec")
                .and_then(|x| x.as_str())
                .unwrap_or("none")
                .to_string();

            if vcodec != "none" || acodec == "none" {
                return None;
            }

            let abr = f
                .get("abr")
                .and_then(|x| x.as_f64())
                .or_else(|| f.get("tbr").and_then(|x| x.as_f64()));

            let filesize = f
                .get("filesize")
                .and_then(|x| x.as_u64())
                .or_else(|| f.get("filesize_approx").and_then(|x| x.as_u64()));

            let br_label = abr.map(|a| format!("{:.0} kbps", a)).unwrap_or_else(|| "? kbps".into());

            let label = format!("{br_label} · {acodec}");

            Some((
                AudioFormatRow {
                    format_id,
                    ext,
                    label,
                    filesize_label: format_size(filesize),
                    acodec,
                },
                abr.unwrap_or(0.0),
            ))
        })
        .collect::<Vec<_>>();

    rows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let mut out: Vec<AudioFormatRow> = rows.into_iter().map(|(r, _)| r).collect();
    out.dedup_by(|a, b| a.format_id == b.format_id);
    out
}

fn capture_path_from_ytdlp_log(lines: &[String]) -> Option<PathBuf> {
    let merger = Regex::new(r#"(?i)\[Merger\][^\n]*?into\s+[\"']([^\"']+)[\"']"#).ok()?;
    let destination = Regex::new(r#"(?i)\[download\][^\n]*?Destination:\s*(.+)$"#).ok()?;
    let extract_dest = Regex::new(r#"(?i)\[ExtractAudio\][^\n]*?Destination:\s*(.+)$"#).ok()?;
    for line in lines.iter().rev() {
        if let Some(c) = merger.captures(line) {
            if let Some(p) = c.get(1) {
                return Some(PathBuf::from(p.as_str()));
            }
        }
        if let Some(c) = destination.captures(line) {
            if let Some(p) = c.get(1) {
                return Some(PathBuf::from(p.as_str().trim()));
            }
        }
        if let Some(c) = extract_dest.captures(line) {
            if let Some(p) = c.get(1) {
                return Some(PathBuf::from(p.as_str().trim()));
            }
        }
    }
    None
}

fn newest_media_in_dir(dir: &Path) -> Option<PathBuf> {
    const EXTS: &[&str] = &[
        "mp4", "webm", "mkv", "m4a", "opus", "mp3", "aac", "flac", "wav",
    ];
    fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let ext = path.extension()?.to_str()?.to_lowercase();
            if !EXTS.contains(&ext.as_str()) {
                return None;
            }
            let modified = meta.modified().ok()?;
            Some((path, modified))
        })
        .max_by_key(|(_, t)| *t)
        .map(|(p, _)| p)
}

#[tauri::command]
pub async fn get_video_info(app: AppHandle, url: String) -> Result<VideoInfoPayload, String> {
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args(["--dump-json", "--no-playlist", "--skip-download", &url])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "yt-dlp exited with code {:?}:\n{}",
            output.status.code(),
            yt_dlp_cli_failure(&output)
        ));
    }

    let json_str = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value =
        serde_json::from_str(&json_str).map_err(|e| format!("invalid JSON: {e}"))?;

    let title = value
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("Unknown title")
        .to_string();

    let duration_seconds = value.get("duration").and_then(|d| d.as_f64());

    let video_formats = pick_video_formats(&value);
    let audio_formats = pick_audio_formats(&value);

    Ok(VideoInfoPayload {
        title,
        duration_seconds,
        video_formats,
        audio_formats,
    })
}

#[tauri::command]
pub async fn download_video(
    app: AppHandle,
    url: String,
    output_dir: String,
    video_format_id: Option<String>,
    audio_format_id: Option<String>,
) -> Result<String, String> {
    let v = video_format_id
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());
    let a = audio_format_id
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty());

    if v.is_none() && a.is_none() {
        return Err("Select at least a video format and/or an audio format.".into());
    }

    let ffmpeg_dir = ffmpeg_bin_dir()?;
    let ffmpeg_dir_str = ffmpeg_dir.to_string_lossy().into_owned();

    let output_template = format!("{}/%(title)s [%(id)s].%(ext)s", output_dir.trim_end_matches('/'));

    let format_arg = match (v, a) {
        (Some(vid), None) => vid.to_string(),
        (None, Some(aid)) => aid.to_string(),
        (Some(vid), Some(aid)) => format!("{vid}+{aid}"),
        (None, None) => unreachable!(),
    };

    let mut args: Vec<String> = vec![
        "-f".into(),
        format_arg,
        "--ffmpeg-location".into(),
        ffmpeg_dir_str,
        "--newline".into(),
        "--progress".into(),
        "--no-playlist".into(),
        "-o".into(),
        output_template,
    ];

    if v.is_some() && a.is_some() {
        args.splice(
            2..2,
            vec!["--merge-output-format".to_string(), "mp4".to_string()],
        );
    }

    args.push(url);

    let (mut rx, _child) = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| e.to_string())?
        .args(args.iter().map(|s| s.as_str()))
        .spawn()
        .map_err(|e| e.to_string())?;

    let progress_re = Regex::new(r"(?i)\[download\]\s+(\d+(?:\.\d+)?)%").map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let mut ytdlp_log: Vec<String> = Vec::new();

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) | CommandEvent::Stdout(line) => {
                let line_str = String::from_utf8_lossy(&line).trim().to_string();
                if line_str.is_empty() {
                    continue;
                }
                if ytdlp_log.len() < 120 {
                    ytdlp_log.push(line_str.clone());
                }
                let pct = progress_re
                    .captures(&line_str)
                    .and_then(|c| c.get(1))
                    .and_then(|m| m.as_str().parse::<f32>().ok());
                let _ = app_handle.emit(
                    "download-progress",
                    DownloadProgressPayload {
                        percent: pct,
                        line: line_str.clone(),
                    },
                );
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let tail = ytdlp_log.join("\n");
                    return Err(if tail.is_empty() {
                        format!(
                            "yt-dlp failed (code {:?}). Ensure yt-dlp and ffmpeg are bundled next to the app (see src-tauri/binaries/README.md).",
                            payload.code
                        )
                    } else {
                        format!("yt-dlp failed (code {:?}):\n{}", payload.code, tail)
                    });
                }
                let _ = app_handle.emit(
                    "download-progress",
                    DownloadProgressPayload {
                        percent: Some(100.0),
                        line: "[done]".into(),
                    },
                );

                let out_dir = PathBuf::from(output_dir.trim());
                let from_log = capture_path_from_ytdlp_log(&ytdlp_log);
                let path = from_log
                    .filter(|p| p.exists())
                    .or_else(|| newest_media_in_dir(&out_dir))
                    .ok_or_else(|| {
                        String::from("Download finished but the output file could not be detected.")
                    })?;

                return Ok(path.to_string_lossy().into_owned());
            }
            CommandEvent::Error(e) => return Err(e),
            _ => {}
        }
    }

    Err("yt-dlp ended unexpectedly.".into())
}
