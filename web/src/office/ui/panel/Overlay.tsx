// Rend un dialogue hors du panneau (le bureau peut être en plein écran : on cible alors l'élément plein écran).
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Overlay({ children }: { children: ReactNode }) {
  const target = (document.fullscreenElement as HTMLElement | null) ?? document.body;
  return createPortal(children, target);
}
