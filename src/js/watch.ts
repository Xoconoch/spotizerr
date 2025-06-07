import { downloadQueue } from './queue.js'; // Assuming queue.js is in the same directory

// Interfaces for API data
interface Image {
  url: string;
  height?: number;
  width?: number;
}

// --- Items from the initial /watch/list API calls ---
interface ArtistFromWatchList {
  spotify_id: string; // Changed from id to spotify_id
  name: string;
  images?: Image[];
  total_albums?: number; // Already provided by /api/artist/watch/list
}

// New interface for artists after initial processing (spotify_id mapped to id)
interface ProcessedArtistFromWatchList extends ArtistFromWatchList {
  id: string; // This is the mapped spotify_id
}

interface WatchedPlaylistOwner { // Kept as is, used by PlaylistFromWatchList
  display_name?: string;
  id?: string;
}

interface PlaylistFromWatchList {
  spotify_id: string; // Changed from id to spotify_id
  name: string;
  owner?: WatchedPlaylistOwner;
  images?: Image[]; // Ensure images can be part of this initial fetch
  total_tracks?: number;
}

// New interface for playlists after initial processing (spotify_id mapped to id)
interface ProcessedPlaylistFromWatchList extends PlaylistFromWatchList {
  id: string; // This is the mapped spotify_id
}
// --- End of /watch/list items ---


// --- Responses from /api/{artist|playlist}/info endpoints ---
interface AlbumWithImages { // For items in ArtistInfoResponse.items
  images?: Image[];
  // Other album properties like name, id etc., are not strictly needed for this specific change
}

interface ArtistInfoResponse {
  artist_id: string; // Matches key from artist.py
  artist_name: string; // Matches key from artist.py
  artist_image_url?: string; // Matches key from artist.py
  total: number; // This is total_albums, matches key from artist.py
  artist_external_url?: string; // Matches key from artist.py
  items?: AlbumWithImages[]; // Add album items to get the first album's image
}

// PlaylistInfoResponse is effectively the Playlist interface from playlist.ts
// For clarity, defining it here based on what's needed for the card.
interface PlaylistInfoResponse {
  id: string;
  name: string;
  description: string | null;
  owner: { display_name?: string; id?: string; }; // Matches Playlist.owner
  images: Image[]; // Matches Playlist.images
  tracks: { total: number; /* items: PlaylistItem[] - not needed for card */ }; // Matches Playlist.tracks
  followers?: { total: number; }; // Matches Playlist.followers
  external_urls?: { spotify?: string }; // Matches Playlist.external_urls
}
// --- End of /info endpoint responses ---


// --- Final combined data structure for rendering cards ---
interface FinalArtistCardItem {
  itemType: 'artist';
  id: string;          // Spotify ID
  name: string;        // Best available name (from /info or fallback)
  imageUrl?: string;    // Best available image URL (from /info or fallback)
  total_albums: number;// From /info or fallback
  external_urls?: { spotify?: string }; // From /info
}

interface FinalPlaylistCardItem {
  itemType: 'playlist';
  id: string;          // Spotify ID
  name: string;        // Best available name (from /info or fallback)
  imageUrl?: string;    // Best available image URL (from /info or fallback)
  owner_name?: string;  // From /info or fallback
  total_tracks: number;// From /info or fallback
  followers_count?: number; // From /info
  description?: string | null; // From /info, for potential use (e.g., tooltip)
  external_urls?: { spotify?: string }; // From /info
}

type FinalCardItem = FinalArtistCardItem | FinalPlaylistCardItem;
// --- End of final card data structure ---

// The type for items initially fetched from /watch/list, before detailed processing
// Updated to use ProcessedArtistFromWatchList for artists and ProcessedPlaylistFromWatchList for playlists
type InitialWatchedItem =
  (ProcessedArtistFromWatchList & { itemType: 'artist' }) |
  (ProcessedPlaylistFromWatchList & { itemType: 'playlist' });

// Interface for a settled promise (fulfilled)
interface CustomPromiseFulfilledResult<T> {
    status: 'fulfilled';
    value: T;
}

// Interface for a settled promise (rejected)
interface CustomPromiseRejectedResult {
    status: 'rejected';
    reason: any;
}

type CustomSettledPromiseResult<T> = CustomPromiseFulfilledResult<T> | CustomPromiseRejectedResult;

// Original WatchedItem type, which will be replaced by FinalCardItem for rendering
interface WatchedArtistOriginal {
  id: string;
  name: string;
  images?: Image[];
  total_albums?: number;
}

interface WatchedPlaylistOriginal {
  id: string;
  name: string;
  owner?: WatchedPlaylistOwner;
  images?: Image[];
  total_tracks?: number;
}

type WatchedItem = (WatchedArtistOriginal & { itemType: 'artist' }) | (WatchedPlaylistOriginal & { itemType: 'playlist' });

// Added: Interface for global watch config
interface GlobalWatchConfig {
  enabled: boolean;
  [key: string]: any; // Allow other properties
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

document.addEventListener('DOMContentLoaded', async function() {
  const watchedItemsContainer = document.getElementById('watchedItemsContainer');
  const loadingIndicator = document.getElementById('loadingWatchedItems');
  const emptyStateIndicator = document.getElementById('emptyWatchedItems');
  const queueIcon = document.getElementById('queueIcon');
  const checkAllWatchedBtn = document.getElementById('checkAllWatchedBtn') as HTMLButtonElement | null;

  // Fetch global watch config first
  const globalWatchConfig = await getGlobalWatchConfig();

  if (queueIcon) {
    queueIcon.addEventListener('click', () => {
      downloadQueue.toggleVisibility();
    });
  }

  if (checkAllWatchedBtn) {
    checkAllWatchedBtn.addEventListener('click', async () => {
      checkAllWatchedBtn.disabled = true;
      const originalText = checkAllWatchedBtn.innerHTML;
      checkAllWatchedBtn.innerHTML = '<img src="/static/images/refresh-cw.svg" alt="Refreshing..."> Checking...';

      try {
        const artistCheckPromise = fetch('/api/artist/watch/trigger_check', { method: 'POST' });
        const playlistCheckPromise = fetch('/api/playlist/watch/trigger_check', { method: 'POST' });

        // Use Promise.allSettled-like behavior to handle both responses
        const results = await Promise.all([
          artistCheckPromise.then(async res => ({
            ok: res.ok,
            data: await res.json().catch(() => ({ error: 'Invalid JSON response' })),
            type: 'artist'
          })).catch(e => ({ ok: false, data: { error: e.message || 'Request failed' }, type: 'artist' })),
          playlistCheckPromise.then(async res => ({
            ok: res.ok,
            data: await res.json().catch(() => ({ error: 'Invalid JSON response' })),
            type: 'playlist'
          })).catch(e => ({ ok: false, data: { error: e.message || 'Request failed' }, type: 'playlist' }))
        ]);

        const artistResult = results.find(r => r.type === 'artist');
        const playlistResult = results.find(r => r.type === 'playlist');

        let successMessages: string[] = [];
        let errorMessages: string[] = [];

        if (artistResult) {
          if (artistResult.ok) {
            successMessages.push(artistResult.data.message || 'Artist check triggered.');
          } else {
            errorMessages.push(`Artist check failed: ${artistResult.data.error || 'Unknown error'}`);
          }
        }

        if (playlistResult) {
          if (playlistResult.ok) {
            successMessages.push(playlistResult.data.message || 'Playlist check triggered.');
          } else {
            errorMessages.push(`Playlist check failed: ${playlistResult.data.error || 'Unknown error'}`);
          }
        }

        if (errorMessages.length > 0) {
          showNotification(errorMessages.join(' '), true);
          if (successMessages.length > 0) { // If some succeeded and some failed
             // Delay the success message slightly so it doesn't overlap or get missed
            setTimeout(() => showNotification(successMessages.join(' ')), 1000);
          }
        } else if (successMessages.length > 0) {
          showNotification(successMessages.join(' '));
        } else {
          showNotification('Could not determine check status for artists or playlists.', true);
        }

      } catch (error: any) { // Catch for unexpected issues with Promise.all or setup
        console.error('Error in checkAllWatchedBtn handler:', error);
        showNotification(`An unexpected error occurred: ${error.message}`, true);
      } finally {
        checkAllWatchedBtn.disabled = false;
        checkAllWatchedBtn.innerHTML = originalText;
      }
    });
  }

  // Initial load is now conditional
  if (globalWatchConfig.enabled) {
    if (checkAllWatchedBtn) checkAllWatchedBtn.classList.remove('hidden');
    loadWatchedItems();
  } else {
    // Watch feature is disabled globally
    showLoading(false);
    showEmptyState(false);
    if (checkAllWatchedBtn) checkAllWatchedBtn.classList.add('hidden'); // Hide the button

    if (watchedItemsContainer) {
      watchedItemsContainer.innerHTML = `
        <div class="empty-state-container">
          <img src="/static/images/eye-crossed.svg" alt="Watch Disabled" class="empty-state-icon">
          <p class="empty-state-message">The Watchlist feature is currently disabled in the application settings.</p>
          <p class="empty-state-submessage">Please enable it in <a href="/settings" class="settings-link">Settings</a> to use this page.</p>
        </div>
      `;
    }
    // Ensure the main loading indicator is also hidden if it was shown by default
    if (loadingIndicator) loadingIndicator.classList.add('hidden');
  }
});

const MAX_NOTIFICATIONS = 3;

async function loadWatchedItems() {
  const watchedItemsContainer = document.getElementById('watchedItemsContainer');
  const loadingIndicator = document.getElementById('loadingWatchedItems');
  const emptyStateIndicator = document.getElementById('emptyWatchedItems');

  showLoading(true);
  showEmptyState(false);
  if (watchedItemsContainer) watchedItemsContainer.innerHTML = '';

  try {
    const [artistsResponse, playlistsResponse] = await Promise.all([
      fetch('/api/artist/watch/list'),
      fetch('/api/playlist/watch/list')
    ]);

    if (!artistsResponse.ok || !playlistsResponse.ok) {
      throw new Error('Failed to load initial watched items list');
    }

    const artists: ArtistFromWatchList[] = await artistsResponse.json();
    const playlists: PlaylistFromWatchList[] = await playlistsResponse.json();

    const initialItems: InitialWatchedItem[] = [
      ...artists.map(artist => ({
        ...artist,
        id: artist.spotify_id, // Map spotify_id to id for artists
        itemType: 'artist' as const
      })),
      ...playlists.map(playlist => ({
        ...playlist,
        id: playlist.spotify_id, // Map spotify_id to id for playlists
        itemType: 'playlist' as const
      }))
    ];

    if (initialItems.length === 0) {
      showLoading(false);
      showEmptyState(true);
      return;
    }

    // Fetch detailed info for each item
    const detailedItemPromises = initialItems.map(async (initialItem) => {
      try {
        if (initialItem.itemType === 'artist') {
          const infoResponse = await fetch(`/api/artist/info?id=${initialItem.id}`);
          if (!infoResponse.ok) {
            console.warn(`Failed to fetch artist info for ${initialItem.name} (ID: ${initialItem.id}): ${infoResponse.status}`);
            // Fallback to initial data if info fetch fails
            return {
              itemType: 'artist',
              id: initialItem.id,
              name: initialItem.name,
              imageUrl: (initialItem as ArtistFromWatchList).images?.[0]?.url, // Cast to access images
              total_albums: (initialItem as ArtistFromWatchList).total_albums || 0, // Cast to access total_albums
            } as FinalArtistCardItem;
          }
          const info: ArtistInfoResponse = await infoResponse.json();
          return {
            itemType: 'artist',
            id: initialItem.id, // Use the ID from the watch list, as /info might have 'artist_id'
            name: info.artist_name || initialItem.name, // Prefer info, fallback to initial
            imageUrl: info.items?.[0]?.images?.[0]?.url || info.artist_image_url || (initialItem as ProcessedArtistFromWatchList).images?.[0]?.url, // Prioritize first album image from items
            total_albums: info.total, // 'total' from ArtistInfoResponse is total_albums
            external_urls: { spotify: info.artist_external_url }
          } as FinalArtistCardItem;
        } else { // Playlist
          const infoResponse = await fetch(`/api/playlist/info?id=${initialItem.id}`);
          if (!infoResponse.ok) {
            console.warn(`Failed to fetch playlist info for ${initialItem.name} (ID: ${initialItem.id}): ${infoResponse.status}`);
            // Fallback to initial data if info fetch fails
            return {
              itemType: 'playlist',
              id: initialItem.id,
              name: initialItem.name,
              imageUrl: (initialItem as ProcessedPlaylistFromWatchList).images?.[0]?.url, // Cast to access images
              owner_name: (initialItem as ProcessedPlaylistFromWatchList).owner?.display_name, // Cast to access owner
              total_tracks: (initialItem as ProcessedPlaylistFromWatchList).total_tracks || 0, // Cast to access total_tracks
            } as FinalPlaylistCardItem;
          }
          const info: PlaylistInfoResponse = await infoResponse.json();
          return {
            itemType: 'playlist',
            id: initialItem.id, // Use ID from watch list
            name: info.name || initialItem.name, // Prefer info, fallback to initial
            imageUrl: info.images?.[0]?.url || (initialItem as ProcessedPlaylistFromWatchList).images?.[0]?.url, // Prefer info, fallback to initial (ProcessedPlaylistFromWatchList)
            owner_name: info.owner?.display_name || (initialItem as ProcessedPlaylistFromWatchList).owner?.display_name, // Prefer info, fallback to initial (ProcessedPlaylistFromWatchList)
            total_tracks: info.tracks.total, // 'total' from PlaylistInfoResponse.tracks
            followers_count: info.followers?.total,
            description: info.description,
            external_urls: info.external_urls
          } as FinalPlaylistCardItem;
        }
      } catch (e: any) {
        console.error(`Error processing item ${initialItem.name} (ID: ${initialItem.id}):`, e);
        // Return a fallback structure if processing fails catastrophically
        return {
          itemType: initialItem.itemType,
          id: initialItem.id,
          name: initialItem.name + " (Error loading details)",
          imageUrl: initialItem.images?.[0]?.url,
          // Add minimal common fields for artists and playlists for fallback
          ...(initialItem.itemType === 'artist' ? { total_albums: (initialItem as ProcessedArtistFromWatchList).total_albums || 0 } : {}),
          ...(initialItem.itemType === 'playlist' ? { total_tracks: (initialItem as ProcessedPlaylistFromWatchList).total_tracks || 0 } : {}),
        } as FinalCardItem; // Cast to avoid TS errors, knowing one of the spreads will match
      }
    });

    // Simulating Promise.allSettled behavior for compatibility
    const settledResults: CustomSettledPromiseResult<FinalCardItem>[] = await Promise.all(
      detailedItemPromises.map(p =>
        p.then(value => ({ status: 'fulfilled', value } as CustomPromiseFulfilledResult<FinalCardItem>))
         .catch(reason => ({ status: 'rejected', reason } as CustomPromiseRejectedResult))
      )
    );

    const finalItems: FinalCardItem[] = settledResults
      .filter((result): result is CustomPromiseFulfilledResult<FinalCardItem> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter(item => item !== null) as FinalCardItem[]; // Ensure no nulls from catastrophic failures

    showLoading(false);

    if (finalItems.length === 0) {
      showEmptyState(true);
      // Potentially show a different message if initialItems existed but all failed to load details
      if (initialItems.length > 0 && watchedItemsContainer) {
          watchedItemsContainer.innerHTML = `<div class="error"><p>Could not load details for any watched items. Please check the console for errors.</p></div>`;
      }
      return;
    }

    if (watchedItemsContainer) {
      // Clear previous content
      watchedItemsContainer.innerHTML = '';

      if (finalItems.length > 8) {
        const playlistItems = finalItems.filter(item => item.itemType === 'playlist') as FinalPlaylistCardItem[];
        const artistItems = finalItems.filter(item => item.itemType === 'artist') as FinalArtistCardItem[];

        // Create and append Playlist section
        if (playlistItems.length > 0) {
          const playlistSection = document.createElement('div');
          playlistSection.className = 'watched-items-group';
          const playlistHeader = document.createElement('h2');
          playlistHeader.className = 'watched-group-header';
          playlistHeader.textContent = 'Watched Playlists';
          playlistSection.appendChild(playlistHeader);
          const playlistGrid = document.createElement('div');
          playlistGrid.className = 'results-grid'; // Use existing grid style
          playlistItems.forEach(item => {
            const cardElement = createWatchedItemCard(item);
            playlistGrid.appendChild(cardElement);
          });
          playlistSection.appendChild(playlistGrid);
          watchedItemsContainer.appendChild(playlistSection);
        } else {
          const noPlaylistsMessage = document.createElement('p');
          noPlaylistsMessage.textContent = 'No watched playlists.';
          noPlaylistsMessage.className = 'empty-group-message';
          // Optionally add a header for consistency even if empty
          const playlistHeader = document.createElement('h2');
          playlistHeader.className = 'watched-group-header';
          playlistHeader.textContent = 'Watched Playlists';
          watchedItemsContainer.appendChild(playlistHeader);
          watchedItemsContainer.appendChild(noPlaylistsMessage);
        }

        // Create and append Artist section
        if (artistItems.length > 0) {
          const artistSection = document.createElement('div');
          artistSection.className = 'watched-items-group';
          const artistHeader = document.createElement('h2');
          artistHeader.className = 'watched-group-header';
          artistHeader.textContent = 'Watched Artists';
          artistSection.appendChild(artistHeader);
          const artistGrid = document.createElement('div');
          artistGrid.className = 'results-grid'; // Use existing grid style
          artistItems.forEach(item => {
            const cardElement = createWatchedItemCard(item);
            artistGrid.appendChild(cardElement);
          });
          artistSection.appendChild(artistGrid);
          watchedItemsContainer.appendChild(artistSection);
        } else {
          const noArtistsMessage = document.createElement('p');
          noArtistsMessage.textContent = 'No watched artists.';
          noArtistsMessage.className = 'empty-group-message';
           // Optionally add a header for consistency even if empty
          const artistHeader = document.createElement('h2');
          artistHeader.className = 'watched-group-header';
          artistHeader.textContent = 'Watched Artists';
          watchedItemsContainer.appendChild(artistHeader);
          watchedItemsContainer.appendChild(noArtistsMessage);
        }

      } else { // 8 or fewer items, render them directly
        finalItems.forEach(item => {
        const cardElement = createWatchedItemCard(item);
        watchedItemsContainer.appendChild(cardElement);
      });
      }
    }

  } catch (error: any) {
    console.error('Error loading watched items:', error);
    showLoading(false);
    if (watchedItemsContainer) {
      watchedItemsContainer.innerHTML = `<div class="error"><p>Error loading watched items: ${error.message}</p></div>`;
    }
  }
}

function createWatchedItemCard(item: FinalCardItem): HTMLDivElement {
  const cardElement = document.createElement('div');
  cardElement.className = 'watched-item-card';
  cardElement.dataset.itemId = item.id;
  cardElement.dataset.itemType = item.itemType;

  // Check Now button HTML is no longer generated separately here for absolute positioning

  let imageUrl = '/static/images/placeholder.jpg';
  if (item.imageUrl) {
    imageUrl = item.imageUrl;
  }

  let detailsHtml = '';
  let typeBadgeClass = '';
  let typeName = '';

  if (item.itemType === 'artist') {
    typeName = 'Artist';
    typeBadgeClass = 'artist';
    const artist = item as FinalArtistCardItem;
    detailsHtml = artist.total_albums !== undefined ? `<span>${artist.total_albums} albums</span>` : '';
  } else if (item.itemType === 'playlist') {
    typeName = 'Playlist';
    typeBadgeClass = 'playlist';
    const playlist = item as FinalPlaylistCardItem;
    detailsHtml = playlist.owner_name ? `<span>By: ${playlist.owner_name}</span>` : '';
    detailsHtml += playlist.total_tracks !== undefined ? `<span> • ${playlist.total_tracks} tracks</span>` : '';
    if (playlist.followers_count !== undefined) {
      detailsHtml += `<span> • ${playlist.followers_count} followers</span>`;
    }
  }

  cardElement.innerHTML = `
    <div class="item-art-wrapper">
      <img class="item-art" src="${imageUrl}" alt="${item.name}" onerror="handleImageError(this)">
    </div>
    <div class="item-name">${item.name}</div>
    <div class="item-details">${detailsHtml}</div>
    <span class="item-type-badge ${typeBadgeClass}">${typeName}</span>
    <div class="item-actions">
      <button class="btn-icon unwatch-item-btn" data-id="${item.id}" data-type="${item.itemType}" title="Unwatch">
        <img src="/static/images/eye-crossed.svg" alt="Unwatch">
      </button>
      <button class="btn-icon check-item-now-btn" data-id="${item.id}" data-type="${item.itemType}" title="Check Now">
        <img src="/static/images/refresh.svg" alt="Check">
      </button>
    </div>
  `;

  // Add click event to navigate to the item's detail page
  cardElement.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't navigate if any button within the card was clicked
      if (target.closest('button')) {
          return;
      }
      window.location.href = `/${item.itemType}/${item.id}`;
  });

  // Add event listener for the "Check Now" button
  const checkNowBtn = cardElement.querySelector('.check-item-now-btn') as HTMLButtonElement | null;
  if (checkNowBtn) {
      checkNowBtn.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          const itemId = checkNowBtn.dataset.id;
          const itemType = checkNowBtn.dataset.type as 'artist' | 'playlist';
          if (itemId && itemType) {
              triggerItemCheck(itemId, itemType, checkNowBtn);
          }
      });
  }

  // Add event listener for the "Unwatch" button
  const unwatchBtn = cardElement.querySelector('.unwatch-item-btn') as HTMLButtonElement | null;
  if (unwatchBtn) {
      unwatchBtn.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          const itemId = unwatchBtn.dataset.id;
          const itemType = unwatchBtn.dataset.type as 'artist' | 'playlist';
          if (itemId && itemType) {
              unwatchItem(itemId, itemType, unwatchBtn, cardElement);
          }
      });
  }

  return cardElement;
}

function showLoading(show: boolean) {
  const loadingIndicator = document.getElementById('loadingWatchedItems');
  if (loadingIndicator) loadingIndicator.classList.toggle('hidden', !show);
}

function showEmptyState(show: boolean) {
  const emptyStateIndicator = document.getElementById('emptyWatchedItems');
  if (emptyStateIndicator) emptyStateIndicator.classList.toggle('hidden', !show);
}

async function unwatchItem(itemId: string, itemType: 'artist' | 'playlist', buttonElement: HTMLButtonElement, cardElement: HTMLElement) {
  const originalButtonContent = buttonElement.innerHTML;
  buttonElement.disabled = true;
  buttonElement.innerHTML = '<img src="/static/images/refresh.svg" class="spin-counter-clockwise" alt="Unwatching...">'; // Assuming a small loader icon

  const endpoint = `/api/${itemType}/watch/${itemId}`;

  try {
    const response = await fetch(endpoint, { method: 'DELETE' });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }
    const result = await response.json();
    showNotification(result.message || `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} unwatched successfully.`);

    cardElement.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    cardElement.style.opacity = '0';
    cardElement.style.transform = 'scale(0.9)';
    setTimeout(() => {
        cardElement.remove();
        const watchedItemsContainer = document.getElementById('watchedItemsContainer');
        const playlistGroups = document.querySelectorAll('.watched-items-group .results-grid');
        let totalItemsLeft = 0;

        if (playlistGroups.length > 0) { // Grouped view
            playlistGroups.forEach(group => {
                totalItemsLeft += group.childElementCount;
            });
            // If a group becomes empty, we might want to remove the group header or show an empty message for that group.
            // This can be added here if desired.
        } else if (watchedItemsContainer) { // Non-grouped view
            totalItemsLeft = watchedItemsContainer.childElementCount;
        }

        if (totalItemsLeft === 0) {
            // If all items are gone (either from groups or directly), reload to show empty state.
            // This also correctly handles the case where the initial list had <= 8 items.
            loadWatchedItems();
        }

    }, 500);

  } catch (error: any) {
    console.error(`Error unwatching ${itemType}:`, error);
    showNotification(`Failed to unwatch: ${error.message}`, true);
    buttonElement.disabled = false;
    buttonElement.innerHTML = originalButtonContent;
  }
}

async function triggerItemCheck(itemId: string, itemType: 'artist' | 'playlist', buttonElement: HTMLButtonElement) {
  const originalButtonContent = buttonElement.innerHTML; // Will just be the img
  buttonElement.disabled = true;
  // Keep the icon, but we can add a class for spinning or use the same icon.
  // For simplicity, just using the same icon. Text "Checking..." is removed.
  buttonElement.innerHTML = '<img src="/static/images/refresh.svg" alt="Checking...">';

  const endpoint = `/api/${itemType}/watch/trigger_check/${itemId}`;

  try {
    const response = await fetch(endpoint, { method: 'POST' });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})); // Handle non-JSON error responses
      throw new Error(errorData.error || `Server error: ${response.status}`);
    }
    const result = await response.json();
    showNotification(result.message || `Successfully triggered check for ${itemType}.`);
  } catch (error: any) {
    console.error(`Error triggering ${itemType} check:`, error);
    showNotification(`Failed to trigger check: ${error.message}`, true);
  } finally {
    buttonElement.disabled = false;
    buttonElement.innerHTML = originalButtonContent;
  }
}

// Helper function to show notifications (can be moved to a shared utility file if used elsewhere)
function showNotification(message: string, isError: boolean = false) {
  const notificationArea = document.getElementById('notificationArea') || createNotificationArea();

  // Limit the number of visible notifications
  while (notificationArea.childElementCount >= MAX_NOTIFICATIONS) {
    const oldestNotification = notificationArea.firstChild; // In column-reverse, firstChild is visually the bottom one
    if (oldestNotification) {
      oldestNotification.remove();
    } else {
      break; // Should not happen if childElementCount > 0
    }
  }

  const notification = document.createElement('div');
  notification.className = `notification-toast ${isError ? 'error' : 'success'}`;
  notification.textContent = message;

  notificationArea.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    notification.classList.add('hide');
    setTimeout(() => notification.remove(), 500); // Remove from DOM after fade out
  }, 5000);
}

function createNotificationArea(): HTMLElement {
  const area = document.createElement('div');
  area.id = 'notificationArea';
  document.body.appendChild(area);
  return area;
}