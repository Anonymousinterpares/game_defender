
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useEffect } from 'react';
import { Sparkles, X, Loader2, Image as ImageIcon, Download, Eraser, RefreshCw, Layers, Zap, Info, Wand2, Box, History, RotateCcw } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface ImageGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUseAsReference: (imageData: { data: string, mimeType: string }) => void;
}

const LOADING_MESSAGES = [
    "Thinking in pixels...",
    "Mixing digital paint...",
    "Defining silhouettes...",
    "Refining textures...",
    "Polishing the canvas...",
    "Almost there..."
];

export const ImageGeneratorModal: React.FC<ImageGeneratorModalProps> = ({ isOpen, onClose, onUseAsReference }) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<{ data: string, mimeType: string } | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const [modelType, setModelType] = useState<'flash' | 'pro'>('flash');
  const [loadingMsg, setLoadingMsg] = useState(LOADING_MESSAGES[0]);
  const [showTips, setShowTips] = useState(false);

  useEffect(() => {
    let interval: any;
    if (isGenerating) {
        let i = 0;
        interval = setInterval(() => {
            setLoadingMsg(LOADING_MESSAGES[i % LOADING_MESSAGES.length]);
            i++;
        }, 2000);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  if (!isOpen) return null;

  const handleGenerate = async (isModification: boolean = false) => {
    const finalPrompt = prompt.trim() || lastPrompt;
    if (!finalPrompt) return;

    if (modelType === 'pro') {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
      }
    }

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const modelName = modelType === 'flash' ? 'gemini-2.5-flash-image' : 'gemini-3-pro-image-preview';
      
      const contents: any = { parts: [] };
      
      if (isModification && generatedImage) {
        contents.parts.push({
          inlineData: {
            data: generatedImage.data,
            mimeType: generatedImage.mimeType
          }
        });
      }

      contents.parts.push({ text: finalPrompt });

      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          imageConfig: {
            aspectRatio: "1:1"
          }
        }
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          setGeneratedImage({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType
          });
          setLastPrompt(finalPrompt);
          // Note: We no longer clear the prompt here so it remains accessible for modification
          break;
        }
      }
    } catch (err) {
      console.error("Image generation failed", err);
      if (err.message?.includes("entity was not found")) {
        alert("Please select a valid paid project API key for Pro models.");
        await (window as any).aistudio.openSelectKey();
      } else {
        alert("Studio error: " + (err.message || "Unknown error"));
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRestoreLast = () => {
    if (lastPrompt) setPrompt(lastPrompt);
  };

  const handleDownload = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.href = `data:${generatedImage.mimeType};base64,${generatedImage.data}`;
    link.download = `voxel-concept-${Date.now()}.png`;
    link.click();
  };

  const handleClear = () => {
    setGeneratedImage(null);
    setPrompt('');
    setLastPrompt('');
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-2 md:p-4 font-sans">
      <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] shadow-2xl w-full max-w-4xl h-[95vh] md:h-[90vh] flex flex-col border-4 border-indigo-100 overflow-hidden animate-in fade-in zoom-in duration-300">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 md:p-6 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-50 shrink-0">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="p-2 md:p-3 rounded-xl md:rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-200">
                <ImageIcon size={24} className="md:w-7 md:h-7" strokeWidth={2.5} />
            </div>
            <div>
                <h2 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight">Concept Studio</h2>
                <div className="flex gap-2 md:gap-4 mt-1">
                    <button 
                        onClick={() => setModelType('flash')}
                        className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border-2 transition-all ${modelType === 'flash' ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-200 text-slate-400'}`}
                    >
                        Flash
                    </button>
                    <button 
                        onClick={() => setModelType('pro')}
                        className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border-2 transition-all ${modelType === 'pro' ? 'bg-amber-400 border-amber-400 text-amber-900' : 'border-slate-200 text-slate-400'}`}
                    >
                        Pro
                    </button>
                </div>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 md:p-3 rounded-xl md:rounded-2xl bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition-all active:scale-90"
          >
            <X size={20} md:size={24} strokeWidth={3} />
          </button>
        </div>

        {/* Workspace */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-50/30">
          
          {/* Preview Area */}
          <div className="flex-1 p-4 md:p-8 flex items-center justify-center relative min-h-[300px] md:min-h-0">
            {!generatedImage && !isGenerating ? (
                <div className="text-center space-y-4 max-w-xs">
                    <div className="w-16 h-16 md:w-24 md:h-24 bg-white rounded-full flex items-center justify-center mx-auto shadow-inner border-4 border-slate-100 text-slate-200">
                        <ImageIcon size={32} md:size={48} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-400">Ready to Imagine?</h3>
                        <p className="text-sm text-slate-400 font-medium">Describe your idea to generate concept art for your next voxel build.</p>
                    </div>
                </div>
            ) : isGenerating ? (
                <div className="flex flex-col items-center gap-6 animate-pulse">
                    <div className="w-48 h-48 md:w-64 md:h-64 bg-white rounded-3xl shadow-xl border-4 border-indigo-50 flex items-center justify-center">
                        <Loader2 size={40} md:size={48} className="text-indigo-400 animate-spin" />
                    </div>
                    <p className="text-indigo-500 font-black tracking-widest uppercase text-[10px] md:text-xs">{loadingMsg}</p>
                </div>
            ) : (
                <div className="relative group max-w-full max-h-full aspect-square bg-white rounded-3xl shadow-2xl p-2 border-4 border-white">
                    <img 
                        src={`data:${generatedImage!.mimeType};base64,${generatedImage!.data}`} 
                        className="w-full h-full object-contain rounded-2xl" 
                        alt="Concept" 
                    />
                    
                    {/* Floating Action Bar */}
                    <div className="absolute bottom-4 md:bottom-6 left-1/2 -translate-x-1/2 flex gap-2 md:gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto">
                        <ActionButton 
                            icon={<Download size={16} />} 
                            label="Save" 
                            onClick={handleDownload}
                            color="slate"
                        />
                        <ActionButton 
                            icon={<RefreshCw size={16} />} 
                            label="Re-roll" 
                            onClick={() => handleGenerate(false)}
                            color="indigo"
                        />
                         <ActionButton 
                            icon={<Eraser size={16} />} 
                            label="Clear" 
                            onClick={handleClear}
                            color="rose"
                        />
                    </div>
                </div>
            )}
          </div>

          {/* Controls Sidebar */}
          <div className="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-indigo-50 p-4 md:p-6 flex flex-col gap-4 md:gap-6 shadow-[-10px_0_30px_rgba(0,0,0,0.02)] overflow-y-auto">
            
            <div className="space-y-3 md:space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Artist Prompt</label>
                      {lastPrompt && prompt !== lastPrompt && (
                        <button 
                          onClick={handleRestoreLast}
                          title="Restore last prompt"
                          className="p-1 rounded-md hover:bg-slate-100 text-indigo-400 transition-colors"
                        >
                          <RotateCcw size={12} />
                        </button>
                      )}
                    </div>
                    <button onClick={() => setShowTips(!showTips)} className="text-indigo-400 hover:text-indigo-600 transition-colors">
                        <Info size={14} />
                    </button>
                </div>

                {showTips && (
                    <div className="p-3 md:p-4 bg-indigo-50 rounded-2xl text-[11px] font-bold text-indigo-700 leading-relaxed animate-in slide-in-from-top-2">
                        💡 For best results, mention "voxel art style", "blocky geometry", or "isometric 3D model".
                    </div>
                )}

                <div className="relative group/prompt">
                  <textarea 
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={generatedImage ? "Describe changes or a new idea..." : "A cute robot explorer in the jungle..."}
                      className="w-full h-24 md:h-32 p-3 md:p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-bold text-slate-700 focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-50 transition-all resize-none placeholder:text-slate-300"
                  />
                  {prompt && (
                    <button 
                      onClick={() => setPrompt('')}
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/80 text-slate-400 hover:text-rose-500 opacity-0 group-hover/prompt:opacity-100 transition-opacity shadow-sm"
                    >
                      <X size={14} strokeWidth={3} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 md:gap-3">
                    <button 
                        onClick={() => handleGenerate(false)}
                        disabled={isGenerating || (!prompt.trim() && !lastPrompt)}
                        className="w-full flex items-center justify-center gap-2 py-3 md:py-4 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-100 disabled:text-slate-300 text-white rounded-2xl font-black text-sm shadow-xl shadow-indigo-200 transition-all active:scale-[0.98] border-b-4 border-indigo-800 active:border-b-0 active:translate-y-[4px]"
                    >
                        {isGenerating ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} fill="currentColor" />}
                        {generatedImage ? 'Generate New' : 'Create Concept'}
                    </button>

                    {generatedImage && (
                        <button 
                            onClick={() => handleGenerate(true)}
                            disabled={isGenerating || !prompt.trim()}
                            className="w-full flex items-center justify-center gap-2 py-3 md:py-4 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 text-amber-900 rounded-2xl font-black text-sm shadow-xl shadow-amber-100 transition-all active:scale-[0.98] border-b-4 border-amber-600 active:border-b-0 active:translate-y-[4px]"
                        >
                            <Layers size={18} />
                            Modify Current
                        </button>
                    )}
                </div>
            </div>

            {generatedImage && (
                <div className="mt-2 md:mt-auto pt-4 md:pt-6 border-t border-slate-100 pb-4 md:pb-0">
                    <div className="bg-emerald-50 p-4 rounded-3xl space-y-3">
                        <div className="flex items-center gap-2 text-emerald-600">
                            <Zap size={14} fill="currentColor" />
                            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Ready to Build?</span>
                        </div>
                        <button 
                            onClick={() => onUseAsReference(generatedImage)}
                            className="w-full flex items-center justify-center gap-3 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-sm shadow-xl shadow-emerald-200 transition-all active:scale-[0.98] border-b-4 border-emerald-800 active:border-b-0 active:translate-y-[4px]"
                        >
                            <Box size={20} />
                            Turn into Voxels
                        </button>
                    </div>
                </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ActionButton: React.FC<{ icon: React.ReactNode, label: string, onClick: () => void, color: 'slate' | 'indigo' | 'rose' }> = ({ icon, label, onClick, color }) => {
    const colors = {
        slate: 'bg-white text-slate-600 hover:bg-slate-50 border-slate-200',
        indigo: 'bg-indigo-500 text-white hover:bg-indigo-600 border-indigo-700',
        rose: 'bg-rose-500 text-white hover:bg-rose-600 border-rose-700'
    };

    return (
        <button 
            onClick={onClick}
            className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 rounded-xl text-[10px] md:text-xs font-black shadow-2xl border-b-[3px] active:border-b-0 active:translate-y-[3px] transition-all ${colors[color]}`}
        >
            {icon} {label}
        </button>
    );
}
