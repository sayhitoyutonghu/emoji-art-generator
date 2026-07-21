/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Download, Image as ImageIcon, RefreshCw, Circle, Square, ChevronDown, ChevronsLeft, ChevronsRight, Sparkles, Sun, Moon, Camera, Play, Pause, Volume2, VolumeX, FolderOpen, SlidersHorizontal } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import RecordRTC from 'recordrtc';

// --- Constants & Types ---

const DEFAULT_CHARSET = "✅🔘📝⏳✕✔✖";
// Density = number of grid columns across the canvas (resolution-independent).
// Fewer columns → larger, more readable glyphs; more columns → finer detail.
const DENSITY_PRESETS = [
  { label: 'Low', value: 36 },
  { label: 'Medium', value: 64 },
  { label: 'High', value: 100 },
  { label: 'Ultra', value: 150 },
];

// 4×4 Bayer matrix for ordered dithering (values 0–15).
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

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
    name: 'ASCII',
    swatch: { bg: '#FFFFFF', fg: '#141414', sample: '#@%+=:' },
    config: { dither: false, cross: false, charMode: 'charset', charset: ' .:-=+*#%@$MW059', colorMode: 'monochrome', monochromeColor: '#141414', density: 100, isAnimated: false },
  },
  {
    id: 'cross',
    name: 'Cross Halftone',
    swatch: { bg: '#F9BB92', fg: '#141414', sample: '+ + +' },
    config: { dither: false, cross: true, colorMode: 'monochrome', monochromeColor: '#141414', density: 60, contrast: 1.3, isAnimated: false },
  },
  {
    id: 'emoji',
    name: 'Emoji Mosaic',
    swatch: { bg: '#F2F2F2', fg: '#000000', sample: '🧍🪨☁️' },
    config: { dither: false, cross: false, charMode: 'emojis', colorMode: 'original', density: 48, isAnimated: false },
  },
  {
    id: 'dither',
    name: 'Dither',
    swatch: { bg: '#F5F0E6', fg: '#E0491B', sample: '▚▞▟' },
    config: { dither: true, cross: false, colorMode: 'monochrome', monochromeColor: '#E0491B', density: 130, contrast: 1.8, isAnimated: false },
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
  dither: boolean;
  cross: boolean;
  showVideo: boolean;
  videoDim: number;
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
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [gifFrameRate, setGifFrameRate] = useState(15);
  const [gifQuality, setGifQuality] = useState(10);

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
    density: 48,
    fontSize: 100,
    canvasWidth: 1200,
    aspectRatio: 'source',
    dither: false,
    cross: false,
    showVideo: false,
    videoDim: 0.9,
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

      const bgColor = config.colorMode === 'invert' ? '#000000' : '#FFFFFF';
      if (config.showVideo) {
        // Draw the real source underneath, then a dim overlay so the footage
        // reads as a faint backdrop that bleeds through the character grid.
        drawCover(ctx, mediaSource, sourceWidth, sourceHeight, canvas.width, canvas.height);
        ctx.fillStyle = bgColor;
        ctx.globalAlpha = config.videoDim;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

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

      // Grid is defined by column count (config.density), independent of the
      // export resolution — so a higher canvas width yields a sharper render of
      // the SAME mosaic rather than more, smaller glyphs.
      const cellSize = Math.max(2, canvas.width / config.density);

      for (let y = 0; y < canvas.height; y += cellSize) {
        for (let x = 0; x < canvas.width; x += cellSize) {
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

          // Dither path: ordered 1-bit dithering into a solid ink block.
          if (config.dither) {
            const col = Math.round(x / cellSize);
            const row = Math.round(y / cellSize);
            const threshold = (BAYER4[(row & 3) * 4 + (col & 3)] + 0.5) / 16;
            const inverted = config.colorMode === 'invert';
            const lum = inverted ? 1 - brightness / 255 : brightness / 255;
            if (lum >= threshold) continue; // leave background
            ctx.fillStyle = inverted ? '#FFFFFF' : config.monochromeColor;
            // Solid square pixel (fillText block glyphs distort into bars).
            ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(cellSize) + 0.5, Math.ceil(cellSize) + 0.5);
            continue;
          }

          // Cross-halftone path: a plus sign per cell, sized by darkness; the
          // lightest cells shrink to dots. Drawn from rects for crisp arms.
          if (config.cross) {
            const inverted = config.colorMode === 'invert';
            const v = inverted ? brightness / 255 : 1 - brightness / 255; // ink amount 0..1
            if (v <= 0.05) continue;
            ctx.fillStyle = inverted ? '#FFFFFF' : config.monochromeColor;
            const size = cellSize * Math.min(1.15, v * 1.25);
            if (v < 0.28) {
              ctx.beginPath();
              ctx.arc(x, y, Math.max(0.8, size * 0.2), 0, Math.PI * 2);
              ctx.fill();
            } else {
              const arm = Math.max(1, size * 0.34);
              ctx.fillRect(x - arm / 2, y - size / 2, arm, size);
              ctx.fillRect(x - size / 2, y - arm / 2, size, arm);
            }
            continue;
          }

          // Calculate sweep state if needed for either char or color
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

          // Glyph size is relative to the grid cell (fontSize is now a fill %,
          // 40–160). Emoji/word/sweep glyphs fill the cell; ASCII/charset glyphs
          // additionally scale with darkness for tonal range.
          const fill = config.fontSize / 100;
          const base = cellSize * fill;
          let sizeVar = (config.charMode === 'emojis' || config.charMode === 'sweep')
            ? base * (0.85 + config.readability * 0.3)
            : Math.max(base * 0.3, (1 - brightness / 255) * base * (1 + config.readability * 0.4));
          
          // Animation logic
            let offsetX = 0;
            let offsetY = 0;
            let rotation = 0;
            let currentFlipY = 1;
            
            if (config.isAnimated) {
              const speed = t * 0.001 * config.animationSpeed;
              const intensity = config.motionIntensity;
              
              if (config.animationMode === 'float') {
                offsetX = Math.sin(speed + x * 0.02) * (cellSize * 0.2) * intensity;
                offsetY = Math.cos(speed + y * 0.02) * (cellSize * 0.2) * intensity;
              } else if (config.animationMode === 'flow') {
                const angleRad = (config.flowAngle * Math.PI) / 180;
                const drift = (speed * 20 * intensity) % cellSize;
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
    };

    const needsAnimationLoop = config.isAnimated || !!videoElement || ((config.colorMode === 'sweep' || config.charMode === 'sweep') && config.autoSweep);
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

  // Load a bundled demo video on first mount so the tool shows a result
  // immediately, without requiring an upload.
  useEffect(() => {
    const url = `${(import.meta as any).env.BASE_URL}demo.mp4`;
    const vid = document.createElement('video');
    vid.src = url;
    vid.autoplay = true;
    vid.playsInline = true;
    vid.loop = true;
    vid.muted = true;
    vid.crossOrigin = 'anonymous';
    vid.setAttribute('autoplay', '');
    vid.setAttribute('muted', '');
    vid.setAttribute('playsinline', '');
    vid.setAttribute('loop', '');
    vid.onloadeddata = () => {
      setVideoElement(vid);
      setImage(null);
      setMediaPreviewUrl(url);
      setPreviewPlaying(true);
      vid.play().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

                {/* CHARACTERS — contextual to the active preset */}
                {!config.dither && !config.cross && config.charMode === 'emojis' && (
                  <div className={`py-5 space-y-3 border-b ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
                    <span className="text-[11px] font-medium uppercase tracking-wider opacity-40">Emojis</span>
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
                  </div>
                )}

                {!config.dither && !config.cross && config.charMode === 'charset' && (
                  <div className={`py-5 space-y-3 border-b ${isDarkMode ? 'border-[#222]' : 'border-[#EFEFEF]'}`}>
                    <span className="text-[11px] font-medium uppercase tracking-wider opacity-40">Characters</span>
                    <input
                      type="text"
                      value={config.charset}
                      onChange={(e) => setConfig(prev => ({ ...prev, charset: e.target.value }))}
                      className={inputCls(isDarkMode)}
                    />
                    <p className="text-[10px] opacity-40 leading-relaxed">
                      Ordered light → dark; darker image areas draw larger glyphs.
                    </p>
                  </div>
                )}

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
                    <div className="flex items-center justify-between mb-2">
                      <label className={labelCls + ' mb-0'}>Detail (grid)</label>
                      <span className="text-[10px] opacity-40">{config.density} cols</span>
                    </div>
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
                    <input
                      type="range" min="16" max="240" step="1"
                      value={config.density}
                      onChange={(e) => setConfig(prev => ({ ...prev, density: parseInt(e.target.value) }))}
                      className="w-full accent-[#141414] mt-3"
                    />
                    <p className="text-[10px] opacity-40 mt-1.5 leading-relaxed">
                      Fewer columns = larger, more readable glyphs. Width only changes export sharpness.
                    </p>
                  </div>
                  {!config.dither && (
                    <div>
                      <label className={labelCls}>Glyph Fill: {config.fontSize}%</label>
                      <input
                        type="range" min="40" max="160"
                        value={config.fontSize}
                        onChange={(e) => setConfig(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                        className="w-full accent-[#141414]"
                      />
                    </div>
                  )}
                </Section>

                {/* Backdrop */}
                <Section title="Backdrop" isOpen={openSections.has('backdrop')} onToggle={() => toggleSection('backdrop')} isDarkMode={isDarkMode}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs opacity-50">Show video behind</span>
                    <Toggle checked={config.showVideo} onChange={() => setConfig(prev => ({ ...prev, showVideo: !prev.showVideo }))} isDarkMode={isDarkMode} />
                  </div>
                  {config.showVideo && (
                    <div>
                      <label className={labelCls}>Video Dim: {config.videoDim.toFixed(2)}</label>
                      <input
                        type="range" min="0" max="1" step="0.01"
                        value={config.videoDim}
                        onChange={(e) => setConfig(prev => ({ ...prev, videoDim: parseFloat(e.target.value) }))}
                        className="w-full accent-[#141414]"
                      />
                      <p className="text-[10px] opacity-40 mt-1.5 leading-relaxed">
                        Higher = footage more hidden behind the glyphs; lower = it bleeds through.
                      </p>
                    </div>
                  )}
                </Section>

                {/* Color */}
                <Section title="Color" isOpen={openSections.has('color')} onToggle={() => toggleSection('color')} isDarkMode={isDarkMode}>
                  <div>
                    <label className={labelCls}>Mode</label>
                    <div className={pillGroupCls}>
                      {(['monochrome', 'original', 'brutalist', 'invert'] as const).map((mode) => (
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
