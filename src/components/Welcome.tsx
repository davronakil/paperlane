import { useState } from 'react';
import {
  IcCheck,
  IcFile,
  IcForm,
  IcPen,
  IcSign,
} from './Icons';

export function Welcome({
  onOpen,
  onSample,
}: {
  onOpen: (f: File) => void;
  onSample: () => void;
}) {
  const [over, setOver] = useState(false);

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Paperlane</h1>
        <p>Read, fill, sign and mark up PDFs — entirely on this device.</p>

        <label
          className={`dropzone${over ? ' over' : ''}`}
          style={{ display: 'block', cursor: 'pointer' }}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onOpen(f);
          }}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onOpen(f);
              e.target.value = '';
            }}
          />
          <IcFile />
          <div style={{ marginTop: 10, fontWeight: 550 }}>
            Drop a PDF here, or click to choose one
          </div>
          <div style={{ color: 'var(--text-3)', marginTop: 4, fontSize: 12 }}>
            Nothing is uploaded — the file never leaves your computer.
          </div>
        </label>

        <button
          className="btn ghost"
          style={{ marginTop: 12, color: 'var(--accent)' }}
          onClick={onSample}
        >
          or try the sample form
        </button>

        <div className="feature-grid">
          <div className="feature">
            <IcForm />
            <span>Fill real AcroForm fields and save them back into the file</span>
          </div>
          <div className="feature">
            <IcSign />
            <span>Draw, type or upload a signature and drop it anywhere</span>
          </div>
          <div className="feature">
            <IcPen />
            <span>Highlight, underline, draw, add notes, text and shapes</span>
          </div>
          <div className="feature">
            <IcCheck />
            <span>Reorder, rotate, delete, merge and extract pages</span>
          </div>
        </div>
      </div>
    </div>
  );
}
