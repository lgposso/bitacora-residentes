import { describe, expect, test } from 'vitest';
import {
  calcularDuracion, formatDuracion, nombreSeguro, normalizarCorreo, normalizarDocumento, parseHora,
  validarAsistencia, validarBitacora, validarPlan
} from './validaciones';

const bitacoraValida = () => ({
  fecha: '2026-09-29',
  horaInicio: '07:00',
  horaFinal: '08:30',
  escenario: 'Aula',
  escenarioOtro: '',
  poblacion: 'Internos',
  participantes: '12',
  tema: 'Sepsis',
  estrategias: ['Caso clínico', 'Taller'],
  evaluaciones: ['Rúbrica']
});

describe('horas y duración', () => {
  test('parseHora', () => {
    expect(parseHora('07:30')).toBe(450);
    expect(parseHora('23:59')).toBe(1439);
    expect(parseHora('24:00')).toBeNull();
    expect(parseHora('7:3')).toBeNull();
    expect(parseHora('')).toBeNull();
  });

  test('formatDuracion', () => {
    expect(formatDuracion(90)).toBe('1 h 30 min');
    expect(formatDuracion(45)).toBe('45 min');
    expect(formatDuracion(120)).toBe('2 h');
  });

  test('calcularDuracion', () => {
    expect(calcularDuracion('07:00', '08:30')).toEqual({ minutos: 90, texto: '1 h 30 min' });
    expect(() => calcularDuracion('08:00', '08:00')).toThrow(/posterior/);
    expect(() => calcularDuracion('09:00', '08:00')).toThrow(/posterior/);
    expect(() => calcularDuracion('xx', '08:00')).toThrow(/inválida/);
  });
});

describe('validarBitacora', () => {
  test('acepta datos correctos', () => {
    const r = validarBitacora(bitacoraValida());
    expect(r.errores).toEqual([]);
    expect(r.datos.duracionMinutos).toBe(90);
    expect(r.datos.participantes).toBe(12);
    expect(r.datos.escenario).toBe('Aula');
  });

  test('"Otro" requiere cuál y se guarda como texto', () => {
    const d = bitacoraValida();
    d.escenario = 'Otro';
    expect(validarBitacora(d).errores.some((e) => /cuál/i.test(e))).toBe(true);
    d.escenarioOtro = 'Auditorio';
    const r = validarBitacora(d);
    expect(r.errores).toEqual([]);
    expect(r.datos.escenario).toBe('Otro: Auditorio');
  });

  test('rechaza opciones fuera de lista y vacíos', () => {
    const d = { ...bitacoraValida(), poblacion: 'Residentes', estrategias: [], evaluaciones: ['Inventada'], participantes: '0', tema: '  ' };
    expect(validarBitacora(d).errores).toHaveLength(5);
  });

  test('rechaza fecha inválida', () => {
    const d = { ...bitacoraValida(), fecha: '2026-02-30' };
    expect(validarBitacora(d).errores.some((e) => /fecha/i.test(e))).toBe(true);
  });

  test('tolera entradas mal formadas sin lanzar', () => {
    expect(validarBitacora(null).errores.length).toBeGreaterThan(0);
    expect(validarBitacora({ estrategias: 'Taller' }).errores.length).toBeGreaterThan(0);
  });
});

test('validarAsistencia', () => {
  const ok = validarAsistencia({ nombre: ' Ana  Pérez ', correo: 'ANA@Uni.edu.co ', universidad: ' Universidad  del Valle ', semestre: '8', autoriza: true });
  expect(ok.errores).toEqual([]);
  expect(ok.datos.nombre).toBe('Ana Pérez');
  expect(ok.datos.correo).toBe('ana@uni.edu.co');
  expect(ok.datos.universidad).toBe('Universidad del Valle');

  const mal = validarAsistencia({ nombre: '', correo: 'no-es-correo', universidad: ' ', semestre: '5', autoriza: false });
  expect(mal.errores).toHaveLength(5);
  expect(mal.errores).toContain('Escriba su universidad.');
});

test('validarPlan acepta solo doc, docx, xls, xlsx, pdf', () => {
  expect(validarPlan('plan.PDF')).toBe('pdf');
  expect(validarPlan('mi.plan.docx')).toBe('docx');
  expect(() => validarPlan('foto.jpg')).toThrow(/Formato/);
  expect(() => validarPlan('sinextension')).toThrow(/Formato/);
});

test('normalizarCorreo', () => {
  expect(normalizarCorreo('  Juan.Perez@Correo.COM ')).toBe('juan.perez@correo.com');
  for (const malo of ['jperez', 'a b@c.co', 'sin@dominio', '', null]) {
    expect(() => normalizarCorreo(malo)).toThrow(/correo/i);
  }
});

test('nombreSeguro quita caracteres problemáticos', () => {
  expect(nombreSeguro('  Juan / Pérez\\ ')).toBe('Juan - Pérez-');
  expect(nombreSeguro('foto:1?.jpg')).toBe('foto 1 .jpg');
});

test('normalizarDocumento', () => {
  expect(normalizarDocumento('1.144.123.456')).toBe('1144123456');
  expect(normalizarDocumento(' 98 765-432 ')).toBe('98765432');
  expect(normalizarDocumento('12345')).toBe('12345');
  for (const malo of ['1234', '1234567890123456', 'CC123456', '', null]) {
    expect(() => normalizarDocumento(malo)).toThrow(/documento/);
  }
});
