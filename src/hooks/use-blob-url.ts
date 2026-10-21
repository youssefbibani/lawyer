import { useEffect, useState } from "react";

import { getBlobStore } from "@/services/archive/blobStore";

/** Loads a stored (possibly encrypted) blob and exposes a revocable object URL. */
export function useBlobUrl(key: string | undefined): { url?: string; missing: boolean } {
  const [state, setState] = useState<{ url?: string; missing: boolean }>({ missing: false });
  useEffect(() => {
    let alive = true;
    let url: string | undefined;
    setState({ missing: false });
    if (!key) return;
    getBlobStore()
      .get(key)
      .then((blob) => {
        if (!alive) return;
        if (!blob) return setState({ missing: true });
        url = URL.createObjectURL(blob);
        setState({ url, missing: false });
      })
      .catch(() => alive && setState({ missing: true }));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [key]);
  return state;
}
