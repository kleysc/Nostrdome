import React from 'react';
import { MostroOrder } from '../types/mostro';

interface OrderCardProps {
  order: MostroOrder;
  onTake: () => void;
}

export const OrderCard: React.FC<OrderCardProps> = ({ order, onTake }) => {
  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="flex justify-between mb-2">
        <span className="font-bold">{order.type}</span>
        <span className={order.type === 'BUY' ? 'text-green-500' : 'text-red-500'}>
          {order.amount} sats
        </span>
      </div>
      <div className="text-sm">
        <p>Price: {order.fiat_amount} {order.fiat_code}</p>
        <p>Payment: {order.payment_method}</p>
      </div>
      <button
        onClick={onTake}
        className="mt-2 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
      >
        Take Order
      </button>
    </div>
  );
}; 