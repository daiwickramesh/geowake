import { GOOGLE_CLIENT_ID, IS_GOOGLE_AUTH_CONFIGURED } from "../config";

export interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>,
          ) => void;
        };
      };
    };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
const LOAD_TIMEOUT_MS = 10_000;

let scriptPromise: Promise<void> | null = null;

/** Loads the Google Identity Services bundle once, with a bounded wait. */
const loadGis = (): Promise<void> => {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Google Sign-In is only available in a browser."));
  }
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${GIS_SRC}"]`,
    );
    const script = existing ?? document.createElement("script");

    const timer = setTimeout(() => {
      reject(new Error("Timed out loading Google Sign-In."));
    }, LOAD_TIMEOUT_MS);

    const finish = (error?: Error) => {
      clearTimeout(timer);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      if (error) {
        scriptPromise = null;
        reject(error);
      } else {
        resolve();
      }
    };
    const onLoad = () => (window.google?.accounts?.id ? finish() : finish(new Error("Google Sign-In unavailable.")));
    const onError = () => finish(new Error("Could not reach Google Sign-In."));

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);

    if (!existing) {
      script.src = GIS_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
};

/**
 * Renders the Google One Tap button into `container` and forwards the raw ID
 * token to `onCredential`. The token is only *decoded* by the server, which
 * verifies it against Google's signing keys.
 */
export const renderGoogleButton = async (
  container: HTMLElement | null,
  onCredential: (credential: string) => void,
  onError: (message: string) => void,
): Promise<void> => {
  if (!container) {
    onError("Sign-in button is not ready yet.");
    return;
  }

  if (!IS_GOOGLE_AUTH_CONFIGURED) {
    onError("Google Sign-In is not configured: set EXPO_PUBLIC_GOOGLE_CLIENT_ID in client/.env.");
    return;
  }

  try {
    await loadGis();
  } catch (error) {
    onError(error instanceof Error ? error.message : "Could not load Google Sign-In.");
    return;
  }

  const id = window.google?.accounts?.id;
  if (!id) {
    onError("Google Sign-In is unavailable.");
    return;
  }

  try {
    id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (!response?.credential) {
          onError("Google did not return a credential.");
          return;
        }
        onCredential(response.credential);
      },
    });
    id.renderButton(container, {
      theme: "filled_black",
      size: "large",
      shape: "pill",
      width: 280,
    });
  } catch (error) {
    onError(error instanceof Error ? error.message : "Google Sign-In failed to render.");
  }
};
