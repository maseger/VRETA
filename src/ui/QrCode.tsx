import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCode({ value, className }: { value: string; className?: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#2A2824", light: "#00000000" } }).then(setSvg);
  }, [value]);
  return <div className={className} role="img" aria-label="QR-kod" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const locationUrl = (id: string) => `${window.location.origin}${import.meta.env.BASE_URL}lager/${id}`;
