import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Thumb } from './Thumb';
import {
  IcChevD,
  IcChevR,
  IcComment,
  IcList,
  IcRotate,
  IcSearch,
  IcThumbs,
  IcTrash,
  IcX,
} from './Icons';
import { searchDocument } from '../lib/search';

export function Sidebar() {
  const mode = useStore((s) => s.sidebar);
  const setState = useStore((s) => s.set);

  if (!mode) return null;

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {(
          [
            ['thumbs', <IcThumbs key="a" />, 'Pages'],
            ['outline', <IcList key="b" />, 'Contents'],
            ['annos', <IcComment key="c" />, 'Annotations'],
            ['search', <IcSearch key="d" />, 'Search'],
          ] as const
        ).map(([k, icon, title]) => (
          <button
            key={k}
            className={`tbtn${mode === k ? ' on' : ''}`}
            title={title}
            onClick={() => setState('sidebar', k)}
          >
            {icon}
          </button>
        ))}
      </div>
      {mode === 'thumbs' && <Thumbs />}
      {mode === 'outline' && <Outline />}
      {mode === 'annos' && <AnnoList />}
      {mode === 'search' && <SearchPane />}
    </div>
  );
}

function Thumbs() {
  const pdf = useStore((s) => s.pdf)!;
  const docId = useStore((s) => s.docId);
  const pages = useStore((s) => s.pages);
  const current = useStore((s) => s.currentPage);
  const setPages = useStore((s) => s.setPages);
  const rotatePage = useStore((s) => s.rotatePage);
  const deletePage = useStore((s) => s.deletePage);
  const restorePage = useStore((s) => s.restorePage);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const drop = (to: number) => {
    if (dragFrom === null || dragFrom === to) return;
    const next = pages.slice();
    const [moved] = next.splice(dragFrom, 1);
    next.splice(to > dragFrom ? to - 1 : to, 0, moved);
    setPages(next);
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <div className="sidebar-scroll">
      {pages.map((p, i) => (
        <div
          key={p.index}
          className={`thumb${current === p.index + 1 ? ' active' : ''}${
            p.deleted ? ' deleted' : ''
          }${dragOver === i ? ' drop-before' : ''}`}
          draggable
          onDragStart={() => setDragFrom(i)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(i);
          }}
          onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
          onDrop={(e) => {
            e.preventDefault();
            drop(i);
          }}
          onDragEnd={() => {
            setDragFrom(null);
            setDragOver(null);
          }}
          onClick={() => (window as any).__paperlaneScrollToPage?.(p.index + 1)}
        >
          <Thumb pdf={pdf} docId={docId} pageNum={p.index + 1} rotation={p.rotation} />
          <div className="thumb-tools">
            <button
              title="Rotate right"
              onClick={(e) => {
                e.stopPropagation();
                rotatePage(p.index, 90);
              }}
            >
              <IcRotate />
            </button>
            <button
              title={p.deleted ? 'Restore page' : 'Remove page'}
              onClick={(e) => {
                e.stopPropagation();
                if (p.deleted) restorePage(p.index);
                else deletePage(p.index);
              }}
            >
              {p.deleted ? <IcChevR /> : <IcTrash />}
            </button>
          </div>
          <div className="thumb-label">{i + 1}</div>
        </div>
      ))}
    </div>
  );
}

interface OutlineNode {
  title: string;
  dest: any;
  items: OutlineNode[];
}

function Outline() {
  const pdf = useStore((s) => s.pdf)!;
  const [tree, setTree] = useState<OutlineNode[] | null>(null);

  useEffect(() => {
    let alive = true;
    pdf
      .getOutline()
      .then((o) => alive && setTree((o as any) ?? []))
      .catch(() => alive && setTree([]));
    return () => {
      alive = false;
    };
  }, [pdf]);

  const go = async (dest: any) => {
    try {
      const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!d) return;
      const ref = d[0];
      const num =
        typeof ref === 'object' ? (await pdf.getPageIndex(ref)) + 1 : Number(ref) + 1;
      (window as any).__paperlaneScrollToPage?.(num);
    } catch {
      /* broken destination */
    }
  };

  if (!tree) return <div className="empty">Loading…</div>;
  if (!tree.length)
    return <div className="empty">This document has no table of contents.</div>;

  const Node = ({ n, depth }: { n: OutlineNode; depth: number }) => {
    const [open, setOpen] = useState(depth < 1);
    return (
      <div>
        <div
          className="list-row"
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => go(n.dest)}
        >
          {n.items?.length ? (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setOpen(!open);
              }}
              style={{ width: 14, flex: 'none', opacity: 0.6 }}
            >
              {open ? <IcChevD /> : <IcChevR />}
            </span>
          ) : (
            <span style={{ width: 14, flex: 'none' }} />
          )}
          <div className="row-main">
            <div className="row-title">{n.title || '—'}</div>
          </div>
        </div>
        {open &&
          n.items?.map((c, i) => <Node key={i} n={c} depth={depth + 1} />)}
      </div>
    );
  };

  return (
    <div className="sidebar-scroll">
      {tree.map((n, i) => (
        <Node key={i} n={n} depth={0} />
      ))}
    </div>
  );
}

const LABEL: Record<string, string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strikethrough',
  ink: 'Drawing',
  text: 'Text',
  note: 'Note',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  image: 'Signature',
};

function AnnoList() {
  const annos = useStore((s) => s.annos);
  const selected = useStore((s) => s.selectedAnno);
  const setState = useStore((s) => s.set);
  const removeAnno = useStore((s) => s.removeAnno);

  const sorted = useMemo(
    () => annos.slice().sort((a, b) => a.page - b.page || a.createdAt - b.createdAt),
    [annos],
  );

  if (!sorted.length)
    return <div className="empty">No annotations yet. Pick a tool to start.</div>;

  return (
    <div className="sidebar-scroll">
      {sorted.map((a) => {
        const color = (a as any).color ?? '#888';
        const detail =
          a.kind === 'text' || a.kind === 'note'
            ? (a as any).text || '—'
            : a.kind === 'image'
              ? (a as any).label ?? 'Signature'
              : LABEL[a.kind];
        return (
          <div
            key={a.id}
            className={`list-row${selected === a.id ? ' active' : ''}`}
            onClick={() => {
              setState('selectedAnno', a.id);
              (window as any).__paperlaneScrollToPage?.(a.page + 1);
            }}
          >
            <span className="swatch-dot" style={{ background: color }} />
            <div className="row-main">
              <div className="row-title">{detail}</div>
              <div className="row-sub">
                {LABEL[a.kind]} · page {a.page + 1}
              </div>
            </div>
            <button
              className="tbtn"
              style={{ height: 20, minWidth: 20, padding: 0 }}
              title="Delete"
              onClick={(e) => {
                e.stopPropagation();
                removeAnno(a.id);
              }}
            >
              <IcX />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function SearchPane() {
  const pdf = useStore((s) => s.pdf)!;
  const query = useStore((s) => s.searchQuery);
  const hits = useStore((s) => s.searchHits);
  const active = useStore((s) => s.activeHit);
  const searching = useStore((s) => s.searching);
  const setState = useStore((s) => s.set);
  const inputRef = useRef<HTMLInputElement>(null);
  const token = useRef({ cancelled: false });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    token.current.cancelled = true;
    const sig = { cancelled: false };
    token.current = sig;
    if (query.trim().length < 2) {
      setState('searchHits', []);
      setState('activeHit', -1);
      setState('searching', false);
      return;
    }
    setState('searching', true);
    const t = setTimeout(async () => {
      const res = await searchDocument(pdf, query, sig);
      if (sig.cancelled) return;
      setState('searchHits', res);
      setState('activeHit', res.length ? 0 : -1);
      setState('searching', false);
    }, 220);
    return () => clearTimeout(t);
  }, [query, pdf, setState]);

  return (
    <>
      <div className="search-box">
        <IcSearch />
        <input
          ref={inputRef}
          value={query}
          placeholder="Search document"
          onChange={(e) => setState('searchQuery', e.target.value)}
        />
        {searching && <div className="spinner" />}
        {!!query && !searching && (
          <button
            className="tbtn"
            style={{ height: 18, minWidth: 18, padding: 0 }}
            onClick={() => setState('searchQuery', '')}
          >
            <IcX />
          </button>
        )}
      </div>
      <div className="sidebar-scroll" style={{ paddingTop: 0 }}>
        {query.trim().length >= 2 && !searching && !hits.length && (
          <div className="empty">No matches.</div>
        )}
        {hits.length > 0 && (
          <div className="row-sub" style={{ padding: '4px 8px 8px' }}>
            {hits.length} match{hits.length === 1 ? '' : 'es'}
          </div>
        )}
        {hits.map((h, i) => (
          <div
            key={`${h.page}-${h.index}`}
            className={`list-row${active === i ? ' active' : ''}`}
            onClick={() => setState('activeHit', i)}
          >
            <div className="row-main">
              <div className="row-title">{h.text}</div>
              <div className="row-sub">page {h.page + 1}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
