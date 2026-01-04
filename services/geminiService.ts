import { GoogleGenAI } from "@google/genai";

const VOXEL_PROMPT = `You are an expert Three.js developer.
GOAL: Write the JavaScript logic for a voxel scene.

CRITICAL RULES:
1.  **NO IMPORTS**: Do NOT write any \`import\` statements. 
    *   Assume \`THREE\` and \`OrbitControls\` are ALREADY imported and globally available.
    *   Do NOT declare \`THREE\`. It is already defined.
    *   Start immediately with setup logic.

2.  **Scene Setup**:
    *   Initialize \`scene\`, \`camera\`, \`renderer\`.
    *   Renderer size: window.innerWidth / window.innerHeight.
    *   Append \`renderer.domElement\` to document.body.
    *   **FLOOR**: Add \`scene.add(new THREE.GridHelper(50, 50));\` (Essential).
    *   Background: Dark gray (#111).
    *   Lighting: Ambient (0.6) + Directional (2.0).

3.  **Voxel Content**:
    *   Create a stylized voxel representation (e.g., a grid of cubes, or a shape inspired by the image content).
    *   Use \`THREE.InstancedMesh\` for performance.
    *   Do not try to load external textures (CORS issues). Use \`THREE.Color\`.

4.  **Interaction**:
    *   Setup \`OrbitControls\` with \`autoRotate = true\`.
    *   **Note**: \`OrbitControls\` is available as \`THREE.OrbitControls\` OR global \`OrbitControls\`.
    *   **EXPOSE GLOBALS**: You MUST execute:
        \`window.scene = scene; window.camera = camera; window.renderer = renderer;\`

5.  **Gesture Listener**:
    *   Paste this EXACT code at the end of your script:
    \`\`\`javascript
    window.addEventListener('message', (e) => {
        if (!window.scene || !window.camera) return;
        const { type, data } = e.data;
        if (type === 'gesture' && data.isTracking) {
             window.scene.rotation.y += data.rotation.x * 0.1;
             window.scene.rotation.x += data.rotation.y * 0.1;
             if (data.scale) {
                 const dist = 40 / Math.max(0.1, data.scale);
                 window.camera.position.setLength(dist);
             }
        }
    });
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
    \`\`\`

6.  **Format**: Return ONLY valid JavaScript code. NO markdown formatting.
`;

// Helper to clean potential markdown fences and STRIP IMPORTS
const cleanCode = (text: string): string => {
  let cleaned = text.replace(/```javascript/g, '').replace(/```js/g, '').replace(/```/g, '');
  // Regex to aggressively remove lines starting with 'import' or 'const THREE'
  cleaned = cleaned.replace(/^\s*import\s+.*$/gm, '');
  cleaned = cleaned.replace(/^\s*const\s+THREE\s+=.*$/gm, '');
  cleaned = cleaned.replace(/^\s*var\s+THREE\s+=.*$/gm, '');
  cleaned = cleaned.replace(/^\s*let\s+THREE\s+=.*$/gm, '');
  return cleaned.trim();
};

interface SceneResult {
    html: string;
    modelUsed: string;
}

// The Safe HTML Template with Controlled Imports
const constructHtml = (jsCode: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body { margin: 0; overflow: hidden; background-color: #000; }</style>
    <script type="importmap">
    {
        "imports": {
            "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
            "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
        }
    }
    </script>
</head>
<body>
    <div id="info" style="position:absolute; top:10px; left:10px; color:white; font-family:monospace; font-size:10px; pointer-events:none; z-index:10;">Generated Scene</div>
    <script type="module">
        // --- MANAGED IMPORTS START ---
        import * as THREE from 'three';
        import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
        
        // Ensure THREE is globally available for the AI script
        // CRITICAL FIX: We create a new object that includes THREE *and* OrbitControls
        // This allows 'new THREE.OrbitControls()' to work if the AI generates that.
        window.THREE = { ...THREE, OrbitControls }; 
        window.OrbitControls = OrbitControls;
        // --- MANAGED IMPORTS END ---

        // Error handling to show issues on screen
        window.addEventListener('error', (e) => {
            const el = document.createElement('div');
            el.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff5555;background:rgba(0,0,0,0.9);padding:20px;z-index:999;font-family:monospace;border:1px solid #ff5555;border-radius:8px;max-width:80%;word-wrap:break-word;';
            el.innerText = 'Scene Error: ' + e.message;
            document.body.appendChild(el);
        });

        // --- AI GENERATED CODE START ---
        try {
            ${jsCode}
        } catch (err) {
            console.error("AI Code Execution Error:", err);
            throw err;
        }
        // --- AI GENERATED CODE END ---
    </script>
</body>
</html>
`;

export const generateVoxelScene = async (imageBase64: string, apiKey?: string, onThought?: (thought: string) => void): Promise<SceneResult> => {
    const finalApiKey = apiKey || process.env.API_KEY;
    if (!finalApiKey) throw new Error("API Key required");

    const ai = new GoogleGenAI({ apiKey: finalApiKey });
    const base64Data = imageBase64.split(',')[1] || imageBase64;

    const runModel = async (modelName: string): Promise<string> => {
        const isGemini3 = modelName.includes('gemini-3');
        // Only use thinkingConfig for compatible models
        const config: any = {
            ...(isGemini3 ? { thinkingConfig: { includeThoughts: true } } : {})
        };

        try {
            const response = await ai.models.generateContentStream({
                model: modelName,
                contents: {
                    parts: [
                        { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
                        { text: VOXEL_PROMPT }
                    ]
                },
                config
            });

            let fullText = "";
            for await (const chunk of response) {
                const candidates = chunk.candidates;
                if (candidates && candidates[0]?.content?.parts) {
                    for (const part of candidates[0].content.parts) {
                        // @ts-ignore
                        if (part.thought && onThought) {
                             // @ts-ignore
                            onThought(part.text); 
                        } else if (part.text) {
                             // @ts-ignore
                            if (!part.thought) fullText += part.text;
                        }
                    }
                }
            }
            return cleanCode(fullText);
        } catch (error: any) {
             // Handle Permission errors explicitly to trigger fallback
             if (error.message?.includes("403") || error.message?.includes("PERMISSION_DENIED")) {
                 throw new Error("PERMISSION_DENIED");
             }
             throw error;
        }
    };

    try {
        console.log("Attempting Gemini 3 Pro...");
        const jsCode = await runModel('gemini-3-pro-preview');
        return { html: constructHtml(jsCode), modelUsed: 'Gemini 3 Pro' };
    } catch (error: any) {
        console.warn("Gemini 3 Pro failed, falling back...", error);
        
        // If permission denied or other error, try fallback models
        const fallbackModel = 'gemini-2.0-flash-exp'; // Use experimental flash as it's often more capable than standard flash for code
        
        try {
            if (onThought) onThought(`Gemini 3 failed (${error.message || 'unknown'}). Switching to Flash...`);
            const jsCode = await runModel(fallbackModel);
            return { html: constructHtml(jsCode), modelUsed: 'Gemini 2.0 Flash' };
        } catch (fallbackError) {
             console.error("All models failed", fallbackError);
             throw fallbackError;
        }
    }
};

export const generateDepthMap = async (imageBase64: string, apiKey?: string): Promise<string> => {
  const finalApiKey = apiKey || process.env.API_KEY;
  if (!finalApiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey: finalApiKey });
  const prompt = `Generate a high-fidelity grayscale depth map image. White = close, Black = far. Smooth gradients. Output at maximum resolution.`;

  // Loose safety settings to prevent false positives on abstract depth maps
  const safetySettings = [
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' }
  ];

  const extractImage = (response: any) => {
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) return part.inlineData.data;
    }
    // Check for finishReason if no image
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason) {
        throw new Error(`Gemini finished with reason: ${finishReason}. Content may have been blocked.`);
    }
    throw new Error("No image data returned.");
  };

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: prompt }],
      },
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { imageSize: "4K" },
        safetySettings
      }
    });
    return extractImage(response);
  } catch (error: any) {
    console.warn("Gemini 3 Pro Image failed, falling back...", error);
    
    // Fallback to 2.5 flash image or similar if 3 pro fails
    try {
        const responseFallback = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: prompt }],
            },
            config: { safetySettings }
        });
        return extractImage(responseFallback);
    } catch (finalError) {
        throw new Error("Failed to generate depth map with all models.");
    }
  }
};