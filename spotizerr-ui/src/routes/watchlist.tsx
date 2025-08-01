import { useState, useEffect, useCallback } from "react";
import apiClient from "../lib/api-client";
import { toast } from "sonner";
import { useSettings } from "../contexts/settings-context";
import { Link } from "@tanstack/react-router";
import type { ArtistType, PlaylistType } from "../types/spotify";
import { FaRegTrashAlt, FaSearch } from "react-icons/fa";

// --- Type Definitions ---
interface BaseWatched {
  itemType: "artist" | "playlist";
  spotify_id: string;
}
type WatchedArtist = ArtistType & { itemType: "artist" };
type WatchedPlaylist = PlaylistType & { itemType: "playlist" };

type WatchedItem = WatchedArtist | WatchedPlaylist;

export const Watchlist = () => {
  const { settings, isLoading: settingsLoading } = useSettings();
  const [items, setItems] = useState<WatchedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchWatchlist = useCallback(async () => {
    setIsLoading(true);
    try {
      const [artistsRes, playlistsRes] = await Promise.all([
        apiClient.get<BaseWatched[]>("/artist/watch/list"),
        apiClient.get<BaseWatched[]>("/playlist/watch/list"),
      ]);

      const artistDetailsPromises = artistsRes.data.map((artist) =>
        apiClient.get<ArtistType>(`/artist/info?id=${artist.spotify_id}`),
      );
      const playlistDetailsPromises = playlistsRes.data.map((playlist) =>
        apiClient.get<PlaylistType>(`/playlist/info?id=${playlist.spotify_id}`),
      );

      const [artistDetailsRes, playlistDetailsRes] = await Promise.all([
        Promise.all(artistDetailsPromises),
        Promise.all(playlistDetailsPromises),
      ]);

      const artists: WatchedItem[] = artistDetailsRes.map((res) => ({ ...res.data, itemType: "artist" }));
      const playlists: WatchedItem[] = playlistDetailsRes.map((res) => ({
        ...res.data,
        itemType: "playlist",
        spotify_id: res.data.id,
      }));

      setItems([...artists, ...playlists]);
    } catch {
      toast.error("Failed to load watchlist.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!settingsLoading && settings?.watch?.enabled) {
      fetchWatchlist();
    } else if (!settingsLoading) {
      setIsLoading(false);
    }
  }, [settings, settingsLoading, fetchWatchlist]);

  const handleUnwatch = async (item: WatchedItem) => {
    toast.promise(apiClient.delete(`/${item.itemType}/watch/${item.id}`), {
      loading: `Unwatching ${item.name}...`,
      success: () => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        return `${item.name} has been unwatched.`;
      },
      error: `Failed to unwatch ${item.name}.`,
    });
  };

  const handleCheck = async (item: WatchedItem) => {
    toast.promise(apiClient.post(`/${item.itemType}/watch/trigger_check/${item.id}`), {
      loading: `Checking ${item.name} for updates...`,
      success: (res: { data: { message?: string } }) => res.data.message || `Check triggered for ${item.name}.`,
      error: `Failed to trigger check for ${item.name}.`,
    });
  };

  const handleCheckAll = () => {
    toast.promise(
      Promise.all([apiClient.post("/artist/watch/trigger_check"), apiClient.post("/playlist/watch/trigger_check")]),
      {
        loading: "Triggering checks for all watched items...",
        success: "Successfully triggered checks for all items.",
        error: "Failed to trigger one or more checks.",
      },
    );
  };

  if (isLoading || settingsLoading) {
    return <div className="text-center">Loading Watchlist...</div>;
  }

  if (!settings?.watch?.enabled) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl font-bold mb-2">Watchlist Disabled</h2>
        <p>The watchlist feature is currently disabled. You can enable it in the settings.</p>
        <Link to="/config" className="text-blue-500 hover:underline mt-4 inline-block">
          Go to Settings
        </Link>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl font-bold mb-2">Watchlist is Empty</h2>
        <p>Start watching artists or playlists to see them here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Watched Artists & Playlists</h1>
        <button
          onClick={handleCheckAll}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
        >
          <FaSearch /> Check All
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {items.map((item) => (
          <div key={item.id} className="bg-card p-4 rounded-lg shadow space-y-2 flex flex-col">
            <a href={`/${item.itemType}/${item.id}`} className="flex-grow">
              <img
                src={item.images?.[0]?.url || "/images/placeholder.jpg"}
                alt={item.name}
                className="w-full h-auto object-cover rounded-md aspect-square"
              />
              <h3 className="font-bold pt-2 truncate">{item.name}</h3>
              <p className="text-sm text-muted-foreground capitalize">{item.itemType}</p>
            </a>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => handleUnwatch(item)}
                className="w-full px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center justify-center gap-2"
              >
                <FaRegTrashAlt /> Unwatch
              </button>
              <button
                onClick={() => handleCheck(item)}
                className="w-full px-3 py-1.5 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700 flex items-center justify-center gap-2"
              >
                <FaSearch /> Check
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
