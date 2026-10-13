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
        .sw-page{position:relative;overflow:hidden}
        .sw-page:before{content:"";position:absolute;inset:10px;border:1px solid rgba(18,18,18,.08);border-radius:8px;pointer-events:none}
        .sw-grid{display:grid;grid-template-columns:340px 1fr;gap:24px;position:relative;z-index:1}
        .sw-grid > *{min-width:0}
        .sw-title{font-family:Georgia,"Times New Roman",serif}
        .sw-preview canvas{border-radius:8px;box-shadow:0 34px 80px rgba(16,20,28,.16)}
        @media (max-width:820px){
          .sw-page{padding:14px !important}
          .sw-grid{grid-template-columns:1fr}
          .sw-preview{order:-1;min-height:0 !important}
          .sw-title{font-size:42px !important;line-height:.95 !important}
          .sw-subtitle{max-width:none !important}
        }
      `}</style>
      <div style={brandHeaderStyle}>
        <div style={brandStyle}>
          <NextImage src="/icon.png" alt="Stempel Waktu" width={34} height={34} style={brandIconStyle} priority />
          <span>Timesramp</span>
        </div>
        <nav style={navPillStyle} aria-label="Navigasi">
          <a href="#foto" style={navLinkStyle}>Foto</a>
          <a href="#waktu" style={navLinkStyle}>Waktu</a>
          <a href="#gaya" style={navLinkStyle}>Gaya</a>
          <a href="#hasil" style={navLinkStyle}>Hasil</a>
        </nav>
        <button style={darkBtn} onClick={() => fileInputRef.current?.click()}>
          Upload foto -&gt;
        </button>
      </div>

      <section style={heroCopyStyle}>
        <p style={eyebrowStyle}>Timestamp dan geotag online</p>
        <h1 className="sw-title" style={heroTitleStyle}>
          Stempel waktu
          <span style={heroItalicStyle}>untuk foto lapangan.</span>
        </h1>
        <p className="sw-subtitle" style={subheadStyle}>
          Unggah foto, ambil lokasi GPS, atur alamat, lalu simpan hasil dengan tampilan bersih seperti kamera profesional.
        </p>
        <div style={heroActionsStyle}>
          <button style={darkBtn} onClick={() => fileInputRef.current?.click()}>
            Mulai unggah -&gt;
          </button>
          <button style={lightBtn} onClick={useCurrentLocation}>
            Ambil lokasi
          </button>
        </div>
      </section>

      <div className="sw-grid">
        <div>
          <div id="foto" style={panelStyle}>
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

            <label id="waktu" style={{ ...labelStyle, marginTop: 16 }}>Tanggal &amp; Waktu</label>
            <input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} style={inputStyle} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              {([["Jam", hh, setHh, 23], ["Menit", mm, setMm, 59], ["Detik", ss, setSs, 59]] as const).map(([lbl, val, setter, max], i) => (
                <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  {i > 0 && <span style={{ color: "#8fd8d0", fontFamily: "monospace" }}>:</span>}
                  <input
                    aria-label={lbl}
                    placeholder={lbl}
                    inputMode="numeric"
                    maxLength={2}
                    value={val}
                    onChange={onTimePart(setter, max)}
                    onBlur={() => setter(pad2(val))}
                    onFocus={(e) => e.target.select()}
                    style={{ ...inputStyle, textAlign: "center", padding: "9px 4px" }}
                  />
                </div>
              ))}
            </div>
            <button style={{ ...ghostBtn, width: "100%", marginTop: 8, flex: "none" }} onClick={setNow}>
              🕒 Pakai waktu sekarang
            </button>

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

          <div id="gaya" style={{ ...panelStyle, marginTop: 16 }}>
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

            <label style={{ ...labelStyle, marginTop: 14 }}>Font</label>
            <div style={optsRow}>
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFontId(f.id)}
                  style={{ ...optBtn(fontId === f.id), fontFamily: f.css, fontWeight: f.weight }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <label style={{ ...labelStyle, marginTop: 14 }}>Jarak huruf ({letterSpacing}px)</label>
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={letterSpacing}
              onChange={(e) => setLetterSpacing(Number(e.target.value))}
              style={{ width: "100%" }}
            />

            <label style={toggleRowStyle}>
              <span style={{ fontFamily: "monospace", fontSize: 12, color: "#c7d0d4" }}>
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

            <label style={{ ...labelStyle, marginTop: 14 }}>Warna aksen</label>
            <div style={{ display: "flex", gap: 8 }}>
              {["#111111", "#c5ff4a", "#ff8d5c", "#7b61ff", "#2bb7a8"].map((c) => (
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

        <div id="hasil" className="sw-preview" style={previewStyle}>
          <div style={floatingCardLeftStyle}>
            <span style={miniIconStyle}>01</span>
            <strong>Unggah foto</strong>
            <small>Diproses langsung di browser.</small>
          </div>
          <div style={floatingCardRightStyle}>
            <strong>GPS siap</strong>
            <small>{lat !== null && lng !== null ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "Ambil atau pilih lokasi."}</small>
          </div>
          {!photoUrl && (
            <div style={emptyPreviewStyle}>
              <NextImage src="/icon.png" alt="" width={64} height={64} style={{ opacity: 0.9 }} />
              <strong>Belum ada foto</strong>
              <span>Unggah gambar untuk melihat preview stempel.</span>
            </div>
          )}
          <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto", display: photoUrl ? "block" : "none" }} />
          {photoUrl && (
            <button style={downloadBtn} onClick={handleDownload}>
              Unduh / Simpan Foto
            </button>
          )}
        </div>
      </div>

      {saveSheetUrl && (
        <div
          onClick={() => { URL.revokeObjectURL(saveSheetUrl); setSaveSheetUrl(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,14,20,0.92)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, gap: 12 }}
        >
          <p style={{ margin: 0, fontSize: 14, textAlign: "center", color: "#eef1ec" }}>
            Tekan &amp; tahan gambar → pilih <b>Simpan ke Foto</b>
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={saveSheetUrl} alt="Hasil foto" style={{ maxWidth: "100%", maxHeight: "75vh", objectFit: "contain" }} onClick={(e) => e.stopPropagation()} />
          <span style={{ fontSize: 12, color: "#8fd8d0", fontFamily: "monospace" }}>ketuk di luar gambar untuk menutup</span>
        </div>
      )}

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
const inputStyle: CSSProperties = { width: "100%", background: "#ffffff", border: "1px solid rgba(17,17,17,0.12)", color: "#111111", padding: "9px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 16 };
const dropStyle: CSSProperties = { width: "100%", padding: "18px 10px", background: "#f4f1ea", border: "1px dashed rgba(17,17,17,0.22)", color: "#111111", textAlign: "center", fontSize: 13, cursor: "pointer", borderRadius: 6, fontWeight: 700 };
const ghostBtn: CSSProperties = { flex: 1, padding: 9, background: "#ffffff", color: "#111111", border: "1px solid rgba(17,17,17,0.14)", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700 };
const mainBtnSm: CSSProperties = { flex: 1, padding: 9, background: "#c5ff4a", color: "#111111", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 800, fontSize: 13 };
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
  padding: "9px 14px",
  background: "#101010",
  color: "#ffffff",
  border: "none",
  borderRadius: 999,
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 13,
};
const optsRow: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const toggleRowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, cursor: "pointer" };
const switchTrack = (on: boolean): CSSProperties => ({
  width: 38, height: 20, borderRadius: 999, background: on ? "#c5ff4a" : "rgba(17,17,17,0.14)",
  position: "relative", display: "inline-block", transition: "background 0.15s ease", flexShrink: 0,
});
const switchThumb = (on: boolean): CSSProperties => ({
  position: "absolute", top: 2, left: on ? 20 : 2, width: 16, height: 16, borderRadius: "50%",
  background: on ? "#111111" : "#ffffff", transition: "left 0.15s ease",
});
const optBtn = (active: boolean): CSSProperties => ({
  padding: "7px 11px",
  fontSize: 12,
  background: active ? "#111111" : "#ffffff",
  color: active ? "#ffffff" : "#2e2c28",
  border: `1px solid ${active ? "#111111" : "rgba(17,17,17,0.12)"}`,
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: active ? 800 : 600,
});
