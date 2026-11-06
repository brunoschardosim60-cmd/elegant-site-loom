import { useEffect, useMemo, useState } from "react";
import type { CityMetrics } from "@/lib/conference-metrics";
import {
  formatDays,
  formatMoney,
  formatShare,
  lateShare,
  MIN_CTCS,
} from "@/lib/conference-metrics";
import {
  cityLevel,
  CRITICAL_SHARE,
  placeCities,
  type CityLevel,
  type CityShapes,
} from "@/lib/city-map";

const levelLabels: Record<CityLevel, string> = {
  ok: "Nada atrasado",
  attention: `Menos de ${Math.round(CRITICAL_SHARE * 100)}% atrasados`,
  critical: `${Math.round(CRITICAL_SHARE * 100)}% ou mais atrasados`,
  few: `Poucos dados (menos de ${MIN_CTCS} CTCs)`,
};

/** Reference cities always named on the map, so a coloured area is easy to place. */
const LANDMARKS = new Set([
  "Porto Alegre",
  "Caxias do Sul",
  "Passo Fundo",
  "Santa Maria",
  "Pelotas",
  "Rio Grande",
  "Uruguaiana",
  "Santa Cruz do Sul",
  "Erechim",
  "Bagé",
  "Santo Ângelo",
  "Lajeado",
]);

type Box = { x0: number; y0: number; x1: number; y1: number };
/** Bounding box of an SVG path made of absolute M/L coordinates. */
function pathBox(d: string): Box {
  const n = d.match(/-?[\d.]+/g)!.map(Number);
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < n.length; i += 2) {
    box.x0 = Math.min(box.x0, n[i]!);
    box.x1 = Math.max(box.x1, n[i]!);
    box.y0 = Math.min(box.y0, n[i + 1]!);
    box.y1 = Math.max(box.y1, n[i + 1]!);
  }
  return box;
}

/** View box around the given boxes, with a margin and a minimum size. */
function fitBox(boxes: Box[], width: number, height: number) {
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const y0 = Math.min(...boxes.map((b) => b.y0));
  const x1 = Math.max(...boxes.map((b) => b.x1));
  const y1 = Math.max(...boxes.map((b) => b.y1));
  const ratio = width / height;
  // Generous margin: enough neighbouring towns and reference cities to read the region.
  let w = Math.max(x1 - x0, 240) * 1.6;
  let h = Math.max(y1 - y0, 240 / ratio) * 1.6;
  if (w / h < ratio) w = h * ratio;
  else h = w / ratio;
  w = Math.min(w, width);
  h = Math.min(h, height);
  // Centred on the cities, even when that shows some sea past the coast.
  const x = (x0 + x1) / 2 - w / 2;
  const y = (y0 + y1) / 2 - h / 2;
  return { x, y, w, h };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describe(city: CityMetrics) {
  return [
    plural(city.ctcs, "CTC", "CTCs"),
    plural(city.pending, "pendente", "pendentes"),
    `${plural(city.late, "atrasado", "atrasados")}${
      city.ctcs >= MIN_CTCS && city.late ? ` (${formatShare(lateShare(city))})` : ""
    }`,
    ...(city.pendingValueCents ? [`${formatMoney(city.pendingValueCents)} pendentes`] : []),
  ].join(" · ");
}

/**
 * Rio Grande do Sul by municipality, coloured by how many of each city's CTCs
 * are late. The outlines load on demand so the rest of the app stays light.
 */
export function CityMap({
  cities,
  onOpenCity,
}: {
  cities: CityMetrics[];
  /** Opens the pending CTCs of a city (the name as it appears in the 108 export). */
  onOpenCity?: ((city: string) => void) | undefined;
}) {
  const [shapes, setShapes] = useState<CityShapes | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [whole, setWhole] = useState(false);
  useEffect(() => {
    let active = true;
    import("@/lib/maps/rs-municipios.json")
      .then((module) => {
        if (active) setShapes(module.default as CityShapes);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const { placed, unplaced } = useMemo(
    () => (shapes ? placeCities(shapes, cities) : { placed: new Map(), unplaced: [] }),
    [shapes, cities],
  );
  const counts = useMemo(() => {
    const total: Record<CityLevel, number> = { ok: 0, attention: 0, critical: 0, few: 0 };
    for (const city of placed.values()) total[cityLevel(city)]++;
    return total;
  }, [placed]);
  const boxes = useMemo(
    () => new Map(shapes?.cities.map((shape) => [shape.id, pathBox(shape.d)]) ?? []),
    [shapes],
  );
  if (failed) return null;
  const full = shapes ? { x: 0, y: 0, w: shapes.width, h: shapes.height } : undefined;
  const zoomed =
    shapes && placed.size
      ? fitBox(
          [...placed.keys()].map((id) => boxes.get(id)!),
          shapes.width,
          shapes.height,
        )
      : undefined;
  const view = whole || !zoomed ? full : zoomed;
  const canZoom = !!zoomed && !!full && zoomed.w < full.w * 0.9;
  // Text and strokes keep the same size on screen at any zoom.
  const unit = view ? view.w / 1000 : 1;
  // Landmarks always; coloured cities only when zoomed in, most delayed first,
  // skipping any name that would overlap one already placed.
  const labels: { id: string; name: string; x: number; y: number; data: boolean; size: number }[] =
    [];
  if (shapes && view) {
    const taken: Box[] = [];
    const candidates = shapes.cities
      .filter((shape) => LANDMARKS.has(shape.name) || (!whole && placed.has(shape.id)))
      .map((shape) => ({ shape, city: placed.get(shape.id) }))
      .sort(
        (a, b) =>
          Number(!!b.city) - Number(!!a.city) ||
          (b.city?.late ?? 0) - (a.city?.late ?? 0) ||
          (b.city?.ctcs ?? 0) - (a.city?.ctcs ?? 0),
      );
    for (const { shape, city } of candidates) {
      const box = boxes.get(shape.id)!;
      const data = !!city && !whole;
      const size = (data ? 17 : 14) * unit;
      const x = (box.x0 + box.x1) / 2;
      const y = (box.y0 + box.y1) / 2 - (data ? 0 : 8 * unit);
      const half = (shape.name.length * size * 0.56) / 2;
      const area = { x0: x - half, x1: x + half, y0: y - size * 0.7, y1: y + size * 0.7 };
      if (taken.some((t) => t.x0 < area.x1 && area.x0 < t.x1 && t.y0 < area.y1 && area.y0 < t.y1))
        continue;
      taken.push(area);
      labels.push({ id: shape.id, name: shape.name, x, y, data, size });
    }
  }
  const shown = selected ? placed.get(selected) : undefined;
  const shownName = shapes?.cities.find((shape) => shape.id === selected)?.name;
  return (
    <section className="manifest-card city-map" aria-label="Mapa de atrasos por cidade">
      <div className="city-map-head">
        <div>
          <h3>CTCs atrasados por cidade</h3>
        </div>
        <ul className="city-map-legend">
          {(Object.keys(levelLabels) as CityLevel[]).map((level) => (
            <li key={level}>
              <i data-level={level} aria-hidden="true" />
              {levelLabels[level]} <strong>{counts[level]}</strong>
            </li>
          ))}
          <li>
            <i aria-hidden="true" />
            Sem CTCs
          </li>
        </ul>
      </div>
      {shapes ? (
        <div className="city-map-body">
          {canZoom && (
            <button type="button" className="city-map-zoom" onClick={() => setWhole(!whole)}>
              {whole ? "Aproximar das cidades com CTCs" : "Ver o estado inteiro"}
            </button>
          )}
          <svg
            viewBox={`${view!.x} ${view!.y} ${view!.w} ${view!.h}`}
            style={{ "--map-unit": unit } as React.CSSProperties}
            role="group"
            aria-label="Municípios do Rio Grande do Sul"
            onMouseLeave={() => setSelected(null)}
          >
            {shapes.cities
              .filter((shape) => !placed.has(shape.id))
              .map((shape) => (
                <path key={shape.id} d={shape.d} className="city-shape" />
              ))}
            {shapes.cities.map((shape) => {
              const city = placed.get(shape.id);
              if (!city) return null;
              const label = `${shape.name}: ${describe(city)}`;
              return (
                <path
                  key={shape.id}
                  d={shape.d}
                  className="city-shape"
                  data-level={cityLevel(city)}
                  data-selected={selected === shape.id || undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={label}
                  onMouseEnter={() => setSelected(shape.id)}
                  onFocus={() => setSelected(shape.id)}
                  onClick={() => {
                    // A tap first shows the numbers; a second tap (or a click
                    // after hovering) opens the city's pending CTCs.
                    if (selected !== shape.id) setSelected(shape.id);
                    else if (city.pending) onOpenCity?.(city.city);
                  }}
                  onKeyDown={(event) => {
                    if ((event.key === "Enter" || event.key === " ") && city.pending) {
                      event.preventDefault();
                      onOpenCity?.(city.city);
                    }
                  }}
                >
                  <title>{label}</title>
                </path>
              );
            })}
            <g className="city-labels" aria-hidden="true">
              {labels.map((label) => (
                <g key={label.id} data-data={label.data || undefined}>
                  {!label.data && <circle cx={label.x} cy={label.y + 8 * unit} r={3 * unit} />}
                  <text x={label.x} y={label.y} fontSize={label.size} strokeWidth={3.5 * unit}>
                    {label.name}
                  </text>
                </g>
              ))}
            </g>
          </svg>
          <div className="city-map-detail" aria-live="polite">
            {shown ? (
              <>
                <strong>{shownName}</strong>
                <span>{describe(shown)}</span>
                {!!shown.topClients?.length && (
                  <span>Clientes com pendência: {shown.topClients.join(", ")}</span>
                )}
                {!!shown.topDrivers?.length && (
                  <span>Motoristas: {shown.topDrivers.join(", ")}</span>
                )}
                {shown.medianReturnDays !== undefined && (
                  <span>Devolução (mediana): {formatDays(shown.medianReturnDays)}</span>
                )}
                {!!shown.pending && onOpenCity && <span>Clique para ver os pendentes.</span>}
              </>
            ) : (
              <span>Toque numa cidade colorida para ver os números.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="city-map-loading">Carregando mapa…</div>
      )}
      {unplaced.length > 0 && (
        <p className="city-map-unplaced">
          Fora do mapa do RS:{" "}
          {unplaced
            .map((city) => `${city.city} (${plural(city.late, "atrasado", "atrasados")})`)
            .join(", ")}
          .
        </p>
      )}
    </section>
  );
}
