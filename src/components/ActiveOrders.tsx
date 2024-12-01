import React, { useEffect, useState } from 'react';
import { MostroOrder, MostroEventKind } from '../types/mostro';

const ActiveOrders: React.FC = () => {
  const [orders, setOrders] = useState<MostroOrder[]>([]);
  const [filter, setFilter] = useState<'BUY' | 'SELL' | 'ALL'>('ALL');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('ALL');

  useEffect(() => {
    const sub = pool.sub(relayUrls, [{
      kinds: [MostroEventKind.ORDER],
      since: Math.floor(Date.now()/1000) - 3600 // Última hora
    }]);

    sub.on('event', (event) => {
      const order = JSON.parse(event.content);
      if (order.status === 'PENDING') {
        setOrders(prev => [...prev, order]);
      }
    });

    return () => { sub.unsub(); };
  }, []);

  const filteredOrders = orders.filter(order => {
    if (filter !== 'ALL' && order.type !== filter) return false;
    if (selectedPaymentMethod !== 'ALL' && 
        order.payment_method !== selectedPaymentMethod) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <select onChange={e => setFilter(e.target.value as any)}>
          <option value="ALL">All Orders</option>
          <option value="BUY">Buy Orders</option>
          <option value="SELL">Sell Orders</option>
        </select>
        {/* Más filtros */}
      </div>

      <div className="grid gap-4">
        {filteredOrders.map(order => (
          <OrderCard 
            key={order.id} 
            order={order}
            onTake={() => handleTakeOrder(order)}
          />
        ))}
      </div>
    </div>
  );
}; 