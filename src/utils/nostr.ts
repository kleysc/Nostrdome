import { Event, SimplePool, getEventHash, getSignature } from 'nostr-tools';
import { relayUrls } from '../config';

export const publishSignedEvent = async (
  pool: SimplePool, 
  event: Partial<Event>, 
  privateKey: string
) => {
  const finalEvent = {
    ...event,
    created_at: Math.floor(Date.now() / 1000),
    tags: event.tags || [],
  } as Event;

  finalEvent.id = getEventHash(finalEvent);
  finalEvent.sig = getSignature(finalEvent, privateKey);

  return await pool.publish(relayUrls, finalEvent);
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
}; 