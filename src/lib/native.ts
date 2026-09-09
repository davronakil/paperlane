/** Bridge to the macOS shell. All of it is a no-op in a plain browser. */

interface WebKitHandler {
  postMessage: (message: unknown) => void;
}

const handler: WebKitHandler | undefined = (window as any).webkit?.messageHandlers
  ?.paperlane;

export const isNative = !!handler;

// Lets the stylesheet defer to native chrome (the window title bar already
// shows the document name and its edited state).
if (isNative) document.documentElement.classList.add('is-native');

function post(action: string, payload: Record<string, unknown> = {}) {
  handler?.postMessage({ action, ...payload });
}

// ---- binary <-> base64 -------------------------------------------------
export function bytesToBase64(bytes: Uint8Array): string {
  const anyU8 = bytes as any;
  if (typeof anyU8.toBase64 === 'function') return anyU8.toBase64();
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const anyU8 = Uint8Array as any;
  if (typeof anyU8.fromBase64 === 'function') return anyU8.fromBase64(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- JS -> native ------------------------------------------------------
export const native = {
  /** Hand bytes to the shell, which shows a real save panel. */
  save(bytes: Uint8Array, suggestedName: string) {
    post('save', { name: suggestedName, data: bytesToBase64(bytes) });
  },
  print(bytes: Uint8Array, jobName: string) {
    post('print', { name: jobName, data: bytesToBase64(bytes) });
  },
  openPanel(purpose: 'open' | 'insert') {
    post('openPanel', { purpose });
  },
  setTitle(name: string, dirty: boolean) {
    post('title', { name, dirty });
  },
  notify(message: string) {
    post('notify', { message });
  },
};

// ---- native -> JS ------------------------------------------------------
export interface NativeHost {
  openFile(name: string, data: string, purpose: 'open' | 'insert'): void;
  command(cmd: string): void;
  saved(path: string): void;
}

export function registerNativeHost(host: NativeHost) {
  (window as any).__paperlane = host;
  post('ready');
}
