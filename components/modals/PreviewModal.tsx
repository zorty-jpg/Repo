"use client";
import { useEffect, memo } from "react";
import type { Profile } from "../types";
import { RATIO_PAD } from "../types";

function PreviewModal({
  profile,
  igTab,
  onClose,
}: {
  profile: Profile;
  igTab: number;
  onClose: () => void;
}) {
  const rp = RATIO_PAD[igTab] || "125%";

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9997,
        background: "#f0f0f0",
        overflow: "auto",
      }}
    >
      {/* Close bar */}
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 9999,
          display: "flex",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div
          style={{
            padding: "6px 14px",
            background: "rgba(0,0,0,0.07)",
            borderRadius: 8,
            fontSize: 11,
            fontFamily: "sans-serif",
            color: "#555",
          }}
        >
          ESC to close
        </div>
        <button
          onClick={onClose}
          style={{
            padding: "7px 16px",
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
          ✕ Close
        </button>
      </div>

      {/* Preview card */}
      <div
        style={{
          maxWidth: 390,
          margin: "60px auto",
          background: "#fff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 8px 40px rgba(0,0,0,0.12)",
        }}
      >
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
              style={{
                width: 77,
                height: 77,
                borderRadius: "50%",
                flexShrink: 0,
                background: profile.info.avatar
                  ? `url(${profile.info.avatar}) center/cover`
                  : "linear-gradient(135deg,#c13584,#e1306c,#fd1d1d,#fcaf45)",
                boxShadow: "0 0 0 2px white,0 0 0 3.5px #c13584",
                overflow: "hidden",
              }}
            />
            <div
              style={{
                display: "flex",
                gap: 16,
                flex: 1,
                justifyContent: "space-around",
              }}
            >
              {(
                [
                  ["posts", profile.images.length],
                  ["followers", profile.info.followers || "0"],
                  ["following", profile.info.following || "0"],
                ] as [string, string | number][]
              ).map(([l, v]) => (
                <div key={l} style={{ textAlign: "center" }}>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 15,
                      fontFamily: "sans-serif",
                    }}
                  >
                    {v}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#777",
                      fontFamily: "sans-serif",
                    }}
                  >
                    {l}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ fontFamily: "sans-serif" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{profile.info.name}</div>
            <div style={{ fontSize: 13, color: "#888" }}>
              @{profile.info.username}
            </div>
            <div style={{ fontSize: 13, marginTop: 2, whiteSpace: "pre-wrap" }}>
              {profile.info.bio}
            </div>
          </div>
        </div>

        {/* Highlights */}
        <div
          style={{
            display: "flex",
            gap: 14,
            padding: "6px 14px 12px",
            overflowX: "auto",
          }}
        >
          {profile.highlights.map((h) => (
            <div
              key={h.id}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: "50%",
                  background: h.img
                    ? `url(${h.img}) center/cover`
                    : "#f0f0f0",
                  border: "1px solid #ddd",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "#999",
                  fontFamily: "sans-serif",
                }}
              >
                {!h.img && h.label[0]}
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: "#555",
                  fontFamily: "sans-serif",
                }}
              >
                {h.label}
              </span>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderTop: "1px solid #dbdbdb" }}>
          {["⊞", "▶", "☆"].map((icon, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                textAlign: "center",
                padding: "10px 0",
                fontSize: 17,
                color: igTab === i ? "#000" : "#bbb",
                borderBottom:
                  igTab === i ? "2px solid #000" : "2px solid transparent",
              }}
            >
              {icon}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 2,
          }}
        >
          {profile.images.map((img) => (
            <div
              key={img.id}
              style={{
                position: "relative",
                width: "100%",
                paddingBottom: rp,
                overflow: "hidden",
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
                }}
              />
            </div>
          ))}
        </div>
        {!profile.images.length && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              color: "#ddd",
              fontFamily: "sans-serif",
              fontSize: 13,
            }}
          >
            No images yet
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(PreviewModal);
