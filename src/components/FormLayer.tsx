import { memo } from 'react';
import type { FormField } from '../lib/types';
import { boxCss, type Geom } from '../lib/geom';
import { useStore } from '../state/store';

interface Props {
  fields: FormField[];
  geom: Geom;
}

function FormLayerBase({ fields, geom }: Props) {
  const values = useStore((s) => s.formValues);
  const setFieldValue = useStore((s) => s.setFieldValue);

  return (
    <>
      {fields.map((f, i) => {
        const css = boxCss(geom, f.x, f.y, f.w, f.h);
        const style: React.CSSProperties = {
          ...css,
          fontSize: Math.max(6, f.fontSize * geom.scale),
          lineHeight: `${Math.max(8, css.height - 2)}px`,
        };
        const cls = `field${f.readOnly ? ' readonly' : ''}`;
        const key = `${f.name}::${f.widgetIndex}::${i}`;
        const val = values[f.name] ?? '';

        if (f.type === 'checkbox') {
          return (
            <input
              key={key}
              type="checkbox"
              className={cls}
              style={{ ...css }}
              title={f.name}
              checked={!!val}
              disabled={f.readOnly}
              onChange={(e) => setFieldValue(f.name, e.target.checked ? 'on' : '')}
            />
          );
        }
        if (f.type === 'radio') {
          return (
            <input
              key={key}
              type="radio"
              className={cls}
              style={{ ...css }}
              title={f.name}
              name={f.name}
              checked={!!f.exportValue && val === f.exportValue}
              disabled={f.readOnly}
              onChange={() => setFieldValue(f.name, f.exportValue ?? '')}
            />
          );
        }
        if (f.type === 'dropdown' || f.type === 'optionlist') {
          return (
            <select
              key={key}
              className={cls}
              style={style}
              title={f.name}
              value={val}
              disabled={f.readOnly}
              onChange={(e) => setFieldValue(f.name, e.target.value)}
            >
              <option value="" />
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          );
        }
        if (f.type === 'signature' || f.type === 'button') {
          return (
            <div
              key={key}
              className={`${cls} readonly`}
              style={{ ...style, pointerEvents: 'none' }}
              title={
                f.type === 'signature'
                  ? `${f.name} — use the Sign tool to place a signature`
                  : f.name
              }
            />
          );
        }
        if (f.multiline) {
          return (
            <textarea
              key={key}
              className={cls}
              style={{ ...style, lineHeight: 1.25, paddingTop: 1 }}
              title={f.name}
              value={val}
              maxLength={f.maxLength}
              readOnly={f.readOnly}
              onChange={(e) => setFieldValue(f.name, e.target.value)}
            />
          );
        }
        return (
          <input
            key={key}
            type="text"
            className={cls}
            style={style}
            title={f.name}
            value={val}
            maxLength={f.maxLength}
            readOnly={f.readOnly}
            onChange={(e) => setFieldValue(f.name, e.target.value)}
          />
        );
      })}
    </>
  );
}

export const FormLayer = memo(FormLayerBase);
