
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import { VoxelEngine } from './services/VoxelEngine';
import { UIOverlay } from './components/UIOverlay';
import { JsonModal } from './components/JsonModal';
import { PromptModal } from './components/PromptModal';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ImageGeneratorModal } from './components/ImageGeneratorModal';
import { Generators } from './utils/voxelGenerators';
import { AppState, VoxelData, SavedModel } from './types';
import { GoogleGenAI, Type } from "@google/genai";

const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  
  const [appState, setAppState] = useState<AppState>(AppState.STABLE);
  const [voxelCount, setVoxelCount] = useState<number>(0);
  
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [jsonModalMode, setJsonModalMode] = useState<'view' | 'import'>('view');
  
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [promptMode, setPromptMode] = useState<'create' | 'morph'>('create');
  
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const [jsonData, setJsonData] = useState('');
  const [isAutoRotate, setIsAutoRotate] = useState(true);
  const [lastSavePath, setLastSavePath] = useState('');

  // --- State for Concept Art ---
  const [preselectedReferenceImage, setPreselectedReferenceImage] = useState<{ data: string, mimeType: string } | null>(null);

  // --- State for Custom Models ---
  const [currentBaseModel, setCurrentBaseModel] = useState<string>('Eagle');
  const [customBuilds, setCustomBuilds] = useState<SavedModel[]>([]);
  const [customRebuilds, setCustomRebuilds] = useState<SavedModel[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Load last save path
    fetch('/api/config')
      .then(res => res.json())
      .then(config => {
        if (config.lastSavePath) setLastSavePath(config.lastSavePath);
      })
      .catch(err => console.error("Failed to load config", err));

    // Initialize Engine
    const engine = new VoxelEngine(
      containerRef.current,
      (newState) => setAppState(newState),
      (count) => setVoxelCount(count)
    );

    engineRef.current = engine;

    // Initial Model Load
    engine.loadInitialModel(Generators.Eagle());

    // Resize Listener
    const handleResize = () => engine.handleResize();
    window.addEventListener('resize', handleResize);

    // Auto-hide welcome screen
    const timer = setTimeout(() => setShowWelcome(false), 5000);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
      engine.cleanup();
    };
  }, []);

  const handleDismantle = () => {
    engineRef.current?.dismantle();
  };

  const handleNewScene = (type: 'Eagle') => {
    const generator = Generators[type];
    if (generator && engineRef.current) {
      engineRef.current.loadInitialModel(generator());
      setCurrentBaseModel('Eagle');
    }
  };

  const handleSelectCustomBuild = (model: SavedModel) => {
      if (engineRef.current) {
          engineRef.current.loadInitialModel(model.data);
          setCurrentBaseModel(model.name);
      }
  };

  const handleRebuild = (type: 'Eagle' | 'Cat' | 'Rabbit' | 'Twins') => {
    const generator = Generators[type];
    if (generator && engineRef.current) {
      engineRef.current.rebuild(generator());
    }
  };

  const handleSelectCustomRebuild = (model: SavedModel) => {
      if (engineRef.current) {
          engineRef.current.rebuild(model.data);
      }
  };

  const handleShowJson = () => {
    if (engineRef.current) {
      setJsonData(engineRef.current.getJsonData());
      setJsonModalMode('view');
      setIsJsonModalOpen(true);
    }
  };

  const handleImportClick = () => {
      setJsonModalMode('import');
      setIsJsonModalOpen(true);
  };

  const handleSaveLocally = async () => {
    if (!engineRef.current) return;

    const filename = prompt("Enter filename for your model:", currentBaseModel || "my-voxel-model");
    if (!filename) return;

    const path = prompt("Enter full directory path to save in (will be remembered):", lastSavePath || "D:\\coding\\LEARNING\\test5\\Voxel_Engine\\Voxel_Engine\\models");
    if (!path) return;

    const data = JSON.parse(engineRef.current.getJsonData());

    try {
        const response = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename, path, data })
        });
        const result = await response.json();
        if (result.success) {
            setLastSavePath(path);
            alert(`Saved successfully to ${result.fullPath}`);
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        console.error("Save failed", err);
        alert(`Failed to save locally: ${err.message}`);
    }
  };

  const handleJsonImport = (jsonStr: string) => {
      try {
          const rawData = JSON.parse(jsonStr);
          if (!Array.isArray(rawData)) throw new Error("JSON must be an array");

          const voxelData: VoxelData[] = rawData.map((v: any) => {
              let colorVal = v.c || v.color;
              let colorInt = 0xCCCCCC;

              if (typeof colorVal === 'string') {
                  if (colorVal.startsWith('#')) colorVal = colorVal.substring(1);
                  colorInt = parseInt(colorVal, 16);
              } else if (typeof colorVal === 'number') {
                  colorInt = colorVal;
              }

              return {
                  x: Number(v.x) || 0,
                  y: Number(v.y) || 0,
                  z: Number(v.z) || 0,
                  color: isNaN(colorInt) ? 0xCCCCCC : colorInt
              };
          });
          
          if (engineRef.current) {
              engineRef.current.loadInitialModel(voxelData);
              setCurrentBaseModel('Imported Build');
          }
      } catch (e) {
          console.error("Failed to import JSON", e);
          alert("Failed to import JSON. Please ensure the format is correct.");
      }
  };

  const openPrompt = (mode: 'create' | 'morph') => {
      setPromptMode(mode);
      setIsPromptModalOpen(true);
  }

  const openImageStudio = () => {
      setIsImageModalOpen(true);
  }

  const handleUseConceptAsReference = (imageData: { data: string, mimeType: string }) => {
      setPreselectedReferenceImage(imageData);
      setIsImageModalOpen(false);
      setPromptMode('create');
      setIsPromptModalOpen(true);
  };
  
  const handleToggleRotation = () => {
      const newState = !isAutoRotate;
      setIsAutoRotate(newState);
      if (engineRef.current) {
          engineRef.current.setAutoRotate(newState);
      }
  }

  const handlePromptSubmit = async (prompt: string, imageData?: { data: string, mimeType: string }) => {
    if (!process.env.API_KEY) {
        throw new Error("API Key not found");
    }

    setIsGenerating(true);
    setIsPromptModalOpen(false);
    setPreselectedReferenceImage(null); // Clear bridge state

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const model = 'gemini-3-pro-preview';
        
        let systemContext = "";
        if (promptMode === 'morph' && engineRef.current) {
            const availableColors = engineRef.current.getUniqueColors().join(', ');
            systemContext = `
                CONTEXT: You are re-assembling an existing pile of bricks.
                Current palette: [${availableColors}].
                PREFER these colors for a "transforming" effect.
                Target: Rebuild the existing volume into the new shape.
            `;
        } else {
            systemContext = `
                CONTEXT: You are a voxel artist. Create a new model from scratch.
                Use vibrant, contrasting colors to distinguish different parts.
            `;
        }

        const promptText = prompt.trim() || "Create a beautiful 3D voxel art model based on this.";
        const contents: any = { parts: [] };

        if (imageData) {
            contents.parts.push({
                inlineData: {
                    data: imageData.data,
                    mimeType: imageData.mimeType
                }
            });
            systemContext += `\nANALYSIS: An image has been provided. Closely match the colors and core geometry seen in the image.`;
        }

        contents.parts.push({ text: `
            ${systemContext}
            
            Task: Generate a 3D voxel art model based on: "${promptText}".
            
            Strict Geometric Rules:
            1. Target 200 to 500 voxels for clarity.
            2. Center the model at x=0, z=0. 
            3. The lowest voxel should be at y=0.
            4. Ensure connectivity: every voxel should touch at least one other voxel.
            5. Return ONLY a JSON array of objects.
        `});

        const response = await ai.models.generateContent({
            model,
            contents,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            x: { type: Type.INTEGER },
                            y: { type: Type.INTEGER },
                            z: { type: Type.INTEGER },
                            color: { type: Type.STRING, description: "Hex color code e.g. #FF5500" }
                        },
                        required: ["x", "y", "z", "color"]
                    }
                }
            }
        });

        if (response.text) {
            const rawData = JSON.parse(response.text);
            
            const voxelData: VoxelData[] = rawData.map((v: any) => {
                let colorStr = v.color;
                if (colorStr.startsWith('#')) colorStr = colorStr.substring(1);
                const colorInt = parseInt(colorStr, 16);
                
                return {
                    x: v.x,
                    y: v.y,
                    z: v.z,
                    color: isNaN(colorInt) ? 0xCCCCCC : colorInt
                };
            });

            if (engineRef.current) {
                if (promptMode === 'create') {
                    engineRef.current.loadInitialModel(voxelData);
                    setCustomBuilds(prev => [...prev, { name: prompt || "Visual Creation", data: voxelData }]);
                    setCurrentBaseModel(prompt || "Visual Creation");
                } else {
                    engineRef.current.rebuild(voxelData);
                    setCustomRebuilds(prev => [...prev, { 
                        name: prompt || "Visual Morph", 
                        data: voxelData,
                        baseModel: currentBaseModel 
                    }]);
                }
            }
        }
    } catch (err) {
        console.error("Generation failed", err);
        alert("The AI Architect encountered an error. Please try a different prompt or image.");
    } finally {
        setIsGenerating(false);
    }
  };

  const relevantRebuilds = customRebuilds.filter(
      r => r.baseModel === currentBaseModel
  );

  return (
    <div className="relative w-full h-screen bg-[#f0f2f5] overflow-hidden">
      <div ref={containerRef} className="absolute inset-0 z-0" />
      
      <UIOverlay 
        voxelCount={voxelCount}
        appState={appState}
        currentBaseModel={currentBaseModel}
        customBuilds={customBuilds}
        customRebuilds={relevantRebuilds} 
        isAutoRotate={isAutoRotate}
        isInfoVisible={showWelcome}
        isGenerating={isGenerating}
        onDismantle={handleDismantle}
        onRebuild={handleRebuild}
        onNewScene={handleNewScene}
        onSelectCustomBuild={handleSelectCustomBuild}
        onSelectCustomRebuild={handleSelectCustomRebuild}
        onPromptCreate={() => openPrompt('create')}
        onPromptMorph={() => openPrompt('morph')}
        onOpenImageStudio={openImageStudio}
        onShowJson={handleShowJson}
        onImportJson={handleImportClick}
        onSaveLocally={handleSaveLocally}
        onToggleRotation={handleToggleRotation}
        onToggleInfo={() => setShowWelcome(!showWelcome)}
      />

      <WelcomeScreen visible={showWelcome} />

      <JsonModal 
        isOpen={isJsonModalOpen}
        onClose={() => setIsJsonModalOpen(false)}
        data={jsonData}
        isImport={jsonModalMode === 'import'}
        onImport={handleJsonImport}
      />

      <PromptModal
        isOpen={isPromptModalOpen}
        mode={promptMode}
        initialImage={preselectedReferenceImage}
        onClose={() => {
            setIsPromptModalOpen(false);
            setPreselectedReferenceImage(null);
        }}
        onSubmit={handlePromptSubmit}
      />

      <ImageGeneratorModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onUseAsReference={handleUseConceptAsReference}
      />
    </div>
  );
};

export default App;
