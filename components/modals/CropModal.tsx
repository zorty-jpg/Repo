"use client";
import { useState, useRef, useEffect, useCallback, memo } from "react";
import { PINK } from "../types";

interface RectSel {
  x: number;
  y: number;
  w: number;
  h: number;
}

function CropModal({
  src,
  onConfirm,
  onCancel,
}: {
  src: string;
  onConfirm: (sel: RectSel, rows: number) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<RectSel | null>(null);
  const [rows, setRows] = useState(3);
  const cRef = useRef<HTMLDivElement>(null);
  const dsRef = useRef<{ x: number; y: number } | null>(null);
  const isDrag = useRef(false);

  const getP = useCallback((cx: number, cy: number) => {
    const r = cRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (cx - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (cy - r.top) / r.height)),
    };
  }, []);

  useEffect(() => {
    const onM = (e: MouseEvent) => {
      if (!isDrag.current) return;
      const p = getP(e.clientX, e.clientY);
      const s = dsRef.current!;
      setSel({
        x: Math.min(s.x, p.x),
        y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x),
        h: Math.abs(p.y - s.y),
      });
    };
    const onU = () => {
      isDrag.current = false;
    };
    window.addEventListener("mousemove", onM);
    window.addEventListener("mouseup", onU);
    return () => {
      window.removeEventListener("mousemove", onM);
      window.removeEventListener("mouseup", onU);
    };
  }, [getP]);

  const onD = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = getP(e.clientX, e.clientY);
    dsRef.current = p;
    isDrag.current = true;
    setSel({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const valid = sel && sel.w > 0.02 && sel.h > 0.02;

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
          overflow: "hidden",
          maxWidth: "90vw",
        }}
      >
        <div style={{ padding: "20px 24px 0" }}>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "sans-serif" }}>
            Slice Grid
          </div>
          <div style={{ fontSize: 12, color: "#aaa", fontFamily: "sans-serif" }}>
            Drag around photo tiles only
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            padding: 20,
            alignItems: "flex-start",
          }}
        >
          <div
            ref={cRef}
            onMouseDown={onD}
            style={{
              position: "relative",
              cursor: "crosshair",
              userSelect: "none",
              lineHeight: 0,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid #f0f0f0",
              flexShrink: 0,
            }}
          >
            <img
              src={src}
              alt=""
              draggable={false}
              style={{
                display: "block",
                maxWidth: "62vw",
                maxHeight: "58vh",
                objectFit: "contain",
                pointerEvents: "none",
              }}
            />
            {sel && (
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    right: 0,
                    height: `${sel.y * 100}%`,
                    background: "rgba(0,0,0,0.5)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: `${(sel.y + sel.h) * 100}%`,
                    right: 0,
                    bottom: 0,
                    background: "rgba(0,0,0,0.5)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: `${sel.y * 100}%`,
                    width: `${sel.x * 100}%`,
                    height: `${sel.h * 100}%`,
                    background: "rgba(0,0,0,0.5)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: `${(sel.x + sel.w) * 100}%`,
                    top: `${sel.y * 100}%`,
                    right: 0,
                    height: `${sel.h * 100}%`,
                    background: "rgba(0,0,0,0.5)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: `${sel.x * 100}%`,
                    top: `${sel.y * 100}%`,
                    width: `${sel.w * 100}%`,
                    height: `${sel.h * 100}%`,
                    border: `2px solid ${PINK}`,
                    boxSizing: "border-box",
                  }}
                >
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${(i / 3) * 100}%`,
                        width: 1,
                        background: `${PINK}99`,
                      }}
                    />
                  ))}
                  {Array.from({ length: rows - 1 }, (_, i) => (
                    <div
                      key={i}
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: `${((i + 1) / rows) * 100}%`,
                        height: 1,
                        background: `${PINK}99`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minWidth: 110,
              paddingTop: 4,
            }}
          >
            <div
              style={{
                background: "#fafafa",
                border: "1px solid #f0f0f0",
                borderRadius: 12,
                padding: "12px 14px",
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
                  marginBottom: 8,
                }}
              >
                Rows
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  justifyContent: "center",
                }}
              >
                <button
                  onClick={() => setRows((r) => Math.max(1, r - 1))}
                  style={{
                    width: 28,
                    height: 28,
                    background: "#fff",
                    border: "1px solid #e0e0e0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  −
                </button>
                <span
                  style={{
                    fontWeight: 700,
                    minWidth: 20,
                    textAlign: "center",
                    fontFamily: "sans-serif",
                    fontSize: 18,
                  }}
                >
                  {rows}
                </span>
                <button
                  onClick={() => setRows((r) => r + 1)}
                  style={{
                    width: 28,
                    height: 28,
                    background: "#fff",
                    border: "1px solid #e0e0e0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: "0 20px 20px", display: "flex", gap: 8 }}>
          <button
            onClick={() => valid && onConfirm(sel!, rows)}
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
            Slice
          </button>
          <button
            onClick={onCancel}
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
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(CropModal);
export type { RectSel };
