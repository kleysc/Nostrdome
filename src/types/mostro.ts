export enum OrderType {
  BUY = 'BUY',
  SELL = 'SELL'
}

export enum PriceType {
  FIXED = 'FIXED',
  MARKET = 'MARKET'
}

export enum OrderStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  DISPUTED = 'DISPUTED'
}

export interface Order {
  id: string;
  type: OrderType;
  amount: number;
  fiat_code: string;
  fiat_amount: number;
  payment_method: string;
  status: OrderStatus;
  maker: string;
  taker?: string;
  created_at: number;
  expires_at: number;
} 