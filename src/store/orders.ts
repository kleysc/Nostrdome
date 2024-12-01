import { create } from 'zustand';
import { Order, OrderStatus } from '.././types/mostro';

interface OrdersState {
  orders: Order[];
  addOrder: (order: Order) => void;
  updateOrderStatus: (orderId: string, status: OrderStatus) => void;
  getOrderById: (orderId: string) => Order | undefined;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  orders: [],
  
  addOrder: (order) => 
    set((state) => ({
      orders: [...state.orders, order]
    })),
    
  updateOrderStatus: (orderId, status) =>
    set((state) => ({
      orders: state.orders.map(order => 
        order.id === orderId ? { ...order, status } : order
      )
    })),
    
  getOrderById: (orderId) => 
    get().orders.find(order => order.id === orderId)
})); 