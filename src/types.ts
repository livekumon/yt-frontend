export type LicenseStatus = {
  licensed: boolean;
  expiresAt: string | null;
  message: string | null;
};

export type VideoFormatRow = {
  formatId: string;
  ext: string;
  resolutionLabel: string;
  height: number | null;
  fps: number | null;
  filesizeLabel: string;
  vcodec: string;
  acodec: string;
  note: string;
};

export type AudioFormatRow = {
  formatId: string;
  ext: string;
  label: string;
  filesizeLabel: string;
  acodec: string;
};

export type VideoInfo = {
  title: string;
  durationSeconds: number | null;
  videoFormats: VideoFormatRow[];
  audioFormats: AudioFormatRow[];
};

export type DownloadProgress = {
  percent: number | null;
  line: string;
};

export const OUTPUT_DIR_STORAGE_KEY = "ytdl-output-dir";
