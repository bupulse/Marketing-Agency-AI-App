// The chat's small inline icons (24 x 24, currentColor), as drawn in the approved designs.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, rest: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  ...rest,
});

export const PulseIcon = ({ size = 20, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2.4, ...r })}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
  </svg>
);

export const ChatIcon = ({ size = 26, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </svg>
);

export const CloseIcon = ({ size = 16, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2.2, ...r })}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const ChevronDownIcon = ({ size = 26, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2.2, ...r })}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const WhatsAppIcon = ({ size = 18, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z" />
    <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .8a4 4 0 0 1-2.1-2.1l.8-1-1-2z" />
  </svg>
);

export const AttachIcon = ({ size = 20, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7L10.2 17.7a1.7 1.7 0 0 1-2.4-2.4L15.5 7.6" />
  </svg>
);

export const MicIcon = ({ size = 20, ...r }: P) => (
  <svg {...base(size, r)}>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

export const SendIcon = ({ size = 18, ...r }: P) => (
  <svg {...base(size, { strokeWidth: 2.2, ...r })}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const BookIcon = ({ size = 12, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" />
    <path d="M4 19V5" />
  </svg>
);

export const ThumbUpIcon = ({ size = 30, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M7 10v11H4V10zM7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H7" />
  </svg>
);

export const ThumbDownIcon = ({ size = 30, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M17 14V3h3v11zM17 14l-4 7a2 2 0 0 1-3-2l1-5H5a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 6.4 3H17" />
  </svg>
);

export const PlayIcon = ({ size = 12, ...r }: P) => (
  <svg {...base(size, { fill: "currentColor", stroke: "none", ...r })}>
    <path d="M7 4l13 8-13 8z" />
  </svg>
);

export const PauseIcon = ({ size = 12, ...r }: P) => (
  <svg {...base(size, { fill: "currentColor", stroke: "none", ...r })}>
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
);

export const FileIcon = ({ size = 22, ...r }: P) => (
  <svg {...base(size, r)}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </svg>
);

export const StopIcon = ({ size = 16, ...r }: P) => (
  <svg {...base(size, { fill: "currentColor", stroke: "none", ...r })}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
