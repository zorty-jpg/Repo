"use client";
import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  Suspense,
} from "react";
import { supabase } from "@/lib/supabase";
import { LoadingBubble } from "@/components/ui/loading-bubble";
import { TypingEffect } from "@/components/ui/typing-effect";

// ── Imported types & constants ──────────────────────────────────────────────
import type {
  Profile,
  ImageItem,
  HighlightItem,
  CaptionData,
  ClientInfo,
} from "./types";
import {
  PINK,
  RATIO_PAD,
  IMG_DIM,
  IMG_Q,
  AV_DIM,
  AV_Q,
  HL_DIM,
  HL_Q,
  PER_KEY_LIMIT,
  WARN_AT,
  DANGER_AT,
  SECTION_LABEL,
  INPUT_STYLE,
  LABEL_STYLE,
} from "./types";

// ── Imported utilities ──────────────────────────────────────────────────────
import {
  fmtBytes,
  calcBytes,
  compressImg,
  loadImg,
  readFile,
  readAndCompress,
  emptyProfile,
  isFileDrag,
  genId,
} from "./utils";

// ── Imported DB operations ──────────────────────────────────────────────────
import {
  loadIndex,
  saveIndex,
  loadProfile,
  saveProfile,
  deleteStoredProfile,
  loadActiveId,
  saveActiveId,
  migrateIfNeeded,
} from "./db";

// ── Lazy-loaded modals ──────────────────────────────────────────────────────
import type { RectSel } from "./modals/CropModal";

const CircularCropModal = React.lazy(
  () => import("./modals/CircularCropModal")
);
const CropModal = React.lazy(() => import("./modals/CropModal"));
const PreviewModal = React.lazy(() => import("./modals/PreviewModal"));

// ── Markdown renderer for AI messages ────────────────────────────────────────

function renderAiText(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  const renderInline = (line: string, key: string): React.ReactNode => {
    // Bold: **text**
    const parts: React.ReactNode[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let lastIdx = 0;
    let match;
    let k = 0;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIdx) {
        parts.push(line.slice(lastIdx, match.index));
      }
      parts.push(
        <strong key={`${key}-b${k++}`} style={{ fontWeight: 600, color: "#000" }}>
          {match[1]}
        </strong>
      );
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < line.length) parts.push(line.slice(lastIdx));
    if (!parts.length) return null;
    return <span key={key}>{parts}</span>;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Empty line → small spacer
    if (!line) {
      elements.push(<div key={`s${i}`} style={{ height: 6 }} />);
      i++;
      continue;
    }

    // Bullet point (•, -, *, numbered)
    const bulletMatch = line.match(/^(?:[•\-\*]|\d+[\.\)])\s+(.*)/);
    if (bulletMatch) {
      const bulletItems: React.ReactNode[] = [];
      while (i < lines.length) {
        const bl = lines[i].trim();
        const bm = bl.match(/^(?:[•\-\*]|\d+[\.\)])\s+(.*)/);
        if (!bm) break;
        bulletItems.push(
          <div key={`li${i}`} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "2px 0" }}>
            <span style={{ color: "#999", fontSize: 8, marginTop: 4, flexShrink: 0 }}>●</span>
            <span>{renderInline(bm[1], `lit${i}`)}</span>
          </div>
        );
        i++;
      }
      elements.push(
        <div key={`ul${i}`} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "2px 0 2px 4px" }}>
          {bulletItems}
        </div>
      );
      continue;
    }

    // Bold-only line = section title
    const titleMatch = line.match(/^\*\*(.+?)\*\*$/);
    if (titleMatch) {
      elements.push(
        <div key={`h${i}`} style={{ fontWeight: 600, fontSize: 12, color: "#000", padding: "4px 0 1px", letterSpacing: 0.2 }}>
          {titleMatch[1]}
        </div>
      );
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      <div key={`p${i}`} style={{ padding: "1px 0" }}>
        {renderInline(line, `pl${i}`)}
      </div>
    );
    i++;
  }

  return <>{elements}</>;
}

// ── Sub-components ──────────────────────────────────────────────────────────

const InlineText = React.memo(function InlineText({
  value,
  onChange,
  style = {},
  multiline = false,
  placeholder = "",
}: {
  value: string;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [ed, setEd] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (ed) ref.current?.focus();
  }, [ed]);

  const commit = () => {
    setEd(false);
    onChange(v);
  };

  if (ed) {
    const Tag = multiline ? "textarea" : "input";
    return (
      <Tag
        ref={ref}
        value={v}
        onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) =>
          setV(e.target.value)
        }
        onBlur={commit}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (!multiline && e.key === "Enter") commit();
        }}
        rows={multiline ? 3 : undefined}
        placeholder={placeholder}
        style={{
          fontFamily: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
          color: "inherit",
          background: "transparent",
          border: "none",
          outline: "none",
          width: "100%",
          resize: "none" as const,
          lineHeight: "inherit",
          padding: 0,
          margin: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <span
      onClick={() => setEd(true)}
      style={{ cursor: "default", display: "inline", ...style }}
    >
      {value || <span style={{ color: "#bbb" }}>{placeholder}</span>}
    </span>
  );
});

const StatBlock = React.memo(function StatBlock({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [ed, setEd] = useState(false);
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (ed) ref.current?.focus();
  }, [ed]);

  const commit = () => {
    setEd(false);
    onChange(v);
  };

  return (
    <div
      style={{ textAlign: "center", cursor: "default" }}
      onClick={() => setEd(true)}
    >
      {ed ? (
        <input
          ref={ref}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          style={{
            width: 60,
            textAlign: "center",
            fontWeight: 700,
            fontSize: 15,
            fontFamily: "sans-serif",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: 0,
          }}
        />
      ) : (
        <div style={{ fontWeight: 700, fontSize: 15, fontFamily: "sans-serif" }}>
          {value}
        </div>
      )}
      <div style={{ fontSize: 12, color: "#777", fontFamily: "sans-serif" }}>
        {label}
      </div>
    </div>
  );
});

const Highlight = React.memo(function Highlight({
  h,
  onChange,
  onDelete,
}: {
  h: HighlightItem;
  onChange: (h: HighlightItem) => void;
  onDelete: () => void;
}) {
  const [edL, setEdL] = useState(false);
  const [label, setLabel] = useState(h.label);
  const [hov, setHov] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const lRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (edL) lRef.current?.focus();
  }, [edL]);

  const commitL = () => {
    setEdL(false);
    onChange({ ...h, label });
  };

  const pickImg = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const src = await readAndCompress(f, HL_DIM, HL_Q);
    onChange({ ...h, img: src });
    e.target.value = "";
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        flexShrink: 0,
        position: "relative",
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div
        onClick={() => imgRef.current?.click()}
        style={{
          width: 54,
          height: 54,
          borderRadius: "50%",
          cursor: "default",
          background: h.img ? `url(${h.img}) center/cover` : "#f0f0f0",
          border: "1px solid #ddd",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: h.img ? 0 : 11,
          color: "#999",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        {!h.img && h.label[0]}
      </div>

      {hov && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#000",
            border: "none",
            color: "#fff",
            fontSize: 9,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}

      <input
        ref={imgRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={pickImg}
      />

      {edL ? (
        <input
          ref={lRef}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitL}
          onKeyDown={(e) => e.key === "Enter" && commitL()}
          style={{
            fontSize: 10,
            color: "#555",
            fontFamily: "sans-serif",
            textAlign: "center",
            border: "none",
            outline: "none",
            background: "transparent",
            width: 50,
            padding: 0,
          }}
        />
      ) : (
        <span
          onClick={() => setEdL(true)}
          style={{
            fontSize: 10,
            color: "#555",
            fontFamily: "sans-serif",
            cursor: "default",
          }}
        >
          {h.label}
        </span>
      )}
    </div>
  );
});

const CircleBtn = React.memo(function CircleBtn({
  icon,
  label,
  active,
  onClick,
  warn,
  badge,
  dim = 42,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  warn?: boolean;
  badge?: number;
  dim?: number;
}) {
  const [hov, setHov] = useState(false);

  return (
    <div
      style={{ position: "relative", flexShrink: 0 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <button
        onClick={onClick}
        style={{
          width: dim,
          height: dim,
          borderRadius: "50%",
          background: active ? "#000" : hov ? "#f0f0f0" : "#fff",
          border: `1.5px solid ${warn ? PINK : active ? "#000" : "#ddd"}`,
          cursor: "pointer",
          fontSize: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: active ? "#fff" : warn ? PINK : "#555",
          boxShadow: active
            ? "0 4px 16px rgba(0,0,0,0.2)"
            : "0 2px 8px rgba(0,0,0,0.06)",
          transition: "all .15s",
          position: "relative",
          flexShrink: 0,
        }}
      >
        {icon}
        {(badge ?? 0) > 0 && !active && (
          <div
            style={{
              position: "absolute",
              top: -3,
              right: -3,
              width: 15,
              height: 15,
              borderRadius: "50%",
              background: "#000",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              color: "#fff",
              fontFamily: "sans-serif",
              fontWeight: 700,
            }}
          >
            {(badge ?? 0) > 9 ? "9+" : badge}
          </div>
        )}
        {warn && !active && (
          <div
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: PINK,
              border: "2px solid #ebebeb",
            }}
          />
        )}
      </button>

      {hov && (
        <div
          style={{
            position: "absolute",
            right: "calc(100% + 8px)",
            top: "50%",
            transform: "translateY(-50%)",
            background: "rgba(0,0,0,0.82)",
            color: "#fff",
            fontSize: 9,
            fontFamily: "sans-serif",
            fontWeight: 700,
            padding: "4px 8px",
            borderRadius: 5,
            whiteSpace: "nowrap",
            zIndex: 300,
            letterSpacing: 1,
            textTransform: "uppercase",
            pointerEvents: "none",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
});

const GridTile = React.memo(function GridTile({
  img,
  idx,
  ratioPad,
  dragIdx,
  overIdx,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSwap,
  onRemove,
  queuePos,
  hasCaption,
  onCaption,
}: {
  img: ImageItem;
  idx: number;
  ratioPad: string;
  dragIdx: number | null;
  overIdx: number | null;
  onDragStart: (e: React.DragEvent, i: number) => void;
  onDragOver: (e: React.DragEvent, i: number) => void;
  onDrop: (e: React.DragEvent, i: number) => void;
  onDragEnd: () => void;
  onSwap: () => void;
  onRemove: () => void;
  queuePos: number | null;
  hasCaption: boolean;
  onCaption: () => void;
}) {
  const [hov, setHov] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, idx)}
      onDragOver={(e) => onDragOver(e, idx)}
      onDrop={(e) => onDrop(e, idx)}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "relative",
        width: "100%",
        paddingBottom: ratioPad,
        overflow: "hidden",
        cursor: "grab",
        opacity: dragIdx === idx ? 0.35 : 1,
        outline: overIdx === idx ? `3px solid ${PINK}` : "none",
        outlineOffset: -3,
      }}
    >
      <img
        src={img.src}
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          pointerEvents: "none",
        }}
      />

      {queuePos != null && (
        <div
          style={{
            position: "absolute",
            bottom: 5,
            right: 5,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            fontSize: 9,
            fontWeight: 700,
            fontFamily: "sans-serif",
            padding: "2px 5px",
            borderRadius: 4,
            pointerEvents: "none",
            zIndex: 2,
            opacity: hov ? 0 : 1,
            transition: "opacity .15s",
          }}
        >
          #{queuePos}
        </div>
      )}

      {hasCaption && (
        <div
          style={{
            position: "absolute",
            bottom: queuePos != null ? 20 : 5,
            right: 5,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: PINK,
            pointerEvents: "none",
            zIndex: 2,
            opacity: hov ? 0 : 1,
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: hov ? "rgba(0,0,0,0.38)" : "rgba(0,0,0,0)",
          transition: "background .15s",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 5,
          pointerEvents: hov ? "auto" : "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            opacity: hov ? 1 : 0,
            transition: "opacity .15s",
          }}
        >
          <div style={{ display: "flex", gap: 3 }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSwap();
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                background: "rgba(255,255,255,0.92)",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                color: "#000",
              }}
            >
              ⇄
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCaption();
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                background: hasCaption
                  ? `${PINK}dd`
                  : "rgba(255,255,255,0.92)",
                border: "none",
                cursor: "pointer",
                fontSize: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: hasCaption ? "#fff" : "#555",
              }}
            >
              ✎
            </button>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: "rgba(0,0,0,0.65)",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            ×
          </button>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            opacity: hov ? 1 : 0,
            transition: "opacity .15s",
          }}
        >
          <div
            style={{
              background: "rgba(0,0,0,0.45)",
              color: "#fff",
              fontSize: 8,
              padding: "1px 4px",
              borderRadius: 2,
            }}
          >
            {idx + 1}
          </div>
          <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {queuePos != null && (
              <div
                style={{
                  background: "rgba(0,0,0,0.75)",
                  color: "#fff",
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: "sans-serif",
                  padding: "2px 5px",
                  borderRadius: 4,
                }}
              >
                #{queuePos}
              </div>
            )}
            {hasCaption && (
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: PINK,
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

const ProfileSwitcher = React.memo(function ProfileSwitcher({
  profiles,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
}: {
  profiles: Profile[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ren, setRen] = useState<string | null>(null);
  const [rv, setRv] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const active = profiles.find((p) => p.id === activeId);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 12px",
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: 8,
          cursor: "pointer",
          fontFamily: "sans-serif",
          fontSize: 13,
          fontWeight: 600,
          color: "#000",
          maxWidth: 180,
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {active?.name || "Select"}
        </span>
        <span style={{ fontSize: 10, color: "#aaa", flexShrink: 0 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            background: "#fff",
            border: "1px solid #e0e0e0",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            zIndex: 200,
            minWidth: 220,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "8px 0" }}>
            {profiles.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center" }}>
                {ren === p.id ? (
                  <input
                    autoFocus
                    value={rv}
                    onChange={(e) => setRv(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(p.id, rv);
                        setRen(null);
                      }
                      if (e.key === "Escape") setRen(null);
                    }}
                    onBlur={() => {
                      onRename(p.id, rv);
                      setRen(null);
                    }}
                    style={{
                      flex: 1,
                      margin: "2px 8px",
                      padding: "6px 10px",
                      border: "1px solid #ddd",
                      borderRadius: 6,
                      fontSize: 13,
                      fontFamily: "sans-serif",
                      outline: "none",
                    }}
                  />
                ) : (
                  <div
                    onClick={() => {
                      onSwitch(p.id);
                      setOpen(false);
                    }}
                    style={{
                      flex: 1,
                      padding: "8px 14px",
                      cursor: "pointer",
                      fontFamily: "sans-serif",
                      fontSize: 13,
                      color: "#000",
                      fontWeight: p.id === activeId ? 700 : 400,
                      background:
                        p.id === activeId ? "#f5f5f5" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {p.id === activeId && (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: "#000",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    {p.name}
                  </div>
                )}
                {ren !== p.id && (
                  <div style={{ display: "flex", paddingRight: 8 }}>
                    <button
                      onClick={() => {
                        setRen(p.id);
                        setRv(p.name);
                      }}
                      style={{
                        padding: "4px 6px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 11,
                        color: "#aaa",
                      }}
                    >
                      ✎
                    </button>
                    {profiles.length > 1 && (
                      <button
                        onClick={() => onDelete(p.id)}
                        style={{
                          padding: "4px 6px",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 12,
                          color: "#ddd",
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ borderTop: "1px solid #f0f0f0", padding: 8 }}>
            <button
              onClick={() => {
                onCreate();
                setOpen(false);
              }}
              style={{
                width: "100%",
                padding: "8px 14px",
                background: "#000",
                border: "none",
                borderRadius: 7,
                color: "#fff",
                fontFamily: "sans-serif",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              + New Profile
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Main Component ──────────────────────────────────────────────────────────
export default function IGGridPlanner() {
  const [profiles, setProfiles] = useState<Profile[]>(() => [emptyProfile("Client 1")]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [usedBytes, setUsedBytes] = useState(0);
  const [profileSizes, setProfileSizes] = useState<Record<string, number>>({});
  const [activePanel, setActivePanel] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [migrationMsg, setMigrationMsg] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [libDragId, setLibDragId] = useState<string | null>(null);
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<{ role: string; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [igTab, setIgTab] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [profileImporting, setProfileImporting] = useState(false);
  const [avatarImport, setAvatarImport] = useState<{
    screenshotSrc: string;
    profileData: {
      name?: string;
      username?: string;
      bio?: string;
      link?: string;
      followers?: string;
      following?: string;
      highlights?: string[];
    };
  } | null>(null);
  const [highlightQueue, setHighlightQueue] = useState<{
    screenshotSrc: string;
    labels: string[];
    currentIdx: number;
  } | null>(null);
  const [captionTileIdx, setCaptionTileIdx] = useState<number | null>(null);
  const [captionCtx, setCaptionCtx] = useState("");
  const [captionDrafts, setCaptionDrafts] = useState<
    { label: string; text: string }[]
  >([]);
  const [captionSelected, setCaptionSelected] = useState<number | null>(null);
  const [captionEdit, setCaptionEdit] = useState("");
  const [captionLoading, setCaptionLoading] = useState(false);
  const [schedDrag, setSchedDrag] = useState<number | null>(null);
  const [schedOver, setSchedOver] = useState<number | null>(null);
  const [clientForm, setClientForm] = useState<ClientInfo>({
    niche: "",
    audience: "",
    tone: "",
    pillars: "",
    competitors: "",
    notes: "",
  });
  const [clientSaved, setClientSaved] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [gapLoading, setGapLoading] = useState(false);
  const [gapResult, setGapResult] = useState("");
  const [importMode, setImportMode] = useState("replace");
  const [importMsg, setImportMsg] = useState("");
  const [profileImportMsg, setProfileImportMsg] = useState("");
  const [recompressing, setRecompressing] = useState(false);
  const [exportScale, setExportScale] = useState<2 | 3 | 4>(3);
  const [globalDragOver, setGlobalDragOver] = useState(false);
  const [avatarDragOver, setAvatarDragOver] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const historyRef = useRef<Profile[]>([]);
  const futureRef = useRef<Profile[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const ssRef = useRef<HTMLInputElement>(null);
  const swapRef = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const profileSsRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCountRef = useRef(0);

  // ── Derived values (memoized) ───────────────────────────────────────────
  const active = useMemo(
    () => profiles.find((p) => p.id === activeId),
    [profiles, activeId]
  );

  const images = useMemo(() => active?.images || [], [active]);

  const library = useMemo(() => active?.library || [], [active]);

  const info = useMemo(
    () =>
      active?.info || {
        username: "",
        name: "",
        bio: "",
        link: "",
        followers: "0",
        following: "0",
        avatar: null,
      },
    [active]
  );

  const highlights = useMemo(() => active?.highlights || [], [active]);

  const captions = useMemo(() => active?.captions || {}, [active]);

  const scheduleData = useMemo(() => active?.schedule || {}, [active]);

  const queue = useMemo(() => {
    const rawQueue = active?.queue || [];
    return rawQueue.filter((id) => images.some((img) => img.id === id));
  }, [active, images]);

  const captionImg = useMemo(
    () => (captionTileIdx != null ? images[captionTileIdx] : null),
    [captionTileIdx, images]
  );

  const captionSaved = useMemo(
    () => (captionImg ? captions[captionImg.id] || {} : {}),
    [captionImg, captions]
  );

  const storagePct = useMemo(
    () => usedBytes / PER_KEY_LIMIT,
    [usedBytes]
  );

  const barC = useMemo(
    () =>
      storagePct >= DANGER_AT
        ? "#e53e3e"
        : storagePct >= WARN_AT
          ? "#f6ad55"
          : "#48bb78",
    [storagePct]
  );

  const ratioPad = useMemo(
    () => (RATIO_PAD as Record<number, string>)[igTab] || "125%",
    [igTab]
  );

  const panelTitles = useMemo(
    (): Record<string, string> => ({
      chat: "AI Chat",
      library: "Library",
      schedule: "Schedule",
      client: "Client Info",
      backup: "Storage & Backup",
      caption: `Caption · Tile #${(captionTileIdx || 0) + 1}`,
    }),
    [captionTileIdx]
  );

  // ── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, aiLoading]);

  useEffect(() => {
    (async () => {
      // Single parallel fetch — replaces the N+3 query waterfall
      const [activeIdResult, { data: allRows }] = await Promise.all([
        loadActiveId(),
        supabase.from("ig_profiles").select("id, data"),
      ]);

      const all = (allRows || [])
        .filter((r) => r.data)
        .map((r) => r.data as Profile);

      if (all.length) {
        setProfiles(all);
        const aid =
          activeIdResult && all.find((p) => p.id === activeIdResult)
            ? activeIdResult
            : all[0].id;
        setActiveId(aid);
        const sizes: Record<string, number> = {};
        all.forEach((p) => {
          sizes[p.id] = calcBytes(p);
        });
        setProfileSizes(sizes);
        setUsedBytes(sizes[aid] || 0);
        // Reconcile index in background
        saveIndex(all.map((p) => ({ id: p.id, name: p.name })));
      } else {
        // First visit — use the default profile already in state
        const d = profiles[0];
        setActiveId(d.id);
        await saveProfile(d);
        await saveIndex([{ id: d.id, name: d.name }]);
        const b = calcBytes(d);
        setUsedBytes(b);
        setProfileSizes({ [d.id]: b });
      }
      setLoaded(true);
    })();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (supabase.channel("profiles-sync") as any)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ig_profiles" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          if (payload.eventType === "DELETE") {
            setProfiles((prev) =>
              (prev || []).filter(
                (p: Profile) => p.id !== payload.old.id
              )
            );
          } else if (payload.new?.data) {
            const updated = payload.new.data as Profile;
            setProfiles((prev) => {
              const existing = prev || [];
              const isUpdate = existing.some(
                (p: Profile) => p.id === updated.id
              );
              const next = isUpdate
                ? existing.map((p: Profile) =>
                    p.id === updated.id ? updated : p
                  )
                : [...existing, updated];
              if (!isUpdate) {
                saveIndex(next.map((p) => ({ id: p.id, name: p.name })));
              }
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (active?.clientInfo) setClientForm(active.clientInfo);
    setGapResult("");
    setClientSaved(false);
  }, [activeId]);

  // Bug 2 fix: added captionImg and captions to dependency array
  useEffect(() => {
    if (captionTileIdx == null || !captionImg) return;
    const d = captions[captionImg.id] || {};
    setCaptionCtx(d.context || "");
    setCaptionDrafts(d.generated || []);
    setCaptionSelected(null);
    setCaptionEdit(d.approved || "");
  }, [captionTileIdx, captionImg, captions]);

  // ── Core handlers ───────────────────────────────────────────────────────
  const scheduleSave = useCallback(
    (updatedProfiles: Profile[], changedProfile: Profile | undefined) => {
      setSaveStatus("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (changedProfile) {
          await saveProfile(changedProfile);
          const bytes = calcBytes(changedProfile);
          setUsedBytes(bytes);
          setProfileSizes((prev) => ({
            ...prev,
            [changedProfile.id]: bytes,
          }));
        }
        await saveIndex(
          updatedProfiles.map((p) => ({ id: p.id, name: p.name }))
        );
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 1500);
      }, 600);
    },
    []
  );

  const updateProfile = useCallback(
    (updater: (p: Profile) => Profile) => {
      setProfiles((prev) => {
        if (!prev) return prev;
        const current = prev.find((p) => p.id === activeId);
        if (current) {
          historyRef.current = [...historyRef.current.slice(-29), current];
          futureRef.current = [];
          setCanUndo(true);
          setCanRedo(false);
        }
        const next = prev.map((p) =>
          p.id === activeId ? updater(p) : p
        );
        scheduleSave(
          next,
          next.find((p) => p.id === activeId)
        );
        return next;
      });
    },
    [activeId, scheduleSave]
  );

  const undo = useCallback(() => {
    if (!historyRef.current.length) return;
    const prev = historyRef.current.pop()!;
    setProfiles((ps) => {
      if (!ps) return ps;
      const current = ps.find((p) => p.id === activeId);
      if (current) futureRef.current.push(current);
      const next = ps.map((p) => (p.id === prev.id ? prev : p));
      scheduleSave(next, prev);
      return next;
    });
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  }, [activeId, scheduleSave]);

  const redo = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current.pop()!;
    setProfiles((ps) => {
      if (!ps) return ps;
      const current = ps.find((p) => p.id === activeId);
      if (current) historyRef.current.push(current);
      const updated = ps.map((p) => (p.id === next.id ? next : p));
      scheduleSave(updated, next);
      return updated;
    });
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  }, [activeId, scheduleSave]);

  const URL_RE = /https?:\/\/[^\s]+/i;

  const updInfo = useCallback(
    (k: string) => (v: string) =>
      updateProfile((p) => {
        const base = { ...p, info: { ...p.info, [k]: v } };
        if (k === "bio") {
          const found = v.match(URL_RE)?.[0];
          if (found && !p.info.link)
            return { ...base, info: { ...base.info, link: found } };
        }
        return base;
      }),
    [updateProfile]
  );

  const updHighlight = useCallback(
    (h: HighlightItem) =>
      updateProfile((p) => ({
        ...p,
        highlights: p.highlights.map((x) => (x.id === h.id ? h : x)),
      })),
    [updateProfile]
  );

  const removeHighlight = useCallback(
    (id: number) =>
      updateProfile((p) => ({
        ...p,
        highlights: p.highlights.filter((h) => h.id !== id),
      })),
    [updateProfile]
  );

  const addHighlight = useCallback(
    () =>
      updateProfile((p) => ({
        ...p,
        highlights: [
          ...p.highlights,
          { id: Date.now(), label: "NEW", img: null },
        ],
      })),
    [updateProfile]
  );

  const addToLibraryAndGrid = useCallback(
    (newImgs: ImageItem[]) => {
      updateProfile((p) => {
        const ex = new Set(p.library.map((x) => x.src));
        return {
          ...p,
          library: [
            ...p.library,
            ...newImgs.filter((x) => !ex.has(x.src)),
          ],
          images: [...newImgs, ...p.images],
        };
      });
    },
    [updateProfile]
  );

  const addImages = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      Promise.all(
        files.map(async (f) => ({
          id: Date.now() + Math.random() + "",
          src: await readAndCompress(f),
        }))
      ).then(addToLibraryAndGrid);
      e.target.value = "";
    },
    [addToLibraryAndGrid]
  );

  const addAvatar = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      updInfo("avatar")(await readAndCompress(f, AV_DIM, AV_Q));
    },
    [updInfo]
  );

  const openSwap = useCallback(
    (idx: number) => {
      setSwapIdx(idx);
      swapRef.current?.click();
    },
    []
  );

  const doSwap = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f || swapIdx == null) return;
      const n = {
        id: Date.now() + Math.random() + "",
        src: await readAndCompress(f),
      };
      updateProfile((p) => ({
        ...p,
        library: [...p.library, n],
        images: p.images.map((img, i) => (i === swapIdx ? n : img)),
      }));
      setSwapIdx(null);
      e.target.value = "";
    },
    [swapIdx, updateProfile]
  );

  // ── Drag & Drop ─────────────────────────────────────────────────────────
  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragCountRef.current++;
    setGlobalDragOver(true);
  }, []);

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    dragCountRef.current--;
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0;
      setGlobalDragOver(false);
    }
  }, []);

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  }, []);

  const handleGlobalDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCountRef.current = 0;
      setGlobalDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!files.length) return;
      const newImgs = await Promise.all(
        files.map(async (f) => ({
          id: Date.now() + Math.random() + "",
          src: await readAndCompress(f),
        }))
      );
      addToLibraryAndGrid(newImgs);
      setMsgs((prev) => [
        ...prev,
        {
          role: "sys",
          text: `✦ ${newImgs.length} IMAGE${newImgs.length > 1 ? "S" : ""} ADDED`,
        },
      ]);
    },
    [addToLibraryAndGrid]
  );

  const handleAvatarDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setAvatarDragOver(true);
  }, []);

  const handleAvatarDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation();
    setAvatarDragOver(false);
  }, []);

  const handleAvatarDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setAvatarDragOver(false);
      dragCountRef.current = 0;
      setGlobalDragOver(false);
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/")
      );
      if (!files.length) return;
      const file = files[0];
      setProfileImporting(true);
      const rawSrc = await readFile(file);
      const compressed = await compressImg(rawSrc, 1200, 0.75);
      const b64 = compressed.split(",")[1],
        mt = "image/jpeg";
      try {
        const res = await fetch("/api/anthropic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            max_tokens: 700,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: { type: "base64", media_type: mt, data: b64 },
                  },
                  {
                    type: "text",
                    text: 'Instagram profile screenshot. Return ONLY raw JSON:\n{"name":"...","username":"...","bio":"...","link":"...","followers":"...","following":"...","highlights":["LABEL1"]}\nusername without @. link = URL from bio or "". "" for anything not visible.',
                  },
                ],
              },
            ],
          }),
        });
        let data: {
          error?: { message?: string };
          content?: { type: string; text: string }[];
        };
        try {
          data = await res.json();
        } catch {
          setProfileImportMsg(
            `⚠ Image too large — try a smaller screenshot`
          );
          setTimeout(() => setProfileImportMsg(""), 6000);
          setProfileImporting(false);
          return;
        }
        if (!res.ok || data.error || !data.content) {
          const msg =
            data.error?.message ||
            (typeof data.error === "string" ? data.error : null) ||
            `HTTP ${res.status}`;
          setProfileImportMsg(`⚠ AI error: ${msg}`);
          setTimeout(() => setProfileImportMsg(""), 6000);
          setProfileImporting(false);
          return;
        }
        const text =
          data.content.find((b: { type: string }) => b.type === "text")
            ?.text || "";
        const match = text
          .replace(/```[\w]*\n?/g, "")
          .trim()
          .match(/\{[\s\S]*\}/);
        if (!match) throw new Error("Could not parse profile data");
        setAvatarImport({
          screenshotSrc: rawSrc,
          profileData: JSON.parse(match[0]),
        });
      } catch (err) {
        setProfileImportMsg(
          `⚠ Import failed: ${(err as Error).message}`
        );
        setTimeout(() => setProfileImportMsg(""), 6000);
      }
      setProfileImporting(false);
    },
    [updInfo]
  );

  const onDragStart = useCallback(
    (e: React.DragEvent, i: number) => {
      e.dataTransfer.setData("type", "grid");
      setDragIdx(i);
      setLibDragId(null);
    },
    []
  );

  const onDragOver = useCallback(
    (e: React.DragEvent, i: number) => {
      e.preventDefault();
      setOverIdx(i);
    },
    []
  );

  const onDrop = useCallback(
    (e: React.DragEvent, i: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (isFileDrag(e)) {
        const files = Array.from(e.dataTransfer.files).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length) {
          Promise.all(
            files.map(async (f) => ({
              id: Date.now() + Math.random() + "",
              src: await readAndCompress(f),
            }))
          ).then((newImgs) => {
            updateProfile((p) => {
              const arr = [...p.images];
              arr.splice(i, 0, ...newImgs);
              const ex = new Set(p.library.map((x) => x.src));
              return {
                ...p,
                images: arr,
                library: [
                  ...p.library,
                  ...newImgs.filter((x) => !ex.has(x.src)),
                ],
              };
            });
          });
        }
        dragCountRef.current = 0;
        setGlobalDragOver(false);
        setDragIdx(null);
        setOverIdx(null);
        return;
      }
      const type = e.dataTransfer.getData("type");
      if (type === "library" && libDragId != null) {
        const li = library.find((x) => x.id === libDragId);
        if (li) {
          const n = { id: Date.now() + Math.random() + "", src: li.src };
          updateProfile((p) => {
            const arr = [...p.images];
            arr.splice(i, 0, n);
            return { ...p, images: arr };
          });
        }
      } else if (type === "grid" && dragIdx != null && dragIdx !== i) {
        updateProfile((p) => {
          const arr = [...p.images];
          const [item] = arr.splice(dragIdx, 1);
          arr.splice(i, 0, item);
          return { ...p, images: arr };
        });
      }
      setDragIdx(null);
      setOverIdx(null);
      setLibDragId(null);
    },
    [dragIdx, libDragId, library, updateProfile]
  );

  const onDragEnd = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
  }, []);

  const onLibDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      e.dataTransfer.setData("type", "library");
      setLibDragId(id);
      setDragIdx(null);
    },
    []
  );

  const removeImg = useCallback(
    (i: number) =>
      updateProfile((p) => ({
        ...p,
        images: p.images.filter((_, idx) => idx !== i),
        queue: (p.queue || []).filter((id) =>
          p.images.some((img, idx) => idx !== i && img.id === id)
        ),
      })),
    [updateProfile]
  );

  const removeFromLibrary = useCallback(
    (id: string) =>
      updateProfile((p) => ({
        ...p,
        library: p.library.filter((x) => x.id !== id),
      })),
    [updateProfile]
  );

  const openCrop = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      e.target.value = "";
      const r = new FileReader();
      r.onload = (ev) => setCropSrc(ev.target!.result as string);
      r.readAsDataURL(f);
    },
    []
  );

  const confirmCrop = useCallback(
    (sel: RectSel, rows: number) => {
      const img = new Image();
      img.onload = () => {
        const NW = img.naturalWidth,
          NH = img.naturalHeight;
        const sx = Math.round(sel.x * NW),
          sy = Math.round(sel.y * NH),
          sw = Math.round(sel.w * NW),
          sh = Math.round(sel.h * NH);
        const cW = Math.floor(sw / 3),
          cH = Math.floor(sh / rows),
          OW = 800,
          OH = Math.round(OW * (cH / cW));
        const canvas = document.createElement("canvas");
        canvas.width = OW;
        canvas.height = OH;
        const ctx = canvas.getContext("2d")!;
        const sliced: ImageItem[] = [];
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < 3; col++) {
            ctx.clearRect(0, 0, OW, OH);
            ctx.drawImage(
              img,
              sx + col * cW,
              sy + row * cH,
              cW,
              cH,
              0,
              0,
              OW,
              OH
            );
            sliced.push({
              id: Date.now() + Math.random() + "",
              src: canvas.toDataURL("image/jpeg", IMG_Q),
            });
          }
        }
        addToLibraryAndGrid(sliced);
        setMsgs((prev) => [
          ...prev,
          { role: "sys", text: `✦ ${sliced.length} TILES IMPORTED` },
        ]);
        setCropSrc(null);
      };
      img.src = cropSrc!;
    },
    [cropSrc, addToLibraryAndGrid]
  );

  const importProfileScreenshot = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      e.target.value = "";
      setProfileImporting(true);
      const r = new FileReader();
      r.onload = async (ev) => {
        const raw = ev.target!.result as string;
        const compressed = await compressImg(raw, 1200, 0.75);
        const src = compressed;
        const b64 = src.split(",")[1],
          mt = "image/jpeg";
        try {
          const res = await fetch("/api/anthropic", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-sonnet-4-5",
              max_tokens: 700,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: { type: "base64", media_type: mt, data: b64 },
                    },
                    {
                      type: "text",
                      text: 'Instagram profile screenshot. Return ONLY raw JSON:\n{"name":"...","username":"...","bio":"...","link":"...","followers":"...","following":"...","highlights":["LABEL1"]}\nusername without @. link = URL from bio or "". "" for anything not visible.',
                    },
                  ],
                },
              ],
            }),
          });
          let data: {
            error?: { message?: string };
            content?: { type: string; text: string }[];
          };
          try {
            data = await res.json();
          } catch {
            setProfileImportMsg(
              `⚠ Image too large — try a smaller screenshot`
            );
            setTimeout(() => setProfileImportMsg(""), 6000);
            setProfileImporting(false);
            return;
          }
          if (!res.ok || data.error || !data.content) {
            const msg =
              data.error?.message ||
              (typeof data.error === "string" ? data.error : null) ||
              `HTTP ${res.status}`;
            setProfileImportMsg(`⚠ AI error: ${msg}`);
            setTimeout(() => setProfileImportMsg(""), 6000);
            setProfileImporting(false);
            return;
          }
          const text =
            data.content.find((b: { type: string }) => b.type === "text")
              ?.text || "";
          const match = text
            .replace(/```[\w]*\n?/g, "")
            .trim()
            .match(/\{[\s\S]*\}/);
          if (!match)
            throw new Error(
              "Could not parse profile data from screenshot"
            );
          setAvatarImport({
            screenshotSrc: raw,
            profileData: JSON.parse(match[0]),
          });
        } catch (err) {
          setProfileImportMsg(
            `⚠ Import failed: ${(err as Error).message}`
          );
          setTimeout(() => setProfileImportMsg(""), 6000);
        }
        setProfileImporting(false);
      };
      r.readAsDataURL(f);
    },
    []
  );

  const handleAvatarConfirm = useCallback(
    (avatarSrc: string | null) => {
      if (!avatarImport) return;
      const { screenshotSrc, profileData } = avatarImport;
      const eL = (profileData.highlights || []).filter(
        (l: string) => l && l.toUpperCase() !== "NEW"
      );
      const nH = eL.length
        ? eL
            .slice(0, 6)
            .map((label: string, i: number) => ({
              id: i + 1,
              label: label.toUpperCase(),
              img: null,
            }))
        : null;
      updateProfile((p) => ({
        ...p,
        info: {
          ...p.info,
          ...(profileData.name && { name: profileData.name }),
          ...(profileData.username && { username: profileData.username }),
          ...(profileData.bio && { bio: profileData.bio }),
          ...(profileData.link && { link: profileData.link }),
          ...(profileData.followers && {
            followers: profileData.followers,
          }),
          ...(profileData.following && {
            following: profileData.following,
          }),
          ...(avatarSrc && { avatar: avatarSrc }),
        },
        ...(nH && { highlights: nH }),
      }));
      setAvatarImport(null);
      if (nH?.length)
        setHighlightQueue({
          screenshotSrc,
          labels: nH.map((h: { label: string }) => h.label),
          currentIdx: 0,
        });
      else
        setMsgs((prev) => [
          ...prev,
          {
            role: "sys",
            text:
              "✦ PROFILE IMPORTED" + (avatarSrc ? " · avatar" : ""),
          },
        ]);
    },
    [avatarImport, updateProfile]
  );

  const handleHighlightCrop = useCallback(
    (imgSrc: string | null) => {
      if (!highlightQueue) return;
      const { labels, currentIdx } = highlightQueue;
      if (imgSrc)
        updateProfile((p) => ({
          ...p,
          highlights: p.highlights.map((h, i) =>
            i === currentIdx ? { ...h, img: imgSrc } : h
          ),
        }));
      const next = currentIdx + 1;
      if (next < labels.length)
        setHighlightQueue((prev) =>
          prev ? { ...prev, currentIdx: next } : null
        );
      else {
        setHighlightQueue(null);
        setMsgs((prev) => [
          ...prev,
          {
            role: "sys",
            text: `✦ IMPORT COMPLETE · ${labels.length} highlights`,
          },
        ]);
      }
    },
    [highlightQueue, updateProfile]
  );

  const handleSwitch = useCallback(
    async (id: string) => {
      setActiveId(id);
      await saveActiveId(id);
      setUsedBytes(profileSizes[id] || 0);
    },
    [profileSizes]
  );

  const handleCreate = useCallback(async () => {
    const p = emptyProfile(`Client ${profiles.length + 1}`);
    setProfiles((prev) => {
      const next = [...(prev || []), p];
      saveIndex(next.map((x) => ({ id: x.id, name: x.name })));
      return next;
    });
    await saveProfile(p);
    setActiveId(p.id);
    saveActiveId(p.id);
    const b = calcBytes(p);
    setUsedBytes(b);
    setProfileSizes((prev) => ({ ...prev, [p.id]: b }));
  }, [profiles]);

  const handleRename = useCallback(
    (id: string, name: string) => {
      setProfiles((prev) => {
        if (!prev) return prev;
        const next = prev.map((p) =>
          p.id === id ? { ...p, name } : p
        );
        saveIndex(next.map((p) => ({ id: p.id, name: p.name })));
        const ch = next.find((p) => p.id === id);
        if (ch) saveProfile(ch);
        return next;
      });
    },
    []
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (profiles.length <= 1) return;
      const next = profiles.filter((p) => p.id !== id);
      setProfiles(next);
      await saveIndex(next.map((p) => ({ id: p.id, name: p.name })));
      await deleteStoredProfile(id);
      setProfileSizes((prev) => {
        const s = { ...prev };
        delete s[id];
        return s;
      });
      if (activeId === id) {
        setActiveId(next[0].id);
        saveActiveId(next[0].id);
        setUsedBytes(calcBytes(next[0]));
      }
    },
    [activeId, profiles]
  );

  // ── Export feed image ───────────────────────────────────────────────────
  const exportFeedImage = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const SC = exportScale,
        W = 390 * SC,
        PAD = 14 * SC,
        GAP = 2 * SC;
      const FONT = `-apple-system,BlinkMacSystemFont,Arial,sans-serif`;
      const AV_D = 77 * SC,
        AV_R = AV_D / 2;
      const [avImg, ...rest] = await Promise.all([
        info.avatar ? loadImg(info.avatar) : Promise.resolve(null),
        ...highlights.map((h) =>
          h.img ? loadImg(h.img) : Promise.resolve(null)
        ),
        ...images.map((img) => loadImg(img.src)),
      ]);
      const hlImgs = rest.slice(0, highlights.length);
      const gridImgs = rest.slice(highlights.length);
      const ratioMul = igTab === 1 ? 16 / 9 : 1.25;
      const CELL_W = Math.floor(W / 3);
      const CELL_H = Math.round(CELL_W * ratioMul);
      const bioLines = (info.bio || "").split("\n");
      const gridRows = Math.ceil(Math.max(images.length, 0) / 3);
      const profileH =
        PAD +
        AV_D +
        12 * SC +
        18 * SC +
        18 * SC +
        Math.max(1, bioLines.length) * 17 * SC +
        10 * SC;
      const hlH = highlights.length ? 54 * SC + 20 * SC + 14 * SC : 0;
      const tabH = 44 * SC;
      const gridH =
        gridRows > 0 ? gridRows * CELL_H + (gridRows - 1) * GAP : 0;
      const totalH = profileH + hlH + tabH + gridH + PAD;
      const SPAD = Math.round(28 * SC);
      const canvas = document.createElement("canvas");
      canvas.width = W + SPAD * 2;
      canvas.height = totalH + SPAD * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ebebeb";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = Math.round(28 * SC);
      ctx.shadowOffsetY = Math.round(6 * SC);
      ctx.fillStyle = "#fff";
      ctx.fillRect(SPAD, SPAD, W, totalH);
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(SPAD, SPAD, W, totalH);
      ctx.clip();
      ctx.fillStyle = "#fff";
      ctx.fillRect(SPAD, SPAD, W, totalH);
      // offset all drawing by SPAD
      ctx.translate(SPAD, SPAD);
      let y = PAD;
      const rg = ctx.createLinearGradient(
        PAD,
        y,
        PAD + AV_D,
        y + AV_D
      );
      rg.addColorStop(0, "#c13584");
      rg.addColorStop(0.33, "#e1306c");
      rg.addColorStop(0.66, "#fd1d1d");
      rg.addColorStop(1, "#fcaf45");
      ctx.strokeStyle = rg;
      ctx.lineWidth = 3.5 * SC;
      ctx.beginPath();
      ctx.arc(PAD + AV_R, y + AV_R, AV_R + 3 * SC, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 * SC;
      ctx.beginPath();
      ctx.arc(PAD + AV_R, y + AV_R, AV_R + 1 * SC, 0, Math.PI * 2);
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(PAD + AV_R, y + AV_R, AV_R, 0, Math.PI * 2);
      ctx.clip();
      if (avImg) {
        const s = avImg,
          iA = s.naturalWidth / s.naturalHeight,
          cell = 1;
        if (iA > cell) {
          const sw = s.naturalHeight * cell;
          ctx.drawImage(
            s,
            (s.naturalWidth - sw) / 2,
            0,
            sw,
            s.naturalHeight,
            PAD,
            y,
            AV_D,
            AV_D
          );
        } else {
          const sh = s.naturalWidth / cell;
          ctx.drawImage(
            s,
            0,
            (s.naturalHeight - sh) / 2,
            s.naturalWidth,
            sh,
            PAD,
            y,
            AV_D,
            AV_D
          );
        }
      } else {
        const g = ctx.createLinearGradient(
          PAD,
          y,
          PAD + AV_D,
          y + AV_D
        );
        g.addColorStop(0, "#c13584");
        g.addColorStop(0.5, "#e1306c");
        g.addColorStop(1, "#fcaf45");
        ctx.fillStyle = g;
        ctx.fillRect(PAD, y, AV_D, AV_D);
      }
      ctx.restore();
      const sX = PAD + AV_D + 18 * SC,
        sW = W - sX - PAD;
      const statItems: [string, string][] = [
        ["posts", String(images.length)],
        ["followers", info.followers || "0"],
        ["following", info.following || "0"],
      ];
      const sColW = sW / 3;
      statItems.forEach(([lbl, val], i) => {
        const sx = sX + i * sColW + sColW / 2,
          sy = y + AV_R - 8 * SC;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#000";
        ctx.font = `700 ${15 * SC}px ${FONT}`;
        ctx.fillText(val, sx, sy);
        ctx.fillStyle = "#777";
        ctx.font = `400 ${12 * SC}px ${FONT}`;
        ctx.fillText(lbl, sx, sy + 20 * SC);
      });
      y += AV_D + 12 * SC;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#000";
      ctx.font = `600 ${14 * SC}px ${FONT}`;
      ctx.fillText(info.name || "", PAD, y);
      y += 18 * SC;
      ctx.fillStyle = "#888";
      ctx.font = `400 ${13 * SC}px ${FONT}`;
      ctx.fillText("@" + (info.username || ""), PAD, y);
      y += 18 * SC;
      ctx.fillStyle = "#000";
      ctx.font = `400 ${13 * SC}px ${FONT}`;
      bioLines.forEach((line) => {
        ctx.fillText(line || " ", PAD, y);
        y += 17 * SC;
      });
      y += 10 * SC;
      if (highlights.length) {
        const HL_D = 54 * SC,
          HL_R = HL_D / 2,
          HL_GAP = 14 * SC;
        let hlX = PAD;
        for (let i = 0; i < highlights.length; i++) {
          const h = highlights[i],
            hi = hlImgs[i],
            hCX = hlX + HL_R,
            hCY = y + HL_R;
          ctx.save();
          ctx.beginPath();
          ctx.arc(hCX, hCY, HL_R, 0, Math.PI * 2);
          ctx.clip();
          if (hi) {
            const iA = hi.naturalWidth / hi.naturalHeight,
              cell = 1;
            if (iA > cell) {
              const sw = hi.naturalHeight;
              ctx.drawImage(
                hi,
                (hi.naturalWidth - sw) / 2,
                0,
                sw,
                hi.naturalHeight,
                hlX,
                y,
                HL_D,
                HL_D
              );
            } else {
              const sh = hi.naturalWidth;
              ctx.drawImage(
                hi,
                0,
                (hi.naturalHeight - sh) / 2,
                hi.naturalWidth,
                sh,
                hlX,
                y,
                HL_D,
                HL_D
              );
            }
          } else {
            ctx.fillStyle = "#f0f0f0";
            ctx.fillRect(hlX, y, HL_D, HL_D);
            ctx.fillStyle = "#999";
            ctx.font = `400 ${11 * SC}px ${FONT}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(h.label[0] || "", hCX, hCY);
          }
          ctx.restore();
          ctx.strokeStyle = "#ddd";
          ctx.lineWidth = 1 * SC;
          ctx.beginPath();
          ctx.arc(hCX, hCY, HL_R, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "#555";
          ctx.font = `400 ${10 * SC}px ${FONT}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.fillText(h.label, hCX, y + HL_D + 12 * SC);
          hlX += HL_D + HL_GAP;
        }
        y += 54 * SC + 20 * SC + 14 * SC;
      }
      ctx.strokeStyle = "#dbdbdb";
      ctx.lineWidth = 1 * SC;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      const tW = W / 3;
      ctx.fillStyle = "#000";
      ctx.fillRect(igTab * tW, y, tW, 2 * SC);
      ["⊞", "▶", "☆"].forEach((sym, i) => {
        ctx.fillStyle = igTab === i ? "#000" : "#bbb";
        ctx.font = `400 ${17 * SC}px ${FONT}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(sym, (i + 0.5) * tW, y + 22 * SC);
      });
      y += tabH;
      const coverDraw = (
        ctx2: CanvasRenderingContext2D,
        img: HTMLImageElement | null,
        dx: number,
        dy: number,
        dw: number,
        dh: number
      ) => {
        if (!img) return;
        const iA = img.naturalWidth / img.naturalHeight,
          cA = dw / dh;
        let sx, sy, sw, sh;
        if (iA > cA) {
          sh = img.naturalHeight;
          sw = sh * cA;
          sx = (img.naturalWidth - sw) / 2;
          sy = 0;
        } else {
          sw = img.naturalWidth;
          sh = sw / cA;
          sx = 0;
          sy = (img.naturalHeight - sh) / 2;
        }
        ctx2.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
      };
      for (let i = 0; i < images.length; i++) {
        const col = i % 3,
          row = Math.floor(i / 3);
        const cx = col * (CELL_W + GAP),
          cy = y + row * (CELL_H + GAP);
        if (gridImgs[i])
          coverDraw(
            ctx,
            gridImgs[i] as HTMLImageElement,
            cx,
            cy,
            CELL_W,
            CELL_H
          );
        else {
          ctx.fillStyle = "#f0f0f0";
          ctx.fillRect(cx, cy, CELL_W, CELL_H);
        }
      }
      ctx.restore();
      const url = canvas.toDataURL("image/jpeg", 0.93);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(active?.name || "feed").replace(/\s+/g, "-")}-mockup-${exportScale}x.jpg`;
      a.click();
    } catch (e) {
      console.error(e);
    }
    setExporting(false);
  }, [active, images, highlights, info, igTab, exporting, exportScale]);

  // ── Caption & schedule handlers ─────────────────────────────────────────
  const generateCaption = useCallback(async () => {
    if (!captionImg || captionLoading) return;
    setCaptionLoading(true);
    setCaptionDrafts([]);
    try {
      const mt = captionImg.src.split(";")[0].split(":")[1],
        d64 = captionImg.src.split(",")[1];
      const ci = active?.clientInfo || {
        niche: "",
        audience: "",
        tone: "",
        pillars: "",
        competitors: "",
        notes: "",
      };
      const bCtx = [
        ci.niche && `Niche: ${ci.niche}`,
        ci.audience && `Audience: ${ci.audience}`,
        ci.tone && `Voice/Tone: ${ci.tone}`,
        ci.pillars && `Content Pillars: ${ci.pillars}`,
      ]
        .filter(Boolean)
        .join("\n");
      const prompt = `You are a social media copywriter. Write 3 Instagram captions for this image.\n\n${bCtx ? `Brand Context:\n${bCtx}\n\n` : ""}Post context: ${captionCtx || "none provided"}\n\nReturn ONLY a raw JSON array:\n[{"label":"SHORT","text":"..."},{"label":"MEDIUM","text":"..."},{"label":"LONG + TAGS","text":"..."}]`;
      // Bug 1 fix: use /api/anthropic proxy
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 900,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: mt, data: d64 },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });
      const resp = await res.json();
      if (!res.ok || resp.error || !resp.content)
        throw new Error(resp.error || "API error");
      const raw =
        resp.content.find((b: { type: string }) => b.type === "text")
          ?.text || "";
      const match = raw
        .replace(/```[\w]*\n?/g, "")
        .trim()
        .match(/\[[\s\S]*\]/);
      if (!match) throw new Error("bad response");
      const drafts = JSON.parse(match[0]);
      setCaptionDrafts(drafts);
      updateProfile((p) => ({
        ...p,
        captions: {
          ...p.captions,
          [captionImg.id]: {
            ...(p.captions?.[captionImg.id] || {}),
            context: captionCtx,
            generated: drafts,
          },
        },
      }));
    } catch {
      setCaptionDrafts([{ label: "ERROR", text: "Generation failed." }]);
    }
    setCaptionLoading(false);
  }, [captionImg, captionLoading, captionCtx, active, updateProfile]);

  const approveCaption = useCallback(() => {
    if (!captionImg || !captionEdit.trim()) return;
    updateProfile((p) => ({
      ...p,
      captions: {
        ...p.captions,
        [captionImg.id]: {
          ...(p.captions?.[captionImg.id] || {}),
          context: captionCtx,
          generated: captionDrafts,
          approved: captionEdit,
        },
      },
    }));
    setMsgs((prev) => [
      ...prev,
      {
        role: "sys",
        text: `✦ CAPTION SAVED — TILE #${captionTileIdx! + 1}`,
      },
    ]);
  }, [
    captionImg,
    captionEdit,
    captionCtx,
    captionDrafts,
    captionTileIdx,
    updateProfile,
  ]);

  const addToQueue = useCallback(
    (id: string) =>
      updateProfile((p) => ({
        ...p,
        queue: [...(p.queue || []).filter((x) => x !== id), id],
      })),
    [updateProfile]
  );

  const removeFromQueue = useCallback(
    (id: string) =>
      updateProfile((p) => ({
        ...p,
        queue: (p.queue || []).filter((x) => x !== id),
      })),
    [updateProfile]
  );

  const updatePostDate = useCallback(
    (id: string, date: string) =>
      updateProfile((p) => ({
        ...p,
        schedule: {
          ...p.schedule,
          [id]: { ...(p.schedule?.[id] || {}), postDate: date },
        },
      })),
    [updateProfile]
  );

  const applyQueueToGrid = useCallback(() => {
    updateProfile((p) => {
      const vq = (p.queue || []).filter((id) =>
        p.images.some((i) => i.id === id)
      );
      const queued = vq
        .map((id) => p.images.find((i) => i.id === id))
        .filter(Boolean) as ImageItem[];
      const unqueued = p.images.filter((i) => !vq.includes(i.id));
      return { ...p, images: [...queued, ...unqueued] };
    });
    setMsgs((prev) => [
      ...prev,
      { role: "sys", text: "✦ GRID SORTED BY QUEUE ORDER" },
    ]);
  }, [updateProfile]);

  const onSD = useCallback(
    (e: React.DragEvent, qi: number) => {
      e.dataTransfer.setData("type", "sched");
      setSchedDrag(qi);
    },
    []
  );

  const onSOv = useCallback(
    (e: React.DragEvent, qi: number) => {
      e.preventDefault();
      setSchedOver(qi);
    },
    []
  );

  const onSDrop = useCallback(
    (e: React.DragEvent, qi: number) => {
      e.preventDefault();
      if (schedDrag == null || schedDrag === qi) {
        setSchedDrag(null);
        setSchedOver(null);
        return;
      }
      updateProfile((p) => {
        const q = [...(p.queue || [])];
        const [item] = q.splice(schedDrag, 1);
        q.splice(qi, 0, item);
        return { ...p, queue: q };
      });
      setSchedDrag(null);
      setSchedOver(null);
    },
    [schedDrag, updateProfile]
  );

  const saveClientInfo = useCallback(() => {
    updateProfile((p) => ({ ...p, clientInfo: clientForm }));
    setClientSaved(true);
    setTimeout(() => setClientSaved(false), 2000);
  }, [clientForm, updateProfile]);

  const detectGaps = useCallback(async (opts?: { toChat?: boolean }) => {
    if (!images.length || gapLoading) return;
    setGapLoading(true);
    setGapResult("");
    if (opts?.toChat) {
      setMsgs((prev) => [...prev, { role: "user", text: "✦ Scan for content gaps" }]);
    }
    try {
      const ci = clientForm;
      const hasContext = ci.niche || ci.audience || ci.tone || ci.pillars;
      const bCtx = hasContext
        ? `\n\nClient Context (optional — provided by user):\nNiche: ${ci.niche || "?"}\nAudience: ${ci.audience || "?"}\nTone: ${ci.tone || "?"}\nPillars: ${ci.pillars || "?"}\nCompetitors: ${ci.competitors || "?"}\nNotes: ${ci.notes || "none"}`
        : "";
      const content: {
        type: string;
        text?: string;
        source?: { type: string; media_type: string; data: string };
      }[] = [];
      images.slice(0, 9).forEach((img, i) => {
        content.push({ type: "text", text: `Post #${i + 1}:` });
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.src.split(";")[0].split(":")[1],
            data: img.src.split(",")[1],
          },
        });
      });
      content.push({
        type: "text",
        text: `You're a creative director reviewing this Instagram feed. Study the images to figure out the brand, audience, and vibe.${bCtx}

Be conversational and warm — like texting a client you like working with. Use **bold** for section titles (on their own line), bullet points (•) for lists, and keep paragraphs short (1-2 sentences).

Cover these:

**What's missing** — content types absent from the feed

**Aesthetic gaps** — where the visual flow breaks or gets monotonous

**Top 5 post ideas** — specific, ready-to-shoot concepts

**Quick wins this week** — low-effort, high-impact moves

End with an encouraging nudge.`,
      });
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1400,
          messages: [{ role: "user", content }],
        }),
      });
      const resp = await res.json();
      if (!res.ok || resp.error || !resp.content)
        throw new Error(resp.error || "API error");
      const result =
        resp.content.find((b: { type: string }) => b.type === "text")
          ?.text || "Analysis failed.";
      setGapResult(result);
      if (opts?.toChat) {
        setMsgs((prev) => [...prev, { role: "ai", text: result }]);
      }
    } catch {
      const err = "Error. Check connection and try again.";
      setGapResult(err);
      if (opts?.toChat) {
        setMsgs((prev) => [...prev, { role: "ai", text: err }]);
      }
    }
    setGapLoading(false);
  }, [images, gapLoading, clientForm, setMsgs]);

  const sendMsg = useCallback(async (overrideMsg?: string) => {
    const raw = overrideMsg ?? input;
    if (!raw.trim() || aiLoading) return;
    const userText = raw.trim();
    setInput("");
    if (!overrideMsg) {
      setMsgs((prev) => [...prev, { role: "user", text: userText }]);
    }
    setAiLoading(true);
    try {
      const ci = active?.clientInfo || {
        niche: "",
        audience: "",
        tone: "",
        pillars: "",
        competitors: "",
        notes: "",
      };
      const bS =
        ci.niche || ci.tone
          ? `\nClient: ${[ci.niche, ci.tone].filter(Boolean).join(", ")}.`
          : "";
      const sys = `You are a friendly, sharp Instagram content strategist — like a creative director texting a client.${bS} Grid has ${images.length} images.

Tone: conversational, warm, confident. Never robotic. Use "you/your" not "the brand." Keep it punchy.

Formatting rules:
- Use **bold** for key terms or emphasis
- Use short bullet points (• not -) for lists
- Use line breaks between sections
- Keep paragraphs to 1-2 sentences max
- Never use ### or giant headers — just **bold section titles** on their own line
- End with a quick actionable nudge when relevant

If asked to reorder by vibe AND images exist: give 1 casual sentence about the new vibe, then a JSON array of all ${images.length} indices in new order. Nothing else.`;
      const hist = msgs
        .filter((m) => m.role !== "sys")
        .map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.text,
        }));
      const kw =
        /rearrange|reorder|sort|layout|vibe|arrange|reorganize|order|dark|light|moody|minimal|vibrant|editorial|aesthetic|grid/i;
      const wantR = images.length > 0 && kw.test(userText);
      let uc:
        | string
        | {
            type: string;
            text?: string;
            source?: { type: string; media_type: string; data: string };
          }[] = userText;
      if (wantR) {
        const arr: {
          type: string;
          text?: string;
          source?: { type: string; media_type: string; data: string };
        }[] = [];
        images.forEach((img, i) => {
          arr.push({ type: "text", text: `Image ${i}:` });
          arr.push({
            type: "image",
            source: {
              type: "base64",
              media_type: img.src.split(";")[0].split(":")[1],
              data: img.src.split(",")[1],
            },
          });
        });
        arr.push({ type: "text", text: userText });
        uc = arr;
      }
      // Bug 1 fix: use /api/anthropic proxy
      const res = await fetch("/api/anthropic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 800,
          system: sys,
          messages: [...hist, { role: "user", content: uc }],
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.content) {
        setMsgs((prev) => [
          ...prev,
          {
            role: "ai",
            text: `⚠ ${data.error?.message || data.error?.error?.message || (typeof data.error === "string" ? data.error : null) || "API error — check your ANTHROPIC_API_KEY"}`,
          },
        ]);
        setAiLoading(false);
        return;
      }
      const text =
        data.content.find((b: { type: string }) => b.type === "text")
          ?.text || "";
      const jm = text.match(/\[[\d,\s]+\]/);
      const clean = text
        .replace(/\[[\d,\s]+\]/, "")
        .replace(/```json?|```/g, "")
        .trim();
      setMsgs((prev) => [
        ...prev,
        { role: "ai", text: clean || "(no response)" },
      ]);
      if (jm && wantR) {
        const order = JSON.parse(jm[0]) as number[];
        if (
          order.length === images.length &&
          new Set(order).size === images.length
        ) {
          updateProfile((p) => ({
            ...p,
            images: order.map((i) => p.images[i]),
          }));
          setMsgs((prev) => [
            ...prev,
            { role: "sys", text: "✦ GRID REORDERED" },
          ]);
        }
      }
    } catch {
      setMsgs((prev) => [
        ...prev,
        { role: "ai", text: "Error. Try again." },
      ]);
    }
    setAiLoading(false);
  }, [input, aiLoading, active, images, msgs, updateProfile]);

  // ── Import / Export ─────────────────────────────────────────────────────
  const exportAll = useCallback(() => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 5,
            exportedAt: new Date().toISOString(),
            profiles,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ig-planner-all-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [profiles]);

  const exportActive = useCallback(() => {
    if (!active) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 5,
            exportedAt: new Date().toISOString(),
            profiles: [active],
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ig-${active.name.replace(/\s+/g, "-")}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [active]);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) {
        setImportMsg("⚠ No file selected.");
        return;
      }
      e.target.value = "";
      setImportMsg(`⏳ Reading "${f.name}"…`);
      console.log("[import] selected:", f.name, f.type, f.size + "b");
      const reader = new FileReader();
      reader.onerror = () => {
        setImportMsg("⚠ Could not read file.");
        console.error("[import] FileReader error");
      };
      reader.onload = async (ev) => {
        console.log("[import] loaded, parsing…");
        try {
          const text = ev.target!.result as string;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(text);
          } catch (pe) {
            setImportMsg(
              `⚠ Not valid JSON: ${(pe as Error).message}`
            );
            console.error("[import] JSON parse failed", pe);
            return;
          }
          console.log("[import] JSON ok, keys:", Object.keys(data));
          const raw: Profile[] =
            (data.profiles as Profile[]) ||
            (Array.isArray(data)
              ? (data as Profile[])
              : (null as unknown as Profile[]));
          if (!raw?.length) {
            setImportMsg("⚠ No profiles found in file.");
            console.error("[import] no profiles array", data);
            return;
          }
          console.log("[import]", raw.length, "profile(s) found");
          if (
            !raw.every(
              (p) => p.id && p.name && Array.isArray(p.images)
            )
          ) {
            const bad = raw.find(
              (p) => !p.id || !p.name || !Array.isArray(p.images)
            );
            setImportMsg(
              `⚠ File corrupted — profile missing required fields.`
            );
            console.error("[import] validation failed on", bad);
            return;
          }
          const ep = emptyProfile();
          const incoming = raw.map((p) => ({
            ...ep,
            ...p,
            info: { ...ep.info, ...p.info },
            clientInfo: { ...ep.clientInfo, ...(p.clientInfo || {}) },
          }));
          let merged: Profile[];
          if (importMode === "replace") {
            merged = incoming;
          } else {
            const eIds = new Set(
              (profiles || []).map((p) => p.id)
            );
            merged = [
              ...(profiles || []),
              ...incoming.map((p) =>
                eIds.has(p.id)
                  ? { ...p, id: Date.now() + Math.random() + "" }
                  : p
              ),
            ];
          }
          setImportMsg(
            `⏳ Saving ${merged.length} profile${merged.length > 1 ? "s" : ""}…`
          );
          await Promise.all(merged.map((p) => saveProfile(p)));
          await saveIndex(
            merged.map((p) => ({ id: p.id, name: p.name }))
          );
          await saveActiveId(merged[0].id);
          const verifiedProfile = await loadProfile(merged[0].id);
          if (!verifiedProfile) {
            setImportMsg(
              "⚠ Save failed — storage full. Re-compress active profile first, then retry."
            );
            console.error(
              "[import] verify load returned null — localStorage quota exceeded"
            );
            return;
          }
          console.log("[import] verified ok, updating state");
          const sizes: Record<string, number> = {};
          merged.forEach((p) => {
            sizes[p.id] = calcBytes(p);
          });
          setProfiles(merged);
          setActiveId(merged[0].id);
          setProfileSizes(sizes);
          setUsedBytes(sizes[merged[0].id] || 0);
          setImportMsg(
            `✓ ${incoming.length} profile${incoming.length > 1 ? "s" : ""} imported.`
          );
        } catch (err) {
          setImportMsg(
            `⚠ Import error: ${(err as Error).message || "Unknown"}`
          );
          console.error("[import] unexpected:", err);
        }
      };
      reader.readAsText(f);
    },
    [importMode, profiles]
  );

  const recompressActive = useCallback(async () => {
    if (!active || recompressing) return;
    setRecompressing(true);
    const cArr = async (arr: ImageItem[]) =>
      Promise.all(
        arr.map(async (i) =>
          i.src?.startsWith("data:image/gif")
            ? i
            : { ...i, src: await compressImg(i.src) }
        )
      );
    const updated: Profile = {
      ...active,
      images: await cArr(active.images),
      library: await cArr(active.library),
      info: {
        ...active.info,
        avatar: active.info?.avatar
          ? await compressImg(active.info.avatar, AV_DIM, AV_Q)
          : null,
      },
      highlights: await Promise.all(
        (active.highlights || []).map(async (h) =>
          h.img
            ? { ...h, img: await compressImg(h.img, HL_DIM, HL_Q) }
            : h
        )
      ),
    };
    setProfiles((prev) =>
      (prev || []).map((p) => (p.id === activeId ? updated : p))
    );
    await saveProfile(updated);
    const bytes = calcBytes(updated);
    setUsedBytes(bytes);
    setProfileSizes((prev) => ({ ...prev, [activeId!]: bytes }));
    setRecompressing(false);
  }, [active, recompressing, activeId]);

  const togglePanel = useCallback(
    (id: string) => setActivePanel((prev) => (prev === id ? null : id)),
    []
  );

  // ── Shorthand style constants ───────────────────────────────────────────
  const S = SECTION_LABEL;
  const INP = INPUT_STYLE;
  const LBL = LABEL_STYLE;

  // ── Render ──────────────────────────────────────────────────────────────
  if (!loaded) return <LoadingBubble />;

  return (
    <>
      <style>{`*{box-sizing:border-box}body,html{margin:0;background:#ebebeb;}::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:#ddd;border-radius:4px}@keyframes pulse{0%,80%,100%{opacity:.15;transform:scale(.7)}40%{opacity:1;transform:scale(1)}}`}</style>

      <Suspense fallback={null}>
        {cropSrc && (
          <CropModal
            src={cropSrc}
            onConfirm={confirmCrop}
            onCancel={() => setCropSrc(null)}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {avatarImport && (
          <CircularCropModal
            src={avatarImport.screenshotSrc}
            label="Select Profile Photo"
            onConfirm={handleAvatarConfirm}
            onSkip={() => handleAvatarConfirm(null)}
            onSkipAll={() => {
              setAvatarImport(null);
              setMsgs((prev) => [
                ...prev,
                { role: "sys", text: "⚠ cancelled" },
              ]);
            }}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {highlightQueue && (
          <CircularCropModal
            src={highlightQueue.screenshotSrc}
            label={`Highlight — ${highlightQueue.labels[highlightQueue.currentIdx]}`}
            stepLabel={`Highlight ${highlightQueue.currentIdx + 1} of ${highlightQueue.labels.length}`}
            onConfirm={handleHighlightCrop}
            onSkip={() => handleHighlightCrop(null)}
            onSkipAll={() => {
              setHighlightQueue(null);
              setMsgs((prev) => [
                ...prev,
                { role: "sys", text: "✦ highlights skipped" },
              ]);
            }}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {previewMode && active && (
          <PreviewModal
            profile={active}
            igTab={igTab}
            onClose={() => setPreviewMode(false)}
          />
        )}
      </Suspense>

      {globalDragOver && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9990,
            background: "rgba(255,45,120,0.06)",
            border: `3px dashed ${PINK}`,
            borderRadius: 16,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "rgba(255,255,255,0.96)",
              borderRadius: 12,
              padding: "14px 28px",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "sans-serif",
              color: PINK,
              letterSpacing: 1,
              boxShadow: "0 4px 24px rgba(255,45,120,0.15)",
            }}
          >
            DROP TO ADD TO GRID
          </div>
        </div>
      )}

      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          justifyContent: "center",
          background: "#ebebeb",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            maxWidth: 1400,
            height: "100vh",
            padding: 14,
            gap: 10,
            overflow: "hidden",
          }}
          onDragEnter={handleGlobalDragEnter}
          onDragLeave={handleGlobalDragLeave}
          onDragOver={handleGlobalDragOver}
          onDrop={handleGlobalDrop}
        >
          {/* Top strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <ProfileSwitcher
              profiles={profiles}
              activeId={activeId}
              onSwitch={handleSwitch}
              onCreate={handleCreate}
              onRename={handleRename}
              onDelete={handleDelete}
            />

            <button
              onClick={() => profileSsRef.current?.click()}
              disabled={profileImporting}
              style={{
                padding: "6px 12px",
                background: "#fff",
                border: "1px solid #ddd",
                borderRadius: 8,
                color: profileImporting ? "#ccc" : "#555",
                fontSize: 11,
                fontFamily: "sans-serif",
                cursor: profileImporting ? "default" : "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                whiteSpace: "nowrap",
              }}
            >
              {profileImporting ? "⟳ reading..." : "⊕ Import Profile"}
            </button>

            {profileImportMsg && (
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "sans-serif",
                  color: "#e53e3e",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {profileImportMsg}
              </span>
            )}

            <input
              ref={profileSsRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={importProfileScreenshot}
            />

            <button
              onClick={() => togglePanel("backup")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                background: "#fff",
                border: `1px solid ${storagePct >= WARN_AT ? barC : "#ddd"}`,
                borderRadius: 8,
                cursor: "pointer",
                boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 4,
                  background: "#e0e0e0",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, storagePct * 100)}%`,
                    background: barC,
                    borderRadius: 3,
                    transition: "width .3s",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 9,
                  color: storagePct >= WARN_AT ? barC : "#888",
                  fontFamily: "sans-serif",
                  fontWeight: 700,
                }}
              >
                {storagePct >= DANGER_AT
                  ? "⚠ FULL"
                  : storagePct >= WARN_AT
                    ? "LOW"
                    : fmtBytes(usedBytes)}
              </span>
            </button>

            <span
              style={{
                fontSize: 10,
                color: "#aaa",
                fontFamily: "sans-serif",
              }}
            >
              {saveStatus === "saving"
                ? "saving..."
                : saveStatus === "saved"
                  ? "✓ saved"
                  : ""}
            </span>

            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 6,
                alignItems: "center",
              }}
            >
              <button onClick={undo} disabled={!canUndo} style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: canUndo ? "#fff" : "transparent", border: canUndo ? "1px solid #ddd" : "1px solid transparent", borderRadius: 7, color: canUndo ? "#333" : "#ccc", fontSize: 14, cursor: canUndo ? "pointer" : "default", transition: "all .15s", boxShadow: canUndo ? "0 2px 8px rgba(0,0,0,0.05)" : "none" }} title="Undo">↩</button>
              <button onClick={redo} disabled={!canRedo} style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: canRedo ? "#fff" : "transparent", border: canRedo ? "1px solid #ddd" : "1px solid transparent", borderRadius: 7, color: canRedo ? "#333" : "#ccc", fontSize: 14, cursor: canRedo ? "pointer" : "default", transition: "all .15s", boxShadow: canRedo ? "0 2px 8px rgba(0,0,0,0.05)" : "none" }} title="Redo">↪</button>
              <div style={{ width: 1, height: 18, background: "#e0e0e0", margin: "0 2px" }} />
              {confirmClear ? (
                <>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#888",
                      fontFamily: "sans-serif",
                      alignSelf: "center",
                    }}
                  >
                    Clear grid?
                  </span>
                  <button
                    onClick={() => {
                      updateProfile((p) => ({
                        ...p,
                        images: [],
                        queue: [],
                      }));
                      setConfirmClear(false);
                    }}
                    style={{
                      padding: "6px 12px",
                      background: "#000",
                      border: "none",
                      borderRadius: 7,
                      color: "#fff",
                      fontSize: 11,
                      fontFamily: "sans-serif",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    style={{
                      padding: "6px 12px",
                      background: "#fff",
                      border: "1px solid #ddd",
                      borderRadius: 7,
                      color: "#888",
                      fontSize: 11,
                      fontFamily: "sans-serif",
                      cursor: "pointer",
                    }}
                  >
                    No
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    if (images.length) setConfirmClear(true);
                  }}
                  disabled={!images.length}
                  style={{
                    padding: "6px 12px",
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: 7,
                    color: images.length ? "#555" : "#ccc",
                    fontSize: 11,
                    fontFamily: "sans-serif",
                    cursor: images.length ? "pointer" : "default",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  }}
                >
                  Clear Grid
                </button>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 0,
                  border: "1px solid #ddd",
                  borderRadius: 7,
                  overflow: "hidden",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                }}
              >
                {([2, 3, 4] as (2 | 3 | 4)[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setExportScale(s)}
                    style={{
                      padding: "6px 8px",
                      background: exportScale === s ? "#000" : "#fff",
                      border: "none",
                      color: exportScale === s ? "#fff" : "#888",
                      fontSize: 10,
                      fontFamily: "sans-serif",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {s}×
                  </button>
                ))}
              </div>

              <button
                onClick={exportFeedImage}
                disabled={exporting}
                style={{
                  padding: "6px 14px",
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: 7,
                  color: exporting ? "#ccc" : "#555",
                  fontSize: 11,
                  fontFamily: "sans-serif",
                  fontWeight: 600,
                  cursor: exporting ? "default" : "pointer",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  whiteSpace: "nowrap",
                }}
              >
                {exporting ? "⟳ exporting..." : "⬇ Export Image"}
              </button>

              <button
                onClick={() => ssRef.current?.click()}
                style={{
                  padding: "6px 14px",
                  background: "#000",
                  border: "none",
                  borderRadius: 7,
                  color: "#fff",
                  fontSize: 11,
                  fontFamily: "sans-serif",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                + Screenshot
              </button>
            </div>
          </div>

          {/* Main row */}
          <div
            style={{
              display: "flex",
              gap: 10,
              flex: 1,
              minHeight: 0,
              justifyContent: "center",
            }}
          >
            {/* Feed */}
            <div
              style={{
                width: 390,
                flexShrink: 0,
                background: "#fff",
                borderRadius: 16,
                boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ flex: 1, overflowY: "auto" }}>
                <div style={{ padding: "16px 14px 8px" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 18,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      onClick={() => avatarRef.current?.click()}
                      onDragOver={handleAvatarDragOver}
                      onDragLeave={handleAvatarDragLeave}
                      onDrop={handleAvatarDrop}
                      style={{
                        width: 77,
                        height: 77,
                        borderRadius: "50%",
                        flexShrink: 0,
                        cursor: "default",
                        background: info.avatar
                          ? `url(${info.avatar}) center/cover`
                          : "linear-gradient(135deg,#c13584,#e1306c,#fd1d1d,#fcaf45)",
                        boxShadow: avatarDragOver
                          ? `0 0 0 3px white,0 0 0 5px ${PINK}`
                          : "0 0 0 2px white,0 0 0 3.5px #c13584",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 24,
                        overflow: "hidden",
                        transition: "box-shadow .15s",
                        outline: avatarDragOver
                          ? `2px dashed ${PINK}`
                          : "none",
                        outlineOffset: 3,
                        position: "relative",
                      }}
                    >
                      {!info.avatar &&
                        (avatarDragOver ? "⊕" : "＋")}
                      {profileImporting && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            borderRadius: "50%",
                            background: "rgba(0,0,0,0.4)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            color: "#fff",
                            fontFamily: "sans-serif",
                          }}
                        >
                          ⟳
                        </div>
                      )}
                    </div>

                    <input
                      ref={avatarRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={addAvatar}
                    />

                    <div
                      style={{
                        display: "flex",
                        gap: 16,
                        flex: 1,
                        justifyContent: "space-around",
                      }}
                    >
                      <StatBlock
                        label="posts"
                        value={String(images.length)}
                        onChange={() => {}}
                      />
                      <StatBlock
                        label="followers"
                        value={info.followers || "0"}
                        onChange={updInfo("followers")}
                      />
                      <StatBlock
                        label="following"
                        value={info.following || "0"}
                        onChange={updInfo("following")}
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      fontFamily: "sans-serif",
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      <InlineText
                        value={info.name || ""}
                        onChange={updInfo("name")}
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          fontFamily: "sans-serif",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 13, color: "#888" }}>
                      @
                      <InlineText
                        value={info.username || ""}
                        onChange={updInfo("username")}
                        style={{
                          fontSize: 13,
                          color: "#888",
                          fontFamily: "sans-serif",
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      <InlineText
                        value={info.bio || ""}
                        onChange={updInfo("bio")}
                        multiline
                        style={{
                          fontSize: 13,
                          display: "block",
                          width: "100%",
                          fontFamily: "sans-serif",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 3,
                      }}
                    >
                      <span style={{ fontSize: 12, color: "#bbb", flexShrink: 0 }}>🔗</span>
                      {info.link ? (
                        <a
                          href={info.link}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            fontSize: 12,
                            color: "#3897f0",
                            fontFamily: "sans-serif",
                            textDecoration: "none",
                            wordBreak: "break-all",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {info.link.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <span
                          onClick={() => {
                            const url = prompt("Enter link URL:");
                            if (url) updInfo("link")(url);
                          }}
                          style={{ fontSize: 12, color: "#bbb", fontFamily: "sans-serif", cursor: "pointer" }}
                        >
                          Add link…
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = prompt("Edit link:", info.link || "");
                          if (url !== null) updInfo("link")(url);
                        }}
                        style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 4, background: "transparent", border: "none", cursor: "pointer", fontSize: 10, color: "#bbb", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                        title="Edit link"
                      >
                        ✎
                      </button>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 14,
                    padding: "6px 14px 12px",
                    overflowX: "auto",
                    alignItems: "flex-start",
                  }}
                >
                  {highlights.map((h) => (
                    <Highlight
                      key={h.id}
                      h={h}
                      onChange={updHighlight}
                      onDelete={() => removeHighlight(h.id)}
                    />
                  ))}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      flexShrink: 0,
                      paddingTop: 2,
                    }}
                  >
                    <button
                      onClick={addHighlight}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        border: "1.5px dashed #ddd",
                        background: "transparent",
                        color: "#bbb",
                        fontSize: 18,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        lineHeight: 1,
                      }}
                    >
                      +
                    </button>
                    {highlights.length > 0 && (
                      <button
                        onClick={() =>
                          updateProfile((p) => ({
                            ...p,
                            highlights: [],
                          }))
                        }
                        style={{
                          fontSize: 9,
                          color: "#ccc",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "sans-serif",
                          whiteSpace: "nowrap",
                          padding: 0,
                          textAlign: "center",
                        }}
                      >
                        clear
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    borderTop: "1px solid #dbdbdb",
                    marginBottom: 2,
                  }}
                >
                  {["⊞", "▶", "☆"].map((icon, i) => (
                    <div
                      key={i}
                      onClick={() => setIgTab(i)}
                      style={{
                        flex: 1,
                        textAlign: "center",
                        padding: "10px 0",
                        fontSize: 17,
                        cursor: "pointer",
                        borderBottom:
                          igTab === i
                            ? "2px solid #000"
                            : "2px solid transparent",
                        color: igTab === i ? "#000" : "#bbb",
                        transition: "all .15s",
                      }}
                    >
                      {icon}
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3,1fr)",
                    gap: 2,
                  }}
                >
                  {images.map((img, idx) => {
                    const qPos = queue.indexOf(img.id);
                    return (
                      <GridTile
                        key={img.id}
                        img={img}
                        idx={idx}
                        ratioPad={ratioPad}
                        dragIdx={dragIdx}
                        overIdx={overIdx}
                        onDragStart={onDragStart}
                        onDragOver={onDragOver}
                        onDrop={onDrop}
                        onDragEnd={onDragEnd}
                        onSwap={() => openSwap(idx)}
                        onRemove={() => removeImg(idx)}
                        queuePos={qPos >= 0 ? qPos + 1 : null}
                        hasCaption={!!captions[img.id]?.approved}
                        onCaption={() => {
                          setCaptionTileIdx(idx);
                          setActivePanel("caption");
                        }}
                      />
                    );
                  })}

                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverIdx(images.length);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isFileDrag(e)) {
                        const files = Array.from(
                          e.dataTransfer.files
                        ).filter((f) => f.type.startsWith("image/"));
                        if (files.length)
                          Promise.all(
                            files.map(async (f) => ({
                              id: Date.now() + Math.random() + "",
                              src: await readAndCompress(f),
                            }))
                          ).then(addToLibraryAndGrid);
                        dragCountRef.current = 0;
                        setGlobalDragOver(false);
                      } else onDrop(e, images.length);
                      setOverIdx(null);
                    }}
                    onClick={() => fileRef.current?.click()}
                    style={{
                      position: "relative",
                      width: "100%",
                      paddingBottom: ratioPad,
                      background:
                        overIdx === images.length
                          ? "#fff0f4"
                          : "#f8f8f8",
                      border: `2px dashed ${overIdx === images.length ? PINK : "#e0e0e0"}`,
                      cursor: "pointer",
                      transition: "all .15s",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#ccc",
                        fontSize: 26,
                      }}
                    >
                      +
                    </div>
                  </div>
                </div>

                <div style={{ height: 30 }} />
              </div>
            </div>

            {/* Sidebar */}
            <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  alignSelf: "flex-start",
                  paddingTop: 4,
                  flexShrink: 0,
                }}
              >
                <CircleBtn
                  icon="✦"
                  label="AI Chat"
                  active={activePanel === "chat"}
                  onClick={() => togglePanel("chat")}
                />
                <CircleBtn
                  icon="⊞"
                  label="Library"
                  active={activePanel === "library"}
                  badge={library.length}
                  onClick={() => togglePanel("library")}
                />
                <CircleBtn
                  icon="◷"
                  label="Schedule"
                  active={activePanel === "schedule"}
                  badge={queue.length}
                  onClick={() => togglePanel("schedule")}
                />
                <CircleBtn
                  icon="◎"
                  label="Client"
                  active={activePanel === "client"}
                  onClick={() => togglePanel("client")}
                />
                <CircleBtn
                  icon="⊙"
                  label="Backup"
                  active={activePanel === "backup"}
                  warn={storagePct >= WARN_AT}
                  onClick={() => togglePanel("backup")}
                />
                {captionTileIdx != null && (
                  <CircleBtn
                    icon="✎"
                    label="Caption"
                    active={activePanel === "caption"}
                    onClick={() => setActivePanel("caption")}
                  />
                )}
                <div
                  style={{
                    height: 1,
                    background: "#ddd",
                    margin: "2px 6px",
                  }}
                />
                <CircleBtn
                  icon="⊡"
                  label="Full Preview"
                  active={false}
                  onClick={() => setPreviewMode(true)}
                />
              </div>

              {activePanel && (
                <div
                  style={{
                    width: 360,
                    flexShrink: 0,
                    background: "#fff",
                    borderRadius: 16,
                    boxShadow: "0 8px 40px rgba(0,0,0,0.08)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      padding: "14px 18px",
                      borderBottom: "1px solid #f0f0f0",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        fontFamily: "sans-serif",
                      }}
                    >
                      {panelTitles[activePanel] || ""}
                    </div>
                    {activePanel === "caption" &&
                      captionTileIdx != null && (
                        <button
                          onClick={() => {
                            setCaptionTileIdx(null);
                            setActivePanel(null);
                          }}
                          style={{
                            padding: "4px 10px",
                            background: "transparent",
                            border: "1px solid #e0e0e0",
                            borderRadius: 6,
                            fontSize: 11,
                            color: "#555",
                            fontFamily: "sans-serif",
                            cursor: "pointer",
                          }}
                        >
                          ← Back
                        </button>
                      )}
                    {activePanel === "caption" &&
                      captions[captionImg?.id || ""]?.approved && (
                        <span
                          style={{
                            fontSize: 10,
                            color: PINK,
                            fontFamily: "sans-serif",
                            fontWeight: 700,
                          }}
                        >
                          ✓ APPROVED
                        </span>
                      )}
                    {activePanel === "backup" &&
                      storagePct >= DANGER_AT && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "#e53e3e",
                            fontWeight: 700,
                            fontFamily: "sans-serif",
                          }}
                        >
                          ⚠ PROFILE FULL
                        </span>
                      )}
                    <button
                      onClick={() => setActivePanel(null)}
                      style={{
                        marginLeft: "auto",
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: "#f5f5f5",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#555",
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {activePanel === "chat" && (
                    <>
                      {/* Messages */}
                      <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px", display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
                        {!msgs.length && (
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 14, padding: "30px 10px" }}>
                            <div style={{ width: 44, height: 44, borderRadius: 14, background: "linear-gradient(135deg, #f5f5f5, #eee)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✦</div>
                            <div style={{ fontSize: 14, color: "#444", fontFamily: "sans-serif", fontWeight: 600 }}>What vibe are we going for?</div>
                            <div style={{ fontSize: 11, color: "#aaa", fontFamily: "sans-serif", maxWidth: 220, textAlign: "center", lineHeight: 1.5 }}>I can rearrange your grid, find content gaps, or brainstorm captions</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginTop: 2 }}>
                              {["moody editorial", "warm & vibrant", "dark minimal", "what's missing?"].map((t, i) => (
                                <button key={i} onClick={() => sendMsg(t)} className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-500 transition-all hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700 active:scale-95" style={{ fontFamily: "sans-serif" }}>
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {msgs.map((m, i) => {
                          if (m.role === "sys")
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                                <div style={{ flex: 1, height: 1, background: "#f0f0f0" }} />
                                <span style={{ color: "#c0c0c0", fontSize: 9, fontFamily: "sans-serif", whiteSpace: "nowrap", letterSpacing: 0.8, fontWeight: 500, textTransform: "uppercase" }}>{m.text}</span>
                                <div style={{ flex: 1, height: 1, background: "#f0f0f0" }} />
                              </div>
                            );
                          if (m.role === "user")
                            return (
                              <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
                                <div style={{ maxWidth: "85%", padding: "10px 14px", background: "#111", borderRadius: "18px 18px 4px 18px", color: "#fff", fontSize: 12.5, lineHeight: 1.5, fontFamily: "sans-serif", fontWeight: 400 }}>{m.text}</div>
                              </div>
                            );
                          return (
                            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 2 }}>
                              <div style={{ width: 28, height: 28, borderRadius: 10, background: "linear-gradient(135deg, #f0f0f0, #e8e8e8)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 10, fontFamily: "sans-serif", fontWeight: 700 }}>✦</div>
                              <div style={{ maxWidth: "88%", padding: "10px 14px", background: "#fafafa", borderRadius: "4px 18px 18px 18px", color: "#333", fontSize: 12.5, lineHeight: 1.6, fontFamily: "sans-serif", border: "1px solid #f0f0f0" }}>{renderAiText(m.text)}</div>
                            </div>
                          );
                        })}

                        {aiLoading && (
                          <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 2 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 10, background: "linear-gradient(135deg, #f0f0f0, #e8e8e8)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 10, fontFamily: "sans-serif", fontWeight: 700 }}>✦</div>
                            <div style={{ padding: "10px 14px", background: "#fafafa", borderRadius: "4px 18px 18px 18px", border: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 2 }}>
                              <TypingEffect texts={["thinking", "analyzing", "crafting"]} className="!text-xs !font-normal text-gray-400" typingSpeed={80} rotationInterval={2000} />
                            </div>
                          </div>
                        )}
                        <div ref={chatEnd} />
                      </div>

                      {/* Input area */}
                      <div style={{ padding: "10px 12px", flexShrink: 0 }}>
                        <div style={{ border: "1px solid #e8e8e8", borderRadius: 20, padding: "8px 12px", background: "#fff", boxShadow: "0 1px 8px rgba(0,0,0,0.03)", transition: "all .2s" }}>
                          <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
                            placeholder={images.length ? "Describe the vibe or ask anything..." : "Upload images first..."}
                            disabled={aiLoading}
                            rows={1}
                            style={{ width: "100%", background: "transparent", border: "none", outline: "none", resize: "none", color: "#222", fontSize: 13, fontFamily: "sans-serif", lineHeight: 1.5, padding: "2px 0", minHeight: 24 }}
                          />
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                            <div className="flex items-center gap-0.5">
                              {[
                                { label: "Grid", icon: "⊞", action: () => { if (!images.length || aiLoading) return; setMsgs((p) => [...p, { role: "user", text: "✦ Auto-arrange grid" }]); setAiLoading(true); sendMsg("Reorder my grid for the best aesthetic flow — alternate tones, balance light and dark, create visual rhythm"); }, disabled: !images.length || aiLoading },
                                { label: gapLoading ? "Scanning..." : "Gaps", icon: "◎", action: () => { if (images.length && !gapLoading) detectGaps({ toChat: true }); }, disabled: !images.length || gapLoading },
                                { label: "Caption", icon: "✎", action: () => { if (!images.length || aiLoading) return; setMsgs((p) => [...p, { role: "user", text: "✦ Caption ideas" }]); setAiLoading(true); sendMsg("Suggest 3 caption ideas for my next post — short, punchy, on-brand"); }, disabled: !images.length || aiLoading },
                                { label: "Crop", icon: "⊡", action: () => ssRef.current?.click(), disabled: false },
                              ].map((btn, idx) => (
                                <button
                                  key={idx}
                                  onClick={btn.action}
                                  disabled={btn.disabled}
                                  className="rounded-full border border-transparent px-2.5 py-1 text-[10px] font-medium text-gray-400 transition-all hover:border-gray-200 hover:bg-gray-50 hover:text-gray-600 disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent"
                                  style={{ fontFamily: "sans-serif", height: 26 }}
                                >
                                  {btn.icon} {btn.label}
                                </button>
                              ))}
                            </div>
                            <button
                              onClick={() => sendMsg()}
                              disabled={aiLoading || !input.trim()}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all duration-150"
                              style={{ background: !aiLoading && input.trim() ? "#111" : "#f0f0f0", color: !aiLoading && input.trim() ? "#fff" : "#bbb", border: "none", fontSize: 13, cursor: !aiLoading && input.trim() ? "pointer" : "default" }}
                            >
                              ↑
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {activePanel === "library" && (
                    <div
                      style={{ flex: 1, overflowY: "auto", padding: 16 }}
                    >
                      {!library.length ? (
                        <div
                          style={{
                            color: "#ccc",
                            fontSize: 13,
                            fontFamily: "sans-serif",
                            textAlign: "center",
                            marginTop: 40,
                          }}
                        >
                          No photos yet.
                        </div>
                      ) : (
                        <>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 12,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 11,
                                color: "#bbb",
                                fontFamily: "sans-serif",
                              }}
                            >
                              Drag into the grid, or click + to add.
                            </div>
                            <button
                              onClick={() =>
                                updateProfile((p) => ({
                                  ...p,
                                  images: [
                                    ...p.library.map((i) => ({
                                      id:
                                        Date.now() +
                                        Math.random() +
                                        "",
                                      src: i.src,
                                    })),
                                    ...p.images,
                                  ],
                                }))
                              }
                              style={{
                                padding: "5px 12px",
                                background: "#000",
                                border: "none",
                                borderRadius: 6,
                                color: "#fff",
                                fontSize: 11,
                                fontFamily: "sans-serif",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              Add All
                            </button>
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(3,1fr)",
                              gap: 6,
                            }}
                          >
                            {library.map((img) => (
                              <div
                                key={img.id}
                                draggable
                                onDragStart={(e) =>
                                  onLibDragStart(e, img.id)
                                }
                                style={{
                                  position: "relative",
                                  width: "100%",
                                  paddingBottom: "100%",
                                  overflow: "hidden",
                                  borderRadius: 8,
                                  cursor: "grab",
                                  border: "1px solid #efefef",
                                }}
                              >
                                <img
                                  src={img.src}
                                  alt=""
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    width: "100%",
                                    height: "100%",
                                    objectFit: "cover",
                                    display: "block",
                                    pointerEvents: "none",
                                  }}
                                />
                                <div
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    background: "rgba(0,0,0,0)",
                                    transition: ".15s",
                                    display: "flex",
                                    alignItems: "flex-start",
                                    justifyContent: "space-between",
                                    padding: 5,
                                  }}
                                  onMouseEnter={(e) =>
                                    ((
                                      e.currentTarget as HTMLDivElement
                                    ).style.background =
                                      "rgba(0,0,0,0.28)")
                                  }
                                  onMouseLeave={(e) =>
                                    ((
                                      e.currentTarget as HTMLDivElement
                                    ).style.background =
                                      "rgba(0,0,0,0)")
                                  }
                                >
                                  <button
                                    onClick={() => {
                                      const n = {
                                        id:
                                          Date.now() +
                                          Math.random() +
                                          "",
                                        src: img.src,
                                      };
                                      updateProfile((p) => ({
                                        ...p,
                                        images: [n, ...p.images],
                                      }));
                                    }}
                                    style={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: 4,
                                      background:
                                        "rgba(255,255,255,0.92)",
                                      border: "none",
                                      cursor: "pointer",
                                      fontSize: 14,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "#000",
                                      fontWeight: 700,
                                    }}
                                  >
                                    +
                                  </button>
                                  <button
                                    onClick={() =>
                                      removeFromLibrary(img.id)
                                    }
                                    style={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: 4,
                                      background: "rgba(0,0,0,0.65)",
                                      border: "none",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "#fff",
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {activePanel === "schedule" && (
                    <div
                      style={{ flex: 1, overflowY: "auto", padding: 16 }}
                    >
                      {!images.length ? (
                        <div
                          style={{
                            color: "#ccc",
                            fontSize: 13,
                            fontFamily: "sans-serif",
                            textAlign: "center",
                            marginTop: 40,
                          }}
                        >
                          Add images to the grid first.
                        </div>
                      ) : (
                        <>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              marginBottom: 10,
                            }}
                          >
                            <div style={S}>
                              Queue ({queue.length})
                            </div>
                            {queue.length > 0 && (
                              <button
                                onClick={applyQueueToGrid}
                                style={{
                                  padding: "5px 12px",
                                  background: "#000",
                                  border: "none",
                                  borderRadius: 6,
                                  color: "#fff",
                                  fontSize: 11,
                                  fontFamily: "sans-serif",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                Apply to Grid
                              </button>
                            )}
                          </div>

                          {!queue.length && (
                            <div
                              style={{
                                fontSize: 12,
                                color: "#bbb",
                                fontFamily: "sans-serif",
                                padding: 14,
                                background: "#f8f8f8",
                                borderRadius: 8,
                                textAlign: "center",
                                marginBottom: 16,
                              }}
                            >
                              No posts queued. Add below.
                            </div>
                          )}

                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                              marginBottom: 20,
                            }}
                          >
                            {queue.map((imgId, qi) => {
                              const img = images.find(
                                (x) => x.id === imgId
                              );
                              if (!img) return null;
                              const gp = images.findIndex(
                                (x) => x.id === imgId
                              );
                              const cap =
                                captions[imgId]?.approved;
                              const pd =
                                scheduleData[imgId]?.postDate ||
                                "";
                              return (
                                <div
                                  key={imgId}
                                  draggable
                                  onDragStart={(e) =>
                                    onSD(e, qi)
                                  }
                                  onDragOver={(e) =>
                                    onSOv(e, qi)
                                  }
                                  onDrop={(e) =>
                                    onSDrop(e, qi)
                                  }
                                  onDragEnd={() => {
                                    setSchedDrag(null);
                                    setSchedOver(null);
                                  }}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "10px 12px",
                                    background: "#fff",
                                    borderRadius: 10,
                                    border: `1.5px solid ${schedOver === qi ? PINK : "#e0e0e0"}`,
                                    cursor: "grab",
                                    opacity:
                                      schedDrag === qi ? 0.4 : 1,
                                  }}
                                >
                                  <div
                                    style={{
                                      color: "#ccc",
                                      fontSize: 14,
                                      flexShrink: 0,
                                    }}
                                  >
                                    ⠿
                                  </div>
                                  <div
                                    style={{
                                      width: 14,
                                      height: 14,
                                      borderRadius: "50%",
                                      background: "#000",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "#fff",
                                      fontSize: 9,
                                      fontWeight: 700,
                                      fontFamily: "sans-serif",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {qi + 1}
                                  </div>
                                  <div
                                    style={{
                                      width: 38,
                                      height: 38,
                                      borderRadius: 6,
                                      overflow: "hidden",
                                      flexShrink: 0,
                                    }}
                                  >
                                    <img
                                      src={img.src}
                                      style={{
                                        width: "100%",
                                        height: "100%",
                                        objectFit: "cover",
                                        display: "block",
                                      }}
                                    />
                                  </div>
                                  <div
                                    style={{
                                      flex: 1,
                                      minWidth: 0,
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: 11,
                                        fontWeight: 600,
                                        fontFamily:
                                          "sans-serif",
                                      }}
                                    >
                                      Tile #{gp + 1}
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 10,
                                        color: "#aaa",
                                        fontFamily:
                                          "sans-serif",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow:
                                          "ellipsis",
                                      }}
                                    >
                                      {cap
                                        ? cap.substring(
                                            0,
                                            44
                                          ) +
                                          (cap.length > 44
                                            ? "..."
                                            : "")
                                        : "no caption"}
                                    </div>
                                  </div>
                                  <input
                                    type="date"
                                    value={pd}
                                    onChange={(e) =>
                                      updatePostDate(
                                        imgId,
                                        e.target.value
                                      )
                                    }
                                    style={{
                                      border:
                                        "1px solid #e0e0e0",
                                      borderRadius: 6,
                                      padding: "4px 6px",
                                      fontSize: 11,
                                      fontFamily:
                                        "sans-serif",
                                      color: "#555",
                                      background: "#fafafa",
                                      outline: "none",
                                      width: 120,
                                      flexShrink: 0,
                                    }}
                                  />
                                  <button
                                    onClick={() =>
                                      removeFromQueue(imgId)
                                    }
                                    style={{
                                      width: 20,
                                      height: 20,
                                      borderRadius: 4,
                                      background:
                                        "transparent",
                                      border:
                                        "1px solid #e0e0e0",
                                      cursor: "pointer",
                                      fontSize: 12,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent:
                                        "center",
                                      color: "#ccc",
                                      flexShrink: 0,
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          {images.filter(
                            (img) => !queue.includes(img.id)
                          ).length > 0 && (
                            <>
                              <div
                                style={{
                                  ...S,
                                  marginBottom: 10,
                                }}
                              >
                                Unscheduled (
                                {
                                  images.filter(
                                    (i) =>
                                      !queue.includes(i.id)
                                  ).length
                                }
                                )
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}
                              >
                                {images.map((img, gp) => {
                                  if (
                                    queue.includes(img.id)
                                  )
                                    return null;
                                  const cap =
                                    captions[img.id]
                                      ?.approved;
                                  return (
                                    <div
                                      key={img.id}
                                      style={{
                                        display: "flex",
                                        alignItems:
                                          "center",
                                        gap: 8,
                                        padding:
                                          "10px 12px",
                                        background: "#fff",
                                        borderRadius: 10,
                                        border:
                                          "1px solid #f0f0f0",
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: 38,
                                          height: 38,
                                          borderRadius: 6,
                                          overflow:
                                            "hidden",
                                          flexShrink: 0,
                                        }}
                                      >
                                        <img
                                          src={img.src}
                                          style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit:
                                              "cover",
                                            display:
                                              "block",
                                          }}
                                        />
                                      </div>
                                      <div
                                        style={{
                                          flex: 1,
                                          minWidth: 0,
                                        }}
                                      >
                                        <div
                                          style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            fontFamily:
                                              "sans-serif",
                                            color: "#666",
                                          }}
                                        >
                                          Tile #{gp + 1}
                                        </div>
                                        <div
                                          style={{
                                            fontSize: 10,
                                            color: "#aaa",
                                            fontFamily:
                                              "sans-serif",
                                            whiteSpace:
                                              "nowrap",
                                            overflow:
                                              "hidden",
                                            textOverflow:
                                              "ellipsis",
                                          }}
                                        >
                                          {cap
                                            ? cap.substring(
                                                0,
                                                44
                                              ) +
                                              (cap.length >
                                              44
                                                ? "..."
                                                : "")
                                            : "no caption"}
                                        </div>
                                      </div>
                                      <button
                                        onClick={() =>
                                          addToQueue(
                                            img.id
                                          )
                                        }
                                        style={{
                                          padding:
                                            "5px 12px",
                                          background:
                                            "#000",
                                          border: "none",
                                          borderRadius: 6,
                                          color: "#fff",
                                          fontSize: 11,
                                          fontFamily:
                                            "sans-serif",
                                          fontWeight: 600,
                                          cursor:
                                            "pointer",
                                          flexShrink: 0,
                                        }}
                                      >
                                        + Queue
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {activePanel === "client" && (
                    <div
                      style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                      }}
                    >
                      <div
                        style={{
                          background: "#fff",
                          border: "1px solid #f0f0f0",
                          borderRadius: 12,
                          padding: 16,
                        }}
                      >
                        <div
                          onClick={() => setContextOpen((o) => !o)}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            cursor: "pointer",
                            marginBottom: contextOpen ? 14 : 0,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 10, color: "#bbb", transition: "transform .2s", transform: contextOpen ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
                            <div style={S}>Context (Optional)</div>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              alignItems: "center",
                            }}
                          >
                            {clientSaved && (
                              <span
                                style={{
                                  fontSize: 10,
                                  color: PINK,
                                  fontFamily: "sans-serif",
                                  fontWeight: 700,
                                }}
                              >
                                ✓ Saved
                              </span>
                            )}
                            {contextOpen && (
                              <button
                                onClick={(e) => { e.stopPropagation(); saveClientInfo(); }}
                                style={{
                                  padding: "5px 12px",
                                  background: "#000",
                                  border: "none",
                                  borderRadius: 6,
                                  color: "#fff",
                                  fontSize: 11,
                                  fontFamily: "sans-serif",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                Save
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "#aaa", fontFamily: "sans-serif", marginBottom: contextOpen ? 10 : 0, display: contextOpen ? "none" : "block" }}>
                          AI will infer context from your images. Add details here to improve results.
                        </div>
                        <div
                          style={{
                            display: contextOpen ? "flex" : "none",
                            flexDirection: "column",
                            gap: 10,
                          }}
                        >
                          {(
                            [
                              [
                                "niche",
                                "Niche / Industry",
                                "e.g. Sustainable fashion",
                                "input",
                              ],
                              [
                                "audience",
                                "Target Audience",
                                "e.g. Women 25-40, eco-conscious",
                                "textarea",
                              ],
                              [
                                "tone",
                                "Brand Voice & Tone",
                                "e.g. Bold, minimal, editorial",
                                "input",
                              ],
                              [
                                "pillars",
                                "Content Pillars",
                                "e.g. Product, BTS, lifestyle, UGC",
                                "textarea",
                              ],
                              [
                                "competitors",
                                "Competitors / References",
                                "e.g. @brand1, @brand2",
                                "input",
                              ],
                              [
                                "notes",
                                "Additional Notes",
                                "Anything else the AI should know",
                                "textarea",
                              ],
                            ] as [
                              keyof ClientInfo,
                              string,
                              string,
                              string,
                            ][]
                          ).map(([k, l, ph, t]) => (
                            <div key={k}>
                              <label style={LBL}>{l}</label>
                              {t === "textarea" ? (
                                <textarea
                                  value={clientForm[k]}
                                  onChange={(e) =>
                                    setClientForm((f) => ({
                                      ...f,
                                      [k]: e.target.value,
                                    }))
                                  }
                                  placeholder={ph}
                                  rows={2}
                                  style={{
                                    ...INP,
                                    resize:
                                      "vertical" as const,
                                    lineHeight: 1.6,
                                    padding: "8px 12px",
                                  }}
                                />
                              ) : (
                                <input
                                  value={clientForm[k]}
                                  onChange={(e) =>
                                    setClientForm((f) => ({
                                      ...f,
                                      [k]: e.target.value,
                                    }))
                                  }
                                  placeholder={ph}
                                  style={INP}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div
                        style={{
                          background: "#fff",
                          border: "1px solid #f0f0f0",
                          borderRadius: 12,
                          padding: 16,
                        }}
                      >
                        <div style={S}>
                          Content Gap Detection
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#bbb",
                            fontFamily: "sans-serif",
                            margin: "4px 0 12px",
                          }}
                        >
                          AI scans the grid against client context
                          and finds what&apos;s missing.
                        </div>
                        <button
                          onClick={() => detectGaps()}
                          disabled={
                            gapLoading || !images.length
                          }
                          style={{
                            width: "100%",
                            padding: "10px 0",
                            background:
                              gapLoading || !images.length
                                ? "#f0f0f0"
                                : "#000",
                            border: "none",
                            borderRadius: 8,
                            color:
                              gapLoading || !images.length
                                ? "#bbb"
                                : "#fff",
                            fontSize: 12,
                            fontFamily: "sans-serif",
                            fontWeight: 600,
                            cursor:
                              gapLoading || !images.length
                                ? "default"
                                : "pointer",
                            marginBottom: 12,
                          }}
                        >
                          {gapLoading
                            ? "⟳ Analyzing..."
                            : !images.length
                              ? "Add images first"
                              : "⊙ Scan for Content Gaps"}
                        </button>
                        {gapResult && (
                          <div
                            style={{
                              background: "#f8f8f8",
                              borderRadius: 10,
                              padding: 14,
                              border: "1px solid #f0f0f0",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 12,
                                color: "#222",
                                fontFamily: "sans-serif",
                                lineHeight: 1.75,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {gapResult}
                            </div>
                            <button
                              onClick={() =>
                                setGapResult("")
                              }
                              style={{
                                marginTop: 10,
                                padding: "4px 12px",
                                background: "transparent",
                                border:
                                  "1px solid #e0e0e0",
                                borderRadius: 6,
                                fontSize: 11,
                                color: "#aaa",
                                fontFamily: "sans-serif",
                                cursor: "pointer",
                              }}
                            >
                              Clear
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activePanel === "backup" && (
                    <div
                      style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                      }}
                    >
                      <div
                        style={{
                          background:
                            storagePct >= DANGER_AT
                              ? "#fff5f5"
                              : storagePct >= WARN_AT
                                ? "#fffbeb"
                                : "#f8f8f8",
                          border: `1.5px solid ${storagePct >= DANGER_AT ? "#fca5a5" : storagePct >= WARN_AT ? "#fcd34d" : "#f0f0f0"}`,
                          borderRadius: 12,
                          padding: 14,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 8,
                          }}
                        >
                          <div style={S}>
                            Active Profile Storage
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              fontFamily: "sans-serif",
                              color:
                                storagePct >= DANGER_AT
                                  ? "#e53e3e"
                                  : storagePct >= WARN_AT
                                    ? "#d69e2e"
                                    : "#000",
                            }}
                          >
                            {fmtBytes(usedBytes)} /{" "}
                            {fmtBytes(PER_KEY_LIMIT)}
                          </div>
                        </div>
                        <div
                          style={{
                            height: 7,
                            background: "#e0e0e0",
                            borderRadius: 4,
                            overflow: "hidden",
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.min(100, storagePct * 100).toFixed(1)}%`,
                              background: barC,
                              borderRadius: 4,
                              transition: "width .4s",
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            fontFamily: "sans-serif",
                            color:
                              storagePct >= DANGER_AT
                                ? "#e53e3e"
                                : storagePct >= WARN_AT
                                  ? "#d69e2e"
                                  : "#68a070",
                            fontWeight: 500,
                            marginBottom: 4,
                          }}
                        >
                          {storagePct >= DANGER_AT
                            ? "⚠ Profile full — export backup and re-compress."
                            : storagePct >= WARN_AT
                              ? "⚡ Getting full — run re-compress."
                              : `✓ ${fmtBytes(PER_KEY_LIMIT - usedBytes)} remaining`}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "#bbb",
                            fontFamily: "sans-serif",
                          }}
                        >
                          {images.length} images · each profile
                          has its own 5MB slot
                        </div>
                      </div>

                      {profiles.length > 1 && (
                        <div
                          style={{
                            background: "#f8f8f8",
                            border: "1px solid #f0f0f0",
                            borderRadius: 12,
                            padding: 14,
                          }}
                        >
                          <div
                            style={{
                              ...S,
                              marginBottom: 10,
                            }}
                          >
                            All Profiles
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                            }}
                          >
                            {profiles.map((p) => {
                              const bytes =
                                profileSizes[p.id] || 0;
                              const pct =
                                bytes / PER_KEY_LIMIT;
                              const c =
                                pct >= DANGER_AT
                                  ? "#e53e3e"
                                  : pct >= WARN_AT
                                    ? "#f6ad55"
                                    : "#48bb78";
                              return (
                                <div
                                  key={p.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "8px 10px",
                                    background: "#fff",
                                    borderRadius: 8,
                                    border:
                                      "1px solid #e0e0e0",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontFamily:
                                        "sans-serif",
                                      fontWeight:
                                        p.id === activeId
                                          ? 700
                                          : 400,
                                      color: "#000",
                                      width: 100,
                                      overflow: "hidden",
                                      textOverflow:
                                        "ellipsis",
                                      whiteSpace: "nowrap",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {p.name}
                                  </div>
                                  <div
                                    style={{
                                      flex: 1,
                                      height: 4,
                                      background:
                                        "#e0e0e0",
                                      borderRadius: 3,
                                      overflow: "hidden",
                                    }}
                                  >
                                    <div
                                      style={{
                                        height: "100%",
                                        width: `${Math.min(100, pct * 100)}%`,
                                        background: c,
                                        borderRadius: 3,
                                      }}
                                    />
                                  </div>
                                  <div
                                    style={{
                                      fontSize: 10,
                                      color: "#888",
                                      fontFamily:
                                        "sans-serif",
                                      flexShrink: 0,
                                      width: 50,
                                      textAlign: "right",
                                    }}
                                  >
                                    {fmtBytes(bytes)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div
                        style={{
                          background: "#f8f8f8",
                          border: "1px solid #f0f0f0",
                          borderRadius: 12,
                          padding: 14,
                        }}
                      >
                        <div style={{ ...S, marginBottom: 4 }}>
                          Re-compress Active Profile
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#bbb",
                            fontFamily: "sans-serif",
                            marginBottom: 12,
                          }}
                        >
                          800px / 68% JPEG on all images.
                          Typically saves 40–70%.
                        </div>
                        <div
                          style={{ display: "flex", gap: 8 }}
                        >
                          <button
                            onClick={recompressActive}
                            disabled={
                              recompressing || !images.length
                            }
                            style={{
                              flex: 1,
                              padding: "9px 0",
                              background:
                                recompressing ||
                                !images.length
                                  ? "#f0f0f0"
                                  : "#000",
                              border: "none",
                              borderRadius: 8,
                              color:
                                recompressing ||
                                !images.length
                                  ? "#bbb"
                                  : "#fff",
                              fontSize: 12,
                              fontFamily: "sans-serif",
                              fontWeight: 600,
                              cursor:
                                recompressing ||
                                !images.length
                                  ? "default"
                                  : "pointer",
                            }}
                          >
                            {recompressing
                              ? "⟳ Compressing..."
                              : !images.length
                                ? "No images"
                                : "⊙ Re-compress Now"}
                          </button>
                          <button
                            onClick={() =>
                              updateProfile((p) => ({
                                ...p,
                                library: [],
                              }))
                            }
                            disabled={!library.length}
                            style={{
                              padding: "9px 14px",
                              background: "transparent",
                              border: "1px solid #ddd",
                              borderRadius: 8,
                              color: library.length
                                ? "#555"
                                : "#ccc",
                              fontSize: 12,
                              fontFamily: "sans-serif",
                              cursor: library.length
                                ? "pointer"
                                : "default",
                            }}
                          >
                            Clear Library
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          background: "#f8f8f8",
                          border: "1px solid #f0f0f0",
                          borderRadius: 12,
                          padding: 14,
                        }}
                      >
                        <div
                          style={{ ...S, marginBottom: 10 }}
                        >
                          Export Backup
                        </div>
                        <div
                          style={{ display: "flex", gap: 8 }}
                        >
                          <button
                            onClick={exportAll}
                            style={{
                              flex: 1,
                              padding: "9px 0",
                              background: "#000",
                              border: "none",
                              borderRadius: 8,
                              color: "#fff",
                              fontSize: 12,
                              fontFamily: "sans-serif",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            ⬇ All ({profiles.length})
                          </button>
                          <button
                            onClick={exportActive}
                            style={{
                              flex: 1,
                              padding: "9px 0",
                              background: "transparent",
                              border: "1px dashed #ddd",
                              borderRadius: 8,
                              color: "#555",
                              fontSize: 12,
                              fontFamily: "sans-serif",
                              cursor: "pointer",
                            }}
                          >
                            ⬇ Active Only
                          </button>
                        </div>
                      </div>

                      <div
                        style={{
                          background: "#f8f8f8",
                          border: "1px solid #f0f0f0",
                          borderRadius: 12,
                          padding: 14,
                        }}
                      >
                        <div
                          style={{ ...S, marginBottom: 10 }}
                        >
                          Restore from Backup
                        </div>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            marginBottom: 10,
                            alignItems: "center",
                          }}
                        >
                          {["replace", "merge"].map((m) => (
                            <button
                              key={m}
                              onClick={() =>
                                setImportMode(m)
                              }
                              style={{
                                padding: "5px 12px",
                                background:
                                  importMode === m
                                    ? "#000"
                                    : "transparent",
                                border: `1px solid ${importMode === m ? "#000" : "#ddd"}`,
                                borderRadius: 6,
                                color:
                                  importMode === m
                                    ? "#fff"
                                    : "#666",
                                fontSize: 11,
                                fontFamily: "sans-serif",
                                fontWeight:
                                  importMode === m
                                    ? 600
                                    : 400,
                                cursor: "pointer",
                                textTransform:
                                  "capitalize" as const,
                              }}
                            >
                              {m}
                            </button>
                          ))}
                          <span
                            style={{
                              fontSize: 10,
                              color: "#bbb",
                              fontFamily: "sans-serif",
                            }}
                          >
                            {importMode === "replace"
                              ? "overwrites all"
                              : "adds alongside"}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            importRef.current?.click()
                          }
                          style={{
                            width: "100%",
                            padding: "9px 0",
                            background: "transparent",
                            border: "1px dashed #ccc",
                            borderRadius: 8,
                            color: "#555",
                            fontSize: 12,
                            fontFamily: "sans-serif",
                            cursor: "pointer",
                          }}
                        >
                          ⬆ Choose .json file
                        </button>
                        <input
                          ref={importRef}
                          type="file"
                          accept=".json,application/json"
                          style={{ display: "none" }}
                          onChange={handleImportFile}
                        />
                        {importMsg && (
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 11,
                              fontFamily: "sans-serif",
                              color: importMsg.startsWith(
                                "✓"
                              )
                                ? "#68a070"
                                : "#e53e3e",
                              fontWeight: 600,
                            }}
                          >
                            {importMsg}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activePanel === "caption" && captionImg && (
                    <div
                      style={{
                        flex: 1,
                        overflowY: "auto",
                        padding: 16,
                        display: "flex",
                        flexDirection: "column",
                        gap: 14,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 14,
                          alignItems: "flex-start",
                        }}
                      >
                        <div
                          style={{
                            width: 100,
                            height: 100,
                            borderRadius: 10,
                            overflow: "hidden",
                            flexShrink: 0,
                            border: "1px solid #f0f0f0",
                          }}
                        >
                          <img
                            src={captionImg.src}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={LBL}>
                            Post Context
                          </label>
                          <textarea
                            value={captionCtx}
                            onChange={(e) =>
                              setCaptionCtx(e.target.value)
                            }
                            placeholder="Key message, CTA, product details..."
                            rows={4}
                            style={{
                              ...INP,
                              resize: "vertical" as const,
                              lineHeight: 1.6,
                              padding: "9px 12px",
                            }}
                          />
                          <button
                            onClick={generateCaption}
                            disabled={captionLoading}
                            style={{
                              marginTop: 8,
                              width: "100%",
                              padding: "9px 0",
                              background: captionLoading
                                ? "#f0f0f0"
                                : "#000",
                              border: "none",
                              borderRadius: 8,
                              color: captionLoading
                                ? "#bbb"
                                : "#fff",
                              fontSize: 12,
                              fontFamily: "sans-serif",
                              fontWeight: 600,
                              cursor: captionLoading
                                ? "default"
                                : "pointer",
                            }}
                          >
                            {captionLoading
                              ? "⟳ Generating..."
                              : "✦ Generate Captions"}
                          </button>
                        </div>
                      </div>

                      {captionDrafts.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <div style={S}>
                            Drafts — click to select
                          </div>
                          {captionDrafts.map((d, i) => (
                            <div
                              key={i}
                              onClick={() => {
                                setCaptionSelected(i);
                                setCaptionEdit(d.text);
                              }}
                              style={{
                                padding: "11px 13px",
                                border: `1.5px solid ${captionSelected === i ? PINK : "#e0e0e0"}`,
                                borderRadius: 10,
                                cursor: "pointer",
                                background:
                                  captionSelected === i
                                    ? "#fff8fb"
                                    : "#fff",
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 9,
                                  fontWeight: 700,
                                  color:
                                    captionSelected === i
                                      ? PINK
                                      : "#aaa",
                                  letterSpacing: 2,
                                  fontFamily: "sans-serif",
                                  marginBottom: 5,
                                }}
                              >
                                {d.label}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "#222",
                                  fontFamily: "sans-serif",
                                  lineHeight: 1.65,
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {d.text}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {(captionSaved as CaptionData).approved &&
                        captionSelected == null &&
                        !captionEdit && (
                          <div
                            style={{
                              padding: 12,
                              background: "#f8f8f8",
                              borderRadius: 10,
                              border: `1.5px solid ${PINK}33`,
                            }}
                          >
                            <div
                              style={{
                                fontSize: 9,
                                color: PINK,
                                fontWeight: 700,
                                letterSpacing: 2,
                                fontFamily: "sans-serif",
                                marginBottom: 6,
                              }}
                            >
                              ✓ APPROVED CAPTION
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "#222",
                                fontFamily: "sans-serif",
                                lineHeight: 1.7,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {
                                (captionSaved as CaptionData)
                                  .approved
                              }
                            </div>
                            <button
                              onClick={() =>
                                setCaptionEdit(
                                  (
                                    captionSaved as CaptionData
                                  ).approved!
                                )
                              }
                              style={{
                                marginTop: 8,
                                padding: "4px 12px",
                                background: "transparent",
                                border: "1px solid #ddd",
                                borderRadius: 6,
                                fontSize: 11,
                                color: "#555",
                                fontFamily: "sans-serif",
                                cursor: "pointer",
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        )}

                      {(captionSelected != null ||
                        captionEdit) && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <label style={LBL}>
                            Edit &amp; Approve
                          </label>
                          <textarea
                            value={captionEdit}
                            onChange={(e) =>
                              setCaptionEdit(e.target.value)
                            }
                            rows={5}
                            style={{
                              ...INP,
                              resize: "vertical" as const,
                              lineHeight: 1.65,
                              padding: "9px 12px",
                            }}
                          />
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                            }}
                          >
                            <button
                              onClick={approveCaption}
                              style={{
                                flex: 1,
                                padding: "9px 0",
                                background: "#000",
                                border: "none",
                                borderRadius: 8,
                                color: "#fff",
                                fontSize: 12,
                                fontFamily: "sans-serif",
                                fontWeight: 600,
                                cursor: "pointer",
                              }}
                            >
                              ✓ Approve Caption
                            </button>
                            <button
                              onClick={() => {
                                setCaptionSelected(null);
                                setCaptionEdit("");
                              }}
                              style={{
                                padding: "9px 14px",
                                background: "transparent",
                                border: "1px solid #e0e0e0",
                                borderRadius: 8,
                                color: "#888",
                                fontSize: 12,
                                fontFamily: "sans-serif",
                                cursor: "pointer",
                              }}
                            >
                              Discard
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={addImages}
      />
      <input
        ref={ssRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={openCrop}
      />
      <input
        ref={swapRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={doSwap}
      />
    </>
  );
}
