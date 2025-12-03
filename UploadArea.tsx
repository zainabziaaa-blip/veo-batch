
import React, { useRef, useState } from 'react';
import { Upload, Image as ImageIcon, FolderInput } from 'lucide-react';

interface UploadAreaProps {
  onFilesSelected: (files: File[]) => void;
}

export const UploadArea: React.FC<UploadAreaProps> = ({ onFilesSelected }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files).filter((file: File) => file.type.startsWith('image/'));
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter((file: File) => file.type.startsWith('image/'));
      if (files.length > 0) {
        onFilesSelected(files);
      }
    }
    // Reset value
    if (e.target) e.target.value = '';
  };

  return (
    <div 
      className={`
        relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300
        flex flex-col items-center justify-center min-h-[240px]
        ${isDragging 
          ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' 
          : 'border-slate-700 bg-slate-800/30'
        }
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFiles}
        className="hidden" 
        multiple 
        accept="image/*"
      />
      {/* Folder input */}
      <input 
        type="file" 
        ref={folderInputRef}
        onChange={handleFiles}
        className="hidden" 
        multiple 
        {...{ webkitdirectory: "", directory: "" } as any}
      />
      
      <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center mb-4">
        {isDragging ? (
          <Upload className="w-8 h-8 text-blue-400 animate-bounce" />
        ) : (
          <ImageIcon className="w-8 h-8 text-slate-400" />
        )}
      </div>

      <h3 className="text-lg font-medium text-white mb-2">
        Add Images to Queue
      </h3>
      <p className="text-sm text-slate-400 max-w-xs mx-auto mb-6">
        Drag and drop images, or select a source below.
      </p>

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors text-sm font-medium"
        >
          <ImageIcon className="w-4 h-4" />
          Select Files
        </button>
        <button
          onClick={() => folderInputRef.current?.click()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm font-medium shadow-lg shadow-blue-900/20"
        >
          <FolderInput className="w-4 h-4" />
          Select Folder
        </button>
      </div>
    </div>
  );
};
