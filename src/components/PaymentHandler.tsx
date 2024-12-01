import React, { useState } from 'react';
import { Order } from '../types/mostro';
import { publishSignedEvent, fileToBase64 } from '../utils/nostr';
import { MostroEventKind } from '../types/mostro';

const PaymentHandler: React.FC<{ order: Order; publicKey: string; pool: any; privateKey: string }> = ({ order, publicKey, pool, privateKey }) => {
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'sent' | 'confirmed'>('pending');

  const handlePaymentSent = async () => {
    const paymentEvent = {
      kind: MostroEventKind.ORDER_STATUS,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', order.id],
        ['p', order.type === 'BUY' ? order.maker : order.taker!],
        ['status', 'payment_sent']
      ],
      content: JSON.stringify({
        payment_proof: paymentProof ? await fileToBase64(paymentProof) : null,
        timestamp: Date.now(),
        payment_method: order.payment_method
      }),
      pubkey: publicKey
    };

    await publishSignedEvent(pool, paymentEvent, privateKey);
    setPaymentStatus('sent');
  };

  const handlePaymentConfirmed = async () => {
    const confirmationEvent = {
      kind: MostroEventKind.ORDER_STATUS,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', order.id],
        ['p', order.type === 'BUY' ? order.taker! : order.maker],
        ['status', 'payment_confirmed']
      ],
      content: JSON.stringify({
        confirmation_timestamp: Date.now()
      }),
      pubkey: publicKey
    };

    await publishSignedEvent(pool, confirmationEvent, privateKey);
    setPaymentStatus('confirmed');
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setPaymentProof(file);
  };

  return (
    <input type="file" onChange={handleFileChange} />
  );
}; 