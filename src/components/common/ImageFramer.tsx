import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Move, X, ZoomIn } from 'lucide-react';
import { cropImageToDataUrl, loadImageFile } from '../../lib/image';

const ASPECTS = [
  { key: 'wide', label: 'Larga 16:9', value: 16 / 9 },
  { key: 'card', label: 'Cartão 4:3', value: 4 / 3 },
  { key: 'square', label: 'Quadrada 1:1', value: 1 },
] as const;

type FrameOptions = { aspect?: number; title?: string };
type Request = FrameOptions & { file: File; resolve: (dataUrl: string | null) => void };

/**
 * Abre o enquadramento antes do upload: o usuário arrasta e dá zoom para
 * escolher o pedaço da foto que aparece no app, porque as telas cortam a
 * imagem com object-cover e o centro nem sempre é a melhor parte.
 */
export function useImageFramer() {
  const [request, setRequest] = useState<Request | null>(null);

  const frameImage = useCallback(
    (file: File, options?: FrameOptions) =>
      new Promise<string | null>((resolve) => setRequest({ ...options, file, resolve })),
    []
  );

  const finish = useCallback(
    (dataUrl: string | null) => {
      setRequest((current) => {
        current?.resolve(dataUrl);
        return null;
      });
    },
    []
  );

  const framerNode = request ? (
    <ImageFramerModal
      key={request.file.name + request.file.size}
      file={request.file}
      title={request.title}
      initialAspect={request.aspect}
      onCancel={() => finish(null)}
      onConfirm={finish}
    />
  ) : null;

  return { frameImage, framerNode };
}

const FRAME_WIDTH = 320;
const MAX_ZOOM = 4;

const ImageFramerModal: React.FC<{
  file: File;
  title?: string;
  initialAspect?: number;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
}> = ({ file, title, initialAspect, onCancel, onConfirm }) => {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspect, setAspect] = useState(
    () => ASPECTS.find((option) => option.value === initialAspect)?.value ?? ASPECTS[0].value
  );
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    let alive = true;
    loadImageFile(file)
      .then((loaded) => alive && setImg(loaded))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : 'Falha ao ler a imagem.'));
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onCancel]);

  const frameHeight = Math.round(FRAME_WIDTH / aspect);

  // "cover": a menor escala em que a imagem ainda preenche a moldura inteira.
  const baseScale = img ? Math.max(FRAME_WIDTH / img.width, frameHeight / img.height) : 1;
  const scale = baseScale * zoom;
  const displayWidth = img ? img.width * scale : 0;
  const displayHeight = img ? img.height * scale : 0;

  const clamp = useCallback(
    (next: { x: number; y: number }) => {
      const limitX = Math.max(0, (displayWidth - FRAME_WIDTH) / 2);
      const limitY = Math.max(0, (displayHeight - frameHeight) / 2);
      return {
        x: Math.min(limitX, Math.max(-limitX, next.x)),
        y: Math.min(limitY, Math.max(-limitY, next.y)),
      };
    },
    [displayWidth, displayHeight, frameHeight]
  );

  // Zoom ou troca de proporção pode deixar uma borda vazia: reencaixa o recorte.
  useEffect(() => setOffset((current) => clamp(current)), [clamp]);

  const startDrag = (event: React.PointerEvent) => {
    if (!img) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
    };
  };

  const moveDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset(
      clamp({
        x: drag.originX + (event.clientX - drag.startX),
        y: drag.originY + (event.clientY - drag.startY),
      })
    );
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const confirm = () => {
    if (!img) return;
    try {
      const sw = FRAME_WIDTH / scale;
      const sh = frameHeight / scale;
      const centerX = img.width / 2 - offset.x / scale;
      const centerY = img.height / 2 - offset.y / scale;
      onConfirm(
        cropImageToDataUrl(img, {
          sx: Math.max(0, centerX - sw / 2),
          sy: Math.max(0, centerY - sh / 2),
          sw: Math.min(sw, img.width),
          sh: Math.min(sh, img.height),
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao recortar a imagem.');
    }
  };

  const preview = useMemo(() => (img ? img.src : ''), [img]);

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl border border-[#E7E5E4] shadow-xl overflow-hidden flex flex-col max-h-[92vh]">
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E7E5E4]">
          <div>
            <h2 className="text-sm font-extrabold text-[#1C1917]">{title || 'Enquadrar imagem'}</h2>
            <p className="text-[11px] text-[#57534E] mt-0.5">Arraste a foto e use o zoom para escolher o corte.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar"
            className="shrink-0 w-9 h-9 rounded-full border border-[#E7E5E4] text-[#57534E] hover:bg-[#F5F5F4] flex items-center justify-center transition"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="flex justify-center">
            <div
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              style={{ width: FRAME_WIDTH, height: frameHeight, touchAction: 'none' }}
              className="relative max-w-full overflow-hidden rounded-2xl border border-[#E7E5E4] bg-[#F5F5F4] cursor-grab active:cursor-grabbing select-none"
            >
              {img ? (
                <img
                  src={preview}
                  alt=""
                  draggable={false}
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
                  }}
                  className="absolute left-1/2 top-1/2 max-w-none pointer-events-none"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center">
                  {error ? (
                    <span className="text-[11px] text-[#B91C1C] px-4 text-center">{error}</span>
                  ) : (
                    <Loader2 className="w-6 h-6 text-[#B91C1C] animate-spin" />
                  )}
                </span>
              )}
              <span className="pointer-events-none absolute inset-0 border border-white/70 rounded-2xl" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ZoomIn className="w-4 h-4 text-[#57534E] shrink-0" />
            <input
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={zoom}
              disabled={!img}
              aria-label="Zoom"
              onChange={(event) => setZoom(Number(event.target.value))}
              className="w-full accent-[#B91C1C]"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ASPECTS.map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={aspect === option.value}
                onClick={() => setAspect(option.value)}
                className={aspect === option.value ? 'btn-primary' : 'btn-secondary'}
              >
                {option.label}
              </button>
            ))}
          </div>

          <p className="flex items-center gap-1.5 text-[11px] text-[#57534E]">
            <Move className="w-3.5 h-3.5" />
            Só o que está dentro da moldura vai ser salvo.
          </p>

          {error && img && <p className="text-[11px] text-[#B91C1C]">{error}</p>}
        </div>

        <footer className="flex gap-2 px-5 py-4 border-t border-[#E7E5E4]">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="btn-primary flex-1" disabled={!img} onClick={confirm}>
            <Check className="w-3.5 h-3.5" />
            Usar imagem
          </button>
        </footer>
      </div>
    </div>
  );
};
