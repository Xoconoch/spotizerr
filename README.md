# SUPPORT YOUR ARTISTS

As of 2025, Spotify pays an average of $0.005 per stream to the artist. That means that if you give the equivalent of $5 directly to them (like merch, buying cds, or just donating), you can """ethically""" listen to them a total of 1000 times. Of course, nobody thinks spotify payment is fair, so preferably you should give more, but $5 is the bare minimum. Big names prolly don't need those $5 dollars, but it might be _the_ difference between going out of business or not for that indie rock band you like.

# Spotizerr

Music downloader which combines the best of two worlds: Spotify's catalog and Deezer's quality. Search for a track using Spotify search api, click download and, depending on your preferences, it will download directly from Spotify or firstly try to download from Deezer, if it fails, it'll fallback to Spotify.

## Desktop interface
![image](https://github.com/user-attachments/assets/8093085d-cad3-4cba-9a0d-1ad6cae63e4f)

![image](https://github.com/user-attachments/assets/ac5daa0f-769f-43b0-b78a-8db343219861)

![image](https://github.com/user-attachments/assets/fb8b2295-f6b6-412f-87da-69f63b56247c)

## Mobile interface

![Screen Shot 2025-03-15 at 21 02 27](https://github.com/user-attachments/assets/cee9318e-9451-4a43-9e24-20e05f4abc5b) ![Screen Shot 2025-03-15 at 21 02 45](https://github.com/user-attachments/assets/d5801795-ba31-4589-a82d-d208f1ea6d62)

## Features

- Browse through artist, albums, playlists and tracks and jump between them
- Dual-service integration (Spotify & Deezer)
- Direct URL downloads for Spotify tracks/albums/playlists/artists
- Search using spotify's catalog
- Credential management system
- Download queue with real-time progress
- Service fallback system when downloading*
- Real time downloading**
- Quality selector***
- Customizable track number padding (01. Track or 1. Track)
- Customizable retry parameters (max attempts, delay, increase per retry)

*It will first try to download each track from Deezer and only if it fails, will grab it from Spotify
**Only for spotify. For each track, it matches its length with the time it takes to download it
***Restrictions per account tier apply (see

## Prerequisites

- Docker, duh
- Spotify credentials (see [Spotify Credentials Setup](#spotify-credentials-setup))
- Spotify client ID and client secret (see [Spotify Developer Setup](#spotify-developer-setup))
- Deezer ARL token (see [Deezer ARL Setup](#deezer-arl-setup))

## Installation

1. Create project directory:
```bash
mkdir spotizerr && cd spotizerr
```

2. Setup a `.env` file following the `.env.example` file from this repo and update all variables (e.g. Redis credentials, PUID/PGID, UMASK).
3. Copy `docker-compose.yml` from this repo.
4. Launch containers:
```bash
docker compose up -d
```
_Note: an UnRaid template is available in the file spotizerr.xml_

Access at: `http://localhost:7171`

## Configuration

### Spotify Setup

Spotify is VERY petty, so, in order to simplify the process, another tool was created to perform this part of the setup; see [spotizerr-auth](https://github.com/Xoconoch/spotizerr-auth)

### Deezer ARL Setup

#### Chrome-based browsers

Open the [web player](https://www.deezer.com/)

There, press F12 and select "Application"

![image](https://github.com/user-attachments/assets/22e61d91-50b4-48f2-bba7-28ef45b45ee5)

Expand Cookies section and select the "https://www.deezer.com". Find the "arl" cookie and double-click the "Cookie Value" tab's text.

![image](https://github.com/user-attachments/assets/75a67906-596e-42a0-beb0-540f2748b16e)

Copy that value and paste it into the correspondant setting in Spotizerr

#### Firefox-based browsers

Open the [web player](https://www.deezer.com/)

There, press F12 and select "Storage"

![image](https://github.com/user-attachments/assets/601be3fb-1ec9-44d9-be4f-28b1d853df2f)

Click the cookies host "https://www.deezer.com" and find the "arl" cookie.

![image](https://github.com/user-attachments/assets/ef8ea256-2c13-4780-ae9f-71527466df56)

Copy that value and paste it into the correspondant setting in Spotizerr

## Usage

### Basic Operations
1. **Search**:
   - Enter query in search bar
   - Select result type (Track/Album/Playlist/Artist)
   - Click search button or press Enter

2. **Download**:
   - Click download button on any result
      - For artists, you can select a specific subset of albums you want to download
   - Monitor progress in queue sidebar

3. **Direct URLs**:
   - Paste Spotify URLs directly into search
   - Supports tracks, albums, playlists and artists (this will download the whole discogrpahy, you've been warned)

### Advanced Features
- **Fallback System**:
  - Enable in settings
  - Uses Deezer as primary when downloading with Spotify fallback

- **Multiple Accounts**:
  - Manage credentials in settings
  - Switch active accounts per service

- **Quality selector**
   - For spotify: OGG 96k, 160k and 320k (premium only)
   - For deezer: MP3 128k, MP3 320k (sometimes premium, it varies) and FLAC (premium only)

- **Customizable formatting**:
   - Track number padding (01. Track or 1. Track)
  - Adjust retry parameters (max attempts, delay, delay increase)

- **Watching artits/playlists**
   - Start watching a spotify playlist and its tracks will be downloaded dynamically as it updates.
   - Start watching a spotify artist and their albums will be automatically downloaded, never miss a release!

## Troubleshooting

**Common Issues**:
- "No accounts available" error: Add credentials in settings
- Download failures: Check credential validity
- Queue stalls: Verify service connectivity
- Audiokey related: Spotify rate limit, let it cooldown about 30 seconds and click retry
- API errors: Ensure your Spotify client ID and client secret are correctly entered

**Log Locations**:
- Application Logs: `docker logs spotizerr` (for main app and Celery workers)
- Individual Task Logs: `./logs/tasks/` (inside the container, maps to your volume)
- Credentials: `./data/creds/`
- Configuration Files: `./data/config/`
- Downloaded Music: `./downloads/`
- Watch Feature Database: `./data/watch/`
- Download History Database: `./data/history/`
- Spotify Token Cache: `./.cache/` (if `SPOTIPY_CACHE_PATH` is set to `/app/cache/.cache` and mapped)

## Notes

- This app has no way of authentication, if you plan on exposing it, put a security layer on top of it (such as cloudflare tunnel, authelia or just leave it accessible only through a vpn)
- Credentials are stored in plaintext - secure your installation
- Downloaded files retain original metadata
- Service limitations apply based on account types

# Acknowledgements

- This project was inspired by the amazing [deezspot library](https://github.com/jakiepari/deezspot), although their creators are in no way related with Spotizerr, they still deserve credit.