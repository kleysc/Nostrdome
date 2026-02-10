import React, { useState, useRef, useEffect } from 'react';

type Theme = 'matrix' | 'cyberpunk' | 'midnight' | 'light';

interface ThemeSelectorProps {
  currentTheme: Theme;
  onThemeChange: (theme: Theme) => void;
}

const themeLabels: Record<Theme, string> = {
  matrix: 'Matrix',
  cyberpunk: 'Cyberpunk',
  midnight: 'Midnight',
  light: 'Claro',
};

const ThemeSelector: React.FC<ThemeSelectorProps> = ({ currentTheme, onThemeChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const themes: Theme[] = ['matrix', 'cyberpunk', 'midnight', 'light'];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-[var(--text-color)] bg-[var(--sidebar-hover)] hover:bg-[var(--sidebar-active)] border border-[var(--border-subtle)] transition-colors"
        title="Cambiar tema"
      >
        <span className="opacity-70">Tema</span>
        <span style={{ color: 'var(--primary-color)' }}>{themeLabels[currentTheme]}</span>
        <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 py-1 rounded-md bg-[var(--sidebar-bg)] border border-[var(--border-subtle)] shadow-lg z-20 min-w-[120px]">
          {themes.map((theme) => (
            <button
              key={theme}
              type="button"
              onClick={() => { onThemeChange(theme); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-xs font-medium capitalize transition-colors ${
                currentTheme === theme
                  ? 'text-white'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-color)] hover:bg-[var(--sidebar-hover)]'
              }`}
              style={currentTheme === theme ? { backgroundColor: 'var(--primary-color)' } : {}}
            >
              {themeLabels[theme]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThemeSelector; 