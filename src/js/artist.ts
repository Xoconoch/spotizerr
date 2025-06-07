// Import the downloadQueue singleton
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
  external_urls: {
    spotify: string;
  };
}

interface Album {
  id: string;
  name: string;
  artists: Artist[];
  images: Image[];
  album_type: string; // "album", "single", "compilation"
  album_group?: string; // "album", "single", "compilation", "appears_on"
  external_urls: {
    spotify: string;
  };
  explicit?: boolean; // Added to handle explicit filter
  total_tracks?: number;
  release_date?: string;
  is_locally_known?: boolean; // Added for local DB status
}

interface ArtistData {
  items: Album[];
  total: number;
  // Add other properties if available from the API
  // For watch status, the artist object itself might have `is_watched` if we extend API
  // For now, we fetch status separately.
}

// Interface for watch status response
interface WatchStatusResponse {
  is_watched: boolean;
  artist_data?: any; // The artist data from DB if watched
}

// Added: Interface for global watch config
interface GlobalWatchConfig {
  enabled: boolean;
  [key: string]: any;
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
  const pathSegments = window.location.pathname.split('/');
  const artistId = pathSegments[pathSegments.indexOf('artist') + 1];

  if (!artistId) {
    showError('No artist ID provided.');
    return;
  }

  const globalWatchConfig = await getGlobalWatchConfig(); // Fetch global config
  const isGlobalWatchActuallyEnabled = globalWatchConfig.enabled;

  // Fetch artist info directly
  fetch(`/api/artist/info?id=${encodeURIComponent(artistId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json() as Promise<ArtistData>;
    })
    .then(data => renderArtist(data, artistId, isGlobalWatchActuallyEnabled))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load artist info.');
    });

  const queueIcon = document.getElementById('queueIcon');
  if (queueIcon) {
    queueIcon.addEventListener('click', () => downloadQueue.toggleVisibility());
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
                console.error('Failed to fetch watch config for artist page, defaulting to hidden');
                // Don't update cache on error
                watchlistButton.classList.add('hidden'); // Hide if config fetch fails
            }
        } catch (error) {
            console.error('Error fetching watch config for artist page:', error);
            // Don't update cache on error
            watchlistButton.classList.add('hidden'); // Hide on error
        }
    }
  }
  updateWatchlistButtonVisibility();

  // Initialize the watch button after main artist rendering
  // This is done inside renderArtist after button element is potentially created.
});

async function renderArtist(artistData: ArtistData, artistId: string, isGlobalWatchEnabled: boolean) {
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.classList.add('hidden');

  const errorEl = document.getElementById('error');
  if (errorEl) errorEl.classList.add('hidden');

  // Fetch watch status upfront to avoid race conditions for album button rendering
  let isArtistActuallyWatched = false; // Default
  if (isGlobalWatchEnabled) { // Only fetch if globally enabled
      isArtistActuallyWatched = await getArtistWatchStatus(artistId);
  }

  // Check if explicit filter is enabled
  const isExplicitFilterEnabled = downloadQueue.isExplicitFilterEnabled();

  const firstAlbum = artistData.items?.[0];
  const artistName = firstAlbum?.artists?.[0]?.name || 'Unknown Artist';
  const artistImageSrc = firstAlbum?.images?.[0]?.url || '/static/images/placeholder.jpg';

  const artistNameEl = document.getElementById('artist-name');
  if (artistNameEl) {
    artistNameEl.innerHTML =
      `<a href="/artist/${artistId}" class="artist-link">${artistName}</a>`;
  }
  const artistStatsEl = document.getElementById('artist-stats');
  if (artistStatsEl) {
    artistStatsEl.textContent = `${artistData.total || '0'} albums`;
  }
  const artistImageEl = document.getElementById('artist-image') as HTMLImageElement | null;
  if (artistImageEl) {
    artistImageEl.src = artistImageSrc;
  }

  const watchArtistBtn = document.getElementById('watchArtistBtn') as HTMLButtonElement | null;
  const syncArtistBtn = document.getElementById('syncArtistBtn') as HTMLButtonElement | null;

  if (!isGlobalWatchEnabled) {
    if (watchArtistBtn) {
        watchArtistBtn.classList.add('hidden');
        watchArtistBtn.disabled = true;
    }
    if (syncArtistBtn) {
        syncArtistBtn.classList.add('hidden');
        syncArtistBtn.disabled = true;
    }
  } else {
    if (watchArtistBtn) {
        initializeWatchButton(artistId, isArtistActuallyWatched);
    } else {
        console.warn("Watch artist button not found in HTML.");
    }
    // Sync button visibility is managed by initializeWatchButton
  }

  // Define the artist URL (used by both full-discography and group downloads)
  // const artistUrl = `https://open.spotify.com/artist/${artistId}`; // Not directly used here anymore

  // Home Button
  let homeButton = document.getElementById('homeButton') as HTMLButtonElement | null;
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';
    homeButton.innerHTML = `<img src="/static/images/home.svg" alt="Home">`;
    const artistHeader = document.getElementById('artist-header');
    if (artistHeader) artistHeader.prepend(homeButton);
  }
  if (homeButton) {
    homeButton.addEventListener('click', () => window.location.href = window.location.origin);
  }

  // Download Whole Artist Button using the new artist API endpoint
  let downloadArtistBtn = document.getElementById('downloadArtistBtn') as HTMLButtonElement | null;
  if (!downloadArtistBtn) {
    downloadArtistBtn = document.createElement('button');
    downloadArtistBtn.id = 'downloadArtistBtn';
    downloadArtistBtn.className = 'download-btn download-btn--main';
    downloadArtistBtn.textContent = 'Download All Discography';
    const artistHeader = document.getElementById('artist-header');
    if (artistHeader) artistHeader.appendChild(downloadArtistBtn);
  }

  // When explicit filter is enabled, disable all download buttons
  if (isExplicitFilterEnabled) {
    if (downloadArtistBtn) {
      downloadArtistBtn.disabled = true;
      downloadArtistBtn.classList.add('download-btn--disabled');
      downloadArtistBtn.innerHTML = `<span title="Direct artist downloads are restricted when explicit filter is enabled. Please visit individual album pages.">Downloads Restricted</span>`;
    }
  } else {
    if (downloadArtistBtn) {
      downloadArtistBtn.addEventListener('click', () => {
        document.querySelectorAll('.download-btn:not(#downloadArtistBtn)').forEach(btn => btn.remove());
        if (downloadArtistBtn) {
          downloadArtistBtn.disabled = true;
          downloadArtistBtn.textContent = 'Queueing...';
        }
        startDownload(
          artistId,
          'artist',
          { name: artistName, artist: artistName },
          'album,single,compilation,appears_on'
        )
          .then((taskIds) => {
            if (downloadArtistBtn) {
              downloadArtistBtn.textContent = 'Artist queued';
              downloadQueue.toggleVisibility(true);
              if (Array.isArray(taskIds)) {
                downloadArtistBtn.title = `${taskIds.length} albums queued for download`;
              }
            }
          })
          .catch(err => {
            if (downloadArtistBtn) {
              downloadArtistBtn.textContent = 'Download All Discography';
              downloadArtistBtn.disabled = false;
            }
            showError('Failed to queue artist download: ' + (err?.message || 'Unknown error'));
          });
      });
    }
  }

  const albumGroups: Record<string, Album[]> = {};
  const appearingAlbums: Album[] = [];

  (artistData.items || []).forEach(album => {
    if (!album) return;
    if (isExplicitFilterEnabled && album.explicit) {
      return;
    }
    if (album.album_group === 'appears_on') {
      appearingAlbums.push(album);
    } else {
      const type = (album.album_type || 'unknown').toLowerCase();
      if (!albumGroups[type]) albumGroups[type] = [];
      albumGroups[type].push(album);
    }
  });

  const groupsContainer = document.getElementById('album-groups');
  if (groupsContainer) {
    groupsContainer.innerHTML = '';

    // Use the definitively fetched watch status for rendering album buttons
    // const isArtistWatched = watchArtistBtn && watchArtistBtn.dataset.watching === 'true'; // Old way
    // const useThisWatchStatusForAlbums = isArtistActuallyWatched; // Old way, now combination of global and individual

    for (const [groupType, albums] of Object.entries(albumGroups)) {
      const groupSection = document.createElement('section');
      groupSection.className = 'album-group';

      const groupHeaderHTML = isExplicitFilterEnabled ?
        `<div class="album-group-header">
          <h3>${capitalize(groupType)}s</h3>
          <div class="download-note">Visit album pages to download content</div>
        </div>` :
        `<div class="album-group-header">
          <h3>${capitalize(groupType)}s</h3>
          <button class="download-btn download-btn--main group-download-btn"
                  data-group-type="${groupType}">
            Download All ${capitalize(groupType)}s
          </button>
        </div>`;

      groupSection.innerHTML = groupHeaderHTML;
      const albumsListContainer = document.createElement('div');
      albumsListContainer.className = 'albums-list';

      albums.forEach(album => {
        if (!album) return;
        const albumElement = document.createElement('div');
        albumElement.className = 'album-card';
        albumElement.dataset.albumId = album.id;

        let albumCardHTML = `
          <a href="/album/${album.id || ''}" class="album-link">
            <img src="${album.images?.[1]?.url || album.images?.[0]?.url || '/static/images/placeholder.jpg'}"
                 alt="Album cover"
                 class="album-cover ${album.is_locally_known === false ? 'album-missing-in-db' : ''}">
          </a>
          <div class="album-info">
            <div class="album-title">${album.name || 'Unknown Album'}</div>
            <div class="album-artist">${album.artists?.map(a => a?.name || 'Unknown Artist').join(', ') || 'Unknown Artist'}</div>
          </div>
        `;
        albumElement.innerHTML = albumCardHTML;

        const albumCardActions = document.createElement('div');
        albumCardActions.className = 'album-card-actions';

        // Persistent Mark as Known/Missing button (if artist is watched) - Appears first (left)
        if (isGlobalWatchEnabled && isArtistActuallyWatched && album.id) {
          const toggleKnownBtn = document.createElement('button');
          toggleKnownBtn.className = 'toggle-known-status-btn persistent-album-action-btn';
          toggleKnownBtn.dataset.albumId = album.id;

          if (album.is_locally_known) {
            toggleKnownBtn.dataset.status = 'known';
            toggleKnownBtn.innerHTML = '<img src="/static/images/check.svg" alt="Mark as missing">';
            toggleKnownBtn.title = 'Mark album as not in local library (Missing)';
            toggleKnownBtn.classList.add('status-known'); // Green
          } else {
            toggleKnownBtn.dataset.status = 'missing';
            toggleKnownBtn.innerHTML = '<img src="/static/images/missing.svg" alt="Mark as known">';
            toggleKnownBtn.title = 'Mark album as in local library (Known)';
            toggleKnownBtn.classList.add('status-missing'); // Red
          }
          albumCardActions.appendChild(toggleKnownBtn); // Add to actions container
        }

        // Persistent Download Button (if not explicit filter) - Appears second (right)
        if (!isExplicitFilterEnabled) {
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'download-btn download-btn--circle persistent-download-btn';
          downloadBtn.innerHTML = '<img src="/static/images/download.svg" alt="Download album">';
          downloadBtn.title = 'Download this album';
          downloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<img src="/static/images/refresh.svg" alt="Queueing..." class="icon-spin">';
            startDownload(album.id, 'album', { name: album.name, artist: album.artists?.[0]?.name || 'Unknown Artist', type: 'album' })
              .then(() => {
                downloadBtn.innerHTML = '<img src="/static/images/check.svg" alt="Queued">';
                showNotification(`Album '${album.name}' queued for download.`);
                downloadQueue.toggleVisibility(true);
              })
              .catch(err => {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '<img src="/static/images/download.svg" alt="Download album">';
                showError(`Failed to queue album: ${err?.message || 'Unknown error'}`);
              });
          });
          albumCardActions.appendChild(downloadBtn); // Add to actions container
        }

        // Only append albumCardActions if it has any buttons
        if (albumCardActions.hasChildNodes()) {
            albumElement.appendChild(albumCardActions);
        }

        albumsListContainer.appendChild(albumElement);
      });
      groupSection.appendChild(albumsListContainer);
      groupsContainer.appendChild(groupSection);
    }

    if (appearingAlbums.length > 0) {
      const featuringSection = document.createElement('section');
      featuringSection.className = 'album-group';
      const featuringHeaderHTML = isExplicitFilterEnabled ?
        `<div class="album-group-header">
          <h3>Featuring</h3>
          <div class="download-note">Visit album pages to download content</div>
        </div>` :
        `<div class="album-group-header">
          <h3>Featuring</h3>
          <button class="download-btn download-btn--main group-download-btn"
                  data-group-type="appears_on">
            Download All Featuring Albums
          </button>
        </div>`;
      featuringSection.innerHTML = featuringHeaderHTML;
      const appearingAlbumsListContainer = document.createElement('div');
      appearingAlbumsListContainer.className = 'albums-list';

      appearingAlbums.forEach(album => {
        if (!album) return;
        const albumElement = document.createElement('div');
        albumElement.className = 'album-card';
        albumElement.dataset.albumId = album.id; // Set dataset for appears_on albums too

        let albumCardHTML = `
          <a href="/album/${album.id || ''}" class="album-link">
            <img src="${album.images?.[1]?.url || album.images?.[0]?.url || '/static/images/placeholder.jpg'}"
                 alt="Album cover"
                 class="album-cover ${album.is_locally_known === false ? 'album-missing-in-db' : ''}">
          </a>
          <div class="album-info">
            <div class="album-title">${album.name || 'Unknown Album'}</div>
            <div class="album-artist">${album.artists?.map(a => a?.name || 'Unknown Artist').join(', ') || 'Unknown Artist'}</div>
          </div>
        `;
        albumElement.innerHTML = albumCardHTML;

        const albumCardActions_AppearsOn = document.createElement('div');
        albumCardActions_AppearsOn.className = 'album-card-actions';

        // Persistent Mark as Known/Missing button for appearing_on albums (if artist is watched) - Appears first (left)
        if (isGlobalWatchEnabled && isArtistActuallyWatched && album.id) {
            const toggleKnownBtn = document.createElement('button');
            toggleKnownBtn.className = 'toggle-known-status-btn persistent-album-action-btn';
            toggleKnownBtn.dataset.albumId = album.id;
            if (album.is_locally_known) {
                toggleKnownBtn.dataset.status = 'known';
                toggleKnownBtn.innerHTML = '<img src="/static/images/check.svg" alt="Mark as missing">';
                toggleKnownBtn.title = 'Mark album as not in local library (Missing)';
                toggleKnownBtn.classList.add('status-known'); // Green
            } else {
                toggleKnownBtn.dataset.status = 'missing';
                toggleKnownBtn.innerHTML = '<img src="/static/images/missing.svg" alt="Mark as known">';
                toggleKnownBtn.title = 'Mark album as in local library (Known)';
                toggleKnownBtn.classList.add('status-missing'); // Red
            }
            albumCardActions_AppearsOn.appendChild(toggleKnownBtn); // Add to actions container
        }

        // Persistent Download Button for appearing_on albums (if not explicit filter) - Appears second (right)
        if (!isExplicitFilterEnabled) {
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'download-btn download-btn--circle persistent-download-btn';
          downloadBtn.innerHTML = '<img src="/static/images/download.svg" alt="Download album">';
          downloadBtn.title = 'Download this album';
          downloadBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<img src="/static/images/refresh.svg" alt="Queueing..." class="icon-spin">';
            startDownload(album.id, 'album', { name: album.name, artist: album.artists?.[0]?.name || 'Unknown Artist', type: 'album' })
              .then(() => {
                downloadBtn.innerHTML = '<img src="/static/images/check.svg" alt="Queued">';
                showNotification(`Album '${album.name}' queued for download.`);
                downloadQueue.toggleVisibility(true);
              })
              .catch(err => {
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '<img src="/static/images/download.svg" alt="Download album">';
                showError(`Failed to queue album: ${err?.message || 'Unknown error'}`);
              });
          });
          albumCardActions_AppearsOn.appendChild(downloadBtn); // Add to actions container
        }

        // Only append albumCardActions_AppearsOn if it has any buttons
        if (albumCardActions_AppearsOn.hasChildNodes()) {
            albumElement.appendChild(albumCardActions_AppearsOn);
        }

        appearingAlbumsListContainer.appendChild(albumElement);
      });
      featuringSection.appendChild(appearingAlbumsListContainer);
      groupsContainer.appendChild(featuringSection);
    }
  }

  const artistHeaderEl = document.getElementById('artist-header');
  if (artistHeaderEl) artistHeaderEl.classList.remove('hidden');
  const albumsContainerEl = document.getElementById('albums-container');
  if (albumsContainerEl) albumsContainerEl.classList.remove('hidden');

  if (!isExplicitFilterEnabled) {
    attachAlbumActionListeners(artistId, isGlobalWatchEnabled);
    attachGroupDownloadListeners(artistId, artistName);
  }
}

function attachGroupDownloadListeners(artistId: string, artistName: string) {
  document.querySelectorAll('.group-download-btn').forEach(btn => {
    const button = btn as HTMLButtonElement;
    button.addEventListener('click', async (e) => {
      const target = e.target as HTMLButtonElement | null;
      if (!target) return;
      const groupType = target.dataset.groupType || 'album';
      target.disabled = true;
      const displayType = groupType === 'appears_on' ? 'Featuring Albums' : `${capitalize(groupType)}s`;
      target.textContent = `Queueing all ${displayType}...`;
      try {
        const taskIds = await startDownload(
          artistId,
          'artist',
          { name: artistName || 'Unknown Artist', artist: artistName || 'Unknown Artist' },
          groupType
        );
        const totalQueued = Array.isArray(taskIds) ? taskIds.length : 0;
        target.textContent = `Queued all ${displayType}`;
        target.title = `${totalQueued} albums queued for download`;
        downloadQueue.toggleVisibility(true);
      } catch (error: any) {
        target.textContent = `Download All ${displayType}`;
        target.disabled = false;
        showError(`Failed to queue download for all ${groupType}: ${error?.message || 'Unknown error'}`);
      }
    });
  });
}

function attachAlbumActionListeners(artistIdForContext: string, isGlobalWatchEnabled: boolean) {
  const groupsContainer = document.getElementById('album-groups');
  if (!groupsContainer) return;

  groupsContainer.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest('.toggle-known-status-btn') as HTMLButtonElement | null;

    if (button && button.dataset.albumId) {
      if (!isGlobalWatchEnabled) {
        showNotification("Watch feature is currently disabled globally.");
        return;
      }
      const albumId = button.dataset.albumId;
      const currentStatus = button.dataset.status;

      // Optimistic UI update
      button.disabled = true;
      const originalIcon = button.innerHTML; // Save original icon
      button.innerHTML = '<img src="/static/images/refresh.svg" alt="Updating..." class="icon-spin">';

      try {
        if (currentStatus === 'known') {
          await handleMarkAlbumAsMissing(artistIdForContext, albumId);
          button.dataset.status = 'missing';
          button.innerHTML = '<img src="/static/images/missing.svg" alt="Mark as known">'; // Update to missing.svg
          button.title = 'Mark album as in local library (Known)';
          button.classList.remove('status-known');
          button.classList.add('status-missing');
          const albumCard = button.closest('.album-card') as HTMLElement | null;
          if (albumCard) {
            const coverImg = albumCard.querySelector('.album-cover') as HTMLImageElement | null;
            if (coverImg) coverImg.classList.add('album-missing-in-db');
          }
          showNotification(`Album marked as missing from local library.`);
        } else {
          await handleMarkAlbumAsKnown(artistIdForContext, albumId);
          button.dataset.status = 'known';
          button.innerHTML = '<img src="/static/images/check.svg" alt="Mark as missing">'; // Update to check.svg
          button.title = 'Mark album as not in local library (Missing)';
          button.classList.remove('status-missing');
          button.classList.add('status-known');
          const albumCard = button.closest('.album-card') as HTMLElement | null;
          if (albumCard) {
            const coverImg = albumCard.querySelector('.album-cover') as HTMLImageElement | null;
            if (coverImg) coverImg.classList.remove('album-missing-in-db');
          }
          showNotification(`Album marked as present in local library.`);
        }
      } catch (error) {
        console.error('Failed to update album status:', error);
        showError('Failed to update album status. Please try again.');
        // Revert UI on error
        button.dataset.status = currentStatus; // Revert status
        button.innerHTML = originalIcon; // Revert icon
         // Revert card style if needed (though if API failed, actual state is unchanged)
      } finally {
        button.disabled = false; // Re-enable button
      }
    }
  });
}

async function handleMarkAlbumAsKnown(artistId: string, albumId: string) {
  // Ensure albumId is a string and not undefined.
  if (!albumId || typeof albumId !== 'string') {
    console.error('Invalid albumId provided to handleMarkAlbumAsKnown:', albumId);
    throw new Error('Invalid album ID.');
  }
  const response = await fetch(`/api/artist/watch/${artistId}/albums`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([albumId]) // API expects an array of album IDs
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to mark album as known.' }));
    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

async function handleMarkAlbumAsMissing(artistId: string, albumId: string) {
  // Ensure albumId is a string and not undefined.
  if (!albumId || typeof albumId !== 'string') {
    console.error('Invalid albumId provided to handleMarkAlbumAsMissing:', albumId);
    throw new Error('Invalid album ID.');
  }
  const response = await fetch(`/api/artist/watch/${artistId}/albums`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([albumId]) // API expects an array of album IDs
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Failed to mark album as missing.' }));
    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
  }
  // For DELETE, Spotify often returns 204 No Content, or we might return custom JSON.
  // If expecting JSON:
  // return response.json();
  // If handling 204 or simple success message:
  const result = await response.json(); // Assuming the backend sends a JSON response
  console.log('Mark as missing result:', result);
  return result;
}

// Add startDownload function (similar to track.js and main.js)
/**
 * Starts the download process via centralized download queue
 */
async function startDownload(itemId: string, type: string, item: { name: string, artist?: string, type?: string }, albumType?: string) {
  if (!itemId || !type) {
    showError('Missing ID or type for download');
    return Promise.reject(new Error('Missing ID or type for download')); // Return a rejected promise
  }

  try {
    // Use the centralized downloadQueue.download method for all downloads including artist downloads
    const result = await downloadQueue.download(itemId, type, item, albumType);

    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);

    // Return the result for tracking
    return result;
  } catch (error: any) { // Add type for error
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

// UI Helpers
function showError(message: string) {
  const errorEl = document.getElementById('error');
  if (errorEl) {
    errorEl.textContent = message || 'An error occurred';
    errorEl.classList.remove('hidden');
  }
}

function capitalize(str: string) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

async function getArtistWatchStatus(artistId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}/status`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})); // Catch if res not json
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const data: WatchStatusResponse = await response.json();
    return data.is_watched;
  } catch (error) {
    console.error('Error fetching artist watch status:', error);
    showError('Could not fetch watch status.');
    return false; // Assume not watching on error
  }
}

async function watchArtist(artistId: string): Promise<void> {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}`, {
      method: 'PUT',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    // Optionally handle success message from response.json()
    await response.json();
  } catch (error) {
    console.error('Error watching artist:', error);
    showError('Failed to watch artist.');
    throw error; // Re-throw to allow caller to handle UI update failure
  }
}

async function unwatchArtist(artistId: string): Promise<void> {
  try {
    const response = await fetch(`/api/artist/watch/${artistId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    // Optionally handle success message
    await response.json();
  } catch (error) {
    console.error('Error unwatching artist:', error);
    showError('Failed to unwatch artist.');
    throw error; // Re-throw
  }
}

function updateWatchButton(artistId: string, isWatching: boolean) {
  const watchArtistBtn = document.getElementById('watchArtistBtn') as HTMLButtonElement | null;
  const syncArtistBtn = document.getElementById('syncArtistBtn') as HTMLButtonElement | null;

  if (watchArtistBtn) {
    const img = watchArtistBtn.querySelector('img');
    if (isWatching) {
      if (img) img.src = '/static/images/eye-crossed.svg';
      watchArtistBtn.innerHTML = `<img src="/static/images/eye-crossed.svg" alt="Unwatch"> Unwatch Artist`;
      watchArtistBtn.classList.add('watching');
      watchArtistBtn.title = "Stop watching this artist";
      if (syncArtistBtn) syncArtistBtn.classList.remove('hidden');
    } else {
      if (img) img.src = '/static/images/eye.svg';
      watchArtistBtn.innerHTML = `<img src="/static/images/eye.svg" alt="Watch"> Watch Artist`;
      watchArtistBtn.classList.remove('watching');
      watchArtistBtn.title = "Watch this artist for new releases";
      if (syncArtistBtn) syncArtistBtn.classList.add('hidden');
    }
    watchArtistBtn.dataset.watching = isWatching ? 'true' : 'false';
  }
}

async function initializeWatchButton(artistId: string, initialIsWatching: boolean) {
  const watchArtistBtn = document.getElementById('watchArtistBtn') as HTMLButtonElement | null;
  const syncArtistBtn = document.getElementById('syncArtistBtn') as HTMLButtonElement | null;

  if (!watchArtistBtn) return;

  try {
    watchArtistBtn.disabled = true;
    if (syncArtistBtn) syncArtistBtn.disabled = true;

    // const isWatching = await getArtistWatchStatus(artistId); // No longer fetch here, use parameter
    updateWatchButton(artistId, initialIsWatching); // Use passed status
    watchArtistBtn.disabled = false;
    if (syncArtistBtn) syncArtistBtn.disabled = !(watchArtistBtn.dataset.watching === 'true');

    watchArtistBtn.addEventListener('click', async () => {
      const currentlyWatching = watchArtistBtn.dataset.watching === 'true';
      watchArtistBtn.disabled = true;
      if (syncArtistBtn) syncArtistBtn.disabled = true;
      try {
        if (currentlyWatching) {
          await unwatchArtist(artistId);
          updateWatchButton(artistId, false);
          // Re-fetch and re-render artist data, passing the global watch status again
          const newArtistData = await (await fetch(`/api/artist/info?id=${encodeURIComponent(artistId)}`)).json() as ArtistData;
          // Assuming renderArtist needs the global status, which it does. We need to get it or have it available.
          // Since initializeWatchButton is called from renderArtist, we can assume isGlobalWatchEnabled is in that scope.
          // This part is tricky as initializeWatchButton doesn't have isGlobalWatchEnabled.
          // Let's re-fetch global config or rely on the fact that if this button is clickable, global is on.
          // For simplicity, the re-render will pick up the global status from its own scope if called from top level.
          // The click handler itself does not need to pass isGlobalWatchEnabled to renderArtist, renderArtist's caller does.
          // Let's ensure renderArtist is called correctly after watch/unwatch.
          const globalWatchConfig = await getGlobalWatchConfig(); // Re-fetch for re-render
          renderArtist(newArtistData, artistId, globalWatchConfig.enabled);
        } else {
          await watchArtist(artistId);
          updateWatchButton(artistId, true);
          // Re-fetch and re-render artist data
          const newArtistData = await (await fetch(`/api/artist/info?id=${encodeURIComponent(artistId)}`)).json() as ArtistData;
          const globalWatchConfig = await getGlobalWatchConfig(); // Re-fetch for re-render
          renderArtist(newArtistData, artistId, globalWatchConfig.enabled);
        }
      } catch (error) {
        // On error, revert button to its state before the click attempt
        updateWatchButton(artistId, currentlyWatching);
      }
      watchArtistBtn.disabled = false;
      if (syncArtistBtn) syncArtistBtn.disabled = !(watchArtistBtn.dataset.watching === 'true');
    });

    // Add event listener for the sync button
    if (syncArtistBtn) {
      syncArtistBtn.addEventListener('click', async () => {
        syncArtistBtn.disabled = true;
        const originalButtonContent = syncArtistBtn.innerHTML; // Store full HTML
        const textNode = Array.from(syncArtistBtn.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
        const originalText = textNode ? textNode.nodeValue : 'Sync Watched Artist'; // Fallback text

        syncArtistBtn.innerHTML = `<img src="/static/images/refresh.svg" alt="Sync"> Syncing...`; // Keep icon
        try {
          await triggerArtistSync(artistId);
          showNotification('Artist sync triggered successfully.');
        } catch (error) {
          // Error is shown by triggerArtistSync
        }
        syncArtistBtn.innerHTML = originalButtonContent; // Restore full original HTML
        syncArtistBtn.disabled = false;
      });
    }

  } catch (error) {
    if (watchArtistBtn) watchArtistBtn.disabled = false;
    if (syncArtistBtn) syncArtistBtn.disabled = true;
    updateWatchButton(artistId, false); // On error fetching initial status (though now it's passed)
                                      // This line might be less relevant if initialIsWatching is guaranteed by caller
                                      // but as a fallback it sets to a non-watching state.
  }
}

// New function to trigger artist sync
async function triggerArtistSync(artistId: string): Promise<void> {
  try {
    const response = await fetch(`/api/artist/watch/trigger_check/${artistId}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    await response.json(); // Contains success message
  } catch (error) {
    console.error('Error triggering artist sync:', error);
    showError('Failed to trigger artist sync.');
    throw error; // Re-throw
  }
}

/**
 * Displays a temporary notification message.
 */
function showNotification(message: string) {
  // Basic notification - consider a more robust solution for production
  const notificationEl = document.createElement('div');
  notificationEl.className = 'notification'; // Ensure this class is styled
  notificationEl.textContent = message;
  document.body.appendChild(notificationEl);
  setTimeout(() => {
    notificationEl.remove();
  }, 3000);
}
