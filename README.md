# Spotizerr

Music downloader which combines the best of two worlds: Spotify's catalog and Deezer's quality. Search for a track using Spotify search api, click download and, depending on your preferences, it will download directly from Spotify or firstly try to download from Deezer, if it fails, it'll fallback to Spotify.

![image](https://github.com/user-attachments/assets/69674c27-9f53-48cb-84c3-1eaf612735fb)

## Features

- Dual-service integration (Spotify & Deezer)
- Direct URL downloads for Spotify tracks/albums/playlists
- Search using spotify's catalog
- Credential management system
- Download queue with real-time progress
- Service fallback system when downloading, it will first try to download each track from Deezer and only if it fails, will grab it from Spotify

## Prerequisites

- Docker, duh
- Spotify credentials (see [Spotify Credentials Setup](#spotify-credentials-setup))
- Deezer ARL token (see [Deezer ARL Setup](#deezer-arl-setup))

## Installation

1. Create project directory:
```bash
mkdir spotizerr && cd spotizerr
```

2. Create `docker-compose.yml`:
```yaml
name: spotizerr
services:
    spotizerr:
        volumes:
            - ./creds:/app/creds
            - ./downloads:/app/downloads
        ports:
            - 7171:7171
        image: cooldockerizer93/spotizerr
```

3. Launch container:
```bash
docker compose up -d
```

Access at: `http://localhost:7171`

## Configuration

### Initial Setup
1. Access settings via the gear icon
2. Switch between service tabs (Spotify/Deezer)
3. Enter credentials using the form
4. Configure active accounts in settings
_Note: If you want Spotify-only mode, just keep "Download fallback" setting disabled and don't bother adding Deezer credentials. Deezer-only mode is not, and will not be supported since there already is a much better tool for that called "Deemix"_

### Deezer ARL Setup

In a chrome-based browser, open the [web player](https://www.deezer.com/)

There, press F12 and select "Application"

![image](https://github.com/user-attachments/assets/22e61d91-50b4-48f2-bba7-28ef45b45ee5)

Expand Cookies section and select the "https://www.deezer.com". Find the "arl" cookie and double-click the "Cookie Value" tab's text.

![image](https://github.com/user-attachments/assets/75a67906-596e-42a0-beb0-540f2748b16e)

Copy that value and paste it into the correspondant setting in Spotizerr

### Spotify Credentials Setup

First create a Spotify credentials file using the 3rd-party `librespot-auth` tool, this step has to be done in a PC/Laptop that has the Spotify desktop app installed.

In a Terminal, run:

```shell
# Clone the librespot-auth repo
git clone --depth 1 https://github.com/dspearson/librespot-auth.git

# Build the repo using a Rust Docker image
docker run --rm -v "$(pwd)/librespot-auth":/app -w /app rust:latest cargo build --release

./librespot-auth/target/release/librespot-auth --name "mySpotifyAccount1" --class=computer

# For Windows, run this command instead:
# .\librespot-auth\target\release\librespot-auth.exe --name "mySpotifyAccount1" --class=computer
```

- Now open the Spotify app
- Click on the "Connect to a device" icon
- Under the "Select Another Device" section, click "mySpotifyAccount1"
- This utility will create a `credentials.json` file

This file has the following format:

```
{"username": "string" "auth_type": 1 "auth_data": "string"}
```

The important ones are the "username" and "auth_data" parameters, these match the "username" and "credentials" sections respectively when adding/editing spotify credentials in Spotizerr.

In the terminal, you can directly print these parameters using jq:

```
jq -r '.username, .auth_data' credentials.json
```

## Usage

### Basic Operations
1. **Search**:
   - Enter query in search bar
   - Select result type (Track/Album/Playlist)
   - Click search button or press Enter

2. **Download**:
   - Click download button on any result
   - Monitor progress in queue sidebar

3. **Direct URLs**:
   - Paste Spotify URLs directly into search
   - Supports tracks, albums, and playlists

### Advanced Features
- **Fallback System**:
  - Enable in settings
  - Uses Deezer as primary when downloading with Spotify fallback

- **Multiple Accounts**:
  - Manage credentials in settings
  - Switch active accounts per service

## Troubleshooting

**Common Issues**:
- "No accounts available" error: Add credentials in settings
- Download failures: Check credential validity
- Queue stalls: Verify service connectivity
- Audiokey related: Spotify rate limit, let it cooldown about 30 seconds and click retry

**Log Locations**:
- Credentials: `./creds/` directory
- Downloads: `./downloads/` directory
- Application logs: `docker logs spotizerr`

## Notes

- Credentials are stored in plaintext - secure your installation
- Downloaded files retain original metadata
- Service limitations apply based on account types