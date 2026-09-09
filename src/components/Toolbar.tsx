import { useStore } from '../state/store';
import type { FontKey, Tool } from '../lib/types';
import {
  IcArrow,
  IcCursor,
  IcEllipse,
  IcEraser,
  IcEye,
  IcHand,
  IcHighlight,
  IcImage,
  IcLine,
  IcNote,
  IcPen,
  IcRect,
  IcSign,
  IcStrike,
  IcText,
  IcTrash,
  IcUnderline,
} from './Icons';

const PALETTE = [
  '#ffd400',
  '#ff8a3d',
  '#ff5c5c',
  '#ff7ac8',
  '#8b5cf6',
  '#3b82f6',
  '#22c55e',
  '#111827',
  '#ffffff',
];

const TOOLS: { id: Tool; icon: React.ReactElement; title: string; key?: string }[] = [
  { id: 'select', icon: <IcCursor />, title: 'Select', key: 'V' },
  { id: 'hand', icon: <IcHand />, title: 'Pan', key: 'H' },
  { id: 'highlight', icon: <IcHighlight />, title: 'Highlight text', key: 'A' },
  { id: 'underline', icon: <IcUnderline />, title: 'Underline text', key: 'U' },
  { id: 'strike', icon: <IcStrike />, title: 'Strike through text', key: 'S' },
  { id: 'ink', icon: <IcPen />, title: 'Draw', key: 'D' },
  { id: 'eraser', icon: <IcEraser />, title: 'Erase annotations', key: 'E' },
  { id: 'text', icon: <IcText />, title: 'Add text', key: 'T' },
  { id: 'note', icon: <IcNote />, title: 'Sticky note', key: 'N' },
  { id: 'rect', icon: <IcRect />, title: 'Rectangle', key: 'R' },
  { id: 'ellipse', icon: <IcEllipse />, title: 'Ellipse', key: 'O' },
  { id: 'line', icon: <IcLine />, title: 'Line', key: 'L' },
  { id: 'arrow', icon: <IcArrow />, title: 'Arrow' },
];

const MARKUP = new Set(['highlight', 'underline', 'strike']);
const SHAPES = new Set(['rect', 'ellipse', 'line', 'arrow']);

export function Toolbar({ onSign }: { onSign: (k: 'signature' | 'initials') => void }) {
  const tool = useStore((s) => s.tool);
  const markupColor = useStore((s) => s.color);
  const inkColor = useStore((s) => s.inkColor);
  const strokeWidth = useStore((s) => s.strokeWidth);
  const opacity = useStore((s) => s.opacity);
  const fontSize = useStore((s) => s.fontSize);
  const fontKey = useStore((s) => s.fontKey);
  const fillEnabled = useStore((s) => s.fillEnabled);
  const showFields = useStore((s) => s.showFields);
  const fields = useStore((s) => s.fields);
  const selectedAnno = useStore((s) => s.selectedAnno);
  const annos = useStore((s) => s.annos);
  const setState = useStore((s) => s.set);
  const updateAnno = useStore((s) => s.updateAnno);
  const removeAnno = useStore((s) => s.removeAnno);

  const sel = annos.find((a) => a.id === selectedAnno) ?? null;

  const pick = (t: Tool) => {
    setState('tool', t);
    setState('pendingStamp', null);
    if (MARKUP.has(t) && useStore.getState().opacity > 0.85)
      setState('opacity', 0.4);
  };

  const markupContext = MARKUP.has(tool) || (!!sel && MARKUP.has(sel.kind));
  const color = markupContext ? markupColor : inkColor;

  const applyColor = (c: string) => {
    setState(markupContext ? 'color' : 'inkColor', c);
    if (sel && 'color' in sel) updateAnno(sel.id, { color: c } as any);
  };

  const showStroke = tool === 'ink' || SHAPES.has(tool) || (sel && (sel.kind === 'ink' || SHAPES.has(sel.kind)));
  const showFont = tool === 'text' || sel?.kind === 'text';
  const showOpacity = MARKUP.has(tool) || (sel && MARKUP.has(sel.kind));

  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tbtn${tool === t.id ? ' on' : ''}`}
          title={t.key ? `${t.title}  (${t.key})` : t.title}
          onClick={() => pick(t.id)}
        >
          {t.icon}
        </button>
      ))}

      <div className="sep" />

      <button className="tbtn" title="Signature" onClick={() => onSign('signature')}>
        <IcSign />
        <span className="lbl">Sign</span>
      </button>
      <button className="tbtn" title="Initials" onClick={() => onSign('initials')}>
        <IcImage />
      </button>

      <div className="sep" />

      <div className="swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            className={`swatch${color === c ? ' on' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => applyColor(c)}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => applyColor(e.target.value)}
          style={{
            width: 22,
            height: 22,
            padding: 0,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
          }}
          title="Custom colour"
        />
      </div>

      {showStroke && (
        <>
          <div className="sep" />
          <span className="row-sub" style={{ margin: 0 }}>
            Width
          </span>
          <input
            type="range"
            min={0.5}
            max={16}
            step={0.5}
            value={sel && 'width' in sel ? (sel as any).width : strokeWidth}
            onChange={(e) => {
              const v = Number(e.target.value);
              setState('strokeWidth', v);
              if (sel && 'width' in sel) updateAnno(sel.id, { width: v } as any, false);
            }}
          />
          {SHAPES.has(tool) && (
            <button
              className={`tbtn${fillEnabled ? ' on' : ''}`}
              title="Filled shape"
              onClick={() => setState('fillEnabled', !fillEnabled)}
            >
              <span className="lbl">Fill</span>
            </button>
          )}
        </>
      )}

      {showOpacity && (
        <>
          <div className="sep" />
          <span className="row-sub" style={{ margin: 0 }}>
            Opacity
          </span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={sel && 'opacity' in sel ? (sel as any).opacity : opacity}
            onChange={(e) => {
              const v = Number(e.target.value);
              setState('opacity', v);
              if (sel && 'opacity' in sel)
                updateAnno(sel.id, { opacity: v } as any, false);
            }}
          />
        </>
      )}

      {showFont && (
        <>
          <div className="sep" />
          <select
            className="pageinput"
            style={{ width: 128 }}
            value={sel?.kind === 'text' ? sel.font : fontKey}
            onChange={(e) => {
              const v = e.target.value as FontKey;
              setState('fontKey', v);
              if (sel?.kind === 'text') updateAnno(sel.id, { font: v } as any);
            }}
          >
            {[
              'Helvetica',
              'Helvetica-Bold',
              'Helvetica-Oblique',
              'Times-Roman',
              'Times-Bold',
              'Times-Italic',
              'Courier',
              'Courier-Bold',
            ].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            className="pageinput"
            type="number"
            min={5}
            max={96}
            value={sel?.kind === 'text' ? sel.size : fontSize}
            onChange={(e) => {
              const v = Number(e.target.value) || 12;
              setState('fontSize', v);
              if (sel?.kind === 'text') updateAnno(sel.id, { size: v } as any, false);
            }}
          />
          <div className="pill">
            {(['left', 'center', 'right'] as const).map((al) => (
              <button
                key={al}
                className={`tbtn${
                  (sel?.kind === 'text' ? sel.align : 'left') === al ? ' on' : ''
                }`}
                onClick={() =>
                  sel?.kind === 'text' && updateAnno(sel.id, { align: al } as any)
                }
                title={`Align ${al}`}
              >
                <span className="lbl">{al[0].toUpperCase()}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {sel && (
        <>
          <div className="sep" />
          <button
            className="tbtn"
            title="Delete annotation  (⌫)"
            onClick={() => removeAnno(sel.id)}
          >
            <IcTrash />
          </button>
        </>
      )}

      <div className="spacer" />

      {fields.length > 0 && (
        <button
          className={`tbtn${showFields ? ' on' : ''}`}
          title={`${fields.length} form field${fields.length === 1 ? '' : 's'} — toggle highlighting`}
          onClick={() => setState('showFields', !showFields)}
        >
          <IcEye />
          <span className="lbl">{fields.length} fields</span>
        </button>
      )}
    </div>
  );
}
