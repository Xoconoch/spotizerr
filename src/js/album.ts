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

interface Track {
  id: string;
  name: string;
  artists: Artist[];
  duration_ms: number;
  explicit: boolean;
  external_urls: {
    spotify: string;
  };
}

interface Album {
  id: string;
  name: string;
  artists: Artist[];
  images: Image[];
  release_date: string;
  total_tracks: number;
  label: string;
  copyrights: { text: string; type: string }[];
  explicit: boolean;
  tracks: {
    items: Track[];
    // Add other properties from Spotify API if needed (e.g., total, limit, offset)
  };
  external_urls: {
    spotify: string;
  };
  // Add other album properties if available
}

document.addEventListener('DOMContentLoaded', () => {
  const pathSegments = window.location.pathname.split('/');
  const albumId = pathSegments[pathSegments.indexOf('album') + 1];

  if (!albumId) {
    showError('No album ID provided.');
    return;
  }

  // Fetch album info directly
  fetch(`/api/album/info?id=${encodeURIComponent(albumId)}`)
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json() as Promise<Album>; // Add Album type
    })
    .then(data => renderAlbum(data))
    .catch(error => {
      console.error('Error:', error);
      showError('Failed to load album.');
    });

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
                console.error('Failed to fetch watch config, defaulting to hidden');
                // Don't update cache on error
                watchlistButton.classList.add('hidden'); // Hide if config fetch fails
            }
        } catch (error) {
            console.error('Error fetching watch config:', error);
            // Don't update cache on error
            watchlistButton.classList.add('hidden'); // Hide on error
        }
    }
  }
  updateWatchlistButtonVisibility();
});

function renderAlbum(album: Album) {
  // Hide loading and error messages.
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.classList.add('hidden');

  const errorSectionEl = document.getElementById('error'); // Renamed to avoid conflict with error var in catch
  if (errorSectionEl) errorSectionEl.classList.add('hidden');

  // Check if album itself is marked explicit and filter is enabled
  const isExplicitFilterEnabled = downloadQueue.isExplicitFilterEnabled();
  if (isExplicitFilterEnabled && album.explicit) {
    // Show placeholder for explicit album
    const placeholderContent = `
      <div class="explicit-filter-placeholder">
        <h2>Explicit Content Filtered</h2>
        <p>This album contains explicit content and has been filtered based on your settings.</p>
        <p>The explicit content filter is controlled by environment variables.</p>
      </div>
    `;

    const contentContainer = document.getElementById('album-header');
    if (contentContainer) {
      contentContainer.innerHTML = placeholderContent;
      contentContainer.classList.remove('hidden');
    }

    return; // Stop rendering the actual album content
  }

  const baseUrl = window.location.origin;

  // Set album header info.
  const albumNameEl = document.getElementById('album-name');
  if (albumNameEl) {
    albumNameEl.innerHTML =
      `<a href="${baseUrl}/album/${album.id || ''}">${album.name || 'Unknown Album'}</a>`;
  }

  const albumArtistEl = document.getElementById('album-artist');
  if (albumArtistEl) {
    albumArtistEl.innerHTML =
      `By ${album.artists?.map(artist =>
        `<a href="${baseUrl}/artist/${artist?.id || ''}">${artist?.name || 'Unknown Artist'}</a>`
      ).join(', ') || 'Unknown Artist'}`;
  }

  const releaseYear = album.release_date ? new Date(album.release_date).getFullYear() : 'N/A';
  const albumStatsEl = document.getElementById('album-stats');
  if (albumStatsEl) {
    albumStatsEl.textContent =
      `${releaseYear} • ${album.total_tracks || '0'} songs • ${album.label || 'Unknown Label'}`;
  }

  const albumCopyrightEl = document.getElementById('album-copyright');
  if (albumCopyrightEl) {
    albumCopyrightEl.textContent =
      album.copyrights?.map(c => c?.text || '').filter(text => text).join(' • ') || '';
  }

  const imageSrc = album.images?.[0]?.url || '/static/images/placeholder.jpg';
  const albumImageEl = document.getElementById('album-image') as HTMLImageElement | null;
  if (albumImageEl) {
    albumImageEl.src = imageSrc;
  }

  // Create (if needed) the Home Button.
  let homeButton = document.getElementById('homeButton') as HTMLButtonElement | null;
  if (!homeButton) {
    homeButton = document.createElement('button');
    homeButton.id = 'homeButton';
    homeButton.className = 'home-btn';

    const homeIcon = document.createElement('img');
    homeIcon.src = '/static/images/home.svg';
    homeIcon.alt = 'Home';
    homeButton.appendChild(homeIcon);

    // Insert as first child of album-header.
    const headerContainer = document.getElementById('album-header');
    if (headerContainer) { // Null check
      headerContainer.insertBefore(homeButton, headerContainer.firstChild);
    }
  }
  if (homeButton) { // Null check
    homeButton.addEventListener('click', () => {
      window.location.href = window.location.origin;
    });
  }

  // Check if any track in the album is explicit when filter is enabled
  let hasExplicitTrack = false;
  if (isExplicitFilterEnabled && album.tracks?.items) {
    hasExplicitTrack = album.tracks.items.some(track => track && track.explicit);
  }

  // Create (if needed) the Download Album Button.
  let downloadAlbumBtn = document.getElementById('downloadAlbumBtn') as HTMLButtonElement | null;
  if (!downloadAlbumBtn) {
    downloadAlbumBtn = document.createElement('button');
    downloadAlbumBtn.id = 'downloadAlbumBtn';
    downloadAlbumBtn.textContent = 'Download Full Album';
    downloadAlbumBtn.className = 'download-btn download-btn--main';
    const albumHeader = document.getElementById('album-header');
    if (albumHeader) albumHeader.appendChild(downloadAlbumBtn); // Null check
  }

  if (downloadAlbumBtn) { // Null check for downloadAlbumBtn
    if (isExplicitFilterEnabled && hasExplicitTrack) {
      // Disable the album download button and display a message explaining why
      downloadAlbumBtn.disabled = true;
      downloadAlbumBtn.classList.add('download-btn--disabled');
      downloadAlbumBtn.innerHTML = `<span title="Cannot download entire album because it contains explicit tracks">Album Contains Explicit Tracks</span>`;
    } else {
      // Normal behavior when no explicit tracks are present
      downloadAlbumBtn.addEventListener('click', () => {
        // Remove any other download buttons (keeping the full-album button in place).
        document.querySelectorAll('.download-btn').forEach(btn => {
          if (btn.id !== 'downloadAlbumBtn') btn.remove();
        });

        if (downloadAlbumBtn) { // Inner null check
          downloadAlbumBtn.disabled = true;
          downloadAlbumBtn.textContent = 'Queueing...';
        }

        downloadWholeAlbum(album)
          .then(() => {
            if (downloadAlbumBtn) downloadAlbumBtn.textContent = 'Queued!'; // Inner null check
          })
          .catch(err => {
            showError('Failed to queue album download: ' + (err?.message || 'Unknown error'));
            if (downloadAlbumBtn) downloadAlbumBtn.disabled = false; // Inner null check
          });
      });
    }
  }

  // Render each track.
  const tracksList = document.getElementById('tracks-list');
  if (tracksList) { // Null check
    tracksList.innerHTML = '';

    if (album.tracks?.items) {
      album.tracks.items.forEach((track, index) => {
        if (!track) return; // Skip null or undefined tracks

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
            <div class="track-duration">--:--</div>
          `;
          tracksList.appendChild(trackElement);
          return;
        }

        const trackElement = document.createElement('div');
        trackElement.className = 'track';
        trackElement.innerHTML = `
          <div class="track-number">${index + 1}</div>
          <div class="track-info">
            <div class="track-name">
              <a href="${baseUrl}/track/${track.id || ''}">${track.name || 'Unknown Track'}</a>
            </div>
            <div class="track-artist">
              ${track.artists?.map(a =>
                `<a href="${baseUrl}/artist/${a?.id || ''}">${a?.name || 'Unknown Artist'}</a>`
              ).join(', ') || 'Unknown Artist'}
            </div>
          </div>
          <div class="track-duration">${msToTime(track.duration_ms || 0)}</div>
          <button class="download-btn download-btn--circle"
                  data-id="${track.id || ''}"
                  data-type="track"
                  data-name="${track.name || 'Unknown Track'}"
                  title="Download">
            <img src="/static/images/download.svg" alt="Download">
          </button>
        `;
        tracksList.appendChild(trackElement);
      });
    }
  }

  // Reveal header and track list.
  const albumHeaderEl = document.getElementById('album-header');
  if (albumHeaderEl) albumHeaderEl.classList.remove('hidden');

  const tracksContainerEl = document.getElementById('tracks-container');
  if (tracksContainerEl) tracksContainerEl.classList.remove('hidden');
  attachDownloadListeners();

  // If on a small screen, re-arrange the action buttons.
  if (window.innerWidth <= 480) {
    let actionsContainer = document.getElementById('album-actions');
    if (!actionsContainer) {
      actionsContainer = document.createElement('div');
      actionsContainer.id = 'album-actions';
      const albumHeader = document.getElementById('album-header');
      if (albumHeader) albumHeader.appendChild(actionsContainer); // Null check
    }
    if (actionsContainer) { // Null check for actionsContainer
        actionsContainer.innerHTML = ''; // Clear any previous content
        const homeBtn = document.getElementById('homeButton');
        if (homeBtn) actionsContainer.appendChild(homeBtn); // Null check

        const dlAlbumBtn = document.getElementById('downloadAlbumBtn');
        if (dlAlbumBtn) actionsContainer.appendChild(dlAlbumBtn); // Null check

        const queueToggle = document.querySelector('.queue-toggle');
        if (queueToggle) {
          actionsContainer.appendChild(queueToggle);
        }
    }
  }
}

async function downloadWholeAlbum(album: Album) {
  const albumIdToDownload = album.id || '';
  if (!albumIdToDownload) {
    throw new Error('Missing album ID');
  }

  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(albumIdToDownload, 'album', { name: album.name || 'Unknown Album' });
    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error: any) { // Add type for error
    showError('Album download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}

function msToTime(duration: number): string {
  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

function showError(message: string) {
  const errorEl = document.getElementById('error');
  if (errorEl) { // Null check
    errorEl.textContent = message || 'An error occurred';
    errorEl.classList.remove('hidden');
  }
}

function attachDownloadListeners() {
  document.querySelectorAll('.download-btn').forEach((btn) => {
    const button = btn as HTMLButtonElement; // Cast to HTMLButtonElement
    if (button.id === 'downloadAlbumBtn') return;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentTarget = e.currentTarget as HTMLButtonElement | null; // Cast currentTarget
      if (!currentTarget) return;

      const itemId = currentTarget.dataset.id || '';
      const type = currentTarget.dataset.type || '';
      const name = currentTarget.dataset.name || 'Unknown';

      if (!itemId) {
        showError('Missing item ID for download in album page');
        return;
      }
      // Remove the button immediately after click.
      currentTarget.remove();
      startDownload(itemId, type, { name }); // albumType will be undefined
    });
  });
}

async function startDownload(itemId: string, type: string, item: { name: string }, albumType?: string) { // Add types and make albumType optional
  if (!itemId || !type) {
    showError('Missing ID or type for download');
    return Promise.reject(new Error('Missing ID or type for download')); // Return a rejected promise
  }

  try {
    // Use the centralized downloadQueue.download method
    await downloadQueue.download(itemId, type, item, albumType);

    // Make the queue visible after queueing
    downloadQueue.toggleVisibility(true);
  } catch (error: any) { // Add type for error
    showError('Download failed: ' + (error?.message || 'Unknown error'));
    throw error;
  }
}
