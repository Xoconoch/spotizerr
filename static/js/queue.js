// --- MODIFIED: Custom URLSearchParams class that does not encode anything ---
class CustomURLSearchParams {
  constructor() {
    this.params = {};
  }
  append(key, value) {
    this.params[key] = value;
  }
  toString() {
    return Object.entries(this.params)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
  }
}
// --- END MODIFIED ---

class DownloadQueue {
  constructor() {
    this.downloadQueue = {}; // keyed by unique queueId
    this.currentConfig = {}; // Cache for current config
    this._updateQueueDebounceTimeout = null; // Debounce variable for queue updates

    // Load the saved visible count (or default to 10)
    const storedVisibleCount = localStorage.getItem("downloadQueueVisibleCount");
    this.visibleCount = storedVisibleCount ? parseInt(storedVisibleCount, 10) : 10;
    
    // Load the cached status info (object keyed by prgFile)
    this.queueCache = JSON.parse(localStorage.getItem("downloadQueueCache") || "{}");
    
    // Wait for initDOM to complete before setting up event listeners and loading existing PRG files.
    this.initDOM().then(() => {
      this.initEventListeners();
      this.loadExistingPrgFiles();
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
            <button id="cancelAllBtn" aria-label="Cancel all downloads">Cancel all</button>
            <button class="close-btn" aria-label="Close queue">&times;</button>
          </div>
        </div>
        <div id="queueItems" aria-live="off"></div>
        <div id="queueFooter"></div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', queueHTML);

    // Load initial config from the server.
    await this.loadConfig();

    // Override the server value with locally persisted queue visibility (if present).
    const storedVisible = localStorage.getItem("downloadQueueVisible");
    if (storedVisible !== null) {
      this.currentConfig.downloadQueueVisible = storedVisible === "true";
    }

    const queueSidebar = document.getElementById('downloadQueue');
    queueSidebar.hidden = !this.currentConfig.downloadQueueVisible;
    queueSidebar.classList.toggle('active', this.currentConfig.downloadQueueVisible);
  }

  /* Event Handling */
  initEventListeners() {
    // Toggle queue visibility via Escape key.
    document.addEventListener('keydown', async (e) => {
      const queueSidebar = document.getElementById('downloadQueue');
      if (e.key === 'Escape' && queueSidebar.classList.contains('active')) {
        await this.toggleVisibility();
      }
    });

    // Close queue when the close button is clicked.
    const queueSidebar = document.getElementById('downloadQueue');
    if (queueSidebar) {
      queueSidebar.addEventListener('click', async (e) => {
        if (e.target.closest('.close-btn')) {
          await this.toggleVisibility();
        }
      });
    }

    // "Cancel all" button.
    const cancelAllBtn = document.getElementById('cancelAllBtn');
    if (cancelAllBtn) {
      cancelAllBtn.addEventListener('click', () => {
        for (const queueId in this.downloadQueue) {
          const entry = this.downloadQueue[queueId];
          if (!entry.hasEnded) {
            fetch(`/api/${entry.type}/download/cancel?prg_file=${entry.prgFile}`)
              .then(response => response.json())
              .then(data => {
                const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
                if (logElement) logElement.textContent = "Download cancelled";
                entry.hasEnded = true;
                if (entry.intervalId) {
                  clearInterval(entry.intervalId);
                  entry.intervalId = null;
                }
                // Cleanup the entry after a short delay.
                setTimeout(() => this.cleanupEntry(queueId), 5000);
              })
              .catch(error => console.error('Cancel error:', error));
          }
        }
      });
    }
  }

  /* Public API */
  async toggleVisibility() {
    const queueSidebar = document.getElementById('downloadQueue');
    const isVisible = !queueSidebar.classList.contains('active');
    
    queueSidebar.classList.toggle('active', isVisible);
    queueSidebar.hidden = !isVisible;

    // Persist the state locally so it survives refreshes.
    localStorage.setItem("downloadQueueVisible", isVisible);

    try {
      await this.loadConfig();
      const updatedConfig = { ...this.currentConfig, downloadQueueVisible: isVisible };
      await this.saveConfig(updatedConfig);
      this.dispatchEvent('queueVisibilityChanged', { visible: isVisible });
    } catch (error) {
      console.error('Failed to save queue visibility:', error);
      // Revert UI if save failed.
      queueSidebar.classList.toggle('active', !isVisible);
      queueSidebar.hidden = isVisible;
      this.dispatchEvent('queueVisibilityChanged', { visible: !isVisible });
      this.showError('Failed to save queue visibility');
    }
  }

  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'queue-error';
    errorDiv.textContent = message;
    document.getElementById('queueItems').prepend(errorDiv);
    setTimeout(() => errorDiv.remove(), 3000);
  }

  /**
   * Adds a new download entry.
   */
  addDownload(item, type, prgFile, requestUrl = null) {
    const queueId = this.generateQueueId();
    const entry = this.createQueueEntry(item, type, prgFile, queueId, requestUrl);
    this.downloadQueue[queueId] = entry;
    // Re-render and update which entries are processed.
    this.updateQueueOrder();
    this.dispatchEvent('downloadAdded', { queueId, item, type });
  }

  /* Start processing the entry only if it is visible. */
  async startEntryMonitoring(queueId) {
    const entry = this.downloadQueue[queueId];
    if (!entry || entry.hasEnded) return;
    if (entry.intervalId) return;

    entry.intervalId = setInterval(async () => {
      if (!this.isEntryVisible(queueId)) {
        clearInterval(entry.intervalId);
        entry.intervalId = null;
        return;
      }
      const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
      if (entry.hasEnded) {
        clearInterval(entry.intervalId);
        return;
      }
      // Don't try to update DOM elements if they're not in the document
      if (!logElement || !document.body.contains(logElement)) {
        return;
      }
      try {
        const response = await fetch(`/api/prgs/${entry.prgFile}`);
        const data = await response.json();

        if (data.type) {
          entry.type = data.type;
        }

        if (!entry.requestUrl && data.original_request) {
          const params = new CustomURLSearchParams();
          for (const key in data.original_request) {
            params.append(key, data.original_request[key]);
          }
          entry.requestUrl = `/api/${entry.type}/download?${params.toString()}`;
        }

        const progress = data.last_line;

        if (progress && typeof progress.status === 'undefined') {
          if (entry.type === 'playlist') {
            logElement.textContent = "Reading tracks list...";
          }
          this.updateQueueOrder();
          return;
        }
        if (!progress) {
          if (entry.type === 'playlist') {
            logElement.textContent = "Reading tracks list...";
          } else {
            this.handleInactivity(entry, queueId, logElement);
          }
          this.updateQueueOrder();
          return;
        }
        if (JSON.stringify(entry.lastStatus) === JSON.stringify(progress)) {
          this.handleInactivity(entry, queueId, logElement);
          this.updateQueueOrder();
          return;
        }

        // Update the entry and cache.
        entry.lastStatus = progress;
        entry.lastUpdated = Date.now();
        entry.status = progress.status;
        logElement.textContent = this.getStatusMessage(progress);

        // Save updated status to cache.
        this.queueCache[entry.prgFile] = progress;
        localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));

        if (['error', 'complete', 'cancel'].includes(progress.status)) {
          this.handleTerminalState(entry, queueId, progress);
        }
      } catch (error) {
        console.error('Status check failed:', error);
        this.handleTerminalState(entry, queueId, { 
          status: 'error', 
          message: 'Status check error' 
        });
      }
      this.updateQueueOrder();
    }, 2000);
  }

  /* Helper Methods */
  generateQueueId() {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Creates a new queue entry. It checks localStorage for any cached info.
   */
  createQueueEntry(item, type, prgFile, queueId, requestUrl) {
    // Build the basic entry.
    const entry = {
      item,
      type,
      prgFile,
      requestUrl, // for potential retry
      element: this.createQueueItem(item, type, prgFile, queueId),
      lastStatus: null,
      lastUpdated: Date.now(),
      hasEnded: false,
      intervalId: null,
      uniqueId: queueId,
      retryCount: 0,
      autoRetryInterval: null
    };
    // If cached info exists for this PRG file, use it.
    if (this.queueCache[prgFile]) {
      entry.lastStatus = this.queueCache[prgFile];
      const logEl = entry.element.querySelector('.log');
      logEl.textContent = this.getStatusMessage(this.queueCache[prgFile]);
    }
    return entry;
  }

  /**
   * Returns an HTML element for the queue entry.
   */
  createQueueItem(item, type, prgFile, queueId) {
    const defaultMessage = (type === 'playlist') ? 'Reading track list' : 'Initializing download...';
    const div = document.createElement('article');
    div.className = 'queue-item';
    div.setAttribute('aria-live', 'off');
    div.setAttribute('aria-atomic', 'true');
    div.innerHTML = `
      <div class="title">${item.name}</div>
      <div class="type">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
      <div class="log" id="log-${queueId}-${prgFile}">${defaultMessage}</div>
      <button class="cancel-btn" data-prg="${prgFile}" data-type="${type}" data-queueid="${queueId}" title="Cancel Download">
        <img src="https://www.svgrepo.com/show/488384/skull-head.svg" alt="Cancel Download">
      </button>
    `;
    div.querySelector('.cancel-btn').addEventListener('click', (e) => this.handleCancelDownload(e));
    return div;
  }

  async handleCancelDownload(e) {
    const btn = e.target.closest('button');
    btn.style.display = 'none';
    const { prg, type, queueid } = btn.dataset;
    try {
      const response = await fetch(`/api/${type}/download/cancel?prg_file=${prg}`);
      const data = await response.json();
      if (data.status === "cancel") {
        const logElement = document.getElementById(`log-${queueid}-${prg}`);
        logElement.textContent = "Download cancelled";
        const entry = this.downloadQueue[queueid];
        if (entry) {
          entry.hasEnded = true;
          clearInterval(entry.intervalId);
          entry.intervalId = null;
        }
        setTimeout(() => this.cleanupEntry(queueid), 5000);
      }
    } catch (error) {
      console.error('Cancel error:', error);
    }
  }

  /* Reorders the queue display, updates the total count, and handles "Show more" */
  updateQueueOrder() {
    // Prevent rapid, sequential refreshes by using a debounce mechanism
    if (this._updateQueueDebounceTimeout) {
      clearTimeout(this._updateQueueDebounceTimeout);
    }

    this._updateQueueDebounceTimeout = setTimeout(() => {
      this._performQueueUpdate();
    }, 150); // 150ms debounce time to group rapid update requests
  }

  _performQueueUpdate() {
    const container = document.getElementById('queueItems');
    const footer = document.getElementById('queueFooter');
    const entries = Object.values(this.downloadQueue);

    // Sorting: errors/canceled first (group 0), ongoing next (group 1), queued last (group 2, sorted by position).
    entries.sort((a, b) => {
      const getGroup = (entry) => {
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

    document.getElementById('queueTotalCount').textContent = entries.length;
    const visibleEntries = entries.slice(0, this.visibleCount);
    
    // Check if we need to rebuild the entire list or just update existing elements
    // This avoids completely destroying and rebuilding the DOM on every update
    let needsRebuild = false;
    
    // Only rebuild if the visible entries don't match the current DOM elements
    if (container.children.length !== visibleEntries.length) {
      needsRebuild = true;
    } else {
      // Check if the current DOM order matches our expected order
      for (let i = 0; i < visibleEntries.length; i++) {
        const currentElement = container.children[i];
        const queueId = currentElement.querySelector('.cancel-btn')?.dataset.queueid;
        
        if (!queueId || queueId !== visibleEntries[i].uniqueId) {
          needsRebuild = true;
          break;
        }
      }
    }
    
    // Only rebuild the DOM when necessary
    if (needsRebuild) {
      container.innerHTML = '';
      visibleEntries.forEach(entry => {
        container.appendChild(entry.element);
        if (!entry.intervalId) {
          this.startEntryMonitoring(entry.uniqueId);
        }
      });
    }
    
    entries.slice(this.visibleCount).forEach(entry => {
      if (entry.intervalId) {
        clearInterval(entry.intervalId);
        entry.intervalId = null;
      }
    });

    footer.innerHTML = '';
    if (entries.length > this.visibleCount) {
      const remaining = entries.length - this.visibleCount;
      const showMoreBtn = document.createElement('button');
      showMoreBtn.textContent = `Show ${remaining} more`;
      showMoreBtn.addEventListener('click', () => {
        this.visibleCount += 10;
        localStorage.setItem("downloadQueueVisibleCount", this.visibleCount);
        this.updateQueueOrder();
      });
      footer.appendChild(showMoreBtn);
    }
  }

  /* Checks if an entry is visible in the queue display. */
  isEntryVisible(queueId) {
    const entries = Object.values(this.downloadQueue);
    entries.sort((a, b) => {
      const getGroup = (entry) => {
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
    const index = entries.findIndex(e => e.uniqueId === queueId);
    return index >= 0 && index < this.visibleCount;
  }

  cleanupEntry(queueId) {
    const entry = this.downloadQueue[queueId];
    if (entry) {
      if (entry.intervalId) {
        clearInterval(entry.intervalId);
      }
      if (entry.autoRetryInterval) {
        clearInterval(entry.autoRetryInterval);
      }
      entry.element.remove();
      delete this.downloadQueue[queueId];
      // Remove the cached info.
      if (this.queueCache[entry.prgFile]) {
        delete this.queueCache[entry.prgFile];
        localStorage.setItem("downloadQueueCache", JSON.stringify(this.queueCache));
      }
      fetch(`/api/prgs/delete/${entry.prgFile}`, { method: 'DELETE' })
        .catch(console.error);
      this.updateQueueOrder();
    }
  }

  /* Event Dispatching */
  dispatchEvent(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  }

  /* Status Message Handling */
  getStatusMessage(data) {
    function formatList(items) {
      if (!items || items.length === 0) return '';
      if (items.length === 1) return items[0];
      if (items.length === 2) return `${items[0]} and ${items[1]}`;
      return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
    }
    function pluralize(word) {
      return word.endsWith('s') ? word : word + 's';
    }
    switch (data.status) {
      case 'queued':
        if (data.type === 'album' || data.type === 'playlist') {
          return `Queued ${data.type} "${data.name}"${data.position ? ` (position ${data.position})` : ''}`;
        } else if (data.type === 'track') {
          return `Queued track "${data.name}"${data.artist ? ` by ${data.artist}` : ''}`;
        }
        return `Queued ${data.type} "${data.name}"`;
      case 'cancel':
        return 'Download cancelled';
      case 'downloading':
        if (data.type === 'track') {
          return `Downloading track "${data.song}" by ${data.artist}...`;
        }
        return `Downloading ${data.type}...`;
      case 'initializing':
        if (data.type === 'playlist') {
          return `Initializing playlist download "${data.name}" with ${data.total_tracks} tracks...`;
        } else if (data.type === 'album') {
          return `Initializing album download "${data.album}" by ${data.artist}...`;
        } else if (data.type === 'artist') {
          let subsets = [];
          if (data.subsets && Array.isArray(data.subsets) && data.subsets.length > 0) {
            subsets = data.subsets;
          } else if (data.album_type) {
            subsets = data.album_type
              .split(',')
              .map(item => item.trim())
              .map(item => pluralize(item));
          }
          if (subsets.length > 0) {
            const subsetsMessage = formatList(subsets);
            return `Initializing download for ${data.artist}'s ${subsetsMessage}`;
          }
          return `Initializing download for ${data.artist} with ${data.total_albums} album(s) [${data.album_type}]...`;
        }
        return `Initializing ${data.type} download...`;
      case 'progress':
        if (data.track && data.current_track) {
          const parts = data.current_track.split('/');
          const current = parts[0];
          const total = parts[1] || '?';
          if (data.type === 'playlist') {
            return `Downloading playlist: Track ${current} of ${total} - ${data.track}`;
          } else if (data.type === 'album') {
            if (data.album && data.artist) {
              return `Downloading album "${data.album}" by ${data.artist}: track ${current} of ${total} - ${data.track}`;
            } else {
              return `Downloading track ${current} of ${total}: ${data.track} from ${data.album}`;
            }
          }
        }
        return `Progress: ${data.status}...`;
      case 'done':
        if (data.type === 'track') {
          return `Finished track "${data.song}" by ${data.artist}`;
        } else if (data.type === 'playlist') {
          return `Finished playlist "${data.name}" with ${data.total_tracks} tracks`;
        } else if (data.type === 'album') {
          return `Finished album "${data.album}" by ${data.artist}`;
        } else if (data.type === 'artist') {
          return `Finished artist "${data.artist}" (${data.album_type})`;
        }
        return `Finished ${data.type}`;
      case 'retrying':
        return `Track "${data.song}" by ${data.artist}" failed, retrying (${data.retry_count}/5) in ${data.seconds_left}s`;
      case 'error':
        return `Error: ${data.message || 'Unknown error'}`;
      case 'complete':
        return 'Download completed successfully';
      case 'skipped':
        return `Track "${data.song}" skipped, it already exists!`;
      case 'real_time': {
        const totalMs = data.time_elapsed;
        const minutes = Math.floor(totalMs / 60000);
        const seconds = Math.floor((totalMs % 60000) / 1000);
        const paddedSeconds = seconds < 10 ? '0' + seconds : seconds;
        return `Real-time downloading track "${data.song}" by ${data.artist} (${(data.percentage * 100).toFixed(1)}%). Time elapsed: ${minutes}:${paddedSeconds}`;
      }
      default:
        return data.status;
    }
  }

  /* New Methods to Handle Terminal State, Inactivity and Auto-Retry */
  handleTerminalState(entry, queueId, progress) {
    entry.hasEnded = true;
    clearInterval(entry.intervalId);
    const logElement = document.getElementById(`log-${entry.uniqueId}-${entry.prgFile}`);
    if (!logElement) return;
    if (progress.status === 'error') {
      const cancelBtn = entry.element.querySelector('.cancel-btn');
      if (cancelBtn) {
        cancelBtn.style.display = 'none';
      }
      logElement.innerHTML = `
        <div class="error-message">${this.getStatusMessage(progress)}</div>
        <div class="error-buttons">
          <button class="close-error-btn" title="Close">&times;</button>
          <button class="retry-btn" title="Retry">Retry</button>
        </div>
      `;
      logElement.querySelector('.close-error-btn').addEventListener('click', () => {
        if (entry.autoRetryInterval) {
          clearInterval(entry.autoRetryInterval);
          entry.autoRetryInterval = null;
        }
        this.cleanupEntry(queueId);
      });
      logElement.querySelector('.retry-btn').addEventListener('click', async () => {
        if (entry.autoRetryInterval) {
          clearInterval(entry.autoRetryInterval);
          entry.autoRetryInterval = null;
        }
        this.retryDownload(queueId, logElement);
      });
      if (entry.requestUrl) {
        const maxRetries = 10;
        if (entry.retryCount < maxRetries) {
          const autoRetryDelay = 300; // seconds
          let secondsLeft = autoRetryDelay;
          entry.autoRetryInterval = setInterval(() => {
            secondsLeft--;
            const errorMsgEl = logElement.querySelector('.error-message');
            if (errorMsgEl) {
              errorMsgEl.textContent = `Error: ${progress.message || 'Unknown error'}. Retrying in ${secondsLeft} seconds... (attempt ${entry.retryCount + 1}/${maxRetries})`;
            }
            if (secondsLeft <= 0) {
              clearInterval(entry.autoRetryInterval);
              entry.autoRetryInterval = null;
              this.retryDownload(queueId, logElement);
            }
          }, 1000);
        }
      }
      return;
    } else {
      logElement.textContent = this.getStatusMessage(progress);
      setTimeout(() => this.cleanupEntry(queueId), 5000);
    }
  }

  handleInactivity(entry, queueId, logElement) {
    if (entry.lastStatus && entry.lastStatus.status === 'queued') {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus);
      }
      return;
    }
    const now = Date.now();
    if (now - entry.lastUpdated > 300000) {
      const progress = { status: 'error', message: 'Inactivity timeout' };
      this.handleTerminalState(entry, queueId, progress);
    } else {
      if (logElement) {
        logElement.textContent = this.getStatusMessage(entry.lastStatus);
      }
    }
  }

  async retryDownload(queueId, logElement) {
    const entry = this.downloadQueue[queueId];
    if (!entry) return;
    logElement.textContent = 'Retrying download...';
    if (!entry.requestUrl) {
      logElement.textContent = 'Retry not available: missing original request information.';
      return;
    }
    try {
      const retryResponse = await fetch(entry.requestUrl);
      const retryData = await retryResponse.json();
      if (retryData.prg_file) {
        const oldPrgFile = entry.prgFile;
        await fetch(`/api/prgs/delete/${oldPrgFile}`, { method: 'DELETE' });
        const logEl = entry.element.querySelector('.log');
        logEl.id = `log-${entry.uniqueId}-${retryData.prg_file}`;
        entry.prgFile = retryData.prg_file;
        entry.lastStatus = null;
        entry.hasEnded = false;
        entry.lastUpdated = Date.now();
        entry.retryCount = (entry.retryCount || 0) + 1;
        logEl.textContent = 'Retry initiated...';
        this.startEntryMonitoring(queueId);
      } else {
        logElement.textContent = 'Retry failed: invalid response from server';
      }
    } catch (error) {
      logElement.textContent = 'Retry failed: ' + error.message;
    }
  }

  /**
   * Builds common URL parameters for download API requests.
   */
  _buildCommonParams(url, service, config) {
    const params = new CustomURLSearchParams();
    params.append('service', service);
    params.append('url', url);
  
    if (service === 'spotify') {
      if (config.fallback) {
        params.append('main', config.deezer);
        params.append('fallback', config.spotify);
        params.append('quality', config.deezerQuality);
        params.append('fall_quality', config.spotifyQuality);
      } else {
        params.append('main', config.spotify);
        params.append('quality', config.spotifyQuality);
      }
    } else {
      params.append('main', config.deezer);
      params.append('quality', config.deezerQuality);
    }
  
    if (config.realTime) {
      params.append('real_time', 'true');
    }
  
    if (config.customTrackFormat) {
      params.append('custom_track_format', config.customTrackFormat);
    }
  
    if (config.customDirFormat) {
      params.append('custom_dir_format', config.customDirFormat);
    }
  
    return params;
  }

  async startTrackDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/track/download?${params.toString()}`;
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Network error');
      const data = await response.json();
      this.addDownload(item, 'track', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  async startPlaylistDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/playlist/download?${params.toString()}`;
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      this.addDownload(item, 'playlist', data.prg_file, apiUrl);
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }

  async startArtistDownload(url, item, albumType = 'album,single,compilation,appears_on') {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    params.append('album_type', albumType);
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/artist/download?${params.toString()}`;
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) throw new Error('Network error');
      const data = await response.json();
      if (data.album_prg_files && Array.isArray(data.album_prg_files)) {
        data.album_prg_files.forEach(prgFile => {
          this.addDownload(item, 'album', prgFile, apiUrl);
        });
      } else if (data.prg_file) {
        this.addDownload(item, 'album', data.prg_file, apiUrl);
      }
    } catch (error) {
      this.dispatchEvent('downloadError', { error, item });
      throw error;
    }
  }
  
  async startAlbumDownload(url, item) {
    await this.loadConfig();
    const service = url.includes('open.spotify.com') ? 'spotify' : 'deezer';
    const params = this._buildCommonParams(url, service, this.currentConfig);
    params.append('name', item.name || '');
    params.append('artist', item.artist || '');
    const apiUrl = `/api/album/download?${params.toString()}`;
    try {
      const response = await fetch(apiUrl);
      const data = await response.json();
      this.addDownload(item, 'album', data.prg_file, apiUrl);
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
      const response = await fetch('/api/prgs/list');
      const prgFiles = await response.json();
      
      // Sort filenames by the numeric portion (assumes format "type_number.prg").
      prgFiles.sort((a, b) => {
        const numA = parseInt(a.split('_')[1]);
        const numB = parseInt(b.split('_')[1]);
        return numA - numB;
      });

      // Iterate through each PRG file and add it as a dummy queue entry.
      for (const prgFile of prgFiles) {
        try {
          const prgResponse = await fetch(`/api/prgs/${prgFile}`);
          if (!prgResponse.ok) continue;
          const prgData = await prgResponse.json();
          const dummyItem = {
            name: prgData.original_request && prgData.original_request.name ? prgData.original_request.name : prgFile,
            artist: prgData.original_request && prgData.original_request.artist ? prgData.original_request.artist : '',
            type: prgData.original_request && prgData.original_request.type ? prgData.original_request.type : 'unknown'
          };
          this.addDownload(dummyItem, dummyItem.type, prgFile);
        } catch (error) {
          console.error("Error fetching details for", prgFile, error);
        }
      }
    } catch (error) {
      console.error("Error loading existing PRG files:", error);
    }
  }

  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (!response.ok) throw new Error('Failed to fetch config');
      this.currentConfig = await response.json();
    } catch (error) {
      console.error('Error loading config:', error);
      this.currentConfig = {};
    }
  }

  async saveConfig(updatedConfig) {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig)
      });
      if (!response.ok) throw new Error('Failed to save config');
      this.currentConfig = await response.json();
    } catch (error) {
      console.error('Error saving config:', error);
      throw error;
    }
  }
}

// Singleton instance
export const downloadQueue = new DownloadQueue();
