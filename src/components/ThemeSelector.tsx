import React from 'react';

type Theme = 'matrix' | 'cyberpunk' | 'midnight' | 'light';

interface ThemeSelectorProps {
  currentTheme: Theme;
  onThemeChange: (theme: Theme) => void;
}

const ThemeSelector: React.FC<ThemeSelectorProps> = ({ currentTheme, onThemeChange }) => {
  const themes: Theme[] = ['matrix', 'cyberpunk', 'midnight', 'light'];

  return (
    <div className="flex gap-2 p-2">
      {themes.map((theme) => (
        <button
          key={theme}
          onClick={() => onThemeChange(theme)}
          className={`px-3 py-1 rounded capitalize text-sm border border-current ${
            currentTheme === theme
              ? 'text-white'
              : 'opacity-70 hover:opacity-100'
          }`}
          style={currentTheme === theme ? { backgroundColor: 'var(--primary-color)', borderColor: 'var(--primary-color)' } : { backgroundColor: 'transparent' }}
        >
          {theme}
        </button>
      ))}
    </div>
  );
};

export default ThemeSelector; 