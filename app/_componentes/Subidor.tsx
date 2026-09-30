'use client';

import { useRef, useState } from 'react';
import { comprimirImagen, ErrorApi, subirArchivo, tamano } from '@/lib/cliente';
import type { TipoSubida } from '@/lib/servicio';

interface Item { id: number; nombre: string; estado: string; clase: '' | 'ok' | 'err' }

/** Zona para elegir/arrastrar varios archivos; los sube uno por uno a Drive con progreso. */
export function Subidor(props: {
  tipo: Exclude<TipoSubida, 'plan'>;
  titulo: string;
  accept?: string;
  comprimir?: boolean;
  guardados: number;
  onGuardados: (n: number) => void;
  onOcupado: (ocupado: boolean) => void;
  onExpirada: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [sobre, setSobre] = useState(false);
  const cola = useRef<{ item: Item; archivo: File }[]>([]);
  const trabajando = useRef(false);
  const seq = useRef(0);

  const actualizar = (id: number, cambio: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...cambio } : x)));

  async function procesar() {
    if (trabajando.current) return;
    trabajando.current = true;
    props.onOcupado(true);
    while (cola.current.length) {
      const { item, archivo } = cola.current.shift()!;
      try {
        actualizar(item.id, { estado: 'Preparando…' });
        const f = props.comprimir ? await comprimirImagen(archivo) : archivo;
        const r = await subirArchivo<{ guardados: number }>(props.tipo, f, (p) =>
          actualizar(item.id, { estado: `Subiendo ${Math.round(p * 100)} %` })
        );
        actualizar(item.id, { estado: `Subido ✓ · ${tamano(f.size)}`, clase: 'ok' });
        props.onGuardados(r.guardados);
      } catch (e) {
        if (e instanceof ErrorApi && e.expirada) {
          cola.current = [];
          props.onExpirada();
          break;
        }
        actualizar(item.id, { estado: 'Error: ' + (e as Error).message, clase: 'err' });
      }
    }
    trabajando.current = false;
    props.onOcupado(false);
  }

  function agregar(archivos: FileList | null) {
    if (!archivos?.length) return;
    const nuevos = Array.from(archivos).map((archivo) => ({
      item: { id: ++seq.current, nombre: archivo.name, estado: 'En cola', clase: '' as const },
      archivo
    }));
    setItems((xs) => [...xs, ...nuevos.map((n) => n.item)]);
    cola.current.push(...nuevos);
    void procesar();
  }

  return (
    <div>
      <label
        className={'drop' + (sobre ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); agregar(e.dataTransfer.files); }}
      >
        <input type="file" multiple accept={props.accept} onChange={(e) => { agregar(e.target.files); e.target.value = ''; }} />
        <strong>{props.titulo}</strong>
        <br />
        <span className="small muted">o arrástrelos aquí</span>
      </label>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        {props.guardados} archivo(s) guardado(s) en esta sesión.
      </p>
      <ul className="files">
        {items.map((it) => (
          <li key={it.id} className={it.clase}>
            <span className="nm">{it.nombre}</span>
            <span className="st">{it.estado}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
