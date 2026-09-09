import { useEffect, useRef, useState } from 'react';
import type { Anno, ImageAnno, NoteAnno, TextAnno } from '../lib/types';
import { boxCss, screenDeltaToPdf, type Geom } from '../lib/geom';
import { useStore } from '../state/store';
import { IcNote, IcTrash, IcX } from './Icons';

const CSS_FONT: Record<string, string> = {
  Helvetica: '400 normal Helvetica, Arial, sans-serif',
  'Helvetica-Bold': '700 normal Helvetica, Arial, sans-serif',
  'Helvetica-Oblique': '400 italic Helvetica, Arial, sans-serif',
  'Times-Roman': `400 normal 'Times New Roman', Times, serif`,
  'Times-Bold': `700 normal 'Times New Roman', Times, serif`,
  'Times-Italic': `400 italic 'Times New Roman', Times, serif`,
  Courier: `400 normal 'Courier New', Courier, monospace`,
  'Courier-Bold': `700 normal 'Courier New', Courier, monospace`,
};

function fontStyle(key: string) {
  const spec = CSS_FONT[key] ?? CSS_FONT.Helvetica;
  const [weight, style, ...rest] = spec.split(' ');
  return { fontWeight: weight, fontStyle: style, fontFamily: rest.join(' ') };
}

interface Props {
  annos: Anno[];
  geom: Geom;
  selected: string | null;
  editing: string | null;
  interactive: boolean;
  onSelect: (id: string | null) => void;
  onEdit: (id: string | null) => void;
}

export function BoxAnnos({
  annos,
  geom,
  selected,
  editing,
  interactive,
  onSelect,
  onEdit,
}: Props) {
  const updateAnno = useStore((s) => s.updateAnno);
  const removeAnno = useStore((s) => s.removeAnno);
  const commit = useStore((s) => s.commit);

  const startDrag = (
    e: React.PointerEvent,
    a: Anno,
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se',
  ) => {
    if (!interactive) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(a.id);
    const box = a as TextAnno | ImageAnno | NoteAnno;
    const start = {
      x: (box as any).x,
      y: (box as any).y,
      w: (box as any).w ?? 22,
      h: (box as any).h ?? 22,
    };
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const [dx, dy] = screenDeltaToPdf(geom, ev.clientX - sx, ev.clientY - sy);
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 2) return;
      if (!moved) {
        moved = true;
        commit();
      }
      if (mode === 'move') {
        updateAnno(a.id, { x: start.x + dx, y: start.y + dy } as any, false);
        return;
      }
      let { x, y, w, h } = start;
      if (mode === 'se') {
        w = Math.max(12, start.w + dx);
        h = Math.max(10, start.h - dy);
        y = start.y + start.h - h;
      } else if (mode === 'ne') {
        w = Math.max(12, start.w + dx);
        h = Math.max(10, start.h + dy);
      } else if (mode === 'sw') {
        w = Math.max(12, start.w - dx);
        x = start.x + start.w - w;
        h = Math.max(10, start.h - dy);
        y = start.y + start.h - h;
      } else {
        w = Math.max(12, start.w - dx);
        x = start.x + start.w - w;
        h = Math.max(10, start.h + dy);
      }
      updateAnno(a.id, { x, y, w, h } as any, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handles = (a: Anno) =>
    (['nw', 'ne', 'sw', 'se'] as const).map((m) => (
      <div
        key={m}
        className={`handle ${m}`}
        onPointerDown={(e) => startDrag(e, a, m)}
      />
    ));

  return (
    <>
      {annos.map((a) => {
        if (a.kind === 'text') {
          const css = boxCss(geom, a.x, a.y, a.w, a.h);
          const isEditing = editing === a.id;
          return (
            <div
              key={a.id}
              className={`box-anno${selected === a.id ? ' selected' : ''}`}
              style={{ ...css, cursor: interactive ? 'move' : 'default' }}
              onPointerDown={(e) => {
                if (isEditing) return;
                startDrag(e, a, 'move');
              }}
              onDoubleClick={() => interactive && onEdit(a.id)}
            >
              <TextBody
                a={a}
                scale={geom.scale}
                editing={isEditing}
                onChange={(t) => updateAnno(a.id, { text: t } as any, false)}
                onBlur={() => onEdit(null)}
              />
              {selected === a.id && interactive && !isEditing && handles(a)}
            </div>
          );
        }

        if (a.kind === 'image') {
          const css = boxCss(geom, a.x, a.y, a.w, a.h);
          return (
            <div
              key={a.id}
              className={`box-anno${selected === a.id ? ' selected' : ''}`}
              style={{ ...css, cursor: interactive ? 'move' : 'default' }}
              onPointerDown={(e) => startDrag(e, a, 'move')}
            >
              <img src={a.src} alt={a.label ?? 'stamp'} draggable={false} />
              {selected === a.id && interactive && handles(a)}
            </div>
          );
        }

        if (a.kind === 'note') {
          const css = boxCss(geom, a.x, a.y, 22, 22);
          const open = editing === a.id;
          return (
            <div key={a.id}>
              <div
                className="note-pin"
                style={{
                  left: css.left,
                  top: css.top,
                  width: 22 * Math.max(0.7, geom.scale),
                  height: 22 * Math.max(0.7, geom.scale),
                  background: a.color,
                  cursor: interactive ? 'move' : 'default',
                }}
                title={a.text}
                onPointerDown={(e) => startDrag(e, a, 'move')}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(open ? null : a.id);
                }}
              >
                <IcNote />
              </div>
              {open && (
                <div
                  className="note-pop"
                  style={{ left: css.left, top: css.top + 26 }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <textarea
                    autoFocus
                    value={a.text}
                    placeholder="Add a comment…"
                    onChange={(e) =>
                      updateAnno(a.id, { text: e.target.value } as any, false)
                    }
                  />
                  <div className="note-pop-row">
                    <button
                      className="btn ghost"
                      onClick={() => removeAnno(a.id)}
                      title="Delete note"
                    >
                      <IcTrash />
                    </button>
                    <div style={{ flex: 1 }} />
                    <button className="btn" onClick={() => onEdit(null)}>
                      <IcX />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        }
        return null;
      })}
    </>
  );
}

function TextBody({
  a,
  scale,
  editing,
  onChange,
  onBlur,
}: {
  a: TextAnno;
  scale: number;
  editing: boolean;
  onChange: (t: string) => void;
  onBlur: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [local, setLocal] = useState(a.text);
  useEffect(() => setLocal(a.text), [a.text]);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  const style: React.CSSProperties = {
    ...fontStyle(a.font),
    fontSize: a.size * scale,
    lineHeight: 1.25,
    color: a.color,
    textAlign: a.align,
  };

  if (editing)
    return (
      <textarea
        ref={ref}
        style={style}
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(e.target.value);
        }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur();
          e.stopPropagation();
        }}
      />
    );

  return (
    <div
      style={{
        ...style,
        padding: 2,
        whiteSpace: 'pre-wrap',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        userSelect: 'none',
      }}
    >
      {a.text || <span style={{ opacity: 0.4 }}>Text</span>}
    </div>
  );
}
