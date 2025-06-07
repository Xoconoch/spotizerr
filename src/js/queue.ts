// --- MODIFIED: Custom URLSearchParams class that does not encode anything ---
class CustomURLSearchParams {
  params: Record<string, string>;
  constructor() {
    this.params = {};
  }
  append(key: string, value: string): void {
    this.params[key] = value;
  }
  toString(): string {
    return Object.entries(this.params)
      .map(([key, value]: [string, string]) => `${key}=${value}`)
      .join('&');
  }
}
// --- END MODIFIED ---

// Interfaces for complex objects
interface QueueItem {
  name?: string;
  music?: string;
  song?: string;
  artist?: string;
  artists?: { name: string }[];
  album?: { name: string };
  owner?: string | { display_name?: string };
  total_tracks?: number;
  url?: string;
  type?: string; // Added for artist downloads
  parent?: ParentInfo; // For tracks within albums/playlists
  // For PRG file loading
  display_title?: string;
  display_artist?: string;
  endpoint?: string;
  download_type?: string;
  [key: string]: any; // Allow other properties
}

interface ParentInfo {
  type: 'album' | 'playlist';
  title?: string; // for album
  artist?: string; // for album
  name?: string; // for playlist
  owner?: string; // for playlist
  total_tracks?: number;
  url?: string;
  [key: string]: any; // Allow other properties
}

interface StatusData {
  type?: string;
  status?: string;
  name?: string;
  song?: string;
  music?: string;
  title?: string;
  artist?: string;
  artist_name?: string;
  album?: string;
  owner?: string;
  total_tracks?: number | string;
  current_track?: number | string;
  parsed_current_track?: string; // Make sure these are handled if they are strings
  parsed_total_tracks?: string;  // Make sure these are handled if they are strings
  progress?: number | string; // Can be string initially
  percentage?: number | string; // Can be string initially
  percent?: number | string; // Can be string initially
  time_elapsed?: number;
  error?: string;
  can_retry?: boolean;
  retry_count?: number;
  max_retries?: number; // from config potentially
  seconds_left?: number;
  prg_file?: string;
  url?: string;
  reason?: string; // for skipped
  parent?: ParentInfo;
  original_url?: string;
  position?: number; // For queued items
  original_request?: {
    url?: string;
    retry_url?: string;
    name?: string;
    artist?: string;
    type?: string;
    endpoint?: string;
    download_type?: string;
    display_title?: string;
    display_type?: string;
    display_artist?: string;
    service?: string;
    [key: string]: any; // For other potential original_request params
  };
  event?: string; // from SSE
  overall_progress?: number;
  display_type?: string; // from PRG data
  [key: string]: any; // Allow other properties
}

interface QueueEntry {
  item: QueueItem;
  type: string;
  prgFile: string;
  requestUrl: string | null;
  element: HTMLElement;
  lastStatus: StatusData;
  lastUpdated: number;
  hasEnded: boolean;
  intervalId: number | null; // NodeJS.Timeout for setInterval/clearInterval
  uniqueId: string;
  retryCount: number;
  autoRetryInterval: number | null;
  isNew: boolean;
  status: string;
  lastMessage: string;
  parentInfo: ParentInfo | null;
  isRetrying?: boolean;
  progress?: number; // for multi-track overall progress
  realTimeStallDetector: { count: number; lastStatusJson: string };
  [key: string]: any; // Allow other properties
}

interface AppConfig {
  downloadQueueVisible?: boolean;
  maxRetries?: number;
  retryDelaySeconds?: number;
  retry_delay_increase?: number;
  explicitFilter?: boolean;
  [key: string]: any; // Allow other config properties
}

// Ensure DOM elements are queryable
declare global {
  interface Document {
    getElementById(elementId: string): HTMLElement | null;
  }
}

export class DownloadQueue {
  // Constants read from the server config
  MAX_RETRIES: number = 3;      // Default max retries
  RETRY_DELAY: number = 5;      // Default retry delay in seconds
  RETRY_DELAY_INCREASE: number = 5; // Default retry delay increase in seconds

  // Cache for queue items
  queueCache: Record<string, StatusData> = {};

  // Queue entry objects
  queueEntries: Record<string, QueueEntry> = {};

  // Polling intervals for progress tracking
  pollingIntervals: Record<string, number> = {}; // NodeJS.Timeout for setInterval

  // DOM elements cache (Consider if this is still needed or how it's used)
  elements: Record<string, HTMLElement> = {}; // Example type, adjust as needed

  // Event handlers (Consider if this is still needed or how it's used)
  eventHandlers: Record<string, Function> = {}; // Example type, adjust as needed

  // Configuration
  config: AppConfig = {}; // Initialize with an empty object or a default config structure

  // Load the saved visible count (or default to 10)
  visibleCount: number;

  constructor() {
    const storedVisibleCount = localStorage.getItem("downloadQueueVisibleCount");
    this.visibleCount = storedVisibleCount ? parseInt(storedVisibleCount, 10) : 10;

    this.queueCache = JSON.parse(localStorage.getItem("downloadQueueCache") || "{}");

    // Constants read from the server config
    this.MAX_RETRIES = 3;      // Default max retries
    this.RETRY_DELAY = 5;      // Default retry delay in seconds
    this.RETRY_DELAY_INCREASE = 5; // Default retry delay increase in seconds

    // Cache for queue items
    // this.queueCache = {}; // Already initialized above

    // Queue entry objects
    this.queueEntries = {};

    // Polling intervals for progress tracking
    this.pollingIntervals = {};

    // DOM elements cache
    this.elements = {};

    // Event handlers
    this.eventHandlers = {};

    // Configuration
    this.config = {}; // Initialize config

    // Load the saved visible count (or default to 10) - This block is redundant
    // const storedVisibleCount = localStorage.getItem("downloadQueueVisibleCount");
    // this.visibleCount = storedVisibleCount ? parseInt(storedVisibleCount, 10) : 10;

    // Load the cached status info (object keyed by prgFile) - This is also redundant
    // this.queueCache = JSON.parse(localStorage.getItem("downloadQueueCache") || "{}");

    // Wait for initDOM to complete before setting up event listeners and loading existing PRG files.
    this.initDOM().then(() => {
      this.initEventListeners();
      this.loadExistingPrgFiles();
      // Start periodic sync
      setInterval(() => this.periodicSyncWithServer(), 10000); // Sync every 10 seconds
    });
  }

  /* DOM Management */
  async initDOM() {
    // New HTML structure for the download queue.
    const queueHTML = `
      <div id="downloadQueue" class="sidebar right" hidden>
        <div class="sidebar-header">
          <h2>Download Queue (<span id="queueTotalCount">0</span> items)</h2>
          <div class="header-actions">
            <button id="cancelAllBtn" aria-label="Cancel all downloads">
              <img src="/static/images/skull-head.svg" alt="Cancel All" class="skull-icon">
              Cancel all
            </button>
          </div>
        </div>
        <div id="queueItems" aria-live="polite"></div>
        <div id="queueFooter"></div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', queueHTML);

    // Load initial config from the server.
    await this.loadConfig();

    // Override the server value with locally persisted queue visibility (if present).
    const storedVisible = localStorage.getItem("downloadQueueVisible");
    if (storedVisible !== null) {
      // Ensure config is not null before assigning
      if (this.config) {
        this.config.downloadQueueVisible = storedVisible === "true";
      }
    }

    const queueSidebar = document.getElementById('downloadQueue');
    // Ensure config is not null and queueSidebar exists
    if (this.config && queueSidebar) {
      queueSidebar.hidden = !this.config.downloadQueueVisible;
      queueSidebar.classList.toggle('active', !!this.config.downloadQueueVisible);
    }

    // Initialize the queue icon based on sidebar visibility
    const queueIcon = document.getElementById('queueIcon');
    if (queueIcon && this.config) {
      if (this.config.downloadQueueVisible) {
        queueIcon.innerHTML = '<img src="/static/images/cross.svg" alt="Close queue" class="queue-x">';
        queueIcon.setAttribute('aria-expanded', 'true');
        queueIcon.classList.add('queue-icon-active'); // Add red tint class
      } else {
        queueIcon.innerHTML = '<img src="/static/images/queue.svg" alt="Queue Icon">';
        queueIcon.setAttribute('aria-expanded', 'false');
        queueIcon.classList.remove('queue-icon-active'); // Remove red tint class
      }
    }
  }

  /* Event Handling */
  initEventListeners() {
    // Toggle queue visibility via Escape key.
    document.addEventListener('keydown', async (e: KeyboardEvent) => {
      const queueSidebar = document.getElementById('downloadQueue');
      if (e.key === 'Escape' && queueSidebar?.classList.contains('active')) {
        await this.toggleVisibility();
      }
    });

    // "Cancel all" button.
    const cancelAllBtn = document.getElementById('cancelAllBtn');
    if (cancelAllBtn) {
      cancelAllBtn.addEventListener('click', () => {
        for (const queueId in this.queueEntries) {
          const entry = this.queueEntries[queueId];
          const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
          if (entry && !entry.hasEnded && entry.prgFile) {
            // Mark as cancelling visually
            if (entry.element) {
              entry.element.classList.add('cancelling');
            }
            if (logElement) {
              logElement.textContent = "Cancelling...";
            }

            // Cancel each active download
            fetch(`/api/${entry.type}/download/cancel?prg_file=${entry.prgFile}`)
              .then(response => response.json())
              .then(data => {
                // API returns status 'cancelled' when cancellation succeeds
                if (data.status === "cancelled" || data.status === "cancel") {
                  entry.hasEnded = true;
                  if (entry.intervalId) {
                    clearInterval(entry.intervalId as number); // Cast to number for clearInterval
                    entry.intervalId = null;
                  }
                  // Remove the entry as soon as the API confirms cancellation
                  this.cleanupEntry(queueId);
                }
              })
              .catch(error => console.error('Cancel error:', error));
          }
        }
        this.clearAllPollingIntervals();
      });
    }

    // Close all SSE connections when the page is about to unload
    window.addEventListener('beforeunload', () => {
      this.clearAllPollingIntervals();
    });
  }

  /* Public API */
  async toggleVisibility(force?: boolean) {
    const queueSidebar = document.getElementById('downloadQueue');
    if (!queueSidebar) return; // Guard against null
    // If force is provided, use that value, otherwise toggle the current state
    const isVisible = force !== undefined ? force : !queueSidebar.classList.contains('active');

    queueSidebar.classList.toggle('active', isVisible);
    queueSidebar.hidden = !isVisible;

    // Update the queue icon to show X when visible or queue icon when hidden
    const queueIcon = document.getElementById('queueIcon');
    if (queueIcon && this.config) {
      if (isVisible) {
        // Replace the image with an X and add red tint
        queueIcon.innerHTML = '<img src="/static/images/cross.svg" alt="Close queue" class="queue-x">';
        queueIcon.setAttribute('aria-expanded', 'true');
        queueIcon.classList.add('queue-icon-active'); // Add red tint class
      } else {
        // Restore the original queue icon and remove red tint
        queueIcon.innerHTML = '<img src="/static/images/queue.svg" alt="Queue Icon">';
        queueIcon.setAttribute('aria-expanded', 'false');
        queueIcon.classList.remove('queue-icon-active'); // Remove red tint class
      }
    }

    // Persist the state locally so it survives refreshes.
    localStorage.setItem("downloadQueueVisible", String(isVisible));

    try {
      await this.loadConfig();
      const updatedConfig = { ...this.config, downloadQueueVisible: isVisible };
      await this.saveConfig(updatedConfig);
      this.dispatchEvent('queueVisibilityChanged', { visible: isVisible });
    } catch (error) {
      console.error('Failed to save queue visibility:', error);
      // Revert UI if save failed.
      queueSidebar.classList.toggle('active', !isVisible);
      queueSidebar.hidden = isVisible;
      // Also revert the icon back
      if (queueIcon && this.config) {
        if (!isVisible) {
          queueIcon.innerHTML = '<img src="/static/images/cross.svg" alt="Close queue" class="queue-x">';
          queueIcon.setAttribute('aria-expanded', 'true');
          queueIcon.classList.add('queue-icon-active'); // Add red tint class
        } else {
          queueIcon.innerHTML = '<img src="/static/images/cross.svg" alt="Close queue" class="queue-x">';
          queueIcon.setAttribute('aria-expanded', 'true');
          queueIcon.classList.add('queue-icon-active'); // Add red tint class
        }
      }
      this.dispatchEvent('queueVisibilityChanged', { visible: !isVisible });
      this.showError('Failed to save queue visibility');
    }

    if (isVisible) {
      // If the queue is now visible, ensure all visible items are being polled.
      this.startMonitoringActiveEntries();
    }
  }

  showError(message: string) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'queue-error';
    errorDiv.textContent = message;
    document.getElementById('queueItems')?.prepend(errorDiv); // Optional chaining
    setTimeout(() => errorDiv.remove(), 3000);
  }

  /**
   * Adds a new download entry.
   */
  addDownload(item: QueueItem, type: string, prgFile: string, requestUrl: string | null = null, startMonitoring: boolean = false): string {
    const queueId = this.generateQueueId();
    const entry = this.createQueueEntry(item, type, prgFile, queueId, requestUrl);
    this.queueEntries[queueId] = entry;
    // Re-render and update which entries are processed.
    this.updateQueueOrder();

    // Start monitoring if explicitly requested, regardless of visibility
    if (startMonitoring) {
      this.startDownloadStatusMonitoring(queueId);
    }

    this.dispatchEvent('downloadAdded', { queueId, item, type });
    return queueId; // Return the queueId so callers can reference it
  }

  /* Start processing the entry. Removed visibility check to ensure all entries are monitored. */
  async startDownloadStatusMonitoring(queueId: string) {
    const entry = this.queueEntries[queueId];
    if (!entry || entry.hasEnded) return;

    // Don't restart monitoring if polling interval already exists
    if (this.pollingIntervals[queueId]) return;

    // Ensure entry has data containers for parent info
    entry.parentInfo = entry.parentInfo || null;

    // Show a preparing message for new entries
    if (entry.isNew) {
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
      if (logElement) {
        logElement.textContent = "Initializing download...";
      }
    }

    console.log(`Starting monitoring for ${entry.type} with PRG file: ${entry.prgFile}`);

    // For backward compatibility, first try to get initial status from the REST API
    try {
      const response = await fetch(`/api/prgs/${entry.prgFile}`);
      if (response.ok) {
        const data: StatusData = await response.json(); // Add type to data

        // Update entry type if available
        if (data.type) {
          entry.type = data.type;

          // Update type display if element exists
          const typeElement = entry.element.querySelector('.type') as HTMLElement | null;
          if (typeElement) {
            typeElement.textContent = data.type.charAt(0).toUpperCase() + data.type.slice(1);
            typeElement.className = `type ${data.type}`;
          }
        }

        // Update request URL if available
        if (!entry.requestUrl && data.original_request) {
          const params = new CustomURLSearchParams();
          for (const key in data.original_request) {
            params.append(key, data.original_request[key]);
          }
          entry.requestUrl = `/api/${entry.type}/download?${params.toString()}`;
        }

        // Override requestUrl with server original_url if provided
        if (data.original_url) {
          entry.requestUrl = data.original_url;
        }

        // Process the initial status
        if (data.last_line) {
          entry.lastStatus = data.last_line;
          entry.lastUpdated = Date.now();
          entry.status = data.last_line.status || 'unknown'; // Ensure status is not undefined

          // Update status message without recreating the element
          const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
          if (logElement) {
            const statusMessage = this.getStatusMessage(data.last_line);
            logElement.textContent = statusMessage;
          }

          // Apply appropriate CSS classes based on status
          this.applyStatusClasses(entry, data.last_line);

          // Save updated status to cache, ensuring we preserve parent data
          this.queueCache[entry.prgFile] = {
            ...data.last_line,
            // Ensure parent data is preserved
            parent: data.last_line.parent || entry.lastStatus?.parent
          };

          // If this is a track with a parent, update the display elements to match the parent
          if (data.last_line.type === 'track' && data.last_line.parent) {
            const parent = data.last_line.parent;
            entry.parentInfo = parent;

            // Update type and UI to reflect the parent type
            if (parent.type === 'album' || parent.type === 'playlist') {
              // Only change type if it's not already set to the parent type
              if (entry.type !== parent.type) {
                entry.type = parent.type;

                // Update the type indicator
                const typeEl = entry.element.querySelector('.type') as HTMLElement | null;
                if (typeEl) {
                  const displayType = parent.type.charAt(0).toUpperCase() + parent.type.slice(1);
                  typeEl.textContent = displayType;
                  typeEl.className = `type ${parent.type}`;
                }

                // Update the title and subtitle based on parent type
                const titleEl = entry.element.querySelector('.title') as HTMLElement | null;
                const artistEl = entry.element.querySelector('.artist') as HTMLElement | null;

                if (parent.type === 'album') {
                  if (titleEl) titleEl.textContent = parent.title || 'Unknown album';
                  if (artistEl) artistEl.textContent = parent.artist || 'Unknown artist';
                } else if (parent.type === 'playlist') {
                  if (titleEl) titleEl.textContent = parent.name || 'Unknown playlist';
                  if (artistEl) artistEl.textContent = parent.owner || 'Unknown creator';
                }
              }
            }
          }

          localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));

          // If the entry is already in a terminal state, don't set up polling
          if (['error', 'complete', 'cancel', 'cancelled', 'done'].includes(data.last_line.status || '')) { // Add null check for status
            entry.hasEnded = true;
            this.handleDownloadCompletion(entry, queueId, data.last_line);
            return;
          }
        }
      }
    } catch (error) {
      console.error('Initial status check failed:', error);
    }

    // Set up polling interval for real-time updates
    this.setupPollingInterval(queueId);
  }

  /* Helper Methods */
  generateQueueId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Creates a new queue entry. It checks localStorage for any cached info.
   */
  createQueueEntry(item: QueueItem, type: string, prgFile: string, queueId: string, requestUrl: string | null): QueueEntry {
    console.log(`Creating queue entry with initial type: ${type}`);

    // Get cached data if it exists
    const cachedData: StatusData | undefined = this.queueCache[prgFile]; // Add type

    // If we have cached data, use it to determine the true type and item properties
    if (cachedData) {
      // If this is a track with a parent, update type and item to match the parent
      if (cachedData.type === 'track' && cachedData.parent) {
        if (cachedData.parent.type === 'album') {
          type = 'album';
          item = {
            name: cachedData.parent.title,
            artist: cachedData.parent.artist,
            total_tracks: cachedData.parent.total_tracks,
            url: cachedData.parent.url
          };
        } else if (cachedData.parent.type === 'playlist') {
          type = 'playlist';
          item = {
            name: cachedData.parent.name,
            owner: cachedData.parent.owner,
            total_tracks: cachedData.parent.total_tracks,
            url: cachedData.parent.url
          };
        }
      }
      // If we're reconstructing an album or playlist directly
      else if (cachedData.type === 'album') {
        item = {
          name: cachedData.title || cachedData.album || 'Unknown album',
          artist: cachedData.artist || 'Unknown artist',
          total_tracks: typeof cachedData.total_tracks === 'string' ? parseInt(cachedData.total_tracks, 10) : cachedData.total_tracks || 0
        };
      } else if (cachedData.type === 'playlist') {
        item = {
          name: cachedData.name || 'Unknown playlist',
          owner: cachedData.owner || 'Unknown creator',
          total_tracks: typeof cachedData.total_tracks === 'string' ? parseInt(cachedData.total_tracks, 10) : cachedData.total_tracks || 0
        };
      }
    }

    // Build the basic entry with possibly updated type and item
    const entry: QueueEntry = { // Add type to entry
      item,
      type,
      prgFile,
      requestUrl, // for potential retry
      element: this.createQueueItem(item, type, prgFile, queueId),
      lastStatus: {
        // Initialize with basic item metadata for immediate display
        type,
        status: 'initializing',
        name: item.name || 'Unknown',
        artist: item.artist || item.artists?.[0]?.name || '',
        album: item.album?.name || '',
        title: item.name || '',
        owner: typeof item.owner === 'string' ? item.owner : item.owner?.display_name || '',
        total_tracks: item.total_tracks || 0
      },
      lastUpdated: Date.now(),
      hasEnded: false,
      intervalId: null,
      uniqueId: queueId,
      retryCount: 0,
      autoRetryInterval: null,
      isNew: true, // Add flag to track if this is a new entry
      status: 'initializing',
      lastMessage: `Initializing ${type} download...`,
      parentInfo: null, // Will store parent data for tracks that are part of albums/playlists
      realTimeStallDetector: { count: 0, lastStatusJson: '' } // For detecting stalled real_time downloads
    };

    // If cached info exists for this PRG file, use it.
    if (cachedData) {
      entry.lastStatus = cachedData;
      const logEl = entry.element.querySelector('.log') as HTMLElement | null;

      // Store parent information if available
      if (cachedData.parent) {
        entry.parentInfo = cachedData.parent;
      }

      // Render status message for cached data
      if (logEl) { // Check if logEl is not null
        logEl.textContent = this.getStatusMessage(entry.lastStatus);
      }
    }

    // Store it in our queue object
    this.queueEntries[queueId] = entry;

    return entry;
  }

  /**
 * Returns an HTML element for the queue entry with modern UI styling.
 */
createQueueItem(item: QueueItem, type: string, prgFile: string, queueId: string): HTMLElement {
  // Track whether this is a multi-track item (album or playlist)
  const isMultiTrack = type === 'album' || type === 'playlist';
  const defaultMessage = (type === 'playlist') ? 'Reading track list' : 'Initializing download...';

  // Use display values if available, or fall back to standard fields
  const displayTitle = item.name || item.music || item.song || 'Unknown';
  const displayArtist = item.artist || '';
  const displayType = type.charAt(0).toUpperCase() + type.slice(1);

  const div = document.createElement('article') as HTMLElement; // Cast to HTMLElement
  div.className = 'queue-item queue-item-new'; // Add the animation class
  div.setAttribute('aria-live', 'polite');
  div.setAttribute('aria-atomic', 'true');
  div.setAttribute('data-type', type);

  // Create modern HTML structure with better visual hierarchy
  let innerHtml = `
    <div class="queue-item-header">
      <div class="queue-item-info">
        <div class="title">${displayTitle}</div>
        ${displayArtist ? `<div class="artist">${displayArtist}</div>` : ''}
        <div class="type ${type}">${displayType}</div>
      </div>
      <button class="cancel-btn" data-prg="${prgFile}" data-type="${type}" data-queueid="${queueId}" title="Cancel Download">
        <img src="/static/images/skull-head.svg" alt="Cancel Download" style="width: 16px; height: 16px;">
      </button>
    </div>

    <div class="queue-item-status">
      <div class="log" id="log-${queueId}-${prgFile}">${defaultMessage}</div>

      <!-- Error details container (hidden by default) -->
      <div class="error-details" id="error-details-${queueId}-${prgFile}" style="display: none;"></div>

      <div class="progress-container">
        <!-- Track-level progress bar for single track or current track in multi-track items -->
        <div class="track-progress-bar-container" id="track-progress-container-${queueId}-${prgFile}">
          <div class="track-progress-bar" id="track-progress-bar-${queueId}-${prgFile}"
               role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>
        </div>

        <!-- Time elapsed for real-time downloads -->
        <div class="time-elapsed" id="time-elapsed-${queueId}-${prgFile}"></div>
      </div>
    </div>`;

  // For albums and playlists, add an overall progress container
  if (isMultiTrack) {
    innerHtml += `
    <div class="overall-progress-container">
      <div class="overall-progress-header">
        <span class="overall-progress-label">Overall Progress</span>
        <span class="overall-progress-count" id="progress-count-${queueId}-${prgFile}">0/0</span>
      </div>
      <div class="overall-progress-bar-container">
        <div class="overall-progress-bar" id="overall-bar-${queueId}-${prgFile}"
             role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>
      </div>
    </div>`;
  }

  div.innerHTML = innerHtml;

  (div.querySelector('.cancel-btn') as HTMLButtonElement | null)?.addEventListener('click', (e: MouseEvent) => this.handleCancelDownload(e)); // Add types and optional chaining

  // Remove the animation class after animation completes
  setTimeout(() => {
    div.classList.remove('queue-item-new');
  }, 300); // Match the animation duration

  return div;
}

  // Add a helper method to apply the right CSS classes based on status
  applyStatusClasses(entry: QueueEntry, statusData: StatusData) { // Add types for statusData
    // If no element, nothing to do
    if (!entry.element) return;

    // Remove all status classes first
    entry.element.classList.remove(
      'queued', 'initializing', 'downloading', 'processing',
      'error', 'complete', 'cancelled', 'progress'
    );

    // Handle various status types
    switch (statusData.status) { // Use statusData.status
      case 'queued':
        entry.element.classList.add('queued');
        break;
      case 'initializing':
        entry.element.classList.add('initializing');
        break;
      case 'processing':
      case 'downloading':
        entry.element.classList.add('processing');
        break;
      case 'progress':
      case 'track_progress':
      case 'real_time':
        entry.element.classList.add('progress');
        break;
      case 'error':
        entry.element.classList.add('error');
        // Hide error-details to prevent duplicate error display
        const errorDetailsContainer = entry.element.querySelector(`#error-details-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
        if (errorDetailsContainer) {
          errorDetailsContainer.style.display = 'none';
        }
        break;
      case 'complete':
      case 'done':
        entry.element.classList.add('complete');
        // Hide error details if present
        if (entry.element) {
          const errorDetailsContainer = entry.element.querySelector(`#error-details-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
          if (errorDetailsContainer) {
            errorDetailsContainer.style.display = 'none';
          }
        }
        break;
      case 'cancelled':
        entry.element.classList.add('cancelled');
        // Hide error details if present
        if (entry.element) {
          const errorDetailsContainer = entry.element.querySelector(`#error-details-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
          if (errorDetailsContainer) {
            errorDetailsContainer.style.display = 'none';
          }
        }
        break;
    }
  }

  async handleCancelDownload(e: MouseEvent) { // Add type for e
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null; // Add types and null check
    if (!btn) return; // Guard clause
    btn.style.display = 'none';
    const { prg, type, queueid } = btn.dataset;
    if (!prg || !type || !queueid) return; // Guard against undefined dataset properties

    try {
      // Get the queue item element
      const entry = this.queueEntries[queueid];
      if (entry && entry.element) {
        // Add a visual indication that it's being cancelled
        entry.element.classList.add('cancelling');
      }

      // Show cancellation in progress
      const logElement = document.getElementById(`log-${queueid}-${prg}`) as HTMLElement | null;
      if (logElement) {
        logElement.textContent = "Cancelling...";
      }

      // First cancel the download
      const response = await fetch(`/api/${type}/download/cancel?prg_file=${prg}`);
      const data = await response.json();
      // API returns status 'cancelled' when cancellation succeeds
      if (data.status === "cancelled" || data.status === "cancel") {
        if (entry) {
          entry.hasEnded = true;

          // Close any active connections
          this.clearPollingInterval(queueid);

          if (entry.intervalId) {
            clearInterval(entry.intervalId as number); // Cast to number
            entry.intervalId = null;
          }

          // Mark as cancelled in the cache to prevent re-loading on page refresh
          entry.status = "cancelled";
          this.queueCache[prg] = { status: "cancelled" };
          localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));

          // Immediately remove the item from the UI
          this.cleanupEntry(queueid);
        }
      }
    } catch (error) {
      console.error('Cancel error:', error);
    }
  }

  /* Reorders the queue display, updates the total count, and handles "Show more" */
  updateQueueOrder() {
    const container = document.getElementById('queueItems');
    const footer = document.getElementById('queueFooter');
    if (!container || !footer) return; // Guard against null
    const entries = Object.values(this.queueEntries);

    // Sorting: errors/canceled first (group 0), ongoing next (group 1), queued last (group 2, sorted by position).
    entries.sort((a: QueueEntry, b: QueueEntry) => {
      const getGroup = (entry: QueueEntry) => { // Add type
        if (entry.lastStatus && (entry.lastStatus.status === "error" || entry.lastStatus.status === "cancel")) {
          return 0;
        } else if (entry.lastStatus && entry.lastStatus.status === "queued") {
          return 2;
        } else {
          return 1;
        }
      };
      const groupA = getGroup(a);
      const groupB = getGroup(b);
      if (groupA !== groupB) {
        return groupA - groupB;
      } else {
        if (groupA === 2) {
          const posA = a.lastStatus && a.lastStatus.position ? a.lastStatus.position : Infinity;
          const posB = b.lastStatus && b.lastStatus.position ? b.lastStatus.position : Infinity;
          return posA - posB;
        }
        return a.lastUpdated - b.lastUpdated;
      }
    });

    // Update the header with just the total count
    const queueTotalCountEl = document.getElementById('queueTotalCount') as HTMLElement | null;
    if (queueTotalCountEl) {
      queueTotalCountEl.textContent = entries.length.toString();
    }

    // Remove subtitle with detailed stats if it exists
    const subtitleEl = document.getElementById('queueSubtitle');
    if (subtitleEl) {
      subtitleEl.remove();
    }

    // Only recreate the container content if really needed
    const visibleEntries = entries.slice(0, this.visibleCount);

    // Handle empty state
    if (entries.length === 0) {
      container.innerHTML = `
        <div class="queue-empty">
          <img src="/static/images/queue-empty.svg" alt="Empty queue" onerror="this.src='/static/images/queue.svg'">
          <p>Your download queue is empty</p>
        </div>
      `;
    } else {
      // Get currently visible items
      const visibleItems = Array.from(container.children).filter(el => el.classList.contains('queue-item'));

      // Update container more efficiently
      if (visibleItems.length === 0) {
        // No items in container, append all visible entries
        container.innerHTML = ''; // Clear any empty state
        visibleEntries.forEach((entry: QueueEntry) => {
          // We no longer automatically start monitoring here
          // Monitoring is now explicitly started by the methods that create downloads
          container.appendChild(entry.element);
        });
      } else {
        // Container already has items, update more efficiently

        // Create a map of current DOM elements by queue ID
        const existingElementMap: { [key: string]: HTMLElement } = {};
        visibleItems.forEach(el => {
          const queueId = (el.querySelector('.cancel-btn') as HTMLElement | null)?.dataset.queueid; // Optional chaining
          if (queueId) existingElementMap[queueId] = el as HTMLElement; // Cast to HTMLElement
        });

        // Clear container to re-add in correct order
        container.innerHTML = '';

        // Add visible entries in correct order
        visibleEntries.forEach((entry: QueueEntry) => {
          // We no longer automatically start monitoring here
          container.appendChild(entry.element);

          // Mark the entry as not new anymore
          entry.isNew = false;
        });
      }
    }

    // We no longer start or stop monitoring based on visibility changes here
    // This allows the explicit monitoring control from the download methods

    // Ensure all currently visible and active entries are being polled
    // This is important for items that become visible after "Show More" or other UI changes
    Object.values(this.queueEntries).forEach(entry => {
      if (this.isEntryVisible(entry.uniqueId) && !entry.hasEnded && !this.pollingIntervals[entry.uniqueId]) {
        console.log(`updateQueueOrder: Ensuring polling for visible/active entry ${entry.uniqueId} (${entry.prgFile})`);
        this.setupPollingInterval(entry.uniqueId);
      }
    });

    // Update footer
    footer.innerHTML = '';
    if (entries.length > this.visibleCount) {
      const remaining = entries.length - this.visibleCount;
      const showMoreBtn = document.createElement('button');
      showMoreBtn.textContent = `Show ${remaining} more`;
      showMoreBtn.addEventListener('click', () => {
        this.visibleCount += 10;
        localStorage.setItem("downloadQueueVisibleCount", this.visibleCount.toString()); // toString
        this.updateQueueOrder();
      });
      footer.appendChild(showMoreBtn);
    }
  }

  /* Checks if an entry is visible in the queue display. */
  isEntryVisible(queueId: string): boolean { // Add return type
    const entries = Object.values(this.queueEntries);
    entries.sort((a: QueueEntry, b: QueueEntry) => {
      const getGroup = (entry: QueueEntry) => { // Add type
        if (entry.lastStatus && (entry.lastStatus.status === "error" || entry.lastStatus.status === "cancel")) {
          return 0;
        } else if (entry.lastStatus && entry.lastStatus.status === "queued") {
          return 2;
        } else {
          return 1;
        }
      };
      const groupA = getGroup(a);
      const groupB = getGroup(b);
      if (groupA !== groupB) {
        return groupA - groupB;
      } else {
        if (groupA === 2) {
          const posA = a.lastStatus && a.lastStatus.position ? a.lastStatus.position : Infinity;
          const posB = b.lastStatus && b.lastStatus.position ? b.lastStatus.position : Infinity;
          return posA - posB;
        }
        return a.lastUpdated - b.lastUpdated;
      }
    });
    const index = entries.findIndex((e: QueueEntry) => e.uniqueId === queueId);
    return index >= 0 && index < this.visibleCount;
  }

  async cleanupEntry(queueId: string) {
    const entry = this.queueEntries[queueId];
    if (entry) {
      // Close any polling interval
      this.clearPollingInterval(queueId);

      // Clean up any intervals
      if (entry.intervalId) {
        clearInterval(entry.intervalId as number); // Cast to number
      }
      if (entry.autoRetryInterval) {
        clearInterval(entry.autoRetryInterval as number); // Cast to number
      }

      // Remove from the DOM
      entry.element.remove();

      // Delete from in-memory queue
      delete this.queueEntries[queueId];

      // Remove the cached info
      if (this.queueCache[entry.prgFile]) {
        delete this.queueCache[entry.prgFile];
        localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
      }

      // Update the queue display
      this.updateQueueOrder();
    }
  }

  /* Event Dispatching */
  dispatchEvent(name: string, detail: any) { // Add type for name
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* Status Message Handling */
  getStatusMessage(data: StatusData): string { // Add types
    // Determine the true display type - if this is a track with a parent, we may want to
    // show it as part of the parent's download process
    let displayType = data.type || 'unknown';
    let isChildTrack = false;

    // If this is a track that's part of an album/playlist, note that
    if (data.type === 'track' && data.parent) {
      isChildTrack = true;
      // We'll still use track-specific info but note it's part of a parent
    }

    // Find the queue item this status belongs to
    let queueItem: QueueEntry | null = null;
    const prgFile = data.prg_file || Object.keys(this.queueCache).find(key =>
      this.queueCache[key].status === data.status && this.queueCache[key].type === data.type
    );

    if (prgFile) {
      const queueId = Object.keys(this.queueEntries).find(id =>
        this.queueEntries[id].prgFile === prgFile
      );
      if (queueId) {
        queueItem = this.queueEntries[queueId];
      }
    }

    // Extract common fields
    const trackName = data.song || data.music || data.name || data.title ||
                      (queueItem?.item?.name) || 'Unknown';
    const artist = data.artist || data.artist_name ||
                   (queueItem?.item?.artist) || '';
    const albumTitle = data.title || data.album || data.parent?.title || data.name ||
                      (queueItem?.item?.name) || '';
    const playlistName = data.name || data.parent?.name ||
                        (queueItem?.item?.name) || '';
    const playlistOwner = data.owner || data.parent?.owner ||
                         (queueItem?.item?.owner) || ''; // Add type check if item.owner is object
    const currentTrack = data.current_track || data.parsed_current_track || '';
    const totalTracks = data.total_tracks || data.parsed_total_tracks || data.parent?.total_tracks ||
                       (queueItem?.item?.total_tracks) || '';

    // Format percentage for display when available
    let formattedPercentage = '0';
    if (data.progress !== undefined) {
      formattedPercentage = parseFloat(data.progress as string).toFixed(1); // Cast to string
    } else if (data.percentage) {
      formattedPercentage = (parseFloat(data.percentage as string) * 100).toFixed(1); // Cast to string
    } else if (data.percent) {
      formattedPercentage = (parseFloat(data.percent as string) * 100).toFixed(1); // Cast to string
    }

    // Helper for constructing info about the parent item
    const getParentInfo = (): string => { // Add return type
      if (!data.parent) return '';

      if (data.parent.type === 'album') {
        return ` from album "${data.parent.title}"`;
      } else if (data.parent.type === 'playlist') {
        return ` from playlist "${data.parent.name}" by ${data.parent.owner}`;
      }
      return '';
    };

    // Status-based message generation
    switch (data.status) {
      case 'queued':
        if (data.type === 'track') {
          return `Queued track "${trackName}"${artist ? ` by ${artist}` : ''}${getParentInfo()}`;
        } else if (data.type === 'album') {
          return `Queued album "${albumTitle}"${artist ? ` by ${artist}` : ''} (${totalTracks || '?'} tracks)`;
        } else if (data.type === 'playlist') {
          return `Queued playlist "${playlistName}"${playlistOwner ? ` by ${playlistOwner}` : ''} (${totalTracks || '?'} tracks)`;
        }
        return `Queued ${data.type}`;

      case 'initializing':
        return `Preparing to download...`;

      case 'processing':
        // Special case: If this is a track that's part of an album/playlist
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from album "${data.parent.title}")`;
          } else if (data.parent.type === 'playlist') {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from playlist "${data.parent.name}")`;
          }
        }

        // Regular standalone track
        if (data.type === 'track') {
          return `Processing track "${trackName}"${artist ? ` by ${artist}` : ''}${getParentInfo()}`;
        }
        // Album download
        else if (data.type === 'album') {
          // For albums, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Processing track ${currentTrack} of ${totalTracks} from album "${albumTitle}"`;
          } else if (totalTracks) {
            return `Processing album "${albumTitle}" (${totalTracks} tracks)`;
          }
          return `Processing album "${albumTitle}"...`;
        }
        // Playlist download
        else if (data.type === 'playlist') {
          // For playlists, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Processing track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Processing track ${currentTrack} of ${totalTracks} from playlist "${playlistName}"`;
          } else if (totalTracks) {
            return `Processing playlist "${playlistName}" (${totalTracks} tracks)`;
          }
          return `Processing playlist "${playlistName}"...`;
        }
        return `Processing ${data.type}...`;

      case 'progress':
        // Special case: If this is a track that's part of an album/playlist
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from album "${data.parent.title}")`;
          } else if (data.parent.type === 'playlist') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} (from playlist "${data.parent.name}")`;
          }
        }

        // Regular standalone track
        if (data.type === 'track') {
          return `Downloading track "${trackName}"${artist ? ` by ${artist}` : ''}${getParentInfo()}`;
        }
        // Album download
        else if (data.type === 'album') {
          // For albums, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Downloading track ${currentTrack} of ${totalTracks} from album "${albumTitle}"`;
          } else if (totalTracks) {
            return `Downloading album "${albumTitle}" (${totalTracks} tracks)`;
          }
          return `Downloading album "${albumTitle}"...`;
        }
        // Playlist download
        else if (data.type === 'playlist') {
          // For playlists, show current track info if available
          if (trackName && artist && currentTrack && totalTracks) {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist}`;
          } else if (currentTrack && totalTracks) {
            // If we have track numbers but not names
            return `Downloading track ${currentTrack} of ${totalTracks} from playlist "${playlistName}"`;
          } else if (totalTracks) {
            return `Downloading playlist "${playlistName}" (${totalTracks} tracks)`;
          }
          return `Downloading playlist "${playlistName}"...`;
        }
        return `Downloading ${data.type}...`;

      case 'real-time':
      case 'real_time':
        // Special case: If this is a track that's part of an album/playlist
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}% (from album "${data.parent.title}")`;
          } else if (data.parent.type === 'playlist') {
            return `Downloading track ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}% (from playlist "${data.parent.name}")`;
          }
        }

        // Regular standalone track
        if (data.type === 'track') {
          return `Downloading "${trackName}" - ${formattedPercentage}%${getParentInfo()}`;
        }
        // Album with track info
        else if (data.type === 'album' && trackName && artist) {
          return `Downloading ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}%`;
        }
        // Playlist with track info
        else if (data.type === 'playlist' && trackName && artist) {
          return `Downloading ${currentTrack}/${totalTracks}: "${trackName}" by ${artist} - ${formattedPercentage}%`;
        }
        // Generic with percentage
        else {
          const itemName = data.type === 'album' ? albumTitle :
                         (data.type === 'playlist' ? playlistName : data.type);
          return `Downloading ${data.type} "${itemName}" - ${formattedPercentage}%`;
        }

      case 'done':
      case 'complete':
        if (data.type === 'track') {
          return `Downloaded "${trackName}"${artist ? ` by ${artist}` : ''} successfully${getParentInfo()}`;
        } else if (data.type === 'album') {
          return `Downloaded album "${albumTitle}"${artist ? ` by ${artist}` : ''} successfully (${totalTracks} tracks)`;
        } else if (data.type === 'playlist') {
          return `Downloaded playlist "${playlistName}"${playlistOwner ? ` by ${playlistOwner}` : ''} successfully (${totalTracks} tracks)`;
        }
        return `Downloaded ${data.type} successfully`;

      case 'skipped':
        return `${trackName}${artist ? ` by ${artist}` : ''} was skipped: ${data.reason || 'Unknown reason'}`;

      case 'error':
        // Enhanced error message handling using the new format
        let errorMsg = `Error: ${data.error}`;

        // Add position information for tracks in collections
        if (data.current_track && data.total_tracks) {
          errorMsg = `Error on track ${data.current_track}/${data.total_tracks}: ${data.error}`;
        }

        // Add retry information if available
        if (data.retry_count !== undefined) {
          errorMsg += ` (Attempt ${data.retry_count}/${this.MAX_RETRIES})`;
        } else if (data.can_retry !== undefined) {
          if (data.can_retry) {
            errorMsg += ` (Can be retried)`;
          } else {
            errorMsg += ` (Max retries reached)`;
          }
        }

        // Add parent information if this is a track with a parent
        if (data.type === 'track' && data.parent) {
          if (data.parent.type === 'album') {
            errorMsg += `\nFrom album: "${data.parent.title}" by ${data.parent.artist || 'Unknown artist'}`;
          } else if (data.parent.type === 'playlist') {
            errorMsg += `\nFrom playlist: "${data.parent.name}" by ${data.parent.owner || 'Unknown creator'}`;
          }
        }

        // Add URL for troubleshooting if available
        if (data.url) {
          errorMsg += `\nSource: ${data.url}`;
        }

        return errorMsg;

      case 'retrying':
        let retryMsg = 'Retrying';
        if (data.retry_count) {
          retryMsg += ` (${data.retry_count}/${this.MAX_RETRIES})`;
        }
        if (data.seconds_left) {
          retryMsg += ` in ${data.seconds_left}s`;
        }
        if (data.error) {
          retryMsg += `: ${data.error}`;
        }
        return retryMsg;

      case 'cancelled':
      case 'cancel':
        return 'Cancelling...';

      default:
        return data.status || 'Unknown status';
    }
  }

  /* New Methods to Handle Terminal State, Inactivity and Auto-Retry */
  handleDownloadCompletion(entry: QueueEntry, queueId: string, progress: StatusData | number) { // Add types
    // Mark the entry as ended
    entry.hasEnded = true;

    // Update progress bar if available
    if (typeof progress === 'number') {
      const progressBar = entry.element.querySelector('.progress-bar') as HTMLElement | null;
      if (progressBar) {
        progressBar.style.width = '100%';
        progressBar.setAttribute('aria-valuenow', "100"); // Use string for aria-valuenow
        progressBar.classList.add('bg-success');
      }
    }

    // Stop polling
    this.clearPollingInterval(queueId);

    // Use 3 seconds cleanup delay for completed, 10 seconds for other terminal states like errors
    const cleanupDelay = (progress && typeof progress !== 'number' && (progress.status === 'complete' || progress.status === 'done')) ? 3000 :
                         (progress && typeof progress !== 'number' && (progress.status === 'cancelled' || progress.status === 'cancel' || progress.status === 'skipped')) ? 20000 :
                         10000; // Default for other errors if not caught by the more specific error handler delay

    // Clean up after the appropriate delay
    setTimeout(() => {
      this.cleanupEntry(queueId);
    }, cleanupDelay);
  }

  handleInactivity(entry: QueueEntry, queueId: string, logElement: HTMLElement | null) { // Add types
    if (entry.lastStatus && entry.lastStatus.status === 'queued') {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus);
      }
      return;
    }
    const now = Date.now();
    if (now - entry.lastUpdated > 300000) {
      const progressData: StatusData = { status: 'error', error: 'Inactivity timeout' }; // Use error property
      this.handleDownloadCompletion(entry, queueId, progressData); // Pass StatusData
    } else {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus);
      }
    }
  }

  async retryDownload(queueId: string, logElement: HTMLElement | null) { // Add type
    const entry = this.queueEntries[queueId];
    if (!entry) {
      console.warn(`Retry called for non-existent queueId: ${queueId}`);
      return;
    }

    // The retry button is already showing "Retrying..." and is disabled by the click handler.
    // We will update the error message div within logElement if retry fails.
    const errorMessageDiv = logElement?.querySelector('.error-message') as HTMLElement | null;
    const retryBtn = logElement?.querySelector('.retry-btn') as HTMLButtonElement | null;

    entry.isRetrying = true; // Mark the original entry as being retried.

    // Determine if we should use parent information for retry (existing logic)
    let useParent = false;
    let parentType: string | null = null; // Add type
    let parentUrl: string | null = null; // Add type
    if (entry.lastStatus && entry.lastStatus.parent) {
      const parent = entry.lastStatus.parent;
      if (parent.type && parent.url) {
        useParent = true;
        parentType = parent.type;
        parentUrl = parent.url;
        console.log(`Using parent info for retry: ${parentType} with URL: ${parentUrl}`);
      }
    }

    const getRetryUrl = (): string | null => { // Add return type
      if (entry.lastStatus && entry.lastStatus.original_url) return entry.lastStatus.original_url;
      if (useParent && parentUrl) return parentUrl;
      if (entry.requestUrl) return entry.requestUrl;
      if (entry.lastStatus && entry.lastStatus.original_request) {
        if (entry.lastStatus.original_request.retry_url) return entry.lastStatus.original_request.retry_url;
        if (entry.lastStatus.original_request.url) return entry.lastStatus.original_request.url;
      }
      if (entry.lastStatus && entry.lastStatus.url) return entry.lastStatus.url;
      return null;
    };

    const retryUrl = getRetryUrl();

    if (!retryUrl) {
      if (errorMessageDiv) errorMessageDiv.textContent = 'Retry not available: missing URL information.';
      entry.isRetrying = false;
      if (retryBtn) {
        retryBtn.disabled = false;
        retryBtn.innerHTML = 'Retry'; // Reset button text
      }
      return;
    }

    // Store details needed for the new entry BEFORE any async operations
    const originalItem: QueueItem = { ...entry.item }; // Shallow copy, add type
    const apiTypeForNewEntry = useParent && parentType ? parentType : entry.type; // Ensure parentType is not null
    console.log(`Retrying download using type: ${apiTypeForNewEntry} with base URL: ${retryUrl}`);

      let fullRetryUrl;
    if (retryUrl.startsWith('http') || retryUrl.startsWith('/api/')) { // if it's already a full URL or an API path
        fullRetryUrl = retryUrl;
      } else {
        // Construct full URL if retryUrl is just a resource identifier
        fullRetryUrl = `/api/${apiTypeForNewEntry}/download?url=${encodeURIComponent(retryUrl)}`;
        // Append metadata if retryUrl is raw resource URL
        if (originalItem && originalItem.name) {
        fullRetryUrl += `&name=${encodeURIComponent(originalItem.name)}`;
        }
        if (originalItem && originalItem.artist) {
        fullRetryUrl += `&artist=${encodeURIComponent(originalItem.artist)}`;
        }
      }
    const requestUrlForNewEntry = fullRetryUrl;

    try {
      // Clear polling for the old entry before making the request
      this.clearPollingInterval(queueId);

      const retryResponse = await fetch(fullRetryUrl);
      if (!retryResponse.ok) {
        const errorText = await retryResponse.text();
        throw new Error(`Server returned ${retryResponse.status}${errorText ? (': ' + errorText) : ''}`);
      }

      const retryData: StatusData = await retryResponse.json(); // Add type

      if (retryData.prg_file) {
        const newPrgFile = retryData.prg_file;

        // Clean up the old entry from UI, memory, cache, and server (PRG file)
        // logElement and retryBtn are part of the old entry's DOM structure and will be removed.
        await this.cleanupEntry(queueId);

        // Add the new download entry. This will create a new element, start monitoring, etc.
        this.addDownload(originalItem, apiTypeForNewEntry, newPrgFile, requestUrlForNewEntry, true);

        // The old setTimeout block for deleting oldPrgFile is no longer needed as cleanupEntry handles it.
      } else {
        if (errorMessageDiv) errorMessageDiv.textContent = 'Retry failed: invalid response from server.';
        const currentEntry = this.queueEntries[queueId]; // Check if old entry still exists
        if (currentEntry) {
          currentEntry.isRetrying = false;
        }
        if (retryBtn) {
          retryBtn.disabled = false;
          retryBtn.innerHTML = 'Retry';
        }
      }
    } catch (error) {
      console.error('Retry error:', error);
      // The old entry might still be in the DOM if cleanupEntry wasn't called or failed.
      const stillExistingEntry = this.queueEntries[queueId];
      if (stillExistingEntry && stillExistingEntry.element) {
        // logElement might be stale if the element was re-rendered, so query again if possible.
        const currentLogOnFailedEntry = stillExistingEntry.element.querySelector('.log') as HTMLElement | null;
        const errorDivOnFailedEntry = currentLogOnFailedEntry?.querySelector('.error-message') as HTMLElement | null || errorMessageDiv;
        const retryButtonOnFailedEntry = currentLogOnFailedEntry?.querySelector('.retry-btn') as HTMLButtonElement | null || retryBtn;

        if (errorDivOnFailedEntry) errorDivOnFailedEntry.textContent = 'Retry failed: ' + (error as Error).message; // Cast error to Error
        stillExistingEntry.isRetrying = false;
        if (retryButtonOnFailedEntry) {
          retryButtonOnFailedEntry.disabled = false;
          retryButtonOnFailedEntry.innerHTML = 'Retry';
        }
      } else if (errorMessageDiv) {
        // Fallback if entry is gone from queue but original logElement's parts are somehow still accessible
        errorMessageDiv.textContent = 'Retry failed: ' + (error as Error).message;
         if (retryBtn) {
            retryBtn.disabled = false;
            retryBtn.innerHTML = 'Retry';
        }
      }
    }
  }

  /**
   * Start monitoring for all active entries in the queue that are visible
   */
  startMonitoringActiveEntries() {
    for (const queueId in this.queueEntries) {
      const entry = this.queueEntries[queueId];
      // Only start monitoring if the entry is not in a terminal state and is visible
      if (!entry.hasEnded && this.isEntryVisible(queueId) && !this.pollingIntervals[queueId]) {
        this.setupPollingInterval(queueId);
      }
    }
  }

  /**
   * Centralized download method for all content types.
   * This method replaces the individual startTrackDownload, startAlbumDownload, etc. methods.
   * It will be called by all the other JS files.
   */
  async download(itemId: string, type: string, item: QueueItem, albumType: string | null = null): Promise<string | string[] | StatusData> { // Add types and return type
    if (!itemId) {
      throw new Error('Missing ID for download');
    }

    await this.loadConfig();

    // Construct the API URL in the new format /api/{type}/download/{itemId}
    let apiUrl = `/api/${type}/download/${itemId}`;

    // Prepare query parameters
    const queryParams = new URLSearchParams();
    // item.name and item.artist are no longer sent as query parameters
    // if (item.name && item.name.trim() !== '') queryParams.append('name', item.name);
    // if (item.artist && item.artist.trim() !== '') queryParams.append('artist', item.artist);

    // For artist downloads, include album_type as it may still be needed
    if (type === 'artist' && albumType) {
      queryParams.append('album_type', albumType);
    }

    const queryString = queryParams.toString();
    if (queryString) {
      apiUrl += `?${queryString}`;
    }

    console.log(`Constructed API URL for download: ${apiUrl}`); // Log the constructed URL

    try {
      // Show a loading indicator
      const queueIcon = document.getElementById('queueIcon'); // No direct classList manipulation
      if (queueIcon) {
        queueIcon.classList.add('queue-icon-active');
      }

      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data: StatusData | { task_ids?: string[], album_prg_files?: string[] } = await response.json(); // Add type for data

      // Handle artist downloads which return multiple album tasks
      if (type === 'artist') {
        // Check for new API response format
        if ('task_ids' in data && data.task_ids && Array.isArray(data.task_ids)) { // Type guard
          console.log(`Queued artist discography with ${data.task_ids.length} albums`);

          // Make queue visible to show progress
          this.toggleVisibility(true);

          // Create entries directly from task IDs and start monitoring them
          const queueIds: string[] = []; // Add type
          for (const taskId of data.task_ids) {
            console.log(`Adding album task with ID: ${taskId}`);
            // Create an album item with better display information
            const albumItem: QueueItem = { // Add type
              name: `${item.name || 'Artist'} - Album (loading...)`,
              artist: item.name || 'Unknown artist',
              type: 'album'
            };
            // Use improved addDownload with forced monitoring
            const queueId = this.addDownload(albumItem, 'album', taskId, apiUrl, true);
            queueIds.push(queueId);
          }

          return queueIds;
        }
        // Check for older API response format
        else if ('album_prg_files' in data && data.album_prg_files && Array.isArray(data.album_prg_files)) { // Type guard
          console.log(`Queued artist discography with ${data.album_prg_files.length} albums (old format)`);

          // Make queue visible to show progress
          this.toggleVisibility(true);

          // Add each album to the download queue separately with forced monitoring
          const queueIds: string[] = []; // Add type
          data.album_prg_files.forEach(prgFile => {
            console.log(`Adding album with PRG file: ${prgFile}`);
            // Create an album item with better display information
            const albumItem: QueueItem = { // Add type
              name: `${item.name || 'Artist'} - Album (loading...)`,
              artist: item.name || 'Unknown artist',
              type: 'album'
            };
            // Use improved addDownload with forced monitoring
            const queueId = this.addDownload(albumItem, 'album', prgFile, apiUrl, true);
            queueIds.push(queueId);
          });

          return queueIds;
        }
        // Handle any other response format for artist downloads
        else {
          console.log(`Queued artist discography with unknown format:`, data);

          // Make queue visible
          this.toggleVisibility(true);

          // Just load existing PRG files as a fallback
          await this.loadExistingPrgFiles();

          // Force start monitoring for all loaded entries
          for (const queueId in this.queueEntries) {
            const entry = this.queueEntries[queueId];
            if (!entry.hasEnded) {
              this.startDownloadStatusMonitoring(queueId);
            }
          }

          return data;
        }
      }

      // Handle single-file downloads (tracks, albums, playlists)
      if ('prg_file' in data && data.prg_file) { // Type guard
        console.log(`Adding ${type} PRG file: ${data.prg_file}`);

        // Store the initial metadata in the cache so it's available
        // even before the first status update
        this.queueCache[data.prg_file] = {
          type,
          status: 'initializing',
          name: item.name || 'Unknown',
          title: item.name || 'Unknown',
          artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0].name : ''),
          owner: typeof item.owner === 'string' ? item.owner : item.owner?.display_name || '',
          total_tracks: item.total_tracks || 0
        };

        // Use direct monitoring for all downloads for consistency
        const queueId = this.addDownload(item, type, data.prg_file, apiUrl, true);

        // Make queue visible to show progress if not already visible
        if (this.config && !this.config.downloadQueueVisible) { // Add null check for config
          this.toggleVisibility(true);
        }

        return queueId;
      } else {
        throw new Error('Invalid response format from server');
      }
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  /**
   * Loads existing PRG files from the /api/prgs/list endpoint and adds them as queue entries.
   */
  async loadExistingPrgFiles() {
    try {
      // Clear existing queue entries first to avoid duplicates when refreshing
      for (const queueId in this.queueEntries) {
        const entry = this.queueEntries[queueId];
        this.clearPollingInterval(queueId);
        delete this.queueEntries[queueId];
      }

      // Fetch detailed task list from the new endpoint
      const response = await fetch('/api/prgs/list');
      if (!response.ok) {
        console.error("Failed to load existing tasks:", response.status, await response.text());
        return;
      }
      const existingTasks: any[] = await response.json(); // We expect an array of detailed task objects

      const terminalStates = ['complete', 'done', 'cancelled', 'ERROR_AUTO_CLEANED', 'ERROR_RETRIED', 'cancel', 'interrupted', 'error'];

      for (const taskData of existingTasks) {
        const prgFile = taskData.task_id; // Use task_id as prgFile identifier
        const lastStatus = taskData.last_status_obj;
        const originalRequest = taskData.original_request || {};

        // Skip adding to UI if the task is already in a terminal state
        if (lastStatus && terminalStates.includes(lastStatus.status)) {
          console.log(`Skipping UI addition for terminal task ${prgFile}, status: ${lastStatus.status}`);
          // Also ensure it's cleaned from local cache if it was there
          if (this.queueCache[prgFile]) {
            delete this.queueCache[prgFile];
          }
          continue;
        }

        let itemType = taskData.type || originalRequest.type || 'unknown';
        let dummyItem: QueueItem = {
          name: taskData.name || originalRequest.name || prgFile,
          artist: taskData.artist || originalRequest.artist || '',
          type: itemType,
          url: originalRequest.url || lastStatus?.url || '',
          endpoint: originalRequest.endpoint || '',
          download_type: taskData.download_type || originalRequest.download_type || '',
          total_tracks: lastStatus?.total_tracks || originalRequest.total_tracks,
          current_track: lastStatus?.current_track,
        };

        // If this is a track with a parent from the last_status, adjust item and type
        if (lastStatus && lastStatus.type === 'track' && lastStatus.parent) {
          const parent = lastStatus.parent;
          if (parent.type === 'album') {
            itemType = 'album';
            dummyItem = {
              name: parent.title || 'Unknown Album',
              artist: parent.artist || 'Unknown Artist',
              type: 'album',
              url: parent.url || '',
              total_tracks: parent.total_tracks || lastStatus.total_tracks,
              parent: parent
            };
          } else if (parent.type === 'playlist') {
            itemType = 'playlist';
            dummyItem = {
              name: parent.name || 'Unknown Playlist',
              owner: parent.owner || 'Unknown Creator',
              type: 'playlist',
              url: parent.url || '',
              total_tracks: parent.total_tracks || lastStatus.total_tracks,
              parent: parent
            };
          }
        }

        let retryCount = 0;
        if (lastStatus && lastStatus.retry_count) {
          retryCount = lastStatus.retry_count;
        } else if (prgFile.includes('_retry')) {
            const retryMatch = prgFile.match(/_retry(\d+)/);
            if (retryMatch && retryMatch[1]) {
              retryCount = parseInt(retryMatch[1], 10);
            }
        }

        const requestUrl = originalRequest.url ? `/api/${itemType}/download/${originalRequest.url.split('/').pop()}?name=${encodeURIComponent(dummyItem.name || '')}&artist=${encodeURIComponent(dummyItem.artist || '')}` : null;

        const queueId = this.generateQueueId();
        const entry = this.createQueueEntry(dummyItem, itemType, prgFile, queueId, requestUrl);
        entry.retryCount = retryCount;

        if (lastStatus) {
          entry.lastStatus = lastStatus;
          if (lastStatus.parent) {
            entry.parentInfo = lastStatus.parent;
          }
          this.queueCache[prgFile] = lastStatus; // Cache the last known status
          this.applyStatusClasses(entry, lastStatus);

          const logElement = entry.element.querySelector('.log') as HTMLElement | null;
          if (logElement) {
            logElement.textContent = this.getStatusMessage(lastStatus);
          }
        }
        this.queueEntries[queueId] = entry;
      }

      localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
      this.updateQueueOrder();
      this.startMonitoringActiveEntries();
    } catch (error) {
      console.error("Error loading existing PRG files:", error);
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Failed to fetch config');
      this.config = await response.json();

      // Update our retry constants from the server config
      if (this.config.maxRetries !== undefined) {
        this.MAX_RETRIES = this.config.maxRetries;
      }
      if (this.config.retryDelaySeconds !== undefined) {
        this.RETRY_DELAY = this.config.retryDelaySeconds;
      }
      if (this.config.retry_delay_increase !== undefined) {
        this.RETRY_DELAY_INCREASE = this.config.retry_delay_increase;
      }

      console.log(`Loaded retry settings from config: max=${this.MAX_RETRIES}, delay=${this.RETRY_DELAY}, increase=${this.RETRY_DELAY_INCREASE}`);
    } catch (error) {
      console.error('Error loading config:', error);
      this.config = { // Initialize with a default structure on error
        downloadQueueVisible: false,
        maxRetries: 3,
        retryDelaySeconds: 5,
        retry_delay_increase: 5,
        explicitFilter: false
      };
    }
  }

  async saveConfig(updatedConfig: AppConfig) { // Add type
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig)
      });
      if (!response.ok) throw new Error('Failed to save config');
      this.config = await response.json();
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }

  // Add a method to check if explicit filter is enabled
  isExplicitFilterEnabled(): boolean { // Add return type
    return !!this.config.explicitFilter;
  }

  /* Sets up a polling interval for real-time status updates */
  setupPollingInterval(queueId: string) { // Add type
    console.log(`Setting up polling for ${queueId}`);
    const entry = this.queueEntries[queueId];
    if (!entry || !entry.prgFile) {
      console.warn(`No entry or prgFile for ${queueId}`);
      return;
    }

    // Close any existing connection
    this.clearPollingInterval(queueId);

    try {
      // Immediately fetch initial data
      this.fetchDownloadStatus(queueId);

      // Create a polling interval of 500ms for more responsive UI updates
      const intervalId = setInterval(() => {
        this.fetchDownloadStatus(queueId);
      }, 500);

      // Store the interval ID for later cleanup
      this.pollingIntervals[queueId] = intervalId as unknown as number; // Cast to number via unknown
    } catch (error) {
      console.error(`Error creating polling for ${queueId}:`, error);
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
      if (logElement) {
        logElement.textContent = `Error with download: ${(error as Error).message}`; // Cast to Error
        entry.element.classList.add('error');
      }
    }
  }

  async fetchDownloadStatus(queueId: string) { // Add type
    const entry = this.queueEntries[queueId];
    if (!entry || !entry.prgFile) {
      console.warn(`No entry or prgFile for ${queueId}`);
      return;
    }

    try {
      const response = await fetch(`/api/prgs/${entry.prgFile}`);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const data: StatusData = await response.json(); // Add type

      // If the last_line doesn't have name/artist/title info, add it from our stored item data
      if (data.last_line && entry.item) {
        if (!data.last_line.name && entry.item.name) {
          data.last_line.name = entry.item.name;
        }
        if (!data.last_line.title && entry.item.name) {
          data.last_line.title = entry.item.name;
        }
        if (!data.last_line.artist && entry.item.artist) {
          data.last_line.artist = entry.item.artist;
        } else if (!data.last_line.artist && entry.item.artists && entry.item.artists.length > 0) {
          data.last_line.artist = entry.item.artists[0].name;
        }
        if (!data.last_line.owner && entry.item.owner) {
          data.last_line.owner = typeof entry.item.owner === 'string' ? entry.item.owner : entry.item.owner?.display_name ;
        }
        if (!data.last_line.total_tracks && entry.item.total_tracks) {
          data.last_line.total_tracks = entry.item.total_tracks;
        }
      }

      // Initialize the download type if needed
      if (data.type && !entry.type) {
        console.log(`Setting entry type to: ${data.type}`);
        entry.type = data.type;

        // Update type display if element exists
        const typeElement = entry.element.querySelector('.type') as HTMLElement | null;
        if (typeElement) {
          typeElement.textContent = data.type.charAt(0).toUpperCase() + data.type.slice(1);
          // Update type class without triggering animation
          typeElement.className = `type ${data.type}`;
        }
      }

      // Special handling for track updates that are part of an album/playlist
      // Don't filter these out as they contain important track progress info
      if (data.last_line && data.last_line.type === 'track' && data.last_line.parent) {
        // This is a track update that's part of our album/playlist - keep it
        if ((entry.type === 'album' && data.last_line.parent.type === 'album') ||
            (entry.type === 'playlist' && data.last_line.parent.type === 'playlist')) {
          console.log(`Processing track update for ${entry.type} download: ${data.last_line.song}`);
          // Continue processing - don't return
        }
      }
      // Only filter out updates that don't match entry type AND don't have a relevant parent
      else if (data.last_line && data.last_line.type && entry.type &&
               data.last_line.type !== entry.type &&
               (!data.last_line.parent || data.last_line.parent.type !== entry.type)) {
        console.log(`Skipping status update with type '${data.last_line.type}' for entry with type '${entry.type}'`);
        return;
      }

      // Process the update
      this.handleStatusUpdate(queueId, data);

      // Handle terminal states
      if (data.last_line && ['complete', 'error', 'cancelled', 'done'].includes(data.last_line.status || '')) { // Add null check
        console.log(`Terminal state detected: ${data.last_line.status} for ${queueId}`);
        entry.hasEnded = true;

        // For cancelled downloads, clean up immediately
        if (data.last_line.status === 'cancelled' || data.last_line.status === 'cancel') {
          console.log('Cleaning up cancelled download immediately');
          this.clearPollingInterval(queueId);
          this.cleanupEntry(queueId);
          return; // No need to process further
        }

        // Only set up cleanup if this is not an error that we're in the process of retrying
        // If status is 'error' but the status message contains 'Retrying', don't clean up
        const isRetrying = entry.isRetrying ||
                          (data.last_line.status === 'error' &&
                           entry.element.querySelector('.log')?.textContent?.includes('Retry'));

        if (!isRetrying) {
          setTimeout(() => {
            // Double-check the entry still exists and has not been retried before cleaning up
            const currentEntry = this.queueEntries[queueId]; // Get current entry
            if (currentEntry &&  // Check if currentEntry exists
                !currentEntry.isRetrying &&
                currentEntry.hasEnded) {
              this.clearPollingInterval(queueId);
              this.cleanupEntry(queueId);
            }
          }, data.last_line.status === 'complete' || data.last_line.status === 'done' ? 3000 : 5000); // 3s for complete/done, 5s for others
        }
      }

    } catch (error) {
      console.error(`Error fetching status for ${queueId}:`, error);

      // Show error in log
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
      if (logElement) {
        logElement.textContent = `Error updating status: ${(error as Error).message}`; // Cast to Error
      }
    }
  }

  clearPollingInterval(queueId: string) { // Add type
    if (this.pollingIntervals[queueId]) {
      console.log(`Stopping polling for ${queueId}`);
      try {
        clearInterval(this.pollingIntervals[queueId] as number); // Cast to number
      } catch (error) {
        console.error(`Error stopping polling for ${queueId}:`, error);
      }
      delete this.pollingIntervals[queueId];
    }
  }

  /* Handle status updates from the progress API */
  handleStatusUpdate(queueId: string, data: StatusData) { // Add types
    const entry = this.queueEntries[queueId];
    if (!entry) {
      console.warn(`No entry for ${queueId}`);
      return;
    }

    // Extract the actual status data from the API response
    const statusData: StatusData = data.last_line || {}; // Add type

    // Special handling for track status updates that are part of an album/playlist
    // We want to keep these for showing the track-by-track progress
    if (statusData.type === 'track' && statusData.parent) {
      // If this is a track that's part of our album/playlist, keep it
      if ((entry.type === 'album' && statusData.parent.type === 'album') ||
          (entry.type === 'playlist' && statusData.parent.type === 'playlist')) {
        console.log(`Processing track status update for ${entry.type}: ${statusData.song}`);
      }
    }
    // Only skip updates where type doesn't match AND there's no relevant parent relationship
    else if (statusData.type && entry.type && statusData.type !== entry.type &&
             (!statusData.parent || statusData.parent.type !== entry.type)) {
      console.log(`Skipping mismatched type: update=${statusData.type}, entry=${entry.type}`);
      return;
    }

    // Get primary status
    let status = statusData.status || data.event || 'unknown'; // Define status *before* potential modification

    // Stall detection for 'real_time' status
    if (status === 'real_time') {
        entry.realTimeStallDetector = entry.realTimeStallDetector || { count: 0, lastStatusJson: '' };
        const detector = entry.realTimeStallDetector;

        const currentMetrics = {
            progress: statusData.progress,
            time_elapsed: statusData.time_elapsed,
            // For multi-track items, current_track is a key indicator of activity
            current_track: (entry.type === 'album' || entry.type === 'playlist') ? statusData.current_track : undefined,
            // Include other relevant fields if they signify activity, e.g., speed, eta
            // For example, if statusData.song changes for an album, that's progress.
            song: statusData.song
        };
        const currentMetricsJson = JSON.stringify(currentMetrics);

        // Check if significant metrics are present and static
        if (detector.lastStatusJson === currentMetricsJson &&
            (currentMetrics.progress !== undefined || currentMetrics.time_elapsed !== undefined || currentMetrics.current_track !== undefined || currentMetrics.song !== undefined)) {
            // Metrics are present and haven't changed
            detector.count++;
        } else {
            // Metrics changed, or this is the first time seeing them, or no metrics to compare (e.g. empty object from server)
            detector.count = 0;
            // Only update lastStatusJson if currentMetricsJson represents actual data, not an empty object if that's possible
            if (currentMetricsJson !== '{}' || detector.lastStatusJson === '') { // Avoid replacing actual old data with '{}' if new data is sparse
                 detector.lastStatusJson = currentMetricsJson;
            }
        }

        const STALL_THRESHOLD = 600; // Approx 5 minutes (600 polls * 0.5s/poll)
        if (detector.count >= STALL_THRESHOLD) {
            console.warn(`Download ${queueId} (${entry.prgFile}) appears stalled in real_time state. Metrics: ${detector.lastStatusJson}. Stall count: ${detector.count}. Forcing error.`);
            statusData.status = 'error';
            statusData.error = 'Download stalled (no progress updates for 5 minutes)';
            statusData.can_retry = true; // Allow manual retry for stalled items
            status = 'error'; // Update local status variable for current execution scope

            // Reset detector for this entry in case of retry
            detector.count = 0;
            detector.lastStatusJson = '';
        }
    }

    // Store the status data for potential retries
    entry.lastStatus = statusData; // This now stores the potentially modified statusData (e.g., status changed to 'error')
    entry.lastUpdated = Date.now();

    // Update type if needed - could be more specific now (e.g., from 'album' to 'compilation')
    if (statusData.type && statusData.type !== entry.type) {
      entry.type = statusData.type;
      const typeEl = entry.element.querySelector('.type') as HTMLElement | null;
      if (typeEl) {
        const displayType = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
        typeEl.textContent = displayType;
        typeEl.className = `type ${entry.type}`;
      }
    }

    // Update the title and artist with better information if available
    this.updateItemMetadata(entry, statusData, data);

    // Generate appropriate user-friendly message
    const message = this.getStatusMessage(statusData);

    // Update log message - but only if we're not handling a track update for an album/playlist
    // That case is handled separately in updateItemMetadata to ensure we show the right track info
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
    if (logElement && status !== 'error' && !(statusData.type === 'track' && statusData.parent &&
        (entry.type === 'album' || entry.type === 'playlist'))) {
      logElement.textContent = message;
    }

    // Handle real-time progress data for single track downloads
    if (status === 'real-time') {
      this.updateRealTimeProgress(entry, statusData);
    }

    // Handle overall progress for albums and playlists
    const isMultiTrack = entry.type === 'album' || entry.type === 'playlist';
    if (isMultiTrack) {
      this.updateMultiTrackProgress(entry, statusData);
    } else {
      // For single tracks, update the track progress
      this.updateSingleTrackProgress(entry, statusData);
    }

    // Apply appropriate status classes
    this.applyStatusClasses(entry, statusData); // Pass statusData instead of status string

    // Special handling for error status based on new API response format
    if (status === 'error') {
      entry.hasEnded = true;
      // Hide cancel button
      const cancelBtn = entry.element.querySelector('.cancel-btn') as HTMLButtonElement | null;
      if (cancelBtn) cancelBtn.style.display = 'none';

      // Hide progress bars for errored items
      const trackProgressContainer = entry.element.querySelector(`#track-progress-container-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
      if (trackProgressContainer) trackProgressContainer.style.display = 'none';
      const overallProgressContainer = entry.element.querySelector('.overall-progress-container') as HTMLElement | null;
      if (overallProgressContainer) overallProgressContainer.style.display = 'none';
      // Hide time elapsed for errored items
      const timeElapsedContainer = entry.element.querySelector(`#time-elapsed-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
      if (timeElapsedContainer) timeElapsedContainer.style.display = 'none';

      // Extract error details
      const errMsg = statusData.error || 'An unknown error occurred.'; // Ensure errMsg is a string
      // const canRetry = Boolean(statusData.can_retry) && statusData.retry_count < statusData.max_retries; // This logic is implicitly handled by retry button availability
      const retryUrl = data.original_url || data.original_request?.url || entry.requestUrl || null;
      if (retryUrl) {
        entry.requestUrl = retryUrl; // Store for retry logic
      }

      console.log(`Error for ${entry.type} download. Can retry: ${!!entry.requestUrl}. Retry URL: ${entry.requestUrl}`);

      const errorLogElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null; // Use a different variable name
      if (errorLogElement) { // Check errorLogElement
        let errorMessageElement = errorLogElement.querySelector('.error-message') as HTMLElement | null;

        if (!errorMessageElement) { // If error UI (message and buttons) is not built yet
        // Build error UI with manual retry always available
        errorLogElement.innerHTML = `
          <div class="error-message">${errMsg}</div>
          <div class="error-buttons">
            <button class="close-error-btn" title="Close">
              <img src="/static/images/cross.svg" alt="Close error" style="width: 12px; height: 12px; vertical-align: middle;">
            </button>
            <button class="retry-btn" title="Retry download">Retry</button>
          </div>
        `;
          errorMessageElement = errorLogElement.querySelector('.error-message') as HTMLElement | null; // Re-select after innerHTML change

          // Attach listeners ONLY when creating the buttons
          const closeErrorBtn = errorLogElement.querySelector('.close-error-btn') as HTMLButtonElement | null;
          if (closeErrorBtn) {
            closeErrorBtn.addEventListener('click', () => {
          this.cleanupEntry(queueId);
        });
          }

          const retryBtnElem = errorLogElement.querySelector('.retry-btn') as HTMLButtonElement | null;
          if (retryBtnElem) {
            retryBtnElem.addEventListener('click', (e: MouseEvent) => { // Add type for e
          e.preventDefault();
          e.stopPropagation();
              if (retryBtnElem) { // Check if retryBtnElem is not null
                retryBtnElem.disabled = true;
                retryBtnElem.innerHTML = '<span class="loading-spinner small"></span> Retrying...';
              }
          this.retryDownload(queueId, errorLogElement); // Pass errorLogElement
        });
          }

          // Auto cleanup after 15s - only set this timeout once when error UI is first built
        setTimeout(() => {
            const currentEntryForCleanup = this.queueEntries[queueId];
            if (currentEntryForCleanup &&
                currentEntryForCleanup.hasEnded &&
                currentEntryForCleanup.lastStatus?.status === 'error' &&
                !currentEntryForCleanup.isRetrying) {
            this.cleanupEntry(queueId);
          }
        }, 20000); // Changed from 15000 to 20000

        } else { // Error UI already exists, just update the message text if it's different
          if (errorMessageElement.textContent !== errMsg) {
            errorMessageElement.textContent = errMsg;
          }
        }
      }
    }

    // Handle terminal states for non-error cases
    if (['complete', 'cancel', 'cancelled', 'done', 'skipped'].includes(status)) {
      entry.hasEnded = true;
      this.handleDownloadCompletion(entry, queueId, statusData);
    }

    // Cache the status for potential page reloads
    this.queueCache[entry.prgFile] = statusData;
    localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
  }

  // Update item metadata (title, artist, etc.)
  updateItemMetadata(entry: QueueEntry, statusData: StatusData, data: StatusData) { // Add types
    const titleEl = entry.element.querySelector('.title') as HTMLElement | null;
    const artistEl = entry.element.querySelector('.artist') as HTMLElement | null;

    if (titleEl) {
      // Check various data sources for a better title
      let betterTitle: string | null | undefined = null;

      // First check the statusData
      if (statusData.song) {
        betterTitle = statusData.song;
      } else if (statusData.album) {
        betterTitle = statusData.album;
      } else if (statusData.name) {
        betterTitle = statusData.name;
      }
      // Then check if data has original_request with name
      else if (data.original_request && data.original_request.name) {
        betterTitle = data.original_request.name;
      }
      // Then check display_title from various sources
      else if (statusData.display_title) {
        betterTitle = statusData.display_title;
      } else if (data.display_title) {
        betterTitle = data.display_title;
      }

      // Update title if we found a better one
      if (betterTitle && betterTitle !== titleEl.textContent) {
        titleEl.textContent = betterTitle;
        // Also update the item's name for future reference
        entry.item.name = betterTitle;
      }
    }

    // Update artist if available
    if (artistEl) {
      let artist = statusData.artist || data.display_artist || '';
      if (artist && (!artistEl.textContent || artistEl.textContent !== artist)) {
        artistEl.textContent = artist;
        // Update item data
        entry.item.artist = artist;
      }
    }
  }

  // Update real-time progress for track downloads
  updateRealTimeProgress(entry: QueueEntry, statusData: StatusData) { // Add types
    // Get track progress bar
    const trackProgressBar = entry.element.querySelector('#track-progress-bar-' + entry.uniqueId + '-' + entry.prgFile) as HTMLElement | null;
    const timeElapsedEl = entry.element.querySelector('#time-elapsed-' + entry.uniqueId + '-' + entry.prgFile) as HTMLElement | null;

    if (trackProgressBar && statusData.progress !== undefined) {
      // Update track progress bar
      const progress = parseFloat(statusData.progress as string); // Cast to string
      trackProgressBar.style.width = `${progress}%`;
      trackProgressBar.setAttribute('aria-valuenow', progress.toString()); // Use string

      // Add success class when complete
      if (progress >= 100) {
        trackProgressBar.classList.add('complete');
      } else {
        trackProgressBar.classList.remove('complete');
      }
    }

    // Display time elapsed if available
    if (timeElapsedEl && statusData.time_elapsed !== undefined) {
      const seconds = Math.floor(statusData.time_elapsed / 1000);
      const formattedTime = seconds < 60
        ? `${seconds}s`
        : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
      timeElapsedEl.textContent = formattedTime;
    }
  }

  // Update progress for single track downloads
  updateSingleTrackProgress(entry: QueueEntry, statusData: StatusData) { // Add types
    // Get track progress bar and other UI elements
    const trackProgressBar = entry.element.querySelector('#track-progress-bar-' + entry.uniqueId + '-' + entry.prgFile) as HTMLElement | null;
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
    const titleElement = entry.element.querySelector('.title') as HTMLElement | null;
    const artistElement = entry.element.querySelector('.artist') as HTMLElement | null;
    let progress = 0; // Declare progress here

    // If this track has a parent, this is actually part of an album/playlist
    // We should update the entry type and handle it as a multi-track download
    if (statusData.parent && (statusData.parent.type === 'album' || statusData.parent.type === 'playlist')) {
      // Store parent info
      entry.parentInfo = statusData.parent;

      // Update entry type to match parent type
      entry.type = statusData.parent.type;

      // Update UI to reflect the parent type
      const typeEl = entry.element.querySelector('.type') as HTMLElement | null;
      if (typeEl) {
        const displayType = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
        typeEl.textContent = displayType;
        // Update type class without triggering animation
        typeEl.className = `type ${entry.type}`;
      }

      // Update title and subtitle based on parent type
      if (statusData.parent.type === 'album') {
        if (titleElement) titleElement.textContent = statusData.parent.title || 'Unknown album';
        if (artistElement) artistElement.textContent = statusData.parent.artist || 'Unknown artist';
      } else if (statusData.parent.type === 'playlist') {
        if (titleElement) titleElement.textContent = statusData.parent.name || 'Unknown playlist';
        if (artistElement) artistElement.textContent = statusData.parent.owner || 'Unknown creator';
      }

      // Now delegate to the multi-track progress updater
      this.updateMultiTrackProgress(entry, statusData);
      return;
    }

    // For standalone tracks (without parent), update title and subtitle
    if (!statusData.parent && statusData.song && titleElement) {
      titleElement.textContent = statusData.song;
    }

    if (!statusData.parent && statusData.artist && artistElement) {
      artistElement.textContent = statusData.artist;
    }

    // For individual track downloads, show the parent context if available
    if (!['done', 'complete', 'error', 'skipped'].includes(statusData.status || '')) { // Add null check
      // First check if we have parent data in the current status update
      if (statusData.parent && logElement) {
        // Store parent info in the entry for persistence across refreshes
        entry.parentInfo = statusData.parent;

        let infoText = '';
        if (statusData.parent.type === 'album') {
          infoText = `From album: "${statusData.parent.title}"`;
        } else if (statusData.parent.type === 'playlist') {
          infoText = `From playlist: "${statusData.parent.name}" by ${statusData.parent.owner}`;
        }

        if (infoText) {
          logElement.textContent = infoText;
        }
      }
      // If no parent in current update, use stored parent info if available
      else if (entry.parentInfo && logElement) {
        let infoText = '';
        if (entry.parentInfo.type === 'album') {
          infoText = `From album: "${entry.parentInfo.title}"`;
        } else if (entry.parentInfo.type === 'playlist') {
          infoText = `From playlist: "${entry.parentInfo.name}" by ${entry.parentInfo.owner}`;
        }

        if (infoText) {
          logElement.textContent = infoText;
        }
      }
    }

    // Calculate progress based on available data
    progress = 0;

    // Real-time progress for direct track download
    if (statusData.status === 'real-time' && statusData.progress !== undefined) {
      progress = parseFloat(statusData.progress as string); // Cast to string
    } else if (statusData.percent !== undefined) {
      progress = parseFloat(statusData.percent as string) * 100; // Cast to string
    } else if (statusData.percentage !== undefined) {
      progress = parseFloat(statusData.percentage as string) * 100; // Cast to string
    } else if (statusData.status === 'done' || statusData.status === 'complete') {
      progress = 100;
    } else if (statusData.current_track && statusData.total_tracks) {
      // If we don't have real-time progress but do have track position
      progress = (parseInt(statusData.current_track as string, 10) / parseInt(statusData.total_tracks as string, 10)) * 100; // Cast to string
    }

    // Update track progress bar if available
    if (trackProgressBar) {
      // Ensure numeric progress and prevent NaN
      const safeProgress = isNaN(progress) ? 0 : Math.max(0, Math.min(100, progress));

      trackProgressBar.style.width = `${safeProgress}%`;
      trackProgressBar.setAttribute('aria-valuenow', safeProgress.toString()); // Use string

      // Make sure progress bar is visible
      const trackProgressContainer = entry.element.querySelector('#track-progress-container-' + entry.uniqueId + '-' + entry.prgFile) as HTMLElement | null;
      if (trackProgressContainer) {
        trackProgressContainer.style.display = 'block';
      }

      // Add success class when complete
      if (safeProgress >= 100) {
        trackProgressBar.classList.add('complete');
      } else {
        trackProgressBar.classList.remove('complete');
      }
    }
  }

  // Update progress for multi-track downloads (albums and playlists)
  updateMultiTrackProgress(entry: QueueEntry, statusData: StatusData) { // Add types
    // Get progress elements
    const progressCounter = document.getElementById(`progress-count-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
    const overallProgressBar = document.getElementById(`overall-bar-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
    const trackProgressBar = entry.element.querySelector('#track-progress-bar-' + entry.uniqueId + '-' + entry.prgFile) as HTMLElement | null;
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`) as HTMLElement | null;
    const titleElement = entry.element.querySelector('.title') as HTMLElement | null;
    const artistElement = entry.element.querySelector('.artist') as HTMLElement | null;
    let progress = 0; // Declare progress here for this function's scope

    // Initialize track progress variables
    let currentTrack = 0;
    let totalTracks = 0;
    let trackProgress = 0;

    // Handle track-level updates for album/playlist downloads
    if (statusData.type === 'track' && statusData.parent &&
        (entry.type === 'album' || entry.type === 'playlist')) {
      console.log('Processing track update for multi-track download:', statusData);

      // Update parent title/artist for album
      if (entry.type === 'album' && statusData.parent.type === 'album') {
        if (titleElement && statusData.parent.title) {
          titleElement.textContent = statusData.parent.title;
        }
        if (artistElement && statusData.parent.artist) {
          artistElement.textContent = statusData.parent.artist;
        }
      }
      // Update parent title/owner for playlist
      else if (entry.type === 'playlist' && statusData.parent.type === 'playlist') {
        if (titleElement && statusData.parent.name) {
          titleElement.textContent = statusData.parent.name;
        }
        if (artistElement && statusData.parent.owner) {
          artistElement.textContent = statusData.parent.owner;
        }
      }

      // Get current track and total tracks from the status data
      if (statusData.current_track !== undefined) {
        currentTrack = parseInt(String(statusData.current_track), 10);

        // Get total tracks - try from statusData first, then from parent
        if (statusData.total_tracks !== undefined) {
          totalTracks = parseInt(String(statusData.total_tracks), 10);
        } else if (statusData.parent && statusData.parent.total_tracks !== undefined) {
          totalTracks = parseInt(String(statusData.parent.total_tracks), 10);
        }

        console.log(`Track info: ${currentTrack}/${totalTracks}`);
      }

      // Get track progress for real-time updates
      if (statusData.status === 'real-time' && statusData.progress !== undefined) {
        trackProgress = parseFloat(statusData.progress as string); // Cast to string
      }

      // Update the track progress counter display
      if (progressCounter && totalTracks > 0) {
        progressCounter.textContent = `${currentTrack}/${totalTracks}`;
      }

      // Update the status message to show current track
      if (logElement && statusData.song && statusData.artist) {
        let progressInfo = '';
        if (statusData.status === 'real-time' && trackProgress > 0) {
          progressInfo = ` - ${trackProgress.toFixed(1)}%`;
        }
        logElement.textContent = `Currently downloading: ${statusData.song} by ${statusData.artist} (${currentTrack}/${totalTracks}${progressInfo})`;
      }

      // Calculate and update the overall progress bar
      if (totalTracks > 0) {
        let overallProgress = 0;
        // Always compute overall based on trackProgress if available, using album/playlist real-time formula
        if (trackProgress !== undefined) {
          const completedTracksProgress = (currentTrack - 1) / totalTracks;
          const currentTrackContribution = (1 / totalTracks) * (trackProgress / 100);
          overallProgress = (completedTracksProgress + currentTrackContribution) * 100;
          console.log(`Overall progress: ${overallProgress.toFixed(2)}% (Track ${currentTrack}/${totalTracks}, Progress: ${trackProgress}%)`);
        } else {
          overallProgress = (currentTrack / totalTracks) * 100;
          console.log(`Overall progress (non-real-time): ${overallProgress.toFixed(2)}% (Track ${currentTrack}/${totalTracks})`);
        }

        // Update the progress bar
        if (overallProgressBar) {
          const safeProgress = Math.max(0, Math.min(100, overallProgress));
          overallProgressBar.style.width = `${safeProgress}%`;
          overallProgressBar.setAttribute('aria-valuenow', safeProgress.toString()); // Use string

          if (safeProgress >= 100) {
            overallProgressBar.classList.add('complete');
          } else {
            overallProgressBar.classList.remove('complete');
          }
        }

        // Update the track-level progress bar
        if (trackProgressBar) {
          // Make sure progress bar container is visible
          const trackProgressContainer = entry.element.querySelector('#track-progress-container-' + entry.uniqueId + '-' + entry.prgFile) as HTMLElement | null;
          if (trackProgressContainer) {
            trackProgressContainer.style.display = 'block';
          }

          if (statusData.status === 'real-time') {
            // Real-time progress for the current track
            const safeTrackProgress = Math.max(0, Math.min(100, trackProgress));
            trackProgressBar.style.width = `${safeTrackProgress}%`;
            trackProgressBar.setAttribute('aria-valuenow', safeTrackProgress.toString()); // Use string
            trackProgressBar.classList.add('real-time');

            if (safeTrackProgress >= 100) {
              trackProgressBar.classList.add('complete');
            } else {
              trackProgressBar.classList.remove('complete');
            }
          } else {
            // Indeterminate progress animation for non-real-time updates
            trackProgressBar.classList.add('progress-pulse');
            trackProgressBar.style.width = '100%';
            trackProgressBar.setAttribute('aria-valuenow', "50"); // Use string
          }
        }

        // Store progress for potential later use
        entry.progress = overallProgress;
      }

      return; // Skip the standard handling below
    }

    // Standard handling for album/playlist direct updates (not track-level):
    // Update title and subtitle based on item type
    if (entry.type === 'album') {
      if (statusData.title && titleElement) {
        titleElement.textContent = statusData.title;
      }
      if (statusData.artist && artistElement) {
        artistElement.textContent = statusData.artist;
      }
    } else if (entry.type === 'playlist') {
      if (statusData.name && titleElement) {
        titleElement.textContent = statusData.name;
      }
      if (statusData.owner && artistElement) {
        artistElement.textContent = statusData.owner;
      }
    }

    // Extract track counting data from status data
    if (statusData.current_track && statusData.total_tracks) {
      currentTrack = parseInt(statusData.current_track as string, 10); // Cast to string
      totalTracks = parseInt(statusData.total_tracks as string, 10); // Cast to string
    } else if (statusData.parsed_current_track && statusData.parsed_total_tracks) {
      currentTrack = parseInt(statusData.parsed_current_track as string, 10); // Cast to string
      totalTracks = parseInt(statusData.parsed_total_tracks as string, 10); // Cast to string
    } else if (statusData.current_track && typeof statusData.current_track === 'string' && /^\d+\/\d+$/.test(statusData.current_track)) { // Add type check
      // Parse formats like "1/12"
      const parts = statusData.current_track.split('/');
      currentTrack = parseInt(parts[0], 10);
      totalTracks = parseInt(parts[1], 10);
    }

    // Get track progress for real-time downloads
    if (statusData.status === 'real-time' && statusData.progress !== undefined) {
      // For real-time downloads, progress comes as a percentage value (0-100)
      trackProgress = parseFloat(statusData.progress as string); // Cast to string
    } else if (statusData.percent !== undefined) {
      // Handle percent values (0-1)
      trackProgress = parseFloat(statusData.percent as string) * 100; // Cast to string
    } else if (statusData.percentage !== undefined) {
      // Handle percentage values (0-1)
      trackProgress = parseFloat(statusData.percentage as string) * 100; // Cast to string
    } else if (statusData.status === 'done' || statusData.status === 'complete') {
      progress = 100;
    } else if (statusData.current_track && statusData.total_tracks) {
      // If we don't have real-time progress but do have track position
      progress = (parseInt(statusData.current_track as string, 10) / parseInt(statusData.total_tracks as string, 10)) * 100; // Cast to string
    }

    // Update progress counter if available
    if (progressCounter && totalTracks > 0) {
      progressCounter.textContent = `${currentTrack}/${totalTracks}`;
    }

    // Calculate overall progress
    let overallProgress = 0;
    if (totalTracks > 0) {
      // Use explicit overall_progress if provided
      if (statusData.overall_progress !== undefined) {
        overallProgress = statusData.overall_progress; // overall_progress is number
      } else if (trackProgress !== undefined) {
        // For both real-time and standard multi-track downloads, use same formula
        const completedTracksProgress = (currentTrack - 1) / totalTracks;
        const currentTrackContribution = (1 / totalTracks) * (trackProgress / 100);
        overallProgress = (completedTracksProgress + currentTrackContribution) * 100;
        console.log(`Progress: Track ${currentTrack}/${totalTracks}, Track progress: ${trackProgress}%, Overall: ${overallProgress.toFixed(2)}%`);
      } else {
        overallProgress = 0;
      }

      // Update overall progress bar
      if (overallProgressBar) {
        // Ensure progress is between 0-100
        const safeProgress = Math.max(0, Math.min(100, overallProgress));
        overallProgressBar.style.width = `${safeProgress}%`;
        overallProgressBar.setAttribute('aria-valuenow', String(safeProgress));

        // Add success class when complete
        if (safeProgress >= 100) {
          overallProgressBar.classList.add('complete');
        } else {
          overallProgressBar.classList.remove('complete');
        }
      }

      // Update track progress bar for current track in multi-track items
      if (trackProgressBar) {
        // Make sure progress bar container is visible
        const trackProgressContainer = entry.element.querySelector('#track-progress-container-' + entry.uniqueId + '-' + entry.prgFile) as HTMLElement | null;
        if (trackProgressContainer) {
          trackProgressContainer.style.display = 'block';
        }

        if (statusData.status === 'real-time' || statusData.status === 'real_time') {
          // For real-time updates, use the track progress for the small green progress bar
          // This shows download progress for the current track only
          const safeProgress = isNaN(trackProgress) ? 0 : Math.max(0, Math.min(100, trackProgress));
          trackProgressBar.style.width = `${safeProgress}%`;
          trackProgressBar.setAttribute('aria-valuenow', String(safeProgress));
          trackProgressBar.classList.add('real-time');

          if (safeProgress >= 100) {
            trackProgressBar.classList.add('complete');
          } else {
            trackProgressBar.classList.remove('complete');
          }
        } else if (['progress', 'processing'].includes(statusData.status || '')) {
          // For non-real-time progress updates, show an indeterminate-style progress
          // by using a pulsing animation via CSS
          trackProgressBar.classList.add('progress-pulse');
          trackProgressBar.style.width = '100%';
          trackProgressBar.setAttribute('aria-valuenow', String(50)); // indicate in-progress
        } else {
          // For other status updates, use current track position
          trackProgressBar.classList.remove('progress-pulse');
          const trackPositionPercent = currentTrack > 0 ? 100 : 0;
          trackProgressBar.style.width = `${trackPositionPercent}%`;
          trackProgressBar.setAttribute('aria-valuenow', String(trackPositionPercent));
        }
      }

      // Store the progress in the entry for potential later use
      entry.progress = overallProgress;
    }
  }

  /* Close all active polling intervals */
  clearAllPollingIntervals() {
    for (const queueId in this.pollingIntervals) {
      this.clearPollingInterval(queueId);
    }
  }

  /* New method for periodic server sync */
  async periodicSyncWithServer() {
    console.log("Performing periodic sync with server...");
    try {
      const response = await fetch('/api/prgs/list');
      if (!response.ok) {
        console.error("Periodic sync: Failed to fetch task list from server", response.status);
        return;
      }
      const serverTasks: any[] = await response.json();

      const localTaskPrgFiles = new Set(Object.values(this.queueEntries).map(entry => entry.prgFile));
      const serverTaskPrgFiles = new Set(serverTasks.map(task => task.task_id));

      const terminalStates = ['complete', 'done', 'cancelled', 'ERROR_AUTO_CLEANED', 'ERROR_RETRIED', 'cancel', 'interrupted', 'error'];

      // 1. Add new tasks from server not known locally or update existing ones
      for (const serverTask of serverTasks) {
        const taskId = serverTask.task_id; // This is the prgFile
        const lastStatus = serverTask.last_status_obj;
        const originalRequest = serverTask.original_request || {};

        if (terminalStates.includes(lastStatus?.status)) {
          // If server says it's terminal, and we have it locally, ensure it's cleaned up
          const localEntry = Object.values(this.queueEntries).find(e => e.prgFile === taskId);
          if (localEntry && !localEntry.hasEnded) {
            console.log(`Periodic sync: Server task ${taskId} is terminal (${lastStatus.status}), cleaning up local entry.`);
            // Use a status object for handleDownloadCompletion
            this.handleDownloadCompletion(localEntry, localEntry.uniqueId, lastStatus);
          }
          continue; // Skip adding terminal tasks to UI if not already there
        }

        if (!localTaskPrgFiles.has(taskId)) {
          console.log(`Periodic sync: Found new non-terminal task ${taskId} on server. Adding to queue.`);
          let itemType = serverTask.type || originalRequest.type || 'unknown';
          let dummyItem: QueueItem = {
            name: serverTask.name || originalRequest.name || taskId,
            artist: serverTask.artist || originalRequest.artist || '',
            type: itemType,
            url: originalRequest.url || lastStatus?.url || '',
            endpoint: originalRequest.endpoint || '',
            download_type: serverTask.download_type || originalRequest.download_type || '',
            total_tracks: lastStatus?.total_tracks || originalRequest.total_tracks,
            current_track: lastStatus?.current_track,
          };

           if (lastStatus && lastStatus.type === 'track' && lastStatus.parent) {
            const parent = lastStatus.parent;
            if (parent.type === 'album') {
              itemType = 'album';
              dummyItem = {
                name: parent.title || 'Unknown Album',
                artist: parent.artist || 'Unknown Artist',
                type: 'album', url: parent.url || '',
                total_tracks: parent.total_tracks || lastStatus.total_tracks,
                parent: parent };
            } else if (parent.type === 'playlist') {
              itemType = 'playlist';
              dummyItem = {
                name: parent.name || 'Unknown Playlist',
                owner: parent.owner || 'Unknown Creator',
                type: 'playlist', url: parent.url || '',
                total_tracks: parent.total_tracks || lastStatus.total_tracks,
                parent: parent };
            }
          }
          const requestUrl = originalRequest.url ? `/api/${itemType}/download/${originalRequest.url.split('/').pop()}?name=${encodeURIComponent(dummyItem.name || '')}&artist=${encodeURIComponent(dummyItem.artist || '')}` : null;
          // Add with startMonitoring = true
          const queueId = this.addDownload(dummyItem, itemType, taskId, requestUrl, true);
          const newEntry = this.queueEntries[queueId];
          if (newEntry && lastStatus) {
            // Manually set lastStatus and update UI as addDownload might not have full server info yet
            newEntry.lastStatus = lastStatus;
            if(lastStatus.parent) newEntry.parentInfo = lastStatus.parent;
            this.applyStatusClasses(newEntry, lastStatus);
            const logEl = newEntry.element.querySelector('.log') as HTMLElement | null;
            if(logEl) logEl.textContent = this.getStatusMessage(lastStatus);
            // Ensure polling is active for this newly added item
            this.setupPollingInterval(newEntry.uniqueId);
          }
        } else {
          // Task exists locally, check if status needs update from server list
          const localEntry = Object.values(this.queueEntries).find(e => e.prgFile === taskId);
          if (localEntry && lastStatus && JSON.stringify(localEntry.lastStatus) !== JSON.stringify(lastStatus)) {
            if (!localEntry.hasEnded) {
              console.log(`Periodic sync: Updating status for existing task ${taskId} from ${localEntry.lastStatus?.status} to ${lastStatus.status}`);
              // Create a data object that handleStatusUpdate expects
              const updateData: StatusData = { ...serverTask, last_line: lastStatus };
              this.handleStatusUpdate(localEntry.uniqueId, updateData);
            }
          }
        }
      }

      // 2. Remove local tasks that are no longer on the server or are now terminal on server
      for (const localEntry of Object.values(this.queueEntries)) {
        if (!serverTaskPrgFiles.has(localEntry.prgFile)) {
          if (!localEntry.hasEnded) {
             console.log(`Periodic sync: Local task ${localEntry.prgFile} not found on server. Assuming completed/cleaned. Removing.`);
             this.cleanupEntry(localEntry.uniqueId);
          }
        } else {
          const serverEquivalent = serverTasks.find(st => st.task_id === localEntry.prgFile);
          if (serverEquivalent && serverEquivalent.last_status_obj && terminalStates.includes(serverEquivalent.last_status_obj.status)) {
            if (!localEntry.hasEnded) {
              console.log(`Periodic sync: Local task ${localEntry.prgFile} is now terminal on server (${serverEquivalent.last_status_obj.status}). Cleaning up.`);
              this.handleDownloadCompletion(localEntry, localEntry.uniqueId, serverEquivalent.last_status_obj);
            }
          }
        }
      }

      this.updateQueueOrder();

    } catch (error) {
      console.error("Error during periodic sync with server:", error);
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueue();