import { GoogleGenAI } from "@google/genai";

const VOXEL_PROMPT = `You are an expert Three.js developer creating a BEAUTIFUL voxel art scene.
GOAL: Create a visually stunning, COLORFUL voxel scene inspired by the image.

CRITICAL RULES:
1.  **NO IMPORTS**: Do NOT write any \`import\` statements. 
    *   \`THREE\` is globally available.
    *   Start immediately with setup logic.

2.  **Scene Setup**:
    *   \`const scene = new THREE.Scene();\`
    *   \`const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);\`
    *   \`camera.position.set(30, 25, 30);\`
    *   \`camera.lookAt(0, 0, 0);\`
    *   \`const renderer = new THREE.WebGLRenderer({ antialias: true });\`
    *   \`renderer.setSize(window.innerWidth, window.innerHeight);\`
    *   \`renderer.shadowMap.enabled = true;\`
    *   \`document.body.appendChild(renderer.domElement);\`
    *   Background: Use gradient or dark color like \`scene.background = new THREE.Color(0x1a1a2e);\`

3.  **Lighting** (IMPORTANT for visibility):
    *   \`scene.add(new THREE.AmbientLight(0xffffff, 0.6));\`
    *   \`const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);\`
    *   \`dirLight.position.set(20, 30, 20);\`
    *   \`dirLight.castShadow = true;\`
    *   \`scene.add(dirLight);\`

4.  **Voxel Content** (MOST IMPORTANT):
    *   Analyze the image and create a simplified voxel representation.
    *   USE COLORS! Extract dominant colors from the image concept.
    *   Create recognizable shapes, not random cubes.
    *   Use \`THREE.InstancedMesh\` with \`THREE.BoxGeometry(1, 1, 1)\` for voxels.
    *   Use \`THREE.MeshStandardMaterial({ color: 0xRRGGBB })\` with ACTUAL colors.
    *   Group related voxels logically (ground, objects, sky elements).
    *   Add a ground plane: \`scene.add(new THREE.GridHelper(40, 40, 0x444444, 0x222222));\`

5.  **OrbitControls**:
    *   \`const controls = new THREE.OrbitControls(camera, renderer.domElement);\`
    *   \`controls.autoRotate = true;\`
    *   \`controls.autoRotateSpeed = 1.0;\`
    *   \`controls.enableDamping = true;\`

6.  **EXPOSE GLOBALS**:
    \`window.scene = scene; window.camera = camera; window.renderer = renderer;\`

7.  **Animation Loop**:
    \`\`\`javascript
    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
    \`\`\`

8.  **Event Listeners** (paste at end):
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

9.  **Output**: Return ONLY valid JavaScript code. NO markdown. NO imports.

EXAMPLE of good voxel creation:
\`\`\`javascript
// Create colorful voxels
const geometry = new THREE.BoxGeometry(1, 1, 1);
const materials = {
    grass: new THREE.MeshStandardMaterial({ color: 0x4ade80 }),
    stone: new THREE.MeshStandardMaterial({ color: 0x6b7280 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x92400e }),
    water: new THREE.MeshStandardMaterial({ color: 0x3b82f6 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xfcd9b6 }),
};

function addVoxel(x, y, z, material) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
}
// Then add voxels: addVoxel(0, 0, 0, materials.grass);
\`\`\`
`;

// Helper to clean potential markdown fences and STRIP IMPORTS
const cleanCode = (text: string): string => {
  let cleaned = text.replace(/```javascript/g, '').replace(/```js/g, '').replace(/```/g, '');
  cleaned = cleaned.replace(/^\s*import\s+.*$/gm, '');
  cleaned = cleaned.replace(/^\s*const\s+THREE\s+=.*$/gm, '');
  cleaned = cleaned.replace(/^\s*var\s+THREE\s+=.*$/gm, '');
  cleaned = cleaned.replace(/^\s*let\s+THREE\s+=.*$/gm, '');
  // Normalize OrbitControls references to THREE.OrbitControls
  cleaned = cleaned.replace(/new\s+OrbitControls\s*\(/g, 'new THREE.OrbitControls(');
  return cleaned.trim();
};

// HTML Template using Three.js r128 (proper UMD support)
const constructHtml = (jsCode: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body { margin: 0; overflow: hidden; background-color: #1a1a2e; }</style>
</head>
<body>
    <div id="info" style="position:absolute; top:10px; left:10px; color:white; font-family:monospace; font-size:10px; pointer-events:none; z-index:10;">Generated Scene</div>
    
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
    
    <script>
        window.addEventListener('error', (e) => {
            const el = document.createElement('div');
            el.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff5555;background:rgba(0,0,0,0.9);padding:20px;z-index:999;font-family:monospace;border:1px solid #ff5555;border-radius:8px;max-width:80%;word-wrap:break-word;';
            el.innerText = 'Scene Error: ' + e.message;
            document.body.appendChild(el);
        });

        try {
            ${jsCode}
        } catch (err) {
            console.error("AI Code Execution Error:", err);
            const el = document.createElement('div');
            el.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff5555;background:rgba(0,0,0,0.9);padding:20px;z-index:999;font-family:monospace;border:1px solid #ff5555;border-radius:8px;max-width:80%;word-wrap:break-word;';
            el.innerText = 'Execution Error: ' + err.message;
            document.body.appendChild(el);
        }
    </script>
</body>
</html>
`;

export interface SceneGenerationResult {
    html: string;
    modelUsed: string;
}

export const generateVoxelScene = async (
    imageBase64: string, 
    manualApiKey?: string, 
    onThought?: (thought: string) => void
): Promise<SceneGenerationResult> => {
    const hasManualKey = !!manualApiKey && manualApiKey.trim().length > 0;
    const finalApiKey = hasManualKey ? manualApiKey : process.env.API_KEY;
    
    if (!finalApiKey) throw new Error("API Key required");

    // MODELOS CORRECTOS (verificados en documentación Google):
    // Con API key manual → gemini-3-pro-preview
    // Sin API key manual → gemini-2.5-flash (modelo estable)
    const primaryModel = hasManualKey ? 'gemini-3-pro-preview' : 'gemini-2.5-flash';
    const fallbackModel = 'gemini-2.0-flash';
    const primaryDisplayName = hasManualKey ? 'Gemini 3 Pro' : 'Gemini 2.5 Flash';

    console.log(`Generating scene with: ${primaryModel} (Manual API Key: ${hasManualKey})`);

    const ai = new GoogleGenAI({ apiKey: finalApiKey });
    const base64Data = imageBase64.split(',')[1] || imageBase64;

    const runModel = async (modelName: string): Promise<string> => {
        const isGemini3 = modelName.includes('gemini-3');
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
            if (error.message?.includes("403") || error.message?.includes("PERMISSION_DENIED")) {
                throw new Error("PERMISSION_DENIED");
            }
            throw error;
        }
    };

    try {
        if (onThought) onThought(`Using ${primaryDisplayName}...`);
        const jsCode = await runModel(primaryModel);
        return { html: constructHtml(jsCode), modelUsed: primaryDisplayName };
    } catch (error: any) {
        console.warn(`${primaryModel} failed, falling back...`, error);
        
        try {
            const fallbackDisplayName = 'Gemini 2.0 Flash (fallback)';
            if (onThought) onThought(`${primaryDisplayName} failed. Trying ${fallbackDisplayName}...`);
            const jsCode = await runModel(fallbackModel);
            return { html: constructHtml(jsCode), modelUsed: fallbackDisplayName };
        } catch (fallbackError) {
            console.error("All models failed", fallbackError);
            throw fallbackError;
        }
    }
};

export interface DepthMapResult {
    imageBase64: string;
    modelUsed: string;
}

export const generateDepthMap = async (imageBase64: string, manualApiKey?: string): Promise<DepthMapResult> => {
    const hasManualKey = !!manualApiKey && manualApiKey.trim().length > 0;
    const finalApiKey = hasManualKey ? manualApiKey : process.env.API_KEY;
    
    if (!finalApiKey) throw new Error("API Key is missing.");

    // MODELOS CORRECTOS (verificados en documentación Google):
    // Con API key manual → gemini-3-pro-image-preview (soporta generación de imágenes nativa)
    // Sin API key manual → gemini-2.0-flash-exp (con responseModalities: IMAGE)
    const modelToUse = hasManualKey ? 'gemini-3-pro-image-preview' : 'gemini-2.0-flash-exp';
    const modelDisplayName = hasManualKey ? 'Gemini 3 Pro Image' : 'Gemini 2.0 Flash';

    console.log(`Generating depth map with: ${modelToUse} (Manual API Key: ${hasManualKey})`);

    const ai = new GoogleGenAI({ apiKey: finalApiKey });
    const prompt = `Generate a high-fidelity grayscale depth map image. White = close, Black = far. Smooth gradients. Output at maximum resolution.`;

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
        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason) {
            throw new Error(`Gemini finished with reason: ${finishReason}. Content may have been blocked.`);
        }
        throw new Error("No image data returned.");
    };

    try {
        const response = await ai.models.generateContent({
            model: modelToUse,
            contents: {
                parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: prompt }],
            },
            config: {
                responseModalities: ["IMAGE"],
                safetySettings
            }
        });
        
        return {
            imageBase64: extractImage(response),
            modelUsed: modelDisplayName
        };
    } catch (error: any) {
        console.warn(`${modelToUse} failed:`, error);
        
        // Fallback: si falla el primario, intentar con el otro
        const fallbackModel = hasManualKey ? 'gemini-2.0-flash-exp' : 'gemini-3-pro-image-preview';
        const fallbackDisplayName = hasManualKey ? 'Gemini 2.0 Flash (fallback)' : 'Gemini 3 Pro Image (fallback)';
        
        console.log(`Trying fallback model: ${fallbackModel}`);
        
        try {
            const responseFallback = await ai.models.generateContent({
                model: fallbackModel,
                contents: {
                    parts: [{ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }, { text: prompt }],
                },
                config: { 
                    responseModalities: ["IMAGE"],
                    safetySettings 
                }
            });
            
            return {
                imageBase64: extractImage(responseFallback),
                modelUsed: fallbackDisplayName
            };
        } catch (finalError) {
            throw new Error(`Failed to generate depth map. Primary: ${modelToUse}, Fallback: ${fallbackModel}`);
        }
    }
};