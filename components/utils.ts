import { IMG_DIM, IMG_Q, AV_DIM, AV_Q, PER_KEY_LIMIT } from "./types";
import type { Profile, ImageItem } from "./types";

// ── Formatting ──────────────────────────────────────────────────────────────

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(2)}MB`;
}

export function calcBytes(p: Profile): number {
  try {
    return new Blob([JSON.stringify(p)]).size;
  } catch {
    return 0;
  }
}

// ── Image Processing ────────────────────────────────────────────────────────

export async function compressImg(
  src: string,
  dim = IMG_DIM,
  q = IMG_Q
): Promise<string> {
  return new Promise((res) => {
    const i = new Image();
    i.onerror = () => res(src);
    i.onload = () => {
      let w = i.naturalWidth;
      let h = i.naturalHeight;
      if (w > dim || h > dim) {
        if (w > h) {
          h = Math.round((h * dim) / w);
          w = dim;
        } else {
          w = Math.round((w * dim) / h);
          h = dim;
        }
      }
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d")!.drawImage(i, 0, 0, w, h);
      res(c.toDataURL("image/jpeg", q));
    };
    i.src = src;
  });
}

export function loadImg(
  src: string
): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

export async function readFile(file: File): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = (ev) => res(ev.target!.result as string);
    r.readAsDataURL(file);
  });
}

export async function readAndCompress(
  file: File,
  dim = IMG_DIM,
  q = IMG_Q
): Promise<string> {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = async (ev) => {
      res(await compressImg(ev.target!.result as string, dim, q));
    };
    r.readAsDataURL(file);
  });
}

// ── Profile Factory ─────────────────────────────────────────────────────────

export function emptyProfile(name = "New Profile"): Profile {
  return {
    id: Date.now().toString(),
    name,
    info: {
      username: "yourusername",
      name: "Your Name",
      bio: "✦ Your bio here",
      link: "",
      followers: "1,240",
      following: "420",
      avatar: null,
    },
    highlights: [
      { id: 1, label: "BTS", img: null },
      { id: 2, label: "COLLAB", img: null },
      { id: 3, label: "BRAND", img: null },
    ],
    images: [],
    library: [],
    captions: {},
    schedule: {},
    queue: [],
    clientInfo: {
      niche: "",
      audience: "",
      tone: "",
      pillars: "",
      competitors: "",
      notes: "",
    },
  };
}

export function isFileDrag(e: React.DragEvent): boolean {
  return e.dataTransfer?.types?.includes("Files") ?? false;
}

export function genId(): string {
  return Date.now() + Math.random() + "";
}
