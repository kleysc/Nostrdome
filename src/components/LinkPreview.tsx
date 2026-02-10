import React, { useState, useEffect } from 'react';

interface LinkPreviewProps {
  url: string;
}

interface PreviewData {
  title?: string;
  description?: string;
  image?: string;
  type: 'image' | 'link' | 'unknown';
}

const LinkPreview: React.FC<LinkPreviewProps> = ({ url }) => {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const detectLinkType = (url: string) => {
      const imageExtensions = /\.(jpg|jpeg|png|gif|webp)$/i;
      if (imageExtensions.test(url)) {
        return 'image';
      }
      return 'link';
    };

    const fetchPreview = async () => {
      try {
        setLoading(true);
        setError(false);
        
        const type = detectLinkType(url);
        
        if (type === 'image') {
          setPreview({
            type: 'image',
            image: url
          });
        } else {
          // Para enlaces normales, intentar obtener metadatos
          // Aquí deberías implementar tu propia API proxy para evitar problemas CORS
          const response = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
          const data = await response.json();
          
          setPreview({
            type: 'link',
            title: data.title,
            description: data.description,
            image: data.image
          });
        }
      } catch (error) {
        console.error('Error fetching preview:', error);
        setError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchPreview();
  }, [url]);

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg p-2 mt-2 max-w-sm bg-[var(--sidebar-hover)] border border-[var(--border-subtle)]">
        <div className="h-32 rounded mb-2 bg-[var(--sidebar-active)]"></div>
        <div className="h-4 rounded w-3/4 mb-2 bg-[var(--sidebar-active)]"></div>
        <div className="h-3 rounded w-1/2 bg-[var(--sidebar-active)]"></div>
      </div>
    );
  }

  if (error || !preview) {
    return (
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="break-all text-[var(--primary-color)] hover:underline"
      >
        {url}
      </a>
    );
  }

  if (preview.type === 'image') {
    return (
      <div className="mt-2 max-w-sm">
        <img
          src={preview.image}
          alt="Linked content"
          className="rounded-lg max-h-64 object-cover"
          onClick={() => window.open(url, '_blank')}
          style={{ cursor: 'pointer' }}
        />
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-2 max-w-sm rounded-lg p-3 transition-colors bg-[var(--sidebar-hover)] border border-[var(--border-subtle)] hover:bg-[var(--sidebar-active)]"
    >
      {preview.image && (
        <img
          src={preview.image}
          alt={preview.title || 'Link preview'}
          className="w-full h-32 object-cover rounded-lg mb-2"
        />
      )}
      {preview.title && (
        <h3 className="font-bold text-sm mb-1 line-clamp-2">{preview.title}</h3>
      )}
      {preview.description && (
        <p className="text-sm text-[var(--text-muted)] line-clamp-2">{preview.description}</p>
      )}
      <span className="text-xs text-[var(--text-muted)] block mt-1 truncate">{url}</span>
    </a>
  );
};

export default LinkPreview; 
