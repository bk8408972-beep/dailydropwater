import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface UpiQrCodeProps {
  upiUri: string;
  size?: number;
}

export function UpiQrCode({ upiUri, size = 200 }: UpiQrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setError(false);
    if (!upiUri.trim()) {
      setDataUrl(null);
      return;
    }

    QRCode.toDataURL(upiUri, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setError(true);
      });

    return () => {
      active = false;
    };
  }, [upiUri, size]);

  if (error || !dataUrl) {
    return (
      <div
        className="w-[180px] h-[180px] rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-xs text-slate-500 text-center p-3 mx-auto"
        role="status"
      >
        {error ? 'Unable to generate QR. Use UPI ID below.' : 'Generating UPI QR…'}
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt="Scannable UPI Payment QR Code"
      data-testid="upi-qr-image"
      width={size}
      height={size}
      className="w-[180px] h-[180px] rounded-xl border border-slate-200 bg-white p-1.5 mx-auto shadow-xs"
    />
  );
}
