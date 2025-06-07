document.addEventListener('DOMContentLoaded', () => {
    const historyTableBody = document.getElementById('history-table-body') as HTMLTableSectionElement | null;
    const prevButton = document.getElementById('prev-page') as HTMLButtonElement | null;
    const nextButton = document.getElementById('next-page') as HTMLButtonElement | null;
    const pageInfo = document.getElementById('page-info') as HTMLSpanElement | null;
    const limitSelect = document.getElementById('limit-select') as HTMLSelectElement | null;
    const statusFilter = document.getElementById('status-filter') as HTMLSelectElement | null;
    const typeFilter = document.getElementById('type-filter') as HTMLSelectElement | null;

    let currentPage = 1;
    let limit = 25;
    let totalEntries = 0;
    let currentSortBy = 'timestamp_completed';
    let currentSortOrder = 'DESC';

    async function fetchHistory(page = 1) {
        if (!historyTableBody || !prevButton || !nextButton || !pageInfo || !limitSelect || !statusFilter || !typeFilter) {
            console.error('One or more critical UI elements are missing for history page.');
            return;
        }

        const offset = (page - 1) * limit;
        let apiUrl = `/api/history?limit=${limit}&offset=${offset}&sort_by=${currentSortBy}&sort_order=${currentSortOrder}`;

        const statusVal = statusFilter.value;
        if (statusVal) {
            apiUrl += `&status_final=${statusVal}`;
        }
        const typeVal = typeFilter.value;
        if (typeVal) {
            apiUrl += `&download_type=${typeVal}`;
        }

        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            renderHistory(data.entries);
            totalEntries = data.total_count;
            currentPage = Math.floor(offset / limit) + 1;
            updatePagination();
            updateSortIndicators();
        } catch (error) {
            console.error('Error fetching history:', error);
            if (historyTableBody) {
                historyTableBody.innerHTML = '<tr><td colspan="9">Error loading history.</td></tr>';
            }
        }
    }

    function renderHistory(entries: any[]) {
        if (!historyTableBody) return;

        historyTableBody.innerHTML = ''; // Clear existing rows
        if (!entries || entries.length === 0) {
            historyTableBody.innerHTML = '<tr><td colspan="9">No history entries found.</td></tr>';
            return;
        }

        entries.forEach(entry => {
            const row = historyTableBody.insertRow();
            row.insertCell().textContent = entry.item_name || 'N/A';
            row.insertCell().textContent = entry.item_artist || 'N/A';
            row.insertCell().textContent = entry.download_type ? entry.download_type.charAt(0).toUpperCase() + entry.download_type.slice(1) : 'N/A';
            row.insertCell().textContent = entry.service_used || 'N/A';
            // Construct Quality display string
            let qualityDisplay = entry.quality_profile || 'N/A';
            if (entry.convert_to) {
                qualityDisplay = `${entry.convert_to.toUpperCase()}`;
                if (entry.bitrate) {
                    qualityDisplay += ` ${entry.bitrate}k`;
                }
                qualityDisplay += ` (${entry.quality_profile || 'Original'})`;
            } else if (entry.bitrate) { // Case where convert_to might not be set, but bitrate is (e.g. for OGG Vorbis quality settings)
                 qualityDisplay = `${entry.bitrate}k (${entry.quality_profile || 'Profile'})`;
            }
            row.insertCell().textContent = qualityDisplay;

            const statusCell = row.insertCell();
            statusCell.textContent = entry.status_final || 'N/A';
            statusCell.className = `status-${entry.status_final}`;

            row.insertCell().textContent = entry.timestamp_added ? new Date(entry.timestamp_added * 1000).toLocaleString() : 'N/A';
            row.insertCell().textContent = entry.timestamp_completed ? new Date(entry.timestamp_completed * 1000).toLocaleString() : 'N/A';

            const detailsCell = row.insertCell();
            const detailsButton = document.createElement('button');
            detailsButton.innerHTML = `<img src="/static/images/info.svg" alt="Details">`;
            detailsButton.className = 'details-btn btn-icon';
            detailsButton.title = 'Show Details';
            detailsButton.onclick = () => showDetailsModal(entry);
            detailsCell.appendChild(detailsButton);

            if (entry.status_final === 'ERROR' && entry.error_message) {
                const errorSpan = document.createElement('span');
                errorSpan.textContent = ' (Show Error)';
                errorSpan.className = 'error-message-toggle';
                errorSpan.style.marginLeft = '5px';
                errorSpan.onclick = (e) => {
                    e.stopPropagation(); // Prevent click on row if any
                    let errorDetailsDiv = row.querySelector('.error-details') as HTMLElement | null;
                    if (!errorDetailsDiv) {
                        errorDetailsDiv = document.createElement('div');
                        errorDetailsDiv.className = 'error-details';
                        const newCell = row.insertCell(); // This will append to the end of the row
                        newCell.colSpan = 9; // Span across all columns
                        newCell.appendChild(errorDetailsDiv);
                        // Visually, this new cell will be after the 'Details' button cell.
                        // To make it appear as part of the status cell or below the row, more complex DOM manipulation or CSS would be needed.
                    }
                    errorDetailsDiv.textContent = entry.error_message;
                    // Toggle display by directly manipulating the style of the details div
                    errorDetailsDiv.style.display = errorDetailsDiv.style.display === 'none' ? 'block' : 'none';
                };
                statusCell.appendChild(errorSpan);
            }
        });
    }

    function updatePagination() {
        if (!pageInfo || !prevButton || !nextButton) return;

        const totalPages = Math.ceil(totalEntries / limit) || 1;
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        prevButton.disabled = currentPage === 1;
        nextButton.disabled = currentPage === totalPages;
    }

    function showDetailsModal(entry: any) {
        const details = `Task ID: ${entry.task_id}\n` +
                        `Type: ${entry.download_type}\n` +
                        `Name: ${entry.item_name}\n` +
                        `Artist: ${entry.item_artist}\n` +
                        `Album: ${entry.item_album || 'N/A'}\n` +
                        `URL: ${entry.item_url}\n` +
                        `Spotify ID: ${entry.spotify_id || 'N/A'}\n` +
                        `Service Used: ${entry.service_used || 'N/A'}\n` +
                        `Quality Profile (Original): ${entry.quality_profile || 'N/A'}\n` +
                        `ConvertTo: ${entry.convert_to || 'N/A'}\n` +
                        `Bitrate: ${entry.bitrate ? entry.bitrate + 'k' : 'N/A'}\n` +
                        `Status: ${entry.status_final}\n` +
                        `Error: ${entry.error_message || 'None'}\n` +
                        `Added: ${new Date(entry.timestamp_added * 1000).toLocaleString()}\n` +
                        `Completed/Ended: ${new Date(entry.timestamp_completed * 1000).toLocaleString()}\n\n` +
                        `Original Request: ${JSON.stringify(JSON.parse(entry.original_request_json || '{}'), null, 2)}\n\n` +
                        `Last Status Object: ${JSON.stringify(JSON.parse(entry.last_status_obj_json || '{}'), null, 2)}`;
        alert(details);
    }

    document.querySelectorAll('th[data-sort]').forEach(headerCell => {
        headerCell.addEventListener('click', () => {
            const sortField = (headerCell as HTMLElement).dataset.sort;
            if (!sortField) return;

            if (currentSortBy === sortField) {
                currentSortOrder = currentSortOrder === 'ASC' ? 'DESC' : 'ASC';
            } else {
                currentSortBy = sortField;
                currentSortOrder = 'DESC';
            }
            fetchHistory(1);
        });
    });

    function updateSortIndicators() {
        document.querySelectorAll('th[data-sort]').forEach(headerCell => {
            const th = headerCell as HTMLElement;
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === currentSortBy) {
                th.classList.add(currentSortOrder === 'ASC' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    prevButton?.addEventListener('click', () => fetchHistory(currentPage - 1));
    nextButton?.addEventListener('click', () => fetchHistory(currentPage + 1));
    limitSelect?.addEventListener('change', (e) => {
        limit = parseInt((e.target as HTMLSelectElement).value, 10);
        fetchHistory(1);
    });
    statusFilter?.addEventListener('change', () => fetchHistory(1));
    typeFilter?.addEventListener('change', () => fetchHistory(1));

    // Initial fetch
    fetchHistory();
});