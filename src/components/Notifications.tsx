import React, { useState, useEffect, useRef } from 'react';
import { Bell, BellOff } from 'lucide-react';

export type ShowNotificationFn = (title: string, body: string, data?: { messageId?: string; type?: string }) => void;

interface NotificationProps {
  onNotificationChange: (enabled: boolean) => void;
  /** Se llama cuando hay permiso y la app puede usar notificaciones (p. ej. al recibir mensajes). */
  onRegisterShow?: (show: ShowNotificationFn) => void;
  publicKey: string;
}

const Notifications: React.FC<NotificationProps> = ({ onNotificationChange, onRegisterShow, publicKey: _publicKey }) => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showNotification: ShowNotificationFn = (title, body, data) => {
    if (permission === 'granted' && document.hidden) {
      const notification = new Notification(title, {
        body,
        icon: '/logo.png',
        tag: data?.type || 'default',
        data
      });

      notification.onclick = () => {
        window.focus();
        if (data?.messageId) {
          const messageElement = document.getElementById(data.messageId);
          messageElement?.scrollIntoView({ behavior: 'smooth' });
        }
      };
    }
  };

  useEffect(() => {
    setPermission(Notification.permission);
    onNotificationChange(Notification.permission === 'granted');
  }, [onNotificationChange]);

  useEffect(() => {
    if (permission === 'granted' && onRegisterShow) onRegisterShow(showNotification);
  }, [permission, onRegisterShow]);

  const requestNotificationPermission = async () => {
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      onNotificationChange(result === 'granted');
      if (result === 'granted') {
        showNotification(
          'Notificaciones activadas',
          'Recibirás notificaciones de mensajes privados.'
        );
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
    }
  };

  const handleBellClick = () => {
    setOpen((v) => !v);
  };

  if (permission === 'denied') {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="p-2 rounded-md opacity-80 bg-[var(--sidebar-active)] text-[var(--text-muted)] hover:bg-[var(--sidebar-hover)]"
          title="Notificaciones bloqueadas"
        >
          <BellOff size={18} />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-30 w-64 p-3 rounded-lg shadow-lg bg-[var(--sidebar-bg)] border border-[var(--border-subtle)]">
            <p className="text-sm font-medium text-[var(--text-color)]">Notificaciones bloqueadas</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Habilítalas en la configuración del navegador para este sitio (candado o icono de sitio en la barra de direcciones).
            </p>
            <button type="button" onClick={() => setOpen(false)} className="mt-2 text-xs text-[var(--primary-color)] hover:underline">Cerrar</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={handleBellClick}
        className={`p-2 rounded-md transition-colors ${
          permission === 'granted'
            ? 'bg-[var(--primary-color)] text-white'
            : 'bg-[var(--sidebar-hover)] text-[var(--text-color)] hover:bg-[var(--sidebar-active)]'
        }`}
        title={permission === 'granted' ? 'Notificaciones activadas' : 'Activar notificaciones'}
      >
        <Bell size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-64 p-3 rounded-lg shadow-lg bg-[var(--sidebar-bg)] border border-[var(--border-subtle)]">
          <p className="text-sm font-medium text-[var(--text-color)]">
            {permission === 'granted' ? 'Notificaciones activadas' : 'Notificaciones'}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            {permission === 'granted'
              ? 'Recibirás notificaciones del sistema cuando lleguen mensajes privados y la pestaña esté en segundo plano.'
              : 'Al hacer clic se pedirá permiso al navegador para mostrarte notificaciones de mensajes privados.'}
          </p>
          {permission === 'default' && (
            <button
              type="button"
              onClick={() => requestNotificationPermission()}
              className="mt-2 px-3 py-1.5 rounded text-xs font-medium bg-[var(--primary-color)] text-white hover:opacity-90"
            >
              Activar notificaciones
            </button>
          )}
          {permission === 'granted' && (
            <button type="button" onClick={() => setOpen(false)} className="mt-2 text-xs text-[var(--primary-color)] hover:underline">Cerrar</button>
          )}
        </div>
      )}
    </div>
  );
};

export default Notifications; 