import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, Loader2, Play, Wand2, Layers, Image as ImageIcon, Sliders, Maximize2, X, RefreshCcw, Palette, Key, Eye, EyeOff, Download, FileJson, ImageIcon as ImageIconLucide, Move3d, RotateCw } from 'lucide-react';
import PointCloudViewer from './components/PointCloudViewer';
import HandController, { HandControllerHandle } from './components/HandController';
import { generateDepthMap } from './services/geminiService';
import { loadImage, resizeImage, generatePointCloudFromImages, applyColorMap } from './utils/imageProcessing';
import { ProcessedPointCloud, HandGestures } from './types';

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
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [isProcessing3D, setIsProcessing3D] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);

  // Visual settings
  const [pointSize, setPointSize] = useState<number>(0.2); // Default to 0.2
  const [samplingDensity, setSamplingDensity] = useState<number>(0.5); // Default to 50%
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

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
        if (window.aistudio) {
            const hasKey = await window.aistudio.hasSelectedApiKey();
            setIsApiKeyReady(hasKey);
        } else {
            // If we are not in the AI Studio environment, we assume the user 
            // might provide it manually or via env. We don't block immediately unless generation fails.
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
  }, []);

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
                  
                  // Rebuild point cloud immediately
                  await buildPointCloud(data.originalImage, data.depthImage, samplingDensity);
                  
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
      if (!originalImage || !depthImage) return;

      const data = {
          originalImage,
          depthImage,
          createdAt: new Date().toISOString(),
          settings: { pointSize, samplingDensity }
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
         // Resize for display to avoid lag with massive images
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

    // Reset progress and start simulation
    setProgress(5);
    const progressInterval = setInterval(() => {
        setProgress(prev => {
            if (prev >= 85) return prev; // Hold at 85% while waiting for API
            // Decelerating progress
            const increment = prev < 50 ? 5 : prev < 70 ? 2 : 0.5;
            return prev + Math.random() * increment;
        });
    }, 400);

    try {
      setIsGenerating(true);
      setStatusMessage("Analysing depth (Gemini 3 Pro)...");
      
      const base64Data = originalImage.split(',')[1];
      // Pass the manual key if it exists
      const depthBase64 = await generateDepthMap(base64Data, manualApiKey);
      
      if (!depthBase64) throw new Error("Failed to generate depth map");

      // Bump progress to indicate API success
      setProgress(90);

      const fullDepthSrc = `data:image/png;base64,${depthBase64}`;
      setDepthImage(fullDepthSrc);
      setStatusMessage("Constructing high-res cloud...");
      
      await buildPointCloud(originalImage, fullDepthSrc, samplingDensity);
      
      // Done
      setProgress(100);
      
    } catch (error: any) {
      console.error(error);
      const errMsg = error.toString();
      
      // Handle Permission/Auth Errors
      if (errMsg.includes("403") || errMsg.includes("PERMISSION_DENIED")) {
         setStatusMessage("Access Denied. Check API Key.");
         // If we are in AI Studio, trigger that flow, otherwise rely on manual input
         if (window.aistudio) {
             setIsApiKeyReady(false);
         }
      } else {
         setStatusMessage("Error: " + (error instanceof Error ? error.message : "Unknown error"));
      }
      setProgress(0); // Reset on error
    } finally {
      clearInterval(progressInterval);
      setIsGenerating(false);
      // Wait a moment before clearing progress visually if needed, but react state update will hide overlay
    }
  };

  const buildPointCloud = async (colorSrc: string, depthSrc: string, density: number) => {
    setIsProcessing3D(true);
    try {
      const [colorImg, depthImg] = await Promise.all([
        loadImage(colorSrc),
        loadImage(depthSrc)
      ]);

      const colorCanvas = resizeImage(colorImg, 1024);
      const depthCanvas = resizeImage(depthImg, 1024);

      const cloud = generatePointCloudFromImages(colorCanvas, depthCanvas, density);
      setPointCloudData(cloud);
      setStatusMessage(`Ready (${(cloud.count / 1000).toFixed(0)}k points).`);
    } catch (error) {
       console.error("3D Build Error", error);
       setStatusMessage("Error building cloud.");
    } finally {
      setIsProcessing3D(false);
    }
  };

  const handleDensityChange = (newDensity: number) => {
    setSamplingDensity(newDensity);
  };

  const commitDensityChange = () => {
    if (originalImage && depthImage) {
        buildPointCloud(originalImage, depthImage, samplingDensity);
    }
  };

  // ----------------------------------------------------------------------
  // RENDER: API Key Selection Screen (Only if strictly enforced by AI Studio)
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
                        onClick={() => { setOriginalImage(null); setDepthImage(null); setPointCloudData(null); }}
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

          {/* 2. Generation Control */}
          <div className="space-y-2">
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
                    <> <Wand2 size={14} /> Generate 3D Model </>
                )}
            </button>

            {/* Export Button */}
            {pointCloudData && (
                <button
                    onClick={handleExport}
                    className="w-full py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700 flex items-center justify-center gap-2 transition-colors"
                >
                    <Download size={12} /> Export Artefacto Cloud
                </button>
            )}
          </div>

          {/* 3. Visual Adjustments */}
          <div className="space-y-4 pt-4 border-t border-white/5">
             <div className="flex items-center gap-2">
                <Sliders size={14} className="text-zinc-400"/>
                <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Visualization
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

                <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-zinc-400">
                        <span>Point Size</span>
                        <span>{pointSize.toFixed(1)}</span>
                    </div>
                    <input 
                        type="range" min="0.1" max="5.0" step="0.1" value={pointSize}
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
                        onChange={(e) => handleDensityChange(parseFloat(e.target.value))}
                        onMouseUp={commitDensityChange}
                        onTouchEnd={commitDensityChange}
                        disabled={!pointCloudData}
                        className={`w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400 disabled:opacity-50`}
                    />
                </div>
             </div>
          </div>
          
           {/* Depth Preview Section */}
           {depthImage && (
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
            <div className={`w-1.5 h-1.5 rounded-full ${statusMessage.includes("Ready") || statusMessage.includes("Success") ? "bg-emerald-500" : isGenerating ? "bg-amber-500 animate-pulse" : "bg-zinc-700"}`}></div>
            <span className="text-[10px] text-zinc-400 font-medium truncate tracking-tight">
                {statusMessage || "Waiting for image..."}
            </span>
          </div>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="flex-1 relative bg-gradient-to-br from-black to-zinc-900 overflow-hidden group">
        <div className="absolute inset-0">
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
        </div>

        {/* Loading Overlay with Progress Bar */}
        {(isGenerating || isProcessing3D) && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
               <div className="w-64 space-y-4 p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl shadow-2xl backdrop-blur-md">
                  <div className="flex items-center justify-between text-xs text-zinc-400 font-medium uppercase tracking-wider">
                      <span className="flex items-center gap-2">
                          <Loader2 size={12} className="animate-spin text-blue-500"/>
                          Processing
                      </span>
                      <span className="text-zinc-300">{Math.round(progress)}%</span>
                  </div>
                  
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-300 ease-out shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                        style={{ width: `${progress}%` }}
                      />
                  </div>
                  
                  <p className="text-[10px] text-zinc-500 text-center animate-pulse">
                      {statusMessage}
                  </p>
               </div>
            </div>
        )}
        
        {pointCloudData && !isGenerating && !isProcessing3D && (
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

        {(!originalImage && !isGenerating && !isProcessing3D) && (
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
                        Generated by Gemini 3 Pro
                    </span>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}

export default App;