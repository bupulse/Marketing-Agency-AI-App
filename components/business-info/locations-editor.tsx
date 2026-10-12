"use client";

import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { HEAD_OFFICE_LABEL, LOCATION_LIMITS, MAX_BRANCHES, locationText, manualAddressText, mapsUrl, type Location } from "@/lib/business-info/locations";
import { emptyLocation, type LocationValue } from "@/components/brand-profile/steps";
import { PlaceSearch, type PickedPlace } from "./place-search";

/** The form row as the stored shape, for the preview line and the map link (the server rebuilds both on save). */
function preview(l: LocationValue): Location {
  const address = l.manual ? manualAddressText(l) : l.address.trim();
  const name = l.inBuilding ? l.building.name.trim() : "";
  return {
    kind: l.kind,
    address,
    ...(l.manual ? {} : { placeId: l.placeId, lat: l.lat, lng: l.lng }),
    ...(name ? { building: { name, floor: l.building.floor, block: l.building.block, unit: l.building.unit } } : {}),
  };
}

const filled = (l: LocationValue) => !!(l.manual ? manualAddressText(l) : l.address.trim());

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center self-start text-[14px] font-medium text-pulse-blue underline-offset-2 hover:underline">
      {children}
    </button>
  );
}

/**
 * The head office (always the first row) and up to MAX_BRANCHES branches. Each is searched (buildings, malls,
 * businesses and streets) or entered by hand, and can be inside a building. Errors use "locations.<i>.<field>" keys.
 */
export function LocationsEditor({
  locations,
  errors,
  placesEnabled,
  onChange,
}: {
  locations: LocationValue[];
  errors: Record<string, string>;
  placesEnabled: boolean;
  onChange: (locations: LocationValue[]) => void;
}) {
  const branches = locations.filter((l) => l.kind === "branch").length;
  const headFilled = !!locations[0] && filled(locations[0]);

  function update(i: number, patch: Partial<LocationValue>) {
    onChange(locations.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  const setBuilding = (i: number, patch: Partial<LocationValue["building"]>) => update(i, { building: { ...locations[i].building, ...patch } });
  const typed = (i: number) => (address: string) => update(i, { address, placeId: undefined, lat: undefined, lng: undefined });
  // A building or business from Google: its name (the suggestion's main text) becomes the building name.
  const picked = (i: number) => (p: PickedPlace) => {
    const l = locations[i];
    update(i, {
      address: p.address,
      placeId: p.placeId,
      lat: p.lat,
      lng: p.lng,
      ...(l.kind === "branch" && !l.label.trim() ? { label: p.name.slice(0, 80) } : {}),
      ...(p.building ? { inBuilding: true, building: { ...l.building, name: p.name.slice(0, LOCATION_LIMITS.buildingName) } } : {}),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {locations.map((l, i) => {
        const head = l.kind === "head";
        const err = (field: string) => errors[`locations.${i}.${field}`];
        const shown = preview(l);
        const what = head ? "Head office" : "Branch";
        return (
          <div key={i} className="glass flex flex-col gap-3 rounded-2xl p-4">
            <Field label={head ? "Name (optional)" : "Branch name"} error={err("label")}>
              <Input maxLength={80} placeholder={head ? HEAD_OFFICE_LABEL : "e.g. City centre branch"} value={l.label} onChange={(e) => update(i, { label: e.target.value })} />
            </Field>

            {l.manual ? (
              <div className="flex flex-col gap-3">
                <Field label="Street / road" required={head && branches > 0} error={err("street")}>
                  <Input maxLength={LOCATION_LIMITS.street} autoComplete="address-line1" placeholder="KN 4 Ave" value={l.street} onChange={(e) => update(i, { street: e.target.value })} />
                </Field>
                <Field label="Area" error={err("area")}>
                  <Input maxLength={LOCATION_LIMITS.area} autoComplete="address-level3" placeholder="Kiyovu" value={l.area} onChange={(e) => update(i, { area: e.target.value })} />
                </Field>
                <Field label="City" error={err("city")}>
                  <Input maxLength={LOCATION_LIMITS.city} autoComplete="address-level2" placeholder="Kigali" value={l.city} onChange={(e) => update(i, { city: e.target.value })} />
                </Field>
                {placesEnabled && <LinkButton onClick={() => update(i, { manual: false })}>Search for it instead</LinkButton>}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <PlaceSearch
                  label={`${what} address`}
                  required={head && branches > 0}
                  address={l.address}
                  enabled={placesEnabled}
                  error={err("address")}
                  onType={typed(i)}
                  onPick={picked(i)}
                />
                <LinkButton onClick={() => update(i, { manual: true, placeId: undefined, lat: undefined, lng: undefined })}>Can&apos;t find it? Enter it yourself</LinkButton>
              </div>
            )}

            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" checked={l.inBuilding} onChange={(e) => update(i, { inBuilding: e.target.checked })} className="size-5 shrink-0 cursor-pointer accent-pulse-blue" />
              Inside a building or mall
            </label>
            {l.inBuilding && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Building name" required error={err("buildingName")} className="sm:col-span-2">
                  <Input maxLength={LOCATION_LIMITS.buildingName} placeholder="M Peace Plaza" value={l.building.name} onChange={(e) => setBuilding(i, { name: e.target.value })} />
                </Field>
                <Field label="Floor (optional)" error={err("floor")}>
                  <Input maxLength={LOCATION_LIMITS.floor} placeholder="3rd floor" value={l.building.floor} onChange={(e) => setBuilding(i, { floor: e.target.value })} />
                </Field>
                <Field label="Block / wing (optional)" error={err("block")}>
                  <Input maxLength={LOCATION_LIMITS.block} placeholder="Block B" value={l.building.block} onChange={(e) => setBuilding(i, { block: e.target.value })} />
                </Field>
                <Field label="Shop or office number (optional)" error={err("unit")} className="sm:col-span-2">
                  <Input maxLength={LOCATION_LIMITS.unit} placeholder="Shop 12" value={l.building.unit} onChange={(e) => setBuilding(i, { unit: e.target.value })} />
                </Field>
              </div>
            )}

            {shown.address && (
              <div className="flex flex-col gap-0.5 rounded-xl bg-soft px-3 py-2 text-[14px]">
                <span>
                  <span className="text-muted">Customers see: </span>
                  {locationText(shown)}
                </span>
                <a href={mapsUrl(shown)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 self-start font-medium text-pulse-blue underline-offset-2 hover:underline">
                  <ExternalLink aria-hidden className="size-4" /> Open in Google Maps
                </a>
              </div>
            )}

            {!head && (
              <Button variant="outline" size="sm" className="self-start" leading={<Trash2 aria-hidden className="size-4" />} onClick={() => onChange(locations.filter((_, j) => j !== i))}>
                Remove branch
              </Button>
            )}
          </div>
        );
      })}
      {errors["locations.form"] && (
        <p role="alert" className="text-[13px] font-medium text-danger">
          {errors["locations.form"]}
        </p>
      )}
      {branches < MAX_BRANCHES && (
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="self-start" disabled={!headFilled} leading={<Plus aria-hidden className="size-4" />} onClick={() => onChange([...locations, emptyLocation("branch")])}>
            Add branch
          </Button>
          {!headFilled && <p className="text-[13px] text-muted">Add the head office address first.</p>}
        </div>
      )}
    </div>
  );
}
