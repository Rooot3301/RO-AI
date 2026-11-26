import type { ReactNode } from 'react';

const base = { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'square' as const, 'aria-hidden': true };
const I = (children: ReactNode) => function Icon() { return <svg {...base}>{children}</svg>; };

export const IconBridge = I(<><path d="M2 12.5V5l6-3 6 3v7.5" /><path d="M2 12.5h12M5.5 12.5V8.5h5v4" /></>);
export const IconAgents = I(<><rect x="2.5" y="2.5" width="4.5" height="4.5" /><rect x="9" y="2.5" width="4.5" height="4.5" /><rect x="2.5" y="9" width="4.5" height="4.5" /><path d="M9 11.25h4.5M11.25 9v4.5" /></>);
export const IconRuns = I(<><path d="M2.5 3v10M5.5 3.5l8 4.5-8 4.5z" /></>);
export const IconSchedule = I(<><circle cx="8" cy="8" r="5.5" /><path d="M8 4.5V8l2.5 1.5" /></>);
export const IconLog = I(<><path d="M2.5 3.5h11M2.5 6.5h8M2.5 9.5h11M2.5 12.5h6" /></>);
export const IconOffice = I(<><path d="M2.5 2.5h11v11h-11zM2.5 8h11M8 2.5V8" /></>);
export const IconProviders = I(<><path d="M8 2.5v4M5.5 2.5v4M10.5 2.5v4" /><path d="M4 6.5h8v2.5a4 4 0 0 1-8 0z" /><path d="M8 13v1.5" /></>);
export const IconLogout = I(<><path d="M6.5 2.5h-4v11h4M6.5 8h7M11 5.5 13.5 8 11 10.5" /></>);
export const IconInbox = I(<><path d="M2.5 9.5 4 3.5h8l1.5 6v4h-11z" /><path d="M2.5 9.5h3.2l.8 1.5h3l.8-1.5h3.2" /></>);
export const IconPlus = I(<path d="M8 3v10M3 8h10" />);
export const IconPlay = I(<path d="M4.5 3l8 5-8 5z" />);
export const IconRefresh = I(<><path d="M13 8a5 5 0 1 1-1.6-3.7" /><path d="M13 2.5v3h-3" /></>);
export const IconCopy = I(<><rect x="5.5" y="5.5" width="8" height="8" /><path d="M10.5 5.5v-3h-8v8h3" /></>);
export const IconCheck = I(<path d="M3 8.5l3.5 3.5L13 4.5" />);
export const IconPause = I(<path d="M5 3v10M11 3v10" />);
export const IconDownload = I(<><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M2.5 13.5h11" /></>);
export const IconX = I(<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />);
export const IconTrash = I(<><path d="M2.5 4.5h11M6 4.5v-2h4v2M4 4.5l.7 9h6.6l.7-9" /></>);
export const IconEdit = I(<><path d="M2.5 13.5l.7-3L10.5 3.2l2.3 2.3L5.5 12.8z" /></>);

export const IconStop = I(<><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" /></>);
export const IconStats = I(<><path d="M2.5 13.5h11M4.5 13.5V8M8 13.5V3.5M11.5 13.5V6" /></>);

export const IconSettings = I(<><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" /></>);

export function EmptyGlyph({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 34 34" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" className="empty__glyph">
      <circle cx="17" cy="17" r="9" /><circle cx="17" cy="17" r="2" fill="currentColor" stroke="none" />
      <path d="M17 2v7M17 25v7M2 17h7M25 17h7" />
    </svg>
  );
}
