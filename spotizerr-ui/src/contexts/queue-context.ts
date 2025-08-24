import { createContext, useContext } from "react";
import type { SummaryObject, CallbackObject, TrackCallbackObject, AlbumCallbackObject, PlaylistCallbackObject, ProcessingCallbackObject, IDs } from "@/types/callbacks";

export type DownloadType = "track" | "album" | "playlist";

// Type guards for callback objects
const isProcessingCallback = (obj: CallbackObject): obj is ProcessingCallbackObject => {
  return "status" in obj && typeof (obj as ProcessingCallbackObject).status === "string" && (obj as any).name !== undefined;
};

const isTrackCallback = (obj: CallbackObject): obj is TrackCallbackObject => {
  return (obj as any).track !== undefined && (obj as any).status_info !== undefined;
};

const isAlbumCallback = (obj: CallbackObject): obj is AlbumCallbackObject => {
  return (obj as any).album !== undefined && (obj as any).status_info !== undefined;
};

const isPlaylistCallback = (obj: CallbackObject): obj is PlaylistCallbackObject => {
  return (obj as any).playlist !== undefined && (obj as any).status_info !== undefined;
};

// Simplified queue item that works directly with callback objects
export interface QueueItem {
  id: string;
  taskId?: string;
  downloadType: DownloadType;
  spotifyId: string;
  
  // Primary identifiers from callback (spotify/deezer/isrc/upc)
  ids?: IDs;
  
  // Current callback data - this is the source of truth
  lastCallback?: CallbackObject;
  
  // Derived display properties (computed from callback)
  name: string;
  artist: string;
  
  // Summary data for completed downloads
  summary?: SummaryObject;
  
  // Error state
  error?: string;
}

// Status extraction utilities
export const getStatus = (item: QueueItem): string => {
  // If user locally cancelled the task, reflect it without fabricating a callback
  if (item.error === "Cancelled by user") {
    return "cancelled";
  }

  if (!item.lastCallback) {
    // Only log if this seems problematic (task has been around for a while)
    return "initializing";
  }
  
  if (isProcessingCallback(item.lastCallback)) {
    return item.lastCallback.status;
  }
  
  if (isTrackCallback(item.lastCallback)) {
    // For parent downloads, check if this is the final track
    if (item.downloadType === "album" || item.downloadType === "playlist") {
      const currentTrack = item.lastCallback.current_track || 1;
      const totalTracks = item.lastCallback.total_tracks || 1;
      const trackStatus = item.lastCallback.status_info.status as string;
      
      // If this is the last track and it's in a terminal state, the parent is done
      if (currentTrack >= totalTracks && ["done", "skipped", "error"].includes(trackStatus)) {
        return "completed";
      }
      
      // If track is in terminal state but not the last track, parent is still downloading
      if (["done", "skipped", "error"].includes(trackStatus)) {
        return "downloading";
      }
      
      // Track is actively being processed
      return "downloading";
    }
    return item.lastCallback.status_info.status as string;
  }
  
  if (isAlbumCallback(item.lastCallback)) {
    return item.lastCallback.status_info.status as string;
  }
  
  if (isPlaylistCallback(item.lastCallback)) {
    return item.lastCallback.status_info.status as string;
  }
  
  console.warn(`getStatus: Unknown callback type for item ${item.id}:`, item.lastCallback);
  return "unknown";
};

export const isActiveStatus = (status: string): boolean => {
  return ["initializing", "processing", "downloading", "real-time", "progress", "track_progress", "retrying", "queued"].includes(status);
};

export const isTerminalStatus = (status: string): boolean => {
  // Handle both "complete" (backend) and "completed" (frontend) for compatibility
  return ["completed", "complete", "done", "error", "cancelled", "skipped"].includes(status);
};

// Progress calculation utilities
export const getProgress = (item: QueueItem): number | undefined => {
  if (!item.lastCallback) return undefined;
  
  // For individual tracks
  if (item.downloadType === "track" && isTrackCallback(item.lastCallback)) {
    if ((item.lastCallback.status_info as any).status === "real-time" && "progress" in (item.lastCallback.status_info as any)) {
      return (item.lastCallback.status_info as any).progress as number;
    }
    return undefined;
  }
  
  // For parent downloads (albums/playlists) - calculate based on track callbacks
  if ((item.downloadType === "album" || item.downloadType === "playlist") && isTrackCallback(item.lastCallback)) {
    const callback = item.lastCallback;
    const currentTrack = callback.current_track || 1;
    const totalTracks = callback.total_tracks || 1;
    const statusInfo: any = callback.status_info;
    const trackProgress = (statusInfo.status === "real-time" && "progress" in statusInfo) 
      ? statusInfo.progress : 0;
    
    // Formula: ((completed tracks) + (current track progress / 100)) / total tracks * 100
    const completedTracks = currentTrack - 1;
    return ((completedTracks + (trackProgress / 100)) / totalTracks) * 100;
  }
  
  return undefined;
};

// Display info extraction
export const getCurrentTrackInfo = (item: QueueItem): { current?: number; total?: number; title?: string } => {
  if (!item.lastCallback) return {};
  
  if (isTrackCallback(item.lastCallback)) {
    return {
      current: item.lastCallback.current_track,
      total: item.lastCallback.total_tracks,
      title: item.lastCallback.track.title
    };
  }
  
  return {};
};

export interface QueueContextType {
  items: QueueItem[];
  isVisible: boolean;
  activeCount: number;
  totalTasks: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  
  // Actions
  addItem: (item: { name: string; type: DownloadType; spotifyId: string; artist?: string }) => void;
  removeItem: (id: string) => void;
  cancelItem: (id: string) => void;
  toggleVisibility: () => void;
  clearCompleted: () => void;
  cancelAll: () => void;
  loadMoreTasks: () => void;
  restartSSE: () => void; // For auth state changes
}

export const QueueContext = createContext<QueueContextType | undefined>(undefined);

export function useQueue() {
  const context = useContext(QueueContext);
  if (context === undefined) {
    throw new Error("useQueue must be used within a QueueProvider");
  }
  return context;
}
