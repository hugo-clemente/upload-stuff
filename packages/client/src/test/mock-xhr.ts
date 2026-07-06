/**
 * Minimal XMLHttpRequest stand-in for engine tests. Tests drive responses
 * explicitly via `emitProgress` / `respond` / `failNetwork`.
 */
export class MockXHR {
  static instances: MockXHR[] = [];
  static reset() {
    MockXHR.instances = [];
  }

  method = "";
  url = "";
  status = 0;
  requestHeaders: Record<string, string> = {};
  sentBody: unknown = undefined;
  aborted = false;

  upload: {
    onprogress: ((event: { lengthComputable: boolean; loaded: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }
  send(body: unknown) {
    this.sentBody = body;
  }
  abort() {
    this.aborted = true;
  }

  emitProgress(loaded: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded });
  }
  respond(status: number) {
    this.status = status;
    this.onload?.();
  }
  failNetwork() {
    this.onerror?.();
  }
}
