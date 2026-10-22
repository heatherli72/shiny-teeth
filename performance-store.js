// A save is successful only after the IndexedDB transaction commits. No memory fallback.
const STORAGE_ERROR = 'Could not save your recording. Check browser storage access and free space. Your draft is kept on this page.';
// Explicit app errors retain their recovery guidance across audio operations.
export class StudioError extends Error {
  constructor(message) { super(message); this.name = 'StudioError'; }
}
export class PerformanceStore {
  constructor({ indexedDB = globalThis.indexedDB, databaseName = 'shiny-teeth-performances-v2' } = {}) {
    this.indexedDB = indexedDB;
    this.databaseName = databaseName;
    this.persistent = Boolean(indexedDB);
    this._opening = null;
    this._db = null;
    this._closed = false;
  }
  async _open() {
    if (this._closed || !this.indexedDB) throw new StudioError('Local recording storage is unavailable. You can download your draft first.');
    if (this._db) return this._db;
    if (!this._opening) this._opening = new Promise((resolve, reject) => {
      let request, failed = false;
      const fail = error => { failed = true; reject(error); };
      try { request = this.indexedDB.open(this.databaseName, 1); } catch { fail(new StudioError(STORAGE_ERROR)); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('takes')) db.createObjectStore('takes', { keyPath: 'id' });
      };
      request.onerror = () => fail(new StudioError(STORAGE_ERROR));
      request.onblocked = () => fail(new StudioError('Recording storage is in use by another page. Close other tabs of this app and try again.'));
      request.onsuccess = () => {
        if (this._closed || failed) { request.result.close(); reject(new StudioError('Recording storage is closed.')); return; }
        this._db = request.result;
        this._db.onversionchange = () => { this._db?.close(); this._db = null; this._opening = null; };
        this.persistent = true;
        resolve(this._db);
      };
    }).catch(error => { this._opening = null; this.persistent = false; throw error; });
    return this._opening;
  }
  async _run(mode, operation) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      let transaction, request;
      try {
        transaction = db.transaction('takes', mode);
        request = operation(transaction.objectStore('takes'));
      } catch { reject(new StudioError(STORAGE_ERROR)); return; }
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new StudioError(STORAGE_ERROR));
      request.onerror = () => reject(new StudioError(STORAGE_ERROR));
    });
  }
  async put(take) { await this._run('readwrite', store => store.put(take)); return take; }
  async get(id) { return this._run('readonly', store => store.get(id)); }
  async list() {
    const takes = await this._run('readonly', store => store.getAll());
    return takes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  async delete(id) { await this._run('readwrite', store => store.delete(id)); }
  async deletePhrase(phraseId) {
    if (typeof phraseId !== 'string' || !phraseId.trim()) throw new StudioError('Choose a saved line to discard.');
    const db = await this._open();
    return new Promise((resolve, reject) => {
      let transaction;
      const deletedIds = [];
      const fail = () => reject(new StudioError('Could not discard this line. Your saved recordings are kept. Try again.'));
      const abort = () => { try { transaction.abort(); } catch { fail(); } };
      try {
        transaction = db.transaction('takes', 'readwrite');
        transaction.oncomplete = () => resolve(deletedIds);
        transaction.onabort = fail;
        transaction.onerror = abort;
        const store = transaction.objectStore('takes');
        const request = store.getAll();
        request.onerror = abort;
        request.onsuccess = () => {
          try {
            for (const take of request.result || []) {
              if (take.phraseId !== phraseId && take.id !== `line-${phraseId}`) continue;
              const deletion = store.delete(take.id);
              deletion.onerror = abort;
              deletedIds.push(take.id);
            }
          } catch { abort(); }
        };
      } catch { abort(); }
    });
  }
  close() { this._closed = true; this._db?.close(); this._db = null; }
}
