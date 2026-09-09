type P = { className?: string };
const S = (d: React.ReactNode, extra?: object) => (p: P) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={p.className}
    {...extra}
  >
    {d}
  </svg>
);

export const IcCursor = S(
  <path d="M5 3l6.5 16.5 2.2-6.3 6.3-2.2z" />,
);
export const IcHand = S(
  <>
    <path d="M9 11V5.5a1.5 1.5 0 013 0V11" />
    <path d="M12 10.5V4.8a1.5 1.5 0 013 0V11" />
    <path d="M15 11V7a1.5 1.5 0 013 0v7.5c0 3.6-2.4 6-6 6-3 0-4.4-1-6-3l-2.6-4a1.4 1.4 0 012.2-1.7L9 14V5.5" />
  </>,
);
export const IcHighlight = S(
  <>
    <path d="M14 4l6 6-8.5 8.5H5.5V13z" />
    <path d="M3 21h18" strokeWidth={2.4} />
  </>,
);
export const IcUnderline = S(
  <>
    <path d="M7 4v7a5 5 0 0010 0V4" />
    <path d="M5 20h14" strokeWidth={2.2} />
  </>,
);
export const IcStrike = S(
  <>
    <path d="M7 5.5C7 4 8.8 3 12 3s5 1.2 5 3" />
    <path d="M4 12h16" strokeWidth={2.2} />
    <path d="M7 16c0 2 2 3.5 5 3.5s5-1.2 5-3.2" />
  </>,
);
export const IcPen = S(
  <>
    <path d="M16.5 3.5l4 4L8 20l-5 1 1-5z" />
    <path d="M14 6l4 4" />
  </>,
);
export const IcEraser = S(
  <>
    <path d="M4 16.5L11 9.5l6.5 6.5-3 3H7z" />
    <path d="M11 9.5l4-4a2 2 0 012.8 0l3.7 3.7a2 2 0 010 2.8l-4 4" />
    <path d="M10 21h11" />
  </>,
);
export const IcText = S(
  <>
    <path d="M5 6V4h14v2" />
    <path d="M12 4v16M9 20h6" />
  </>,
);
export const IcNote = S(
  <>
    <path d="M4 5h16v10H9l-5 4z" />
    <path d="M8 9h8M8 12h5" />
  </>,
);
export const IcRect = S(<rect x="4" y="6" width="16" height="12" rx="1.5" />);
export const IcEllipse = S(<ellipse cx="12" cy="12" rx="8.5" ry="6.5" />);
export const IcLine = S(<path d="M5 19L19 5" />);
export const IcArrow = S(
  <>
    <path d="M5 19L19 5" />
    <path d="M11 5h8v8" />
  </>,
);
export const IcSign = S(
  <>
    <path d="M3 18c3.5 0 4-13 7-13s1.6 10 4 10c1.6 0 2-2.5 3.5-2.5 1.2 0 1.7 1.4 3.5 1.4" />
    <path d="M3 21h18" />
  </>,
);
export const IcImage = S(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8.5" cy="10" r="1.6" />
    <path d="M4 17l5-5 4 4 3-2.5 4 3.5" />
  </>,
);
export const IcSearch = S(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </>,
);
export const IcThumbs = S(
  <>
    <rect x="3.5" y="4" width="7" height="7" rx="1" />
    <rect x="13.5" y="4" width="7" height="7" rx="1" />
    <rect x="3.5" y="13" width="7" height="7" rx="1" />
    <rect x="13.5" y="13" width="7" height="7" rx="1" />
  </>,
);
export const IcList = S(
  <>
    <path d="M4 6h16M4 12h16M4 18h10" />
  </>,
);
export const IcComment = S(
  <>
    <path d="M20 5H4v11h4v4l5-4h7z" />
  </>,
);
export const IcZoomIn = S(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M11 8.5v5M8.5 11h5M16 16l4.5 4.5" />
  </>,
);
export const IcZoomOut = S(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M8.5 11h5M16 16l4.5 4.5" />
  </>,
);
export const IcRotate = S(
  <>
    <path d="M20 11a8 8 0 10-2.3 5.7" />
    <path d="M20 5v6h-6" />
  </>,
);
export const IcRotateL = S(
  <>
    <path d="M4 11a8 8 0 112.3 5.7" />
    <path d="M4 5v6h6" />
  </>,
);
export const IcTrash = S(
  <>
    <path d="M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14" />
  </>,
);
export const IcUndo = S(
  <>
    <path d="M4 9h11a5 5 0 010 10h-6" />
    <path d="M8 5L4 9l4 4" />
  </>,
);
export const IcRedo = S(
  <>
    <path d="M20 9H9a5 5 0 000 10h6" />
    <path d="M16 5l4 4-4 4" />
  </>,
);
export const IcSave = S(
  <>
    <path d="M12 3v12" />
    <path d="M8 11l4 4 4-4" />
    <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
  </>,
);
export const IcSidebar = S(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9.5 4v16" />
  </>,
);
export const IcChevL = S(<path d="M14.5 5l-7 7 7 7" />);
export const IcChevR = S(<path d="M9.5 5l7 7-7 7" />);
export const IcChevD = S(<path d="M5 9.5l7 7 7-7" />);
export const IcX = S(<path d="M6 6l12 12M18 6L6 18" />);
export const IcPlus = S(<path d="M12 5v14M5 12h14" />);
export const IcCheck = S(<path d="M5 12.5l5 5L19 6.5" />);
export const IcFile = S(
  <>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
    <path d="M14 3v5h5" />
  </>,
);
export const IcMerge = S(
  <>
    <path d="M8 3v6a4 4 0 004 4h8" />
    <path d="M17 10l3 3-3 3" />
    <path d="M4 21v-6" />
  </>,
);
export const IcPrint = S(
  <>
    <path d="M7 9V3h10v6" />
    <rect x="4" y="9" width="16" height="7" rx="2" />
    <path d="M7 14h10v7H7z" />
  </>,
);
export const IcFit = S(
  <>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </>,
);
export const IcForm = S(
  <>
    <rect x="3" y="4" width="18" height="7" rx="1.5" />
    <rect x="3" y="14" width="11" height="6" rx="1.5" />
  </>,
);
export const IcEye = S(
  <>
    <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>,
);
