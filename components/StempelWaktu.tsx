"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import dynamic from "next/dynamic";
import "leaflet/dist/leaflet.css";

const MapPicker = dynamic(() => import("./MapPicker"), { ssr: false });

type StampStyle = "gps" | "classic" | "modern" | "minimal";
type StampPos = "tl" | "tr" | "bl" | "br";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Fallback center kalau geolocation ditolak/gagal: Banda Aceh.
const FALLBACK_LAT = -5.5483;
const FALLBACK_LNG = 95.3238;

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function nowLocalSeconds(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 19); // yyyy-MM-ddTHH:mm:ss
}

function toDMS(v: number | null, posDir: string, negDir: string): string | null {
  if (v === null || Number.isNaN(v)) return null;
  const dir = v >= 0 ? posDir : negDir;
  const abs = Math.abs(v);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60);
  return `${dir} ${deg}\u00B0 ${min}' ${sec}"`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const out: string[] = [];
  let cur = "";
  words.forEach((w) => {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  });
  if (cur) out.push(cur);
  return out;
}

export default function StempelWaktu() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [dtValue, setDtValue] = useState<string>(nowLocalSeconds());

  const [jalan, setJalan] = useState("");
  const [kota, setKota] = useState("");
  const [provinsi, setProvinsi] = useState("");
  const [negara, setNegara] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [includeMapInPhoto, setIncludeMapInPhoto] = useState(true);
  const [mapImgVersion, setMapImgVersion] = useState(0);

  const [style, setStyle] = useState<StampStyle>("gps");
  const [pos, setPos] = useState<StampPos>("tr");
  const [color, setColor] = useState("#f2a93b");
  const [scale, setScale] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ambil static map (dari /api/staticmap, same-origin) tiap kali koordinat
  // atau toggle "sertakan peta" berubah, lalu picu render ulang saat gambar siap.
  useEffect(() => {
    if (!includeMapInPhoto || lat === null || lng === null) {
      mapImgRef.current = null;
      setMapImgVersion((v) => v + 1);
      return;
    }
    const img = new Image();
    img.onload = () => {
      mapImgRef.current = img;
      setMapImgVersion((v) => v + 1);
    };
    img.src = `/api/staticmap?lat=${lat}&lng=${lng}&zoom=16&size=240`;
  }, [includeMapInPhoto, lat, lng]);

  // Reverse-geocode via Nominatim (OpenStreetMap) — gratis, tanpa API key.
  // Untuk trafik tinggi/produksi, pertimbangkan self-host Nominatim atau ganti
  // ke penyedia berbayar (Google/Mapbox) sesuai kebutuhan skala.
  const reverseGeocode = useCallback(async (la: number, lo: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${lo}&zoom=18&addressdetails=1`
      );
      const data = await res.json();
      const a = data.address || {};
      setJalan(a.road || a.pedestrian || a.neighbourhood || "");
      setKota(a.village || a.town || a.city || a.county || "");
      setProvinsi(a.state || "");
      setNegara(a.country || "");
    } catch {
      // biarkan kolom kosong / terisi manual kalau reverse-geocoding gagal
    }
  }, []);

  const useCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude);
        setLng(p.coords.longitude);
        reverseGeocode(p.coords.latitude, p.coords.longitude).finally(() => setLocating(false));
      },
      () => setLocating(false)
    );
  }, [reverseGeocode]);

  // Isi posisi sekarang secara otomatis begitu komponen dibuka.
  // Pengguna tetap bisa mengedit semua kolom, atau ganti lewat "Pilih di Peta".
  useEffect(() => {
    useCurrentLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        setPhotoUrl(e.target?.result as string);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const maxW = 1000;
    const factor = Math.min(1, maxW / img.width);
    canvas.width = img.width * factor;
    canvas.height = img.height * factor;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const dt = dtValue ? new Date(dtValue) : new Date();
    const dateStr = `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()} at ${pad(dt.getHours())}.${pad(
      dt.getMinutes()
    )}.${pad(dt.getSeconds())}`;
    const addressLines = [jalan, kota, provinsi, negara].filter(Boolean);
    const latS = toDMS(lat, "N", "S");
    const lngS = toDMS(lng, "E", "W");
    const coordStr = latS && lngS ? `${latS}, ${lngS}` : null;

    const lines = (
      style === "gps"
        ? [dateStr, coordStr, ...addressLines]
        : [dateStr, addressLines.join(", ") || null, coordStr]
    ).filter(Boolean) as string[];

    const base = canvas.width / 1000;
    const margin = Math.round(20 * base);

    if (style === "gps") {
      const fs = Math.round(24 * base * scale);
      const lineGap = Math.round(fs * 1.3);
      ctx.font = `700 ${fs}px Poppins, sans-serif`;
      ctx.textBaseline = "top";
      const maxWidth = canvas.width * 0.62;
      const wrapped: string[] = [];
      lines.forEach((l) => wrapLine(ctx, l, maxWidth).forEach((w) => wrapped.push(w)));

      const alignRight = pos === "tr" || pos === "br";
      const alignTop = pos === "tl" || pos === "tr";
      const mapImg = includeMapInPhoto ? mapImgRef.current : null;
      const mapSize = mapImg ? Math.round(100 * base * scale) : 0;
      const mapGap = mapImg ? Math.round(10 * base) : 0;

      const textBlockH = wrapped.length * lineGap;
      const groupH = mapSize + mapGap + textBlockH;
      const groupX = alignRight ? canvas.width - margin - mapSize : margin;
      const groupY = alignTop ? margin : canvas.height - margin - groupH;

      if (mapImg) {
        ctx.save();
        roundRectPath(ctx, groupX, groupY, mapSize, mapSize, Math.round(8 * base));
        ctx.clip();
        ctx.drawImage(mapImg, groupX, groupY, mapSize, mapSize);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = Math.max(1, 2 * base);
        roundRectPath(ctx, groupX, groupY, mapSize, mapSize, Math.round(8 * base));
        ctx.stroke();
      }

      ctx.textAlign = alignRight ? "right" : "left";
      const textX = alignRight ? canvas.width - margin : margin;
      let y = groupY + mapSize + mapGap;

      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = Math.round(6 * base);
      ctx.shadowOffsetY = Math.round(2 * base);
      ctx.fillStyle = "#ffffff";
      wrapped.forEach((l) => {
        ctx.fillText(l, textX, y);
        y += lineGap;
      });
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.textAlign = "left";
      return;
    }

    const fs = Math.round(20 * base * scale);
    const padIn = Math.round(16 * base * scale);
    const lineGap = Math.round(fs * 1.35);
    ctx.font = `${style === "minimal" ? 600 : 700} ${fs}px "JetBrains Mono", monospace`;
    ctx.textBaseline = "top";
    const widths = lines.map((l) => ctx.measureText(l).width);
    const boxW = Math.max(...widths) + padIn * 2;
    const boxH = lines.length * lineGap + padIn * 1.6;

    let x: number, y: number;
    if (pos === "br") { x = canvas.width - boxW - margin; y = canvas.height - boxH - margin; }
    else if (pos === "bl") { x = margin; y = canvas.height - boxH - margin; }
    else if (pos === "tl") { x = margin; y = margin; }
    else { x = canvas.width - boxW - margin; y = margin; }

    if (style === "classic") {
      ctx.fillStyle = "rgba(10,15,20,0.55)";
      ctx.fillRect(x, y, boxW, boxH);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, base);
      ctx.strokeRect(x + 2, y + 2, boxW - 4, boxH - 4);
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 0 ? color : "#eef1ec";
        ctx.fillText(l, x + padIn, y + padIn * 0.8 + i * lineGap);
      });
    } else if (style === "modern") {
      ctx.fillStyle = "rgba(14,27,40,0.72)";
      ctx.fillRect(x, y, boxW, boxH);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.round(4 * base), boxH);
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 0 ? color : "#f4f6f2";
        ctx.fillText(l, x + padIn + Math.round(8 * base), y + padIn * 0.8 + i * lineGap);
      });
    } else {
      lines.forEach((l, i) => {
        const yy = y + padIn * 0.8 + i * lineGap;
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(l, x + padIn + base, yy + base);
        ctx.fillStyle = i === 0 ? color : "#ffffff";
        ctx.fillText(l, x + padIn, yy);
      });
    }
  }, [dtValue, jalan, kota, provinsi, negara, lat, lng, style, pos, color, scale, includeMapInPhoto, mapImgVersion]);

  useEffect(() => {
    render();
  }, [render, photoUrl]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = "stempel-waktu.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div style={pageStyle}>
      <h1 style={{ fontSize: 28, marginBottom: 4, fontWeight: 700 }}>Stempel Waktu</h1>
      <p style={{ fontFamily: "monospace", fontSize: 12.5, color: "#f2a93b", marginTop: 0, marginBottom: 20 }}>
        timestamp &amp; geotag — lokasi otomatis terisi posisi Anda, bisa diedit atau dipilih lewat peta
      </p>

      <div style={gridStyle}>
        <div>
          <div style={panelStyle}>
            <label style={labelStyle}>Foto</label>
            <button style={dropStyle} onClick={() => fileInputRef.current?.click()}>
              Klik untuk unggah foto
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            <label style={{ ...labelStyle, marginTop: 16 }}>Waktu (dengan detik)</label>
            <input
              type="datetime-local"
              step={1}
              value={dtValue}
              onChange={(e) => setDtValue(e.target.value)}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 16 }}>Alamat</label>
            <input style={inputStyle} placeholder="Jalan" value={jalan} onChange={(e) => setJalan(e.target.value)} />
            <input style={{ ...inputStyle, marginTop: 8 }} placeholder="Kota" value={kota} onChange={(e) => setKota(e.target.value)} />
            <input style={{ ...inputStyle, marginTop: 8 }} placeholder="Provinsi" value={provinsi} onChange={(e) => setProvinsi(e.target.value)} />
            <input style={{ ...inputStyle, marginTop: 8 }} placeholder="Negara" value={negara} onChange={(e) => setNegara(e.target.value)} />

            <label style={{ ...labelStyle, marginTop: 16 }}>
              Koordinat {locating ? "(mengambil lokasi…)" : ""}
            </label>
            <div style={{ fontFamily: "monospace", fontSize: 13, marginBottom: 8 }}>
              {lat !== null && lng !== null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "belum ada"}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={ghostBtn} onClick={useCurrentLocation}>📍 Lokasi Saya</button>
              <button style={mainBtnSm} onClick={() => setShowMap(true)}>🗺️ Pilih di Peta</button>
            </div>

            <label style={toggleRowStyle}>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#c7d0d4" }}>
                Sertakan peta kecil di dalam foto
              </span>
              <span
                onClick={() => setIncludeMapInPhoto((v) => !v)}
                style={switchTrack(includeMapInPhoto)}
                role="switch"
                aria-checked={includeMapInPhoto}
              >
                <span style={switchThumb(includeMapInPhoto)} />
              </span>
            </label>
          </div>

          <div style={{ ...panelStyle, marginTop: 16 }}>
            <label style={labelStyle}>Gaya</label>
            <div style={optsRow}>
              {(["gps", "classic", "modern", "minimal"] as StampStyle[]).map((s) => (
                <button key={s} onClick={() => setStyle(s)} style={optBtn(style === s)}>
                  {s === "gps" ? "GPS Kamera" : s}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 14 }}>Posisi</label>
            <div style={optsRow}>
              {(["tl", "tr", "bl", "br"] as StampPos[]).map((p) => (
                <button key={p} onClick={() => setPos(p)} style={optBtn(pos === p)}>
                  {{ tl: "Kiri Atas", tr: "Kanan Atas", bl: "Kiri Bawah", br: "Kanan Bawah" }[p]}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 14 }}>Warna aksen</label>
            <div style={{ display: "flex", gap: 8 }}>
              {["#f2a93b", "#8fd8d0", "#e2604f", "#ffffff"].map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 26, height: 26, borderRadius: "50%", background: c, cursor: "pointer",
                    border: color === c ? "2px solid #eef1ec" : "2px solid rgba(226,232,224,0.2)",
                  }}
                />
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 14 }}>Ukuran teks ({Math.round(scale * 100)}%)</label>
            <input
              type="range"
              min={60}
              max={160}
              value={scale * 100}
              onChange={(e) => setScale(Number(e.target.value) / 100)}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ ...panelStyle, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 420 }}>
          {!photoUrl && <div style={{ color: "#7d8a90", fontFamily: "monospace", fontSize: 13 }}>Belum ada foto.</div>}
          <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", display: photoUrl ? "block" : "none" }} />
          {photoUrl && (
            <button style={{ ...mainBtnSm, marginTop: 14, width: "100%" }} onClick={handleDownload}>
              Unduh Foto
            </button>
          )}
        </div>
      </div>

      {showMap && (
        <MapPicker
          initialLat={lat ?? FALLBACK_LAT}
          initialLng={lng ?? FALLBACK_LNG}
          onClose={() => setShowMap(false)}
          onConfirm={(la, lo) => {
            setLat(la);
            setLng(lo);
            reverseGeocode(la, lo);
            setShowMap(false);
          }}
        />
      )}
    </div>
  );
}

const pageStyle: CSSProperties = { maxWidth: 1160, margin: "0 auto", padding: 20, fontFamily: "system-ui, sans-serif", color: "#eef1ec", background: "#0e1b28", minHeight: "100vh" };
const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "340px 1fr", gap: 20 };
const panelStyle: CSSProperties = { background: "#132635", border: "1px solid rgba(226,232,224,0.14)", borderRadius: 2, padding: 18 };
const labelStyle: CSSProperties = { display: "block", fontFamily: "monospace", fontSize: 11, color: "#8fd8d0", marginBottom: 6 };
const inputStyle: CSSProperties = { width: "100%", background: "#0e1b28", border: "1px solid rgba(226,232,224,0.14)", color: "#eef1ec", padding: "9px 10px", borderRadius: 2, fontFamily: "monospace", fontSize: 13 };
const dropStyle: CSSProperties = { width: "100%", padding: "18px 10px", background: "transparent", border: "1px dashed rgba(226,232,224,0.14)", color: "#eef1ec", textAlign: "center", fontSize: 13, cursor: "pointer" };
const ghostBtn: CSSProperties = { flex: 1, padding: 9, background: "transparent", color: "#f2a93b", border: "1px solid #c98a2e", borderRadius: 2, cursor: "pointer", fontSize: 13 };
const mainBtnSm: CSSProperties = { flex: 1, padding: 9, background: "#f2a93b", color: "#0e1b28", border: "none", borderRadius: 2, cursor: "pointer", fontWeight: 700, fontSize: 13 };
const optsRow: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const toggleRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, cursor: "pointer" };
const switchTrack = (on: boolean): CSSProperties => ({
  width: 38, height: 20, borderRadius: 999, background: on ? "#f2a93b" : "rgba(226,232,224,0.18)",
  position: "relative", display: "inline-block", transition: "background 0.15s ease", flexShrink: 0,
});
const switchThumb = (on: boolean): CSSProperties => ({
  position: "absolute", top: 2, left: on ? 20 : 2, width: 16, height: 16, borderRadius: "50%",
  background: on ? "#0e1b28" : "#eef1ec", transition: "left 0.15s ease",
});
const optBtn = (active: boolean): CSSProperties => ({
  padding: "7px 11px",
  fontSize: 12,
  background: active ? "#f2a93b" : "#0e1b28",
  color: active ? "#0e1b28" : "#c7d0d4",
  border: `1px solid ${active ? "#f2a93b" : "rgba(226,232,224,0.14)"}`,
  borderRadius: 2,
  cursor: "pointer",
  fontWeight: active ? 700 : 400,
});