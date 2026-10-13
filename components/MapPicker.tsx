"use client";

import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import L from "leaflet";

// Leaflet's default marker icon paths break under most bundlers (webpack/turbopack),
// so we point them at the CDN copies explicitly.
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface MapPickerProps {
  initialLat: number;
  initialLng: number;
  onConfirm: (lat: number, lng: number) => void;
  onClose: () => void;
}

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapPicker({ initialLat, initialLng, onConfirm, onClose }: MapPickerProps) {
  const [pos, setPos] = useState({ lat: initialLat, lng: initialLng });
  const handlePick = useCallback((lat: number, lng: number) => setPos({ lat, lng }), []);
  const center: LatLngExpression = [initialLat, initialLng];

  return (
    <div className="mp-overlay">
      <style>{`
        .mp-overlay {
          position: fixed;
          inset: 0;
          background: rgba(8, 14, 20, 0.75);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
        }
        .mp-modal {
          width: min(720px, 100%);
          height: min(560px, 88vh);
          background: #0e1b28;
          border: 1px solid rgba(226, 232, 224, 0.16);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 24px 60px rgba(0,0,0,0.4);
        }
        .mp-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 18px;
          border-bottom: 1px solid rgba(226, 232, 224, 0.12);
          background: #112132;
        }
        .mp-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 18px;
          border-top: 1px solid rgba(226, 232, 224, 0.12);
          background: #112132;
          gap: 12px;
          flex-wrap: wrap;
        }
        .mp-footer-btns {
          display: flex;
          gap: 10px;
        }
        @media (max-width: 640px) {
          .mp-overlay {
            padding: 0;
            align-items: flex-end;
          }
          .mp-modal {
            width: 100%;
            height: 92vh;
            border-radius: 20px 20px 0 0;
            border-bottom: none;
          }
          .mp-header {
            padding: 12px 16px;
          }
          .mp-footer {
            padding: 12px 16px max(12px, env(safe-area-inset-bottom));
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
          }
          .mp-footer-btns {
            width: 100%;
            display: flex;
            gap: 8px;
          }
          .mp-footer-btns button {
            flex: 1;
          }
        }
      `}</style>
      <div className="mp-modal">
        <div className="mp-header">
          <div>
            <div style={{ color: "#f4f6f2", fontWeight: 700, fontSize: 14 }}>Pilih Lokasi GPS</div>
            <div style={{ color: "#8fd8d0", fontFamily: "monospace", fontSize: 11, marginTop: 2 }}>
              Ketuk peta atau seret pin
            </div>
          </div>
          <button onClick={onClose} style={closeBtnStyle} aria-label="Tutup">✕</button>
        </div>

        <div style={{ flex: 1, position: "relative" }}>
          <MapContainer center={center} zoom={16} style={{ height: "100%", width: "100%" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickHandler onPick={handlePick} />
            <Marker
              position={[pos.lat, pos.lng]}
              draggable
              icon={markerIcon}
              eventHandlers={{
                dragend: (e) => {
                  const ll = e.target.getLatLng();
                  setPos({ lat: ll.lat, lng: ll.lng });
                },
              }}
            />
          </MapContainer>
        </div>

        <div className="mp-footer">
          <div style={{ fontFamily: "monospace", fontSize: 12, color: "#c7d0d4", background: "rgba(255,255,255,0.06)", padding: "6px 10px", borderRadius: 6, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>📍</span>
            <span>{pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}</span>
          </div>
          <div className="mp-footer-btns">
            <button onClick={onClose} style={ghostBtnStyle}>Batal</button>
            <button onClick={() => onConfirm(pos.lat, pos.lng)} style={confirmBtnStyle}>
              Gunakan Lokasi Ini
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const closeBtnStyle: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "none",
  color: "#eef1ec",
  width: 32,
  height: 32,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  fontSize: 14,
  cursor: "pointer",
};

const ghostBtnStyle: CSSProperties = {
  padding: "10px 16px",
  background: "transparent",
  border: "1px solid rgba(226,232,224,0.2)",
  color: "#eef1ec",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
  minHeight: 42,
};

const confirmBtnStyle: CSSProperties = {
  padding: "10px 18px",
  background: "#c5ff4a",
  border: "none",
  color: "#111111",
  fontWeight: 800,
  fontSize: 13,
  borderRadius: 8,
  cursor: "pointer",
  minHeight: 42,
};