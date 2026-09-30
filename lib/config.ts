/** Constantes del proyecto: nombres de carpetas y opciones de las listas. */

export const CARPETA_RAIZ = 'MGB';
export const CARPETA_PROYECTO = 'Proyecto1';

export const PROGRAMAS = [
  'Medicina Interna',
  'Cirugía General',
  'Ortopedia y Traumatología',
  'Pediatría',
  'Ginecología y Obstetricia'
] as const;

export const ESCENARIOS = [
  'Aula',
  'Hospital simulado',
  'Escenario de práctica clínica',
  'Reunión académica',
  'Otro'
] as const;

export const POBLACIONES = ['Estudiantes de medicina', 'Internos', 'Ambos'] as const;

export const ESTRATEGIAS = [
  'Club de revista',
  'Revisión guía de práctica clínica',
  'Discusión de artículo científico',
  'Simulación clínica',
  'Demostración práctica',
  'Caso clínico',
  'Revisión de tema',
  'Taller',
  'Seminario',
  'Presentación de caso',
  'Gamificación',
  'Herramientas digitales'
] as const;

export const EVALUACIONES = [
  'Rúbrica',
  'Lista de chequeo',
  'Estación ECOE',
  'Preguntas orales',
  'Demostración práctica',
  'Reporte de caso clínico',
  'Gamificación',
  'Herramientas digitales'
] as const;

export const SEMESTRES = ['6', '7', '8', '9', '10', '11', '12'] as const;

export const PLAN_EXTENSIONES = ['doc', 'docx', 'xls', 'xlsx', 'pdf'] as const;

/** Límite por archivo. Las subidas van directo a Drive, así que no aplica el límite de Vercel. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const ZONA_HORARIA = 'America/Bogota';

export const BITACORA_ENCABEZADOS = [
  '# Sesión',
  'Fecha',
  'Hora inicio',
  'Hora final',
  'Duración',
  'Escenario de aprendizaje',
  'Población participante',
  'Número de participantes',
  'Tema desarrollado',
  'Estrategia pedagógica',
  'Evaluación',
  'Asistentes registrados (QR)',
  'Carpeta de evidencia',
  'Fecha de registro'
];

export const ASISTENCIA_ENCABEZADOS = [
  'Fecha y hora',
  'Nombres y apellidos',
  'Correo electrónico',
  'Semestre',
  'Autoriza tratamiento de datos'
];

/** Pasos de una sesión: cada paso completado avanza al siguiente. */
export type EstadoSesion = 'qr' | 'fotos' | 'material' | 'cerrada';
