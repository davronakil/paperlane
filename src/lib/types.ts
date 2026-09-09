/** All annotation geometry is stored in PDF user space (points, origin
 *  bottom-left of the MediaBox, unrotated) so it maps 1:1 onto pdf-lib. */

export type Pt = { x: number; y: number };

export type Tool =
  | 'select'
  | 'hand'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'ink'
  | 'eraser'
  | 'text'
  | 'note'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'signature'
  | 'image';

export interface BaseAnno {
  id: string;
  page: number;
  createdAt: number;
}

/** Text-markup: a set of rects harvested from the text layer. */
export interface MarkupAnno extends BaseAnno {
  kind: 'highlight' | 'underline' | 'strike';
  rects: { x: number; y: number; w: number; h: number }[];
  color: string;
  opacity: number;
  note?: string;
}

export interface InkAnno extends BaseAnno {
  kind: 'ink';
  paths: Pt[][];
  color: string;
  width: number;
  opacity: number;
}

export interface ShapeAnno extends BaseAnno {
  kind: 'rect' | 'ellipse' | 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  fill: string | null;
  width: number;
  opacity: number;
}

export interface TextAnno extends BaseAnno {
  kind: 'text';
  x: number; // bottom-left
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
  size: number;
  font: FontKey;
  align: 'left' | 'center' | 'right';
}

export interface NoteAnno extends BaseAnno {
  kind: 'note';
  x: number; // bottom-left of the 22x22pt icon
  y: number;
  text: string;
  color: string;
}

export interface ImageAnno extends BaseAnno {
  kind: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string; // data URL (png)
  label?: string;
}

export type Anno =
  | MarkupAnno
  | InkAnno
  | ShapeAnno
  | TextAnno
  | NoteAnno
  | ImageAnno;

export type FontKey =
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Times-Italic'
  | 'Courier'
  | 'Courier-Bold';

export type FieldType =
  | 'text'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'optionlist'
  | 'button'
  | 'signature';

export interface FormField {
  /** fully-qualified field name */
  name: string;
  type: FieldType;
  page: number;
  /** widget rect in PDF user space */
  x: number;
  y: number;
  w: number;
  h: number;
  value: string;
  options?: string[];
  /** for radio widgets: the export value this particular widget turns on */
  exportValue?: string;
  readOnly: boolean;
  multiline: boolean;
  maxLength?: number;
  fontSize: number;
  /** index of the widget within the field (radio groups have several) */
  widgetIndex: number;
}

export interface PageState {
  index: number; // original index in the source document
  rotation: number; // extra user rotation, multiple of 90
  deleted: boolean;
}

export interface SearchHit {
  page: number;
  index: number;
  text: string;
  rects: { x: number; y: number; w: number; h: number }[];
}
