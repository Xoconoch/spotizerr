// main.ts
import { downloadQueue } from './queue.js';

// Define interfaces for API data and search results
interface Image {
  url: string;
  height?: number;
  width?: number;
}

interface Artist {
  id?: string; // Artist ID might not always be present in search results for track artists
  name: string;
  external_urls?: { spotify?: string };
  genres?: string[]; // For artist type results
}

interface Album {
  id?: string; // Album ID might not always be present
  name: string;
  images?: Image[];
  album_type?: string; // Used in startDownload
  artists?: Artist[]; // Album can have artists too
  total_tracks?: number;
  release_date?: string;
  external_urls?: { spotify?: string };
}

interface Track {
  id: string;
  name: string;
  artists: Artist[];
  album: Album;
  duration_ms?: number;
  explicit?: boolean;
  external_urls: { spotify: string };
  href?: string; // Some spotify responses use href
}

interface Playlist {
  id: string;
  name: string;
  owner: { display_name?: string; id?: string };
  images?: Image[];
  tracks: { total: number }; // Simplified for search results
  external_urls: { spotify: string };
  href?: string; // Some spotify responses use href
  explicit?: boolean; // Playlists themselves aren't explicit, but items can be
}

// Specific item types for search results
interface TrackResultItem extends Track {}
interface AlbumResultItem extends Album { id: string; images?: Image[]; explicit?: boolean; external_urls: { spotify: string }; href?: string; }
interface PlaylistResultItem extends Playlist {}
interface ArtistResultItem extends Artist { id: string; images?: Image[]; explicit?: boolean; external_urls: { spotify: string }; href?: string; followers?: { total: number }; }

// Union type for any search result item
type SearchResultItem = TrackResultItem | AlbumResultItem | PlaylistResultItem | ArtistResultItem;

// Interface for the API response structure
interface SearchResponse {
  items: SearchResultItem[];
  // Add other top-level properties from the search API if needed (e.g., total, limit, offset)
}

// Interface for the item passed to downloadQueue.download
interface DownloadQueueItem {
    name: string;
    artist?: string;
    album?: { name: string; album_type?: string };
}

document.addEventListener('DOMContentLoaded', function() {
    // DOM elements
    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    const searchButton = document.getElementById('searchButton') as HTMLButtonElement | null;
    const searchType = document.getElementById('searchType') as HTMLSelectElement | null;
    const resultsContainer = document.getElementById('resultsContainer');
    const queueIcon = document.getElementById('queueIcon');
    const emptyState = document.getElementById('emptyState');
    const loadingResults = document.getElementById('loadingResults');
    const watchlistButton = document.getElementById('watchlistButton') as HTMLAnchorElement | null;

    // Initialize the queue
    if (queueIcon) {
        queueIcon.addEventListener('click', () => {
            downloadQueue.toggleVisibility();
        });
    }

    // Add event listeners
    if (searchButton) {
        searchButton.addEventListener('click', performSearch);
    }

    if (searchInput) {
        searchInput.addEventListener('keypress', function(e: KeyboardEvent) {
            if (e.key === 'Enter') {
                performSearch();
            }
        });

        // Auto-detect and handle pasted Spotify URLs
        searchInput.addEventListener('input', function(e: Event) {
            const target = e.target as HTMLInputElement;
            const inputVal = target.value.trim();
            if (isSpotifyUrl(inputVal)) {
                const details = getSpotifyResourceDetails(inputVal);
                if (details && searchType) {
                    searchType.value = details.type;
                }
            }
        });
    }

    // Restore last search type if no URL override
    const savedType = localStorage.getItem('lastSearchType');
    if (searchType && savedType && ['track','album','playlist','artist'].includes(savedType)) {
      searchType.value = savedType;
    }
    // Save last selection on change
    if (searchType) {
      searchType.addEventListener('change', () => {
        localStorage.setItem('lastSearchType', searchType.value);
      });
    }

    // Attempt to set initial watchlist button visibility from cache
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
                    // Don't update cache on error, rely on default hidden or previous cache state until success
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

    // Check for URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q');
    const type = urlParams.get('type');

    if (query && searchInput) {
        searchInput.value = query;
        if (type && searchType && ['track', 'album', 'playlist', 'artist'].includes(type)) {
            searchType.value = type;
        }
        performSearch();
    } else {
        // Show empty state if no query
        showEmptyState(true);
    }

    /**
     * Performs the search based on input values
     */
    async function performSearch() {
        const currentQuery = searchInput?.value.trim();
        if (!currentQuery) return;

        // Handle direct Spotify URLs
        if (isSpotifyUrl(currentQuery)) {
            const details = getSpotifyResourceDetails(currentQuery);
            if (details && details.id) {
                // Redirect to the appropriate page
                window.location.href = `/${details.type}/${details.id}`;
                return;
            }
        }

        // Update URL without reloading page
        const currentSearchType = searchType?.value || 'track';
        const newUrl = `${window.location.pathname}?q=${encodeURIComponent(currentQuery)}&type=${currentSearchType}`;
        window.history.pushState({ path: newUrl }, '', newUrl);

        // Show loading state
        showEmptyState(false);
        showLoading(true);
        if(resultsContainer) resultsContainer.innerHTML = '';

        try {
            const url = `/api/search?q=${encodeURIComponent(currentQuery)}&search_type=${currentSearchType}&limit=40`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error('Network response was not ok');
            }

            const data = await response.json() as SearchResponse; // Assert type for API response

            // Hide loading indicator
            showLoading(false);

            // Render results
            if (data && data.items && data.items.length > 0) {
                if(resultsContainer) resultsContainer.innerHTML = '';

                // Filter out items with null/undefined essential display parameters
                const validItems = filterValidItems(data.items, currentSearchType);

                if (validItems.length === 0) {
                    // No valid items found after filtering
                    if(resultsContainer) resultsContainer.innerHTML = `
                        <div class="empty-search-results">
                            <p>No valid results found for "${currentQuery}"</p>
                        </div>
                    `;
                    return;
                }

                validItems.forEach((item, index) => {
                    const cardElement = createResultCard(item, currentSearchType, index);

                    // Store the item data directly on the button element
                    const downloadBtn = cardElement.querySelector('.download-btn') as HTMLButtonElement | null;
                    if (downloadBtn) {
                        downloadBtn.dataset.itemIndex = index.toString();
                    }

                    if(resultsContainer) resultsContainer.appendChild(cardElement);
                });

                // Attach download handlers to the newly created cards
                attachDownloadListeners(validItems);
            } else {
                // No results found
                if(resultsContainer) resultsContainer.innerHTML = `
                    <div class="empty-search-results">
                        <p>No results found for "${currentQuery}"</p>
                    </div>
                `;
            }
        } catch (error: any) {
            console.error('Error:', error);
            showLoading(false);
            if(resultsContainer) resultsContainer.innerHTML = `
                <div class="error">
                    <p>Error searching: ${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Filters out items with null/undefined essential display parameters based on search type
     */
    function filterValidItems(items: SearchResultItem[], type: string): SearchResultItem[] {
        if (!items) return [];

        return items.filter(item => {
            // Skip null/undefined items
            if (!item) return false;

            // Skip explicit content if filter is enabled
            if (downloadQueue.isExplicitFilterEnabled() && ('explicit' in item && item.explicit === true)) {
                return false;
            }

            // Check essential parameters based on search type
            switch (type) {
                case 'track':
                    const trackItem = item as TrackResultItem;
                    return (
                        trackItem.name &&
                        trackItem.artists &&
                        trackItem.artists.length > 0 &&
                        trackItem.artists[0] &&
                        trackItem.artists[0].name &&
                        trackItem.album &&
                        trackItem.album.name &&
                        trackItem.external_urls &&
                        trackItem.external_urls.spotify
                    );

                case 'album':
                    const albumItem = item as AlbumResultItem;
                    return (
                        albumItem.name &&
                        albumItem.artists &&
                        albumItem.artists.length > 0 &&
                        albumItem.artists[0] &&
                        albumItem.artists[0].name &&
                        albumItem.external_urls &&
                        albumItem.external_urls.spotify
                    );

                case 'playlist':
                    const playlistItem = item as PlaylistResultItem;
                    return (
                        playlistItem.name &&
                        playlistItem.owner &&
                        playlistItem.owner.display_name &&
                        playlistItem.tracks &&
                        playlistItem.external_urls &&
                        playlistItem.external_urls.spotify
                    );

                case 'artist':
                    const artistItem = item as ArtistResultItem;
                    return (
                        artistItem.name &&
                        artistItem.external_urls &&
                        artistItem.external_urls.spotify
                    );

                default:
                    // Default case - just check if the item exists (already handled by `if (!item) return false;`)
                    return true;
            }
        });
    }

    /**
     * Attaches download handlers to result cards
     */
    function attachDownloadListeners(items: SearchResultItem[]) {
        document.querySelectorAll('.download-btn').forEach((btnElm) => {
            const btn = btnElm as HTMLButtonElement;
            btn.addEventListener('click', (e: Event) => {
                e.stopPropagation();

                // Get the item index from the button's dataset
                const itemIndexStr = btn.dataset.itemIndex;
                if (!itemIndexStr) return;
                const itemIndex = parseInt(itemIndexStr, 10);

                // Get the corresponding item
                const item = items[itemIndex];
                if (!item) return;

                const currentSearchType = searchType?.value || 'track';
                let itemId = item.id || ''; // Use item.id directly

                if (!itemId) { // Check if ID was found
                    showError('Could not determine download ID');
                    return;
                }

                // Prepare metadata for the download
                let metadata: DownloadQueueItem;
                if (currentSearchType === 'track') {
                    const trackItem = item as TrackResultItem;
                    metadata = {
                        name: trackItem.name || 'Unknown',
                        artist: trackItem.artists ? trackItem.artists[0]?.name : undefined,
                        album: trackItem.album ? { name: trackItem.album.name, album_type: trackItem.album.album_type } : undefined
                    };
                } else if (currentSearchType === 'album') {
                    const albumItem = item as AlbumResultItem;
                    metadata = {
                        name: albumItem.name || 'Unknown',
                        artist: albumItem.artists ? albumItem.artists[0]?.name : undefined,
                        album: { name: albumItem.name, album_type: albumItem.album_type}
                    };
                } else if (currentSearchType === 'playlist') {
                    const playlistItem = item as PlaylistResultItem;
                    metadata = {
                        name: playlistItem.name || 'Unknown',
                        // artist for playlist is owner
                        artist: playlistItem.owner?.display_name
                    };
                } else if (currentSearchType === 'artist') {
                    const artistItem = item as ArtistResultItem;
                    metadata = {
                        name: artistItem.name || 'Unknown',
                        artist: artistItem.name // For artist type, artist is the item name itself
                    };
                } else {
                    metadata = { name: item.name || 'Unknown' }; // Fallback
                }

                // Disable the button and update text
                btn.disabled = true;

                // For artist downloads, show a different message since it will queue multiple albums
                if (currentSearchType === 'artist') {
                    btn.innerHTML = 'Queueing albums...';
                } else {
                    btn.innerHTML = 'Queueing...';
                }

                // Start the download
                startDownload(itemId, currentSearchType, metadata,
                    (item as AlbumResultItem).album_type || ((item as TrackResultItem).album ? (item as TrackResultItem).album.album_type : null))
                    .then(() => {
                        // For artists, show how many albums were queued
                        if (currentSearchType === 'artist') {
                            btn.innerHTML = 'Albums queued!';
                            // Open the queue automatically for artist downloads
                            downloadQueue.toggleVisibility(true);
                        } else {
                            btn.innerHTML = 'Queued!';
                        }
                    })
                    .catch((error: any) => {
                        btn.disabled = false;
                        btn.innerHTML = 'Download';
                        showError('Failed to queue download: ' + error.message);
                    });
            });
        });
    }

    /**
     * Starts the download process via API
     */
    async function startDownload(itemId: string, type: string, item: DownloadQueueItem, albumType: string | null | undefined) {
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
            showError('Download failed: ' + (error.message || 'Unknown error'));
            throw error;
        }
    }

    /**
     * Shows an error message
     */
    function showError(message: string) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = message;
        document.body.appendChild(errorDiv);

        // Auto-remove after 5 seconds
        setTimeout(() => errorDiv.remove(), 5000);
    }

    /**
     * Shows a success message
     */
    function showSuccess(message: string) {
        const successDiv = document.createElement('div');
        successDiv.className = 'success';
        successDiv.textContent = message;
        document.body.appendChild(successDiv);

        // Auto-remove after 5 seconds
        setTimeout(() => successDiv.remove(), 5000);
    }

    /**
     * Checks if a string is a valid Spotify URL
     */
    function isSpotifyUrl(url: string): boolean {
        return url.includes('open.spotify.com') ||
               url.includes('spotify:') ||
               url.includes('link.tospotify.com');
    }

    /**
     * Extracts details from a Spotify URL
     */
    function getSpotifyResourceDetails(url: string): { type: string; id: string } | null {
        // Allow optional path segments (e.g. intl-fr) before resource type
        const regex = /spotify\.com\/(?:[^\/]+\/)??(track|album|playlist|artist)\/([a-zA-Z0-9]+)/i;
        const match = url.match(regex);

        if (match) {
            return {
                type: match[1],
                id: match[2]
            };
        }
        return null;
    }

    /**
     * Formats milliseconds to MM:SS
     */
    function msToMinutesSeconds(ms: number | undefined): string {
        if (!ms) return '0:00';

        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}:${seconds.padStart(2, '0')}`;
    }

    /**
     * Creates a result card element
     */
    function createResultCard(item: SearchResultItem, type: string, index: number): HTMLDivElement {
        const cardElement = document.createElement('div');
        cardElement.className = 'result-card';

        // Set cursor to pointer for clickable cards
        cardElement.style.cursor = 'pointer';

        // Get the appropriate image URL
        let imageUrl = '/static/images/placeholder.jpg';
        // Type guards to safely access images
        if (type === 'album' || type === 'artist') {
            const albumOrArtistItem = item as AlbumResultItem | ArtistResultItem;
            if (albumOrArtistItem.images && albumOrArtistItem.images.length > 0) {
                imageUrl = albumOrArtistItem.images[0].url;
            }
        } else if (type === 'track') {
            const trackItem = item as TrackResultItem;
            if (trackItem.album && trackItem.album.images && trackItem.album.images.length > 0) {
                imageUrl = trackItem.album.images[0].url;
            }
        } else if (type === 'playlist') {
            const playlistItem = item as PlaylistResultItem;
            if (playlistItem.images && playlistItem.images.length > 0) {
                imageUrl = playlistItem.images[0].url;
            }
        }

        // Get the appropriate details based on type
        let subtitle = '';
        let details = '';

        switch (type) {
            case 'track':
                {
                    const trackItem = item as TrackResultItem;
                    subtitle = trackItem.artists ? trackItem.artists.map((a: Artist) => a.name).join(', ') : 'Unknown Artist';
                    details = trackItem.album ? `<span>${trackItem.album.name}</span><span class="duration">${msToMinutesSeconds(trackItem.duration_ms)}</span>` : '';
                }
                break;
            case 'album':
                {
                    const albumItem = item as AlbumResultItem;
                    subtitle = albumItem.artists ? albumItem.artists.map((a: Artist) => a.name).join(', ') : 'Unknown Artist';
                    details = `<span>${albumItem.total_tracks || 0} tracks</span><span>${albumItem.release_date ? new Date(albumItem.release_date).getFullYear() : ''}</span>`;
                }
                break;
            case 'playlist':
                {
                    const playlistItem = item as PlaylistResultItem;
                    subtitle = `By ${playlistItem.owner ? playlistItem.owner.display_name : 'Unknown'}`;
                    details = `<span>${playlistItem.tracks && playlistItem.tracks.total ? playlistItem.tracks.total : 0} tracks</span>`;
                }
                break;
            case 'artist':
                {
                    const artistItem = item as ArtistResultItem;
                    subtitle = 'Artist';
                    details = artistItem.genres ? `<span>${artistItem.genres.slice(0, 2).join(', ')}</span>` : '';
                }
                break;
        }

        // Build the HTML
        cardElement.innerHTML = `
            <div class="album-art-wrapper">
                <img class="album-art" src="${imageUrl}" alt="${item.name || 'Item'}" onerror="this.src='/static/images/placeholder.jpg'">
            </div>
            <div class="track-title">${item.name || 'Unknown'}</div>
            <div class="track-artist">${subtitle}</div>
            <div class="track-details">${details}</div>
            <button class="download-btn btn-primary" data-item-index="${index}">
                <img src="/static/images/download.svg" alt="Download" />
                Download
            </button>
        `;

        // Add click event to navigate to the item's detail page
        cardElement.addEventListener('click', (e: MouseEvent) => {
            // Don't trigger if the download button was clicked
            const target = e.target as HTMLElement;
            if (target.classList.contains('download-btn') ||
                target.parentElement?.classList.contains('download-btn')) {
                return;
            }

            if (item.id) {
                window.location.href = `/${type}/${item.id}`;
            }
        });

        return cardElement;
    }

    /**
     * Show/hide the empty state
     */
    function showEmptyState(show: boolean) {
        if (emptyState) {
            emptyState.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Show/hide the loading indicator
     */
    function showLoading(show: boolean) {
        if (loadingResults) {
            loadingResults.classList.toggle('hidden', !show);
        }
    }
});
