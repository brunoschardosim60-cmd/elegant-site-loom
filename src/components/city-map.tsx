import { useEffect, useMemo, useState } from "react";
import type { CityMetrics } from "@/lib/conference-metrics";
import { formatMoney, LATE_AFTER_DAYS } from "@/lib/conference-metrics";
import {
  cityLevel,
  CRITICAL_LATE_SHARE,
  placeCities,
  type CityLevel,
  type CityShapes,
} from "@/lib/city-map";

const levelLabels: Record<CityLevel, string> = {
  ok: "Sem atraso",
  attention: `Com atraso (menos de ${Math.round(CRITICAL_LATE_SHARE * 100)}%)`,
  critical: `${Math.round(CRITICAL_LATE_SHARE * 100)}% ou mais atrasados`,
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function describe(city: CityMetrics) {
  return [
    plural(city.ctcs, "CTC", "CTCs"),
    plural(city.pending, "pendente", "pendentes"),
    plural(city.late, "atrasado", "atrasados"),
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
    const total: Record<CityLevel, number> = { ok: 0, attention: 0, critical: 0 };
    for (const city of placed.values()) total[cityLevel(city)]++;
    return total;
  }, [placed]);
  if (failed) return null;
  const shown = selected ? placed.get(selected) : undefined;
  const shownName = shapes?.cities.find((shape) => shape.id === selected)?.name;
  return (
    <section className="manifest-card city-map" aria-label="Mapa de atrasos por cidade">
      <div className="city-map-head">
        <div>
          <h3>Onde os CTCs estão atrasando</h3>
          <p>
            Cidades de entrega da planilha 108. Atrasado: pendente há {LATE_AFTER_DAYS} dias ou
            mais.
          </p>
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
          <svg
            viewBox={`0 0 ${shapes.width} ${shapes.height}`}
            role="group"
            aria-label="Municípios do Rio Grande do Sul"
            onMouseLeave={() => setSelected(null)}
          >
            {shapes.cities.map((shape) => {
              const city = placed.get(shape.id);
              if (!city) return <path key={shape.id} d={shape.d} className="city-shape" />;
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
          </svg>
          <div className="city-map-detail" aria-live="polite">
            {shown ? (
              <>
                <strong>{shownName}</strong>
                <span>{describe(shown)}</span>
                {!!shown.pending && onOpenCity && <span>Clique para ver os pendentes.</span>}
              </>
            ) : (
              <span>Passe o mouse ou toque numa cidade colorida para ver os números.</span>
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
