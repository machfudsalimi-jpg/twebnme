import React, { useState, useRef, useEffect, useCallback, Component, ErrorInfo, ReactNode } from 'react';
import { Stage, Layer, Image as KonvaImage, Transformer, Rect, Text as KonvaText } from 'react-konva';
import Konva from 'konva';
import useImage from 'use-image';
import { GoogleGenAI } from "@google/genai";
import { 
  Upload, 
  Download, 
  Trash2, 
  Shield, 
  Image as ImageIcon, 
  RefreshCw, 
  ChevronRight, 
  ChevronLeft,
  Settings,
  User,
  Plus,
  X,
  Maximize,
  Minimize,
  RotateCcw,
  LogOut,
  AlertCircle,
  Edit2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth } from './firebase';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp, 
  getDocFromServer,
  setDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';

// --- Types ---
interface Template {
  id: string;
  url: string;
  name: string;
  createdAt?: any;
}

interface TextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fill: string;
  fontFamily: string;
  stroke?: string;
  strokeWidth?: number;
  shadowEnabled?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// --- Error Handling ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; errorInfo: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Terjadi kesalahan pada aplikasi.";
      try {
        const parsed = JSON.parse(this.state.errorInfo || '');
        if (parsed.error && parsed.error.includes('insufficient permissions')) {
          displayMessage = "Anda tidak memiliki izin untuk melakukan aksi ini.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white p-8 rounded-[32px] shadow-xl max-w-md w-full text-center border border-red-100">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-black text-slate-800 mb-4">Waduh! Ada Masalah</h2>
            <p className="text-slate-500 text-sm mb-8 leading-relaxed">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-sm hover:bg-indigo-700 transition-all"
            >
              MUAT ULANG APLIKASI
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Playfair Display',
  'Space Grotesk',
  'JetBrains Mono',
  'Bebas Neue',
  'Pacifico',
  'Lobster',
  'Dancing Script',
  'Oswald',
  'Quicksand',
  'Kanit',
  'Poppins',
  'Fredoka One',
  'Abril Fatface',
  'Satisfy',
  'Great Vibes',
  'Alex Brush',
  'Cookie',
  'Anton',
  'Paytone One',
  'Titan One',
  'Luckiest Guy',
  'Passion One',
  'Patua One',
  'Righteous'
];

// --- Components ---

const TwibbonCanvas = ({ 
  userImageUrl, 
  templateUrl, 
  stageRef,
  onDownload,
  textOverlays,
  setTextOverlays,
  selectedTextId,
  setSelectedTextId
}: { 
  userImageUrl: string | null, 
  templateUrl: string | null, 
  stageRef: React.RefObject<any>,
  onDownload: (uri: string) => void,
  textOverlays: TextOverlay[],
  setTextOverlays: React.Dispatch<React.SetStateAction<TextOverlay[]>>,
  selectedTextId: string | null,
  setSelectedTextId: React.Dispatch<React.SetStateAction<string | null>>
}) => {
  const [uImg] = useImage(userImageUrl || '');
  const [tImg] = useImage(templateUrl || '');
  const [imageConfig, setImageConfig] = useState({
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  });
  const [filters, setFilters] = useState({
    brightness: 0,
    contrast: 0,
    grayscale: false,
  });
  
  const imageRef = useRef<any>(null);
  const trRef = useRef<any>(null);
  const textTrRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isSelected, setIsSelected] = useState(false);
  const [stageScale, setStageScale] = useState(1);
  const SIZE = 500;

  // Responsive scaling
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.offsetWidth;
        setStageScale(containerWidth / SIZE);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initial centering and scaling
  useEffect(() => {
    if (uImg) {
      const scale = Math.max(SIZE / uImg.width, SIZE / uImg.height);
      setImageConfig({
        x: (SIZE - uImg.width * scale) / 2,
        y: (SIZE - uImg.height * scale) / 2,
        scaleX: scale,
        scaleY: scale,
        rotation: 0,
      });
      setIsSelected(true);
    }
  }, [uImg]);

  // Apply filters
  useEffect(() => {
    if (imageRef.current) {
      imageRef.current.cache();
    }
  }, [uImg, filters]);

  // Transformer logic
  useEffect(() => {
    if (isSelected && trRef.current && imageRef.current) {
      trRef.current.nodes([imageRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  useEffect(() => {
    if (selectedTextId && textTrRef.current && stageRef.current) {
      const stage = stageRef.current;
      const textNode = stage.findOne('#' + selectedTextId);
      if (textNode) {
        textTrRef.current.nodes([textNode]);
        textTrRef.current.getLayer().batchDraw();
      }
    }
  }, [selectedTextId]);

  // Touch gesture state
  const lastDist = useRef(0);
  const lastCenter = useRef<{ x: number; y: number } | null>(null);

  const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  };

  const getCenter = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  };

  const handleTouchStart = (e: any) => {
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];
    if (touch1 && touch2) {
      const p1 = { x: touch1.clientX, y: touch1.clientY };
      const p2 = { x: touch2.clientX, y: touch2.clientY };
      lastDist.current = getDistance(p1, p2);
      lastCenter.current = getCenter(p1, p2);
    }
  };

  const handleTouchMove = (e: any) => {
    const touch1 = e.evt.touches[0];
    const touch2 = e.evt.touches[1];
    if (touch1 && touch2 && imageRef.current && stageRef.current) {
      if (imageRef.current.isDragging()) imageRef.current.stopDrag();
      const stage = stageRef.current;
      const p1 = { x: touch1.clientX, y: touch1.clientY };
      const p2 = { x: touch2.clientX, y: touch2.clientY };
      if (!lastCenter.current) {
        lastCenter.current = getCenter(p1, p2);
        lastDist.current = getDistance(p1, p2);
        return;
      }
      const newDist = getDistance(p1, p2);
      const newCenter = getCenter(p1, p2);
      const distRatio = newDist / lastDist.current;
      const stageBox = stage.container().getBoundingClientRect();
      const centerOnStage = { x: newCenter.x - stageBox.left, y: newCenter.y - stageBox.top };
      const dx = newCenter.x - lastCenter.current.x;
      const dy = newCenter.y - lastCenter.current.y;

      setImageConfig(prev => {
        const oldScale = prev.scaleX;
        const newScale = oldScale * distRatio;
        const newX = centerOnStage.x - (centerOnStage.x - prev.x) * (newScale / oldScale) + dx;
        const newY = centerOnStage.y - (centerOnStage.y - prev.y) * (newScale / oldScale) + dy;
        return { ...prev, scaleX: newScale, scaleY: newScale, x: newX, y: newY };
      });
      lastDist.current = newDist;
      lastCenter.current = newCenter;
    }
  };

  const handleTouchEnd = () => {
    lastDist.current = 0;
    lastCenter.current = null;
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = imageConfig.scaleX;
    const pointer = stage.getPointerPosition();
    const mousePointTo = { x: (pointer.x - imageConfig.x) / oldScale, y: (pointer.y - imageConfig.y) / oldScale };
    const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
    setImageConfig({
      ...imageConfig,
      scaleX: newScale,
      scaleY: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  return (
    <div ref={containerRef} className="relative bg-white rounded-[40px] overflow-hidden shadow-2xl border-8 border-white aspect-square w-full max-w-[500px] mx-auto group">
      <div style={{ transform: `scale(${stageScale})`, transformOrigin: 'top left', width: SIZE, height: SIZE }}>
        <Stage 
          width={SIZE} 
          height={SIZE} 
          ref={stageRef} 
          className="cursor-move"
          onMouseDown={(e) => {
            const clickedOnEmpty = e.target === e.target.getStage();
            if (clickedOnEmpty) setIsSelected(false);
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onWheel={handleWheel}
        >
          <Layer>
            <Rect width={SIZE} height={SIZE} fill="#ffffff" />
            {uImg && (
              <KonvaImage
                image={uImg}
                ref={imageRef}
                {...imageConfig}
                draggable
                onClick={() => {
                  setIsSelected(true);
                  setSelectedTextId(null);
                }}
                onTap={() => {
                  setIsSelected(true);
                  setSelectedTextId(null);
                }}
                onDragEnd={(e) => {
                  setImageConfig(prev => ({ ...prev, x: e.target.x(), y: e.target.y() }));
                }}
                onTransformEnd={() => {
                  const node = imageRef.current;
                  setImageConfig({
                    ...imageConfig,
                    x: node.x(),
                    y: node.y(),
                    scaleX: node.scaleX(),
                    scaleY: node.scaleY(),
                    rotation: node.rotation(),
                  });
                }}
                filters={[
                  Konva.Filters.Brighten, 
                  Konva.Filters.Contrast, 
                  ...(filters.grayscale ? [Konva.Filters.Grayscale] : [])
                ]}
                brightness={filters.brightness}
                contrast={filters.contrast}
              />
            )}
            {tImg && (
              <KonvaImage
                image={tImg}
                width={SIZE}
                height={SIZE}
                listening={false}
              />
            )}
            
            {textOverlays.map((text) => (
              <KonvaText
                key={text.id}
                id={text.id}
                text={text.text}
                x={text.x}
                y={text.y}
                fontSize={text.fontSize}
                fill={text.fill}
                fontFamily={text.fontFamily}
                stroke={text.stroke}
                strokeWidth={text.strokeWidth}
                shadowEnabled={text.shadowEnabled}
                shadowColor={text.shadowColor || '#000000'}
                shadowBlur={text.shadowBlur || 5}
                shadowOffset={{ x: text.shadowOffsetX || 2, y: text.shadowOffsetY || 2 }}
                shadowOpacity={text.shadowOpacity || 0.5}
                draggable
                onClick={() => {
                  setSelectedTextId(text.id);
                  setIsSelected(false);
                }}
                onTap={() => {
                  setSelectedTextId(text.id);
                  setIsSelected(false);
                }}
                onDragEnd={(e) => {
                  setTextOverlays(prev => prev.map(t => t.id === text.id ? { ...t, x: e.target.x(), y: e.target.y() } : t));
                }}
                onTransformEnd={(e) => {
                  const node = e.target;
                  setTextOverlays(prev => prev.map(t => t.id === text.id ? { 
                    ...t, 
                    x: node.x(), 
                    y: node.y(), 
                    fontSize: t.fontSize * node.scaleX() 
                  } : t));
                  node.scaleX(1);
                  node.scaleY(1);
                }}
              />
            ))}

            {isSelected && uImg && (
              <Transformer
                ref={trRef}
                rotateEnabled={true}
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                boundBoxFunc={(oldBox, newBox) => {
                  if (Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5) return oldBox;
                  return newBox;
                }}
              />
            )}
            
            {selectedTextId && (
              <Transformer
                ref={textTrRef}
                rotateEnabled={true}
                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              />
            )}
          </Layer>
        </Stage>
      </div>
      
      {!userImageUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50/50 backdrop-blur-[2px] text-slate-400 p-8 text-center pointer-events-none">
          <div className="w-20 h-20 bg-white rounded-3xl shadow-sm flex items-center justify-center mb-6 animate-pulse">
            <ImageIcon size={32} className="opacity-20" />
          </div>
          <h3 className="text-lg font-bold text-slate-600 mb-2">Belum Ada Foto</h3>
          <p className="text-sm text-slate-400 max-w-[200px]">Unggah foto Anda untuk mulai membuat Twibbon</p>
        </div>
      )}

      {/* Canvas Controls Overlay */}
      {userImageUrl && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 w-full px-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          {/* Sliders */}
          <div className="w-full bg-white/90 backdrop-blur-md p-4 rounded-3xl shadow-xl border border-white flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Minimize size={14} className="text-slate-400" />
              <input 
                type="range" 
                min="0.1" 
                max="5" 
                step="0.01" 
                value={imageConfig.scaleX} 
                onChange={(e) => {
                  const scale = parseFloat(e.target.value);
                  setImageConfig(prev => ({ ...prev, scaleX: scale, scaleY: scale }));
                }}
                className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <Maximize size={14} className="text-slate-400" />
            </div>
            <div className="flex items-center gap-3">
              <RotateCcw size={14} className="text-slate-400" />
              <input 
                type="range" 
                min="0" 
                max="360" 
                value={imageConfig.rotation} 
                onChange={(e) => {
                  setImageConfig(prev => ({ ...prev, rotation: parseInt(e.target.value) }));
                }}
                className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
            
            {/* Filter Sliders */}
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Brightness</label>
                <input 
                  type="range" 
                  min="-1" 
                  max="1" 
                  step="0.1" 
                  value={filters.brightness} 
                  onChange={(e) => setFilters(prev => ({ ...prev, brightness: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Contrast</label>
                <input 
                  type="range" 
                  min="-100" 
                  max="100" 
                  step="1" 
                  value={filters.contrast} 
                  onChange={(e) => setFilters(prev => ({ ...prev, contrast: parseFloat(e.target.value) }))}
                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={() => setFilters(prev => ({ ...prev, grayscale: !prev.grayscale }))}
              className={`p-3 rounded-2xl shadow-lg transition-all ${filters.grayscale ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              title="Toggle Grayscale"
            >
              <ImageIcon size={20} />
            </button>
            <button 
              onClick={() => setIsSelected(!isSelected)}
              className={`p-3 rounded-2xl shadow-lg transition-all ${isSelected ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              title="Toggle Edit Mode"
            >
              <Settings size={20} />
            </button>
            <button 
              onClick={() => {
                const scale = Math.max(SIZE / uImg.width, SIZE / uImg.height);
                setImageConfig({
                  x: (SIZE - uImg.width * scale) / 2,
                  y: (SIZE - uImg.height * scale) / 2,
                  scaleX: scale,
                  scaleY: scale,
                  rotation: 0,
                });
              }}
              className="p-3 bg-white text-slate-600 rounded-2xl shadow-lg hover:bg-slate-50 transition-all"
              title="Reset Position"
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <TwibbonApp />
    </ErrorBoundary>
  );
}

function TwibbonApp() {
  const [viewMode, setViewMode] = useState<'user' | 'admin'>('user');
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [userImage, setUserImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [isAdminUploading, setIsAdminUploading] = useState(false);
  const [logoClickCount, setLogoClickCount] = useState(0);
  const [hoveredTemplateId, setHoveredTemplateId] = useState<string | null>(null);
  
  const stageRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const adminFileInputRef = useRef<HTMLInputElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync
  useEffect(() => {
    const q = query(collection(db, 'templates'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedTemplates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Template[];
      setTemplates(fetchedTemplates);
      
      // If no template is selected, select the first one
      if (fetchedTemplates.length > 0 && !selectedTemplateId) {
        setSelectedTemplateId(fetchedTemplates[0].id);
      }
      
      // If the selected template is deleted, select the first available one or null
      if (selectedTemplateId && !fetchedTemplates.some(t => t.id === selectedTemplateId)) {
        setSelectedTemplateId(fetchedTemplates.length > 0 ? fetchedTemplates[0].id : null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'templates');
    });

    return () => unsubscribe();
  }, []);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();
  }, []);

  const handleUserPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setUserImage(url);
    }
  };

  const compressImage = (file: File, maxWidth = 600, maxHeight = 600): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          
          // We must use PNG to preserve transparency for Twibbons
          const dataUrl = canvas.toDataURL('image/png');
          resolve(dataUrl);
        };
        img.onerror = reject;
      };
      reader.onerror = reject;
    });
  };

  const handleAdminTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const filesToUpload = Array.from(files).slice(0, 4); // Limit to 4 files
      
      if (files.length > 4) {
        alert('Maksimal 4 file yang dapat diunggah sekaligus.');
      }

      setIsAdminUploading(true);
      try {
        for (const file of filesToUpload) {
          try {
            const compressedUrl = await compressImage(file);
            
            // Check size again after compression (1MB limit for Firestore)
            // We use 1,000,000 bytes to be safe with document overhead
            if (compressedUrl.length > 1000000) {
              alert(`Ukuran template ${file.name} masih terlalu besar (maksimal 1MB).`);
              continue;
            }

            await addDoc(collection(db, 'templates'), {
              id: Date.now().toString() + Math.random().toString(36).substring(7),
              url: compressedUrl,
              name: file.name.replace('.png', ''),
              createdAt: serverTimestamp()
            });
          } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            alert(`Gagal mengunggah ${file.name}: ${errorMsg}`);
            handleFirestoreError(error, OperationType.CREATE, 'templates');
          }
        }
      } finally {
        setIsAdminUploading(false);
        // Reset input
        e.target.value = '';
      }
    }
  };

  const handleDeleteTemplate = async (id: string) => {
    if (window.confirm('Hapus template ini?')) {
      try {
        await deleteDoc(doc(db, 'templates', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, 'templates');
      }
    }
  };

  const handleEditTemplateName = async (id: string, currentName: string) => {
    const newName = window.prompt('Ubah nama template:', currentName);
    if (newName && newName !== currentName) {
      try {
        await setDoc(doc(db, 'templates', id), { name: newName }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, 'templates');
      }
    }
  };

  const downloadTwibbon = () => {
    if (stageRef.current) {
      const uri = stageRef.current.toDataURL({ pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `twibbon-${Date.now()}.png`;
      link.href = uri;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const handleLogoClick = () => {
    setLogoClickCount(prev => prev + 1);
    if (logoClickCount + 1 >= 5) {
      handleGoogleLogin();
      setLogoClickCount(0);
    }
  };

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      setViewMode('admin');
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setViewMode('user');
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const isAdmin = currentUser?.email === 'machfudsalimi@gmail.com';

  const handleMagicSuggest = async () => {
    if (!userImage) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      // Convert image to base64
      const response = await fetch(userImage);
      const blob = await response.blob();
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      const base64Data = await base64Promise;

      const templateList = templates.map(t => `${t.id}: ${t.name}`).join('\n');
      
      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: `Analyze this photo and suggest the best Twibbon template from the following list. Return ONLY the ID of the template.\n\nTemplates:\n${templateList}` },
              { inlineData: { mimeType: "image/jpeg", data: base64Data } }
            ]
          }
        ]
      });

      const suggestedId = result.text?.trim();
      if (suggestedId && templates.some(t => t.id === suggestedId)) {
        setSelectedTemplateId(suggestedId);
      }
    } catch (error) {
      console.error("Magic Suggest Error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const addTextOverlay = () => {
    const newText: TextOverlay = {
      id: 'text-' + Date.now(),
      text: 'Klik untuk Edit',
      x: 150,
      y: 150,
      fontSize: 30,
      fill: '#000000',
      fontFamily: 'Inter',
      stroke: '#ffffff',
      strokeWidth: 0,
      shadowEnabled: false,
      shadowColor: '#000000',
      shadowBlur: 5,
      shadowOffsetX: 2,
      shadowOffsetY: 2,
      shadowOpacity: 0.5
    };
    setTextOverlays([...textOverlays, newText]);
    setSelectedTextId(newText.id);
  };

  const clearAll = () => {
    if (window.confirm('Hapus semua perubahan?')) {
      setUserImage(null);
      setTextOverlays([]);
      setSelectedTextId(null);
    }
  };

  const filteredTemplates = templates.filter(t => 
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);

  return (
    <div className="min-h-screen bg-[#F1F5F9] text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Navigation */}
      <nav className="bg-white/70 backdrop-blur-xl sticky top-0 z-50 border-b border-slate-200/50">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div 
              onClick={handleLogoClick}
              className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-200 rotate-3 hover:rotate-0 transition-transform duration-300 overflow-hidden border-2 border-indigo-600 cursor-pointer p-1.5 relative group"
            >
              <img 
                src="https://lh3.googleusercontent.com/d/1UmERmwhHbo4qprClQpqO5pULP12D6SJY" 
                alt="NME Logo" 
                className="w-full h-full object-contain transition-opacity duration-300"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.parentElement?.querySelector('.logo-fallback');
                  if (fallback) (fallback as HTMLElement).style.display = 'flex';
                }}
              />
              <div className="logo-fallback hidden absolute inset-0 items-center justify-center text-indigo-600">
                <ImageIcon size={24} />
              </div>
            </div>
            <div>
              <h1 className="font-black text-xl tracking-tight text-slate-800">Twibbon<span className="text-indigo-600">Studio</span></h1>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                <p className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-black">NME PROFESIONAL TOOLS</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && (
              <div className="flex items-center gap-4">
                <div className="flex bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/50">
                  <button 
                    onClick={() => setViewMode('user')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all duration-300 ${viewMode === 'user' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <User size={14} />
                    USER
                  </button>
                  <button 
                    onClick={() => setViewMode('admin')}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all duration-300 ${viewMode === 'admin' ? 'bg-white text-indigo-600 shadow-lg shadow-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    <Shield size={14} />
                    ADMIN
                  </button>
                </div>
                <button 
                  onClick={handleLogout}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                  title="Logout"
                >
                  <LogOut size={20} />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto p-6 lg:p-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          
          {/* Left: Canvas Area */}
          <div className="lg:col-span-7 space-y-8">
            <motion.div 
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <TwibbonCanvas 
                userImageUrl={userImage} 
                templateUrl={selectedTemplate?.url || null} 
                stageRef={stageRef}
                onDownload={downloadTwibbon}
                textOverlays={textOverlays}
                setTextOverlays={setTextOverlays}
                selectedTextId={selectedTextId}
                setSelectedTextId={setSelectedTextId}
              />
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="group flex items-center justify-center gap-3 px-8 py-4 bg-white border-2 border-slate-200 rounded-[24px] text-sm font-black text-slate-700 hover:border-indigo-600 hover:text-indigo-600 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-indigo-100 active:scale-95"
                >
                  <Upload size={20} className="group-hover:-translate-y-1 transition-transform" />
                  UNGGAH FOTO
                </button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleUserPhotoUpload} 
                  accept="image/*" 
                  className="hidden" 
                />

                <button 
                  onClick={addTextOverlay}
                  className="group flex items-center justify-center gap-3 px-8 py-4 bg-white border-2 border-slate-200 rounded-[24px] text-sm font-black text-slate-700 hover:border-indigo-600 hover:text-indigo-600 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-indigo-100 active:scale-95"
                >
                  <Plus size={20} />
                  TAMBAH TEKS
                </button>

                <button 
                  onClick={clearAll}
                  className="group flex items-center justify-center gap-3 px-8 py-4 bg-white border-2 border-slate-200 rounded-[24px] text-sm font-black text-red-500 hover:border-red-500 hover:bg-red-50 transition-all duration-300 shadow-sm active:scale-95"
                >
                  <Trash2 size={20} />
                  HAPUS SEMUA
                </button>

                <button 
                  onClick={downloadTwibbon}
                  disabled={!userImage || !selectedTemplateId}
                  className="group flex items-center justify-center gap-3 px-10 py-4 bg-indigo-600 text-white rounded-[24px] text-sm font-black hover:bg-indigo-700 transition-all duration-300 shadow-2xl shadow-indigo-200 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed active:scale-95"
                >
                  <Download size={20} className="group-hover:translate-y-1 transition-transform" />
                  UNDUH SEKARANG
                </button>

                {userImage && (
                  <button 
                    onClick={handleMagicSuggest}
                    disabled={isAnalyzing}
                    className="group flex items-center justify-center gap-3 px-8 py-4 bg-emerald-500 text-white rounded-[24px] text-sm font-black hover:bg-emerald-600 transition-all duration-300 shadow-2xl shadow-emerald-100 disabled:opacity-50 active:scale-95"
                  >
                    {isAnalyzing ? (
                      <RefreshCw size={20} className="animate-spin" />
                    ) : (
                      <Shield size={20} />
                    )}
                    SARAN AI
                  </button>
                )}
              </div>
            </motion.div>
          </div>

          {/* Right: Controls Area */}
          <div className="lg:col-span-5">
            <AnimatePresence mode="wait">
              {viewMode === 'user' ? (
                <motion.section 
                  key="user-view"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-[40px] p-10 shadow-xl shadow-slate-200/50 border border-white"
                >
                  <div className="flex flex-col gap-4 mb-8">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black text-slate-800 tracking-tight">Pilih Bingkai</h2>
                      <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                        {filteredTemplates.length} Tersedia
                      </span>
                    </div>
                    <div className="relative">
                      <input 
                        type="text"
                        placeholder="Cari bingkai..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-6 py-4 rounded-2xl bg-slate-50 border border-slate-100 text-sm outline-none focus:border-indigo-600 focus:bg-white transition-all"
                      />
                      <ImageIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                    {filteredTemplates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={`group relative aspect-square rounded-3xl overflow-hidden border-4 transition-all duration-500 ${
                          selectedTemplateId === template.id 
                          ? 'border-indigo-600 scale-95 shadow-2xl shadow-indigo-100' 
                          : 'border-slate-50 hover:border-slate-200 hover:scale-105'
                        }`}
                      >
                        <img 
                          src={template.url} 
                          alt={template.name} 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className={`absolute inset-0 bg-indigo-600/10 transition-opacity duration-300 ${selectedTemplateId === template.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                      </button>
                    ))}
                    {filteredTemplates.length === 0 && (
                      <div className="col-span-3 py-12 text-center">
                        <p className="text-sm text-slate-400 font-medium">Tidak ada bingkai yang cocok</p>
                      </div>
                    )}
                  </div>
                  
                  <div className="mt-10 p-6 bg-slate-50 rounded-[32px] border border-slate-100 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full -mr-12 -mt-12 group-hover:scale-150 transition-transform duration-700" />
                    
                    {selectedTextId ? (
                      <div className="space-y-4">
                        <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                          <Settings size={12} />
                          Edit Teks
                        </h4>
                        <input 
                          type="text"
                          value={textOverlays.find(t => t.id === selectedTextId)?.text || ''}
                          onChange={(e) => setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, text: e.target.value } : t))}
                          className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm outline-none focus:border-indigo-600"
                        />
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pilih Font</label>
                          <div className="relative group/select">
                            <select 
                              value={textOverlays.find(t => t.id === selectedTextId)?.fontFamily || 'Inter'}
                              onChange={(e) => setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, fontFamily: e.target.value } : t))}
                              className="w-full px-4 py-3 rounded-xl bg-white border border-slate-200 text-sm outline-none focus:border-indigo-600 appearance-none cursor-pointer pr-10 transition-all hover:border-slate-300"
                              style={{ fontFamily: textOverlays.find(t => t.id === selectedTextId)?.fontFamily || 'Inter' }}
                            >
                              {FONTS.map(font => (
                                <option key={font} value={font} style={{ fontFamily: font }}>{font}</option>
                              ))}
                            </select>
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover/select:text-indigo-600 transition-colors">
                              <ChevronRight size={14} className="rotate-90" />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Warna Teks</label>
                            <input 
                              type="color"
                              value={textOverlays.find(t => t.id === selectedTextId)?.fill || '#000000'}
                              onChange={(e) => setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, fill: e.target.value } : t))}
                              className="w-full h-10 rounded-xl overflow-hidden border-none cursor-pointer"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Garis Pinggir</label>
                            <input 
                              type="color"
                              value={textOverlays.find(t => t.id === selectedTextId)?.stroke || '#ffffff'}
                              onChange={(e) => setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, stroke: e.target.value } : t))}
                              className="w-full h-10 rounded-xl overflow-hidden border-none cursor-pointer"
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between items-center">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ketebalan Garis</label>
                            <span className="text-[10px] font-bold text-indigo-600">{textOverlays.find(t => t.id === selectedTextId)?.strokeWidth || 0}px</span>
                          </div>
                          <input 
                            type="range" 
                            min="0" 
                            max="10" 
                            step="0.5" 
                            value={textOverlays.find(t => t.id === selectedTextId)?.strokeWidth || 0} 
                            onChange={(e) => {
                              const width = parseFloat(e.target.value);
                              setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, strokeWidth: width } : t));
                            }}
                            className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                          />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                          <label className="text-xs font-bold text-slate-600">Bayangan Teks</label>
                          <button 
                            onClick={() => {
                              setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, shadowEnabled: !t.shadowEnabled } : t));
                            }}
                            className={`w-10 h-5 rounded-full transition-colors relative ${textOverlays.find(t => t.id === selectedTextId)?.shadowEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
                          >
                            <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${textOverlays.find(t => t.id === selectedTextId)?.shadowEnabled ? 'left-6' : 'left-1'}`} />
                          </button>
                        </div>

                        {textOverlays.find(t => t.id === selectedTextId)?.shadowEnabled && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="space-y-4 pt-2"
                          >
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Warna Bayangan</label>
                                <input 
                                  type="color"
                                  value={textOverlays.find(t => t.id === selectedTextId)?.shadowColor || '#000000'}
                                  onChange={(e) => setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, shadowColor: e.target.value } : t))}
                                  className="w-full h-10 rounded-xl overflow-hidden border-none cursor-pointer"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Blur</label>
                                <input 
                                  type="range" 
                                  min="0" 
                                  max="20" 
                                  step="1" 
                                  value={textOverlays.find(t => t.id === selectedTextId)?.shadowBlur || 5} 
                                  onChange={(e) => {
                                    const blur = parseFloat(e.target.value);
                                    setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, shadowBlur: blur } : t));
                                  }}
                                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Opasitas Bayangan</label>
                                <span className="text-[10px] font-bold text-indigo-600">{Math.round((textOverlays.find(t => t.id === selectedTextId)?.shadowOpacity || 0.5) * 100)}%</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.1" 
                                value={textOverlays.find(t => t.id === selectedTextId)?.shadowOpacity || 0.5} 
                                onChange={(e) => {
                                  const opacity = parseFloat(e.target.value);
                                  setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, shadowOpacity: opacity } : t));
                                }}
                                className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Offset X</label>
                                <input 
                                  type="range" 
                                  min="-20" 
                                  max="20" 
                                  step="1" 
                                  value={textOverlays.find(t => t.id === selectedTextId)?.shadowOffsetX || 2} 
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, shadowOffsetX: val } : t));
                                  }}
                                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Offset Y</label>
                                <input 
                                  type="range" 
                                  min="-20" 
                                  max="20" 
                                  step="1" 
                                  value={textOverlays.find(t => t.id === selectedTextId)?.shadowOffsetY || 2} 
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setTextOverlays(prev => prev.map(t => t.id === selectedTextId ? { ...t, shadowOffsetY: val } : t));
                                  }}
                                  className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                />
                              </div>
                            </div>
                          </motion.div>
                        )}

                        <button 
                          onClick={() => {
                            setTextOverlays(prev => prev.filter(t => t.id !== selectedTextId));
                            setSelectedTextId(null);
                          }}
                          className="w-full py-3 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                        >
                          <Trash2 size={14} />
                          Hapus Teks
                        </button>
                      </div>
                    ) : (
                      <>
                        <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                          <Settings size={12} />
                          Tips Penggunaan
                        </h4>
                        <ul className="space-y-2">
                          <li className="text-xs text-slate-500 flex gap-2">
                            <span className="text-indigo-400 font-bold">•</span>
                            Geser foto untuk mengatur posisi
                          </li>
                          <li className="text-xs text-slate-500 flex gap-2">
                            <span className="text-indigo-400 font-bold">•</span>
                            Klik teks untuk mengedit isinya
                          </li>
                          <li className="text-xs text-slate-500 flex gap-2">
                            <span className="text-indigo-400 font-bold">•</span>
                            Gunakan scroll mouse untuk zoom
                          </li>
                        </ul>
                      </>
                    )}
                  </div>
                </motion.section>
              ) : (
                <motion.section 
                  key="admin-view"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="bg-white rounded-[40px] p-10 shadow-xl shadow-indigo-100/50 border-2 border-indigo-50"
                >
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-2xl font-black text-slate-800 tracking-tight">Koleksi Bingkai</h2>
                      <p className="text-xs text-slate-400 font-medium mt-1">Kelola aset PNG transparan Anda</p>
                      <p className="text-[10px] text-indigo-400 font-bold mt-2 uppercase tracking-wider">Admin: {currentUser?.email}</p>
                    </div>
                    <button 
                      onClick={() => adminFileInputRef.current?.click()}
                      disabled={isAdminUploading}
                      className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center hover:bg-indigo-700 transition-all duration-300 shadow-xl shadow-indigo-200 active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAdminUploading ? <RefreshCw size={24} className="animate-spin" /> : <Plus size={24} />}
                    </button>
                    <input 
                      type="file" 
                      ref={adminFileInputRef} 
                      onChange={handleAdminTemplateUpload} 
                      accept="image/png" 
                      multiple
                      className="hidden" 
                    />
                  </div>

                  <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar relative">
                    {templates.map((template) => (
                      <div 
                        key={template.id} 
                        onMouseEnter={() => setHoveredTemplateId(template.id)}
                        onMouseLeave={() => setHoveredTemplateId(null)}
                        className="group flex items-center gap-4 p-4 bg-slate-50 rounded-3xl border border-slate-100 hover:border-indigo-200 hover:bg-white transition-all duration-300 relative"
                      >
                        <div className="w-16 h-16 rounded-2xl overflow-hidden bg-white border border-slate-100 shadow-sm">
                          <img src={template.url} className="w-full h-full object-cover" alt="" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-slate-700 truncate">{template.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1 tracking-wider">PNG ASSET</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => handleEditTemplateName(template.id, template.name)}
                            className="w-10 h-10 flex items-center justify-center text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all duration-300"
                            title="Ubah Nama"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button 
                            onClick={() => handleDeleteTemplate(template.id)}
                            className="w-10 h-10 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all duration-300"
                            title="Hapus"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                    
                    {templates.length === 0 && (
                      <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-[32px]">
                        <ImageIcon size={40} className="mx-auto text-slate-200 mb-4" />
                        <p className="text-sm text-slate-400 font-medium">Belum ada template</p>
                      </div>
                    )}
                  </div>

                  {/* Hover Preview - Outside scrollable area */}
                  <AnimatePresence>
                    {hoveredTemplateId && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8, x: 20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.8, x: 20 }}
                        className="absolute z-[100] pointer-events-none hidden xl:block"
                        style={{
                          left: 'calc(100% + 40px)',
                          top: '0',
                        }}
                      >
                        <div className="bg-white p-6 rounded-[48px] shadow-2xl border-8 border-white w-80 h-80 overflow-hidden flex items-center justify-center">
                          <img 
                            src={templates.find(t => t.id === hoveredTemplateId)?.url} 
                            className="max-w-full max-h-full object-contain" 
                            alt="Preview" 
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.section>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E2E8F0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #CBD5E1;
        }
      `}</style>
    </div>
  );
}
