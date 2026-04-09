# Sidecar binaries (`yt-dlp` + `ffmpeg`)

Tauri expects platform-specific filenames next to the built app. Place **or symlink** binaries here before `cargo tauri build` or `cargo tauri dev`.

## Expected names (Tauri copies from `externalBin`)

After `cargo tauri build`, Tauri renames artifacts. For **development**, copy binaries into `src-tauri/target/debug/` with these basenames (same folder as the app executable):

| Platform | yt-dlp | ffmpeg |
|----------|--------|--------|
| **macOS** | `yt-dlp` | `ffmpeg` |
| **Windows** | `yt-dlp.exe` | `ffmpeg.exe` |

Official builds:

- [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases)
- [FFmpeg builds](https://ffmpeg.org/download.html) (or [gyan.dev Windows builds](https://www.gyan.dev/ffmpeg/builds/))

## Automated fetch (example)

```bash
# macOS (Homebrew) — symlink into target after first dev build
brew install yt-dlp ffmpeg
ln -sf "$(which yt-dlp)" "src-tauri/target/debug/yt-dlp"
ln -sf "$(which ffmpeg)" "src-tauri/target/debug/ffmpeg"
```

On Windows, download static builds and rename to `yt-dlp.exe` and `ffmpeg.exe` beside `youtube-downloader.exe`.
