import { downloadQueue } from './queue.js';

// Updated Interfaces for validator data
interface SpotifyFormData {
  accountName: string;      // Formerly username, maps to 'name' in backend
  authBlob: string;         // Formerly credentials, maps to 'blob_content' in backend
  accountRegion?: string;   // Maps to 'region' in backend
}

interface DeezerFormData {
  accountName: string;      // Maps to 'name' in backend
  arl: string;
  accountRegion?: string;   // Maps to 'region' in backend
}

// Global service configuration object
const serviceConfig: Record<string, any> = {
  spotify: {
    fields: [
      { id: 'accountName', label: 'Account Name', type: 'text' },
      { id: 'accountRegion', label: 'Region (ISO 3166-1 alpha-2)', type: 'text', placeholder: 'E.g., US, DE, GB (Optional)'},
      { id: 'authBlob', label: 'Auth Blob (JSON content)', type: 'textarea', rows: 5 }
    ],
    validator: (data: SpotifyFormData) => ({
      name: data.accountName,
      region: data.accountRegion || null, // Send null if empty, backend might have default
      blob_content: data.authBlob
    }),
  },
  deezer: {
    fields: [
      { id: 'accountName', label: 'Account Name', type: 'text' },
      { id: 'accountRegion', label: 'Region (ISO 3166-1 alpha-2)', type: 'text', placeholder: 'E.g., US, DE, FR (Optional)'},
      { id: 'arl', label: 'ARL Token', type: 'text' }
    ],
    validator: (data: DeezerFormData) => ({
      name: data.accountName,
      region: data.accountRegion || null, // Send null if empty
      arl: data.arl
    })
  }
};

let currentService = 'spotify';
let currentCredential: string | null = null;
let isEditingSearch = false;

// Global variables to hold the active accounts from the config response.
let activeSpotifyAccount = '';
let activeDeezerAccount = '';

// Define available formats and their bitrates
const CONVERSION_FORMATS: Record<string, string[]> = {
  MP3: ['32k', '64k', '96k', '128k', '192k', '256k', '320k'],
  AAC: ['32k', '64k', '96k', '128k', '192k', '256k'],
  OGG: ['64k', '96k', '128k', '192k', '256k', '320k'],
  OPUS: ['32k', '64k', '96k', '128k', '192k', '256k'],
  FLAC: [], // No specific bitrates
  WAV: [],  // No specific bitrates
  ALAC: []  // No specific bitrates
};

// Reference to the credentials form card and add button
let credentialsFormCard: HTMLElement | null = null;
let showAddAccountFormBtn: HTMLElement | null = null;
let cancelAddAccountBtn: HTMLElement | null = null;

// Hint element references
let spotifyRegionHint: HTMLElement | null = null;
let deezerRegionHint: HTMLElement | null = null;

// Ensure this is defined, typically at the top with other DOM element getters if used frequently
let spotifyApiConfigStatusDiv: HTMLElement | null = null;

// Helper function to manage visibility of form and add button
function setFormVisibility(showForm: boolean) {
  if (credentialsFormCard && showAddAccountFormBtn) {
    credentialsFormCard.style.display = showForm ? 'block' : 'none';
    showAddAccountFormBtn.style.display = showForm ? 'none' : 'flex'; // Assuming flex for styled button
    if (showForm) {
      resetForm(); // Reset form to "add new" state when showing for add
      const credentialNameInput = document.getElementById('credentialName') as HTMLInputElement | null;
      if(credentialNameInput) credentialNameInput.focus();
    }
  }
}

async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Failed to load config');

    const savedConfig = await response.json();

    // Set default service selection
    const defaultServiceSelect = document.getElementById('defaultServiceSelect') as HTMLSelectElement | null;
    if (defaultServiceSelect) defaultServiceSelect.value = savedConfig.service || 'spotify';

    // Update the service-specific options based on selected service
    updateServiceSpecificOptions();

    // Use the "spotify" and "deezer" properties from the API response to set the active accounts.
    activeSpotifyAccount = savedConfig.spotify || '';
    activeDeezerAccount = savedConfig.deezer || '';

    // (Optionally, if the account selects already exist you can set their values here,
    // but updateAccountSelectors() will rebuild the options and set the proper values.)
    const spotifySelect = document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null;
    const deezerSelect = document.getElementById('deezerAccountSelect') as HTMLSelectElement | null;
    const spotifyMessage = document.getElementById('spotifyAccountMessage') as HTMLElement | null;
    const deezerMessage = document.getElementById('deezerAccountMessage') as HTMLElement | null;
    if (spotifySelect) spotifySelect.value = activeSpotifyAccount;
    if (deezerSelect) deezerSelect.value = activeDeezerAccount;

    // Update other configuration fields.
    const fallbackToggle = document.getElementById('fallbackToggle') as HTMLInputElement | null;
    if (fallbackToggle) fallbackToggle.checked = !!savedConfig.fallback;
    const spotifyQualitySelect = document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null;
    if (spotifyQualitySelect) spotifyQualitySelect.value = savedConfig.spotifyQuality || 'NORMAL';
    const deezerQualitySelect = document.getElementById('deezerQualitySelect') as HTMLSelectElement | null;
    if (deezerQualitySelect) deezerQualitySelect.value = savedConfig.deezerQuality || 'MP3_128';
    const realTimeToggle = document.getElementById('realTimeToggle') as HTMLInputElement | null;
    if (realTimeToggle) realTimeToggle.checked = !!savedConfig.realTime;
    const customDirFormat = document.getElementById('customDirFormat') as HTMLInputElement | null;
    if (customDirFormat) customDirFormat.value = savedConfig.customDirFormat || '%ar_album%/%album%';
    const customTrackFormat = document.getElementById('customTrackFormat') as HTMLInputElement | null;
    if (customTrackFormat) customTrackFormat.value = savedConfig.customTrackFormat || '%tracknum%. %music%';
    const maxConcurrentDownloads = document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null;
    if (maxConcurrentDownloads) maxConcurrentDownloads.value = savedConfig.maxConcurrentDownloads || '3';
    const maxRetries = document.getElementById('maxRetries') as HTMLInputElement | null;
    if (maxRetries) maxRetries.value = savedConfig.maxRetries || '3';
    const retryDelaySeconds = document.getElementById('retryDelaySeconds') as HTMLInputElement | null;
    if (retryDelaySeconds) retryDelaySeconds.value = savedConfig.retryDelaySeconds || '5';
    const retryDelayIncrease = document.getElementById('retryDelayIncrease') as HTMLInputElement | null;
    if (retryDelayIncrease) retryDelayIncrease.value = savedConfig.retry_delay_increase || '5';
    const tracknumPaddingToggle = document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null;
    if (tracknumPaddingToggle) tracknumPaddingToggle.checked = savedConfig.tracknum_padding === undefined ? true : !!savedConfig.tracknum_padding;
    const saveCoverToggle = document.getElementById('saveCoverToggle') as HTMLInputElement | null;
    if (saveCoverToggle) saveCoverToggle.checked = savedConfig.save_cover === undefined ? true : !!savedConfig.save_cover;

    // Load conversion settings
    const convertToSelect = document.getElementById('convertToSelect') as HTMLSelectElement | null;
    if (convertToSelect) {
      convertToSelect.value = savedConfig.convertTo || '';
      updateBitrateOptions(convertToSelect.value);
    }
    const bitrateSelect = document.getElementById('bitrateSelect') as HTMLSelectElement | null;
    if (bitrateSelect && savedConfig.bitrate) {
      if (Array.from(bitrateSelect.options).some(option => option.value === savedConfig.bitrate)) {
          bitrateSelect.value = savedConfig.bitrate;
      }
    } else if (bitrateSelect) {
        if (convertToSelect && !CONVERSION_FORMATS[convertToSelect.value]?.length) {
            bitrateSelect.value = '';
        }
    }

    // Update explicit filter status
    updateExplicitFilterStatus(savedConfig.explicitFilter);

    // Load watch config
    await loadWatchConfig();
  } catch (error: any) {
    showConfigError('Error loading config: ' + error.message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initConfig();
    setupServiceTabs();
    setupEventListeners();

    // Setup for the collapsable "Add Account" form
    credentialsFormCard = document.querySelector('.credentials-form.card');
    showAddAccountFormBtn = document.getElementById('showAddAccountFormBtn');
    cancelAddAccountBtn = document.getElementById('cancelAddAccountBtn');

    // Get hint elements
    spotifyRegionHint = document.getElementById('spotifyRegionHint');
    deezerRegionHint = document.getElementById('deezerRegionHint');

    if (credentialsFormCard && showAddAccountFormBtn) {
      // Initially hide form, show add button (default state handled by setFormVisibility if called)
      credentialsFormCard.style.display = 'none';
      showAddAccountFormBtn.style.display = 'flex'; // Assuming styled button uses flex
    }

    if (showAddAccountFormBtn) {
      showAddAccountFormBtn.addEventListener('click', () => {
        setFormVisibility(true);
      });
    }

    if (cancelAddAccountBtn && credentialsFormCard && showAddAccountFormBtn) {
      cancelAddAccountBtn.addEventListener('click', () => {
        setFormVisibility(false);
        resetForm(); // Also reset form state on cancel
      });
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
                  console.error('Failed to fetch watch config for config page, defaulting to hidden');
                  // Don't update cache on error
                  watchlistButton.classList.add('hidden'); // Hide if config fetch fails
              }
          } catch (error) {
              console.error('Error fetching watch config for config page:', error);
              // Don't update cache on error
              watchlistButton.classList.add('hidden'); // Hide on error
          }
      }
    }
    updateWatchlistButtonVisibility();

  } catch (error: any) {
    showConfigError(error.message);
  }
});

async function initConfig() {
  await loadConfig();
  await updateAccountSelectors();
  loadCredentials(currentService);
  updateFormFields();
  await loadSpotifyApiConfig();
}

function setupServiceTabs() {
  const serviceTabs = document.querySelectorAll('.tab-button');
  serviceTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      serviceTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentService = (tab as HTMLElement).dataset.service || 'spotify';
      loadCredentials(currentService);
      updateFormFields();
    });
  });
}

function setupEventListeners() {
  (document.getElementById('credentialForm') as HTMLFormElement | null)?.addEventListener('submit', handleCredentialSubmit);
  (document.getElementById('saveSpotifyApiConfigBtn') as HTMLButtonElement | null)?.addEventListener('click', saveSpotifyApiConfig);

  // Config change listeners
  (document.getElementById('defaultServiceSelect') as HTMLSelectElement | null)?.addEventListener('change', function() {
    updateServiceSpecificOptions();
    saveConfig();
  });
  (document.getElementById('fallbackToggle') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('realTimeToggle') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('deezerQualitySelect') as HTMLSelectElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('saveCoverToggle') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('maxRetries') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('retryDelaySeconds') as HTMLInputElement | null)?.addEventListener('change', saveConfig);

  // Conversion settings listeners
  (document.getElementById('convertToSelect') as HTMLSelectElement | null)?.addEventListener('change', function() {
    updateBitrateOptions(this.value);
    saveConfig();
  });
  (document.getElementById('bitrateSelect') as HTMLSelectElement | null)?.addEventListener('change', saveConfig);

  // Update active account globals when the account selector is changed.
  (document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null)?.addEventListener('change', (e: Event) => {
    activeSpotifyAccount = (e.target as HTMLSelectElement).value;
    saveConfig();
  });
  (document.getElementById('deezerAccountSelect') as HTMLSelectElement | null)?.addEventListener('change', (e: Event) => {
    activeDeezerAccount = (e.target as HTMLSelectElement).value;
    saveConfig();
  });

  // Formatting settings
  (document.getElementById('customDirFormat') as HTMLInputElement | null)?.addEventListener('change', saveConfig);
  (document.getElementById('customTrackFormat') as HTMLInputElement | null)?.addEventListener('change', saveConfig);

  // Copy to clipboard when selecting placeholders
  (document.getElementById('dirFormatHelp') as HTMLSelectElement | null)?.addEventListener('change', function() {
    copyPlaceholderToClipboard(this as HTMLSelectElement);
  });
  (document.getElementById('trackFormatHelp') as HTMLSelectElement | null)?.addEventListener('change', function() {
    copyPlaceholderToClipboard(this as HTMLSelectElement);
  });

  // Max concurrent downloads change listener
  (document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null)?.addEventListener('change', saveConfig);

  // Watch options listeners
  document.querySelectorAll('#watchedArtistAlbumGroupChecklist input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', saveWatchConfig);
  });
  (document.getElementById('watchPollIntervalSeconds') as HTMLInputElement | null)?.addEventListener('change', saveWatchConfig);
  (document.getElementById('watchEnabledToggle') as HTMLInputElement | null)?.addEventListener('change', () => {
    const isEnabling = (document.getElementById('watchEnabledToggle') as HTMLInputElement)?.checked;
    const alreadyShownFirstEnableNotice = localStorage.getItem('watchFeatureFirstEnableNoticeShown');

    if (isEnabling && !alreadyShownFirstEnableNotice) {
        const noticeDiv = document.getElementById('watchFeatureFirstEnableNotice');
        if (noticeDiv) noticeDiv.style.display = 'block';
        localStorage.setItem('watchFeatureFirstEnableNoticeShown', 'true');
        // Hide notice after a delay or on click if preferred
        setTimeout(() => {
            if (noticeDiv) noticeDiv.style.display = 'none';
        }, 15000); // Hide after 15 seconds
    } else {
        // If disabling, or if notice was already shown, ensure it's hidden
        const noticeDiv = document.getElementById('watchFeatureFirstEnableNotice');
        if (noticeDiv) noticeDiv.style.display = 'none';
    }
    saveWatchConfig();
    updateWatchWarningDisplay(); // Call this also when the watch enable toggle changes
  });
  (document.getElementById('realTimeToggle') as HTMLInputElement | null)?.addEventListener('change', () => {
    saveConfig();
    updateWatchWarningDisplay(); // Call this when realTimeToggle changes
  });
}

function updateServiceSpecificOptions() {
  // Get the selected service
  const selectedService = (document.getElementById('defaultServiceSelect') as HTMLSelectElement | null)?.value;

  // Handle Spotify specific options
  if (selectedService === 'spotify') {
    // Highlight Spotify section
    (document.getElementById('spotifyQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');
    (document.getElementById('spotifyAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');

    // Remove highlight from Deezer
    (document.getElementById('deezerQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
    (document.getElementById('deezerAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
  }
  // Handle Deezer specific options
  else if (selectedService === 'deezer') {
    // Highlight Deezer section
    (document.getElementById('deezerQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');
    (document.getElementById('deezerAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.add('highlighted-option');

    // Remove highlight from Spotify
    (document.getElementById('spotifyQualitySelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
    (document.getElementById('spotifyAccountSelect') as HTMLElement | null)?.closest('.config-item')?.classList.remove('highlighted-option');
  }
}

async function updateAccountSelectors() {
  try {
    const [spotifyResponse, deezerResponse] = await Promise.all([
      fetch('/api/credentials/spotify'),
      fetch('/api/credentials/deezer')
    ]);

    const spotifyAccounts = await spotifyResponse.json();
    const deezerAccounts = await deezerResponse.json();

    // Get the select elements
    const spotifySelect = document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null;
    const deezerSelect = document.getElementById('deezerAccountSelect') as HTMLSelectElement | null;
    const spotifyMessage = document.getElementById('spotifyAccountMessage') as HTMLElement | null;
    const deezerMessage = document.getElementById('deezerAccountMessage') as HTMLElement | null;

    // Rebuild the Spotify selector options
    if (spotifySelect && spotifyMessage) {
        if (spotifyAccounts.length > 0) {
            spotifySelect.innerHTML = spotifyAccounts
              .map((a: string) => `<option value="${a}">${a}</option>`)
              .join('');
            spotifySelect.style.display = '';
            spotifyMessage.style.display = 'none';

            // Use the active account loaded from the config (activeSpotifyAccount)
            if (activeSpotifyAccount && spotifyAccounts.includes(activeSpotifyAccount)) {
                spotifySelect.value = activeSpotifyAccount;
            } else {
                spotifySelect.value = spotifyAccounts[0];
                activeSpotifyAccount = spotifyAccounts[0];
                await saveConfig(); // Save if we defaulted
            }
        } else {
            spotifySelect.innerHTML = '';
            spotifySelect.style.display = 'none';
            spotifyMessage.textContent = 'No Spotify accounts available.';
            spotifyMessage.style.display = '';
            if (activeSpotifyAccount !== '') { // Clear active account if it was set
                activeSpotifyAccount = '';
                await saveConfig();
            }
        }
    }

    // Rebuild the Deezer selector options
    if (deezerSelect && deezerMessage) {
        if (deezerAccounts.length > 0) {
            deezerSelect.innerHTML = deezerAccounts
              .map((a: string) => `<option value="${a}">${a}</option>`)
              .join('');
            deezerSelect.style.display = '';
            deezerMessage.style.display = 'none';

            if (activeDeezerAccount && deezerAccounts.includes(activeDeezerAccount)) {
                deezerSelect.value = activeDeezerAccount;
            } else {
                deezerSelect.value = deezerAccounts[0];
                activeDeezerAccount = deezerAccounts[0];
                await saveConfig(); // Save if we defaulted
            }
        } else {
            deezerSelect.innerHTML = '';
            deezerSelect.style.display = 'none';
            deezerMessage.textContent = 'No Deezer accounts available.';
            deezerMessage.style.display = '';
            if (activeDeezerAccount !== '') { // Clear active account if it was set
                activeDeezerAccount = '';
                await saveConfig();
            }
        }
    }
  } catch (error: any) {
    showConfigError('Error updating accounts: ' + error.message);
  }
}

async function loadCredentials(service: string) {
  try {
    const response = await fetch(`/api/credentials/all/${service}`);
    if (!response.ok) {
      throw new Error(`Failed to load credentials: ${response.statusText}`);
    }

    const credentials = await response.json();
    renderCredentialsList(service, credentials);
  } catch (error: any) {
    showConfigError(error.message);
  }
}

function renderCredentialsList(service: string, credentials: any[]) {
  const list = document.querySelector('.credentials-list-items') as HTMLElement | null;
  if (!list) return;
  list.innerHTML = '';

  if (!credentials.length) {
    list.innerHTML = '<div class="no-credentials">No accounts found. Add a new account below.</div>';
    return;
  }

  credentials.forEach(credData => {
    const credItem = document.createElement('div');
    credItem.className = 'credential-item';

    credItem.innerHTML = `
      <div class="credential-info">
        <span class="credential-name">${credData.name}</span>
      </div>
      <div class="credential-actions">
        <button class="edit-btn" data-name="${credData.name}" data-service="${service}">Edit Account</button>
        <button class="delete-btn" data-name="${credData.name}" data-service="${service}">Delete</button>
      </div>
    `;

    list.appendChild(credItem);
  });

  // Set up event handlers
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteCredential as EventListener);
  });

  list.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      isEditingSearch = false;
      handleEditCredential(e as MouseEvent);
    });
  });
}

async function handleDeleteCredential(e: Event) {
  try {
    const target = e.target as HTMLElement;
    const service = target.dataset.service;
    const name = target.dataset.name;

    if (!service || !name) {
      throw new Error('Missing credential information');
    }

    if (!confirm(`Are you sure you want to delete the ${name} account?`)) {
      return;
    }

    const response = await fetch(`/api/credentials/${service}/${name}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete credential');
    }

    // If the deleted credential is the active account, clear the selection.
    const accountSelect = document.getElementById(`${service}AccountSelect`) as HTMLSelectElement | null;
    if (accountSelect && accountSelect.value === name) {
      accountSelect.value = '';
      if (service === 'spotify') {
        activeSpotifyAccount = '';
      } else if (service === 'deezer') {
        activeDeezerAccount = '';
      }
      await saveConfig();
    }

    loadCredentials(service);
    await updateAccountSelectors();
  } catch (error: any) {
    showConfigError(error.message);
  }
}

async function handleEditCredential(e: MouseEvent) {
  const target = e.target as HTMLElement;
  const service = target.dataset.service;
  const name = target.dataset.name; // This is the name of the credential being edited

  try {
    (document.querySelector(`[data-service="${service}"]`) as HTMLElement | null)?.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    setFormVisibility(true);

    const response = await fetch(`/api/credentials/${service}/${name}`);
    if (!response.ok) {
      throw new Error(`Failed to load credential: ${response.statusText}`);
    }

    const data = await response.json(); // data = {name, region, blob_content/arl}

    currentCredential = name ? name : null; // Set the global currentCredential to the one being edited

    // Populate the dynamic fields created by updateFormFields
    // including 'accountName', 'accountRegion', and 'authBlob' or 'arl'.
    if (serviceConfig[service!] && serviceConfig[service!].fields) {
      serviceConfig[service!].fields.forEach((fieldConf: { id: string; }) => {
        const element = document.getElementById(fieldConf.id) as HTMLInputElement | HTMLTextAreaElement | null;
        if (element) {
          if (fieldConf.id === 'accountName') {
            element.value = data.name || name || ''; // Use data.name from fetched, fallback to clicked name
            (element as HTMLInputElement).disabled = true; // Disable editing of account name
          } else if (fieldConf.id === 'accountRegion') {
            element.value = data.region || '';
          } else if (fieldConf.id === 'authBlob' && service === 'spotify') {
            // data.blob_content might be an object or string. Ensure textarea gets string.
            element.value = typeof data.blob_content === 'object' ? JSON.stringify(data.blob_content, null, 2) : (data.blob_content || '');
          } else if (fieldConf.id === 'arl' && service === 'deezer') {
            element.value = data.arl || '';
          }
          // Add more specific population if other fields are introduced
        }
      });
    }

    (document.getElementById('formTitle') as HTMLElement | null)!.textContent = `Edit ${service!.charAt(0).toUpperCase() + service!.slice(1)} Account`;
    (document.getElementById('submitCredentialBtn') as HTMLElement | null)!.textContent = 'Update Account';

    toggleSearchFieldsVisibility(false); // Ensure old per-account search fields are hidden
  } catch (error: any) {
    showConfigError(error.message);
  }
}

async function handleEditSearchCredential(e: Event) {
  const target = e.target as HTMLElement;
  const service = target.dataset.service;
  // const name = target.dataset.name; // Account name, not used here anymore

  if (service === 'spotify') {
    showConfigError("Spotify API credentials are now managed globally in the 'Global Spotify API Credentials' section.");
    // Optionally, scroll to or highlight the global section
    const globalSection = document.querySelector('.global-spotify-api-config') as HTMLElement | null;
    if (globalSection) globalSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    // If this function were ever used for other services, that logic would go here.
    console.warn(`handleEditSearchCredential called for unhandled service: ${service} or function is obsolete.`);
  }
  setFormVisibility(false); // Ensure the main account form is hidden if it was opened.
}

function toggleSearchFieldsVisibility(showSearchFields: boolean) {
  const serviceFieldsDiv = document.getElementById('serviceFields') as HTMLElement | null;
  const searchFieldsDiv = document.getElementById('searchFields') as HTMLElement | null; // This div might be removed from HTML if not used by other services

  // Simplified: Always show serviceFields, always hide (old) searchFields in this form context.
  // The new global Spotify API fields are in a separate card and handled by different functions.
  if(serviceFieldsDiv) serviceFieldsDiv.style.display = 'block';
  if(searchFieldsDiv) searchFieldsDiv.style.display = 'none';

  // Ensure required attributes are set correctly for visible service fields
  if (serviceConfig[currentService] && serviceConfig[currentService].fields) {
    serviceConfig[currentService].fields.forEach((field: { id: string }) => {
      const input = document.getElementById(field.id) as HTMLInputElement | null;
      if (input) input.setAttribute('required', '');
    });
  }

  // Ensure required attributes are removed from (old) search fields as they are hidden
  // This is mainly for cleanup if the searchFieldsDiv still exists for some reason.
  if (currentService === 'spotify' && serviceConfig[currentService] && serviceConfig[currentService].searchFields) { // This condition will no longer be true for spotify
    serviceConfig[currentService].searchFields.forEach((field: { id: string }) => {
      const input = document.getElementById(field.id) as HTMLInputElement | null;
      if (input) input.removeAttribute('required');
    });
  }
}

function updateFormFields() {
  const serviceFieldsDiv = document.getElementById('serviceFields') as HTMLElement | null;

  if(serviceFieldsDiv) serviceFieldsDiv.innerHTML = '';

  if (serviceConfig[currentService] && serviceConfig[currentService].fields) {
    serviceConfig[currentService].fields.forEach((field: { id: string; label: string; type: string; placeholder?: string; rows?: number; }) => {
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'form-group';

      let inputElementHTML = '';
      if (field.type === 'textarea') {
        inputElementHTML = `<textarea
          id="${field.id}"
          name="${field.id}"
          rows="${field.rows || 3}"
          class="form-input"
          placeholder="${field.placeholder || ''}"
          required></textarea>`;
      } else {
        inputElementHTML = `<input
          type="${field.type}"
          id="${field.id}"
          name="${field.id}"
          class="form-input"
          placeholder="${field.placeholder || ''}"
          ${field.type === 'password' ? 'autocomplete="new-password"' : ''}
          required>`;
      }
      // Region field is optional, so remove 'required' if id is 'accountRegion'
      if (field.id === 'accountRegion') {
        inputElementHTML = inputElementHTML.replace(' required', '');
      }

      fieldDiv.innerHTML = `
        <label for="${field.id}">${field.label}:</label>
        ${inputElementHTML}
      `;
      serviceFieldsDiv?.appendChild(fieldDiv);
    });
  }

  (document.getElementById('formTitle') as HTMLElement | null)!.textContent = `Add New ${currentService.charAt(0).toUpperCase() + currentService.slice(1)} Account`;
  (document.getElementById('submitCredentialBtn') as HTMLElement | null)!.textContent = 'Save Account';

  toggleSearchFieldsVisibility(false);
  isEditingSearch = false;

  // Show/hide region hints based on current service
  if (spotifyRegionHint && deezerRegionHint) {
    if (currentService === 'spotify') {
      spotifyRegionHint.style.display = 'block';
      deezerRegionHint.style.display = 'none';
    } else if (currentService === 'deezer') {
      spotifyRegionHint.style.display = 'none';
      deezerRegionHint.style.display = 'block';
    } else {
      // Fallback: hide both if service is unrecognized
      spotifyRegionHint.style.display = 'none';
      deezerRegionHint.style.display = 'none';
    }
  }
}

function populateFormFields(service: string, data: Record<string, string>) {
  serviceConfig[service].fields.forEach((field: { id: string; }) => {
    const element = document.getElementById(field.id) as HTMLInputElement | null;
    if (element) element.value = data[field.id] || '';
  });
}

async function handleCredentialSubmit(e: Event) {
  e.preventDefault();
  const service = (document.querySelector('.tab-button.active') as HTMLElement | null)?.dataset.service;

  // Get the account name from the 'accountName' field within the dynamically generated serviceFields
  const accountNameInput = document.getElementById('accountName') as HTMLInputElement | null;
  const accountNameValue = accountNameInput?.value.trim();

  try {
    // If we are editing (currentCredential is set), the name comes from currentCredential.
    // If we are creating a new one, the name comes from the form's 'accountName' field.
    if (!currentCredential && !accountNameValue) {
      // Ensure accountNameInput is focused if it's empty during new credential creation
      if(accountNameInput && !accountNameValue) accountNameInput.focus();
      throw new Error('Account Name is required');
    }
    if (!service) {
      throw new Error('Service not selected');
    }

    // For POST (new), endpointName is from form. For PUT (edit), it's from currentCredential.
    const endpointName = currentCredential || accountNameValue;
    if (!endpointName) {
        // This should ideally not be reached if the above check for accountNameValue is done correctly.
        throw new Error("Account name could not be determined.");
    }

    let method: string, data: any, endpoint: string;

    const formData: Record<string, string> = {};
    let isValid = true;
    let firstInvalidField: HTMLInputElement | HTMLTextAreaElement | null = null;

    const currentServiceFields = serviceConfig[service!]?.fields as Array<{id: string, label: string, type: string}> | undefined;

    if (currentServiceFields) {
        currentServiceFields.forEach((field: { id: string; }) => {
          const input = document.getElementById(field.id) as HTMLInputElement | HTMLTextAreaElement | null;
          const value = input ? input.value.trim() : '';
          formData[field.id] = value;

          const isRequired = input?.hasAttribute('required');
          if (isRequired && !value) {
            isValid = false;
            if (!firstInvalidField && input) firstInvalidField = input;
          }
        });
    } else {
        throw new Error(`No fields configured for service: ${service}`);
    }

    if (!isValid) {
      if (firstInvalidField) {
        const nonNullInvalidField = firstInvalidField as HTMLInputElement | HTMLTextAreaElement;
        nonNullInvalidField.focus();
        const fieldName = (nonNullInvalidField as HTMLInputElement).labels?.[0]?.textContent || nonNullInvalidField.id || 'Unknown field';
        throw new Error(`Field '${fieldName}' is required.`);
      } else {
        throw new Error('All required fields must be filled, but a specific invalid field was not identified.');
      }
    }

    // The validator in serviceConfig now expects fields like 'accountName', 'accountRegion', etc.
    data = serviceConfig[service!].validator(formData);

    // If it's a new credential and the validator didn't explicitly set 'name' from 'accountName',
    // (though it should: serviceConfig.spotify.validator expects data.accountName and sets 'name')
    // we ensure the 'name' in the payload matches accountNameValue if it's a new POST.
    // For PUT, the name is part of the URL and shouldn't be in the body unless changing it is allowed.
    // The current validators *do* map e.g. data.accountName to data.name in the output object.
    // So, `data` should already have the correct `name` field from `accountName` form field.

    endpoint = `/api/credentials/${service}/${endpointName}`;
    method = currentCredential ? 'PUT' : 'POST';

    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data) // Data should contain {name, region, blob_content/arl}
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save credentials');
    }

    await updateAccountSelectors();
    loadCredentials(service!);

    showConfigSuccess('Account saved successfully');

    setTimeout(() => {
      setFormVisibility(false);
    }, 2000);
  } catch (error: any) {
    showConfigError(error.message);
  }
}

function resetForm() {
  currentCredential = null;
  isEditingSearch = false;
  // The static 'credentialName' input is gone. Resetting the form should clear dynamic fields.
  (document.getElementById('credentialForm') as HTMLFormElement | null)?.reset();

  // Enable the accountName field again if it was disabled during an edit operation
  const accountNameInput = document.getElementById('accountName') as HTMLInputElement | null;
  if (accountNameInput) {
    accountNameInput.disabled = false;
  }

  const convertToSelect = document.getElementById('convertToSelect') as HTMLSelectElement | null;
  if (convertToSelect) {
      convertToSelect.value = '';
      updateBitrateOptions('');
  }

  const serviceName = currentService.charAt(0).toUpperCase() + currentService.slice(1);
  (document.getElementById('formTitle') as HTMLElement | null)!.textContent = `Add New ${serviceName} Account`;
  (document.getElementById('submitCredentialBtn') as HTMLElement | null)!.textContent = 'Save Account';

  toggleSearchFieldsVisibility(false);
}

async function saveConfig() {
  // Read active account values directly from the DOM (or from the globals which are kept in sync)
  const config = {
    service: (document.getElementById('defaultServiceSelect') as HTMLSelectElement | null)?.value,
    spotify: (document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null)?.value,
    deezer: (document.getElementById('deezerAccountSelect') as HTMLSelectElement | null)?.value,
    fallback: (document.getElementById('fallbackToggle') as HTMLInputElement | null)?.checked,
    spotifyQuality: (document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null)?.value,
    deezerQuality: (document.getElementById('deezerQualitySelect') as HTMLSelectElement | null)?.value,
    realTime: (document.getElementById('realTimeToggle') as HTMLInputElement | null)?.checked,
    customDirFormat: (document.getElementById('customDirFormat') as HTMLInputElement | null)?.value,
    customTrackFormat: (document.getElementById('customTrackFormat') as HTMLInputElement | null)?.value,
    maxConcurrentDownloads: parseInt((document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null)?.value || '3', 10) || 3,
    maxRetries: parseInt((document.getElementById('maxRetries') as HTMLInputElement | null)?.value || '3', 10) || 3,
    retryDelaySeconds: parseInt((document.getElementById('retryDelaySeconds') as HTMLInputElement | null)?.value || '5', 10) || 5,
    retry_delay_increase: parseInt((document.getElementById('retryDelayIncrease') as HTMLInputElement | null)?.value || '5', 10) || 5,
    tracknum_padding: (document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null)?.checked,
    save_cover: (document.getElementById('saveCoverToggle') as HTMLInputElement | null)?.checked,
    convertTo: (document.getElementById('convertToSelect') as HTMLSelectElement | null)?.value || null, // Get convertTo value
    bitrate: (document.getElementById('bitrateSelect') as HTMLSelectElement | null)?.value || null // Get bitrate value
  };

  try {
    const response = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save config');
    }

    const savedConfig = await response.json();

    // Set default service selection
    const defaultServiceSelect = document.getElementById('defaultServiceSelect') as HTMLSelectElement | null;
    if (defaultServiceSelect) defaultServiceSelect.value = savedConfig.service || 'spotify';

    // Update the service-specific options based on selected service
    updateServiceSpecificOptions();

    // Use the "spotify" and "deezer" properties from the API response to set the active accounts.
    activeSpotifyAccount = savedConfig.spotify || '';
    activeDeezerAccount = savedConfig.deezer || '';

    // (Optionally, if the account selects already exist you can set their values here,
    // but updateAccountSelectors() will rebuild the options and set the proper values.)
    const spotifySelect = document.getElementById('spotifyAccountSelect') as HTMLSelectElement | null;
    const deezerSelect = document.getElementById('deezerAccountSelect') as HTMLSelectElement | null;
    if (spotifySelect) spotifySelect.value = activeSpotifyAccount;
    if (deezerSelect) deezerSelect.value = activeDeezerAccount;

    // Update other configuration fields.
    const fallbackToggle = document.getElementById('fallbackToggle') as HTMLInputElement | null;
    if (fallbackToggle) fallbackToggle.checked = !!savedConfig.fallback;
    const spotifyQualitySelect = document.getElementById('spotifyQualitySelect') as HTMLSelectElement | null;
    if (spotifyQualitySelect) spotifyQualitySelect.value = savedConfig.spotifyQuality || 'NORMAL';
    const deezerQualitySelect = document.getElementById('deezerQualitySelect') as HTMLSelectElement | null;
    if (deezerQualitySelect) deezerQualitySelect.value = savedConfig.deezerQuality || 'MP3_128';
    const realTimeToggle = document.getElementById('realTimeToggle') as HTMLInputElement | null;
    if (realTimeToggle) realTimeToggle.checked = !!savedConfig.realTime;
    const customDirFormat = document.getElementById('customDirFormat') as HTMLInputElement | null;
    if (customDirFormat) customDirFormat.value = savedConfig.customDirFormat || '%ar_album%/%album%';
    const customTrackFormat = document.getElementById('customTrackFormat') as HTMLInputElement | null;
    if (customTrackFormat) customTrackFormat.value = savedConfig.customTrackFormat || '%tracknum%. %music%';
    const maxConcurrentDownloads = document.getElementById('maxConcurrentDownloads') as HTMLInputElement | null;
    if (maxConcurrentDownloads) maxConcurrentDownloads.value = savedConfig.maxConcurrentDownloads || '3';
    const maxRetries = document.getElementById('maxRetries') as HTMLInputElement | null;
    if (maxRetries) maxRetries.value = savedConfig.maxRetries || '3';
    const retryDelaySeconds = document.getElementById('retryDelaySeconds') as HTMLInputElement | null;
    if (retryDelaySeconds) retryDelaySeconds.value = savedConfig.retryDelaySeconds || '5';
    const retryDelayIncrease = document.getElementById('retryDelayIncrease') as HTMLInputElement | null;
    if (retryDelayIncrease) retryDelayIncrease.value = savedConfig.retry_delay_increase || '5';
    const tracknumPaddingToggle = document.getElementById('tracknumPaddingToggle') as HTMLInputElement | null;
    if (tracknumPaddingToggle) tracknumPaddingToggle.checked = savedConfig.tracknum_padding === undefined ? true : !!savedConfig.tracknum_padding;
    const saveCoverToggle = document.getElementById('saveCoverToggle') as HTMLInputElement | null;
    if (saveCoverToggle) saveCoverToggle.checked = savedConfig.save_cover === undefined ? true : !!savedConfig.save_cover;

    // Load conversion settings after save
    const convertToSelect = document.getElementById('convertToSelect') as HTMLSelectElement | null;
    if (convertToSelect) {
      convertToSelect.value = savedConfig.convertTo || '';
      updateBitrateOptions(convertToSelect.value);
    }
    const bitrateSelect = document.getElementById('bitrateSelect') as HTMLSelectElement | null;
    if (bitrateSelect && savedConfig.bitrate) {
      if (Array.from(bitrateSelect.options).some(option => option.value === savedConfig.bitrate)) {
          bitrateSelect.value = savedConfig.bitrate;
      }
    } else if (bitrateSelect) {
        if (convertToSelect && !CONVERSION_FORMATS[convertToSelect.value]?.length) {
            bitrateSelect.value = '';
        }
    }

    // Update explicit filter status
    updateExplicitFilterStatus(savedConfig.explicitFilter);

    // Load watch config
    await loadWatchConfig();
  } catch (error: any) {
    showConfigError('Error loading config: ' + error.message);
  }
}

function updateExplicitFilterStatus(isEnabled: boolean) {
  const statusElement = document.getElementById('explicitFilterStatus');
  if (statusElement) {
    // Remove existing classes
    statusElement.classList.remove('enabled', 'disabled');

    // Add appropriate class and text based on whether filter is enabled
    if (isEnabled) {
      statusElement.textContent = 'Enabled';
      statusElement.classList.add('enabled');
    } else {
      statusElement.textContent = 'Disabled';
      statusElement.classList.add('disabled');
    }
  }
}

function showConfigError(message: string) {
  const errorDiv = document.getElementById('configError');
  if (errorDiv) errorDiv.textContent = message;
  setTimeout(() => { if (errorDiv) errorDiv.textContent = '' }, 5000);
}

function showConfigSuccess(message: string) {
  const successDiv = document.getElementById('configSuccess');
  if (successDiv) successDiv.textContent = message;
  setTimeout(() => { if (successDiv) successDiv.textContent = '' }, 5000);
}

// Function to copy the selected placeholder to clipboard
function copyPlaceholderToClipboard(select: HTMLSelectElement) {
  const placeholder = select.value;

  if (!placeholder) return; // If nothing selected

  // Copy to clipboard
  navigator.clipboard.writeText(placeholder)
    .then(() => {
      // Show success notification
      showCopyNotification(`Copied ${placeholder} to clipboard`);

      // Reset select to default after a short delay
      setTimeout(() => {
        select.selectedIndex = 0;
      }, 500);
    })
    .catch(err => {
      console.error('Failed to copy: ', err);
    });
}

// Function to show a notification when copying
function showCopyNotification(message: string) {
  // Check if notification container exists, create if not
  let notificationContainer = document.getElementById('copyNotificationContainer');
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.id = 'copyNotificationContainer';
    document.body.appendChild(notificationContainer);
  }

  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'copy-notification';
  notification.textContent = message;

  // Add to container
  notificationContainer.appendChild(notification);

  // Trigger animation
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);

  // Remove after animation completes
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notificationContainer.removeChild(notification);
    }, 300);
  }, 2000);
}

async function loadWatchConfig() {
  try {
    const response = await fetch('/api/config/watch');
    if (!response.ok) throw new Error('Failed to load watch config');
    const watchConfig = await response.json();

    const checklistContainer = document.getElementById('watchedArtistAlbumGroupChecklist');
    if (checklistContainer && watchConfig.watchedArtistAlbumGroup) {
      const checkboxes = checklistContainer.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      checkboxes.forEach(checkbox => {
        checkbox.checked = watchConfig.watchedArtistAlbumGroup.includes(checkbox.value);
      });
    }

    const watchPollIntervalSecondsInput = document.getElementById('watchPollIntervalSeconds') as HTMLInputElement | null;
    if (watchPollIntervalSecondsInput) {
      watchPollIntervalSecondsInput.value = watchConfig.watchPollIntervalSeconds || '3600';
    }

    const watchEnabledToggle = document.getElementById('watchEnabledToggle') as HTMLInputElement | null;
    if (watchEnabledToggle) {
      watchEnabledToggle.checked = !!watchConfig.enabled;
    }

    // Call this after the state of the toggles has been set based on watchConfig
    updateWatchWarningDisplay();

  } catch (error: any) {
    showConfigError('Error loading watch config: ' + error.message);
  }
}

async function saveWatchConfig() {
  const checklistContainer = document.getElementById('watchedArtistAlbumGroupChecklist');
  const selectedGroups: string[] = [];
  if (checklistContainer) {
    const checkedBoxes = checklistContainer.querySelectorAll('input[type="checkbox"]:checked') as NodeListOf<HTMLInputElement>;
    checkedBoxes.forEach(checkbox => selectedGroups.push(checkbox.value));
  }

  const watchConfig = {
    enabled: (document.getElementById('watchEnabledToggle') as HTMLInputElement | null)?.checked,
    watchedArtistAlbumGroup: selectedGroups,
    watchPollIntervalSeconds: parseInt((document.getElementById('watchPollIntervalSeconds') as HTMLInputElement | null)?.value || '3600', 10) || 3600,
  };

  try {
    const response = await fetch('/api/config/watch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(watchConfig)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save watch config');
    }
    showConfigSuccess('Watch settings saved successfully.');
  } catch (error: any) {
    showConfigError('Error saving watch config: ' + error.message);
  }
}

// New function to manage the warning display
function updateWatchWarningDisplay() {
  const watchEnabledToggle = document.getElementById('watchEnabledToggle') as HTMLInputElement | null;
  const realTimeToggle = document.getElementById('realTimeToggle') as HTMLInputElement | null;
  const warningDiv = document.getElementById('watchEnabledWarning') as HTMLElement | null;

  if (watchEnabledToggle && realTimeToggle && warningDiv) {
    const isWatchEnabled = watchEnabledToggle.checked;
    const isRealTimeEnabled = realTimeToggle.checked;

    if (isWatchEnabled && !isRealTimeEnabled) {
      warningDiv.style.display = 'block';
    } else {
      warningDiv.style.display = 'none';
    }
  }
  // Hide the first-enable notice if watch is disabled or if it was already dismissed by timeout/interaction
  // The primary logic for showing first-enable notice is in the event listener for watchEnabledToggle
  const firstEnableNoticeDiv = document.getElementById('watchFeatureFirstEnableNotice');
  if (firstEnableNoticeDiv && watchEnabledToggle && !watchEnabledToggle.checked) {
    firstEnableNoticeDiv.style.display = 'none';
  }
}

// Function to update bitrate options based on selected format
function updateBitrateOptions(selectedFormat: string) {
  const bitrateSelect = document.getElementById('bitrateSelect') as HTMLSelectElement | null;
  if (!bitrateSelect) return;

  bitrateSelect.innerHTML = ''; // Clear existing options
  const currentBitrateValue = bitrateSelect.value; // Preserve current value if possible

  if (selectedFormat && CONVERSION_FORMATS[selectedFormat] && CONVERSION_FORMATS[selectedFormat].length > 0) {
    bitrateSelect.disabled = false;
    CONVERSION_FORMATS[selectedFormat].forEach(bRate => {
      const option = document.createElement('option');
      option.value = bRate;
      option.textContent = bRate;
      bitrateSelect.appendChild(option);
    });
    // Try to restore previous valid bitrate or set to first available
    if (CONVERSION_FORMATS[selectedFormat].includes(currentBitrateValue)) {
        bitrateSelect.value = currentBitrateValue;
    } else {
        bitrateSelect.value = CONVERSION_FORMATS[selectedFormat][0]; // Default to first available bitrate
    }
  } else {
    // For formats with no specific bitrates (FLAC, WAV, ALAC) or 'No Conversion'
    bitrateSelect.disabled = true;
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'N/A';
    bitrateSelect.appendChild(option);
    bitrateSelect.value = '';
  }
}

// Function to load global Spotify API credentials
async function loadSpotifyApiConfig() {
  const clientIdInput = document.getElementById('globalSpotifyClientId') as HTMLInputElement | null;
  const clientSecretInput = document.getElementById('globalSpotifyClientSecret') as HTMLInputElement | null;
  spotifyApiConfigStatusDiv = document.getElementById('spotifyApiConfigStatus') as HTMLElement | null; // Assign here or ensure it's globally available

  if (!clientIdInput || !clientSecretInput || !spotifyApiConfigStatusDiv) {
    console.error("Global Spotify API config form elements not found.");
    if(spotifyApiConfigStatusDiv) spotifyApiConfigStatusDiv.textContent = 'Error: Form elements missing.';
    return;
  }

  try {
    const response = await fetch('/api/credentials/spotify_api_config');
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to load Spotify API config, server error.' }));
      throw new Error(errorData.error || `HTTP error ${response.status}`);
    }
    const data = await response.json();
    clientIdInput.value = data.client_id || '';
    clientSecretInput.value = data.client_secret || '';
    if (data.warning) {
        spotifyApiConfigStatusDiv.textContent = data.warning;
        spotifyApiConfigStatusDiv.className = 'status-message warning';
    } else if (data.client_id && data.client_secret) {
        spotifyApiConfigStatusDiv.textContent = 'Current API credentials loaded.';
        spotifyApiConfigStatusDiv.className = 'status-message success';
    } else {
        spotifyApiConfigStatusDiv.textContent = 'Global Spotify API credentials are not set.';
        spotifyApiConfigStatusDiv.className = 'status-message neutral';
    }
  } catch (error: any) {
    console.error('Error loading Spotify API config:', error);
    if(spotifyApiConfigStatusDiv) {
        spotifyApiConfigStatusDiv.textContent = `Error loading config: ${error.message}`;
        spotifyApiConfigStatusDiv.className = 'status-message error';
    }
  }
}

// Function to save global Spotify API credentials
async function saveSpotifyApiConfig() {
  const clientIdInput = document.getElementById('globalSpotifyClientId') as HTMLInputElement | null;
  const clientSecretInput = document.getElementById('globalSpotifyClientSecret') as HTMLInputElement | null;
  // spotifyApiConfigStatusDiv should be already assigned by loadSpotifyApiConfig or be a global var
  if (!spotifyApiConfigStatusDiv) { // Re-fetch if null, though it should not be if load ran.
    spotifyApiConfigStatusDiv = document.getElementById('spotifyApiConfigStatus') as HTMLElement | null;
  }

  if (!clientIdInput || !clientSecretInput || !spotifyApiConfigStatusDiv) {
    console.error("Global Spotify API config form elements not found for saving.");
    if(spotifyApiConfigStatusDiv) spotifyApiConfigStatusDiv.textContent = 'Error: Form elements missing.';
    return;
  }

  const client_id = clientIdInput.value.trim();
  const client_secret = clientSecretInput.value.trim();

  if (!client_id || !client_secret) {
    spotifyApiConfigStatusDiv.textContent = 'Client ID and Client Secret cannot be empty.';
    spotifyApiConfigStatusDiv.className = 'status-message error';
    if(!client_id) clientIdInput.focus(); else clientSecretInput.focus();
    return;
  }

  try {
    spotifyApiConfigStatusDiv.textContent = 'Saving...';
    spotifyApiConfigStatusDiv.className = 'status-message neutral';

    const response = await fetch('/api/credentials/spotify_api_config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id, client_secret })
    });

    const responseData = await response.json(); // Try to parse JSON regardless of ok status for error messages

    if (!response.ok) {
      throw new Error(responseData.error || `Failed to save Spotify API config. Status: ${response.status}`);
    }

    spotifyApiConfigStatusDiv.textContent = responseData.message || 'Spotify API credentials saved successfully!';
    spotifyApiConfigStatusDiv.className = 'status-message success';
  } catch (error: any) {
    console.error('Error saving Spotify API config:', error);
    if(spotifyApiConfigStatusDiv) {
        spotifyApiConfigStatusDiv.textContent = `Error saving: ${error.message}`;
        spotifyApiConfigStatusDiv.className = 'status-message error';
    }
  }
}
