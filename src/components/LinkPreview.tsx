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
      <div className="animate-pulse bg-gray-700 rounded-lg p-2 mt-2 max-w-sm">
        <div className="h-32 bg-gray-600 rounded mb-2"></div>
        <div className="h-4 bg-gray-600 rounded w-3/4 mb-2"></div>
        <div className="h-3 bg-gray-600 rounded w-1/2"></div>
      </div>
    );
  }

  if (error || !preview) {
    return (
      <a 
        href={url} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="text-blue-400 hover:underline break-all"
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
      className="block mt-2 max-w-sm bg-gray-700 rounded-lg p-3 hover:bg-gray-600 transition-colors"
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
        <p className="text-sm text-gray-300 line-clamp-2">{preview.description}</p>
      )}
      <span className="text-xs text-gray-400 block mt-1 truncate">{url}</span>
    </a>
  );
};

export default LinkPreview; 