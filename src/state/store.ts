import { create } from 'zustand';
import { PDFDocument } from 'pdf-lib';
import type {
  Anno,
  FontKey,
  FormField,
  PageState,
  SearchHit,
  Tool,
} from '../lib/types';
import { loadPdf, type PDFDocumentProxy } from '../lib/pdfjs';
import { readFormFields } from '../lib/forms';
import { uid } from '../lib/util';

export interface StampAsset {
  id: string;
  src: string;
  label: string;
  kind: 'signature' | 'initials' | 'stamp';
  /** natural aspect ratio (w/h) */
  ratio: number;
}

interface Snapshot {
  annos: Anno[];
  formValues: Record<string, string>;
  pages: PageState[];
}

interface State {
  // document ------------------------------------------------------------
  /** bumped on every document load; used to key render caches */
  docId: number;
  fileName: string;
  fileSize: number;
  bytes: ArrayBuffer | null;
  pdf: PDFDocumentProxy | null;
  numPages: number;
  loading: boolean;
  error: string | null;
  needsPassword: boolean;
  /** the source file carries an /Encrypt dictionary */
  encrypted: boolean;

  // editable model ------------------------------------------------------
  annos: Anno[];
  fields: FormField[];
  formValues: Record<string, string>;
  pages: PageState[];
  dirty: boolean;

  // history -------------------------------------------------------------
  past: Snapshot[];
  future: Snapshot[];

  // view ----------------------------------------------------------------
  tool: Tool;
  /** colour for text-markup tools */
  color: string;
  /** colour for pen, shapes, text boxes and notes */
  inkColor: string;
  strokeWidth: number;
  opacity: number;
  fontSize: number;
  fontKey: FontKey;
  fillEnabled: boolean;
  zoom: number;
  fitMode: 'width' | 'page' | 'none';
  currentPage: number;
  sidebar: 'thumbs' | 'outline' | 'annos' | 'search' | null;
  selectedAnno: string | null;
  pendingStamp: StampAsset | null;
  stamps: StampAsset[];
  showFields: boolean;
  searchQuery: string;
  searchHits: SearchHit[];
  activeHit: number;
  searching: boolean;
  toast: string | null;

  // actions -------------------------------------------------------------
  openFile: (file: File, password?: string) => Promise<void>;
  openBytes: (bytes: ArrayBuffer, name: string, password?: string) => Promise<void>;
  closeFile: () => void;
  set: <K extends keyof State>(k: K, v: State[K]) => void;
  commit: () => void;
  addAnno: (a: Anno) => void;
  updateAnno: (id: string, patch: Partial<Anno>, record?: boolean) => void;
  removeAnno: (id: string) => void;
  setFieldValue: (name: string, value: string) => void;
  setPages: (pages: PageState[]) => void;
  rotatePage: (index: number, delta: number) => void;
  deletePage: (index: number) => void;
  restorePage: (index: number) => void;
  undo: () => void;
  redo: () => void;
  addStamp: (s: Omit<StampAsset, 'id'>) => StampAsset;
  removeStamp: (id: string) => void;
  notify: (msg: string) => void;
}

const snap = (s: State): Snapshot => ({
  annos: s.annos,
  formValues: s.formValues,
  pages: s.pages,
});

const LS_STAMPS = 'paperlane.stamps';
const loadStamps = (): StampAsset[] => {
  try {
    return JSON.parse(localStorage.getItem(LS_STAMPS) || '[]');
  } catch {
    return [];
  }
};
const saveStamps = (s: StampAsset[]) => {
  try {
    localStorage.setItem(LS_STAMPS, JSON.stringify(s));
  } catch {
    /* quota */
  }
};

export const useStore = create<State>((set, get) => ({
  docId: 0,
  fileName: '',
  fileSize: 0,
  bytes: null,
  pdf: null,
  numPages: 0,
  loading: false,
  error: null,
  needsPassword: false,
  encrypted: false,

  annos: [],
  fields: [],
  formValues: {},
  pages: [],
  dirty: false,

  past: [],
  future: [],

  tool: 'select',
  color: '#ffd400',
  inkColor: '#e0453a',
  strokeWidth: 2,
  opacity: 0.4,
  fontSize: 12,
  fontKey: 'Helvetica',
  fillEnabled: false,
  zoom: 1,
  fitMode: 'width',
  currentPage: 1,
  sidebar: 'thumbs',
  selectedAnno: null,
  pendingStamp: null,
  stamps: loadStamps(),
  showFields: true,
  searchQuery: '',
  searchHits: [],
  activeHit: -1,
  searching: false,
  toast: null,

  set: (k, v) => set({ [k]: v } as any),

  notify: (msg) => {
    set({ toast: msg });
    setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 2600);
  },

  openFile: async (file, password) => {
    const buf = await file.arrayBuffer();
    await get().openBytes(buf, file.name, password);
  },

  openBytes: async (bytes, name, password) => {
    set({ loading: true, error: null, needsPassword: false });
    try {
      const pdf = await loadPdf(bytes, password);
      let fields: FormField[] = [];
      let values: Record<string, string> = {};
      let encrypted = false;
      try {
        const lib = await PDFDocument.load(bytes, { ignoreEncryption: true });
        encrypted = lib.isEncrypted;
        fields = readFormFields(lib);
        for (const f of fields) {
          if (values[f.name] === undefined) values[f.name] = f.value;
        }
      } catch {
        /* form parsing is best-effort */
      }
      const pages: PageState[] = Array.from({ length: pdf.numPages }, (_, i) => ({
        index: i,
        rotation: 0,
        deleted: false,
      }));
      set({
        docId: get().docId + 1,
        encrypted,
        bytes,
        pdf,
        fileName: name,
        fileSize: bytes.byteLength,
        numPages: pdf.numPages,
        annos: [],
        fields,
        formValues: values,
        pages,
        past: [],
        future: [],
        dirty: false,
        currentPage: 1,
        loading: false,
        selectedAnno: null,
        searchHits: [],
        searchQuery: '',
        activeHit: -1,
      });
    } catch (e: any) {
      const pwd = e?.name === 'PasswordException';
      set({
        loading: false,
        error: pwd ? null : e?.message || 'Could not open this PDF.',
        needsPassword: pwd,
      });
    }
  },

  closeFile: () =>
    set({
      bytes: null,
      pdf: null,
      fileName: '',
      numPages: 0,
      annos: [],
      fields: [],
      formValues: {},
      pages: [],
      past: [],
      future: [],
      dirty: false,
      error: null,
      needsPassword: false,
      encrypted: false,
      searchHits: [],
      searchQuery: '',
    }),

  commit: () =>
    set((s) => ({ past: [...s.past.slice(-60), snap(s)], future: [], dirty: true })),

  addAnno: (a) => {
    get().commit();
    set((s) => ({ annos: [...s.annos, a], selectedAnno: a.id }));
  },

  updateAnno: (id, patch, record = true) => {
    if (record) get().commit();
    set((s) => ({
      annos: s.annos.map((a) => (a.id === id ? ({ ...a, ...patch } as Anno) : a)),
      dirty: true,
    }));
  },

  removeAnno: (id) => {
    get().commit();
    set((s) => ({
      annos: s.annos.filter((a) => a.id !== id),
      selectedAnno: s.selectedAnno === id ? null : s.selectedAnno,
    }));
  },

  setFieldValue: (name, value) => {
    const prev = get().formValues[name];
    if (prev === value) return;
    get().commit();
    set((s) => ({ formValues: { ...s.formValues, [name]: value }, dirty: true }));
  },

  setPages: (pages) => {
    get().commit();
    set({ pages, dirty: true });
  },

  rotatePage: (index, delta) => {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) =>
        p.index === index
          ? { ...p, rotation: (((p.rotation + delta) % 360) + 360) % 360 }
          : p,
      ),
      dirty: true,
    }));
  },

  deletePage: (index) => {
    const s = get();
    if (s.pages.filter((p) => !p.deleted).length <= 1) {
      s.notify('A document needs at least one page.');
      return;
    }
    s.commit();
    set({
      pages: s.pages.map((p) => (p.index === index ? { ...p, deleted: true } : p)),
      dirty: true,
    });
  },

  restorePage: (index) => {
    get().commit();
    set((s) => ({
      pages: s.pages.map((p) => (p.index === index ? { ...p, deleted: false } : p)),
      dirty: true,
    }));
  },

  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const prev = s.past[s.past.length - 1];
    set({
      past: s.past.slice(0, -1),
      future: [snap(s), ...s.future].slice(0, 60),
      ...prev,
      selectedAnno: null,
    });
  },

  redo: () => {
    const s = get();
    if (!s.future.length) return;
    const next = s.future[0];
    set({
      future: s.future.slice(1),
      past: [...s.past, snap(s)],
      ...next,
      selectedAnno: null,
    });
  },

  addStamp: (s) => {
    const asset: StampAsset = { ...s, id: uid() };
    const list = [asset, ...get().stamps].slice(0, 12);
    saveStamps(list);
    set({ stamps: list });
    return asset;
  },

  removeStamp: (id) => {
    const list = get().stamps.filter((s) => s.id !== id);
    saveStamps(list);
    set({ stamps: list });
  },
}));

if (import.meta.env.DEV) (window as any).__store = useStore;
