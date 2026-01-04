import { ProcessedPointCloud } from "../types";

// Helper to load an image from a base64 string
export const loadImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src.startsWith('data:') ? src : `data:image/jpeg;base64,${src}`;
  });
};

// Helper to resize image to max dimensions to keep performance high
export const resizeImage = (img: HTMLImageElement, maxSize: number = 512): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  let width = img.width;
  let height = img.height;

  if (width > height) {
    if (width > maxSize) {
      height *= maxSize / width;
      width = maxSize;
    }
  } else {
    if (height > maxSize) {
      width *= maxSize / height;
      height = maxSize;
    }
  }

  canvas.width = Math.floor(width);
  canvas.height = Math.floor(height);
  const ctx = canvas.getContext('2d');
  
  if (ctx) {
      // Ensure high quality downsampling/upsampling
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return canvas;
};

// Main function to combine Color Image + Depth Map Image into 3D points
export const generatePointCloudFromImages = (
  colorCanvas: HTMLCanvasElement, 
  depthCanvas: HTMLCanvasElement,
  samplingFactor: number = 1.0 // 0.0 to 1.0
): ProcessedPointCloud => {
  const width = colorCanvas.width;
  const height = colorCanvas.height;
  
  const colorCtx = colorCanvas.getContext('2d');
  const depthCtx = depthCanvas.getContext('2d');

  if (!colorCtx || !depthCtx) {
    throw new Error("Could not get canvas contexts");
  }

  const colorData = colorCtx.getImageData(0, 0, width, height).data;
  const depthData = depthCtx.getImageData(0, 0, width, height).data;

  // Max possible points
  const totalPixels = width * height;
  
  // Allocate max size, we will slice later
  const positions = new Float32Array(totalPixels * 3);
  const colors = new Float32Array(totalPixels * 3);

  let pIndex = 0;
  let pointCount = 0;
  
  // Center offsets
  const cx = width / 2;
  const cy = height / 2;

  // Dynamic depth scale
  const depthScale = Math.max(width, height) * 0.5;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      
      // Sampling check: Skip pixel if random value > factor
      // We skip calculation entirely for performance
      if (samplingFactor < 1.0) {
        if (Math.random() > samplingFactor) continue;
      }

      const i = (y * width + x) * 4;

      // Depth (Grayscale value)
      const depthVal = depthData[i] / 255; 

      // Threshold check (optional): Skip purely black (background) pixels if desired
      // if (depthVal < 0.05) continue; 

      // Color (Normalize 0-1) and Boost Vibrancy (1.3x)
      // Doing this here saves millions of multiplications in the Vertex Shader per frame.
      const r = (colorData[i] / 255) * 1.3;
      const g = (colorData[i + 1] / 255) * 1.3;
      const b = (colorData[i + 2] / 255) * 1.3;

      // X, Y, Z calculation
      const pX = (x - cx);
      const pY = -(y - cy);
      
      // Map 0..1 depth to Z range. 
      const pZ = (depthVal - 0.5) * depthScale; 

      positions[pIndex] = pX;
      positions[pIndex + 1] = pY;
      positions[pIndex + 2] = pZ;

      colors[pIndex] = r;
      colors[pIndex + 1] = g;
      colors[pIndex + 2] = b;

      pIndex += 3;
      pointCount++;
    }
  }

  // Return sliced arrays containing only valid points to save GPU memory
  return { 
    positions: positions.slice(0, pIndex), 
    colors: colors.slice(0, pIndex), 
    count: pointCount,
    width,
    height
  };
};

// Utility to apply visualization filters to depth map
export const applyColorMap = (
  img: HTMLImageElement, 
  contrast: number = 1.0, 
  intensity: number = 1.0,
  colorize: boolean = false
): string => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img.src;

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let val = data[i]; // Grayscale value (assuming r=g=b)
    
    // Apply contrast: (val - 128) * contrast + 128
    val = ((val - 128) * contrast) + 128;

    // Apply intensity (Brightness/Gain)
    val = val * intensity;
    
    val = Math.max(0, Math.min(255, val));

    if (colorize) {
       // Simple "Magma-like" Heatmap
       // 0-255 mapped to Black -> Purple -> Orange -> Yellow -> White
       const t = val / 255;
       let r=0, g=0, b=0;

       if (t < 0.33) {
           const localT = t / 0.33;
           r = 100 * localT;
           g = 0;
           b = 100 * localT;
       } else if (t < 0.66) {
           const localT = (t - 0.33) / 0.33;
           r = 100 + (155 * localT);
           g = 0;
           b = 100 * (1 - localT);
       } else if (t < 0.9) {
           const localT = (t - 0.66) / 0.24;
           r = 255;
           g = 255 * localT;
           b = 0;
       } else {
           const localT = (t - 0.9) / 0.1;
           r = 255;
           g = 255;
           b = 255 * localT;
       }

       data[i] = r;
       data[i+1] = g;
       data[i+2] = b;
    } else {
       data[i] = val;
       data[i+1] = val;
       data[i+2] = val;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};