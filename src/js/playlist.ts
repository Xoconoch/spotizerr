// Import the downloadQueue singleton from your working queue.js implementation.
import { downloadQueue } from './queue.js';

// Define interfaces for API data
interface Image {
  url: string;
  height?: number;
  width?: number;
}

interface Artist {
  id: string;
  name: string;
  external_urls?: { spotify?: string };
}

interface Album {
  id: string;
  name: string;
  images?: Image[];
  external_urls?: { spotify?: string };
}

interface Track {
  id: string;
  name: string;
  artists: Artist[];
  album: Album;
  duration_ms: number;
  explicit: boolean;
  external_urls?: { spotify?: string };
  is_locally_known?: boolean; // Added for local DB status
}

interface PlaylistItem {
  track: Track | null;
  // Add other playlist item properties like added_at, added_by if needed
}

interface Playlist {
  id: string;
  name: string;
  description: string | null;
  owner: {
    display_name?: string;
    id?: string;
  };
  images: Image[];
  tracks: {
    items: PlaylistItem[];
    total: number;
  };
  followers?: {
    total: number;
  };
  external_urls?: { spotify?: string };
}

interface WatchedPlaylistStatus {
  is_watched: boolean;
  playlist_data?: Playlist; // Optional, present if watched
}

// Added: Interface for global watch config
interface GlobalWatchConfig {
  enabled: boolean;
  [key: string]: any;
}

interface DownloadQueueItem {
    name: string;
    artist?: string; // Can be a simple string for the queue
    album?: { name: string }; // Match QueueItem's album structure
    owner?: string; // For playlists, owner can be a string
    // Add any other properties your item might have, compatible with QueueItem
}

// Added: Helper function to fetch global watch config
async function getGlobalWatchConfig(): Promise<GlobalWatchConfig> {
  try {
    const response = await fetch('/api/config/watch');
    if (!response.ok) {
      console.error('Failed to fetch global watch config, assuming disabled.');
      return { enabled: false }; // Default to disabled on error
    }
    return await response.json() as GlobalWatchConfig;
  } catch (error) {
    console.error('Error fetching global watch config:', error);
    return { enabled: false }; // Default to disabled on error
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Parse playlist ID from URL
  const pathSegments = window.location.pathname.split('/');
  const playlistId = pathSegments[pathSegments.indexOf('playlist') + 1];

  if (!playlistId) {
    showError('No playlist ID provided.');
    return;
  }

  const globalWatchConfig = await getGlobalWatchConfig(); // Fetch global config
  const isGlobalWatchActuallyEnabled = globalWatchConfig.enabled;

  // Fetch playlist info directly
  fetch(`/api/playlist/info?id=${encodeURIComponent(playlistId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json() as Promise<Playlist>;
    })
    .then(data => renderPlaylist(data, isGlobalWatchActuallyEnabled))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load playlist.');
    });

  // Fetch initial watch status for the specific playlist
  if (isGlobalWatchActuallyEnabled) {
    fetchWatchStatus(playlistId); // This function then calls updateWatchButtons
  } else {
    // If global watch is disabled, ensure watch-related buttons are hidden/disabled
    const watchBtn = document.getElementById('watchPlaylistBtn') as HTMLButtonElement;
    const syncBtn = document.getElementById('syncPlaylistBtn') as HTMLButtonElement;
    if (watchBtn) {
      watchBtn.classList.add('hidden');
      watchBtn.disabled = true;
      // Remove any existing event listener to prevent actions
      watchBtn.onclick = null;
    }
    if (syncBtn) {
      syncBtn.classList.add('hidden');
      syncBtn.disabled = true;
      syncBtn.onclick = null;
    }
  }

  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }

  // Attempt to set initial watchlist button visibility from cache
  const watchlistButton = document.getElementById('watchlistButton') as HTMLAnchorElement | null;
  if (watchlistButton) {
      const cachedWatchEnabled = localStorage.getItem('spotizerr_watch_enabled_cached');
      if (cachedWatchEnabled === 'true') {
          watchlistButton.classList.remove('hidden');
      }
  }

  // Fetch watch config to determine if watchlist button should be visible
  async function updateWatchlistButtonVisibility() {
    if (watchlistButton) {
        try {
            const response = await fetch('/api/config/watch');
            if (response.ok) {
                const watchConfig = await response.json();
                localStorage.setItem('spotizerr_watch_enabled_cached', watchConfig.enabled ? 'true' : 'false');
                if (watchConfig && watchConfig.enabled === false) {
                    watchlistButton.classList.add('hidden');
                } else {
                    watchlistButton.classList.remove('hidden'); // Ensure it's shown if enabled
                }
            } else {
                console.error('Failed to fetch watch config for playlist page, defaulting to hidden');
                // Don't update cache on error
                watchlistButton.classList.add('hidden'); // Hide if config fetch fails
            }
        } catch (error) {
            console.error('Error fetching watch config for playlist page:', error);
            // Don't update cache on error
            watchlistButton.classList.add('hidden'); // Hide on error
        }
    }
  }
  updateWatchlistButtonVisibility();
});

/**
 * Renders playlist header and tracks.
 */
function renderPlaylist(playlist: Playlist, isGlobalWatchEnabled: boolean) {
  // Hide loading and error messages
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.classList.add('hidden');
  const errorEl = document.getElementById('error');
  if (errorEl) errorEl.classList.add('hidden');

  // Check if explicit filter is enabled
  const isExplicitFilterEnabled = downloadQueue.isExplicitFilterEnabled();

  // Update header info
  const playlistNameEl = document.getElementById('playlist-name');
  if (playlistNameEl) playlistNameEl.textContent = playlist.name || 'Unknown Playlist';
  const playlistOwnerEl = document.getElementById('playlist-owner');
  if (playlistOwnerEl) playlistOwnerEl.textContent = `By ${playlist.owner?.display_name || 'Unknown User'}`;
  const playlistStatsEl = document.getElementById('playlist-stats');
  if (playlistStatsEl) playlistStatsEl.textContent =
    `${playlist.followers?.total || '0'} followers • ${playlist.tracks?.total || '0'} songs`;
  const playlistDescriptionEl = document.getElementById('playlist-description');
  if (playlistDescriptionEl) playlistDescriptionEl.textContent = playlist.description || '';
  const image = playlist.images?.[0]?.url || '/static/images/placeholder.jpg';
  const playlistImageEl = document.getElementById('playlist-image') as HTMLImageElement;
  if (playlistImageEl) playlistImageEl.src = image;

  // --- Add Home Button ---
  let homeButton = document.getElementById('homeButton') as HTMLButtonElement;
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    // Use an <img> tag to display the SVG icon.
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home">`;
    // Insert the home button at the beginning of the header container.
    const headerContainer = document.getElementById('playlist-header');
    if (headerContainer) {
      headerContainer.insertBefore(homeButton, headerContainer.firstChild);
    }
  }
  homeButton.addEventListener('click', () => {
    // Navigate to the site's base URL.
    window.location.href = window.location.origin;
  });

  // Check if any track in the playlist is explicit when filter is enabled
  let hasExplicitTrack = false;
  if (isExplicitFilterEnabled && playlist.tracks?.items) {
    hasExplicitTrack = playlist.tracks.items.some((item: PlaylistItem) => item?.track && item.track.explicit);
  }

  // --- Add "Download Whole Playlist" Button ---
  let downloadPlaylistBtn = document.getElementById('downloadPlaylistBtn') as HTMLButtonElement;
  if (!downloadPlaylistBtn) {
    downloadPlaylistBtn = document.createElement('button');
    downloadPlaylistBtn.id = 'downloadPlaylistBtn';
    downloadPlaylistBtn.textContent = 'Download Whole Playlist';
    downloadPlaylistBtn.className = 'download-btn download-btn--main';
    // Insert the button into the header container.
    const headerContainer = document.getElementById('playlist-header');
    if (headerContainer) {
      headerContainer.appendChild(downloadPlaylistBtn);
    }
  }

  // --- Add "Download Playlist's Albums" Button ---
  let downloadAlbumsBtn = document.getElementById('downloadAlbumsBtn') as HTMLButtonElement;
  if (!downloadAlbumsBtn) {
    downloadAlbumsBtn = document.createElement('button');
    downloadAlbumsBtn.id = 'downloadAlbumsBtn';
    downloadAlbumsBtn.textContent = "Download Playlist's Albums";
    downloadAlbumsBtn.className = 'download-btn download-btn--main';
    // Insert the new button into the header container.
    const headerContainer = document.getElementById('playlist-header');
    if (headerContainer) {
      headerContainer.appendChild(downloadAlbumsBtn);
    }
  }

  if (isExplicitFilterEnabled && hasExplicitTrack) {
    // Disable both playlist buttons and display messages explaining why
    if (downloadPlaylistBtn) {
      downloadPlaylistBtn.disabled = true;
      downloadPlaylistBtn.classList.add('download-btn--disabled');
      downloadPlaylistBtn.innerHTML = `<span title="Cannot download entire playlist because it contains explicit tracks">Playlist Contains Explicit Tracks</span>`;
    }

    if (downloadAlbumsBtn) {
      downloadAlbumsBtn.disabled = true;
      downloadAlbumsBtn.classList.add('download-btn--disabled');
      downloadAlbumsBtn.innerHTML = `<span title="Cannot download albums from this playlist because it contains explicit tracks">Albums Access Restricted</span>`;
    }
  } else {
    // Normal behavior when no explicit tracks are present
    if (downloadPlaylistBtn) {
      downloadPlaylistBtn.addEventListener('click', () => {
        // Remove individual track download buttons (but leave the whole playlist button).
        document.querySelectorAll('.download-btn').forEach(btn => {
          if (btn.id !== 'downloadPlaylistBtn') {
            btn.remove();
          }
        });

        // Disable the whole playlist button to prevent repeated clicks.
        downloadPlaylistBtn.disabled = true;
        downloadPlaylistBtn.textContent = 'Queueing...';

        // Initiate the playlist download.
        downloadWholePlaylist(playlist).then(() => {
          downloadPlaylistBtn.textContent = 'Queued!';
        }).catch((err: any) => {
          showError('Failed to queue playlist download: ' + (err?.message || 'Unknown error'));
          if (downloadPlaylistBtn) downloadPlaylistBtn.disabled = false; // Re-enable on error
        });
      });
    }

    if (downloadAlbumsBtn) {
      downloadAlbumsBtn.addEventListener('click', () => {
        // Remove individual track download buttons (but leave this album button).
        document.querySelectorAll('.download-btn').forEach(btn => {
          if (btn.id !== 'downloadAlbumsBtn') btn.remove();
        });

        downloadAlbumsBtn.disabled = true;
        downloadAlbumsBtn.textContent = 'Queueing...';

        downloadPlaylistAlbums(playlist)
          .then(() => {
            if (downloadAlbumsBtn) downloadAlbumsBtn.textContent = 'Queued!';
          })
          .catch((err: any) => {
            showError('Failed to queue album downloads: ' + (err?.message || 'Unknown error'));
            if (downloadAlbumsBtn) downloadAlbumsBtn.disabled = false; // Re-enable on error
          });
      });
    }
  }

  // Render tracks list
  const tracksList = document.getElementById('tracks-list');
  if (!tracksList) return;

  tracksList.innerHTML = ''; // Clear any existing content

  // Determine if the playlist is being watched to show/hide management buttons
  const watchPlaylistButton = document.getElementById('watchPlaylistBtn') as HTMLButtonElement;
  // isIndividuallyWatched checks if the button is visible and has the 'watching' class.
  // This implies global watch is enabled if the button is even interactable for individual status.
  const isIndividuallyWatched = watchPlaylistButton &&
                                watchPlaylistButton.classList.contains('watching') &&
                                !watchPlaylistButton.classList.contains('hidden');

  if (playlist.tracks?.items) {
    playlist.tracks.items.forEach((item: PlaylistItem, index: number) => {
      if (!item || !item.track) return; // Skip null/undefined tracks

      const track = item.track;

      // Skip explicit tracks if filter is enabled
      if (isExplicitFilterEnabled && track.explicit) {
        // Add a placeholder for filtered explicit tracks
        const trackElement = document.createElement('div');
        trackElement.className = 'track track-filtered';
        trackElement.innerHTML = `
          <div class="track-number">${index + 1}</div>
          <div class="track-info">
            <div class="track-name explicit-filtered">Explicit Content Filtered</div>
            <div class="track-artist">This track is not shown due to explicit content filter settings</div>
          </div>
          <div class="track-album">Not available</div>
          <div class="track-duration">--:--</div>
        `;
        tracksList.appendChild(trackElement);
        return;
      }

      const trackLink = `/track/${track.id || ''}`;
      const artistLink = `/artist/${track.artists?.[0]?.id || ''}`;
      const albumLink = `/album/${track.album?.id || ''}`;

      const trackElement = document.createElement('div');
      trackElement.className = 'track';
      let trackHTML = `
        <div class="track-number">${index + 1}</div>
        <div class="track-info">
          <div class="track-name">
            <a href="${trackLink}" title="View track details">${track.name || 'Unknown Track'}</a>
          </div>
          <div class="track-artist">
            <a href="${artistLink}" title="View artist details">${track.artists?.[0]?.name || 'Unknown Artist'}</a>
          </div>
        </div>
        <div class="track-album">
          <a href="${albumLink}" title="View album details">${track.album?.name || 'Unknown Album'}</a>
        </div>
        <div class="track-duration">${msToTime(track.duration_ms || 0)}</div>
      `;

      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'track-actions-container';

      if (!(isExplicitFilterEnabled && hasExplicitTrack)) {
        const downloadBtnHTML = `
          <button class="download-btn download-btn--circle track-download-btn"
                  data-id="${track.id || ''}"
                  data-type="track"
                  data-name="${track.name || 'Unknown Track'}"
                  title="Download">
            <img src="/static/images/download.svg" alt="Download">
          </button>
        `;
        actionsContainer.innerHTML += downloadBtnHTML;
      }

      if (isGlobalWatchEnabled && isIndividuallyWatched) { // Check global and individual watch status
        // Initial state is set based on track.is_locally_known
        const isKnown = track.is_locally_known === true; // Ensure boolean check, default to false if undefined
        const initialStatus = isKnown ? "known" : "missing";
        const initialIcon = isKnown ? "/static/images/check.svg" : "/static/images/missing.svg";
        const initialTitle = isKnown ? "Click to mark as missing from DB" : "Click to mark as known in DB";

        const toggleKnownBtnHTML = `
          <button class="action-btn toggle-known-status-btn"
                  data-id="${track.id || ''}"
                  data-playlist-id="${playlist.id || ''}"
                  data-status="${initialStatus}"
                  title="${initialTitle}">
            <img src="${initialIcon}" alt="Mark as Missing/Known">
          </button>
        `;
        actionsContainer.innerHTML += toggleKnownBtnHTML;
      }

      trackElement.innerHTML = trackHTML;
      trackElement.appendChild(actionsContainer);
      tracksList.appendChild(trackElement);
    });
  }

  // Reveal header and tracks container
  const playlistHeaderEl = document.getElementById('playlist-header');
  if (playlistHeaderEl) playlistHeaderEl.classList.remove('hidden');
  const tracksContainerEl = document.getElementById('tracks-container');
  if (tracksContainerEl) tracksContainerEl.classList.remove('hidden');

  // Attach download listeners to newly rendered download buttons
  attachTrackActionListeners(isGlobalWatchEnabled);
}

/**
 * Converts milliseconds to minutes:seconds.
 */
function msToTime(duration: number) {
  if (!duration || isNaN(duration)) return '0:00';

  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

/**
 * Displays an error message in the UI.
 */
function showError(message: string) {
  const errorEl = document.getElementById('error');
  if (errorEl) {
    errorEl.textContent = message || 'An error occurred';
    errorEl.classList.remove('hidden');
  }
}

/**
 * Attaches event listeners to all individual track action buttons (download, mark known, mark missing).
 */
function attachTrackActionListeners(isGlobalWatchEnabled: boolean) {
  document.querySelectorAll('.track-download-btn').forEach((btn) => {
    btn.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget as HTMLButtonElement;
      const itemId = currentTarget.dataset.id || '';
      const type = currentTarget.dataset.type || 'track';
      const name = currentTarget.dataset.name || 'Unknown';
      if (!itemId) {
        showError('Missing item ID for download on playlist page');
        return;
      }
      currentTarget.remove();
      startDownload(itemId, type, { name }, '');
    });
  });

  document.querySelectorAll('.toggle-known-status-btn').forEach((btn) => {
    btn.addEventListener('click', async (e: Event) => {
      e.stopPropagation();
      const button = e.currentTarget as HTMLButtonElement;
      const trackId = button.dataset.id || '';
      const playlistId = button.dataset.playlistId || '';
      const currentStatus = button.dataset.status;
      const img = button.querySelector('img');

      if (!trackId || !playlistId || !img) {
        showError('Missing data for toggling track status');
        return;
      }

      if (!isGlobalWatchEnabled) { // Added check
        showNotification("Watch feature is currently disabled globally. Cannot change track status.");
        return;
      }

      button.disabled = true;
      try {
        if (currentStatus === 'missing') {
          await handleMarkTrackAsKnown(playlistId, trackId);
          button.dataset.status = 'known';
          img.src = '/static/images/check.svg';
          button.title = 'Click to mark as missing from DB';
        } else {
          await handleMarkTrackAsMissing(playlistId, trackId);
          button.dataset.status = 'missing';
          img.src = '/static/images/missing.svg';
          button.title = 'Click to mark as known in DB';
        }
      } catch (error) {
        // Revert UI on error if needed, error is shown by handlers
        showError('Failed to update track status. Please try again.');
      }
      button.disabled = false;
    });
  });
}

async function handleMarkTrackAsKnown(playlistId: string, trackId: string) {
  try {
    const response = await fetch(`/api/playlist/watch/${playlistId}/tracks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([trackId]),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const result = await response.json();
    showNotification(result.message || 'Track marked as known.');
  } catch (error: any) {
    showError(`Failed to mark track as known: ${error.message}`);
    throw error; // Re-throw for the caller to handle button state if needed
  }
}

async function handleMarkTrackAsMissing(playlistId: string, trackId: string) {
  try {
    const response = await fetch(`/api/playlist/watch/${playlistId}/tracks`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([trackId]),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const result = await response.json();
    showNotification(result.message || 'Track marked as missing.');
  } catch (error: any) {
    showError(`Failed to mark track as missing: ${error.message}`);
    throw error; // Re-throw
  }
}

/**
 * Initiates the whole playlist download by calling the playlist endpoint.
 */
async function downloadWholePlaylist(playlist: Playlist) {
  if (!playlist) {
    throw new Error('Invalid playlist data');
  }

  const playlistId = playlist.id || '';
  if (!playlistId) {
    throw new Error('Missing playlist ID');
  }

  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(playlistId, 'playlist', {
        name: playlist.name || 'Unknown Playlist',
        owner: playlist.owner?.display_name // Pass owner as a string
        // total_tracks can also be passed if QueueItem supports it directly
    });
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error: any) {
    showError('Playlist download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

/**
 * Initiates album downloads for each unique album in the playlist,
 * adding a 20ms delay between each album download and updating the button
 * with the progress (queued_albums/total_albums).
 */
async function downloadPlaylistAlbums(playlist: Playlist) {
  if (!playlist?.tracks?.items) {
    showError('No tracks found in this playlist.');
    return;
  }

  // Build a map of unique albums (using album ID as the key).
  const albumMap = new Map<string, Album>();
  playlist.tracks.items.forEach((item: PlaylistItem) => {
    if (!item?.track?.album) return;

    const album = item.track.album;
    if (album && album.id) {
      albumMap.set(album.id, album);
    }
  });

  const uniqueAlbums = Array.from(albumMap.values());
  const totalAlbums = uniqueAlbums.length;
  if (totalAlbums === 0) {
    showError('No albums found in this playlist.');
    return;
  }

  // Get a reference to the "Download Playlist's Albums" button.
  const downloadAlbumsBtn = document.getElementById('downloadAlbumsBtn') as HTMLButtonElement | null;
  if (downloadAlbumsBtn) {
    // Initialize the progress display.
    downloadAlbumsBtn.textContent = `0/${totalAlbums}`;
  }

  try {
    // Process each album sequentially.
    for (let i = 0; i < totalAlbums; i++) {
      const album = uniqueAlbums[i];
      if (!album) continue;

      const albumUrl = album.external_urls?.spotify || '';
      if (!albumUrl) continue;

      // Use the centralized downloadQueue.download method
      await downloadQueue.download(
        album.id, // Pass album ID directly
        'album',
        {
            name: album.name || 'Unknown Album',
            // If artist information is available on album objects from playlist, pass it
            // artist: album.artists?.[0]?.name
        }
      );

      // Update button text with current progress.
      if (downloadAlbumsBtn) {
        downloadAlbumsBtn.textContent = `${i + 1}/${totalAlbums}`;
      }

      // Wait 20 milliseconds before processing the next album.
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    // Once all albums have been queued, update the button text.
    if (downloadAlbumsBtn) {
      downloadAlbumsBtn.textContent = 'Queued!';
    }

    // Make the queue visible after queueing all albums
    downloadQueue.toggleVisibility(true);
  } catch (error: any) {
    // Propagate any errors encountered.
    throw error;
  }
}

/**
 * Starts the download process using the centralized download method from the queue.
 */
async function startDownload(itemId: string, type: string, item: DownloadQueueItem, albumType?: string) {
  if (!itemId || !type) {
    showError('Missing ID or type for download');
    return;
  }

  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(itemId, type, item, albumType);

    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error: any) {
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

/**
 * A helper function to extract a display name from the URL.
 */
function extractName(url: string | null): string {
  return url || 'Unknown';
}

/**
 * Fetches the watch status of the current playlist and updates the UI.
 */
async function fetchWatchStatus(playlistId: string) {
  if (!playlistId) return;
  try {
    const response = await fetch(`/api/playlist/watch/${playlistId}/status`);
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch watch status');
    }
    const data: WatchedPlaylistStatus = await response.json();
    updateWatchButtons(data.is_watched, playlistId);
  } catch (error) {
    console.error('Error fetching watch status:', error);
    // Don't show a blocking error, but maybe a small notification or log
    // For now, assume not watched if status fetch fails, or keep buttons in default state
    updateWatchButtons(false, playlistId);
  }
}

/**
 * Updates the Watch/Unwatch and Sync buttons based on the playlist's watch status.
 */
function updateWatchButtons(isWatched: boolean, playlistId: string) {
  const watchBtn = document.getElementById('watchPlaylistBtn') as HTMLButtonElement;
  const syncBtn = document.getElementById('syncPlaylistBtn') as HTMLButtonElement;

  if (!watchBtn || !syncBtn) return;

  const watchBtnImg = watchBtn.querySelector('img');

  if (isWatched) {
    watchBtn.innerHTML = `<img src="/static/images/eye-crossed.svg" alt="Unwatch"> Unwatch Playlist`;
    watchBtn.classList.add('watching');
    watchBtn.onclick = () => unwatchPlaylist(playlistId);
    syncBtn.classList.remove('hidden');
    syncBtn.onclick = () => syncPlaylist(playlistId);
  } else {
    watchBtn.innerHTML = `<img src="/static/images/eye.svg" alt="Watch"> Watch Playlist`;
    watchBtn.classList.remove('watching');
    watchBtn.onclick = () => watchPlaylist(playlistId);
    syncBtn.classList.add('hidden');
  }
  watchBtn.disabled = false; // Enable after status is known
}

/**
 * Adds the current playlist to the watchlist.
 */
async function watchPlaylist(playlistId: string) {
  const watchBtn = document.getElementById('watchPlaylistBtn') as HTMLButtonElement;
  if (watchBtn) watchBtn.disabled = true;
  // This function should only be callable if global watch is enabled.
  // We can add a check here or rely on the UI not presenting the button.
  // For safety, let's check global config again before proceeding.
  const globalConfig = await getGlobalWatchConfig();
  if (!globalConfig.enabled) {
    showError("Cannot watch playlist, feature is disabled globally.");
    if (watchBtn) {
      watchBtn.disabled = false; // Re-enable if it was somehow clicked
      updateWatchButtons(false, playlistId); // Reset button to non-watching state
    }
    return;
  }

  try {
    const response = await fetch(`/api/playlist/watch/${playlistId}`, { method: 'PUT' });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to watch playlist');
    }
    updateWatchButtons(true, playlistId);
    // Re-fetch and re-render playlist data
    const newPlaylistInfoResponse = await fetch(`/api/playlist/info?id=${encodeURIComponent(playlistId)}`);
    if (!newPlaylistInfoResponse.ok) throw new Error('Failed to re-fetch playlist info after watch.');
    const newPlaylistData = await newPlaylistInfoResponse.json() as Playlist;
    renderPlaylist(newPlaylistData, globalConfig.enabled); // Pass current global enabled state

    showNotification(`Playlist added to watchlist. Tracks are being updated.`);
  } catch (error: any) {
    showError(`Error watching playlist: ${error.message}`);
    if (watchBtn) watchBtn.disabled = false; // Re-enable on error before potential UI revert
  }
}

/**
 * Removes the current playlist from the watchlist.
 */
async function unwatchPlaylist(playlistId: string) {
  const watchBtn = document.getElementById('watchPlaylistBtn') as HTMLButtonElement;
  if (watchBtn) watchBtn.disabled = true;
  // Similarly, check global config
  const globalConfig = await getGlobalWatchConfig();
  if (!globalConfig.enabled) {
    // This case should be rare if UI behaves, but good for robustness
    showError("Cannot unwatch playlist, feature is disabled globally.");
    if (watchBtn) {
      watchBtn.disabled = false;
      // updateWatchButtons(true, playlistId); // Or keep as is if it was 'watching'
    }
    return;
  }

  try {
    const response = await fetch(`/api/playlist/watch/${playlistId}`, { method: 'DELETE' });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to unwatch playlist');
    }
    updateWatchButtons(false, playlistId);
    // Re-fetch and re-render playlist data
    const newPlaylistInfoResponse = await fetch(`/api/playlist/info?id=${encodeURIComponent(playlistId)}`);
    if (!newPlaylistInfoResponse.ok) throw new Error('Failed to re-fetch playlist info after unwatch.');
    const newPlaylistData = await newPlaylistInfoResponse.json() as Playlist;
    renderPlaylist(newPlaylistData, globalConfig.enabled); // Pass current global enabled state

    showNotification('Playlist removed from watchlist. Track statuses updated.');
  } catch (error: any) {
    showError(`Error unwatching playlist: ${error.message}`);
    if (watchBtn) watchBtn.disabled = false; // Re-enable on error before potential UI revert
  }
}

/**
 * Triggers a manual sync for the watched playlist.
 */
async function syncPlaylist(playlistId: string) {
  const syncBtn = document.getElementById('syncPlaylistBtn') as HTMLButtonElement;
  let originalButtonContent = ''; // Define outside
  // Check global config
  const globalConfig = await getGlobalWatchConfig();
  if (!globalConfig.enabled) {
    showError("Cannot sync playlist, feature is disabled globally.");
    return;
  }

  if (syncBtn) {
    syncBtn.disabled = true;
    originalButtonContent = syncBtn.innerHTML; // Store full HTML
    syncBtn.innerHTML = `<img src="/static/images/refresh.svg" alt="Sync"> Syncing...`; // Keep icon
  }

  try {
    const response = await fetch(`/api/playlist/watch/trigger_check/${playlistId}`, { method: 'POST' });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to trigger sync');
    }
    showNotification('Playlist sync triggered successfully.');
  } catch (error: any) {
    showError(`Error triggering sync: ${error.message}`);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = originalButtonContent; // Restore full original HTML
    }
  }
}

/**
 * Displays a temporary notification message.
 */
function showNotification(message: string) {
  // Basic notification - consider a more robust solution for production
  const notificationEl = document.createElement('div');
  notificationEl.className = 'notification';
  notificationEl.textContent = message;
  document.body.appendChild(notificationEl);
  setTimeout(() => {
    notificationEl.remove();
  }, 3000);
}
