/** Sesiones en cookie httpOnly firmada (JWT). Una cookie para residentes y otra para la administradora. */
import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';

export type Rol = 'residente' | 'admin';

const DURACION = 12 * 60 * 60; // segundos

function secreto() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  return new TextEncoder().encode('solo-para-desarrollo-local-no-usar-en-produccion');
}

const nombreCookie = (rol: Rol) => `bitacora_${rol}`;

export async function iniciarSesion(rol: Rol, sub: string) {
  const jwt = await new SignJWT({ rol })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(`${DURACION}s`)
    .sign(secreto());
  (await cookies()).set(nombreCookie(rol), jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DURACION
  });
}

export async function leerSesion(rol: Rol): Promise<string | null> {
  const valor = (await cookies()).get(nombreCookie(rol))?.value;
  if (!valor) return null;
  try {
    const { payload } = await jwtVerify(valor, secreto());
    return payload.rol === rol && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function cerrarSesion(rol: Rol) {
  (await cookies()).delete(nombreCookie(rol));
}
