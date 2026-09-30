/** Rutas de destino en Google Drive (relativas a "Mi unidad"). */
import { CARPETA_PROYECTO, CARPETA_RAIZ } from './config';

export const rutaProyecto = () => `${CARPETA_RAIZ}/${CARPETA_PROYECTO}`;
export const rutaPrograma = (programa: string) => `${rutaProyecto()}/${programa}`;
export const rutaResidente = (programa: string, carpeta: string) => `${rutaPrograma(programa)}/${carpeta}`;
export const rutaSesion = (programa: string, carpeta: string, numero: number) =>
  `${rutaResidente(programa, carpeta)}/Evidencia Sesión ${numero}`;

export const CARPETA_FOTOS = 'Registro Fotográfico';
export const CARPETA_MATERIAL = 'Material Utilizado';

/** 'foto.jpg', 2 → 'foto (2).jpg' */
export function conSufijo(nombre: string, n: number) {
  if (n <= 1) return nombre;
  const punto = nombre.lastIndexOf('.');
  return punto > 0 ? `${nombre.slice(0, punto)} (${n})${nombre.slice(punto)}` : `${nombre} (${n})`;
}
