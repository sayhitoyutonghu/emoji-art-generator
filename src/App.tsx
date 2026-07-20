/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Settings2, Image as ImageIcon, RefreshCw, Type, Palette, Move, Video, Circle, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import RecordRTC from 'recordrtc';

// --- Constants & Types ---

const DEFAULT_CHARSET = "✅🔘📝⏳✕✔✖";
const DENSITY_PRESETS = [
  { label: 'Low', value: 12 },
  { label: 'Medium', value: 8 },
  { label: 'High', value: 5 },
  { label: 'Ultra', value: 3 },
];

interface Config {
  charset: string;
  density: number;
  fontSize: number;
  canvasWidth: number;
  colorMode: 'original' | 'monochrome' | 'brutalist' | 'invert' | 'sweep';
  monochromeColor: string;
  sweepColor1: string;
  sweepColor2: string;
  sweepColor3: string;
  sweepProgress: number;
  autoSweep: boolean;
  contrast: number;
  brightness: number;
  customWords: string;
  charMode: 'charset' | 'words' | 'emojis' | 'sweep';
  emojiDark: string;
  emojiMid: string;
  emojiLight: string;
  emojiThreshold1: number;
  emojiThreshold2: number;
  sweepChar1: string;
  sweepChar2: string;
  sweepChar3: string;
  overlayText: string;
  showOverlayText: boolean;
  overlayTextSize: number;
  overlayTextColor: string;
  overlayTextPositionX: number;
  overlayTextPositionY: number;
  overlayTextRotation: number;
  overlayTextDrift: boolean;
  overlayTextDriftAmount: number;
  overlayTextMode: 'global' | 'track_ball';
  overlayTextRollingSpeed: number;
  overlayTextAnimCurve: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
  overlayTextAnimDuration: number;
  overlayTextAnimLoop: boolean;
  overlayTextAnimTrigger: number;
  isAnimated: boolean;
  animationSpeed: number;
  readability: number;
  animationMode: 'float' | 'flow' | 'stress' | 'wave' | 'glitch' | 'spiral' | 'pulse';
  flowAngle: number;
  motionIntensity: number;
  glitchFrequency: number;
  waveFrequency: number;
}

// --- Components ---

export default function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  
  // Video Generation & Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [gifFrameRate, setGifFrameRate] = useState(15);
  const [gifQuality, setGifQuality] = useState(10);
  const [aiPrompt, setAiPrompt] = useState("A cinematic looping animation of Sisyphus pushing a heavy stone up a hill");
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");

  const [config, setConfig] = useState<Config>({
    charset: DEFAULT_CHARSET,
    density: 8,
    fontSize: 10,
    canvasWidth: 1200,
    colorMode: 'monochrome',
    monochromeColor: '#000000',
    sweepColor1: '#22C55E',
    sweepColor2: '#EF4444',
    sweepColor3: '#3B82F6',
    sweepProgress: 0,
    autoSweep: true,
    contrast: 1.2,
    brightness: 1.0,
    customWords: "✅ 🔘 📝 ⏳ TODO DONE TASK",
    charMode: 'emojis',
    emojiDark: '🧍‍♂️',
    emojiMid: '🪨',
    emojiLight: '☁️',
    emojiThreshold1: 85,
    emojiThreshold2: 170,
    sweepChar1: '🟢',
    sweepChar2: '🔴',
    sweepChar3: '🔵',
    overlayText: "TASKGRAPH",
    showOverlayText: false,
    overlayTextSize: 120,
    overlayTextColor: "#FFFFFF",
    overlayTextPositionX: 50,
    overlayTextPositionY: 50,
    overlayTextRotation: -26,
    overlayTextDrift: true,
    overlayTextDriftAmount: 200,
    overlayTextMode: 'global',
    overlayTextRollingSpeed: 0,
    overlayTextAnimCurve: 'easeInOut',
    overlayTextAnimDuration: 2,
    overlayTextAnimLoop: true,
    overlayTextAnimTrigger: 0,
    isAnimated: false,
    animationSpeed: 1,
    readability: 0.5,
    animationMode: 'float',
    flowAngle: 0,
    motionIntensity: 1.0,
    glitchFrequency: 0.1,
    waveFrequency: 0.05,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  // --- Core Logic: Image Processing & Animation ---

  const renderFrame = useCallback((time: number) => {
    const mediaSource = videoElement || image;
    if (!mediaSource || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const sourceWidth = videoElement ? videoElement.videoWidth : image!.width;
    const sourceHeight = videoElement ? videoElement.videoHeight : image!.height;
    
    if (sourceWidth === 0 || sourceHeight === 0) {
      // Retry after a short delay if video dimensions are not yet available
      if (videoElement) {
        setTimeout(() => renderFrame(time), 100);
      }
      return;
    }

    // Use a temporary canvas to store pixel data once
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!tempCtx) return;
    
    const scale = config.canvasWidth / sourceWidth;
    tempCanvas.width = config.canvasWidth;
    tempCanvas.height = sourceHeight * scale;

    const draw = (t: number) => {
      // For video, we must re-sample the pixels every frame
      tempCtx.drawImage(mediaSource, 0, 0, tempCanvas.width, tempCanvas.height);
      const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const pixels = imageData.data;

      ctx.fillStyle = config.colorMode === 'invert' ? '#000000' : '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const words = config.charMode === 'words' 
        ? config.customWords.split(' ').filter(w => w.length > 0)
        : config.charset.split('');
      
      let wordIndex = 0;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      let midXSum = 0;
      let midYSum = 0;
      let midCount = 0;

      // Global state for 'pulse' (Flip) mode
      let globalChar = '';
      let flipScaleY = 1;
      if (config.isAnimated && config.animationMode === 'pulse') {
        const speed = t * 0.001 * config.animationSpeed;
        const wave = Math.sin(speed * 4); // Global oscillation
        const charIndex = wave > 0 ? 0 : 1;
        globalChar = words[charIndex % words.length] || words[0];
        // The "flip" effect: scale Y to 0 and back
        flipScaleY = Math.abs(wave);
      }

      for (let y = 0; y < canvas.height; y += config.density) {
        for (let x = 0; x < canvas.width; x += config.density) {
          const i = (Math.floor(y) * canvas.width + Math.floor(x)) * 4;
          if (i >= pixels.length) continue;

          let r = pixels[i];
          let g = pixels[i + 1];
          let b = pixels[i + 2];
          const a = pixels[i + 3];

          if (a < 128) continue;

          r = Math.min(255, Math.max(0, ((r / 255 - 0.5) * config.contrast + 0.5 + (config.brightness - 1)) * 255));
          g = Math.min(255, Math.max(0, ((g / 255 - 0.5) * config.contrast + 0.5 + (config.brightness - 1)) * 255));
          b = Math.min(255, Math.max(0, ((b / 255 - 0.5) * config.contrast + 0.5 + (config.brightness - 1)) * 255));

          const brightness = (r + g + b) / 3;

          if (brightness >= config.emojiThreshold1 && brightness < config.emojiThreshold2) {
            midXSum += x;
            midYSum += y;
            midCount++;
          }
          
          // Calculate sweep state if needed for either color or char
          let sweepState = 1;
          if (config.colorMode === 'sweep' || config.charMode === 'sweep') {
            let progress = config.sweepProgress / 100;
            if (config.autoSweep) {
               progress = (t * 0.0005 * config.animationSpeed) % 2.4; 
            }
            const boundaryX1 = canvas.width * (1.2 - progress * 1.4) + (y - canvas.height/2) * 0.5;
            const boundaryX2 = canvas.width * (1.2 - (progress - 1) * 1.4) + (y - canvas.height/2) * 0.5;
            
            const dist2 = x - boundaryX2;
            const dist1 = x - boundaryX1;

            if (dist2 > 0) {
              sweepState = 3;
            } else if (dist2 > -100) {
              sweepState = Math.random() < (100 + dist2) / 100 ? 3 : 2;
            } else if (dist1 > 0) {
              sweepState = 2;
            } else if (dist1 > -100) {
              sweepState = Math.random() < (100 + dist1) / 100 ? 2 : 1;
            } else {
              sweepState = 1;
            }
          }

          let char = '';
          if (config.charMode === 'emojis') {
            if (brightness < config.emojiThreshold1) char = config.emojiDark;
            else if (brightness < config.emojiThreshold2) char = config.emojiMid;
            else char = config.emojiLight;
          } else if (config.charMode === 'sweep') {
            if (brightness >= 240) continue;
            char = sweepState === 3 ? config.sweepChar3 : (sweepState === 2 ? config.sweepChar2 : config.sweepChar1);
          } else {
            if (brightness >= 240) continue;
            char = globalChar || words[wordIndex % words.length];
            if (!globalChar) wordIndex++;
          }

          if (config.colorMode === 'original') {
            ctx.fillStyle = `rgb(${r},${g},${b})`;
          } else if (config.colorMode === 'monochrome') {
            ctx.fillStyle = config.monochromeColor;
          } else if (config.colorMode === 'invert') {
            ctx.fillStyle = '#FFFFFF';
          } else if (config.colorMode === 'brutalist') {
            const flicker = Math.sin(t * 0.01 + x * 0.05 + y * 0.05) > 0.8;
            ctx.fillStyle = flicker ? '#22C55E' : '#EF4444';
          } else if (config.colorMode === 'sweep') {
            ctx.fillStyle = sweepState === 3 ? config.sweepColor3 : (sweepState === 2 ? config.sweepColor2 : config.sweepColor1);
          }

          // Improved readability: Ensure a minimum size and boost based on readability factor
          const minSize = config.fontSize * 0.4;
          let sizeVar = (config.charMode === 'emojis' || config.charMode === 'sweep')
            ? config.fontSize * (1 + config.readability * 0.5)
            : Math.max(minSize, (1 - brightness / 255) * config.fontSize * (1 + config.readability));
          
          // Animation logic
            let offsetX = 0;
            let offsetY = 0;
            let rotation = 0;
            let currentFlipY = 1;
            
            if (config.isAnimated) {
              const speed = t * 0.001 * config.animationSpeed;
              const intensity = config.motionIntensity;
              
              if (config.animationMode === 'float') {
                offsetX = Math.sin(speed + x * 0.02) * (config.density * 0.2) * intensity;
                offsetY = Math.cos(speed + y * 0.02) * (config.density * 0.2) * intensity;
              } else if (config.animationMode === 'flow') {
                const angleRad = (config.flowAngle * Math.PI) / 180;
                const drift = (speed * 20 * intensity) % config.density;
                offsetX = Math.cos(angleRad) * drift;
                offsetY = Math.sin(angleRad) * drift;
              } else if (config.animationMode === 'stress') {
                const jitter = (1 - brightness / 255) * 5 * intensity;
                offsetX = (Math.random() - 0.5) * jitter;
                offsetY = (Math.random() - 0.5) * jitter;
              } else if (config.animationMode === 'wave') {
                offsetX = Math.sin(speed * 2 + y * config.waveFrequency) * 10 * intensity;
                offsetY = Math.cos(speed * 2 + x * config.waveFrequency) * 5 * intensity;
              } else if (config.animationMode === 'glitch') {
                if (Math.random() < config.glitchFrequency * intensity) {
                  offsetX = (Math.random() - 0.5) * 50 * intensity;
                  offsetY = (Math.random() - 0.5) * 20 * intensity;
                  if (Math.random() > 0.5) ctx.fillStyle = '#00FFFF';
                }
              } else if (config.animationMode === 'spiral') {
                const dx = x - centerX;
                const dy = y - centerY;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const angle = Math.atan2(dy, dx) + speed * (100 / (dist + 10)) * intensity;
                offsetX = Math.cos(angle) * dist - dx;
                offsetY = Math.sin(angle) * dist - dy;
                rotation = speed * intensity;
              } else if (config.animationMode === 'pulse') {
                // Apply the global flip scale
                currentFlipY = flipScaleY;
              }
            }

            ctx.font = `${config.readability > 0.6 ? '900' : '400'} ${sizeVar}px "JetBrains Mono", monospace`;
            
            if (rotation !== 0 || currentFlipY !== 1) {
              ctx.save();
              ctx.translate(x + offsetX, y + offsetY);
              ctx.rotate(rotation);
              ctx.scale(1, currentFlipY); // Flip effect
              ctx.fillText(char, 0, 0);
              ctx.restore();
            } else {
              ctx.fillText(char, x + offsetX, y + offsetY);
            }
        }
      }

      // Draw Overlay Text
      if (config.showOverlayText && config.overlayText) {
        let driftX = 0;
        let driftY = 0;
        
        let angleRad = (config.overlayTextRotation * Math.PI) / 180;

        let textX = canvas.width * (config.overlayTextPositionX / 100);
        let textY = canvas.height * (config.overlayTextPositionY / 100);

        if (config.overlayTextMode === 'track_ball' && midCount > 0) {
          textX = midXSum / midCount;
          textY = midYSum / midCount;
        }

        if (config.overlayTextDrift) {
          let timeElapsed = t - config.overlayTextAnimTrigger;
          if (timeElapsed < 0) timeElapsed = 0;
          let rawProgress = timeElapsed / (config.overlayTextAnimDuration * 1000);
          
          if (!config.overlayTextAnimLoop && rawProgress > 1) {
            rawProgress = 1;
          } else if (config.overlayTextAnimLoop) {
            rawProgress = rawProgress % 1;
          }
          
          let easedProgress = rawProgress;
          switch(config.overlayTextAnimCurve) {
            case 'easeIn': easedProgress = rawProgress * rawProgress; break;
            case 'easeOut': easedProgress = rawProgress * (2 - rawProgress); break;
            case 'easeInOut': easedProgress = rawProgress < 0.5 ? 2 * rawProgress * rawProgress : -1 + (4 - 2 * rawProgress) * rawProgress; break;
            case 'linear':
            default: easedProgress = rawProgress; break;
          }

          if (config.colorMode === 'sweep' || config.charMode === 'sweep') {
            // Drift leftwards along the rotation angle as sweep progresses
            const driftDist = -easedProgress * config.overlayTextDriftAmount * config.motionIntensity;
            driftX = Math.cos(angleRad) * driftDist;
            driftY = Math.sin(angleRad) * driftDist;
          } else {
            const speed = easedProgress * Math.PI * 2;
            driftX = Math.sin(speed + textY * 0.05) * (config.overlayTextDriftAmount * 0.05) * config.motionIntensity;
            driftY = Math.cos(speed + textX * 0.05) * (config.overlayTextDriftAmount * 0.05) * config.motionIntensity;
          }
        }

        if (config.overlayTextRollingSpeed !== 0) {
          angleRad += (t * 0.002 * config.overlayTextRollingSpeed);
        }

        ctx.save();
        ctx.translate(textX + driftX, textY + driftY);
        ctx.rotate(angleRad);

        ctx.fillStyle = config.overlayTextColor;
        ctx.font = `900 ${config.overlayTextSize}px "Inter", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Add a subtle shadow for better visibility over the grid
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = Math.max(10, config.overlayTextSize * 0.1);
        ctx.fillText(config.overlayText, 0, 0);
        
        ctx.restore();
      }
    };

    const needsAnimationLoop = config.isAnimated || !!videoElement || ((config.colorMode === 'sweep' || config.charMode === 'sweep') && config.autoSweep) || config.overlayTextRollingSpeed !== 0 || config.overlayTextDrift;
    if (needsAnimationLoop) {
      const animate = (t: number) => {
        draw(t);
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    } else {
      setIsProcessing(true);
      setTimeout(() => {
        draw(0);
        setIsProcessing(false);
      }, 0);
    }
  }, [image, videoElement, config]);

  useEffect(() => {
    const mediaSource = videoElement || image;
    if (mediaSource) {
      const canvas = canvasRef.current;
      if (canvas) {
        const sourceWidth = videoElement ? videoElement.videoWidth : image!.width;
        const sourceHeight = videoElement ? videoElement.videoHeight : image!.height;
        if (sourceWidth > 0) {
          const scale = config.canvasWidth / sourceWidth;
          canvas.width = config.canvasWidth;
          canvas.height = sourceHeight * scale;
        }
      }
      
      cancelAnimationFrame(animationRef.current);
      renderFrame(0);
    }
    return () => cancelAnimationFrame(animationRef.current);
  }, [image, videoElement, config, renderFrame]);

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file);
        const vid = document.createElement('video');
        vid.src = url;
        vid.autoplay = true;
        vid.playsInline = true;
        vid.loop = true;
        vid.muted = true;
        vid.crossOrigin = "anonymous";
        vid.setAttribute('autoplay', '');
        vid.setAttribute('muted', '');
        vid.setAttribute('playsinline', '');
        vid.setAttribute('loop', '');
        vid.onloadeddata = () => {
          setVideoElement(vid);
          setImage(null);
          vid.play().catch(console.error);
        };
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
            setImage(img);
            setVideoElement(null);
          };
          img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const downloadResult = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = 'taskgraph-art.png';
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
  };

  const mediaRecorderRef = useRef<any>(null);

  const toggleRecording = () => {
    if (isRecording) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stopRecording(() => {
          const blob = mediaRecorderRef.current.getBlob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'taskgraph-loop.gif';
          link.click();
          setIsRecording(false);
        });
      }
    } else {
      if (!canvasRef.current) return;
      const stream = canvasRef.current.captureStream(gifFrameRate);
      const recorder = new RecordRTC(stream, { 
        type: 'gif',
        frameRate: gifFrameRate,
        quality: gifQuality,
        width: config.canvasWidth,
        height: canvasRef.current.height
      } as any);
      recorder.startRecording();
      setIsRecording(true);
      mediaRecorderRef.current = recorder;
    }
  };

  const generateVideo = async () => {
    if (!image) return;
    
    setIsGeneratingVideo(true);
    setGenerationProgress("Checking API key...");
    
    try {
      // Check API key
      if ((window as any).aistudio && !(await (window as any).aistudio.hasSelectedApiKey())) {
        await (window as any).aistudio.openSelectKey();
      }
      
      setGenerationProgress("Initializing AI...");
      
      const getApiKey = () => {
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) return process.env.API_KEY;
        if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
        if ((import.meta as any).env && (import.meta as any).env.VITE_GEMINI_API_KEY) return (import.meta as any).env.VITE_GEMINI_API_KEY;
        return '';
      };
      
      const apiKey = getApiKey();
      if (!apiKey) {
        throw new Error("API Key is missing. Please select a valid API key.");
      }
      
      const ai = new GoogleGenAI({ apiKey });
      
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Canvas context failed");
      ctx.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg');
      const base64 = dataUrl.split(',')[1];
      
      const aspectRatio = image.width > image.height ? '16:9' : '9:16';
      
      setGenerationProgress("Generating video (this takes a few minutes)...");
      
      let operation = await ai.models.generateVideos({
        model: 'veo-3.1-fast-generate-preview',
        prompt: aiPrompt,
        image: {
          imageBytes: base64,
          mimeType: 'image/jpeg',
        },
        config: {
          numberOfVideos: 1,
          resolution: '720p',
          aspectRatio: aspectRatio as '16:9' | '9:16'
        }
      });
      
      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        setGenerationProgress("Still generating... please wait...");
        operation = await ai.operations.getVideosOperation({operation: operation});
      }
      
      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error("No video generated");
      
      setGenerationProgress("Downloading video...");
      const response = await fetch(downloadLink, {
        method: 'GET',
        headers: {
          'x-goog-api-key': apiKey,
        },
      });
      
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Download failed: ${response.status} - ${errText.substring(0, 100)}`);
      }
      
      setGenerationProgress("Processing video file...");
      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error("Downloaded video is empty.");
      }
      const url = URL.createObjectURL(blob);
      
      setGenerationProgress("Loading video player...");
      const vid = document.createElement('video');
      vid.src = url;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.loop = true;
      vid.muted = true;
      vid.crossOrigin = "anonymous";
      vid.setAttribute('autoplay', '');
      vid.setAttribute('muted', '');
      vid.setAttribute('playsinline', '');
      vid.setAttribute('loop', '');
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Video load timeout. The file might be corrupted or unsupported."));
        }, 15000);
        
        vid.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Video element error: " + (vid.error?.message || "Unknown error")));
        };
        
        vid.onloadeddata = () => {
          clearTimeout(timeout);
          resolve(true);
        };
        
        vid.load();
      });
      
      setVideoElement(vid);
      setImage(null);
      vid.play().catch(console.error);
      setIsGeneratingVideo(false);
    } catch (err: any) {
      console.error(err);
      
      if (err.message && err.message.includes("Requested entity was not found")) {
        setGenerationProgress("Error: Please select a valid PAID API key.");
        if ((window as any).aistudio) {
          setTimeout(async () => {
            await (window as any).aistudio.openSelectKey();
            setIsGeneratingVideo(false);
          }, 2000);
          return;
        }
      } else {
        setGenerationProgress("Error: " + err.message);
      }
      
      setTimeout(() => setIsGeneratingVideo(false), 5000);
    }
  };

  return (
    <div className={`h-screen flex flex-col font-sans selection:bg-[#FF0000] selection:text-white transition-colors duration-300 ${isDarkMode ? 'bg-[#0A0A0A] text-[#E0E0E0]' : 'bg-[#F0F0F0] text-[#1A1A1A]'}`}>
      {/* Header */}
      <header className={`shrink-0 border-b p-6 flex justify-between items-center z-50 transition-colors duration-300 ${isDarkMode ? 'bg-[#0A0A0A] border-[#333]' : 'bg-white border-[#1A1A1A]'}`}>
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 flex items-center justify-center font-bold text-xl transition-colors ${isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A]' : 'bg-[#1A1A1A] text-white'}`}>
            M
          </div>
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter leading-none">TaskGraph</h1>
            <p className="text-[10px] uppercase tracking-widest opacity-50 font-mono mt-1">Machine v2.0-Industrial</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`px-4 py-2 border transition-colors flex items-center gap-2 text-[10px] font-bold uppercase ${isDarkMode ? 'border-[#333] hover:bg-[#333]' : 'border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white'}`}
          >
            {isDarkMode ? 'Light UI' : 'Dark UI'}
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            className={`px-4 py-2 border transition-colors flex items-center gap-2 text-[10px] font-bold uppercase ${isDarkMode ? 'border-[#333] hover:bg-[#333]' : 'border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white'}`}
          >
            <Upload size={14} />
            Upload
          </button>
          <button 
            onClick={toggleRecording}
            disabled={!image && !videoElement}
            className={`px-4 py-2 transition-colors flex items-center gap-2 text-[10px] font-bold uppercase disabled:opacity-30 disabled:cursor-not-allowed ${isRecording ? 'bg-[#FF0000] text-white animate-pulse' : (isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] hover:bg-[#FF0000] hover:text-white' : 'bg-[#1A1A1A] text-white hover:bg-[#FF0000]')}`}
          >
            {isRecording ? <Square size={14} /> : <Circle size={14} />}
            {isRecording ? 'Stop REC' : 'REC Loop'}
          </button>
          <button 
            onClick={downloadResult}
            disabled={!image && !videoElement}
            className={`px-4 py-2 transition-colors flex items-center gap-2 text-[10px] font-bold uppercase disabled:opacity-30 disabled:cursor-not-allowed ${isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] hover:bg-[#FF0000] hover:text-white' : 'bg-[#1A1A1A] text-white hover:bg-[#FF0000]'}`}
          >
            <Download size={14} />
            Export
          </button>
        </div>
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleFileUpload} 
          accept="image/*,video/*" 
          className="hidden" 
        />
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Sidebar Controls */}
        <aside className={`w-full lg:w-80 shrink-0 border-r overflow-y-auto custom-scrollbar p-6 space-y-8 transition-colors duration-300 ${isDarkMode ? 'bg-[#0A0A0A] border-[#333]' : 'bg-white border-[#1A1A1A]'}`}>
          {/* AI Video Generation Section */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Video size={18} />
              <h2 className="text-xs font-black uppercase tracking-widest">AI Video (Veo)</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Prompt</label>
                <textarea 
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  className={`w-full h-20 border p-3 text-xs font-mono outline-none resize-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                  placeholder="e.g. Sisyphus pushing a stone, looping animation"
                />
              </div>
              <button 
                onClick={generateVideo}
                disabled={isGeneratingVideo || !image}
                className={`w-full py-3 font-bold uppercase tracking-widest text-xs transition-colors ${isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] hover:bg-[#FF0000] hover:text-white' : 'bg-[#1A1A1A] text-white hover:bg-[#FF0000]'} disabled:opacity-50`}
              >
                {isGeneratingVideo ? 'Generating...' : 'Animate Image'}
              </button>
              {isGeneratingVideo && (
                <div className="text-[10px] font-mono text-[#FF0000] animate-pulse">
                  {generationProgress}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Settings2 size={18} />
              <h2 className="text-xs font-black uppercase tracking-widest">Core Settings</h2>
            </div>
            
            <div className="space-y-6">
              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Canvas Width: {config.canvasWidth}px</label>
                <input 
                  type="range" 
                  min="400" 
                  max="4000" 
                  step="100"
                  value={config.canvasWidth}
                  onChange={(e) => setConfig(prev => ({ ...prev, canvasWidth: parseInt(e.target.value) }))}
                  className={`w-full accent-[#FF0000] ${isDarkMode ? 'bg-[#333]' : 'bg-[#E0E0E0]'}`}
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Density (Grid Size)</label>
                <div className="grid grid-cols-4 gap-1">
                  {DENSITY_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setConfig(prev => ({ ...prev, density: preset.value }))}
                      className={`py-2 text-[10px] font-bold border ${
                        config.density === preset.value 
                          ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' 
                          : 'border-[#E0E0E0] hover:border-[#1A1A1A]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Base Font Size: {config.fontSize}px</label>
                <input 
                  type="range" 
                  min="4" 
                  max="32" 
                  value={config.fontSize}
                  onChange={(e) => setConfig(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                  className="w-full accent-[#1A1A1A]"
                />
              </div>

              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Color Mode</label>
                <div className="grid grid-cols-2 gap-1">
                  {(['monochrome', 'original', 'brutalist', 'invert', 'sweep'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setConfig(prev => ({ ...prev, colorMode: mode }))}
                      className={`px-3 py-2 text-[10px] font-bold border text-center uppercase transition-colors ${
                        config.colorMode === mode 
                          ? (isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] border-[#E0E0E0]' : 'bg-[#1A1A1A] text-white border-[#1A1A1A]')
                          : (isDarkMode ? 'border-[#333] hover:border-[#E0E0E0]' : 'border-[#E0E0E0] hover:border-[#1A1A1A]')
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {config.colorMode === 'monochrome' && (
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Ink Color</label>
                  <div className="flex gap-2">
                    <input 
                      type="color" 
                      value={config.monochromeColor}
                      onChange={(e) => setConfig(prev => ({ ...prev, monochromeColor: e.target.value }))}
                      className="w-10 h-10 border border-[#1A1A1A] p-0 bg-transparent cursor-pointer"
                    />
                    <input 
                      type="text" 
                      value={config.monochromeColor}
                      onChange={(e) => setConfig(prev => ({ ...prev, monochromeColor: e.target.value }))}
                      className="flex-1 border border-[#E0E0E0] px-3 text-xs font-mono uppercase"
                    />
                  </div>
                </div>
              )}

              {config.colorMode === 'sweep' && (
                <div className="space-y-4 mt-4 border-t border-[#E0E0E0] dark:border-[#333] pt-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Color 1</label>
                      <div className="flex gap-2">
                        <input 
                          type="color" 
                          value={config.sweepColor1}
                          onChange={(e) => setConfig(prev => ({ ...prev, sweepColor1: e.target.value }))}
                          className="w-8 h-8 border border-[#1A1A1A] p-0 bg-transparent cursor-pointer"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Color 2</label>
                      <div className="flex gap-2">
                        <input 
                          type="color" 
                          value={config.sweepColor2}
                          onChange={(e) => setConfig(prev => ({ ...prev, sweepColor2: e.target.value }))}
                          className="w-8 h-8 border border-[#1A1A1A] p-0 bg-transparent cursor-pointer"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Color 3</label>
                      <div className="flex gap-2">
                        <input 
                          type="color" 
                          value={config.sweepColor3}
                          onChange={(e) => setConfig(prev => ({ ...prev, sweepColor3: e.target.value }))}
                          className="w-8 h-8 border border-[#1A1A1A] p-0 bg-transparent cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] uppercase font-bold opacity-50">Sweep Progress</label>
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] uppercase font-bold opacity-50">Auto</label>
                        <button 
                          onClick={() => setConfig(prev => ({ ...prev, autoSweep: !prev.autoSweep }))}
                          className={`w-8 h-4 rounded-full relative transition-colors ${config.autoSweep ? 'bg-[#1A1A1A] dark:bg-[#E0E0E0]' : 'bg-[#E0E0E0] dark:bg-[#333]'}`}
                        >
                          <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${config.autoSweep ? 'right-0.5 bg-white dark:bg-[#0A0A0A]' : 'left-0.5 bg-white dark:bg-[#888]'}`} />
                        </button>
                      </div>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="200" 
                      value={config.sweepProgress}
                      onChange={(e) => setConfig(prev => ({ ...prev, sweepProgress: parseInt(e.target.value), autoSweep: false }))}
                      className="w-full accent-[#1A1A1A]"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Type size={18} />
              <h2 className="text-xs font-black uppercase tracking-widest">Typography</h2>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-bold opacity-50">Character Mode</label>
                <div className="flex flex-wrap gap-1 justify-end">
                  {(['charset', 'words', 'emojis', 'sweep'] as const).map(mode => (
                    <button
                      key={mode}
                      onClick={() => setConfig(prev => ({ ...prev, charMode: mode }))}
                      className={`px-2 py-1 text-[10px] font-bold border uppercase ${
                        config.charMode === mode 
                          ? (isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] border-[#E0E0E0]' : 'bg-[#1A1A1A] text-white border-[#1A1A1A]')
                          : (isDarkMode ? 'border-[#333] hover:border-[#E0E0E0]' : 'border-[#E0E0E0] hover:border-[#1A1A1A]')
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {config.charMode === 'sweep' && (
                <div className="space-y-4 mt-4 border-t border-[#E0E0E0] dark:border-[#333] pt-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Emoji 1</label>
                      <input 
                        type="text" 
                        value={config.sweepChar1}
                        onChange={(e) => setConfig(prev => ({ ...prev, sweepChar1: e.target.value }))}
                        className={`w-full border p-2 text-center text-base outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Emoji 2</label>
                      <input 
                        type="text" 
                        value={config.sweepChar2}
                        onChange={(e) => setConfig(prev => ({ ...prev, sweepChar2: e.target.value }))}
                        className={`w-full border p-2 text-center text-base outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Emoji 3</label>
                      <input 
                        type="text" 
                        value={config.sweepChar3}
                        onChange={(e) => setConfig(prev => ({ ...prev, sweepChar3: e.target.value }))}
                        className={`w-full border p-2 text-center text-base outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                      />
                    </div>
                  </div>
                  {config.colorMode !== 'sweep' && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[10px] uppercase font-bold opacity-50">Sweep Progress</label>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] uppercase font-bold opacity-50">Auto</label>
                          <button 
                            onClick={() => setConfig(prev => ({ ...prev, autoSweep: !prev.autoSweep }))}
                            className={`w-8 h-4 rounded-full relative transition-colors ${config.autoSweep ? 'bg-[#1A1A1A] dark:bg-[#E0E0E0]' : 'bg-[#E0E0E0] dark:bg-[#333]'}`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${config.autoSweep ? 'right-0.5 bg-white dark:bg-[#0A0A0A]' : 'left-0.5 bg-white dark:bg-[#888]'}`} />
                          </button>
                        </div>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="200" 
                        value={config.sweepProgress}
                        onChange={(e) => setConfig(prev => ({ ...prev, sweepProgress: parseInt(e.target.value), autoSweep: false }))}
                        className="w-full accent-[#1A1A1A]"
                      />
                    </div>
                  )}
                </div>
              )}

              {config.charMode === 'words' && (
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Source Words (Space separated)</label>
                  <textarea 
                    value={config.customWords}
                    onChange={(e) => setConfig(prev => ({ ...prev, customWords: e.target.value }))}
                    className={`w-full h-24 border p-3 text-xs font-mono outline-none resize-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                    placeholder="Enter words to form the image..."
                  />
                </div>
              )}
              
              {config.charMode === 'charset' && (
                <div>
                  <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Character Set</label>
                  <input 
                    type="text" 
                    value={config.charset}
                    onChange={(e) => setConfig(prev => ({ ...prev, charset: e.target.value }))}
                    className={`w-full border p-3 text-xs font-mono outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                  />
                </div>
              )}

              {config.charMode === 'emojis' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-1">Dark</label>
                      <input 
                        type="text" 
                        value={config.emojiDark}
                        onChange={(e) => setConfig(prev => ({ ...prev, emojiDark: e.target.value }))}
                        className={`w-full border p-2 text-center text-base outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-1">Mid</label>
                      <input 
                        type="text" 
                        value={config.emojiMid}
                        onChange={(e) => setConfig(prev => ({ ...prev, emojiMid: e.target.value }))}
                        className={`w-full border p-2 text-center text-base outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-1">Light</label>
                      <input 
                        type="text" 
                        value={config.emojiLight}
                        onChange={(e) => setConfig(prev => ({ ...prev, emojiLight: e.target.value }))}
                        className={`w-full border p-2 text-center text-base outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Dark/Mid Threshold: {config.emojiThreshold1}</label>
                    <input 
                      type="range" 
                      min="10" 
                      max="240" 
                      value={config.emojiThreshold1}
                      onChange={(e) => setConfig(prev => ({ ...prev, emojiThreshold1: parseInt(e.target.value) }))}
                      className="w-full accent-[#1A1A1A]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Mid/Light Threshold: {config.emojiThreshold2}</label>
                    <input 
                      type="range" 
                      min="20" 
                      max="250" 
                      value={config.emojiThreshold2}
                      onChange={(e) => setConfig(prev => ({ ...prev, emojiThreshold2: parseInt(e.target.value) }))}
                      className="w-full accent-[#1A1A1A]"
                    />
                  </div>
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Type size={18} />
              <h2 className="text-xs font-black uppercase tracking-widest">Overlay Text</h2>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-bold opacity-50">Show Text</label>
                <button 
                  onClick={() => setConfig(prev => ({ ...prev, showOverlayText: !prev.showOverlayText }))}
                  className={`w-10 h-5 rounded-full relative transition-colors ${config.showOverlayText ? 'bg-[#1A1A1A] dark:bg-[#E0E0E0]' : 'bg-[#E0E0E0] dark:bg-[#333]'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${config.showOverlayText ? 'right-1 bg-white dark:bg-[#0A0A0A]' : 'left-1 bg-white dark:bg-[#888]'}`} />
                </button>
              </div>

              {config.showOverlayText && (
                <div className="space-y-4 pt-2 border-t border-[#F0F0F0] dark:border-[#333]">
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Text Content</label>
                    <input 
                      type="text" 
                      value={config.overlayText}
                      onChange={(e) => setConfig(prev => ({ ...prev, overlayText: e.target.value }))}
                      className={`w-full border p-3 text-xs font-bold outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333] focus:border-[#E0E0E0]' : 'bg-white border-[#E0E0E0] focus:border-[#1A1A1A]'}`}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Size: {config.overlayTextSize}px</label>
                      <input 
                        type="range" 
                        min="20" 
                        max="400" 
                        value={config.overlayTextSize}
                        onChange={(e) => setConfig(prev => ({ ...prev, overlayTextSize: parseInt(e.target.value) }))}
                        className="w-full accent-[#1A1A1A]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Color</label>
                      <div className="flex gap-2">
                        <input 
                          type="color" 
                          value={config.overlayTextColor}
                          onChange={(e) => setConfig(prev => ({ ...prev, overlayTextColor: e.target.value }))}
                          className="w-8 h-8 border border-[#1A1A1A] p-0 bg-transparent cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase font-bold opacity-50">Position Mode</label>
                    <div className="flex gap-1">
                      {(['global', 'track_ball'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setConfig(prev => ({ ...prev, overlayTextMode: mode }))}
                          className={`px-2 py-1 text-[10px] font-bold border uppercase ${
                            config.overlayTextMode === mode 
                              ? (isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] border-[#E0E0E0]' : 'bg-[#1A1A1A] text-white border-[#1A1A1A]')
                              : (isDarkMode ? 'border-[#333] hover:border-[#E0E0E0]' : 'border-[#E0E0E0] hover:border-[#1A1A1A]')
                          }`}
                        >
                          {mode.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>

                  {config.overlayTextMode === 'global' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Pos X: {config.overlayTextPositionX}%</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={config.overlayTextPositionX}
                          onChange={(e) => setConfig(prev => ({ ...prev, overlayTextPositionX: parseInt(e.target.value) }))}
                          className="w-full accent-[#1A1A1A]"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Pos Y: {config.overlayTextPositionY}%</label>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={config.overlayTextPositionY}
                          onChange={(e) => setConfig(prev => ({ ...prev, overlayTextPositionY: parseInt(e.target.value) }))}
                          className="w-full accent-[#1A1A1A]"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Rotation: {config.overlayTextRotation}°</label>
                    <input 
                      type="range" 
                      min="-180" 
                      max="180" 
                      value={config.overlayTextRotation}
                      onChange={(e) => setConfig(prev => ({ ...prev, overlayTextRotation: parseInt(e.target.value) }))}
                      className="w-full accent-[#1A1A1A]"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Rolling Speed: {config.overlayTextRollingSpeed}</label>
                    <input 
                      type="range" 
                      min="-10" 
                      max="10" 
                      value={config.overlayTextRollingSpeed}
                      onChange={(e) => setConfig(prev => ({ ...prev, overlayTextRollingSpeed: parseInt(e.target.value) }))}
                      className="w-full accent-[#1A1A1A]"
                    />
                  </div>

                  <div className="space-y-4 pt-2 border-t border-[#F0F0F0] dark:border-[#333]">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] uppercase font-bold opacity-50">Drift with Animation</label>
                      <button 
                        onClick={() => setConfig(prev => ({ ...prev, overlayTextDrift: !prev.overlayTextDrift }))}
                        className={`w-8 h-4 rounded-full relative transition-colors ${config.overlayTextDrift ? 'bg-[#1A1A1A] dark:bg-[#E0E0E0]' : 'bg-[#E0E0E0] dark:bg-[#333]'}`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${config.overlayTextDrift ? 'right-0.5 bg-white dark:bg-[#0A0A0A]' : 'left-0.5 bg-white dark:bg-[#888]'}`} />
                      </button>
                    </div>
                    
                    {config.overlayTextDrift && (
                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Drift Amount: {config.overlayTextDriftAmount}</label>
                          <input 
                            type="range" 
                            min="0" 
                            max="1000" 
                            value={config.overlayTextDriftAmount}
                            onChange={(e) => setConfig(prev => ({ ...prev, overlayTextDriftAmount: parseInt(e.target.value) }))}
                            className="w-full accent-[#1A1A1A]"
                          />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Curve</label>
                            <select 
                              value={config.overlayTextAnimCurve}
                              onChange={(e) => setConfig(prev => ({ ...prev, overlayTextAnimCurve: e.target.value as any }))}
                              className={`w-full border p-2 text-xs font-bold outline-none transition-colors ${isDarkMode ? 'bg-[#111] border-[#333]' : 'bg-white border-[#E0E0E0]'}`}
                            >
                              <option value="linear">Linear</option>
                              <option value="easeIn">Ease In</option>
                              <option value="easeOut">Ease Out</option>
                              <option value="easeInOut">Ease In Out</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Duration: {config.overlayTextAnimDuration}s</label>
                            <input 
                              type="range" 
                              min="0.1" 
                              max="10" 
                              step="0.1"
                              value={config.overlayTextAnimDuration}
                              onChange={(e) => setConfig(prev => ({ ...prev, overlayTextAnimDuration: parseFloat(e.target.value) }))}
                              className="w-full accent-[#1A1A1A]"
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <label className="text-[10px] uppercase font-bold opacity-50">Loop Animation</label>
                          <button 
                            onClick={() => setConfig(prev => ({ ...prev, overlayTextAnimLoop: !prev.overlayTextAnimLoop }))}
                            className={`w-8 h-4 rounded-full relative transition-colors ${config.overlayTextAnimLoop ? 'bg-[#1A1A1A] dark:bg-[#E0E0E0]' : 'bg-[#E0E0E0] dark:bg-[#333]'}`}
                          >
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${config.overlayTextAnimLoop ? 'right-0.5 bg-white dark:bg-[#0A0A0A]' : 'left-0.5 bg-white dark:bg-[#888]'}`} />
                          </button>
                        </div>

                        {!config.overlayTextAnimLoop && (
                          <button
                            onClick={() => setConfig(prev => ({ ...prev, overlayTextAnimTrigger: performance.now() }))}
                            className={`w-full py-2 text-xs font-bold uppercase tracking-wider border transition-colors ${isDarkMode ? 'border-[#333] hover:bg-[#333]' : 'border-[#E0E0E0] hover:bg-[#F5F5F5]'}`}
                          >
                            Play Animation
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Palette size={18} />
              <h2 className="text-xs font-black uppercase tracking-widest">Image Adjust</h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Contrast: {config.contrast.toFixed(1)}</label>
                <input 
                  type="range" 
                  min="0.5" 
                  max="3" 
                  step="0.1"
                  value={config.contrast}
                  onChange={(e) => setConfig(prev => ({ ...prev, contrast: parseFloat(e.target.value) }))}
                  className="w-full accent-[#1A1A1A]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Brightness: {config.brightness.toFixed(1)}</label>
                <input 
                  type="range" 
                  min="0.5" 
                  max="2" 
                  step="0.1"
                  value={config.brightness}
                  onChange={(e) => setConfig(prev => ({ ...prev, brightness: parseFloat(e.target.value) }))}
                  className="w-full accent-[#1A1A1A]"
                />
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <RefreshCw size={18} />
              <h2 className="text-xs font-black uppercase tracking-widest">Animation & Motion</h2>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase font-bold opacity-50">Enable Animation</label>
                <button 
                  onClick={() => setConfig(prev => ({ ...prev, isAnimated: !prev.isAnimated }))}
                  className={`w-10 h-5 rounded-full relative transition-colors ${config.isAnimated ? 'bg-[#FF0000]' : 'bg-[#E0E0E0]'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${config.isAnimated ? 'right-1' : 'left-1'}`} />
                </button>
              </div>

              {config.isAnimated && (
                <div className="space-y-4 pt-2 border-t border-[#F0F0F0]">
                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Motion Mode</label>
                    <div className="grid grid-cols-2 gap-1">
                      {(['float', 'flow', 'stress', 'wave', 'glitch', 'spiral', 'pulse'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setConfig(prev => ({ ...prev, animationMode: mode }))}
                          className={`py-2 text-[10px] font-bold border uppercase ${
                            config.animationMode === mode 
                              ? 'bg-[#FF0000] text-white border-[#FF0000]' 
                              : 'border-[#E0E0E0] hover:border-[#1A1A1A]'
                          }`}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {config.animationMode === 'flow' && (
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Flow Angle: {config.flowAngle}°</label>
                      <input 
                        type="range" 
                        min="0" 
                        max="360" 
                        value={config.flowAngle}
                        onChange={(e) => setConfig(prev => ({ ...prev, flowAngle: parseInt(e.target.value) }))}
                        className="w-full accent-[#1A1A1A]"
                      />
                    </div>
                  )}

                  {config.animationMode === 'wave' && (
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Wave Freq: {config.waveFrequency.toFixed(3)}</label>
                      <input 
                        type="range" 
                        min="0.001" 
                        max="0.2" 
                        step="0.001"
                        value={config.waveFrequency}
                        onChange={(e) => setConfig(prev => ({ ...prev, waveFrequency: parseFloat(e.target.value) }))}
                        className="w-full accent-[#1A1A1A]"
                      />
                    </div>
                  )}

                  {config.animationMode === 'glitch' && (
                    <div>
                      <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Glitch Freq: {config.glitchFrequency.toFixed(2)}</label>
                      <input 
                        type="range" 
                        min="0.01" 
                        max="0.5" 
                        step="0.01"
                        value={config.glitchFrequency}
                        onChange={(e) => setConfig(prev => ({ ...prev, glitchFrequency: parseFloat(e.target.value) }))}
                        className="w-full accent-[#1A1A1A]"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Intensity: {config.motionIntensity.toFixed(1)}x</label>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="3" 
                      step="0.1"
                      value={config.motionIntensity}
                      onChange={(e) => setConfig(prev => ({ ...prev, motionIntensity: parseFloat(e.target.value) }))}
                      className="w-full accent-[#1A1A1A]"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Motion Speed: {config.animationSpeed.toFixed(1)}x</label>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="5" 
                      step="0.1"
                      value={config.animationSpeed}
                      onChange={(e) => setConfig(prev => ({ ...prev, animationSpeed: parseFloat(e.target.value) }))}
                      className="w-full accent-[#1A1A1A]"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">Readability Boost: {(config.readability * 100).toFixed(0)}%</label>
                <input 
                  type="range" 
                  min="0" 
                  max="1" 
                  step="0.05"
                  value={config.readability}
                  onChange={(e) => setConfig(prev => ({ ...prev, readability: parseFloat(e.target.value) }))}
                  className="w-full accent-[#1A1A1A]"
                />
              </div>
            </div>
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4">
              <Download size={18} />
              <h2 className="text-xs font-black uppercase tracking-widest">Export Settings</h2>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">GIF Frame Rate: {gifFrameRate} fps</label>
                <input 
                  type="range" 
                  min="5" 
                  max="60" 
                  step="1"
                  value={gifFrameRate}
                  onChange={(e) => setGifFrameRate(parseInt(e.target.value))}
                  className={`w-full accent-[#FF0000] ${isDarkMode ? 'bg-[#333]' : 'bg-[#E0E0E0]'}`}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold opacity-50 block mb-2">GIF Quality: {gifQuality} (Lower is better)</label>
                <input 
                  type="range" 
                  min="1" 
                  max="30" 
                  step="1"
                  value={gifQuality}
                  onChange={(e) => setGifQuality(parseInt(e.target.value))}
                  className={`w-full accent-[#FF0000] ${isDarkMode ? 'bg-[#333]' : 'bg-[#E0E0E0]'}`}
                />
              </div>
            </div>
          </section>

          <div className={`pt-4 border-t ${isDarkMode ? 'border-[#333]' : 'border-[#E0E0E0]'}`}>
            <button 
              onClick={() => renderFrame(0)}
              className={`w-full py-4 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-colors ${isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] hover:bg-[#FF0000] hover:text-white' : 'bg-[#1A1A1A] text-white hover:bg-[#FF0000]'}`}
            >
              <RefreshCw size={14} className={isProcessing ? 'animate-spin' : ''} />
              Refresh Engine
            </button>
          </div>
        </aside>

        {/* Preview Area */}
        <section className={`flex-1 relative overflow-hidden flex items-center justify-center p-8 transition-colors duration-300 ${isDarkMode ? 'bg-[#111]' : 'bg-[#E5E5E5]'}`}>
          <AnimatePresence mode="wait">
            {(!image && !videoElement) ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`max-w-md w-full border-2 border-dashed p-12 text-center backdrop-blur-sm transition-colors ${isDarkMode ? 'bg-white/5 border-[#333]' : 'bg-white/50 border-[#1A1A1A]'}`}
              >
                <div className={`w-16 h-16 flex items-center justify-center mx-auto mb-6 transition-colors ${isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A]' : 'bg-[#1A1A1A] text-white'}`}>
                  <ImageIcon size={32} />
                </div>
                <h3 className="text-xl font-black uppercase tracking-tight mb-2">No Media Loaded</h3>
                <p className="text-sm opacity-60 mb-8">Upload a photo or video to start generating typographic art. High contrast works best.</p>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className={`px-8 py-3 font-bold uppercase tracking-widest text-xs transition-colors ${isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A] hover:bg-[#FF0000] hover:text-white' : 'bg-[#1A1A1A] text-white hover:bg-[#FF0000]'}`}
                >
                  Select File
                </button>
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative group cursor-crosshair"
              >
                <div className="absolute -top-6 left-0 text-[10px] font-mono uppercase opacity-40 flex items-center gap-2">
                  <Move size={10} />
                  Preview Canvas | {canvasRef.current?.width}x{canvasRef.current?.height}
                </div>
                
                <div className={`shadow-[20px_20px_0px_0px_rgba(0,0,0,0.1)] border p-4 transition-colors ${isDarkMode ? 'bg-[#0A0A0A] border-[#333]' : 'bg-white border-[#1A1A1A]'}`}>
                  <canvas 
                    ref={canvasRef} 
                    className="max-w-full max-h-[70vh] object-contain"
                  />
                  {/* Render video invisibly to ensure browser doesn't pause it */}
                  <div 
                    style={{ display: 'none' }} 
                    ref={(el) => {
                      if (el && videoElement && !el.contains(videoElement)) {
                        el.innerHTML = '';
                        el.appendChild(videoElement);
                        videoElement.play().catch(console.error);
                      }
                    }}
                  />
                </div>

                {isProcessing && (
                  <div className={`absolute inset-0 backdrop-blur-[2px] flex items-center justify-center transition-colors ${isDarkMode ? 'bg-black/40' : 'bg-white/40'}`}>
                    <div className={`px-6 py-3 font-black uppercase tracking-widest text-xs flex items-center gap-3 transition-colors ${isDarkMode ? 'bg-[#E0E0E0] text-[#0A0A0A]' : 'bg-[#1A1A1A] text-white'}`}>
                      <RefreshCw size={14} className="animate-spin" />
                      Processing...
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Decorative Elements */}
          <div className="absolute bottom-6 left-6 text-[10px] font-mono uppercase opacity-30 text-left space-y-1">
            <div>Engine: TaskGraph v2.0-Machine</div>
            <div>Status: {isProcessing ? 'Processing' : 'Idle'}</div>
            <div>Resolution: {canvasRef.current?.width} x {canvasRef.current?.height}</div>
            <div>Frame: {Math.floor(Date.now() / 16) % 10000}</div>
          </div>
          
          <div className="absolute top-6 left-6 flex flex-col gap-1">
            {[...Array(8)].map((_, i) => (
              <div key={i} className={`w-12 h-[1px] opacity-10 ${isDarkMode ? 'bg-white' : 'bg-[#1A1A1A]'}`} />
            ))}
          </div>

          <div className="absolute top-1/2 right-6 -translate-y-1/2 flex flex-col gap-4 opacity-20">
            <div className="writing-vertical-rl text-[8px] font-mono uppercase tracking-[0.5em]">System.Active</div>
            <div className={`w-[1px] h-32 mx-auto ${isDarkMode ? 'bg-white' : 'bg-[#1A1A1A]'}`} />
            <div className="writing-vertical-rl text-[8px] font-mono uppercase tracking-[0.5em]">Buffer.Sync</div>
          </div>
        </section>
      </main>
    </div>
  );
}
