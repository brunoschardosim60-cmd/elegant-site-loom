import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CityMap } from "@/components/city-map";
import { cityKey, cityLevel, placeCities, type CityShapes } from "@/lib/city-map";
import shapes from "@/lib/maps/rs-municipios.json";
import type { CityMetrics } from "@/lib/conference-metrics";

const city = (name: string, ctcs: number, late: number, pending = late): CityMetrics => ({
  city: name,
  ctcs,
  received: ctcs - pending,
  pending,
  late,
  pendingValueCents: 0,
});

it("matches 108 spellings to IBGE names regardless of accents, apostrophes and state suffix", () => {
  expect(cityKey("Sant'Ana do Livramento")).toBe(cityKey("SANTANA DO LIVRAMENTO"));
  expect(cityKey("GRAVATAÍ - RS")).toBe(cityKey("Gravataí"));
  expect(cityKey("PASSO FUNDO/RS")).toBe("PASSOFUNDO");
});

it("covers every Rio Grande do Sul municipality", () => {
  expect((shapes as CityShapes).cities).toHaveLength(496);
  const { placed, unplaced } = placeCities(shapes as CityShapes, [
    city("PORTO ALEGRE", 10, 0),
    city("CAXIAS DO SUL", 10, 1),
    city("PELOTAS", 10, 5),
    city("JOINVILLE", 3, 1),
  ]);
  expect(placed.size).toBe(3);
  expect(unplaced.map((c) => c.city)).toEqual(["JOINVILLE"]);
});

it("colours cities green without delays, yellow below 20% late and red from 20%", () => {
  expect(cityLevel({ ctcs: 10, late: 0 })).toBe("ok");
  expect(cityLevel({ ctcs: 10, late: 1 })).toBe("attention");
  expect(cityLevel({ ctcs: 10, late: 2 })).toBe("critical");
});

it("shows a city's numbers on the first tap and opens its pending CTCs on the second", async () => {
  const open = vi.fn();
  render(<CityMap cities={[city("PELOTAS", 4, 2, 3)]} onOpenCity={open} />);
  const pelotas = await screen.findByRole("button", { name: /^Pelotas:/ });
  expect(pelotas).toHaveAttribute("data-level", "critical");
  expect(pelotas).toHaveAccessibleName("Pelotas: 4 CTCs · 3 pendentes · 2 atrasados");
  fireEvent.click(pelotas);
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText("4 CTCs · 3 pendentes · 2 atrasados")).toBeInTheDocument();
  fireEvent.click(pelotas);
  expect(open).toHaveBeenCalledExactlyOnceWith("PELOTAS");
  // Only cities with CTCs are interactive; the map opens zoomed on them.
  expect(screen.getAllByRole("button", { name: /:/ })).toHaveLength(1);
  const svg = screen.getByRole("group", { name: "Municípios do Rio Grande do Sul" });
  const zoomed = svg.getAttribute("viewBox");
  fireEvent.click(screen.getByRole("button", { name: "Ver o estado inteiro" }));
  expect(svg.getAttribute("viewBox")).not.toBe(zoomed);
  expect(svg.getAttribute("viewBox")).toMatch(/^0 0 1000 /);
});
