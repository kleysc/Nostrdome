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
          className={`px-3 py-1 rounded capitalize ${
            currentTheme === theme
              ? 'bg-green-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600'
          }`}
        >
          {theme}
        </button>
      ))}
    </div>
  );
};

export default ThemeSelector; 