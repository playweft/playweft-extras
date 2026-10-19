/** Playweft bridge v1. All networking and identity stay in the parent platform. */
export class PlayweftBridge extends EventTarget {
  port = null;
  pending = new Map();
  matchId = null;
  version = -1;
  context = null;
  latest = null;
  closed = false;
  readyWaiters = new Set();

  constructor() {
    super();
    const storageCall = async (method, params) => {
      const context = await this.ready();
      if (!context.capabilities?.includes(method))
        throw Object.assign(
          new Error(`Platform capability unavailable: ${method}`),
          { code: 'STORAGE_UNSUPPORTED' },
        );
      return this.call(method, params, { timeoutMs: 10000 });
    };
    this.localStorage = {
      getItem: (key) =>
        storageCall('localStorage.getItem', { key: String(key) }),
      setItem: async (key, value) => {
        await storageCall('localStorage.setItem', {
          key: String(key),
          value: String(value),
        });
      },
      removeItem: async (key) => {
        await storageCall('localStorage.removeItem', { key: String(key) });
      },
      clear: async () => {
        await storageCall('localStorage.clear');
      },
      key: (index) => storageCall('localStorage.key', { index }),
      length: () => storageCall('localStorage.length'),
    };
    this.onWindowMessage = (event) => {
      if (
        this.closed ||
        this.port ||
        event.source !== window.parent ||
        event.data?.type !== 'playweft:bridge' ||
        event.data?.version !== 1 ||
        !event.ports[0]
      )
        return;
      this.port = event.ports[0];
      clearInterval(this.probe);
      this.port.onmessage = (event) => this.receive(event.data);
      this.port.start();
      this.call('game.initialize')
        .then((context) => {
          this.context = context;
          for (const waiter of this.readyWaiters) {
            clearTimeout(waiter.timer);
            waiter.resolve(context);
          }
          this.readyWaiters.clear();
          this.emit('initialize', context);
          if (this.latest) this.emit('state', this.latest);
        })
        .catch((error) => {
          for (const waiter of this.readyWaiters) {
            clearTimeout(waiter.timer);
            waiter.reject(error);
          }
          this.readyWaiters.clear();
          this.emit('error', error);
        });
    };
    window.addEventListener('message', this.onWindowMessage);
    const announce = () =>
      window.parent.postMessage(
        { type: 'playweft:bridge-ready', version: 1 },
        '*',
      );
    if (window.parent !== window) {
      this.probe = setInterval(announce, 500);
      announce();
    }
    this.onPageHide = () => this.close();
    window.addEventListener('pagehide', this.onPageHide, { once: true });
  }

  ready({ timeoutMs = 10000 } = {}) {
    if (this.closed) return Promise.reject(new Error('Game closed'));
    if (this.context) return Promise.resolve(this.context);
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.readyWaiters.delete(waiter);
          reject(
            Object.assign(new Error('Platform initialization timed out'), {
              code: 'STORAGE_UNAVAILABLE',
            }),
          );
        }, timeoutMs),
      };
      this.readyWaiters.add(waiter);
    });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  receive(message) {
    if (message?.jsonrpc !== '2.0') return;
    if (Object.hasOwn(message, 'id')) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error)
        entry.reject(
          Object.assign(new Error(message.error.message), {
            data: message.error.data,
            code: message.error.data?.code,
            rpcCode: message.error.code,
            retryable: message.error.data?.retryable === true,
            name:
              message.error.data?.code === 'STORAGE_QUOTA_EXCEEDED'
                ? 'QuotaExceededError'
                : 'Error',
          }),
        );
      else entry.resolve(message.result);
      return;
    }
    if (message.method === 'game.state') {
      const next = message.params;
      if (!next?.state || !Number.isInteger(next.version)) return;
      if (next.matchId !== this.matchId) {
        this.matchId = next.matchId;
        this.version = -1;
      }
      if (next.version <= this.version) return;
      this.version = next.version;
      this.latest = next;
      if (this.context) this.emit('state', next);
    } else if (message.method === 'platform.latency') {
      this.emit('latency', message.params);
    } else if (message.method === 'platform.error') {
      this.emit(
        'error',
        new Error(message.params?.error?.message || 'Connection unavailable'),
      );
    }
  }

  call(method, params, { timeoutMs = 2500 } = {}) {
    if (!this.port) return Promise.reject(new Error('Bridge not connected'));
    // Bounded even when a parent disappears without closing the MessagePort.
    if (this.pending.size >= 8)
      return Promise.reject(new Error('Too many pending actions'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Connection timed out'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.port.postMessage({
          jsonrpc: '2.0',
          id,
          method,
          ...(params === undefined ? {} : { params }),
        });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  action(action) {
    return this.call('room.action', { action });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.probe);
    window.removeEventListener('message', this.onWindowMessage);
    window.removeEventListener('pagehide', this.onPageHide);
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Game closed'));
    }
    this.readyWaiters.clear();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Game closed'));
    }
    this.pending.clear();
    this.port?.close();
  }
}
