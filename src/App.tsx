/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, RefreshCw, Circle, Square, ChevronDown, ChevronsLeft, ChevronsRight, Sparkles, Sun, Moon, Camera, Play, Pause, Volume2, VolumeX, FolderOpen, SlidersHorizontal } from 'lucide-react';
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

// Style presets — the primary "pick a look" control. Each applies a bundle of
// low-level settings so the user doesn't have to touch Color/Typography/charset
// separately to get a coherent result.
interface StylePreset {
  id: string;
  name: string;
  swatch: { bg: string; fg: string; sample: string };
  config: Partial<Config>;
}

const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'ascii',
    name: 'ASCII Terminal',
    swatch: { bg: '#000000', fg: '#FFFFFF', sample: '#@%+=:' },
    config: { charMode: 'charset', charset: ' .:-=+*#%@$MW059', colorMode: 'invert', density: 8, isAnimated: false },
  },
  {
    id: 'mono',
    name: 'Mono Dots',
    swatch: { bg: '#FFFFFF', fg: '#000000', sample: '#+=-:.' },
    config: { charMode: 'charset', charset: ' .:-=+#', colorMode: 'monochrome', monochromeColor: '#000000', density: 8, isAnimated: false },
  },
  {
    id: 'emoji',
    name: 'Emoji Mosaic',
    swatch: { bg: '#F2F2F2', fg: '#000000', sample: '🧍🪨☁️' },
    config: { charMode: 'emojis', colorMode: 'original', density: 8, isAnimated: false },
  },
  {
    id: 'sweep',
    name: 'Color Sweep',
    swatch: { bg: '#111111', fg: '#22C55E', sample: '▓▒░' },
    config: { charMode: 'sweep', colorMode: 'sweep', autoSweep: true, density: 8, isAnimated: false },
  },
  {
    id: 'glitch',
    name: 'Neon Glitch',
    swatch: { bg: '#000000', fg: '#22C55E', sample: '01#!?' },
    config: { charMode: 'charset', charset: '01#!?*', colorMode: 'brutalist', density: 6, isAnimated: false },
  },
];

// Aspect ratio options for the canvas frame. 'source' follows the uploaded
// media's own ratio; the rest crop/cover the source into a fixed frame.
const ASPECT_RATIOS: { id: string; label: string; w: number; h: number }[] = [
  { id: 'source', label: 'Auto', w: 1, h: 1 },
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
];

function computeCanvasDims(canvasWidth: number, aspectRatio: string, srcW: number, srcH: number) {
  if (aspectRatio === 'source' || !srcW || !srcH) {
    return { width: canvasWidth, height: Math.round(srcH * (canvasWidth / srcW)) || canvasWidth };
  }
  const [rw, rh] = aspectRatio.split(':').map(Number);
  return { width: canvasWidth, height: Math.round((canvasWidth * rh) / rw) };
}

// Draw source into a target of dw×dh using object-fit: cover (preserve aspect,
// crop overflow, center) so a fixed frame never distorts the image.
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
) {
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(src, (dw - w) / 2, (dh - h) / 2, w, h);
}

interface Config {
  charset: string;
  density: number;
  fontSize: number;
  canvasWidth: number;
  aspectRatio: string;
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

interface SectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  isDarkMode: boolean;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, isOpen, onToggle, isDarkMode, children }) => {
  return (
    <div className={`border-b ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
      <button
        onClick={onToggle}
        className={`w-full flex items-center justify-between py-4 text-left transition-colors ${isDarkMode ? 'hover:text-white' : 'hover:text-black'}`}
      >
        <span className="text-[15px] font-medium">{title}</span>
        <ChevronDown
          size={16}
          className={`transition-transform duration-200 opacity-40 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pb-5 space-y-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  isDarkMode: boolean;
}

const Toggle: React.FC<ToggleProps> = ({ checked, onChange, isDarkMode }) => (
  <button
    onClick={onChange}
    className={`w-9 h-5 rounded-full relative shrink-0 transition-colors ${
      checked ? (isDarkMode ? 'bg-white' : 'bg-[#1A1A1A]') : (isDarkMode ? 'bg-[#333]' : 'bg-[#E5E5E5]')
    }`}
  >
    <div
      className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
        checked
          ? `right-0.5 ${isDarkMode ? 'bg-black' : 'bg-white'}`
          : `left-0.5 ${isDarkMode ? 'bg-[#999]' : 'bg-white'}`
      }`}
    />
  </button>
);

const labelCls = "text-xs opacity-50 block mb-2";
const pillGroupCls = "flex flex-wrap gap-1.5";

function pillCls(active: boolean, isDarkMode: boolean) {
  return `px-3 py-1.5 text-xs rounded-full border capitalize transition-colors ${
    active
      ? (isDarkMode ? 'bg-white text-black border-white' : 'bg-[#1A1A1A] text-white border-[#1A1A1A]')
      : (isDarkMode ? 'border-[#333] text-[#999] hover:border-[#666]' : 'border-[#E5E5E5] text-[#666] hover:border-[#BBB]')
  }`;
}

function inputCls(isDarkMode: boolean) {
  return `w-full border rounded-lg px-3 py-2 text-xs outline-none transition-colors ${
    isDarkMode ? 'bg-[#151515] border-[#333] focus:border-[#666]' : 'bg-[#FAFAFA] border-[#E5E5E5] focus:border-[#1A1A1A]'
  }`;
}

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

  // UI Layout State
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['canvas']));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [canvasDims, setCanvasDims] = useState({ width: 0, height: 0 });

  const applyPreset = (preset: StylePreset) => {
    setConfig(prev => ({ ...prev, ...preset.config }));
    setActivePreset(preset.id);
  };

  // Asset preview (thumbnail card in sidebar) — separate lightweight <video>/<img>
  // from the internal videoElement used for canvas sampling.
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(true);
  const [previewMuted, setPreviewMuted] = useState(true);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaType: 'video' | 'image' | null = videoElement ? 'video' : (image ? 'image' : null);

  const togglePreviewPlayback = () => {
    const el = previewVideoRef.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => {}); setPreviewPlaying(true); }
    else { el.pause(); setPreviewPlaying(false); }
  };

  const togglePreviewMute = () => {
    const el = previewVideoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setPreviewMuted(el.muted);
  };

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [config, setConfig] = useState<Config>({
    charset: DEFAULT_CHARSET,
    density: 8,
    fontSize: 10,
    canvasWidth: 1200,
    aspectRatio: 'source',
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
    
    const dims = computeCanvasDims(config.canvasWidth, config.aspectRatio, sourceWidth, sourceHeight);
    tempCanvas.width = dims.width;
    tempCanvas.height = dims.height;

    const draw = (t: number) => {
      // For video, we must re-sample the pixels every frame
      tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
      drawCover(tempCtx, mediaSource, sourceWidth, sourceHeight, tempCanvas.width, tempCanvas.height);
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
          const dims = computeCanvasDims(config.canvasWidth, config.aspectRatio, sourceWidth, sourceHeight);
          canvas.width = dims.width;
          canvas.height = dims.height;
          setCanvasDims(dims);
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
          setMediaPreviewUrl(url);
          setPreviewPlaying(true);
          vid.play().catch(console.error);
        };
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          const img = new Image();
          img.onload = () => {
            setImage(img);
            setVideoElement(null);
            setMediaPreviewUrl(dataUrl);
          };
          img.src = dataUrl;
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
      setMediaPreviewUrl(url);
      setPreviewPlaying(true);
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
    <div className={`h-screen flex font-sans overflow-hidden transition-colors duration-300 ${isDarkMode ? 'bg-[#0A0A0A] text-[#EDEDED]' : 'bg-white text-[#141414]'}`}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/*,video/*"
        className="hidden"
      />

      {/* Sidebar */}
      <AnimatePresence initial={false}>
        {!sidebarCollapsed && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className={`relative shrink-0 h-full overflow-hidden border-r ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}
          >
            <div className="w-[320px] h-full flex flex-col">
              {/* Header */}
              <div className={`shrink-0 flex items-center justify-between px-5 py-4 border-b ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
                <div className="flex items-center gap-2.5">
                  <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${isDarkMode ? 'bg-white text-black' : 'bg-[#141414] text-white'}`}>
                    T
                  </div>
                  <span className="text-sm font-medium">TaskGraph</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FF0000]" />
                </div>
                <button
                  onClick={() => setIsDarkMode(!isDarkMode)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-[#1A1A1A]' : 'hover:bg-[#F5F5F5]'}`}
                  title="Toggle theme"
                >
                  {isDarkMode ? <Sun size={14} /> : <Moon size={14} />}
                </button>
              </div>

              {/* Scrollable sections */}
              <div className="flex-1 overflow-y-auto custom-scrollbar px-5">
                {/* SOURCE — always visible */}
                <div className={`py-5 space-y-4 border-b ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
                  <span className="text-[11px] font-medium uppercase tracking-wider opacity-40">Source</span>
                  {mediaPreviewUrl ? (
                    <div>
                      <span className="text-[11px] opacity-40 block mb-2">{mediaType === 'video' ? 'Video' : 'Image'}</span>
                      <div className={`relative rounded-xl overflow-hidden aspect-video ${isDarkMode ? 'bg-[#141414]' : 'bg-[#F5F5F5]'}`}>
                        {mediaType === 'video' ? (
                          <video
                            ref={previewVideoRef}
                            src={mediaPreviewUrl}
                            className="w-full h-full object-cover"
                            autoPlay
                            loop
                            muted={previewMuted}
                            playsInline
                          />
                        ) : (
                          <img src={mediaPreviewUrl} className="w-full h-full object-cover" />
                        )}

                        {mediaType === 'video' && (
                          <>
                            <button
                              onClick={togglePreviewPlayback}
                              className="absolute inset-0 m-auto w-9 h-9 rounded-full bg-white/90 text-black flex items-center justify-center hover:bg-white transition-colors"
                            >
                              {previewPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                            </button>
                            <button
                              onClick={togglePreviewMute}
                              className="absolute bottom-2 left-2 w-7 h-7 rounded-full bg-white/90 text-black flex items-center justify-center hover:bg-white transition-colors"
                            >
                              {previewMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                            </button>
                          </>
                        )}

                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white/90 text-black flex items-center justify-center hover:bg-white transition-colors"
                          title="Replace file"
                        >
                          <FolderOpen size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className={`w-full py-8 rounded-xl border border-dashed flex flex-col items-center gap-2 transition-colors ${isDarkMode ? 'border-[#333] hover:border-[#666]' : 'border-[#DDD] hover:border-[#999]'}`}
                    >
                      <Upload size={18} className="opacity-50" />
                      <span className="text-xs opacity-50">Upload photo or video</span>
                    </button>
                  )}

                  <div className={`pt-1 space-y-3 ${mediaPreviewUrl ? 'mt-1' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs opacity-50">Animate with AI (Veo)</span>
                    </div>
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      className={`${inputCls(isDarkMode)} h-16 resize-none`}
                      placeholder="Describe the motion to generate..."
                    />
                    <button
                      onClick={generateVideo}
                      disabled={isGeneratingVideo || !image}
                      className={`w-full py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDarkMode ? 'bg-white text-black hover:opacity-80' : 'bg-[#141414] text-white hover:opacity-80'}`}
                    >
                      <Sparkles size={13} />
                      {isGeneratingVideo ? 'Generating...' : 'Animate Image'}
                    </button>
                    {isGeneratingVideo && (
                      <div className="text-[11px] text-[#FF0000] animate-pulse">{generationProgress}</div>
                    )}
                  </div>
                </div>

                {/* STYLE — the hero: pick a look in one click */}
                <div className={`py-5 space-y-3 border-b ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
                  <span className="text-[11px] font-medium uppercase tracking-wider opacity-40">Style</span>
                  <div className="grid grid-cols-2 gap-2">
                    {STYLE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => applyPreset(p)}
                        className={`rounded-xl overflow-hidden border text-left transition-all ${
                          activePreset === p.id
                            ? (isDarkMode ? 'border-white' : 'border-[#141414]')
                            : (isDarkMode ? 'border-[#242424] hover:border-[#444]' : 'border-[#EEE] hover:border-[#CCC]')
                        }`}
                      >
                        <div
                          className="h-11 flex items-center justify-center text-sm tracking-widest font-mono"
                          style={{ background: p.swatch.bg, color: p.swatch.fg }}
                        >
                          {p.swatch.sample}
                        </div>
                        <div className={`px-2.5 py-1.5 text-[11px] font-medium ${activePreset === p.id ? '' : 'opacity-70'}`}>
                          {p.name}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ADVANCED — everything else, collapsed by default */}
                <button
                  onClick={() => setShowAdvanced(v => !v)}
                  className={`w-full flex items-center justify-between py-4 text-left transition-colors ${isDarkMode ? 'hover:text-white' : 'hover:text-black'}`}
                >
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={14} className="opacity-40" />
                    <span className="text-[15px] font-medium">Advanced</span>
                  </div>
                  <ChevronDown size={16} className={`transition-transform duration-200 opacity-40 ${showAdvanced ? 'rotate-180' : ''}`} />
                </button>

                {showAdvanced && (
                <div className={`border-t ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
                {/* Canvas */}
                <Section title="Canvas" isOpen={openSections.has('canvas')} onToggle={() => toggleSection('canvas')} isDarkMode={isDarkMode}>
                  <div>
                    <label className={labelCls}>Aspect Ratio</label>
                    <div className="flex gap-1.5 justify-between">
                      {ASPECT_RATIOS.map((r) => {
                        const maxDim = 26;
                        const rw = r.w >= r.h ? maxDim : Math.round((maxDim * r.w) / r.h);
                        const rh = r.h >= r.w ? maxDim : Math.round((maxDim * r.h) / r.w);
                        const active = config.aspectRatio === r.id;
                        return (
                          <button
                            key={r.id}
                            onClick={() => setConfig(prev => ({ ...prev, aspectRatio: r.id }))}
                            className="flex flex-col items-center gap-1.5 group"
                            title={r.id === 'source' ? 'Match source' : r.label}
                          >
                            <div className="h-[30px] flex items-center justify-center">
                              {r.id === 'source' ? (
                                <div
                                  className={`w-[22px] h-[22px] rounded-[3px] border border-dashed flex items-center justify-center text-[8px] ${
                                    active
                                      ? (isDarkMode ? 'border-white text-white' : 'border-[#141414] text-[#141414]')
                                      : (isDarkMode ? 'border-[#444] text-[#666]' : 'border-[#CCC] text-[#AAA]')
                                  }`}
                                >
                                  A
                                </div>
                              ) : (
                                <div
                                  style={{ width: rw, height: rh }}
                                  className={`rounded-[3px] border transition-colors ${
                                    active
                                      ? (isDarkMode ? 'bg-white border-white' : 'bg-[#141414] border-[#141414]')
                                      : (isDarkMode ? 'border-[#444] group-hover:border-[#777]' : 'border-[#CCC] group-hover:border-[#999]')
                                  }`}
                                />
                              )}
                            </div>
                            <span className={`text-[9px] ${active ? 'opacity-100 font-medium' : 'opacity-40'}`}>{r.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Width: {config.canvasWidth}px</label>
                    <input
                      type="range" min="400" max="4000" step="100"
                      value={config.canvasWidth}
                      onChange={(e) => setConfig(prev => ({ ...prev, canvasWidth: parseInt(e.target.value) }))}
                      className="w-full accent-[#141414]"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Density</label>
                    <div className={pillGroupCls}>
                      {DENSITY_PRESETS.map((preset) => (
                        <button
                          key={preset.label}
                          onClick={() => setConfig(prev => ({ ...prev, density: preset.value }))}
                          className={pillCls(config.density === preset.value, isDarkMode)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Font Size: {config.fontSize}px</label>
                    <input
                      type="range" min="4" max="32"
                      value={config.fontSize}
                      onChange={(e) => setConfig(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                      className="w-full accent-[#141414]"
                    />
                  </div>
                </Section>

                {/* Color */}
                <Section title="Color" isOpen={openSections.has('color')} onToggle={() => toggleSection('color')} isDarkMode={isDarkMode}>
                  <div>
                    <label className={labelCls}>Mode</label>
                    <div className={pillGroupCls}>
                      {(['monochrome', 'original', 'brutalist', 'invert', 'sweep'] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => setConfig(prev => ({ ...prev, colorMode: mode }))}
                          className={pillCls(config.colorMode === mode, isDarkMode)}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {config.colorMode === 'monochrome' && (
                    <div>
                      <label className={labelCls}>Ink Color</label>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          value={config.monochromeColor}
                          onChange={(e) => setConfig(prev => ({ ...prev, monochromeColor: e.target.value }))}
                          className="w-9 h-9 rounded-lg border-0 p-0 bg-transparent cursor-pointer"
                        />
                        <input
                          type="text"
                          value={config.monochromeColor}
                          onChange={(e) => setConfig(prev => ({ ...prev, monochromeColor: e.target.value }))}
                          className={`${inputCls(isDarkMode)} flex-1 uppercase`}
                        />
                      </div>
                    </div>
                  )}

                  {config.colorMode === 'sweep' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        {(['sweepColor1', 'sweepColor2', 'sweepColor3'] as const).map((key, i) => (
                          <div key={key}>
                            <label className={labelCls}>Color {i + 1}</label>
                            <input
                              type="color"
                              value={config[key]}
                              onChange={(e) => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
                              className="w-full h-9 rounded-lg border-0 p-0 bg-transparent cursor-pointer"
                            />
                          </div>
                        ))}
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className={labelCls + ' mb-0'}>Sweep Progress</label>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] opacity-50">Auto</span>
                            <Toggle checked={config.autoSweep} onChange={() => setConfig(prev => ({ ...prev, autoSweep: !prev.autoSweep }))} isDarkMode={isDarkMode} />
                          </div>
                        </div>
                        <input
                          type="range" min="0" max="200"
                          value={config.sweepProgress}
                          onChange={(e) => setConfig(prev => ({ ...prev, sweepProgress: parseInt(e.target.value), autoSweep: false }))}
                          className="w-full accent-[#141414]"
                        />
                      </div>
                    </div>
                  )}
                </Section>

                {/* Typography */}
                <Section title="Typography" isOpen={openSections.has('typography')} onToggle={() => toggleSection('typography')} isDarkMode={isDarkMode}>
                  <div>
                    <label className={labelCls}>Character Mode</label>
                    <div className={pillGroupCls}>
                      {(['charset', 'words', 'emojis', 'sweep'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setConfig(prev => ({ ...prev, charMode: mode }))}
                          className={pillCls(config.charMode === mode, isDarkMode)}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {config.charMode === 'sweep' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        {(['sweepChar1', 'sweepChar2', 'sweepChar3'] as const).map((key, i) => (
                          <div key={key}>
                            <label className={labelCls}>Char {i + 1}</label>
                            <input
                              type="text"
                              value={config[key]}
                              onChange={(e) => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
                              className={`${inputCls(isDarkMode)} text-center text-base`}
                            />
                          </div>
                        ))}
                      </div>
                      {config.colorMode !== 'sweep' && (
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <label className={labelCls + ' mb-0'}>Sweep Progress</label>
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] opacity-50">Auto</span>
                              <Toggle checked={config.autoSweep} onChange={() => setConfig(prev => ({ ...prev, autoSweep: !prev.autoSweep }))} isDarkMode={isDarkMode} />
                            </div>
                          </div>
                          <input
                            type="range" min="0" max="200"
                            value={config.sweepProgress}
                            onChange={(e) => setConfig(prev => ({ ...prev, sweepProgress: parseInt(e.target.value), autoSweep: false }))}
                            className="w-full accent-[#141414]"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {config.charMode === 'words' && (
                    <div>
                      <label className={labelCls}>Source Words (space separated)</label>
                      <textarea
                        value={config.customWords}
                        onChange={(e) => setConfig(prev => ({ ...prev, customWords: e.target.value }))}
                        className={`${inputCls(isDarkMode)} h-20 resize-none`}
                      />
                    </div>
                  )}

                  {config.charMode === 'charset' && (
                    <div>
                      <label className={labelCls}>Character Set</label>
                      <input
                        type="text"
                        value={config.charset}
                        onChange={(e) => setConfig(prev => ({ ...prev, charset: e.target.value }))}
                        className={inputCls(isDarkMode)}
                      />
                    </div>
                  )}

                  {config.charMode === 'emojis' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3">
                        {(['emojiDark', 'emojiMid', 'emojiLight'] as const).map((key, i) => (
                          <div key={key}>
                            <label className={labelCls}>{['Dark', 'Mid', 'Light'][i]}</label>
                            <input
                              type="text"
                              value={config[key]}
                              onChange={(e) => setConfig(prev => ({ ...prev, [key]: e.target.value }))}
                              className={`${inputCls(isDarkMode)} text-center text-base`}
                            />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className={labelCls}>Dark/Mid Threshold: {config.emojiThreshold1}</label>
                        <input
                          type="range" min="10" max="240"
                          value={config.emojiThreshold1}
                          onChange={(e) => setConfig(prev => ({ ...prev, emojiThreshold1: parseInt(e.target.value) }))}
                          className="w-full accent-[#141414]"
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Mid/Light Threshold: {config.emojiThreshold2}</label>
                        <input
                          type="range" min="20" max="250"
                          value={config.emojiThreshold2}
                          onChange={(e) => setConfig(prev => ({ ...prev, emojiThreshold2: parseInt(e.target.value) }))}
                          className="w-full accent-[#141414]"
                        />
                      </div>
                    </div>
                  )}
                </Section>

                {/* Overlay Text */}
                <Section title="Overlay Text" isOpen={openSections.has('overlay')} onToggle={() => toggleSection('overlay')} isDarkMode={isDarkMode}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-50">Show Text</span>
                    <Toggle checked={config.showOverlayText} onChange={() => setConfig(prev => ({ ...prev, showOverlayText: !prev.showOverlayText }))} isDarkMode={isDarkMode} />
                  </div>

                  {config.showOverlayText && (
                    <div className="space-y-4">
                      <div>
                        <label className={labelCls}>Text Content</label>
                        <input
                          type="text"
                          value={config.overlayText}
                          onChange={(e) => setConfig(prev => ({ ...prev, overlayText: e.target.value }))}
                          className={inputCls(isDarkMode)}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelCls}>Size: {config.overlayTextSize}px</label>
                          <input
                            type="range" min="20" max="400"
                            value={config.overlayTextSize}
                            onChange={(e) => setConfig(prev => ({ ...prev, overlayTextSize: parseInt(e.target.value) }))}
                            className="w-full accent-[#141414]"
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Color</label>
                          <input
                            type="color"
                            value={config.overlayTextColor}
                            onChange={(e) => setConfig(prev => ({ ...prev, overlayTextColor: e.target.value }))}
                            className="w-9 h-9 rounded-lg border-0 p-0 bg-transparent cursor-pointer"
                          />
                        </div>
                      </div>

                      <div>
                        <label className={labelCls}>Position Mode</label>
                        <div className={pillGroupCls}>
                          {(['global', 'track_ball'] as const).map(mode => (
                            <button
                              key={mode}
                              onClick={() => setConfig(prev => ({ ...prev, overlayTextMode: mode }))}
                              className={pillCls(config.overlayTextMode === mode, isDarkMode)}
                            >
                              {mode.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      </div>

                      {config.overlayTextMode === 'global' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={labelCls}>Pos X: {config.overlayTextPositionX}%</label>
                            <input
                              type="range" min="0" max="100"
                              value={config.overlayTextPositionX}
                              onChange={(e) => setConfig(prev => ({ ...prev, overlayTextPositionX: parseInt(e.target.value) }))}
                              className="w-full accent-[#141414]"
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Pos Y: {config.overlayTextPositionY}%</label>
                            <input
                              type="range" min="0" max="100"
                              value={config.overlayTextPositionY}
                              onChange={(e) => setConfig(prev => ({ ...prev, overlayTextPositionY: parseInt(e.target.value) }))}
                              className="w-full accent-[#141414]"
                            />
                          </div>
                        </div>
                      )}

                      <div>
                        <label className={labelCls}>Rotation: {config.overlayTextRotation}°</label>
                        <input
                          type="range" min="-180" max="180"
                          value={config.overlayTextRotation}
                          onChange={(e) => setConfig(prev => ({ ...prev, overlayTextRotation: parseInt(e.target.value) }))}
                          className="w-full accent-[#141414]"
                        />
                      </div>

                      <div>
                        <label className={labelCls}>Rolling Speed: {config.overlayTextRollingSpeed}</label>
                        <input
                          type="range" min="-10" max="10"
                          value={config.overlayTextRollingSpeed}
                          onChange={(e) => setConfig(prev => ({ ...prev, overlayTextRollingSpeed: parseInt(e.target.value) }))}
                          className="w-full accent-[#141414]"
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs opacity-50">Drift with Animation</span>
                        <Toggle checked={config.overlayTextDrift} onChange={() => setConfig(prev => ({ ...prev, overlayTextDrift: !prev.overlayTextDrift }))} isDarkMode={isDarkMode} />
                      </div>

                      {config.overlayTextDrift && (
                        <div className="space-y-4">
                          <div>
                            <label className={labelCls}>Drift Amount: {config.overlayTextDriftAmount}</label>
                            <input
                              type="range" min="0" max="1000"
                              value={config.overlayTextDriftAmount}
                              onChange={(e) => setConfig(prev => ({ ...prev, overlayTextDriftAmount: parseInt(e.target.value) }))}
                              className="w-full accent-[#141414]"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className={labelCls}>Curve</label>
                              <select
                                value={config.overlayTextAnimCurve}
                                onChange={(e) => setConfig(prev => ({ ...prev, overlayTextAnimCurve: e.target.value as any }))}
                                className={inputCls(isDarkMode)}
                              >
                                <option value="linear">Linear</option>
                                <option value="easeIn">Ease In</option>
                                <option value="easeOut">Ease Out</option>
                                <option value="easeInOut">Ease In Out</option>
                              </select>
                            </div>
                            <div>
                              <label className={labelCls}>Duration: {config.overlayTextAnimDuration}s</label>
                              <input
                                type="range" min="0.1" max="10" step="0.1"
                                value={config.overlayTextAnimDuration}
                                onChange={(e) => setConfig(prev => ({ ...prev, overlayTextAnimDuration: parseFloat(e.target.value) }))}
                                className="w-full accent-[#141414]"
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="text-xs opacity-50">Loop Animation</span>
                            <Toggle checked={config.overlayTextAnimLoop} onChange={() => setConfig(prev => ({ ...prev, overlayTextAnimLoop: !prev.overlayTextAnimLoop }))} isDarkMode={isDarkMode} />
                          </div>

                          {!config.overlayTextAnimLoop && (
                            <button
                              onClick={() => setConfig(prev => ({ ...prev, overlayTextAnimTrigger: performance.now() }))}
                              className={`w-full py-2 rounded-lg text-xs transition-colors border ${isDarkMode ? 'border-[#333] hover:bg-[#1A1A1A]' : 'border-[#E5E5E5] hover:bg-[#FAFAFA]'}`}
                            >
                              Play Animation
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Section>

                {/* Image Adjust */}
                <Section title="Adjust" isOpen={openSections.has('adjust')} onToggle={() => toggleSection('adjust')} isDarkMode={isDarkMode}>
                  <div>
                    <label className={labelCls}>Contrast: {config.contrast.toFixed(1)}</label>
                    <input
                      type="range" min="0.5" max="3" step="0.1"
                      value={config.contrast}
                      onChange={(e) => setConfig(prev => ({ ...prev, contrast: parseFloat(e.target.value) }))}
                      className="w-full accent-[#141414]"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Brightness: {config.brightness.toFixed(1)}</label>
                    <input
                      type="range" min="0.5" max="2" step="0.1"
                      value={config.brightness}
                      onChange={(e) => setConfig(prev => ({ ...prev, brightness: parseFloat(e.target.value) }))}
                      className="w-full accent-[#141414]"
                    />
                  </div>
                </Section>

                {/* Motion */}
                <Section title="Motion" isOpen={openSections.has('motion')} onToggle={() => toggleSection('motion')} isDarkMode={isDarkMode}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-50">Enable Animation</span>
                    <Toggle checked={config.isAnimated} onChange={() => setConfig(prev => ({ ...prev, isAnimated: !prev.isAnimated }))} isDarkMode={isDarkMode} />
                  </div>

                  {config.isAnimated && (
                    <div className="space-y-4">
                      <div>
                        <label className={labelCls}>Motion Mode</label>
                        <div className={pillGroupCls}>
                          {(['float', 'flow', 'stress', 'wave', 'glitch', 'spiral', 'pulse'] as const).map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setConfig(prev => ({ ...prev, animationMode: mode }))}
                              className={pillCls(config.animationMode === mode, isDarkMode)}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                      </div>

                      {config.animationMode === 'flow' && (
                        <div>
                          <label className={labelCls}>Flow Angle: {config.flowAngle}°</label>
                          <input
                            type="range" min="0" max="360"
                            value={config.flowAngle}
                            onChange={(e) => setConfig(prev => ({ ...prev, flowAngle: parseInt(e.target.value) }))}
                            className="w-full accent-[#141414]"
                          />
                        </div>
                      )}

                      {config.animationMode === 'wave' && (
                        <div>
                          <label className={labelCls}>Wave Freq: {config.waveFrequency.toFixed(3)}</label>
                          <input
                            type="range" min="0.001" max="0.2" step="0.001"
                            value={config.waveFrequency}
                            onChange={(e) => setConfig(prev => ({ ...prev, waveFrequency: parseFloat(e.target.value) }))}
                            className="w-full accent-[#141414]"
                          />
                        </div>
                      )}

                      {config.animationMode === 'glitch' && (
                        <div>
                          <label className={labelCls}>Glitch Freq: {config.glitchFrequency.toFixed(2)}</label>
                          <input
                            type="range" min="0.01" max="0.5" step="0.01"
                            value={config.glitchFrequency}
                            onChange={(e) => setConfig(prev => ({ ...prev, glitchFrequency: parseFloat(e.target.value) }))}
                            className="w-full accent-[#141414]"
                          />
                        </div>
                      )}

                      <div>
                        <label className={labelCls}>Intensity: {config.motionIntensity.toFixed(1)}x</label>
                        <input
                          type="range" min="0.1" max="3" step="0.1"
                          value={config.motionIntensity}
                          onChange={(e) => setConfig(prev => ({ ...prev, motionIntensity: parseFloat(e.target.value) }))}
                          className="w-full accent-[#141414]"
                        />
                      </div>

                      <div>
                        <label className={labelCls}>Speed: {config.animationSpeed.toFixed(1)}x</label>
                        <input
                          type="range" min="0.1" max="5" step="0.1"
                          value={config.animationSpeed}
                          onChange={(e) => setConfig(prev => ({ ...prev, animationSpeed: parseFloat(e.target.value) }))}
                          className="w-full accent-[#141414]"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className={labelCls}>Readability Boost: {(config.readability * 100).toFixed(0)}%</label>
                    <input
                      type="range" min="0" max="1" step="0.05"
                      value={config.readability}
                      onChange={(e) => setConfig(prev => ({ ...prev, readability: parseFloat(e.target.value) }))}
                      className="w-full accent-[#141414]"
                    />
                  </div>
                </Section>

                {/* Export */}
                <Section title="Export" isOpen={openSections.has('export')} onToggle={() => toggleSection('export')} isDarkMode={isDarkMode}>
                  <div>
                    <label className={labelCls}>GIF Frame Rate: {gifFrameRate} fps</label>
                    <input
                      type="range" min="5" max="60" step="1"
                      value={gifFrameRate}
                      onChange={(e) => setGifFrameRate(parseInt(e.target.value))}
                      className="w-full accent-[#141414]"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>GIF Quality: {gifQuality} (lower is better)</label>
                    <input
                      type="range" min="1" max="30" step="1"
                      value={gifQuality}
                      onChange={(e) => setGifQuality(parseInt(e.target.value))}
                      className="w-full accent-[#141414]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={toggleRecording}
                      disabled={!image && !videoElement}
                      className={`py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isRecording ? 'bg-[#FF0000] text-white' : (isDarkMode ? 'border border-[#333] hover:bg-[#1A1A1A]' : 'border border-[#E5E5E5] hover:bg-[#FAFAFA]')}`}
                    >
                      {isRecording ? <Square size={12} /> : <Circle size={12} />}
                      {isRecording ? 'Stop' : 'REC Loop'}
                    </button>
                    <button
                      onClick={downloadResult}
                      disabled={!image && !videoElement}
                      className={`py-2.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDarkMode ? 'bg-white text-black hover:opacity-80' : 'bg-[#141414] text-white hover:opacity-80'}`}
                    >
                      <Download size={12} />
                      PNG
                    </button>
                  </div>
                </Section>

                </div>
                )}

                <div className="h-4" />
              </div>

              {/* Collapse sidebar */}
              <div className={`shrink-0 flex justify-end px-4 py-3 border-t ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isDarkMode ? 'hover:bg-[#1A1A1A]' : 'hover:bg-[#F5F5F5]'}`}
                  title="Collapse sidebar"
                >
                  <ChevronsLeft size={15} className="opacity-50" />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Canvas Area */}
      <main className={`flex-1 relative overflow-hidden flex items-center justify-center transition-colors duration-300 ${isDarkMode ? 'bg-[#111]' : 'bg-[#FAFAFA]'}`}>
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className={`absolute bottom-5 left-5 z-20 w-9 h-9 rounded-full flex items-center justify-center shadow-md transition-colors ${isDarkMode ? 'bg-[#1A1A1A] hover:bg-[#242424]' : 'bg-white hover:bg-[#F5F5F5]'}`}
            title="Expand sidebar"
          >
            <ChevronsRight size={16} className="opacity-60" />
          </button>
        )}

        {/* Floating AI pill */}
        <button
          onClick={() => setSidebarCollapsed(false)}
          className={`absolute top-5 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full shadow-md flex items-center gap-2 text-xs font-medium transition-colors ${isDarkMode ? 'bg-[#1A1A1A] hover:bg-[#242424] text-white' : 'bg-white hover:bg-[#F5F5F5] text-[#141414]'}`}
        >
          <Sparkles size={13} />
          Animate with AI
        </button>

        {/* Floating action cluster */}
        <div className="absolute top-5 right-5 z-20 flex flex-col gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`w-9 h-9 rounded-full flex items-center justify-center shadow-md transition-colors ${isDarkMode ? 'bg-[#1A1A1A] hover:bg-[#242424]' : 'bg-white hover:bg-[#F5F5F5]'}`}
            title="Upload"
          >
            <Upload size={14} />
          </button>
          <button
            onClick={downloadResult}
            disabled={!image && !videoElement}
            className={`w-9 h-9 rounded-full flex items-center justify-center shadow-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDarkMode ? 'bg-[#1A1A1A] hover:bg-[#242424]' : 'bg-white hover:bg-[#F5F5F5]'}`}
            title="Export PNG"
          >
            <Camera size={14} />
          </button>
          <button
            onClick={toggleRecording}
            disabled={!image && !videoElement}
            className={`w-9 h-9 rounded-full flex items-center justify-center shadow-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isRecording ? 'bg-[#FF0000] text-white animate-pulse' : (isDarkMode ? 'bg-[#1A1A1A] hover:bg-[#242424]' : 'bg-white hover:bg-[#F5F5F5]')}`}
            title={isRecording ? 'Stop recording' : 'Record loop'}
          >
            {isRecording ? <Square size={13} /> : <Circle size={13} />}
          </button>
        </div>

        <AnimatePresence mode="wait">
          {(!image && !videoElement) ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`max-w-sm w-full mx-6 rounded-2xl border p-10 text-center ${isDarkMode ? 'border-[#242424]' : 'border-[#EEE]'}`}
            >
              <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-5 ${isDarkMode ? 'bg-[#1A1A1A]' : 'bg-[#F5F5F5]'}`}>
                <ImageIcon size={20} className="opacity-60" />
              </div>
              <h3 className="text-base font-medium mb-1.5">No media loaded</h3>
              <p className="text-xs opacity-50 mb-6 leading-relaxed">Upload a photo or video to start generating typographic art. High contrast works best.</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`px-6 py-2.5 rounded-full text-xs font-medium transition-colors ${isDarkMode ? 'bg-white text-black hover:opacity-80' : 'bg-[#141414] text-white hover:opacity-80'}`}
              >
                Select File
              </button>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative"
            >
              <div className={`rounded-2xl overflow-hidden ${isDarkMode ? 'bg-[#0A0A0A]' : 'bg-white'} shadow-[0_1px_3px_rgba(0,0,0,0.08)]`}>
                <canvas
                  ref={canvasRef}
                  className="max-w-[80vw] max-h-[78vh] object-contain block"
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
                <div className={`absolute inset-0 rounded-2xl backdrop-blur-[2px] flex items-center justify-center ${isDarkMode ? 'bg-black/30' : 'bg-white/40'}`}>
                  <div className={`px-5 py-2.5 rounded-full text-xs font-medium flex items-center gap-2 ${isDarkMode ? 'bg-white text-black' : 'bg-[#141414] text-white'}`}>
                    <RefreshCw size={13} className="animate-spin" />
                    Processing
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Meta label */}
        <div className="absolute bottom-5 right-5 text-[11px] opacity-30 font-mono">
          {canvasDims.width || 0}×{canvasDims.height || 0}px
        </div>
      </main>
    </div>
  );
}
