// Only product form data/files, never sessions, credentials or customer information.
export async function draftStorage<T>(
  key: string,
  value?: T,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('qrg-product-editor', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('drafts');
    };
    request.onerror = () =>
      reject(new Error('Не удалось сохранить копию на устройстве.'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(
        'drafts',
        value === undefined ? 'readonly' : 'readwrite',
      );
      const store = tx.objectStore('drafts');
      const operation =
        value === undefined ? store.get(key) : store.put(value, key);
      let result: T | undefined;
      operation.onsuccess = () => {
        result = operation.result as T | undefined;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(value === undefined ? result : value);
      };
      tx.onerror = () => {
        db.close();
        reject(new Error('Не удалось сохранить копию на устройстве.'));
      };
    };
  });
}
