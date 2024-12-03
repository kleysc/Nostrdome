import React, { useState, useEffect } from 'react';

interface NotificationProps {
  onNotificationChange: (enabled: boolean) => void;
  publicKey: string;
}

const Notifications: React.FC<NotificationProps> = ({ onNotificationChange, publicKey }) => {
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    setPermission(Notification.permission);
    onNotificationChange(Notification.permission === 'granted');
  }, [onNotificationChange]);

  const showNotification = (title: string, body: string, data?: any) => {
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

  const requestNotificationPermission = async () => {
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      onNotificationChange(result === 'granted');
      
      if (result === 'granted') {
        showNotification(
          'Notificaciones activadas',
          'Recibirás notificaciones de mensajes privados, menciones y cambios en los relays.'
        );
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error);
    }
  };

  if (permission === 'denied') {
    return (
      <button
        className="bg-red-600 text-white px-4 py-2 rounded opacity-50 cursor-not-allowed"
        title="Las notificaciones están bloqueadas. Habilítalas en la configuración del navegador."
      >
        🔔 Bloqueadas
      </button>
    );
  }

  return (
    <button
      onClick={requestNotificationPermission}
      className={`px-4 py-2 rounded flex items-center gap-2 ${
        permission === 'granted'
          ? 'bg-green-500 hover:bg-green-600'
          : 'bg-blue-500 hover:bg-blue-600'
      } text-white`}
    >
      🔔 {permission === 'granted' ? 'Activadas' : 'Activar Notificaciones'}
    </button>
  );
};

export default Notifications; 