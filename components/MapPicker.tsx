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
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <span>Pilih Lokasi — klik peta, geser pin, atau zoom untuk memperjelas</span>
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

        <div style={footerStyle}>
          <span style={{ fontFamily: "monospace", fontSize: 13 }}>
            {pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}
          </span>
          <div style={{ display: "flex", gap: 10 }}>
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

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8,14,20,0.7)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 20,
};

const modalStyle: CSSProperties = {
  width: "min(720px, 100%)",
  height: "min(560px, 90vh)",
  background: "#0e1b28",
  border: "1px solid rgba(226,232,224,0.14)",
  borderRadius: 4,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  color: "#eef1ec",
  fontFamily: "monospace",
  fontSize: 13,
  borderBottom: "1px solid rgba(226,232,224,0.14)",
};

const closeBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#eef1ec",
  fontSize: 16,
  cursor: "pointer",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderTop: "1px solid rgba(226,232,224,0.14)",
  color: "#eef1ec",
};

const ghostBtnStyle: CSSProperties = {
  padding: "8px 14px",
  background: "transparent",
  border: "1px solid rgba(226,232,224,0.14)",
  color: "#eef1ec",
  borderRadius: 2,
  cursor: "pointer",
};

const confirmBtnStyle: CSSProperties = {
  padding: "8px 14px",
  background: "#f2a93b",
  border: "none",
  color: "#0e1b28",
  fontWeight: 700,
  borderRadius: 2,
  cursor: "pointer",
};