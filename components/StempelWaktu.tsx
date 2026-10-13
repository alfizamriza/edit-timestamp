"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import dynamic from "next/dynamic";
import NextImage from "next/image";
import "leaflet/dist/leaflet.css";

const MapPicker = dynamic(() => import("./MapPicker"), { ssr: false });

type StampStyle = "gps" | "classic" | "modern" | "minimal";
type StampPos = "tl" | "tr" | "bl" | "br";

const FONTS = [
  { id: "arialmtlight", label: "Arial MT Light", css: '"Arial MT Light", Arial, sans-serif', weight: 300 },
  { id: "poppins", label: "Poppins", css: '"Poppins", sans-serif', weight: 700 },
  { id: "roboto", label: "Roboto", css: '"Roboto", sans-serif', weight: 700 },
  { id: "system", label: "Sistem (iPhone/Android)", css: 'system-ui, -apple-system, "Segoe UI", sans-serif', weight: 700 },
  { id: "montserrat", label: "Montserrat", css: '"Montserrat", sans-serif', weight: 700 },
  { id: "oswald", label: "Oswald", css: '"Oswald", sans-serif', weight: 600 },
  { id: "robotomono", label: "Roboto Mono", css: '"Roboto Mono", monospace', weight: 700 },
  { id: "digital", label: "Digital", css: '"Share Tech Mono", monospace', weight: 400 },
] as const;
type FontId = (typeof FONTS)[number]["id"];
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Poppins:wght@700&family=Roboto:wght@700&family=Montserrat:wght@700&family=Oswald:wght@600&family=Roboto+Mono:wght@700&family=Share+Tech+Mono&display=swap";

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
  const sec = ((minFloat - min) * 60).toFixed(3).replace(/\.?0+$/, "");
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

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, letterSpacing = 0) {
  const words = text.split(" ");
  const out: string[] = [];
  let cur = "";
  words.forEach((w) => {
    const test = cur ? cur + " " + w : w;
    if (measureText(ctx, test, letterSpacing) > maxWidth && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  });
  if (cur) out.push(cur);
  return out;
}

function measureText(ctx: CanvasRenderingContext2D, text: string, letterSpacing: number) {
  if (letterSpacing <= 0 || text.length < 2) return ctx.measureText(text).width;
  const chars = Array.from(text);
  return chars.reduce((total, char) => total + ctx.measureText(char).width, 0) + letterSpacing * (chars.length - 1);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, letterSpacing: number) {
  if (letterSpacing <= 0 || text.length < 2) {
    ctx.fillText(text, x, y);
    return;
  }

  const chars = Array.from(text);
  const align = ctx.textAlign;
  const totalWidth = measureText(ctx, text, letterSpacing);
  let cursorX = x;
  if (align === "right" || align === "end") cursorX = x - totalWidth;
  else if (align === "center") cursorX = x - totalWidth / 2;

  ctx.textAlign = "left";
  chars.forEach((char) => {
    ctx.fillText(char, cursorX, y);
    cursorX += ctx.measureText(char).width + letterSpacing;
  });
  ctx.textAlign = align;
}

export default function StempelWaktu() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // Tanggal + jam/menit/detik dipisah supaya detik bisa diatur manual di semua perangkat
  // (picker datetime-local di iPhone tidak menyediakan detik).
  const [dateStr, setDateStr] = useState("");
  const [hh, setHh] = useState("");
  const [mm, setMm] = useState("");
  const [ss, setSs] = useState("");
  const pad2 = (v: string) => (v === "" ? "00" : v.padStart(2, "0"));
  const dtValue = dateStr ? `${dateStr}T${pad2(hh)}:${pad2(mm)}:${pad2(ss)}` : "";

  const setNow = useCallback(() => {
    const n = nowLocalSeconds(); // yyyy-MM-ddTHH:mm:ss
    setDateStr(n.slice(0, 10));
    setHh(n.slice(11, 13));
    setMm(n.slice(14, 16));
    setSs(n.slice(17, 19));
  }, []);
  // Diisi di client setelah mount (hindari mismatch hydration karena detik berubah).
  useEffect(() => {
    setNow();
  }, [setNow]);

  const onTimePart = (setter: (v: string) => void, max: number) => (e: ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 2);
    setter(digits !== "" && Number(digits) > max ? String(max) : digits);
  };

  const [jalan, setJalan] = useState("");
  const [kota, setKota] = useState("");
  const [provinsi, setProvinsi] = useState("");
  const [negara, setNegara] = useState("");
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [includeMapInPhoto, setIncludeMapInPhoto] = useState(false);
  const [mapImgVersion, setMapImgVersion] = useState(0);
  const [saveSheetUrl, setSaveSheetUrl] = useState<string | null>(null);

  const [style, setStyle] = useState<StampStyle>("gps");
  const [pos, setPos] = useState<StampPos>("tr");
  const [color, setColor] = useState("#d9ad4f");
  const [scale, setScale] = useState(1.45);
  const [letterSpacing, setLetterSpacing] = useState(1.5);
  const [showShadow, setShowShadow] = useState(false);
  const [fontId, setFontId] = useState<FontId>("arialmtlight");
  const fontDef = FONTS.find((f) => f.id === fontId) ?? FONTS[0];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const mapImgRef = useRef<HTMLImageElement | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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
    const margin = Math.round((style === "gps" ? 48 : 20) * base);
    const letterSpacingPx = letterSpacing * base * scale;

    if (style === "gps") {
      const fs = Math.round(24 * base * scale);
      const lineGap = Math.round(fs * 1.3);
      ctx.font = `${fontDef.weight} ${fs}px ${fontDef.css}`;
      ctx.textBaseline = "top";
      const maxWidth = canvas.width * 0.62;
      const wrapped: string[] = [];
      lines.forEach((l) => wrapLine(ctx, l, maxWidth, letterSpacingPx).forEach((w) => wrapped.push(w)));

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

      if (showShadow) {
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = Math.round(6 * base);
        ctx.shadowOffsetY = Math.round(2 * base);
      }
      ctx.fillStyle = "#ffffff";
      wrapped.forEach((l) => {
        drawText(ctx, l, textX, y, letterSpacingPx);
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
    ctx.font = `${fontDef.weight} ${fs}px ${fontDef.css}`;
    ctx.textBaseline = "top";
    const widths = lines.map((l) => measureText(ctx, l, letterSpacingPx));
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
        drawText(ctx, l, x + padIn, y + padIn * 0.8 + i * lineGap, letterSpacingPx);
      });
    } else if (style === "modern") {
      ctx.fillStyle = "rgba(14,27,40,0.72)";
      ctx.fillRect(x, y, boxW, boxH);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, Math.round(4 * base), boxH);
      lines.forEach((l, i) => {
        ctx.fillStyle = i === 0 ? color : "#f4f6f2";
        drawText(ctx, l, x + padIn + Math.round(8 * base), y + padIn * 0.8 + i * lineGap, letterSpacingPx);
      });
    } else {
      lines.forEach((l, i) => {
        const yy = y + padIn * 0.8 + i * lineGap;
        if (showShadow) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          drawText(ctx, l, x + padIn + base, yy + base, letterSpacingPx);
        }
        ctx.fillStyle = i === 0 ? color : "#ffffff";
        drawText(ctx, l, x + padIn, yy, letterSpacingPx);
      });
    }
  }, [dtValue, jalan, kota, provinsi, negara, lat, lng, style, pos, color, scale, letterSpacing, showShadow, includeMapInPhoto, mapImgVersion, fontDef]);

  useEffect(() => {
    render();
    // Siapkan file PNG lebih dulu supaya tombol Unduh/Bagikan di iPhone
    // tidak kehilangan "izin sentuhan" karena menunggu proses async.
    const c = canvasRef.current;
    if (c && imgRef.current) c.toBlob((b) => { blobRef.current = b; }, "image/png");
  }, [render, photoUrl]);

  // Pastikan font pilihan sudah dimuat, lalu gambar ulang.
  useEffect(() => {
    document.fonts?.load(`${fontDef.weight} 24px ${fontDef.css}`).then(() => setMapImgVersion((v) => v + 1)).catch(() => {});
  }, [fontDef]);

  // Gambar ulang begitu font (Poppins) selesai dimuat, supaya teks di kanvas tidak tertahan di font cadangan.
  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts) return;
    const bump = () => setMapImgVersion((v) => v + 1);
    fonts.addEventListener("loadingdone", bump);
    return () => fonts.removeEventListener("loadingdone", bump);
  }, []);

  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob: Blob | null =
      blobRef.current ?? (await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png")));
    if (!blob) return;

    const ua = navigator.userAgent;
    const isIOS = /iP(hone|ad|od)/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
    const isMobile = isIOS || /Android/.test(ua);
    const file = new File([blob], "stempel-waktu.png", { type: "image/png" });

    // HP: pakai lembar "Bagikan" bawaan sistem -> ada pilihan "Simpan Gambar" / "Simpan ke Foto".
    if (isMobile && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if ((err as DOMException).name === "AbortError") return; // pengguna menutup sendiri
      }
    }

    const url = URL.createObjectURL(blob);
    // iPhone tanpa Web Share: tampilkan gambar penuh, pengguna tekan-tahan -> "Simpan ke Foto".
    if (isIOS) {
      setSaveSheetUrl(url);
      return;
    }
    // Desktop & Android: unduh biasa.
    const a = document.createElement("a");
    a.href = url;
    a.download = "stempel-waktu.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div style={pageStyle} className="sw-page">
      <link rel="stylesheet" href={FONTS_HREF} />
      <style>{`
        .sw-page {
          position: relative;
          overflow-x: hidden;
          box-sizing: border-box;
        }
        .sw-page:before {
          content: "";
          position: absolute;
          inset: 10px;
          border: 1px solid rgba(18,18,18,.08);
          border-radius: 8px;
          pointer-events: none;
        }
        .sw-grid {
          display: grid;
          grid-template-columns: 360px 1fr;
          gap: 24px;
          position: relative;
          z-index: 1;
        }
        .sw-grid > * {
          min-width: 0;
        }
        .sw-title {
          font-family: Georgia, "Times New Roman", serif;
        }
        .sw-preview canvas {
          border-radius: 8px;
          box-shadow: 0 24px 60px rgba(16,20,28,.16);
          max-width: 100%;
          height: auto;
        }
        .sw-grid-2x2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .sw-upload-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 8px;
        }
        .sw-upload-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 14px 10px;
          background: #ffffff;
          border: 1px solid rgba(17,17,17,0.14);
          border-radius: 8px;
          color: #111111;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .sw-upload-btn:hover {
          background: #f4f1ea;
          border-color: rgba(17,17,17,0.25);
        }
        .sw-upload-btn:active {
          transform: scale(0.98);
        }
        .sw-mobile-bar {
          display: none;
        }
        .sw-savesheet-overlay {
          position: fixed;
          inset: 0;
          z-index: 1100;
          background: rgba(8,14,20,0.92);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 16px;
          gap: 14px;
        }
        .sw-savesheet-card {
          background: #112132;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 12px;
          padding: 16px;
          max-width: 92vw;
          max-height: 85vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .sw-savesheet-img {
          max-width: 100%;
          max-height: 60vh;
          object-fit: contain;
          border-radius: 6px;
        }

        /* Mobile & Tablet Optimizations */
        @media (max-width: 820px) {
          .sw-page {
            width: 100% !important;
            margin: 0 !important;
            border-radius: 0 !important;
            border: none !important;
            box-shadow: none !important;
            padding: 16px 14px 96px !important;
          }
          .sw-page:before {
            display: none !important;
          }
          .sw-grid {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          .sw-preview {
            order: -1;
            min-height: 0 !important;
            padding: 14px 10px !important;
          }
          .sw-floating-card {
            display: none !important;
          }
          .sw-header {
            display: flex !important;
            flex-wrap: wrap !important;
            justify-content: space-between !important;
            align-items: center !important;
            gap: 12px !important;
            margin-bottom: 24px !important;
          }
          .sw-header-nav {
            order: 3;
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: none;
            justify-content: flex-start !important;
            padding: 4px 6px !important;
          }
          .sw-header-nav::-webkit-scrollbar {
            display: none;
          }
          .sw-header-nav a {
            padding: 8px 14px !important;
            font-size: 12px !important;
            flex-shrink: 0;
          }
          .sw-header-btn {
            padding: 9px 15px !important;
            font-size: 12px !important;
          }
          .sw-hero {
            margin-bottom: 24px !important;
            padding: 0 4px;
          }
          .sw-hero-title {
            font-size: clamp(32px, 8.5vw, 48px) !important;
            line-height: 1.05 !important;
          }
          .sw-hero-subhead {
            font-size: 14px !important;
            margin-top: 14px !important;
            line-height: 1.45 !important;
            max-width: none !important;
          }
          .sw-hero-actions {
            margin-top: 18px !important;
            gap: 8px !important;
            width: 100%;
          }
          .sw-hero-actions button {
            flex: 1;
            min-height: 44px;
          }
          .sw-empty-preview {
            min-height: 200px !important;
            padding: 24px 16px !important;
          }
          .sw-download-btn-main {
            width: 100% !important;
            min-height: 48px !important;
            font-size: 14px !important;
            margin-top: 14px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            align-self: stretch !important;
          }
          .sw-mobile-bar {
            display: flex;
            position: fixed;
            bottom: max(14px, env(safe-area-inset-bottom));
            left: 14px;
            right: 14px;
            z-index: 100;
            background: rgba(16, 20, 28, 0.94);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            padding: 8px 10px 8px 14px;
            border-radius: 999px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.16);
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .sw-mobile-preview-btn {
            padding: 8px 14px;
            background: rgba(255, 255, 255, 0.14);
            color: #fbfaf6;
            border-radius: 999px;
            font-size: 12.5px;
            font-weight: 700;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            white-space: nowrap;
          }
          .sw-mobile-download-btn {
            flex: 1;
            padding: 10px 16px;
            background: #c5ff4a;
            color: #111111;
            border: none;
            border-radius: 999px;
            font-size: 13px;
            font-weight: 800;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            white-space: nowrap;
            min-height: 40px;
          }
        }
      `}</style>

      {/* Brand Header */}
      <header className="sw-header" style={brandHeaderStyle}>
        <div style={brandStyle}>
          <NextImage src="/icon.png" alt="Stempel Waktu" width={32} height={32} style={brandIconStyle} priority />
          <span>Timesramp</span>
        </div>
        <nav className="sw-header-nav" style={navPillStyle} aria-label="Navigasi">
          <a href="#foto" style={navLinkStyle}>Foto</a>
          <a href="#waktu" style={navLinkStyle}>Waktu</a>
          <a href="#alamat" style={navLinkStyle}>Alamat</a>
          <a href="#gaya" style={navLinkStyle}>Gaya</a>
          <a href="#hasil" style={navLinkStyle}>Hasil</a>
        </nav>
        <button className="sw-header-btn" style={darkBtn} onClick={() => fileInputRef.current?.click()}>
          Upload foto -&gt;
        </button>
      </header>

      {/* Hero Section */}
      <section className="sw-hero" style={heroCopyStyle}>
        <p style={eyebrowStyle}>Timestamp dan geotag online</p>
        <h1 className="sw-title sw-hero-title" style={heroTitleStyle}>
          Stempel waktu
          <span style={heroItalicStyle}>untuk foto lapangan.</span>
        </h1>
        <p className="sw-subtitle sw-hero-subhead" style={subheadStyle}>
          Unggah foto, ambil lokasi GPS, atur alamat, lalu simpan hasil dengan tampilan bersih seperti kamera profesional.
        </p>
        <div className="sw-hero-actions" style={heroActionsStyle}>
          <button style={darkBtn} onClick={() => fileInputRef.current?.click()}>
            Mulai unggah -&gt;
          </button>
          <button style={lightBtn} onClick={useCurrentLocation}>
            📍 Ambil lokasi
          </button>
        </div>
      </section>

      {/* Main Grid: Settings & Preview */}
      <div className="sw-grid">
        <div>
          {/* Panel Foto & Waktu */}
          <div id="foto" style={panelStyle}>
            <label style={labelStyle}>Pilih Foto Lapangan</label>
            <div className="sw-upload-grid">
              <button
                type="button"
                className="sw-upload-btn"
                onClick={() => cameraInputRef.current?.click()}
              >
                <span style={{ fontSize: 22 }}>📸</span>
                <span>Ambil Kamera</span>
              </button>
              <button
                type="button"
                className="sw-upload-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <span style={{ fontSize: 22 }}>📁</span>
                <span>Pilih Galeri</span>
              </button>
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
            {photoUrl && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f0f8ed", border: "1px solid #cce2ca", padding: "8px 12px", borderRadius: 6, fontSize: 12, color: "#2d6328", marginTop: 4 }}>
                <span>✓ Foto terpilih</span>
                <span style={{ cursor: "pointer", fontWeight: 700, textDecoration: "underline" }} onClick={() => fileInputRef.current?.click()}>Ganti foto</span>
              </div>
            )}

            <label id="waktu" style={{ ...labelStyle, marginTop: 18 }}>Tanggal &amp; Waktu</label>
            <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} style={{ ...inputStyle, minHeight: 44 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              {([["Jam", hh, setHh, 23], ["Menit", mm, setMm, 59], ["Detik", ss, setSs, 59]] as const).map(([lbl, val, setter, max], i) => (
                <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  {i > 0 && <span style={{ color: "#8fd8d0", fontFamily: "monospace", fontWeight: 700 }}>:</span>}
                  <input
                    aria-label={lbl}
                    placeholder={lbl}
                    inputMode="numeric"
                    maxLength={2}
                    value={val}
                    onChange={onTimePart(setter, max)}
                    onBlur={() => setter(pad2(val))}
                    onFocus={(e) => e.target.select()}
                    style={{ ...inputStyle, textAlign: "center", padding: "10px 4px", minHeight: 44 }}
                  />
                </div>
              ))}
            </div>
            <button type="button" style={{ ...ghostBtn, width: "100%", marginTop: 8, minHeight: 42, flex: "none" }} onClick={setNow}>
              🕒 Pakai waktu sekarang
            </button>

            <label id="alamat" style={{ ...labelStyle, marginTop: 18 }}>Alamat</label>
            <input style={{ ...inputStyle, minHeight: 44 }} placeholder="Jalan / Lokasi spesifik" value={jalan} onChange={(e) => setJalan(e.target.value)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <input style={{ ...inputStyle, minHeight: 44 }} placeholder="Kota" value={kota} onChange={(e) => setKota(e.target.value)} />
              <input style={{ ...inputStyle, minHeight: 44 }} placeholder="Provinsi" value={provinsi} onChange={(e) => setProvinsi(e.target.value)} />
            </div>
            <input style={{ ...inputStyle, marginTop: 8, minHeight: 44 }} placeholder="Negara" value={negara} onChange={(e) => setNegara(e.target.value)} />

            <label style={{ ...labelStyle, marginTop: 18 }}>
              Koordinat {locating ? "(mengambil lokasi…)" : ""}
            </label>
            <div style={{ fontFamily: "monospace", fontSize: 13, marginBottom: 8, background: "#ffffff", padding: "8px 10px", borderRadius: 6, border: "1px solid rgba(17,17,17,0.1)", color: lat !== null ? "#111" : "#888" }}>
              📍 {lat !== null && lng !== null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "Belum ditentukan"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button type="button" style={{ ...ghostBtn, minHeight: 42 }} onClick={useCurrentLocation} disabled={locating}>
                {locating ? "⏳ Mengambil..." : "📍 Lokasi Saya"}
              </button>
              <button type="button" style={{ ...mainBtnSm, minHeight: 42 }} onClick={() => setShowMap(true)}>
                🗺️ Pilih di Peta
              </button>
            </div>

            <label style={toggleRowStyle}>
              <span style={{ fontSize: 13, color: "#444", fontWeight: 600 }}>
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

          {/* Panel Gaya */}
          <div id="gaya" style={{ ...panelStyle, marginTop: 18 }}>
            <label style={labelStyle}>Gaya Stempel</label>
            <div className="sw-grid-2x2">
              {(["gps", "classic", "modern", "minimal"] as StampStyle[]).map((s) => (
                <button key={s} type="button" onClick={() => setStyle(s)} style={optBtn(style === s)}>
                  {s === "gps" ? "GPS Kamera" : s === "classic" ? "Classic Box" : s === "modern" ? "Modern Bar" : "Minimal"}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 16 }}>Posisi Stempel</label>
            <div className="sw-grid-2x2">
              {([
                ["tl", "↖ Kiri Atas"],
                ["tr", "↗ Kanan Atas"],
                ["bl", "↙ Kiri Bawah"],
                ["br", "↘ Kanan Bawah"],
              ] as const).map(([p, title]) => (
                <button key={p} type="button" onClick={() => setPos(p)} style={optBtn(pos === p)}>
                  {title}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 16 }}>Jenis Font</label>
            <div className="sw-grid-2x2">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFontId(f.id)}
                  style={{
                    ...optBtn(fontId === f.id),
                    fontFamily: f.css,
                    fontWeight: f.weight,
                    padding: "9px 6px",
                    textAlign: "center",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 16 }}>Jarak Huruf ({letterSpacing}px)</label>
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={letterSpacing}
              onChange={(e) => setLetterSpacing(Number(e.target.value))}
              style={{ width: "100%", height: 32, cursor: "pointer" }}
            />

            <label style={toggleRowStyle}>
              <span style={{ fontSize: 13, color: "#444", fontWeight: 600 }}>
                Bayangan teks
              </span>
              <span
                onClick={() => setShowShadow((v) => !v)}
                style={switchTrack(showShadow)}
                role="switch"
                aria-checked={showShadow}
              >
                <span style={switchThumb(showShadow)} />
              </span>
            </label>

            <label style={{ ...labelStyle, marginTop: 16 }}>Warna Aksen</label>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "4px 0" }}>
              {["#111111", "#c5ff4a", "#ff8d5c", "#7b61ff", "#2bb7a8", "#ffd028"].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Pilih warna ${c}`}
                  onClick={() => setColor(c)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: c,
                    cursor: "pointer",
                    border: color === c ? "3px solid #111111" : "2px solid rgba(0,0,0,0.12)",
                    transform: color === c ? "scale(1.15)" : "scale(1)",
                    transition: "all 0.15s ease",
                    boxShadow: color === c ? "0 4px 10px rgba(0,0,0,0.18)" : "none",
                  }}
                />
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 16 }}>Ukuran Teks ({Math.round(scale * 100)}%)</label>
            <input
              type="range"
              min={60}
              max={160}
              value={scale * 100}
              onChange={(e) => setScale(Number(e.target.value) / 100)}
              style={{ width: "100%", height: 32, cursor: "pointer" }}
            />
          </div>
        </div>

        {/* Panel Preview Hasil */}
        <div id="hasil" className="sw-preview" style={previewStyle}>
          <div className="sw-floating-card" style={floatingCardLeftStyle}>
            <span style={miniIconStyle}>01</span>
            <strong>Unggah foto</strong>
            <small>Diproses langsung di browser.</small>
          </div>
          <div className="sw-floating-card" style={floatingCardRightStyle}>
            <strong>GPS siap</strong>
            <small>{lat !== null && lng !== null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "Ambil atau pilih lokasi."}</small>
          </div>
          {!photoUrl && (
            <div className="sw-empty-preview" style={emptyPreviewStyle}>
              <NextImage src="/icon.png" alt="" width={56} height={56} style={{ opacity: 0.9 }} />
              <strong style={{ fontSize: 16, marginTop: 4 }}>Belum ada foto</strong>
              <span style={{ fontSize: 13, padding: "0 12px", color: "#666" }}>
                Unggah gambar atau jepret langsung lewat kamera untuk melihat pratinjau stempel.
              </span>
            </div>
          )}
          <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", display: photoUrl ? "block" : "none" }} />
          {photoUrl && (
            <button className="sw-download-btn-main" style={downloadBtn} onClick={handleDownload}>
              📥 Unduh / Simpan Foto
            </button>
          )}
        </div>
      </div>

      {/* Mobile Sticky Quick Bar */}
      {photoUrl && (
        <div className="sw-mobile-bar">
          <a href="#hasil" className="sw-mobile-preview-btn">
            👁️ Preview
          </a>
          <button onClick={handleDownload} className="sw-mobile-download-btn">
            📥 Unduh Foto
          </button>
        </div>
      )}

      {/* iOS Save Sheet Modal */}
      {saveSheetUrl && (
        <div
          className="sw-savesheet-overlay"
          onClick={() => { URL.revokeObjectURL(saveSheetUrl); setSaveSheetUrl(null); }}
        >
          <div className="sw-savesheet-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "#eef1ec" }}>
                Tekan &amp; tahan gambar → pilih <b>Simpan ke Foto</b>
              </p>
              <button
                onClick={() => { URL.revokeObjectURL(saveSheetUrl); setSaveSheetUrl(null); }}
                style={closeBtnStyle}
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={saveSheetUrl} alt="Hasil foto" className="sw-savesheet-img" />
            <button
              onClick={() => { URL.revokeObjectURL(saveSheetUrl); setSaveSheetUrl(null); }}
              style={{ ...ghostBtn, width: "100%", color: "#ffffff", borderColor: "rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", minHeight: 42 }}
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Map Picker Modal */}
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

const pageStyle: CSSProperties = {
  width: "min(1180px, calc(100% - 28px))",
  margin: "20px auto",
  padding: 24,
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  color: "#111111",
  background: "#fbfaf6",
  minHeight: "100vh",
  border: "1px solid rgba(18,18,18,0.08)",
  borderRadius: 8,
  boxShadow: "0 18px 52px rgba(88,111,178,0.24)",
};
const brandHeaderStyle: CSSProperties = {
  position: "relative",
  zIndex: 2,
  display: "grid",
  gridTemplateColumns: "1fr auto 1fr",
  alignItems: "center",
  gap: 16,
  marginBottom: 38,
};
const brandStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 9, fontWeight: 800, letterSpacing: -0.2 };
const brandIconStyle: CSSProperties = { borderRadius: 8, boxShadow: "0 10px 28px rgba(0,0,0,0.12)", flexShrink: 0 };
const navPillStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: 4,
  border: "1px solid rgba(17,17,17,0.08)",
  borderRadius: 999,
  background: "rgba(255,255,255,0.72)",
  boxShadow: "0 8px 24px rgba(17,17,17,0.04)",
};
const navLinkStyle: CSSProperties = {
  padding: "9px 16px",
  color: "#171717",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 700,
  borderRadius: 999,
  transition: "all 0.15s ease",
};
const heroCopyStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  maxWidth: 760,
  margin: "0 auto 36px",
  textAlign: "center",
};
const eyebrowStyle: CSSProperties = {
  margin: "0 0 12px",
  color: "#77736b",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: 0,
  textTransform: "uppercase",
};
const heroTitleStyle: CSSProperties = {
  fontSize: "clamp(46px, 8vw, 92px)",
  lineHeight: 0.86,
  fontWeight: 700,
  letterSpacing: 0,
};
const heroItalicStyle: CSSProperties = { display: "block", fontStyle: "italic", fontWeight: 400 };
const subheadStyle: CSSProperties = {
  maxWidth: 560,
  margin: "22px auto 0",
  color: "#77736b",
  fontSize: 15,
  lineHeight: 1.45,
};
const heroActionsStyle: CSSProperties = { display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginTop: 22 };
const darkBtn: CSSProperties = {
  padding: "11px 18px",
  background: "#101010",
  color: "#ffffff",
  border: "1px solid #101010",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};
const lightBtn: CSSProperties = {
  padding: "11px 18px",
  background: "rgba(255,255,255,0.68)",
  color: "#111111",
  border: "1px solid rgba(17,17,17,0.1)",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};
const panelStyle: CSSProperties = {
  background: "rgba(255,255,255,0.76)",
  border: "1px solid rgba(17,17,17,0.08)",
  borderRadius: 8,
  padding: 18,
  boxShadow: "0 20px 50px rgba(17,17,17,0.08)",
  backdropFilter: "blur(18px)",
};
const labelStyle: CSSProperties = { display: "block", fontFamily: "monospace", fontSize: 11, color: "#6f6a60", marginBottom: 6, fontWeight: 700 };
const inputStyle: CSSProperties = { width: "100%", background: "#ffffff", border: "1px solid rgba(17,17,17,0.12)", color: "#111111", padding: "10px 12px", borderRadius: 6, fontFamily: "monospace", fontSize: 16, boxSizing: "border-box" };
const ghostBtn: CSSProperties = { flex: 1, padding: "10px 12px", background: "#ffffff", color: "#111111", border: "1px solid rgba(17,17,17,0.14)", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 };
const mainBtnSm: CSSProperties = { flex: 1, padding: "10px 12px", background: "#c5ff4a", color: "#111111", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 800, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4 };
const previewStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 520,
  padding: 24,
};
const emptyPreviewStyle: CSSProperties = {
  width: "min(460px, 100%)",
  minHeight: 320,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: 8,
  border: "1px dashed rgba(17,17,17,0.16)",
  color: "#77736b",
  background: "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(244,241,234,0.72))",
  textAlign: "center",
};
const floatingCardBase: CSSProperties = {
  position: "absolute",
  zIndex: 3,
  width: 158,
  minHeight: 112,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 16,
  borderRadius: 8,
  background: "rgba(255,255,255,0.88)",
  border: "1px solid rgba(17,17,17,0.08)",
  boxShadow: "0 24px 60px rgba(17,17,17,0.1)",
};
const floatingCardLeftStyle: CSSProperties = { ...floatingCardBase, left: 8, top: 72, transform: "rotate(-6deg)" };
const floatingCardRightStyle: CSSProperties = { ...floatingCardBase, right: 8, top: 128, transform: "rotate(7deg)" };
const miniIconStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  borderRadius: "50%",
  background: "#c5ff4a",
  fontSize: 11,
  fontWeight: 900,
};
const downloadBtn: CSSProperties = {
  marginTop: 14,
  alignSelf: "flex-end",
  width: "auto",
  minWidth: 180,
  maxWidth: "100%",
  padding: "11px 18px",
  background: "#101010",
  color: "#ffffff",
  border: "none",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13,
  boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
};
const toggleRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, cursor: "pointer", userSelect: "none" };
const switchTrack = (on: boolean): CSSProperties => ({
  width: 42, height: 24, borderRadius: 999, background: on ? "#c5ff4a" : "rgba(17,17,17,0.16)",
  position: "relative", display: "inline-block", transition: "background 0.15s ease", flexShrink: 0,
});
const switchThumb = (on: boolean): CSSProperties => ({
  position: "absolute", top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: "50%",
  background: on ? "#111111" : "#ffffff", transition: "left 0.15s ease", boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
});
const optBtn = (active: boolean): CSSProperties => ({
  padding: "10px 12px",
  fontSize: 12.5,
  background: active ? "#111111" : "#ffffff",
  color: active ? "#ffffff" : "#2e2c28",
  border: `1px solid ${active ? "#111111" : "rgba(17,17,17,0.12)"}`,
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: active ? 800 : 600,
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "all 0.15s ease",
});
const closeBtnStyle: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "none",
  color: "#eef1ec",
  width: 30,
  height: 30,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  fontSize: 14,
  cursor: "pointer",
};
