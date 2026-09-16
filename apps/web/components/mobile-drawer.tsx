'use client';
import { useId, useRef, type ReactNode } from 'react';
import { Button } from './ui';
export function MobileDrawer({
  title,
  trigger,
  children,
  className = '',
}: {
  title: string;
  trigger: string;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  return (
    <div className={className}>
      <button
        ref={opener}
        className="button button-secondary"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        className="mobile-drawer"
        aria-labelledby={titleId}
        onClose={() => opener.current?.focus()}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a'))
            dialog.current?.close();
        }}
      >
        <div className="drawer-heading">
          <h2 id={titleId}>{title}</h2>
          <Button
            variant="quiet"
            aria-label={'Закрыть: ' + title}
            onClick={() => dialog.current?.close()}
          >
            ✕
          </Button>
        </div>
        {children}
      </dialog>
    </div>
  );
}
