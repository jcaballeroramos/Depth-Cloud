import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { ShieldAlert, Settings2, ScanFace, ZoomIn, Move3d, Minimize2, Maximize2, RefreshCw, RotateCcw, Eye, EyeOff, FlipHorizontal, Activity, Video, VideoOff } from 'lucide-react';
import { HandGestures } from '../types';

interface Landmark {
  x: number;
  y: number;
  z: number;
}

interface Results {
  image: ImageBitmap | HTMLCanvasElement | HTMLVideoElement;
  multiHandLandmarks: Landmark[][];
  multiHandedness: Array<{ index: number; score: number; label: string; displayName?: string }>;
}

declare global {
  interface Window {
    Hands: any;
  }
}

interface HandControllerProps {
  onUpdate: (gestures: HandGestures) => void;
}

export interface HandControllerHandle {
  reset: () => void;
}

const HandController = forwardRef<HandControllerHandle, HandControllerProps>(({ onUpdate }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(true); // Camera ON/OFF state
  const [trackingState, setTrackingState] = useState<'lost' | 'tracking'>('lost');
  const requestRef = useRef<number>(0);
  const handsRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  
  // 1. Sensitivity
  const [sensitivity, setSensitivity] = useState<'normal' | 'precise'>('normal');
  const sensitivityRef = useRef<'normal' | 'precise'>('normal');

  // 2. Visual Debug (Skeletons)
  const [showDebug, setShowDebug] = useState(true);
  const showDebugRef = useRef(true);

  // 3. Mirroring
  const [isMirrored, setIsMirrored] = useState(true);
  const isMirroredRef = useRef(true);

  // Gesture State Refs
  const gesturesRef = useRef<HandGestures>({
    rotation: { x: 0, y: 0 },
    scale: 1.2, 
    isTracking: false,
  });

  // Persistent Zoom State
  const zoomLevelRef = useRef<number>(1.2);
  const zoomVelocityRef = useRef<number>(0); // Track velocity for momentum
  const pinchRatioSmoothed = useRef<number>(0.5); // For smoothing input

  // Expose reset to parent
  useImperativeHandle(ref, () => ({
    reset: () => {
        resetZoom();
    }
  }));

  // Sync refs with state for animation loop
  useEffect(() => { sensitivityRef.current = sensitivity; }, [sensitivity]);
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);
  useEffect(() => { isMirroredRef.current = isMirrored; }, [isMirrored]);

  const resetZoom = () => {
      zoomLevelRef.current = 1.2;
      zoomVelocityRef.current = 0;
      gesturesRef.current.scale = 1.2;
      onUpdate({...gesturesRef.current});
  };

  // Cleanup function to stop everything
  const stopPipeline = () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      if (handsRef.current) {
          handsRef.current.close();
          handsRef.current = null;
      }
      if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
      }
      // Clear canvas to prevent frozen frame
      if (canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
  };

  const startPipeline = useCallback(async () => {
      stopPipeline();
      setError(null);
      setIsReady(false);

      try {
        // 1. Wait for MediaPipe Script to load if it hasn't yet
        let attempts = 0;
        while (!window.Hands && attempts < 20) {
            await new Promise(r => setTimeout(r, 200));
            attempts++;
        }
        
        if (!window.Hands) {
            throw new Error("MediaPipe library failed to load. Please check your connection.");
        }

        // 2. Initialize Hands
        const hands = new window.Hands({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
        });

        handsRef.current = hands;

        hands.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        hands.onResults(onResults);
        
        // 3. Initialize Camera
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 320, height: 240, facingMode: 'user' } 
        });
        
        streamRef.current = stream;

        if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = async () => {
                if (videoRef.current) {
                    try {
                        await videoRef.current.play();
                        setIsReady(true);
                        sendFrames();
                    } catch (e) {
                        console.error("Play error", e);
                        setError("Video play failed");
                    }
                }
            };
        }

      } catch (err: any) {
        console.error("Pipeline Init Error:", err);
        setError(err.message || "Camera unavailable");
        stopPipeline();
      }
  }, []);

  useEffect(() => {
    if (isCameraActive) {
        startPipeline();
    } else {
        stopPipeline();
        setIsReady(false);
        setTrackingState('lost');
        // Ensure tracking stops in parent
        gesturesRef.current.isTracking = false;
        onUpdate(gesturesRef.current);
    }
    return () => stopPipeline();
  }, [startPipeline, isCameraActive, onUpdate]);

  const sendFrames = async () => {
      if (videoRef.current && handsRef.current && !videoRef.current.paused && !videoRef.current.ended) {
          try { 
              await handsRef.current.send({ image: videoRef.current }); 
          } catch (e) {
              console.warn("Frame send dropped", e);
          }
      }
      if (handsRef.current) {
          requestRef.current = requestAnimationFrame(sendFrames);
      }
  };

  const onResults = (results: Results) => {
      if (!canvasRef.current || !videoRef.current) return;
      
      const width = canvasRef.current.width;
      const height = canvasRef.current.height;
      const ctx = canvasRef.current.getContext('2d');
      
      if (ctx) {
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        
        // Draw video background
        ctx.save();
        if (isMirroredRef.current) {
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
        }
        ctx.globalAlpha = 0.5;
        ctx.drawImage(results.image, 0, 0, width, height);
        ctx.globalAlpha = 1.0;
        ctx.restore();
        
        const currentSens = sensitivityRef.current;
        const ROT_SPEED = currentSens === 'normal' ? 0.15 : 0.05;
        const ZOOM_MAX_SPEED = currentSens === 'normal' ? 0.08 : 0.03;

        let rotX = 0, rotY = 0;
        
        let rotateHand: Landmark[] | null = null;
        let zoomHand: Landmark[] | null = null;

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
          
          results.multiHandedness.forEach((handedness, index) => {
             const label = handedness.label; 
             const landmarks = results.multiHandLandmarks[index];
             
             // Handle mirroring for landmarks
             const finalLandmarks = isMirroredRef.current 
                ? landmarks.map(p => ({ ...p, x: 1 - p.x }))
                : landmarks;

             if (label === 'Right') rotateHand = finalLandmarks;
             else if (label === 'Left') zoomHand = finalLandmarks;
          });

          const shouldDraw = showDebugRef.current;

          // --- RIGHT HAND: ROTATION (JOYSTICK) ---
          if (rotateHand) {
            const rh = rotateHand as Landmark[];
            if (shouldDraw) {
                drawBoundingBox(ctx, rh, width, height, '#3b82f6', 'Right: Rotate');
                drawSkeleton(ctx, rh, '#3b82f6', width, height);
            }
            
            const indexTip = rh[8];
            const rawDx = (indexTip.x - 0.5) * 2;
            const rawDy = (indexTip.y - 0.5) * 2;

            rotY = Math.pow(Math.abs(rawDx), 1.5) * Math.sign(rawDx) * ROT_SPEED;
            rotX = Math.pow(Math.abs(rawDy), 1.5) * Math.sign(rawDy) * ROT_SPEED;

            if (shouldDraw) {
                // Visual Joystick
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(59, 130, 246, 0.6)';
                ctx.moveTo(width/2, height/2);
                ctx.lineTo(indexTip.x * width, indexTip.y * height);
                ctx.stroke();
                
                // Crosshair
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(width/2 - 10, height/2); ctx.lineTo(width/2 + 10, height/2);
                ctx.moveTo(width/2, height/2 - 10); ctx.lineTo(width/2, height/2 + 10);
                ctx.stroke();
            }
          }

          // --- LEFT HAND: ZOOM THROTTLE ---
          if (zoomHand) {
            const zh = zoomHand as Landmark[];
            if (shouldDraw) {
                drawBoundingBox(ctx, zh, width, height, '#10b981', 'Left: Zoom');
                drawSkeleton(ctx, zh, '#10b981', width, height);
            }

            const thumbTip = zh[4];
            const indexTip = zh[8];
            const wrist = zh[0];
            const middleMCP = zh[9];

            const handSize = Math.sqrt(
                Math.pow(wrist.x - middleMCP.x, 2) + 
                Math.pow(wrist.y - middleMCP.y, 2)
            );

            const pinchDist = Math.sqrt(
                Math.pow(thumbTip.x - indexTip.x, 2) + 
                Math.pow(thumbTip.y - indexTip.y, 2)
            );

            const rawRatio = pinchDist / (handSize || 0.1);
            pinchRatioSmoothed.current = pinchRatioSmoothed.current * 0.90 + rawRatio * 0.10;
            const ratio = pinchRatioSmoothed.current;

            const THRESH_OUT = 0.35; 
            const THRESH_IN = 0.75;  
            
            let targetSpeed = 0;
            let statusText = "Hold";
            let gaugeColor = '#9ca3af';

            if (ratio < THRESH_OUT) {
                const intensity = 1 - (ratio / THRESH_OUT); 
                targetSpeed = -ZOOM_MAX_SPEED * Math.pow(intensity, 2);
                statusText = "Zoom OUT";
                gaugeColor = '#f43f5e'; 
            } else if (ratio > THRESH_IN) {
                const intensity = Math.min(1, (ratio - THRESH_IN) / 0.4);
                targetSpeed = ZOOM_MAX_SPEED * Math.pow(intensity, 2);
                statusText = "Zoom IN";
                gaugeColor = '#34d399'; 
            }

            zoomVelocityRef.current = zoomVelocityRef.current * 0.85 + targetSpeed * 0.15;
            if (Math.abs(zoomVelocityRef.current) < 0.0001) zoomVelocityRef.current = 0;

            zoomLevelRef.current += zoomVelocityRef.current;
            zoomLevelRef.current = Math.max(0.1, Math.min(zoomLevelRef.current, 12.0));

            if (shouldDraw) {
                // Visual Gauge
                const cx = thumbTip.x * width;
                const cy = thumbTip.y * height - 30;
                const barW = 60;
                const barH = 6;
                
                if (ctx.roundRect) {
                   ctx.beginPath();
                   ctx.fillStyle = 'rgba(0,0,0,0.6)';
                   ctx.roundRect(cx - barW/2, cy, barW, barH, 3);
                   ctx.fill();
                } else {
                   ctx.fillStyle = 'rgba(0,0,0,0.6)';
                   ctx.fillRect(cx - barW/2, cy, barW, barH);
                }
                
                const neutralStart = 0.35 * barW; 
                const neutralWidth = (0.75 - 0.35) * barW;
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                ctx.fillRect((cx - barW/2) + neutralStart, cy, neutralWidth, barH);

                const normRatio = Math.min(1.2, Math.max(0, ratio)) / 1.2;
                const indicatorX = cx - barW/2 + normRatio * barW;
                
                ctx.fillStyle = gaugeColor;
                ctx.beginPath();
                ctx.arc(indicatorX, cy + barH/2, 5, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 10px Inter';
                ctx.textAlign = 'center';
                ctx.fillText(statusText, cx, cy - 5);
                ctx.fillText(`${zoomLevelRef.current.toFixed(1)}x`, cx, cy + 18);
                ctx.textAlign = 'left';
            }
          } else {
            zoomVelocityRef.current = 0;
          }

          gesturesRef.current = {
            rotation: { x: rotX, y: rotY },
            scale: zoomLevelRef.current,
            isTracking: true
          };
          
          setTrackingState('tracking');
        } else {
          gesturesRef.current.isTracking = false;
          gesturesRef.current.rotation = { x: 0, y: 0 };
          setTrackingState('lost');
        }
        
        ctx.restore();
      }

      onUpdate(gesturesRef.current);
    };

    const drawBoundingBox = (ctx: CanvasRenderingContext2D, landmarks: Landmark[], w: number, h: number, color: string, label: string) => {
        let minX = 1, minY = 1, maxX = 0, maxY = 0;
        landmarks.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
        const pad = 0.02;
        minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
        maxX = Math.min(1, maxX + pad); maxY = Math.min(1, maxY + pad);
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.strokeRect(minX * w, minY * h, (maxX - minX) * w, (maxY - minY) * h);
        ctx.fillStyle = color;
        ctx.fillRect(minX * w, minY * h - 14, ctx.measureText(label).width + 8, 14);
        ctx.fillStyle = 'white'; ctx.font = 'bold 9px Inter';
        ctx.fillText(label, minX * w + 4, minY * h - 4);
    };

    const drawSkeleton = (ctx: CanvasRenderingContext2D, landmarks: Landmark[], color: string, w: number, h: number) => {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],[0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],[0,5],[0,17]];
        connections.forEach(([start, end]) => {
            ctx.moveTo(landmarks[start].x * w, landmarks[start].y * h);
            ctx.lineTo(landmarks[end].x * w, landmarks[end].y * h);
        });
        ctx.stroke();
    };

  const getBorderColor = () => {
    if (error) return 'border-rose-500/50';
    if (!isCameraActive) return 'border-zinc-800';
    if (trackingState === 'lost') return 'border-zinc-700/50';
    return 'border-zinc-500/50';
  };

  const borderColorClass = getBorderColor();

  return (
    <div className="relative w-full aspect-[4/3] group">
      {/* Screen Container: Holds Video/Canvas with Rounded Corners and Overflow Hidden */}
      <div className={`absolute inset-0 rounded-xl overflow-hidden shadow-2xl border transition-colors duration-300 bg-black ${borderColorClass} z-0`}>
          {error ? (
            <div className="flex flex-col items-center justify-center h-full text-rose-400 text-xs p-4 text-center bg-zinc-900/90">
              <ShieldAlert size={20} className="mb-3" />
              <p className="mb-4 max-w-[200px]">{error}</p>
              <button 
                onClick={() => startPipeline()}
                className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/20 text-rose-300 rounded-full text-[10px] hover:bg-rose-500/30 transition-colors border border-rose-500/30"
              >
                <RefreshCw size={10} /> Retry Camera
              </button>
            </div>
          ) : (
            <>
              <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover opacity-0" playsInline muted />
              <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" width={320} height={240} />
              
              {/* Tracking Lost Overlay (only when active and ready) */}
              {isCameraActive && trackingState === 'lost' && isReady && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-[2px] animate-in fade-in duration-300 pointer-events-none">
                    <ScanFace className="text-zinc-500 mb-2 opacity-50" size={32} />
                    <span className="text-zinc-400 text-[10px] font-medium tracking-wide uppercase">Tracking Lost</span>
                 </div>
              )}

              {/* Camera Paused Overlay */}
              {!isCameraActive && (
                 <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 z-20 animate-in fade-in duration-300">
                    <VideoOff size={24} className="text-zinc-600 mb-2"/>
                    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Camera Paused</span>
                    <button 
                        onClick={() => setIsCameraActive(true)}
                        className="mt-3 px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-full text-[10px] border border-zinc-700 transition-colors hover:text-white"
                    >
                        Enable Camera
                    </button>
                 </div>
              )}

              {/* Loading Overlay */}
              {!isReady && isCameraActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 z-20">
                  <div className="flex flex-col items-center gap-3">
                     <div className="animate-spin rounded-full h-5 w-5 border-2 border-zinc-700 border-t-blue-500"></div>
                     <span className="text-[10px] text-zinc-500 flex items-center gap-2">
                        <Video size={12} /> Starting Camera...
                     </span>
                  </div>
                </div>
              )}
            </>
          )}
      </div>

      {/* Controls Container: Sits above screen, no overflow hidden to allow popups to extend */}
      <div className="absolute inset-0 pointer-events-none z-10">
          
          {/* Top Right Controls - Interactive */}
          <div className="absolute top-2 right-2 flex flex-col gap-2 pointer-events-auto">
             {/* Camera Toggle Button */}
             <button 
                onClick={() => setIsCameraActive(!isCameraActive)}
                className={`p-1.5 rounded-lg transition-colors border shadow-lg
                    ${isCameraActive 
                        ? 'bg-zinc-900/80 text-zinc-400 hover:text-white border-white/10 hover:bg-zinc-800' 
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/30'}
                `}
                title={isCameraActive ? "Turn Camera Off" : "Turn Camera On"}
             >
                {isCameraActive ? <Video size={14} /> : <VideoOff size={14} />}
             </button>

             {/* Existing Controls */}
             {isCameraActive && (
                 <>
                    <button 
                        onClick={resetZoom}
                        className="bg-zinc-900/80 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors border border-white/10 shadow-lg"
                        title="Reset Zoom"
                    >
                        <RotateCcw size={14} />
                    </button>
                    
                    <div className="relative">
                        <button 
                            onClick={() => setShowSettings(!showSettings)}
                            className={`p-1.5 rounded-lg transition-colors border shadow-lg
                                ${showSettings 
                                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/50' 
                                    : 'bg-zinc-900/80 text-zinc-400 hover:text-white border-white/10 hover:bg-zinc-800'}
                            `}
                            title="Settings"
                        >
                            <Settings2 size={14} />
                        </button>

                        {/* Settings Menu Popup */}
                        {showSettings && (
                            <div className="absolute top-0 right-9 bg-zinc-900/95 border border-white/10 p-2.5 rounded-xl shadow-2xl w-40 flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-200 origin-top-right z-50 backdrop-blur-md">
                                {/* Sensitivity */}
                                <div className="flex flex-col gap-1">
                                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">Sensitivity</span>
                                    <div className="flex bg-zinc-950 rounded-lg p-0.5 border border-white/5">
                                        <button 
                                            onClick={() => setSensitivity('normal')}
                                            className={`flex-1 py-1 text-[9px] font-medium rounded-md transition-all ${sensitivity === 'normal' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-400'}`}
                                        >
                                            Normal
                                        </button>
                                        <button 
                                            onClick={() => setSensitivity('precise')}
                                            className={`flex-1 py-1 text-[9px] font-medium rounded-md transition-all ${sensitivity === 'precise' ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-400'}`}
                                        >
                                            Precise
                                        </button>
                                    </div>
                                </div>

                                {/* Mirroring */}
                                <button 
                                    onClick={() => setIsMirrored(!isMirrored)}
                                    className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/5 transition-colors group"
                                >
                                    <div className="flex items-center gap-2 text-[10px] text-zinc-300">
                                        <FlipHorizontal size={12} className="text-zinc-500 group-hover:text-zinc-300" />
                                        <span>Mirror Cam</span>
                                    </div>
                                    <div className={`w-2 h-2 rounded-full ${isMirrored ? 'bg-emerald-500' : 'bg-zinc-700'}`}></div>
                                </button>

                                {/* Visuals */}
                                <button 
                                    onClick={() => setShowDebug(!showDebug)}
                                    className="flex items-center justify-between p-1.5 rounded-lg hover:bg-white/5 transition-colors group"
                                >
                                    <div className="flex items-center gap-2 text-[10px] text-zinc-300">
                                        {showDebug ? <Eye size={12} className="text-zinc-500 group-hover:text-zinc-300"/> : <EyeOff size={12} className="text-zinc-500 group-hover:text-zinc-300"/>}
                                        <span>Overlay</span>
                                    </div>
                                    <div className={`w-2 h-2 rounded-full ${showDebug ? 'bg-emerald-500' : 'bg-zinc-700'}`}></div>
                                </button>

                            </div>
                        )}
                    </div>
                 </>
             )}
          </div>

          {/* Mode Indicators - Z-Index 10 */}
          <div className="absolute bottom-2 left-2 flex gap-1.5 pointer-events-none z-10">
             {trackingState === 'tracking' && isCameraActive && (
                 <div className="flex gap-1">
                      <span className="px-2 py-0.5 bg-emerald-500/90 text-[9px] text-white font-bold rounded-full shadow-lg flex items-center gap-1 backdrop-blur-sm">
                           <Minimize2 size={8} /> <Maximize2 size={8} /> Zoom
                      </span>
                      <span className="px-2 py-0.5 bg-blue-500/90 text-[9px] text-white font-bold rounded-full shadow-lg flex items-center gap-1 backdrop-blur-sm">
                          <Activity size={8} /> Rotate
                      </span>
                 </div>
             )}
          </div>

      </div>
    </div>
  );
});

export default HandController;