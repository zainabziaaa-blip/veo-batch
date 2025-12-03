
import React from 'react';
import { VideoJob, JobStatus } from '../types';
import { Loader2, AlertCircle, CheckCircle2, Download } from 'lucide-react';

interface JobCardProps {
  job: VideoJob;
  onRemove: (id: string) => void;
}

export const JobCard: React.FC<JobCardProps> = ({ job, onRemove }) => {
  return (
    <div className="group relative bg-slate-800 rounded-xl overflow-hidden border border-slate-700 shadow-lg hover:border-slate-600 transition-all duration-300">
      
      {/* Remove Button (only show if not processing) */}
      {job.status !== JobStatus.PROCESSING && (
        <button 
          onClick={() => onRemove(job.id)}
          className="absolute top-2 right-2 z-10 p-1.5 bg-black/50 hover:bg-red-500/80 rounded-full text-white opacity-0 group-hover:opacity-100 transition-all backdrop-blur-sm"
          title="Remove"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      )}

      {/* Content Area - Aspect Ratio set to 9:16 for portrait format */}
      <div className="relative aspect-[9/16] bg-slate-900">
        {job.status === JobStatus.COMPLETED && job.videoUrl ? (
          <video 
            src={job.videoUrl} 
            controls 
            className="w-full h-full object-contain bg-black"
            loop
            muted
            autoPlay
          />
        ) : (
          <img 
            src={job.thumbnailUrl} 
            alt="Source" 
            className={`w-full h-full object-cover ${job.status === JobStatus.PROCESSING ? 'opacity-50' : 'opacity-80'}`} 
          />
        )}

        {/* Overlay States */}
        {job.status === JobStatus.PROCESSING && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
            <Loader2 className="w-10 h-10 text-blue-400 animate-spin mb-3" />
            <p className="text-sm text-blue-200 font-medium text-center shadow-black drop-shadow-md bg-black/40 px-3 py-1 rounded-full backdrop-blur-sm">
              {job.progress || "Processing..."}
            </p>
          </div>
        )}

        {job.status === JobStatus.FAILED && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/40 backdrop-blur-sm p-4">
            <AlertCircle className="w-10 h-10 text-red-400 mb-2" />
            <p className="text-xs text-red-200 text-center">{job.error || "Generation failed"}</p>
          </div>
        )}
        
        {job.status === JobStatus.PENDING && (
          <div className="absolute bottom-2 left-2">
            <span className="px-2 py-1 text-xs font-semibold bg-slate-700/80 text-slate-300 rounded-md backdrop-blur-md">
              PENDING
            </span>
          </div>
        )}

        {job.status === JobStatus.COMPLETED && (
          <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="flex justify-between items-end">
               <div className="flex flex-col gap-1">
                 <span className="text-xs font-medium text-green-400 flex items-center gap-1">
                   <CheckCircle2 className="w-3 h-3" /> Ready
                 </span>
               </div>
               
               <a 
                 href={job.videoUrl} 
                 download={`veo-video-${job.id}.mp4`}
                 className="p-2 bg-white/20 hover:bg-white/30 rounded-lg text-white backdrop-blur-sm transition-colors"
                 title="Download Video"
               >
                 <Download className="w-4 h-4" />
               </a>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-700/50">
        <p className="text-xs text-slate-400 truncate" title={job.file.name}>
          {job.file.name}
        </p>
      </div>
    </div>
  );
};
