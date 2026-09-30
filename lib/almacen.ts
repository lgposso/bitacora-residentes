/**
 * Almacenamiento temporal de archivos subidos, hasta que el sincronizador los copie a Google Drive.
 * - Producción: Vercel Blob privado (el navegador sube directo, sin pasar por el servidor).
 * - Local y pruebas (ALMACEN_LOCAL=1): memoria del proceso, servida por /api/dev/almacen.
 */
import { del, head, issueSignedToken, presignUrl } from '@vercel/blob';

export interface InfoArchivo {
  pathname: string;
  bytes: number;
  mime: string;
}

export interface Almacen {
  /** 'blob': el navegador usa @vercel/blob/client. 'local': PUT a /api/dev/almacen. */
  modo: 'blob' | 'local';
  info(url: string): Promise<InfoArchivo | null>;
  borrar(urls: string[]): Promise<void>;
  /** Enlaces de descarga temporales (2 h) para que el sincronizador baje los archivos sin credenciales. */
  urlsDescarga(urls: string[]): Promise<string[]>;
}

export const almacenBlob: Almacen = {
  modo: 'blob',
  async info(url) {
    try {
      const h = await head(url);
      return { pathname: h.pathname, bytes: h.size, mime: h.contentType };
    } catch {
      return null;
    }
  },
  async borrar(urls) {
    if (urls.length) await del(urls);
  },
  async urlsDescarga(urls) {
    if (!urls.length) return [];
    const token = await issueSignedToken({ pathname: '*', operations: ['get'], validUntil: Date.now() + 2 * 3600_000 });
    return Promise.all(urls.map(async (u) => {
      const pathname = decodeURIComponent(new URL(u).pathname.slice(1));
      return (await presignUrl(token, { operation: 'get', pathname, access: 'private' })).presignedUrl;
    }));
  }
};

/** Almacén en memoria: la URL es `<origen>/api/dev/almacen?p=<pathname>`. */
export class AlmacenLocal implements Almacen {
  modo = 'local' as const;
  archivos = new Map<string, { datos: Uint8Array; mime: string }>();

  guardar(pathname: string, datos: Uint8Array, mime: string) {
    this.archivos.set(pathname, { datos, mime });
  }

  static pathnameDe(url: string) {
    return new URL(url, 'http://local').searchParams.get('p') ?? '';
  }

  async info(url: string) {
    const pathname = AlmacenLocal.pathnameDe(url);
    const a = this.archivos.get(pathname);
    return a ? { pathname, bytes: a.datos.byteLength, mime: a.mime } : null;
  }

  async borrar(urls: string[]) {
    for (const u of urls) this.archivos.delete(AlmacenLocal.pathnameDe(u));
  }

  async urlsDescarga(urls: string[]) {
    return urls;
  }
}
