import React, { useState } from 'react';
import { MostroEventKind } from '../types/mostro';
import { SimplePool } from 'nostr-tools';
import { publishSignedEvent } from '../utils/nostr';
import { MostroOrder } from '../types/mostro';

const DisputeSystem: React.FC<{ order: MostroOrder }> = ({ order }) => {
  const [disputeReason, setDisputeReason] = useState('');
  const [evidence, setEvidence] = useState<File[]>([]);

  const openDispute = async () => {
    const disputeEvent = {
      kind: MostroEventKind.DISPUTE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', order.id],
        ['p', order.maker],
        ['p', order.taker!],
        ['status', 'disputed']
      ],
      content: JSON.stringify({
        reason: disputeReason,
        evidence: evidence.map(f => f.name), // Referencias a evidencia
        timestamp: Date.now()
      }),
      pubkey: publicKey
    };

    await publishSignedEvent(pool, disputeEvent, privateKey);
  };

  const submitEvidence = async (files: File[]) => {
    // Aquí iría la lógica para subir evidencia
    // Podría ser a IPFS o como archivos codificados en base64
    const evidenceEvent = {
      kind: MostroEventKind.DISPUTE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', order.id],
        ['type', 'evidence']
      ],
      content: JSON.stringify({
        files: files.map(f => ({
          name: f.name,
          data: 'base64_data_here'
        }))
      }),
      pubkey: publicKey
    };

    await publishSignedEvent(pool, evidenceEvent, privateKey);
  };

  // ... renderizado de la UI de disputas
}; 