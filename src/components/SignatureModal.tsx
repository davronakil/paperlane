import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { trimCanvas } from '../lib/util';
import { IcTrash, IcX } from './Icons';

// System script faces — no webfont to download, so this works offline and
// looks native. Each entry falls back through Windows and generic cursive.
const SIG_FONTS = [
  { css: '"Snell Roundhand", "Brush Script MT", cursive', label: 'Roundhand' },
  { css: '"SignPainter", "Segoe Script", cursive', label: 'Marker' },
  { css: '"Bradley Hand", "Segoe Print", cursive', label: 'Casual' },
  { css: '"Zapfino", "Palatino Linotype", cursive', label: 'Formal' },
];

const INK = ['#111827', '#1d4ed8', '#b91c1c'];

interface Props {
  kind: 'signature' | 'initials';
  onClose: () => void;
}

export function SignatureModal({ kind, onClose }: Props) {
  const [tab, setTab] = useState<'draw' | 'type' | 'image'>('draw');
  const [typed, setTyped] = useState('');
  const [font, setFont] = useState(SIG_FONTS[0].css);
  const [ink, setInk] = useState(INK[0]);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const addStamp = useStore((s) => s.addStamp);
  const stamps = useStore((s) => s.stamps);
  const removeStamp = useStore((s) => s.removeStamp);
  const setState = useStore((s) => s.set);
  const notify = useStore((s) => s.notify);

  // ---- draw pad ---------------------------------------------------------
  useEffect(() => {
    if (tab !== 'draw') return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [tab]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || tab !== 'draw') return;
    const ctx = c.getContext('2d')!;
    let drawing = false;
    let last: [number, number] | null = null;
    let width = 2.6;

    const pos = (e: PointerEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e: PointerEvent) => {
      e.preventDefault();
      drawing = true;
      last = pos(e);
      c.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!drawing || !last) return;
      const p = pos(e);
      const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
      const target = Math.max(1.2, 4.2 - d * 0.14);
      width += (target - width) * 0.35;
      ctx.strokeStyle = ink;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      last = p;
      setHasInk(true);
    };
    const up = () => {
      drawing = false;
      last = null;
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [tab, ink]);

  const clearPad = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const renderTyped = (): string | null => {
    if (!typed.trim()) return null;
    const size = 96;
    const pad = 28;
    const m = document.createElement('canvas');
    const mc = m.getContext('2d')!;
    mc.font = `${size}px ${font}`;
    const w = Math.ceil(mc.measureText(typed).width) + pad * 2;
    m.width = Math.max(1, w);
    // generous height: ornate faces (Zapfino) have very tall ascenders
    m.height = Math.ceil(size * 2.8);
    const ctx = m.getContext('2d')!;
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle';
    ctx.fillText(typed, pad, m.height / 2);
    return trimCanvas(m);
  };

  const produce = (): string | null => {
    if (tab === 'draw') return canvasRef.current ? trimCanvas(canvasRef.current) : null;
    if (tab === 'type') return renderTyped();
    return uploaded;
  };

  const use = async (src?: string) => {
    const data = src ?? produce();
    if (!data) {
      notify('Nothing to place yet.');
      return;
    }
    const img = new Image();
    img.src = data;
    await img.decode().catch(() => {});
    const ratio = img.naturalWidth / Math.max(1, img.naturalHeight) || 3;
    const asset = src
      ? { id: '', src: data, label: kind, kind, ratio }
      : addStamp({ src: data, label: kind, kind, ratio });
    setState('pendingStamp', {
      ...asset,
      id: asset.id || 'tmp',
      ratio,
    } as any);
    setState('tool', 'signature');
    notify('Click on the page to place it.');
    onClose();
  };

  const onUpload = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const src = String(r.result);
      // normalise to PNG so pdf-lib can embed it
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        setUploaded(c.toDataURL('image/png'));
      };
      img.src = src;
    };
    r.readAsDataURL(f);
  };

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{kind === 'initials' ? 'Add initials' : 'Add a signature'}</h2>
          <button className="btn ghost" onClick={onClose}>
            <IcX />
          </button>
        </div>
        <div className="modal-body">
          {stamps.length > 0 && (
            <>
              <div className="field-label">Saved</div>
              <div className="stamp-grid" style={{ marginBottom: 18 }}>
                {stamps.map((s) => (
                  <div key={s.id} className="stamp-card" onClick={() => use(s.src)}>
                    <img src={s.src} alt={s.label} />
                    <button
                      className="x"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeStamp(s.id);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="tabs" style={{ marginBottom: 14 }}>
            <button className={tab === 'draw' ? 'on' : ''} onClick={() => setTab('draw')}>
              Draw
            </button>
            <button className={tab === 'type' ? 'on' : ''} onClick={() => setTab('type')}>
              Type
            </button>
            <button className={tab === 'image' ? 'on' : ''} onClick={() => setTab('image')}>
              Image
            </button>
          </div>

          {tab === 'draw' && (
            <>
              <canvas ref={canvasRef} className="sigpad" />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <span className="field-label" style={{ margin: 0 }}>
                  Ink
                </span>
                <div className="swatches">
                  {INK.map((c) => (
                    <button
                      key={c}
                      className={`swatch${ink === c ? ' on' : ''}`}
                      style={{ background: c }}
                      onClick={() => setInk(c)}
                    />
                  ))}
                </div>
                <div style={{ flex: 1 }} />
                <button className="btn ghost" onClick={clearPad} disabled={!hasInk}>
                  <IcTrash /> Clear
                </button>
              </div>
            </>
          )}

          {tab === 'type' && (
            <>
              <input
                className="sig-type-input"
                autoFocus
                placeholder={kind === 'initials' ? 'AB' : 'Your name'}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                style={{ fontFamily: font, color: ink }}
              />
              <div className="sig-fonts">
                {SIG_FONTS.map((f) => (
                  <button
                    key={f.css}
                    className={`sig-font${font === f.css ? ' on' : ''}`}
                    style={{ fontFamily: f.css }}
                    onClick={() => setFont(f.css)}
                  >
                    {typed || 'Signature'}
                  </button>
                ))}
              </div>
              <div className="swatches" style={{ marginTop: 12 }}>
                {INK.map((c) => (
                  <button
                    key={c}
                    className={`swatch${ink === c ? ' on' : ''}`}
                    style={{ background: c }}
                    onClick={() => setInk(c)}
                  />
                ))}
              </div>
            </>
          )}

          {tab === 'image' && (
            <>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
              {uploaded && (
                <div className="sig-preview" style={{ marginTop: 12 }}>
                  <img src={uploaded} alt="signature" />
                </div>
              )}
              <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
                A PNG with a transparent background works best.
              </p>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => use()}>
            Place on page
          </button>
        </div>
      </div>
    </div>
  );
}
