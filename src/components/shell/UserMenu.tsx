import { useState, useRef, useEffect } from 'react';
import { nip19 } from 'nostr-tools';
import { useAppStore, type Theme } from '../../stores/store';
import ThemeSelector from '../ThemeSelector';

interface UserMenuProps {
  publicKey: string | null;
  onOpenProfile: () => void;
  onLogout: () => void;
}

// Sits at the bottom of the ServerBar. Mirrors Discord's bottom-left
// account widget: avatar/initial + popover with theme + profile + logout.
export default function UserMenu({ publicKey, onOpenProfile, onLogout }: UserMenuProps) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const initial = publicKey ? nip19.npubEncode(publicKey).slice(5, 6).toUpperCase() : '?';

  return (
    <div ref={ref} className="relative mt-auto">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-10 h-10 rounded-full bg-[var(--header-bg)] border border-[var(--border-subtle)] hover:border-[var(--primary-color)] flex items-center justify-center text-sm font-semibold text-[var(--text-color)]"
        title="Cuenta"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-12 left-0 w-56 rounded-lg shadow-lg border border-[var(--border-subtle)] p-2 z-30"
          style={{ backgroundColor: 'var(--header-bg)' }}
        >
          <div className="px-2 py-1.5 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Tema
          </div>
          <div className="px-1">
            <ThemeSelector currentTheme={theme} onThemeChange={(t: Theme) => setTheme(t)} />
          </div>
          <hr className="my-2 border-[var(--border-subtle)]" />
          <button
            type="button"
            onClick={() => { setOpen(false); onOpenProfile(); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[var(--sidebar-hover)] text-[var(--text-color)]"
            role="menuitem"
          >
            Editar perfil
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); onLogout(); }}
            className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[var(--sidebar-hover)] text-[var(--text-color)]"
            role="menuitem"
          >
            Salir
          </button>
        </div>
      )}
    </div>
  );
}
