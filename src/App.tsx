import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { Toolbar } from './components/Toolbar';
import { useClickAway } from './lib/useClickAway';
import { Sidebar } from './components/Sidebar';
import { Viewer } from './components/Viewer';
import { Welcome } from './components/Welcome';
import { SignatureModal } from './components/SignatureModal';
import { buildPdf, extractPages, mergePdfs } from './lib/export';
import { fontSizeMap } from './lib/forms';
import { downloadBlob, formatBytes } from './lib/util';
import { base64ToBytes, isNative, native, registerNativeHost } from './lib/native';
import {
  IcChevD,
  IcChevL,
  IcChevR,
  IcFile,
  IcFit,
  IcMerge,
  IcPrint,
  IcRedo,
  IcRotate,
  IcRotateL,
  IcSave,
  IcSidebar,
  IcTrash,
  IcUndo,
  IcX,
  IcZoomIn,
  IcZoomOut,
} from './components/Icons';

export default function App() {
  const s = useStore();
  const [sigModal, setSigModal] = useState<null | 'signature' | 'initials'>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [pageBox, setPageBox] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const pendingPwd = useRef<{ bytes: ArrayBuffer; name: string } | null>(null);

  const menuRef = useClickAway<HTMLDivElement>(() => setMenuOpen(false));

  useEffect(() => {
    setPageBox(String(s.currentPage));
  }, [s.currentPage]);

  useEffect(() => {
    document.title = s.fileName ? `${s.fileName} — Paperlane` : 'Paperlane';
  }, [s.fileName]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (s.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [s.dirty]);

  // ---- opening ----------------------------------------------------------
  const openBuffer = useCallback(
    async (bytes: ArrayBuffer, name: string) => {
      pendingPwd.current = { bytes, name };
      await s.openBytes(bytes, name);
    },
    [s],
  );

  const open = useCallback(
    async (file: File) => {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        s.notify('That is not a PDF.');
        return;
      }
      await openBuffer(await file.arrayBuffer(), file.name);
    },
    [s, openBuffer],
  );

  /** Native gets a real Open panel; the browser gets the hidden file input. */
  const chooseFile = useCallback(() => {
    if (isNative) native.openPanel('open');
    else fileInput.current?.click();
  }, []);

  const chooseInsert = useCallback(() => {
    if (isNative) native.openPanel('insert');
    else mergeInput.current?.click();
  }, []);

  const openSample = useCallback(async () => {
    try {
      const res = await fetch('samples/membership-form.pdf');
      const bytes = await res.arrayBuffer();
      pendingPwd.current = { bytes, name: 'membership-form.pdf' };
      await s.openBytes(bytes, 'membership-form.pdf');
    } catch {
      s.notify('Sample file is unavailable.');
    }
  }, [s]);

  const submitPassword = async () => {
    const p = pendingPwd.current;
    if (!p) return;
    await s.openBytes(p.bytes, p.name, password);
    setPassword('');
  };

  // ---- saving -----------------------------------------------------------
  const save = async (flatten: boolean) => {
    if (!s.bytes) return;
    setBusy(true);
    try {
      const out = await buildPdf(s.bytes, {
        annos: s.annos,
        formValues: s.formValues,
        fieldFontSizes: fontSizeMap(s.fields),
        pages: s.pages,
        flattenForm: flatten,
      });
      const base = s.fileName.replace(/\.pdf$/i, '');
      const name = `${base}${flatten ? ' (flattened)' : ' (edited)'}.pdf`;
      if (isNative) {
        // the shell shows a save panel and reports back through host.saved()
        native.save(out, name);
      } else {
        downloadBlob(out, name);
        useStore.setState({ dirty: false });
        s.notify('Saved.');
      }
    } catch (e: any) {
      s.notify(e?.message || 'Could not save this document.');
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const print = async () => {
    if (!s.bytes) return;
    setBusy(true);
    try {
      const out = await buildPdf(s.bytes, {
        annos: s.annos,
        formValues: s.formValues,
        fieldFontSizes: fontSizeMap(s.fields),
        pages: s.pages,
        flattenForm: true,
      });
      if (isNative) {
        native.print(out, s.fileName || 'Document');
        return;
      }
      const blob = new Blob([out.slice().buffer as ArrayBuffer], {
        type: 'application/pdf',
      });
      const url = URL.createObjectURL(blob);
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      frame.src = url;
      frame.onload = () => {
        setTimeout(() => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          } catch {
            window.open(url, '_blank');
          }
        }, 350);
      };
      document.body.appendChild(frame);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const doMerge = async (incoming: ArrayBuffer, label: string) => {
    if (!s.bytes) return;
    setBusy(true);
    try {
      const current = await buildPdf(s.bytes, {
        annos: s.annos,
        formValues: s.formValues,
        fieldFontSizes: fontSizeMap(s.fields),
        pages: s.pages,
      });
      const merged = await mergePdfs(current.slice().buffer as ArrayBuffer, incoming);
      await s.openBytes(merged.slice().buffer as ArrayBuffer, s.fileName);
      useStore.setState({ dirty: true });
      s.notify(`Inserted ${label}.`);
    } catch {
      s.notify('Could not merge that file.');
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const zoomBy = useCallback((f: number) => {
    const st = useStore.getState();
    const cur = st.fitMode === 'none' ? st.zoom : 1;
    useStore.setState({ zoom: Math.min(8, Math.max(0.15, cur * f)), fitMode: 'none' });
  }, []);

  // ---- macOS shell ------------------------------------------------------
  // The menu bar and the Open/Save/Print panels live in AppKit; they reach the
  // app through this host object. Kept in a ref so the callbacks never go stale.
  const hostRef = useRef({ save, print, doMerge, openBuffer, zoomBy });
  hostRef.current = { save, print, doMerge, openBuffer, zoomBy };

  useEffect(() => {
    if (!isNative) return;
    registerNativeHost({
      openFile(name, data, purpose) {
        const buf = base64ToBytes(data).slice().buffer as ArrayBuffer;
        if (purpose === 'insert') hostRef.current.doMerge(buf, name);
        else hostRef.current.openBuffer(buf, name);
      },
      saved(path) {
        useStore.setState({ dirty: false });
        useStore.getState().notify(`Saved to ${path.split('/').pop()}`);
      },
      command(cmd) {
        const st = useStore.getState();
        const goto = (n: number) =>
          (window as any).__paperlaneScrollToPage?.(
            Math.min(st.numPages, Math.max(1, n)),
          );
        switch (cmd) {
          case 'open':
            native.openPanel('open');
            break;
          case 'insert':
            native.openPanel('insert');
            break;
          case 'save':
            hostRef.current.save(false);
            break;
          case 'saveFlat':
            hostRef.current.save(true);
            break;
          case 'print':
            hostRef.current.print();
            break;
          case 'extract':
            setExtractOpen(true);
            break;
          case 'sign':
            setSigModal('signature');
            break;
          case 'find':
            useStore.setState({ sidebar: 'search' });
            break;
          case 'undo':
            st.undo();
            break;
          case 'redo':
            st.redo();
            break;
          case 'zoomIn':
            hostRef.current.zoomBy(1.15);
            break;
          case 'zoomOut':
            hostRef.current.zoomBy(1 / 1.15);
            break;
          case 'fitWidth':
            useStore.setState({ fitMode: 'width' });
            break;
          case 'fitPage':
            useStore.setState({ fitMode: 'page' });
            break;
          case 'sidebar':
            useStore.setState({ sidebar: st.sidebar ? null : 'thumbs' });
            break;
          case 'nextPage':
            goto(st.currentPage + 1);
            break;
          case 'prevPage':
            goto(st.currentPage - 1);
            break;
          case 'close':
            st.closeFile();
            break;
        }
      },
    });
  }, []);

  useEffect(() => {
    if (isNative) native.setTitle(s.fileName, s.dirty);
  }, [s.fileName, s.dirty]);

  // ---- keyboard ---------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save(false);
        return;
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        print();
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        useStore.setState({ sidebar: 'search' });
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        chooseFile();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomBy(1.15);
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        zoomBy(1 / 1.15);
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        useStore.setState({ fitMode: 'width' });
        return;
      }
      if (typing) return;

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (s.selectedAnno) {
          e.preventDefault();
          s.removeAnno(s.selectedAnno);
        }
        return;
      }
      if (e.key === 'Escape') {
        useStore.setState({ selectedAnno: null, pendingStamp: null, tool: 'select' });
        return;
      }
      const map: Record<string, string> = {
        v: 'select',
        h: 'hand',
        a: 'highlight',
        u: 'underline',
        s: 'strike',
        d: 'ink',
        e: 'eraser',
        t: 'text',
        n: 'note',
        r: 'rect',
        o: 'ellipse',
        l: 'line',
      };
      const tool = map[e.key.toLowerCase()];
      if (tool && !mod) {
        useStore.setState({ tool: tool as any, pendingStamp: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const goPage = (n: number) => {
    const clamped = Math.min(s.numPages, Math.max(1, n));
    (window as any).__paperlaneScrollToPage?.(clamped);
  };

  const zoomLabel =
    s.fitMode === 'width' ? 'Fit' : s.fitMode === 'page' ? 'Page' : `${Math.round(s.zoom * 100)}%`;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropOver(true);
        }
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        const f = e.dataTransfer.files?.[0];
        if (f) {
          e.preventDefault();
          setDropOver(false);
          open(f);
        }
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) open(f);
          e.target.value = '';
        }}
      />
      <input
        ref={mergeInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) doMerge(await f.arrayBuffer(), f.name);
        }}
      />

      <div className="titlebar">
        {s.pdf && (
          <button
            className={`tbtn${s.sidebar ? ' on' : ''}`}
            title="Toggle sidebar"
            onClick={() => s.set('sidebar', s.sidebar ? null : 'thumbs')}
          >
            <IcSidebar />
          </button>
        )}

        <button className="tbtn" title="Open a PDF  (⌘O)" onClick={chooseFile}>
          <IcFile />
          <span className="lbl">Open</span>
        </button>

        {s.pdf && (
          <>
            <div className="sep" />
            <div>
              <div className="doc-title">
                {s.fileName}
                {s.dirty ? ' •' : ''}
              </div>
              <div className="doc-sub">
                {s.pages.filter((p) => !p.deleted).length} pages · {formatBytes(s.fileSize)}
              </div>
            </div>

            <div className="spacer" />

            <div className="pill">
              <button className="tbtn" title="Undo  (⌘Z)" disabled={!s.past.length} onClick={s.undo}>
                <IcUndo />
              </button>
              <button className="tbtn" title="Redo  (⇧⌘Z)" disabled={!s.future.length} onClick={s.redo}>
                <IcRedo />
              </button>
            </div>

            <div className="pill">
              <button className="tbtn" title="Previous page" onClick={() => goPage(s.currentPage - 1)}>
                <IcChevL />
              </button>
              <input
                className="pageinput"
                value={pageBox}
                onChange={(e) => setPageBox(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    goPage(Number(pageBox) || 1);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onBlur={() => setPageBox(String(s.currentPage))}
              />
              <span className="zoomlabel" style={{ minWidth: 34 }}>
                / {s.numPages}
              </span>
              <button className="tbtn" title="Next page" onClick={() => goPage(s.currentPage + 1)}>
                <IcChevR />
              </button>
            </div>

            <div className="pill">
              <button className="tbtn" title="Zoom out  (⌘−)" onClick={() => zoomBy(1 / 1.15)}>
                <IcZoomOut />
              </button>
              <span className="zoomlabel">{zoomLabel}</span>
              <button className="tbtn" title="Zoom in  (⌘+)" onClick={() => zoomBy(1.15)}>
                <IcZoomIn />
              </button>
              <button
                className={`tbtn${s.fitMode !== 'none' ? ' on' : ''}`}
                title="Fit width / whole page  (⌘0)"
                onClick={() =>
                  s.set('fitMode', s.fitMode === 'width' ? 'page' : 'width')
                }
              >
                <IcFit />
              </button>
            </div>

            <div className="pill">
              <button
                className="tbtn"
                title="Rotate page left"
                onClick={() => s.rotatePage(s.currentPage - 1, -90)}
              >
                <IcRotateL />
              </button>
              <button
                className="tbtn"
                title="Rotate page right"
                onClick={() => s.rotatePage(s.currentPage - 1, 90)}
              >
                <IcRotate />
              </button>
            </div>

            <div className="sep" />

            <button className="tbtn primary" onClick={() => save(false)} disabled={busy}>
              {busy ? <div className="spinner" /> : <IcSave />}
              <span className="lbl">Save</span>
            </button>

            <div style={{ position: 'relative' }} ref={menuRef}>
              <button className="tbtn" onClick={() => setMenuOpen((v) => !v)} title="More">
                <IcChevD />
              </button>
              {menuOpen && (
                <div className="menu" style={{ right: 0, top: 34 }}>
                  <button onClick={() => save(false)}>
                    <IcSave /> Save a copy <span className="hint">⌘S</span>
                  </button>
                  <button onClick={() => save(true)}>
                    <IcSave /> Save flattened copy
                  </button>
                  <button onClick={print}>
                    <IcPrint /> Print <span className="hint">⌘P</span>
                  </button>
                  <div className="divider" />
                  <button onClick={chooseInsert}>
                    <IcMerge /> Insert another PDF…
                  </button>
                  <button
                    onClick={() => {
                      setExtractOpen(true);
                      setMenuOpen(false);
                    }}
                  >
                    <IcFile /> Extract pages…
                  </button>
                  <div className="divider" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      if (!s.dirty || confirm('Discard unsaved changes?')) s.closeFile();
                    }}
                  >
                    <IcTrash /> Close document
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {s.pdf && <Toolbar onSign={setSigModal} />}

      <div className="body">
        {s.pdf ? (
          <>
            <Sidebar />
            <Viewer />
          </>
        ) : (
          <Welcome onOpen={open} onSample={openSample} />
        )}
      </div>

      {dropOver && (
        <div className="backdrop" style={{ pointerEvents: 'none' }}>
          <div className="modal" style={{ width: 320, textAlign: 'center', padding: 30 }}>
            Drop to open
          </div>
        </div>
      )}

      {s.loading && (
        <div className="backdrop">
          <div className="modal" style={{ width: 260, padding: 26, textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Opening…
          </div>
        </div>
      )}

      {s.needsPassword && (
        <div className="backdrop">
          <div className="modal" style={{ width: 380 }}>
            <div className="modal-head">
              <h2>This PDF is password protected</h2>
            </div>
            <div className="modal-body">
              <input
                className="sig-type-input"
                type="password"
                autoFocus
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
              />
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => useStore.setState({ needsPassword: false })}>
                Cancel
              </button>
              <button className="btn primary" onClick={submitPassword}>
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}

      {s.error && (
        <div className="backdrop" onClick={() => useStore.setState({ error: null })}>
          <div className="modal" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Could not open that file</h2>
              <button className="btn ghost" onClick={() => useStore.setState({ error: null })}>
                <IcX />
              </button>
            </div>
            <div className="modal-body" style={{ color: 'var(--text-2)' }}>{s.error}</div>
          </div>
        </div>
      )}

      {extractOpen && <ExtractModal onClose={() => setExtractOpen(false)} />}
      {sigModal && <SignatureModal kind={sigModal} onClose={() => setSigModal(null)} />}

      {s.toast && <div className="toast">{s.toast}</div>}
    </div>
  );
}

function parseRanges(spec: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (m) {
      const a = Math.max(1, Number(m[1]));
      const b = Math.min(max, Number(m[2]));
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n >= 1 && n <= max) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function ExtractModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [spec, setSpec] = useState(`${s.currentPage}`);
  const indices = parseRanges(spec, s.numPages);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!s.bytes || !indices.length) return;
    setBusy(true);
    try {
      const current = await buildPdf(s.bytes, {
        annos: s.annos,
        formValues: s.formValues,
        fieldFontSizes: fontSizeMap(s.fields),
        pages: s.pages,
      });
      // map original indices onto the surviving order
      const kept = s.pages.filter((p) => !p.deleted);
      const map = indices
        .map((i) => kept.findIndex((k) => k.index === i))
        .filter((i) => i >= 0);
      const out = await extractPages(current.slice().buffer as ArrayBuffer, map);
      downloadBlob(out, `${s.fileName.replace(/\.pdf$/i, '')} (pages ${spec}).pdf`);
      s.notify('Extracted.');
      onClose();
    } catch {
      s.notify('Could not extract those pages.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Extract pages</h2>
          <button className="btn ghost" onClick={onClose}>
            <IcX />
          </button>
        </div>
        <div className="modal-body">
          <div className="field-label">Pages</div>
          <input
            className="sig-type-input"
            autoFocus
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="e.g. 1, 3-5, 8"
          />
          <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
            {indices.length
              ? `${indices.length} page${indices.length === 1 ? '' : 's'} will be saved to a new PDF.`
              : 'Enter page numbers or ranges.'}
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!indices.length || busy} onClick={run}>
            {busy ? 'Working…' : 'Extract'}
          </button>
        </div>
      </div>
    </div>
  );
}
