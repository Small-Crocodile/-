/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  Timestamp,
  getDoc,
  doc,
  setDoc,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Operation, Recap, RecapType, OperationType, Holding } from './types';
import { 
  analyzeOperationScreenshot, 
  generateRecap, 
  summarizeHistory as summarizeHistoryService, 
  analyzeHoldingsScreenshot, 
  fetchFundCode, 
  fetchFundNAV,
  fetchFundSector,
  generateDailyNews
} from './services/geminiService';
import { 
  Plus, 
  Upload, 
  TrendingUp, 
  TrendingDown, 
  History, 
  FileText, 
  LogOut, 
  User as UserIcon,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Loader2,
  Trash2,
  Share2,
  MessageSquare,
  BarChart3,
  AlertCircle,
  BrainCircuit,
  Wallet,
  Settings,
  Edit2,
  Save,
  X,
  Search,
  Calculator,
  ArrowRight,
  ArrowRightLeft,
  GripVertical,
  Newspaper,
  LayoutGrid,
  List
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';

// --- Error Handling ---

enum FSOperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: FSOperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: FSOperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className, 
  disabled, 
  loading,
  type = 'button'
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'; 
  className?: string; 
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}) => {
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
    secondary: 'bg-slate-800 text-white hover:bg-slate-900 shadow-sm',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100'
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
    >
      {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </button>
  );
};

const Card = ({ children, className, title, subtitle, icon: Icon }: { 
  children: React.ReactNode; 
  className?: string; 
  title?: string; 
  subtitle?: string;
  icon?: any;
}) => (
  <div className={cn('bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden', className)}>
    {(title || subtitle) && (
      <div className="px-6 py-4 border-bottom border-slate-50 flex items-center justify-between">
        <div>
          {title && <h3 className="text-lg font-semibold text-slate-900">{title}</h3>}
          {subtitle && <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-bold mt-1">{subtitle}</p>}
        </div>
        {Icon && <Icon className="w-5 h-5 text-slate-400" />}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [fundSuggestions, setFundSuggestions] = useState<Holding[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [columnWidths, setColumnWidths] = useState({
    date: 120,
    name: 300,
    type: 80,
    amount: 140,
    reason: 200,
    actions: 80
  });

  const resizingCol = useRef<string | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = (e: React.MouseEvent, col: string) => {
    resizingCol.current = col;
    startX.current = e.pageX;
    startWidth.current = (columnWidths as any)[col];
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = (e: MouseEvent) => {
    if (resizingCol.current) {
      const diff = e.pageX - startX.current;
      const newWidth = Math.max(startWidth.current + diff, 60);
      setColumnWidths(prev => ({ ...prev, [resizingCol.current!]: newWidth }));
    }
  };

  const onMouseUp = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  const [recaps, setRecaps] = useState<Recap[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [marketContext, setMarketContext] = useState('');
  const [selectedOperations, setSelectedOperations] = useState<string[]>([]);
  const [selectedRecaps, setSelectedRecaps] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [activeRecap, setActiveRecap] = useState<Recap | null>(null);
  const [historySummary, setHistorySummary] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [dailyNews, setDailyNews] = useState<string>('');
  const [isGeneratingDailyNews, setIsGeneratingDailyNews] = useState(false);
  const [activeTab, setActiveTab] = useState<'news' | 'recap' | 'holdings' | 'records'>('news');
  const [holdingsViewMode, setHoldingsViewMode] = useState<'card' | 'list'>('card');
  const [autoUpdateInterval, setAutoUpdateInterval] = useState<number | null>(null);
  const [sortOption, setSortOption] = useState<'fundName' | 'amount' | 'returnRate'>('fundName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedHoldings = useMemo(() => {
    return [...holdings].sort((a, b) => {
      let comparison = 0;
      if (sortOption === 'fundName') {
        comparison = (a.fundName || '').localeCompare(b.fundName || '');
      } else if (sortOption === 'amount') {
        comparison = (a.amount || 0) - (b.amount || 0);
      } else if (sortOption === 'returnRate') {
        comparison = (a.returnRate || 0) - (b.returnRate || 0);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [holdings, sortOption, sortDirection]);

  // Auto-update effect
  useEffect(() => {
    if (!autoUpdateInterval) return;

    const interval = setInterval(async () => {
      for (const holding of holdings) {
        if (holding.fundCode && holding.shares) {
          try {
            const nav = await fetchFundNAV(holding.fundCode);
            if (nav && nav > 0) {
              const amount = Number((holding.shares * nav).toFixed(2));
              await setDoc(doc(db, 'holdings', holding.id!), { 
                amount,
                lastUpdated: serverTimestamp()
              }, { merge: true });
            }
          } catch (error) {
            console.error("Auto update failed for", holding.fundName, error);
          }
        }
      }
    }, autoUpdateInterval);

    return () => clearInterval(interval);
  }, [autoUpdateInterval, holdings]);

  // Edit states
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [editingOperation, setEditingOperation] = useState<Operation | null>(null);
  const [isAddingHolding, setIsAddingHolding] = useState(false);
  const [isAddingOperation, setIsAddingOperation] = useState(false);
  const [fetchingCodeId, setFetchingCodeId] = useState<string | null>(null);
  const [calculatingSharesId, setCalculatingSharesId] = useState<string | null>(null);
  const [verifyingSectorId, setVerifyingSectorId] = useState<string | null>(null);

  const [holdingForm, setHoldingForm] = useState({
    fundName: '',
    fundCode: '',
    sector: '',
    amount: '',
    shares: '',
    costBasis: '',
    returnRate: '',
  });

  const [operationForm, setOperationForm] = useState({
    fundName: '',
    fundCode: '',
    type: 'buy' as OperationType,
    amount: '',
    shares: '',
    returnRate: '',
    sector: '',
    reason: ''
  });

  useEffect(() => {
    if (editingOperation) {
      setOperationForm({
        fundName: editingOperation.fundName || '',
        fundCode: editingOperation.fundCode || '',
        type: editingOperation.type || 'buy',
        amount: editingOperation.amount?.toString() || '',
        shares: editingOperation.shares?.toString() || '',
        returnRate: editingOperation.returnRate?.toString() || '',
        sector: editingOperation.sector || '',
        reason: editingOperation.reason || '',
      });
    } else if (isAddingOperation) {
      setOperationForm({
        fundName: '',
        fundCode: '',
        type: 'buy',
        amount: '',
        shares: '',
        returnRate: '',
        sector: '',
        reason: '',
      });
    }
  }, [editingOperation, isAddingOperation]);

  const handleOperationFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setOperationForm(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'fundName' || name === 'fundCode') {
        const matches = holdings.filter(h => 
          (h.fundName && h.fundName.includes(value)) || 
          (h.fundCode && h.fundCode.includes(value))
        );
        if (matches.length === 1) {
          const match = matches[0];
          if (!next.sector && match.sector) next.sector = match.sector;
          if (name === 'fundName' && !next.fundCode && match.fundCode) next.fundCode = match.fundCode;
          if (name === 'fundCode' && !next.fundName && match.fundName) next.fundName = match.fundName;
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (editingHolding) {
      setHoldingForm({
        fundName: editingHolding.fundName || '',
        fundCode: editingHolding.fundCode || '',
        sector: editingHolding.sector || '',
        amount: editingHolding.amount?.toString() || '',
        shares: editingHolding.shares?.toString() || '',
        costBasis: editingHolding.costBasis?.toString() || '',
        returnRate: editingHolding.returnRate?.toString() || '',
      });
    } else if (isAddingHolding) {
      setHoldingForm({
        fundName: '',
        fundCode: '',
        sector: '',
        amount: '',
        shares: '',
        costBasis: '',
        returnRate: '',
      });
    }
  }, [editingHolding, isAddingHolding]);

  const handleHoldingFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setHoldingForm(prev => {
      const next = { ...prev, [name]: value };
      
      // Recalculate return rate if amount or costBasis changes
      if (name === 'amount' || name === 'costBasis') {
        const amount = parseFloat(next.amount);
        const costBasis = parseFloat(next.costBasis);
        if (!isNaN(amount) && !isNaN(costBasis) && costBasis > 0) {
          next.returnRate = ((amount - costBasis) / costBasis * 100).toFixed(2);
        }
      }
      
      return next;
    });
  };

  useEffect(() => {
    const fetchAndCalculate = async () => {
      if (holdingForm.fundCode.length === 6 && holdingForm.amount) {
        setCalculatingSharesId('form-holding-auto');
        try {
          const nav = await fetchFundNAV(holdingForm.fundCode);
          if (nav && nav > 0) {
            const amount = parseFloat(holdingForm.amount);
            const shares = (amount / nav).toFixed(2);
            
            setHoldingForm(prev => {
              const newState = { ...prev, shares };
              
              // Also calculate return rate if costBasis exists
              if (prev.costBasis) {
                const costBasis = parseFloat(prev.costBasis);
                if (costBasis > 0) {
                  const returnRate = ((amount - costBasis) / costBasis * 100).toFixed(2);
                  newState.returnRate = returnRate;
                }
              }
              
              return newState;
            });
          }
        } catch (e) {
          console.error("Auto NAV fetch failed", e);
        } finally {
          setCalculatingSharesId(null);
        }
      }
    };

    if (holdingForm.fundCode.length === 6 && holdingForm.amount && (isAddingHolding || editingHolding)) {
      fetchAndCalculate();
    }
  }, [holdingForm.fundCode, holdingForm.amount]);

  useEffect(() => {
    const fetchAndCalculate = async () => {
      if (operationForm.fundCode.length === 6) {
        const hasAmount = !!operationForm.amount && !isNaN(parseFloat(operationForm.amount));
        const hasShares = !!operationForm.shares && !isNaN(parseFloat(operationForm.shares));

        if (hasAmount && !hasShares) {
          setCalculatingSharesId('form-op-auto');
          try {
            const nav = await fetchFundNAV(operationForm.fundCode);
            if (nav && nav > 0) {
              const amount = parseFloat(operationForm.amount);
              const shares = (amount / nav).toFixed(2);
              setOperationForm(prev => ({ ...prev, shares }));
            }
          } catch (e) {
            console.error("Auto NAV fetch for operation failed", e);
          } finally {
            setCalculatingSharesId(null);
          }
        } else if (!hasAmount && hasShares) {
          setCalculatingSharesId('form-op-auto');
          try {
            const nav = await fetchFundNAV(operationForm.fundCode);
            if (nav && nav > 0) {
              const shares = parseFloat(operationForm.shares);
              const amount = (shares * nav).toFixed(2);
              setOperationForm(prev => ({ ...prev, amount }));
            }
          } catch (e) {
            console.error("Auto NAV fetch for operation failed", e);
          } finally {
            setCalculatingSharesId(null);
          }
        }
      }
    };

    if (operationForm.fundCode.length === 6 && (operationForm.amount || operationForm.shares) && (isAddingOperation || editingOperation)) {
      fetchAndCalculate();
    }
  }, [operationForm.fundCode, operationForm.amount, operationForm.shares]);

  // Summarize history
  useEffect(() => {
    if (recaps.length > 0 && !historySummary) {
      summarizeHistory();
    }
  }, [recaps]);

  const summarizeHistory = async () => {
    if (recaps.length === 0) return;
    setIsSummarizing(true);
    try {
      const recentRecaps = recaps.slice(0, 5).map(r => r.content.slice(0, 2000));
      const response = await summarizeHistoryService(recentRecaps);
      setHistorySummary(response);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSummarizing(false);
    }
  };

  const fetchDailyNews = async () => {
    if (holdings.length === 0 && operations.length === 0) return;
    setIsGeneratingDailyNews(true);
    try {
      const response = await generateDailyNews(holdings, operations.slice(0, 10));
      setDailyNews(response);
    } catch (e) {
      console.error(e);
    } finally {
      setIsGeneratingDailyNews(false);
    }
  };

  useEffect(() => {
    if (user && (holdings.length > 0 || operations.length > 0) && !dailyNews) {
      fetchDailyNews();
    }
  }, [user, holdings.length, operations.length]);

  // Auth
  const totalHoldingAmount = holdings.reduce((sum, h) => sum + (h.amount || 0), 0);
  const totalProfit = holdings.reduce((sum, h) => sum + ((h.amount || 0) * (h.returnRate || 0) / 100), 0);
  const totalReturnRate = totalHoldingAmount > 0 ? (totalProfit / totalHoldingAmount) * 100 : 0;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Ensure user doc exists
        setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          photoURL: u.photoURL,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    });
    return unsubscribe;
  }, []);

  // Firestore Listeners
  useEffect(() => {
    if (!user) return;

    const opQuery = query(
      collection(db, 'operations'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const recapQuery = query(
      collection(db, 'recaps'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const holdingQuery = query(
      collection(db, 'holdings'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubOps = onSnapshot(opQuery, (snap) => {
      setOperations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Operation)));
    });
    const unsubRecaps = onSnapshot(recapQuery, (snap) => {
      setRecaps(snap.docs.map(d => ({ id: d.id, ...d.data() } as Recap)));
    });
    const unsubHoldings = onSnapshot(holdingQuery, (snap) => {
      setHoldings(snap.docs.map(d => ({ id: d.id, ...d.data() } as Holding)));
    });

    return () => {
      unsubOps();
      unsubRecaps();
      unsubHoldings();
    };
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  const resizeImage = (file: File, maxWidth: number = 1024): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL(file.type, 0.8));
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsAnalyzing(true);
    try {
      const resizedDataUrl = await resizeImage(file);
      const base64 = resizedDataUrl.split(',')[1];
      const mimeType = file.type;
      
      const dataArray = await analyzeOperationScreenshot(base64, mimeType);
      
      for (const data of dataArray) {
        await addDoc(collection(db, 'operations'), {
          ...data,
          userId: user.uid,
          createdAt: serverTimestamp(),
          date: serverTimestamp(),
          screenshotUrl: resizedDataUrl
        });
      }
    } catch (error) {
      console.error('Analysis or save failed', error);
      // Only call handleFirestoreError if it's actually a Firestore error, 
      // but for now we'll just alert the user to avoid confusing error boundaries
      alert('识别或保存失败，请重试或检查图片大小。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleHoldingsFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsAnalyzing(true);
    try {
      const resizedDataUrl = await resizeImage(file);
      const base64 = resizedDataUrl.split(',')[1];
      const mimeType = file.type;
      
      const holdingsData = await analyzeHoldingsScreenshot(base64, mimeType);
      
      for (const holding of holdingsData) {
        const existing = holdings.find(h => h.fundName === holding.fundName);
        if (existing?.id) {
          await setDoc(doc(db, 'holdings', existing.id), {
            ...holding,
            userId: user.uid,
            updatedAt: serverTimestamp()
          }, { merge: true });
        } else {
          await addDoc(collection(db, 'holdings'), {
            ...holding,
            userId: user.uid,
            updatedAt: serverTimestamp()
          });
        }
      }
    } catch (error) {
      console.error('Analysis or save failed', error);
      alert('识别或保存失败，请重试或检查图片大小。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const filteredOperations = operations.filter(op => {
    if (!startDate && !endDate) return true;
    const opDate = op.createdAt instanceof Timestamp ? op.createdAt.toDate() : new Date(0);
    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate + 'T23:59:59') : new Date();
    return opDate >= start && opDate <= end;
  });

  const operationsByDate = filteredOperations.reduce((acc, op) => {
    const dateStr = op.createdAt instanceof Timestamp ? format(op.createdAt.toDate(), 'yyyy-MM-dd') : 'unknown';
    if (!acc[dateStr]) acc[dateStr] = [];
    acc[dateStr].push(op);
    return acc;
  }, {} as Record<string, typeof filteredOperations>);

  const toggleDateSelection = (dateStr: string, isSelected: boolean) => {
    const opsForDate = operationsByDate[dateStr] || [];
    const idsForDate = opsForDate.map(op => op.id!);
    
    if (isSelected) {
      setSelectedOperations(prev => Array.from(new Set([...prev, ...idsForDate])));
    } else {
      setSelectedOperations(prev => prev.filter(id => !idsForDate.includes(id)));
    }
  };

  const getMarketSuggestion = (holding: Holding): string => {
    const sector = holding.sector || '其他';
    const random = Math.random();
    if (random < 0.3) return '建议持有';
    if (random < 0.6) return '逢低加仓';
    if (random < 0.8) return '分批止盈';
    return '观察为主';
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedOperations(filteredOperations.map(op => op.id!));
    } else {
      setSelectedOperations([]);
    }
  };

  const toggleRecapSelection = (id: string) => {
    setSelectedRecaps(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAllRecaps = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedRecaps(recaps.map(r => r.id!));
    } else {
      setSelectedRecaps([]);
    }
  };

  const handleBatchDeleteRecaps = async () => {
    // Using a simple check to avoid confirm() in iframe
    if (selectedRecaps.length === 0) return;
    
    for (const id of selectedRecaps) {
      await deleteDocument('recaps', id);
    }
    setSelectedRecaps([]);
  };

  const handleGenerateRecap = async (type: RecapType) => {
    if (!user) return;

    setIsGenerating(true);
    try {
      const selectedOps = operations.filter(op => selectedOperations.includes(op.id!));
      const truncatedMarketContext = marketContext.slice(0, 5000);
      const result = await generateRecap(selectedOps, type, truncatedMarketContext);
      
      await addDoc(collection(db, 'recaps'), {
        userId: user.uid,
        type,
        title: result.title,
        content: result.content,
        relatedOperations: selectedOperations,
        marketContext,
        createdAt: serverTimestamp(),
        date: serverTimestamp()
      });
      
      setSelectedOperations([]);
      setMarketContext('');
      setIsGenerating(false);
    } catch (error) {
      console.error('Generation failed', error);
      setIsGenerating(false);
    }
  };

  const toggleOpSelection = (id: string) => {
    setSelectedOperations(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSaveHolding = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    
    const data = {
      userId: user.uid,
      fundName: holdingForm.fundName,
      fundCode: holdingForm.fundCode,
      amount: Number(holdingForm.amount),
      shares: Number(holdingForm.shares),
      costBasis: Number(holdingForm.costBasis),
      returnRate: Number(holdingForm.returnRate),
      sector: holdingForm.sector,
      updatedAt: serverTimestamp()
    };

    try {
      if (editingHolding?.id) {
        await setDoc(doc(db, 'holdings', editingHolding.id), data, { merge: true });
      } else {
        await addDoc(collection(db, 'holdings'), data);
      }
      setEditingHolding(null);
      setIsAddingHolding(false);
    } catch (error) {
      handleFirestoreError(error, FSOperationType.WRITE, 'holdings');
    }
  };

  const handleSaveOperation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user) return;
    
    const data = {
      userId: user.uid,
      fundName: operationForm.fundName,
      fundCode: operationForm.fundCode,
      type: operationForm.type,
      amount: Number(operationForm.amount),
      shares: Number(operationForm.shares),
      returnRate: Number(operationForm.returnRate),
      sector: operationForm.sector,
      reason: operationForm.reason,
      createdAt: editingOperation?.createdAt || serverTimestamp(),
      date: serverTimestamp()
    };

    try {
      if (editingOperation?.id) {
        await setDoc(doc(db, 'operations', editingOperation.id), data, { merge: true });
      } else {
        await addDoc(collection(db, 'operations'), data);
      }
      setEditingOperation(null);
      setIsAddingOperation(false);
    } catch (error) {
      handleFirestoreError(error, FSOperationType.WRITE, 'operations');
    }
  };

  const deleteDocument = async (coll: string, id: string) => {
    // window.confirm doesn't work in iframe, so we just delete directly for now.
    // Ideally, we should implement a custom modal for confirmation.
    try {
      await deleteDoc(doc(db, coll, id));
    } catch (error) {
      handleFirestoreError(error, FSOperationType.DELETE, `${coll}/${id}`);
    }
  };

  const handleFetchFundCode = async (id: string, fundName: string, coll: 'holdings' | 'operations') => {
    setFetchingCodeId(id);
    try {
      const code = await fetchFundCode(fundName);
      if (code && code !== 'NOT_FOUND') {
        await setDoc(doc(db, coll, id), { fundCode: code }, { merge: true });
      } else {
        alert(`未能自动获取“${fundName}”的基金代码，请手动输入。`);
      }
    } catch (error) {
      console.error("Failed to fetch and update fund code", error);
    } finally {
      setFetchingCodeId(null);
    }
  };

  const handleCalculateShares = async (id: string, fundCode: string, amount: number, coll: 'holdings' | 'operations') => {
    setCalculatingSharesId(id);
    try {
      const nav = await fetchFundNAV(fundCode);
      if (nav && nav > 0) {
        const shares = Number((amount / nav).toFixed(2));
        await setDoc(doc(db, coll, id), { shares }, { merge: true });
      } else {
        alert("无法获取最新净值，请手动编辑输入");
      }
    } catch (error) {
      console.error("Failed to calculate shares", error);
    } finally {
      setCalculatingSharesId(null);
    }
  };

  const handleUpdateMarketValue = async (holding: Holding) => {
    if (!holding.fundCode || !holding.shares) return;
    setFetchingCodeId(holding.id!);
    try {
      const nav = await fetchFundNAV(holding.fundCode);
      if (nav && nav > 0) {
        const amount = Number((holding.shares * nav).toFixed(2));
        await setDoc(doc(db, 'holdings', holding.id!), { 
          amount,
          lastUpdated: serverTimestamp()
        }, { merge: true });
      } else {
        alert("无法获取最新净值");
      }
    } catch (error) {
      console.error("Failed to update market value", error);
    } finally {
      setFetchingCodeId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-200">
              <TrendingUp className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900">FundRecap</h1>
            <p className="text-slate-500">基金操作复盘与板块机会助手</p>
          </div>
          
          <Card className="p-8">
            <p className="text-slate-600 mb-8">
              上传基金持仓截图，自动识别买卖动作，结合资讯生成专业复盘内容。
            </p>
            <Button onClick={handleLogin} className="w-full py-3 text-lg">
              使用 Google 账号登录
            </Button>
          </Card>
          
          <p className="text-xs text-slate-400">
            仅限受邀财经博主使用。数据安全加密存储。
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-blue-600" />
            <span className="text-xl font-bold tracking-tight">FundRecap</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full">
              <img src={user.photoURL || ''} className="w-6 h-6 rounded-full" alt="" />
              <span className="text-sm font-medium text-slate-700">{user.displayName}</span>
            </div>
            <Button variant="ghost" onClick={handleLogout} className="p-2">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="flex items-center gap-1 sticky top-0 z-50 bg-white/95 backdrop-blur-sm p-1 rounded-xl border border-slate-200 w-fit mb-8 shadow-sm">
          <button 
            onClick={() => setActiveTab('news')}
            className={cn(
              "px-6 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === 'news' ? "bg-blue-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
            )}
          >
            今日快讯
          </button>
          <button 
            onClick={() => setActiveTab('recap')}
            className={cn(
              "px-6 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === 'recap' ? "bg-blue-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
            )}
          >
            复盘助手
          </button>
          <button 
            onClick={() => setActiveTab('holdings')}
            className={cn(
              "px-6 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === 'holdings' ? "bg-blue-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
            )}
          >
            我的持仓
          </button>
          <button 
            onClick={() => setActiveTab('records')}
            className={cn(
              "px-6 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === 'records' ? "bg-blue-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"
            )}
          >
            操作记录
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {activeTab === 'news' && (
            <div className="lg:col-span-12">
              <Card 
                title="今日快讯" 
                subtitle="基于您的持仓与近期操作，为您生成每日市场概览"
                icon={Newspaper}
                className="bg-white border-slate-200 shadow-xl relative overflow-hidden group"
              >
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-600"></div>
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Newspaper className="w-24 h-24 -mr-8 -mt-8 rotate-12" />
                </div>
                
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex items-center gap-2 px-3 py-1 bg-red-50 rounded-full border border-red-100">
                    <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                    <span className="text-[10px] font-bold text-red-600 uppercase tracking-widest">Live Analysis</span>
                  </div>
                  <div className="h-px flex-1 bg-slate-100"></div>
                  <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">Market Intelligence v2.5</span>
                </div>

                {isGeneratingDailyNews ? (
                  <div className="flex flex-col items-center justify-center py-20 space-y-6">
                    <div className="relative">
                      <div className="absolute inset-0 bg-blue-400/20 blur-xl rounded-full animate-pulse"></div>
                      <Loader2 className="w-12 h-12 text-blue-600 animate-spin relative z-10" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-slate-900 font-semibold text-lg">正在深度扫描市场动态</p>
                      <p className="text-slate-500 text-sm animate-pulse">正在结合您的持仓偏好进行板块机会对齐...</p>
                    </div>
                  </div>
                ) : dailyNews ? (
                  <div className="space-y-6">
                    <div className="bg-slate-50/50 rounded-2xl p-8 border border-slate-100 shadow-inner relative">
                      <div className="absolute top-4 right-4 text-slate-200">
                        <BrainCircuit className="w-12 h-12" />
                      </div>
                      <div className="prose prose-slate max-w-none prose-sm lg:prose-base prose-headings:font-serif prose-headings:italic prose-headings:text-slate-900 prose-p:text-slate-600 prose-p:leading-relaxed prose-strong:text-blue-700 prose-strong:font-bold prose-li:text-slate-600">
                        <ReactMarkdown>{dailyNews}</ReactMarkdown>
                      </div>
                    </div>
                    <div className="flex justify-between items-center pt-4 border-t border-slate-50">
                      <div className="flex items-center gap-4">
                        <div className="flex -space-x-2">
                          {[1, 2, 3].map(i => (
                            <div key={i} className="w-6 h-6 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-500">
                              {String.fromCharCode(64 + i)}
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium">
                          由 Gemini 3.1 Pro 提供投研支持 · {new Date().toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                      <Button 
                        variant="outline" 
                        onClick={fetchDailyNews} 
                        className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 text-xs py-2 h-auto rounded-full px-6 border-blue-100 font-bold tracking-wide"
                        disabled={isGeneratingDailyNews}
                      >
                        <Loader2 className={cn("w-3 h-3 mr-2", isGeneratingDailyNews && "animate-spin")} />
                        刷新今日动态
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center">
                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mb-4">
                      <Newspaper className="w-8 h-8 text-slate-300" />
                    </div>
                    <p className="text-slate-500 mb-6 font-medium max-w-xs">暂无快讯。AI 需要您的持仓或操作记录作为分析锚点。</p>
                    <Button onClick={fetchDailyNews} variant="primary" className="rounded-full px-10 shadow-lg shadow-blue-500/20">立即生成</Button>
                  </div>
                )}
              </Card>
            </div>
          )}

          {activeTab === 'recap' && (
            <>
              {/* Left Column: Operations & Upload */}
              <div className="lg:col-span-4 space-y-6">
                <Card title="投研大脑" subtitle="长期观点与风格画像" icon={BrainCircuit} className="bg-slate-900 border-none text-white shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 blur-[100px] -mr-32 -mt-32 rounded-full group-hover:bg-blue-600/20 transition-colors duration-700"></div>
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-indigo-600/10 blur-[80px] -ml-16 -mb-16 rounded-full"></div>
                  
                  <div className="space-y-6 relative z-10">
                    {isSummarizing ? (
                      <div className="flex flex-col items-center gap-4 py-8">
                        <div className="relative">
                          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-1 h-1 bg-blue-400 rounded-full animate-ping"></div>
                          </div>
                        </div>
                        <span className="text-xs font-medium text-slate-400 tracking-widest uppercase">Synthesizing Memory...</span>
                      </div>
                    ) : (
                      <div className="relative">
                        <span className="absolute -top-4 -left-2 text-4xl text-blue-500/20 font-serif">“</span>
                        <p className="text-sm text-slate-300 leading-relaxed font-light italic px-4 py-2 bg-white/5 rounded-xl border border-white/5">
                          {historySummary || "上传更多操作以开启 AI 投研助理的长期记忆。"}
                        </p>
                        <span className="absolute -bottom-6 -right-2 text-4xl text-blue-500/20 font-serif">”</span>
                      </div>
                    )}
                    
                    <div className="pt-6 border-t border-slate-800/50">
                      <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-widest font-black">
                        <span>Portfolio DNA</span>
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-0.5">
                            {[1, 2, 3, 4, 5].map(i => (
                              <div key={i} className={cn("w-1 h-3 rounded-full", i <= 4 ? "bg-blue-500" : "bg-slate-700")}></div>
                            ))}
                          </div>
                          <span className="text-blue-400">85% Match</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-4">
                        {['趋势跟随', '左侧低吸', '科技成长'].map(tag => (
                          <span key={tag} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-[10px] font-bold border border-white/5 hover:border-blue-500/30 transition-all cursor-default">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>

                <Card title="近期操作" subtitle="选择操作生成复盘" icon={History} className="bg-white border-slate-100 shadow-sm">
                  <div className="mb-4 flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-2 px-2">
                      <input 
                        type="checkbox" 
                        checked={filteredOperations.length > 0 && selectedOperations.length === filteredOperations.length}
                        onChange={handleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">全选</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <input 
                        type="date" 
                        value={startDate} 
                        onChange={(e) => setStartDate(e.target.value)}
                        className="text-[10px] border-none bg-white rounded-lg px-2 py-1 focus:ring-2 focus:ring-blue-500/20 outline-none w-full"
                      />
                      <span className="text-slate-300">-</span>
                      <input 
                        type="date" 
                        value={endDate} 
                        onChange={(e) => setEndDate(e.target.value)}
                        className="text-[10px] border-none bg-white rounded-lg px-2 py-1 focus:ring-2 focus:ring-blue-500/20 outline-none w-full"
                      />
                    </div>
                    {(startDate || endDate) && (
                      <button 
                        onClick={() => { setStartDate(''); setEndDate(''); }}
                        className="p-1 text-blue-500 hover:text-blue-700 transition-colors"
                        title="清除筛选"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-6 max-h-[450px] overflow-y-auto pr-2 custom-scrollbar">
                    {Object.keys(operationsByDate).length === 0 ? (
                      <div className="text-center py-12 text-slate-400 italic bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <History className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        <p className="text-sm">暂无符合条件的记录</p>
                      </div>
                    ) : (
                      Object.entries(operationsByDate).map(([date, ops]) => (
                        <div key={date} className="space-y-2">
                          <div className="flex items-center gap-2 px-2 py-1 bg-slate-50 rounded-lg border border-slate-100">
                            <input 
                              type="checkbox" 
                              checked={ops.every(op => selectedOperations.includes(op.id!))}
                              onChange={(e) => toggleDateSelection(date, e.target.checked)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{date}</span>
                            <span className="text-[10px] text-slate-400">({ops.length}条)</span>
                          </div>
                          {ops.map((op) => (
                            <div 
                              key={op.id}
                              className={cn(
                                "group p-4 rounded-2xl border transition-all cursor-pointer flex items-center gap-4 relative overflow-hidden",
                                selectedOperations.includes(op.id!) 
                                  ? "border-blue-500 bg-blue-50/50 shadow-sm" 
                                  : "border-slate-100 bg-white hover:border-blue-200 hover:bg-slate-50"
                              )}
                            >
                              <input 
                                type="checkbox" 
                                checked={selectedOperations.includes(op.id!)}
                                onChange={() => toggleOpSelection(op.id!)}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 relative z-20"
                              />
                              <div 
                                onClick={() => toggleOpSelection(op.id!)}
                                className="flex items-center justify-between flex-1 relative z-10"
                              >
                                {selectedOperations.includes(op.id!) && (
                                  <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                )}
                                <div className="flex items-center gap-4">
                                  <div className={cn(
                                    "w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm transition-transform group-hover:scale-110",
                                    op.type === 'buy' || op.type === 'add' ? "bg-red-500 text-white" : 
                                    op.type === 'sell' || op.type === 'reduce' ? "bg-green-500 text-white" : 
                                    op.type === 'switch' ? "bg-indigo-500 text-white" :
                                    "bg-slate-500 text-white"
                                  )}>
                                    {op.type === 'buy' || op.type === 'add' ? <TrendingUp className="w-6 h-6" /> : 
                                     op.type === 'switch' ? <ArrowRightLeft className="w-6 h-6" /> :
                                     <TrendingDown className="w-6 h-6" />}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-bold text-slate-900 truncate flex items-center gap-2">
                                      {op.type === 'switch' && (op.fundName.includes('转换') || op.fundName.includes('转') || op.fundName.includes('->') || op.fundName.includes('到')) ? (
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {op.fundName.split(/转换到|转换为|转换|转到|转为|转|->/).filter(Boolean).map((part, i, arr) => (
                                            <React.Fragment key={i}>
                                              <span className="truncate">{part.trim()}</span>
                                              {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />}
                                            </React.Fragment>
                                          ))}
                                        </div>
                                      ) : (
                                        op.fundName
                                      )}
                                    </div>
                                    <div className="text-xs font-medium text-slate-500 mt-0.5 flex items-center gap-2">
                                      <span className={cn(
                                        "px-1.5 py-0.5 rounded text-[10px] uppercase font-bold",
                                        op.type === 'buy' || op.type === 'add' ? "bg-red-100 text-red-700" : 
                                        op.type === 'sell' || op.type === 'reduce' ? "bg-green-100 text-green-700" : 
                                        "bg-slate-100 text-slate-700"
                                      )}>
                                        {op.type === 'buy' ? '买入' : op.type === 'sell' ? '卖出' : op.type === 'add' ? '加仓' : op.type === 'reduce' ? '减仓' : op.type === 'switch' ? '转换' : '观察'}
                                      </span>
                                      {op.amount && <span className="text-slate-400">·</span>}
                                      {op.amount && <span className="font-mono text-slate-600">¥{op.amount.toLocaleString()}</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">
                                  {op.createdAt instanceof Timestamp ? format(op.createdAt.toDate(), 'HH:mm') : ''}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </div>

              {/* Right Column: Generation & Results */}
              <div className="lg:col-span-8 space-y-6">
                <Card title="智能复盘生成" subtitle="结合当日资讯与历史投研大脑" icon={BrainCircuit} className="bg-white border-slate-200 shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/5 blur-3xl -mr-24 -mt-24 rounded-full"></div>
                  <div className="space-y-8 relative z-10">
                    <div className="relative group">
                      <div className="absolute -top-3 left-4 px-2 bg-white text-[10px] font-bold text-slate-400 uppercase tracking-widest z-10 group-focus-within:text-blue-500 transition-colors">Market Context & Insights</div>
                      <textarea 
                        value={marketContext}
                        onChange={(e) => setMarketContext(e.target.value)}
                        placeholder="输入今日板块热点、宏观政策或你的操作逻辑..."
                        className="w-full h-40 p-6 pt-8 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all outline-none resize-none text-slate-700 leading-relaxed placeholder:text-slate-300"
                      />
                      <div className="absolute bottom-4 right-4 flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                        <MessageSquare className="w-3 h-3" />
                        {marketContext.length} chars
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <div className="h-px flex-1 bg-slate-100"></div>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Select Output Format</span>
                        <div className="h-px flex-1 bg-slate-100"></div>
                      </div>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Button 
                          variant="primary" 
                          onClick={() => handleGenerateRecap('intraday')}
                          loading={isGenerating}
                          className="h-24 flex-col gap-2 rounded-2xl shadow-lg shadow-blue-500/20"
                        >
                          <MessageSquare className="w-6 h-6" />
                          <span className="text-xs font-bold">盘中快评</span>
                        </Button>
                        <Button 
                          variant="secondary" 
                          onClick={() => handleGenerateRecap('end-of-day')}
                          loading={isGenerating}
                          className="h-24 flex-col gap-2 rounded-2xl shadow-lg shadow-slate-900/20"
                        >
                          <TrendingUp className="w-6 h-6" />
                          <span className="text-xs font-bold">收盘复盘</span>
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => handleGenerateRecap('long-form')}
                          loading={isGenerating}
                          className="h-24 flex-col gap-2 rounded-2xl border-2 border-slate-100 hover:border-blue-500 hover:bg-blue-50/50"
                        >
                          <FileText className="w-6 h-6" />
                          <span className="text-xs font-bold">公众号长文</span>
                        </Button>
                        <Button 
                          variant="outline" 
                          onClick={() => handleGenerateRecap('social-post')}
                          loading={isGenerating}
                          className="h-24 flex-col gap-2 rounded-2xl border-2 border-slate-100 hover:border-blue-500 hover:bg-blue-50/50"
                        >
                          <Share2 className="w-6 h-6" />
                          <span className="text-xs font-bold">社媒短评</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>

                <div className="space-y-4">
                  <div className="flex items-center justify-between px-2">
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-5 h-5 text-blue-600" />
                      复盘历史
                    </h2>
                    {recaps.length > 0 && (
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                          <input type="checkbox" checked={selectedRecaps.length === recaps.length && recaps.length > 0} onChange={handleSelectAllRecaps} className="rounded border-slate-300 text-blue-600" />
                          全选
                        </label>
                        {selectedRecaps.length > 0 && (
                          <Button variant="danger" onClick={handleBatchDeleteRecaps} className="h-8 text-xs">
                            批量删除 ({selectedRecaps.length})
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {recaps.length === 0 ? (
                      <div className="col-span-2 text-center py-16 bg-white rounded-2xl border-2 border-dashed border-slate-100 text-slate-400 flex flex-col items-center">
                        <FileText className="w-12 h-12 mb-4 opacity-10" />
                        <p className="text-sm font-medium">尚未生成任何复盘内容</p>
                        <p className="text-xs mt-1">选择上方操作并点击生成按钮开启您的第一篇复盘</p>
                      </div>
                    ) : (
                      recaps.map((recap) => (
                        <motion.div 
                          layoutId={recap.id}
                          key={recap.id}
                          onClick={() => setActiveRecap(recap)}
                          whileHover={{ y: -4 }}
                          className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-xl hover:border-blue-200 transition-all cursor-pointer group relative overflow-hidden"
                        >
                          <div className="flex items-center justify-between mb-4 relative z-10">
                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <input 
                                type="checkbox" 
                                checked={selectedRecaps.includes(recap.id!)} 
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => { e.stopPropagation(); toggleRecapSelection(recap.id!); }}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600"
                              />
                              <div className={cn(
                                "text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border",
                                recap.type === 'intraday' ? "bg-blue-50 text-blue-600 border-blue-100" :
                                recap.type === 'end-of-day' ? "bg-purple-50 text-purple-600 border-purple-100" :
                                recap.type === 'long-form' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                "bg-amber-50 text-amber-600 border-amber-100"
                              )}>
                                {recap.type === 'intraday' ? '盘中快评' : recap.type === 'end-of-day' ? '收盘复盘' : recap.type === 'long-form' ? '公众号' : '社媒'}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 font-mono font-bold">
                                {recap.createdAt instanceof Timestamp ? format(recap.createdAt.toDate(), 'yyyy-MM-dd') : ''}
                              </span>
                              <button 
                                onClick={(e) => { e.stopPropagation(); deleteDocument('recaps', recap.id!); }}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          
                          <h3 className="font-bold text-slate-900 mb-3 group-hover:text-blue-600 transition-colors line-clamp-1 text-lg leading-tight">{recap.title}</h3>
                          <p className="text-sm text-slate-500 line-clamp-2 mb-6 leading-relaxed font-light">{recap.content.replace(/[#*`]/g, '')}</p>
                          
                          <div className="flex items-center justify-between pt-4 border-t border-slate-50 relative z-10">
                            <div className="flex items-center gap-3">
                              <div className="flex -space-x-1.5">
                                {recap.relatedOperations.slice(0, 3).map((_, i) => (
                                  <div key={i} className="w-5 h-5 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-400">
                                    {i + 1}
                                  </div>
                                ))}
                              </div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                {recap.relatedOperations.length} Ops
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-blue-600 font-bold text-[10px] uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                              View Full <ChevronRight className="w-3 h-3" />
                            </div>
                          </div>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'holdings' && (
            <div className="lg:col-span-12 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  <Wallet className="w-6 h-6 text-blue-600" />
                  我的持仓
                </h2>
                <div className="flex items-center gap-6 mr-auto ml-8">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">总持仓金额</span>
                    <span className="text-lg font-bold text-slate-900">¥{totalHoldingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">总收益率</span>
                    <span className={cn(
                      "text-lg font-bold",
                      totalReturnRate > 0 ? "text-red-600" : totalReturnRate < 0 ? "text-green-600" : "text-slate-900"
                    )}>
                      {totalReturnRate > 0 ? '+' : ''}{totalReturnRate.toFixed(2)}%
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-2 mr-4">
                    <span className="text-xs text-slate-500">自动更新:</span>
                    <select 
                      value={autoUpdateInterval || ''} 
                      onChange={(e) => setAutoUpdateInterval(e.target.value ? Number(e.target.value) : null)}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white"
                    >
                      <option value="">关闭</option>
                      <option value="10000">10秒</option>
                      <option value="20000">20秒</option>
                      <option value="30000">30秒</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 mr-4">
                    <select
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value as any)}
                      className="bg-slate-100 text-slate-600 text-xs font-medium px-3 py-2 rounded-xl border-none focus:ring-0 cursor-pointer"
                    >
                      <option value="fundName">基金名称</option>
                      <option value="amount">市值</option>
                      <option value="returnRate">收益率</option>
                    </select>
                    <button
                      onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                      className="bg-slate-100 text-slate-600 p-2 rounded-xl hover:bg-slate-200 transition-all"
                    >
                      {sortDirection === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex bg-slate-100 p-1 rounded-xl mr-2">
                    <button
                      onClick={() => setHoldingsViewMode('card')}
                      className={cn(
                        "p-1.5 rounded-lg transition-all",
                        holdingsViewMode === 'card' ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                      )}
                      title="卡片视图"
                    >
                      <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setHoldingsViewMode('list')}
                      className={cn(
                        "p-1.5 rounded-lg transition-all",
                        holdingsViewMode === 'list' ? "bg-white text-blue-600 shadow-sm" : "text-slate-400 hover:text-slate-600"
                      )}
                      title="列表视图"
                    >
                      <List className="w-4 h-4" />
                    </button>
                  </div>
                  <label className={cn(
                    "inline-flex items-center justify-center px-4 py-2 rounded-xl font-medium transition-all active:scale-95 bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer",
                    isAnalyzing && "opacity-50 pointer-events-none"
                  )}>
                    {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                    截图导入
                    <input type="file" className="hidden" onChange={handleHoldingsFileUpload} accept="image/*" disabled={isAnalyzing} />
                  </label>
                  <Button onClick={() => setIsAddingHolding(true)} disabled={isAnalyzing}>
                    <Plus className="w-4 h-4 mr-2" /> 添加持仓
                  </Button>
                </div>
              </div>

              {holdings.length === 0 ? (
                <div className="col-span-full text-center py-24 bg-white rounded-3xl border-2 border-dashed border-slate-100 text-slate-400 flex flex-col items-center">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                    <Wallet className="w-10 h-10 text-slate-200" />
                  </div>
                  <p className="text-lg font-bold text-slate-900">暂无持仓数据</p>
                  <p className="text-sm mt-2 max-w-xs">点击上方按钮手动添加或上传截图，开启您的基金复盘之旅。</p>
                </div>
              ) : holdingsViewMode === 'card' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {sortedHoldings.map((holding) => (
                    <Card key={holding.id} className="relative group hover:shadow-2xl hover:border-blue-200 transition-all duration-500 rounded-3xl overflow-hidden border-slate-100 p-0">
                      <div className={cn(
                        "h-2 w-full",
                        holding.returnRate && holding.returnRate > 0 ? "bg-gradient-to-r from-red-500 to-orange-500" : 
                        holding.returnRate && holding.returnRate < 0 ? "bg-gradient-to-r from-green-500 to-emerald-500" : 
                        "bg-gradient-to-r from-blue-500 to-indigo-600"
                      )}></div>
                      
                      <div className="p-6 space-y-6">
                        <div className="relative">
                          <div className="absolute top-0 right-0 flex gap-2 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0 z-20">
                            <button onClick={() => setEditingHolding(holding)} className="p-2 bg-white shadow-lg rounded-xl text-slate-600 hover:bg-blue-600 hover:text-white transition-all">
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteDocument('holdings', holding.id!)} className="p-2 bg-white shadow-lg rounded-xl text-slate-600 hover:bg-red-600 hover:text-white transition-all">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          
                          <div className="pr-16">
                            <h3 className="font-black text-xl text-slate-900 truncate leading-tight mb-1">{holding.fundName}</h3>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-mono font-bold tracking-wider">
                                {holding.fundCode || 'NO CODE'}
                              </span>
                              {!holding.fundCode && (
                                <button 
                                  onClick={() => handleFetchFundCode(holding.id!, holding.fundName, 'holdings')}
                                  disabled={fetchingCodeId === holding.id}
                                  className="text-blue-500 hover:text-blue-700 p-1 rounded-full hover:bg-blue-50 transition-colors disabled:opacity-50"
                                >
                                  {fetchingCodeId === holding.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-1 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Market Value</p>
                              <button 
                                onClick={() => handleUpdateMarketValue(holding)}
                                disabled={fetchingCodeId === holding.id}
                                className="text-blue-500 hover:text-blue-700 p-0.5 rounded-full hover:bg-blue-50 transition-all disabled:opacity-50"
                                title="更新实时估值"
                              >
                                {fetchingCodeId === holding.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                              </button>
                            </div>
                            <p className="text-lg font-black text-slate-900">¥{holding.amount?.toLocaleString()}</p>
                            {holding.lastUpdated && (
                              <p className="text-[9px] text-slate-400 font-mono">已于 {format(holding.lastUpdated.toDate(), 'MM-dd HH:mm')} 更新</p>
                            )}
                          </div>
                          <div className="space-y-1 p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                            <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Return Rate</p>
                            {holding.returnRate !== undefined && holding.returnRate !== null ? (
                              <p className={cn(
                                "text-lg font-black",
                                holding.returnRate > 0 ? "text-red-600" : holding.returnRate < 0 ? "text-green-600" : "text-slate-900"
                              )}>
                                {holding.returnRate > 0 ? '+' : ''}{holding.returnRate}%
                              </p>
                            ) : (
                              <p className="text-lg font-black text-slate-300">-</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-2 h-2 rounded-full",
                              holding.returnRate && holding.returnRate > 0 ? "bg-red-500" : 
                              holding.returnRate && holding.returnRate < 0 ? "bg-green-500" : 
                              "bg-blue-500"
                            )}></div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                              {holding.sector || 'General'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-400 font-mono">
                                {holding.shares ? holding.shares.toLocaleString() : '-'} Shares
                              </span>
                              {!holding.shares && holding.fundCode && holding.amount && (
                                <button
                                  onClick={() => handleCalculateShares(holding.id!, holding.fundCode!, holding.amount!, 'holdings')}
                                  disabled={calculatingSharesId === holding.id}
                                  className="text-blue-500 hover:text-blue-700 p-1 rounded-lg hover:bg-blue-50 transition-all disabled:opacity-50"
                                >
                                  {calculatingSharesId === holding.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />}
                                </button>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-300 font-mono">
                              {holding.updatedAt instanceof Timestamp ? format(holding.updatedAt.toDate(), 'MM-dd') : ''}
                            </span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 border-b border-slate-100">
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">基金名称</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">市值</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">收益率</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">操作建议</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">份额</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">板块</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">更新时间</th>
                          <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {sortedHoldings.map((holding) => (
                          <tr key={holding.id} className="hover:bg-blue-50/30 transition-colors group">
                            <td className="px-6 py-5">
                              <div className="font-bold text-slate-900 text-sm">{holding.fundName}</div>
                              <div className="flex items-center gap-1.5 mt-1">
                                <div className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1 rounded">{holding.fundCode || '无代码'}</div>
                                {!holding.fundCode && (
                                  <button 
                                    onClick={() => handleFetchFundCode(holding.id!, holding.fundName, 'holdings')}
                                    disabled={fetchingCodeId === holding.id}
                                    className="text-blue-500 hover:text-blue-700 p-0.5 rounded-full hover:bg-blue-50 transition-all disabled:opacity-50"
                                    title="自动获取基金代码"
                                  >
                                    {fetchingCodeId === holding.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-bold text-slate-900">¥{holding.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                <button 
                                  onClick={() => handleUpdateMarketValue(holding)}
                                  disabled={fetchingCodeId === holding.id}
                                  className="text-blue-500 hover:text-blue-700 p-0.5 rounded-full hover:bg-blue-50 transition-all disabled:opacity-50"
                                  title="更新实时估值"
                                >
                                  {fetchingCodeId === holding.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                </button>
                              </div>
                              {holding.lastUpdated && (
                                <div className="text-[9px] text-slate-400 font-mono mt-0.5">已于 {format(holding.lastUpdated.toDate(), 'MM-dd HH:mm')} 更新</div>
                              )}
                            </td>
                            <td className="px-6 py-5">
                              {holding.returnRate !== undefined && holding.returnRate !== null ? (
                                <div className={cn(
                                  "text-sm font-bold",
                                  holding.returnRate > 0 ? "text-red-600" : holding.returnRate < 0 ? "text-green-600" : "text-slate-900"
                                )}>
                                  {holding.returnRate > 0 ? '+' : ''}{holding.returnRate}%
                                </div>
                              ) : (
                                <div className="text-sm font-bold text-slate-300">-</div>
                              )}
                            </td>
                            <td className="px-6 py-5 font-bold text-blue-600">{getMarketSuggestion(holding)}</td>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-1.5">
                                <div className="text-xs text-slate-500 font-mono">{holding.shares ? `${holding.shares.toLocaleString()} 份` : '无份额'}</div>
                                {!holding.shares && holding.fundCode && holding.amount && (
                                  <button
                                    onClick={() => handleCalculateShares(holding.id!, holding.fundCode!, holding.amount!, 'holdings')}
                                    disabled={calculatingSharesId === holding.id}
                                    className="text-blue-500 hover:text-blue-700 p-0.5 rounded-full hover:bg-blue-50 transition-all disabled:opacity-50"
                                    title="根据最新净值自动计算份额"
                                  >
                                    {calculatingSharesId === holding.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase tracking-widest">
                                {holding.sector || 'General'}
                              </span>
                            </td>
                            <td className="px-6 py-5 text-xs text-slate-500 font-mono">
                              {holding.updatedAt instanceof Timestamp ? format(holding.updatedAt.toDate(), 'yyyy-MM-dd') : ''}
                            </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                <button onClick={() => setEditingHolding(holding)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="编辑">
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => deleteDocument('holdings', holding.id!)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all" title="删除">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'records' && (
            <div className="lg:col-span-12 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  <History className="w-6 h-6 text-blue-600" />
                  操作记录
                </h2>

                <div className="flex items-center gap-4 bg-white p-2 px-4 rounded-2xl border border-slate-100 shadow-sm ml-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-medium whitespace-nowrap">日期筛选:</span>
                    <input 
                      type="date" 
                      value={startDate} 
                      onChange={(e) => setStartDate(e.target.value)}
                      className="text-xs border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-blue-500/20 outline-none"
                    />
                    <span className="text-slate-300">-</span>
                    <input 
                      type="date" 
                      value={endDate} 
                      onChange={(e) => setEndDate(e.target.value)}
                      className="text-xs border-none bg-slate-50 rounded-lg px-2 py-1 focus:ring-2 focus:ring-blue-500/20 outline-none"
                    />
                    {(startDate || endDate) && (
                      <button 
                        onClick={() => { setStartDate(''); setEndDate(''); }}
                        className="text-[10px] text-blue-500 hover:text-blue-700 font-bold ml-1"
                      >
                        清除
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-6 mr-auto ml-8">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">总持仓金额</span>
                    <span className="text-lg font-bold text-slate-900">¥{totalHoldingAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">总收益率</span>
                    <span className={cn(
                      "text-lg font-bold",
                      totalReturnRate > 0 ? "text-red-600" : totalReturnRate < 0 ? "text-green-600" : "text-slate-900"
                    )}>
                      {totalReturnRate > 0 ? '+' : ''}{totalReturnRate.toFixed(2)}%
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <label className={cn(
                    "inline-flex items-center justify-center px-4 py-2 rounded-xl font-medium transition-all active:scale-95 bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer",
                    isAnalyzing && "opacity-50 pointer-events-none"
                  )}>
                    {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
                    截图识别
                    <input type="file" className="hidden" onChange={handleFileUpload} accept="image/*" disabled={isAnalyzing} />
                  </label>
                  <Button onClick={() => setIsAddingOperation(true)} disabled={isAnalyzing}>
                    <Plus className="w-4 h-4 mr-2" /> 手动记录
                  </Button>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto custom-scrollbar">
                <table className="text-left border-collapse table-fixed w-full" style={{ width: Object.values(columnWidths).reduce((a, b) => a + b, 0), minWidth: '100%' }}>
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-100">
                      <th className="px-6 py-4 w-12">
                        <input 
                          type="checkbox" 
                          checked={filteredOperations.length > 0 && selectedOperations.length === filteredOperations.length}
                          onChange={handleSelectAll}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                      </th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest relative" style={{ width: columnWidths.date }}>
                        日期
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1 cursor-col-resize hover:bg-blue-400/50 rounded-full transition-colors" onMouseDown={(e) => onMouseDown(e, 'date')} />
                      </th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest relative" style={{ width: columnWidths.name }}>
                        基金名称
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1 cursor-col-resize hover:bg-blue-400/50 rounded-full transition-colors" onMouseDown={(e) => onMouseDown(e, 'name')} />
                      </th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest relative" style={{ width: columnWidths.type }}>
                        类型
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1 cursor-col-resize hover:bg-blue-400/50 rounded-full transition-colors" onMouseDown={(e) => onMouseDown(e, 'type')} />
                      </th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest relative" style={{ width: columnWidths.amount }}>
                        金额/份额
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1 cursor-col-resize hover:bg-blue-400/50 rounded-full transition-colors" onMouseDown={(e) => onMouseDown(e, 'amount')} />
                      </th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest relative" style={{ width: columnWidths.reason }}>
                        理由/板块
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1 cursor-col-resize hover:bg-blue-400/50 rounded-full transition-colors" onMouseDown={(e) => onMouseDown(e, 'reason')} />
                      </th>
                      <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest relative" style={{ width: columnWidths.actions }}>
                        操作
                        <div className="absolute right-0 top-1/2 -translate-y-1/2 h-4 w-1 cursor-col-resize hover:bg-blue-400/50 rounded-full transition-colors" onMouseDown={(e) => onMouseDown(e, 'actions')} />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredOperations.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-24 text-center">
                          <div className="flex flex-col items-center gap-3 text-slate-300">
                            <History className="w-12 h-12 opacity-20" />
                            <p className="text-sm italic">暂无符合条件的操作记录</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredOperations.map((op) => (
                        <tr key={op.id} className={cn(
                          "hover:bg-blue-50/30 transition-colors group",
                          selectedOperations.includes(op.id!) && "bg-blue-50/50"
                        )}>
                          <td className="px-6 py-5">
                            <input 
                              type="checkbox" 
                              checked={selectedOperations.includes(op.id!)}
                              onChange={() => toggleOpSelection(op.id!)}
                              className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="px-6 py-5 text-xs text-slate-500 font-mono">
                            {op.createdAt instanceof Timestamp ? format(op.createdAt.toDate(), 'yyyy-MM-dd') : ''}
                          </td>
                          <td className="px-6 py-5">
                            <div className="font-bold text-slate-900 text-sm">
                              {op.type === 'switch' && (op.fundName.includes('转换') || op.fundName.includes('转') || op.fundName.includes('->') || op.fundName.includes('到')) ? (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {op.fundName.split(/转换到|转换为|转换|转到|转为|转|->/).filter(Boolean).map((part, i, arr) => (
                                    <React.Fragment key={i}>
                                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-xs">{part.trim()}</span>
                                      {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-blue-400" />}
                                    </React.Fragment>
                                  ))}
                                </div>
                              ) : (
                                <div className="whitespace-normal break-words leading-relaxed" title={op.fundName}>{op.fundName}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <div className="text-[10px] text-slate-400 font-mono bg-slate-50 px-1 rounded">{op.fundCode || '无代码'}</div>
                              {!op.fundCode && (
                                <button 
                                  onClick={() => handleFetchFundCode(op.id!, op.fundName, 'operations')}
                                  disabled={fetchingCodeId === op.id}
                                  className="text-blue-500 hover:text-blue-700 p-0.5 rounded-full hover:bg-blue-50 transition-all disabled:opacity-50"
                                  title="自动获取基金代码"
                                >
                                  {fetchingCodeId === op.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Search className="w-3 h-3" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow-sm",
                              op.type === 'buy' || op.type === 'add' ? "bg-red-50 text-red-600 border border-red-100" : 
                              op.type === 'sell' || op.type === 'reduce' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" :
                              op.type === 'switch' ? "bg-indigo-50 text-indigo-600 border border-indigo-100" :
                              "bg-slate-50 text-slate-500 border border-slate-100"
                            )}>
                              {op.type === 'buy' ? '买入' : op.type === 'sell' ? '卖出' : op.type === 'add' ? '加仓' : op.type === 'reduce' ? '减仓' : op.type === 'switch' ? '转换' : '观察'}
                            </span>
                          </td>
                          <td className="px-6 py-5">
                            <div className="text-sm font-bold text-slate-900">¥{op.amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <div className="text-[10px] text-slate-400 font-medium">{op.shares ? `${op.shares.toLocaleString()} 份` : '无份额'}</div>
                              {!op.shares && op.fundCode && op.amount && (
                                <button
                                  onClick={() => handleCalculateShares(op.id!, op.fundCode!, op.amount!, 'operations')}
                                  disabled={calculatingSharesId === op.id}
                                  className="text-blue-500 hover:text-blue-700 p-0.5 rounded-full hover:bg-blue-50 transition-all disabled:opacity-50"
                                  title="根据最新净值自动计算份额"
                                >
                                  {calculatingSharesId === op.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Calculator className="w-3 h-3" />
                                  )}
                                </button>
                              )}
                            </div>
                            {op.returnRate !== undefined && op.returnRate !== null && (
                              <div className={cn(
                                "text-[10px] font-bold mt-0.5",
                                op.returnRate > 0 ? "text-red-600" : op.returnRate < 0 ? "text-green-600" : "text-slate-400"
                              )}>
                                {op.returnRate > 0 ? '+' : ''}{op.returnRate}%
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-5">
                            <div className="space-y-1.5">
                              {op.reason && (
                                <div className="text-xs text-slate-600 leading-relaxed line-clamp-2" title={op.reason}>
                                  {op.reason}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-1">
                                <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase tracking-widest">
                                  {op.sector || 'General'}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                              <button 
                                onClick={() => setEditingOperation(op)}
                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                title="编辑"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => deleteDocument('operations', op.id!)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                title="删除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
        <AnimatePresence>
          {(isAddingHolding || editingHolding) && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.95 }} 
                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-500 to-indigo-600" />
                <h2 className="text-xl font-bold mb-6 text-slate-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-blue-600" />
                  {editingHolding ? '编辑持仓' : '新增持仓'}
                </h2>
                <form onSubmit={handleSaveHolding} className="space-y-5">
                  <div className="grid grid-cols-2 gap-5">
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">基金名称</label>
                      <input 
                        id="holding-fundName" 
                        name="fundName" 
                        value={holdingForm.fundName} 
                        onChange={handleHoldingFormChange}
                        required 
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm font-medium" 
                        placeholder="例如：易方达蓝筹精选" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">基金代码</label>
                      <input 
                        id="holding-fundCode" 
                        name="fundCode" 
                        value={holdingForm.fundCode} 
                        onChange={handleHoldingFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm font-mono" 
                        placeholder="005827" 
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5 ml-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">所属板块</label>
                        <button 
                          type="button"
                          title="联网验证板块归属"
                          onClick={async () => {
                            const fundName = holdingForm.fundName;
                            const fundCode = holdingForm.fundCode;
                            if (!fundName && !fundCode) {
                              alert("请先输入基金名称或代码");
                              return;
                            }
                            setVerifyingSectorId('form-holding');
                            try {
                              const sector = await fetchFundSector(fundName, fundCode);
                              if (sector) {
                                setHoldingForm(prev => ({ ...prev, sector }));
                                const sectorInput = document.getElementById('holding-sector') as HTMLInputElement;
                                if (sectorInput) {
                                  sectorInput.classList.add('ring-2', 'ring-blue-500/50');
                                  setTimeout(() => sectorInput.classList.remove('ring-2', 'ring-blue-500/50'), 2000);
                                }
                              } else {
                                alert("无法自动识别该基金的板块，请手动输入。");
                              }
                            } catch (e) {
                              console.error(e);
                              alert("验证失败，请检查网络或手动输入。");
                            } finally {
                              setVerifyingSectorId(null);
                            }
                          }}
                          disabled={verifyingSectorId === 'form-holding'}
                          className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50 font-bold transition-colors bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100"
                        >
                          {verifyingSectorId === 'form-holding' ? <Loader2 className="w-3 h-3 animate-spin" /> : <BrainCircuit className="w-3 h-3" />}
                          联网验证
                        </button>
                      </div>
                      <input 
                        id="holding-sector" 
                        name="sector" 
                        value={holdingForm.sector} 
                        onChange={handleHoldingFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm font-medium" 
                        placeholder="消费/白酒" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">当前市值 (¥)</label>
                      <input 
                        id="holding-amount" 
                        name="amount" 
                        type="number" 
                        step="0.01" 
                        value={holdingForm.amount} 
                        onChange={handleHoldingFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm font-bold" 
                        placeholder="0.00" 
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5 ml-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">持仓份额</label>
                        <div className="flex items-center gap-1">
                          {calculatingSharesId === 'form-holding-auto' && (
                            <span className="text-[9px] text-blue-500 flex items-center gap-1 animate-pulse">
                              <Loader2 className="w-2 h-2 animate-spin" />
                              正在估算...
                            </span>
                          )}
                          <button 
                            type="button"
                            title="根据净值自动计算份额"
                            onClick={async () => {
                              const fundCode = holdingForm.fundCode;
                              const amount = Number(holdingForm.amount);
                              if (!fundCode || !amount) {
                                alert("请先输入基金代码和市值");
                                return;
                              }
                              setCalculatingSharesId('form-holding');
                              try {
                                const nav = await fetchFundNAV(fundCode);
                                if (nav && nav > 0) {
                                  setHoldingForm(prev => ({ ...prev, shares: (amount / nav).toFixed(2) }));
                                  const sharesInput = document.getElementById('holding-shares') as HTMLInputElement;
                                  if (sharesInput) {
                                    sharesInput.classList.add('ring-2', 'ring-blue-500/50');
                                    setTimeout(() => sharesInput.classList.remove('ring-2', 'ring-blue-500/50'), 2000);
                                  }
                                } else {
                                  alert("无法自动获取该基金的最新净值，请手动输入份额。");
                                }
                              } catch (e) {
                                console.error(e);
                                alert("获取净值失败，请检查网络或手动输入。");
                              } finally {
                                setCalculatingSharesId(null);
                              }
                            }}
                            disabled={calculatingSharesId === 'form-holding'}
                            className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-1 disabled:opacity-50 font-bold transition-colors bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100"
                          >
                            {calculatingSharesId === 'form-holding' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />}
                            自动计算
                          </button>
                        </div>
                      </div>
                      <input 
                        id="holding-shares" 
                        name="shares" 
                        type="number" 
                        step="0.01" 
                        value={holdingForm.shares} 
                        onChange={handleHoldingFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm font-medium" 
                        placeholder="0.00" 
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">持仓成本 (¥)</label>
                      <input 
                        name="costBasis" 
                        type="number" 
                        step="0.01" 
                        value={holdingForm.costBasis} 
                        onChange={handleHoldingFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm font-medium" 
                        placeholder="0.00" 
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">当前收益率 (%)</label>
                      <input 
                        name="returnRate" 
                        type="number" 
                        step="0.01" 
                        value={holdingForm.returnRate} 
                        onChange={handleHoldingFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none text-sm font-bold" 
                        placeholder="0.00" 
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <Button type="submit" className="flex-1 py-6 rounded-xl shadow-lg shadow-blue-200">保存记录</Button>
                    <Button type="button" variant="outline" onClick={() => { setIsAddingHolding(false); setEditingHolding(null); }} className="px-8 py-6 rounded-xl">取消</Button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}

          {(isAddingOperation || editingOperation) && (
            <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.95 }} 
                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-indigo-500 to-purple-600" />
                <h2 className="text-xl font-bold mb-6 text-slate-900 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-indigo-600" />
                  {editingOperation ? '编辑记录' : '手动记录'}
                </h2>
                <form onSubmit={handleSaveOperation} className="space-y-5">
                  <div className="grid grid-cols-2 gap-5">
                    <div className="col-span-2 relative">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">基金名称</label>
                      <input 
                        id="op-fundName"
                        name="fundName" 
                        value={operationForm.fundName} 
                        onChange={handleOperationFormChange}
                        required 
                        autoComplete="off"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-medium" 
                        placeholder="搜索或输入基金名称"
                        onFocus={(e) => {
                          const val = e.target.value;
                          if (val.length === 0) {
                            setFundSuggestions(holdings);
                            setShowSuggestions(true);
                          } else {
                            const filtered = holdings.filter(h => 
                              h.fundName.toLowerCase().includes(val.toLowerCase()) || 
                              (h.fundCode && h.fundCode.includes(val))
                            );
                            setFundSuggestions(filtered);
                            setShowSuggestions(true);
                          }
                        }}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      />
                      {showSuggestions && fundSuggestions.length > 0 && (
                        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl max-h-60 overflow-y-auto custom-scrollbar">
                          {fundSuggestions.map((h) => (
                            <button
                              key={h.id}
                              type="button"
                              className="w-full text-left px-5 py-4 text-sm hover:bg-indigo-50 flex justify-between items-center border-b border-slate-50 last:border-0 transition-colors"
                              onClick={() => {
                                setOperationForm(prev => ({
                                  ...prev,
                                  fundName: h.fundName,
                                  fundCode: h.fundCode || '',
                                  sector: h.sector || ''
                                }));
                                setShowSuggestions(false);
                              }}
                            >
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-900">{h.fundName}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{h.fundCode}</span>
                              </div>
                              <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full font-bold uppercase tracking-wider">{h.sector || '未分类'}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">基金代码</label>
                      <input 
                        name="fundCode" 
                        value={operationForm.fundCode} 
                        onChange={handleOperationFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-mono" 
                        placeholder="005827" 
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">操作类型</label>
                      <select 
                        name="type" 
                        value={operationForm.type} 
                        onChange={handleOperationFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-bold bg-white"
                      >
                        <option value="buy">买入</option>
                        <option value="sell">卖出</option>
                        <option value="add">加仓</option>
                        <option value="reduce">减仓</option>
                        <option value="switch">转换</option>
                        <option value="observe">观察</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">金额 (¥)</label>
                      <input 
                        name="amount" 
                        type="number" 
                        step="0.01" 
                        value={operationForm.amount} 
                        onChange={handleOperationFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-bold" 
                        placeholder="0.00" 
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1.5 ml-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">份额</label>
                        <button 
                          type="button"
                          title="根据净值自动计算份额"
                          onClick={async () => {
                            const { fundCode, amount } = operationForm;
                            if (!fundCode || !amount) {
                              alert("请先输入基金代码和金额");
                              return;
                            }
                            setCalculatingSharesId('form-op');
                            try {
                              const nav = await fetchFundNAV(fundCode);
                              if (nav && nav > 0) {
                                const shares = (Number(amount) / nav).toFixed(2);
                                setOperationForm(prev => ({ ...prev, shares }));
                              } else {
                                alert("无法自动获取该基金的最新净值，请手动输入份额。");
                              }
                            } catch (e) {
                              console.error(e);
                              alert("获取净值失败，请检查网络或手动输入。");
                            } finally {
                              setCalculatingSharesId(null);
                            }
                          }}
                          disabled={calculatingSharesId === 'form-op'}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50 font-bold transition-colors bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100"
                        >
                          {calculatingSharesId === 'form-op' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />}
                          自动计算
                        </button>
                      </div>
                      <input 
                        name="shares" 
                        type="number" 
                        step="0.01" 
                        value={operationForm.shares} 
                        onChange={handleOperationFormChange}
                        className={cn(
                          "w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-medium",
                          calculatingSharesId === 'form-op-auto' && "ring-2 ring-indigo-500/50"
                        )} 
                        placeholder="0.00" 
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">当前收益率 (%)</label>
                      <input 
                        name="returnRate" 
                        type="number" 
                        step="0.01" 
                        value={operationForm.returnRate} 
                        onChange={handleOperationFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-bold" 
                        placeholder="0.00" 
                      />
                    </div>
                    <div className="col-span-2">
                      <div className="flex items-center justify-between mb-1.5 ml-1">
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest">板块/主题</label>
                        <button 
                          type="button"
                          title="联网验证板块归属"
                          onClick={async () => {
                            const { fundName, fundCode } = operationForm;
                            if (!fundName && !fundCode) {
                              alert("请先输入基金名称或代码");
                              return;
                            }
                            setVerifyingSectorId('form-op');
                            try {
                              const sector = await fetchFundSector(fundName, fundCode);
                              if (sector) {
                                setOperationForm(prev => ({ ...prev, sector }));
                              } else {
                                alert("无法自动识别该基金的板块，请手动输入。");
                              }
                            } catch (e) {
                              console.error(e);
                              alert("验证失败，请检查网络或手动输入。");
                            } finally {
                              setVerifyingSectorId(null);
                            }
                          }}
                          disabled={verifyingSectorId === 'form-op'}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-50 font-bold transition-colors bg-indigo-50 px-2 py-0.5 rounded-full border border-indigo-100"
                        >
                          {verifyingSectorId === 'form-op' ? <Loader2 className="w-3 h-3 animate-spin" /> : <BrainCircuit className="w-3 h-3" />}
                          联网验证
                        </button>
                      </div>
                      <input 
                        name="sector" 
                        value={operationForm.sector} 
                        onChange={handleOperationFormChange}
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-medium" 
                        placeholder="例如：半导体/国产替代" 
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">操作理由</label>
                      <textarea 
                        name="reason" 
                        value={operationForm.reason} 
                        onChange={handleOperationFormChange}
                        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all outline-none text-sm font-medium h-24 resize-none" 
                        placeholder="记录你的操作逻辑..." 
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 pt-4">
                    <Button type="submit" className="flex-1 py-6 rounded-xl shadow-lg shadow-indigo-200">保存记录</Button>
                    <Button type="button" variant="outline" onClick={() => { setIsAddingOperation(false); setEditingOperation(null); }} className="px-8 py-6 rounded-xl">取消</Button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      {/* Recap Detail Modal */}
      <AnimatePresence>
        {activeRecap && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveRecap(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full",
                    activeRecap.type === 'intraday' ? "bg-blue-50 text-blue-600" :
                    activeRecap.type === 'end-of-day' ? "bg-purple-50 text-purple-600" :
                    activeRecap.type === 'long-form' ? "bg-emerald-50 text-emerald-600" :
                    "bg-amber-50 text-amber-600"
                  )}>
                    {activeRecap.type === 'intraday' ? '盘中快评' : activeRecap.type === 'end-of-day' ? '收盘复盘' : activeRecap.type === 'long-form' ? '公众号' : '社媒'}
                  </span>
                  <h2 className="text-lg font-bold text-slate-900 line-clamp-1">{activeRecap.title}</h2>
                </div>
                <Button variant="ghost" onClick={() => setActiveRecap(null)} className="p-1">
                  <Plus className="w-6 h-6 rotate-45" />
                </Button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-p:text-slate-600 prose-strong:text-slate-900 prose-code:text-blue-600 prose-code:bg-blue-50 prose-code:px-1 prose-code:rounded">
                  <ReactMarkdown>{activeRecap.content}</ReactMarkdown>
                </div>
                
                {activeRecap.marketContext && (
                  <div className="mt-8 p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">原始资讯背景</h4>
                    <p className="text-sm text-slate-600 italic">{activeRecap.marketContext}</p>
                  </div>
                )}
              </div>
              
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="text-xs text-slate-400">
                  生成于 {activeRecap.createdAt instanceof Timestamp ? format(activeRecap.createdAt.toDate(), 'yyyy-MM-dd HH:mm') : ''}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="text-xs py-1.5" onClick={() => {
                    navigator.clipboard.writeText(activeRecap.content);
                    // Add toast here if needed
                  }}>
                    复制全文
                  </Button>
                  <Button variant="primary" className="text-xs py-1.5">
                    分享内容
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  );
}
