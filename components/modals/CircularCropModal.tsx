"use client";
import { useState, useRef, useEffect, useCallback, memo } from "react";
import { PINK, AV_Q } from "../types";

// ── CirclePreview (internal) ────────────────────────────────────────────────

interface CropSel {
  cx: number;
  cy: number;
  r: number;
}

function CirclePreviewInner({
  src,
  sel,
  containerRef,
  size = 100,
}: {
  src: string;
  sel: CropSel | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  size?: number;
}) {
  const cvRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);

    if (!sel || sel.r < 4 || !containerRef.current) {
      ctx.fillStyle = "#f0f0f0";
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ccc";
      ctx.font = `${size * 0.28}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", size / 2, size / 2);
      return;
    }

    const img = new Image();
    img.onload = () => {
      const rect = containerRef.current!.getBoundingClientRect();
      const sx = img.naturalWidth / rect.width;
      const sy = img.naturalHeight / rect.height;
      const imgR = sel.r * Math.min(sx, sy);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        img,
        sel.cx * sx - imgR,
        sel.cy * sy - imgR,
        imgR * 2,
        imgR * 2,
        0,
        0,
        size,
        size
      );
      ctx.restore();
    };
    img.src = src;
  }, [src, sel, size, containerRef]);

  return (
    <canvas
      ref={cvRef}
      width={size}
      height={size}
      style={{
        borderRadius: "50%",
        border: `3px solid ${PINK}`,
        display: "block",
      }}
    />
  );
}

// ── CircularCropModal ───────────────────────────────────────────────────────

function CircularCropModal({
  src,
  label,
  stepLabel,
  onConfirm,
  onSkip,
  onSkipAll,
}: {
  src: string;
  label: string;
  stepLabel?: string;
  onConfirm: (src: string) => void;
  onSkip?: () => void;
  onSkipAll?: () => void;
}) {
  const [sel, setSel] = useState<CropSel | null>(null);
  const selRef = useRef<CropSel | null>(null);
  useEffect(() => {
    selRef.current = sel;
  }, [sel]);

  const [dragMode, setDragMode] = useState<string | null>(null);
  const [hoverIn, setHoverIn] = useState(false);
  const cRef = useRef<HTMLDivElement>(null);
  const offRef = useRef({ x: 0, y: 0 });

  const getPos = useCallback((e: MouseEvent) => {
    const r = cRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const isIn = useCallback(
    (px: number, py: number, s: CropSel | null) =>
      !!s && s.r >= 4 && Math.sqrt((px - s.cx) ** 2 + (py - s.cy) ** 2) < s.r,
    []
  );

  const onMD = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const p = getPos(e.nativeEvent);
      const cur = selRef.current;
      if (isIn(p.x, p.y, cur)) {
        setDragMode("move");
        offRef.current = { x: p.x - cur!.cx, y: p.y - cur!.cy };
      } else {
        setDragMode("draw");
        setSel({ cx: p.x, cy: p.y, r: 0 });
      }
    },
    [getPos, isIn]
  );

  const onMH = useCallback(
    (e: React.MouseEvent) => {
      if (!cRef.current) return;
      const p = getPos(e.nativeEvent);
      setHoverIn(isIn(p.x, p.y, selRef.current));
    },
    [getPos, isIn]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragMode || !cRef.current) return;
      const rect = cRef.current.getBoundingClientRect();
      const px = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const py = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      if (dragMode === "draw") {
        setSel((p) =>
          p ? { ...p, r: Math.sqrt((px - p.cx) ** 2 + (py - p.cy) ** 2) } : null
        );
      } else {
        const r = selRef.current?.r || 0;
        setSel((p) =>
          p
            ? {
                ...p,
                cx: Math.max(r, Math.min(rect.width - r, px - offRef.current.x)),
                cy: Math.max(r, Math.min(rect.height - r, py - offRef.current.y)),
              }
            : null
        );
      }
    };
    const onUp = () => setDragMode(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragMode]);

  const valid = sel && sel.r > 8;

  const handleConfirm = () => {
    if (!valid || !cRef.current) return;
    const img = new Image();
    img.onload = () => {
      const rect = cRef.current!.getBoundingClientRect();
      const sx = img.naturalWidth / rect.width;
      const sy = img.naturalHeight / rect.height;
      const imgR = sel.r * Math.min(sx, sy);
      const sz = Math.round(imgR * 2);
      const c = document.createElement("canvas");
      c.width = sz;
      c.height = sz;
      const ctx = c.getContext("2d")!;
      ctx.beginPath();
      ctx.arc(sz / 2, sz / 2, sz / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        img,
        sel.cx * sx - imgR,
        sel.cy * sy - imgR,
        imgR * 2,
        imgR * 2,
        0,
        0,
        sz,
        sz
      );
      onConfirm(c.toDataURL("image/jpeg", AV_Q));
    };
    img.src = src;
  };

  const cur = () =>
    dragMode === "move"
      ? "grabbing"
      : dragMode === "draw"
        ? "crosshair"
        : hoverIn
          ? "grab"
          : "crosshair";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 20,
          boxShadow: "0 32px 80px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "92vh",
          overflow: "hidden",
          maxWidth: "90vw",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 0" }}>
          {stepLabel && (
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#bbb",
                letterSpacing: 3,
                textTransform: "uppercase",
                fontFamily: "sans-serif",
              }}
            >
              {stepLabel}
            </div>
          )}
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "sans-serif" }}>
            {label}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#aaa",
              fontFamily: "sans-serif",
              marginTop: 2,
            }}
          >
            Drag to draw circle · drag inside to move
          </div>
        </div>

        {/* Body */}
        <div
          style={{
            display: "flex",
            gap: 20,
            padding: 20,
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              lineHeight: 0,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid #f0f0f0",
              flexShrink: 0,
            }}
          >
            <div
              ref={cRef}
              onMouseDown={onMD}
              onMouseMove={onMH}
              style={{
                position: "relative",
                cursor: cur(),
                userSelect: "none",
                lineHeight: 0,
              }}
            >
              <img
                src={src}
                alt=""
                draggable={false}
                style={{
                  display: "block",
                  maxWidth: "50vw",
                  maxHeight: "52vh",
                  objectFit: "contain",
                  pointerEvents: "none",
                }}
              />
              {sel && sel.r > 2 && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      right: 0,
                      height: `${sel.cy - sel.r}px`,
                      background: "rgba(0,0,0,0.5)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: `${sel.cy + sel.r}px`,
                      right: 0,
                      bottom: 0,
                      background: "rgba(0,0,0,0.5)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: `${sel.cy - sel.r}px`,
                      width: `${sel.cx - sel.r}px`,
                      height: `${sel.r * 2}px`,
                      background: "rgba(0,0,0,0.5)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `${sel.cx + sel.r}px`,
                      top: `${sel.cy - sel.r}px`,
                      right: 0,
                      height: `${sel.r * 2}px`,
                      background: "rgba(0,0,0,0.5)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: `${sel.cx - sel.r}px`,
                      top: `${sel.cy - sel.r}px`,
                      width: `${sel.r * 2}px`,
                      height: `${sel.r * 2}px`,
                      borderRadius: "50%",
                      border: `2px solid ${PINK}`,
                      boxSizing: "border-box",
                    }}
                  />
                  {(
                    [
                      [0, -1],
                      [0, 1],
                      [1, 0],
                      [-1, 0],
                    ] as [number, number][]
                  ).map(([dx, dy], i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: `${sel.cx + dx * sel.r}px`,
                        top: `${sel.cy + dy * sel.r}px`,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: PINK,
                        transform: "translate(-50%,-50%)",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Preview sidebar */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minWidth: 130,
              paddingTop: 4,
            }}
          >
            <div
              style={{
                background: "#fafafa",
                border: "1px solid #f0f0f0",
                borderRadius: 14,
                padding: 16,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "#bbb",
                  letterSpacing: 2,
                  textTransform: "uppercase",
                  fontFamily: "sans-serif",
                }}
              >
                Preview
              </div>
              <CirclePreviewInner src={src} sel={sel} containerRef={cRef} size={90} />
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "sans-serif",
                  color: valid ? PINK : "#ccc",
                  fontWeight: valid ? 600 : 400,
                }}
              >
                {valid ? "✓ looks good" : "draw to select"}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ padding: "0 20px 20px", display: "flex", gap: 8 }}>
          <button
            onClick={handleConfirm}
            disabled={!valid}
            style={{
              padding: "10px 24px",
              background: valid ? "#000" : "#f0f0f0",
              border: "none",
              borderRadius: 10,
              color: valid ? "#fff" : "#bbb",
              fontSize: 13,
              fontFamily: "sans-serif",
              fontWeight: 600,
              cursor: valid ? "pointer" : "default",
            }}
          >
            Apply
          </button>
          {onSkip && (
            <button
              onClick={onSkip}
              style={{
                padding: "10px 18px",
                background: "transparent",
                border: "1px solid #e0e0e0",
                borderRadius: 10,
                color: "#555",
                fontSize: 13,
                fontFamily: "sans-serif",
                cursor: "pointer",
              }}
            >
              Skip
            </button>
          )}
          {onSkipAll && (
            <button
              onClick={onSkipAll}
              style={{
                padding: "10px 18px",
                background: "transparent",
                border: "1px solid #e0e0e0",
                borderRadius: 10,
                color: "#aaa",
                fontSize: 13,
                fontFamily: "sans-serif",
                cursor: "pointer",
              }}
            >
              Skip All
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(CircularCropModal);
