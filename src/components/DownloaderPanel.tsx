import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioFormatRow,
  DownloadProgress,
  VideoFormatRow,
  VideoInfo,
} from "../types";
import { OUTPUT_DIR_STORAGE_KEY } from "../types";

type Props = {
  email: string;
  publishingCredits: number;
};

function looksLikeUrl(s: string): boolean {
  return /^https?:\/\/.+/i.test(s.trim());
}

export function DownloaderPanel({ email, publishingCredits }: Props) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [videoFormats, setVideoFormats] = useState<VideoFormatRow[]>([]);
  const [audioFormats, setAudioFormats] = useState<AudioFormatRow[]>([]);
  const [videoId, setVideoId] = useState("");
  const [audioId, setAudioId] = useState("");
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [logLine, setLogLine] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [lastFilePath, setLastFilePath] = useState<string | null>(null);
  const fetchGen = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(OUTPUT_DIR_STORAGE_KEY);
      if (saved) {
        setOutputDir(saved);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const u = url.trim();
    if (!looksLikeUrl(u)) {
      fetchGen.current += 1;
      setInfo(null);
      setVideoFormats([]);
      setAudioFormats([]);
      setVideoId("");
      setAudioId("");
      setFetching(false);
      return;
    }

    const id = ++fetchGen.current;
    setFetching(true);
    setErr(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await invoke<VideoInfo>("get_video_info", { url: u });
          if (id !== fetchGen.current) {
            return;
          }
          setInfo(data);
          setVideoFormats(data.videoFormats);
          setAudioFormats(data.audioFormats);
          setVideoId(data.videoFormats[0]?.formatId ?? "");
          setAudioId(data.audioFormats[0]?.formatId ?? "");
        } catch (e) {
          if (id !== fetchGen.current) {
            return;
          }
          setErr(String(e));
          setInfo(null);
          setVideoFormats([]);
          setAudioFormats([]);
          setVideoId("");
          setAudioId("");
        } finally {
          if (id === fetchGen.current) {
            setFetching(false);
          }
        }
      })();
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [url]);

  const pickFolder = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") {
      setOutputDir(dir);
      try {
        localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, dir);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<DownloadProgress>("download-progress", (ev) => {
      const p = ev.payload;
      if (typeof p.percent === "number") {
        setProgress(Math.min(100, Math.max(0, p.percent)));
      }
      setLogLine(p.line);
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const download = useCallback(async () => {
    setErr(null);
    const u = url.trim();
    const v = videoId.trim() || null;
    const a = audioId.trim() || null;
    if (!u) {
      setErr("Enter a video URL.");
      return;
    }
    if (!v && !a) {
      setErr("Select a video format and/or an audio format.");
      return;
    }
    if (!outputDir) {
      setErr("Choose an output folder.");
      return;
    }
    setDownloading(true);
    setProgress(0);
    setLogLine("");
    try {
      const path = await invoke<string>("download_video", {
        url: u,
        outputDir,
        videoFormatId: v,
        audioFormatId: a,
      });
      setProgress(100);
      setLastFilePath(path);
    } catch (e) {
      setErr(String(e));
    } finally {
      setDownloading(false);
    }
  }, [url, videoId, audioId, outputDir]);

  const playLast = useCallback(async () => {
    if (!lastFilePath) {
      return;
    }
    try {
      await openPath(lastFilePath);
    } catch (e) {
      setErr(String(e));
    }
  }, [lastFilePath]);

  const busy = fetching || downloading;
  const canDownload =
    !!info &&
    !!outputDir &&
    (!!videoId.trim() || !!audioId.trim()) &&
    !busy;

  return (
    <div className="downloader">
      <header className="downloader-header">
        <div>
          <h1 className="downloader-title">Download</h1>
          <p className="license-expiry">
            Signed in as {email} · {publishingCredits} download credit
            {publishingCredits !== 1 ? "s" : ""} remaining
          </p>
        </div>
      </header>

      <section className="panel-section">
        <label className="field-label" htmlFor="url-input">
          Video URL
        </label>
        <div className="url-field-wrap">
          <input
            id="url-input"
            type="url"
            placeholder="Paste a YouTube URL — formats load automatically"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          {fetching ? (
            <div className="fetch-status" aria-live="polite">
              <span className="spinner" aria-hidden />
              <span>Fetching formats…</span>
            </div>
          ) : null}
        </div>
      </section>

      {info && !fetching ? (
        <section className="panel-section">
          <h2 className="video-title">{info.title}</h2>
          {info.durationSeconds != null ? (
            <p className="duration-hint">
              Duration{" "}
              {`${Math.floor(info.durationSeconds / 60)}:${String(
                Math.floor(info.durationSeconds % 60),
              ).padStart(2, "0")}`}
            </p>
          ) : null}

          <label className="field-label" htmlFor="video-format-select">
            Video
          </label>
          <select
            id="video-format-select"
            className="format-select"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            disabled={busy || videoFormats.length === 0}
          >
            <option value="">No video</option>
            {videoFormats.map((f) => (
              <option key={f.formatId} value={f.formatId}>
                {f.resolutionLabel} · {f.ext.toUpperCase()} · {f.filesizeLabel}{" "}
                · {f.note}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor="audio-format-select">
            Audio
          </label>
          <select
            id="audio-format-select"
            className="format-select"
            value={audioId}
            onChange={(e) => setAudioId(e.target.value)}
            disabled={busy || audioFormats.length === 0}
          >
            <option value="">No audio</option>
            {audioFormats.map((f) => (
              <option key={f.formatId} value={f.formatId}>
                {f.label} · {f.ext.toUpperCase()} · {f.filesizeLabel}
              </option>
            ))}
          </select>
          <p className="format-hint">
            Choose video only, audio only, or both (merged to MP4 when both are
            selected).
          </p>
        </section>
      ) : null}

      <section className="panel-section">
        <label className="field-label">Output folder</label>
        <div className="field-row">
          <input
            readOnly
            placeholder="No folder selected"
            value={outputDir ?? ""}
          />
          <button
            type="button"
            onClick={() => void pickFolder()}
            disabled={busy}
          >
            Browse…
          </button>
        </div>
      </section>

      <section className="panel-section">
        <div className="progress-wrap">
          <div
            className="progress-bar"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="progress-line">{logLine}</p>
        </div>
        <div className="download-actions">
          <button
            type="button"
            className="download-btn"
            onClick={() => void download()}
            disabled={!canDownload}
          >
            {downloading ? "Downloading…" : "Download"}
          </button>
          <button
            type="button"
            className="play-btn"
            onClick={() => void playLast()}
            disabled={!lastFilePath || downloading}
          >
            Play last download
          </button>
        </div>
        {lastFilePath ? (
          <p className="last-file-path" title={lastFilePath}>
            Saved: {lastFilePath}
          </p>
        ) : null}
      </section>

      {err ? (
        <p className="panel-error" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
