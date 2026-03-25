// ── Shared Types & Constants ────────────────────────────────────────────────

export interface HighlightItem {
  id: number;
  label: string;
  img: string | null;
}

export interface ImageItem {
  id: string;
  src: string;
}

export interface CaptionData {
  context?: string;
  generated?: { label: string; text: string }[];
  approved?: string;
}

export interface ClientInfo {
  niche: string;
  audience: string;
  tone: string;
  pillars: string;
  competitors: string;
  notes: string;
}

export interface Profile {
  id: string;
  name: string;
  info: {
    username: string;
    name: string;
    bio: string;
    link: string;
    followers: string;
    following: string;
    avatar: string | null;
  };
  highlights: HighlightItem[];
  images: ImageItem[];
  library: ImageItem[];
  captions: Record<string, CaptionData>;
  schedule: Record<string, { postDate: string }>;
  queue: string[];
  clientInfo: ClientInfo;
}

// ── Constants ───────────────────────────────────────────────────────────────

export const PINK = "#ff2d78";
export const RATIO_PAD: Record<number, string> = {
  0: "125%",
  1: "177.78%",
  2: "125%",
};

export const IMG_DIM = 800;
export const IMG_Q = 0.68;
export const AV_DIM = 300;
export const AV_Q = 0.80;
export const HL_DIM = 200;
export const HL_Q = 0.78;

export const PER_KEY_LIMIT = 5 * 1024 * 1024;
export const WARN_AT = 0.60;
export const DANGER_AT = 0.82;

// ── Shared Styles ───────────────────────────────────────────────────────────

export const SECTION_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#aaa",
  letterSpacing: 2,
  textTransform: "uppercase",
  fontFamily: "sans-serif",
};

export const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "#f8f8f8",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  fontSize: 12,
  fontFamily: "sans-serif",
  outline: "none",
  color: "#000",
};

export const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#aaa",
  letterSpacing: 2,
  textTransform: "uppercase",
  fontFamily: "sans-serif",
  marginBottom: 5,
  display: "block",
};
