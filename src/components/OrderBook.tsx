import React from 'react';
import { useOrdersStore } from '../store/orders';
import { OrderType, OrderStatus } from '../types/mostro';

const OrderBook: React.FC = () => {
  const orders = useOrdersStore(state => state.orders);
  
  const activeOrders = orders.filter(
    order => order.status === OrderStatus.PENDING
  );

  return (
    <div className="bg-gray-900 p-4 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Order Book</h2>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="text-green-500 mb-2">Buy Orders</h3>
          {activeOrders
            .filter(order => order.type === OrderType.BUY)
            .map(order => (
              <div key={order.id} className="bg-gray-800 p-2 rounded mb-2">
                <div>Amount: {order.amount} sats</div>
                <div>Price: {order.price || 'Market'}</div>
                <div>Payment: {order.paymentMethod}</div>
              </div>
            ))}
        </div>
        
        <div>
          <h3 className="text-red-500 mb-2">Sell Orders</h3>
          {activeOrders
            .filter(order => order.type === OrderType.SELL)
            .map(order => (
              <div key={order.id} className="bg-gray-800 p-2 rounded mb-2">
                <div>Amount: {order.amount} sats</div>
                <div>Price: {order.price || 'Market'}</div>
                <div>Payment: {order.paymentMethod}</div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default OrderBook; 