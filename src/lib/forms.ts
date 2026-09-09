import {
  PDFDocument,
  PDFName,
  PDFRef,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
  PDFSignature,
  PDFButton,
} from 'pdf-lib';
import type { FormField, FieldType } from './types';

/** Read every AcroForm widget out of the document and flatten it into a
 *  list the UI can position on top of the rendered pages. */
export function readFormFields(doc: PDFDocument): FormField[] {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }

  const pages = doc.getPages();
  const refTag = new Map<string, number>();
  pages.forEach((p, i) => refTag.set(p.ref.toString(), i));

  // Fallback lookup: widget ref -> page, by scanning each page's /Annots.
  const annotToPage = new Map<string, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const ref = annots.get(k);
      if (ref instanceof PDFRef) annotToPage.set(ref.toString(), i);
    }
  });

  const out: FormField[] = [];
  let fields;
  try {
    fields = form.getFields();
  } catch {
    return [];
  }

  for (const field of fields) {
    const name = field.getName();
    let type: FieldType = 'text';
    let options: string[] | undefined;
    let value = '';
    let multiline = false;
    let maxLength: number | undefined;

    try {
      if (field instanceof PDFTextField) {
        type = 'text';
        value = field.getText() ?? '';
        multiline = field.isMultiline();
        maxLength = field.getMaxLength() ?? undefined;
      } else if (field instanceof PDFCheckBox) {
        type = 'checkbox';
        value = field.isChecked() ? 'on' : '';
      } else if (field instanceof PDFRadioGroup) {
        type = 'radio';
        options = field.getOptions();
        value = field.getSelected() ?? '';
      } else if (field instanceof PDFDropdown) {
        type = 'dropdown';
        options = field.getOptions();
        value = field.getSelected()[0] ?? '';
      } else if (field instanceof PDFOptionList) {
        type = 'optionlist';
        options = field.getOptions();
        value = field.getSelected()[0] ?? '';
      } else if (field instanceof PDFSignature) {
        type = 'signature';
      } else if (field instanceof PDFButton) {
        type = 'button';
      }
    } catch {
      /* malformed field — still show the widget */
    }

    let readOnly = false;
    try {
      readOnly = field.isReadOnly();
    } catch {
      /* ignore */
    }

    let widgets: ReturnType<typeof field.acroField.getWidgets>;
    try {
      widgets = field.acroField.getWidgets();
    } catch {
      continue;
    }

    widgets.forEach((w, wi) => {
      let rect;
      try {
        rect = w.getRectangle();
      } catch {
        return;
      }
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      // Which page does this widget live on?
      let page = -1;
      const p = w.dict.get(PDFName.of('P'));
      if (p instanceof PDFRef) page = refTag.get(p.toString()) ?? -1;
      if (page < 0) {
        const wref = doc.context.getObjectRef(w.dict);
        if (wref) page = annotToPage.get(wref.toString()) ?? -1;
      }
      if (page < 0) return;

      // Radio widgets each carry their own export value in /AP /N.
      let exportValue: string | undefined;
      if (type === 'radio' && options) exportValue = options[wi];

      // Font size: honour the field's /DA when it fits the widget, otherwise
      // pick a size that actually does. Whatever we show here is also written
      // back on save, so the preview and the output agree.
      let daSize = 0;
      const da =
        w.dict.get(PDFName.of('DA')) ?? field.acroField.dict.get(PDFName.of('DA'));
      if (da && typeof (da as any).asString === 'function') {
        const m = /\/\S+\s+([\d.]+)\s+Tf/.exec((da as any).asString());
        if (m) daSize = parseFloat(m[1]);
      }
      const cap = multiline
        ? Math.min(12, rect.height / 3)
        : rect.height * 0.68;
      let fontSize = daSize;
      if (!fontSize || fontSize > cap)
        fontSize = Math.max(5.5, Math.min(cap, 11));

      out.push({
        name,
        type,
        page,
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
        value,
        options,
        exportValue,
        readOnly,
        multiline,
        maxLength,
        fontSize,
        widgetIndex: wi,
      });
    });
  }
  return out;
}

/** Push edited values back into the AcroForm before saving. */
export function applyFormValues(
  doc: PDFDocument,
  values: Record<string, string>,
  fontSizes?: Record<string, number>,
) {
  let form;
  try {
    form = doc.getForm();
  } catch {
    return;
  }
  for (const [name, val] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue;
    }
    try {
      if (field instanceof PDFTextField) {
        const fs = fontSizes?.[name];
        if (fs) field.setFontSize(fs);
        field.setText(val);
      } else if (field instanceof PDFCheckBox) {
        if (val) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (val) field.select(val);
        else field.clear();
      } else if (field instanceof PDFDropdown) {
        if (val) field.select(val);
        else field.clear();
      } else if (field instanceof PDFOptionList) {
        if (val) field.select(val);
        else field.clear();
      }
    } catch {
      /* value not in the option list, or a broken field — skip it */
    }
  }
  try {
    form.updateFieldAppearances();
  } catch {
    /* ignore appearance-generation failures on exotic fonts */
  }
}

/** field name -> chosen display font size */
export const fontSizeMap = (fields: FormField[]): Record<string, number> =>
  Object.fromEntries(fields.map((f) => [f.name, f.fontSize]));
