import os
import json
import traceback
from deezspot.spotloader import SpoLogin
from deezspot.deezloader import DeeLogin

def download_playlist(
    service,
    url,
    main,
    fallback=None,
    quality=None,
    fall_quality=None,
    real_time=False,
    custom_dir_format="%ar_album%/%album%/%copyright%",
    custom_track_format="%tracknum%. %music% - %artist%"
):
    try:
        if service == 'spotify':
            if fallback:
                if quality is None:
                    quality = 'FLAC'
                if fall_quality is None:
                    fall_quality = 'HIGH'
                # First attempt: use DeeLogin's download_playlistspo with the 'main' (Deezer credentials)
                try:
                    # Load Deezer credentials from 'main' under deezer directory
                    deezer_creds_dir = os.path.join('./creds/deezer', main)
                    deezer_creds_path = os.path.abspath(os.path.join(deezer_creds_dir, 'credentials.json'))
                    with open(deezer_creds_path, 'r') as f:
                        deezer_creds = json.load(f)
                    # Initialize DeeLogin with Deezer credentials
                    dl = DeeLogin(
                        arl=deezer_creds.get('arl', ''),
                    )
                    # Download using download_playlistspo; pass the custom formatting parameters.
                    dl.download_playlistspo(
                        link_playlist=url,
                        output_dir="./downloads",
                        quality_download=quality,
                        recursive_quality=True,
                        recursive_download=False,
                        not_interface=False,
                        make_zip=False,
                        method_save=1,
                        custom_dir_format=custom_dir_format,
                        custom_track_format=custom_track_format
                    )
                except Exception as e:
                    # Load fallback Spotify credentials and attempt download
                    try:
                        spo_creds_dir = os.path.join('./creds/spotify', fallback)
                        spo_creds_path = os.path.abspath(os.path.join(spo_creds_dir, 'credentials.json'))
                        spo = SpoLogin(credentials_path=spo_creds_path)
                        spo.download_playlist(
                            link_playlist=url,
                            output_dir="./downloads",
                            quality_download=fall_quality,
                            recursive_quality=True,
                            recursive_download=False,
                            not_interface=False,
                            method_save=1,
                            make_zip=False,
                            real_time_dl=real_time,
                            custom_dir_format=custom_dir_format,
                            custom_track_format=custom_track_format
                        )
                    except Exception as e2:
                        # If fallback also fails, raise an error indicating both attempts failed
                        raise RuntimeError(
                            f"Both main (Deezer) and fallback (Spotify) attempts failed. "
                            f"Deezer error: {e}, Spotify error: {e2}"
                        ) from e2
            else:
                # Original behavior: use Spotify main
                if quality is None:
                    quality = 'HIGH'
                creds_dir = os.path.join('./creds/spotify', main)
                credentials_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
                spo = SpoLogin(credentials_path=credentials_path)
                spo.download_playlist(
                    link_playlist=url,
                    output_dir="./downloads",
                    quality_download=quality,
                    recursive_quality=True,
                    recursive_download=False,
                    not_interface=False,
                    method_save=1,
                    make_zip=False,
                    real_time_dl=real_time,
                    custom_dir_format=custom_dir_format,
                    custom_track_format=custom_track_format
                )
        elif service == 'deezer':
            if quality is None:
                quality = 'FLAC'
            # Existing code for Deezer, using main as Deezer account.
            creds_dir = os.path.join('./creds/deezer', main)
            creds_path = os.path.abspath(os.path.join(creds_dir, 'credentials.json'))
            with open(creds_path, 'r') as f:
                creds = json.load(f)
            dl = DeeLogin(
                arl=creds.get('arl', ''),
            )
            dl.download_playlistdee(
                link_playlist=url,
                output_dir="./downloads",
                quality_download=quality,
                recursive_quality=False,
                recursive_download=False,
                method_save=1,
                make_zip=False,
                custom_dir_format=custom_dir_format,
                custom_track_format=custom_track_format
            )
        else:
            raise ValueError(f"Unsupported service: {service}")
    except Exception as e:
        traceback.print_exc()
        raise  # Re-raise the exception after logging
