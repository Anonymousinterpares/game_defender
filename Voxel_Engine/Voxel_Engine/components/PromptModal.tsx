
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, X, Loader2, Wand2, Hammer, Info, Ruler, Zap, Image as ImageIcon, Camera, Trash2 } from 'lucide-react';

interface PromptModalProps {
  isOpen: boolean;
  mode: 'create' | 'morph';
  initialImage?: { data: string, mimeType: string } | null;
  onClose: () => void;
  onSubmit: (prompt: string, imageData?: { data: string, mimeType: string }) => Promise<void>;
}

export const PromptModal: React.FC<PromptModalProps> = ({ isOpen, mode, initialImage, onClose, onSubmit }) => {
  const [prompt, setPrompt] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showTips, setShowTips] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setPrompt('');
      setImageFile(null);
      if (initialImage) {
          setImagePreview(`data:${initialImage.mimeType};base64,${initialImage.data}`);
      } else {
          setImagePreview(null);
      }
      setError('');
      setIsLoading(false);
      setShowTips(false);
    }
  }, [isOpen, initialImage]);

  if (!isOpen) return null;

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setError('Image too large (max 5MB)');
        return;
      }
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!prompt.trim() && !imagePreview) || isLoading) return;
    
    setIsLoading(true);
    setError('');
    
    try {
      let imageData;
      if (imagePreview) {
          const base64Data = imagePreview.split(',')[1];
          const mimeType = imageFile?.type || initialImage?.mimeType || 'image/png';
          imageData = { data: base64Data, mimeType };
      }
      
      await onSubmit(prompt, imageData);
      onClose();
    } catch (err) {
      console.error(err);
      setError('The magic failed! Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const isCreate = mode === 'create';
  const themeBg = isCreate ? 'bg-sky-500' : 'bg-amber-500';
  const themeHover = isCreate ? 'hover:bg-sky-600' : 'hover:bg-amber-600';
  const themeLight = isCreate ? 'bg-sky-100' : 'bg-amber-100';
  const themeText = isCreate ? 'text-sky-600' : 'text-amber-600';
  const themeBorder = isCreate ? 'border-sky-200' : 'border-amber-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 font-sans">
      <div className={`bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col border-4 ${isCreate ? 'border-sky-100' : 'border-amber-100'} animate-in fade-in zoom-in duration-200 scale-95 sm:scale-100 overflow-hidden`}>
        
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b ${isCreate ? 'border-sky-50 bg-gradient-to-r from-sky-50 to-blue-50' : 'border-amber-50 bg-gradient-to-r from-amber-50 to-orange-50'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${themeLight} ${themeText}`}>
                {isCreate ? <Wand2 size={24} strokeWidth={2.5} /> : <Hammer size={24} strokeWidth={2.5} />}
            </div>
            <div>
                <h2 className="text-xl font-extrabold text-slate-800">
                    {isCreate ? 'New Build' : 'Rebuild blocks'}
                </h2>
                <p className={`text-xs font-bold uppercase tracking-wide ${isCreate ? 'text-sky-400' : 'text-amber-400'}`}>
                    POWERED BY GEMINI 3 VISION
                </p>
            </div>
          </div>
          <button 
            onClick={!isLoading ? onClose : undefined}
            className="p-2 rounded-xl bg-white/50 text-slate-400 hover:bg-white hover:text-slate-700 transition-colors disabled:opacity-50"
            disabled={isLoading}
          >
            <X size={24} strokeWidth={3} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 bg-white overflow-y-auto max-h-[75vh]">
          <div className="flex justify-between items-center mb-4">
              <p className="text-slate-600 font-semibold text-sm">
                {isCreate 
                    ? "Upload an image or describe what to build" 
                    : "Upload an image to transform these voxels into"}
              </p>
              <button 
                onClick={() => setShowTips(!showTips)}
                className={`flex items-center gap-1 text-xs font-bold ${showTips ? themeText : 'text-slate-400'} hover:opacity-80 transition-all`}
              >
                <Info size={14} /> {showTips ? 'Hide Tips' : 'Tips'}
              </button>
          </div>
          
          {showTips && (
              <div className={`mb-4 p-4 rounded-2xl ${themeLight} border border-white/50 animate-in slide-in-from-top-2 duration-200`}>
                  <h4 className={`text-xs font-black uppercase tracking-widest mb-2 ${themeText}`}>Architect Guidelines</h4>
                  <ul className="space-y-2">
                      <li className="flex gap-2 text-xs font-bold text-slate-700">
                          <ImageIcon size={14} className="shrink-0" /> Images: Use clear photos of single objects.
                      </li>
                      <li className="flex gap-2 text-xs font-bold text-slate-700">
                          <Zap size={14} className="shrink-0" /> Text: Add "symmetrical" for cleaner results.
                      </li>
                      <li className="flex gap-2 text-xs font-bold text-slate-700">
                          <Sparkles size={14} className="shrink-0" /> Mix: You can use both image and text together!
                      </li>
                  </ul>
              </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* Image Upload Area */}
            {!imagePreview ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`w-full py-8 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-2 transition-all group ${themeBorder} ${themeLight} hover:bg-white active:scale-[0.98]`}
              >
                <div className={`p-3 rounded-full bg-white shadow-sm group-hover:shadow-md transition-all ${themeText}`}>
                  <Camera size={24} />
                </div>
                <span className={`text-xs font-bold uppercase tracking-widest ${themeText}`}>Upload Reference Image</span>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageChange} 
                  accept="image/*" 
                  className="hidden" 
                />
              </button>
            ) : (
              <div className="relative w-full aspect-video rounded-2xl overflow-hidden border-2 border-slate-100 shadow-inner group">
                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <button 
                    type="button"
                    onClick={removeImage}
                    className="p-3 bg-white text-rose-500 rounded-2xl shadow-xl hover:scale-110 active:scale-95 transition-all flex items-center gap-2 font-bold text-xs"
                   >
                     <Trash2 size={18} /> Remove Image
                   </button>
                </div>
              </div>
            )}

            <div className="relative">
              <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={isCreate 
                  ? "Describe your build (optional if image is provided)..." 
                  : "Style instructions (e.g. 'Use more blue blocks')..."}
                disabled={isLoading}
                className={`w-full h-24 resize-none bg-slate-50 border-2 border-slate-200 rounded-xl p-4 font-medium text-slate-700 focus:outline-none focus:ring-4 transition-all placeholder:text-slate-400 ${isCreate ? 'focus:border-sky-400 focus:ring-sky-100' : 'focus:border-amber-400 focus:ring-amber-100'}`}
              />
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 text-rose-600 text-sm font-bold flex items-center gap-2 animate-shake">
                <X size={16} /> {error}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button 
                type="submit"
                disabled={(!prompt.trim() && !imagePreview) || isLoading}
                className={`
                  flex items-center gap-2 px-8 py-4 rounded-2xl font-black text-white text-sm transition-all
                  ${isLoading 
                    ? 'bg-slate-200 text-slate-400 cursor-wait' 
                    : `${themeBg} ${themeHover} shadow-lg active:scale-95 border-b-4 border-black/20`}
                `}
              >
                {isLoading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Assembling...
                  </>
                ) : (
                  <>
                    <Sparkles size={18} fill="currentColor" />
                    {isCreate ? 'Build Scene' : 'Morph Blocks'}
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
