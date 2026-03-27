export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: any;
}

export type OperationType = 'buy' | 'sell' | 'add' | 'reduce' | 'switch' | 'observe';

export interface Operation {
  id?: string;
  userId: string;
  date: any;
  fundName: string;
  fundCode?: string;
  type: OperationType;
  amount?: number;
  shares?: number;
  returnRate?: number;
  sector?: string;
  reason?: string;
  screenshotUrl?: string;
  createdAt: any;
}

export type RecapType = 'intraday' | 'end-of-day' | 'long-form' | 'social-post';

export interface Recap {
  id?: string;
  userId: string;
  date: any;
  type: RecapType;
  title?: string;
  content: string;
  relatedOperations: string[];
  marketContext?: string;
  createdAt: any;
}

export interface Holding {
  id?: string;
  userId: string;
  fundName: string;
  fundCode?: string;
  amount?: number;
  shares?: number;
  costBasis?: number;
  returnRate?: number;
  sector?: string;
  updatedAt: any;
  lastUpdated?: any;
}
