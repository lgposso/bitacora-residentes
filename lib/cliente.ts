/** Utilidades del navegador: llamadas a la API, subida de archivos a Drive y compresión de fotos. */
import type { TipoSubida } from './servicio';

export class ErrorApi extends Error {
  constructor(mensaje: string, public status: number) {
    super(mensaje);
  }
  get expirada() {
    return this.status === 401 && this.message === 'SESION_EXPIRADA';
  }
}

export async function api<T = unknown>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ErrorApi('No hay conexión a internet. Revise su red e intente de nuevo.', 0);
  }
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErrorApi(datos.error ?? 'Error del servidor. Intente de nuevo.', res.status);
  return datos as T;
}

/** Envío al almacén local de desarrollo (ALMACEN_LOCAL=1), con progreso. */
function enviarLocal(pathname: string, archivo: File, onProgreso: (p: number) => void) {
  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/dev/almacen?p=${encodeURIComponent(pathname)}`);
    xhr.setRequestHeader('Content-Type', archivo.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgreso(e.loaded / e.total); };
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText).url) : reject(new ErrorApi('No se pudo subir el archivo.', xhr.status)));
    xhr.onerror = () => reject(new ErrorApi('No hay conexión a internet. Revise su red e intente de nuevo.', 0));
    xhr.send(archivo);
  });
}

/**
 * Sube un archivo y lo registra: el servidor valida y da la ruta, el navegador envía el archivo
 * directo a Vercel Blob (sin pasar por el servidor, sin límite de 4.5 MB) y luego confirma.
 */
export async function subirArchivo<T>(tipo: TipoSubida, archivo: File, onProgreso: (p: number) => void = () => {}): Promise<T> {
  const mime = archivo.type || 'application/octet-stream';
  const { pathname, modo } = await api<{ pathname: string; modo: 'blob' | 'local' }>(
    '/api/subidas/preparar', { tipo, nombre: archivo.name, mime, bytes: archivo.size }
  );
  let url: string;
  if (modo === 'local') {
    url = await enviarLocal(pathname, archivo, onProgreso);
  } else {
    const { upload } = await import('@vercel/blob/client');
    try {
      const r = await upload(pathname, archivo, {
        access: 'private',
        handleUploadUrl: '/api/subidas',
        clientPayload: tipo,
        contentType: mime,
        multipart: archivo.size > 8 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => onProgreso(percentage / 100)
      });
      url = r.url;
    } catch (e) {
      console.error(e);
      throw new ErrorApi('No se pudo subir el archivo. Revise su conexión e intente de nuevo.', 0);
    }
  }
  return api<T>('/api/subidas/confirmar', { tipo, url, nombre: archivo.name });
}

/** Reduce fotos grandes a 1600 px JPEG para subir más rápido. Si no se puede, usa el original. */
export function comprimirImagen(archivo: File): Promise<File> {
  return new Promise((resolve) => {
    if (!/^image\/(jpeg|png|webp)$/.test(archivo.type)) return resolve(archivo);
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => {
        if (!b || b.size >= archivo.size) return resolve(archivo);
        resolve(new File([b], archivo.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(archivo); };
    img.src = url;
  });
}

export function tamano(bytes: number) {
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function leerLocal(clave: string) {
  try { return localStorage.getItem(clave); } catch { return null; }
}

export function guardarLocal(clave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch { /* almacenamiento no disponible: el borrador simplemente no se guarda */ }
}
