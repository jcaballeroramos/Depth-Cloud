import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Loader2, Play, Wand2, Layers, Image as ImageIcon, Sliders, Maximize2, X, RefreshCcw, Palette, Key, Eye, EyeOff, Download, FileJson, ImageIcon as ImageIconLucide, Move3d, RotateCw, Box, Zap, Code, BrainCircuit } from 'lucide-react';
import PointCloudViewer from './components/PointCloudViewer';
import VoxelViewer from './components/VoxelViewer';
import HandController, { HandControllerHandle } from './components/HandController';
import { generateDepthMap, generateVoxelScene } from './services/geminiService';
import { loadImage, resizeImage, generatePointCloudFromImages, applyColorMap } from './utils/imageProcessing';
import { ProcessedPointCloud, HandGestures, ViewMode } from './types';

// Add type definition for the AI Studio window object by augmenting the expected interface
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }
}

function App() {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [depthImage, setDepthImage] = useState<string | null>(null);
  const [displayDepthImage, setDisplayDepthImage] = useState<string | null>(null); // For UI Visualization
  const [pointCloudData, setPointCloudData] = useState<ProcessedPointCloud | null>(null);
  const [showDepthOverlay, setShowDepthOverlay] = useState(false);
  
  // Generative Scene State
  const [voxelSceneHtml, setVoxelSceneHtml] = useState<string | null>(null);
  const [isGeneratingScene, setIsGeneratingScene] = useState(false);
  const [sceneThought, setSceneThought] = useState<string>("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessing3D, setIsProcessing3D] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);

  // Mode Selection
  const [viewMode, setViewMode] = useState<ViewMode>('points');

  // Visual settings
  const [pointSize, setPointSize] = useState<number>(0.05); // Default smaller
  const [samplingDensity, setSamplingDensity] = useState<number>(0.5); // Default to 50%
  const [voxelResolution, setVoxelResolution] = useState<number>(64); // Reduced to 64 for safety

  const [showBackground, setShowBackground] = useState<boolean>(false);
  const [depthExaggeration, setDepthExaggeration] = useState<number>(1.0);
  const [autoRotate, setAutoRotate] = useState<boolean>(false);
  
  // Depth Visualization Settings
  const [depthContrast, setDepthContrast] = useState<number>(1.0);
  const [depthIntensity, setDepthIntensity] = useState<number>(1.0);
  const [colorizeDepth, setColorizeDepth] = useState<boolean>(false);

  // Reset Trigger
  const [resetTrigger, setResetTrigger] = useState<number>(0);
  
  // API Key State
  const [isApiKeyReady, setIsApiKeyReady] = useState<boolean>(false);
  const [manualApiKey, setManualApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState<boolean>(false);

  const gestureRef = useRef<HandGestures>({
    rotation: { x: 0, y: 0 },
    scale: 1,
    isTracking: false,
    isExploding: false,
  });
  
  const handControllerRef = useRef<HandControllerHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null); // Reference to Gen Scene iframe

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            setIsApiKeyReady(hasKey);
        } else {
            setIsApiKeyReady(true);
        }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
      if (window.aistudio) {
          await window.aistudio.openSelectKey();
          setIsApiKeyReady(true);
      }
  };

  const handleHandUpdate = useCallback((gestures: HandGestures) => {
    gestureRef.current = gestures;

    // Send Gestures to IFrame if in Scene Mode
    if (viewMode === 'scene' && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
            type: 'gesture',
            data: gestures
        }, '*');
    }

  }, [viewMode]);

  const handleResetView = () => {
     setResetTrigger(prev => prev + 1);
     setDepthExaggeration(1.0);
     if (handControllerRef.current) {
         handControllerRef.current.reset();
     }
     gestureRef.current = {
        rotation: { x: 0, y: 0 },
        scale: 1.2,
        isTracking: false,
        isExploding: false,
     };
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setOriginalImage(event.target.result as string);
          setDepthImage(null);
          setDisplayDepthImage(null);
          setPointCloudData(null);
          setVoxelSceneHtml(null); // Reset scene
          setStatusMessage("Image loaded.");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleImportClick = () => {
      fileInputRef.current?.click();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
          try {
              const content = event.target?.result as string;
              const data = JSON.parse(content);

              if (data.originalImage && data.depthImage) {
                  setStatusMessage("Importing cloud...");
                  setIsProcessing3D(true);
                  
                  setOriginalImage(data.originalImage);
                  setDepthImage(data.depthImage);

                  // Restore View Mode if present
                  if (data.settings && data.settings.viewMode) {
                      setViewMode(data.settings.viewMode);
                  }
                  
                  // Rebuild point cloud immediately
                  await build3DModel(data.originalImage, data.depthImage);
                  
                  setStatusMessage("Cloud imported successfully.");
              } else {
                  throw new Error("Invalid file format");
              }
          } catch (err) {
              console.error(err);
              setStatusMessage("Error importing file.");
              setIsProcessing3D(false);
          }
      };
      reader.readAsText(file);
  };

  const handleExport = () => {
      if (viewMode === 'scene') {
          if (!voxelSceneHtml) return;
          const blob = new Blob([voxelSceneHtml], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `voxel-scene-${Date.now()}.html`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          return;
      }

      if (!originalImage || !depthImage) return;

      const data = {
          originalImage,
          depthImage,
          createdAt: new Date().toISOString(),
          settings: { pointSize, samplingDensity, viewMode }
      };

      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `depth-cloud-${Date.now()}.artefacto`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  // Update Display Depth Image when settings change
  useEffect(() => {
     if (!depthImage) return;
     
     const updateDisplay = async () => {
         const img = await loadImage(depthImage);
         const canvas = resizeImage(img, 512); 
         
         const tempImg = new Image();
         tempImg.src = canvas.toDataURL();
         tempImg.onload = () => {
             const newSrc = applyColorMap(tempImg, depthContrast, depthIntensity, colorizeDepth);
             setDisplayDepthImage(newSrc);
         };
     };
     updateDisplay();
  }, [depthImage, depthContrast, depthIntensity, colorizeDepth]);

  const processGeneration = async () => {
    if (!originalImage) return;

    const hasKey = manualApiKey || process.env.API_KEY || (window.aistudio && await window.aistudio.hasSelectedApiKey());
    if (!hasKey) {
        setStatusMessage("Missing API Key");
        setShowApiKey(true);
        if (window.aistudio) setIsApiKeyReady(false);
        return;
    }

    setProgress(5);
    const progressInterval = setInterval(() => {
        setProgress(prev => {
            if (prev >= 85) return prev;
            const increment = prev < 50 ? 5 : prev < 70 ? 2 : 0.5;
            return prev + Math.random() * increment;
        });
    }, 400);

    try {
      setIsGenerating(true);
      const hasManualKey = !!manualApiKey && manualApiKey.trim().length > 0;
      const depthModelName = hasManualKey ? 'Gemini 3 Pro Image' : 'Gemini 2.0 Flash';
      setStatusMessage(`Generating depth with ${depthModelName}...`); 
      
      const base64Data = originalImage.split(',')[1];
      const depthResult = await generateDepthMap(base64Data, manualApiKey);
      
      if (!depthResult || !depthResult.imageBase64) throw new Error("Failed to generate depth map");

      setProgress(90);
      setStatusMessage(`Depth ready (${depthResult.modelUsed}). ${viewMode === 'points' ? "Building cloud..." : "Voxelizing..."}`);

      const fullDepthSrc = `data:image/png;base64,${depthResult.imageBase64}`;
      setDepthImage(fullDepthSrc);
      
      await build3DModel(originalImage, fullDepthSrc);
      
      setProgress(100);
      setStatusMessage(`Generated with ${depthResult.modelUsed}`);
      
    } catch (error: any) {
      console.error(error);
      const errMsg = error.toString();
      
      if (errMsg.includes("403") || errMsg.includes("PERMISSION_DENIED")) {
         setStatusMessage("Access Denied. Check API Key.");
         if (window.aistudio) setIsApiKeyReady(false);
      } else {
         setStatusMessage("Error: " + (error instanceof Error ? error.message : "Unknown error"));
      }
      setProgress(0); 
    } finally {
      clearInterval(progressInterval);
      setIsGenerating(false);
    }
  };

  const processSceneGeneration = async () => {
     if (!originalImage) return;

     const hasKey = manualApiKey || process.env.API_KEY || (window.aistudio && await window.aistudio.hasSelectedApiKey());
     if (!hasKey) {
         setStatusMessage("Missing API Key");
         setShowApiKey(true);
         if (window.aistudio) setIsApiKeyReady(false);
         return;
     }
     
     setIsGeneratingScene(true);
     const hasManualKey = !!manualApiKey && manualApiKey.trim().length > 0;
     const sceneModelName = hasManualKey ? 'Gemini 3 Pro' : 'Gemini 2.5 Flash';
     setStatusMessage(`Generating scene with ${sceneModelName}...`); 
     setSceneThought(`Using ${sceneModelName} to create voxel art...`);
     setVoxelSceneHtml(null);
     
     try {
         const { html, modelUsed } = await generateVoxelScene(originalImage, manualApiKey, (thought) => {
             const cleanThought = thought.replace(/\*\*/g, '').replace(/###/g, '').trim();
             setSceneThought(cleanThought);
         });
         setVoxelSceneHtml(html);
         setStatusMessage(`Scene generated with ${modelUsed}`);
     } catch (error: any) {
        console.error(error);
        setStatusMessage("Scene generation failed.");
        const errMsg = error.toString();
        if (errMsg.includes("403") || errMsg.includes("PERMISSION_DENIED")) {
             if (window.aistudio) setIsApiKeyReady(false);
        }
     } finally {
         setIsGeneratingScene(false);
         setSceneThought("");
     }
  };

  // Generalized Builder that respects View Mode
  const build3DModel = async (colorSrc: string, depthSrc: string) => {
    setIsProcessing3D(true);
    try {
      const [colorImg, depthImg] = await Promise.all([
        loadImage(colorSrc),
        loadImage(depthSrc)
      ]);

      const targetRes = viewMode === 'voxels' ? voxelResolution : 1024;
      const density = viewMode === 'voxels' ? 1.0 : samplingDensity; 

      const colorCanvas = resizeImage(colorImg, targetRes);
      const depthCanvas = resizeImage(depthImg, targetRes);

      const cloud = generatePointCloudFromImages(colorCanvas, depthCanvas, density, viewMode === 'voxels');
      setPointCloudData(cloud);
      setStatusMessage(`Ready (${(cloud.count / 1000).toFixed(0)}k ${viewMode === 'voxels' ? 'voxels' : 'points'}).`);
    } catch (error) {
       console.error("3D Build Error", error);
       setStatusMessage("Error building model.");
    } finally {
      setIsProcessing3D(false);
    }
  };

  // When Mode changes, re-build logic is needed if data exists
  const switchMode = (mode: ViewMode) => {
      setViewMode(mode);
      if (mode === 'scene') return; 

      if (originalImage && depthImage) {
           // Wait a tick for state to update
      }
  };

  useEffect(() => {
      if (viewMode === 'scene') return;
      if (originalImage && depthImage) {
           const timer = setTimeout(() => {
               build3DModel(originalImage, depthImage);
           }, 50);
           return () => clearTimeout(timer);
      }
  }, [viewMode, voxelResolution]); 

  const commitDensityChange = () => {
    if (originalImage && depthImage && viewMode === 'points') {
        build3DModel(originalImage, depthImage);
    }
  };

  // ----------------------------------------------------------------------
  // RENDER: API Key Selection Screen 
  // ----------------------------------------------------------------------
  if (!isApiKeyReady && window.aistudio) {
    return (
        <div className="flex h-screen w-full bg-zinc-950 items-center justify-center text-zinc-100 font-sans p-4 selection:bg-blue-500/30">
            <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 p-8 rounded-2xl shadow-2xl text-center relative overflow-hidden group">
                <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
                <div className="relative z-10">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-blue-500/20">
                        <Key className="text-blue-500" size={32} />
                    </div>
                    <h2 className="text-2xl font-bold mb-3 tracking-tight text-white">API Key Required</h2>
                    <p className="text-zinc-400 mb-8 leading-relaxed text-sm">
                        To generate high-fidelity 3D depth maps, you must select a valid API key.
                    </p>
                    <button 
                        onClick={handleSelectKey}
                        className="w-full py-3 bg-white text-black font-semibold rounded-lg hover:bg-zinc-200 transition-colors flex items-center justify-center gap-2 shadow-lg hover:shadow-white/10"
                    >
                        Select API Key
                    </button>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-zinc-950 text-zinc-100 font-sans selection:bg-blue-500/30">
      
      {/* Hidden Import Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleImportFile} 
        accept=".artefacto,.json" 
        className="hidden" 
      />

      {/* Left Sidebar */}
      <div className="w-80 flex flex-col border-r border-zinc-800 bg-zinc-900/80 backdrop-blur-md z-20 shadow-2xl relative">
        <div className="px-6 py-5 border-b border-white/5">
          <h1 className="text-lg font-medium tracking-tight text-white flex items-center gap-2">
            <Layers size={18} className="text-blue-500" />
            Artefacto DepthCloud
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 scrollbar-hide">
          
          {/* 1. Upload Section & Import */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Source
              </label>
              <div className="flex gap-2">
                 <button 
                    onClick={handleImportClick}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                 >
                    <FileJson size={10} /> Import Cloud
                 </button>
                 {originalImage && (
                    <button 
                        onClick={() => { setOriginalImage(null); setDepthImage(null); setPointCloudData(null); setVoxelSceneHtml(null); }}
                        className="text-[10px] text-zinc-500 hover:text-white transition-colors"
                    >
                        Clear
                    </button>
                 )}
              </div>
            </div>

            <div className="relative group cursor-pointer transition-all duration-300">
              <div className={`
                overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800/50 
                ${!originalImage ? 'h-32 hover:border-zinc-500 hover:bg-zinc-800' : 'h-40 border-transparent'}
                flex flex-col items-center justify-center transition-all
              `}>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleImageUpload} 
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                
                {originalImage ? (
                  <>
                    <img src={originalImage} alt="Source" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-xs font-medium text-white bg-black/50 px-3 py-1 rounded-full backdrop-blur">Change Image</span>
                    </div>
                  </>
                ) : (
                  <div className="text-center p-4">
                    <ImageIcon className="mx-auto mb-2 text-zinc-500 group-hover:text-zinc-300 transition-colors" size={20} />
                    <span className="text-xs text-zinc-500 group-hover:text-zinc-300 font-medium">Open Image</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 2. MODE SWITCHER */}
          <div className="bg-zinc-900 p-1 rounded-lg flex gap-1 border border-zinc-800">
            <button
                onClick={() => switchMode('points')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-semibold transition-all
                    ${viewMode === 'points' 
                        ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' 
                        : 'text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800/50'}
                `}
            >
                <Zap size={12} className={viewMode === 'points' ? "text-blue-500" : ""} /> Cloud
            </button>
            <button
                onClick={() => switchMode('voxels')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-semibold transition-all
                    ${viewMode === 'voxels' 
                        ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' 
                        : 'text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800/50'}
                `}
            >
                <Box size={12} className={viewMode === 'voxels' ? "text-purple-500" : ""} /> Voxel
            </button>
            <button
                onClick={() => switchMode('scene')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-[10px] font-semibold transition-all
                    ${viewMode === 'scene' 
                        ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700' 
                        : 'text-zinc-500 hover:text-zinc-400 hover:bg-zinc-800/50'}
                `}
            >
                <Code size={12} className={viewMode === 'scene' ? "text-amber-500" : ""} /> Gen
            </button>
          </div>

          {/* 3. Generation Control */}
          <div className="space-y-2">
            {viewMode === 'scene' ? (
                 <button
                    onClick={processSceneGeneration}
                    disabled={!originalImage || isGeneratingScene}
                    className={`
                        w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all duration-300
                        ${!originalImage 
                        ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' 
                        : isGeneratingScene 
                            ? 'bg-zinc-800 text-zinc-300 cursor-wait'
                            : 'bg-white text-black hover:bg-amber-50 shadow-lg shadow-white/5 hover:scale-[1.02] active:scale-[0.98]'
                        }
                    `}
                >
                    {isGeneratingScene ? (
                    <Loader2 className="animate-spin" size={14} />
                    ) : (
                        <> <BrainCircuit size={14} /> Generate Scene </>
                    )}
                </button>
            ) : (
                <button
                    onClick={processGeneration}
                    disabled={!originalImage || isGenerating || !!pointCloudData}
                    className={`
                        w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all duration-300
                        ${!originalImage 
                        ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' 
                        : isGenerating 
                            ? 'bg-zinc-800 text-zinc-300 cursor-wait'
                            : !!pointCloudData
                                ? 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                                : 'bg-white text-black hover:bg-blue-50 shadow-lg shadow-white/5 hover:scale-[1.02] active:scale-[0.98]'
                        }
                    `}
                >
                    {isGenerating ? (
                    <Loader2 className="animate-spin" size={14} />
                    ) : !!pointCloudData ? (
                        <> <Layers size={14} /> Generated </>
                    ) : (
                        <> <Wand2 size={14} /> Generate Cloud </>
                    )}
                </button>
            )}

            {/* Export Button */}
            {(pointCloudData || (viewMode === 'scene' && voxelSceneHtml)) && !isGeneratingScene && (
                <button
                    onClick={handleExport}
                    className="w-full py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 flex items-center justify-center gap-2 transition-colors"
                >
                    <Download size={12} /> {viewMode === 'scene' ? 'Export HTML Scene' : 'Export Artefacto Cloud'}
                </button>
            )}
          </div>

          {/* 4. Visual Adjustments */}
          {viewMode !== 'scene' && (
              <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="flex items-center gap-2">
                    <Sliders size={14} className="text-zinc-400"/>
                    <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Visualization ({viewMode === 'points' ? 'Points' : 'Voxels'})
                    </label>
                </div>

                <div className="space-y-3">
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setShowBackground(!showBackground)}
                            className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border transition-colors group
                                ${showBackground ? 'bg-blue-500/20 border-blue-500/50 text-blue-300' : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:bg-zinc-800'}
                            `}
                        >
                            <ImageIconLucide size={14} />
                            <span className="text-[10px]">Backdrop</span>
                        </button>
                        <button 
                            onClick={() => setAutoRotate(!autoRotate)}
                            className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border transition-colors group
                                ${autoRotate ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:bg-zinc-800'}
                            `}
                        >
                            <RotateCw size={14} className={autoRotate ? "animate-spin" : ""} />
                            <span className="text-[10px]">Auto Spin</span>
                        </button>
                    </div>

                    <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-zinc-400">
                            <span>Depth Scale (Z)</span>
                            <span>{depthExaggeration.toFixed(1)}x</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <Move3d size={12} className="text-zinc-500" />
                            <input 
                                type="range" min="0.1" max="3.0" step="0.1" value={depthExaggeration}
                                onChange={(e) => setDepthExaggeration(parseFloat(e.target.value))}
                                className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400"
                            />
                        </div>
                    </div>

                    {/* Conditional Controls based on Mode */}
                    {viewMode === 'points' ? (
                        <>
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-zinc-400">
                                    <span>Point Size</span>
                                    <span>{pointSize.toFixed(2)}</span>
                                </div>
                                <input 
                                    type="range" min="0.01" max="1.0" step="0.01" value={pointSize}
                                    onChange={(e) => setPointSize(parseFloat(e.target.value))}
                                    className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between text-[10px] text-zinc-400">
                                    <span>Density</span>
                                    <span>{(samplingDensity * 100).toFixed(0)}%</span>
                                </div>
                                <input 
                                    type="range" min="0.1" max="1.0" step="0.05" value={samplingDensity}
                                    onChange={(e) => setSamplingDensity(parseFloat(e.target.value))}
                                    onMouseUp={commitDensityChange}
                                    onTouchEnd={commitDensityChange}
                                    disabled={!pointCloudData}
                                    className={`w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 disabled:opacity-50`}
                                />
                            </div>
                        </>
                    ) : (
                        // VOXEL SETTINGS
                        <div className="space-y-1">
                            <div className="flex justify-between text-[10px] text-zinc-400">
                                <span>Voxel Resolution</span>
                                <span>{voxelResolution} px</span>
                            </div>
                            <input 
                                type="range" min="32" max="150" step="2" value={voxelResolution}
                                onChange={(e) => setVoxelResolution(parseInt(e.target.value))}
                                disabled={!pointCloudData}
                                className={`w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400 disabled:opacity-50`}
                            />
                            <p className="text-[9px] text-zinc-500">Higher resolution = smaller cubes</p>
                        </div>
                    )}

                </div>
              </div>
          )}

          {viewMode === 'scene' && sceneThought && (
             <div className="mt-4 p-3 bg-zinc-900/50 rounded-lg border border-amber-500/20 animate-in fade-in">
                 <div className="flex items-center gap-2 text-amber-500 mb-2">
                     <BrainCircuit size={14} className="animate-pulse" />
                     <span className="text-[10px] font-semibold uppercase tracking-wider">Gemini Thinking</span>
                 </div>
                 <div className="text-[10px] text-zinc-400 font-mono leading-relaxed h-32 overflow-y-auto scrollbar-thin whitespace-pre-wrap">
                     {sceneThought}
                 </div>
             </div>
          )}
          
           {/* Depth Preview Section */}
           {depthImage && viewMode !== 'scene' && (
            <div className="space-y-3 pt-4 border-t border-white/5 animate-in fade-in slide-in-from-left-2">
                <div className="flex justify-between items-center">
                     <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
                       <Layers size={12} /> Depth Map
                     </label>
                     <button 
                        onClick={() => setShowDepthOverlay(true)}
                        className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                     >
                        <Maximize2 size={10} /> Expand
                     </button>
                </div>

                {/* Depth Controls */}
                <div className="space-y-2 mb-2">
                    <div className="grid grid-cols-2 gap-2">
                         <button 
                            onClick={() => setColorizeDepth(!colorizeDepth)}
                            className={`flex items-center justify-center gap-1.5 text-[10px] py-1.5 rounded border transition-all
                                ${colorizeDepth ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50' : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'}
                            `}
                         >
                            <Palette size={10} /> Colorize
                         </button>
                         <div className="flex items-center gap-2 px-2 bg-zinc-800 rounded border border-zinc-700">
                             <span className="text-[10px] text-zinc-500">Contrast</span>
                             <input 
                                type="range" min="0.5" max="3.0" step="0.1"
                                value={depthContrast}
                                onChange={(e) => setDepthContrast(parseFloat(e.target.value))}
                                className="w-full h-1 bg-zinc-600 rounded-full appearance-none cursor-pointer"
                             />
                         </div>
                    </div>
                    {/* Intensity Slider */}
                     <div className="flex items-center gap-2 px-2 py-1 bg-zinc-800 rounded border border-zinc-700">
                         <span className="text-[10px] text-zinc-500 w-12">Intensity</span>
                         <input 
                            type="range" min="0.5" max="2.0" step="0.1"
                            value={depthIntensity}
                            onChange={(e) => setDepthIntensity(parseFloat(e.target.value))}
                            className="w-full h-1 bg-zinc-600 rounded-full appearance-none cursor-pointer accent-blue-500"
                         />
                     </div>
                </div>

                <div 
                    className="h-32 rounded-lg border border-zinc-700/50 overflow-hidden bg-black/50 hover:border-zinc-500/50 transition-colors cursor-pointer relative shadow-inner"
                    onClick={() => setShowDepthOverlay(true)}
                >
                    {displayDepthImage ? (
                        <img src={displayDepthImage} alt="Depth" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <Loader2 className="animate-spin text-zinc-600" size={16} />
                        </div>
                    )}
                </div>
            </div>
          )}

          {/* 4. Hand Control Preview */}
          <div className="space-y-3 pt-4 border-t border-white/5">
            <div className="flex justify-between items-end">
                <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Gesture Control
                </label>
                <span className="text-[10px] text-zinc-600">MediaPipe</span>
            </div>
            
            <HandController ref={handControllerRef} onUpdate={handleHandUpdate} />
          </div>

          {/* 5. Manual API Key (Discrete) */}
          <div className="pt-4 border-t border-white/5 mt-auto">
             <div className="group">
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setShowApiKey(!showApiKey)}>
                     <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2 group-hover:text-zinc-300 transition-colors">
                        <Key size={10} /> API Configuration
                     </label>
                     <div className="text-zinc-600 group-hover:text-zinc-400">
                        {showApiKey ? <EyeOff size={10} /> : <Eye size={10} />}
                     </div>
                </div>
                
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showApiKey ? 'max-h-20 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                    <input 
                        type="password"
                        value={manualApiKey}
                        onChange={(e) => setManualApiKey(e.target.value)}
                        placeholder="Paste Gemini API Key..."
                        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] text-zinc-300 placeholder:text-zinc-700 focus:border-blue-500/50 focus:outline-none transition-colors font-mono"
                    />
                </div>
             </div>
          </div>

        </div>

        {/* Status Bar */}
        <div className="p-3 bg-zinc-950/50 border-t border-white/5 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${statusMessage.includes("Ready") || statusMessage.includes("Success") || statusMessage.includes("Generated") ? "bg-emerald-500" : (isGenerating || isGeneratingScene) ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`}></div>
            <span className="text-[10px] text-zinc-400 font-medium truncate tracking-tight">
                {statusMessage || "Waiting for image..."}
            </span>
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative bg-gradient-to-br from-black to-zinc-900 overflow-hidden group">
        <div className="absolute inset-0">
             {viewMode === 'scene' ? (
                 <div className="w-full h-full relative">
                     {voxelSceneHtml ? (
                         <iframe 
                            ref={iframeRef}
                            srcDoc={voxelSceneHtml} 
                            className="w-full h-full border-0 bg-white" 
                            sandbox="allow-scripts allow-same-origin"
                            title="Generative Scene"
                         />
                     ) : (
                         <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                             {!isGeneratingScene && <Box size={48} className="mb-4 opacity-20" />}
                             <p className="opacity-50 text-sm">
                                 {isGeneratingScene ? "Generating Code..." : "Generate a voxel scene to preview here"}
                             </p>
                         </div>
                     )}
                 </div>
             ) : (
                 viewMode === 'points' ? (
                     <PointCloudViewer 
                        data={pointCloudData} 
                        gestureRef={gestureRef} 
                        pointSize={pointSize} 
                        resetTrigger={resetTrigger} 
                        originalImage={originalImage}
                        showBackground={showBackground}
                        depthExaggeration={depthExaggeration}
                        autoRotate={autoRotate}
                     />
                 ) : (
                     <VoxelViewer 
                        data={pointCloudData} 
                        gestureRef={gestureRef} 
                        resetTrigger={resetTrigger} 
                        depthExaggeration={depthExaggeration}
                        autoRotate={autoRotate}
                        voxelDensity={1}
                        originalImage={originalImage}
                        showBackground={showBackground}
                     />
                 )
             )}
        </div>

        {/* Loading Overlay with Progress Bar */}
        {(isGenerating || isProcessing3D || isGeneratingScene) && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
               <div className="w-64 space-y-4 p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between text-xs text-zinc-400 font-medium uppercase tracking-wider">
                      <span className="flex items-center gap-2">
                          <Loader2 size={12} className="animate-spin text-blue-500"/>
                          Processing
                      </span>
                      {(!isGeneratingScene) && <span className="text-zinc-300">{Math.round(progress)}%</span>}
                  </div>
                  
                  {(!isGeneratingScene) && (
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                  )}
                  
                  <p className="text-[10px] text-zinc-500 text-center animate-pulse">
                      {statusMessage}
                  </p>
               </div>
            </div>
        )}
        
        {pointCloudData && !isGenerating && !isProcessing3D && viewMode !== 'scene' && (
          <>
             {/* Interactive Mode Badge */}
             <div className="absolute top-6 right-6 flex flex-col items-end gap-2 pointer-events-none">
                <div className="bg-zinc-900/80 backdrop-blur-md pl-4 pr-4 py-2 rounded-full border border-white/5 shadow-xl">
                    <h3 className="text-xs font-medium text-white flex items-center gap-2">
                        Interactive Mode <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                    </h3>
                </div>
             </div>

             {/* Center Bottom Reset Button */}
             <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <button
                    onClick={handleResetView}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800/80 backdrop-blur-md text-white text-xs font-medium rounded-full border border-white/10 shadow-lg hover:bg-zinc-700 hover:scale-105 active:scale-95 transition-all"
                >
                    <RefreshCcw size={12} /> Reset View
                </button>
             </div>
          </>
        )}

        {(!originalImage && !isGenerating && !isProcessing3D && !isGeneratingScene) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center opacity-20 transform scale-95">
              <div className="w-32 h-32 rounded-full border border-zinc-700 flex items-center justify-center mx-auto mb-6 bg-zinc-900/30">
                <Play className="ml-2 text-zinc-500" size={40} />
              </div>
              <p className="text-xl font-light tracking-tight text-zinc-300">Select an image to begin</p>
            </div>
          </div>
        )}
      </div>

      {/* Depth Map Overlay Modal */}
      {showDepthOverlay && displayDepthImage && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowDepthOverlay(false)}>
            <div className="relative max-w-4xl max-h-[90vh] p-1">
                <button 
                    onClick={() => setShowDepthOverlay(false)}
                    className="absolute -top-10 right-0 text-white hover:text-zinc-300 transition-colors"
                >
                    <X size={24} />
                </button>
                <img 
                    src={displayDepthImage} 
                    alt="Full Depth Map" 
                    className="max-w-full max-h-[85vh] rounded-lg border border-white/10 shadow-2xl" 
                />
                <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
                    <span className="bg-black/50 px-3 py-1 rounded-full text-xs text-white backdrop-blur-md border border-white/10">
                        Generated by Gemini
                    </span>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}

export default App;