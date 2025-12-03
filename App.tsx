
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VideoJob, JobStatus, ProcessingConfig, VertexConfig } from './types';
import { createThumbnail } from './utils';
import { generateVideo } from './services/geminiService';
import { UploadArea } from './components/UploadArea';
import { JobCard } from './components/JobCard';
import { Button } from './components/Button';
import { Play, Trash2, Square, Settings, Cloud, Key } from 'lucide-react';

const App: React.FC = () => {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // API Key & Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [authMode, setAuthMode] = useState<'aistudio' | 'vertex'>('aistudio');
  
  // AI Studio Config
  const [customApiKey, setCustomApiKey] = useState('');
  
  // Vertex AI Config
  const [vertexConfig, setVertexConfig] = useState<VertexConfig>({
    projectId: '',
    location: 'us-central1',
    accessToken: ''
  });

  // Default config
  const [config] = useState<ProcessingConfig>({
    prompt: "Silent video. No audio. Add simple motion.",
    resolution: '720p',
    aspectRatio: '9:16'
  });

  const handleAddFiles = useCallback(async (files: File[]) => {
    const newJobs: VideoJob[] = await Promise.all(
      files.map(async (file) => ({
        id: crypto.randomUUID(),
        file,
        status: JobStatus.PENDING,
        thumbnailUrl: await createThumbnail(file),
      }))
    );
    setJobs(prev => [...prev, ...newJobs]);
  }, []);

  const handleRemoveJob = (id: string) => {
    setJobs(prev => prev.filter(job => job.id !== id));
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleClearAll = () => {
    if (confirm('Are you sure you want to clear all jobs?')) {
      if (isProcessing) {
        handleStop();
      }
      setJobs([]);
    }
  };

  const processQueue = useCallback(async () => {
    if (isProcessing) return;
    
    // We set this immediately to prevent re-entry from the effect
    setIsProcessing(true);
    
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const pendingJobs = jobs.filter(j => j.status === JobStatus.PENDING);
    
    // Process strictly sequentially to respect rate limits
    for (const job of pendingJobs) {
      if (controller.signal.aborted) break;

      // Update job to processing
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: JobStatus.PROCESSING, progress: 'Starting...' } : j));

      try {
        const videoBlob = await generateVideo(
          job.file, 
          config, 
          (progress) => {
            setJobs(prev => prev.map(j => j.id === job.id ? { ...j, progress } : j));
          },
          controller.signal,
          authMode === 'aistudio' ? customApiKey : undefined,
          authMode === 'vertex' ? vertexConfig : undefined
        );

        const videoUrl = URL.createObjectURL(videoBlob);

        setJobs(prev => prev.map(j => j.id === job.id ? { 
          ...j, 
          status: JobStatus.COMPLETED, 
          videoUrl, 
          progress: 'Done' 
        } : j));

      } catch (error: any) {
        if (error.name === 'AbortError' || error.message === 'Aborted') {
            // Update state to mark current AND all remaining pending jobs as cancelled
            setJobs(prev => prev.map(j => {
                // Mark the job that was currently running
                if (j.id === job.id) return { ...j, status: JobStatus.FAILED, error: 'Cancelled' };
                // Mark all other pending jobs as stopped so the queue doesn't restart automatically
                if (j.status === JobStatus.PENDING) return { ...j, status: JobStatus.FAILED, error: 'Stopped by user' };
                return j;
            }));
            break; // Stop processing further jobs immediately
        }
        
        // Auto-show settings if API key or Auth is missing
        if (error.message?.includes("API Key") || error.message?.includes("Access Token")) {
           setShowSettings(true);
        }

        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: JobStatus.FAILED, error: error.message || 'Failed' } : j));
      }
    }

    setIsProcessing(false);
    abortControllerRef.current = null;
  }, [jobs, isProcessing, config, customApiKey, vertexConfig, authMode]);

  // Auto-start processing when pending jobs exist and we are idle
  useEffect(() => {
    const hasPending = jobs.some(j => j.status === JobStatus.PENDING);
    if (hasPending && !isProcessing) {
      processQueue();
    }
  }, [jobs, isProcessing, processQueue]);

  const completedCount = jobs.filter(j => j.status === JobStatus.COMPLETED).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
               <Play className="w-4 h-4 text-white fill-current" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
              VeoBatch
            </h1>
          </div>
          <div className="flex items-center gap-2">
             <button
               onClick={() => setShowSettings(true)}
               className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
               title="Settings"
             >
               <Settings className="w-5 h-5" />
             </button>
          </div>
        </div>
      </header>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-semibold text-white mb-6 flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-400" />
              Configuration
            </h3>

            {/* Tabs */}
            <div className="flex p-1 bg-slate-950 rounded-lg mb-6 border border-slate-800">
              <button 
                onClick={() => setAuthMode('aistudio')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${authMode === 'aistudio' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <Key className="w-4 h-4" /> AI Studio
              </button>
              <button 
                onClick={() => setAuthMode('vertex')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition-all ${authMode === 'vertex' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                <Cloud className="w-4 h-4" /> Vertex AI
              </button>
            </div>
            
            {authMode === 'aistudio' ? (
              <div className="mb-6 animate-in slide-in-from-right-4 duration-200">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Gemini API Key
                </label>
                <input
                  type="password"
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  placeholder="Enter your Gemini API Key..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
                <p className="text-xs text-slate-500 mt-2">
                  Use for testing with Google AI Studio. Leave blank to use the deployed shared key (if available).
                </p>
              </div>
            ) : (
              <div className="mb-6 space-y-4 animate-in slide-in-from-left-4 duration-200">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Project ID
                  </label>
                  <input
                    type="text"
                    value={vertexConfig.projectId}
                    onChange={(e) => setVertexConfig({...vertexConfig, projectId: e.target.value})}
                    placeholder="my-gcp-project-id"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Location
                  </label>
                  <input
                    type="text"
                    value={vertexConfig.location}
                    onChange={(e) => setVertexConfig({...vertexConfig, location: e.target.value})}
                    placeholder="us-central1"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Access Token (OAuth)
                  </label>
                  <input
                    type="password"
                    value={vertexConfig.accessToken}
                    onChange={(e) => setVertexConfig({...vertexConfig, accessToken: e.target.value})}
                    placeholder="ya29.a0..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-slate-500 mt-2">
                    Run <code>gcloud auth print-access-token</code> to get a temporary token.
                  </p>
                </div>
              </div>
            )}
            
            <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
              <Button variant="primary" onClick={() => setShowSettings(false)}>
                Save & Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Input Section */}
        <section className="mb-8">
           <UploadArea onFilesSelected={handleAddFiles} />
           {isProcessing && (
             <div className="mt-4 flex flex-col items-center gap-3">
                <div className="text-center">
                    <span className="inline-flex items-center px-4 py-2 rounded-full bg-blue-900/30 text-blue-400 text-sm animate-pulse border border-blue-800">
                      <span className="w-2 h-2 bg-blue-400 rounded-full mr-2"></span>
                      Processing Queue...
                    </span>
                </div>
                <Button 
                  variant="danger" 
                  onClick={handleStop} 
                  className="h-8 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/50"
                >
                    <Square className="w-3 h-3 mr-2 fill-current" /> Stop Processing
                </Button>
             </div>
           )}
        </section>

        {/* Gallery Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              Queue & Gallery 
              <span className="ml-2 text-sm font-normal text-slate-500">
                ({completedCount}/{jobs.length} completed)
              </span>
            </h2>
            {jobs.length > 0 && !isProcessing && (
              <Button variant="ghost" onClick={handleClearAll} className="text-sm">
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            )}
          </div>

          {jobs.length === 0 ? (
            <div className="text-center py-20 border border-dashed border-slate-800 rounded-xl bg-slate-900/30">
              <p className="text-slate-500">Queue is empty. Add images to automatically start generating videos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {jobs.map((job) => (
                <JobCard 
                  key={job.id} 
                  job={job} 
                  onRemove={handleRemoveJob} 
                />
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
};

export default App;
